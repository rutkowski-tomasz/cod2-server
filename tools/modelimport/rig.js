// Binds a standing humanoid mesh to CoD2's multiplayer player skeleton, for a player body the game's animations move:
// the skeleton's joints are fitted to the mesh's shape, and each vertex follows the bones nearest it.
import { Matrix4, Quaternion, Vector3 } from 'three'

// A player is this many inches tall; the mesh is scaled to it.
const HEIGHT = 70
const SAMPLES = 60000

// Each fitted bone and the point it is turned to face, as the stock bone faces that bone: tips are points of the mesh.
const AIM = {
  j_mainroot: ['j_spine1', 'j_spine1'],
  j_spine1: ['j_spine2', 'j_spine2'],
  j_spine2: ['j_spine3', 'j_spine3'],
  j_spine3: ['j_spine4', 'j_spine4'],
  j_spine4: ['j_neck', 'j_neck'],
  j_neck: ['j_head', 'j_head'],
  ...limbAims('le'),
  ...limbAims('ri'),
}

function limbAims(s) {
  return {
    [`j_hip_${s}`]: [`j_knee_${s}`, `j_knee_${s}`],
    [`j_knee_${s}`]: [`j_ankle_${s}`, `j_ankle_${s}`],
    [`j_ankle_${s}`]: [`j_ball_${s}`, `j_ball_${s}`],
    [`j_clavicle_${s}`]: [`j_shoulder_${s}`, `j_shoulder_${s}`],
    [`j_shoulder_${s}`]: [`j_elbow_${s}`, `j_elbow_${s}`],
    [`j_elbow_${s}`]: [`j_wrist_${s}`, `j_wrist_${s}`],
    [`j_wrist_${s}`]: [`j_mid_${s}_1`, `hand_${s}`],
  }
}

// The stretches of the body a vertex can follow, from one fitted point to the next, and the bone that moves them: the
// one whose turn carries the far end.
// How far past the nearest bone's distance, in the bones' thicknesses, another bone still shares a vertex, and at most
// how many share it.
const BLEND = 0.5
const MAX_WEIGHTS = 3
const OVERSHOOT = 3

const SEGMENTS = [
  ['j_mainroot', 'j_spine1', 'torso_stabilizer'],
  ['j_spine1', 'j_spine2', 'back_low'],
  ['j_spine2', 'j_spine3', 'back_mid'],
  ['j_spine3', 'j_spine4', 'back_up'],
  // The neck and head move with the chest: a rigid head split between bones tears across the face.
  ['j_spine4', 'j_neck', 'j_spine4'],
  ['j_neck', 'j_head', 'j_spine4'],
  ['j_head', 'top', 'j_spine4'],
  ...['le', 'ri'].flatMap((s) => [
    ['j_mainroot', `j_hip_${s}`, 'pelvis'],
    [`j_hip_${s}`, `j_knee_${s}`, `j_hip_${s}`],
    [`j_knee_${s}`, `j_ankle_${s}`, `j_knee_${s}`],
    [`j_ankle_${s}`, `j_ball_${s}`, `j_ankle_${s}`],
    [`j_ball_${s}`, `toe_${s}`, `j_ball_${s}`],
    [`j_spine4`, `j_clavicle_${s}`, 'j_spine4'],
    [`j_clavicle_${s}`, `j_shoulder_${s}`, `j_clavicle_${s}`],
    [`j_shoulder_${s}`, `j_elbow_${s}`, `j_shoulder_${s}`],
    [`j_elbow_${s}`, `j_wrist_${s}`, `j_elbow_${s}`],
    [`j_wrist_${s}`, `hand_${s}`, `j_wrist_${s}`],
  ]),
]

