/**
 * COMPACTION EXPORT — one manual compaction becomes ONE inert Kira proposal.
 *
 * THE VISION THIS SERVES: every thread feeds one brain, and Kira is that brain. A conversation that
 * gets compacted has just decided, in public, which part of itself mattered: the summary is the
 * thread's own account of what it was doing. Throwing that away means the next session starts from
 * the raw log again, and the thread never accumulates. Keeping it means a lane's history is a CHAIN
 * of summaries it can be seeded from — which is what `summary <LANE>` injection reads.
 *
 * WHAT MAKES ONE A "MANUAL COMPACTION", AND WHY THAT MATTERS. `compaction/summary` is emitted for
 * automatic compaction too, and an automatic one fires on token pressure rather than on judgement.
 * The discriminator is `sourceCommandId` (vendor/dsh/packages/compaction/compaction/src/types.ts):
 * a summary that came from a COMMAND carries it; one the system took on its own does not. So this
 * module keeps only events that carry it, and a missing `sourceCommandId` stages NOTHING.
 *
 * EVERYTHING HERE IS A PROPOSAL AND NOTHING IS A WRITE. The record goes to the pending queue and
 * stops there: no settle, no store, no key material. `enqueuePending` is the only door used, and it
 * writes one JSON entry under the queue directory. A summary nobody approves is a summary nobody has.
 *
 * FOUR THINGS THIS REFUSES BY CONSTRUCTION:
 *
 *   · `rawOutput`, ALWAYS. The event may carry the complete provider output beside the safe summary
 *     projection, and the whole point of that projection is that the raw one is not for export. It is
 *     never read here — not filtered, not truncated, never touched — so no future edit can leak it by
 *     forgetting a condition.
 *   · A SECRET. A summary is model output and model output can quote a credential. A scan refuses the
 *     candidate, and the phrase check compares HASHES OF WORD WINDOWS, so a forbidden phrase is
 *     checked for without the phrase ever appearing in this source.
 *   · A LANE THAT OPTED OUT. AUMLOK is out by default, and the list is data rather than a condition
 *     buried in a branch.
 *   · AN UNRESOLVED LANE. If the session's lane cannot be resolved, the candidate is refused BY NAME
 *     rather than staged under a guess — a summary filed against the wrong lane is worse than one
 *     that was never filed, because the wrong lane will be seeded from it.
 *
 * ONE PENDING SUMMARY PER LANE. `supersedes` is the chain: a newer summary links to the older one, and
 * the older is marked declined through the store's existing decline document so it READS as declined
 * and is never deleted. Queue entries are immutable files; the decline marker is how a decision about
 * them is recorded without rewriting history.
 *
 * @module @aukora/dsh-plugin-kira/compaction-export
 */
import { createHash } from 'node:crypto'
import { recordKind, stageKiraMemoryRecord } from './record.mjs'

/** The event this module listens for. */
export const COMPACTION_SUMMARY_EVENT = 'compaction/summary'

/** The field whose presence marks a compaction as MANUAL. Its absence stages nothing at all. */
export const MANUAL_MARKER = 'sourceCommandId'

/**
 * THE LANES THAT ARE OUT, BY NAME. AUMLOK is out by default: the bind lane carries the phrases and the
 * approvals, and its summaries are the last thing that should be exported into a shared brain. An
 * opt-out is a decision, so it lives here as data a reader can see and a test can flip — not as a
 * condition somebody has to find.
 */
export const OPTED_OUT_LANES = Object.freeze(['AUMLOK'])

/** Most bytes of summary text one proposal may carry. */
export const MAX_SUMMARY_BYTES = 4096

/** What the record says wrote it. Reported, never inferred: the event carries provider and model. */
export const WRITER_LABEL = 'model-inference'

/**
 * HASHED FORBIDDEN PHRASES. The check is over sha256 of each 3-word window of the candidate, compared
 * against sha256 of the same windows of phrases that must never be exported. The PHRASES THEMSELVES
 * ARE NOT IN THIS FILE — that is the entire reason for hashing: a court that greps this source for a
 * forbidden phrase must find nothing, so the protection cannot be defeated by reading it.
 *
 * These digests are of windows from phrases already published in this repository's own ceilings. To
 * add one: hash each 3-word window of the phrase, lowercase, single-spaced, and paste the digests.
 */
