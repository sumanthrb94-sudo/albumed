/* Demo mode is what a presentation with no API key actually runs on, so its
   output has to survive being printed. These guard the faults a 25-photo album
   exposed: captions repeating word for word under two photos on one page,
   ceremonies keyed off a position inside a batch, and chapters being sliced
   away with their photographs still in them. */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { demoCurate, demoStory } from '../server/demoAi'
import type { CuratePhotoInput, CurateRequest, StoryRequest } from '../src/lib/aiContract'

const photo = (name: string, id = name): CuratePhotoInput => ({ id, name, dataUrl: '' })

const curate = (names: string[], language: CurateRequest['language'] = 'telugu') =>
  demoCurate({ photos: names.map((n) => photo(n)), occasion: 'A Telugu wedding', language })

test('the ceremony comes from the photo, not its place in a batch', () => {
  // The client sends photos in batches of six; the same frame must be read the
  // same way whether it lands first in a batch or last.
  const first = curate(['07-appaginthalu.jpg']).verdicts[0]
  const last = curate(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg', '07-appaginthalu.jpg']).verdicts[5]
  assert.equal(first.ceremony, 'appaginthalu')
  assert.equal(last.ceremony, 'appaginthalu')
})

test('two frames of one ceremony do not print the same caption', () => {
  const { verdicts } = curate(['03-talambralu.jpg', '13-talambralu-alt.jpg'])
  assert.equal(verdicts[0].ceremony, 'talambralu')
  assert.equal(verdicts[1].ceremony, 'talambralu')
  assert.notEqual(verdicts[0].caption, verdicts[1].caption)
})

test('the frames a studio would bin are always dropped, with the right reason', () => {
  const { verdicts } = curate(['23-blurry-dance.jpg', '24-eyes-closed.jpg', '25-obstructed.jpg'])
  assert.deepEqual(
    verdicts.map((v) => [v.keep, v.issues[0]]),
    [
      [false, 'blurry'],
      [false, 'eyes-closed'],
      [false, 'obstructed'],
    ],
  )
})

test('a good frame is never tagged with a fault it does not have', () => {
  for (const v of curate(['11-muhurtham-thaali.jpg', '01-pellikuthuru.jpg']).verdicts) {
    assert.equal(v.keep, true)
    assert.deepEqual(v.issues, [])
  }
})

test('the kept photos do not all carry the same one-line reason', () => {
  const names = ['01-pellikuthuru', '03-talambralu', '04-snathakam', '05-kashi-yatra', '06-kanyadanam', '10-reception']
  const reasons = curate(names.map((n) => `${n}.jpg`)).verdicts.filter((v) => v.keep).map((v) => v.reason)
  assert.ok(reasons.length >= 4, 'expected most of these to be kept')
  assert.ok(new Set(reasons).size > 1, 'every verdict read identically — that looks like a template, not a review')
})

test('the same photo curates the same way twice', () => {
  assert.deepEqual(curate(['05-kashi-yatra.jpg']), curate(['05-kashi-yatra.jpg']))
})

test('english asks for no native caption, telugu asks for one', () => {
  assert.equal(curate(['01-pellikuthuru.jpg'], 'english').verdicts[0].caption_native, '')
  assert.ok(curate(['01-pellikuthuru.jpg'], 'telugu').verdicts[0].caption_native.length > 0)
})

test('folding chapters never loses a photograph', () => {
  // The whole 25-photo sample take, which spans far more ceremonies than an
  // album should have chapters.
  const names = [
    '01-pellikuthuru', '02-jeelakarra-bellam', '03-talambralu', '04-snathakam', '05-kashi-yatra',
    '06-kanyadanam', '07-appaginthalu', '08-family-portrait', '09-mandapam', '10-reception',
    '11-muhurtham-thaali', '12-muhurtham-thaali-alt', '13-talambralu-alt', '14-mehendi-hands',
    '15-pellikoduku', '16-baraat', '17-sannai-melam', '18-elders-blessing', '19-couple-portrait',
    '20-couple-candid', '21-jewellery-detail', '22-sadhya',
  ].map((n) => `${n}.jpg`)

  const kept = curate(names).verdicts.filter((v) => v.keep)
  const req: StoryRequest = {
    occasion: 'A Telugu wedding',
    language: 'telugu',
    hosts: 'Sireesha & Karthik',
    eventDate: '14 February 2026',
    venue: 'Kalyana Mandapam, Rajahmundry',
    photos: kept.map((v) => ({ id: v.id, ceremony: v.ceremony, score: v.score, hero: v.hero, caption: v.caption })),
  }
  const story = demoStory(req)

  const placed = story.chapters.flatMap((c) => c.photo_ids)
  assert.equal(new Set(placed).size, placed.length, 'a photo was placed in two chapters')
  assert.deepEqual(new Set(placed), new Set(kept.map((v) => v.id)), 'a chapter was dropped with photos in it')
  assert.ok(story.chapters.length <= 7, `${story.chapters.length} chapters is an index, not an album`)
  assert.ok(story.chapters.length >= 3, 'the day should read as more than one chapter')
})

test('every chapter the demo can produce has a real title, in script', () => {
  const names = ['15-pellikoduku', '16-baraat', '14-mehendi-hands', '22-sadhya', '19-couple-portrait']
  const kept = curate(names.map((n) => `${n}.jpg`)).verdicts.filter((v) => v.keep)
  const story = demoStory({
    occasion: 'A Telugu wedding',
    language: 'telugu',
    hosts: 'Sireesha & Karthik',
    eventDate: '14 February 2026',
    venue: 'Rajahmundry',
    photos: kept.map((v) => ({ id: v.id, ceremony: v.ceremony, score: v.score, hero: v.hero, caption: v.caption })),
  })
  for (const c of story.chapters) {
    assert.ok(c.title && !c.title.includes('-'), `chapter title looks like a slug: ${c.title}`)
    assert.ok(c.title_native.length > 0, `${c.title} lost its Telugu title`)
  }
})
