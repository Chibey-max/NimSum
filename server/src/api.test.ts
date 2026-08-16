// API tests. These drive the real HTTP surface with a real keypair and a
// throwaway database, including the attacks the design claims to stop.

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import * as Nimiq from '@nimiq/core'
import { createApp, todayUtc } from './api'
import { connectMemory } from './db'
import { Store, streaksFrom, dayBefore } from './store'
import { challengeMessage, framedMessageBytes } from './auth'
import { boardCells } from './hex'
import { key, neighbours } from './hex'

let store: Store
let server: ReturnType<ReturnType<typeof createApp>['listen']>
let base: string

before(async () => {
  // Embedded Postgres: same SQL the production database runs.
  store = new Store(await connectMemory())
  await store.migrate()
  const app = createApp(store)
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve())
  })
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  base = `http://127.0.0.1:${port}`
})

after(async () => {
  server?.close()
  await store?.close()
})

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(base + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
  return { status: res.status, body: (await res.json()) as any }
}

/** Full sign-in: challenge, sign with a real key, exchange for a session. */
async function signIn() {
  const priv = Nimiq.PrivateKey.generate()
  const pub = Nimiq.PublicKey.derive(priv)

  const challenge = await api('/api/auth/challenge', { method: 'POST' })
  const nonce = challenge.body.nonce as string
  const sig = Nimiq.Signature.create(priv, pub, framedMessageBytes(challengeMessage(nonce)))

  const verified = await api('/api/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ nonce, publicKey: pub.toHex(), signature: sig.toHex() }),
  })
  assert.equal(verified.status, 200, `sign-in failed: ${JSON.stringify(verified.body)}`)
  return {
    token: verified.body.token as string,
    address: verified.body.address as string,
    auth: { authorization: `Bearer ${verified.body.token}` },
  }
}

/** Find a genuine shortest chain for a board, used to submit honest solves. */
function findParChain(
  values: number[],
  cells: ReturnType<typeof boardCells>,
  target: number,
  par: number,
): number[] | null {
  const idx = new Map(cells.map((c, i) => [key(c), i]))
  const adj = cells.map((c) =>
    neighbours(c)
      .map((n) => idx.get(key(n)))
      .filter((i): i is number => i !== undefined),
  )
  const used = new Array(values.length).fill(false)
  const path: number[] = []
  let found: number[] | null = null
  const walk = (node: number, sum: number) => {
    if (found || path.length >= par) return
    path.push(node)
    used[node] = true
    const next = sum + values[node]
    if (next === target && path.length === par) found = path.slice()
    else if (next < target) for (const nb of adj[node]) if (!used[nb]) walk(nb, next)
    used[node] = false
    path.pop()
  }
  for (let i = 0; i < values.length && !found; i++) walk(i, 0)
  return found
}

test('board is public and consistent without signing in', async () => {
  const { status, body } = await api('/api/puzzle')
  assert.equal(status, 200)
  assert.equal(body.date, todayUtc())
  assert.equal(body.values.length, 19)
  assert.ok(body.target > 0)
  assert.ok(body.par >= 2)
  assert.ok(typeof body.difficulty === 'string')
  // Not signed in: no attempt clock started, no prior solve.
  assert.equal(body.startedAt, null)
  assert.equal(body.existing, null)
})

test('solving requires a session', async () => {
  const { status } = await api('/api/solve', {
    method: 'POST',
    body: JSON.stringify({ date: todayUtc(), chain: [0] }),
  })
  assert.equal(status, 401)
})

test('a forged session token is refused', async () => {
  const { status } = await api('/api/me', {
    headers: { authorization: 'Bearer ' + 'f'.repeat(48) },
  })
  assert.equal(status, 401)
})

test('sign in, solve at par, and get a real rank', async () => {
  const me = await signIn()

  const puzzle = await api('/api/puzzle', { headers: me.auth })
  assert.ok(puzzle.body.startedAt, 'server should start the clock on first view')

  const chain = findParChain(puzzle.body.values, puzzle.body.cells, puzzle.body.target, puzzle.body.par)
  assert.ok(chain, 'a par chain must exist on a published board')

  const solved = await api('/api/solve', {
    method: 'POST',
    headers: me.auth,
    body: JSON.stringify({ date: todayUtc(), chain }),
  })

  assert.equal(solved.status, 200, JSON.stringify(solved.body))
  assert.equal(solved.body.score, 1000, 'par should score a clean 1000')
  assert.equal(solved.body.beatPar, true)
  assert.equal(solved.body.length, puzzle.body.par)
  assert.ok(solved.body.rank >= 1)
  assert.equal(solved.body.stats.currentStreak, 1)
  assert.equal(solved.body.stats.parCount, 1)
  // Solve time is measured by the server, so it is present and sane.
  assert.ok(solved.body.seconds >= 1)
})

test('a second solve on the same day is refused', async () => {
  const me = await signIn()
  const puzzle = await api('/api/puzzle', { headers: me.auth })
  const chain = findParChain(puzzle.body.values, puzzle.body.cells, puzzle.body.target, puzzle.body.par)!

  const first = await api('/api/solve', {
    method: 'POST',
    headers: me.auth,
    body: JSON.stringify({ date: todayUtc(), chain }),
  })
  assert.equal(first.status, 200)

  const second = await api('/api/solve', {
    method: 'POST',
    headers: me.auth,
    body: JSON.stringify({ date: todayUtc(), chain }),
  })
  assert.equal(second.status, 409, 'one solve per wallet per day')
})

