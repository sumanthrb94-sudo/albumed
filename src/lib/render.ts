/* Page renderer. The same painter drives the on-screen preview and the PDF
   export, so the preview is genuinely WYSIWYG — only the pixel size changes. */
import { rng } from './id'
import * as M from './motifs'
import { scriptFontFor, themeById, type Theme } from './themes'
import type { Language } from './aiContract'
import type { AlbumPage, Photo, Project, Slot } from './types'
import type { BitmapCache, Decoded, Quality } from './images'

type Ctx = CanvasRenderingContext2D

export interface RenderOpts {
  page: AlbumPage
  pageIndex: number
  pageCount: number
  project: Project
  photos: Map<string, Photo>
  cache: BitmapCache
  quality: Quality
  /** Draw a placeholder box when a bitmap has not been decoded yet. */
  allowPlaceholders?: boolean
}

const fontsReady = new Map<string, Promise<void>>()

/* Google splits each family into unicode-range subsets, so a font has to be
   requested with text in its own script or the wrong subset (or none) loads. */
const SCRIPT_SAMPLES: Record<Language, [string, string]> = {
  telugu: ['"Noto Serif Telugu"', 'పెళ్లి'],
  english: ['"Cormorant Garamond"', 'Sample'],
  hindi: ['"Tiro Devanagari Hindi"', 'शुभ विवाह'],
  marathi: ['"Tiro Devanagari Hindi"', 'लग्न'],
  tamil: ['"Noto Serif Tamil"', 'திருமணம்'],
  kannada: ['"Noto Serif Kannada"', 'ಮದುವೆ'],
  malayalam: ['"Noto Serif Malayalam"', 'വിവാഹം'],
  bengali: ['"Noto Serif Bengali"', 'বিবাহ'],
  gujarati: ['"Noto Serif Gujarati"', 'લગ્ન'],
  punjabi: ['"Noto Serif Gurmukhi"', 'ਵਿਆਹ'],
}

const BASE_FONTS = [
  '400 48px Marcellus',
  '400 48px "Cormorant Garamond"',
  '600 48px "Cormorant Garamond"',
  'italic 400 48px "Cormorant Garamond"',
  '400 48px Mukta',
  '600 48px Mukta',
  '400 48px "Tiro Devanagari Hindi"',
]

/** Canvas needs the webfonts actually loaded before it can paint with them. */
export function ensureFonts(language: Language = 'english'): Promise<void> {
  const cached = fontsReady.get(language)
  if (cached) return cached
  const [family, sample] = SCRIPT_SAMPLES[language] ?? SCRIPT_SAMPLES.english
  const ready = (async () => {
    if (!('fonts' in document)) return
    await Promise.all([
      ...BASE_FONTS.map((f) => document.fonts.load(f).catch(() => undefined)),
      // The Devanagari flourishes on the cover print even for English albums.
      document.fonts.load('400 48px "Tiro Devanagari Hindi"', 'शुभ').catch(() => undefined),
      document.fonts.load(`400 48px ${family}`, sample).catch(() => undefined),
      document.fonts.load(`600 48px ${family}`, sample).catch(() => undefined),
    ])
    await document.fonts.ready.catch(() => undefined)
  })()
  fontsReady.set(language, ready)
  return ready
}

/* ---------- shape helpers ---------- */

function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
  ctx.lineTo(x + rr, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr)
  ctx.lineTo(x, y + rr)
  ctx.quadraticCurveTo(x, y, x + rr, y)
  ctx.closePath()
}

/** Mehrab (temple arch) — flat bottom, pointed top. */
function archPath(ctx: Ctx, x: number, y: number, w: number, h: number) {
  const shoulder = Math.min(h * 0.42, w * 0.5)
  ctx.beginPath()
  ctx.moveTo(x, y + h)
  ctx.lineTo(x, y + shoulder)
  ctx.quadraticCurveTo(x, y + shoulder * 0.12, x + w * 0.5, y)
  ctx.quadraticCurveTo(x + w, y + shoulder * 0.12, x + w, y + shoulder)
  ctx.lineTo(x + w, y + h)
  ctx.closePath()
}

/** An arch only reads as an arch on an upright frame; a circle needs a square one. */
function resolveShape(shape: Slot['shape'], w: number, h: number): Slot['shape'] {
  if (shape === 'arch' && w / h > 1.04) return 'round'
  if (shape === 'circle' && Math.abs(w / h - 1) > 0.08) return 'round'
  return shape
}

function shapePath(ctx: Ctx, shape: Slot['shape'], x: number, y: number, w: number, h: number, u: number) {
  switch (shape) {
    case 'arch':
      archPath(ctx, x, y, w, h)
      break
    case 'circle': {
      const r = Math.min(w, h) / 2
      ctx.beginPath()
      ctx.ellipse(x + w / 2, y + h / 2, r, r, 0, 0, Math.PI * 2)
      break
    }
    case 'round':
      roundRectPath(ctx, x, y, w, h, u * 1.6)
      break
    default:
      ctx.beginPath()
      ctx.rect(x, y, w, h)
  }
}

/* ---------- text helpers ---------- */

function setLetterSpacing(ctx: Ctx, px: number) {
  // Supported in Chromium/Safari 17+; harmless elsewhere.
  ;(ctx as unknown as { letterSpacing?: string }).letterSpacing = `${px}px`
}

function fitFont(ctx: Ctx, text: string, family: string, weight: string, size: number, maxW: number): number {
  let s = size
  for (let i = 0; i < 24; i++) {
    ctx.font = `${weight} ${s}px ${family}`
    if (ctx.measureText(text).width <= maxW || s < 6) break
    s *= 0.94
  }
  return s
}

interface TextOpts {
  weight?: string
  color: string
  /** Overrides `color`. Used for foil, which is a gradient, not an ink. */
  fill?: string | CanvasGradient
  family: string
  size: number
  maxW: number
  align?: CanvasTextAlign
  baseline?: CanvasTextBaseline
  tracking?: number
  alpha?: number
}

function text(ctx: Ctx, str: string, x: number, y: number, o: TextOpts): number {
  if (!str) return 0
  ctx.save()
  ctx.globalAlpha = o.alpha ?? 1
  setLetterSpacing(ctx, o.tracking ?? 0)
  const size = fitFont(ctx, str, o.family, o.weight ?? '400', o.size, o.maxW)
  ctx.font = `${o.weight ?? '400'} ${size}px ${o.family}`
  ctx.fillStyle = o.fill ?? o.color
  ctx.textAlign = o.align ?? 'center'
  ctx.textBaseline = o.baseline ?? 'alphabetic'
  ctx.fillText(str, x, y)
  ctx.restore()
  setLetterSpacing(ctx, 0)
  return size
}

