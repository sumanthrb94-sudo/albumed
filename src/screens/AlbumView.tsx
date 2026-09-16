import { useEffect, useState } from 'react'
import { useApp } from '../store'
import { PageCanvas } from '../components/PageCanvas'
import { AlbumChat } from '../components/AlbumChat'
import { downloadBlob, exportPdf, renderPageToCanvas, safeFilename, shareOrDownload } from '../lib/pdf'
import { exportBundle, mergeDecisions } from '../lib/bundle'
import { canvasToBlob } from '../lib/images'
import { pageSizeById, themeById } from '../lib/themes'
import { exportDpiOptions } from '../lib/plan'
import { useRef } from 'react'

export function AlbumView({ nav }: { nav: (hash: string) => void }) {
  const app = useApp()
  const [busy, setBusy] = useState<string | null>(null)
  const [pct, setPct] = useState(0)
  const [dpi, setDpi] = useState(150)
  const mergeRef = useRef<HTMLInputElement | null>(null)
  const reimportRef = useRef<HTMLInputElement | null>(null)
  const planLimits = app.plan.limits

  // Every hook must run on every render, so this sits above the early returns
  // below. Subscribing should not leave the export on the draft setting, and
  // downgrading must not leave it on a resolution the plan cannot use.
  useEffect(() => {
    setDpi((current) =>
      Math.min(Math.max(current, planLimits.printGrade ? 300 : 150), planLimits.maxExportDpi),
    )
  }, [planLimits.printGrade, planLimits.maxExportDpi])

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

  const limits = app.plan.limits
  const compressed = app.photos.filter((p) => p.status === 'approved' && p.printGrade === false).length

  const doPdf = async () => {
    setBusy('Building your PDF…')
    setPct(0)
    try {
      const blob = await exportPdf(
        project,
        album,
        app.photos,
        { dpi: Math.min(dpi, limits.maxExportDpi), quality: 0.92, watermark: limits.watermark },
        (p) => {
          setBusy(`${p.label} of ${p.total}…`)
          setPct(Math.round((p.page / p.total) * 100))
        },
      )
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
      const canvas = await renderPageToCanvas(project, album, app.photos, index, Math.min(dpi, limits.maxExportDpi), {
        watermark: limits.watermark,
      })
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
            <select
              value={dpi}
              onChange={(e) => {
                const next = Number(e.target.value)
                if (next > limits.maxExportDpi) {
                  app.showPaywall({
                    reason: 'That resolution needs a subscription',
                    detail: `${app.plan.name} exports up to ${limits.maxExportDpi} dpi. Press-ready albums go to 300 dpi and above.`,
                  })
                  return
                }
                setDpi(next)
              }}
            >
              {exportDpiOptions(app.plan.id).map((o) => (
                <option key={o.dpi} value={o.dpi}>
                  {o.label}
                  {o.locked ? ' 🔒' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {limits.watermark && (
        <div className="card ai-card">
          <h2>This album will export as a draft</h2>
          <p className="hint">
            On {app.plan.name}, exports carry a watermark and cap at {limits.maxExportDpi} dpi
            {compressed > 0 && `, and ${compressed} of the photos in it are stored compressed`}. The
            layout, the chapters and every edit stay exactly as they are when you subscribe — only the
            quality changes.
          </p>
          <button
            className="btn gold"
            onClick={() =>
              app.showPaywall({
                reason: 'Export this album press-ready',
                detail: 'No watermark, 300 dpi, and your photos at the quality they were taken.',
              })
            }
          >
            See what a subscription changes
          </button>
        </div>
      )}

      {!limits.watermark && compressed > 0 && (
        <div className="card ai-card">
          <h2>{compressed} photos are still the compressed copies</h2>
          <p className="hint">
            They were added on the free plan. Pick the same files from your gallery again and they will
            be swapped for print-quality versions — the album, its chapters and your edits stay as they
            are.
          </p>
          <button className="btn gold" disabled={Boolean(busy)} onClick={() => reimportRef.current?.click()}>
            Re-import my originals
          </button>
          <input
            ref={reimportRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={async (e) => {
              const files = Array.from(e.target.files ?? [])
              e.target.value = ''
              if (!files.length) return
              setBusy('Bringing in your originals…')
              try {
                await app.reimportOriginals(files)
              } finally {
                setBusy(null)
              }
            }}
          />
        </div>
      )}

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
