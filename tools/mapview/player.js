// The bundle's player, one skinned copy per spawn, playing the idle animation in a loop, and copies add-ons place
// themselves, in any rig, weapon and animation.
// THREE comes from the page script. Each copy is built in CoD's Z-up frame, like the bundle's bones and geometry,
// and turned into three.js's Y-up one by its outer group.
import { decodeGeometry } from './packed.js'
import { d2r } from './math.js'
import { boneTree, attachSkinned, geometryOf, buildClip } from './skin.js'

// Seconds between the points of the loop that consecutive copies start at, so they do not move in step.
const PHASE_STEP = 0.37
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
// How the game bends a player toward where it looks (BG_Player_DoControllers): the torso takes TORSO_PITCH of the
// view's pitch, over its back bones, and the neck and head the rest, each bone its share. A prone torso takes a
// half of that looking down and a quarter looking up, all on back_up.
const TORSO_PITCH = 0.6
const PRONE_TORSO_DOWN = 0.5
const PRONE_TORSO_UP = 0.25
const BACK_SHARES = [['back_low', 0.2], ['back_mid', 0.3], ['back_up', 0.5]]
const PRONE_BACK_SHARES = [['back_up', 1]]
const HEAD_SHARES = [['neck', 0.3], ['head', 0.7]]
// The bones run x up the spine and z to the player's left, so a pitch down turns them about +z.
const PITCH_AXIS = new THREE.Vector3(0, 0, 1)

