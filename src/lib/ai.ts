/* Browser side of the album assistant.
   The API key lives on the server; this module only speaks to /api/ai/*. */
import {
  CurateResultSchema,
  EditResultSchema,
  StorySchema,
  type AiStatus,
  type CurateRequest,
  type CuratePhotoInput,
  type EditRequest,
  type EditResult,
  type PhotoVerdict,
  type Story,
  type StoryRequest,
} from './aiContract'
import { getBlobs } from './db'

export class AiUnavailable extends Error {}

async function post<T>(path: string, body: unknown, schema: { parse: (v: unknown) => T }): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new AiUnavailable('Could not reach the album assistant. Are you running `npm start`?')
  }
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = (payload as { error?: string }).error ?? `Request failed (${res.status})`
    if (res.status === 503) throw new AiUnavailable(message)
    throw new Error(message)
  }
  return schema.parse(payload)
}

export async function aiStatus(): Promise<AiStatus & { batch: number }> {
  try {
    const res = await fetch('/api/health')
    if (!res.ok) throw new Error()
    return (await res.json()) as AiStatus & { batch: number }
  } catch {
    return {
      enabled: false,
      model: '',
      batch: 6,
      reason: 'The assistant runs on the Albumed server. Start it with `npm start`.',
    }
  }
}

/** Shrinks a stored thumbnail to something cheap to send to a vision model. */
async function thumbDataUrl(photoId: string, maxPx = 512): Promise<string | null> {
  const rec = await getBlobs(photoId)
  if (!rec) return null
  const bitmap = await createImageBitmap(rec.thumb)
  try {
    const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.72)
  } finally {
    bitmap.close()
  }
}

export interface CurateProgress {
  done: number
  total: number
}

/** Runs the vision pass over every photo, in server-sized batches. */
export async function curatePhotos(
  photos: Array<{ id: string; name: string }>,
  opts: { occasion: string; language: CurateRequest['language']; notes?: string; batch: number },
  onProgress?: (p: CurateProgress) => void,
): Promise<PhotoVerdict[]> {
  const out: PhotoVerdict[] = []
  const size = Math.max(1, opts.batch)
  for (let i = 0; i < photos.length; i += size) {
    const slice = photos.slice(i, i + size)
    const withImages: CuratePhotoInput[] = []
    for (const p of slice) {
      const dataUrl = await thumbDataUrl(p.id)
      if (dataUrl) withImages.push({ id: p.id, name: p.name, dataUrl })
    }
    if (!withImages.length) continue
    const body: CurateRequest = {
      photos: withImages,
      occasion: opts.occasion,
      language: opts.language,
      notes: opts.notes,
    }
    const res = await post('/api/ai/curate', body, CurateResultSchema)
    out.push(...res.verdicts)
    onProgress?.({ done: Math.min(i + size, photos.length), total: photos.length })
  }
  return out
}

export const buildStory = (body: StoryRequest): Promise<Story> => post('/api/ai/story', body, StorySchema)

export const requestEdit = (body: EditRequest): Promise<EditResult> => post('/api/ai/edit', body, EditResultSchema)
