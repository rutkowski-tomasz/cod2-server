// Makes a gun that a stock weapon's animations can play: a viewmodel for first person and a world model for third,
// fitted to the stock weapon's, with the meshes named in `parts` moving on the stock gun's bones (bolt, clip…).
import { Quaternion, Vector3 } from 'three'
import { createSearch } from '../shared/assets.js'
import { parseXModel, parseParts, parseSurfaces, readRig } from '../shared/xmodel.js'
import { readWeaponFile, xmodelPath } from '../mapview/bundle.js'
import { parseXAnim } from '../mapview/xanim.js'

const IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]

// The weapon file under weapons/mp/, read as modelview reads it: nL's iwds over the stock ones. Its viewmodel's
// bones, each with where the idle animation holds it relative to j_gun, and the bounds of the vertices on j_gun; its
// world model's bones placed at rest, and the bounds of all its vertices.
export function readStockWeapon(weapon) {
  const search = createSearch()
  const read = (path) => search.read(path) ?? fail(`${path}, which weapons/mp/${weapon} names, not found`)
  const file = readWeaponFile(weapon, search) ?? fail(`weapons/mp/${weapon} not found (are the stock iwds in ~/Dev/cod2-binaries?)`)
  if (!file.gunModel || !file.worldModel) fail(`weapons/mp/${weapon} has no gunModel or worldModel`)
  const idle = parseXAnim(read(`xanim/${file.idleAnim}`))
  const view = parseXModel(read(xmodelPath(file.gunModel)))
  const viewBones = parseParts(read(`xmodelparts/${view.surfaces}`))
  if (viewBones[0].name !== 'j_gun') fail(`${file.gunModel}'s root bone is ${viewBones[0].name}, not j_gun`)
  const world = readRig([xmodelPath(file.worldModel)], search) ?? fail(`${file.worldModel} not found`)
  return {
    file,
    view: { bones: heldBones(viewBones, idle), ...bounds(parseSurfaces(read(`xmodelsurfs/${view.surfaces}`)), (s, v) => s.skinIndices[v * 4] === 0) },
    world: { bones: world.bones, ...bounds(world.surfaces, () => true) },
  }
}

function fail(message) {
  throw new Error(message)
}

// Each bone where the idle animation holds it in j_gun's space: its keys are relative to its parent.
function heldBones(bones, idle) {
  const out = []
  for (const b of bones) {
    const track = idle.bones.find((t) => t.name === b.name)
    const position = new Vector3(...(track?.translations?.values.slice(0, 3) ?? [0, 0, 0]))
    const rotation = new Quaternion(...(track?.rotations?.values.slice(0, 4) ?? [0, 0, 0, 1]))
    const parent = out[b.parent]
    const held = parent
      ? { position: position.applyQuaternion(parent.held.rotation).add(parent.held.position), rotation: parent.held.rotation.clone().multiply(rotation) }
      : { position: new Vector3(), rotation: new Quaternion() }
    out.push({ name: b.name, parent: b.parent, keyed: !parent || !!track?.translations || !!track?.rotations, held })
  }
  return out
}

function bounds(surfaces, counts) {
  const min = new Vector3(Infinity, Infinity, Infinity)
  const max = min.clone().negate()
  for (const s of surfaces) {
    for (let v = 0; v < s.positions.length / 3; v++) {
      if (!counts(s, v)) continue
      const p = new Vector3(...s.positions.slice(v * 3, v * 3 + 3))
      min.min(p)
      max.max(p)
    }
  }
  if (min.x > max.x) fail('the stock gun has no vertices to fit to')
  return { min, max }
}

