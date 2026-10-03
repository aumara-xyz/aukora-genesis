/**
 * RELAY TRANSPORT — publish gift wraps to public relays and read them back, with no server of ours.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE: **offline is a named state, never an empty result.**
 * A relay client that returns `[]` when it could not reach anybody is indistinguishable from one that
 * reached everybody and found nothing, and those two mean opposite things to a person waiting for a
 * message. So every read returns the per-relay outcome alongside the events, and a read that no relay
 * answered is a refusal (`nostr:no-relay-answered`) rather than `{ wraps: [] }`.
 *
 * The same applies to sends: `publishToRelays` reports which relays ACCEPTED, and a send nobody
 * accepted is `nostr:no-relay-accepted`. "We published it" is not a claim this module can make on the
 * strength of having opened a socket.
 *
 * NIP-17 inbox lists and NIP-42 authentication use the same bounded socket exchanges. Authentication
 * retries a refused operation once, within its original time budget; it never silently reconnects.
 *
 * TRANSPORT. Node 22 ships a global `WebSocket` client, so no dependency is added. The constructor is
 * injectable so a court can drive this code without a network; the shipped path uses the real one.
 *
 * @module @aukora/dsh-plugin-nostr/relay
 */
import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { isHex32, isValidEvent, publicKeyOf, randomSecretKey, signEvent } from './event.mjs'
import { evidencePath, retainGiftWrap, wireDigest, wirePath } from './evidence.mjs'
import { openGiftWrap } from './giftwrap.mjs'

// A relay page is re-fetched every few seconds; verify each exact event once. Keyed on the whole event,
// not id+sig alone, so altered content is never mistaken for a verified one. Bounded, oldest out first.
const verifiedEvents = new Map()
function verifiedOnce(event) {
  const key = createHash('sha256').update(JSON.stringify([event.id, event.pubkey, event.created_at, event.kind,
    event.tags, event.content, event.sig])).digest('hex')
  if (verifiedEvents.has(key)) return true
  if (!isValidEvent(event)) return false
  if (verifiedEvents.size >= 4096) verifiedEvents.delete(verifiedEvents.keys().next().value)
  verifiedEvents.set(key, true)
  return true
}

/** Every way a single relay exchange can end. A caller routes on these; none is prose to parse. */
export const RELAY_STATE = Object.freeze({
  OK: 'relay:ok',
  REFUSED: 'relay:refused',
  AUTH_REQUIRED: 'relay:auth-required',
  TIMEOUT: 'relay:timeout',
  UNREACHABLE: 'relay:unreachable',
  BAD_REPLY: 'relay:bad-reply',
  CLOSED: 'relay:closed',
})

/** Refusals about the exchange as a whole, as opposed to one relay. */
export const RELAY_REFUSE = Object.freeze({
  DEMO_PUBLISH_NOT_OPTED_IN: 'aukora-nostr:demo-publish-not-opted-in',
  NO_RELAYS: 'nostr:no-relays-configured',
  NO_TRANSPORT: 'nostr:websocket-unavailable',
  NOBODY_ANSWERED: 'nostr:no-relay-answered',
  NOBODY_ACCEPTED: 'nostr:no-relay-accepted',
  BAD_WRAP: 'nostr:relay-payload-invalid',
})

/**
 * The relays this node uses until a kind-10050 list says otherwise.
 *
 * Deliberately a small, well-known set. NIP-17 says clients should keep the list small (1–3) and
 * spread it. A recipient's own kind-10050 list, when discovered, is authoritative for delivery.
 */
/**
 * *** THE DEMO DOES NOT PUBLISH TO THE NETWORK UNLESS SOMEBODY ASKED IT TO. ***
 *
 * MEASURED, AND IT IS AN OPEN-SOURCE-READINESS FINDING RATHER THAN A BUG REPORT: this module carries three real
 * public relays in `DEFAULT_RELAYS`, and the demo is the first thing a stranger runs. **A demonstration that
 * publishes to `wss://relay.damus.io` the moment it is executed asks a stranger to put bytes on a public network
 * before they have read a line of the code that does it — and a reader cannot consent to an egress they did not
 * know was coming.**
 *
 * SO THE DEMO'S PUBLISH IS OPT-IN, OFF BY DEFAULT, AND REFUSED BY NAME WHEN THE FLAG IS ABSENT. The gate is
 * here, at the one function that opens a socket, rather than at each caller — **a rule enforced at every call
 * site is a rule with as many chances to be forgotten as there are call sites.**
 *
 * *** AND IT IS DELIBERATELY NOT A GLOBAL SWITCH: `source` DEFAULTS TO `'live'`, SO THE REAL CLIENT KEEPS
 * PUBLISHING AND ONLY A CALLER THAT SAYS IT IS THE DEMO MEETS THE GATE. A gate nobody can pass is not a
 * safeguard, it is an outage. ***
 */
export const DEMO_PUBLISH_ENV = 'AUKORA_DEMO_PUBLISH'

