#!/usr/bin/env node
// Imports glTF, GLB and FBX models into CoD2: loads them with three.js in headless Chrome, writes the Mod Tools'
// source formats, and runs their converter for the game files.
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, basename, extname, resolve, relative } from 'node:path'
import { loadModel } from './load.js'
import { buildModel, placement } from './model.js'
import { writeConverterInput } from './export.js'
import { convert } from './convert.js'

const OUT = join(import.meta.dirname, '..', '..', 'out', 'modelimport')
const INCHES_PER_METRE = 39.37
const USAGE = `usage: modelimport.js <model.gltf | model.glb | model.fbx> [-o out-dir] [options]

Writes xmodel/, xmodelparts/, xmodelsurfs/, materials/ and images/ into out-dir (default out/modelimport/<name>/),
laid out as in an iwd. The game's front is +X and up is +Z; a glTF or FBX model's front is +Z and up is +Y.

options:
  --name <name>          xmodel name (default: the file's name)
  --scale <n>            inches per unit of the file (default: from metres for glTF, from the file's unit for FBX)
  --rotate p,y,r         degrees to turn the model by after facing it to +X: pitch, yaw, roll
  --offset x,y,z         inches to move the model by after turning it`

const args = process.argv.slice(2)
const opts = {}
const positional = []
while (args.length) {
  const a = args.shift()
  if (a === '-o') opts.out = args.shift()
  else if (a.startsWith('--')) opts[a.slice(2)] = args.shift()
  else positional.push(a)
}
const src = positional[0] && resolve(positional[0])
if (!src || !existsSync(src)) { console.error(USAGE); process.exit(1) }

const name = (opts.name ?? basename(src, extname(src))).toLowerCase().replace(/\W+/g, '_')
const out = resolve(opts.out ?? join(OUT, name))
const work = join(OUT, '.work', name)
const rotate = vector('rotate')
const offset = vector('offset')

const loaded = await loadModel(src)
const scale = Number(opts.scale ?? loaded.metresPerUnit * INCHES_PER_METRE)
const model = buildModel(loaded, { name, place: placement({ scale, rotate, offset }) })
rmSync(work, { recursive: true, force: true })
writeConverterInput(work, name, model)
mkdirSync(out, { recursive: true })
removeOldOutput()
await convert(work, out)
console.log(`${relative(process.cwd(), join(out, 'xmodel', name))}  ${model.faces.length} triangles, ${model.materials.length} materials`)

// The files an earlier import of this model wrote, which one with fewer materials would leave behind.
function removeOldOutput() {
  rmSync(join(out, 'xmodel', name), { force: true })
  rmSync(join(out, 'xmodelparts', `${name}0`), { force: true })
  rmSync(join(out, 'xmodelsurfs', `${name}0`), { force: true })
  for (const [dir, ext] of [['materials', ''], ['images', '.iwi']]) {
    for (let i = 0; existsSync(join(out, dir, `${name}_${i}${ext}`)); i++) rmSync(join(out, dir, `${name}_${i}${ext}`))
  }
}

// Three numbers given as x,y,z, or undefined when the option is not given.
function vector(option) {
  if (opts[option] === undefined) return undefined
  const v = opts[option].split(',').map(Number)
  if (v.length !== 3 || !v.every(Number.isFinite)) { console.error(`--${option} takes three numbers, such as 0,90,0`); process.exit(1) }
  return v
}
