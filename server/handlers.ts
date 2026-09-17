/* The API, independent of how it is served.

   Two front ends call into here: `server/index.ts` (the standalone Node server
   used for Docker and self-hosting) and `api/*.ts` (Vercel serverless
   functions). Keeping the logic here means both behave identically. */
import { AiError, CURATE_BATCH } from './claude.js'
import { demoCurate, demoEdit, demoStory } from './demoAi.js'
import { live, modelLabel, providerId } from './provider.js'
import type { AiStatus, CurateRequest, EditRequest, StoryRequest } from '../src/lib/aiContract.js'

export interface ApiResponse {
  status: number
  body: unknown
  headers?: Record<string, string>
}

export const log = (level: 'info' | 'warn' | 'error', msg: string, extra: Record<string, unknown> = {}) => {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra })
  if (level === 'error') console.error(line)
  else console.log(line)
}

/* ---------------- rate limiting ----------------
   Best effort only. On a single server this is exact; on serverless each
   instance keeps its own counters, so treat it as a brake, not a quota.
   Put a real limiter (KV, Upstash, the platform's own) in front for that. */

const RATE_LIMIT = Number(process.env.ALBUMED_RATE_LIMIT ?? 60)
const RATE_WINDOW_MS = Number(process.env.ALBUMED_RATE_WINDOW_MS ?? 60_000)
const buckets = new Map<string, { count: number; resetAt: number }>()

export function rateLimited(key: string): boolean {
  const now = Date.now()
  if (buckets.size > 5000) buckets.clear() // bound the memory on a long-lived process
  const b = buckets.get(key)
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return false
  }
  b.count++
  return b.count > RATE_LIMIT
}

/* ---------------- health ---------------- */

export interface HealthBody extends AiStatus {
  ok: true
  batch: number
}

export function health(): ApiResponse {
  const provider = providerId()
  const demo = provider === 'demo'
  const body: HealthBody = {
    ok: true,
    enabled: provider !== 'off',
    demo,
    model: modelLabel(),
    batch: CURATE_BATCH,
    ...(provider === 'off'
      ? { reason: 'Set GEMINI_API_KEY (or ANTHROPIC_API_KEY) on the server to turn on the album assistant.' }
      : {}),
  }
  return { status: 200, body }
}

/* ---------------- the three AI passes ---------------- */

export type AiRoute = 'curate' | 'story' | 'edit'

/** Scripted replies, with enough delay that the UI's pending state is visible. */
async function demoRoute(route: AiRoute, body: unknown): Promise<ApiResponse> {
  await new Promise((r) => setTimeout(r, 500))
  log('info', 'demo', { route })
  switch (route) {
    case 'curate': {
      const r = body as CurateRequest
      if (!Array.isArray(r?.photos) || !r.photos.length) {
        return { status: 400, body: { error: 'No photos in the request.' } }
      }
      return { status: 200, body: demoCurate(r) }
    }
    case 'story': {
      const r = body as StoryRequest
      if (!Array.isArray(r?.photos) || !r.photos.length) {
        return { status: 400, body: { error: 'No photos in the request.' } }
      }
      return { status: 200, body: demoStory(r) }
    }
    case 'edit': {
      const r = body as EditRequest
      if (!r?.instruction?.trim()) return { status: 400, body: { error: 'Say what you would like changed.' } }
      return { status: 200, body: demoEdit(r) }
    }
  }
}

export async function aiRoute(route: AiRoute, body: unknown, clientKey: string): Promise<ApiResponse> {
  const provider = providerId()
  if (provider === 'demo') {
    if (rateLimited(`${clientKey}:${route}`)) {
      return { status: 429, body: { error: 'Too many requests. Give it a minute.' }, headers: { 'retry-after': '60' } }
    }
    return demoRoute(route, body)
  }
  if (provider === 'off') {
    return {
      status: 503,
      body: {
        error: 'The album assistant is switched off. Set GEMINI_API_KEY on the server to enable it.',
      },
    }
  }
  const ai = live()
  if (rateLimited(`${clientKey}:${route}`)) {
    return {
      status: 429,
      body: { error: 'Too many requests. Give it a minute.' },
      headers: { 'retry-after': '60' },
    }
  }

  const started = Date.now()
  try {
    switch (route) {
      case 'curate': {
        const r = body as CurateRequest
        if (!Array.isArray(r?.photos) || !r.photos.length) throw new AiError('No photos in the request.', 400)
        if (r.photos.length > CURATE_BATCH) {
          throw new AiError(`Send at most ${CURATE_BATCH} photos per request.`, 400)
        }
        const out = await ai.curateBatch(r)
        log('info', 'curate', {
          provider,
          photos: r.photos.length,
          verdicts: out.verdicts.length,
          ms: Date.now() - started,
        })
        return { status: 200, body: out }
      }
      case 'story': {
        const r = body as StoryRequest
        if (!Array.isArray(r?.photos) || !r.photos.length) throw new AiError('No photos in the request.', 400)
        const out = await ai.buildStory(r)
        log('info', 'story', { photos: r.photos.length, chapters: out.chapters.length, ms: Date.now() - started })
        return { status: 200, body: out }
      }
      case 'edit': {
        const r = body as EditRequest
        if (!r?.instruction?.trim()) throw new AiError('Say what you would like changed.', 400)
        const out = await ai.editAlbum(r)
        log('info', 'edit', { ops: out.ops.length, ms: Date.now() - started })
        return { status: 200, body: out }
      }
    }
  } catch (err) {
    const e = err instanceof AiError ? err : new AiError('Something went wrong.', 500)
    log(e.status >= 500 ? 'error' : 'warn', 'api_error', { route, status: e.status, detail: String(err) })
    return { status: e.status, body: { error: e.message } }
  }
}

/** The headers every response carries, whoever is serving it. */
export const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
}

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // React sets inline style attributes
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ')
