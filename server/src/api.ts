// HTTP API.
//
// Two rules shape every route here:
//   1. The server owns the board and the clock. A client can send a chain; it
//      cannot send a score, a solve time, or a rank.
//   2. An address is only ever accepted after a signature proves the caller
//      holds the key. Sessions are issued by the server, not asserted by the
//      client.

import express, { type Request, type Response, type NextFunction } from 'express'
import cors from 'cors'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import {
  canonicalAddress,
  challengeMessage,
  consumeChallenge,
  issueChallenge,
  verifySignature,
} from './auth'
import { dayShape, validateChain, MAX_CHAIN } from './puzzle'
import { Store } from './store'

/** The puzzle day, in UTC, so everyone plays the same board at the same time. */
export function todayUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

function isValidDate(d: unknown): d is string {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d))
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

interface Session {
  address: string
  publicKey: string
  issuedAt: number
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const sessions = new Map<string, Session>()

function createSession(address: string, publicKey: string): string {
  const token = randomBytes(24).toString('hex')
  sessions.set(token, { address, publicKey, issuedAt: Date.now() })
  return token
}

function readSession(req: Request): Session | null {
  const header = req.header('authorization')
  if (!header?.startsWith('Bearer ')) return null
  const session = sessions.get(header.slice(7))
  if (!session) return null
  if (Date.now() - session.issuedAt > SESSION_TTL_MS) {
    return null
  }
  return session
}

function requireSession(req: Request, res: Response, next: NextFunction): void {
  const session = readSession(req)
  if (!session) {
    res.status(401).json({ error: 'Sign in with your Nimiq wallet first.' })
    return
  }
  ;(req as Request & { session: Session }).session = session
  next()
}

// ---------------------------------------------------------------------------
// Rate limiting: small, in-process, enough to stop a script hammering solve.
// ---------------------------------------------------------------------------

const hits = new Map<string, { count: number; windowStart: number }>()

function rateLimit(limit: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const id = `${req.path}:${req.ip ?? 'unknown'}`
    const now = Date.now()
    const entry = hits.get(id)
    if (!entry || now - entry.windowStart > windowMs) {
      hits.set(id, { count: 1, windowStart: now })
      next()
      return
    }
    entry.count++
    if (entry.count > limit) {
      res.status(429).json({ error: 'Too many requests. Slow down a moment.' })
      return
    }
    next()
  }
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export interface AppOptions {
  /** Directory of the built client. When present it is served alongside the
   *  API, and unknown paths fall through to the app shell rather than a 404. */
  clientDir?: string
}

export function createApp(store: Store, options: AppOptions = {}) {
  const app = express()
  app.use(express.json({ limit: '8kb' }))
  app.use(cors())

  // Static assets are mounted before the routes so a built client is served
  // without the API's catch-all intercepting page requests.
  if (options.clientDir) app.use(express.static(options.clientDir))

  /** Liveness probe. Deliberately does not touch the database: a Supabase
   *  pooler reconnect can exceed a platform health check's timeout even
   *  though the process itself is fine, which would cause needless restarts. */
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true })
  })

  /** Public usage counters, also useful as honest submission data. */
  app.get('/api/stats', async (_req, res) => {
    const [uniquePlayers, totalSolves, playersToday] = await Promise.all([
      store.uniquePlayers(),
      store.totalSolves(),
      store.playersOn(todayUtc()),
    ])
    res.json({ uniquePlayers, totalSolves, today: todayUtc(), playersToday })
  })

  // -- auth ---------------------------------------------------------------

  app.post('/api/auth/challenge', rateLimit(30, 60_000), (_req, res) => {
    res.json(issueChallenge())
  })

  app.post('/api/auth/verify', rateLimit(30, 60_000), async (req, res) => {
    const { nonce, publicKey, signature } = req.body ?? {}
    if (typeof nonce !== 'string' || typeof publicKey !== 'string' || typeof signature !== 'string') {
      res.status(400).json({ error: 'nonce, publicKey and signature are required.' })
      return
    }

    const consumed = consumeChallenge(nonce)
    if (!consumed.ok) {
      res.status(400).json({ error: consumed.reason })
      return
    }

    const verified = verifySignature(challengeMessage(nonce), publicKey, signature)
    if (!verified.ok) {
      res.status(401).json({ error: verified.reason })
      return
    }

    const address = verified.identity.address
    await store.touchPlayer(address, verified.identity.publicKey)
    const token = createSession(address, verified.identity.publicKey)

    res.json({
      token,
      address,
      // Surfaced so the signing format a given wallet build uses is observable.
      framing: verified.identity.framing,
    })
  })

  // -- board --------------------------------------------------------------

  /**
   * Today's board. Par is included deliberately: knowing the target length is
   * the challenge, not a secret, and hiding it would only push players to
   * guess. What stays server-side is the grading.
   */
  app.get('/api/puzzle', async (req, res) => {
    const date = isValidDate(req.query.date) ? req.query.date : todayUtc()
    const puzzle = store.puzzleFor(date)
    const session = readSession(req)

    let startedAt: number | null = null
    let existing = null
    if (session) {
      startedAt = await store.startAttempt(session.address, date)
      const solve = await store.solveFor(session.address, date)
      if (solve) {
        existing = {
          chain: JSON.parse(solve.chain) as number[],
          length: solve.length,
          score: solve.score,
          seconds: solve.seconds,
          rank: await store.rankOf(session.address, date),
        }
      }
    }

    res.json({
      date,
      target: puzzle.target,
      par: puzzle.par,
      parSolutions: puzzle.parSolutions,
      cells: puzzle.cells,
      values: puzzle.values,
      difficulty: dayShape(date).label,
      maxChain: MAX_CHAIN,
      playersToday: await store.playersOn(date),
      startedAt,
      existing,
    })
  })

  // -- solving ------------------------------------------------------------

  app.post('/api/solve', requireSession, rateLimit(60, 60_000), async (req, res) => {
    const { session } = req as Request & { session: Session }
    const { date: rawDate, chain } = req.body ?? {}
    const date = isValidDate(rawDate) ? rawDate : todayUtc()

    // Only today's board is playable. Past boards stay readable but closed,
    // otherwise a late player could farm streaks retroactively.
    if (date !== todayUtc()) {
      res.status(400).json({ error: 'Only today\u2019s board can be solved.' })
      return
    }

    if (await store.solveFor(session.address, date)) {
      res.status(409).json({ error: 'You have already solved today. Come back tomorrow.' })
      return
    }

    const puzzle = store.puzzleFor(date)
    const result = validateChain(puzzle, chain)
    if (!result.ok) {
      res.status(400).json({ error: result.reason })
      return
    }

    // Solve time comes from the server's own record of when the board was
    // first served to this player, never from the client.
    const startedAt = (await store.attemptStartedAt(session.address, date)) ?? Date.now()
    const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000))

    const stored = await store.recordSolve({
      address: session.address,
      date,
      chain: JSON.stringify(chain),
      length: result.length,
      score: result.score,
      seconds,
    })
    if (!stored) {
      res.status(409).json({ error: 'You have already solved today. Come back tomorrow.' })
      return
    }

    res.json({
      length: result.length,
      sum: result.sum,
      score: result.score,
      beatPar: result.beatPar,
      par: puzzle.par,
      seconds,
      rank: await store.rankOf(session.address, date),
      playersToday: await store.playersOn(date),
      stats: await store.statsFor(session.address, todayUtc()),
    })
  })

  // -- leaderboard and profile -------------------------------------------

  app.get('/api/leaderboard', async (req, res) => {
    const date = isValidDate(req.query.date) ? req.query.date : todayUtc()
    const session = readSession(req)
    res.json({
      date,
      par: store.puzzleFor(date).par,
      players: await store.playersOn(date),
      entries: await store.leaderboard(date),
      you: session ? await store.rankOf(session.address, date) : null,
    })
  })

  app.get('/api/me', requireSession, async (req, res) => {
    const { session } = req as Request & { session: Session }
    res.json({
      address: session.address,
      stats: await store.statsFor(session.address, todayUtc()),
      todaySolved: (await store.solveFor(session.address, todayUtc())) !== null,
    })
  })

  // Anything unmatched: API paths get JSON, everything else gets the app
  // shell so a deep link opens the game instead of an error.
  app.use((req, res) => {
    if (req.path.startsWith('/api/') || !options.clientDir) {
      res.status(404).json({ error: 'Not found.' })
      return
    }
    res.sendFile(join(options.clientDir, 'index.html'))
  })

  return app
}
