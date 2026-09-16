/* Export: print-ready PDF, single-page PNG, and a lightweight share sheet. */
import { jsPDF } from 'jspdf'
import { BitmapCache } from './images'
import { pageSizeById } from './themes'
import { photoMap, preloadPage, renderPage, ensureFonts } from './render'
import type { Album, Photo, Project } from './types'

export interface ExportOpts {
  dpi: number
  /** JPEG quality for page images inside the PDF. */
  quality: number
  /** Stamp the pages — the free tier exports a watermarked draft. */
  watermark?: boolean
}

/** Diagonal stamp across an exported page. The point is to be unmistakable in
 *  a print shop without hiding the photograph underneath. */
function stampWatermark(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const u = Math.min(W, H) / 100
  ctx.save()
  ctx.globalAlpha = 0.1
  ctx.fillStyle = '#2c1a14'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `600 ${u * 5}px Mukta, system-ui, sans-serif`
  ctx.translate(W / 2, H / 2)
  ctx.rotate(-Math.PI / 6)
  const text = 'ALBUMED  ·  FREE DRAFT'
  const step = u * 22
  for (let y = -H; y < H; y += step) {
    for (let x = -W; x < W * 1.2; x += ctx.measureText(text).width + u * 10) {
      ctx.fillText(text, x, y)
    }
  }
  ctx.restore()

  ctx.save()
  ctx.globalAlpha = 0.85
  ctx.fillStyle = 'rgba(122,18,32,0.9)'
  ctx.fillRect(0, H - u * 4.2, W, u * 4.2)
  ctx.fillStyle = '#fff3e0'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `600 ${u * 1.9}px Mukta, system-ui, sans-serif`
  ctx.fillText(
    'Draft export · photos stored compressed · subscribe for the print-quality album',
    W / 2,
    H - u * 2.1,
  )
  ctx.restore()
}

export interface ExportProgress {
  page: number
  total: number
  label: string
}

function pagePixels(project: Project, dpi: number) {
  const size = pageSizeById(project.album.pageSizeId)
  return { W: Math.round(size.w * dpi), H: Math.round(size.h * dpi), size }
}

export async function renderPageToCanvas(
  project: Project,
  album: Album,
  photos: Photo[],
  pageIndex: number,
  dpi: number,
  opts?: { watermark?: boolean },
): Promise<HTMLCanvasElement> {
  await ensureFonts(project.language)
  const { W, H } = pagePixels(project, dpi)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const cache = new BitmapCache()
  const page = album.pages[pageIndex]
  await preloadPage(page, cache, 'full')
  renderPage(ctx, W, H, {
    page,
    pageIndex,
    pageCount: album.pages.length,
    project,
    photos: photoMap(photos),
    cache,
    quality: 'full',
  })
  cache.clear()
  if (opts?.watermark) stampWatermark(ctx, W, H)
  return canvas
}

export async function exportPdf(
  project: Project,
  album: Album,
  photos: Photo[],
  opts: ExportOpts,
  onProgress?: (p: ExportProgress) => void,
): Promise<Blob> {
  await ensureFonts(project.language)
  const { W, H, size } = pagePixels(project, opts.dpi)
  const doc = new jsPDF({
    unit: 'in',
    format: [size.w, size.h],
    orientation: size.w >= size.h ? 'landscape' : 'portrait',
    compress: true,
  })
  doc.deletePage(1)

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const map = photoMap(photos)

  for (let i = 0; i < album.pages.length; i++) {
    onProgress?.({ page: i + 1, total: album.pages.length, label: `Rendering page ${i + 1}` })
    const cache = new BitmapCache()
    const page = album.pages[i]
    await preloadPage(page, cache, 'full')
    renderPage(ctx, W, H, {
      page,
      pageIndex: i,
      pageCount: album.pages.length,
      project,
      photos: map,
      cache,
      quality: 'full',
    })
    cache.clear()
    if (opts.watermark) stampWatermark(ctx, W, H)
    const data = canvas.toDataURL('image/jpeg', opts.quality)
    doc.addPage([size.w, size.h], size.w >= size.h ? 'landscape' : 'portrait')
    doc.addImage(data, 'JPEG', 0, 0, size.w, size.h, undefined, 'FAST')
    // Yield so the UI can paint the progress bar.
    await new Promise((r) => setTimeout(r, 0))
  }

  doc.setProperties({
    title: project.title,
    subject: project.hosts,
    creator: 'Albumed',
  })
  return doc.output('blob')
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function safeFilename(s: string): string {
  return (
    s
      .trim()
      .replace(/[^\wऀ-ॿ -]+/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'album'
  )
}

/** Web Share (phones) with a download fallback. */
export async function shareOrDownload(blob: Blob, filename: string, title: string): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], filename, { type: blob.type })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title })
      return 'shared'
    } catch {
      /* user cancelled — fall through to download */
    }
  }
  downloadBlob(blob, filename)
  return 'downloaded'
}