test('the server ignores any score the client tries to send', async () => {
  const me = await signIn()
  const puzzle = await api('/api/puzzle', { headers: me.auth })
  const chain = findParChain(puzzle.body.values, puzzle.body.cells, puzzle.body.target, puzzle.body.par)!

  const solved = await api('/api/solve', {
    method: 'POST',
    headers: me.auth,
    // Everything below beyond `chain` is noise the server must discard.
    body: JSON.stringify({
      date: todayUtc(),
      chain,
      score: 999999,
      seconds: 1,
      length: 1,
      rank: 1,
    }),
  })

  assert.equal(solved.status, 200)
  assert.equal(solved.body.score, 1000, 'score must be recomputed, not accepted')
  assert.notEqual(solved.body.score, 999999)
  assert.equal(solved.body.length, chain.length)
})

test('invalid chains are rejected with a readable reason', async () => {
  const me = await signIn()
  const puzzle = await api('/api/puzzle', { headers: me.auth })
  const cells = puzzle.body.cells as { q: number; r: number }[]

  // Non-adjacent hop.
  const idx = new Map(cells.map((c, i) => [`${c.q},${c.r}`, i]))
  const centre = idx.get('0,0')!
  let far = -1
  for (let i = 0; i < cells.length; i++) {
    const d =
      (Math.abs(cells[i].q) + Math.abs(cells[i].q + cells[i].r) + Math.abs(cells[i].r)) / 2
    if (d === 2) {
      far = i
      break
    }
  }
  const jump = await api('/api/solve', {
    method: 'POST',
    headers: me.auth,
    body: JSON.stringify({ date: todayUtc(), chain: [centre, far] }),
  })
  assert.equal(jump.status, 400)
  assert.match(jump.body.error, /touch/i)

  // Repeated hex.
  const repeat = await api('/api/solve', {
    method: 'POST',
    headers: me.auth,
    body: JSON.stringify({ date: todayUtc(), chain: [centre, centre] }),
  })
  assert.equal(repeat.status, 400)

  // Off-board index.
  const off = await api('/api/solve', {
    method: 'POST',
    headers: me.auth,
    body: JSON.stringify({ date: todayUtc(), chain: [9999] }),
  })
  assert.equal(off.status, 400)
})

test('past boards cannot be solved for retroactive streaks', async () => {
  const me = await signIn()
  const yesterday = dayBefore(todayUtc())
  const puzzle = await api(`/api/puzzle?date=${yesterday}`, { headers: me.auth })
  const chain = findParChain(puzzle.body.values, puzzle.body.cells, puzzle.body.target, puzzle.body.par)!

  const solved = await api('/api/solve', {
    method: 'POST',
    headers: me.auth,
    body: JSON.stringify({ date: yesterday, chain }),
  })
  assert.equal(solved.status, 400)
  assert.match(solved.body.error, /today/i)
})

test('leaderboard ranks solvers and reports totals', async () => {
  const board = await api('/api/leaderboard')
  assert.equal(board.status, 200)
  assert.equal(board.body.date, todayUtc())
  assert.ok(Array.isArray(board.body.entries))
  assert.ok(board.body.players >= 1, 'earlier tests solved, so there should be players')
  // Ranks must be dense and ordered.
  board.body.entries.forEach((e: { rank: number }, i: number) => {
    assert.equal(e.rank, i + 1)
  })
  // Scores must be non-increasing down the table.
  const scores = board.body.entries.map((e: { score: number }) => e.score)
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i] <= scores[i - 1])
})

test('health check does not require a database round trip to succeed', async () => {
  const { status, body } = await api('/api/health')
  assert.equal(status, 200)
  assert.equal(body.ok, true)
})

test('public stats expose real usage counters', async () => {
  const { body } = await api('/api/stats')
  assert.ok(body.uniquePlayers >= 1)
  assert.ok(body.totalSolves >= 1)
  assert.equal(body.today, todayUtc())
})

// -- streak maths, tested directly ----------------------------------------

test('streaks count consecutive days and survive an unplayed today', () => {
  assert.deepEqual(streaksFrom([], '2026-08-20'), { current: 0, best: 0 })

  // Three in a row ending today.
  assert.deepEqual(streaksFrom(['2026-08-18', '2026-08-19', '2026-08-20'], '2026-08-20'), {
    current: 3,
    best: 3,
  })

  // Ending yesterday: still live, today is not over yet.
  assert.deepEqual(streaksFrom(['2026-08-18', '2026-08-19'], '2026-08-20'), {
    current: 2,
    best: 2,
  })

  // A gap breaks the current streak but not the best.
  assert.deepEqual(
    streaksFrom(['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-19', '2026-08-20'], '2026-08-20'),
    { current: 2, best: 3 },
  )

  // Stale history: nothing recent, streak is zero.
  assert.deepEqual(streaksFrom(['2026-08-01', '2026-08-02'], '2026-08-20'), {
    current: 0,
    best: 2,
  })
})
