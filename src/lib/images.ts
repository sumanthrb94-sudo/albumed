/* Image decoding, thumbnailing and a small bitmap cache.
   Phone photos carry EXIF rotation, so every decode goes through
   createImageBitmap(..., { imageOrientation: 'from-image' }). */
import { getBlobs } from './db'

export const THUMB_MAX = 640

/** The true-detail sample kept alongside a compressed photo, so the customer
 *  can see for themselves what the free tier costs them. */
export const SAMPLE_PX = 560

export interface Decoded {
  bitmap: ImageBitmap
  width: number
  height: number
}

async function decode(blob: Blob, maxPx?: number): Promise<Decoded> {
  const opts: ImageBitmapOptions = { imageOrientation: 'from-image' }
  let bitmap = await createImageBitmap(blob, opts)
  if (maxPx && Math.max(bitmap.width, bitmap.height) > maxPx) {
    const scale = maxPx / Math.max(bitmap.width, bitmap.height)
    const next = await createImageBitmap(bitmap, {
      resizeWidth: Math.round(bitmap.width * scale),
      resizeHeight: Math.round(bitmap.height * scale),
      resizeQuality: 'high',
    })
    bitmap.close()
    bitmap = next
  }
  return { bitmap, width: bitmap.width, height: bitmap.height }
}

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob failed'))), type, quality),
  )
}

export interface PreparedImage {
  full: Blob
  thumb: Blob
  width: number
  height: number
  /** The dimensions of the photo as it came off the phone. */
  sourceWidth: number
  sourceHeight: number
  /** A 1:1 crop at the original resolution — what the photo really looks like. */
  sampleReal?: Blob
  /** The same crop taken from the stored copy — what this plan will print. */
  sampleStored?: Blob
}

export interface IngestOptions {
  /** Longest edge to keep. */
  maxPx: number
  /** JPEG quality to keep. */
  quality: number
  /** Also build the before/after detail pair. */
  withSample?: boolean
}

/** Crops a square from the middle-upper part of the frame, where faces usually are. */
function sampleRect(w: number, h: number, size: number) {
  const side = Math.min(size, w, h)
  return {
    sx: Math.round((w - side) / 2),
    sy: Math.round(Math.max(0, h * 0.38 - side / 2)),
    side,
  }
}

/** Decode an uploaded file, bake in EXIF rotation, and store it at the plan's quality. */
export async function prepareUpload(file: Blob, opts: IngestOptions): Promise<PreparedImage> {
  const { bitmap, width, height } = await decode(file)
  try {
    // Re-encode so rotation is baked in and HEIC/huge files shrink.
    const scale = Math.min(1, opts.maxPx / Math.max(width, height))
    const fullCanvas = canvasOf(Math.round(width * scale), Math.round(height * scale))
    fullCanvas.getContext('2d')!.drawImage(bitmap, 0, 0, fullCanvas.width, fullCanvas.height)
    const full = await canvasToBlob(fullCanvas, 'image/jpeg', opts.quality)

    const ts = Math.min(1, THUMB_MAX / Math.max(width, height))
    const thumbCanvas = canvasOf(Math.round(width * ts), Math.round(height * ts))
    thumbCanvas.getContext('2d')!.drawImage(bitmap, 0, 0, thumbCanvas.width, thumbCanvas.height)
    const thumb = await canvasToBlob(thumbCanvas, 'image/jpeg', 0.8)

    let sampleReal: Blob | undefined
    let sampleStored: Blob | undefined
    if (opts.withSample) {
      const { sx, sy, side } = sampleRect(width, height, SAMPLE_PX)
      const realCanvas = canvasOf(side, side)
      realCanvas.getContext('2d')!.drawImage(bitmap, sx, sy, side, side, 0, 0, side, side)
      sampleReal = await canvasToBlob(realCanvas, 'image/jpeg', 0.95)

      // The same patch as it survives in the stored copy, blown back up to match.
      const storedBitmap = await createImageBitmap(full)
      const storedCanvas = canvasOf(side, side)
      const sctx = storedCanvas.getContext('2d')!
      sctx.imageSmoothingQuality = 'high'
      sctx.drawImage(
        storedBitmap,
        sx * scale,
        sy * scale,
        side * scale,
        side * scale,
        0,
        0,
        side,
        side,
      )
      storedBitmap.close()
      sampleStored = await canvasToBlob(storedCanvas, 'image/jpeg', 0.95)
    }

    return {
      full,
      thumb,
      width: fullCanvas.width,
      height: fullCanvas.height,
      sourceWidth: width,
      sourceHeight: height,
      sampleReal,
      sampleStored,
    }
  } finally {
    bitmap.close()
  }
}

/* ---------- object-URL cache for <img> thumbnails ---------- */

const urlCache = new Map<string, string>()

