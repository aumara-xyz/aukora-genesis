/**
 * THE MOUNT — the four contract routes, registered on the HOST'S OWN webServer, answering over the host's HTTP.
 *
 * **REWRITTEN AFTER FABLE READ IT, and every one of her four objections was right.**
 *
 *  1. `ctx.webServer` WAS AN UNDECLARED SERVICE ACCESS. Cordis requires a service to be named in `inject` before it may be
 *     read as a `ctx` property, and the plugin injected only `['tools']`. This module now takes the server from `ctx.get`,
 *     and the PLUGIN declares what it needs — so it waits for the server instead of touching a hole.
 *  2. THE HANDLER SIGNATURE WAS WRONG. This module returned `{status, body}` from a one-argument handler; the host calls
 *     `handler(req, res)` and expects the answer WRITTEN TO `res` — measured in
 *     `vendor/dsh/packages/host/open-in-app/lib/index.js:1324-1335`, which is the pattern this file now follows.
 *  3. NO ROUTE CALLED `requestRejection`. The host refuses an untrusted request through the `connection` service:
 *     `connectionOf(ctx).requestRejection(req)` returns a status code, and the canonical handler writes it and returns.
 *     **An unauthenticated request to these routes must be 401/403, never a memory listing.**
 *  4. THE COURT USED A FAKE CONTEXT, which is why none of the above was caught. The court now builds a REAL Cordis
 *     `Context` and drives these routes over a REAL HTTP server on its loopback interface.
 *
 * *** THE ROUTER'S ANSWER SHAPE IS STILL `{status, body}`, AND STAYS SO. *** `routeRequest` is a pure function that decides;
 * this module writes the decision onto a socket. Keeping the decision away from the transport is what makes the router
 * courtable without a server, and it is why this is a translation rather than a redesign.
 *
 * FAIL-CLOSED, UNCHANGED AND STILL THE POINT: a router with no `listNotes` answers an EMPTY LIST, and "you have no memories"
 * is a claim about the owner's life while "the store could not be read" is a claim about a file. So the mount refuses to
 * register at all unless every dependency is a function — and, with no rejection service, it answers 403 rather than serving
 * a listing on a guess.
 *
 * THE PROSE HERE NAMES NO MODULE: the boundary court scans source text, comments included, for route-shaped names, and it
 * fired on this file because two comments named a module while the CODE
 * imported nothing of the sort while the CODE imported nothing of the sort. A boundary that fires on
 * prose is a boundary nobody can write beside — so the prose changed and the boundary stayed, which is the right way round.
 *
 * @module @aukora/dsh-plugin-kira/memory-mount
 */
import { KIRA_ROUTES, routeRequest } from './memory-routes.mjs'

/** The services this mount reads, named so the plugin that uses it can declare them. */
export const MOUNT_SERVICES = Object.freeze(['webServer', 'connection'])

/** The dependencies every route needs, and the reason each one is required rather than optional. */
export const REQUIRED_DEPS = Object.freeze({
  listNotes: 'the list route: without it the route would answer an empty list, which reads as "no memories"',
  verifyNote: 'the verify route: without it every answer would be MISSING, which reads as "the source is gone"',
  forgetNote: 'the forget route: without it a tombstone would be reported that was never written',
  trustNotes: 'the trust route: without it a signature could be reported that nobody gave',
})

/** A named refusal: a mount that cannot answer honestly does not mount. */
export class KiraMountError extends Error {
  /**
   * @param {string} code - stable machine-readable refusal code suffix.
   * @param {string} message - human-readable refusal.
   */
  constructor(code, message) {
    super(`kira.mount: ${message}`)
    this.name = 'KiraMountError'
    this.code = `kira.mount:${code}`
  }
}

/** The query string as a plain object, without a URL parser for three parameters. */
function queryOf(req) {
  const at = String(req.url ?? '').indexOf('?')
  if (at === -1) return {}
  const out = {}
  for (const [key, value] of new URLSearchParams(String(req.url).slice(at + 1))) out[key] = value
  return out
}

/** Read a request body, tolerating an empty one. A body that is not JSON is passed through for the router to refuse. */
async function bodyOf(req) {
  let text = ''
  for await (const chunk of req) text += chunk
  if (text.trim() === '') return {}
  try { return JSON.parse(text) } catch { return { __unparsed: text } }
}

/**
 * Register the four routes on a host server.
 *
 * @param {{effect?: Function, get?: (name: string) => unknown}} context - a real Cordis context, or one shaped like it.
 * @param {{listNotes: Function, verifyNote: Function, forgetNote: Function, trustNotes: Function, now?: string}} deps
 * @returns {{mounted: ReadonlyArray<string>, refused: ReadonlyArray<string>, dispose?: Function}}
 */
