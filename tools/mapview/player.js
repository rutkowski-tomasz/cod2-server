// The bundle's player, one skinned copy per spawn or live player, playing the idle animation in a loop.
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
// A sphere around a standing player, for telling whether it is on view.
const BODY_CENTER = 36
const BODY_RADIUS = 50

// `world` gives the floor the players stand on and the material models draw with.
export function createPlayers(map, world) {
  const { bones, surfaces, idle } = map.player
  const geometries = surfaces.map((s) => [geometryOf(map, s), world.modelMaterial(map.materials[s.material])])
  const clip = buildClip(bones, idle)
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
      const outer = createCopy((e.angles ? e.angles[1] : 0) * d2r)
      const drop = floorDrop(e.origin)
      outer.position.y = -drop
      // `offset` is the camera's position relative to the spawn, in three.js's frame.
      outer.userData.hides = (offset) => Math.hypot(offset.x, offset.z) < HIDE_RADIUS && offset.y > -drop && offset.y < HIDE_TOP
      return outer
    },
    // A copy facing +X with its feet at its parent's origin, for a live player; `remove` it once the player is gone.
    createLive() {
      return createCopy(0)
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

  function createCopy(yaw) {
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
    mixer.clipAction(clip).play().time = start
    const outer = new THREE.Group()
    outer.rotation.x = -Math.PI / 2
    outer.add(body)
    copies.push({ outer, mixer, start, skeleton })
    return outer
  }

  function floorDrop([x, y, z]) {
    const ray = new THREE.Raycaster(toThree(x, y, z + 1), new THREE.Vector3(0, -1, 0), 0, MAX_DROP)
    const hit = ray.intersectObject(world.occluders)[0]
    return hit ? hit.distance - 1 : 0
  }
}

function geometryOf(map, s) {
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(map.f32(s.positions), 3))
  geom.setAttribute('normal', new THREE.BufferAttribute(map.f32(s.normals), 3))
  if (s.tangents) geom.setAttribute('tangentU', new THREE.BufferAttribute(map.f32(s.tangents), 3))
  if (s.binormals) geom.setAttribute('binormalV', new THREE.BufferAttribute(map.f32(s.binormals), 3))
  geom.setAttribute('uv', new THREE.BufferAttribute(map.f32(s.uvs), 2))
  geom.setAttribute('rgba', new THREE.BufferAttribute(map.u8(s.colors), 4, true))
  geom.setAttribute('skinIndex', new THREE.BufferAttribute(map.u16(s.skinIndices), 4))
  geom.setAttribute('skinWeight', new THREE.BufferAttribute(map.f32(s.skinWeights), 4))
  geom.setIndex(new THREE.BufferAttribute(map.u32(s.indices), 1))
  return geom
}

// Animated rotations replace the bone's own; animated translations are offsets from its own position.
function buildClip(bones, anim) {
  const times = (keys) => keys.frames.map((f) => f / anim.fps)
  const tracks = []
  for (const b of anim.bones) {
    if (b.rotations) tracks.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times(b.rotations), b.rotations.values))
    if (b.translations) {
      const own = bones.find((x) => x.name === b.name).offset
      const values = b.translations.values.map((v, i) => v + own[i % 3])
      tracks.push(new THREE.VectorKeyframeTrack(`${b.name}.position`, times(b.translations), values))
    }
  }
  return new THREE.AnimationClip('idle', (anim.frames - 1) / anim.fps, tracks)
}