// `model`: buildModel's, in the game's axes, standing with its arms apart from its body; its own bones are left out.
// `skeleton`: playerSkeleton. Returns the model scaled to a player's height on the player's skeleton, and the fitted
// joints.
export function rigPlayer(model, skeleton) {
  const points = standing(model.vertices.map((v) => new Vector3(...v.position)))
  const samples = sampleSurface(points, model.faces)
  const joints = fitJoints(samples, skeleton)
  const bones = poseSkeleton(skeleton, joints)
  const index = new Map(skeleton.map((b, i) => [b.name, i]))
  const weights = weigh(points, joints).map((w) => w.map(([bone, weight]) => [index.get(bone), weight]))
  return {
    model: { ...model, bones, animations: [], vertices: points.map((p, i) => ({ position: p.toArray(), weights: weights[i] })) },
    joints,
  }
}

// Feet at z 0, centred on the origin, HEIGHT tall.
function standing(points) {
  const min = new Vector3(Infinity, Infinity, Infinity)
  const max = new Vector3(-Infinity, -Infinity, -Infinity)
  for (const p of points) {
    min.min(p)
    max.max(p)
  }
  const scale = HEIGHT / (max.z - min.z)
  const origin = new Vector3((min.x + max.x) / 2, (min.y + max.y) / 2, min.z)
  return points.map((p) => p.clone().sub(origin).multiplyScalar(scale))
}

// Points spread evenly over the surface, so a dense part of the mesh does not count for more.
function sampleSurface(points, faces) {
  const corners = faces.map((f) => f.corners.map((c) => points[c.vertex]))
  const area = (t) => new Vector3().crossVectors(t[1].clone().sub(t[0]), t[2].clone().sub(t[0])).length() / 2
  const total = corners.reduce((sum, t) => sum + area(t), 0)
  let seed = 1
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  const out = []
  let carry = 0
  for (const t of corners) {
    carry += (area(t) / total) * SAMPLES
    for (; carry >= 1; carry--) {
      const r = Math.sqrt(random())
      const s = random()
      out.push(t[0].clone().multiplyScalar(1 - r).addScaledVector(t[1], r * (1 - s)).addScaledVector(t[2], r * s))
    }
  }
  return out
}

// The player's joints in the mesh, plus the tips of the hands, feet and head, by name. Heights follow the stock
// skeleton's proportions, below and above the shoulders found in the mesh; the arms and legs follow the mesh.
function fitJoints(samples, skeleton) {
  const stock = Object.fromEntries(skeleton.map((b) => [b.name, b.position]))
  const left = fitArm(samples.filter((p) => p.y > 0), stock)
  const right = fitArm(samples.filter((p) => p.y < 0).map(mirror), stock)
  const shoulderZ = (left.shoulder.z + right.shoulder.z) / 2
  const stockShoulderZ = stock.j_shoulder_le.z
  const height = (z) => (z <= stockShoulderZ ? (z * shoulderZ) / stockShoulderZ : shoulderZ + ((z - stockShoulderZ) * (HEIGHT - shoulderZ)) / (HEIGHT - stockShoulderZ))
  const torsoWidth = Math.min(left.torsoEdge, right.torsoEdge)
  const torso = samples.filter((p) => Math.abs(p.y) < torsoWidth)
  const middle = (name, depth) => {
    const z = height(stock[name].z)
    const slice = torso.filter((p) => Math.abs(p.z - z) < 1)
    const xs = slice.map((p) => p.x)
    return new Vector3(Math.min(...xs) + depth * (Math.max(...xs) - Math.min(...xs)), 0, z)
  }
  const joints = {}
  for (const name of ['j_mainroot', 'j_spine1', 'j_spine2', 'j_spine3', 'j_spine4', 'j_neck']) joints[name] = middle(name, 0.4)
  joints.j_head = middle('j_head', 0.5)
  joints.top = new Vector3(joints.j_head.x, 0, HEIGHT)

  const hipsZ = joints.j_mainroot.z
  const legsApart = legsApartBelow(samples)
  for (const [s, arm, sign] of [['le', left, 1], ['ri', right, -1]]) {
    const back = (p) => new Vector3(p.x, p.y * sign, p.z)
    joints[`j_clavicle_${s}`] = new Vector3(joints.j_spine4.x, (arm.shoulder.y * stock.j_clavicle_le.y * sign) / stock.j_shoulder_le.y, height(stock.j_clavicle_le.z))
    for (const k of ['shoulder', 'elbow', 'wrist']) joints[`j_${k}_${s}`] = back(arm[k])
    joints[`hand_${s}`] = back(arm.hand)
    Object.assign(joints, fitLeg(samples.filter((p) => p.y * sign > 0), s, stock, hipsZ, legsApart, joints.j_mainroot))
  }
  return joints
}

