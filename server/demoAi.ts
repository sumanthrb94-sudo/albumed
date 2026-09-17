/* Demo mode.

   A presentation should not depend on a venue's wifi, an API key being funded,
   or a rate limit. With ALBUMED_DEMO_AI=1 and no key configured, the three AI
   passes return scripted results shaped exactly like the real ones — derived
   from the actual request, so the photo ids, counts and chapters are real.

   Every response says demo: true, and the UI labels it. Scripted output must
   never be able to pass as live AI. */
import type { PHOTO_ISSUES } from '../src/lib/aiContract.js'
import type {
  CurateRequest,
  CurateResult,
  EditRequest,
  EditResult,
  Story,
  StoryRequest,
} from '../src/lib/aiContract.js'

/* On by default when no API key is configured: a deployment with no key is
   almost always someone trying the product, and a dead assistant shows them
   nothing. Set ALBUMED_DEMO_AI=0 to switch the assistant off entirely instead.
   A real key always takes precedence — see handlers.health(). */
export const demoMode = (): boolean => process.env.ALBUMED_DEMO_AI !== '0'

/** Deterministic, so the same album demos the same way twice. */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967296
}

/** The running order of a Telugu wedding, which is what the demo album is.
    Two captions per ceremony: a wedding has several frames of the same moment,
    and printing the identical line under both reads as a bug. */
const RUNNING_ORDER = [
  { ceremony: 'pellikuthuru', captions: ['Turmeric and laughter before the day', 'Held still, just about'], native: 'పెళ్లికూతురు' },
  { ceremony: 'pellikoduku', captions: ['The groom gets his turn', 'Turmeric, and no escape'], native: 'పెళ్లికొడుకు' },
  { ceremony: 'snathakam', captions: ['The groom, halfway to a new life', 'Thread, staff and a straight face'], native: 'స్నాతకం' },
  { ceremony: 'kashi-yatra', captions: ['Talked out of leaving for Kashi', 'The umbrella never made it far'], native: 'కాశీ యాత్ర' },
  { ceremony: 'baraat', captions: ['The street belongs to them', 'Drums the whole way down'], native: 'బరాత్' },
  { ceremony: 'madhuparkam', captions: ['White silk and gold, both families watching', 'The first look, formally'], native: 'మధుపర్కం' },
  { ceremony: 'jeelakarra-bellam', captions: ['Cumin and jaggery, at the exact moment', 'Hands held over her head'], native: 'జీలకర్ర బెల్లం' },
  { ceremony: 'mangalsutra-dharana', captions: ['Three knots, and the sannai rises', 'The thaali, and the room goes quiet'], native: 'మంగళసూత్ర ధారణ' },
  { ceremony: 'talambralu', captions: ['Rice everywhere, nobody minding', 'She is winning this one'], native: 'తలంబ్రాలు' },
  { ceremony: 'kanyadanam', captions: ["Her father's hands over theirs", 'Given away, and holding on'], native: 'కన్యాదానం' },
  { ceremony: 'appaginthalu', captions: ['The hardest few minutes of the day', 'Nobody is pretending now'], native: 'అప్పగింతలు' },
  { ceremony: 'mandap-decor', captions: ['Banana stems, marigolds, morning light', 'Nadaswaram, before anyone arrives'], native: 'మండపం' },
  { ceremony: 'family-portrait', captions: ['Everyone, in one frame, once', 'Four generations, standing still'], native: 'కుటుంబం' },
  { ceremony: 'mehendi', captions: ['Green paste, dark stain, hours of it', 'Her hands, finished'], native: 'మెహందీ' },
  { ceremony: 'sangeet', captions: ['The cousins had rehearsed', 'Nobody sat down for this one'], native: 'సంగీత్' },
  { ceremony: 'sadhya', captions: ['Banana leaf, and no cutlery', 'Second helpings, already'], native: 'విందు' },
  { ceremony: 'candid', captions: ['Between the ceremonies', 'Caught not posing'], native: 'సందడి' },
  { ceremony: 'reception', captions: ['On stage, finally able to breathe', 'The last of the queue'], native: 'రిసెప్షన్' },
] as const

/** Demo mode cannot see the photograph, so it reads the filename — which is how
    a scripted stand-in stays honest. An unrecognised name falls back to the
    running order, keyed off the photo id so it is stable across batches. */
