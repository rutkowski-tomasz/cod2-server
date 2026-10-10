// Brush faces from bare planes, as compiled maps store brushes.
const EPS = 0.01
const HUGE = 1 << 17

// The brush is the space inside every plane (n·x <= d); each plane's face is a huge quad cut by the others.
export function planePolygons(planes) {
  const polys = []
  for (let i = 0; i < planes.length; i++) {
    const pl = planes[i]
    if (dot(pl.n, pl.n) < 0.5) continue
    let poly = basePolygon(pl.n, pl.d)
    for (let j = 0; j < planes.length && poly.length; j++) {
      if (j === i) continue
      poly = clip(poly, planes[j].n, planes[j].d)
    }
    if (poly.length >= 3) polys.push({ points: poly, normal: pl.n, side: pl.side })
  }
  return polys
}

function basePolygon(n, d) {
  const ax = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])]
  let up = [0, 0, 1]
  if (ax[2] >= ax[0] && ax[2] >= ax[1]) up = [1, 0, 0]
  const right = normalize(cross(up, n))
  up = normalize(cross(n, right))
  const o = scale(n, d)
  const r = scale(right, HUGE), u = scale(up, HUGE)
  return [add(add(o, r), u), add(sub(o, r), u), sub(sub(o, r), u), sub(add(o, r), u)]
}

// Keeps the part of the polygon on the inner side of the plane (n·x - d <= 0).
function clip(poly, n, d) {
  const dist = poly.map((p) => dot(n, p) - d)
  if (dist.every((x) => x <= EPS)) return poly
  if (dist.every((x) => x >= -EPS)) return []
  const out = []
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length
    const a = poly[i], b = poly[j], da = dist[i], db = dist[j]
    if (da <= EPS) out.push(a)
    if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
      const t = da / (da - db)
      out.push(add(a, scale(sub(b, a), t)))
    }
  }
  return out
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const normalize = (a) => scale(a, 1 / (Math.sqrt(dot(a, a)) || 1))
