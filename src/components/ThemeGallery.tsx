import { useEffect, useRef } from 'react'
import { previewCache } from '../lib/images'
import { ensureFonts, photoMap, preloadPage, renderPage } from '../lib/render'
import { THEMES, type Theme } from '../lib/themes'
import type { AlbumPage, Photo, Project } from '../lib/types'

/** A miniature cover rendered with the real painter, so the picker shows the truth. */
function ThemeSwatch({ theme, project, photos }: { theme: Theme; project: Project; photos: Photo[] }) {
  const ref = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let alive = true
    const canvas = ref.current
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const W = Math.round(300 * dpr)
    const H = Math.round(325 * dpr)
    canvas.width = W
    canvas.height = H
    canvas.style.aspectRatio = '300 / 325'
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const hero = photos.find((p) => p.status === 'approved') ?? photos[0]
    const page: AlbumPage = {
      id: `swatch-${theme.id}`,
      kind: 'cover',
      templateId: 'cover',
      slots: hero ? [{ x: 0, y: 0, w: 1, h: 1, photoId: hero.id, shape: theme.shape }] : [],
      heading: project.title || theme.defaultTitle,
      subheading: project.hosts || 'Priya & Arjun',
    }
    const themed: Project = { ...project, album: { ...project.album, themeId: theme.id, showCaptions: false } }
    const draw = () =>
      renderPage(ctx, W, H, {
        page,
        pageIndex: 0,
        pageCount: 1,
        project: themed,
        photos: photoMap(photos),
        cache: previewCache,
        quality: 'thumb',
      })
    draw()
    Promise.all([ensureFonts(project.language), preloadPage(page, previewCache, 'thumb')]).then(() => alive && draw())
    return () => {
      alive = false
    }
  }, [theme, project, photos])

  return <canvas ref={ref} />
}

interface Props {
  project: Project
  photos: Photo[]
  value: string
  onChange: (themeId: string) => void
  /** Show only templates from this region; omit for all. */
  region?: string
}

export function ThemeGallery({ project, photos, value, onChange, region }: Props) {
  const list = region ? THEMES.filter((t) => t.region === region) : THEMES
  return (
    <div className="theme-grid">
      {list.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`theme-card${value === t.id ? ' on' : ''}`}
          onClick={() => onChange(t.id)}
          aria-pressed={value === t.id}
          title={t.blurb}
        >
          <ThemeSwatch theme={t} project={project} photos={photos} />
          <div className="tmeta">
            <b>{t.name}</b>
            <span>
              {t.occasion} · {t.region}
            </span>
          </div>
        </button>
      ))}
    </div>
  )
}
