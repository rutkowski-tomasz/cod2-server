// Rebuilds a Radiant .map (iwmap 4) from a compiled map: entities, collision brushes with their texture
// alignment, and every draw triangle that lies on no brush face (terrain, curves, decals) as a mesh.
import { readBsp } from '../shared/bsp.js'
import { brushFaces, planePoints, insidePolygon, onPlane } from './faces.js'
import { solveTexture, textureUv, textureBasis, DEFAULT_TEXTURE } from './texture.js'
import { dot, cross, sub, add, scale, normalize } from './vec.js'

const CELL = 512
const UV_TOLERANCE = 0.01
const ORIGIN_HALF = 8
const SAME_NORMAL = 0.999
// The compiled map keeps only the pieces of portal brushes the compiler cut, and those fail to compile again.
const PORTAL = /^portal/
// Node boxes are whole units.
const BOX_SLACK = 1
const BRUSH_LIGHTMAP = 'lightmap_gray 16384 16384 0 0 0 0'
const MESH_LIGHTMAP = 'lightmap_gray'
// Mesh UVs are stored in 1/1024 of a repeat, lightmap UVs in 16-unit luxels.
const UV_UNITS = 1024
const LUXEL = 16

export function decompile(buf) {
  const { entities, models, vertex, nodes, collisionTriangles } = readBsp(buf)
  const splits = groupBy(nodes.flatMap((node) => [[planeKey(node.normal, node.dist), node], [planeKey(scale(node.normal, -1), -node.dist), node]]))
  const collision = new CollisionGrid(collisionTriangles)
  const stats = { brushes: 0, detail: 0, textured: 0, meshes: 0, nonColliding: 0, portals: 0 }
  const blocks = entities.map((entity, index) => {
    // misc_model ground lighting the compiler adds.
    const { gndLt, ...keys } = entity.keys
    const model = index === 0 ? 0 : /^\*(\d+)$/.exec(keys.model ?? '')?.[1]
    if (model === undefined) return entityText(keys, [])
    delete keys.model
    // A brush model with an origin was built around its origin brush; its geometry is stored relative to it.
    const offset = index > 0 && keys.origin ? keys.origin.split(/\s+/).map(Number) : null
    if (offset) delete keys.origin
    const triangles = models[model].soups.flatMap((soup) => soup.triangles.map((t) => ({ material: soup.material, vertices: t.map(vertex) })))
    return entityText(keys, brushModelText(models[model].brushes, triangles, offset, index === 0 ? splits : null, collision, stats))
  })
  return { text: `iwmap 4\n${blocks.join('\n')}\n`, stats }
}

// Only world brushes can be detail. cod2map builds the world's BSP tree from the faces of structural brushes alone,
// and the compiled map keeps no detail flag, so a brush with no face splitting a node comes back as detail.
// Meshes collide unless they are `nonColliding`. Patch collision is stored like the model's geometry, relative to its origin.
function brushModelText(brushes, soupTriangles, offset, splits, collision, stats) {
  const triangles = soupTriangles.filter((tri) => !PORTAL.test(tri.material)).map((tri) => placed(tri, offset)).filter(Boolean)
  const grid = new TriangleGrid(triangles)
  const out = []
  for (const sides of brushes) {
    if (sides.some((s) => PORTAL.test(s.material))) { stats.portals++; continue }
    const moved = offset ? sides.map((s) => ({ ...s, dist: s.dist + dot(s.normal, offset) })) : sides
    const faces = brushFaces(moved).map((face) => ({ ...face, texture: faceTexture(face, grid, stats) }))
    const detail = splits !== null && !faces.some((f) => splitsNode(f, splits))
    out.push(brushText(faces, detail))
    stats.brushes++
    if (detail) stats.detail++
  }
  if (offset) out.push(originBrush(offset))
  for (const tri of triangles.filter((t) => !t.covered)) {
    const nonColliding = !collision.touches(tri.storedPositions)
    out.push(meshText(tri, nonColliding))
    stats.meshes++
    if (nonColliding) stats.nonColliding++
  }
  return out
}

// The alignment most draw triangles on the face agree with is the face's, and those triangles are the brush's.
// Others on it, such as a flush non-colliding brush with the same material, stay meshes.
function faceTexture(face, grid, stats) {
  const candidates = [...grid.near(face)].filter((tri) => tri.material === face.material
    && dot(tri.normal, face.normal) > SAME_NORMAL && onPlane(tri.positions, face) && insidePolygon(tri.centroid, face))
  let best = { texture: DEFAULT_TEXTURE, matching: [] }
  for (const tri of candidates) {
    if (best.matching.includes(tri)) continue
    const texture = solveTexture(face.normal, tri.positions, tri.uvs)
    if (!texture) continue
    const uvOf = textureUv(face.normal, texture)
    const matching = candidates.filter((c) => c.positions.every((p, k) => sameUv(uvOf(p), c.uvs[k])))
    if (matching.length > best.matching.length) best = { texture, matching }
    if (best.matching.length * 2 > candidates.length) break
  }
  for (const tri of best.matching) tri.covered = true
  if (best.matching.length) stats.textured++
  return best.texture
}

// Draw UVs drop whole repeats.
const sameUv = (a, b) => [0, 1].every((k) => { const d = a[k] - b[k]; return Math.abs(d - Math.round(d)) < UV_TOLERANCE })

