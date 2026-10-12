// The interactive page: viewer.html with the bundle, three.js and the viewer's modules inlined, as file:// pages
// cannot import files.
import { readFileSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inlineModules, threeModuleUrl } from '../shared/inline.js'

const HERE = dirname(fileURLToPath(import.meta.url))

// `defaults` are view options, which URL hash params override. `addons` are script files that run after the viewer,
// each with its own local imports inlined and in a scope of its own; README.md says what they get. A server can send
// three.js and the bundle apart, so browsers cache them: `urls.three` is three.module.js's URL, starting with ./, and
// `urls.bundle` the URL of `bundleJson(bundle, defaults)`, with `bundle` unused.
export function buildPage(bundle, defaults, addons = [], urls = {}) {
  const script = [inlineModules(HERE, 'viewer.js'), ...addons.map((file) => `{\n${inlineModules(dirname(file), basename(file))}\n}`)].join('\n')
  const page = readFileSync(join(HERE, 'viewer.html'), 'utf8')
    .replace('__THREE__', () => urls.three ?? threeModuleUrl(join(HERE, 'node_modules')))
    .replace('__SCRIPT__', () => script)
  if (urls.bundle) return page.replace('<script id="bundle" type="application/json">__BUNDLE__', () => `<script id="bundle" type="application/json" data-src="${urls.bundle}">`)
  return page.replace('__BUNDLE__', () => bundleJson(bundle, defaults).replace(/</g, '\\u003c'))
}

// The bundle as the page reads it, with its view options.
export function bundleJson(bundle, defaults) {
  return JSON.stringify({ ...bundle, defaults })
}
