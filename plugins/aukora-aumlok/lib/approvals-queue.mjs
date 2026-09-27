/**
 * **THE APPROVALS QUEUE: what is waiting for the owner's click, and the sentence each one shows.**
 *
 * Plan section 5 rows 2, 3 and 9; section 2 steps 6-14. Three records now arrive for approval — the advance
 * (`aukora:repo-advance:v1`), the freeze and its lift (`aukora:repo-freeze:v1` / `aukora:repo-unfreeze:v1`), and
 * the release switch (`aukora:release-activate:v1`) — **AND NOTHING HELD THEM.** Each record's display existed,
 * its verifier existed, and the thing in between did not: *a list of what is waiting, carrying the sentence the
 * owner actually reads.*
 *
 * ── **WHY THIS IS A MODEL AND NOT A SCREEN** ─────────────────────────────────────────────────────────────
 *
 * It holds no DOM, no socket and no key. **IT IS THE PART A COURT CAN MEASURE**, and the part whose correctness
 * matters most: *if the queue and the signer disagree about what a record says, the owner reads one sentence and
 * signs another.* So the line is not built here — it is **rendered by the caller and passed in**, which is what
 * lets the screen and the queue use ONE renderer instead of two.
 *
 * ── **THE ORDER IS BY ARRIVAL, AND NOTHING IS SORTED BY IMPORTANCE** ─────────────────────────────────────
 *
 * A queue that reordered itself by a notion of severity would be a queue where a record can be moved out of sight
 * by whoever chooses the weights. **FIRST IN, FIRST SHOWN**, and the only thing that removes an item is an
 * approval or an explicit withdrawal, both of which leave a record of themselves.
 *
 * ── **AN ITEM WITHOUT A RENDERED LINE IS REFUSED, NOT DISPLAYED BLANK** ──────────────────────────────────
 *
 * A pending approval whose sentence could not be built is one the owner cannot judge, and *a blank row is worse
 * than a refusal: it looks like a decision that needs no reading.*
 */
import { createHash } from 'node:crypto'
import { canonicalJSON } from './repo-advance.mjs'

/** One item's state, and there are only three. */
export const QUEUE_STATE = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  WITHDRAWN: 'withdrawn',
})

/** Every refusal, by name. */
export const QUEUE_REFUSE = Object.freeze({
  NO_LINE: 'queue:item-without-a-line',
  NO_ID: 'queue:item-without-an-id',
  NOT_PENDING: 'queue:item-is-not-pending',
  UNKNOWN_ITEM: 'queue:no-such-item',
})

const refuse = (code, detail) => Object.assign(new Error(detail), { code })

/**
 * The identity of one queued record.
 *
 * **IT IS THE DIGEST OF THE RECORD'S OWN BYTES, NOT A COUNTER.** A counter would make the identity depend on the
 * order things arrived, so two queues holding the same proposal would disagree about what to call it — and the
 * id is what an approval names. *A name nobody can recompute identifies nothing.*
 */
export const queueItemId = record => createHash('sha256').update(canonicalJSON(record), 'utf8').digest('hex')

/**
 * Open a queue.
 *
 * @param {{renderLine: (record: object) => string}} input
 *   **THE RENDERER IS INJECTED AND THAT IS THE POINT.** The plain-words display lives in `apps/aukora-desktop` and
 *   this module is in `plugins/`, which may not import it; injecting the renderer keeps ONE implementation — *the
 *   queue cannot drift from the signer if it never builds a sentence of its own.*
 */
export function createApprovalsQueue(input) {
  if (typeof input?.renderLine !== 'function') {
    throw refuse(QUEUE_REFUSE.NO_LINE,
      'the queue needs a renderLine(record) function; a queue that builds its own sentences is a second '
      + 'implementation of the display, which is the one thing it must not be')
  }
  const items = []
  return Object.freeze({
    /** Submit one record for approval. Returns the item, with the line the owner will read. */
    submit(record, meta = {}) {
      const id = queueItemId(record)
      const line = input.renderLine(record)
      if (typeof line !== 'string' || line.trim() === '') {
        // *A blank row looks like a decision that needs no reading.*
        throw refuse(QUEUE_REFUSE.NO_LINE,
          `the record ${id.slice(0, 12)}… rendered to an empty line, so the owner has nothing to judge`)
      }
      const item = Object.freeze({
        id, record, line, state: QUEUE_STATE.PENDING,
        submittedAt: meta.at ?? Math.floor(Date.now() / 1000),
        kind: record?.kind,
      })
      items.push(item)
      return item
    },
    /** **FIRST IN, FIRST SHOWN.** Nothing is reordered. */
    pending() {
      return Object.freeze(items.filter(item => item.state === QUEUE_STATE.PENDING))
    },
    all() { return Object.freeze([...items]) },
    /**
     * Approve one item.
     *
     * **THE RECORD IS HANDED BACK SO THE APPROVAL PATH CAN USE IT**, and the item is marked rather than removed:
     * *a queue that forgets what it approved cannot answer "what did I show you before you clicked".*
     */
    approve(id) {
      const item = items.find(candidate => candidate.id === id)
      if (item === undefined) throw refuse(QUEUE_REFUSE.UNKNOWN_ITEM, `${String(id).slice(0, 12)}… is not in this queue`)
      if (item.state !== QUEUE_STATE.PENDING) {
        throw refuse(QUEUE_REFUSE.NOT_PENDING,
          `${String(id).slice(0, 12)}… is ${item.state}, and an item is approved once`)
      }
      const approved = Object.freeze({ ...item, state: QUEUE_STATE.APPROVED })
      items[items.indexOf(item)] = approved
      return approved
    },
    /** Withdraw one item — the owner's other answer, and it leaves the same kind of record. */
    withdraw(id) {
      const item = items.find(candidate => candidate.id === id)
      if (item === undefined) throw refuse(QUEUE_REFUSE.UNKNOWN_ITEM, `${String(id).slice(0, 12)}… is not in this queue`)
      if (item.state !== QUEUE_STATE.PENDING) {
        throw refuse(QUEUE_REFUSE.NOT_PENDING, `${String(id).slice(0, 12)}… is ${item.state}`)
      }
      const withdrawn = Object.freeze({ ...item, state: QUEUE_STATE.WITHDRAWN })
      items[items.indexOf(item)] = withdrawn
      return withdrawn
    },
  })
}