const mirror = (p) => new Vector3(p.x, -p.y, p.z)

// A left arm (+Y) apart from the body: its shoulder at the armpit, its hand's tip the farthest point out, and the elbow
// and wrist on the line between, at the stock arm's proportions, in the middle of the arm.
function fitArm(side, stock) {
  const hand = side.reduce((a, p) => (p.y > a.y ? p : a))
  const { shoulder, radius, torsoEdge } = hangingShoulder(side, hand) ?? levelShoulder(side, hand)
  const length = (a, b) => stock[a].distanceTo(stock[b])
  const upper = length('j_shoulder_le', 'j_elbow_le')
  const lower = length('j_elbow_le', 'j_wrist_le')
  const palm = length('j_wrist_le', 'j_mid_le_3') * 1.3
  const total = upper + lower + palm
  shoulder.x = centreAcross(side, shoulder, hand.clone().sub(shoulder).normalize(), radius * 2).x
  const along = hand.clone().sub(shoulder)
  const direction = along.clone().normalize()
  const at = (share) => centreAcross(side, shoulder.clone().addScaledVector(along, share), direction, radius * 2)
  return { shoulder, elbow: at(upper / total), wrist: at((upper + lower) / total), hand, torsoEdge }
}

// An arm angled down, as in an A-pose: its shoulder above the top of the gap between arm and body, found going up from
// the hand; undefined when there is no gap at the hand's height.
function hangingShoulder(side, hand) {
  let armpit
  for (let z = hand.z; z < HEIGHT; z += 0.5) {
    const runs = occupied(side.filter((p) => p.z >= z && p.z < z + 1), hand.y)
    if (runs.length < 2) break
    armpit = { z: z + 1, torsoEdge: runs[0][1], armStart: runs.at(-1)[0] }
  }
  if (!armpit) return undefined
  const radius = new Vector3(hand.x, armpit.armStart, armpit.z).distanceTo(hand) * 0.15
  return { shoulder: new Vector3(hand.x, armpit.torsoEdge - radius * 0.5, armpit.z + radius), radius, torsoEdge: armpit.torsoEdge }
}

// A level arm, as in a T-pose: going in from the hand, the arm's height turns into the body's at the armpit. The
// shoulder sits in the middle of the arm there, half its thickness inside the body, so the arm hangs against the body
// when the game lowers it. Below the chest only the hips and legs are left out.
function levelShoulder(side, hand) {
  const step = 0.5
  const upper = side.filter((p) => p.z > HEIGHT / 2)
  const slices = []
  for (let y = hand.y - step; y > 0; y -= step) {
    const zs = upper.filter((p) => p.y >= y && p.y < y + step).map((p) => p.z)
    if (zs.length) slices.push({ y, low: Math.min(...zs), height: Math.max(...zs) - Math.min(...zs) })
  }
  const outer = slices.filter((s) => s.y > hand.y / 2).map((s) => s.height).sort((a, b) => a - b)
  const thickness = outer[Math.floor(outer.length / 2)]
  const body = slices.findIndex((s) => s.height > thickness * 2.5)
  if (body < 1) throw new Error('no armpit found: the model needs to stand with its arms apart from its body, as in an A-pose or T-pose')
  const arm = slices[body - 1]
  const radius = arm.height / 2
  return { shoulder: new Vector3(hand.x, arm.y - radius, arm.low + radius), radius, torsoEdge: arm.y }
}

