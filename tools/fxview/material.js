// CoD2 material binary: string offsets at fixed header positions.
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
  if (!/^[\w./~&$-]+$/.test(name) || !/^[\w./~&$-]+$/.test(image)) return null
  return {
    name,
    image,
    techset,
    atlasCols: buf[0x0e] || 1,
    atlasRows: buf[0x0f] || 1,
    width: buf.readUInt16LE(0x1c),
    height: buf.readUInt16LE(0x1e),
    blend: techset.includes('_add') ? 'add' : techset.includes('multiply') ? 'multiply' : 'blend',
  }
}
