/**
 * THE LAYOUT FACE'S HOST HALF — four routes, and a fence in front of every one of them.
 *
 * The first-run screen needs two facts the browser cannot know by itself: **is this a first run**, and **is a key
 * stored**. It also needs to store two things the person gives it — their name and their model key — and to remove the
 * key when they ask. All four live here, and every one of them is fenced.
 *
 * **WHY THE FENCE IS NOT OPTIONAL, IN THE HARNESS'S OWN WORDS.** `plugins/aukora-face/settings/src/index.ts` puts it
 * plainly above its own route: "The harness has no gate in front of `/api` — it checks per route — so a route that
 * skips this call is readable by any process on this machine." And the fence's home is the composition's `connection`
 * service, whose purpose `vendor/dsh/packages/host/open-in-app/src/index.ts` states: its Host/Origin fence "defeats
 * DNS rebinding and cross-site calls", and its browser authentication "gates every caller".
 *
 * **THE SETTLED FAIL-CLOSED DECISION, APPLIED A FOURTH TIME.** `aumlok`, `documents` and `messages` each carry this
 * same gate, each with its own court, because there is no shared package for face host-halves and adding one would
 * change what is built and materialized for every face. The rule they settled is the rule here: a route that cannot
 * verify its caller must not serve — no `connection`, a non-callable `requestRejection`, a fence that throws, and a
 * fence that answers 401/403 each refuse, and only a present, callable, non-rejecting fence lets a request through.
 *
 * **THE KEY IS NEVER ECHOED.** A stored key is answered as its tail and nothing else; the key itself appears in no
 * response, no message and no error, and the file it lands in is readable only by its owner.
 *
 * @module ui-layout-host
 */

import type { Context } from '@deepseek-ai/cordis'
import { installComposerMode } from './composer-mode.ts'
// **THE SIDE-EFFECT IMPORT THAT LOADS THE AUGMENTATION.** `ctx.inject(['webServer', …])` types its callback
// from a registry that `@deepseek-ai/dsh-host-webserver` augments — **and an augmentation only exists if its package
// is imported.** `apps/src/index.ts:11` has this exact line; without it, `webCtx.webServer` is
// *"Property 'webServer' does not exist on type 'Context'"* at five sites. **The same shape as the memory face's
// missing `slots` import: a service that exists at runtime and not in the types, because nobody loaded the module
// that declares it.**
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  FIRST_RUN_REFUSALS, firstRunAnswer, forgetKey, rememberKey, rememberName, stateRootOf,
} from './first-run-host.ts'
import { readApprovalLog } from './approvals-log.ts'
import { readManifest } from './why-store.ts'
import { SAMPLER_INTERVAL_MS, liveSources, pushSample, sampleOnce } from './health-sample.ts'
import { watchdogLimitBytes } from './watchdog-limit.ts'
import type { HealthSample } from './client/health-model.ts'
import type { ApprovalLogRead } from './approvals-log.ts'

/** The route the Approvals view reads. **The client declares the same string; a court requires them to agree.** */
export const APPROVALS_ROUTE = '/api/aukora/approvals'

/** The route the Health view reads. The same rule applies: one string, two files, a court that requires agreement. */
export const HEALTH_ROUTE = '/api/aukora/health'

/** The route that answers "why did she say that?" for one reply. Same rule again. */
export const WHY_ROUTE = '/api/aukora/why'

/** The routes, in one place, so a court can name them without spelling a path twice. */
export const FIRST_RUN_ROUTES = Object.freeze({
  answer: '/api/aukora/first-run',
  name: '/api/aukora/first-run/name',
  key: '/api/aukora/first-run/key',
  keyRemove: '/api/aukora/first-run/key/remove',
})

/** A JSON body ceiling. The harness's own `open-in-app` uses 64 KiB for a request it reads; a key is far smaller. */
const BODY_CEILING_BYTES = 64 * 1024

/**
 * The fence, asked once per request. **THIS IS THE SAME GATE THE THREE OTHER FACES CARRY**, and it fails closed.
 *
 * @param connection - the composition's connection service, as `ctx` holds it (possibly nothing at all).
 * @param request - the incoming request, which the fence reads headers from.
 * @returns the status to refuse with and the reason; `rejection` undefined means the fence let it through.
 */
