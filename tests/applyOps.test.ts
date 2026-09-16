import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { applyOps } from '../src/lib/applyOps'
import type { EditOp } from '../src/lib/aiContract'
import type { Photo, Project } from '../src/lib/types'

const photo = (id: string, over: Partial<Photo> = {}): Photo => ({
  id,
  projectId: 'p1',
  name: `${id}.jpg`,
  source: 'photographer',
  status: 'approved',
  starred: false,
  caption: '',
  note: '',
  width: 1600,
  height: 1200,
  bytes: 1000,
  addedAt: 0,
  order: Number(id.slice(1)),
  ...over,
})

const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1',
  title: 'Our Muhurtham',
  hosts: 'Priya & Arjun',
  eventDate: '',
  venue: '',
  occasionNote: '',
  status: 'finalized',
  createdAt: 0,
  updatedAt: 0,
  language: 'english',
  chapters: [
    { id: 'muhurtham', title: 'Muhurtham', titleNative: '', blurb: '', photoIds: ['a1', 'a2'] },
    { id: 'reception', title: 'Reception', titleNative: '', blurb: '', photoIds: ['a3'] },
  ],
  album: {
    themeId: 'vivah-gold',
    pageSizeId: 'sq8',
    density: 'balanced',
    includeCover: true,
    includeClosing: true,
    includeChapterPages: true,
    showCaptions: true,
    showPageNumbers: true,
    featuredPhotoIds: [],
    seed: 1,
  },
  ...over,
})

const photos = () => [photo('a1'), photo('a2'), photo('a3')]

test('applies a known theme and asks for a relayout', () => {
  const r = applyOps(project(), photos(), [{ op: 'set_theme', theme_id: 'kasavu' }])
  assert.equal(r.project.album.themeId, 'kasavu')
  assert.equal(r.needsRelayout, true)
  assert.equal(r.rejected.length, 0)
})

test('rejects a theme that does not exist and leaves the album alone', () => {
  const r = applyOps(project(), photos(), [{ op: 'set_theme', theme_id: 'not-a-theme' }])
  assert.equal(r.project.album.themeId, 'vivah-gold')
  assert.equal(r.changes.length, 0)
  assert.match(r.rejected[0], /Unknown album template/)
})

test('ignores photo ids the album does not contain', () => {
  const r = applyOps(project(), photos(), [{ op: 'drop_photos', photo_ids: ['ghost', 'nope'] }])
  assert.equal(r.photos.filter((p) => p.status === 'rejected').length, 0)
  assert.equal(r.rejected.length, 1)
})

test('dropping a photo removes it from its chapter', () => {
  const r = applyOps(project(), photos(), [{ op: 'drop_photos', photo_ids: ['a1'] }])
  assert.equal(r.photos.find((p) => p.id === 'a1')!.status, 'rejected')
  assert.deepEqual(r.project.chapters.find((c) => c.id === 'muhurtham')!.photoIds, ['a2'])
})

test('a chapter left with no photos disappears', () => {
  const r = applyOps(project(), photos(), [{ op: 'drop_photos', photo_ids: ['a3'] }])
  assert.deepEqual(
    r.project.chapters.map((c) => c.id),
    ['muhurtham'],
  )
})

test('featuring a photo approves it and records it', () => {
  const start = photos().map((p) => (p.id === 'a2' ? { ...p, status: 'rejected' as const } : p))
  const r = applyOps(project(), start, [{ op: 'feature_photos', photo_ids: ['a2'] }])
  assert.deepEqual(r.project.album.featuredPhotoIds, ['a2'])
  assert.equal(r.photos.find((p) => p.id === 'a2')!.status, 'approved')
})

test('reordering chapters keeps every chapter', () => {
  const r = applyOps(project(), photos(), [{ op: 'reorder_chapters', chapter_ids: ['reception', 'muhurtham'] }])
  assert.deepEqual(
    r.project.chapters.map((c) => c.id),
    ['reception', 'muhurtham'],
  )
})

test('an unknown chapter id in a reorder is refused, not guessed', () => {
  const r = applyOps(project(), photos(), [{ op: 'reorder_chapters', chapter_ids: ['ghost'] }])
  assert.deepEqual(
    r.project.chapters.map((c) => c.id),
    ['muhurtham', 'reception'],
  )
  assert.equal(r.rejected.length, 1)
})

test('captions only land on photos that exist', () => {
  const r = applyOps(project(), photos(), [
    { op: 'set_captions', captions: [{ photo_id: 'a1', caption: 'The thaali' }, { photo_id: 'x', caption: 'nope' }] },
  ])
  assert.equal(r.photos.find((p) => p.id === 'a1')!.caption, 'The thaali')
  assert.match(r.changes[0], /1 caption/)
})

test('toggles flip the album options they name and nothing else', () => {
  const r = applyOps(project(), photos(), [{ op: 'toggle', captions: false, chapter_pages: false }])
  assert.equal(r.project.album.showCaptions, false)
  assert.equal(r.project.album.includeChapterPages, false)
  assert.equal(r.project.album.showPageNumbers, true)
})

test('a run of operations applies in order', () => {
  const ops: EditOp[] = [
    { op: 'set_text', title: 'Kalyanam' },
    { op: 'set_language', language: 'tamil' },
    { op: 'set_cover', photo_id: 'a3' },
    { op: 'regenerate' },
  ]
  const r = applyOps(project(), photos(), ops)
  assert.equal(r.project.title, 'Kalyanam')
  assert.equal(r.project.language, 'tamil')
  assert.equal(r.project.coverPhotoId, 'a3')
  assert.equal(r.changes.length, 4)
})

test('the input project is not mutated', () => {
  const p = project()
  applyOps(p, photos(), [{ op: 'set_theme', theme_id: 'kasavu' }, { op: 'drop_photos', photo_ids: ['a1'] }])
  assert.equal(p.album.themeId, 'vivah-gold')
  assert.deepEqual(p.chapters.find((c) => c.id === 'muhurtham')!.photoIds, ['a1', 'a2'])
})

test('un-featuring a photo puts it back in with the others', () => {
  const p = project()
  p.album.featuredPhotoIds = ['a1']
  const r = applyOps(p, photos(), [{ op: 'unfeature_photos', photo_ids: ['a1'] }])
  assert.deepEqual(r.project.album.featuredPhotoIds, [])
  assert.equal(r.needsRelayout, true)
})

test('un-featuring a photo that was never featured is refused', () => {
  const r = applyOps(project(), photos(), [{ op: 'unfeature_photos', photo_ids: ['a2'] }])
  assert.equal(r.changes.length, 0)
  assert.equal(r.rejected.length, 1)
})
