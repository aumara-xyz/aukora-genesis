import { sha256Hex, MEMORY_TIER, MEMORY_STORAGE } from './memory-tiers.mjs'
import { memoryQuality, verifyContentHash } from './memory-quality.mjs'
import { dirname } from 'node:path'
import { readJsonStrict, readTextStrict, stateExists, durableWrite, ensureDirectory, withFileLock } from './strict-read.mjs'
import { SEMANTIC_WINDOW } from './reserved-slots.mjs'

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
  if (NOTE_ID.test(value)) return `viking://user/${user}/memories/kira/${MEMORY_STORAGE.remembered}/rem-${value.slice(4)}.md`
  if (GOVERNED_ID.test(value)) return `viking://user/${user}/memories/kira/${MEMORY_STORAGE.governed}/${value.slice(5)}.md`
  throw new Error(`kira.semantic: ${value.slice(0, 24)} is not a Kira memory id`)
}

/** The note id a URI names, or null. READ accepts A1 governed/<hex>.md and legacy governed/kira-<hex>.md. */
export function idFromUri(user, uri) {
  const value = String(uri)
  const ambient = value.match(new RegExp(`^viking://user/${user}/memories/kira/remembered/rem-([0-9a-f]{64})\\.md$`, 'u'))
  if (ambient !== null) return `rem:${ambient[1]}`
  const governed = value.match(new RegExp(`^viking://user/${user}/memories/kira/governed/(?:kira-)?([0-9a-f]{64})\\.md$`, 'u'))
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

/** URI identity is the SHA-256 of the exact UTF-8 capture bytes, never a title or summary. */
export function contentUri(user, hash) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/u.test(user) || !/^[0-9a-f]{64}$/u.test(hash)) throw new Error('memory-uri-invalid')
  return `viking://user/${user}/memories/kira/${MEMORY_STORAGE.content}/${hash}.md`
}

