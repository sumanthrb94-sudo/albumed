/* A stand-in for api.anthropic.com used by the tests and the offline demo.
   It speaks just enough of POST /v1/messages to exercise the real code path:
   the server still builds the request with the SDK, sends it over HTTP, and
   validates the reply against the same Zod schemas. Responses are derived from
   the request, so photo ids are real and the assertions mean something. */
import { createServer } from 'node:http'

const json = (res, status, body) => {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
  res.end(payload)
}

const textOf = (content) =>
  (Array.isArray(content) ? content : [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')

/** Deterministic pseudo-score so runs are repeatable. */
const hash = (s) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967296
}

const CEREMONIES = ['muhurtham', 'maalai-maatral', 'oonjal', 'reception', 'haldi', 'mehendi', 'family-portrait']

function curateReply(prompt) {
  const ids = [...prompt.matchAll(/Photo id: (\S+)/g)].map((m) => m[1])
  const tamil = /tamil|Captions and titles are in English, and the \*_native/i.test(prompt)
  return {
    verdicts: ids.map((id, i) => {
      const r = hash(id)
      const keep = r > 0.22
      const ceremony = CEREMONIES[Math.floor(r * CEREMONIES.length)]
      return {
        id,
        ceremony,
        score: Math.round(30 + r * 68),
        keep,
        hero: r > 0.86,
        issues: keep ? [] : [r > 0.1 ? 'blurry' : 'eyes-closed'],
        caption: `${ceremony.replace(/-/g, ' ')} moment ${i + 1}`,
        caption_native: tamil ? `திருமணக் காட்சி ${i + 1}` : '',
        focus_x: 0.4 + r * 0.2,
        focus_y: 0.35 + r * 0.15,
        reason: keep ? 'Sharp, everyone is looking at the couple.' : 'Softer copy of a better frame in the same set.',
      }
    }),
  }
}

function storyReply(prompt) {
  const rows = [...prompt.matchAll(/^(ph_\S+) \| (\S+) \| score (\d+)(.*)$/gm)].map((m) => ({
    id: m[1],
    ceremony: m[2],
    hero: m[4].includes('hero'),
  }))
  const groups = new Map()
  for (const r of rows) {
    if (!groups.has(r.ceremony)) groups.set(r.ceremony, [])
    groups.get(r.ceremony).push(r.id)
  }
  // fold singletons into the largest group, matching the "at least 2 photos" rule
  const entries = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)
  const merged = []
  for (const [ceremony, ids] of entries) {
    if (ids.length < 2 && merged.length) merged[0][1].push(...ids)
    else merged.push([ceremony, ids])
  }
  const chapters = merged.slice(0, 6).map(([ceremony, ids]) => ({
    id: ceremony,
    title: ceremony.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    title_native: 'திருமணம்',
    blurb: `The ${ceremony.replace(/-/g, ' ')} of the day`,
    photo_ids: ids,
  }))
  return {
    title: 'Our Muhurtham',
    subtitle: 'Priya & Arjun',
    theme_id: 'kanjeevaram',
    cover_photo_id: rows.find((r) => r.hero)?.id ?? rows[0]?.id ?? '',
    chapters,
    closing_line: 'With the blessings of both families',
    closing_native: 'நன்றி',
    notes: 'Built around the muhurtham, with the reception at the end.',
  }
}

function editReply(prompt) {
  const ask = (/The customer asks: (.*)$/m.exec(prompt)?.[1] ?? '').toLowerCase()
  const ids = [...prompt.matchAll(/^(ph_\S+) \| /gm)].map((m) => m[1])
  const chapterIds = [...prompt.matchAll(/^ {2}(\S+) \| .+ \| \d+$/gm)].map((m) => m[1])

  if (/kerala|kasavu/.test(ask)) {
    return { reply: 'Switched to the Kerala Kasavu template — off-white cloth with a gold border.', ops: [{ op: 'set_theme', theme_id: 'kasavu' }, { op: 'regenerate' }] }
  }
  if (/traditional|tamil|muhurtham/.test(ask)) {
    return {
      reply: 'Moved to the Kanjeevaram Muhurtham template and gave the album more room to breathe.',
      ops: [{ op: 'set_theme', theme_id: 'kanjeevaram' }, { op: 'set_density', density: 'airy' }, { op: 'regenerate' }],
    }
  }
  if (/full page|own page|feature/.test(ask)) {
    return { reply: 'Given the thaali moment a page of its own.', ops: [{ op: 'feature_photos', photo_ids: ids.slice(0, 2) }] }
  }
  if (/blurry|eyes closed|remove|drop/.test(ask)) {
    return { reply: 'Taken the soft frames out.', ops: [{ op: 'drop_photos', photo_ids: ids.slice(-2) }] }
  }
  if (/reception.*end|move reception/.test(ask)) {
    const reordered = [...chapterIds.filter((c) => c !== 'reception'), ...chapterIds.filter((c) => c === 'reception')]
    return { reply: 'Reception is now the last chapter.', ops: [{ op: 'reorder_chapters', chapter_ids: reordered }] }
  }
  if (/tamil as well|both languages|captions in/.test(ask)) {
    return { reply: 'Captions will print in Tamil under the English line.', ops: [{ op: 'set_language', language: 'tamil' }] }
  }
  if (/nonsense|unicorn/.test(ask)) {
    return { reply: 'I cannot do that to an album — tell me what you would like changed instead.', ops: [] }
  }
  return { reply: 'Laid the pages out again.', ops: [{ op: 'regenerate' }] }
}

export function startMockAnthropic(port = 4610) {
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) return json(res, 404, { error: 'not found' })
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      let parsedBody
      try {
        parsedBody = JSON.parse(body)
      } catch {
        return json(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: 'bad json' } })
      }
      const system = Array.isArray(parsedBody.system)
        ? parsedBody.system.map((s) => s.text).join('\n')
        : (parsedBody.system ?? '')
      const prompt = `${system}\n${parsedBody.messages.map((m) => textOf(m.content)).join('\n')}`
      const schema = JSON.stringify(parsedBody.output_config?.format?.schema ?? {})

      // Match on a property unique to each schema — "chapters" also appears
      // inside the edit ops, so it cannot be the story marker.
      let out
      if (schema.includes('"verdicts"')) out = curateReply(prompt)
      else if (schema.includes('"closing_line"')) out = storyReply(prompt)
      else out = editReply(prompt)

      json(res, 200, {
        id: `msg_mock_${Date.now()}`,
        type: 'message',
        role: 'assistant',
        model: parsedBody.model,
        content: [{ type: 'text', text: JSON.stringify(out) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 100 },
      })
    })
  })
  return new Promise((resolve) => server.listen(port, () => resolve({ server, url: `http://localhost:${port}` })))
}

if (process.argv[1]?.endsWith('mock-anthropic.mjs')) {
  const { url } = await startMockAnthropic(Number(process.env.PORT ?? 4610))
  console.log(`mock Anthropic API on ${url}`)
}