/**
 * Whether a caller that has declared itself the demo may publish.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function demoPublishAllowed(env = process.env) {
  // ONLY the exact string '1'. `AUKORA_DEMO_PUBLISH=0` and `=false` are NOT consent — a flag whose off position
  // is truthy is the fail-open pin this repository has a court for.
  return env[DEMO_PUBLISH_ENV] === '1'
}

/** The refusal a demo caller gets, or `null` when it may proceed. */
export function demoPublishRefusal(env = process.env) {
  if (demoPublishAllowed(env)) return null
  return `${DEMO_PUBLISH_ENV} is not set to 1: the demo publishes to the public relays in DEFAULT_RELAYS, and a `
    + `demonstration must not put bytes on a public network unless the person running it asked for that. `
    + `Set ${DEMO_PUBLISH_ENV}=1 to allow it.`
}

export const DEFAULT_RELAYS = Object.freeze([
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
])

/**
 * How far back a read looks when the caller does not say. NOT a tuning knob — a correctness
 * requirement, and getting it wrong makes every message invisible.
 *
 * NIP-17 requires the SEAL and GIFT WRAP timestamps to be randomised into the two days before now, so
 * a wrap's `created_at` is routinely well over an hour old the moment it is published. Measured on a
 * real round trip through relay.damus.io and nos.lol: the wrap was **2310 minutes (38 hours)** in the
 * past, and a read with `since = now - 60` returned zero events from relays that had accepted and
 * stored it. Nothing errored. The relays answered, `verdict` was `null`, and the message was simply
 * absent — the same silent-empty-result failure this module exists to prevent, in the time dimension.
 *
 * So the default lookback covers the jitter plus a margin for clock skew between this machine and the
 * relay. A caller may pass a narrower `since` for a live subscription, but must not use a narrow one
 * for "have I got any messages", which is the question a person actually asks.
 */
export const DEFAULT_LOOKBACK_SECONDS = 2 * 24 * 60 * 60 + 600

const refuse = (code, message) => Object.assign(new Error(message), { code })

/** The WebSocket constructor to use, or a named refusal when the platform has none. */
function resolveTransport(WebSocketImpl) {
  const Ctor = WebSocketImpl ?? globalThis.WebSocket
  if (typeof Ctor !== 'function') {
    throw refuse(RELAY_REFUSE.NO_TRANSPORT, 'this runtime has no WebSocket client; pass one as WebSocketImpl')
  }
  return Ctor
}

/** Normalise and check a relay list. An empty list is a refusal, not an empty result. */
function normalizeRelays(relays) {
  if (!Array.isArray(relays) || relays.length === 0) {
    throw refuse(RELAY_REFUSE.NO_RELAYS, 'no relays were configured, so nothing could be sent or read')
  }
  return [...new Set(relays.map(String))]
}

/**
 * Classify a relay's OK reply.
 * @param {boolean} ok - the relay's accepted flag.
 * @param {string} message - the relay's machine-readable message, if any.
 * @returns {string} one of {@link RELAY_STATE}.
 */
function stateForOk(ok, message) {
  if (ok === true) return RELAY_STATE.OK
  // NIP-01 reserves machine-readable prefixes here. `auth-required:` is the one that matters for
  // NIP-17, because a relay that requires AUTH has not refused us — it is one we have not yet
  // authenticated to, and telling those apart is the difference between "retry with AUTH" and
  // "this relay will never serve us gift wraps".
  if (/^(?:ERROR:\s*)?auth-required:/i.test(String(message ?? ''))) return RELAY_STATE.AUTH_REQUIRED
  return RELAY_STATE.REFUSED
}

/**
 * Open one socket, let `exchange` drive it, and settle within `timeoutMs`.
 *
 * Every path closes the socket exactly once, including the timeout and error paths — a leaked socket
 * keeps the Node process alive, which in a CLI reads to the user as a hang after the work is done.
 *
 * `exchange` receives `{send, onMessage, done, fail, timeoutAs}`. It MUST call `onMessage` before the first reply
 * can matter; replies arriving earlier are dropped, which is correct because a relay cannot answer a
 * request it has not received.
 *
 * @returns {Promise<{state: string, value?: any, message?: string}>} a settled outcome; never rejects.
 */
function withRelay(Ctor, url, timeoutMs, exchange) {
  return new Promise(resolve => {
    let socket
    let settled = false
    let handler = null
    let timer
    let timeoutOutcome = null
    const finish = outcome => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { socket?.close() } catch { /* already gone; the outcome is what matters */ }
      resolve(outcome)
    }
    try {
      socket = new Ctor(url)
    } catch (cause) {
      // A malformed URL throws synchronously; a refused connection surfaces as an error event.
      resolve({ state: RELAY_STATE.UNREACHABLE, message: cause.message })
      return
    }
    timer = setTimeout(() => finish(timeoutOutcome ?? { state: RELAY_STATE.TIMEOUT, message: `no answer within ${timeoutMs}ms` }), timeoutMs)
    socket.addEventListener('open', () => {
      if (settled) return
      try {
        exchange({
          send: payload => socket.send(JSON.stringify(payload)),
          onMessage: fn => { handler = fn },
          done: value => finish({ state: RELAY_STATE.OK, value }),
          fail: (state, message) => finish({ state, message }),
          timeoutAs: (state, message) => { timeoutOutcome = state ? { state, message } : null },
        })
      } catch (cause) {
        finish({ state: RELAY_STATE.BAD_REPLY, message: cause.message })
      }
    })
    socket.addEventListener('message', event => {
      if (settled) return
      let parsed
      try {
        parsed = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
      } catch {
        finish({ state: RELAY_STATE.BAD_REPLY, message: 'the relay sent something that is not JSON' })
        return
      }
      if (!Array.isArray(parsed)) {
        finish({ state: RELAY_STATE.BAD_REPLY, message: 'the relay sent JSON that is not a protocol array' })
        return
      }
      try {
        if (handler !== null) handler(parsed)
      } catch (cause) {
        finish({ state: RELAY_STATE.BAD_REPLY, message: cause.message })
      }
    })
    socket.addEventListener('error', () => {
      finish({ state: RELAY_STATE.UNREACHABLE, message: `could not reach ${url}` })
    })
    socket.addEventListener('close', () => {
      finish({ state: RELAY_STATE.CLOSED, message: 'the relay closed the connection before answering' })
    })
  })
}

