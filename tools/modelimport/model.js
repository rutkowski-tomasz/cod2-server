// Turns loaded meshes into an XMODEL_EXPORT model: game axes and inches, one root bone, triangles wound as the
// game winds them.
import { Matrix3, Matrix4, Euler, Vector3 } from 'three'

// The converter takes at most 5450 vertices per object and material.
const OBJECT_VERTICES = 5000

// `place`: from three.js axes and the file's units to the game's (see placement).
export function buildModel({ meshes, materials }, { name, place }) {
  const vertices = []
  const faces = []
  const objects = []
  for (const mesh of meshes) {
    const first = vertices.length
    for (let i = 0; i < mesh.positions.length / 3; i++) vertices.push({ position: place.point(at(mesh.positions, i, 3)), weights: [[0, 1]] })
    const prefix = (mesh.name || 'mesh').replace(/\W+/g, '_')
    // Per material, the object its triangles go to until it is full.
    const open = new Map()
    for (let t = 0; t < mesh.triangles.length; t += 4) {
      const material = mesh.triangles[t + 3]
      const triangle = [0, 2, 1].map((k) => mesh.triangles[t + k])
      let object = open.get(material)
      if (!object || object.vertices.size + triangle.filter((i) => !object.vertices.has(i)).length > OBJECT_VERTICES) {
        object = { index: objects.push(`${prefix}_${objects.length}`) - 1, vertices: new Set() }
        open.set(material, object)
      }
      triangle.forEach((i) => object.vertices.add(i))
      const corners = triangle.map((i) => ({
        vertex: first + i,
        normal: place.direction(at(mesh.normals, i, 3)),
        color: mesh.colors.length ? at(mesh.colors, i, 4) : [1, 1, 1, 1],
        // XMODEL_EXPORT's v grows up the image, as Maya's does.
        uv: mesh.uvs.length ? [mesh.uvs[i * 2], 1 - mesh.uvs[i * 2 + 1]] : [0, 0],
      }))
      faces.push({ object: object.index, material, corners })
    }
  }
  return {
    bones: [{ name: 'tag_origin', parent: -1, position: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }],
    vertices,
    faces,
    objects,
    materials: materials.map((m, i) => ({ name: `${name}_${i}`, image: `${name}_${i}.tga`, pixels: solid(m.color) })),
  }
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

// An 8×8 image of one colour.
function solid(color) {
  const rgba = Buffer.alloc(8 * 8 * 4)
  for (let p = 0; p < 64; p++) rgba.set([...color.map((c) => Math.round(c * 255)), 255], p * 4)
  return { width: 8, height: 8, rgba }
}

function at(array, i, size) {
  return array.slice(i * size, i * size + size)
}
