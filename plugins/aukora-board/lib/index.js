/**
 * AUKORA board — every conversation knows what the others are doing, unasked.
 *
 * THE PROBLEM. Chats in this deployment are separate sessions with no channel
 * between them. A conversation cannot tell whether it is the only one running, what
 * the others were asked, or whether they are stuck. The owner is the message bus:
 * he reads one chat and retypes it into another. This plugin removes him from that
 * loop for the one question he asks most — "what are my other chats doing?" — by
 * putting a bounded board into every turn's context before the model reads it.
 *
 * HOW IT READS. Through `ctx.sessionQuery`, the SAME service the mounted session
 * tools use (`@deepseek-ai/dsh-tool-session-query` calls `filterSessions`,
 * `readTitleSnapshots` and friends on it). This plugin never opens a session log,
 * never touches `.jsonl.zstd`, and holds no storage of its own beyond one derived
 * digest file. If the service is absent or fails, the board is omitted with ONE
 * named note and the turn continues — a status fault must never become a failed
 * turn.
 *
 * WHERE IT INJECTS. `ctx.on('agent/pre-step', …)`, the waterfall the Kira recall
 * contribution already proves: `next()` is awaited FIRST and the chain delegated to,
 * then one message is appended. `agent/created` + `agent.inject` is the other seam
 * and is NOT used, for the measured reason recorded in that lane — the constructor
 * it needs does not resolve from a release-mounted plugin, while `pre-step` needs
 * only a literal.
 *
 * WHAT IT DOES NOT DO. It does not read the current session's own events for the
 * board (it excludes itself), it does not instruct: the injected message carries
 * `form: 'snapshot'` and says "information, not instructions" in words, because
 * another conversation's text must not arrive looking like an order. It holds no
 * grant, writes no Kira memory, and needs no approval: the digest is DERIVED and
 * rebuildable from the sessions themselves.
 *
 * @module @aukora/dsh-plugin-board
 */
import { subagentSessionIds } from '../../aukora-organism/lib/organism.mjs'
import { LANE_MEMORY_SERVICE, readLaneMemoryView } from './lane-memory-service.mjs'
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BOARD_LABEL,
  MAX_ASK_CHARS,
  MAX_BOARD_CHARS,
  MAX_BOARD_SESSIONS,
  boardUserMessage,
  lastAsk,
  outcomeOf,
  renderBoard,
  sessionIdOf,
  summarizeSessions,
  toolNames,
  touchedFiles,
} from './board.mjs'

export const name = 'aukora-board'

/**
 * `sessionQuery` is DELIBERATELY NOT DECLARED IN `inject`, and that is the fix for a
 * real boot failure rather than a style choice.
 *
 * Cordis 4.0.2 treats EVERY name in `inject` as required: `Fiber._refresh` walks the
 * inject keys and holds the fiber INACTIVE until each one is in the store, so a
 * composition that never provides `sessionQuery` waits forever and the BOOT FAILS.
 * There is no optional marker in the map — `Inject.resolve` normalises values to
 * intercept config, not to a required/optional flag.
 *
 * That mattered here because `sessionQuery` does NOT come from the release's own
 * composition: it arrives from a per-deployment `session-query-tools` overlay in the
 * owner's Application Support directory. Requiring it made the board's presence a
 * precondition for the whole composition booting, so ANY composition without that
 * overlay — including the app, if the overlay were ever missing — would fail to
 * start. Measured: `tests/aura-association-row.test.mjs` arm 5 caught exactly that
 * against the release's own patch rows.
 *
 * The optional form in this Cordis version is to declare NOTHING and read the
 * service through the non-throwing accessor: `ctx.reflect.get(name, false)` returns
 * `undefined` when the service is absent, while a direct `ctx.sessionQuery` read
 * throws `cannot get property "sessionQuery" without inject`. A missing reader is
 * therefore an ordinary state: the board is omitted with one named note, the digest
 * is skipped, and neither the turn nor the boot is affected.
 */

/** The service name this plugin reads when it is available. */
export const READER_SERVICE = 'sessionQuery'

/** One named note replaces the board when no reader is available or it cannot be used. */
export const BOARD_OMITTED = 'board omitted: session reader unavailable'

