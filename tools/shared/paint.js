// CoD2 text and images on a 2D canvas, as the game's UI draws them: game font glyphs, ^0-^9 colour codes, text
// styles, and material images tinted and blended. menuview's menus and mapview's HUD draw with it. `images` holds each
// loaded <img> by name, font atlases included; a font is { pixelHeight, image, glyphs } as shared/font.js reads it.

// ^0-^9. ^8 and ^9 are not in the stock assets; these are guesses.
export const CODE_COLORS = [[0, 0, 0], [1, 0.2, 0.2], [0, 1, 0], [1, 1, 0], [0.2, 0.2, 1], [0, 1, 1], [1, 0, 1], [1, 1, 1], [1, 0.55, 0], [0.55, 0.55, 0.55]]
export const TEXTSTYLE = { SHADOWED: 3, OUTLINED: 4, OUTLINESHADOWED: 5, SHADOWEDMORE: 6 }
// Height in virtual pixels of text at scale 1.
export const FONT_HEIGHT = 48

export const rgba = (c, alpha = 1) => `rgba(${c[0] * 255},${c[1] * 255},${c[2] * 255},${Math.min(1, Math.max(0, (c[3] ?? 1) * alpha))})`
export const isColorCode = (text, i) => text[i] === '^' && /[0-9]/.test(text[i + 1] ?? '')
// Glyphs are scaled so the font's pixel height becomes FONT_HEIGHT × scale virtual pixels.
const glyphScale = (font, scale) => (scale * FONT_HEIGHT) / font.pixelHeight

export function createPainter(ctx, images) {
  const tints = new Map()
  return { width, wrap, text, image }

  function width(text, font, scale) {
    const s = glyphScale(font, scale)
    let w = 0
    for (let i = 0; i < text.length; i++) {
      if (isColorCode(text, i)) { i++; continue }
      w += (font.glyphs[text.charCodeAt(i)] ?? font.glyphs[63])?.[2] ?? 0
    }
    return w * s
  }

  // `line` split into lines no wider than `max`, at spaces.
  function wrap(line, font, scale, max) {
    const out = []
    let current = ''
    for (const word of line.split(' ')) {
      const next = current ? `${current} ${word}` : word
      if (current && width(next, font, scale) > max) { out.push(current); current = word }
      else current = next
    }
    out.push(current)
    return out
  }

  // `string` with its baseline's left end at x, y.
  function text(string, x, y, color, font, scale, style) {
    const shadow = [0, 0, 0, color[3] ?? 1]
    if (style === TEXTSTYLE.SHADOWED || style === TEXTSTYLE.OUTLINESHADOWED) run(string, x + 1, y + 1, shadow, font, scale, false)
    if (style === TEXTSTYLE.SHADOWEDMORE) run(string, x + 2, y + 2, shadow, font, scale, false)
    if (style === TEXTSTYLE.OUTLINED || style === TEXTSTYLE.OUTLINESHADOWED) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) run(string, x + dx, y + dy, shadow, font, scale, false)
    run(string, x, y, color, font, scale, true)
  }

  function run(text, x, y, color, font, scale, codes) {
    const s = glyphScale(font, scale)
    const atlas = images[font.image]
    let current = color
    for (let i = 0; i < text.length; i++) {
      if (isColorCode(text, i)) {
        if (codes) current = [...CODE_COLORS[Number(text[++i])], color[3] ?? 1]
        else i++
        continue
      }
      const g = font.glyphs[text.charCodeAt(i)] ?? font.glyphs[63]
      if (!g) continue
      const [x0, y0, dx, w, h, s0, t0, s1, t1] = g
      if (w && h) {
        ctx.globalAlpha = Math.min(1, current[3] ?? 1)
        ctx.drawImage(tinted(font.image, current), s0 * atlas.width, t0 * atlas.height, (s1 - s0) * atlas.width, (t1 - t0) * atlas.height, x + x0 * s, y + y0 * s, w * s, h * s)
      }
      x += dx * s
    }
    ctx.globalAlpha = 1
  }

  // The image `name` in the w × h box at x, y, multiplied by `color` with its alpha, added to what is behind it for an
  // `add` material.
  function image(name, x, y, w, h, color, blend) {
    ctx.save()
    ctx.globalAlpha = Math.min(1, color[3] ?? 1)
    if (blend === 'add') ctx.globalCompositeOperation = 'lighter'
    ctx.drawImage(tinted(name, color), x, y, w, h)
    ctx.restore()
  }

  // Image multiplied by an RGB color, alpha kept; cached per color.
  function tinted(name, color) {
    if (color[0] >= 1 && color[1] >= 1 && color[2] >= 1) return images[name]
    const key = `${name}|${color.slice(0, 3).join(',')}`
    if (!tints.has(key)) {
      const img = images[name]
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const g = c.getContext('2d')
      g.drawImage(img, 0, 0)
      g.globalCompositeOperation = 'multiply'
      g.fillStyle = rgba([...color.slice(0, 3), 1])
      g.fillRect(0, 0, c.width, c.height)
      g.globalCompositeOperation = 'destination-in'
      g.drawImage(img, 0, 0)
      tints.set(key, c)
    }
    return tints.get(key)
  }
}
