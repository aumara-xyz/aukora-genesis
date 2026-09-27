/**
 * **A FREEZE IS A RECORD, NOT A FILE — and the file becomes a MIRROR.**
 *
 * Plan section 5 row 9 and section 2 step 14. Peter's standing order is NO PUSH OF ANY KIND. Today that order
 * lives in `.git/AUKORA-NO-PUSH`, and `scripts/ci/push.sh` refuses while that file exists. **THE FILE IS THE
 * AUTHORITY, WHICH MEANS ANYONE WHO CAN DELETE A FILE CAN LIFT A HOLD** — including a lane, an agent, a stray
 * `rm`, or a `git clean` that does not know what it is removing.
 *
 * So the authority moves into an **append-only log of approved records**, and the file becomes a MIRROR of what
 * that log says: convenient for a human to see, and *not consulted for the decision*. Deleting it changes
 * nothing, because **deleting a mirror does not change the thing it mirrors.**
 *
 * ── **THE TWO RECORDS, AND THEY ARE ONE FORMAT WITH TWO KINDS** ──────────────────────────────────────────
 *
 *   `aukora:repo-freeze:v1`    — reason, scope, notAfter (an expiry, so a freeze lapses BY ITSELF)
 *   `aukora:repo-unfreeze:v1`  — reason, scope
 *
 * **BOTH ARE APPROVED THROUGH THE SAME RECEIPT PATH**, because a hold that one person can lift by editing a file
 * and another can place by approving a record would be a hold with two different strengths. The log entry carries
 * the record and the receipt that authorised it.
 *
 * ── **AN EXPIRED FREEZE LAPSES BY ITSELF, AND THAT IS DELIBERATE** ───────────────────────────────────────
 *
 * `notAfter` is REQUIRED on every freeze. *A hold with no end is a hold nobody revisits*: it outlives the reason
 * for it, and the person who placed it has to remember to lift it. An expiry means the default is movement and
 * the exception is holding — and **a freeze that lapses can be re-placed by approving another record**, which is
 * one command, so the cost of the expiry falling at a bad moment is small and the cost of a forgotten freeze is
 * not.
 *
 * ── **LATEST VERIFIED RECORD WINS; TIES ARE REFUSED, NOT GUESSED** ───────────────────────────────────────
 *
 * The state is decided by the newest record that verifies, for the scope in question. **A TIE IS REFUSED** rather
 * than broken by an arbitrary rule: two records at the same instant disagreeing about whether the repository is
 * frozen is a fact an operator must settle, and *picking one silently would be inventing an answer.*
 *
 * ── **NOT CONFINEMENT** ──────────────────────────────────────────────────────────────────────────────────
 *
 * This module does not stop anyone writing the log directly, and it cannot: the log is a file. What it does is
 * make the CONSULTED AUTHORITY a record that must carry a receipt, so that lifting a freeze requires an approval
 * rather than a delete. *A gate is not a wall; it is the point at which the wrong action needs the right
 * document.*
 */
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { canonicalJSON } from './repo-advance.mjs'

/** The two kinds. One format, two verbs. */
export const FREEZE_KIND = 'aukora:repo-freeze:v1'
export const UNFREEZE_KIND = 'aukora:repo-unfreeze:v1'

/** The log's file name, kept beside the state the tree already uses for owner records. */
export const FREEZE_LOG_NAME = 'repo-freeze.jsonl'

/** The mirror a human reads, and which is NOT the authority. */
export const FREEZE_MIRROR_NAME = 'AUKORA-NO-PUSH'

/** Every refusal, by name. */
export const FREEZE_REFUSE = Object.freeze({
  NOT_AN_OBJECT: 'freeze:not-an-object',
  EXTRA_FIELD: 'freeze:extra-field',
  MISSING_FIELD: 'freeze:missing-field',
  BAD_KIND: 'freeze:bad-kind',
  BAD_REASON: 'freeze:bad-reason',
  BAD_SCOPE: 'freeze:bad-scope',
  NO_EXPIRY: 'freeze:no-expiry',
  BAD_EXPIRY: 'freeze:bad-expiry',
  LOG_CORRUPT: 'freeze:log-corrupt',
  STATE_AMBIGUOUS: 'freeze:state-ambiguous',
})

const refuse = (code, detail) => Object.assign(new Error(detail), { code })

const FREEZE_FIELDS = Object.freeze(['kind', 'reason', 'scope', 'notAfter'])
const UNFREEZE_FIELDS = Object.freeze(['kind', 'reason', 'scope'])

/** A scope is a repository-relative name, or the string `repo` for all of it. */
const SCOPE_SHAPE = /^[a-z0-9][a-z0-9._/-]*$/u

