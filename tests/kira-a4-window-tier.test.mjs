#!/usr/bin/env node
/**
 * Phase 1 A4 court — THE WINDOW IS MEASURED WITHIN A TIER, NOT FROM THE BEST SCORE OVERALL.
 *
 * No daemon, no live store, no OpenViking account: every stub is scratch state.
 *
 * The hole this court binds: eligibility was `best - score <= window` where `best` was the highest
 * score across BOTH tiers — in practice the best ambient note. A governed record that cleared the
 * threshold on its own was therefore discarded whenever ambient text scored `window` higher, its
 * reserved slots stayed empty, and governed memory was reachable only by near-tying the best
 * ambient match. Governance became contingent on ambient match quality.
 *
 * This court goes RED if a governed record that independently cleared the threshold is absent from
 * the reserved slots because an ambient note outscored it by more than the window.
 */
import assert from 'node:assert/strict'
import { contentHash } from '../plugins/aukora-kira/lib/memory-quality.mjs'
import { createOpenVikingRecall } from '../plugins/aukora-kira/lib/recall-openviking.mjs'
import { eligibleByTier, mergeReservedSlots, GOVERNED_RESERVED_SLOTS } from '../plugins/aukora-kira/lib/reserved-slots.mjs'

const USER = 'owner'
const hex = n => String(n).repeat(64)
const ambientIds = [hex(1), hex(2), hex(3)].map(h => `rem:${h}`)
const governedIds = [hex(4), hex(5)].map(h => `kira:${h}`)
const [A1, A2, A3] = ambientIds
const [G1, G2] = governedIds

// A1 0.62 · A2 0.55 · A3 0.45 (ambient) ; G1 0.45 · G2 0.30 (governed, G2 under threshold)
const SCORES = new Map([[A1, 0.62], [A2, 0.55], [A3, 0.45], [G1, 0.45], [G2, 0.30]])
const config = {
  configured: true, url: 'http://127.0.0.1:1933', account: 'aukora', user: USER, key: 'scratch', onMachine: true,
  scoreThreshold: 0.4, window: 0.1, limit: 3, candidates: 20, timeoutMs: 1000, syncBatch: 32,
  queryInstruction: '',
}

const statementFor = id => `The record is ${id}`
const uriFor = id => id.startsWith('rem:')
  ? `viking://user/${USER}/memories/kira/remembered/rem-${id.slice(4)}.md`
  : `viking://user/${USER}/memories/kira/governed/${id.slice(5)}.md`
const files = new Map([...ambientIds, ...governedIds].map(id => [uriFor(id), { tags: [`kira_id=${id}`, `tier=${id.startsWith('kira:') ? 'signed' : 'remembered'}`] }]))
const response = (status, result) => ({ ok: status >= 200 && status < 300, status, async json() { return { status: 'ok', result } } })
const fakeFetch = async (url, options = {}) => {
  const parsed = new URL(url)
  if (parsed.pathname === '/health') return { ok: true, status: 200, async json() { return { healthy: true } } }
  if (parsed.pathname === '/api/v1/fs/ls') return response(200, [...files.keys()])
  if (parsed.pathname === '/api/v1/content/write') return response(200, {})
  if (parsed.pathname === '/api/v1/content/read') { const uri = parsed.searchParams.get('uri'); return response(200, statementFor(uri.includes('/governed/') ? `kira:${uri.split('/').pop().slice(0, -3)}` : `rem:${uri.split('rem-').pop().slice(0, -3)}`)) }
  if (parsed.pathname === '/api/v1/fs' && options.method === 'DELETE') { files.delete(parsed.searchParams.get('uri')); return response(200, {}) }
  if (parsed.pathname === '/api/v1/search/find') {
    return response(200, {
      memories: [...files.keys()].map(uri => {
        const id = uri.includes('/governed/') ? `kira:${uri.split('/').pop().slice(0, -3)}` : `rem:${uri.split('rem-').pop().slice(0, -3)}`
        return { uri, tags: files.get(uri).tags, score: SCORES.get(id) ?? 0 }
      }),
      resources: [],
    })
  }
  return { ok: false, status: 404, async json() { return { status: 'error', error: { code: 'NOT_FOUND' } } } }
}
const ledger = () => ({
  ambient: new Map(ambientIds.map(id => [id, { id, tier: 'remembered', statement: statementFor(id), contentHash: contentHash(statementFor(id)) }])),
  governed: new Map(governedIds.map(id => [id, { id, tier: 'signed', statement: statementFor(id), contentHash: contentHash(statementFor(id)) }])),
  complete: true,
})

let failures = 0
let passed = 0
const arm = async (name, body) => {
  try { await body(); passed += 1; process.stdout.write(`  ok    ${name}\n`) }
  catch (error) { failures += 1; process.stdout.write(`  FAIL  ${name}\n        ${String(error?.message ?? error).split('\n')[0]}\n`) }
}

const bridge = createOpenVikingRecall({ config, fetch: fakeFetch })

process.stdout.write('\nA4 court — within-tier window\n\n')

