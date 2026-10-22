// Turns loaded meshes into an XMODEL_EXPORT model: game axes and inches, the file's bones under a root bone
// tag_origin, triangles wound as the game winds them.
import { createHash } from 'node:crypto'
import { Matrix3, Matrix4, Euler, Vector3, Quaternion } from 'three'

const CLOCKWISE = [0, 2, 1]

// The game stores a bone's parent in a signed byte.
const MAX_BONES = 128

// The converter takes at most 5450 vertices per object and material, counted after it splits vertices whose
// tangents differ, as at mirrored UV seams: about a tenth more on a character.
const OBJECT_VERTICES = 4000

// `place`: from three.js axes and the file's units to the game's (see placement).
// `loop`: the animations, by their name in the file, that loop.
export function buildModel({ meshes, bones, animations, materials: loaded }, { name, place, loop }) {
  const materials = mergeMaterials(meshes, loaded)
  if (bones.length + 1 > MAX_BONES) throw new Error(`${bones.length} bones and tag_origin: the game takes at most ${MAX_BONES}`)
  const vertices = []
  const faces = []
  const objects = []
  for (const mesh of meshes) {
    const first = vertices.length
    // Bone 0 is tag_origin, so the file's bones move up one and its root (-1) becomes 0.
    for (let i = 0; i < mesh.positions.length / 3; i++) vertices.push({ position: place.point(at(mesh.positions, i, 3)), weights: mesh.weights[i].map(([b, w]) => [b + 1, w]) })
    const prefix = (mesh.name || 'mesh').replace(/\W+/g, '_')
    // Per material, the object its triangles go to until it is full.
    const open = new Map()
    for (let t = 0; t < mesh.triangles.length / 4; t++) {
      const material = mesh.triangles[t * 4 + 3]
      const triangle = CLOCKWISE.map((k) => mesh.triangles[t * 4 + k])
      let object = open.get(material)
      if (!object || object.vertices.size + triangle.filter((i) => !object.vertices.has(i)).length > OBJECT_VERTICES) {
        object = { index: objects.push(`${prefix}_${objects.length}`) - 1, vertices: new Set() }
        open.set(material, object)
      }
      triangle.forEach((i) => object.vertices.add(i))
      const corners = triangle.map((i, k) => ({
        vertex: first + i,
        normal: place.direction(at(mesh.normals, i, 3)),
        color: mesh.colors.length ? at(mesh.colors, i, 4) : [1, 1, 1, 1],
        // The converter keeps UVs as written, and the game's v grows down the image.
        uv: at(mesh.uvs, t * 3 + CLOCKWISE[k], 2),
      }))
      faces.push({ object: object.index, material, corners })
    }
  }
  const materialNames = materials.map((m, i) => `${name}_${i}`)
  return {
    bones: [ORIGIN, ...placeBones(bones, place)],
    // Only bones can be animated: a model without them is rigid.
    animations: bones.length ? placeAnimations(animations, name, [name, ...materialNames], place, loop) : [],
    vertices,
    faces,
    objects,
    materials: materials.map((m, i) => ({ name: materialNames[i], image: `${materialNames[i]}.tga`, pixels: m.pixels, alpha: m.alpha, doubleSided: m.doubleSided })),
  }
}

// The materials the triangles use, each once: a file often repeats one under several names. Triangles are moved to the
// first of each.
function mergeMaterials(meshes, materials) {
  const used = new Set(meshes.flatMap((mesh) => mesh.triangles.filter((_, i) => i % 4 === 3)))
  const first = new Map()
  const index = materials.map((m, i) => {
    if (!used.has(i)) return -1
    const key = [m.alpha, m.doubleSided, m.pixels.width, m.pixels.height, createHash('sha1').update(m.pixels.rgba).digest('hex')].join()
    if (!first.has(key)) first.set(key, first.size)
    return first.get(key)
  })
  for (const mesh of meshes) for (let t = 3; t < mesh.triangles.length; t += 4) mesh.triangles[t] = index[mesh.triangles[t]]
  return materials.filter((m, i) => index[i] >= 0 && index.indexOf(index[i]) === i)
}

const ORIGIN = { name: 'tag_origin', parent: -1, position: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }

// Each bone's place in the game's space (see placeMatrix) and parent below tag_origin; names made unique and safe.
function placeBones(bones, place) {
  const names = new Set(['tag_origin'])
  return bones.map((b) => {
    let name = (b.name || 'bone').replace(/\W+/g, '_')
    while (names.has(name.toLowerCase())) name += '_'
    names.add(name.toLowerCase())
    return { name, parent: b.parent + 1, ...placeMatrix(b.matrix, place) }
  })
}

// Every frame's bones placed as placeBones places them, tag_origin first and still.
function placeAnimations(animations, modelName, taken, place, loop) {
  return nameAnimations(animations, modelName, taken, loop).map((a) => ({ ...a, frames: a.frames.map((bones) => [ORIGIN, ...bones.map((m) => placeMatrix(m, place))]) }))
}

// Names each animation `<model>_<animation>`, apart from `taken`, the other entries of its GDT, and marks the ones
// `loop` names (by their name in the file, or `all`) as looping: their last frame is their first again, which the
// converter drops.
export function nameAnimations(animations, modelName, taken, loop) {
  const unknown = loop.filter((l) => l !== 'all' && !animations.some((a) => a.name === l))
  if (unknown.length) throw new Error(`--loop: no animation ${unknown.join(', ')}; the file has ${animations.map((a) => a.name).join(', ') || 'none'}`)
  const names = new Set(taken)
  return animations.map((a) => {
    let name = `${modelName}_${(a.name || 'anim').replace(/\W+/g, '_')}`.toLowerCase()
    while (names.has(name)) name += '_'
    names.add(name)
    return { name, frames: a.frames, looping: loop.includes('all') || loop.includes(a.name) }
  })
}

// A world matrix's position and X, Y, Z axes in the game's space, its scale left out.
function placeMatrix(matrix, place) {
  const position = new Vector3()
  const rotation = new Quaternion()
  new Matrix4().fromArray(matrix).decompose(position, rotation, new Vector3())
  const rotationMatrix = new Matrix4().makeRotationFromQuaternion(rotation)
  const axes = [0, 1, 2].map((k) => place.direction(new Vector3().setFromMatrixColumn(rotationMatrix, k).toArray()))
  return { position: place.point(position.toArray()), axes }
}

// three.js models face +Z with +Y up; the game's face +X with +Z up. `scale` is inches per unit; `rotate`
// (pitch, yaw, roll in degrees, as the game's angles) and `offset` (inches) then place the model.
export function placement({ scale, rotate = [0, 0, 0], offset = [0, 0, 0] }) {
  const toGame = new Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1)
  // A positive pitch tips the front down: a turn about +Y.
  const [pitch, yaw, roll] = rotate.map((d) => (d * Math.PI) / 180)
  const turn = new Matrix4().makeRotationFromEuler(new Euler(roll, pitch, yaw, 'ZYX')).multiply(toGame)
  const matrix = new Matrix4().makeTranslation(...offset).multiply(turn).multiply(new Matrix4().makeScale(scale, scale, scale))
  const normalMatrix = new Matrix3().setFromMatrix4(turn)
  const v = new Vector3()
  return {
    point: (p) => v.fromArray(p).applyMatrix4(matrix).toArray(),
    direction: (d) => v.fromArray(d).applyMatrix3(normalMatrix).toArray(),
  }
}

function at(array, i, size) {
  return array.slice(i * size, i * size + size)
}