// The stretches of y from 0 to `to` that `slice` fills, in half-inch steps, as [from, to] pairs.
function occupied(slice, to) {
  const step = 0.5
  const filled = new Uint8Array(Math.ceil(to / step) + 1)
  for (const p of slice) filled[Math.floor(p.y / step)] = 1
  const runs = []
  for (let i = 0; i < filled.length; i++) {
    if (!filled[i]) continue
    if (runs.length && runs.at(-1)[1] >= i * step - step) runs.at(-1)[1] = (i + 1) * step
    else runs.push([i * step, (i + 1) * step])
  }
  return runs
}

// The middle of the samples within an inch of the plane through `point` across `direction`, and within `radius` of
// the line through it; `point` when there are none.
function centreAcross(samples, point, direction, radius) {
  const sum = new Vector3()
  let count = 0
  const d = new Vector3()
  for (const p of samples) {
    d.subVectors(p, point)
    const t = d.dot(direction)
    if (Math.abs(t) > 1 || d.addScaledVector(direction, -t).length() > radius) continue
    sum.add(p)
    count++
  }
  return count ? sum.divideScalar(count) : point.clone()
}

// The height up to which the legs stand apart, with nothing between them.
function legsApartBelow(samples) {
  let z = 0.5
  for (; z < HEIGHT / 2; z += 0.5) if (samples.some((p) => Math.abs(p.y) < 0.75 && p.z >= z && p.z < z + 0.5)) break
  return z
}

// One leg's joints: heights at the stock proportions below the hips, each in the middle of the leg where the legs stand
// apart and on the line from hip to ankle above that; the ball of the foot toward its front.
function fitLeg(side, s, stock, hipsZ, legsApart, root) {
  const scale = hipsZ / stock.j_mainroot.z
  const centre = (z) => {
    const slice = side.filter((p) => Math.abs(p.z - z) < 0.5)
    return slice.reduce((sum, p) => sum.add(p), new Vector3()).divideScalar(slice.length)
  }
  const ankle = centre(stock.j_ankle_le.z * scale)
  const top = centre(Math.min(legsApart, hipsZ) - 0.5)
  const hip = new Vector3(root.x, top.y, hipsZ)
  const kneeZ = stock.j_knee_le.z * scale
  const knee = kneeZ < legsApart ? centre(kneeZ) : hip.clone().lerp(ankle, (hipsZ - kneeZ) / (hipsZ - ankle.z))
  const foot = side.filter((p) => p.z < ankle.z)
  const toe = foot.reduce((a, p) => (p.x > a.x ? p : a))
  const ball = new Vector3(ankle.x + 0.65 * (toe.x - ankle.x), ankle.y, stock.j_ball_le.z * scale)
  return { [`j_hip_${s}`]: hip, [`j_knee_${s}`]: knee, [`j_ankle_${s}`]: ankle, [`j_ball_${s}`]: ball, [`toe_${s}`]: new Vector3(toe.x, ankle.y, ball.z) }
}

const delta = (now, then) => now.clone().multiply(then.clone().invert())

// Every bone of the skeleton at the fitted joints, parents first, in the XMODEL_EXPORT's terms. A fitted bone turns
// from its stock rotation as little as faces it the way its AIM does; any other bone keeps its place on its parent.
function poseSkeleton(skeleton, joints) {
  const out = []
  skeleton.forEach((bone) => {
    const parent = out[bone.parent]
    const stockParent = skeleton[bone.parent]
    const follow = parent ? delta(parent.rotation, stockParent.rotation) : new Quaternion()
    const position = joints[bone.name]?.clone() ?? (parent ? bone.position.clone().sub(stockParent.position).applyQuaternion(follow).add(parent.position) : bone.position.clone())
    let rotation = follow.clone().multiply(bone.rotation)
    const aim = AIM[bone.name]
    if (aim) {
      const from = skeleton.find((b) => b.name === aim[0]).position.clone().sub(bone.position).normalize()
      const to = joints[aim[1]].clone().sub(position).normalize()
      rotation = new Quaternion().setFromUnitVectors(from, to).multiply(bone.rotation)
    }
    out.push({ position, rotation })
  })
  return out.map((b, i) => ({ name: skeleton[i].name, parent: skeleton[i].parent, position: b.position.toArray(), axes: axesOf(b.rotation) }))
}

