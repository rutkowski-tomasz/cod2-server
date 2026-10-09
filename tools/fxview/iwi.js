// IWI (CoD2 image, version 5) → RGBA of the largest mip.
// Header: "IWi", version, format, usage, u16 width, height, depth, 4 × u32 end offsets.
// Mips are stored smallest first, so the top mip is the last `size` bytes.
const FORMATS = { 1: 'argb8', 2: 'rgb8', 3: 'argb4', 5: 'a8', 6: 'l8', 7: 'la8', 11: 'dxt1', 12: 'dxt3', 13: 'dxt5' }

export function decodeIwi(buf) {
  if (buf.toString('latin1', 0, 3) !== 'IWi') throw new Error('not an IWI')
  const format = FORMATS[buf[4]]
  if (!format) throw new Error(`unsupported IWI format ${buf[4]}`)
  const width = buf.readUInt16LE(6)
  const height = buf.readUInt16LE(8)
  const size = mipSize(format, width, height)
  const data = buf.subarray(buf.length - size)
  const rgba = new Uint8Array(width * height * 4)
  switch (format) {
    case 'dxt1': decodeDxt(data, width, height, rgba, 1); break
    case 'dxt3': decodeDxt(data, width, height, rgba, 3); break
    case 'dxt5': decodeDxt(data, width, height, rgba, 5); break
    case 'argb8': for (let i = 0; i < width * height; i++) { rgba[i * 4] = data[i * 4 + 2]; rgba[i * 4 + 1] = data[i * 4 + 1]; rgba[i * 4 + 2] = data[i * 4]; rgba[i * 4 + 3] = data[i * 4 + 3] } break
    case 'rgb8': for (let i = 0; i < width * height; i++) { rgba[i * 4] = data[i * 3 + 2]; rgba[i * 4 + 1] = data[i * 3 + 1]; rgba[i * 4 + 2] = data[i * 3]; rgba[i * 4 + 3] = 255 } break
    case 'argb4': for (let i = 0; i < width * height; i++) { const v = data.readUInt16LE(i * 2); rgba[i * 4] = ((v >> 8) & 15) * 17; rgba[i * 4 + 1] = ((v >> 4) & 15) * 17; rgba[i * 4 + 2] = (v & 15) * 17; rgba[i * 4 + 3] = (v >> 12) * 17 } break
    case 'a8': for (let i = 0; i < width * height; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = data[i] } break
    case 'l8': for (let i = 0; i < width * height; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = data[i]; rgba[i * 4 + 3] = 255 } break
    case 'la8': for (let i = 0; i < width * height; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = data[i * 2]; rgba[i * 4 + 3] = data[i * 2 + 1] } break
  }
  return { width, height, format, rgba }
}

function mipSize(format, w, h) {
  const blocks = Math.max(1, w >> 2) * Math.max(1, h >> 2)
  switch (format) {
    case 'dxt1': return blocks * 8
    case 'dxt3': case 'dxt5': return blocks * 16
    case 'argb8': return w * h * 4
    case 'rgb8': return w * h * 3
    case 'argb4': case 'la8': return w * h * 2
    default: return w * h
  }
}

function decodeDxt(data, width, height, out, variant) {
  const blockBytes = variant === 1 ? 8 : 16
  const bw = Math.max(1, width >> 2)
  const bh = Math.max(1, height >> 2)
  const colors = new Uint8Array(16)
  const alphas = new Uint8Array(16)
  let p = 0
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++, p += blockBytes) {
      const cp = variant === 1 ? p : p + 8
      const c0 = data[cp] | (data[cp + 1] << 8)
      const c1 = data[cp + 2] | (data[cp + 3] << 8)
      rgb565(c0, colors, 0)
      rgb565(c1, colors, 4)
      if (c0 > c1 || variant !== 1) {
        for (let k = 0; k < 3; k++) {
          colors[8 + k] = (2 * colors[k] + colors[4 + k] + 1) / 3
          colors[12 + k] = (colors[k] + 2 * colors[4 + k] + 1) / 3
        }
        colors[11] = colors[15] = 255
      } else {
        for (let k = 0; k < 3; k++) { colors[8 + k] = (colors[k] + colors[4 + k]) >> 1; colors[12 + k] = 0 }
        colors[11] = 255
        colors[15] = 0
      }
      if (variant === 5) {
        const a0 = data[p]
        const a1 = data[p + 1]
        const table = [a0, a1]
        if (a0 > a1) for (let k = 1; k < 7; k++) table.push(((7 - k) * a0 + k * a1 + 3) / 7)
        else { for (let k = 1; k < 5; k++) table.push(((5 - k) * a0 + k * a1 + 2) / 5); table.push(0, 255) }
        let bits = 0n
        for (let k = 7; k >= 2; k--) bits = (bits << 8n) | BigInt(data[p + k])
        for (let i = 0; i < 16; i++) alphas[i] = table[Number((bits >> BigInt(i * 3)) & 7n)]
      } else if (variant === 3) {
        for (let i = 0; i < 16; i++) alphas[i] = ((data[p + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17
      }
      for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i & 3)
        const y = by * 4 + (i >> 2)
        if (x >= width || y >= height) continue
        const idx = (data[cp + 4 + (i >> 2)] >> ((i & 3) * 2)) & 3
        const o = (y * width + x) * 4
        out[o] = colors[idx * 4]
        out[o + 1] = colors[idx * 4 + 1]
        out[o + 2] = colors[idx * 4 + 2]
        out[o + 3] = variant === 1 ? colors[idx * 4 + 3] : alphas[i]
      }
    }
  }
}

function rgb565(c, out, o) {
  out[o] = ((c >> 11) & 31) * 255 / 31
  out[o + 1] = ((c >> 5) & 63) * 255 / 63
  out[o + 2] = (c & 31) * 255 / 31
  out[o + 3] = 255
}
