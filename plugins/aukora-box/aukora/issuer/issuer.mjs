/**
 * The issuer daemon: the only AUKORA module that intentionally loads the root
 * private key.
 *
 * Runs OUTSIDE the Harness process. The 8088 application receives neither the
 * key nor a key path through this protocol. A same-uid process can still read
 * an externally provisioned 0600 file, so key exclusion depends on the planned
 * separate-principal deployment rather than this module alone. The Harness's
 * trusted answerer bridge reaches this daemon over a local Unix socket. Two
 * routes share that socket: the legacy route takes an operation and its
 * arguments, renders that operation to a human, and mints a v3 grant; the
 * digest route takes only an authorization digest, shows the human that digest
 * and nothing else, and returns a signature over the tagged v4 message; the
 * live proposal route adds the approval artifact and its digest to authorize,
 * renders that artifact, and still signs the admitted v4 digest. The default
 * broker-owned proposal route is its product caller. The legacy route is the
 * subject of the WYSIWYS courts; the two-field digest route is explicitly not
 * WYSIWYS; the four-field artifact authorize still cannot prove the signed
 * digest covers that artifact. Every
 * request is re-validated here: an issuer that minted whatever it was handed
 * would be a signing oracle. The legacy route admits only the exact own
 * enumerable `{ key, value }` argument set and the shared key grammar. The v4
 * route admits only a previously registered authorization digest.
 *
 * Launch (the non-root issuer owns an exact non-link root-key file at mode
 * 0600 or stricter; the Ed25519 key is read once through its checked
 * descriptor and never exported):
 *
 *   AUKORA_ISSUER_SOCKET=/run/aukora/issuer.sock \
 *   AUKORA_ISSUER_KEY_FILE=/etc/aukora/root.pem \
 *   AUKORA_EXPECTED_RECEIPT_KEY_ID=<sha256-of-broker-spki> \
 *   AUKORA_ISSUER_SOCKET_GROUP_ACCESS=1 \
 *   node aukora/issuer/issuer.mjs
 *
 * The socket protocol accepts one nonblank newline-delimited request per
 * connection. Additional or oversized request bytes abort the active ask,
 * produce one terminal reply, and close the connection.
 * Startup exclusively creates `<socket>.lock` and never removes a pre-existing
 * socket or lease. Cleanup checks entry identities before requesting removal,
 * but pathname cleanup is not atomic against a same-uid replacement and the
 * underlying server close may unlink its bound pathname. An unclean exit
 * requires operator recovery after verifying that the previous issuer is dead.
 *
 * @module @aukora/issuer
 */
import { createServer } from 'node:net'
import { createPrivateKey, createPublicKey, randomBytes, sign as edSign } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { mintGrant } from './mint.mjs'
import { buildOperation, operationDigest } from '../broker/operation.mjs'
import { isExactMemoryPutArgs, KEY_SHAPE } from '../broker/memory-put-args.mjs'
import { renderOperation } from '../broker/review.mjs'
import {
  REFUSE_APPROVAL,
  approvalArtifactDigest,
  approvalRefusalReason,
  approvalSignedMessage,
  verifyApprovalArtifact,
} from '../approval/artifact.mjs'
import { renderApprovalArtifact } from '../approval/render.mjs'
import { openApprovalCarrier } from './approval-carrier.mjs'
import { APPROVAL_OUTCOME, createApprovalChannel, isSigningOutcome } from '../approval/occurrence.mjs'
import { MAX_TTL_SECONDS, authorizationSignedMessageFromHex, verifyIssuedGrant } from '../host-dsh/src/grant.mjs'
import { authorizationSignedMessageV5FromHex } from '../host-dsh/src/grant-v5.mjs'

const socketPath = process.env.AUKORA_ISSUER_SOCKET ?? ''
const keyFile = process.env.AUKORA_ISSUER_KEY_FILE ?? ''
const expectedReceiptKeyId = process.env.AUKORA_EXPECTED_RECEIPT_KEY_ID ?? ''
const socketGroupAccessValue = process.env.AUKORA_ISSUER_SOCKET_GROUP_ACCESS
const leasePath = `${socketPath}.lock`
const { O_CREAT, O_EXCL, O_NOFOLLOW, O_RDONLY, O_WRONLY } = constants

function fail(message) {
  console.error(`issuer: ${message}`)
  process.exit(1)
}

if (!socketPath) fail('AUKORA_ISSUER_SOCKET is required')
if (!keyFile) fail('AUKORA_ISSUER_KEY_FILE is required')
if (!/^[0-9a-f]{64}$/.test(expectedReceiptKeyId)) fail('AUKORA_EXPECTED_RECEIPT_KEY_ID must be a sha256 hex key identity')
if (socketGroupAccessValue !== undefined && socketGroupAccessValue !== '1') {
  fail('AUKORA_ISSUER_SOCKET_GROUP_ACCESS must be 1 when present')
}
if (process.geteuid() === 0) fail('issuer must not run as root')
const socketGroupAccess = socketGroupAccessValue === '1'

