/* Exercises the real API server against the mock upstream: the server builds
   the request with the Anthropic SDK, sends it over HTTP, and validates the
   reply against the Zod schemas the client also uses. */
import { strict as assert } from 'node:assert'
import { after, before, test } from 'node:test'
import { spawn, type ChildProcess } from 'node:child_process'
// @ts-expect-error - plain JS test helper
import { startMockAnthropic } from './mock-anthropic.mjs'
import { CurateResultSchema, EditResultSchema, StorySchema } from '../src/lib/aiContract'

const PORT = 8813
const MOCK_PORT = 4613
const BASE = `http://localhost:${PORT}`

let server: ChildProcess
let mock: { server: { close: (cb?: () => void) => void } }

const post = (path: string, body: unknown) =>
  fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

const tinyJpeg =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='

before(async () => {
  mock = await startMockAnthropic(MOCK_PORT)
  server = spawn('node', ['dist-server/index.mjs'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      ANTHROPIC_API_KEY: 'test-key',
      ANTHROPIC_BASE_URL: `http://localhost:${MOCK_PORT}`,
      ALBUMED_DIST: 'dist',
    },
    stdio: 'ignore',
  })
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`)
      if (r.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('server did not start')
})

after(() => {
  server?.kill()
  mock?.server.close()
})

test('health reports the assistant as configured', async () => {
  const res = await fetch(`${BASE}/api/health`)
  const body = (await res.json()) as { ok: boolean; enabled: boolean; batch: number }
  assert.equal(res.status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.enabled, true)
  assert.ok(body.batch >= 1)
})

test('curate returns one verdict per photo and validates against the schema', async () => {
  const res = await post('/api/ai/curate', {
    occasion: 'South Indian wedding',
    language: 'tamil',
    photos: [
      { id: 'ph_one', name: 'a.jpg', dataUrl: tinyJpeg },
      { id: 'ph_two', name: 'b.jpg', dataUrl: tinyJpeg },
    ],
  })
  assert.equal(res.status, 200)
  const body = CurateResultSchema.parse(await res.json())
  assert.equal(body.verdicts.length, 2)
  assert.deepEqual(body.verdicts.map((v) => v.id).sort(), ['ph_one', 'ph_two'])
  for (const v of body.verdicts) {
    assert.ok(v.focus_x >= 0 && v.focus_x <= 1)
    assert.ok(v.score >= 0 && v.score <= 100)
    assert.ok(v.caption_native.length > 0, 'a Tamil album should get a Tamil caption')
  }
})

test('curate refuses a batch larger than the server allows', async () => {
  const photos = Array.from({ length: 40 }, (_, i) => ({ id: `ph_${i}`, name: 'x.jpg', dataUrl: tinyJpeg }))
  const res = await post('/api/ai/curate', { occasion: 'wedding', language: 'english', photos })
  assert.equal(res.status, 400)
})

test('curate rejects anything that is not an image data URL', async () => {
  const res = await post('/api/ai/curate', {
    occasion: 'wedding',
    language: 'english',
    photos: [{ id: 'ph_one', name: 'a.jpg', dataUrl: 'https://example.com/a.jpg' }],
  })
  assert.equal(res.status, 400)
})

test('story groups the photos into chapters that only use real ids', async () => {
  const photos = ['ph_a', 'ph_b', 'ph_c', 'ph_d'].map((id, i) => ({
    id,
    ceremony: (i < 2 ? 'muhurtham' : 'reception') as const,
    score: 80,
    hero: i === 0,
    caption: 'x',
  }))
  const res = await post('/api/ai/story', {
    occasion: 'South Indian wedding',
    language: 'tamil',
    hosts: 'Priya & Arjun',
    eventDate: '',
    venue: '',
    themeIds: [{ id: 'kanjeevaram', name: 'Kanjeevaram', occasion: 'South Indian wedding', blurb: '' }],
    photos,
  })
  assert.equal(res.status, 200)
  const story = StorySchema.parse(await res.json())
  assert.ok(story.chapters.length >= 1)
  const given = new Set(photos.map((p) => p.id))
  for (const c of story.chapters) for (const id of c.photo_ids) assert.ok(given.has(id), `invented id ${id}`)
})

test('edit turns a plain request into operations', async () => {
  const res = await post('/api/ai/edit', {
    instruction: 'make it a traditional tamil muhurtham album',
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
    themeIds: [{ id: 'kanjeevaram', name: 'Kanjeevaram', occasion: 'South Indian wedding', blurb: '' }],
    pageSizeIds: [{ id: 'sq8', label: 'Square 8' }],
    chapters: [{ id: 'muhurtham', title: 'Muhurtham', photoCount: 3 }],
    photos: [{ id: 'ph_a', ceremony: 'muhurtham' as const, status: 'approved', starred: false, caption: '' }],
  })
  assert.equal(res.status, 200)
  const out = EditResultSchema.parse(await res.json())
  assert.ok(out.reply.length > 0)
  assert.ok(out.ops.some((o) => o.op === 'set_theme'))
})

test('edit with no instruction is a bad request', async () => {
  const res = await post('/api/ai/edit', { instruction: '   ' })
  assert.equal(res.status, 400)
})

test('unknown API routes 404 rather than falling through to the app', async () => {
  const res = await fetch(`${BASE}/api/ai/nope`, { method: 'POST' })
  assert.equal(res.status, 404)
})

test('the client build is served with a SPA fallback', async () => {
  const res = await fetch(`${BASE}/p/anything/deep`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type') ?? '', /text\/html/)
})

/* ---------------- demo mode ---------------- */

test('demo mode is on by default and can be switched off outright', async () => {
  const { demoMode } = await import('../server/demoAi.js')
  const prev = process.env.ALBUMED_DEMO_AI
  delete process.env.ALBUMED_DEMO_AI
  assert.equal(demoMode(), true, 'a deployment with no key should still demo')
  process.env.ALBUMED_DEMO_AI = '0'
  assert.equal(demoMode(), false, 'ALBUMED_DEMO_AI=0 must switch the assistant off')
  if (prev === undefined) delete process.env.ALBUMED_DEMO_AI
  else process.env.ALBUMED_DEMO_AI = prev
})

test('a real key always beats demo mode', async () => {
  const { health } = await import('../server/handlers.js')
  // Each test file is its own process, so set the key here rather than assume it.
  const prevKey = process.env.ANTHROPIC_API_KEY
  const prevDemo = process.env.ALBUMED_DEMO_AI

  delete process.env.ANTHROPIC_API_KEY
  delete process.env.ALBUMED_DEMO_AI
  const withoutKey = health().body as { enabled: boolean; demo: boolean }
  assert.equal(withoutKey.demo, true, 'no key should fall back to demo mode')

  process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
  const withKey = health().body as { enabled: boolean; demo: boolean; model: string }
  assert.equal(withKey.enabled, true)
  assert.equal(withKey.demo, false, 'a configured key must not be shadowed by demo mode')
  assert.notEqual(withKey.model, 'demo mode — scripted')

  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = prevKey
  if (prevDemo === undefined) delete process.env.ALBUMED_DEMO_AI
  else process.env.ALBUMED_DEMO_AI = prevDemo
})

test('scripted curate answers for every photo it was given', async () => {
  const { demoCurate } = await import('../server/demoAi.js')
  const photos = ['ph_a', 'ph_b', 'ph_c'].map((id) => ({ id, name: `${id}.jpg`, dataUrl: '' }))
  const out = demoCurate({ photos, occasion: 'Telugu wedding', language: 'telugu' })
  assert.equal(out.verdicts.length, 3)
  assert.deepEqual(out.verdicts.map((v) => v.id), ['ph_a', 'ph_b', 'ph_c'])
  for (const v of out.verdicts) {
    assert.ok(v.score >= 0 && v.score <= 100)
    assert.ok(v.caption_native.length > 0, 'a Telugu album should get Telugu captions')
    assert.ok(v.focus_x >= 0 && v.focus_x <= 1)
  }
})

test('scripted curate keeps English albums free of native captions', async () => {
  const { demoCurate } = await import('../server/demoAi.js')
  const out = demoCurate({
    photos: [{ id: 'ph_a', name: 'a.jpg', dataUrl: '' }],
    occasion: 'wedding',
    language: 'english',
  })
  assert.equal(out.verdicts[0].caption_native, '')
})

test('scripted story only uses photo ids it was given', async () => {
  const { demoStory } = await import('../server/demoAi.js')
  const photos = ['ph_a', 'ph_b', 'ph_c', 'ph_d'].map((id, i) => ({
    id,
    ceremony: (i < 2 ? 'jeelakarra-bellam' : 'reception') as const,
    score: 80,
    hero: i === 0,
    caption: '',
  }))
  const story = demoStory({
    occasion: 'Telugu wedding',
    language: 'telugu',
    hosts: 'Sireesha & Karthik',
    eventDate: '',
    venue: '',
    themeIds: [],
    photos,
  })
  const given = new Set(photos.map((p) => p.id))
  assert.ok(story.chapters.length >= 1)
  const used = story.chapters.flatMap((c) => c.photo_ids)
  for (const id of used) assert.ok(given.has(id), `invented id ${id}`)
  assert.equal(new Set(used).size, used.length, 'a photo appears in two chapters')
  assert.ok(given.has(story.cover_photo_id))
})

test('scripted edit never invents a template id', async () => {
  const { demoEdit } = await import('../server/demoAi.js')
  const base = {
    language: 'english' as const,
    history: [],
    album: {
      title: 'T', hosts: 'H', eventDate: '', venue: '', themeId: 'godavari', pageSizeId: 'sq8',
      density: 'balanced', showCaptions: true, showPageNumbers: true, includeCover: true,
      includeClosing: true, includeChapterPages: true,
    },
    themeIds: [{ id: 'godavari', name: 'G', occasion: 'w', blurb: '' }], // kasavu deliberately absent
    pageSizeIds: [{ id: 'sq8', label: 'Square 8' }],
    chapters: [],
    photos: [{ id: 'ph_a', ceremony: 'reception' as const, status: 'approved', starred: false, caption: '' }],
  }
  const out = demoEdit({ ...base, instruction: 'make it a Kerala wedding album' })
  const themeOp = out.ops.find((o) => o.op === 'set_theme')
  assert.equal(themeOp && 'theme_id' in themeOp ? themeOp.theme_id : null, 'godavari')
})

test('scripted edit admits what it cannot do rather than pretending', async () => {
  const { demoEdit } = await import('../server/demoAi.js')
  const out = demoEdit({
    instruction: 'rewrite every caption as a haiku about the Godavari',
    language: 'english',
    history: [],
    album: {
      title: 'T', hosts: 'H', eventDate: '', venue: '', themeId: 'godavari', pageSizeId: 'sq8',
      density: 'balanced', showCaptions: true, showPageNumbers: true, includeCover: true,
      includeClosing: true, includeChapterPages: true,
    },
    themeIds: [],
    pageSizeIds: [],
    chapters: [],
    photos: [],
  })
  assert.equal(out.ops.length, 0)
  assert.match(out.reply, /demo mode/i)
})
