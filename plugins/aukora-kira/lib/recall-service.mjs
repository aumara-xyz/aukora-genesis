/**
 * `kira.recall` — THE READ-ONLY DOOR ONTO KIRA'S MEMORY.
 *
 * WHAT THIS IS FOR. The memory is only a brain if something can ASK it. A reader that reaches the store
 * through a service sees exactly what the read owner chooses to show: the read owner already decides the
 * subject, the permitted privacy classes, and whether a damaged store reports `undetermined` rather than an
 * empty corpus — so this module adds no policy of its own and can widen nothing.
 *
 * WHY IT IMPORTS NOTHING. This is the whole safety property, and it is enforced by the shape of the file
 * rather than by review: **THERE IS NOT ONE IMPORT STATEMENT HERE.** A read service that could reach
 * `stageKiraMemoryRecord`, the pending queue, or any settle path is a write door wearing a read name, and the
 * cheapest way to make that impossible is to give it nothing to reach with. `the kira-dsh-assembly court under the tests directory`
 * asserts both halves: no imports at all, and no stage- or settle-named member on the provided object.
 *
 * WHAT IT EXPOSES, AND NOTHING ELSE:
 *   · `describe()` — the subject and the permitted privacy classes, as the read owner reports them.
 *   · `read()`     — the corpus, in the read owner's own vocabulary (`empty`/`undetermined`/match).
 *   · `recall(question)` — a thin, honest shaping of `read()`: it returns the records the store is willing to
 *     show, and it NEVER invents a result. No match is the store's answer, not an error to paper over.
 *
 * `provideKiraRecall` REFUSES TO MOUNT WITHOUT `ctx.provide`. A host context that cannot provide a service
 * must say so rather than appear to have mounted one — the same rule the Aumlok adapter follows, and the
 * reason the guard is here rather than in the caller.
 *
 * @module @aukora/dsh-plugin-kira/recall-service
 */

/** The service name a deployment reads Kira's memory through. */
export const KIRA_RECALL_SERVICE = 'kira.recall'

/** Most records one `recall` answer may carry. A reader asking for more is asking for the store, not an answer. */
export const MAX_RECALL_RECORDS = 50

/** Member names that would make this a write door. The court asserts none of them appears on the service. */
export const FORBIDDEN_MEMBER = /(stage|settle|mint|approve|enqueue|decline|grant)/iu

/**
 * The records out of whatever the read owner returned, without interpreting its vocabulary.
 * `empty` and `undetermined` are ANSWERS, so they come back as themselves.
 * @param {unknown} answer
 * @returns {{status: string, records: unknown[]}}
 */
export function recordsOf(answer) {
  if (answer === null || typeof answer !== 'object') {
    return { status: 'undetermined', reason: 'the read owner returned nothing', records: [] }
  }
  // *** THE READ OWNER'S VOCABULARY IS `availability`, AND THIS FUNCTION ONLY LOOKED AT `status`. *** MEASURED
  // 2026-09-26 (Fable's preflight blocker 7): the owner reports `found | empty | undetermined`
  // (cite-service.mjs:85, conversation.mjs:10), so every answer fell through to
  // `Array.isArray(answer.records) ? 'match' : …` — WHICH REPORTS ANY ARRAY AS A MATCH, turning "this store is
  // empty" and "this store could not be read" into the same answer as a real hit. `status` is still honoured first
  // because the existing stubs and courts speak it.
  const records = Array.isArray(answer.records) ? answer.records : []
  const availability = typeof answer.availability === 'string' ? answer.availability : null
  const mapped = availability === 'found' ? 'match' : availability
  const status = typeof answer.status === 'string' ? answer.status : (mapped ?? 'undetermined')
  const result = { status, records }
  // A REASON IS PART OF AN UNDETERMINED ANSWER, not decoration: "could not be read" without a why is not actionable.
  if (typeof answer.reason === 'string' && answer.reason !== '') result.reason = answer.reason
  return result
}

/**
 * A read-only surface over one owner. If the owner can narrow itself to a read owner, it does; otherwise the
 * owner is used as-is ONLY if it exposes nothing beyond `describe`/`read` — so a memory owner that carries a
 * queue cannot be handed out through this door by accident.
 * @param {Record<string, unknown>} owner
 * @param {Record<string, unknown>} [policy]
 * @returns {Record<string, unknown>}
 */
export function readOnlySurface(owner, policy) {
  if (typeof owner?.createReadOwner === 'function') {
    const narrowed = /** @type {(p: unknown) => Record<string, unknown>} */ (owner.createReadOwner)(policy ?? {})
    if (narrowed !== null && typeof narrowed === 'object') return narrowed
  }
  const members = Object.keys(owner ?? {}).filter(name => typeof owner[name] === 'function')
  const extra = members.filter(name => name !== 'describe' && name !== 'read')
  if (extra.length > 0) {
    throw new Error(`kira.recall: refusing to serve an owner that exposes ${extra.join(', ')}`)
  }
  return owner
}

/**
 * The service object. Frozen, three members, no writes.
 * @param {Record<string, unknown>} surface
 * @returns {Readonly<{describe: Function, read: Function, recall: Function}>}
 */
