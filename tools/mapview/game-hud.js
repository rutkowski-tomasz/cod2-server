// The game's HUD over the page, drawn as the game draws a player's: on a 640×480 virtual screen stretched to the
// window, placed and aligned like the hud elements a script makes with newHudElem, in the game's fonts and materials.
// Text and images keep their shape, and a screen narrower than 4:3 gets a HUD of its own shape instead.
import { createPainter, TEXTSTYLE, FONT_HEIGHT } from '../shared/paint.js'

const SCREEN_W = 640
const SCREEN_H = 480
// A hud element's text at fontScale 1 is this many virtual pixels high, as the game's own HUD scripts assume.
const LINE_HEIGHT = 12
const FONT_SCALE = LINE_HEIGHT / FONT_HEIGHT
const NORMAL_SIZES = ['small', 'normal', 'big']
const HORZ = { left: 0, subleft: 0, fullscreen: 0, noscale: 0, center: SCREEN_W / 2, right: SCREEN_W }
const VERT = { top: 0, subtop: 0, fullscreen: 0, noscale: 0, middle: SCREEN_H / 2, bottom: SCREEN_H }
const ALIGN_X = { left: 0, center: 0.5, right: 1 }
const ALIGN_Y = { top: 0, middle: 0.5, bottom: 1 }
// A fitted HUD is at least this many virtual pixels across, three quarters of the game's, so what sits on its left
// and right sides stays apart.
const NARROWEST = 480

