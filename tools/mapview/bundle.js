// Builds the self-contained map bundle: geometry, entities, and the textures, lightmaps and sky it draws with.
import { readFileSync, existsSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { parseMaterial } from '../shared/material.js'
import { decodeIwi, FORMATS } from '../shared/iwi.js'
import { encodePng } from '../shared/png.js'
import { parseBsp, NO_LIGHTMAP } from './bsp.js'
import { MeshBuilder } from './brush.js'
import { loadMap, parseVec } from './map.js'

const TOOL_MATERIALS = /^(caulk|clip|nodraw|hint|skip|trigger|portal|lightgrid|ladder|mantle|sky$|origin|areaportal|sun_|lightmap_|\$|util_|physics|mirror|textures\/common)/i
// Textures are downscaled to keep the page small; 512 still reads well at eye level.
const TEXTURE_SIZE = 512
// A lightmap block holds four 512x512 RGBA pages: directional coefficients for R, G and B, then sun visibility.
const LIGHTMAP_PAGE = 512

// `target` is a .map or .d3dbsp file, or a game path or stock name like mp_harbor.
export function loadScene(target, search, { prefabRoots = [] } = {}) {
  const source = loadTarget(target, search)
  const geo = source.kind === 'map' ? fromMap(source, prefabRoots) : fromBsp(source)
  const materialIndex = new Map()
  const materials = []
  const materialId = (name) => {
    if (materialIndex.has(name)) return materialIndex.get(name)
    materialIndex.set(name, materials.length)
    materials.push(describeMaterial(name, search))
    return materials.length - 1
  }

  const chunks = []
  let byteLength = 0
  const push = (typed) => {
    const offset = byteLength
    chunks.push(typed)
    byteLength += typed.byteLength
    const pad = (4 - (byteLength % 4)) % 4
    if (pad) { chunks.push(new Uint8Array(pad)); byteLength += pad }
    return { offset, count: typed.length }
  }

  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
  const grow = (p) => { for (let k = 0; k < 3; k++) { bounds.min[k] = Math.min(bounds.min[k], p[k]); bounds.max[k] = Math.max(bounds.max[k], p[k]) } }
  const surfaces = []
  for (const s of geo.surfaces) {
    const material = materialId(s.material)
    const positions = Float32Array.from(s.positions)
    const classname = geo.entities[s.entity].classname
    if ((classname === 'worldspawn' || classname === 'func_group') && !materials[material].sky) {
      for (let i = 0; i < positions.length; i += 3) grow(positions.subarray(i, i + 3))
    }
    surfaces.push({
      material, entity: s.entity, lightmap: s.lightmap ?? -1,
      positions: push(positions),
      normals: push(Float32Array.from(s.normals)),
      uvs: push(Float32Array.from(s.uvs)),
      lmuvs: s.lmuvs ? push(s.lmuvs) : null,
      indices: push(Uint32Array.from(s.indices)),
    })
  }
  if (!Number.isFinite(bounds.min[0])) for (const e of geo.entities) if (e.origin) grow(e.origin)
  if (!Number.isFinite(bounds.min[0])) Object.assign(bounds, { min: [-512, -512, -64], max: [512, 512, 256] })

  return {
    name: source.name, kind: source.kind, path: source.path, bounds,
    worldspawn: geo.entities[0]?.keys ?? {},
    materials, surfaces, entities: geo.entities,
    lightmapCount: geo.lightmaps?.length ?? 0,
    missingPrefabs: geo.missingPrefabs ?? [],
    binary: Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))),
    lightmaps: geo.lightmaps ?? [],
  }
}

// The scene plus every image it uses as PNG data URLs, ready to embed in the page.
export function buildBundle(target, search, options) {
  const { binary, lightmaps, ...scene } = loadScene(target, search, options)
  const images = {}
  for (const m of scene.materials) {
    if (m.sky || !m.image || m.missing || images[m.image]) continue
    const img = decodeIwi(search.read(`images/${m.image}.iwi`))
    images[m.image] = { png: toPng(downscale(img, TEXTURE_SIZE)), alpha: hasAlpha(img.rgba) }
  }
  const skyMaterial = scene.materials.find((m) => m.sky && m.image && !m.missing)
  const sky = skyMaterial && decodeIwi(search.read(`images/${skyMaterial.image}.iwi`))
  return {
    ...scene,
    geometry: binary.toString('base64'),
    images,
    lightmaps: lightmaps.map((block) => [0, 1, 2, 3].map((page) => toPng(lightmapPage(block, page)))),
    sky: sky?.faces ? sky.faces.map((rgba) => toPng(downscale({ width: sky.width, height: sky.height, rgba }, TEXTURE_SIZE))) : null,
  }
}

