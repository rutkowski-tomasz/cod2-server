// The server behind `mapview.js live`: it follows the relay, serves the page of the map the server plays, and the
// rigs, weapons and animations live players need, which the page fetches as they appear.
import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'
import { buildRig, buildWeapon, buildAnim } from './bundle.js'

const RECONNECT_MS = 2000
// How long `liveAssets` waits for a message.
const MESSAGE_TIMEOUT_MS = 5000

// What the live page fetches by kind and key, which a streamed player names: its rig by its models joined with
// commas, its weapon's model by the weapon's name, its legs' and torso's animations by theirs.
const ASSETS = {
  rigs: { keysOf: (p) => [p.models.join(',')], build: (key, search) => buildRig(key.split(','), search) },
  weapons: { keysOf: (p) => [p.weapon], build: buildWeapon },
  anims: { keysOf: (p) => [p.legs, p.torso], build: buildAnim },
}

// `buildPage(map, assets)` returns the page for a map with the assets its players use baked in, or throws when the
// map is missing. Each map's page is built once, and also gzipped, as pages run to 100 MB; it reloads itself when
// the map changes. A map missing from the sources, such as a library map not pulled yet, waits like no map at all.
export function serveLive({ relay, port, search, buildPage, onListen }) {
  let latest = null
  let built = null
  const cache = new Map()
  follow()
  createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/') {
      const { html, gzipped } = page()
      const gzip = gzipped && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')
      return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...(gzip && { 'content-encoding': 'gzip' }) }).end(gzip ? gzipped : html)
    }
    const kind = url.pathname.slice(1)
    const key = url.searchParams.get('key')
    // Anyone can ask, so a bad request or an unreadable asset answers 404 rather than ending the server.
    let asset = null
    try {
      asset = ASSETS[kind] && key && assetOf(kind, key, cache, search)
    } catch (e) {
      console.error(`${kind} ${key}: ${e.message}`)
    }
    res.writeHead(asset ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify(asset ?? null))
  }).listen(port, () => onListen(`http://localhost:${port}/`))

  function follow() {
    const ws = new WebSocket(relay)
    ws.onmessage = (e) => {
      const next = JSON.parse(e.data)
      if (next.map !== latest?.map) console.log(`server map: ${next.map}`)
      latest = next
    }
    ws.onclose = () => setTimeout(follow, RECONNECT_MS)
  }

  function page() {
    if (!latest) return { html: waitingPage(`waiting for a map from ${relay}`) }
    const { map } = latest
    if (built?.map !== map) {
      try {
        const html = buildPage(map, assetsOf(latest.players, cache, search))
        built = { map, html, gzipped: gzipSync(html) }
      } catch (e) {
        return { html: waitingPage(`${map}: ${e.message}`) }
      }
    }
    return built
  }
}

// The assets the relay's players use right now, for a page that cannot fetch them, as a file page; none when no
// message comes within MESSAGE_TIMEOUT_MS.
export async function liveAssets(relay, search) {
  const msg = await new Promise((resolve) => {
    const ws = new WebSocket(relay)
    const done = (m) => { ws.close(); resolve(m) }
    ws.onmessage = (e) => done(JSON.parse(e.data))
    setTimeout(() => done(null), MESSAGE_TIMEOUT_MS)
  })
  return assetsOf(msg?.players, new Map(), search)
}

// Built once per kind and key into `cache`; null when it cannot be built.
function assetOf(kind, key, cache, search) {
  const id = `${kind}/${key}`
  if (!cache.has(id)) cache.set(id, ASSETS[kind].build(key, search))
  return cache.get(id)
}

// Every asset `players` use, as { rigs: { key: asset }, weapons: …, anims: … }, to bake into a page.
function assetsOf(players, cache, search) {
  const out = {}
  for (const [kind, { keysOf }] of Object.entries(ASSETS)) {
    out[kind] = {}
    for (const p of Object.values(players ?? {})) for (const key of keysOf(p)) out[kind][key] = assetOf(kind, key, cache, search)
  }
  return out
}

function waitingPage(text) {
  const escaped = text.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`)
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="3"><title>mapview live</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#202830;color:#e8ecf0;font:12px ui-monospace,Menlo,monospace">${escaped}`
}
