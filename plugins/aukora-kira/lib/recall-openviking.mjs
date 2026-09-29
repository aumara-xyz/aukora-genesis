/**
 * OPENVIKING FINDS; THE CHAINED STORE ANSWERS.
 *
 * OpenViking (AGPL-3.0, pinned in `vendor/openviking/upstream-openviking.json`, installed by `scripts/openviking-setup.sh`)
 * is Kira's semantic FINDER over remembered notes, and nothing more:
 *
 *   · INDEX. Every live note is one file below the shared semantic root: remembered notes use
 *     `viking://user/<user>/memories/kira/remembered/rem-<hex>.md`; governed notes use `.../governed/<hex>.md` (legacy `governed/kira-<hex>.md` still accepted on read).
 *     Both carry `kira_id=...` and an explicit `tier=...` tag. `sync` reconciles them with the verified ledgers: a note the
 *     id OpenViking holds and the ledger no longer does (forgotten, hidden, unchained, or unsettled) is removed. Capture never waits for
 *     it: the note is written and chained first, and indexed afterwards, so a server that is down only delays the index.
 *   · FIND. A question goes to OpenViking; each hit is mapped back by id to the verified ambient/governed ledgers
 *     (`liveRemembered` plus the owner's settled read in memory-deps.mjs). A hit the ledger does not hold
 *     is DROPPED, counted and removed. The text and `bodyAtCapture` a caller sees are the note file's, never OpenViking's.
 *   · FORGET. A forgotten note is removed at once, and by the next reconcile if that removal could not reach the server.
 *
 * It grants nothing, raises no approval and writes nothing into the Kira store. It is off unless the OpenViking home holds
 * `aukora-bridge.json`. WHERE THE WORDS GO: to the loopback server that file names, and on to the embedding model in its
 * `ov.conf`; a model endpoint off this machine is refused unless the bridge file says `"allowRemoteModels": true`.
 *
 * @module @aukora/dsh-plugin-kira/recall-openviking
 */
import { contentWords } from './memory-harness.mjs'
import { dirname } from 'node:path'
import { readJsonStrict, readTextStrict, stateExists } from './strict-read.mjs'
import { GOVERNED_RESERVED_SLOTS, SEMANTIC_WINDOW, eligibleByTier, mergeReservedSlots } from './reserved-slots.mjs'

/** The method name every semantic answer carries. */
export const SEMANTIC_METHOD = 'openviking-semantic'

/** IDs accepted by the two semantic ledgers. Anything else is never indexed or shown. */
const NOTE_ID = /^rem:[0-9a-f]{64}$/u
const GOVERNED_ID = /^kira:[0-9a-f]{64}$/u

/** Defaults; `aukora-bridge.json` overrides each. `scoreThreshold` is measured; `SEMANTIC_WINDOW` is not — see its note in reserved-slots.mjs. */
export const SEMANTIC_DEFAULTS = Object.freeze({
  account: 'aukora', user: 'owner', scoreThreshold: 0.4, window: SEMANTIC_WINDOW, limit: 3, candidates: 12, timeoutMs: 8000, syncBatch: 32,
  /** Prepended to the question only (asymmetric embedding models such as Qwen3-Embedding want it). */
  queryInstruction: '',
})

/** The limits that travel with every semantic answer. */
export const SEMANTIC_CEILING = Object.freeze([
  'a semantic hit is similarity as the configured embedding model sees it, not an answer or a truth claim',
  'OpenViking only finds: each note was re-read from the Kira store, and a hit the chained store does not hold is dropped',
  'a remembered note is unreviewed and unsigned; bodyAtCapture is host-reported, not attestation',
  'no hit above the threshold is not evidence that the memory does not exist',
  'this answer grants no authority',
])

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
const onThisMachine = url => { try { return LOOPBACK.has(new URL(String(url)).hostname) } catch { return false } }
const hostOf = url => { try { return new URL(String(url)).host } catch { return String(url).slice(0, 80) } }

/** The OpenViking home for a Kira store: `$AUKORA_OPENVIKING_HOME`, else `openviking` beside the store root. */
export function openVikingHome(stateDir, env = process.env) {
  const named = env?.AUKORA_OPENVIKING_HOME
  return typeof named === 'string' && named !== '' ? named : `${dirname(String(stateDir))}/openviking`
}

