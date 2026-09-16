import { useRef, useState } from 'react'
import { useApp } from '../store'
import { importBundle } from '../lib/bundle'
import { THEMES } from '../lib/themes'

const OCCASIONS = Array.from(new Set(THEMES.map((t) => t.occasion)))

export function Home({ nav }: { nav: (hash: string) => void }) {
  const app = useApp()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ title: '', hosts: '', eventDate: '', venue: '', themeId: THEMES[0].id })
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
        <h2>Turn phone photos into a real album</h2>
        <p>
          Upload the raw shots from your phone or the ones your photographer sent, review them together, finalize the
          keepers — and Albumed lays out a print-ready wedding or celebration album for you.
        </p>
        <div className="row">
          <button className="btn gold" onClick={() => setOpen((v) => !v)}>
            + New album
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

      {open && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>New album</h2>
          <p className="hint">You can change all of this later.</p>
          <div className="grid2" style={{ marginTop: 12 }}>
            <label className="field">
              <span>Album title</span>
              <input
                type="text"
                placeholder="Our Wedding"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Names / hosts</span>
              <input
                type="text"
                placeholder="Priya &amp; Arjun"
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
                placeholder="Umaid Bhawan, Jodhpur"
                value={form.venue}
                onChange={(e) => setForm({ ...form, venue: e.target.value })}
              />
            </label>
          </div>
          <label className="field">
            <span>Occasion style (change any time)</span>
            <select value={form.themeId} onChange={(e) => setForm({ ...form, themeId: e.target.value })}>
              {OCCASIONS.map((occ) => (
                <optgroup key={occ} label={occ}>
                  {THEMES.filter((t) => t.occasion === occ).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <button className="btn primary block" onClick={create}>
            Create album
          </button>
        </div>
      )}

      <h2 style={{ margin: '26px 0 12px' }}>Your albums</h2>
      {app.projects.length === 0 ? (
        <div className="card empty">
          <div className="om">॥ ॐ ॥</div>
          <p>No albums yet. Start one above, or run the demo to see the whole flow end to end.</p>
        </div>
      ) : (
        <div className="project-list">
          {app.projects.map((p) => (
            <button key={p.id} className="card project-card" onClick={() => nav(`#/p/${p.id}/upload`)}>
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
