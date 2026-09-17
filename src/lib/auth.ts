/* Phone sign-in, simulated.

   There is no backend, so the one-time code is generated in the browser and
   shown on screen. That is not authentication — anyone can read their own
   code — and the UI says so plainly. What it does give is the real shape of
   the flow: an Indian mobile number, a six digit code, an expiry, a wrong-code
   path, an attempt limit, a resend cooldown, and a session that survives a
   reload. Swapping in a real SMS provider means replacing `issueCode` and
   `verifyCode` with calls to a server; nothing else here changes. */

export const OTP_LENGTH = 6
export const CODE_TTL_MS = 5 * 60 * 1000
export const RESEND_COOLDOWN_MS = 30 * 1000
export const MAX_ATTEMPTS = 5
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

const SESSION_KEY = 'albumed.session'
const CHALLENGE_KEY = 'albumed.challenge'

/** Indian mobile numbers are ten digits and start 6-9. */
export function normalisePhone(input: string): string {
  return input.replace(/\D/g, '').replace(/^(?:0|91)(?=\d{10}$)/, '')
}

export function isValidPhone(input: string): boolean {
  return /^[6-9]\d{9}$/.test(normalisePhone(input))
}

export function formatPhone(input: string): string {
  const n = normalisePhone(input)
  return n.length === 10 ? `+91 ${n.slice(0, 5)} ${n.slice(5)}` : input
}

export interface Challenge {
  phone: string
  code: string
  issuedAt: number
  expiresAt: number
  attempts: number
}

export interface Session {
  phone: string
  signedInAt: number
  expiresAt: number
}

/* ---------------- storage ---------------- */

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* private window — the flow still works for this tab */
  }
}

function clear(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* nothing to do */
  }
}

/* ---------------- the flow ---------------- */

function randomCode(): string {
  const digits = new Uint8Array(OTP_LENGTH)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(digits)
  else for (let i = 0; i < OTP_LENGTH; i++) digits[i] = Math.floor(Math.random() * 256)
  // Never lead with a zero, so the code always reads as six digits. Mapping the
  // first digit into 1-9 rather than adding one, which wrapped 9 back to 0.
  return Array.from(digits, (d, i) => (i === 0 ? 1 + (d % 9) : d % 10)).join('')
}

export type IssueResult =
  | { ok: true; challenge: Challenge }
  | { ok: false; error: string; retryAfterMs?: number }

export function issueCode(phoneInput: string, now = Date.now()): IssueResult {
  const phone = normalisePhone(phoneInput)
  if (!isValidPhone(phone)) {
    return { ok: false, error: 'That does not look like an Indian mobile number.' }
  }
  const existing = currentChallenge(now)
  if (existing && existing.phone === phone) {
    const since = now - existing.issuedAt
    if (since < RESEND_COOLDOWN_MS) {
      return { ok: false, error: 'A code was just sent. Give it a moment.', retryAfterMs: RESEND_COOLDOWN_MS - since }
    }
  }
  const challenge: Challenge = {
    phone,
    code: randomCode(),
    issuedAt: now,
    expiresAt: now + CODE_TTL_MS,
    attempts: 0,
  }
  write(CHALLENGE_KEY, challenge)
  return { ok: true, challenge }
}

export function currentChallenge(now = Date.now()): Challenge | null {
  const c = read<Challenge>(CHALLENGE_KEY)
  if (!c) return null
  if (now > c.expiresAt) {
    clear(CHALLENGE_KEY)
    return null
  }
  return c
}

export type VerifyResult =
  | { ok: true; session: Session }
  | { ok: false; error: string; attemptsLeft?: number }

export function verifyCode(input: string, now = Date.now()): VerifyResult {
  const challenge = currentChallenge(now)
  if (!challenge) return { ok: false, error: 'That code has expired. Ask for a new one.' }

  const entered = input.replace(/\D/g, '')
  if (entered.length !== OTP_LENGTH) {
    return { ok: false, error: `Enter the ${OTP_LENGTH} digit code.` }
  }

  if (entered !== challenge.code) {
    const attempts = challenge.attempts + 1
    if (attempts >= MAX_ATTEMPTS) {
      clear(CHALLENGE_KEY)
      return { ok: false, error: 'Too many wrong codes. Ask for a new one.', attemptsLeft: 0 }
    }
    write(CHALLENGE_KEY, { ...challenge, attempts })
    const attemptsLeft = MAX_ATTEMPTS - attempts
    return {
      ok: false,
      error: `That code is not right. ${attemptsLeft} ${attemptsLeft === 1 ? 'try' : 'tries'} left.`,
      attemptsLeft,
    }
  }

  clear(CHALLENGE_KEY)
  const session: Session = { phone: challenge.phone, signedInAt: now, expiresAt: now + SESSION_TTL_MS }
  write(SESSION_KEY, session)
  return { ok: true, session }
}

export function currentSession(now = Date.now()): Session | null {
  const s = read<Session>(SESSION_KEY)
  if (!s) return null
  if (now > s.expiresAt) {
    clear(SESSION_KEY)
    return null
  }
  return s
}

export function signOut(): void {
  clear(SESSION_KEY)
  clear(CHALLENGE_KEY)
}
