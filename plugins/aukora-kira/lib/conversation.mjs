/**
 * The bounded conversational retrieval session.
 *
 * One conversation holds disposable navigation state for one subject and one
 * effective policy. Every turn reacquires the read owner: the subject, the
 * permitted privacy classes, the snapshot key, and the citations all come from
 * the owner at publication time. Nothing is cached across a change of record
 * bytes, projection, subject, or effective privacy.
 *
 * Two vocabularies stay separate. Store availability is `found | empty |
 * undetermined`, and `undetermined` never collapses into `empty`: "no matching
 * record is visible" and "memory could not be read or verified" are different
 * facts, and a product that reports the second as the first hides a safety
 * failure. Retrieval status is `match | ambiguous | insufficient | exhausted`,
 * and a `match` asserts lexical overlap only, never an answer.
 *
 * @module @aukora/dsh-plugin-kira/conversation
 */
import { kiraRecordContentSha256 } from './record.mjs'
import { readOwnerPolicy, readOwnerSnapshot, snapshotDigest } from './read-owner.mjs'
import {
  LEXICAL_METHOD,
  RETRIEVAL_CEILING,
  RETRIEVAL_LIMITS,
  clip,
  compileIndex,
  lexicalMethodDigest,
  rankRecords,
  tokens,
} from './retrieval.mjs'

/** The actions one turn may request. */
export const CONVERSATION_ACTIONS = Object.freeze([
  'query', 'more', 'select', 'not-that', 'clarify', 'new', 'stop', 'status', 'recent',
])

/** Interpretation readings of explicitly recorded `supersedes` links. */
const INTERPRETATIONS = Object.freeze(['search', 'original', 'current', 'recent'])

/**
 * The records a snapshot holds, NEWEST FIRST, by the instant each record declares.
 *
 * `recent` EXISTS BECAUSE A LEXICAL MATCH CANNOT BE THE ONLY WAY IN. The opening contribution asks a
 * handful of hand-written questions; retrieval is BM25 over bigrams, so a record whose words share
 * nothing with those questions is invisible to a fresh session until somebody happens to ask about it.
 * Measured live 2026-09-23: the first record settled under the owner's identity was in the store, and
 * the injected block said only that the store HELD RECORDS while showing none of them.
 *
 * ORDERED BY THE RECORD'S OWN `createdAt` — the instant its author declared, which is also what a
 * person reads — and NOT by arrival order or Aura position, so a record staged later but declared
 * earlier does not claim to be newer. Ties break on the record identifier so two records sharing an
 * instant list in a stable order rather than in whatever order the snapshot happened to hold them.
 * @param {readonly Record<string, unknown>[]} rows - snapshot rows, each with `recordId` and `record`.
 * @param {number} limit - the most identifiers to return.
 * @returns {readonly string[]} record identifiers, newest first.
 */
export function newestRecordIds(rows, limit) {
  const instantOf = (row) => String(row?.record?.createdAt ?? row?.createdAt ?? '')
  return Object.freeze([...(Array.isArray(rows) ? rows : [])]
    .sort((a, b) => {
      const at = instantOf(a)
      const bt = instantOf(b)
      if (at !== bt) return at < bt ? 1 : -1
      return String(b?.recordId ?? '').localeCompare(String(a?.recordId ?? ''))
    })
    .slice(0, Math.max(0, Number.isSafeInteger(limit) ? limit : 0))
    .map(row => String(row?.recordId ?? '')))
}

/** Actions that navigate within an already-acquired group. */
const NAVIGATION_ACTIONS = Object.freeze(['select', 'more', 'not-that', 'clarify'])

/** Only this read-owner refusal is a race rather than a defect. */
const TRANSIENT_READ_OWNER_CODES = Object.freeze(new Set(['kira.read-owner:snapshot-policy-changed']))

/**
 * Name why an acquisition could not be used.
 *
 * A policy that moved between the owner's own two calls is a race to report as
 * one; anything else is an owner fault, and both stay `undetermined` rather
 * than becoming an empty result.
 * @param {unknown} error - the caught acquisition error.
 * @returns {string} the withheld reason.
 */
function acquisitionReason(error) {
  return error instanceof Error && 'code' in error && error.code === 'kira.read-owner:snapshot-policy-changed'
    ? 'policy-changed-during-read'
    : 'read-owner-failed'
}

/** A named conversation refusal; every refusal carries one stable code. */
export class KiraConversationError extends Error {
  /** Stable machine-readable refusal code, e.g. `kira.recall:selection-not-displayed`. */
  code

