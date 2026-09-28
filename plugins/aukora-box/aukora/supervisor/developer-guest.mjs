#!/usr/bin/env node
/** Governed 8088 guest controlled only by its direct launch parent. */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { isExactMemoryPutArgs, KEY_SHAPE } from '../broker/memory-put-args.mjs'
import { classifyMemoryToolResult } from '../broker/public-outcome.mjs'
import {
  createParentDisconnectLatch,
  GUEST_EXECUTE_TYPE,
  GUEST_READY_TYPE,
  GUEST_RESULT_TYPE,
  SOURCE_OUTCOME_INDETERMINATE,
} from './developer-protocol.mjs'

const PROFILE_NAME = '8088-inside-out'
const REQUEST_ID = /^[0-9a-f]{32}$/
const prepared = process.argv[2] === '--confined' || process.argv[2] === '--prepare-profile'
const requireFromCli = createRequire(new URL('../../apps/cli/package.json', import.meta.url))
const { refuseExecutableConfig } = await import(prepared
  ? pathToFileURL(requireFromCli.resolve('@deepseek-ai/dsh-app-boot')).href
  : '@deepseek-ai/dsh-app-boot')
const { createLaunchEnvironmentSnapshot } = await import(prepared
  ? pathToFileURL(requireFromCli.resolve('@deepseek-ai/dsh-launch-environment')).href
  : '@deepseek-ai/dsh-launch-environment')
const { runProfile, prepareProfile } = await import(prepared
  ? '../../apps/cli/lib/profile-boot.js'
  : '../../apps/cli/src/profile-boot.ts')
if (process.argv.length === 3 && process.argv[2] === '--prepare-profile') {
  prepareProfile(PROFILE_NAME)
  process.exit(0)
}
if (process.argv.length !== (prepared ? 3 : 2)) throw new Error('supervisor:guest-arguments-not-exact')

if (typeof process.send !== 'function') throw new Error('supervisor:guest-parent-channel-required')
const parentDisconnect = createParentDisconnectLatch(process)

refuseExecutableConfig()
const environmentValues = Object.fromEntries(
  Object.entries(process.env).filter((entry) => typeof entry[1] === 'string'),
)
const running = await runProfile({
  environment: createLaunchEnvironmentSnapshot([{ source: 'process', values: environmentValues }]),
  profile: PROFILE_NAME,
  patchFiles: [],
  args: [],
  hmrDisposition: 'declined-at-launch',
  ...(prepared ? { profilePreparation: 'read-only' } : {}),
})
parentDisconnect.attach(() => { running.shutdown.interrupt(1) })
const agent = {
  session: {
    events: [{ type: 'turn/start' }, { type: 'user/message' }],
    append: (type, data) => ({ type, data }),
  },
}
let queue = Promise.resolve()

process.on('message', (message) => {
  if (!isExecuteRequest(message)) {
    running.shutdown.interrupt(1)
    return
  }
  queue = queue.then(async () => {
    const result = await running.ctx.tools.execute({
      signal: new AbortController().signal,
      callId: `parent:${message.requestId}`,
      name: 'memory.put',
      arguments: message.arguments,
      agent,
    })
    await send({
      type: GUEST_RESULT_TYPE,
      requestId: message.requestId,
      outcome: classifyResult(result),
      result,
    })
  }).catch(() => { running.shutdown.interrupt(1) })
})

/** Preserve refusal, settlement, and uncertainty across the guest IPC route. */
function classifyResult(result) {
  return classifyMemoryToolResult(result) ?? SOURCE_OUTCOME_INDETERMINATE
}
await send({
  type: GUEST_READY_TYPE,
  profile: PROFILE_NAME,
  governed: true,
  environmentKeys: Object.keys(environmentValues).sort(),
  // The guest's global registry, read from this running process rather than
  // from a profile file. Agent-session tools are deliberately absent.
  globalTools: running.ctx.tools.schemas().map(schema => schema.name).sort(),
  pid: process.pid,
})

/** Require the direct parent to send one exact memory.put request. */
function isExecuteRequest(message) {
  return isExactObject(message, ['type', 'requestId', 'arguments'])
    && message.type === GUEST_EXECUTE_TYPE
    && typeof message.requestId === 'string'
    && REQUEST_ID.test(message.requestId)
    && isExactMemoryPutArgs(message.arguments)
    && KEY_SHAPE.test(message.arguments.key)
}

/** Send one record over the direct parent channel. */
function send(message) {
  return new Promise((resolve, reject) => {
    const sender = process.send
    if (sender === undefined) {
      reject(new Error('supervisor:guest-parent-channel-unavailable'))
      return
    }
    sender.call(process, message, error => error === null || error === undefined ? resolve() : reject(error))
  })
}

function isExactObject(value, keys) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  const own = Reflect.ownKeys(value)
  if (own.length !== keys.length) return false
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor !== undefined && descriptor.enumerable && Object.hasOwn(descriptor, 'value')
  })
}
