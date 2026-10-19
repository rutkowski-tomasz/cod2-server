// IWI (CoD2 image, version 5) → RGBA of the largest mip, or null for an unsupported format.
// Header: "IWi", version, format, usage, u16 width, height, depth, 4 × u32 end offsets.
// Mips are stored smallest first, so the top mip is the last `size` bytes.
// Formats 6 and 7 are wavelet-compressed argb8 and rgb8.
import { decodeWavelet } from './iwi-wavelet.js'

const FORMATS = { 1: 'argb8', 2: 'rgb8', 3: 'la8', 6: 'argb8', 7: 'rgb8', 11: 'dxt1', 12: 'dxt3', 13: 'dxt5' }
const WAVELET_FORMATS = [6, 7]
const HEADER_SIZE = 28
// Usage bit 4 marks a cube map (skies): six faces, whose top mips are the last six `size` blocks, in face order.
const USAGE_CUBE = 4

// Header fields; `format` is undefined when the decoder does not support it.
export function iwiInfo(buf) {
  if (buf.toString('latin1', 0, 3) !== 'IWi') throw new Error('not an IWI')
  return {
    format: FORMATS[buf[4]], width: buf.readUInt16LE(6), height: buf.readUInt16LE(8),
    cube: (buf[5] & USAGE_CUBE) !== 0, wavelet: WAVELET_FORMATS.includes(buf[4]),
  }
}

export function decodeIwi(buf) {
  const { format, width, height, cube, wavelet } = iwiInfo(buf)
  if (!format) return null
  if (wavelet) {
    const samples = decodeWavelet(buf.subarray(HEADER_SIZE), width, height, format === 'argb8' ? 4 : 3)
    return { width, height, rgba: decodeMip(format, width, height, samples) }
  }
  const size = mipSize(format, width, height)
  const faceCount = cube ? 6 : 1
  const faces = []
  for (let f = faceCount; f > 0; f--) faces.push(decodeMip(format, width, height, buf.subarray(buf.length - size * f, buf.length - size * (f - 1))))
  return { width, height, rgba: faces[0], faces: faceCount === 6 ? faces : undefined }
}

function decodeMip(format, width, height, data) {
  const rgba = new Uint8Array(width * height * 4)
  switch (format) {
    case 'dxt1': decodeDxt(data, width, height, rgba, 1); break
    case 'dxt3': decodeDxt(data, width, height, rgba, 3); break
    case 'dxt5': decodeDxt(data, width, height, rgba, 5); break
    case 'argb8': for (let i = 0; i < width * height; i++) { rgba[i * 4] = data[i * 4 + 2]; rgba[i * 4 + 1] = data[i * 4 + 1]; rgba[i * 4 + 2] = data[i * 4]; rgba[i * 4 + 3] = data[i * 4 + 3] } break
    case 'rgb8': for (let i = 0; i < width * height; i++) { rgba[i * 4] = data[i * 3 + 2]; rgba[i * 4 + 1] = data[i * 3 + 1]; rgba[i * 4 + 2] = data[i * 3]; rgba[i * 4 + 3] = 255 } break
    case 'la8': for (let i = 0; i < width * height; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = data[i * 2]; rgba[i * 4 + 3] = data[i * 2 + 1] } break
  }
  return rgba
}

