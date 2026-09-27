/**
 * THE FOUR HOST ROUTES — LIST, VERIFY, FORGET, TRUST. (Fable's kira-121 item 4; contract line 8-11; design §6 and §2.4.)
 *
 * THE MOUNT IS MEASURED, NOT GUESSED: a host plugin injects `webServer` and calls
 * `ctx.effect(() => ctx.webServer.register({kind: 'exact', path, handler}))` — see
 * `vendor/dsh/packages/webhook/webhook-github/src/index.ts:14,53-59`. This module is the ROUTER that handler calls: it
 * decides status, shape and refusal from a request description, and it does no I/O at all, so a court drives every
 * branch with no server and no store.
 *
 * THREE DECISIONS TAKEN EXPLICITLY, because each one is visible to the app lane:
 *
 *  1. **VERIFY AND FORGET CARRY THE ID IN THE BODY.** The contract writes them as `/api/kira/memories/:id/verify`, and
 *     `kind: 'exact'` cannot carry a path parameter. Rather than leave AK-UI building against a shape I had not
 *     measured, the committed paths are `/api/kira/memories/verify` and `/api/kira/memories/forget` with `{id}` in the
 *     body. The contract's own `LIST` path is unchanged: `GET /api/kira/memories?tier=&q=&limit=&before=`.
 *  2. **`forgotten` AND `proposal` NEVER LEAVE THE STORE.** The list route's default tier set is `RECALL_TIERS`, and an
 *     explicit `?tier=forgotten` is REFUSED rather than honoured — a tombstone is not a memory anyone lists.
 *  3. **A WRITE OUTSIDE THE USER'S STATE DIR IS REFUSED BEFORE IT HAPPENS.** Forget is checked with
 *     `insideStateDir` from the path alone (Fable's court list: "nothing is written outside the user's state dir").
 *
 * AND `/api/kira/trust` ANSWERS A REFUSAL, NOT A SIGNATURE: §2.4 keeps `SIGNING_ENABLED` false until the owner is
 * required in person, so it returns `kira.memory:signing-gate-closed` and prints the ceiling. When that gate opens, one
 * Aumlok approval covers a MANIFEST OF EVERY NOTE IN FULL — the owner sees the text he is signing, not a list of ids.
 *
 * @module @aukora/dsh-plugin-kira/memory-routes
 */
import { RECALL_TIERS, SIGNING_CEILING, SIGNING_ENABLED, labelFor } from './memory-tiers.mjs'
import { insideStateDir } from './memory-forget.mjs'

/** The four paths, exported so the plugin registers exactly these and a court asserts exactly these. */
export const KIRA_ROUTES = Object.freeze({
  list: '/api/kira/memories',
  verify: '/api/kira/memories/verify',
  forget: '/api/kira/memories/forget',
  trust: '/api/kira/trust',
  // *** THE PENDING QUEUE, AND THE APPROVAL THAT ANSWERS IT. *** *Kira has staged ~125 proposals and the owner had no way
  // to approve one: the queue existed, the settle existed, and the door between them did not.*
  pending: '/api/kira/pending',
  approve: '/api/kira/approve',
})

/** The default page size, and the largest one, so a caller cannot ask for the whole store in one request. */
export const LIST_LIMITS = Object.freeze({ default: 50, max: 500 })

/** Named refusals a client reads and acts on. */
export const ROUTE_REFUSALS = Object.freeze({
  unknownPath: 'kira.route:unknown-path',
  methodNotAllowed: 'kira.route:method-not-allowed',
  tierNotListable: 'kira.route:tier-not-listable',
  bodyNotObject: 'kira.route:body-not-an-object',
  idMissing: 'kira.route:id-missing',
  outsideStateDir: 'kira.route:outside-state-dir',
})

/**
 * A trust request as ONE approval over a manifest.
 *
 * The manifest carries EVERY note's full text, in the order it will be signed, because an approval over a list of
 * identifiers is not an approval over what the owner is agreeing to. `approvalDigest` is the digest of the manifest's
 * own canonical form, so a signature over it is a signature over exactly these words.
 * @param {ReadonlyArray<Readonly<Record<string, unknown>>>} notes
 * @returns {{items: ReadonlyArray<{id: string, tier: string, text: string}>, count: number, manifestDigestSeed: string}}
 */