  /**
   * @param {string} code - stable refusal code suffix, without the route prefix.
   * @param {string} message - human-readable refusal, free of caller data echoes.
   */
  constructor(code, message) {
    super(`kira.recall: ${message}`)
    this.name = 'KiraConversationError'
    this.code = `kira.recall:${code}`
  }
}

/** @param {string} code @param {string} message @returns {never} */
function fail(code, message) {
  throw new KiraConversationError(code, message)
}

/**
 * Read one closed request without invoking accessors.
 * @param {unknown} request - candidate turn request from the tool boundary.
 * @returns {{action: string, text?: string, choice?: number, kind?: string}} detached request.
 */
function readRequest(request) {
  if (request === null || typeof request !== 'object' || Array.isArray(request)) {
    fail('request-invalid', 'request must be one plain data record')
  }
  const allowed = new Set(['action', 'text', 'choice', 'kind'])
  const result = /** @type {{action?: unknown, text?: unknown, choice?: unknown, kind?: unknown}} */ ({})
  for (const key of Reflect.ownKeys(/** @type {object} */ (request))) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      fail('request-invalid', 'request carries a field outside action, text, choice, kind')
    }
    const descriptor = Object.getOwnPropertyDescriptor(/** @type {object} */ (request), key)
    if (descriptor === undefined || !('value' in descriptor)) {
      fail('request-invalid', `request.${key} must be a data property`)
    }
    result[/** @type {'action'|'text'|'choice'|'kind'} */ (key)] = descriptor.value
  }
  const action = result.action ?? 'query'
  if (typeof action !== 'string' || !CONVERSATION_ACTIONS.includes(/** @type {never} */ (action))) {
    fail('action-invalid', `action must be one of ${CONVERSATION_ACTIONS.join(', ')}`)
  }
  if (result.text !== undefined && typeof result.text !== 'string') {
    fail('request-invalid', 'request.text must be a string when present')
  }
  if (typeof result.text === 'string' && [...result.text].length > RETRIEVAL_LIMITS.queryChars) {
    fail('query-too-large', `request.text must be at most ${RETRIEVAL_LIMITS.queryChars} characters`)
  }
  if (result.choice !== undefined && !Number.isInteger(result.choice) && typeof result.choice !== 'string') {
    fail('request-invalid', 'request.choice must be an integer position or a displayed record identifier')
  }
  return {
    action,
    ...(result.text === undefined ? {} : { text: result.text }),
    ...(result.choice === undefined ? {} : { choice: /** @type {number | string} */ (result.choice) }),
    ...(result.kind === undefined ? {} : { kind: /** @type {string} */ (result.kind) }),
  }
}

/** One blank working state. */
function blank(scope, transform) {
  return {
    version: 1,
    scope,
    transform,
    snapshot: '',
    query: '',
    displayed: [],
    selected: [],
    excluded: [],
    cursor: 0,
    interpretation: 'search',
    rejections: 0,
  }
}

/**
 * Collect the explicit source-owned links that participate in navigation.
 * Only `supersedes` and `contradicts` are relations; every other relation stays
 * inert record text and cannot create a relationship this method would act on.
 * @param {readonly Readonly<Record<string, unknown>>[]} records - snapshot records.
 * @returns {{from: string, recordId: string, relation: string}[]} directed edges.
 */
function linksIn(records) {
  const edges = []
  for (const entry of records) {
    const links = Array.isArray(entry.record['links']) ? entry.record['links'] : []
    for (const link of links.slice(0, RETRIEVAL_LIMITS.references * 2)) {
      if (link === null || typeof link !== 'object') continue
      const relation = link['relation']
      const target = link['recordId']
      if (typeof relation !== 'string' || !RETRIEVAL_LIMITS.linkRelations.includes(relation)) continue
      if (typeof target !== 'string') continue
      edges.push({ from: entry.recordId, recordId: target, relation })
    }
  }
  return edges
}

/**
 * Detect a cycle among the given identifiers under the given edges.
 * @param {Set<string>} ids - nodes in scope.
 * @param {readonly {from: string, recordId: string}[]} edges - directed edges.
 * @returns {boolean} whether any node reaches itself.
 */
function hasCycle(ids, edges) {
  const visiting = new Set()
  const done = new Set()
  /** @param {string} id @returns {boolean} */
  const visit = (id) => {
    if (visiting.has(id)) return true
    if (done.has(id)) return false
    visiting.add(id)
    for (const edge of edges) if (edge.from === id && ids.has(edge.recordId) && visit(edge.recordId)) return true
    visiting.delete(id)
    done.add(id)
    return false
  }
  return [...ids].some(visit)
}

