/**
 * MESSAGE EVIDENCE — the PRODUCER for `aukora:nostr-message-evidence:v1`.
 *
 * The reader is another lane's and is authoritative: `scripts/aura/nostr_evidence.py`. This file
 * fixes the writer's side of that interface and nothing else. Read that module before changing
 * anything here; `interface()` there is the source of truth, and this module's court asserts the
 * record it produces against the same six names.
 *
 * THE RECORD IS SIX FIELDS AND NO OTHERS:
 *
 *   { domain, kind, version, eventId, contentDigest, observedAt }
 *
 * THE FIELD SET IS CLOSED, AND WE DO NOT EXTEND IT. The reader refuses a document carrying a field
 * outside the set, by name of that field, and that refusal is load-bearing rather than strict: an
 * open field set is how a later writer smuggles meaning into a document that already reads as
 * evidence. So a fact we would like to record and the reader does not know — the sender, the state
 * of their binding, the relays that took the wrap — is deliberately NOT here. It is in the gift wrap
 * itself and in the contact record, and duplicating it into evidence would create a second copy that
 * can disagree with the first.
 *
 * A DIGEST, NEVER CONTENT, AND THE DIGEST IS OF THE WIRE BYTES. `contentDigest` is the sha256 of
 * the gift-wrap event AS PUBLISHED, not of the message text. A plaintext digest looks harmless and
 * is not: it is a confirmation oracle, so anyone who can guess a message can prove it was sent by
 * hashing their guess and comparing. A digest of the published event proves the record is about
 * those bytes and tells a guesser nothing they could not already read off the relay.
 *
 * THE WIRE IS RETAINED BESIDE THE RECORD, AND THAT DISCLOSES NOTHING NEW. A record whose digest
 * cannot be re-derived is unauditable by construction: anyone can check that a digest has the right
 * length, and nobody can check that it is the digest OF anything. So the exact bytes that were hashed
 * are written beside the record at `<stateDir>/nostr/wire/<contentDigest>.json`. That file is the
 * CIPHERTEXT — the gift-wrap event exactly as published, which the relay already holds and which
 * anyone who can read the relay can already fetch. It is not the plaintext, and reading it requires
 * the same key the recipient needs. Retaining it puts the audit trail in one place instead of asking
 * a later reader to retrieve the same bytes from a relay that may have dropped them.
 *
 * THE SIX FIELDS STAY CLOSED. The wire's path DERIVES from `contentDigest`, so the record needs no
 * field pointing at it and the closed set is untouched.
 *
 * AUTHORITY: NONE, ON EVERY PATH. Nothing here is a grant, a nonce, an approval or a permission,
 * and writing or reading a record confers no authority. This is EVIDENCE. The governed Aura append
 * — the operator's grant and the owner's approval binding exactly those bytes — stays exactly where
 * it is, and nothing in this file touches it.
 *
 * @module @aukora/dsh-plugin-nostr/evidence
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'

import { eventId } from './event.mjs'

/** The record's domain. Must equal the reader's; the court asserts the pair. */
export const EVIDENCE_DOMAIN = 'aukora:nostr-message-evidence:v1'

/** The record's kind. Lowercase, no namespace, because the domain carries the namespace. */
export const EVIDENCE_KIND = 'nostr-message-evidence'

/** The only version this producer writes. An unknown version is the reader's refusal, not ours. */
export const EVIDENCE_VERSION = 1

/** The closed field set, in the reader's order. */
export const EVIDENCE_FIELDS = Object.freeze(['domain', 'kind', 'version', 'eventId', 'contentDigest', 'observedAt'])

/** The directory under the state root where records live. */
export const EVIDENCE_DIR = 'evidence'

/** The directory under the state root where the retained wire bytes live. */
export const WIRE_DIR = 'wire'

/** Named refusals. A caller routes on these; none of them is prose to parse. */
export const EVIDENCE_REFUSE = Object.freeze({
  NOT_A_WRAP: 'nostr-evidence-not-a-wrap',
  UNWRITABLE: 'nostr-evidence-unwritable',
  UNREADABLE: 'nostr-evidence-unreadable',
  WIRE_MISSING: 'nostr-evidence-wire-missing',
  WIRE_MISMATCH: 'nostr-evidence-wire-mismatch',
  WIRE_UNBOUND: 'nostr-evidence-wire-unbound',
})

const refuse = (code, message) => Object.assign(new Error(message), { code })

/** A canonical seconds-precision UTC instant with a Z suffix, which is what the reader demands. */
export const canonicalInstant = (date = new Date()) => date.toISOString().replace(/\.\d{3}Z$/, 'Z')

