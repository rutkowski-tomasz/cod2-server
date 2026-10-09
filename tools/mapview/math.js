const d2r = Math.PI / 180

// CoD angle vector (pitch, yaw, roll) → forward unit vector.
export function anglesToForward([p, y]) {
  const cp = Math.cos(p * d2r), sp = Math.sin(p * d2r), cy = Math.cos(y * d2r), sy = Math.sin(y * d2r)
  return [cp * cy, cp * sy, -sp]
}

// Rotation matrix (row-major 3x3) for CoD angles: yaw about Z, then pitch about Y, then roll about X.
export function anglesToMatrix([p, y, r]) {
  const cp = Math.cos(p * d2r), sp = Math.sin(p * d2r)
  const cy = Math.cos(y * d2r), sy = Math.sin(y * d2r)
  const cr = Math.cos(r * d2r), sr = Math.sin(r * d2r)
  return [
    [cp * cy, sr * sp * cy - cr * sy, cr * sp * cy + sr * sy],
    [cp * sy, sr * sp * sy + cr * cy, cr * sp * sy - sr * cy],
    [-sp, sr * cp, cr * cp],
  ]
}

export function applyMatrix(m, v, t = [0, 0, 0]) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2] + t[0],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2] + t[1],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2] + t[2],
  ]
}

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const length = (a) => Math.sqrt(dot(a, a))
export function normalize(a) {
  const l = length(a)
  return l > 0 ? scale(a, 1 / l) : [0, 0, 0]
}
