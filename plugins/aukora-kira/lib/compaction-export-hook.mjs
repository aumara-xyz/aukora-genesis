/**
 * THE COMPACTION-EXPORT HOOK — the thin wiring around `compaction-export.mjs`'s pure decisions.
 *
 * WHERE THE PATTERN COMES FROM. `registerAutoStage` in this package already listens on a real event, and
 * every rule it learned the hard way applies here: a listener body wrapped so that its ONLY outlet is
 * `ctx.logger?.warn?.`, because a staging fault must cost a record and never a session; and the reader
 * service read through a NON-THROWING accessor on every use rather than declared in `inject`, because
 * Cordis holds a fiber inactive until every injected name exists — declaring `sessionQuery` would make a
 * deployment without the overlay fail to boot instead of simply staging nothing.
 *
 * THE LISTENER IS GLOBAL, LIKE THE FACE'S. `ctx.on('session/event', handler, { global: true })` sees every
 * session's events, not only this fiber's — which is the point: the lanes are separate sessions and the
 * brain is shared. So the handler must never assume the event belongs to "its" session; the record cites
 * the event's OWN sessionId, and a foreign session's event stages exactly one entry, for that session.
 *
 * NOTHING HERE WRITES MEMORY. One `enqueuePending` call per manual compaction, and — when a lane already
 * has a pending summary — one `writeDeclined` on the older proposal. `writeDeclined` writes the store's
 * existing decline document for that content; the queue entry file is never touched, so the older summary
 * READS as declined and is not deleted. There is no settle path here and none is imported.
 *
 * @module @aukora/dsh-plugin-kira/compaction-export-hook
 */
import { COMPACTION_SUMMARY_EVENT, laneOfSessionRecord, planStages } from './compaction-export.mjs'
import { consolidateQueue } from './consolidate.mjs'

/** The service that reads session logs. Read via a non-throwing accessor; NEVER declared in `inject`. */
export const COMPACTION_READER_SERVICE = 'sessionQuery'

/** Event types that carry a compaction summary, across the spellings the surface uses. */
const SUMMARY_EVENT_TYPES = new Set([COMPACTION_SUMMARY_EVENT, 'compaction.summary'])

/** The type of one session event, whichever spelling it arrives under. */
export function eventTypeOf(event) {
  const value = event?.type ?? event?.name ?? event?.kind
  return typeof value === 'string' ? value : null
}

/** Whether one event is a compaction summary at all. */
export const isCompactionSummary = event => SUMMARY_EVENT_TYPES.has(eventTypeOf(event) ?? '')

/** The payload of a compaction summary event. */
export const payloadOf = event => (event?.data ?? event) ?? null

/**
 * The lane of the session an event came from, or null. Non-throwing: an absent reader, an absent session
 * or an unreadable record all mean "unresolved", which the caller refuses BY NAME rather than guessing.
 * @param {unknown} reader @param {string|null} sessionId
 * @returns {string|null}
 */
/**
 * Read the reflection service, or `null` when it is absent. AN ABSENT SERVICE IS NOT A FAULT; A THROWING READ IS.
 * The difference is the whole point of this function existing outside the caller: the old closure returned `null` for
 * both, so a defect looked exactly like an empty store.
 * @param {unknown} ctx
 * @returns {unknown}
 */
export function readReflectFor(ctx) {
  const holder = /** @type {{reflect?: {get?: Function}, get?: Function}} */ (ctx)
  if (holder?.reflect?.get === undefined) return null
  try {
    return holder.reflect.get(COMPACTION_READER_SERVICE, false) ?? null
  } catch (error) {
    const logger = /** @type {{warn?: Function}} */ (holder)?.logger
    logger?.warn?.(`compaction-export: reflect-reader-fault ${String(error?.message ?? error)}`)
    return null
  }
}

export function laneForSession(reader, sessionId) {
  if (reader === undefined || reader === null || typeof sessionId !== 'string') return null
  for (const method of ['readSurface', 'read', 'get', 'readSession']) {
    const fn = /** @type {Record<string, unknown>} */ (reader)[method]
    if (typeof fn !== 'function') continue
    try {
      const record = /** @type {(id: string) => unknown} */ (fn).call(reader, sessionId)
      const lane = laneOfSessionRecord(record)
      if (lane !== null) return lane
    } catch { /* try the next spelling; an unreadable record is an unresolved lane */ }
  }
  return null
}

/**
 * The recall record ids injected inside a shadowed range, or 'unknown'.
 *
 * `'unknown'` is a NAMED value rather than an empty list, because "no records were injected" and "this
 * deployment could not tell me" are different facts and a reader must be able to see which one they have.
 * @param {unknown} reader @param {string|null} sessionId
 * @param {{start: number, end: number}} range
 * @param {(event: unknown) => {recordId?: unknown, seq?: unknown}[]} [recallIdsOf]
 */
