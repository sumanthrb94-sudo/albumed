import { useRef, useState } from 'react'
import { useApp } from '../store'
import { importBundle } from '../lib/bundle'
import { DEFAULT_THEME_ID, REGIONS, THEMES } from '../lib/themes'
import { Inbox } from '../components/Inbox'

export function Home({ nav }: { nav: (hash: string) => void }) {
  const app = useApp()
  const studio = app.session.role === 'studio'
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ title: '', hosts: '', eventDate: '', venue: '', themeId: DEFAULT_THEME_ID })
  const fileRef = useRef<HTMLInputElement | null>(null)

  const create = async () => {
    const p = await app.createProject({
      title: form.title || 'Our Album',
      hosts: form.hosts,
      eventDate: form.eventDate,
      venue: form.venue,
      album: { themeId: form.themeId },
    })
    nav(`#/p/${p.id}/upload`)
  }

  const demo = async () => {
    setBusy(true)
    try {
      const id = await app.startDemo()
      nav(`#/p/${id}/album`)
    } finally {
      setBusy(false)
    }
  }

  const onImport = async (file?: File) => {
    if (!file) return
    setBusy(true)
    try {
      const p = await importBundle(file)
      await app.refreshProjects()
      app.setToast(`Imported "${p.title}".`)
      nav(`#/p/${p.id}/review`)
    } catch (e) {
      app.setToast(e instanceof Error ? e.message : 'Import failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wrap">
      <div className="hero">
        <div className="deva">॥ शुभ आरंभ ॥</div>
        {studio ? (
          <>
            <h2>Send the take to the family</h2>
            <p>
              Make the event, add the photographs, and send it to their mobile number. They pick the keepers on their
              own phone, and the album is laid out from what they chose.
            </p>
          </>
        ) : (
          <>
            <h2>Turn phone photos into a real album</h2>
            <p>
              The photos your photographer sent are waiting under your number. Keep the ones you want, drop the rest —
              and Albumed lays out a print-ready wedding or celebration album from your selection.
            </p>
          </>
        )}
        <div className="row">
          <button className="btn gold" onClick={() => setOpen((v) => !v)}>
            {studio ? '+ New event' : '+ New album'}
          </button>
          <button className="btn ghost" style={{ color: '#f7e6c4', borderColor: 'rgba(255,255,255,.4)' }} onClick={demo} disabled={busy}>
            ▶ Run the demo album
          </button>
          <button
            className="btn ghost"
            style={{ color: '#f7e6c4', borderColor: 'rgba(255,255,255,.4)' }}
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            Import project file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => onImport(e.target.files?.[0])}
          />
        </div>
      </div>

      {!studio && <Inbox nav={nav} />}

      {open && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>{studio ? 'New event' : 'New album'}</h2>
          <p className="hint">You can change all of this later.</p>
          <div className="grid2" style={{ marginTop: 12 }}>
            <label className="field">
              <span>Album title</span>
              <input
                type="text"
                placeholder="Maa Pelli"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Names / hosts</span>
              <input
                type="text"
                placeholder="Sireesha &amp; Karthik"
                value={form.hosts}
                onChange={(e) => setForm({ ...form, hosts: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Date</span>
              <input
                type="text"
                placeholder="14 February 2026"
                value={form.eventDate}
                onChange={(e) => setForm({ ...form, eventDate: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Venue / city</span>
              <input
                type="text"
                placeholder="Kalyana Mandapam, Rajahmundry"
                value={form.venue}
                onChange={(e) => setForm({ ...form, venue: e.target.value })}
              />
            </label>
          </div>
          <label className="field">
            <span>Album style (change any time)</span>
            <select value={form.themeId} onChange={(e) => setForm({ ...form, themeId: e.target.value })}>
              {REGIONS.map((region) => {
                const inRegion = THEMES.filter((t) => t.region === region)
                if (!inRegion.length) return null
                return (
                  <optgroup key={region} label={region}>
                    {inRegion.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} — {t.occasion}
                      </option>
                    ))}
                  </optgroup>
                )
              })}
            </select>
          </label>
          <button className="btn primary block" onClick={create}>
            {studio ? 'Create event' : 'Create album'}
          </button>
        </div>
      )}

      <h2 style={{ margin: '26px 0 12px' }}>{studio ? 'Your events' : 'Your albums'}</h2>
      {app.projects.length === 0 ? (
        <div className="card empty">
          <div className="om">॥ ॐ ॥</div>
          <p>
            {studio
              ? 'No events yet. Make one above, add the take, and send it to the family.'
              : 'No albums yet. Start one above, or run the demo to see the whole flow end to end.'}
          </p>
        </div>
      ) : (
        <div className="project-list">
          {app.projects.map((p) => (
            <button
              key={p.id}
              className="card project-card"
              onClick={() => nav(`#/p/${p.id}/${p.status === 'collecting' ? 'upload' : 'review'}`)}
            >
              <h3>{p.title}</h3>
              <div className="meta">{p.hosts || '—'}</div>
              <div className="meta">
                {[p.eventDate, p.venue].filter(Boolean).join(' · ') || 'No date set'}
              </div>
              <div className="foot">
                <span className={`chip ${p.status}`}>
                  {p.status === 'collecting' ? 'Collecting' : p.status === 'review' ? 'In review' : 'Finalized'}
                </span>
                <span className="meta">{new Date(p.updatedAt).toLocaleDateString()}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
