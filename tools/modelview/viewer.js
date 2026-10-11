// The page: each view's rig skinned in three.js, playing one animation at a time, seen from an orbit camera or the eye.
// Rigs are built in CoD's Z-up frame and turned into three.js's Y-up one by their outer group, as mapview's players.
import { decodeGeometry } from '../mapview/packed.js'
import { boneTree, geometryOf, buildClip } from '../mapview/skin.js'
import { BLEND, blendOf, ignoresAlpha } from '../mapview/shader.js'

const bundle = JSON.parse(document.getElementById('bundle').textContent)
const params = { ...(bundle.defaults ?? {}), ...Object.fromEntries(new URLSearchParams(location.hash.slice(1))) }
const canvas = document.getElementById('gl')
const $ = (id) => document.getElementById(id)
const BG = { dark: 0x202020, mid: 0x737373, light: 0xcccccc, black: 0x000000 }
const ALPHA_TEST = 0.4
// Grid cells are the power of two nearest the model's radius; the panel shows their size.
const GRID_CELLS = 16
// cg_fov's default: the horizontal field of view the game draws the viewmodel with.
const EYE_FOV = 80
const ORBIT_FOV = 40
const d2r = Math.PI / 180
const toThree = ([x, y, z]) => new THREE.Vector3(x, z, -y)
const fromThree = (v) => [v.x, -v.z, v.y]

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
renderer.outputColorSpace = THREE.SRGBColorSpace
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera()
// The key light follows the camera, so every side of a model is lit as it turns.
const key = new THREE.DirectionalLight(0xffffff, 2.5)
key.position.set(-0.6, 1, 0.8)
key.target.position.set(0, 0, -1)
camera.add(key, key.target)
scene.add(camera, new THREE.HemisphereLight(0xffffff, 0x5a5048, 2.5))
const grid = new THREE.GridHelper(GRID_CELLS, GRID_CELLS, 0x8090a0, 0x4a525c)
scene.add(grid)

let pending = 0
const materials = []
const views = Object.fromEntries(Object.entries(bundle.views).map(([name, v]) => [name, buildView(v)]))
const viewNames = Object.keys(views)

const state = {
  view: viewNames.includes(params.person) ? params.person : viewNames[0],
  anim: null,
  time: 0,
  playing: params.t === undefined,
  speed: 1,
  bg: params.bg ?? 'dark',
  tex: params.tex !== 'off',
  wire: params.wire === 'on',
  bones: params.bones === 'on',
  grid: params.grid !== 'off',
  eye: null,
}
const cam = { target: [0, 0, 0], yaw: 35, pitch: 15, dist: 200 }
let current = null
let action = null
let helper = null

function buildView(v) {
  const data = decodeGeometry(v.rig.geometry)
  const body = new THREE.Group()
  const bones = boneTree(v.rig.bones, body, THREE.Bone)
  const skeleton = new THREE.Skeleton(bones)
  const meshes = v.rig.surfaces.map((s) => new THREE.SkinnedMesh(geometryOf(data, s), materialOf(v.rig, s.material)))
  body.add(...meshes)
  body.updateMatrixWorld(true)
  for (const mesh of meshes) {
    mesh.bind(skeleton)
    // The bind pose's bounds would cull a pose that leans out of them.
    mesh.frustumCulled = false
  }
  // The held weapon is drawn rigid in its bind pose, its bones along as objects for their labels.
  const tags = bones.filter((b) => b.name.startsWith('tag_'))
  let triangles = v.rig.surfaces.reduce((n, s) => n + s.indices.count / 3, 0)
  if (v.held) {
    const weapon = new THREE.Group()
    const heldData = decodeGeometry(v.held.geometry)
    for (const s of v.held.surfaces) weapon.add(new THREE.Mesh(geometryOf(heldData, s), materialOf(v.held, s.material)))
    tags.push(...boneTree(v.held.bones, weapon, THREE.Object3D).filter((b) => b.name.startsWith('tag_')))
    bones.find((b) => b.name === 'tag_weapon_right')?.add(weapon)
    triangles += v.held.surfaces.reduce((n, s) => n + s.indices.count / 3, 0)
  }
  const outer = new THREE.Group()
  outer.rotation.x = -Math.PI / 2
  outer.add(body)
  const mixer = new THREE.AnimationMixer(body)
  const clips = Object.fromEntries(Object.entries(v.anims).map(([name, anim]) => [name, buildClip(v.rig.bones, anim, () => true)]))
  return { ...v, outer, body, meshes, tags, mixer, clips, triangles }
}

