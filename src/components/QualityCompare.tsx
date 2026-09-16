import { useEffect, useRef, useState } from 'react'
import { sampleUrls } from '../lib/images'
import { useApp } from '../store'
import type { Photo } from '../lib/types'

/** The upsell, shown rather than argued: the same crop from the original file
 *  next to the same crop as it survives in the compressed copy this plan
 *  stores. Drag the handle to compare. */
export function QualityCompare({ photo, onSubscribe }: { photo: Photo; onSubscribe?: () => void }) {
  const [urls, setUrls] = useState<{ real: string; stored: string } | null>(null)
  const [pos, setPos] = useState(50)
  const box = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let created: { real: string; stored: string } | null = null
    sampleUrls(photo.id).then((u) => {
      created = u
      setUrls(u)
    })
    return () => {
      if (created) {
        URL.revokeObjectURL(created.real)
        URL.revokeObjectURL(created.stored)
      }
    }
  }, [photo.id])

  if (!urls) return null

  const move = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect()
    if (!rect) return
    setPos(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)))
  }

  const stored = `${photo.width} × ${photo.height}`
  const source = photo.sourceWidth ? `${photo.sourceWidth} × ${photo.sourceHeight}` : 'your original'

  return (
    <div className="compare-card">
      <div
        className="compare"
        ref={box}
        onMouseMove={(e) => e.buttons === 1 && move(e.clientX)}
        onMouseDown={(e) => move(e.clientX)}
        onTouchMove={(e) => move(e.touches[0].clientX)}
      >
        <img src={urls.stored} alt={`${photo.name} as stored on this plan`} draggable={false} />
        {/* Both layers are the same size and the top one is clipped, so the two
            halves line up exactly whatever width the card ends up. */}
        <div className="compare-top" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
          <img src={urls.real} alt={`${photo.name} at its original quality`} draggable={false} />
        </div>
        <div className="compare-handle" style={{ left: `${pos}%` }} aria-hidden="true">
          <span>⇹</span>
        </div>
        <span className="compare-label left">Your original · {source}</span>
        <span className="compare-label right">Stored here · {stored}</span>
      </div>
      <input
        className="compare-range"
        type="range"
        min={0}
        max={100}
        value={pos}
        aria-label="Compare the original with the stored copy"
        onChange={(e) => setPos(Number(e.target.value))}
      />
      <p className="hint">
        Both halves are the same patch of the same photo, at the same size. The left is what came off
        your phone; the right is what this album will print.
      </p>
      {onSubscribe && (
        <button className="btn gold block" onClick={onSubscribe}>
          Keep my photos at full quality
        </button>
      )}
    </div>
  )
}

/** Picks a photo worth comparing and shows the panel, or nothing if there is none. */
export function QualityNudge({ onSubscribe }: { onSubscribe: () => void }) {
  const app = useApp()
  if (app.plan.limits.printGrade) return null
  const photo = app.photos.find((p) => p.hasSample)
  if (!photo) return null
  return (
    <div className="card ai-card">
      <h2>What compression is costing you</h2>
      <p className="hint">
        Free albums keep a smaller, more compressed copy of each photo. On a phone screen you will
        not notice. On a printed page, at arm's length, you will.
      </p>
      <QualityCompare photo={photo} onSubscribe={onSubscribe} />
    </div>
  )
}
