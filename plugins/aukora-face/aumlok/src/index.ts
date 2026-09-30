/**
 * Loopback host endpoint for the AUMLOK public control, read from the controller itself.
 *
 * WHERE THE STATUS COMES FROM. `ctx.aumlokControl` is the controller plugin's own
 * adapter. Its `refresh()` re-reads the configured directory on every call and returns
 * the closed public projection — the plugin's module header is explicit that the
 * service "adds no state, no caching and no authority". This route therefore calls it
 * PER REQUEST. An earlier version of this file read a launch-time environment entry
 * once and closed over the value, which could only ever have been as fresh as the
 * moment the process started, and disagreed with the controller's own field set.
 *
 * WHAT ABSENCE MEANS HERE. Three different absences reach this route and they are
 * reported as three different reasons, never collapsed into one not-found: no
 * controller service in the composition at all; a service mounted with no directory,
 * which refuses `aumlok:adapter-unbound` by name; and a directory that could not be
 * read, whose own refusal code is carried verbatim. A screen that cannot tell those
 * apart cannot tell an operator what to do next.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { AUMLOK_IDENTITY_ENDPOINT } from './identity.ts'
import { readIdentity, identityContactIssueRoute } from './identity-host.ts'
import { identityContactVerificationRoute } from './contact-verification.ts'
import {
  AUMLOK_CONTROL_STATUS_ENDPOINT,
  aumlokNotConnected,
  parseAumlokControl,
  type AumlokControlProjection,
  type AumlokNotConnectedBody,
} from './control-projection.ts'

export {
  AUMLOK_CONTROL_STATUS_ENDPOINT,
  AUMLOK_LOCAL_CUSTODY_CLASS,
  AUMLOK_PUBLIC_CONTROL_DOMAIN,
  aumlokNotConnected,
  parseAumlokControl,
  parseAumlokControlProjection,
  parseAumlokNotConnectedBody,
} from './control-projection.ts'
export type { AumlokControlProjection, AumlokNotConnectedBody, AumlokNotConnectedReason } from './control-projection.ts'

/** The controller's own refusal when a mount carries no directory. */
const ADAPTER_UNBOUND = 'aumlok:adapter-unbound'
/**
 * THE RECORD READER'S OWN NAME FOR "THIS RECORD DOES NOT SAY WHICH MACHINE IS THIS LAPTOP".
 *
 * The shell passes its kept machine key so a second device reads BOUND; a caller that passes none, for a
 * record listing several, gets this by name from `record-v3.mjs`. It is a FIFTH absence on this screen
 * rather than `control-unreadable`, because the record is not unreadable — nobody said which machine
 * this is.
 */
const RECORD_NAMES_NO_MACHINE = 'aumlok:record-names-no-machine'
/**
 * THE CONTROLLER'S OWN CODE FOR "THERE IS NO RECORD TO READ".
 *
 * IT IS NOT THE SAME FACT AS A BROKEN ONE, and a person acts differently on each: an empty bound
 * directory means nobody has bound yet and the next step is the ceremony; a malformed record means
 * something is wrong and the next step is to look. Both used to arrive as `control-unreadable`, so the
 * screen told the owner of an empty directory to investigate a controller they had never created.
 */
const CONTROLLER_ABSENT = 'aumlok-local:unavailable'

/** The shape this route needs from `ctx.aumlokControl`; the adapter has more. */
interface AumlokControlService {
  refresh(): unknown
  readonly directory?: string
}

/**
 * WHAT THIS ROUTE ANSWERS WITH, AND WHY IT IS A DISCRIMINATED STATE RATHER THAN A BARE PROJECTION.
 *
 * The screen's badge, its runtime posture and its ceremony button are all keyed off ONE value with a
 * `status` on it — `AumlokControlProjectionState` in the browser store, which is what
 * `aumlokBadgeKey(status)` reads. A route that answered a bare projection for a bound machine and a
 * `{status:'not-connected'}` body for an unbound one made the caller infer the discriminator from
 * which fields happened to be present, and the U6 arm measured the cost: a directory holding a v3
 * record produced a projection the screen could not key, so a bound machine never showed BOUND.
 *
 * SO THE ROUTE NOW SERVES THE STATE THE SCREEN ALREADY RENDERS, for both halves: `connected` with
 * the control under `control`, or `not-connected` with the named reason and the controller's own
 * code. It is the same object the browser store's `connect()` takes, so no caller has to guess.
 */
