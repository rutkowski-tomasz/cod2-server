// Builds the self-contained map bundle: geometry, entities, and the textures, lightmaps and sky it draws with.
import { readFileSync, existsSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { parseMaterial } from '../shared/material.js'
import { decodeIwi, iwiInfo } from '../shared/iwi.js'
import { pngDataUrl } from '../shared/png.js'
import { readBsp } from './bsp.js'
import { readMap } from './map.js'
import { parseVec } from './math.js'

const TOOL_MATERIALS = /^(caulk|clip|nodraw|hint|skip|trigger|portal|lightgrid|ladder|mantle|sky$|origin|areaportal|sun_|lightmap_|\$|util_|physics|mirror|textures\/common)/i
// Textures are downscaled to keep the page small; 512 still reads well at eye level.
const TEXTURE_SIZE = 512
const DEFAULT_BOUNDS = { min: [-512, -512, -64], max: [512, 512, 256] }

// `target` is a .map or .d3dbsp file, or a game path or stock name like mp_harbor.
// Returns the scene as JSON, its geometry as one buffer that surfaces point into, and the lightmap pages.
export function loadScene(target, search, { prefabRoots = [] } = {}) {
  const source = loadTarget(target, search)
  const parsed = source.kind === 'map' ? readMap(source.path, prefabRoots) : readBsp(source.buffer)
  const entities = parsed.entities.map(entityInfo)
  const materials = []
  const materialIndex = new Map()
  const materialId = (name) => {
    if (!materialIndex.has(name)) materialIndex.set(name, materials.push(describeMaterial(name, search)) - 1)
    return materialIndex.get(name)
  }

  const chunks = []
  let byteLength = 0
  const push = (typed) => {
    const ref = { offset: byteLength, count: typed.length }
    chunks.push(Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength))
    byteLength += typed.byteLength
    const pad = (4 - (byteLength % 4)) % 4
    if (pad) { chunks.push(Buffer.alloc(pad)); byteLength += pad }
    return ref
  }

  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
  const grow = (p) => { for (let k = 0; k < 3; k++) { bounds.min[k] = Math.min(bounds.min[k], p[k]); bounds.max[k] = Math.max(bounds.max[k], p[k]) } }
  const surfaces = parsed.surfaces.map((s) => {
    const material = materialId(s.material)
    const positions = Float32Array.from(s.positions)
    if (s.entity === 0 && !materials[material].sky) for (let i = 0; i < positions.length; i += 3) grow(positions.subarray(i, i + 3))
    return {
      material, entity: s.entity, lightmap: s.lightmap ?? -1, doubleSided: s.doubleSided,
      positions: push(positions),
      normals: push(Float32Array.from(s.normals)),
      colors: s.colors ? push(Uint8Array.from(s.colors)) : null,
      uvs: push(Float32Array.from(s.uvs)),
      lmuvs: s.lmuvs ? push(Float32Array.from(s.lmuvs)) : null,
      indices: push(Uint32Array.from(s.indices)),
    }
  })
  if (!Number.isFinite(bounds.min[0])) for (const e of entities) if (e.origin) grow(e.origin)

  const scene = {
    name: source.name, kind: source.kind, path: source.path,
    bounds: Number.isFinite(bounds.min[0]) ? bounds : DEFAULT_BOUNDS,
    worldspawn: entities[0]?.keys ?? {},
    materials, surfaces, entities,
    lightmapCount: parsed.lightmaps?.length ?? 0,
    missingPrefabs: parsed.missingPrefabs ?? [],
  }
  return { scene, geometry: Buffer.concat(chunks), lightmaps: parsed.lightmaps ?? [] }
}

// The scene plus every image it uses as PNG data URLs, ready to embed in the page.
export function buildBundle(target, search, options) {
  const { scene, geometry, lightmaps } = loadScene(target, search, options)
  const images = {}
  for (const m of scene.materials) {
    if (m.sky || !m.width || images[m.image]) continue
    const img = decodeIwi(search.read(`images/${m.image}.iwi`))
    images[m.image] = { png: pngDataUrl(downscale(img, TEXTURE_SIZE)), alpha: hasAlpha(img.rgba) }
  }
  const skyMaterial = scene.materials.find((m) => m.sky && m.width)
  const sky = skyMaterial && decodeIwi(search.read(`images/${skyMaterial.image}.iwi`))
  return {
    ...scene,
    geometry: geometry.toString('base64'),
    images,
    lightmaps: lightmaps.map((pages) => pages.map(pngDataUrl)),
    sky: sky?.faces?.map((rgba) => pngDataUrl(downscale({ width: sky.width, height: sky.height, rgba }, TEXTURE_SIZE))) ?? null,
  }
}

// A material with an image it can draw has `width`; `missing` says why one has none.
function describeMaterial(name, search) {
  const tool = TOOL_MATERIALS.test(name)
  const buf = search.read(`materials/${name}`)
  const mat = buf && parseMaterial(buf)
  if (!mat) return { name, tool, sky: /^sky/.test(name), missing: '(no material)' }
  const info = { name, techset: mat.techset, tool: tool || mat.techset.startsWith('tools'), sky: mat.techset === 'sky' || /^sky/.test(name) }
  if (mat.image.startsWith('$')) return info
  info.image = mat.image
  const iwi = search.read(`images/${mat.image}.iwi`)
  if (!iwi) return { ...info, missing: `→ ${mat.image}.iwi` }
  const { format, width, height } = iwiInfo(iwi)
  if (!format) return { ...info, missing: `→ ${mat.image}.iwi (unsupported format ${iwi[4]})` }
  return { ...info, width, height }
}

// A map's own iwd is added as a source by the caller, so its map is found by name like a stock one.
function loadTarget(target, search) {
  if (existsSync(target) && !target.endsWith('.iwd')) {
    const path = resolve(target)
    if (path.endsWith('.map')) return { kind: 'map', name: basename(path, '.map'), path }
    if (path.endsWith('.d3dbsp')) return { kind: 'bsp', name: basename(path, '.d3dbsp'), path, buffer: readFileSync(path) }
    throw new Error(`${target}: expected .map, .d3dbsp or .iwd`)
  }
  const name = basename(target).replace(/\.(d3dbsp|iwd)$/, '')
  for (const path of [target, `maps/mp/${name}.d3dbsp`, `maps/${name}.d3dbsp`]) {
    const buffer = search.read(path)
    if (buffer) return { kind: 'bsp', name, path, buffer }
  }
  throw new Error(`map not found: ${target} (not a file, and no maps/mp/${name}.d3dbsp in the sources)`)
}

function entityInfo({ classname, keys }, index) {
  return {
    index, classname, keys,
    origin: keys.origin ? parseVec(keys.origin) : null,
    angles: keys.angles ? parseVec(keys.angles) : keys.angle ? [0, +keys.angle, 0] : null,
  }
}

function hasAlpha(rgba) {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 255) return true
  return false
}

function downscale(img, max) {
  if (img.width <= max && img.height <= max) return img
  const f = Math.ceil(Math.max(img.width, img.height) / max)
  const w = Math.max(1, Math.floor(img.width / f)), h = Math.max(1, Math.floor(img.height / f))
  const out = new Uint8Array(w * h * 4)
  const n = f * f
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0
    for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) {
      const i = ((y * f + dy) * img.width + x * f + dx) * 4
      r += img.rgba[i]; g += img.rgba[i + 1]; b += img.rgba[i + 2]; a += img.rgba[i + 3]
    }
    const o = (y * w + x) * 4
    out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n
  }
  return { width: w, height: h, rgba: out }
}
