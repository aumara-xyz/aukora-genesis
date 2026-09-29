#!/usr/bin/env node
/**
 * Phase 1 A1 court — governed records share the OpenViking semantic root,
 * while reserved slots keep them bounded and independently eligible.
 * No daemon, live store, or OpenViking account is used.
 */
import assert from 'node:assert/strict'
import { createOpenVikingRecall, semanticNotes, uriFor, idFromUri } from '../plugins/aukora-kira/lib/recall-openviking.mjs'

const USER = 'owner'
const config = {
  configured: true, url: 'http://127.0.0.1:1933', account: 'aukora', user: USER, key: 'scratch', onMachine: true,
  scoreThreshold: 0.4, window: 0.5, limit: 3, candidates: 20, timeoutMs: 1000, syncBatch: 32,
  queryInstruction: '',
}
const ambient = new Map([
  ['rem:' + 'a'.repeat(64), { id: 'rem:' + 'a'.repeat(64), tier: 'remembered', statement: 'ambient alpha' }],
  ['rem:' + 'b'.repeat(64), { id: 'rem:' + 'b'.repeat(64), tier: 'remembered', statement: 'ambient beta' }],
  ['rem:' + 'c'.repeat(64), { id: 'rem:' + 'c'.repeat(64), tier: 'remembered', statement: 'ambient gamma' }],
])
const governed = new Map([
  ['kira:' + '1'.repeat(64), { id: 'kira:' + '1'.repeat(64), tier: 'signed', statement: 'governed one' }],
  ['kira:' + '2'.repeat(64), { id: 'kira:' + '2'.repeat(64), tier: 'signed', statement: 'governed two' }],
  ['kira:' + '3'.repeat(64), { id: 'kira:' + '3'.repeat(64), tier: 'signed', statement: 'governed three' }],
])
const all = new Map([...ambient, ...governed])
const files = new Map()
const scores = new Map()
const response = (status, result) => ({ ok: status >= 200 && status < 300, status, async json() { return { status: 'ok', result } } })
const fakeFetch = async (url, options = {}) => {
  const parsed = new URL(url)
  if (parsed.pathname === '/health') return { ok: true, status: 200, async json() { return { healthy: true } } }
  const body = options.body === undefined ? {} : JSON.parse(options.body)
  if (parsed.pathname === '/api/v1/fs/ls') return response(200, [...files.keys()])
  if (parsed.pathname === '/api/v1/content/write') { files.set(body.uri, body); return response(200, {}) }
  if (parsed.pathname === '/api/v1/fs' && options.method === 'DELETE') {
    const target = parsed.searchParams.get('uri')
    for (const uri of files.keys()) if (uri === target || uri.startsWith(`${target}/`)) files.delete(uri)
    return response(200, {})
  }
  if (parsed.pathname === '/api/v1/search/find') {
    return response(200, { memories: [...files.entries()].map(([uri, value]) => ({ uri, tags: value.tags, score: scores.get(idFromUri(USER, uri)) ?? 0.8 })), resources: [] })
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
const ledger = () => ({ ambient, governed, complete: true })

await arm('A1 gives ambient and governed records distinct, reversible URIs', async () => {
  const rem = [...ambient.keys()][0]
  const kira = [...governed.keys()][0]
  assert.equal(idFromUri(USER, uriFor(USER, rem)), rem)
  assert.equal(idFromUri(USER, uriFor(USER, kira)), kira)
  assert.match(uriFor(USER, kira), new RegExp(`/governed/${kira.slice(5)}\\.md$`, 'u'))
  assert.doesNotMatch(uriFor(USER, kira), /\/governed\/kira-/u)
  // legacy read still works
  assert.equal(idFromUri(USER, `viking://user/${USER}/memories/kira/governed/kira-${kira.slice(5)}.md`), kira)
})

await arm('sync indexes governed records beside ambient with tier tags', async () => {
  const answer = await bridge.sync(ledger())
  assert.equal(answer.added, 6)
  for (const [id, note] of all) {
    const uri = uriFor(USER, id)
    assert.equal(files.get(uri)?.content, note.statement)
    assert.ok(files.get(uri)?.tags.includes(`kira_id=${id}`))
    assert.ok(files.get(uri)?.tags.includes(`tier=${note.tier}`))
  }
})

await arm('semantic recall reserves at most two governed slots without boosting score', async () => {
  for (const id of ambient.keys()) scores.set(id, 0.95)
  for (const id of governed.keys()) scores.set(id, 0.60)
  const answer = await bridge.recall({ question: 'governance', live: ledger })
  assert.equal(answer.hits.length, 3)
  assert.deepEqual(answer.hits.slice(0, 2).map(hit => hit.tier), ['signed', 'signed'])
  assert.equal(answer.hits.filter(hit => hit.tier === 'signed').length, 2)
  assert.equal(answer.hits.filter(hit => hit.tier !== 'signed').length, 1)
  assert.equal(answer.reserved.wastedReserved, 0)
  assert.equal(answer.hits[0].score, 0.60)
  const rendered = semanticNotes(answer)
  assert.deepEqual(rendered.notes.slice(0, 2).map(note => [note.tier, note.slot]), [['signed', 'governed'], ['signed', 'governed']])
})

await arm('governed records must clear the same threshold independently', async () => {
  for (const id of ambient.keys()) scores.set(id, 0.95)
  for (const id of governed.keys()) scores.set(id, 0.2)
  const answer = await bridge.recall({ question: 'governance', live: ledger })
  assert.equal(answer.hits.every(hit => hit.tier !== 'signed'), true)
  assert.equal(answer.reserved.wastedReserved, 2)
  assert.equal(answer.dropped.belowThreshold, 3)
})

await arm('stale governed entries are removed only with a complete verified ledger', async () => {
  const retained = new Map(governed)
  retained.delete([...governed.keys()][2])
  const answer = await bridge.sync({ ambient, governed: retained, complete: true })
  assert.equal(answer.removed, 1)
  assert.equal(files.has(uriFor(USER, [...governed.keys()][2])), false)
})

await arm('an incomplete ledger never removes governed index entries', async () => {
  const missing = [...governed.keys()][1]
  files.set(uriFor(USER, missing), { uri: uriFor(USER, missing), content: 'still indexed', tags: [`kira_id=${missing}`, 'tier=signed'] })
  const answer = await bridge.sync({ ambient, governed: new Map(), complete: false })
  assert.equal(answer.removed, 0)
  assert.equal(files.has(uriFor(USER, missing)), true)
})

await arm('OV hit for forgotten/gone governed id is dropped (no tombstone bypass)', async () => {
  // Index all six, then hand a ledger that omits one governed id (forgotten/gone).
  await bridge.sync(ledger())
  const forgotten = [...governed.keys()][0]
  const retained = new Map(governed)
  retained.delete(forgotten)
  const forgottenUri = uriFor(USER, forgotten)
  // Re-plant a stale OV entry AFTER a full index (simulates forget not yet reconciled).
  files.set(forgottenUri, {
    uri: forgottenUri,
    content: 'forgotten body must not surface',
    tags: [`kira_id=${forgotten}`, 'tier=signed'],
  })
  assert.equal(files.has(forgottenUri), true)
  scores.set(forgotten, 0.99)
  for (const id of ambient.keys()) scores.set(id, 0.5)
  for (const id of retained.keys()) scores.set(id, 0.5)
  const answer = await bridge.recall({
    question: 'governance',
    live: () => ({ ambient, governed: retained, complete: true }),
  })
  assert.equal(answer.hits.some(hit => hit.id === forgotten), false)
  // complete ledger reconcile removes the stale OV entry (no tombstone bypass)
  assert.equal(files.has(forgottenUri), false)
})

await arm('OV tags alone cannot bypass a missing settled record', async () => {
  const ghost = 'kira:' + '9'.repeat(64)
  const ghostUri = uriFor(USER, ghost)
  files.set(ghostUri, {
    uri: ghostUri,
    content: 'should never surface',
    tags: [`kira_id=${ghost}`, 'tier=signed'],
  })
  scores.set(ghost, 0.99)
  for (const id of ambient.keys()) scores.set(id, 0.4)
  const answer = await bridge.recall({
    question: 'ghost',
    live: () => ({ ambient, governed, complete: true }),
  })
  assert.equal(answer.hits.some(hit => hit.id === ghost), false)
  assert.equal(files.has(ghostUri), false)
})

await arm('incomplete ledger still drops unmapped hits from the answer', async () => {
  const missing = [...governed.keys()][1]
  const uri = uriFor(USER, missing)
  files.set(uri, { uri, content: 'stale', tags: [`kira_id=${missing}`, 'tier=signed'] })
  scores.set(missing, 0.99)
  for (const id of ambient.keys()) scores.set(id, 0.4)
  const answer = await bridge.recall({
    question: 'incomplete',
    live: () => ({ ambient, governed: new Map(), complete: false }),
  })
  assert.equal(answer.hits.some(hit => hit.id === missing), false)
  // incomplete: may keep OV entry (no delete), but must not show it
  assert.equal(files.has(uri), true)
})

process.stdout.write(`kira-openviking-governed: ${passed} passed, ${failures} failed\n`)
process.exit(failures === 0 ? 0 : 1)
