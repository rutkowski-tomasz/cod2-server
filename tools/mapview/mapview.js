#!/usr/bin/env node
// CoD2 map visualizer: interactive viewer and scripted screenshots of .map and .d3dbsp files.
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { Assets } from './lib/assets.js'
import { createServer, listen } from './lib/server.js'
import { resolveMap, buildScene } from './lib/scene.js'
import { openViewer } from './lib/shot.js'
import { encodePng } from './lib/png.js'

const USAGE = `usage:
  mapview.js serve [map] [--port 7777]           interactive viewer at http://127.0.0.1:<port>/?map=<map>
  mapview.js shot <map> [view options] [--out shot.png]
  mapview.js shot <map> --batch shots.json [--out dir]
  mapview.js info <map>                           bounds, entities, materials
  mapview.js texture <material> [--out file.png]  dump a material's colour map

<map>: path to a .map, .d3dbsp or .iwd, or a stock map name (mp_harbor)

view options:
  --pos x,y,z        eye position              --angles pitch,yaw,roll   CoD view angles
  --at <selector>    eye at an entity (classname, key=value or #index; [n] picks the n-th match), 60 units above its origin
  --look x,y,z       aim at a point            --fov 80                  horizontal field of view
  --top              orthographic top-down     --center x,y --span u     top view window
  --cut z            hide everything above z   --size 1280x720           image size
  --no-labels --no-ents --no-tex --tools --grid --no-lm --no-shadows

asset options:
  --iwd <file|dir>   extra .iwd files (repeatable); stock iwds come from $COD2_BINARIES or ~/Dev/cod2-binaries
  --dir <dir>        loose asset directory with materials/ and images/ (repeatable)
  --prefabs <dir>    where misc_prefab paths resolve (repeatable)
  --no-stock         skip the stock iwds`

