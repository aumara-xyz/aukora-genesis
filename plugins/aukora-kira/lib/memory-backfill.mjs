/**
 * THE QUEUE BACKFILL — the 137 records that waited for an approval that is never coming.
 *
 * **FABLE'S kira-122 DECISION 1:** *"MIGRATE the 137 queued records into `remembered` with receipt state UNLINKED: the source is
 * cited but not found, and it is NEVER verified. Back up the queue first (a copy under the state dir), apply, and prove every
 * migrated record answers verify=MISSING with the reason and appears in recall labelled `remembered, source not found`."*
 *
 * WHY THIS FILE EXISTS RATHER THAN THE LOGIC LIVING IN THE SCRIPT: a court can drive a module, and a court cannot drive a
 * `node scripts/…` run without becoming a subprocess test. The backup, the plan and the proof therefore live here, and
 * `scripts/kira/migrate-queue.mjs` is the thin command that calls them — the script is the handle, not the machine.
 *
 * *** AND FIVE OF THE 137 CITE NOTHING AT ALL, WHICH FORCED A DISTINCTION WORTH NAMING. *** 132 records cite a session and a
 * turn the store cannot produce: the source is CITED AND NOT FOUND. Five never recorded a turn, so there is nothing to cite and
 * nothing was looked for — calling those "not found" would be a small lie in a field a person reads. Both migrate, both are
 * UNLINKED, and `source.cited` says which one it is, so the reason can be exact rather than approximate:
 *
 *   { state:'UNLINKED', cited:true,  sessionId, citedTurn, because }   — cited, and the events are not in this store
 *   { state:'UNLINKED', cited:false, because }                          — never cited; there was nothing to look for
 *
 * A PARTIAL CITATION IS REFUSED (`receipt-unlinked-partial`): a session without its turn, or a turn without its session, is a
 * fault in the record rather than a fact about the store, and the two may not be smuggled in as one.
 *
 * @module @aukora/dsh-plugin-kira/memory-backfill
 */
// *** IT REACHES THE FILESYSTEM ONLY THROUGH THE BOUNDARY. *** My first version imported `node:fs` and `node:path` and
// `kira-recall` refused the module BY NAME — the same widening that court caught in `memory-deps`, caught again. Paths are built
// by interpolation the way `memory-store.mjs` builds them, and reads go through `listJsonFiles` and `readJsonStrict`, which are
// the boundary's own strict reader (duplicate keys, oversized artifacts and excessive nesting refused where `JSON.parse` would
// accept them).
import { objectFileName } from './memory-store.mjs'
import { listJsonFiles, readJsonStrict, parseStrictText } from './strict-read.mjs'
import { statementOf, turnReferenceOf } from './memory-migrate.mjs'
import { migratedEntry, verifyChain } from './memory-journal.mjs'
import { UNLINKED_RECEIPT, buildRememberedNote, canonicalOf, cutText, sha256Hex } from './memory-tiers.mjs'
import { verifyRecord } from './memory-verify.mjs'

/** A named refusal, so a caller can act on which precondition failed rather than on a stack. */
export class KiraBackfillError extends Error {
  constructor(code, message) {
    super(`kira.backfill: ${message}`)
    this.name = 'KiraBackfillError'
    this.code = `kira.backfill:${code}`
  }
}

