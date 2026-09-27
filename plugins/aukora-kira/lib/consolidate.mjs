/**
 * CONSOLIDATION — THE MAIN BRAIN'S INDEX, BUILT SO A CHORUS CANNOT BECOME A FACT.
 *
 * WHAT THIS IS. Each lane keeps a chain of settled summaries; this reads the NEWEST settled summary per lane
 * and stages ONE inert `kind:'summary'` core record that describes what the lanes together hold. Deterministic:
 * no model call, no network, no clock of its own — the same inputs must produce the same bytes, or the digest
 * cannot be compared with anything.
 *
 * THE RULE IT EXISTS TO OBEY, from the Golden boundary (docs/AUKORA-GOLDEN-BOUNDARY.md):
 *
 *   "The anti-mimetic rule is that imitation must manufacture neither authority nor independent
 *    evidence. … Different hashes or signatures do not establish independent sources, and missing ancestry must
 *    remain unknown rather than earn a fresh vote. Three witness signatures may establish agreement under a
 *    protocol; three restatements of one observation are not three observations."
 *
 * SO COUNTING IS BY ANCESTRY, AND BY NOTHING ELSE. Two restatements of one claim are the SAME observation when
 * their ancestries OVERLAP — they come from the same recorded thing. Identical text is not independence.
 * Different hashes are not independence. Different signatures are not independence. A restatement whose ancestry
 * is unknown is REPORTED and NEVER VOTES: it cannot join a group (which would launder it into a count) and it
 * cannot start one. `'unknown'` stays unknown, in the record and in the count.
 *
 * THREE THINGS THIS MODULE REFUSES BY CONSTRUCTION:
 *
 *   · AUTHORITY OF ANY KIND. The digest carries no field that could be read as permission — no `authority`, no
 *     `grant`, no `approval`, no `mayAct`, no `confidence` — and `authorityFieldsIn()` exists so a court can
 *     assert that about the real record rather than trusting this comment. A chorus is not an authorization
 *     mechanism, and repeated pressure is not human reconsideration.
 *   · LOSING COUNTEREVIDENCE. Contrary evidence is carried BESIDE the claim it contradicts, with the lane it
 *     came from. It is never averaged into a score, because a number that folds disagreement into agreement has
 *     already decided the question the reader is being asked to decide.
 *   · ERASING A HUMAN DECISION. A proposal a person declined stays declined: it is NAMED in the digest, and
 *     staging refuses if a declined proposal would come back as pending. Explicit reconsideration stays
 *     possible — by a person, not by the chorus growing louder.
 *
 * ONE WRITE, AND IT IS A PROPOSAL. `enqueuePending` is the only door, used once, and no settle path is imported.
 *
 * @module @aukora/dsh-plugin-kira/consolidate
 */
import { createHash } from 'node:crypto'
import { recordKind, stageKiraMemoryRecord } from './record.mjs'

/** Most characters of a claim's own text carried into the digest. */
export const MAX_HEADLINE_CHARS = 160

/** Most characters of one lane's headline. */
export const MAX_LANE_HEADLINE_CHARS = 120

/** The value that means "this restatement cannot show where it came from". It never earns a vote. */
export const UNKNOWN_ANCESTRY = 'unknown'

/**
 * FIELD NAMES THAT WOULD MAKE THIS AN AUTHORIZATION. The digest carries none of them, and the court asserts
 * that over the real record: a chorus that produces a permission field has manufactured authority out of
 * repetition, which is exactly what the anti-mimetic rule forbids.
 */
export const AUTHORITY_FIELD = /(authority|permission|approval|approv|grant|authoriz|authoris|mayAct|may_act|allowed|entitle|confidence|voteCount|quorum)/iu

/** The words of a claim, normalised, so two spellings of one sentence are recognisably the same claim. */
export const claimWords = text => String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').split(/\s+/u).filter(Boolean)

/** The identity of a CLAIM (not of the observation): its normalised words. */
export const claimKey = text => claimWords(text).join(' ')