export function createKiraRecallService(surface, options) {
  if (typeof surface?.read !== 'function') {
    throw new Error('kira.recall: the read surface carries no read()')
  }
  // RANKING IS INJECTED, NOT IMPORTED, AND THAT IS NOT A STYLE CHOICE: this file's whole safety property is that it
  // has NO IMPORTS AT ALL — the kira-dsh-assembly court asserts exactly that (line 598 of its file), with a mutation
  // that adds `record.mjs` to prove it bites. A read door that can reach the record builder is a write door wearing a
  // read name, so the caller (which imports freely) hands in the plugin's existing lexical retrieval from
  // `retrieval.mjs` (`compileIndex` + `rankRecords`) and this file stays unable to reach anything.
  const rank = typeof options?.rank === 'function' ? options.rank : null
  // CEILINGS ARE INJECTED FOR THE SAME REASON RANKING IS: this file has no imports at all, so it cannot name `RECALL_CEILINGS` from `memory-tiers.mjs` — and it must not,
  // because the module that BUILDS records is exactly what a read door should be unable to reach. The caller hands the list in; §10.2 says the reply prints it.
  const ceilings = Array.isArray(options?.ceilings) ? Object.freeze(options.ceilings.map(String)) : Object.freeze([])
  return Object.freeze({
    async describe() {
      return typeof surface.describe === 'function' ? await surface.describe() : Object.freeze({})
    },
    async read() {
      return await /** @type {() => Promise<unknown>} */ (surface.read)()
    },
    /**
     * The records, up to the cap, with the store's own status. NOTHING IS FABRICATED: a store that could not
     * be read comes back `undetermined`, and one that matched nothing comes back `empty` — a caller that
     * collapses those two is the failure the read vocabulary exists to prevent.
     */
    async recall(question) {
      const answer = recordsOf(await /** @type {() => Promise<unknown>} */ (surface.read)())
      // *** THE QUESTION WAS IGNORED, SO THE ANSWER WAS THE FIRST N RECORDS BY WHATEVER ORDER THE OWNER USED. ***
      // Ranking happens BEFORE the slice: a cap applied first cuts the relevant record out and no later ranking can
      // put it back. An empty or absent question means "no ranking", not "rank by nothing".
      const asked = typeof question === 'string' ? question.trim() : ''
      const ordered = rank !== null && asked !== '' ? rank(answer.records, asked) : answer.records
      const records = Array.isArray(ordered) ? ordered : answer.records
      const result = {
        status: answer.status,
        // *** §10.2: THE CEILINGS TRAVEL WITH THE REPLY. *** "Ceilings (printed in service replies, the app's More section and the docs)" — a caller that receives
        // notes without them receives a claim it cannot check: that the wording is the owner's, that a person reviewed it, that a missing note means the note is absent.
        ceilings,
        records: Object.freeze(records.slice(0, MAX_RECALL_RECORDS)),
        truncated: records.length > MAX_RECALL_RECORDS,
      }
      if (answer.reason !== undefined) result.reason = answer.reason
      return Object.freeze(result)
    },
  })
}

/**
 * Provide the service on a Cordis context, or refuse by name.
 * @param {{provide?: Function}} ctx
 * @param {{owner: Record<string, unknown>, policy?: Record<string, unknown>, rank?: Function, logger?: {warn?: Function}}} deps
 * @returns {{provided: boolean, reason?: string}}
 */
export function provideKiraRecall(ctx, deps) {
  if (typeof ctx?.provide !== 'function') {
    // REFUSED BY NAME. A host context with no `provide` cannot offer this door, and returning quietly would
    // let a deployment believe a service exists that nobody can reach.
    return { provided: false, reason: 'no-ctx-provide' }
  }
  let service
  try {
    // *** A CALLER'S RANKER WAS DROPPED HERE. *** `createKiraRecallService` takes `options.rank`, and this line built the
    // service with no options at all — so `deps.rank` was accepted, ignored, and every answer came back in the owner's own
    // order while the caller believed the question had decided. Fable's item (4): pass `rank` at the call site, and it has
    // to arrive here first.
    service = createKiraRecallService(readOnlySurface(deps.owner, deps.policy), { rank: deps.rank, ceilings: deps.ceilings })
  } catch (error) {
    deps.logger?.warn?.(`compaction-export: kira.recall not mounted (${error?.message ?? 'unknown'})`)
    return { provided: false, reason: 'owner-not-read-only' }
  }
  const offenders = Object.keys(service).filter(name => FORBIDDEN_MEMBER.test(name))
  if (offenders.length > 0) {
    return { provided: false, reason: `service-carries-${offenders.join('-')}` }
  }
  ctx.provide(KIRA_RECALL_SERVICE, service)
  return { provided: true }
}

/**
 * THE STATIC SELF-CHECK, exported so a court asserts the property about THIS file rather than about a copy of
 * it: every import specifier in `source`, which must be none.
 * @param {string} source
 * @returns {string[]}
 */
export function importSpecifiersOf(source) {
  return [...String(source).matchAll(/^\s*import[^\n]*from\s+'([^']+)'/gmu)].map(match => match[1])
}
