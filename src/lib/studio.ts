/* The studio side: a photographer addresses a take to a customer's mobile
   number, and the customer finds it waiting when they sign in with that number.

   There is no backend here. In production a delivery is a row on a server with
   the photos in object storage, and the phone number is the address. In this
   demo it is a record in the same IndexedDB, so both sides can be shown on one
   device — sign in as the studio, send, sign out, sign in as the couple. The
   shape of the thing is identical either way; only the transport differs, which
   is why `sendDelivery` and `deliveriesFor` are the only two functions a real
   backend would replace. */
import * as db from './db'
import { uid } from './id'
import { normalisePhone } from './auth'
import { prepareUpload } from './images'
import { DEFAULT_THEME_ID } from './themes'
import type { PlanLimits } from './plan'
import type { Delivery, DeliveryPhoto, Photo, Project } from './types'
import type { Language } from './aiContract'

export interface SendOptions {
  toPhones: string[]
  studioName: string
  studioPhone: string
  message: string
}

export interface SendResult {
  delivery: Delivery
  /** Numbers that were not ten digit Indian mobiles and so were not sent to. */
  rejected: string[]
}

/* The address book is kept pure and separate from storage: everything below
   takes a list, so the rules can be tested without a browser. */

/** Sort a typed-in list of numbers into ones we can send to and ones we cannot.
 *  Blank lines are neither — people leave a spare row open. */
export function splitRecipients(raw: string[]): { accepted: string[]; rejected: string[] } {
  const accepted: string[] = []
  const rejected: string[] = []
  for (const entry of raw) {
    const n = normalisePhone(entry)
    if (/^[6-9]\d{9}$/.test(n)) {
      if (!accepted.includes(n)) accepted.push(n)
    } else if (entry.trim()) {
      rejected.push(entry.trim())
    }
  }
  return { accepted, rejected }
}

const newestFirst = (a: Delivery, b: Delivery) => b.sentAt - a.sentAt

/** Everything in this list addressed to this number. */
export function addressedTo(all: Delivery[], phoneInput: string): Delivery[] {
  const phone = normalisePhone(phoneInput)
  return all.filter((d) => d.toPhones.includes(phone)).sort(newestFirst)
}

/** The ones addressed to this number that it has not opened yet. */
export function notYetOpened(all: Delivery[], phoneInput: string): Delivery[] {
  const phone = normalisePhone(phoneInput)
  return addressedTo(all, phone).filter((d) => !d.openedBy[phone])
}

/** The ones this studio sent. */
export function sentByStudio(all: Delivery[], phoneInput: string): Delivery[] {
  const phone = normalisePhone(phoneInput)
  return all.filter((d) => normalisePhone(d.studioPhone) === phone).sort(newestFirst)
}

/** Snapshot a studio's project and address it to one or more mobile numbers. */
export async function sendDelivery(project: Project, opts: SendOptions): Promise<SendResult> {
  const { accepted: toPhones, rejected } = splitRecipients(opts.toPhones)
  if (!toPhones.length) throw new Error('Add at least one valid mobile number.')

  const photos = await db.getPhotos(project.id)
  if (!photos.length) throw new Error('There are no photos in this event yet.')

  const out: DeliveryPhoto[] = []
  for (const p of photos) {
    const rec = await db.getBlobs(p.id)
    if (!rec) continue
    // The customer starts from a clean slate: the studio's own keep/drop marks
    // and the assistant's verdicts are the studio's working notes, not theirs.
    const { projectId: _projectId, ...meta } = p
    out.push({
      meta: { ...meta, status: 'pending', starred: false, note: '' },
      full: rec.full,
      thumb: rec.thumb,
    })
  }
  if (!out.length) throw new Error('The photos in this event have no image data.')

  const delivery: Delivery = {
    id: uid('dlv_'),
    toPhones,
    studioName: opts.studioName.trim() || 'Your photographer',
    studioPhone: normalisePhone(opts.studioPhone),
    message: opts.message.trim(),
    sentAt: Date.now(),
    openedBy: {},
    event: {
      title: project.title,
      hosts: project.hosts,
      eventDate: project.eventDate,
      venue: project.venue,
      occasionNote: project.occasionNote,
      language: project.language,
      themeId: project.album.themeId,
    },
    photos: out,
  }
  await db.putDelivery(delivery)
  return { delivery, rejected }
}

/** Everything addressed to this number, newest first. */
export const deliveriesFor = async (phone: string) => addressedTo(await db.getDeliveries(), phone)

/** The ones this number has not opened yet. */
export const pendingFor = async (phone: string) => notYetOpened(await db.getDeliveries(), phone)

/** What a studio has sent, newest first. */
export const sentBy = async (phone: string) => sentByStudio(await db.getDeliveries(), phone)

const defaultAlbumOptions = (themeId: string) => ({
  themeId: themeId || DEFAULT_THEME_ID,
  pageSizeId: 'sq8',
  density: 'balanced' as const,
  includeCover: true,
  includeClosing: true,
  includeChapterPages: true,
  showCaptions: true,
  showPageNumbers: true,
  featuredPhotoIds: [],
  seed: Math.floor(Math.random() * 100000),
})

export interface OpenOptions {
  /** The customer's plan. A studio sends print-grade files; what gets kept on
   *  this device is whatever the customer is paying for. */
  limits: PlanLimits
  onProgress?: (done: number, total: number, name: string) => void
}