export function fenceRejectionOf(
  connection: unknown,
  request: { readonly headers: unknown },
): { readonly rejection: number | undefined; readonly reason: string | null } {
  if (connection === null || typeof connection !== 'object') return { rejection: 403, reason: 'no-connection' }
  const ask = (connection as { requestRejection?: unknown }).requestRejection
  if (typeof ask !== 'function') return { rejection: 500, reason: 'rejection-not-callable' }
  let answer: unknown
  try {
    answer = (ask as (req: { readonly headers: unknown }) => unknown).call(connection, request)
  } catch (error) {
    return { rejection: 500, reason: `rejection-threw: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (answer === 401 || answer === 403) return { rejection: answer, reason: 'fence-rejected' }
  if (answer !== undefined) return { rejection: 500, reason: `rejection-unknown: ${String(answer)}` }
  return { rejection: undefined, reason: null }
}

/** Read a JSON body, refusing anything that is not a small JSON object. Never returns the raw text. */
export async function readJsonBody(req: IncomingMessage): Promise<{ readonly ok: true; readonly value: Record<string, unknown> } | { readonly ok: false; readonly because: string }> {
  const type = typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : ''
  if (!type.toLowerCase().includes('application/json')) return { ok: false, because: 'not-json' }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > BODY_CEILING_BYTES) return { ok: false, because: 'too-large' }
    chunks.push(buf)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, because: 'not-object' }
    return { ok: true, value: parsed as Record<string, unknown> }
  } catch {
    return { ok: false, because: 'unparseable' }
  }
}

/** Answer with JSON and no cache, which is what every route here does. */
function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify(body))
}

export function apply(ctx: Context): void {
  installComposerMode(ctx)
  // Optional on purpose, exactly as the settings face does it: a composition with no web server still gets the face's
  // client half rather than losing the whole face over four routes.
  // **THE EXPLICIT `: Context` ANNOTATION WAS THROWING AWAY WHAT `inject` HAD JUST PROVIDED.**
  //
  // `ctx.inject(['webServer', 'connection'], cb)` hands the callback a context AUGMENTED with those two services —
  // **and annotating the parameter `Context` widens it straight back to the bare type**, so `webCtx.webServer` and
  // `webCtx.connection` do not exist on it. That is why five sites reported `Property 'webServer' does not exist on
  // type 'Context'`, and **why the line below reaches for `connection` through `Reflect.get`** — a workaround written
  // for the same problem one line after causing it.
  //
  // **THE PARAMETER NOW TAKES ITS INFERRED TYPE**, which is the injected one. The `webCtx` name is kept: it says
  // which context this is, and `apply`'s own `ctx` is a different one.
  ctx.inject(['webServer', 'connection'], webCtx => {
    const fence = (req: IncomingMessage): number | undefined =>
      fenceRejectionOf(Reflect.get(webCtx, 'connection'), req).rejection

    /** Every route starts here: fence first, then the method, then the work. */
    const guarded = async (
      req: IncomingMessage,
      res: ServerResponse,
      method: 'GET' | 'POST',
      work: () => Promise<void> | void,
    ): Promise<void> => {
      const rejection = fence(req)
      if (rejection !== undefined) {
        res.writeHead(rejection, { 'cache-control': 'no-store' })
        res.end()
        return
      }
      if (req.method !== method) {
        res.writeHead(405, { allow: method, 'cache-control': 'no-store' })
        res.end()
        return
      }
      await work()
    }

    const root = (): string | null => stateRootOf(process.env)

    /** The approval log's reader, reading state/logs and dropping the digests before anything leaves the host. */
    const readLog = (): ApprovalLogRead => {
      const stateRoot = root()
      return stateRoot === null
        ? { entries: [], absent: true, skipped: 0, mode: null }
        : readApprovalLog(stateRoot)
    }

    // ── THE HEALTH SAMPLER: ONE READING EVERY THIRTY SECONDS, INTO A RING THAT CANNOT GROW ──────────────────────
    // The ring holds at most `HEALTH_RING_SIZE` samples — an hour at this interval — and `pushSample` is the only way
    // to add one, so growth is impossible rather than managed. **THE TIMER BELONGS TO THIS EFFECT**, so stopping the
    // plugin stops the sampling: a health panel that kept reading the machine after it was switched off would be a
    // small process leak of exactly the kind it exists to report.
    let ring: readonly HealthSample[] = []
    const sampleNow = async (): Promise<void> => {
      try {
        const taken = await sampleOnce(liveSources(root()))
        ring = pushSample(ring, taken)
      } catch {
        // **A FAILED SAMPLE IS NOT A CRASH AND NOT A ZERO.** The sampler already answers null per fact; if it throws
        // anyway, this sample is simply not added, and the next one will be. A health panel that dies while measuring
        // is worse than one number short.
      }
    }
    webCtx.effect(() => {
      void sampleNow()
      const timer = setInterval(() => { void sampleNow() }, SAMPLER_INTERVAL_MS)
      return () => { clearInterval(timer) }
    }, 'ui-layout: health sampler')

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: WHY_ROUTE,
      handler: (req: IncomingMessage, res: ServerResponse) => guarded(req, res, 'GET', () => {
        // **THE REPLY IS NAMED BY THE CALLER AND A RECEIPT FOR ANOTHER REPLY IS NOT AN ANSWER.** A route that returned
        // the newest manifest whatever was asked would attribute one reply's prompt to another — the mistake this view
        // exists to make impossible.
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const replyId = url.searchParams.get('reply') ?? ''
        if (replyId === '') {
          send(res, 400, { absent: true, skipped: 0, manifest: null, why: 'no reply was named' })
          return
        }
        const read = root() === null
          ? { manifest: null, absent: true, skipped: 0, mode: null }
          : readManifest(root(), replyId)
        send(res, 200, { manifest: read.manifest, absent: read.absent, skipped: read.skipped, mode: read.mode })
      }),
    }), 'ui-layout: why this reply')

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: HEALTH_ROUTE,
      handler: (req: IncomingMessage, res: ServerResponse) => guarded(req, res, 'GET', () => {
        // **THE THRESHOLD IS THE WATCHDOG'S, READ FROM THEIR FILE, AND NULL WHEN IT CANNOT BE READ.** The panel then
        // reports the proximity as unknown rather than inventing a limit — the same rule as every other fact here.
        const limitBytes = watchdogLimitBytes()
        send(res, 200, { samples: ring, limitBytes, intervalMs: SAMPLER_INTERVAL_MS })
      }),
    }), 'ui-layout: health history')

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: APPROVALS_ROUTE,
      handler: (req: IncomingMessage, res: ServerResponse) => guarded(req, res, 'GET', () => {
        const read = readLog()
        // **THE ANSWER CARRIES NO DIGEST**, because the reader never put one on an entry. `absent`, `skipped` and the
        // file's mode travel with it so the view can say which of the three situations it is looking at rather than
        // rendering a fault as an empty history.
        send(res, 200, { entries: read.entries, absent: read.absent, skipped: read.skipped, mode: read.mode })
      }),
    }), 'ui-layout: approval history')

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: FIRST_RUN_ROUTES.answer,
      handler: (req: IncomingMessage, res: ServerResponse) => guarded(req, res, 'GET', () => {
        // A PROCESS WITH NO STATE ROOT IS A FIRST RUN WITH NOWHERE TO WRITE, and it says so rather than guessing a home.
        const stateRoot = root()
        send(res, 200, { ...firstRunAnswer(stateRoot), writable: stateRoot !== null })
      }),
    }), 'ui-layout: first-run answer')

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: FIRST_RUN_ROUTES.name,
      handler: (req: IncomingMessage, res: ServerResponse) => guarded(req, res, 'POST', async () => {
        const stateRoot = root()
        if (stateRoot === null) { send(res, 500, { code: FIRST_RUN_REFUSALS.NO_STATE_ROOT }); return }
        const body = await readJsonBody(req)
        if (!body.ok) { send(res, 400, { code: FIRST_RUN_REFUSALS.BODY_NOT_OBJECT, because: body.because }); return }
        const name = typeof body.value.name === 'string' ? body.value.name.trim() : ''
        if (name === '') { send(res, 400, { code: FIRST_RUN_REFUSALS.NAME_MISSING }); return }
        const voice = body.value.voice === 'on' || body.value.voice === 'off' ? body.value.voice : undefined
        send(res, 200, { ...rememberName(stateRoot, name, voice), writable: true })
      }),
    }), 'ui-layout: first-run name')

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: FIRST_RUN_ROUTES.key,
      handler: (req: IncomingMessage, res: ServerResponse) => guarded(req, res, 'POST', async () => {
        const stateRoot = root()
        if (stateRoot === null) { send(res, 500, { code: FIRST_RUN_REFUSALS.NO_STATE_ROOT }); return }
        const body = await readJsonBody(req)
        if (!body.ok) { send(res, 400, { code: FIRST_RUN_REFUSALS.BODY_NOT_OBJECT, because: body.because }); return }
        const key = typeof body.value.key === 'string' ? body.value.key.trim() : ''
        if (key === '') { send(res, 400, { code: FIRST_RUN_REFUSALS.KEY_MISSING }); return }
        // **WHAT COMES BACK IS THE TAIL.** The key itself is written and never echoed, logged or put in an error.
        send(res, 200, { ...rememberKey(stateRoot, key), writable: true })
      }),
    }), 'ui-layout: first-run key')

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: FIRST_RUN_ROUTES.keyRemove,
      handler: (req: IncomingMessage, res: ServerResponse) => guarded(req, res, 'POST', () => {
        const stateRoot = root()
        if (stateRoot === null) { send(res, 500, { code: FIRST_RUN_REFUSALS.NO_STATE_ROOT }); return }
        send(res, 200, { ...forgetKey(stateRoot), writable: true })
      }),
    }), 'ui-layout: first-run key removal')
  })
}