/** Small ornamental rule: ——— ◆ ——— */
function rule(ctx: Ctx, cx: number, y: number, half: number, theme: Theme, u: number) {
  ctx.save()
  ctx.strokeStyle = theme.palette.gold
  ctx.fillStyle = theme.palette.gold
  ctx.lineWidth = Math.max(0.5, u * 0.08)
  ctx.globalAlpha = 0.9
  ctx.beginPath()
  ctx.moveTo(cx - half, y)
  ctx.lineTo(cx - u * 0.9, y)
  ctx.moveTo(cx + u * 0.9, y)
  ctx.lineTo(cx + half, y)
  ctx.stroke()
  ctx.save()
  ctx.translate(cx, y)
  ctx.rotate(Math.PI / 4)
  ctx.fillRect(-u * 0.28, -u * 0.28, u * 0.56, u * 0.56)
  ctx.restore()
  ctx.restore()
}

/* ---------- backgrounds & borders ---------- */

function paperBackground(ctx: Ctx, W: number, H: number, theme: Theme) {
  const g = ctx.createLinearGradient(0, 0, W, H)
  g.addColorStop(0, theme.palette.paper)
  g.addColorStop(1, theme.palette.paperAlt)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.75)
  v.addColorStop(0, 'rgba(255,255,255,0)')
  v.addColorStop(1, 'rgba(60,30,10,0.07)')
  ctx.fillStyle = v
  ctx.fillRect(0, 0, W, H)
}

function drawBorder(ctx: Ctx, W: number, H: number, theme: Theme, u: number, seed: number) {
  const m = u * 3.2
  ctx.save()
  ctx.strokeStyle = theme.palette.gold
  ctx.globalAlpha = 0.65
  ctx.lineWidth = Math.max(0.5, u * 0.09)
  ctx.strokeRect(m, m, W - m * 2, H - m * 2)
  ctx.globalAlpha = 0.35
  ctx.lineWidth = Math.max(0.4, u * 0.05)
  ctx.strokeRect(m + u * 0.7, m + u * 0.7, W - (m + u * 0.7) * 2, H - (m + u * 0.7) * 2)
  ctx.restore()

  const inset = m + u * 1.1
  const corner = u * 6
  const rand = rng(seed)

  switch (theme.motif) {
    case 'mandala':
      for (const [cx, cy, rot] of [
        [inset, inset, 0],
        [W - inset, inset, Math.PI / 2],
        [W - inset, H - inset, Math.PI],
        [inset, H - inset, -Math.PI / 2],
      ] as const) {
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(rot)
        M.mandalaCorner(ctx, corner, theme)
        ctx.restore()
      }
      break
    case 'paisley':
      for (const [cx, cy, rot] of [
        [inset + corner * 0.5, inset + corner * 0.6, Math.PI * 0.25],
        [W - inset - corner * 0.5, inset + corner * 0.6, -Math.PI * 0.25],
        [inset + corner * 0.5, H - inset - corner * 0.6, Math.PI * 0.75],
        [W - inset - corner * 0.5, H - inset - corner * 0.6, -Math.PI * 0.75],
      ] as const) {
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(rot)
        M.paisley(ctx, corner * 0.55, theme)
        ctx.restore()
      }
      break
    case 'marigold':
      M.garland(ctx, inset + u, m - u * 0.4, inset * 0.8, u * 2.2, theme)
      break
    case 'rangoli':
      for (const [cx, cy, rot] of [
        [inset, inset, 0],
        [W - inset, inset, Math.PI / 2],
        [W - inset, H - inset, Math.PI],
        [inset, H - inset, -Math.PI / 2],
      ] as const) {
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(rot)
        M.rangoliCorner(ctx, corner * 0.9, theme)
        ctx.restore()
      }
      break
    case 'kolam':
      for (const [cx, cy, rot] of [
        [inset, inset, 0],
        [W - inset, inset, Math.PI / 2],
        [W - inset, H - inset, Math.PI],
        [inset, H - inset, -Math.PI / 2],
      ] as const) {
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(rot)
        M.kolamCorner(ctx, corner * 0.8, theme)
        ctx.restore()
      }
      break
    case 'diya': {
      const n = 3
      for (let i = 0; i < n; i++) {
        ctx.save()
        ctx.translate(W * ((i + 1) / (n + 1)), H - m * 0.42)
        M.diya(ctx, u * 1.15, theme)
        ctx.restore()
      }
      break
    }
    case 'confetti':
      M.confettiField(ctx, 0, 0, W, m, u * 3, theme, rand, 26)
      M.confettiField(ctx, 0, H - m, W, m, u * 3, theme, rand, 26)
      break
    case 'pearl':
      M.pearlRun(ctx, inset + u, W - inset - u, m * 0.55, u * 3, theme)
      M.pearlRun(ctx, inset + u, W - inset - u, H - m * 0.55, u * 3, theme)
      break
    case 'pookalam':
      for (const [cx, cy] of [
        [inset + corner * 0.2, inset + corner * 0.2],
        [W - inset - corner * 0.2, H - inset - corner * 0.2],
      ] as const) {
        ctx.save()
        ctx.translate(cx, cy)
        ctx.globalAlpha = 0.8
        M.pookalam(ctx, corner * 0.6, theme)
        ctx.restore()
      }
      break
    case 'kasavu':
      M.kasavuBand(ctx, 0, 0, W, H, u, theme)
      break
    case 'alpona':
      for (const [cx, cy, rot] of [
        [inset, inset, 0],
        [W - inset, inset, Math.PI / 2],
        [W - inset, H - inset, Math.PI],
        [inset, H - inset, -Math.PI / 2],
      ] as const) {
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(rot)
        M.alponaCorner(ctx, corner * 0.85)
        ctx.restore()
      }
      break
    case 'peacock':
      for (const [cx, flip] of [
        [inset + corner * 0.6, 1],
        [W - inset - corner * 0.6, -1],
      ] as const) {
        ctx.save()
        ctx.translate(cx, H - inset - corner * 0.5)
        ctx.scale(flip, 1)
        M.peacock(ctx, corner * 0.7, theme)
        ctx.restore()
      }
      break
    case 'phulkari':
      M.phulkariBand(ctx, inset, m * 0.35, W - inset * 2, u, theme)
      M.phulkariBand(ctx, inset, H - m * 0.35 - u * 2.2, W - inset * 2, u, theme)
      break
    case 'bandhani':
      M.bandhaniField(ctx, 0, 0, W, m, u, theme, rand)
      M.bandhaniField(ctx, 0, H - m, W, m, u, theme, rand)
      break
    case 'madhubani':
      for (const [cx, cy, flipX, flipY] of [
        [inset, inset, 1, 1],
        [W - inset, inset, -1, 1],
        [inset, H - inset, 1, -1],
        [W - inset, H - inset, -1, -1],
      ] as const) {
        ctx.save()
        ctx.translate(cx, cy)
        ctx.scale(flipX, flipY)
        M.madhubaniCorner(ctx, corner * 0.8, theme)
        ctx.restore()
      }
      break
    case 'chikan':
      M.chikanRun(ctx, inset, W - inset, m * 0.55, u, theme)
      M.chikanRun(ctx, inset, W - inset, H - m * 0.55, u, theme)
      break
    case 'ikat':
      M.ikatBand(ctx, 0, m * 0.2, W, u, theme)
      M.ikatBand(ctx, 0, H - m * 0.2 - u * 1.5, W, u, theme)
      break
    case 'tile':
      for (const [cx, cy] of [
        [inset, inset],
        [W - inset - corner * 0.7, inset],
        [inset, H - inset - corner * 0.7],
        [W - inset - corner * 0.7, H - inset - corner * 0.7],
      ] as const) {
        ctx.save()
        ctx.translate(cx, cy)
        M.tileCorner(ctx, corner * 0.7, theme)
        ctx.restore()
      }
      break
  }
}

