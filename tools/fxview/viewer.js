import { createSim } from './sim.js'
import { createRenderer, cameraEye, V } from './draw.js'

const bundle = JSON.parse(document.getElementById('bundle').textContent)
const params = { ...(bundle.defaults ?? {}), ...Object.fromEntries(new URLSearchParams(location.hash.slice(1))) }
const canvas = document.getElementById('gl')
const $ = (id) => document.getElementById(id)
const BG = { dark: 0.125, mid: 0.45, light: 0.8, black: 0 }

// ---------- element keys, hidden set ----------
let elementIndex = 0
for (const effect of Object.values(bundle.effects)) for (const def of effect.elements) def.key = `${effect.path.split('/').pop()}:${def.name}#${elementIndex++}`
const hidden = new Set()

// ---------- state ----------
const state = {
  playing: params.t === undefined,
  speed: 1,
  loop: true,
  forward: params.forward ?? 'z',
  seed: Number(params.seed ?? 1),
  ground: params.ground === 'off' ? null : 0,
  bg: BG[params.bg ?? 'dark'],
  grid: params.grid !== 'off',
  player: params.player !== 'off',
}
let sim = makeSim()
const cam = { target: [0, 0, 40], dist: 400, yaw: 35, pitch: 18, fov: 60 }

const renderer = createRenderer(canvas, bundle.materials)

function makeSim() {
  return createSim(bundle, { seed: state.seed, forward: state.forward, ground: state.ground })
}

function render() {
  renderer.render({ sim, cam, state, hidden })
}

// ---------- camera fit ----------
// Frames the bulk of the effect: a few stray particles flying far away must not shrink everything else.
function fit() {
  const b = sim.bounds()
  cam.target = b.center
  const radius = Math.max(64, b.radius)
  cam.dist = (radius / Math.tan((cam.fov * Math.PI) / 360)) * 1.15
}

// ---------- UI ----------
function buildElementList() {
  const box = $('elements')
  box.innerHTML = ''
  for (const effect of Object.values(bundle.effects)) {
    const h = document.createElement('div')
    h.style.color = '#aaa'
    h.style.marginTop = '6px'
    h.textContent = effect.path
    box.appendChild(h)
    for (const def of effect.elements) {
      const label = document.createElement('label')
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.checked = !hidden.has(def.key)
      cb.onchange = () => { cb.checked ? hidden.delete(def.key) : hidden.add(def.key) }
      label.appendChild(cb)
      label.appendChild(document.createTextNode(` ${def.type} ${def.name} `))
      const n = document.createElement('span')
      n.className = 'n'
      n.dataset.key = def.key
      label.appendChild(n)
      label.title = `${def.type} ${def.name}\nshaders: ${def.shaders.join(', ') || '-'}\nmodels: ${def.models.join(', ') || '-'}\nlife ${def.life} delay ${def.delay} count ${def.count}\nflags: ${def.flags.join(' ')}\nspawn: ${def.spawnFlags.join(' ')}`
      box.appendChild(label)
    }
  }
}
function updateUi() {
  $('time').max = Math.ceil(sim.activeDuration)
  $('time').value = Math.min(sim.time, sim.activeDuration)
  const live = sim.particles.filter((p) => p.spawnTime <= sim.time).length
  $('stats').textContent = `t = ${Math.round(sim.time)} ms / ${Math.round(sim.activeDuration)} ms (full ${Math.round(sim.duration)}) · ${live} particles · ${sim.instances} effect instances${sim.dropped ? ` · ${sim.dropped} dropped` : ''}`
  const counts = {}
  for (const p of sim.particles) if (p.spawnTime <= sim.time) counts[p.def.key] = (counts[p.def.key] ?? 0) + 1
  for (const n of document.querySelectorAll('#elements .n')) n.textContent = counts[n.dataset.key] ?? ''
  const warn = [...sim.warnings]
  if (bundle.missing.materials.length) warn.push(`missing materials: ${bundle.missing.materials.join(', ')}`)
  if (bundle.missing.images.length) warn.push(`missing images: ${bundle.missing.images.join(', ')}`)
  if (bundle.missing.effects.length) warn.push(`missing effects: ${bundle.missing.effects.join(', ')}`)
  if (bundle.missing.models.length) warn.push(`models drawn as gray boxes: ${bundle.missing.models.join(', ')}`)
  $('warn').textContent = warn.join('\n')
}
$('title').textContent = bundle.root
$('play').onclick = () => { state.playing = !state.playing; $('play').textContent = state.playing ? 'Pause' : 'Play' }
$('restart').onclick = () => { sim.reset() }
$('fit').onclick = fit
$('time').oninput = (e) => { state.playing = false; $('play').textContent = 'Play'; sim.seek(Number(e.target.value)) }
$('speed').onchange = (e) => { state.speed = Number(e.target.value) }
$('loop').onchange = (e) => { state.loop = e.target.checked }
$('forward').value = state.forward
$('forward').onchange = (e) => { state.forward = e.target.value; sim = makeSim(); fit() }
$('seed').value = state.seed
$('seed').onchange = (e) => { state.seed = Number(e.target.value); sim = makeSim() }
$('ground').value = state.ground === null ? 'off' : '0'
$('ground').onchange = (e) => { state.ground = e.target.value === 'off' ? null : 0; sim = makeSim() }
$('bg').value = params.bg ?? 'dark'
$('bg').onchange = (e) => { state.bg = BG[e.target.value] }
$('grid').checked = state.grid
$('grid').onchange = (e) => { state.grid = e.target.checked }
$('player').checked = state.player
$('player').onchange = (e) => { state.player = e.target.checked }
buildElementList()

