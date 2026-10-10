// Reads compiled CoD2 maps (.d3dbsp, IBSP version 4): entities, brush models with their collision brushes and draw
// soups, lightmaps, the world's BSP nodes, and the triangles of patch collision.
const LUMP = { MATERIALS: 0, LIGHTMAPS: 1, PLANES: 4, BRUSHSIDES: 5, BRUSHES: 6, TRISOUPS: 7, DRAWVERTS: 8, DRAWINDICES: 9, NODES: 25, COLLISIONVERTS: 29, COLLISIONTRIS: 31, MODELS: 35, ENTITIES: 37 }
const MATERIAL_BYTES = 72
const MATERIAL_NAME_BYTES = 64
const PLANE_BYTES = 16
const BRUSHSIDE_BYTES = 8
const BRUSH_BYTES = 4
const TRISOUP_BYTES = 16
const VERTEX_BYTES = 68
const NODE_BYTES = 36
const COLLISIONVERT_BYTES = 16
const COLLISIONTRI_BYTES = 72
const COLLISIONTRI_VERTICES = 48
const NO_VERTEX = -1
// Barycentric (s, t) of a collision triangle's corners.
const CORNER_ST = [[0, 0], [1, 0], [0, 1]]
const MODEL_BYTES = 48
const NO_LIGHTMAP = 31
// The first six sides of every brush are its bounds, stored as distances: -X, +X, -Y, +Y, -Z, +Z.
const AXIAL_SIDES = 6
// A lightmap holds three 512x512 RGBA pages of directional coefficients for R, G and B, then sun visibility
// as one 1024x1024 grey page, the size of one RGBA page.
const LIGHTMAP_PAGE = 512
const SUN_PAGE = LIGHTMAP_PAGE * 2

// Model 0 is the world; model n belongs to the entity whose model key is *n.
// Brushes are their sides { normal, dist, material, surface, contents }, the solid side being normal·p <= dist, with
// the surface and content flags cod2map stored with the side's material; one name can come with several sets.
// Soup triangles are vertex numbers for `vertex`, counter-clockwise from the front.
export function readBsp(buf) {
  if (buf.toString('latin1', 0, 4) !== 'IBSP') throw new Error('not an IBSP file')
  const version = buf.readUInt32LE(4)
  if (version !== 4) throw new Error(`unsupported IBSP version ${version} (expected 4, CoD2)`)
  const lump = (i) => buf.subarray(buf.readUInt32LE(12 + i * 8), buf.readUInt32LE(12 + i * 8) + buf.readUInt32LE(8 + i * 8))

  const mats = lump(LUMP.MATERIALS)
  const materials = []
  const materialFlags = []
  for (let o = 0; o + MATERIAL_BYTES <= mats.length; o += MATERIAL_BYTES) {
    materials.push(mats.toString('latin1', o, o + MATERIAL_NAME_BYTES).replace(/\0.*$/s, ''))
    materialFlags.push({ surface: mats.readUInt32LE(o + MATERIAL_NAME_BYTES), contents: mats.readUInt32LE(o + MATERIAL_NAME_BYTES + 4) })
  }

  const pl = lump(LUMP.PLANES)
  const plane = (index) => {
    const o = index * PLANE_BYTES
    return { normal: [pl.readFloatLE(o), pl.readFloatLE(o + 4), pl.readFloatLE(o + 8)], dist: pl.readFloatLE(o + 12) }
  }
  const brushes = readBrushes(lump(LUMP.BRUSHSIDES), lump(LUMP.BRUSHES), plane, materials, materialFlags)
  const soups = readSoups(lump(LUMP.TRISOUPS), lump(LUMP.DRAWINDICES), materials)

  const ml = lump(LUMP.MODELS)
  const models = []
  for (let o = 0; o + MODEL_BYTES <= ml.length; o += MODEL_BYTES) {
    const firstSoup = ml.readUInt32LE(o + 24)
    const firstBrush = ml.readUInt32LE(o + 40)
    models.push({ soups: soups.slice(firstSoup, firstSoup + ml.readUInt32LE(o + 28)), brushes: brushes.slice(firstBrush, firstBrush + ml.readUInt32LE(o + 44)) })
  }

  const nd = lump(LUMP.NODES)
  const nodes = []
  for (let o = 0; o + NODE_BYTES <= nd.length; o += NODE_BYTES) {
    const bounds = [0, 1, 2, 3, 4, 5].map((k) => nd.readInt32LE(o + 12 + k * 4))
    nodes.push({ ...plane(nd.readInt32LE(o)), mins: bounds.slice(0, 3), maxs: bounds.slice(3) })
  }
  const collisionTriangles = readCollisionTriangles(lump(LUMP.COLLISIONVERTS), lump(LUMP.COLLISIONTRIS))

  const lm = lump(LUMP.LIGHTMAPS)
  const pageBytes = LIGHTMAP_PAGE * LIGHTMAP_PAGE * 4
  const lightmaps = []
  for (let o = 0; o + pageBytes * 4 <= lm.length; o += pageBytes * 4) {
    const page = (p) => lm.subarray(o + p * pageBytes, o + (p + 1) * pageBytes)
    const coefficients = [0, 1, 2].map((p) => ({ width: LIGHTMAP_PAGE, height: LIGHTMAP_PAGE, rgba: page(p) }))
    lightmaps.push([...coefficients, sunPage(page(3))])
  }

  return {
    entities: parseEntities(lump(LUMP.ENTITIES).toString('latin1')),
    models, vertex: vertexReader(lump(LUMP.DRAWVERTS)), lightmaps, nodes, collisionTriangles,
  }
}