// parseArgs treats "-900,0,60" as an option; join such values to their option: --pos=-900,0,60.
const argv = []
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i], next = process.argv[i + 1]
  if (/^--\w[\w-]*$/.test(a) && next !== undefined && /^-\d/.test(next)) { argv.push(`${a}=${next}`); i++ } else argv.push(a)
}
const { values: opt, positionals } = parseArgs({
  args: argv,
  allowPositionals: true,
  options: {
    port: { type: 'string', default: '7777' }, out: { type: 'string' }, batch: { type: 'string' },
    pos: { type: 'string' }, angles: { type: 'string' }, at: { type: 'string' }, look: { type: 'string' }, fov: { type: 'string' },
    top: { type: 'boolean' }, center: { type: 'string' }, span: { type: 'string' }, cut: { type: 'string' }, size: { type: 'string', default: '1280x720' },
    'no-labels': { type: 'boolean' }, 'no-ents': { type: 'boolean' }, 'no-tex': { type: 'boolean' }, tools: { type: 'boolean' }, grid: { type: 'boolean' }, 'no-lm': { type: 'boolean' }, 'no-shadows': { type: 'boolean' },
    iwd: { type: 'string', multiple: true, default: [] }, dir: { type: 'string', multiple: true, default: [] }, prefabs: { type: 'string', multiple: true, default: [] }, 'no-stock': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
})

const [command, target] = positionals
if (opt.help || !command) { console.log(USAGE); process.exit(opt.help ? 0 : 1) }

const assets = Assets.fromOptions({ iwd: opt.iwd, dir: opt.dir, noDefaults: opt['no-stock'] })
const log = (m) => console.error(m)

const commands = { serve, shot, info, texture }
if (!commands[command]) { console.error(`unknown command: ${command}\n\n${USAGE}`); process.exit(1) }
commands[command]().catch((e) => { console.error(e.message); process.exit(1) })

async function serve() {
  const server = createServer({ assets, prefabRoots: opt.prefabs, log })
  const port = await listen(server, +opt.port)
  const map = target ? `?map=${encodeURIComponent(path.resolve(target).startsWith('/') && fs.existsSync(target) ? path.resolve(target) : target)}` : ''
  console.log(`http://127.0.0.1:${port}/${map}`)
  if (!target) console.log('open with ?map=<path to .map/.d3dbsp/.iwd or stock name>')
}

function viewParams(o) {
  const p = {}
  if (o.pos) p.pos = o.pos
  if (o.angles) p.angles = o.angles
  if (o.at) p.at = o.at
  if (o.look) p.look = o.look
  if (o.fov) p.fov = o.fov
  if (o.top) p.top = '1'
  if (o.center) p.pos = o.center
  if (o.span) p.span = o.span
  if (o.cut != null) p.cut = o.cut
  if (o['no-labels'] || o.labels === false) p.labels = '0'
  if (o['no-ents'] || o.ents === false) p.ents = '0'
  if (o['no-tex'] || o.tex === false) p.tex = '0'
  if (o.tools) p.tools = '1'
  if (o.grid) p.grid = '1'
  if (o['no-lm'] || o.lm === false) p.lm = '0'
  if (o['no-shadows'] || o.shadows === false) p.shadows = '0'
  return p
}

async function shot() {
  if (!target) throw new Error('shot: missing <map>')
  const [width, height] = opt.size.split('x').map(Number)
  const mapSpec = fs.existsSync(target) ? path.resolve(target) : target
  const server = createServer({ assets, prefabRoots: opt.prefabs, log })
  const port = await listen(server, 0)
  const t0 = Date.now()
  let viewer
  try {
    viewer = await openViewer({ port, width, height })
    if (opt.batch) {
      const shots = JSON.parse(fs.readFileSync(opt.batch, 'utf8'))
      const outDir = opt.out || path.dirname(path.resolve(opt.batch))
      let first = true
      for (const s of shots) {
        const p = { map: mapSpec, ...viewParams(s) }
        if (first) await viewer.load(p); else await viewer.apply(p)
        first = false
        const out = path.resolve(outDir, s.out || `${s.name || 'shot'}.png`)
        const cam = await viewer.shoot(out)
        console.log(`${out}  pos ${cam.pos.join(',')} angles ${cam.angles.join(',')}`)
      }
    } else {
      await viewer.load({ map: mapSpec, ...viewParams(opt) })
      const out = opt.out || `${path.basename(mapSpec).replace(/\.(map|d3dbsp|iwd)$/, '')}.png`
      const cam = await viewer.shoot(out)
      console.log(`${out}  ${cam.top ? 'top view' : `pos ${cam.pos.join(',')} angles ${cam.angles.join(',')} fov ${cam.fov}`}`)
    }
    if (viewer.errors.length) console.error(`browser errors:\n${viewer.errors.join('\n')}`)
  } finally {
    if (viewer) await viewer.close()
    server.close()
  }
  log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
}

async function info() {
  if (!target) throw new Error('info: missing <map>')
  const src = resolveMap(target, assets)
  const s = buildScene(src, assets, { prefabRoots: opt.prefabs }).json
  const r = (v) => v.map((x) => Math.round(x)).join(' ')
  console.log(`${s.name} (${s.kind}) ${s.file}`)
  console.log(`bounds: min ${r(s.bounds.min)}  max ${r(s.bounds.max)}  size ${r([0, 1, 2].map((i) => s.bounds.max[i] - s.bounds.min[i]))}`)
  console.log(`surfaces: ${s.surfaces.length}  lightmaps: ${s.lightmaps}  sky: ${s.sky || '-'}`)
  const ws = Object.entries(s.worldspawn).filter(([k]) => k !== 'classname').map(([k, v]) => `${k}=${v}`).join(' ')
  if (ws) console.log(`worldspawn: ${ws}`)
  if (s.missingPrefabs.length) console.log(`missing prefabs: ${s.missingPrefabs.join(', ')}`)
  console.log('\nentities:')
  const byClass = new Map()
  for (const e of s.entities) { if (!byClass.has(e.classname)) byClass.set(e.classname, []); byClass.get(e.classname).push(e) }
  for (const [cls, list] of [...byClass].sort((a, b) => b[1].length - a[1].length)) {
    const sample = list.filter((e) => e.origin).slice(0, 3).map((e) => `#${e.index}${e.keys.targetname ? `[${e.keys.targetname}]` : ''} ${r(e.origin)}${e.angles ? ` @${r(e.angles)}` : ''}`).join(', ')
    console.log(`  ${String(list.length).padStart(4)}  ${cls}${sample ? `  ${sample}${list.length > 3 ? ', …' : ''}` : ''}`)
  }
  console.log('\nmaterials:')
  for (const m of s.materials) {
    const flags = [m.sky && 'sky', m.tool && 'tool', m.missing && 'MISSING', !m.missing && !m.hasTexture && 'no image'].filter(Boolean).join(' ')
    console.log(`  ${m.name.padEnd(40)} ${m.image ? `${m.image} ${m.width}x${m.height}` : ''} ${flags}`)
  }
}

async function texture() {
  if (!target) throw new Error('texture: missing <material>')
  const img = assets.texture(target)
  if (!img) throw new Error(`no colour map for material ${target} (${JSON.stringify(assets.material(target))})`)
  const out = opt.out || `${target}.png`
  fs.writeFileSync(out, encodePng(img.width, img.height, img.rgba))
  console.log(`${out} ${img.width}x${img.height} ${img.format}`)
}