/** Read the root secret once through the descriptor whose type and mode were checked. */
function readRootKeyFile(path) {
  let descriptor
  try {
    descriptor = openSync(path, O_RDONLY | O_NOFOLLOW)
  } catch {
    throw new Error('root key file must be an exact regular file opened without following links')
  }
  try {
    const entry = fstatSync(descriptor)
    if (!entry.isFile()) {
      throw new Error('root key file must be an exact regular file opened without following links')
    }
    if (entry.uid !== process.geteuid()) {
      throw new Error('root key file must be owned by the issuer euid')
    }
    if ((entry.mode & 0o077) !== 0) {
      throw new Error('root key file must have mode 0600 or stricter')
    }
    return readFileSync(descriptor, 'utf8')
  } finally {
    closeSync(descriptor)
  }
}

/** Create or validate the immediate owner-held directory that names the Unix socket. */
function prepareSocketDirectory(path, groupAccess) {
  const directory = dirname(path)
  let created = false
  try {
    mkdirSync(directory, { mode: groupAccess ? 0o710 : 0o700 })
    created = true
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      throw new Error('socket parent must have an existing parent and be an exact directory')
    }
  }
  let entry
  try {
    entry = lstatSync(directory)
  } catch {
    throw new Error('socket parent must be an exact directory')
  }
  if (!entry.isDirectory()) throw new Error('socket parent must be an exact directory, not a link or other entry')
  if (entry.uid !== process.geteuid()) throw new Error('socket parent must be owned by the issuer euid')
  if (groupAccess) {
    if (typeof process.getegid !== 'function' || entry.gid !== process.getegid()) {
      throw new Error('shared socket parent must be owned by the issuer effective group')
    }
    if (created) chmodSync(directory, 0o710)
    entry = lstatSync(directory)
    if ((entry.mode & 0o777) !== 0o710) {
      throw new Error('shared socket parent must have mode 0710')
    }
  } else if ((entry.mode & 0o077) !== 0) {
    throw new Error('socket parent must have mode 0700 or stricter')
  }
}

function identityOf(entry) {
  return { dev: entry.dev, ino: entry.ino }
}

/** Remove only the exact entry this process created. */
function unlinkOwnedEntry(path, identity, acceptsType) {
  try {
    const entry = lstatSync(path)
    if (entry.dev !== identity.dev || entry.ino !== identity.ino || !acceptsType(entry)) return false
    unlinkSync(path)
    return true
  } catch (error) {
    return error?.code === 'ENOENT'
  }
}

/**
 * Acquire a lifetime marker before examining the socket path.
 *
 * A marker left by an unclean exit is intentionally not auto-recovered: the
 * new process cannot distinguish a stale marker from a still-live issuer.
 */
function acquireLease(path) {
  let descriptor
  let identity = null
  try {
    descriptor = openSync(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
    const entry = fstatSync(descriptor)
    if (!entry.isFile() || (entry.mode & 0o077) !== 0) throw new Error('issuer lease is not an owner-only regular file')
    identity = identityOf(entry)
    writeFileSync(descriptor, `${process.pid}\n`, 'utf8')
    return { descriptor, identity }
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor)
    if (identity !== null) unlinkOwnedEntry(path, identity, (entry) => entry.isFile())
    if (error?.code === 'EEXIST') {
      throw new Error('issuer lease already exists; stale and live owners are not guessed apart')
    }
    throw new Error(`issuer lease could not be acquired exclusively (${String(error?.message ?? error)})`)
  }
}

function releaseLease(lease) {
  try {
    closeSync(lease.descriptor)
  } catch {
    // The descriptor has one owner and cleanup still verifies the path identity.
  }
  return unlinkOwnedEntry(leasePath, lease.identity, (entry) => entry.isFile())
}

let rootPrivateKey
let rootPublicKeyPem
try {
  rootPrivateKey = createPrivateKey(readRootKeyFile(keyFile))
  if (rootPrivateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('root private key must be Ed25519')
  }
  rootPublicKeyPem = createPublicKey(rootPrivateKey).export({ type: 'spki', format: 'pem' }).toString()
  prepareSocketDirectory(socketPath, socketGroupAccess)
} catch (error) {
  fail(String(error?.message ?? error))
}

