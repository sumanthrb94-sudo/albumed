/* Standalone Albumed server: serves the built client and the API.
   Used for Docker and self-hosting. On Vercel the same handlers are served by
   the functions in api/ instead — see server/handlers.ts. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { aiConfigured, AiError, MODEL } from './claude.js'
import { aiRoute, CSP, health, log, SECURITY_HEADERS, type AiRoute } from './handlers.js'

const PORT = Number(process.env.PORT ?? 8787)
const HOST = process.env.HOST ?? '0.0.0.0'
const DIST = resolve(process.env.ALBUMED_DIST ?? 'dist')
const MAX_BODY = Number(process.env.ALBUMED_MAX_BODY ?? 24 * 1024 * 1024)

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
    file = join(DIST, 'index.html') // SPA fallback
    if (!existsSync(file)) return false
  }
  const ext = extname(file)
  // Vite fingerprints assets; index.html and the service worker must not be pinned.
  const immutable = file.startsWith(join(DIST, 'assets')) || ext === '.woff2'
  const headers: Record<string, string> = {
    ...SECURITY_HEADERS,
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  }
  if (ext === '.html') headers['content-security-policy'] = CSP
  res.writeHead(200, headers)
  createReadStream(file).pipe(res)
  return true
}

const clientKey = (req: IncomingMessage) =>
  (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || 'anon'

async function handleApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  if (path === '/api/health' && req.method === 'GET') {
    const r = health()
    send(res, r.status, r.body)
    return
  }
  const match = /^\/api\/ai\/(curate|story|edit)$/.exec(path)
  if (!match) {
    send(res, 404, { error: 'Not found' })
    return
  }
  if (req.method !== 'POST') {
    send(res, 405, { error: 'Use POST' }, { allow: 'POST' })
    return
  }
  const body = await readBody(req)
  const r = await aiRoute(match[1] as AiRoute, body, clientKey(req))
  send(res, r.status, r.body, r.headers)
}

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0]
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v)

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
    send(res, 404, { error: 'Client build not found. Run `npm run build` first, or set ALBUMED_DIST.' })
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
