/* Gemini provider.

   Same three passes as the Claude provider and the same Zod schemas, so the
   rest of the app cannot tell which one answered. Selected automatically when
   GEMINI_API_KEY is set — see provider.ts. */
import { GoogleGenAI } from '@google/genai'
import { z } from 'zod'
import {
  CurateResultSchema,
  EditResultSchema,
  StorySchema,
  type CurateRequest,
  type CurateResult,
  type EditRequest,
  type EditResult,
  type Story,
  type StoryRequest,
} from '../src/lib/aiContract.js'
import { curateSystem, editSystem, storySystem } from './prompts.js'
import { AiError } from './claude.js'

export const GEMINI_MODEL = process.env.ALBUMED_GEMINI_MODEL ?? 'gemini-3.8-flash'

export const geminiConfigured = (): boolean => Boolean(process.env.GEMINI_API_KEY)

let client: GoogleGenAI | null = null
const getClient = (): GoogleGenAI => {
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  return client
}

function translate(err: unknown): AiError {
  const message = err instanceof Error ? err.message : String(err)
  if (/api[_ ]?key|unauthenticated|permission/i.test(message)) {
    return new AiError('The album assistant is not authenticated. Check GEMINI_API_KEY.', 502)
  }
  if (/quota|rate|429|resource[_ ]exhausted/i.test(message)) {
    return new AiError('The album assistant is busy right now. Try again in a moment.', 429)
  }
  if (/safety|blocked/i.test(message)) {
    return new AiError('The album assistant declined this request.', 422)
  }
  return new AiError('The album assistant returned something unexpected. Try again.', 502)
}

type Part = { text: string } | { inlineData: { mimeType: string; data: string } }

/** Gemini takes a JSON Schema, so the Zod schema is converted rather than duplicated. */
async function generate<T extends z.ZodType>(system: string, parts: Part[], schema: T): Promise<z.infer<T>> {
  let raw: string
  try {
    const response = await getClient().models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts }],
      config: {
        systemInstruction: system,
        responseMimeType: 'application/json',
        responseSchema: z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>,
        temperature: 0.4,
      },
    })
    raw = response.text ?? ''
  } catch (err) {
    throw translate(err)
  }
  if (!raw.trim()) throw new AiError('The album assistant returned nothing.', 502)

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new AiError('The album assistant returned something unreadable.', 502)
  }
  const result = schema.safeParse(parsed)
  if (!result.success) throw new AiError('The album assistant returned something unexpected. Try again.', 502)
  return result.data
}

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/

function imagePart(dataUrl: string): Part {
  const m = DATA_URL.exec(dataUrl)
  if (!m) throw new AiError('Photo thumbnails must be base64 JPEG, PNG or WebP data URLs.', 400)
  return { inlineData: { mimeType: m[1], data: m[2] } }
}

export async function curateBatch(req: CurateRequest): Promise<CurateResult> {
  const parts: Part[] = [
    { text: `Here are ${req.photos.length} photos from the shoot. Each image is preceded by its id.` },
  ]
  for (const p of req.photos) {
    parts.push({ text: `Photo id: ${p.id} (file: ${p.name})` })
    parts.push(imagePart(p.dataUrl))
  }
  parts.push({ text: 'Return one verdict per photo id above.' })

  const out = await generate(curateSystem(req.occasion, req.language, req.notes), parts, CurateResultSchema)
  const wanted = new Set(req.photos.map((p) => p.id))
  return { verdicts: out.verdicts.filter((v) => wanted.has(v.id)) }
}

export async function buildStory(req: StoryRequest): Promise<Story> {
  const lines = req.photos
    .map((p) => `${p.id} | ${p.ceremony} | score ${p.score}${p.hero ? ' | hero' : ''} | ${p.caption}`)
    .join('\n')
  const themes = req.themeIds.map((t) => `${t.id} | ${t.occasion} | ${t.name} — ${t.blurb}`).join('\n')

  return generate(
    storySystem(req.occasion, req.language),
    [
      {
        text: [
          `Hosts: ${req.hosts || 'not given'}`,
          `Date: ${req.eventDate || 'not given'}`,
          `Venue: ${req.venue || 'not given'}`,
          req.notes ? `Customer notes: ${req.notes}` : '',
          '',
          'Album templates to choose from (id | occasion | name — description):',
          themes,
          '',
          'Photos (id | ceremony | score | caption):',
          lines,
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
    StorySchema,
  )
}

export async function editAlbum(req: EditRequest): Promise<EditResult> {
  const photos = req.photos
    .map(
      (p) =>
        `${p.id} | ${p.ceremony} | ${p.status}${p.starred ? ' | starred' : ''}${
          p.issues?.length ? ` | issues: ${p.issues.join(',')}` : ''
        } | ${p.caption || '(no caption)'}`,
    )
    .join('\n')

  const state = [
    'Current album:',
    `  title: ${req.album.title}`,
    `  hosts: ${req.album.hosts}`,
    `  template: ${req.album.themeId}`,
    `  page size: ${req.album.pageSizeId}`,
    `  density: ${req.album.density}`,
    `  cover photo: ${req.album.coverPhotoId ?? 'auto'}`,
    `  captions: ${req.album.showCaptions}, page numbers: ${req.album.showPageNumbers}`,
    `  cover page: ${req.album.includeCover}, chapter pages: ${req.album.includeChapterPages}, closing page: ${req.album.includeClosing}`,
    '',
    'Chapters (id | title | photos):',
    req.chapters.map((c) => `  ${c.id} | ${c.title} | ${c.photoCount}`).join('\n') || '  (none yet)',
    '',
    'Templates available (id | occasion | name — description):',
    req.themeIds.map((t) => `  ${t.id} | ${t.occasion} | ${t.name} — ${t.blurb}`).join('\n'),
    '',
    'Page sizes available (id | label):',
    req.pageSizeIds.map((s) => `  ${s.id} | ${s.label}`).join('\n'),
    '',
    'Photos (id | ceremony | status | caption):',
    photos,
  ].join('\n')

  const history = req.history
    .slice(-6)
    .map((h) => `${h.role === 'user' ? 'Customer' : 'You'}: ${h.content}`)
    .join('\n')

  return generate(
    editSystem(req.language),
    [
      { text: state },
      ...(history ? [{ text: `Earlier in this conversation:\n${history}` }] : []),
      { text: `The customer asks: ${req.instruction}` },
    ],
    EditResultSchema,
  )
}
