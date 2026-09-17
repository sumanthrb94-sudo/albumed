import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import * as db from './lib/db'
import { uid } from './lib/id'
import {
  makeSamplePhoto,
  prepareUpload,
  previewCache,
  realSampleCount,
  releaseThumbUrl,
  SAMPLE_COUNT,
} from './lib/images'
import { generatePages, relayoutPage } from './lib/layout'
import { pageSizeById, themeById, THEMES, PAGE_SIZES } from './lib/themes'
import type { Album, AlbumOptions, Photo, PhotoSource, PhotoStatus, Project } from './lib/types'
import type { AiStatus, EditOp, Language, PhotoVerdict } from './lib/aiContract'
import { aiStatus as fetchAiStatus, buildStory as aiBuildStory, curatePhotos, requestEdit } from './lib/ai'
import { applyOps } from './lib/applyOps'
import { uid as newId } from './lib/id'
import { planOf, readPlan, writePlan, type Plan, type PlanId } from './lib/plan'
import { matchOriginals } from './lib/reimport'
import { openDelivery, pendingFor, seedDemoDelivery, sendDelivery, sentBy, type SendOptions } from './lib/studio'
import type { Session } from './lib/auth'
import type { Delivery } from './lib/types'

export type ProjectInit = Partial<Omit<Project, 'album'>> & { album?: Partial<AlbumOptions> }

export interface Progress {
  done: number
  total: number
  label: string
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
  changes?: string[]
  rejected?: string[]
  failed?: boolean
}

export interface AiState extends AiStatus {
  batch: number
  busy: string | null
}

/** Why an action is blocked, so the UI can show the right upsell. */
export interface Paywall {
  reason: string
  detail: string
}

interface Ctx {
  ready: boolean
  projects: Project[]
  project: Project | null
  photos: Photo[]
  album: Album | null
  progress: Progress | null
  toast: string | null
  setToast: (s: string | null) => void
  createProject: (init: ProjectInit) => Promise<Project>
  openProject: (id: string) => Promise<void>
  closeProject: () => void
  updateProject: (patch: Partial<Project>) => Promise<void>
  updateAlbumOptions: (patch: Partial<AlbumOptions>) => Promise<void>
  removeProject: (id: string) => Promise<void>
  addFiles: (files: File[], source: PhotoSource) => Promise<number>
  addSamples: (source: PhotoSource) => Promise<number>
  setStatus: (ids: string[], status: PhotoStatus) => Promise<void>
  patchPhoto: (id: string, patch: Partial<Photo>) => Promise<void>
  removePhoto: (id: string) => Promise<void>
  finalize: () => Promise<void>
  reopen: () => Promise<void>
  regenerate: (seed?: number) => Promise<void>
  shufflePage: (pageId: string) => Promise<void>
  movePage: (pageId: string, dir: -1 | 1) => Promise<void>
  refreshProjects: () => Promise<void>
  /** One-tap end-to-end demo: sample photos -> approved -> finalized album. */
  startDemo: (themeId?: string) => Promise<string>

  /* ---- album assistant ---- */
  ai: AiState
  chat: ChatTurn[]
  canUndo: boolean
  setLanguage: (language: Language) => Promise<void>
  runCurate: () => Promise<{ kept: number; dropped: number } | null>
  runStory: () => Promise<boolean>
  sendEdit: (instruction: string) => Promise<void>
  undoAiEdit: () => Promise<void>
  clearChat: () => void

  /* ---- plan ---- */
  plan: Plan
  setPlan: (id: PlanId) => void
  paywall: Paywall | null
  showPaywall: (p: Paywall) => void
  dismissPaywall: () => void
  /** Re-import the originals for photos already in this album, at the new plan's quality. */
  reimportOriginals: (files: File[]) => Promise<{ upgraded: number; unmatched: number }>

  /* ---- studio <-> customer ---- */
  session: Session
  /** Deliveries addressed to this number that have not been opened yet. */
  inbox: Delivery[]
  /** Deliveries this studio has sent. */
  sent: Delivery[]
  refreshDeliveries: () => Promise<void>
  /** Open a delivery as an album of your own. Returns the project id. */
  openInboxItem: (deliveryId: string) => Promise<string>
  /** Send the open event to a customer's mobile number. */
  sendToCustomer: (opts: Omit<SendOptions, 'studioPhone'>) => Promise<{ sent: number; rejected: string[] }>
}

const AppCtx = createContext<Ctx | null>(null)

export const useApp = (): Ctx => {
  const c = useContext(AppCtx)
  if (!c) throw new Error('useApp must be used inside <AppProvider>')
  return c
}

