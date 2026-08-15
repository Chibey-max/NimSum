// Deterministic PRNG. The daily board is a pure function of the puzzle date,
// so the server, the client, and any third party auditing the game all derive
// the identical board without needing to trust a stored blob.

/** FNV-1a 32-bit string hash, used to turn a date string into a numeric seed. */
export function seedFromString(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32: small, fast, good enough distribution for puzzle generation. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class Rng {
  private next: () => number

  constructor(seed: number | string) {
    this.next = mulberry32(typeof seed === 'string' ? seedFromString(seed) : seed)
  }

  /** float in [0, 1) */
  float(): number {
    return this.next()
  }

  /** integer in [min, max] inclusive */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)]
  }

  /** Fisher-Yates, returns a new array */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice()
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i)
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }
}
