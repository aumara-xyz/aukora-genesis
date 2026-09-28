#!/usr/bin/env node
/** Parent-staged 8088 guest that runs one user turn; parent stdin still owns writes. */
import { refuseExecutableConfig } from '@deepseek-ai/dsh-app-boot'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  AUKORA_MEMORY_INDETERMINATE,
  AUKORA_MEMORY_REFUSED,
  classifyMemoryToolResult,
} from '../broker/public-outcome.mjs'
import { runProfile } from '../../apps/cli/src/profile-boot.ts'
import {
  createParentDisconnectLatch,
  GUEST_READY_TYPE,
  GUEST_RESULT_TYPE,
  GUEST_TURN_TYPE,
  SOURCE_OUTCOME_INDETERMINATE,
} from './developer-protocol.mjs'

const PROFILE_NAME = '8088-inside-out'
const REQUEST_ID = /^[0-9a-f]{32}$/
const LIVE_MODES = new Set(['live', 'fixture'])
const MAX_PROMPT_BYTES = 8192

if (typeof process.send !== 'function') throw new Error('supervisor:guest-parent-channel-required')
const parentDisconnect = createParentDisconnectLatch(process)

const overlay = requireAbsoluteEnv('AUKORA_LIVE_TURN_OVERLAY')
const mode = process.env.AUKORA_LIVE_TURN_MODE
if (typeof mode !== 'string' || !LIVE_MODES.has(mode)) {
  throw new Error('supervisor:live-turn-mode-required')
}
const patchFiles = [overlay]
if (mode === 'fixture') patchFiles.push(requireAbsoluteEnv('AUKORA_LIVE_TURN_FIXTURE_OVERLAY'))

refuseExecutableConfig()
const environmentValues = Object.fromEntries(
  Object.entries(process.env).filter((entry) => typeof entry[1] === 'string'),
)
const running = await runProfile({
  environment: createLaunchEnvironmentSnapshot([{ source: 'process', values: environmentValues }]),
  profile: PROFILE_NAME,
  patchFiles,
  args: [],
  hmrDisposition: 'declined-at-launch',
})
parentDisconnect.attach(() => { running.shutdown.interrupt(1) })
let queue = Promise.resolve()

process.on('message', (message) => {
  if (!isTurnRequest(message)) {
    running.shutdown.interrupt(1)
    return
  }
  queue = queue.then(async () => {
    const result = await runOneTurn(running.ctx, message.prompt, mode)
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

/** Run one user turn, or refuse before the model when credentials are absent. */
async function runOneTurn(ctx, prompt, turnMode) {
  if (turnMode !== 'fixture') {
    const key = process.env.DEEPSEEK_API_KEY
    if (typeof key !== 'string' || key.trim() === '') {
      return refusedResult('supervisor:model-credential-missing')
    }
  }
  const agents = ctx.get('agents')?.roots() ?? []
  if (agents.length !== 1) {
    return indeterminateResult(`supervisor:live-turn-agent-missing (found ${agents.length})`)
  }
  const agent = agents[0]
  await agent.whenIdle()
  const message = createUserMessage({
    content: [{ type: 'text', text: prompt }],
    source: { kind: 'user' },
  })
  agent.followup(message)
  await agent.whenIdle()
  return classifyTurnResult(agent.session.events)
}

/** Reconstruct the ToolRuntime result for the first memory.put in this turn. */
function classifyTurnResult(events) {
  const memoryCalls = new Set()
  let result
  for (const event of events) {
    if (event.type === 'tool/call' && event.data.name === 'memory.put') {
      memoryCalls.add(event.data.callId)
      continue
    }
    if (event.type !== 'tool/result') continue
    const block = event.data.message?.content?.[0]
    if (block?.type !== 'tool-result' || !memoryCalls.has(block.toolCallId)) continue
    const reconstructed = {
      content: Array.isArray(block.content) ? block.content : [],
      isError: block.isError === true,
    }
    if (event.data.error !== undefined) {
      reconstructed.error = {
        message: typeof event.data.error.code === 'string'
          ? `memory.put refused: ${event.data.error.code}`
          : 'memory.put refused',
        info: event.data.error,
      }
    }
    result = reconstructed
  }
  return result ?? indeterminateResult('supervisor:live-turn-no-memory-put')
}

function refusedResult(reason) {
  return Object.freeze({
    content: Object.freeze([{ type: 'text', text: `Error: live turn refused: ${reason}` }]),
    isError: true,
    error: Object.freeze({
      message: `live turn refused: ${reason}`,
      info: Object.freeze({ name: 'DeveloperLaunchError', code: AUKORA_MEMORY_REFUSED }),
    }),
  })
}

function indeterminateResult(reason) {
  return Object.freeze({
    content: Object.freeze([{ type: 'text', text: `Error: ${reason}` }]),
    isError: true,
    error: Object.freeze({
      message: reason,
      info: Object.freeze({ name: 'DeveloperLaunchError', code: AUKORA_MEMORY_INDETERMINATE }),
    }),
  })
}

/** Require the direct parent to send one exact user-turn request. */
function isTurnRequest(message) {
  return isExactObject(message, ['type', 'requestId', 'prompt'])
    && message.type === GUEST_TURN_TYPE
    && typeof message.requestId === 'string'
    && REQUEST_ID.test(message.requestId)
    && typeof message.prompt === 'string'
    && message.prompt.length > 0
    && Buffer.byteLength(message.prompt, 'utf8') <= MAX_PROMPT_BYTES
}

function requireAbsoluteEnv(name) {
  const value = process.env[name]
  if (typeof value !== 'string' || value === '' || !value.startsWith('/')) {
    throw new Error(`supervisor:${name.toLowerCase().replaceAll('_', '-')}-required`)
  }
  return value
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