/* ---------- photo drawing ---------- */

/** Crop to fill the slot, keeping the subject's focal point in frame. */
function drawImageCover(
  ctx: Ctx,
  img: Decoded,
  x: number,
  y: number,
  w: number,
  h: number,
  focus: { x: number; y: number } = { x: 0.5, y: 0.5 },
) {
  const sr = img.width / img.height
  const dr = w / h
  let sw = img.width
  let sh = img.height
  let sx = 0
  let sy = 0
  if (sr > dr) {
    sw = img.height * dr
    sx = clamp(img.width * focus.x - sw / 2, 0, img.width - sw)
  } else {
    sh = img.width / dr
    sy = clamp(img.height * focus.y - sh / 2, 0, img.height - sh)
  }
  ctx.drawImage(img.bitmap, sx, sy, sw, sh, x, y, w, h)
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function drawSlot(
  ctx: Ctx,
  slot: Slot,
  box: { x: number; y: number; w: number; h: number },
  opts: RenderOpts,
  theme: Theme,
  u: number,
) {
  const x = box.x + slot.x * box.w
  const y = box.y + slot.y * box.h
  const w = slot.w * box.w
  const h = slot.h * box.h
  const photo = opts.photos.get(slot.photoId)
  const img = opts.cache.get(slot.photoId, opts.quality)
  /* A caption under a photograph that runs off the trim has nowhere to sit, so
     a bled page prints one line for the page instead of one per frame. And a
     caption under every frame of a six-up is clutter; on a busy page the
     photographs speak. */
  const busy = opts.page.slots.length > 3
  const showCaption = opts.project.album.showCaptions && Boolean(photo?.caption) && !slot.bled && !busy
  const twoLine = showCaption && Boolean(photo?.captionNative?.trim())
  const capH = showCaption ? Math.min(h * (twoLine ? 0.24 : 0.16), u * (twoLine ? 5.2 : 3.2)) : 0
  const ih = h - capH
  /* An arch or a rounded corner is a deliberate flourish around a single
     photograph on paper. Repeated down a grid of six it reads as soft, and at
     the trim of a bled page there is no corner to round. */
  const shape = slot.bled || opts.page.slots.length > 2 ? 'rect' : resolveShape(slot.shape, w, ih)

  /* No drop shadow. A photograph on an album page is printed into the paper,
     not stuck on top of it, and a shadow under every frame is the single
     clearest tell of a cheap template. */

  ctx.save()
  shapePath(ctx, shape, x, y, w, ih, u)
  ctx.clip()
  if (img) {
    drawImageCover(ctx, img, x, y, w, ih, {
      x: photo?.focusX ?? 0.5,
      y: photo?.focusY ?? 0.5,
    })
  } else {
    const g = ctx.createLinearGradient(x, y, x + w, y + ih)
    g.addColorStop(0, theme.palette.paperAlt)
    g.addColorStop(1, theme.palette.accentSoft)
    ctx.fillStyle = g
    ctx.fillRect(x, y, w, ih)
    if (opts.allowPlaceholders) {
      text(ctx, 'loading…', x + w / 2, y + ih / 2, {
        family: theme.bodyFont,
        color: 'rgba(255,255,255,0.85)',
        size: u * 1.4,
        maxW: w * 0.8,
        baseline: 'middle',
      })
    }
  }
  ctx.restore()

  /* A hairline belongs around a photograph sitting on paper, not around one
     running off the trim — there is no edge there to draw. */
  if (!slot.bled) {
    ctx.save()
    ctx.strokeStyle = theme.palette.gold
    ctx.globalAlpha = 0.55
    ctx.lineWidth = Math.max(0.4, u * 0.05)
    shapePath(ctx, shape, x, y, w, ih, u)
    ctx.stroke()
    ctx.restore()
  }

  if (showCaption && photo) {
    const native = photo.captionNative?.trim()
    const cy = y + ih + capH * (native ? 0.5 : 0.72)
    text(ctx, photo.caption, x + w / 2, cy, {
      family: theme.bodyFont,
      weight: 'italic 400',
      color: theme.palette.inkSoft,
      size: Math.min(capH * (native ? 0.38 : 0.54), u * 1.35),
      maxW: w * 0.96,
      tracking: u * 0.05,
      alpha: 0.9,
    })
    if (native) {
      text(ctx, native, x + w / 2, y + ih + capH * 0.95, {
        family: scriptFontFor(opts.project.language),
        color: theme.palette.accent,
        size: Math.min(capH * 0.4, u * 1.25),
        maxW: w * 0.96,
        alpha: 0.85,
      })
    }
  }
}

/* ---------- pages ---------- */

/* ---------- covers ----------

   A cover is the whole first impression, and one layout recoloured thirty-five
   times reads as a template however good the palette is. What the studios at
   the top of this market actually sell is a small set of distinct treatments —
   a full-bleed photograph under acrylic, a foil-stamped leather board with no
   photograph on it at all, an heirloom window mat, a modern colour band — cut
   from a material you can name. These are those treatments. */

/** How bright a colour is, 0 to 1. */
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return 0.5
  const n = parseInt(m[1], 16)
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
}

/** Gold is never a flat fill on a real cover; it catches the light across the
 *  stroke. A three-stop gradient plus a dark offset reads as stamped foil.
 *
 *  Which gold depends on what it is stamped on. The bright foil that glows on
 *  oxblood leather disappears completely on cream linen, so on a pale board the
 *  same gradient runs deep and saturated instead — which is what a press
 *  actually gives you, since the foil picks up the shadow of its own debossing. */
