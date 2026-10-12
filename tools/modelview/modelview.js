#!/usr/bin/env node
// CoD2 xmodel viewer: builds a standalone HTML page, renders contact sheets headlessly, prints model and animation info.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, basename, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createSearch } from '../shared/assets.js'
import { inlineModules, threeModuleUrl } from '../shared/inline.js'
import { buildModelBundle } from './bundle.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', '..', 'out', 'modelview')
const USAGE = `usage:
  modelview.js view   <target> [-o out.html] [--open] [options]   build an interactive page
  modelview.js render <target> [-o out.png] [options]             headless frames into one contact sheet
  modelview.js info   <target> [--json] [options]                 bones, surfaces, materials, animations
  modelview.js list   [prefix]                                    xmodels (default xmodel/), or xanim/, weapons/mp/

<target>: a weapon file name under weapons/mp/ (mp40_mp), an xmodel (xmodel/crate01 or crate01), or a file path to
either; a weapon shows its viewmodel in first person and a player holding it in third person

options:
  --source <dir|iwd>   extra asset source, repeatable; mod folders beat stock
  --anim a,b           xanims to play, or a weapon's view animations (idle, fire, rechamber, reload, reloadEmpty,
                       reloadStart, reloadEnd, melee, adsUp, aimed, adsFire, adsRechamber, adsDown); the first is
                       shown first
  --attach a,b         xmodels to hang on the model's bones, such as a head and helmet on a body
  --person first|third the weapon view to show (default first)
  --hands <xmodel>     first-person hands instead of the weapon file's handModel
  --body a,b,c         third-person player models instead of the default rifleman
  --times 0,200,400    frame times in ms (render); default: --frames spread over the animation
  --frames 8           frames over the animation (default 8), or views around a model that does not move (default 4);
                       an eye view of a pose that does not move is one frame (render)
  --cols 4             sheet columns (render)
  --size 480x360       frame size (render)
  --cam yaw,pitch,dist orbit camera, also in first person; default fits the model; yaw 0 looks at its front
  --eye on|off         view from the eye with cg_fov 80 (first person; default on)
  --bones on           draw the skeleton and tag names
  --normals off        draw without normal and specular maps
  --tex off  --wire on  --grid off  --bg dark|mid|light|black`

const VIEW_KEYS = ['person', 'cam', 'eye', 'bones', 'tex', 'normals', 'wire', 'grid', 'bg']

const args = process.argv.slice(2)
const cmd = args.shift()
const opts = { source: [] }
const positional = []
while (args.length) {
  const a = args.shift()
  if (a === '-o') opts.out = args.shift()
  else if (a === '--source') opts.source.push(args.shift())
  else if (a === '--open' || a === '--json') opts[a.slice(2)] = true
  else if (a.startsWith('--')) opts[a.slice(2)] = args.shift()
  else positional.push(a)
}

const name = cmd === 'list' ? null : targetName()
const search = createSearch(opts.source)

switch (cmd) {
  case 'view': view(); break
  case 'render': await render(); break
  case 'info': info(); break
  case 'list': list(); break
  default: console.error(USAGE); process.exit(1)
}

