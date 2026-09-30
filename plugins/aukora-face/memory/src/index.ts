/** Face-owned OpenViking adapter. Kira remains the only authority for Kira notes. */
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { access, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { semanticLayout } from './constellation-layout.ts'

export const MEMORY_OPENVIKING_ROUTES = {
  remembered: '/api/aukora/memory/remembered',
  list: '/api/aukora/memory/openviking',
  forget: '/api/aukora/memory/openviking/forget',
  constellation: '/api/aukora/memory/constellation',
  constellationSearch: '/api/aukora/memory/constellation/search',
  threeModule: '/api/aukora/memory/three/r180/three.module.min.js',
  threeCore: '/api/aukora/memory/three/r180/three.core.min.js',
} as const
export const inject = ['webServer', 'connection']
type Row = Record<string, unknown>
interface VikingConfig { url: string; key: string; account: string; user: string; queryInstruction: string }
const object = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}

class MemoryFaceError extends Error {
  constructor(readonly code: string, readonly status = 502) { super(code) }
}

function memoryStateDirectory(): string {
  return join(process.env.AUKORA_SUPPORT_ROOT ?? join(homedir(), 'Library/Application Support/AUKORA'), 'state/home/kira-memory')
}

/** Releases flatten face directories; source worktrees keep the extra aukora-face directory. */
async function loadKiraMemoryReaderModule(name: 'memory-deps' | 'recall-openviking'): Promise<Record<string, (...args: any[]) => any>> {
  for (const relative of [`../../aukora-kira/lib/${name}.mjs`, `../../../aukora-kira/lib/${name}.mjs`]) {
    const url = new URL(relative, import.meta.url)
    try { await access(url) } catch { continue }
    return await import(/* @vite-ignore */ url.href)
  }
  throw new MemoryFaceError('memory:kira-reader-unavailable', 503)
}

/** Read the existing chained ledger without constructing a memory owner or creating directories. */
export async function readFaceLiveRemembered(): Promise<Row[]> {
  const { buildRouteDeps } = await loadKiraMemoryReaderModule('memory-deps')
  const stateDir = memoryStateDirectory()
  const ledger = buildRouteDeps!({ stateDir, sessionsRoot: join(stateDir, '..') }).liveRemembered()
  if (!Array.isArray(ledger.notes) || ledger.unreadable > 0) throw new MemoryFaceError('memory:kira-unreadable', 503)
  return ledger.notes
}

/** Installed configuration keeps Kira's model-locality/consent checks. Scratch overrides inherit no key. */
export async function memoryOpenVikingConfig(): Promise<VikingConfig> {
  const installed = join(homedir(), 'Library/Application Support/AUKORA')
  const support = process.env.AUKORA_SUPPORT_ROOT ?? installed
  const override = process.env.AUKORA_MEMORY_OPENVIKING_URL
  if (resolve(support) !== resolve(installed) && !override) throw new MemoryFaceError('memory:scratch-endpoint-required', 503)
  let config: Row
  if (override) {
    config = { url: override, key: process.env.AUKORA_MEMORY_OPENVIKING_KEY ?? '',
      account: process.env.AUKORA_MEMORY_OPENVIKING_ACCOUNT ?? 'aukora', user: process.env.AUKORA_MEMORY_OPENVIKING_USER ?? 'owner',
      queryInstruction: process.env.AUKORA_MEMORY_OPENVIKING_QUERY_INSTRUCTION ?? '' }
  } else {
    const { readBridgeConfig, openVikingHome } = await loadKiraMemoryReaderModule('recall-openviking')
    config = readBridgeConfig!(openVikingHome!(memoryStateDirectory()))
    if (config.configured !== true) throw new MemoryFaceError('memory:openviking-config-refused', 503)
  }
  let url: URL
  try { url = new URL(String(config.url ?? 'http://127.0.0.1:1933')) } catch { throw new MemoryFaceError('memory:invalid-endpoint', 503) }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new MemoryFaceError('memory:invalid-endpoint', 503)
  const account = String(config.account)
  const user = String(config.user)
  if (![account, user].every(value => /^[a-zA-Z0-9_-]{1,64}$/u.test(value))) throw new MemoryFaceError('memory:invalid-identity', 503)
  return { url: url.origin, key: String(config.key ?? ''), account, user, queryInstruction: String(config.queryInstruction ?? '') }
}

