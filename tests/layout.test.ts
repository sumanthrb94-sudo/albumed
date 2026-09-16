import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { generatePages, TEMPLATES, templatesFor } from '../src/lib/layout'
import type { AlbumChapter, Photo } from '../src/lib/types'

const photo = (id: string, portrait = false): Photo => ({
  id,
  projectId: 'p1',
  name: `${id}.jpg`,
  source: 'photographer',
  status: 'approved',
  starred: false,
  caption: '',
  note: '',
  width: portrait ? 1200 : 1600,
  height: portrait ? 1600 : 1200,
  bytes: 1,
  addedAt: 0,
  order: Number(id.slice(1)),
})

const many = (n: number) => Array.from({ length: n }, (_, i) => photo(`a${i}`, i % 3 === 0))

const base = {
  density: 'balanced' as const,
  pageAspect: 1,
  seed: 42,
  includeCover: false,
  includeClosing: false,
  shape: 'round' as const,
  coverHeading: 'T',
  coverSub: 'S',
  closingHeading: 'C',
  closingSub: '',
}

const photoIdsIn = (pages: ReturnType<typeof generatePages>) =>
  pages.filter((p) => p.kind === 'photos').flatMap((p) => p.slots.map((s) => s.photoId))

test('every approved photo lands on exactly one page', () => {
  const photos = many(17)
  const ids = photoIdsIn(generatePages({ ...base, photos }))
  assert.equal(ids.length, 17)
  assert.equal(new Set(ids).size, 17)
})

test('slots never overflow the page', () => {
  for (const t of TEMPLATES) {
    for (const s of t.slots) {
      assert.ok(s.x >= -0.001 && s.y >= -0.001, `${t.id} slot starts off-page`)
      assert.ok(s.x + s.w <= 1.001, `${t.id} slot runs past the right edge`)
      assert.ok(s.y + s.h <= 1.001, `${t.id} slot runs past the bottom edge`)
    }
    assert.equal(t.slots.length, t.count, `${t.id} declares the wrong photo count`)
    assert.equal(t.prefer.length, t.count, `${t.id} has the wrong number of orientation hints`)
  }
})

test('there is at least one template for every page size the generator asks for', () => {
  for (let n = 1; n <= 6; n++) assert.ok(templatesFor(n).length > 0, `no template holds ${n} photos`)
})

test('a featured photo gets a page to itself', () => {
  const photos = many(9)
  const pages = generatePages({ ...base, photos, featuredPhotoIds: ['a4'] })
  const page = pages.find((p) => p.slots.some((s) => s.photoId === 'a4'))!
  assert.equal(page.slots.length, 1)
  assert.equal(photoIdsIn(pages).length, 9)
})

test('chapters produce divider pages and keep their photos together', () => {
  const chapters: AlbumChapter[] = [
    { id: 'muhurtham', title: 'Muhurtham', titleNative: '', blurb: '', photoIds: ['a0', 'a1', 'a2'] },
    { id: 'reception', title: 'Reception', titleNative: '', blurb: '', photoIds: ['a3', 'a4'] },
  ]
  const pages = generatePages({ ...base, photos: many(5), chapters, includeChapterPages: true })
  const dividers = pages.filter((p) => p.kind === 'chapter')
  assert.equal(dividers.length, 2)
  assert.deepEqual(
    dividers.map((d) => d.heading),
    ['Muhurtham', 'Reception'],
  )
  const reception = pages.filter((p) => p.kind === 'photos' && p.chapterId === 'reception')
  assert.deepEqual(reception.flatMap((p) => p.slots.map((s) => s.photoId)).sort(), ['a3', 'a4'])
})

test('photos the assistant forgot to place still make the album', () => {
  const chapters: AlbumChapter[] = [
    { id: 'muhurtham', title: 'Muhurtham', titleNative: '', blurb: '', photoIds: ['a0', 'a1'] },
  ]
  const pages = generatePages({ ...base, photos: many(6), chapters, includeChapterPages: true })
  assert.equal(photoIdsIn(pages).length, 6)
})

test('a photo listed in two chapters is only printed once', () => {
  const chapters: AlbumChapter[] = [
    { id: 'one', title: 'One', titleNative: '', blurb: '', photoIds: ['a0', 'a1'] },
    { id: 'two', title: 'Two', titleNative: '', blurb: '', photoIds: ['a1', 'a2'] },
  ]
  const ids = photoIdsIn(generatePages({ ...base, photos: many(3), chapters, includeChapterPages: false }))
  assert.equal(new Set(ids).size, 3)
  assert.equal(ids.length, 3)
})

test('the same seed lays out the same album twice', () => {
  const photos = many(12)
  const a = generatePages({ ...base, photos })
  const b = generatePages({ ...base, photos })
  assert.deepEqual(
    a.map((p) => p.templateId),
    b.map((p) => p.templateId),
  )
})

test('a different seed gives a different album', () => {
  const photos = many(14)
  const a = generatePages({ ...base, photos, seed: 1 }).map((p) => p.templateId)
  const b = generatePages({ ...base, photos, seed: 99 }).map((p) => p.templateId)
  assert.notDeepEqual(a, b)
})

test('cover and closing pages are added when asked for', () => {
  const pages = generatePages({ ...base, photos: many(4), includeCover: true, includeClosing: true })
  assert.equal(pages[0].kind, 'cover')
  assert.equal(pages[pages.length - 1].kind, 'closing')
})
