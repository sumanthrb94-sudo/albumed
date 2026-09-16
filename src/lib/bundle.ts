/* Project backup / handover file (.albumed.json).
   Everything lives on the device, so this file is how a project moves between
   a photographer's phone and the customer's phone. */
import { getAlbum, getBlobs, getPhotos, putAlbum, putBlobs, putPhoto, putProject } from './db'
import { uid } from './id'
import type { Album, Photo, Project } from './types'

const FORMAT = 'albumed-bundle'
const VERSION = 1

interface BundlePhoto {
  meta: Photo
  full: string // data URL
  thumb: string // data URL
}

export interface Bundle {
  format: typeof FORMAT
  version: number
  exportedAt: number
  project: Project
  album: Album | null
  photos: BundlePhoto[]
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(b)
  })
}

async function dataUrlToBlob(d: string): Promise<Blob> {
  const res = await fetch(d)
  return res.blob()
}

export interface BundleOptions {
  /** Ship only thumbnails — small enough for WhatsApp, fine for approving. */
  thumbsOnly: boolean
}

export async function exportBundle(
  project: Project,
  opts: BundleOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const photos = await getPhotos(project.id)
  const album = (await getAlbum(project.id)) ?? null
  const out: BundlePhoto[] = []
  for (let i = 0; i < photos.length; i++) {
    const rec = await getBlobs(photos[i].id)
    if (!rec) continue
    const thumb = await blobToDataUrl(rec.thumb)
    out.push({
      meta: photos[i],
      thumb,
      full: opts.thumbsOnly ? thumb : await blobToDataUrl(rec.full),
    })
    onProgress?.(i + 1, photos.length)
  }
  const bundle: Bundle = {
    format: FORMAT,
    version: VERSION,
    exportedAt: Date.now(),
    project,
    album: album ? { pages: album.pages, generatedAt: album.generatedAt } : null,
    photos: out,
  }
  return new Blob([JSON.stringify(bundle)], { type: 'application/json' })
}

export async function importBundle(file: File): Promise<Project> {
  const parsed = JSON.parse(await file.text()) as Bundle
  if (parsed?.format !== FORMAT) throw new Error('That file is not an Albumed project bundle.')

  const newId = uid('prj_')
  const project: Project = {
    ...parsed.project,
    id: newId,
    title: parsed.project.title,
    updatedAt: Date.now(),
  }
  await putProject(project)

  const idMap = new Map<string, string>()
  for (const p of parsed.photos) {
    const pid = uid('ph_')
    idMap.set(p.meta.id, pid)
    await putPhoto({ ...p.meta, id: pid, projectId: newId })
    await putBlobs({ photoId: pid, full: await dataUrlToBlob(p.full), thumb: await dataUrlToBlob(p.thumb) })
  }

  if (parsed.album) {
    await putAlbum(newId, {
      generatedAt: parsed.album.generatedAt,
      pages: parsed.album.pages.map((pg) => ({
        ...pg,
        slots: pg.slots.map((s) => ({ ...s, photoId: idMap.get(s.photoId) ?? s.photoId })),
      })),
    })
  }
  if (project.coverPhotoId) project.coverPhotoId = idMap.get(project.coverPhotoId) ?? undefined
  await putProject(project)
  return project
}

/** Merge review decisions from a returned bundle into an existing project, matched by file name + size. */
export async function mergeDecisions(
  target: Project,
  file: File,
): Promise<{ updated: number; skipped: number }> {
  const parsed = JSON.parse(await file.text()) as Bundle
  if (parsed?.format !== FORMAT) throw new Error('That file is not an Albumed project bundle.')
  const mine = await getPhotos(target.id)
  const key = (p: Photo) => `${p.name}|${p.bytes}`
  const byKey = new Map(mine.map((p) => [key(p), p]))
  let updated = 0
  let skipped = 0
  for (const bp of parsed.photos) {
    const match = byKey.get(key(bp.meta))
    if (!match) {
      skipped++
      continue
    }
    await putPhoto({
      ...match,
      status: bp.meta.status,
      starred: bp.meta.starred,
      note: bp.meta.note,
      caption: bp.meta.caption || match.caption,
    })
    updated++
  }
  return { updated, skipped }
}
