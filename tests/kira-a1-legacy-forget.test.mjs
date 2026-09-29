#!/usr/bin/env node
/**
 * Phase 1 A1 court — A REMOVAL IS COUNTED ONLY WHEN THE FILE IS ACTUALLY GONE.
 *
 * No daemon, no live store, no OpenViking account: every stub is scratch state.
 *
 * The property this court binds: a governed id may be LISTED under the A1 shape
 * (`governed/<hex>.md`) and the legacy shape (`governed/kira-<hex>.md`) at once, and only a URI
 * that was actually listed can be deleted. Rebuilding the name from the id deletes the A1 file,
 * leaves the legacy file serving, swallows the miss, and still reports `removed: 1` — a false
 * success after which `indexed.delete` stops the retry.
 *
 * This court goes RED if sync reports a removal while the file remains.
 */
import assert from 'node:assert/strict'
import { createOpenVikingRecall } from '../plugins/aukora-kira/lib/recall-openviking.mjs'

const USER = 'owner'
const HEX = '1'.repeat(64)
const ID = `kira:${HEX}`
const A1 = `viking://user/${USER}/memories/kira/governed/${HEX}.md`
const LEGACY = `viking://user/${USER}/memories/kira/governed/kira-${HEX}.md`
const config = {
  configured: true, url: 'http://127.0.0.1:1933', account: 'aukora', user: USER, key: 'scratch', onMachine: true,
  scoreThreshold: 0.4, window: 0.5, limit: 3, candidates: 20, timeoutMs: 1000, syncBatch: 32,
  queryInstruction: '',
}

const response = (status, result) => ({ ok: status >= 200 && status < 300, status, async json() { return { status: 'ok', result } } })
/** A server holding `uris`, where DELETE either works, 404s, or fails outright. */
const makeServer = (uris, { deleteFails = false } = {}) => {
  const files = new Set(uris)
  const attempts = []
  const fetch = async (url, options = {}) => {
    const parsed = new URL(url)
    if (parsed.pathname === '/health') return { ok: true, status: 200, async json() { return { healthy: true } } }
    if (parsed.pathname === '/api/v1/fs/ls') return response(200, [...files])
    if (parsed.pathname === '/api/v1/content/write') return response(200, {})
    if (parsed.pathname === '/api/v1/fs' && options.method === 'DELETE') {
      const target = parsed.searchParams.get('uri')
      attempts.push(target)
      if (deleteFails) return { ok: false, status: 500, async json() { return { status: 'error', error: { code: 'WRITE_FAILED' } } } }
      const known = files.delete(target)
      if (!known) return { ok: false, status: 404, async json() { return { status: 'error', error: { code: 'NOT_FOUND' } } } }
      return response(200, {})
    }
    return { ok: false, status: 404, async json() { return { status: 'error', error: { code: 'NOT_FOUND' } } } }
  }
  return { files, attempts, bridge: createOpenVikingRecall({ config, fetch }) }
}

const holds = () => ({ ambient: new Map(), governed: new Map([[ID, { id: ID, tier: 'signed', statement: 'governed one' }]]), complete: true })
const holdsNothing = () => ({ ambient: new Map(), governed: new Map(), complete: true })

let failures = 0
let passed = 0
const arm = async (name, body) => {
  try { await body(); passed += 1; process.stdout.write(`  ok    ${name}\n`) }
  catch (error) { failures += 1; process.stdout.write(`  FAIL  ${name}\n        ${String(error?.message ?? error).split('\n')[0]}\n`) }
}

process.stdout.write('\nA1 court — removal is counted only when the file is gone\n\n')

await arm('a legacy-named file IS removed (was: left serving while reported removed)', async () => {
  const { files, bridge } = makeServer([LEGACY])
  const done = await bridge.sync(holdsNothing(), { budget: 0 })
  assert.equal(files.has(LEGACY), false, 'the legacy-named file must actually be deleted')
  assert.equal(done.removed, 1, 'and the removal must be counted')
  assert.deepEqual(done.failed, [], 'with no failure reported')
})

// THE BINDING ARM: the counter may never claim a removal the server did not perform.
await arm('THE BINDING ARM: removed is 0 whenever the file survives', async () => {
  const { files, bridge } = makeServer([LEGACY], { deleteFails: true })
  const done = await bridge.sync(holdsNothing(), { budget: 0 })
  assert.equal(files.has(LEGACY), true, 'the stub keeps the file when DELETE fails')
  assert.equal(done.removed, 0,
    `sync reported ${String(done.removed)} removed while the file is still there`)
  assert.ok(done.failed.length > 0, 'and the unreached removal must be named')
})

await arm('both shapes present are both removed, counted once', async () => {
  const { files, bridge } = makeServer([A1, LEGACY])
  const done = await bridge.sync(holdsNothing(), { budget: 0 })
  assert.equal(files.has(A1), false, 'the A1 file must be deleted')
  assert.equal(files.has(LEGACY), false, 'and the legacy file too')
  assert.equal(done.removed, 1, 'one id removed, not two')
})

await arm('the control arm: an id the ledger HOLDS is never removed', async () => {
  const { files, bridge } = makeServer([A1, LEGACY])
  const done = await bridge.sync(holds(), { budget: 0 })
  assert.equal(files.has(A1), true, 'a held record must keep both shapes')
  assert.equal(files.has(LEGACY), true)
  assert.equal(done.removed, 0)
})

await arm('an incomplete ledger still removes nothing (unchanged)', async () => {
  const { files, bridge } = makeServer([LEGACY])
  const done = await bridge.sync({ ambient: new Map(), governed: new Map(), complete: false }, { budget: 0 })
  assert.equal(files.has(LEGACY), true, 'a ledger that could not be read may not drive a removal')
  assert.equal(done.removed, 0)
})

await arm('forget() removes BOTH shapes once the index has listed them', async () => {
  const { files, attempts, bridge } = makeServer([A1, LEGACY])
  // Index first, so the legacy shape is known. The ledger holds the id, so sync removes nothing.
  await bridge.sync(holds(), { budget: 0 })
  attempts.length = 0
  const answer = await bridge.forget(ID)
  assert.equal(answer.reached, true, 'forget must report reaching the server')
  assert.equal(files.has(A1), false, 'the A1 shape must be gone')
  assert.equal(files.has(LEGACY), false, 'and the legacy shape, which the id alone cannot name')
  assert.ok(attempts.includes(LEGACY), 'the legacy URI must have been attempted')
})

await arm('forget() reports NOT reached when a delete fails, and does not claim success', async () => {
  const { files, bridge } = makeServer([A1, LEGACY], { deleteFails: true })
  await bridge.sync(holds(), { budget: 0 })
  const answer = await bridge.forget(ID)
  assert.equal(answer.reached, false, 'a failed delete may not be reported as reached')
  assert.equal(files.has(A1), true, 'and the file is still there, as reported')
})

process.stdout.write(`\nkira-a1-legacy-forget: ${String(passed)} passed, ${String(failures)} failed\n\n`)
process.exit(failures === 0 ? 0 : 1)
