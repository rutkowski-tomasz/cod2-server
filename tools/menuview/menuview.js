#!/usr/bin/env node
// CoD2 .menu viewer: builds a standalone HTML page, renders it headlessly to PNG, prints the menu structure.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createSearch } from '../fxview/assets.js'
import { buildBundle } from './bundle.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const USAGE = `usage:
  menuview.js view   <menu-file | ui_mp/path> [-o out.html] [--open]   build an interactive page
  menuview.js render <menu-file | ui_mp/path> [-o out.png] [options]    headless screenshot
  menuview.js info   <menu-file | ui_mp/path> [--json]                  menus, items, boxes, missing assets
  menuview.js list   [prefix]                                           .menu files found in the sources

options:
  --source <dir|iwd>   extra asset source, repeatable; mod folders beat stock
  --menu a,b           menuDefs to open (default: those with visible 1, else the first)
  --dvar name=value    dvar value, repeatable; drives dvar text, dvartest and DVAR_SHADER images
  --dvars <file.json>  sample dvar values to start from (default: dvars.json next to this script)
  --empty              start with no sample dvar values
  --hover <item>       put the mouse on this item (name, text or #index) first, running its mouseEnter (render)
  --click <item>       run this item's action first, such as switching a tab (render)
  --outline            draw item boxes and names
  --size 1280x960      image size (render)
  --bg mid|dark|light|checker|black`

const args = process.argv.slice(2)
const cmd = args.shift()
const opts = { source: [], dvar: [] }
const positional = []
while (args.length) {
  const a = args.shift()
  if (a === '-o') opts.out = args.shift()
  else if (a === '--source' || a === '--dvar') opts[a.slice(2)].push(args.shift())
  else if (a === '--open' || a === '--json' || a === '--outline' || a === '--empty') opts[a.slice(2)] = true
  else if (a.startsWith('--')) opts[a.slice(2)] = args.shift()
  else positional.push(a)
}

// In game the scripts fill these dvars; samples keep previews from looking empty. --dvar wins over samples.
const samples = opts.empty ? {} : JSON.parse(readFileSync(opts.dvars ?? join(HERE, 'dvars.json'), 'utf8'))
const dvars = { ...samples, ...Object.fromEntries(opts.dvar.map((d) => [d.slice(0, d.indexOf('=')), d.slice(d.indexOf('=') + 1)])) }
const search = createSearch(opts.source)

switch (cmd) {
  case 'view': view(); break
  case 'render': await render(); break
  case 'info': info(); break
  case 'list': list(); break
  default: console.error(USAGE); process.exit(1)
}

function target() {
  if (!positional[0]) { console.error(USAGE); process.exit(1) }
  return positional[0]
}

function outName(ext) {
  const out = opts.out ?? join(HERE, 'out', `${basename(target(), '.menu')}.${ext}`)
  mkdirSync(dirname(out), { recursive: true })
  return out
}

function load() {
  const bundle = buildBundle(target(), search, dvars)
  if (!bundle.menus.length) { console.error(`${bundle.path}: no menuDef; it is a fragment that other menus #include`); process.exit(1) }
  return bundle
}

function buildHtml(bundle) {
  const defaults = { menus: opts.menu ? opts.menu.split(',') : [], dvars, outline: !!opts.outline, bg: opts.bg ?? 'mid' }
  return readFileSync(join(HERE, 'viewer.html'), 'utf8')
    .replace('__SCRIPT__', () => readFileSync(join(HERE, 'viewer.js'), 'utf8'))
    .replace('__BUNDLE__', () => JSON.stringify({ ...bundle, defaults }).replace(/</g, '\\u003c'))
}

function view() {
  const bundle = load()
  const out = outName('html')
  writeFileSync(out, buildHtml(bundle))
  console.log(out)
  reportMissing(bundle)
  if (opts.open) execFileSync('open', [out])
}

