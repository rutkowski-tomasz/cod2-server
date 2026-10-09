// Finds game files (materials, images, maps) across .iwd archives and loose directories.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Iwd } from './iwd.js'
import { decodeIwi } from './iwi.js'
import { parseMaterial } from './material.js'

export const TOOL_MATERIALS = /^(caulk|clip|nodraw|hint|skip|trigger|portal|lightgrid|ladder|mantle|sky$|origin|areaportal|sun_|lightmap_|\$|util_|physics|mirror|textures\/common)/i

export class Assets {
  constructor({ iwds = [], dirs = [] } = {}) {
    this.iwds = iwds.map((p) => new Iwd(p))
    this.dirs = dirs
    this.materialCache = new Map()
    this.imageCache = new Map()
  }

  static defaultIwdDirs() {
    const bin = process.env.COD2_BINARIES || path.join(os.homedir(), 'Dev', 'cod2-binaries')
    return [path.join(bin, '1_0'), path.join(bin, '1_3')].filter((d) => fs.existsSync(d))
  }

  static fromOptions({ iwd = [], dir = [], noDefaults = false } = {}) {
    const iwds = []
    const expand = (p) => {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        for (const f of fs.readdirSync(p).sort()) if (f.endsWith('.iwd')) expand(path.join(p, f))
      } else if (p.endsWith('.iwd') && fs.existsSync(p) && !isLfsPointer(p)) iwds.push(p)
    }
    if (!noDefaults) for (const d of Assets.defaultIwdDirs()) expand(d)
    for (const p of iwd) expand(p)
    return new Assets({ iwds: [...new Set(iwds)].reverse(), dirs: dir })
  }

  // Later iwds and loose dirs win, like the game's fs: loose dirs first, then iwds in reverse order.
  read(name) {
    for (const d of this.dirs) {
      const p = path.join(d, name)
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return fs.readFileSync(p)
    }
    for (const iwd of this.iwds) {
      const data = iwd.read(name)
      if (data) return data
    }
    return null
  }

  find(pattern) {
    const out = new Set()
    for (const d of this.dirs) walk(d, '', (rel) => { if (pattern.test(rel)) out.add(rel) })
    for (const iwd of this.iwds) for (const n of iwd.list()) if (pattern.test(n)) out.add(n)
    return [...out]
  }

  material(name) {
    if (this.materialCache.has(name)) return this.materialCache.get(name)
    const buf = this.read(`materials/${name}`)
    let mat = null
    if (buf) {
      try { mat = parseMaterial(buf) } catch (e) { mat = null }
    }
    this.materialCache.set(name, mat)
    return mat
  }

  image(name) {
    if (this.imageCache.has(name)) return this.imageCache.get(name)
    const buf = this.read(`images/${name}.iwi`)
    let img = null
    if (buf) {
      try { img = decodeIwi(buf) } catch (e) { img = null }
    }
    this.imageCache.set(name, img)
    return img
  }

  // The colour texture of a material, or null when either the material or its image is missing.
  texture(materialName) {
    const mat = this.material(materialName)
    if (!mat || !mat.colorMap || mat.colorMap.startsWith('$')) return null
    return this.image(mat.colorMap)
  }

  describe() {
    return { iwds: this.iwds.map((i) => i.path), dirs: this.dirs }
  }
}

// Git LFS repos keep unpulled files as small text pointers.
function isLfsPointer(p) {
  if (fs.statSync(p).size > 1024) return false
  return fs.readFileSync(p, 'latin1').startsWith('version https://git-lfs')
}

function walk(root, rel, fn) {
  const abs = path.join(root, rel)
  if (!fs.existsSync(abs)) return
  for (const f of fs.readdirSync(abs, { withFileTypes: true })) {
    const r = rel ? `${rel}/${f.name}` : f.name
    if (f.isDirectory()) walk(root, r, fn)
    else fn(r)
  }
}