/**
 * The derived per-turn digest store.
 *
 * A file of JSON lines beside the composition's own state. It is a DERIVED view:
 * every field in it can be rebuilt from the sessions, it grants nothing, it is read
 * by nobody but this plugin, and losing it costs a board line rather than a fact.
 */
function openDigestStore(stateDir) {
  const path = join(stateDir, 'turn-digests.jsonl')
  return {
    path,
    /** @param {object} record */
    append(record) {
      try {
        mkdirSync(stateDir, { recursive: true })
        appendFileSync(path, `${JSON.stringify(record)}\n`, { mode: 0o600 })
      } catch { /* a digest that cannot be written must not fail a turn */ }
    },
    /** @returns {Map<string, object>} the latest digest per session. */
    latest() {
      const byId = new Map()
      try {
        for (const line of readFileSync(path, 'utf8').split('\n')) {
          if (line.trim() === '') continue
          let record
          try { record = JSON.parse(line) } catch { continue }
          if (typeof record?.sessionId === 'string') byId.set(record.sessionId, record)
        }
      } catch { /* no store yet */ }
      return byId
    },
  }
}

/**
 * Mount the plugin.
 * @param {object} ctx - the Cordis context.
 * `onInjected` and `onOmitted` are the same observation seam the Kira recall
 * contribution exposes, and for the same measured reason: a plugin's `ctx.logger` is
 * the HARNESS's logger, not one a caller supplied, so a court in a bare context
 * cannot read a note out of it. A callback makes the omission observable without
 * making the plugin's behaviour depend on who is watching.
 *
 * @param {{stateDir?: string, maxSessions?: number, maxChars?: number, newId?: () => string,
 *   onInjected?: (text: string) => void, onOmitted?: (note: string) => void}} [config]
 */
