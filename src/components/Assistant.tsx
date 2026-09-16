import { useState } from 'react'
import { useApp } from '../store'
import { CEREMONY_LABELS, LANGUAGE_LABELS, LANGUAGES, type Language } from '../lib/aiContract'
import type { Photo } from '../lib/types'

export function AiOffNotice({ reason }: { reason?: string }) {
  return (
    <div className="notice">
      <b>The album assistant is off.</b>{' '}
      {reason ?? 'Start the Albumed server with an ANTHROPIC_API_KEY to turn it on.'} Everything else — uploading,
      reviewing, templates, layout and PDF export — works without it.
    </div>
  )
}

export function LanguagePicker() {
  const app = useApp()
  const project = app.project
  if (!project) return null
  return (
    <label className="field" style={{ maxWidth: 280 }}>
      <span>Printed caption language</span>
      <select value={project.language} onChange={(e) => app.setLanguage(e.target.value as Language)}>
        {LANGUAGES.map((l) => (
          <option key={l} value={l}>
            {LANGUAGE_LABELS[l]}
          </option>
        ))}
      </select>
    </label>
  )
}

/** The verdict chips shown under a photo once the assistant has looked at it. */
export function PhotoVerdictChips({ photo }: { photo: Photo }) {
  if (!photo.ceremony && photo.aiScore === undefined) return null
  return (
    <div className="verdict">
      {photo.ceremony && <span className="tag">{CEREMONY_LABELS[photo.ceremony]}</span>}
      {photo.aiScore !== undefined && (
        <span className={`tag score${photo.aiScore >= 70 ? ' good' : photo.aiScore < 45 ? ' weak' : ''}`}>
          {photo.aiScore}
        </span>
      )}
      {photo.aiIssues?.slice(0, 2).map((i) => (
        <span key={i} className="tag issue">
          {i.replace(/-/g, ' ')}
        </span>
      ))}
    </div>
  )
}

/** Curate + plan controls, shown on the review step. */
export function CuratePanel({ onPlanned }: { onPlanned?: () => void }) {
  const app = useApp()
  const [expanded, setExpanded] = useState(false)
  const project = app.project
  if (!project) return null

  const curated = app.photos.filter((p) => p.aiScore !== undefined).length
  const approved = app.photos.filter((p) => p.status === 'approved').length
  const busy = Boolean(app.ai.busy)

  return (
    <div className="card ai-card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2>Album assistant</h2>
          <p className="hint">
            {app.ai.enabled
              ? 'It looks at every photo, sorts them by ceremony, drops the weak frames and writes the captions.'
              : 'Currently unavailable.'}
          </p>
        </div>
        {app.ai.enabled && <span className="chip finalized">{app.ai.model}</span>}
      </div>

      {!app.ai.enabled ? (
        <AiOffNotice reason={app.ai.reason} />
      ) : (
        <>
          <div className="grid2" style={{ marginTop: 12 }}>
            <LanguagePicker />
            <label className="field">
              <span>What is the occasion? (helps it name things correctly)</span>
              <input
                type="text"
                placeholder="Tamil brahmin muhurtham, then a reception in Chennai"
                value={project.occasionNote}
                onChange={(e) => app.updateProject({ occasionNote: e.target.value })}
              />
            </label>
          </div>

          <div className="row">
            <button className="btn primary" disabled={busy || !app.photos.length} onClick={() => app.runCurate()}>
              {curated ? '↻ Review the photos again' : '✦ Review my photos'}
            </button>
            <button
              className="btn gold"
              disabled={busy || approved < 2}
              onClick={async () => {
                if (await app.runStory()) onPlanned?.()
              }}
            >
              ✦ Plan the album
            </button>
            {app.canUndo && (
              <button className="btn ghost" disabled={busy} onClick={() => app.undoAiEdit()}>
                ↶ Undo
              </button>
            )}
          </div>

          {app.ai.busy && <p className="hint">{app.ai.busy}</p>}

          {curated > 0 && (
            <>
              <p className="hint" style={{ marginTop: 10 }}>
                Reviewed {curated} of {app.photos.length} photos. Every call is a suggestion — change anything you
                disagree with.
              </p>
              <button className="btn sm ghost" onClick={() => setExpanded((v) => !v)}>
                {expanded ? 'Hide' : 'Show'} what it said
              </button>
              {expanded && (
                <ul className="reasons">
                  {app.photos
                    .filter((p) => p.aiReason)
                    .map((p) => (
                      <li key={p.id}>
                        <b className={p.status === 'approved' ? 'ok' : 'no'}>
                          {p.status === 'approved' ? 'Keep' : 'Drop'}
                        </b>{' '}
                        <span className="tag">{p.ceremony ? CEREMONY_LABELS[p.ceremony] : '—'}</span> {p.aiReason}
                      </li>
                    ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