/**
 * The model endpoints in `ov.conf` that are NOT on this machine. A provider with no `api_base` uses its own cloud endpoint.
 * @param {unknown} conf - parsed `ov.conf`.
 * @returns {string[]}
 */
export function modelsOffMachine(conf) {
  const off = []
  const check = (where, section) => {
    if (section === null || typeof section !== 'object') return
    const base = section.api_base
    if (typeof base === 'string' && base !== '') { if (!onThisMachine(base)) off.push(`${where} -> ${hostOf(base)}`) }
    else if (typeof section.provider === 'string' && section.provider !== '' && section.provider !== 'local') off.push(`${where} -> ${section.provider} (provider default endpoint)`)
  }
  check('embedding.dense', conf?.embedding?.dense)
  check('embedding.sparse', conf?.embedding?.sparse)
  check('vlm', conf?.vlm)
  check('rerank', conf?.rerank)
  check('query_planner', conf?.query_planner)
  return off
}

/**
 * The bridge configuration in an OpenViking home, or why there is none. Never throws, and never names a path or the key.
 * @param {string} home
 */
export function readBridgeConfig(home) {
  if (typeof home !== 'string' || home === '') return { configured: false, reason: 'no-openviking-home' }
  const file = `${home}/aukora-bridge.json`
  if (!stateExists(file)) return { configured: false, reason: 'openviking-not-installed (no aukora-bridge.json; see scripts/openviking-setup.sh)' }
  try {
    const raw = /** @type {Record<string, unknown>} */ (readJsonStrict(file, { maxBytes: 64 * 1024 }))
    const url = String(raw.url ?? '')
    if (!onThisMachine(url)) return { configured: false, reason: 'openviking-url-not-on-this-machine' }
    const key = readTextStrict(`${home}/root.key`, { maxBytes: 4096 }).trim()
    if (key === '') return { configured: false, reason: 'openviking-root-key-empty' }
    const conf = stateExists(`${home}/ov.conf`) ? readJsonStrict(`${home}/ov.conf`, { maxBytes: 1024 * 1024 }) : null
    const off = conf === null ? ['ov.conf missing'] : modelsOffMachine(conf)
    if (off.length > 0 && raw.allowRemoteModels !== true) {
      return { configured: false, reason: `openviking-models-off-machine (${off.join(', ')}); set allowRemoteModels only if every note may leave this Mac` }
    }
    const number = name => (Number.isFinite(raw[name]) ? Number(raw[name]) : SEMANTIC_DEFAULTS[name])
    const label = name => (typeof raw[name] === 'string' && /^[a-zA-Z0-9_-]{1,64}$/u.test(raw[name]) ? raw[name] : SEMANTIC_DEFAULTS[name])
    return Object.freeze({
      configured: true, url: url.replace(/\/+$/u, ''), account: label('account'), user: label('user'), key, onMachine: off.length === 0,
      scoreThreshold: number('scoreThreshold'), window: number('window'),
      limit: Math.max(1, Math.min(5, Math.trunc(number('limit')))), candidates: Math.max(1, Math.min(50, Math.trunc(number('candidates')))),
      timeoutMs: number('timeoutMs'), syncBatch: Math.max(0, Math.trunc(number('syncBatch'))),
      queryInstruction: typeof raw.queryInstruction === 'string' ? raw.queryInstruction.slice(0, 512) : SEMANTIC_DEFAULTS.queryInstruction,
    })
  } catch (error) {
    return { configured: false, reason: `openviking-config-unreadable (${String(error?.code ?? error?.name ?? 'unknown')})` }
  }
}

/** The OpenViking URI for one note id. WRITE shape: governed/<hex>.md (A1). */
export function uriFor(user, id) {
  const value = String(id)
  if (NOTE_ID.test(value)) return `viking://user/${user}/memories/kira/remembered/rem-${value.slice(4)}.md`
  if (GOVERNED_ID.test(value)) return `viking://user/${user}/memories/kira/governed/${value.slice(5)}.md`
  throw new Error(`kira.semantic: ${value.slice(0, 24)} is not a Kira memory id`)
}

