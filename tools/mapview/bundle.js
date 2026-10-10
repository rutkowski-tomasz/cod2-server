// Builds the self-contained map bundle: geometry, entities, and the textures, lightmaps and sky it draws with.
import { readFileSync, existsSync } from 'node:fs'
import { resolve, basename, join } from 'node:path'
import { parseMaterial } from '../shared/material.js'
import { decodeIwi, iwiInfo } from '../shared/iwi.js'
import { pngDataUrl } from '../shared/png.js'
import { readXModel, readRig } from '../shared/xmodel.js'
import { readBsp } from './bsp.js'
import { readMap } from './map.js'
import { parseXAnim } from './xanim.js'
import { parseVec } from './math.js'

const TOOL_MATERIALS = /^(caulk|clip|nodraw|hint|skip|trigger|portal|lightgrid|ladder|mantle|sky$|origin|areaportal|sun_|lightmap_|\$|util_|physics|mirror|textures\/common)/i
// Textures are downscaled to keep the page small; 512 still reads well at eye level.
const TEXTURE_SIZE = 512
// Normal and specular maps are noisy and compress badly, so they get half the size to keep the page small.
const NORMAL_MAP_SIZE = 256
const DEFAULT_BOUNDS = { min: [-512, -512, -64], max: [512, 512, 256] }
// CTF allied spawns draw as a player playing the multiplayer idle: one of the riflemen the game picks from for
// Americans in Normandy, with the head and helmet his character script attaches.
const PLAYER = {
  classname: 'mp_ctf_spawn_allied',
  models: ['xmodel/playerbody_american_normandy01', 'xmodel/head_us_ranger_braeburn', 'xmodel/helmet_us_ranger_generic'],
  idle: 'xanim/pb_stand_alert',
}

// `target` is a .map or .d3dbsp file, or a game path or stock name like mp_harbor.
// Returns the scene as JSON, its geometry as one buffer that surfaces point into, and the lightmap pages.
// `scriptDir` holds map scripts by name, `<name>.gsc`, for maps whose script is not in the sources.
// `withPlayer` bundles the player even without CTF allied spawns.
export function loadScene(target, search, { prefabRoots = [], scriptDir, withPlayer = false } = {}) {
  const source = loadTarget(target, search)
  const parsed = source.kind === 'map' ? readMap(source.path, prefabRoots) : readBsp(source.buffer)
  // Only the lightmap shader draws normal and specular maps, so pages without lightmaps leave them out.
  const lit = parsed.lightmaps?.length > 0
  const entities = parsed.entities.map(entityInfo)
  const materials = []
  const materialIndex = new Map()
  const materialId = (name) => {
    if (!materialIndex.has(name)) materialIndex.set(name, materials.push(describeMaterial(name, search, lit)) - 1)
    return materialIndex.get(name)
  }

  const { push, buffer } = createPacker()
  const packGeometry = (s, material) => packSurface(push, s, materials[material].normalMap && s.tangents)

  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
  const grow = (p) => { for (let k = 0; k < 3; k++) { bounds.min[k] = Math.min(bounds.min[k], p[k]); bounds.max[k] = Math.max(bounds.max[k], p[k]) } }
  const surfaces = parsed.surfaces.map((s) => {
    const material = materialId(s.material)
    const positions = Float32Array.from(s.positions)
    if (s.entity === 0 && !s.collision && !materials[material].sky) for (let i = 0; i < positions.length; i += 3) grow(positions.subarray(i, i + 3))
    return {
      material, entity: s.entity, lightmap: s.lightmap ?? -1, doubleSided: s.doubleSided, collision: s.collision,
      ...packGeometry({ ...s, positions }, material),
      lmuvs: s.lmuvs ? push(Float32Array.from(s.lmuvs)) : null,
    }
  })
  if (!Number.isFinite(bounds.min[0])) for (const e of entities) if (e.origin) grow(e.origin)
  // Every xmodel the entities name, once. Ones that cannot be drawn stay boxes and are listed in `boxModels`.
  const models = {}
  const boxModels = []
  for (const name of new Set(entities.map((e) => e.keys.model).filter((m) => m?.startsWith('xmodel/')))) {
    const surfaces = readXModel(name, search)
    if (surfaces) models[name] = surfaces.map((s) => {
      const material = materialId(s.material)
      return { material, ...packGeometry(s, material) }
    })
    else boxModels.push(name)
  }
  let player = null
  let missingPlayer = null
  if (withPlayer || entities.some((e) => e.classname === PLAYER.classname)) {
    const rig = readRig(PLAYER.models, search)
    const idle = search.read(PLAYER.idle)
    const animation = idle && parseXAnim(idle)
    if (rig && animation) {
      const surfaces = rig.surfaces.map((s) => {
        const material = materialId(s.material)
        return { material, ...packGeometry(s, material), ...packSkin(push, s) }
      })
      // Animated bones the rig lacks, such as other uniforms' coat tails, would only warn on the page.
      animation.bones = animation.bones.filter((b) => rig.bones.some((r) => r.name === b.name))
      player = { classname: PLAYER.classname, bones: rig.bones, surfaces, idle: animation }
    } else missingPlayer = { classname: PLAYER.classname, files: [...PLAYER.models, PLAYER.idle] }
  }

  const scene = {
    name: source.name, kind: source.kind, path: source.path,
    bounds: Number.isFinite(bounds.min[0]) ? bounds : DEFAULT_BOUNDS,
    worldspawn: entities[0]?.keys ?? {},
    fog: readFog(source.name, search, scriptDir),
    materials, surfaces, entities, models, boxModels, player, missingPlayer,
    lightmapCount: parsed.lightmaps?.length ?? 0,
    missingPrefabs: parsed.missingPrefabs ?? [],
  }
  return { scene, geometry: buffer(), lightmaps: parsed.lightmaps ?? [] }
}