// THE BINDING ARM. G1 clears the 0.4 threshold on its own but sits 0.17 below the best ambient.
await arm('the active semantic bridge ranks solely by relevance, with no tier reservation', async () => {
  const found = await bridge.recall({ question: 'anything', live: ledger })
  assert.deepEqual(found.hits.slice(0, 2).map(hit => hit.id), [A1, A2])
  assert.equal(found.reserved, undefined)
  assert.ok(found.hits.every(hit => hit.tier === 'remembered'))
})

await arm('THE BINDING ARM (unit): eligibleByTier keeps it; the global-best rule would not', async () => {
  const candidates = [
    { id: A1, score: 0.62, tier: 'remembered' },
    { id: A2, score: 0.55, tier: 'remembered' },
    { id: A3, score: 0.45, tier: 'remembered' },
    { id: G1, score: 0.45, tier: 'signed' },
  ].sort((a, b) => b.score - a.score)
  const { ambient, governed } = eligibleByTier(candidates, { threshold: 0.4, window: 0.1 })
  assert.deepEqual(governed.map(h => h.id), [G1], 'the governed hit must be eligible')
  // The rule this replaced, spelled out, so the arm fails if the window is ever measured globally.
  const oldEligible = candidates.filter(one => candidates[0].score - one.score <= 0.1)
  assert.deepEqual(oldEligible.filter(one => one.tier === 'signed'), [],
    'the old global-best rule dropped it — this arm documents what was wrong')
  assert.deepEqual(ambient.map(h => h.id), [A1, A2], 'ambient keeps its own window')
})

await arm('the window still prunes a weak hanger-on WITHIN its own tier', async () => {
  const { ambient } = eligibleByTier([
    { id: A1, score: 0.62, tier: 'remembered' },
    { id: A3, score: 0.45, tier: 'remembered' },
  ], { threshold: 0.4, window: 0.1 })
  assert.deepEqual(ambient.map(h => h.id), [A1], 'A3 is 0.17 below the best ambient and must be pruned')
})

await arm('the window still prunes a weak governed hanger-on', async () => {
  const { governed } = eligibleByTier([
    { id: G1, score: 0.60, tier: 'signed' },
    { id: G2, score: 0.41, tier: 'signed' },
  ], { threshold: 0.4, window: 0.1 })
  assert.deepEqual(governed.map(h => h.id), [G1], 'the second governed hit is far below the governed best')
})

await arm('below-threshold candidates are dropped from BOTH tiers', async () => {
  const { ambient, governed } = eligibleByTier([
    { id: A1, score: 0.62, tier: 'remembered' },
    { id: A3, score: 0.39, tier: 'remembered' },
    { id: G1, score: 0.40, tier: 'signed' },
    { id: G2, score: 0.30, tier: 'signed' },
  ], { threshold: 0.4, window: 0.5 })
  assert.deepEqual(ambient.map(h => h.id), [A1])
  assert.deepEqual(governed.map(h => h.id), [G1], '0.40 clears the threshold; 0.30 does not')
})

await arm('the bridge drops G2 (under threshold) and prunes A3 (ambient window)', async () => {
  const found = await bridge.recall({ question: 'anything', live: ledger })
  const ids = found.hits.map(h => h.id)
  assert.ok(!ids.includes(G2), 'a governed record under the threshold is never reserved')
  assert.ok(!ids.includes(A3), 'ambient precision is unchanged')
})

await arm('no governed candidates: reserved seats stay empty and are counted (unchanged)', async () => {
  const { ambient, governed } = eligibleByTier([{ id: A1, score: 0.62, tier: 'remembered' }], { threshold: 0.4, window: 0.1 })
  const merged = mergeReservedSlots({ ambient, governed, ceiling: 3, reserved: GOVERNED_RESERVED_SLOTS })
  assert.equal(merged.selected.length, 1)
  assert.equal(merged.wastedReserved, GOVERNED_RESERVED_SLOTS, 'empty reserved seats are intentional and counted')
})

await arm('the reserved cap still holds and tier is never a score multiplier', async () => {
  const governed = [1, 2, 3, 4].map(n => ({ id: `kira:${String(n).repeat(64)}`, score: 0.5 + n / 100, tier: 'signed' }))
  const ambient = [{ id: A1, score: 0.99, tier: 'remembered' }]
  const merged = mergeReservedSlots({ ambient, governed, ceiling: 3, reserved: GOVERNED_RESERVED_SLOTS })
  assert.equal(merged.selected.filter(s => s.slot === 'governed').length, GOVERNED_RESERVED_SLOTS,
    'at most GOVERNED_RESERVED_SLOTS governed seats, however many are eligible')
  assert.equal(merged.selected.filter(s => s.slot === 'ambient').length, 1)
  assert.ok(merged.droppedGoverned >= 2, 'the surplus governed hits are dropped, never boosted in')
})

process.stdout.write(`\nkira-a4-window-tier: ${String(passed)} passed, ${String(failures)} failed\n\n`)
process.exit(failures === 0 ? 0 : 1)
