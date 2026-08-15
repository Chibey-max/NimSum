// NimSum puzzle engine.
//
// A board is 19 hexes, each holding a value. The player links a chain of
// adjacent hexes whose values sum to exactly the day's target. Every hex may
// be used at most once and each hex must touch the previous one.
//
// Par is the shortest chain that reaches the target, found by exhaustive
// search at generation time. Scoring is relative to par, so a board is only
// published once we know it is solvable and know the best possible answer.

import { Rng } from './rng'
import { areAdjacent, boardCells, key, neighbours, type Axial } from './hex'

export const BOARD_RADIUS = 2
export const MAX_CHAIN = 9

export interface Puzzle {
  /** ISO date, YYYY-MM-DD, in UTC. Identifies the daily board. */
  date: string
  /** Cell values in the canonical order returned by boardCells(). */
  values: number[]
  /** Cell coordinates, same order as values. */
  cells: Axial[]
  target: number
  /** Length of the shortest valid chain. */
  par: number
  /** How many distinct shortest chains exist (direction-collapsed). */
  parSolutions: number
}

export interface ValidationOk {
  ok: true
  length: number
  sum: number
  score: number
  beatPar: boolean
}

export interface ValidationError {
  ok: false
  reason: string
}

export type Validation = ValidationOk | ValidationError

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Value distribution. Small numbers dominate so that chains need several hops
 * (a board full of 9s would make every puzzle a two-hex answer), with a few
 * larger values to create shortcuts worth hunting for.
 */
function rollValue(rng: Rng): number {
  const roll = rng.float()
  if (roll < 0.34) return rng.int(1, 3)
  if (roll < 0.72) return rng.int(4, 6)
  return rng.int(7, 9)
}

function indexMap(cells: Axial[]): Map<string, number> {
  const m = new Map<string, number>()
  cells.forEach((c, i) => m.set(key(c), i))
  return m
}

/** Adjacency as index lists, precomputed once per board. */
function buildAdjacency(cells: Axial[]): number[][] {
  const idx = indexMap(cells)
  return cells.map((c) =>
    neighbours(c)
      .map((n) => idx.get(key(n)))
      .filter((i): i is number => i !== undefined),
  )
}

/**
 * Exhaustive search for the shortest chain summing to `target`.
 * Returns the minimum length and the number of distinct chains at that length.
 * Chains are direction-collapsed: a path and its reverse count once.
 */
export function solve(
  values: number[],
  adjacency: number[][],
  target: number,
  maxLength = MAX_CHAIN,
): { par: number; count: number } {
  let best = Infinity
  let count = 0
  const path: number[] = []
  const used = new Array(values.length).fill(false)

  const visit = (node: number, sum: number) => {
    // Prune: cannot improve on a shorter solution already found.
    if (path.length >= best) return
    if (sum > target) return

    path.push(node)
    used[node] = true
    const nextSum = sum + values[node]

    if (nextSum === target) {
      if (path.length < best) {
        best = path.length
        count = 1
      } else if (path.length === best) {
        count++
      }
    } else if (nextSum < target && path.length < maxLength) {
      for (const nb of adjacency[node]) {
        if (!used[nb]) visit(nb, nextSum)
      }
    }

    used[node] = false
    path.pop()
  }

  for (let i = 0; i < values.length; i++) visit(i, 0)

  if (best === Infinity) return { par: 0, count: 0 }
  // Each chain of length >= 2 was walked in both directions.
  return { par: best, count: best >= 2 ? count / 2 : count }
}

export interface SumProfile {
  /** shortest chain length that reaches this sum */
  minLen: number
  /** how many distinct shortest chains reach it, direction-collapsed */
  ways: number
}

/**
 * Walk every simple chain on the board up to `maxLength` once, recording for
 * each reachable sum the shortest chain that reaches it and how many such
 * chains exist. One traversal answers "what is par?" for every possible
 * target, which lets the generator pick a target it knows the shape of
 * instead of guessing one and re-solving.
 */
export function analyzeBoard(
  values: number[],
  adjacency: number[][],
  maxLength = MAX_CHAIN,
): Map<number, SumProfile> {
  const profile = new Map<number, SumProfile>()
  const used = new Array(values.length).fill(false)

  const record = (sum: number, len: number) => {
    const seen = profile.get(sum)
    if (!seen || len < seen.minLen) {
      profile.set(sum, { minLen: len, ways: 1 })
    } else if (len === seen.minLen) {
      seen.ways++
    }
  }

  const walk = (node: number, sum: number, len: number) => {
    const nextSum = sum + values[node]
    const nextLen = len + 1
    record(nextSum, nextLen)
    if (nextLen >= maxLength) return
    used[node] = true
    for (const nb of adjacency[node]) {
      if (!used[nb]) walk(nb, nextSum, nextLen)
    }
    used[node] = false
  }

  for (let i = 0; i < values.length; i++) walk(i, 0, 0)

  // Chains of length >= 2 were walked from both ends.
  for (const [sum, p] of profile) {
    if (p.minLen >= 2) profile.set(sum, { ...p, ways: p.ways / 2 })
  }
  return profile
}

/**
 * Difficulty curve across the week, in the tradition of daily crosswords:
 * Monday eases you in, the weekend bites. `par` is the chain length required
 * and `maxWays` caps how many different shortest chains exist, which is what
 * actually decides whether par feels findable or hard-won.
 */
