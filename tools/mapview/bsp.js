// Reads compiled CoD2 maps (.d3dbsp, IBSP version 4) into entities, surfaces and lightmaps.
const LUMP = { MATERIALS: 0, LIGHTMAPS: 1, TRISOUPS: 7, DRAWVERTS: 8, DRAWINDICES: 9, MODELS: 35, ENTITIES: 37 }
const NO_LIGHTMAP = 31
const MATERIAL_BYTES = 72
const TRISOUP_BYTES = 16
const VERTEX_BYTES = 68
const MODEL_BYTES = 48
// A lightmap holds four 512x512 RGBA pages: directional coefficients for R, G and B, then sun visibility.
const LIGHTMAP_PAGE = 512

export function readBsp(buf) {
  if (buf.toString('latin1', 0, 4) !== 'IBSP') throw new Error('not an IBSP file')
  const version = buf.readUInt32LE(4)
  if (version !== 4) throw new Error(`unsupported IBSP version ${version} (expected 4, CoD2)`)
  const lump = (i) => buf.subarray(buf.readUInt32LE(12 + i * 8), buf.readUInt32LE(12 + i * 8) + buf.readUInt32LE(8 + i * 8))

  const mats = lump(LUMP.MATERIALS)
  const materials = []
  for (let o = 0; o + MATERIAL_BYTES <= mats.length; o += MATERIAL_BYTES) {
    const end = mats.indexOf(0, o)
    materials.push(mats.toString('latin1', o, Math.min(end < 0 ? o + 64 : end, o + 64)))
  }

  const soups = []
  const ts = lump(LUMP.TRISOUPS)
  for (let o = 0; o + TRISOUP_BYTES <= ts.length; o += TRISOUP_BYTES) {
    soups.push({ material: ts.readUInt16LE(o), lightmap: ts.readUInt16LE(o + 2), firstVertex: ts.readUInt32LE(o + 4), indexCount: ts.readUInt16LE(o + 10), firstIndex: ts.readUInt32LE(o + 12) })
  }

  const dv = lump(LUMP.DRAWVERTS)
  const vertex = (i) => {
    const o = i * VERTEX_BYTES
    return {
      position: [dv.readFloatLE(o), dv.readFloatLE(o + 4), dv.readFloatLE(o + 8)],
      normal: [dv.readFloatLE(o + 12), dv.readFloatLE(o + 16), dv.readFloatLE(o + 20)],
      color: [dv[o + 24], dv[o + 25], dv[o + 26], dv[o + 27]],
      uv: [dv.readFloatLE(o + 28), dv.readFloatLE(o + 32)],
      lmuv: [dv.readFloatLE(o + 36), dv.readFloatLE(o + 40)],
    }
  }
  const di = lump(LUMP.DRAWINDICES)

  const models = []
  const ml = lump(LUMP.MODELS)
  for (let o = 0; o + MODEL_BYTES <= ml.length; o += MODEL_BYTES) models.push({ firstSoup: ml.readUInt32LE(o + 24), soupCount: ml.readUInt32LE(o + 28) })

  const entities = parseEntities(lump(LUMP.ENTITIES).toString('latin1'))
  // Brush model *n belongs to the entity whose model key names it; model 0 is the world.
  const modelEntity = new Map([[0, 0]])
  entities.forEach((e, i) => {
    const m = /^\*(\d+)$/.exec(e.keys.model || '')
    if (m) modelEntity.set(+m[1], i)
  })

  const surfaces = []
  models.forEach((model, mi) => {
    const groups = new Map()
    for (let s = model.firstSoup; s < model.firstSoup + model.soupCount; s++) {
      const soup = soups[s]
      const key = `${soup.material}/${soup.lightmap}`
      if (!groups.has(key)) groups.set(key, { material: materials[soup.material] || `#${soup.material}`, lightmap: soup.lightmap === NO_LIGHTMAP ? -1 : soup.lightmap, remap: new Map(), positions: [], normals: [], colors: [], uvs: [], lmuvs: [], indices: [] })
      const g = groups.get(key)
      // D3D front faces are clockwise; flip each triangle for GL.
      for (let t = 0; t + 2 < soup.indexCount; t += 3) for (const i of [t, t + 2, t + 1]) {
        const v = soup.firstVertex + di.readUInt16LE((soup.firstIndex + i) * 2)
        if (!g.remap.has(v)) {
          g.remap.set(v, g.remap.size)
          const { position, normal, color, uv, lmuv } = vertex(v)
          g.positions.push(...position); g.normals.push(...normal); g.colors.push(...color); g.uvs.push(...uv); g.lmuvs.push(...lmuv)
        }
        g.indices.push(g.remap.get(v))
      }
    }
    for (const { remap, ...g } of groups.values()) surfaces.push({ entity: modelEntity.get(mi) ?? 0, ...g })
  })

  const lm = lump(LUMP.LIGHTMAPS)
  const pageBytes = LIGHTMAP_PAGE * LIGHTMAP_PAGE * 4
  const lightmaps = []
  for (let o = 0; o + pageBytes * 4 <= lm.length; o += pageBytes * 4) {
    lightmaps.push([0, 1, 2, 3].map((p) => ({ width: LIGHTMAP_PAGE, height: LIGHTMAP_PAGE, rgba: lm.subarray(o + p * pageBytes, o + (p + 1) * pageBytes) })))
  }
  return { entities, surfaces, lightmaps }
}

function parseEntities(text) {
  const entities = []
  for (const m of text.matchAll(/\{([^}]*)\}/g)) {
    const keys = {}
    for (const kv of m[1].matchAll(/"([^"]*)"\s*"([^"]*)"/g)) keys[kv[1]] = kv[2]
    entities.push({ classname: keys.classname || '', keys })
  }
  return entities
}