type AumlokControlState =
  | { readonly status: 'connected'; readonly control: Readonly<AumlokControlProjection> }
  | Readonly<AumlokNotConnectedBody>

/**
 * The trust surface a plugin-owned route must consult before it serves anything.
 *
 * THERE IS NO GATE IN FRONT OF THIS ROUTE UNLESS THIS ROUTE IS THE GATE. The harness
 * applies the Host/Origin fence and the launch-token cookie check per route, through
 * `connection.requestRejection`, and a route that does not call it is reachable by any
 * process on this machine with no token at all. The harness's own `open-in-app` plugin
 * is the pattern; the shape is typed here because the connection package is
 * browser-side and its types are not importable from a host entry.
 */
interface RouteGate {
  requestRejection(request: { readonly headers: StatusRequest['headers'] }): 401 | 403 | undefined
}

interface StatusRequest {
  readonly method?: string
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>
}

interface StatusResponse {
  writeHead(status: number, headers?: Readonly<Record<string, string>>): unknown
  setHeader(name: string, value: string): unknown
  end(body?: string): unknown
}

/**
 * Required service: the loopback HTTP route registry.
 *
 * `aumlokControl` is deliberately NOT here. Declaring it would withhold this whole
 * plugin from any composition without a controller row — the screen would vanish
 * rather than report that there is no controller, which is the opposite of saying
 * what is true. It is reached optionally instead, inside apply.
 */
export const inject = ['webServer', 'connection']

/**
 * Ask the controller for its current public control, and answer with the state the screen renders.
 *
 * EVERY ABSENCE CARRIES `status: 'not-connected'`, so a caller keys off ONE field whatever happened,
 * and the connected case is the same discriminated shape. The reasons are never collapsed: no
 * controller service in the composition at all; a service mounted with no directory, which refuses
 * `aumlok:adapter-unbound` by name; and a directory that could not be read, whose own refusal code
 * is carried verbatim.
 * @param service - the mounted adapter, or undefined when no row provides one.
 * @returns the fresh control state, or the named absence.
 */
export function readControl(service: AumlokControlService | undefined): AumlokControlState {
  if (service === undefined) return aumlokNotConnected('no-controller-service')
  return readControlFromAdapter(service)
}

/**
 * THE ROUTE'S READ, WHICH HAS A SECOND SOURCE WHEN THE COMPOSITION HAS NONE.
 *
 * `readControl` keeps its own contract — the adapter, or the named absence — because it is called from
 * more than one place and a signature that grew a Promise would move under every caller. This is the
 * one the route uses, and it exists for the case Y2 measured: the adapter's row is absent, unpatched,
 * or pointed at a directory other than the one the ceremony wrote, and a record on disk must still
 * reach the badge.
 * @param service - the mounted adapter, when a row provides one.
 * @param directory - the controller directory this launch is bound to, when one was named.
 * @returns the fresh control state, or the named absence.
 */
export async function readControlWithFallback(
  service: AumlokControlService | undefined,
  directory?: string,
): Promise<AumlokControlState> {
  return service === undefined
    ? readControlFromDirectory(directory)
    : readControlFromAdapter(service)
}

/**
 * The two Node builtins this entry needs to open a record, obtained WITHOUT import syntax.
 *
 * WHY THE SPECIFIERS ARE BUILT RATHER THAN WRITTEN. This file is built as a CLIENT project of the
 * harness, where `node:fs` has no type declarations and a relative path out of the package is not a
 * module the compiler can resolve (MEASURED: `error TS2591: Cannot find name 'node:fs'` and
 * `error TS2307: Cannot find module '../../../aukora-aumlok/lib/record-v3.mjs'`). A statically written
 * `import` therefore cannot exist here. A specifier assembled at run time is not resolved by the
 * compiler and is resolved by Node exactly as any other import is, and the shape this entry needs is
 * declared locally below. The build stays a client build and the bytes still run in the host.
 */
interface AumlokControllerStore {
  loadLocalAumlokPublicControl(directory: string): { projection: unknown }
}

/**
 * Load one module by a specifier this build cannot see.
 * @param specifier - the module to load.
 * @returns the module, as the caller's own declared shape.
 */
