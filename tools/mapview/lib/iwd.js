// Minimal zip reader for .iwd files: index the central directory, extract single entries.
import fs from 'node:fs'
import zlib from 'node:zlib'

export class Iwd {
  constructor(path) {
    this.path = path
    this.fd = fs.openSync(path, 'r')
    this.entries = new Map()
    this.#index()
  }

  #read(offset, length) {
    const buf = Buffer.alloc(length)
    fs.readSync(this.fd, buf, 0, length, offset)
    return buf
  }

  #index() {
    const size = fs.fstatSync(this.fd).size
    const tailLen = Math.min(size, 65557)
    const tail = this.#read(size - tailLen, tailLen)
    let eocd = -1
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
    }
    if (eocd < 0) throw new Error(`${this.path}: not a zip`)
    const count = tail.readUInt16LE(eocd + 10)
    const cdSize = tail.readUInt32LE(eocd + 12)
    const cdOffset = tail.readUInt32LE(eocd + 16)
    const cd = this.#read(cdOffset, cdSize)
    let p = 0
    for (let i = 0; i < count; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error(`${this.path}: bad central directory`)
      const method = cd.readUInt16LE(p + 10)
      const csize = cd.readUInt32LE(p + 20)
      const usize = cd.readUInt32LE(p + 24)
      const nameLen = cd.readUInt16LE(p + 28)
      const extraLen = cd.readUInt16LE(p + 30)
      const commentLen = cd.readUInt16LE(p + 32)
      const local = cd.readUInt32LE(p + 42)
      const name = cd.toString('latin1', p + 46, p + 46 + nameLen)
      if (!name.endsWith('/')) this.entries.set(name.toLowerCase(), { name, method, csize, usize, local })
      p += 46 + nameLen + extraLen + commentLen
    }
  }

  has(name) { return this.entries.has(name.toLowerCase()) }

  list() { return [...this.entries.values()].map((e) => e.name) }

  read(name) {
    const e = this.entries.get(name.toLowerCase())
    if (!e) return null
    const head = this.#read(e.local, 30)
    const nameLen = head.readUInt16LE(26)
    const extraLen = head.readUInt16LE(28)
    const data = this.#read(e.local + 30 + nameLen + extraLen, e.csize)
    if (e.method === 0) return data
    if (e.method === 8) return zlib.inflateRawSync(data)
    throw new Error(`${this.path}: ${name}: unsupported zip method ${e.method}`)
  }
}
