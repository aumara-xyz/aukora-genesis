/**
 * AUTO-STAGING AT `agent/turn-stopping` — the wiring that feeds `autostage.mjs` from a real turn.
 *
 * WHERE THE PATTERN COMES FROM, AND WHY IT IS COPIED RATHER THAN IMPORTED. `plugins/aukora-board`
 * already runs a digest listener on this exact event, and this module follows it deliberately: the
 * event is a SERIAL dispatch, so the handler takes ONE parameter and calls no `next`. That is not
 * style. The board's own comment records the measurement — a handler that mirrored the pre-step
 * waterfall shape called `await next()`, `next` was `undefined`, the call threw, and EVERY TURN DIED
 * (`dsh: UNKNOWN: next is not a function`, exit 1, on a boot that exits 0 with the rows removed).
 * A handler on this event therefore has no return value, no `next`, and its whole body inside a guard
 * whose only outlet is `ctx.logger?.warn?.`: a staging fault must cost a record, never a turn.
 *
 * The board's helpers are NOT imported, because this package's write boundary admits only `./`
 * siblings plus `node:crypto`/`node:util`, and a cross-plugin import would be refused by the boundary
 * court rather than by review. The three predicates that matter are re-expressed below, and each one
 * carries the shape it was measured against so the next reader can check them rather than trust them.
 *
 * THE READER IS READ, NEVER INJECTED. `sessionQuery` arrives from a per-deployment overlay, not from
 * the release's own composition. Cordis treats every name in `inject` as REQUIRED — `Fiber._refresh`
 * holds the fiber inactive until each one is in the store — so declaring it would make a deployment
 * without the overlay fail to boot rather than simply stage nothing. It is read through the
 * non-throwing accessor on every use, because a composition may provide the service AFTER this plugin
 * loads and a value captured at apply time would disable staging forever.
 *
 * WHAT IT STAGES, AND WHAT IT REFUSES TO. Only the turn's own real ask, which is the only text here a
 * person wrote. Our own recall injection and the board's status block are `user/message` events too,
 * and selecting by role alone would stage this deployment's own output back into memory as though
 * someone had asked for it — so a message counts only when its source says a user wrote it.
 *
 * @module @aukora/dsh-plugin-kira/autostage-hook
 */
import { mayStageForTurn, turnKey } from './autostage.mjs'

/** The service that reads session logs. Read via the non-throwing accessor; NEVER declared in `inject`. */
export const AUTOSTAGE_READER_SERVICE = 'sessionQuery'

/** Bound on one session read, so a slow log cannot hold a turn open. ENFORCED below, not merely declared. */
export const AUTOSTAGE_READ_TIMEOUT_MS = 2000

/**
 * Await one read, but never past the bound.
 *
 * A DECLARED BOUND THAT IS NOT APPLIED IS A CLAIM, NOT A LIMIT. `readSurface` takes no signal — the
 * board calls it with the id alone — so the bound has to be a race rather than an argument, and the
 * timer is cleared in `finally` so a fast read leaves nothing behind to hold the process open.
 * @template T
 * @param {Promise<T>} promise @param {number} ms @returns {Promise<T>}
 */
async function readWithin(promise, ms) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('auto-stage read timed out')), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Most characters of the turn's own text a digest may carry. */
export const MAX_ASK_CHARS = 400

/**
 * The session id out of the live agent. MEASURED: the scoped-events table maps
 * `agent/turn-stopping` to `args[0].agent`, and the agent carries its session.
 * @param {unknown} agent @returns {string|null}
 */
export function sessionIdOfAgent(agent) {
  const session = /** @type {{session?: {id?: unknown}}} */ (agent)?.session
  return typeof session?.id === 'string' ? session.id : null
}

/**
 * The session id out of one reader record. MEASURED: `SessionRecord` is
 * `{header, live, persisted}` and the header carries `id` (with `sessionId` accepted as the second
 * spelling, because an absent one must be an absent entry rather than a crash).
 * @param {unknown} record @returns {string|null}
 */
export function sessionIdOfRecord(record) {
  const header = /** @type {{header?: {id?: unknown, sessionId?: unknown}}} */ (record)?.header
  if (typeof header?.id === 'string') return header.id
  if (typeof header?.sessionId === 'string') return header.sessionId
  return null
}

/**
 * The text of one surface event. MEASURED: `user/message` carries `data.content`, while
 * `assistant/message` and `system/message` carry `data.message.content`; both are either a string or
 * an array of parts with a `text` field.
 * @param {unknown} event @returns {string}
 */
export function eventText(event) {
  const data = /** @type {{data?: {content?: unknown, message?: {content?: unknown}}}} */ (event)?.data
  const content = data?.content ?? data?.message?.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content.map(part => (typeof part?.text === 'string' ? part.text : '')).join(' ').trim()
}

/**
 * Whether one surface event is a PERSON speaking — the predicate that keeps our own injection out.
 *
 * MEASURED: the surface carries three kinds of `user/message` — the real ask (`source.kind ===
 * 'user'`), the harness's system prompt (`source.kind === 'plugin'`), and this deployment's own Kira
 * recall block (also `source.kind === 'plugin'`). Selecting by role alone therefore stages our own
 * output as though a person had asked for it.
 * @param {unknown} event @returns {boolean}
 */
