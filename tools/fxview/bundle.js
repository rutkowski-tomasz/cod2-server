// Builds the self-contained effect bundle: root effect, every effect it references, and the textures they use.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'
import { homedir } from 'node:os'
import { parseEfx } from './parse.js'
import { normalizeElement } from './normalize.js'
import { AssetSearch } from './iwd.js'
import { parseMaterial } from './material.js'
import { decodeIwi } from './iwi.js'
import { encodePng } from './png.js'

const HOME = homedir()
// Stock game first, then the mod's unpacked iwd folders; later entries override earlier ones.
export const DEFAULT_SOURCES = [
  `${HOME}/Dev/cod2-binaries/1_0`,
  `${HOME}/Dev/cod2-binaries/1_3`,
  ...modFolders(`${HOME}/Dev/nl-cod2-zom-iwds/iwds`),
]

function modFolders(root) {
  if (!existsSync(root)) return []
  const out = []
  for (const iwd of readdirSync(root)) {
    const dir = join(root, iwd)
    if (!statSync(dir).isDirectory()) continue
    for (const feature of readdirSync(dir)) if (statSync(join(dir, feature)).isDirectory()) out.push(join(dir, feature))
  }
  return out
}

export function createSearch(extraSources = []) {
  const search = new AssetSearch()
  for (const s of [...DEFAULT_SOURCES, ...extraSources]) search.add(resolve(s))
  return search
}

// `target` is a file path (ending in .efx) or an fx path like fx/explosions/grenade_flash.
export function buildBundle(target, search) {
  const effects = {}
  const materials = {}
  const missing = { effects: [], materials: [], images: [], models: new Set() }
  const rootPath = loadRoot(target)
  const queue = [rootPath]
  while (queue.length) {
    const path = queue.shift()
    const effect = effects[path]
    for (const el of effect.elements) {
      for (const sub of [el.playfx, el.emitfx, el.impactfx, el.deathfx]) {
        if (!sub || effects[sub] || missing.effects.includes(sub)) continue
        const text = readEffect(sub)
        if (!text) { missing.effects.push(sub); continue }
        effects[sub] = loadEffect(text, sub)
        queue.push(sub)
      }
      for (const shader of el.shaders) loadMaterial(shader)
      for (const model of el.models) missing.models.add(model)
    }
  }
  return { root: rootPath, effects, materials, missing: { ...missing, models: [...missing.models] } }

  function loadRoot(t) {
    if (t.endsWith('.efx') && existsSync(t)) {
      const abs = resolve(t)
      const m = abs.match(/(fx\/.*)\.efx$/)
      const path = m ? m[1] : `fx/${basename(abs, '.efx')}`
      effects[path] = loadEffect(readFileSync(abs, 'utf8'), path)
      return path
    }
    const path = t.replace(/^\/+/, '').replace(/\.efx$/, '')
    const text = readEffect(path)
    if (!text) throw new Error(`effect not found: ${t}`)
    effects[path] = loadEffect(text, path)
    return path
  }

  function readEffect(path) {
    const buf = search.read(`${path}.efx`)
    return buf ? buf.toString('utf8') : null
  }

  function loadEffect(text, path) {
    const parsed = parseEfx(text)
    return { path, elements: parsed.elements.map(normalizeElement) }
  }

  function loadMaterial(name) {
    if (materials[name] || missing.materials.includes(name)) return
    const buf = search.read(`materials/${name}`)
    const mat = buf && parseMaterial(buf)
    if (!mat) { missing.materials.push(name); return }
    const iwi = search.read(`images/${mat.image}.iwi`)
    if (!iwi) { missing.images.push(`${name} → ${mat.image}.iwi`); return }
    const img = decodeIwi(iwi)
    materials[name] = {
      image: mat.image,
      techset: mat.techset,
      blend: mat.blend,
      atlasCols: mat.atlasCols,
      atlasRows: mat.atlasRows,
      width: img.width,
      height: img.height,
      png: `data:image/png;base64,${encodePng(img.width, img.height, img.rgba).toString('base64')}`,
    }
  }
}
