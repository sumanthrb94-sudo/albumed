/* Small thumbnails of a few sample photographs, for the sign-in screen.

   The full samples are 600KB to 1MB each — fine once you are inside the app and
   they are being turned into an album, far too heavy for the first screen
   someone ever loads. These are ~30KB, and they are the quickest way to say
   what this product is before anyone has read a word.

   Resized in the same headless Chromium the demo scripts already use, so there
   is no image dependency to install. Run `npm run thumbs` after changing the
   sample set; the output is committed. */
import { chromium } from 'playwright'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const ROOT = resolve(new URL('..', import.meta.url).pathname)
const SAMPLES = join(ROOT, 'public', 'samples')
const OUT = join(SAMPLES, 'thumbs')
const EXEC = process.env.ALBUMED_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

/** Six frames that read as a South Indian wedding at thumbnail size. */
const PICKS = [
  '01-pellikuthuru.jpg',
  '11-muhurtham-thaali.jpg',
  '03-talambralu.jpg',
  '07-appaginthalu.jpg',
  '09-mandapam.jpg',
  '10-reception.jpg',
]

const WIDTH = 440
const QUALITY = 0.72

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.goto('about:blank')

try {
  for (const file of PICKS) {
    const bytes = await readFile(join(SAMPLES, file))
    const dataUrl = `data:image/jpeg;base64,${bytes.toString('base64')}`
    const out = await page.evaluate(
      async ([src, width, quality]) => {
        const img = new Image()
        img.src = src
        await img.decode()
        const scale = width / img.naturalWidth
        const c = document.createElement('canvas')
        c.width = Math.round(img.naturalWidth * scale)
        c.height = Math.round(img.naturalHeight * scale)
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
        return c.toDataURL('image/jpeg', quality)
      },
      [dataUrl, WIDTH, QUALITY],
    )
    const buf = Buffer.from(out.split(',')[1], 'base64')
    await writeFile(join(OUT, file), buf)
    console.log(`  ${file} — ${(buf.length / 1024).toFixed(0)} KB`)
  }
  await writeFile(join(OUT, 'index.json'), `${JSON.stringify(PICKS, null, 2)}\n`)
  console.log(`\n${PICKS.length} thumbnails in public/samples/thumbs/\n`)
} finally {
  await browser.close()
}
