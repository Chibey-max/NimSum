// Talking to the server, and proving who you are.

import { init as initMiniApp, type NimiqProvider } from '@nimiq/mini-app-sdk'

export interface Axial {
  q: number
  r: number
}

export interface PuzzleView {
  date: string
  target: number
  par: number
  parSolutions: number
  cells: Axial[]
  values: number[]
  difficulty: string
  maxChain: number
  playersToday: number
  startedAt: number | null
  existing: SolveResult | null
}

export interface SolveResult {
  chain?: number[]
  length: number
  score: number
  seconds: number
  rank: number | null
  beatPar?: boolean
  par?: number
  playersToday?: number
  stats?: PlayerStats
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

export interface LeaderboardEntry {
  rank: number
  address: string
  length: number
  score: number
  seconds: number
  beatPar: boolean
}

const TOKEN_KEY = 'chain.session'

export function storedToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function storeToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = storedToken()
  const res = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  })
  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new ApiError(res.status, 'The server sent something unreadable.')
  }
  if (!res.ok) {
    const message =
      typeof body === 'object' && body && 'error' in body
        ? String((body as { error: unknown }).error)
        : 'Something went wrong.'
    if (res.status === 401) storeToken(null)
    throw new ApiError(res.status, message)
  }
  return body as T
}

export const api = {
  puzzle: (date?: string) =>
    request<PuzzleView>(`/api/puzzle${date ? `?date=${date}` : ''}`),
  solve: (date: string, chain: number[]) =>
    request<SolveResult>('/api/solve', {
      method: 'POST',
      body: JSON.stringify({ date, chain }),
    }),
  leaderboard: (date?: string) =>
    request<{
      date: string
      par: number
      players: number
      entries: LeaderboardEntry[]
      you: number | null
    }>(`/api/leaderboard${date ? `?date=${date}` : ''}`),
  me: () => request<{ address: string; stats: PlayerStats; todaySolved: boolean }>('/api/me'),
  practice: (date: string, chain: number[]) =>
    request<{ length: number; sum: number; score: number; beatPar: boolean; par: number }>(
      '/api/practice',
      { method: 'POST', body: JSON.stringify({ date, chain }) },
    ),
  stats: () =>
    request<{ uniquePlayers: number; totalSolves: number; today: string; playersToday: number }>(
      '/api/stats',
    ),
}

// ---------------------------------------------------------------------------
// Nimiq Pay
// ---------------------------------------------------------------------------

let providerPromise: Promise<NimiqProvider | null> | null = null

/** Resolve the injected provider, or null when not running inside Nimiq Pay. */
export function getProvider(): Promise<NimiqProvider | null> {
  providerPromise ??= (async () => {
    if (typeof window !== 'undefined' && window.nimiq) return window.nimiq
    try {
      return await initMiniApp({ timeout: 3000 })
    } catch {
      return null
    }
  })()
  return providerPromise
}

export interface SignInResult {
  address: string
  framing: string
}

/**
 * Ask the wallet to sign a server challenge, then exchange the signature for
 * a session. The address the server returns is derived from the signing key,
 * so it is the wallet's word, not ours.
 */
export async function signIn(): Promise<SignInResult> {
  const provider = await getProvider()
  if (!provider) {
    throw new Error('Open NimSum inside Nimiq Pay to sign in with your wallet.')
  }

  const challenge = await request<{ nonce: string; message: string }>('/api/auth/challenge', {
    method: 'POST',
  })

  const signed = await provider.sign(challenge.message)
  if (!signed || typeof signed !== 'object' || !('signature' in signed)) {
    const reason =
      signed && typeof signed === 'object' && 'error' in signed
        ? String((signed as { error?: { message?: string } }).error?.message ?? 'Signing was declined.')
        : 'Signing was declined.'
    throw new Error(reason)
  }

  const { publicKey, signature } = signed as { publicKey: string; signature: string }
  const verified = await request<{ token: string; address: string; framing: string }>(
    '/api/auth/verify',
    {
      method: 'POST',
      body: JSON.stringify({ nonce: challenge.nonce, publicKey, signature }),
    },
  )

  storeToken(verified.token)
  return { address: verified.address, framing: verified.framing }
}

export function shortAddress(address: string): string {
  const clean = address.replace(/\s/g, '')
  return `${clean.slice(0, 6)}\u2026${clean.slice(-4)}`
}
