#!/usr/bin/env node
import { homedir } from 'node:os'
import { join } from 'node:path'
import { membraneObservation, membraneConflicts, membraneRefusal } from './become.mjs'
import { isMainModule } from '../lib/is-main.mjs'

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 2 || args[0] !== '--support' || !args[1])) {
    process.stderr.write('usage: witness.mjs [--support <dir>]\n'); process.exit(2)
  }
  const support = args[1] ?? process.env.AUKORA_SUPPORT_ROOT ?? join(homedir(), 'Library', 'Application Support', 'AUKORA')
  const observed = membraneObservation(support)
  for (const [name, row] of Object.entries(observed.chains)) {
    process.stdout.write(`${name} size=${row.presentedSize ?? '?'} ${row.verdict} ${row.reason}${row.unterminatedTailBytes ? ` unterminated_tail_bytes=${row.unterminatedTailBytes}` : ''}\n`)
    if (row.rotation) process.stdout.write(`${name} rotation=${row.rotation.reason} previous=${row.rotation.previousFile} previous_unterminated_tail_bytes=${row.rotation.previousUnterminatedTailBytes ?? '?'}\n`)
  }
  const refusal = membraneRefusal(observed)
  if (refusal) process.stdout.write(`REFUSED: ${refusal}\n`)
  process.stdout.write('Exit 0 means become permits this observation; first observations remain unverified.\n')
  process.exitCode = refusal ? (membraneConflicts(observed).length ? 1 : 2) : 0
}
