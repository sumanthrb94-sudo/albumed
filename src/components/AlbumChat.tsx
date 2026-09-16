import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store'
import { AiOffNotice, DemoBadge } from './Assistant'

const SUGGESTIONS = [
  'Make it look like a traditional Tamil muhurtham album',
  'Give the thaali moment a full page of its own',
  'Put the reception chapter at the end',
  'Drop anything blurry or with eyes closed',
  'Captions in Tamil as well as English',
  'Fewer photos per page, more white space',
]

/** The natural-language editor: the customer asks, the assistant re-edits the album. */
export function AlbumChat() {
  const app = useApp()
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [app.chat.length, app.ai.busy])

  const busy = Boolean(app.ai.busy)

  const send = async (text: string) => {
    if (!text.trim() || busy) return
    setDraft('')
    await app.sendEdit(text.trim())
  }

  return (
    <div className="card ai-card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2>Edit with the assistant</h2>
          <p className="hint">Ask for changes the way you would ask a designer. It edits the real album.</p>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {app.canUndo && (
            <button className="btn sm ghost" disabled={busy} onClick={() => app.undoAiEdit()}>
              ↶ Undo
            </button>
          )}
          {app.chat.length > 0 && (
            <button className="btn sm ghost" onClick={app.clearChat}>
              Clear
            </button>
          )}
        </div>
      </div>

      <DemoBadge />

      {!app.ai.enabled ? (
        <AiOffNotice reason={app.ai.reason} />
      ) : (
        <>
          <div className="chat" role="log" aria-live="polite">
            {app.chat.length === 0 && (
              <p className="hint">
                Try one of these, or type your own — in English or the way you would say it at home.
              </p>
            )}
            {app.chat.map((turn, i) => (
              <div key={i} className={`bubble ${turn.role}${turn.failed ? ' failed' : ''}`}>
                <p>{turn.content}</p>
                {turn.changes && turn.changes.length > 0 && (
                  <ul className="changes">
                    {turn.changes.map((c, j) => (
                      <li key={j}>{c}</li>
                    ))}
                  </ul>
                )}
                {turn.rejected && turn.rejected.length > 0 && (
                  <ul className="changes rejected">
                    {turn.rejected.map((c, j) => (
                      <li key={j}>{c}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            {busy && <div className="bubble assistant pending">{app.ai.busy}</div>}
            <div ref={endRef} />
          </div>

          {app.chat.length === 0 && (
            <div className="filters">
              {SUGGESTIONS.map((s) => (
                <button key={s} disabled={busy} onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}

          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault()
              send(draft)
            }}
          >
            <input
              className="grow"
              type="text"
              placeholder="What would you like changed?"
              value={draft}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button className="btn primary" type="submit" disabled={busy || !draft.trim()}>
              Send
            </button>
          </form>
        </>
      )}
    </div>
  )
}
