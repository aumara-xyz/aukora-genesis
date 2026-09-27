/**
 * THE LANES' MEMORY, AS ONE VIEW — settled summaries per lane, the pending ones kept apart, and the core digest.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS NOT PART OF `organism.mjs`. The organism reader is CARRIED INTO THE FACE
 * byte for byte (`apps/src/vendor/organism.ts`), so it may not import a relative module: a carried copy that
 * imports `../../aukora-kira/lib/…` resolves to nothing inside the face's own package tree. This module may
 * import, because nothing carries it — so the reading that needs Kira's own functions lives here, and the
 * reader receives the RESULT as data.
 *
 * WHAT IT READS, AND THROUGH WHICH DOOR:
 *   · SETTLED summaries come from `kira.recall` — the read-only service over the read owner. A record that only
 *     ever reached the review QUEUE is not recallable, so `settled` cannot be guessed from a queue entry.
 *   · PENDING summaries come from the queue, parsed by KIRA'S OWN `readQueueEntry` (their canonical-form check,
 *     not a second one here). They are reported under `pending` and are NEVER merged into `settled`: a proposal
 *     reported as a conclusion is the defect this file is shaped to prevent.
 *   · THE SELECTION AND THE DIGEST ARE KIRA'S OWN FUNCTIONS — `newestPerLane` ("one summary per lane, the
 *     newest settled") and `buildCoreDigest` ("claims once, with their restaters"). Restating either rule here
 *     would let the screen and the record disagree about what the organism concluded.
 *   · THE CITE VERDICT IS ASKED FOR, NEVER ASSUMED. `aura.cite` returns VERIFIED or UNVERIFIED; a service that
 *     is absent, throws, or refuses an unknown record yields `NOT CHECKED` — a third state which is never
 *     rendered as VERIFIED because "I did not check" and "the chain checked out" are different sentences.
 *
 * NOTHING HERE WRITES. It imports no stage, settle, queue-write or record path: the only Kira members in scope
 * are a pure digest builder, a pure selector, a pure headline cap and the queue's READ parser.
 *
 * @module @aukora/organism-lane-memory
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readQueueEntry } from '../../aukora-kira/lib/queue.mjs'
import { buildCoreDigest, headlineOf, newestPerLane } from '../../aukora-kira/lib/consolidate.mjs'

/** The only record kind this view reads. A lane's memory is its SUMMARIES; observations are not conclusions. */
export const SUMMARY_KIND = 'summary'

/** The verdict for a citation that was never checked. Deliberately not a string a real verdict uses. */
export const CITE_NOT_CHECKED = 'NOT CHECKED'

/**
 * The lane a record belongs to, from the record's own content.
 *
 * `compaction-export.mjs` writes `content.thread.lane`, and that is where every lane summary carries it. A
 * record whose lane cannot be read is NOT guessed from its text: it is left unattributed and named, because a
 * summary attributed to the wrong lane is a sentence about a lane that never said it.
 * @param {unknown} record
 * @returns {string|null}
 */
export function laneOfRecord(record) {
  const lane = record?.content?.thread?.lane
  return typeof lane === 'string' && lane.trim() !== '' ? lane.trim().toUpperCase() : null
}

/** The summary text of a record: the capped prose `compaction-export.mjs` wrote. */
function textOfRecord(record) {
  const summary = record?.content?.summary
  if (typeof summary === 'string') return summary
  return ''
}

/**
 * One settled lane summary, in the shape `consolidate.mjs` expects.
 * @param {unknown} record
 * @returns {{lane: string, recordId: string|null, settledAt: string|null, headline: string, text: string, ancestry: unknown}}
 */
export function laneSummaryOf(record) {
  const text = textOfRecord(record)
  return {
    lane: laneOfRecord(record) ?? '',
    recordId: typeof record?.recordId === 'string' ? record.recordId : null,
    settledAt: typeof record?.createdAt === 'string' ? record.createdAt : null,
    headline: headlineOf(text),
    text,
    ancestry: record?.content?.ancestry ?? 'unknown',
  }
}

/**
 * The queue's summary entries, read through Kira's own parser.
 *
 * `readQueueEntry` refuses a file that is not in canonical form, so a half-written or edited queue file is
 * REPORTED rather than parsed into a plausible record. Every refusal is named in `missing`; nothing is dropped
 * silently, because a pending count that quietly skips a broken file reads as a smaller queue.
 * @param {{dshHome: string, readFile?: Function, listDir?: Function}} input
 * @returns {{entries: object[], missing: string[]}}
 */