/** @param {string} code @param {string} message @returns {never} */
function refuse(code, message) {
  throw new KiraBackfillError(code, message)
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u
const DATE = /^\d{4}-\d{2}-\d{2}$/u

/** The handful of fields a queued record carries that the note builder needs, read in one place so the shape is not guessed twice. */
const fieldsOf = entry => {
  const record = entry?.record ?? {}
  const content = record?.content ?? {}
  return {
    statement: statementOf(record),
    reference: turnReferenceOf(record),
    // THE CATEGORY THE HARNESS ACCEPTED IT UNDER, passed through as it stands: the builder's own words are "a note carries the
    // category the harness accepted it under", and inventing one here would be me overruling the record.
    category: typeof content.category === 'string' && content.category !== '' ? content.category : 'observation',
    subject: String(entry?.subject ?? record?.subject ?? '').trim(),
    privacy: String(entry?.privacy ?? record?.privacy ?? '').trim(),
    createdAt: String(entry?.createdAt ?? record?.createdAt ?? ''),
  }
}

/**
 * One UNLINKED receipt for a queued record, under the rules above.
 * @param {{sessionId?: unknown, turn?: unknown}} reference - the citation the record carries, if any.
 * @param {string} because - why it could not be linked, in words a reader can act on.
 * @returns {Readonly<Record<string, unknown>>}
 */
export function unlinkedReceipt(reference, because) {
  if (typeof because !== 'string' || because === '') refuse('reason-missing', 'an UNLINKED receipt carries the reason it could not be linked')
  const cited = reference !== null && reference !== undefined && typeof reference.sessionId === 'string' && reference.sessionId !== ''
  return Object.freeze(cited
    ? { state: UNLINKED_RECEIPT, cited: true, sessionId: String(reference.sessionId), citedTurn: Number(reference.turn), because }
    : { state: UNLINKED_RECEIPT, cited: false, because })
}

/**
 * Build one remembered note per queue entry. NO WRITES HAPPEN HERE: this returns notes, journal lines and aura lines for
 * `planStoreWrite` to check, which is what keeps "a note and its journal line travel together" true for a backfill too.
 *
 * @param {object} input
 * @param {ReadonlyArray<{key: string, record: unknown, unreadable?: string}>} input.entries
 * @param {Map<string, {id: string, source: Readonly<Record<string, unknown>>, statement: string}>} [input.linkable]
 * @param {Map<string, string>} [input.becauseByKey] - the planner's reason, per key, for the records that could not be linked.
 * @param {ReadonlySet<string>} [input.alreadyStored] - ids already on disk, so a second run adds nothing twice.
 * @param {string} input.observedAt - a canonical instant, used for records whose own createdAt cannot be read.
 * @param {string} [input.defaultSubject] @param {string} [input.defaultPrivacy]
 * @returns {{notes: ReadonlyArray<object>, skipped: ReadonlyArray<{key: string, why: string}>, counts: Readonly<Record<string, number>>}}
 */
export function migrateNotesFromPlan(input) {
  const {
    entries = [], linkable = new Map(), becauseByKey = new Map(), alreadyStored = new Set(),
    observedAt, auraIndex = 0, defaultSubject = 'owner', defaultPrivacy = 'local',
  } = input ?? {}
  if (typeof observedAt !== 'string' || !INSTANT.test(observedAt)) {
    refuse('observed-at-not-canonical', '`observedAt` must be a canonical UTC instant; no local clock participates in a migration')
  }
  const notes = []
  const skipped = []
  const counts = { migrated: 0, linked: 0, unlinked: 0, 'already-stored': 0, 'statement-empty': 0 }

  for (const entry of entries) {
    const key = String(entry?.key ?? '')
    const { statement, reference, category, subject, privacy, createdAt } = fieldsOf(entry)
    if (statement === '') { counts['statement-empty'] += 1; skipped.push(Object.freeze({ key, why: 'statement-empty' })); continue }

    const linked = linkable.get(key)
    const source = linked !== undefined
      ? Object.freeze({ ...linked.source })
      : unlinkedReceipt(reference, becauseByKey.get(key) ?? 'the record cites a session and turn whose events are not in this store')
    // THE QUEUE ENTRY IS THE ONLY THING WE ACTUALLY HOLD, so its digest is what `turnDigest` carries — and `origin` says so in
    // machine-readable form, because a reader who took that digest for the turn's own bytes would be reading a claim we cannot make.
    const queueDigest = sha256Hex(JSON.stringify(entry?.record ?? null))
    const note = buildRememberedNote({
      category,
      statement,
      attributedTo: 'backfill',
      evidence: [{
        log: reference === null || reference === undefined ? 'queue' : `auma-live/${String(reference.sessionId)}.jsonl`,
        turn: reference === null || reference === undefined ? 0 : Number(reference.turn),
        turnDigest: queueDigest,
        quote: cutText(statement, 200),
      }],
      validFrom: DATE.test(createdAt.slice(0, 10)) ? createdAt.slice(0, 10) : observedAt.slice(0, 10),
      observedAt: INSTANT.test(createdAt) ? createdAt : observedAt,
      confidence: 0.5,
      sensitivity: 'none',
      privacy: privacy === '' ? defaultPrivacy : privacy,
      subject: subject === '' ? defaultSubject : subject,
      source,
      // A DETERMINISTIC SALT, WHICH IS WHAT MAKES A SECOND RUN IDEMPOTENT: `buildRememberedNote` defaults to 32 random bytes,
      // so the same queued record would otherwise mint a new id on every run and the store would fill with copies of itself.
      salt: sha256Hex(`migration/queue-v1\u0000${key}\u0000${queueDigest}`),
      origin: {
        by: 'migration/queue-v1',
        fromQueue: key,
        note: linked !== undefined
          ? 'linked: the receipt is over the exact session event line'
          : 'turnDigest is the digest of the QUEUED RECORD, not of the session turn, which this store cannot produce',
      },
    })
    if (alreadyStored.has(note.id)) { counts['already-stored'] += 1; skipped.push(Object.freeze({ key, why: 'already-stored' })); continue }
    if (linked !== undefined) counts.linked += 1
    else counts.unlinked += 1
    counts.migrated += 1
    // *** THE NOTE NAMES ITS OWN CHAIN ENTRY, WHICH IS THE CONTRACT'S `aura:{index, entryHash}`. *** Without this the chain held the
    // entries and the journal named each note's digest, but the RECORD did not point at its own link in the chain — measured by
    // reading a migrated note back from Peter's store, where `aura` was `undefined`. The hash binds the record to the citation it
    // carries (the session and turn, or the queue key when there was never a citation) and to the note's own content digest, which
    // is its id.
    const objectDigest = String(note.id).slice(4)
    const citation = source.cited === true ? `${String(source.sessionId)}\u0000${String(source.citedTurn)}` : `queue\u0000${key}`
    const withAura = Object.freeze({
      ...note,
      aura: Object.freeze({ index: auraIndex + notes.length, entryHash: sha256Hex(`${citation}\u0000${objectDigest}`) }),
    })
    notes.push(withAura)
  }

  return {
    notes: Object.freeze(notes),
    skipped: Object.freeze(skipped),
    counts: Object.freeze(counts),
  }
}

/**
 * The note ids already in the store, so an apply can say "already migrated" instead of appending a second copy of everything.
 * @param {string} stateDir @returns {ReadonlySet<string>}
 */
export function storedNoteIds(stateDir) {
  // `listJsonFiles` IS THE BOUNDARY'S LISTING and it already filters to `.json`; a missing directory is `[]`, which is the
  // honest answer for "nothing stored yet" rather than an error a caller has to catch.
  const ids = new Set()
  for (const name of listJsonFiles(`${stateDir}/remembered`)) {
    ids.add(`rem:${name.slice(0, -'.json'.length)}`)
  }
  return ids
}

/** The journal and aura lines for a set of notes, chained onto whatever the store already holds. */
export function backfillLines(notes, options) {
  const { previous = null, at, auraIndex = 0 } = options ?? {}
  const journalLines = []
  const auraAppends = []
  let previousEntry = previous
  for (const [index, note] of notes.entries()) {
    const entry = migratedEntry({
      previous: previousEntry,
      id: String(note.id),
      // THE OBJECT DIGEST IS THE NOTE'S OWN CONTENT DIGEST — the same bytes the id is built from, so a reader can check that
      // what the journal names is what the store holds.
      objectDigest: String(note.id).slice(4),
      actor: 'migration/queue-v1',
      reason: note.receiptState === UNLINKED_RECEIPT
        ? 'a queued record became a remembered note whose source is cited but not found'
        : 'a queued record became a remembered note linked to its session event',
      at,
    })
    journalLines.push(JSON.stringify(entry))
    previousEntry = entry
    // AN OBJECT, NOT A STRING: `planStoreWrite` owns the encoding and terminates the line, so encoding it here as well is how
    // the first version produced `"{\"op\":…}"` — a JSON string where the chain expected a JSON entry.
    auraAppends.push({
      // READ FROM THE NOTE, so the line and the record cannot disagree about which entry this is.
      op: 'migrate', id: note.id, at, tier: note.tier, receiptState: note.receiptState,
      index: note.aura?.index ?? auraIndex + index, entryHash: note.aura?.entryHash, digest: String(note.id).slice(4),
    })
  }
  return { journalLines, auraAppends, head: previousEntry }
}

/**
 * THE PROOF FABLE ASKED FOR, and it reads the store back rather than trusting what was written: every migrated note answers
 * MISSING with a reason, and every one is present in recall under its own label.
 *
 * @param {object} input
 * @param {string} input.stateDir @param {ReadonlyArray<object>} input.notes
 * @param {(query: {tiers: ReadonlyArray<string>, q: string, limit: number}) => Promise<ReadonlyArray<object>> | ReadonlyArray<object>} input.listNotes
 * @returns {Promise<{allMissing: boolean, allLabelled: boolean, failures: ReadonlyArray<string>, checked: number}>}
 */
export async function proveMigrated(input) {
  const { stateDir, notes = [], listNotes } = input ?? {}
  const failures = []
  const recalled = typeof listNotes === 'function' ? await listNotes({ tiers: ['remembered'], q: '', limit: 1000 }) : []
  const byId = new Map(recalled.map(one => [String(one.id), one]))
  for (const note of notes) {
    const file = `${stateDir}/remembered/${objectFileName(note.id)}`
    let stored
    try {
      stored = readJsonStrict(file)
    } catch (error) {
      failures.push(`${String(note.id).slice(0, 20)}… is not readable back from disk (${String(error?.message ?? error).slice(0, 60)})`)
      continue
    }
    const answer = verifyRecord(stored, () => null, () => null)
    if (answer.source !== 'MISSING' || answer.failed !== 'source-not-found') {
      failures.push(`${String(note.id).slice(0, 20)}… answered ${String(answer.source)}/${String(answer.failed ?? '-')} instead of MISSING/source-not-found`)
    }
    const shown = byId.get(String(note.id))
    if (shown === undefined) failures.push(`${String(note.id).slice(0, 20)}… is not in recall`)
    else if (String(shown.label) !== 'remembered, source not found') {
      failures.push(`${String(note.id).slice(0, 20)}… is in recall labelled ${JSON.stringify(shown.label)}`)
    }
  }
  return {
    allMissing: failures.every(one => !one.includes('answered')),
    allLabelled: failures.every(one => !one.includes('labelled') && !one.includes('not in recall')),
    failures: Object.freeze(failures),
    checked: notes.length,
  }
}

/** A pure inverse: the caller supplies a strict snapshot and owns all filesystem writes. */
export function planBackfillRevert({ stateRoot, manifest, backupEntries, queue, notes, journal, aura }) {
  const count = value => Number.isSafeInteger(value) && value >= 0
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
    || typeof manifest.at !== 'string' || !INSTANT.test(manifest.at) || !Number.isFinite(Date.parse(manifest.at))
    || !count(manifest.copiedFromQueue) || !count(manifest.journalLinesBefore) || !count(manifest.auraLinesBefore)) {
    refuse('backup-malformed', 'the migration manifest must contain a timestamp and nonnegative integer counts')
  }
  if (manifest.stateRoot !== stateRoot || manifest.queueDir !== `${stateRoot}/kira-memory/queue`) {
    refuse('backup-wrong-state-root', 'the backup belongs to a different state root or queue')
  }
  if (!Array.isArray(backupEntries) || backupEntries.length !== manifest.copiedFromQueue) {
    refuse('backup-incomplete', 'the backed-up queue count does not match its manifest')
  }
  const originals = new Map()
  for (const entry of backupEntries) {
    if (!/^kira:[a-f0-9]{64}$/u.test(entry.key) || originals.has(entry.key) || !entry.record || typeof entry.raw !== 'string') {
      refuse('backup-malformed', 'queue keys must be unique and every original record readable')
    }
    originals.set(entry.key, entry)
  }
  for (const [name, raw] of queue) {
    const entry = originals.get(name.replace(/\.json$/u, ''))
    if (!entry || raw !== entry.raw) refuse('queue-moved-on', 'the queue contains a new or changed file; nothing may be overwritten')
  }
  // Keep the exact prefix bytes, including line endings. Never normalize a chain while truncating it.
  const split = (text, name) => {
    if (typeof text !== 'string' || (text !== '' && !text.endsWith('\n'))) refuse(`${name}-malformed`, 'the chain has a torn tail')
    const raw = text === '' ? [] : text.slice(0, -1).split('\n')
    let entries
    try { entries = raw.map(line => parseStrictText(line, name)) } catch { refuse(`${name}-malformed`, 'the chain contains malformed JSON') }
    if (entries.some(entry => !entry || typeof entry !== 'object' || Array.isArray(entry))) refuse(`${name}-malformed`, 'a chain line is not an object')
    return { raw, entries, prefix: n => raw.slice(0, n).map(line => `${line}\n`).join('') }
  }
  const j = split(journal, 'journal'), a = split(aura, 'aura')
  if (!verifyChain(j.entries).ok) refuse('journal-damaged', 'the journal sequence or hash chain does not verify')
  const tail = j.entries.slice(manifest.journalLinesBefore)
  if (j.entries.length < manifest.journalLinesBefore || a.entries.length < manifest.auraLinesBefore
    || tail.length === 0 || tail.length > originals.size || a.entries.length !== manifest.auraLinesBefore + tail.length) {
    refuse('journal-moved-on', 'the current journal and aura are not exactly a migration tail of this backup')
  }
  const ids = new Set(), keys = new Set(), removed = []
  let previous = j.entries[manifest.journalLinesBefore - 1] ?? null
  for (const [i, entry] of tail.entries()) {
    if (entry.seq !== manifest.journalLinesBefore + i || entry.at !== manifest.at
      || entry.actor !== 'migration/queue-v1' || entry.op !== 'add' || !/^rem:[a-f0-9]{64}$/u.test(entry.id)
      || ids.has(entry.id) || j.entries.slice(0, manifest.journalLinesBefore).some(one => one.id === entry.id)) {
      refuse('journal-moved-on', "the dropped entries must be only this migration's unique seq/id/at adds")
    }
    const note = notes.get(entry.id)
    const original = originals.get(note?.origin?.fromQueue)
    if (!original || keys.has(original.key) || note?.origin?.by !== 'migration/queue-v1') {
      refuse('note-not-migration', 'a journal add is missing its unique original queue record')
    }
    // Re-derive from the original queue bytes, preserving the receipt the migration actually used.
    const rebuilt = migrateNotesFromPlan({ entries: [original], observedAt: manifest.at,
      auraIndex: manifest.auraLinesBefore + i,
      linkable: note.receiptState === 'LINKED' ? new Map([[original.key, { source: note.source }]]) : new Map(),
      becauseByKey: new Map([[original.key, note.source?.because]]),
    }).notes[0]
    if (!rebuilt || canonicalOf(note) !== canonicalOf(rebuilt) || entry.id !== rebuilt.id || entry.objectDigest !== rebuilt.id.slice(4)) {
      refuse('note-changed', 'a migrated note no longer matches the original record and journal')
    }
    const lines = backfillLines([rebuilt], { previous, at: manifest.at, auraIndex: manifest.auraLinesBefore + i })
    if (canonicalOf(entry) !== canonicalOf(JSON.parse(lines.journalLines[0]))
      || canonicalOf(a.entries[manifest.auraLinesBefore + i]) !== canonicalOf(lines.auraAppends[0])) {
      refuse('migration-tail-mismatch', 'a dropped journal/aura line is not exactly the migration output')
    }
    ids.add(entry.id); keys.add(original.key); removed.push({ seq: entry.seq, id: entry.id, at: entry.at })
    previous = entry
  }
  return { removed, queue: new Map(backupEntries.map(entry => [`${entry.key}.json`, entry.raw])),
    journal: j.prefix(manifest.journalLinesBefore), aura: a.prefix(manifest.auraLinesBefore),
    before: { notes: notes.size, queue: queue.size, journal: j.entries.length, aura: a.entries.length },
    after: { notes: notes.size - removed.length, queue: originals.size, journal: manifest.journalLinesBefore, aura: manifest.auraLinesBefore } }
}