const NAME_HINTS: Array<[RegExp, string]> = [
  [/pellikoduku/, 'pellikoduku'],
  [/pellikuthuru/, 'pellikuthuru'],
  [/snathakam/, 'snathakam'],
  [/kashi/, 'kashi-yatra'],
  [/baraat/, 'baraat'],
  [/madhuparkam/, 'madhuparkam'],
  [/jeelakarra/, 'jeelakarra-bellam'],
  [/thaali|mangalsutra|muhurtham/, 'mangalsutra-dharana'],
  [/talambralu/, 'talambralu'],
  [/kanyadanam/, 'kanyadanam'],
  [/appaginthalu|vidaai/, 'appaginthalu'],
  [/mandapam|mandap|sannai|melam/, 'mandap-decor'],
  [/family|elders|blessing/, 'family-portrait'],
  [/mehendi|henna/, 'mehendi'],
  [/sangeet|dance/, 'sangeet'],
  [/sadhya|feast|bhojan/, 'sadhya'],
  [/reception/, 'reception'],
  [/couple|portrait|candid|detail|jewell/, 'candid'],
]

/** The frames a studio would bin, named so the cull has something real to find. */
const BAD_FRAMES: Array<[RegExp, (typeof PHOTO_ISSUES)[number], string]> = [
  [/blurry|motion/, 'blurry', 'Motion blur across the whole frame — nothing to recover.'],
  [/eyes-closed|blink/, 'eyes-closed', 'Half the group is mid-blink. The next frame is the one.'],
  [/obstructed|blocked/, 'obstructed', "A guest's phone is across the lens at the moment it mattered."],
]

/* One reason repeated down the whole panel reads as a template, which is the
   one thing a reasoning panel must not look like. */
const KEEP_REASONS = [
  'Sharp, both families in frame, the moment is readable.',
  'The expressions carry it — nobody is looking at the camera.',
  'Clean light, and the ritual is legible at a glance.',
  'Best of the set: focus on the faces that matter.',
  'Holds the whole scene without losing the couple.',
  'The hands tell the story here, and they are sharp.',
]

const DROP_REASONS = [
  'Softer copy of a better frame in the same set.',
  'The moment is there but the priest blocks the couple.',
  'Eyes closed on the bride — the next frame is the one.',
]

export function demoCurate(req: CurateRequest): CurateResult {
  const wantsNative = req.language !== 'english'
  return {
    verdicts: req.photos.map((p) => {
      const r = hash(p.id)
      const name = (p.name ?? '').toLowerCase()
      const hinted = NAME_HINTS.find(([re]) => re.test(name))?.[1]
      const slot =
        RUNNING_ORDER.find((o) => o.ceremony === hinted) ??
        RUNNING_ORDER[Math.floor(r * RUNNING_ORDER.length)]
      const bad = BAD_FRAMES.find(([re]) => re.test(name))
      // A named bad frame always goes; otherwise drop roughly one in six, the
      // way a real cull goes.
      const keep = bad ? false : r > 0.17
      return {
        id: p.id,
        ceremony: slot.ceremony,
        score: keep ? Math.round(58 + r * 40) : Math.round(22 + r * 25),
        keep,
        hero: keep && r > 0.86,
        issues: keep ? [] : ([bad ? bad[1] : r > 0.5 ? 'blurry' : 'eyes-closed'] as CurateResult['verdicts'][number]['issues']),
        // Two frames of the same ceremony must not print the same line.
        caption: slot.captions[Math.floor(r * slot.captions.length)],
        caption_native: wantsNative ? slot.native : '',
        focus_x: 0.42 + r * 0.16,
        focus_y: 0.34 + r * 0.14,
        reason: keep
          ? KEEP_REASONS[Math.floor(r * KEEP_REASONS.length)]
          : (bad?.[2] ?? DROP_REASONS[Math.floor(r * DROP_REASONS.length)]),
      }
    }),
  }
}