let drag = null
canvas.onmousedown = (e) => { drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey } }
window.onmouseup = () => { drag = null }
window.onmousemove = (e) => {
  if (!drag) return
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y
  drag.x = e.clientX; drag.y = e.clientY
  if (drag.pan) {
    const eye = cameraEye(cam)
    const fwd = V.norm(V.sub(cam.target, eye))
    const right = V.norm(V.cross(fwd, [0, 0, 1]))
    const up = V.cross(right, fwd)
    const k = cam.dist * 0.0015
    cam.target = V.add(cam.target, V.add(V.mul(right, -dx * k), V.mul(up, dy * k)))
  } else {
    cam.yaw -= dx * 0.4
    cam.pitch = Math.max(-89, Math.min(89, cam.pitch + dy * 0.4))
  }
}
canvas.onwheel = (e) => { cam.dist = Math.max(10, Math.min(20000, cam.dist * Math.exp(e.deltaY * 0.001))); e.preventDefault() }
window.onkeydown = (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return
  if (e.code === 'Space') { $('play').click(); e.preventDefault() }
  if (e.code === 'ArrowRight') { state.playing = false; sim.seek(sim.time + 50) }
  if (e.code === 'ArrowLeft') { state.playing = false; sim.seek(Math.max(0, sim.time - 50)) }
  if (e.key === 'h') document.body.classList.toggle('hideui')
}

function resize() {
  const uiWidth = document.body.classList.contains('hideui') ? 0 : 260
  canvas.width = Math.max(1, window.innerWidth - uiWidth)
  canvas.height = Math.max(1, window.innerHeight)
}
window.onresize = resize

// ---------- loop ----------
let last = performance.now()
let fpsAcc = 0
let fpsFrames = 0
function frame(now) {
  const dt = Math.min(100, now - last)
  fpsAcc += now - last
  fpsFrames++
  if (fpsAcc >= 500) { $('fps').textContent = `${Math.round((fpsFrames * 1000) / fpsAcc)} fps`; fpsAcc = 0; fpsFrames = 0 }
  last = now
  if (state.playing) {
    const t = sim.time + dt * state.speed
    if (t > sim.activeDuration + 400) { if (state.loop) sim.reset(); else state.playing = false }
    else sim.seek(t)
  }
  render()
  updateUi()
  requestAnimationFrame(frame)
}

// ---------- headless API ----------
// Renders the given times into one labelled contact sheet and returns it as a PNG data URL.
window.efx = {
  sim: () => sim,
  hidden,
  state,
  cam,
  seek: (t) => { sim.seek(t); render(); updateUi() },
  fit,
  setCamera: ({ yaw, pitch, dist, target }) => { if (yaw !== undefined) cam.yaw = yaw; if (pitch !== undefined) cam.pitch = pitch; if (dist !== undefined) cam.dist = dist; if (target) cam.target = target },
  counts: () => sim.counts(),
  info: () => ({ duration: sim.duration, activeDuration: sim.activeDuration, bounds: sim.bounds(), warnings: [...sim.warnings], missing: bundle.missing, instances: sim.instances }),
  capture: ({ times, cols = 4, width = 480, height = 360 }) => {
    state.playing = false
    document.body.classList.add('hideui')
    canvas.width = width
    canvas.height = height
    const rows = Math.ceil(times.length / cols)
    const sheet = document.createElement('canvas')
    sheet.width = cols * width
    sheet.height = rows * height
    const ctx = sheet.getContext('2d')
    const frames = []
    times.forEach((t, i) => {
      sim.seek(t)
      render()
      const x = (i % cols) * width, y = Math.floor(i / cols) * height
      ctx.drawImage(canvas, x, y)
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(x, y, 110, 18)
      ctx.fillStyle = '#fff'
      ctx.font = '13px monospace'
      ctx.fillText(`t = ${Math.round(t)} ms`, x + 4, y + 13)
      ctx.strokeStyle = '#000'
      ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1)
      frames.push({ t, counts: sim.counts() })
    })
    document.body.classList.remove('hideui')
    resize()
    return { png: sheet.toDataURL('image/png'), frames }
  },
}

renderer.ready.then(() => {
  resize()
  if (params.cam) { const [yaw, pitch, dist] = params.cam.split(',').map(Number); Object.assign(cam, { yaw, pitch, dist }) } else fit()
  if (params.t !== undefined) sim.seek(Number(params.t))
  window.efxReady = true
  requestAnimationFrame(frame)
})