function materialOf(rig, index) {
  const info = rig.materials[index]
  const blend = blendOf(info.techset)
  const image = info.width && rig.images[info.image]
  const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, color: image ? 0xffffff : hashColor(info.name) })
  if (blend !== BLEND.opaque) {
    Object.assign(mat, { transparent: true, depthWrite: false })
    if (blend === BLEND.add) mat.blending = THREE.AdditiveBlending
    if (blend === BLEND.multiply) Object.assign(mat, { blending: THREE.CustomBlending, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor })
  }
  if (image) {
    pending++
    new THREE.TextureLoader().loadAsync(image.png).then((tex) => {
      tex.flipY = false
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      tex.colorSpace = THREE.SRGBColorSpace
      mat.userData.texture = tex
      mat.userData.alphaTest = image.alpha && blend === BLEND.opaque && !ignoresAlpha(info.techset) ? ALPHA_TEST : 0
      refreshMaterial(mat)
      pending--
    })
  }
  mat.userData.color = mat.color.clone()
  mat.userData.name = info.name
  materials.push(mat)
  return mat
}

function refreshMaterial(mat) {
  const tex = state.tex ? mat.userData.texture ?? null : null
  mat.map = tex
  mat.color.copy(tex ? new THREE.Color(0xffffff) : mat.userData.texture ? new THREE.Color(0x9a9a9a) : mat.userData.color)
  mat.alphaTest = tex ? mat.userData.alphaTest : 0
  mat.wireframe = state.wire
  mat.needsUpdate = true
}

function hashColor(name) {
  let h = 2166136261
  for (const c of name) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return new THREE.Color().setHSL(((h >>> 0) % 360) / 360, 0.35, 0.55)
}

// ---------- view and animation ----------
function setView(name) {
  if (current) scene.remove(current.outer)
  state.view = name
  $('view').value = name
  current = views[name]
  scene.add(current.outer)
  if (helper) scene.remove(helper)
  helper = new THREE.SkeletonHelper(current.body)
  scene.add(helper)
  // An orbit camera given in the options turns it off.
  state.eye = !!current.eye && params.eye !== 'off' && !params.cam
  $('eyeRow').style.display = current.eye ? '' : 'none'
  $('eye').checked = state.eye
  $('anim').innerHTML = Object.keys(current.clips).map((n) => `<option>${n}</option>`).join('') || '<option value="">(bind pose)</option>'
  setAnim(current.clips[params.anim] ? params.anim : current.start)
  fit()
}

function setAnim(name) {
  current.mixer.stopAllAction()
  state.anim = name && current.clips[name] ? name : null
  action = state.anim ? current.mixer.clipAction(current.clips[state.anim]).play() : null
  $('anim').value = state.anim ?? ''
  seek(0)
}

const duration = () => (action ? action.getClip().duration : 0)
const frameTime = () => (state.anim ? 1 / current.anims[state.anim].fps : 0.05)

function seek(t) {
  const d = duration()
  // The end stays the end, so a sheet's last frame shows a death's last pose, not its first.
  state.time = d && (t < 0 || t > d) ? ((t % d) + d) % d : d ? t : 0
  if (action) action.time = state.time
  current.mixer.update(0)
  current.outer.updateMatrixWorld(true)
}

// Bounds over the animation, sampled, so the camera holds every pose.
function bounds() {
  const box = new THREE.Box3()
  const t = state.time
  const d = duration()
  for (const f of d ? [0, 0.25, 0.5, 0.75, 1] : [0]) {
    seek(f * d * 0.999)
    for (const mesh of current.meshes) {
      mesh.computeBoundingBox()
      box.union(mesh.boundingBox.clone().applyMatrix4(mesh.matrixWorld))
    }
  }
  seek(t)
  return box
}

function fit() {
  const box = bounds()
  const center = box.getCenter(new THREE.Vector3())
  const radius = Math.max(4, box.getSize(new THREE.Vector3()).length() / 2)
  cam.target = fromThree(center)
  cam.dist = (radius / Math.tan((ORBIT_FOV * d2r) / 2)) * 1.1
  grid.scale.setScalar(2 ** Math.round(Math.log2(radius)))
}

