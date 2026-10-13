// Loads a model file with page.js in headless Chrome. The page reads files by absolute path through a made-up
// origin, so a model can name files in folders above its own; every other request is refused.
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const HERE = import.meta.dirname
const ORIGIN = 'http://modelimport.local'
const THREE = join(HERE, 'node_modules', 'three')
const fsUrl = (path) => `${ORIGIN}/fs${path.split('/').map(encodeURIComponent).join('/')}`
const PAGE = `<script type="importmap">{"imports":{"three":"${fsUrl(join(THREE, 'build/three.module.js'))}","three/addons/":"${fsUrl(join(THREE, 'examples/jsm'))}/"}}</script>
<script type="module" src="${fsUrl(join(HERE, 'page.js'))}"></script>`

export async function loadModel(file) {
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage()
    page.on('pageerror', (e) => console.error('page error:', e.message))
    await page.route('**', (route) => route.abort())
    await page.route(`${ORIGIN}/**`, (route) => {
      const path = decodePath(route.request().url())
      if (path === '/') return route.fulfill({ contentType: 'text/html', body: PAGE })
      if (!path?.startsWith('/fs/')) return route.fulfill({ status: 404 })
      const target = path.slice('/fs'.length)
      if (!existsSync(target) || !statSync(target).isFile()) return route.fulfill({ status: 404 })
      route.fulfill({ body: readFileSync(target), contentType: target.endsWith('.js') ? 'text/javascript' : undefined })
    })
    await page.goto(`${ORIGIN}/`)
    await page.waitForFunction('window.loadModel')
    return await page.evaluate(([model, draco]) => window.loadModel(model, draco), [fsUrl(file), `${fsUrl(join(THREE, 'examples/jsm/libs/draco/gltf'))}/`])
  } finally {
    await browser.close()
  }
}

// FBX files name textures unencoded, so a name such as `50%_rust.png` cannot be decoded; it is then not found.
function decodePath(url) {
  try {
    return decodeURIComponent(new URL(url).pathname)
  } catch {
    return null
  }
}
