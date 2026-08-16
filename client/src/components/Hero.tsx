// The pitch for someone who did not arrive through Nimiq Pay: a shared link,
// a Skool post, a browser tab. Anyone already inside the wallet skips this
// entirely and lands straight on the board. The centerpiece is not a mockup:
// it is the same TargetMeter component showing today's real, live target, so
// the pitch and the product are never two different things.

import TargetMeter from './TargetMeter'

interface Props {
  target: number
  playersToday: number
  onPlay: () => void
}

export default function Hero({ target, playersToday, onPlay }: Props) {
  return (
    <section className="hero">
      <p className="hero-eyebrow">A new number, every day</p>

      <TargetMeter target={target} sum={0} state="building" />

      <p className="hero-sub">
        Link touching hexes until they sum to today's number. Fewer hexes score higher, and
        everyone plays the same board.
      </p>

      <button className="btn primary hero-cta" onClick={onPlay}>
        Play today's board
      </button>

      <p className="hero-stat">
        {playersToday > 0
          ? `${playersToday} ${playersToday === 1 ? 'person has' : 'people have'} solved today already`
          : 'Be the first to solve today'}
      </p>
    </section>
  )
}
