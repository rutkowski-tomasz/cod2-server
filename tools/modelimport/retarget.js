// Moves a humanoid's animations onto CoD2's multiplayer player skeleton: its bones are matched by name, and each
// frame's pose is rebuilt on that skeleton, which keeps its own proportions.
import { Matrix4, Quaternion, Vector3 } from 'three'
import { createSearch } from '../shared/assets.js'
import { parseXModel, parseParts } from '../shared/xmodel.js'

// A stock multiplayer body; every one has the same skeleton.
const PLAYER_BODY = 'xmodel/playerbody_american_normandy01'

// Source bone names, lowercased with letters and digits only and a rig's prefix dropped, to the player's.
const BONE_MAP = lowercase({
  ...side('LE', 'left', 'l'),
  ...side('RI', 'right', 'r'),
  // Mixamo, then 3ds Max Biped, then Unreal's mannequin.
  hips: 'J_MainRoot', spine: 'J_Spine1', spine1: 'J_Spine2', spine2: 'J_Spine4', neck: 'J_Neck', head: 'J_Head',
  pelvis: 'J_MainRoot',
  spine01: 'J_Spine1', spine02: 'J_Spine2', spine03: 'J_Spine4', neck01: 'J_Neck',
})

function side(cod, mixamo, biped) {
  const map = {
    [`${mixamo}shoulder`]: `J_Clavicle_${cod}`, [`${mixamo}arm`]: `J_Shoulder_${cod}`, [`${mixamo}forearm`]: `J_Elbow_${cod}`, [`${mixamo}hand`]: `J_Wrist_${cod}`,
    [`${mixamo}upleg`]: `J_Hip_${cod}`, [`${mixamo}leg`]: `J_Knee_${cod}`, [`${mixamo}foot`]: `J_Ankle_${cod}`, [`${mixamo}toebase`]: `J_Ball_${cod}`,
    [`${biped}clavicle`]: `J_Clavicle_${cod}`, [`${biped}upperarm`]: `J_Shoulder_${cod}`, [`${biped}forearm`]: `J_Elbow_${cod}`, [`${biped}hand`]: `J_Wrist_${cod}`,
    [`${biped}thigh`]: `J_Hip_${cod}`, [`${biped}calf`]: `J_Knee_${cod}`, [`${biped}foot`]: `J_Ankle_${cod}`, [`${biped}toe0`]: `J_Ball_${cod}`,
    [`clavicle${biped}`]: `J_Clavicle_${cod}`, [`upperarm${biped}`]: `J_Shoulder_${cod}`, [`lowerarm${biped}`]: `J_Elbow_${cod}`, [`hand${biped}`]: `J_Wrist_${cod}`,
    [`thigh${biped}`]: `J_Hip_${cod}`, [`calf${biped}`]: `J_Knee_${cod}`, [`foot${biped}`]: `J_Ankle_${cod}`, [`ball${biped}`]: `J_Ball_${cod}`,
  }
  const fingers = [['thumb', 'Thumb', 0], ['index', 'Index', 1], ['middle', 'Mid', 2], ['ring', 'Ring', 3], ['pinky', 'Pinky', 4]]
  for (const [finger, codFinger, biped3ds] of fingers) {
    for (const k of [1, 2, 3]) {
      map[`${mixamo}hand${finger}${k}`] = `J_${codFinger}_${cod}_${k}`
      map[`${finger}0${k}${biped}`] = `J_${codFinger}_${cod}_${k}`
      map[`${biped}finger${biped3ds}${k === 1 ? '' : k - 1}`] = `J_${codFinger}_${cod}_${k}`
    }
  }
  return map
}

// Bones whose direction, toward the bone named here, is copied from the source rather than their rotation: arms and
// legs, which rest in a T-pose in most rigs and in an A-pose in the player's.
const AIM_AT = lowercase(Object.fromEntries(['LE', 'RI'].flatMap((s) => [
  [`J_Clavicle_${s}`, `J_Shoulder_${s}`], [`J_Shoulder_${s}`, `J_Elbow_${s}`], [`J_Elbow_${s}`, `J_Wrist_${s}`],
  [`J_Hip_${s}`, `J_Knee_${s}`], [`J_Knee_${s}`, `J_Ankle_${s}`], [`J_Ankle_${s}`, `J_Ball_${s}`],
])))

