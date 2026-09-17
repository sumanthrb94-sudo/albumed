import { useEffect, useState } from 'react'
import { useApp } from '../store'
import { displayPhone } from '../screens/SignIn'
import { DEMO_STUDIO } from '../lib/studio'

/** What the photographer has sent to this number, waiting to be opened.
 *  This is the first thing a customer sees, because it is the reason they
 *  signed in: their photos are already here. */
export function Inbox({ nav }: { nav: (hash: string) => void }) {
  const app = useApp()
  const [busy, setBusy] = useState<string | null>(null)

  if (!app.inbox.length) return null

  const open = async (id: string) => {
    setBusy(id)
    try {
      const projectId = await app.openInboxItem(id)
      nav(`#/p/${projectId}/review`)
    } catch (e) {
      app.setToast(e instanceof Error ? e.message : 'Could not open that.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="inbox" data-testid="inbox">
      <h2>Sent to you</h2>
      {app.inbox.map((d) => (
        <div key={d.id} className="card delivery">
          <div className="delivery-head">
            <div>
              <h3>{d.event.hosts || d.event.title}</h3>
              <div className="meta">
                From <b>{d.studioName}</b> · {displayPhone(d.studioPhone)}
              </div>
              <div className="meta">
                {[d.event.eventDate, d.event.venue].filter(Boolean).join(' · ')}
              </div>
            </div>
            <span className="count">
              <b>{d.photos.length}</b>
              <span>photos</span>
            </span>
          </div>

          <div className="delivery-strip">
            {d.photos.slice(0, 8).map((p) => (
              <Thumb key={p.meta.id} blob={p.thumb} alt={p.meta.name} />
            ))}
            {d.photos.length > 8 && <span className="more">+{d.photos.length - 8}</span>}
          </div>

          {d.message && <p className="delivery-note">“{d.message}”</p>}

          <button className="btn primary block" disabled={busy === d.id} onClick={() => open(d.id)}>
            {busy === d.id ? 'Opening…' : `Open and pick your photos`}
          </button>

          {d.studioPhone === DEMO_STUDIO.phone && (
            <p className="hint delivery-demo">
              Demo delivery — nobody really shot this. In use, your photographer sends the take to your number and it
              appears here.
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

function Thumb({ blob, alt }: { blob: Blob; alt: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url ? <img src={url} alt={alt} draggable={false} /> : <span className="ph" />
}