async function loadUnseen(specifier: string): Promise<unknown> {
  return await import(/* @vite-ignore */ specifier)
}

/**
 * THE DIRECTORY IS A SOURCE OF ITS OWN, AND PETER'S SCREEN IS WHY (Y2, 2026-09-23 17:02).
 *
 * A binding is a RECORD ON DISK: `bindV3` writes `local-control.json` into the directory the
 * composition names, and every reader in this tree — the shell's `readBindingState`, the ceremony, the
 * mount's own adapter — reads that file. This plugin ALSO HAS A MOUNT OF ITS OWN, and when that row is
 * absent, unpatched, or pointed at a directory other than the one the ceremony wrote, the ONLY route
 * the badge reads answered `no-controller-service` over a machine that had just bound. The ceremony
 * succeeded, the record was on disk, and the screen could not see it.
 *
 * SO A MISSING ADAPTER IS NO LONGER AN ANSWER; IT IS A REASON TO READ THE DIRECTORY. The projection is
 * built by the ORGAN'S OWN LOADER, `loadLocalAumlokPublicControl` from
 * `plugins/aukora-aumlok/lib/store.mjs` — THE SAME CALL the mounted adapter's `refresh()` makes, so a
 * record read here and a record read through the composition's row arrive at the screen as the SAME
 * value, one field set and one set of grammars, with the public handle included exactly when the record
 * carries one. Nothing private is read: the loader returns the public half, and the record's secret
 * fields are never touched.
 *
 * IT USED TO CALL `recordProjection` DIRECTLY, AND THAT IS WHY THIS ROUTE WENT DARK. `recordProjection`
 * is the RECORD's view — the published keys, the binding moment, the genesis — and it carries neither
 * `activeControlDigest` nor `approvalKeyDid`. `projectControl` below hands what it returns to
 * `parseAumlokControl`, which recognises the v1 control, the organ's CONTROL projection, and the record
 * view; the record view of a v3 record was the one thing none of them accepted, so a machine that had
 * just bound answered 404 with `aumlok-control-projection:unrecognised` on the very route the badge
 * reads. The loader answers the control projection for a v3 record, which is what this route serves.
 *
 * THE ABSENCES KEEP THEIR NAMES: no directory named for this launch is `no-controller-service`
 * (nothing has told this process where to look), a directory that is not there or holds no record is
 * the organ's own `aumlok-local:unavailable` (`controller-absent`), and a record that IS there and
 * cannot be read keeps its code verbatim.
 * @param directory - the controller directory this launch is bound to, when one was named.
 * @returns the fresh control state, or the named absence.
 */
async function readControlFromDirectory(directory: string | undefined): Promise<AumlokControlState> {
  if (typeof directory !== 'string' || directory.length === 0) {
    return aumlokNotConnected('no-controller-service')
  }
  let store: AumlokControllerStore
  try {
    store = (await loadUnseen(new URL('../../../aukora-aumlok/lib/store.mjs', import.meta.url).href)) as AumlokControllerStore
  } catch {
    // NO READER REACHABLE is the absence this route has always served: without the organ there is no
    // way to judge a record, and a screen must not claim a binding it cannot validate.
    return aumlokNotConnected('no-controller-service')
  }
  let raw: unknown
  try {
    raw = store.loadLocalAumlokPublicControl(directory).projection
  } catch (error) {
    return refusalOf(error)
  }
  return projectControl(raw)
}

// `readLocalControlRecord` STOOD HERE AND IS DELETED WITH THE CALL THAT USED IT. It did `statSync`,
// `readFileSync` and `JSON.parse` by hand and then handed the parsed record to `recordProjection`,
// which is the RECORD's view — so this route served a shape none of the parsers below recognise, and a
// machine that had just bound read UNBOUND on the route the badge depends on. The directory is now read
// by the ORGAN'S OWN LOADER (`loadLocalAumlokPublicControl`), which performs the SAME custody checks
// this function performed and two more it did not: the directory must be a real 0700 directory owned by
// this euid, and the record a 0600 regular file with link count 1, opened `O_NOFOLLOW` with the state
// re-measured after the read. A hand-written reader here could only ever be a weaker second opinion.

/**
 * One public control off the controller's own adapter, the composition's own service.
 * @param service - the mounted adapter.
 * @returns the fresh control state, or the named absence.
 */