/**
 * Rank candidates and expand one bounded group across explicit links.
 * @param {readonly Readonly<Record<string, unknown>>[]} records - snapshot records.
 * @param {Record<string, unknown>} state - current working state.
 * @param {{documents: string[][], df: Map<string, number>, average: number, count: number}} index - compiled index.
 * @returns {{ordered: string[], component: Set<string>, edges: unknown[], byId: Map<string, unknown>, reason?: string, interpreted?: string}} the retrieved group.
 */
function retrieve(records, state, index) {
  const ranked = rankRecords(index, records, /** @type {string} */ (state.query))
  const byId = new Map(records.map(entry => [entry.recordId, entry]))
  const edges = linksIn(records)
  const excluded = /** @type {string[]} */ (state.excluded)
  let seed = ranked.find(row => row.score >= LEXICAL_METHOD.minScore && !excluded.includes(row.recordId))
  const selected = /** @type {string[]} */ (state.selected)
  if (selected.length > 0) {
    const row = ranked.find(candidate => candidate.recordId === selected[0])
    if (row !== undefined) seed = { ...row, score: Math.max(LEXICAL_METHOD.minScore, seed?.score ?? 0, row.score) }
  }
  const component = new Set(seed === undefined ? [] : [seed.recordId])
  let truncated = records.some(entry => (Array.isArray(entry.record['links']) ? entry.record['links'].length : 0) > RETRIEVAL_LIMITS.references * 2)
  for (const id of component) {
    for (const edge of edges) {
      if (edge.from !== id && edge.recordId !== id) continue
      const other = edge.from === id ? edge.recordId : edge.from
      if (!byId.has(other) || component.has(other) || excluded.includes(other)) continue
      if (component.size === RETRIEVAL_LIMITS.references) { truncated = true; continue }
      component.add(other)
    }
  }
  const scopedEdges = edges.filter(edge => component.has(edge.from) || component.has(edge.recordId))
  const missing = scopedEdges.some(edge => !byId.has(edge.from) || !byId.has(edge.recordId)
    || excluded.includes(edge.from) || excluded.includes(edge.recordId))
  let focus = seed?.recordId
  let reason
  let interpreted
  if (state.interpretation !== 'search') {
    const succession = scopedEdges.filter(edge => edge.relation === 'supersedes')
    const blocked = new Set(succession.map(edge => state.interpretation === 'original' ? edge.from : edge.recordId))
    const candidates = [...component].filter(id => !blocked.has(id))
    // An interpretation is only established by an unambiguous acyclic
    // succession within a complete retrieved group. Anything less leaves the
    // reading unestablished rather than guessing a referent.
    if (succession.length > 0 && candidates.length === 1 && !missing && !truncated && !hasCycle(component, succession)) {
      focus = candidates[0]
      interpreted = focus
    } else {
      focus = undefined
      reason = 'clarification-needs-an-unambiguous-linked-record'
    }
  }
  if (truncated || component.size > RETRIEVAL_LIMITS.snippets) reason ??= 'linked-records-truncated'
  if (missing) reason ??= 'linked-record-unavailable'
  // ── A TERM IN EVERY RECORD IS NOT A MISSED QUERY ────────────────────────────────────────────────
  // MEASURED, and it is what the single-term lead actually was: a term occurring in EVERY record has
  // almost no IDF, so its score falls under `LEXICAL_METHOD.minScore` and the reply said `insufficient`
  // — blaming the QUESTION when the term had matched every record and the RANKING threshold discarded
  // them. `unmatchedTerms` already carries the proof that nothing was unmatched, so the old answer
  // contradicted itself in the same reply.
  //
  // THE RANKING IS UNTOUCHED. `lexicalMethodDigest` pins the method and its bounds so that a silent
  // constant change fails rather than ships, and which records come back is a decision rather than a
  // tweak. This adds a name for the cause and nothing else: same records, same status.
  if (seed === undefined && reason === undefined && records.length > 0) {
    const terms = [...new Set(tokens(/** @type {string} */ (state.query)))]
    if (terms.length > 0 && terms.every(term => (index.df.get(term) ?? 0) >= records.length)) {
      reason = 'query-terms-match-every-record'
    }
  }
  const preferred = focus === undefined ? [] : [focus, ...component].filter((id, i, all) => all.indexOf(id) === i)
  const ordered = seed === undefined || focus === undefined
    ? []
    : [
        ...preferred,
        ...ranked
          .filter(row => row.score >= LEXICAL_METHOD.minScore && !preferred.includes(row.recordId) && !excluded.includes(row.recordId))
          .map(row => row.recordId),
      ]
  return { ordered, component, edges: scopedEdges, byId, ...(reason === undefined ? {} : { reason }), ...(interpreted === undefined ? {} : { interpreted }) }
}

