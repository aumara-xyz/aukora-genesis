/** One memory path: durable remembered Aura first, content-addressed semantic index second.
 * The verified chain is also the durable outbox: a missing index acknowledgement is retried.
 * No approval, grant, queue proposal or authority is created by this module. */
import { AURA_RECORD_DOMAIN, auraEntryHash, chainAuraEntries } from './memory-owner.mjs'
import { buildRememberedNote, canonicalInstant, cutText, recomputeNoteId, sha256Hex, MEMORY_TIER } from './memory-tiers.mjs'
import { contentHash, verifyContentHash } from './memory-quality.mjs'
import { consumeTurn } from './memory-capture-hook.mjs'
import { nextEntry, verifyChain as verifyJournal } from './memory-journal.mjs'
import { STORE_PATHS, objectFileName } from './memory-store.mjs'
import { CONTROLS, forgottenIds, noteStates, ownerControlIn } from './memory-forget.mjs'
import { SECRET_PATTERNS, FORBIDDEN_WINDOW_DIGESTS, carriesForbiddenPhrase } from './compaction-export.mjs'
import { readForbiddenDigests } from './forbidden-digests.mjs'
import { appendJournalLine, durableWrite, ensureDirectory, listJsonFiles, readJsonStrict, readLinesIfPresent, withFileLock } from './strict-read.mjs'
import { createOpenVikingRecall, semanticNotes, SEMANTIC_DEFAULTS, contentUri } from './recall-openviking.mjs'
import { filterMemoryRecords } from './recall-filter/filter.mjs'
import { compileIndex, rankRecords, LEXICAL_METHOD, RETRIEVAL_CEILING } from './retrieval.mjs'
import { randomUUID } from 'node:crypto'

const RETRY_BATCH = 8
const retryFlights = new Map()
const batchSize = value => Number.isInteger(value) && value > 0 ? Math.min(value, RETRY_BATCH) : RETRY_BATCH

const chainFile = stateDir => `${stateDir}/${STORE_PATHS.rememberedAura}`
const journalFile = stateDir => `${stateDir}/${STORE_PATHS.journal}`
const decode = file => readLinesIfPresent(file).map((line, damagedAt) => {
  try { return JSON.parse(line) }
  catch { throw Object.assign(new Error('memory-chain-unreadable'), { code: 'memory-chain-unreadable',
    verdict: { ok: false, damagedAt, why: 'chain line does not parse; possible torn append' } }) }
})
export { contentHash } from './memory-quality.mjs'
export const MAX_NOTE_CHARS = 16_000
export const validExternalOrigin = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/u.test(value) && !/^(owner|peter|kira)/iu.test(value)

function journalSnapshot(stateDir) {
  const lines = readLinesIfPresent(journalFile(stateDir)), verdict = verifyJournal(lines)
  if (!verdict.ok) {
    const error = new Error(`memory-journal-broken: damaged-chain at ${verdict.damagedAt}: ${verdict.why}`)
    error.code = 'memory-journal-broken'; error.verdict = verdict
    throw error
  }
  return { journal: lines.filter(line => line.trim()).map(line => JSON.parse(line)),
    forgotten: forgottenIds(stateDir, () => lines), states: noteStates(stateDir, () => lines) }
}

function boundedNotes(note) {
  if (note.statement.length <= MAX_NOTE_CHARS) return [note]
  const chunks = []
  for (let start = 0; start < note.statement.length;) {
    let end = Math.min(start + MAX_NOTE_CHARS, note.statement.length)
    if (end < note.statement.length && /[\uD800-\uDBFF]/u.test(note.statement[end - 1])) end--
    const statement = note.statement.slice(start, end)
    chunks.push({ ...buildRememberedNote({ ...note, statement,
      evidence: note.evidence.map(one => ({ ...one, quote: cutText(statement, 200) })),
      source: { ...note.source, span: { start, end, total: note.statement.length, unit: 'utf16' } },
      origin: note.origin?.run ? { ...note.origin, captureRun: note.origin.run, run: sha256Hex(`${note.origin.run}:${start}:${end}`) } : note.origin,
      salt: sha256Hex(`${note.id}:${start}:${end}`) }), bodyAtCapture: note.bodyAtCapture ?? null })
    start = end
  }
  return chunks
}

