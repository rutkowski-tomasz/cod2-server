// Effect simulation. Pure JS, no DOM: used by the viewer and by the CLI for stats.
// Units are CoD2 world units, Z up, effect forward = local X. Time in milliseconds.
const STEP = 1000 / 120
const MAX_PARTICLES = 20000
const MAX_DEPTH = 4
// z: pointing up, like playFx without a forward vector or an explosion on the ground. x: level, like a muzzle.
export const FORWARD = { x: [1, 0, 0], z: [0, 0, 1], '-z': [0, 0, -1], '-x': [-1, 0, 0] }

export function createSim(bundle, opts = {}) {
  const rngSeed = opts.seed ?? 1
  const forward = FORWARD[opts.forward ?? 'z']
  const axis = axisFrom(forward, Math.abs(forward[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1])
  const ground = opts.ground === undefined ? 0 : opts.ground
  const origin = [0, 0, 0]
  const sim = {
    time: 0,
    axis,
    particles: [],
    pending: [],
    instances: 0,
    dropped: 0,
    warnings: new Set(),
    duration: effectDuration(bundle, bundle.root, 0, false),
    // Without long-lived decals, used for the slider and default render frames.
    activeDuration: Math.max(100, effectDuration(bundle, bundle.root, 0, true)),
    reset,
    seek,
    counts,
    bounds,
  }
  let rng
  // Whole steps taken since reset. The state always sits on this fixed grid, so a seed gives the same result whatever seeks led there.
  let steps
  reset()
  return sim

  function reset() {
    rng = mulberry32(rngSeed)
    steps = 0
    sim.time = 0
    sim.particles = []
    sim.pending = []
    sim.instances = 0
    sim.dropped = 0
    spawnEffect(bundle.root, origin, axis, 0, 0)
  }

  function seek(t) {
    if (t < steps * STEP) reset()
    while ((steps + 1) * STEP <= t) step()
    sim.time = t
  }

  function step() {
    const t1 = (steps + 1) * STEP
    // Spawn everything due in this step, in time order, so emitters started here still get stepped.
    sim.pending.sort((a, b) => a.time - b.time)
    while (sim.pending.length && sim.pending[0].time <= t1) {
      const s = sim.pending.shift()
      if (s.effect) spawnEffect(s.effect, s.pos, s.axis, s.time, s.depth)
      else spawnParticle(s)
    }
    const dts = STEP / 1000
    const alive = []
    for (const p of sim.particles) {
      if (p.spawnTime > t1) { alive.push(p); continue }
      p.age = t1 - p.spawnTime
      if (p.age >= p.life) { onDeath(p, t1); continue }
      const f = p.age / p.life
      if (p.type !== 'Decal' && p.type !== 'Light') integrate(p, f, dts, t1)
      if (p.dead) continue
      alive.push(p)
    }
    sim.particles = alive
    steps++
  }

  function integrate(p, f, dts, now) {
    const d = p.def
    p.last[0] = p.pos[0]; p.last[1] = p.pos[1]; p.last[2] = p.pos[2]
    // Graph velocities: local graph in the particle axis, second graph in the effect axis, or world when absolute.
    const v = [0, 0, 0]
    const g1 = graphVel(p, f, 'velocityX', 'velocityY', 'velocityZ', p.r.vel, p.hasRandVel)
    const g2 = graphVel(p, f, 'velocity2X', 'velocity2Y', 'velocity2Z', p.r.vel2, p.hasRandVel2)
    addAxis(v, g1, p.absVel ? null : p.axis)
    addAxis(v, g2, p.absVel2 ? null : p.effectAxis)
    p.physVel[2] += p.gravity * dts
    if (d.acceleration) for (let i = 0; i < 3; i++) p.physVel[i] += p.accel[i] * dts
    for (let i = 0; i < 3; i++) v[i] += p.physVel[i] + p.wind[i]
    for (let i = 0; i < 3; i++) p.pos[i] += v[i] * dts
    p.vel = v
    p.rot += rotationRate(p, f) * dts
    if (p.angles) for (let i = 0; i < 3; i++) p.angles[i] += p.angleRate[i] * dts
    if (p.usePhysics && ground !== null && p.pos[2] <= ground && v[2] < 0) {
      p.pos[2] = ground
      // Only the first hit: a resting particle keeps touching the ground every step.
      if (d.impactfx && p.bounces === 0) queueEffect(d.impactfx, [p.pos[0], p.pos[1], ground], axisFrom([0, 0, 1], [1, 0, 0]), now, p.depth + 1)
      if (p.impactKills) {
        p.dead = true
        return
      }
      p.physVel[2] = -p.physVel[2] * p.bounce
      p.physVel[0] *= 0.8
      p.physVel[1] *= 0.8
      p.bounces++
      if (p.bounces > 20) p.physVel[2] = 0
    }
    if (p.type === 'Emitter' && d.emitfx && p.emitEvery > 0) {
      p.travel += dist(p.pos, p.last)
      while (p.travel >= p.emitEvery) {
        p.travel -= p.emitEvery
        queueEffect(d.emitfx, [...p.pos], p.axis, now, p.depth + 1)
      }
    }
  }

  function onDeath(p, now) {
    if (p.type === 'Emitter' && p.def.deathfx && p.def.flags.includes('deathFx')) queueEffect(p.def.deathfx, [...p.pos], p.axis, now, p.depth + 1)
  }

  function queueEffect(path, pos, axis, time, depth) {
    if (depth > MAX_DEPTH) { sim.warnings.add(`sub-effect depth over ${MAX_DEPTH}: ${path}`); return }
    if (!bundle.effects[path]) { sim.warnings.add(`missing effect ${path}`); return }
    sim.pending.push({ effect: path, pos, axis, time, depth })
  }

  function spawnEffect(path, pos, axis, time, depth) {
    const effect = bundle.effects[path]
    if (!effect) return
    sim.instances++
    for (const def of effect.elements) {
      if (def.type === 'CameraShake' || def.type === 'Line') { sim.warnings.add(`${def.type} not rendered (${path})`); continue }
      const count = randInt(def.count)
      const even = def.spawnFlags.includes('evenDistribution')
      for (let i = 0; i < count; i++) {
        const delay = even ? def.delay[0] + (def.delay[1] - def.delay[0]) * ((i + 0.5) / count) : rand(def.delay)
        sim.pending.push({ def, path, index: i, count, time: time + delay, effectPos: pos, effectAxis: axis, depth })
      }
    }
  }

  function spawnParticle(s) {
    if (sim.particles.length >= MAX_PARTICLES) { sim.dropped++; return }
    const d = s.def
    const flags = d.flags
    const axis = d.spawnFlags.includes('axisFromSphere') ? axisFrom(randDir(), randDir()) : s.effectAxis
    const pos = [...s.effectPos]
    if (d.origin) addAxis(pos, randInBox(d.origin), s.effectAxis)
    if (d.spawnFlags.includes('orgOnCylinder')) {
      const a = rng() * Math.PI * 2
      const r = rand(d.radius)
      addAxis(pos, [rand(d.height), Math.cos(a) * r, Math.sin(a) * r], s.effectAxis)
    } else if (d.spawnFlags.includes('orgOnSphere')) {
      const dir = randDir()
      const r = rand(d.radius)
      for (let i = 0; i < 3; i++) pos[i] += dir[i] * r
    }
    if (d.type === 'FxRunner') {
      let runAxis = s.effectAxis
      if (d.spawnFlags.includes('randrotaroundfwd')) runAxis = rotateAroundForward(s.effectAxis, rng() * Math.PI * 2)
      queueEffect(d.playfx, pos, runAxis, s.time, s.depth + 1)
      return
    }
    const windSpeed = rand(d.wind)
    const windAngle = rng() * Math.PI * 2
    const p = {
      def: d,
      type: d.type,
      path: s.path,
      index: s.index,
      depth: s.depth,
      spawnTime: s.time,
      age: 0,
      life: Math.max(1, rand(d.life)),
      pos,
      last: [...pos],
      vel: [0, 0, 0],
      physVel: randInBox(d.velocity),
      accel: d.acceleration ? randInBox(d.acceleration) : null,
      gravity: rand(d.gravity),
      wind: [Math.cos(windAngle) * windSpeed, Math.sin(windAngle) * windSpeed, 0],
      bounce: rand(d.bounce),
      bounces: 0,
      rot: rand(d.rotation),
      axis,
      effectAxis: s.effectAxis,
      absVel: flags.includes('absoluteVel') || d.spawnFlags.includes('absoluteVel'),
      absVel2: flags.includes('absoluteVel2'),
      hasRandVel: flags.includes('useRandomVelocity'),
      hasRandVel2: flags.includes('useRandomVelocity2'),
      usePhysics: flags.includes('usePhysics'),
      impactKills: flags.includes('impactKills'),
      emitEvery: d.emitfx ? Math.max(0, rand(d.density) + (rng() * 2 - 1) * rand(d.variance)) : 0,
      travel: 0,
      shader: d.shaders.length ? d.shaders[Math.floor(rng() * d.shaders.length)] : null,
      atlasFrames: 1,
      model: d.models.length ? d.models[Math.floor(rng() * d.models.length)] : null,
      angles: d.models.length ? randInBox(d.angle) : null,
      angleRate: d.models.length ? randInBox(d.angleDelta) : null,
      r: {
        size: rng(), size2: rng(), length: rng(), rotDelta: rng(), alpha: rng(), rgb: rng(), vel: [rng(), rng(), rng()], vel2: [rng(), rng(), rng()],
        scale: rng(), frame: rng(),
      },
      dead: false,
    }
    const material = bundle.materials[p.shader]
    if (material) p.atlasFrames = material.atlasCols * material.atlasRows
    if (d.velocity && !p.absVel) p.physVel = toWorld(p.physVel, axis)
    if (p.accel && !p.absVel) p.accel = toWorld(p.accel, axis)
    sim.particles.push(p)
  }

  function graphVel(p, f, kx, ky, kz, r, hasRand) {
    const d = p.def
    return [value(d, kx, f, r[0], hasRand, p.r.scale), value(d, ky, f, r[1], hasRand, p.r.scale), value(d, kz, f, r[2], hasRand, p.r.scale)]
  }

  function rotationRate(p, f) {
    return value(p.def, 'rotationDelta', f, p.r.rotDelta, p.def.flags.includes('useRandomRotationDelta'), p.r.scale)
  }

  function counts() {
    const out = {}
    for (const p of sim.particles) if (p.spawnTime <= sim.time) out[`${p.type}:${p.def.name}`] = (out[`${p.type}:${p.def.name}`] ?? 0) + 1
    return out
  }

  // Extent of the effect over its whole life, sampled every 50 ms. `radius` covers 90% of the
  // particle sightings around `center`, weighted by sprite area, so a few stray pebbles do not blow up the frame.
  function bounds() {
    const saved = sim.time
    const lo = [Infinity, Infinity, Infinity]
    const hi = [-Infinity, -Infinity, -Infinity]
    const points = []
    reset()
    for (let t = 0; t <= sim.duration; t += 50) {
      seek(t)
      for (const p of sim.particles) {
        if (p.spawnTime > sim.time || (ground !== null && p.pos[2] < ground - 2)) continue
        const s = sampleSize(p)
        const pad = Math.max(s[0], s[1]) / 2
        points.push([p.pos[0], p.pos[1], p.pos[2], pad])
        for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p.pos[i] - pad); hi[i] = Math.max(hi[i], p.pos[i] + pad) }
      }
    }
    reset()
    seek(saved)
    if (!points.length) return { lo: origin, hi: origin, center: origin, radius: 48 }
    const weight = (q) => 1 + q[3] * q[3]
    const center = [0, 1, 2].map((i) => weightedPercentile(points.map((q) => [q[i], weight(q)]), 0.5))
    const radius = weightedPercentile(points.map((q) => [Math.hypot(q[0] - center[0], q[1] - center[1], q[2] - center[2]) + q[3], weight(q)]), 0.9)
    return { lo, hi, center, radius }
  }

  function rand(range) {
    return range[0] + (range[1] - range[0]) * rng()
  }
  // `box` is [min corner, max corner] or null.
  function randInBox(box) {
    if (!box) return [0, 0, 0]
    return [rand([box[0][0], box[1][0]]), rand([box[0][1], box[1][1]]), rand([box[0][2], box[1][2]])]
  }
  function randInt(range) {
    return Math.round(rand(range))
  }
  function randDir() {
    const z = rng() * 2 - 1
    const a = rng() * Math.PI * 2
    const r = Math.sqrt(1 - z * z)
    return [Math.cos(a) * r, Math.sin(a) * r, z]
  }
}