// `world` gives the floor the players stand on and the material models draw with.
export function createPlayers(map, world) {
  const { idle } = map.player
  const base = partsOf(map.player, meshesOf(map.player, map, map.materials))
  // Each add-on rig's meshes, and the parts of each rig and gun its actors were made of.
  const rigMeshes = new Map()
  const actorParts = new Map()
  const weaponParts = new Map()
  const copies = []
  let lastUpdate = performance.now()
  let frozen = false
  return {
    classname: map.player.classname,
    // A copy for the spawn `e`, to place at its origin. The game drops these spawns to the floor below them
    // (placeSpawnpoint in the gametype script), so the copy stands there.
    create(e) {
      const outer = createCopy((e.angles ? e.angles[1] : 0) * d2r, base)
      const drop = world.floorDrop(e.origin)
      outer.position.y = -drop
      // `offset` is the camera's position relative to the spawn, in three.js's frame.
      outer.userData.hides = (offset) => Math.hypot(offset.x, offset.z) < HIDE_RADIUS && offset.y > -drop && offset.y < HIDE_TOP
      return outer
    },
    // An actor, a copy for an add-on to place, facing +X with its feet at its parent's origin: of `rig`, a player
    // built by bundle.js buildRig, else of the bundle's player. With `gun`, built by bundle.js buildGun, `rig` is the
    // hands, the gun hangs from their tag_weapon, and an animation moves both. `remove` it once it is no longer needed.
    createActor(rig, gun = null) {
      if (!rig) return createCopy(0, base)
      if (!actorParts.has(rig)) actorParts.set(rig, new Map())
      const byGun = actorParts.get(rig)
      if (!byGun.has(gun)) {
        const gunParts = gun && { bones: gun.bones, meshes: addOnMeshesOf(gun) }
        byGun.set(gun, partsOf(rig, addOnMeshesOf(rig), gunParts))
      }
      return createCopy(0, byGun.get(gun))
    },
    // Resolves once the textures of `asset`, a rig, weapon or gun built by bundle.js, are in, so what is made of it
    // draws textured from its first frame rather than in flat colours; rejects when one fails to load.
    load: (asset) => world.loadModelTextures(asset),
    // Puts `weapon` (built like a rig by bundle.js buildWeapon), or nothing for null, in `actor`'s right hand, so it
    // follows the hand's animation. The weapon's bones come along as objects named after them, such as tag_flash,
    // for effects to play on.
    hold(actor, weapon) {
      const copy = copies.find((c) => c.outer === actor)
      copy.weapon?.removeFromParent()
      copy.weapon = weapon && weaponMesh(weapon)
      if (copy.weapon) copy.skeleton.getBoneByName('tag_weapon_right')?.add(copy.weapon)
    },
    // Plays the parsed xanim `legs` on `actor`, with `torso` over its upper body when given, blending from what it
    // played. With neither it keeps what it plays. An animation the game does not loop, such as a reload, plays once
    // and holds its last frame. `once` plays them from the start, even when already playing, and holds their last
    // frame. An actor's first pose plays at once: blending from the default idle would pull bones the idle does not
    // move, such as a viewmodel's, toward their bind pose.
    pose(actor, legs, torso, { once = false } = {}) {
      const copy = copies.find((c) => c.outer === actor)
      const animOf = new Map([
        legs && [copy.mixer.clipAction(clipOf(copy.parts, legs, torso ? 'lower' : 'all')), legs],
        torso && [copy.mixer.clipAction(clipOf(copy.parts, torso, 'upper')), torso],
      ].filter(Boolean))
      const next = [...animOf.keys()]
      if (!next.length) return
      // A frozen render draws the new pose at once, as no frame will blend it in.
      const atOnce = frozen || !copy.posed
      // Stopping an action puts back what it moved, so the bend comes off first.
      if (atOnce) unbend(copy)
      for (const a of copy.actions) if (!next.includes(a)) atOnce ? a.stop() : a.fadeOut(FADE)
      for (const a of next) {
        const playing = copy.actions.includes(a)
        if (playing && !once) continue
        const holds = once || !animOf.get(a).looping
        a.setLoop(holds ? THREE.LoopOnce : THREE.LoopRepeat, Infinity)
        a.clampWhenFinished = holds
        a.reset().play()
        // A restart keeps its full weight: fading in from none would pull the bones toward their bind pose.
        if (!atOnce && !playing) a.fadeIn(FADE)
      }
      copy.actions = next
      copy.posed = true
      if (atOnce) {
        copy.mixer.update(0)
        bend(copy)
      }
    },
    // Bends `actor`'s back, neck and head toward `pitch` degrees, positive down, as the game bends a player toward
    // where it looks; `prone` bends it as a prone player.
    look(actor, pitch, { prone = false } = {}) {
      const copy = copies.find((c) => c.outer === actor)
      copy.pitch = pitch
      copy.prone = prone
      // A frozen render draws it as it is now, as no frame will.
      if (frozen) {
        unbend(copy)
        bend(copy)
      }
    },
    // Plays `anim` from its start again where `actor` plays it, as the game does when it starts the same animation
    // again, such as a fire animation on each shot.
    restart(actor, anim) {
      const copy = copies.find((c) => c.outer === actor)
      const clips = Object.values(copy.parts.clips.get(anim) ?? {})
      for (const a of copy.actions) {
        if (!clips.includes(a.getClip())) continue
        // Unlike reset(), this keeps a fade in going, as the game keeps blending.
        a.time = 0
        a.paused = false
      }
    },
    remove(actor) {
      const i = copies.findIndex((c) => c.outer === actor)
      copies[i].skeleton.dispose()
      copies[i].gunSkeleton?.dispose()
      copies.splice(i, 1)
      actor.removeFromParent()
    },
    // Moves the copies on by the time since the last call; true when one is drawn in `cam`'s view, so the page has
    // to draw again. A copy is not drawn while a group above it is hidden, or while `cut` (a height, or null)
    // is below its feet. False once frozen.
    update(cam, cut) {
      const now = performance.now()
      const seconds = (now - lastUpdate) / 1000
      lastUpdate = now
      if (frozen) return false
      for (const copy of copies) {
        // Bones no animation moves would keep last frame's bend and add this one's.
        unbend(copy)
        copy.mixer.update(seconds)
        bend(copy)
      }
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
      for (const copy of copies) {
        unbend(copy)
        copy.mixer.setTime(copy.start)
        bend(copy)
      }
    },
  }

  function unbend(copy) {
    for (const [bone, unbent] of copy.bent) bone.quaternion.copy(unbent)
  }

  function bend(copy) {
    copy.bent = []
    if (!copy.pitch) return
    const proneShare = copy.pitch > 0 ? PRONE_TORSO_DOWN : PRONE_TORSO_UP
    const torso = copy.pitch * TORSO_PITCH * (copy.prone ? proneShare : 1)
    turn(copy, copy.prone ? PRONE_BACK_SHARES : BACK_SHARES, torso)
    turn(copy, HEAD_SHARES, copy.pitch - torso)
  }

  function turn(copy, shares, pitch) {
    const by = new THREE.Quaternion()
    for (const [name, share] of shares) {
      const bone = copy.skeleton.getBoneByName(name)
      if (!bone) continue
      copy.bent.push([bone, bone.quaternion.clone()])
      bone.quaternion.multiply(by.setFromAxisAngle(PITCH_AXIS, share * pitch * d2r))
    }
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
    boneTree(weapon.bones, group, THREE.Object3D)
    return group
  }

  // Each surface's geometry and material, which every copy of the rig shares; `data` reads the rig's packed arrays.
  function meshesOf(rig, data, materials) {
    return rig.surfaces.map((s) => [geometryOf(data, s), world.modelMaterial(materials[s.material])])
  }

  // An add-on's rig's meshes, made once, as hands and a gun each show with many others.
  function addOnMeshesOf(rig) {
    if (!rigMeshes.has(rig)) {
      Object.assign(map.images, rig.images)
      rigMeshes.set(rig, meshesOf(rig, decodeGeometry(rig.geometry), rig.materials))
    }
    return rigMeshes.get(rig)
  }

  // The meshes and clips the copies of one rig, and of the gun hanging from it if any, share.
  function partsOf(rig, meshes, gunParts = null) {
    const clipBones = gunParts ? [...rig.bones, ...gunParts.bones] : rig.bones
    return { bones: rig.bones, meshes, gunParts, clipBones, clip: buildClip(clipBones, idle, () => true), upper: upperBody(rig.bones), clips: new Map() }
  }

  // The clip of `anim` for one rig over all its bones, or only the `upper` or `lower` body.
  function clipOf(parts, anim, part) {
    if (!parts.clips.has(anim)) parts.clips.set(anim, {})
    const clips = parts.clips.get(anim)
    const keep = { all: () => true, upper: (name) => parts.upper.has(name), lower: (name) => !parts.upper.has(name) }[part]
    clips[part] ??= buildClip(parts.clipBones, anim, keep)
    return clips[part]
  }

  function createCopy(yaw, parts) {
    const { bones, gunParts, clip } = parts
    const body = new THREE.Group()
    const made = boneTree(bones, body, THREE.Bone)
    const skeleton = new THREE.Skeleton(made)
    const skinned = (meshes) => meshes.map(([geometry, material]) => new THREE.SkinnedMesh(geometry, material))
    const meshes = skinned(parts.meshes)
    const gunMeshes = gunParts ? skinned(gunParts.meshes) : []
    body.add(...meshes, ...gunMeshes)
    // Bound before the copy is turned, so the bind pose is in the body's own frame.
    body.updateMatrixWorld(true)
    for (const mesh of meshes) mesh.bind(skeleton)
    const gunSkeleton = gunParts && attachSkinned(gunParts.bones, made, 'tag_weapon', gunMeshes)
    // The bind pose's bounds would cull a copy whose animation leans out of them.
    for (const mesh of [...meshes, ...gunMeshes]) mesh.frustumCulled = false
    body.rotation.z = yaw
    const mixer = new THREE.AnimationMixer(body)
    const start = (copies.length * PHASE_STEP) % clip.duration
    const action = mixer.clipAction(clip)
    action.play().time = start
    const outer = new THREE.Group()
    outer.rotation.x = -Math.PI / 2
    outer.add(body)
    copies.push({ outer, mixer, start, skeleton, gunSkeleton, parts, actions: [action], posed: false, pitch: 0, prone: false, bent: [] })
    return outer
  }
}

// The names of the upper body's bones: UPPER_BODY and every bone below it.
function upperBody(bones) {
  const upper = new Set()
  bones.forEach((b) => { if (b.name === UPPER_BODY || upper.has(bones[b.parent]?.name)) upper.add(b.name) })
  return upper
}