/** The note id a URI names, or null. READ accepts A1 governed/<hex>.md and legacy governed/kira-<hex>.md. */
export function idFromUri(user, uri) {
  const value = String(uri)
  const ambient = value.match(new RegExp(`^viking://user/${user}/memories/kira/remembered/rem-([0-9a-f]{64})\\.md$`, 'u'))
  if (ambient !== null) return `rem:${ambient[1]}`
  const governed = value.match(new RegExp(`^viking://user/${user}/memories/kira/governed/(?:kira-)?([0-9a-f]{64})\.md$`, 'u'))
  return governed === null ? null : `kira:${governed[1]}`
}

/** A named failure talking to OpenViking. */
export class OpenVikingError extends Error {
  constructor(code, message) {
    super(`kira.semantic: ${message}`)
    this.name = 'OpenVikingError'
    this.code = `kira.semantic:${code}`
  }
}

/**
 * The bridge over one configured OpenViking server. The ledger it is handed is `{entries: Map<id, note>, complete}`, or a function that reads it;
 * `complete` false (the store could not be read) means nothing is removed, because a reconcile never deletes what it
 * could not see.
 * @param {{config: ReturnType<typeof readBridgeConfig>, fetch?: typeof fetch, logger?: {warn?: Function}, now?: () => number}} input
 */
