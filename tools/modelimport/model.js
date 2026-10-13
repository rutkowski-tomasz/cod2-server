// Turns loaded meshes into an XMODEL_EXPORT model: game axes and inches, the file's bones under a root bone
// tag_origin, triangles wound as the game winds them.
import { Matrix3, Matrix4, Euler, Vector3, Quaternion } from 'three'

const CLOCKWISE = [0, 2, 1]

// The game stores a bone's parent in a signed byte.
const MAX_BONES = 128

// The converter takes at most 5450 vertices per object and material, counted after it splits vertices whose
// tangents differ, as at mirrored UV seams: about a tenth more on a character.
const OBJECT_VERTICES = 4000

// `place`: from three.js axes and the file's units to the game's (see placement).
export function buildModel({ meshes, bones, materials }, { name, place }) {
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
  return {
    bones: [{ name: 'tag_origin', parent: -1, position: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }, ...placeBones(bones, place)],
    vertices,
    faces,
    objects,
    materials: materials.map((m, i) => ({ name: `${name}_${i}`, image: `${name}_${i}.tga`, pixels: m.pixels, alpha: m.alpha, doubleSided: m.doubleSided })),
  }
}

// Each bone's position and X, Y, Z axes in the game's space, its scale left out; names made unique and safe.
function placeBones(bones, place) {
  const names = new Set(['tag_origin'])
  const position = new Vector3()
  const rotation = new Quaternion()
  const rotationMatrix = new Matrix4()
  return bones.map((b) => {
    new Matrix4().fromArray(b.matrix).decompose(position, rotation, new Vector3())
    rotationMatrix.makeRotationFromQuaternion(rotation)
    const axes = [0, 1, 2].map((k) => place.direction(new Vector3().setFromMatrixColumn(rotationMatrix, k).toArray()))
    let name = (b.name || 'bone').replace(/\W+/g, '_')
    while (names.has(name.toLowerCase())) name += '_'
    names.add(name.toLowerCase())
    return { name, parent: b.parent + 1, position: place.point(position.toArray()), axes }
  })
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
