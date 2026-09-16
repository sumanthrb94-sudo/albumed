/* Captures the whole journey, entry to exit, exactly as the deployed demo runs it
   (demo mode, no API key). Writes numbered PNGs to demo-output/walkthrough/. */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(new URL('..', import.meta.url).pathname)
const OUT = join(ROOT, 'demo-output', 'walkthrough')
const EXEC = process.env.ALBUMED_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const PORT = 4322
const BASE = `http://localhost:${PORT}`

if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
  console.error('Run `npm run build` first.')
  process.exit(1)
}

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

const server = spawn('node', ['dist-server/index.mjs'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), ANTHROPIC_API_KEY: '', ALBUMED_DEMO_AI: '1' },
  stdio: ['ignore', 'ignore', 'inherit'],
})
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${BASE}/api/health`)).ok) break
  } catch {
    /* not up yet */
  }
  if (i > 80) throw new Error('server did not start')
  await new Promise((r) => setTimeout(r, 100))
}

const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()

const index = []
let n = 0
const shot = async (label, opts = {}) => {
  n++
  const name = `${String(n).padStart(2, '0')}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`
  await page.waitForTimeout(opts.settle ?? 500)
  if (opts.scrollTo) await page.locator(opts.scrollTo).first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(250)
  if (opts.element) await page.locator(opts.element).first().screenshot({ path: join(OUT, name) })
  else await page.screenshot({ path: join(OUT, name), fullPage: Boolean(opts.full) })
  index.push({ n, name, label })
  console.log(`  ${String(n).padStart(2, '0')}  ${label}`)
}

try {
  console.log('\nEntry → exit walkthrough (demo mode, no API key)\n')

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Turn phone photos into a real album')
  await shot('Entry — the home screen, free plan')

  await page.click('text=+ New album')
  await page.fill('input[placeholder="Maa Pelli"]', 'Maa Pelli')
  await page.fill('input[placeholder="Sireesha & Karthik"]', 'Sireesha  ·  Karthik')
  await page.fill('input[placeholder="14 February 2026"]', '14 February 2026')
  await page.fill('input[placeholder="Kalyana Mandapam, Rajahmundry"]', 'Kalyana Mandapam, Rajahmundry')
  await shot('New album — templates grouped by region', { full: true })

  await page.selectOption('select', 'godavari')
  await page.click('text=Create album')
  await page.waitForSelector('text=Add photos')
  await shot('Add photos — free albums store a compressed copy')

  await page.click('text=Add sample photos')
  await page.waitForSelector('text=Just added', { timeout: 60000 })
  await page.waitForSelector('.compare', { timeout: 30000 })
  await shot('What compression costs you — drag to compare', { scrollTo: '.compare' })

  await page.click('text=Next: review & finalize →')
  await page.waitForSelector('text=Album assistant')
  await shot('Review — the assistant, before it has looked')

  await page.fill(
    'input[placeholder="Tamil brahmin muhurtham, then a reception in Chennai"]',
    'A Godavari-side Telugu wedding — pellikuthuru, muhurtham and a reception',
  )
  await page.selectOption('.ai-card select', 'telugu')
  await page.click('button:has-text("Review my photos")')
  await page.waitForSelector('.tile .verdict', { timeout: 180000 })
  await shot('Reviewed — every photo tagged by ceremony and scored', { scrollTo: '.photo-grid', settle: 1500 })

  await page.click('button:has-text("Show what it said")')
  await shot('Its reasoning, photo by photo', { scrollTo: '.reasons' })

  await page.locator('.tile').first().click()
  await page.waitForSelector('.lightbox', { timeout: 15000 })
  await shot('One photo — caption, note, and why it was kept', { settle: 1200 })
  await page.click('button:has-text("✕ Close")')

  await page.click('button:has-text("Plan the album")')
  await page.waitForSelector('text=Download album PDF', { timeout: 180000 })
  await shot('The album, with the assistant ready to edit it', { settle: 3000 })

  await page.fill('input[placeholder="What would you like changed?"]', 'Make it look like a Kerala wedding album')
  await page.click('button[type="submit"]:has-text("Send")')
  await page.waitForFunction(() => document.querySelectorAll('.bubble.assistant:not(.pending)').length > 0, null, {
    timeout: 90000,
  })
  await shot('Edited by asking — template changed, pages re-flowed', { settle: 2500, scrollTo: '.chat' })

  // the printed pages themselves
  await page.setViewportSize({ width: 1100, height: 1000 })
  await page.waitForTimeout(2500)
  await page.addStyleTag({ content: '.topbar,.steps{visibility:hidden !important}' })
  const pages = await page.locator('.page-item canvas').count()
  await shot('Printed page — the cover', { element: '.page-item:nth-child(1) canvas' })
  await shot('Printed page — a chapter divider', { element: '.page-item:nth-child(2) canvas' })
  await shot('Printed page — photos with Telugu captions', { element: '.page-item:nth-child(3) canvas' })
  await shot('Printed page — the closing', { element: `.page-item:nth-child(${pages}) canvas` })
  await page.addStyleTag({ content: '.topbar,.steps{visibility:visible !important}' })
  await page.setViewportSize({ width: 430, height: 932 })
  await page.waitForTimeout(1500)

  await page.evaluate(() => window.scrollTo(0, 0))
  await page.selectOption('.card select:has(option:has-text("dpi"))', '300').catch(() => {})
  await page.waitForSelector('.paywall', { timeout: 15000 })
  await shot('The paywall — what the compression was for', { settle: 1200 })
  await page.locator('.paywall-sheet').getByText('Plus', { exact: true }).first().scrollIntoViewIfNeeded()
  await shot('Plans', { settle: 600 })

  await page.click('.plan.featured button:has-text("Subscribe")')
  await page.waitForSelector('.paywall', { state: 'detached', timeout: 20000 })
  await shot('Subscribed — re-import the originals to upgrade this album', { settle: 2000 })

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await shot('Share and handover — project files between studio and customer', { settle: 800 })

  await page.click('.brand')
  await page.waitForSelector('text=Your albums')
  await shot('Exit — the album saved on the device', { settle: 1200 })

  await writeFile(join(OUT, 'index.json'), JSON.stringify(index, null, 2))
  console.log(`\n${n} screenshots in demo-output/walkthrough/\n`)
} finally {
  await browser.close()
  server.kill()
}