// ---------- camera ----------
function updateCamera() {
  const aspect = canvas.width / canvas.height
  camera.aspect = aspect
  if (state.eye) {
    // The viewmodel's root, tag_view, is the eye, looking down its +X.
    camera.position.set(0, 0, 0)
    camera.up.set(0, 1, 0)
    camera.lookAt(1, 0, 0)
    camera.fov = (2 * Math.atan(Math.tan((EYE_FOV * d2r) / 2) / aspect)) / d2r
    camera.near = 1
    camera.far = 4096
  } else {
    const y = cam.yaw * d2r, p = cam.pitch * d2r
    const eye = cam.target.map((v, i) => v + [Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), Math.sin(p)][i] * cam.dist)
    camera.position.copy(toThree(eye))
    camera.up.set(0, 1, 0)
    camera.lookAt(toThree(cam.target))
    camera.fov = ORBIT_FOV
    camera.near = Math.max(0.1, cam.dist / 200)
    camera.far = cam.dist * 50
  }
  camera.updateProjectionMatrix()
}

// Each tag's name and where it is on the canvas, in pixels.
function tagLabels() {
  const out = []
  const v = new THREE.Vector3()
  for (const tag of current.tags) {
    tag.getWorldPosition(v).project(camera)
    if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) continue
    out.push({ name: tag.name, x: ((v.x + 1) / 2) * canvas.width, y: ((1 - v.y) / 2) * canvas.height })
  }
  return out
}

function render() {
  scene.background = new THREE.Color(BG[state.bg])
  grid.visible = state.grid && !state.eye
  helper.visible = state.bones
  updateCamera()
  renderer.render(scene, camera)
}

// ---------- UI ----------
function updateUi() {
  const d = duration()
  $('time').max = Math.max(1, Math.round(d * 1000))
  $('time').value = Math.round(state.time * 1000)
  const anim = state.anim && current.anims[state.anim]
  $('stats').textContent = [
    `${current.rig.bones.length} bones · ${current.triangles} triangles · ${current.rig.materials.length + (current.held?.materials.length ?? 0)} materials`,
    anim ? `${state.anim}: frame ${Math.round(state.time * anim.fps)} / ${anim.frames - 1} · ${Math.round(state.time * 1000)} / ${Math.round(d * 1000)} ms · ${anim.fps} fps` : 'bind pose',
    state.eye ? `eye view, fov ${EYE_FOV}` : `cam ${Math.round(cam.yaw)},${Math.round(cam.pitch)},${Math.round(cam.dist)} · grid cell ${grid.scale.x} units`,
  ].join('\n')
  $('labels').innerHTML = state.bones ? tagLabels().map((l) => `<div style="left:${l.x}px;top:${l.y}px">${l.name}</div>`).join('') : ''
}

$('title').textContent = bundle.name
$('view').innerHTML = viewNames.map((n) => `<option value="${n}">${{ first: 'first person', third: 'third person', model: 'model' }[n]}</option>`).join('')
$('viewRow').style.display = viewNames.length > 1 ? '' : 'none'
$('view').onchange = (e) => { delete params.anim; setView(e.target.value) }
$('anim').onchange = (e) => setAnim(e.target.value)
$('play').onclick = () => { state.playing = !state.playing; $('play').textContent = state.playing ? 'Pause' : 'Play' }
$('fit').onclick = fit
$('time').oninput = (e) => { state.playing = false; $('play').textContent = 'Play'; seek(Number(e.target.value) / 1000) }
$('speed').onchange = (e) => { state.speed = Number(e.target.value) }
$('bg').value = state.bg
$('bg').onchange = (e) => { state.bg = e.target.value }
for (const k of ['tex', 'wire']) {
  $(k).checked = state[k]
  $(k).onchange = (e) => { state[k] = e.target.checked; materials.forEach(refreshMaterial) }
}
for (const k of ['bones', 'grid', 'eye']) {
  $(k).checked = state[k]
  $(k).onchange = (e) => { state[k] = e.target.checked }
}
$('warn').textContent = bundle.problems.join('\n')