export function createOpenVikingRecall(input) {
  const config = { ...SEMANTIC_DEFAULTS, ...input?.config }
  config.timeoutMs = Number.isFinite(config.timeoutMs) ? Math.max(1, Math.min(30_000, config.timeoutMs)) : SEMANTIC_DEFAULTS.timeoutMs
  const syncBudget = value => Number.isInteger(value) && value >= 0 ? Math.min(8, value) : 8
  const configured = config.configured === true
  const doFetch = input.fetch ?? globalThis.fetch
  const root = `viking://user/${config.user}/memories/kira`
  const acknowledgementFile = input.stateDir ? `${input.stateDir}/remembered/index/ack.json` : null
  let acknowledgements = {}
  // Loading a bridge during initialization must not read its growing index ledger.
  const readAcknowledgements = () => {
    if (acknowledgementFile) {
      try { acknowledgements = readJsonStrict(acknowledgementFile) }
      catch { acknowledgements = {} /* missing acknowledgement remains retryable */ }
      if (!acknowledgements || Array.isArray(acknowledgements) || typeof acknowledgements !== 'object') acknowledgements = {}
    }
  }
  let serial = Promise.resolve()
  const inTurn = task => { const next = serial.then(task); serial = next.catch(() => {}); return next }
  const ledgerNow = async source => {
    const value = typeof source === 'function' ? await source() : source
    const entries = value?.entries instanceof Map ? value.entries : new Map([...(value?.ambient ?? []), ...(value?.governed ?? [])])
    return { ...value, entries, complete: value?.complete === true }
  }
  const hashOf = note => note.contentHash
  const call = async (method, path, body) => {
    try {
      const response = await doFetch(`${config.url}${path}`, { method, redirect: 'error',
        headers: { 'content-type': 'application/json', 'x-api-key': config.key ?? '', 'x-openviking-account': config.account, 'x-openviking-user': config.user },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(config.timeoutMs) })
      const parsed = await response.json()
      if (!response.ok || parsed?.status !== 'ok') throw new OpenVikingError(response.status === 404 ? 'not-found' : 'refused', 'index request refused')
      return parsed.result
    } catch (error) {
      if (error instanceof OpenVikingError) throw error
      throw new OpenVikingError('unreachable', 'index request failed')
    }
  }
  const available = async () => {
    if (!configured) return { ok: false, reason: config.reason ?? 'openviking-not-configured' }
    try {
      const response = await doFetch(`${config.url}/health`, { redirect: 'error', signal: AbortSignal.timeout(Math.min(2000, config.timeoutMs)) })
      return response.ok && (await response.json()).healthy === true ? { ok: true } : { ok: false, reason: 'openviking-unhealthy' }
    } catch { return { ok: false, reason: 'openviking-unreachable' } }
  }
  const idsOf = entry => Array.isArray(entry) ? entry : Array.isArray(entry?.ids) ? entry.ids : []
  const ack = (uri, ids, hash = uri.match(/\/content\/([0-9a-f]{64})\.md$/u)?.[1] ?? null, removal = null) => {
    const value = ids === null ? null : { ids, contentHash: hash, storageTier: uri.split('/').at(-2), ...(removal ? { removal } : {}) }
    acknowledgements[uri] = value
    if (acknowledgementFile) {
      // Multiple capture processes can share a store. Merge under the chain's lock.
      ensureDirectory(dirname(acknowledgementFile))
      withFileLock(acknowledgementFile, () => {
        let current = {}
        if (stateExists(acknowledgementFile)) { try { current = readJsonStrict(acknowledgementFile) } catch {} }
        if (!current || Array.isArray(current) || typeof current !== 'object') current = {}
        if (ids === null) delete current[uri]
        else current[uri] = value
        acknowledgements = current
        durableWrite(acknowledgementFile, `${JSON.stringify(current)}\n`, { dir: dirname(acknowledgementFile) })
      }, { waitMs: 0 })
    } else if (ids === null) delete acknowledgements[uri]
  }
  const removeUri = async uri => {
    try { await call('DELETE', `/api/v1/fs?uri=${encodeURIComponent(uri)}`) }
    catch (error) { if (error.code !== 'kira.semantic:not-found') throw error }
  }
  let auditOffset = 0
  const auditAcknowledged = async (grouped, budget = config.syncBatch) => {
    const uris = Object.keys(acknowledgements).filter(uri => grouped.has(uri))
    const unreadable = [], tampered = [], failed = []
    const count = Math.min(uris.length, syncBudget(budget))
    let requests = 0
    for (let i = 0; i < count; i++) {
      const uri = uris[(auditOffset + i) % uris.length]
      try {
        requests++
        const bytes = await call('GET', `/api/v1/content/read?uri=${encodeURIComponent(uri)}`)
        if (typeof bytes !== 'string') { ack(uri, null); unreadable.push(uri) }
        else if (grouped.get(uri).some(note => note.statement !== bytes || hashOf(note) !== sha256Hex(bytes))
          || (acknowledgements[uri]?.contentHash != null && acknowledgements[uri].contentHash !== sha256Hex(bytes))) tampered.push(uri)
        else if (acknowledgements[uri]?.contentHash == null) ack(uri, grouped.get(uri).map(note => note.id), sha256Hex(bytes))
      } catch (error) {
        if (error.code === 'kira.semantic:not-found') { ack(uri, null); unreadable.push(uri) }
        else { failed.push('index-audit-failed'); break }
      }
    }
    auditOffset = uris.length ? (auditOffset + requests) % uris.length : 0
    return { unreadable, tampered, failed, requests }
  }
  const groupLedger = live => {
    const grouped = new Map()
    for (const note of live.entries.values()) {
      if (!verifyContentHash(note.statement, hashOf(note)).ok || !memoryQuality(note.statement).keep) continue
      const uri = contentUri(config.user, hashOf(note))
      if (!grouped.has(uri)) grouped.set(uri, [])
      grouped.get(uri).push(note)
    }
    return grouped
  }
  // Every verified note's content URI, whatever its quality. A note below the floor is never written,
  // but a vector indexed for it before the floor existed stays where it is (recall drops it on read):
  // sync removes only vectors whose notes left the ledger (forgotten, hidden, changed or gone).
  const retainedOf = live => new Set([...live.entries.values()]
    .filter(note => verifyContentHash(note.statement, hashOf(note)).ok).map(note => contentUri(config.user, hashOf(note))))
  const sync = (source, options = {}) => inTurn(async () => {
    if (!configured) return { added: 0, removed: 0, requests: 0, pending: 0, failed: ['openviking-not-configured'] }
    readAcknowledgements()
    const live = await ledgerNow(options.snapshot ?? source), grouped = groupLedger(live), retained = retainedOf(live)
    const budget = syncBudget(options.budget ?? config.syncBatch)
    let added = 0, removed = 0, requests = 0
    const failed = [], written = []
    const remove = async uri => {
      requests++
      try { await removeUri(uri); ack(uri, null); removed++ }
      catch { failed.push('remove-failed') }
    }
    if (live.complete) for (const uri of Object.keys(acknowledgements)) if (uri.startsWith(`${root}/`) && !grouped.has(uri) && !retained.has(uri)) {
      if (requests >= budget || failed.length) break
      await remove(uri)
    }
    const missing = [...grouped].filter(([uri]) => !acknowledgements[uri])
    const priority = new Set(options.priorityHashes ?? [])
    const current = missing.filter(([, notes]) => priority.has(hashOf(notes[0])))
    const older = missing.filter(([, notes]) => !priority.has(hashOf(notes[0])))
    // New captures get the first bounded batch; a large old outbox cannot starve this turn.
    // One request budget covers deletes, writes, audits and forget-race cleanup together.
    const selected = [...current, ...older].slice(0, Math.max(0, budget - requests))
    for (const [uri, notes] of selected) {
      if (failed.length) break
      try {
        requests++
        await call('POST', '/api/v1/content/write', { uri, content: notes[0].statement, mode: 'replace', wait: true,
          timeout: Math.max(1, Math.round(config.timeoutMs / 1000)), tags: [`contentHash=${hashOf(notes[0])}`, `content_sha256=${hashOf(notes[0])}`, `storageTier=${MEMORY_STORAGE.content}`, 'source=kira-memory'] })
        // Keep a durable deletion target even if a forget races this write and the budget is spent.
        ack(uri, notes.map(note => note.id)); written.push(uri)
      } catch { failed.push('index-write-failed'); break }
    }
    // One latest snapshot after the entire async batch protects forget races without an N-by-N store scan.
    let latest = requests ? await ledgerNow(source) : live, latestGroups = groupLedger(latest)
    for (const uri of written) {
      const alive = latestGroups.get(uri) ?? []
      if (!alive.length) {
        if (latest.complete && requests < budget && !failed.length) await remove(uri)
        continue
      }
      ack(uri, alive.map(note => note.id)); added++
    }
    const audit = options.verifyAcknowledged && !failed.length
      ? await auditAcknowledged(latestGroups, budget - requests) : { unreadable: [], tampered: [], failed: [], requests: 0 }
    requests += audit.requests; failed.push(...audit.failed)
    if (audit.tampered.length) failed.push('index-content-mismatch')
    if (audit.requests) { latest = await ledgerNow(source); latestGroups = groupLedger(latest) }
    const latestRetained = latest.complete ? retainedOf(latest) : null
    return { added, removed, pending: [...latestGroups.keys()].filter(uri => !acknowledgements[uri]).length,
      removalPending: latestRetained ? Object.keys(acknowledgements).filter(uri => uri.startsWith(`${root}/`) && !latestGroups.has(uri)
        && !latestRetained.has(uri)).length : null,
      indexed: Object.keys(acknowledgements).length, failed, audit, requests, budget }
  })
  const forget = id => inTurn(async () => {
    readAcknowledgements()
    const uris = Object.entries(acknowledgements).filter(([, entry]) => idsOf(entry).includes(id)).map(([uri]) => uri)
    if (NOTE_ID.test(id) || GOVERNED_ID.test(id)) uris.push(uriFor(config.user, id))
    if (GOVERNED_ID.test(id)) uris.push(`${root}/governed/kira-${id.slice(5)}.md`)
    let failedUri
    for (const uri of new Set(uris)) {
      try { await removeUri(uri); ack(uri, null) }
      catch { ack(uri, [id], acknowledgements[uri]?.contentHash ?? null, 'forget'); failedUri ??= uri }
    }
    return failedUri ? { reached: false, uri: failedUri, because: 'index deletion pending; recall excludes forgotten records' }
      : { reached: true, uri: uris[0] }

  })
  const recall = async ({ question, live: source, accept = () => true, candidates: readCandidates, govern = notes => notes, limit = config.limit }) => {
    const dropped = { unmapped: [], tampered: [], unreadable: [], belowThreshold: 0, outsideWindow: 0, invalidScore: 0, quality: 0 }
    const diagnostics = []
    let live = await ledgerNow(source)
    const up = await available()
    if (!up.ok) {
      live = await ledgerNow(source)
      return { available: false, reason: up.reason, hits: [], dropped, ledgerComplete: live.complete }
    }
    let synced
    try { synced = await sync(source, { budget: config.syncBatch, snapshot: live }) } catch { synced = { failed: ['index-sync-failed'] } }
    let result
    try { result = await call('POST', '/api/v1/search/find', { query: `${config.queryInstruction}${String(question)}`, target_uri: `${root}/${MEMORY_STORAGE.content}`, limit: config.candidates }) }
    catch {
      live = await ledgerNow(source)
      return { available: false, reason: 'semantic-recall-failed', hits: [], dropped, ledgerComplete: live.complete }
    }
    const candidateNotes = typeof readCandidates === 'function' ? await readCandidates() : []
    // Read content concurrently, then govern everything with one latest ledger after network I/O.
    const byUri = new Map()
    for (const note of live.entries.values()) {
      if (!verifyContentHash(note.statement, hashOf(note)).ok) continue
      const uri = contentUri(config.user, hashOf(note))
      if (!byUri.has(uri)) byUri.set(uri, [])
      byUri.get(uri).push(note.id)
    }
    // Rank the combined lists before spending the read budget. The first URI/ID
    // occurrence must carry its strongest score, not whichever list came first.
    const candidates = [...(result?.memories ?? []), ...(result?.resources ?? [])]
      .map(hit => ({ hit, score: Number(hit?.score) }))
      .sort((a, b) => {
        if (!Number.isFinite(a.score)) return Number.isFinite(b.score) ? 1 : 0
        if (!Number.isFinite(b.score)) return -1
        return b.score - a.score
      })
    const seenUris = new Set()
    const selected = candidates.filter(({ hit }) => {
      const uri = String(hit?.uri ?? '')
      if (seenUris.has(uri)) return false
      seenUris.add(uri)
      return true
    }).slice(0, config.candidates)
    const reads = await Promise.all(selected.map(async ({ hit, score }) => {
      const uri = String(hit?.uri ?? '')
      const named = idFromUri(config.user, uri)
      const ids = byUri.get(uri) ?? (named && live.entries.has(named) ? [named] : [])
      if (!uri.startsWith(`${root}/`) || !ids.length) return { uri, ids: [], unmapped: true }
      try { return { uri, ids, score, bytes: await call('GET', `/api/v1/content/read?uri=${encodeURIComponent(uri)}`) } }
      catch (error) { return { uri, ids, unreadable: true, unavailable: error.code !== 'kira.semantic:not-found' } }
    }))
    live = await ledgerNow(source)
    if (reads.some(read => read.unavailable)) return { available: false, reason: 'semantic-recall-failed', hits: [],
      dropped: { ...dropped, unreadable: reads.filter(read => read.unreadable).map(read => read.uri) }, ledgerComplete: live.complete }
    const verified = [], raw = []
    for (const read of reads) {
      const { uri, score, bytes, ids } = read
      if (read.unmapped) { dropped.unmapped.push(uri); continue }
      if (read.unreadable || typeof bytes !== 'string') { dropped.unreadable.push(uri); ack(uri, null); continue }
      const matches = ids.map(id => live.entries.get(id)).filter(Boolean)
      if (!matches.length) { dropped.unmapped.push(uri); continue }
      if (typeof bytes !== 'string' || matches.some(note => hashOf(note) !== sha256Hex(bytes) || note.statement !== bytes)
        || (acknowledgements[uri]?.contentHash != null && acknowledgements[uri].contentHash !== sha256Hex(bytes))) {
        dropped.tampered.push(uri); diagnostics.push({ reason: 'content-hash-mismatch', uri }); continue
      }
      if (!memoryQuality(bytes).keep) { dropped.quality++; continue }
      if (!Number.isFinite(score)) { dropped.invalidScore++; continue }
      if (score < config.scoreThreshold) { dropped.belowThreshold++; continue }
      for (const note of matches) if (!raw.some(one => one.id === note.id)) raw.push({ id: note.id, score, note, uri, tier: MEMORY_TIER.remembered, relevance: 'semantic-threshold' })
    }
    if (candidateNotes.length) govern(candidateNotes, live)
    const filtered = new Map(govern(raw.map(hit => hit.note), live).map(note => [note.id, note]))
    // A rebuilt index may return no hits at all. Probe a bounded rotating acknowledgement batch;
    // missing documents become durable retries, while changed bytes stay withheld, never overwritten.
    if (reads.length === 0) {
      const audit = await inTurn(() => auditAcknowledged(groupLedger(live)))
      dropped.unreadable.push(...audit.unreadable); dropped.tampered.push(...audit.tampered)
      live = await ledgerNow(source)
      if (audit.failed.length) return { available: false, reason: 'semantic-recall-failed', hits: [], dropped, ledgerComplete: live.complete }
    }
    for (const hit of raw) {
      const note = filtered.get(hit.id)
      if (note && accept(note)) verified.push({ ...hit, note })
    }
    verified.sort((a, b) => b.score - a.score || String(b.note.observedAt ?? '').localeCompare(String(a.note.observedAt ?? '')) || (Number.isSafeInteger(b.note.aura?.index) ? b.note.aura.index : -1) - (Number.isSafeInteger(a.note.aura?.index) ? a.note.aura.index : -1) || a.id.localeCompare(b.id))
    const hits = verified.slice(0, Math.max(1, Math.min(50, limit)))
    return { available: true, hits, dropped, diagnostics, threshold: config.scoreThreshold, sync: synced, ledgerComplete: live.complete }
  }
  const listLegacy = async () => {
    const found = []
    const visit = async (uri, depth = 0) => {
      if (depth > 12) throw new Error('memory-legacy-tree-too-deep')
      for (let offset = 0; ; offset += 1000) {
        let rows
        try { rows = await call('GET', `/api/v1/fs/ls?uri=${encodeURIComponent(uri)}&simple=false&limit=1000&offset=${offset}`) }
        catch (error) { if (error.code === 'kira.semantic:not-found') return; throw error }
        if (!Array.isArray(rows)) throw new Error('memory-legacy-list-invalid')
        for (const row of rows) {
          const child = typeof row === 'string' ? row : row.uri
          if (typeof child !== 'string' || !child.startsWith(`${uri}/`) || child.startsWith(`${root}/content/`)) continue
          if (/\.(md|txt)$/u.test(child)) found.push(child)
          else if (typeof row === 'object' && (row.is_dir || row.isDir || row.type === 'directory')) await visit(child, depth + 1)
        }
        if (rows.length < 1000) return
      }
    }
    await visit(`viking://user/${config.user}/memories`)
    return found
  }
  const readContent = uri => {
    if (!String(uri).startsWith(`viking://user/${config.user}/memories/`)) throw new Error('memory-legacy-uri-out-of-scope')
    return call('GET', `/api/v1/content/read?uri=${encodeURIComponent(uri)}`)
  }
  return Object.freeze({ configured, reason: config.reason, available, sync, forget, recall, listLegacy, readContent })
}

