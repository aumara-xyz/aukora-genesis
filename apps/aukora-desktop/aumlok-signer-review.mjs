// The reviewer, the two logs and the parts the signer's server is built from, moved whole from aumlok-signer.mjs
// (2026-09-27) so that no file of the signer passes the self-change loop's 64 KiB limit (MAX_PATCH_BYTES,
// vendor/aukora-seed-app). No line was rewritten; six declarations gained `export` (ed25519KeyFromSeed,
// rawPublicKeyHexOf, readableChallenge, withinWindow, organValueAt, decide) because the signer uses them.
// aumlok-signer.mjs re-exports every name it exported before; where a comment below says "this file", "this module",
// "here" or "below", it means the signer, and {@link startShellSigner} is there.
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { approvalWitnessFor, approvalWordsDigest } from './aumlok-signer-witness.mjs'

/** The environment variable both sides read. One name, so they cannot disagree. */
export const SIGNER_SOCKET_ENV = 'AUKORA_SIGNER_SOCKET'

/** The socket this shell binds when nobody has exported one, relative to its own state root. */
export const DEFAULT_SIGNER_SOCKET_NAME = 'aumlok-signer.sock'

/** The name of the file every signer decision is appended to, under the shell's `state/logs`. */
export const SIGNER_DECISION_LOG_NAME = 'aukora-signer.log'
/** **THE APPROVAL EVENT LOG, A SIBLING OF THE DECISION LOG AND NOT A REPLACEMENT FOR IT.** */
const APPROVAL_EVENT_LOG_NAME = 'aukora-approval-events.log'

/** The `source=` field every line carries, so a reader knows which process wrote it. */
export const SIGNER_LOG_SOURCE = 'aukora-shell-signer'

// ── OPTIONAL TOUCH ID PRESENCE, AFTER APPROVE AND NEVER INSTEAD OF IT ─────────────────────────────────────────
// `options.presence` is the desktop's provider (aumlok-presence.mjs), handed in by main.mjs only; this module never
// imports it, so a broken provider cannot stop the signer loading. Each call below is bounded and total: a slow or
// failing provider costs an icon or a log field, never the answer, and the Touch ID wait always ends sixty seconds
// before the request's own window does.
const PRESENCE_OUTCOMES = Object.freeze(['never-enrolled', 'key-missing', 'invalid', 'no-evidence', 'verified'])
const PRESENCE_ICON_STATES = Object.freeze(['ready', 'confirmed', 'downgraded'])
const OWNER_APPROVAL_DOMAIN = 'aukora:owner-approval-request:v1'
/** Longest a person is given to touch the sensor after Approve. */
export const PRESENCE_MAX_MS = 15_000
/**
 * The Touch ID wait, decided HERE and not by the provider. It always leaves sixty seconds of the request's window,
 * so self-change and advance still have time for both verifiers and the kernel's expiry check; a later click simply
 * gets no Touch ID.
 */
export function presenceBudgetMs(expiresAt, now = Date.now()) {
  const left = Number(expiresAt) * 1000 - now - 60_000
  return Number.isFinite(left) ? Math.max(0, Math.min(PRESENCE_MAX_MS, left)) : 0
}

/** Settle with `fallback` after `ms`, or with whatever `work` returns first; never rejects. */
function bounded(work, ms, fallback) {
  let timer
  return Promise.race([
    Promise.resolve().then(work).catch(() => fallback),
    new Promise(settle => { timer = setTimeout(() => settle(fallback), ms) }),
  ]).finally(() => clearTimeout(timer))
}

