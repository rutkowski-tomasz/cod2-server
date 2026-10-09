const bundle = JSON.parse(document.getElementById('bundle').textContent)
const params = { ...bundle.defaults, ...Object.fromEntries(new URLSearchParams(location.hash.slice(1))) }
let THREE

// CoD2 is Z-up; three.js is Y-up. World coordinates convert as (x, y, z) -> (x, z, -y).
const toThree = (x, y, z) => new THREE.Vector3(x, z, -y)
const fromThree = (v) => [v.x, -v.z, v.y]
const d2r = Math.PI / 180
const EYE_HEIGHT = 60
const PLAYER = { width: 30, height: 72 }

const state = { speed: 400 }
// View params are the command line's view options: "off" turns a default-on option off.
const off = (v) => v === undefined ? false : ['off', '0', 'false', false].includes(v)
const on = (v) => v !== undefined && !off(v)

let renderer, scene, camera, ortho, sceneData, world, markers, labelItems = [], sun, hemi, ambient, skybox, sunInfo
let pending = 0, needRender = true, occlusionDirty = true, lastChange = 0, occlusion = null
const materials = []
const textures = new Map()

init().catch((e) => { window.mapError = e.stack || String(e); status(String(e)) })

async function init() {
  THREE = await import(document.getElementById('three').textContent)
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(1)
  renderer.setSize(innerWidth, innerHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  document.body.appendChild(renderer.domElement)
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x5b7d9e)
  camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 4, 65536)
  ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 131072)
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); needRender = true })

  sceneData = decodeGeometry(bundle)
  document.title = `${sceneData.name} – mapview`
  sunInfo = readSun()
  buildWorld()
  buildLights()
  buildMarkers()
  await buildSky()
  readParams(params)
  applyView()
  setupControls()
  status('')
  renderLoop()
  await whenIdle()
  window.mapReady = true
}

window.mapview = {
  // Resets the view to the page defaults plus `p`, waits for the frame, returns the camera.
  async apply(p) {
    readParams({ ...bundle.defaults, ...p })
    applyView()
    await whenIdle()
    return { pos: state.pos.map(round), angles: state.angles.map(round), fov: state.fov, top: state.top, span: state.span, cut: state.cut }
  },
}

function status(text) { document.getElementById('status').style.display = text ? 'block' : 'none'; document.getElementById('status').textContent = text }

// The geometry arrives as one base64 blob; surfaces hold { offset, count } refs into it.
function decodeGeometry(b) {
  const text = atob(b.geometry)
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
  return { ...b, f32: (ref) => new Float32Array(bytes.buffer, ref.offset, ref.count), u32: (ref) => new Uint32Array(bytes.buffer, ref.offset, ref.count) }
}

function readParams(p) {
  const vec = (v) => (v === undefined ? null : String(v).split(/[ ,]+/).map(Number))
  const pos = vec(p.pos)
  const angles = vec(p.angles)
  if (p.at !== undefined) {
    const e = findEntity(p.at)
    if (!e) throw new Error(`no entity matches "${p.at}"`)
    state.pos = [e.origin[0], e.origin[1], e.origin[2] + EYE_HEIGHT]
    state.angles = e.angles ? [...e.angles] : [0, 0, 0]
  } else if (pos) {
    state.pos = [pos[0] || 0, pos[1] || 0, pos[2] ?? EYE_HEIGHT]
    state.angles = [0, 0, 0]
  } else placeDefault()
  if (angles) state.angles = [angles[0] || 0, angles[1] || 0, angles[2] || 0]
  if (p.look !== undefined) {
    const t = vec(p.look)
    const d = [t[0] - state.pos[0], t[1] - state.pos[1], (t[2] ?? state.pos[2]) - state.pos[2]]
    const yaw = Math.atan2(d[1], d[0]) / d2r
    const pitch = -Math.atan2(d[2], Math.hypot(d[0], d[1])) / d2r
    state.angles = [round(pitch), round(yaw), 0]
  }
  state.fov = +p.fov || 80
  state.top = on(p.top)
  state.span = +p.span || 0
  if (p.center !== undefined) [state.pos[0], state.pos[1]] = vec(p.center)
  state.cut = p.cut === undefined || p.cut === '' ? null : +p.cut
  state.labels = p.labels === 'all' ? 'all' : !off(p.labels)
  state.textures = !off(p.tex)
  state.entities = !off(p.ents)
  state.grid = on(p.grid)
  state.tools = on(p.tools)
  state.lightmap = !off(p.lightmap)
  state.shadows = !off(p.shadows)
  state.hud = !off(p.hud)
}

