import { useEffect, useRef, useState } from 'react'
import {
  currentChallenge,
  formatPhone,
  isValidPhone,
  issueCode,
  normalisePhone,
  OTP_LENGTH,
  RESEND_COOLDOWN_MS,
  verifyCode,
  type Challenge,
  type Role,
} from '../lib/auth'

/* The first screen has to do two jobs at once: let someone in, and tell
   someone who has never seen this what the product is. Three lines, short
   words, in the order the thing actually happens. */
const STORY = [
  { n: '1', title: 'Your studio sends the photos', sub: 'Straight to your mobile number' },
  { n: '2', title: 'You keep the ones you love', sub: 'Tap to keep or drop — the AI helps' },
  { n: '3', title: 'We make the album', sub: 'Print-ready pages, in your language' },
] as const

/* Six frames from the sample take. Nothing says "wedding album" faster than
   the photographs themselves, and these are ~25KB each. */
const STRIP = [
  '01-pellikuthuru.jpg',
  '11-muhurtham-thaali.jpg',
  '03-talambralu.jpg',
  '07-appaginthalu.jpg',
  '09-mandapam.jpg',
  '10-reception.jpg',
]

const ROLES: Array<{ id: Role; label: string; hint: string }> = [
  { id: 'customer', label: 'I am the family', hint: 'My photos were sent to me' },
  { id: 'studio', label: 'I am the studio', hint: 'I shot the event' },
]

/** Phone sign-in. The code is generated here and shown on screen, because
 *  there is no SMS provider behind this — the banner says exactly that. */
export function SignIn({ onSignedIn }: { onSignedIn: (phone: string) => void }) {
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<Role>('customer')
  const [challenge, setChallenge] = useState<Challenge | null>(() => currentChallenge())
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const codeRef = useRef<HTMLInputElement | null>(null)

  const step: 'phone' | 'code' = challenge ? 'code' : 'phone'

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus()
  }, [step])

  // Counts the resend cooldown down so the button is never a dead end.
  useEffect(() => {
    if (!challenge) return
    const tick = () => {
      const left = challenge.issuedAt + RESEND_COOLDOWN_MS - Date.now()
      setCooldown(left > 0 ? Math.ceil(left / 1000) : 0)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [challenge])

  const send = (e?: React.FormEvent) => {
    e?.preventDefault()
    const result = issueCode(phone, role)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    setCode('')
    setChallenge(result.challenge)
  }

  const check = (e?: React.FormEvent) => {
    e?.preventDefault()
    const result = verifyCode(code)
    if (!result.ok) {
      setError(result.error)
      setCode('')
      if (!currentChallenge()) setChallenge(null) // burnt or expired — start again
      codeRef.current?.focus()
      return
    }
    setError(null)
    onSignedIn(result.session.phone)
  }

  return (
    <div className="signin">
      <div className="signin-inner">
        <section className="signin-story">
          <div className="mark">
            <img src="/icon-192.png" alt="" width={44} height={44} />
            <div>
              <h1>Albumed</h1>
              <span className="deva">एल्बम बनाइए</span>
            </div>
          </div>

          <p className="promise">
            Your wedding,
            <br />
            as a real album.
          </p>

          <div className="filmstrip" aria-hidden>
            {STRIP.map((f, i) => (
              <img key={f} src={`/samples/thumbs/${f}`} alt="" loading={i < 3 ? 'eager' : 'lazy'} draggable={false} />
            ))}
          </div>

          <ol className="story">
            {STORY.map((s) => (
              <li key={s.n}>
                <span className="n">{s.n}</span>
                <span>
                  <b>{s.title}</b>
                  <em>{s.sub}</em>
                </span>
              </li>
            ))}
          </ol>

          <p className="story-foot">
            <span className="pill">Demo</span>
            Sample photos, no real family. Try both sides — send as a studio, then sign in as the family.
          </p>
        </section>

        <section className="signin-card">
          {step === 'phone' ? (
            <>
              <h2>Sign in</h2>
              <p className="hint">
                {role === 'studio'
                  ? 'Send an event to the people you shot it for.'
                  : 'Use the number your photographer has. Your photos will be waiting.'}
              </p>

              <form onSubmit={send}>
                <div className="role-pick" role="radiogroup" aria-label="Who are you signing in as">
                  {ROLES.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={role === o.id}
                      className={role === o.id ? 'on' : ''}
                      onClick={() => setRole(o.id)}
                    >
                      <b>{o.label}</b>
                      <span>{o.hint}</span>
                    </button>
                  ))}
                </div>

                <label className="field">
                  <span>Mobile number</span>
                  <div className="phone-row">
                    <span className="cc">+91</span>
                    <input
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel"
                      placeholder="98765 43210"
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value)
                        setError(null)
                      }}
                      aria-label="Mobile number"
                      autoFocus
                    />
                  </div>
                </label>
                {error && <p className="signin-error">{error}</p>}
                <button className="btn primary block lg" type="submit" disabled={!isValidPhone(phone)}>
                  Send code
                </button>
              </form>
            </>
          ) : (
            <>
              <h2>Enter the code</h2>
              <p className="hint">Sent to {formatPhone(challenge!.phone)}.</p>

              <form onSubmit={check}>
                <label className="field">
                  <span className="sr-only">Code</span>
                  <input
                    ref={codeRef}
                    className="otp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={OTP_LENGTH}
                    placeholder="------"
                    value={code}
                    onChange={(e) => {
                      const next = e.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH)
                      setCode(next)
                      setError(null)
                    }}
                    aria-label="One time code"
                  />
                </label>
                {error && <p className="signin-error">{error}</p>}
                <button className="btn primary block lg" type="submit" disabled={code.length !== OTP_LENGTH}>
                  Sign in
                </button>
                <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
                  <button
                    className="btn sm ghost"
                    type="button"
                    onClick={() => {
                      setChallenge(null)
                      setError(null)
                      setCode('')
                    }}
                  >
                    ← Change number
                  </button>
                  <button className="btn sm ghost" type="button" disabled={cooldown > 0} onClick={() => send()}>
                    {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                  </button>
                </div>
              </form>

              <div className="otp-demo" role="note">
                <b>Demo</b>
                <span>
                  No SMS is sent. Your code is <code data-testid="demo-otp">{challenge!.code}</code> — really, it
                  arrives by text.
                </span>
              </div>
            </>
          )}

          <p className="hint signin-foot">Your photos stay on this device.</p>
        </section>
      </div>
    </div>
  )
}

export const displayPhone = (phone: string): string => formatPhone(normalisePhone(phone))
