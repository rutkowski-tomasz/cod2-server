// Interactive page around draw.js: opens the bundled menus, runs their scripts on hover, click and keys, and captures headless shots.
import { createRenderer, isFocusable } from './draw.js'

const bundle = JSON.parse(document.getElementById('bundle').textContent)
const defaults = bundle.defaults
const $ = (id) => document.getElementById(id)
const canvas = $('screen')
const menus = bundle.menus
const images = {}
const draw = createRenderer(canvas, bundle, images)

let state
let outline = defaults.outline
let bg = defaults.bg

// ---------- state and scripts ----------
function reset() {
  state = { dvars: new Map(Object.entries(defaults.dvars)), open: [], items: new Map(), hover: null, log: [], warnings: new Set() }
  for (const menu of menus) for (const item of menu.items) {
    state.items.set(item, { visible: !!item.visible, forecolor: item.forecolor ?? [1, 1, 1, 1], backcolor: item.backcolor ?? [0, 0, 0, 0], bordercolor: item.bordercolor ?? [0, 0, 0, 0] })
  }
  const named = defaults.menus.map(findMenu)
  for (const [i, m] of named.entries()) if (!m) state.warnings.add(`no menu named ${defaults.menus[i]}`)
  const initial = named.length ? named.filter(Boolean) : menus.filter((m) => m.visible)
  for (const menu of initial.length ? initial : menus.slice(0, 1)) openMenu(menu)
  // In game the scripts fill dvars after onOpen has reset them, so the given values win over onOpen.
  for (const [name, value] of Object.entries(defaults.dvars)) state.dvars.set(name, value)
}

const findMenu = (name) => menus.find((m) => m.name?.toLowerCase() === String(name).toLowerCase())
const itemsNamed = (menu, name) => menu.items.filter((it) => it.name?.toLowerCase() === name.toLowerCase() || it.group?.toLowerCase() === name.toLowerCase())
const topMenu = () => state.open.at(-1)
const menuOf = (item) => menus.find((m) => m.items.includes(item))

function openMenu(menu) {
  if (state.open.includes(menu)) state.open.splice(state.open.indexOf(menu), 1)
  state.open.push(menu)
  run(menu.onopen, menu, null)
}

function closeMenu(menu) {
  if (!state.open.includes(menu)) return
  state.open.splice(state.open.indexOf(menu), 1)
  run(menu.onclose, menu, null)
}

function run(script, menu, item) {
  for (const [op, ...a] of script ?? []) {
    switch (op.toLowerCase()) {
      case 'show': case 'fadein': for (const it of itemsNamed(menu, a[0] ?? '')) state.items.get(it).visible = true; break
      case 'hide': case 'fadeout': for (const it of itemsNamed(menu, a[0] ?? '')) state.items.get(it).visible = false; break
      case 'setcolor': if (item) state.items.get(item)[a[0].toLowerCase()] = a.slice(1, 5).map(Number); break
      case 'setitemcolor': for (const it of itemsNamed(menu, a[0] ?? '')) state.items.get(it)[a[1].toLowerCase()] = a.slice(2, 6).map(Number); break
      case 'setdvar': state.dvars.set(a[0], a[1] ?? ''); break
      case 'play': break
      case 'open': {
        const target = findMenu(a[0])
        if (target) openMenu(target)
        else log(menu, `open ${a[0]} (not in this file)`)
        break
      }
      case 'close': {
        const target = a[0]?.toLowerCase() === 'self' ? menu : findMenu(a[0])
        if (target) closeMenu(target)
        else log(menu, `close ${a[0]} (not in this file)`)
        break
      }
      default: log(menu, [op, ...a].join(' '))
    }
  }
}

function log(menu, text) {
  state.log.push(`${menu.name}: ${text}`)
}

// ---------- interaction ----------
function itemAt(px, py) {
  for (let m = state.open.length - 1; m >= 0; m--) {
    const items = state.open[m].items
    for (let i = items.length - 1; i >= 0; i--) {
      const [x, y, w, h] = items[i].box
      if (isFocusable(state, items[i]) && px >= x && px < x + w && py >= y && py < y + h) return { menu: state.open[m], item: items[i] }
    }
  }
  return null
}

function setHover(hit) {
  if (hit?.item === state.hover) return
  if (state.hover) {
    const menu = menuOf(state.hover)
    run(state.hover.mouseexit, menu, state.hover)
    run(state.hover.leavefocus, menu, state.hover)
  }
  state.hover = hit?.item ?? null
  if (hit) {
    run(hit.item.mouseenter, hit.menu, hit.item)
    run(hit.item.onfocus, hit.menu, hit.item)
  }
}

