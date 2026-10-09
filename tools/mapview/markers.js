// Entity markers, players at their spawns, and the labels; THREE comes from the page script. Labels hide behind walls, past LABEL_RANGE and where they would overlap.
import { toThree } from './draw.js'
import { d2r } from './math.js'

const SPAWN_BOX = { width: 30, height: 72 }
const ALLIED_COLOR = 0x3a86ff
const LABEL_RANGE = 2000
// Markers closer than this to the camera would fill the view, as when standing on a spawn.
const NEAR = 80
// Occlusion is read back from the GPU only once the view has been still this long.
const QUIET_MS = 150
// Entities without a marker: AI paths and actors.
const NO_MARKER = /^node_|^info_vehicle_node|^actor_/
// Entities whose label shows only with --labels all.
const SKIPPED = /^misc_model|^script_model|^misc_prefab|^info_null|^script_origin|^light$/
const ANONYMOUS = /^info_null|^script_origin/

// `players` stand in for the spawns of their classname, when the map has them.
export function createMarkers(map, renderer, scene, occluders, players) {
  const labelsDiv = document.getElementById('labels')
  const markers = new THREE.Group()
  const items = map.entities.filter((e) => e.origin && e.classname !== 'worldspawn' && !NO_MARKER.test(e.classname)).map(buildMarker)
  scene.add(markers)
  let dirty = true
  let changed = 0
  let visible = new Set()
  let occlusion = null

  return {
    setView(state) {
      labelsDiv.replaceChildren()
      if (state.labels && state.entities) for (const l of items) if (l.important || state.labels === 'all') labelsDiv.appendChild(l.div)
      markers.visible = state.entities
    },
    // Before drawing, so the frame never shows the markers around the camera.
    // A marker can bring its own test, given the camera's position relative to it.
    hideNear(cam, top) {
      const offset = new THREE.Vector3()
      for (const g of markers.children) {
        offset.subVectors(cam.position, g.position)
        g.visible = top || !(g.userData.hides ? g.userData.hides(offset) : offset.length() < NEAR)
      }
    },
    drawn(cam, top) {
      dirty = true
      changed = performance.now()
      place(cam, top)
    },
    settle(cam, top) {
      if (!dirty || performance.now() - changed < QUIET_MS) return
      visible = computeOcclusion(cam)
      dirty = false
      place(cam, top)
    },
    settled: () => !dirty,
  }

  function buildMarker(e) {
    const cls = e.classname
    let color = 0xaaaaaa
    let label = cls
    const group = new THREE.Group()
    group.position.copy(toThree(...e.origin))
    if (cls === players?.classname) {
      color = ALLIED_COLOR
      const player = players.create(e)
      group.add(player)
      group.userData.hides = player.userData.hides
    } else if (/spawn|info_player_start|intermission/.test(cls)) {
      color = /allied|allies|american|british|russian/.test(cls) ? ALLIED_COLOR : /axis|german/.test(cls) ? 0xff3355 : 0x2ec4b6
      const box = new THREE.Mesh(new THREE.BoxGeometry(SPAWN_BOX.width, SPAWN_BOX.height, SPAWN_BOX.width), new THREE.MeshBasicMaterial({ color, wireframe: true, fog: false }))
      box.position.y = SPAWN_BOX.height / 2
      const yaw = (e.angles ? e.angles[1] : 0) * d2r
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(8, 28, 8), new THREE.MeshBasicMaterial({ color, fog: false }))
      arrow.position.copy(toThree(Math.cos(yaw) * 34, Math.sin(yaw) * 34, 3))
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), toThree(Math.cos(yaw), Math.sin(yaw), 0).normalize())
      group.add(box, arrow)
    } else if (cls === 'light') {
      color = 0xffd166
      group.add(new THREE.Mesh(new THREE.SphereGeometry(8, 12, 8), new THREE.MeshBasicMaterial({ color, fog: false })))
      label = `light ${e.keys.intensity || ''}`
    } else if (/model/.test(cls) || cls === 'misc_prefab' || cls === 'misc_turret') {
      color = 0xff5dd0
      if (!map.models[e.keys.model]) group.add(new THREE.Mesh(new THREE.BoxGeometry(32, 32, 32), new THREE.MeshBasicMaterial({ color, wireframe: true, fog: false })))
      label = `${cls} ${(e.keys.model || '').split('/').pop()}`
    } else {
      group.add(new THREE.Mesh(new THREE.OctahedronGeometry(10), new THREE.MeshBasicMaterial({ color, fog: false })))
    }
    if (e.keys.targetname) label += ` [${e.keys.targetname}]`
    markers.add(group)
    const div = document.createElement('div')
    div.textContent = label
    div.style.color = `#${new THREE.Color(color).getHexString()}`
    const important = !SKIPPED.test(cls) || (e.keys.targetname && !ANONYMOUS.test(cls))
    return { div, pos: group.position.clone().add(new THREE.Vector3(0, 40, 0)), important }
  }

  // Nearest labels win; until occlusion is known after a change, every label in range counts as visible.
  function place(cam, top) {
    const v = new THREE.Vector3()
    const placed = []
    const shown = items.filter((l) => l.div.parentNode).map((l) => ({ l, d: l.pos.distanceTo(cam.position) })).sort((a, b) => a.d - b.d)
    for (const { l, d } of shown) {
      v.copy(l.pos).project(cam)
      let show = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 && (top || (d >= NEAR && d < LABEL_RANGE)) && (dirty || visible.has(l))
      if (show) {
        const x = ((v.x + 1) / 2) * innerWidth, y = ((1 - v.y) / 2) * innerHeight
        if (!l.size) {
          l.div.style.display = 'block'
          l.size = [l.div.offsetWidth, l.div.offsetHeight]
        }
        const [w, h] = l.size
        const rect = { x0: x - w / 2, x1: x + w / 2, y0: y - h, y1: y }
        show = !placed.some((r) => r.x0 < rect.x1 && r.x1 > rect.x0 && r.y0 < rect.y1 && r.y1 > rect.y0)
        if (show) { placed.push(rect); l.div.style.left = `${x}px`; l.div.style.top = `${y}px` }
      }
      l.div.style.display = show ? 'block' : 'none'
    }
  }

  // Draws the occluders' depth plus one coloured point per label into an offscreen target, then reads back which
  // points survived the depth test.
  function computeOcclusion(cam) {
    const w = innerWidth, h = innerHeight
    occlusion ??= { target: new THREE.WebGLRenderTarget(w, h), scene: new THREE.Scene(), depthMaterial: new THREE.MeshBasicMaterial({ color: 0x000000 }) }
    const o = occlusion
    if (o.target.width !== w || o.target.height !== h) o.target.setSize(w, h)
    const shown = items.filter((l) => l.div.parentNode)
    const positions = new Float32Array(shown.length * 3), colors = new Float32Array(shown.length * 3)
    shown.forEach((l, i) => {
      positions.set([l.pos.x, l.pos.y, l.pos.z], i * 3)
      const id = i + 1
      colors.set([(id & 255) / 255, ((id >> 8) & 255) / 255, ((id >> 16) & 255) / 255], i * 3)
    })
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const points = new THREE.Points(geom, new THREE.PointsMaterial({ size: 5, sizeAttenuation: false, vertexColors: true }))
    points.frustumCulled = false
    o.scene.overrideMaterial = o.depthMaterial
    o.scene.add(occluders)
    renderer.setRenderTarget(o.target)
    renderer.setClearColor(0x000000, 1)
    renderer.clear()
    renderer.render(o.scene, cam)
    o.scene.overrideMaterial = null
    scene.add(occluders)
    o.scene.add(points)
    renderer.autoClear = false
    renderer.render(o.scene, cam)
    renderer.autoClear = true
    o.scene.remove(points)
    const pixels = new Uint8Array(w * h * 4)
    renderer.readRenderTargetPixels(o.target, 0, 0, w, h, pixels)
    renderer.setRenderTarget(null)
    geom.dispose()
    const seen = new Set()
    const v = new THREE.Vector3()
    shown.forEach((l, i) => {
      v.copy(l.pos).project(cam)
      const x = Math.round(((v.x + 1) / 2) * w), y = Math.round(((v.y + 1) / 2) * h)
      if (x < 0 || y < 0 || x >= w || y >= h) return
      const k = (y * w + x) * 4
      if ((pixels[k] | (pixels[k + 1] << 8) | (pixels[k + 2] << 16)) === i + 1) seen.add(l)
    })
    return seen
  }
}
