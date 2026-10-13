// Runs the Mod Tools' converter under wine in mapcompile's Docker image, on one GDT and the files it names.
import { spawn, execFileSync } from 'node:child_process'
import { join } from 'node:path'

const MAPCOMPILE = join(import.meta.dirname, '..', 'mapcompile')
// Folders the converter writes to under main/; images/$identitynormalmap.iwi, which it adds for every lit
// material, is stock.
const OUTPUTS = ['xmodel', 'xmodelparts', 'xmodelsurfs', 'materials', 'images']

const CONTEXT = ['--context', 'desktop-linux']

// `work` holds source_data/<name>.gdt and what it names under model_export/ and texture/; the converted files go
// to `out`. The stock GDTs are removed first, so only ours is converted.
export async function convert(work, out) {
  execFileSync('docker', [...CONTEXT, 'build', '--platform', 'linux/amd64', '-q', '-t', 'cod2-mapcompile', MAPCOMPILE], { stdio: ['ignore', 'ignore', 'inherit'] })
  const container = `modelimport-${process.pid}`
  const script = `
    set -e
    rm -f /cod2/source_data/*.gdt /cod2/aitype/*.gdt
    for d in source_data model_export texture; do cp -r /w/$d /cod2/; done
    cd /cod2/bin && xvfb-run -a wine converter.exe -nopause -nocachedownload
    cd /cod2/main && rm -f 'images/$identitynormalmap.iwi'
    for d in ${OUTPUTS.join(' ')}; do if [ -d $d ]; then cp -r $d /out/; fi; done`
  const log = []
  // On an error the converter asks whether to continue, reading the console rather than stdin, so it is stopped.
  const code = await new Promise((done) => {
    const p = spawn('docker', [...CONTEXT, 'run', '--rm', '--name', container, '--platform', 'linux/amd64', '-v', `${work}:/w:ro`, '-v', `${out}:/out`, 'cod2-mapcompile', 'bash', '-c', script])
    let stopped = false
    const read = (chunk) => {
      log.push(chunk.toString())
      if (stopped || !log.join('').includes('Continue? (')) return
      stopped = true
      spawn('docker', [...CONTEXT, 'kill', container], { stdio: 'ignore' })
    }
    p.stdout.on('data', read)
    p.stderr.on('data', read)
    p.on('close', done)
  })
  const text = log.join('').replace(/\r/g, '')
  const errors = [...text.matchAll(/\*+ ERROR \*+\n([\s\S]*?)(?=\n\n|Continue\?)/g)].map((m) => m[1].trim())
  if (code || errors.length) throw new Error(`converter failed:\n${errors.join('\n') || text.split('\n').slice(-20).join('\n')}`)
}
