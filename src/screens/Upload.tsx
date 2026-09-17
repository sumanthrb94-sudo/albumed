import { useRef, useState } from 'react'
import { useApp } from '../store'
import { PhotoThumb } from '../components/PhotoThumb'
import type { PhotoSource } from '../lib/types'
import { QualityNudge } from '../components/QualityCompare'
import { SendToCustomer } from '../components/SendToCustomer'

export function Upload({ nav }: { nav: (hash: string) => void }) {
  const app = useApp()
  const studio = app.session.role === 'studio'
  const [source, setSource] = useState<PhotoSource>('photographer')
  const [over, setOver] = useState(false)
  const pickRef = useRef<HTMLInputElement | null>(null)
  const camRef = useRef<HTMLInputElement | null>(null)
  const project = app.project
  if (!project) return null

  const take = async (list: FileList | null) => {
    if (!list?.length) return
    await app.addFiles(Array.from(list), source)
  }

  const recent = app.photos.slice(-12).reverse()

  return (
    <div className="wrap">
      <div className="card">
        <h2>Add photos</h2>
        <p className="hint">
          Straight from the phone gallery, the camera, or the folder your photographer shared. Nothing is uploaded to a
          server — the photos stay on this device.
        </p>

        <div className="row" style={{ margin: '14px 0' }}>
          <span className="hint">Adding as:</span>
          <div className="source-toggle" role="group" aria-label="Who is adding these photos">
            <button className={source === 'photographer' ? 'on' : ''} onClick={() => setSource('photographer')}>
              📷 Photographer
            </button>
            <button className={source === 'customer' ? 'on' : ''} onClick={() => setSource('customer')}>
              🙋 Customer
            </button>
          </div>
        </div>

        {!app.plan.limits.printGrade && (
          <div className="notice" style={{ marginBottom: 12 }}>
            <b>Free albums store a compressed copy.</b> Your originals stay in your phone gallery — we
            keep them at {app.plan.limits.ingestMaxPx}px so an album fits on the device. Subscribe before
            uploading to keep print quality, or upgrade later and re-import the same files.
          </div>
        )}

        <div
          className={`drop${over ? ' over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setOver(false)
            take(e.dataTransfer.files)
          }}
        >
          <div className="big">Drop photos here</div>
          <p className="hint">JPG, PNG, WebP, HEIC · rotation from the phone is corrected automatically</p>
          <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
            <button className="btn primary" onClick={() => pickRef.current?.click()}>
              Choose from gallery
            </button>
            <button className="btn" onClick={() => camRef.current?.click()}>
              Take a photo
            </button>
            <button className="btn ghost" onClick={() => app.addSamples(source)}>
              Add sample photos
            </button>
          </div>
          <input
            ref={pickRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              take(e.target.files)
              e.target.value = ''
            }}
          />
          <input
            ref={camRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              take(e.target.files)
              e.target.value = ''
            }}
          />
        </div>

        <div className="stat-row" style={{ justifyContent: 'center' }}>
          <div className="stat">
            <b>
              {app.photos.length}
              <span style={{ fontSize: 14, color: 'var(--ink-soft)' }}> / {app.plan.limits.maxPhotosPerAlbum}</span>
            </b>
            <span>in this album</span>
          </div>
          <div className="stat">
            <b>{app.photos.filter((p) => p.source === 'photographer').length}</b>
            <span>from photographer</span>
          </div>
          <div className="stat">
            <b>{app.photos.filter((p) => p.source === 'customer').length}</b>
            <span>from customer</span>
          </div>
        </div>
      </div>

      {studio && <SendToCustomer />}

      <QualityNudge
        onSubscribe={() =>
          app.showPaywall({
            reason: 'Keep these photos at full quality',
            detail: 'Subscribe and every photo you add is stored print-grade — and you can re-import the ones already here.',
          })
        }
      />

      {recent.length > 0 && (
        <div className="card">
          <h2>Just added</h2>
          <div className="photo-grid" style={{ marginTop: 12 }}>
            {recent.map((p) => (
              <div key={p.id} className="tile">
                <PhotoThumb photoId={p.id} alt={p.name} />
                <span className="badge">{p.source === 'customer' ? 'Customer' : 'Photographer'}</span>
              </div>
            ))}
          </div>
          <button className="btn primary block" style={{ marginTop: 14 }} onClick={() => nav(`#/p/${project.id}/review`)}>
            Next: pick your photos →
          </button>
        </div>
      )}
    </div>
  )
}
