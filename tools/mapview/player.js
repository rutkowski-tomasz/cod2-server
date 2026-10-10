// The bundle's player, one skinned copy per spawn, playing the idle animation in a loop, and copies add-ons place
// themselves, in any rig, weapon and animation.
// THREE comes from the page script. Each copy is built in CoD's Z-up frame, like the bundle's bones and geometry,
// and turned into three.js's Y-up one by its outer group.
import { toThree } from './draw.js'
import { d2r } from './math.js'

// Seconds between the points of the loop that consecutive copies start at, so they do not move in step.
const PHASE_STEP = 0.37
// How far below its spawn a player looks for the floor.
const MAX_DROP = 4096
// A player hides while the camera is inside this upright cylinder around it, from its feet to this far above
// its spawn, as when standing on the spawn: `--at` puts the eye 60 units above it.
const HIDE_RADIUS = 24
const HIDE_TOP = 80
// Seconds an add-on's copy takes to blend into its next animation.
const FADE = 0.2
// The bone the upper body hangs from: a torso animation moves it and every bone below it, the legs the rest.
const UPPER_BODY = 'torso_stabilizer'
// A sphere around a standing player, for telling whether it is on view.
const BODY_CENTER = 36
const BODY_RADIUS = 50

// `world` gives the floor the players stand on and the material models draw with.
export function createPlayers(map, world) {
  const { idle } = map.player
  const base = partsOf(map.player, map, map.materials)
  const rigParts = new Map()
  const weaponParts = new Map()
  const copies = []
  let lastUpdate = performance.now()
  let frozen = false
  // The floor is found by casting rays at the world before its first frame has placed its brush models.
  world.occluders.updateMatrixWorld(true)

  return {
    classname: map.player.classname,
    // A copy for the spawn `e`, to place at its origin. The game drops these spawns to the floor below them
    // (placeSpawnpoint in the gametype script), so the copy stands there.
    create(e) {
      const outer = createCopy((e.angles ? e.angles[1] : 0) * d2r, base)
      const drop = floorDrop(e.origin)
      outer.position.y = -drop
      // `offset` is the camera's position relative to the spawn, in three.js's frame.
      outer.userData.hides = (offset) => Math.hypot(offset.x, offset.z) < HIDE_RADIUS && offset.y > -drop && offset.y < HIDE_TOP
      return outer
    },
    // A copy facing +X with its feet at its parent's origin, for an add-on to place: of `rig`, a player built by
    // bundle.js buildRig, else of the bundle's player. `remove` it once it is no longer needed.
    createActor(rig) {
      if (!rig) return createCopy(0, base)
      if (!rigParts.has(rig)) {
        Object.assign(map.images, rig.images)
        rigParts.set(rig, partsOf(rig, decodeGeometry(rig.geometry), rig.materials))
      }
      return createCopy(0, rigParts.get(rig))
    },
    // Puts `weapon` (built like a rig by bundle.js buildWeapon), or nothing for null, in the right hand of the copy
    // `outer` from createActor, so it follows the hand's animation.
    hold(outer, weapon) {
      const copy = copies.find((c) => c.outer === outer)
      copy.weapon?.removeFromParent()
      copy.weapon = weapon && weaponMesh(weapon)
      if (copy.weapon) copy.skeleton.getBoneByName('tag_weapon_right')?.add(copy.weapon)
    },
    // Plays the parsed xanim `legs` on the copy `outer` from createActor, with `torso` over its upper body when given, blending
    // from what it played. With neither it keeps what it plays.
    pose(outer, legs, torso) {
      const copy = copies.find((c) => c.outer === outer)
      const next = [
        legs && copy.mixer.clipAction(clipOf(copy.parts, legs, torso ? 'lower' : 'all')),
        torso && copy.mixer.clipAction(clipOf(copy.parts, torso, 'upper')),
      ].filter(Boolean)
      if (!next.length) return
      // A frozen render draws the new pose at once, as no frame will blend it in.
      for (const a of copy.actions) if (!next.includes(a)) frozen ? a.stop() : a.fadeOut(FADE)
      for (const a of next) {
        if (copy.actions.includes(a)) continue
        a.reset().play()
        if (!frozen) a.fadeIn(FADE)
      }
      copy.actions = next
      if (frozen) copy.mixer.update(0)
    },
    remove(outer) {
      const i = copies.findIndex((c) => c.outer === outer)
      copies[i].skeleton.dispose()
      copies.splice(i, 1)
      outer.removeFromParent()
    },
    // Moves the copies on by the time since the last call; true when one is drawn in `cam`'s view, so the page has
    // to draw again. A copy is not drawn while a group above it is hidden, or while `cut` (a height, or null)
    // is below its feet. False once frozen.
    update(cam, cut) {
      const now = performance.now()
      const seconds = (now - lastUpdate) / 1000
      lastUpdate = now
      if (frozen) return false
      for (const { mixer } of copies) mixer.update(seconds)
      const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse))
      const center = new THREE.Vector3()
      return copies.some(({ outer }) => {
        let shown = true
        outer.traverseAncestors((a) => { shown &&= a.visible })
        outer.getWorldPosition(center)
        if (!shown || (cut != null && center.y > cut)) return false
        center.y += BODY_CENTER
        return frustum.intersectsSphere(new THREE.Sphere(center, BODY_RADIUS))
      })
    },
    // Holds every copy at its starting pose, so a headless render of the same view gives the same image.
    freeze() {
      frozen = true
      for (const { mixer, start } of copies) mixer.setTime(start)
    },
  }

  // A weapon drawn rigid in its bind pose, sharing geometry and materials with every other hand holding it.
  function weaponMesh(weapon) {
    if (!weaponParts.has(weapon)) {
      Object.assign(map.images, weapon.images)
      const data = decodeGeometry(weapon.geometry)
      weaponParts.set(weapon, weapon.surfaces.map((s) => [geometryOf(data, s), world.modelMaterial(weapon.materials[s.material])]))
    }
    const group = new THREE.Group()
    for (const [geometry, material] of weaponParts.get(weapon)) group.add(new THREE.Mesh(geometry, material))
    return group
  }

  // The geometry, materials and clips one rig's copies share; `data` reads the rig's packed arrays.
  function partsOf(rig, data, materials) {
    return {
      bones: rig.bones,
      geometries: rig.surfaces.map((s) => [geometryOf(data, s), world.modelMaterial(materials[s.material])]),
      clip: buildClip(rig.bones, idle, () => true),
      upper: upperBody(rig.bones),
      clips: new Map(),
    }
  }

  // The clip of `anim` for one rig over all its bones, or only the `upper` or `lower` body.
  function clipOf(parts, anim, part) {
    if (!parts.clips.has(anim)) parts.clips.set(anim, {})
    const clips = parts.clips.get(anim)
    const keep = { all: () => true, upper: (name) => parts.upper.has(name), lower: (name) => !parts.upper.has(name) }[part]
    clips[part] ??= buildClip(parts.bones, anim, keep)
    return clips[part]
  }

  function createCopy(yaw, parts) {
    const { bones, geometries, clip } = parts
    const body = new THREE.Group()
    const skeleton = new THREE.Skeleton(bones.map((b) => {
      const bone = new THREE.Bone()
      bone.name = b.name
      bone.position.fromArray(b.offset)
      bone.quaternion.fromArray(b.rotation)
      return bone
    }))
    bones.forEach((b, i) => (b.parent < 0 ? body : skeleton.bones[b.parent]).add(skeleton.bones[i]))
    const meshes = geometries.map(([geometry, material]) => new THREE.SkinnedMesh(geometry, material))
    body.add(...meshes)
    // Bound before the copy is turned, so the bind pose is in the body's own frame.
    body.updateMatrixWorld(true)
    for (const mesh of meshes) {
      mesh.bind(skeleton)
      // The bind pose's bounds would cull a copy whose animation leans out of them.
      mesh.frustumCulled = false
    }
    body.rotation.z = yaw
    const mixer = new THREE.AnimationMixer(body)
    const start = (copies.length * PHASE_STEP) % clip.duration
    const action = mixer.clipAction(clip)
    action.play().time = start
    const outer = new THREE.Group()
    outer.rotation.x = -Math.PI / 2
    outer.add(body)
    copies.push({ outer, mixer, start, skeleton, parts, actions: [action] })
    return outer
  }

  function floorDrop([x, y, z]) {
    const ray = new THREE.Raycaster(toThree(x, y, z + 1), new THREE.Vector3(0, -1, 0), 0, MAX_DROP)
    const hit = ray.intersectObject(world.occluders)[0]
    return hit ? hit.distance - 1 : 0
  }
}