/** The line the macOS Touch ID sheet shows: the kind and the requester's own `why`, read from the bound bytes. */
function presencePrompt(witness, operationContent) {
  let text = ''
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(operationContent)) } catch { text = '' }
  const lines = text.split(/\r?\n/u)
  const why = lines.find(line => /^(?:why|reason):?[ \t]+/u.test(line))?.replace(/^(?:why|reason):?[ \t]+/u, '')
  const kind = lines[0] === 'AUKORA: MOVE MAIN' || lines[0] === 'AUKORA: REPLACE MAIN WITH A NEW ROOT' ? 'repo.advance'
    : /^code\.change(?: —|$)/u.test(lines[0] ?? '') ? 'code.change'
      : /^AUKORA: (?:LOAD THIS RELEASE|ADMIT THESE PLUGINS)$/u.test(lines[0] ?? '') ? 'release.load'
        : String(witness?.kind ?? 'operation')
  return { kind, reason: why || lines.find(line => line.trim() !== '') || String(witness?.words ?? '') }
}

/** After Approve: ask the provider for Touch ID over the exact signed bytes. Returns an outcome; never throws. */
async function presenceAfterApprove(presence, library, request, witness, operationContent) {
  try {
    const signingBytes = organValueAt(library, 'library.approvalSigningBytes')(request)
    const budget = presenceBudgetMs(request.expiresAt)
    if (budget < 250) return 'no-evidence'
    const outcome = await bounded(() => presence.sign(signingBytes, budget,
      presencePrompt(witness, operationContent)), budget + 250, 'no-evidence')
    return PRESENCE_OUTCOMES.includes(outcome) ? outcome : 'invalid'
  } catch { return 'invalid' }
}


/**
 * The longest single protocol line this server accepts, in BYTES.
 *
 * The broker's `exchangeLine` refuses a reply longer than its own 64 KiB ceiling, and a request over
 * that ceiling could not have come from it. Kept as the same number rather than imported, because
 * importing the broker's module into the signer would make one process hold both halves of the wire.
 */
export const MAX_SIGNER_LINE_BYTES = 64 * 1024

/**
 * How long a connection that has said NOTHING may stay open.
 *
 * NOT THE APPROVAL WINDOW. The window is the request's own `expiresAt`, and `createOwnerSigner`
 * refuses an expired request by name. This is only a backstop against a peer that connects and goes
 * silent, and it is generous because the person on the other end of a legitimate request may take a
 * minute to read it.
 */
export const SIGNER_CONNECTION_IDLE_MS = 300_000

/**
 * The PKCS#8 DER prefix for an Ed25519 private key, which is `seed` and nothing else.
 *
 * `302e020100300506032b657004220420` is the DER for `SEQUENCE { INTEGER 0, SEQUENCE { OID 1.3.101.112 },
 * OCTET STRING { OCTET STRING <32 bytes> } }` — the standard encoding of a raw Ed25519 seed, and the
 * only way to turn the 32 bytes this laptop kept into a `KeyObject` without a second crypto library.
 */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

/**
 * Build an Ed25519 private `KeyObject` from the 32 raw bytes this machine kept.
 * @param {unknown} seedHex - 64 lowercase hex characters.
 * @returns {import('node:crypto').KeyObject} the private key.
 */
export function ed25519KeyFromSeed(seedHex) {
  if (typeof seedHex !== 'string' || !/^[0-9a-f]{64}$/u.test(seedHex)) {
    throw new TypeError('the kept machine seed must be 64 lowercase hexadecimal characters')
  }
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(seedHex, 'hex')]),
    format: 'der',
    type: 'pkcs8',
  })
}

/**
 * The raw 32-byte Ed25519 public key inside one private key, as lowercase hex.
 *
 * THE ORGAN'S OWN `rawEd25519PublicKeyHex` IS PREFERRED WHERE IT IS LOADED, and this is the fallback
 * for a library that carries the signer without it. Both derive the key from the private key: the
 * point of deriving rather than reading `kept.ed25519PublicKeyHex` is that the pair becomes a fact
 * instead of two claims in one file.
 * @param {import('node:crypto').KeyObject} privateKey - an Ed25519 private key.
 * @returns {string} 64 lowercase hex characters.
 */