export function createOpenVikingRecall(input) {
  const config = input?.config
  const doFetch = input?.fetch ?? globalThis.fetch
  const now = input?.now ?? Date.now
  const configured = config?.configured === true
  const root = configured ? `viking://user/${config.user}/memories/kira` : ''
  /** Ids OpenViking holds, as last listed (re-listed every ten minutes) and kept current by this process. */
  let indexed = null
  let listedAt = 0
  let health = { at: 0, ok: false, reason: 'not-probed' }
  /**
   * ONE RECONCILE OR FORGET AT A TIME, IN CALL ORDER, EACH READING THE LEDGER ONLY WHEN ITS TURN COMES. A ledger read before
   * the wait still held a note forgotten meanwhile, and the reconcile wrote it back after the forget had said removed.
   */
  let queue = Promise.resolve()
  const inTurn = task => { const turn = queue.then(task); queue = turn.catch(() => {}); return turn }
  /** The ledger, or a function that reads it now. */
  const ledgerNow = async ledger => (typeof ledger === 'function' ? await ledger() : ledger)
  /** Normalize the two ledgers while accepting the old ambient-only `{entries}` shape. */
  const ledgerShape = value => {
    const ambient = value?.ambient instanceof Map
      ? value.ambient
      : value?.entries instanceof Map ? value.entries : new Map()
    const governed = value?.governed instanceof Map
      ? value.governed
      : new Map([...ambient].filter(([, note]) => note?.tier === 'signed'))
    const entries = new Map([...ambient, ...governed])
    return { ambient, governed, entries, complete: value?.complete === true }
  }

  const call = async (method, path, body) => {
    let response
    try {
      response = await doFetch(`${config.url}${path}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-api-key': config.key, 'x-openviking-account': config.account, 'x-openviking-user': config.user },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(config.timeoutMs),
      })
    } catch (error) {
      throw new OpenVikingError('unreachable', `${method} ${path.split('?')[0]} did not reach ${config.url} (${String(error?.cause?.code ?? error?.name ?? 'unknown')})`)
    }
    const parsed = await response.json().catch(() => null)
    if (!response.ok || parsed?.status !== 'ok') {
      const why = String(parsed?.error?.code ?? parsed?.error?.message ?? parsed?.error ?? `HTTP ${String(response.status)}`).slice(0, 200)
      throw new OpenVikingError(response.status === 404 ? 'not-found' : 'refused', `${method} ${path.split('?')[0]} was refused: ${why}`)
    }
    return parsed.result
  }

  /** Whether the server answers; a healthy answer is trusted for ten seconds, a failure is probed again next time. */
  const available = async () => {
    if (!configured) return { ok: false, reason: config?.reason ?? 'openviking-not-configured' }
    if (health.ok && now() - health.at < 10_000) return health
    try {
      const response = await doFetch(`${config.url}/health`, { signal: AbortSignal.timeout(Math.min(config.timeoutMs, 2000)) })
      const body = await response.json().catch(() => null)
      const ok = response.ok && body?.healthy === true
      health = { at: now(), ok, reason: ok ? 'healthy' : `openviking-unhealthy (HTTP ${String(response.status)})` }
    } catch (error) {
      health = { at: now(), ok: false, reason: `openviking-unreachable at ${config.url} (${String(error?.cause?.code ?? error?.name ?? 'unknown')})` }
    }
    return health
  }

  const listIndexed = async () => {
    /** id -> EVERY uri that id was LISTED under. An id can appear under the A1 shape and the
     *  legacy `governed/kira-<hex>.md` shape at once, and only a URI that was actually listed can
     *  be deleted: a name rebuilt from the id removes the A1 file and leaves the other serving. */
    const found = new Map()
    // List both leaf directories: an OpenViking `ls` at the shared root may return
    // only the `remembered/` and `governed/` child directories, not their files.
    for (const branch of ['remembered', 'governed']) for (let offset = 0; ; offset += 1000) {
      let rows
      try {
        rows = await call('GET', `/api/v1/fs/ls?uri=${encodeURIComponent(`${root}/${branch}`)}&simple=true&sort_by=name&limit=1000&offset=${String(offset)}`)
      } catch (error) {
        if (error?.code === 'kira.semantic:not-found') break // never written: an empty index, not a failure
        throw error
      }
      rows = Array.isArray(rows) ? rows : []
      for (const row of rows) {
        const uri = typeof row === 'string' ? row : String(row?.uri ?? '')
        const id = idFromUri(config.user, uri)
        if (id === null) continue
        if (!found.has(id)) found.set(id, new Set())
        found.get(id).add(uri)
      }
      if (rows.length < 1000) break
    }
    return found
  }

  /** Delete ONE listed URI. Already absent is not a failure; could not be deleted is, and is
   *  REPORTED rather than swallowed, because `sync` counts a removal only when the delete landed. */
  const removeUri = async uri => {
    try { await call('DELETE', `/api/v1/fs?uri=${encodeURIComponent(uri)}`); return { uri, ok: true } }
    catch (error) {
      if (error?.code === 'kira.semantic:not-found') return { uri, ok: true, absent: true }
      return { uri, ok: false, because: String(error?.code ?? error?.message) }
    }
  }

  /** Reconcile OpenViking with the ledger: add at most `budget` missing notes now, remove every id the ledger no longer holds. */
  const sync = (ledger, options = {}) => inTurn(async () => {
    const live = ledgerShape(await ledgerNow(ledger))
    if (indexed === null || now() - listedAt > 600_000) { indexed = await listIndexed(); listedAt = now() }
    const budget = Number.isFinite(options.budget) ? Number(options.budget) : Number.POSITIVE_INFINITY
    const missing = [...live.entries.values()].filter(note => !indexed.has(note.id) && typeof note.statement === 'string' && note.statement !== '')
    const gone = live.complete === true ? [...indexed.keys()].filter(id => !live.entries.has(id)) : []
    let added = 0
    let removed = 0
    const failed = []
    for (const id of gone) {
      // EVERY SHAPE LISTED FOR THIS ID, never one name rebuilt from the id.
      const results = []
      for (const uri of indexed.get(id) ?? []) results.push(await removeUri(uri))
      const unreached = results.filter(one => one.ok !== true)
      // A REMOVAL IS COUNTED ONLY WHEN EVERY LISTED SHAPE IS GONE. Counting the attempt reports a
      // legacy file removed while it is still being served, and `indexed.delete` stops the retry.
      if (results.length === 0) failed.push(`remove ${id.slice(0, 12)}: listed with no uri`)
      else if (unreached.length === 0) { indexed.delete(id); removed += 1 }
      else failed.push(`remove ${id.slice(0, 12)}: ${unreached.map(one => String(one.because)).join('; ')}`)
    }
    for (const note of missing.slice(0, budget)) {
      try {
        await call('POST', '/api/v1/content/write', {
          uri: uriFor(config.user, note.id), content: note.statement, mode: 'replace', wait: true,
          timeout: Math.max(1, Math.round(config.timeoutMs / 1000)),
          tags: [`kira_id=${note.id}`, `tier=${note.tier === 'signed' ? 'signed' : 'remembered'}`],
        })
        indexed.set(note.id, new Set([uriFor(config.user, note.id)]))
        added += 1
      } catch (error) {
        failed.push(`add ${note.id.slice(0, 12)}: ${String(error?.code)}`)
        if (error?.code === 'kira.semantic:unreachable') break
      }
    }
    return { added, removed, pending: Math.max(0, missing.length - added), indexed: indexed.size, failed }
  })

  /** Remove a forgotten id in its turn, after a reconcile already writing it. Never throws: the answer says whether OpenViking was reached. */
  const forgetNow = async id => {
    const value = String(id)
    if (!configured || (!NOTE_ID.test(value) && !GOVERNED_ID.test(value))) return { reached: false, because: configured ? 'not a Kira memory id' : String(config?.reason) }
    // BOTH SHAPES. The write shape is always known; the LEGACY shape is known only if this index
    // listed it. A record written before the A1 rename lives at `governed/kira-<hex>.md`, and
    // removing only the A1 name leaves it serving while the forget reports it reached the server.
    const uris = new Set([uriFor(config.user, value), ...(indexed?.get(value) ?? [])])
    const results = []
    for (const uri of uris) results.push(await removeUri(uri))
    const unreached = results.find(one => one.ok !== true)
    if (unreached !== undefined) {
      return { reached: false, uri: unreached.uri, because: `${String(unreached.because)}; the next reconcile removes it, and recall never shows an id the ledger does not hold` }
    }
    indexed?.delete(value)
    return { reached: true, uri: [...uris][0] }
  }
  const forget = id => inTurn(() => forgetNow(id))

  /** Ask OpenViking, then keep ONLY hits whose id the ledger holds, above the threshold and within the window of the best. */
  const recall = async ({ question, live: ledger, accept = () => true }) => {
    const dropped = { unmapped: [], belowThreshold: 0, outsideWindow: 0, invalidScore: 0 }
    const diagnostics = []
    // WHETHER THE MEMORY STORE COULD BE READ IS REPORTED ON EVERY PATH, including the paths where
    // OpenViking could not be reached at all. An unreachable INDEX and an unreadable LEDGER are
    // different faults, and a caller that cannot tell them apart treats an unreadable store as an
    // empty one. Read here for the report; read again after the search for the filter.
    let ledgerComplete = false
    try { ledgerComplete = ledgerShape(await ledgerNow(ledger)).complete === true } catch { ledgerComplete = false }
    const up = await available()
    if (!up.ok) return { available: false, reason: up.reason, hits: [], dropped, ledgerComplete }
    let synced
    try { synced = await sync(ledger, { budget: config.syncBatch }) } catch (error) { synced = { error: String(error?.code ?? error?.message) } }
    let result
    try {
      result = await call('POST', '/api/v1/search/find', { query: `${config.queryInstruction}${String(question)}`, target_uri: root, limit: config.candidates })
    } catch (error) {
      health = { at: now(), ok: false, reason: String(error?.message) }
      return { available: false, reason: String(error?.message), hits: [], dropped, sync: synced, ledgerComplete }
    }
    // READ AFTER THE SEARCH, not before the wait for the reconcile: a note forgotten meanwhile is not shown.
    const live = ledgerShape(await ledgerNow(ledger))
    ledgerComplete = live.complete === true
    const candidates = []
    for (const hit of [...(result?.memories ?? []), ...(result?.resources ?? [])].slice(0, Math.min(50, config.candidates))) {
      const id = idFromUri(config.user, hit?.uri)
      // THE LEDGER FILTER: an id the chained store does not hold is never shown, and is removed so it stops coming back.
      const note = id === null ? undefined : live.entries.get(id)
      if (note === undefined) {
        dropped.unmapped.push(String(id ?? hit?.uri).slice(0, 160))
        if (id !== null && live.complete === true) void forget(id)
        continue
      }
      if (!accept(note)) continue // Scope/privacy exclusions are not stale index entries and must never be deleted.
      const score = Number(hit?.score)
      const tier = note.tier === 'signed' ? 'signed' : 'remembered'
      if (!Number.isFinite(score)) { dropped.invalidScore += 1; diagnostics.push({ id, tier, score: null, reason: 'invalid-score' }); continue }
      // Independent lexical evidence can rescue a weak embedding match. Two distinct
      // content words, at least half the question, never retrieval frequency or tier.
      const terms = [...new Set(contentWords(question))]
      const words = new Set(contentWords(note.statement))
      const overlap = terms.filter(term => words.has(term)).length
      const lexical = score > 0 && overlap >= Math.max(2, Math.ceil(terms.length / 2))
      if (score < config.scoreThreshold && !lexical) {
        dropped.belowThreshold += 1
        diagnostics.push({ id, tier, score, reason: 'below-threshold', lexicalOverlap: overlap })
        continue
      }
      if (!candidates.some(one => one.id === id)) candidates.push({ id, score, note, tier,
        relevance: score >= config.scoreThreshold ? 'semantic-threshold' : 'lexical-corroboration', lexicalOverlap: overlap })
    }
    candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    // A4: THE WINDOW IS MEASURED WITHIN A TIER, NOT FROM THE BEST SCORE OVERALL. Measured from the
    // global best (usually an ambient note), a governed record that cleared the threshold on its
    // own was discarded because ambient text scored `window` higher — so its reserved slots stayed
    // empty and governed memory was reachable only by near-tying the best ambient match.
    const byTier = eligibleByTier(candidates, { threshold: config.scoreThreshold, window: config.window })
    const preferred = new Set([...byTier.ambient, ...byTier.governed].map(one => one.id))
    dropped.outsideWindow = candidates.filter(one => one.score >= config.scoreThreshold && !preferred.has(one.id)).length
    // The window is a precision preference, not grounds to leave usable capacity empty.
    // Governed still has first use of its reservation and may never exceed it.
    const ordered = signed => candidates.filter(one => (one.tier === 'signed') === signed)
      .sort((a, b) => Number(preferred.has(b.id)) - Number(preferred.has(a.id)) || b.score - a.score || a.id.localeCompare(b.id))
    const reserved = mergeReservedSlots({ ambient: ordered(false), governed: ordered(true),
      ceiling: config.limit, reserved: GOVERNED_RESERVED_SLOTS })
    const selected = new Set(reserved.selected.map(one => one.id))
    for (const one of candidates) diagnostics.push({ id: one.id, tier: one.tier, score: one.score,
      reason: !selected.has(one.id) ? 'capacity' : one.relevance === 'lexical-corroboration' ? one.relevance
        : preferred.has(one.id) ? 'semantic-threshold' : 'window-backfill', lexicalOverlap: one.lexicalOverlap })

    const byId = new Map(candidates.map(one => [one.id, one]))
    const hits = reserved.selected.map(slot => ({ ...byId.get(slot.id), slot: slot.slot }))
    return { available: true, hits, dropped, reserved, diagnostics, threshold: config.scoreThreshold, window: config.window, sync: synced, ledgerComplete }
  }

  return Object.freeze({ configured, reason: configured ? undefined : config?.reason, available, sync, forget, recall })
}

/**
 * `kira_recall`'s `remembered` field for semantic hits, in the lexical field's own shape plus the score. Every value but
 * the score and the order is the note file's.
 */
export function semanticNotes(answer, chars = 600) {
  return Object.freeze({
    state: 'found', method: SEMANTIC_METHOD, grantsAuthority: false,
    notes: answer.hits.map(({ id, score, note, slot, relevance }) => ({
      id, text: String(note.statement).slice(0, chars), observedAt: note.observedAt ?? null, score,
      tier: note.tier === 'signed' ? 'signed' : 'remembered', slot, relevance, attributedTo: note.attributedTo, scope: note.scope,
      source: { sessionId: note.source?.sessionId ?? null, seq: note.source?.seq ?? null }, bodyAtCapture: note.bodyAtCapture ?? null,
      rememberedChain: { index: note.aura?.index ?? null, entryHash: note.aura?.entryHash ?? null },
    })),
    droppedUnmapped: answer.dropped.unmapped.length, droppedBelowThreshold: answer.dropped.belowThreshold,
    outsideWindow: answer.dropped.outsideWindow, diagnostics: answer.diagnostics ?? [], threshold: answer.threshold, window: answer.window,
    ...(answer.reserved === undefined ? {} : { reserved: answer.reserved }),
    ...(answer.sync === undefined ? {} : { index: answer.sync }),
    ceiling: SEMANTIC_CEILING,
  })
}
