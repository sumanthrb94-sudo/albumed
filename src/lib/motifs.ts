/* Canvas motif painters — mandala, paisley, marigold garland, rangoli,
   kolam, diya, confetti, pearl. All draw in a local coordinate space and
   take a size `s` so they scale with the page. */
import type { MotifKind, Theme } from './themes'

type Ctx = CanvasRenderingContext2D

function petalRing(ctx: Ctx, s: number, petals: number, inner: number, outer: number) {
  ctx.beginPath()
  for (let i = 0; i < petals; i++) {
    const a0 = (i / petals) * Math.PI * 2
    const a2 = ((i + 1) / petals) * Math.PI * 2
    ctx.moveTo(Math.cos(a0) * inner * s, Math.sin(a0) * inner * s)
    ctx.bezierCurveTo(
      Math.cos(a0) * outer * s,
      Math.sin(a0) * outer * s,
      Math.cos(a2) * outer * s,
      Math.sin(a2) * outer * s,
      Math.cos(a2) * inner * s,
      Math.sin(a2) * inner * s,
    )
  }
  ctx.stroke()
}

/** Quarter mandala anchored at the origin, opening into +x/+y. */
export function mandalaCorner(ctx: Ctx, s: number, theme: Theme) {
  ctx.save()
  ctx.strokeStyle = theme.palette.gold
  ctx.lineWidth = Math.max(0.6, s * 0.014)
  ctx.globalAlpha = 0.95
  for (const r of [0.45, 0.68, 0.95]) {
    ctx.beginPath()
    ctx.arc(0, 0, r * s, 0, Math.PI / 2)
    ctx.stroke()
  }
  ctx.globalAlpha = 0.7
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2)
    ctx.beginPath()
    ctx.moveTo(Math.cos(a) * 0.45 * s, Math.sin(a) * 0.45 * s)
    ctx.lineTo(Math.cos(a) * 0.68 * s, Math.sin(a) * 0.68 * s)
    ctx.stroke()
  }
  ctx.fillStyle = theme.palette.accent
  ctx.globalAlpha = 0.55
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2)
    ctx.beginPath()
    ctx.arc(Math.cos(a) * 0.82 * s, Math.sin(a) * 0.82 * s, s * 0.035, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** Full mandala medallion centred on the origin. */
export function mandala(ctx: Ctx, s: number, theme: Theme, alpha = 1) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = theme.palette.gold
  ctx.lineWidth = Math.max(0.5, s * 0.008)
  ctx.beginPath()
  ctx.arc(0, 0, s * 0.18, 0, Math.PI * 2)
  ctx.stroke()
  petalRing(ctx, s, 12, 0.22, 0.42)
  petalRing(ctx, s, 16, 0.5, 0.72)
  ctx.beginPath()
  ctx.arc(0, 0, s * 0.9, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = theme.palette.gold
  ctx.beginPath()
  ctx.arc(0, 0, s * 0.07, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** A single ambi / paisley pointing up. */
export function paisley(ctx: Ctx, s: number, theme: Theme) {
  ctx.save()
  ctx.strokeStyle = theme.palette.accent
  ctx.fillStyle = theme.palette.accentSoft
  ctx.lineWidth = Math.max(0.6, s * 0.05)
  ctx.globalAlpha = 0.9
  ctx.beginPath()
  ctx.moveTo(0, -s)
  ctx.bezierCurveTo(s * 0.85, -s * 0.45, s * 0.7, s * 0.6, 0, s * 0.55)
  ctx.bezierCurveTo(-s * 0.55, s * 0.5, -s * 0.5, -s * 0.35, 0, -s)
  ctx.stroke()
  ctx.globalAlpha = 0.25
  ctx.fill()
  ctx.globalAlpha = 0.9
  ctx.beginPath()
  ctx.moveTo(0, -s * 0.6)
  ctx.bezierCurveTo(s * 0.45, -s * 0.28, s * 0.38, s * 0.3, 0, s * 0.28)
  ctx.stroke()
  ctx.restore()
}

/** One marigold bloom. */
export function marigoldFlower(ctx: Ctx, s: number, theme: Theme, hueShift = 0) {
  ctx.save()
  const outer = hueShift % 2 === 0 ? theme.palette.accent : theme.palette.accentSoft
  ctx.fillStyle = outer
  ctx.globalAlpha = 0.9
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    ctx.beginPath()
    ctx.ellipse(Math.cos(a) * s * 0.45, Math.sin(a) * s * 0.45, s * 0.34, s * 0.26, a, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = theme.palette.gold
  ctx.beginPath()
  ctx.arc(0, 0, s * 0.42, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** Hanging garland (toran) along a horizontal run. */
export function garland(ctx: Ctx, x0: number, x1: number, y: number, s: number, theme: Theme) {
  const span = x1 - x0
  const n = Math.max(6, Math.round(span / (s * 1.5)))
  ctx.save()
  ctx.strokeStyle = theme.palette.gold
  ctx.lineWidth = Math.max(0.5, s * 0.06)
  ctx.globalAlpha = 0.6
  ctx.beginPath()
  ctx.moveTo(x0, y)
  ctx.quadraticCurveTo((x0 + x1) / 2, y + s * 0.9, x1, y)
  ctx.stroke()
  ctx.globalAlpha = 1
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const px = x0 + span * t
    const py = y + Math.sin(Math.PI * t) * s * 0.65
    ctx.save()
    ctx.translate(px, py)
    marigoldFlower(ctx, s * (0.34 + 0.08 * Math.sin(i * 1.7)), theme, i)
    ctx.restore()
  }
  ctx.restore()
}

/** Quarter rangoli at the origin. */
export function rangoliCorner(ctx: Ctx, s: number, theme: Theme) {
  ctx.save()
  ctx.strokeStyle = theme.palette.accent
  ctx.lineWidth = Math.max(0.6, s * 0.015)
  ctx.globalAlpha = 0.75
  for (let i = 0; i < 5; i++) {
    const a0 = (i / 5) * (Math.PI / 2)
    const a1 = ((i + 1) / 5) * (Math.PI / 2)
    const mid = (a0 + a1) / 2
    ctx.beginPath()
    ctx.moveTo(Math.cos(a0) * s * 0.3, Math.sin(a0) * s * 0.3)
    ctx.quadraticCurveTo(Math.cos(mid) * s * 1.05, Math.sin(mid) * s * 1.05, Math.cos(a1) * s * 0.3, Math.sin(a1) * s * 0.3)
    ctx.stroke()
  }
  ctx.fillStyle = theme.palette.gold
  for (let i = 0; i <= 5; i++) {
    const a = (i / 5) * (Math.PI / 2)
    ctx.beginPath()
    ctx.arc(Math.cos(a) * s * 0.3, Math.sin(a) * s * 0.3, s * 0.03, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** Pulli kolam: dot grid with looping strokes. */
export function kolamCorner(ctx: Ctx, s: number, theme: Theme) {
  ctx.save()
  ctx.strokeStyle = theme.palette.gold
  ctx.fillStyle = theme.palette.accentSoft
  ctx.lineWidth = Math.max(0.5, s * 0.012)
  const step = s * 0.26
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4 - r; c++) {
      const x = c * step + step * 0.4
      const y = r * step + step * 0.4
      ctx.beginPath()
      ctx.arc(x, y, s * 0.018, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 0.6
      ctx.beginPath()
      ctx.arc(x, y, step * 0.42, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  }
  ctx.restore()
}

/** Oil lamp sitting on the baseline at the origin. */
export function diya(ctx: Ctx, s: number, theme: Theme) {
  ctx.save()
  ctx.fillStyle = theme.palette.accent
  ctx.beginPath()
  ctx.moveTo(-s, 0)
  ctx.quadraticCurveTo(0, s * 0.95, s, 0)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = theme.palette.gold
  ctx.beginPath()
  ctx.ellipse(0, 0, s, s * 0.16, 0, 0, Math.PI * 2)
  ctx.fill()
  const g = ctx.createRadialGradient(0, -s * 0.5, 0, 0, -s * 0.5, s * 0.9)
  g.addColorStop(0, 'rgba(255,240,180,0.95)')
  g.addColorStop(1, 'rgba(255,170,40,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, -s * 0.5, s * 0.9, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ffd25a'
  ctx.beginPath()
  ctx.moveTo(0, -s * 1.1)
  ctx.quadraticCurveTo(s * 0.26, -s * 0.4, 0, -s * 0.1)
  ctx.quadraticCurveTo(-s * 0.26, -s * 0.4, 0, -s * 1.1)
  ctx.fill()
  ctx.restore()
}

export function confettiField(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  s: number,
  theme: Theme,
  rand: () => number,
  count = 40,
) {
  ctx.save()
  const colors = [theme.palette.accent, theme.palette.accentSoft, theme.palette.gold, theme.palette.inkSoft]
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = 0.25 + rand() * 0.5
    ctx.fillStyle = colors[Math.floor(rand() * colors.length)]
    const px = x + rand() * w
    const py = y + rand() * h
    ctx.save()
    ctx.translate(px, py)
    ctx.rotate(rand() * Math.PI)
    if (i % 3 === 0) {
      ctx.beginPath()
      ctx.arc(0, 0, s * 0.12, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.fillRect(-s * 0.09, -s * 0.03, s * 0.18, s * 0.06)
    }
    ctx.restore()
  }
  ctx.restore()
}

export function pearlRun(ctx: Ctx, x0: number, x1: number, y: number, s: number, theme: Theme) {
  ctx.save()
  ctx.fillStyle = theme.palette.gold
  const n = Math.max(3, Math.round((x1 - x0) / (s * 0.5)))
  for (let i = 0; i <= n; i++) {
    ctx.globalAlpha = 0.35 + 0.4 * Math.sin((i / n) * Math.PI)
    ctx.beginPath()
    ctx.arc(x0 + ((x1 - x0) * i) / n, y, s * 0.055, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

export const motifName = (m: MotifKind): string => m