function lowercase(map) {
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v.toLowerCase()]))
}

// The stock player body's bones in the game's space: name, parent, position and rotation at rest, and its X, Y, Z
// axes. Needs the stock iwds that modelview reads.
export function playerSkeleton() {
  const search = createSearch()
  const model = search.read(PLAYER_BODY)
  const parts = model && search.read(`xmodelparts/${parseXModel(model).surfaces}`)
  if (!parts) throw new Error(`${PLAYER_BODY} not found: pull the stock iwds into ~/Dev/cod2-binaries (see tools/modelview/README.md)`)
  const bones = []
  for (const b of parseParts(parts)) {
    const parent = bones[b.parent]
    const local = new Quaternion(...b.rotation)
    const offset = new Vector3(...b.offset)
    bones.push(parent
      ? { name: b.name, parent: b.parent, position: offset.applyQuaternion(parent.rotation).add(parent.position), rotation: parent.rotation.clone().multiply(local) }
      : { name: b.name, parent: -1, position: offset, rotation: local })
  }
  for (const b of bones) b.axes = axesOf(b.rotation)
  return bones
}

function axesOf(rotation) {
  const m = new Matrix4().makeRotationFromQuaternion(rotation)
  return [0, 1, 2].map((k) => new Vector3().setFromMatrixColumn(m, k).toArray())
}

// `source`: the loaded file's bones (name, parent, matrix in three.js space) and animations (per frame, every bone's
// matrix); `target`: playerSkeleton. Returns, per animation, its name and every frame's target bones as positions and
// X, Y, Z axes; and the source bones that match no player bone.
export function retarget(source, target) {
  if (!source.animations.length) throw new Error('the file has no animations')
  const keyOf = (name) => name.toLowerCase().replace(/^(mixamorig\d*|bip0?0?1|def)/, '').replace(/[^a-z0-9]/g, '')
  const sourceOf = new Map()
  const unmatched = []
  source.bones.forEach((b, i) => {
    const cod = BONE_MAP[keyOf(b.name)]
    if (!cod) unmatched.push(b.name)
    else if (!sourceOf.has(cod)) sourceOf.set(cod, i)
  })
  if (!sourceOf.has('j_mainroot')) throw new Error(`no hips bone among ${source.bones.map((b) => b.name).join(', ')}`)

  const toRig = facing(source.bones, sourceOf)
  const rest = source.bones.map((b) => rigPose(b.matrix, toRig, 1))
  // Scaled so the source's hips rest as high above its ankles as the player's.
  const ankle = sourceOf.get('j_ankle_le')
  const sourceHeight = rest[sourceOf.get('j_mainroot')].position.z - (ankle === undefined ? 0 : rest[ankle].position.z)
  const targetZ = (name) => target.find((b) => b.name === name).position.z
  const targetHeight = targetZ('j_mainroot') - (ankle === undefined ? 0 : targetZ('j_ankle_le'))
  if (!(sourceHeight > 1e-3)) throw new Error('the hips do not rest above the feet: is the model standing, with three.js +Y up?')
  const scale = targetHeight / sourceHeight
  const sourceRest = rest.map((p) => ({ position: p.position.clone().multiplyScalar(scale), rotation: p.rotation }))
  const targetRest = restPose(target, sourceOf, sourceRest)

  const animations = source.animations.map((a) => ({
    name: a.name,
    frames: a.frames.map((matrices) => {
      const pose = matrices.map((m) => rigPose(m, toRig, scale))
      return poseTarget(target, targetRest, sourceOf, sourceRest, pose).map(({ position, rotation }) => ({ position: position.toArray(), axes: axesOf(rotation) }))
    }),
  }))
  return { animations, unmatched }
}