export async function thumbUrl(photoId: string): Promise<string | null> {
  const hit = urlCache.get(photoId)
  if (hit) return hit
  const rec = await getBlobs(photoId)
  if (!rec) return null
  const url = URL.createObjectURL(rec.thumb)
  urlCache.set(photoId, url)
  return url
}

export function releaseThumbUrl(photoId: string): void {
  const url = urlCache.get(photoId)
  if (url) {
    URL.revokeObjectURL(url)
    urlCache.delete(photoId)
  }
}

export async function fullUrl(photoId: string): Promise<string | null> {
  const rec = await getBlobs(photoId)
  return rec ? URL.createObjectURL(rec.full) : null
}

/** The two halves of the detail comparison, as object URLs the caller must revoke. */
export async function sampleUrls(photoId: string): Promise<{ real: string; stored: string } | null> {
  const rec = await getBlobs(photoId)
  if (!rec?.sampleReal || !rec.sampleStored) return null
  return { real: URL.createObjectURL(rec.sampleReal), stored: URL.createObjectURL(rec.sampleStored) }
}

/* ---------- bitmap cache used by the page renderer ---------- */

export type Quality = 'thumb' | 'full'

export class BitmapCache {
  private map = new Map<string, Decoded>()
  private inflight = new Map<string, Promise<Decoded | null>>()

  private key(photoId: string, q: Quality) {
    return `${q}:${photoId}`
  }

  get(photoId: string, q: Quality): Decoded | null {
    return this.map.get(this.key(photoId, q)) ?? null
  }

  async load(photoId: string, q: Quality): Promise<Decoded | null> {
    const key = this.key(photoId, q)
    const hit = this.map.get(key)
    if (hit) return hit
    const pending = this.inflight.get(key)
    if (pending) return pending
    const p = (async () => {
      const rec = await getBlobs(photoId)
      if (!rec) return null
      const dec = await decode(q === 'thumb' ? rec.thumb : rec.full)
      this.map.set(key, dec)
      this.inflight.delete(key)
      return dec
    })()
    this.inflight.set(key, p)
    return p
  }

  clear(): void {
    this.map.forEach((d) => d.bitmap.close())
    this.map.clear()
  }
}

/** Shared cache for on-screen previews (thumbnails only — cheap to hold). */
export const previewCache = new BitmapCache()

/* ---------- sample photos (for "try it without uploading") ----------

   Real photographs first: the quality comparison only means something on skin,
   zari and jewellery, which is exactly what a drawn shape cannot show. These
   ship with the app and are generated, not taken — no real family is in them.
   The procedural set below fills in beyond what we have. */

interface RealSample {
  file: string
  label: string
}

const REAL_SAMPLES: RealSample[] = [
  { file: 'samples/01-pellikuthuru.jpg', label: 'Pellikuthuru' },
  { file: 'samples/02-jeelakarra-bellam.jpg', label: 'Jeelakarra Bellam' },
  { file: 'samples/03-talambralu.jpg', label: 'Talambralu' },
  { file: 'samples/04-snathakam.jpg', label: 'Snathakam' },
  { file: 'samples/05-kashi-yatra.jpg', label: 'Kashi Yatra' },
  { file: 'samples/06-kanyadanam.jpg', label: 'Kanyadanam' },
  { file: 'samples/07-appaginthalu.jpg', label: 'Appaginthalu' },
  { file: 'samples/08-family-portrait.jpg', label: 'Family Portrait' },
  { file: 'samples/09-mandapam.jpg', label: 'Mandapam' },
  { file: 'samples/10-reception.jpg', label: 'Reception' },
]

