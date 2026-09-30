#!/usr/bin/env node
/** Historical records become ordinary tracked memory; no approval fixtures or live state. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { stageKiraMemoryRecord, memoryEffectBody } from '../plugins/aukora-kira/lib/record.mjs'
import { createTrackedMemory, contentHash, memoryChain } from '../plugins/aukora-kira/lib/tracked-memory.mjs'
import { backfillTrackedMemory } from '../plugins/aukora-kira/lib/tracked-backfill.mjs'
import { uriFor, idFromUri } from '../plugins/aukora-kira/lib/recall-openviking.mjs'
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
  console.log('kira-openviking-governed: 7 historical records + 29 legacy files tracked/indexed, repeat imported 0; no approval and relevance first')
} finally { rmSync(stateDir, { recursive: true, force: true }) }
