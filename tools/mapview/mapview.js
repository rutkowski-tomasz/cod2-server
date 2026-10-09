#!/usr/bin/env node
// CoD2 map viewer: builds a standalone HTML page, renders screenshots headlessly, prints bounds, entities and materials.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, basename, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createSearch } from '../shared/assets.js'
import { inlineModules } from '../shared/inline.js'
import { loadScene, buildBundle } from './bundle.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', '..', 'out', 'mapview')
const LIBRARY_IWDS = join(homedir(), 'Dev/nl-cod2-library/src/iwds')
const LIBRARY_SCRIPTS = join(homedir(), 'Dev/nl-cod2-library/src/scripts')
// The dev server's livemap relay (stacks/livemap).
const RELAY = 'ws://mynl.pl:28970'
const USAGE = `usage:
  mapview.js view   <map> [-o out.html] [--open] [view options]   build an interactive page
  mapview.js render <map> [-o out.png] [view options]             headless screenshot
  mapview.js render <map> --batch shots.json [-o dir]             one screenshot per entry, one browser
  mapview.js info   <map> [--json]                                bounds, entities, materials, missing assets
  mapview.js list   [name prefix]                                 compiled maps found in the sources
  mapview.js live   [relay] [--port 8643] [--open] [view options]  serve the map a server plays, with its players moving; entities start off

<map>: a .map, .d3dbsp or .iwd file, a stock name like mp_harbor, or an nl-cod2-library name like mp_square

options:
  --source <dir|iwd>   extra asset source, repeatable; mod folders beat stock
  --prefabs <dir>      where misc_prefab paths resolve, repeatable (.map)
  --size 1280x720      image size (render); a batch shot can set its own size

view options:
  --pos x,y,z          eye position             --angles pitch,yaw,roll   CoD view angles
  --at <selector>      eye 60 units above an entity: classname, key=value or #index; [n] picks the n-th match
  --look x,y,z         aim at a point           --fov 80                  horizontal field of view
  --top                orthographic top-down    --center x,y --span u     top view window
  --cut z              hide everything above z
  --labels off|all     --ents off   --tex off   --lightmap off   --normals off   --shadows off
  --fog off   --grid   --tools
  --live ws://…        draw the players a livemap relay streams; live sets it to its relay (default ${RELAY})`

const VIEW_KEYS = ['pos', 'angles', 'at', 'look', 'fov', 'top', 'center', 'span', 'cut', 'labels', 'ents', 'tex', 'lightmap', 'normals', 'shadows', 'fog', 'grid', 'tools', 'live']
const FLAGS = ['open', 'json', 'top', 'grid', 'tools']

const args = process.argv.slice(2)
const cmd = args.shift()
const opts = { source: [], prefabs: [] }
const positional = []
while (args.length) {
  const a = args.shift()
  if (a === '-o') opts.out = args.shift()
  else if (a === '--source' || a === '--prefabs') opts[a.slice(2)].push(args.shift())
  else if (FLAGS.includes(a.slice(2))) opts[a.slice(2)] = true
  else if (a.startsWith('--')) opts[a.slice(2)] = args.shift()
  else positional.push(a)
}

const search = searchFor(['list', 'live'].includes(cmd) ? null : positional[0])
const sceneOptions = { prefabRoots: opts.prefabs, scriptDir: LIBRARY_SCRIPTS, withPlayer: cmd === 'live' || opts.live !== undefined }

switch (cmd) {
  case 'view': view(); break
  case 'render': await render(); break
  case 'info': info(); break
  case 'list': list(); break
  case 'live': live(); break
  default: console.error(USAGE); process.exit(1)
}

function target() {
  if (!positional[0]) { console.error(USAGE); process.exit(1) }
  return positional[0]
}

// A map's iwd also holds its textures, so it is a source too.
function searchFor(name) {
  const iwd = targetIwd(name)
  return createSearch([...opts.source, ...(iwd ? [iwd] : [])])
}

// A bare name that is not a file can be an nl-cod2-library map.
function targetIwd(name) {
  if (!name) return null
  if (name.endsWith('.iwd')) return name
  const iwd = join(LIBRARY_IWDS, `${name}.iwd`)
  return !existsSync(name) && existsSync(iwd) ? iwd : null
}

