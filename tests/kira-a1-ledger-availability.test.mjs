#!/usr/bin/env node
/**
 * Phase 1 A1 court — AN UNREADABLE LEDGER MUST NOT READ AS AN EMPTY ONE.
 *
 * No daemon, no live store, no OpenViking account: every stub is scratch state.
 *
 * The property this court binds: when the ledger that feeds the semantic bridge cannot be read,
 * the answer may not carry a DETERMINED remembered state and the phase 9 gate may not PROCEED.
 * The A1 court binds only that such hits are DROPPED; dropping is necessary and not sufficient,
 * because a caller that reports `available` with a determined state turns a failed read into
 * "I looked and there was nothing" — which is the January-shaped answer.
 *
 * This court goes RED if the gate proceeds while the ledger is incomplete.
 */
import assert from 'node:assert/strict'
import { contentHash } from '../plugins/aukora-kira/lib/memory-quality.mjs'
import { createOpenVikingRecall } from '../plugins/aukora-kira/lib/recall-openviking.mjs'
import { recallRemembered } from '../plugins/aukora-kira/lib/tools.mjs'
import {
  rememberedWithLedger, rememberedStateOf, decidePartialFailure, reconcileRecallAvailability,
} from '../plugins/aukora-kira/lib/partial-failure.mjs'

const USER = 'owner'
const config = {
  configured: true, url: 'http://127.0.0.1:1933', account: 'aukora', user: USER, key: 'scratch', onMachine: true,
  scoreThreshold: 0.4, window: 0.5, limit: 3, candidates: 20, timeoutMs: 1000, syncBatch: 32,
  queryInstruction: '',
}

const GOVERNED = 'kira:' + '1'.repeat(64)
const AMBIENT = 'rem:' + 'a'.repeat(64)
const files = new Map([
  [`viking://user/${USER}/memories/kira/governed/${'1'.repeat(64)}.md`, { tags: [`kira_id=${GOVERNED}`, 'tier=signed'] }],
])
const response = (status, result) => ({ ok: status >= 200 && status < 300, status, async json() { return { status: 'ok', result } } })
const fakeFetch = async (url, options = {}) => {
  const parsed = new URL(url)
  if (parsed.pathname === '/health') return { ok: true, status: 200, async json() { return { healthy: true } } }
  if (parsed.pathname === '/api/v1/fs/ls') return response(200, [...files.keys()])
  if (parsed.pathname === '/api/v1/content/write') { const body = JSON.parse(options.body); files.set(body.uri, body); return response(200, {}) }
  if (parsed.pathname === '/api/v1/content/read') return response(200, files.get(parsed.searchParams.get('uri'))?.content)
  if (parsed.pathname === '/api/v1/fs' && options.method === 'DELETE') {
    files.delete(parsed.searchParams.get('uri')); return response(200, {})
  }
  if (parsed.pathname === '/api/v1/search/find') {
    return response(200, { memories: [...files.entries()].map(([uri, value]) => ({ uri, tags: value.tags, score: 0.9 })), resources: [] })
  }
  return { ok: false, status: 404, async json() { return { status: 'error', error: { code: 'NOT_FOUND' } } } }
}

let failures = 0
let passed = 0
const arm = async (name, body) => {
  try { await body(); passed += 1; process.stdout.write(`  ok    ${name}\n`) }
  catch (error) { failures += 1; process.stdout.write(`  FAIL  ${name}\n        ${String(error?.message ?? error).split('\n')[0]}\n`) }
}

const bridge = createOpenVikingRecall({ config, fetch: fakeFetch })
/** Exactly what index.js semanticLedger() returns when the read THROWS. */
const unreadable = () => ({ ambient: new Map(), governed: new Map(), complete: false })
const readable = () => ({
  ambient: new Map([[AMBIENT, { id: AMBIENT, tier: 'remembered', statement: 'ambient alpha is available', contentHash: contentHash('ambient alpha is available') }]]),
  governed: new Map([[GOVERNED, { id: GOVERNED, tier: 'signed', statement: 'governed one is available', contentHash: contentHash('governed one is available') }]]),
  complete: true,
})
/** A lexical fallback that MATCHES — the ordinary case, and the one that used to look determined. */
const listNotes = async () => ([{ id: AMBIENT, text: 'ambient alpha', observedAt: null, source: {}, bodyAtCapture: null }])

