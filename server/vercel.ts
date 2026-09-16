/* Glue between Vercel's request/response objects and the handlers in
   handlers.ts, which know nothing about any particular runtime.

   This deliberately lives outside api/ — everything in there is a route. */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { aiRoute, health, SECURITY_HEADERS, type AiRoute, type ApiResponse } from './handlers'

export function send(res: VercelResponse, r: ApiResponse): void {
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...(r.headers ?? {}) })) res.setHeader(k, v)
  res.setHeader('cache-control', 'no-store')
  res.status(r.status).json(r.body)
}

export function clientKey(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for']
  const first = Array.isArray(fwd) ? fwd[0] : fwd
  return first?.split(',')[0].trim() || req.socket?.remoteAddress || 'anon'
}

export function healthHandler(_req: VercelRequest, res: VercelResponse): void {
  send(res, health())
}

/** Vercel parses JSON bodies for us; anything else is a client mistake. */
export async function aiHandler(route: AiRoute, req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST')
    send(res, { status: 405, body: { error: 'Use POST' } })
    return
  }
  let body: unknown = req.body
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      send(res, { status: 400, body: { error: 'Request body was not valid JSON.' } })
      return
    }
  }
  send(res, await aiRoute(route, body ?? {}, clientKey(req)))
}
