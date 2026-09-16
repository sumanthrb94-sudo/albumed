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

const mock = REAL_AI ? null : await startMockAnthropic(MOCK_PORT)
console.log(REAL_AI ? 'using the real Claude API' : `using the mock Claude API on ${mock.url}`)

const server = spawn('node', ['dist-server/index.mjs'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? 'test-key',
    ...(REAL_AI ? {} : { ANTHROPIC_BASE_URL: mock.url }),
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
const chat = async (text, expect) => {
  await page.fill('input[placeholder="What would you like changed?"]', text)
  await page.click('button[type="submit"]:has-text("Send")')
  await page.waitForSelector(`.bubble.assistant:has-text("${expect}")`, { timeout: 90000 })
  await page.waitForTimeout(1200)
  console.log(`  ✓ "${text}" → applied`)
}

const summary = {}

try {
  step(1, 'Open the app')
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Turn phone photos into a real album')
  await shot('01-home')

  step(2, 'Create a South Indian wedding album')
  await page.click('text=+ New album')
  await page.fill('input[placeholder="Our Wedding"]', 'Our Muhurtham')
  await page.fill('input[placeholder="Priya & Arjun"]', 'Priya Sharma  ·  Arjun Mehta')
  await page.fill('input[placeholder="14 February 2026"]', '14 February 2026')
  await page.fill('input[placeholder="Umaid Bhawan, Jodhpur"]', 'Sri Krishna Gana Sabha, Chennai')
  await page.selectOption('select', 'kanjeevaram')
  await page.click('text=Create album')
  await page.waitForSelector('text=Add photos')

  step(3, 'Add the raw take from the phone')
  await page.click('text=Add sample photos')
  await page.waitForSelector('text=Just added', { timeout: 60000 })
  await page.click('text=Next: review & finalize →')
  await page.waitForSelector('text=Album assistant')
  await shot('02-review-before-ai')

  step(4, 'Assistant reviews every photo (vision pass)')
  await page.fill(
    'input[placeholder="Tamil brahmin muhurtham, then a reception in Chennai"]',
    'Tamil brahmin muhurtham at a sabha, followed by an evening reception',
  )
  await page.selectOption('.ai-card select', 'tamil')
  await page.click('button:has-text("Review my photos")')
  await page.waitForSelector('.tile .verdict', { timeout: 180000 })
  await page.waitForTimeout(1500)
  const tagged = await page.locator('.tile .verdict').count()
  const approved = Number((await page.locator('.stat b').first().innerText()).trim())
  console.log(`  ✓ ${tagged} photos tagged by ceremony, ${approved} kept`)
  if (tagged < 6) fail(`expected the assistant to tag most photos, got ${tagged}`)
  summary.tagged = tagged
  summary.approvedByAi = approved
  await shot('03-review-after-ai')

  await page.click('button:has-text("Show what it said")')
  await page.waitForTimeout(500)
  await shot('04-ai-reasons')

  step(5, 'Assistant plans the running order and generates the album')
  await page.click('button:has-text("Plan the album")')
  await page.waitForSelector('text=Download album PDF', { timeout: 180000 })
  await page.waitForTimeout(3000)
  const pagesAfterPlan = await page.locator('.page-item').count()
  const chapterPages = await page.locator('.page-tools .lbl:has-text("Chapter")').count()
  console.log(`  ✓ album built: ${pagesAfterPlan} pages, ${chapterPages} chapter dividers`)
  if (chapterPages < 1) fail('the assistant did not produce any chapters')
  summary.pagesAfterPlan = pagesAfterPlan
  summary.chapters = chapterPages
  await shot('05-album-with-chat')

  step(6, 'Edit the album by asking for changes')
  const themeBefore = await page.locator('.card .hint').first().innerText()
  await chat('Make it look like a Kerala wedding album', 'Kasavu')
  const themeAfter = await page.locator('.card .hint').first().innerText()
  console.log(`  ✓ template: ${themeBefore.split('·')[0].trim()} → ${themeAfter.split('·')[0].trim()}`)
  if (themeBefore === themeAfter) fail('asking for a Kerala album did not change the template')
  await shot('06-chat-theme-changed')
  await shotPage(0, '07-page-cover-kasavu')

  await chat('Give the thaali moment a full page of its own', 'page of its own')
  await chat('Drop anything blurry or with eyes closed', 'out')
  const pagesAfterEdits = await page.locator('.page-item').count()
  console.log(`  ✓ album re-laid out: ${pagesAfterEdits} pages`)
  summary.pagesAfterEdits = pagesAfterEdits
  await shot('08-chat-history')

  step(7, 'Undo the last change')
  await page.click('.ai-card button:has-text("Undo")')
  await page.waitForTimeout(2500)
  const pagesAfterUndo = await page.locator('.page-item').count()
  console.log(`  ✓ after undo: ${pagesAfterUndo} pages (was ${pagesAfterEdits})`)
  if (pagesAfterUndo === 0) fail('undo emptied the album')
  summary.pagesAfterUndo = pagesAfterUndo

  step(8, 'Capture the printed pages')
  await page.setViewportSize({ width: 1100, height: 1000 })
  await page.waitForTimeout(2000)
  await page.addStyleTag({ content: '.topbar,.steps{visibility:hidden !important}' })
  const total = await page.locator('.page-item').count()
  await shotPage(0, '09-page-cover')
  await shotPage(1, '10-page-chapter')
  await shotPage(2, '11-page-inside')
  await shotPage(total - 1, '12-page-closing')
  await page.addStyleTag({ content: '.topbar,.steps{visibility:visible !important}' })

  step(9, 'Export the print-ready PDF')
  await page.evaluate(() => window.scrollTo(0, 0))
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 240000 }),
    page.click('button:has-text("Download album PDF")'),
  ])
  const pdfPath = join(OUT, 'album.pdf')
  await download.saveAs(pdfPath)
  const pdf = await readFile(pdfPath)
  if (pdf.subarray(0, 5).toString() !== '%PDF-') fail('the exported file is not a PDF')
  const pdfPages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
  console.log(`  ✓ album.pdf — ${(pdf.length / 1048576).toFixed(2)} MB, ${pdfPages} pages`)
  if (pdfPages !== total) fail(`PDF has ${pdfPages} pages, the preview showed ${total}`)
  summary.pdfPages = pdfPages
  summary.pdfBytes = pdf.length

  step(10, 'Reload to prove everything survives a restart')
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(3000)
  const persisted = await page.locator('.page-item').count()
  console.log(`  ✓ after reload: ${persisted} pages`)
  if (persisted !== total) fail(`album did not persist: ${persisted} pages after reload, ${total} before`)
  summary.persistedPages = persisted
  await shot('13-after-reload')

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
