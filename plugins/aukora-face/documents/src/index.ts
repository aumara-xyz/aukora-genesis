/**
 * The Documents face's host half: two read-only routes over `~/aukora-private`.
 *
 * WHAT THIS ROUTE IS FOR. The screen on the other side of it lists every markdown file
 * under the private root and opens one full-page. It cannot do that from the browser: the
 * page has no filesystem, and it must not be handed one. So the reading happens here, in
 * the host process, behind one fixed root.
 *
 * READ-ONLY, WITH ONE EXCEPTION. These handlers open files with the read-only flag, through
 * `documents-reader.ts`. No request can write, delete, move or copy a document: there is no
 * verb for it in the contract, and the only method accepted is GET. The one write is the
 * DEFAULT root itself: on a fresh install it does not exist yet, and the first listing
 * creates it as an empty private folder (mode 0700) instead of answering
 * `documents:root-missing` forever. A root named by AUKORA_DOCUMENTS_ROOT is never created:
 * a configured folder that is gone is a fact to report, not a folder to invent.
 *
 * THE BOUNDARY IS ENFORCED ON THE HOST, NOT BY THE BROWSER. The browser cannot ask for a
 * path outside the root and be trusted to mean it; `documents-reader.ts` resolves every
 * requested path against {@link DOCUMENTS_ROOT} and refuses, BY NAME, an escape, a
 * non-markdown target, and a target that does not exist. Three refusals, three reasons —
 * never one generic not-found, because "you asked for something outside my boundary" and
 * "that file is not there" call for different actions from whoever reads the answer.
 *
 * WHY THE SAME FENCE AS THE AUMLOK ROUTE. A route that serves private bytes without the
 * harness's own gate is reachable by any process on this machine. Every request is
 * therefore rejected by `connection.requestRejection` first, then held to GET, then to a
 * same-origin loopback caller — the order and the shape `plugins/aukora-face/aumlok`
 * already uses, deliberately copied rather than reinvented.
 *
 * @module @aukora/face-documents
 */
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdir } from 'node:fs/promises'
import {
  DOCUMENTS_FILE_ENDPOINT,
  DOCUMENTS_INDEX_ENDPOINT,
  documentsRequestedPath,
  type DocumentsRefusalReason,
} from './documents-route.ts'
import { DOCUMENTS_ROOT, listDocuments, readDocumentsDocument } from './documents-reader.ts'

export {
  DOCUMENTS_FILE_ENDPOINT,
  DOCUMENTS_INDEX_ENDPOINT,
  DOCUMENTS_PATH_REFUSALS,
  DOCUMENTS_REFUSAL_REASONS,
  DOCUMENTS_ROOT_CATEGORY,
  documentsFileRequest,
  documentsRequestedPath,
  parseDocumentsDocumentBody,
  parseDocumentsIndexBody,
  parseDocumentsRefusalBody,
} from './documents-route.ts'
export type {
  DocumentsDocumentAnswer,
  DocumentsDocumentBody,
  DocumentsEntry,
  DocumentsIndexAnswer,
  DocumentsIndexBody,
  DocumentsRefusalBody,
  DocumentsRefusalReason,
  DocumentsTitleSource,
} from './documents-route.ts'
export {
  DOCUMENTS_ROOT,
  documentsCategoryOf,
  filenameTitle,
  isMarkdownPath,
  listDocuments,
  readDocumentsDocument,
  resolveDocumentsTarget,
  titleFromMarkdown,
  withinRoot,
} from './documents-reader.ts'

/**
 * The trust surface a plugin-owned route must consult before it serves anything.
 *
 * Typed here because the connection package is browser-side and its types are not
 * importable from a host entry; the aumlok route declares the same shape for the same
 * reason.
 */
interface RouteGate {
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

/**
 * Required services: the loopback HTTP route registry, and the harness's own request gate.
 * A missing gate must fail the mount rather than serve private bytes ungated.
 */
export const inject = ['webServer', 'connection']

// **A `header(req, name)` HELPER WAS DECLARED HERE AND CALLED NOWHERE.** The identical function sat in three
// faces with zero call sites between them, and `noUnusedLocals` made each one a build error — so three faces
// could not be built, shipped stale, and kept a home path in their committed bundles.
//
// **IT IS REMOVED RATHER THAN WIRED.** Wiring it would mean inventing a call site for a helper whose callers
// were never written; leaving it blocks the build. It is four lines and it is in git history if the status
// route it was written for lands later — and `IncomingMessage` is still used elsewhere in this file, so nothing
// else moves.

/** Answer with no body but the honest status code. */
function end(res: ServerResponse, status: number): void {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end()
}

/** Answer with one JSON body. Nothing served here is cacheable or sniffable. */
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}

