// Asset lookup across plain folders and .iwd (zip) archives.
import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync, existsSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

const HOME = homedir()
// Stock game first, then the mod's unpacked iwd folders; later entries override earlier ones.
const DEFAULT_SOURCES = [
  `${HOME}/Dev/cod2-binaries/1_0`,
  `${HOME}/Dev/cod2-binaries/1_3`,
  ...modFolders(`${HOME}/Dev/nl-cod2-zom-iwds/iwds`),
]

function modFolders(root) {
  if (!existsSync(root)) return []
  const out = []
  for (const iwd of readdirSync(root)) {
    const dir = join(root, iwd)
    if (!statSync(dir).isDirectory()) continue
    for (const feature of readdirSync(dir)) if (statSync(join(dir, feature)).isDirectory()) out.push(join(dir, feature))
  }
  return out
}

export function createSearch(extraSources = []) {
  const search = new AssetSearch()
  for (const s of [...DEFAULT_SOURCES, ...extraSources]) search.add(resolve(s))
  return search
}

class AssetSearch {
  constructor() {
    this.sources = []
  }

  add(path) {
    if (!existsSync(path)) return
    const st = statSync(path)
    if (st.isDirectory()) {
      const iwds = readdirSync(path).filter((f) => f.endsWith('.iwd') && isZip(join(path, f)))
      if (iwds.length) iwds.sort().forEach((f) => this.sources.push(new ZipSource(join(path, f))))
      else this.sources.push(new DirSource(path))
    } else if (isZip(path)) {
      this.sources.push(new ZipSource(path))
    }
  }

  // Returns Buffer or null. `name` is a forward-slash path inside the iwd, e.g. "materials/gfx_hotspot".
  read(name) {
    const source = this.find(name)
    return source ? source.read(name) : null
  }

  find(name) {
    for (let i = this.sources.length - 1; i >= 0; i--) if (this.sources[i].has(name)) return this.sources[i]
    return null
  }

  list(prefix) {
    const out = new Set()
    for (const s of this.sources) for (const n of s.names()) if (n.startsWith(prefix)) out.add(n)
    return [...out].sort()
  }
}

// Git LFS pointer files have the .iwd name but no zip content.
function isZip(path) {
  if (!statSync(path).isFile()) return false
  const fd = openSync(path, 'r')
  const head = Buffer.alloc(2)
  readSync(fd, head, 0, 2, 0)
  closeSync(fd)
  return head[0] === 0x50 && head[1] === 0x4b
}

class DirSource {
  constructor(dir) {
    this.dir = dir
    this.path = dir
  }
  has(name) {
    return existsSync(join(this.dir, name)) && statSync(join(this.dir, name)).isFile()
  }
  read(name) {
    return readFileSync(join(this.dir, name))
  }
  names() {
    const out = []
    const walk = (rel) => {
      for (const e of readdirSync(join(this.dir, rel), { withFileTypes: true })) {
        const p = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) walk(p)
        else out.push(p)
      }
    }
    walk('')
    return out
  }
}

class ZipSource {
  constructor(path) {
    this.path = path
    this.entries = readCentralDirectory(path)
  }
  has(name) {
    return this.entries.has(name)
  }
  read(name) {
    const e = this.entries.get(name)
    const fd = openSync(this.path, 'r')
    try {
      const head = Buffer.alloc(30)
      readSync(fd, head, 0, 30, e.offset)
      const nameLen = head.readUInt16LE(26)
      const extraLen = head.readUInt16LE(28)
      const data = Buffer.alloc(e.compressedSize)
      readSync(fd, data, 0, e.compressedSize, e.offset + 30 + nameLen + extraLen)
      if (e.method === 0) return data
      if (e.method === 8) return inflateRawSync(data)
      throw new Error(`${this.path}: unsupported zip method ${e.method} for ${name}`)
    } finally {
      closeSync(fd)
    }
  }
  names() {
    return [...this.entries.keys()]
  }
}

function readCentralDirectory(path) {
  const fd = openSync(path, 'r')
  try {
    const size = statSync(path).size
    const tailLen = Math.min(size, 65557)
    const tail = Buffer.alloc(tailLen)
    readSync(fd, tail, 0, tailLen, size - tailLen)
    let eocd = -1
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
    if (eocd < 0) throw new Error(`${path}: not a zip`)
    const count = tail.readUInt16LE(eocd + 10)
    const cdSize = tail.readUInt32LE(eocd + 12)
    const cdOffset = tail.readUInt32LE(eocd + 16)
    const cd = Buffer.alloc(cdSize)
    readSync(fd, cd, 0, cdSize, cdOffset)
    const entries = new Map()
    let p = 0
    for (let i = 0; i < count; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error(`${path}: bad central directory`)
      const method = cd.readUInt16LE(p + 10)
      const compressedSize = cd.readUInt32LE(p + 20)
      const nameLen = cd.readUInt16LE(p + 28)
      const extraLen = cd.readUInt16LE(p + 30)
      const commentLen = cd.readUInt16LE(p + 32)
      const offset = cd.readUInt32LE(p + 42)
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen)
      if (!name.endsWith('/')) entries.set(name, { method, compressedSize, offset })
      p += 46 + nameLen + extraLen + commentLen
    }
    return entries
  } finally {
    closeSync(fd)
  }
}
