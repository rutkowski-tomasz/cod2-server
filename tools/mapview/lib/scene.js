// Builds the viewer scene (JSON header + binary geometry) from a .map or .d3dbsp source.
import fs from 'node:fs'
import path from 'node:path'
import { parseBsp, NO_LIGHTMAP } from './bsp.js'
import { MeshBuilder } from './brush.js'
import { loadMap, parseVec } from './map.js'
import { TOOL_MATERIALS } from './assets.js'
import { Iwd } from './iwd.js'

// Accepts a .map / .d3dbsp / .iwd path or a stock map name (mp_harbor).
export function resolveMap(spec, assets) {
  if (fs.existsSync(spec) && fs.statSync(spec).isFile()) {
    const abs = path.resolve(spec)
    if (abs.endsWith('.map')) return { kind: 'map', name: path.basename(abs, '.map'), file: abs }
    if (abs.endsWith('.d3dbsp')) return { kind: 'bsp', name: path.basename(abs, '.d3dbsp'), file: abs, buffer: fs.readFileSync(abs) }
    if (abs.endsWith('.iwd')) {
      const iwd = new Iwd(abs)
      const entry = iwd.list().find((n) => n.toLowerCase().endsWith('.d3dbsp'))
      if (!entry) throw new Error(`${spec}: no .d3dbsp inside`)
      if (!assets.iwds.some((i) => i.path === abs)) assets.iwds.unshift(iwd)
      return { kind: 'bsp', name: path.basename(entry, '.d3dbsp'), file: `${abs}:${entry}`, buffer: iwd.read(entry) }
    }
    throw new Error(`${spec}: expected .map, .d3dbsp or .iwd`)
  }
  const name = spec.replace(/\.d3dbsp$/, '')
  for (const candidate of [`maps/mp/${name}.d3dbsp`, `maps/${name}.d3dbsp`]) {
    const buffer = assets.read(candidate)
    if (buffer) return { kind: 'bsp', name: path.basename(name), file: candidate, buffer }
  }
  throw new Error(`map not found: ${spec} (not a file, and no maps/mp/${name}.d3dbsp in the loaded iwds)`)
}

export function buildScene(source, assets, { prefabRoots = [] } = {}) {
  const geo = source.kind === 'map' ? fromMap(source, prefabRoots) : fromBsp(source)
  const materialIndex = new Map()
  const materials = []
  const matId = (name) => {
    if (materialIndex.has(name)) return materialIndex.get(name)
    const mat = assets.material(name)
    const img = assets.texture(name)
    const tool = TOOL_MATERIALS.test(name) || (mat?.techset || '').startsWith('tools')
    const sky = (mat?.techset || '') === 'sky' || /^sky/.test(name)
    const info = {
      name, techset: mat?.techset || null, image: mat?.colorMap || null,
      width: img?.width || 0, height: img?.height || 0, alpha: !!img?.hasAlpha, hasTexture: !!img,
      sky, tool, missing: !mat,
    }
    materialIndex.set(name, materials.length)
    materials.push(info)
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
  const surfaces = []
  for (const s of geo.surfaces) {
    const material = matId(s.material)
    const positions = s.positions instanceof Float32Array ? s.positions : Float32Array.from(s.positions)
    if (geo.entities[s.entity].classname === 'worldspawn' || geo.entities[s.entity].classname === 'func_group') {
      if (!materials[material].sky) for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) {
        bounds.min[k] = Math.min(bounds.min[k], positions[i + k]); bounds.max[k] = Math.max(bounds.max[k], positions[i + k])
      }
    }
    surfaces.push({
      material, entity: s.entity, lightmap: s.lightmap ?? -1,
      positions: push(positions),
      normals: push(s.normals instanceof Float32Array ? s.normals : Float32Array.from(s.normals)),
      uvs: push(s.uvs instanceof Float32Array ? s.uvs : Float32Array.from(s.uvs)),
      lmuvs: s.lmuvs ? push(s.lmuvs) : null,
      indices: push(s.indices instanceof Uint32Array ? s.indices : Uint32Array.from(s.indices)),
    })
  }
  if (!Number.isFinite(bounds.min[0])) {
    for (const e of geo.entities) if (e.origin) for (let k = 0; k < 3; k++) { bounds.min[k] = Math.min(bounds.min[k], e.origin[k]); bounds.max[k] = Math.max(bounds.max[k], e.origin[k]) }
  }
  if (!Number.isFinite(bounds.min[0])) bounds.min = [-512, -512, -64], bounds.max = [512, 512, 256]

  const sky = materials.find((m) => m.sky && m.image)
  const json = {
    name: source.name, kind: source.kind, file: source.file, bounds,
    worldspawn: geo.entities[0]?.keys || {},
    materials, surfaces, entities: geo.entities,
    lightmaps: geo.lightmaps?.length || 0,
    sky: sky ? sky.image.replace(/_ft$/, '') : null,
    missingPrefabs: geo.missingPrefabs || [],
  }
  const binary = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)))
  return { json, binary, lightmaps: geo.lightmaps || [], encode: () => encode(json, binary) }
}

