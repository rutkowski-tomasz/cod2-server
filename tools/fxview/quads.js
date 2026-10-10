// The quad a particle draws as at its current age, facing the eye where its type does: four corners in the effect's
// frame, its colour, the material (or 'missing', 'light' or 'model') and atlas frame. `hasTexture` and `hasModel`
// say what the renderer can draw; a model the renderer draws itself gets no quad.
import { sampleVisual } from './sim.js'

export const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] },
}

export function particleQuad(p, eye, viewRight, viewUp, { hasTexture, hasModel }) {
  const vis = sampleVisual(p)
  const d = p.def
  let tex = p.shader ?? 'missing'
  if (p.shader && !hasTexture(p.shader)) tex = 'missing'
  const color = [vis.rgb[0], vis.rgb[1], vis.rgb[2], vis.alpha]
  const w = vis.width, h = vis.height
  if (w <= 0 && d.type !== 'Light') return null
  const rot = (vis.rotation * Math.PI) / 180
  let right, up, center = p.pos
  switch (d.type) {
    case 'Particle':
    case 'Cloud': {
      const c = Math.cos(rot), s = Math.sin(rot)
      right = V.add(V.mul(viewRight, c), V.mul(viewUp, s))
      up = V.sub(V.mul(viewUp, c), V.mul(viewRight, s))
      return quad(center, V.mul(right, w / 2), V.mul(up, h / 2), color, tex, vis.frame)
    }
    case 'Tail': {
      let dir = V.sub(p.pos, p.last)
      if (V.len(dir) < 1e-4) dir = p.vel && V.len(p.vel) > 1e-4 ? p.vel : p.axis[0]
      dir = V.norm(dir)
      const toEye = V.sub(eye, p.pos)
      let side = V.cross(dir, toEye)
      if (V.len(side) < 1e-4) side = viewRight
      side = V.norm(side)
      const len = Math.max(vis.length, w * 0.5)
      center = V.sub(p.pos, V.mul(dir, len / 2))
      return quad(center, V.mul(side, w / 2), V.mul(dir, len / 2), color, tex, vis.frame)
    }
    case 'Line': {
      const along = V.sub(p.end, p.pos)
      if (V.len(along) < 1e-3) return null
      let side = V.cross(along, V.sub(eye, p.pos))
      if (V.len(side) < 1e-4) side = viewRight
      center = V.mul(V.add(p.pos, p.end), 0.5)
      return quad(center, V.mul(V.norm(side), w / 2), V.mul(along, 0.5), color, tex, vis.frame)
    }
    case 'OrientedParticle':
    case 'Decal': {
      const c = Math.cos(rot), s = Math.sin(rot)
      const l = p.effectAxis[1], u = p.effectAxis[2]
      right = V.add(V.mul(l, c), V.mul(u, s))
      up = V.sub(V.mul(u, c), V.mul(l, s))
      if (d.type === 'Decal') center = V.add(p.pos, V.mul(p.effectAxis[0], 0.4))
      return quad(center, V.mul(right, w / 2), V.mul(up, h / 2), color, tex, vis.frame)
    }
    case 'Light': {
      const r = Math.max(8, w)
      return quad(center, V.mul(viewRight, r / 2), V.mul(viewUp, r / 2), [color[0], color[1], color[2], color[3] * 0.35], 'light', 0)
    }
    case 'Emitter': {
      if (hasModel(p.model)) return null
      const size = d.flags.includes('useModel') ? 10 * Math.max(0.2, w) : 4
      return quad(center, V.mul(viewRight, size / 2), V.mul(viewUp, size / 2), d.flags.includes('useModel') ? [0.8, 0.8, 0.8, 1] : [1, 1, 0, 0.6], 'model', 0)
    }
  }
  return null
}

function quad(center, r, u, color, tex, frame) {
  return { corners: [V.sub(V.sub(center, r), u), V.sub(V.add(center, r), u), V.add(V.add(center, r), u), V.add(V.sub(center, r), u)], color, tex, frame }
}
