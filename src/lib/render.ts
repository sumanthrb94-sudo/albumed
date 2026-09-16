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
  english: ['"Cormorant Garamond"', 'Sample'],
  hindi: ['"Tiro Devanagari Hindi"', 'शुभ विवाह'],
  tamil: ['"Noto Serif Tamil"', 'திருமணம்'],
  telugu: ['"Noto Serif Telugu"', 'పెళ్లి'],
  kannada: ['"Noto Serif Kannada"', 'ಮದುವೆ'],
  malayalam: ['"Noto Serif Malayalam"', 'വിവാഹം'],
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
  ctx.fillStyle = o.color
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
  const showCaption = opts.project.album.showCaptions && Boolean(photo?.caption)
  const twoLine = showCaption && Boolean(photo?.captionNative?.trim())
  const capH = showCaption ? Math.min(h * (twoLine ? 0.24 : 0.16), u * (twoLine ? 5.2 : 3.2)) : 0
  const ih = h - capH
  const shape = resolveShape(slot.shape, w, ih)

  ctx.save()
  // drop shadow
  ctx.shadowColor = 'rgba(48,20,10,0.28)'
  ctx.shadowBlur = u * 1.1
  ctx.shadowOffsetY = u * 0.28
  ctx.fillStyle = '#ffffff'
  shapePath(ctx, shape, x, y, w, ih, u)
  ctx.fill()
  ctx.restore()

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

  // hairline frame
  ctx.save()
  ctx.strokeStyle = theme.palette.gold
  ctx.globalAlpha = 0.8
  ctx.lineWidth = Math.max(0.5, u * 0.07)
  shapePath(ctx, shape, x, y, w, ih, u)
  ctx.stroke()
  ctx.restore()

  if (showCaption && photo) {
    const native = photo.captionNative?.trim()
    const cy = y + ih + capH * (native ? 0.5 : 0.72)
    text(ctx, photo.caption, x + w / 2, cy, {
      family: theme.bodyFont,
      weight: 'italic 400',
      color: theme.palette.inkSoft,
      size: Math.min(capH * (native ? 0.42 : 0.62), u * 1.5),
      maxW: w * 0.96,
    })
    if (native) {
      text(ctx, native, x + w / 2, y + ih + capH * 0.95, {
        family: scriptFontFor(opts.project.language),
        color: theme.palette.accent,
        size: Math.min(capH * 0.44, u * 1.4),
        maxW: w * 0.96,
      })
    }
  }
}

/* ---------- pages ---------- */

