#!/usr/bin/env node
/** Explicit note capture through the ordinary tracked writer. */
import { createTrackedMemory } from '../../plugins/aukora-kira/lib/tracked-memory.mjs'
import { deploymentArgs } from '../../plugins/aukora-kira/lib/memory-deployment.mjs'
try {
  const args = process.argv.slice(2), divider = args.indexOf('--')
  if (divider < 0) throw new Error('use --installed or --state-dir PATH --subject SUBJECT, then -- TEXT')
  const flags = args.slice(0, divider), text = args.slice(divider + 1).join(' ')
  if (!text.trim()) throw new Error('missing-text')
  const result = await createTrackedMemory(deploymentArgs(flags)).remember({ text, from: 'owner' })
  process.stdout.write(`${JSON.stringify({ remembered: result.remembered, ids: result.ids, index: result.index })}\n`)
} catch { process.stderr.write('Usage: remember.mjs (--installed | --state-dir PATH --subject SUBJECT) -- TEXT. Capture failed; details suppressed.\n'); process.exitCode = 1 }
