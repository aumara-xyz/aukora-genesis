#!/usr/bin/env node
/** Human-terminal entry for offline developer KIRA recovery; never starts or stops services. */
import { randomBytes } from 'node:crypto'
import { createTerminalLines } from '../aukora/supervisor/developer-terminal.mjs'
import { inspectWebRecovery, recoverWebStore } from './aukora-web-recover.mjs'

let terminal
const interruption = new AbortController()
const interrupted = () => interruption.abort()
process.once('SIGINT', interrupted)
process.once('SIGTERM', interrupted)
try {
  const args = process.argv.slice(2)
  if (args.length !== 5 || args[0] !== '--data-dir' || args[2] !== '--expect-head'
    || !['--check', '--apply'].includes(args[4])) {
    throw new Error('usage: node scripts/aukora-web-recover-bin.mjs --data-dir ABSOLUTE --expect-head HEX --check|--apply')
  }
  if (args[4] === '--apply' && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    throw new Error('web-recovery:attended-terminal-required')
  }
  const plan = inspectWebRecovery({ dataDir: args[1], expectedHead: args[3] })
  process.stdout.write(`${JSON.stringify(plan)}\n`)
  if (args[4] === '--apply') {
    const challenge = `recover ${randomBytes(8).toString('hex')}`
    terminal = createTerminalLines()
    process.stderr.write('OFFLINE RECOVERY — private backup includes signing keys. Only the dead lease and seal device number change.\n'
      + 'Historical volume identity and issuer signatures are NOT verified. No activation change or broker launch.\n'
      + `Type "${challenge}" to accept this exact observation: `)
    const deadline = AbortSignal.timeout(120_000)
    let answer
    try { answer = await terminal.read(AbortSignal.any([interruption.signal, deadline])) }
    catch (error) {
      if (interruption.signal.aborted) throw new Error('web-recovery:operator-interrupted')
      if (deadline.aborted) throw new Error('web-recovery:approval-expired')
      if (error?.message === 'supervisor: approval input closed') throw new Error('web-recovery:approval-input-closed')
      throw error
    }
    if (interruption.signal.aborted) throw new Error('web-recovery:operator-interrupted')
    if (answer !== challenge) throw new Error('web-recovery:operator-declined')
    process.stdout.write(`${JSON.stringify(recoverWebStore(plan))}\n`)
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: 'REFUSED', reason: error.message,
    backupDir: error.backupDir, leaseArchived: error.leaseArchived, sealRecovery: error.sealRecovery })}\n`)
  process.exitCode = 1
} finally {
  terminal?.close()
  process.removeListener('SIGINT', interrupted)
  process.removeListener('SIGTERM', interrupted)
}
