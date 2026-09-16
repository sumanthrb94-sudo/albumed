import { useState } from 'react'
import { useApp } from '../store'
import { ThemeGallery } from '../components/ThemeGallery'
import { PageCanvas } from '../components/PageCanvas'
import { PAGE_SIZES, THEMES, themeById } from '../lib/themes'
import { LanguagePicker } from '../components/Assistant'
import type { Density } from '../lib/types'

const OCCASIONS = ['All', ...Array.from(new Set(THEMES.map((t) => t.occasion)))]

const DENSITIES: Array<{ id: Density; label: string; hint: string }> = [
  { id: 'airy', label: 'Airy', hint: '1–3 photos a page' },
  { id: 'balanced', label: 'Balanced', hint: '1–4 photos a page' },
  { id: 'dense', label: 'Story', hint: '3–6 photos a page' },
]

export function Design({ nav }: { nav: (hash: string) => void }) {
  const app = useApp()
  const [occasion, setOccasion] = useState('All')
  const project = app.project
  if (!project) return null
  const theme = themeById(project.album.themeId)
  const approved = app.photos.filter((p) => p.status === 'approved')
  const coverPage = app.album?.pages.find((p) => p.kind === 'cover') ?? app.album?.pages[0]

  return (
    <div className="wrap">
      <div className="card">
        <h2>Album template</h2>
        <p className="hint">{theme.blurb}</p>
        <div className="filters" style={{ marginTop: 12 }}>
          {OCCASIONS.map((o) => (
            <button key={o} className={occasion === o ? 'on' : ''} onClick={() => setOccasion(o)}>
              {o}
            </button>
          ))}
        </div>
        <ThemeGallery
          project={project}
          photos={app.photos}
          value={project.album.themeId}
          occasion={occasion === 'All' ? undefined : occasion}
          onChange={(id) => app.updateAlbumOptions({ themeId: id })}
        />
      </div>

      {project.chapters.length > 0 && (
        <div className="card">
          <h2>Running order</h2>
          <p className="hint">
            {project.aiNotes ?? 'The chapters the album is built from. Ask the assistant on the album screen to change them.'}
          </p>
          <ul className="chapters">
            {project.chapters.map((c, i) => (
              <li key={c.id}>
                <span className="n">{i + 1}</span>
                <span>
                  <span className="who">{c.title}</span>
                  {c.titleNative && <span className="native"> · {c.titleNative}</span>}
                  <br />
                  <span className="hint">{c.blurb}</span>
                </span>
                <span className="count">{c.photoIds.length} photos</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h2>Album details</h2>
        <div className="grid2" style={{ marginTop: 10 }}>
          <label className="field">
            <span>Cover title</span>
            <input type="text" value={project.title} onChange={(e) => app.updateProject({ title: e.target.value })} />
          </label>
          <label className="field">
            <span>Names / hosts</span>
            <input type="text" value={project.hosts} onChange={(e) => app.updateProject({ hosts: e.target.value })} />
          </label>
          <label className="field">
            <span>Date</span>
            <input
              type="text"
              placeholder="14 February 2026"
              value={project.eventDate}
              onChange={(e) => app.updateProject({ eventDate: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Venue / city</span>
            <input type="text" value={project.venue} onChange={(e) => app.updateProject({ venue: e.target.value })} />
          </label>
        </div>

        <div className="grid2">
          <LanguagePicker />
          <label className="field">
            <span>Page size</span>
            <select
              value={project.album.pageSizeId}
              onChange={(e) => app.updateAlbumOptions({ pageSizeId: e.target.value })}
            >
              {PAGE_SIZES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Photos per page</span>
            <select
              value={project.album.density}
              onChange={(e) => app.updateAlbumOptions({ density: e.target.value as Density })}
            >
              {DENSITIES.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label} — {d.hint}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="switch">
          <input
            id="cover"
            type="checkbox"
            checked={project.album.includeCover}
            onChange={(e) => app.updateAlbumOptions({ includeCover: e.target.checked })}
          />
          <label htmlFor="cover">Cover page</label>
        </div>
        <div className="switch">
          <input
            id="chapters"
            type="checkbox"
            checked={project.album.includeChapterPages}
            disabled={!project.chapters.length}
            onChange={(e) => app.updateAlbumOptions({ includeChapterPages: e.target.checked })}
          />
          <label htmlFor="chapters">
            Chapter divider pages{!project.chapters.length && ' (ask the assistant to plan the album first)'}
          </label>
        </div>
        <div className="switch">
          <input
            id="closing"
            type="checkbox"
            checked={project.album.includeClosing}
            onChange={(e) => app.updateAlbumOptions({ includeClosing: e.target.checked })}
          />
          <label htmlFor="closing">Closing thank-you page</label>
        </div>
        <div className="switch">
          <input
            id="caps"
            type="checkbox"
            checked={project.album.showCaptions}
            onChange={(e) => app.updateAlbumOptions({ showCaptions: e.target.checked })}
          />
          <label htmlFor="caps">Print captions under photos</label>
        </div>
        <div className="switch">
          <input
            id="nums"
            type="checkbox"
            checked={project.album.showPageNumbers}
            onChange={(e) => app.updateAlbumOptions({ showPageNumbers: e.target.checked })}
          />
          <label htmlFor="nums">Page numbers</label>
        </div>
      </div>

      {coverPage && (
        <div className="card">
          <h2>Cover preview</h2>
          <div style={{ maxWidth: 420, margin: '12px auto 0' }}>
            <PageCanvas
              page={coverPage}
              pageIndex={0}
              pageCount={app.album?.pages.length ?? 1}
              project={project}
              photos={app.photos}
              maxWidth={420}
            />
          </div>
          <p className="hint" style={{ textAlign: 'center', marginTop: 10 }}>
            Cover photo is your first ★ highlight. Star a different photo in Review to change it.
          </p>
        </div>
      )}

      <div className="sticky-actions">
        <button className="btn" onClick={() => app.regenerate()}>
          ↻ Re-shuffle layout
        </button>
        <button className="btn primary" onClick={() => nav(`#/p/${project.id}/album`)} disabled={!approved.length}>
          See the album ({app.album?.pages.length ?? 0} pages) →
        </button>
      </div>
    </div>
  )
}
