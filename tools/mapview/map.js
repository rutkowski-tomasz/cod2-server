// Reads CoD2 Radiant .map files (iwmap 4) into entities and surfaces: brushes, mesh/curve patches, misc_prefab includes.
import fs from 'node:fs'
import path from 'node:path'
import { anglesToMatrix, applyMatrix, parseVec } from './math.js'
import { MeshBuilder } from './brush.js'

const MAX_PREFAB_DEPTH = 8

// Prefab paths resolve against prefabRoots, then next to the map and one and two folders up.
export function readMap(file, prefabRoots) {
  const roots = [...prefabRoots, path.dirname(file), path.resolve(path.dirname(file), '..'), path.resolve(path.dirname(file), '../..')]
  const missing = new Set()
  const entities = expandPrefabs(parseMap(fs.readFileSync(file, 'latin1')), roots, missing, 0)
  const builders = new Map()
  entities.forEach((e, index) => {
    if (!e.brushes.length && !e.patches.length) return
    // Prefab contents (func_group) render as part of the world.
    const owner = e.classname === 'func_group' ? 0 : index
    if (!builders.has(owner)) builders.set(owner, new MeshBuilder())
    for (const b of e.brushes) builders.get(owner).addBrush(b)
    for (const p of e.patches) builders.get(owner).addPatch(p)
  })
  const surfaces = [...builders].flatMap(([entity, mb]) => mb.result().map((g) => ({ entity, ...g })))
  return { entities: entities.map(({ classname, keys }) => ({ classname, keys })), surfaces, missingPrefabs: [...missing] }
}

function parseMap(text) {
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
  return entities

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
    const patch = { kind, material: '', rows: [] }
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
        continue
      } else if (!patch.material) {
        patch.material = line
      }
    }
    return patch
  }
}

function expandPrefabs(entities, roots, missing, depth) {
  const out = []
  for (const ent of entities) {
    if (ent.classname !== 'misc_prefab' || depth > MAX_PREFAB_DEPTH) { out.push(ent); continue }
    const rel = ent.keys.model || ''
    const file = roots.map((r) => path.join(r, rel)).find((p) => fs.existsSync(p))
    if (!file) { missing.add(rel); out.push(ent); continue }
    const sub = parseMap(fs.readFileSync(file, 'latin1'))
    const m = anglesToMatrix(parseVec(ent.keys.angles))
    const origin = parseVec(ent.keys.origin)
    const xf = (v) => applyMatrix(m, v, origin)
    for (const se of expandPrefabs(sub, roots, missing, depth + 1)) {
      const copy = { keys: { ...se.keys }, classname: se.classname, brushes: [], patches: [] }
      for (const b of se.brushes) copy.brushes.push({ sides: b.sides.map((s) => ({ ...s, points: s.points.map(xf) })) })
      for (const p of se.patches) copy.patches.push({ ...p, rows: p.rows.map((row) => row.map((pt) => ({ ...pt, pos: xf(pt.pos) }))) })
      if (copy.keys.origin) copy.keys.origin = xf(parseVec(copy.keys.origin)).map(formatNumber).join(' ')
      else if (se.classname !== 'worldspawn' && copy.brushes.length === 0 && copy.patches.length === 0) copy.keys.origin = origin.map(formatNumber).join(' ')
      if (copy.keys.angles || copy.keys.angle || ent.keys.angles) {
        const a = copy.keys.angles ? parseVec(copy.keys.angles) : [0, +(copy.keys.angle || 0), 0]
        a[1] += parseVec(ent.keys.angles)[1]
        copy.keys.angles = a.map(formatNumber).join(' ')
        delete copy.keys.angle
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

const formatNumber = (n) => (Math.abs(n - Math.round(n)) < 1e-6 ? String(Math.round(n)) : n.toFixed(3))