/** Authenticate only when the operation requires it, then retry that operation once. */
function relayAuthentication({ send, fail, timeoutAs, retry, relay, secretKeyHex }) {
  let challenge = null
  let authId = null
  let waiting = false
  let retried = false
  const authenticate = () => {
    if (!waiting || challenge === null || authId !== null) return
    const event = signEvent({
      pubkey: publicKeyOf(secretKeyHex),
      created_at: Math.floor(Date.now() / 1000),
      kind: 22242,
      tags: [['relay', relay], ['challenge', challenge]],
      content: '',
    }, secretKeyHex)
    authId = event.id
    send(['AUTH', event])
  }
  return {
    onMessage(parsed) {
      if (parsed[0] === 'AUTH' && typeof parsed[1] === 'string') {
        challenge = parsed[1]
        authenticate()
        return true
      }
      if (authId !== null && parsed[0] === 'OK' && parsed[1] === authId) {
        if (parsed[2] !== true) {
          const reason = typeof parsed[3] === 'string' ? parsed[3] : ''
          fail(stateForOk(false, reason), reason || 'the relay refused authentication')
        } else if (!retried) {
          retried = true
          waiting = false
          timeoutAs(null)
          retry()
        }
        return true
      }
      return false
    },
    required(reason) {
      if (!secretKeyHex || retried || stateForOk(false, reason) !== RELAY_STATE.AUTH_REQUIRED) return false
      waiting = true
      // Some relays send CLOSED before their challenge. Keep waiting within the original budget,
      // but retain the refusal if the challenge or AUTH acknowledgement never arrives.
      timeoutAs(RELAY_STATE.AUTH_REQUIRED, String(reason))
      authenticate()
      return true
    },
  }
}

/**
 * Publish one gift wrap to every relay, and report what each one did.
 *
 * @param {object} wrap - the kind-1059 event to publish.
 * @param {object} [options] - `{relays, timeoutMs, WebSocketImpl, secretKeyHex}`.
 * @returns {Promise<{accepted: string[], outcomes: Array, verdict: string|null}>} the accounting.
 * @throws {Error} `nostr:relay-payload-invalid` if `wrap` is not a valid signed event.
 */
export async function publishToRelays(wrap, { relays = DEFAULT_RELAYS, timeoutMs = 8000, WebSocketImpl, source = 'live', secretKeyHex } = {}) {
  // *** THE GATE IS BEFORE THE TRANSPORT IS RESOLVED, SO A REFUSED DEMO OPENS NO SOCKET AT ALL. ***
  // Measured as the ordering that matters: a check placed after `resolveTransport` would still have
  // touched the platform's WebSocket to build the closure, and 'refused' would mean 'refused after
  // reaching for the network'.
  if (source === 'demo') {
    const why = demoPublishRefusal()
    if (why !== null) throw refuse(RELAY_REFUSE.DEMO_PUBLISH_NOT_OPTED_IN, why)
  }
  const Ctor = resolveTransport(WebSocketImpl)
  const targets = normalizeRelays(relays)
  if (wrap === null || typeof wrap !== 'object' || !isValidEvent(wrap)) {
    throw refuse(RELAY_REFUSE.BAD_WRAP, 'refusing to publish an event that does not verify')
  }
  const outcomes = await Promise.all(targets.map(async relay => {
    const outcome = await withRelay(Ctor, relay, timeoutMs, ({ send, onMessage, done, fail, timeoutAs }) => {
      const publish = () => send(['EVENT', wrap])
      // Authenticating a gift-wrap write with the sender's identity would reveal who sent it.
      // Use a fresh identity on each publishing socket, including when callers pass their own key.
      const authKey = wrap.kind === 1059 || wrap.kind === 21059 ? randomSecretKey() : secretKeyHex
      const auth = relayAuthentication({ send, fail, timeoutAs, retry: publish, relay, secretKeyHex: authKey })
      // NIP-01: the relay answers `["OK", <event-id>, <accepted>, <message>]`. A reply naming a
      // DIFFERENT id is not an answer to this publish, so it is ignored rather than counted as one.
      onMessage(parsed => {
        if (auth.onMessage(parsed)) return
        if (parsed[0] !== 'OK' || parsed[1] !== wrap.id) return
        if (parsed[2] !== true && auth.required(parsed[3])) return
        done({ ok: parsed[2] === true, message: typeof parsed[3] === 'string' ? parsed[3] : '' })
      })
      publish()
    })
    if (outcome.state !== RELAY_STATE.OK) {
      return { relay, state: outcome.state, message: outcome.message ?? '' }
    }
    return { relay, state: stateForOk(outcome.value.ok, outcome.value.message), message: outcome.value.message }
  }))
  const accepted = outcomes.filter(o => o.state === RELAY_STATE.OK).map(o => o.relay)
  return { accepted, outcomes, verdict: accepted.length > 0 ? null : RELAY_REFUSE.NOBODY_ACCEPTED }
}