// Visual state at the particle's current age: all per-particle randomness is fixed at spawn.
export function sampleVisual(p) {
  const d = p.def
  const f = Math.min(1, Math.max(0, p.age / p.life))
  const flags = d.flags
  const rgb = colorAt(d.curves.rgb, f)
  if (flags.includes('useRandomColors') && d.curves.rgbRand) {
    const rr = colorAt(d.curves.rgbRand, f)
    for (let i = 0; i < 3; i++) rgb[i] = Math.min(1, rgb[i] + rr[i] * p.r.rgb)
  }
  const alpha = Math.min(1, Math.max(0, value(d, 'alpha', f, p.r.alpha, flags.includes('useRandomAlpha'), p.r.scale)))
  const size = sampleSize(p)
  const length = value(d, 'length', f, p.r.length, flags.includes('useRandomLength'), p.r.scale)
  return { rgb, alpha, width: size[0], height: size[1], length, rotation: p.rot, frame: atlasFrame(p, f) }
}

function sampleSize(p) {
  const d = p.def
  const f = Math.min(1, Math.max(0, p.age / p.life))
  const w = value(d, 'size', f, p.r.size, d.flags.includes('useRandomSize'), p.r.scale)
  const h = d.nonUniformScale ? value(d, 'size2', f, p.r.size2, d.flags.includes('useRandomSize2'), p.r.scale) : w
  return [Math.max(0, w), Math.max(0, h)]
}

