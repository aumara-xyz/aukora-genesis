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