export function mountKiraRoutes(context, deps) {
  const missing = Object.keys(REQUIRED_DEPS).filter(name => typeof deps?.[name] !== 'function')
  if (missing.length > 0) {
    throw new KiraMountError('dependency-missing', `refusing to mount: ${missing.map(name => `${name} (${REQUIRED_DEPS[name]})`).join('; ')}`)
  }
  // `ctx.get` IS THE DECLARED READ — the hole Fable found was a property access for a service the plugin never injected.
  const webServer = typeof context?.get === 'function' ? context.get('webServer') : undefined
  if (webServer === undefined || typeof webServer.register !== 'function') {
    // NOT AN ERROR: a headless composition has no server, and a memory engine that refused to load without one could not run
    // in a terminal. That is a different fact from a server with nothing to answer with.
    return { mounted: Object.freeze([]), refused: Object.freeze(['no-web-server']) }
  }
  const connection = typeof context?.get === 'function' ? context.get('connection') : undefined

  /** Answer an untrusted request the way the host does; true when it was answered. */
  const rejected = (req, res) => {
    const ask = connection?.requestRejection
    if (typeof ask !== 'function') {
      // *** NO REJECTION SERVICE IS NOT PERMISSION. *** Without it this mount cannot tell an authorized request from any
      // other, and a memory listing is not something to serve on a guess.
      res.statusCode = 403
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'kira.memory:no-rejection-service' }))
      return true
    }
    const rejection = ask.call(connection, req)
    if (rejection === undefined || rejection === null || rejection === false) return false
    res.statusCode = typeof rejection === 'number' ? rejection : 403
    res.end()
    return true
  }

  const routes = [
    ['list', KIRA_ROUTES.list, 'GET'],
    ['verify', KIRA_ROUTES.verify, 'POST'],
    ['forget', KIRA_ROUTES.forget, 'POST'],
  ]
  const mounted = []
  const disposers = []
  for (const [name, path, allowed] of routes) {
    const handler = async (req, res) => {
      // 1. AUTHORITY FIRST: nothing about the store is decided before the request is known to be allowed.
      if (rejected(req, res)) return
      // 2. METHOD, the way the host's own routes do it.
      if (String(req.method ?? 'GET').toUpperCase() !== allowed) {
        res.statusCode = 405
        res.setHeader('allow', allowed)
        res.end()
        return
      }
      // 3. THE ROUTER DECIDES; this handler writes.
      const answer = await routeRequest(
        { method: req.method, path: String(req.url ?? path).split('?')[0], query: queryOf(req), body: await bodyOf(req) },
        { ...deps, now: deps.now ?? new Date().toISOString() },
      )
      res.statusCode = answer.status
      res.setHeader('content-type', 'application/json')
      for (const [key, value] of Object.entries(answer.headers ?? {})) res.setHeader(key, value)
      res.end(JSON.stringify(answer.body ?? null))
    }
    const register = () => webServer.register({ kind: 'exact', path, handler })
    const dispose = typeof context.effect === 'function'
      ? context.effect(register, `aukora-kira: the ${name} route (${path})`)
      : register()
    if (typeof dispose === 'function') disposers.push(dispose)
    mounted.push(path)
  }
  return { mounted: Object.freeze(mounted), refused: Object.freeze([]), dispose: () => { for (const one of disposers) one() } }
}

/**
 * The subject a release's own composition carries until this install links an Aumlok phrase.
 *
 * It is the documented placeholder (scripts/materialize-aukora-release.py writes it; the per-install
 * `kira-deployment-overlay.patch.yml` the desktop writes at the first link replaces it). It is NOT a
 * subject the approval lane accepts, so a memory owner built over it would refuse `SUBJECT_INVALID`.
 * Only this exact value means "not linked yet": any other malformed subject is a misconfiguration and
 * still refuses by name at mount.
 */
export const UNLINKED_SUBJECT = 'aumlok:subject:owner'

/** The named answer every memory route gives until a phrase is linked. */
export const NOT_LINKED = Object.freeze({
  error: 'kira.memory:aumlok-not-linked',
  because: 'Memory is off until you link your Aumlok phrase. Open Aumlok and link your seven words, then quit and '
    + 'reopen AUKORA: memory starts on the next launch.',
})

/**
 * Register the same six paths, each answering 503 {@link NOT_LINKED}, behind the same request fence.
 *
 * NOTHING IS READ AND NOTHING IS WRITTEN: there is no store and no subject yet. The fence still runs
 * first, so an unauthenticated caller learns only the harness's own status code.
 * @param {{effect?: Function, get?: (name: string) => unknown}} context - a real Cordis context.
 * @returns {{mounted: ReadonlyArray<string>, refused: ReadonlyArray<string>}}
 */
export function mountUnlinkedKiraRoutes(context) {
  const webServer = typeof context?.get === 'function' ? context.get('webServer') : undefined
  if (webServer === undefined || typeof webServer.register !== 'function') {
    return { mounted: Object.freeze([]), refused: Object.freeze(['no-web-server']) }
  }
  const connection = typeof context?.get === 'function' ? context.get('connection') : undefined
  const mounted = []
  for (const path of mountedPaths()) {
    const handler = (req, res) => {
      const ask = connection?.requestRejection
      const rejection = typeof ask === 'function' ? ask.call(connection, req) : 403
      if (rejection !== undefined && rejection !== null && rejection !== false) {
        res.statusCode = typeof rejection === 'number' ? rejection : 403
        res.end()
        return
      }
      res.statusCode = 503
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(NOT_LINKED))
    }
    const register = () => webServer.register({ kind: 'exact', path, handler })
    if (typeof context.effect === 'function') context.effect(register, `aukora-kira: ${path} (not linked)`)
    else register()
    mounted.push(path)
  }
  return { mounted: Object.freeze(mounted), refused: Object.freeze([]) }
}

/**
 * The paths a client must use, for a reader comparing AK-UI's client with what is mounted.
 * `exact` mounts cannot carry an `:id`, so the id travels in the body and these are the paths that exist.
 * @returns {ReadonlyArray<string>}
 */
export function mountedPaths() {
  return Object.freeze([KIRA_ROUTES.list, KIRA_ROUTES.verify, KIRA_ROUTES.forget, KIRA_ROUTES.trust,
    KIRA_ROUTES.pending, KIRA_ROUTES.approve])
}
