// Turns brushes (from .map sides or bare planes) and patches into triangle meshes grouped by material.
import { cross, dot, normalize, sub } from './math.js'
import { planePolygons } from '../shared/planes.js'

// A .map side names its plane by three points on it.
function brushPolygons(brush) {
  return planePolygons(brush.sides.map((s) => {
    const [a, b, c] = s.points
    const n = normalize(cross(sub(c, a), sub(b, a)))
    return { n, d: dot(n, a), side: s }
  }))
}

// Texture coordinates follow cod2map: axial projection by dominant normal, rotation, then offset and size.
function faceUv(point, normal, side) {
  const ax = [Math.abs(normal[0]), Math.abs(normal[1]), Math.abs(normal[2])]
  let s, t
  if (ax[2] >= ax[0] && ax[2] >= ax[1]) { s = point[0]; t = -point[1] }
  else if (ax[0] >= ax[1]) { s = point[1]; t = -point[2] }
  else { s = point[0]; t = -point[2] }
  const r = (side.rot || 0) * Math.PI / 180
  const cs = Math.cos(r), sn = Math.sin(r)
  const rs = s * cs - t * sn, rt = s * sn + t * cs
  return [(rs - side.offU) / (side.sizeU || 256), (rt - side.offV) / (side.sizeV || 256)]
}

// Accumulates triangles per material; vertices carry position, normal and uv.
export class MeshBuilder {
  constructor() { this.groups = new Map() }

  // Patches get their own groups: they draw from both sides, since which side Radiant treats as the front is not known.
  group(material, doubleSided = false) {
    const key = `${material}/${doubleSided}`
    if (!this.groups.has(key)) this.groups.set(key, { material, doubleSided, positions: [], normals: [], uvs: [], indices: [] })
    return this.groups.get(key)
  }

  addBrush(brush) {
    this.addPolygons(brushPolygons(brush))
  }

  // `side` gives each polygon its material and texture mapping.
  addPolygons(polys) {
    for (const poly of polys) {
      const g = this.group(poly.side.material)
      const base = g.positions.length / 3
      for (const p of poly.points) {
        g.positions.push(p[0], p[1], p[2])
        g.normals.push(poly.normal[0], poly.normal[1], poly.normal[2])
        const uv = faceUv(p, poly.normal, poly.side)
        g.uvs.push(uv[0], uv[1])
      }
      for (let k = 1; k + 1 < poly.points.length; k++) g.indices.push(base, base + k, base + k + 1)
    }
  }

  addPatch(patch) {
    const grid = patch.kind === 'curve' ? tessellateCurve(patch.rows) : patch.rows
    if (grid.length < 2 || grid[0].length < 2) return
    const g = this.group(patch.material, true)
    const base = g.positions.length / 3
    const rows = grid.length, cols = grid[0].length
    const normals = gridNormals(grid)
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const p = grid[i][j]
      g.positions.push(p.pos[0], p.pos[1], p.pos[2])
      const n = normals[i][j]
      g.normals.push(n[0], n[1], n[2])
      g.uvs.push(p.uv[0], p.uv[1])
    }
    for (let i = 0; i + 1 < rows; i++) for (let j = 0; j + 1 < cols; j++) {
      const a = base + i * cols + j, b = a + 1, c = a + cols, d = c + 1
      g.indices.push(a, c, b, b, c, d)
    }
  }

  result() {
    return [...this.groups.values()].filter((g) => g.indices.length)
  }
}

function gridNormals(grid) {
  const rows = grid.length, cols = grid[0].length
  const out = []
  for (let i = 0; i < rows; i++) {
    out.push([])
    for (let j = 0; j < cols; j++) {
      const di = sub(grid[Math.min(i + 1, rows - 1)][j].pos, grid[Math.max(i - 1, 0)][j].pos)
      const dj = sub(grid[i][Math.min(j + 1, cols - 1)].pos, grid[i][Math.max(j - 1, 0)].pos)
      let n = normalize(cross(di, dj))
      if (dot(n, n) < 0.5) n = [0, 0, 1]
      out[i].push(n)
    }
  }
  return out
}

// Biquadratic Bezier patch like Radiant curves: 3x3 control points per span, SUBDIV segments each.
const SUBDIV = 6
function tessellateCurve(rows) {
  const h = rows.length, w = rows[0].length
  if (h < 3 || w < 3) return rows
  const spansI = (h - 1) >> 1, spansJ = (w - 1) >> 1
  const grid = []
  for (let si = 0; si < spansI; si++) {
    for (let a = 0; a <= SUBDIV; a++) {
      if (si > 0 && a === 0) continue
      const row = []
      const u = a / SUBDIV
      for (let sj = 0; sj < spansJ; sj++) {
        for (let b = 0; b <= SUBDIV; b++) {
          if (sj > 0 && b === 0) continue
          const v = b / SUBDIV
          row.push(bezier2d(rows, si * 2, sj * 2, u, v))
        }
      }
      grid.push(row)
    }
  }
  return grid
}

function bezier2d(rows, i0, j0, u, v) {
  const bu = [(1 - u) * (1 - u), 2 * u * (1 - u), u * u]
  const bv = [(1 - v) * (1 - v), 2 * v * (1 - v), v * v]
  const pos = [0, 0, 0], uv = [0, 0]
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
    const wgt = bu[a] * bv[b]
    const p = rows[i0 + a][j0 + b]
    pos[0] += p.pos[0] * wgt; pos[1] += p.pos[1] * wgt; pos[2] += p.pos[2] * wgt
    uv[0] += p.uv[0] * wgt; uv[1] += p.uv[1] * wgt
  }
  return { pos, uv }
}