// The scene plus every image it uses as PNG data URLs, ready to embed in the page.
export function buildBundle(target, search, options) {
  const { scene, geometry, lightmaps } = loadScene(target, search, options)
  const images = imagesOf(scene.materials, search)
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

// A player made of `models`, a body and what is attached to it, for an add-on's page: its bones, skinned
// surfaces, and the materials and images they draw with, packed like a bundle. Null when a model is missing.
// Its materials keep their normal and specular maps; a page without lightmaps leaves them unused.
export function buildRig(models, search) {
  const rig = readRig(models, search)
  if (!rig) return null
  const { push, buffer } = createPacker()
  const materials = []
  const materialIndex = new Map()
  const surfaces = rig.surfaces.map((s) => {
    if (!materialIndex.has(s.material)) materialIndex.set(s.material, materials.push(describeMaterial(s.material, search, true)) - 1)
    const material = materialIndex.get(s.material)
    return { material, ...packSurface(push, s, materials[material].normalMap && s.tangents), ...packSkin(push, s) }
  })
  return { bones: rig.bones, surfaces, materials, images: imagesOf(materials, search), geometry: buffer().toString('base64') }
}

// The model a player holding `weapon` (a weapon file name such as mp40_mp) shows in its hand, built like a rig:
// the weapon file's worldModel. Null without one, as for "none".
export function buildWeapon(weapon, search) {
  const file = search.read(`weapons/mp/${weapon}`)?.toString('latin1').split('\\')
  const model = file?.[file.indexOf('worldModel') + 1]
  return model ? buildRig([model], search) : null
}

// The player animation `name` plays (an xanim), or null for one without, such as `root`, which the torso plays when
// only the legs animate.
export function buildAnim(name, search) {
  const buf = search.read(`xanim/${name}`)
  return buf && parseXAnim(buf)
}

// Typed arrays packed one after another, each 4-byte aligned; `push` returns where its array sits.
function createPacker() {
  const chunks = []
  let byteLength = 0
  return {
    push(typed) {
      const ref = { offset: byteLength, count: typed.length }
      chunks.push(Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength))
      byteLength += typed.byteLength
      const pad = (4 - (byteLength % 4)) % 4
      if (pad) { chunks.push(Buffer.alloc(pad)); byteLength += pad }
      return ref
    },
    buffer: () => Buffer.concat(chunks),
  }
}

// The arrays that map and model surfaces share. Tangents and binormals only matter under a normal map, so other
// surfaces leave them out of the page; rebuilt collision faces have none.
function packSurface(push, s, bumped) {
  return {
    positions: push(Float32Array.from(s.positions)),
    normals: push(Float32Array.from(s.normals)),
    colors: s.colors ? push(Uint8Array.from(s.colors)) : null,
    uvs: push(Float32Array.from(s.uvs)),
    tangents: bumped ? push(Float32Array.from(s.tangents)) : null,
    binormals: bumped ? push(Float32Array.from(s.binormals)) : null,
    indices: push(Uint32Array.from(s.indices)),
  }
}

function packSkin(push, s) {
  return { skinIndices: push(Uint16Array.from(s.skinIndices)), skinWeights: push(Float32Array.from(s.skinWeights)) }
}

// Every image the materials draw with, as PNG data URLs; the sky is handled on its own.
function imagesOf(materials, search) {
  const images = {}
  for (const m of materials) {
    if (m.sky || !m.width) continue
    if (!images[m.image]) {
      const img = decodeIwi(search.read(`images/${m.image}.iwi`))
      images[m.image] = { png: pngDataUrl(downscale(img, TEXTURE_SIZE)), alpha: hasAlpha(img.rgba) }
    }
    for (const name of [m.normalMap, m.specularMap]) {
      if (name && !images[name]) images[name] = { png: pngDataUrl(downscale(decodeIwi(search.read(`images/${name}.iwi`)), NORMAL_MAP_SIZE)) }
    }
  }
  return images
}

// A material with an image it can draw has `width`; `missing` says why one has none.
function describeMaterial(name, search, lit) {
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
  // `$identitynormalmap` and other engine images are flat, so they are left out like missing ones.
  // Tool brushes draw unlit, so they never use them.
  const usable = (image) => {
    const buf = lit && !info.tool && image && !image.startsWith('$') && search.read(`images/${image}.iwi`)
    return buf && iwiInfo(buf).format ? image : undefined
  }
  return { ...info, width, height, normalMap: usable(mat.normalMap), specularMap: usable(mat.specularMap) }
}

// The fog the map's script sets: its first setExpFog or setCullFog called with numbers.
function readFog(name, search, scriptDir) {
  const file = scriptDir && join(scriptDir, `${name}.gsc`)
  const script = search.read(`maps/mp/${name}.gsc`) ?? (file && existsSync(file) ? readFileSync(file) : null)
  if (!script) return null
  const code = script.toString('latin1').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')
  for (const [, kind, args] of code.matchAll(/\bset(exp|cull)fog\s*\(([^)]*)\)/gi)) {
    const n = args.split(',').map((a) => (a.trim() ? +a : NaN))
    if (n.some(Number.isNaN)) continue
    const k = kind.toLowerCase()
    if (k === 'exp' && n.length >= 4) return { kind: 'exp', density: n[0], color: n.slice(1, 4) }
    if (k === 'cull' && n.length >= 5) return { kind: 'cull', near: n[0], far: n[1], color: n.slice(2, 5) }
  }
  return null
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