export const FORBIDDEN_WINDOW_DIGESTS = Object.freeze([
  // sha256('the seven words stay') etc. — populated by tools/kira/forbidden-window-digests.mjs
])

/** Secret shapes worth refusing a summary over. Deliberately generic: a false positive costs a record. */
  // *** EXPORTED FOR THE CAPTURE PATH, WHICH WAS NOT PASSING IT AT ALL. *** Fable measured at HEAD that both capture hooks called
  // `consumeTurn` without `secretPatterns`, and it defaulted to `[]` — so the secret filter COULD NOT FIRE, and the remembered tier
  // (no approval since 0b71ca6db) would have kept "from now on use key sk-…" verbatim. One definition, imported by both, because a
  // second copy is a copy that drifts.
  export const SECRET_PATTERNS = Object.freeze([
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bnsec1[02-9ac-hj-np-z]{20,}\b/iu,
  /\bsk-[A-Za-z0-9_-]{20,}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
  /\b[0-9a-f]{64}\b/iu,
])

/** Bytes, not characters: a summary is capped by what it costs to carry. */
export const byteLength = (text) => Buffer.byteLength(String(text), 'utf8')

/** Lowercased, single-spaced words. Punctuation is dropped so a window cannot be split by it. */
export function words(text) {
  return String(text).toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').split(/\s+/u).filter(Boolean)
}

/** sha256 of one window, as hex. The only form a phrase takes in this module. */
export const windowDigest = (window) => createHash('sha256').update(window, 'utf8').digest('hex')

/** Every 3-word window of `text`, hashed. */
export function windowDigests(text) {
  const list = words(text)
  const out = []
  for (let i = 0; i + 3 <= list.length; i += 1) out.push(windowDigest(list.slice(i, i + 3).join(' ')))
  return out
}

/**
 * Whether any forbidden window appears. Compared as digests, so the phrase stays out of this source.
 *
 * AN EMPTY LIST THROWS, AND THAT IS THE WHOLE POINT (Codex sweep, finding 1). It used to `return false` — "no
 * forbidden phrase found" — for a list that contained no phrases at all, so the prohibition was DISABLED while
 * reading as enforced: the shipment of an empty `FORBIDDEN_WINDOW_DIGESTS` allowed every candidate, and the
 * generic credential patterns do not cover a phrase. "Not configured" is not "clean"; it throws so that no
 * caller can quietly treat it as one, and `compactionCandidate` refuses the candidate by name before it gets
 * here.
 */
export function carriesForbiddenPhrase(text, digests = FORBIDDEN_WINDOW_DIGESTS) {
  const forbidden = new Set(digests)
  if (forbidden.size === 0) {
    throw new Error('FORBIDDEN_PHRASE_DIGESTS_NOT_CONFIGURED: no forbidden-phrase digests are configured, so the '
      + 'prohibition cannot be enforced and no summary may be treated as clean')
  }
  return windowDigests(text).some(digest => forbidden.has(digest))
}

/** The name of the credential shape a summary appears to carry, or null. */
export function secretShapeIn(text) {
  const found = SECRET_PATTERNS.find(pattern => pattern.test(String(text)))
  return found === undefined ? null : String(found)
}

/**
 * THE SEVEN LANES, BY NAME. A lane is identified by the PREFIX OF ITS SESSION TITLE and by nothing else.
 *
 * MEASURED BY PETER, AND IT CONTRADICTS MY FIRST IMPLEMENTATION: a real session record carries NO lane field.
 * The KIRA transcript's first event is `session` with keys
 * `{agentPreset, createdAt, cwd, delegationDepth, id, isSeeded, type, version}` — there is no `header.lane`,
 * no `metadata.lane`, no `laneName` and no `app`, so the field-based resolver I shipped resolved NOTHING and
 * every real manual compaction would have been refused as `lane-unresolved`. The lane lives ONLY in the
 * session TITLE (projection row `title`, e.g. `KIRA 🧠`), and `lane_status` matches the seven names by title
 * prefix the same way.
 */
