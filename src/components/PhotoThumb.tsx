import { useEffect, useState } from 'react'
import { thumbUrl } from '../lib/images'

export function PhotoThumb({ photoId, alt }: { photoId: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    thumbUrl(photoId).then((u) => alive && setUrl(u))
    return () => {
      alive = false
    }
  }, [photoId])
  if (!url) return <div style={{ width: '100%', height: '100%', background: 'var(--paper-2)' }} />
  return <img src={url} alt={alt} loading="lazy" decoding="async" />
}
