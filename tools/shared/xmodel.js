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
// bone gets the rest. Positions and directions are relative to their bone. Each vertex gets four bones and weights.
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
    const s = { bone, positions: [], normals: [], colors: [], uvs: [], binormals: [], tangents: [], indices: [], skinIndices: [], skinWeights: [] }
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
      s.positions.push(...vec3(o))
      o += extra ? 13 : 12
      const bones = [first, 0, 0, 0]
      const weights = [1, 0, 0, 0]
      for (let k = 1; k <= extra; k++, o += 16) {
        bones[k] = buf.readUInt16LE(o)
        weights[k] = buf.readUInt16LE(o + 14) / 65535
        weights[0] -= weights[k]
      }
      s.skinIndices.push(...bones)
      s.skinWeights.push(...weights)
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
  return surfaces.map(({ skinIndices, skinWeights, ...s }, i) => ({ ...s, material: lod.materials[i] }))
}

// Xmodels attached by bone name, as the game's `attach(model, "")` does: each model after the first reuses the bones
// it shares by name with the ones before and adds the rest. Returns the bones and every surface in the bind pose,
// or null when a model is missing.
export function readRig(names, search) {
  const bones = []
  const models = []
  for (const name of names) {
    const lod = readLod(name, search)
    const parts = lod && search.read(`xmodelparts/${lod.name}`)
    if (!parts) return null
    const index = []
    for (const b of parseParts(parts)) {
      const i = bones.findIndex((x) => x.name === b.name)
      index.push(i >= 0 ? i : bones.push({ ...b, parent: b.parent < 0 ? -1 : index[b.parent] }) - 1)
    }
    models.push({ lod, index })
  }
  const pose = bindPose(bones)
  const surfaces = models.flatMap(({ lod, index }) => parseSurfaces(lod.surfaces).map((s, i) => {
    const skinIndices = s.skinIndices.map((b) => index[b])
    const out = { ...s, skinIndices, material: lod.materials[i], positions: [], normals: [], binormals: [], tangents: [] }
    for (let v = 0; v < s.positions.length / 3; v++) {
      const { rotation, offset } = pose[skinIndices[v * 4]]
      const at = (a) => a.slice(v * 3, v * 3 + 3)
      out.positions.push(...rotate(rotation, at(s.positions)).map((x, k) => x + offset[k]))
      for (const key of ['normals', 'binormals', 'tangents']) out[key].push(...rotate(rotation, at(s[key])))
    }
    return out
  }))
  return { bones: bones.map(({ name, parent, offset, rotation }) => ({ name, parent, offset, rotation })), surfaces }
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