/** Verify the entire chain. Legacy entries without hashes cannot establish membership. */
export function memoryChain(stateDir) {
  const entries = []
  let prev = AURA_RECORD_DOMAIN
  for (const entry of decode(chainFile(stateDir))) {
    if (!entry || typeof entry !== 'object') throw new Error('memory-chain-unreadable')
    if (typeof entry.hash !== 'string') continue
    const { prev: named, hash, ...fields } = entry
    if (named !== prev || auraEntryHash(prev, fields) !== hash) throw new Error('memory-chain-broken')
    prev = hash; entries.push(entry)
  }
  return entries
}

/** Exact stored statement bytes, validated against the envelope AND the content commitment.
 * Old valid notes are accepted for bounded migration and local recall. */
export function readTrackedMemory(stateDir) {
  const chain = memoryChain(stateDir)
  const membership = new Map(chain.filter(e => ['add', 'remember', 'index-content'].includes(e.op) && e.entryHash).map(e => [e.id, e]))
  const commitments = new Map(chain.filter(e => e.op === 'index-content').map(e => [e.id, e]))
  const { journal, forgotten, states } = journalSnapshot(stateDir)
  const notes = [], withheld = [], orphans = [], seen = new Set()
  for (const name of listJsonFiles(`${stateDir}/${STORE_PATHS.remembered}`)) {
    if (!/^[0-9a-f]{64}\.json$/u.test(name)) continue
    seen.add(`rem:${name.slice(0, -5)}`)
    let note
    try {
      note = readJsonStrict(`${stateDir}/${STORE_PATHS.remembered}/${name}`)
      if (note.tier === 'forgotten' || forgotten.has(note.id)) continue
      if (states.get(note.id) === 'hidden') continue
      const entry = membership.get(note.id)
      const hash = contentHash(note.statement)
      const commitment = commitments.get(note.id)
      if ((entry?.contentHash !== undefined && entry.contentHash !== hash) || (note.contentHash !== undefined && note.contentHash !== hash)
        || (commitment && (commitment.contentHash !== hash || commitment.entryHash !== note.aura?.entryHash))) throw new Error('content-hash-mismatch')
      if (!entry || entry.entryHash !== note.aura?.entryHash || recomputeNoteId(note) !== note.id || objectFileName(note.id) !== name) throw new Error('unchained')
      notes.push({ ...note, ...note.origin?.metadata, tier: MEMORY_TIER.remembered, contentHash: hash,
        trackedContent: entry.contentHash === hash || commitment?.contentHash === hash })
    } catch (error) {
      if (note && !membership.has(note.id)) orphans.push(note)
      withheld.push({ id: note?.id ?? `rem:${name.slice(0, -5)}`, recallRefusal: String(error?.message ?? 'unreadable') })
    }
  }
  for (const [id] of membership) if (id?.startsWith('rem:') && !seen.has(id) && !forgotten.has(id) && states.get(id) !== 'hidden') withheld.push({ id, recallRefusal: 'missing-object' })
  return { notes, withheld, forgotten, states, complete: withheld.length === 0, chain, journal, orphans,
    hashMismatches: withheld.filter(note => note.recallRefusal === 'content-hash-mismatch').length }
}

function repairJournal(stateDir, notes, journal, budget = notes.length) {
  const journalled = new Set(journal.filter(e => e.op === 'add').map(e => e.id))
  let previous = journal.at(-1) ?? null, repaired = 0
  for (const note of notes) if (!journalled.has(note.id)) {
    if (repaired >= budget) break
    previous = nextEntry({ previous, op: 'add', id: note.id, objectDigest: contentHash(note.statement), actor: 'kira.capture/v2', at: note.observedAt, reason: '' })
    appendJournalLine({ file: journalFile(stateDir), line: JSON.stringify(previous) })
    journal.push(previous); journalled.add(note.id); repaired++
  }
  return repaired
}

