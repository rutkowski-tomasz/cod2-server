// Draws the open menus on a 640x480 canvas the way the CoD2 UI lays them out.
import { createPainter, rgba, FONT_HEIGHT } from '../shared/paint.js'
const TYPE = { TEXT: 0, BUTTON: 1, LISTBOX: 6, SLIDER: 10, YESNO: 11, MULTI: 12, BIND: 14 }
const FIELD_TYPES = new Set([4, 9, 16, 17, 18])
const STYLE = { FILLED: 1, GRADIENT: 2, SHADER: 3, CINEMATIC: 5, DVAR_SHADER: 6, LOADBAR: 7 }
const BORDER = { FULL: 1, HORZ: 2, VERT: 3, KCGRADIENT: 4 }
const TEXTALIGN = { CENTER: 1, RIGHT: 2, CENTER2: 3 }
const BACKGROUNDS = { dark: '#181818', light: '#c8c8c8', black: '#000' }
const DEFAULT_TEXTSCALE = 0.55
export const SCREEN_W = 640
export const SCREEN_H = 480

export const colorsOf = (def) => ({ forecolor: def.forecolor ?? [1, 1, 1, 1], backcolor: def.backcolor ?? [0, 0, 0, 0], bordercolor: def.bordercolor ?? [0, 0, 0, 0] })

export function isVisible(state, item) {
  if (!state.items.get(item).visible) return false
  if (!item.dvartest) return true
  const value = state.dvars.get(item.dvartest) ?? ''
  if (item.showdvar && !item.showdvar.includes(value)) return false
  if (item.hidedvar && item.hidedvar.includes(value)) return false
  return true
}

export const isFocusable = (state, item) => !item.decoration && isVisible(state, item)