// The triangle moved by the offset, with what face matching needs; null when it has no area.
function placed({ material, vertices }, offset) {
  const moved = offset ? vertices.map((v) => ({ ...v, position: add(v.position, offset) })) : vertices
  const positions = moved.map((v) => v.position)
  const n = cross(sub(positions[1], positions[0]), sub(positions[2], positions[0]))
  if (dot(n, n) === 0) return null
  return {
    material, vertices: moved, positions, uvs: moved.map((v) => v.uv), normal: normalize(n),
    centroid: centroid(positions), storedPositions: vertices.map((v) => v.position), covered: false,
  }
}

const centroid = ([a, b, c]) => scale(add(add(a, b), c), 1 / 3)

class TriangleGrid {
  constructor(triangles) {
    this.cells = groupBy(triangles.map((tri) => [cellKey(tri.centroid), tri]))
  }

  *near({ polygon }) {
    for (const key of cellKeys(polygon)) yield* this.cells.get(key) ?? []
  }
}

// Patch collision triangles as faces, each listed in every cell its bounds touch.
class CollisionGrid {
  constructor(triangles) {
    this.points = new Set(triangles.flat().map(pointKey))
    const faces = triangles.flatMap((polygon) => {
      const n = cross(sub(polygon[1], polygon[0]), sub(polygon[2], polygon[0]))
      if (dot(n, n) === 0) return []
      const normal = normalize(n)
      return [{ polygon, normal, dist: dot(normal, polygon[0]) }]
    })
    this.cells = groupBy(faces.flatMap((face) => [...cellKeys(face.polygon)].map((key) => [key, face])))
  }

  // A draw triangle that collided shares a vertex with patch collision (curves, whose collision is coarser)
  // or has its centre on a collision triangle (terrain split another way).
  touches(positions) {
    if (positions.some((p) => this.points.has(pointKey(p)))) return true
    const center = centroid(positions)
    return (this.cells.get(cellKey(center)) ?? []).some((face) => onPlane([center], face) && insidePolygon(center, face))
  }
}

const cellKey = (point) => point.map((c) => Math.floor(c / CELL)).join()

function* cellKeys(points) {
  const lo = [0, 1, 2].map((k) => Math.floor(Math.min(...points.map((p) => p[k])) / CELL))
  const hi = [0, 1, 2].map((k) => Math.floor(Math.max(...points.map((p) => p[k])) / CELL))
  for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) yield `${x},${y},${z}`
}

function entityText(keys, geometry) {
  const lines = Object.entries(keys).map(([k, v]) => `"${k}" "${v}"`)
  return ['{', ...lines, ...geometry, '}'].join('\n')
}

function brushText(faces, detail = false) {
  const lines = faces.map((face) => {
    const points = planePoints(face).map((p) => `( ${p.map(num).join(' ')} )`).join(' ')
    const { width, height, shiftX, shiftY, rotation, skew } = face.texture
    return ` ${points} ${face.material} ${[width, height, shiftX, shiftY, rotation, skew].map(num).join(' ')} ${BRUSH_LIGHTMAP}`
  })
  return [' {', ...(detail ? ['  contents detail;'] : []), ...lines, ' }'].join('\n')
}

function originBrush(origin) {
  const [lo, hi] = [-ORIGIN_HALF, ORIGIN_HALF].map((d) => origin.map((c) => c + d))
  const sides = [0, 1, 2].flatMap((axis) => [-1, 1].map((sign) => {
    const normal = [0, 0, 0]
    normal[axis] = sign
    return { normal, dist: sign * (sign > 0 ? hi : lo)[axis], material: 'origin', texture: DEFAULT_TEXTURE }
  }))
  return brushText(brushFaces(sides))
}

// One 2x2 mesh per triangle, rows (a, c) and (b, b): a mesh faces (row step) × (column step), here (b - a) × (c - a).
function meshText(tri, nonColliding) {
  const { xVec, yVec } = textureBasis(tri.normal)
  const vertex = ({ position, uv, color }) => {
    const lightmap = [dot(xVec, position) / LUXEL, dot(yVec, position) / LUXEL]
    return `   v ${position.map(num).join(' ')} c ${color.join(' ')} t ${[uv[0] * UV_UNITS, uv[1] * UV_UNITS, ...lightmap].map(num).join(' ')}`
  }
  const [a, b, c] = tri.vertices
  return [' {', '  mesh', '  {', ...(nonColliding ? ['  contents nonColliding;'] : []), `   ${tri.material}`, `   ${MESH_LIGHTMAP}`, '   2 2 0 1', '   (', vertex(a), vertex(c), '   )', '   (', vertex(b), vertex(b), '   )', '  }', ' }'].join('\n')
}

// The face lies on the node's plane, inside the box the node splits.
function splitsNode({ normal, dist, polygon }, splits) {
  const lo = [0, 1, 2].map((k) => Math.min(...polygon.map((p) => p[k])))
  const hi = [0, 1, 2].map((k) => Math.max(...polygon.map((p) => p[k])))
  return (splits.get(planeKey(normal, dist)) ?? []).some((node) => [0, 1, 2].every((k) => lo[k] < node.maxs[k] + BOX_SLACK && hi[k] > node.mins[k] - BOX_SLACK))
}

function groupBy(pairs) {
  const map = new Map()
  for (const [key, value] of pairs) {
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(value)
  }
  return map
}

// Equal floats from the same lump give equal keys.
const planeKey = (normal, dist) => [...normal, dist].map((x) => Math.round(x * 100) / 100 + 0).join()
const pointKey = (p) => p.map((x) => Math.round(x * 10) / 10 + 0).join()

// Integers stay integers; everything else keeps three decimals.
function num(x) {
  const r = Math.round(x * 1000) / 1000
  return Object.is(r, -0) ? '0' : String(r)
}
