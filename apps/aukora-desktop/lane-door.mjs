/**
 * THE LANE DOOR — a narrow, token-fenced channel that lets a lane send ONE message to ONE session.
 *
 * WHY IT EXISTS. The running app is authenticated by a launch token, and that token is HUMAN AUTHORITY:
 * whoever holds it can drive the interface a person is looking at. A lane that held it would be a lane
 * that can do anything the person can. This door is the alternative — a second listener, on its own
 * ephemeral loopback port, with its own token, that can do exactly one thing: put a line into an existing
 * session. It is not a second shell and it is not a second API; it is one verb behind its own fences.
 *
 * FIVE THINGS IT IS CAREFUL ABOUT, EACH BECAUSE THE OBVIOUS VERSION IS WRONG:
 *
 *   1. THE TOKEN IS NOT IN THE BACKEND CHILD'S ENVIRONMENT. The eye's token is, and that is why the eye
 *      refuses to photograph a drawn phrase: the child can reach it. This door's token is written to a
 *      file only, never exported into any environment, so a lane that can read the child's env does not
 *      thereby hold this channel.
 *   2. EVERY REFUSAL DRAINS FIRST. Answering before the caller's body has been read closes the socket
 *      under the reply and desyncs the next request on the same connection (measured on the eye: an
 *      oversized `/eye/act` came back as a closed socket with no code at all). `deny()` reads the body to
 *      its end, and the 413 is a named refusal like every other.
 *   3. NO BROWSER MAY REACH IT. The Host must name this listener, ANY `Origin` is refused, and any
 *      `sec-fetch-site` header is refused, because a browser attaches those and a lane CLI does not.
 *   4. A SLASH LINE IS A COMMAND OR IT IS NOTHING. `/goal` and `/compact` are forwarded to the command
 *      endpoint; every other `/…` line is refused BY NAME rather than being forwarded as text, because
 *      "the model reads it as a message" is not the same thing as "the command did not run".
 *   5. THE LEDGER HOLDS NO TEXT. Time, lane, session, kind, byte count and a digest prefix, so a person
 *      can see what this channel carried without the channel keeping a copy of what was said.
 *
 * IT IS INSTALLED ONLY IN OWNED MODE, after the harness is up (it needs the authenticated launch URL to
 * mint its cookie) and disposed on `will-quit`. In attach mode there is no door at all: this shell did not
 * start that app, so it has no business opening a second way into it.
 */
