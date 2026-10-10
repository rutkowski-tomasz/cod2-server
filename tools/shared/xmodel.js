// CoD2 models, version 20. `xmodel/<name>` names the LODs and their materials; `xmodelsurfs/<lod>` holds the geometry
// and `xmodelparts/<lod>` the skeleton.
const VERSION = 20

const cstr = (b, o) => {
  let e = o
  while (b[e]) e++
  return [b.toString('latin1', o, e), e + 1]
}

// Returns the first LOD's surface file and material per surface, or null for a file of another version.
// Header: version, flags, bounds (6 floats), 4 × (float distance, name), collision LOD, collision surfaces, then per LOD a material list.
export function parseXModel(buf) {
  if (buf.length < 27 || buf.readUInt16LE(0) !== VERSION) return null
  let o = 27
  const lods = []
  for (let i = 0; i < 4; i++) {
    const [name, next] = cstr(buf, o + 4)
    o = next
    if (name) lods.push(name)
  }
  const collisionSurfaces = buf.readInt32LE(o + 4)
  o += 8
  // Each: triangle count, 48 bytes per triangle, then bounds and flags.
  for (let i = 0; i < collisionSurfaces; i++) o += 4 + buf.readInt32LE(o) * 48 + 36
  const materials = []
  const count = buf.readUInt16LE(o)
  o += 2
  for (let i = 0; i < count; i++) {
    const [name, next] = cstr(buf, o)
    o = next
    materials.push(name)
  }
  return { surfaces: lods[0], materials }
}

// Surface: tile mode u8, vertex count, triangle count, bone (-1 when every vertex names its own, then an unknown u16).
// Vertex: normal, colour, uv, binormal, tangent (48 bytes); with per-vertex bones, the extra weight count u8 and the
// bone u16; then the position. Extra weights follow an unknown byte: bone u16, position, weight u16 / 65535; the first
// bone gets the rest. Positions and directions are relative to their bone. Each vertex gets four bones and weights,
// and in `bonePositions` its position relative to each of them, zero for the unused ones.
export function parseSurfaces(buf) {
  const surfaces = []
  let o = 4
  const count = buf.readUInt16LE(2)
  const vec3 = (at) => [buf.readFloatLE(at), buf.readFloatLE(at + 4), buf.readFloatLE(at + 8)]
  for (let i = 0; i < count; i++) {
    const vertexCount = buf.readUInt16LE(o + 1)
    const triangleCount = buf.readUInt16LE(o + 3)
    const bone = buf.readInt16LE(o + 5)
    o += bone === -1 ? 9 : 7
    const s = { bone, positions: [], normals: [], colors: [], uvs: [], binormals: [], tangents: [], indices: [], skinIndices: [], skinWeights: [], bonePositions: [] }
    for (let v = 0; v < vertexCount; v++) {
      s.normals.push(...vec3(o))
      s.colors.push(buf[o + 12], buf[o + 13], buf[o + 14], buf[o + 15])
      s.uvs.push(buf.readFloatLE(o + 16), buf.readFloatLE(o + 20))
      s.binormals.push(...vec3(o + 24))
      s.tangents.push(...vec3(o + 36))
      o += 48
      let extra = 0
      let first = bone
      if (bone === -1) {
        extra = buf[o]
        first = buf.readUInt16LE(o + 1)
        o += 3
      }
      const position = vec3(o)
      s.positions.push(...position)
      o += extra ? 13 : 12
      const bones = [first, 0, 0, 0]
      const weights = [1, 0, 0, 0]
      const positions = [position, [0, 0, 0], [0, 0, 0], [0, 0, 0]]
      for (let k = 1; k <= extra; k++, o += 16) {
        bones[k] = buf.readUInt16LE(o)
        positions[k] = vec3(o + 2)
        weights[k] = buf.readUInt16LE(o + 14) / 65535
        weights[0] -= weights[k]
      }
      s.skinIndices.push(...bones)
      s.skinWeights.push(...weights)
      s.bonePositions.push(...positions.flat())
    }
    for (let t = 0; t < triangleCount * 3; t++, o += 2) s.indices.push(buf.readUInt16LE(o))
    surfaces.push(s)
  }
  return surfaces
}

// Bones: first the roots, at the origin, then the rest, each with its parent's index, offset and rotation relative to
// it (19 bytes); then every name, then a classification byte per bone.
export function parseParts(buf) {
  const relative = buf.readUInt16LE(2)
  const roots = buf.readUInt16LE(4)
  const bones = []
  for (let i = 0; i < roots; i++) bones.push({ parent: -1, offset: [0, 0, 0], rotation: [0, 0, 0, 1] })
  let o = 6
  for (let i = 0; i < relative; i++, o += 19) {
    bones.push({
      parent: buf.readInt8(o),
      offset: [buf.readFloatLE(o + 1), buf.readFloatLE(o + 5), buf.readFloatLE(o + 9)],
      rotation: shortQuaternion(buf.readInt16LE(o + 13), buf.readInt16LE(o + 15), buf.readInt16LE(o + 17)),
    })
  }
  for (const bone of bones) [bone.name, o] = cstr(buf, o)
  return bones
}

// x, y and z as i16 / 32767; w is the positive rest of a unit quaternion.
export function shortQuaternion(x, y, z) {
  const q = [x / 32767, y / 32767, z / 32767]
  return [...q, Math.sqrt(Math.max(0, 1 - q[0] * q[0] - q[1] * q[1] - q[2] * q[2]))]
}