/** The first line of a text, capped. A headline is for a reader; the body stays where it was written. */
export function headlineOf(text, max = MAX_HEADLINE_CHARS) {
  const first = String(text ?? '').split('\n').map(line => line.trim()).find(line => line !== '') ?? ''
  return first.length <= max ? first : `${first.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

/** The ancestry of one lane summary, as a set of record ids. `'unknown'` is preserved as itself. */
export function ancestrySetOf(summary) {
  const raw = summary?.ancestry
  if (raw === undefined || raw === null) return UNKNOWN_ANCESTRY
  if (typeof raw === 'string') return raw === '' ? UNKNOWN_ANCESTRY : raw
  if (Array.isArray(raw)) {
    // THE SENTINEL IS EXCLUDED WHEREVER IT APPEARS, AND WHAT REMAINS IS VALIDATED (Codex sweep, finding 4). The
    // scalar branch compared against `UNKNOWN_ANCESTRY`, but an ARRAY never equals that string — so `['unknown']`
    // came back as RECORDED ancestry, and two lanes that both said "my ancestry is not recorded" were reported as
    // two summaries sharing an observation. The unknown sentinel thus EARNED A VOTE, which is exactly what the
    // counting rule forbids. What is kept must be a non-empty string that is not the sentinel: an identifier.
    const ids = raw.filter(one => typeof one === 'string' && one !== '' && one !== UNKNOWN_ANCESTRY)
    return ids.length === 0 ? UNKNOWN_ANCESTRY : [...new Set(ids)].sort()
  }
  return UNKNOWN_ANCESTRY
}

/** Whether two ancestry values OVERLAP — the only test this module uses to decide "same observation". */
export function ancestryOverlaps(left, right) {
  if (left === UNKNOWN_ANCESTRY || right === UNKNOWN_ANCESTRY) return false
  const a = new Set(Array.isArray(left) ? left : [left])
  const b = Array.isArray(right) ? right : [right]
  return b.some(one => a.has(one))
}

/**
 * ONE SUMMARY PER LANE: THE NEWEST SETTLED ONE, AND ONLY IT.
 *
 * A lane keeps a CHAIN of settled summaries. The index is of what the lane holds NOW, so an older summary in the
 * same lane is not a second voice — indexing both would double that lane's weight and, worse, let a superseded
 * claim keep voting after the lane moved on. Ties are broken by record id, so the choice is deterministic rather
 * than dependent on the order the caller happened to read rows in.
 * @param {readonly object[]} summaries @returns {object[]}
 */
export function newestPerLane(summaries) {
  const byLane = new Map()
  for (const summary of summaries) {
    const lane = String(summary?.lane ?? '')
    if (lane === '') continue
    const settledAt = typeof summary?.settledAt === 'string' ? summary.settledAt : ''
    const recordId = typeof summary?.recordId === 'string' ? summary.recordId : ''
    const held = byLane.get(lane)
    if (held === undefined || settledAt > held.settledAt || (settledAt === held.settledAt && recordId > held.recordId)) {
      byLane.set(lane, { summary, settledAt, recordId })
    }
  }
  return [...byLane.values()].map(one => one.summary)
}

/**
 * GROUP RESTATEMENTS INTO OBSERVATIONS, BY ANCESTRY OVERLAP.
 *
 * Restatements of one claim are merged when their ancestries intersect, transitively — a chain of summaries
 * that all trace to one recorded observation is ONE observation however many lanes repeat it. `hashes` and
 * `signatures` are deliberately NOT read here: the Golden boundary says different hashes or signatures do not
 * establish independent sources, so they can neither split a group nor join one.
 *
 * A restatement with unknown ancestry is listed under `unknownAncestry` and counts for NOTHING.
 *
 * @param {readonly object[]} summaries
 * @returns {{observations: object[], unknownAncestry: object[]}}
 */
export function observationsOf(summaries) {
  const known = []
  const unknown = []
  for (const summary of summaries) {
    const ancestry = ancestrySetOf(summary)
    const entry = {
      lane: String(summary?.lane ?? ''),
      summaryId: typeof summary?.recordId === 'string' ? summary.recordId : null,
      settledAt: typeof summary?.settledAt === 'string' ? summary.settledAt : null,
      claim: claimKey(summary?.claim ?? summary?.headline ?? ''), 
      headline: headlineOf(summary?.headline ?? summary?.text ?? ''),
      ancestry,
    }
    if (entry.claim === '') continue
    if (ancestry === UNKNOWN_ANCESTRY) unknown.push(entry)
    else known.push(entry)
  }
  const byClaim = new Map()
  for (const entry of known) {
    if (!byClaim.has(entry.claim)) byClaim.set(entry.claim, [])
    byClaim.get(entry.claim).push(entry)
  }
  const observations = []
  for (const [claim, entries] of [...byClaim.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    // UNION-FIND BY OVERLAP: transient connectivity is still connectivity, and a chain of restatements that
    // all touch one recorded observation is one observation.
    const groups = []
    for (const entry of entries) {
      const touching = groups.filter(group => group.some(member => ancestryOverlaps(member.ancestry, entry.ancestry)))
      if (touching.length === 0) { groups.push([entry]); continue }
      const merged = [entry, ...touching.flat()]
      for (const group of touching) groups.splice(groups.indexOf(group), 1)
      groups.push(merged)
    }
    for (const group of groups) {
      const ancestries = [...new Set(group.flatMap(one => (Array.isArray(one.ancestry) ? one.ancestry : [one.ancestry])))].sort()
      observations.push({
        claim,
        headline: group[0].headline,
        // ONE OBSERVATION, HOWEVER MANY LANES SAY IT. The count is of observations, not of restatements.
        observations: 1,
        restaters: group.map(one => one.lane).sort(),
        restatementCount: group.length,
        // THE EVIDENCE THAT MAKES IT ONE: the shared record ids. A reader can check this without trusting us.
        sharedAncestry: ancestries,
        summaryIds: group.map(one => one.summaryId).filter(one => one !== null).sort(),
      })
    }
  }
  return {
    observations,
    unknownAncestry: unknown
      .map(one => ({ lane: one.lane, summaryId: one.summaryId, headline: one.headline, ancestry: UNKNOWN_ANCESTRY }))
      .sort((a, b) => `${a.lane}${a.headline}`.localeCompare(`${b.lane}${b.headline}`)),
  }
}

/** Every field name in a value, at any depth. Used to assert no authority-shaped field is present. */
export function fieldNamesIn(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return []
  seen.add(value)
  const names = []
  for (const [key, inner] of Object.entries(value)) {
    names.push(key, ...fieldNamesIn(inner, seen))
  }
  return names
}

/** The authority-shaped field names a digest carries. MUST be empty. */
export const authorityFieldsIn = digest => fieldNamesIn(digest).filter(name => AUTHORITY_FIELD.test(name))

/** The digest of a proposed core record, so a declined proposal can be named without carrying its body. */
export const proposalDigestOf = content => createHash('sha256').update(JSON.stringify(content), 'utf8').digest('hex')

/**
 * THE PROPOSAL'S IDENTITY: THE CLAIMS, WITHOUT THE BOOKKEEPING ABOUT THEM.
 *
 * **CODEX SWEEP, FINDING 2, THE SINGLE MOST IMPORTANT CHANGE IN IT.** The digest used to be taken over the WHOLE
 * core, decline history included. So recording a rejection changed the digest of UNCHANGED lane claims — and the
 * new digest walked straight past `stageCoreDigest`'s `already-declined` check, which is how a refusal could become
 * pending work again by the mere act of being refused. `core.declined` still travels IN THE RECORD, where a
 * reviewer sees it; it is simply not part of what the record IS.
 *
 * THE FIELDS ARE LISTED EXPLICITLY, IN A FIXED ORDER, so the identity cannot drift when a field is added to the
 * core: a new field is not silently enrolled in the identity, and this function is the one place to decide that it
 * should be.
 *
 * @param {Readonly<Record<string, unknown>>} core
 * @returns {Readonly<Record<string, unknown>>}
 */
/**
 * FREEZE A VALUE ALL THE WAY DOWN (Codex sweep, finding 3).
 *
 * The core was frozen at its top level only: `core.lanes` was `Object.freeze`d as a LIST while the lane objects
 * inside it stayed mutable, and an observation was frozen while its `restaters`, `sharedAncestry` and `summaryIds`
 * arrays were not. Staging copies those nested contents and carries the digest computed earlier, so a caller who
 * could still reach in could make the staged bytes differ from the bytes the digest describes. With the whole
 * value frozen — and `stageCoreDigest` recomputing the digest before it stages (finding 2) — the two cannot come
 * apart at all.
 *
 * The freeze happens BEFORE the recursion, so a self-referential value stops at the first visit rather than
 * recursing forever.
 *
 * @template T @param {T} value @returns {T}
 */
export function deepFreeze(value, seen = new WeakSet()) {
  // A FROZEN CONTAINER STILL HAS LIVE CHILDREN, AND THE FIRST VERSION OF THIS MISSED EXACTLY THAT: it returned
  // early on `Object.isFrozen(value)`, so `lanes` — which the builder already froze as a LIST — was never
  // descended into, and the lane objects inside it stayed mutable. The court caught it: "BUT THE LANE OBJECTS
  // INSIDE IT MUST BE FROZEN TOO" still failed after the fix. Recursion is guarded by a VISITED SET instead,
  // which is what actually stops a cycle without skipping frozen parents.
  if (value === null || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  Object.freeze(value)
  for (const nested of Object.values(value)) deepFreeze(nested, seen)
  return value
}

export function proposalIdentityOf(core) {
  return Object.freeze({
    lanes: core?.lanes ?? [],
    counterevidence: core?.counterevidence ?? [],
    observations: core?.observations ?? [],
    unknownAncestry: core?.unknownAncestry ?? [],
    countingRule: core?.countingRule ?? '',
  })
}


/**
 * BUILD THE CORE DIGEST. Deterministic, pure, and complete: everything a reader needs to check the count is in
 * the record, and nothing that could be read as permission.
 *
 * @param {{laneSummaries: readonly object[], counterevidence?: readonly object[], declined?: readonly object[],
 *          subject?: string, privacy?: string, now?: string}} input
 * @returns {Readonly<Record<string, unknown>>}
 */
export function buildCoreDigest(input) {
  // ONE VOICE PER LANE, and it is the newest: an older summary in the same lane is not a second source.
  const summaries = newestPerLane(input.laneSummaries ?? []).sort((a, b) => String(a?.lane ?? '').localeCompare(String(b?.lane ?? '')))
  const { observations, unknownAncestry } = observationsOf(summaries)
  const lanes = summaries.map(summary => ({
    lane: String(summary?.lane ?? ''),
    summaryId: typeof summary?.recordId === 'string' ? summary.recordId : null,
    settledAt: typeof summary?.settledAt === 'string' ? summary.settledAt : null,
    headline: headlineOf(summary?.headline ?? summary?.text ?? '', MAX_LANE_HEADLINE_CHARS),
    ancestry: ancestrySetOf(summary),
  }))
  const counterevidence = (input.counterevidence ?? []).map(one => ({
    claim: claimKey(one?.claim ?? ''),
    headline: headlineOf(one?.headline ?? one?.text ?? ''),
    lane: String(one?.lane ?? ''),
    summaryId: typeof one?.summaryId === 'string' ? one.summaryId : null,
  })).sort((a, b) => `${a.claim}${a.lane}`.localeCompare(`${b.claim}${b.lane}`))
  // A DECLINED PROPOSAL IS NAMED, NEVER RE-PROPOSED. `core.declined` names decisions already made — older
  // proposals a person refused, with the reason they gave. It cannot name THIS candidate, whose digest is
  // computed from this very content; `stageCoreDigest`'s `declinedDigests` option is what refuses a repeat.
  const declined = (input.declined ?? []).map(one => ({
    digest: String(one?.digest ?? ''),
    declinedAt: typeof one?.declinedAt === 'string' ? one.declinedAt : null,
    reason: typeof one?.reason === 'string' ? one.reason : null,
  })).sort((a, b) => a.digest.localeCompare(b.digest))
  // DEEP, NOT SHALLOW: see `deepFreeze` for what a shallow freeze let a caller do to the content behind a digest.
  const core = deepFreeze({
    lanes: Object.freeze(lanes),
    // COUNTEREVIDENCE STANDS BESIDE THE CLAIM. There is no field here that combines it with anything.
    counterevidence: Object.freeze(counterevidence),
    declined: Object.freeze(declined),
    // THE COUNT AND ITS BASIS ARE BOTH IN THE RECORD: a count whose rule is not visible cannot be checked, and
    // an unchecked count is exactly the manufactured consensus the Golden boundary forbids.
    observations: Object.freeze(observations.map(one => Object.freeze({ ...one }))),
    unknownAncestry: Object.freeze(unknownAncestry),
    countingRule: 'ancestry-overlap; unknown ancestry never votes; hashes and signatures are not independence',
  })
  return Object.freeze({
    core,
    // THE PROPOSAL'S OWN IDENTITY, so a decline can name it without naming its body.
    proposalDigest: proposalDigestOf(proposalIdentityOf(core)),
    source: Object.freeze(summaries.map(one => one?.recordId).filter(one => typeof one === 'string').sort()),
  })
}

/**
 * Stage ONE inert core record through the queue, or refuse by name.
 *
 * @param {{enqueuePending: Function}} queue
 * @param {Readonly<Record<string, unknown>>} digest
 * @param {{subject?: string, privacy?: string, now?: string, declinedDigests?: readonly string[]}} options
 * @returns {{staged: boolean, reason?: string, recordId?: string}}
 */
export function stageCoreDigest(queue, digest, options = {}) {
  if (queue === undefined || typeof queue.enqueuePending !== 'function') {
    return { staged: false, reason: 'no-queue' }
  }
  const authority = authorityFieldsIn(digest)
  if (authority.length > 0) {
    // NEVER STAGED AT ALL: a record with an authority-shaped field must not reach a reviewer, because the
    // field would be read as permission no matter what the prose beside it says.
    return { staged: false, reason: `authority-field:${authority.join(',')}` }
  }
  // THE DIGEST MUST DESCRIBE THE CONTENT BEING STAGED. Recomputing it here is what makes the identity a fact
  // about the bytes rather than a claim the caller brought along: a digest computed before the content changed no
  // longer matches, and a record may not be staged under an identity that is not its own.
  const recomputed = proposalDigestOf(proposalIdentityOf(digest?.core))
  if (String(digest?.proposalDigest ?? '') !== recomputed) {
    return { staged: false, reason: 'digest-mismatch',
      detail: 'the proposal digest does not describe the content being staged, so it would name a proposal that is not this one' }
  }
  if ((options.declinedDigests ?? []).includes(String(digest?.proposalDigest ?? ''))) {
    // A HUMAN DECISION IS NOT UNDONE BY RE-SUBMISSION. The chorus growing louder is not reconsideration.
    return { staged: false, reason: 'already-declined' }
  }
  if (!recordKind.includes('summary')) return { staged: false, reason: 'kind-not-accepted' }
  const staged = stageKiraMemoryRecord({
    subject: options.subject,
    kind: 'summary',
    // `source` IS A LIST OF RECORD REFERENCES, NOT A LIST OF STRINGS: the contract's check is `source must be
    // one plain data record`, and bare ids are refused. MEASURED — this was the second attempt at the same
    // line, and the first blamed freezing, which was wrong.
    source: (digest.source ?? []).map(recordId => ({ recordId })),
    links: [],
    privacy: options.privacy,
    createdAt: options.now,
    // PLAIN DATA AT THE BOUNDARY. The digest is frozen ON PURPOSE — a caller must not edit a record after its
    // proposal digest was computed — but the record contract refuses frozen handles, so the boundary hands over
    // copies. Freezing is for our callers; plain data is for the contract.
    content: {
      label: 'model-inference',
      core: {
        lanes: (digest.core.lanes ?? []).map(one => ({ ...one })),
        counterevidence: (digest.core.counterevidence ?? []).map(one => ({ ...one })),
        declined: (digest.core.declined ?? []).map(one => ({ ...one })),
        observations: (digest.core.observations ?? []).map(one => ({
          ...one,
          restaters: [...(one.restaters ?? [])],
          sharedAncestry: [...(one.sharedAncestry ?? [])],
          summaryIds: [...(one.summaryIds ?? [])],
        })),
        unknownAncestry: (digest.core.unknownAncestry ?? []).map(one => ({ ...one })),
        countingRule: digest.core.countingRule,
      },
      proposalDigest: digest.proposalDigest,
    },
  })
  queue.enqueuePending({ recordId: staged.recordId, record: staged.record, memoryPut: staged.memoryPut })
  // THE PROPOSAL TRAVELS BACK WITH THE ANSWER, for the reason the hook documents at length: a queue entry holds
  // `{version, recordId, subject, kind, createdAt, privacy, record}` and NO memoryPut, so a caller that wants to
  // decline this proposal later must be handed the one it staged rather than trying to reconstruct it from bytes.
  return { staged: true, recordId: staged.recordId, memoryPut: staged.memoryPut }
}