/**
 * The sha256 of a published gift wrap, as lowercase hex.
 *
 * The bytes hashed are the event's own JSON. `JSON.stringify` is deterministic for a GIVEN object,
 * so two runs over the SAME object agree — which is what makes the digest checkable by anyone
 * holding those bytes.
 *
 * IT IS NOT A CROSS-NODE IDENTITY, AND MEASURING SAID SO. Two nodes holding the same message hold
 * it as different bytes: a relay round trip re-serializes, so the key order the sender signed is
 * not necessarily the order the receiver retains, and the two digests DIFFER. Measured 2026-09-24:
 * a peer filed `1bf3cd65…` for a wrap this node filed as `cbcd7246…`, each internally sound. So
 * `contentDigest` answers "are these the bytes I kept?" and never "is this the message they sent?".
 * THE CROSS-NODE IDENTITY IS THE EVENT ID — see the README.
 *
 * @param {object} wrap - the kind-1059 event as published.
 * @returns {string} 64 lowercase hex characters.
 */
export function wireDigest(wrap) {
  return createHash('sha256').update(JSON.stringify(wrap), 'utf8').digest('hex')
}

/**
 * Build the evidence record for one published gift wrap.
 *
 * @param {object} spec - `{wrap, observedAt?}`.
 * @returns {Readonly<object>} the six-field record.
 * @throws {Error} `nostr-evidence-not-a-wrap` when the event is not a signed gift wrap.
 */
export function messageEvidence({ wrap, observedAt }) {
  if (wrap === null || typeof wrap !== 'object' || typeof wrap.id !== 'string' || !/^[0-9a-f]{64}$/.test(wrap.id)) {
    throw refuse(EVIDENCE_REFUSE.NOT_A_WRAP, 'evidence is about a signed event with a 64-hex id')
  }
  if (wrap.kind !== 1059 && wrap.kind !== 21059) {
    throw refuse(EVIDENCE_REFUSE.NOT_A_WRAP, `evidence is about a gift wrap, and this is kind ${wrap.kind}`)
  }
  // Field order matches the reader's declared set. Only these six keys, ever.
  return Object.freeze({
    domain: EVIDENCE_DOMAIN,
    kind: EVIDENCE_KIND,
    version: EVIDENCE_VERSION,
    eventId: wrap.id,
    contentDigest: wireDigest(wrap),
    observedAt: observedAt ?? canonicalInstant(),
  })
}

/** Where records live for a state root. */
export const evidenceDir = stateDir => join(stateDir, 'nostr', EVIDENCE_DIR)

/** Where the retained wire bytes live for a state root. */
export const wireDir = stateDir => join(stateDir, 'nostr', WIRE_DIR)

/** The path one retained wire occupies. Derived from the digest, so the record needs no field for it. */
export const wirePath = (stateDir, contentDigest) => join(wireDir(stateDir), `${contentDigest}.json`)

/** The path one record occupies. Named by event id, so writing twice is writing the same file. */
export const evidencePath = (stateDir, eventId) => join(evidenceDir(stateDir), `${eventId}.json`)