function atlasFrame(p, f) {
  const s = p.def.sequence
  const frames = p.atlasFrames
  if (frames <= 1) return 0
  let start = s.startMode === 1 ? Math.floor(p.r.frame * frames) : s.startMode === 2 ? p.index : s.fixedFrame
  let played
  if (s.playRateMode === 1) played = f * frames
  else played = (p.age / 1000) * (s.fps || 0)
  if (s.loopMode === 1 && s.loopTimes > 0) played = Math.min(played, frames * s.loopTimes - 0.001)
  return (start + Math.floor(played)) % frames
}

function value(d, key, f, r, useRand, rScale) {
  const curve = d.curves[key]
  if (!curve) return 0
  const scale = d.scales[key] ?? [1, 1]
  let v = scalarAt(curve, f)
  if (useRand && d.curves[key + 'Rand']) v += r * scalarAt(d.curves[key + 'Rand'], f)
  return v * (scale[0] + (scale[1] - scale[0]) * rScale)
}

function scalarAt(curve, f) {
  if (curve.length === 1) return curve[0][1]
  if (f <= curve[0][0]) return curve[0][1]
  for (let i = 1; i < curve.length; i++) {
    if (f <= curve[i][0]) {
      const a = curve[i - 1]
      const b = curve[i]
      const span = b[0] - a[0]
      return span <= 0 ? b[1] : a[1] + (b[1] - a[1]) * ((f - a[0]) / span)
    }
  }
  return curve[curve.length - 1][1]
}

