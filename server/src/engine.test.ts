// Engine tests. These run the real generator and the real solver over many
// days of boards, because the whole game rests on the claim that every
// published board is solvable and that par is genuinely the best answer.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { areAdjacent, boardCells, key, neighbours } from './hex'
import { Rng } from './rng'
import { dayShape, generatePuzzle, scoreChain, solve, validateChain, MAX_CHAIN } from './puzzle'

function adjacencyOf(cells: ReturnType<typeof boardCells>): number[][] {
  const idx = new Map(cells.map((c, i) => [key(c), i]))
  return cells.map((c) =>
    neighbours(c)
      .map((n) => idx.get(key(n)))
      .filter((i): i is number => i !== undefined),
  )
}

/** Independent brute-force search, written differently from the solver under
 *  test, used to confirm the solver's par is really the minimum. */
function bruteForceMin(values: number[], adj: number[][], target: number): number {
  let best = Infinity
  const used = new Array(values.length).fill(false)
  const walk = (node: number, sum: number, len: number) => {
    const next = sum + values[node]
    if (next > target || len > MAX_CHAIN) return
    if (next === target) {
      best = Math.min(best, len)
      return
    }
    used[node] = true
    for (const nb of adj[node]) if (!used[nb]) walk(nb, next, len + 1)
    used[node] = false
  }
  for (let i = 0; i < values.length; i++) walk(i, 0, 1)
  return best
}

test('board has 19 cells and correct adjacency', () => {
  const cells = boardCells(2)
  assert.equal(cells.length, 19)
  // Centre touches six neighbours, all on the board.
  const adj = adjacencyOf(cells)
  const centreIndex = cells.findIndex((c) => c.q === 0 && c.r === 0)
  assert.equal(adj[centreIndex].length, 6)
  // Every cell has between 3 and 6 neighbours on a hexagonal board.
  for (const list of adj) {
    assert.ok(list.length >= 3 && list.length <= 6, `bad neighbour count ${list.length}`)
  }
})

test('rng is deterministic and seed-sensitive', () => {
  const a = new Rng('chain:2026-08-20:0')
  const b = new Rng('chain:2026-08-20:0')
  const c = new Rng('chain:2026-08-21:0')
  const seqA = Array.from({ length: 20 }, () => a.float())
  const seqB = Array.from({ length: 20 }, () => b.float())
  const seqC = Array.from({ length: 20 }, () => c.float())
  assert.deepEqual(seqA, seqB, 'same seed must give same sequence')
  assert.notDeepEqual(seqA, seqC, 'different date must give a different board')
})

test('puzzle generation is deterministic for a date', () => {
  const p1 = generatePuzzle('2026-08-20')
  const p2 = generatePuzzle('2026-08-20')
  assert.deepEqual(p1.values, p2.values)
  assert.equal(p1.target, p2.target)
  assert.equal(p1.par, p2.par)
})

test('every generated board over 60 days matches its day-of-week difficulty', () => {
  const start = Date.UTC(2026, 7, 17)
  for (let day = 0; day < 60; day++) {
    const date = new Date(start + day * 86400000).toISOString().slice(0, 10)
    const p = generatePuzzle(date)
    const shape = dayShape(date)

    assert.equal(p.values.length, 19)
    assert.ok(p.target > 0)
    assert.ok(p.par >= 2 && p.par <= MAX_CHAIN, `${date}: par ${p.par} out of range`)
    assert.ok(p.parSolutions >= 1, `${date}: board has no solution`)

    // The contract that makes the week feel different day to day.
    assert.equal(p.par, shape.par, `${date} (${shape.label}): par ${p.par}, wanted ${shape.par}`)
    assert.ok(
      p.parSolutions <= shape.maxWays,
      `${date} (${shape.label}): ${p.parSolutions} shortest chains, cap is ${shape.maxWays}`,
    )
  }
})

test('difficulty genuinely varies across a week', () => {
  const start = Date.UTC(2026, 7, 17)
  const pars = new Set<number>()
  for (let day = 0; day < 7; day++) {
    const date = new Date(start + day * 86400000).toISOString().slice(0, 10)
    pars.add(generatePuzzle(date).par)
  }
  assert.ok(pars.size >= 3, `expected varied par across a week, got ${[...pars].join(',')}`)
})

test('solver par matches an independent brute force search', () => {
  const cells = boardCells(2)
  const adj = adjacencyOf(cells)
  for (let day = 0; day < 25; day++) {
    const date = new Date(Date.UTC(2026, 7, 17) + day * 86400000).toISOString().slice(0, 10)
    const p = generatePuzzle(date)
    const mine = solve(p.values, adj, p.target).par
    const theirs = bruteForceMin(p.values, adj, p.target)
    assert.equal(mine, theirs, `${date}: solver said ${mine}, brute force said ${theirs}`)
  }
})

test('a par-length chain actually exists and validates', () => {
  const cells = boardCells(2)
  const adj = adjacencyOf(cells)
  const p = generatePuzzle('2026-08-20')

  // Find one concrete shortest chain by search, then run it through validation.
  let found: number[] | null = null
  const used = new Array(p.values.length).fill(false)
  const path: number[] = []
  const walk = (node: number, sum: number) => {
    if (found || path.length >= p.par) return
    path.push(node)
    used[node] = true
    const next = sum + p.values[node]
    if (next === p.target && path.length === p.par) {
      found = path.slice()
    } else if (next < p.target) {
      for (const nb of adj[node]) if (!used[nb]) walk(nb, next)
    }
    used[node] = false
    path.pop()
  }
  for (let i = 0; i < p.values.length && !found; i++) walk(i, 0)

  assert.ok(found, 'expected to find a chain of par length')
  const result = validateChain(p, found!)
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.length, p.par)
    assert.equal(result.sum, p.target)
    assert.equal(result.score, 1000)
    assert.equal(result.beatPar, true)
  }
})

test('validation rejects malformed chains', () => {
  const p = generatePuzzle('2026-08-20')
  const cells = p.cells

  // Empty
  assert.equal(validateChain(p, []).ok, false)

  // Out of range index
  assert.equal(validateChain(p, [999]).ok, false)

  // Repeated hex
  const centre = cells.findIndex((c) => c.q === 0 && c.r === 0)
  const nb = cells.findIndex((c) => areAdjacent(cells[centre], c))
  assert.equal(validateChain(p, [centre, nb, centre]).ok, false)

  // Non-adjacent hops: find two cells that do not touch
  let far = -1
  for (let i = 0; i < cells.length; i++) {
    if (!areAdjacent(cells[centre], cells[i]) && i !== centre) {
      far = i
      break
    }
  }
  assert.notEqual(far, -1)
  assert.equal(validateChain(p, [centre, far]).ok, false)

  // Wrong sum: a single hex that is not the target
  const single = p.values.findIndex((v) => v !== p.target)
  assert.equal(validateChain(p, [single]).ok, false)
})

test('scoring falls off past par and never drops below the floor', () => {
  assert.equal(scoreChain(4, 4), 1000)
  assert.equal(scoreChain(4, 5), 880)
  assert.equal(scoreChain(4, 6), 760)
  assert.equal(scoreChain(4, 20), 200)
  assert.ok(scoreChain(4, 4) > scoreChain(4, 5))
})
