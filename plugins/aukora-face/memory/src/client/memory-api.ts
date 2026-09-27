/**
 * WHERE MEMORIES COME FROM — the contract's four routes behind one interface, and a stub until they land.
 *
 * THE CONTRACT: `.agents/live/MEMORY-CONTRACT-v0.md`, routes authenticated by the same cookie the other face routes
 * use:
 *
 * **THE PATHS ARE KIRA'S MEASURED ONES, NOT THE CONTRACT'S FIRST DRAFT.** `plugins/aukora-kira/lib/memory-routes.mjs`
 * states the reason in as many words: an `exact` registration "cannot carry a path parameter", so rather than leave
 * this client "building against a shape I had not measured", the two POST routes carry the id **in the body**:
 *
 *   GET  /api/kira/memories?tier=&q=&limit=&before=   -> {items:[KiraNote], next}      (tiers: recall only)
 *   POST /api/kira/memories/verify  {id}              -> {id, source} plus why, when it could not answer
 *   POST /api/kira/memories/forget  {id, reason?}     -> {id, forgotten, tombstone?} or a named refusal
 *   POST /api/kira/trust  {ids:[...]}                 -> a manifest and its seed; 503 while signing is gated
 *
 * **AND THE TWO FAILURES THAT MUST NEVER LOOK LIKE AN EMPTY MEMORY.** Asking for `forgotten` or `proposal` is refused
 * by name (`kira.route:tier-not-listable`) because a tombstone is not a memory anyone lists; and a route that is not
 * mounted, or answers with an error, is reported as exactly that. Both are reasons this module throws a typed
 * `MemoryServiceError` instead of returning `[]`: an app that renders a broken service as "she remembers nothing" is
 * telling Peter the one thing he must never be told by accident.
 *
 * **WHY A STUB, AND WHY IT SAYS SO.** The goal asks for the app to be built against the contract now, with a stub
 * behind the same interface until KIRA's routes land. A stub that pretended to be the real thing would be worse than
 * the gap it fills: Peter would read invented memories as his own. So every source declares `kind: 'live' | 'stub'`,
 * the app prints a plain line when it is a stub, and the courts drive BOTH implementations through the same
 * interface so the day the routes land is a change of one value rather than of the app.
 *
 * @module memory-api
 */

import type { Kind, Tier } from './memory-model.ts'

/** One record, as the contract spells it. Fields beyond the ones this app reads are kept by index signature. */
export interface MemoryRecord {
  readonly id: string
  readonly tier: Tier
  readonly kind: Kind
  readonly text: string
  readonly createdAt?: number | null
  readonly source?: {
    readonly sessionId?: string | null
    readonly sessionTitle?: string | null
    readonly seq?: number | null
    readonly at?: number | null
    readonly sha256?: string | null
  } | null
  readonly aura?: { readonly index?: number | null; readonly entryHash?: string | null } | null
  readonly trusted?: { readonly signer?: string | null; readonly at?: number | null; readonly approvalDigest?: string | null } | null
  readonly forgotten?: { readonly at?: number | null; readonly reason?: string | null; readonly tombstoneHash?: string | null } | null
  readonly [key: string]: unknown
}

/** The list route's answer. */
export interface MemoryListAnswer {
  readonly items: readonly MemoryRecord[]
  readonly next?: string | null
}

/**
 * The verify route's answer.
 *
 * **FOUR WORDS, NOT THREE, AND THE FOURTH IS THE IMPORTANT ONE**: `memory-deps.mjs` answers `UNVERIFIABLE` with the
 * refusal that caused it when the check could not run at all — a store that cannot be read is not a memory that
 * changed, and neither is a memory that is fine. A badge that reads green for a check that never happened is the one
 * thing this app is built not to do.
 */
export interface MemoryVerifyAnswer {
  readonly id: string
  readonly source: 'VERIFIED' | 'CHANGED' | 'MISSING' | 'UNVERIFIABLE'
  readonly because?: string | null
  readonly failed?: string | null
  readonly refused?: string | null
  readonly recorded?: string | null
  readonly recomputed?: string | null
}

/** The forget route's answer: a tombstone, or a named refusal (`signed-erasure-is-the-owners`). */
export interface MemoryForgetAnswer {
  readonly id: string
  readonly forgotten?: boolean
  readonly because?: string | null
  readonly refused?: string | null
  readonly ceiling?: string | null
  readonly tombstone?: { readonly at: number | null; readonly hash: string | null }
}

/**
 * The sign route's answer: ONE Aumlok approval over a manifest carrying every note in full — so the manifest itself,
 * and the seed its digest is built from. While the gate is closed the route answers 503 instead, which reaches this
 * client as a `refused` error carrying the ceiling and the reason.
 */