const MAX_PENDING_WINDOWS = 1024
const activeScans = new Map()
const timestamp = value => Number.isSafeInteger(value) && value >= 0

function boundedCount(value, maximum, name) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} must be an integer from 1 to ${maximum}`)
  }
  return value
}

function readDeadline(timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 2147483647) throw new RangeError('invalid timeoutMs')
  return Date.now() + timeoutMs
}

/** Apply every requested constraint locally; NIP-01 hex filters are exact, never prefixes. */
function matchesFilter(event, filter) {
  if (!event || typeof event !== 'object' || !isHex32(event.id) || !isHex32(event.pubkey)
      || event.id !== event.id.toLowerCase() || event.pubkey !== event.pubkey.toLowerCase()
      || !Number.isSafeInteger(event.created_at) || !Array.isArray(event.tags)) return false
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false
  if (filter.ids && !filter.ids.includes(event.id)) return false
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false
  if (filter.since !== undefined && event.created_at < filter.since) return false
  if (filter.until !== undefined && event.created_at > filter.until) return false
  return Object.entries(filter).every(([key, values]) => !key.startsWith('#')
    || event.tags.some(tag => Array.isArray(tag) && tag[0] === key.slice(1) && values.includes(tag[1])))
}

function loadScan(path) {
  if (!path) return { version: 1, highWater: null, scan: null }
  let stored
  try {
    if (statSync(path).size > 256 * 1024) throw new Error('scan cursor is too large')
    stored = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, highWater: null, scan: null }
    throw error
  }
  const scan = stored?.scan
  if (stored?.version !== 1 || (stored.highWater !== null && !timestamp(stored.highWater))
      || (scan !== null && (!scan || !timestamp(scan.startedAt) || !timestamp(scan.since)
        || !timestamp(scan.until) || scan.until < scan.startedAt
        || (scan.nextRefresh !== undefined && typeof scan.nextRefresh !== 'boolean')
        || !Array.isArray(scan.pending) || !scan.pending.length || scan.pending.length > MAX_PENDING_WINDOWS
        || scan.pending.filter(window => window?.refresh).length > 64
        || scan.pending.some(window => !window || !timestamp(window.since) || !Number.isSafeInteger(window.until)
          || window.since < scan.since || window.until > scan.until || window.since > window.until
          || (window.refresh !== undefined && window.refresh !== true)
          || (window.limit !== undefined && (!Number.isSafeInteger(window.limit)
            || window.limit < 1 || window.limit > 10000 || window.since !== window.until)))))) {
    throw new Error('invalid scan cursor; refusing to discard unfinished history')
  }
  return stored
}

const HEX64 = /^[0-9a-f]{64}$/

/** The wraps one relay's scan added to the local store, newest first: `{digest, id, at}`. */
function loadKept(path) {
  if (!path) return []
  let stored
  try {
    if (statSync(path).size > 4 * 1024 * 1024) throw new Error('kept list is too large')
    stored = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  if (stored?.version !== 1 || !Array.isArray(stored.kept) || stored.kept.some(entry => !entry
      || !HEX64.test(entry.digest) || !HEX64.test(entry.id) || !timestamp(entry.at))) {
    throw new Error('invalid kept list; refusing to guess which ciphertext the scan added')
  }
  return stored.kept
}

/**
 * Keep only the newest `cap` wraps this relay's scan added; delete the older ones' ciphertext. A file
 * some other writer put there first (a send's own copy, a thread's evidence) was never listed, and a
 * listed file that an evidence record now names is dropped from the list but never deleted.
 */
function trimKept(stateDir, path, kept, cap) {
  kept.sort((a, b) => b.at - a.at || (a.digest < b.digest ? -1 : 1))
  const dropped = kept.splice(cap)
  saveScan(path, { version: 1, kept })
  for (const entry of dropped) {
    if (existsSync(evidencePath(stateDir, entry.id))) continue
    try { unlinkSync(wirePath(stateDir, entry.digest)) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  return kept
}

function saveScan(path, cursor) {
  if (!path) return
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(cursor)}\n`, { mode: 0o600, flag: 'wx' })
    renameSync(temporary, path)
  } finally {
    try { unlinkSync(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}

/**
 * Older part first; never subtract a timestamp from a full page's last event. The cut goes just
 * above the oldest second the page returned, so a newest-first relay finishes the newer part in
 * one page (a time midpoint from `since: 0` re-read the same newest page ten times, measured);
 * the two parts still cover the whole interval, so a relay in any order loses nothing.
 */
function splitWindow(window, oldest) {
  if (window.since < window.until) {
    const middle = Number.isSafeInteger(oldest) && oldest >= window.since && oldest < window.until
      ? oldest : window.since + Math.floor((window.until - window.since) / 2)
    return [{ ...window, until: middle }, { ...window, since: middle + 1 }]
  }
  return null
}

const windowKey = window => `${window.refresh ? 'r' : 'b'}:${window.since}:${window.until}`

/** Deduplicate deferred obligations; at capacity conservatively merge backlog, never drop it. */
function boundedPending(windows) {
  const unique = new Map()
  for (const window of windows) {
    const key = windowKey(window)
    const previous = unique.get(key)
    unique.set(key, previous?.limit > (window.limit ?? 0) ? previous : window)
  }
  const pending = [...unique.values()]
  while (pending.length > MAX_PENDING_WINDOWS) {
    const backlog = pending.map((window, index) => ({ window, index })).filter(({ window }) => !window.refresh)
    const leaves = backlog.filter(({ window }) => window.since === window.until)
    const [a, b] = leaves.length >= 2 ? leaves : backlog
    // One depth-first refresh wave has at most 53 time siblings. Preserve cold windows when
    // dense leaves can be merged instead; merging only adds re-reading, never loses coverage.
    if (!b) throw new Error('scan queue has no room for refresh')
    pending[a.index] = { since: Math.min(a.window.since, b.window.since), until: Math.max(a.window.until, b.window.until) }
    pending.splice(b.index, 1)
  }
  return pending
}

function refreshScan(scan, now) {
  if (now <= scan.until) return scan
  // Keep unfinished refresh coverage as backlog, but never freeze the newest queryable time.
  const backlog = scan.pending.map(({ refresh, ...window }) => window)
  return { ...scan, until: now, pending: boundedPending([...backlog, {
    since: Math.max(scan.since, scan.until - DEFAULT_LOOKBACK_SECONDS), until: now, refresh: true,
  }]) }
}

/**
 * Read bounded, verified pages. Optional stateDir retains ALL contacts' ciphertext before moving
 * the per-recipient/relay/kinds cursor. Without it there are no filesystem reads or writes.
 * A capped scan preserves history while one rolling jitter-window refresh shares its page budget.
 * highWater advances to scan.until only when every obligation completes, never to a sender time.
 * EOSE cannot prove a relay is honest or retains history.
 * Dense seconds retry at maxRepliesPerPage, then rotate without completing; no ID-prefix queries.
 * limit: 1..1000; maxPagesPerRelay: 1..256; maxRepliesPerPage: 1..10000;
 * maxRepliesPerRelay: 1..100000. Reply budgets include invalid/duplicate EVENT frames.
 * Without stateDir nothing persists between calls, so the default is one page per relay (the
 * newest `limit` wraps, as before); a caller that wants more in one call passes maxPagesPerRelay.
 * With stateDir the ciphertext a relay's scan adds is capped at its newest maxKeptWraps (1..10000),
 * and opening stops at the deadline: an unfinished page stays pending rather than overrunning it.
 */
export async function fetchGiftWraps({
  recipientPubkey,
  since,
  relays = DEFAULT_RELAYS,
  timeoutMs = 8000,
  WebSocketImpl,
  secretKeyHex,
  kinds = [1059],
  limit = 500,
  now = Math.floor(Date.now() / 1000),
  stateDir,
  maxPagesPerRelay = stateDir === undefined ? 1 : 32,
  maxRepliesPerPage = 2000,
  maxRepliesPerRelay = 10000,
  maxKeptWraps = 1000,
} = {}) {
  if (!isHex32(recipientPubkey)) {
    throw refuse(RELAY_REFUSE.BAD_WRAP, 'a recipient pubkey must be 32 bytes of hex')
  }
  const deadline = readDeadline(timeoutMs)
  boundedCount(limit, 1000, 'limit')
  boundedCount(maxKeptWraps, 10000, 'maxKeptWraps')
  boundedCount(maxPagesPerRelay, 256, 'maxPagesPerRelay')
  boundedCount(maxRepliesPerPage, 10000, 'maxRepliesPerPage')
  boundedCount(maxRepliesPerRelay, 100000, 'maxRepliesPerRelay')
  if (!timestamp(now) || (since !== undefined && !timestamp(since))) throw new RangeError('invalid scan timestamp')
  if (!Array.isArray(kinds) || !kinds.length || kinds.some(kind => kind !== 1059 && kind !== 21059)) {
    throw new RangeError('gift-wrap kinds must be 1059 or 21059')
  }
  if (stateDir !== undefined && (typeof stateDir !== 'string' || !stateDir.length)) throw new TypeError('invalid stateDir')
  kinds = [...new Set(kinds)].sort((a, b) => a - b)
  const recipient = recipientPubkey.toLowerCase()
  if (stateDir !== undefined && (!isHex32(secretKeyHex) || publicKeyOf(secretKeyHex) !== recipient)) {
    throw refuse(RELAY_REFUSE.BAD_WRAP, 'persisting an inbox requires its recipient key')
  }
  const Ctor = resolveTransport(WebSocketImpl)
  const outcomes = await Promise.all(normalizeRelays(relays).map(async relay => {
    // Coverage for a narrow request must not suppress a later request for older history.
    const key = createHash('sha256').update(JSON.stringify([relay, kinds, since ?? null])).digest('hex')
    const path = stateDir === undefined ? null : join(resolve(stateDir), 'nostr', 'scans', recipient, `${key}.json`)
    const outcome = { relay, state: RELAY_STATE.TIMEOUT, message: '', events: [], answered: false,
      complete: false, pages: 0, replies: 0, pending: 0, highWater: null, stopReason: 'deadline' }
    if (path && activeScans.has(path)) {
      let timer
      try {
        return await Promise.race([activeScans.get(path), new Promise(done => {
          timer = setTimeout(() => done(outcome), Math.max(0, deadline - Date.now()))
        })])
      } finally { clearTimeout(timer) }
    }
    let finishScan
    if (path) activeScans.set(path, new Promise(done => { finishScan = done }))
    try {
      let cursor = loadScan(path)
      const keptPath = path && join(dirname(path), `${key}.kept.json`)
      let kept = loadKept(keptPath)
      const listed = new Set(kept.map(entry => entry.digest))
      outcome.highWater = cursor.highWater
      if (!cursor.scan) {
        const floor = Math.max(0, since ?? 0, cursor.highWater === null
          ? (since ?? now - DEFAULT_LOOKBACK_SECONDS) : cursor.highWater - DEFAULT_LOOKBACK_SECONDS)
        cursor.scan = { startedAt: now, since: floor, until: now,
          pending: floor <= now ? [{ since: floor, until: now }] : [] }
        if (!cursor.scan.pending.length) {
          cursor = { version: 1, highWater: now, scan: null }
          saveScan(path, cursor)
          return Object.assign(outcome, { complete: true, highWater: now, stopReason: null })
        }
        saveScan(path, cursor)
      }
      const refreshed = refreshScan(cursor.scan, now)
      if (refreshed !== cursor.scan) {
        cursor = { ...cursor, scan: refreshed }
        saveScan(path, cursor)
      }
      outcome.pending = cursor.scan.pending.length
      const byId = new Map()
      const deferred = new Set()
      while (cursor.scan) {
        if (Date.now() >= deadline) { outcome.stopReason = 'deadline'; break }
        if (outcome.pages >= maxPagesPerRelay) { outcome.stopReason = 'page-cap'; break }
        if (outcome.replies >= maxRepliesPerRelay) { outcome.stopReason = 'reply-cap'; break }
        const available = window => !deferred.has(windowKey(window)) && window.until <= now
        // Persist alternation so even a one-page call advances both cold history and refresh.
        let index = cursor.scan.pending.findIndex(window => available(window)
          && !!window.refresh === (cursor.scan.nextRefresh ?? true))
        if (index < 0) index = cursor.scan.pending.findIndex(available)
        if (index < 0) {
          if (cursor.scan.pending.some(window => window.until > now)) outcome.stopReason = 'clock-rollback'
          break
        }
        const window = cursor.scan.pending[index]
        const page = await readRelayPage({ Ctor, relay, deadline, secretKeyHex,
          maxReplies: Math.min(maxRepliesPerPage, maxRepliesPerRelay - outcome.replies),
          filter: { kinds, '#p': [recipient], since: window.since, until: window.until,
            limit: Math.min(window.limit ?? limit, maxRepliesPerPage) } })
        outcome.pages++
        outcome.replies += page.replies
        outcome.state = page.state
        outcome.message = page.message
        outcome.answered ||= page.state === RELAY_STATE.OK || page.events.length > 0
        let added = false
        for (const event of page.events) {
          if (byId.has(event.id)) continue
          if (stateDir !== undefined) {
            // Opening costs milliseconds each; past the deadline the page is re-queued below whole.
            if (Date.now() >= deadline) break
            const digest = wireDigest(event)
            if (!existsSync(wirePath(stateDir, digest))) {
              // A relay's valid signature is not enough to grow the local message archive.
              try { openGiftWrap(event, { recipientSecretKey: secretKeyHex }) } catch { continue }
              retainGiftWrap(stateDir, event)
              if (!listed.has(digest)) {
                kept.push({ digest, id: event.id, at: event.created_at })
                listed.add(digest)
                added = true
              }
            }
          }
          byId.set(event.id, event)
          outcome.events.push(event)
        }
        if (added) {
          kept = trimKept(stateDir, keptPath, kept, maxKeptWraps)
          listed.clear()
          for (const entry of kept) listed.add(entry.digest)
        }
        const expired = Date.now() >= deadline
        let pending = cursor.scan.pending.filter((_, position) => position !== index)
        // Even a timed-out flood must make durable progress instead of replaying the same broad
        // newest page forever. Splitting retains the entire interval; it claims no completion.
        if (page.saturated || (expired && page.replies > 0 && window.since < window.until)) {
          const children = splitWindow(window, page.events.reduce((low, event) => Math.min(low, event.created_at), Infinity))
          if (children) pending.unshift(...children)
          else if (!children && (window.limit ?? limit) < maxRepliesPerPage) {
            pending.unshift({ ...window, limit: maxRepliesPerPage })
          } else {
            // Retire this leaf from the refresh wave, but retain its unresolved obligation.
            const { refresh, ...backlog } = window
            pending.push(backlog)
            deferred.add(windowKey(backlog))
            outcome.stopReason = 'overflow'
          }
        } else if (!page.complete || expired) {
          const { refresh, ...backlog } = window
          pending.push(backlog)
          deferred.add(windowKey(backlog))
          outcome.stopReason = expired ? 'deadline' : 'relay-error'
        }
        const scan = refreshScan({ ...cursor.scan, pending: boundedPending(pending), nextRefresh: !window.refresh }, now)
        const next = scan.pending.length ? { ...cursor, scan }
          : { version: 1, highWater: scan.until, scan: null }
        saveScan(path, next) // Every returned event is retained (up to the cap) before this checkpoint.
        cursor = next
        outcome.pending = scan.pending.length
        outcome.highWater = cursor.highWater
      }
      outcome.complete = cursor.scan === null
      if (outcome.complete) outcome.stopReason = null
    } catch (error) {
      outcome.state = RELAY_STATE.BAD_REPLY
      outcome.message = `scan storage: ${error.message}`
      outcome.stopReason = 'storage-error'
    } finally {
      if (path) activeScans.delete(path)
      finishScan?.(outcome)
    }
    return outcome
  }))
  const { events, ...result } = collectedResults(outcomes)
  return { wraps: events, ...result }
}

/** One page: bound raw replies as well as retained events; preserve verified partial answers. */
async function readRelayPage({ Ctor, relay, filter, deadline, secretKeyHex, maxReplies }) {
  const collected = new Map()
  let replies = 0
  let eose = false
  let saturated = false
  let rejected = false
  const remaining = deadline - Date.now()
  const outcome = remaining <= 0 ? { state: RELAY_STATE.TIMEOUT } : await withRelay(Ctor, relay, remaining,
    ({ send, onMessage, done, fail, timeoutAs }) => {
      const subscription = `aukora-${Math.random().toString(36).slice(2, 10)}`
      const request = () => send(['REQ', subscription, filter])
      const auth = relayAuthentication({ send, fail, timeoutAs, retry: request, relay, secretKeyHex })
      onMessage(parsed => {
        if (Date.now() >= deadline) { fail(RELAY_STATE.TIMEOUT, 'read deadline reached'); return }
        if (auth.onMessage(parsed)) return
        if (parsed[0] === 'EVENT' && parsed[1] === subscription) {
          replies++
          const event = parsed[2]
          // Invalid copies never occupy an ID, even within one relay's reply page.
          if (parsed.length === 3 && matchesFilter(event, filter) && verifiedOnce(event)) {
            if (!collected.has(event.id)) collected.set(event.id, event)
          } else rejected = true
          // Crypto is synchronous: a late verification cannot turn an expired page into success.
          if (Date.now() >= deadline) {
            fail(RELAY_STATE.TIMEOUT, 'read deadline reached during verification')
            return
          }
          if (collected.size >= filter.limit || replies >= maxReplies) {
            saturated = true
            send(['CLOSE', subscription])
            done()
          }
          return
        }
        if (parsed[0] === 'CLOSED' && parsed[1] === subscription) {
          const reason = typeof parsed[2] === 'string' ? parsed[2] : ''
          if (auth.required(reason)) return
          fail(stateForOk(false, reason), reason || 'the relay refused the subscription')
          return
        }
        if (parsed[0] === 'EOSE' && parsed[1] === subscription) {
          if (parsed.length > 3 || (parsed.length === 3
              && (!Array.isArray(parsed[2]) || parsed[2].some(value => typeof value !== 'string')))) {
            fail(RELAY_STATE.BAD_REPLY, 'malformed EOSE')
            return
          }
          // NIP-67 permits an auth hint when an unauthenticated query has hidden results.
          if (Array.isArray(parsed[2]) && parsed[2].includes('auth')) {
            const reason = 'auth-required: more results require authentication'
            if (!auth.required(reason)) fail(RELAY_STATE.AUTH_REQUIRED, reason)
            return
          }
          eose = true
          saturated = replies >= filter.limit
          send(['CLOSE', subscription])
          done()
        }
      })
      request()
    })
  // Discard a bad frame without poisoning an otherwise finished page. Raw reply caps still
  // treat junk as saturation, so an invalid-event flood cannot falsely advance the cursor.
  return { relay, state: outcome.state,
    message: outcome.message ?? (rejected ? 'invalid or out-of-filter events' : ''), events: [...collected.values()],
    replies, saturated, complete: eose && !saturated && Date.now() < deadline && outcome.state === RELAY_STATE.OK }
}

function collectedResults(outcomes) {
  const answered = outcomes.filter(o => o.answered ?? (o.state === RELAY_STATE.OK || o.events.length > 0)).map(o => o.relay)
  const byId = new Map()
  for (const outcome of outcomes) {
    for (const event of outcome.events) {
      if (!byId.has(event.id)) byId.set(event.id, event) // Only locally verified events enter a page.
    }
  }
  return {
    events: [...byId.values()],
    answered,
    outcomes: outcomes.map(({ events, answered: ignored, ...outcome }) => outcome),
    complete: outcomes.every(outcome => outcome.complete),
    verdict: answered.length > 0 ? null : RELAY_REFUSE.NOBODY_ANSWERED,
  }
}

/** Inbox discovery shares first-valid dedup and a hard per-relay collection/reply bound. */
async function fetchEvents({ filter, relays, timeoutMs, WebSocketImpl, secretKeyHex }) {
  const deadline = readDeadline(timeoutMs)
  const Ctor = resolveTransport(WebSocketImpl)
  filter = { ...filter, limit: boundedCount(filter.limit ?? 500, 1000, 'limit') }
  return collectedResults(await Promise.all(normalizeRelays(relays).map(relay => readRelayPage({
    Ctor, relay, filter, deadline, secretKeyHex, maxReplies: 2000,
  }))))
}

/** Parse relay tags without permitting non-WebSocket URLs or credentials in published inboxes. */
function inboxRelays(values) {
  return [...new Set(values.filter(value => {
    if (typeof value !== 'string') return false
    try {
      const url = new URL(value)
      return (url.protocol === 'wss:' || url.protocol === 'ws:') && !url.username && !url.password && !url.hash
    } catch { return false }
  }))]
}

const nonPublicIpv4 = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 3],
]) nonPublicIpv4.addSubnet(address, prefix, 'ipv4')
const globalIpv6 = new BlockList()
globalIpv6.addSubnet('2000::', 3, 'ipv6')
const nonPublicIpv6 = new BlockList()
for (const [address, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
]) nonPublicIpv6.addSubnet(address, prefix, 'ipv6')

