/* Minimal IndexedDB wrapper — no dependencies.
   Stores: projects, photos (metadata), blobs (original + thumbnail per photo), albums. */
import type { Album, Delivery, Photo, Project } from './types'

const DB_NAME = 'albumed'
const DB_VERSION = 2

export interface BlobRecord {
  photoId: string
  full: Blob
  thumb: Blob
  /** True-detail crop, kept for a handful of photos per album. */
  sampleReal?: Blob
  /** The same crop as stored, for the side-by-side. */
  sampleStored?: Blob
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('photos')) {
        const s = db.createObjectStore('photos', { keyPath: 'id' })
        s.createIndex('projectId', 'projectId')
      }
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'photoId' })
      if (!db.objectStoreNames.contains('albums')) db.createObjectStore('albums', { keyPath: 'projectId' })
      // v2: what a studio has sent to a customer's number.
      if (!db.objectStoreNames.contains('deliveries')) db.createObjectStore('deliveries', { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode)
        const req = fn(t.objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

/* ---------- projects ---------- */

export const getProjects = () => tx<Project[]>('projects', 'readonly', (s) => s.getAll())
export const getProject = (id: string) => tx<Project | undefined>('projects', 'readonly', (s) => s.get(id))
export const putProject = (p: Project) => tx('projects', 'readwrite', (s) => s.put(p)).then(() => p)

export async function deleteProject(id: string): Promise<void> {
  const photos = await getPhotos(id)
  await Promise.all(photos.map((p) => deletePhoto(p.id)))
  await tx('albums', 'readwrite', (s) => s.delete(id))
  await tx('projects', 'readwrite', (s) => s.delete(id))
}

/* ---------- photos ---------- */

export function getPhotos(projectId: string): Promise<Photo[]> {
  return tx<Photo[]>('photos', 'readonly', (s) => s.index('projectId').getAll(projectId)).then((list) =>
    list.sort((a, b) => a.order - b.order),
  )
}

export const putPhoto = (p: Photo) => tx('photos', 'readwrite', (s) => s.put(p)).then(() => p)

export async function putPhotos(list: Photo[]): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction('photos', 'readwrite')
    const store = t.objectStore('photos')
    list.forEach((p) => store.put(p))
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
  })
}

export async function deletePhoto(id: string): Promise<void> {
  await tx('photos', 'readwrite', (s) => s.delete(id))
  await tx('blobs', 'readwrite', (s) => s.delete(id))
}

/* ---------- blobs ---------- */

export const putBlobs = (rec: BlobRecord) => tx('blobs', 'readwrite', (s) => s.put(rec)).then(() => rec)
export const getBlobs = (photoId: string) => tx<BlobRecord | undefined>('blobs', 'readonly', (s) => s.get(photoId))

/* ---------- albums ---------- */

export const getAlbum = (projectId: string) =>
  tx<({ projectId: string } & Album) | undefined>('albums', 'readonly', (s) => s.get(projectId))
export const putAlbum = (projectId: string, album: Album) =>
  tx('albums', 'readwrite', (s) => s.put({ projectId, ...album })).then(() => album)

/* ---------- deliveries (studio -> customer) ---------- */

export const getDeliveries = () => tx<Delivery[]>('deliveries', 'readonly', (s) => s.getAll())
export const getDelivery = (id: string) => tx<Delivery | undefined>('deliveries', 'readonly', (s) => s.get(id))
export const putDelivery = (d: Delivery) => tx('deliveries', 'readwrite', (s) => s.put(d)).then(() => d)
export const deleteDelivery = (id: string) => tx('deliveries', 'readwrite', (s) => s.delete(id)).then(() => undefined)

/* ---------- storage estimate ---------- */

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null
  const e = await navigator.storage.estimate()
  return { usage: e.usage ?? 0, quota: e.quota ?? 0 }
}