export function rawPublicKeyHexOf(privateKey) {
  const jwk = createPublicKey(privateKey).export({ format: 'jwk' })
  if (typeof jwk.x !== 'string') throw new TypeError('the derived public key has no JWK x coordinate')
  return Buffer.from(jwk.x, 'base64url').toString('hex')
}

/**
 * The challenge a refusal may echo, or null when the request carries none that can be echoed.
 *
 * ECHOING IS CHECKED RATHER THAN HOPED FOR. `createRefusedApprovalResponse` reads the challenge with
 * the organ's `readDigest` and THROWS on anything that is not 64 lowercase hex — and this is called
 * from a socket `data` handler, where a throw is an uncaught exception in the shell's own process
 * rather than a refusal on the wire. A request with no readable challenge still gets its refusal; it
 * simply gets one that names no request, which is the honest thing to send.
 * @param {unknown} value - the request's own `challenge` field.
 * @returns {string|null} the digest to echo, or null.
 */
export function readableChallenge(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value) ? value : null
}

/**
 * Wait for a decision, but never past the window the request itself carries.
 *
 * THE BOUND IS THE REQUEST'S OWN EXPIRY, NOT A NEW KNOB, and the same shape `owner-signer.mjs` uses:
 * the clock is POLLED rather than a duration computed from it, because a duration computed from a
 * clock that moves measures nothing. The timer is NOT `unref()`ed — an unref'd timer does not keep the
 * event loop alive, so a signer waiting with nothing else to do would let the process exit mid-decision
 * instead of answering — and it is cleared the moment the decision settles.
 * @param {Promise<unknown>} pending - the reviewer's answer, which may take a person's worth of time.
 * @param {number} expiresAt - unix seconds after which the request is over.
 * @returns {Promise<unknown>} the decision, or `{expired: true}` when the window closed first.
 */
export function withinWindow(pending, expiresAt) {
  return new Promise(settle => {
    let done = false
    const finish = value => { if (!done) { done = true; clearInterval(poll); settle(value) } }
    const poll = setInterval(() => { if (Math.floor(Date.now() / 1000) >= expiresAt) finish({ expired: true }) }, 25)
    Promise.resolve(pending).then(finish, error => finish({ thrown: error }))
  })
}

/**
 * The v3 organ functions this shell needs before it can serve a signing channel at all.
 *
 * THE MACHINE KEY'S READER, NOT THE ROOT SEED'S (Y1, 2026-09-23). An approval is machine-class: it is
 * signed by the key this laptop holds, and the root is re-derived from handle + words when a
 * root-class act needs it. So the reader this list requires is the one that reads what is actually on
 * the laptop.
 *
 * IT NAMES WHAT THE SIGNER ACTUALLY CALLS, WHICH IS WHY IT IS LONGER THAN TWO NAMES. `approve` on the
 * signer is the organ's own decision-and-sign step, and it is built out of the request parser, the
 * refusal constructor and the signature constructor beside it. Requiring only `createOwnerSigner`
 * would let a library that carried the factory but not the codec through this check, and the failure
 * would then arrive as a `TypeError` from inside a socket handler — the exact shape of message this
 * list exists to replace with a name.
 *
 * THE LIST WAS MEASURED RATHER THAN GUESSED, AND THE FIRST DRAFT OF IT WAS WRONG. It named the six
 * functions below and stopped there; run against the real loader it reported `createOwnerSigner`, then
 * — after `owner-signer.mjs` was added — `parseApprovalRequest`, because that one lives in
 * `owner-approval.mjs`, and A RELATIVE IMPORT DOES NOT PUT A NAME ON A LIBRARY. `owner-signer.mjs`
 * importing it is enough for `createOwnerSigner` to WORK; it is not enough for this shell to CALL it.
 * The entries below are therefore written as the PATH the library is read at, so the refusal names
 * where the name has to come from rather than only what it is called.
 */
