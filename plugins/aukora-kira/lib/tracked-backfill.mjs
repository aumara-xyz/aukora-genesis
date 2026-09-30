/** Idempotent import into the ordinary memory chain. Originals and historical evidence stay untouched. */
import { readdirSync, readFileSync, lstatSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createTrackedMemory, contentHash, memoryChain } from './tracked-memory.mjs'
import { idFromUri } from './recall-openviking.mjs'
import { verifyKiraMemoryRecord } from './record.mjs'
import { readJsonStrict, listJsonFiles, readLinesIfPresent, withFileLock, appendJournalLine } from './strict-read.mjs'
import { AURA_RECORD_DOMAIN, auraEntryHash, chainAuraEntries } from './memory-owner.mjs'
import { recomputeNoteId } from './memory-tiers.mjs'
import { STORE_PATHS } from './memory-store.mjs'

// Only migration consults the obsolete root chain. Normal capture/recall never depends on it.
function migrateRootMembership(stateDir) {
  const lines = readLinesIfPresent(`${stateDir}/${STORE_PATHS.aura}`)
  if (!lines.length) return 0
  const historical = new Map()
  let prev = AURA_RECORD_DOMAIN
  for (const line of lines) {
    const entry = JSON.parse(line)
    if (typeof entry.hash !== 'string') continue
    const { prev: named, hash, ...fields } = entry
    if (named !== prev || auraEntryHash(prev, fields) !== hash) throw new Error('legacy-chain-broken')
    prev = hash
    if (['add', 'remember', 'index-content'].includes(entry.op)) historical.set(entry.id, entry)
  }
  const file = `${stateDir}/${STORE_PATHS.rememberedAura}`
  return withFileLock(file, () => {
    const known = new Set(memoryChain(stateDir).map(entry => entry.id)), entries = []
    for (const name of listJsonFiles(`${stateDir}/${STORE_PATHS.remembered}`)) {
      if (!/^[0-9a-f]{64}\.json$/u.test(name)) continue
      const note = readJsonStrict(`${stateDir}/${STORE_PATHS.remembered}/${name}`)
      if (known.has(note.id) || note.tier === 'forgotten') continue
      const prior = historical.get(note.id)
      if (!prior || prior.entryHash !== note.aura?.entryHash || recomputeNoteId(note) !== note.id) continue
      entries.push({ op: 'remember', id: note.id, at: note.observedAt, entryHash: note.aura.entryHash,
        contentHash: contentHash(note.statement), by: 'kira.root-chain-migration/v1' })
    }
    for (const entry of chainAuraEntries(stateDir, entries, { file })) appendJournalLine({ file, line: JSON.stringify(entry) })
    return entries.length
  })
}

