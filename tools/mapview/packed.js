// Readers of packed arrays sent as base64: the bundle's geometry, or a rig's.
export function decodeGeometry(base64) {
  const text = atob(base64)
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
  return {
    u8: (ref) => new Uint8Array(bytes.buffer, ref.offset, ref.count),
    u16: (ref) => new Uint16Array(bytes.buffer, ref.offset, ref.count),
    f32: (ref) => new Float32Array(bytes.buffer, ref.offset, ref.count),
    u32: (ref) => new Uint32Array(bytes.buffer, ref.offset, ref.count),
  }
}