/** The composition index.js performed inline; the court drives the exported helpers it now calls. */
const rememberedFor = async (ledger) => {
  const found = await bridge.recall({ question: 'ambient alpha', live: ledger })
  const lexical = await recallRemembered(listNotes, 'ambient alpha')
  return { found, remembered: rememberedWithLedger({ lexical, ledgerComplete: found.ledgerComplete }) }
}

process.stdout.write('\nA1 court — ledger readability reaches the gate\n\n')

await arm('an unreadable ledger is reported as such by the bridge', async () => {
  const found = await bridge.recall({ question: 'ambient alpha', live: unreadable })
  assert.equal(found.ledgerComplete, false, 'the bridge must report that the ledger could not be read')
  assert.equal(found.hits.length, 0, 'and must still show nothing from it')
  assert.ok(found.dropped.unmapped.length > 0, 'and must still record the dropped hit')
})

await arm('a readable ledger is reported as such (the control arm)', async () => {
  const found = await bridge.recall({ question: 'ambient alpha', live: readable })
  assert.equal(found.ledgerComplete, true, 'a complete ledger must report complete')
  assert.ok(found.hits.length > 0, 'and must be able to show a hit')
})

await arm('an unreadable ledger forces remembered.state to undetermined', async () => {
  const { remembered } = await rememberedFor(unreadable)
  assert.equal(rememberedStateOf(remembered), 'undetermined',
    'a failed read may not be reported as found or empty')
  assert.equal(remembered.state, 'undetermined')
})

await arm('THE BINDING ARM: the gate does NOT proceed while the ledger is incomplete', async () => {
  const { remembered } = await rememberedFor(unreadable)
  const decision = decidePartialFailure({ outer: 'found', remembered: rememberedStateOf(remembered) })
  assert.notEqual(decision.action, 'proceed',
    'the gate proceeded although the memory ledger could not be read and nothing was verified')
  assert.ok(['ask', 'stop'].includes(decision.action), `expected ask or stop, got ${decision.action}`)
})

await arm('THE BINDING ARM: reconcile never leaves an unreadable ledger at found', async () => {
  const { remembered } = await rememberedFor(unreadable)
  const reconciled = reconcileRecallAvailability({ availability: 'found', status: 'match' }, remembered)
  assert.notEqual(reconciled.partialFailure.action, 'proceed',
    'reconciled a partial memory picture as a determined one')
  assert.notEqual(reconciled.availability, 'found',
    'outer availability may not stay found while the ledger was unreadable')
})

await arm('the control arm still proceeds: a complete ledger is not downgraded', async () => {
  const { remembered } = await rememberedFor(readable)
  assert.equal(rememberedStateOf(remembered), 'found',
    'with a readable ledger the lexical picture stands as found')
  const decision = decidePartialFailure({ outer: 'found', remembered: 'found' })
  assert.equal(decision.action, 'proceed', 'a verified picture must still be able to proceed')
})

await arm('rememberedWithLedger passes a determined picture through untouched', async () => {
  const lexical = { state: 'found', notes: [{ id: AMBIENT }] }
  assert.deepEqual(rememberedWithLedger({ lexical, ledgerComplete: true }), lexical)
  assert.equal(rememberedWithLedger({ lexical, ledgerComplete: true }).state, 'found')
})

await arm('rememberedWithLedger treats UNKNOWN as unverified, not as verified', async () => {
  const lexical = { state: 'found' }
  assert.equal(rememberedWithLedger({ lexical, ledgerComplete: undefined }).state, 'undetermined',
    'a bridge that could not report readability must not be assumed readable')
})

process.stdout.write(`\nkira-a1-ledger-availability: ${String(passed)} passed, ${String(failures)} failed\n\n`)
process.exit(failures === 0 ? 0 : 1)
