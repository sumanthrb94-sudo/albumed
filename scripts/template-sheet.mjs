/* Renders every album template's cover, as the app itself draws them, into one
   contact sheet: demo-output/templates/templates.png. */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const ROOT = resolve(new URL('..', import.meta.url).pathname)
// Its own folder: `npm run demo` clears the loose files at the top of
// demo-output, and this sheet is slow enough to be worth keeping.
const OUT = join(ROOT, 'demo-output', 'templates')
const PORT = 4325
const BASE = `http://localhost:${PORT}`

await mkdir(OUT, { recursive: true })
const server = spawn('node', ['dist-server/index.mjs'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', ALBUMED_DEMO_AI: '1' },
  stdio: ['ignore', 'ignore', 'inherit'],
})
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${BASE}/api/health`)).ok) break
  } catch {
    /* not up */
  }
  if (i > 80) throw new Error('server did not start')
  await new Promise((r) => setTimeout(r, 100))
}

const browser = await chromium.launch({
  executablePath: process.env.ALBUMED_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
})
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1200 }, deviceScaleFactor: 2 })).newPage()

try {
  await page.goto(BASE, { waitUntil: 'networkidle' })

  // The app is behind the sign-in gate now. The code is on the screen.
  await page.waitForSelector('.signin-card')
  await page.click('.role-pick button:has-text("I am the studio")')
  await page.fill('input[aria-label="Mobile number"]', '90000 11122')
  await page.click('button:has-text("Send code")')
  await page.waitForSelector('[data-testid="demo-otp"]')
  await page.fill('input[aria-label="One time code"]', (await page.locator('[data-testid="demo-otp"]').innerText()).trim())
  await page.click('button:has-text("Sign in")')
  await page.waitForSelector('.topbar', { timeout: 20000 })

  await page.click('text=+ New event')
  await page.fill('input[placeholder="Maa Pelli"]', 'Maa Pelli')
  await page.fill('input[placeholder="Sireesha & Karthik"]', 'Sireesha  ·  Karthik')
  await page.click('text=Create event')
  await page.waitForSelector('text=Add photos')
  await page.click('text=Add sample photos')
  await page.waitForSelector('text=Just added', { timeout: 120000 })
  await page.click('text=Next: pick your photos →')
  await page.click('button:has-text("✓ Keep all")')
  await page.waitForTimeout(600)
  await page.click('button:has-text("Make my album")')
  await page.waitForSelector('text=Album template', { timeout: 60000 })

  // Every cover is drawn by the real painter, so give them time to paint.
  await page.waitForTimeout(12000)
  // The sticky chrome floats across a tall capture and eats two rows of it.
  await page.addStyleTag({
    content: '.topbar,.steps,.sticky-actions,.toast{visibility:hidden !important}',
  })
  await page.waitForTimeout(300)
  const count = await page.locator('.theme-card').count()
  await page.locator('.theme-grid').screenshot({ path: join(OUT, 'templates.png') })
  console.log(`${count} templates rendered to demo-output/templates/templates.png`)
} finally {
  await browser.close()
  server.kill()
}