function renderCover(ctx: Ctx, W: number, H: number, opts: RenderOpts, theme: Theme, u: number) {
  const g = ctx.createLinearGradient(0, 0, W * 0.4, H)
  g.addColorStop(0, theme.palette.cover)
  g.addColorStop(1, theme.palette.coverAlt)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)

  const rand = rng(opts.project.album.seed + 7)
  if (theme.motif === 'confetti') M.confettiField(ctx, 0, 0, W, H, u * 4, theme, rand, 70)

  // faint watermark medallion, behind everything
  ctx.save()
  ctx.globalAlpha = 0.07
  ctx.translate(W / 2, H * 0.4)
  M.mandala(ctx, Math.min(W, H) * 0.36, theme)
  ctx.restore()

  ctx.save()
  ctx.strokeStyle = theme.palette.gold
  ctx.globalAlpha = 0.75
  ctx.lineWidth = Math.max(0.6, u * 0.1)
  ctx.strokeRect(u * 3, u * 3, W - u * 6, H - u * 6)
  ctx.globalAlpha = 0.4
  ctx.lineWidth = Math.max(0.4, u * 0.05)
  ctx.strokeRect(u * 3.9, u * 3.9, W - u * 7.8, H - u * 7.8)
  ctx.restore()

  const cx = W / 2
  const ink = theme.palette.coverInk

  if (theme.script) {
    text(ctx, theme.script, cx, H * 0.145, {
      family: theme.scriptFont,
      color: theme.palette.gold,
      size: u * 4.2,
      maxW: W * 0.7,
    })
  }

  // hero photo
  const ph = H * 0.38
  const pw = Math.min(W * 0.62, ph * 0.9)
  const px = cx - pw / 2
  const py = H * 0.21
  const slot = opts.page.slots[0]
  if (slot) {
    drawSlot(
      ctx,
      { ...slot, x: 0, y: 0, w: 1, h: 1, shape: theme.shape === 'rect' ? 'rect' : theme.shape },
      { x: px, y: py, w: pw, h: ph },
      { ...opts, project: { ...opts.project, album: { ...opts.project.album, showCaptions: false } } },
      theme,
      u,
    )
  }

  const titleY = H * 0.71
  text(ctx, opts.page.heading ?? opts.project.title, cx, titleY, {
    family: theme.titleFont,
    color: ink,
    size: u * 6.2,
    maxW: W * 0.82,
    tracking: u * 0.12,
  })
  rule(ctx, cx, titleY + u * 2.6, W * 0.22, theme, u)

  text(ctx, opts.page.subheading ?? opts.project.hosts, cx, titleY + u * 7, {
    family: theme.bodyFont,
    weight: '600',
    color: ink,
    size: u * 3.6,
    maxW: W * 0.78,
    tracking: u * 0.3,
    alpha: 0.95,
  })

  const meta = [opts.project.eventDate, opts.project.venue].filter(Boolean).join('  ·  ')
  text(ctx, meta, cx, H * 0.92, {
    family: theme.bodyFont,
    color: ink,
    size: u * 2.4,
    maxW: W * 0.8,
    tracking: u * 0.2,
    alpha: 0.8,
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

  const slot = opts.page.slots[0]
  const img = slot ? opts.cache.get(slot.photoId, opts.quality) : null
  const photo = slot ? opts.photos.get(slot.photoId) : undefined
  if (img) {
    drawImageCover(ctx, img, 0, 0, W, H, { x: photo?.focusX ?? 0.5, y: photo?.focusY ?? 0.5 })
    // A wash that leaves the photo readable at the edges and clears a band for the title.
    const wash = ctx.createLinearGradient(0, 0, 0, H)
    wash.addColorStop(0, `${theme.palette.paper}b3`)
    wash.addColorStop(0.32, `${theme.palette.paper}f2`)
    wash.addColorStop(0.68, `${theme.palette.paper}f2`)
    wash.addColorStop(1, `${theme.palette.paper}b3`)
    ctx.fillStyle = wash
    ctx.fillRect(0, 0, W, H)
  }

  drawBorder(ctx, W, H, theme, u, opts.project.album.seed + opts.pageIndex)

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
    color: theme.palette.ink,
    size: u * 6.4,
    maxW: W * 0.78,
    tracking: u * 0.1,
  })
  rule(ctx, cx, cy + u * 4, W * 0.2, theme, u)
  if (opts.page.blurb) {
    text(ctx, opts.page.blurb, cx, cy + u * 8.4, {
      family: theme.bodyFont,
      weight: 'italic 400',
      color: theme.palette.inkSoft,
      size: u * 2.6,
      maxW: W * 0.66,
    })
  }
}

function renderPhotos(ctx: Ctx, W: number, H: number, opts: RenderOpts, theme: Theme, u: number) {
  paperBackground(ctx, W, H, theme)
  drawBorder(ctx, W, H, theme, u, opts.project.album.seed + opts.pageIndex)

  const margin = u * 6.4
  const bottom = opts.project.album.showPageNumbers ? margin + u * 2.4 : margin
  const box = { x: margin, y: margin, w: W - margin * 2, h: H - margin - bottom }
  opts.page.slots.forEach((slot) => drawSlot(ctx, slot, box, opts, theme, u))

  if (opts.project.album.showPageNumbers) {
    text(ctx, String(opts.pageIndex + 1), W / 2, H - margin * 0.55, {
      family: theme.bodyFont,
      color: theme.palette.inkSoft,
      size: u * 1.9,
      maxW: W * 0.2,
      alpha: 0.8,
    })
  }
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