// `missing` says why a material draws without its image: no material file, no image, or an image format the decoder lacks.
function describeMaterial(name, search) {
  const tool = TOOL_MATERIALS.test(name)
  const buf = search.read(`materials/${name}`)
  const mat = buf && parseMaterial(buf)
  if (!mat) return { name, tool, sky: /^sky/.test(name), missing: '(no material)' }
  const sky = mat.techset === 'sky' || /^sky/.test(name)
  const info = { name, techset: mat.techset, tool: tool || mat.techset.startsWith('tools'), sky }
  if (mat.image.startsWith('$')) return info
  info.image = mat.image
  const iwi = search.read(`images/${mat.image}.iwi`)
  if (!iwi) info.missing = `→ ${mat.image}.iwi`
  else if (!FORMATS[iwi[4]]) info.missing = `→ ${mat.image}.iwi (unsupported format ${iwi[4]})`
  else { info.width = iwi.readUInt16LE(6); info.height = iwi.readUInt16LE(8) }
  return info
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

function entityInfo(e, index) {
  const keys = e.keys
  return {
    index, classname: e.classname, keys,
    origin: keys.origin ? parseVec(keys.origin) : null,
    angles: keys.angles ? parseVec(keys.angles) : keys.angle ? [0, +keys.angle, 0] : null,
    model: keys.model || null, prefab: e.prefab || null,
  }
}

function fromMap(source, prefabRoots) {
  const map = loadMap(source.path, { prefabRoots })
  const entities = map.entities.map(entityInfo)
  const surfaces = []
  const builders = new Map()
  map.entities.forEach((e, index) => {
    if (!e.brushes.length && !e.patches.length) return
    // Prefab contents (func_group) render as part of the world.
    const owner = e.classname === 'func_group' ? 0 : index
    if (!builders.has(owner)) builders.set(owner, new MeshBuilder())
    const mb = builders.get(owner)
    for (const b of e.brushes) mb.addBrush(b)
    for (const p of e.patches) mb.addPatch(p)
  })
  for (const [index, mb] of builders) {
    for (const g of mb.result()) surfaces.push({ entity: index, material: g.material, positions: g.positions, normals: g.normals, uvs: g.uvs, indices: g.indices })
  }
  return { entities, surfaces, missingPrefabs: map.missingPrefabs }
}

function fromBsp(source) {
  const bsp = parseBsp(source.buffer)
  const entities = bsp.entities.map(entityInfo)
  const modelEntity = new Map([[0, 0]])
  entities.forEach((e, i) => {
    const m = /^\*(\d+)$/.exec(e.model || '')
    if (m) modelEntity.set(+m[1], i)
  })
  const surfaces = []
  bsp.models.forEach((model, mi) => {
    const entity = modelEntity.get(mi) ?? 0
    const groups = new Map()
    for (let s = model.firstSoup; s < model.firstSoup + model.soupCount; s++) {
      const soup = bsp.soups[s]
      const key = `${soup.material}/${soup.lightmap}`
      if (!groups.has(key)) groups.set(key, { material: bsp.materials[soup.material]?.name || `#${soup.material}`, lightmap: soup.lightmap === NO_LIGHTMAP ? -1 : soup.lightmap, remap: new Map(), verts: [], indices: [] })
      const g = groups.get(key)
      // D3D front faces are clockwise; flip each triangle for GL.
      for (let t = 0; t + 2 < soup.indexCount; t += 3) for (const i of [t, t + 2, t + 1]) {
        const v = soup.firstVertex + bsp.indices[soup.firstIndex + i]
        if (!g.remap.has(v)) { g.remap.set(v, g.verts.length); g.verts.push(v) }
        g.indices.push(g.remap.get(v))
      }
    }
    for (const g of groups.values()) {
      const n = g.verts.length
      const positions = new Float32Array(n * 3), normals = new Float32Array(n * 3), uvs = new Float32Array(n * 2), lmuvs = new Float32Array(n * 2)
      g.verts.forEach((v, o) => {
        positions.set(bsp.positions.subarray(v * 3, v * 3 + 3), o * 3)
        normals.set(bsp.normals.subarray(v * 3, v * 3 + 3), o * 3)
        uvs.set(bsp.uvs.subarray(v * 2, v * 2 + 2), o * 2)
        lmuvs.set(bsp.lmuvs.subarray(v * 2, v * 2 + 2), o * 2)
      })
      surfaces.push({ entity, material: g.material, lightmap: g.lightmap, positions, normals, uvs, lmuvs, indices: g.indices })
    }
  })
  return { entities, surfaces, lightmaps: bsp.lightmaps }
}

function lightmapPage(block, page) {
  const bytes = LIGHTMAP_PAGE * LIGHTMAP_PAGE * 4
  return { width: LIGHTMAP_PAGE, height: LIGHTMAP_PAGE, rgba: new Uint8Array(block.buffer, block.byteOffset + page * bytes, bytes) }
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

const toPng = (img) => `data:image/png;base64,${encodePng(img.width, img.height, img.rgba).toString('base64')}`
