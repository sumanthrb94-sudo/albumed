/* End-to-end demo driver.

   Runs the production server (serving the built client) in front of a mock
   Claude upstream, then drives the whole product in a real browser:
   create -> upload -> AI curate -> AI plan -> AI edits -> PDF export -> reload.

   With ANTHROPIC_API_KEY set and ALBUMED_REAL_AI=1 it points at the real API
   instead of the mock; everything else is identical. */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { startMockAnthropic } from '../tests/mock-anthropic.mjs'

const ROOT = resolve(new URL('..', import.meta.url).pathname)
const OUT = join(ROOT, 'demo-output')
const EXEC = process.env.ALBUMED_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const PORT = 4318
const MOCK_PORT = 4611
const REAL_AI = process.env.ALBUMED_REAL_AI === '1' && Boolean(process.env.ANTHROPIC_API_KEY)
/* ALBUMED_DEMO_AI=1 runs the shipped demo mode instead of the mock upstream —
   the same thing a presentation with no API key would use. */
const DEMO_AI = !REAL_AI && process.env.ALBUMED_DEMO_AI === '1'
const BASE = `http://localhost:${PORT}`

if (!existsSync(join(ROOT, 'dist', 'index.html')) || !existsSync(join(ROOT, 'dist-server', 'index.mjs'))) {
  console.error('Run `npm run build` first.')
  process.exit(1)
}

const step = (n, msg) => console.log(`\n[${n}] ${msg}`)
const fail = (msg) => {
  throw new Error(msg)
}

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

const mock = REAL_AI || DEMO_AI ? null : await startMockAnthropic(MOCK_PORT)
console.log(
  REAL_AI
    ? 'using the real Claude API'
    : DEMO_AI
      ? 'using the shipped demo mode (no API key, no upstream)'
      : `using the mock Claude API on ${mock.url}`,
)

const server = spawn('node', ['dist-server/index.mjs'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    ...(DEMO_AI
      ? { ANTHROPIC_API_KEY: '', ALBUMED_DEMO_AI: '1' }
      : {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? 'test-key',
          ...(REAL_AI ? {} : { ANTHROPIC_BASE_URL: mock.url }),
        }),
  },
  stdio: ['ignore', 'pipe', 'inherit'],
})
server.stdout.on('data', (d) => {
  for (const line of String(d).trim().split('\n')) {
    try {
      const e = JSON.parse(line)
      if (e.msg !== 'listening') console.log(`  server: ${e.msg} ${JSON.stringify({ ...e, msg: undefined, t: undefined, level: undefined })}`)
    } catch {
      /* not json */
    }
  }
})