function foil(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, theme: Theme, onLight = false): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1)
  const gold = theme.palette.gold
  if (onLight) {
    g.addColorStop(0, shade(gold, -0.52))
    g.addColorStop(0.24, shade(gold, -0.12))
    g.addColorStop(0.46, shade(gold, 0.08))
    g.addColorStop(0.64, shade(gold, -0.2))
    g.addColorStop(1, shade(gold, -0.5))
  } else {
    g.addColorStop(0, shade(gold, -0.34))
    g.addColorStop(0.22, shade(gold, 0.16))
    g.addColorStop(0.45, shade(gold, 0.46))
    g.addColorStop(0.62, shade(gold, 0.1))
    g.addColorStop(1, shade(gold, -0.28))
  }
  return g
}

/** True when type on this board needs the darker foil to be readable. */
const paleBoard = (theme: Theme) => luminance(theme.palette.cover) > 0.55

/** Lighten (t > 0) or darken (t < 0) a hex colour. Returns hex, so the result
 *  can go anywhere the input could — including into a gradient stop, which an
 *  `rgb(...)` string silently cannot once anything is appended to it. */
export function shade(hex: string, t: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const mix = (c: number) => Math.round(t >= 0 ? c + (255 - c) * t : c * (1 + t))
  const hx = (c: number) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')
  return `#${hx(mix((n >> 16) & 255))}${hx(mix((n >> 8) & 255))}${hx(mix(n & 255))}`
}