async function vikingCall(config: VikingConfig, path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`${config.url}${path}`, {
      method, redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]),
      headers: { 'content-type': 'application/json', 'x-openviking-account': config.account,
        'x-openviking-user': config.user, ...(config.key ? { 'x-api-key': config.key } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch { throw new MemoryFaceError(signal?.aborted ? 'memory:constellation-timeout' : 'memory:openviking-unreachable', 503) }
  const answer = object(await response.json().catch(() => null))
  if (!response.ok || answer.status !== 'ok') throw new MemoryFaceError(
    response.status === 404 ? 'memory:openviking-not-found' : 'memory:openviking-refused', response.status === 404 ? 404 : 502,
  )
  return answer.result
}

/** Accept only visible, single memory files; never Kira's mirrored index or a signed/governed namespace. */
export function isFaceOwnedVikingMemory(uri: string, user: string): boolean {
  if (!uri.startsWith(`viking://user/${user}/`) || /[%?#\\\s]/u.test(uri)) return false
  const parts = uri.slice(`viking://user/${user}/`.length).split('/')
  if (parts.some(part => !part || part.startsWith('.') || ['kira', 'signed', 'governed', 'authority'].includes(part.toLowerCase()))) return false
  const memoryIndex = parts[0] === 'memories' ? 0 : parts[0] === 'peers' && parts[2] === 'memories' ? 2 : -1
  return memoryIndex >= 0 && parts.length > memoryIndex + 1 && /\.md$/iu.test(parts.at(-1) ?? '')
}

function memoryTime(value: unknown): number | null {
  const at = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(at) ? at : null
}

export function memoryAuthor(note: Row, tags: unknown[] = []): 'Peter' | 'agent' | null {
  const source = object(note.source)
  const attributed = String(note.attributedTo ?? note.attributed_to ?? '').toLowerCase()
  if (['owner', 'owner-voice', 'owner-edit'].includes(attributed)) return 'Peter'
  if (['lane-requester', 'dream', 'agent'].includes(attributed)) return 'agent'
  const declared = [note.author, typeof note.source === 'string' ? note.source : undefined, source.role, source.kind,
    ...tags.map(tag => String(tag).match(/^(?:source|author)=(.+)$/u)?.[1])].map(value => String(value ?? '').toLowerCase())
  if (declared.some(value => ['peter', 'owner', 'user', 'you-said', 'owner-voice', 'owner-edit'].includes(value))) return 'Peter'
  if (declared.some(value => ['agent', 'assistant', 'dream', 'lane-requester'].includes(value)) || source.dream === true) return 'agent'
  return null
}

async function vikingRecord(config: VikingConfig, row: Row, signal?: AbortSignal): Promise<Row> {
  const uri = String(row.uri)
  const params = new URLSearchParams({ uri })
  const [content, statValue, attributes] = await Promise.all([
    vikingCall(config, `/api/v1/content/read?${params}`, 'GET', undefined, signal),
    row.modTime !== undefined ? row : vikingCall(config, `/api/v1/fs/stat?${params}`, 'GET', undefined, signal),
    vikingCall(config, `/api/v1/fs/attrs?${params}`, 'GET', undefined, signal),
  ])
  if (typeof content !== 'string') throw new MemoryFaceError('memory:invalid-content')
  const stat = object(statValue)
  if (stat.isDir === true) throw new MemoryFaceError('memory:not-a-note', 409)
  const attrs = object(object(attributes).attrs)
  const metadata = object(attrs.memory)
  const tags = [...(Array.isArray(row.tags) ? row.tags : []), ...(Array.isArray(attrs.tags) ? attrs.tags : [])]
  const createdAt = memoryTime(metadata.created_at ?? metadata.createdAt ?? row.created_at ?? stat.created_at)
  const modifiedAt = memoryTime(stat.modTime ?? stat.mtime)
  return { id: uri, backend: 'openviking', tier: 'remembered', kind: 'observation', text: content,
    createdAt: createdAt ?? modifiedAt, dateKind: createdAt === null ? 'modified' : 'created',
    author: memoryAuthor(metadata, tags), score: row.score,
    source: { sessionTitle: 'OpenViking', at: createdAt ?? modifiedAt } }
}

async function findMemoryOpenViking(config: VikingConfig, query: string, offset: number, limit: number): Promise<Row[]> {
  const result = object(await vikingCall(config, '/api/v1/search/find', 'POST', {
    query: config.queryInstruction + query, target_uri: `viking://user/${config.user}`,
    context_type: 'memory', level: 2, limit: offset + limit + 1,
  }))
  if (!Array.isArray(result.memories)) throw new MemoryFaceError('memory:invalid-list')
  return result.memories.map(object)
}

/** Uncapped live Kira notes, paged by a stable (date,id) key. Search resolves semantic URIs against this ledger. */
export async function listFaceRemembered(query: string, before: string | null, limit = 50): Promise<Row> {
  if (query) {
    const offset = Number(before ?? 0)
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) throw new MemoryFaceError('memory:invalid-cursor', 400)
    const config = await memoryOpenVikingConfig()
    const { idFromUri } = await loadKiraMemoryReaderModule('recall-openviking')
    const hits = await findMemoryOpenViking(config, query, offset, limit)
    const live = new Map((await readFaceLiveRemembered()).map(note => [String(note.id), note]))
    const items = hits.slice(offset, offset + limit).flatMap(hit => {
      const id = idFromUri!(config.user, hit.uri)
      const note = live.get(id)
      return note ? [{ ...note, text: note.statement, author: memoryAuthor(note), score: hit.score }] : []
    })
    return { items, next: hits.length > offset + limit ? String(offset + limit) : null }
  }
  const notes = await readFaceLiveRemembered()
  const time = (note: Row): number => memoryTime(note.createdAt) ?? memoryTime(note.observedAt)
    ?? memoryTime(note.validFrom) ?? memoryTime(object(note.source).at) ?? 0
  const compare = (a: Row, b: Row): number => time(b) - time(a) || String(a.id).localeCompare(String(b.id))
  let cursor: Row | null = null
  if (before) {
    try { cursor = object(JSON.parse(before)) } catch { throw new MemoryFaceError('memory:invalid-cursor', 400) }
    if (typeof cursor.id !== 'string' || typeof cursor.createdAt !== 'number') throw new MemoryFaceError('memory:invalid-cursor', 400)
  }
  const sorted = notes.sort(compare).filter(note => cursor === null || compare(note, cursor) > 0)
  const page = sorted.slice(0, limit)
  const last = page.at(-1)
  return { items: page.map(note => ({ ...note, text: note.statement, author: memoryAuthor(note) })),
    next: sorted.length > limit && last ? JSON.stringify({ id: last.id, createdAt: time(last) }) : null }
}

/** Tree has explicit depth; recursive ls silently stops before peer memory files at its fixed depth of three. */
export async function listMemoryOpenViking(query: string, offset = 0, limit = 50): Promise<Row> {
  const config = await memoryOpenVikingConfig()
  const rows = query ? await findMemoryOpenViking(config, query, offset, limit)
    : await vikingCall(config, `/api/v1/fs/tree?${new URLSearchParams({
      uri: `viking://user/${config.user}`, output: 'original', include_tags: 'true', level_limit: '64',
      offset: String(offset), node_limit: String(limit),
    })}`)
  if (!Array.isArray(rows)) throw new MemoryFaceError('memory:invalid-list')
  const page = query ? rows.slice(offset, offset + limit) : rows
  const visible = page.map(object).filter(row => row.isDir !== true && isFaceOwnedVikingMemory(String(row.uri ?? ''), config.user))
  const items: Row[] = []
  const issues = new Set<string>()
  for (let i = 0; i < visible.length; i += 6) {
    for (const result of await Promise.allSettled(visible.slice(i, i + 6).map(row => vikingRecord(config, row)))) {
      if (result.status === 'fulfilled') items.push(result.value)
      else {
        issues.add(result.reason instanceof MemoryFaceError ? result.reason.code : 'memory:openviking-row-unreadable')
      }
    }
  }
  return { items, next: (query ? rows.length > offset + limit : rows.length === limit) ? String(offset + limit) : null,
    issues: [...issues] }
}

export async function forgetMemoryOpenViking(uri: string): Promise<Row> {
  const config = await memoryOpenVikingConfig()
  if (!isFaceOwnedVikingMemory(uri, config.user)) throw new MemoryFaceError('memory:not-face-owned', 403)
  const params = new URLSearchParams({ uri })
  const stat = object(await vikingCall(config, `/api/v1/fs/stat?${params}`))
  if (stat.isDir !== false) throw new MemoryFaceError('memory:not-a-note', 409)
  const result = object(await vikingCall(config, `/api/v1/fs?${params}&recursive=false`, 'DELETE'))
  if (result.uri !== uri) throw new MemoryFaceError('memory:deletion-unconfirmed')
  return { id: uri, forgotten: true, localOnly: true }
}

/** OpenViking's tenant-isolated debug scroll is the installed API that actually returns dense vectors.
 * Read only: no indexing, embedding calls, persisted layouts, or copies of notes. Kira's current ledger
 * supplies Kira text/eligibility; vector-store content is never treated as an authoritative memory. */
export async function memoryConstellation(): Promise<Row> {
  const signal = AbortSignal.timeout(30_000)
  const config = await memoryOpenVikingConfig()
  const { idFromUri, uriFor } = await loadKiraMemoryReaderModule('recall-openviking')
  const live = new Map((await readFaceLiveRemembered()).map(note => [String(note.id), note]))
  // Enumerate authoritative file names too: scrolling vectors alone cannot reveal unindexed files.
  const files = new Map<string, Row>()
  for (let page = 0; page < 32; page++) {
    const result = await vikingCall(config, `/api/v1/fs/tree?${new URLSearchParams({
      uri: `viking://user/${config.user}`, output: 'original', include_tags: 'true', level_limit: '64',
      offset: String(page * 1000), node_limit: '1000',
    })}`, 'GET', undefined, signal)
    if (!Array.isArray(result)) throw new MemoryFaceError('memory:invalid-list', 503)
    for (const value of result) {
      const row = object(value), uri = String(row.uri ?? '')
      // A directory at the traversal boundary could hide notes. Never claim complete coverage.
      if (row.isDir === true && uri.split('/').length >= 64) throw new MemoryFaceError('memory:tree-incomplete', 503)
      if (row.isDir !== true && isFaceOwnedVikingMemory(uri, config.user)) files.set(uri, row)
    }
    if (result.length < 1000) break
    if (page === 31) throw new MemoryFaceError('memory:tree-incomplete', 503)
  }
  const candidates = new Map<string, { vector: Float32Array; note: Row | undefined }>()
  let cursor: string | null = null, vectorValues = 0
  const acceptVector = (value: unknown) => {
    const row = object(value), uri = String(row.uri ?? '')
    if (row.context_type !== 'memory' || row.level !== 2) return
    const id = idFromUri!(config.user, uri), note = live.get(id)
    if (!note && !files.has(uri)) return
    const vector = row.vector
    if (!Array.isArray(vector) || !vector.length || vector.length > 4096
      || !vector.every(v => typeof v === 'number' && Number.isFinite(v)) || Math.hypot(...vector) < 1e-12) return
    const identity = note ? String(note.id) : uri
    // Resource ceilings refuse the whole graph, never return a truncated constellation.
    vectorValues += vector.length - (candidates.get(identity)?.vector.length ?? 0)
    if (vectorValues > 8_000_000) throw new MemoryFaceError('memory:vector-budget-exceeded', 503)
    candidates.set(identity, { vector: Float32Array.from(vector), note })
  }
  const cursors = new Set<string>()
  for (let page = 0; page < 32; page++) {
    const params = new URLSearchParams({ limit: '1000' })
    if (cursor) params.set('cursor', cursor)
    const result = object(await vikingCall(config, `/api/v1/debug/vector/scroll?${params}`, 'GET', undefined, signal))
    if (!Array.isArray(result.records)) throw new MemoryFaceError('memory:vectors-unavailable', 503)
    for (const value of result.records) acceptVector(value)
    cursor = typeof result.next_cursor === 'string' && result.next_cursor ? result.next_cursor : null
    if (!cursor) break
    if (cursors.has(cursor) || page === 31) throw new MemoryFaceError('memory:vector-scan-incomplete', 503)
    cursors.add(cursor)
  }
  // The installed local backend's offset cursor can overlap pages. Resolve missing identities through
  // the same real vector endpoint's exact-URI filter; an unindexed note still fails the whole view.
  const missing = [...live.keys(), ...files.keys()].filter(id => !candidates.has(id))
  for (let i = 0; i < missing.length; i += 8) {
    const batch = await Promise.all(missing.slice(i, i + 8).map(async id => {
      const uri = live.has(id) ? uriFor!(config.user, id) : id
      const result = object(await vikingCall(config, `/api/v1/debug/vector/scroll?${new URLSearchParams({ uri, limit: '1000' })}`, 'GET', undefined, signal))
      if (!Array.isArray(result.records)) throw new MemoryFaceError('memory:vectors-unavailable', 503)
      return result.records.filter(value => object(value).uri === uri)
    }))
    for (const rows of batch) for (const row of rows) acceptVector(row)
  }
  if ([...live.keys(), ...files.keys()].some(id => !candidates.has(id))) {
    throw new MemoryFaceError('memory:vector-coverage-incomplete', 503)
  }
  const selected = [...candidates].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  const items: Row[] = []
  const vectors: { id: string; vector: Float32Array }[] = []
  for (let i = 0; i < selected.length; i += 8) {
    if (signal.aborted) throw new MemoryFaceError('memory:constellation-timeout', 503)
    const batch = await Promise.all(selected.slice(i, i + 8).map(async ([id, value]) => {
      const item: Row = value.note
        ? { ...value.note, id, backend: 'kira', tier: 'remembered', text: value.note.statement, author: memoryAuthor(value.note) }
        : await vikingRecord(config, files.get(id)!, signal)
      return { item, id, vector: value.vector }
    }))
    for (const value of batch) { items.push(value.item); vectors.push({ id: value.id, vector: value.vector }) }
  }
  if (!vectors.length) throw new MemoryFaceError('memory:vectors-unavailable', 503)
  let positions: Map<string, readonly [number, number]>
  try { positions = await semanticLayout(vectors, signal) } catch (error) {
    if (signal.aborted) throw new MemoryFaceError('memory:constellation-timeout', 503)
    if (error instanceof Error && error.message === 'memory:invalid-vectors') throw new MemoryFaceError('memory:invalid-vectors', 503)
    throw error
  }
  // A capture or forget during the scan invalidates its snapshot; don't silently omit or resurrect it.
  const current = await readFaceLiveRemembered()
  if (current.length !== live.size || current.some(note => {
    const previous = live.get(String(note.id))
    return !previous || previous.statement !== note.statement
  })) throw new MemoryFaceError('memory:snapshot-changed', 503)
  return { projection: 'unit-pca-v1', items: items.map(item => ({ ...item, position: positions.get(String(item.id)) })) }
}

/** One ranked request for the complete vector population, returning only identities and scores.
 * Avoids progressively re-fetching every search prefix and re-reading note bodies for highlights. */
export async function searchMemoryConstellation(query: string): Promise<Row> {
  const config = await memoryOpenVikingConfig()
  const count = object(await vikingCall(config, '/api/v1/debug/vector/count')).count
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count > 32_000) {
    throw new MemoryFaceError('memory:search-budget-exceeded', 503)
  }
  if (!count) return { items: [] }
  const hits = await findMemoryOpenViking(config, query, 0, count)
  const { idFromUri } = await loadKiraMemoryReaderModule('recall-openviking')
  return { items: hits.flatMap(hit => {
    const uri = String(hit.uri ?? ''), id = idFromUri!(config.user, uri)
    if ((!id && !isFaceOwnedVikingMemory(uri, config.user)) || typeof hit.score !== 'number' || !Number.isFinite(hit.score)) return []
    return [{ id: id ?? uri, score: hit.score }]
  }) }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** Use the same launch-cookie and Host/Origin gate as the other faces, failing closed. */
export function memoryRequestRejection(connection: unknown, req: IncomingMessage): number | undefined {
  if (connection === null || typeof connection !== 'object') return 403
  const gate = Reflect.get(connection, 'requestRejection')
  if (typeof gate !== 'function') return 403
  try {
    const rejection: unknown = gate.call(connection, req)
    return rejection === undefined ? undefined : rejection === 401 || rejection === 403 ? rejection : 403
  } catch { return 403 }
}

async function requestBody(req: IncomingMessage): Promise<Row> {
  let body = ''
  for await (const chunk of req) {
    body += String(chunk)
    if (body.length > 8192) throw new MemoryFaceError('memory:body-too-large', 413)
  }
  try { return object(JSON.parse(body)) } catch { throw new MemoryFaceError('memory:invalid-body', 400) }
}

export function apply(ctx: Context): void {
  let constellationFlight: Promise<Row> | null = null
  for (const [operation, path] of Object.entries(MEMORY_OPENVIKING_ROUTES)) {
    const route: WebRoute = { kind: 'exact', path, handler: async (req, res) => {
      const rejection = memoryRequestRejection(Reflect.get(ctx, 'connection'), req)
      if (rejection !== undefined) { json(res, rejection, { error: 'memory:unauthorized' }); return }
      const method = operation === 'forget' ? 'POST' : 'GET'
      if (req.method !== method) { res.setHeader('allow', method); json(res, 405, { error: 'memory:method-not-allowed' }); return }
      try {
        if (operation === 'threeModule' || operation === 'threeCore') {
          const filename = operation === 'threeModule' ? 'three.module.min.js' : 'three.core.min.js'
          const bytes = await readFile(new URL(`../vendor/three/${filename}`, import.meta.url))
          res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'private, max-age=86400',
            'x-content-type-options': 'nosniff' })
          res.end(bytes)
          return
        }
        if (operation === 'constellation') {
          // Share only an in-flight read; no private-note/layout cache survives the request.
          constellationFlight ??= memoryConstellation().finally(() => { constellationFlight = null })
          json(res, 200, await constellationFlight)
          return
        }
        if (operation !== 'forget') {
          const params = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
          const q = params.get('q')?.trim() ?? ''
          if (operation === 'constellationSearch') {
            if (!q || q.length > 4000) throw new MemoryFaceError('memory:invalid-query', 400)
            json(res, 200, await searchMemoryConstellation(q))
            return
          }
          if (operation === 'remembered') {
            if (q.length > 4000) throw new MemoryFaceError('memory:invalid-query', 400)
            json(res, 200, await listFaceRemembered(q, params.get('before')))
            return
          }
          const offset = Number(params.get('before') ?? 0)
          if (q.length > 4000 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) throw new MemoryFaceError('memory:invalid-query', 400)
          json(res, 200, await listMemoryOpenViking(q, offset))
        } else {
          if (!req.headers['content-type']?.startsWith('application/json')) throw new MemoryFaceError('memory:json-required', 415)
          const body = await requestBody(req)
          if (typeof body.id !== 'string') throw new MemoryFaceError('memory:id-required', 400)
          json(res, 200, await forgetMemoryOpenViking(body.id))
        }
      } catch (error) {
        json(res, error instanceof MemoryFaceError ? error.status : 500,
          { error: error instanceof MemoryFaceError ? error.code : 'memory:request-failed' })
      }
    } }
    ctx.effect(() => ctx.webServer.register(route), `memory: OpenViking ${operation}`)
  }
}
