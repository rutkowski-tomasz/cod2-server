// Runs in the browser: loads a glTF, GLB or FBX with three.js and returns its meshes and materials as plain data,
// in three.js axes (Y up) and the file's units.
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { TGALoader } from 'three/addons/loaders/TGALoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js'
import { mergeVertices, deinterleaveGeometry } from 'three/addons/utils/BufferGeometryUtils.js'
import { bakeMaterial, loadedMap } from './bake.js'

// `metresPerUnit` is 1 for glTF; an FBX file gives its unit in centimetres.
// `keep`: the share of each mesh's triangles to keep, simplifying it; 1 keeps the mesh as it is.
window.loadModel = async (url, dracoPath, textureSize, keep) => {
  const fbx = /\.fbx$/i.test(url)
  // FBXLoader returns before its textures have loaded; the manager tells when every file has.
  const manager = new THREE.LoadingManager()
  manager.addHandler(/\.tga$/i, new TGALoader(manager))
  const allLoaded = new Promise((resolve) => (manager.onLoad = resolve))
  const loaded = fbx ? await new FBXLoader(manager).loadAsync(url) : await gltfLoader(manager, dracoPath).loadAsync(url)
  await allLoaded
  await MeshoptSimplifier.ready
  const root = fbx ? loaded : loaded.scene
  root.updateMatrixWorld(true)
  const materials = []
  const meshes = []
  root.traverseVisible((o) => {
    if (o.isInstancedMesh) throw new Error(`instanced mesh ${o.name} is not supported`)
    if (o.isMesh) meshes.push(readMesh(o, materials, keep))
  })
  return { meshes, materials: materials.map((m) => readMaterial(m, textureSize)), metresPerUnit: fbx ? (root.userData.unitScaleFactor ?? 1) / 100 : 1 }
}

function gltfLoader(manager, dracoPath) {
  return new GLTFLoader(manager).setDRACOLoader(new DRACOLoader(manager).setDecoderPath(dracoPath)).setMeshoptDecoder(MeshoptDecoder)
}

// Positions and normals in world space. Each triangle is three vertex indices and a material index, wound
// counter-clockwise seen from outside; `uvs` has each corner's, in its material's image with v growing down.
function readMesh(mesh, materials, keep) {
  let source = mesh.geometry.clone()
  deinterleaveGeometry(source)
  // Without normals, glTF wants flat ones.
  if (!source.attributes.normal) {
    if (source.index) source = source.toNonIndexed()
    source.computeVertexNormals()
  }
  // FBXLoader gives each triangle its own vertices, which would split a mesh into many small surfaces.
  const g = mergeVertices(source)
  const meshMaterials = [mesh.material].flat()
  // three.js draws groups only for a mesh with several materials, and skips those without one.
  let groups = Array.isArray(mesh.material) && g.groups.length ? g.groups.filter((group) => meshMaterials[group.materialIndex]) : [{ start: 0, count: g.index.count, materialIndex: 0 }]
  if (keep < 1) groups = simplify(g, groups, keep)
  const { position, normal, color } = g.attributes
  const v = new THREE.Vector3()
  const normalMatrix = new THREE.Matrix3()
  const positions = []
  const normals = []
  for (let i = 0; i < position.count; i++) {
    const matrix = vertexMatrix(mesh, g, i)
    positions.push(...v.fromBufferAttribute(position, i).applyMatrix4(matrix).toArray())
    normals.push(...v.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix.getNormalMatrix(matrix)).normalize().toArray())
  }
  const colors = []
  const c = new THREE.Color()
  for (let i = 0; color && i < color.count; i++) colors.push(...c.fromBufferAttribute(color, i).convertLinearToSRGB().toArray(), color.itemSize === 4 ? color.getW(i) : 1)

  const slot = (m) => (materials.includes(m) ? materials.indexOf(m) : materials.push(m) - 1)
  // A mirroring transform turns the winding around.
  const mirrored = mesh.matrixWorld.determinant() < 0
  const triangles = []
  const uvs = []
  for (const group of groups) {
    const material = meshMaterials[group.materialIndex]
    const uvOf = imageUv(g, material)
    for (let i = group.start; i + 2 < group.start + group.count; i += 3) {
      const corners = [g.index.getX(i), g.index.getX(i + 1), g.index.getX(i + 2)]
      if (mirrored) corners.reverse()
      triangles.push(...corners, slot(material))
      for (const v of corners) uvs.push(...uvOf(v))
    }
  }
  return { name: mesh.name, positions, normals, uvs, colors, triangles }
}

