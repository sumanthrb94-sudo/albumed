/* The contract shared by the browser and the API server.
   Zod schemas here are the single source of truth: the server hands them to
   Claude as the structured-output format, and both sides validate against them. */
import { z } from 'zod'

/** Ceremonies an Indian wedding album is organised around.
 *  Telugu first — the studio's own tradition — then the rest of the country. */
export const CEREMONIES = [
  // Telugu (Andhra Pradesh & Telangana)
  'nischitartham', // betrothal
  'pellikuthuru', // turmeric ceremony for the bride
  'pellikoduku', // the same for the groom
  'snathakam',
  'kashi-yatra',
  'madhuparkam',
  'jeelakarra-bellam', // cumin and jaggery — the muhurtham moment
  'mangalsutra-dharana',
  'talambralu', // showering rice over each other
  'kanyadanam',
  'saptapadi',
  'appaginthalu', // giving the bride away
  'satyanarayana-vratam',
  // Tamil, Kannada, Malayalam
  'nischayathartham',
  'pandhakaal',
  'maalai-maatral', // garland exchange
  'oonjal', // swing ceremony
  'muhurtham',
  'nalangu',
  'sadhya', // feast
  // North, West and East India
  'mehendi',
  'haldi',
  'sangeet',
  'chooda', // Punjabi bangle ceremony
  'baraat',
  'varmala',
  'pheras',
  'anand-karaj', // Sikh wedding
  'hastamelap', // Gujarati joining of hands
  'antarpat', // Marathi curtain
  'gaye-holud', // Bengali turmeric
  'subho-drishti', // Bengali first look
  'sindoor-daan',
  'vidaai',
  // Everything else an album needs
  'reception',
  'grihapravesham',
  'mandap-decor',
  'family-portrait',
  'candid',
  'other',
] as const
export type Ceremony = (typeof CEREMONIES)[number]

export const CEREMONY_LABELS: Record<Ceremony, string> = {
  nischitartham: 'Nischitartham',
  pellikuthuru: 'Pellikuthuru',
  pellikoduku: 'Pellikoduku',
  snathakam: 'Snathakam',
  'kashi-yatra': 'Kashi Yatra',
  madhuparkam: 'Madhuparkam',
  'jeelakarra-bellam': 'Jeelakarra Bellam',
  'mangalsutra-dharana': 'Mangalsutra Dharana',
  talambralu: 'Talambralu',
  kanyadanam: 'Kanyadanam',
  saptapadi: 'Saptapadi',
  appaginthalu: 'Appaginthalu',
  'satyanarayana-vratam': 'Satyanarayana Vratam',
  nischayathartham: 'Nischayathartham',
  pandhakaal: 'Pandhakaal',
  'maalai-maatral': 'Maalai Maatral',
  oonjal: 'Oonjal',
  muhurtham: 'Muhurtham',
  nalangu: 'Nalangu',
  sadhya: 'Sadhya',
  mehendi: 'Mehendi',
  haldi: 'Haldi',
  sangeet: 'Sangeet',
  chooda: 'Chooda',
  baraat: 'Baraat',
  varmala: 'Varmala',
  pheras: 'Pheras',
  'anand-karaj': 'Anand Karaj',
  hastamelap: 'Hastamelap',
  antarpat: 'Antarpat',
  'gaye-holud': 'Gaye Holud',
  'subho-drishti': 'Subho Drishti',
  'sindoor-daan': 'Sindoor Daan',
  vidaai: 'Vidaai',
  reception: 'Reception',
  grihapravesham: 'Grihapravesham',
  'mandap-decor': 'Mandap & decor',
  'family-portrait': 'Family portraits',
  candid: 'Candid moments',
  other: 'Other',
}

export const PHOTO_ISSUES = [
  'blurry',
  'out-of-focus',
  'eyes-closed',
  'underexposed',
  'overexposed',
  'obstructed',
  'back-of-head',
  'near-duplicate',
  'cluttered-background',
] as const

export const LANGUAGES = [
  'telugu',
  'english',
  'tamil',
  'kannada',
  'malayalam',
  'hindi',
  'bengali',
  'marathi',
  'gujarati',
  'punjabi',
] as const
export type Language = (typeof LANGUAGES)[number]

export const LANGUAGE_LABELS: Record<Language, string> = {
  telugu: 'తెలుగు Telugu',
  english: 'English',
  tamil: 'தமிழ் Tamil',
  kannada: 'ಕನ್ನಡ Kannada',
  malayalam: 'മലയാളം Malayalam',
  hindi: 'हिन्दी Hindi',
  bengali: 'বাংলা Bengali',
  marathi: 'मराठी Marathi',
  gujarati: 'ગુજરાતી Gujarati',
  punjabi: 'ਪੰਜਾਬੀ Punjabi',
}

/* ---------------- curate ---------------- */

export const PhotoVerdictSchema = z.object({
  id: z.string().describe('The photo id exactly as given in the prompt'),
  ceremony: z.enum(CEREMONIES).describe('Which part of the celebration this photo belongs to'),
  score: z.number().min(0).max(100).describe('How strong this photo is for a printed album'),
  keep: z.boolean().describe('Whether this photo belongs in the album'),
  hero: z.boolean().describe('True for the few standout frames that deserve a full page or the cover'),
  issues: z.array(z.enum(PHOTO_ISSUES)).describe('Technical problems visible in the photo; empty if none'),
  caption: z.string().describe('A short printed caption, at most 8 words, no ending period'),
  caption_native: z
    .string()
    .describe('The same caption in the requested language and script; empty string when English was requested'),
  focus_x: z.number().min(0).max(1).describe('Horizontal centre of the main subject, 0 = left edge, 1 = right edge'),
  focus_y: z.number().min(0).max(1).describe('Vertical centre of the main subject, 0 = top edge, 1 = bottom edge'),
  reason: z.string().describe('One short sentence explaining the keep or drop decision'),
})
export type PhotoVerdict = z.infer<typeof PhotoVerdictSchema>