function encode(json, binary) {
  const head = Buffer.from(JSON.stringify(json))
  const prefix = Buffer.alloc(8)
  prefix.write('CMV1', 0, 'latin1')
  prefix.writeUInt32LE(head.length, 4)
  const pad = Buffer.alloc((4 - (head.length % 4)) % 4)
  return Buffer.concat([prefix, head, pad, binary])
}

function entityInfo(e, index) {
  const keys = e.keys
  return {
    index, classname: e.classname, keys,
    origin: keys.origin ? parseVec(keys.origin) : null,
    angles: keys.angles ? parseVec(keys.angles) : (keys.angle ? [0, +keys.angle, 0] : null),
    model: keys.model || null, prefab: e.prefab || null,
    geometry: false,
  }
}

function fromMap(source, prefabRoots) {
  const map = loadMap(source.file, { prefabRoots })
  const entities = map.entities.map(entityInfo)
  const surfaces = []
  const builders = new Map()
  map.entities.forEach((e, index) => {
    if (!e.brushes.length && !e.patches.length) return
    // Prefab contents (func_group) render as part of the world.
    const target = e.classname === 'func_group' ? 0 : index
    let mb = builders.get(target)
    if (!mb) { mb = new MeshBuilder(); builders.set(target, mb) }
    for (const b of e.brushes) mb.addBrush(b)
    for (const p of e.patches) mb.addPatch(p)
  })
  for (const [index, mb] of builders) {
    const groups = mb.result()
    if (groups.length && entities[index]) entities[index].geometry = true
    for (const g of groups) surfaces.push({ entity: index, material: g.material, positions: g.positions, normals: g.normals, uvs: g.uvs, indices: g.indices })
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
      let g = groups.get(key)
      if (!g) { g = { material: bsp.materials[soup.material]?.name || `#${soup.material}`, lightmap: soup.lightmap === NO_LIGHTMAP ? -1 : soup.lightmap, remap: new Map(), verts: [], indices: [] }; groups.set(key, g) }
      // D3D front faces are clockwise; flip each triangle for GL.
      for (let t = 0; t + 2 < soup.indexCount; t += 3) for (const i of [t, t + 2, t + 1]) {
        const v = soup.firstVertex + bsp.indices[soup.firstIndex + i]
        let local = g.remap.get(v)
        if (local === undefined) { local = g.verts.length; g.remap.set(v, local); g.verts.push(v) }
        g.indices.push(local)
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
      if (entity > 0) entities[entity].geometry = true
      surfaces.push({ entity, material: g.material, lightmap: g.lightmap, positions, normals, uvs, lmuvs, indices: Uint32Array.from(g.indices) })
    }
  })
  entities[0].geometry = true
  return { entities, surfaces, lightmaps: bsp.lightmaps }
}