const CHAPTER_TITLES: Record<string, { title: string; native: string; blurb: string }> = {
  pellikuthuru: { title: 'Pellikuthuru', native: 'పెళ్లికూతురు', blurb: 'Turmeric, silk and the morning before' },
  snathakam: { title: 'Snathakam & Kashi Yatra', native: 'స్నాతకం', blurb: 'The groom is talked out of leaving' },
  'kashi-yatra': { title: 'Kashi Yatra', native: 'కాశీ యాత్ర', blurb: 'An umbrella, a stick, and a change of mind' },
  madhuparkam: { title: 'Madhuparkam', native: 'మధుపర్కం', blurb: 'White silk, gold, and both families watching' },
  'jeelakarra-bellam': { title: 'Muhurtham', native: 'ముహూర్తం', blurb: 'Cumin, jaggery and the three knots' },
  'mangalsutra-dharana': { title: 'Mangalsutra Dharana', native: 'మంగళసూత్ర ధారణ', blurb: 'The moment the sannai rises' },
  talambralu: { title: 'Talambralu', native: 'తలంబ్రాలు', blurb: 'Rice, and nobody minding at all' },
  kanyadanam: { title: 'Kanyadanam', native: 'కన్యాదానం', blurb: 'Her father gives her hands away' },
  appaginthalu: { title: 'Appaginthalu', native: 'అప్పగింతలు', blurb: 'The hardest few minutes of the day' },
  'mandap-decor': { title: 'The Mandapam', native: 'మండపం', blurb: 'Banana stems, marigolds, morning light' },
  pellikoduku: { title: 'Pellikoduku', native: 'పెళ్లికొడుకు', blurb: 'The groom gets his turn with the turmeric' },
  baraat: { title: 'The Baraat', native: 'బరాత్', blurb: 'Drums, and the street belongs to them' },
  mehendi: { title: 'Mehendi', native: 'మెహందీ', blurb: 'Green paste, dark stain, hours of it' },
  sangeet: { title: 'Sangeet', native: 'సంగీత్', blurb: 'The cousins had rehearsed' },
  sadhya: { title: 'The Feast', native: 'విందు', blurb: 'Banana leaf, and no cutlery' },
  candid: { title: 'In Between', native: 'సందడి', blurb: 'The day when nobody was posing' },
  reception: { title: 'Reception', native: 'రిసెప్షన్', blurb: 'On stage, finally able to breathe' },
  'family-portrait': { title: 'Everyone', native: 'కుటుంబం', blurb: 'One frame, one time, the whole family' },
}

export function demoStory(req: StoryRequest): Story {
  const groups = new Map<string, string[]>()
  for (const p of req.photos) {
    const list = groups.get(p.ceremony) ?? []
    list.push(p.id)
    groups.set(p.ceremony, list)
  }

  // Keep the day in order, and fold anything too thin into its neighbour.
  const ordered = RUNNING_ORDER.map((s) => s.ceremony).filter((c) => groups.has(c))
  for (const c of groups.keys()) if (!ordered.includes(c as never)) ordered.push(c as never)

  const chapters: Story['chapters'] = []
  for (const ceremony of ordered) {
    const ids = groups.get(ceremony) ?? []
    const meta = CHAPTER_TITLES[ceremony] ?? {
      title: ceremony.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()),
      native: '',
      blurb: 'From the day',
    }
    if (ids.length < 2 && chapters.length) {
      chapters[chapters.length - 1].photo_ids.push(...ids)
      continue
    }
    chapters.push({
      id: ceremony,
      title: meta.title,
      title_native: req.language === 'english' ? '' : meta.native,
      blurb: meta.blurb,
      photo_ids: ids,
    })
  }

  // Too many chapters means a divider page every other spread. Fold the
  // thinnest into a neighbour until it reads as an album rather than an index —
  // merging, never slicing, because a dropped chapter is dropped photographs.
  const MAX_CHAPTERS = 7
  while (chapters.length > MAX_CHAPTERS) {
    let thinnest = 0
    for (let i = 1; i < chapters.length; i++) {
      if (chapters[i].photo_ids.length < chapters[thinnest].photo_ids.length) thinnest = i
    }
    const into = thinnest === 0 ? 1 : thinnest - 1
    chapters[into].photo_ids.push(...chapters[thinnest].photo_ids)
    chapters.splice(thinnest, 1)
  }

  const hero = req.photos.find((p) => p.hero) ?? req.photos[0]
  return {
    title: req.hosts ? 'Maa Pelli' : 'Our Wedding',
    subtitle: req.hosts || 'The couple',
    theme_id: 'godavari',
    cover_photo_id: hero?.id ?? '',
    chapters,
    closing_line: 'With the blessings of both our families',
    closing_native: req.language === 'english' ? '' : 'ధన్యవాదాలు',
    notes: 'Built around the muhurtham, with the reception at the end. (Demo mode — scripted, not live AI.)',
  }
}