export interface DayShape {
  par: number
  maxWays: number
  label: string
}

const WEEK: readonly DayShape[] = [
  { par: 4, maxWays: 14, label: 'Gentle' }, // Sunday
  { par: 4, maxWays: 8, label: 'Gentle' }, // Monday
  { par: 5, maxWays: 12, label: 'Steady' }, // Tuesday
  { par: 5, maxWays: 8, label: 'Steady' }, // Wednesday
  { par: 6, maxWays: 10, label: 'Tricky' }, // Thursday
  { par: 6, maxWays: 6, label: 'Tricky' }, // Friday
  { par: 7, maxWays: 6, label: 'Brutal' }, // Saturday
]

export function dayShape(date: string): DayShape {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay()
  return WEEK[dow]
}

/**
 * Generate the board for a given date. Deterministic: same date in, same
 * board out, on any machine.
 *
 * The search is the interesting part. A board is only accepted when its
 * shortest chain is exactly the length the day calls for and when there are
 * few enough shortest chains that finding one is an achievement rather than
 * an accident. Boards that are too generous get thrown away.
 */
export function generatePuzzle(date: string): Puzzle {
  const cells = boardCells(BOARD_RADIUS)
  const adjacency = buildAdjacency(cells)
  const shape = dayShape(date)

  let fallback: Puzzle | null = null
  let fallbackMiss = Infinity

  for (let salt = 0; salt < 200; salt++) {
    const rng = new Rng(`chain:${date}:${salt}`)
    const values = cells.map(() => rollValue(rng))
    const profile = analyzeBoard(values, adjacency)

    // Every target that hits the day's shape exactly. Sorted for determinism,
    // then one is chosen by the same seeded rng so boards do not all settle on
    // the smallest qualifying target.
    const exact: number[] = []
    for (const [sum, p] of profile) {
      if (p.minLen === shape.par && p.ways >= 1 && p.ways <= shape.maxWays) exact.push(sum)
    }
    if (exact.length > 0) {
      exact.sort((a, b) => a - b)
      const target = rng.pick(exact)
      const p = profile.get(target)!
      return { date, values, cells, target, par: p.minLen, parSolutions: p.ways }
    }

    // Track the nearest miss in case no board this week can hit the shape.
    for (const [sum, p] of profile) {
      if (p.ways > shape.maxWays || p.minLen < 3) continue
      const miss = Math.abs(p.minLen - shape.par)
      if (miss < fallbackMiss) {
        fallbackMiss = miss
        fallback = { date, values, cells, target: sum, par: p.minLen, parSolutions: p.ways }
      }
    }
  }

  if (fallback) return fallback

  // Last resort: publish any solvable board rather than miss a day.
  const rng = new Rng(`chain:${date}:last`)
  const values = cells.map(() => rollValue(rng))
  const profile = analyzeBoard(values, adjacency)
  const [target, p] = [...profile.entries()].sort((a, b) => b[1].minLen - a[1].minLen)[0]
  return { date, values, cells, target, par: p.minLen, parSolutions: p.ways }
}

// ---------------------------------------------------------------------------
// Validation and scoring
// ---------------------------------------------------------------------------

/**
 * Check a submitted chain against the board. The server never trusts a score
 * sent by the client; it recomputes from the raw cell indices.
 */
export function validateChain(puzzle: Puzzle, chain: number[]): Validation {
  if (!Array.isArray(chain) || chain.length === 0) {
    return { ok: false, reason: 'Chain is empty.' }
  }
  if (chain.length > MAX_CHAIN) {
    return { ok: false, reason: `Chain is longer than ${MAX_CHAIN} hexes.` }
  }
  if (chain.some((i) => !Number.isInteger(i) || i < 0 || i >= puzzle.values.length)) {
    return { ok: false, reason: 'Chain refers to a hex that is not on the board.' }
  }
  if (new Set(chain).size !== chain.length) {
    return { ok: false, reason: 'A hex can only be used once.' }
  }
  for (let i = 1; i < chain.length; i++) {
    if (!areAdjacent(puzzle.cells[chain[i - 1]], puzzle.cells[chain[i]])) {
      return { ok: false, reason: 'Every hex must touch the one before it.' }
    }
  }

  const sum = chain.reduce((acc, i) => acc + puzzle.values[i], 0)
  if (sum !== puzzle.target) {
    return { ok: false, reason: `Chain sums to ${sum}, not ${puzzle.target}.` }
  }

  return {
    ok: true,
    length: chain.length,
    sum,
    score: scoreChain(puzzle.par, chain.length),
    beatPar: chain.length <= puzzle.par,
  }
}

/**
 * Score is a function of how close the chain is to par. Matching par is a
 * clean 1000; every extra hex costs 120, with a floor so that solving at all
 * is always worth more than not solving.
 */
export function scoreChain(par: number, length: number): number {
  const over = Math.max(0, length - par)
  return Math.max(200, 1000 - over * 120)
}

/** The board as the client needs it: no par leak that would spoil the hunt. */
export function publicPuzzle(p: Puzzle) {
  return {
    date: p.date,
    target: p.target,
    par: p.par,
    cells: p.cells,
    values: p.values,
  }
}
