/** The face merges independent readers; every Kira action still goes to Kira. */
import type { Kind, Tier } from './memory-model.ts'

export interface MemoryRecord {
  readonly id: string
  readonly backend: 'kira' | 'openviking'
  readonly tier: Tier
  readonly kind: Kind
  readonly text: string
  readonly createdAt: number | null
  readonly author: 'Peter' | 'agent' | null
  readonly dateKind?: 'created' | 'modified'
  readonly source?: {
    readonly sessionId?: string | null
    readonly sessionTitle?: string | null
    readonly at?: number | null
    readonly [key: string]: unknown
  } | null
  readonly [key: string]: unknown
}
export interface MemoryListAnswer {
  readonly items: readonly MemoryRecord[]
  readonly next: string | null
  readonly issues?: readonly string[]
}
export interface MemoryVerifyAnswer { readonly id: string; readonly source: string }
export interface MemoryForgetAnswer { readonly id: string; readonly forgotten: boolean; readonly [key: string]: unknown }
export interface MemorySource {
  readonly kind: 'live'
  list(input: { tier: Tier; q?: string; before?: string | null; signal?: AbortSignal }): Promise<MemoryListAnswer>
  verify(id: string): Promise<MemoryVerifyAnswer>
  forget(id: string): Promise<MemoryForgetAnswer>
}

export const WHY_MANIFEST_ROUTE = '/api/aukora/why'
export const KIRA_MEMORY_ROUTES = {
  list: '/api/kira/memories', verify: '/api/kira/memories/verify',
  forget: '/api/kira/memories/forget', trust: '/api/kira/trust',
} as const
export const OPENVIKING_MEMORY_ROUTES = {
  remembered: '/api/aukora/memory/remembered',
  list: '/api/aukora/memory/openviking', forget: '/api/aukora/memory/openviking/forget',
} as const

type Row = Record<string, unknown>
const object = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
export class MemoryServiceError extends Error {
  constructor(readonly problem: 'absent' | 'refused' | 'failed', readonly status: number, readonly code: string, readonly body: Row = {}) {
    super(code)
  }
}
function wireTime(value: unknown): number | null {
  const parsed = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value)
    : typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

export function noteToRecord(note: Row): MemoryRecord {
  const source = object(note.source ?? object(note.citation).source)
  const attributed = String(note.attributedTo ?? '').toLowerCase()
  const role = String(source.role ?? source.kind ?? '').toLowerCase()
  const author = note.author === 'Peter' || note.author === 'agent' ? note.author
    : ['owner', 'owner-voice', 'owner-edit'].includes(attributed) ? 'Peter'
    : ['lane-requester', 'dream', 'agent'].includes(attributed) ? 'agent'
    : ['assistant', 'agent', 'dream'].includes(role) || source.dream === true ? 'agent'
    : ['user', 'peter', 'you-said', 'edited'].includes(role) ? 'Peter' : null
  const kinds = ['fact', 'preference', 'decision', 'commitment', 'person', 'project', 'observation']
  const kind = String(note.kind ?? note.category ?? note.label)
  return { ...note, id: String(note.id), backend: 'kira', tier: (note.tier === 'trusted' ? 'signed' : note.tier) as Tier,
    kind: kinds.includes(kind) ? kind as Kind : 'observation', text: String(note.text ?? note.statement ?? ''),
    createdAt: wireTime(note.createdAt) ?? wireTime(note.observedAt) ?? wireTime(note.validFrom) ?? wireTime(source.at),
    author, source, aura: note.aura ?? object(note.citation).aura }
}

interface Cursor { kira: string | null; openviking: string | null }
export function httpMemorySource(options: { readonly fetchImpl?: typeof fetch } = {}): MemorySource {
  const call = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const send = async (path: string, init: RequestInit = {}): Promise<Row> => {
    let response: Response
    try { response = await call(path, { credentials: 'same-origin', ...init }) } catch {
      throw new MemoryServiceError('absent', 0, 'memory:unreachable')
    }
    const body = object(await response.json().catch(() => null))
    if (!response.ok) throw new MemoryServiceError(response.status === 404 ? 'absent' : 'refused', response.status,
      typeof body.error === 'string' ? body.error : 'memory:request-failed', body)
    return body
  }
  const post = (path: string, id: string) => send(path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }),
  })
  return {
    kind: 'live',
    async list(input) {
      const cursor: Cursor = input.before ? JSON.parse(input.before) as Cursor : { kira: '', openviking: input.tier === 'remembered' ? '' : null }
      const backends = (['openviking', 'kira'] as const).filter(backend => cursor[backend] !== null)
      const results = await Promise.allSettled(backends.map(async backend => {
        const params = new URLSearchParams({ q: input.q ?? '' })
        if (cursor[backend]) params.set('before', cursor[backend] as string)
        if (backend === 'kira') { params.set('tier', input.tier); params.set('limit', '500') }
        const path = backend === 'openviking' ? OPENVIKING_MEMORY_ROUTES.list
          : input.tier === 'remembered' ? OPENVIKING_MEMORY_ROUTES.remembered : KIRA_MEMORY_ROUTES.list
        const body = await send(`${path}?${params}`, input.signal ? { signal: input.signal } : {})
        if (!Array.isArray(body.items)) throw new MemoryServiceError('failed', 502, `memory:${backend}-invalid-list`)
        const items = body.items.map(object).filter(row => typeof row.id === 'string').map(row => backend === 'kira' ? noteToRecord(row) : row as unknown as MemoryRecord)
        const next = typeof body.next === 'string' && body.next ? body.next : null
        if (next !== null && next === cursor[backend]) throw new MemoryServiceError('failed', 502, `memory:${backend}-cursor-stalled`)
        const issues = Array.isArray(body.issues) ? body.issues.filter((issue): issue is string => typeof issue === 'string') : []
        return { backend, items, next, issues }
      }))
      const items: MemoryRecord[] = []
      const next: Cursor = { kira: null, openviking: null }
      const issues: string[] = []
      for (let i = 0; i < results.length; i++) {
        const result = results[i]!
        if (result.status === 'fulfilled') {
          items.push(...result.value.items)
          next[result.value.backend] = result.value.next
          issues.push(...result.value.issues.map(issue => `${result.value.backend}:${issue}`))
        } else issues.push(`${backends[i]}:${result.reason instanceof MemoryServiceError ? result.reason.code : 'memory:request-failed'}`)
      }
      if (results.length > 0 && results.every(result => result.status === 'rejected')) {
        const failed = results[0] as PromiseRejectedResult
        throw failed.reason
      }
      return { items, next: next.kira !== null || next.openviking !== null ? JSON.stringify(next) : null, issues }
    },
    async verify(id) { return await post(KIRA_MEMORY_ROUTES.verify, id) as unknown as MemoryVerifyAnswer },
    async forget(id) {
      const body = await post(id.startsWith('viking://') ? OPENVIKING_MEMORY_ROUTES.forget : KIRA_MEMORY_ROUTES.forget, id)
      // Kira can refuse with HTTP 200. Only its explicit result permits removing a row.
      if (body.forgotten !== true) throw new MemoryServiceError('refused', 409,
        typeof body.refused === 'string' ? body.refused : 'memory:forget-unconfirmed', body)
      return body as unknown as MemoryForgetAnswer
    },
  }
}