export function createGameHud() {
  const canvas = document.body.appendChild(document.createElement('canvas'))
  // Inside the safe area, clear of a phone's notch and rounded corners.
  Object.assign(canvas.style, {
    position: 'absolute',
    left: 'env(safe-area-inset-left)',
    top: 'env(safe-area-inset-top)',
    width: 'calc(100% - env(safe-area-inset-left) - env(safe-area-inset-right))',
    height: 'calc(100% - env(safe-area-inset-top) - env(safe-area-inset-bottom))',
    pointerEvents: 'none',
  })
  const ctx = canvas.getContext('2d')
  const images = {}
  const blends = {}
  const fonts = {}
  const paint = createPainter(ctx, images)
  let elems = []
  addEventListener('resize', draw)

  return {
    // Fonts or material images from bundle.js buildHudFonts or buildHudImages, for the elements to draw with; a font
    // draws once its atlas is in. A font given as { family, weight } instead is a web font, which replaces the game's.
    // Resolves once loaded.
    add(assets) {
      return Promise.all(Object.entries(assets.images ?? {}).filter(([name]) => !images[name]).map(([name, { png, blend }]) => new Promise((resolve) => {
        const img = new Image()
        img.onload = () => { images[name] = img; blends[name] = blend; resolve() }
        img.onerror = resolve
        img.src = png
      }))).then(() => {
        for (const [name, font] of Object.entries(assets.fonts ?? {})) if (font.family || images[font.image]) fonts[name] = font
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
    // Drawn in device pixels, so text stays sharp on high-density screens.
    const width = Math.round(canvas.clientWidth * devicePixelRatio)
    const height = Math.round(canvas.clientHeight * devicePixelRatio)
    if (canvas.width !== width || canvas.height !== height) Object.assign(canvas, { width, height })
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingQuality = 'high'
    const stretched = { sx: canvas.width / SCREEN_W, sy: canvas.height / SCREEN_H, w: SCREEN_W, h: SCREEN_H }
    const fit = fitted(stretched)
    for (const e of elems) {
      if ((e.alpha ?? 1) <= 0) continue
      const frame = fullscreen(e) ? stretched : fit
      ctx.setTransform(frame.sx, 0, 0, frame.sy, 0, 0)
      drawElement(e, frame)
    }
  }

  // On a screen at least 4:3 the game stretches the HUD's places to it, and its text keeps its shape: it scales with
  // the screen's height only. A narrower screen, such as a phone held upright, would squeeze the places until the
  // text overlaps, so it gets a virtual screen of its own shape, at least 480 high and NARROWEST across, and what the
  // game puts in the right or bottom half of its screen sticks to that edge (onto). Fullscreen elements still fill
  // the window.
  function fitted(stretched) {
    if (stretched.sx >= stretched.sy) return stretched
    const s = Math.min(stretched.sy, canvas.width / NARROWEST)
    return { sx: s, sy: s, w: canvas.width / s, h: canvas.height / s }
  }

  // Text and images keep their shape, drawn `textAspect` and `imageAspect` as wide; images of `stretch` and fullscreen
  // elements stretch with the screen, as the game draws them all.
  function drawElement(e, frame) {
    const textAspect = frame.sy / frame.sx
    const imageAspect = e.stretch || fullscreen(e) ? 1 : textAspect
    const scale = FONT_SCALE * (e.fontScale ?? 1)
    const lineHeight = LINE_HEIGHT * (e.fontScale ?? 1)
    const font = fontFor(e.font ?? 'normal', lineHeight * frame.sy)
    const parts = (e.parts ?? [e]).map((p) => {
      // An image alone keeps the place of its box and is drawn in its middle; images in a line take their own width.
      if (p.shader) return images[p.shader] && { ...p, w: e.parts ? p.width * imageAspect : p.width, h: p.height }
      return font && p.text && { text: p.text, w: paint.width(p.text, font, scale) * textAspect, h: lineHeight }
    }).filter(Boolean)
    const width = parts.reduce((sum, p) => sum + p.w, 0)
    const height = Math.max(0, ...parts.map((p) => p.h))
    let [x, y] = cornerOf(e, width, height, frame)
    const color = [...(e.color ?? [1, 1, 1]), e.alpha ?? 1]
    for (const p of parts) {
      if (p.shader) drawShader(p, x, y + (height - p.h) / 2, color, imageAspect)
      else {
        ctx.save()
        ctx.translate(x, y + (height + p.h) / 2)
        ctx.scale(textAspect, 1)
        paint.text(p.text, 0, 0, color, font, scale, e.shadow ? TEXTSTYLE.SHADOWED : 0)
        ctx.restore()
      }
      x += p.w
    }
  }

  // The font `name`. The game draws normal text from its normal font; here it comes from the smallest of the small,
  // normal and big fonts at least `pixels` high on screen, so large text stays sharp. A web font is sharp at any size.
  function fontFor(name, pixels) {
    if (name !== 'normal' || fonts.normal?.family) return fonts[name]
    const sizes = NORMAL_SIZES.map((n) => fonts[n]).filter(Boolean)
    return sizes.find((f) => f.pixelHeight >= pixels) ?? sizes.at(-1)
  }

  // `p.shader`, `p.width` by `p.h` drawn `aspect` as wide, in the middle of the `p.w` by `p.h` box at x, y.
  function drawShader(p, x, y, color, aspect) {
    ctx.save()
    ctx.translate(x + p.w / 2, y + p.h / 2)
    ctx.scale(aspect, 1)
    if (p.rotation) ctx.rotate((p.rotation * Math.PI) / 180)
    if (p.flipX) ctx.scale(-1, 1)
    paint.image(p.shader, -p.width / 2, -p.h / 2, p.width, p.h, color, blends[p.shader])
    ctx.restore()
  }

  // The top left corner of a `w` by `h` element in the virtual pixels of `frame`.
  function cornerOf(e, w, h, frame) {
    const horz = HORZ[e.horzAlign ?? 'left']
    const vert = VERT[e.vertAlign ?? 'top']
    const x = onto(horz + (e.x ?? 0) - w * ALIGN_X[e.alignX ?? 'left'], w, horz / SCREEN_W, SCREEN_W, frame.w)
    const y = onto(vert + (e.y ?? 0) - h * ALIGN_Y[e.alignY ?? 'top'], h, vert / SCREEN_H, SCREEN_H, frame.h)
    return [x, y]
  }
}

// Placed on the whole window, stretched, whatever its shape, as a fade to black or a scope must be.
function fullscreen(e) {
  return e.horzAlign === 'fullscreen' || e.vertAlign === 'fullscreen'
}

// Where a box `length` long starting at `start` on the game's virtual screen, `size` across, starts on one `fit`
// across. It keeps its distance from what it is aligned to (`align`: 0 the start, 0.5 the middle, 1 the end). Aligned
// to the start, a box mostly past the middle keeps its distance from the end instead, and one centred on the middle
// stays there.
function onto(start, length, align, size, fit) {
  const middle = start + length / 2
  const anchor = align !== 0 ? align : middle < size / 2 ? 0 : middle > size / 2 ? 1 : 0.5
  return start + (fit - size) * anchor
}
