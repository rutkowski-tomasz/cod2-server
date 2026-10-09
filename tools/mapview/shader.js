// The lightmap shader compiled maps draw with (including normal and specular maps), how a material's techset sets its blending, and the game's fog.

// How a surface's techset combines it with what is behind it; the shader's `blend` uniform.
export const BLEND = { opaque: 0, alpha: 1, multiply: 2, add: 3 }
// Models have no lightmap: in a compiled map they get this much light everywhere, plus the sun by N·L.
const MODEL_AMBIENT = 0.5
// The game looks specular strength up in an engine-made table indexed by the specular map's alpha and N·H.
// The table is not in the iwds, so this guesses a Blinn-Phong exponent of 2^(alpha · this).
const SPECULAR_POWER_RANGE = 8

// The game fogs by distance from the eye: exp fog as exp(-density · d), cull fog linear from near to far
// (materials/shaders/lib/fogcalc.hlsl in iw_07). three.js fogs by depth, squares the exponent and smoothsteps.
const FOG_AMOUNT = `#ifdef FOG_EXP2
  float fogAmount = 1.0 - exp(-fogDensity * vFogDepth);
#else
  float fogAmount = clamp((vFogDepth - fogNear) / (fogFar - fogNear), 0.0, 1.0);
#endif`

// Replaces three.js's fog chunks, so built-in materials fog like the game too.
export function replaceFogChunks() {
  THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
  vFogDepth = length(mvPosition.xyz);
#endif`
  THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
${FOG_AMOUNT}
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogAmount);
#endif`
}

// `clipping` and the clipping_planes chunks let the renderer's planes, such as --cut, clip it like built-in materials;
// `fog` and the fog chunks give it the scene's fog.
export const LIGHTMAP_SHADER = {
  clipping: true,
  fog: true,
  vertexShader: `#include <clipping_planes_pars_vertex>
#include <fog_pars_vertex>
#include <skinning_pars_vertex>
attribute vec2 uv1; attribute vec4 rgba; attribute vec3 tangentU; attribute vec3 binormalV;
varying vec2 vUv; varying vec2 vLm; varying vec3 vNormal; varying vec3 vTangent; varying vec3 vBinormal; varying vec3 vWorld; varying vec4 vColor;
void main() {
  vUv = uv; vLm = uv1; vColor = rgba;
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
  m = m * instanceMatrix;
  #endif
  vec3 objectNormal = normal;
  vec3 transformed = position;
  vec3 objectTangent = tangentU;
  vec3 objectBinormal = binormalV;
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <skinning_vertex>
  #ifdef USE_SKINNING
  objectTangent = (skinMatrix * vec4(objectTangent, 0.0)).xyz;
  objectBinormal = (skinMatrix * vec4(objectBinormal, 0.0)).xyz;
  #endif
  vNormal = mat3(m) * objectNormal;
  vTangent = mat3(m) * objectTangent;
  vBinormal = mat3(m) * objectBinormal;
  vec4 world = m * vec4(transformed, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
  #include <fog_vertex>
}`,
  // Mirrors the game's lmap shader: lightmap = indirect light (four coefficients per channel, weighted
  // for a flat normal), plus sun colour scaled by the sun-visibility page and N·L. Vertex colour tints
  // the texel; its alpha fades blended layers. Multiply layers are unlit, like the game's effect_multiply.
  // The normal map bends the normal the sun and specular use: its alpha and green move it along the
  // tangent and binormal. The game also weights the four coefficients by the bent normal, through another
  // engine-made table, so the indirect light stays flat here. Specular adds the specular map's colour
  // where the half vector meets the normal; shadowed surfaces keep 30% of it, as in the game.
  // Fog fades multiply layers to white and add layers to black, so the fogged surface under them shows unchanged.
  fragmentShader: `#include <clipping_planes_pars_fragment>
#include <fog_pars_fragment>
uniform sampler2D map; uniform int hasMap; uniform vec3 color; uniform float alphaTest;
uniform sampler2D lmR; uniform sampler2D lmG; uniform sampler2D lmB; uniform sampler2D lmSun;
uniform int useLm; uniform int sunShade; uniform vec3 sunDir; uniform vec3 sunColor; uniform int blend;
uniform sampler2D normalMap; uniform int hasNormalMap; uniform sampler2D specularMap; uniform int hasSpecularMap;
varying vec2 vUv; varying vec2 vLm; varying vec3 vNormal; varying vec3 vTangent; varying vec3 vBinormal; varying vec3 vWorld; varying vec4 vColor;
vec3 specular(vec3 n, float visibility) {
  if (hasSpecularMap == 0) return vec3(0.0);
  vec4 s = texture2D(specularMap, vUv);
  vec3 h = normalize(normalize(cameraPosition - vWorld) + sunDir);
  return sunColor * s.rgb * pow(max(0.0, dot(n, h)), exp2(s.a * ${SPECULAR_POWER_RANGE}.0)) * mix(0.3, 1.0, visibility);
}
void main() {
  #include <clipping_planes_fragment>
  vec4 t = hasMap == 1 ? texture2D(map, vUv) : vec4(color, 1.0);
  if (t.a < alphaTest) discard;
  vec4 d = t * vColor;
  if (blend == ${BLEND.multiply}) gl_FragColor = vec4(mix(vec3(1.0), d.rgb, d.a), 1.0);
  else {
    vec3 n = normalize(vNormal);
    if (hasNormalMap == 1) {
      vec2 b = texture2D(normalMap, vUv).ag * 2.0 - 1.0;
      n = normalize(vNormal + b.x * vTangent + b.y * vBinormal);
    }
    vec3 light = vec3(1.0);
    vec3 spec = vec3(0.0);
    if (useLm == 1) {
      vec4 w = vec4(0.25);
      vec3 lm = vec3(dot(texture2D(lmR, vLm), w), dot(texture2D(lmG, vLm), w), dot(texture2D(lmB, vLm), w));
      float sunVis = texture2D(lmSun, vLm).r;
      light = lm + sunVis * max(0.0, dot(n, sunDir)) * sunColor;
      spec = specular(n, sunVis);
    } else if (sunShade == 1) {
      light = vec3(${MODEL_AMBIENT.toFixed(2)}) + max(0.0, dot(n, sunDir)) * sunColor;
      spec = specular(n, 1.0);
    }
    gl_FragColor = vec4(d.rgb * light + spec, blend == ${BLEND.opaque} ? 1.0 : d.a);
  }
  #ifdef USE_FOG
  ${FOG_AMOUNT}
  vec3 fogTarget = blend == ${BLEND.multiply} ? vec3(1.0) : blend == ${BLEND.add} ? vec3(0.0) : fogColor;
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogTarget, fogAmount);
  #endif
}`,
}

export function blendOf(techset = '') {
  if (techset.includes('multiply')) return BLEND.multiply
  if (/(^|_)add(_|$)/.test(techset)) return BLEND.add
  if (/(^|_)blend(_|$)/.test(techset)) return BLEND.alpha
  return BLEND.opaque
}

// A `replace` techset draws opaque whatever the image's alpha: v_window01's glass panes are alpha 0 but solid in game.
export const ignoresAlpha = (techset = '') => /(^|_)replace(_|$)/.test(techset)
