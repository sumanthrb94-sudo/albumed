import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import * as db from './lib/db'
import { uid } from './lib/id'
import { makeSamplePhoto, prepareUpload, releaseThumbUrl, SAMPLE_COUNT } from './lib/images'
import { generatePages, relayoutPage } from './lib/layout'
import { pageSizeById, themeById, THEMES } from './lib/themes'
import type { Album, AlbumOptions, Photo, PhotoSource, PhotoStatus, Project } from './lib/types'

export type ProjectInit = Partial<Omit<Project, 'album'>> & { album?: Partial<AlbumOptions> }

export interface Progress {
  done: number
  total: number
  label: string
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
}

const AppCtx = createContext<Ctx | null>(null)

export const useApp = (): Ctx => {
  const c = useContext(AppCtx)
  if (!c) throw new Error('useApp must be used inside <AppProvider>')
  return c
}

const defaultAlbum = (): AlbumOptions => ({
  themeId: THEMES[0].id,
  pageSizeId: 'sq8',
  density: 'balanced',
  includeCover: true,
  includeClosing: true,
  showCaptions: true,
  showPageNumbers: true,
  seed: Math.floor(Math.random() * 100000),
})

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [album, setAlbum] = useState<Album | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const projectRef = useRef<Project | null>(null)
  projectRef.current = project

  const refreshProjects = useCallback(async () => {
    const list = await db.getProjects()
    list.sort((a, b) => b.updatedAt - a.updatedAt)
    setProjects(list)
  }, [])

  useEffect(() => {
    refreshProjects().finally(() => setReady(true))
  }, [refreshProjects])

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
        title: init.title?.trim() || 'Our Album',
        hosts: init.hosts?.trim() || '',
        eventDate: init.eventDate ?? '',
        venue: init.venue ?? '',
        occasionNote: init.occasionNote ?? '',
        status: 'collecting',
        createdAt: now,
        updatedAt: now,
        album: { ...defaultAlbum(), ...(init.album ?? {}) },
      }
      await db.putProject(p)
      await refreshProjects()
      return p
    },
    [refreshProjects],
  )

  const openProject = useCallback(async (id: string) => {
    const p = await db.getProject(id)
    if (!p) return
    setProject(p)
    setPhotos(await db.getPhotos(id))
    setAlbum((await db.getAlbum(id)) ?? null)
  }, [])

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
      const existing = await db.getPhotos(cur.id)
      let order = existing.reduce((m, p) => Math.max(m, p.order), 0) + 1
      let added = 0
      for (let i = 0; i < items.length; i++) {
        setProgress({ done: i, total: items.length, label: `Processing ${items[i].name}` })
        try {
          const prepared = await prepareUpload(items[i].blob)
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
            bytes: items[i].bytes,
            addedAt: Date.now(),
            takenAt: items[i].takenAt,
            order: order++,
          }
          await db.putPhoto(photo)
          await db.putBlobs({ photoId: photo.id, full: prepared.full, thumb: prepared.thumb })
          added++
        } catch (err) {
          console.error('Could not read', items[i].name, err)
        }
        // let the progress bar paint
        await new Promise((r) => setTimeout(r, 0))
      }
      setProgress(null)
      setPhotos(await db.getPhotos(cur.id))
      if (added && cur.status === 'collecting') await persist({ ...cur, status: 'review' })
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
      for (let i = 0; i < SAMPLE_COUNT; i++) {
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
        title: 'Priya & Arjun',
        hosts: 'Priya Sharma  ·  Arjun Mehta',
        eventDate: '14 February 2026',
        venue: 'Umaid Bhawan, Jodhpur',
        occasionNote: 'Three days of haldi, mehendi, sangeet and the pheras.',
        album: { ...defaultAlbum(), themeId: themeId ?? 'vivah-gold', pageSizeId: 'sq8', density: 'balanced' },
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
    ],
  )

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}