function colorAt(curve, f) {
  if (!curve) return [1, 1, 1]
  const pick = (i) => [curve[i][1] ?? 1, curve[i][2] ?? 1, curve[i][3] ?? 1]
  if (curve.length === 1 || f <= curve[0][0]) return pick(0)
  for (let i = 1; i < curve.length; i++) {
    if (f <= curve[i][0]) {
      const span = curve[i][0] - curve[i - 1][0]
      const k = span <= 0 ? 1 : (f - curve[i - 1][0]) / span
      const a = pick(i - 1)
      const b = pick(i)
      return a.map((x, j) => x + (b[j] - x) * k)
    }
  }
  return pick(curve.length - 1)
}

// Upper bound: a runner starts its effect at its delay, other sub-effects start at the latest before the particle dies.
function effectDuration(bundle, path, depth, skipDecals) {
  const effect = bundle.effects[path]
  if (!effect || depth > MAX_DEPTH) return 0
  const sub = (p) => (p ? effectDuration(bundle, p, depth + 1, skipDecals) : 0)
  let max = 0
  for (const d of effect.elements) {
    if (skipDecals && d.type === 'Decal') continue
    const end = d.type === 'FxRunner' ? d.delay[1] + sub(d.playfx) : d.delay[1] + d.life[1] + Math.max(sub(d.emitfx), sub(d.impactfx), sub(d.deathfx))
    max = Math.max(max, end)
  }
  return max
}

