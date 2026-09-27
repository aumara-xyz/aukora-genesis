#!/usr/bin/env node
/**
 * THE LANE DOOR RECORDS THE ID OF EVERY PROMPT THE HARNESS ACCEPTED, AND KIRA EXCLUDES THE MESSAGE BY IT.
 *
 *   node tests/lane-door-message-id.test.mjs            the arms below
 *   node tests/lane-door-message-id.test.mjs --mutate   the same arms against the old read (`result.messageId`),
 *                                                       which must go RED
 *
 * THE DEFECT. `lane-door.mjs` read `result.messageId`, but its send returns `{status, body}`, so
 * `<stateRoot>/lane-door/prompted-messages.jsonl` was never written and Kira's id exclusion never had an id. The app's
 * `session/prompt` answers `{type: 'server-response', rpcId, result: {ok: true, value: {accepted: true}}}` (vendor/dsh
 * `api/session-controller/src/commands.ts`) and keeps the door's request id on the message as `source.rpcId`, so the
 * request id is what the door records and what the predicate matches.
 *
 * WHAT THIS DOES NOT SHOW. The backend is a stub that answers in the app's envelope; no harness runs, no session log
 * is read, and that the live `user/message` event carries `source.rpcId` is read from vendor/dsh source, not measured.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openScratch } from '../scripts/lib/run-root.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { installLaneDoor } = await import('../apps/aukora-desktop/lane-door.mjs')
const { laneDoorMessageIds, laneDoorMessagesPath } = await import('../plugins/aukora-kira/lib/lane-door-messages.mjs')
const { isRealAsk, setLaneDoorMessageIds } = await import('../plugins/aukora-kira/lib/autostage-hook.mjs')

const SESSION = 'session-0f5e2c1a-7b3d-4e8f-9a6b-1c2d3e4f5a6b'
let arms = 0
const arm = (name, fn) => { fn(); arms += 1; console.log(`  PASS  ${name}`) }

/** A backend stub in the app's own shapes: a cookie on the launch URL, and the RPC envelope on `session/prompt`. */
function stubBackend(accept) {
  const sent = []
  const fetchImpl = async (url, init = {}) => {
    if (init.method !== 'POST') {
      return { status: 302, headers: { getSetCookie: () => ['dsh-auth-stub=1; Path=/'], get: () => null } }
    }
    const envelope = JSON.parse(init.body)
    sent.push({ path: new URL(url).pathname, envelope })
    const result = accept
      ? { ok: true, value: { accepted: true } }
      : { ok: false, error: { code: 'session/agent-busy', message: 'prompt rejected', details: {} } }
    return { status: 200, json: async () => ({ type: 'server-response', rpcId: envelope.rpcId, result }) }
  }
  return { sent, fetchImpl }
}

function send(door, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = request({ host: '127.0.0.1', port: door.port, path: '/lane/send', method: 'POST', headers: {
      host: `127.0.0.1:${door.port}`, authorization: `Bearer ${door.token}`, 'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
    } }, res => {
      let text = ''
      res.on('data', chunk => { text += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }))
    })
    req.on('error', reject)
    req.end(payload)
  })
}

const scratch = openScratch({ label: 'lane-door-id' })
const stateRoot = scratch.root
const file = laneDoorMessagesPath(stateRoot)
console.log('lane door: the prompted id is recorded')

// ── ACCEPTED: the harness took the prompt, so its request id is written down ──────────────────────────────────────
const accepted = stubBackend(true)
let door = await installLaneDoor({ stateRoot, backendUrl: 'http://127.0.0.1:9/?token=stub', fetchImpl: accepted.fetchImpl })
const reply = await send(door, { session: SESSION, origin: 'fable', text: 'please run the suite' })
await door.dispose()
const promptCall = accepted.sent.find(one => one.path === '/api/session/prompt')
const requestId = promptCall?.envelope?.payload?.args?.request?.requestId
arm('the send reached session/prompt and the door answered 200', () => {
  assert.equal(reply.status, 200, JSON.stringify(reply.body))
  assert.match(String(requestId), /^lane-door:fable:[0-9a-f-]{36}$/u)
})
arm('prompted-messages.jsonl holds exactly that request id', () => {
  assert.ok(existsSync(file), `${file} was never written`)
  const lines = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.equal(lines.length, 1)
  assert.equal(lines[0].requestId, requestId)
  assert.equal(lines[0].origin, 'fable')
  assert.ok(laneDoorMessageIds(stateRoot).has(requestId))
})
arm('Kira excludes the message by its source.rpcId even with the text prefix gone', () => {
  setLaneDoorMessageIds(laneDoorMessageIds(stateRoot))
  const event = rpcId => ({ type: 'user/message',
    data: { id: 'msg-1', source: { kind: 'user', rpcId }, content: [{ type: 'text', text: 'please run the suite' }] } })
  assert.equal(isRealAsk(event(requestId)), false, 'the lane message was read as a real ask')
  assert.equal(isRealAsk(event('peter-own-request')), true, 'a message the door did not send was excluded')
})

// ── REFUSED: the harness did not take it, so nothing is written ──────────────────────────────────────────────────
const refused = stubBackend(false)
door = await installLaneDoor({ stateRoot, backendUrl: 'http://127.0.0.1:9/?token=stub', fetchImpl: refused.fetchImpl })
await send(door, { session: SESSION, origin: 'fable', text: 'this one is refused' })
await door.dispose()
arm('a prompt the harness refused adds no id', () => {
  assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 1)
})
console.log(`  ${String(arms)}/${String(arms)} arms green`)

if (process.argv.includes('--mutate')) {
  console.log('\n── mutation: the old read of `result.messageId` ──')
  const { mutationArm } = await import('./helpers/mutation-arm.mjs')
  const caught = mutationArm({
    court: fileURLToPath(import.meta.url),
    subject: join(ROOT, 'apps', 'aukora-desktop', 'lane-door.mjs'),
    label: 'recording the request id',
    from: '        recordLaneDoorMessage(deps.stateRoot, requestId, lane)',
    to: "        if (typeof result.messageId === 'string') recordLaneDoorMessage(deps.stateRoot, result.messageId, lane)",
    expectArm: 'was never written',
    say: line => { console.log(`        ${line}`) },
  })
  process.exit(caught ? 0 : 1)
}
process.exit(0)