// From three.js axes to the game's (facing +X, left +Y, Z up), turned so the source faces the same way: its left is
// from its right hip to its left one, and up is three.js's +Y. Rigs face +Z or -Z, whatever glTF says.
function facing(bones, sourceOf) {
  const at = (cod) => new Vector3().setFromMatrixPosition(new Matrix4().fromArray(bones[sourceOf.get(cod)].matrix))
  const hips = ['j_hip_le', 'j_hip_ri'].every((b) => sourceOf.has(b)) ? ['j_hip_le', 'j_hip_ri'] : ['j_clavicle_le', 'j_clavicle_ri']
  if (!hips.every((b) => sourceOf.has(b))) throw new Error('no left and right hip or clavicle bones to tell which way the source faces')
  const up = new Vector3(0, 1, 0)
  const left = at(hips[0]).sub(at(hips[1])).projectOnPlane(up)
  if (left.length() < 1e-6) throw new Error('the left and right hips are one above the other: is the model standing, with three.js +Y up?')
  left.normalize()
  const forward = new Vector3().crossVectors(left, up)
  const source = new Matrix4().makeBasis(left, up, forward)
  const rig = new Matrix4().makeBasis(new Vector3(0, 1, 0), new Vector3(0, 0, 1), new Vector3(1, 0, 0))
  return rig.multiply(source.invert())
}

// A world matrix in the game's axes and inches: position and rotation, scale left out.
function rigPose(matrix, toRig, scale) {
  const position = new Vector3()
  const rotation = new Quaternion()
  new Matrix4().multiplyMatrices(toRig, new Matrix4().fromArray(matrix)).decompose(position, rotation, new Vector3())
  return { position: position.multiplyScalar(scale), rotation }
}

const delta = (now, then) => now.clone().multiply(then.clone().invert())

// The player's skeleton in the source's rest pose, parents first: arm and leg bones point where their source bones
// point, as most rigs rest in a T-pose and the player in an A-pose; every other bone keeps its bind pose relative to
// its parent.
function restPose(target, sourceOf, sourceRest) {
  const out = []
  target.forEach((bone) => {
    const parent = out[bone.parent]
    const parentBind = target[bone.parent]
    const follow = parent ? delta(parent.rotation, parentBind.rotation) : new Quaternion()
    let rotation = follow.clone().multiply(bone.rotation)
    const position = parent ? bone.position.clone().sub(parentBind.position).applyQuaternion(follow).add(parent.position) : bone.position.clone()
    const s = sourceOf.get(bone.name)
    const aimAt = AIM_AT[bone.name]
    if (s !== undefined && sourceOf.has(aimAt)) {
      const from = target.find((b) => b.name === aimAt).position.clone().sub(bone.position).normalize()
      const to = sourceRest[sourceOf.get(aimAt)].position.clone().sub(sourceRest[s].position).normalize()
      rotation = new Quaternion().setFromUnitVectors(from, to).multiply(bone.rotation)
    }
    out.push({ position, rotation })
  })
  return out
}

// Each target bone's world pose for one source frame, parents first. A matched bone turns from the rest pose as its
// source bone turns from its own; the hips also move as the source's do; any other bone follows its parent.
function poseTarget(target, targetRest, sourceOf, sourceRest, pose) {
  const out = []
  target.forEach((bone, i) => {
    const parent = out[bone.parent]
    const parentRest = targetRest[bone.parent]
    const follow = parent ? delta(parent.rotation, parentRest.rotation) : new Quaternion()
    let rotation = follow.clone().multiply(targetRest[i].rotation)
    let position = parent ? targetRest[i].position.clone().sub(parentRest.position).applyQuaternion(follow).add(parent.position) : targetRest[i].position.clone()
    const s = sourceOf.get(bone.name)
    if (s !== undefined) rotation = delta(pose[s].rotation, sourceRest[s].rotation).multiply(targetRest[i].rotation)
    if (s !== undefined && bone.name === 'j_mainroot') position = targetRest[i].position.clone().add(pose[s].position).sub(sourceRest[s].position)
    out.push({ position, rotation })
  })
  return out
}