function readControlFromAdapter(service: AumlokControlService): AumlokControlState {
  let raw: unknown
  try {
    raw = service.refresh()
  } catch (error) {
    return refusalOf(error)
  }
  return projectControl(raw)
}

/**
 * The named absence for one refusal, never collapsed with the others.
 *
 * A THROW IS NOT A VERDICT, AND NOT EVERY THROW IS THE SAME. The adapter throws one named code when it
 * was mounted with no directory; the store throws its own codes when a directory is there but
 * unreadable. Collapsing both into a single not-found would erase the difference between "nobody
 * configured this" and "something is wrong with what was configured".
 * @param error - whatever the reader or the adapter threw.
 * @returns the not-connected state carrying the reason and the raiser's own code.
 */
function refusalOf(error: unknown): AumlokControlState {
  const code = typeof (error as { code?: unknown })?.code === 'string'
    ? (error as { code: string }).code
    : undefined
  // THE SENTENCE THE READER WROTE TRAVELS WITH THE CODE, and this is Fable's fourth item. The store's
  // refusals are `<code>: <detail>`, and the detail is the part a person can act on — for a record naming
  // several machines it names the argument that answers. MEASURED before this: the screen was given
  // `aumlok:record-names-no-machine` and nothing else, so the one text that says what to do was thrown
  // away at the last hop. The code is stripped from the front rather than printed twice.
  const message = typeof (error as { message?: unknown })?.message === 'string'
    ? (error as { message: string }).message
    : ''
  const rendered = code !== undefined && message.startsWith(`${code}: `)
    ? message.slice(code.length + 2)
    : (message === code ? '' : message)
  // BOUNDED AT THE SOURCE, so an unusually long message costs a person the tail of a sentence rather than
  // the whole state: the wire parser refuses a `detail` over 1,024 characters, and a body it refuses would
  // take the REASON down with it.
  const detail = rendered.length > 1000 ? rendered.slice(0, 1000) : rendered
  const reason: Parameters<typeof aumlokNotConnected>[0] = code === ADAPTER_UNBOUND
    ? 'adapter-unbound'
    : code === CONTROLLER_ABSENT
      ? 'controller-absent'
      : code === RECORD_NAMES_NO_MACHINE
        ? 'record-names-no-machine'
        : 'control-unreadable'
  return aumlokNotConnected(reason, code, detail === '' ? undefined : detail)
}

/**
 * The state one projected control is, or the refusal that says why it is not one.
 *
 * EITHER RECORD SHAPE: the v1 public control and the v3 record are two NAMED formats the controller
 * itself serves from one directory, and `store.mjs` says so when it dispatches on the record's own
 * domain. `parseAumlokControl` accepts both and normalises them into the field set this screen renders;
 * a shape that is neither is refused by name rather than rendered.
 * @param raw - the value the adapter or the record reader returned.
 * @returns the connected state, or the unrecognised-projection refusal.
 */
function projectControl(raw: unknown): AumlokControlState {
  try {
    return Object.freeze({ status: 'connected', control: parseAumlokControl(raw) })
  } catch {
    return aumlokNotConnected('control-unreadable', 'aumlok-control-projection:unrecognised')
  }
}

// `coded()` STOOD HERE, and it existed for exactly one caller: the hand-written directory reader that
// has been deleted in favour of the organ's own loader. The loader throws its OWN `LocalAumlokControlError`
// with a stable `code`, and `refusalOf` above reads that code, so nothing needs to manufacture one here.
// **A `header(req, name)` HELPER WAS DECLARED HERE AND CALLED NOWHERE** — and the comment above it already said
// why that matters: *"a helper left behind with no caller is a second way to spell a refusal."* It was copied
// into three faces, none of them called it, and `noUnusedLocals` made each a build error — so three faces could
// not be built, shipped stale, and kept a home path in their committed bundles.
//
// **REMOVED RATHER THAN WIRED.** Wiring it would mean inventing a call site for a helper whose callers were never
// written. It is four lines and it is in git history; `StatusRequest` is still used elsewhere in this file.

