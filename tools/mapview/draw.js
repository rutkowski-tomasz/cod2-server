// The map in three.js: surfaces with their materials, textures and lightmaps, lights, sky and grid.
// THREE comes from the page script, which imports it before this module runs.
import { anglesToForward, parseVec } from './math.js'

// CoD2 is Z-up; three.js is Y-up. World coordinates convert as (x, y, z) -> (x, z, -y).
export const toThree = (x, y, z) => new THREE.Vector3(x, z, -y)
export const fromThree = (v) => [v.x, -v.z, v.y]

const SKY_COLOR = 0x5b7d9e
const TOP_COLOR = 0x101418
const WATER_COLOR = 0x3b6e8f
const TRIGGER_COLOR = 0xff9f1c
const ALPHA_TEST = 0.4
const MAX_POINT_LIGHTS = 64
const GRID_STEP = 256
// How a surface's techset combines it with what is behind it; the shader's `blend` uniform.
const BLEND = { opaque: 0, alpha: 1, multiply: 2, add: 3 }
// Decals and blended layers lie on another surface, so they are drawn pulled toward the camera.
const PULL_FORWARD = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }

const LIGHTMAP_SHADER = {
  vertexShader: `attribute vec2 uv1; attribute vec4 rgba;
varying vec2 vUv; varying vec2 vLm; varying vec3 vNormal; varying vec4 vColor;
void main() {
  vUv = uv; vLm = uv1; vColor = rgba;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
  // Mirrors the game's lmap shader: lightmap = indirect light (four coefficients per channel, weighted
  // for a flat normal), plus sun colour scaled by the sun-visibility page and N·L. Vertex colour tints
  // the texel; its alpha fades blended layers. Multiply layers are unlit, like the game's effect_multiply.
  fragmentShader: `uniform sampler2D map; uniform int hasMap; uniform vec3 color; uniform float alphaTest;
uniform sampler2D lmR; uniform sampler2D lmG; uniform sampler2D lmB; uniform sampler2D lmSun;
uniform int useLm; uniform vec3 sunDir; uniform vec3 sunColor; uniform int blend;
varying vec2 vUv; varying vec2 vLm; varying vec3 vNormal; varying vec4 vColor;
void main() {
  vec4 t = hasMap == 1 ? texture2D(map, vUv) : vec4(color, 1.0);
  if (t.a < alphaTest) discard;
  vec4 d = t * vColor;
  if (blend == ${BLEND.multiply}) { gl_FragColor = vec4(mix(vec3(1.0), d.rgb, d.a), 1.0); return; }
  vec3 light = vec3(1.0);
  if (useLm == 1) {
    vec4 w = vec4(0.25);
    vec3 lm = vec3(dot(texture2D(lmR, vLm), w), dot(texture2D(lmG, vLm), w), dot(texture2D(lmB, vLm), w));
    float sunVis = texture2D(lmSun, vLm).r;
    light = lm + sunVis * max(0.0, dot(normalize(vNormal), sunDir)) * sunColor;
  }
  gl_FragColor = vec4(d.rgb * light, blend == ${BLEND.opaque} ? 1.0 : d.a);
}`,
}

// `onChange` is called when a texture arrives, so the page draws again.
export function createWorld(map, renderer, scene, onChange) {
  // Compiled maps carry their light in lightmaps; a .map is lit by three.js lights.
  const lit = map.lightmapCount > 0
  const ws = map.worldspawn
  const wsVec = (k, d) => (ws[k] ? parseVec(ws[k]) : d)
  // sundirection is a CoD angle vector pointing at the sun.
  const sunDir = toThree(...anglesToForward(wsVec('sundirection', [-50, 40, 0]))).normalize()
  const sunlight = +(ws.sunlight || 1.2)
  const sunColor = new THREE.Color(...wsVec('suncolor', [1, 1, 1]))
  const materials = new Map()
  const textures = new Map()
  const view = { textures: true, lightmap: true }
  let pending = 0

  // Triggers and tool brushes are translucent, so they stay out of `occluders`, which hide labels behind them.
  const occluders = new THREE.Group()
  const triggers = new THREE.Group()
  const tools = new THREE.Group()
  for (const [order, s] of map.surfaces.entries()) {
    const info = map.materials[s.material]
    if (info.sky) continue
    if (/^trigger/.test(map.entities[s.entity].classname)) {
      triggers.add(buildMesh(s, new THREE.MeshBasicMaterial({ color: TRIGGER_COLOR, transparent: true, opacity: 0.25, depthWrite: false })))
      continue
    }
    const tool = info.tool || !!s.collision
    const mesh = buildMesh(s, materialFor(info, s.lightmap, s.doubleSided, tool))
    // A compiled map's translucent surfaces draw in its surface order, like the game, so layers on one surface
    // stack right. A .map has no such order and the game never draws tools, so those sort by distance.
    if (lit && mesh.material.transparent && !tool) mesh.renderOrder = order
    if (tool) tools.add(mesh)
    else occluders.add(mesh)
  }
  scene.add(occluders, triggers, tools)
  const sun = lit ? null : addLights()
  const grid = buildGrid()
  const sky = buildSky()

  return {
    occluders,
    loading: () => pending > 0,
    setView(state) {
      view.textures = state.textures
      view.lightmap = state.lightmap
      tools.visible = state.tools
      for (const mat of materials.values()) refresh(mat)
      const shadows = state.shadows && !state.top
      renderer.shadowMap.enabled = shadows
      if (sun) sun.castShadow = shadows
      renderer.clippingPlanes = state.cut == null ? [] : [new THREE.Plane(new THREE.Vector3(0, -1, 0), state.cut)]
      if (sky) sky.visible = !state.top && state.cut == null
      scene.background = new THREE.Color(state.top ? TOP_COLOR : SKY_COLOR)
      grid.visible = state.grid || state.top
      triggers.visible = state.entities
    },
  }

  function buildMesh(s, material) {
    const geom = new THREE.BufferGeometry()
    const pos = map.f32(s.positions), nor = map.f32(s.normals)
    const p3 = new Float32Array(pos.length), n3 = new Float32Array(nor.length)
    for (let i = 0; i < pos.length; i += 3) {
      p3[i] = pos[i]; p3[i + 1] = pos[i + 2]; p3[i + 2] = -pos[i + 1]
      n3[i] = nor[i]; n3[i + 1] = nor[i + 2]; n3[i + 2] = -nor[i + 1]
    }
    geom.setAttribute('position', new THREE.BufferAttribute(p3, 3))
    geom.setAttribute('normal', new THREE.BufferAttribute(n3, 3))
    geom.setAttribute('uv', new THREE.BufferAttribute(map.f32(s.uvs), 2))
    if (s.lmuvs) geom.setAttribute('uv1', new THREE.BufferAttribute(map.f32(s.lmuvs), 2))
    if (s.colors) geom.setAttribute('rgba', new THREE.BufferAttribute(map.u8(s.colors), 4, true))
    geom.setIndex(new THREE.BufferAttribute(map.u32(s.indices), 1))
    const ent = map.entities[s.entity]
    const mesh = new THREE.Mesh(geom, material)
    mesh.castShadow = mesh.receiveShadow = !material.transparent
    // Brush model vertices in a .d3dbsp are relative to their entity's origin.
    if (ent.origin && ent.index > 0 && map.kind === 'bsp') mesh.position.copy(toThree(...ent.origin))
    return mesh
  }

  function materialFor(info, lightmap, doubleSided, tool) {
    const key = `${info.name}/${lit ? lightmap : -1}/${!!doubleSided}/${tool}`
    if (!materials.has(key)) {
      const mat = makeMaterial(info, lightmap, tool)
      if (doubleSided) mat.side = THREE.DoubleSide
      materials.set(key, mat)
    }
    return materials.get(key)
  }

  function makeMaterial(info, lightmap, tool) {
    if (/water/.test(info.techset ?? '') || /^water/.test(info.name)) return new THREE.MeshBasicMaterial({ color: WATER_COLOR, transparent: true, opacity: 0.55, depthWrite: false })
    const baseColor = hashColor(info.name)
    // Only the lightmap shader blends by techset; a .map and tool brushes draw every material opaque.
    const blend = lit && !tool ? blendOf(info.techset) : BLEND.opaque
    let mat
    if (!lit) mat = new THREE.MeshLambertMaterial({ color: baseColor })
    // A compiled map has no three.js lights, and its collision brushes no lightmap, so tool brushes there draw unlit.
    else if (tool) {
      mat = new THREE.MeshBasicMaterial({ color: baseColor })
      // Lit maps load textures raw, as the lightmap shader wants them, so skip three.js's sRGB encode here too.
      mat.onBeforeCompile = (shader) => { shader.fragmentShader = shader.fragmentShader.replace('#include <colorspace_fragment>', '') }
    }
    else mat = lightmapMaterial(baseColor, blend)
    mat.userData = { info, baseColor, blend }
    if (blend !== BLEND.opaque) {
      Object.assign(mat, { transparent: true, depthWrite: false, ...PULL_FORWARD })
      if (blend === BLEND.add) mat.blending = THREE.AdditiveBlending
      if (blend === BLEND.multiply) Object.assign(mat, { blending: THREE.CustomBlending, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor })
    }
    if (tool) Object.assign(mat, { transparent: true, opacity: 0.35, depthWrite: false })
    if (/decal/.test(info.name) || /decal/.test(info.techset ?? '')) Object.assign(mat, PULL_FORWARD)
    const image = map.images[info.image]
    if (image) {
      loadTexture(info.image, image.png, (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping
        // The game multiplies in gamma space; only the three.js-lit .map path uses its linear pipeline.
        tex.colorSpace = lit ? THREE.NoColorSpace : THREE.SRGBColorSpace
        tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
      }).then((tex) => { mat.userData.texture = tex; refresh(mat) })
    }
    if (lit && lightmap >= 0) {
      Promise.all(map.lightmaps[lightmap].map((src, page) => loadTexture(`lightmap ${lightmap}/${page}`, src, (tex) => {
        tex.colorSpace = THREE.NoColorSpace
        tex.generateMipmaps = false
        tex.minFilter = THREE.LinearFilter
      }))).then((pages) => { mat.userData.lightmaps = pages; refresh(mat) })
    }
    return mat
  }

  function lightmapMaterial(baseColor, blend) {
    return new THREE.ShaderMaterial({
      ...LIGHTMAP_SHADER,
      uniforms: {
        map: { value: null }, hasMap: { value: 0 }, color: { value: baseColor }, alphaTest: { value: 0 },
        lmR: { value: null }, lmG: { value: null }, lmB: { value: null }, lmSun: { value: null },
        useLm: { value: 0 }, sunDir: { value: sunDir }, sunColor: { value: sunColor.clone().multiplyScalar(sunlight) },
        blend: { value: blend },
      },
    })
  }

  // Water has no info: it looks the same whatever the view options.
  function refresh(mat) {
    const { info, texture, lightmaps, baseColor, blend } = mat.userData
    if (!info) return
    const colorMap = view.textures && texture ? texture : null
    // three.js tests opacity times texel alpha, so translucent tools need a threshold scaled to match.
    const alphaTest = colorMap && map.images[info.image].alpha && blend === BLEND.opaque ? ALPHA_TEST * mat.opacity : 0
    if (mat.isShaderMaterial) {
      const u = mat.uniforms
      u.map.value = colorMap
      u.hasMap.value = colorMap ? 1 : 0
      u.alphaTest.value = alphaTest
      const useLm = view.lightmap && lightmaps
      u.useLm.value = useLm ? 1 : 0
      if (useLm) [u.lmR.value, u.lmG.value, u.lmB.value, u.lmSun.value] = lightmaps
    } else {
      mat.map = colorMap
      mat.color.copy(colorMap ? new THREE.Color(0xffffff) : baseColor)
      mat.alphaTest = alphaTest
      mat.needsUpdate = true
    }
    onChange()
  }

  function loadTexture(key, src, setup) {
    if (!textures.has(key)) {
      pending++
      textures.set(key, new THREE.TextureLoader().loadAsync(src).then((tex) => {
        tex.flipY = false
        setup(tex)
        pending--
        return tex
      }))
    }
    return textures.get(key)
  }

  // Lights for a .map, from worldspawn, with sun shadows over the whole map.
  function addLights() {
    const b = map.bounds
    const extent = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])
    const center = toThree((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2)
    const sun = new THREE.DirectionalLight(sunColor, sunlight * 1.6)
    sun.target.position.copy(center)
    sun.position.copy(center.clone().add(sunDir.clone().multiplyScalar(extent * 1.5)))
    sun.castShadow = true
    sun.shadow.mapSize.set(4096, 4096)
    const half = extent * 0.75
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: extent * 4 })
    sun.shadow.bias = -0.0005
    sun.shadow.normalBias = 2
    const diffuse = new THREE.Color(...wsVec('sundiffusecolor', [0.8, 0.85, 1]))
    scene.add(
      sun, sun.target,
      new THREE.HemisphereLight(diffuse, diffuse.clone().multiplyScalar(0.35), 0.6 + +(ws.diffusefraction || 0.3)),
      new THREE.AmbientLight(new THREE.Color(...wsVec('_color', [1, 1, 1])), +(ws.ambient || 0.3) * 1.5),
    )
    for (const e of map.entities.filter((e) => e.classname === 'light' && e.origin).slice(0, MAX_POINT_LIGHTS)) {
      const radius = +(e.keys.radius || 300)
      const color = new THREE.Color(...parseVec(e.keys._color ?? '1 1 1'))
      const light = new THREE.PointLight(color, +(e.keys.intensity || 1) * radius * 0.6, radius, 1)
      light.position.copy(toThree(...e.origin))
      scene.add(light)
    }
    return sun
  }

  // A 256-unit grid under the map, for the top view and --grid.
  function buildGrid() {
    const b = map.bounds
    const size = Math.ceil(Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]) / 1024) * 1024 + 2048
    const grid = new THREE.GridHelper(size, size / GRID_STEP, 0x88aaff, 0x3a4a60)
    grid.position.copy(toThree(Math.round((b.min[0] + b.max[0]) / 2 / GRID_STEP) * GRID_STEP, Math.round((b.min[1] + b.max[1]) / 2 / GRID_STEP) * GRID_STEP, b.min[2] - 1))
    scene.add(grid)
    return grid
  }

  function buildSky() {
    if (!map.sky) return null
    pending++
    const cube = new THREE.CubeTextureLoader().load(map.sky, () => { pending--; onChange() })
    cube.colorSpace = THREE.SRGBColorSpace
    // CoD samples the cube in its own Z-up frame, so swizzle the direction back before the lookup.
    const mat = new THREE.ShaderMaterial({
      uniforms: { sky: { value: cube } },
      vertexShader: `varying vec3 vDir;
void main() { vDir = position; gl_Position = projectionMatrix * mat4(mat3(modelViewMatrix)) * vec4(position, 1.0); gl_Position.z = gl_Position.w; }`,
      fragmentShader: `uniform samplerCube sky; varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  gl_FragColor = textureCube(sky, vec3(d.x, -d.z, d.y));
  #include <colorspace_fragment>
}`,
      side: THREE.BackSide, depthWrite: false, depthTest: false,
    })
    const sky = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), mat)
    sky.frustumCulled = false
    sky.renderOrder = -1000
    scene.add(sky)
    return sky
  }
}

function blendOf(techset = '') {
  if (techset.includes('multiply')) return BLEND.multiply
  if (/(^|_)add(_|$)/.test(techset)) return BLEND.add
  if (/(^|_)blend(_|$)/.test(techset)) return BLEND.alpha
  return BLEND.opaque
}

// Untextured surfaces get a stable colour per material name.
function hashColor(name) {
  let h = 2166136261
  for (const c of name) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return new THREE.Color().setHSL(((h >>> 0) % 360) / 360, 0.35, 0.55)
}
