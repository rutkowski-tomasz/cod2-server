// Effects on the page: fxview's simulation of an effect bundle (fxview/bundle.js), drawn with three.js the way fxview
// draws its particles. Left out: lights, effect models, distortion, soft edges against the ground and camera shake.
// THREE comes from the page script.
import { createSim } from '../fxview/sim.js'
import { particleQuad } from '../fxview/quads.js'

// From the material's blend, as fxview's shader: premultiplied add, alpha blend, or multiply by the colour.
const BLENDS = {
  add: { blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, mode: 1 },
  multiply: { blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor, mode: 2 },
  blend: { blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, mode: 0 },
}
// Lights light the world in game and emitters only spawn others; neither draws itself.
const DRAWN = new Set(['Particle', 'Cloud', 'Tail', 'Line', 'OrientedParticle', 'Decal'])
const VERTEX = `
  attribute vec4 rgba; varying vec2 vUv; varying vec4 vColor;
  void main() { vUv = uv; vColor = rgba; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`
const FRAGMENT = `
  uniform sampler2D map; uniform int mode; varying vec2 vUv; varying vec4 vColor;
  void main() {
    vec4 t = texture2D(map, vUv) * vColor;
    if (mode == 1) gl_FragColor = vec4(t.rgb * t.a, t.a);
    else if (mode == 2) gl_FragColor = vec4(mix(vec3(1.0), t.rgb, t.a), 1.0);
    else gl_FragColor = t;
  }`

// `scene` holds the effects played in the world.
export function createEffects(scene) {
  // Per effect bundle, its materials by name: { meta, material } once their image is in.
  const materials = new WeakMap()
  const playing = []
  // Effects played in the world, in CoD's frame.
  const world = new THREE.Group()
  world.rotation.x = -Math.PI / 2
  scene.add(world)

  return {
    // Plays the effect bundle `effect` from `origin` with its forward along `forward`, both in `parent`'s frame, which
    // must be CoD's (Z up), such as a bone of an actor, or the world's without one. Its particles bounce on the plane
    // `ground` units above the origin, none without. The effect moves with `parent` and ends when it does. A hidden
    // page draws no frames, so what it would play there is dropped rather than piled up.
    play(effect, parent, origin, forward, ground = null) {
      if (document.hidden) return
      const holder = new THREE.Group()
      holder.position.fromArray(origin)
      const into = parent ?? world
      into.add(holder)
      const sim = createSim(effect, { forward, ground, seed: Math.floor(Math.random() * 2 ** 31) })
      playing.push({ effect, sim, holder, meshes: new Map(), start: performance.now() })
    },
    // Moves every effect on and builds its quads for `cam`; true while any plays, so the page has to draw again.
    update(cam) {
      const now = performance.now()
      for (let i = playing.length - 1; i >= 0; i--) {
        const e = playing[i]
        if (now - e.start > e.sim.duration || !inScene(e.holder)) {
          remove(e)
          playing.splice(i, 1)
          continue
        }
        e.sim.seek(now - e.start)
        draw(e, cam)
      }
      return playing.length > 0
    },
  }

  function draw(e, cam) {
    // A bone's place this frame is only worked out when the frame draws.
    e.holder.updateWorldMatrix(true, false)
    const inverse = e.holder.getWorldQuaternion(new THREE.Quaternion()).invert()
    const local = (v) => v.applyQuaternion(inverse).toArray()
    const eye = e.holder.worldToLocal(cam.getWorldPosition(new THREE.Vector3())).toArray()
    const right = local(new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion))
    const up = local(new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion))
    const mats = materialsOf(e.effect)
    const drawable = { hasTexture: (name) => !!mats[name]?.material, hasModel: () => false }
    const quads = new Map()
    for (const p of e.sim.particles) {
      if (p.spawnTime > e.sim.time || !DRAWN.has(p.type)) continue
      const q = particleQuad(p, eye, right, up, drawable)
      if (!q || q.tex === 'missing' || mats[q.tex]?.meta.blend === 'distortion') continue
      if (!quads.has(q.tex)) quads.set(q.tex, [])
      quads.get(q.tex).push(q)
    }
    for (const [tex, mesh] of e.meshes) if (!quads.has(tex)) mesh.visible = false
    for (const [tex, list] of quads) {
      const { meta, material } = mats[tex]
      if (!e.meshes.has(tex)) {
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material)
        mesh.frustumCulled = false
        e.meshes.set(tex, mesh)
        e.holder.add(mesh)
      }
      const mesh = e.meshes.get(tex)
      mesh.visible = true
      fill(mesh.geometry, list, meta, eye)
    }
  }

  // The quads far to near, as one indexed list of four corners each.
  function fill(geometry, quads, meta, eye) {
    const depth = (q) => -Math.hypot(...q.corners[0].map((c, k) => c - eye[k]))
    quads.sort((a, b) => depth(a) - depth(b))
    const positions = new Float32Array(quads.length * 12)
    const uvs = new Float32Array(quads.length * 8)
    const colors = new Float32Array(quads.length * 16)
    const indices = new Uint32Array(quads.length * 6)
    quads.forEach((q, n) => {
      const cols = meta.atlasCols, rows = meta.atlasRows
      const fx = q.frame % cols, fy = Math.floor(q.frame / cols) % rows
      const corners = [[fx / cols, (fy + 1) / rows], [(fx + 1) / cols, (fy + 1) / rows], [(fx + 1) / cols, fy / rows], [fx / cols, fy / rows]]
      for (let k = 0; k < 4; k++) {
        positions.set(q.corners[k], (n * 4 + k) * 3)
        uvs.set(corners[k], (n * 4 + k) * 2)
        colors.set(q.color, (n * 4 + k) * 4)
      }
      indices.set([0, 1, 2, 0, 2, 3].map((v) => v + n * 4), n * 6)
    })
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    geometry.setAttribute('rgba', new THREE.BufferAttribute(colors, 4))
    geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  }

  function remove(e) {
    e.holder.removeFromParent()
    for (const mesh of e.meshes.values()) mesh.geometry.dispose()
  }

  // An effect's materials, loading their images on first use; a material draws once its image is in.
  function materialsOf(effect) {
    if (!materials.has(effect)) {
      const byName = {}
      for (const [name, meta] of Object.entries(effect.materials)) {
        byName[name] = { meta, material: null }
        new THREE.TextureLoader().load(meta.png, (texture) => {
          // fxview uploads images unflipped, and its atlas frames count rows from the top.
          texture.flipY = false
          texture.needsUpdate = true
          byName[name].material = materialOf(meta, texture)
        })
      }
      materials.set(effect, byName)
    }
    return materials.get(effect)
  }
}

// False once the object or what it hangs from, such as an actor, has left the scene.
function inScene(object) {
  let top = object
  while (top.parent) top = top.parent
  return top.isScene
}

function materialOf(meta, map) {
  const { mode, ...blend } = BLENDS[meta.blend] ?? BLENDS.blend
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, mode: { value: mode } },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    ...blend,
  })
}