export const CurateResultSchema = z.object({
  verdicts: z.array(PhotoVerdictSchema),
})
export type CurateResult = z.infer<typeof CurateResultSchema>

/* ---------------- story ---------------- */

export const ChapterSchema = z.object({
  id: z.string().describe('Short kebab-case id, unique within the album'),
  title: z.string().describe('Chapter title in English'),
  title_native: z.string().describe('The chapter title in the requested language and script; empty when English'),
  blurb: z.string().describe('One line printed under the chapter title, at most 14 words'),
  photo_ids: z.array(z.string()).describe('Photo ids in this chapter, in the order they should appear'),
})
export type Chapter = z.infer<typeof ChapterSchema>

export const StorySchema = z.object({
  title: z.string().describe('Album cover title'),
  subtitle: z.string().describe('Cover subtitle, usually the couple or hosts'),
  theme_id: z.string().describe('The id of the album template that best suits these photos'),
  cover_photo_id: z.string().describe('Photo id for the cover'),
  chapters: z.array(ChapterSchema),
  closing_line: z.string().describe('Printed on the final page, at most 10 words'),
  closing_native: z.string().describe('A short thank-you in the requested language and script; empty when English'),
  notes: z.string().describe('One or two sentences to the customer about the choices made'),
})
export type Story = z.infer<typeof StorySchema>

/* ---------------- edit ops ---------------- */

export const EditOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set_theme'), theme_id: z.string() }),
  z.object({ op: z.literal('set_page_size'), page_size_id: z.string() }),
  z.object({ op: z.literal('set_density'), density: z.enum(['airy', 'balanced', 'dense']) }),
  z.object({
    op: z.literal('set_text'),
    title: z.string().optional(),
    hosts: z.string().optional(),
    event_date: z.string().optional(),
    venue: z.string().optional(),
  }),
  z.object({ op: z.literal('set_language'), language: z.enum(LANGUAGES) }),
  z.object({ op: z.literal('set_cover'), photo_id: z.string() }),
  z.object({ op: z.literal('feature_photos'), photo_ids: z.array(z.string()) }),
  z.object({ op: z.literal('unfeature_photos'), photo_ids: z.array(z.string()) }),
  z.object({ op: z.literal('drop_photos'), photo_ids: z.array(z.string()) }),
  z.object({ op: z.literal('restore_photos'), photo_ids: z.array(z.string()) }),
  z.object({
    op: z.literal('set_captions'),
    captions: z.array(z.object({ photo_id: z.string(), caption: z.string() })),
  }),
  z.object({ op: z.literal('reorder_chapters'), chapter_ids: z.array(z.string()) }),
  z.object({ op: z.literal('rename_chapter'), chapter_id: z.string(), title: z.string(), title_native: z.string() }),
  z.object({ op: z.literal('drop_chapter'), chapter_id: z.string() }),
  z.object({
    op: z.literal('toggle'),
    captions: z.boolean().optional(),
    page_numbers: z.boolean().optional(),
    cover: z.boolean().optional(),
    closing: z.boolean().optional(),
    chapter_pages: z.boolean().optional(),
  }),
  z.object({ op: z.literal('regenerate') }),
])
export type EditOp = z.infer<typeof EditOpSchema>

export const EditResultSchema = z.object({
  reply: z.string().describe('A short reply to the customer, at most 3 sentences'),
  ops: z.array(EditOpSchema).describe('The edits to apply, in order. Empty if the request needs no change.'),
})
export type EditResult = z.infer<typeof EditResultSchema>

/* ---------------- request payloads ---------------- */

export interface CuratePhotoInput {
  id: string
  name: string
  /** JPEG data URL of a small thumbnail. */
  dataUrl: string
}

export interface CurateRequest {
  photos: CuratePhotoInput[]
  occasion: string
  language: Language
  notes?: string
}

export interface StoryRequest {
  occasion: string
  language: Language
  hosts: string
  eventDate: string
  venue: string
  notes?: string
  themeIds: Array<{ id: string; name: string; occasion: string; blurb: string }>
  photos: Array<{ id: string; ceremony: Ceremony; score: number; hero: boolean; caption: string }>
}

export interface EditRequest {
  instruction: string
  language: Language
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  album: {
    title: string
    hosts: string
    eventDate: string
    venue: string
    themeId: string
    pageSizeId: string
    density: string
    showCaptions: boolean
    showPageNumbers: boolean
    includeCover: boolean
    includeClosing: boolean
    includeChapterPages: boolean
    coverPhotoId?: string
  }
  themeIds: Array<{ id: string; name: string; occasion: string; blurb: string }>
  pageSizeIds: Array<{ id: string; label: string }>
  chapters: Array<{ id: string; title: string; photoCount: number }>
  photos: Array<{
    id: string
    ceremony: Ceremony
    status: string
    starred: boolean
    caption: string
    score?: number
    issues?: string[]
  }>
}

export interface AiStatus {
  enabled: boolean
  model: string
  /** True when replies are scripted rather than from Claude. Always surfaced. */
  demo?: boolean
  reason?: string
}
