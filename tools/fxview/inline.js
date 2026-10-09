// The page runs from file://, where module imports are blocked. Each local module becomes a scoped block,
// inlined once before its first user, and its imports become reads from that block.
import { readFileSync } from 'node:fs'
import { join, basename } from 'node:path'

export function inlineModules(dir, entry) {
  const blocks = []
  const names = new Map()
  const load = (file) => {
    if (names.has(file)) return names.get(file)
    const source = readFileSync(join(dir, file), 'utf8')
    const body = source.replace(/^import \{([^}]+)\} from '\.\/([\w-]+\.js)'$/gm, (_, imported, dep) => `const {${imported}} = ${load(dep)}`)
    if (/^import /m.test(body)) throw new Error(`${file}: only single-line named imports of local files can be inlined`)
    const exported = [...body.matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1])
    const name = `module_${basename(file, '.js').replace(/-/g, '_')}`
    names.set(file, name)
    blocks.push(`const ${name} = (() => {\n${body.replace(/^export /gm, '')}\nreturn { ${exported.join(', ')} }\n})()`)
    return name
  }
  load(entry)
  return blocks.join('\n')
}