const retainedCache = new Map()
const RETAINED_CACHE_LIMIT = 128
const fileStamp = path => {
  const stat = statSync(path, { bigint: true })
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`
}

function writeChanged(path, bytes) {
  try { if (readFileSync(path, 'utf8') === bytes) return false } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, bytes, { mode: 0o600 })
  renameSync(temporary, path)
  retainedCache.delete(path)
  return true
}

// Retain ciphertext even when the sender's relay copy failed. The recipient's
// accepted copy establishes publication; this local copy establishes only history.
export function retainGiftWrap(stateDir, wrap) {
  const record = messageEvidence({ wrap })
  if (eventId(wrap) !== record.eventId) throw refuse(EVIDENCE_REFUSE.NOT_A_WRAP, 'gift wrap id does not match its event')
  mkdirSync(wireDir(stateDir), { recursive: true, mode: 0o700 })
  writeChanged(wirePath(stateDir, record.contentDigest), JSON.stringify(wrap))
}

export function readStoredGiftWraps(stateDir) {
  let files
  try { files = readdirSync(wireDir(stateDir)) } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  const wraps = []
  for (const file of files) {
    if (!/^[0-9a-f]{64}\.json$/.test(file)) continue
    const digest = file.slice(0, -5)
    const path = wirePath(stateDir, digest)
    try {
      const stamp = fileStamp(path)
      const cached = retainedCache.get(path)
      if (cached?.stamp === stamp) { wraps.push(cached.wrap); continue }
      retainedCache.delete(path)
      const wrap = JSON.parse(readWire(stateDir, digest))
      if ((wrap.kind !== 1059 && wrap.kind !== 21059) || eventId(wrap) !== wrap.id) continue
      for (const tag of wrap.tags) Object.freeze(tag)
      Object.freeze(wrap.tags)
      Object.freeze(wrap)
      if (fileStamp(path) === stamp) {
        retainedCache.set(path, { stamp, wrap })
        if (retainedCache.size > RETAINED_CACHE_LIMIT) retainedCache.delete(retainedCache.keys().next().value)
      }
      wraps.push(wrap)
    } catch { retainedCache.delete(path) /* Damaged ciphertext cannot be displayed. */ }
  }
  return wraps
}

function validStoredRecord(record, wantedId) {
  if (record.domain !== EVIDENCE_DOMAIN || record.kind !== EVIDENCE_KIND || record.version !== EVIDENCE_VERSION
      || record.eventId !== wantedId || !/^[0-9a-f]{64}$/.test(record.contentDigest)
      || typeof record.observedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(record.observedAt)) return false
  const date = new Date(record.observedAt)
  return Number.isFinite(date.getTime()) && canonicalInstant(date) === record.observedAt
}

/**
 * Retain a published gift wrap once, preserving the first valid observation. Re-reading the same
 * event, even with a different JSON key order, reuses its audited wire and record without writes.
 * The legacy `rewritten` flag still identifies an already-held matching record.
 */
export function writeMessageEvidence({ stateDir, wrap, observedAt }) {
  let record = messageEvidence({ wrap, observedAt })
  if (eventId(wrap) !== record.eventId) throw refuse(EVIDENCE_REFUSE.NOT_A_WRAP, 'gift wrap id does not match its event')
  const directory = evidenceDir(stateDir)
  const path = evidencePath(stateDir, record.eventId)
  let existing
  try {
    const stored = readMessageEvidence(path)
    if (validStoredRecord(stored, record.eventId)) existing = stored
  } catch { /* A missing or malformed record is repaired from the actual wrap. */ }
  if (existing) {
    try {
      readRecordWire(stateDir, existing)
      return { record: existing, path, wire: wirePath(stateDir, existing.contentDigest), rewritten: true }
    } catch {
      // When these exact wire bytes can repair the record, its first observation remains valid.
      if (existing.contentDigest === record.contentDigest) record = existing
    }
  }
  const wire = wirePath(stateDir, record.contentDigest)
  try {
    mkdirSync(wireDir(stateDir), { recursive: true, mode: 0o700 })
    writeChanged(wire, JSON.stringify(wrap))
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    writeChanged(path, `${JSON.stringify(record, null, 2)}\n`)
  } catch (cause) {
    throw refuse(EVIDENCE_REFUSE.UNWRITABLE, `could not retain evidence at ${path}: ${cause.message}`)
  }
  return { record, path, wire, rewritten: existing === record }
}

/**
 * Read a record back and check it is exactly the six closed fields.
 *
 * THIS IS NOT THE READER — `scripts/aura/nostr_evidence.py` is, and it is stricter. This exists so
 * the producer's own court can assert that what it wrote is what the reader will accept, without
 * importing Python into a JavaScript test.
 *
 * @param {string} path - the record file.
 * @returns {object} the parsed record.
 * @throws {Error} `nostr-evidence-unreadable` when it is absent or not the closed shape.
 */
export function readMessageEvidence(path) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (cause) {
    throw refuse(EVIDENCE_REFUSE.UNREADABLE, `could not read evidence at ${path}: ${cause.message}`)
  }
  const keys = Object.keys(parsed).sort()
  const expected = [...EVIDENCE_FIELDS].sort()
  if (keys.length !== expected.length || keys.some((k, i) => k !== expected[i])) {
    throw refuse(EVIDENCE_REFUSE.UNREADABLE, `the record's fields are ${keys.join(', ')} and the closed set is ${expected.join(', ')}`)
  }
  return parsed
}

/**
 * The retained wire bytes for one digest, re-hashed before being returned.
 *
 * THE RE-HASH IS THE WHOLE POINT OF THE FILE. A retained wire that is not checked against the digest
 * it is filed under is a file that can be edited in place while the record beside it keeps naming the
 * old digest — the audit trail would then say "these are the bytes" about bytes that are not. So the
 * bytes are hashed on every read and a mismatch is refused by name.
 *
 * @param {string} stateDir - the state root.
 * @param {string} contentDigest - the digest the record carries.
 * @returns {string} the retained wire bytes, without the trailing newline this module added.
 * @throws {Error} `nostr-evidence-wire-missing` or `nostr-evidence-wire-mismatch`.
 */
