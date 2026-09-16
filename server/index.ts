/* Albumed API server.
   - serves the built client from dist/
   - proxies the three AI passes to Claude, keeping the API key server-side
   No framework: one small router over node:http. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { aiConfigured, AiError, buildStory, curateBatch, CURATE_BATCH, editAlbum, MODEL } from './claude.js'
import type { AiStatus, CurateRequest, EditRequest, StoryRequest } from '../src/lib/aiContract.js'

const PORT = Number(process.env.PORT ?? 8787)
const HOST = process.env.HOST ?? '0.0.0.0'
const DIST = resolve(process.env.ALBUMED_DIST ?? 'dist')
const MAX_BODY = Number(process.env.ALBUMED_MAX_BODY ?? 24 * 1024 * 1024)
/** Requests per window per client, per route family. */
const RATE_LIMIT = Number(process.env.ALBUMED_RATE_LIMIT ?? 60)
const RATE_WINDOW_MS = Number(process.env.ALBUMED_RATE_WINDOW_MS ?? 60_000)

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
}

const log = (level: 'info' | 'warn' | 'error', msg: string, extra: Record<string, unknown> = {}) => {
  process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra })}\n`)
}

/* ---------------- rate limiting ---------------- */

const buckets = new Map<string, { count: number; resetAt: number }>()

function rateLimited(key: string): boolean {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return false
  }
  b.count++
  return b.count > RATE_LIMIT
}

setInterval(() => {
  const now = Date.now()
  for (const [k, b] of buckets) if (now > b.resetAt) buckets.delete(k)
}, RATE_WINDOW_MS).unref?.()

/* ---------------- helpers ---------------- */

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(payload)
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new AiError('That request is too large.', 413))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (!chunks.length) return resolvePromise({})
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new AiError('Request body was not valid JSON.', 400))
      }
    })
    req.on('error', reject)
  })
}

function serveStatic(res: ServerResponse, urlPath: string): boolean {
  if (!existsSync(DIST)) return false
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '')
  let file = join(DIST, clean === '/' ? 'index.html' : clean)
  if (!file.startsWith(DIST)) return false
  if (!existsSync(file) || statSync(file).isDirectory()) {
    // SPA fallback
    file = join(DIST, 'index.html')
    if (!existsSync(file)) return false
  }
  const ext = extname(file)
  if (ext === '.html') {
    res.setHeader(
      'content-security-policy',
      [
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
      ].join('; '),
    )
  }
  // Vite fingerprints assets; index.html and the service worker must not be pinned.
  const immutable = file.includes(`${DIST}/assets/`) || ext === '.woff2'
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  })
  createReadStream(file).pipe(res)
  return true
}

/* ---------------- routes ---------------- */

async function handleApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  if (path === '/api/health' && req.method === 'GET') {
    const status: AiStatus & { ok: true; batch: number } = {
      ok: true,
      enabled: aiConfigured(),
      model: MODEL,
      batch: CURATE_BATCH,
      ...(aiConfigured() ? {} : { reason: 'Set ANTHROPIC_API_KEY on the server to turn on the album assistant.' }),
    }
    send(res, 200, status)
    return
  }

  if (!path.startsWith('/api/ai/')) {
    send(res, 404, { error: 'Not found' })
    return
  }
  if (req.method !== 'POST') {
    send(res, 405, { error: 'Use POST' }, { allow: 'POST' })
    return
  }
  if (!aiConfigured()) {
    send(res, 503, {
      error: 'The album assistant is switched off. Set ANTHROPIC_API_KEY on the server to enable it.',
    })
    return
  }

  const who = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || 'anon'
  if (rateLimited(`${who}:${path}`)) {
    send(res, 429, { error: 'Too many requests. Give it a minute.' }, { 'retry-after': '60' })
    return
  }

  const body = await readBody(req)
  const started = Date.now()

  switch (path) {
    case '/api/ai/curate': {
      const r = body as CurateRequest
      if (!Array.isArray(r?.photos) || !r.photos.length) throw new AiError('No photos in the request.', 400)
      if (r.photos.length > CURATE_BATCH) {
        throw new AiError(`Send at most ${CURATE_BATCH} photos per request.`, 400)
      }
      const out = await curateBatch(r)
      log('info', 'curate', { photos: r.photos.length, verdicts: out.verdicts.length, ms: Date.now() - started })
      send(res, 200, out)
      return
    }
    case '/api/ai/story': {
      const r = body as StoryRequest
      if (!Array.isArray(r?.photos) || !r.photos.length) throw new AiError('No photos in the request.', 400)
      const out = await buildStory(r)
      log('info', 'story', { photos: r.photos.length, chapters: out.chapters.length, ms: Date.now() - started })
      send(res, 200, out)
      return
    }
    case '/api/ai/edit': {
      const r = body as EditRequest
      if (!r?.instruction?.trim()) throw new AiError('Say what you would like changed.', 400)
      const out = await editAlbum(r)
      log('info', 'edit', { ops: out.ops.length, ms: Date.now() - started })
      send(res, 200, out)
      return
    }
    default:
      send(res, 404, { error: 'Not found' })
  }
}

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0]

  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('referrer-policy', 'same-origin')

  if (path.startsWith('/api/')) {
    handleApi(req, res, path).catch((err: unknown) => {
      const e = err instanceof AiError ? err : new AiError('Something went wrong.', 500)
      log(e.status >= 500 ? 'error' : 'warn', 'api_error', { path, status: e.status, detail: String(err) })
      if (!res.headersSent) send(res, e.status, { error: e.message })
    })
    return
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, { error: 'Use GET' })
    return
  }
  if (!serveStatic(res, path)) {
    send(res, 404, {
      error: 'Client build not found. Run `npm run build` first, or set ALBUMED_DIST.',
    })
  }
})

server.listen(PORT, HOST, () => {
  log('info', 'listening', {
    url: `http://${HOST}:${PORT}`,
    ai: aiConfigured() ? MODEL : 'disabled (no ANTHROPIC_API_KEY)',
    dist: existsSync(DIST) ? DIST : 'missing',
  })
})

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    log('info', 'shutting_down', { sig })
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 5000).unref()
  })
}
