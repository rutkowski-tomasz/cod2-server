// CoD2 models, version 20. `xmodel/<name>` names the LODs and their materials; `xmodelsurfs/<lod>` holds the geometry.
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

// Returns rigid surfaces bound to the root bone, or null when any surface is skinned or bound to another bone.
// Surface: tile mode u8, vertex count, triangle count, bone (0xffff: skinned). Vertex, 60 bytes:
// normal, colour, uv, binormal, tangent, position.
export function parseSurfaces(buf) {
  const surfaces = []
  let o = 4
  const count = buf.readUInt16LE(2)
  for (let i = 0; i < count; i++) {
    const vertexCount = buf.readUInt16LE(o + 1)
    const triangleCount = buf.readUInt16LE(o + 3)
    if (buf.readUInt16LE(o + 5) !== 0) return null
    o += 7
    const positions = []
    const normals = []
    const colors = []
    const uvs = []
    for (let v = 0; v < vertexCount; v++, o += 60) {
      normals.push(buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8))
      colors.push(buf[o + 12], buf[o + 13], buf[o + 14], buf[o + 15])
      uvs.push(buf.readFloatLE(o + 16), buf.readFloatLE(o + 20))
      positions.push(buf.readFloatLE(o + 48), buf.readFloatLE(o + 52), buf.readFloatLE(o + 56))
    }
    const indices = []
    for (let t = 0; t < triangleCount * 3; t++, o += 2) indices.push(buf.readUInt16LE(o))
    surfaces.push({ positions, normals, colors, uvs, indices })
  }
  return surfaces
}

// The first LOD's surfaces of the xmodel at `name`, each with its material, or null when the model is missing,
// skinned or bound to a bone other than the root.
export function readXModel(name, search) {
  const xmodel = search.read(name)
  const parsed = xmodel && parseXModel(xmodel)
  const file = parsed && search.read(`xmodelsurfs/${parsed.surfaces}`)
  const surfaces = file && parseSurfaces(file)
  return surfaces ? surfaces.map((s, i) => ({ ...s, material: parsed.materials[i] })) : null
}
