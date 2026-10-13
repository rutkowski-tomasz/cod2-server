// Bakes a three.js material into one image for the game: its colour map times its colour, with the alpha of the
// map, its opacity and its alpha map. Drawn with WebGL, since a 2D canvas premultiplies alpha and loses the colour
// under transparent pixels; WebGL also shrinks large maps through mipmaps.
import * as THREE from 'three'

const SHADER = {
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    uniform sampler2D map, alphaMap;
    uniform bool hasMap, hasAlphaMap, mapFlipY, alphaMapFlipY, keepAlpha;
    uniform vec3 color;
    uniform float opacity;
    varying vec2 vUv;
    // The image's own rows: v grows down from its top, whichever way the texture was uploaded.
    vec2 imageUv(bool flipY) { return vec2(vUv.x, flipY ? vUv.y : 1.0 - vUv.y); }
    void main() {
      vec4 texel = hasMap ? texture2D(map, imageUv(mapFlipY)) : vec4(1.0);
      float alpha = texel.a * opacity * (hasAlphaMap ? texture2D(alphaMap, imageUv(alphaMapFlipY)).g : 1.0);
      gl_FragColor = vec4(texel.rgb * color, keepAlpha ? alpha : 1.0);
    }`,
}

let renderer

// `color` is in sRGB, as the maps' texels are read. Returns RGBA rows, top first, as base64, at power-of-two sides
// no longer than `textureSize`; 8×8 without a map.
export function bakeMaterial(m, color, keepAlpha, textureSize) {
  renderer ??= new THREE.WebGLRenderer()
  const map = loadedMap(m, 'map')
  const alphaMap = loadedMap(m, 'alphaMap')
  const image = (map ?? alphaMap)?.image
  const side = (n) => (n ? Math.min(textureSize, 2 ** Math.round(Math.log2(n))) : 8)
  const width = side(image?.width)
  const height = side(image?.height)
  const material = new THREE.ShaderMaterial({
    ...SHADER,
    uniforms: {
      map: { value: raw(map) },
      alphaMap: { value: raw(alphaMap) },
      hasMap: { value: !!map },
      hasAlphaMap: { value: !!alphaMap },
      mapFlipY: { value: !!map?.flipY },
      alphaMapFlipY: { value: !!alphaMap?.flipY },
      keepAlpha: { value: keepAlpha },
      color: { value: new THREE.Vector3(...color) },
      opacity: { value: m.opacity ?? 1 },
    },
  })
  const target = new THREE.WebGLRenderTarget(width, height, { depthBuffer: false })
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
  renderer.setRenderTarget(target)
  renderer.render(quad, new THREE.Camera())
  const pixels = new Uint8Array(width * height * 4)
  renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels)
  renderer.setRenderTarget(null)
  for (const resource of [target, material, quad.geometry, material.uniforms.map.value, material.uniforms.alphaMap.value]) resource?.dispose()
  // WebGL reads the bottom row first.
  const rows = new Uint8Array(pixels.length)
  for (let y = 0; y < height; y++) rows.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), (height - 1 - y) * width * 4)
  let binary = ''
  for (let i = 0; i < rows.length; i += 0x8000) binary += String.fromCharCode(...rows.subarray(i, i + 0x8000))
  return { width, height, rgba: btoa(binary) }
}

// FBXLoader keeps a map whose file failed to load, with no image; such a map is left out.
export function loadedMap(m, key) {
  const texture = m[key]
  if (texture && !texture.image) console.warn(`${m.name}: ${key} ${texture.name || ''} did not load`)
  return texture?.image ? texture : null
}

// The texture as stored, without three.js decoding sRGB on sampling: the game takes the bytes as they are.
function raw(texture) {
  if (!texture) return null
  const copy = texture.clone()
  copy.colorSpace = THREE.NoColorSpace
  // A glTF sampler may turn mipmaps off, but shrinking a large map needs them.
  copy.generateMipmaps = true
  copy.minFilter = THREE.LinearMipmapLinearFilter
  copy.magFilter = THREE.LinearFilter
  copy.needsUpdate = true
  return copy
}
