// Parses CoD2 text .efx into { elements: [{ type, name, ...keys }] }.
// Keys with one value become that value, several values an array,
// `{}` blocks nested objects, `[]` lists arrays of rows.
export function parseEfx(text) {
  // Some shipped files carry a stray non-ASCII byte after a brace, which the game ignores.
  const lines = text.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map((l) => l.replace(/[^\x20-\x7e]/g, ' ').trim()).filter((l) => l && !l.startsWith('//'))
  let i = 0
  const elements = []
  while (i < lines.length) {
    const type = lines[i++]
    if (lines[i] !== '{') throw new Error(`expected { after ${type} at line ${i}`)
    i++
    const body = parseBlock()
    elements.push({ type, ...body })
  }
  return { elements }

  function parseBlock() {
    const obj = {}
    while (i < lines.length) {
      const line = lines[i++]
      if (line === '}') return obj
      const [key, ...rest] = line.split(/\s+/)
      if (lines[i] === '{') {
        i++
        obj[key] = parseBlock()
      } else if (lines[i] === '[') {
        i++
        obj[key] = parseList()
      } else {
        obj[key] = rest.map(num)
      }
    }
    throw new Error('unterminated block')
  }

  function parseList() {
    const rows = []
    while (i < lines.length) {
      const line = lines[i++]
      if (line === ']') return rows
      const row = line.split(/\s+/).map(num)
      rows.push(row.length === 1 ? row[0] : row)
    }
    throw new Error('unterminated list')
  }

  function num(tok) {
    const n = Number(tok)
    return Number.isNaN(n) ? tok : n
  }
}
