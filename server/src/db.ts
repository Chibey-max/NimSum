// Database connections.
//
// Production talks to Supabase over the pooled Postgres connection. Tests run
// an embedded Postgres in-process, so they exercise the same SQL rather than a
// stand-in with different semantics.

import type { Sql } from './store'

/**
 * Supabase (or any Postgres) via a connection string.
 *
 * Use the connection *pooler* string from Supabase, not the direct one: free
 * projects sit behind a pooler and a free host will open and drop connections
 * as it sleeps and wakes.
 */
export async function connectPostgres(url: string): Promise<Sql> {
  const { default: postgres } = await import('postgres')
  const sql = postgres(url, {
    // Small pool: a free tier has a low connection ceiling and this app is
    // not connection hungry.
    max: 3,
    idle_timeout: 20,
    connect_timeout: 15,
    // Supabase requires TLS but presents a certificate this client will not
    // chain by default.
    ssl: url.includes('localhost') ? false : 'require',
  })

  return {
    async query<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
      const rows = await sql.unsafe(text, params as never[])
      return rows as unknown as T[]
    },
    async exec(text: string) {
      // simple() lets a single round trip carry several statements.
      await sql.unsafe(text).simple()
    },
    async close() {
      await sql.end({ timeout: 5 })
    },
  }
}

/** Embedded Postgres, used by the test suite. */
export async function connectMemory(): Promise<Sql> {
  const { PGlite } = await import('@electric-sql/pglite')
  const db = await PGlite.create()

  return {
    async query<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
      const result = await db.query(text, params)
      return (result.rows ?? []) as T[]
    },
    async exec(text: string) {
      await db.exec(text)
    },
    async close() {
      await db.close()
    },
  }
}

/**
 * Pick a connection from the environment. Falls back to embedded Postgres so
 * `npm start` works with no configuration, which is useful locally and makes
 * a misconfigured deploy obvious rather than silently broken.
 */
export async function connectFromEnv(): Promise<{ sql: Sql; kind: 'postgres' | 'memory' }> {
  const url = process.env.DATABASE_URL?.trim()
  if (url) return { sql: await connectPostgres(url), kind: 'postgres' }
  return { sql: await connectMemory(), kind: 'memory' }
}
