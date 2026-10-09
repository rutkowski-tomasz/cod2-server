// HTTP server: viewer static files plus scene, texture, lightmap and sky endpoints.
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildScene, resolveMap } from './scene.js'
import { encodePng } from './png.js'

const root = path.dirname(fileURLToPath(import.meta.url))
const viewerDir = path.join(root, '..', 'viewer')
const threeDir = path.join(root, '..', 'node_modules', 'three', 'build')
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }

export function createServer({ assets, prefabRoots = [], cacheDir = path.join(os.homedir(), '.cache', 'cod2-mapview'), texSize = 512, log = () => {} }) {
  fs.mkdirSync(cacheDir, { recursive: true })
  const scenes = new Map()

  function scene(spec) {
    const src = resolveMap(spec, assets)
    const stamp = fs.existsSync(src.file) ? fs.statSync(src.file).mtimeMs : 0
    const key = src.file
    const hit = scenes.get(key)
    if (hit && hit.stamp === stamp) return hit.scene
    const t0 = Date.now()
    const built = buildScene(src, assets, { prefabRoots })
    built.encoded = built.encode()
    built.stamp = stamp
    scenes.set(key, { stamp, scene: built })
    log(`scene ${src.name}: ${built.json.surfaces.length} surfaces, ${built.json.materials.length} materials, ${Date.now() - t0} ms`)
    if (built.json.missingPrefabs.length) log(`missing prefabs: ${built.json.missingPrefabs.join(', ')} (use --prefabs <dir>)`)
    const missing = built.json.materials.filter((m) => m.missing).map((m) => m.name)
    if (missing.length) log(`missing materials: ${missing.join(', ')}`)
    return built
  }

  function cachedPng(key, make) {
    const file = path.join(cacheDir, key.replace(/[^a-z0-9_.-]/gi, '_') + '.png')
    if (fs.existsSync(file)) return fs.readFileSync(file)
    const img = make()
    if (!img) return null
    const png = encodePng(img.width, img.height, img.rgba)
    fs.writeFileSync(file, png)
    return png
  }

  const texturePng = (name) => cachedPng(`tex_${texSize}_${name}`, () => {
    const img = assets.texture(name)
    return img && downscale(img, texSize)
  })

  const skyPng = (base, face) => cachedPng(`sky_${texSize}_${base}_${face}`, () => {
    const img = assets.image(`${base}_ft`)
    if (!img || !img.faces) return null
    return downscale({ width: img.width, height: img.height, rgba: img.faces[face] }, texSize)
  })

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    try {
      if (url.pathname === '/' || url.pathname === '/index.html') return serveFile(res, path.join(viewerDir, 'index.html'))
      if (url.pathname.startsWith('/viewer/')) return serveFile(res, path.join(viewerDir, url.pathname.slice(8)))
      if (url.pathname.startsWith('/three/')) return serveFile(res, path.join(threeDir, url.pathname.slice(7)))
      if (url.pathname === '/api/scene') return send(res, scene(url.searchParams.get('map')).encoded, 'application/octet-stream')
      if (url.pathname === '/api/info') return send(res, JSON.stringify(scene(url.searchParams.get('map')).json), 'application/json')
      if (url.pathname === '/api/texture') {
        const png = texturePng(url.searchParams.get('name'))
        return png ? send(res, png, 'image/png') : notFound(res)
      }
      if (url.pathname === '/api/sky') {
        const png = skyPng(url.searchParams.get('name'), +url.searchParams.get('face'))
        return png ? send(res, png, 'image/png') : notFound(res)
      }
      if (url.pathname === '/api/lightmap') {
        const s = scene(url.searchParams.get('map'))
        const block = s.lightmaps[+url.searchParams.get('index')]
        const page = +(url.searchParams.get('page') || 0)
        if (!block || page < 0 || page > 3) return notFound(res)
        const png = cachedPng(`lm_${s.json.name}_${s.stamp}_${url.searchParams.get('index')}_${page}`, () => lightmapImage(block, page))
        return send(res, png, 'image/png')
      }
      notFound(res)
    } catch (e) {
      log(`error ${req.url}: ${e.message}`)
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end(e.stack || String(e))
    }
  })
  server.scene = scene
  return server
}

// A lightmap block holds four 512x512 RGBA pages: directional coefficients for R, G and B, then sun visibility.
function lightmapImage(block, page) {
  const size = 512
  const bytes = size * size * 4
  return { width: size, height: size, rgba: new Uint8Array(block.buffer, block.byteOffset + page * bytes, bytes) }
}

function downscale(img, max) {
  if (img.width <= max && img.height <= max) return img
  const f = Math.ceil(Math.max(img.width, img.height) / max)
  const w = Math.max(1, Math.floor(img.width / f)), h = Math.max(1, Math.floor(img.height / f))
  const out = new Uint8Array(w * h * 4)
  const n = f * f
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0
    for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) {
      const i = ((y * f + dy) * img.width + x * f + dx) * 4
      r += img.rgba[i]; g += img.rgba[i + 1]; b += img.rgba[i + 2]; a += img.rgba[i + 3]
    }
    const o = (y * w + x) * 4
    out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n
  }
  return { width: w, height: h, rgba: out }
}

function serveFile(res, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return notFound(res)
  send(res, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream')
}

function send(res, body, type) {
  res.writeHead(200, { 'content-type': type, 'content-length': body.length, 'cache-control': 'no-cache' })
  res.end(body)
}

function notFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('not found')
}

export function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server.address().port))
  })
}
