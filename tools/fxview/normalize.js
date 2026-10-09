// Raw parsed element → uniform element definition the simulation understands.
// Every numeric property becomes a [min, max] range, every graph a sorted point list.
const CURVE_KEYS = ['rgb', 'rgbRand', 'alpha', 'alphaRand', 'size', 'sizeRand', 'size2', 'size2Rand', 'length', 'lengthRand',
  'rotationDelta', 'rotationDeltaRand', 'velocityX', 'velocityY', 'velocityZ', 'velocityXRand', 'velocityYRand', 'velocityZRand',
  'velocity2X', 'velocity2Y', 'velocity2Z', 'velocity2XRand', 'velocity2YRand', 'velocity2ZRand']
const COLOR_KEYS = new Set(['rgb', 'rgbRand'])
const DEFAULT_CURVE = { rgb: [[0, 1, 1, 1], [1, 1, 1, 1]], alpha: [[0, 1], [1, 1]], size: [[0, 1], [1, 1]], size2: [[0, 1], [1, 1]], length: [[0, 1], [1, 1]] }

export function normalizeElement(raw) {
  const flags = new Set(raw.flags ?? [])
  const curves = {}
  const scales = {}
  for (const key of CURVE_KEYS) {
    const block = raw[key]
    const isColor = COLOR_KEYS.has(key)
    if (block?.curve) {
      curves[key] = block.curve.map((row) => (Array.isArray(row) ? row : [row])).map((row) => (isColor ? row.slice(0, 4) : row.slice(0, 2)))
      scales[key] = block.scale ? range(block.scale) : [1, 1]
    } else if (block?.start || block?.end) {
      // Old style graph: start/end values with an optional random second value; a missing start means 1.
      const s = block.start ?? (isColor ? [1, 1, 1] : [1])
      const e = block.end ?? s
      if (isColor) {
        curves[key] = [[0, ...s.slice(0, 3)], [1, ...e.slice(0, 3)]]
      } else {
        curves[key] = [[0, s[0]], [1, e[0]]]
        if (s.length > 1 || e.length > 1) {
          curves[key + 'Rand'] = [[0, (s[1] ?? s[0]) - s[0]], [1, (e[1] ?? e[0]) - e[0]]]
          scales[key + 'Rand'] = [1, 1]
          flags.add(`useRandom${key[0].toUpperCase()}${key.slice(1)}`)
        }
      }
      scales[key] = [1, 1]
    } else if (DEFAULT_CURVE[key]) {
      curves[key] = DEFAULT_CURVE[key]
      scales[key] = [1, 1]
    }
  }
  const seq = {
    startMode: raw.sequenceStartFrameMode?.[0] ?? 0,
    fixedFrame: raw.sequenceFixedFrameValue?.[0] ?? 0,
    fps: raw.sequenceFixedFpsValue?.[0] ?? 0,
    playRateMode: raw.sequencePlayRateMode?.[0] ?? 0,
    loopMode: raw.sequenceLoopMode?.[0] ?? 0,
    loopTimes: raw.sequenceLoopTimes?.[0] ?? 0,
  }
  return {
    type: raw.type,
    name: Array.isArray(raw.name) ? raw.name.join(' ') : raw.name ?? raw.type,
    flags: [...flags],
    spawnFlags: raw.spawnFlags ?? [],
    count: range(raw.count ?? [1]),
    life: range(raw.life ?? [1000]),
    delay: range(raw.delay ?? [0]),
    origin: box(raw.origin),
    radius: range(raw.radius ?? [0]),
    height: range(raw.height ?? [0]),
    rotation: range(raw.rotation ?? [0]),
    gravity: range(raw.gravity ?? [0]),
    wind: range(raw.wind ?? [0]),
    bounce: range(raw.bounce ?? [0]),
    density: range(raw.density ?? [0]),
    variance: range(raw.variance ?? [0]),
    velocity: box(raw.velocity),
    acceleration: box(raw.acceleration),
    angle: box(raw.angle),
    angleDelta: box(raw.angleDelta),
    nonUniformScale: !!raw.nonUniformScale?.[0],
    curves,
    scales,
    sequence: seq,
    shaders: raw.shaders ?? [],
    models: (raw.models ?? []).map((m) => m.replace(/\\/g, '/')),
    playfx: fxPath(raw.playfx),
    emitfx: fxPath(raw.emitfx),
    impactfx: fxPath(raw.impactfx),
    deathfx: fxPath(raw.deathfx),
  }
}

function range(v) {
  if (!Array.isArray(v)) v = [v]
  const a = Number(v[0]) || 0
  const b = v.length > 1 ? Number(v[1]) || 0 : a
  return [Math.min(a, b), Math.max(a, b)]
}

// 3 numbers → fixed point, 6 numbers → min/max corners.
function box(v) {
  if (!v) return null
  const n = v.map(Number)
  const lo = n.slice(0, 3)
  const hi = n.length >= 6 ? n.slice(3, 6) : lo
  return [lo.map((x, i) => Math.min(x, hi[i])), lo.map((x, i) => Math.max(x, hi[i]))]
}

function fxPath(v) {
  if (!v) return null
  const s = Array.isArray(v) ? v[0] : v
  return String(s).replace(/^\/+/, '').replace(/\.efx$/, '')
}
