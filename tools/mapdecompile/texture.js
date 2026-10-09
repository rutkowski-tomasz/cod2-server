// cod2map's texture projection (BuildTextureVecs) and its inverse. A face's texture is u = S·p + Sw, v = T·p + Tw,
// with S and T built from an axial basis picked by the face normal, then width, height, shift, rotation and skew.
import { dot } from './vec.js'

export const DEFAULT_TEXTURE = { width: 64, height: 64, shiftX: 0, shiftY: 0, rotation: 0, skew: 0 }

// Axes in cod2map's order, +Z, -Z, +X, -X, +Y, -Y; ties go to the first.
const AXES = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]]
const BASIS = [
  [[1, 0, 0], [0, -1, 0]], [[1, 0, 0], [0, -1, 0]],
  [[0, 1, 0], [0, 0, -1]], [[0, 1, 0], [0, 0, -1]],
  [[1, 0, 0], [0, 0, -1]], [[1, 0, 0], [0, 0, -1]],
]

// The basis vectors and the coordinate each one reads.
export function textureBasis(normal) {
  let best = 0
  let bestDot = 0
  AXES.forEach((a, i) => { const d = dot(normal, a); if (d > bestDot) { bestDot = d; best = i } })
  const [xVec, yVec] = BASIS[best]
  return { xVec, yVec, s: xVec.findIndex((c) => c !== 0), t: yVec.findIndex((c) => c !== 0) }
}

// The UV a face with this texture gives a point.
export function textureUv(normal, { width, height, shiftX, shiftY, rotation, skew }) {
  const { xVec, yVec, s, t } = textureBasis(normal)
  const rad = rotation * Math.PI / 180
  const sx = xVec[s] / width
  const ty = yVec[t] / height
  const S = [0, 0, 0]
  const T = [0, 0, 0]
  S[s] = Math.cos(rad) * sx
  S[t] = Math.sin(rad) * sx
  T[s] = -Math.sin(rad) * ty
  T[t] = Math.cos(rad) * ty
  for (let k = 0; k < 3; k++) S[k] += skew * T[k]
  return (p) => [dot(S, p) - shiftX / width, dot(T, p) - shiftY / height]
}

// The texture that maps three points to their UVs. Draw UVs drop whole repeats, so shifts come back modulo the size.
export function solveTexture(normal, positions, uvs) {
  const { xVec, yVec, s, t } = textureBasis(normal)
  const coords = positions.map((p) => [p[s], p[t]])
  const [A, B, C] = solveAffine(coords, uvs.map((uv) => uv[0]))
  const [D, E, F] = solveAffine(coords, uvs.map((uv) => uv[1]))
  if (![A, B, C, D, E, F].every(Number.isFinite)) return null
  const height = 1 / Math.hypot(D, E)
  const ty = yVec[t] / height
  const cos = E / ty
  const sin = -D / ty
  const width = xVec[s] / (A * cos + B * sin)
  return {
    width, height,
    shiftX: wrap(-C * width, Math.abs(width)),
    shiftY: wrap(-F * height, height),
    rotation: Math.atan2(sin, cos) * 180 / Math.PI,
    skew: (-A * sin + B * cos) / ty,
  }
}

function solveAffine([[a0, b0], [a1, b1], [a2, b2]], [v0, v1, v2]) {
  const det = (a1 - a0) * (b2 - b0) - (a2 - a0) * (b1 - b0)
  const A = ((v1 - v0) * (b2 - b0) - (v2 - v0) * (b1 - b0)) / det
  const B = ((a1 - a0) * (v2 - v0) - (a2 - a0) * (v1 - v0)) / det
  return [A, B, v0 - A * a0 - B * b0]
}

const wrap = (x, m) => ((x % m) + m) % m