// World axis of a model particle: its own axis turned by its pitch, yaw and roll in degrees.
export function modelAxis(p) {
  const [sp, sy, sr] = p.angles.map((a) => Math.sin((a * Math.PI) / 180))
  const [cp, cy, cr] = p.angles.map((a) => Math.cos((a * Math.PI) / 180))
  const local = [
    [cp * cy, cp * sy, -sp],
    [sr * sp * cy - cr * sy, sr * sp * sy + cr * cy, sr * cp],
    [cr * sp * cy + sr * sy, cr * sp * sy - sr * cy, cr * cp],
  ]
  return local.map((v) => toWorld(v, p.axis))
}

// Axis: rows forward, left, up (CoD convention: X forward, Y left, Z up).
function axisFrom(forward, upHint) {
  const f = norm(forward)
  let l = cross(upHint, f)
  if (len(l) < 1e-6) l = cross([0, 1, 0], f)
  l = norm(l)
  const u = cross(f, l)
  return [f, l, u]
}

function rotateAroundForward(axis, angle) {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const l = axis[1].map((x, i) => x * c + axis[2][i] * s)
  const u = axis[2].map((x, i) => x * c - axis[1][i] * s)
  return [axis[0], l, u]
}

function toWorld(v, axis) {
  const out = [0, 0, 0]
  addAxis(out, v, axis)
  return out
}

function addAxis(out, v, axis) {
  if (!axis) { out[0] += v[0]; out[1] += v[1]; out[2] += v[2]; return }
  for (let i = 0; i < 3; i++) out[i] += v[0] * axis[0][i] + v[1] * axis[1][i] + v[2] * axis[2][i]
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
function len(a) {
  return Math.hypot(a[0], a[1], a[2])
}
function norm(a) {
  const l = len(a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function weightedPercentile(pairs, fraction) {
  const sorted = [...pairs].sort((a, b) => a[0] - b[0])
  const total = sorted.reduce((s, p) => s + p[1], 0)
  let acc = 0
  for (const [value, w] of sorted) { acc += w; if (acc >= total * fraction) return value }
  return sorted[sorted.length - 1][0]
}

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
