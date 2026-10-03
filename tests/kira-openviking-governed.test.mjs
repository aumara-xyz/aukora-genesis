#!/usr/bin/env node
/** Historical records become ordinary tracked memory; no approval fixtures or live state. */
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, renameSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { stageKiraMemoryRecord, memoryEffectBody } from '../plugins/aukora-kira/lib/record.mjs'
import { createTrackedMemory, contentHash, memoryChain } from '../plugins/aukora-kira/lib/tracked-memory.mjs'
import { backfillTrackedMemory } from '../plugins/aukora-kira/lib/tracked-backfill.mjs'
import { uriFor, idFromUri } from '../plugins/aukora-kira/lib/recall-openviking.mjs'
import { captureRoom, roomStatement } from '../plugins/aukora-kira/lib/room-capture.mjs'
const stateDir = mkdtempSync(join(tmpdir(), 'kira-memory-import-')), subject = 'aukora:1:' + '3c'.repeat(32)
const config = { configured: true, url: 'http://scratch.invalid', user: 'scratch', scoreThreshold: .4, limit: 3 }
const files = new Map(), scores = new Map()
const fetch = async (url, options = {}) => {
  const parsed = new URL(url), uri = parsed.searchParams.get('uri')
  if (parsed.pathname === '/health') return Response.json({ healthy: true })
  let result
  if (parsed.pathname === '/api/v1/content/write') { const body = JSON.parse(options.body); files.set(body.uri, body.content); result = {} }
  else if (parsed.pathname === '/api/v1/content/read') result = files.get(uri)
  else if (parsed.pathname === '/api/v1/search/find') result = { memories: [...files].map(([uri, text]) => ({ uri, score: scores.get(text) ?? .8 })).sort((a, b) => b.score - a.score) }
  else if (parsed.pathname === '/api/v1/fs/ls') result = [...files.keys()].filter(one => one.startsWith(uri + '/'))
  else if (options.method === 'DELETE') { files.delete(uri); result = {} }
  else throw new Error('unexpected path')
  return Response.json({ status: 'ok', result })
}
try {
  for (const name of ['keys', 'objects', 'legacy']) mkdirSync(join(stateDir, name))
  for (let i = 0; i < 7; i++) {
    const staged = stageKiraMemoryRecord({ subject, kind: 'observation', source: [], content: { note: `Historical finding number ${i}.` }, links: [], privacy: 'local', createdAt: '2026-08-01T00:00:00Z' })
    const raw = memoryEffectBody(staged.memoryPut), hash = contentHash(raw)
    writeFileSync(join(stateDir, 'objects', `${hash}.json`), raw)
    writeFileSync(join(stateDir, 'keys', `${staged.recordId}.json`), JSON.stringify({ key: staged.recordId, contentSha256: hash }))
  }
  for (let i = 0; i < 29; i++) writeFileSync(join(stateDir, 'legacy', `${i}.md`), `Legacy text number ${i}.\n`)
  const memory = createTrackedMemory({ stateDir, subject, config, fetch })
  const first = await backfillTrackedMemory({ memory, stateDir, subject, config, legacyDir: join(stateDir, 'legacy') })
  assert.equal(first.imported, 36); assert.equal(first.failed, 0)
  for (let batch = 0; files.size < 36 && batch < 5; batch++) {
    const retry = await memory.retry()
    assert.ok(retry.requests <= 8)
  }
  assert.equal(memory.read().notes.length, 36); assert.equal(files.size, 36)
  assert.ok(memory.read().notes.every(note => note.tier === 'remembered' && !note.grantsAuthority))
  assert.ok(memoryChain(stateDir).every(entry => entry.contentHash && entry.prev && entry.hash))
  const before = readFileSync(join(stateDir, 'remembered/aura.jsonl'), 'utf8')
  const repeated = await backfillTrackedMemory({ memory, stateDir, subject, config, legacyDir: join(stateDir, 'legacy') })
  assert.equal(repeated.imported, 0); assert.equal(repeated.duplicate, 36)
  assert.equal(readFileSync(join(stateDir, 'remembered/aura.jsonl'), 'utf8'), before)
  const old = 'Historical finding number 0.'
  scores.set(old, .99)
  assert.equal((await memory.recall({ question: 'something semantically related' })).notes[0].text, old)
  const id = 'kira:' + 'a'.repeat(64)
  assert.equal(idFromUri('scratch', uriFor('scratch', id)), id)
  assert.equal(idFromUri('scratch', `viking://user/scratch/memories/kira/governed/kira-${id.slice(5)}.md`), id)
  // The Room: every post after the first pass is chained, agent-attributed with its claimed author; no backfill, no copy on reread.
  const room = join(stateDir, 'room.log'), at = '2026-10-03T18:20:00+0800'
  const post = (id, from, msg, origin = 'terminal') => `${JSON.stringify({ id, at, from, to: 'ALL', msg, origin })}\n`
  writeFileSync(room, post('CLAUDE-1', 'CLAUDE', 'Posted before the first pass, so it stays out.'))
  assert.equal((await captureRoom(memory, { stateDir, room })).captured, 0)
  appendFileSync(room, post('PETER-2', 'PETER', 'The Room is where the lanes and I meet.', 'aukora-room-app')
    + `${JSON.stringify({ id: 'AUMA-3', at, from: 'AUMA', to: 'PETER', ack: 'PETER-2', msg: 'Seen, and the Room note is clear.' })}\n` + post('AUMA-4', 'AUMA', 'ok') + '{"id":"CODEX-DESKTOP-5"')
  assert.deepEqual(await captureRoom(memory, { stateDir, room }).then(pass => [pass.captured, pass.posts]), [2, 2])
  appendFileSync(room, `,"at":"${at}","from":"CODEX-DESKTOP","to":"ALL","msg":"Kira reads the Room file itself."}\n`)
  assert.equal((await captureRoom(memory, { stateDir, room })).captured, 1)
  const chained = readFileSync(join(stateDir, 'remembered/aura.jsonl'), 'utf8'), cursor = join(stateDir, 'room/cursor.json')
  writeFileSync(cursor, JSON.stringify({ ...JSON.parse(readFileSync(cursor, 'utf8')), offset: Buffer.byteLength(post('CLAUDE-1', 'CLAUDE', 'Posted before the first pass, so it stays out.')) }))
  assert.deepEqual(await captureRoom(memory, { stateDir, room }).then(pass => [pass.captured, pass.posts]), [0, 3])
  assert.equal(readFileSync(join(stateDir, 'remembered/aura.jsonl'), 'utf8'), chained)
  const roomNotes = memory.read().notes.filter(note => note.source?.room === room)
  assert.deepEqual(roomNotes.map(note => note.source.from).sort(), ['AUMA', 'CODEX-DESKTOP', 'PETER'])
  assert.ok(roomNotes.every(note => note.attributedTo === 'agent' && note.grantsAuthority === false && note.receiptState === 'UNLINKED'))
  const peter = roomNotes.find(note => note.source.from === 'PETER')
  assert.equal(peter.statement, `From: PETER (claimed) in the Room\nWhen: ${at}\n\nThe Room is where the lanes and I meet.`)
  assert.equal(peter.source.origin, 'aukora-room-app')
  assert.ok(memoryChain(stateDir).filter(entry => roomNotes.some(note => note.id === entry.id)).every(entry => entry.contentHash && entry.hash))
  for (let batch = 0; batch < 5 && ![...files.values()].includes(peter.statement); batch++) await memory.retry({ force: true })
  assert.ok([...files.values()].includes(peter.statement))
  assert.ok(![...files.values()].some(text => text.endsWith('\n\nok')))
  // Nothing a post carries may leave half an emoji in the store: a quote cut at index 199 and a 63-character origin plus an
  // emoji are chained (that origin dropped); an id holding a lone surrogate skips its line.
  const wave = 'The harbour log notes every Room handover in order. '.repeat(5).slice(0, 199 - roomStatement({ from: 'CLAUDE', to: 'ALL', at, msg: '' }).length) + '\u{1F30A} and the tide turns.'
  assert.equal(roomStatement({ from: 'CLAUDE', to: 'ALL', at, msg: wave }).charCodeAt(199), 0xd83c)
  appendFileSync(room, post('CLAUDE-6', 'CLAUDE', wave) + post('CLAUDE-7', 'CLAUDE', 'The origin field is checked whole, never cut.', 'o'.repeat(63) + '\u{1F30A}')
    + post('CLAUDE-\ud800-8', 'CLAUDE', 'A lone surrogate in the id skips this line.'))
  assert.deepEqual(await captureRoom(memory, { stateDir, room }).then(pass => [pass.captured, pass.posts]), [2, 2])
  assert.equal(memory.read().complete, true)
  assert.equal(memory.read().notes.find(note => note.source?.messageId === 'CLAUDE-7').source.origin, null)
  // Replaced (new inode): the history it holds is not backfilled; a post appended after the pass is.
  writeFileSync(join(stateDir, 'room.next'), post('PETER-9', 'PETER', 'Old history copied into a replacement file stays out.'))
  renameSync(join(stateDir, 'room.next'), room)
  assert.equal((await captureRoom(memory, { stateDir, room })).captured, 0)
  appendFileSync(room, post('PETER-10', 'PETER', 'A post appended after the replacement is remembered.'))
  assert.equal((await captureRoom(memory, { stateDir, room })).captured, 1)
  assert.equal(memory.read().complete, true)
  console.log('kira-openviking-governed: 7 historical records + 29 legacy files tracked/indexed, repeat imported 0; no approval and relevance first')
  console.log('kira-openviking-governed: Room 3 posts chained (agent-attributed, author claimed), 0 backfilled, reread 0, ack with text skipped, "ok" not indexed')
  console.log('kira-openviking-governed: Room emoji at quote 199 and 63+emoji origin chained, lone-surrogate id skipped, store complete; replaced file not backfilled')
} finally { rmSync(stateDir, { recursive: true, force: true }) }