export function isRealAsk(event) {
  const source = /** @type {{data?: {source?: {kind?: unknown}}}} */ (event)?.data?.source
  if (!(/** @type {{type?: unknown}} */ (event)?.type === 'user/message' && source?.kind === 'user')) return false
  // **STRUCTURAL FIRST, TEXT SECOND, AND THE ORDER MATTERS.**
  //
  // *The harness stamps `source.kind: 'user'` on a lane-door message too.* **WHAT TELLS THEM APART IS `source.rpcId`:**
  // the app's `session/prompt` (vendor/dsh `api/session-controller/src/commands.ts:329`) stamps the request id the door
  // sent as `source.rpcId`, the door records that id via `recordLaneDoorMessage`, and the `user/message` event carries
  // `source`. (CORRECTED 2026-09-27: this used to match `data.id` against a `messageId` the app never returns; that reply
  // is the SDK server's, `sdk/server/src/server.ts:192`, so the set stayed empty.)
  //
  // **THE PREFIX REMAINS BECAUSE THE ID SET CAN BE EMPTY FOR A GOOD REASON:** a session from before the door recorded
  // ids, or a hook that never called `setLaneDoorMessageIds`. *Falling back to the text is worse than the id and far
  // better than remembering a lane's orchestration as Peter's own.*
  const rpcId = String(/** @type {{data?: {source?: {rpcId?: unknown}}}} */ (event)?.data?.source?.rpcId ?? '')
  if (laneDoorMessageIds !== null && rpcId !== '' && laneDoorMessageIds.has(rpcId)) return false
  return !LANE_DOOR_MARKER.test(messageText(event).trimStart())
}

/**
 * **THE IDS THE LANE DOOR CAUSED**, as the hooks learned them.
 *
 * *`null` MEANS "NOT LOADED"*, and it falls through to the prefix exactly as an empty set does — *kept distinct because a
 * caller that loaded a file and found nothing should be able to say which of the two it is.*
 * @type {Set<string> | null}
 */
let laneDoorMessageIds = null

/**
 * **TELL THE PREDICATE WHICH MESSAGES THE DOOR CAUSED.**
 *
 * *Called by whoever holds the state root*, because the ids live in a file the door writes and this module reads no
 * configuration of its own. **A hook that never calls this keeps the prefix check**, so this is additive rather than a new
 * requirement on every caller.
 * @param {Set<string> | null} ids
 */
export function setLaneDoorMessageIds(ids) {
  laneDoorMessageIds = ids instanceof Set ? ids : null
}

/** The marker the lane door puts on every message it sends into a session. */
export const LANE_DOOR_PREFIX = '[fable via lane door]'
/** Every lane's marker: the door writes `[<lane> via lane door]` (apps/aukora-desktop/lane-door.mjs), not only fable's. */
export const LANE_DOOR_MARKER = /^\[[A-Za-z0-9_-]{1,40} via lane door\]/u

/** @param {unknown} event @returns {string} the message's text, whether its content is a string or a list of parts. */
function messageText(event) {
  const content = /** @type {{data?: {content?: unknown}}} */ (event)?.data?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(part => (typeof part === 'string' ? part : String(part?.text ?? ''))).join('')
  return ''
}

/**
 * The last thing a person actually asked, from the surface events.
 *
 * SESSION-LEVEL, NOT TURN-SCOPED, AND THAT IS A MEASURED LIMIT RATHER THAN AN OVERSIGHT. The surface's
 * `user/message` disposition is `['role', 'id', 'content', 'source']` — there is NO turn field on it,
 * so a message cannot be attributed to the turn that is stopping. The caller therefore dedupes on the
 * ask's own text; see `registerAutoStage`.
 * @param {unknown[]} surfaceEvents @returns {string}
 */
export function lastRealAsk(surfaceEvents) {
  const events = Array.isArray(surfaceEvents) ? surfaceEvents : []
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (isRealAsk(events[index])) return eventText(events[index])
  }
  return ''
}

/**
 * One canonical seconds-precision UTC instant.
 *
 * `toISOString()` alone emits milliseconds, and the record contract REFUSES that form
 * (`created-at-invalid`), so a digest built from a bare `toISOString()` would fail at staging on every
 * turn while looking correct. The board strips the same three digits for the same reason.
 * @param {Date} date @returns {string}
 */
