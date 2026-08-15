// Hex grid in axial coordinates (q, r).
// The board is a hexagon of hexagons: every cell within `radius` steps of the
// centre. Radius 2 gives 19 cells, which is the size that fits a phone screen
// with tap targets big enough for a thumb.

export interface Axial {
  q: number
  r: number
}

/** The six axial directions, in clockwise order starting from east. */
export const DIRECTIONS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]

export function key(a: Axial): string {
  return `${a.q},${a.r}`
}

export function parseKey(k: string): Axial {
  const [q, r] = k.split(',').map(Number)
  return { q, r }
}

export function equals(a: Axial, b: Axial): boolean {
  return a.q === b.q && a.r === b.r
}

/** Cube distance between two axial coordinates. */
export function distance(a: Axial, b: Axial): number {
  const dq = a.q - b.q
  const dr = a.r - b.r
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2
}

export function neighbours(a: Axial): Axial[] {
  return DIRECTIONS.map((d) => ({ q: a.q + d.q, r: a.r + d.r }))
}

export function areAdjacent(a: Axial, b: Axial): boolean {
  return distance(a, b) === 1
}

/** All cells of a hexagonal board of the given radius, centre first. */
export function boardCells(radius: number): Axial[] {
  const cells: Axial[] = []
  for (let q = -radius; q <= radius; q++) {
    const rMin = Math.max(-radius, -q - radius)
    const rMax = Math.min(radius, -q + radius)
    for (let r = rMin; r <= rMax; r++) {
      cells.push({ q, r })
    }
  }
  // Sort by ring then angle so the ordering is stable and readable.
  cells.sort((a, b) => {
    const da = distance(a, { q: 0, r: 0 })
    const db = distance(b, { q: 0, r: 0 })
    if (da !== db) return da - db
    return Math.atan2(a.r, a.q) - Math.atan2(b.r, b.q)
  })
  return cells
}

/** Pixel centre of a hex for flat-top rendering, given a size (circumradius). */
export function toPixel(a: Axial, size: number): { x: number; y: number } {
  const x = size * (1.5 * a.q)
  const y = size * (Math.sqrt(3) * (a.r + a.q / 2))
  return { x, y }
}

/** Corner points of a flat-top hex centred at (cx, cy). */
export function hexCorners(cx: number, cy: number, size: number): string {
  const pts: string[] = []
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i)
    pts.push(`${(cx + size * Math.cos(angle)).toFixed(2)},${(cy + size * Math.sin(angle)).toFixed(2)}`)
  }
  return pts.join(' ')
}