export interface MemoryTrustAnswer {
  readonly manifest?: unknown
  readonly approvalDigestSeed?: string | null
  readonly approvalId?: string | null
  readonly state?: string
}

/** Where a source's answers come from, so the app can say so on the screen. */
export interface MemorySource {
  readonly kind: 'live' | 'stub'
  /** The four routes, in the order the contract lists them. */
  list(input: { readonly tier: Tier; readonly q?: string; readonly limit?: number; readonly before?: string | null }): Promise<MemoryListAnswer>
  verify(id: string): Promise<MemoryVerifyAnswer>
  forget(id: string, reason?: string): Promise<MemoryForgetAnswer>
  trust(ids: readonly string[]): Promise<MemoryTrustAnswer>
}

/** What the app says when the answers are examples rather than memories. */
export const STUB_NOTICE =
  'These are examples, not your memories yet: the part that reads them is still being built. Nothing here is real '
  + 'and nothing you press will change anything.'

/** The four paths, with the id in the body on the two POSTs, as the engine measures them. */
/**
 * THE `why` ROUTE, WHICH IS THE LAYOUT FACE'S AND IS NAMED HERE RATHER THAN IMPORTED.
 *
 * **THE STRING IS ALREADY WRITTEN TWICE IN THE LAYOUT FACE** (`layout/src/index.ts:52` registers it and
 * `layout/src/client/why-api.ts:16` names it for the browser), so this is a third copy and that is worth saying
 * plainly rather than hiding. **The alternative is a cross-face import, and that import is not free**: this
 * repository's `build-face.py` copies each face to `packages/client/aukora-face-{name}/`, so a path from one face's
 * source to another's resolves in a court that imports `src` and would need the builder to agree — the same risk the
 * fence fix carries and which is already written up for BETA. A route both faces address over HTTP is a **published
 * contract** rather than a source dependency, and the tree already treats it that way.
 */
export const WHY_MANIFEST_ROUTE = '/api/aukora/why'

export const KIRA_MEMORY_ROUTES = {
  list: '/api/kira/memories',
  verify: '/api/kira/memories/verify',
  forget: '/api/kira/memories/forget',
  trust: '/api/kira/trust',
} as const

/**
 * One note as the LIST route sends it — not the shape the contract's first draft drew.
 *
 * Measured from `memory-routes.mjs`: the row carries `label` rather than `kind`, `validFrom`/`observedAt` rather than
 * `createdAt`, and puts the origin under `citation` rather than at the top level. `text` is sent as `text ?? statement`,
 * so either name can appear.
 */
export interface KiraNote {
  readonly id: string
  readonly tier: Tier
  readonly label?: string | null
  /** The plan renames the kind lists on KIRA's side; the wire may carry either name for the same fact. */
  readonly kind?: string | null
  readonly text?: string | null
  readonly statement?: string | null
  readonly validFrom?: string | number | null
  readonly observedAt?: string | number | null
  readonly citation?: {
    readonly source?: MemoryRecord['source']
    readonly evidence?: readonly unknown[]
    readonly aura?: MemoryRecord['aura']
  } | null
  readonly [key: string]: unknown
}

/** What went wrong, in the three shapes the app must tell apart. */
export type MemoryServiceProblem =
  /** Nothing answered: the routes are not mounted, so the service is not running. */
  | 'absent'
  /** The engine answered and said no, by name — a tier it will not list, or the signing gate. */
  | 'refused'
  /** The engine answered with an error it did not name. */
  | 'failed'

/** A failure with its reason kept, so no caller has to guess one from a status code. */
export class MemoryServiceError extends Error {
  readonly problem: MemoryServiceProblem
  readonly status: number
  readonly code: string | null
  readonly body: Record<string, unknown>

  constructor(problem: MemoryServiceProblem, status: number, code: string | null, message: string, body: Record<string, unknown> = {}) {
    super(message)
    this.name = 'MemoryServiceError'
    this.problem = problem
    this.status = status
    this.code = code
    this.body = body
  }
}

/** A time the wire sent as an ISO string or an epoch number, as a number, or null. */
function wireTime(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value !== '') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

/**
 * THE ADAPTER: one wire note, in the shape this app's model reads.
 *
 * A label that is not one of the seven kinds becomes `observation` — the dullest true thing that can be said about a
 * note whose kind the engine did not name — rather than an empty kind word on the screen.
 */
