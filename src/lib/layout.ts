/* Layout engine: turns the approved photo set into album pages.

   Templates are defined in normalised (0..1) coordinates inside the page's
   content box. The generator walks the photos in order, chunks them into
   pages using a per-density rhythm, then picks the template whose slot
   orientations best match that chunk. */
import { rng, uid } from './id'
import type { AlbumChapter, AlbumPage, Density, Photo, Rect, Slot } from './types'

type Orient = 'p' | 'l' | 'a'

export interface Template {
  id: string
  count: number
  slots: Rect[]
  prefer: Orient[]
  /** Page shapes this template flatters. */
  fit: 'wide' | 'tall' | 'any'
}

const G = 0.022 // gap between slots

/** Even grid helper. */
function grid(cols: number, rows: number): Rect[] {
  const w = (1 - G * (cols - 1)) / cols
  const h = (1 - G * (rows - 1)) / rows
  const out: Rect[] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) out.push({ x: c * (w + G), y: r * (h + G), w, h })
  return out
}

const rep = (o: Orient, n: number): Orient[] => Array.from({ length: n }, () => o)

/** Pull a template's slots in from the page edges, so strips do not run edge to edge. */
const inset = (slots: Rect[], dx: number, dy: number): Rect[] =>
  slots.map((s) => ({
    x: s.x * (1 - dx * 2) + dx,
    y: s.y * (1 - dy * 2) + dy,
    w: s.w * (1 - dx * 2),
    h: s.h * (1 - dy * 2),
  }))