/** Matches an instruction to an edit the way the real assistant would, but by rule. */
export function demoEdit(req: EditRequest): EditResult {
  const ask = req.instruction.toLowerCase()
  const has = (...words: string[]) => words.some((w) => ask.includes(w))
  const approved = req.photos.filter((p) => p.status === 'approved').map((p) => p.id)
  const themeIds = new Set(req.themeIds.map((t) => t.id))
  const pick = (id: string, fallback = req.album.themeId) => (themeIds.has(id) ? id : fallback)

  const themeAsk: Array<[string[], string, string]> = [
    [['kerala', 'kasavu', 'malayal'], 'kasavu', 'Kerala Kasavu — off-white cloth with a woven gold border'],
    [['tamil', 'kanjeevaram', 'muhurtham album'], 'kanjeevaram', 'Kanjeevaram Muhurtham'],
    [['bengali', 'kolkata', 'lal paar'], 'bengali-lal', 'Lal Paar, the red and white of a Bengali wedding'],
    [['marathi', 'paithani', 'maharashtra'], 'paithani', 'Paithani Peacock'],
    [['punjabi', 'phulkari', 'sikh', 'anand karaj'], 'phulkari', 'Phulkari'],
    [['gujarati', 'bandhani', 'garba'], 'bandhani', 'Bandhani'],
    [['kannada', 'mysore'], 'mysore-silk', 'Mysore Silk'],
    [['telugu', 'godavari', 'rajahmundry'], 'godavari', 'Godavari Pellikuthuru'],
    [['reception', 'stage'], 'stage-reception', 'Stage Reception'],
    [['simple', 'minimal', 'plain', 'clean'], 'reception-ivory', 'Ivory Minimal'],
  ]
  // A region or mood word alone is not a request to restyle the album — "a haiku
  // about the Godavari" is about captions. Require the intent as well.
  const wantsRestyle = has('look like', 'make it', 'change the', 'switch', 'style', 'template', 'theme', 'turn it')
  for (const [words, id, label] of themeAsk) {
    if (wantsRestyle && has(...words)) {
      return {
        reply: `Switched to ${label}, and laid the pages out again.`,
        ops: [{ op: 'set_theme', theme_id: pick(id) }, { op: 'regenerate' }],
      }
    }
  }

  if (has('full page', 'own page', 'feature', 'bigger', 'larger')) {
    const ids = approved.slice(0, 2)
    return ids.length
      ? { reply: 'Given those a page of their own.', ops: [{ op: 'feature_photos', photo_ids: ids }] }
      : { reply: 'There are no photos in the album to feature yet.', ops: [] }
  }
  if (has('blurry', 'eyes closed', 'remove', 'drop', 'take out')) {
    const weak = req.photos
      .filter((p) => p.status === 'approved' && ((p.score ?? 100) < 55 || (p.issues?.length ?? 0) > 0))
      .map((p) => p.id)
    return weak.length
      ? { reply: `Taken ${weak.length} weaker frames out of the album.`, ops: [{ op: 'drop_photos', photo_ids: weak }] }
      : { reply: 'Nothing in the album is flagged as weak right now.', ops: [] }
  }
  if (has('reception at the end', 'reception last', 'move reception')) {
    const ids = req.chapters.map((c) => c.id)
    const reordered = [...ids.filter((c) => c !== 'reception'), ...ids.filter((c) => c === 'reception')]
    return reordered.length
      ? { reply: 'Reception is the last chapter now.', ops: [{ op: 'reorder_chapters', chapter_ids: reordered }] }
      : { reply: 'This album has no chapters yet — ask the assistant to plan it first.', ops: [] }
  }
  if (has('telugu')) return { reply: 'Captions will print in Telugu under the English line.', ops: [{ op: 'set_language', language: 'telugu' }] }
  if (has('tamil')) return { reply: 'Captions will print in Tamil under the English line.', ops: [{ op: 'set_language', language: 'tamil' }] }
  if (has('hindi')) return { reply: 'Captions will print in Hindi under the English line.', ops: [{ op: 'set_language', language: 'hindi' }] }
  if (has('white space', 'fewer photos', 'airy', 'breathe', 'spacious')) {
    return { reply: 'Fewer photos per page, more room around them.', ops: [{ op: 'set_density', density: 'airy' }, { op: 'regenerate' }] }
  }
  if (has('more photos', 'dense', 'story', 'pack')) {
    return { reply: 'Packed the pages tighter.', ops: [{ op: 'set_density', density: 'dense' }, { op: 'regenerate' }] }
  }
  if (has('caption') && has('off', 'remove', 'without', 'hide')) {
    return { reply: 'Captions are off.', ops: [{ op: 'toggle', captions: false }] }
  }
  if (has('shuffle', 'again', 'different', 'rearrange', 'redo')) {
    return { reply: 'Laid every page out again.', ops: [{ op: 'regenerate' }] }
  }

  return {
    reply:
      'This is demo mode, so I only follow a scripted set of requests — try a region or mood ' +
      '("make it a Kerala album", "simpler"), a language, giving a photo its own page, dropping the ' +
      'weak frames, moving the reception to the end, or more white space. With an API key set, the ' +
      'real assistant handles anything you ask.',
    ops: [],
  }
}