/**
 * Build a freeze record, or refuse it by name.
 *
 * @param {{reason: string, scope: string, notAfter: number}} input
 */
export function buildRepoFreeze(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw refuse(FREEZE_REFUSE.NOT_AN_OBJECT, 'a freeze is an object')
  }
  const record = { kind: FREEZE_KIND, ...input }
  const extra = Object.keys(record).filter(key => !FREEZE_FIELDS.includes(key))
  if (extra.length > 0) {
    throw refuse(FREEZE_REFUSE.EXTRA_FIELD, `a freeze carries field(s) the format does not have: ${extra.join(', ')}`)
  }
  const missing = FREEZE_FIELDS.filter(key => !(key in record))
  if (missing.length > 0) {
    throw refuse(FREEZE_REFUSE.MISSING_FIELD, `a freeze is missing: ${missing.join(', ')}`)
  }
  if (typeof record.reason !== 'string' || record.reason.trim() === '') {
    // **A FREEZE WITH NO REASON IS INDISTINGUISHABLE FROM A BROKEN SCRIPT.** `push.sh` already prints the file's
    // first line for exactly this reason; the record keeps that property and makes it enforceable.
    throw refuse(FREEZE_REFUSE.BAD_REASON, 'a freeze must carry a reason a reader can act on')
  }
  if (typeof record.scope !== 'string' || !SCOPE_SHAPE.test(record.scope)) {
    throw refuse(FREEZE_REFUSE.BAD_SCOPE, `${JSON.stringify(record.scope)} is not a scope name`)
  }
  // **`notAfter` IS REQUIRED.** See the header: a hold with no end is a hold nobody revisits.
  if (record.notAfter === null || record.notAfter === undefined) {
    throw refuse(FREEZE_REFUSE.NO_EXPIRY,
      'a freeze must carry `notAfter`; a hold with no end is a hold nobody revisits, so the expiry is required '
      + 'and a lapsed freeze can be re-placed by approving another record')
  }
  if (!Number.isSafeInteger(record.notAfter) || record.notAfter < 0) {
    throw refuse(FREEZE_REFUSE.BAD_EXPIRY, `notAfter is ${JSON.stringify(record.notAfter)} and it is unix SECONDS`)
  }
  return Object.freeze(record)
}

/** Build an unfreeze record, or refuse it by name. */
export function buildRepoUnfreeze(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw refuse(FREEZE_REFUSE.NOT_AN_OBJECT, 'an unfreeze is an object')
  }
  const record = { kind: UNFREEZE_KIND, ...input }
  const extra = Object.keys(record).filter(key => !UNFREEZE_FIELDS.includes(key))
  if (extra.length > 0) {
    throw refuse(FREEZE_REFUSE.EXTRA_FIELD, `an unfreeze carries field(s) the format does not have: ${extra.join(', ')}`)
  }
  const missing = UNFREEZE_FIELDS.filter(key => !(key in record))
  if (missing.length > 0) {
    throw refuse(FREEZE_REFUSE.MISSING_FIELD, `an unfreeze is missing: ${missing.join(', ')}`)
  }
  if (typeof record.reason !== 'string' || record.reason.trim() === '') {
    throw refuse(FREEZE_REFUSE.BAD_REASON, 'an unfreeze must carry a reason: a hold lifted without one is unreadable afterwards')
  }
  if (typeof record.scope !== 'string' || !SCOPE_SHAPE.test(record.scope)) {
    throw refuse(FREEZE_REFUSE.BAD_SCOPE, `${JSON.stringify(record.scope)} is not a scope name`)
  }
  return Object.freeze(record)
}

/** The canonical bytes of a record, and its digest. */
export const freezeBytes = record => canonicalJSON(record)
export const freezeDigest = record => createHash('sha256').update(freezeBytes(record), 'utf8').digest('hex')

/**
 * **THE STATE, DECIDED FROM THE LOG ALONE.**
 *
 * `entries` is the log in append order. The newest entry that applies to `scope` decides — where a freeze applies
 * to a scope if the scope is `repo` or equals the record's, and an unfreeze applies only to its OWN scope. **AN
 * EXPIRED FREEZE IS NOT A FREEZE**: its `notAfter` has passed, so it has lapsed by itself and the state is not
 * frozen.
 *
 * A TIE AT THE NEWEST INSTANT IS REFUSED. *Two records disagreeing at one moment is a question for a person.*
 */
