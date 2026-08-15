// The board. Nineteen hexes; tap one to start a chain, then tap a neighbour
// to extend it. Tapping the last hex again backs off by one, which is the
// gesture people reach for before they find an undo button.

import { useMemo } from 'react'
import type { Axial } from '../lib/api'

interface Props {
  cells: Axial[]
  values: number[]
  chain: number[]
  locked: boolean
  onTap: (index: number) => void
}

const SIZE = 34 // hex circumradius
const GAP = 3

function centreOf(a: Axial): { x: number; y: number } {
  // Pointy-top layout: rows interlock horizontally, which suits a portrait
  // phone better than flat-top for a radius-2 board.
  const x = (SIZE + GAP) * Math.sqrt(3) * (a.q + a.r / 2)
  const y = (SIZE + GAP) * 1.5 * a.r
  return { x, y }
}

function corners(cx: number, cy: number, size: number): string {
  const pts: string[] = []
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30)
    pts.push(`${(cx + size * Math.cos(angle)).toFixed(2)},${(cy + size * Math.sin(angle)).toFixed(2)}`)
  }
  return pts.join(' ')
}

function distance(a: Axial, b: Axial): number {
  const dq = a.q - b.q
  const dr = a.r - b.r
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2
}

export default function Board({ cells, values, chain, locked, onTap }: Props) {
  const geometry = useMemo(() => {
    const centres = cells.map(centreOf)
    const xs = centres.map((c) => c.x)
    const ys = centres.map((c) => c.y)
    const pad = SIZE + 6
    const minX = Math.min(...xs) - pad
    const maxX = Math.max(...xs) + pad
    const minY = Math.min(...ys) - pad
    const maxY = Math.max(...ys) + pad
    return {
      centres,
      viewBox: `${minX} ${minY} ${maxX - minX} ${maxY - minY}`,
    }
  }, [cells])

  const head = chain.length > 0 ? chain[chain.length - 1] : null
  const inChain = new Set(chain)

  const isReachable = (i: number): boolean => {
    if (locked) return false
    if (chain.length === 0) return true
    if (i === head) return true // tap the head again to step back
    if (inChain.has(i)) return false
    return distance(cells[i], cells[head!]) === 1
  }

  return (
    <svg className="board" viewBox={geometry.viewBox} role="group" aria-label="Puzzle board">
      {cells.map((cell, i) => {
        const { x, y } = geometry.centres[i]
        const position = chain.indexOf(i)
        const linked = position !== -1
        const isHead = i === head
        const reachable = isReachable(i)

        const classes = [
          'hex',
          linked ? 'linked' : '',
          isHead ? 'head' : '',
          !linked && !reachable ? 'dimmed' : '',
        ]
          .filter(Boolean)
          .join(' ')

        return (
          <g
            key={`${cell.q},${cell.r}`}
            className={classes}
            onClick={() => reachable && onTap(i)}
            role="button"
            tabIndex={reachable ? 0 : -1}
            aria-label={`Hex worth ${values[i]}${linked ? `, position ${position + 1} in your chain` : ''}`}
            aria-pressed={linked}
            onKeyDown={(e) => {
              if (reachable && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault()
                onTap(i)
              }
            }}
          >
            <polygon points={corners(x, y, SIZE)} />
            <text x={x} y={y} dy="0.36em" textAnchor="middle">
              {values[i]}
            </text>
            {linked && (
              <text className="order" x={x} y={y - SIZE * 0.52} dy="0.36em" textAnchor="middle">
                {position + 1}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