function outName(ext) {
  const out = opts.out ?? join(OUT, `${basename(target()).replace(/\.(map|d3dbsp|iwd)$/, '')}.${ext}`)
  mkdirSync(dirname(out), { recursive: true })
  return out
}

function viewOf(o) {
  return Object.fromEntries(VIEW_KEYS.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]))
}

// three.js ships as two ES modules; the page imports them from data URLs, since file:// pages cannot import files.
function threeUrl() {
  const dir = join(HERE, 'node_modules', 'three', 'build')
  const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  const core = dataUrl(readFileSync(join(dir, 'three.core.js'), 'utf8'))
  return dataUrl(readFileSync(join(dir, 'three.module.js'), 'utf8').replaceAll("'./three.core.js'", JSON.stringify(core)))
}

// Command line view options are baked into the page as defaults; URL hash params still override them.
function buildHtml(bundle, defaults) {
  return readFileSync(join(HERE, 'viewer.html'), 'utf8')
    .replace('__THREE__', threeUrl)
    .replace('__SCRIPT__', () => inlineModules(HERE, 'viewer.js'))
    .replace('__BUNDLE__', () => JSON.stringify({ ...bundle, defaults }).replace(/</g, '\\u003c'))
}

function load() {
  const bundle = buildBundle(target(), search, sceneOptions)
  reportMissing(bundle)
  return bundle
}

function view() {
  const out = outName('html')
  writeFileSync(out, buildHtml(load(), viewOf(opts)))
  console.log(out)
  if (opts.open) execFileSync('open', [out])
}

async function render() {
  const bundle = load()
  const shots = opts.batch ? JSON.parse(readFileSync(opts.batch, 'utf8')) : [{ ...viewOf(opts), out: outName('png') }]
  const outDir = opts.batch ? opts.out ?? OUT : dirname(shots[0].out)
  mkdirSync(outDir, { recursive: true })
  const html = join(outDir, `${opts.batch ? bundle.name : basename(shots[0].out, '.png')}.html`)
  writeFileSync(html, buildHtml(bundle, opts.batch ? {} : viewOf(opts)))
  const viewport = (size) => { const [width, height] = size.split('x').map(Number); return { width, height } }
  const defaultSize = opts.size ?? '1280x720'
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  try {
    const page = await browser.newPage({ viewport: viewport(defaultSize) })
    page.on('pageerror', (e) => console.error('page error:', e.message))
    await page.goto(pathToFileURL(html).href)
    await page.waitForFunction('window.mapReady || window.mapError', null, { timeout: 180000 })
    const error = await page.evaluate('window.mapError')
    if (error) throw new Error(`page: ${error}`)
    for (const shot of shots) {
      const out = resolve(outDir, shot.out ?? `${shot.name ?? 'shot'}.png`)
      await page.setViewportSize(viewport(shot.size ?? defaultSize))
      const cam = await page.evaluate((p) => window.mapview.apply(p), { ...viewOf(shot), hud: 'off' })
      await page.screenshot({ path: out })
      console.log(`${out}  ${cam.top ? 'top view' : `pos ${cam.pos.join(',')} angles ${cam.angles.join(',')} fov ${cam.fov}`}`)
    }
  } finally {
    await browser.close()
  }
}

// Serves the page of the map the relay's server plays, built once per map; the page reloads itself when the map changes.
// Entity markers start off, so spawn labels do not bury the players.
function live() {
  const relay = positional[0] ?? RELAY
  const port = +(opts.port ?? 8643)
  let map = null
  let page = null
  follow()
  createServer((req, res) => {
    if (req.url !== '/') return res.writeHead(404).end()
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html())
  }).listen(port, () => {
    const address = `http://localhost:${port}/`
    console.log(`${address}  following ${relay}`)
    if (opts.open) execFileSync('open', [address])
  })

  function follow() {
    const ws = new WebSocket(relay)
    ws.onmessage = (e) => {
      const next = JSON.parse(e.data).map
      if (next !== map) console.log(`server map: ${next}`)
      map = next
    }
    ws.onclose = () => setTimeout(follow, 2000)
  }

  // A map missing from the local sources, such as a library map not pulled yet, waits like no map at all.
  function html() {
    if (!map) return waitingPage(`waiting for a map from ${relay}`)
    if (page?.map !== map) {
      try {
        const bundle = buildBundle(map, searchFor(map), sceneOptions)
        reportMissing(bundle)
        page = { map, html: buildHtml(bundle, { ents: 'off', ...viewOf(opts), live: relay }) }
      } catch (e) {
        return waitingPage(`${map}: ${e.message}`)
      }
    }
    return page.html
  }
}

