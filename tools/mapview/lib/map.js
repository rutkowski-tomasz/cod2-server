// Parses CoD2 Radiant .map files (iwmap 4): entities, brushes, mesh/curve patches, misc_prefab includes.
import fs from 'node:fs'
import path from 'node:path'
import { anglesToMatrix, applyMatrix } from './math.js'

export function parseMap(text) {
  const lines = text.split(/\r?\n/)
  const entities = []
  let i = 0
  const peek = () => (i < lines.length ? lines[i].trim() : null)
  const next = () => lines[i++].trim()
  const skipJunk = () => { while (i < lines.length && (peek() === '' || peek().startsWith('//'))) i++ }

  while (i < lines.length) {
    skipJunk()
    if (i >= lines.length) break
    if (peek() !== '{') { i++; continue }
    next()
    const ent = { keys: {}, brushes: [], patches: [] }
    for (;;) {
      skipJunk()
      const line = next()
      if (line === '}') break
      if (line.startsWith('"')) {
        const m = line.match(/^"([^"]*)"\s*"([^"]*)"/)
        if (m) ent.keys[m[1]] = m[2]
      } else if (line === '{') {
        parseBrushBlock(ent)
      }
    }
    ent.classname = ent.keys.classname || ''
    entities.push(ent)
  }
  return { entities }

  function parseBrushBlock(ent) {
    const sides = []
    for (;;) {
      skipJunk()
      const line = next()
      if (line === '}') break
      if (line.startsWith('(')) {
        const side = parseSide(line)
        if (side) sides.push(side)
      } else if (line === 'mesh' || line === 'curve') {
        ent.patches.push(parsePatch(line))
      }
    }
    if (sides.length >= 4) ent.brushes.push({ sides })
  }

  function parseSide(line) {
    const m = line.match(/^\(\s*(\S+)\s+(\S+)\s+(\S+)\s*\)\s*\(\s*(\S+)\s+(\S+)\s+(\S+)\s*\)\s*\(\s*(\S+)\s+(\S+)\s+(\S+)\s*\)\s*(.*)$/)
    if (!m) return null
    const p = [1, 4, 7].map((k) => [+m[k], +m[k + 1], +m[k + 2]])
    const rest = m[10].split(/\s+/)
    return { points: p, material: rest[0], sizeU: +rest[1] || 256, sizeV: +rest[2] || 256, offU: +rest[3] || 0, offV: +rest[4] || 0, rot: +rest[5] || 0 }
  }

  function parsePatch(kind) {
    skipJunk(); next() // {
    const patch = { kind, material: '', w: 0, h: 0, rows: [] }
    for (;;) {
      skipJunk()
      const line = next()
      if (line === '}') break
      if (line === '(') {
        const row = []
        for (;;) {
          skipJunk()
          const l = next()
          if (l === ')') break
          const t = l.split(/\s+/)
          if (t[0] !== 'v') continue
          const pos = [+t[1], +t[2], +t[3]]
          const ti = t.indexOf('t')
          const uv = ti >= 0 ? [+t[ti + 1] / 1024, +t[ti + 2] / 1024] : [0, 0]
          row.push({ pos, uv })
        }
        patch.rows.push(row)
      } else if (line.endsWith(';') || line.startsWith('lightmap_')) {
        continue
      } else if (/^\d+\s+\d+/.test(line)) {
        const d = line.split(/\s+/)
        patch.w = +d[0]; patch.h = +d[1]
      } else if (!patch.material) {
        patch.material = line
      }
    }
    return patch
  }
}

// Loads a .map and expands misc_prefab entities. Prefab paths are resolved against prefabRoots.
export function loadMap(file, { prefabRoots = [] } = {}) {
  const roots = [...prefabRoots, path.dirname(file), path.resolve(path.dirname(file), '..'), path.resolve(path.dirname(file), '../..')]
  const missing = new Set()
  const map = parseMap(fs.readFileSync(file, 'latin1'))
  map.entities = expandPrefabs(map.entities, roots, missing, 0)
  map.missingPrefabs = [...missing]
  return map
}

function expandPrefabs(entities, roots, missing, depth) {
  const out = []
  for (const ent of entities) {
    if (ent.classname !== 'misc_prefab' || depth > 8) { out.push(ent); continue }
    const rel = ent.keys.model || ''
    const file = roots.map((r) => path.join(r, rel)).find((p) => fs.existsSync(p))
    if (!file) { missing.add(rel); out.push(ent); continue }
    const sub = parseMap(fs.readFileSync(file, 'latin1'))
    const m = anglesToMatrix(parseVec(ent.keys.angles))
    const origin = parseVec(ent.keys.origin)
    const xf = (v) => applyMatrix(m, v, origin)
    for (const se of expandPrefabs(sub.entities, roots, missing, depth + 1)) {
      const copy = { keys: { ...se.keys }, classname: se.classname, brushes: [], patches: [], prefab: rel }
      for (const b of se.brushes) copy.brushes.push({ sides: b.sides.map((s) => ({ ...s, points: s.points.map(xf) })) })
      for (const p of se.patches) copy.patches.push({ ...p, rows: p.rows.map((row) => row.map((pt) => ({ ...pt, pos: xf(pt.pos) }))) })
      if (copy.keys.origin) copy.keys.origin = xf(parseVec(copy.keys.origin)).map(fmt).join(' ')
      else if (se.classname !== 'worldspawn' && copy.brushes.length === 0 && copy.patches.length === 0) copy.keys.origin = origin.map(fmt).join(' ')
      if (copy.keys.angles || ent.keys.angles) {
        const a = parseVec(copy.keys.angles)
        a[1] += parseVec(ent.keys.angles)[1]
        copy.keys.angles = a.map(fmt).join(' ')
      }
      if (se.classname === 'worldspawn') {
        copy.classname = 'func_group'
        copy.keys = { classname: 'func_group', prefab: rel }
      }
      out.push(copy)
    }
  }
  return out
}

export function parseVec(s) {
  if (!s) return [0, 0, 0]
  const v = String(s).trim().split(/\s+/).map(Number)
  return [v[0] || 0, v[1] || 0, v[2] || 0]
}

const fmt = (n) => (Math.abs(n - Math.round(n)) < 1e-6 ? String(Math.round(n)) : n.toFixed(3))