import { createServer } from 'node:http'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
// THE DISPATCH RULES LIVE IN THEIR OWN FILE. `LANE_REFUSE`, `LANE_COMMANDS`, `routeOf`, the approval
// fence and the ledger line SHAPE are imported and RE-EXPORTED below, so every existing caller and every
// existing court keeps the same address while the rules gain one of their own.
import {
  LANE_REFUSE, LANE_COMMANDS, routeOf, digestOf, approvalFence, ledgerEntry,
  CARD_ROUTE, createCardRegister, authoriseSend, cardDigestPrefix, establishOwnerOnlyDir,
  duplicateKeysIn,
} from './lane-dispatch.mjs'
// **THE IDS THE HARNESS GAVE THE MESSAGES THIS DOOR CAUSED** — *shared with the Kira hooks through one module, so the
// path cannot be spelled twice.*
import { recordLaneDoorMessage } from '../../plugins/aukora-kira/lib/lane-door-messages.mjs'
export { LANE_REFUSE, LANE_COMMANDS, routeOf, CARD_ROUTE }
import { appendFileSync, chmodSync, closeSync, constants, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
// THE CHAIN RULE IS SHARED: the door does not restate it, and the export verifies with the same module.
import { GENESIS, LEDGER_MODE, appendCard, readChain, verifyChain } from './card-chain.mjs'
// THE DURABLE WRITE IS KIRA'S, AND IT IS IMPORTED RATHER THAN REIMPLEMENTED: **a second implementation of
// "write this so it survives a crash" is a second thing to get wrong**, and the sidecar needs the same
// fsync-and-rename discipline the ledger itself has.
import { durableWrite } from '../../plugins/aukora-kira/lib/strict-read.mjs'

/** The one route this door serves. */
export const LANE_ROUTE = '/lane/send'

/**
 * The lane whose own door this is. **A lane-scoped credential is Fable's**; every other caller is treated
 * as unsupervised until a class is established for it by name, because `fable` is the class that SKIPS the
 * card and a default must never be the privileged one.
 */
export const FABLE_LANE = 'fable'

/** Named refusals. A caller reads the code; none of them carries the token, the cookie or the text. */
// LANE_REFUSE now lives in lane-dispatch.mjs and is re-exported above.

/** A lane's whole message, as JSON, fits here with room to spare; anything larger is not a message. */
export const LANE_LIMIT_BYTES = 64 * 1024

/**
 * How much this door will read and throw away so a named refusal can be DELIVERED. Far above the parse
 * limit on purpose: stopping at the parse limit closes the socket under the reply.
 */
const DRAIN_CEILING_BYTES = 1024 * 1024

/** The two commands a lane may run. Anything else behind a slash is refused, never forwarded as text. */
// LANE_COMMANDS now lives in lane-dispatch.mjs and is re-exported above.

/** A session id as this deployment mints it: `session-` and a UUID. */
const SESSION_PATTERN = /^session-[0-9a-f-]{36}$/u

/** A lane name: one lowercase word. Deliberately not a path, not a title, not free text. */
const LANE_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u

/**
 * Where this door's token lives. Beside the eye's, under the same state root, and never handed to the
 * backend child: the whole point of the second file is that the child's environment does not carry it.
 * @param stateRoot - the shell's own state root.
 * @returns the absolute path.
 */
export function laneTokenPath(stateRoot) {
  return join(stateRoot, 'lane-door', 'door.token')
}

/**
 * Where the door publishes the port it bound.
 *
 * THE PORT CANNOT BE GUESSED — it is ephemeral by design — so it has to be published somewhere, and the
 * owner-only directory that already holds the token is the one place where "know the address" and "be
 * allowed to use it" are the same permission. It is never put in an environment.
 * @param stateRoot - the shell's own state root.
 * @returns the absolute path.
 */
export function lanePortPath(stateRoot) {
  return join(stateRoot, 'lane-door', 'port')
}

/**
 * Where the door records what it carried.
 * @param stateRoot - the shell's own state root.
 * @returns the absolute path of the JSONL ledger.
 */
/**
 * THE CHAINED CARD LEDGER'S PATH, beside the door's other state.
 *
 * A SEPARATE FILE FROM THE SIMPLE LEDGER, and deliberately: `laneLedgerPath` records what the door SAW
 * (one line per request, unfenced and not durable), while this one is the tamper-evident record of what
 * THE OWNER DECIDED. **Two files, two meanings** — merging them would make an audit line look like an
 * approval.
 */
/**
 * The sender class a CREDENTIAL establishes, or `null` when it establishes none.
 *
 * ── WHY THIS IS A FUNCTION AND NOT A DEFAULT ────────────────────────────────────────────────────
 *
 * The door's token is written owner-only and never leaves this machine, so **holding it IS the authority**
 * — the same doctrine the launch token already carries. **It is never read from the request, because the
 * request is the thing being authorised.**
 *
 * ── ONE TOKEN, SO ONE CLASS (2026-09-27) ─────────────────────────────────────────────────────────
 *
 * This took `lane` and returned `fable` only when it was `fable` — but `lane` was the body's `origin`, so the
 * REQUEST chose its own class: `{"origin": "fable"}` skipped the card. The door mints ONE token per launch
 * (`door.token`) and has no per-origin tokens, so no credential here can tell one lane from another. **The
 * class is therefore fixed to `fable`, the class of the one caller the token is issued to.** LIMIT, NOT
 * ENFORCED: every holder of the door token is `fable` and no card is required of it; `origin` is a label for
 * the ledger and the message prefix, not an authority. A card for another lane needs a per-origin token first.
 *
 * `null` IS THE HONEST ANSWER FOR A CREDENTIAL THAT ESTABLISHES NOTHING, and the caller refuses on it.
 */
export function credentialSender(token, session) {
  if (typeof token !== 'string' || token.length === 0) return null
  if (typeof session !== 'string') return null
  return FABLE_LANE
}

/**
 * THE TRUSTED COUNT'S OWN PATH, beside the ledger and deliberately NOT inside it.
 *
 * ── WHY THE COUNT CANNOT LIVE IN THE LEDGER ─────────────────────────────────────────────────────
 *
 * `card-chain.mjs` established that **a prefix of a valid chain is a valid chain** — that is what a hash
 * chain is FOR — so a ledger that has lost its tail verifies perfectly and **can never notice that it is
 * short.** The count therefore has to come from OUTSIDE the thing being counted: **if it lived inside the
 * file, the truncation would take it along, and the disagreement between two files is the whole detection.**
 */
export function laneCardHeadPath(stateRoot) {
  return join(stateRoot, 'lane', 'lane-cards.head.json')
}

export function laneCardLedgerPath(stateRoot) {
  return join(stateRoot, 'lane', 'lane-cards.jsonl')
}

/**
 * Turn a card DECISION into one chained ledger entry.
 *
 * ── WHY THIS EXISTS AS ITS OWN EXPORT ───────────────────────────────────────────────────────────
 *
 * The chain was built, exportable and verifiable, and **nothing appended to it** — found by grepping for
 * `appendCard` across the door and getting nothing. **A record of the owner's approval that nothing ever
 * writes is not a record of anything.** This is the one place a decision becomes an entry, so both
 * outcomes cannot drift apart.
 *
 * THE NONCE IS HASHED AND NEVER STORED. A nonce is a one-use secret until it is spent, so a ledger holding
 * it in the clear would be a list of spent secrets. And **the TEXT is never here at all** — only its
 * digest, which is what lets a stranger holding the text ask whether it was confirmed.
 */
export function journalCard({ path, card, action, lane, sender, now }) {
  // ── THERE IS NO `prevHash` PARAMETER, AND THAT IS DELIBERATE ────────────────────────────────────
  // The first version took one and used it as a `{seq, hash}` OBJECT while its name promised a hash
  // STRING, so the obvious call produced `seq: NaN` and a GAP. **A parameter whose name and whose use
  // disagree is a trap**, and the caller who fell into it was me. The chain is discovered from the file,
  // so a caller CANNOT get it wrong.
  const previous = lastHashOf(path)
  const entry = {
    seq: previous.seq + 1,
    prevHash: previous.hash,
    lane: lane ?? card.lane ?? null,
    kind: card.kind ?? null,
    digest: card.digest ?? null,
    action,
    time: typeof now === 'string' ? now : new Date(now ?? Date.now()).toISOString(),
    sender: sender ?? null,
    nonceHash: createHash('sha256').update(String(card.nonce)).digest('hex'),
  }
  const written = appendCard(path, entry)
  // ── AND THE CLAIM ABOUT HOW MANY THERE ARE, WRITTEN BESIDE THE LEDGER ──────────────────────────
  // WHAT THIS BUYS: a ledger that loses its tail is caught by the disagreement, instead of verifying
  // perfectly forever. **A PREFIX OF A VALID CHAIN IS A VALID CHAIN — the file cannot notice that it is
  // short, so the claim has to live outside it.**
  //
  // WRITTEN AFTER THE ENTRY, and durably, for the same reason the entry is: **a claim that lands before its
  // entry would describe a ledger that does not exist yet**, which reads as a truncation on the next read.
  durableWrite(headPathOf(path), Buffer.from(`${JSON.stringify({
    count: written.seq, head: written.hash,
    note: 'the number of card entries this ledger is claimed to hold, and its head; kept OUTSIDE the '
      + 'ledger because a prefix of a valid chain is a valid chain',
  })}\n`, 'utf8'), { dir: dirname(headPathOf(path)), mode: LEDGER_MODE })
  return written
}

/** The sidecar path for one ledger: the ledger's name with a `.head.json` suffix. */
export function headPathOf(ledgerPath) {
  return ledgerPath.endsWith('.jsonl')
    ? `${ledgerPath.slice(0, -'.jsonl'.length)}.head.json`
    : `${ledgerPath}.head.json`
}

/** The last entry's seq and hash, so the next one chains to it. Absent ledger chains to GENESIS. */
function lastHashOf(path) {
  const chain = readChain(path)
  // A LEDGER THAT CANNOT BE READ CANNOT BE EXTENDED. Writing the next entry onto a torn or broken chain
  // would BURY the damage under a link that points at a line nothing verified.
  if (chain.ok !== true) {
    refuse('LANE_CARD_LEDGER_UNREADABLE',
      `the card ledger at ${path} cannot be read (${chain.code}); refusing to extend it`)
  }
  // ── AND AGAINST THE TRUSTED COUNT, BEFORE EXTENDING ────────────────────────────────────────────
  // THE CHAIN CHECK ABOVE CAN ONLY SAY "what is here is consistent". **A ledger that lost its tail is
  // perfectly consistent**, so without the sidecar this function would happily append onto the damage and
  // BURY THE LOSS UNDER A NEW LINK — every later read then agrees with the shorter ledger, and the entries
  // that were dropped are gone with nothing left to disagree with.
  //
  // A MISSING SIDECAR IS NOT AN ERROR HERE: a ledger that predates the sidecar (or one written by a
  // caller that never made a claim) has nothing to compare against, and **inventing a count would be
  // worse than having none** — the claim must come from a record that was written independently.
  const claimPath = headPathOf(path)
  let expected = null
  if (existsSync(claimPath)) {
    try {
      const claim = JSON.parse(readFileSync(claimPath, 'utf8'))
      if (typeof claim.count === 'number' && typeof claim.head === 'string') {
        expected = { count: claim.count, head: claim.head }
      }
    } catch (error) {
      refuse('LANE_CARD_LEDGER_UNREADABLE',
        `the card ledger's trusted count at ${claimPath} could not be read (${error?.code ?? error}); `
        + 'refusing to extend a ledger whose completeness cannot be established')
    }
  }
  const verdict = verifyChain(chain.entries, expected)
  if (verdict.ok !== true) {
    refuse('LANE_CARD_LEDGER_BROKEN',
      `the card ledger at ${path} does not verify (${verdict.code}); refusing to extend it`)
  }
  const last = chain.entries[chain.entries.length - 1]
  return last === undefined ? { seq: 0, hash: GENESIS } : { seq: last.seq, hash: last.hash }
}

export function laneLedgerPath(stateRoot) {
  return join(stateRoot, 'lane-door', 'ledger.jsonl')
}

/**
 * Whether a Host header names this listener on loopback.
 *
 * THE SAME FENCE THE EYE USES, and for the same reason: a rebound DNS name resolves to 127.0.0.1 and
 * arrives with a Host this refuses, so a page in a browser cannot reach a loopback door by name.
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
 * @param expected - this launch's token.
 * @returns true only for an exact match of equal length.
 */
export function tokenMatches(presented, expected) {
  if (typeof presented !== 'string' || presented.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(presented, 'utf8'), Buffer.from(expected, 'utf8'))
}

/**
 * The bearer token from an Authorization header, or the bare `x-lane-token` value.
 * @param headers - request headers.
 * @returns the presented token, or '' when none was sent.
 */
function presentedToken(headers) {
  const authorization = headers.authorization
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim()
  }
  const direct = headers['x-lane-token']
  return typeof direct === 'string' ? direct.trim() : ''
}