/** The kind a lane's compaction summary is written under. A CORE DIGEST carries the same kind and is told apart by
 * the lane it names, not by its kind — see `laneOfSummaryRecord`. */
const LANE_SUMMARY_KIND = 'summary'

/**
 * The lane a summary record belongs to, from the LANE PREFIX OF ITS SESSION TITLE as `compaction-export.mjs`
 * wrote it, or null when it names none.
 *
 * THIS IS THE SAME RULE `aukora-organism/lib/lane-memory.mjs` APPLIES, written out again rather than imported:
 * the organism imports THIS module, so importing it back would be a cycle. The rule is three lines and the two
 * copies are asserted against each other by the courts that read both.
 *
 * IT IS ALSO THE GUARD AGAINST SELF-FEEDING. A staged CORE digest has `content.core` and no `content.thread`, so
 * it names no lane and is skipped here — without that, consolidation would read its own previous conclusion as
 * something a lane said, and the chorus would corroborate itself.
 */
function laneOfSummaryRecord(record) {
  const lane = record?.content?.thread?.lane
  return typeof lane === 'string' && lane.trim() !== '' ? lane.trim().toUpperCase() : null
}

/** The summary prose of a record: the capped text `compaction-export.mjs` wrote. */
function summaryTextOfRecord(record) {
  const summary = record?.content?.summary
  return typeof summary === 'string' ? summary : ''
}