function mipSize(format, w, h) {
  const blocks = Math.max(1, w >> 2) * Math.max(1, h >> 2)
  switch (format) {
    case 'dxt1': return blocks * 8
    case 'dxt3': case 'dxt5': return blocks * 16
    case 'argb8': return w * h * 4
    case 'rgb8': return w * h * 3
    case 'la8': return w * h * 2
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

// RGBA → IWI version 5 in DXT5, with every mip down to 1×1, stored smallest first.
// The header's 4 offsets are where each of the 4 largest mips ends.
export function encodeIwi(width, height, rgba) {
  const mips = []
  for (let w = width, h = height, img = rgba; ; [w, h, img] = halve(w, h, img)) {
    mips.push(encodeDxt5(w, h, img))
    if (w === 1 && h === 1) break
  }
  const header = Buffer.alloc(HEADER_SIZE)
  header.write('IWi', 0, 'latin1')
  header[3] = 5
  header[4] = 13
  header.writeUInt16LE(width, 6)
  header.writeUInt16LE(height, 8)
  header.writeUInt16LE(1, 10)
  let end = HEADER_SIZE + mips.reduce((sum, m) => sum + m.length, 0)
  for (let i = 0; i < 4; i++) {
    header.writeUInt32LE(end, 12 + i * 4)
    end -= mips[i]?.length ?? 0
  }
  return Buffer.concat([header, ...mips.reverse()])
}

function halve(w, h, rgba) {
  const nw = Math.max(1, w >> 1)
  const nh = Math.max(1, h >> 1)
  const out = new Uint8Array(nw * nh * 4)
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let c = 0; c < 4; c++) {
    let sum = 0
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) sum += rgba[(Math.min(2 * y + dy, h - 1) * w + Math.min(2 * x + dx, w - 1)) * 4 + c]
    out[(y * nw + x) * 4 + c] = Math.round(sum / 4)
  }
  return [nw, nh, out]
}

function encodeDxt5(width, height, rgba) {
  const bw = Math.max(1, width >> 2)
  const bh = Math.max(1, height >> 2)
  const out = Buffer.alloc(bw * bh * 16)
  const block = []
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      for (let i = 0; i < 16; i++) {
        const o = (Math.min(by * 4 + (i >> 2), height - 1) * width + Math.min(bx * 4 + (i & 3), width - 1)) * 4
        block[i] = rgba.subarray(o, o + 4)
      }
      encodeDxt5Block(block, out, (by * bw + bx) * 16)
    }
  }
  return out
}

// Endpoints are the block's per-channel min and max; each pixel takes the nearest palette entry.
function encodeDxt5Block(block, out, p) {
  let a0 = 0, a1 = 255
  const hi = [0, 0, 0], lo = [255, 255, 255]
  for (const px of block) {
    a0 = Math.max(a0, px[3]); a1 = Math.min(a1, px[3])
    for (let k = 0; k < 3; k++) { hi[k] = Math.max(hi[k], px[k]); lo[k] = Math.min(lo[k], px[k]) }
  }
  const alphas = [a0, a1]
  for (let k = 1; k < 7; k++) alphas.push(((7 - k) * a0 + k * a1) / 7)
  let alphaBits = 0n
  block.forEach((px, i) => {
    const best = a0 === a1 ? 0 : nearest(alphas, (a) => Math.abs(a - px[3]))
    alphaBits |= BigInt(best) << BigInt(i * 3)
  })
  out[p] = a0
  out[p + 1] = a1
  for (let k = 0; k < 6; k++) out[p + 2 + k] = Number((alphaBits >> BigInt(k * 8)) & 255n)

  let c0 = to565(hi), c1 = to565(lo)
  if (c0 < c1) [c0, c1] = [c1, c0]
  out.writeUInt16LE(c0, p + 8)
  out.writeUInt16LE(c1, p + 10)
  if (c0 === c1) return
  const colors = new Uint8Array(16)
  rgb565(c0, colors, 0)
  rgb565(c1, colors, 4)
  for (let k = 0; k < 3; k++) {
    colors[8 + k] = (2 * colors[k] + colors[4 + k] + 1) / 3
    colors[12 + k] = (colors[k] + 2 * colors[4 + k] + 1) / 3
  }
  const palette = [0, 1, 2, 3].map((j) => colors.subarray(j * 4, j * 4 + 3))
  let colorBits = 0
  block.forEach((px, i) => {
    colorBits |= nearest(palette, (c) => (c[0] - px[0]) ** 2 + (c[1] - px[1]) ** 2 + (c[2] - px[2]) ** 2) << (i * 2)
  })
  out.writeUInt32LE(colorBits >>> 0, p + 12)
}

const to565 = ([r, g, b]) => ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)

function nearest(entries, distance) {
  let best = 0
  for (let i = 1; i < entries.length; i++) if (distance(entries[i]) < distance(entries[best])) best = i
  return best
}
