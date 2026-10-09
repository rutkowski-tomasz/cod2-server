// WebGL drawing: reference lines, then opaque models, then particles far to near, batched by material.
import { sampleVisual, modelAxis } from './sim.js'

export const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] },
}
function perspective(fovDeg, aspect, near, far) {
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360)
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]
}
function lookAt(eye, target, up) {
  const z = V.norm(V.sub(eye, target))
  const x = V.norm(V.cross(up, z))
  const y = V.cross(z, x)
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -V.dot(x, eye), -V.dot(y, eye), -V.dot(z, eye), 1]
}
function mat4mul(a, b) {
  const o = new Array(16)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
  return o
}
export function cameraEye(cam) {
  const yaw = (cam.yaw * Math.PI) / 180
  const pitch = (cam.pitch * Math.PI) / 180
  return V.add(cam.target, [Math.cos(pitch) * Math.cos(yaw) * cam.dist, Math.cos(pitch) * Math.sin(yaw) * cam.dist, Math.sin(pitch) * cam.dist])
}

export function createRenderer(canvas, { materials, models }) {
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: true, alpha: false })
  // ---------- textures ----------
  const textures = {}
  const materialMeta = {}
  function solidTexture(w, h, fill) {
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    const ctx = c.getContext('2d')
    fill(ctx, w, h)
    return uploadTexture(c)
  }
  function uploadTexture(src) {
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return tex
  }
  textures.white = solidTexture(2, 2, (ctx, w, h) => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h) })
  textures.missing = solidTexture(64, 64, (ctx, w, h) => { ctx.fillStyle = '#f0f'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w / 2, h / 2); ctx.fillRect(w / 2, h / 2, w / 2, h / 2) })
  textures.light = solidTexture(128, 128, (ctx, w, h) => { const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h) })
  textures.model = solidTexture(32, 32, (ctx, w, h) => { ctx.fillStyle = '#9a9a9a'; ctx.fillRect(2, 2, w - 4, h - 4); ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.strokeRect(3, 3, w - 6, h - 6) })
  materialMeta.white = materialMeta.missing = materialMeta.model = { blend: 'blend', atlasCols: 1, atlasRows: 1 }
  materialMeta.light = { blend: 'add', atlasCols: 1, atlasRows: 1 }
  const textureLoads = Object.entries(materials).map(([name, m]) => new Promise((resolve) => {
    const img = new Image()
    img.onload = () => { textures[name] = uploadTexture(img); materialMeta[name] = m; resolve() }
    img.onerror = resolve
    img.src = m.png
  }))

  // ---------- shaders ----------
  function createProgram(vertex, fragment) {
    const program = gl.createProgram()
    for (const [type, src] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
      const sh = gl.createShader(type)
      gl.shaderSource(sh, `#version 300 es\n${src}`)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh))
      gl.attachShader(program, sh)
    }
    gl.linkProgram(program)
    return program
  }
  const program = createProgram(`
    layout(location = 0) in vec3 pos; layout(location = 1) in vec2 uv; layout(location = 2) in vec4 col; uniform mat4 vp; out vec2 vUv; out vec4 vCol;
    void main() { gl_Position = vp * vec4(pos, 1.0); vUv = uv; vCol = col; }`, `
    precision mediump float; in vec2 vUv; in vec4 vCol; uniform sampler2D tex; uniform int mode; out vec4 o;
    void main() {
      vec4 t = texture(tex, vUv) * vCol;
      if (mode == 1) o = vec4(t.rgb * t.a, t.a);          // additive, premultiplied
      else if (mode == 2) o = vec4(mix(vec3(1.0), t.rgb, t.a), 1.0); // multiply
      else o = t;
    }`)
  const uVp = gl.getUniformLocation(program, 'vp')
  const uMode = gl.getUniformLocation(program, 'mode')
  // Models get a fixed light from above so their shape reads without the level's lighting.
  const meshProgram = createProgram(`
    layout(location = 0) in vec3 pos; layout(location = 1) in vec3 nrm; layout(location = 2) in vec2 uv;
    uniform mat4 vp; uniform mat4 model; out vec2 vUv; out float vLight;
    void main() {
      gl_Position = vp * model * vec4(pos, 1.0);
      vUv = uv;
      vLight = 0.5 + 0.5 * max(dot(normalize(mat3(model) * nrm), normalize(vec3(0.4, 0.3, 0.85))), 0.0);
    }`, `
    precision mediump float; in vec2 vUv; in float vLight; uniform sampler2D tex; out vec4 o;
    void main() { o = vec4(texture(tex, vUv).rgb * vLight, 1.0); }`)
  const uMeshVp = gl.getUniformLocation(meshProgram, 'vp')
  const uMeshModel = gl.getUniformLocation(meshProgram, 'model')
  const vbo = gl.createBuffer()
  const ibo = gl.createBuffer()
  const vao = gl.createVertexArray()
  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
  const STRIDE = 9 * 4
  for (const [i, size, offset] of [[0, 3, 0], [1, 2, 12], [2, 4, 20]]) { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, size, gl.FLOAT, false, STRIDE, offset) }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo)
  let verts = new Float32Array(9 * 4 * 4096)
  let indices = new Uint32Array(6 * 4096)
  function ensureCapacity(quads) {
    if (indices.length >= quads * 6) return
    verts = new Float32Array(9 * 4 * quads)
    indices = new Uint32Array(6 * quads)
  }
  function fillIndices(quads) {
    for (let q = 0; q < quads; q++) { const v = q * 4, i = q * 6; indices[i] = v; indices[i + 1] = v + 1; indices[i + 2] = v + 2; indices[i + 3] = v; indices[i + 4] = v + 2; indices[i + 5] = v + 3 }
  }

  // ---------- model meshes ----------
  const meshes = {}
  for (const [name, model] of Object.entries(models)) meshes[name] = model.surfaces.map((s) => {
    const meshVao = gl.createVertexArray()
    gl.bindVertexArray(meshVao)
    for (const [i, data, size] of [[0, s.positions, 3], [1, s.normals, 3], [2, s.uvs, 2]]) {
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW)
      gl.enableVertexAttribArray(i)
      gl.vertexAttribPointer(i, size, gl.FLOAT, false, 0, 0)
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(s.indices), gl.STATIC_DRAW)
    return { vao: meshVao, count: s.indices.length, material: s.material }
  })

  // ---------- drawing ----------
  const lineQuads = []
  function pushLine(a, b, color, width = 1) {
    lineQuads.push({ a, b, color, width })
  }
  function sceneLines(sim, state, eye) {
    lineQuads.length = 0
    if (state.grid && state.ground !== null) {
      const z = state.ground
      for (let i = -16; i <= 16; i++) {
        const g = state.bg + 0.12
        const c = i === 0 ? [g + 0.4, g + 0.4, g + 0.4, 1] : i % 4 === 0 ? [g + 0.2, g + 0.2, g + 0.2, 1] : [g + 0.08, g + 0.08, g + 0.08, 1]
        // Short segments keep the screen-space width right when a line passes close to the camera.
        for (let k = -16; k < 16; k++) {
          pushLine([i * 64, k * 64, z + 0.2], [i * 64, (k + 1) * 64, z + 0.2], c)
          pushLine([k * 64, i * 64, z + 0.2], [(k + 1) * 64, i * 64, z + 0.2], c)
        }
      }
    }
    pushLine([0, 0, 0], V.mul(sim.axis[0], 48), [1, 0.3, 0.3, 1], 2)
    pushLine([0, 0, 0], V.mul(sim.axis[1], 32), [0.3, 1, 0.3, 1], 2)
    pushLine([0, 0, 0], V.mul(sim.axis[2], 32), [0.4, 0.5, 1, 1], 2)
    if (state.player) {
      // 72-unit player silhouette, 30 wide, standing 120 units to the left as a scale reference.
      const z = state.ground ?? 0
      const toEye = V.norm(V.sub(eye, [0, 120, z + 36]))
      const side = V.norm(V.cross([0, 0, 1], toEye))
      const c = [0.55, 0.55, 0.6, 1]
      const p = (s, h) => V.add([0, 120, z + h], V.mul(side, s))
      pushLine(p(-15, 0), p(15, 0), c); pushLine(p(15, 0), p(15, 72), c); pushLine(p(15, 72), p(-15, 72), c); pushLine(p(-15, 72), p(-15, 0), c)
      pushLine(p(-15, 60), p(15, 60), c)
    }
  }

  function render({ sim, cam, state, hidden }) {
    const eye = cameraEye(cam)
    const aspect = canvas.width / canvas.height
    const vp = mat4mul(perspective(cam.fov, aspect, 2, 20000), lookAt(eye, cam.target, [0, 0, 1]))
    const viewFwd = V.norm(V.sub(cam.target, eye))
    const viewRight = V.norm(V.cross(viewFwd, [0, 0, 1]))
    const viewUp = V.cross(viewRight, viewFwd)
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(state.bg, state.bg, state.bg, 1)
    gl.depthMask(true)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.enable(gl.DEPTH_TEST)
    gl.useProgram(meshProgram)
    gl.uniformMatrix4fv(uMeshVp, false, vp)
    gl.useProgram(program)
    gl.uniformMatrix4fv(uVp, false, vp)
    const shown = (p) => p.spawnTime <= sim.time && !hidden.has(p.def.key) && (state.ground === null || p.pos[2] >= state.ground - 2 || p.type === 'Decal')

    // Reference lines and models, with depth write so particles sort against them.
    sceneLines(sim, state, eye)
    gl.enable(gl.BLEND)
    gl.depthMask(true)
    // Screen-constant line width: each end is widened in proportion to its distance from the eye.
    const lq = lineQuads.map((l) => {
      const d = V.sub(l.b, l.a)
      const dir = V.norm(V.cross(d, V.sub(eye, l.a)))
      const sideA = V.mul(dir, l.width * 0.0012 * V.len(V.sub(eye, l.a)))
      const sideB = V.mul(dir, l.width * 0.0012 * V.len(V.sub(eye, l.b)))
      return { corners: [V.add(l.a, sideA), V.add(l.b, sideB), V.sub(l.b, sideB), V.sub(l.a, sideA)], color: l.color, tex: 'white', frame: 0 }
    })
    drawQuads(lq)
    drawModels(sim.particles.filter((p) => meshes[p.model] && shown(p)))
    gl.enable(gl.BLEND)
    gl.depthMask(false)

    // Particles, far to near, batched by material.
    const items = []
    for (const p of sim.particles) {
      if (!shown(p)) continue
      const q = particleQuad(p, eye, viewRight, viewUp)
      if (q) { q.depth = V.dot(V.sub(p.pos, eye), viewFwd); items.push(q) }
    }
    items.sort((a, b) => b.depth - a.depth)
    drawQuads(items)
  }

  function particleQuad(p, eye, viewRight, viewUp) {
    const vis = sampleVisual(p)
    const d = p.def
    let tex = p.shader ?? 'missing'
    if (p.shader && !textures[p.shader]) tex = 'missing'
    const color = [vis.rgb[0], vis.rgb[1], vis.rgb[2], vis.alpha]
    const w = vis.width, h = vis.height
    if (w <= 0 && d.type !== 'Light') return null
    const rot = (vis.rotation * Math.PI) / 180
    let right, up, center = p.pos
    switch (d.type) {
      case 'Particle':
      case 'Cloud': {
        const c = Math.cos(rot), s = Math.sin(rot)
        right = V.add(V.mul(viewRight, c), V.mul(viewUp, s))
        up = V.sub(V.mul(viewUp, c), V.mul(viewRight, s))
        return quad(center, V.mul(right, w / 2), V.mul(up, h / 2), color, tex, vis.frame)
      }
      case 'Tail': {
        let dir = V.sub(p.pos, p.last)
        if (V.len(dir) < 1e-4) dir = p.vel && V.len(p.vel) > 1e-4 ? p.vel : p.axis[0]
        dir = V.norm(dir)
        const toEye = V.sub(eye, p.pos)
        let side = V.cross(dir, toEye)
        if (V.len(side) < 1e-4) side = viewRight
        side = V.norm(side)
        const len = Math.max(vis.length, w * 0.5)
        center = V.sub(p.pos, V.mul(dir, len / 2))
        return quad(center, V.mul(side, w / 2), V.mul(dir, len / 2), color, tex, vis.frame)
      }
      case 'OrientedParticle':
      case 'Decal': {
        const c = Math.cos(rot), s = Math.sin(rot)
        const l = p.effectAxis[1], u = p.effectAxis[2]
        right = V.add(V.mul(l, c), V.mul(u, s))
        up = V.sub(V.mul(u, c), V.mul(l, s))
        if (d.type === 'Decal') center = V.add(p.pos, V.mul(p.effectAxis[0], 0.4))
        return quad(center, V.mul(right, w / 2), V.mul(up, h / 2), color, tex, vis.frame)
      }
      case 'Light': {
        const r = Math.max(8, w)
        return quad(center, V.mul(viewRight, r / 2), V.mul(viewUp, r / 2), [color[0], color[1], color[2], color[3] * 0.35], 'light', 0)
      }
      case 'Emitter': {
        if (meshes[p.model]) return null
        const size = d.flags.includes('useModel') ? 10 * Math.max(0.2, w) : 4
        return quad(center, V.mul(viewRight, size / 2), V.mul(viewUp, size / 2), d.flags.includes('useModel') ? [0.8, 0.8, 0.8, 1] : [1, 1, 0, 0.6], 'model', 0)
      }
    }
    return null
  }

  function quad(center, r, u, color, tex, frame) {
    return { corners: [V.sub(V.sub(center, r), u), V.sub(V.add(center, r), u), V.add(V.add(center, r), u), V.add(V.sub(center, r), u)], color, tex, frame }
  }

  function drawModels(particles) {
    gl.useProgram(meshProgram)
    gl.disable(gl.BLEND)
    for (const p of particles) {
      const scale = sampleVisual(p).width
      if (scale <= 0) continue
      const [f, l, u] = modelAxis(p).map((a) => V.mul(a, scale))
      gl.uniformMatrix4fv(uMeshModel, false, [...f, 0, ...l, 0, ...u, 0, ...p.pos, 1])
      for (const surface of meshes[p.model]) {
        gl.bindTexture(gl.TEXTURE_2D, textures[surface.material] ?? textures.missing)
        gl.bindVertexArray(surface.vao)
        gl.drawElements(gl.TRIANGLES, surface.count, gl.UNSIGNED_SHORT, 0)
      }
    }
  }

  const MODES = { blend: 0, add: 1, multiply: 2 }
  function drawQuads(items) {
    if (!items.length) return
    gl.useProgram(program)
    gl.bindVertexArray(vao)
    ensureCapacity(items.length)
    let n = 0
    let batchTex = null
    let batchStart = 0
    const flush = (end) => {
      if (end === batchStart) return
      const meta = materialMeta[batchTex]
      const mode = MODES[meta.blend] ?? 0
      if (mode === 1) gl.blendFunc(gl.ONE, gl.ONE)
      else if (mode === 2) gl.blendFunc(gl.DST_COLOR, gl.ZERO)
      else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      gl.uniform1i(uMode, mode)
      gl.bindTexture(gl.TEXTURE_2D, textures[batchTex])
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
      gl.bufferData(gl.ARRAY_BUFFER, verts.subarray(batchStart * 36, end * 36), gl.STREAM_DRAW)
      fillIndices(end - batchStart)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo)
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices.subarray(0, (end - batchStart) * 6), gl.STREAM_DRAW)
      gl.drawElements(gl.TRIANGLES, (end - batchStart) * 6, gl.UNSIGNED_INT, 0)
      batchStart = end
    }
    for (const it of items) {
      if (it.tex !== batchTex) { flush(n); batchTex = it.tex }
      const meta = materialMeta[it.tex]
      const cols = meta.atlasCols, rows = meta.atlasRows
      const fx = it.frame % cols, fy = Math.floor(it.frame / cols) % rows
      const uvs = [[fx / cols, (fy + 1) / rows], [(fx + 1) / cols, (fy + 1) / rows], [(fx + 1) / cols, fy / rows], [fx / cols, fy / rows]]
      for (let k = 0; k < 4; k++) {
        const o = (n * 4 + k) * 9
        verts[o] = it.corners[k][0]; verts[o + 1] = it.corners[k][1]; verts[o + 2] = it.corners[k][2]
        verts[o + 3] = uvs[k][0]; verts[o + 4] = uvs[k][1]
        verts[o + 5] = it.color[0]; verts[o + 6] = it.color[1]; verts[o + 7] = it.color[2]; verts[o + 8] = it.color[3]
      }
      n++
    }
    flush(n)
  }

  return { ready: Promise.all(textureLoads), render }
}
