/* Guards the things that only break once the app is deployed behind a rewrite. */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist'
const has = existsSync(join(DIST, 'index.html'))

test('the client build exists (run `npm run build` first)', () => {
  assert.ok(has, 'dist/index.html is missing')
})

test('every asset in index.html is an absolute path', { skip: !has }, () => {
  const html = readFileSync(join(DIST, 'index.html'), 'utf8')
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1])
  assert.ok(refs.length > 0)
  for (const ref of refs) {
    if (/^(https?:)?\/\//.test(ref) || ref.startsWith('data:')) continue
    // A relative path resolves against the URL, so /p/<id>/album would 404.
    assert.ok(ref.startsWith('/'), `${ref} is relative and breaks on a deep link`)
  }
})

test('no inline script, so a strict CSP holds', { skip: !has }, () => {
  const html = readFileSync(join(DIST, 'index.html'), 'utf8')
  assert.equal(/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/.test(html), false)
})

test('the service worker and manifest ship at the root', { skip: !has }, () => {
  for (const f of ['sw.js', 'manifest.webmanifest', 'icon-192.png']) {
    assert.ok(existsSync(join(DIST, f)), `${f} is missing from the build`)
  }
})

test('the manifest is scoped to the site root', { skip: !has }, () => {
  const m = JSON.parse(readFileSync(join(DIST, 'manifest.webmanifest'), 'utf8'))
  assert.equal(m.start_url, '/')
  assert.equal(m.scope, '/')
  for (const icon of m.icons) assert.ok(icon.src.startsWith('/'), `${icon.src} is relative`)
})

/* ---------------- Vercel wiring ---------------- */

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'))

test('vercel.json builds the client and serves it from dist', () => {
  assert.equal(vercel.outputDirectory, DIST)
  assert.match(vercel.buildCommand, /build:web/)
})

test('the SPA rewrite never swallows the API', () => {
  const rewrite = vercel.rewrites.find((r: { destination: string }) => r.destination === '/index.html')
  assert.ok(rewrite, 'there is no SPA rewrite')
  assert.match(rewrite.source, /\?!api\//, 'the rewrite must exclude /api/')
})

test('every file in api/ is a route with a default export', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
    )
  const files = walk('api')
  assert.ok(files.length >= 4)
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    assert.match(src, /export (default|\{[^}]*\bas default\b)/, `${f} is in api/ but exports no handler`)
  }
})

test('the AI routes ask for longer than the default execution limit', () => {
  assert.ok((vercel.functions['api/**/*.ts']?.maxDuration ?? 0) >= 60)
})
