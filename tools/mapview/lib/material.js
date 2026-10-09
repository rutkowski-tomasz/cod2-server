// Reads a CoD2 material binary: technique set name and the image bound to each texture slot.
export function parseMaterial(buf) {
  const str = (off) => {
    if (off <= 0 || off >= buf.length) return ''
    const end = buf.indexOf(0, off)
    return buf.toString('latin1', off, end < 0 ? buf.length : end)
  }
  const name = str(buf.readUInt32LE(0))
  const textureCount = buf.readUInt16LE(0x34)
  const techset = str(buf.readUInt32LE(0x38))
  const tableOff = buf.readUInt32LE(0x3c)
  const textures = {}
  for (let i = 0; i < textureCount; i++) {
    const o = tableOff + i * 12
    if (o + 12 > buf.length) break
    textures[str(buf.readUInt32LE(o))] = str(buf.readUInt32LE(o + 8))
  }
  return { name, techset, textures, colorMap: textures.colorMap || Object.values(textures)[0] || '' }
}
