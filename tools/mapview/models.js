// xmodels at their entities: one InstancedMesh per model surface, placed by origin, angles and modelscale.
// THREE comes from the page script, which imports it before this module runs.
import { anglesToMatrix } from './math.js'

// CoD's Z-up frame to three.js's Y-up one, (x, y, z) -> (x, z, -y), as `toThree` does for points.
const ZUP_TO_YUP = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1)
const YUP_TO_ZUP = ZUP_TO_YUP.clone().invert()

// `geometryOf` turns a packed surface into three.js geometry; `materialOf` gives the material for a material info.
export function buildModels(map, geometryOf, materialOf) {
  const group = new THREE.Group()
  const placed = Map.groupBy(map.entities.filter((e) => e.origin && map.models[e.keys.model]), (e) => e.keys.model)
  for (const [name, entities] of placed) {
    const matrices = entities.map(placement)
    for (const s of map.models[name]) {
      const mesh = new THREE.InstancedMesh(geometryOf(s), materialOf(map.materials[s.material]), matrices.length)
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m))
      mesh.computeBoundingSphere()
      mesh.castShadow = mesh.receiveShadow = true
      group.add(mesh)
    }
  }
  return group
}

// Built in CoD's frame, then moved into three.js's, since the geometry is already converted.
function placement(e) {
  const r = anglesToMatrix(e.angles ?? [0, 0, 0])
  const s = +(e.keys.modelscale || 1)
  const [x, y, z] = e.origin
  const m = new THREE.Matrix4().set(
    r[0][0] * s, r[0][1] * s, r[0][2] * s, x,
    r[1][0] * s, r[1][1] * s, r[1][2] * s, y,
    r[2][0] * s, r[2][1] * s, r[2][2] * s, z,
    0, 0, 0, 1,
  )
  return ZUP_TO_YUP.clone().multiply(m).multiply(YUP_TO_ZUP)
}
