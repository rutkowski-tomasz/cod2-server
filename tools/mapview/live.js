// Players streamed from a game server through the livemap relay (stacks/livemap); THREE comes from the page script.
// Each update moves a player from where it is drawn to its new position over one update interval, so it glides.
import { toThree, fromThree } from './draw.js'
import { d2r } from './math.js'

// The server sends 10 updates a second.
const UPDATE_MS = 100
// Further than this in one update is a spawn or teleport, so the player jumps.
const TELEPORT = 300
const STALE_MS = 3000
const RECONNECT_MS = 2000
// How long a headless render waits for the first update before it shoots without one.
const READY_TIMEOUT_MS = 10000
// Kills older than this leave the history the director reads.
const KILL_HISTORY_MS = 60000
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
  const assets = { rigs: new Map(), weapons: new Map(), anims: new Map() }
  let lastMessage = 0
  let connected = false
  // Messages wait here for `delay` ms before they play, so the director sees what is coming.
  const queue = []
  let delay = 0
  const kills = []
  let note = ''
  // A removal must reach the screen even when no players are left to keep the page drawing.
  let removed = false
  let markReady
  const ready = new Promise((resolve) => { markReady = resolve })
  setTimeout(markReady, READY_TIMEOUT_MS)
  connect()

  return {
    // Resolves with the first update for this map, or after READY_TIMEOUT_MS without one.
    ready,
    // Moves the players on, and hides the one named `follow` whose eyes the camera is in; true while any are shown,
    // so the page has to draw again.
    animate(follow) {
      const now = performance.now()
      while (queue.length && queue[0].at <= now - delay) receive(queue.shift().msg)
      for (const p of shown.values()) {
        const t = Math.min(1, (now - p.start) / UPDATE_MS)
        p.group.position.lerpVectors(p.from, p.to, t)
        p.group.rotation.y = p.fromYaw + shortestTurn(p.fromYaw, p.toYaw) * t
        p.pitch = p.fromPitch + (p.toPitch - p.fromPitch) * t
        p.eye.lerpVectors(p.fromEye, p.toEye, t)
        p.group.visible = p.name !== follow
      }
      updateStatus(now)
      const redraw = shown.size > 0 || removed
      removed = false
      return redraw
    },
    // Where the player named `name` sees from this frame: { pos, angles } in CoD's frame, or null when not shown.
    eyeOf(name) {
      const p = [...shown.values()].find((q) => q.name === name)
      if (!p) return null
      return { pos: fromThree(p.group.position.clone().add(p.eye)), angles: [p.pitch, p.group.rotation.y / d2r, 0] }
    },
    // Plays the stream `ms` behind; 0 plays what is waiting at once.
    setDelay(ms) {
      delay = ms
      if (!ms) while (queue.length) receive(queue.shift().msg)
    },
    // Text after the status, such as what the director watches.
    setNote(text) {
      note = text
    },
    // The players shown: { id, name, team, origin } with the origin they are heading to, in CoD's frame.
    roster: () => [...shown.entries()].map(([id, p]) => ({ id, name: p.name, team: p.team, origin: fromThree(p.to) })),
    // Kills played in the last KILL_HISTORY_MS, oldest first: { attacker, victim, at } by player id, `attacker`
    // undefined for a death without one; `at` in performance.now() time.
    kills: () => kills,
    // Kills still waiting to play, with `at` the time they will.
    upcomingKills: () => queue.flatMap((q) => Object.values(q.msg.kills ?? {}).map((k) => ({ ...k, at: q.at + delay }))),
    // Name labels over every player, walls or not, since following players is the point.
    place(cam) {
      const v = new THREE.Vector3()
      for (const p of shown.values()) {
        v.copy(p.group.position).setY(p.group.position.y + 80).project(cam)
        const show = p.group.visible && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05
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
    // Also plays what is due here, as a hidden tab draws no frames and would otherwise queue messages for hours.
    ws.onmessage = (e) => {
      lastMessage = performance.now()
      queue.push({ at: lastMessage, msg: JSON.parse(e.data) })
      while (queue.length && queue[0].at <= lastMessage - delay) receive(queue.shift().msg)
    }
  }

  // { map, players: [{ id, name, team, origin, view, pitch, yaw, models, weapon, legs, torso }], kills: [{ attacker,
  // victim }] }: `view` is the eye, `legs` and `torso` the player animations playing, `kills` the deaths since the
  // last message. The server sends an empty list as {}.
  function receive(msg) {
    if (msg.map !== map.name) return onMapChange(msg.map)
    const now = performance.now()
    for (const k of Object.values(msg.kills ?? {})) kills.push({ ...k, at: now })
    while (kills.length && kills[0].at < now - KILL_HISTORY_MS) kills.shift()
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
    const p = {
      group: g, material, label, model: null, modelsKey: null, weapon: null, weaponName: null, anims: null, legsName: null, torsoName: null,
      from: new THREE.Vector3(), to: new THREE.Vector3(), fromYaw: 0, toYaw: 0, pitch: 0, fromPitch: 0, toPitch: 0,
      eye: new THREE.Vector3(), fromEye: new THREE.Vector3(), toEye: new THREE.Vector3(), start: 0, fresh: true,
    }
    if (players) wear(p, players.createLive())
    shown.set(id, p)
    return p
  }

  function update(p, { name, team, origin, view, pitch, yaw, models, weapon, legs, torso }) {
    const key = models.join(',')
    if (players && key !== p.modelsKey) {
      p.modelsKey = key
      assetOf('rigs', key).then((rig) => { if (rig && p.modelsKey === key && p.group.parent) wear(p, players.createLive(rig)) })
    }
    if (players && weapon !== p.weaponName) {
      p.weaponName = weapon
      assetOf('weapons', weapon).then((w) => {
        if (p.weaponName !== weapon || !p.group.parent) return
        p.weapon = w
        players.hold(p.model, w)
      })
    }
    if (players && (legs !== p.legsName || torso !== p.torsoName)) {
      p.legsName = legs
      p.torsoName = torso
      Promise.all([assetOf('anims', legs), assetOf('anims', torso)]).then((anims) => {
        if (p.legsName !== legs || p.torsoName !== torso || !p.group.parent) return
        p.anims = anims
        players.pose(p.model, ...anims)
      })
    }
    const to = toThree(...origin)
    const jump = p.fresh || to.distanceTo(p.group.position) > TELEPORT
    // The eye relative to the feet, so it glides with them.
    const eye = toThree(...view).sub(to)
    p.from.copy(jump ? to : p.group.position)
    p.fromYaw = jump ? yaw * d2r : p.group.rotation.y
    p.fromPitch = jump ? pitch : p.pitch
    p.fromEye.copy(jump ? eye : p.eye)
    p.to.copy(to)
    p.toYaw = yaw * d2r
    p.toPitch = pitch
    p.toEye.copy(eye)
    p.start = performance.now()
    p.fresh = false
    const color = TEAM_COLORS[team] ?? OTHER_COLOR
    p.material.color.setHex(color)
    p.team = team
    p.name = name.replace(/\^\d/g, '')
    p.label.textContent = p.name
    p.label.style.color = `#${new THREE.Color(color).getHexString()}`
  }

  function wear(p, model) {
    if (p.model) players.remove(p.model)
    p.group.add(model)
    p.model = model
    if (p.weapon) players.hold(model, p.weapon)
    if (p.anims) players.pose(model, ...p.anims)
  }

  // A player's rig, weapon or animation (`kind` rigs, weapons or anims) by key: baked into the page, or fetched from the live server.
  // Null when the live server cannot build it, or the page has no live server to ask.
  function assetOf(kind, key) {
    const cache = assets[kind]
    if (!cache.has(key)) {
      cache.set(key, map[kind] && key in map[kind] ? Promise.resolve(map[kind][key])
        : location.protocol.startsWith('http') ? fetch(`${kind}?key=${encodeURIComponent(key)}`).then((r) => (r.ok ? r.json() : null))
          : Promise.resolve(null))
    }
    return cache.get(key)
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
        : `live · ${shown.size} player${shown.size === 1 ? '' : 's'}${note && ` · ${note}`}`
    if (status.textContent !== text) status.textContent = text
  }
}

// The signed turn from `a` to `b` radians that is at most half a circle.
function shortestTurn(a, b) {
  return ((((b - a) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI
}
