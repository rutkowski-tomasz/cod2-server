// Players streamed from a game server through the livemap relay (stacks/livemap); THREE comes from the page script.
// Each update moves a player from where it is drawn to its new position over one update interval, so it glides.
import { toThree } from './draw.js'
import { d2r } from './math.js'

// The server sends 10 updates a second.
const UPDATE_MS = 100
// Further than this in one update is a spawn or teleport, so the player jumps.
const TELEPORT = 300
const STALE_MS = 3000
const RECONNECT_MS = 2000
// How long a headless render waits for the first update before it shoots without one.
const READY_TIMEOUT_MS = 10000
const TEAM_COLORS = { allies: 0x3a86ff, axis: 0xff3355 }
const OTHER_COLOR = 0x2ec4b6

// `players` draws each player's model; without the model in the sources it is null, and players are only their
// rings and arrows. Each player wears the default model until the rig of the models it streams arrives: baked into
// the page (`map.rigs`) or fetched from the live server. `onMapChange` gets the server's map once it differs.
export function createLive(map, scene, players, url, onMapChange) {
  const ring = new THREE.RingGeometry(20, 28, 24)
  const cone = new THREE.ConeGeometry(8, 28, 8)
  const labelsDiv = document.getElementById('live-labels')
  const status = document.getElementById('live')
  const group = new THREE.Group()
  scene.add(group)
  const shown = new Map()
  const rigs = new Map()
  let lastMessage = 0
  let connected = false
  // A removal must reach the screen even when no players are left to keep the page drawing.
  let removed = false
  let markReady
  const ready = new Promise((resolve) => { markReady = resolve })
  setTimeout(markReady, READY_TIMEOUT_MS)
  connect()

  return {
    // Resolves with the first update for this map, or after READY_TIMEOUT_MS without one.
    ready,
    // Moves the players on; true while any are shown, so the page has to draw again.
    animate() {
      const now = performance.now()
      for (const p of shown.values()) {
        const t = Math.min(1, (now - p.start) / UPDATE_MS)
        p.group.position.lerpVectors(p.from, p.to, t)
        p.group.rotation.y = p.fromYaw + shortestTurn(p.fromYaw, p.toYaw) * t
      }
      updateStatus(now)
      const redraw = shown.size > 0 || removed
      removed = false
      return redraw
    },
    // Name labels over every player, walls or not, since following players is the point.
    place(cam) {
      const v = new THREE.Vector3()
      for (const p of shown.values()) {
        v.copy(p.group.position).setY(p.group.position.y + 80).project(cam)
        const show = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05
        p.label.style.display = show ? 'block' : 'none'
        if (show) Object.assign(p.label.style, { left: `${((v.x + 1) / 2) * innerWidth}px`, top: `${((1 - v.y) / 2) * innerHeight}px` })
      }
    },
  }

  function connect() {
    const ws = new WebSocket(url)
    ws.onopen = () => { connected = true }
    ws.onclose = () => {
      connected = false
      setTimeout(connect, RECONNECT_MS)
    }
    ws.onmessage = (e) => receive(JSON.parse(e.data))
  }

  // { map, players: [{ id, name, team, origin, yaw, models }] }; the server sends an empty players list as {}.
  function receive(msg) {
    lastMessage = performance.now()
    if (msg.map !== map.name) return onMapChange(msg.map)
    const seen = new Set()
    for (const p of Object.values(msg.players)) {
      seen.add(p.id)
      update(shown.get(p.id) ?? add(p.id), p)
    }
    for (const [id, p] of shown) if (!seen.has(id)) remove(id, p)
    markReady()
  }

  function add(id) {
    const g = new THREE.Group()
    const material = new THREE.MeshBasicMaterial({ fog: false })
    const disc = new THREE.Mesh(ring, material)
    disc.rotation.x = -Math.PI / 2
    disc.position.y = 2
    const arrow = new THREE.Mesh(cone, material)
    arrow.rotation.z = -Math.PI / 2
    arrow.position.set(42, 2, 0)
    g.add(disc, arrow)
    group.add(g)
    const label = document.createElement('div')
    labelsDiv.appendChild(label)
    const p = { group: g, model: null, modelsKey: null, material, label, from: new THREE.Vector3(), to: new THREE.Vector3(), fromYaw: 0, toYaw: 0, start: 0, fresh: true }
    if (players) wear(p, players.createLive())
    shown.set(id, p)
    return p
  }

  function update(p, { name, team, origin, yaw, models }) {
    const key = models.join(',')
    if (players && key !== p.modelsKey) {
      p.modelsKey = key
      rigOf(key).then((rig) => { if (rig && p.modelsKey === key && p.group.parent) wear(p, players.createLive(rig)) })
    }
    const to = toThree(...origin)
    const jump = p.fresh || to.distanceTo(p.group.position) > TELEPORT
    p.from.copy(jump ? to : p.group.position)
    p.fromYaw = jump ? yaw * d2r : p.group.rotation.y
    p.to.copy(to)
    p.toYaw = yaw * d2r
    p.start = performance.now()
    p.fresh = false
    const color = TEAM_COLORS[team] ?? OTHER_COLOR
    p.material.color.setHex(color)
    p.label.textContent = name.replace(/\^\d/g, '')
    p.label.style.color = `#${new THREE.Color(color).getHexString()}`
  }

  function wear(p, model) {
    if (p.model) players.remove(p.model)
    p.group.add(model)
    p.model = model
  }

  // Null when the live server cannot build it, or the page has no live server to ask.
  function rigOf(key) {
    if (!rigs.has(key)) {
      const rig = map.rigs && key in map.rigs ? Promise.resolve(map.rigs[key])
        : location.protocol.startsWith('http') ? fetch(`rig?models=${encodeURIComponent(key)}`).then((r) => (r.ok ? r.json() : null))
          : Promise.resolve(null)
      rigs.set(key, rig)
    }
    return rigs.get(key)
  }

  function remove(id, p) {
    if (p.model) players.remove(p.model)
    p.group.removeFromParent()
    p.material.dispose()
    p.label.remove()
    shown.delete(id)
    removed = true
  }

  function updateStatus(now) {
    const text = !connected ? `live · connecting to ${url}`
      : now - lastMessage > STALE_MS ? `live · no data from ${url}`
        : `live · ${shown.size} player${shown.size === 1 ? '' : 's'}`
    if (status.textContent !== text) status.textContent = text
  }
}

// The signed turn from `a` to `b` radians that is at most half a circle.
function shortestTurn(a, b) {
  return ((((b - a) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI
}