export function semanticNotes(answer, chars = 600) {
  return { state: answer.hits.length ? 'found' : 'empty', method: SEMANTIC_METHOD, grantsAuthority: false,
    notes: answer.hits.map(({ id, score, note, relevance, uri }) => ({ id, text: note.statement.slice(0, chars), score,
      contentHash: note.contentHash, contentHashScope: 'full-statement', uri, observedAt: note.observedAt ?? null,
      tier: MEMORY_TIER.remembered, relevance, attributedTo: note.attributedTo, scope: note.scope, source: note.source,
      bodyAtCapture: note.bodyAtCapture ?? null, rememberedChain: note.aura,
      advisoryOnly: true, grantsAuthority: false, containment: note.containment, staleness: note.staleness })),
    droppedUnmapped: answer.dropped.unmapped.length, droppedTampered: answer.dropped.tampered.length,
    droppedUnreadable: answer.dropped.unreadable.length, droppedBelowThreshold: answer.dropped.belowThreshold,
    hashMismatches: answer.dropped.tampered.length, droppedQuality: answer.dropped.quality ?? 0,
    ...(answer.diagnostics === undefined ? {} : { diagnostics: answer.diagnostics }), threshold: answer.threshold,
    ...(answer.sync === undefined ? {} : { index: answer.sync }), ceiling: SEMANTIC_CEILING }
}