// First match of a selector: classname, key=value, or #index; an optional [n] picks the n-th match.
function findEntity(sel) {
  const m = /^(.*?)(?:\[(\d+)\])?$/.exec(sel)
  const n = +(m[2] || 0)
  let test
  if (m[1].startsWith('#')) test = (e) => e.index === +m[1].slice(1)
  else if (m[1].includes('=')) { const [k, v] = m[1].split('='); test = (e) => e.keys[k] === v }
  else test = (e) => e.classname === m[1]
  return sceneData.entities.filter((e) => e.origin && test(e))[n] || null
}

function placeDefault() {
  const spawn = sceneData.entities.find((e) => e.origin && /spawn|info_player_start/.test(e.classname))
  if (spawn) {
    state.pos = [spawn.origin[0], spawn.origin[1], spawn.origin[2] + EYE_HEIGHT]
    state.angles = spawn.angles ? [...spawn.angles] : [0, 0, 0]
  } else {
    const b = sceneData.bounds
    state.pos = [(b.min[0] + b.max[0]) / 2, b.min[1] - 256, b.max[2] + 128]
    state.angles = [30, 90, 0]
  }
}

function hashColor(name) {
  let h = 2166136261
  for (const c of name) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return new THREE.Color().setHSL(((h >>> 0) % 360) / 360, 0.35, 0.55)
}

