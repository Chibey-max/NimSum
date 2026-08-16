// The target, and the signature of the whole design.
//
// Rather than putting a progress bar next to the number, the number itself is
// the gauge: honey rises inside the glyphs in proportion to your running sum.
// You read "how close am I" and "what am I aiming at" in one glance, which is
// the only question the player is actually asking while tapping.

import { useId } from 'react'

interface Props {
  target: number
  sum: number
  state: 'building' | 'exact' | 'over'
}

export default function TargetMeter({ target, sum, state }: Props) {
  const ratio = target > 0 ? Math.min(1, sum / target) : 0
  const label = String(target)
  // Fill rises from the baseline of the type block.
  const fillY = 100 - ratio * 100
  // Unique per instance: more than one TargetMeter can be mounted at once
  // (the practice archive overlays one on top of the main board's), and SVG
  // ids are global, so a shared id would make one clip the other.
  const uid = useId()
  const clipId = `target-glyphs-${uid}`
  const gradientId = `honey-${uid}`

  return (
    <div className={`target ${state}`}>
      <svg viewBox="0 0 200 110" className="target-svg" role="img" aria-label={`Target ${target}, current sum ${sum}`}>
        <defs>
          <clipPath id={clipId}>
            <text x="100" y="86" textAnchor="middle" className="target-glyph">
              {label}
            </text>
          </clipPath>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--honey-bright)" />
            <stop offset="1" stopColor="var(--honey)" />
          </linearGradient>
        </defs>

        {/* Hollow numerals: the target you are aiming at. */}
        <text x="100" y="86" textAnchor="middle" className="target-glyph outline">
          {label}
        </text>

        {/* The rising fill, clipped to the numerals. */}
        <g clipPath={`url(#${clipId})`}>
          <rect
            x="0"
            width="200"
            y={fillY}
            height="110"
            fill={state === 'over' ? 'var(--coral)' : `url(#${gradientId})`}
            className="target-fill"
          />
        </g>
      </svg>

      <div className="target-readout">
        {state === 'exact' ? (
          <span className="exact-tag">Exact</span>
        ) : (
          <>
            <span className="sum">{sum}</span>
            <span className="of">of {target}</span>
          </>
        )}
      </div>
    </div>
  )
}
