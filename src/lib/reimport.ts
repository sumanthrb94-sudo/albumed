/* Matching re-picked originals to the photos already in an album.

   After subscribing, the compressed copies need replacing with print-grade
   ones. The originals are still in the phone's gallery, so the customer picks
   the same files again — and we have to work out which stored photo each one
   replaces, without a server or an upload history to consult. */
import type { Photo } from './types'

export interface FileLike {
  name: string
  size: number
}

export interface Match<F extends FileLike> {
  file: F
  photo: Photo
  /** Exact means name and byte size agree; by-name is a re-encoded copy. */
  confidence: 'exact' | 'by-name'
}

export interface MatchResult<F extends FileLike> {
  matches: Array<Match<F>>
  unmatched: F[]
}

/** Never lets two files claim the same photo, and prefers exact matches. */
export function matchOriginals<F extends FileLike>(photos: Photo[], files: F[]): MatchResult<F> {
  const byName = new Map<string, Photo[]>()
  for (const p of photos) {
    const list = byName.get(p.name) ?? []
    list.push(p)
    byName.set(p.name, list)
  }

  const taken = new Set<string>()
  const matches: Array<Match<F>> = []
  const unmatched: F[] = []

  // Exact matches first, so a re-encoded file cannot steal a photo that a
  // byte-identical one would have claimed.
  const pending: F[] = []
  for (const file of files) {
    const candidates = (byName.get(file.name) ?? []).filter((p) => !taken.has(p.id))
    const exact = candidates.find((p) => p.bytes === file.size)
    if (exact) {
      taken.add(exact.id)
      matches.push({ file, photo: exact, confidence: 'exact' })
    } else {
      pending.push(file)
    }
  }

  for (const file of pending) {
    const candidate = (byName.get(file.name) ?? []).find((p) => !taken.has(p.id))
    if (candidate) {
      taken.add(candidate.id)
      matches.push({ file, photo: candidate, confidence: 'by-name' })
    } else {
      unmatched.push(file)
    }
  }

  return { matches, unmatched }
}
