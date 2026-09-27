/**
 * OPENVIKING FINDS; THE CHAINED STORE ANSWERS.
 *
 * OpenViking (AGPL-3.0, pinned in `vendor/openviking/upstream-openviking.json`, installed by `scripts/openviking-setup.sh`)
 * is Kira's semantic FINDER over remembered notes, and nothing more:
 *
 *   · INDEX. Every live remembered note is one file, `viking://user/<user>/memories/kira/remembered/rem-<hex>.md`, tagged
 *     `kira_id=rem:<hex>`. `sync` reconciles it with the ledger: a note the ledger holds and OpenViking does not is added; an
 *     id OpenViking holds and the ledger no longer does (forgotten, hidden, unchained) is removed. Capture never waits for
 *     it: the note is written and chained first, and indexed afterwards, so a server that is down only delays the index.
 *   · FIND. A question goes to OpenViking; each hit is mapped back by id to the LEDGER (`liveRemembered` in memory-deps.mjs:
 *     a readable note, not forgotten, not hidden, whose entry is in the remembered Aura chain). A hit the ledger does not hold
 *     is DROPPED, counted and removed. The text and `bodyAtCapture` a caller sees are the note file's, never OpenViking's.
 *   · FORGET. A forgotten note is removed at once, and by the next reconcile if that removal could not reach the server.
 *
 * It grants nothing, raises no approval and writes nothing into the Kira store. It is off unless the OpenViking home holds
 * `aukora-bridge.json`. WHERE THE WORDS GO: to the loopback server that file names, and on to the embedding model in its
 * `ov.conf`; a model endpoint off this machine is refused unless the bridge file says `"allowRemoteModels": true`.
 *
 * @module @aukora/dsh-plugin-kira/recall-openviking
 */
import { dirname } from 'node:path'
import { readJsonStrict, readTextStrict, stateExists } from './strict-read.mjs'

/** The method name every semantic answer carries. */
export const SEMANTIC_METHOD = 'openviking-semantic'

/** A remembered note's id. Anything else is not a Kira note and is never indexed or shown. */
const NOTE_ID = /^rem:[0-9a-f]{64}$/u

