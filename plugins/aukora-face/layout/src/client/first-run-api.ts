/**
 * THE FIRST RUN'S CLIENT — four calls, and one rule about what may never travel back.
 *
 * The screen collects a name, a voice choice and a key; the host half stores them. This module is the wire between
 * them, and it is deliberately dull: four calls, each answering or failing with a name.
 *
 * **THE PATHS ARE DECLARED HERE AND CHECKED AGAINST THE HOST'S OWN TABLE BY A COURT.** A client whose paths merely
 * look right is one typo from four 404s, which would reach the screen as "the service is not running" — the same
 * lesson as the memory face, where an arm now compares its four paths against KIRA's. Here the two halves are the
 * same face, so the court can read both files and require them to agree.
 *
 * **THE KEY GOES ONE WAY.** It is sent in a POST body and never comes back: the answer to a stored key carries its
 * tail. Nothing in this module puts a key in a message, an error or a log, and `describeFailure` is written so that a
 * failure can only ever report a status and a code.
 *
 * @module first-run-api
 */

/** The four paths, as the client knows them. */
export const FIRST_RUN_CLIENT_ROUTES = {
  answer: '/api/aukora/first-run',
  name: '/api/aukora/first-run/name',
  key: '/api/aukora/first-run/key',
  keyRemove: '/api/aukora/first-run/key/remove',
} as const

/** What the host answers about a state: whether it is a first run, the name, and the tail of a stored key. */
export interface FirstRunState {
  readonly firstRun: boolean
  readonly name: string | null
  /** Four characters of a stored key, or null. **Never the key.** */
  readonly keyTail: string | null
  /** False when the process has no state root, so the screen can say the state cannot be written rather than failing. */
  readonly writable?: boolean
}

/** Why a call did not answer: nothing is serving, the host said no by name, or the call failed. */
export type FirstRunProblem = 'absent' | 'refused' | 'failed'

/** A failure that says which of the three it was, and never carries anything the person typed. */
export class FirstRunError extends Error {
  readonly problem: FirstRunProblem
  readonly status: number
  readonly code: string | null

  constructor(problem: FirstRunProblem, status: number, code: string | null) {
    // **THE MESSAGE CARRIES A STATUS AND A CODE, NOT A BODY.** A body could contain a key if a route ever echoed one,
    // and an error is exactly the thing that ends up in a log.
    super(code === null ? `first run: ${problem} (${String(status)})` : `first run: ${problem} (${String(status)}) ${code}`)
    this.name = 'FirstRunError'
    this.problem = problem
    this.status = status
    this.code = code
  }
}

/** What the screen needs from a source, so a court can drive it without a server. */
export interface FirstRunSource {
  readonly answer: () => Promise<FirstRunState>
  /** What is on and what is not, asked of the routes that own each answer. */
  // **THE DECLARATION WAS WIDER THAN THE THING IT HOLDS.** `:168` binds this to `statusFacts`, which returns a union
  // of `{known: true; value: 'on' | 'off'}` and `{known: false}` — **and the interface said `unknown`, so every caller
  // received a value the compiler refused to let them use.** `FirstRunSurface.tsx:200` spread it with `as never` to
  // force it through, and **`never` cannot be spread, which is why the build stopped there.**
  //
  // **`typeof statusFacts` IS THE HONEST TYPE: it is what the port is actually bound to.** Writing the shape out by
  // hand would be a second copy of the same contract, **which is the defect this repository keeps finding** — and it
  // would drift from `statusFacts` the first time that function changed.
  readonly status: typeof statusFacts
  readonly remember: (name: string, voice: 'on' | 'off') => Promise<FirstRunState>
  readonly rememberKey: (key: string) => Promise<FirstRunState>
  readonly forgetKey: () => Promise<FirstRunState>
}

/** Read a response that should be the state, turning every failure into a named one. */
async function stateOf(response: Response, _what: string): Promise<FirstRunState> {
  if (!response.ok) {
    // A NAMED CODE FROM THE HOST IS CARRIED THROUGH; a body is never included, because a body is what could leak.
    let code: string | null = null
    try {
      const body: unknown = await response.json()
      if (body !== null && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'string') {
        code = (body as { code: string }).code
      }
    } catch { code = null }
    throw new FirstRunError(response.status === 404 ? 'absent' : 'refused', response.status, code)
  }
  const body: unknown = await response.json()
  if (body === null || typeof body !== 'object') throw new FirstRunError('failed', response.status, null)
  const state = body as Partial<FirstRunState>
  return {
    firstRun: state.firstRun === true,
    name: typeof state.name === 'string' ? state.name : null,
    keyTail: typeof state.keyTail === 'string' ? state.keyTail : null,
    ...(typeof state.writable === 'boolean' ? { writable: state.writable } : {}),
  }
}