/**
 * Read and DISCARD a request body, so a refusal can be delivered over a live socket.
 * @param req - the incoming request.
 * @returns a promise that settles when the body ends, the ceiling is passed, or a second has gone by.
 */
function drainBody(req) {
  return new Promise(resolve => {
    let seen = 0
    let settled = false
    const done = () => { if (!settled) { settled = true; clearTimeout(timer); resolve() } }
    // TIME-BOXED: a caller that declares a body and then stops writing must not be able to wedge the
    // refusal it is being given.
    const timer = setTimeout(() => { req.destroy(); done() }, 1000)
    req.on('data', chunk => {
      seen += chunk.length
      if (seen > DRAIN_CEILING_BYTES) { req.destroy(); done() }
    })
    req.on('end', done)
    req.on('error', done)
    req.resume()
  })
}

/**
 * Read a bounded JSON body, and read it to its END even when it is over the bound.
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
      if (size > LANE_LIMIT_BYTES) {
        over = true
        // Nothing over the limit is retained: emptied once, and never appended to again.
        chunks.length = 0
        if (guard === null) guard = setTimeout(() => { req.destroy() }, 1000)
        continue
      }
      chunks.push(chunk)
    }
  } catch {
    if (!over) return { ok: false, code: LANE_REFUSE.BAD_BODY }
  } finally {
    if (guard !== null) clearTimeout(guard)
  }
  if (over) return { ok: false, code: LANE_REFUSE.BODY_TOO_LARGE }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text.length === 0) return { ok: false, code: LANE_REFUSE.BAD_BODY }
  try {
    // ── A BODY THAT CARRIES TWO ANSWERS IS REFUSED BY NAME ─────────────────────────────────────────
    // `JSON.parse` KEEPS THE LAST OF A REPEATED KEY, and this door's `text` IS the message: its digest is
    // what a card binds and what the ledger records. `{"text":"send A","text":"send B"}` parses to
    // `"send B"` — ONE DOCUMENT CARRYING TWO DIFFERENT MESSAGES, WITH THE DOOR SILENTLY CHOOSING ONE.
    // **That is not malformed; it is ambiguous, and the two get different names because a reader has to be
    // able to tell them apart.**
    const repeated = duplicateKeysIn(text)
    if (repeated.length > 0) {
      return { ok: false, code: LANE_REFUSE.DUPLICATE_KEY,
        detail: `the body repeats ${repeated.map(k => JSON.stringify(k)).join(', ')}` }
    }
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, code: LANE_REFUSE.BAD_BODY }
    }
    return { ok: true, body: parsed }
  } catch {
    return { ok: false, code: LANE_REFUSE.BAD_BODY }
  }
}

/**
 * What a validated request asks this door to do, decided from the text alone.
 *
 * A SLASH LINE IS A COMMAND OR IT IS A REFUSAL. It is never "just text": a lane that wrote `/permission
 * auto` into a session would be writing a message that LOOKS like a command, and the difference between
 * those two outcomes is exactly the sort of thing a person should not have to guess about.
 * @param text - the validated message text.
 * @returns the route: a command name, or the prompt.
 */
// routeOf now lives in lane-dispatch.mjs and is re-exported above.

/**
 * Install the lane door.
 *
 * @param {object} deps - the shell's own facts.
 * @param {string} deps.stateRoot - where the token and the ledger live. Required: a door with no state
 *   root would have nowhere to put its token and no ledger, and both are the point.
 * @param {string} deps.backendUrl - the AUTHENTICATED launch URL, held in memory only, used to mint the
 *   cookie the backend accepts. It is never written, logged or forwarded.
 * @param {() => boolean} [deps.isApprovalOpen] - whether the one-bit approval window is open.
 * @param {() => boolean} [deps.isDrawPending] - whether a drawn bind phrase is in flight. The names are
 *   the bridge's own; a door that asks for one the bridge does not publish is a fence that never fires.
 * @param {(line: string) => void} [deps.log] - the shell's log sink. Never given a token or a cookie.
 * @param {typeof fetch} [deps.fetchImpl] - the HTTP carrier, injectable so a court can drive the backend
 *   half without a listening app.
 * @param {() => Promise<number>} [deps.listen] - test seam: bind the server, returning its port.
 * @returns {Promise<{port: number, url: string, token: string, tokenFile: string, ledger: string, dispose: () => Promise<void>}>}
 */