export function ancestryWithin(reader, sessionId, range, recallIdsOf) {
  if (typeof recallIdsOf !== 'function' || reader === null || typeof sessionId !== 'string') return 'unknown'
  for (const method of ['readSurface', 'read', 'get', 'readSession']) {
    const fn = /** @type {Record<string, unknown>} */ (reader)[method]
    if (typeof fn !== 'function') continue
    try {
      const surface = /** @type {(id: string) => unknown} */ (fn).call(reader, sessionId)
      const events = Array.isArray(surface) ? surface : (/** @type {{events?: unknown[]}} */ (surface)?.events ?? [])
      const ids = []
      for (const event of events) {
        for (const hit of recallIdsOf(event)) {
          const seq = Number(hit?.seq)
          const recordId = hit?.recordId
          if (Number.isFinite(seq) && seq >= range.start && seq <= range.end && typeof recordId === 'string') {
            ids.push(recordId)
          }
        }
      }
      return ids.length === 0 ? [] : [...new Set(ids)]
    } catch { /* fall through to the next spelling */ }
  }
  return 'unknown'
}

/**
 * Register the compaction export on one Cordis context. ONE registration, ONE listener, one queue.
 *
 * @param {object} ctx - a cordis Context
 * @param {{queue: {enqueuePending: Function, list: Function, writeDeclined?: Function},
 *          makeReadOwnerPolicy?: () => Promise<{subject?: string, permittedPrivacy?: string[]}>,
 *          describe?: () => Promise<unknown>, now?: () => string, logger?: {warn?: Function},
 *          optedOut?: readonly string[]}} deps
 * @returns {void}
 */