/**
 * One bounded conversational retrieval session.
 *
 * The instance is disposable. `close()` aborts the session lifetime, blanks the
 * working state, and prevents any in-flight turn from publishing: a turn that
 * observes the abort before it commits throws instead of returning a late
 * result. Only an explicit `new` action rearms a closed session, and it starts
 * from a blank state rather than resuming the one it had.
 */
export class KiraConversation {
  #owner
  #scope
  #kind
  #state
  #busy = false
  #stopped = false
  #lifetime = new AbortController()
  #cache = null
  #readCount = 0
  #buildCount = 0

  /**
   * @param {Readonly<{describe: () => Promise<unknown>, read: (request: unknown) => Promise<unknown>}>} owner - the injected read owner.
   * @param {string} scope - host-supplied scope key; never model-supplied.
   * @param {string | undefined} kind - optional record-kind filter the caller may narrow with.
   */
  constructor(owner, scope, kind) {
    this.#owner = owner
    this.#scope = scope
    this.#kind = kind
    this.#state = blank(scope, lexicalMethodDigest())
  }

  /** The current working state, detached. */
  get state() {
    return structuredClone(this.#state)
  }

  /** Whether this session has been stopped or disposed. */
  get closed() {
    return this.#stopped
  }

  /**
   * Number of read-owner acquisitions, index builds, read-owner acquisition
   * requests, and index builds this session has performed. Evidence for cache
   * reuse and invalidation only; never model-visible.
   */
  get counters() {
    return Object.freeze({ reads: this.#readCount, builds: this.#buildCount })
  }

  /** Stop the session and blank its working state. Idempotent. */
  close() {
    this.#stopped = true
    this.#lifetime.abort()
    this.#cache = null
    this.#state = blank(this.#scope, lexicalMethodDigest())
  }

  /**
   * Reacquire the read owner once and validate what it returned.
   * @param {AbortSignal} signal - combined caller and lifetime cancellation.
   * @returns {Promise<{snapshot: Readonly<Record<string, unknown>>, policy: Readonly<Record<string, unknown>>, key: string}>} the acquired snapshot.
   */
  async #acquire(signal) {
    signal.throwIfAborted()
    const policy = readOwnerPolicy(await this.#owner.describe())
    signal.throwIfAborted()
    const raw = await this.#owner.read({ signal, ...(this.#kind === undefined ? {} : { kind: this.#kind }) })
    signal.throwIfAborted()
    const snapshot = readOwnerSnapshot(raw, policy, this.#scope)
    signal.throwIfAborted()
    return { snapshot, policy, key: snapshotDigest(snapshot, lexicalMethodDigest()) }
  }

  /**
   * Withhold publication and report why.
   *
   * The working state is blanked because a withheld turn establishes no
   * navigation context. When the withholding was caused by a snapshot change
   * the new key is retained, so the next turn starts from the new snapshot
   * rather than re-detecting the same change.
   *
   * @param {string} availability - store availability to report.
   * @param {string} status - retrieval status to report.
   * @param {string} [reason] - named reason.
   * @param {string} [snapshotKey] - snapshot key the blank state should carry.
   * @returns {Readonly<Record<string, unknown>>} the withheld reply.
   */
  #withhold(availability, status, reason, snapshotKey) {
    this.#state = blank(this.#scope, lexicalMethodDigest())
    if (snapshotKey !== undefined) this.#state.snapshot = snapshotKey
    this.#cache = null
    return Object.freeze({
      availability,
      status,
      ...(reason === undefined ? {} : { reason }),
      snippets: Object.freeze([]),
      relations: Object.freeze([]),
      interpretation: Object.freeze({ kind: 'search' }),
      retrieval: Object.freeze({ method: LEXICAL_METHOD.name, version: LEXICAL_METHOD.version, digest: lexicalMethodDigest(), vectors: 0 }),
      ceiling: RETRIEVAL_CEILING,
      state: Object.freeze(this.state),
    })
  }

  /**
   * Run one turn.
   * @param {unknown} request - closed `{action, text?, choice?, kind?}` request.
   * @param {AbortSignal} [callerSignal] - caller cancellation.
   * @returns {Promise<Readonly<Record<string, unknown>>>} the published reply.
   */
  async turn(request, callerSignal = new AbortController().signal) {
    const read = readRequest(request)
    if (read.action === 'stop') {
      this.close()
      return this.#withhold('undetermined', 'insufficient', 'stopped')
    }
    if (this.#stopped) {
      if (read.action !== 'new') fail('closed', 'this session is stopped; only an explicit new action rearms it')
      // Rearming is an explicit, deliberate act: the stopped lifetime is
      // replaced rather than resumed, so no in-flight work from before the stop
      // can publish into the new session.
      this.#stopped = false
      this.#lifetime = new AbortController()
    }
    if (this.#busy) fail('busy', 'this session is already running a turn')
    if (read.action === 'status') {
      return Object.freeze({
        availability: 'undetermined',
        status: 'insufficient',
        reason: 'session-status',
        snippets: Object.freeze([]),
        relations: Object.freeze([]),
        interpretation: Object.freeze({ kind: 'search' }),
        retrieval: Object.freeze({ method: LEXICAL_METHOD.name, version: LEXICAL_METHOD.version, digest: lexicalMethodDigest(), vectors: 0 }),
        ceiling: RETRIEVAL_CEILING,
        state: Object.freeze(this.state),
        counters: this.counters,
      })
    }
    this.#busy = true
    const combined = AbortSignal.any([callerSignal, this.#lifetime.signal])
    try {
      let acquired
      try {
        this.#readCount += 1
        acquired = await this.#acquire(combined)
      } catch (error) {
        // A stop is reported as a stop, not as whatever cancellation surfaced
        // first: a caller must be able to tell "you stopped this" from "the
        // store failed".
        if (this.#stopped) fail('closed', 'the session was stopped before this turn could finish')
        combined.throwIfAborted()
        // An isolation or integrity refusal is the read owner breaking its
        // contract, not a transient outage. Collapsing it into "memory
        // unavailable" would let a widened read look like an empty one, so it
        // stays a hard refusal the caller must see.
        if (error instanceof Error && 'code' in error && typeof error.code === 'string'
          && error.code.startsWith('kira.read-owner:') && !TRANSIENT_READ_OWNER_CODES.has(error.code)) {
          throw error
        }
        return this.#withhold('undetermined', 'insufficient', acquisitionReason(error))
      }
      const { snapshot, policy, key } = acquired
      if (snapshot.availability === 'undetermined') {
        return this.#withhold('undetermined', 'insufficient', /** @type {string} */ (snapshot.reason))
      }
      const changed = this.#state.snapshot !== '' && this.#state.snapshot !== key
      if (changed) this.#state = blank(this.#scope, lexicalMethodDigest())
      this.#state.snapshot = key
      if (snapshot.availability === 'empty') {
        return this.#withhold('empty', 'insufficient', 'no-visible-record')
      }
      if (changed && NAVIGATION_ACTIONS.includes(read.action)) {
        return this.#withhold('found', 'insufficient', 'snapshot-changed-ask-again', key)
      }
      let state = this.state
      state.snapshot = key
      if (read.action === 'query' || read.action === 'new' || read.action === 'recent') {
        state = { ...blank(this.#scope, lexicalMethodDigest()), snapshot: key, query: clip(read.text ?? '', RETRIEVAL_LIMITS.queryChars) }
        // `recent` IS NOT A QUESTION. Its interpretation says so, which also keeps the two
        // ambiguity rules below — both guarded on `search` — from reporting a recency listing as an
        // ambiguous match: a bounded list of the newest records is complete for what it claims.
        if (read.action === 'recent') state.interpretation = 'recent'
      } else if (read.action === 'clarify') {
        const meaning = read.text?.trim().toLowerCase()
        if (meaning !== undefined && ['original', 'current', 'latest'].includes(meaning)) {
          state.interpretation = meaning === 'original' ? 'original' : 'current'
        } else if (meaning !== undefined) {
          state.query = clip(`${state.query} ${meaning}`.trim(), RETRIEVAL_LIMITS.queryChars)
          state.interpretation = 'search'
          state.selected = []
          state.excluded = []
        }
        state.cursor = 0
      } else if (read.action === 'not-that') {
        const rejected = state.displayed.slice(0, 1)
        state.excluded = [...new Set([...state.excluded, ...rejected])]
        state.rejections = state.excluded.length
        state.selected = []
        state.cursor = 0
        state.interpretation = 'search'
      } else if (read.action === 'select') {
        const chosen = typeof read.choice === 'number'
          ? state.displayed[read.choice - 1]
          : read.choice
        if (typeof chosen !== 'string' || !state.displayed.includes(chosen)) {
          fail('selection-not-displayed', 'choice must name one of the references this session displayed')
        }
        state.selected = [chosen]
        state.cursor = 0
        state.interpretation = 'search'
      }
      if (!INTERPRETATIONS.includes(state.interpretation)) state.interpretation = 'search'
      const records = /** @type {readonly Readonly<Record<string, unknown>>[]} */ (snapshot.records)
      if (this.#cache === null || this.#cache.key !== key) {
        this.#cache = { key, index: compileIndex(/** @type {readonly {recordId: string, text: string}[]} */ (records)) }
        this.#buildCount += 1
      }
      const found = retrieve(records, state, this.#cache.index)
      // ── THE NEWEST RECORDS, FOR A READER WHO CANNOT GUESS THE WORDS ─────────────────────────────
      // `recent` ignores the lexical ranking and lists what the snapshot holds, newest first. The
      // pipeline below is untouched — citation, applicability, privacy and the reference bound all
      // behave exactly as they do for a match — so the only thing recency changes is how the order was
      // chosen. Records this session already rejected or selected stay out, as they do everywhere.
      const eligible = read.action === 'recent'
        ? newestRecordIds(records, RETRIEVAL_LIMITS.references)
          .filter(id => !state.excluded.includes(id) && !state.selected.includes(id))
        : (read.action === 'select' ? found.ordered.filter(id => found.component.has(id)) : found.ordered)
      const capacity = Math.min(
        RETRIEVAL_LIMITS.snippets,
        RETRIEVAL_LIMITS.references - state.excluded.length - state.selected.length,
      )
      const primary = eligible.slice(state.cursor, state.cursor + Math.max(0, capacity))
      state.cursor = Math.min(eligible.length, state.cursor + primary.length)
      state.displayed = primary
      const visibleEdges = found.edges.filter(edge => primary.includes(edge.from) && primary.includes(edge.recordId))
      const relations = visibleEdges
        .filter((edge, i, all) => all.findIndex(other => `${other.from}\u0000${other.recordId}\u0000${other.relation}` === `${edge.from}\u0000${edge.recordId}\u0000${edge.relation}`) === i)
        .sort((a, b) => Number(b.relation === 'contradicts') - Number(a.relation === 'contradicts'))
        .slice(0, RETRIEVAL_LIMITS.references)
      // ── APPLICABILITY: what a reader needs BEFORE acting on a record ─────────────────────────────
      // DERIVED FROM `links[].relation` OVER THE WHOLE VISIBLE STORE, not from the displayed set. The
      // reply's `relations` array is filtered to the records this session displayed, so a record
      // superseded by one that did not happen to be displayed came back looking current — and recorded
      // succession was otherwise readable only through an explicit `clarify original|current`, a
      // question a reader must already know to ask. A warning you must know to request is not a warning.
      const supersededBy = new Map()
      const supersedes = new Map()
      const contradicts = new Map()
      const remember = (map, key, value) => {
        const list = map.get(key)
        if (list === undefined) map.set(key, [value])
        else if (!list.includes(value)) list.push(value)
      }
      // `edges` inside `retrieve()` covers the same records but is scoped there, so this reads the
      // store's own links again rather than reaching for a variable that does not exist here — the
      // first version of this block did exactly that and threw `edges is not defined` on every turn.
      const applicabilityEdges = linksIn(records)
      // `from` is the record CARRYING the link, so it is the newer one: `from` supersedes `recordId`.
      for (const edge of applicabilityEdges) {
        if (edge.relation === 'supersedes') {
          remember(supersededBy, edge.recordId, edge.from)
          remember(supersedes, edge.from, edge.recordId)
        } else if (edge.relation === 'contradicts') {
          remember(contradicts, edge.recordId, edge.from)
          remember(contradicts, edge.from, edge.recordId)
        }
      }
      /**
       * 1 for a record nothing supersedes, 2 for one superseded once, and so on along the chain.
       *
       * NULL WHEN THE CHAIN CANNOT BE JUSTIFIED — a cycle, or a walk longer than the retrieval bound —
       * because an unjustifiable number is a guess and a reader cannot tell a guess from a fact. The
       * walk follows who supersedes whom, so it terminates at the newest record in the chain.
       * @param {string} id @returns {number|null}
       */
      const revisionOf = (id) => {
        let depth = 1
        let frontier = [id]
        const seen = new Set([id])
        while (frontier.length > 0) {
          const next = []
          for (const current of frontier) {
            for (const newer of (supersededBy.get(current) ?? [])) {
              if (seen.has(newer)) return null
              seen.add(newer)
              next.push(newer)
            }
          }
          if (next.length > 0) depth += 1
          if (depth > RETRIEVAL_LIMITS.references) return null
          frontier = next
        }
        return depth
      }
      /**
       * A condition the record DECLARES about itself, verbatim, or null.
       *
       * NULL MEANS THE RECORD DECLARES NONE, NOT THAT THERE ARE NONE. This reads a declaration; it does
       * not compute applicability, and the two must not be confused in the field a reader acts on.
       * @param {Record<string, unknown>} record @param {string} key @returns {unknown}
       */
      const declaredIn = (record, key) => {
        const content = /** @type {Record<string, unknown>} */ (record.content)
        if (content === null || typeof content !== 'object' || Array.isArray(content)) return null
        const value = content[key]
        if (typeof value === 'string') return value
        if (Array.isArray(value) && value.every(item => typeof item === 'string')) return Object.freeze([...value])
        return null
      }
      const snippets = primary.map((id) => {
        const entry = /** @type {Record<string, unknown>} */ (found.byId.get(id))
        const text = /** @type {string} */ (entry.text)
        const record = /** @type {Record<string, unknown>} */ (entry.record)
        // ── A DELIBERATE SINGLE READ IS NOT A BUDGETED LISTING ──────────────────────────────────────
        // `snippetChars` exists because a listing is a context budget, and it stays. But `select` names
        // ONE record — it is the navigation a reader uses when they already know which record they mean
        // — so clipping it left the rest of that record UNREACHABLE. MEASURED (Auma's finding): a
        // 480-character snippet arrived with `truncated: true` and no way to read on. The whole text is
        // returned for a single selection, and the bound continues to apply to everything else.
        const whole = read.action === 'select' && state.selected.length === 1 && state.selected[0] === id
        const shown = whole ? text : clip(text, RETRIEVAL_LIMITS.snippetChars)
        // THE QUANTITY, NOT MERELY THE FACT. `truncated` alone told a reader that something was missing
        // and nothing about how much, which is a named limitation with no handle on it — the same shape
        // as reporting `undetermined` as `empty`. Counted over the characters ACTUALLY RETURNED, so the
        // two fields describe one fact and cannot contradict each other.
        const omitted = Math.max(0, [...text].length - [...shown].length)
        return Object.freeze({
          recordId: id,
          kind: record.kind,
          privacy: record.privacy,
          createdAt: record.createdAt,
          subject: record.subject,
          text: shown,
          truncated: omitted > 0,
          omittedChars: omitted,
          source: record.source,
          links: record.links,
          // ── APPLICABILITY, ON THE SNIPPET ITSELF ────────────────────────────────────────────────
          // A reader who has to reconstruct this from `relations` is being asked to do the bookkeeping
          // that recall exists to do for them.
          supersededBy: Object.freeze([...(supersededBy.get(id) ?? [])]),
          supersedes: Object.freeze([...(supersedes.get(id) ?? [])]),
          contradicts: Object.freeze([...(contradicts.get(id) ?? [])]),
          current: (supersededBy.get(id) ?? []).length === 0,
          revision: revisionOf(id),
          conditions: declaredIn(record, 'conditions'),
          ceiling: declaredIn(record, 'ceiling'),
          ...(record.transform === undefined ? {} : { transform: record.transform }),
          citation: entry.citation,
          // Recomputed here rather than echoed: the digest a snippet carries is
          // the digest of the record bytes this session actually published.
          contentSha256: kiraRecordContentSha256(record),
        })
      })
      const covered = new Set(snippets.flatMap(row => tokens(row.text)))
      const unmatched = [...new Set(tokens(/** @type {string} */ (state.query)))].filter(term => !covered.has(term))
      let status = snippets.length > 0 ? 'match' : (state.cursor > 0 || state.excluded.length > 0 ? 'exhausted' : 'insufficient')
      let reason = found.reason
      // THE REPLY SAYS SO, so a reader learns it without knowing to ask. Set before the status block
      // below, which turns a named reason into `ambiguous` for any answer that is not a selection.
      if (snippets.some(row => row.current === false)) reason ??= 'superseded-record-displayed'
      if (capacity <= 0 && eligible.length > 0) {
        status = 'ambiguous'
        reason = 'refine-query-after-rejections'
      } else if (relations.some(edge => edge.relation === 'contradicts')) {
        // Recorded disagreement is reported as disagreement even after a
        // selection; selection does not settle which record is correct.
        status = 'ambiguous'
        reason = 'recorded-disagreement'
      } else if (snippets.length > 0 && reason !== undefined && read.action !== 'recent') {
        // A NAMED REASON MAKES A MATCH AMBIGUOUS, BECAUSE A MATCH CLAIMS TO ANSWER SOMETHING. A recency
        // listing claims nothing of the kind: it is complete for its bound and says so, and reporting it
        // as `ambiguous` told a reader its own bound was in doubt. Measured on the first live run, where
        // the newest record declares two supersessions this subject cannot see, so `linked-record-
        // unavailable` was set — a true and useful reason that must still travel in `reason`, without
        // turning a bounded list into an ambiguous retrieval.
        status = 'ambiguous'
      } else if (snippets.length > 0 && read.action !== 'select' && state.interpretation === 'search' && unmatched.length > 0) {
        status = 'ambiguous'
        reason = 'query-terms-unmatched'
      } else if (snippets.length === 0 && (reason !== undefined || tokens(/** @type {string} */ (state.query)).length === 0)) {
        status = 'ambiguous'
      }
      // Several unselected lexical candidates do not choose a referent for the
      // user; the ambiguity is reported rather than resolved by ranking order.
      if (snippets.length > 1 && relations.length === 0 && read.action !== 'select' && state.interpretation === 'search') {
        status = 'ambiguous'
        reason ??= 'multiple-candidate-records'
      }
      if (new Set([...state.displayed, ...state.selected, ...state.excluded]).size > RETRIEVAL_LIMITS.references) {
        fail('state-bound', `working state may hold at most ${RETRIEVAL_LIMITS.references} active references`)
      }
      if (Buffer.byteLength(JSON.stringify(state)) > RETRIEVAL_LIMITS.stateBytes) {
        fail('state-bound', `working state may not exceed ${RETRIEVAL_LIMITS.stateBytes} bytes`)
      }
      // A second acquisition closes the source-change window between the read
      // that produced these snippets and the moment they are published.
      let current
      try {
        this.#readCount += 1
        current = await this.#acquire(combined)
      } catch (error) {
        if (this.#stopped) fail('closed', 'the session was stopped before this turn could publish')
        combined.throwIfAborted()
        if (error instanceof Error && 'code' in error && typeof error.code === 'string'
          && error.code.startsWith('kira.read-owner:') && !TRANSIENT_READ_OWNER_CODES.has(error.code)) {
          throw error
        }
        return this.#withhold('undetermined', 'insufficient', acquisitionReason(error))
      }
      if (current.key !== key) {
        return this.#withhold(current.snapshot.availability, 'insufficient', 'snapshot-changed-during-read', current.key)
      }
      // The commit point. A stop that landed anywhere above this line must not
      // publish, so the check is repeated after every await rather than trusted
      // to the signal alone.
      if (this.#stopped) fail('closed', 'the session was stopped before this turn could publish')
      combined.throwIfAborted()
      this.#state = state
      return Object.freeze({
        availability: 'found',
        status,
        ...(reason === undefined ? {} : { reason }),
        subject: policy.subject,
        policyRevision: policy.policyRevision,
        permittedPrivacy: policy.permittedPrivacy,
        snippets: Object.freeze(snippets),
        relations: Object.freeze(relations.map(edge => Object.freeze({ from: edge.from, recordId: edge.recordId, relation: edge.relation }))),
        interpretation: Object.freeze({
          kind: state.interpretation,
          ...(primary.includes(/** @type {string} */ (found.interpreted)) ? { recordId: found.interpreted } : {}),
        }),
        ...(unmatched.length === 0 ? {} : { unmatchedTerms: Object.freeze(unmatched) }),
        retrieval: Object.freeze({
          method: LEXICAL_METHOD.name,
          version: LEXICAL_METHOD.version,
          digest: lexicalMethodDigest(),
          projection: snapshot.projection,
          vectors: 0,
        }),
        bounds: Object.freeze({
          snippets: RETRIEVAL_LIMITS.snippets,
          references: RETRIEVAL_LIMITS.references,
          snippetChars: RETRIEVAL_LIMITS.snippetChars,
          queryChars: RETRIEVAL_LIMITS.queryChars,
          stateBytes: RETRIEVAL_LIMITS.stateBytes,
        }),
        ceiling: RETRIEVAL_CEILING,
        state: Object.freeze(this.state),
      })
    } finally {
      this.#busy = false
    }
  }
}
