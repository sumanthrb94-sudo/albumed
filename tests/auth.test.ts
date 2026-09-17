import { strict as assert } from 'node:assert'
import { beforeEach, test } from 'node:test'
import {
  CODE_TTL_MS,
  currentChallenge,
  currentSession,
  formatPhone,
  isValidPhone,
  issueCode,
  MAX_ATTEMPTS,
  normalisePhone,
  RESEND_COOLDOWN_MS,
  signOut,
  verifyCode,
} from '../src/lib/auth'

/* The module talks to localStorage; node:test has none, so stand one up. */
const store = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}

beforeEach(() => store.clear())

test('Indian mobile numbers are accepted in the shapes people type them', () => {
  for (const input of ['9876543210', '+91 98765 43210', '09876543210', '91-9876543210']) {
    assert.equal(normalisePhone(input), '9876543210', input)
    assert.ok(isValidPhone(input), input)
  }
})

test('numbers that are not Indian mobiles are refused', () => {
  for (const bad of ['1234567890', '5876543210', '98765', '98765432101', '', 'abcdefghij']) {
    assert.equal(isValidPhone(bad), false, bad)
  }
})

test('the number is shown back the way it would be printed', () => {
  assert.equal(formatPhone('09876543210'), '+91 98765 43210')
})

test('issuing a code gives six digits that never start with zero', () => {
  for (let i = 0; i < 50; i++) {
    store.clear()
    const r = issueCode('9876543210')
    assert.ok(r.ok)
    if (!r.ok) return
    assert.match(r.challenge.code, /^[1-9]\d{5}$/)
  }
})

test('the right code signs you in', () => {
  const issued = issueCode('9876543210')
  assert.ok(issued.ok)
  if (!issued.ok) return
  const result = verifyCode(issued.challenge.code)
  assert.ok(result.ok)
  if (!result.ok) return
  assert.equal(result.session.phone, '9876543210')
  assert.equal(currentSession()?.phone, '9876543210')
})

test('a wrong code counts down the tries and never signs you in', () => {
  const issued = issueCode('9876543210')
  assert.ok(issued.ok)
  if (!issued.ok) return
  const wrong = issued.challenge.code === '111111' ? '222222' : '111111'

  for (let i = 1; i < MAX_ATTEMPTS; i++) {
    const r = verifyCode(wrong)
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.attemptsLeft, MAX_ATTEMPTS - i)
  }
  const last = verifyCode(wrong)
  assert.equal(last.ok, false)
  assert.equal(currentChallenge(), null, 'the challenge should be burnt after too many tries')
  assert.equal(currentSession(), null)
})

test('the right code no longer works once the tries are used up', () => {
  const issued = issueCode('9876543210')
  assert.ok(issued.ok)
  if (!issued.ok) return
  const wrong = issued.challenge.code === '111111' ? '222222' : '111111'
  for (let i = 0; i < MAX_ATTEMPTS; i++) verifyCode(wrong)
  const r = verifyCode(issued.challenge.code)
  assert.equal(r.ok, false)
  assert.equal(currentSession(), null)
})

test('a code expires', () => {
  const t0 = 1_000_000
  const issued = issueCode('9876543210', t0)
  assert.ok(issued.ok)
  if (!issued.ok) return
  assert.equal(currentChallenge(t0 + CODE_TTL_MS - 1)?.code, issued.challenge.code)
  assert.equal(currentChallenge(t0 + CODE_TTL_MS + 1), null)
  const r = verifyCode(issued.challenge.code, t0 + CODE_TTL_MS + 1)
  assert.equal(r.ok, false)
})

test('resending too soon is refused, and allowed after the cooldown', () => {
  const t0 = 1_000_000
  assert.ok(issueCode('9876543210', t0).ok)
  const tooSoon = issueCode('9876543210', t0 + 1000)
  assert.equal(tooSoon.ok, false)
  if (!tooSoon.ok) assert.ok((tooSoon.retryAfterMs ?? 0) > 0)
  assert.ok(issueCode('9876543210', t0 + RESEND_COOLDOWN_MS + 1).ok)
})

test('a different number is not held back by another number cooldown', () => {
  const t0 = 1_000_000
  assert.ok(issueCode('9876543210', t0).ok)
  assert.ok(issueCode('9812345678', t0 + 1000).ok)
})

test('a bad number never issues a code', () => {
  const r = issueCode('12345')
  assert.equal(r.ok, false)
  assert.equal(currentChallenge(), null)
})

test('a code of the wrong length does not burn an attempt', () => {
  const issued = issueCode('9876543210')
  assert.ok(issued.ok)
  if (!issued.ok) return
  verifyCode('123')
  assert.equal(currentChallenge()?.attempts, 0)
})

test('the session survives a reload and expires eventually', () => {
  const t0 = 1_000_000
  const issued = issueCode('9876543210', t0)
  assert.ok(issued.ok)
  if (!issued.ok) return
  const v = verifyCode(issued.challenge.code, t0)
  assert.ok(v.ok)
  if (!v.ok) return
  assert.ok(currentSession(t0 + 29 * 24 * 60 * 60 * 1000))
  assert.equal(currentSession(v.session.expiresAt + 1), null)
})

test('signing out clears the session and any pending code', () => {
  const issued = issueCode('9876543210')
  assert.ok(issued.ok)
  if (!issued.ok) return
  verifyCode(issued.challenge.code)
  issueCode('9876543210', Date.now() + RESEND_COOLDOWN_MS + 1)
  signOut()
  assert.equal(currentSession(), null)
  assert.equal(currentChallenge(), null)
})