export const TEMPLATES: Template[] = [
  // ---- 1 photo ----
  { id: 'full-bleed', count: 1, slots: [{ x: 0, y: 0, w: 1, h: 1 }], prefer: ['a'], fit: 'any' },
  {
    id: 'hero-portrait',
    count: 1,
    slots: [{ x: 0.16, y: 0.02, w: 0.68, h: 0.96 }],
    prefer: ['p'],
    fit: 'any',
  },
  {
    id: 'hero-landscape',
    count: 1,
    slots: [{ x: 0.02, y: 0.14, w: 0.96, h: 0.72 }],
    prefer: ['l'],
    fit: 'any',
  },
  // ---- 2 photos ----
  {
    id: 'pair-side',
    count: 2,
    slots: [
      { x: 0, y: 0, w: (1 - G) / 2, h: 1 },
      { x: (1 + G) / 2, y: 0, w: (1 - G) / 2, h: 1 },
    ],
    prefer: ['p', 'p'],
    fit: 'wide',
  },
  {
    id: 'pair-stack',
    count: 2,
    slots: [
      { x: 0, y: 0, w: 1, h: (1 - G) / 2 },
      { x: 0, y: (1 + G) / 2, w: 1, h: (1 - G) / 2 },
    ],
    prefer: ['l', 'l'],
    fit: 'tall',
  },
  {
    id: 'pair-offset',
    count: 2,
    slots: [
      { x: 0, y: 0, w: 0.64, h: 0.82 },
      { x: 0.42, y: 0.5, w: 0.58, h: 0.5 },
    ],
    prefer: ['a', 'a'],
    fit: 'any',
  },
  // ---- 3 photos ----
  {
    id: 'trio-row',
    count: 3,
    slots: inset(grid(3, 1), 0, 0.07),
    prefer: rep('p', 3),
    fit: 'wide',
  },
  {
    id: 'trio-col',
    count: 3,
    slots: inset(grid(1, 3), 0.07, 0),
    prefer: rep('l', 3),
    fit: 'tall',
  },
  {
    id: 'trio-left-hero',
    count: 3,
    slots: [
      { x: 0, y: 0, w: 0.6, h: 1 },
      { x: 0.62, y: 0, w: 0.38, h: (1 - G) / 2 },
      { x: 0.62, y: (1 + G) / 2, w: 0.38, h: (1 - G) / 2 },
    ],
    prefer: ['p', 'l', 'l'],
    fit: 'any',
  },
  {
    id: 'trio-top-hero',
    count: 3,
    slots: [
      { x: 0, y: 0, w: 1, h: 0.62 },
      { x: 0, y: 0.64, w: (1 - G) / 2, h: 0.36 },
      { x: (1 + G) / 2, y: 0.64, w: (1 - G) / 2, h: 0.36 },
    ],
    prefer: ['l', 'a', 'a'],
    fit: 'any',
  },
  // ---- 4 photos ----
  { id: 'quad-grid', count: 4, slots: grid(2, 2), prefer: rep('a', 4), fit: 'any' },
  { id: 'quad-strip', count: 4, slots: inset(grid(4, 1), 0, 0.12), prefer: rep('p', 4), fit: 'wide' },
  {
    id: 'quad-hero-right',
    count: 4,
    slots: [
      { x: 0, y: 0, w: 0.64, h: 1 },
      { x: 0.66, y: 0, w: 0.34, h: 0.32 },
      { x: 0.66, y: 0.34, w: 0.34, h: 0.32 },
      { x: 0.66, y: 0.68, w: 0.34, h: 0.32 },
    ],
    prefer: ['p', 'a', 'a', 'a'],
    fit: 'any',
  },
  {
    id: 'quad-hero-top',
    count: 4,
    slots: [
      { x: 0, y: 0, w: 1, h: 0.6 },
      { x: 0, y: 0.62, w: 0.32, h: 0.38 },
      { x: 0.34, y: 0.62, w: 0.32, h: 0.38 },
      { x: 0.68, y: 0.62, w: 0.32, h: 0.38 },
    ],
    prefer: ['l', 'a', 'a', 'a'],
    fit: 'any',
  },
  // ---- 5 photos ----
  {
    id: 'five-mosaic',
    count: 5,
    slots: [
      { x: 0, y: 0, w: 0.58, h: 0.66 },
      { x: 0.6, y: 0, w: 0.4, h: 0.32 },
      { x: 0.6, y: 0.34, w: 0.4, h: 0.32 },
      { x: 0, y: 0.68, w: 0.48, h: 0.32 },
      { x: 0.5, y: 0.68, w: 0.5, h: 0.32 },
    ],
    prefer: ['a', 'a', 'a', 'a', 'a'],
    fit: 'any',
  },
  {
    id: 'five-band',
    count: 5,
    slots: [
      { x: 0, y: 0, w: (1 - G) / 2, h: 0.62 },
      { x: (1 + G) / 2, y: 0, w: (1 - G) / 2, h: 0.62 },
      { x: 0, y: 0.64, w: 0.32, h: 0.36 },
      { x: 0.34, y: 0.64, w: 0.32, h: 0.36 },
      { x: 0.68, y: 0.64, w: 0.32, h: 0.36 },
    ],
    prefer: ['a', 'a', 'a', 'a', 'a'],
    fit: 'any',
  },
  // ---- 6 photos ----
  { id: 'six-grid-32', count: 6, slots: grid(3, 2), prefer: rep('a', 6), fit: 'wide' },
  { id: 'six-grid-23', count: 6, slots: grid(2, 3), prefer: rep('a', 6), fit: 'tall' },
  {
    id: 'six-hero',
    count: 6,
    slots: [
      { x: 0, y: 0, w: 0.66, h: 0.66 },
      { x: 0.68, y: 0, w: 0.32, h: 0.32 },
      { x: 0.68, y: 0.34, w: 0.32, h: 0.32 },
      { x: 0, y: 0.68, w: 0.32, h: 0.32 },
      { x: 0.34, y: 0.68, w: 0.32, h: 0.32 },
      { x: 0.68, y: 0.68, w: 0.32, h: 0.32 },
    ],
    prefer: ['a', 'a', 'a', 'a', 'a', 'a'],
    fit: 'any',
  },
]

export const templateById = (id: string): Template | undefined => TEMPLATES.find((t) => t.id === id)

export const templatesFor = (count: number): Template[] => TEMPLATES.filter((t) => t.count === count)

