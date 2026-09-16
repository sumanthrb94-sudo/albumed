/* Image decoding, thumbnailing and a small bitmap cache.
   Phone photos carry EXIF rotation, so every decode goes through
   createImageBitmap(..., { imageOrientation: 'from-image' }). */
import { getBlobs } from './db'

export const THUMB_MAX = 640

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
}

/** Decode an uploaded file, bake in EXIF rotation, and build a thumbnail. */
export async function prepareUpload(file: Blob): Promise<PreparedImage> {
  const { bitmap, width, height } = await decode(file)
  try {
    // Re-encode the full image so rotation is baked in and HEIC/huge files shrink.
    const maxFull = 3000
    const scale = Math.min(1, maxFull / Math.max(width, height))
    const fullCanvas = canvasOf(Math.round(width * scale), Math.round(height * scale))
    fullCanvas.getContext('2d')!.drawImage(bitmap, 0, 0, fullCanvas.width, fullCanvas.height)
    const full = await canvasToBlob(fullCanvas, 'image/jpeg', 0.92)

    const ts = Math.min(1, THUMB_MAX / Math.max(width, height))
    const thumbCanvas = canvasOf(Math.round(width * ts), Math.round(height * ts))
    thumbCanvas.getContext('2d')!.drawImage(bitmap, 0, 0, thumbCanvas.width, thumbCanvas.height)
    const thumb = await canvasToBlob(thumbCanvas, 'image/jpeg', 0.8)

    return { full, thumb, width: fullCanvas.width, height: fullCanvas.height }
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

/* ---------- procedural sample photos (for "try it without uploading") ---------- */

const SAMPLE_SCENES: Array<{ label: string; hues: [number, number]; portrait: boolean }> = [
  { label: 'Baraat', hues: [22, 42], portrait: false },
  { label: 'Varmala', hues: [340, 15], portrait: true },
  { label: 'Haldi', hues: [45, 55], portrait: false },
  { label: 'Mehendi', hues: [95, 140], portrait: true },
  { label: 'Sangeet', hues: [255, 295], portrait: false },
  { label: 'Pheras', hues: [5, 30], portrait: true },
  { label: 'Vidaai', hues: [200, 230], portrait: false },
  { label: 'Reception', hues: [280, 330], portrait: true },
  { label: 'Family', hues: [15, 40], portrait: false },
  { label: 'Mandap', hues: [35, 60], portrait: true },
  { label: 'Rangoli', hues: [320, 10], portrait: false },
  { label: 'Dhol', hues: [180, 215], portrait: false },
]

/** Builds a recognisable placeholder "photo" so the whole flow can be tried offline. */
export async function makeSamplePhoto(index: number): Promise<{ blob: Blob; name: string }> {
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

  ctx.fillStyle = 'rgba(255,248,230,0.92)'
  ctx.font = `600 ${Math.round(w * 0.05)}px Marcellus, Georgia, serif`
  ctx.textBaseline = 'bottom'
  ctx.fillText(`${scene.label} · sample`, w * 0.06, h * 0.95)

  const blob = await canvasToBlob(c, 'image/jpeg', 0.86)
  return { blob, name: `sample-${String(index + 1).padStart(2, '0')}-${scene.label.toLowerCase()}.jpg` }
}

export const SAMPLE_COUNT = SAMPLE_SCENES.length
