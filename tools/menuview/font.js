// CoD2 font binary (fonts/*Font): u32 name offset, u32 pixel height, u32 glyph count, u32 material offset,
// then 24-byte glyphs: u16 letter, s8 x0, s8 y0 (from the baseline), u8 advance, u8 width, u8 height, pad, f32 s0 t0 s1 t1.
const cstr = (b, o) => b.toString('latin1', o, b.indexOf(0, o))

export function parseFont(buf) {
  const count = buf.readUInt32LE(8)
  const glyphs = {}
  for (let i = 0, p = 16; i < count; i++, p += 24) {
    glyphs[buf.readUInt16LE(p)] = [buf.readInt8(p + 2), buf.readInt8(p + 3), buf[p + 4], buf[p + 5], buf[p + 6], buf.readFloatLE(p + 8), buf.readFloatLE(p + 12), buf.readFloatLE(p + 16), buf.readFloatLE(p + 20)]
  }
  return { pixelHeight: buf.readUInt32LE(4), material: cstr(buf, buf.readUInt32LE(12)), glyphs }
}