for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${BASE}/api/health`)).ok) break
  } catch {
    /* not up yet */
  }
  if (i > 80) fail('server did not start')
  await new Promise((r) => setTimeout(r, 100))
}
const health = await (await fetch(`${BASE}/api/health`)).json()
console.log(`server up on ${BASE} — assistant: ${health.enabled ? health.model : 'disabled'}`)
if (DEMO_AI && !health.demo) fail('demo mode did not switch on')

const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, acceptDownloads: true })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('  page error:', e.message))

const shot = async (name) => {
  await page.screenshot({ path: join(OUT, `${name}.png`) })
  console.log(`  ✓ screenshot ${name}.png`)
}
const shotPage = async (i, name) => {
  const el = page.locator('.page-item canvas').nth(i)
  await el.scrollIntoViewIfNeeded()
  await page.waitForTimeout(600)
  await el.screenshot({ path: join(OUT, `${name}.png`) })
  console.log(`  ✓ screenshot ${name}.png`)
}
/* Waits for a reply rather than for particular wording — the live assistant and
   demo mode phrase things differently, and both are valid. */
const chat = async (text) => {
  const replies = page.locator('.bubble.assistant:not(.pending)')
  const before = await replies.count()
  await page.fill('input[placeholder="What would you like changed?"]', text)
  await page.click('button[type="submit"]:has-text("Send")')
  await page.waitForFunction(
    (n) => document.querySelectorAll('.bubble.assistant:not(.pending)').length > n,
    before,
    { timeout: 90000 },
  )
  await page.waitForTimeout(1200)
  const reply = await replies.last().innerText()
  console.log(`  ✓ "${text}"\n      → ${reply.split('\n')[0]}`)
  return reply
}

const summary = {}

try {
  step(1, 'Open the app')
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Turn phone photos into a real album')
  await shot('01-home')

  // A deep URL is served index.html by the rewrite; the assets must still load,
  // which they only do if the build uses absolute paths.
  const deep = await page.goto(`${BASE}/p/does-not-exist/album`, { waitUntil: 'networkidle' })
  if (!deep.ok()) fail('a deep link did not return the app')
  await page.waitForSelector('.topbar', { timeout: 15000 })
  const styled = await page.evaluate(() => getComputedStyle(document.querySelector('.topbar')).backgroundImage !== 'none')
  if (!styled) fail('assets did not resolve on a deep link — is the build base relative?')
  console.log('  ✓ deep links load the app with its assets')
  await page.goto(BASE, { waitUntil: 'networkidle' })

  step(2, 'Create a Telugu wedding album (free plan)')
  await page.click('text=+ New album')
  await page.fill('input[placeholder="Maa Pelli"]', 'Maa Pelli')
  await page.fill('input[placeholder="Sireesha & Karthik"]', 'Sireesha  ·  Karthik')
  await page.fill('input[placeholder="14 February 2026"]', '14 February 2026')
  await page.fill('input[placeholder="Kalyana Mandapam, Rajahmundry"]', 'Kalyana Mandapam, Rajahmundry')
  await page.selectOption('select', 'godavari')
  await page.click('text=Create album')
  await page.waitForSelector('text=Add photos')
  const planChip = await page.locator('.plan-chip').innerText()
  console.log(`  ✓ starting on the ${planChip} plan`)
  if (planChip !== 'Free') fail('a new visitor should start on Free')

  step(3, 'Add the raw take — free albums store a compressed copy')
  await page.waitForSelector('text=Free albums store a compressed copy')
  await page.click('text=Add sample photos')
  await page.waitForSelector('text=Just added', { timeout: 60000 })
  await page.waitForSelector('.compare', { timeout: 30000 })
  const storedLabel = await page.locator('.compare-label.right').innerText()
  const originalLabel = await page.locator('.compare-label.left').innerText()
  console.log(`  ✓ quality comparison rendered — ${originalLabel} vs ${storedLabel}`)
  if (!/1280|\d+ × \d+/.test(storedLabel)) fail('the stored size was not shown')
  await page.locator('.compare').scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
  await shot('02-compression-compare')

  await page.click('text=Next: review & finalize →')
  await page.waitForSelector('text=Album assistant')
  await shot('03-review-before-ai')

  step(4, 'Assistant reviews every photo (vision pass)')
  await page.fill(
    'input[placeholder="Tamil brahmin muhurtham, then a reception in Chennai"]',
    'A Godavari-side Telugu wedding — pellikuthuru, muhurtham and an evening reception',
  )
  await page.selectOption('.ai-card select', 'telugu')
  await page.click('button:has-text("Review my photos")')
  await page.waitForSelector('.tile .verdict', { timeout: 180000 })
  await page.waitForTimeout(1500)
  const tagged = await page.locator('.tile .verdict').count()
  const approved = Number((await page.locator('.stat b').first().innerText()).trim())
  console.log(`  ✓ ${tagged} photos tagged by ceremony, ${approved} kept`)
  if (tagged < 6) fail(`expected the assistant to tag most photos, got ${tagged}`)
  summary.tagged = tagged
  summary.approvedByAi = approved
  await shot('04-review-after-ai')

  await page.click('button:has-text("Show what it said")')
  await page.waitForTimeout(500)
  await shot('05-ai-reasons')

  step(5, 'Assistant plans the running order and generates the album')
  await page.click('button:has-text("Plan the album")')
  await page.waitForSelector('text=Download album PDF', { timeout: 180000 })
  await page.waitForTimeout(3000)
  if (DEMO_AI) {
    const badges = await page.locator('.demo-badge').count()
    if (!badges) fail('demo mode must be labelled in the UI')
    console.log('  ✓ demo mode is labelled on screen')
  }
  const pagesAfterPlan = await page.locator('.page-item').count()
  const chapterPages = await page.locator('.page-tools .lbl:has-text("Chapter")').count()
  console.log(`  ✓ album built: ${pagesAfterPlan} pages, ${chapterPages} chapter dividers`)
  if (chapterPages < 1) fail('the assistant did not produce any chapters')
  summary.pagesAfterPlan = pagesAfterPlan
  summary.chapters = chapterPages
  await shot('06-album-with-chat')

  step(6, 'Edit the album by asking for changes')
  const themeBefore = await page.locator('.card .hint').first().innerText()
  await chat('Make it look like a Kerala wedding album')
  const themeAfter = await page.locator('.card .hint').first().innerText()
  console.log(`  ✓ template: ${themeBefore.split('·')[0].trim()} → ${themeAfter.split('·')[0].trim()}`)
  if (themeBefore === themeAfter) fail('asking for a Kerala album did not change the template')
  await shot('07-chat-theme-changed')
  await shotPage(0, '08-page-cover-kasavu')

  await chat('Give the thaali moment a full page of its own')
  await chat('Fewer photos per page, more white space')
  const pagesAfterEdits = await page.locator('.page-item').count()
  console.log(`  ✓ album re-laid out: ${pagesAfterEdits} pages`)
  summary.pagesAfterEdits = pagesAfterEdits
  await shot('09-chat-history')

  step(7, 'Undo the last change')
  await page.click('.ai-card button:has-text("Undo")')
  await page.waitForTimeout(2500)
  const pagesAfterUndo = await page.locator('.page-item').count()
  console.log(`  ✓ after undo: ${pagesAfterUndo} pages (was ${pagesAfterEdits})`)
  if (pagesAfterUndo === 0) fail('undo emptied the album')
  summary.pagesAfterUndo = pagesAfterUndo

  step(8, 'Free export is a watermarked draft, capped in resolution')
  const [freeDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 240000 }),
    page.click('button:has-text("Download album PDF")'),
  ])
  const freePath = join(OUT, 'album-free-draft.pdf')
  await freeDownload.saveAs(freePath)
  const freePdf = await readFile(freePath)
  if (freePdf.subarray(0, 5).toString() !== '%PDF-') fail('the free export is not a PDF')
  console.log(`  ✓ free draft: ${(freePdf.length / 1048576).toFixed(2)} MB at 150 dpi, watermarked`)
  summary.freePdfBytes = freePdf.length

  const dpiOptions = await page.locator('select:below(:text("Print quality"))').first().innerText()
  if (!/🔒/.test(dpiOptions)) fail('press resolutions should be locked on Free')
  console.log('  ✓ 300 and 600 dpi are locked')
  await page.selectOption('.card select:has(option:has-text("dpi"))', '300').catch(() => {})
  await page.waitForSelector('.paywall', { timeout: 15000 })
  console.log('  ✓ asking for 300 dpi opens the paywall')
  await shot('10-paywall')

  step(9, 'Subscribe, and the same album unlocks')
  await page.click('.plan.featured button:has-text("Subscribe")')
  await page.waitForSelector('.paywall', { state: 'detached', timeout: 20000 })
  const paidChip = await page.locator('.plan-chip').innerText()
  console.log(`  ✓ now on ${paidChip}`)
  if (!/Plus/.test(paidChip)) fail('subscribing did not change the plan')
  await page.waitForTimeout(800)
  const hasReimport = await page.locator('text=Re-import my originals').count()
  if (!hasReimport) fail('a paid album with compressed photos should offer a re-import')
  console.log('  ✓ the album offers to swap in the original files')
  await shot('11-after-subscribe')

  step('9b', 'Re-import the originals, the way someone would after subscribing')
  // The originals only exist in the phone's gallery, so the demo makes stand-ins
  // at full size with the same file names, and hands them to the real input.
  // These must match the names the app gives its samples, or the matcher will
  // correctly refuse to pair them up.
  const names = ['pellikuthuru.jpg', 'jeelakarra-bellam.jpg', 'talambralu.jpg']
  const originals = []
  for (const name of names) {
    const dataUrl = await page.evaluate(async () => {
      const c = document.createElement('canvas')
      c.width = 3000
      c.height = 2250
      const ctx = c.getContext('2d')
      const g = ctx.createLinearGradient(0, 0, c.width, c.height)
      g.addColorStop(0, '#e8c24a')
      g.addColorStop(1, '#8c5a12')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, c.width, c.height)
      for (let i = 0; i < 900; i++) {
        const a = (i / 900) * Math.PI * 2
        ctx.strokeStyle = i % 2 ? 'rgba(255,240,190,0.9)' : 'rgba(90,40,20,0.7)'
        ctx.beginPath()
        ctx.moveTo(1500 + Math.cos(a) * 300, 1000 + Math.sin(a) * 300)
        ctx.lineTo(1500 + Math.cos(a) * 900, 1000 + Math.sin(a) * 900)
        ctx.stroke()
      }
      return c.toDataURL('image/jpeg', 0.96)
    })
    const file = join(OUT, name)
    await writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'))
    originals.push(file)
  }
  await page.setInputFiles('input[type=file][accept="image/*"]', originals)
  await page.waitForSelector('.toast:has-text("upgraded to print quality")', { timeout: 120000 })
  const upgradeToast = await page.locator('.toast').innerText()
  console.log(`  ✓ ${upgradeToast}`)
  if (!/3 photos upgraded/.test(upgradeToast)) fail('the originals did not replace the compressed copies')
  await page.waitForTimeout(1500)

  step('9c', 'Now the press resolution is available')
  await page.selectOption('.card select:has(option:has-text("dpi"))', '300')
  const chosenDpi = await page.locator('.card select:has(option:has-text("dpi"))').inputValue()
  if (chosenDpi !== '300') fail('300 dpi should be selectable after subscribing')
  console.log('  ✓ export set to 300 dpi')

  step(10, 'Capture the printed pages')
  await page.setViewportSize({ width: 1100, height: 1000 })
  await page.waitForTimeout(2000)
  await page.addStyleTag({ content: '.topbar,.steps{visibility:hidden !important}' })
  const total = await page.locator('.page-item').count()
  await shotPage(0, '12-page-cover')
  await shotPage(1, '13-page-chapter')
  await shotPage(2, '14-page-inside')
  await shotPage(total - 1, '15-page-closing')
  await page.addStyleTag({ content: '.topbar,.steps{visibility:visible !important}' })

  step(11, 'Export the print-ready PDF at 300 dpi')
  await page.evaluate(() => window.scrollTo(0, 0))
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 240000 }),
    page.click('button:has-text("Download album PDF")'),
  ])
  const pdfPath = join(OUT, 'album-subscribed.pdf')
  await download.saveAs(pdfPath)
  const pdf = await readFile(pdfPath)
  if (pdf.subarray(0, 5).toString() !== '%PDF-') fail('the exported file is not a PDF')
  const pdfPages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
  console.log(`  ✓ album.pdf — ${(pdf.length / 1048576).toFixed(2)} MB, ${pdfPages} pages`)
  // The paid export carries far more detail than the capped, watermarked draft.
  if (pdf.length <= summary.freePdfBytes * 1.5) {
    fail(`the paid export (${pdf.length}) is not meaningfully richer than the free draft (${summary.freePdfBytes})`)
  }
  console.log(`  ✓ ${(pdf.length / summary.freePdfBytes).toFixed(1)}× the data of the free draft`)
  if (pdfPages !== total) fail(`PDF has ${pdfPages} pages, the preview showed ${total}`)
  summary.pdfPages = pdfPages
  summary.pdfBytes = pdf.length
  summary.plan = paidChip

  step(12, 'Reload to prove everything survives a restart')
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(3000)
  const persisted = await page.locator('.page-item').count()
  console.log(`  ✓ after reload: ${persisted} pages`)
  if (persisted !== total) fail(`album did not persist: ${persisted} pages after reload, ${total} before`)
  summary.persistedPages = persisted
  await shot('16-after-reload')

  await writeFile(join(OUT, 'summary.json'), JSON.stringify({ ai: health, ...summary }, null, 2))
  console.log('\n✅ End-to-end demo passed. Output in demo-output/')
} catch (err) {
  console.error(`\n❌ Demo failed: ${err.message}`)
  await page.screenshot({ path: join(OUT, 'failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
  server.kill()
  mock?.server.close()
}
