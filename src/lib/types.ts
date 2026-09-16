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
  bytes: number
  addedAt: number
  takenAt?: number
  /** Sort order within the project. */
  order: number
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
  /** Random seed so "regenerate" produces a different but reproducible album. */
  seed: number
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

export type PageKind = 'cover' | 'photos' | 'closing'

export interface AlbumPage {
  id: string
  kind: PageKind
  templateId: string
  slots: Slot[]
  /** Optional page heading, used on cover and closing pages. */
  heading?: string
  subheading?: string
}

export interface Album {
  pages: AlbumPage[]
  generatedAt: number
}