export const LANE_NAMES = Object.freeze(['AUMA', 'AURA', 'AK-UI', 'AUMLOK', 'BETA', 'KIRA', 'ALPHA'])

/**
 * The lane a title names, or null.
 *
 * CASE-SENSITIVE PREFIX, which is the part that is easy to get wrong: `kira notes` must NOT resolve. Its
 * leading word upper-cases to a lane name, so a case-insensitive reading would stage a note under KIRA; the
 * lane titles are written in capitals, and the prefix that identifies one is capitalised. An unknown title
 * resolves to null, and the caller refuses BY NAME rather than filing a summary against a guessed lane.
 * @param {unknown} title @returns {string|null}
 */
export function laneFromTitle(title) {
  if (typeof title !== 'string') return null
  const trimmed = title.trim()
  for (const name of LANE_NAMES) {
    if (trimmed.startsWith(name)) return name
  }
  return null
}

/** The title out of whatever a reader handed back: a session record, a header, a projection, or a surface. */
export function titleOfSessionRecord(record) {
  const direct = [
    record?.title,
    record?.header?.title,
    record?.projection?.title,
    record?.session?.title,
    record?.record?.title,
  ]
  for (const value of direct) {
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  // A SURFACE IS A LIST OF EVENTS, and the title arrives as a projection row rather than as a field. Both
  // spellings are read, because the transcript's own shape is `{type: 'session', …}` while the projection row
  // carries the title under `title`/`value`/`text` — measured shapes, not invented ones.
  const events = Array.isArray(record) ? record : (Array.isArray(record?.events) ? record.events : [])
  for (const event of events) {
    const candidate = [event?.title, event?.value, event?.text, event?.data?.title]
      .find(value => typeof value === 'string' && value.trim() !== '')
    if (typeof candidate === 'string') return candidate
  }
  return null
}

/**
 * The lane out of a session record, or null. Kept as the ONE entry point the hook calls, so the title is the
 * only route to a lane and a future field cannot quietly become a second one.
 * @param {unknown} record @returns {string|null}
 */
export function laneOfSessionRecord(record) {
  return laneFromTitle(titleOfSessionRecord(record))
}

/** The text of a ContentBlock list, joined. Nothing else about the blocks is read. */
export function summaryTextOf(blocks) {
  if (typeof blocks === 'string') return blocks
  if (!Array.isArray(blocks)) return ''
  return blocks.map(block => (typeof block?.text === 'string' ? block.text : '')).join('\n').trim()
}

/**
 * A summary capped at the byte bound, cut on a word boundary where one is near the end.
 *
 * **CODEX SWEEP, FINDING 6 — THE CAP WAS OFF BY TWO AND QUADRATIC.** Two defects lived in the same two lines:
 * the truncation reserved ONE byte for a marker that costs THREE (`…` is three bytes in UTF-8), so a summary
 * advertised as 4,096 bytes could be 4,098 — MEASURED at 4,097 through the court, because `trimEnd` shaved a
 * space. And the loop re-measured the WHOLE shrinking string on every iteration, which is quadratic in the length
 * of a summary — a cost paid on the path that is supposed to bound it.
 *
 * NOW: ONE PASS, ONE MEASUREMENT PER CODE POINT, and the marker's real size subtracted from the budget first. The
 * walk iterates CODE POINTS, so a surrogate pair is never split, and `trimEnd` can only make the result smaller.
 */
export function capSummary(text, maxBytes = MAX_SUMMARY_BYTES) {
  const whole = String(text)
  if (byteLength(whole) <= maxBytes) return whole
  const marker = '…'
  const budget = maxBytes - byteLength(marker)
  // A bound that cannot hold the marker cannot hold anything: return nothing rather than something too big.
  if (budget <= 0) return ''
  let bytes = 0
  let end = 0
  for (const character of whole) {
    const size = byteLength(character)
    if (bytes + size > budget) break
    bytes += size
    end += character.length
  }
  return `${whole.slice(0, end).trimEnd()}${marker}`
}

/**
 * THE PURE CORE: one event in, one candidate or one named refusal out. No I/O, no ctx, no clock.
 *
 * @param {unknown} event a `compaction/summary` payload
 * @param {{lane?: string|null, ancestry?: unknown, now?: string, previousSummaryId?: string|null,
 *          optedOut?: readonly string[]}} context
 * @returns {{ok: true, category: string, recordId: string, record: object, memoryPut: object,
 *            thread: object, label: string} | {ok: false, reason: string, detail: string}}
 */
export function compactionCandidate(event, context = {}) {
  const payload = /** @type {Record<string, unknown>} */ (event?.data ?? event)
  if (payload === null || typeof payload !== 'object') {
    return { ok: false, reason: 'event-malformed', detail: 'the event carries no payload object' }
  }
  // MANUAL ONLY. An automatic compaction is token pressure, not judgement, and it carries no command.
  if (typeof payload[MANUAL_MARKER] !== 'string' || payload[MANUAL_MARKER].trim() === '') {
    return { ok: false, reason: 'not-a-manual-compaction', detail: `no ${MANUAL_MARKER}: this compaction was not a command` }
  }
  const lane = typeof context.lane === 'string' && context.lane.trim() !== '' ? context.lane.trim().toUpperCase() : null
  if (lane === null) {
    return { ok: false, reason: 'lane-unresolved', detail: 'the session lane could not be resolved, so nothing is staged' }
  }
  const optedOut = context.optedOut ?? OPTED_OUT_LANES
  if (optedOut.includes(lane)) {
    return { ok: false, reason: 'lane-opted-out', detail: `lane ${lane} has opted out of compaction export` }
  }
  const text = summaryTextOf(payload.summary)
  if (text === '') return { ok: false, reason: 'summary-empty', detail: 'the event carries no summary text' }
  // THE PROHIBITION IS CONFIGURED, OR NOTHING IS EXPORTED. This is checked FIRST because it is not a statement
  // about the candidate: with no digests there is no prohibition to apply, and a refusal that cannot refuse must
  // not read as a green one.
  const forbiddenDigests = context.forbiddenWindowDigests ?? FORBIDDEN_WINDOW_DIGESTS
  if (!Array.isArray(forbiddenDigests) || forbiddenDigests.length === 0) {
    return { ok: false, reason: 'not-configured',
      detail: 'no forbidden-phrase digests are configured, so the phrase prohibition cannot be enforced and nothing may be exported' }
  }
  const secret = secretShapeIn(text)
  if (secret !== null) return { ok: false, reason: 'secret-refused', detail: 'the summary matches a credential shape' }
  if (carriesForbiddenPhrase(text, forbiddenDigests)) {
    return { ok: false, reason: 'phrase-refused', detail: 'the summary carries a phrase that must not be exported' }
  }
  const compactionId = typeof payload.compactionId === 'string' ? payload.compactionId : null
  if (compactionId === null) return { ok: false, reason: 'compaction-id-missing', detail: 'no compactionId' }
  const range = payload.shadowedRange
  const shadowedRange = range !== null && typeof range === 'object'
    ? { start: Number(range.start), end: Number(range.end) }
    : null
  if (shadowedRange === null || !Number.isFinite(shadowedRange.start) || !Number.isFinite(shadowedRange.end)) {
    return { ok: false, reason: 'shadowed-range-missing', detail: 'the event does not say what it shadowed' }
  }
  const thread = {
    lane,
    sessionId: typeof context.sessionId === 'string' ? context.sessionId : null,
    compactionId,
    summarySeq: Number.isFinite(Number(payload.summarySeq)) ? Number(payload.summarySeq) : shadowedRange.end,
    shadowedRange,
  }
  const writer = {
    provider: typeof payload.provider === 'string' ? payload.provider : 'unknown',
    model: typeof payload.model === 'string' ? payload.model : 'unknown',
  }
  // THE LINKS ARE THE CHAIN. `supersedes` names the lane's previous pending summary, so a lane's
  // history reads as a succession. `source`/`transform` would claim derivation this is not.
  const links = typeof context.previousSummaryId === 'string' && context.previousSummaryId !== ''
    ? [{ recordId: context.previousSummaryId, relation: 'supersedes' }]
    : []
  if (!recordKind.includes('summary')) {
    // A kind outside the closed set is a defect in THIS module, and it is refused before a record is
    // built rather than after — a check that runs once the thing it guards already exists is decoration.
    return { ok: false, reason: 'kind-mapping-invalid', detail: "the record contract does not accept kind 'summary'" }
  }
  const staged = stageKiraMemoryRecord({
    subject: context.subject,
    kind: 'summary',
    source: [],
    links,
    privacy: context.privacy,
    createdAt: context.now,
    content: {
      thread,
      ancestry: context.ancestry ?? 'unknown',
      writer,
      label: WRITER_LABEL,
      summary: capSummary(text),
    },
  })
  return { ok: true, category: 'manual-compaction', recordId: staged.recordId, record: staged.record, memoryPut: staged.memoryPut, thread, label: WRITER_LABEL }
}

/**
 * The lane of the summary that should be seeded for a lane, from rows a reader already has.
 * Kept here beside the candidate so the chain's two ends are read in one place.
 * @param {readonly {lane?: string, state?: string, recordId?: string}[]} rows
 * @param {string} lane
 * @returns {string|null}
 */
export function lastSettledSummaryId(rows, lane) {
  const wanted = String(lane).toUpperCase()
  for (const row of rows) {
    if (String(row?.lane ?? '').toUpperCase() === wanted && row?.state === 'settled' && typeof row.recordId === 'string') {
      return row.recordId
    }
  }
  return null
}

/**
 * THE PURE PLANNER: a stream of events in, the exact stages to perform out.
 *
 * The wiring is allowed to be thin and the decisions are not, so every decision the queue would make is
 * made HERE, where a court can drive it with events and read the result: a compactionId that has already
 * been staged is skipped, a lane that opted out never appears, and a lane's SECOND summary carries a
 * `supersedes` link to its first and marks that first one declined. Nothing here writes.
 *
 * @param {readonly unknown[]} events
 * @param {{lane?: string|null, sessionId?: string|null, ancestry?: unknown, now?: string,
 *          optedOut?: readonly string[], stagedCompactionIds?: readonly string[],
 *          pendingByLane?: Record<string, string>}} context
 * @returns {{stages: object[], refusals: {reason: string, detail: string}[], declines: string[]}}
 */
export function planStages(events, context = {}) {
  const stages = []
  const refusals = []
  const declines = []
  const seen = new Set(context.stagedCompactionIds ?? [])
  const pending = { ...(context.pendingByLane ?? {}) }
  for (const event of events) {
    const payload = /** @type {Record<string, unknown>} */ (event?.data ?? event)
    const compactionId = typeof payload?.compactionId === 'string' ? payload.compactionId : null
    if (compactionId !== null && seen.has(compactionId)) {
      // ALREADY STAGED IS NOT AN ERROR AND IT IS NOT A SECOND PROPOSAL: the reviewer has one entry for
      // these bytes, and staging them again would ask them to decide the same thing twice.
      refusals.push({ reason: 'already-staged', detail: `compactionId ${compactionId} has already been staged` })
      continue
    }
    const candidate = compactionCandidate(event, { ...context, previousSummaryId: null })
    if (!candidate.ok) { refusals.push({ reason: candidate.reason, detail: candidate.detail }); continue }
    const lane = candidate.thread.lane
    const previous = pending[lane] ?? null
    const withChain = previous === null
      ? candidate
      : compactionCandidate(event, { ...context, previousSummaryId: previous })
    if (!withChain.ok) { refusals.push({ reason: withChain.reason, detail: withChain.detail }); continue }
    if (previous !== null) declines.push(previous)
    pending[lane] = withChain.recordId
    if (compactionId !== null) seen.add(compactionId)
    stages.push({ lane, compactionId, recordId: withChain.recordId, record: withChain.record, memoryPut: withChain.memoryPut, supersedes: previous })
  }
  return { stages, refusals, declines }
}
