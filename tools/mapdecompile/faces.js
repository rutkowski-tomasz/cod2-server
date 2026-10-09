// Turns collision brushes back into Radiant faces: clips each side to its polygon and drops the bevels the compiler added.
import { dot, cross, sub, add, scale, normalize } from './vec.js'

const HUGE = 1 << 18
const ON_PLANE = 0.05
const MIN_AREA = 0.1
const DUPLICATE_NORMAL = 1 - 1e-5

// Sides with area, each with its polygon. `sides` are { normal, dist, material }, the solid side being normal·p <= dist.
export function brushFaces(sides) {
  const faces = []
  for (const side of sides) {
    if (faces.some((f) => dot(f.normal, side.normal) > DUPLICATE_NORMAL && Math.abs(f.dist - side.dist) < ON_PLANE)) continue
    let poly = basePolygon(side)
    for (const other of sides) if (other !== side && poly.length) poly = clip(poly, other)
    if (poly.length >= 3 && area(poly, side.normal) > MIN_AREA) faces.push({ ...side, polygon: poly })
  }
  return faces
}

function basePolygon({ normal, dist }) {
  const helper = Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  const u = scale(normalize(cross(helper, normal)), HUGE)
  const v = scale(normalize(cross(normal, u)), HUGE)
  const c = scale(normal, dist)
  return [add(add(c, u), v), add(sub(c, u), v), sub(sub(c, u), v), sub(add(c, u), v)]
}

function clip(poly, { normal, dist }) {
  const out = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const da = dot(normal, a) - dist
    const db = dot(normal, b) - dist
    if (da <= ON_PLANE) out.push(a)
    if ((da < -ON_PLANE && db > ON_PLANE) || (da > ON_PLANE && db < -ON_PLANE)) out.push(add(a, scale(sub(b, a), da / (da - db))))
  }
  return out
}

function area(poly, normal) {
  let sum = [0, 0, 0]
  for (let i = 1; i + 1 < poly.length; i++) sum = add(sum, cross(sub(poly[i], poly[0]), sub(poly[i + 1], poly[0])))
  return Math.abs(dot(sum, normal)) / 2
}

// Three points on the face, ordered so Radiant's (p0 - p1) × (p2 - p1) points out of the brush.
export function planePoints({ polygon, normal }) {
  const p0 = polygon[0]
  const p1 = polygon.reduce((best, p) => (dot(sub(p, p0), sub(p, p0)) > dot(sub(best, p0), sub(best, p0)) ? p : best))
  const spread = (p) => Math.abs(dot(cross(sub(p1, p0), sub(p, p0)), normal))
  const p2 = polygon.reduce((best, p) => (spread(p) > spread(best) ? p : best))
  return dot(cross(sub(p0, p1), sub(p2, p1)), normal) > 0 ? [p0, p1, p2] : [p2, p1, p0]
}

export function insidePolygon(point, { polygon, normal }) {
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    if (dot(cross(sub(b, a), sub(point, a)), normal) < -ON_PLANE) return false
  }
  return true
}

export function onPlane(points, { normal, dist }) {
  return points.every((p) => Math.abs(dot(normal, p) - dist) < ON_PLANE)
}