// The first LOD's surfaces of the xmodel at `name`, each with its material, or null when the model is missing,
// skinned or bound to a bone other than the root.
export function readXModel(name, search) {
  const lod = readLod(name, search)
  const surfaces = lod && parseSurfaces(lod.surfaces)
  if (!surfaces?.every((s) => s.bone === 0)) return null
  return surfaces.map((s, i) => ({ ...s, material: lod.materials[i] }))
}

// Xmodels attached by bone name, as the game's `attach(model, "")` does: each model after the first reuses the bones
// it shares by name with the ones before and adds the rest. With `attachTo`, the root bones of the models after the
// first hang from the bone of that name, as a gun from the hands' tag_weapon. Returns the bones and every surface in
// the bind pose, or null when a model is missing. A bone's `offset` may be moved so its vertices hold together (see
// placeBones); `fileOffset` keeps the file's, which an animation's translations are relative to.
export function readRig(names, search, attachTo) {
  const bones = []
  const models = []
  for (const name of names) {
    const lod = readLod(name, search)
    const parts = lod && search.read(`xmodelparts/${lod.name}`)
    if (!parts) return null
    const index = []
    const root = models.length ? bones.findIndex((x) => x.name === attachTo) : -1
    for (const b of parseParts(parts)) {
      const i = bones.findIndex((x) => x.name === b.name)
      index.push(i >= 0 ? i : bones.push({ ...b, parent: b.parent < 0 ? root : index[b.parent] }) - 1)
    }
    models.push({ lod, index })
  }
  const parsed = models.flatMap(({ lod, index }) => parseSurfaces(lod.surfaces).map((s, i) => ({ ...s, skinIndices: s.skinIndices.map((b) => index[b]), material: lod.materials[i] })))
  placeBones(bones, parsed)
  const pose = bindPose(bones)
  const surfaces = parsed.map((s) => {
    const out = { ...s, positions: [], normals: [], binormals: [], tangents: [] }
    for (let v = 0; v < s.positions.length / 3; v++) {
      const { rotation, offset } = pose[s.skinIndices[v * 4]]
      const at = (a) => a.slice(v * 3, v * 3 + 3)
      out.positions.push(...rotate(rotation, at(s.positions)).map((x, k) => x + offset[k]))
      for (const key of ['normals', 'binormals', 'tangents']) out[key].push(...rotate(rotation, at(s[key])))
    }
    return out
  })
  return { bones, surfaces }
}

// Viewmodel hands keep every bone at its parent's origin and leave placing them to the animations, but a vertex
// stores its position relative to each bone it follows. three.js skins from one bind position per vertex, so where
// those positions disagree in the bind pose, the vertex is pulled apart. Moves each bone that shares vertices with
// others to where its positions meet theirs, keeping the rotations.
function placeBones(bones, surfaces) {
  const rotations = bindPose(bones).map((p) => p.rotation)
  // Per bone, the bones it shares a vertex with and its gap from each: its position minus theirs, in model space.
  const links = bones.map(() => new Map())
  for (const s of surfaces) {
    const fromBone = (slot) => rotate(rotations[s.skinIndices[slot]], s.bonePositions.slice(slot * 3, slot * 3 + 3))
    for (let v = 0; v < s.positions.length / 3; v++) {
      const first = s.skinIndices[v * 4]
      const fromFirst = fromBone(v * 4)
      for (let slot = v * 4 + 1; slot < v * 4 + 4; slot++) {
        const bone = s.skinIndices[slot]
        if (!s.skinWeights[slot] || bone === first || links[bone].has(first)) continue
        const fromOther = fromBone(slot)
        const gap = fromFirst.map((x, j) => x - fromOther[j])
        links[bone].set(first, gap)
        links[first].set(bone, gap.map((x) => -x))
      }
    }
  }
  // Each bone's position in model space: from its parent, unless a linked bone placed it first.
  const placed = []
  bones.forEach((b, i) => {
    if (placed[i]) return
    const parent = placed[b.parent]
    placed[i] = parent ? rotate(rotations[b.parent], b.offset).map((x, k) => x + parent[k]) : b.offset
    const queue = [i]
    while (queue.length) {
      const from = queue.shift()
      for (const [other, gap] of links[from]) {
        if (placed[other]) continue
        placed[other] = placed[from].map((x, k) => x - gap[k])
        queue.push(other)
      }
    }
  })
  bones.forEach((b, i) => {
    b.fileOffset = b.offset
    if (b.parent < 0) {
      b.offset = placed[i]
      return
    }
    const [x, y, z, w] = rotations[b.parent]
    b.offset = rotate([-x, -y, -z, w], placed[i].map((v, k) => v - placed[b.parent][k]))
  })
}

function readLod(name, search) {
  const xmodel = search.read(name)
  const parsed = xmodel && parseXModel(xmodel)
  const surfaces = parsed && search.read(`xmodelsurfs/${parsed.surfaces}`)
  return surfaces ? { name: parsed.surfaces, materials: parsed.materials, surfaces } : null
}

// Each bone's rotation and offset in model space. Parents come before their children.
function bindPose(bones) {
  const pose = []
  for (const b of bones) {
    const p = pose[b.parent]
    pose.push(p ? { rotation: multiply(p.rotation, b.rotation), offset: rotate(p.rotation, b.offset).map((x, k) => x + p.offset[k]) } : b)
  }
  return pose
}

function multiply([ax, ay, az, aw], [bx, by, bz, bw]) {
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}

function rotate([qx, qy, qz, qw], [x, y, z]) {
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x)
  return [x + qw * tx + qy * tz - qz * ty, y + qw * ty + qz * tx - qx * tz, z + qw * tz + qx * ty - qy * tx]
}
