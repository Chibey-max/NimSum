// Persistence, on Postgres (Supabase in production).
//
// The store talks to a tiny `Sql` interface rather than a specific driver, so
// the same SQL runs against Supabase in production and against an embedded
// Postgres in the tests. There is no second implementation to drift.

import { generatePuzzle, type Puzzle } from './puzzle'

/** Minimal query surface. Production and tests both implement this, and both
 *  speak real Postgres. */
export interface Sql {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>
  /** Runs a script that may contain several statements. Parameterised queries
   *  cannot carry multiple commands, so migrations use this instead. */
  exec(text: string): Promise<void>
  close(): Promise<void>
}

export interface SolveRow {
  address: string
  date: string
  chain: string
  length: number
  score: number
  seconds: number
  created_at: number
}

export interface LeaderboardEntry {
  rank: number
  address: string
  length: number
  score: number
  seconds: number
  beatPar: boolean
}

export interface PlayerStats {
  address: string
  played: number
  parCount: number
  bestScore: number
  currentStreak: number
  bestStreak: number
  totalScore: number
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  address     TEXT PRIMARY KEY,
  public_key  TEXT,
  first_seen  BIGINT NOT NULL,
  last_seen   BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS solves (
  address    TEXT    NOT NULL,
  date       TEXT    NOT NULL,
  chain      TEXT    NOT NULL,
  length     INTEGER NOT NULL,
  score      INTEGER NOT NULL,
  seconds    INTEGER NOT NULL,
  created_at BIGINT  NOT NULL,
  PRIMARY KEY (address, date)
);

CREATE INDEX IF NOT EXISTS solves_by_date ON solves (date, score DESC, seconds ASC);

CREATE TABLE IF NOT EXISTS attempts (
  address    TEXT   NOT NULL,
  date       TEXT   NOT NULL,
  started_at BIGINT NOT NULL,
  PRIMARY KEY (address, date)
);
`

export class Store {
  private sql: Sql
  private puzzleCache = new Map<string, Puzzle>()

  constructor(sql: Sql) {
    this.sql = sql
  }

  async migrate(): Promise<void> {
    await this.sql.exec(SCHEMA)
  }

  async close(): Promise<void> {
    await this.sql.close()
  }

  // -- puzzles ------------------------------------------------------------

  /** Boards are pure functions of the date; cache them per process. */
  puzzleFor(date: string): Puzzle {
    let p = this.puzzleCache.get(date)
    if (!p) {
      p = generatePuzzle(date)
      this.puzzleCache.set(date, p)
    }
    return p
  }

  // -- players ------------------------------------------------------------

  async touchPlayer(address: string, publicKey?: string): Promise<void> {
    const now = Date.now()
    await this.sql.query(
      `INSERT INTO players (address, public_key, first_seen, last_seen)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT (address) DO UPDATE SET
         last_seen  = EXCLUDED.last_seen,
         public_key = COALESCE(EXCLUDED.public_key, players.public_key)`,
      [address, publicKey ?? null, now],
    )
  }

  /** Distinct wallets that have ever solved. The headline usage number. */
  async uniquePlayers(): Promise<number> {
    const rows = await this.sql.query<{ n: string }>(
      `SELECT COUNT(DISTINCT address) AS n FROM solves`,
    )
    return Number(rows[0]?.n ?? 0)
  }

  async totalSolves(): Promise<number> {
    const rows = await this.sql.query<{ n: string }>(`SELECT COUNT(*) AS n FROM solves`)
    return Number(rows[0]?.n ?? 0)
  }

  // -- attempts (server-side clock) ---------------------------------------

  /**
   * Record when a player first opened a board. Solve time is measured from
   * this server timestamp, so a client cannot report a fake fast solve.
   * DO NOTHING on conflict keeps the original start time.
   */
  async startAttempt(address: string, date: string): Promise<number> {
    const now = Date.now()
    await this.sql.query(
      `INSERT INTO attempts (address, date, started_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (address, date) DO NOTHING`,
      [address, date, now],
    )
    return (await this.attemptStartedAt(address, date)) ?? now
  }

  async attemptStartedAt(address: string, date: string): Promise<number | null> {
    const rows = await this.sql.query<{ started_at: string }>(
      `SELECT started_at FROM attempts WHERE address = $1 AND date = $2`,
      [address, date],
    )
    return rows.length ? Number(rows[0].started_at) : null
  }

  // -- solves -------------------------------------------------------------

  async solveFor(address: string, date: string): Promise<SolveRow | null> {
    const rows = await this.sql.query<SolveRow>(
      `SELECT * FROM solves WHERE address = $1 AND date = $2`,
      [address, date],
    )
    if (!rows.length) return null
    const r = rows[0]
    return {
      ...r,
      length: Number(r.length),
      score: Number(r.score),
      seconds: Number(r.seconds),
      created_at: Number(r.created_at),
    }
  }

  /**
   * Returns false when the player already solved that day. Uniqueness is
   * enforced by the primary key rather than by a prior read, so two requests
   * racing cannot both succeed.
   */
  async recordSolve(row: Omit<SolveRow, 'created_at'>): Promise<boolean> {
    const inserted = await this.sql.query<{ address: string }>(
      `INSERT INTO solves (address, date, chain, length, score, seconds, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (address, date) DO NOTHING
       RETURNING address`,
      [row.address, row.date, row.chain, row.length, row.score, row.seconds, Date.now()],
    )
    return inserted.length > 0
  }

  async leaderboard(date: string, limit = 50): Promise<LeaderboardEntry[]> {
    const par = this.puzzleFor(date).par
    const rows = await this.sql.query<{
      address: string
      length: number
      score: number
      seconds: number
    }>(
      `SELECT address, length, score, seconds FROM solves
       WHERE date = $1
       ORDER BY score DESC, seconds ASC, created_at ASC
       LIMIT $2`,
      [date, limit],
    )
    return rows.map((r, i) => ({
      address: r.address,
      length: Number(r.length),
      score: Number(r.score),
      seconds: Number(r.seconds),
      rank: i + 1,
      beatPar: Number(r.length) <= par,
    }))
  }

  async rankOf(address: string, date: string): Promise<number | null> {
    const solve = await this.solveFor(address, date)
    if (!solve) return null
    const rows = await this.sql.query<{ better: string }>(
      `SELECT COUNT(*) AS better FROM solves
       WHERE date = $1
         AND ( score > $2
            OR (score = $2 AND seconds < $3)
            OR (score = $2 AND seconds = $3 AND created_at < $4) )`,
      [date, solve.score, solve.seconds, solve.created_at],
    )
    return Number(rows[0]?.better ?? 0) + 1
  }

  async playersOn(date: string): Promise<number> {
    const rows = await this.sql.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM solves WHERE date = $1`,
      [date],
    )
    return Number(rows[0]?.n ?? 0)
  }

