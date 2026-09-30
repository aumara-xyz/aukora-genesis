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
import { isHex32, isValidEvent, publicKeyOf, randomSecretKey, signEvent } from './event.mjs'

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

/**
 * Read gift wraps addressed to us from every relay.
 *
 * @param {object} spec - `{recipientPubkey, since, relays, timeoutMs, WebSocketImpl, secretKeyHex, kinds, now}`.
 *   `since` defaults to the full jitter window, NOT to "recently" — see DEFAULT_LOOKBACK_SECONDS.
 * @returns {Promise<{wraps: object[], answered: string[], outcomes: Array, verdict: string|null}>}
 *   `wraps` is de-duplicated by event id, because the same wrap legitimately arrives from several
 *   relays; `verdict` is `nostr:no-relay-answered` when nobody answered, which is NOT the same as
 *   an empty `wraps` from a relay that answered.
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
} = {}) {
  if (!isHex32(recipientPubkey)) {
    throw refuse(RELAY_REFUSE.BAD_WRAP, 'a recipient pubkey must be 32 bytes of hex')
  }
  // NIP-01 filters: the relay does the selection, and `#p` is what keeps a relay from serving us
  // wraps addressed to other people. A relay that ignores it is not one to trust with metadata.
  const filter = { kinds, '#p': [recipientPubkey.toLowerCase()], since: since ?? now - DEFAULT_LOOKBACK_SECONDS, limit }
  const { events, ...result } = await fetchEvents({ filter, relays, timeoutMs, WebSocketImpl, secretKeyHex })
  return { wraps: events, ...result }
}

/** A single bounded NIP-01 query per relay, shared by inbox discovery and gift-wrap retrieval. */
async function fetchEvents({ filter, relays, timeoutMs, WebSocketImpl, secretKeyHex }) {
  const Ctor = resolveTransport(WebSocketImpl)
  const targets = normalizeRelays(relays)
  const outcomes = await Promise.all(targets.map(async relay => {
    const outcome = await withRelay(Ctor, relay, timeoutMs, ({ send, onMessage, done, fail, timeoutAs }) => {
      const subscription = `aukora-${Math.random().toString(36).slice(2, 10)}`
      const collected = []
      const request = () => send(['REQ', subscription, filter])
      const auth = relayAuthentication({ send, fail, timeoutAs, retry: request, relay, secretKeyHex })
      onMessage(parsed => {
        if (auth.onMessage(parsed)) return
        if (parsed[0] === 'EVENT' && parsed[1] === subscription && parsed[2] !== null && typeof parsed[2] === 'object') {
          collected.push(parsed[2])
          return
        }
        // NIP-01: a relay may refuse a subscription outright with CLOSED and a machine-readable
        // reason. Without this branch that refusal is indistinguishable from a relay that simply had
        // nothing — the same silent-empty-result failure this module exists to prevent, and
        // `auth-required` is the one a NIP-17 client meets most, because relays are told to gate
        // kind 1059 behind NIP-42 AUTH.
        if (parsed[0] === 'CLOSED' && parsed[1] === subscription) {
          const reason = typeof parsed[2] === 'string' ? parsed[2] : ''
          if (auth.required(reason)) return
          fail(stateForOk(false, reason), reason || 'the relay refused the subscription')
          return
        }
        // EOSE ("end of stored events") is the only signal that the relay has finished answering.
        // Waiting for it rather than for a timer is what makes "nobody answered" mean nobody.
        if (parsed[0] === 'EOSE' && parsed[1] === subscription) {
          // NIP-67 permits an auth hint when an unauthenticated query has hidden results.
          if (Array.isArray(parsed[2]) && parsed[2].includes('auth')) {
            const reason = 'auth-required: more results require authentication'
            if (!auth.required(reason)) fail(RELAY_STATE.AUTH_REQUIRED, reason)
            return
          }
          // NIP-01: close the subscription we opened, so the relay can release it.
          send(['CLOSE', subscription])
          done({ events: collected })
        }
      })
      request()
    })
    if (outcome.state !== RELAY_STATE.OK) return { relay, state: outcome.state, message: outcome.message ?? '', events: [] }
    return { relay, state: RELAY_STATE.OK, message: '', events: outcome.value.events }
  }))

  const answered = outcomes.filter(o => o.state === RELAY_STATE.OK).map(o => o.relay)
  // De-duplicate by id. Two relays serving the same wrap is the normal case, not an error.
  const byId = new Map()
  for (const outcome of outcomes) {
    for (const event of outcome.events) {
      if (event !== null && typeof event === 'object' && typeof event.id === 'string') byId.set(event.id, event)
    }
  }
  return {
    events: [...byId.values()],
    answered,
    outcomes: outcomes.map(({ relay, state, message }) => ({ relay, state, message })),
    verdict: answered.length > 0 ? null : RELAY_REFUSE.NOBODY_ANSWERED,
  }
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
  const event = events.filter(item => item.kind === 10050 && item.pubkey === owner && isValidEvent(item))
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