export function orientOf(p: Pick<Photo, 'width' | 'height'>): Orient {
  const r = p.width / p.height
  if (r > 1.12) return 'l'
  if (r < 0.89) return 'p'
  return 'a'
}

function slotOrient(s: Rect, pageAspect: number): Orient {
  const r = (s.w * pageAspect) / s.h
  if (r > 1.12) return 'l'
  if (r < 0.89) return 'p'
  return 'a'
}

const RHYTHM: Record<Density, number[]> = {
  airy: [1, 2, 1, 3, 2, 1, 2],
  balanced: [1, 3, 2, 4, 2, 3, 1, 4],
  dense: [4, 6, 3, 5, 6, 4, 5],
}

function scoreTemplate(t: Template, photos: Photo[], pageAspect: number, lastId: string | null): number {
  let s = 0
  t.slots.forEach((slot, i) => {
    const want = t.prefer[i] ?? 'a'
    const have = orientOf(photos[i] ?? photos[0])
    const actual = slotOrient(slot, pageAspect)
    if (want !== 'a' && want === have) s += 2
    if (actual === have) s += 3
    else if (actual === 'a' || have === 'a') s += 1
  })
  if (t.fit === 'wide' && pageAspect > 1.05) s += 2
  if (t.fit === 'tall' && pageAspect < 0.95) s += 2
  if (t.fit === 'any') s += 1
  if (t.id === lastId) s -= 4 // discourage two identical pages in a row
  return s
}

/** Give the biggest slot to the most important photo, then match orientations. */
function assign(photos: Photo[], t: Template, pageAspect: number, shape: Slot['shape']): Slot[] {
  const remaining = photos.slice()
  const out: Slot[] = t.slots.map((s) => ({ ...s, photoId: '', shape }))
  const byArea = t.slots.map((s, i) => ({ i, area: s.w * s.h })).sort((a, b) => b.area - a.area)

  byArea.forEach(({ i }, rank) => {
    const slot = t.slots[i]
    const want = slotOrient(slot, pageAspect)
    let bestIdx = 0
    let bestScore = -Infinity
    remaining.forEach((p, j) => {
      const o = orientOf(p)
      let sc = o === want ? 3 : want === 'a' || o === 'a' ? 1 : 0
      if (rank === 0 && p.starred) sc += 4
      sc -= j * 0.01 // keep roughly chronological
      if (sc > bestScore) {
        bestScore = sc
        bestIdx = j
      }
    })
    out[i].photoId = remaining.splice(bestIdx, 1)[0].id
  })
  return out
}

export interface GenerateInput {
  photos: Photo[]
  /** When present the album is laid out chapter by chapter, in this order. */
  chapters?: AlbumChapter[]
  includeChapterPages?: boolean
  density: Density
  pageAspect: number
  seed: number
  includeCover: boolean
  includeClosing: boolean
  coverPhotoId?: string
  shape: Slot['shape']
  featuredPhotoIds?: string[]
  coverHeading: string
  coverSub: string
  closingHeading: string
  closingSub: string
}

/** Lay one run of photos out across as many pages as its rhythm needs. */
function photoPages(
  photos: Photo[],
  density: Density,
  pageAspect: number,
  shape: Slot['shape'],
  rand: () => number,
  chapterId: string | undefined,
  state: { lastTemplate: string | null; step: number },
  featured: Set<string>,
): AlbumPage[] {
  const rhythm = RHYTHM[density]
  const out: AlbumPage[] = []
  let i = 0

  while (i < photos.length) {
    let take = rhythm[state.step % rhythm.length]
    state.step++
    const left = photos.length - i
    if (left - take === 1 && take > 1) take -= 1 // avoid a lonely single page at the end
    take = Math.min(take, left, 6)
    if (featured.has(photos[i].id)) {
      take = 1 // a featured photo gets the page to itself
    } else {
      // stop the run before the next featured photo so it starts its own page
      for (let k = 1; k < take; k++) {
        if (featured.has(photos[i + k].id)) {
          take = k
          break
        }
      }
    }
    const chunk = photos.slice(i, i + take)
    i += take

    const candidates = templatesFor(chunk.length)
    const chosen =
      candidates
        .map((t) => ({ t, s: scoreTemplate(t, chunk, pageAspect, state.lastTemplate) + rand() * 1.5 }))
        .sort((a, b) => b.s - a.s)[0]?.t ?? candidates[0]
    state.lastTemplate = chosen.id

    out.push({
      id: uid('pg_'),
      kind: 'photos',
      templateId: chosen.id,
      slots: assign(chunk, chosen, pageAspect, shape),
      chapterId,
    })
  }
  return out
}