function sunPage(grey) {
  const rgba = Buffer.alloc(grey.length * 4, 255)
  for (let i = 0; i < grey.length; i++) rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = grey[i]
  return { width: SUN_PAGE, height: SUN_PAGE, rgba }
}

function readBrushes(bs, br, plane, materials, materialFlags) {
  const brushes = []
  let side = 0
  for (let o = 0; o + BRUSH_BYTES <= br.length; o += BRUSH_BYTES) {
    const sides = []
    for (let k = 0; k < br.readUInt16LE(o); k++, side++) {
      const so = side * BRUSHSIDE_BYTES
      const index = bs.readUInt32LE(so + 4)
      const material = materials[index]
      const { surface, contents } = materialFlags[index]
      if (k < AXIAL_SIDES) {
        const sign = k % 2 ? 1 : -1
        const normal = [0, 0, 0]
        normal[k >> 1] = sign
        sides.push({ normal, dist: sign * bs.readFloatLE(so), material, surface, contents })
      } else {
        sides.push({ ...plane(bs.readUInt32LE(so)), material, surface, contents })
      }
    }
    brushes.push(sides)
  }
  return brushes
}

// D3D front faces are clockwise, so each triangle is flipped.
function readSoups(ts, di, materials) {
  const soups = []
  for (let o = 0; o + TRISOUP_BYTES <= ts.length; o += TRISOUP_BYTES) {
    const lightmap = ts.readUInt16LE(o + 2)
    const firstVertex = ts.readUInt32LE(o + 4)
    const firstIndex = ts.readUInt32LE(o + 12)
    const triangles = []
    for (let t = 0; t + 2 < ts.readUInt16LE(o + 10); t += 3) triangles.push([0, 2, 1].map((k) => firstVertex + di.readUInt16LE((firstIndex + t + k) * 2)))
    soups.push({ material: materials[ts.readUInt16LE(o)], lightmap: lightmap === NO_LIGHTMAP ? -1 : lightmap, triangles })
  }
  return soups
}

// A triangle is its plane and the planes on which its barycentric s and t grow by 1, each as (x, y, z, w) with
// v·p - w the value, then three vertex numbers. A corner with no vertex stored is where s and t meet the plane.
function readCollisionTriangles(cv, ct) {
  const position = (i) => [4, 8, 12].map((k) => cv.readFloatLE(i * COLLISIONVERT_BYTES + k))
  const triangles = []
  for (let o = 0; o + COLLISIONTRI_BYTES <= ct.length; o += COLLISIONTRI_BYTES) {
    const [plane, s, t] = [0, 16, 32].map((k) => [0, 4, 8, 12].map((j) => ct.readFloatLE(o + k + j)))
    triangles.push(CORNER_ST.map(([cornerS, cornerT], k) => {
      const i = ct.readInt32LE(o + COLLISIONTRI_VERTICES + k * 4)
      return i === NO_VERTEX ? solvePlanes([plane, s, t], [plane[3], s[3] + cornerS, t[3] + cornerT]) : position(i)
    }))
  }
  return triangles
}

// The point p with rows[k]·p = values[k], by Cramer's rule.
function solvePlanes([a, b, c], values) {
  const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
  const [bc, ca, ab] = [cross(b, c), cross(c, a), cross(a, b)]
  const det = a[0] * bc[0] + a[1] * bc[1] + a[2] * bc[2]
  return [0, 1, 2].map((k) => (values[0] * bc[k] + values[1] * ca[k] + values[2] * ab[k]) / det)
}

function vertexReader(dv) {
  return (i) => {
    const o = i * VERTEX_BYTES
    return {
      position: [dv.readFloatLE(o), dv.readFloatLE(o + 4), dv.readFloatLE(o + 8)],
      normal: [dv.readFloatLE(o + 12), dv.readFloatLE(o + 16), dv.readFloatLE(o + 20)],
      // Stored as BGRA.
      color: [dv[o + 26], dv[o + 25], dv[o + 24], dv[o + 27]],
      uv: [dv.readFloatLE(o + 28), dv.readFloatLE(o + 32)],
      lmuv: [dv.readFloatLE(o + 36), dv.readFloatLE(o + 40)],
      tangent: [dv.readFloatLE(o + 44), dv.readFloatLE(o + 48), dv.readFloatLE(o + 52)],
      binormal: [dv.readFloatLE(o + 56), dv.readFloatLE(o + 60), dv.readFloatLE(o + 64)],
    }
  }
}

function parseEntities(text) {
  const entities = []
  for (const m of text.matchAll(/\{([^}]*)\}/g)) {
    const keys = {}
    for (const kv of m[1].matchAll(/"([^"]*)"\s*"([^"]*)"/g)) keys[kv[1]] = kv[2]
    entities.push({ classname: keys.classname || '', keys })
  }
  return entities
}
