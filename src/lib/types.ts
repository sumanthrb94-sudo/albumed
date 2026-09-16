import type { Ceremony, Language } from './aiContract'

export type PhotoStatus = 'pending' | 'approved' | 'rejected'
export type PhotoSource = 'photographer' | 'customer'
export type ProjectStatus = 'collecting' | 'review' | 'finalized'
export type Density = 'airy' | 'balanced' | 'dense'

export interface Photo {
  id: string
  projectId: string
  name: string
  source: PhotoSource
  status: PhotoStatus
  starred: boolean
  caption: string
  /** Reviewer's note, e.g. "eyes closed — please replace". */
  note: string
  width: number
  height: number
  /** Size of the photo as it came off the phone, before this plan compressed it. */
  sourceWidth?: number
  sourceHeight?: number
  /** Whether this copy is print-grade or the compressed free-tier one. */
  printGrade?: boolean
  /** Whether a before/after detail sample was kept for this photo. */
  hasSample?: boolean
  bytes: number
  addedAt: number
  takenAt?: number
  /** Sort order within the project. */
  order: number

  /* ---- filled in by the album assistant ---- */
  /** Which part of the celebration this belongs to. */
  ceremony?: Ceremony
  /** 0-100, how well it prints. */
  aiScore?: number
  aiIssues?: string[]
  /** Why the assistant kept or dropped it. */
  aiReason?: string
  /** Caption in the album's regional language. */
  captionNative?: string
  /** Main subject's position in the frame (0-1), used when cropping to a slot. */
  focusX?: number
  focusY?: number
}

export interface PageSizeSpec {
  id: string
  label: string
  /** Trim size in inches. */
  w: number
  h: number
}

export interface AlbumOptions {
  themeId: string
  pageSizeId: string
  density: Density
  includeCover: boolean
  includeClosing: boolean
  showCaptions: boolean
  showPageNumbers: boolean
  /** Print a divider page in front of each chapter. */
  includeChapterPages: boolean
  /** Photos the customer or the assistant asked to give a page of their own. */
  featuredPhotoIds: string[]
  /** Random seed so "regenerate" produces a different but reproducible album. */
  seed: number
}

/** A run of photos the assistant grouped under one heading. */
export interface AlbumChapter {
  id: string
  title: string
  titleNative: string
  blurb: string
  photoIds: string[]
}

export interface Project {
  id: string
  title: string
  /** "Priya & Arjun", "Baby Aarav", "The Sharma Family"… */
  hosts: string
  eventDate: string
  venue: string
  occasionNote: string
  status: ProjectStatus
  createdAt: number
  updatedAt: number
  finalizedAt?: number
  album: AlbumOptions
  coverPhotoId?: string
  /** Language for printed captions and chapter titles. */
  language: Language
  /** Running order authored by the assistant; empty means a plain chronological album. */
  chapters: AlbumChapter[]
  /** What the assistant said about its choices, shown once in the UI. */
  aiNotes?: string
  curatedAt?: number
}

export type SlotShape = 'rect' | 'round' | 'arch' | 'circle'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Slot extends Rect {
  photoId: string
  shape?: SlotShape
}

export type PageKind = 'cover' | 'chapter' | 'photos' | 'closing'

export interface AlbumPage {
  id: string
  kind: PageKind
  templateId: string
  slots: Slot[]
  /** Optional page heading, used on cover, chapter and closing pages. */
  heading?: string
  subheading?: string
  /** Small line under a chapter heading. */
  blurb?: string
  /** The chapter this page belongs to, when the album has chapters. */
  chapterId?: string
}

export interface Album {
  pages: AlbumPage[]
  generatedAt: number
}