function geometryOf(data, s) {
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(data.f32(s.positions), 3))
  geom.setAttribute('normal', new THREE.BufferAttribute(data.f32(s.normals), 3))
  if (s.tangents) geom.setAttribute('tangentU', new THREE.BufferAttribute(data.f32(s.tangents), 3))
  if (s.binormals) geom.setAttribute('binormalV', new THREE.BufferAttribute(data.f32(s.binormals), 3))
  geom.setAttribute('uv', new THREE.BufferAttribute(data.f32(s.uvs), 2))
  geom.setAttribute('rgba', new THREE.BufferAttribute(data.u8(s.colors), 4, true))
  geom.setAttribute('skinIndex', new THREE.BufferAttribute(data.u16(s.skinIndices), 4))
  geom.setAttribute('skinWeight', new THREE.BufferAttribute(data.f32(s.skinWeights), 4))
  geom.setIndex(new THREE.BufferAttribute(data.u32(s.indices), 1))
  return geom
}

// Readers of packed arrays sent as base64: the bundle's geometry, or a rig's.
export function decodeGeometry(base64) {
  const text = atob(base64)
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
  return {
    u8: (ref) => new Uint8Array(bytes.buffer, ref.offset, ref.count),
    u16: (ref) => new Uint16Array(bytes.buffer, ref.offset, ref.count),
    f32: (ref) => new Float32Array(bytes.buffer, ref.offset, ref.count),
    u32: (ref) => new Uint32Array(bytes.buffer, ref.offset, ref.count),
  }
}

// The names of the upper body's bones: UPPER_BODY and every bone below it.
function upperBody(bones) {
  const upper = new Set()
  bones.forEach((b) => { if (b.name === UPPER_BODY || upper.has(bones[b.parent]?.name)) upper.add(b.name) })
  return upper
}

// Animated rotations replace the bone's own; animated translations are offsets from its own position.
// Only the bones `keep` takes by name are animated; ones the rig lacks, such as another uniform's coat tails, never are.
function buildClip(bones, anim, keep) {
  const times = (keys) => keys.frames.map((f) => f / anim.fps)
  const tracks = []
  for (const b of anim.bones.filter((a) => keep(a.name) && bones.some((r) => r.name === a.name))) {
    if (b.rotations) tracks.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times(b.rotations), b.rotations.values))
    if (b.translations) {
      const own = bones.find((x) => x.name === b.name).offset
      const values = b.translations.values.map((v, i) => v + own[i % 3])
      tracks.push(new THREE.VectorKeyframeTrack(`${b.name}.position`, times(b.translations), values))
    }
  }
  return new THREE.AnimationClip('idle', (anim.frames - 1) / anim.fps, tracks)
}
