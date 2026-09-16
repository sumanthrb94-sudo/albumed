import { useEffect, useRef, useState } from 'react'
import { previewCache } from '../lib/images'
import { ensureFonts, photoMap, preloadPage, renderPage } from '../lib/render'
import { pageSizeById } from '../lib/themes'
import type { AlbumPage, Photo, Project } from '../lib/types'

interface Props {
  page: AlbumPage
  pageIndex: number
  pageCount: number
  project: Project
  photos: Photo[]
  /** Longest edge of the backing bitmap, in CSS pixels before DPR. */
  maxWidth?: number
}

/** Renders one album page with the same painter the PDF export uses. */
export function PageCanvas({ page, pageIndex, pageCount, project, photos, maxWidth = 900 }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const [, force] = useState(0)

  useEffect(() => {
    let alive = true
    const canvas = ref.current
    if (!canvas) return
    const size = pageSizeById(project.album.pageSizeId)
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const W = Math.round(Math.min(maxWidth, 1400) * dpr)
    const H = Math.round((W * size.h) / size.w)
    canvas.width = W
    canvas.height = H
    canvas.style.aspectRatio = `${size.w} / ${size.h}`
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const paint = () =>
      renderPage(ctx, W, H, {
        page,
        pageIndex,
        pageCount,
        project,
        photos: photoMap(photos),
        cache: previewCache,
        quality: 'thumb',
        allowPlaceholders: true,
      })

    paint()
    Promise.all([ensureFonts(), preloadPage(page, previewCache, 'thumb')]).then(() => {
      if (!alive) return
      paint()
      force((n) => n + 1)
    })
    return () => {
      alive = false
    }
  }, [page, pageIndex, pageCount, project, photos, maxWidth])

  return <canvas ref={ref} role="img" aria-label={`Album page ${pageIndex + 1} of ${pageCount}`} />
}
