// Preprocessed menu tokens → { global, menus: [{ ...props, items: [...] }] }. Keywords are lowercased, the game ignores their case.
const SCRIPTS = new Set(['onopen', 'onclose', 'onesc', 'onfocus', 'leavefocus', 'mouseenter', 'mouseexit', 'mouseentertext', 'mouseexittext', 'action', 'accept', 'doubleclick'])
const LISTS = new Set(['showdvar', 'hidedvar', 'enabledvar', 'disabledvar', 'focusdvar', 'dvarstrlist', 'dvarfloatlist'])
const STRINGS = new Set(['name', 'text', 'group', 'background', 'dvar', 'dvartest', 'soundloop', 'cinematic', 'focussound', 'localvar', 'special', 'asset_model', 'asset_shader', 'allowbinding'])
const NUMBER = /^-?(\d+\.?\d*|\.\d+|0x[\da-f]+)$/i
// execKeyInt codes of keys whose browser KeyboardEvent.key is a name, not the character.
const KEY_NAMES = { 9: 'Tab', 13: 'Enter', 27: 'Escape', 127: 'Backspace' }

export function parseMenuFile(tokens) {
  let i = 0
  const result = { global: {}, menus: [], unknown: new Set() }
  const peek = () => tokens[i]
  const next = () => tokens[i++]
  const isOpen = (t) => t && !t.q && t.s === '{'
  const isClose = (t) => t && !t.q && t.s === '}'

  while (i < tokens.length) {
    const t = next()
    if (t.q || t.s === '{' || t.s === '}') continue
    const key = t.s.toLowerCase()
    if (!isOpen(peek())) continue
    next()
    if (key === 'menudef') result.menus.push(parseDef(true))
    else if (key === 'assetglobaldef') result.global = parseDef(null)
    else skipBlock()
  }
  return result

  function parseDef(isMenu) {
    const def = isMenu ? { items: [] } : {}
    // isMenu null: assetGlobalDef, whose font and sound settings are not reported as unknown.
    while (i < tokens.length && !isClose(peek())) {
      const t = next()
      if (t.q || t.s === ';') continue
      const key = t.s.toLowerCase()
      if (key === 'itemdef' && isOpen(peek())) {
        next()
        def.items?.push(parseDef(false))
      } else if (SCRIPTS.has(key) && isOpen(peek())) {
        next()
        def[key] = parseScript()
      } else if (LISTS.has(key) && isOpen(peek())) {
        next()
        def[key] = parseList()
      } else if ((key === 'execkey' || key === 'execkeyint') && isOpen(tokens[i + 1])) {
        const k = next().s
        next()
        def.execkeys ??= {}
        def.execkeys[key === 'execkey' ? k : KEY_NAMES[k] ?? String.fromCharCode(Number(k))] = parseScript()
      } else if (STRINGS.has(key)) {
        def[key] = next().s
      } else {
        const values = peek()?.q ? [next().s] : []
        while (peek() && !peek().q && NUMBER.test(peek().s)) values.push(Number(next().s))
        if (!values.length) def[key] = true
        else def[key] = values.length === 1 && key !== 'rect' && key !== 'origin' ? values[0] : values
        if (isOpen(peek())) { next(); skipBlock() }
        if (isMenu !== null && !KNOWN.has(key)) result.unknown.add(key)
      }
    }
    next()
    return def
  }

  // Commands split on ";", each as a list of words.
  function parseScript() {
    const commands = []
    let current = []
    let depth = 0
    while (i < tokens.length) {
      const t = next()
      if (!t.q && t.s === '{') depth++
      if (!t.q && t.s === '}' && depth-- === 0) break
      if (!t.q && t.s === ';') { if (current.length) commands.push(current); current = [] }
      else current.push(t.s)
    }
    if (current.length) commands.push(current)
    return commands
  }

  function parseList() {
    const values = []
    while (i < tokens.length && !isClose(peek())) {
      const t = next()
      if (t.q || (t.s !== ';' && t.s !== ',')) values.push(t.s)
    }
    next()
    return values
  }

  function skipBlock() {
    let depth = 0
    while (i < tokens.length) {
      const t = next()
      if (!t.q && t.s === '{') depth++
      if (!t.q && t.s === '}' && depth-- === 0) return
    }
  }
}

// Keywords the viewer either draws or knowingly ignores; anything else is reported by `info`.
const KNOWN = new Set([
  'rect', 'origin', 'style', 'border', 'bordersize', 'forecolor', 'backcolor', 'bordercolor', 'focuscolor', 'disablecolor', 'outlinecolor',
  'type', 'textfont', 'textscale', 'textalign', 'textalignx', 'textaligny', 'textstyle', 'visible', 'decoration', 'ownerdraw', 'ownerdrawflag',
  'fullscreen', 'blurworld', 'popup', 'maxchars', 'maxpaintchars', 'maxcharsgotonext', 'feeder', 'elementwidth', 'elementheight', 'elementtype',
  'columns', 'notselectable', 'noscrollbars', 'autowrapped', 'horizontalscroll', 'outofboundsclick', 'align', 'fadeclamp', 'fadecycle', 'fadeamount',
  'shadowx', 'shadowy', 'shadowcolor', 'dvarfloat', 'wrapped', 'legacysplitscreenscale', 'hiddenduringscope', 'hiddenduringflashbang', 'usepaging',
  'cursorsize', 'nocursor', 'gradientbar', 'fadeinamount', 'textalignmode',
])
