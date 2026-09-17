/* Renders every album template's cover, as the app itself draws them, into one
   contact sheet: demo-output/templates.png. */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const ROOT = resolve(new URL('..', import.meta.url).pathname)
const OUT = join(ROOT, 'demo-output')
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
  await page.click('text=+ New album')
  await page.fill('input[placeholder="Maa Pelli"]', 'Maa Pelli')
  await page.fill('input[placeholder="Sireesha & Karthik"]', 'Sireesha  ·  Karthik')
  await page.click('text=Create album')
  await page.waitForSelector('text=Add photos')
  await page.click('text=Add sample photos')
  await page.waitForSelector('text=Just added', { timeout: 120000 })
  await page.click('text=Next: review & finalize →')
  await page.click('button:has-text("✓ Keep all")')
  await page.waitForTimeout(600)
  await page.click('button:has-text("Confirm")')
  await page.waitForSelector('text=Album template', { timeout: 60000 })

  // Every cover is drawn by the real painter, so give them time to paint.
  await page.waitForTimeout(12000)
  const count = await page.locator('.theme-card').count()
  await page.locator('.theme-grid').screenshot({ path: join(OUT, 'templates.png') })
  console.log(`${count} templates rendered to demo-output/templates.png`)
} finally {
  await browser.close()
  server.kill()
}
