// Builds the self-contained menu bundle: parsed menus plus the images, fonts and localized strings they use.
import { readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { readMaterialImage } from '../shared/material.js'
import { preprocess } from './preprocess.js'
import { parseMenuFile } from './parse.js'
import { parseFont } from '../shared/font.js'

// textfont values (UI_FONT_*); 0 picks one of normal, small and big by text scale in the viewer.
const FONTS = { 1: 'normalFont', 2: 'bigFont', 3: 'smallFont', 4: 'boldFont', 5: 'consoleFont' }
const WINDOW_STYLE_DVAR_SHADER = 6
const SCREEN_W = 640
const SCREEN_H = 480
// HORIZONTAL_ALIGN_* values; VERTICAL_ALIGN_* use the same numbers, with BOTTOM for RIGHT.
const ALIGN = { CENTER: 2, RIGHT: 3, CENTER_SAFEAREA: 7 }

// `target` is a file path or a game path like ui_mp/scriptmenus/ingame(.menu). `dvars` name → value, for DVAR_SHADER images.
export function buildBundle(target, search, dvars = {}) {
  const missing = { includes: [], images: [], fonts: [], strings: [] }
  const images = {}
  const fonts = {}
  const strings = {}
  const tried = new Set()
  const { path, text, root } = loadTarget(target)

  const pp = preprocess(text, (inc) => {
    const local = root && join(root, inc)
    if (local && existsSync(local)) return readFileSync(local, 'latin1')
    return search.read(inc)?.toString('latin1') ?? null
  })
  missing.includes.push(...pp.missing)
  const parsed = parseMenuFile(pp.tokens)

  const referenced = new Set()
  for (const menu of parsed.menus) {
    if (menu.background) loadImage(menu.background)
    menu.box = place(menu.rect ?? [0, 0, SCREEN_W, SCREEN_H], 0, 0)
    for (const item of menu.items) {
      item.box = place(item.rect ?? [0, 0, 0, 0], menu.rect?.[0] ?? 0, menu.rect?.[1] ?? 0, menu.rect, item.origin)
      // dvarFloat "name" default min max sets the item's dvar too, as in game.
      if (item.dvarfloat && item.dvar === undefined) item.dvar = item.dvarfloat[0]
      if (item.type !== undefined) item.typeName = macroName('ITEM_TYPE_', item.type)
      if (item.ownerdraw !== undefined) item.ownerdrawName = macroName('CG_', item.ownerdraw) ?? macroName('UI_', item.ownerdraw)
      if (item.background) loadImage(item.background)
      if (item.style === WINDOW_STYLE_DVAR_SHADER && item.dvar && dvars[item.dvar]) loadImage(dvars[item.dvar])
      for (const t of [item.text, ...(item.dvarstrlist ?? [])]) if (t?.startsWith('@')) loadString(t.slice(1))
      for (const d of [item.dvar, item.dvartest]) if (d) referenced.add(d)
    }
  }
  const scriptDvars = scanScriptDvars(parsed.menus)
  for (const [id, file] of Object.entries(FONTS)) loadFont(id, file)

  return { path, menus: parsed.menus, unknownKeywords: [...parsed.unknownKeywords], images, fonts, strings, missing, referencedDvars: [...referenced].sort(), scriptDvars: [...scriptDvars] }

  function macroName(prefix, value) {
    for (const [name, m] of pp.macros) if (name.startsWith(prefix) && !m.params && m.body.length === 1 && Number(m.body[0].s) === value) return name
  }

  // Dvars the menus' scripts set. DVAR_SHADER items draw the material named by a dvar; scripts usually set it with setdvar.
  function scanScriptDvars(menus) {
    const shaderDvars = new Set(menus.flatMap((m) => m.items.filter((it) => it.style === WINDOW_STYLE_DVAR_SHADER && it.dvar).map((it) => it.dvar.toLowerCase())))
    const scriptDvars = new Set()
    for (const def of menus.flatMap((m) => [m, ...m.items])) {
      for (const script of [...Object.values(def).filter(isScript), ...Object.values(def.execkeys ?? {})]) {
        for (const [op, dvar, value] of script) {
          if (op.toLowerCase() !== 'setdvar' || !dvar) continue
          scriptDvars.add(dvar)
          if (shaderDvars.has(dvar.toLowerCase()) && value) loadImage(value)
        }
      }
    }
    return scriptDvars
  }

  function loadTarget(t) {
    if (existsSync(t) && !t.endsWith('/')) {
      const abs = resolve(t)
      const m = abs.match(/^(.*?)\/(ui(?:_mp)?\/.*)$/)
      return { path: m ? m[2] : abs, text: readFileSync(abs, 'latin1'), root: m?.[1] }
    }
    const name = t.replace(/^\/+/, '')
    for (const p of [name, `${name}.menu`]) {
      const buf = search.read(p)
      if (buf) return { path: p, text: buf.toString('latin1') }
    }
    throw new Error(`menu not found: ${t}`)
  }

  function loadImage(name) {
    if (tried.has(name)) return
    tried.add(name)
    const image = readMaterialImage(name, search)
    if (image.missing) missing.images.push(`${name} ${image.missing}`)
    else images[name] = image
  }

  function loadFont(id, file) {
    const buf = search.read(`fonts/${file}`)
    if (!buf) { missing.fonts.push(file); return }
    const font = parseFont(buf)
    const key = `font:${font.material}`
    if (!images[key]) {
      const image = readMaterialImage(font.material, search)
      if (image.missing) { missing.fonts.push(`${file} → ${font.material} ${image.missing}`); return }
      images[key] = image
    }
    fonts[id] = { name: file, pixelHeight: font.pixelHeight, image: key, glyphs: font.glyphs }
  }


  // "@MENU_BACK" is REFERENCE BACK in localizedstrings/menu.str. File names can hold underscores too
  // (@PC_PATCH_1_1_SD_OBJECTIVES is in pc_patch_1_1.str), so every split is tried, longest file name first.
  // Only English and unlocalized iwds count: the Polish iwds that are pulled would otherwise override them.
  function loadString(key) {
    if (tried.has(`@${key}`)) return
    tried.add(`@${key}`)
    for (let split = key.lastIndexOf('_'); split > 0; split = key.lastIndexOf('_', split - 1)) {
      const file = `localizedstrings/${key.slice(0, split).toLowerCase()}.str`
      const ref = key.slice(split + 1)
      for (const { path, buf } of search.readAll(file)) {
        if (/localized_(?!english)/i.test(path)) continue
        const m = buf.toString('latin1').match(new RegExp(`^REFERENCE\\s+${ref}\\s*\\r?\\nLANG_ENGLISH\\s+"(.*)"`, 'm'))
        if (m) { strings[key] = m[1].replace(/\\n/g, '\n'); return }
      }
    }
    missing.strings.push(key)
  }
}

// Absolute 640x480 box of a menu or item rect: x y w h [horzAlign vertAlign]. Items sit relative to their menu's rect and
// take its alignment unless they set their own. The PC game stretches 640x480 to the screen, so safe areas are ignored.
function place(rect, baseX, baseY, menuRect, origin = [0, 0]) {
  const [x, y, w, h, ha, va] = rect
  const horz = rect.length >= 6 && (ha || va) ? ha : menuRect?.[4] ?? 0
  const vert = rect.length >= 6 && (ha || va) ? va : menuRect?.[5] ?? 0
  const shift = (align, size) => (align === ALIGN.CENTER || align === ALIGN.CENTER_SAFEAREA ? size / 2 : align === ALIGN.RIGHT ? size : 0)
  return [baseX + x + origin[0] + shift(horz, SCREEN_W), baseY + y + origin[1] + shift(vert, SCREEN_H), w, h]
}

const isScript = (v) => Array.isArray(v) && Array.isArray(v[0])
