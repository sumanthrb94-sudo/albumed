import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../store'
import { PhotoThumb } from '../components/PhotoThumb'
import { fullUrl } from '../lib/images'
import { CuratePanel, PhotoVerdictChips } from '../components/Assistant'
import { CEREMONY_LABELS } from '../lib/aiContract'
import { QualityNudge } from '../components/QualityCompare'
import type { Photo, PhotoStatus } from '../lib/types'

type Filter = 'all' | PhotoStatus | 'starred' | 'photographer' | 'customer'

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'To review' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Not in album' },
  { id: 'starred', label: '★ Highlights' },
  { id: 'photographer', label: 'From photographer' },
  { id: 'customer', label: 'From customer' },
]

function Lightbox({
  photo,
  onClose,
  onPrev,
  onNext,
}: {
  photo: Photo
  onClose: () => void
  onPrev: () => void
  onNext: () => void
}) {
  const app = useApp()
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let revoked: string | null = null
    fullUrl(photo.id).then((u) => {
      revoked = u
      setUrl(u)
    })
    return () => {
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [photo.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') onPrev()
      if (e.key === 'ArrowRight') onNext()
      if (e.key.toLowerCase() === 'a') app.setStatus([photo.id], 'approved')
      if (e.key.toLowerCase() === 'r') app.setStatus([photo.id], 'rejected')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [app, photo.id, onClose, onNext, onPrev])

  return (
    <div className="lightbox" role="dialog" aria-label={photo.name}>
      <div className="bar">
        <button className="btn sm ghost" style={{ color: '#f5e9d8' }} onClick={onClose}>
          ✕ Close
        </button>
        <span className="grow" />
        <button className="btn sm ghost" style={{ color: '#f5e9d8' }} onClick={onPrev}>
          ← Prev
        </button>
        <button className="btn sm ghost" style={{ color: '#f5e9d8' }} onClick={onNext}>
          Next →
        </button>
      </div>
      <div className="stage">{url ? <img src={url} alt={photo.name} /> : <span>Loading…</span>}</div>
      <div className="bar">
        <button
          className={`btn sm${photo.status === 'approved' ? ' primary' : ''}`}
          onClick={() => app.setStatus([photo.id], 'approved')}
        >
          ✓ Keep in album
        </button>
        <button
          className={`btn sm${photo.status === 'rejected' ? ' danger' : ''}`}
          onClick={() => app.setStatus([photo.id], 'rejected')}
        >
          ✕ Leave out
        </button>
        <button className="btn sm" onClick={() => app.patchPhoto(photo.id, { starred: !photo.starred })}>
          {photo.starred ? '★ Highlight' : '☆ Highlight'}
        </button>
        <button className="btn sm danger" onClick={() => {
          app.removePhoto(photo.id)
          onClose()
        }}>
          Delete
        </button>
      </div>
      {photo.aiReason && (
        <div className="bar" style={{ fontSize: 13, opacity: 0.85 }}>
          <span className="tag">{photo.ceremony ? CEREMONY_LABELS[photo.ceremony] : 'Assistant'}</span>
          <span>{photo.aiReason}</span>
        </div>
      )}
      <div className="bar">
        <input
          type="text"
          placeholder="Caption printed under this photo…"
          value={photo.caption}
          onChange={(e) => app.patchPhoto(photo.id, { caption: e.target.value })}
        />
        <input
          type="text"
          placeholder="Note to the photographer (not printed)…"
          value={photo.note}
          onChange={(e) => app.patchPhoto(photo.id, { note: e.target.value })}
        />
      </div>
    </div>
  )
}

export function Review({ nav }: { nav: (hash: string) => void }) {
  const app = useApp()
  const [filter, setFilter] = useState<Filter>('all')
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  const project = app.project

  const shown = useMemo(() => {
    const list = app.photos
    switch (filter) {
      case 'all':
        return list
      case 'starred':
        return list.filter((p) => p.starred)
      case 'photographer':
      case 'customer':
        return list.filter((p) => p.source === filter)
      default:
        return list.filter((p) => p.status === filter)
    }
  }, [app.photos, filter])

  if (!project) return null

  const counts = {
    approved: app.photos.filter((p) => p.status === 'approved').length,
    pending: app.photos.filter((p) => p.status === 'pending').length,
    rejected: app.photos.filter((p) => p.status === 'rejected').length,
  }

  const bulk = (status: PhotoStatus) => app.setStatus(shown.map((p) => p.id), status)

  return (
    <div className="wrap">
      <CuratePanel onPlanned={() => nav(`#/p/${project.id}/album`)} />

      <div className="card">
        <h2>Pick your photos</h2>
        <p className="hint">
          Tap a photo to see it big. Keep what you love. Star the ones that deserve a full page.
        </p>
        <div className="stat-row">
          <div className="stat">
            <b style={{ color: 'var(--green)' }}>{counts.approved}</b>
            <span>keeping</span>
          </div>
          <div className="stat">
            <b>{counts.pending}</b>
            <span>to look at</span>
          </div>
          <div className="stat">
            <b style={{ color: 'var(--red)' }}>{counts.rejected}</b>
            <span>dropped</span>
          </div>
        </div>

        {!app.plan.limits.printGrade && (
          <div className="quota">
            <span>
              The assistant reviews <b>{app.plan.limits.aiPhotoLimit}</b> photos per album on{' '}
              {app.plan.name}.
            </span>
            <button
              className="btn sm gold"
              onClick={() =>
                app.showPaywall({
                  reason: 'Have the assistant review every photo',
                  detail: `${app.plan.name} covers ${app.plan.limits.aiPhotoLimit} photos in an album. A subscription covers all of them.`,
                })
              }
            >
              Upgrade
            </button>
          </div>
        )}

        <div className="filters">
          {FILTERS.map((f) => (
            <button key={f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>

        {shown.length > 0 && (
          <div className="row" style={{ marginBottom: 10 }}>
            <span className="hint">Apply to all {shown.length} shown:</span>
            <button className="btn sm" onClick={() => bulk('approved')}>
              ✓ Keep all
            </button>
            <button className="btn sm" onClick={() => bulk('rejected')}>
              ✕ Leave all out
            </button>
            <button className="btn sm ghost" onClick={() => bulk('pending')}>
              ↺ Reset
            </button>
          </div>
        )}

        {app.photos.length === 0 ? (
          <div className="empty">
            <div className="om">॥ ॐ ॥</div>
            <p>No photos yet.</p>
            <button className="btn primary" onClick={() => nav(`#/p/${project.id}/upload`)}>
              Add photos
            </button>
          </div>
        ) : (
          <div className="photo-grid">
            {shown.map((p) => {
              const idx = app.photos.findIndex((x) => x.id === p.id)
              return (
                <div key={p.id} className={`tile ${p.status}`}>
                  <div style={{ position: 'absolute', inset: 0 }} onClick={() => setOpenIdx(idx)} role="button" tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && setOpenIdx(idx)} aria-label={`Open ${p.name}`}>
                    <PhotoThumb photoId={p.id} alt={p.name} />
                  </div>
                  <span className="badge">{p.source === 'customer' ? 'Customer' : 'Photographer'}</span>
                  {p.starred && <span className="star">★</span>}
                  <PhotoVerdictChips photo={p} />
                  <div className="acts">
                    <button
                      className={`yes${p.status === 'approved' ? ' on' : ''}`}
                      onClick={() => app.setStatus([p.id], p.status === 'approved' ? 'pending' : 'approved')}
                      aria-label="Keep in album"
                    >
                      ✓
                    </button>
                    <button
                      className={`no${p.status === 'rejected' ? ' on' : ''}`}
                      onClick={() => app.setStatus([p.id], p.status === 'rejected' ? 'pending' : 'rejected')}
                      aria-label="Leave out"
                    >
                      ✕
                    </button>
                    <button
                      className={p.starred ? 'on' : ''}
                      onClick={() => app.patchPhoto(p.id, { starred: !p.starred })}
                      aria-label="Highlight"
                    >
                      ★
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="sticky-actions">
        {project.status === 'finalized' ? (
          <>
            <span className="chip finalized">Selection confirmed</span>
            <button className="btn" onClick={app.reopen}>
              Reopen selection
            </button>
            <button className="btn primary" onClick={() => nav(`#/p/${project.id}/album`)}>
              Open album →
            </button>
          </>
        ) : (
          <button className="btn primary" disabled={!counts.approved} onClick={async () => {
            await app.finalize()
            nav(`#/p/${project.id}/design`)
          }}>
            Make my album — {counts.approved} photos
          </button>
        )}
      </div>

      {/* A delivered album never passes through the uploader, so this is the
          only place its owner is shown what the free tier keeps. It sits under
          the photographs: look at them first, then at what they will print like. */}
      <QualityNudge
        onSubscribe={() =>
          app.showPaywall({
            reason: 'Keep these photos at full quality',
            detail:
              'Your photographer sent these at print quality. A free album keeps a smaller copy. Subscribe and this album keeps what was sent.',
          })
        }
      />

      {openIdx !== null && app.photos[openIdx] && (
        <Lightbox
          photo={app.photos[openIdx]}
          onClose={() => setOpenIdx(null)}
          onPrev={() => setOpenIdx((i) => (i === null ? null : (i - 1 + app.photos.length) % app.photos.length))}
          onNext={() => setOpenIdx((i) => (i === null ? null : (i + 1) % app.photos.length))}
        />
      )}
    </div>
  )
}