  // -- stats and streaks --------------------------------------------------

  /**
   * Streaks are derived from solve dates on every read rather than kept as a
   * counter, so they cannot drift out of sync with reality.
   */
  async statsFor(address: string, today: string): Promise<PlayerStats> {
    const rows = await this.sql.query<{ date: string; length: number; score: number }>(
      `SELECT date, length, score FROM solves WHERE address = $1 ORDER BY date ASC`,
      [address],
    )

    const dates = rows.map((r) => r.date)
    const parCount = rows.filter((r) => Number(r.length) <= this.puzzleFor(r.date).par).length
    const scores = rows.map((r) => Number(r.score))
    const { current, best } = streaksFrom(dates, today)

    return {
      address,
      played: rows.length,
      parCount,
      bestScore: scores.length ? Math.max(...scores) : 0,
      totalScore: scores.reduce((a, b) => a + b, 0),
      currentStreak: current,
      bestStreak: best,
    }
  }
}

// ---------------------------------------------------------------------------
// Streak maths, exported so it can be tested directly.
// ---------------------------------------------------------------------------

export function dayBefore(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
}

/**
 * A streak is unbroken consecutive days ending today or yesterday. Ending
 * yesterday still counts as live: the player has the rest of today to keep it,
 * and showing it as already broken would be both wrong and discouraging.
 */
export function streaksFrom(dates: string[], today: string): { current: number; best: number } {
  if (dates.length === 0) return { current: 0, best: 0 }
  const set = new Set(dates)

  let best = 0
  for (const d of dates) {
    if (set.has(dayBefore(d))) continue // count each run only from its first day
    let run = 0
    let cursor = d
    while (set.has(cursor)) {
      run++
      cursor = new Date(Date.parse(`${cursor}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
    }
    best = Math.max(best, run)
  }

  let current = 0
  let cursor = set.has(today) ? today : dayBefore(today)
  while (set.has(cursor)) {
    current++
    cursor = dayBefore(cursor)
  }

  return { current, best }
}