// A file under xmodel/ or weapons/mp/ is looked up by its game path, with the folder holding it as a source.
function targetName() {
  const t = positional[0]
  if (!t) { console.error(USAGE); process.exit(1) }
  const m = existsSync(t) && resolve(t).match(/^(.*)\/((?:xmodel|weapons\/mp)\/[^/]+)$/)
  if (!m) return t
  opts.source.push(m[1])
  return m[2].replace(/^weapons\/mp\//, '')
}

function outName(ext) {
  const out = opts.out ?? join(OUT, `${basename(name)}${opts.person ? `_${opts.person}` : ''}.${ext}`)
  mkdirSync(dirname(out), { recursive: true })
  return out
}

function load() {
  const list = (k) => (opts[k] ? opts[k].split(',') : undefined)
  const bundle = buildModelBundle(name, search, { anims: list('anim'), attach: list('attach'), body: list('body'), hands: opts.hands })
  // `info --json` prints only JSON, which lists them too.
  if (!opts.json) for (const line of problems(bundle)) console.log(line)
  return bundle
}

function problems(bundle) {
  const lines = bundle.missing.map((m) => `missing: ${m}`)
  for (const v of Object.values(bundle.views)) for (const rig of [v.rig, v.gun, v.held].filter(Boolean)) {
    for (const m of rig.materials) if (m.missing) lines.push(`no image: ${m.name} ${m.missing}`)
  }
  return lines
}

// Command line options are baked into the page as defaults; URL hash params still override them.
function buildHtml(bundle) {
  const defaults = Object.fromEntries(VIEW_KEYS.filter((k) => opts[k] !== undefined).map((k) => [k, opts[k]]))
  return readFileSync(join(HERE, 'viewer.html'), 'utf8')
    .replace('__THREE__', () => threeModuleUrl(join(HERE, 'node_modules')))
    .replace('__SCRIPT__', () => inlineModules(HERE, 'viewer.js'))
    .replace('__BUNDLE__', () => JSON.stringify({ ...bundle, problems: problems(bundle), defaults }).replace(/</g, '\\u003c'))
}

function view() {
  const out = outName('html')
  writeFileSync(out, buildHtml(load()))
  console.log(out)
  if (opts.open) execFileSync('open', [out])
}

async function render() {
  const bundle = load()
  const out = outName('png')
  const html = join(dirname(out), `${basename(out, '.png')}.html`)
  writeFileSync(html, buildHtml(bundle))
  const [width, height] = (opts.size ?? '480x360').split('x').map(Number)
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    page.on('pageerror', (e) => console.error('page error:', e.message))
    await page.goto(pathToFileURL(html).href)
    await page.waitForFunction('window.modelReady || window.modelError', null, { timeout: 120000 })
    const error = await page.evaluate('window.modelError')
    if (error) throw new Error(`page: ${error}`)
    const { duration, cam, view, anim, eye } = await page.evaluate('window.modelview.info()')
    // A one-frame pose, such as a gun's idle, is drawn from around the model, or once from the eye.
    const shots = opts.times ? opts.times.split(',').map((ms) => ({ time: ms / 1000 }))
      : duration > 0.1 ? spread(Number(opts.frames ?? 8)).map((f) => ({ time: f * duration }))
      : eye ? [{ time: 0 }]
      : spread(Number(opts.frames ?? 4), true).map((f) => ({ time: 0, yaw: cam.yaw + f * 360 }))
    const cols = Number(opts.cols ?? Math.min(4, shots.length))
    const png = await page.evaluate((o) => window.modelview.capture(o), { shots, cols, width, height })
    writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'))
    console.log(`${out}  ${view}${anim ? ` ${anim} ${Math.round(duration * 1000)} ms` : ''}`)
  } finally {
    await browser.close()
  }
}

// `n` fractions from 0 to 1; `around` leaves out 1, the same view as 0 on a full turn.
function spread(n, around = false) {
  if (n === 1) return [0]
  return Array.from({ length: n }, (_, i) => i / (around ? n : n - 1))
}

function info() {
  const bundle = load()
  const data = Object.fromEntries(Object.entries(bundle.views).map(([view, v]) => [view, {
    bones: [...new Set([...v.rig.bones, ...(v.gun?.bones ?? [])].map((b) => b.name))],
    surfaces: [v.rig, v.gun, v.held].filter(Boolean).flatMap((rig) => rig.surfaces.map((s) => ({ material: rig.materials[s.material].name, image: rig.materials[s.material].image ?? null, vertices: s.positions.count / 3, triangles: s.indices.count / 3 }))),
    held: v.held ? v.held.bones.map((b) => b.name) : undefined,
    anims: Object.fromEntries(Object.entries(v.anims).map(([n, a]) => [n, { frames: a.frames, fps: a.fps, ms: Math.round((Math.max(1, a.frames - 1) / a.fps) * 1000), bones: a.bones.length }])),
    start: v.start,
  }]))
  if (opts.json) { console.log(JSON.stringify({ name: bundle.name, kind: bundle.kind, views: data, problems: problems(bundle) }, null, 2)); return }
  for (const [view, d] of Object.entries(data)) {
    console.log(`${bundle.name} (${view}): ${d.bones.length} bones, ${d.surfaces.length} surfaces, ${d.surfaces.reduce((n, s) => n + s.triangles, 0)} triangles`)
    for (const s of d.surfaces) console.log(`  ${s.material.padEnd(36)} ${String(s.triangles).padStart(6)} tris  ${s.image ?? '(no image)'}`)
    console.log(`  tags: ${[...d.bones, ...(d.held ?? [])].filter((b) => b.startsWith('tag_')).join(' ') || '-'}`)
    for (const [n, a] of Object.entries(d.anims)) console.log(`  anim ${n.padEnd(30)} ${String(a.frames).padStart(4)} frames  ${+a.fps.toFixed(1)} fps  ${a.ms} ms  ${a.bones} bones${n === d.start ? '  (shown first)' : ''}`)
  }
}

function list() {
  for (const n of search.list(positional[0] ?? 'xmodel/')) console.log(n)
}
