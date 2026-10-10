// The game's HUD over the page, drawn as the game draws a player's: on a 640×480 virtual screen stretched to the
// window, placed and aligned like the hud elements a script makes with newHudElem, in the game's fonts and materials.
import { createPainter, TEXTSTYLE, FONT_HEIGHT } from '../shared/paint.js'

const SCREEN_W = 640
const SCREEN_H = 480
// A hud element's text at fontScale 1 is this many virtual pixels high, as the game's own HUD scripts assume.
const LINE_HEIGHT = 12
const FONT_SCALE = LINE_HEIGHT / FONT_HEIGHT
const HORZ = { left: 0, subleft: 0, fullscreen: 0, noscale: 0, center: SCREEN_W / 2, right: SCREEN_W }
const VERT = { top: 0, subtop: 0, fullscreen: 0, noscale: 0, middle: SCREEN_H / 2, bottom: SCREEN_H }

export function createGameHud() {
  const canvas = document.body.appendChild(document.createElement('canvas'))
  Object.assign(canvas.style, { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none' })
  const ctx = canvas.getContext('2d')
  const images = {}
  const blends = {}
  const fonts = {}
  const paint = createPainter(ctx, images)
  let elems = []
  addEventListener('resize', draw)

  return {
    // Fonts or material images from bundle.js buildHudFonts or buildHudImages, for the elements to draw with; a font
    // draws once its atlas is in. Resolves once loaded.
    add(assets) {
      return Promise.all(Object.entries(assets.images).filter(([name]) => !images[name]).map(([name, { png, blend }]) => new Promise((resolve) => {
        const img = new Image()
        img.onload = () => { images[name] = img; blends[name] = blend; resolve() }
        img.onerror = resolve
        img.src = png
      }))).then(() => {
        for (const [name, font] of Object.entries(assets.fonts ?? {})) if (images[font.image]) fonts[name] = font
        draw()
      })
    },
    // Draws `list`, hud elements as README.md describes them, in place of what was drawn. What is not loaded yet draws
    // once it is.
    set(list) {
      elems = [...list].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
      draw()
    },
  }

  function draw() {
    if (canvas.width !== innerWidth || canvas.height !== innerHeight) Object.assign(canvas, { width: innerWidth, height: innerHeight })
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(canvas.width / SCREEN_W, 0, 0, canvas.height / SCREEN_H, 0, 0)
    for (const e of elems) if ((e.alpha ?? 1) > 0) drawElement(e)
  }

  function drawElement(e) {
    const font = fonts[e.font ?? 'normal']
    const scale = FONT_SCALE * (e.fontScale ?? 1)
    const lineHeight = LINE_HEIGHT * (e.fontScale ?? 1)
    const parts = (e.parts ?? [e]).map((p) => {
      if (p.shader) return images[p.shader] && { ...p, w: p.width, h: p.height }
      return font && p.text && { text: p.text, w: paint.width(p.text, font, scale), h: lineHeight }
    }).filter(Boolean)
    const width = parts.reduce((sum, p) => sum + p.w, 0)
    const height = Math.max(0, ...parts.map((p) => p.h))
    let [x, y] = place(e, width, height)
    const color = [...(e.color ?? [1, 1, 1]), e.alpha ?? 1]
    for (const p of parts) {
      if (p.shader) drawShader(p, x, y + (height - p.h) / 2, color)
      else paint.text(p.text, x, y + (height + p.h) / 2, color, font, scale, e.shadow ? TEXTSTYLE.SHADOWED : 0)
      x += p.w
    }
  }

  // `p.shader` filling the `p.w` by `p.h` box at x, y.
  function drawShader(p, x, y, color) {
    ctx.save()
    ctx.translate(x + p.w / 2, y + p.h / 2)
    if (p.rotation) ctx.rotate((p.rotation * Math.PI) / 180)
    if (p.flipX) ctx.scale(-1, 1)
    paint.image(p.shader, -p.w / 2, -p.h / 2, p.w, p.h, color, blends[p.shader])
    ctx.restore()
  }

  // The top left corner of a `w` by `h` element in virtual pixels.
  function place(e, w, h) {
    const x = HORZ[e.horzAlign ?? 'left'] + (e.x ?? 0) - w * { left: 0, center: 0.5, right: 1 }[e.alignX ?? 'left']
    const y = VERT[e.vertAlign ?? 'top'] + (e.y ?? 0) - h * { top: 0, middle: 0.5, bottom: 1 }[e.alignY ?? 'top']
    return [x, y]
  }
}
