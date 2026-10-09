#!/usr/bin/env node
// CoD2 map decompiler: turns a compiled .d3dbsp back into a Radiant .map.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSearch } from '../shared/assets.js'
import { decompile } from './decompile.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', '..', 'out', 'mapdecompile')
const USAGE = `usage: mapdecompile.js <map> [-o out.map]

<map>: a .d3dbsp or .iwd file, or a stock name like mp_harbor`

const args = process.argv.slice(2)
let target
let out
while (args.length) {
  const a = args.shift()
  if (a === '-o' && args.length) out = args.shift()
  else if (!a.startsWith('-') && !target) target = a
  else fail()
}
if (!target) fail()

const name = basename(target).replace(/\.(d3dbsp|iwd)$/, '')
const { text, stats } = decompile(readMap())
out ??= join(OUT, `${name}.map`)
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, text)
console.log(`${out}: ${stats.brushes} brushes (${stats.detail} detail, ${stats.textured} faces aligned from draw triangles), ${stats.meshes} meshes (${stats.nonColliding} non-colliding), ${stats.portals} portal pieces left out`)

function readMap() {
  if (/\.(d3dbsp|iwd)$/.test(target) && !existsSync(target)) throw new Error(`${target}: no such file`)
  if (target.endsWith('.d3dbsp')) return readFileSync(target)
  const search = createSearch(target.endsWith('.iwd') ? [target] : [])
  const buf = search.read(`maps/mp/${name}.d3dbsp`)
  if (!buf) throw new Error(`map not found: no maps/mp/${name}.d3dbsp in the sources`)
  return buf
}

function fail() {
  console.error(USAGE)
  process.exit(1)
}