export function noteToRecord(note: KiraNote): MemoryRecord {
  // ── KIRA'S RENAMED TIER, MAPPED RATHER THAN PASSED THROUGH ────────────────────────────────────────────────
  // `memory-tiers.mjs:38` keeps the retirement in writing — `RENAMED_TIER = { trusted: 'signed' }` — and line 35
  // declares the tiers as `['remembered','signed','proposal','forgotten']`. A wire record that still says `trusted`
  // (an older store, a fixture, a cached page) is therefore read as `signed`, which is the name KIRA now refuses to
  // do without. Anything else that is not one of the four is refused by the model's own `itemOf`.
  const tier = (note.tier as string) === 'trusted' ? 'signed' : note.tier
  // **`kind` WHEN THE WIRE CARRIES IT, `label` OTHERWISE.** KIRA's list route sends `label: labelFor(note)` today
  // (`memory-routes.mjs:93`) and the plan renames the kind lists on their side; reading both means this face follows
  // whichever arrives rather than inventing a field nobody sends.
  const label = typeof note.kind === 'string' && note.kind !== '' ? note.kind
    : typeof note.label === 'string' ? note.label : ''
  const kinds = ['fact', 'preference', 'decision', 'commitment', 'person', 'project', 'observation'] as const
  const kind = (kinds as readonly string[]).includes(label) ? label as Kind : 'observation'
  return {
    id: String(note.id),
    tier,
    kind,
    text: String(note.text ?? note.statement ?? ''),
    // THE WIRE HAS NO `createdAt`: a note is true from `validFrom`, and was seen at `observedAt`.
    createdAt: wireTime(note.validFrom) ?? wireTime(note.observedAt),
    source: note.citation?.source ?? null,
    aura: note.citation?.aura ?? null,
  }
}

/**
 * The real source: the engine's routes, same-origin, carrying the page's cookie.
 *
 * Every failure is typed rather than smoothed over. A route that is not mounted, an unreadable store that raises, a
 * tier the engine refuses to list, and the signing gate each reach the screen as themselves — because the one thing
 * this app must never do is render a broken service as an empty memory.
 */
export function httpMemorySource(options: { readonly fetchImpl?: typeof fetch } = {}): MemorySource {
  const call = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const jsonOf = async (response: Response): Promise<Record<string, unknown>> => {
    try {
      const body: unknown = await response.json()
      return body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
    } catch {
      return {}
    }
  }
  const judge = async (response: Response): Promise<Record<string, unknown>> => {
    const body = await jsonOf(response)
    if (response.ok) return body
    const code = typeof body.error === 'string' ? body.error : null
    // 404 IS "NOT MOUNTED", AND A NAMED 4xx/503 IS "THE ENGINE SAID NO": the two must not be one message.
    const problem: MemoryServiceProblem = response.status === 404 ? 'absent' : code === null ? 'failed' : 'refused'
    throw new MemoryServiceError(problem, response.status, code,
      `the memory route answered ${String(response.status)}${code === null ? '' : ` (${code})`}`, body)
  }
  const send = async (path: string, init: RequestInit): Promise<Record<string, unknown>> => {
    let response: Response
    try {
      response = await call(path, init)
    } catch (error) {
      // A FETCH THAT THREW IS A SERVICE THAT IS NOT RUNNING, which is a fact and not an empty list.
      throw new MemoryServiceError('absent', 0, 'kira.route:unreachable',
        `the memory route could not be reached: ${error instanceof Error ? error.message : String(error)}`)
    }
    return await judge(response)
  }
  return {
    kind: 'live',
    async list(input) {
      const params = new URLSearchParams({ tier: input.tier })
      if (input.q !== undefined && input.q !== '') params.set('q', input.q)
      if (input.limit !== undefined) params.set('limit', String(input.limit))
      if (input.before !== undefined && input.before !== null) params.set('before', input.before)
      const body = await send(`${KIRA_MEMORY_ROUTES.list}?${params.toString()}`, { credentials: 'same-origin' })
      const items = Array.isArray(body.items) ? body.items : []
      return {
        items: items.filter((one): one is KiraNote => one !== null && typeof one === 'object').map(noteToRecord),
        next: typeof body.next === 'string' && body.next !== '' ? body.next : null,
      }
    },
    async verify(id) {
      const body = await send(KIRA_MEMORY_ROUTES.verify, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }),
      })
      return body as unknown as MemoryVerifyAnswer
    },
    async forget(id, reason) {
      const body = await send(KIRA_MEMORY_ROUTES.forget, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(reason === undefined || reason === '' ? { id } : { id, reason }),
      })
      return body as unknown as MemoryForgetAnswer
    },
    async trust(ids) {
      const body = await send(KIRA_MEMORY_ROUTES.trust, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [...ids] }),
      })
      return body as unknown as MemoryTrustAnswer
    },
  }
}

const HOUR = 3_600_000

