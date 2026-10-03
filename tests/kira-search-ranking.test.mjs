#!/usr/bin/env node
/** Ordinary search ranking with synthetic records and injected fetch; no service or store I/O. */
import assert from 'node:assert/strict'
import { createOpenVikingRecall, contentUri, uriFor, semanticNotes } from '../plugins/aukora-kira/lib/recall-openviking.mjs'
import { sha256Hex } from '../plugins/aukora-kira/lib/memory-tiers.mjs'
import { compileIndex, rankRecords } from '../plugins/aukora-kira/lib/retrieval.mjs'

const question = 'What are my UI color preferences?'
// Indices 0-2 are recallable statements; 3 is a short fact; 4-6 sit below the vector-quality floor
// (two acknowledgements and one dictated reply) and must never come back as semantic hits.
const notes = ['I prefer a blue UI background with teal accents.', 'The deploy script lives in scripts/aukora.', 'Peter wants larger dock icons.',
  'Blue.', 'OK.', 'Continue.', 'Reply with exactly the four characters: OK'].map((statement, i) => ({
  id: 'rem:' + String(i + 1).padStart(64, '0'), statement, contentHash: sha256Hex(statement),
  observedAt: `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00Z`, aura: { index: i },
}))
const live = { entries: new Map(notes.map(note => [note.id, note])), complete: true }
const files = new Map(notes.flatMap(note => [[contentUri('scratch', note.contentHash), note.statement], [uriFor('scratch', note.id), note.statement]]))
const hit = (i, score, legacy = false) => ({ uri: legacy ? uriFor('scratch', notes[i].id) : contentUri('scratch', notes[i].contentHash), score })
const recall = async (result, candidates = 12) => {
  const requests = []
  const bridge = createOpenVikingRecall({
    config: { configured: true, url: 'http://scratch.invalid', user: 'scratch', syncBatch: 0, candidates },
    fetch: async (url, options = {}) => {
      const u = new URL(url)
      requests.push({ path: u.pathname, method: options.method ?? 'GET' })
      if (u.pathname === '/health') return Response.json({ healthy: true })
      if (u.pathname === '/api/v1/search/find') return Response.json({ status: 'ok', result })
      if (u.pathname === '/api/v1/content/read') return Response.json({ status: 'ok', result: files.get(u.searchParams.get('uri')) })
      throw new Error(`Unexpected synthetic request: ${u.pathname}`)
    },
  })
  const answer = await bridge.recall({ question, live, limit: 3 })
  assert.equal(answer.available, true)
  assert.ok(requests.every(request => request.method === 'GET' || request.path === '/api/v1/search/find'))
  assert.ok(requests.filter(request => request.path === '/api/v1/content/read').length <= candidates)
  for (const note of semanticNotes(answer).notes) {
    assert.equal(note.text, live.entries.get(note.id).statement)
    assert.equal(files.get(note.uri), note.text)
    assert.ok(Number.isFinite(note.score))
  }
  return { answer, requests }
}
let passed = 0, failed = 0
const check = async (name, run) => {
  try { await run(); passed++; console.log('ok ' + name) }
  catch (error) { failed++; console.log('FAIL ' + name + ': ' + error.message) }
}
await check('explicit preferences outrank with distinct scores; acknowledgements and dictated replies never surface; short facts stay searchable', async () => {
  const records = notes.map(note => ({ recordId: note.id, text: note.statement }))
  const lexical = rankRecords(compileIndex(records), records, question)
  assert.equal(lexical[0].recordId, notes[0].id)
  for (const i of [4, 5]) assert.equal(lexical.find(row => row.recordId === notes[i].id).score, 0)
  assert.ok(rankRecords(compileIndex(records), records, 'Blue').find(row => row.recordId === notes[3].id).score > 0)
  // An already-indexed acknowledgement or instruction scoring above a real record is read, then dropped.
  const { answer } = await recall({ memories: [hit(4, 0.99), hit(1, 0.57), hit(0, '0.97'), hit(6, 0.98), hit(5, 0.5), hit(2, 0.46)] })
  assert.deepEqual(answer.hits.map(one => one.id), [notes[0].id, notes[1].id, notes[2].id])
  assert.deepEqual(answer.hits.map(one => one.score), [0.97, 0.57, 0.46])
  assert.equal(answer.dropped.quality, 3)
})
await check('combined result lists rank before the candidate cap', async () => {
  const { answer } = await recall({ memories: [hit(1, 0.57), hit(2, 0.46)], resources: [hit(0, 0.97)] }, 2)
  assert.deepEqual(answer.hits.map(one => one.id), [notes[0].id, notes[1].id])
})
await check('repeated URI keeps its highest score and does not spend two candidate slots', async () => {
  const { answer, requests } = await recall({ memories: [hit(0, 0.46), hit(1, 0.57)], resources: [hit(0, 0.97), hit(0, 0.96)] }, 2)
  assert.deepEqual(answer.hits.map(one => one.id), [notes[0].id, notes[1].id])
  assert.deepEqual(answer.hits.map(one => one.score), [0.97, 0.57])
  assert.equal(requests.filter(request => request.path === '/api/v1/content/read').length, 2)
})
await check('different URI aliases cite one record at its highest score', async () => {
  const { answer } = await recall({ memories: [hit(0, 0.46, true), hit(1, 0.57), hit(0, 0.97)] })
  assert.deepEqual(answer.hits.map(one => one.id), [notes[0].id, notes[1].id])
  assert.equal(answer.hits[0].score, 0.97)
  assert.equal(answer.hits[0].uri, hit(0, 0.97).uri)
})
await check('equal finite scores retain recency and citation order without boosting acknowledgements', async () => {
  const result = { memories: [hit(0, 0.57), hit(1, 0.57), hit(2, 0.57)] }
  const first = (await recall(result)).answer, second = (await recall(result)).answer
  assert.deepEqual(first.hits.map(one => one.id), [notes[2].id, notes[1].id, notes[0].id])
  assert.deepEqual(second.hits.map(one => one.id), first.hits.map(one => one.id))
  assert.ok(first.hits.every(one => one.score === 0.57))
})
await check('nonfinite scores cannot displace a relevant finite candidate; threshold remains intact', async () => {
  const { answer } = await recall({ memories: [hit(1, 'NaN'), hit(2, 0.3)], resources: [hit(0, 0.97)] }, 2)
  assert.deepEqual(answer.hits.map(one => one.id), [notes[0].id])
  assert.equal(answer.hits[0].score, 0.97)
  assert.equal(answer.dropped.belowThreshold, 1)
})
console.log(`TOTAL ${passed}/${passed + failed} passed`)
process.exitCode = failed ? 1 : 0
