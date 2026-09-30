#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { createTrackedMemory } from '../../plugins/aukora-kira/lib/tracked-memory.mjs'
import { createVikingMcp } from '../../plugins/aukora-kira/lib/viking-mcp.mjs'
import { deploymentArgs } from '../../plugins/aukora-kira/lib/memory-deployment.mjs'
try {
  const memory = createTrackedMemory(deploymentArgs(process.argv.slice(2)))
  const handle = createVikingMcp(memory)
  const timer = setInterval(() => void memory.retry().catch(() => {}), 30_000); timer.unref()
  const initialRetry = setImmediate(() => void memory.retry().catch(() => {})); initialRetry.unref()
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    if (Buffer.byteLength(line) > 1_100_000) { process.stdout.write('{"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"Request too large."}}\n'); continue }
    let reply
    try { reply = await handle(JSON.parse(line)) } catch { reply = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON.' } } }
    if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`)
  }
  clearImmediate(initialRetry); clearInterval(timer)
} catch { process.stderr.write('Memory MCP startup failed; details suppressed.\n'); process.exitCode = 1 }