/** How often the card register releases text nobody is waiting on. **The TTL is minutes, so seconds is enough.**
 * A shorter interval would wake for nothing; a longer one would hold a moot question in memory past its usefulness. */
export const CARD_SWEEP_MS = 30_000

export async function installLaneDoor(deps) {
  if (typeof deps?.stateRoot !== 'string' || deps.stateRoot === '') {
    throw new Error('lane-door: a state root is required; the token and the ledger are the point of this door')
  }
  if (typeof deps?.backendUrl !== 'string' || deps.backendUrl === '') {
    throw new Error('lane-door: the authenticated launch URL is required; without it the door cannot reach the app')
  }
  const say = typeof deps.log === 'function' ? deps.log : () => {}
  const doFetch = deps.fetchImpl ?? globalThis.fetch
  // THE FILESYSTEM IS A DEPENDENCY HERE ONLY SO THE FAILURE PATH IS TESTABLE: a stale token file that
  // cannot be removed must stop the write rather than be written over, and a court cannot make
  // `unlinkSync` fail without root or a directory it may not change.
  // `chmodSync` AND `statSync` ARE PART OF THE SHIM ON PURPOSE: the door now ESTABLISHES modes rather
  // than assuming them, so a shim without them would make the establishing path unreachable in
  // exactly the courts that need to exercise it.
  const fs = deps.fs ?? { mkdirSync, renameSync, unlinkSync, writeFileSync, chmodSync, statSync }
  const isApprovalOpen = deps.isApprovalOpen ?? (() => false)
  const isDrawPending = deps.isDrawPending ?? (() => false)
  // THE BRIDGE'S TWO FACTS, GATHERED SO THE DISPATCH RULE CAN BE ASKED RATHER THAN RESTATED. AUMLOK owns
  // both predicates and their semantics are untouched: this object carries them across, it does not
  // reinterpret them, and `approvalFence` treats a missing one as `false` exactly as the door did.
  const bridge = { isApprovalOpen, isDrawPending }
  const tokenFile = laneTokenPath(deps.stateRoot)
  const portFile = lanePortPath(deps.stateRoot)
  const ledgerPath = laneLedgerPath(deps.stateRoot)
  // THE CHAINED LEDGER, BESIDE THE SIMPLE ONE AND NOT INSTEAD OF IT.
  const cardLedgerPath = laneCardLedgerPath(deps.stateRoot)
  // THE CARDS THIS DOOR ISSUED. Held in memory, because a card is a confirmation of ONE message that is
  // about to be sent, not a durable credential — and a register on disk would be a second thing to secure
  // for no gain. A restart forgets every card, which is the safe direction.
  const cards = createCardRegister()

  // ── THE SWEEP RUNS, WHICH IT DID NOT BEFORE (COHESION ROW 36) ─────────────────────────────────────
  // The register has had a `sweep()` since it was written and NOTHING CALLED IT, so an expired card's text sat in
  // memory for the life of the process: expiration was a FILTER in the view and never a release. The review's
  // words are the reason this is a timer rather than a tidy-up at exit — "hiding is not deleting".
  // `unref()` so the timer never holds the process open by itself: the door's own server does that.
  const sweepTimer = setInterval(() => {
    const released = cards.sweep()
    if (released > 0) say(`lane-door: released the text of ${String(released)} card(s) that are no longer awaiting an answer`)
  }, CARD_SWEEP_MS)
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref()
  const token = randomBytes(32).toString('base64url')
  /** The cookie the backend accepts. Minted when needed, re-minted at most once PER REQUEST, never logged. */
  let cookie = null

  // ── THE TOKEN FILE, OWNER-ONLY AND ATOMIC ────────────────────────────────────────────────────────
  // STALE FIRST: a launch killed without dispose must not leave a dead token looking current, and a write
  // that then fails must not leave the old file behind either.
  // THE DIRECTORY IS ESTABLISHED, NOT ASSUMED. `mode` in a `mkdir` is masked by the umask and is not
  // applied at all to a directory that already exists — so under `umask 022` this was `0755` and the
  // token sat in a world-readable directory. `establishOwnerOnlyDir` chmods after creation and refuses
  // by name when the path is not this uid's or cannot be made owner-only. **IT NEVER LOOSENS.**
  // THE SHIM IS FOR THE WRITE, NOT FOR THE MODE. A court injects an `fs` to make a specific write fail,
  // and those shims predate this call — so `mkdirSync` comes from the shim (a court may still simulate a
  // directory it cannot create) while **`statSync` and `chmodSync` are the real ones**, because a mode
  // established through a stub would be a mode nobody established.
  // ── THE CEILING, SAID OUT LOUD ──────────────────────────────────────────────────────────────────
  // The ledger is APPEND-ONLY, UNFENCED AND NOT FSYNCED: it is a record of what the door SAW, not a
  // durable commitment, and a reader who believes otherwise would treat it as evidence it cannot be.
  // **A ceiling that is not printed is a ceiling nobody knows about.**
  say('lane: the ledger is AUDIT-ONLY and NOT DURABLE — append-only, unfenced and not fsynced; it '
    + 'records what the door saw, and it is not evidence that a send was committed')

  const doorDir = dirname(tokenFile)
  const established = establishOwnerOnlyDir(doorDir, { fs: {
    mkdirSync: fs.mkdirSync ?? mkdirSync, statSync, chmodSync,
  } })
  if (established.ok !== true) {
    throw new Error(`lane-door: ${established.code}: ${established.reason}`)
  }
  try {
    fs.unlinkSync(tokenFile)
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') {
      throw new Error(`lane-door: a stale token file at ${tokenFile} could not be removed (${error?.code ?? error}); refusing to write over it`)
    }
  }
  const handle = `${tokenFile}.${process.pid}.tmp`
  fs.writeFileSync(handle, `${token}`, { mode: 0o600 })
  // THE `mode` ABOVE IS MASKED AND IS A HINT, NOT A GUARANTEE — and the file may already exist. The
  // establishing `chmod` is what makes it true, on the tmp handle BEFORE the rename so the token is
  // never briefly world-readable under its final name.
  // THE REAL `chmodSync`, NOT THE SHIM'S. The court's shim exists to make a WRITE fail and predates this
  // call, so a mode requested through it would be a mode nobody established — and the shim is not the
  // thing that owns the mode anyway.
  try {
    chmodSync(handle, 0o600)
  } catch (error) {
    throw new Error(`lane-door: the token file could not be made owner-only (${error?.code ?? error})`)
  }
  fs.renameSync(handle, tokenFile)

  /** One JSON answer. Never carries the token, the cookie or the message text. */
  const answer = (res, status, value) => {
    const body = JSON.stringify(value)
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
    res.end(body)
    return undefined
  }
  const refuse = (res, status, code, detail) => answer(res, status, code === undefined ? { ok: false } : { ok: false, code, ...(detail === undefined ? {} : { detail }) })

  /**
   * One line per request that passed the token fence.
   *
   * NOTHING OF WHAT WAS SAID. The digest is over the TEXT and is a prefix, so a person can tell whether
   * the ledger line and a session log entry are the same message without the ledger holding the message.
   */
  const record = (entry, res) => {
    const line = JSON.stringify(ledgerEntry(entry, res.statusCode))
    try {
      // ── O_NOFOLLOW, BECAUSE THE LEDGER IS AN AUDIT TRAIL AND A LINK MOVES IT ────────────────────
      // `appendFileSync(path, …)` FOLLOWS A SYMLINK: the audit trail of who sent what can be made to land
      // somewhere else entirely, and the door would report success. `O_NOFOLLOW` makes a linked ledger a
      // refusal instead. **A trail that can be redirected is not a trail.**
      const fd = openSync(ledgerPath, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT
        | constants.O_NOFOLLOW, 0o600)
      try {
        writeSync(fd, `${line}\n`)
      } finally {
        closeSync(fd)
      }
      // ESTABLISHED, NOT REQUESTED. `mode` on an append is masked by the umask and ignored entirely for a
      // file that already exists — and the ledger outlives the process that made it, so it is the file
      // most likely to be inherited from a run under a different umask.
      try {
        chmodSync(ledgerPath, 0o600)
      } catch (error) {
        say(`lane: ledger mode could not be established (${error?.code ?? error})`)
      }
    } catch (error) {
      // A LEDGER THAT CANNOT BE WRITTEN MUST NOT SWALLOW THE ANSWER. The caller is owed its result; the
      // failure is named in the log and the request stands or falls on its own merits.
      say(`lane: ledger write failed (${error?.code ?? error})`)
    }
  }

  /** The digest prefix the ledger keeps, over the text only. */
  // `digestOf` is imported from lane-dispatch.mjs: the ledger's digest rule is a dispatch rule.

  /**
   * Mint the cookie the backend accepts, from the in-memory launch URL.
   *
   * THE TOKEN RIDES THE REDIRECT, NOT THE BODY: the app answers `GET /?token=…` with a `Set-Cookie` and a
   * redirect to the clean path, and `redirect: 'manual'` is what makes the header readable here instead
   * of being followed and lost.
   */
  const mintCookie = async () => {
    if (cookie !== null) return cookie
    const response = await doFetch(deps.backendUrl, { redirect: 'manual' })
    const cookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie') ?? '']
    const auth = cookies.map(one => String(one).split(';')[0].trim()).find(one => one.startsWith('dsh-auth-'))
    if (auth === undefined || auth === '') throw new Error('lane-door: the app returned no authenticated cookie')
    cookie = auth
    return cookie
  }

  /**
   * One remote call on the app's HTTP carrier.
   *
   * THE ENVELOPE IS THE APP'S, NOT AN INVENTION: a Typert remote call over the connection RPC is
   * `{type: 'client-request', rpcId, method, payload: {args}}`, the method must equal the URL endpoint,
   * and `payload` must hold exactly one key. A bare parameter object is refused by the gateway, so the
   * shape is asserted by a court against a recording carrier rather than assumed here.
   * @param endpoint - the remote method, which is also the path under `/api/`.
   * @param args - the named arguments.
   * @returns the HTTP status and the parsed body.
   */
  const callBackend = async (endpoint, args) => {
    const send = async (useCookie) => {
      // ── THE FENCE IS READ HERE, AT THE POINT OF SENDING, WITH AN EMPTY WINDOW BEFORE THE FETCH ────
      // **THE FENCE IS THE ONE CHECK WHOSE WHOLE VALUE IS ITS TIMING.** Every other check is about bytes
      // that do not change — the digest, the lane, the kind. **The approval window is a fact about the
      // WORLD, and the world moves while you are awaiting a cookie.** A fence read separated from its send
      // by an await is not a fence, it is a hope: an approval that opened during the round trip is exactly
      // the window this fence exists to close.
      const fenceNow = approvalFence(bridge)
      if (fenceNow.open) return { refused: true, code: fenceNow.code }
      const body = JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: endpoint, payload: { args } })
      const response = await doFetch(new URL(`/api/${endpoint}`, deps.backendUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: useCookie },
        body,
        redirect: 'manual',
      })
      let parsed = null
      try {
        parsed = await response.json()
      } catch {
        parsed = null
      }
      return { status: response.status, body: parsed }
    }
    let result = await send(await mintCookie())
    // AN OPEN FENCE STOPPED THE SEND ITSELF, not merely a check further upstream. **A refusal that arrives
    // after the message went is not a refusal.**
    if (result.refused === true) { say(`lane: refused ${result.code}`); return deny(423, result.code) }
    if (result.status === 401) {
      // ONCE PER REQUEST. A second 401 is not a stale cookie, it is a refusal, and retrying it in a loop
      // would turn one bad answer into an outage. The bound is per REQUEST rather than per door lifetime
      // on purpose: a launch-lifetime flag would lock every lane out of this channel for the rest of the
      // session after a single stale cookie, which is a worse failure than the one it guards against.
      cookie = null
      result = await send(await mintCookie())
      // THE RETRY IS A SECOND SEND AND NEEDS A SECOND READ — **the window can open between the first
      // attempt and the retry just as easily as before it.**
      if (result.refused === true) { say(`lane: refused ${result.code}`); return deny(423, result.code) }
      if (result.status === 401) {
        // DROPPED EITHER WAY. Keeping a cookie the backend has just refused would make every later
        // request pay a guaranteed 401 round trip before it could mint a fresh one.
        cookie = null
        return { ...result, expired: true }
      }
    }
    return result
  }

  const handler = async (req, res) => {
    // DRAIN, THEN REFUSE. See `drainBody`: a refusal that answers before the body is read leaves those
    // bytes in a kept-alive socket, and the next request on that connection is parsed from the middle of
    // this one.
    const deny = async (status, code, detail) => { await drainBody(req); return refuse(res, status, code, detail) }

    if (req.method !== 'POST') return deny(405, LANE_REFUSE.METHOD)
    const path = (req.url ?? '').split('?')[0]
    // ── THE CONFIRM ENDPOINT ────────────────────────────────────────────────────────────────────
    // THE MINIMAL SURFACE THE SHELL CAN CALL, and it MINTS NOTHING BY ITSELF: it binds a card to the
    // exact lane, text and kind it is handed. The UI lane renders a card and calls this; it never
    // constructs one, and a shell that could mint its own card would have no card at all.
    if (path === CARD_ROUTE) {
      const read = await readJsonBody(req)
      if (!read.ok) {
        return refuse(res, read.code === LANE_REFUSE.BODY_TOO_LARGE ? 413 : 400, read.code)
      }
      const { lane: cardLane, text: cardText, kind: cardKind } = read.body ?? {}
      if (typeof cardLane !== 'string' || typeof cardText !== 'string' || typeof cardKind !== 'string') {
        return refuse(res, 400, LANE_REFUSE.BAD_BODY, 'lane, text and kind are all required')
      }
      const card = cards.issue({ lane: cardLane, text: cardText, kind: cardKind })
      // THE LEDGER GETS THE DIGEST, NEVER THE TEXT — the same rule the send path follows.
      record({ origin: cardLane, kind: 'card-issued', bytes: Buffer.byteLength(cardText, 'utf8'),
        sha256: cardDigestPrefix(card.digest) }, res)
      return answer(res, 200, { ok: true, card: {
        nonce: card.nonce, digest: card.digest, lane: card.lane, kind: card.kind,
        issuedAt: card.issuedAt, expiresAt: card.expiresAt,
      } })
    }
    if (path !== LANE_ROUTE) return deny(404, LANE_REFUSE.NOT_FOUND)

    const port = address().port
    if (!namesThisListener(req.headers.host, port)) {
      say(`lane: refused ${LANE_REFUSE.FORBIDDEN_HOST}`)
      return deny(403, LANE_REFUSE.FORBIDDEN_HOST)
    }
    // ANY ORIGIN, not "a foreign origin". The eye tolerates the app's own origin because the app's page
    // may call it; nothing in a browser has any business calling this door at all, and refusing every
    // Origin is the version of that sentence a reader cannot misread.
    if (req.headers.origin !== undefined) {
      say(`lane: refused ${LANE_REFUSE.FORBIDDEN_ORIGIN}`)
      return deny(403, LANE_REFUSE.FORBIDDEN_ORIGIN)
    }
    // AND THE BROWSER'S OWN TELL. `Sec-Fetch-Site` is attached by browsers and by nothing else; a lane CLI
    // does not send it, so its presence says the caller is a page whatever it claims in Origin.
    if (req.headers['sec-fetch-site'] !== undefined) {
      say(`lane: refused ${LANE_REFUSE.FORBIDDEN_FETCH_SITE}`)
      return deny(403, LANE_REFUSE.FORBIDDEN_FETCH_SITE)
    }
    if (!tokenMatches(presentedToken(req.headers), token)) {
      say(`lane: refused ${LANE_REFUSE.UNAUTHORIZED}`)
      return deny(401, LANE_REFUSE.UNAUTHORIZED)
    }
    // EVERY REFUSAL FROM HERE IS LEDGERED, because from here the request is attributable to a lane.
    // THE FENCE IS ASKED, NOT CAPTURED. `approvalFence` is called again after the body read below,
    // and that second call is the one that matters — a boolean hoisted here would hold the answer the
    // window had BEFORE the work, which is the defect the second read exists to prevent.
    const fenceBefore = approvalFence(bridge)
    if (fenceBefore.open) {
      say(`lane: refused ${fenceBefore.code}`)
      record({ kind: 'approval-open' }, res)
      return deny(423, fenceBefore.code)
    }

    const read = await readJsonBody(req)
    if (!read.ok) {
      record({ kind: 'bad-body', bytes: 0 }, res)
      return refuse(res, read.code === LANE_REFUSE.BODY_TOO_LARGE ? 413 : 400, read.code)
    }
    // THE FENCE IS READ AGAIN HERE, and that is the point of this line: the check at the top is separated
    // from the forward by a body read, so a window that was closed when the request was judged can be
    // open by the time the message would be sent. A fence read once, before the work, does not hold
    // during the work.
    const fenceAfter = approvalFence(bridge)
    if (fenceAfter.open) {
      say(`lane: refused ${fenceAfter.code}`)
      record({ kind: 'approval-open' }, res)
      return refuse(res, 423, fenceAfter.code)
    }

    const body = read.body
    const session = body.session
    const text = body.text
    const lane = body.origin
    const bytes = Buffer.byteLength(typeof text === 'string' ? text : '', 'utf8')
    if (typeof session !== 'string' || !SESSION_PATTERN.test(session)) {
      record({ origin: typeof lane === 'string' ? lane : null, kind: 'bad-session', bytes }, res)
      return refuse(res, 400, LANE_REFUSE.BAD_SESSION)
    }
    if (typeof lane !== 'string' || !LANE_PATTERN.test(lane)) {
      record({ session, kind: 'bad-lane', bytes }, res)
      return refuse(res, 400, LANE_REFUSE.BAD_LANE)
    }
    if (typeof text !== 'string' || text.trim() === '') {
      record({ origin: lane, session, kind: 'bad-text', bytes }, res)
      return refuse(res, 400, LANE_REFUSE.BAD_TEXT)
    }
    // A SLASH LINE IS ONE LINE. A command with a second line under it is a way to smuggle a message past
    // the command gate, so it is refused rather than parsed at the first newline.
    if (text.startsWith('/') && text.includes('\n')) {
      record({ origin: lane, session, kind: 'bad-text', bytes }, res)
      return refuse(res, 400, LANE_REFUSE.BAD_TEXT)
    }

    // ── THE CARD, CHECKED HERE AND NOT EARLIER ─────────────────────────────────────────────────
    // AFTER the fence and AFTER the body, because the order is the decision: an unknown class is a
    // configuration defect, an open approval window outranks everything, and only then is a card asked
    // for. `sender` DEFAULTS TO `fable`, which is today's path: the token already establishes it, the
    // request is attributable to a lane, and FABLE'S DIRECT SEND IS NOT BROKEN BY THIS.
    // ── THE CLASS COMES FROM THE CREDENTIAL, NEVER FROM THE BODY ────────────────────────────────
    // THIS WAS `body.sender ?? 'fable'` AND IT WAS THE WORST DEFECT IN THIS FILE. `senderClass('fable')`
    // has `requiresCard: false`, so **a request that merely SAID `{"sender":"fable"}` skipped the card
    // entirely — CORE could claim to be Fable and the door would believe it, because the door asked the
    // BODY who was calling.**
    //
    // A credential establishes WHO IS CALLING; a body carries WHAT THEY WANT. **A door that reads its
    // authority out of the request has no authority at all — it has a suggestion the caller is free to
    // change.** The class is resolved from the lane this door AUTHENTICATED, and the body has no vote.
    //
    // AND A BODY THAT NAMES A CLASS IS REFUSED RATHER THAN SILENTLY IGNORED: a caller who believes they
    // chose a sender class has to be told they did not, or they will keep believing it.
    if (Object.hasOwn(body, 'sender')) {
      record({ origin: lane, session, kind: 'card-refused', bytes, sha256: digestOf(text) }, res)
      return refuse(res, 400, LANE_REFUSE.SENDER_CLASS_FROM_BODY,
        'the sender class comes from the credential that authorised this request, not from the body; '
        + 'a request may not name its own authority')
    }
    // NOT `lane`: that is the body's `origin`, and a body may not pick its class. One token, so one class; see
    // `credentialSender` for the limit this leaves.
    const callerClass = credentialSender(token, session)
    if (callerClass === null) {
      record({ origin: lane, session, kind: 'card-refused', bytes, sha256: digestOf(text) }, res)
      return refuse(res, 403, LANE_REFUSE.SENDER_CLASS_UNKNOWN,
        'this credential does not establish a sender class, so no card decision can be made for it')
    }
    // ── THE ROUTE IS COMPUTED BEFORE THE DECISION, AND ITS KIND IS WHAT THE CARD BINDS ─────────────
    // THIS WAS `kind: 'prompt'`, HARCODED, WHILE ROUTING BELOW RETURNS `{kind: 'command'}` FOR TEXT
    // BEGINNING WITH `/`. **A card confirmed for a PROMPT was therefore spent on a COMMAND: the owner
    // confirmed a kind, and a different kind executed.** `confirmCard` recomputes the binding digest over
    // `kind`, so a hardcoded value makes that check compare the card against **a kind nobody routed**.
    //
    // **A KIND DECIDED AFTER THE CARD IS CHECKED IS A KIND THE CARD WAS NEVER CHECKED AGAINST**, so the
    // route moves up here and the SAME value is used for the decision and for the execution.
    const routed = routeOf(text)
    const authorised = authoriseSend({
      sender: callerClass, text, lane, kind: routed.kind, card: body.card ?? null,
      bridge, now: Date.now(), issued: cards.issued, isSpent: cards.isSpent,
      isConfirmed: cards.isConfirmed,
    })
    if (!authorised.ok) {
      record({ origin: lane, session, kind: 'card-refused', bytes, sha256: digestOf(text) }, res)
      return refuse(res, authorised.code === LANE_REFUSE.SENDER_CLASS_UNKNOWN ? 400 : 403,
        authorised.code, authorised.reason)
    }
    if (authorised.card !== null) {
      cards.spend(authorised.card.nonce)
      // ── A CONFIRMED CARD BECOMES A CHAINED ENTRY ────────────────────────────────────────────────
      try {
        // THE SAME CLASS THE DECISION WAS MADE WITH, NOT THE ONE THE BODY NAMED. **I wrote this line
        // with the very defect the review is about** — the journal recorded whatever `sender` the
        // CALLER supplied — and the court caught it because it greps for the pattern rather than for the
        // one place I remembered. **A record that names a class the caller chose is a record of the
        // caller's claim, not of the authority that was actually exercised.**
        journalCard({ path: cardLedgerPath, card: authorised.card, action: 'confirmed', lane,
          sender: callerClass })
      } catch (error) {
        // ── A RECORD THAT CANNOT BE WRITTEN FENCES THE SEND ────────────────────────────────────────
        // THIS WAS `say(...)` AND THEN CARRY ON, WHICH IS THE DEFECT: **a broken ledger did not fence
        // the effect.** The reasoning behind logging was "the send already happened" — but it had NOT:
        // the spend is in memory, the backend call is BELOW this line, and the message is irreversible
        // once it goes. **An approval with no record is exactly what this ledger exists to prevent, so a
        // send that goes out while the record fails is THE DEFECT ITSELF rather than a degraded version
        // of it.** A record you cannot write is a record you do not have.
        say(`lane: THE CARD WAS CONFIRMED AND THE LEDGER COULD NOT BE WRITTEN (${error?.code ?? error})`)
        return refuse(res, 503, LANE_REFUSE.LEDGER_UNWRITABLE,
          'the approval could not be recorded, so this message was NOT sent; a send with no record of '
          + 'who approved it is the thing the record exists to prevent')
      }
      // EVERY CONFIRMED CARD IS LEDGERED WITH ITS DIGEST, so a stranger can match what was SENT against
      // what was SHOWN — the digest is a prefix and the text is never written.
      record({ origin: lane, session, kind: 'card-confirmed', bytes,
        sha256: cardDigestPrefix(authorised.card.digest) }, res)
    }

    // ── THE SAME ROUTE THE CARD WAS BOUND TO, NOT A SECOND COMPUTATION ──────────────────────────
    // Two calls to `routeOf` on the same text would agree today and **could disagree the moment routing
    // grows a stateful rule** — and the card was bound to the FIRST one. **A second computation is a
    // second chance for the kind the owner confirmed and the kind that executes to come apart.**
    const route = routed
    if (route.kind === 'refused') {
      record({ origin: lane, session, kind: 'command-refused', bytes, sha256: digestOf(text) }, res)
      return refuse(res, 400, LANE_REFUSE.COMMAND_REFUSED, `/${route.word} is not one of ${LANE_COMMANDS.join(', ')}`)
    }

    if (route.kind === 'command') {
      // ── AND EXECUTION DOES NOT OUTRUN THE BINDING ──────────────────────────────────────────────
      // The kind is bound at authorisation now, but this is the point of EXECUTION and it is the point
      // that matters: **a mismatch here is the exact condition the binding exists to detect.** Checking
      // only at authorisation would leave the guard dependent on every future caller passing the right
      // kind — **this one refuses on the fact rather than on the caller's diligence.**
      if (authorised.card !== null && authorised.card.kind !== route.kind) {
        record({ origin: lane, session, kind: 'card-refused', bytes, sha256: digestOf(text) }, res)
        return refuse(res, 403, LANE_REFUSE.KIND_NOT_BOUND,
          `the card binds kind ${JSON.stringify(authorised.card.kind)} and this message routes as `
          + `${JSON.stringify(route.kind)}; a command may not be executed on a card confirmed for a prompt`)
      }
      const result = await callBackend('commands/execute', { agentId: session, line: text, submittedAttachments: [] })
      record({ origin: lane, session, kind: `command:${route.command}`, bytes, sha256: digestOf(text) }, res)
      if (result.expired) return refuse(res, 502, LANE_REFUSE.BACKEND_UNAUTHORIZED)
      if (result.status !== 200) return refuse(res, 502, LANE_REFUSE.BACKEND_FAILED, `commands/execute answered ${result.status}`)
      return answer(res, 200, { ok: true, kind: `command:${route.command}`, session, backend: result.body })
    }

    // THE PREFIX IS HOW A PERSON TELLS A LANE'S MESSAGE FROM THEIR OWN, and it is inside the text because
    // the session log is the only place both of them are read together.
    // THE ARGUMENT IS NAMED, NOT SPREAD. The remote method `session/prompt` declares exactly ONE
    // parameter, called `request`, and the gateway refuses an args object whose fields do not match that
    // descriptor (`gateway/arguments-invalid`) — so the four prompt fields must arrive under that one key.
    // The court reads the record of what this door actually sent, which is how this was caught: the first
    // version passed them at the top level, and no fake backend would have noticed.
    const sent = `[${lane} via lane door] ${text}`
    // THE ONE IDENTITY THAT SURVIVES INTO THE SESSION, minted here so it can be written down below.
    const requestId = `lane-door:${lane}:${randomUUID()}`
    const result = await callBackend('session/prompt', {
      request: {
        requestId,
        sessionId: session,
        mode: 'queue',
        content: [{ type: 'text', text: sent }],
      },
    })
    // ── THE ID THIS DOOR CAUSED IS THE REQUEST ID, RECORDED ONCE THE HARNESS ACCEPTED IT (2026-09-27) ──────────
    // This read `result.messageId`, but `callBackend` returns `{status, body}`, so `prompted-messages.jsonl` was never
    // written. Nor is a message id anywhere in `body`: it is the carrier's envelope `{type: 'server-response', rpcId,
    // result: {ok, value}}`, and the app's `session/prompt` (vendor/dsh `api/session-controller/src/commands.ts:299`)
    // answers `value: {accepted: true}`. The `{messageId}` reply at `sdk/server/src/server.ts:192` belongs to the SDK
    // server, a different surface. What survives is the request id: `commands.ts:329` stamps it on the message as
    // `source.rpcId`, and the `user/message` event carries `source`. So the door records the request id, and the Kira
    // predicate (`autostage-hook.mjs` `isRealAsk`) excludes by `data.source.rpcId`. The text prefix stays as a second check.
    if (result.status === 200 && result.body?.result?.ok === true) {
      try {
        recordLaneDoorMessage(deps.stateRoot, requestId, lane)
      } catch (error) {
        // THE MESSAGE HAS ALREADY GONE, so a record that cannot be written is named, not turned into a failed send.
        say(`lane: the prompted id could not be recorded (${error?.code ?? error})`)
      }
    }
    record({ origin: lane, session, kind: 'prompt', bytes, sha256: digestOf(text) }, res)
    if (result.expired) return refuse(res, 502, LANE_REFUSE.BACKEND_UNAUTHORIZED)
    if (result.status !== 200) return refuse(res, 502, LANE_REFUSE.BACKEND_FAILED, `session/prompt answered ${result.status}`)
    return answer(res, 200, { ok: true, kind: 'prompt', session, backend: result.body })
  }

  const server = createServer((req, res) => {
    handler(req, res).catch((error) => {
      // NOTHING FROM THE ERROR REACHES THE CALLER. A backend error message can carry the launch URL, and
      // an unhandled rejection here would take the shell's process with it rather than answering.
      say(`lane: request failed (${error?.name ?? 'error'})`)
      if (!res.headersSent) refuse(res, 500, LANE_REFUSE.BACKEND_FAILED)
      else res.end()
    })
  })

  const address = () => server.address() ?? { port: 0 }
  const port = deps.listen === undefined
    ? await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve(address().port))
    })
    : await deps.listen(server)

  // THE PORT IS PUBLISHED THE SAME WAY THE TOKEN IS: atomically, owner-only, and only after the socket
  // is actually listening, so a reader that finds a port file finds a door behind it.
  const portHandle = `${portFile}.${process.pid}.tmp`
  writeFileSync(portHandle, `${port}\n`, { mode: 0o600 })
  try {
    chmodSync(portHandle, 0o600)
  } catch (error) {
    throw new Error(`lane-door: the port file could not be made owner-only (${error?.code ?? error})`)
  }
  renameSync(portHandle, portFile)

  return {
    // THE CARD SURFACE'S OWN FACTS, exposed so the shell can wire the window without reaching into this
    // closure. `cards` is the register itself; the three getters are what `installLaneCardBridge` needs.
    cards,
    pendingCard: () => cards.pending(),
    // THE VIEW'S OWN SOURCE: the pending card and the text it binds. **The ledger never sees this** —
    // it goes to the card window and nowhere else.
    pendingView: () => {
      const card = cards.pending()
      return card === null ? null : cards.view(card.nonce)
    },
    // ── AND SO DOES A DECLINED ONE ────────────────────────────────────────────────────────────────
    // This path spent the nonce and wrote NOTHING. **A ledger that records only what was ALLOWED cannot
    // show what was REFUSED**, and a refusal is the half of the record a reader most needs when asking
    // whether something was sent.
    spendCard: nonce => {
      const card = cards.pending()
      const spent = cards.spend(nonce)
      if (card !== null && card.nonce === nonce) {
        try {
          journalCard({ path: cardLedgerPath, card, action: 'declined', lane: card.lane, sender: 'owner' })
        } catch (error) {
          say(`lane: the decline was recorded only in memory (${error?.code ?? error})`)
        }
      }
      return spent
    },
    port,
    url: `http://127.0.0.1:${port}${LANE_ROUTE}`,
    token,
    tokenFile,
    portFile,
    ledger: ledgerPath,
    /**
     * Stop serving and remove the token file.
     *
     * THE LEDGER STAYS. It is the record of what this channel carried, and a disposal that erased it
     * would erase exactly the evidence a person would want after a lane behaved unexpectedly.
     */
    dispose: async () => {
      // **THE SWEEP STOPS WITH THE DOOR.** A timer that outlived dispose would keep a released-text register
      // reachable for the life of the process — the same leak it exists to close, one layer up.
      clearInterval(sweepTimer)
      await new Promise(resolve => { server.close(() => resolve()) })
      for (const file of [tokenFile, portFile]) {
        try {
          unlinkSync(file)
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error
        }
      }
    },
  }
}