export function generatePages(input: GenerateInput): AlbumPage[] {
  const { photos, density, pageAspect, seed, shape } = input
  const rand = rng(seed || 1)
  const pages: AlbumPage[] = []
  if (!photos.length) return pages

  const coverPhoto =
    photos.find((p) => p.id === input.coverPhotoId) ?? photos.find((p) => p.starred) ?? photos[0]

  if (input.includeCover) {
    pages.push({
      id: uid('pg_'),
      kind: 'cover',
      templateId: 'cover',
      slots: [{ x: 0, y: 0, w: 1, h: 1, photoId: coverPhoto.id, shape: 'rect' }],
      heading: input.coverHeading,
      subheading: input.coverSub,
    })
  }

  const state = { lastTemplate: null as string | null, step: Math.floor(rand() * 8) }
  const featured = new Set(input.featuredPhotoIds ?? [])
  const byId = new Map(photos.map((p) => [p.id, p]))
  const chapters = (input.chapters ?? []).filter((c) => c.photoIds.some((id) => byId.has(id)))

  if (chapters.length) {
    const used = new Set<string>()
    for (const chapter of chapters) {
      const run = chapter.photoIds
        .map((id) => byId.get(id))
        .filter((p): p is Photo => Boolean(p) && !used.has(p!.id))
      run.forEach((p) => used.add(p.id))
      if (!run.length) continue
      if (input.includeChapterPages && run.length >= 2) {
        pages.push({
          id: uid('pg_'),
          kind: 'chapter',
          templateId: 'chapter',
          slots: [{ x: 0, y: 0, w: 1, h: 1, photoId: run[0].id, shape: 'rect' }],
          heading: chapter.title,
          subheading: chapter.titleNative,
          blurb: chapter.blurb,
          chapterId: chapter.id,
        })
      }
      pages.push(...photoPages(run, density, pageAspect, shape, rand, chapter.id, state, featured))
    }
    // Anything the assistant did not place still belongs in the album.
    const leftovers = photos.filter((p) => !used.has(p.id))
    if (leftovers.length)
      pages.push(...photoPages(leftovers, density, pageAspect, shape, rand, undefined, state, featured))
  } else {
    pages.push(...photoPages(photos, density, pageAspect, shape, rand, undefined, state, featured))
  }

  if (input.includeClosing) {
    pages.push({
      id: uid('pg_'),
      kind: 'closing',
      templateId: 'closing',
      slots: [{ x: 0.33, y: 0.2, w: 0.34, h: 0.34, photoId: coverPhoto.id, shape: 'circle' }],
      heading: input.closingHeading,
      subheading: input.closingSub,
    })
  }

  return pages
}

/** Re-lay-out a single page with a different template of the same photo count. */
export function relayoutPage(page: AlbumPage, photos: Photo[], pageAspect: number, seed: number): AlbumPage {
  if (page.kind !== 'photos') return page
  const list = page.slots
    .map((s) => photos.find((p) => p.id === s.photoId))
    .filter((p): p is Photo => Boolean(p))
  if (!list.length) return page
  const options = templatesFor(list.length)
  if (options.length < 2) return page
  const idx = options.findIndex((t) => t.id === page.templateId)
  const next = options[(idx + 1 + Math.floor(seed) % Math.max(1, options.length - 1)) % options.length]
  const shape = page.slots[0]?.shape
  return { ...page, templateId: next.id, slots: assign(list, next, pageAspect, shape) }
}