// `model`: buildModel's, the gun facing +X. `parts`: mesh name to stock gun bone. The gun is moved onto the stock
// one's body, and scaled to its length unless `keepScale`; then moved by `offset`. Returns the viewmodel and the
// world model, sharing the gun's materials.
export function buildWeapon(model, stock, parts, keepScale, offset = [0, 0, 0]) {
  const boneOf = model.vertices.map(() => 0)
  for (const [mesh, bone] of Object.entries(parts)) {
    const index = stock.view.bones.findIndex((b) => b.name === bone)
    if (index < 0) fail(`--parts: the stock gun has no bone ${bone}; it has ${stock.view.bones.map((b) => b.name).join(', ')}`)
    if (!stock.view.bones[index].keyed) fail(`--parts: the idle animation does not place ${bone}, so its part would sit wrong`)
    const ranges = model.meshVertices.filter((m) => m.name === mesh)
    if (!ranges.length) fail(`--parts: no mesh ${mesh}; the file has ${[...new Set(model.meshVertices.map((m) => m.name))].join(', ')}`)
    for (const { first, count } of ranges) for (let v = first; v < first + count; v++) boneOf[v] = index
  }
  return {
    view: gunModel(model, fitted(model, stock.view, keepScale, offset), boneOf, stock.view.bones),
    world: worldModel(model, fitted(model, stock.world, keepScale, offset), stock.world.bones),
  }
}

// Every vertex position, moved so the gun's bounds are centred on the stock model's and scaled to its length
// unless `keepScale`, then moved by `offset`.
function fitted(model, stock, keepScale, offset) {
  const positions = model.vertices.map((v) => new Vector3(...v.position))
  const min = new Vector3(Infinity, Infinity, Infinity)
  const max = min.clone().negate()
  for (const p of positions) min.min(p), max.max(p)
  const scale = keepScale ? 1 : (stock.max.x - stock.min.x) / (max.x - min.x)
  const centre = min.clone().add(max).multiplyScalar(0.5)
  const target = stock.min.clone().add(stock.max).multiplyScalar(0.5).add(new Vector3(...offset))
  return positions.map((p) => p.clone().sub(centre).multiplyScalar(scale).add(target))
}

// The stock viewmodel's bones, all at the origin as the animations place them; a vertex on a moving part is stored
// where it is relative to that part's bone as the idle animation holds it, so the animation puts it back in place.
function gunModel(model, positions, boneOf, bones) {
  const unheld = (v) => bones[boneOf[v]].held.rotation.clone().invert()
  return {
    ...model,
    bones: bones.map((b) => ({ name: b.name, parent: b.parent, position: [0, 0, 0], axes: IDENTITY })),
    vertices: model.vertices.map((v, i) => ({ position: positions[i].clone().sub(bones[boneOf[i]].held.position).applyQuaternion(unheld(i)).toArray(), weights: [[boneOf[i], 1]] })),
    faces: model.faces.map((f) => ({ ...f, corners: f.corners.map((c) => ({ ...c, normal: new Vector3(...c.normal).applyQuaternion(unheld(c.vertex)).toArray() })) })),
  }
}

// The stock world model's bones at rest, its tags where it has them; every vertex on its root, tag_weapon.
function worldModel(model, positions, bones) {
  const placed = []
  for (const b of bones) {
    const parent = placed[b.parent]
    const rotation = new Quaternion(...b.rotation)
    const offset = new Vector3(...(b.fileOffset ?? b.offset))
    placed.push(parent
      ? { position: offset.applyQuaternion(parent.rotation).add(parent.position), rotation: parent.rotation.clone().multiply(rotation) }
      : { position: offset, rotation })
  }
  return {
    ...model,
    bones: bones.map((b, i) => ({ name: b.name, parent: b.parent, position: placed[i].position.toArray(), axes: axesOf(placed[i].rotation) })),
    vertices: model.vertices.map((v, i) => ({ position: positions[i].toArray(), weights: [[0, 1]] })),
  }
}

function axesOf(rotation) {
  return IDENTITY.map((a) => new Vector3(...a).applyQuaternion(rotation).toArray())
}

// The stock weapon file with the gun's models in it; the file is pairs of fields split by backslashes.
export function weaponFile(stockFile, viewModel, worldModel) {
  const file = { ...stockFile, gunModel: viewModel, worldModel: `xmodel/${worldModel}` }
  return `WEAPONFILE${Object.entries(file).map(([k, v]) => `\\${k}\\${v}`).join('')}`
}

// The stock asset that already has the name, which the gun's would replace in game; nL's own guns can be updated.
export function takenName(name) {
  const search = createSearch()
  const stock = (path) => [...search.readAll(path)].some((copy) => copy.path.includes('/cod2-binaries/'))
  return [`xmodel/viewmodel_${name}`, `xmodel/weapon_${name}`, `weapons/mp/${name}_mp`].find(stock)
}