export async function backfillTrackedMemory({ memory, stateDir, subject, config, fetch, legacyDir, legacyFiles = [], legacyUris = [], vikingLegacy = false } = {}) {
  memory ??= createTrackedMemory({ stateDir, subject, config, fetch })
  const result = { imported: 0, duplicate: 0, skipped: 0, failed: 0, existing: 0 }
  try { result.existing += migrateRootMembership(stateDir) } catch { result.failed++ }
  result.existing += memory.ensureTracked()
  const live = memory.read(), pending = []
  const excluded = id => live.forgotten.has(id) || live.states.get(id) === 'hidden'
  const excludedDigests = new Set(live.chain.filter(entry => excluded(entry.id)).map(entry => entry.contentHash))
  const ingest = async input => {
    if (excludedDigests.has(contentHash(input.text))) { result.skipped++; return }
    pending.push(input)
  }
  const records = new Map()
  const collectRecord = (record, identity) => records.set(record.recordId, { record, identity })
  const fromRecord = async (record, identity) => {
    if (excluded(record.recordId) || record.subject !== subject || record.privacy !== 'local' || record.forgotten || record.hidden || record.consent === 'hidden' || record.content?.forgotten || record.content?.hidden || record.content?.consent === 'hidden') { result.skipped++; return }
    const content = record.content ?? {}
    const text = typeof content === 'string' ? content : typeof content.note === 'string' ? content.note
      : typeof content.summary === 'string' ? content.summary : JSON.stringify(content)
    const metadata = Object.fromEntries(['validTo', 'expiresBy', 'current', 'supersededBy', 'hidden', 'forgotten', 'consent', 'stale', 'staleness'].flatMap(key => {
      const value = content[key] ?? record[key]
      return value === undefined ? [] : [[key, value]]
    }))
    const replacements = [...records.values()].filter(other => other.record.links?.some(link =>
      link.relation === 'supersedes' && link.recordId === record.recordId)).map(other => other.record.recordId)
    const prior = Array.isArray(metadata.supersededBy) ? metadata.supersededBy : metadata.supersededBy ? [metadata.supersededBy] : []
    metadata.supersededBy = [...new Set([...prior, ...replacements])]
    await ingest({ text, from: 'memory-backfill', at: record.createdAt, scope: content.scope ?? record.scope ?? 'owner',
      migrationKey: identity, legacyIds: [record.recordId], metadata: { ...metadata, category: record.kind, links: record.links ?? [] } })
  }
  // Validate historical content-addressed objects and their records, without requiring memory approval receipts.
  for (const name of listJsonFiles(`${stateDir}/keys`)) {
    try {
      const projection = readJsonStrict(`${stateDir}/keys/${name}`)
      if (!/^[0-9a-f]{64}$/u.test(projection.contentSha256)) throw new Error('invalid-object-address')
      const raw = readFileSync(`${stateDir}/objects/${projection.contentSha256}.json`, 'utf8')
      if (contentHash(raw) !== projection.contentSha256) throw new Error('object-hash-mismatch')
      const object = JSON.parse(raw), verdict = verifyKiraMemoryRecord(object.value)
      if (!verdict.verified || object.key !== projection.key || verdict.record.recordId !== object.key) throw new Error('invalid-record')
      collectRecord(verdict.record, `legacy-record:${object.key}`)
    } catch { result.failed++ }
  }
  // Historical staging is input data only; no new staging queue is produced.
  for (const name of listJsonFiles(`${stateDir}/queue`)) {
    try {
      const entry = readJsonStrict(`${stateDir}/queue/${name}`)
      const verdict = verifyKiraMemoryRecord(entry.record ?? entry.memoryPut?.value)
      if (!verdict.verified) throw new Error('invalid-record')
      collectRecord(verdict.record, `legacy-record:${verdict.record.recordId}`)
    } catch { result.failed++ }
  }
  const files = [...legacyFiles]
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const file = join(dir, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (entry.isFile() && /\.(md|txt|json)$/u.test(entry.name)) files.push(file)
    }
  }
  if (legacyDir) walk(legacyDir)
  for (const file of new Set(files.map(file => resolve(file)))) {
    try {
      if (!lstatSync(file).isFile()) throw new Error('not-a-file')
      const raw = readFileSync(file, 'utf8')
      if (file.endsWith('.json')) {
        const parsed = JSON.parse(raw), candidate = parsed.record ?? parsed.value ?? parsed
        if (candidate.recordId) {
          const verdict = verifyKiraMemoryRecord(candidate)
          if (!verdict.verified) throw new Error('invalid-record')
          collectRecord(verdict.record, `legacy-record:${verdict.record.recordId}`)
          continue
        }
      }
      await ingest({ text: raw, from: 'memory-backfill', migrationKey: `legacy-file:${contentHash(raw)}` })
    } catch { result.failed++ }
  }
  for (const { record, identity } of records.values()) await fromRecord(record, identity)
  if (vikingLegacy) legacyUris = [...legacyUris, ...await memory.bridge.listLegacy()]
  for (const uri of new Set(legacyUris)) {
    try {
      const user = String(uri).match(/^viking:\/\/user\/([A-Za-z0-9_-]{1,64})\//u)?.[1]
      const oldId = user ? idFromUri(user, uri) : null
      if (excluded(uri) || (oldId && excluded(oldId))) { result.skipped++; continue }
      const text = await memory.bridge.readContent(uri)
      if (typeof text !== 'string') throw new Error('invalid-index-content')
      await ingest({ text, from: 'memory-backfill', legacyIds: [uri, oldId].filter(Boolean), migrationKey: `legacy-viking:${uri}:${contentHash(text)}` })
    } catch { result.failed++ }
  }
  const batch = await memory.rememberBatch(pending, { prioritize: false })
  for (const answer of batch.results) {
    if (answer.error) result.failed++
    else if (answer.remembered) result.imported += answer.remembered
    else if (answer.ids?.length) result.duplicate++
    else result.skipped++
  }
  result.index = await memory.retry()
  return result
}