/** A colour with an alpha, built rather than concatenated. */
export function withAlpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, a))})`
}

/** Type stamped into the board: a dark bite below, the foil above it. */
function stamped(
  ctx: Ctx,
  str: string,
  x: number,
  y: number,
  o: TextOpts,
  theme: Theme,
  depth: number,
  backdrop: string,
) {
  if (!str) return
  const w = o.maxW
  const bl = luminance(backdrop)
  const onLight = bl > 0.55

  /* Foil only earns its place when the *whole* gradient separates from the
     board, not just its brightest point. Gold on a mustard board has a bright
     midpoint and dark ends that sit exactly on the board tone, so each letter
     loses its edges and the title reads as a smudge — which is what happened
     to Assam Muga and Sagai Rose. Test the darkest and the lightest stop; if
     either of them gets lost, set the title in ink instead, the way a press
     would. */
  const gold = theme.palette.gold
  const dark = luminance(shade(gold, onLight ? -0.52 : -0.34))
  const light = luminance(shade(gold, onLight ? 0.08 : 0.46))
  const useFoil = Math.min(Math.abs(dark - bl), Math.abs(light - bl)) > 0.18

  // The theme's own cover ink first; only fall back when that is lost too.
  const ink = Math.abs(luminance(o.color) - bl) > 0.35 ? o.color : onLight ? '#20140a' : '#fdf3e3'

  text(ctx, str, x + depth * 0.5, y + depth, {
    ...o, fill: undefined, color: 'rgba(0,0,0,0.5)', alpha: onLight ? 0.4 : 0.5,
  })
  text(ctx, str, x, y, {
    ...o,
    color: useFoil ? o.color : ink,
    fill: useFoil ? foil(ctx, x - w / 2, y - o.size, x + w / 2, y + o.size * 0.3, theme, onLight) : undefined,
  })
}

/** What the board is made of. Cheap covers are flat colour; real ones have a
 *  weave, a grain or a fleck you can see at arm's length. */
function material(ctx: Ctx, W: number, H: number, theme: Theme, rand: () => number) {
  const step = Math.max(2, Math.min(W, H) / 220)
  ctx.save()
  if (theme.material === 'linen') {
    ctx.globalAlpha = 0.05
    ctx.lineWidth = Math.max(0.5, step * 0.34)
    ctx.strokeStyle = '#ffffff'
    ctx.beginPath()
    for (let x = 0; x < W; x += step) {
      ctx.moveTo(x, 0)
      ctx.lineTo(x, H)
    }
    ctx.stroke()
    ctx.globalAlpha = 0.045
    ctx.strokeStyle = '#000000'
    ctx.beginPath()
    for (let y = 0; y < H; y += step) {
      ctx.moveTo(0, y)
      ctx.lineTo(W, y)
    }
    ctx.stroke()
  } else if (theme.material === 'leather') {
    ctx.globalAlpha = 0.055
    for (let i = 0; i < 900; i++) {
      const r = step * (0.5 + rand() * 1.6)
      ctx.fillStyle = rand() > 0.5 ? '#ffffff' : '#000000'
      ctx.beginPath()
      ctx.ellipse(rand() * W, rand() * H, r, r * (0.6 + rand() * 0.8), rand() * Math.PI, 0, Math.PI * 2)
      ctx.fill()
    }
  } else if (theme.material === 'silk') {
    // A sheen that runs across the weave, the way light moves on raw silk.
    const sheen = ctx.createLinearGradient(0, H, W, 0)
    sheen.addColorStop(0, 'rgba(255,255,255,0)')
    sheen.addColorStop(0.42, 'rgba(255,255,255,0.09)')
    sheen.addColorStop(0.56, 'rgba(255,255,255,0.03)')
    sheen.addColorStop(1, 'rgba(0,0,0,0.1)')
    ctx.fillStyle = sheen
    ctx.fillRect(0, 0, W, H)
    ctx.globalAlpha = 0.035
    ctx.lineWidth = Math.max(0.4, step * 0.28)
    ctx.strokeStyle = '#ffffff'
    ctx.beginPath()
    for (let x = -H; x < W; x += step * 2.4) {
      ctx.moveTo(x, H)
      ctx.lineTo(x + H, 0)
    }
    ctx.stroke()
  } else {
    // Handmade paper: fibre flecks, no pattern.
    ctx.globalAlpha = 0.06
    for (let i = 0; i < 1400; i++) {
      ctx.fillStyle = rand() > 0.45 ? '#000000' : '#ffffff'
      const l = step * (0.6 + rand() * 2.4)
      ctx.save()
      ctx.translate(rand() * W, rand() * H)
      ctx.rotate(rand() * Math.PI)
      ctx.fillRect(0, 0, l, Math.max(0.5, step * 0.22))
      ctx.restore()
    }
  }
  ctx.restore()
}

/** The colour field a board is dyed, before anything is printed on it. */
function board(ctx: Ctx, W: number, H: number, theme: Theme, rand: () => number) {
  const g = ctx.createLinearGradient(0, 0, W * 0.35, H)
  g.addColorStop(0, shade(theme.palette.cover, 0.07))
  g.addColorStop(0.55, theme.palette.cover)
  g.addColorStop(1, theme.palette.coverAlt)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  material(ctx, W, H, theme, rand)
  // A press leaves the middle a touch brighter than the edges.
  const v = ctx.createRadialGradient(W * 0.5, H * 0.42, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.78)
  v.addColorStop(0, 'rgba(255,255,255,0.05)')
  v.addColorStop(0.7, 'rgba(0,0,0,0)')
  v.addColorStop(1, 'rgba(0,0,0,0.22)')
  ctx.fillStyle = v
  ctx.fillRect(0, 0, W, H)
}

/** A wash that lets type sit on a photograph without a box around it. */
function scrim(ctx: Ctx, W: number, H: number, from: number, to: number, colour: string, strength: number) {
  const g = ctx.createLinearGradient(0, H * from, 0, H * to)
  g.addColorStop(0, 'rgba(0,0,0,0)')
  g.addColorStop(1, colour)
  ctx.save()
  ctx.globalAlpha = strength
  ctx.fillStyle = g
  ctx.fillRect(0, Math.min(H * from, H * to), W, Math.abs(H * (to - from)) + 1)
  ctx.restore()
}

/** The hairline the press debosses just inside the trim. */
function foilFrame(ctx: Ctx, W: number, H: number, inset: number, theme: Theme, u: number, onLight = false) {
  ctx.save()
  ctx.strokeStyle = foil(ctx, inset, inset, W - inset, H - inset, theme, onLight)
  ctx.lineWidth = Math.max(0.7, u * 0.12)
  ctx.globalAlpha = 0.9
  ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2)
  ctx.globalAlpha = 0.5
  ctx.lineWidth = Math.max(0.4, u * 0.05)
  const i2 = inset + u * 0.8
  ctx.strokeRect(i2, i2, W - i2 * 2, H - i2 * 2)
  ctx.restore()
}

/** The photograph on the cover, filling whatever rectangle it is given. */
function coverPhoto(ctx: Ctx, opts: RenderOpts, x: number, y: number, w: number, h: number): boolean {
  const slot = opts.page.slots[0]
  const img = slot ? opts.cache.get(slot.photoId, opts.quality) : null
  if (!img) {
    ctx.save()
    ctx.fillStyle = 'rgba(0,0,0,0.18)'
    ctx.fillRect(x, y, w, h)
    ctx.restore()
    return false
  }
  const photo = opts.photos.get(slot!.photoId)
  drawImageCover(ctx, img, x, y, w, h, { x: photo?.focusX ?? 0.5, y: photo?.focusY ?? 0.45 })
  return true
}

interface CoverText {
  script: string
  title: string
  hosts: string
  meta: string
}

function coverText(opts: RenderOpts, theme: Theme): CoverText {
  return {
    script: theme.script,
    title: opts.page.heading ?? opts.project.title,
    hosts: opts.page.subheading ?? opts.project.hosts,
    meta: [opts.project.eventDate, opts.project.venue].filter(Boolean).join('  ·  '),
  }
}

function renderCover(ctx: Ctx, W: number, H: number, opts: RenderOpts, theme: Theme, u: number) {
  const rand = rng(opts.project.album.seed + 7)
  const t = coverText(opts, theme)
  switch (theme.cover) {
    case 'fullbleed':
      return coverFullBleed(ctx, W, H, opts, theme, u, t)
    case 'band':
      return coverBand(ctx, W, H, opts, theme, u, t, rand)
    case 'editorial':
      return coverEditorial(ctx, W, H, opts, theme, u, t, rand)
    case 'foil':
      return coverFoil(ctx, W, H, theme, u, t, rand)
    case 'duotone':
      return coverDuotone(ctx, W, H, opts, theme, u, t)
    default:
      return coverWindow(ctx, W, H, opts, theme, u, t, rand)
  }
}

/* --- the photograph, edge to edge, type in foil over it --- */
function coverFullBleed(ctx: Ctx, W: number, H: number, opts: RenderOpts, theme: Theme, u: number, t: CoverText) {
  const under = shade(theme.palette.cover, -0.62)
  coverPhoto(ctx, opts, 0, 0, W, H)
  // A pale photograph will swallow white type, so the foot of the cover is
  // taken almost to the board colour before anything is set on it.
  scrim(ctx, W, H, 0.44, 1.0, shade(theme.palette.cover, -0.62), 0.97)
  scrim(ctx, W, H, 0.78, 1.0, shade(theme.palette.cover, -0.72), 0.85)
  scrim(ctx, W, H, 0.26, 0, shade(theme.palette.cover, -0.55), 0.6)
  foilFrame(ctx, W, H, u * 2.6, theme, u)

  const cx = W / 2
  if (t.script) {
    stamped(ctx, t.script, cx, H * 0.115, { family: theme.scriptFont, color: theme.palette.gold, size: u * 3.6, maxW: W * 0.6 }, theme, u * 0.14, under)
  }

  const titleY = H * 0.78
  stamped(ctx, t.title, cx, titleY, { family: theme.titleFont, color: '#fff', size: u * 7.4, maxW: W * 0.84, tracking: u * 0.1 }, theme, u * 0.18, under)
  rule(ctx, cx, titleY + u * 2.8, W * 0.2, theme, u)
  text(ctx, t.hosts, cx, titleY + u * 7, {
    family: theme.bodyFont, weight: '600', color: '#fff', size: u * 3.2, maxW: W * 0.76, tracking: u * 0.36, alpha: 0.96,
  })
  text(ctx, t.meta, cx, H * 0.945, {
    family: theme.bodyFont, color: '#fff', size: u * 2.2, maxW: W * 0.8, tracking: u * 0.24, alpha: 0.78,
  })
}

/* --- the heirloom: a wide mat, a deep window, foil around it --- */
function coverWindow(ctx: Ctx, W: number, H: number, opts: RenderOpts, theme: Theme, u: number, t: CoverText, rand: () => number) {
  const under = theme.palette.cover
  const pale = paleBoard(theme)
  board(ctx, W, H, theme, rand)

  ctx.save()
  ctx.globalAlpha = 0.06
  ctx.translate(W / 2, H * 0.38)
  M.mandala(ctx, Math.min(W, H) * 0.42, theme)
  ctx.restore()

  foilFrame(ctx, W, H, u * 2.4, theme, u, pale)

  // A window big enough to be the subject, not a stamp floating in a field.
  const wx = W * 0.085
  const ww = W - wx * 2
  const wy = H * 0.085
  const wh = H * 0.575
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.42)'
  ctx.shadowBlur = u * 2.4
  ctx.shadowOffsetY = u * 0.8
  ctx.fillStyle = shade(theme.palette.cover, -0.3)
  ctx.fillRect(wx - u * 0.5, wy - u * 0.5, ww + u, wh + u)
  ctx.restore()
  coverPhoto(ctx, opts, wx, wy, ww, wh)
  ctx.save()
  ctx.strokeStyle = foil(ctx, wx, wy, wx + ww, wy + wh, theme, pale)
  ctx.lineWidth = Math.max(0.8, u * 0.16)
  ctx.strokeRect(wx, wy, ww, wh)
  ctx.restore()

  const cx = W / 2
  if (t.script) {
    stamped(ctx, t.script, cx, wy + wh + u * 4.6, { family: theme.scriptFont, color: theme.palette.gold, size: u * 3.2, maxW: W * 0.6 }, theme, u * 0.12, under)
  }
  const titleY = H * 0.795
  stamped(ctx, t.title, cx, titleY, { family: theme.titleFont, color: theme.palette.coverInk, size: u * 6.6, maxW: W * 0.8, tracking: u * 0.12 }, theme, u * 0.16, under)
  rule(ctx, cx, titleY + u * 2.4, W * 0.18, theme, u)
  text(ctx, t.hosts, cx, titleY + u * 6, {
    family: theme.bodyFont, weight: '600', color: theme.palette.coverInk, size: u * 3, maxW: W * 0.74, tracking: u * 0.34, alpha: 0.95,
  })
  text(ctx, t.meta, cx, H * 0.955, {
    family: theme.bodyFont, color: theme.palette.coverInk, size: u * 2.2, maxW: W * 0.78, tracking: u * 0.22, alpha: 0.72,
  })
}

/* --- full-bleed photograph with a dyed band across the foot --- */
function coverBand(ctx: Ctx, W: number, H: number, opts: RenderOpts, theme: Theme, u: number, t: CoverText, rand: () => number) {
  const under = theme.palette.cover
  const pale = paleBoard(theme)
  const bandTop = H * 0.7
  coverPhoto(ctx, opts, 0, 0, W, bandTop)

  ctx.save()
  ctx.beginPath()
  ctx.rect(0, bandTop, W, H - bandTop)
  ctx.clip()
  board(ctx, W, H, theme, rand)
  ctx.restore()

  ctx.save()
  ctx.strokeStyle = foil(ctx, 0, bandTop, W, bandTop, theme, pale)
  ctx.lineWidth = Math.max(0.9, u * 0.18)
  ctx.beginPath()
  ctx.moveTo(0, bandTop)
  ctx.lineTo(W, bandTop)
  ctx.stroke()
  ctx.restore()

  const cx = W / 2
  if (t.script) {
    stamped(ctx, t.script, cx, bandTop + u * 4.4, { family: theme.scriptFont, color: theme.palette.gold, size: u * 3.2, maxW: W * 0.5 }, theme, u * 0.12, under)
  }
  const titleY = bandTop + u * 11.5
  stamped(ctx, t.title, cx, titleY, { family: theme.titleFont, color: theme.palette.coverInk, size: u * 6.6, maxW: W * 0.82, tracking: u * 0.1 }, theme, u * 0.16, under)
  text(ctx, t.hosts, cx, titleY + u * 5.2, {
    family: theme.bodyFont, weight: '600', color: theme.palette.coverInk, size: u * 3, maxW: W * 0.74, tracking: u * 0.34, alpha: 0.92,
  })
  text(ctx, t.meta, cx, H * 0.955, {
    family: theme.bodyFont, color: theme.palette.coverInk, size: u * 2.1, maxW: W * 0.78, tracking: u * 0.22, alpha: 0.7,
  })
}

/* --- asymmetric: photograph right, a dyed type block left --- */
function coverEditorial(ctx: Ctx, W: number, H: number, opts: RenderOpts, theme: Theme, u: number, t: CoverText, rand: () => number) {
  const under = theme.palette.cover
  const pale = paleBoard(theme)
  const split = W * 0.47
  board(ctx, W, H, theme, rand)
  coverPhoto(ctx, opts, split, 0, W - split, H)

  ctx.save()
  ctx.strokeStyle = foil(ctx, split, 0, split, H, theme, pale)
  ctx.lineWidth = Math.max(0.8, u * 0.16)
  ctx.beginPath()
  ctx.moveTo(split, 0)
  ctx.lineTo(split, H)
  ctx.stroke()
  ctx.restore()

  const lx = u * 3.4
  const colW = split - u * 6.2
  if (t.script) {
    stamped(ctx, t.script, lx, H * 0.17, {
      family: theme.scriptFont, color: theme.palette.gold, size: u * 3.2, maxW: colW, align: 'left',
    }, theme, u * 0.12, under)
  }

  const titleY = H * 0.55
  stamped(ctx, t.title, lx, titleY, {
    family: theme.titleFont, color: theme.palette.coverInk, size: u * 7.2, maxW: colW, tracking: u * 0.04, align: 'left',
  }, theme, u * 0.18, under)

  ctx.save()
  ctx.strokeStyle = foil(ctx, lx, titleY, lx + colW * 0.5, titleY, theme, pale)
  ctx.lineWidth = Math.max(0.6, u * 0.1)
  ctx.beginPath()
  ctx.moveTo(lx, titleY + u * 2.4)
  ctx.lineTo(lx + colW * 0.44, titleY + u * 2.4)
  ctx.stroke()
  ctx.restore()

  text(ctx, t.hosts, lx, titleY + u * 6.2, {
    family: theme.bodyFont, weight: '600', color: theme.palette.coverInk, size: u * 2.9, maxW: colW, tracking: u * 0.3, align: 'left', alpha: 0.95,
  })
  text(ctx, t.meta, lx, H * 0.9, {
    family: theme.bodyFont, color: theme.palette.coverInk, size: u * 2, maxW: colW, tracking: u * 0.18, align: 'left', alpha: 0.72,
  })
}

/* --- no photograph at all: fabric, and a deep foil stamp --- */
function coverFoil(ctx: Ctx, W: number, H: number, theme: Theme, u: number, t: CoverText, rand: () => number) {
  const under = theme.palette.cover
  const pale = paleBoard(theme)
  board(ctx, W, H, theme, rand)
  foilFrame(ctx, W, H, u * 3, theme, u, pale)

  const cy = H * 0.4
  // Stamped, not printed: a dark bite under a foil motif.
  ctx.save()
  ctx.translate(W / 2, cy + u * 0.16)
  ctx.globalAlpha = 0.34
  ctx.filter = 'none'
  M.mandala(ctx, Math.min(W, H) * 0.3, { ...theme, palette: { ...theme.palette, gold: '#000000' } })
  ctx.restore()
  ctx.save()
  ctx.translate(W / 2, cy)
  ctx.globalAlpha = 0.95
  M.mandala(ctx, Math.min(W, H) * 0.3, theme)
  ctx.restore()

  const cx = W / 2
  if (t.script) {
    stamped(ctx, t.script, cx, H * 0.145, { family: theme.scriptFont, color: theme.palette.gold, size: u * 3.4, maxW: W * 0.6 }, theme, u * 0.12, under)
  }
  const titleY = H * 0.72
  stamped(ctx, t.title, cx, titleY, { family: theme.titleFont, color: theme.palette.coverInk, size: u * 7.6, maxW: W * 0.8, tracking: u * 0.16 }, theme, u * 0.2, under)
  rule(ctx, cx, titleY + u * 2.8, W * 0.2, theme, u)
  text(ctx, t.hosts, cx, titleY + u * 7.2, {
    family: theme.bodyFont, weight: '600', color: theme.palette.coverInk, size: u * 3.2, maxW: W * 0.74, tracking: u * 0.38, alpha: 0.92,
  })
  text(ctx, t.meta, cx, H * 0.93, {
    family: theme.bodyFont, color: theme.palette.coverInk, size: u * 2.1, maxW: W * 0.78, tracking: u * 0.22, alpha: 0.68,
  })
}

/* --- the photograph printed in two inks, display type over it --- */
function coverDuotone(ctx: Ctx, W: number, H: number, opts: RenderOpts, theme: Theme, u: number, t: CoverText) {
  const under = shade(theme.palette.cover, -0.78)
  ctx.fillStyle = theme.palette.cover
  ctx.fillRect(0, 0, W, H)
  coverPhoto(ctx, opts, 0, 0, W, H)

  // A real duotone: strip the colour, push the shadows towards one ink and the
  // highlights towards the other. Multiplying a dark ink over the whole frame
  // just makes mud, which is what this used to do.
  ctx.save()
  ctx.globalCompositeOperation = 'saturation'
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'multiply'
  ctx.fillStyle = shade(theme.palette.cover, 0.34)
  ctx.fillRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'screen'
  ctx.fillStyle = shade(theme.palette.gold, 0.1)
  ctx.globalAlpha = 0.26
  ctx.fillRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'source-over'
  ctx.restore()

  scrim(ctx, W, H, 0.5, 0.9, shade(theme.palette.cover, -0.78), 0.98)
  scrim(ctx, W, H, 0.9, 1.0, shade(theme.palette.cover, -0.8), 0.98)
  scrim(ctx, W, H, 0.22, 0, shade(theme.palette.cover, -0.6), 0.55)
  foilFrame(ctx, W, H, u * 2.8, theme, u)

  const cx = W / 2
  if (t.script) {
    stamped(ctx, t.script, cx, H * 0.13, { family: theme.scriptFont, color: theme.palette.gold, size: u * 3.4, maxW: W * 0.6 }, theme, u * 0.14, under)
  }
  const titleY = H * 0.8
  stamped(ctx, t.title, cx, titleY, { family: theme.titleFont, color: '#fff', size: u * 7.8, maxW: W * 0.86, tracking: u * 0.2 }, theme, u * 0.2, under)
  rule(ctx, cx, titleY + u * 2.6, W * 0.2, theme, u)
  text(ctx, t.hosts, cx, titleY + u * 6.2, {
    family: theme.bodyFont, weight: '600', color: '#fff', size: u * 3, maxW: W * 0.76, tracking: u * 0.38, alpha: 0.96,
  })
  text(ctx, t.meta, cx, H * 0.96, {
    family: theme.bodyFont, color: '#fff', size: u * 2.2, maxW: W * 0.8, tracking: u * 0.24, alpha: 0.76,
  })
}

function renderClosing(ctx: Ctx, W: number, H: number, opts: RenderOpts, theme: Theme, u: number) {
  paperBackground(ctx, W, H, theme)
  drawBorder(ctx, W, H, theme, u, opts.project.album.seed + 21)
  const cx = W / 2
  const slot = opts.page.slots[0]
  if (slot) {
    const d = Math.min(W, H) * 0.34
    drawSlot(
      ctx,
      { ...slot, x: 0, y: 0, w: 1, h: 1, shape: 'circle' },
      { x: cx - d / 2, y: H * 0.17, w: d, h: d },
      { ...opts, project: { ...opts.project, album: { ...opts.project.album, showCaptions: false } } },
      theme,
      u,
    )
  }
  const y = H * 0.68
  if (theme.closingScript) {
    text(ctx, opts.page.subheading || theme.closingScript, cx, y - u * 5, {
      family: opts.project.language === 'english' ? theme.scriptFont : scriptFontFor(opts.project.language),
      color: theme.palette.gold,
      size: u * 5,
      maxW: W * 0.7,
    })
  }
  text(ctx, opts.page.heading ?? theme.closingLine, cx, y, {
    family: theme.titleFont,
    color: theme.palette.ink,
    size: u * 3.6,
    maxW: W * 0.76,
  })
  rule(ctx, cx, y + u * 3, W * 0.18, theme, u)
  text(ctx, opts.project.hosts, cx, y + u * 7, {
    family: theme.bodyFont,
    weight: '600',
    color: theme.palette.accent,
    size: u * 2.8,
    maxW: W * 0.7,
    tracking: u * 0.25,
  })
  text(ctx, opts.project.eventDate, cx, y + u * 10.4, {
    family: theme.bodyFont,
    color: theme.palette.inkSoft,
    size: u * 2.1,
    maxW: W * 0.7,
  })
}

/** Divider page announcing a chapter — the photo behind it is dimmed to a wash. */
function renderChapter(ctx: Ctx, W: number, H: number, opts: RenderOpts, theme: Theme, u: number) {
  paperBackground(ctx, W, H, theme)

  /* A divider belongs to the same album as its cover. Templates whose cover is
     a photograph get a photographic divider, dark, with the type reversed out
     of it; templates whose cover is a board get paper and a motif. A ghost of a
     photograph at 5% reads as a stain either way, which is what this was. */
  const photographic = theme.cover === 'fullbleed' || theme.cover === 'band' || theme.cover === 'duotone'
  const slot = opts.page.slots[0]
  const img = photographic && slot ? opts.cache.get(slot.photoId, opts.quality) : null
  const photo = slot ? opts.photos.get(slot.photoId) : undefined
  const reversed = Boolean(img)

  if (img) {
    drawImageCover(ctx, img, 0, 0, W, H, { x: photo?.focusX ?? 0.5, y: photo?.focusY ?? 0.5 })
    // Taken down far enough that a title can sit on it without a box.
    const wash = ctx.createLinearGradient(0, 0, 0, H)
    const deep = shade(theme.palette.cover, -0.62)
    wash.addColorStop(0, withAlpha(deep, 0.8))
    wash.addColorStop(0.45, withAlpha(deep, 0.91))
    wash.addColorStop(1, withAlpha(deep, 0.8))
    ctx.fillStyle = wash
    ctx.fillRect(0, 0, W, H)
  }

  const ink = reversed ? '#fdf3e3' : theme.palette.ink
  const inkSoft = reversed ? 'rgba(253,243,227,0.78)' : theme.palette.inkSoft
  if (!reversed) drawBorder(ctx, W, H, theme, u, opts.project.album.seed + opts.pageIndex)
  else foilFrame(ctx, W, H, u * 3, theme, u)

  const cx = W / 2
  const cy = H * 0.46

  // A plain double ring frames the title without competing with it.
  ctx.save()
  ctx.translate(cx, cy - u * 1)
  const r = Math.min(W, H) * 0.3
  ctx.strokeStyle = theme.palette.gold
  ctx.globalAlpha = 0.55
  ctx.lineWidth = Math.max(0.5, u * 0.09)
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.globalAlpha = 0.3
  ctx.lineWidth = Math.max(0.4, u * 0.05)
  ctx.beginPath()
  ctx.arc(0, 0, r - u * 1.1, 0, Math.PI * 2)
  ctx.stroke()
  ctx.globalAlpha = 0.7
  ctx.fillStyle = theme.palette.gold
  for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    ctx.save()
    ctx.translate(Math.cos(a) * r, Math.sin(a) * r)
    ctx.rotate(Math.PI / 4)
    ctx.fillRect(-u * 0.38, -u * 0.38, u * 0.76, u * 0.76)
    ctx.restore()
  }
  ctx.restore()

  const native = opts.page.subheading?.trim()
  if (native) {
    text(ctx, native, cx, cy - u * 9.5, {
      family: scriptFontFor(opts.project.language),
      color: theme.palette.gold,
      size: u * 4.4,
      maxW: W * 0.72,
    })
  }
  text(ctx, opts.page.heading ?? '', cx, cy, {
    family: theme.titleFont,
    color: ink,
    size: u * 6.4,
    maxW: W * 0.78,
    tracking: u * 0.1,
  })
  rule(ctx, cx, cy + u * 4, W * 0.2, theme, u)
  if (opts.page.blurb) {
    text(ctx, opts.page.blurb, cx, cy + u * 8.4, {
      family: theme.bodyFont,
      weight: 'italic 400',
      color: inkSoft,
      size: u * 2.6,
      maxW: W * 0.66,
    })
  }
}

function renderPhotos(ctx: Ctx, W: number, H: number, opts: RenderOpts, theme: Theme, u: number) {
  const bled = Boolean(opts.page.bleed)
  paperBackground(ctx, W, H, theme)
  // A decorative frame around a bled photograph is a frame around nothing.
  if (!bled) drawBorder(ctx, W, H, theme, u, opts.project.album.seed + opts.pageIndex)

  /* More paper than before. Every studio note on this says the same thing —
     let the album breathe — and a tight margin is what makes a page look
     like a contact sheet rather than a book. */
  const margin = u * 8
  const bottom = opts.project.album.showPageNumbers ? margin + u * 2 : margin
  const box = bled
    ? { x: 0, y: 0, w: W, h: H }
    : { x: margin, y: margin, w: W - margin * 2, h: H - margin - bottom }

  opts.page.slots.forEach((slot) => drawSlot(ctx, { ...slot, bled }, box, opts, theme, u))

  if (bled) bleedCaption(ctx, W, H, opts, theme, u)

  if (opts.project.album.showPageNumbers) {
    // In the outer corner, small and tracked, the way a printed book sets it —
    // not floating in the middle of the foot.
    const right = opts.pageIndex % 2 === 0
    const px = right ? W - margin * 0.62 : margin * 0.62
    text(ctx, String(opts.pageIndex + 1), px, H - margin * 0.5, {
      family: theme.bodyFont,
      color: bled ? '#ffffff' : theme.palette.inkSoft,
      size: u * 1.7,
      maxW: W * 0.2,
      tracking: u * 0.2,
      alpha: bled ? 0.75 : 0.65,
    })
  }
}

/** One line for a page whose photographs run to the trim. Where the layout has
 *  left paper at the foot it is set in ink on that paper; where the photograph
 *  goes all the way down it is set in white over a short wash, which is what a
 *  printed album does and what a caption box would ruin. */
function bleedCaption(ctx: Ctx, W: number, H: number, opts: RenderOpts, theme: Theme, u: number) {
  if (!opts.project.album.showCaptions) return
  const lead = opts.photos.get(opts.page.slots[0]?.photoId ?? '')
  const caption = lead?.caption?.trim()
  if (!caption) return

  const foot = Math.max(...opts.page.slots.map((s) => s.y + s.h))
  const onPaper = foot < 0.97
  const native = lead?.captionNative?.trim()

  if (!onPaper) {
    const g = ctx.createLinearGradient(0, H * 0.72, 0, H)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(0.7, 'rgba(0,0,0,0.42)')
    g.addColorStop(1, 'rgba(0,0,0,0.7)')
    ctx.fillStyle = g
    ctx.fillRect(0, H * 0.72, W, H * 0.28)
    // A wash alone cannot carry white type over a bright sari, so the line
    // gets its own soft shadow too.
    ctx.shadowColor = 'rgba(0,0,0,0.55)'
    ctx.shadowBlur = u * 1.2
  }

  const ink = onPaper ? theme.palette.inkSoft : '#ffffff'
  const y = onPaper ? H * (foot + (1 - foot) * 0.46) : H * 0.925
  text(ctx, caption, W / 2, y, {
    family: theme.bodyFont,
    weight: 'italic 400',
    color: ink,
    size: u * 1.8,
    maxW: W * 0.7,
    tracking: u * 0.08,
    alpha: onPaper ? 0.92 : 0.95,
  })
  if (native) {
    text(ctx, native, W / 2, y + u * 2.8, {
      family: scriptFontFor(opts.project.language),
      color: onPaper ? theme.palette.accent : '#f6dfae',
      size: u * 1.6,
      maxW: W * 0.7,
      alpha: 0.9,
    })
  }
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
}

/** Paint one album page into `ctx`, which must already be sized W×H. */
export function renderPage(ctx: Ctx, W: number, H: number, opts: RenderOpts): void {
  const theme = themeById(opts.project.album.themeId)
  const u = Math.min(W, H) / 100
  ctx.save()
  ctx.clearRect(0, 0, W, H)
  if (opts.page.kind === 'cover') renderCover(ctx, W, H, opts, theme, u)
  else if (opts.page.kind === 'chapter') renderChapter(ctx, W, H, opts, theme, u)
  else if (opts.page.kind === 'closing') renderClosing(ctx, W, H, opts, theme, u)
  else renderPhotos(ctx, W, H, opts, theme, u)
  ctx.restore()
}

/** Decode every bitmap a page needs, at the requested quality. */
export async function preloadPage(page: AlbumPage, cache: BitmapCache, quality: Quality): Promise<void> {
  await Promise.all(page.slots.map((s) => cache.load(s.photoId, quality).catch(() => null)))
}

export function photoMap(photos: Photo[]): Map<string, Photo> {
  return new Map(photos.map((p) => [p.id, p]))
}