function isPublicAddress(address) {
  if (isIP(address) === 4) return !nonPublicIpv4.check(address, 'ipv4')
  // Restrict IPv6 to native global unicast, excluding documentation and transition addresses.
  return isIP(address) === 6 && globalIpv6.check(address, 'ipv6') && !nonPublicIpv6.check(address, 'ipv6')
}

/** Untrusted advertised inboxes may name only three public TLS endpoints. Explicit config is separate. */
async function publicInboxRelays(values, timeoutMs) {
  const candidates = inboxRelays(values).filter(value => {
    const url = new URL(value)
    const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
    if (url.protocol !== 'wss:') return false
    if (isIP(host)) return isPublicAddress(host)
    return host.includes('.') && !/(?:^|\.)(?:localhost|local|localdomain|internal|home|lan|test|invalid|onion)$/i.test(host)
  }).slice(0, 3)
  const checks = await Promise.all(candidates.map(async value => {
    const host = new URL(value).hostname.replace(/^\[|\]$/g, '')
    if (isIP(host)) return value
    let timer
    try {
      const addresses = await Promise.race([
        lookup(host, { all: true, verbatim: true }).catch(() => []),
        new Promise(resolve => { timer = setTimeout(() => resolve([]), Math.min(500, Math.max(1, timeoutMs))) }),
      ])
      return addresses.length > 0 && addresses.every(({ address }) => isPublicAddress(address)) ? value : null
    } finally { clearTimeout(timer) }
  }))
  // The platform WebSocket resolves again when connecting; this is address validation, not DNS pinning.
  return checks.filter(Boolean)
}