export interface OpenResult {
  project: Project
  /** Photos that did not fit under this plan's per-album cap. */
  overflow: number
  /** True when this delivery had already been opened on this number. */
  reopened: boolean
}

/** Open a delivery as a project of the customer's own, photos already in it.
 *  Opening twice returns the project made the first time rather than a copy. */
export async function openDelivery(deliveryId: string, phoneInput: string, opts: OpenOptions): Promise<OpenResult> {
  const phone = normalisePhone(phoneInput)
  const delivery = await db.getDelivery(deliveryId)
  if (!delivery) throw new Error('That delivery is no longer here.')
  if (!delivery.toPhones.includes(phone)) throw new Error('That delivery was sent to a different number.')

  const already = delivery.openedBy[phone]
  if (already) {
    const existing = await db.getProject(already)
    if (existing) return { project: existing, overflow: 0, reopened: true }
  }

  const now = Date.now()
  const project: Project = {
    id: uid('prj_'),
    ownerPhone: phone,
    title: delivery.event.title || 'Our Album',
    hosts: delivery.event.hosts,
    eventDate: delivery.event.eventDate,
    venue: delivery.event.venue,
    occasionNote: delivery.event.occasionNote,
    // The photos are already here, so the customer starts at the selection
    // rather than an empty uploader.
    status: 'review',
    createdAt: now,
    updatedAt: now,
    album: defaultAlbumOptions(delivery.event.themeId),
    language: delivery.event.language as Language,
    chapters: [],
  }
  await db.putProject(project)

  const room = Math.max(0, opts.limits.maxPhotosPerAlbum)
  const accepted = delivery.photos.slice(0, room)
  for (let i = 0; i < accepted.length; i++) {
    const dp = accepted[i]
    opts.onProgress?.(i, accepted.length, dp.meta.name)
    const id = uid('ph_')
    // Re-encoded at this plan's quality, which is the whole freemium argument:
    // the studio sent the real thing and a free album keeps a smaller copy.
    const prepared = await prepareUpload(dp.full, {
      maxPx: opts.limits.ingestMaxPx,
      quality: opts.limits.ingestQuality,
      withSample: !opts.limits.printGrade && i < 6,
    })
    const photo: Photo = {
      ...dp.meta,
      id,
      projectId: project.id,
      order: i,
      source: 'photographer',
      width: prepared.width,
      height: prepared.height,
      sourceWidth: prepared.sourceWidth,
      sourceHeight: prepared.sourceHeight,
      printGrade: opts.limits.printGrade,
      hasSample: Boolean(prepared.sampleReal),
      addedAt: now,
    }
    await db.putPhoto(photo)
    await db.putBlobs({
      photoId: id,
      full: prepared.full,
      thumb: prepared.thumb,
      sampleReal: prepared.sampleReal,
      sampleStored: prepared.sampleStored,
    })
  }
  opts.onProgress?.(accepted.length, accepted.length, '')

  await db.putDelivery({ ...delivery, openedBy: { ...delivery.openedBy, [phone]: project.id } })
  return { project, overflow: delivery.photos.length - accepted.length, reopened: false }
}

/* ---------------- the demo's own studio ---------------- */

export const DEMO_STUDIO = {
  name: 'Raju Photo Studio',
  city: 'Rajahmundry',
  phone: '9848012345',
} as const

/** Puts a wedding take in a number's inbox, so signing in for the first time
 *  looks like what it will look like in use: the photographer has already sent
 *  your photos. Labelled in the UI as a demo delivery — nobody really shot it. */
export async function seedDemoDelivery(
  toPhone: string,
  samples: Array<{ blob: Blob; name: string }>,
  onProgress?: (done: number, total: number) => void,
): Promise<Delivery> {
  const photos: DeliveryPhoto[] = []
  const now = Date.now()
  for (let i = 0; i < samples.length; i++) {
    onProgress?.(i, samples.length)
    // A studio sends the real file, so the delivery holds a print-grade copy.
    const prepared = await prepareUpload(samples[i].blob, { maxPx: 4000, quality: 0.94, withSample: false })
    photos.push({
      meta: {
        id: uid('ph_'),
        name: samples[i].name,
        source: 'photographer',
        status: 'pending',
        starred: false,
        caption: '',
        note: '',
        width: prepared.width,
        height: prepared.height,
        sourceWidth: prepared.sourceWidth,
        sourceHeight: prepared.sourceHeight,
        printGrade: true,
        bytes: prepared.full.size,
        addedAt: now,
        order: i,
      },
      full: prepared.full,
      thumb: prepared.thumb,
    })
  }
  onProgress?.(samples.length, samples.length)

  const delivery: Delivery = {
    id: uid('dlv_'),
    toPhones: [normalisePhone(toPhone)],
    studioName: `${DEMO_STUDIO.name}, ${DEMO_STUDIO.city}`,
    studioPhone: DEMO_STUDIO.phone,
    message: 'Full take from the wedding — pick the ones you want in the album and I will print them.',
    sentAt: now,
    openedBy: {},
    event: {
      title: 'Maa Pelli',
      hosts: 'Sireesha  ·  Karthik',
      eventDate: '14 February 2026',
      venue: 'Kalyana Mandapam, Rajahmundry',
      occasionNote: 'A Godavari-side Telugu wedding — pellikuthuru, muhurtham and an evening reception',
      language: 'telugu',
      themeId: DEFAULT_THEME_ID,
    },
    photos,
  }
  await db.putDelivery(delivery)
  return delivery
}