async function loadRealSample(i: number): Promise<{ blob: Blob; name: string } | null> {
  const sample = REAL_SAMPLES[i]
  if (!sample) return null
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}${sample.file}`)
    if (!res.ok) return null
    const blob = await res.blob()
    return { blob, name: `${sample.label.toLowerCase().replace(/\s+/g, '-')}.jpg` }
  } catch {
    // Offline, or the file was not deployed — fall back to a drawn one.
    return null
  }
}

/* ---------- procedural sample photos ---------- */

/* Only reached when a sample photo cannot be fetched — offline, or a build
   that did not ship public/samples. */
const SAMPLE_SCENES: Array<{ label: string; hues: [number, number]; portrait: boolean }> = [
  { label: 'Snathakam', hues: [95, 140], portrait: true },
  { label: 'Kashi Yatra', hues: [22, 42], portrait: false },
  { label: 'Madhuparkam', hues: [340, 15], portrait: true },
  { label: 'Jeelakarra Bellam', hues: [5, 30], portrait: true },
  { label: 'Mangalsutra', hues: [350, 20], portrait: true },
  { label: 'Talambralu', hues: [35, 60], portrait: false },
  { label: 'Kanyadanam', hues: [15, 40], portrait: false },
  { label: 'Appaginthalu', hues: [200, 230], portrait: false },
  { label: 'Muggu', hues: [320, 10], portrait: false },
  { label: 'Reception', hues: [280, 330], portrait: true },
  { label: 'Sannai Melam', hues: [180, 215], portrait: false },
]

/** A real photograph where we have one, a drawn stand-in otherwise. */
export async function makeSamplePhoto(index: number): Promise<{ blob: Blob; name: string }> {
  const real = await loadRealSample(index)
  if (real) return real
  return drawSamplePhoto(index)
}

/** Builds a recognisable placeholder "photo" so the whole flow can be tried offline. */
async function drawSamplePhoto(index: number): Promise<{ blob: Blob; name: string }> {
  const scene = SAMPLE_SCENES[index % SAMPLE_SCENES.length]
  const w = scene.portrait ? 1200 : 1600
  const h = scene.portrait ? 1600 : 1200
  const c = canvasOf(w, h)
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, w, h)
  g.addColorStop(0, `hsl(${scene.hues[0]} 70% 62%)`)
  g.addColorStop(1, `hsl(${scene.hues[1]} 65% 38%)`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  // soft bokeh
  for (let i = 0; i < 60; i++) {
    const r = 20 + Math.random() * 120
    ctx.globalAlpha = 0.05 + Math.random() * 0.12
    ctx.fillStyle = i % 3 === 0 ? '#fff6d8' : `hsl(${scene.hues[1] + Math.random() * 30} 90% 70%)`
    ctx.beginPath()
    ctx.arc(Math.random() * w, Math.random() * h, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  // silhouette figures so crops look plausible
  ctx.fillStyle = 'rgba(40,12,20,0.55)'
  const base = h * 0.92
  const figures = scene.portrait ? 1 : 3
  for (let i = 0; i < figures; i++) {
    const cx = w * ((i + 1) / (figures + 1))
    const fh = h * (scene.portrait ? 0.58 : 0.42)
    ctx.beginPath()
    ctx.arc(cx, base - fh, fh * 0.17, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(cx - fh * 0.3, base)
    ctx.quadraticCurveTo(cx, base - fh * 0.95, cx + fh * 0.3, base)
    ctx.closePath()
    ctx.fill()
  }

  // Fine detail — zari thread, embroidery, small type. Smooth gradients survive
  // compression untouched; this is the part that turns to mush, which is the
  // whole point of the quality comparison.
  const cx0 = w * 0.5
  const cy0 = h * 0.42
  ctx.save()
  ctx.globalAlpha = 0.5
  ctx.lineWidth = 1
  for (let i = 0; i < 170; i++) {
    const a = (i / 170) * Math.PI * 2
    ctx.strokeStyle = i % 2 ? 'rgba(255,240,190,0.9)' : 'rgba(90,40,20,0.7)'
    ctx.beginPath()
    ctx.moveTo(cx0 + Math.cos(a) * w * 0.1, cy0 + Math.sin(a) * w * 0.1)
    ctx.lineTo(cx0 + Math.cos(a) * w * 0.23, cy0 + Math.sin(a) * w * 0.23)
    ctx.stroke()
  }
  for (let r = w * 0.11; r < w * 0.23; r += 3) {
    ctx.strokeStyle = r % 6 < 3 ? 'rgba(255,245,210,0.55)' : 'rgba(60,25,15,0.4)'
    ctx.beginPath()
    ctx.arc(cx0, cy0, r, 0, Math.PI * 2)
    ctx.stroke()
  }
  // a woven grid, like the border of a sari
  for (let x = 0; x < w; x += 4) {
    ctx.strokeStyle = x % 8 < 4 ? 'rgba(255,238,180,0.35)' : 'rgba(70,30,15,0.25)'
    ctx.beginPath()
    ctx.moveTo(x, h * 0.62)
    ctx.lineTo(x, h * 0.72)
    ctx.stroke()
  }
  ctx.restore()

  ctx.fillStyle = 'rgba(255,248,230,0.92)'
  ctx.font = `600 ${Math.round(w * 0.05)}px Marcellus, Georgia, serif`
  ctx.textBaseline = 'bottom'
  ctx.fillText(`${scene.label} · sample`, w * 0.06, h * 0.95)
  // deliberately small type, the first thing to go
  ctx.font = `400 ${Math.round(w * 0.014)}px Mukta, system-ui, sans-serif`
  ctx.fillStyle = 'rgba(255,250,235,0.85)'
  ctx.fillText('fine detail · zari · embroidery · jewellery · fine print at 1.4%', w * 0.06, h * 0.975)

  const blob = await canvasToBlob(c, 'image/jpeg', 0.86)
  return { blob, name: `sample-${String(index + 1).padStart(2, '0')}-${scene.label.toLowerCase()}.jpg` }
}

export const SAMPLE_COUNT = Math.max(SAMPLE_SCENES.length, REAL_SAMPLES.length)
export const REAL_SAMPLE_COUNT = REAL_SAMPLES.length