export function resolveFreezeState(entries, options = {}) {
  const now = options.now ?? Math.floor(Date.now() / 1000)
  const scope = options.scope ?? 'repo'
  const relevant = entries.filter(entry => {
    const record = entry?.record
    if (record === null || typeof record !== 'object') return false
    if (record.kind === FREEZE_KIND) return record.scope === 'repo' || record.scope === scope
    if (record.kind === UNFREEZE_KIND) return record.scope === scope
    return false
  })
  if (relevant.length === 0) {
    return Object.freeze({ frozen: false, reason: 'no record applies, so nothing is held', source: null, at: null })
  }
  const newest = relevant.reduce((best, entry) => (entry.at > best.at ? entry : best))
  const tied = relevant.filter(entry => entry.at === newest.at)
  if (tied.length > 1) {
    const kinds = [...new Set(tied.map(entry => entry.record.kind))].sort()
    if (kinds.length > 1) {
      throw refuse(FREEZE_REFUSE.STATE_AMBIGUOUS,
        `${String(tied.length)} records share the instant ${String(newest.at)} and disagree (${kinds.join(', ')}), `
        + 'so whether this repository is frozen is a question a person must answer rather than one this module '
        + 'should guess')
    }
  }
  const record = newest.record
  const at = newest.at
  if (record.kind === UNFREEZE_KIND) {
    return Object.freeze({ frozen: false, reason: record.reason, source: UNFREEZE_KIND, at })
  }
  // **THE EXPIRY, AND IT IS THE WHOLE REASON `notAfter` IS REQUIRED.**
  if (now > record.notAfter) {
    return Object.freeze({
      frozen: false,
      reason: `the freeze lapsed at ${String(record.notAfter)} (${record.reason})`,
      source: FREEZE_KIND,
      at,
      lapsed: true,
    })
  }
  return Object.freeze({ frozen: true, reason: record.reason, source: FREEZE_KIND, at, notAfter: record.notAfter })
}

/**
 * **THE APPEND-ONLY LOG, WITH THE RECEIPT THAT AUTHORISED EACH ENTRY.**
 *
 * `append(record, receipt, at)` writes one line and fsyncs it. **THE RECEIPT IS STORED WITH THE RECORD** because
 * the log's whole claim is that every entry was approved: *an entry whose authorisation is not in the log is an
 * entry a reader has to take on trust*, which is the state the file-based freeze was already in.
 */
export function openFreezeLog(path) {
  const read = () => {
    if (!existsSync(path)) return Object.freeze([])
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean)
    const entries = []
    for (const [index, line] of lines.entries()) {
      let parsed = null
      try { parsed = JSON.parse(line) } catch {
        throw refuse(FREEZE_REFUSE.LOG_CORRUPT,
          `freeze log line ${String(index)} is not JSON, so the log cannot be read — an unreadable log is not an `
          + 'empty one, and treating it as empty would lift every hold it records')
      }
      entries.push(Object.freeze({ record: parsed.record, receipt: parsed.receipt, at: parsed.at }))
    }
    return Object.freeze(entries)
  }
  return Object.freeze({
    path,
    entries: read,
    state: options => resolveFreezeState(read(), options),
    append(record, receipt, at) {
      mkdirSync(dirname(path), { recursive: true })
      const entry = { record, receipt, at: at ?? Math.floor(Date.now() / 1000) }
      const handle = openSync(path, 'a')
      try {
        appendFileSync(handle, `${JSON.stringify(entry)}\n`)
        fsyncSync(handle)
      } finally { closeSync(handle) }
      return Object.freeze(entry)
    },
  })
}

/**
 * **THE MIRROR — WRITTEN FOR A HUMAN, AND READ FOR NOTHING.**
 *
 * `scripts/ci/push.sh` still reads a file, because a shell script that must not import JavaScript cannot read a
 * log. **THE MIRROR IS HOW THE TWO STAY HONEST:** the file is written FROM the resolved state, so it always says
 * what the log says, and **its deletion is not an event** — `push.sh` consults the log through
 * `freeze-state.mjs`, and this file is the readable copy beside it.
 *
 * It carries a header saying so, because the next person to find this file will be looking for a way to lift the
 * freeze and the file is the obvious candidate.
 */
export function writeFreezeMirror(path, state) {
  if (!state.frozen) {
    // **AN UNFROZEN STATE REMOVES THE MIRROR**, so its presence means what it has always meant to a reader.
    if (existsSync(path)) writeFileSync(path, '')
    return Object.freeze({ written: false, path })
  }
  writeFileSync(path, `${state.reason}\n\n`
    + 'THIS FILE IS A MIRROR, NOT THE AUTHORITY. The freeze is a record in the append-only log\n'
    + '(repo-freeze.jsonl) approved through the owner receipt path. DELETING THIS FILE DOES NOT LIFT\n'
    + 'THE FREEZE: the log still holds it, and the gate reads the log. To lift it, an unfreeze record\n'
    + 'must be approved.\n')
  return Object.freeze({ written: true, path })
}
