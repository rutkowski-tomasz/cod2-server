// Serves the before/after comparisons in <area>/<what-changed>/ with an index at http://localhost:8642/, newest first.
import { createServer } from 'node:http'
import { createReadStream, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, extname, sep } from 'node:path'

const ROOT = import.meta.dirname
const PORT = 8642
const IMAGES = { '.png': 'image/png', '.jpg': 'image/jpeg' }
const TYPES = { ...IMAGES, '.html': 'text/html; charset=utf-8' }

const dirs = (dir) => readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name)

// Checkouts reset every mtime, so a committed folder is dated by its first commit, when its screenshots were taken.
function firstCommitTimes() {
  const times = new Map()
  let time
  for (const line of execFileSync('git', ['log', '--reverse', '--format=%at', '--name-only'], { cwd: ROOT, encoding: 'utf8' }).split('\n')) {
    if (/^\d+$/.test(line)) time = Number(line) * 1000
    else if (line) {
      const folder = line.split('/').slice(0, 2).join('/')
      if (!times.has(folder)) times.set(folder, time)
    }
  }
  return times
}

function comparisons() {
  const committed = firstCommitTimes()
  return dirs(ROOT).flatMap((area) => dirs(join(ROOT, area)).map((topic) => {
    const key = `${area}/${topic}`
    const dir = join(ROOT, key)
    const names = readdirSync(dir)
    const title = `${area}: ${topic.replace(/-/g, ' ')}`
    const files = names.filter((f) => IMAGES[extname(f)]).sort()
    const pages = new Set(names.filter((f) => extname(f) === '.html'))
    const time = committed.get(key) ?? Math.max(...names.map((f) => statSync(join(dir, f)).mtimeMs))
    return { key, title, files, pages, time }
  })).filter((c) => c.files.length).sort((a, b) => b.time - a.time)
}

// "roof_before.png" and "roof_after.png" form view "roof"; any other image is a view of its own.
function views(files) {
  const byView = new Map()
  for (const f of files) {
    const stem = f.slice(0, -extname(f).length)
    const view = stem.replace(/_(before|after)$/, '')
    const list = byView.get(view) ?? byView.set(view, []).get(view)
    list.push({ file: f, stem, label: stem === view ? '' : stem.slice(view.length + 1) })
  }
  return [...byView].map(([view, list]) => [view, list.sort((a, b) => (a.label === 'after') - (b.label === 'after'))])
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)
const href = (key, file) => `/${key}/${encodeURIComponent(file)}`
const when = (ms) => new Date(ms).toLocaleString('sv-SE').slice(0, 16)

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>
:root { --bg: #fafafa; --fg: #222; --muted: #777; --line: #ddd; --card: #fff; color-scheme: light dark }
@media (prefers-color-scheme: dark) { :root { --bg: #18181a; --fg: #ddd; --muted: #888; --line: #333; --card: #222225 } }
body { margin: 0; padding: 12px 16px; background: var(--bg); color: var(--fg); font: 13px/1.35 system-ui, sans-serif }
h1 { font-size: 15px; margin: 0 0 12px } h2 { font-size: 13px; margin: 16px 0 6px } a { color: inherit } .muted { color: var(--muted); font-weight: normal }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px }
.card { display: block; text-decoration: none; background: var(--card); border: 1px solid var(--line); border-radius: 4px; overflow: hidden }
.card:hover { border-color: var(--muted) }
.card img { aspect-ratio: 4 / 3; width: 100%; object-fit: cover; display: block; background: var(--line) }
.card div { padding: 5px 7px; font-size: 12px }
.pair { display: flex; flex-wrap: wrap; gap: 12px } figure { margin: 0; flex: 1 1 0; min-width: min(100%, 320px) }
figure img { display: block; width: 100%; border: 1px solid var(--line) } figcaption { margin-top: 3px; color: var(--muted) }
</style></head><body>${body}</body></html>`
}

function index() {
  const cards = comparisons().map((c) => {
    const [, firstView] = views(c.files)[0]
    const cover = firstView.at(-1)
    return `<a class="card" href="/?c=${encodeURIComponent(c.key)}"><img src="${href(c.key, cover.file)}" loading="lazy" alt="">
<div>${esc(c.title)}<br><span class="muted">${when(c.time)}</span></div></a>`
  })
  return page('Before and after', `<h1>Before and after</h1><div class="grid">${cards.join('')}</div>`)
}

function detail(key) {
  const c = comparisons().find((c) => c.key === key)
  if (!c) return undefined
  const rows = views(c.files).map(([view, list]) => `<h2>${esc(view)}</h2><div class="pair">${list.map((i) =>
    `<figure><a href="${href(c.key, i.file)}"><img src="${href(c.key, i.file)}" alt=""></a><figcaption>${esc(i.label || i.file)}${c.pages.has(`${i.stem}.html`) ? ` · <a href="${href(c.key, `${i.stem}.html`)}">interactive</a>` : ''}</figcaption></figure>`).join('')}</div>`)
  return page(c.title, `<h1><a href="/">Before and after</a> / ${esc(c.title)} <span class="muted">${when(c.time)}</span></h1>${rows.join('')}`)
}

function respond(req, res) {
  const url = new URL(req.url, 'http://x')
  const path = decodeURIComponent(url.pathname)
  if (path === '/') {
    const key = url.searchParams.get('c')
    const html = key ? detail(key) : index()
    if (!html) return res.writeHead(404).end('not found')
    return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(html)
  }
  const file = join(ROOT, path)
  const type = TYPES[extname(file)]
  if (!file.startsWith(ROOT + sep) || !type || !statSync(file, { throwIfNoEntry: false })?.isFile()) return res.writeHead(404).end('not found')
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' })
  createReadStream(file).pipe(res)
}

createServer((req, res) => {
  try {
    respond(req, res)
  } catch {
    res.writeHead(400).end('bad request')
  }
}).listen(PORT, '127.0.0.1', () => console.log(`serving ${ROOT} at http://localhost:${PORT}/`))