export function readWire(stateDir, contentDigest) {
  const path = wirePath(stateDir, contentDigest)
  let stored
  try {
    stored = readFileSync(path, 'utf8')
  } catch (cause) {
    throw refuse(EVIDENCE_REFUSE.WIRE_MISSING, `no retained wire at ${path}: ${cause.message}`)
  }
  // THE RAW FILE BYTES, unstripped, so this reader and `sha256sum` answer the same question. A
  // reader that quietly trims what it hashes will agree with itself and disagree with every
  // auditor — which is precisely how the newline above went unnoticed.
  const bytes = stored
  const actual = createHash('sha256').update(bytes, 'utf8').digest('hex')
  if (actual !== contentDigest) {
    throw refuse(EVIDENCE_REFUSE.WIRE_MISMATCH,
      `the retained wire at ${path} hashes to ${actual} and is filed under ${contentDigest}`)
  }
  return bytes
}

/**
 * Whether a record's wire is present and re-derives. Never throws; this is the reporting form.
 * @returns {'present'|'missing'|'mismatch'} the wire's state.
 */
export function wireStatus(stateDir, contentDigest) {
  try {
    readWire(stateDir, contentDigest)
    return 'present'
  } catch (cause) {
    return cause?.code === EVIDENCE_REFUSE.WIRE_MISMATCH ? 'mismatch' : 'missing'
  }
}

/**
 * The retained wire bytes for ONE RECORD, checked to be THAT RECORD'S wire.
 *
 * THE DIGEST ALONE DOES NOT BIND A RECORD TO ITS WIRE, AND THIS IS THE FIX PETER APPROVED. `readWire`
 * answers a true and useful question — *is there a wire whose bytes hash to this digest?* — and a
 * record RE-POINTED at another message's wire passes it, because every half stays individually sound
 * while the PAIRING is false. A record names two things and only `contentDigest` was ever compared to
 * anything: `eventId` was carried, and never checked against the bytes beside it.
 *
 * So this reads the wire the record names, then RECOMPUTES the wire's own event id from those bytes
 * and requires it to equal the record's `eventId`. That second comparison is what binds the two.
 *
 * WHY THIS IS A NEW FUNCTION RATHER THAN A THIRD PARAMETER ON `readWire`. An optional argument is the
 * fail-open shape this lane spent a night hunting: a caller that forgets it silently receives the
 * weaker answer while believing it audited a record. `readWire` keeps its meaning, and binding is
 * something a caller asks for by name.
 *
 * @param {string} stateDir - the state root.
 * @param {{contentDigest: string, eventId: string}} record - the record to audit.
 * @returns {string} the retained wire bytes, without the trailing newline this module added.
 * @throws {Error} `-unreadable`, `-wire-missing`, `-wire-mismatch`, or `-wire-unbound`.
 */
export function readRecordWire(stateDir, record) {
  const contentDigest = record?.contentDigest
  const claimedEventId = record?.eventId
  if (typeof contentDigest !== 'string' || typeof claimedEventId !== 'string') {
    throw refuse(EVIDENCE_REFUSE.UNREADABLE,
      "a record audit needs the record's own contentDigest and eventId, and this value carries neither")
  }
  const bytes = readWire(stateDir, contentDigest)
  let parsed
  try {
    parsed = JSON.parse(bytes)
  } catch (cause) {
    throw refuse(EVIDENCE_REFUSE.WIRE_UNBOUND,
      `the retained wire filed under ${contentDigest} is not an event at all: ${cause.message}`)
  }
  const actual = eventId(parsed)
  if (actual !== claimedEventId || parsed.id !== claimedEventId) {
    throw refuse(EVIDENCE_REFUSE.WIRE_UNBOUND,
      `the retained wire is event ${actual} and this record is filed under ${claimedEventId}, so it is some other message's wire`)
  }
  return bytes
}

/**
 * Whether a record's OWN wire is present and belongs to it. Never throws; the reporting form.
 *
 * `unbound` is the finding this exists for: the bytes re-derive to the digest the record names, and
 * they are a different message's. Reporting that as `present` was the defect.
 *
 * @returns {'present'|'missing'|'mismatch'|'unbound'} the record's wire state.
 */
export function recordWireStatus(stateDir, record) {
  try {
    readRecordWire(stateDir, record)
    return 'present'
  } catch (cause) {
    if (cause?.code === EVIDENCE_REFUSE.WIRE_MISMATCH) return 'mismatch'
    if (cause?.code === EVIDENCE_REFUSE.WIRE_UNBOUND) return 'unbound'
    return 'missing'
  }
}
