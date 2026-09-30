#!/usr/bin/env node
import { createVikingDoor } from '../../plugins/aukora-kira/lib/viking-door.mjs'
import { deploymentArgs } from '../../plugins/aukora-kira/lib/memory-deployment.mjs'
const fail = () => { process.stderr.write('Viking door failed; details suppressed.\n'); process.exitCode = 1 }
try {
  const args = process.argv.slice(2), at = args.indexOf('--port')
  const port = at < 0 ? 8766 : Number(args[at + 1])
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('invalid-port')
  const door = createVikingDoor({ ...deploymentArgs(args), port })
  await door.listen()
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => void door.close())
} catch { fail() }
