/* End-to-end demo driver: serves the built app, runs the whole flow in a real
   browser (create → upload → review → finalize → template → album → PDF),
   and writes screenshots + the exported PDF to demo-output/. */
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

const ROOT = resolve(new URL('..', import.meta.url).pathname)
const DIST = join(ROOT, 'dist')
const OUT = join(ROOT, 'demo-output')
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const PORT = 4318

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg',
}

const server = createServer(async (req, res) => {
  try {
    const url = decodeURIComponent((req.url || '/').split('?')[0])
    let file = join(DIST, url === '/' ? 'index.html' : url)
    if (!existsSync(file)) file = join(DIST, 'index.html')
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch (e) {
    res.writeHead(500).end(String(e))
  }
})

const step = (n, msg) => console.log(`\n[${n}] ${msg}`)

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })
await new Promise((r) => server.listen(PORT, r))
console.log(`serving dist/ on http://localhost:${PORT}`)

const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] })
const ctx = await browser.newContext({
  viewport: { width: 430, height: 932 },      // phone-sized, like the APK would be
  deviceScaleFactor: 2,
  acceptDownloads: true,
})
const page = await ctx.newPage()
page.on('console', (m) => m.type() === 'error' && console.log('  browser error:', m.text()))
page.on('pageerror', (e) => console.log('  page error:', e.message))

const shot = async (name) => {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false })
  console.log(`  ✓ screenshot ${name}.png`)
}

try {
  step(1, 'Open the app')
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Turn phone photos into a real album')
  await shot('01-home')

  step(2, 'Create an album (as a customer would)')
  await page.click('text=+ New album')
  await page.fill('input[placeholder="Our Wedding"]', 'Vivah · Priya & Arjun')
  await page.fill('input[placeholder="Priya & Arjun"]', 'Priya Sharma  ·  Arjun Mehta')
  await page.fill('input[placeholder="14 February 2026"]', '14 February 2026')
  await page.fill('input[placeholder="Umaid Bhawan, Jodhpur"]', 'Umaid Bhawan, Jodhpur')
  await page.selectOption('select', 'vivah-gold')
  await page.click('text=Create album')
  await page.waitForSelector('text=Add photos')
  await shot('02-upload-empty')

  step(3, 'Add photos (sample stand-ins for the phone gallery)')
  await page.click('text=Add sample photos')
  await page.waitForSelector('text=Just added', { timeout: 60000 })
  await page.waitForTimeout(500)
  await shot('03-uploaded')

  step(4, 'Review: customer keeps some, leaves others out, stars a highlight')
  await page.click('text=Next: review & finalize →')
  await page.waitForSelector('text=Review & finalize')
  await page.click('button:has-text("✓ Keep all")')
  await page.waitForTimeout(300)
  // leave two out and star one, so the flow is a real decision, not a rubber stamp
  const tiles = page.locator('.tile')
  await tiles.nth(4).locator('button.no').click()
  await tiles.nth(7).locator('button.no').click()
  await tiles.nth(1).locator('button:has-text("★")').click()
  await page.waitForTimeout(400)
  await shot('04-review')

  step(5, 'Confirm the selection — album is generated')
  await page.click('button:has-text("Confirm")')
  await page.waitForSelector('text=Album template', { timeout: 30000 })
  await page.waitForTimeout(2500) // let the template swatches render
  await shot('05-templates')

  step(6, 'Switch occasion template (Marigold Mandap) and check the cover')
  await page.click('.theme-card:has-text("Marigold Mandap")')
  await page.waitForTimeout(2500)
  await shot('06-template-marigold')

  step(7, 'Back to Royal Vivah, open the album preview')
  await page.click('.theme-card:has-text("Royal Vivah")')
  await page.waitForTimeout(1500)
  await page.click('button:has-text("See the album")')
  await page.waitForSelector('text=Download album PDF', { timeout: 30000 })
  await page.waitForTimeout(3000)
  await shot('07-album-top')

  const pageCount = await page.locator('.page-item').count()
  console.log(`  ✓ album rendered with ${pageCount} pages`)
  if (pageCount < 3) throw new Error(`expected several album pages, got ${pageCount}`)

  // capture whole album pages (the canvas itself), not just what fits on screen
  await page.setViewportSize({ width: 1100, height: 1000 })
  await page.waitForTimeout(2000)
  // hide the app chrome so a page capture shows only the printed page
  await page.addStyleTag({ content: '.topbar,.steps{visibility:hidden !important}' })
  const shotPage = async (i, name) => {
    const el = page.locator('.page-item canvas').nth(i)
    await el.scrollIntoViewIfNeeded()
    await page.waitForTimeout(600)
    await el.screenshot({ path: join(OUT, `${name}.png`) })
    console.log(`  ✓ screenshot ${name}.png`)
  }
  await shotPage(0, '08-page-cover')
  await shotPage(1, '09-page-inside-1')
  await shotPage(2, '10-page-inside-2')
  await shotPage(pageCount - 1, '11-page-closing')

  await page.addStyleTag({ content: '.topbar,.steps{visibility:visible !important}' })

  step(8, 'Export the print-ready PDF')
  await page.evaluate(() => window.scrollTo(0, 0))
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 180000 }),
    page.click('button:has-text("Download album PDF")'),
  ])
  const pdfPath = join(OUT, 'album.pdf')
  await download.saveAs(pdfPath)
  const bytes = (await readFile(pdfPath)).length
  const head = (await readFile(pdfPath)).subarray(0, 5).toString()
  if (head !== '%PDF-') throw new Error('exported file is not a PDF')
  const pdfPages = (await readFile(pdfPath, 'latin1')).match(/\/Type\s*\/Page[^s]/g)?.length ?? 0
  console.log(`  ✓ album.pdf saved — ${(bytes / 1048576).toFixed(2)} MB, ${pdfPages} PDF pages`)
  if (pdfPages !== pageCount) throw new Error(`PDF has ${pdfPages} pages, preview had ${pageCount}`)

  step(9, 'Reload to prove the album survives a restart (local IndexedDB storage)')
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  const persisted = await page.locator('.page-item').count()
  console.log(`  ✓ after reload the album still has ${persisted} pages`)
  if (persisted !== pageCount) throw new Error('album did not persist across reload')
  await shot('12-after-reload')

  await writeFile(
    join(OUT, 'summary.json'),
    JSON.stringify({ pages: pageCount, pdfPages, pdfBytes: bytes, persistedPages: persisted }, null, 2),
  )
  console.log('\n✅ End-to-end demo passed. Output in demo-output/')
} finally {
  await browser.close()
  server.close()
}
