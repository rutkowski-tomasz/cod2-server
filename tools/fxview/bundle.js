// Builds the self-contained effect bundle: root effect, every effect it references, and the models and textures they use.
import { readFileSync, existsSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { parseEfx } from './parse.js'
import { normalizeElement } from './normalize.js'
import { parseMaterial } from '../shared/material.js'
import { decodeIwi } from '../shared/iwi.js'
import { pngDataUrl } from '../shared/png.js'
import { readXModel } from '../shared/xmodel.js'

// `target` is a file path (ending in .efx) or an fx path like fx/explosions/grenade_flash.
export function buildBundle(target, search) {
  const effects = {}
  const materials = {}
  const models = {}
  const missing = { effects: [], materials: [], images: [], models: [] }
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
      for (const model of el.models) loadModel(model)
    }
  }
  return { root: rootPath, effects, materials, models, missing }

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

  function loadModel(name) {
    if (models[name] || missing.models.includes(name)) return
    const surfaces = readXModel(name, search)
    if (!surfaces) { missing.models.push(name); return }
    for (const s of surfaces) loadMaterial(s.material)
    // fxview draws only these; the rest, such as vertex colours, stay out of the page.
    models[name] = { surfaces: surfaces.map(({ material, positions, normals, uvs, indices }) => ({ material, positions, normals, uvs, indices })) }
  }

  function loadMaterial(name) {
    if (materials[name] || missing.materials.includes(name)) return
    const buf = search.read(`materials/${name}`)
    const mat = buf && parseMaterial(buf)
    if (!mat) { missing.materials.push(name); return }
    const iwi = search.read(`images/${mat.image}.iwi`)
    if (!iwi) { missing.images.push(`${name} → ${mat.image}.iwi`); return }
    const img = decodeIwi(iwi)
    if (!img) { missing.images.push(`${name} → ${mat.image}.iwi (unsupported format ${iwi[4]})`); return }
    materials[name] = {
      image: mat.image,
      techset: mat.techset,
      blend: mat.blend,
      feather: mat.feather,
      atlasCols: mat.atlasCols,
      atlasRows: mat.atlasRows,
      width: img.width,
      height: img.height,
      png: pngDataUrl(img),
    }
  }
}
