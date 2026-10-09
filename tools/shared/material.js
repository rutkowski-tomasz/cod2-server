// CoD2 material binary: string offsets at fixed header positions, then a texture table:
// count (u8) at 0x34, table offset at 0x3C, 12 bytes per entry (sampler name, sampler state, image name).
const cstr = (b, o) => {
  let e = o
  while (e < b.length && b[e]) e++
  return b.toString('latin1', o, e)
}

export function parseMaterial(buf) {
  if (buf.length < 0x50) return null
  const name = cstr(buf, buf.readUInt32LE(0x00))
  const image = cstr(buf, buf.readUInt32LE(0x04))
  const techset = cstr(buf, buf.readUInt32LE(0x38))
  if (!/^[\w./~&$@#-]+$/.test(name) || !/^[\w./~&$@#-]+$/.test(image)) return null
  const textures = {}
  for (let i = 0, o = buf.readUInt32LE(0x3c); i < buf[0x34]; i++, o += 12) textures[cstr(buf, buf.readUInt32LE(o))] = cstr(buf, buf.readUInt32LE(o + 8))
  return {
    image,
    normalMap: textures.normalMap,
    specularMap: textures.specularMap,
    techset,
    atlasCols: buf[0x0e] || 1,
    atlasRows: buf[0x0f] || 1,
    blend: techset.includes('distortion') ? 'distortion' : techset.includes('_add') ? 'add' : techset.includes('multiply') ? 'multiply' : 'blend',
    feather: techset.includes('zfeather'),
  }
}