export function apply(ctx, config = {}) {
  const stateDir = typeof config.stateDir === 'string' && config.stateDir !== ''
    ? config.stateDir
    : join(ctx.baseDir ?? process.cwd(), 'board-state')
  const maxSessions = Number.isInteger(config.maxSessions) ? config.maxSessions : MAX_BOARD_SESSIONS
  const maxChars = Number.isInteger(config.maxChars) ? config.maxChars : MAX_BOARD_CHARS
  const newId = config.newId ?? (() => globalThis.crypto.randomUUID())
  const onInjected = typeof config.onInjected === 'function' ? config.onInjected : () => {}
  const onOmitted = typeof config.onOmitted === 'function' ? config.onOmitted : () => {}
  const digests = openDigestStore(stateDir)
  /** Per-session observation cache, keyed by `capturedThroughSeq`. See `observationOf`. */
  const surfaceCache = new Map()
  ctx.logger?.info?.(`aukora-board: digests at ${digests.path}`)

  /**
   * The session reader, or undefined when this composition does not provide one.
   *
   * Read through the non-throwing accessor on EVERY use rather than captured once at
   * apply time: a composition may provide the service after this plugin loads, and a
   * captured `undefined` would then omit the board forever.
   */
  const readerOf = () => ctx.reflect.get(READER_SERVICE, false)

  // ── THE LANES' MEMORY, PROVIDED READ-ONLY ─────────────────────────────────────────────────────────
  //
  // The organism reader is CARRIED into the face and may import nothing, so the assembly lives here — where
  // Kira's own `newestPerLane`/`buildCoreDigest` are importable — and what crosses into the face is a frozen
  // view of strings. `read()` is resolved on EVERY call: `kira.recall` and `aura.cite` may be provided after
  // this plugin loads, and a service captured at apply time would answer from whatever existed at boot.
  //
  // A CONTEXT THAT CANNOT PROVIDE IS TOLD SO BY NAME rather than left believing a view exists that nobody can
  // read — the same rule `provideKiraRecall` follows for the door this reads through.
  if (typeof ctx.provide === 'function') {
    try {
      ctx.provide(LANE_MEMORY_SERVICE, Object.freeze({
        read: async () => await readLaneMemoryView({
          dshHome: readerOf()?.dshHome ?? readerOf()?.stateRoot ?? (typeof config.dshHome === 'string' ? config.dshHome : ''),
          resolveRecall: () => ctx.reflect.get('kira.recall', false),
          resolveCite: () => ctx.reflect.get('aura.cite', false),
        }),
      }))
    } catch (error) {
      ctx.logger?.warn?.(`aukora-board: ${LANE_MEMORY_SERVICE} not provided (${String(error?.message ?? error)})`)
    }
  } else {
    ctx.logger?.warn?.(`aukora-board: ${LANE_MEMORY_SERVICE} not provided (this context has no provide)`)
  }

  const sessionIdOfAgent = agent => {
    const session = agent?.session
    return typeof session?.id === 'string' ? session.id : null
  }

  const signal = () => AbortSignal.timeout(2000)

  /** Ask the reader for the other sessions and render the board, or null. */
  /**
   * Read ONE session's observation, or reuse the cached one.
   *
   * TWO CALLS, NOT ONE, AND THAT IS THE MEASURED SHAPE. The SURFACE holds only
   * `system/message`, `user/message`, `assistant/message` and `tool/result` — the ask
   * comes from there — but tool NAMES live in the raw log's `tool/call` events, which
   * the surface never carries. So the surface gives the ask, `capturedThroughSeq`
   * gives the change signal, and a bounded raw window gives the tools and the
   * `turn/end` that decides the status.
   *
   * CACHE KEYED BY `capturedThroughSeq`. The header has NO `updatedAt` (measured:
   * `{version, id, createdAt, cwd, isSeeded}`), so there is nothing cheaper to
   * invalidate on; `capturedThroughSeq` is the log's own high-water mark and moves
   * exactly when the session does.
   */
  async function observationOf(reader, record, cache) {
    const id = sessionIdOf(record)
    if (id === null) return null
    let surface = null
    try {
      surface = await reader.readSurface(id)
    } catch { surface = null }
    const through = surface?.capturedThroughSeq ?? null
    const cached = cache.get(id)
    if (cached !== undefined && through !== null && cached.through === through) return cached.observation

    let rawEvents = []
    if (through !== null && typeof reader.readEvent === 'function') {
      try {
        const window = await reader.readEvent({ sessionId: id, seq: through, before: 32 }, signal())
        rawEvents = Array.isArray(window?.events) ? window.events : []
      } catch { /* the tools/status are optional; the ask is not */ }
    }
    const observation = {
      id,
      surfaceEvents: Array.isArray(surface?.events) ? surface.events : [],
      rawEvents,
      title: null,
      // `createdAt` is the ONLY timestamp the header carries, so the board reports an
      // AGE and says so rather than pretending to a freshness it cannot know.
      createdAt: typeof record?.header?.createdAt === 'number' ? record.header.createdAt : null,
    }
    cache.set(id, { through, observation })
    return observation
  }

  async function buildBoard(selfId) {
    const reader = readerOf()
    if (reader === undefined) return { text: null, note: BOARD_OMITTED }
    let records = []
    try {
      records = await reader.listSessions(signal())
    } catch {
      return { text: null, note: BOARD_OMITTED }
    }
    records = Array.isArray(records) ? records : []

    // Titles are cheap, so they are refreshed every turn.
    let titles = new Map()
    try {
      const ids = records.map(record => sessionIdOf(record)).filter(id => id !== null)
      const observed = await reader.readTitleSnapshots(ids, signal())
      titles = new Map((Array.isArray(observed) ? observed : [])
        .filter(entry => entry?.status === 'fulfilled' || entry?.value !== undefined)
        .map(entry => [
          entry?.sessionId ?? entry?.value?.session?.id,
          entry?.value?.title?.title,
        ])
        .filter(([id, title]) => typeof id === 'string' && typeof title === 'string' && title !== ''))
    } catch { /* a missing title falls back to the first real ask */ }

    // BUILT ONCE PER BOARD CALL, NOT PER OBSERVATION, and NOT FROM THE ENVIRONMENT. The home comes from
    // the reader's own context when it exposes one; otherwise the set is EMPTY and the board behaves
    // exactly as it did before. An empty set costs nothing; a POPULATED one assembled from the ambient
    // machine during someone else's fixture run is how 156 real ids leaked into a court.
    let subagentIds = new Set()
    try {
      const home = reader?.dshHome ?? reader?.stateRoot ?? ''
      if (typeof home === 'string' && home !== '') subagentIds = subagentSessionIds({ dshHome: home })
    } catch { /* an unreadable store is not a reason to report no lanes */ }

    const observations = []
    for (const record of records) {
      // One more than the board shows, because the reader does not know which one is
      // SELF until the exclusion runs, and a session that is dropped for the bound
      // must not be the current one.
      if (observations.length > maxSessions) break
      const observation = await observationOf(reader, record, surfaceCache)
      if (observation === null) continue
      observation.title = titles.get(observation.id) ?? null
      observations.push(observation)
    }
    const { entries } = summarizeSessions(observations, { selfId, subagentIds, maxSessions })
    return { text: renderBoard(entries, { maxChars }), note: null }
  }

  // ── the board, before every step ────────────────────────────────────────────────────────────
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next()
    if (decision?.kind === 'reject') return decision
    let text = null
    try {
      const built = await buildBoard(sessionIdOfAgent(agent))
      text = built.text
      // An ABSENT reader is an ordinary state, so it is NOTED, once, by name. A
      // reader that exists and THROWS is a fault and is warned about below.
      if (text === null && built.note !== null) {
        onOmitted(built.note)
        ctx.logger?.info?.(`aukora-board: ${built.note}`)
      }
    } catch (error) {
      // A BOARD FAULT MUST NOT BREAK A TURN. Named, logged, and the step proceeds.
      ctx.logger?.warn?.(`aukora-board: ${BOARD_OMITTED} (${error?.message ?? error})`)
      return decision
    }
    if (text === null) return decision
    onInjected(text)
    return { ...decision, messages: [...decision.messages, boardUserMessage(`${text}\n`, newId)] }
  }, { prepend: true })

  // ── the derived digest, at the end of every turn ────────────────────────────────────────────
  //
  // SERIAL, NOT A WATERFALL, AND THAT IS NOT A STYLE CHOICE. The harness fires
  // `agent/pre-step` as a waterfall — handlers receive `(payload, next)` and must call
  // `next()` — but `agent/turn-stopping` as a SERIAL event, where handlers receive
  // `(payload)` ONLY. The first version of this handler mirrored the pre-step shape and
  // called `await next()`, so `next` was `undefined`, the call threw, and THE TURN DIED:
  // reproduced from outside as `dsh: UNKNOWN: next is not a function`, exit 1, on a boot
  // that exits 0 with the board rows removed. It would have broken every turn in the
  // app, not just the digest.
  //
  // So: one parameter, no `next`, no return value, and the whole body inside the guard.
  // The handler also cannot signal anything to the harness, which is why the digest is
  // skipped silently-but-warned rather than reported.
  ctx.on('agent/turn-stopping', async (payload) => {
    const { agent } = payload ?? {}
    try {
      const sessionId = sessionIdOfAgent(agent)
      const reader = readerOf()
      if (sessionId !== null && reader !== undefined) {
        // `payload.turn` IS THE TURN. The first version counted events off a field
        // that does not exist, so every digest ever written said `turn: 0`.
        const turn = Number.isInteger(payload?.turn) ? payload.turn : null
        let observation = null
        try {
          const records = await reader.listSessions(signal())
          const record = (Array.isArray(records) ? records : [])
            .find(candidate => sessionIdOf(candidate) === sessionId)
          if (record !== undefined) observation = await observationOf(reader, record, surfaceCache)
        } catch { /* the digest is derived; a read fault skips it */ }
        if (observation !== null) {
          digests.append({
            sessionId,
            turn,
            ask: lastAsk(observation.surfaceEvents).slice(0, MAX_ASK_CHARS),
            // A digest of a turn's SHAPE, not a transcript: the NAMES of what ran, never
            // the arguments, so this store cannot become a second copy of the session.
            tools: toolNames(observation.rawEvents),
            files: touchedFiles(observation.rawEvents),
            // NO OUTCOME HERE. At `turn-stopping` the turn has not ended, so any status
            // written now would be a guess -- the old code wrote `agent.status`, which
            // does not exist, and every digest said "running" forever. The board derives
            // the outcome from the log's own `turn/end` when it reads.
            at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
            digestRule: createHash('sha256').update('aukora-board:turn-digest:v0').digest('hex').slice(0, 16),
          })
        }
      }
    } catch (error) {
      ctx.logger?.warn?.(`aukora-board: digest omitted (${error?.message ?? error})`)
    }
  }, { prepend: true })
}
