#!/usr/bin/env node
// Imports glTF, GLB and FBX models into CoD2: loads them with three.js in headless Chrome, writes the Mod Tools'
// source formats, and runs their converter for the game files.
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join, basename, extname, resolve, relative } from 'node:path'
import { loadModel } from './load.js'
import { buildModel, placement, nameAnimations } from './model.js'
import { writeConverterInput, writeAnimationsInput } from './export.js'
import { convert } from './convert.js'
import { retarget, playerSkeleton } from './retarget.js'

const OUT = join(import.meta.dirname, '..', '..', 'out', 'modelimport')
const INCHES_PER_METRE = 39.37
const USAGE = `usage: modelimport.js <model.gltf | model.glb | model.fbx> [-o out-dir] [options]

Writes xmodel/, xmodelparts/, xmodelsurfs/, xanim/, materials/ and images/ into out-dir (default out/modelimport/<name>/),
laid out as in an iwd. The game's front is +X and up is +Z; a glTF or FBX model's front is +Z and up is +Y.

options:
  --name <name>          xmodel name (default: the file's name)
  --scale <n>            inches per unit of the file (default: from metres for glTF, from the file's unit for FBX)
  --rotate p,y,r         degrees to turn the model by after facing it to +X: pitch, yaw, roll
  --offset x,y,z         inches to move the model by after turning it
  --texture-size <n>     longest side of a colour map, a power of two (default 1024)
  --simplify <share>     keep this share of each mesh's triangles, such as 0.25 for a quarter (default 1)
  --fps <n>              frames per second to sample animations at (default 30)
  --loop <a,b | all>     animations that loop, by their name in the file (default none)
  --retarget player      write only the animations, moved onto CoD2's multiplayer player skeleton`

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

// A retarget gets a name of its own, so it does not write over the model's import.
const name = (opts.name ?? `${basename(src, extname(src))}${opts.retarget ? '_player' : ''}`).toLowerCase().replace(/\W+/g, '_')
const out = resolve(opts.out ?? join(OUT, name))
const work = join(OUT, '.work', name)
const rotate = vector('rotate')
const offset = vector('offset')

const textureSize = Number(opts['texture-size'] ?? 1024)
if (!(textureSize >= 1 && Number.isInteger(Math.log2(textureSize)))) { console.error('--texture-size takes a power of two, such as 512'); process.exit(1) }

const keep = Number(opts.simplify ?? 1)
if (!(keep > 0 && keep <= 1)) { console.error('--simplify takes a share above 0 and up to 1, such as 0.25'); process.exit(1) }

const fps = Number(opts.fps ?? 30)
if (!(Number.isInteger(fps) && fps > 0)) { console.error('--fps takes a whole number above 0, such as 30'); process.exit(1) }

if (opts.retarget !== undefined && opts.retarget !== 'player') { console.error('--retarget takes player'); process.exit(1) }
const loop = opts.loop?.split(',').map((l) => l.trim()) ?? []
const player = opts.retarget && playerSkeleton()

const loaded = await loadModel(src, textureSize, keep, fps)
if (player) {
  await importRetargeted()
  process.exit(0)
}
const scale = Number(opts.scale ?? loaded.metresPerUnit * INCHES_PER_METRE)
const model = buildModel(loaded, { name, place: placement({ scale, rotate, offset }), loop })
const oldAnimations = previousAnimations()
rmSync(work, { recursive: true, force: true })
writeConverterInput(work, name, model, fps)
mkdirSync(out, { recursive: true })
removeOldOutput()
await convert(work, out)
console.log(`${relative(process.cwd(), join(out, 'xmodel', name))}  ${model.faces.length} triangles, ${model.materials.length} materials, ${model.bones.length - 1} bones`)
for (const a of model.animations) console.log(`${relative(process.cwd(), join(out, 'xanim', a.name))}  ${a.frames.length} frames${a.looping ? ', looping' : ''}`)

// The file's animations on the multiplayer player skeleton, as xanims built against an XMODEL_EXPORT of it.
async function importRetargeted() {
  const { animations, unmatched } = retarget(loaded, player)
  const named = nameAnimations(animations, name, [], loop)
  const oldAnimations = previousAnimations()
  rmSync(work, { recursive: true, force: true })
  writeAnimationsInput(work, name, player, named, fps)
  mkdirSync(out, { recursive: true })
  for (const a of oldAnimations) rmSync(join(out, 'xanim', a), { force: true })
  await convert(work, out)
  if (unmatched.length) console.log(`not matched, left out: ${unmatched.join(', ')}`)
  for (const a of named) console.log(`${relative(process.cwd(), join(out, 'xanim', a.name))}  ${a.frames.length} frames${a.looping ? ', looping' : ''}`)
}

// The files an earlier import of this model wrote, which one with fewer materials would leave behind.
function removeOldOutput() {
  rmSync(join(out, 'xmodel', name), { force: true })
  rmSync(join(out, 'xmodelparts', `${name}0`), { force: true })
  rmSync(join(out, 'xmodelsurfs', `${name}0`), { force: true })
  for (const a of oldAnimations) rmSync(join(out, 'xanim', a), { force: true })
  for (const [dir, ext] of [['materials', ''], ['images', '.iwi']]) {
    for (let i = 0; existsSync(join(out, dir, `${name}_${i}${ext}`)); i++) rmSync(join(out, dir, `${name}_${i}${ext}`))
  }
}

// The animations the last import of this model wrote, from its GDT.
function previousAnimations() {
  const gdt = join(work, 'source_data', `${name}.gdt`)
  if (!existsSync(gdt)) return []
  return [...readFileSync(gdt, 'utf8').matchAll(/"([^"]+)" \( "xanim\.gdf" \)/g)].map((m) => m[1])
}

// Three numbers given as x,y,z, or undefined when the option is not given.
function vector(option) {
  if (opts[option] === undefined) return undefined
  const v = opts[option].split(',').map(Number)
  if (v.length !== 3 || !v.every(Number.isFinite)) { console.error(`--${option} takes three numbers, such as 0,90,0`); process.exit(1) }
  return v
}