/**
 * Fixtures for the stub: one record per tier, one per interesting receipt, and one that cannot be read.
 *
 * They are shaped exactly like the contract's records so that the app, the courts and the eventual routes all speak
 * one language; the words are plainly examples ("an example note"), because a fixture that read like a real memory
 * is how a stub gets mistaken for one.
 */
export function stubFixtures(now = Date.now()): readonly MemoryRecord[] {
  return [
    { id: 'ex-rem-1', tier: 'remembered', kind: 'preference', text: 'an example note: you like short answers in the morning',
      createdAt: now - 2 * HOUR, source: { sessionId: 's-ex', sessionTitle: 'an example conversation', seq: 12, at: now - 2 * HOUR, sha256: 'a'.repeat(64) },
      aura: { index: 41, entryHash: 'b'.repeat(64) } },
    { id: 'ex-rem-2', tier: 'remembered', kind: 'project', text: 'an example note: the Guardian patch is your own work',
      createdAt: now - 26 * HOUR, source: { sessionId: 's-ex', sessionTitle: 'an example conversation', seq: 40, at: now - 26 * HOUR, sha256: 'c'.repeat(64) },
      aura: { index: 42, entryHash: 'd'.repeat(64) } },
    { id: 'ex-rem-3', tier: 'remembered', kind: 'person', text: 'an example note: someone you work with',
      createdAt: now - 30 * HOUR, source: { sessionId: 's-ex', sessionTitle: 'another example conversation', seq: 3, at: now - 30 * HOUR, sha256: 'e'.repeat(64) } },
    { id: 'ex-sig-1', tier: 'signed', kind: 'decision', text: 'an example signed note: never push without being asked',
      createdAt: now - 50 * HOUR, source: { sessionId: 's-ex', sessionTitle: 'an example conversation', seq: 61, at: now - 50 * HOUR, sha256: 'f'.repeat(64) },
      trusted: { signer: 'the owner', at: now - 49 * HOUR, approvalDigest: '1'.repeat(64) } },
    { id: 'ex-pro-1', tier: 'proposal', kind: 'preference', text: 'an example suggestion: you may want this to become a rule',
      createdAt: now - 8 * HOUR, source: { sessionId: 's-ex', sessionTitle: 'the nightly pass', seq: 7, at: now - 8 * HOUR, sha256: '2'.repeat(64) } },
    { id: 'ex-for-1', tier: 'forgotten', kind: 'fact', text: 'an example note that was erased',
      createdAt: now - 70 * HOUR, source: { sessionId: 's-ex', sessionTitle: 'an example conversation', seq: 9, at: now - 70 * HOUR, sha256: '3'.repeat(64) },
      forgotten: { at: now - 60 * HOUR, reason: 'you asked', tombstoneHash: '4'.repeat(64) } },
  ]
}

/**
 * The stub: the same interface, answered from memory, with the verify answers the app has to handle.
 *
 * It answers as the REAL routes would — including a record whose original has changed (`CHANGED`) and one whose
 * original is gone (`MISSING`) — because a stub that only ever answers `VERIFIED` would let the app ship a badge
 * that has never been seen to go wrong.
 */
export function stubMemorySource(
  options: { readonly records?: readonly MemoryRecord[]; readonly verifyAnswers?: Readonly<Record<string, MemoryVerifyAnswer['source']>>; readonly now?: number } = {},
): MemorySource {
  const now = options.now ?? Date.now()
  const records = options.records ?? stubFixtures(now)
  const verdicts = options.verifyAnswers ?? { 'ex-rem-1': 'VERIFIED', 'ex-rem-2': 'CHANGED', 'ex-rem-3': 'MISSING' }
  const forgotten = new Set<string>()
  return {
    kind: 'stub',
    async list(input) {
      const query = (input.q ?? '').trim().toLowerCase()
      const items = records
        .filter(record => (forgotten.has(record.id) ? 'forgotten' : record.tier) === input.tier)
        .filter(record => query === '' || record.text.toLowerCase().includes(query))
        .slice(0, input.limit ?? records.length)
      return { items, next: null }
    },
    async verify(id) {
      const source = verdicts[id] ?? 'MISSING'
      return { id, source, recorded: records.find(record => record.id === id)?.source?.sha256 ?? null, recomputed: null }
    },
    async forget(id) {
      forgotten.add(id)
      return { id, tombstone: { at: now, hash: 'stub-tombstone' } }
    },
    async trust(ids) {
      // THE STUB DOES NOT PRETEND TO SIGN. Signing is off until it requires Peter in person, so the honest answer
      // here is that no approval was opened — not an invented approval id that a later screen would trust.
      return { approvalId: null, state: ids.length === 0 ? 'nothing-selected' : 'signing-is-off' }
    },
  }
}