/** Send one POST and answer its state. */
async function post(path: string, body: unknown, what: string): Promise<FirstRunState> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return await stateOf(response, what)
  } catch (cause) {
    if (cause instanceof FirstRunError) throw cause
    // NOTHING IS SERVING. The screen says so rather than showing an empty first run as if the state were blank.
    throw new FirstRunError('absent', 0, null)
  }
}

/**
 * WHERE EACH STATUS TOPIC IS ANSWERED, MEASURED FROM THE FILE THAT OWNS THE ROUTE.
 *
 * A status line that reports "not known yet" for four things when the app could simply ask is honest but useless, and
 * one that reports them "on" with nothing behind it is the lie this whole screen exists to avoid. So each topic has
 * the route its own lane already serves, named with where it was read from:
 *
 *  - **voice** — AUMA's read-only status, `plugins/aukora-face/layout/src/client/auma-status.ts:44`
 *  - **memory** — KIRA's list route, `plugins/aukora-kira/lib/memory-routes.mjs:32`
 *  - **approvals** — the AUMLOK control projection, `plugins/aukora-face/aumlok/src/control-projection.ts:88`
 *  - **messaging** — the messages contacts read, `plugins/aukora-face/messages/src/messages-route.ts:122`
 */
export const STATUS_SOURCES = {
  voice: '/api/auma-live/status',
  memory: '/api/kira/memories',
  approvals: '/api/aukora/aumlok-control',
  messaging: '/aukora-messages/contacts.json',
} as const

/**
 * What one probe means. **THREE ANSWERS, NOT TWO.**
 *
 * `200` is on. `404` is off — the route is not mounted, which on this app means the capability is not running rather
 * than that something failed. **Anything else is unknown**, including a refusal and an unreachable host: the app has
 * not been told, and "not known yet" is the only true thing left to say. This is the same three-way distinction the
 * memory face makes between absent, refused and failed.
 */
export function factFromProbe(outcome: number | null): { readonly known: true; readonly value: 'on' | 'off' } | { readonly known: false } {
  if (outcome === 200) return { known: true, value: 'on' }
  if (outcome === 404) return { known: true, value: 'off' }
  return { known: false }
}

/** Probe every topic, in parallel, reporting unknown for anything that could not be asked. */
export async function statusFacts(): Promise<Partial<Record<keyof typeof STATUS_SOURCES, { readonly known: true; readonly value: 'on' | 'off' } | { readonly known: false }>>> {
  const topics = Object.keys(STATUS_SOURCES) as (keyof typeof STATUS_SOURCES)[]
  const answers = await Promise.all(topics.map(async topic => {
    try {
      // A HEAD-like read: the smallest request that still says whether the route is mounted. The memory route
      // defaults to fifty notes, so the limit is set here rather than pulling a page to learn one bit.
      const path = topic === 'memory' ? `${STATUS_SOURCES.memory}?limit=1` : STATUS_SOURCES[topic]
      const response = await fetch(path, { headers: { accept: 'application/json' } })
      return [topic, factFromProbe(response.status)] as const
    } catch {
      return [topic, { known: false }] as const
    }
  }))
  return Object.fromEntries(answers)
}

/** The live source: the four routes this face's host half serves. */
export function httpFirstRun(): FirstRunSource {
  return {
    answer: async () => {
      try {
        return await stateOf(await fetch(FIRST_RUN_CLIENT_ROUTES.answer), 'answer')
      } catch (cause) {
        if (cause instanceof FirstRunError) throw cause
        throw new FirstRunError('absent', 0, null)
      }
    },
    status: statusFacts,
    remember: (name: string, voice: 'on' | 'off') => post(FIRST_RUN_CLIENT_ROUTES.name, { name, voice }, 'name'),
    rememberKey: (key: string) => post(FIRST_RUN_CLIENT_ROUTES.key, { key }, 'key'),
    forgetKey: () => post(FIRST_RUN_CLIENT_ROUTES.keyRemove, {}, 'key removal'),
  }
}
