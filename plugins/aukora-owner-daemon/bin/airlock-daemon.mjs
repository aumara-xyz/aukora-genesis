#!/usr/bin/env node
import { readAirlockConfig, startAirlockServer } from '../lib/airlock-server.mjs'

try {
  process.umask(0o117)
  const config = readAirlockConfig(process.argv[2] ?? '/etc/aukora/owner-daemon.json')
  const server = await startAirlockServer(config)
  process.stdout.write(`AIRLOCK serving ownerUid=${config.ownerUid} callerUid=${config.callerUid}\n`)
  process.stdout.write('NOT_ENFORCED: caller UID does not prove an approval click.\n')
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)))
} catch (error) {
  // Parse errors can include source excerpts. Never log an error message from a key read.
  process.stderr.write(`AIRLOCK refused: ${error?.code ?? 'airlock:startup-failed'}\n`)
  process.exitCode = 1
}