export function canonicalInstant(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/**
 * Subscribe auto-staging to the turn-stopping event.
 *
 * FAILURES ARE CONTAINED, AND THE CONTAINMENT IS THE POINT: this listener cannot fail a turn, cannot
 * throw out of its guard, and cannot return anything the harness would act on. Everything that can go
 * wrong — no reader, no record, a read fault, a malformed digest, a queue that refuses — ends in a
 * logged note and a turn that finishes exactly as it would have.
 *
 * ONE TURN, ONE RECORD, AND NEVER THE SAME ASK TWICE. Two guards, for two different failures:
 *   `stagedTurns` keys on `sessionId\u0000turn`, so a re-fired turn cannot stage twice;
 *   `seenAsk` remembers the last ask per session, because the surface cannot attribute an ask to a
 *     turn — without it, a turn that said nothing new would re-stage the previous turn's preference
 *     under a new `createdAt`, producing a second record that is the first one wearing a new name.
 *
 * @param {Record<string, unknown>} ctx - the Cordis context.
 * @param {object} options
 * @param {(digest: Readonly<Record<string, unknown>>) => Promise<Readonly<{staged: boolean, reason?: string, recordId?: string, category?: string}>>} options.stageFromDigest - performs the staging; holds the only filesystem route.
 * @param {() => Date} [options.now] - clock, injectable so a court is deterministic.
 * @param {(info: Readonly<Record<string, unknown>>) => void} [options.onStaged] - observation hook.
 * @param {(reason: string) => void} [options.onSkipped] - observation hook.
 * @param {{warn?: (message: string) => void}} [options.logger] - the harness logger, when there is one.
 * @returns {() => void} a disposer.
 */
export function registerAutoStage(ctx, { stageFromDigest, now, onStaged, onSkipped, logger } = {}) {
  if (ctx === undefined || typeof ctx.on !== 'function') return () => {}
  if (typeof stageFromDigest !== 'function') return () => {}
  const clock = now ?? (() => new Date())
  const staged = onStaged ?? (() => {})
  const skipped = onSkipped ?? (() => {})

  /** Turn keys this session has already staged. */
  const stagedTurns = new Set()
  /** The last ask seen per session, so a `createdAt` change cannot manufacture a duplicate. */
  const seenAsk = new Map()

  /** The reader, or undefined when this composition does not provide one. Never cached. */
  const readerOf = () => {
    const reflect = /** @type {{reflect?: {get?: (name: string, required: boolean) => unknown}}} */ (ctx).reflect
    if (reflect === undefined || typeof reflect.get !== 'function') return undefined
    return reflect.get(AUTOSTAGE_READER_SERVICE, false)
  }

  return ctx.on('agent/turn-stopping', async (payload) => {
    // ONE PARAMETER, NO `next`, NO RETURN VALUE, EVERYTHING INSIDE THE GUARD.
    try {
      const agent = /** @type {{agent?: unknown}} */ (payload)?.agent
      const sessionId = sessionIdOfAgent(agent)
      if (sessionId === null) { skipped('no-session'); return }
      const turn = Number.isInteger(/** @type {{turn?: unknown}} */ (payload)?.turn)
        ? /** @type {number} */ (/** @type {{turn?: unknown}} */ (payload).turn)
        : null
      if (turn === null) { skipped('no-turn'); return }
      if (!mayStageForTurn(stagedTurns, sessionId, turn)) { skipped('turn-already-staged'); return }

      const reader = readerOf()
      if (reader === undefined) { skipped('no-reader'); return }

      const records = await readWithin(reader.listSessions(), AUTOSTAGE_READ_TIMEOUT_MS)
      const record = (Array.isArray(records) ? records : [])
        .find(candidate => sessionIdOfRecord(candidate) === sessionId)
      if (record === undefined) { skipped('session-not-found'); return }

      const surface = await readWithin(reader.readSurface(sessionId), AUTOSTAGE_READ_TIMEOUT_MS)
      const ask = lastRealAsk(surface?.events).slice(0, MAX_ASK_CHARS)
      // AN ABSENT ASK IS THE COMMON CASE, NOT A FAULT: most turns close without saying anything a
      // person would want kept, and that must be silent rather than an error.
      if (ask === '') { skipped('nothing-said'); return }
      if (seenAsk.get(sessionId) === ask) { skipped('ask-unchanged'); return }

      const result = await stageFromDigest({
        sessionId,
        turn,
        ask,
        // False BY CONSTRUCTION: the ask above is the last message whose source says a user wrote it,
        // so our own injection can never reach this field. It is passed explicitly rather than omitted
        // so a reader can see the decision instead of inferring it.
        injected: false,
        at: canonicalInstant(clock()),
      })

      if (result?.staged === true) {
        // Marked seen ONLY after the attempt returned: a throw (an unwritable queue) must leave the ask
        // unmarked so the next turn can try again rather than silently losing the record.
        seenAsk.set(sessionId, ask)
        stagedTurns.add(turnKey(sessionId, turn))
        staged({ sessionId, turn, recordId: result.recordId, category: result.category, queueState: result.queueState })
      } else {
        // A CLASSIFIER MISS IS REMEMBERED TOO, so an unremarkable ask is not re-evaluated on every
        // later turn. The record is not lost — `kira_stage` remains for anything this misses by design.
        seenAsk.set(sessionId, ask)
        skipped(result?.reason ?? 'not-staged')
      }
    } catch (error) {
      // THE ONLY OUTLET. A staging fault costs a record; it must never cost the turn.
      const note = `aukora-kira: auto-stage skipped (${error?.message ?? String(error)})`
      if (typeof logger?.warn === 'function') logger.warn(note)
      skipped('fault')
    }
  }, { prepend: true })
}