export function readPendingSummaries({ dshHome, readFile = readFileSync, listDir = readdirSync }) {
  const dir = join(dshHome, 'kira-memory', 'queue')
  let files
  try {
    files = listDir(dir)
  } catch (error) {
    return { entries: [], missing: [`the Kira queue at ${dir} (${String(error?.code ?? error?.message ?? error)})`] }
  }
  const entries = []
  const missing = []
  for (const file of files) {
    let parsed
    try {
      parsed = readQueueEntry(String(readFile(join(dir, file), 'utf8')))
    } catch (error) {
      missing.push(`the queue entry ${file} (${String(error?.code ?? error?.message ?? error)})`)
      continue
    }
    // **`readQueueEntry` ANSWERS WITH A STATE, NOT WITH A RECORD.** It returns
    // `{state: 'pending', entry}` or `{state: 'unreadable', reason}` — four answers, and "unreadable" is not
    // "gone". The first version of this function read `parsed.kind` off the state object, so every queue file
    // was silently classified as "not a summary" and the pending count came out zero: a reader that reports an
    // empty inbox because it misread the door is worse than one that reports nothing at all.
    if (parsed?.state !== 'pending') {
      missing.push(`the queue entry ${file} (${String(parsed?.reason ?? 'unreadable')})`)
      continue
    }
    const entry = parsed.entry
    if (entry?.kind !== SUMMARY_KIND) continue
    const record = entry.record ?? {}
    const lane = laneOfRecord(record)
    if (lane === null) {
      missing.push(`the queue entry ${file} (it names no lane)`)
      continue
    }
    entries.push({
      lane,
      recordId: typeof entry.recordId === 'string' ? entry.recordId : null,
      at: typeof entry.createdAt === 'string' ? entry.createdAt : null,
      headline: headlineOf(textOfRecord(record)),
      settled: false,
    })
  }
  return { entries, missing }
}

/**
 * One cite verdict, from whatever the service answered, with the three outcomes kept apart.
 * @param {string|null} recordId
 * @param {((id: string) => Promise<unknown>)|undefined} cite
 * @returns {Promise<{verdict: string, reason: string|null}>}
 */
async function verdictFor(recordId, cite) {
  if (recordId === null) return { verdict: CITE_NOT_CHECKED, reason: 'the summary carries no record id to cite' }
  if (typeof cite !== 'function') return { verdict: CITE_NOT_CHECKED, reason: 'aura.cite is not mounted on this Host' }
  try {
    const answer = await cite(recordId)
    const verdict = answer?.verdict
    if (verdict === 'VERIFIED') return { verdict: 'VERIFIED', reason: null }
    // ANYTHING THAT IS NOT A VERIFIED VERDICT IS UNVERIFIED, INCLUDING A MALFORMED ONE. A service that answers
    // with a shape this reader does not know has not verified anything, and defaulting the other way is exactly
    // how an unchecked citation becomes a confident sentence.
    return { verdict: 'UNVERIFIED', reason: typeof answer?.reason === 'string' ? answer.reason : 'the cite service returned no verdict' }
  } catch (error) {
    // A REFUSED UNKNOWN RECORD IS NOT A CHAIN DOUBT, so it is named as its own outcome rather than as
    // UNVERIFIED — and it is still never VERIFIED.
    return { verdict: CITE_NOT_CHECKED, reason: String(error?.message ?? error) }
  }
}

/**
 * The whole view: settled per lane, pending kept apart, the digest, and every source that could not be read.
 *
 * @param {{recalled?: unknown, pending?: readonly object[], cite?: (id: string) => Promise<unknown>,
 *          unattributed?: readonly object[]}} input
 * @returns {Promise<Readonly<Record<string, unknown>>>}
 */
export async function laneMemoryOf({ recalled, pending = [], cite, unattributed = [] } = {}) {
  const missing = []
  const status = typeof recalled?.status === 'string' ? recalled.status : 'undetermined'
  if (status !== 'match') {
    missing.push(`the Kira store (it answered ${status}, so no settled summary was read)`)
  }
  const records = Array.isArray(recalled?.records) ? recalled.records : []
  const settled = []
  for (const record of records) {
    if (record?.kind !== SUMMARY_KIND) continue
    if (laneOfRecord(record) === null) {
      missing.push(`the settled summary ${String(record?.recordId ?? 'unidentified')} (it names no lane)`)
      continue
    }
    settled.push(laneSummaryOf(record))
  }
  // ONE PER LANE, THE NEWEST: Kira's own rule, over the records Kira's own export wrote.
  const newest = newestPerLane(settled)
  const citeFor = new Map()
  for (const one of newest) citeFor.set(one.lane, await verdictFor(one.recordId, cite))
  const settledRows = newest
    .map(one => ({
      lane: one.lane,
      recordId: one.recordId,
      settledAt: one.settledAt,
      headline: one.headline,
      ancestry: one.ancestry,
      ...citeFor.get(one.lane),
    }))
    .sort((left, right) => left.lane.localeCompare(right.lane))

  const pendingRows = pending
    .filter(entry => entry?.settled !== true)
    .map(entry => ({
      lane: String(entry?.lane ?? ''),
      recordId: typeof entry?.recordId === 'string' ? entry.recordId : null,
      at: typeof entry?.at === 'string' ? entry.at : null,
      headline: headlineOf(entry?.headline ?? ''),
      settled: false,
    }))
    .sort((left, right) => `${left.lane}${String(left.at)}`.localeCompare(`${right.lane}${String(right.at)}`))
  const pendingByLane = {}
  for (const row of pendingRows) pendingByLane[row.lane] = (pendingByLane[row.lane] ?? 0) + 1

  // THE DIGEST IS BUILT FROM THE SETTLED ROWS AND FROM NOTHING ELSE: a pending proposal has no place in a
  // count of what the organism concluded.
  const digest = buildCoreDigest({ laneSummaries: settled })

  return Object.freeze({
    settled: Object.freeze(settledRows),
    pending: Object.freeze(pendingRows),
    pendingByLane: Object.freeze(pendingByLane),
    digest,
    unattributed: Object.freeze([...unattributed]),
    missing: Object.freeze(missing),
    status,
  })
}