/** Defaults; `aukora-bridge.json` overrides each. Thresholds measured on ten notes with Qwen3-Embedding-0.6B. */
export const SEMANTIC_DEFAULTS = Object.freeze({
  account: 'aukora', user: 'owner', scoreThreshold: 0.4, window: 0.1, limit: 3, candidates: 12, timeoutMs: 8000, syncBatch: 32,
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

/** The OpenViking URI for one note id. */
export function uriFor(user, id) {
  if (!NOTE_ID.test(String(id))) throw new Error(`kira.semantic: ${String(id).slice(0, 24)} is not a remembered note id`)
  return `viking://user/${user}/memories/kira/remembered/rem-${String(id).slice(4)}.md`
}

/** The note id a URI names, or null. */
export function idFromUri(user, uri) {
  const match = String(uri).match(new RegExp(`^viking://user/${user}/memories/kira/remembered/rem-([0-9a-f]{64})\\.md$`, 'u'))
  return match === null ? null : `rem:${match[1]}`
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
  const ledgerNow = ledger => (typeof ledger === 'function' ? ledger() : ledger)

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
    const ids = new Set()
    for (let offset = 0; ; offset += 1000) {
      let rows
      try {
        rows = await call('GET', `/api/v1/fs/ls?uri=${encodeURIComponent(`${root}/remembered`)}&simple=true&sort_by=name&limit=1000&offset=${String(offset)}`)
      } catch (error) {
        if (error?.code === 'kira.semantic:not-found') break // never written: an empty index, not a failure
        throw error
      }
      rows = Array.isArray(rows) ? rows : []
      for (const row of rows) {
        const id = idFromUri(config.user, typeof row === 'string' ? row : String(row?.uri ?? ''))
        if (id !== null) ids.add(id)
      }
      if (rows.length < 1000) break
    }
    return ids
  }

  const removeId = id => call('DELETE', `/api/v1/fs?uri=${encodeURIComponent(uriFor(config.user, id))}`)
    .catch(error => { if (error?.code !== 'kira.semantic:not-found') throw error })

  /** Reconcile OpenViking with the ledger: add at most `budget` missing notes now, remove every id the ledger no longer holds. */
  const sync = (ledger, options = {}) => inTurn(async () => {
    const live = ledgerNow(ledger)
    if (indexed === null || now() - listedAt > 600_000) { indexed = await listIndexed(); listedAt = now() }
    const budget = Number.isFinite(options.budget) ? Number(options.budget) : Number.POSITIVE_INFINITY
    const missing = [...live.entries.values()].filter(note => !indexed.has(note.id) && typeof note.statement === 'string' && note.statement !== '')
    const gone = live.complete === true ? [...indexed].filter(id => !live.entries.has(id)) : []
    let added = 0
    let removed = 0
    const failed = []
    for (const id of gone) {
      try { await removeId(id); indexed.delete(id); removed += 1 } catch (error) { failed.push(`remove ${id.slice(0, 12)}: ${String(error?.code)}`) }
    }
    for (const note of missing.slice(0, budget)) {
      try {
        await call('POST', '/api/v1/content/write', {
          uri: uriFor(config.user, note.id), content: note.statement, mode: 'replace', wait: true,
          timeout: Math.max(1, Math.round(config.timeoutMs / 1000)), tags: [`kira_id=${note.id}`],
        })
        indexed.add(note.id)
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
    if (!configured || !NOTE_ID.test(String(id))) return { reached: false, because: configured ? 'not a remembered note id' : String(config?.reason) }
    const uri = uriFor(config.user, String(id))
    try {
      await removeId(String(id))
      indexed?.delete(String(id))
      return { reached: true, uri }
    } catch (error) {
      return { reached: false, uri, because: `${String(error?.message)}; the next reconcile removes it, and recall never shows an id the ledger does not hold` }
    }
  }
  const forget = id => inTurn(() => forgetNow(id))

  /** Ask OpenViking, then keep ONLY hits whose id the ledger holds, above the threshold and within the window of the best. */
  const recall = async ({ question, live: ledger }) => {
    const dropped = { unmapped: [], belowThreshold: 0 }
    const up = await available()
    if (!up.ok) return { available: false, reason: up.reason, hits: [], dropped }
    let synced
    try { synced = await sync(ledger, { budget: config.syncBatch }) } catch (error) { synced = { error: String(error?.code ?? error?.message) } }
    let result
    try {
      result = await call('POST', '/api/v1/search/find', { query: `${config.queryInstruction}${String(question)}`, target_uri: root, limit: config.candidates })
    } catch (error) {
      health = { at: now(), ok: false, reason: String(error?.message) }
      return { available: false, reason: String(error?.message), hits: [], dropped, sync: synced }
    }
    // READ AFTER THE SEARCH, not before the wait for the reconcile: a note forgotten meanwhile is not shown.
    const live = ledgerNow(ledger)
    const candidates = []
    for (const hit of [...(result?.memories ?? []), ...(result?.resources ?? [])]) {
      const id = idFromUri(config.user, hit?.uri)
      // THE LEDGER FILTER: an id the chained store does not hold is never shown, and is removed so it stops coming back.
      const note = id === null ? undefined : live.entries.get(id)
      if (note === undefined) {
        dropped.unmapped.push(String(id ?? hit?.uri).slice(0, 160))
        if (id !== null && live.complete === true) void forget(id)
        continue
      }
      const score = Number(hit?.score)
      if (!Number.isFinite(score) || score < config.scoreThreshold) { dropped.belowThreshold += 1; continue }
      if (!candidates.some(one => one.id === id)) candidates.push({ id, score, note })
    }
    candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    const best = candidates[0]?.score ?? 0
    const hits = candidates.filter(one => best - one.score <= config.window).slice(0, config.limit)
    dropped.belowThreshold += candidates.length - hits.length
    return { available: true, hits, dropped, sync: synced }
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
    notes: answer.hits.map(({ id, score, note }) => ({
      id, text: String(note.statement).slice(0, chars), observedAt: note.observedAt ?? null, score,
      source: { sessionId: note.source?.sessionId ?? null, seq: note.source?.seq ?? null }, bodyAtCapture: note.bodyAtCapture ?? null,
      rememberedChain: { index: note.aura?.index ?? null, entryHash: note.aura?.entryHash ?? null },
    })),
    droppedUnmapped: answer.dropped.unmapped.length, droppedBelowThreshold: answer.dropped.belowThreshold,
    ...(answer.sync === undefined ? {} : { index: answer.sync }),
    ceiling: SEMANTIC_CEILING,
  })
}