/**
 * CONSOLIDATE WHAT THE QUEUE HOLDS, AND STAGE IT — the wiring (kira-102, item 1).
 *
 * WHAT WAS WRONG. This module had exactly one importer, its own court: a manual compaction staged lane summaries
 * and NOTHING consolidated them, so "the organism's conclusion" existed as a READ VIEW assembled elsewhere and
 * never as a proposal a reviewer could meet. The functions were right and unreachable.
 *
 * WHAT THIS DOES. Reads the queue's own entries, keeps the newest summary PER LANE, builds the core digest over
 * them, and stages ONE inert record through the same `enqueuePending` door as everything else. The three
 * properties the digest is supposed to have are the three the courts assert end to end:
 *
 *   · SHARED ANCESTRY COUNTS ONCE — two lanes restating one recorded observation are ONE observation, because
 *     `buildCoreDigest` groups by ancestry overlap and not by text, hash or signature.
 *   · DECLINES ARE NEVER ERASED — a declined proposal is NAMED in the new record's `core.declined`, and if the
 *     content would reproduce a declined proposal the staging REFUSES (`already-declined`) instead of bringing
 *     it back. What the queue can see is that those bytes were declined, not why: `writeDeclined` records the
 *     digest and no reason, so `reason` and `declinedAt` are honestly null rather than invented here.
 *   · NO AUTHORITY FIELDS — `stageCoreDigest` refuses a digest carrying one, and `authorityFieldsIn` lets a court
 *     assert it about the stageable record rather than trusting this comment.
 *
 * PENDING AND SETTLED BOTH COUNT, AND THAT IS A CHOICE WORTH NAMING. The digest is a PROPOSAL about what the
 * lanes have put forward, so the newest summary per lane counts whether or not a person has settled it — a
 * scratch store, where nothing has been settled yet, would otherwise consolidate to nothing at all. The read view
 * in `lane-memory.mjs` stays SETTLED-ONLY, because a view reports conclusions rather than proposals.
 *
 * @param {{enqueuePending: Function, list?: Function, read?: Function}} queue
 * @param {{subject?: string, privacy?: string, now?: string}} [options]
 * @returns {{staged: boolean, reason?: string, recordId?: string, digest?: unknown, laneCount?: number,
 *            declinedDigests?: readonly string[], unreadableRows?: number}}
 */
