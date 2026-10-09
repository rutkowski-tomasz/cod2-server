// The bundle's player, one skinned copy per spawn, playing the idle animation in a loop.
// THREE comes from the page script. Each copy is built in CoD's Z-up frame, like the bundle's bones and geometry,
// and turned into three.js's Y-up one by its outer group.

// `materialOf` gives the material for a material info.
export function createPlayers(map, materialOf) {
  const { bones, surfaces, idle } = map.player
  const geometries = surfaces.map((s) => [geometryOf(map, s), materialOf(map.materials[s.material])])
  const clip = buildClip(bones, idle)
  const mixers = []
  return {
    // A copy facing `yaw` degrees, to place at the spawn's origin.
    create(yaw) {
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
      body.rotation.z = yaw * Math.PI / 180
      const mixer = new THREE.AnimationMixer(body)
      // Copies start at different points of the loop, so they do not move in step.
      mixer.clipAction(clip).play().time = (mixers.length * 0.37) % clip.duration
      mixers.push(mixer)
      const outer = new THREE.Group()
      outer.rotation.x = -Math.PI / 2
      outer.add(body)
      return outer
    },
    update(seconds) {
      for (const m of mixers) m.update(seconds)
    },
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
  const tracks = []
  for (const b of anim.bones) {
    const times = (keys) => keys.frames.map((f) => f / anim.fps)
    if (b.rotations) tracks.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times(b.rotations), b.rotations.values))
    if (b.translations) {
      const own = bones.find((x) => x.name === b.name).offset
      const values = b.translations.values.map((v, i) => v + own[i % 3])
      tracks.push(new THREE.VectorKeyframeTrack(`${b.name}.position`, times(b.translations), values))
    }
  }
  return new THREE.AnimationClip('idle', (anim.frames - 1) / anim.fps, tracks)
}
