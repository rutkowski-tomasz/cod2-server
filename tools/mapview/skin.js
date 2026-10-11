// Skinned xmodels in three.js: a rig's bones, its packed surfaces as geometry, and xanims as clips.
// THREE comes from the page script.

// `bones` as objects of the class `Make` in their bind pose, each under its parent or `root`.
export function boneTree(bones, root, Make) {
  const made = bones.map((b) => {
    const bone = new Make()
    bone.name = b.name
    bone.position.fromArray(b.offset)
    bone.quaternion.fromArray(b.rotation)
    return bone
  })
  bones.forEach((b, i) => (b.parent < 0 ? root : made[b.parent]).add(made[i]))
  return made
}

export function geometryOf(data, s) {
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

// Animated rotations replace the bone's own; animated translations are offsets from its position in the model file.
// Only the bones `keep` takes by name are animated; ones the rig lacks, such as another uniform's coat tails, never are.
export function buildClip(bones, anim, keep) {
  const times = (keys) => keys.frames.map((f) => f / anim.fps)
  const tracks = []
  for (const b of anim.bones.filter((a) => keep(a.name) && bones.some((r) => r.name === a.name))) {
    if (b.rotations) tracks.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times(b.rotations), b.rotations.values))
    if (b.translations) {
      const own = bones.find((x) => x.name === b.name).fileOffset
      const values = b.translations.values.map((v, i) => v + own[i % 3])
      tracks.push(new THREE.VectorKeyframeTrack(`${b.name}.position`, times(b.translations), values))
    }
  }
  // A single-frame animation, such as a gun's idle, still lasts a frame.
  return new THREE.AnimationClip('idle', Math.max(1, anim.frames - 1) / anim.fps, tracks)
}