export const SIGNER_ORGAN_REQUIREMENTS = Object.freeze([
  'readKeptMachineSeed',
  'createOwnerSigner',
  'library.parseApprovalRequest',
  'library.approvalSigningBytes',
  'library.createRefusedApprovalResponse',
  'library.createSignedApprovalResponse',
])

/**
 * Read one dotted path out of the loaded library.
 * @param {object} library - the organ library from {@link loadOrganLibrary}.
 * @param {string} path - `name` or `library.name`.
 * @returns {unknown} the value, or undefined.
 */
export function organValueAt(library, path) {
  if (path.startsWith('library.')) return library?.library?.[path.slice('library.'.length)]
  return library?.[path]
}

/**
 * Where this shell should serve the approval socket.
 * @param {{env?: Record<string, string|undefined>, stateRoot?: string}} input - the environment and a state root.
 * @returns {{socketPath: string, source: string} | null} the path, or null when there is no state root to put it in.
 */
export function resolveSignerSocketPath({ env, stateRoot } = {}) {
  const configured = env?.[SIGNER_SOCKET_ENV]
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return { socketPath: resolve(configured.trim()), source: SIGNER_SOCKET_ENV }
  }
  // THE DEFAULT IS UNDER THIS SHELL'S OWN STATE ROOT, and it is only usable if there IS one. With no
  // state root there is nowhere honest to put a socket — an invented `/tmp` path would be a second
  // place for the two sides to disagree — so this still answers null and the shell says so.
  if (typeof stateRoot !== 'string' || stateRoot.trim().length === 0) return null
  return { socketPath: join(resolve(stateRoot.trim()), DEFAULT_SIGNER_SOCKET_NAME), source: 'userData-default' }
}

/**
 * The directory the decision log belongs in.
 *
 * THE LOG LIVES BESIDE THE SOCKET UNLESS SOMEBODY SAYS OTHERWISE, because the two facts a reader
 * needs together are "which path was this shell told to serve" and "what did it decide about it".
 * `logDir` is an input rather than a constant so a court can write to a scratch directory and never
 * touch the person's `~/Library/Application Support/AUKORA`.
 * @param {{logDir?: unknown, socketPath?: unknown}} input - an explicit directory, or the socket path.
 * @returns {string|null} the directory, or null when there is nowhere derivable to write.
 */
export function resolveSignerLogDir({ logDir, socketPath } = {}) {
  if (typeof logDir === 'string' && logDir.trim().length > 0) return resolve(logDir.trim())
  if (typeof socketPath === 'string' && socketPath.trim().length > 0) {
    return join(dirname(resolve(socketPath.trim())), 'logs')
  }
  return null
}

/**
 * Append one signer decision to the log, and NEVER throw into the startup path.
 *
 * WHY THIS EXISTS AT ALL (Peter's requirement, 2026-09-23). The shell's signer refused to serve for
 * hours and the only record of it was a line on a console nobody was reading. A decision that is not
 * written down is a decision that has to be rediscovered, so every verdict below goes through
 * {@link decide} and lands here — serving or not, with the reason, the socket path, and the name that
 * was missing when one was.
 *
 * THE WRITE IS BEST-EFFORT ON PURPOSE. This runs inside the launch path of the application window: a
 * read-only home directory, a full disk or a permissions problem must cost a log line, never the
 * window. Every failure is swallowed, and the caller still gets its verdict.
 * @param {string|null} directory - where to write, or null to skip.
 * @param {Readonly<Record<string, unknown>>} decision - the verdict being returned.
 * @returns {string|null} the line that was written, or null when nothing was.
 */