/** The HTTP status each refusal reason carries. The reason, not the code, is the contract. */
function refusalStatus(reason: DocumentsRefusalReason): number {
  switch (reason) {
    case 'documents:path-escapes-root': return 403
    case 'documents:not-markdown': return 415
    case 'documents:no-such-file': return 404
    case 'documents:unreadable': return 500
    case 'documents:root-missing': return 404
    case 'documents:root-unreadable': return 500
  }
}

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

/**
 * Run the three checks every request must pass, answering the refusal when it fails.
 * @param gate - the harness's per-route request gate.
 * @param req - the request.
 * @param res - the response, written to when the request is refused.
 * @returns true when the handler may serve.
 */
function admitted(gate: () => RouteGate, req: IncomingMessage, res: ServerResponse): boolean {
  // Authentication first, before the method or origin checks say anything: an
  // unauthenticated caller learns only the status code the harness gives everyone.
  const fence = fenceRejectionOf(gate(), req)
  if (fence.rejection !== undefined) {
    end(res, fence.rejection)
    return false
  }
  if (req.method !== 'GET') {
    res.setHeader('allow', 'GET')
    end(res, 405)
    return false
  }
  return true
}

/**
 * Create the DEFAULT documents root when it is not there yet, and only that one.
 *
 * `recursive` makes an existing folder a no-op, and the mode is the private one the state root
 * already uses. A failure is left to the listing that follows, which reports it by name.
 */
async function ensureDefaultRoot(): Promise<void> {
  if (process.env.AUKORA_DOCUMENTS_ROOT !== undefined) return
  await mkdir(DOCUMENTS_ROOT, { recursive: true, mode: 0o700 }).catch(() => undefined)
}

/** The index route: the root's markdown listing, re-read on every request. */
function indexRoute(gate: () => RouteGate): WebRoute {
  return {
    kind: 'exact',
    path: DOCUMENTS_INDEX_ENDPOINT,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (!admitted(gate, req, res)) return
      // FIRST USE ON A FRESH INSTALL: the default folder is made before it is listed.
      await ensureDefaultRoot()
      // ASKED PER REQUEST, NOT PER PROCESS: the reader keeps no cache, so a listing
      // always describes the tree as it is now.
      const answer = await listDocuments(DOCUMENTS_ROOT)
      if (answer.status === 'refused') json(res, refusalStatus(answer.reason), answer)
      else json(res, 200, answer)
    },
  }
}

/** The one-document route: raw markdown under a prefix, one segment per path segment. */
function fileRoute(gate: () => RouteGate): WebRoute {
  return {
    kind: 'prefix',
    path: DOCUMENTS_FILE_ENDPOINT,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (!admitted(gate, req, res)) return
      // The harness matches on the pathname; the raw url is parsed the same way it does.
      const pathname = new URL(req.url ?? '/', 'http://x').pathname
      const requested = documentsRequestedPath(pathname)
      if (requested === undefined) {
        // The prefix matched but the request names no document — the bare prefix, or a
        // percent-escape that decodes to nothing. It is refused by the same name a
        // missing file gets, with an empty subject, rather than answered as a listing.
        json(res, 404, { status: 'refused', reason: 'documents:no-such-file', subject: '' })
        return
      }
      const answer = await readDocumentsDocument(DOCUMENTS_ROOT, requested)
      if (answer.status === 'refused') json(res, refusalStatus(answer.reason), answer)
      else json(res, 200, answer)
    },
  }
}

/**
 * Register both read-only routes on the loopback web server.
 * @param ctx - host context carrying the route registry and the request gate.
 */
export function apply(ctx: Context): void {
  if (ctx.webServer.host !== '127.0.0.1') {
    // A private root served on an all-interfaces bind is a different program than this
    // one. Failing the mount says so; serving it quietly would not.
    throw new Error('ui-documents: the private documents routes require a loopback web server')
  }
  const gate = (): RouteGate => Reflect.get(ctx, 'connection') as RouteGate
  ctx.effect(() => ctx.webServer.register(indexRoute(gate)), 'ui-documents: documents index route')
  ctx.effect(() => ctx.webServer.register(fileRoute(gate)), 'ui-documents: one document route')
}
