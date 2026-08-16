// Practice mode. Lets a first-time visitor try more than one puzzle without
// waiting for tomorrow, and lets anyone revisit a day they missed. Nothing
// played here is recorded: /api/practice never touches the store, so this
// cannot be used to farm a streak.

import { useEffect, useMemo, useState } from 'react'
import Board from './Board'
import TargetMeter from './TargetMeter'
import { api, type Axial } from '../lib/api'

interface DayOption {
  date: string
  label: string
}

function pastDays(count: number): DayOption[] {
  const days: DayOption[] = []
  const now = new Date()
  for (let i = 1; i <= count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i))
    const date = d.toISOString().slice(0, 10)
    const label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    days.push({ date, label })
  }
  return days
}

interface PracticeBoard {
  date: string
  target: number
  par: number
  difficulty: string
  cells: Axial[]
  values: number[]
  maxChain: number
}

interface PracticeResult {
  length: number
  score: number
  beatPar: boolean
  par: number
}

export default function Archive({ onClose }: { onClose: () => void }) {
  const days = useMemo(() => pastDays(6), [])
  const [selected, setSelected] = useState<string | null>(null)
  const [board, setBoard] = useState<PracticeBoard | null>(null)
  const [chain, setChain] = useState<number[]>([])
  const [result, setResult] = useState<PracticeResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!selected) return
    setBoard(null)
    setChain([])
    setResult(null)
    setNotice(null)
    api
      .puzzle(selected)
      .then((p) =>
        setBoard({
          date: p.date,
          target: p.target,
          par: p.par,
          difficulty: p.difficulty,
          cells: p.cells,
          values: p.values,
          maxChain: p.maxChain,
        }),
      )
      .catch(() => setNotice('Could not load that board.'))
  }, [selected])

  const sum = board ? chain.reduce((acc, i) => acc + board.values[i], 0) : 0
  const meterState: 'building' | 'exact' | 'over' = !board
    ? 'building'
    : sum === board.target
      ? 'exact'
      : sum > board.target
        ? 'over'
        : 'building'

  const tap = (i: number) => {
    if (!board || result) return
    setChain((prev) => {
      if (prev.length > 0 && prev[prev.length - 1] === i) return prev.slice(0, -1)
      if (prev.includes(i)) return prev
      if (prev.length >= board.maxChain) return prev
      return [...prev, i]
    })
  }

  const submit = async () => {
    if (!board || sum !== board.target) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await api.practice(board.date, chain)
      setResult(res)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not check that chain.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="archive-overlay" role="dialog" aria-label="Practice past boards">
      <div className="archive-panel">
        <div className="archive-head">
          <h2>Practice</h2>
          <button className="link" onClick={onClose}>
            Close
          </button>
        </div>

        {!selected && (
          <>
            <p className="footnote">
              Try a past board any time. These don’t count toward your streak or the
              leaderboard, today’s board is the only one that does.
            </p>
            <ul className="archive-list">
              {days.map((d) => (
                <li key={d.date}>
                  <button className="btn ghost" onClick={() => setSelected(d.date)}>
                    {d.label}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {selected && !board && !notice && <p className="hint">Loading…</p>}
        {selected && notice && !board && <p className="notice">{notice}</p>}

        {selected && board && (
          <>
            <button className="link" onClick={() => setSelected(null)}>
              ← other days
            </button>
            <p className="prompt">
              {board.date} · <strong>{board.difficulty}</strong>. Link neighbours to make{' '}
              <strong>{board.target}</strong>.
            </p>

            <TargetMeter target={board.target} sum={sum} state={meterState} />

            <Board
              cells={board.cells}
              values={board.values}
              chain={chain}
              locked={result !== null}
              onTap={tap}
            />

            {!result && (
              <div className="actions">
                <button className="btn ghost" onClick={() => setChain([])} disabled={chain.length === 0}>
                  Clear
                </button>
                <button className="btn primary" onClick={submit} disabled={sum !== board.target || busy}>
                  {busy ? 'Checking…' : sum === board.target ? `Check ${chain.length} hexes` : 'Reach the target'}
                </button>
              </div>
            )}

            {notice && <p className="notice">{notice}</p>}

            {result && (
              <section className="result">
                <div className="result-head">
                  <span className="score">{result.score}</span>
                  <span className="score-label">
                    {result.length} hexes{result.beatPar ? ', par' : ` (par ${result.par})`}
                  </span>
                </div>
                <button className="btn ghost" onClick={() => setSelected(null)}>
                  Try another day
                </button>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