function refresh() {
  const hide = document.body.classList.contains('hideui')
  const availW = innerWidth - (hide ? 0 : 280)
  const scale = Math.min(availW / 640, innerHeight / 480)
  canvas.style.width = `${640 * scale}px`
  canvas.style.height = `${480 * scale}px`
  draw(state, { width: Math.round(640 * scale * devicePixelRatio), height: Math.round(480 * scale * devicePixelRatio), outline, bg })
  updatePanel()
}

function updatePanel() {
  const box = $('menus')
  box.innerHTML = ''
  for (const menu of menus) {
    const label = document.createElement('label')
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = state.open.includes(menu)
    input.onchange = () => { input.checked ? openMenu(menu) : closeMenu(menu); refresh() }
    label.append(input, ` ${menu.name} (${menu.items.length})`)
    box.appendChild(label)
  }
  const dvars = $('dvars')
  if (!dvars.contains(document.activeElement)) {
    dvars.innerHTML = ''
    for (const name of [...new Set([...bundle.referencedDvars, ...state.dvars.keys()])].sort()) {
      const label = document.createElement('label')
      const span = document.createElement('span')
      span.textContent = name
      const input = document.createElement('input')
      input.type = 'text'
      input.value = state.dvars.get(name) ?? ''
      input.oninput = () => { state.dvars.set(name, input.value); refresh() }
      label.append(span, input)
      dvars.appendChild(label)
    }
  }
  $('item').textContent = state.hover ? describe(state.hover) : ''
  $('log').textContent = state.log.slice(-40).join('\n')
  $('warn').textContent = [...state.warnings].join('\n')
}

function describe(item) {
  const menu = menuOf(item)
  const lines = [`${menu.name} #${menu.items.indexOf(item)}${item.name ? ` "${item.name}"` : ''}${item.group ? ` group ${item.group}` : ''}`, `box ${item.box.map((n) => Math.round(n * 10) / 10).join(' ')}`]
  for (const k of ['typeName', 'style', 'text', 'dvar', 'dvartest', 'showdvar', 'hidedvar', 'background']) if (item[k] !== undefined) lines.push(`${k} ${JSON.stringify(item[k])}`)
  for (const k of ['mouseenter', 'mouseexit', 'action']) if (item[k]) lines.push(`${k}: ${item[k].map((c) => c.join(' ')).join('; ')}`)
  return lines.join('\n')
}

function toVirtual(e) {
  const r = canvas.getBoundingClientRect()
  return [((e.clientX - r.left) / r.width) * 640, ((e.clientY - r.top) / r.height) * 480]
}

canvas.addEventListener('mousemove', (e) => { setHover(itemAt(...toVirtual(e))); refresh() })
canvas.addEventListener('mouseleave', () => { setHover(null); refresh() })
canvas.addEventListener('click', (e) => {
  const hit = itemAt(...toVirtual(e))
  if (hit) run(hit.item.action, hit.menu, hit.item)
  refresh()
})
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return
  const menu = topMenu()
  const script = menu?.execkeys?.[e.key] ?? menu?.execkeys?.[e.key.toLowerCase()]
  if (e.key === 'Escape' && menu) run(menu.onesc, menu, null)
  else if (script) run(script, menu, null)
  else if (e.key === 'h') document.body.classList.toggle('hideui')
  else if (e.key === 'r') reset()
  else return
  refresh()
})
addEventListener('resize', refresh)
$('outline').checked = outline
$('outline').onchange = () => { outline = $('outline').checked; refresh() }
$('bg').value = bg
$('bg').onchange = () => { bg = $('bg').value; refresh() }
$('title').textContent = bundle.path

// ---------- startup and headless capture ----------
Promise.all(Object.entries(bundle.images).map(([name, { png }]) => new Promise((done) => {
  const img = new Image()
  img.onload = () => { images[name] = img; done() }
  img.onerror = done
  img.src = png
}))).then(() => {
  reset()
  refresh()
  window.menuReady = true
})

window.menuview = {
  // `click`, then `hover`: name, text or #index of an item. Click runs its action, hover leaves the mouse on it.
  capture({ width, height, hover, click }) {
    const find = (key) => {
      const matches = (it, i) => it.name === key || it.text === key || `#${i}` === key
      const hit = state.open.flatMap((menu) => menu.items.filter((it, i) => matches(it, i) && isFocusable(state, it)).map((item) => ({ menu, item }))).at(-1)
      if (!hit) state.warnings.add(`no visible interactive item ${key}`)
      return hit ?? null
    }
    if (click) {
      const hit = find(click)
      if (hit) run(hit.item.action, hit.menu, hit.item)
    }
    if (hover) setHover(find(hover))
    draw(state, { width, height, outline, bg })
    return { png: canvas.toDataURL('image/png'), open: state.open.map((m) => m.name), log: state.log, warnings: [...state.warnings] }
  },
}
