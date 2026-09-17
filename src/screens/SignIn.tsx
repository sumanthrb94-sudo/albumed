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
} from '../lib/auth'

/** Phone sign-in. The code is generated here and shown on screen, because
 *  there is no SMS provider behind this — the banner says exactly that. */
export function SignIn({ onSignedIn }: { onSignedIn: (phone: string) => void }) {
  const [phone, setPhone] = useState('')
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
    const result = issueCode(phone)
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
      <div className="signin-card">
        <img src="/icon-192.png" alt="" width={56} height={56} />
        <div className="deva">॥ शुभ आरंभ ॥</div>
        <h1>Albumed</h1>
        <p className="hint">
          {step === 'phone'
            ? 'Sign in with your mobile number to start an album.'
            : `We sent a ${OTP_LENGTH} digit code to ${formatPhone(challenge!.phone)}.`}
        </p>

        {step === 'phone' ? (
          <form onSubmit={send}>
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
            <button className="btn primary block" type="submit" disabled={!isValidPhone(phone)}>
              Send code
            </button>
          </form>
        ) : (
          <form onSubmit={check}>
            <label className="field">
              <span>Enter the code</span>
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
            <button className="btn primary block" type="submit" disabled={code.length !== OTP_LENGTH}>
              Sign in
            </button>
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
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
        )}

        {step === 'code' && (
          <div className="otp-demo" role="note">
            <b>Demo</b>
            <span>
              No SMS is sent. Your code is <code data-testid="demo-otp">{challenge!.code}</code> — in a real
              deployment this arrives by text and never appears on screen.
            </span>
          </div>
        )}

        <p className="hint signin-foot">
          Your photos stay on this device. Signing in just remembers who you are between visits.
        </p>
      </div>
    </div>
  )
}

export const displayPhone = (phone: string): string => formatPhone(normalisePhone(phone))
