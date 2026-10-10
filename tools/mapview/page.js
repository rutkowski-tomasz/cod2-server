// The interactive page: viewer.html with the bundle, three.js and the viewer's modules inlined, as file:// pages
// cannot import files.
import { readFileSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inlineModules } from '../shared/inline.js'

const HERE = dirname(fileURLToPath(import.meta.url))

// `defaults` are view options, which URL hash params override. `addons` are script files that run after the viewer,
// each with its own local imports inlined and in a scope of its own; README.md says what they get.
export function buildPage(bundle, defaults, addons = []) {
  const script = [inlineModules(HERE, 'viewer.js'), ...addons.map((file) => `{\n${inlineModules(dirname(file), basename(file))}\n}`)].join('\n')
  return readFileSync(join(HERE, 'viewer.html'), 'utf8')
    .replace('__THREE__', threeUrl)
    .replace('__SCRIPT__', () => script)
    .replace('__BUNDLE__', () => JSON.stringify({ ...bundle, defaults }).replace(/</g, '\\u003c'))
}

// three.js ships as two ES modules; the page imports them from data URLs.
function threeUrl() {
  const dir = join(HERE, 'node_modules', 'three', 'build')
  const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  const core = dataUrl(readFileSync(join(dir, 'three.core.js'), 'utf8'))
  return dataUrl(readFileSync(join(dir, 'three.module.js'), 'utf8').replaceAll("'./three.core.js'", JSON.stringify(core)))
}
