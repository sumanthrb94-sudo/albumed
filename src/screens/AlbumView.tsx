import { useState } from 'react'
import { useApp } from '../store'
import { PageCanvas } from '../components/PageCanvas'
import { AlbumChat } from '../components/AlbumChat'
import { downloadBlob, exportPdf, renderPageToCanvas, safeFilename, shareOrDownload } from '../lib/pdf'
import { exportBundle, mergeDecisions } from '../lib/bundle'
import { canvasToBlob } from '../lib/images'
import { pageSizeById, themeById } from '../lib/themes'
import { useRef } from 'react'

export function AlbumView({ nav }: { nav: (hash: string) => void }) {
  const app = useApp()
  const [busy, setBusy] = useState<string | null>(null)
  const [pct, setPct] = useState(0)
  const [dpi, setDpi] = useState(200)
  const mergeRef = useRef<HTMLInputElement | null>(null)
  const project = app.project
  const album = app.album

  if (!project) return null

  if (!album || !album.pages.length) {
    return (
      <div className="wrap">
        <div className="card empty">
          <div className="om">॥ ॐ ॥</div>
          <p>No album yet. Approve some photos and confirm the selection first.</p>
          <button className="btn primary" onClick={() => nav(`#/p/${project.id}/review`)}>
            Go to review
          </button>
        </div>
      </div>
    )
  }

  const size = pageSizeById(project.album.pageSizeId)
  const theme = themeById(project.album.themeId)
  const base = safeFilename(`${project.title}-${project.hosts}`)

  const doPdf = async () => {
    setBusy('Building your PDF…')
    setPct(0)
    try {
      const blob = await exportPdf(project, album, app.photos, { dpi, quality: 0.92 }, (p) => {
        setBusy(`${p.label} of ${p.total}…`)
        setPct(Math.round((p.page / p.total) * 100))
      })
      const how = await shareOrDownload(blob, `${base}.pdf`, project.title)
      app.setToast(how === 'shared' ? 'Album shared.' : `Saved ${base}.pdf (${(blob.size / 1048576).toFixed(1)} MB)`)
    } catch (e) {
      app.setToast(e instanceof Error ? e.message : 'Export failed.')
    } finally {
      setBusy(null)
    }
  }

  const doPng = async (index: number) => {
    setBusy(`Rendering page ${index + 1}…`)
    try {
      const canvas = await renderPageToCanvas(project, album, app.photos, index, dpi)
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.94)
      await shareOrDownload(blob, `${base}-page-${index + 1}.jpg`, project.title)
    } finally {
      setBusy(null)
    }
  }

  const doBundle = async (thumbsOnly: boolean) => {
    setBusy(thumbsOnly ? 'Packing a light review copy…' : 'Packing the full project…')
    setPct(0)
    try {
      const blob = await exportBundle(project, { thumbsOnly }, (d, t) => setPct(Math.round((d / t) * 100)))
      const how = await shareOrDownload(blob, `${base}${thumbsOnly ? '-review' : ''}.albumed.json`, project.title)
      app.setToast(how === 'shared' ? 'Project shared.' : 'Project file saved.')
    } finally {
      setBusy(null)
    }
  }

  const doMerge = async (file?: File) => {
    if (!file) return
    setBusy('Reading decisions…')
    try {
      const r = await mergeDecisions(project, file)
      await app.openProject(project.id)
      app.setToast(`Updated ${r.updated} photos${r.skipped ? `, ${r.skipped} not matched` : ''}.`)
    } catch (e) {
      app.setToast(e instanceof Error ? e.message : 'Could not read that file.')
    } finally {
      setBusy(null)
    }
  }

  const photoPages = album.pages.filter((p) => p.kind === 'photos').length

  return (
    <div className="wrap">
      <div className="card">
        <h2>{project.title}</h2>
        <p className="hint">
          {theme.name} · {size.label} · {album.pages.length} pages ({photoPages} photo pages) ·{' '}
          {app.photos.filter((p) => p.status === 'approved').length} photos
        </p>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={doPdf} disabled={Boolean(busy)}>
            ⬇ Download album PDF
          </button>
          <button className="btn" onClick={() => app.regenerate()} disabled={Boolean(busy)}>
            ↻ Re-shuffle layout
          </button>
          <button className="btn ghost" onClick={() => nav(`#/p/${project.id}/design`)}>
            Change template
          </button>
          <label className="row" style={{ gap: 6 }}>
            <span className="hint">Print quality</span>
            <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
              <option value={150}>Draft 150 dpi</option>
              <option value={200}>Good 200 dpi</option>
              <option value={300}>Print 300 dpi</option>
            </select>
          </label>
        </div>
      </div>

      <AlbumChat />

      <div className="card">
        <h2>Share &amp; handover</h2>
        <p className="hint">
          Everything lives on this device. Send a project file to move the album — or to get the customer's approvals
          back.
        </p>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn sm" onClick={() => doBundle(true)} disabled={Boolean(busy)}>
            Send light copy for review
          </button>
          <button className="btn sm" onClick={() => doBundle(false)} disabled={Boolean(busy)}>
            Export full project
          </button>
          <button className="btn sm ghost" onClick={() => mergeRef.current?.click()} disabled={Boolean(busy)}>
            Merge decisions back in
          </button>
          <input
            ref={mergeRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              doMerge(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </div>
      </div>

      <div className="pages" style={{ marginTop: 18 }}>
        {album.pages.map((page, i) => (
          <div className="page-item" key={page.id}>
            <PageCanvas
              page={page}
              pageIndex={i}
              pageCount={album.pages.length}
              project={project}
              photos={app.photos}
              maxWidth={900}
            />
            <div className="page-tools">
              <span className="lbl">
                {page.kind === 'cover'
                  ? 'Cover'
                  : page.kind === 'chapter'
                    ? `Chapter · ${page.heading ?? ''}`
                    : page.kind === 'closing'
                      ? 'Closing'
                      : `Page ${i + 1}`}
              </span>
              {page.kind === 'photos' && (
                <>
                  <button className="btn sm ghost" onClick={() => app.shufflePage(page.id)}>
                    ↻ Layout
                  </button>
                  <button className="btn sm ghost" onClick={() => app.movePage(page.id, -1)}>
                    ↑
                  </button>
                  <button className="btn sm ghost" onClick={() => app.movePage(page.id, 1)}>
                    ↓
                  </button>
                </>
              )}
              <button className="btn sm ghost" onClick={() => doPng(i)}>
                ⬇ JPG
              </button>
            </div>
          </div>
        ))}
      </div>

      {busy && (
        <div className="progress-wrap">
          <div className="progress">
            <b>{busy}</b>
            <div className="bar">
              <i style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export { downloadBlob }