export function trustManifest(notes) {
  const items = notes.map(note => ({ id: String(note.id ?? ''), tier: String(note.tier ?? ''), text: String(note.text ?? note.statement ?? '') }))
  // The seed is what a caller hashes to produce the approval digest; it carries the words, not just the identifiers.
  const manifestDigestSeed = items.map(one => `${one.id}\u0000${one.text}`).join('\n')
  return { items, count: items.length, manifestDigestSeed }
}

/**
 * Route one request. Pure: the store, the ranker, the verifier and the chain reader all arrive as dependencies.
 * @param {{method: string, path: string, query?: Record<string, string>, body?: unknown}} request
 * @param {{listNotes?: (filter: {tiers: ReadonlyArray<string>, q: string, limit: number, before: string|null, now: string}) => Promise<ReadonlyArray<Record<string, unknown>>> | ReadonlyArray<Record<string, unknown>>, verify?: (id: string) => Record<string, unknown>, forget?: (id: string, reason: string) => Record<string, unknown>, stateDir?: string, journalFile?: string, now?: string}} deps
 * @returns {Promise<{status: number, body: unknown, headers?: Record<string, string>}>}
 */
/**
 * THE ROUTER IS ASYNC BECAUSE VERIFY IS: the verifier re-reads the session event from disk, so a synchronous router could never see
 * its answer. The mount has always `await`ed this call (`memory-mount.mjs:136`), so nothing on the live path changes, and the
 * decision returned is still `{status, body}` — only WHEN it is available changed.
 */
