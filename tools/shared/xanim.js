// CoD2 animations, version 14: per bone, rotations and translations relative to the parent, each at its own frames.
import { shortQuaternion } from './xmodel.js'

const VERSION = 14
const LOOPING = 1
// Moves tag_origin, as walking animations do; such animations start with its keys.
const DELTA = 2

// Header: version, frame count, bone count, flags u8, frames per second. A looping animation has one more frame,
// which returns to the first. Then two bit sets over the bones: one of unknown meaning, and rotations about z alone.
// Then the bone names, then each bone's rotation and translation keys. Returns null for another version.
// Rotations take the parent's frame; translations are offsets from the bone's position in the model.
export function parseXAnim(buf) {
  if (buf.readUInt16LE(0) !== VERSION) return null
  let frames = buf.readUInt16LE(2)
  const count = buf.readUInt16LE(4)
  const flags = buf[6]
  const fps = buf.readUInt16LE(7)
  let o = 9

  // A key list: its count, then frame numbers unless it keys one frame or every frame, then the values.
  const keys = (read) => {
    const n = buf.readUInt16LE(o)
    o += 2
    if (n === 0) return null
    let numbers = [...Array(n).keys()]
    if (n !== 1 && n !== frames) {
      const wide = frames > 255
      numbers = numbers.map(() => { const f = wide ? buf.readUInt16LE(o) : buf[o]; o += wide ? 2 : 1; return f })
    }
    return { frames: numbers, values: numbers.flatMap(read) }
  }
  const short = () => { const v = buf.readInt16LE(o); o += 2; return v }
  const rotations = (zOnly) => keys(() => (zOnly ? shortQuaternion(0, 0, short()) : shortQuaternion(short(), short(), short())))
  const translations = () => keys(() => { const v = [0, 4, 8].map((k) => buf.readFloatLE(o + k)); o += 12; return v })

  if (flags & DELTA) { rotations(true); translations() }
  if (flags & LOOPING) frames++
  // Reading the first set as negative w crosses the idle's left leg behind the right, off the floor.
  const setSize = ((count - 1) >> 3) + 1
  const zOnly = buf.subarray(o + setSize, o + 2 * setSize)
  o += 2 * setSize
  const names = []
  for (let i = 0; i < count; i++) {
    const end = buf.indexOf(0, o)
    names.push(buf.toString('latin1', o, end))
    o = end + 1
  }
  const bit = (set, i) => (set[i >> 3] >> (i & 7)) & 1
  const bones = names.map((name, i) => ({ name, rotations: rotations(bit(zOnly, i)), translations: translations() }))
  return { fps, frames, bones }
}
