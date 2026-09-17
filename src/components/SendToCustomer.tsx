import { useState } from 'react'
import { useApp } from '../store'
import { isValidPhone, normalisePhone } from '../lib/auth'
import { displayPhone } from '../screens/SignIn'

/** The studio's half of the handover: address the take to the family's mobile
 *  numbers. A wedding has two or three people who get a say, which is why this
 *  takes a list rather than one number. */
export function SendToCustomer() {
  const app = useApp()
  const project = app.project
  const [numbers, setNumbers] = useState<string[]>([''])
  const [studioName, setStudioName] = useState('Raju Photo Studio, Rajahmundry')
  const [message, setMessage] = useState('Full take from the wedding — pick the ones you want in the album.')
  const [busy, setBusy] = useState(false)

  if (!project) return null

  const mine = app.sent.filter((d) => d.event.title === project.title)
  const valid = numbers.filter((n) => isValidPhone(n))
  const ready = valid.length > 0 && app.photos.length > 0

  const send = async () => {
    setBusy(true)
    try {
      const { sent, rejected } = await app.sendToCustomer({ toPhones: numbers, studioName, message })
      setNumbers([''])
      app.setToast(
        rejected.length
          ? `Sent to ${sent} number${sent > 1 ? 's' : ''}. Could not read: ${rejected.join(', ')}.`
          : `Sent ${app.photos.length} photos to ${sent} number${sent > 1 ? 's' : ''}.`,
      )
    } catch (e) {
      app.setToast(e instanceof Error ? e.message : 'Could not send.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card send-card">
      <h2>Send to the family</h2>
      <p className="hint">
        They sign in with this number. The photos will be there. Add everyone who gets a say.
      </p>

      <div className="recipients" style={{ marginTop: 14 }}>
        {numbers.map((n, i) => (
          <div className="send-row" key={i}>
            <span className="cc">+91</span>
            <input
              type="tel"
              inputMode="numeric"
              placeholder="98765 43210"
              aria-label={`Customer mobile number ${i + 1}`}
              value={n}
              onChange={(e) => setNumbers(numbers.map((v, j) => (j === i ? e.target.value : v)))}
            />
            {numbers.length > 1 && (
              <button
                className="btn sm ghost drop-recipient"
                aria-label={`Remove number ${i + 1}`}
                onClick={() => setNumbers(numbers.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => setNumbers([...numbers, ''])}>
        + Another number
      </button>

      <label className="field" style={{ marginTop: 16 }}>
        <span>Studio name</span>
        <input type="text" value={studioName} onChange={(e) => setStudioName(e.target.value)} aria-label="Studio name" />
      </label>
      <label className="field">
        <span>A line for them</span>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} aria-label="Message to the customer" />
      </label>

      {/* You cannot send what you did not keep: a studio on Free has only
          compressed copies, and the family will print from those. */}
      <p className={`hint send-quality${app.plan.limits.printGrade ? ' good' : ' warn'}`}>
        {app.plan.limits.printGrade ? (
          <>
            Sending at print quality, up to {app.plan.limits.ingestMaxPx}px — what the family keeps then depends on
            their own plan.
          </>
        ) : (
          <>
            <b>These will go out compressed.</b> {app.plan.name} keeps photos at {app.plan.limits.ingestMaxPx}px, so
            that is all there is to send.{' '}
            <button
              className="linkish"
              onClick={() =>
                app.showPaywall({
                  reason: 'Send your customers the real files',
                  detail: 'A studio plan stores every photo print-grade, which is what a printed album needs.',
                })
              }
            >
              See studio plans
            </button>
          </>
        )}
      </p>

      <button className="btn primary block" disabled={!ready || busy} onClick={send}>
        {app.photos.length
          ? `Send ${app.photos.length} photos${valid.length ? ` to ${valid.length} number${valid.length > 1 ? 's' : ''}` : ''}`
          : 'Add photos first'}
      </button>

      {mine.length > 0 && (
        <div className="sent-list">
          {mine.map((d) =>
            d.toPhones.map((phone) => (
              <div className="sent-item" key={`${d.id}-${phone}`}>
                <span className="who">{displayPhone(phone)}</span>
                <span className="meta">
                  {d.photos.length} photos · {new Date(d.sentAt).toLocaleDateString()}
                </span>
                {d.openedBy[normalisePhone(phone)] ? (
                  <span className="opened">✓ Opened</span>
                ) : (
                  <span className="waiting">Waiting</span>
                )}
              </div>
            )),
          )}
        </div>
      )}
    </div>
  )
}