export async function routeRequest(request, deps = {}) {
  const method = String(request?.method ?? 'GET').toUpperCase()
  const path = String(request?.path ?? '').split('?')[0]
  const query = request?.query ?? {}

  if (path === KIRA_ROUTES.list) {
    if (method !== 'GET') return { status: 405, body: { error: ROUTE_REFUSALS.methodNotAllowed }, headers: { Allow: 'GET' } }
    const asked = query.tier === undefined || query.tier === '' ? [...RECALL_TIERS] : String(query.tier).split(',')
    // A TOMBSTONE IS NOT A MEMORY ANYONE LISTS. Asking for one is refused rather than quietly filtered, so a client
    // cannot believe it has seen the forgotten records.
    const notListable = asked.filter(one => !RECALL_TIERS.includes(/** @type {never} */ (one)))
    if (notListable.length > 0) {
      return { status: 400, body: { error: ROUTE_REFUSALS.tierNotListable, tiers: notListable, listable: [...RECALL_TIERS] } }
    }
    const limit = Math.min(LIST_LIMITS.max, Math.max(1, Number(query.limit ?? LIST_LIMITS.default) || LIST_LIMITS.default))
    const notes = await deps.listNotes?.({ tiers: asked, q: String(query.q ?? ''), limit, before: query.before ?? null, now: String(deps.now ?? '') }) ?? []
    return {
      status: 200,
      body: {
        // *** THE ITEM SHAPE IS THE CONTRACT'S RECORD, AND TWO THINGS WERE WRONG WITH IT UNTIL kira-122. *** Measured by running
        // `she-remembers-check.mjs` against Peter's real store, which is what that check exists for:
        //   · `label: labelFor(note)` DISCARDED THE NOTE'S OWN LABEL, so migrated notes whose label is `remembered, source not found`
        //     were listed as `unreviewed` — the note said one thing on disk and the route said another, and THE FACE READS THE ROUTE;
        //   · `source` and `aura` were nested under `citation` ONLY, while `.agents/live/MEMORY-CONTRACT-v0.md` puts them at the TOP
        //     LEVEL of a Record. A client built against the contract found no receipt at all and `verify` had nothing to ask about.
        // `citation` is KEPT — §4.3's Sources chip reads it — so this is additive rather than a rename.
        items: notes.map(note => ({
          id: note.id, tier: note.tier,
          label: String(note.label ?? labelFor(note)),
          kind: note.kind ?? note.category ?? null,
          text: note.text ?? note.statement,
          createdAt: note.createdAt ?? note.observedAt ?? null,
          validFrom: note.validFrom ?? null, observedAt: note.observedAt ?? null,
          source: note.source ?? null,
          aura: note.aura ?? null,
          receiptState: note.receiptState ?? null,
          bodyAtCapture: note.bodyAtCapture ?? null,
          evidence: note.evidence ?? [],
          citation: { source: note.source ?? null, evidence: note.evidence ?? [], aura: note.aura ?? null },
        })),
        next: notes.length < limit ? null : String(notes[notes.length - 1]?.id ?? ''),
      },
    }
  }

  // *** THE PENDING LIST, WITH THE EXACT BYTES THE OWNER WOULD BE APPROVING. ***
  // *A row showing a summary is a row the owner cannot judge: the settle binds the BYTES, so the bytes are what must be on
  // screen. An entry carries no authority material and grants nothing — it is a note that says "here are the exact words
  // you may choose to settle".*
  if (path === KIRA_ROUTES.pending) {
    if (method !== 'GET') return { status: 405, body: { error: ROUTE_REFUSALS.methodNotAllowed }, headers: { Allow: 'GET' } }
    // THE READER IS INJECTED, because this package allows `node:fs` to exactly one module and this is not it.
    const listed = typeof deps.pendingReview === 'function' ? await deps.pendingReview({}) : undefined
    if (listed === undefined) {
      // *** A QUEUE NOBODY CAN READ IS NOT AN EMPTY QUEUE. *** *`items: []` here would tell the owner he has nothing to
      // approve because a dependency was missing, which is the fail-open shape this repository keeps finding.*
      return { status: 503, body: { error: 'kira.route:pending-unavailable',
        because: 'no pending reader was mounted, so what is waiting cannot be listed' } }
    }
    return { status: 200, body: listed }
  }

  // *** THE APPROVAL: THE OWNER'S CLICK, TURNED INTO A PROPOSAL THE DAEMON FREEZES. ***
  // *THIS ROUTE CANNOT SETTLE, AND THAT IS THE DESIGN RATHER THAN A GAP. `settleAuthorized` refuses a store belonging to
  // another uid, so the agent side has no settle path that writes — the approval becomes a FROZEN PROPOSAL, the owner
  // answers it in person, and `settleAuthorisedProposal` in the daemon package calls Kira's own settle. ONE CHAIN, AND
  // THIS END OF IT HOLDS NO AUTHORITY.*
  if (path === KIRA_ROUTES.approve) {
    if (method !== 'POST') return { status: 405, body: { error: ROUTE_REFUSALS.methodNotAllowed }, headers: { Allow: 'POST' } }
    const id = idOf(request?.body)
    if (id === null) return { status: 400, body: { error: ROUTE_REFUSALS.idMissing } }
    if (typeof deps.approvePending !== 'function') {
      return { status: 503, body: { error: 'kira.route:approve-unavailable',
        because: 'no approval path was mounted, so nothing can be proposed to the owner' } }
    }
    const answer = await deps.approvePending({ recordId: id })
    return { status: answer?.ok === true ? 200 : 409, body: answer }
  }

  if (path === KIRA_ROUTES.verify) {
    if (method !== 'POST') return { status: 405, body: { error: ROUTE_REFUSALS.methodNotAllowed }, headers: { Allow: 'POST' } }
    const id = idOf(request?.body)
    if (id === null) return { status: 400, body: { error: ROUTE_REFUSALS.idMissing } }
    // *** THE VERIFIER IS `verifyNote`, TAKES `{id}`, AND IS ASYNC — AND THE ROUTE ASKED FOR `deps.verify(id)` WITH A BARE ID.
    // Measured 2026-09-26 by running `she-remembers-check.mjs` through these routes against Peter's real store: every verify came
    // back `unknown`, because `deps.verify` does not exist on ANY path — `buildRouteDeps` returns `verifyNote`
    // (`memory-deps.mjs:177`) and the mount documents `verifyNote` as the dependency it requires (`memory-mount.mjs:42`). So the
    // VERIFY route answered 404 `no-such-note` for every id it was ever asked, on every path. The court that covered this route
    // passed a stub whose key matched THE ROUTE rather than the deps — a stub that agreed with the bug — and whose verifier was
    // synchronous, so the async-ness the real one has was never exercised. BOTH NAMES ARE ACCEPTED so a caller written against
    // either spelling works; THE ARGUMENT IS `{id}` because that is what the real verifier destructures.
    const verifier = deps.verifyNote ?? deps.verify
    const answer = typeof verifier === 'function' ? await verifier({ id }) : undefined
    if (answer === undefined) return { status: 404, body: { error: 'kira.route:no-such-note', id } }
    return { status: 200, body: answer }
  }

  if (path === KIRA_ROUTES.forget) {
    if (method !== 'POST') return { status: 405, body: { error: ROUTE_REFUSALS.methodNotAllowed }, headers: { Allow: 'POST' } }
    const id = idOf(request?.body)
    if (id === null) return { status: 400, body: { error: ROUTE_REFUSALS.idMissing } }
    // THE STATE-DIR GUARANTEE, checked before anything is touched: the object file this forget would erase must be
    // inside the user's state directory, and the path is resolved textually so a traversal cannot slip out.
    const objectPath = `${String(deps.stateDir ?? '')}/kira-memory/remembered/${id}.json`
    if (deps.stateDir !== undefined && !insideStateDir(objectPath, deps.stateDir)) {
      return { status: 403, body: { error: ROUTE_REFUSALS.outsideStateDir, path: objectPath } }
    }
    // *** THE SAME DEFECT AS THE VERIFY ROUTE, IN THE NEXT BRANCH, FOUND THE SAME WAY: by driving real deps. *** This line asked for
    // `deps.forget(id, reason)` and the deps provide `forgetNote({id, reason})` (`memory-deps.mjs:148`), so `deps.forget` was undefined on
    // EVERY path and the forget route answered 404 `no-such-note` for every id it was ever given — WHICH MEANS NO TOMBSTONE HAS EVER BEEN
    // WRITTEN BY THIS ROUTE. kira-122 fixed the verify branch and I did not look at its neighbour, because no court drove the forget route
    // through real deps either. `kira-memory-forget` tests the ENGINE and `kira-memory-routes` tested a stub whose key matched the route;
    // the end-to-end court in kira-123 is the first thing that asked the ROUTE to forget something.
    const forgetter = deps.forgetNote ?? deps.forget
    const result = typeof forgetter === 'function' ? await forgetter({ id, reason: String(record_reason(request?.body) ?? '') }) : undefined
    if (result === undefined) return { status: 404, body: { error: 'kira.route:no-such-note', id } }
    return { status: 200, body: result }
  }

  if (path === KIRA_ROUTES.trust) {
    if (method !== 'POST') return { status: 405, body: { error: ROUTE_REFUSALS.methodNotAllowed }, headers: { Allow: 'POST' } }
    // §2.4: no batch signing ships, so this route CANNOT sign however good the request looks. The refusal names the
    // ceiling, and the shape of what it will do when the gate opens is in `trustManifest`.
    if (SIGNING_ENABLED !== true) {
      return {
        status: 503,
        body: {
          error: 'kira.memory:signing-gate-closed',
          ceiling: SIGNING_CEILING,
          why: 'signing needs the owner in person; until then a rule is stored as a note marked not in effect',
          wouldRequire: 'ONE Aumlok approval over a manifest carrying every note in full',
        },
      }
    }
    const ids = Array.isArray(request?.body?.ids) ? request.body.ids : []
    if (ids.length === 0) return { status: 400, body: { error: ROUTE_REFUSALS.idMissing } }
    const manifest = trustManifest(deps.notesFor?.(ids) ?? [])
    return { status: 200, body: { manifest, approvalDigestSeed: manifest.manifestDigestSeed } }
  }

  return { status: 404, body: { error: ROUTE_REFUSALS.unknownPath, path } }
}

/** The id a request body carries, or null. */
function idOf(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null
  const id = body.id
  return typeof id === 'string' && id !== '' ? id : null
}

/** The reason a forget request carries, if any. */
function record_reason(body) {
  return body !== null && typeof body === 'object' ? body.reason : undefined
}