// `images` holds the loaded <img> of each bundle image. `draw` takes the viewer's state: open menus, item colors, dvars, hover.
export function createRenderer(canvas, bundle, images) {
  const ctx = canvas.getContext('2d')
  const paint = createPainter(ctx, images)
  let state
  return function draw(current, { width, height, outline, bg }) {
    state = current
    canvas.width = width
    canvas.height = height
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    drawBackground(width, height, bg)
    ctx.setTransform(width / SCREEN_W, 0, 0, height / SCREEN_H, 0, 0)
    for (const menu of state.open) {
      drawWindow(menu, menu.box, colorsOf(menu))
      for (const item of menu.items) if (isVisible(state, item)) drawItem(menu, item)
    }
    if (outline) drawOutlines()
  }

  function drawBackground(width, height, bg) {
    if (bg === 'checker') {
      for (let y = 0; y < height; y += 16) for (let x = 0; x < width; x += 16) {
        ctx.fillStyle = (x + y) % 32 ? '#9a9a9a' : '#6a6a6a'
        ctx.fillRect(x, y, 16, 16)
      }
    } else if (BACKGROUNDS[bg]) {
      ctx.fillStyle = BACKGROUNDS[bg]
      ctx.fillRect(0, 0, width, height)
    } else {
      // Stand-in for the game world behind the menu: sky over ground.
      const g = ctx.createLinearGradient(0, 0, 0, height)
      g.addColorStop(0, '#7d8a96')
      g.addColorStop(0.55, '#55606a')
      g.addColorStop(0.56, '#4a4438')
      g.addColorStop(1, '#2e2a24')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, width, height)
    }
  }

  function drawWindow(def, box, st) {
    const [x, y, w, h] = box
    const style = def.style ?? 0
    if (style === STYLE.FILLED || style === STYLE.LOADBAR) {
      ctx.fillStyle = rgba(st.backcolor)
      ctx.fillRect(x, y, w, h)
    } else if (style === STYLE.GRADIENT) {
      const g = ctx.createLinearGradient(x, y, x, y + h)
      g.addColorStop(0, rgba(st.backcolor))
      g.addColorStop(1, rgba(st.backcolor, 0))
      ctx.fillStyle = g
      ctx.fillRect(x, y, w, h)
    } else if (style === STYLE.SHADER || (def.ownerdraw !== undefined && def.background)) {
      if (def.background) drawImage(def.background, box, st.forecolor)
    } else if (style === STYLE.DVAR_SHADER) {
      const name = state.dvars.get(def.dvar)
      if (name) drawImage(name, box, st.forecolor)
    } else if (style === STYLE.CINEMATIC) {
      placeholder(box, 'cinematic')
    }
    drawBorder(def, box, st.bordercolor)
  }

  function drawBorder(def, [x, y, w, h], color) {
    const border = def.border ?? 0
    if (!border) return
    const s = def.bordersize ?? 1
    ctx.fillStyle = rgba(color)
    if (border === BORDER.FULL || border === BORDER.HORZ || border === BORDER.KCGRADIENT) { ctx.fillRect(x, y, w, s); ctx.fillRect(x, y + h - s, w, s) }
    if (border === BORDER.FULL || border === BORDER.VERT) { ctx.fillRect(x, y + s, s, h - 2 * s); ctx.fillRect(x + w - s, y + s, s, h - 2 * s) }
  }

  function drawImage(name, [x, y, w, h], color) {
    const img = images[name]
    if (!img) {
      state.warnings.add(`missing image ${name}`)
      placeholder([x, y, w, h], name)
      return
    }
    paint.image(name, x, y, w, h, color, bundle.images[name].blend)
  }

  function placeholder([x, y, w, h], label) {
    ctx.save()
    ctx.strokeStyle = 'rgba(255,0,255,0.8)'
    ctx.lineWidth = 0.5
    ctx.setLineDash([3, 2])
    ctx.strokeRect(x, y, w, h)
    ctx.fillStyle = 'rgba(255,0,255,0.9)'
    ctx.font = '6px monospace'
    ctx.fillText(label, x + 1, y + 7, Math.max(w - 2, 20))
    ctx.restore()
  }

  function drawItem(menu, item) {
    const st = state.items.get(item)
    drawWindow(item, item.box, st)
    if (item.ownerdraw !== undefined) { placeholder(item.box, item.ownerdrawName ?? `ownerdraw ${item.ownerdraw}`); return }
    const type = item.type ?? TYPE.TEXT
    if (type === TYPE.LISTBOX) placeholder(item.box, `listbox feeder ${item.feeder ?? '?'}`)
    const focused = state.hover === item && isFocusable(state, item)
    const color = focused && menu.focuscolor ? menu.focuscolor : st.forecolor
    if (item.style === STYLE.DVAR_SHADER) return
    const [label, value] = itemText(item)
    if (!label && value === null) return
    const font = pickFont(item)
    if (!font) return
    const scale = item.textscale ?? DEFAULT_TEXTSCALE
    const lineHeight = FONT_HEIGHT * scale
    let lines = label.split('\n')
    if (item.autowrapped && item.box[2]) lines = lines.flatMap((l) => paint.wrap(l, font, scale, item.box[2]))
    let endX = item.box[0] + (item.textalignx ?? 0)
    lines.forEach((line, i) => {
      const width = paint.width(line, font, scale)
      let x = item.box[0] + (item.textalignx ?? 0)
      if (item.textalign === TEXTALIGN.CENTER || item.textalign === TEXTALIGN.CENTER2) x -= width / 2
      else if (item.textalign === TEXTALIGN.RIGHT) x -= width
      paint.text(line, x, item.box[1] + (item.textaligny ?? 0) + i * lineHeight, color, font, scale, item.textstyle)
      endX = x + width
    })
    if (value === null) return
    const vx = endX + 8
    const vy = item.box[1] + (item.textaligny ?? 0)
    if (type === TYPE.SLIDER) {
      const [, def = 0, min = 0, max = 1] = item.dvarfloat ?? []
      const v = Number(state.dvars.get(item.dvar) ?? def)
      ctx.fillStyle = rgba(color, 0.4)
      ctx.fillRect(vx, vy - lineHeight * 0.6, 96, 2)
      ctx.fillStyle = rgba(color)
      ctx.fillRect(vx + 96 * Math.min(1, Math.max(0, (v - min) / (max - min || 1))) - 2, vy - lineHeight * 0.8, 4, lineHeight * 0.6)
    } else paint.text(value, vx, vy, color, font, scale, item.textstyle)
  }

  // Label, and the value the game paints after it for dvar-backed controls (null for plain text and buttons).
  function itemText(item) {
    const type = item.type ?? TYPE.TEXT
    const label = item.text !== undefined ? localize(item.text) : null
    const dvar = item.dvar !== undefined ? state.dvars.get(item.dvar) ?? '' : null
    if (FIELD_TYPES.has(type)) return [label ?? '', dvar ?? '']
    if (type === TYPE.YESNO) return [label ?? '', dvar && dvar !== '0' ? 'Yes' : 'No']
    if (type === TYPE.MULTI) {
      const list = item.dvarstrlist ?? []
      let shown = dvar
      for (let i = 0; i + 1 < list.length; i += 2) if (list[i + 1] === dvar) shown = localize(list[i])
      return [label ?? '', shown ?? '']
    }
    if (type === TYPE.SLIDER) return [label ?? '', '']
    if (type === TYPE.BIND) return [label ?? '', '(key)']
    return [label ?? dvar ?? '', null]
  }

  function localize(text) {
    const resolved = text.startsWith('@') ? bundle.strings[text.slice(1)] ?? text : text
    return resolved.replace(/\\n/g, '\n')
  }

  // textfont 0 picks by scale, like ui_smallFont 0.25 and ui_bigFont 0.4.
  function pickFont(item) {
    const scale = item.textscale ?? DEFAULT_TEXTSCALE
    const id = item.textfont || (scale <= 0.25 ? 3 : scale >= 0.4 ? 2 : 1)
    return bundle.fonts[id]
  }

  function drawOutlines() {
    ctx.save()
    ctx.lineWidth = 0.5
    ctx.font = '5px monospace'
    for (const menu of state.open) menu.items.forEach((item, i) => {
      if (!isVisible(state, item)) return
      const [x, y, w, h] = item.box
      const color = item.decoration ? 'rgba(0,200,255,0.7)' : 'rgba(255,220,0,0.9)'
      ctx.strokeStyle = color
      ctx.strokeRect(x, y, w, h)
      ctx.fillStyle = color
      ctx.fillText(item.name ?? `#${i}`, x + 1, y + h - 1)
    })
    ctx.restore()
  }
}
