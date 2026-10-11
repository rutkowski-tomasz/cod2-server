// The interactive page: viewer.html with the bundle, three.js and the viewer's modules inlined, as file:// pages
// cannot import files.
import { readFileSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inlineModules, threeModuleUrl } from '../shared/inline.js'

const HERE = dirname(fileURLToPath(import.meta.url))

// `defaults` are view options, which URL hash params override. `addons` are script files that run after the viewer,
// each with its own local imports inlined and in a scope of its own; README.md says what they get.
export function buildPage(bundle, defaults, addons = []) {
  const script = [inlineModules(HERE, 'viewer.js'), ...addons.map((file) => `{\n${inlineModules(dirname(file), basename(file))}\n}`)].join('\n')
  return readFileSync(join(HERE, 'viewer.html'), 'utf8')
    .replace('__THREE__', () => threeModuleUrl(join(HERE, 'node_modules')))
    .replace('__SCRIPT__', () => script)
    .replace('__BUNDLE__', () => JSON.stringify({ ...bundle, defaults }).replace(/</g, '\\u003c'))
}