/** Advertise where this identity receives NIP-17 messages, as a signed replaceable kind-10050 event. */
export async function publishDmRelays({
  secretKeyHex,
  relays = DEFAULT_RELAYS,
  publishRelays = relays,
  timeoutMs = 8000,
  WebSocketImpl,
  source = 'live',
  now = Math.floor(Date.now() / 1000),
} = {}) {
  const targets = normalizeRelays(relays)
  const inboxes = inboxRelays(targets)
  if (inboxes.length !== targets.length) throw refuse(RELAY_REFUSE.BAD_WRAP, 'DM relays must be WebSocket URLs without credentials')
  const event = signEvent({
    pubkey: publicKeyOf(secretKeyHex),
    created_at: now,
    kind: 10050,
    tags: inboxes.map(relay => ['relay', relay]),
    content: '',
  }, secretKeyHex)
  const published = await publishToRelays(event, { relays: publishRelays, timeoutMs, WebSocketImpl, secretKeyHex, source })
  return { event, ...published }
}

/** Read the latest verified kind-10050 list; no list means no advertised NIP-17 inbox. */
export async function fetchDmRelays({
  pubkey,
  relays = DEFAULT_RELAYS,
  timeoutMs = 8000,
  WebSocketImpl,
  secretKeyHex,
} = {}) {
  if (!isHex32(pubkey)) throw refuse(RELAY_REFUSE.BAD_WRAP, 'an inbox owner pubkey must be 32 bytes of hex')
  const owner = pubkey.toLowerCase()
  const { events, ...result } = await fetchEvents({
    filter: { kinds: [10050], authors: [owner], limit: 1 }, relays, timeoutMs, WebSocketImpl, secretKeyHex,
  })
  // NIP-01 selects the lower id when replaceable events have an equal timestamp.
  const event = events.filter(item => item.kind === 10050 && item.pubkey === owner)
    .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0] ?? null
  const inboxes = event ? await publicInboxRelays(event.tags.filter(tag => tag[0] === 'relay').map(tag => tag[1]), timeoutMs) : []
  return { relays: inboxes, event, ...result }
}

/** @returns {string} a one-line human summary naming which relays answered, and how. */
export function relaySummary(outcomes, { verb = 'answered' } = {}) {
  if (!Array.isArray(outcomes) || outcomes.length === 0) return 'no relays were asked'
  const answered = outcomes.filter(o => o.state === RELAY_STATE.OK)
  const parts = outcomes.map(o => {
    const label = String(o.state).replace(/^relay:/, '')
    // NIP-01 messages are machine-readable and often restate the state ("auth-required: ...").
    // Repeating it would render as "auth-required: auth-required: please AUTH" in the one line a
    // person actually reads.
    const detail = String(o.message ?? '').replace(new RegExp(`^${label}:\\s*`, 'i'), '')
    return `${o.relay} (${label}${detail ? `: ${detail}` : ''})`
  })
  return `${outcomes.length} asked, ${answered.length} ${verb}: ${parts.join(', ')}`
}