async function render() {
  const bundle = load()
  const out = outName('png')
  const html = join(dirname(out), `${basename(out, '.png')}.html`)
  writeFileSync(html, buildHtml(bundle))
  const [width, height] = (opts.size ?? '1280x960').split('x').map(Number)
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: width + 300, height } })
    page.on('pageerror', (e) => console.error('page error:', e.message))
    await page.goto(pathToFileURL(html).href)
    await page.waitForFunction('window.menuReady', null, { timeout: 60000 })
    const result = await page.evaluate((o) => window.menuview.capture(o), { width, height, hover: opts.hover, click: opts.click })
    writeFileSync(out, Buffer.from(result.png.split(',')[1], 'base64'))
    console.log(out)
    console.log(`open menus: ${result.open.join(', ')}`)
    for (const l of result.log) console.log(`script: ${l}`)
    for (const w of result.warnings) console.log(`warning: ${w}`)
    reportMissing(bundle)
  } finally {
    await browser.close()
  }
}

function info() {
  const bundle = load()
  const data = {
    path: bundle.path,
    menus: bundle.menus.map(({ items, ...menu }) => ({ ...menu, items: items.map((it, index) => ({ index, ...it })) })),
    dvars: bundle.referencedDvars,
    unknownKeywords: bundle.unknownKeywords,
    missing: bundle.missing,
  }
  if (opts.json) { console.log(JSON.stringify(data, null, 2)); return }
  console.log(`${bundle.path}: ${bundle.menus.length} menu(s)`)
  for (const menu of bundle.menus) {
    console.log(`\nmenu ${menu.name}  box ${menu.box.join(' ')}${menu.visible ? '  visible' : ''}${menu.popup ? '  popup' : ''}  ${menu.items.length} items`)
    menu.items.forEach((it, i) => {
      const what = [
        it.typeName ?? (it.type !== undefined ? `type ${it.type}` : ''),
        it.ownerdrawName ?? (it.ownerdraw !== undefined ? `ownerdraw ${it.ownerdraw}` : ''),
        it.text !== undefined ? JSON.stringify(it.text.length > 40 ? `${it.text.slice(0, 40)}…` : it.text) : '',
        it.dvar ? `dvar ${it.dvar}` : '',
        it.background ? `image ${it.background}` : '',
        it.dvartest ? `if ${it.dvartest} ${it.showdvar ? `in ${it.showdvar.join('|')}` : `not in ${(it.hidedvar ?? []).join('|')}`}` : '',
        it.visible ? '' : 'hidden',
        it.decoration ? '' : 'interactive',
      ].filter(Boolean).join('  ')
      console.log(`  #${String(i).padEnd(3)} ${(it.name ?? '').padEnd(22)} ${it.box.map((n) => Math.round(n)).join(' ').padEnd(16)} ${what}`)
    })
  }
  if (bundle.referencedDvars.length) console.log(`\ndvars: ${bundle.referencedDvars.join(', ')}`)
  if (bundle.unknownKeywords.length) console.log(`unknown keywords (not drawn): ${bundle.unknownKeywords.join(', ')}`)
  reportMissing(bundle)
}

function list() {
  for (const n of search.list(positional[0] ?? 'ui')) if (n.endsWith('.menu')) console.log(n)
}

function reportMissing(bundle) {
  const unset = bundle.referencedDvars.filter((d) => !(d in dvars) && !bundle.scriptDvars.includes(d))
  if (unset.length) console.log(`dvars without a value: ${unset.join(', ')}`)
  const m = bundle.missing
  if (m.includes.length) console.log(`missing includes: ${m.includes.join(', ')}`)
  if (m.images.length) console.log(`missing images: ${m.images.join(', ')}`)
  if (m.fonts.length) console.log(`missing fonts: ${m.fonts.join(', ')}`)
  if (m.strings.length) console.log(`missing strings: ${m.strings.join(', ')}`)
}
