import { createWorld, toThree, fromThree } from './draw.js'
import { createMarkers } from './markers.js'
import { anglesToForward, anglesToMatrix, d2r } from './math.js'

const map = decodeGeometry(JSON.parse(document.getElementById('bundle').textContent))
const params = withDefaults(Object.fromEntries(new URLSearchParams(location.hash.slice(1))))
const $ = (id) => document.getElementById(id)
const EYE_HEIGHT = 60
const TOP_MARGIN = 1.05
// View params are the command line's view options: "off" turns a default-on option off.
const off = (v) => v !== undefined && ['off', '0', 'false', false].includes(v)
const on = (v) => v !== undefined && !off(v)

const state = { speed: 400 }
const keys = new Set()
let lastTime = performance.now()
let needRender = true
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(1)
renderer.setSize(innerWidth, innerHeight)
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.body.appendChild(renderer.domElement)
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 4, 65536)
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 131072)
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); needRender = true })
document.title = `${map.name} – mapview`
const world = createWorld(map, renderer, scene, () => { needRender = true })
const markers = createMarkers(map, renderer, scene, world.occluders)

readParams(params)
applyView()
setupControls()
$('status').style.display = 'none'
renderLoop()
whenIdle().then(() => { window.mapReady = true })

window.mapview = {
  // Resets the view to the page defaults plus `p`, waits for the frame, returns the camera.
  async apply(p) {
    readParams(withDefaults(p))
    applyView()
    await whenIdle()
    return { pos: state.pos.map(round), angles: state.angles.map(round), fov: state.fov, top: state.top }
  },
}

// readParams ranks at over pos and look over angles, so a camera in `p` drops the baked one it replaces.
function withDefaults(p) {
  const { at, pos, angles, look, ...rest } = map.defaults
  const camera = p.at !== undefined ? {} : p.pos !== undefined ? { angles } : { at, pos, angles, look: p.angles !== undefined ? undefined : look }
  return { ...rest, ...camera, ...p }
}

// The geometry arrives as one base64 blob; surfaces hold { offset, count } refs into it.
function decodeGeometry(bundle) {
  const text = atob(bundle.geometry)
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
  return { ...bundle, f32: (ref) => new Float32Array(bytes.buffer, ref.offset, ref.count), u32: (ref) => new Uint32Array(bytes.buffer, ref.offset, ref.count) }
}

function readParams(p) {
  const vec = (v) => (v === undefined ? null : String(v).split(/[ ,]+/).map(Number))
  const pos = vec(p.pos)
  const angles = vec(p.angles)
  if (p.at !== undefined) {
    const e = findEntity(p.at)
    if (!e) throw new Error(`no entity matches "${p.at}"`)
    standAt(e)
  } else if (pos) {
    state.pos = [pos[0] || 0, pos[1] || 0, pos[2] ?? EYE_HEIGHT]
    state.angles = [0, 0, 0]
  } else placeDefault()
  if (angles) state.angles = [angles[0] || 0, angles[1] || 0, angles[2] || 0]
  if (p.look !== undefined) {
    const t = vec(p.look)
    const d = [t[0] - state.pos[0], t[1] - state.pos[1], (t[2] ?? state.pos[2]) - state.pos[2]]
    state.angles = [round(-Math.atan2(d[2], Math.hypot(d[0], d[1])) / d2r), round(Math.atan2(d[1], d[0]) / d2r), 0]
  }
  state.fov = +p.fov || 80
  state.top = on(p.top)
  state.span = +p.span || 0
  state.center = p.center !== undefined ? vec(p.center) : [state.pos[0], state.pos[1]]
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
  return map.entities.filter((e) => e.origin && test(e))[n] || null
}

function standAt(e) {
  state.pos = [e.origin[0], e.origin[1], e.origin[2] + EYE_HEIGHT]
  state.angles = e.angles ? [...e.angles] : [0, 0, 0]
}

// The first spawn, else above the map's south edge looking north.
function placeDefault() {
  const spawn = map.entities.find((e) => e.origin && /spawn|info_player_start/.test(e.classname))
  if (spawn) return standAt(spawn)
  const b = map.bounds
  state.pos = [(b.min[0] + b.max[0]) / 2, b.min[1] - 256, b.max[2] + 128]
  state.angles = [30, 90, 0]
}

function applyView() {
  world.setView(state)
  markers.setView(state)
  $('hud').style.display = $('legend').style.display = state.hud ? 'block' : 'none'
  needRender = true
}

// Top view: the whole map, or `span` units wide around `center` once zoomed.
function topWindow() {
  if (state.span) return { span: state.span, x: state.center[0], y: state.center[1] }
  const b = map.bounds
  return { span: Math.max(b.max[0] - b.min[0], (b.max[1] - b.min[1]) * innerWidth / innerHeight) * TOP_MARGIN, x: (b.min[0] + b.max[0]) / 2, y: (b.min[1] + b.max[1]) / 2 }
}