// Collapses edges until `keep` of each group's triangles are left, at least one, however far the shape moves; the
// normals weigh in. UV seams, hard edges and open borders keep their outline, and vertices that groups share stay
// put, so materials do not crack apart. Returns the groups over the new index.
function simplify(g, groups, keep) {
  const read = (attribute) => {
    const out = new Float32Array(attribute.count * 3)
    const v = new THREE.Vector3()
    for (let i = 0; i < attribute.count; i++) v.fromBufferAttribute(attribute, i).toArray(out, i * 3)
    return out
  }
  const positions = read(g.attributes.position)
  const normals = read(g.attributes.normal)
  const owner = new Int32Array(g.attributes.position.count).fill(-1)
  const locked = new Uint8Array(g.attributes.position.count)
  groups.forEach((group, k) => {
    for (let i = group.start; i < group.start + group.count; i++) {
      const v = g.index.getX(i)
      if (owner[v] >= 0 && owner[v] !== k) locked[v] = 1
      owner[v] = k
    }
  })
  const index = []
  const kept = []
  for (const group of groups) {
    const indices = new Uint32Array(g.index.array.slice(group.start, group.start + group.count - (group.count % 3)))
    const target = Math.min(indices.length, Math.max(3, Math.floor((indices.length * keep) / 3) * 3))
    const [simplified] = MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, normals, 3, [1, 1, 1], locked, target, 1)
    kept.push({ start: index.length, count: simplified.length, materialIndex: group.materialIndex })
    for (const i of simplified) index.push(i)
  }
  g.setIndex(index)
  return kept
}

// A vertex's place in the material's image: from the UV set its map reads, through the map's transform.
function imageUv(g, material) {
  const texture = loadedMap(material, 'map') ?? loadedMap(material, 'alphaMap')
  const uv = g.attributes[texture?.channel ? `uv${texture.channel}` : 'uv']
  if (!uv) return () => [0, 0]
  if (texture?.matrixAutoUpdate) texture.updateMatrix()
  const v = new THREE.Vector2()
  return (i) => {
    v.fromBufferAttribute(uv, i)
    if (!texture) return v.toArray()
    v.applyMatrix3(texture.matrix)
    return [v.x, texture.flipY ? 1 - v.y : v.y]
  }
}

// From the vertex to world space, posed as three.js draws it: a skinned vertex follows its bones.
const blended = new THREE.Matrix4()
const boneMatrix = new THREE.Matrix4()
function vertexMatrix(mesh, g, i) {
  if (!mesh.isSkinnedMesh) return mesh.matrixWorld
  const { skinIndex, skinWeight } = g.attributes
  const { bones, boneInverses } = mesh.skeleton
  blended.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
  for (let k = 0; k < 4; k++) {
    const w = skinWeight.getComponent(i, k)
    if (!w) continue
    const b = skinIndex.getComponent(i, k)
    boneMatrix.multiplyMatrices(bones[b].matrixWorld, boneInverses[b])
    blended.elements.forEach((e, j) => (blended.elements[j] = e + boneMatrix.elements[j] * w))
  }
  return blended.clone().premultiply(mesh.bindMatrixInverse).premultiply(mesh.matrixWorld).multiply(mesh.bindMatrix)
}

// `pixels`: the material baked into one image (see bakeMaterial). `alpha`: opaque, mask (cut out at half) or blend.
function readMaterial(m, textureSize) {
  const { r, g, b } = m.color ? m.color.getRGB({}, THREE.SRGBColorSpace) : { r: 1, g: 1, b: 1 }
  const alpha = m.alphaTest > 0 ? 'mask' : m.transparent ? 'blend' : 'opaque'
  const pixels = bakeMaterial(m, [r, g, b], alpha !== 'opaque', textureSize)
  return { name: m.name, pixels, alpha, doubleSided: m.side === THREE.DoubleSide }
}
