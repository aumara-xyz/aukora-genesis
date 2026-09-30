#!/usr/bin/env node
import { backfillTrackedMemory } from '../../plugins/aukora-kira/lib/tracked-backfill.mjs'
import { deploymentArgs } from '../../plugins/aukora-kira/lib/memory-deployment.mjs'
const args = process.argv.slice(2)
const get = flag => { const at = args.indexOf(flag); return at < 0 ? undefined : args[at + 1] }
try {
  const result = await backfillTrackedMemory({ ...deploymentArgs(args), legacyDir: get('--legacy-dir'),
    legacyUris: args.flatMap((arg, i) => arg === '--legacy-uri' ? [args[i + 1]] : []), vikingLegacy: args.includes('--viking-legacy') })
  process.stdout.write(`${JSON.stringify(result)}\n`)
  if (result.failed) process.exitCode = 1
} catch { process.stderr.write('Memory backfill failed; originals retained, details suppressed.\n'); process.exitCode = 1 }
