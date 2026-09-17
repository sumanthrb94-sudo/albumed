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

  const signInAs = async (phone, role) => {
    await page.waitForSelector('.signin-card')
    await page.click(role === 'studio' ? '.role-pick button:has-text("I am the studio")' : '.role-pick button:has-text("I am the family")')
    await page.fill('input[aria-label="Mobile number"]', phone)
    await page.click('button:has-text("Send code")')
    await page.waitForSelector('[data-testid="demo-otp"]')
    await page.fill('input[aria-label="One time code"]', (await page.locator('[data-testid="demo-otp"]').innerText()).trim())
    await page.click('button:has-text("Sign in")')
    await page.waitForSelector('.topbar', { timeout: 20000 })
  }

  /* ---- the studio's half ---- */

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('.signin-card')
  await page.click('.role-pick button:has-text("I am the studio")')
  await page.fill('input[aria-label="Mobile number"]', '90000 11122')
  await shot('Entry — sign in as the studio or as the family')

  await page.click('button:has-text("Send code")')
  await page.waitForSelector('[data-testid="demo-otp"]')
  await shot('The one-time code — shown on screen, because no SMS is sent')

  await page.fill('input[aria-label="One time code"]', (await page.locator('[data-testid="demo-otp"]').innerText()).trim())
  await page.click('button:has-text("Sign in")')
  await page.waitForSelector('text=Send the take to the family')
  await shot('The studio side — send the take to the family')

  // A studio cannot send what it did not keep, so it is on a studio plan.
  await page.click('.plan-chip')
  await page.waitForSelector('.paywall')
  await page.click('.plan[data-plan="studio"] button:has-text("Subscribe")')
  await page.waitForSelector('.paywall', { state: 'detached', timeout: 20000 })

  await page.click('text=+ New event')
  await page.fill('input[placeholder="Maa Pelli"]', 'Maa Pelli')
  await page.fill('input[placeholder="Sireesha & Karthik"]', 'Sireesha  ·  Karthik')
  await page.fill('input[placeholder="14 February 2026"]', '14 February 2026')
  await page.fill('input[placeholder="Kalyana Mandapam, Rajahmundry"]', 'Kalyana Mandapam, Rajahmundry')
  await shot('New event — title, hosts, date, venue and style', { full: true })

  await page.selectOption('select', 'godavari')
  await page.click('text=Create event')
  await page.waitForSelector('text=Add photos')
  await page.click('text=Add sample photos')
  await page.waitForSelector('text=Just added', { timeout: 90000 })
  await shot('The take is in — 25 photographs from the wedding', { settle: 1200 })

  await page.fill('input[aria-label="Customer mobile number 1"]', '98765 43210')
  await shot('Addressed to the family’s mobile number', { scrollTo: '.send-card', settle: 800 })
  await page.click('.send-card button:has-text("Send")')
  await page.waitForSelector('.sent-item', { timeout: 60000 })
  await shot('Sent — waiting for them to open it', { scrollTo: '.sent-list', settle: 800 })

  /* ---- the family's half ---- */

  await page.locator('.account-chip').click()
  await page.click('.account-menu button:has-text("Sign out")')
  await signInAs('98765 43210', 'customer')
  await page.waitForSelector('[data-testid="inbox"]', { timeout: 90000 })
  await shot('The family signs in and the photos are already there', { settle: 1200 })

  await page.click('button:has-text("Open and pick your photos")')
  await page.waitForSelector('text=Pick your photos', { timeout: 120000 })
  await page.waitForSelector('.compare', { timeout: 60000 })
  await shot('The studio sent print quality — a free album keeps a smaller copy', { scrollTo: '.compare', settle: 1200 })

  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForSelector('text=Album assistant')
  await shot('Review — the assistant, before it has looked')

  await page.fill(
    'input[placeholder="A Telugu wedding in Rajahmundry, then an evening reception"]',
    'A Godavari-side Telugu wedding — pellikuthuru, muhurtham and a reception',
  )
  await page.selectOption('.ai-card select', 'telugu')
  await page.click('button:has-text("Let AI pick")')
  await page.waitForSelector('.tile .verdict', { timeout: 180000 })
  await shot('Reviewed — every photo tagged by ceremony and scored', { scrollTo: '.photo-grid', settle: 1500 })

  await page.click('button:has-text("Show what it said")')
  await shot('Its reasoning, photo by photo', { scrollTo: '.reasons' })

  await page.locator('.tile').first().click()
  await page.waitForSelector('.lightbox', { timeout: 15000 })
  await shot('One photo — caption, note, and why it was kept', { settle: 1200 })
  await page.click('button:has-text("✕ Close")')

  await page.click('button:has-text("Make the album")')
  await page.waitForSelector('text=Download album PDF', { timeout: 180000 })
  await shot('The album, with the assistant ready to edit it', { settle: 3000 })

  await page.fill('input[placeholder="What would you like changed?"]', 'Make it look like a Kerala wedding album')
  await page.click('button[type="submit"]:has-text("Send")')
  await page.waitForFunction(() => document.querySelectorAll('.bubble.assistant:not(.pending)').length > 0, null, {
    timeout: 90000,
  })
  await shot('Edited by asking — template changed, pages re-flowed', { settle: 2500, scrollTo: '.chat' })

  // the template gallery — every cover painted with this album's own photograph
  await page.click('.step:has-text("Style")')
  await page.waitForSelector('.theme-grid .theme-card canvas')
  await page.setViewportSize({ width: 1100, height: 1000 })
  await page.waitForTimeout(3500)
  // The sticky action bar floats over the middle of the grid in a tall capture.
  await page.addStyleTag({ content: '.sticky-actions{visibility:hidden !important}' })
  await shot('35 album templates, each previewed with your own cover', {
    element: '.card:has(.theme-grid)',
    settle: 2000,
  })
  await page.click('.filters button:has-text("Andhra & Telangana")')
  await shot('Filtered to Andhra & Telangana — home ground', { element: '.card:has(.theme-grid)', settle: 1800 })
  await page.addStyleTag({ content: '.sticky-actions{visibility:visible !important}' })
  await page.setViewportSize({ width: 430, height: 932 })
  await page.click('.step:has-text("Album")')
  await page.waitForSelector('text=Download album PDF', { timeout: 60000 })
  await page.waitForTimeout(2500)

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
  await shot('The album saved on the device', { settle: 1200 })

  await page.locator('.account-chip').click()
  await shot('The account — signed in on this device', { settle: 400 })
  await page.click('.account-menu button:has-text("Sign out")')
  await page.waitForSelector('.signin-card')
  await shot('Exit — signed out, back at the gate', { settle: 600 })

  await writeFile(join(OUT, 'index.json'), JSON.stringify(index, null, 2))
  console.log(`\n${n} screenshots in demo-output/walkthrough/\n`)
} finally {
  await browser.close()
  server.kill()
}
