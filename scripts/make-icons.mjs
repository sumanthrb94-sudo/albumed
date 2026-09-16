// Generates app icons with no image libraries: raw RGBA pixels -> PNG (zlib deflate + CRC32).
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const crcTable = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
const crc32 = (buf) => {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
const png = (w, h, rgba) => {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const MAROON = [0x7a, 0x12, 0x20]
const DEEP = [0x4a, 0x0a, 0x16]
const GOLD = [0xe7, 0xb4, 0x4f]
const IVORY = [0xfd, 0xf3, 0xdf]

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t))

/** A mandala-ish medallion in a maroon field: 16-petal rosette + ring of dots. */
function draw(size, inset) {
  const buf = Buffer.alloc(size * size * 4)
  const c = (size - 1) / 2
  const R = c * inset
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c
      const dy = y - c
      const d = Math.hypot(dx, dy) / R
      const a = Math.atan2(dy, dx)
      let col = mix(MAROON, DEEP, Math.min(1, d * 0.9))
      const petal = 0.62 + 0.13 * Math.cos(16 * a)
      if (d < 0.1) col = GOLD
      else if (d > 0.14 && d < 0.17) col = GOLD
      else if (d > 0.22 && d < petal - 0.16) {
        // inner lotus rays
        col = Math.cos(8 * a) > 0.25 ? mix(col, GOLD, 0.8) : mix(col, IVORY, 0.12)
      } else if (d > petal - 0.02 && d < petal + 0.02) col = GOLD
      else if (d > 0.86 && d < 0.9) col = mix(GOLD, IVORY, 0.3)
      // ring of dots
      const dotA = Math.round((a / (Math.PI * 2)) * 24) * ((Math.PI * 2) / 24)
      const dd = Math.hypot(dx - Math.cos(dotA) * R * 0.78, dy - Math.sin(dotA) * R * 0.78)
      if (dd < R * 0.028) col = IVORY
      const i = (y * size + x) * 4
      buf[i] = col[0]
      buf[i + 1] = col[1]
      buf[i + 2] = col[2]
      buf[i + 3] = 255
    }
  }
  return png(size, size, buf)
}

writeFileSync(new URL('../public/icon-192.png', import.meta.url), draw(192, 0.92))
writeFileSync(new URL('../public/icon-512.png', import.meta.url), draw(512, 0.92))
writeFileSync(new URL('../public/icon-maskable-512.png', import.meta.url), draw(512, 0.66))
console.log('icons written to public/')