const LIGHTMAP_SHADER = {
  vertexShader: `attribute vec2 uv1;
varying vec2 vUv; varying vec2 vLm; varying vec3 vNormal;
void main() {
  vUv = uv; vLm = uv1;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
  // Mirrors the game's lmap shader: lightmap = indirect light (four coefficients per channel, weighted
  // for a flat normal), plus sun colour scaled by the sun-visibility page and N·L.
  fragmentShader: `uniform sampler2D map; uniform int hasMap; uniform vec3 color; uniform float alphaTest;
uniform sampler2D lmR; uniform sampler2D lmG; uniform sampler2D lmB; uniform sampler2D lmSun;
uniform int useLm; uniform vec3 sunDir; uniform vec3 sunColor; uniform float lmScale;
varying vec2 vUv; varying vec2 vLm; varying vec3 vNormal;
void main() {
  vec4 d = hasMap == 1 ? texture2D(map, vUv) : vec4(color, 1.0);
  if (d.a < alphaTest) discard;
  vec3 light = vec3(1.0);
  if (useLm == 1) {
    vec4 w = vec4(0.25);
    vec3 lm = vec3(dot(texture2D(lmR, vLm), w), dot(texture2D(lmG, vLm), w), dot(texture2D(lmB, vLm), w));
    float sunVis = texture2D(lmSun, vLm).r;
    light = lm * lmScale + sunVis * max(0.0, dot(normalize(vNormal), sunDir)) * sunColor;
  }
  gl_FragColor = vec4(d.rgb * light, 1.0);
}`,
}

function materialFor(index, lightmapIndex) {
  const info = sceneData.materials[index]
  const lightmapped = sceneData.lightmapCount > 0
  const key = `${index}/${lightmapped ? lightmapIndex : -1}`
  let mat = materials[key]
  if (mat) return mat
  const baseColor = hashColor(info.name)
  if (lightmapped) {
    mat = new THREE.ShaderMaterial({
      ...LIGHTMAP_SHADER,
      uniforms: {
        map: { value: null }, hasMap: { value: 0 }, color: { value: baseColor }, alphaTest: { value: 0 },
        lmR: { value: null }, lmG: { value: null }, lmB: { value: null }, lmSun: { value: null },
        useLm: { value: 0 }, sunDir: { value: sunInfo.dir }, sunColor: { value: sunInfo.color }, lmScale: { value: 1 },
      },
    })
    if (lightmapIndex >= 0) Promise.all([0, 1, 2, 3].map((page) => loadLightmap(lightmapIndex, page))).then((pages) => { mat.userData.lightmaps = pages; refreshMaterial(mat) })
  } else {
    mat = new THREE.MeshLambertMaterial({ color: baseColor })
  }
  mat.userData = { info, lightmapIndex, baseColor }
  if (info.tool) { mat.transparent = true; mat.opacity = 0.35; mat.depthWrite = false }
  if (/decal/.test(info.name) || /decal/.test(info.techset || '')) { mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2 }
  if (/water/.test(info.techset || '') || /^water/.test(info.name)) {
    mat = new THREE.MeshLambertMaterial({ color: 0x3b6e8f, transparent: true, opacity: 0.55, depthWrite: false })
    mat.userData = { info, lightmapIndex, baseColor, water: true }
    materials[key] = mat
    return mat
  }
  if (bundle.images[info.image]) loadTexture(info.image).then((tex) => { mat.userData.texture = tex; refreshMaterial(mat) })
  materials[key] = mat
  return mat
}

function refreshMaterial(mat) {
  const { info, texture, lightmaps } = mat.userData
  const map = state.textures && texture ? texture : null
  if (mat.isShaderMaterial) {
    const u = mat.uniforms
    u.map.value = map; u.hasMap.value = map ? 1 : 0
    u.alphaTest.value = map && bundle.images[info.image].alpha ? 0.4 : 0
    const useLm = state.lightmap && lightmaps && lightmaps.every(Boolean)
    u.useLm.value = useLm ? 1 : 0
    if (useLm) { u.lmR.value = lightmaps[0]; u.lmG.value = lightmaps[1]; u.lmB.value = lightmaps[2]; u.lmSun.value = lightmaps[3] }
  } else {
    mat.map = map
    mat.color.copy(map ? new THREE.Color(0xffffff) : mat.userData.baseColor)
    mat.alphaTest = map && bundle.images[info.image].alpha ? 0.4 : 0
    mat.needsUpdate = true
  }
  needRender = true
}

function loadTexture(name) {
  if (textures.has(name)) return textures.get(name)
  const p = new Promise((resolve) => {
    pending++
    new THREE.TextureLoader().load(bundle.images[name].png, (tex) => {
      tex.flipY = false
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      // The game multiplies in gamma space; only the lit (.map) path uses three's linear pipeline.
      tex.colorSpace = sceneData.lightmapCount > 0 ? THREE.NoColorSpace : THREE.SRGBColorSpace
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
      pending--; resolve(tex)
    }, undefined, () => { pending--; resolve(null) })
  })
  textures.set(name, p)
  return p
}

function loadLightmap(index, page) {
  const key = `lm:${index}/${page}`
  if (textures.has(key)) return textures.get(key)
  const p = new Promise((resolve) => {
    pending++
    new THREE.TextureLoader().load(bundle.lightmaps[index][page], (tex) => {
      tex.flipY = false
      tex.colorSpace = THREE.NoColorSpace
      tex.generateMipmaps = false
      tex.minFilter = THREE.LinearFilter
      pending--; resolve(tex)
    }, undefined, () => { pending--; resolve(null) })
  })
  textures.set(key, p)
  return p
}

function buildWorld() {
  world = new THREE.Group()
  for (const s of sceneData.surfaces) {
    const info = sceneData.materials[s.material]
    if (info.sky) continue
    const geom = new THREE.BufferGeometry()
    const pos = sceneData.f32(s.positions), nor = sceneData.f32(s.normals)
    const p3 = new Float32Array(pos.length), n3 = new Float32Array(nor.length)
    for (let i = 0; i < pos.length; i += 3) {
      p3[i] = pos[i]; p3[i + 1] = pos[i + 2]; p3[i + 2] = -pos[i + 1]
      n3[i] = nor[i]; n3[i + 1] = nor[i + 2]; n3[i + 2] = -nor[i + 1]
    }
    geom.setAttribute('position', new THREE.BufferAttribute(p3, 3))
    geom.setAttribute('normal', new THREE.BufferAttribute(n3, 3))
    geom.setAttribute('uv', new THREE.BufferAttribute(sceneData.f32(s.uvs), 2))
    if (s.lmuvs) geom.setAttribute('uv1', new THREE.BufferAttribute(sceneData.f32(s.lmuvs), 2))
    geom.setIndex(new THREE.BufferAttribute(sceneData.u32(s.indices), 1))
    const mesh = new THREE.Mesh(geom, materialFor(s.material, s.lightmap))
    const ent = sceneData.entities[s.entity]
    mesh.userData = { entity: ent, tool: info.tool, trigger: /^trigger/.test(ent.classname) }
    mesh.castShadow = mesh.receiveShadow = !info.tool
    if (mesh.userData.trigger) {
      mesh.material = new THREE.MeshBasicMaterial({ color: 0xff9f1c, transparent: true, opacity: 0.25, depthWrite: false })
      mesh.castShadow = mesh.receiveShadow = false
    }
    if (ent.origin && ent.index > 0 && sceneData.kind === 'bsp') mesh.position.copy(toThree(...ent.origin))
    world.add(mesh)
  }
  scene.add(world)
}

const wsVec = (k, d) => (sceneData.worldspawn[k] ? sceneData.worldspawn[k].trim().split(/\s+/).map(Number) : d)

// sundirection is a CoD angle vector pointing at the sun.
function readSun() {
  const ws = sceneData.worldspawn
  const a = wsVec('sundirection', [-50, 40, 0])
  const p = a[0] * d2r, y = a[1] * d2r
  const dir = toThree(Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), -Math.sin(p)).normalize()
  const sunlight = +(ws.sunlight || 1.2)
  return { dir, color: new THREE.Color(...wsVec('suncolor', [1, 1, 1])).multiplyScalar(sunlight), sunlight }
}

function buildLights() {
  const ws = sceneData.worldspawn
  const vec = wsVec
  const sunColor = new THREE.Color(...vec('suncolor', [1, 1, 1]))
  const sunlight = sunInfo.sunlight
  const ambientColor = new THREE.Color(...vec('_color', [1, 1, 1]))
  const ambientLevel = +(ws.ambient || 0.3)
  const diffuse = new THREE.Color(...vec('sundiffusecolor', [0.8, 0.85, 1]))
  const hasLightmaps = sceneData.lightmapCount > 0
  const toSun = sunInfo.dir
  sun = new THREE.DirectionalLight(sunColor, hasLightmaps ? 0 : sunlight * 1.6)
  sun.position.copy(toSun.clone().multiplyScalar(8192))
  sun.target.position.set(0, 0, 0)
  const b = sceneData.bounds
  const extent = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])
  const center = toThree((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2)
  sun.target.position.copy(center)
  sun.position.copy(center.clone().add(toSun.clone().multiplyScalar(extent * 1.5)))
  sun.castShadow = true
  sun.shadow.mapSize.set(4096, 4096)
  const half = extent * 0.75
  Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: extent * 4 })
  sun.shadow.bias = -0.0005
  sun.shadow.normalBias = 2
  scene.add(sun, sun.target)
  hemi = new THREE.HemisphereLight(diffuse, diffuse.clone().multiplyScalar(0.35), hasLightmaps ? 0 : 0.6 + +(ws.diffusefraction || 0.3))
  scene.add(hemi)
  ambient = new THREE.AmbientLight(ambientColor, hasLightmaps ? 0 : ambientLevel * 1.5)
  scene.add(ambient)
  if (!hasLightmaps) {
    let n = 0
    for (const e of sceneData.entities) {
      if (e.classname !== 'light' || !e.origin || n++ > 64) continue
      const radius = +(e.keys.radius || 300)
      const color = e.keys._color ? new THREE.Color(...e.keys._color.trim().split(/\s+/).map(Number)) : new THREE.Color(1, 1, 1)
      const light = new THREE.PointLight(color, +(e.keys.intensity || 1) * radius * 0.6, radius, 1)
      light.position.copy(toThree(...e.origin))
      scene.add(light)
    }
  }
}

async function buildSky() {
  if (!bundle.sky) return
  const faces = await Promise.all(bundle.sky.map((src) => new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.src = src
  })))
  const cube = new THREE.CubeTexture(faces)
  cube.colorSpace = THREE.SRGBColorSpace
  cube.needsUpdate = true
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
  skybox = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), mat)
  skybox.frustumCulled = false
  skybox.renderOrder = -1000
  scene.add(skybox)
}

function buildMarkers() {
  markers = new THREE.Group()
  labelItems = []
  const boxGeom = new THREE.BoxGeometry(PLAYER.width, PLAYER.height, PLAYER.width)
  const arrowGeom = new THREE.ConeGeometry(8, 28, 8)
  const smallGeom = new THREE.OctahedronGeometry(10)
  for (const e of sceneData.entities) {
    if (!e.origin || e.classname === 'worldspawn') continue
    const cls = e.classname
    if (/^node_|^info_vehicle_node|^actor_/.test(cls)) continue
    let color = 0xaaaaaa, label = cls
    const group = new THREE.Group()
    group.position.copy(toThree(...e.origin))
    if (/spawn|info_player_start|intermission/.test(cls)) {
      color = /allied|allies|american|british|russian/.test(cls) ? 0x3a86ff : /axis|german/.test(cls) ? 0xff3355 : 0x2ec4b6
      const box = new THREE.Mesh(boxGeom, new THREE.MeshBasicMaterial({ color, wireframe: true }))
      box.position.y = PLAYER.height / 2
      group.add(box)
      const arrow = new THREE.Mesh(arrowGeom, new THREE.MeshBasicMaterial({ color }))
      const yaw = (e.angles ? e.angles[1] : 0) * d2r
      arrow.position.copy(toThree(Math.cos(yaw) * 34, Math.sin(yaw) * 34, 3))
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), toThree(Math.cos(yaw), Math.sin(yaw), 0).normalize())
      group.add(arrow)
    } else if (cls === 'light') {
      color = 0xffd166
      group.add(new THREE.Mesh(new THREE.SphereGeometry(8, 12, 8), new THREE.MeshBasicMaterial({ color })))
      label = `light ${e.keys.intensity || ''}`
    } else if (/model/.test(cls) || cls === 'misc_prefab' || cls === 'misc_turret') {
      color = 0xff5dd0
      group.add(new THREE.Mesh(new THREE.BoxGeometry(32, 32, 32), new THREE.MeshBasicMaterial({ color, wireframe: true })))
      label = `${cls} ${(e.model || '').split('/').pop()}`
    } else {
      group.add(new THREE.Mesh(smallGeom, new THREE.MeshBasicMaterial({ color })))
    }
    if (e.keys.targetname) label += ` [${e.keys.targetname}]`
    group.userData = { entity: e }
    markers.add(group)
    const div = document.createElement('div')
    div.textContent = label
    div.style.color = '#' + new THREE.Color(color).getHexString()
    const important = !/^misc_model|^script_model|^misc_prefab|^info_null|^script_origin|^node_|^light$/.test(cls) || (e.keys.targetname && !/^info_null|^script_origin/.test(cls))
    labelItems.push({ div, pos: group.position.clone().add(new THREE.Vector3(0, 40, 0)), entity: e, important })
  }
  scene.add(markers)
  const b = sceneData.bounds
  const size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1])
  const grid = new THREE.GridHelper(Math.ceil(size / 1024) * 1024 + 2048, (Math.ceil(size / 1024) * 1024 + 2048) / 256, 0x88aaff, 0x3a4a60)
  grid.position.copy(toThree(Math.round((b.min[0] + b.max[0]) / 512) * 256, Math.round((b.min[1] + b.max[1]) / 512) * 256, b.min[2] - 1))
  grid.name = 'grid'
  scene.add(grid)
}

function applyView() {
  const labels = document.getElementById('labels')
  labels.replaceChildren()
  if (state.labels && state.entities) for (const l of labelItems) if (l.important || state.labels === 'all') labels.appendChild(l.div)
  markers.visible = state.entities
  scene.getObjectByName('grid').visible = state.grid || state.top
  for (const m of world.children) m.visible = !(m.userData.tool && !state.tools)
  for (const mat of Object.values(materials)) refreshMaterial(mat)
  renderer.shadowMap.enabled = state.shadows && !state.top
  if (sun) sun.castShadow = state.shadows && !state.top
  renderer.clippingPlanes = state.cut == null ? [] : [new THREE.Plane(new THREE.Vector3(0, -1, 0), state.cut)]
  if (skybox) skybox.visible = !state.top && state.cut == null
  scene.background = state.top ? new THREE.Color(0x101418) : new THREE.Color(0x5b7d9e)
  document.getElementById('hud').style.display = state.hud ? 'block' : 'none'
  document.getElementById('legend').style.display = state.hud ? 'block' : 'none'
  needRender = true
}

function updateCamera() {
  const aspect = innerWidth / innerHeight
  if (state.top) {
    const b = sceneData.bounds
    const span = state.span || Math.max(b.max[0] - b.min[0], (b.max[1] - b.min[1]) * aspect) * 1.05
    const cx = state.span ? state.pos[0] : (b.min[0] + b.max[0]) / 2
    const cy = state.span ? state.pos[1] : (b.min[1] + b.max[1]) / 2
    ortho.left = -span / 2; ortho.right = span / 2; ortho.top = span / aspect / 2; ortho.bottom = -span / aspect / 2
    ortho.position.copy(toThree(cx, cy, b.max[2] + 4096))
    ortho.up.set(0, 0, -1)
    ortho.lookAt(toThree(cx, cy, b.min[2]))
    ortho.updateProjectionMatrix()
    return ortho
  }
  const [p, y, r] = state.angles.map((a) => a * d2r)
  const cp = Math.cos(p), sp = Math.sin(p), cy = Math.cos(y), sy = Math.sin(y), cr = Math.cos(r), sr = Math.sin(r)
  const forward = toThree(cp * cy, cp * sy, -sp)
  const up = toThree(cr * sp * cy + sr * sy, cr * sp * sy - sr * cy, cr * cp)
  camera.position.copy(toThree(...state.pos))
  camera.up.copy(up)
  camera.lookAt(camera.position.clone().add(forward))
  camera.fov = 2 * Math.atan(Math.tan(state.fov * d2r / 2) / aspect) / d2r
  camera.aspect = aspect
  camera.updateProjectionMatrix()
  return camera
}

function renderLoop() {
  const cam = updateCamera()
  const moved = move()
  if (needRender || moved || pending > 0) {
    renderer.render(scene, cam)
    updateLabels(cam)
    updateHud()
    needRender = false
    occlusionDirty = true
    lastChange = performance.now()
  } else if (occlusionDirty && performance.now() - lastChange > 150) {
    computeOcclusion(cam)
    updateLabels(cam)
  }
  requestAnimationFrame(renderLoop)
}

// Draws the world depth plus one coloured point per label into an offscreen target, then reads back which
// points survived the depth test, so labels behind walls stay hidden.
function computeOcclusion(cam) {
  occlusionDirty = false
  const w = innerWidth, h = innerHeight
  if (!occlusion) {
    occlusion = {
      target: new THREE.WebGLRenderTarget(w, h),
      scene: new THREE.Scene(),
      depthMaterial: new THREE.MeshBasicMaterial({ color: 0x000000 }),
      points: null, pixels: new Uint8Array(w * h * 4), visible: new Set(),
    }
  }
  const o = occlusion
  if (o.target.width !== w || o.target.height !== h) { o.target.setSize(w, h); o.pixels = new Uint8Array(w * h * 4) }
  const items = labelItems.filter((l) => l.div.parentNode)
  const positions = new Float32Array(items.length * 3), colors = new Float32Array(items.length * 3)
  items.forEach((l, i) => {
    positions.set([l.pos.x, l.pos.y, l.pos.z], i * 3)
    const id = i + 1
    colors.set([(id & 255) / 255, ((id >> 8) & 255) / 255, ((id >> 16) & 255) / 255], i * 3)
  })
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const points = new THREE.Points(geom, new THREE.PointsMaterial({ size: 5, sizeAttenuation: false, vertexColors: true }))
  points.frustumCulled = false
  const hidden = world.children.filter((m) => m.userData.trigger && m.visible)
  for (const m of hidden) m.visible = false
  o.scene.overrideMaterial = o.depthMaterial
  o.scene.add(world)
  renderer.setRenderTarget(o.target)
  renderer.setClearColor(0x000000, 1)
  renderer.clear()
  renderer.render(o.scene, cam)
  o.scene.overrideMaterial = null
  o.scene.remove(world)
  scene.add(world)
  for (const m of hidden) m.visible = true
  o.scene.add(points)
  renderer.autoClear = false
  renderer.render(o.scene, cam)
  renderer.autoClear = true
  o.scene.remove(points)
  renderer.readRenderTargetPixels(o.target, 0, 0, w, h, o.pixels)
  renderer.setRenderTarget(null)
  geom.dispose()
  o.visible.clear()
  const v = new THREE.Vector3()
  items.forEach((l, i) => {
    v.copy(l.pos).project(cam)
    const x = Math.round((v.x + 1) / 2 * w), y = Math.round((v.y + 1) / 2 * h)
    if (x < 0 || y < 0 || x >= w || y >= h) return
    const k = (y * w + x) * 4
    const id = o.pixels[k] | (o.pixels[k + 1] << 8) | (o.pixels[k + 2] << 16)
    if (id === i + 1) o.visible.add(l)
  })
}

function updateLabels(cam) {
  const v = new THREE.Vector3()
  const camPos = cam.position
  const near = (p) => !state.top && p.distanceTo(camPos) < 80
  for (const g of markers.children) g.visible = !near(g.position)
  const placed = []
  const items = labelItems.filter((l) => l.div.parentNode).map((l) => ({ l, d: l.pos.distanceTo(camPos) })).sort((a, b) => a.d - b.d)
  for (const { l, d } of items) {
    v.copy(l.pos).project(cam)
    let visible = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 && !near(l.pos) && (state.top || d < 2000) && (occlusionDirty || !occlusion || occlusion.visible.has(l))
    if (visible) {
      const x = (v.x + 1) / 2 * innerWidth, y = (1 - v.y) / 2 * innerHeight
      const w = l.div.offsetWidth || 80, h = l.div.offsetHeight || 16
      const rect = { x0: x - w / 2, x1: x + w / 2, y0: y - h, y1: y }
      visible = !placed.some((r) => r.x0 < rect.x1 && r.x1 > rect.x0 && r.y0 < rect.y1 && r.y1 > rect.y0)
      if (visible) { placed.push(rect); l.div.style.left = `${x}px`; l.div.style.top = `${y}px` }
    }
    l.div.style.display = visible ? 'block' : 'none'
  }
  const ticks = document.getElementById('ticks')
  ticks.replaceChildren()
  if (state.top) {
    const step = [64, 128, 256, 512, 1024, 2048, 4096, 8192].find((st) => (ortho.right - ortho.left) / st <= 14) || 16384
    const x0 = fromThree(ortho.position)[0] - (ortho.right - ortho.left) / 2, x1 = x0 + (ortho.right - ortho.left)
    const y0 = fromThree(ortho.position)[1] - (ortho.top - ortho.bottom) / 2, y1 = y0 + (ortho.top - ortho.bottom)
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      const d = document.createElement('div'); d.textContent = x
      d.style.left = `${(x - x0) / (x1 - x0) * innerWidth + 2}px`; d.style.top = '2px'
      ticks.appendChild(d)
    }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
      const d = document.createElement('div'); d.textContent = y
      d.style.left = '2px'; d.style.top = `${(1 - (y - y0) / (y1 - y0)) * innerHeight - 14}px`
      ticks.appendChild(d)
    }
  }
}

function updateHud() {
  const hud = document.getElementById('hud')
  if (!state.hud) return
  const pos = state.pos.map(round).join(' '), ang = state.angles.map(round).join(' ')
  const view = state.top ? `top view${state.cut != null ? ` · cut z<=${state.cut}` : ''}` : `pos <b>${pos}</b> · angles <b>${ang}</b> · fov ${state.fov}${state.cut != null ? ` · cut z<=${state.cut}` : ''}`
  const cli = state.top ? `--top${state.span ? ` --center ${round(state.pos[0])},${round(state.pos[1])} --span ${round(state.span)}` : ''}` : `--pos ${state.pos.map(round).join(',')} --angles ${state.angles.map(round).join(',')}`
  hud.innerHTML = `${sceneData.name} (${sceneData.kind}) · ${view}\nshot: <b>${cli}</b>${state.cut != null ? ` --cut ${state.cut}` : ''}`
}

const keys = new Set()
let lastTime = performance.now()
function move() {
  const now = performance.now(), dt = Math.min(0.1, (now - lastTime) / 1000)
  lastTime = now
  if (!keys.size) return false
  const speed = state.speed * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 4 : 1) * dt
  const [p, y] = state.angles.map((a) => a * d2r)
  const fwd = [Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), -Math.sin(p)]
  const right = [Math.sin(y), -Math.cos(y), 0]
  let moved = false
  const step = (v, s) => { state.pos[0] += v[0] * s; state.pos[1] += v[1] * s; state.pos[2] += v[2] * s; moved = true }
  if (keys.has('KeyW')) step(fwd, speed)
  if (keys.has('KeyS')) step(fwd, -speed)
  if (keys.has('KeyD')) step(right, speed)
  if (keys.has('KeyA')) step(right, -speed)
  if (keys.has('Space')) step([0, 0, 1], speed)
  if (keys.has('KeyC')) step([0, 0, 1], -speed)
  return moved
}

function setupControls() {
  const canvas = renderer.domElement
  canvas.addEventListener('click', () => { if (!state.top) canvas.requestPointerLock() })
  addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas) return
    state.angles[1] = ((state.angles[1] - e.movementX * 0.12 + 540) % 360) - 180
    state.angles[0] = Math.max(-89, Math.min(89, state.angles[0] + e.movementY * 0.12))
    needRender = true
  })
  addEventListener('wheel', (e) => {
    if (state.top) { state.span = (state.span || defaultSpan()) * (e.deltaY > 0 ? 1.15 : 1 / 1.15); state.pos[0] = centerX(); state.pos[1] = centerY() }
    else state.speed = Math.max(25, Math.min(6400, state.speed * (e.deltaY > 0 ? 0.8 : 1.25)))
    needRender = true
  })
  addEventListener('keydown', (e) => {
    if (e.repeat) return
    keys.add(e.code)
    const toggles = { KeyL: 'labels', KeyE: 'entities', KeyT: 'textures', KeyG: 'grid', KeyK: 'tools', KeyH: 'hud', Digit1: 'top' }
    if (toggles[e.code]) { state[toggles[e.code]] = e.code === 'KeyL' && e.shiftKey ? 'all' : !state[toggles[e.code]]; applyView() }
    if (e.code === 'KeyM') { state.lightmap = !state.lightmap; applyView() }
    if (e.code === 'Escape') document.exitPointerLock()
  })
  addEventListener('keyup', (e) => keys.delete(e.code))
  addEventListener('blur', () => keys.clear())
  function defaultSpan() { const b = sceneData.bounds; return Math.max(b.max[0] - b.min[0], (b.max[1] - b.min[1]) * innerWidth / innerHeight) * 1.05 }
  function centerX() { return state.span ? state.pos[0] : (sceneData.bounds.min[0] + sceneData.bounds.max[0]) / 2 }
  function centerY() { return state.span ? state.pos[1] : (sceneData.bounds.min[1] + sceneData.bounds.max[1]) / 2 }
}

function whenIdle() {
  return new Promise((resolve) => {
    const check = () => {
      if (pending > 0) return setTimeout(check, 50)
      needRender = true
      const settled = () => (occlusionDirty ? requestAnimationFrame(settled) : requestAnimationFrame(resolve))
      requestAnimationFrame(() => requestAnimationFrame(settled))
    }
    check()
  })
}

function round(n) { return Math.round(n * 10) / 10 }
