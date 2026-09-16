/* Applies the assistant's edit operations to a project.
   Pure: takes the current state, returns the next one plus a human-readable
   list of what changed. Every id is validated against what actually exists —
   the model's output is a proposal, not a command. */
import type { EditOp } from './aiContract'
import { PAGE_SIZES, THEMES } from './themes'
import type { AlbumChapter, Photo, Project } from './types'

export interface ApplyResult {
  project: Project
  photos: Photo[]
  /** One line per applied operation, shown to the customer. */
  changes: string[]
  /** Operations that referred to things that do not exist. */
  rejected: string[]
  /** Whether the pages have to be laid out again. */
  needsRelayout: boolean
}

const titleOf = (list: Array<{ id: string; name?: string; label?: string }>, id: string) =>
  list.find((x) => x.id === id)?.name ?? list.find((x) => x.id === id)?.label ?? id

export function applyOps(project: Project, photos: Photo[], ops: EditOp[]): ApplyResult {
  let next: Project = { ...project, album: { ...project.album }, chapters: project.chapters.map((c) => ({ ...c })) }
  const byId = new Map(photos.map((p) => [p.id, { ...p }]))
  const changes: string[] = []
  const rejected: string[] = []
  let needsRelayout = false

  const knownPhotos = (ids: string[]) => ids.filter((id) => byId.has(id))

  for (const op of ops) {
    switch (op.op) {
      case 'set_theme': {
        if (!THEMES.some((t) => t.id === op.theme_id)) {
          rejected.push(`Unknown album template "${op.theme_id}"`)
          break
        }
        next.album.themeId = op.theme_id
        changes.push(`Template → ${titleOf(THEMES, op.theme_id)}`)
        needsRelayout = true
        break
      }
      case 'set_page_size': {
        if (!PAGE_SIZES.some((s) => s.id === op.page_size_id)) {
          rejected.push(`Unknown page size "${op.page_size_id}"`)
          break
        }
        next.album.pageSizeId = op.page_size_id
        changes.push(`Page size → ${titleOf(PAGE_SIZES, op.page_size_id)}`)
        needsRelayout = true
        break
      }
      case 'set_density':
        next.album.density = op.density
        changes.push(`Photos per page → ${op.density}`)
        needsRelayout = true
        break
      case 'set_text': {
        const fields: Array<[keyof Project, string | undefined, string]> = [
          ['title', op.title, 'Title'],
          ['hosts', op.hosts, 'Names'],
          ['eventDate', op.event_date, 'Date'],
          ['venue', op.venue, 'Venue'],
        ]
        for (const [key, value, label] of fields) {
          if (value === undefined) continue
          next = { ...next, [key]: value }
          changes.push(`${label} → “${value}”`)
        }
        needsRelayout = true
        break
      }
      case 'set_language':
        next.language = op.language
        changes.push(`Caption language → ${op.language}`)
        break
      case 'set_cover': {
        if (!byId.has(op.photo_id)) {
          rejected.push('Cover photo not found')
          break
        }
        next.coverPhotoId = op.photo_id
        const photo = byId.get(op.photo_id)!
        byId.set(op.photo_id, { ...photo, status: 'approved' })
        changes.push('New cover photo')
        needsRelayout = true
        break
      }
      case 'feature_photos': {
        const ids = knownPhotos(op.photo_ids)
        if (!ids.length) {
          rejected.push('No matching photos to feature')
          break
        }
        const set = new Set([...next.album.featuredPhotoIds, ...ids])
        next.album.featuredPhotoIds = [...set]
        ids.forEach((id) => byId.set(id, { ...byId.get(id)!, status: 'approved' }))
        changes.push(`${ids.length} photo${ids.length > 1 ? 's' : ''} given a full page`)
        needsRelayout = true
        break
      }
      case 'unfeature_photos': {
        const ids = knownPhotos(op.photo_ids)
        const before = next.album.featuredPhotoIds.length
        next.album.featuredPhotoIds = next.album.featuredPhotoIds.filter((id) => !ids.includes(id))
        const removed = before - next.album.featuredPhotoIds.length
        if (!removed) {
          rejected.push('None of those photos had a page of their own')
          break
        }
        changes.push(`${removed} photo${removed > 1 ? 's' : ''} back in with the others`)
        needsRelayout = true
        break
      }
      case 'drop_photos': {
        const ids = knownPhotos(op.photo_ids)
        if (!ids.length) {
          rejected.push('No matching photos to remove')
          break
        }
        ids.forEach((id) => byId.set(id, { ...byId.get(id)!, status: 'rejected' }))
        next.album.featuredPhotoIds = next.album.featuredPhotoIds.filter((id) => !ids.includes(id))
        next.chapters = next.chapters.map((c) => ({ ...c, photoIds: c.photoIds.filter((id) => !ids.includes(id)) }))
        changes.push(`${ids.length} photo${ids.length > 1 ? 's' : ''} taken out of the album`)
        needsRelayout = true
        break
      }
      case 'restore_photos': {
        const ids = knownPhotos(op.photo_ids)
        if (!ids.length) {
          rejected.push('No matching photos to restore')
          break
        }
        ids.forEach((id) => byId.set(id, { ...byId.get(id)!, status: 'approved' }))
        changes.push(`${ids.length} photo${ids.length > 1 ? 's' : ''} put back in`)
        needsRelayout = true
        break
      }
      case 'set_captions': {
        let n = 0
        for (const c of op.captions) {
          const photo = byId.get(c.photo_id)
          if (!photo) continue
          byId.set(c.photo_id, { ...photo, caption: c.caption })
          n++
        }
        if (!n) rejected.push('None of those photos were found for captioning')
        else changes.push(`${n} caption${n > 1 ? 's' : ''} rewritten`)
        break
      }
      case 'reorder_chapters': {
        const known = new Map(next.chapters.map((c) => [c.id, c]))
        const unknown = op.chapter_ids.filter((id) => !known.has(id))
        if (!op.chapter_ids.length || unknown.length) {
          rejected.push(`Could not reorder the chapters: no chapter named ${unknown.join(', ') || '(nothing given)'}`)
          break
        }
        const ordered: AlbumChapter[] = []
        const seen = new Set<string>()
        for (const id of op.chapter_ids) {
          if (seen.has(id)) continue
          seen.add(id)
          ordered.push(known.get(id)!)
        }
        // Anything the model left out keeps its place at the end.
        for (const c of next.chapters) if (!seen.has(c.id)) ordered.push(c)
        next.chapters = ordered
        changes.push('Chapters reordered')
        needsRelayout = true
        break
      }
      case 'rename_chapter': {
        const idx = next.chapters.findIndex((c) => c.id === op.chapter_id)
        if (idx < 0) {
          rejected.push(`Unknown chapter "${op.chapter_id}"`)
          break
        }
        next.chapters[idx] = { ...next.chapters[idx], title: op.title, titleNative: op.title_native }
        changes.push(`Chapter renamed to “${op.title}”`)
        needsRelayout = true
        break
      }
      case 'drop_chapter': {
        const chapter = next.chapters.find((c) => c.id === op.chapter_id)
        if (!chapter) {
          rejected.push(`Unknown chapter "${op.chapter_id}"`)
          break
        }
        chapter.photoIds.forEach((id) => {
          const photo = byId.get(id)
          if (photo) byId.set(id, { ...photo, status: 'rejected' })
        })
        next.chapters = next.chapters.filter((c) => c.id !== op.chapter_id)
        changes.push(`Chapter “${chapter.title}” removed`)
        needsRelayout = true
        break
      }
      case 'toggle': {
        const flags: Array<[keyof typeof next.album, boolean | undefined, string]> = [
          ['showCaptions', op.captions, 'Captions'],
          ['showPageNumbers', op.page_numbers, 'Page numbers'],
          ['includeCover', op.cover, 'Cover page'],
          ['includeClosing', op.closing, 'Closing page'],
          ['includeChapterPages', op.chapter_pages, 'Chapter pages'],
        ]
        for (const [key, value, label] of flags) {
          if (value === undefined) continue
          ;(next.album as unknown as Record<string, boolean>)[key as string] = value
          changes.push(`${label} ${value ? 'on' : 'off'}`)
          needsRelayout = true
        }
        break
      }
      case 'regenerate':
        changes.push('Pages laid out again')
        needsRelayout = true
        break
    }
  }

  // Keep chapters honest about what is still in the album.
  const live = new Set([...byId.values()].filter((p) => p.status === 'approved').map((p) => p.id))
  next.chapters = next.chapters
    .map((c) => ({ ...c, photoIds: c.photoIds.filter((id) => live.has(id)) }))
    .filter((c) => c.photoIds.length > 0)

  return {
    project: next,
    photos: photos.map((p) => byId.get(p.id) ?? p),
    changes,
    rejected,
    needsRelayout,
  }
}