export function registerCompactionExport(ctx, deps) {
  const { queue, logger } = deps
  if (queue === undefined || typeof queue.enqueuePending !== 'function') return
  const now = deps.now ?? (() => new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z'))
  // THE IDS ALREADY STAGED, REMEMBERED ACROSS EVENTS. `planStages` dedupes within one call; a caller that
  // fires one event at a time — which is what an event listener does — needs the memory to live out here,
  // or the same compaction becomes a second proposal for the reviewer to decline twice. MEASURED: without
  // this, the duplicate arm staged two entries and the court caught it.
  const stagedCompactionIds = new Set()
  // THE PROPOSAL IS REMEMBERED, BECAUSE THE QUEUE ENTRY DOES NOT CARRY ONE. MEASURED: a queue entry holds
  // `{version, recordId, subject, kind, createdAt, privacy, record}` — no memoryPut — so reading one back to
  // decline it passed `undefined` into `writeDeclined`, which threw inside a catch that treated the failure as
  // best-effort. The decline was therefore a SILENT NO-OP and the older summary stayed pending. What is needed
  // is the proposal this process staged, which it has at the moment it stages it.
  const stagedProposalByRecord = new Map()
  const readEntry = (recordId) => {
    try { return typeof queue.read === 'function' ? queue.read(recordId)?.entry : undefined } catch { return undefined }
  }
  // ONE IMPLEMENTATION, EXPORTED, BECAUSE A SECOND CALL SITE ALREADY DRIFTED INTO CALLING A NAME THAT DID NOT EXIST.
  // `lib/index.js:455` called `readReflect()` — this closure, which was never in its scope — so the recall-injection
  // hook threw a ReferenceError on every turn and resolved NO lane, while this file's `catch` made the failure
  // invisible. MEASURED 2026-09-26 by Fable's claims audit; the live bug, not a test finding.
  const readReflect = () => readReflectFor(ctx)
  ctx.on('session/event', async (session, event) => {
    try {
      if (!isCompactionSummary(event)) return
      const payload = payloadOf(event)
      if (payload === null || typeof payload !== 'object') return
      const sessionId = typeof session?.id === 'string' ? session.id : null
      const reader = readReflect()
      const lane = laneForSession(reader, sessionId)
      if (lane === null) {
        // REFUSED BY NAME, NOT STAGED UNDER A GUESS: a summary filed against the wrong lane is worse than
        // one never filed, because the wrong lane will be seeded from it.
        logger?.warn?.(`compaction-export: lane-unresolved for session ${String(sessionId)}; nothing staged`)
        return
      }
      const range = payload.shadowedRange
      const ancestry = range === null || typeof range !== 'object'
        ? 'unknown'
        : ancestryWithin(reader, sessionId, { start: Number(range.start), end: Number(range.end) }, deps.recallIdsOf)
      // THE ROWS ARE PRESENTATION ROWS. MEASURED: `listPending()` returns
      // `{dir, exists, total, returned, pending, truncated, entries}` where each entry is
      // `{state, settled, declined, recordId, kind, createdAt, privacy, text, …}` — it carries NO record and
      // NO memoryPut. A reader that assumed `entry.record` read `undefined` and would have concluded that no
      // lane has a pending summary, which is exactly the shape of bug that silently produces duplicates. The
      // full entry is fetched by id through `readPending`, which is the door the owner provides for it.
      const rows = (() => { try { return queue.list()?.entries ?? [] } catch { return [] } })()
      const pendingByLane = {}
      for (const row of rows) {
        if (row?.state !== 'pending' || typeof row?.recordId !== 'string') continue
        const entry = readEntry(row.recordId)
        const rowLane = entry?.record?.content?.thread?.lane
        if (typeof rowLane === 'string' && pendingByLane[rowLane] === undefined) pendingByLane[rowLane] = row.recordId
      }
      // THE SUBJECT AND PRIVACY COME FROM THE READ OWNER, re-read here rather than captured at apply
      // time, so a policy change is picked up without a remount and this module can never widen either.
      const policy = typeof deps.readOwnerPolicy === 'function' ? await deps.readOwnerPolicy() : {}
      const plan = planStages([event], {
        // THE PROHIBITION'S CONFIGURATION TRAVELS WITH THE DEPENDENCIES. Without this line the candidate fell
        // back to the module's shipped EMPTY digest list, which after finding 1 REFUSES EVERYTHING — a hook
        // that silently exported nothing, which is safe and useless in equal measure. It is forwarded so the
        // caller decides, and so a court can drive both states.
        forbiddenWindowDigests: deps.forbiddenWindowDigests,
        lane,
        sessionId,
        ancestry,
        now: now(),
        optedOut: deps.optedOut,
        pendingByLane,
        stagedCompactionIds: [...stagedCompactionIds],
        subject: policy?.subject,
        privacy: Array.isArray(policy?.permittedPrivacy) && policy.permittedPrivacy.includes('local')
          ? 'local'
          : policy?.permittedPrivacy?.[0],
      })
      for (const refusal of plan.refusals) {
        logger?.warn?.(`compaction-export: ${refusal.reason} — ${refusal.detail}`)
      }
      for (const stage of plan.stages) {
        queue.enqueuePending({ recordId: stage.recordId, record: stage.record, memoryPut: stage.memoryPut })
        if (typeof stage.compactionId === 'string') stagedCompactionIds.add(stage.compactionId)
        stagedProposalByRecord.set(stage.recordId, stage.memoryPut)
      }
      // THE OLDER SUMMARY IS DECLINED, NEVER DELETED. The decline document is the store's own record of a
      // decision about those bytes; the queue entry stays where it is, so the history of what was proposed
      // survives the decision.
      for (const recordId of plan.declines) {
        const proposal = stagedProposalByRecord.get(recordId)
        if (proposal === undefined || typeof queue.writeDeclined !== 'function') {
          // NOT SILENT. A decline that cannot be written leaves a lane with TWO open proposals, and this is
          // the one place that knows it; the older summary stays pending and the log says why.
          logger?.warn?.(`compaction-export: could not decline ${recordId} — no proposal was staged by this process`)
          continue
        }
        try {
          queue.writeDeclined(proposal)
          stagedProposalByRecord.delete(recordId)
        } catch (error) {
          logger?.warn?.(`compaction-export: the decline of ${recordId} was refused (${error?.message ?? 'unknown'})`)
        }
      }
      // CONSOLIDATION IS PART OF THE EXPORT, NOT A VIEW APART (kira-102, item 1). Until this ran, a manual
      // compaction staged lane summaries and NOTHING consolidated them: `consolidate.mjs` was imported only by its
      // own court, so the organism's conclusion existed as a read view assembled elsewhere and never as a
      // proposal. It goes through the SAME queue and the same `enqueuePending` door as everything else — one
      // inert record, no settle path — and it runs last so the digest describes the queue as it now stands.
      if (plan.stages.length > 0) {
        const consolidation = consolidateQueue(queue, {
          subject: policy?.subject,
          privacy: Array.isArray(policy?.permittedPrivacy) && policy.permittedPrivacy.includes('local')
            ? 'local'
            : policy?.permittedPrivacy?.[0],
          now: now(),
        })
        if (consolidation.staged === true) {
          // REMEMBERED FOR THE SAME REASON THE SUMMARIES ARE: a queue entry carries no memoryPut, so a later
          // decline of this proposal needs the one this process staged.
          stagedProposalByRecord.set(consolidation.recordId, consolidation.memoryPut)
        } else if (consolidation.reason !== 'nothing-to-consolidate' && consolidation.reason !== 'no-observations') {
          // A REFUSAL IS REPORTED, A SKIP IS NOT: "no lane has said anything countable yet" is the normal state of
          // a fresh store and warning about it every compaction would train a reader to ignore this line.
          logger?.warn?.(`compaction-export: consolidation refused — ${String(consolidation.reason)}`)
        }
      }
    } catch (error) {
      // A STAGING FAULT COSTS A RECORD, NEVER A SESSION. This is the whole reason the body is guarded.
      logger?.warn?.(`compaction-export: refused to stage (${error?.message ?? 'unknown'})`)
    }
  }, { global: true })
}