function append(stateDir, notes, live) {
  const file = chainFile(stateDir)
  const prior = live.chain
  const known = new Set(prior.filter(e => ['add', 'remember'].includes(e.op)).map(e => e.id))
  const origins = new Set(prior.map(e => e.originKey).filter(Boolean))
  const seen = new Set(known)
  const fresh = notes.filter(note => {
    if (seen.has(note.id) || live.forgotten.has(note.id) || live.states.get(note.id) === 'hidden' || (note.origin?.run && origins.has(note.origin.run))) return false
    seen.add(note.id); if (note.origin?.run) origins.add(note.origin.run)
    return true
  })
  // Files precede chain entries; a crash leaves an uncommitted file that the same deterministic id can recover.
  const offset = prior.length
  const stored = fresh.map((note, i) => ({ ...note, tier: 'remembered', contentHash: contentHash(note.statement),
    aura: { index: offset + i, entryHash: note.aura?.entryHash ?? sha256Hex(`${note.id}\0${contentHash(note.statement)}`) } }))
  const bodies = stored.map(note => ({ op: 'remember', id: note.id, at: note.observedAt, tier: 'remembered',
    by: 'kira.capture/v2', digest: note.contentHash, contentHash: note.contentHash,
    index: note.aura.index, entryHash: note.aura.entryHash, originKey: note.origin?.run ?? null,
    captureKey: note.origin?.captureRun ?? note.origin?.run ?? null, bodyAtCapture: note.bodyAtCapture ?? null }))
  const entries = chainAuraEntries(stateDir, bodies, { file })
  for (const note of stored) durableWrite(`${stateDir}/${STORE_PATHS.remembered}/${objectFileName(note.id)}`, `${JSON.stringify(note)}\n`, { dir: `${stateDir}/${STORE_PATHS.remembered}` })
  for (const entry of entries) appendJournalLine({ file, line: JSON.stringify(entry) })
  // Persist this capture immediately. Older interrupted appends belong to bounded retry.
  repairJournal(stateDir, stored, live.journal)
  live.chain.push(...entries)
  live.notes.push(...stored.map(note => ({ ...note, ...note.origin?.metadata, trackedContent: true })))
  live.withheld = live.withheld.filter(item => !stored.some(note => note.id === item.id))
  live.complete = live.withheld.length === 0
  return stored
}

