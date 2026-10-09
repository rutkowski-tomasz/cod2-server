// Decodes IWI (CoD2 image) files to RGBA. Only the largest mip level is read.
export const IWI_FORMATS = { 1: 'ARGB8', 2: 'RGB8', 3: 'A8', 0x0b: 'DXT1', 0x0c: 'DXT3', 0x0d: 'DXT5' }

export function decodeIwi(buf) {
  if (buf.toString('latin1', 0, 3) !== 'IWi') throw new Error('not an IWI file')
  const format = buf[4]
  const width = buf.readUInt16LE(6)
  const height = buf.readUInt16LE(8)
  const name = IWI_FORMATS[format]
  if (!name) throw new Error(`unsupported IWI format 0x${format.toString(16)}`)
  const cube = buf[5] === 5
  const faceBytes = mipSize(name, width, height)
  const faces = []
  for (let f = cube ? 6 : 1; f > 0; f--) faces.push(decodeFace(name, width, height, buf.subarray(buf.length - faceBytes * f, buf.length - faceBytes * (f - 1))))
  const hasAlpha = name === 'DXT3' || name === 'DXT5' || name === 'ARGB8' || name === 'A8'
  return { width, height, format: name, rgba: faces[0], faces: cube ? faces : null, hasAlpha }
}

function decodeFace(name, width, height, data) {
  const rgba = new Uint8Array(width * height * 4)
  if (name === 'DXT1') decodeDxt(data, width, height, rgba, 1)
  else if (name === 'DXT3') decodeDxt(data, width, height, rgba, 3)
  else if (name === 'DXT5') decodeDxt(data, width, height, rgba, 5)
  else if (name === 'ARGB8') for (let i = 0; i < width * height; i++) { rgba[i * 4] = data[i * 4 + 2]; rgba[i * 4 + 1] = data[i * 4 + 1]; rgba[i * 4 + 2] = data[i * 4]; rgba[i * 4 + 3] = data[i * 4 + 3] }
  else if (name === 'RGB8') for (let i = 0; i < width * height; i++) { rgba[i * 4] = data[i * 3 + 2]; rgba[i * 4 + 1] = data[i * 3 + 1]; rgba[i * 4 + 2] = data[i * 3]; rgba[i * 4 + 3] = 255 }
  else if (name === 'A8') for (let i = 0; i < width * height; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = data[i] }
  return rgba
}

function mipSize(format, w, h) {
  const bw = Math.max(1, (w + 3) >> 2), bh = Math.max(1, (h + 3) >> 2)
  switch (format) {
    case 'DXT1': return bw * bh * 8
    case 'DXT3': case 'DXT5': return bw * bh * 16
    case 'ARGB8': return w * h * 4
    case 'RGB8': return w * h * 3
    case 'A8': return w * h
  }
}

function decodeDxt(data, width, height, out, variant) {
  const blockBytes = variant === 1 ? 8 : 16
  const bw = Math.max(1, (width + 3) >> 2)
  const bh = Math.max(1, (height + 3) >> 2)
  const colors = new Uint8Array(16)
  const alphas = new Uint8Array(16)
  let p = 0
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let q = p
      if (variant === 3) {
        for (let i = 0; i < 8; i++) {
          const b = data[q + i]
          alphas[i * 2] = (b & 0xf) * 17
          alphas[i * 2 + 1] = (b >> 4) * 17
        }
        q += 8
      } else if (variant === 5) {
        const a0 = data[q], a1 = data[q + 1]
        const table = [a0, a1]
        if (a0 > a1) for (let i = 1; i < 7; i++) table.push(((7 - i) * a0 + i * a1) / 7)
        else { for (let i = 1; i < 5; i++) table.push(((5 - i) * a0 + i * a1) / 5); table.push(0, 255) }
        let bits = 0n
        for (let i = 0; i < 6; i++) bits |= BigInt(data[q + 2 + i]) << BigInt(8 * i)
        for (let i = 0; i < 16; i++) alphas[i] = table[Number((bits >> BigInt(3 * i)) & 7n)]
        q += 8
      } else alphas.fill(255)
      const c0 = data[q] | (data[q + 1] << 8)
      const c1 = data[q + 2] | (data[q + 3] << 8)
      rgb565(c0, colors, 0)
      rgb565(c1, colors, 4)
      if (c0 > c1 || variant !== 1) {
        for (let k = 0; k < 3; k++) {
          colors[8 + k] = (2 * colors[k] + colors[4 + k]) / 3
          colors[12 + k] = (colors[k] + 2 * colors[4 + k]) / 3
        }
        colors[11] = colors[15] = 255
      } else {
        for (let k = 0; k < 3; k++) { colors[8 + k] = (colors[k] + colors[4 + k]) / 2; colors[12 + k] = 0 }
        colors[11] = 255; colors[15] = 0
      }
      const idx = data[q + 4] | (data[q + 5] << 8) | (data[q + 6] << 16) | (data[q + 7] << 24)
      for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i & 3), y = by * 4 + (i >> 2)
        if (x >= width || y >= height) continue
        const ci = ((idx >>> (2 * i)) & 3) * 4
        const o = (y * width + x) * 4
        out[o] = colors[ci]; out[o + 1] = colors[ci + 1]; out[o + 2] = colors[ci + 2]
        out[o + 3] = variant === 1 ? colors[ci + 3] : alphas[i]
      }
      p += blockBytes
    }
  }
}

function rgb565(c, out, o) {
  out[o] = ((c >> 11) & 31) * 255 / 31
  out[o + 1] = ((c >> 5) & 63) * 255 / 63
  out[o + 2] = (c & 31) * 255 / 31
  out[o + 3] = 255
}