function waitingPage(text) {
  const escaped = text.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`)
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="3"><title>mapview live</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#202830;color:#e8ecf0;font:12px ui-monospace,Menlo,monospace">${escaped}`
}

function info() {
  const { scene: s } = loadScene(target(), search, sceneOptions)
  if (opts.json) { console.log(JSON.stringify({ ...s, surfaces: undefined, player: s.player?.classname }, null, 2)); return }
  const r = (v) => v.map((x) => Math.round(x)).join(' ')
  console.log(`${s.name} (${s.kind}) ${s.path}`)
  console.log(`bounds: min ${r(s.bounds.min)}  max ${r(s.bounds.max)}  size ${r([0, 1, 2].map((i) => s.bounds.max[i] - s.bounds.min[i]))}`)
  console.log(`surfaces: ${s.surfaces.length}  models: ${Object.keys(s.models).length}  lightmaps: ${s.lightmapCount}  sky: ${s.materials.find((m) => m.sky)?.image ?? '-'}`)
  const ws = Object.entries(s.worldspawn).filter(([k]) => k !== 'classname').map(([k, v]) => `${k}=${v}`).join(' ')
  if (ws) console.log(`worldspawn: ${ws}`)
  if (s.fog) console.log(`fog: ${s.fog.kind === 'exp' ? `exp density ${s.fog.density}` : `cull ${s.fog.near}-${s.fog.far}`} color ${s.fog.color.join(' ')}`)
  console.log('\nentities:')
  const byClass = Map.groupBy(s.entities, (e) => e.classname)
  for (const [cls, list] of [...byClass].sort((a, b) => b[1].length - a[1].length)) {
    const sample = list.filter((e) => e.origin).slice(0, 3).map((e) => `#${e.index}${e.keys.targetname ? `[${e.keys.targetname}]` : ''} ${r(e.origin)}${e.angles ? ` @${r(e.angles)}` : ''}`).join(', ')
    console.log(`  ${String(list.length).padStart(4)}  ${cls}${sample ? `  ${sample}${list.length > 3 ? ', …' : ''}` : ''}`)
  }
  console.log('\nmaterials:')
  for (const m of s.materials) {
    const flags = [m.sky && 'sky', m.tool && 'tool'].filter(Boolean).join(' ')
    console.log(`  ${m.name.padEnd(40)} ${m.width ? `${m.image} ${m.width}x${m.height}` : ''} ${flags}`)
  }
  reportMissing(s)
}

function list() {
  const prefix = positional[0] ?? ''
  for (const n of search.list('maps/')) if (n.endsWith('.d3dbsp') && basename(n).startsWith(prefix)) console.log(n)
  if (existsSync(LIBRARY_IWDS)) for (const f of readdirSync(LIBRARY_IWDS).sort()) if (f.endsWith('.iwd') && f.startsWith(prefix)) console.log(join(LIBRARY_IWDS, f))
}

function reportMissing(scene) {
  const missing = scene.materials.filter((m) => m.missing && !m.tool)
  if (missing.length) console.log(`missing images: ${missing.map((m) => `${m.name} ${m.missing}`).join(', ')}`)
  if (scene.boxModels.length) console.log(`models drawn as boxes (missing, skinned or bone-bound): ${scene.boxModels.join(', ')}`)
  if (scene.missingPlayer) console.log(`${scene.missingPlayer.classname} drawn as spawn boxes: one of ${scene.missingPlayer.files.join(', ')} is missing or unreadable`)
  if (scene.missingPrefabs.length) console.log(`missing prefabs: ${scene.missingPrefabs.join(', ')} (use --prefabs <dir>)`)
}