export function createTrackedMemory({ stateDir, subject, config = { configured: false }, fetch, client, now = Date.now, policyOf } = {}) {
  if (typeof stateDir !== 'string' || !stateDir.startsWith('/')) throw new Error('memory-explicit-absolute-state-dir-required')
  if (typeof subject !== 'string' || !subject) throw new Error('memory-subject-required')
  const bridge = client ?? createOpenVikingRecall({ config, fetch, now, stateDir })
  const prepare = () => { ensureDirectory(stateDir); ensureDirectory(`${stateDir}/${STORE_PATHS.remembered}`) }
  const policy = async overrides => ({ ...overrides, subject, privacy: 'local', ...(await policyOf?.()) })
  const blocked = (p, text = '') => p.privacy !== 'local' || p.offTheRecord === true || ownerControlIn(text) !== null
    || Object.entries(CONTROLS).some(([key, value]) => value.stopsCapture && p.controls?.[key])
  const forbiddenDigests = () => {
    const configured = readForbiddenDigests(stateDir)
    if (configured.state === 'malformed') throw new Error('memory-forbidden-digests-unreadable')
    return [...FORBIDDEN_WINDOW_DIGESTS, ...(configured.digests ?? [])]
  }
  const privateContent = (text, digests) => SECRET_PATTERNS.some(pattern => { pattern.lastIndex = 0; return pattern.test(text) })
    || (digests.length > 0 && carriesForbiddenPhrase(text, digests))
  // One verified snapshot per synchronous store operation. Network waits refresh it below.
  const track = (live, budget) => {
    const journalRepaired = repairJournal(stateDir, live.notes, live.journal, budget)
    const committed = new Set(live.chain.filter(entry => entry.op === 'index-content').map(entry => entry.id))
    const pending = live.notes.filter(note => !note.trackedContent && !committed.has(note.id))
    const bodies = pending.slice(0, budget).map(note => ({ op: 'index-content', id: note.id,
      at: canonicalInstant(now()), contentHash: note.contentHash, digest: note.contentHash, entryHash: note.aura.entryHash, by: 'kira.index-backfill/v1' }))
    const entries = chainAuraEntries(stateDir, bodies, { file: chainFile(stateDir) })
    for (const entry of entries) appendJournalLine({ file: chainFile(stateDir), line: JSON.stringify(entry) })
    live.chain.push(...entries)
    const added = new Set(bodies.map(entry => entry.id))
    live.notes = live.notes.map(note => added.has(note.id) ? { ...note, trackedContent: true } : note)
    return { tracked: bodies.length, migrationPending: pending.length - bodies.length, journalRepaired }
  }
  const trackedSnapshot = budget => {
    prepare()
    return withFileLock(chainFile(stateDir), () => {
      const live = readTrackedMemory(stateDir), migration = track(live, budget)
      return { live, migration }
    }, { waitMs: 0 })
  }
  const ensureTracked = (budget = RETRY_BATCH) => trackedSnapshot(batchSize(budget)).migration.tracked
  const ledger = (live = readTrackedMemory(stateDir)) => ({
    entries: new Map(live.notes.filter(note => note.subject === subject && note.privacy === 'local').map(note => [note.id, note])),
    complete: live.complete, forgotten: live.forgotten, states: live.states,
  })
  const syncBatch = batchSize(config.syncBatch)
  const indexSnapshot = async (live, priorityHashes = [], verifyAcknowledged = false, budget = syncBatch) => {
    const snapshot = ledger(live)
    if (!bridge.configured) return { added: 0, requests: 0, pending: snapshot.entries.size, failed: ['openviking-not-configured'] }
    try { return await bridge.sync(() => ledger(), { snapshot, budget, priorityHashes, verifyAcknowledged }) }
    catch { return { added: 0, pending: snapshot.entries.size, failed: ['index-unavailable'] } }
  }
  // The first store read is in a later event-loop turn, never in plugin/server initialization.
  // The small durable lease also backs off a crash/restart, before any full-store scan.
  const retryFile = `${stateDir}/remembered/index/retry.json`
  const retryBaseMs = Math.max(1000, Math.min(900_000, Number(config.retryBaseMs) || 30_000))
  const retryTimeoutMs = Number.isFinite(config.timeoutMs) ? Math.max(1, Math.min(30_000, config.timeoutMs)) : SEMANTIC_DEFAULTS.timeoutMs
  const readRetry = () => {
    try {
      const value = readJsonStrict(retryFile)
      if (!Number.isSafeInteger(value.failures) || value.failures < 0 || !Number.isFinite(value.nextRetryAt)
        || !Number.isFinite(value.leaseUntil)) throw new Error('memory-retry-state-invalid')
      return value
    } catch (error) {
      if (error?.code === 'ENOENT') return { failures: 0, nextRetryAt: 0, leaseUntil: 0 }
      throw error
    }
  }
  // Scratch/operator calls may lower batchSize or bypass backoff with force; an active lease is never bypassed.
  const retry = (options = {}) => {
    if (retryFlights.has(stateDir)) return retryFlights.get(stateDir)
    const flight = new Promise(resolve => setImmediate(resolve)).then(async () => {
      const budget = batchSize(options.batchSize ?? syncBatch), token = randomUUID()
      ensureDirectory(`${stateDir}/remembered/index`)
      const claim = withFileLock(retryFile, () => {
        const prior = readRetry(), at = now()
        if (prior.leaseUntil > at || (options.force !== true && prior.nextRetryAt > at)) return { skipped: true, prior }
        const failures = Math.min(prior.failures + 1, 20)
        const leaseUntil = at + budget * retryTimeoutMs + 30_000
        const next = { failures, nextRetryAt: Math.max(leaseUntil, at + Math.min(900_000, retryBaseMs * 2 ** (failures - 1))), leaseUntil, token }
        durableWrite(retryFile, `${JSON.stringify(next)}\n`)
        return { prior, next }
      }, { waitMs: 0 })
      if (claim.skipped) return { skipped: true, reason: claim.prior.leaseUntil > now() ? 'retry-in-flight' : 'retry-backoff',
        added: 0, tracked: 0, journalRepaired: 0, requests: 0, pending: null, migrationPending: null, batchSize: budget,
        failures: claim.prior.failures, nextRetryAt: claim.prior.nextRetryAt }
      let result
      try {
        const { live, migration } = trackedSnapshot(budget)
        result = { ...await indexSnapshot(live, [], true, budget), ...migration, ledgerComplete: live.complete, hashMismatches: live.hashMismatches }
        if (!live.complete) result.failed = [...(result.failed ?? []), 'memory-store-incomplete']
      } catch { result = { added: 0, failed: ['memory-store-unavailable'] } }
      const failed = result.failed?.length > 0
      const next = { failures: failed ? claim.next.failures : 0, leaseUntil: 0,
        nextRetryAt: failed ? now() + Math.min(900_000, retryBaseMs * 2 ** (claim.next.failures - 1)) : 0 }
      withFileLock(retryFile, () => {
        if (readRetry().token === token) durableWrite(retryFile, `${JSON.stringify(next)}\n`)
      }, { waitMs: 0 })
      return { ...result, skipped: false, batchSize: budget, failures: next.failures, nextRetryAt: next.nextRetryAt }
    }).finally(() => { if (retryFlights.get(stateDir) === flight) retryFlights.delete(stateDir) })
    retryFlights.set(stateDir, flight)
    return flight
  }
  const save = async notes => {
    prepare()
    const { written, live } = withFileLock(chainFile(stateDir), () => {
      const live = readTrackedMemory(stateDir)
      return { written: append(stateDir, notes, live), live }
    })
    const index = await indexSnapshot(live, notes.map(note => contentHash(note.statement)))
    const origins = new Map(live.chain.map(entry => [entry.originKey, entry.id]))
    return { remembered: written.length, ids: notes.map(note => origins.get(note.origin?.run) ?? note.id), notes: written, index }
  }
  const captureTurn = async (turn, options = {}) => {
    const p = await policy(options)
    if (blocked(p, p.attributedTo === 'agent' ? '' : turn.text)) return { remembered: 0, ids: [], reason: 'capture-paused' }
    if (typeof turn.text === 'string' && !turn.text.isWellFormed()) return { remembered: 0, ids: [], reason: 'memory-text-not-well-formed' }
    const at = canonicalInstant(turn.at ?? now()), digests = forbiddenDigests()
    if (privateContent(String(turn.text), digests)) return { remembered: 0, ids: [], reason: 'private-content-filter' }
    const captured = consumeTurn({ ...turn, at }, { ...p, observedAt: at, validFrom: at.slice(0, 10),
      forbiddenDigests: digests, secretPatterns: SECRET_PATTERNS })
    const notes = captured.notes.flatMap(boundedNotes)
    return { ...(await save(notes.map(note => ({ ...note, bodyAtCapture: options.bodyAtCapture ?? null })))), dropped: captured.dropped }
  }
  // Attribution is an explicit second, host-only argument. External adapters never forward it.
  // Backfill batches its inputs here, avoiding a full object-store scan for every import.
  const rememberBatch = async (inputs, { attributedTo = 'agent', prioritize = true } = {}) => {
    if (!['agent', 'owner', 'owner-voice'].includes(attributedTo)) throw new Error('memory-attribution-invalid')
    const p = await policy(), digests = forbiddenDigests()
    prepare()
    const { results, live, candidates } = withFileLock(chainFile(stateDir), () => {
      const live = readTrackedMemory(stateDir)
      const identities = new Map(), candidates = [], results = []
      const excluded = id => live.forgotten.has(id) || live.states.get(id) === 'hidden'
      const excludedDigests = new Set(live.chain.filter(entry => excluded(entry.id)).map(entry => entry.contentHash))
      for (const entry of live.chain) {
        const identity = entry.captureKey ?? entry.originKey
        if (!identity) continue
        if (!identities.has(identity)) identities.set(identity, [])
        if (!identities.get(identity).includes(entry.id)) identities.get(identity).push(entry.id)
      }
      for (const input of inputs) {
        try {
          const { text, from = 'memory', scope = 'owner', at = canonicalInstant(now()), source, migrationKey, metadata = {}, bodyAtCapture = null } = input
          if (typeof text !== 'string' || !text.trim()) throw new Error('memory-text-invalid')
          // A lone surrogate would be stored and then refused on every read, leaving the whole store incomplete.
          if (!text.isWellFormed()) { results.push({ remembered: 0, ids: [], reason: 'memory-text-not-well-formed' }); continue }
          if (typeof from !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/u.test(from)) throw new Error('memory-origin-invalid')
          if (blocked(p, attributedTo === 'agent' ? '' : text)) { results.push({ remembered: 0, ids: [], reason: 'capture-paused' }); continue }
          if (privateContent(text, digests)) { results.push({ remembered: 0, ids: [], reason: 'private-content-filter' }); continue }
          const digest = contentHash(text), identity = sha256Hex(migrationKey ?? `${from}\0${scope}\0${digest}`)
          if (migrationKey && (excludedDigests.has(digest) || input.legacyIds?.some(excluded))) {
            results.push({ remembered: 0, ids: [], reason: 'legacy-content-withheld' }); continue
          }
          // Recover a file written just before a crash, without rescanning all files.
          const orphan = live.orphans.find(note => (note.origin?.captureRun ?? note.origin?.run) === identity
            && note.subject === p.subject && note.privacy === p.privacy && note.scope === scope && note.attributedTo === attributedTo
            && recomputeNoteId(note) === note.id
            && note.statement === (note.source?.span ? text.slice(note.source.span.start, note.source.span.end) : text))
          // A partially chained chunk group is not a completed capture. Rebuild it
          // with its original clock; append deduplicates the already chained parts.
          if (identities.has(identity) && !orphan) { results.push({ remembered: 0, ids: identities.get(identity), notes: [] }); continue }
          const stamp = orphan?.observedAt ?? canonicalInstant(at)
          const note = orphan && !orphan.source?.span ? orphan : buildRememberedNote({ category: metadata.category ?? 'observation', statement: text,
            attributedTo, evidence: [{ log: `memory:${from}`, turn: 0, turnDigest: digest, quote: cutText(text, 200) }],
            validFrom: stamp.slice(0, 10), observedAt: stamp, confidence: 1, sensitivity: 'none', privacy: p.privacy, subject: p.subject,
            scope, source: source ?? { state: 'UNLINKED', cited: false, because: 'captured directly; no session event was claimed' },
            origin: { by: from, run: identity, metadata: Object.fromEntries(['expiresBy', 'current', 'supersededBy', 'hidden', 'forgotten', 'consent', 'stale', 'staleness'].filter(key => metadata[key] !== undefined).map(key => [key, metadata[key]])) },
            salt: identity, validTo: metadata.validTo ?? metadata.expiresBy ?? null, links: metadata.links ?? [] })
          const notes = boundedNotes({ ...note, bodyAtCapture }), ids = notes.map(note => note.id)
          candidates.push(...notes); identities.set(identity, ids)
          results.push({ remembered: 0, ids, notes })
        } catch (error) { results.push({ remembered: 0, ids: [], error: String(error?.message ?? 'memory-input-invalid') }) }
      }
      const written = new Map(append(stateDir, candidates, live).map(note => [note.id, note]))
      for (const result of results) {
        result.notes = (result.notes ?? []).flatMap(note => written.has(note.id) ? [written.get(note.id)] : [])
        result.remembered = result.notes.length
      }
      return { results, live, candidates }
    })
    const hashesById = new Map(live.notes.map(note => [note.id, note.contentHash]))
    const priorityHashes = prioritize ? results.flatMap(result => result.ids.map(id => hashesById.get(id)).filter(Boolean)) : []
    const index = await indexSnapshot(live, priorityHashes)
    return { results, index }
  }
  const remember = async (input, host) => {
    const { results: [result], index } = await rememberBatch([input], host)
    if (result.error) throw new Error(result.error)
    return { ...result, index }
  }
  const recall = async ({ question, limit, context = {}, lexical = false }) => {
    let p = await policy()
    const report = { dropped: 0, reasons: {} }
    const paused = () => p.offTheRecord || Object.entries(CONTROLS).some(([k, v]) => (v.stopsRecall || v.stopsRecallPersonal) && p.controls?.[k])
    const pauseReply = () => ({ state: 'empty', notes: [], memory: report, grantsAuthority: false, reason: 'recall-paused' })
    if (paused()) return pauseReply()
    const filter = (notes, live) => filterMemoryRecords(notes, { ...context, ...p, permittedPrivacy: [p.privacy],
      nowMs: now(), forgotten: live.forgotten, states: live.states }, report)
    try {
      const answer = lexical ? { available: false, reason: 'lexical-requested', hits: [],
        dropped: { unmapped: [], tampered: [], unreadable: [], belowThreshold: 0 } }
        : await bridge.recall({ question, live: () => ledger(), govern: filter, limit })
      // Both unavailable and successful network paths can race forget, hide, capture or policy changes.
      p = await policy()
      if (paused()) return pauseReply()
      const live = readTrackedMemory(stateDir)
      report.hashMismatches = live.hashMismatches + (answer.dropped?.tampered?.length ?? 0)
      const notes = filter([...ledger(live).entries.values(), ...live.withheld], live)
      const byId = new Map(notes.map(note => [note.id, note]))
      if (!answer.available) {
        const records = notes.map(note => ({ recordId: note.id, text: note.statement }))
        const count = Number.isInteger(limit) ? Math.max(1, Math.min(50, limit)) : SEMANTIC_DEFAULTS.limit
        const hits = rankRecords(compileIndex(records), records, String(question ?? ''))
          .filter(row => row.score >= LEXICAL_METHOD.minScore).slice(0, count)
          .map(row => ({ id: row.recordId, score: row.score, note: byId.get(row.recordId), relevance: 'lexical-overlap',
            uri: contentUri(config.user ?? SEMANTIC_DEFAULTS.user, byId.get(row.recordId).contentHash) }))
        return { ...semanticNotes({ ...answer, hits, threshold: LEXICAL_METHOD.minScore }, 60_000),
          ...(live.complete ? {} : { state: 'undetermined' }), method: LEXICAL_METHOD.name, ceiling: RETRIEVAL_CEILING,
          degraded: !lexical, semantic: { available: false, reason: answer.reason }, memory: report, dropped: answer.dropped }
      }
      const hits = answer.hits.flatMap(hit => {
        const note = byId.get(hit.id)
        if (!note) return []
        if (!verifyContentHash(note.statement, hit.note?.contentHash).ok) { report.hashMismatches++; return [] }
        return [{ ...hit, note }]
      })
      return { ...semanticNotes({ ...answer, hits }, 60_000), ...(live.complete && answer.ledgerComplete ? {} : { state: 'undetermined' }),
        semantic: { available: true }, memory: report, dropped: answer.dropped }
    } catch {
      // Store integrity/read failures cannot be laundered into a successful local fallback.
      return { state: 'undetermined', notes: [], grantsAuthority: false, reason: 'memory-store-unavailable', memory: report }
    }
  }
  return Object.freeze({ captureTurn, remember, rememberBatch, retry, recall, ledger, read: () => { const live = readTrackedMemory(stateDir); return { ...live, notes: live.notes.filter(note => note.subject === subject && note.privacy === 'local') } }, ensureTracked, bridge })
}
