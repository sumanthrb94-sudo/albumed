/* Demo mode.

   A presentation should not depend on a venue's wifi, an API key being funded,
   or a rate limit. With ALBUMED_DEMO_AI=1 and no key configured, the three AI
   passes return scripted results shaped exactly like the real ones — derived
   from the actual request, so the photo ids, counts and chapters are real.

   Every response says demo: true, and the UI labels it. Scripted output must
   never be able to pass as live AI. */
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

/** The running order of a Telugu wedding, which is what the demo album is. */
const RUNNING_ORDER = [
  { ceremony: 'pellikuthuru', caption: 'Turmeric and laughter before the day', native: 'పెళ్లికూతురు' },
  { ceremony: 'snathakam', caption: 'The groom, halfway to a new life', native: 'స్నాతకం' },
  { ceremony: 'kashi-yatra', caption: 'Talked out of leaving for Kashi', native: 'కాశీ యాత్ర' },
  { ceremony: 'madhuparkam', caption: 'White silk and gold, both families watching', native: 'మధుపర్కం' },
  { ceremony: 'jeelakarra-bellam', caption: 'Cumin and jaggery, at the exact moment', native: 'జీలకర్ర బెల్లం' },
  { ceremony: 'mangalsutra-dharana', caption: 'Three knots, and the sannai rises', native: 'మంగళసూత్ర ధారణ' },
  { ceremony: 'talambralu', caption: 'Rice everywhere, nobody minding', native: 'తలంబ్రాలు' },
  { ceremony: 'kanyadanam', caption: "Her father's hands over theirs", native: 'కన్యాదానం' },
  { ceremony: 'appaginthalu', caption: 'The hardest few minutes of the day', native: 'అప్పగింతలు' },
  { ceremony: 'mandap-decor', caption: 'Banana stems, marigolds, morning light', native: 'మండపం' },
  { ceremony: 'reception', caption: 'On stage, finally able to breathe', native: 'రిసెప్షన్' },
  { ceremony: 'family-portrait', caption: 'Everyone, in one frame, once', native: 'కుటుంబం' },
] as const

const DROP_REASONS = [
  'Softer copy of a better frame in the same set.',
  'The moment is there but the priest blocks the couple.',
  'Eyes closed on the bride — the next frame is the one.',
]

export function demoCurate(req: CurateRequest): CurateResult {
  const wantsNative = req.language !== 'english'
  return {
    verdicts: req.photos.map((p, i) => {
      const r = hash(p.id)
      const slot = RUNNING_ORDER[i % RUNNING_ORDER.length]
      // Drop roughly one in six, the way a real cull goes.
      const keep = r > 0.17
      return {
        id: p.id,
        ceremony: slot.ceremony,
        score: keep ? Math.round(58 + r * 40) : Math.round(22 + r * 25),
        keep,
        hero: keep && r > 0.86,
        issues: keep ? [] : ([r > 0.5 ? 'blurry' : 'eyes-closed'] as CurateResult['verdicts'][number]['issues']),
        caption: slot.caption,
        caption_native: wantsNative ? slot.native : '',
        focus_x: 0.42 + r * 0.16,
        focus_y: 0.34 + r * 0.14,
        reason: keep
          ? 'Sharp, both families in frame, the moment is readable.'
          : DROP_REASONS[Math.floor(r * DROP_REASONS.length)],
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

  const hero = req.photos.find((p) => p.hero) ?? req.photos[0]
  return {
    title: req.hosts ? 'Maa Pelli' : 'Our Wedding',
    subtitle: req.hosts || 'The couple',
    theme_id: 'godavari',
    cover_photo_id: hero?.id ?? '',
    chapters: chapters.slice(0, 6),
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
