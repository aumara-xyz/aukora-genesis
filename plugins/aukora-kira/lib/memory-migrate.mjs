/**
 * THE MIGRATION OF THE QUEUE INTO REMEMBERED NOTES — PLANNED, NOT PERFORMED. (Design §3.6 and §6; Fable's item 6.)
 *
 * WHAT THIS IS FOR. Peter's store holds a hundred and thirty records that nobody approved and nothing ever used, because
 * the old path asked for an approval per record and the queue was never worked. The design turns them into REMEMBERED
 * notes — automatic, unsigned, receipt-backed — and says the receipts are made "where the source can be found".
 *
 * SO THE HONEST OUTPUT OF THIS MODULE IS TWO LISTS: the entries whose source event can still be found, each with the
 * receipt it will carry; and the entries that CANNOT be linked, each with the reason. A migration that silently relabels
 * a hundred and thirty records as receipt-backed when only a handful have a receipt would be the same class of defect
 * this whole goal has been finding — a claim the bytes do not support.
 *
 * IT PLANS AND DOES NOT WRITE. The session reader is injected, so a court drives every branch with no store at all, and
 * the caller decides when a plan becomes a write. There is no `--apply` here: the design's journal
 * (`remembered/journal.jsonl`, hash-chained, fsynced per append) is what makes a migration reversible, and it does not
 * exist yet. Writing first and journaling later is how a store loses the ability to say what happened to it.
 *
 * @module @aukora-dsh-plugin-kira/memory-migrate
 */
import { sha256Hex } from './memory-tiers.mjs'

/** Why an entry could not be linked, or that it could. Closed, so counts are comparable between runs. */
export const MIGRATION_OUTCOMES = Object.freeze([
  'source-linked',      // a turn reference AND the event it names were found: this one gets a receipt
  'no-turn-reference',  // the record never recorded which turn it cited: no source to name, and none can be invented
  'turn-not-found',     // it names a turn, and that session or event is gone
  'event-line-missing', // the turn was found and the store cannot produce the exact canonical line
  'statement-empty',    // nothing to remember
])

/** A named refusal. Refusals are for malformed input, never for an outcome. */
export class KiraMigrationError extends Error {
  /**
   * @param {string} code - stable machine-readable refusal code suffix.
   * @param {string} message - human-readable refusal.
   */
  constructor(code, message) {
    super(`kira.migrate: ${message}`)
    this.name = 'KiraMigrationError'
    this.code = `kira.migrate:${code}`
  }
}

/** @param {string} code @param {string} message @returns {never} */
function refuse(code, message) {
  throw new KiraMigrationError(code, message)
}

/**
 * The turn reference a queued record carries, if it carries one.
 *
 * The old auto-staging put it in `content.turn` as `{sessionId, turn}` (autostage.mjs:239). A record staged by hand
 * through `kira_stage` has no turn at all, and a few predate the field — those are the ones this migration can only
 * report as unlinkable rather than invent a source for.
 * @param {Readonly<Record<string, unknown>>} record
 * @returns {{sessionId: string, turn: number} | null}
 */
export function turnReferenceOf(record) {
  const turn = record?.content?.turn
  if (turn === null || typeof turn !== 'object') return null
  if (typeof turn.sessionId !== 'string' || turn.sessionId === '') return null
  if (!Number.isInteger(turn.turn)) return null
  return { sessionId: turn.sessionId, turn: turn.turn }
}

/** The statement a queued record carries, if it carries one. */
export function statementOf(record) {
  const note = record?.content?.note
  if (typeof note === 'string' && note.trim() !== '') return note.trim()
  const text = record?.content?.text
  return typeof text === 'string' && text.trim() !== '' ? text.trim() : ''
}

/**
 * Plan the migration of a queue.
 *
 * @param {ReadonlyArray<{key: string, record: Readonly<Record<string, unknown>>}>} entries
 * @param {{findEvent: (reference: {sessionId: string, turn: number}) => ({seq: number, at: string, line: string}|null|undefined), existingIds?: ReadonlySet<string>}} options
 * @returns {{linkable: ReadonlyArray<Record<string, unknown>>, unlinkable: ReadonlyArray<{key: string, outcome: string, why: string}>, counts: Readonly<Record<string, number>>, total: number}}
 */
export function planMigration(entries, options) {
  if (!Array.isArray(entries)) refuse('entries-missing', 'the migration needs the queue entries to plan')
  const findEvent = options?.findEvent
  if (typeof findEvent !== 'function') {
    refuse('reader-missing', 'the migration needs a reader for the session events: without one, no entry could be linked and the plan would be a guess')
  }
  const existingIds = options?.existingIds ?? new Set()
  const linkable = []
  const unlinkable = []
  const counts = Object.fromEntries(MIGRATION_OUTCOMES.map(one => [one, 0]))

  for (const entry of entries) {
    const key = String(entry?.key ?? '')
    const record = entry?.record
    const statement = statementOf(record)
    const outcome = (name, why) => {
      counts[name] += 1
      unlinkable.push({ key, outcome: name, why })
    }
    if (statement === '') { outcome('statement-empty', 'the record carries no statement to remember'); continue }
    const reference = turnReferenceOf(record)
    if (reference === null) {
      outcome('no-turn-reference', 'the record never recorded the turn it came from, so there is no source to cite and none can be invented')
      continue
    }
    let event
    try {
      event = findEvent(reference)
    } catch {
      event = null
    }
    if (event === null || event === undefined) {
      outcome('turn-not-found', `the record cites session ${reference.sessionId} turn ${String(reference.turn)}, and that event cannot be found`)
      continue
    }
    if (typeof event.line !== 'string' || event.line === '' || !Number.isInteger(event.seq) || typeof event.at !== 'string') {
      outcome('event-line-missing', 'the turn was found and the store cannot produce the exact canonical line, so no receipt is possible')
      continue
    }
    const source = Object.freeze({ sessionId: reference.sessionId, sessionTitle: '', seq: event.seq, at: event.at, sha256: sha256Hex(event.line) })
    const id = `rem:${sha256Hex(`${key}\u0000${source.sha256}`)}`
    if (existingIds.has(id)) { outcome('source-linked', 'already migrated: this plan cannot say so yet without the journal'); continue }
    counts['source-linked'] += 1
    linkable.push(Object.freeze({ key, id, statement, source, fromQueue: true }))
  }

  return {
    linkable: Object.freeze(linkable),
    unlinkable: Object.freeze(unlinkable),
    counts: Object.freeze(counts),
    total: entries.length,
  }
}

/**
 * One line a person can read, because the number this produces is the number Fable asked for.
 * @param {ReturnType<typeof planMigration>} plan
 * @returns {string}
 */
export function migrationSummary(plan) {
  const parts = MIGRATION_OUTCOMES.map(name => `${name} ${String(plan.counts[name])}`).join(', ')
  const linked = plan.counts['source-linked']
  return `${String(linked)} of ${String(plan.total)} queued records can be linked to a source event and carry a receipt; ${String(plan.total - linked)} cannot. [${parts}]`
}
