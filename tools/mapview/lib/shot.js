// Headless screenshots of the viewer through Playwright's bundled Chromium.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

export function findChromium() {
  if (process.env.MAPVIEW_CHROMIUM) return process.env.MAPVIEW_CHROMIUM
  try {
    const p = chromium.executablePath()
    if (fs.existsSync(p)) return p
  } catch {}
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers', path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'), path.join(os.homedir(), '.cache', 'ms-playwright')].filter(Boolean)
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    for (const dir of fs.readdirSync(root).filter((d) => d.startsWith('chromium')).sort().reverse()) {
      for (const rel of ['chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium', 'chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-headless-shell-linux64/chrome-headless-shell']) {
        const p = path.join(root, dir, rel)
        if (fs.existsSync(p)) return p
      }
    }
    if (fs.existsSync(path.join(root, 'chromium')) && fs.statSync(path.join(root, 'chromium')).isFile()) return path.join(root, 'chromium')
  }
  throw new Error('Chromium not found. Run `npx playwright install chromium` in tools/mapview or set MAPVIEW_CHROMIUM.')
}

export async function openViewer({ port, width = 1280, height = 720 }) {
  const browser = await chromium.launch({
    executablePath: findChromium(),
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
  })
  const page = await browser.newPage({ viewport: { width, height } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()) })
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${decodeURIComponent(r.url())}`) })
  return {
    page, errors,
    async load(params) {
      const url = `http://127.0.0.1:${port}/?${new URLSearchParams({ ...params, hud: '0' })}`
      await page.goto(url)
      await page.waitForFunction(() => window.__mapview && (window.__mapview.ready || window.__mapview.error), null, { timeout: 180000 })
      const err = await page.evaluate(() => window.__mapview.error)
      if (err) throw new Error(`viewer: ${err}`)
    },
    async apply(params) {
      await page.evaluate((p) => window.__mapview.apply(p), params)
      await page.waitForFunction(() => window.__mapview.ready, null, { timeout: 180000 })
    },
    async shoot(out) {
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
      await page.screenshot({ path: out })
      return page.evaluate(() => window.__mapview.camera())
    },
    close: () => browser.close(),
  }
}