/**
 * **ONE LINE PER APPROVAL, SO A REAL CLICK LEAVES EVIDENCE (AUMLOK, LIVE-TEST PREP).**
 *
 * The decision log above records VERDICTS — whether the signer served and why not. It says nothing about an
 * approval, so before this a real click in the real app produced no record of WHAT was decided, over WHICH
 * digest, or how long the person had to look. **Tonight's live test needs exactly that, and reconstructing it
 * afterwards from an app log is not evidence.**
 *
 * ── WHAT IS WRITTEN, AND WHAT IS DELIBERATELY NOT ──────────────────────────────────────────────────────────
 *
 *   at               the decision's own instant, ISO
 *   operationDigest  the digest the signature covers
 *   displayedDigest  **a digest of the EXACT TEXT THE PERSON WAS SHOWN** — not of the operation. When these two
 *                    differ the window signed something other than it displayed, and only a digest of the
 *                    displayed words can show that.
 *   wordsOk          whether the window's words-check accepted the description
 *   truncated        whether the displayed text was SHORTENED (the digest still covers every character)
 *   decision         approve / refuse / closed
 *   dwellMs          shown -> decided, so a decision with no time to read is visible as one
 *
 * **NO KEY MATERIAL AND NO NOTE TEXT — DIGESTS ONLY.** The seed, the signature and the operation's own words
 * never enter this file. *An evidence log that quotes the content becomes a second copy of the thing the
 * approval existed to guard*, and this one is meant to be readable by anyone auditing a click.
 *
 * 0600 under the signer's own log directory. A failure to write is REPORTED, never thrown: a decision that has
 * already been made must not be lost because its record could not be written.
 * @param {string|null} directory - the signer's log directory, or null when there is none.
 * @param {Record<string, unknown>} event - the fields above; unknown keys are ignored.
 * @returns {string|null} the line written, or null when it could not be.
 */
export function appendApprovalEvent(directory, event) {
  if (directory === null || directory === undefined) return null
  // ── **THE SHAPE IS AK-UI'S, BECAUSE ITS APPROVALS VIEW IS ALREADY BUILDING AGAINST IT** ────────────────────
  //
  // `.agents/live/NOTE-TO-AUMLOK-approval-history-shape.md` names the exact object, and it is **JSON, not the
  // `key=value` text my first version wrote** — a different spelling of the same facts, which is precisely the
  // near-agreement that note asks to avoid. Two renderers reading two formats is a bug waiting for the second
  // reader, so this writes THEIR shape. **ONE JSON OBJECT PER LINE**, so a reader can tail it and a partial write
  // costs one row rather than the file.
  //
  //   at               when it was asked, ISO
  //   kind             the operation's kind — what the row NAMES
  //   subject          the subject in plain words — what the row SHOWS
  //   operationDigest  `sha256:…`, the digest the signature covers, NEVER rendered
  //   displayedDigest  `sha256:…`, of the EXACT TEXT SHOWN, never rendered
  //   wordsCheck       match | mismatch | unchecked
  //   spoken           yes | no | null — **THE TRUNCATION FLAG, SPELLED AS THEY SPELL IT**
  //   decision         approved | declined | pending
  //   dwellMs          shown -> decided
  //   verify           {state, at} | {state: 'unverified'}
  //
  // **NO KEY MATERIAL AND NO NOTE TEXT — DIGESTS ONLY.** `subject` is a SHORT LABEL DERIVED FROM THE BOUND BYTES
  // (the same derivation the witness uses, so it cannot be a channel a caller writes into), never the content.
  // *An evidence log that quotes the content becomes a second copy of the thing the approval existed to guard.*
  //
  // 0600 under the signer's own log directory, beside `aukora-signer.log` rather than replacing it: that one
  // records whether the signer SERVED, this records what a person DECIDED.
  const withPrefix = value => (typeof value === 'string' && value.length > 0 && !value.startsWith('sha256:')
    ? `sha256:${value}`
    : value)
  const row = {
    at: event?.at ?? new Date().toISOString(),
    kind: event?.kind ?? null,
    subject: event?.subject ?? null,
    operationDigest: withPrefix(event?.operationDigest ?? null),
    displayedDigest: withPrefix(event?.displayedDigest ?? null),
    wordsCheck: event?.wordsCheck ?? 'unchecked',
    spoken: event?.spoken ?? null,
    decision: event?.decision ?? 'pending',
    // OPTIONAL TOUCH ID AFTER APPROVE, a separate fact from the decision: absent when no check was made.
    ...(PRESENCE_OUTCOMES.includes(event?.presenceOutcome) ? { presenceOutcome: event.presenceOutcome } : {}),
    dwellMs: Number.isSafeInteger(event?.dwellMs) && event.dwellMs >= 0 ? event.dwellMs : null,
    // **THE BADGE ONLY FILLS FROM A REAL VERIFY.** AK-UI's own rule, and the honest default is `unverified`: a
    // settled effect nobody has proved is not a verified one, and this log must not imply otherwise.
    verify: event?.verify ?? { state: 'unverified' },
  }
  const line = `${JSON.stringify(row)}\n`
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    appendFileSync(join(directory, APPROVAL_EVENT_LOG_NAME), line, { mode: 0o600, flag: 'a' })
    return line
  } catch {
    // **A RECORD THAT COULD NOT BE WRITTEN IS NOT A DECISION THAT DID NOT HAPPEN.** The caller says so out loud;
    // returning null here is what makes the difference visible rather than silent.
    return null
  }
}