function axesOf(rotation) {
  const m = new Matrix4().makeRotationFromQuaternion(rotation)
  return [0, 1, 2].map((k) => new Vector3().setFromMatrixColumn(m, k).toArray())
}

// Each vertex's [bone, weight] pairs. Distances to a stretch are counted in its thickness, the typical distance of the
// vertices beside its middle, so a thick belly stays with the spine rather than the arm beside it. A limb takes only
// vertices on its own side; the legs only those below the hips, so the belly does not fold in with the thighs; the body
// and arms only those above the knees; the shin only those above the ankle and the foot those below it, so a bending
// ankle takes the whole heel. Neighbouring bones within BLEND of the nearest share the vertex, more the nearer they
// are, so a bending joint stretches its skin smoothly instead of pulling single triangles into spikes.
function weigh(points, joints) {
  const sideOf = (name) => (name.endsWith('_le') ? 1 : name.endsWith('_ri') ? -1 : 0)
  const segments = SEGMENTS.map(([from, to, bone]) => {
    const side = sideOf(from) || sideOf(to)
    const ankle = side && joints[`j_ankle_${side > 0 ? 'le' : 'ri'}`].z
    let low = -Infinity
    let high = Infinity
    if (/^j_(hip|knee|ankle|ball)_/.test(bone)) high = joints.j_mainroot.z
    else low = Math.min(joints.j_knee_le.z, joints.j_knee_ri.z)
    if (/^j_knee_/.test(bone)) low = ankle
    if (/^j_(ankle|ball)_/.test(bone)) high = ankle + 1
    return { from: joints[from], to: joints[to], bone, side, low, high }
  })
  const allowed = (s, p) => (s.side === 0 || p.y * s.side > -0.5) && p.z >= s.low && p.z <= s.high
  const touches = new Map()
  for (const [from, to, bone] of SEGMENTS) touches.set(bone, new Set([...(touches.get(bone) ?? []), from, to]))
  const neighbours = (a, b) => [...touches.get(a)].some((joint) => touches.get(b).has(joint))
  const distances = points.map((p) => segments.map((s) => (allowed(s, p) ? distanceToSegment(p, s.from, s.to) : Infinity)))
  const nearest = distances.map((d) => d.indexOf(Math.min(...d)))
  const thickness = segments.map((s, k) => {
    const middle = (p) => Math.abs(along(p, s.from, s.to) - 0.5) < 0.25
    const beside = distances.flatMap((d, i) => (nearest[i] === k && middle(points[i]) ? [d[k]] : [])).sort((a, b) => a - b)
    return Math.max(1, beside[Math.floor(beside.length / 2)] ?? 1)
  })
  return distances.map((d) => {
    const byBone = new Map()
    d.forEach((x, k) => byBone.set(segments[k].bone, Math.min(byBone.get(segments[k].bone) ?? Infinity, x / thickness[k])))
    const [first, best] = [...byBone].reduce((a, b) => (b[1] < a[1] ? b : a))
    const shares = [...byBone]
      .filter(([bone]) => neighbours(first, bone))
      .map(([bone, x]) => [bone, 1 - (x - best) / BLEND])
      .filter(([, w]) => w > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_WEIGHTS)
    const total = shares.reduce((sum, [, w]) => sum + w, 0)
    return shares.map(([bone, w]) => [bone, w / total])
  })
}

// How far along from `a` to `b` the point nearest `p` lies, 0 to 1.
function along(p, a, b) {
  const ab = b.clone().sub(a)
  return Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq()))
}

// The distance from a stretch, counting the way past either end OVERSHOOT times: a stretch takes what lies beside it, and
// a thick one, such as the torso or a skirted thigh, does not reach the feet.
function distanceToSegment(p, a, b) {
  const ab = b.clone().sub(a)
  const t = p.clone().sub(a).dot(ab) / ab.lengthSq()
  const beside = a.clone().lerp(b, Math.max(0, Math.min(1, t))).distanceTo(p)
  const past = Math.max(0, -t, t - 1) * ab.length()
  return Math.hypot(beside, past * (OVERSHOOT - 1))
}
