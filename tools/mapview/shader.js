// The lightmap shader compiled maps draw with, and how a material's techset sets its blending.

// How a surface's techset combines it with what is behind it; the shader's `blend` uniform.
export const BLEND = { opaque: 0, alpha: 1, multiply: 2, add: 3 }
// Models have no lightmap: in a compiled map they get this much light everywhere, plus the sun by N·L.
const MODEL_AMBIENT = 0.5

export const LIGHTMAP_SHADER = {
  vertexShader: `attribute vec2 uv1; attribute vec4 rgba;
varying vec2 vUv; varying vec2 vLm; varying vec3 vNormal; varying vec4 vColor;
void main() {
  vUv = uv; vLm = uv1; vColor = rgba;
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
  m = m * instanceMatrix;
  #endif
  vNormal = normalize(mat3(m) * normal);
  gl_Position = projectionMatrix * viewMatrix * m * vec4(position, 1.0);
}`,
  // Mirrors the game's lmap shader: lightmap = indirect light (four coefficients per channel, weighted
  // for a flat normal), plus sun colour scaled by the sun-visibility page and N·L. Vertex colour tints
  // the texel; its alpha fades blended layers. Multiply layers are unlit, like the game's effect_multiply.
  fragmentShader: `uniform sampler2D map; uniform int hasMap; uniform vec3 color; uniform float alphaTest;
uniform sampler2D lmR; uniform sampler2D lmG; uniform sampler2D lmB; uniform sampler2D lmSun;
uniform int useLm; uniform int sunShade; uniform vec3 sunDir; uniform vec3 sunColor; uniform int blend;
varying vec2 vUv; varying vec2 vLm; varying vec3 vNormal; varying vec4 vColor;
void main() {
  vec4 t = hasMap == 1 ? texture2D(map, vUv) : vec4(color, 1.0);
  if (t.a < alphaTest) discard;
  vec4 d = t * vColor;
  if (blend == ${BLEND.multiply}) { gl_FragColor = vec4(mix(vec3(1.0), d.rgb, d.a), 1.0); return; }
  vec3 light = vec3(1.0);
  if (useLm == 1) {
    vec4 w = vec4(0.25);
    vec3 lm = vec3(dot(texture2D(lmR, vLm), w), dot(texture2D(lmG, vLm), w), dot(texture2D(lmB, vLm), w));
    float sunVis = texture2D(lmSun, vLm).r;
    light = lm + sunVis * max(0.0, dot(normalize(vNormal), sunDir)) * sunColor;
  } else if (sunShade == 1) {
    light = vec3(${MODEL_AMBIENT.toFixed(2)}) + max(0.0, dot(normalize(vNormal), sunDir)) * sunColor;
  }
  gl_FragColor = vec4(d.rgb * light, blend == ${BLEND.opaque} ? 1.0 : d.a);
}`,
}

export function blendOf(techset = '') {
  if (techset.includes('multiply')) return BLEND.multiply
  if (/(^|_)add(_|$)/.test(techset)) return BLEND.add
  if (/(^|_)blend(_|$)/.test(techset)) return BLEND.alpha
  return BLEND.opaque
}
