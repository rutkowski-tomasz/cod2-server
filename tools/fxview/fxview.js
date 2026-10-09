#!/usr/bin/env node
// CoD2 .efx viewer: builds a standalone HTML player, renders frames headlessly, prints effect info.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createSearch } from './assets.js'
import { buildBundle } from './bundle.js'
import { inlineModules } from './inline.js'
import { createSim, FORWARD } from './sim.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const USAGE = `usage:
  fxview.js view   <efx-file | fx/path> [-o out.html] [--open]     build a standalone player page
  fxview.js render <efx-file | fx/path> [-o out.png] [options]      headless frames into one contact sheet
  fxview.js info   <efx-file | fx/path> [--json]                    elements, materials, duration, particle counts
  fxview.js list   [prefix]                                         fx paths found in the sources

options:
  --source <dir|iwd>   extra asset source, repeatable; mod folders beat stock
  --times 50,200,500   frame times in ms (render); default: --frames spread over the active duration, denser early
  --frames 8           number of evenly spaced frames (render)
  --cols 4             sheet columns (render)
  --size 480x360       frame size (render)
  --cam yaw,pitch,dist camera; default fits the effect
  --forward x|z|-z|-x  effect forward axis (default z: pointing up, like playFx without a forward vector or an explosion on the ground; x: level, like a muzzle)
  --seed 1             random seed
  --ground off         no ground plane
  --bg dark|mid|light|black
  --ranges off         ignore spawnRange and cullrange
  --stats              also write <out>.json with per-frame particle counts and warnings (render)`

const args = process.argv.slice(2)
const cmd = args.shift()
const opts = { source: [] }
const positional = []
while (args.length) {
  const a = args.shift()
  if (a === '-o') opts.out = args.shift()
  else if (a === '--source') opts.source.push(args.shift())
  else if (a === '--open' || a === '--json' || a === '--stats') opts[a.slice(2)] = true
  else if (a.startsWith('--')) opts[a.slice(2)] = args.shift()
  else positional.push(a)
}

if (opts.forward && !FORWARD[opts.forward]) { console.error(USAGE); process.exit(1) }
const search = createSearch(opts.source)

switch (cmd) {
  case 'view': view(); break
  case 'render': await render(); break
  case 'info': info(); break
  case 'list': list(); break
  default: console.error(USAGE); process.exit(1)
}

function target() {
  if (!positional[0]) { console.error(USAGE); process.exit(1) }
  return positional[0]
}

function outName(ext) {
  const name = basename(target(), '.efx')
  const out = opts.out ?? join(HERE, 'out', `${name}.${ext}`)
  mkdirSync(dirname(out), { recursive: true })
  return out
}

// Command line options are baked into the page as defaults; URL hash params still override them.
function buildHtml(bundle) {
  const defaults = Object.fromEntries(['forward', 'seed', 'ground', 'bg', 'cam', 'ranges'].filter((k) => opts[k] !== undefined).map((k) => [k, opts[k]]))
  return readFileSync(join(HERE, 'viewer.html'), 'utf8')
    .replace('__SCRIPT__', () => inlineModules(HERE, 'viewer.js'))
    .replace('__BUNDLE__', () => JSON.stringify({ ...bundle, defaults }).replace(/<\//g, '<\\/'))
}

function view() {
  const bundle = buildBundle(target(), search)
  const out = outName('html')
  writeFileSync(out, buildHtml(bundle))
  console.log(out)
  reportMissing(bundle)
  if (opts.open) execFileSync('open', [out])
}

async function render() {
  const bundle = buildBundle(target(), search)
  const out = outName('png')
  const html = join(dirname(out), `${basename(out, '.png')}.html`)
  writeFileSync(html, buildHtml(bundle))
  const [width, height] = (opts.size ?? '480x360').split('x').map(Number)
  const cols = Number(opts.cols ?? 4)
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  try {
    const page = await browser.newPage({ viewport: { width: cols * width + 260, height: Math.max(600, height * 2) } })
    page.on('pageerror', (e) => console.error('page error:', e.message))
    await page.goto(pathToFileURL(html).href)
    await page.waitForFunction('window.efxReady', null, { timeout: 60000 })
    const result = await page.evaluate(({ times, frames, cols, width, height }) => {
      const info = window.efx.info()
      const span = info.activeDuration
      // Denser early: most effects burst in the first tenth of their life.
      const list = times ?? Array.from({ length: frames }, (_, i) => Math.round(span * ((i + 1) / frames) ** 2))
      return { ...window.efx.capture({ times: list, cols, width, height }), info }
    }, { times: opts.times ? opts.times.split(',').map(Number) : null, frames: Number(opts.frames ?? 8), cols, width, height })
    writeFileSync(out, Buffer.from(result.png.split(',')[1], 'base64'))
    console.log(out)
    const stats = { target: bundle.root, ...result.info, frames: result.frames }
    if (opts.stats) {
      const json = join(dirname(out), `${basename(out, '.png')}.json`)
      writeFileSync(json, JSON.stringify(stats, null, 2))
      console.log(json)
    }
    for (const w of result.info.warnings) console.log(`warning: ${w}`)
    reportMissing(bundle)
  } finally {
    await browser.close()
  }
}

function info() {
  const bundle = buildBundle(target(), search)
  const sim = createSim(bundle, { seed: Number(opts.seed ?? 1), forward: opts.forward, ground: opts.ground === 'off' ? null : 0 })
  const bounds = sim.bounds()
  const samples = []
  for (const t of [50, 100, 250, 500, 1000, 2000, 5000, 10000]) {
    if (t > sim.duration) break
    sim.seek(t)
    samples.push({ t, counts: sim.counts() })
  }
  const data = { root: bundle.root, duration: sim.duration, activeDuration: sim.activeDuration, bounds, missing: bundle.missing, warnings: [...sim.warnings], effects: {}, materials: {}, samples }
  for (const [path, e] of Object.entries(bundle.effects)) data.effects[path] = e.elements.map(({ curves, scales, sequence, ...rest }) => rest)
  for (const [name, m] of Object.entries(bundle.materials)) data.materials[name] = { image: m.image, techset: m.techset, blend: m.blend, atlas: `${m.atlasCols}x${m.atlasRows}`, size: `${m.width}x${m.height}` }
  if (opts.json) { console.log(JSON.stringify(data, null, 2)); return }
  console.log(`${data.root}: ${Object.keys(bundle.effects).length} effect(s), ${sim.duration} ms (active ${sim.activeDuration} ms), bounds ${bounds.lo.map(Math.round)} .. ${bounds.hi.map(Math.round)}`)
  for (const [path, els] of Object.entries(data.effects)) {
    console.log(`\n${path}`)
    for (const e of els) console.log(`  ${e.type.padEnd(17)} ${e.name.padEnd(28)} count ${e.count.join('-')}  delay ${e.delay.join('-')}  life ${e.life.join('-')}  ${e.shaders.join(',')}${e.models.length ? ' models:' + e.models.join(',') : ''}${e.playfx ? ' → ' + e.playfx : ''}${e.emitfx ? ' emit ' + e.emitfx : ''}${e.impactfx ? ' impact ' + e.impactfx : ''}`)
  }
  console.log('\nmaterials')
  for (const [n, m] of Object.entries(data.materials)) console.log(`  ${n.padEnd(28)} ${m.blend.padEnd(10)} ${m.atlas.padEnd(4)} ${m.size.padEnd(9)} ${m.techset}`)
  for (const s of samples) console.log(`t=${s.t}: ${Object.entries(s.counts).map(([k, v]) => `${k}=${v}`).join(' ')}`)
  reportMissing(bundle)
}

function list() {
  for (const n of search.list(positional[0] ?? 'fx/')) if (n.endsWith('.efx')) console.log(n.replace(/\.efx$/, ''))
}

function reportMissing(bundle) {
  const m = bundle.missing
  if (m.effects.length) console.log(`missing effects: ${m.effects.join(', ')}`)
  if (m.materials.length) console.log(`missing materials: ${m.materials.join(', ')}`)
  if (m.images.length) console.log(`missing images: ${m.images.join(', ')}`)
  if (m.models.length) console.log(`models (drawn as gray boxes): ${m.models.join(', ')}`)
}
