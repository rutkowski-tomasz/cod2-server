// The subset of the C preprocessor that menus use: #include, #define with parameters, ## pasting, #ifdef/#ifndef/#else/#endif.
// Output is a token list: { s: string, q: quoted }.

// `read(path)` returns the text of an included file or null.
export function preprocess(text, read) {
  const macros = new Map()
  const missing = []
  const out = []
  run(text, [])
  return { tokens: out, macros, missing }

  // Lines are buffered until the next directive so a macro call may span lines.
  function run(source, includeStack) {
    const skip = []
    let pending = []
    const flush = () => { out.push(...expand(pending, new Set())); pending = [] }
    for (const line of lines(source)) {
      const directive = line.match(/^\s*#\s*(\w+)\s*(.*)$/)
      if (directive) {
        flush()
        const [, name, rest] = directive
        if (name === 'ifdef' || name === 'ifndef') skip.push(skip.at(-1) || (name === 'ifdef') !== macros.has(rest.trim()))
        else if (name === 'if') skip.push(skip.at(-1) || rest.trim() === '0')
        else if (name === 'else') skip.push(!skip.pop() || skip.at(-1) === true)
        else if (name === 'endif') skip.pop()
        else if (skip.at(-1)) continue
        else if (name === 'define') define(rest)
        else if (name === 'undef') macros.delete(rest.trim())
        else if (name === 'include') {
          const path = rest.trim().replace(/^["<]|[">]$/g, '')
          const included = includeStack.includes(path) ? null : read(path)
          if (included === null) missing.push(path)
          else run(included, [...includeStack, path])
        }
        continue
      }
      if (!skip.at(-1)) pending.push(...tokenize(line))
    }
    flush()
  }

  function define(rest) {
    const m = rest.match(/^(\w+)(\(([^)]*)\))?\s*(.*)$/)
    if (!m) return
    const params = m[2] ? m[3].split(',').map((p) => p.trim()).filter(Boolean) : null
    macros.set(m[1], { params, body: tokenize(m[4]) })
  }

  function expand(tokens, active) {
    const result = []
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]
      const macro = !t.q && macros.get(t.s)
      if (!macro || active.has(t.s)) { result.push(t); continue }
      if (!macro.params) {
        result.push(...expand(macro.body, new Set([...active, t.s])))
        continue
      }
      if (tokens[i + 1]?.s !== '(' || tokens[i + 1].q) { result.push(t); continue }
      const args = [[]]
      let depth = 0
      let j = i + 2
      for (; j < tokens.length; j++) {
        const a = tokens[j]
        if (!a.q && a.s === '(') depth++
        if (!a.q && a.s === ')' && depth-- === 0) break
        if (!a.q && a.s === ',' && depth === 0) args.push([])
        else args.at(-1).push(a)
      }
      i = j
      const bound = new Map(macro.params.map((p, k) => [p, expand(args[k] ?? [], active)]))
      const body = []
      for (const b of macro.body) body.push(...(!b.q && bound.has(b.s) ? bound.get(b.s) : [b]))
      result.push(...expand(paste(body), new Set([...active, t.s])))
    }
    return result
  }
}

// Pasting a quoted string to a name keeps the result quoted, like the game does for `"hl" ## _hl`.
function paste(tokens) {
  const out = []
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].s === '##' && !tokens[i].q && out.length && tokens[i + 1]) {
      const left = out.pop()
      const right = tokens[++i]
      out.push({ s: left.s + right.s, q: left.q || right.q })
    } else out.push(tokens[i])
  }
  return out
}

// Logical lines: comments removed (outside strings), backslash continuations joined.
function lines(source) {
  let text = ''
  let inString = false
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (inString) {
      text += c
      if (c === '"' || c === '\n') inString = false
    } else if (c === '"') {
      inString = true
      text += c
    } else if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++
      i--
    } else if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      const body = source.slice(i, end < 0 ? source.length : end + 2)
      text += body.replace(/[^\n]/g, '')
      i = end < 0 ? source.length : end + 1
    } else text += c
  }
  return text.replace(/\r/g, '').replace(/\\[ \t]*\n/g, ' ').split('\n')
}

export function tokenize(text) {
  const tokens = []
  const re = /"([^"\n]*)"?|##|[{}(),;]|[^\s{}(),;"]+/g
  for (const m of text.matchAll(re)) tokens.push(m[1] !== undefined ? { s: m[1], q: true } : { s: m[0], q: false })
  return tokens
}
