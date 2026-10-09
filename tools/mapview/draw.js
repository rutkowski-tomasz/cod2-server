// The map in three.js: surfaces with their materials, textures and lightmaps, lights, sky and grid.
// THREE comes from the page script, which imports it before this module runs.
import { anglesToForward, parseVec } from './math.js'
import { buildModels } from './models.js'
import { BLEND, LIGHTMAP_SHADER, blendOf, replaceFogChunks } from './shader.js'

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
// Decals and blended layers lie on another surface, so they are drawn pulled toward the camera.
const PULL_FORWARD = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }

// `onChange` is called when a texture arrives, so the page draws again.
export function createWorld(map, renderer, scene, onChange) {
  replaceFogChunks()
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
  const fog = buildFog()
  let pending = 0

  // Triggers and tool brushes are translucent, so they stay out of `occluders`, which hide labels behind them.
  const occluders = new THREE.Group()
  const triggers = new THREE.Group()
  const tools = new THREE.Group()
  for (const [order, s] of map.surfaces.entries()) {
    const info = map.materials[s.material]
    if (info.sky) continue
    if (/^trigger/.test(map.entities[s.entity].classname)) {
      triggers.add(buildMesh(s, new THREE.MeshBasicMaterial({ color: TRIGGER_COLOR, transparent: true, opacity: 0.25, depthWrite: false, fog: false })))
      continue
    }
    const tool = info.tool || !!s.collision
    const mesh = buildMesh(s, materialFor(info, { lightmap: s.lightmap, doubleSided: s.doubleSided, tool }))
    // A compiled map's translucent surfaces draw in its surface order, like the game, so layers on one surface
    // stack right. A .map has no such order and the game never draws tools, so those sort by distance.
    if (lit && mesh.material.transparent && !tool) mesh.renderOrder = order
    if (tool) tools.add(mesh)
    else occluders.add(mesh)
  }
  // Models stay out of `occluders` too: their own labels sit inside them.
  const models = buildModels(map, buildGeometry, (info) => materialFor(info, { doubleSided: true, sunShade: true }))
  scene.add(occluders, triggers, tools, models)
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
      scene.fog = state.fog && !state.top ? fog : null
      grid.visible = state.grid || state.top
      triggers.visible = state.entities
    },
  }

  function buildMesh(s, material) {
    const ent = map.entities[s.entity]
    const mesh = new THREE.Mesh(buildGeometry(s), material)
    mesh.castShadow = mesh.receiveShadow = !material.transparent
    // Brush model vertices in a .d3dbsp are relative to their entity's origin.
    if (ent.origin && ent.index > 0 && map.kind === 'bsp') mesh.position.copy(toThree(...ent.origin))
    return mesh
  }

  function buildGeometry(s) {
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
    return geom
  }

  // `sunShade` lights a surface without a lightmap, a model, by the sun.
  function materialFor(info, { lightmap = -1, doubleSided = false, tool = false, sunShade = false }) {
    const key = `${info.name}/${lit ? lightmap : -1}/${doubleSided}/${tool}/${sunShade}`
    if (!materials.has(key)) {
      const mat = makeMaterial(info, lightmap, tool, sunShade)
      if (doubleSided) mat.side = THREE.DoubleSide
      materials.set(key, mat)
    }
    return materials.get(key)
  }

  function makeMaterial(info, lightmap, tool, sunShade) {
    if (/water/.test(info.techset ?? '') || /^water/.test(info.name)) return new THREE.MeshBasicMaterial({ color: WATER_COLOR, transparent: true, opacity: 0.55, depthWrite: false })
    const baseColor = hashColor(info.name)
    // Tool brushes have their own fixed opacity.
    const blend = tool ? BLEND.opaque : blendOf(info.techset)
    let mat
    if (!lit) mat = new THREE.MeshLambertMaterial({ color: baseColor })
    // A compiled map has no three.js lights, and its collision brushes no lightmap, so tool brushes there draw unlit.
    else if (tool) {
      mat = new THREE.MeshBasicMaterial({ color: baseColor })
      // Lit maps load textures raw, as the lightmap shader wants them, so skip three.js's sRGB encode here too.
      mat.onBeforeCompile = (shader) => { shader.fragmentShader = shader.fragmentShader.replace('#include <colorspace_fragment>', '') }
    }
    else mat = lightmapMaterial(baseColor, blend)
    mat.userData = { info, baseColor, blend, sunShade, tool }
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
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        lmR: { value: null }, lmG: { value: null }, lmB: { value: null }, lmSun: { value: null },
        useLm: { value: 0 }, sunShade: { value: 0 }, sunDir: { value: sunDir }, sunColor: { value: sunColor.clone().multiplyScalar(sunlight) },
        blend: { value: blend },
      },
    })
  }

  // Water has no info: it looks the same whatever the view options.
  function refresh(mat) {
    const { info, texture, lightmaps, baseColor, blend, sunShade, tool } = mat.userData
    if (!info) return
    const colorMap = view.textures && texture ? texture : null
    // Tool images are a faint translucent colour, red for clip, as Radiant shows them; an alpha test would discard it.
    const alphaTest = colorMap && !tool && map.images[info.image].alpha && blend === BLEND.opaque ? ALPHA_TEST : 0
    if (mat.isShaderMaterial) {
      const u = mat.uniforms
      u.map.value = colorMap
      u.hasMap.value = colorMap ? 1 : 0
      u.alphaTest.value = alphaTest
      const useLm = view.lightmap && lightmaps
      u.useLm.value = useLm ? 1 : 0
      if (useLm) [u.lmR.value, u.lmG.value, u.lmB.value, u.lmSun.value] = lightmaps
      // With the lightmap off the world draws full-bright, so sun-shaded models do too.
      u.sunShade.value = sunShade && view.lightmap ? 1 : 0
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

  // The script's fog. Its colour is used raw: the game blends fog in gamma space, and three.js mixes it in after
  // the colour space conversion.
  function buildFog() {
    if (!map.fog) return null
    const color = new THREE.Color(...map.fog.color)
    return map.fog.kind === 'exp' ? new THREE.FogExp2(color, map.fog.density) : new THREE.Fog(color, map.fog.near, map.fog.far)
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

// Untextured surfaces get a stable colour per material name.
function hashColor(name) {
  let h = 2166136261
  for (const c of name) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return new THREE.Color().setHSL(((h >>> 0) % 360) / 360, 0.35, 0.55)
}
