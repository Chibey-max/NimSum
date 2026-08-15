import { useCallback, useEffect, useMemo, useState } from 'react'
import Board from './components/Board'
import TargetMeter from './components/TargetMeter'
import {
  api,
  ApiError,
  getProvider,
  shortAddress,
  signIn,
  storedToken,
  storeToken,
  type LeaderboardEntry,
  type PlayerStats,
  type PuzzleView,
  type SolveResult,
} from './lib/api'

type Phase = 'loading' | 'ready' | 'solved' | 'error'

export default function App() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [puzzle, setPuzzle] = useState<PuzzleView | null>(null)
  const [chain, setChain] = useState<number[]>([])
  const [result, setResult] = useState<SolveResult | null>(null)
  const [stats, setStats] = useState<PlayerStats | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const [board, setBoard] = useState<LeaderboardEntry[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [inWallet, setInWallet] = useState(false)
  const [showRules, setShowRules] = useState(false)

  const signedIn = address !== null

  // -- boot ---------------------------------------------------------------

  const refreshLeaderboard = useCallback(async () => {
    try {
      const b = await api.leaderboard()
      setBoard(b.entries)
    } catch {
      /* leaderboard is supporting information, never blocks play */
    }
  }, [])

  const loadPuzzle = useCallback(async () => {
    const p = await api.puzzle()
    setPuzzle(p)
    if (p.existing) {
      setResult(p.existing)
      setChain(p.existing.chain ?? [])
      setPhase('solved')
    } else {
      setChain([])
      setResult(null)
      setPhase('ready')
    }
  }, [])

  useEffect(() => {
    ;(async () => {
      getProvider().then((p) => setInWallet(p !== null))
      try {
        if (storedToken()) {
          try {
            const me = await api.me()
            setAddress(me.address)
            setStats(me.stats)
          } catch {
            storeToken(null)
          }
        }
        await loadPuzzle()
        refreshLeaderboard()
      } catch (err) {
        setNotice(err instanceof Error ? err.message : 'Could not load today\u2019s board.')
        setPhase('error')
      }
    })()
  }, [loadPuzzle, refreshLeaderboard])

  // -- derived ------------------------------------------------------------

  const sum = useMemo(
    () => (puzzle ? chain.reduce((acc, i) => acc + puzzle.values[i], 0) : 0),
    [chain, puzzle],
  )

  const meterState: 'building' | 'exact' | 'over' = !puzzle
    ? 'building'
    : sum === puzzle.target
      ? 'exact'
      : sum > puzzle.target
        ? 'over'
        : 'building'

  const canSubmit = puzzle !== null && sum === puzzle.target && phase === 'ready' && !busy

  // -- actions ------------------------------------------------------------

  const tap = (i: number) => {
    if (phase !== 'ready') return
    setNotice(null)
    setChain((prev) => {
      if (prev.length > 0 && prev[prev.length - 1] === i) return prev.slice(0, -1)
      if (prev.includes(i)) return prev
      if (puzzle && prev.length >= puzzle.maxChain) return prev
      return [...prev, i]
    })
  }

  const doSignIn = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const { address: addr } = await signIn()
      setAddress(addr)
      const me = await api.me()
      setStats(me.stats)
      await loadPuzzle()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Sign in failed.')
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    if (!puzzle || !canSubmit) return
    if (!signedIn) {
      setNotice('Sign in with your wallet to record this solve.')
      return
    }
    setBusy(true)
    try {
      const res = await api.solve(puzzle.date, chain)
      setResult(res)
      if (res.stats) setStats(res.stats)
      setPhase('solved')
      refreshLeaderboard()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not submit that chain.'
      setNotice(message)
      if (err instanceof ApiError && err.status === 409) {
        await loadPuzzle()
      }
    } finally {
      setBusy(false)
    }
  }

  const share = async () => {
    if (!puzzle || !result) return
    const hexes = '\u2b22'.repeat(result.length)
    const beat = result.length <= (result.par ?? puzzle.par)
    const text =
      `NimSum ${puzzle.date}\n` +
      `${puzzle.target} in ${result.length} ${beat ? '\u2014 par' : `(par ${result.par ?? puzzle.par})`}\n` +
      `${hexes}\n` +
      (stats?.currentStreak ? `${stats.currentStreak} day streak\n` : '')
    try {
      if (navigator.share) {
        await navigator.share({ text })
        return
      }
      await navigator.clipboard.writeText(text)
      setNotice('Result copied.')
    } catch {
      setNotice('Could not share. Long-press to copy instead.')
    }
  }

  // -- render -------------------------------------------------------------

  if (phase === 'loading') {
    return (
      <main className="shell">
        <div className="boot">Loading today\u2019s board</div>
      </main>
    )
  }

  if (phase === 'error' || !puzzle) {
    return (
      <main className="shell">
        <div className="boot">
          <p>{notice ?? 'Could not reach the server.'}</p>
          <button className="btn" onClick={() => location.reload()}>
            Try again
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <span className="name">NimSum</span>
        </div>
        <div className="meta">
          <span className="difficulty">{puzzle.difficulty}</span>
          <span className="date">{puzzle.date}</span>
        </div>
      </header>

      <p className="prompt">
        Link neighbours to make <strong>{puzzle.target}</strong>. Par is{' '}
        <strong>{puzzle.par}</strong> hexes.{' '}
        <button className="link" onClick={() => setShowRules((s) => !s)}>
          {showRules ? 'Hide rules' : 'How to play'}
        </button>
      </p>

      {showRules && (
        <div className="rules">
          <ol>
            <li>Tap any hex to start.</li>
            <li>Tap a touching hex to extend the chain. Each hex can be used once.</li>
            <li>Hit the target exactly. Fewer hexes scores higher.</li>
            <li>Tap the last hex again to step back.</li>
          </ol>
          <p className="footnote">
            Everyone plays the same board today. It changes at midnight UTC, and gets harder
            through the week.
          </p>
        </div>
      )}

      <TargetMeter target={puzzle.target} sum={sum} state={meterState} />

      <Board
        cells={puzzle.cells}
        values={puzzle.values}
        chain={chain}
        locked={phase !== 'ready'}
        onTap={tap}
      />

      {phase === 'ready' && (
        <>
          <div className="chain-strip" aria-live="polite">
            {chain.length === 0 ? (
              <span className="hint">Tap a hex to begin</span>
            ) : (
              chain.map((i, n) => (
                <span key={`${i}-${n}`} className="bead">
                  {puzzle.values[i]}
                </span>
              ))
            )}
          </div>

          {notice && <p className="notice">{notice}</p>}

          <div className="actions">
            <button className="btn ghost" onClick={() => setChain([])} disabled={chain.length === 0}>
              Clear
            </button>
            {signedIn ? (
              <button className="btn primary" onClick={submit} disabled={!canSubmit}>
                {busy
                  ? 'Checking\u2026'
                  : meterState === 'over'
                    ? `Over by ${sum - puzzle.target}`
                    : sum === puzzle.target
                      ? `Submit ${chain.length} hexes`
                      : `Need ${puzzle.target - sum} more`}
              </button>
            ) : (
              <button className="btn primary" onClick={doSignIn} disabled={busy}>
                {busy
                  ? 'Waiting for wallet\u2026'
                  : sum === puzzle.target
                    ? 'Sign in to record this solve'
                    : 'Sign in to record your streak'}
              </button>
            )}
          </div>

          {!signedIn && !inWallet && (
            <p className="footnote">
              Play freely here. Signing in with your wallet is what records the solve and
              keeps your streak; it is a signature, not a payment, and costs nothing.
            </p>
          )}
        </>
      )}

      {phase === 'solved' && result && (
        <section className="result">
          <div className="result-head">
            <span className="score">{result.score}</span>
            <span className="score-label">
              {result.length} hexes{result.beatPar ?? result.length <= puzzle.par ? ', par' : ` (par ${puzzle.par})`}
            </span>
          </div>

          <dl className="result-grid">
            <div>
              <dt>Rank today</dt>
              <dd>{result.rank ?? '\u2014'}</dd>
            </div>
            <div>
              <dt>Solved in</dt>
              <dd>{result.seconds}s</dd>
            </div>
            <div>
              <dt>Streak</dt>
              <dd>{stats?.currentStreak ?? 0}</dd>
            </div>
          </dl>

          <button className="btn primary" onClick={share}>
            Share result
          </button>
          {notice && <p className="notice">{notice}</p>}
          <p className="footnote">New board at midnight UTC.</p>
        </section>
      )}

      <section className="leaderboard">
        <h2>
          Today <span className="count">{puzzle.playersToday || board.length} solved</span>
        </h2>
        {board.length === 0 ? (
          <p className="hint">Nobody has solved today yet. Be first.</p>
        ) : (
          <ol className="ranks">
            {board.slice(0, 10).map((e) => (
              <li key={e.address} className={address === e.address ? 'you' : ''}>
                <span className="rank">{e.rank}</span>
                <span className="who">{shortAddress(e.address)}</span>
                <span className="len">
                  {e.length} hex{e.length === 1 ? '' : 'es'}
                </span>
                <span className="pts">{e.score}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {stats && signedIn && (
        <section className="you-stats">
          <span>{shortAddress(stats.address)}</span>
          <span>
            {stats.played} played \u00b7 {stats.parCount} at par \u00b7 best streak{' '}
            {stats.bestStreak}
          </span>
        </section>
      )}
    </main>
  )
}