let drag = null
canvas.onmousedown = (e) => { drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey } }
window.onmouseup = () => { drag = null }
window.onmousemove = (e) => {
  if (!drag) return
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y
  drag.x = e.clientX
  drag.y = e.clientY
  if (state.eye) { state.eye = false; $('eye').checked = false }
  if (drag.pan) {
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
    const k = cam.dist * 0.0015
    const move = right.multiplyScalar(-dx * k).add(up.multiplyScalar(dy * k))
    cam.target = fromThree(toThree(cam.target).add(move))
  } else {
    cam.yaw -= dx * 0.4
    cam.pitch = Math.max(-89, Math.min(89, cam.pitch + dy * 0.4))
  }
}
canvas.onwheel = (e) => { cam.dist = Math.max(2, Math.min(20000, cam.dist * Math.exp(e.deltaY * 0.001))); e.preventDefault() }
window.onkeydown = (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return
  if (e.code === 'Space') { $('play').click(); e.preventDefault() }
  if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
    state.playing = false
    $('play').textContent = 'Play'
    seek(state.time + (e.code === 'ArrowRight' ? 1 : -1) * frameTime())
  }
  if (e.key === 'h') { document.body.classList.toggle('hideui'); resize() }
}

function resize() {
  const uiWidth = document.body.classList.contains('hideui') ? 0 : 260
  renderer.setSize(Math.max(1, window.innerWidth - uiWidth), Math.max(1, window.innerHeight), false)
}
window.onresize = resize

// ---------- loop ----------
let last = performance.now()
let fpsAcc = 0
let fpsFrames = 0
function frame(now) {
  const dt = Math.min(100, now - last) / 1000
  fpsAcc += now - last
  fpsFrames++
  if (fpsAcc >= 500) { $('fps').textContent = `${Math.round((fpsFrames * 1000) / fpsAcc)} fps`; fpsAcc = 0; fpsFrames = 0 }
  last = now
  if (state.playing && action) seek(state.time + dt * state.speed)
  render()
  updateUi()
  requestAnimationFrame(frame)
}

// ---------- headless API ----------
window.modelview = {
  info: () => ({ view: state.view, anim: state.anim, duration: duration(), cam: { ...cam }, eye: state.eye }),
  // Renders `shots`, each a time in seconds and an optional orbit yaw, into one labelled contact sheet; returns it
  // as a PNG data URL.
  capture({ shots, cols, width, height }) {
    state.playing = false
    renderer.setSize(width, height, false)
    const sheet = document.createElement('canvas')
    sheet.width = cols * width
    sheet.height = Math.ceil(shots.length / cols) * height
    const ctx = sheet.getContext('2d')
    ctx.font = '13px monospace'
    shots.forEach((shot, i) => {
      seek(shot.time)
      if (shot.yaw !== undefined) cam.yaw = shot.yaw
      render()
      const x = (i % cols) * width, y = Math.floor(i / cols) * height
      ctx.drawImage(canvas, x, y)
      if (state.bones) {
        ctx.font = '11px monospace'
        ctx.fillStyle = '#ffd166'
        for (const l of tagLabels()) ctx.fillText(l.name, x + l.x + 4, y + l.y + 4)
        ctx.font = '13px monospace'
      }
      const anim = state.anim && current.anims[state.anim]
      const label = shot.yaw !== undefined || !anim ? `yaw ${Math.round(cam.yaw)}` : `${state.anim} · frame ${Math.round(state.time * anim.fps)} · ${Math.round(state.time * 1000)} ms`
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(x, y, ctx.measureText(label).width + 8, 18)
      ctx.fillStyle = '#fff'
      ctx.fillText(label, x + 4, y + 13)
      ctx.strokeStyle = '#000'
      ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1)
    })
    resize()
    return sheet.toDataURL('image/png')
  },
}

setView(state.view)
if (params.cam) {
  // A part left out keeps the fitted value.
  const [yaw, pitch, dist] = params.cam.split(',').map((v) => (v ? Number(v) : undefined))
  Object.assign(cam, Object.fromEntries(Object.entries({ yaw, pitch, dist }).filter(([, v]) => Number.isFinite(v))))
}
if (params.t !== undefined) seek(Number(params.t) / 1000)
resize()
const waitTextures = () => (pending ? setTimeout(waitTextures, 50) : start())
waitTextures()
function start() {
  $('status').style.display = 'none'
  window.modelReady = true
  requestAnimationFrame(frame)
}
