/**
 * THE EYE: an on-demand photograph of the window this shell is already showing.
 *
 * WHAT WAS MISSING. An agent could read every file of this app and still not see it. The
 * screenshot paths that exist are the owner's: he photographs his screen and hands the picture
 * over, and the loop waits for him. macOS refuses a screen capture from the backend's process
 * (`screencapture` answers `could not create image from display`), so the agent has no picture of
 * the thing it is changing.
 *
 * THE DOOR THAT NEEDS NO PERMISSION. An application may always photograph its own window, and
 * Electron exposes exactly that as `webContents.capturePage()`. The shell already used it once per
 * launch for `AUKORA_DESKTOP_CAPTURE`; this makes it a request. **The window is the one that is
 * already open** — this does not create, show, focus or close anything, which is why a capture
 * cannot flash on the owner's screen or change the window count.
 *
 * WHO MAY ASK. A loopback HTTP server on a random port, reachable only from this machine, gated by
 * (1) a bearer token minted per launch and handed to the backend child in its environment — never
 * on a command line, never in a file, never logged; (2) a Host header that names this listener on
 * loopback, which is the DNS-rebinding fence; and (3) an Origin header that, when a browser sends
 * one, names loopback too. The fence is phi's (`surface/door.ts`'s `localPost`/`sensitivePost`):
 * a same-origin gesture check, not an identity, and it is not called authentication.
 *
 * THE ONE WINDOW THAT IS NEVER PHOTOGRAPHED. The one-bit approval window puts an operation in front
 * of a person. Captures refuse by name while that window is open, and this module only ever touches
 * the window `getWindow()` named — it holds no other window handle and never looks one up.
 *
 * @module aukora-desktop/eye
 */

import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** The route that returns a picture of the window. */
export const EYE_ROUTE = '/eye/capture'
/** The route that returns the accessibility tree, with a stable ref per node. */
export const EYE_SNAPSHOT_ROUTE = '/eye/snapshot'
/** The route that clicks or types by ref, through the debugger's input domain. */
export const EYE_ACT_ROUTE = '/eye/act'

/** Named refusals. A caller reads the code, not a sentence, and none of them carries the token. */
export const EYE_REFUSE = Object.freeze({
  METHOD: 'eye.method',
  NOT_FOUND: 'eye.not-found',
  FORBIDDEN_HOST: 'eye.forbidden-host',
  FORBIDDEN_ORIGIN: 'eye.forbidden-origin',
  UNAUTHORIZED: 'eye.unauthorized',
  APPROVAL_OPEN: 'eye.approval-open',
  NO_WINDOW: 'eye.no-window',
  BAD_BODY: 'eye.bad-body',
  BAD_RECT: 'eye.bad-rect',
  BODY_TOO_LARGE: 'eye.body-too-large',
  CAPTURE_FAILED: 'eye.capture-failed',
  // E1. The bind surface is refused for the same reason the approval window is, and MORE so: its
  // accessibility tree is the phrase and its answer in a form that is easier to read than a screenshot.
  BIND_SURFACE_OPEN: 'eye.bind-surface-open',
  DEBUGGER_UNAVAILABLE: 'eye.debugger-unavailable',
  UNKNOWN_REF: 'eye.unknown-ref',
  BAD_ACTION: 'eye.bad-action',
})

/**
 * The widest picture this door will return, in pixels.
 *
 * A vision model does not need more, and an oversized capture rides every later model request.
 * Smaller requests are never upscaled: the shell returns what the window actually has.
 */
export const EYE_MAX_WIDTH = 1280

/** JSON request bodies are three small fields; anything larger is not this door's caller. */
const BODY_LIMIT_BYTES = 4 * 1024

/**
 * How much this door will read and THROW AWAY so that a named refusal can actually be delivered.
 *
 * It is far above the parse limit on purpose. The refusal a caller is owed for an oversized body is
 * itself the reason to keep reading: stopping at the parse limit closes the connection under the reply,
 * which is how an oversized `/eye/act` used to come back as a closed socket with no code at all. A
 * caller streaming megabytes past a door that has already refused it is the only case the ceiling is
 * for.
 */
const DRAIN_CEILING_BYTES = 1024 * 1024

/** Environment variable names the backend child reads. The token travels in the environment only. */
export const EYE_ENV = Object.freeze({
  URL: 'AUKORA_EYE_URL',
  TOKEN: 'AUKORA_EYE_TOKEN',
})