function updateCamera() {
  const aspect = innerWidth / innerHeight
  if (state.top) {
    const { span, x, y } = topWindow()
    Object.assign(ortho, { left: -span / 2, right: span / 2, top: span / aspect / 2, bottom: -span / aspect / 2 })
    ortho.position.copy(toThree(x, y, map.bounds.max[2] + 4096))
    ortho.up.set(0, 0, -1)
    ortho.lookAt(toThree(x, y, map.bounds.min[2]))
    ortho.updateProjectionMatrix()
    return ortho
  }
  const m = anglesToMatrix(state.angles)
  camera.position.copy(toThree(...state.pos))
  camera.up.copy(toThree(m[0][2], m[1][2], m[2][2]))
  camera.lookAt(camera.position.clone().add(toThree(...anglesToForward(state.angles))))
  // --fov is horizontal, like cg_fov; three.js takes the vertical one.
  camera.fov = (2 * Math.atan(Math.tan((state.fov * d2r) / 2) / aspect)) / d2r
  camera.aspect = aspect
  camera.updateProjectionMatrix()
  return camera
}

function renderLoop() {
  const cam = updateCamera()
  const moved = move()
  if (needRender || moved || world.loading()) {
    markers.hideNear(cam, state.top)
    renderer.render(scene, cam)
    markers.drawn(cam, state.top)
    updateTicks()
    updateHud()
    needRender = false
  } else markers.settle(cam, state.top)
  requestAnimationFrame(renderLoop)
}

// Coordinates along the top and left edges of the top view.
function updateTicks() {
  const ticks = $('ticks')
  ticks.replaceChildren()
  if (!state.top) return
  const width = ortho.right - ortho.left, height = ortho.top - ortho.bottom
  const step = [64, 128, 256, 512, 1024, 2048, 4096, 8192].find((s) => width / s <= 14) || 16384
  const [cx, cy] = fromThree(ortho.position)
  const x0 = cx - width / 2, y0 = cy - height / 2
  const tick = (text, left, top) => {
    const d = document.createElement('div')
    d.textContent = text
    Object.assign(d.style, { left: `${left}px`, top: `${top}px` })
    ticks.appendChild(d)
  }
  for (let x = Math.ceil(x0 / step) * step; x <= x0 + width; x += step) tick(x, ((x - x0) / width) * innerWidth + 2, 2)
  for (let y = Math.ceil(y0 / step) * step; y <= y0 + height; y += step) tick(y, 2, (1 - (y - y0) / height) * innerHeight - 14)
}

function updateHud() {
  if (!state.hud) return
  const cut = state.cut != null ? ` · cut z<=${state.cut}` : ''
  const view = state.top ? `top view${cut}` : `pos <b>${state.pos.map(round).join(' ')}</b> · angles <b>${state.angles.map(round).join(' ')}</b> · fov ${state.fov}${cut}`
  const cli = state.top
    ? `--top${state.span ? ` --center ${state.center.map(round).join(',')} --span ${round(state.span)}` : ''}`
    : `--pos ${state.pos.map(round).join(',')} --angles ${state.angles.map(round).join(',')}`
  $('hud').innerHTML = `${map.name} (${map.kind}) · ${view}\nrender: <b>${cli}</b>${state.cut != null ? ` --cut ${state.cut}` : ''}`
}

function move() {
  const now = performance.now(), dt = Math.min(0.1, (now - lastTime) / 1000)
  lastTime = now
  if (!keys.size) return false
  const speed = state.speed * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 4 : 1) * dt
  const y = state.angles[1] * d2r
  const fwd = anglesToForward(state.angles)
  const right = [Math.sin(y), -Math.cos(y), 0]
  let moved = false
  const step = (v, s) => { for (let k = 0; k < 3; k++) state.pos[k] += v[k] * s; moved = true }
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
    if (state.top) {
      const { span, x, y } = topWindow()
      Object.assign(state, { span: span * (e.deltaY > 0 ? 1.15 : 1 / 1.15), center: [x, y] })
    } else state.speed = Math.max(25, Math.min(6400, state.speed * (e.deltaY > 0 ? 0.8 : 1.25)))
    needRender = true
  })
  const toggles = { KeyL: 'labels', KeyE: 'entities', KeyT: 'textures', KeyG: 'grid', KeyK: 'tools', KeyM: 'lightmap', KeyH: 'hud', Digit1: 'top' }
  addEventListener('keydown', (e) => {
    if (e.repeat) return
    keys.add(e.code)
    if (toggles[e.code]) { state[toggles[e.code]] = e.code === 'KeyL' && e.shiftKey ? 'all' : !state[toggles[e.code]]; applyView() }
    if (e.code === 'Escape') document.exitPointerLock()
  })
  addEventListener('keyup', (e) => keys.delete(e.code))
  addEventListener('blur', () => keys.clear())
}

// Resolves once every texture is in and label occlusion matches the last frame.
function whenIdle() {
  return new Promise((resolve) => {
    const check = () => {
      if (world.loading()) return setTimeout(check, 50)
      needRender = true
      const settled = () => requestAnimationFrame(markers.settled() ? resolve : settled)
      requestAnimationFrame(() => requestAnimationFrame(settled))
    }
    check()
  })
}

function round(n) {
  return Math.round(n * 10) / 10
}
