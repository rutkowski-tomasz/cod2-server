// Turns a compiled CoD2 map into what the page draws: entities, surfaces grouped by material and lightmap, lightmaps.
import { readBsp as readCompiled } from '../shared/bsp.js'
import { MeshBuilder } from './brush.js'
import { planePolygons } from '../shared/planes.js'

// Collision faces have no texture mapping; their texture repeats every this many units.
const COLLISION_TILE = 64

export function readBsp(buf) {
  const { entities, models, vertex, lightmaps } = readCompiled(buf)
  // Brush model *n belongs to the entity whose model key names it; model 0 is the world.
  const modelEntity = new Map([[0, 0]])
  entities.forEach((e, i) => {
    const m = /^\*(\d+)$/.exec(e.keys.model || '')
    if (m) modelEntity.set(+m[1], i)
  })

  const surfaces = []
  models.forEach((model, mi) => {
    const groups = new Map()
    for (const soup of model.soups) {
      const key = `${soup.material}/${soup.lightmap}`
      if (!groups.has(key)) groups.set(key, { material: soup.material, lightmap: soup.lightmap, remap: new Map(), positions: [], normals: [], colors: [], uvs: [], lmuvs: [], tangents: [], binormals: [], indices: [] })
      const g = groups.get(key)
      for (const v of soup.triangles.flat()) {
        if (!g.remap.has(v)) {
          g.remap.set(v, g.remap.size)
          const { position, normal, color, uv, lmuv, tangent, binormal } = vertex(v)
          g.positions.push(...position); g.normals.push(...normal); g.colors.push(...color); g.uvs.push(...uv); g.lmuvs.push(...lmuv)
          g.tangents.push(...tangent); g.binormals.push(...binormal)
        }
        g.indices.push(g.remap.get(v))
      }
    }
    for (const { remap, ...g } of groups.values()) surfaces.push({ entity: modelEntity.get(mi) ?? 0, ...g })
  })
  const drawn = new Set(models.flatMap((m) => m.soups.map((s) => s.material)))
  surfaces.push(...collisionSurfaces(models, modelEntity, drawn))
  return { entities, surfaces, lightmaps }
}

// Faces of collision brushes whose material no draw surface uses: clip, caulk, mantle, ladder and the like.
function collisionSurfaces(models, modelEntity, drawn) {
  const surfaces = []
  models.forEach((model, mi) => {
    const builder = new MeshBuilder()
    for (const sides of model.brushes) {
      const planes = sides.map(({ normal, dist, material }) => ({ n: normal, d: dist, side: { material, collision: !drawn.has(material), offU: 0, offV: 0, sizeU: COLLISION_TILE, sizeV: COLLISION_TILE } }))
      builder.addPolygons(planePolygons(planes).filter((poly) => poly.side.collision))
    }
    for (const g of builder.result()) surfaces.push({ entity: modelEntity.get(mi) ?? 0, collision: true, ...g })
  })
  return surfaces
}
