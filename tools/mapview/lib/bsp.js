// Parses compiled CoD2 maps (.d3dbsp, IBSP version 4).
const LUMP = { MATERIALS: 0, LIGHTMAPS: 1, TRISOUPS: 7, DRAWVERTS: 8, DRAWINDICES: 9, MODELS: 35, ENTITIES: 37 }
export const LIGHTMAP_SIZE = 1024
export const NO_LIGHTMAP = 31

export function parseBsp(buf) {
  if (buf.toString('latin1', 0, 4) !== 'IBSP') throw new Error('not an IBSP file')
  const version = buf.readUInt32LE(4)
  if (version !== 4) throw new Error(`unsupported IBSP version ${version} (expected 4, CoD2)`)
  const lumps = []
  for (let i = 0; i < 39; i++) lumps.push({ length: buf.readUInt32LE(8 + i * 8), offset: buf.readUInt32LE(12 + i * 8) })
  const lump = (i) => buf.subarray(lumps[i].offset, lumps[i].offset + lumps[i].length)

  const mats = lump(LUMP.MATERIALS)
  const materials = []
  for (let o = 0; o + 72 <= mats.length; o += 72) {
    const end = mats.indexOf(0, o)
    materials.push({ name: mats.toString('latin1', o, Math.min(end < 0 ? o + 64 : end, o + 64)), flags: mats.readUInt32LE(o + 64), contents: mats.readUInt32LE(o + 68) })
  }

  const soups = []
  const ts = lump(LUMP.TRISOUPS)
  for (let o = 0; o + 16 <= ts.length; o += 16) {
    soups.push({ material: ts.readUInt16LE(o), lightmap: ts.readUInt16LE(o + 2), firstVertex: ts.readUInt32LE(o + 4), vertexCount: ts.readUInt16LE(o + 8), indexCount: ts.readUInt16LE(o + 10), firstIndex: ts.readUInt32LE(o + 12) })
  }

  const dv = lump(LUMP.DRAWVERTS)
  const vertexCount = Math.floor(dv.length / 68)
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const lmuvs = new Float32Array(vertexCount * 2)
  const colors = new Uint8Array(vertexCount * 4)
  for (let i = 0; i < vertexCount; i++) {
    const o = i * 68
    positions[i * 3] = dv.readFloatLE(o); positions[i * 3 + 1] = dv.readFloatLE(o + 4); positions[i * 3 + 2] = dv.readFloatLE(o + 8)
    normals[i * 3] = dv.readFloatLE(o + 12); normals[i * 3 + 1] = dv.readFloatLE(o + 16); normals[i * 3 + 2] = dv.readFloatLE(o + 20)
    colors[i * 4] = dv[o + 24]; colors[i * 4 + 1] = dv[o + 25]; colors[i * 4 + 2] = dv[o + 26]; colors[i * 4 + 3] = dv[o + 27]
    uvs[i * 2] = dv.readFloatLE(o + 28); uvs[i * 2 + 1] = dv.readFloatLE(o + 32)
    lmuvs[i * 2] = dv.readFloatLE(o + 36); lmuvs[i * 2 + 1] = dv.readFloatLE(o + 40)
  }

  const di = lump(LUMP.DRAWINDICES)
  const indices = new Uint16Array(di.buffer.slice(di.byteOffset, di.byteOffset + di.length - (di.length % 2)))

  const models = []
  const ml = lump(LUMP.MODELS)
  for (let o = 0; o + 48 <= ml.length; o += 48) {
    models.push({
      mins: [ml.readFloatLE(o), ml.readFloatLE(o + 4), ml.readFloatLE(o + 8)],
      maxs: [ml.readFloatLE(o + 12), ml.readFloatLE(o + 16), ml.readFloatLE(o + 20)],
      firstSoup: ml.readUInt32LE(o + 24), soupCount: ml.readUInt32LE(o + 28),
    })
  }

  const lm = lump(LUMP.LIGHTMAPS)
  const pageBytes = LIGHTMAP_SIZE * LIGHTMAP_SIZE * 4
  const lightmaps = []
  for (let o = 0; o + pageBytes <= lm.length; o += pageBytes) lightmaps.push(lm.subarray(o, o + pageBytes))

  const entities = parseEntityString(lump(LUMP.ENTITIES).toString('latin1'))
  return { materials, soups, vertexCount, positions, normals, uvs, lmuvs, colors, indices, models, lightmaps, entities }
}

export function parseEntityString(text) {
  const entities = []
  const re = /\{([^}]*)\}/g
  let m
  while ((m = re.exec(text))) {
    const keys = {}
    for (const kv of m[1].matchAll(/"([^"]*)"\s*"([^"]*)"/g)) keys[kv[1]] = kv[2]
    entities.push({ keys, classname: keys.classname || '', brushes: [], patches: [] })
  }
  return entities
}