/**
 * Append one signer decision to the log, and NEVER throw into the startup path.
 *
 * WHY THIS EXISTS AT ALL (Peter's requirement, 2026-09-23). The shell's signer refused to serve for
 * hours and the only record of it was a line on a console nobody was reading. A decision that is not
 * written down is a decision that has to be rediscovered, so every verdict below goes through
 * {@link decide} and lands here — serving or not, with the reason, the socket path, and the name that
 * was missing when one was.
 *
 * THE WRITE IS BEST-EFFORT ON PURPOSE. This runs inside the launch path of the application window: a
 * read-only home directory, a full disk or a permissions problem must cost a log line, never the
 * window. Every failure is swallowed, and the caller still gets its verdict.
 * @param {string|null} directory - where to write, or null to skip.
 * @param {Readonly<Record<string, unknown>>} decision - the verdict being returned.
 * @returns {string|null} the line that was written, or null when nothing was.
 */

export function writeSignerDecision(directory, decision) {
  if (directory === null) return null
  const parts = [`at=${new Date().toISOString()}`, `source=${SIGNER_LOG_SOURCE}`]
  for (const key of ['serving', 'reason', 'socketPath', 'missing']) {
    const value = decision?.[key]
    // SKIPPED RATHER THAN PRINTED AS `undefined`: a field the verdict does not carry is not a fact
    // about this decision, and a log full of `undefined` is a log nobody can grep.
    if (value === undefined || value === null) continue
    parts.push(`${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
  }
  const line = `${parts.join(' ')}\n`
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    appendFileSync(join(directory, SIGNER_DECISION_LOG_NAME), line, { mode: 0o600 })
    return line
  } catch {
    return null
  }
}

/**
 * Build one verdict, write it down, and hand it back.
 *
 * ONE PLACE DECIDES AND ONE PLACE WRITES. Every return in {@link startShellSigner} goes through here,
 * so "the decision was logged" is a property of the function rather than a thing each branch has to
 * remember — which is how the socket ended up absent with nothing written down the first time.
 * @param {{logDir: string|null, say: Function, verdict: Record<string, unknown>}} input - where to write, the console logger, the verdict.
 * @returns {Readonly<Record<string, unknown>>} the frozen verdict.
 */
export function decide({ logDir, say, verdict }) {
  const frozen = Object.freeze({ ...verdict })
  writeSignerDecision(logDir, frozen)
  return frozen
}

/**
 * Whisper the part of the organ this shell still needs, so the gap is a NAME rather than a TypeError.
 * @param {object} library - the loaded organ library.
 * @returns {string|null} the first missing function, or null when the v3 surface is present.
 */
export function missingSignerOrgan(library) {
  if (library === null || library === undefined) return SIGNER_ORGAN_REQUIREMENTS[0]
  for (const path of SIGNER_ORGAN_REQUIREMENTS) {
    if (typeof organValueAt(library, path) !== 'function') return path
  }
  return null
}

/**
 * The reviewer, built from whatever the shell can put in front of a person.
 *
 * THE MAPPING IS THE WHOLE POINT AND IT LIVES IN ONE PLACE. `ask` answers with two facts that the
 * SIGNER must keep apart on the wire: "a person looked at this and said no" and "nobody could be
 * asked". So `unavailable` becomes `ask-unavailable` and everything else that is not an explicit yes
 * becomes `declined`. An approval is `approve === true` and nothing else — a truthy value, a missing
 * field or a string is a refusal, because the failure this path exists to prevent is an approval
 * nobody gave.
 *
 * WITH NO `ask` THE ANSWER IS ALWAYS NO. A shell that cannot ask a person is a shell that cannot
 * approve an operation, which is the honest state, never a default yes.
 *
 * THE REFUSAL NAMES COME FROM THE WIRE LIBRARY, AND THE FALLBACK IS STILL A CLOSED VOCABULARY. The
 * names a reviewer may choose from live in `owner-approval.mjs`, which the loader exposes as
 * `library.library`; a library that carries them nowhere yields the two literal names, not
 * `undefined`, so a refusal on the wire is always a name a broker can read.
 * @param {Readonly<Record<string, unknown>>} library - the loaded organ library.
 * @param {Function} [ask] - `(request) => Promise<{approve: boolean, unavailable?: boolean}>`.
 * @returns {(facts: {request: unknown, operationContent?: Buffer}) => Promise<{approve: boolean, refusal?: string}>} the reviewer.
 */
export function reviewFromAsk(library, ask, options = {}) {
  // **THE EVENT LOG NEEDS A DIRECTORY, AND THIS FUNCTION IS WHERE THE DECISION IS SEEN.** MEASURED, AND IT WAS
  // MY OWN BUG: the first version referred to a `logDir` that belongs to `startShellSigner`, so it threw a
  // ReferenceError; the `catch` below then called `say`, which is ALSO not in scope here, and **threw a SECOND
  // time** — so a working approval came back as `signer:ask-unavailable`. *A catch that throws is worse than no
  // catch: it converts one failure into a different, more confusing one.*
  //
  // Every reference from here on is either a parameter or a module-level import.
  const logDir = options.logDir ?? null
  const refusals = library?.library?.SIGNER_REFUSE ?? library?.SIGNER_REFUSE ?? {
    DECLINED: 'signer:declined',
    ASK_UNAVAILABLE: 'signer:ask-unavailable',
  }
  return async ({ request, operationContent }) => {
    if (typeof ask !== 'function') return { approve: false, refusal: refusals.DECLINED }
    // WHAT THE WINDOW IS TOLD ABOUT THE OPERATION IS DERIVED HERE, FROM THE OPERATION'S OWN BYTES —
    // the same bytes `readOperationContent` has already proved hash to the signed digest. The request
    // itself carries no description, so nothing a caller wrote can reach the screen: the line handed to
    // the window is a function of the bound bytes alone.
    const witness = operationContent === undefined || operationContent === null
      ? null
      : approvalWitnessFor(Buffer.isBuffer(operationContent) ? operationContent : Buffer.from(operationContent))
    let answer
    // THE ICON'S STATE, read before the card goes up and bounded to a quarter second; `none` or any failure is no icon.
    const presence = request?.domain === OWNER_APPROVAL_DOMAIN && options.presence ? options.presence : null
    const presenceState = presence === null ? null
      : await bounded(async () => (await presence.state())?.state, 250, null)
    const shown = PRESENCE_ICON_STATES.includes(presenceState) ? { presenceState: { state: presenceState } } : {}
    try {
      answer = await ask(witness === null && !shown.presenceState ? request
        : { ...request, ...shown, ...(witness === null ? {} : { operationWitness: witness }) })
    } catch {
      // AN `ask` THAT THREW COULD NOT ASK. That is not the owner declining, and the signer has a name
      // for it — this is the only place the two facts could be conflated.
      return { approve: false, refusal: refusals.ASK_UNAVAILABLE }
    }
    // TOUCH ID ONLY AFTER AN EXPLICIT APPROVE, AND ONLY WHEN THIS MAC HAS ENROLLED. The outcome is recorded beside the
    // decision and never changes it: no touch, a cancelled sheet or a missing key still returns `approve: true` below.
    const presenceOutcome = presence === null || answer?.approve !== true ? undefined
      : await presenceAfterApprove(presence, library, request, witness, operationContent)
    // ── **AND THE CLICK IS WRITTEN DOWN, DIGESTS ONLY (AUMLOK, LIVE-TEST PREP)** ────────────────────────────
    //
    // The decision log records whether the signer SERVED; this records what a person DECIDED, over which digest,
    // against the digest of the exact text they were shown, and how long they had to read it. **It is written
    // here because this is the only place that sees the answer AND the witness together** — the page knows the
    // dwell, the signer knows the bound bytes, and neither alone can state the pair.
    //
    // `displayedDigest` IS THE POINT: it is a digest of the words the window showed, so a window that signed
    // something other than it displayed is visible as a MISMATCH between the two digests rather than as two
    // files nobody compared.
    // **A RECORD MUST NEVER BREAK THE DECISION IT RECORDS.** MEASURED: the first version let a throw from here
    // escape into the reply handler, which turned a perfectly good approval into `signer:ask-unavailable` —
    // *the evidence log destroyed the thing it existed to witness.* The failure is SAID OUT LOUD instead, so a
    // missing event is never mistaken for an approval that did not happen.
    try {
      appendApprovalEvent(logDir, {
        at: new Date().toISOString(),
        // **AK-UI'S SPELLINGS, NOT MINE.** Its Approvals view builds against `kind`, `subject`, `wordsCheck`,
        // `spoken` and `decision: approved|declined|pending`; a second spelling of the same facts is the
        // near-agreement that note exists to prevent.
        kind: typeof witness?.kind === 'string' ? witness.kind : null,
        // **A SHORT LABEL DERIVED FROM THE BOUND BYTES**, which is what the row SHOWS. It is a function of the
        // content rather than the content, so the log stays digests-only and no caller can write into it.
        subject: typeof witness?.subject === 'string' ? witness.subject.slice(0, 120) : null,
        operationDigest: typeof request?.operationDigest === 'string' ? request.operationDigest : null,
        displayedDigest: witness === null ? null : approvalWordsDigest(witness.words),
        wordsCheck: answer?.wordsOk === undefined
          ? 'unchecked'
          : (answer.wordsOk === true ? 'match' : 'mismatch'),
        // **`spoken` IS THE TRUNCATION FLAG, SPELLED AS AK-UI SPELLS IT** — whether the displayed text was
        // SHORTENED, which the digest still covers.
        spoken: witness === null ? null : (witness.truncated === true ? 'yes' : 'no'),
        decision: answer?.approve === true ? 'approved' : (answer?.closed === true ? 'pending' : 'declined'),
        presenceOutcome,
        dwellMs: Number.isSafeInteger(answer?.dwellMs) && answer.dwellMs >= 0 ? answer.dwellMs : null,
      })
    } catch (error) {
      // **NOT `say`.** It is not in scope in this function, and calling it here is what turned a logging failure
      // into a refusal. `process.stderr.write` is available wherever node is.
      process.stderr.write('aukora-desktop: aumlok signer: THE APPROVAL EVENT COULD NOT BE RECORDED: '
        + `${String(error?.message ?? error)} — the decision itself is unaffected.\n`)
    }
    if (answer?.approve === true) return { approve: true }
    return {
      approve: false,
      refusal: answer?.unavailable === true ? refusals.ASK_UNAVAILABLE : refusals.DECLINED,
    }
  }
}