/**
 * Whether a Host or Origin value names this listener on loopback.
 *
 * `new URL` is used for the Origin half so a value like `http://127.0.0.1:1@evil.example` — which
 * starts with a loopback prefix and resolves elsewhere — is refused rather than prefix-matched.
 * @param value - the raw header value.
 * @param port - the port this listener bound.
 * @returns true when the value names 127.0.0.1 or localhost on that port.
 */
export function namesThisListener(value, port) {
  if (typeof value !== 'string' || value.length === 0) return false
  const host = value.includes('://') ? safeHost(value) : value
  if (host === undefined) return false
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`
}

/**
 * The host component of an absolute URL, or undefined when it cannot be parsed.
 * @param value - an absolute URL.
 * @returns the authority, or undefined.
 */
function safeHost(value) {
  try {
    return new URL(value).host
  } catch {
    return undefined
  }
}

/**
 * Compare a presented token with the minted one without leaking its length or prefix.
 * @param presented - the value the caller sent.
 * @param expected - the per-launch token.
 * @returns true only for an exact match of equal length.
 */
export function tokenMatches(presented, expected) {
  if (typeof presented !== 'string' || presented.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(presented, 'utf8'), Buffer.from(expected, 'utf8'))
}

/**
 * The bearer token from an Authorization header, or the bare `x-eye-token` value.
 * @param headers - request headers.
 * @returns the presented token, or '' when none was sent.
 */
function presentedToken(headers) {
  const authorization = headers.authorization
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim()
  }
  const direct = headers['x-eye-token']
  return typeof direct === 'string' ? direct.trim() : ''
}

/**
 * Validate one optional capture rectangle.
 *
 * A rectangle is in the window's own device-independent pixels, which is the coordinate space
 * `capturePage` takes. Every field must be a non-negative integer and the rectangle must be
 * non-empty, so a malformed request refuses by name instead of photographing something else.
 * @param value - the raw `rect` field.
 * @returns the rectangle, `null` for an absent rectangle, or undefined when malformed.
 */
function parseRect(value) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) return undefined
  const { x, y, width, height } = value
  for (const field of [x, y, width, height]) {
    if (!Number.isInteger(field) || field < 0) return undefined
  }
  if (width === 0 || height === 0) return undefined
  return { x, y, width, height }
}

/**
 * Validate one optional scale multiplier.
 * @param value - the raw `scale` field.
 * @returns the multiplier, or undefined when malformed or out of range.
 */
function parseScale(value) {
  if (value === undefined || value === null) return 1
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1) return undefined
  return value
}

/**
 * Read a bounded JSON body, and READ IT TO ITS END even when it is over the bound.
 *
 * OVER THE LIMIT IS NOT A REASON TO STOP READING. The first version of this function returned the
 * `body-too-large` refusal the moment the byte count crossed `BODY_LIMIT_BYTES` — measured on `/eye/act`
 * as a CLOSED SOCKET with no named refusal at all, because the reply was written while the caller was
 * still sending: the remaining bytes arrive at a socket that has already answered, and on a kept-alive
 * connection the NEXT request is then parsed starting from the middle of this one. The bytes are
 * DISCARDED instead of parsed (so nothing over the limit is ever buffered), the body is read to its end,
 * and the refusal that comes back is the named 413 the caller was owed.
 *
 * THE DISCARD PHASE IS TIME-BOXED. A caller that declares a large body and then stops writing must not
 * be able to hold the door open, so once the limit is crossed a one-second guard destroys the request.
 * An honest body of three small fields on loopback never reaches it: the guard is armed only after the
 * limit is already exceeded.
 * @param req - the incoming request.
 * @returns the parsed body, or a named refusal.
 */
async function readJsonBody(req) {
  let size = 0
  let over = false
  let guard = null
  const chunks = []
  try {
    for await (const chunk of req) {
      size += chunk.length
      if (size > BODY_LIMIT_BYTES) {
        over = true
        // Nothing over the limit is retained: the array is emptied once and never appended to again.
        chunks.length = 0
        if (guard === null) guard = setTimeout(() => { req.destroy() }, 1000)
        continue
      }
      chunks.push(chunk)
    }
  } catch {
    // A destroyed request mid-read (the guard above, or a caller that hung up) has no body to parse.
    // When the limit was already crossed the caller is owed the 413 rather than a second code.
    if (!over) return { ok: false, code: EYE_REFUSE.BAD_BODY }
  } finally {
    if (guard !== null) clearTimeout(guard)
  }
  if (over) return { ok: false, code: EYE_REFUSE.BODY_TOO_LARGE }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text.length === 0) return { ok: true, body: {} }
  try {
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, code: EYE_REFUSE.BAD_BODY }
    }
    return { ok: true, body: parsed }
  } catch {
    return { ok: false, code: EYE_REFUSE.BAD_BODY }
  }
}

/**
 * Downscale a captured image to the door's width ceiling, leaving smaller captures alone.
 *
 * The picture is never upscaled and never cropped: a caller that wants a region asks for it in the
 * request rectangle, where the coordinate space is the window's own.
 * @param image - the nativeImage Electron returned from `capturePage`.
 * @param maxWidth - the width ceiling.
 * @returns the image to encode and the size that will be returned.
 */
function fitToCeiling(image, maxWidth) {
  const size = image.getSize()
  if (!Number.isFinite(size.width) || size.width <= maxWidth) return { image, size }
  const resized = image.resize({ width: maxWidth })
  return { image: resized, size: resized.getSize() }
}

/**
 * Open the eye.
 *
 * The caller owns the window and the approval's state; this module asks for both on every request
 * rather than holding them, so a window replaced later is photographed as its replacement and an
 * approval that opens mid-flight is seen.
 *
 * @param {object} deps - the shell's own facts.
 * @param {() => object | null | undefined} deps.getWindow - the application window, or nothing.
 * @param {() => boolean} [deps.isApprovalOpen] - whether the one-bit approval window is open.
 * @param {() => boolean} [deps.isDrawPending] - whether a drawn bind phrase is in flight. THE NAME IS
 *   THE BRIDGE'S OWN: `apps/aukora-desktop/aumlok-bridge.mjs` publishes exactly `isDrawPending`, and a
 *   door that asks for a name the bridge does not have is a fence that never fires.
 * @param {(line: string) => void} [deps.log] - the shell's log sink.
 * @param {number} [deps.maxWidth] - width ceiling override, for tests.
 * @param {() => Promise<number>} [deps.listen] - test seam: bind the server, returning its port.
 * @returns {Promise<{port: number, url: string, token: string, env: Record<string, string>, dispose: () => Promise<void>}>}
 *   the live door: its loopback URL, the token the backend child receives, the two environment
 *   entries to hand that child, and the disposer.
 */
export async function installEyeDoor(deps) {
  // THE FILESYSTEM IS A DEPENDENCY HERE ONLY SO THE FAILURE PATH IS TESTABLE: a door that cannot write its
  // token file must say so and keep serving, and a court cannot make `writeFileSync` fail without either
  // root or a read-only directory it may not create.
  const fs = deps.fs ?? { mkdirSync, renameSync, unlinkSync, writeFileSync }
  const say = typeof deps.log === 'function' ? deps.log : () => {}
  const maxWidth = deps.maxWidth ?? EYE_MAX_WIDTH
  const isApprovalOpen = deps.isApprovalOpen ?? (() => false)
  /**
   * Whether a drawn bind phrase is in flight. Its tree is a secret in a readable form.
   *
   * THE NAME IS THE BRIDGE'S OWN, and that is the whole protection rather than a naming preference.
   * This dependency was called `isCeremonyOpen`, the shell handed it
   * `aumlokBridge?.isCeremonyOpen?.()`, and the bridge publishes no such method — so the optional call
   * returned undefined, `undefined === true` was false, and the fence meant to shut this door over a
   * drawn phrase never fired once. One name on both sides is what makes that impossible to repeat;
   * `tests/aukora-eye-sight.test.mjs` reads the bridge's published getter names and fails if the shell
   * asks for one the bridge does not have.
   */
  const isDrawPending = deps.isDrawPending ?? (() => false)
  /** Refs from the most recent snapshot, so an act can name what the caller was shown. */
  const refs = new Map()
  const token = randomBytes(32).toString('base64url')

  /**
   * Put the token where a process that is NOT the backend child can read it — and only its owner can.
   *
   * WHY THIS EXISTS. The token's first home is still the backend child's environment, which is where the
   * mounted eye tool reads it; that has not changed. But that environment is the one thing a lane cannot
   * see, so the live check had no way to authenticate. This file is the second home: inside the app's own
   * state root, mode 0600, written atomically (a temporary file renamed into place, so a reader never sees
   * half a token and no window exists in which the bytes are readable by anyone else), and removed when
   * the door is disposed.
   *
   * WHAT IS NEW IS A SECRET AT REST, so it is written down here rather than implied: the door serves
   * exactly as before — same token, same header, same Host/Origin fences, same routes and refusals — and
   * this changes only who else can learn the token, which is now the file's owner and nobody else.
   * @param path - where to write it.
   */
  const writeTokenFile = (path) => {
    try {
      // A STALE TOKEN FILE IS DELETED BEFORE A NEW ONE IS WRITTEN. A previous launch killed without
      // running dispose leaves its file behind, and a reader that finds it authenticates with a token no
      // living door accepts — a 401 that looks like a broken check. Removing first also means a write that
      // FAILS cannot leave the old file sitting there looking current: either the new token is there, or
      // there is no file to mislead anyone. If the stale file cannot be removed, that is itself the
      // failure: nothing is written over it.
      try {
        fs.unlinkSync(path)
      } catch (error) {
        // ENOTDIR means the path's parent is not a directory, so nothing can be stale there and the real
        // failure is the write below — reporting it as a removal failure would name the wrong thing.
        if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') {
          say(`eye: stale token file not removed (${error?.code ?? error?.message ?? error}) at ${path}`)
          return false
        }
      }
      fs.mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      const handle = `${path}.${process.pid}.tmp`
      fs.writeFileSync(handle, `${token}\n`, { mode: 0o600 })
      fs.renameSync(handle, path)
      return true
    } catch (error) {
      // A DOOR THAT CANNOT WRITE THE FILE STILL OPENS. The backend child gets the token from its
      // environment either way, so this failure costs the live check, not the eye — and it is logged as a
      // code with the path, never with the token in it.
      say(`eye: token file not written (${error?.code ?? error?.message ?? error}) at ${path}`)
      return false
    }
  }

  /** One JSON refusal: a code the caller can branch on, and never anything about the token. */
  const refuse = (res, status, code, detail) => {
    const body = JSON.stringify(detail === undefined ? { ok: false, code } : { ok: false, code, detail })
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
    res.end(body)
  }

  /** One JSON answer, used by the two self-sight routes. Never carries the token. */
  const answer = (res, status, value) => {
    const body = JSON.stringify(value)
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
    res.end(body)
    return undefined
  }

  /**
   * The debugger for the window this door was handed, attached if it is not attached yet.
   *
   * THE ONLY WAY THIS DOOR SEES STRUCTURE. `webContents.debugger` speaks the Chrome DevTools Protocol
   * to this window from inside the process; a remote debugging port would expose the same protocol
   * to any local process instead, which is why the app opens none and why the court reads the sources
   * to keep it that way.
   * @param window - the window `getWindow()` named.
   * @returns the attached debugger.
   */
  const debuggerFor = async (window) => {
    const dbg = window?.webContents?.debugger
    if (dbg === undefined || dbg === null || typeof dbg.sendCommand !== 'function') {
      const error = new Error('this window exposes no debugger to attach')
      error.eyeCode = EYE_REFUSE.DEBUGGER_UNAVAILABLE
      throw error
    }
    try {
      if (typeof dbg.isAttached !== 'function' || dbg.isAttached() !== true) dbg.attach()
    } catch (error) {
      const wrapped = new Error(`the debugger could not be attached: ${error?.message ?? error}`)
      wrapped.eyeCode = EYE_REFUSE.DEBUGGER_UNAVAILABLE
      throw wrapped
    }
    return dbg
  }

  /**
   * The accessibility tree, flattened to nodes a caller can aim at.
   *
   * REFS ARE DERIVED, NOT RANDOM: role, name, and the node's ordinal among nodes with that same role and
   * name. That makes a ref stable across two snapshots of an unchanged tree, which is what lets a caller
   * snapshot, decide, and then act on what it saw. A tree whose shape changes can still move a ref, and
   * that limit is stated here rather than implied: the ref is a name for a control, not a handle on it.
   */
  const snapshot = async (res, window, req) => {
    req.resume()
    let dbg
    try {
      dbg = await debuggerFor(window)
    } catch (error) {
      return refuse(res, 503, error.eyeCode ?? EYE_REFUSE.DEBUGGER_UNAVAILABLE, String(error.message))
    }
    let tree
    try {
      await dbg.sendCommand('Accessibility.enable')
      tree = await dbg.sendCommand('Accessibility.getFullAXTree')
    } catch (error) {
      return refuse(res, 503, EYE_REFUSE.DEBUGGER_UNAVAILABLE, String(error?.message ?? error))
    }
    const seen = new Map()
    const nodes = []
    refs.clear()
    for (const node of tree?.nodes ?? []) {
      const role = String(node?.role?.value ?? '')
      if (role === '') continue
      const name = String(node?.name?.value ?? '')
      const key = `${role}\u0000${name}`
      const ordinal = seen.get(key) ?? 0
      seen.set(key, ordinal + 1)
      const ref = `${role}:${name}:${ordinal}`
      refs.set(ref, { backendDOMNodeId: node?.backendDOMNodeId ?? null, role, name })
      nodes.push({ ref, role, name })
    }
    return answer(res, 200, { ok: true, nodes, count: nodes.length })
  }

  /**
   * Click or type on a ref from the last snapshot, through the input domain.
   *
   * TRUSTED INPUT, NOT SYNTHESISED EVENTS. `Input.dispatchMouseEvent` and `Input.insertText` are the
   * protocol's own input path, so the page receives what a person's click and typing look like rather
   * than an untrusted event a listener could tell apart. What comes back is a record of what was done.
   */
  const act = async (res, window, req) => {
    const read = await readJsonBody(req)
    if (!read.ok) return refuse(res, read.code === EYE_REFUSE.BODY_TOO_LARGE ? 413 : 400, read.code)
    const ref = typeof read.body?.ref === 'string' ? read.body.ref : ''
    const action = typeof read.body?.action === 'string' ? read.body.action : ''
    const target = ref === '' ? undefined : refs.get(ref)
    if (target === undefined) {
      return refuse(res, 409, EYE_REFUSE.UNKNOWN_REF, 'no snapshot ref matches that name; take a snapshot first')
    }
    let dbg
    try {
      dbg = await debuggerFor(window)
    } catch (error) {
      return refuse(res, 503, error.eyeCode ?? EYE_REFUSE.DEBUGGER_UNAVAILABLE, String(error.message))
    }
    if (action === 'click') {
      if (target.backendDOMNodeId === null) return refuse(res, 409, EYE_REFUSE.UNKNOWN_REF, 'that node has no box to click')
      let box
      try {
        box = await dbg.sendCommand('DOM.getBoxModel', { backendNodeId: target.backendDOMNodeId })
      } catch (error) {
        return refuse(res, 503, EYE_REFUSE.DEBUGGER_UNAVAILABLE, String(error?.message ?? error))
      }
      const quad = box?.model?.content
      if (!Array.isArray(quad) || quad.length < 8) return refuse(res, 409, EYE_REFUSE.UNKNOWN_REF, 'that node has no box to click')
      const xs = [quad[0], quad[2], quad[4], quad[6]]
      const ys = [quad[1], quad[3], quad[5], quad[7]]
      const x = (Math.min(...xs) + Math.max(...xs)) / 2
      const y = (Math.min(...ys) + Math.max(...ys)) / 2
      try {
        await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
        await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
      } catch (error) {
        return refuse(res, 503, EYE_REFUSE.CAPTURE_FAILED, String(error?.message ?? error))
      }
      return answer(res, 200, { ok: true, action, ref, at: { x, y } })
    }
    if (action === 'type') {
      const text = read.body?.text
      if (typeof text !== 'string' || text === '') {
        return refuse(res, 400, EYE_REFUSE.BAD_ACTION, 'typing needs a non-empty text field')
      }
      try {
        if (target.backendDOMNodeId !== null) await dbg.sendCommand('DOM.focus', { backendNodeId: target.backendDOMNodeId })
        await dbg.sendCommand('Input.insertText', { text })
      } catch (error) {
        return refuse(res, 503, EYE_REFUSE.CAPTURE_FAILED, String(error?.message ?? error))
      }
      return answer(res, 200, { ok: true, action, ref, typed: text.length })
    }
    return refuse(res, 400, EYE_REFUSE.BAD_ACTION, `action '${action}' is not click or type`)
  }

  const handler = async (req, res) => {
    // A REFUSAL MUST NOT OUTRUN THE REQUEST BODY. Answering before the caller has finished writing closes
    // the socket underneath the reply, and the caller sees an aborted response instead of the named
    // refusal — measured on /eye/act, where an unauthorised POST came back with no body at all. Only the
    // paths that refuse BEFORE reading a body drain it; the capture and act paths still read their own.
    // DRAIN, THEN REFUSE — not refuse and hope. A refusal that answers before the caller's body has been
    // read leaves those bytes sitting in a kept-alive socket, and the NEXT request on that connection is
    // parsed starting from the middle of the previous one: measured here as /eye/act coming back with no
    // body at all while /eye/snapshot on the same connection behaved, because the desync lands on
    // whichever request follows the unread one. Bounded, so a refusal cannot be turned into a way to make
    // the door read an unbounded body.
    const drain = (request) => new Promise(resolve => {
      let seen = 0
      let settled = false
      const done = () => { if (!settled) { settled = true; clearTimeout(timer); resolve() } }
      // TIME-BOXED: a caller that declares a body and then stops writing must not be able to wedge the
      // refusal it is being given. A second is far longer than any honest JSON body needs here.
      const timer = setTimeout(() => { request.destroy(); done() }, 1000)
      request.on('data', chunk => {
        seen += chunk.length
        // NOT AT THE PARSE LIMIT. Destroying the socket the moment a body passes `BODY_LIMIT_BYTES`
        // closes the connection underneath the refusal that is being written, which is the very failure
        // this drain exists to prevent — measured on `/eye/act`, where an unauthorised POST with an
        // oversized body came back with no body at all. The ceiling is where politeness ends.
        if (seen > DRAIN_CEILING_BYTES) { request.destroy(); done() }
      })
      request.on('end', done)
      request.on('error', done)
      request.resume()
    })
    const deny = async (status, code, detail) => { await drain(req); return refuse(res, status, code, detail) }
    // THE FENCES RUN BEFORE THE TOKEN IS EVEN COMPARED, and every refusal is logged as a code.
    // Nothing in this function logs a header value: a rejected request is the one most likely to
    // carry a token somebody guessed, and a log is the wrong place to keep it.
    if (req.method !== 'POST') return deny(405, EYE_REFUSE.METHOD)
    const path = (req.url ?? '').split('?')[0]
    if (path !== EYE_ROUTE && path !== EYE_SNAPSHOT_ROUTE && path !== EYE_ACT_ROUTE) {
      return deny(404, EYE_REFUSE.NOT_FOUND)
    }

    const port = address().port
    if (!namesThisListener(req.headers.host, port)) {
      say(`eye: refused ${EYE_REFUSE.FORBIDDEN_HOST}`)
      return deny(403, EYE_REFUSE.FORBIDDEN_HOST)
    }
    const origin = req.headers.origin
    if (origin !== undefined && !namesThisListener(origin, port)) {
      say(`eye: refused ${EYE_REFUSE.FORBIDDEN_ORIGIN}`)
      return deny(403, EYE_REFUSE.FORBIDDEN_ORIGIN)
    }
    if (!tokenMatches(presentedToken(req.headers), token)) {
      say(`eye: refused ${EYE_REFUSE.UNAUTHORIZED}`)
      return deny(401, EYE_REFUSE.UNAUTHORIZED)
    }
    // THE APPROVAL WINDOW IS OUT OF BOUNDS WHILE IT IS OPEN. It is the one window whose answer is a
    // secret about to become a signature, so the door closes for as long as it exists rather than
    // trusting a caller not to aim at it.
    if (isApprovalOpen()) {
      say(`eye: refused ${EYE_REFUSE.APPROVAL_OPEN}`)
      return deny(423, EYE_REFUSE.APPROVAL_OPEN)
    }

    // E1: THE BIND SURFACE IS OUT OF BOUNDS FOR EVERY ROUTE, and it is refused after the approval
    // window for the same reason: both surfaces show a secret, and the accessibility tree is the more
    // readable of the two forms.
    if (isDrawPending()) {
      say(`eye: refused ${EYE_REFUSE.BIND_SURFACE_OPEN}`)
      return deny(423, EYE_REFUSE.BIND_SURFACE_OPEN)
    }

    const window = deps.getWindow()
    if (window === null || window === undefined || window.isDestroyed?.() === true) {
      return deny(409, EYE_REFUSE.NO_WINDOW)
    }

    if (path === EYE_SNAPSHOT_ROUTE) return snapshot(res, window, req)
    if (path === EYE_ACT_ROUTE) return act(res, window, req)

    const read = await readJsonBody(req)
    if (!read.ok) return refuse(res, read.code === EYE_REFUSE.BODY_TOO_LARGE ? 413 : 400, read.code)
    const rect = parseRect(read.body.rect)
    if (rect === undefined) return refuse(res, 400, EYE_REFUSE.BAD_RECT)
    const scale = parseScale(read.body.scale)
    if (scale === undefined) return refuse(res, 400, EYE_REFUSE.BAD_RECT)

    try {
      const captured = await window.webContents.capturePage(rect ?? undefined)
      // THE FENCE IS READ AGAIN HERE, AND THAT IS THE POINT OF THIS LINE. The check at the top of the
      // handler is separated from these pixels by two awaits — the body read and the capture itself — so
      // a window that was closed when the request was judged can be open by the time the picture exists.
      // A fence read once, before the work, does not hold during the work; the pixels are dropped rather
      // than sent, and the refusal is the same one the early check gives.
      if (isApprovalOpen()) {
        say(`eye: refused ${EYE_REFUSE.APPROVAL_OPEN}`)
        return refuse(res, 423, EYE_REFUSE.APPROVAL_OPEN)
      }
      const fitted = fitToCeiling(captured, Math.max(1, Math.round(maxWidth * scale)))
      const png = fitted.image.toPNG()
      const source = captured.getSize()
      res.writeHead(200, {
        'content-type': 'image/png',
        'content-length': png.length,
        'x-eye-width': String(fitted.size.width),
        'x-eye-height': String(fitted.size.height),
        'x-eye-source-width': String(source.width),
        'x-eye-source-height': String(source.height),
      })
      res.end(png)
      return undefined
    } catch (error) {
      // A capture failure is the window's, not the caller's; the message is safe (it names a
      // window state, never a header) but the code is what a caller branches on.
      say(`eye: refused ${EYE_REFUSE.CAPTURE_FAILED}`)
      return refuse(res, 500, EYE_REFUSE.CAPTURE_FAILED, String(error?.message ?? error))
    }
  }

  const server = createServer((req, res) => {
    handler(req, res).catch(() => {
      if (!res.headersSent) refuse(res, 500, EYE_REFUSE.CAPTURE_FAILED)
      else res.end()
    })
  })
  // LOOPBACK, AND NOTHING ELSE. The backend child is on this machine; a listener on every
  // interface would be an unauthenticated photograph of the owner's window for anyone on the network.
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  /** The bound address; the port is known only after `listen` resolves. */
  function address() {
    const found = server.address()
    if (found === null || typeof found === 'string') throw new Error('eye: listener has no address')
    return found
  }

  const bound = address()
  const url = `http://127.0.0.1:${bound.port}`
  // The token's second home: readable by this user only, and only while this door is alive.
  const tokenFile = typeof deps.tokenFile === 'string' && deps.tokenFile !== '' ? deps.tokenFile : null
  if (tokenFile !== null) writeTokenFile(tokenFile)
  // THE PORT IS LOGGED; THE TOKEN IS NOT. A reader of the log learns where the door is and nothing
  // that opens it, which is the same posture the launch URL already takes (`redactTokens`).
  say(`eye: listening on ${url}${EYE_ROUTE}`)

  return {
    port: bound.port,
    url,
    token,
    env: { [EYE_ENV.URL]: url, [EYE_ENV.TOKEN]: token },
    tokenFile,
    dispose: () => new Promise(resolve => {
      server.close(() => {
        // The token leaves with the door. A stale token file would authenticate nothing (the token is
        // minted per launch) but it is still a secret on disk, and a dispose that ran twice must not throw.
        if (tokenFile !== null) {
          try {
            fs.unlinkSync(tokenFile)
          } catch (error) {
            if (error?.code !== 'ENOENT') say(`eye: token file not removed (${error?.code ?? error?.message ?? error})`)
          }
        }
        resolve()
      })
    }),
  }
}
