/* The Vercel functions are thin adapters over server/handlers.ts. These tests
   invoke them the way the platform does, so the adapter itself is covered. */
import { strict as assert } from 'node:assert'
import { after, before, test } from 'node:test'
import type { VercelRequest, VercelResponse } from '@vercel/node'
// @ts-expect-error - plain JS test helper
import { startMockAnthropic } from './mock-anthropic.mjs'

const MOCK_PORT = 4615
let mock: { server: { close: (cb?: () => void) => void } }

before(async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
  process.env.ANTHROPIC_BASE_URL = `http://localhost:${MOCK_PORT}`
  mock = await startMockAnthropic(MOCK_PORT)
})

after(() => mock?.server.close())

interface Captured {
  status: number
  body: unknown
  headers: Record<string, string>
}

function fakeRes(): { res: VercelResponse; done: Promise<Captured> } {
  let resolve!: (c: Captured) => void
  const done = new Promise<Captured>((r) => (resolve = r))
  const headers: Record<string, string> = {}
  let status = 200
  const res = {
    setHeader: (k: string, v: string) => {
      headers[k] = v
    },
    status: (s: number) => {
      status = s
      return res
    },
    json: (body: unknown) => {
      resolve({ status, body, headers })
      return res
    },
  } as unknown as VercelResponse
  return { res, done }
}

const fakeReq = (over: Partial<VercelRequest> = {}): VercelRequest =>
  ({ method: 'POST', headers: {}, socket: { remoteAddress: '203.0.113.9' }, body: {}, ...over }) as VercelRequest

test('GET /api/health reports the assistant', async () => {
  const { default: handler } = await import('../api/health')
  const { res, done } = fakeRes()
  handler(fakeReq({ method: 'GET' }), res)
  const out = await done
  assert.equal(out.status, 200)
  assert.equal((out.body as { enabled: boolean }).enabled, true)
  assert.equal(out.headers['x-content-type-options'], 'nosniff')
  assert.equal(out.headers['cache-control'], 'no-store')
})

test('the ai functions declare a duration long enough for a vision call', async () => {
  for (const route of ['curate', 'story', 'edit']) {
    const mod = (await import(`../api/ai/${route}`)) as { config?: { maxDuration?: number } }
    assert.ok((mod.config?.maxDuration ?? 0) >= 60, `${route} needs a longer maxDuration`)
  }
})

test('POST /api/ai/edit runs the real handler through the adapter', async () => {
  const { default: handler } = await import('../api/ai/edit')
  const { res, done } = fakeRes()
  await handler(
    fakeReq({
      body: {
        instruction: 'make it a traditional muhurtham album',
        language: 'english',
        history: [],
        album: {
          title: 'T',
          hosts: 'H',
          eventDate: '',
          venue: '',
          themeId: 'vivah-gold',
          pageSizeId: 'sq8',
          density: 'balanced',
          showCaptions: true,
          showPageNumbers: true,
          includeCover: true,
          includeClosing: true,
          includeChapterPages: true,
        },
        themeIds: [{ id: 'kanjeevaram', name: 'K', occasion: 'wedding', blurb: '' }],
        pageSizeIds: [{ id: 'sq8', label: 'Square 8' }],
        chapters: [],
        photos: [{ id: 'ph_a', ceremony: 'muhurtham', status: 'approved', starred: false, caption: '' }],
      },
    }),
    res,
  )
  const out = await done
  assert.equal(out.status, 200)
  assert.ok(Array.isArray((out.body as { ops: unknown[] }).ops))
})

test('a JSON string body is parsed rather than rejected', async () => {
  const { default: handler } = await import('../api/ai/curate')
  const { res, done } = fakeRes()
  await handler(fakeReq({ body: JSON.stringify({ photos: [], occasion: 'wedding', language: 'english' }) }), res)
  const out = await done
  assert.equal(out.status, 400) // empty photo list, but the body was understood
  assert.match((out.body as { error: string }).error, /No photos/)
})

test('a malformed body is a 400, not a crash', async () => {
  const { default: handler } = await import('../api/ai/edit')
  const { res, done } = fakeRes()
  await handler(fakeReq({ body: '{not json' }), res)
  const out = await done
  assert.equal(out.status, 400)
})

test('GET on an ai function is refused with Allow: POST', async () => {
  const { default: handler } = await import('../api/ai/story')
  const { res, done } = fakeRes()
  await handler(fakeReq({ method: 'GET' }), res)
  const out = await done
  assert.equal(out.status, 405)
  assert.equal(out.headers.allow, 'POST')
})
