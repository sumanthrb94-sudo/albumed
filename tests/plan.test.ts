import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { checkoutFor, exportDpiOptions, formatInr, PLANS, planOf } from '../src/lib/plan'
import { matchOriginals } from '../src/lib/reimport'
import type { Photo } from '../src/lib/types'

test('free stores compressed photos and paid plans do not', () => {
  assert.equal(PLANS.free.limits.printGrade, false)
  assert.ok(PLANS.free.limits.ingestMaxPx < PLANS.plus.limits.ingestMaxPx)
  assert.ok(PLANS.free.limits.ingestQuality < PLANS.plus.limits.ingestQuality)
  for (const id of ['plus', 'studio'] as const) {
    assert.equal(PLANS[id].limits.printGrade, true)
    assert.equal(PLANS[id].limits.watermark, false)
  }
})

test('every limit gets better as the plan gets bigger', () => {
  const order = [PLANS.free, PLANS.plus, PLANS.studio]
  for (let i = 1; i < order.length; i++) {
    const a = order[i - 1].limits
    const b = order[i].limits
    assert.ok(b.ingestMaxPx >= a.ingestMaxPx, 'resolution must not go down')
    assert.ok(b.maxExportDpi >= a.maxExportDpi, 'export dpi must not go down')
    assert.ok(b.maxPhotosPerAlbum >= a.maxPhotosPerAlbum, 'album size must not go down')
    assert.ok(b.aiPhotoLimit >= a.aiPhotoLimit, 'assistant quota must not go down')
  }
})

test('free only exports a watermarked draft', () => {
  assert.equal(PLANS.free.limits.watermark, true)
  assert.ok(PLANS.free.limits.maxExportDpi < 300, 'press resolution must stay behind the paywall')
})

test('export options lock exactly what the plan cannot reach', () => {
  const free = exportDpiOptions('free')
  assert.deepEqual(
    free.filter((o) => o.locked).map((o) => o.dpi),
    [300, 600],
  )
  assert.equal(exportDpiOptions('plus').find((o) => o.dpi === 300)!.locked, false)
  assert.equal(exportDpiOptions('studio').some((o) => o.locked), false)
})

test('an unknown plan id falls back to free rather than unlocking anything', () => {
  const p = planOf('nonsense' as never)
  assert.equal(p.id, 'free')
  assert.equal(p.limits.printGrade, false)
})

test('checkout carries paise and a reference a provider can use', () => {
  const order = checkoutFor('plus')
  assert.equal(order.amountPaise, PLANS.plus.priceInr * 100)
  assert.equal(order.currency, 'INR')
  assert.match(order.reference, /^albumed_plus_/)
})

test('prices render in Indian format', () => {
  assert.match(formatInr(5999), /5,999/)
})

/* ---------------- re-importing originals ---------------- */

const photo = (id: string, name: string, bytes: number): Photo => ({
  id,
  projectId: 'p1',
  name,
  source: 'customer',
  status: 'approved',
  starred: false,
  caption: '',
  note: '',
  width: 1280,
  height: 960,
  bytes,
  addedAt: 0,
  order: 1,
  printGrade: false,
})

test('an identical file matches its photo exactly', () => {
  const photos = [photo('a', 'IMG_1.jpg', 1000)]
  const r = matchOriginals(photos, [{ name: 'IMG_1.jpg', size: 1000 }])
  assert.equal(r.matches[0].confidence, 'exact')
  assert.equal(r.unmatched.length, 0)
})

test('a re-encoded file still matches by name', () => {
  const photos = [photo('a', 'IMG_1.jpg', 1000)]
  const r = matchOriginals(photos, [{ name: 'IMG_1.jpg', size: 999999 }])
  assert.equal(r.matches[0].confidence, 'by-name')
})

test('an exact match wins the photo over a same-named re-encode', () => {
  const photos = [photo('a', 'IMG_1.jpg', 1000), photo('b', 'IMG_1.jpg', 2000)]
  const r = matchOriginals(photos, [
    { name: 'IMG_1.jpg', size: 2000 },
    { name: 'IMG_1.jpg', size: 12 },
  ])
  const exact = r.matches.find((m) => m.confidence === 'exact')!
  assert.equal(exact.photo.id, 'b')
  assert.equal(r.matches.find((m) => m.confidence === 'by-name')!.photo.id, 'a')
})

test('two files never claim the same photo', () => {
  const photos = [photo('a', 'IMG_1.jpg', 1000)]
  const r = matchOriginals(photos, [
    { name: 'IMG_1.jpg', size: 5 },
    { name: 'IMG_1.jpg', size: 6 },
  ])
  assert.equal(r.matches.length, 1)
  assert.equal(r.unmatched.length, 1)
})

test('files from another album are reported, not guessed at', () => {
  const r = matchOriginals([photo('a', 'IMG_1.jpg', 1000)], [{ name: 'DSC_9.jpg', size: 1000 }])
  assert.equal(r.matches.length, 0)
  assert.deepEqual(r.unmatched.map((f) => f.name), ['DSC_9.jpg'])
})
