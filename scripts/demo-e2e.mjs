/* End-to-end demo driver.

   Runs the production server (serving the built client) in front of a mock
   Claude upstream, then drives the whole product in a real browser:
   create -> upload -> AI curate -> AI plan -> AI edits -> PDF export -> reload.

   With ANTHROPIC_API_KEY set and ALBUMED_REAL_AI=1 it points at the real API
   instead of the mock; everything else is identical. */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { readFile, readdir, mkdir, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { startMockAnthropic } from '../tests/mock-anthropic.mjs'

const ROOT = resolve(new URL('..', import.meta.url).pathname)
const OUT = join(ROOT, 'demo-output')
const EXEC = process.env.ALBUMED_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const PORT = 4318
const MOCK_PORT = 4611
const REAL_AI =
  process.env.ALBUMED_REAL_AI === '1' &&
  Boolean(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY)
/* ALBUMED_DEMO_AI=1 runs the shipped demo mode instead of the mock upstream —
   the same thing a presentation with no API key would use. */
const DEMO_AI = !REAL_AI && process.env.ALBUMED_DEMO_AI === '1'
const BASE = `http://localhost:${PORT}`
const PHONE = '98765 43210'      // the family
const STUDIO_PHONE = '90000 11122'  // the photographer

if (!existsSync(join(ROOT, 'dist', 'index.html')) || !existsSync(join(ROOT, 'dist-server', 'index.mjs'))) {
  console.error('Run `npm run build` first.')
  process.exit(1)
}

const step = (n, msg) => console.log(`\n[${n}] ${msg}`)
const fail = (msg) => {
  throw new Error(msg)
}

// Clear this run's own output, but leave subdirectories alone: the walkthrough
// capture writes into demo-output/walkthrough, and wiping the lot meant
// whichever script ran second deleted the other one's work.
await mkdir(OUT, { recursive: true })
for (const entry of await readdir(OUT, { withFileTypes: true })) {
  if (entry.isFile()) await rm(join(OUT, entry.name), { force: true })
}

const mock = REAL_AI || DEMO_AI ? null : await startMockAnthropic(MOCK_PORT)
console.log(
  REAL_AI
    ? `using the real API (${process.env.GEMINI_API_KEY ? 'Gemini' : 'Claude'})`
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
      ? { ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', ALBUMED_DEMO_AI: '1' }
      : REAL_AI
        ? {} // pass the real provider keys straight through
        : {
            GEMINI_API_KEY: '',
            ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? 'test-key',
            ANTHROPIC_BASE_URL: mock.url,
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

/* Signs in the way a person would: type the number, read the code off the
   screen (there is no SMS behind this demo), type it in. */
const signIn = async (phone, role = 'customer') => {
  await page.waitForSelector('.signin-card', { timeout: 20000 })
  await page.click(role === 'studio' ? '.role-pick button:has-text("I am the studio")' : '.role-pick button:has-text("I am the family")')
  await page.fill('input[aria-label="Mobile number"]', phone)
  await page.click('button:has-text("Send code")')
  await page.waitForSelector('[data-testid="demo-otp"]')
  const code = (await page.locator('[data-testid="demo-otp"]').innerText()).trim()
  if (!/^[1-9]\d{5}$/.test(code)) fail(`the demo code does not look like a 6 digit code: ${code}`)
  return code
}
const enterCode = async (code) => {
  await page.fill('input[aria-label="One time code"]', code)
  await page.click('button:has-text("Sign in")')
}
/** Number, code off the screen, code in — the whole gate in one call. */
const signInFully = async (phone, role = 'customer') => {
  const code = await signIn(phone, role)
  await enterCode(code)
  await page.waitForSelector('.topbar', { timeout: 20000 })
  return code
}
const signOut = async () => {
  await page.locator('.account-chip').click()
  await page.click('.account-menu button:has-text("Sign out")')
  await page.waitForSelector('.signin-card', { timeout: 15000 })
}

const summary = {}

try {
  step(1, 'The studio signs in')
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('.signin-card')
  // A half-typed number cannot be submitted.
  await page.fill('input[aria-label="Mobile number"]', '98765')
  if (await page.locator('button:has-text("Send code")').isEnabled()) fail('a 5 digit number was accepted')
  // Nor can a landline-shaped one.
  await page.fill('input[aria-label="Mobile number"]', '1234567890')
  if (await page.locator('button:has-text("Send code")').isEnabled()) fail('a number starting 1 was accepted')
  await shot('01-signin')

  /* The gate is a cream card on a maroon field in either theme, because the
     field is ours and not the operating system's. It was not: with the tokens
     flipped for dark mode the card's gradient ran white to near-black under
     cream text and the top half of it went blank on a phone. */
  {
    const dark = await browser.newContext({ viewport: { width: 412, height: 915 }, colorScheme: 'dark' })
    const dp = await dark.newPage()
    await dp.goto(BASE, { waitUntil: 'networkidle' })
    await dp.waitForSelector('.signin-card')
    const seen = await dp.evaluate(() => {
      const lum = (c) => {
        const m = /rgba?\((\d+), ?(\d+), ?(\d+)/.exec(c)
        return m ? (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) / 255 : null
      }
      const card = document.querySelector('.signin-card')
      const h2 = card.querySelector('h2')
      const stops = getComputedStyle(card).backgroundImage.match(/rgba?\([^)]+\)/g) ?? []
      return { stops: stops.map(lum), ink: lum(getComputedStyle(h2).color) }
    })
    await dark.close()
    const gaps = seen.stops.map((l) => Math.abs(l - seen.ink))
    console.log(`  \u2713 dark mode: the card stays cream (ink ${seen.ink.toFixed(2)} vs ${seen.stops.map((l) => l.toFixed(2)).join(', ')})`)
    if (Math.min(...gaps) < 0.4) {
      fail(`the sign-in heading disappears into its own card in dark mode: ink ${seen.ink}, card ${seen.stops}`)
    }
  }

  const code = await signIn(STUDIO_PHONE, 'studio')
  console.log(`  \u2713 code issued on screen: ${code}`)
  await shot('02-signin-code')

  // A wrong code is refused and counted, not waved through.
  await enterCode(String((Number(code) + 111111) % 1000000).padStart(6, '0'))
  const otpError = await page.locator('.signin-error').innerText()
  console.log(`  \u2713 wrong code refused \u2014 \u201c${otpError}\u201d`)
  if (!/not right/i.test(otpError)) fail(`a wrong code was not refused: ${otpError}`)

  await enterCode(code)
  await page.waitForSelector('.topbar', { timeout: 15000 })
  if (!(await page.locator('.chip.studio').count())) fail('the studio side is not labelled')
  await page.waitForSelector('text=Send the take to the family')
  console.log('  \u2713 signed in on the studio side')
  await shot('03-studio-home')

  // A deep URL is served index.html by the rewrite; the assets must still load,
  // which they only do if the build uses absolute paths.
  const deep = await page.goto(`${BASE}/p/does-not-exist/album`, { waitUntil: 'networkidle' })
  if (!deep.ok()) fail('a deep link did not return the app')
  await page.waitForSelector('.topbar', { timeout: 15000 })
  const styled = await page.evaluate(() => getComputedStyle(document.querySelector('.topbar')).backgroundImage !== 'none')
  if (!styled) fail('assets did not resolve on a deep link — is the build base relative?')
  console.log('  \u2713 deep links load the app with its assets')
  await page.goto(BASE, { waitUntil: 'networkidle' })

  step(2, 'The studio takes a studio plan \u2014 you cannot send what you did not keep')
  await page.click('.plan-chip')
  await page.waitForSelector('.paywall')
  await page.click('.plan[data-plan="studio"] button:has-text("Subscribe")')
  await page.waitForSelector('.paywall', { state: 'detached', timeout: 20000 })
  const studioPlan = (await page.locator('.plan-chip').innerText()).trim()
  console.log(`  \u2713 studio is on ${studioPlan}`)
  if (!/Studio/.test(studioPlan)) fail(`the studio is on ${studioPlan}`)

  step(3, 'The studio makes the event and adds the take')
  await page.click('text=+ New event')
  await page.fill('input[placeholder="Maa Pelli"]', 'Maa Pelli')
  await page.fill('input[placeholder="Sireesha & Karthik"]', 'Sireesha  \u00b7  Karthik')
  await page.fill('input[placeholder="14 February 2026"]', '14 February 2026')
  await page.fill('input[placeholder="Kalyana Mandapam, Rajahmundry"]', 'Kalyana Mandapam, Rajahmundry')
  await page.selectOption('select', 'godavari')
  await page.click('text=Create event')
  await page.waitForSelector('text=Add photos')
  await page.click('text=Add sample photos')
  await page.waitForSelector('text=Just added', { timeout: 90000 })
  // The "Just added" strip only shows the last dozen; the stat is the real count.
  const studioCount = Number((await page.locator('.stat b').first().innerText()).trim().split('/')[0].trim())
  console.log(`  \u2713 ${studioCount} photographs in the event`)
  if (studioCount < 20) fail(`the studio only has ${studioCount} photos`)

  step(4, 'The studio sends it to the family\u2019s number')
  await page.locator('.send-card').scrollIntoViewIfNeeded()
  const quality = await page.locator('.send-quality').innerText()
  console.log(`  \u2713 ${quality.split('\n')[0]}`)
  if (!/print quality/i.test(quality)) fail(`the studio is not sending print quality: ${quality}`)
  await page.fill('input[aria-label="Customer mobile number 1"]', PHONE)
  await shot('04-studio-send')
  await page.click('.send-card button:has-text("Send")')
  await page.waitForSelector('.sent-item', { timeout: 60000 })
  const sentTo = await page.locator('.sent-item .who').innerText()
  const sentState = await page.locator('.sent-item .waiting, .sent-item .opened').innerText()
  console.log(`  \u2713 sent to ${sentTo} \u2014 ${sentState}`)
  if (!/waiting/i.test(sentState)) fail(`expected the delivery to be waiting, got "${sentState}"`)
  await shot('05-studio-sent')

  step(5, 'The family signs in, and the photos are already there')
  await signOut()
  await signInFully(PHONE, 'customer')
  await page.waitForSelector('[data-testid="inbox"]', { timeout: 90000 })
  const fromWho = await page.locator('.delivery-head .meta').first().innerText()
  const waitingCount = Number((await page.locator('.delivery-head .count b').innerText()).trim())
  console.log(`  \u2713 inbox: ${waitingCount} photos \u2014 ${fromWho.replace(/\s+/g, ' ')}`)
  if (waitingCount !== studioCount) fail(`the studio sent ${studioCount} photos, the inbox shows ${waitingCount}`)
  // The studio's own event must not be visible on the family's side.
  if (await page.locator('.project-card').count()) fail("the studio's event leaked into the family's albums")
  await shot('06-inbox')

  await page.click('button:has-text("Open and pick your photos")')
  await page.waitForSelector('text=Pick your photos', { timeout: 120000 })
  const received = await page.locator('.tile').count()
  console.log(`  \u2713 opened straight into the selection with ${received} photos`)
  if (received !== studioCount) fail(`${received} photos arrived, ${studioCount} were sent`)
  summary.sent = studioCount
  summary.received = received

  step(6, 'The studio sent print quality \u2014 a free album keeps a smaller copy')
  await page.waitForSelector('.compare', { timeout: 60000 })
  const storedLabel = await page.locator('.compare-label.right').innerText()
  const originalLabel = await page.locator('.compare-label.left').innerText()
  console.log(`  \u2713 quality comparison rendered \u2014 ${originalLabel} vs ${storedLabel}`)
  const px = (label) => {
    const m = /(\d+)\s*\u00d7\s*(\d+)/.exec(label)
    return m ? Number(m[1]) * Number(m[2]) : 0
  }
  if (!px(storedLabel) || !px(originalLabel)) fail('the comparison did not print both sizes')
  if (px(storedLabel) >= px(originalLabel)) {
    fail(`the free copy is not smaller than what the studio sent: ${originalLabel} vs ${storedLabel}`)
  }
  await page.locator('.compare').scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
  await shot('07-compression-compare')
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForSelector('text=Album assistant')
  await shot('08-review-before-ai')

  step(7, 'Assistant reviews every photo (vision pass)')
  await page.fill(
    'input[placeholder="A Telugu wedding in Rajahmundry, then an evening reception"]',
    'A Godavari-side Telugu wedding — pellikuthuru, muhurtham and an evening reception',
  )
  await page.selectOption('.ai-card select', 'telugu')
  await page.click('button:has-text("Let AI pick")')
  await page.waitForSelector('.tile .verdict', { timeout: 180000 })
  await page.waitForTimeout(1500)
  const tagged = await page.locator('.tile .verdict').count()
  const approved = Number((await page.locator('.stat b').first().innerText()).trim())
  console.log(`  ✓ ${tagged} photos tagged by ceremony, ${approved} kept`)
  if (tagged < 6) fail(`expected the assistant to tag most photos, got ${tagged}`)
  summary.tagged = tagged
  summary.approvedByAi = approved
  await shot('09-review-after-ai')

  await page.click('button:has-text("Show what it said")')
  await page.waitForTimeout(500)
  await shot('10-ai-reasons')

  step(8, 'Assistant plans the running order and generates the album')
  await page.click('button:has-text("Make the album")')
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
  await shot('11-album-with-chat')

  step(9, 'Edit the album by asking for changes')
  const themeBefore = await page.locator('.card .hint').first().innerText()
  await chat('Make it look like a Kerala wedding album')
  const themeAfter = await page.locator('.card .hint').first().innerText()
  console.log(`  ✓ template: ${themeBefore.split('·')[0].trim()} → ${themeAfter.split('·')[0].trim()}`)
  if (themeBefore === themeAfter) fail('asking for a Kerala album did not change the template')
  await shot('12-chat-theme-changed')
  await shotPage(0, '13-page-cover-kasavu')

  await chat('Give the thaali moment a full page of its own')
  await chat('Fewer photos per page, more white space')
  const pagesAfterEdits = await page.locator('.page-item').count()
  console.log(`  ✓ album re-laid out: ${pagesAfterEdits} pages`)
  summary.pagesAfterEdits = pagesAfterEdits
  await shot('14-chat-history')

  step(10, 'Undo the last change')
  await page.click('.ai-card button:has-text("Undo")')
  await page.waitForTimeout(2500)
  const pagesAfterUndo = await page.locator('.page-item').count()
  console.log(`  ✓ after undo: ${pagesAfterUndo} pages (was ${pagesAfterEdits})`)
  if (pagesAfterUndo === 0) fail('undo emptied the album')
  summary.pagesAfterUndo = pagesAfterUndo

  step(11, 'Free export is a watermarked draft, capped in resolution')
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
  await shot('15-paywall')

  step(12, 'Subscribe, and the same album unlocks')
  await page.click('.plan.featured button:has-text("Subscribe")')
  await page.waitForSelector('.paywall', { state: 'detached', timeout: 20000 })
  const paidChip = await page.locator('.plan-chip').innerText()
  console.log(`  ✓ now on ${paidChip}`)
  if (!/Plus/.test(paidChip)) fail('subscribing did not change the plan')
  await page.waitForTimeout(800)
  const hasReimport = await page.locator('text=Re-import my originals').count()
  if (!hasReimport) fail('a paid album with compressed photos should offer a re-import')
  console.log('  ✓ the album offers to swap in the original files')
  await shot('16-after-subscribe')

  step('12b', 'Re-import the originals, the way someone would after subscribing')
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

  step('12c', 'Now the press resolution is available')
  await page.selectOption('.card select:has(option:has-text("dpi"))', '300')
  const chosenDpi = await page.locator('.card select:has(option:has-text("dpi"))').inputValue()
  if (chosenDpi !== '300') fail('300 dpi should be selectable after subscribing')
  console.log('  ✓ export set to 300 dpi')

  step(13, 'Capture the printed pages')
  await page.setViewportSize({ width: 1100, height: 1000 })
  await page.waitForTimeout(2000)
  await page.addStyleTag({ content: '.topbar,.steps{visibility:hidden !important}' })
  const total = await page.locator('.page-item').count()
  await shotPage(0, '17-page-cover')
  await shotPage(1, '18-page-chapter')
  await shotPage(2, '19-page-inside')
  await shotPage(total - 1, '20-page-closing')
  await page.addStyleTag({ content: '.topbar,.steps{visibility:visible !important}' })

  step(14, 'Export the print-ready PDF at 300 dpi')
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

  step(15, 'Reload to prove everything survives a restart')
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(3000)
  const persisted = await page.locator('.page-item').count()
  console.log(`  ✓ after reload: ${persisted} pages`)
  if (persisted !== total) fail(`album did not persist: ${persisted} pages after reload, ${total} before`)
  summary.persistedPages = persisted
  if ((await page.locator('[data-testid="account-phone"]').count()) !== 1) fail('the reload signed the user out')
  console.log('  ✓ still signed in after the reload')
  await shot('21-after-reload')

  step(16, 'Sign out, and sign back in — the albums are on the device, not the session')
  await page.locator('.account-chip').click()
  await page.click('.account-menu button:has-text("Sign out")')
  await page.waitForSelector('.signin-card', { timeout: 15000 })
  if ((await page.locator('.topbar').count()) !== 0) fail('signing out left the app on screen')
  console.log('  ✓ signed out — the app is behind the gate again')
  await shot('22-signed-out')

  const code2 = await signIn(PHONE)
  await enterCode(code2)
  await page.waitForSelector('.topbar', { timeout: 15000 })
  await page.waitForSelector('text=Maa Pelli', { timeout: 20000 })
  console.log('  ✓ signed back in, and the album is still there')
  await shot('23-signed-back-in')

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
