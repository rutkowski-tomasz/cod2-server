// The game's sound aliases, from every soundaliases/*.csv in the sources: by lowercase name, the entries an alias
// has, of which the game picks one each time it plays, each with the maps it loads on (`loadsOn`).

// The game's defaults for an entry's empty fields.
const DEFAULTS = { vol_min: 1, vol_max: 1, pitch_min: 1, pitch_max: 1, dist_min: 120, dist_max: 1000000 }
// Channels the game plays without a position, heard the same anywhere.
const FLAT_CHANNEL = /2d$|^(local|music|announcer|menu)$/

// Read once for each search, as a search's sources do not change.
const read = new WeakMap()

export function readSoundAliases(search) {
  if (!read.has(search)) read.set(search, parseAliases(search))
  return read.get(search)
}

function parseAliases(search) {
  const aliases = new Map()
  for (const path of search.list('soundaliases/')) {
    if (!path.toLowerCase().endsWith('.csv')) continue
    let keys = null
    for (const row of parseCsv(search.read(path).toString('latin1'))) {
      if (!row[0] || row[0].startsWith('#')) continue
      if (!keys) {
        keys = row
        continue
      }
      const fields = Object.fromEntries(keys.map((k, i) => [k, row[i] ?? '']))
      const name = fields.name.toLowerCase()
      if (!aliases.has(name)) aliases.set(name, [])
      aliases.get(name).push(entryOf(fields))
    }
  }
  return aliases
}

function entryOf(fields) {
  // The game reads a number as atof does, so one such as `.` is 0.
  const number = (key) => (fields[key] === '' || fields[key] === undefined ? DEFAULTS[key] : +fields[key] || 0)
  return {
    file: `sound/${fields.file.replace(/\\/g, '/')}`,
    volMin: number('vol_min'),
    volMax: number('vol_max'),
    pitchMin: number('pitch_min'),
    pitchMax: number('pitch_max'),
    distMin: number('dist_min'),
    distMax: number('dist_max'),
    flat: FLAT_CHANNEL.test(fields.channel ?? ''),
    delayMs: +(fields.startdelay || 0),
    secondary: fields.secondaryaliasname || null,
    loadspec: (fields.loadspec ?? '').toLowerCase().split(/\s+/).filter(Boolean),
  }
}

// Whether a multiplayer game on `map` loads an entry: one without a loadspec loads everywhere, one whose list starts
// with `!` everywhere but on the maps listed, and any other on all_mp or the maps it names.
export function loadsOn(entry, map) {
  const names = entry.loadspec
  if (!names.length) return true
  const excluding = names[0].startsWith('!')
  const listed = names.map((n) => n.replace(/^!/, '')).includes(map.toLowerCase())
  return excluding ? !listed : listed || names.includes('all_mp')
}

// Rows of comma-separated fields; a field in double quotes can hold commas, and "" stands for a quote.
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') field += text[++i]
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field || row.length) rows.push([...row, field])
  return rows
}
