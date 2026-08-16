// Renders a shareable result card as a PNG. Canvas-drawn so it works offline
// and needs no server round trip; the visual language mirrors styles.css.

const INK = '#14162b'
const INK_2 = '#1b1e3a'
const SURFACE = '#212648'
const HEX_EDGE = '#383e70'
const HONEY = '#f0b429'
const HONEY_BRIGHT = '#ffd25f'
const BONE = '#edebe3'
const MUTED = '#8c90b4'

export interface ShareCardInput {
  date: string
  target: number
  length: number
  par: number
  score: number
  beatPar: boolean
  streak: number
}

function drawHex(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6
    const x = cx + r * Math.cos(angle)
    const y = cy + r * Math.sin(angle)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

export async function renderShareCard(input: ShareCardInput): Promise<Blob> {
  if (typeof document !== 'undefined' && document.fonts) {
    await document.fonts.ready
  }

  const width = 640
  const height = 800
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not supported here.')

  // ground
  const bg = ctx.createLinearGradient(0, 0, 0, height)
  bg.addColorStop(0, INK_2)
  bg.addColorStop(1, INK)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, width, height)

  // brand
  ctx.fillStyle = HONEY
  ctx.beginPath()
  drawHex(ctx, 56, 64, 18)
  ctx.fill()
  ctx.fillStyle = BONE
  ctx.font = '600 30px "Bricolage Grotesque", sans-serif'
  ctx.textBaseline = 'middle'
  ctx.fillText('NimSum', 90, 66)

  ctx.fillStyle = MUTED
  ctx.font = '400 20px "Martian Mono", monospace'
  ctx.textAlign = 'right'
  ctx.fillText(input.date, width - 48, 66)
  ctx.textAlign = 'left'

  // target, the signature numeral
  ctx.textAlign = 'center'
  ctx.fillStyle = HONEY_BRIGHT
  ctx.font = '700 160px "Bricolage Grotesque", sans-serif'
  ctx.fillText(String(input.target), width / 2, 260)

  ctx.fillStyle = MUTED
  ctx.font = '500 22px "Inter Tight", sans-serif'
  ctx.fillText('the target', width / 2, 350)

  // chain of hexes, one per length
  const hexR = 26
  const gap = hexR * 2.1
  const total = input.length
  const startX = width / 2 - ((total - 1) * gap) / 2
  const chainY = 460
  for (let i = 0; i < total; i++) {
    const cx = startX + i * gap
    ctx.fillStyle = SURFACE
    ctx.strokeStyle = HEX_EDGE
    ctx.lineWidth = 2
    drawHex(ctx, cx, chainY, hexR)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = HONEY
    ctx.beginPath()
    ctx.arc(cx, chainY, 4, 0, Math.PI * 2)
    ctx.fill()
  }

  // stat row
  ctx.textAlign = 'center'
  const statY = 560
  const stats: [string, string][] = [
    [String(input.length), input.length === 1 ? 'hex' : 'hexes'],
    [String(input.score), 'score'],
    [String(input.streak), input.streak === 1 ? 'day streak' : 'day streak'],
  ]
  const colWidth = width / stats.length
  stats.forEach(([value, label], i) => {
    const cx = colWidth * i + colWidth / 2
    ctx.fillStyle = BONE
    ctx.font = '700 44px "Bricolage Grotesque", sans-serif'
    ctx.fillText(value, cx, statY)
    ctx.fillStyle = MUTED
    ctx.font = '500 18px "Inter Tight", sans-serif'
    ctx.fillText(label, cx, statY + 34)
  })

  // par badge
  if (input.beatPar) {
    ctx.fillStyle = HONEY
    ctx.font = '600 24px "Inter Tight", sans-serif'
    ctx.fillText('✓ matched par', width / 2, 630)
  } else {
    ctx.fillStyle = MUTED
    ctx.font = '500 22px "Inter Tight", sans-serif'
    ctx.fillText(`par was ${input.par}`, width / 2, 630)
  }

  // footer
  ctx.fillStyle = MUTED
  ctx.font = '400 18px "Martian Mono", monospace'
  ctx.fillText('nimsum.onrender.com · a new board every day', width / 2, height - 48)

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Could not render the share card.'))
    }, 'image/png')
  })
}
