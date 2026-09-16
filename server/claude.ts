/* Every call to Claude lives here. */
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { z } from 'zod'
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

export const MODEL = process.env.ALBUMED_MODEL ?? 'claude-opus-5'

/** Vision passes get many images at once, so they are chunked. */
export const CURATE_BATCH = Number(process.env.ALBUMED_CURATE_BATCH ?? 6)

let client: Anthropic | null = null

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)
}

function getClient(): Anthropic {
  if (!client) {
    // Reads ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN and ANTHROPIC_BASE_URL from the environment.
    client = new Anthropic({ maxRetries: 2, timeout: 5 * 60 * 1000 })
  }
  return client
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/** Maps SDK errors onto something safe to show a customer. */
function translate(err: unknown): AiError {
  if (err instanceof Anthropic.AuthenticationError) {
    return new AiError('The album assistant is not authenticated. Check ANTHROPIC_API_KEY.', 502)
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AiError('The album assistant is busy right now. Try again in a moment.', 429)
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new AiError(`The album assistant rejected the request: ${err.message}`, 502)
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AiError('Could not reach the album assistant.', 504)
  }
  if (err instanceof Anthropic.APIError) {
    return new AiError(`Album assistant error (${err.status ?? '?'}).`, 502)
  }
  if (err instanceof AiError) return err
  // Anything else (a schema mismatch, a parser failure) is an internal detail:
  // it is logged server-side, never sent to the browser.
  return new AiError('The album assistant returned something unexpected. Try again.', 502)
}

interface ParseArgs<T extends z.ZodType> {
  system: string
  content: Anthropic.ContentBlockParam[]
  schema: T
  maxTokens?: number
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
}

async function parsed<T extends z.ZodType>({
  system,
  content,
  schema,
  maxTokens = 16000,
  effort = 'medium',
}: ParseArgs<T>): Promise<z.infer<T>> {
  try {
    const response = await getClient().messages.parse({
      model: MODEL,
      max_tokens: maxTokens,
      thinking: { type: 'adaptive' },
      output_config: { effort, format: zodOutputFormat(schema) },
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }],
    })
    if (response.stop_reason === 'refusal') {
      throw new AiError('The album assistant declined this request.', 422)
    }
    if (response.stop_reason === 'max_tokens') {
      throw new AiError('The album assistant ran out of room. Try a smaller batch.', 502)
    }
    if (!response.parsed_output) {
      throw new AiError('The album assistant returned something unreadable.', 502)
    }
    return response.parsed_output
  } catch (err) {
    throw translate(err)
  }
}

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/

function imageBlock(dataUrl: string): Anthropic.ImageBlockParam {
  const m = DATA_URL.exec(dataUrl)
  if (!m) throw new AiError('Photo thumbnails must be base64 JPEG, PNG or WebP data URLs.', 400)
  return {
    type: 'image',
    source: { type: 'base64', media_type: m[1] as 'image/jpeg' | 'image/png' | 'image/webp', data: m[2] },
  }
}

/** One vision pass over a batch of thumbnails. */
export async function curateBatch(req: CurateRequest): Promise<CurateResult> {
  const content: Anthropic.ContentBlockParam[] = [
    {
      type: 'text',
      text: `Here are ${req.photos.length} photos from the shoot. Each image is preceded by its id.`,
    },
  ]
  for (const p of req.photos) {
    content.push({ type: 'text', text: `Photo id: ${p.id} (file: ${p.name})` })
    content.push(imageBlock(p.dataUrl))
  }
  content.push({ type: 'text', text: 'Return one verdict per photo id above.' })

  const result = await parsed({
    system: curateSystem(req.occasion, req.language, req.notes),
    content,
    schema: CurateResultSchema,
    effort: 'medium',
  })

  // Trust but verify: the model may hallucinate an id or miss one.
  const wanted = new Set(req.photos.map((p) => p.id))
  return { verdicts: result.verdicts.filter((v) => wanted.has(v.id)) }
}

export async function buildStory(req: StoryRequest): Promise<Story> {
  const lines = req.photos
    .map((p) => `${p.id} | ${p.ceremony} | score ${p.score}${p.hero ? ' | hero' : ''} | ${p.caption}`)
    .join('\n')
  const themes = req.themeIds.map((t) => `${t.id} | ${t.occasion} | ${t.name} — ${t.blurb}`).join('\n')

  return parsed({
    system: storySystem(req.occasion, req.language),
    content: [
      {
        type: 'text',
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
    schema: StorySchema,
    effort: 'high',
  })
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
    `  date: ${req.album.eventDate}`,
    `  venue: ${req.album.venue}`,
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

  return parsed({
    system: editSystem(req.language),
    content: [
      { type: 'text', text: state },
      ...(history ? [{ type: 'text' as const, text: `Earlier in this conversation:\n${history}` }] : []),
      { type: 'text', text: `The customer asks: ${req.instruction}` },
    ],
    schema: EditResultSchema,
    effort: 'medium',
  })
}