const defaultAlbum = (): AlbumOptions => ({
  themeId: 'godavari',
  pageSizeId: 'sq8',
  density: 'balanced',
  includeCover: true,
  includeClosing: true,
  includeChapterPages: true,
  showCaptions: true,
  showPageNumbers: true,
  featuredPhotoIds: [],
  seed: Math.floor(Math.random() * 100000),
})

/** Projects created before a field existed still have to open. */
function hydrate(p: Project): Project {
  return {
    ...p,
    language: p.language ?? 'telugu',
    chapters: p.chapters ?? [],
    album: { ...defaultAlbum(), ...p.album },
  }
}

const themeCatalogue = () => THEMES.map((t) => ({ id: t.id, name: t.name, occasion: t.occasion, blurb: t.blurb }))

export function AppProvider({ session, children }: { session: Session; children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [album, setAlbum] = useState<Album | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [planId, setPlanId] = useState<PlanId>(() => readPlan(session.phone))
  const [paywall, setPaywall] = useState<Paywall | null>(null)
  const [ai, setAi] = useState<AiState>({ enabled: false, model: '', demo: false, batch: 6, busy: null })
  const [chat, setChat] = useState<ChatTurn[]>([])
  const [inbox, setInbox] = useState<Delivery[]>([])
  const [sent, setSent] = useState<Delivery[]>([])
  const undoStack = useRef<Array<{ project: Project; photos: Photo[] }>>([])
  const [canUndo, setCanUndo] = useState(false)
  const plan = useMemo(() => planOf(planId), [planId])
  const planRef = useRef(plan)
  planRef.current = plan
  const projectRef = useRef<Project | null>(null)
  const photosRef = useRef<Photo[]>([])
  projectRef.current = project
  photosRef.current = photos

  // Albums belong to the number that made them: on one device a studio and the
  // family it sent to must not see each other's work. Albums from before
  // sign-in have no owner and stay visible.
  const isMine = useCallback((p: Project) => !p.ownerPhone || p.ownerPhone === session.phone, [session.phone])

  const refreshProjects = useCallback(async () => {
    const list = (await db.getProjects()).filter(isMine)
    list.sort((a, b) => b.updatedAt - a.updatedAt)
    setProjects(list)
  }, [isMine])

  useEffect(() => {
    refreshProjects().finally(() => setReady(true))
  }, [refreshProjects])

  // Signing in as somebody else brings their plan with them.
  useEffect(() => {
    setPlanId(readPlan(session.phone))
  }, [session.phone])

  useEffect(() => {
    fetchAiStatus().then((s) => setAi((prev) => ({ ...prev, ...s })))
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(t)
  }, [toast])

  const persist = useCallback(
    async (next: Project) => {
      const saved = await db.putProject({ ...next, updatedAt: Date.now() })
      setProject(saved)
      await refreshProjects()
      return saved
    },
    [refreshProjects],
  )

  const createProject = useCallback(
    async (init: ProjectInit) => {
      const now = Date.now()
      const p: Project = {
        id: uid('prj_'),
        ownerPhone: session.phone,
        title: init.title?.trim() || 'Our Album',
        hosts: init.hosts?.trim() || '',
        eventDate: init.eventDate ?? '',
        venue: init.venue ?? '',
        occasionNote: init.occasionNote ?? '',
        status: 'collecting',
        createdAt: now,
        updatedAt: now,
        album: { ...defaultAlbum(), ...(init.album ?? {}) },
        language: init.language ?? 'telugu',
        chapters: [],
      }
      await db.putProject(p)
      await refreshProjects()
      return p
    },
    [refreshProjects, session.phone],
  )

  const openProject = useCallback(async (id: string) => {
    const raw = await db.getProject(id)
    if (!raw || !isMine(raw)) return
    const p = hydrate(raw)
    setProject(p)
    setPhotos(await db.getPhotos(id))
    setAlbum((await db.getAlbum(id)) ?? null)
    setChat([])
    undoStack.current = []
    setCanUndo(false)
  }, [isMine])

  const closeProject = useCallback(() => {
    setProject(null)
    setPhotos([])
    setAlbum(null)
  }, [])

  const updateProject = useCallback(
    async (patch: Partial<Project>) => {
      if (!projectRef.current) return
      await persist({ ...projectRef.current, ...patch })
    },
    [persist],
  )

  const updateAlbumOptions = useCallback(
    async (patch: Partial<AlbumOptions>) => {
      const cur = projectRef.current
      if (!cur) return
      await persist({ ...cur, album: { ...cur.album, ...patch } })
    },
    [persist],
  )

  const removeProject = useCallback(
    async (id: string) => {
      await db.deleteProject(id)
      if (projectRef.current?.id === id) closeProject()
      await refreshProjects()
    },
    [closeProject, refreshProjects],
  )

  const ingest = useCallback(
    async (
      items: Array<{ blob: Blob; name: string; bytes: number; takenAt?: number }>,
      source: PhotoSource,
    ): Promise<number> => {
      const cur = projectRef.current
      if (!cur) return 0
      const limits = planRef.current.limits
      const existing = await db.getPhotos(cur.id)
      let order = existing.reduce((m, p) => Math.max(m, p.order), 0) + 1
      let added = 0
      const room = Math.max(0, limits.maxPhotosPerAlbum - existing.length)
      if (!room) {
        setPaywall({
          reason: `This album is full at ${limits.maxPhotosPerAlbum} photos`,
          detail: `${planRef.current.name} albums hold ${limits.maxPhotosPerAlbum} photos. A bigger plan holds more.`,
        })
        return 0
      }
      const accepted = items.slice(0, room)
      const overflow = items.length - accepted.length
      // Keep the detail comparison for the first few photos only — it is there to
      // show what compression costs, not to become storage of its own.
      const samplesSoFar = existing.filter((p) => p.hasSample).length
      for (let i = 0; i < accepted.length; i++) {
        setProgress({ done: i, total: accepted.length, label: `Processing ${accepted[i].name}` })
        try {
          const withSample = !limits.printGrade && samplesSoFar + added < 6
          const prepared = await prepareUpload(accepted[i].blob, {
            maxPx: limits.ingestMaxPx,
            quality: limits.ingestQuality,
            withSample,
          })
          const photo: Photo = {
            id: uid('ph_'),
            projectId: cur.id,
            name: items[i].name,
            source,
            status: 'pending',
            starred: false,
            caption: '',
            note: '',
            width: prepared.width,
            height: prepared.height,
            sourceWidth: prepared.sourceWidth,
            sourceHeight: prepared.sourceHeight,
            printGrade: limits.printGrade,
            hasSample: Boolean(prepared.sampleReal),
            bytes: accepted[i].bytes,
            addedAt: Date.now(),
            takenAt: accepted[i].takenAt,
            order: order++,
          }
          await db.putPhoto(photo)
          await db.putBlobs({
            photoId: photo.id,
            full: prepared.full,
            thumb: prepared.thumb,
            sampleReal: prepared.sampleReal,
            sampleStored: prepared.sampleStored,
          })
          added++
        } catch (err) {
          console.error('Could not read', accepted[i].name, err)
        }
        // let the progress bar paint
        await new Promise((r) => setTimeout(r, 0))
      }
      setProgress(null)
      setPhotos(await db.getPhotos(cur.id))
      if (added && cur.status === 'collecting') await persist({ ...cur, status: 'review' })
      if (overflow) {
        setPaywall({
          reason: `${overflow} photo${overflow > 1 ? 's' : ''} did not fit`,
          detail: `${planRef.current.name} albums hold ${limits.maxPhotosPerAlbum} photos, and this one is now full.`,
        })
      }
      return added
    },
    [persist],
  )

  const addFiles = useCallback(
    async (files: File[], source: PhotoSource) => {
      const images = files.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|avif)$/i.test(f.name))
      if (!images.length) {
        setToast('No image files found in that selection.')
        return 0
      }
      const n = await ingest(
        images.map((f) => ({ blob: f, name: f.name, bytes: f.size, takenAt: f.lastModified })),
        source,
      )
      setToast(n ? `Added ${n} photo${n > 1 ? 's' : ''}.` : 'Those files could not be read.')
      return n
    },
    [ingest],
  )

  const addSamples = useCallback(
    async (source: PhotoSource) => {
      const items: Array<{ blob: Blob; name: string; bytes: number }> = []
      const count = Math.max(await realSampleCount(), SAMPLE_COUNT)
      for (let i = 0; i < count; i++) {
        const s = await makeSamplePhoto(i)
        items.push({ blob: s.blob, name: s.name, bytes: s.blob.size })
      }
      const n = await ingest(items, source)
      setToast(`Added ${n} sample photos.`)
      return n
    },
    [ingest],
  )

  const setStatus = useCallback(async (ids: string[], status: PhotoStatus) => {
    const cur = projectRef.current
    if (!cur) return
    const all = await db.getPhotos(cur.id)
    const set = new Set(ids)
    const next = all.map((p) => (set.has(p.id) ? { ...p, status } : p))
    await db.putPhotos(next.filter((p) => set.has(p.id)))
    setPhotos(next)
  }, [])

  const patchPhoto = useCallback(async (id: string, patch: Partial<Photo>) => {
    const current = await db.getPhotos(projectRef.current?.id ?? '')
    const found = current.find((p) => p.id === id)
    if (!found) return
    const updated = { ...found, ...patch }
    await db.putPhoto(updated)
    setPhotos(current.map((p) => (p.id === id ? updated : p)))
  }, [])

  const removePhoto = useCallback(async (id: string) => {
    const cur = projectRef.current
    if (!cur) return
    await db.deletePhoto(id)
    releaseThumbUrl(id)
    setPhotos(await db.getPhotos(cur.id))
  }, [])

  const buildAlbum = useCallback(
    async (p: Project, list: Photo[], seed?: number): Promise<Album> => {
      const theme = themeById(p.album.themeId)
      const size = pageSizeById(p.album.pageSizeId)
      const approved = list.filter((x) => x.status === 'approved').sort((a, b) => a.order - b.order)
      const pages = generatePages({
        photos: approved,
        chapters: p.chapters,
        includeChapterPages: p.album.includeChapterPages,
        featuredPhotoIds: p.album.featuredPhotoIds,
        density: p.album.density,
        pageAspect: size.w / size.h,
        seed: seed ?? p.album.seed,
        includeCover: p.album.includeCover,
        includeClosing: p.album.includeClosing,
        coverPhotoId: p.coverPhotoId,
        shape: theme.shape,
        coverHeading: p.title,
        coverSub: p.hosts,
        closingHeading: theme.closingLine,
        closingSub: theme.closingScript,
      })
      const built: Album = { pages, generatedAt: Date.now() }
      await db.putAlbum(p.id, built)
      setAlbum(built)
      return built
    },
    [],
  )

  const finalize = useCallback(async () => {
    const cur = projectRef.current
    if (!cur) return
    const list = await db.getPhotos(cur.id)
    const approved = list.filter((p) => p.status === 'approved')
    if (!approved.length) {
      setToast('Approve at least one photo before finalizing.')
      return
    }
    const next = await persist({ ...cur, status: 'finalized', finalizedAt: Date.now() })
    await buildAlbum(next, list)
    setToast(`Album generated — ${approved.length} photos.`)
  }, [buildAlbum, persist])

  const reopen = useCallback(async () => {
    const cur = projectRef.current
    if (!cur) return
    await persist({ ...cur, status: 'review' })
    setToast('Selection reopened. Finalize again when you are done.')
  }, [persist])

  const regenerate = useCallback(
    async (seed?: number) => {
      const cur = projectRef.current
      if (!cur) return
      const s = seed ?? Math.floor(Math.random() * 100000)
      const next = await persist({ ...cur, album: { ...cur.album, seed: s } })
      await buildAlbum(next, await db.getPhotos(cur.id), s)
    },
    [buildAlbum, persist],
  )

  const shufflePage = useCallback(
    async (pageId: string) => {
      const cur = projectRef.current
      if (!cur || !album) return
      const size = pageSizeById(cur.album.pageSizeId)
      const list = await db.getPhotos(cur.id)
      const pages = album.pages.map((pg) =>
        pg.id === pageId ? relayoutPage(pg, list, size.w / size.h, Math.random() * 10) : pg,
      )
      const next = { pages, generatedAt: Date.now() }
      await db.putAlbum(cur.id, next)
      setAlbum(next)
    },
    [album],
  )

  const movePage = useCallback(
    async (pageId: string, dir: -1 | 1) => {
      const cur = projectRef.current
      if (!cur || !album) return
      const pages = album.pages.slice()
      const i = pages.findIndex((p) => p.id === pageId)
      const j = i + dir
      if (i < 0 || j < 0 || j >= pages.length) return
      if (pages[i].kind !== 'photos' || pages[j].kind !== 'photos') return
      ;[pages[i], pages[j]] = [pages[j], pages[i]]
      const next = { pages, generatedAt: Date.now() }
      await db.putAlbum(cur.id, next)
      setAlbum(next)
    },
    [album],
  )

  const startDemo = useCallback(
    async (themeId?: string) => {
      const p = await createProject({
        title: 'Maa Pelli',
        hosts: 'Sireesha  ·  Karthik',
        eventDate: '14 February 2026',
        venue: 'Kalyana Mandapam, Rajahmundry',
        occasionNote: 'A Godavari-side Telugu wedding — pellikuthuru, muhurtham and a reception.',
        language: 'telugu',
        album: { ...defaultAlbum(), themeId: themeId ?? 'godavari', pageSizeId: 'sq8', density: 'balanced' },
      })
      setProject(p)
      setPhotos([])
      setAlbum(null)
      await addSamples('photographer')
      const list = await db.getPhotos(p.id)
      await db.putPhotos(list.map((x) => ({ ...x, status: 'approved' as const, starred: x.order === list[0].order })))
      setPhotos(await db.getPhotos(p.id))
      const finalized = await persist({ ...p, status: 'finalized', finalizedAt: Date.now() })
      await buildAlbum(finalized, await db.getPhotos(p.id))
      setToast('Demo album ready — sample photos approved and laid out.')
      return p.id
    },
    [addSamples, buildAlbum, createProject, persist],
  )



  /* ---------------- plan ---------------- */

  const setPlan = useCallback((id: PlanId) => {
    setPlanId(id)
    writePlan(id, session.phone)
    setPaywall(null)
    const next = planOf(id)
    setToast(
      next.limits.printGrade
        ? `${next.name} is on. New photos import at full quality — re-import your originals to upgrade this album.`
        : `Switched to ${next.name}.`,
    )
  }, [session.phone])

  const showPaywall = useCallback((p: Paywall) => setPaywall(p), [])
  const dismissPaywall = useCallback(() => setPaywall(null), [])

  /** After upgrading, the originals are still in the phone's gallery. Re-picking
   *  them swaps the compressed copies for print-grade ones, in place, so the
   *  album, its chapters and every edit survive. */
  const reimportOriginals = useCallback(async (files: File[]) => {
    const cur = projectRef.current
    if (!cur) return { upgraded: 0, unmatched: 0 }
    const limits = planRef.current.limits
    const all = await db.getPhotos(cur.id)
    const { matches, unmatched: missed } = matchOriginals(all, files)

    let upgraded = 0
    let unmatched = missed.length
    setProgress({ done: 0, total: matches.length, label: 'Bringing in your originals' })
    for (let i = 0; i < matches.length; i++) {
      const { file, photo: match } = matches[i]
      setProgress({ done: i, total: matches.length, label: `Upgrading ${file.name}` })
      try {
        const prepared = await prepareUpload(file, {
          maxPx: limits.ingestMaxPx,
          quality: limits.ingestQuality,
        })
        const existing = await db.getBlobs(match.id)
        await db.putBlobs({
          photoId: match.id,
          full: prepared.full,
          thumb: prepared.thumb,
          // The old comparison no longer describes what is stored.
          sampleReal: undefined,
          sampleStored: existing?.sampleStored,
        })
        await db.putPhoto({
          ...match,
          width: prepared.width,
          height: prepared.height,
          sourceWidth: prepared.sourceWidth,
          sourceHeight: prepared.sourceHeight,
          bytes: file.size,
          printGrade: limits.printGrade,
          hasSample: false,
        })
        releaseThumbUrl(match.id)
        upgraded++
      } catch (err) {
        console.error('Could not re-import', file.name, err)
        unmatched++
      }
      await new Promise((r) => setTimeout(r, 0))
    }
    setProgress(null)
    previewCache.clear()
    setPhotos(await db.getPhotos(cur.id))
    setToast(
      upgraded
        ? `${upgraded} photo${upgraded > 1 ? 's' : ''} upgraded to print quality.`
        : 'None of those files matched the photos in this album.',
    )
    return { upgraded, unmatched }
  }, [])

  /* ---------------- album assistant ---------------- */

  const snapshot = useCallback(() => {
    const cur = projectRef.current
    if (!cur) return
    undoStack.current = [{ project: cur, photos: photosRef.current.map((p) => ({ ...p })) }, ...undoStack.current].slice(0, 5)
    setCanUndo(true)
  }, [])

  const setLanguage = useCallback(
    async (language: Language) => {
      const cur = projectRef.current
      if (!cur) return
      await persist({ ...cur, language })
    },
    [persist],
  )

  const occasionOf = (p: Project) => {
    const theme = themeById(p.album.themeId)
    return p.occasionNote?.trim() ? `${theme.occasion} — ${p.occasionNote.trim()}` : theme.occasion
  }

  const applyVerdicts = useCallback(async (cur: Project, verdicts: PhotoVerdict[]) => {
    const all = await db.getPhotos(cur.id)
    const map = new Map(verdicts.map((v) => [v.id, v]))
    const next = all.map((p) => {
      const v = map.get(p.id)
      if (!v) return p
      return {
        ...p,
        status: (v.keep ? 'approved' : 'rejected') as PhotoStatus,
        starred: v.hero,
        caption: p.caption || v.caption,
        captionNative: v.caption_native || undefined,
        ceremony: v.ceremony,
        aiScore: Math.round(v.score),
        aiIssues: v.issues,
        aiReason: v.reason,
        focusX: v.focus_x,
        focusY: v.focus_y,
      }
    })
    await db.putPhotos(next.filter((p) => map.has(p.id)))
    setPhotos(next)
    return next
  }, [])

  const runCurate = useCallback(async () => {
    const cur = projectRef.current
    if (!cur) return null
    const all = photosRef.current
    if (!all.length) {
      setToast('Add some photos first.')
      return null
    }
    // The assistant is metered: review the unreviewed ones first.
    const limit = planRef.current.limits.aiPhotoLimit
    const unreviewed = all.filter((p) => p.aiScore === undefined)
    const queue = unreviewed.length ? unreviewed : all
    const targets = Number.isFinite(limit) ? queue.slice(0, limit) : queue
    const skipped = queue.length - targets.length
    if (!targets.length) {
      setPaywall({
        reason: 'You have used this album\u2019s assistant quota',
        detail: `${planRef.current.name} reviews ${limit} photos per album. Upgrade to have it look at all of them.`,
      })
      return null
    }
    snapshot()
    setAi((a) => ({ ...a, busy: 'Looking through your photos…' }))
    setProgress({ done: 0, total: targets.length, label: 'The assistant is reviewing your photos' })
    try {
      const verdicts = await curatePhotos(
        targets.map((p) => ({ id: p.id, name: p.name })),
        { occasion: occasionOf(cur), language: cur.language, notes: cur.occasionNote, batch: ai.batch },
        (p) => setProgress({ done: p.done, total: p.total, label: 'The assistant is reviewing your photos' }),
      )
      if (!verdicts.length) {
        setToast('The assistant did not return any verdicts.')
        return null
      }
      const next = await applyVerdicts(cur, verdicts)
      await persist({ ...cur, curatedAt: Date.now(), status: cur.status === 'collecting' ? 'review' : cur.status })
      const kept = next.filter((p) => p.status === 'approved').length
      const dropped = next.filter((p) => p.status === 'rejected').length
      setToast(`Reviewed ${verdicts.length} photos — ${kept} kept, ${dropped} left out.`)
      if (skipped > 0) {
        // Say it, do not seize the screen with a modal mid-flow.
        setToast(
          `Reviewed ${verdicts.length} of ${all.length} — ${planRef.current.name} covers ${limit} photos per album.`,
        )
      }
      return { kept, dropped }
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'The assistant could not review these photos.')
      return null
    } finally {
      setProgress(null)
      setAi((a) => ({ ...a, busy: null }))
    }
  }, [ai.batch, applyVerdicts, persist, snapshot])

  const runStory = useCallback(async () => {
    const cur = projectRef.current
    if (!cur) return false
    const approved = photosRef.current.filter((p) => p.status === 'approved')
    if (approved.length < 2) {
      setToast('Approve at least two photos first.')
      return false
    }
    snapshot()
    setAi((a) => ({ ...a, busy: 'Planning the running order…' }))
    try {
      const story = await aiBuildStory({
        occasion: occasionOf(cur),
        language: cur.language,
        hosts: cur.hosts,
        eventDate: cur.eventDate,
        venue: cur.venue,
        notes: cur.occasionNote,
        themeIds: themeCatalogue(),
        photos: approved.map((p) => ({
          id: p.id,
          ceremony: p.ceremony ?? 'other',
          score: p.aiScore ?? 60,
          hero: p.starred,
          caption: p.caption,
        })),
      })

      // Keep only real photo ids, and never place the same photo in two chapters.
      const live = new Set(approved.map((p) => p.id))
      const placed = new Set<string>()
      const chapters = story.chapters
        .map((c) => {
          const photoIds: string[] = []
          for (const id of c.photo_ids) {
            if (!live.has(id) || placed.has(id)) continue
            placed.add(id)
            photoIds.push(id)
          }
          return { id: c.id || newId('ch_'), title: c.title, titleNative: c.title_native, blurb: c.blurb, photoIds }
        })
        .filter((c) => c.photoIds.length > 0)

      const themeId = THEMES.some((t) => t.id === story.theme_id) ? story.theme_id : cur.album.themeId
      const coverPhotoId = live.has(story.cover_photo_id) ? story.cover_photo_id : cur.coverPhotoId

      const next = await persist({
        ...cur,
        title: story.title || cur.title,
        hosts: story.subtitle || cur.hosts,
        chapters,
        coverPhotoId,
        aiNotes: story.notes,
        status: 'finalized',
        finalizedAt: cur.finalizedAt ?? Date.now(),
        album: { ...cur.album, themeId },
      })
      await buildAlbum(next, await db.getPhotos(cur.id))
      setToast(`Album planned — ${chapters.length} chapters.`)
      return true
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'The assistant could not plan this album.')
      return false
    } finally {
      setAi((a) => ({ ...a, busy: null }))
    }
  }, [buildAlbum, persist, snapshot])

  const sendEdit = useCallback(
    async (instruction: string) => {
      const cur = projectRef.current
      if (!cur || !instruction.trim()) return
      const history = chat.map((t) => ({ role: t.role, content: t.content }))
      setChat((c) => [...c, { role: 'user', content: instruction }])
      setAi((a) => ({ ...a, busy: 'Working on it…' }))
      try {
        const result = await requestEdit({
          instruction,
          language: cur.language,
          history,
          album: {
            title: cur.title,
            hosts: cur.hosts,
            eventDate: cur.eventDate,
            venue: cur.venue,
            themeId: cur.album.themeId,
            pageSizeId: cur.album.pageSizeId,
            density: cur.album.density,
            showCaptions: cur.album.showCaptions,
            showPageNumbers: cur.album.showPageNumbers,
            includeCover: cur.album.includeCover,
            includeClosing: cur.album.includeClosing,
            includeChapterPages: cur.album.includeChapterPages,
            coverPhotoId: cur.coverPhotoId,
          },
          themeIds: themeCatalogue(),
          pageSizeIds: PAGE_SIZES.map((s) => ({ id: s.id, label: s.label })),
          chapters: cur.chapters.map((c) => ({ id: c.id, title: c.title, photoCount: c.photoIds.length })),
          photos: photosRef.current.map((p) => ({
            id: p.id,
            ceremony: p.ceremony ?? 'other',
            status: p.status,
            starred: p.starred,
            caption: p.caption,
            score: p.aiScore,
            issues: p.aiIssues,
          })),
        })

        if (result.ops.length) {
          snapshot()
          const applied = applyOps(cur, photosRef.current, result.ops as EditOp[])
          await db.putPhotos(applied.photos)
          setPhotos(applied.photos)
          const saved = await persist(applied.project)
          if (applied.needsRelayout) await buildAlbum(saved, applied.photos)
          setChat((c) => [
            ...c,
            { role: 'assistant', content: result.reply, changes: applied.changes, rejected: applied.rejected },
          ])
        } else {
          setChat((c) => [...c, { role: 'assistant', content: result.reply }])
        }
      } catch (err) {
        setChat((c) => [
          ...c,
          {
            role: 'assistant',
            content: err instanceof Error ? err.message : 'That did not work.',
            failed: true,
          },
        ])
      } finally {
        setAi((a) => ({ ...a, busy: null }))
      }
    },
    [buildAlbum, chat, persist, snapshot],
  )

  const undoAiEdit = useCallback(async () => {
    const [last, ...rest] = undoStack.current
    if (!last) return
    undoStack.current = rest
    setCanUndo(rest.length > 0)
    await db.putPhotos(last.photos)
    setPhotos(last.photos)
    const saved = await persist(last.project)
    if (saved.status === 'finalized') await buildAlbum(saved, last.photos)
    setToast('Reverted the last change.')
  }, [buildAlbum, persist])

  const clearChat = useCallback(() => setChat([]), [])

  // Regenerating on option changes keeps the preview honest with the settings.
  const lastOptsRef = useRef<string>('')
  useEffect(() => {
    if (!project || project.status !== 'finalized') return
    const key = JSON.stringify([
      project.album.themeId,
      project.album.pageSizeId,
      project.album.density,
      project.album.includeCover,
      project.album.includeClosing,
      project.album.includeChapterPages,
      project.album.featuredPhotoIds.join(','),
      project.chapters.map((c) => c.id).join(','),
      project.coverPhotoId,
    ])
    if (lastOptsRef.current === '') {
      lastOptsRef.current = key
      return
    }
    if (lastOptsRef.current === key) return
    lastOptsRef.current = key
    db.getPhotos(project.id).then((list) => buildAlbum(project, list))
  }, [project, buildAlbum])

  /* ---------------- studio <-> customer ---------------- */

  const refreshDeliveries = useCallback(async () => {
    if (session.role === 'studio') {
      setSent(await sentBy(session.phone))
      setInbox([])
    } else {
      setInbox(await pendingFor(session.phone))
      setSent([])
    }
  }, [session.phone, session.role])

  // On a customer's first visit, put a take in their inbox, so signing in looks
  // like what it will look like in use: the photographer has already sent your
  // photos. Labelled as a demo delivery wherever it appears.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (session.role !== 'customer') {
        await refreshDeliveries()
        return
      }
      const waiting = await pendingFor(session.phone)
      const mine = (await db.getProjects()).filter(isMine)
      if (waiting.length || mine.length) {
        if (!cancelled) setInbox(waiting)
        return
      }
      setProgress({ done: 0, total: 1, label: 'Your photographer is sending your photos' })
      try {
        const samples: Array<{ blob: Blob; name: string }> = []
        const count = Math.max(await realSampleCount(), SAMPLE_COUNT)
        for (let i = 0; i < count; i++) samples.push(await makeSamplePhoto(i))
        await seedDemoDelivery(session.phone, samples, (done, total) =>
          setProgress({ done, total, label: 'Your photographer is sending your photos' }),
        )
      } catch (err) {
        console.error('Could not prepare the demo delivery', err)
      } finally {
        setProgress(null)
      }
      if (!cancelled) setInbox(await pendingFor(session.phone))
    })()
    return () => {
      cancelled = true
    }
  }, [session.phone, session.role, refreshDeliveries, isMine])

  const openInboxItem = useCallback(
    async (deliveryId: string) => {
      const limits = planRef.current.limits
      setProgress({ done: 0, total: 1, label: 'Opening your photos' })
      try {
        const result = await openDelivery(deliveryId, session.phone, {
          limits,
          onProgress: (done, total, name) =>
            setProgress({ done, total, label: name ? `Saving ${name}` : 'Opening your photos' }),
        })
        await refreshProjects()
        await refreshDeliveries()
        if (result.overflow) {
          setPaywall({
            reason: `${result.overflow} photo${result.overflow > 1 ? 's' : ''} did not fit`,
            detail: `${planRef.current.name} albums hold ${limits.maxPhotosPerAlbum} photos. A bigger plan holds the whole take.`,
          })
        } else if (!result.reopened && !limits.printGrade) {
          setToast('Your photos are here — stored as compressed copies on Free.')
        }
        return result.project.id
      } finally {
        setProgress(null)
      }
    },
    [session.phone, refreshProjects, refreshDeliveries],
  )

  const sendToCustomer = useCallback(
    async (opts: Omit<SendOptions, 'studioPhone'>) => {
      const cur = projectRef.current
      if (!cur) throw new Error('Open an event first.')
      setProgress({ done: 0, total: 1, label: 'Sending to your customer' })
      try {
        const { delivery, rejected } = await sendDelivery(cur, { ...opts, studioPhone: session.phone })
        await refreshDeliveries()
        return { sent: delivery.toPhones.length, rejected }
      } finally {
        setProgress(null)
      }
    },
    [session.phone, refreshDeliveries],
  )

  const value = useMemo<Ctx>(
    () => ({
      ready,
      projects,
      project,
      photos,
      album,
      progress,
      toast,
      setToast,
      createProject,
      openProject,
      closeProject,
      updateProject,
      updateAlbumOptions,
      removeProject,
      addFiles,
      addSamples,
      setStatus,
      patchPhoto,
      removePhoto,
      finalize,
      reopen,
      regenerate,
      shufflePage,
      movePage,
      refreshProjects,
      startDemo,
      ai,
      chat,
      canUndo,
      setLanguage,
      runCurate,
      runStory,
      sendEdit,
      undoAiEdit,
      clearChat,
      plan,
      setPlan,
      paywall,
      showPaywall,
      dismissPaywall,
      reimportOriginals,
      session,
      inbox,
      sent,
      refreshDeliveries,
      openInboxItem,
      sendToCustomer,
    }),
    [
      ready,
      projects,
      project,
      photos,
      album,
      progress,
      toast,
      createProject,
      openProject,
      closeProject,
      updateProject,
      updateAlbumOptions,
      removeProject,
      addFiles,
      addSamples,
      setStatus,
      patchPhoto,
      removePhoto,
      finalize,
      reopen,
      regenerate,
      shufflePage,
      movePage,
      refreshProjects,
      startDemo,
      ai,
      chat,
      canUndo,
      setLanguage,
      runCurate,
      runStory,
      sendEdit,
      undoAiEdit,
      clearChat,
      plan,
      setPlan,
      paywall,
      showPaywall,
      dismissPaywall,
      reimportOriginals,
      session,
      inbox,
      sent,
      refreshDeliveries,
      openInboxItem,
      sendToCustomer,
    ],
  )

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}