/** A failed approval-channel connection must not leave an issuer lifetime lease. */
let approvalCarrier
try {
  approvalCarrier = await openApprovalCarrier()
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

let issuerLease
try {
  issuerLease = acquireLease(leasePath)
  try {
    lstatSync(socketPath)
    throw new Error('socket path already exists; issuer will not unlink an unowned entry')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
} catch (error) {
  if (issuerLease !== undefined) releaseLease(issuerLease)
  approvalCarrier.close()
  fail(String(error?.message ?? error))
}

/**
 * The issuer's own WYSIWYS render: the human sees the exact content-addressed
 * object-body bytes plus fixed operation fields, rendered by THIS process from
 * the raw arguments, never by the untrusted harness. The projection write and
 * broker-owned intent, receipt, and Aura operations are not represented as
 * part of this object body.
 *
 * The body comes from the shared renderer in `@aukora/broker/review.mjs`,
 * byte-identical to the untrusted preview. Its `effectBodyUtf8` field is one
 * JSON string literal that decodes to the canonical JSON object and terminal
 * newline hashed and written at the content-addressed object location. Every
 * non-ASCII code point remains escaped inside that literal. The fixed
 * operation fields and operation digest remain visible beside those exact
 * object-body bytes.
 * @param {import('../broker/operation.mjs').Operation} operation - the exact operation about to be signed.
 * @param {{key: string, value: unknown}} args - the arguments the operation was built from.
 * @param {string} challenge - a fresh random value first disclosed by this prompt.
 * @param {string} receiptKeyId - the pinned settlement-key identity signed into the grant.
 * @returns {void}
 */
function renderOperationForHuman(operation, args, challenge, receiptKeyId) {
  const body = renderOperation(operation, args)
  const artifact = `${body}\nreceiptKeyId: ${receiptKeyId}`
    .split('\n')
    .map((line) => `  | ${line}`)
    .join('\n')
  approvalCarrier.write(`  +- MEMORY.WRITE ---------------------------------------------\n${artifact}\n  +- approve? type "yes ${challenge}": `)
}

/**
 * How long one prompt stays open. A SECURITY INVARIANT, not a deployment
 * tunable: it bounds how long the root key's holder blocks on a human, and a
 * caller that could lengthen it could hold the single approval slot open
 * against every other request.
 */
const APPROVAL_DEADLINE_MS = 30_000

/** The one prompt currently visible on the issuer-owned input channel. */
let _activeApproval = null

/** An issuer without an input carrier refuses immediately instead of waiting on dead stdin. */
let _approvalInputEnded = false

/** Complete-line framing scoped to the currently visible prompt. */
let _approvalInputBuffer = ''

/**
 * What actually happened at the prompt. A boolean cannot carry this: a timer
 * expiring, a carrier that ended, and a human typing the wrong answer are three
 * different events, and only one of them is a decision. Collapsing them let a
 * thirty-second timeout be recorded as `issuer:human-denied`.
 */
const APPROVAL = Object.freeze({
  APPROVED: 'approved',
  DENIED: 'denied',
  TIMED_OUT: 'timed-out',
  CANCELLED: 'cancelled',
  UNAVAILABLE: 'unavailable',
  BUSY: 'busy',
})

function settleActiveApproval(outcome) {
  if (_activeApproval === null) return
  const active = _activeApproval
  _activeApproval = null
  _approvalInputBuffer = ''
  clearTimeout(active.timer)
  active.signal?.removeEventListener('abort', active.onAbort)
  active.resolve(outcome)
}

approvalCarrier.onData((text) => {
  if (_activeApproval === null) {
    _approvalInputBuffer = ''
    if (text !== '') process.stderr.write('issuer:input-without-active-prompt-discarded\n')
    return
  }
  _approvalInputBuffer += text
  const cut = _approvalInputBuffer.indexOf('\n')
  if (cut === -1) return
  const line = _approvalInputBuffer.slice(0, cut)
  const answer = line.endsWith('\r') ? line.slice(0, -1) : line
  const trailing = _approvalInputBuffer.slice(cut + 1)
  // A prompt that installed a decider owns its own verdict: the artifact route
  // requires the answer to name one occurrence and one artifact digest, which
  // a bare string comparison cannot express. Prompts without a decider keep
  // the original comparison unchanged.
  const decided = _activeApproval.decide === undefined
    ? (answer === _activeApproval.expectedAnswer ? APPROVAL.APPROVED : APPROVAL.DENIED)
    : _activeApproval.decide(answer)
  if (decided !== APPROVAL.APPROVED) process.stderr.write('issuer:approval-answer-mismatch\n')
  settleActiveApproval(decided)
  if (trailing !== '') process.stderr.write('issuer:input-without-active-prompt-discarded\n')
})
approvalCarrier.onEnd(() => {
  _approvalInputBuffer = ''
  _approvalInputEnded = true
  settleActiveApproval(APPROVAL.UNAVAILABLE)
})

function readHumanApproval(signal, expectedAnswer, decide) {
  return new Promise((resolve) => {
    if (_approvalInputEnded) { resolve(APPROVAL.UNAVAILABLE); return }
    if (signal?.aborted === true) { resolve(APPROVAL.CANCELLED); return }
    const active = {
      resolve,
      expectedAnswer,
      decide,
      signal,
      onAbort: () => {
        if (_activeApproval === active) {
          process.stderr.write('issuer:approval-request-cancelled\n')
          settleActiveApproval(APPROVAL.CANCELLED)
        }
      },
      timer: setTimeout(() => {
        if (_activeApproval === active) settleActiveApproval(APPROVAL.TIMED_OUT)
      }, APPROVAL_DEADLINE_MS),
    }
    _activeApproval = active
    signal?.addEventListener('abort', active.onAbort, { once: true })
    if (signal?.aborted === true) active.onAbort()
  })
}

/**
 * The one approval slot, shared by every prompt kind. Holding both prompt
 * families on this single slot is what stops an operation prompt and a digest
 * prompt being visible at once, which would let an answer meant for one settle
 * the other.
 * @param {(challenge: string) => void} render - writes the prompt after the challenge exists.
 * @param {AbortSignal | undefined} signal - caller lifetime; disconnect cancels the prompt.
 * @param {((answer: string) => string) | undefined} [decide] - verdict for one raw answer line; absent means compare against the expected answer.
 * @returns {Promise<string>} one {@link APPROVAL} outcome.
 */
async function askHumanWith(render, signal, decide) {
  if (signal?.aborted === true) return APPROVAL.CANCELLED
  if (_approvalInputEnded) return APPROVAL.UNAVAILABLE
  if (_activeApproval !== null) return APPROVAL.BUSY
  _approvalInputBuffer = ''
  const challenge = randomBytes(8).toString('hex')
  const pending = readHumanApproval(signal, `yes ${challenge}`, decide)
  render(challenge)
  return pending
}

async function askHuman(operation, args, signal) {
  return askHumanWith((challenge) => { renderOperationForHuman(operation, args, challenge, expectedReceiptKeyId) }, signal)
}

/**
 * Render a v4 authorization digest for confirmation.
 *
 * THIS IS NOT WYSIWYS. The human confirms 64 hex characters and cannot read
 * the operation behind them; the whole point of the digest hop is that the
 * preimage never reaches this process. The banner says so on every prompt so
 * the limit is visible at the moment of the decision rather than in a
 * document. A route that needs the human to READ the operation must render it
 * somewhere the operation legitimately exists, which is a decision this
 * protocol deliberately does not make.
 *
 * @param {string} digest - the admitted authorization digest, hex.
 * @param {string} challenge - a fresh random value first disclosed by this prompt.
 * @returns {void}
 */
function renderDigestForHuman(digest, challenge) {
  // Only the digest and the challenge. receiptKeyId was displayed here and has
  // been removed: this process cannot establish that the opaque digest was
  // computed over that value, so showing it beside the digest implied a
  // relationship the issuer has no way to check.
  const artifact = [
    'DIGEST APPROVAL - the operation behind this digest is NOT shown',
    'and cannot be recovered from it. Confirm only if you know why',
    'this digest was admitted.',
    '',
    `authorizationDigest: ${digest}`,
  ].map((line) => `  | ${line}`).join('\n')
  approvalCarrier.write(`  +- AUTHORIZE DIGEST -----------------------------------------\n${artifact}\n  +- approve? type "yes ${challenge}": `)
}

async function askHumanForDigest(digest, signal) {
  return askHumanWith((challenge) => { renderDigestForHuman(digest, challenge) }, signal)
}

/** Display one independently re-derived approval artifact and collect the answer. */
async function askHumanForArtifact(artifact, signal) {
  return askHumanWith((challenge) => {
    approvalCarrier.write(`${renderApprovalArtifact(artifact, challenge)}`)
  }, signal)
}

/**
 * Route one parsed request to its handler by verb. Unknown verbs refuse by
 * name rather than falling through to a default handler.
 * @param {unknown} request - one parsed issuer protocol request.
 * @param {{signal?: AbortSignal}} [options] - caller lifetime.
 * @returns {Promise<Record<string, unknown>>} the handler's reply.
 */
async function handleIssuerRequest(request, options) {
  const op = request?.op
  if (op === 'admit') return handleAdmit(request)
  if (op === 'authorize') return handleAuthorize(request, options)
  if (op === 'admit.v5') return handleAdmitV5(request)
  if (op === 'authorize.v5') return handleAuthorizeV5(request, options)
  if (op === 'approve-artifact') return handleApproveArtifact(request, options)
  if (op === 'issue') return handleIssue(request, options)
  return { ok: false, reason: 'issuer:unknown-op' }
}

/** Hex form of an authorization digest. */
const AUTHORIZATION_DIGEST = /^[0-9a-f]{64}$/

/**
 * How many admitted digests may await an answer at once. A CEILING, not a
 * tunable: without it any party that can reach the admission route grows this
 * map without bound, and the issuer is the process holding the root key.
 */
const PENDING_MAX = 16

/**
 * How long an admitted digest survives without an answer. An admission is a
 * promise that a human will be asked soon; one that is never claimed is
 * abandoned rather than retained, so a stale admission cannot be authorized
 * long after the broker that made it has forgotten why.
 */
const PENDING_TTL_MS = 120_000

/** Digests admitted by the broker route and not yet answered. */
const _pending = new Map()

/** Separate equal raw digests admitted under distinct signed-message families. */
function pendingDigestKey(family, digest) {
  return `${family}:${digest}`
}

/** Drop admissions past their TTL. Called on every admission and authorization. */
function prunePending(now) {
  for (const [digest, entry] of _pending) {
    if (now - entry.admittedAt > PENDING_TTL_MS) _pending.delete(digest)
  }
}

/**
 * Register a digest the broker intends to have authorized. Admission creates
 * NO authority: it records that a specific 32-byte value may be put to a human
 * later, and nothing else. The separation matters because it is what makes
 * `issuer:digest-not-pending` a real refusal — without a pending table any
 * digest presented to {@link handleAuthorize} would be answerable, and the
 * route would sign whatever it was handed.
 *
 * @param {unknown} request - one parsed admission request.
 * @returns {Promise<Record<string, unknown>>} acknowledgement or a named refusal.
 */
async function handleAdmitForFamily(request, { op, family }) {
  if (request?.op !== op) return { ok: false, reason: 'issuer:unknown-op' }
  if (!Object.hasOwn(request, 'digest')) return { ok: false, reason: 'issuer:admit-digest-missing' }
  if (Object.keys(request).length !== 2) return { ok: false, reason: 'issuer:admit-extra-fields' }
  const digest = request.digest
  if (typeof digest !== 'string' || !AUTHORIZATION_DIGEST.test(digest)) {
    return { ok: false, reason: 'issuer:digest-malformed' }
  }
  // An admission is a promise that a human will be asked. With the input
  // carrier gone that promise cannot be kept, so it is refused now rather than
  // banked and answered with a denial nobody made.
  if (_approvalInputEnded) return { ok: false, reason: 'issuer:approval-unavailable' }
  const now = Date.now()
  prunePending(now)
  const pendingKey = pendingDigestKey(family, digest)
  if (_pending.has(pendingKey)) return { ok: false, reason: 'issuer:digest-already-pending' }
  if (_pending.size >= PENDING_MAX) return { ok: false, reason: 'issuer:pending-table-full' }
  _pending.set(pendingKey, { admittedAt: now, reviewing: false })
  return { ok: true }
}

/** Admit one v4 digest for later authorization. */
export async function handleAdmit(request) {
  return handleAdmitForFamily(request, { op: 'admit', family: 'v4' })
}

/** Admit one v5 digest for later authorization. */
export async function handleAdmitV5(request) {
  return handleAdmitForFamily(request, { op: 'admit.v5', family: 'v5' })
}

/**
 * Put an admitted digest to the human and, on approval, sign it.
 *
 * The reply is a transport envelope, not an authority object: it carries the
 * digest it answers and a signature over the tagged v4 message built from that
 * digest. The caller assembles the grant; this process never sees the claims
 * and never learns what it authorized.
 *
 * Only a decision consumes an admission. An approval and a denial spend it; a
 * timeout or a cancellation leave it claimable until its TTL, because nobody
 * decided anything; an absent input carrier deletes it, because no retry can
 * succeed. Only {@link APPROVAL.APPROVED} reaches the signing call.
 *
 * @param {unknown} request - one parsed authorization request.
 * @param {{signal?: AbortSignal}} [options] - caller lifetime; disconnect cancels the prompt.
 * @returns {Promise<Record<string, unknown>>} the signature envelope or a named refusal.
 */
async function handleAuthorizeForFamily(request, { signal } = {}, { op, family, signedMessage }) {
  if (request?.op !== op) return { ok: false, reason: 'issuer:unknown-op' }
  if (!Object.hasOwn(request, 'digest')) return { ok: false, reason: 'issuer:authorize-digest-missing' }
  const hasArtifact = Object.hasOwn(request, 'artifact')
  const hasArtifactDigest = Object.hasOwn(request, 'artifactDigest')
  if (hasArtifact !== hasArtifactDigest) return { ok: false, reason: 'issuer:authorize-artifact-incomplete' }
  if (Object.keys(request).length !== (hasArtifact ? 4 : 2)) {
    return { ok: false, reason: 'issuer:authorize-extra-fields' }
  }
  const digest = request.digest
  if (typeof digest !== 'string' || !AUTHORIZATION_DIGEST.test(digest)) {
    return { ok: false, reason: 'issuer:digest-malformed' }
  }
  let approvalArtifact = null
  if (hasArtifact) {
    try {
      approvalArtifact = verifyApprovalArtifact(request.artifact, request.artifactDigest)
    } catch (error) {
      return { ok: false, reason: approvalRefusalReason(error) }
    }
    const artifactTimeRefusal = approvalTimeRefusal(approvalArtifact.expiry)
    if (artifactTimeRefusal !== null) return { ok: false, reason: artifactTimeRefusal }
  }
  const now = Date.now()
  const pendingKey = pendingDigestKey(family, digest)
  // The target is read before pruning, so its expiry is reported under its own
  // name rather than deleted first and reported as never admitted.
  const entry = _pending.get(pendingKey)
  if (entry !== undefined && now - entry.admittedAt > PENDING_TTL_MS) {
    _pending.delete(pendingKey)
    prunePending(now)
    return { ok: false, reason: 'issuer:admission-expired' }
  }
  prunePending(now)
  if (entry === undefined) return { ok: false, reason: 'issuer:digest-not-pending' }
  // Busy and already-under-review are checked BEFORE the admission is spent, so
  // a refusal the caller can legitimately retry does not destroy its admission.
  if (entry.reviewing) return { ok: false, reason: 'issuer:digest-under-review' }
  if (_activeApproval !== null) return { ok: false, reason: 'issuer:approval-busy' }
  entry.reviewing = true
  const decision = approvalArtifact === null
    ? await askHumanForDigest(digest, signal)
    : await askHumanForArtifact(approvalArtifact, signal)

  // Only a decision spends an admission. A timeout and a disconnect are not
  // decisions: the human was asked and did not answer, or the asking was
  // interrupted, and in both cases the admission stays claimable until its TTL
  // rather than being destroyed by an event nobody chose.
  // Every mutation below is guarded on the table still holding THIS entry: a
  // late outcome owns only the admission it was asked about, never a
  // replacement admitted under the same digest.
  const isMine = () => _pending.get(pendingKey) === entry

  if (decision === APPROVAL.BUSY || decision === APPROVAL.TIMED_OUT || decision === APPROVAL.CANCELLED) {
    if (isMine()) entry.reviewing = false
    if (decision === APPROVAL.BUSY) return { ok: false, reason: 'issuer:approval-busy' }
    if (decision === APPROVAL.TIMED_OUT) return { ok: false, reason: 'issuer:approval-timeout' }
    return { ok: false, reason: 'issuer:request-cancelled' }
  }

  // The carrier is gone, so no retry can succeed. Retaining the admission would
  // hold capacity that nothing can ever claim.
  if (decision === APPROVAL.UNAVAILABLE) {
    if (isMine()) _pending.delete(pendingKey)
    return { ok: false, reason: 'issuer:approval-unavailable' }
  }
  if (decision === APPROVAL.DENIED) {
    if (isMine()) _pending.delete(pendingKey)
    return { ok: false, reason: 'issuer:human-denied' }
  }

  // Re-check immediately before signing, against the SAME entry object. An
  // approval can only be minutes old at most, but `prunePending` runs on every
  // admission and authorization, so a concurrent request can drop this digest
  // while its own prompt is open. Signing from a stale reference would mint for
  // an admission the table no longer holds.
  // EXHAUSTIVE, and the only branch that reaches a signature. An unrecognised
  // outcome refuses; nothing falls through to signing.
  if (decision !== APPROVAL.APPROVED) return { ok: false, reason: 'issuer:approval-outcome-unknown' }

  // Signing requires the table to still hold THIS entry, unexpired. A digest
  // can be pruned and re-admitted while a prompt is open, and the replacement
  // is a different admission this call never asked about.
  if (_pending.get(pendingKey) !== entry) return { ok: false, reason: 'issuer:digest-not-pending' }
  if (Date.now() - entry.admittedAt > PENDING_TTL_MS) {
    _pending.delete(pendingKey)
    return { ok: false, reason: 'issuer:admission-expired' }
  }
  _pending.delete(pendingKey)
  const signature = edSign(null, signedMessage(digest), rootPrivateKey).toString('base64')
  return { ok: true, digest, signature }
}

/** Authorize one admitted v4 digest, optionally rendering its approval artifact. */
export async function handleAuthorize(request, options = {}) {
  return handleAuthorizeForFamily(request, options, {
    op: 'authorize',
    family: 'v4',
    signedMessage: authorizationSignedMessageFromHex,
  })
}

/** Authorize one admitted v5 digest, optionally rendering its approval artifact. */
export async function handleAuthorizeV5(request, options = {}) {
  return handleAuthorizeForFamily(request, options, {
    op: 'authorize.v5',
    family: 'v5',
    signedMessage: authorizationSignedMessageV5FromHex,
  })
}

/**
 * The occurrence binding for artifact approvals. Its lifetime is exactly one
 * prompt: the single approval slot serializes prompts, and every terminal path
 * below clears the occurrence, so no occurrence outlives the frame that
 * displayed it.
 */
const approvalChannel = createApprovalChannel()

/**
 * Refuse approval artifacts outside the same expiry ceiling as grants.
 * @param {number} expiry - artifact expiry in unix seconds.
 * @param {number} [now] - wall clock in milliseconds.
 * @returns {string | null} named refusal, or null while signable.
 */
function approvalTimeRefusal(expiry, now = Date.now()) {
  const nowSeconds = Math.floor(now / 1000)
  if (expiry <= nowSeconds) return REFUSE_APPROVAL.ARTIFACT_EXPIRED
  if (expiry > nowSeconds + MAX_TTL_SECONDS) return REFUSE_APPROVAL.TTL_UNBOUNDED
  return null
}

/**
 * Render one approval artifact to the human and, on approval, sign its digest.
 *
 * The issuer trusts nothing the caller computed. It re-derives the operation,
 * the projection, and the artifact digest from the artifact's own raw
 * arguments through {@link verifyApprovalArtifact}, refuses any divergence
 * before a pixel is drawn, and displays only what it derived. A caller that
 * renders one operation and asks for another therefore cannot be represented:
 * there is one artifact and both sides compute it.
 *
 * The signature covers {@link approvalSignedMessage}, whose domain tag is
 * disjoint from the grant v3 and v4 authorization messages. This route mints
 * no grant and extends no grant claim; it attests that one exact artifact was
 * displayed and approved.
 *
 * Refusals raised by the approval modules keep their `approval:` names,
 * because they are this process's own independent finding about the artifact.
 * Issuer protocol and channel-state refusals keep the `issuer:` prefix.
 *
 * @param {unknown} request - one parsed approval request.
 * @param {{signal?: AbortSignal}} [options] - caller lifetime; disconnect cancels the prompt.
 * @returns {Promise<Record<string, unknown>>} the signature envelope or a named refusal.
 */
export async function handleApproveArtifact(request, { signal } = {}) {
  if (request?.op !== 'approve-artifact') return { ok: false, reason: 'issuer:unknown-op' }
  if (!Object.hasOwn(request, 'artifact')) return { ok: false, reason: 'issuer:approval-artifact-missing' }
  if (!Object.hasOwn(request, 'digest')) return { ok: false, reason: 'issuer:approval-digest-missing' }
  if (Object.keys(request).length !== 3) return { ok: false, reason: 'issuer:approval-extra-fields' }

  let artifact
  try {
    artifact = verifyApprovalArtifact(request.artifact, request.digest)
  } catch (error) {
    return { ok: false, reason: approvalRefusalReason(error) }
  }
  const initialTimeRefusal = approvalTimeRefusal(artifact.expiry)
  if (initialTimeRefusal !== null) return { ok: false, reason: initialTimeRefusal }
  // The digest bound to the occurrence and later signed is THIS process's
  // recomputation, never the value the caller sent.
  const artifactDigest = approvalArtifactDigest(artifact)

  if (_approvalInputEnded) return { ok: false, reason: 'issuer:approval-unavailable' }
  if (_activeApproval !== null) return { ok: false, reason: 'issuer:approval-busy' }
  approvalChannel.cancel()

  /** @type {{occurrenceId: string, artifactDigest: string} | null} */
  let opened = null
  /** @type {string | null} */
  let channelOutcome = null

  const decision = await askHumanWith(
    (challenge) => {
      const result = approvalChannel.open({ artifact, challenge })
      if (!result.ok) return
      opened = result.occurrence
      approvalCarrier.write(`${renderApprovalArtifact(artifact, challenge)}`)
    },
    signal,
    (answer) => {
      // An answer that arrives with no occurrence open, or that names a
      // different occurrence or artifact, is not a denial of this prompt: it
      // settles nothing and leaves no signing outcome behind.
      if (opened === null) return APPROVAL.DENIED
      const settled = approvalChannel.submit({
        occurrenceId: opened.occurrenceId,
        artifactDigest: opened.artifactDigest,
        answer,
      })
      if (!settled.ok) return APPROVAL.DENIED
      channelOutcome = settled.outcome
      return settled.outcome === APPROVAL_OUTCOME.APPROVED ? APPROVAL.APPROVED : APPROVAL.DENIED
    },
  )

  if (decision !== APPROVAL.APPROVED) {
    approvalChannel.cancel()
    if (decision === APPROVAL.BUSY) return { ok: false, reason: 'issuer:approval-busy' }
    if (decision === APPROVAL.TIMED_OUT) return { ok: false, reason: 'issuer:approval-timeout' }
    if (decision === APPROVAL.CANCELLED) return { ok: false, reason: 'issuer:request-cancelled' }
    if (decision === APPROVAL.UNAVAILABLE) return { ok: false, reason: 'issuer:approval-unavailable' }
    if (decision === APPROVAL.DENIED) return { ok: false, reason: 'issuer:human-denied' }
    return { ok: false, reason: 'issuer:approval-outcome-unknown' }
  }

  // THE SIGNING GUARD. The prompt's verdict is not authority by itself: the
  // channel's own outcome must exist, must be a signing outcome, and must
  // belong to an occurrence still bound to the digest about to be signed.
  // Every branch that is not one exact approval of THIS artifact refuses.
  if (opened === null || channelOutcome === null) return { ok: false, reason: 'issuer:approval-occurrence-lost' }
  if (opened.artifactDigest !== artifactDigest) return { ok: false, reason: 'approval:artifact-mutated' }
  let signable
  try {
    signable = isSigningOutcome(channelOutcome)
  } catch {
    // An outcome this build does not recognise never reaches a signature.
    return { ok: false, reason: 'issuer:approval-outcome-unknown' }
  }
  if (!signable) return { ok: false, reason: 'issuer:approval-outcome-unknown' }

  // Human review takes time. Recheck at the signing edge so an artifact that
  // expired while visible cannot become a valid signed approval.
  const signingTimeRefusal = approvalTimeRefusal(artifact.expiry)
  if (signingTimeRefusal !== null) return { ok: false, reason: signingTimeRefusal }

  const signature = edSign(null, approvalSignedMessage(artifactDigest), rootPrivateKey).toString('base64')
  return { ok: true, digest: artifactDigest, signature }
}

/**
 * Validate one issuance request and mint ONLY after a real human approval
 * rendered and confirmed by THIS process. Without approval: no grant.
 * @param {unknown} request - one parsed issuer protocol request.
 * @param {{signal?: AbortSignal}} [options] - caller lifetime; disconnect aborts approval.
 * @returns {Promise<Record<string, unknown>>} the grant or a named refusal.
 */
export async function handleIssue(request, { signal } = {}) {
  if (request?.op !== 'issue') return { ok: false, reason: 'issuer:unknown-op' }
  if (request.toolName !== 'memory.put') return { ok: false, reason: 'issuer:unsupported-tool' }
  const args = request.arguments
  if (!isExactMemoryPutArgs(args)) return { ok: false, reason: 'issuer:arguments-not-exact' }
  if (!KEY_SHAPE.test(args.key)) return { ok: false, reason: 'issuer:key-not-a-name' }
  const expiry = request.expiry
  if (!Number.isInteger(expiry) || expiry <= Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'issuer:invalid-expiry' }
  }

  // S3: the AUTHORITATIVE human decision happens here — the last one, at the
  // process holding the root key. It is not the only one: the harness bridge
  // delegates to its own answerer chain first and calls this only after that
  // chain returned 'allowed-once', so a composed answerer and this prompt must
  // BOTH approve (packages/governed/memory-put/src/bridge.ts explains the
  // order). A composition with no answerer never reaches this line at all.
  // Build the exact operation mintGrant will bind to, show THAT, and refuse to
  // hand back a grant whose operation digest is not the digest the human saw.
  let operation
  let presentedDigest
  try {
    operation = buildOperation(args, expiry)
    presentedDigest = operationDigest(operation)
  } catch (error) {
    return { ok: false, reason: `issuer:unrenderable-operation (${String(error?.message ?? error)})` }
  }
  const decision = await askHuman(operation, args, signal)
  // The v3 replies are unchanged by the outcome refactor. This route's refusal
  // vocabulary is graded by courts/harness/wysiwys-issuer, so denied, timed-out
  // and unavailable continue to share one name here.
  if (decision === APPROVAL.BUSY) return { ok: false, reason: 'issuer:approval-busy' }
  if (decision === APPROVAL.CANCELLED) return { ok: false, reason: 'issuer:request-cancelled' }
  if (decision !== APPROVAL.APPROVED) return { ok: false, reason: 'issuer:human-denied-or-unavailable' }

  try {
    const { grant } = mintGrant({ rootPrivateKey, args, exp: expiry, receiptKeyId: expectedReceiptKeyId })
    // Re-verify the returned signed artifact against the exact operation the
    // human saw. `mintGrant`'s auxiliary return values are not authority: a
    // faulty or substituted minter must not be able to describe an old prompt
    // while returning a differently signed grant.
    const signed = verifyIssuedGrant({
      grant,
      toolName: 'memory.put',
      args,
      rootPublicKeyPem,
      expectedDefinitionId: operation.definitionId,
      expectedOperationDigest: presentedDigest,
      expectedReceiptKeyId,
      now: Date.now(),
    })
    if (!signed.ok) {
      return { ok: false, reason: 'issuer:presented-signed-drift' }
    }
    return { ok: true, grant, operationDigest: presentedDigest }
  } catch (error) {
    return { ok: false, reason: `issuer:mint-refused (${String(error?.message ?? error)})` }
  }
}

const connections = new Set()
let socketIdentity = null
const server = createServer((socket) => {
  connections.add(socket)
  const decoder = new StringDecoder('utf8')
  const lifetime = new AbortController()
  let buffer = ''
  let requestStarted = false
  let terminalReplySent = false
  socket.once('close', () => {
    connections.delete(socket)
    lifetime.abort()
  })

  const finish = (reply) => {
    if (terminalReplySent) return
    terminalReplySent = true
    buffer = ''
    socket.removeListener('data', onData)
    if (!socket.destroyed) {
      socket.end(`${JSON.stringify(reply)}\n`, () => socket.destroy())
    }
  }
  const refuseAdditionalRequest = () => {
    if (terminalReplySent) return
    lifetime.abort()
    finish({ ok: false, reason: 'issuer:one-request-per-connection' })
  }
  const processRequest = async (line) => {
    let reply
    try {
      reply = await handleIssuerRequest(JSON.parse(line), { signal: lifetime.signal })
        .catch(() => ({ ok: false, reason: 'issuer:handler-error' }))
    } catch {
      reply = { ok: false, reason: 'issuer:unparseable-request' }
    }
    finish(reply)
  }

  const onData = (chunk) => {
    const text = decoder.write(chunk)
    if (requestStarted) {
      if (text.trim() !== '') refuseAdditionalRequest()
      return
    }
    buffer += text
    if (Buffer.byteLength(buffer, 'utf8') > 64 * 1024) {
      lifetime.abort()
      finish({ ok: false, reason: 'issuer:frame-oversize' })
      return
    }
    let cut
    while ((cut = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 1)
      if (line.trim() === '') continue
      requestStarted = true
      if (buffer.trim() !== '') {
        refuseAdditionalRequest()
        return
      }
      buffer = ''
      void processRequest(line)
      return
    }
  }
  socket.on('data', onData)
  socket.on('error', () => { /* a caller that hangs up mid-frame is not an event */ })
})

server.listen(socketPath, () => {
  try {
    const entry = lstatSync(socketPath)
    if (!entry.isSocket()) throw new Error('listening path is not a Unix socket')
    socketIdentity = identityOf(entry)
    if (entry.uid !== process.geteuid()) throw new Error('listening socket must be owned by the issuer euid')
    if (socketGroupAccess
      && (typeof process.getegid !== 'function' || entry.gid !== process.getegid())) {
      throw new Error('shared listening socket must be owned by the issuer effective group')
    }
    const expectedMode = socketGroupAccess ? 0o660 : 0o600
    chmodSync(socketPath, expectedMode)
    const secured = lstatSync(socketPath)
    if (!secured.isSocket()
      || secured.dev !== socketIdentity.dev
      || secured.ino !== socketIdentity.ino
      || secured.uid !== process.geteuid()
      || (secured.mode & 0o777) !== expectedMode
      || (socketGroupAccess && secured.gid !== process.getegid())) {
      throw new Error('listening socket access could not be secured')
    }
  } catch (error) {
    shutdown(1, String(error?.message ?? error))
  }
})

server.on('error', (error) => shutdown(1, String(error?.message ?? error)))

let stopping = false
let shutdownFinished = false

function shutdown(requestedExitCode, message = null) {
  if (stopping) return
  stopping = true
  if (message !== null) console.error(`issuer: ${message}`)
  // An open prompt is cancelled. Every outcome channel carries an APPROVAL
  // member, and only APPROVAL.APPROVED reaches signing, so authorization does
  // not depend on whether this settle or process exit is scheduled first.
  settleActiveApproval(APPROVAL.CANCELLED)
  approvalCarrier.close()
  for (const socket of connections) socket.destroy()

  const timeout = setTimeout(() => process.exit(1), 1000)
  const finish = () => {
    if (shutdownFinished) return
    shutdownFinished = true
    clearTimeout(timeout)
    const socketRemoved = socketIdentity === null
      || unlinkOwnedEntry(socketPath, socketIdentity, (entry) => entry.isSocket())
    const leaseRemoved = releaseLease(issuerLease)
    process.exit(requestedExitCode === 0 && socketRemoved && leaseRemoved ? 0 : 1)
  }

  try {
    server.close(finish)
  } catch {
    finish()
  }
}

process.on('SIGTERM', () => shutdown(0))
process.on('SIGINT', () => shutdown(0))
if (typeof process.send === 'function') {
  process.on('disconnect', () => shutdown(1, 'parent channel disconnected'))
}