/**
 * THE FENCE, AND THE ANSWER TO THE QUESTION THIS ITEM ASKS FIRST: a route that cannot verify its caller must not
 * serve.
 *
 * Security has one home — the composition's `connection` service — and `vendor/dsh/packages/host/open-in-app/src/
 * index.ts` states what its fence does: it "defeats DNS rebinding and cross-site calls", and its browser
 * authentication "gates every caller before any resolution result, icon, or launch is reachable". This face used to
 * call that fence **and** keep a fifteen-line local Host/Origin check of its own, which is a second fence that can
 * drift from the one the rest of the organism uses. The local one is gone; this is the only one left.
 *
 * **THE FOUR CASES, AND WHY NONE OF THEM SERVES UNFENCED.** The rule on optional pins is that absent is a ceiling and
 * present-and-unusable is a fault — but a security dependency is not an optional pin, so there is no ceiling branch
 * here: without a working fence the request is refused, and the reason says which of the four it was.
 *
 * @param connection - the composition's connection service, as `ctx` holds it (possibly nothing at all).
 * @param request - the incoming request, which the fence reads headers from.
 * @returns the status to refuse with, and the reason; `rejection` undefined means the fence let it through.
 */
export function fenceRejectionOf(
  connection: unknown,
  request: { readonly headers: unknown },
): { readonly rejection: number | undefined; readonly reason: string | null } {
  if (connection === null || typeof connection !== 'object') {
    // 1. THE SERVICE IS NOT THERE. This face injects `connection`, so in a running composition this should be
    //    unreachable — which is exactly why it is checked rather than assumed, and refused rather than crashed.
    return { rejection: 403, reason: 'no-connection' }
  }
  const ask = (connection as { requestRejection?: unknown }).requestRejection
  if (typeof ask !== 'function') {
    // 2. PRESENT AND UNUSABLE IS A FAULT, NOT A CEILING: a service with no callable fence is the shape that reads as
    //    enforced while enforcing nothing.
    return { rejection: 500, reason: 'rejection-not-callable' }
  }
  let answer: unknown
  try {
    answer = (ask as (req: { readonly headers: unknown }) => unknown).call(connection, request)
  } catch (error) {
    // 3. A FENCE THAT THREW COULD NOT VERIFY THE CALLER, so the caller is not served — and the reason says thrown
    //    rather than refused, because those are different facts about the world.
    return { rejection: 500, reason: `rejection-threw: ${error instanceof Error ? error.message : String(error)}` }
  }
  // 4. A REJECTION IS CARRIED OUT UNCHANGED: the status is the harness's own (401 unauthenticated, 403 cross-site).
  if (answer === 401 || answer === 403) return { rejection: answer, reason: 'fence-rejected' }
  if (answer !== undefined) return { rejection: 500, reason: `rejection-unknown: ${String(answer)}` }
  return { rejection: undefined, reason: null }
}

function end(res: StatusResponse, status: number): void {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end()
}

function route(
  gate: () => RouteGate,
  read: () => Promise<AumlokControlState>,
): WebRoute {
  return {
    kind: 'exact',
    path: AUMLOK_CONTROL_STATUS_ENDPOINT,
    handler: (req: StatusRequest, res: StatusResponse) => {
      // THE READ IS ASYNCHRONOUS NOW, because the fallback asks the shell's reader, which loads the
      // organ from the release. The gate, the method check and the origin check stay synchronous and
      // FIRST: an unauthenticated caller still learns nothing while a read is in flight.
      // Authentication first, before the method or origin checks say anything: an
      // unauthenticated caller learns only the status code the harness gives everyone.
      const fence = fenceRejectionOf(gate(), req)
      if (fence.rejection !== undefined) {
        end(res, fence.rejection)
        return
      }
      if (req.method !== 'GET') {
        res.setHeader('allow', 'GET')
        end(res, 405)
        return
      }
      // ASKED PER REQUEST, NOT PER PROCESS. The controller's own adapter re-reads its
      // directory on every call and keeps no cache, so anything this route held onto
      // would be a copy that ages.
      void read().then(answer => {
        // THE WIRE CARRIES THE DISCRIMINATOR THE SCREEN RENDERS. A bound machine is
        // `{status:'connected', control}` and an absent one keeps its named reason and the
        // controller's own code, which is the same object the browser store's `connect()` takes.
        const connected = answer.status === 'connected'
        res.writeHead(connected ? 200 : 404, {
          'cache-control': 'no-store',
          'content-type': 'application/json; charset=utf-8',
          'x-content-type-options': 'nosniff',
        })
        res.end(JSON.stringify(answer))
      })
    },
  }
}