export function consolidateQueue(queue, options = {}) {
  if (queue === undefined || typeof queue.enqueuePending !== 'function') return { staged: false, reason: 'no-queue' }
  if (typeof queue.list !== 'function' || typeof queue.read !== 'function') {
    return { staged: false, reason: 'no-queue-enumeration' }
  }
  let rows
  try {
    rows = queue.list()
  } catch (error) {
    return { staged: false, reason: `queue-unlistable:${String(error?.code ?? error?.message ?? 'unknown')}` }
  }
  const listed = Array.isArray(rows?.entries) ? rows.entries : (Array.isArray(rows) ? rows : [])
  const laneSummaries = []
  const declined = []
  const declinedSeen = new Set()
  let unreadableRows = 0
  for (const row of listed) {
    const recordId = typeof row?.recordId === 'string' ? row.recordId : null
    if (recordId === null) continue
    let entry
    try {
      entry = queue.read(recordId)?.entry
    } catch {
      // COUNTED, NOT SWALLOWED: a row that cannot be read is a row this consolidation did not consider, and a
      // caller that is told the number can say so rather than reporting a digest of the rows that happened to work.
      unreadableRows += 1
      continue
    }
    const record = entry?.record
    if (record?.kind !== LANE_SUMMARY_KIND) continue
    // A DECLINED PROPOSAL IS COLLECTED BEFORE THE LANE GUARD, AND THAT ORDER IS THE FIX. A core digest names no
    // lane, so a `continue` on the lane check skipped it — leaving the ONE class of record this module stages as
    // the one class whose decline it forgot, which is precisely the erasure the whole design forbids. MEASURED:
    // the end-to-end arm caught it, with a fresh core carrying an empty `declined` while the store said the
    // proposal had been declined.
    if (row?.declined === true) {
      // THE RECORD'S OWN PROPOSAL IDENTITY, which is the value `stageCoreDigest` compares against: a decline is
      // written against the CONTENT digest, and a core proposal names itself by the digest of its identity.
      const own = record?.content?.proposalDigest
      if (typeof own === 'string' && own !== '' && !declinedSeen.has(own)) {
        declinedSeen.add(own)
        declined.push(Object.freeze({ digest: own, declinedAt: null, reason: null }))
      }
    }
    const lane = laneOfSummaryRecord(record)
    if (lane === null) continue
    const text = summaryTextOfRecord(record)
    laneSummaries.push({
      lane,
      recordId: typeof record?.recordId === 'string' ? record.recordId : recordId,
      settledAt: typeof record?.createdAt === 'string' ? record.createdAt : null,
      headline: headlineOf(text),
      text,
      ancestry: record?.content?.ancestry ?? UNKNOWN_ANCESTRY,
    })
  }
  // ONE PER LANE, THE NEWEST: the same rule the read view applies, over the queue's own material.
  const newest = newestPerLane(laneSummaries)
  if (newest.length === 0) return { staged: false, reason: 'nothing-to-consolidate', unreadableRows }
  const digest = buildCoreDigest({ laneSummaries: newest, declined })
  if (digest.core.observations.length === 0) {
    // EVERY LANE UNKNOWN OR EVERY CLAIM EMPTY: a record about nothing is a record a reviewer has to read to learn
    // nothing, and staging it would make the queue longer without making the organism's state any clearer.
    return { staged: false, reason: 'no-observations', digest, laneCount: newest.length, unreadableRows }
  }
  const declinedDigests = Object.freeze(declined.map(one => one.digest))
  const outcome = stageCoreDigest(queue, digest, {
    subject: options.subject,
    privacy: options.privacy,
    now: options.now,
    declinedDigests,
  })
  return Object.freeze({ ...outcome, digest, laneCount: newest.length, declinedDigests, unreadableRows })
}