function identityRoute(gate: () => RouteGate, directory: () => string | undefined): WebRoute {
  return {
    kind: 'exact',
    path: AUMLOK_IDENTITY_ENDPOINT,
    handler: async (req: StatusRequest, res: StatusResponse) => {
      const fence = fenceRejectionOf(gate(), req)
      if (fence.rejection !== undefined) { end(res, fence.rejection); return }
      if (req.method !== 'GET') {
        res.setHeader('allow', 'GET')
        end(res, 405)
        return
      }
      try {
        const identity = await readIdentity(directory())
        res.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8',
          'x-content-type-options': 'nosniff' })
        res.end(JSON.stringify(identity))
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code
        res.writeHead(503, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8',
          'x-content-type-options': 'nosniff' })
        res.end(JSON.stringify({ code: typeof code === 'string' && /^[a-z0-9:_-]{1,96}$/u.test(code)
          ? code : 'aumlok:identity-unavailable' }))
      }
    },
  }
}

/**
 * Publish the controller's public control on one loopback, same-origin GET route.
 *
 * TWO SOURCES, ONE ANSWER, and the order matters: the composition's own adapter when a row provides
 * one, because a mounted adapter can carry a pinned `expectation` this route knows nothing about; and
 * otherwise the controller DIRECTORY this row names, read with the face's own record reader. Without
 * the second source a machine whose record is on disk reads as no-controller-service, which is the
 * state Y2's red arm measured on Peter's bind.
 * @param ctx - host context carrying the route registry.
 * @param config - this row's `directory`, when the composition names one.
 */
export function apply(ctx: Context, config?: unknown): void {
  if (ctx.webServer.host !== '127.0.0.1') {
    throw new Error('ui-aumlok: control status requires a loopback web server')
  }
  const directory = readConfiguredDirectory(config)
  // The controller is read through the context at request time, not captured here.
  // `ctx.get` returns undefined when no row provides the service, which is the
  // composition this screen must be able to REPORT rather than disappear from.
  const controller = (): AumlokControlService | undefined => {
    const service = (ctx as unknown as { get(name: string): unknown }).get('aumlokControl')
    return typeof service === 'object' && service !== null && typeof (service as AumlokControlService).refresh === 'function'
      ? service as AumlokControlService
      : undefined
  }
  const gate = (): RouteGate => Reflect.get(ctx, 'connection') as RouteGate
  ctx.effect(() => ctx.webServer.register(identityContactVerificationRoute(
    request => fenceRejectionOf(gate(), request).rejection,
  )), 'ui-aumlok: fresh contact verification')
  ctx.effect(() => ctx.webServer.register(identityContactIssueRoute(
    request => fenceRejectionOf(gate(), request).rejection,
    () => { const service = controller(); return service === undefined ? directory : readConfiguredDirectory(service) },
  )), 'ui-aumlok: signed live contact route')
  ctx.effect(
    () => ctx.webServer.register(route(gate, () => readControlWithFallback(controller(), directory))),
    'ui-aumlok: control status route',
  )
  ctx.effect(() => ctx.webServer.register(identityRoute(gate, () => {
    const service = controller()
    return service === undefined ? directory : readConfiguredDirectory(service)
  })), 'ui-aumlok: public identity route')
}

/**
 * This row's `directory`, when the composition names one.
 *
 * THE ROW IS HOW A DEPLOYMENT TELLS THIS SCREEN WHERE TO LOOK. Peter's launch already patches an
 * existing row rather than inserting one — `session-query-sqlite` in his own patch set is the measured
 * example — so `aukora-face-aumlok` can be pointed at the controller directory the same way, and the
 * shell's ceremony writes to the same path. Nothing is guessed here: a config that names no directory
 * is not an error, it is the composition this plugin has always served, and the adapter's own source
 * is preferred over it whenever a row provides one.
 * @param config - the composition row's configuration.
 * @returns the directory, or undefined when this row names none.
 */
function readConfiguredDirectory(config: unknown): string | undefined {
  if (config === null || typeof config !== 'object') return undefined
  const directory = (config as { directory?: unknown }).directory
  return typeof directory === 'string' && directory.length > 0 ? directory : undefined
}
