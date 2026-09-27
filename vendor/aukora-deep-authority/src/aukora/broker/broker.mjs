/**
 * The broker: the process that holds the capability.
 *
 * Everything measured in this tree says the same thing. An in-process check
 * is owned by whoever loaded first; the harness's own guard lives in
 * ToolRuntime dispatch, so code that never crosses dispatch is never checked.
 * The decision therefore happens in a separate OS process: the agent side
 * owns nothing and asks; this process owns the state directory, the nonce
 * book, and the one effect.
 *
 * LAUNCH HYGIENE IS THE HALF THAT MATTERS. NODE_OPTIONS, --import and
 * --require are applied by Node at process start, so a process cannot scrub
 * itself — the parent must strip them BEFORE spawn, and the parent must run
 * before anything untrusted. The broker additionally reports its own env and
 * crypto state, which the caller cannot supply for it.
 *
 * CONFINEMENT IS MEASURED, NOT ASSUMED. `serve()` refuses to start unless it
 * exclusively owns its state directory and is not root, and every receipt
 * carries the class it measured — see ./confinement.mjs for what that class is
 * worth in each direction. Under the same uid as its caller the broker states
 * so in signed bytes: a determined same-uid caller still opens the state
 * directory with fs directly, holds the receipt-signing key, and can rewrite
 * the record coherently. This is launch-hygiene process separation plus an
 * honest label, not a defence against the uid that owns the state.
 *
 * ONE LIVE WRITER. A create-if-absent entry in `stateDir` is held for the
 * broker's complete serving lifetime and removed only on graceful close. A
 * crash leaves it behind and restart fails closed until an operator confirms
 * the old process is gone. Aura's append lock independently serializes
 * sequence allocation and append; the separate sequence file detects local
 * suffix deletion. An attacker at the state uid can coherently rewrite Aura,
 * the sequence witness, the lease, and the signing key, so none of these are
 * claimed as an anchor against that uid.
 *
 * @module @aukora/broker
 */
import { createConnection, createServer } from 'node:net'
import {
  chmodSync, closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { generateKeyPairSync, createPrivateKey, createPublicKey, createHash, randomBytes, sign as edSign, verify as edVerify } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  authorizationDigest,
  canonicalEd25519PublicKey,
  newNonce,
  payloadDigest,
  receiptKeyIdForPublicKey,
  REFUSE,
  GRANT_DOMAIN_V4,
  verifyGrant,
  verifyGrantV4,
  verifyIssuedGrantV4,
} from '../host-dsh/src/grant.mjs'
import {
  authorizationDigestV5,
  inspectAuthorizationClaimsV5,
  verifyGrantV5,
  verifyIssuedGrantV5,
} from '../host-dsh/src/grant-v5.mjs'
import { openNonceBook } from '../host-dsh/src/nonce-book.mjs'
import { canonicalJSON } from '../kernel-seed/canonical-json.mjs'
import { memoryPut, observe } from './effect.mjs'
import { preflightWorkspacePatch, workspacePatch } from './workspace-patch.mjs'
import { isExactWorkspacePatchArgs, workspacePatchBody } from './workspace-patch-args.mjs'
import { KIRA_RECALL_MAX_SUBJECT_BYTES } from '../kira/recall.mjs'
import { readBrokerKiraRecall } from './kira-recall.mjs'
import { definitionDigest, isGovernedEffect, MEMORY_PUT, WORKSPACE_PATCH } from './effect-definition.mjs'
import { buildOperation, effectBody, operationDigest } from './operation.mjs'
import { isExactMemoryPutArgs, KEY_SHAPE } from './memory-put-args.mjs'
import {
  mintReceipt,
  readReceipt,
  requestDigest,
  verifyReceipt,
  verifyReceiptDirectory,
  writeReceipt,
} from './receipt.mjs'
import { acquireAppendLock, appendEntry, readVerifiedChain, releaseAppendLock } from '../aura/record.mjs'
import { buildReceiptV3, writeReceiptV3 } from '../receipt-v3/export.mjs'
import {
  verifyAuthorityEvidenceDirectory,
  verifyAuthorityEvidence,
  writeAuthorityEvidence,
} from '../aura/authority-evidence.mjs'
import { ACTIVATION_ADMIT_REFUSE, admitActivation, bindActivation, readActivationBinding } from '../activation/broker-state.mjs'
import {
  IDENTITY_CONTROL_ADMIT_REFUSE,
  IDENTITY_CONTROL_STATE_REFUSE,
  admitIdentityControl,
  bindIdentityControlState,
  readIdentityControlState,
} from '../identity/broker-state.mjs'
import {
  approvalArtifactDigest,
  createApprovalArtifact,
  parseApprovalArtifact,
} from '../approval/artifact.mjs'
import {
  createSubjectAuthorityContext,
  createSubjectAuthorityExpectation,
  decodeSubjectAuthorityContext,
  decodeSubjectAuthorityExpectation,
  encodeSubjectAuthorityContext,
  encodeSubjectAuthorityExpectation,
} from './subject-authority.mjs'
import {
  CONFINEMENT_CLASS, CONFINEMENT_REFUSE, PEER_TOKEN_PATH_ENV, PEER_TOKEN_SHA256_ENV,
  assertBootConfinement, classAtLeast, confinementField, effectiveClass, isPrivateMode, measurePeerSeparability,
  measureStateDirectory, raiseSeal, verifyPeerEcho,
} from './confinement.mjs'
import { KIRA_RECALL_TOOL } from '../kira/recall.mjs'
import {
  KIRA_PRIVACY_CLASSES,
  KIRA_RECORD_ID,
  KIRA_RECORD_KINDS,
  verifyKiraMemoryRecord,
} from '../kira/stage.mjs'

/** One request line may not exceed this. A frame is bounded or it is a denial of service. */
export const MAX_FRAME_BYTES = 64 * 1024

/** The public states exposed by the prototype broker-proposal wire protocol. */
export const BROKER_PROPOSAL_STATUS = Object.freeze({
  PENDING: 'PENDING',
  SETTLED: 'SETTLED',
  REFUSED: 'REFUSED',
  INDETERMINATE: 'INDETERMINATE',
})

/** Accepted proposals retained for one broker process lifetime; terminal entries are never evicted. */
export const BROKER_PROPOSAL_MAX_ENTRIES = 16

/** Broker-minted occurrence namespaces retained for one process lifetime. */
export const BROKER_PROPOSAL_MAX_NAMESPACES = 16

/** UTF-8 ceiling for the opaque tool-call occurrence name supplied by the guest. */
export const BROKER_PROPOSAL_MAX_CALL_ID_BYTES = 256

/** Maximum canonical effect body the broker will authorize through the prototype proposal route. */
export const BROKER_PROPOSAL_MAX_EFFECT_BYTES = 8 * 1024

/** Maximum UTF-8 bytes in one echoed transport request identifier. */
const BROKER_REQUEST_ID_MAX_BYTES = 256

/** Fixed v4 grant lifetime. The broker chooses it only after entering the issuer FIFO. */
const BROKER_PROPOSAL_GRANT_TTL_SECONDS = 300

/** Resource prefix for the only effect admitted by the proposal route. */
const MEMORY_RESOURCE_PREFIX = 'memory:key:'

/** Parent-review request type carried only over the broker launcher's IPC channel. */
/** Read-only receipt inspection. Never settles, never writes. */
export const RECEIPT_INSPECT_OP = 'receipt.inspect'

export const BROKER_REVIEW_REQUEST = 'aukora:review-request:v2'

/** Parent-review decision type carried only over the broker launcher's IPC channel. */
export const BROKER_REVIEW_DECISION = 'aukora:review-decision:v1'

/** Parent-review cancellation type emitted when the child stops waiting. */
export const BROKER_REVIEW_CANCEL = 'aukora:review-cancel:v1'

/** Proposal-specific authority request carried only over the broker launcher's IPC channel. */
export const BROKER_AUTHORITY_REQUEST = 'aukora:authority-request:v1'

/** Proposal-specific authority selection carried only over the broker launcher's IPC channel. */
export const BROKER_AUTHORITY_SELECTION = 'aukora:authority-selection:v1'

/** Cancellation emitted when the child stops waiting for one authority selection. */
export const BROKER_AUTHORITY_CANCEL = 'aukora:authority-cancel:v1'

/** One parent review may wait through a bounded human interaction. */
const BROKER_REVIEW_TIMEOUT_MS = 35_000

/** One proposal-specific authority selection may wait on its launch parent. */
const BROKER_AUTHORITY_TIMEOUT_MS = 35_000

/** One issuer request may wait through the issuer's fixed thirty-second human deadline. */
const ISSUER_REQUEST_TIMEOUT_MS = 35_000

/** Refusals the broker itself can produce, distinct from the verifier's. */
export const BROKER_REFUSE = Object.freeze({
  OVERSIZE: 'broker:frame-oversize',
  UNPARSEABLE: 'broker:frame-unparseable',
  UNKNOWN_OP: 'broker:unknown-op',
  LEGACY_ROUTE_FORBIDDEN: 'broker:legacy-route-forbidden',
  ARGUMENTS_NOT_EXACT: 'broker:arguments-not-exact',
  KEY_NOT_A_NAME: 'broker:key-not-a-name',
  STATE_ACTIVE: 'broker:state-active',
  STATE_PATH_MALFORMED: 'broker:state-path-malformed',
  SOCKET_DIRECTORY_MALFORMED: 'broker:socket-directory-malformed',
  SOCKET_DIRECTORY_UNTRUSTED: 'broker:socket-directory-untrusted',
  SOCKET_PATH_OCCUPIED: 'broker:socket-path-occupied',
  SOCKET_ROUTE_LOST: 'broker:socket-route-lost',
  KEY_DIRECTORY_MALFORMED: 'broker:key-directory-malformed',
  NONCE_DIRECTORY_MALFORMED: 'broker:nonce-directory-malformed',
  ROOT_PUBLIC_KEY_INVALID: 'broker:root-public-key-invalid',
  CUSTOM_DISPATCH_FORBIDDEN: 'broker:custom-dispatch-forbidden',
  CUSTOM_ENTRY_FORBIDDEN: 'broker:custom-entry-forbidden',
  AURA_SEQUENCE_MISMATCH: 'broker:aura-sequence-mismatch',
  CONFINEMENT_STATE_INDETERMINATE: 'broker:confinement-state-indeterminate',
  STOPPING: 'broker:stopping',
  PROPOSAL_ROUTE_UNAVAILABLE: 'broker:proposal-route-unavailable',
  PROPOSAL_FRAME_NOT_EXACT: 'broker:proposal-frame-not-exact',
  PROPOSAL_NAMESPACE_INVALID: 'broker:proposal-namespace-invalid',
  PROPOSAL_NAMESPACE_TABLE_FULL: 'broker:proposal-namespace-table-full',
  PROPOSAL_CALL_ID_INVALID: 'broker:proposal-call-id-invalid',
  PROPOSAL_CALL_ID_REUSED: 'broker:proposal-call-id-reused',
  PROPOSAL_TABLE_FULL: 'broker:proposal-table-full',
  PROPOSAL_ARGUMENTS_TOO_LARGE: 'broker:proposal-arguments-too-large',
  PROPOSAL_UNAVAILABLE: 'broker:proposal-unavailable',
  PROPOSAL_INTERNAL_FAILURE: 'broker:proposal-internal-failure',
  REVIEW_CHANNEL_UNAVAILABLE: 'broker:review-channel-unavailable',
  REVIEW_DENIED: 'broker:review-denied',
  REVIEW_RESPONSE_MALFORMED: 'broker:review-response-malformed',
  REVIEW_TIMED_OUT: 'broker:review-timed-out',
  AUTHORITY_CHANNEL_UNAVAILABLE: 'broker:authority-channel-unavailable',
  AUTHORITY_CONFIGURATION_INVALID: 'broker:authority-configuration-invalid',
  AUTHORITY_RESPONSE_MALFORMED: 'broker:authority-response-malformed',
  AUTHORITY_TIMED_OUT: 'broker:authority-timed-out',
  ISSUER_REFUSED: 'broker:issuer-refused',
  ISSUER_RESPONSE_MALFORMED: 'broker:issuer-response-malformed',
  ISSUER_TRANSPORT_FAILED: 'broker:issuer-transport-failed',
  REQUEST_ID_INVALID: 'broker:request-id-invalid',
  RESPONSE_SERIALIZATION_FAILED: 'broker:response-serialization-failed',
  ACTIVATION_STATE_MALFORMED: ACTIVATION_ADMIT_REFUSE.STATE_MALFORMED,
  ACTIVATION_MISMATCH: ACTIVATION_ADMIT_REFUSE.MISMATCH,
  ACTIVATION_STALE: ACTIVATION_ADMIT_REFUSE.STALE,
  ACTIVATION_UNBOUND: ACTIVATION_ADMIT_REFUSE.UNBOUND,
  IDENTITY_CONTROL_STATE_MALFORMED: IDENTITY_CONTROL_STATE_REFUSE.MALFORMED,
  IDENTITY_CONTROL_STATE_CONFLICT: IDENTITY_CONTROL_STATE_REFUSE.CONFLICT,
  IDENTITY_CONTROL_UNBOUND: IDENTITY_CONTROL_ADMIT_REFUSE.UNBOUND,
  IDENTITY_CONTROL_SUBJECT_MISMATCH: IDENTITY_CONTROL_ADMIT_REFUSE.SUBJECT_MISMATCH,
  IDENTITY_CONTROL_DIGEST_MISMATCH: IDENTITY_CONTROL_ADMIT_REFUSE.DIGEST_MISMATCH,
  IDENTITY_CONTROL_REVOKED: IDENTITY_CONTROL_ADMIT_REFUSE.REVOKED,
  IDENTITY_CONTROL_SIGNER_MISMATCH: IDENTITY_CONTROL_ADMIT_REFUSE.SIGNER_MISMATCH,
  RENDERER_UNBOUND: 'broker:renderer-unbound',
  APPROVAL_ARTIFACT_MALFORMED: 'broker:approval-artifact-malformed',
  KIRA_RECALL_UNCONFIGURED: 'broker:kira-recall-unconfigured',
  KIRA_RECALL_POLICY_INVALID: 'broker:kira-recall-policy-invalid',
  KIRA_RECALL_FRAME_NOT_EXACT: 'broker:kira-recall-frame-not-exact',
  KIRA_RECALL_KIND_INVALID: 'broker:kira-recall-kind-invalid',
  KIRA_WRITE_UNCONFIGURED: 'broker:kira-write-unconfigured',
  KIRA_WRITE_AUTHORITY_UNBOUND: 'broker:kira-write-authority-unbound',
  KIRA_WRITE_KEY_INVALID: 'broker:kira-write-key-invalid',
  KIRA_WRITE_RECORD_MALFORMED: 'broker:kira-write-record-malformed',
  KIRA_WRITE_RECORD_IDENTITY_MISMATCH: 'broker:kira-write-record-identity-mismatch',
  KIRA_WRITE_KEY_MISMATCH: 'broker:kira-write-key-mismatch',
  KIRA_WRITE_SUBJECT_MISMATCH: 'broker:kira-write-subject-mismatch',
  KIRA_WRITE_PRIVACY_REFUSED: 'broker:kira-write-privacy-refused',
})

/** Parent review failures carried by IPC without becoming human decisions. */
const PARENT_REVIEW_FAILURES = new Set([
  BROKER_REFUSE.REVIEW_CHANNEL_UNAVAILABLE,
  BROKER_REFUSE.REVIEW_TIMED_OUT,
  BROKER_REFUSE.STOPPING,
])

const RESPONSE_SERIALIZATION_FAILURE_FRAME = `${JSON.stringify({
  ok: false,
  state: 'INDETERMINATE',
  reason: BROKER_REFUSE.RESPONSE_SERIALIZATION_FAILED,
})}\n`

/** A create-if-absent entry held for the complete lifetime of one broker. */
const ACTIVE_LOCK = '.broker-active.lock'

/** The only module that the product launcher may execute as a broker. */
const BROKER_ENTRY = fileURLToPath(import.meta.url)

/**
 * The Node executable captured at module initialization. This protects the
 * helper from a later same-process `process.execPath` mutation; a caller that
 * controls execution before this module imports remains outside this helper's
 * authority boundary.
 */
const NODE_EXECUTABLE = process.execPath

/** Child-to-parent IPC message emitted only after this broker has bound its own socket. */
const BROKER_READY = 'aukora:broker-ready'
const EXIT_ON_PARENT_DISCONNECT_ENV = 'AUKORA_EXIT_ON_PARENT_DISCONNECT'

/** Enables the fixed owner-held-directory/shared-group socket policy for installed jobs. */
const SOCKET_GROUP_ACCESS_ENV = 'AUKORA_SOCKET_GROUP_ACCESS'

/** The one activation field a broker child accepts. It carries a digest, never a statement. */
export const ACTIVATION_DIGEST_ENV = 'AUKORA_ACTIVATION_DIGEST'

/** SHA-256 identity of the parent renderer that will display the approval artifact. */
export const RENDERER_ID_ENV = 'AUKORA_RENDERER_ID'

/** Canonical JSON parent-owned KIRA recall policy bound at broker launch. */
export const KIRA_RECALL_POLICY_ENV = 'AUKORA_KIRA_RECALL_POLICY'

/** Operator-owned workspace aliases, explicitly supplied after environment scrubbing. */
export const WORKSPACE_ROOTS_ENV = 'AUKORA_WORKSPACE_ROOTS_JSON'

/** Enables the child-to-parent proposal-specific authority-selection route. */
export const PARENT_AUTHORITY_ENV = 'AUKORA_PARENT_AUTHORITY'

/** Canonical Base64 public subject/control expectation for dynamic v5 selection. */
export const SUBJECT_AUTHORITY_EXPECTATION_ENV = 'AUKORA_SUBJECT_AUTHORITY_EXPECTATION_B64'

/** Lowercase SHA-256 hex. Shared by activation and renderer identities. */
const HEX_SHA256 = /^[0-9a-f]{64}$/

/** Ambient variables removed before the launcher injects its validated code, route, and authority values. */
export const STRIPPED_ENV = Object.freeze([
  'NODE_OPTIONS',
  'NODE_PATH',
  'NODE_REPL_EXTERNAL_MODULE',
  'ELECTRON_RUN_AS_NODE',
  'NODE_COMPILE_CACHE',
  'AUKORA_SOCKET',
  'AUKORA_BROKER_SOCKET',
  'AUKORA_STATE_DIR',
  'AUKORA_ROOT_PEM',
  'AUKORA_ISSUER_SOCKET',
  'AUKORA_PARENT_REVIEW',
  'AUKORA_SUBJECT_AUTHORITY_B64',
  'AUKORA_ROOT_CONTROL_STATE_FILE',
  PARENT_AUTHORITY_ENV,
  SUBJECT_AUTHORITY_EXPECTATION_ENV,
  ACTIVATION_DIGEST_ENV,
  RENDERER_ID_ENV,
  KIRA_RECALL_POLICY_ENV,
  WORKSPACE_ROOTS_ENV,
  EXIT_ON_PARENT_DISCONNECT_ENV,
  SOCKET_GROUP_ACCESS_ENV,
  'AUKORA_ISSUER_KEY_FILE',
  'AUKORA_ISSUER_SOCKET_GROUP_ACCESS',
  'AUKORA_EXPECTED_RECEIPT_KEY_ID',
  PEER_TOKEN_PATH_ENV,
  PEER_TOKEN_SHA256_ENV,
  // Dynamic linker and crypto library injection vectors
  'LD_PRELOAD', 'LD_AUDIT', 'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES', 'DYLD_FRAMEWORK_PATH', 'DYLD_LIBRARY_PATH', 'DYLD_FALLBACK_LIBRARY_PATH',
  'OPENSSL_CONF', 'OPENSSL_MODULES',
])

/**
 * Build the child's environment with every preload vector removed.
 *
 * @param {Record<string, string | undefined>} source - the parent's environment.
 * @returns {Record<string, string>} a copy with the stripped names absent.
 */
export function scrubEnv(source) {
  const out = {}
  for (const [key, value] of Object.entries(source)) {
    if (STRIPPED_ENV.includes(key)) continue
    if (value !== undefined) out[key] = value
  }
  return out
}

/**
 * Validate and detach the launch-owned KIRA recall policy.
 * @param {unknown} policy explicit subject/privacy selection, or undefined to disable recall.
 * @returns {Readonly<{subject: string, privacy: readonly string[]}> | null} immutable policy, or null when absent.
 * @throws {TypeError} when the selection is malformed.
 */
export function readKiraPolicy(policy) {
  if (policy === undefined) return null
  const snapshot = snapshotExactDataFields(policy, ['subject', 'privacy'])
  if (snapshot === null
    || typeof snapshot.subject !== 'string'
    || snapshot.subject === ''
    || Buffer.byteLength(snapshot.subject, 'utf8') > KIRA_RECALL_MAX_SUBJECT_BYTES
    || /[\u0000-\u001f\u007f-\u009f]/.test(snapshot.subject)) {
    throw new TypeError(BROKER_REFUSE.KIRA_RECALL_POLICY_INVALID)
  }
  const privacy = snapshotJsonValue(snapshot.privacy)
  if (!Array.isArray(privacy) || Object.getPrototypeOf(privacy) !== Array.prototype
    || privacy.length === 0 || new Set(privacy).size !== privacy.length
    || Reflect.ownKeys(privacy).length !== privacy.length + 1
    || privacy.some(value => !KIRA_PRIVACY_CLASSES.includes(value))) {
    throw new TypeError(BROKER_REFUSE.KIRA_RECALL_POLICY_INVALID)
  }
  return Object.freeze({
    subject: snapshot.subject,
    privacy: Object.freeze([...privacy].toSorted()),
  })
}

/**
 * Serve until closed: newline-delimited JSON over a unix socket.
 *
 * @param {object} options
 * @param {string} options.socketPath - unix socket to listen on.
 * @param {string} options.stateDir - the directory this process owns.
 * @param {string} options.rootPublicKeyPem - the root grants must verify against.
 * @param {string} [options.issuerSocket] - trusted issuer route used by the
 *   broker-owned proposal protocol. An unbound legacy `memory.put` does not
 *   require it; subject-bound v5 mode accepts only proposals.
 * @param {(request: object, signal: AbortSignal) => Promise<'approved'|'denied'>} [options.review] -
 *   parent-owned review callback. The proposal route refuses when absent.
 * @param {string} [options.activationDigest] - activation digest this broker
 *   must serve; authorization without a bound digest refuses by name.
 * @param {string} [options.rendererId] - SHA-256 identity of the parent
 *   renderer that will display the approval artifact; authorization without it
 *   refuses by name.
 * @param {{subject: string, privacy: readonly string[]}} [options.kiraRecallPolicy] -
 *   parent-owned subject and privacy classes for KIRA recall.
 * @param {unknown} [options.subjectAuthority] - launch-pinned session-to-Agent
 *   delegation that selects subject-bound v5 proposal grants.
 * @param {(request: object, signal: AbortSignal) => Promise<unknown>} [options.selectSubjectAuthority] -
 *   parent-owned proposal-specific v5 delegation selector.
 * @param {unknown} [options.subjectAuthorityExpectation] - launch-pinned public
 *   subject, control, activation, and audience required from the selector.
 * @param {unknown} [options.rootControlState] - active hybrid AUMLOK control head.
 * @param {boolean} [options.socketGroupAccess] - use the fixed installed-job
 *   route policy: owner-held `0710` parent directory and `0660` socket.
 * @param {unknown} [options.handle] - rejected. The serving entry has one
 *   dispatcher, {@link brokerDispatch}; a caller-selected handler can bypass
 *   grant verification, nonce reservation, and settlement.
 * @returns {Promise<{ close: () => Promise<void> }>} resolves once listening.
 * @throws {Error} named by {@link CONFINEMENT_REFUSE} when this process may not serve this directory.
 */
export function serve({
  socketPath,
  stateDir,
  rootPublicKeyPem,
  issuerSocket,
  review,
  handle,
  activationDigest,
  rendererId,
  kiraRecallPolicy,
  workspaceRoots,
  subjectAuthority,
  selectSubjectAuthority,
  subjectAuthorityExpectation,
  rootControlState,
  socketGroupAccess = false,
}) {
  if (handle !== undefined) {
    throw new Error(BROKER_REFUSE.CUSTOM_DISPATCH_FORBIDDEN)
  }
  if (typeof socketGroupAccess !== 'boolean') {
    throw new TypeError('broker: socketGroupAccess must be boolean')
  }
  if (canonicalEd25519PublicKey(rootPublicKeyPem) === null) {
    throw new Error(BROKER_REFUSE.ROOT_PUBLIC_KEY_INVALID)
  }
  const subjectAuthorityContext = subjectAuthority === undefined || subjectAuthority === null
    ? null
    : createSubjectAuthorityContext(subjectAuthority)
  const dynamicAuthorityExpectation = subjectAuthorityExpectation === undefined
    || subjectAuthorityExpectation === null
    ? null
    : createSubjectAuthorityExpectation(subjectAuthorityExpectation)
  if (subjectAuthorityContext !== null && dynamicAuthorityExpectation !== null) {
    throw new Error(BROKER_REFUSE.AUTHORITY_CONFIGURATION_INVALID)
  }
  if ((dynamicAuthorityExpectation === null) !== (typeof selectSubjectAuthority !== 'function')) {
    throw new Error(BROKER_REFUSE.AUTHORITY_CONFIGURATION_INVALID)
  }
  const authorityExpectation = subjectAuthorityContext ?? dynamicAuthorityExpectation
  if (authorityExpectation !== null && authorityExpectation.activationDigest !== activationDigest) {
    throw new Error(BROKER_REFUSE.ACTIVATION_MISMATCH)
  }
  ensureExactDirectory(stateDir, BROKER_REFUSE.STATE_PATH_MALFORMED, { recursive: true })
  // THE UID GATE, unconditional and first. `mkdirSync` above does NOT tighten a
  // directory that already exists, so the line above is not the check the line
  // below is. There is no flag, config field, environment variable, or request
  // that reaches past this; a launch that cannot exclusively own its state dies
  // here with a named reason instead of serving from it silently.
  const confinement = assertBootConfinement({
    stateDir,
    peerTokenPath: process.env[PEER_TOKEN_PATH_ENV],
    peerTokenSha256: process.env[PEER_TOKEN_SHA256_ENV],
  })
  // One state directory has one live writer. The create-if-absent entry stays
  // present until graceful close, so a second launch fails before it can
  // unlink or rebind the socket. A process crash intentionally leaves the
  // entry behind: recovery requires an operator to establish that the old
  // process is gone and remove it. Guessing that a lock is stale would turn a
  // live-writer ambiguity into two writers.
  const releaseState = acquireStateLease(stateDir)
  const sockets = new Set()
  const activeWork = new Set()
  const stoppingController = new AbortController()
  let stopping = false
  let notifyWorkSettled = () => {}

  /** Register work before its factory can execute, then notify the close barrier exactly once. */
  const trackActiveWork = (factory) => {
    const work = Promise.resolve().then(factory)
    activeWork.add(work)
    void work.then(
      () => { activeWork.delete(work); notifyWorkSettled() },
      () => { activeWork.delete(work); notifyWorkSettled() },
    )
    return work
  }

  let dispatch
  let brokerKey
  let socketIdentity = null
  try {
    // A prepared marker left by an earlier process must be resolved before this
    // process serves. Its presence proves only that cleanup did not complete;
    // effect execution and Aura settlement are each INDETERMINATE.
    const reconciliation = reconcileIntents(stateDir)
    if (reconciliation.malformed.length > 0) {
      throw new Error(`broker:intent-state-malformed — refusing to serve over ${reconciliation.malformed.length} malformed prepared-marker entr${reconciliation.malformed.length === 1 ? 'y' : 'ies'}`)
    }
    if (reconciliation.orphaned.length > 0) {
      // The legacy `orphaned` result field contains valid unresolved marker
      // nonces. The marker files remain on disk until an operator establishes
      // the outcome and explicitly resolves them.
      throw new Error(`broker:intent-state-unresolved — refusing to serve over ${reconciliation.orphaned.length} prepared marker(s) with incomplete cleanup: ${reconciliation.orphaned.join(', ')}`)
    }
    assertSocketDirectoryCustody(socketPath, socketGroupAccess)
    if (inspectEntry(socketPath, BROKER_REFUSE.SOCKET_PATH_OCCUPIED).present) {
      // The pathname is a separate authority name from stateDir. A broker for
      // another state directory must not unlink and replace the live endpoint.
      // Crash residue is preserved for explicit operator reconciliation.
      throw new Error(BROKER_REFUSE.SOCKET_PATH_OCCUPIED)
    }
    brokerKey = loadBrokerKey(stateDir)
    // Bind before the dispatcher exists. A launch that cannot own its
    // activation must die here rather than serve one request unbound.
    if (activationDigest !== undefined) {
      bindActivation(stateDir, activationDigest)
    } else if (readActivationBinding(stateDir) !== null) {
      throw new Error(BROKER_REFUSE.ACTIVATION_UNBOUND)
    }
    if (rootControlState !== undefined) {
      if (authorityExpectation === null) throw new Error(BROKER_REFUSE.IDENTITY_CONTROL_UNBOUND)
      const candidate = admitIdentityControl({
        state: rootControlState,
        expectedSubject: authorityExpectation.subject,
        expectedControlDigest: authorityExpectation.activeControlDigest,
        rootPublicKeyPem,
      })
      if (!candidate.ok) throw new Error(candidate.reason)
      bindIdentityControlState(stateDir, rootControlState)
    }
    const persistedIdentityControl = readIdentityControlState(stateDir)
    if ((authorityExpectation === null) !== (persistedIdentityControl === null)) {
      throw new Error(BROKER_REFUSE.IDENTITY_CONTROL_UNBOUND)
    }
    if (authorityExpectation !== null) {
      const control = admitIdentityControl({
        state: persistedIdentityControl,
        expectedSubject: authorityExpectation.subject,
        expectedControlDigest: authorityExpectation.activeControlDigest,
        rootPublicKeyPem,
      })
      if (!control.ok) throw new Error(control.reason)
    }
    dispatch = brokerDispatch({
      stateDir,
      rootPublicKeyPem,
      confinement,
      brokerKey,
      routeIsIntact: () => socketRouteIsIntact(socketPath, socketIdentity, socketGroupAccess),
      issuerSocket,
      review,
      expectedActivationDigest: activationDigest,
      rendererId,
      kiraRecallPolicy,
      workspaceRoots,
      subjectAuthority: subjectAuthorityContext ?? undefined,
      selectSubjectAuthority,
      subjectAuthorityExpectation: dynamicAuthorityExpectation ?? undefined,
      startBackground: (factory) => { void trackActiveWork(factory) },
      stoppingSignal: stoppingController.signal,
    })
  } catch (error) {
    releaseState()
    throw error
  }
  const routeChallenge = randomBytes(32).toString('base64')
  const routePublicKey = canonicalEd25519PublicKey(brokerKey.publicPem)
  if (routePublicKey === null) throw new Error('broker:key-state-malformed')
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    const decoder = new StringDecoder('utf8')
    let buffer = ''
    // Per-connection, because the fact being recorded is per-peer: this socket's
    // other end echoed launch-provisioned bytes after the broker observed
    // EACCES/EPERM at the token path. This does not identify a uid or exclude a
    // relay. Nothing carries across connections.
    const connection = { provenClass: null, peerEchoedAt: null }
    socket.on('data', async (chunk) => {
      buffer += decoder.write(chunk)
      // Frames are bounded by UTF-8 BYTES, not JavaScript characters: an
      // emoji-heavy frame doubles its byte count per char and would slip a
      // character-count bound.
      if (Buffer.byteLength(buffer, 'utf8') > MAX_FRAME_BYTES) {
        socket.end(`${JSON.stringify({ ok: false, state: "REFUSED", reason: BROKER_REFUSE.OVERSIZE })}\n`)
        buffer = ''
        socket.removeAllListeners('data')
        return
      }
      let cut
      while ((cut = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 1)
        if (line.trim() === '') continue
        let request
        try {
          request = JSON.parse(line)
        } catch {
          socket.write(`${JSON.stringify({ ok: false, reason: BROKER_REFUSE.UNPARSEABLE })}\n`)
          continue
        }
        const transportId = readTransportId(request)
        if (!transportId.ok) {
          socket.write(`${JSON.stringify({ ok: false, state: 'REFUSED', reason: BROKER_REFUSE.REQUEST_ID_INVALID })}\n`)
          continue
        }
        // The challenge is public once sent. What identifies this listener is
        // its signature under the broker key, which another uid cannot read.
        // A same-uid replacement can read that key; this strengthens endpoint
        // detection but does not claim custody against the broker's own uid.
        if (request?.op === 'broker:route-probe' && request.challenge === routeChallenge) {
          if (stopping) {
            buffer = ''
            socket.removeAllListeners('data')
            socket.end(`${JSON.stringify({ id: transportId.value, ok: false, state: 'REFUSED', reason: BROKER_REFUSE.STOPPING })}\n`)
            return
          }
          const signature = edSign(null, Buffer.from(routeChallenge, 'base64'), brokerKey.privateKey).toString('base64')
          const frame = `${JSON.stringify({ id: transportId.value, ok: true, signature })}\n`
          socket.write(frame)
          continue
        }
        if (stopping) {
          buffer = ''
          socket.removeAllListeners('data')
          socket.end(`${JSON.stringify({ id: transportId.value, ok: false, state: 'REFUSED', reason: BROKER_REFUSE.STOPPING })}\n`)
          return
        }
        let reply
        try {
          // This bounds a caller's wait for asynchronous work. It cannot
          // interrupt a synchronous filesystem call; timed-out work remains
          // tracked so close waits for its eventual outcome rather than
          // releasing the state lease while an effect may still be running.
          const work = trackActiveWork(() => {
            // A client that connected before the path changed can still reach
            // this listener. It must not cause an effect after the pathname no
            // longer names this broker's socket. New callers are protected by
            // the directory-custody gate below; this check fails closed for
            // already-connected callers.
            if (!socketRouteIsIntact(socketPath, socketIdentity, socketGroupAccess)) {
              return { ok: false, state: 'REFUSED', reason: BROKER_REFUSE.SOCKET_ROUTE_LOST }
            }
            return dispatch(request, connection)
          })
          let timeout
          const timer = new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('broker:request-timeout')), 30000)
            if (typeof timeout.unref === 'function') timeout.unref()
          })
          try {
            reply = await Promise.race([work, timer])
          } finally {
            clearTimeout(timeout)
          }
        } catch (error) {
          const detail = String(error?.message ?? error)
          if (detail === 'broker:request-timeout') {
            reply = { ok: false, state: 'INDETERMINATE', reason: 'broker:request-timeout', detail: 'effect exceeded 30s; outcome unknown' }
          } else {
            // An unexpected dispatcher failure can escape after an effect began,
            // so the transport never reclassifies it as a pre-effect refusal.
            reply = { ok: false, state: 'INDETERMINATE', reason: 'broker:dispatch-outcome-indeterminate', detail }
          }
        }
        socket.write(serializeBrokerReply(transportId.value, reply))
      }
    })
    socket.on('error', () => { /* a caller that hangs up mid-frame is not an event this process acts on */ })
  })

  return new Promise((resolve, reject) => {
    let listenSettled = false
    const failListen = (error) => {
      if (listenSettled) return
      listenSettled = true
      releaseState()
      reject(error)
    }
    const abandonAmbiguousListener = (error) => {
      if (listenSettled) return
      // Node removes a Unix socket by pathname during `server.close()`. Once
      // the name could point somewhere else, closing would alter the foreign
      // endpoint. Leave this server unreachable and retain the state lease;
      // the caller receives no usable broker and an operator must reconcile.
      listenSettled = true
      for (const socket of sockets) socket.destroy()
      // The listener is deliberately left open but unreachable rather than
      // closed by pathname. Consume a later transport error so this
      // fail-closed abandonment cannot crash the supervising process.
      server.on('error', () => {})
      server.unref()
      reject(error)
    }
    server.once('error', failListen)
    try {
      server.listen(socketPath, () => {
        if (listenSettled) return
        try {
          configureServingSocketAccess(socketPath, socketGroupAccess)
        } catch (error) {
          // A failure here may mean the pathname was replaced after listen.
          // Closing by pathname could unlink that foreign endpoint, and
          // releasing the state lease before close completes could admit a
          // second writer. Preserve the lease and abandon the ambiguous route.
          abandonAmbiguousListener(error)
          return
        }
        void identifyServingSocket(socketPath, routeChallenge, routePublicKey).then((identity) => {
          if (listenSettled) return
          socketIdentity = identity
          listenSettled = true
          server.off('error', failListen)
          let closePromise = null
          resolve({
            close: () => {
              if (closePromise !== null) return closePromise
              // Node's Unix-server close unlinks by pathname. If a same-UID
              // process already replaced that name, calling it would delete the
              // foreign listener despite our identity-aware cleanup helper. Do
              // not perform a graceful close on that ambiguity: destroy retained
              // peers, leave the state lease for operator recovery, and make the
              // caller choose a process-level fail-closed shutdown.
              if (!socketRouteIsIntact(socketPath, socketIdentity, socketGroupAccess)) {
                for (const socket of sockets) socket.destroy()
                server.unref()
                return Promise.reject(new Error(BROKER_REFUSE.SOCKET_ROUTE_LOST))
              }
              stopping = true
              stoppingController.abort()
              // This check covers a replacement observed before close begins.
              // Node offers no compare-and-close primitive: a same-UID process
              // can still replace the pathname after this check and before its
              // close implementation unlinks it. A non-writable directory
              // owned by a distinct supervisor UID is required to close that
              // residual race; this reference does not claim it.
              closePromise = new Promise((done, fail) => {
                let closeStarted = false
                let finalized = false
                const beginClose = () => {
                  if (finalized || closeStarted || activeWork.size !== 0) return
                  if (!socketRouteIsIntact(socketPath, socketIdentity, socketGroupAccess)) {
                    finalized = true
                    notifyWorkSettled = () => {}
                    for (const socket of sockets) socket.destroy()
                    server.unref()
                    fail(new Error(BROKER_REFUSE.SOCKET_ROUTE_LOST))
                    return
                  }
                  closeStarted = true
                  // Only quiescence closes the listener. Until this point the
                  // route stays bound so accepted workers can re-check it, and
                  // new callers receive broker:stopping without joining work.
                  for (const socket of sockets) socket.destroy()
                  server.close(() => {
                    if (finalized) return
                    finalized = true
                    notifyWorkSettled = () => {}
                    try {
                      removeOwnedSocket(socketPath, socketIdentity)
                      releaseState()
                      done()
                    } catch (error) {
                      fail(error)
                    }
                  })
                }
                notifyWorkSettled = beginClose
                beginClose()
              })
              return closePromise
            },
          })
        }, abandonAmbiguousListener)
      })
    } catch (error) {
      failListen(error)
    }
  })
}

/**
 * The dispatcher: status, proposals, and unbound legacy `memory.put` behind
 * the hardened verifier.
 *
 * @param {object} deps
 * @param {string} deps.stateDir - the broker's own directory.
 * @param {string} deps.rootPublicKeyPem - the root grants must verify against.
 * @param {{ privateKey: import('node:crypto').KeyObject, publicPem: string }} deps.brokerKey - verified receipt identity loaded by {@link serve}.
 * @param {ReturnType<typeof assertBootConfinement>} deps.confinement - the boot
   *   gate's result. Required: a dispatcher built without it would have no measured
   *   class to stamp and no seal to enforce, which is the state this gate replaced.
 * @param {() => boolean} deps.routeIsIntact - checks that the serving socket's
 *   secured pathname still names this listener at the admission point.
 * @param {string} [deps.issuerSocket] - trusted issuer route for the
 *   broker-proposal protocol.
 * @param {(request: object, signal: AbortSignal) => Promise<'approved'|'denied'>} [deps.review] -
 *   parent-owned exact-operation review callback.
 * @param {(factory: () => Promise<void>) => void} [deps.startBackground] -
 *   registers accepted proposal work in the serving lifecycle before it runs.
 * @param {AbortSignal} [deps.stoppingSignal] - aborted before graceful close
 *   waits, so pre-effect issuer work refuses without extending shutdown.
 * @param {{subject: string, privacy: readonly string[]}} [deps.kiraRecallPolicy] -
 *   parent-owned KIRA recall policy.
 * @param {unknown} [deps.subjectAuthority] - launch-pinned session-to-Agent
 *   delegation selecting the v5 proposal verifier family.
 * @param {(request: object, signal: AbortSignal) => Promise<unknown>} [deps.selectSubjectAuthority] -
 *   parent-owned proposal-specific v5 delegation selector.
 * @param {unknown} [deps.subjectAuthorityExpectation] - launch-pinned public
 *   identity and route fields required from every dynamic selection.
 * @returns {(request: object, connection: {provenClass: string | null, peerEchoedAt: string | null}) => object | Promise<object>}
 * @throws {TypeError} when `confinement` is absent.
 */
export function brokerDispatch({
  stateDir,
  rootPublicKeyPem,
  confinement,
  brokerKey,
  routeIsIntact,
  issuerSocket,
  review,
  startBackground,
  stoppingSignal,
  expectedActivationDigest,
  rendererId,
  kiraRecallPolicy,
  workspaceRoots,
  subjectAuthority,
  selectSubjectAuthority,
  subjectAuthorityExpectation,
}) {
  if (confinement === undefined) throw new TypeError('brokerDispatch: confinement is required; build it with assertBootConfinement')
  if (brokerKey === undefined) throw new TypeError('brokerDispatch: brokerKey is required; load it through serve')
  if (typeof routeIsIntact !== 'function') throw new TypeError('brokerDispatch: routeIsIntact is required; build it through serve')
  if (canonicalEd25519PublicKey(rootPublicKeyPem) === null) {
    throw new Error(BROKER_REFUSE.ROOT_PUBLIC_KEY_INVALID)
  }
  ensureExactDirectory(join(stateDir, 'nonces'), BROKER_REFUSE.NONCE_DIRECTORY_MALFORMED)
  const book = openNonceBook(stateDir)
  const roots = bindWorkspaceRoots(stateDir, workspaceRoots)
  const { privateKey: brokerPrivateKey, publicPem: brokerPublicKeyPem } = brokerKey
  const receiptKeyId = receiptKeyIdForPublicKey(brokerPublicKeyPem)
  const subjectAuthorityContext = subjectAuthority === undefined || subjectAuthority === null
    ? null
    : createSubjectAuthorityContext(subjectAuthority)
  const dynamicAuthorityExpectation = subjectAuthorityExpectation === undefined
    || subjectAuthorityExpectation === null
    ? null
    : createSubjectAuthorityExpectation(subjectAuthorityExpectation)
  if (subjectAuthorityContext !== null && dynamicAuthorityExpectation !== null) {
    throw new Error(BROKER_REFUSE.AUTHORITY_CONFIGURATION_INVALID)
  }
  if ((dynamicAuthorityExpectation === null) !== (typeof selectSubjectAuthority !== 'function')) {
    throw new Error(BROKER_REFUSE.AUTHORITY_CONFIGURATION_INVALID)
  }
  const authorityExpectation = subjectAuthorityContext ?? dynamicAuthorityExpectation
  const v5Mode = authorityExpectation !== null
  // The seal in force. Raised by a settlement served above the high-water mark,
  // never lowered: lowering it needs a write into a directory only the broker's
  // own uid can enter, which is the party this design does not defend against.
  let seal = confinement.seal
  // A seal publication error can happen after the atomic rename but before
  // the directory flush reports success. At that point neither the old
  // in-memory value nor the replacement is a trustworthy lifetime authority.
  // Poisoning the dispatcher keeps every later request before nonce claim and
  // effect; restart must re-read the persisted high-water mark.
  let sealStateIndeterminate = false
  let settlementTurn = Promise.resolve()
  let issuerTurn = Promise.resolve()
  const proposalNamespaces = new Map()
  const proposalsById = new Map()
  const brokerStoppingSignal = stoppingSignal ?? new AbortController().signal
  const kiraPolicy = readKiraPolicy(kiraRecallPolicy)
  const proposalRouteFailure = typeof issuerSocket !== 'string' || issuerSocket === ''
    || typeof startBackground !== 'function'
    ? BROKER_REFUSE.PROPOSAL_ROUTE_UNAVAILABLE
    : typeof review !== 'function'
      ? BROKER_REFUSE.REVIEW_CHANNEL_UNAVAILABLE
      : null
  const currentPeerObservation = () => measurePeerSeparability({
    tokenPath: confinement.peer.tokenPath ?? undefined,
    tokenSha256: confinement.peer.expectedSha256 ?? undefined,
  })
  // Null means this broker serves no activation binding, which is the
  // pre-activation posture the direct v3 route still uses. It is not the same
  // as "bound to nothing": once a digest is present every effect must name it.
  const activationBinding = expectedActivationDigest ?? null
  const boundRendererId = typeof rendererId === 'string' && HEX_SHA256.test(rendererId) ? rendererId : null
  if (authorityExpectation !== null && authorityExpectation.activationDigest !== activationBinding) {
    throw new Error(BROKER_REFUSE.ACTIVATION_MISMATCH)
  }
  if (authorityExpectation !== null
    && kiraPolicy !== null
    && kiraPolicy.subject !== authorityExpectation.subject) {
    throw new Error(BROKER_REFUSE.KIRA_RECALL_POLICY_INVALID)
  }

  /**
   * Re-read the broker-owned binding and compare it with one proposal's own.
   *
   * This runs immediately before effect admission rather than at boot, so a
   * state directory replaced while this process ran, a proposal captured from
   * an earlier activation, and a service reference held across activations are
   * all refused at the point of use instead of trusted from startup.
   *
   * @param {string | null | undefined} proposalActivationDigest - the digest recorded when the proposal was admitted.
   * @returns {{ok: true} | {ok: false, reason: string, detail?: string}} admission verdict.
   */
  function activationAdmits(proposalActivationDigest) {
    let persisted
    try {
      persisted = readActivationBinding(stateDir)
    } catch (error) {
      return { ok: false, reason: BROKER_REFUSE.ACTIVATION_STATE_MALFORMED, detail: String(error?.message ?? error) }
    }
    if (activationBinding === null) {
      return persisted === null
        ? { ok: true }
        : {
            ok: false,
            reason: BROKER_REFUSE.ACTIVATION_UNBOUND,
            detail: `this broker was started unbound; its state now names ${persisted}`,
          }
    }
    return admitActivation({
      expected: activationBinding,
      persisted,
      presented: proposalActivationDigest,
    })
  }

  /** Re-read and authenticate the locally persisted AUMLOK control head. */
  function identityControlAdmits(expectedAuthority = authorityExpectation) {
    if (expectedAuthority === null) return { ok: true }
    let state
    try {
      state = readIdentityControlState(stateDir)
    } catch (error) {
      return {
        ok: false,
        reason: BROKER_REFUSE.IDENTITY_CONTROL_STATE_MALFORMED,
        detail: String(error?.message ?? error),
      }
    }
    return admitIdentityControl({
      state,
      expectedSubject: expectedAuthority.subject,
      expectedControlDigest: expectedAuthority.activeControlDigest,
      rootPublicKeyPem,
    })
  }
  return async (request, connection = { provenClass: null, peerEchoedAt: null }) => {
    if (request?.op === 'status') {
      const peer = currentPeerObservation()
      const measurement = measureStateDirectory({ stateDir, euid: process.geteuid() })
      return {
        ok: true,
        pid: process.pid,
        env: {
          NODE_OPTIONS: process.env.NODE_OPTIONS ?? null,
          NODE_REPL_EXTERNAL_MODULE: process.env.NODE_REPL_EXTERNAL_MODULE ?? null,
          ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE ?? null,
          LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH ?? null,
        },
        execArgv: process.execArgv,
        cryptoHonest: cryptoIsHonest(),
        expectedDefinitionId: definitionDigest(MEMORY_PUT),
        brokerPublicKeyPem,
        receiptKeyId,
        activationDigest: activationBinding,
        confinement: {
          ceiling: peer.separable ? CONFINEMENT_CLASS.PEER_SEPARATED : measurement.class,
          sealClass: sealStateIndeterminate ? null : seal.class,
          sealReliable: !sealStateIndeterminate,
          // Reported so a client knows whether answering the challenge could
          // raise anything. False here means the broker read the peer token
          // itself, or no token was planted — separation is already disproven.
          peerChallengeAvailable: peer.separable,
        },
      }
    }
    if (request?.op === 'confinement.prove') {
      // The ONLY route to `peer-separated`, gated on a broker read that failed
      // with EACCES/EPERM and a peer echo matching the launcher's pinned digest.
      // This does not identify the peer uid or exclude a relay; the launcher
      // owns that deployment claim. Nothing the peer says can raise its class
      // without the broker-side read failure.
      const peer = currentPeerObservation()
      const verdict = verifyPeerEcho({ peer, echoBase64: request.token })
      if (!verdict.ok) {
        connection.provenClass = null
        connection.peerEchoedAt = null
        return { ok: false, reason: verdict.reason, class: CONFINEMENT_CLASS.STATE_OWNED }
      }
      connection.provenClass = CONFINEMENT_CLASS.PEER_SEPARATED
      connection.peerEchoedAt = new Date().toISOString()
      return { ok: true, class: CONFINEMENT_CLASS.PEER_SEPARATED }
    }
    if (request?.op === 'proposal.open') return openProposalNamespace(request)
    if (request?.op === 'proposal.deposit') return depositProposal(request, connection)
    if (request?.op === 'proposal.status') return proposalStatus(request)
    if (request?.op === KIRA_RECALL_TOOL) return recallKira(request)
    if (request?.op === RECEIPT_INSPECT_OP) return inspectSettledReceipt(request)
    if (request?.op !== 'memory.put') return { ok: false, reason: BROKER_REFUSE.UNKNOWN_OP }
    if (v5Mode) {
      return { ok: false, state: 'REFUSED', reason: BROKER_REFUSE.LEGACY_ROUTE_FORBIDDEN }
    }
    const kira = admitKiraWrite(request.arguments, false)
    if (!kira.ok) return { ...kira, state: 'REFUSED' }
    return withSettlementTurn(request, () => settleGrantRequest({
      request,
      connection,
      verify: verifyV3Grant,
    }))
  }

  /** Serialize only nonce admission and effect settlement, never the human wait. */
  async function withSettlementTurn(request, run) {
    if (request === undefined) throw new TypeError('broker: settlement request is required')
    let releaseTurn
    const previousTurn = settlementTurn
    settlementTurn = new Promise((resolve) => { releaseTurn = resolve })
    await previousTurn
    try {
      return await run()
    } finally {
      releaseTurn()
    }
  }

  /** Keep each issuer admission and authorization pair contiguous. */
  async function withIssuerTurn(run) {
    let releaseTurn
    const previousTurn = issuerTurn
    issuerTurn = new Promise((resolve) => { releaseTurn = resolve })
    await previousTurn
    try {
      return await run()
    } finally {
      releaseTurn()
    }
  }

  /** Bound one parent selector even when a direct-serve callback ignores cancellation. */
  function selectProposalAuthority(request) {
    return new Promise((resolve, reject) => {
      if (brokerStoppingSignal.aborted) {
        reject(new Error(BROKER_REFUSE.STOPPING))
        return
      }
      const controller = new AbortController()
      let settled = false
      let timer
      const finish = (done) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        brokerStoppingSignal.removeEventListener('abort', onAbort)
        done()
      }
      const onAbort = () => finish(() => {
        controller.abort('broker stopped waiting for this authority selection')
        reject(new Error(BROKER_REFUSE.STOPPING))
      })
      timer = setTimeout(() => {
        finish(() => {
          controller.abort('broker authority selection timed out')
          reject(new Error(BROKER_REFUSE.AUTHORITY_TIMED_OUT))
        })
      }, BROKER_AUTHORITY_TIMEOUT_MS)
      brokerStoppingSignal.addEventListener('abort', onAbort, { once: true })
      void Promise.resolve().then(
        () => selectSubjectAuthority(request, controller.signal),
      ).then(
        authority => finish(() => resolve(authority)),
        error => finish(() => reject(error)),
      )
    })
  }

  /** Read one exact KIRA query under the parent-owned launch policy. */
  /**
   * Read-only inspection of one settled receipt.
   *
   * The module is imported dynamically on first use, which keeps
   * `receipt-v3/verify.mjs` out of the frozen authority source graph: the
   * verifier belongs to the recipient's trusted path, not the broker's. Measured
   * at this revision, neither `receipt-v3/verify.mjs` nor
   * `broker/receipt-inspect.mjs` appears in that graph.
   *
   * WHAT THAT EXCLUSION IS NOT. It is not privilege separation and it is not a
   * guarantee that the frozen digest stays put. The inventory enumerates STATIC
   * dependencies; code reached only by a dynamic import still executes with this
   * process's full capabilities, and a change to any INCLUDED broker source moves
   * the digest — adding this hook did, from `1bf461ec` to `0323a2fc`, because
   * `broker.mjs` is itself a root of the graph. An earlier version of this
   * comment claimed the hook could not move the digest. That was wrong.
   */
  async function inspectSettledReceipt(request) {
    const identifier = request?.receiptSha256
    if (typeof identifier !== 'string' || !/^[0-9a-f]{64}$/u.test(identifier)) {
      // ONE FIELD NAME FOR ONE KIND OF OUTCOME. The module reports refusals as
      // `refusal`; the older ops use `reason`, and returning `reason` here made
      // the same refusal arrive under two names depending on which layer caught
      // it, which a client cannot distinguish from two different outcomes.
      return { ok: false, refusal: 'inspect:identifier-malformed' }
    }
    const module = await import('./receipt-inspect.mjs')
    // The anchors are the ones THIS process already holds: the broker's own
    // receipt key, and the root the grants verified against. No caller-supplied
    // key is accepted, because a caller that could name the anchor could name
    // its own.
    return module.inspectReceipt({
      stateDir,
      receiptSha256: identifier,
      // The artifact bytes cross the wire only when the caller states that
      // purpose, because they contain operation arguments and paths.
      includeArtifact: request?.includeArtifact === true,
      anchors: {
        executorPublicKeys: [brokerPublicKeyPem],
        issuerPublicKeys: [rootPublicKeyPem],
        // No owner key is registered anywhere in this tree, so the owner role is
        // reported unavailable rather than filled with the issuer root.
        ownerPublicKeys: [],
      },
    })
  }

  function recallKira(request) {
    const frame = snapshotExactDataFields(request, ['op'], ['kind', 'id'])
    if (frame === null) {
      return { ok: false, state: 'REFUSED', reason: BROKER_REFUSE.KIRA_RECALL_FRAME_NOT_EXACT }
    }
    if (kiraPolicy === null) {
      return { ok: false, state: 'REFUSED', reason: BROKER_REFUSE.KIRA_RECALL_UNCONFIGURED }
    }
    if ('kind' in frame && !KIRA_RECORD_KINDS.includes(frame.kind)) {
      return { ok: false, state: 'REFUSED', reason: BROKER_REFUSE.KIRA_RECALL_KIND_INVALID }
    }
    if (brokerStoppingSignal.aborted) {
      return { ok: false, state: 'REFUSED', reason: BROKER_REFUSE.STOPPING }
    }
    if (!routeIsIntact()) {
      return { ok: false, state: 'REFUSED', reason: BROKER_REFUSE.SOCKET_ROUTE_LOST }
    }
    // The recall reader and the effect/record append span use synchronous file
    // operations, so one event-loop turn observes either side of a settlement,
    // never its partial state. Keeping reads out of the settlement promise
    // queue also prevents a caller from banking future reads ahead of effects
    // or graceful shutdown.
    return {
      ok: true,
      ...readBrokerKiraRecall(stateDir, {
        subject: kiraPolicy.subject,
        permittedPrivacy: kiraPolicy.privacy,
        ...('kind' in frame ? { kind: frame.kind } : {}),
      }),
    }
  }

  /** The legacy route has one code-owned verifier family. */
  function verifyV3Grant({ grant, request, expectedOperationDigest }) {
    const verdict = verifyGrant({
      grant,
      toolName: request.toolName,
      args: request.arguments,
      rootPublicKeyPem,
      seenNonces: book.set,
      claimNonce: book.claim,
      now: Date.now(),
      expectedDefinitionId: definitionDigest(MEMORY_PUT),
      expectedOperationDigest,
      expectedReceiptKeyId: receiptKeyId,
    })
    return verdict
  }

  /** The broker-proposal route has one code-owned verifier family. */
  function verifyV4Grant({ grant, request, expectedOperationDigest }) {
    const verdict = verifyGrantV4({
      grant,
      toolName: request.toolName,
      args: request.arguments,
      rootPublicKeyPem,
      seenNonces: book.set,
      claimNonce: book.claim,
      now: Date.now(),
      expectedDefinitionId: definitionDigest(request.toolName),
      expectedOperationDigest,
      expectedReceiptKeyId: receiptKeyId,
    })
    return verdict
  }

  /** Build proposal-scoped admission and verification for one exact authority selection. */
  function settlementChecksForV5Authority(authorityContext) {
    const selected = createSubjectAuthorityContext(authorityContext)
    return Object.freeze({
      authorityAdmits: () => identityControlAdmits(selected),
      verify: ({ grant, request, expectedOperationDigest }) => verifyV5Grant(
        selected,
        { grant, request, expectedOperationDigest },
      ),
    })
  }

  /** Repeat every launch- and proposal-owned v5 expectation at check-at-use. */
  function verifyV5Grant(authorityContext, { grant, request, expectedOperationDigest }) {
    const control = identityControlAdmits(authorityContext)
    if (!control.ok) return control
    const action = delegatedAction(request.toolName, request.arguments)
    return verifyGrantV5({
      grant,
      toolName: request.toolName,
      args: request.arguments,
      rootPublicKeyPem,
      seenNonces: book.set,
      claimNonce: book.claim,
      now: Date.now(),
      expectedDefinitionId: definitionDigest(request.toolName),
      expectedOperationDigest,
      expectedReceiptKeyId: receiptKeyId,
      parentDelegationClaim: authorityContext.parentDelegationClaim,
      delegationClaim: authorityContext.delegationClaim,
      expectedSubject: authorityContext.subject,
      expectedControlDigest: authorityContext.activeControlDigest,
      expectedParentDigest: authorityContext.parentDigest,
      expectedActivationDigest: authorityContext.activationDigest,
      expectedAudience: authorityContext.audience,
      expectedResource: action.resource,
      expectedBudget: action.budget,
    })
  }

  /** Admit one exact inert request and start broker-owned work. */
  function depositProposal(request, connection) {
    if (brokerStoppingSignal.aborted) return proposalRefusal(BROKER_REFUSE.STOPPING)
    if (proposalRouteFailure !== null) return proposalRefusal(proposalRouteFailure)
    const frame = snapshotExactDataFields(request, ['op', 'proposalNamespace', 'callId', 'toolName', 'arguments'], ['id'])
    if (frame === null || frame.op !== 'proposal.deposit') {
      return proposalRefusal(BROKER_REFUSE.PROPOSAL_FRAME_NOT_EXACT)
    }
    const namespace = proposalNamespaces.get(frame.proposalNamespace)
    if (typeof frame.proposalNamespace !== 'string'
      || !/^[0-9a-f]{32}$/.test(frame.proposalNamespace)
      || namespace === undefined) {
      return proposalRefusal(BROKER_REFUSE.PROPOSAL_NAMESPACE_INVALID)
    }
    if (!isBoundedCallId(frame.callId)) {
      return proposalRefusal(BROKER_REFUSE.PROPOSAL_CALL_ID_INVALID)
    }
    if (!isGovernedEffect(frame.toolName)) {
      return proposalRefusal(REFUSE.TOOL_MISMATCH)
    }
    if (frame.toolName === WORKSPACE_PATCH && !v5Mode) {
      return proposalRefusal('broker:workspace-subject-authority-required')
    }
    const snapshot = snapshotProposalArguments(frame.arguments, frame.toolName)
    if (!snapshot.ok) return proposalRefusal(snapshot.reason)
    const fingerprint = createHash('sha256').update(canonicalJSON({
      callId: frame.callId,
      toolName: frame.toolName,
      arguments: snapshot.arguments,
    }), 'utf8').digest('hex')
    const existing = namespace.get(frame.callId)
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) {
        return proposalRefusal(BROKER_REFUSE.PROPOSAL_CALL_ID_REUSED)
      }
      return publicProposal(existing)
    }
    if (proposalsById.size >= BROKER_PROPOSAL_MAX_ENTRIES) {
      return proposalRefusal(BROKER_REFUSE.PROPOSAL_TABLE_FULL)
    }
    let proposalId
    do proposalId = randomBytes(16).toString('hex')
    while (proposalsById.has(proposalId))
    const entry = {
      callId: frame.callId,
      proposalNamespace: frame.proposalNamespace,
      fingerprint,
      proposalId,
      status: BROKER_PROPOSAL_STATUS.PENDING,
      toolName: frame.toolName,
      arguments: snapshot.arguments,
      // The activation in force when this proposal was admitted. It travels
      // with the proposal so a later settlement compares what was true at
      // admission against what is true at use, not against itself.
      activationDigest: activationBinding,
      connection: Object.freeze({
        provenClass: connection.provenClass,
        peerEchoedAt: connection.peerEchoedAt,
      }),
    }
    // Publication precedes the worker: a disconnected caller can retry its
    // callId and recover this exact occurrence without creating another ask.
    namespace.set(entry.callId, entry)
    proposalsById.set(entry.proposalId, entry)
    startBackground(async () => { await runProposal(entry) })
    return publicProposal(entry)
  }

  /** Mint one collision-resistant retry namespace without asserting client identity. */
  function openProposalNamespace(request) {
    if (brokerStoppingSignal.aborted) return proposalRefusal(BROKER_REFUSE.STOPPING)
    if (proposalRouteFailure !== null) return proposalRefusal(proposalRouteFailure)
    const frame = snapshotExactDataFields(request, ['op'], ['id'])
    if (frame === null || frame.op !== 'proposal.open') {
      return proposalRefusal(BROKER_REFUSE.PROPOSAL_FRAME_NOT_EXACT)
    }
    if (proposalNamespaces.size >= BROKER_PROPOSAL_MAX_NAMESPACES) {
      return proposalRefusal(BROKER_REFUSE.PROPOSAL_NAMESPACE_TABLE_FULL)
    }
    let proposalNamespace
    do proposalNamespace = randomBytes(16).toString('hex')
    while (proposalNamespaces.has(proposalNamespace))
    proposalNamespaces.set(proposalNamespace, new Map())
    return { ok: true, proposalNamespace }
  }

  /** Return one public broker-proposal result without exposing authority artifacts. */
  function proposalStatus(request) {
    const frame = snapshotExactDataFields(request, ['op', 'proposalNamespace', 'proposalId'], ['id'])
    if (frame === null
      || frame.op !== 'proposal.status'
      || typeof frame.proposalNamespace !== 'string'
      || !/^[0-9a-f]{32}$/.test(frame.proposalNamespace)
      || typeof frame.proposalId !== 'string'
      || !/^[0-9a-f]{32}$/.test(frame.proposalId)) {
      return proposalRefusal(BROKER_REFUSE.PROPOSAL_FRAME_NOT_EXACT)
    }
    const entry = proposalsById.get(frame.proposalId)
    return entry === undefined || entry.proposalNamespace !== frame.proposalNamespace
      ? proposalRefusal(BROKER_REFUSE.PROPOSAL_UNAVAILABLE)
      : publicProposal(entry)
  }

  /** Complete one accepted proposal without retaining its grant or signature. */
  async function runProposal(entry) {
    let authorized
    try {
      authorized = await withIssuerTurn(async () => authorizeProposal(entry))
    } catch {
      terminalizeProposal(entry, BROKER_PROPOSAL_STATUS.REFUSED,
        brokerStoppingSignal.aborted ? BROKER_REFUSE.STOPPING : BROKER_REFUSE.PROPOSAL_INTERNAL_FAILURE)
      return
    }
    if (!authorized.ok) {
      terminalizeProposal(entry, BROKER_PROPOSAL_STATUS.REFUSED, authorized.reason)
      return
    }
    try {
      const settled = await withSettlementTurn(authorized.request, () => settleGrantRequest({
        request: authorized.request,
        connection: entry.connection,
        grant: authorized.grant,
        authorityAdmits: authorized.authorityAdmits,
        verify: authorized.verify,
        activationDigest: entry.activationDigest,
      }))
      if (settled?.ok === true && settled.state === 'SETTLED') {
        terminalizeProposal(entry, BROKER_PROPOSAL_STATUS.SETTLED, undefined, settled.receipt)
      } else if (settled?.state === 'INDETERMINATE') {
        terminalizeProposal(
          entry,
          BROKER_PROPOSAL_STATUS.INDETERMINATE,
          typeof settled.reason === 'string' ? settled.reason : BROKER_REFUSE.PROPOSAL_INTERNAL_FAILURE,
        )
      } else if (settled?.ok === false && settled.state === 'REFUSED') {
        terminalizeProposal(
          entry,
          BROKER_PROPOSAL_STATUS.REFUSED,
          typeof settled.reason === 'string' ? settled.reason : BROKER_REFUSE.PROPOSAL_INTERNAL_FAILURE,
        )
      } else {
        terminalizeProposal(entry, BROKER_PROPOSAL_STATUS.INDETERMINATE, BROKER_REFUSE.PROPOSAL_INTERNAL_FAILURE)
      }
    } catch {
      terminalizeProposal(entry, BROKER_PROPOSAL_STATUS.INDETERMINATE, BROKER_REFUSE.PROPOSAL_INTERNAL_FAILURE)
    }
  }

  /** Select the code-owned proposal grant family pinned at launch. */
  function authorizeProposal(entry) {
    const kira = entry.toolName === MEMORY_PUT ? admitKiraWrite(entry.arguments, v5Mode) : { ok: true }
    if (!kira.ok) return kira
    if (entry.toolName === WORKSPACE_PATCH) {
      try { preflightWorkspacePatch(roots, entry.arguments) } catch (error) {
        return { ok: false, reason: String(error?.message ?? error) }
      }
    }
    if (dynamicAuthorityExpectation !== null) return authorizeProposalWithDynamicV5(entry)
    return subjectAuthorityContext === null
      ? authorizeProposalV4(entry)
      : authorizeProposalV5(entry, subjectAuthorityContext)
  }

  /** Build one v4 approval artifact, obtain parent review, then exchange it with the issuer. */
  async function authorizeProposalV4(entry) {
    const expectedDefinitionId = definitionDigest(MEMORY_PUT)
    if (brokerStoppingSignal.aborted) return { ok: false, reason: BROKER_REFUSE.STOPPING }
    if (activationBinding === null) return { ok: false, reason: BROKER_REFUSE.ACTIVATION_UNBOUND }
    if (boundRendererId === null) return { ok: false, reason: BROKER_REFUSE.RENDERER_UNBOUND }
    const exp = Math.floor(Date.now() / 1000) + BROKER_PROPOSAL_GRANT_TTL_SECONDS
    const request = { toolName: MEMORY_PUT, arguments: entry.arguments }
    const operation = buildOperation(entry.arguments, exp)
    const claims = {
      toolName: MEMORY_PUT,
      digest: payloadDigest(MEMORY_PUT, entry.arguments),
      nonce: newNonce(),
      exp,
      definitionId: expectedDefinitionId,
      operationDigest: operationDigest(operation),
      receiptKeyId,
    }
    const digest = authorizationDigest(claims)
    let approvalArtifact
    let artifactDigest
    try {
      approvalArtifact = createApprovalArtifact({
        operationArguments: entry.arguments,
        expiry: exp,
        activationDigest: activationBinding,
        occurrenceId: randomBytes(16).toString('hex'),
        rendererId: boundRendererId,
      })
      artifactDigest = approvalArtifactDigest(approvalArtifact)
    } catch {
      return { ok: false, reason: BROKER_REFUSE.APPROVAL_ARTIFACT_MALFORMED }
    }
    if (approvalArtifact.operationDigest !== claims.operationDigest
      || approvalArtifact.expiry !== exp
      || approvalArtifact.definitionId !== expectedDefinitionId) {
      return { ok: false, reason: BROKER_REFUSE.APPROVAL_ARTIFACT_MALFORMED }
    }
    const reviewRequest = Object.freeze({
      type: BROKER_REVIEW_REQUEST,
      reviewId: randomBytes(16).toString('hex'),
      proposalId: entry.proposalId,
      artifact: approvalArtifact,
      artifactDigest,
      operationDigest: claims.operationDigest,
      authorizationDigest: digest,
      expiresAt: exp,
    })
    let reviewDecision
    try {
      reviewDecision = await review(reviewRequest, brokerStoppingSignal)
    } catch (error) {
      const reason = String(error?.message ?? error)
      const reviewFailure = [
        BROKER_REFUSE.REVIEW_CHANNEL_UNAVAILABLE,
        BROKER_REFUSE.REVIEW_RESPONSE_MALFORMED,
        BROKER_REFUSE.REVIEW_TIMED_OUT,
        BROKER_REFUSE.STOPPING,
      ].includes(reason)
      return {
        ok: false,
        reason: reviewFailure
          ? reason
          : brokerStoppingSignal.aborted
            ? BROKER_REFUSE.STOPPING
            : BROKER_REFUSE.REVIEW_CHANNEL_UNAVAILABLE,
      }
    }
    if (reviewDecision !== 'approved' && reviewDecision !== 'denied') {
      return { ok: false, reason: BROKER_REFUSE.REVIEW_RESPONSE_MALFORMED }
    }
    if (reviewDecision === 'denied') return { ok: false, reason: BROKER_REFUSE.REVIEW_DENIED }
    if (brokerStoppingSignal.aborted) return { ok: false, reason: BROKER_REFUSE.STOPPING }
    let admitted
    let authorized
    try {
      admitted = await requestIssuer(issuerSocket, { op: 'admit', digest }, brokerStoppingSignal)
      if (!isExactIssuerSuccess(admitted, ['ok'])) {
        return { ok: false, reason: issuerFailureReason(admitted) }
      }
      authorized = await requestIssuer(issuerSocket, {
        op: 'authorize',
        digest,
        artifact: approvalArtifact,
        artifactDigest,
      }, brokerStoppingSignal)
    } catch {
      return {
        ok: false,
        reason: brokerStoppingSignal.aborted ? BROKER_REFUSE.STOPPING : BROKER_REFUSE.ISSUER_TRANSPORT_FAILED,
      }
    }
    if (brokerStoppingSignal.aborted) return { ok: false, reason: BROKER_REFUSE.STOPPING }
    if (!isExactIssuerSuccess(authorized, ['ok', 'digest', 'signature'])
      || authorized.digest !== digest
      || !isCanonicalEd25519Signature(authorized.signature)) {
      return { ok: false, reason: issuerFailureReason(authorized) }
    }
    const grant = { ...claims, signature: authorized.signature }
    const artifact = verifyIssuedGrantV4({
      grant,
      toolName: MEMORY_PUT,
      args: entry.arguments,
      rootPublicKeyPem,
      now: Date.now(),
      expectedDefinitionId,
      expectedOperationDigest: claims.operationDigest,
      expectedReceiptKeyId: receiptKeyId,
    })
    if (!artifact.ok) return { ok: false, reason: BROKER_REFUSE.ISSUER_RESPONSE_MALFORMED }
    return { ok: true, request, grant, verify: verifyV4Grant }
  }

  /** Ask the parent for one exact proposal-specific v5 delegation. */
  async function authorizeProposalWithDynamicV5(entry) {
    const expectedDefinitionId = definitionDigest(entry.toolName)
    if (brokerStoppingSignal.aborted) return { ok: false, reason: BROKER_REFUSE.STOPPING }
    if (dynamicAuthorityExpectation === null || activationBinding === null) {
      return { ok: false, reason: BROKER_REFUSE.AUTHORITY_CONFIGURATION_INVALID }
    }
    const control = identityControlAdmits()
    if (!control.ok) return control
    if (boundRendererId === null) return { ok: false, reason: BROKER_REFUSE.RENDERER_UNBOUND }
    const expiresAt = Math.floor(Date.now() / 1000) + BROKER_PROPOSAL_GRANT_TTL_SECONDS
    const request = { toolName: entry.toolName, arguments: entry.arguments }
    const operation = buildOperation(entry.arguments, expiresAt, entry.toolName)
    const action = delegatedAction(entry.toolName, entry.arguments)
    let artifact
    let artifactDigest
    try {
      artifact = createApprovalArtifact({
        toolName: entry.toolName,
        operationArguments: entry.arguments,
        expiry: expiresAt,
        activationDigest: activationBinding,
        occurrenceId: randomBytes(16).toString('hex'),
        rendererId: boundRendererId,
      })
      artifactDigest = approvalArtifactDigest(artifact)
    } catch {
      return { ok: false, reason: BROKER_REFUSE.APPROVAL_ARTIFACT_MALFORMED }
    }
    const expectedOperationDigest = operationDigest(operation)
    if (artifact.operationDigest !== expectedOperationDigest
      || artifact.expiry !== expiresAt
      || artifact.definitionId !== expectedDefinitionId) {
      return { ok: false, reason: BROKER_REFUSE.APPROVAL_ARTIFACT_MALFORMED }
    }
    const selectionRequest = Object.freeze({
      type: BROKER_AUTHORITY_REQUEST,
      selectionId: randomBytes(16).toString('hex'),
      proposalId: entry.proposalId,
      operationDigest: expectedOperationDigest,
      toolName: entry.toolName,
      artifactDigest,
      activationDigest: activationBinding,
      audience: dynamicAuthorityExpectation.audience,
      resource: action.resource,
      budget: action.budget,
      expiresAt,
    })
    let selected
    try {
      selected = createSubjectAuthorityContext(await selectProposalAuthority(selectionRequest))
    } catch (error) {
      const reason = String(error?.message ?? error)
      const authorityFailure = [
        BROKER_REFUSE.AUTHORITY_CHANNEL_UNAVAILABLE,
        BROKER_REFUSE.AUTHORITY_RESPONSE_MALFORMED,
        BROKER_REFUSE.AUTHORITY_TIMED_OUT,
        BROKER_REFUSE.STOPPING,
      ].includes(reason)
      return {
        ok: false,
        reason: authorityFailure
          ? reason
          : brokerStoppingSignal.aborted
            ? BROKER_REFUSE.STOPPING
            : BROKER_REFUSE.AUTHORITY_RESPONSE_MALFORMED,
      }
    }
    if (!selectedAuthorityMatchesRequest(selected, dynamicAuthorityExpectation, selectionRequest)) {
      return { ok: false, reason: BROKER_REFUSE.AUTHORITY_RESPONSE_MALFORMED }
    }
    return authorizeProposalV5(entry, selected, {
      request,
      action,
      exp: expiresAt,
      operationDigest: expectedOperationDigest,
      approvalArtifact: artifact,
      artifactDigest,
    })
  }

  /** Build one subject-bound v5 artifact without exposing its grant to the guest. */
  async function authorizeProposalV5(entry, authorityContext, prepared = null) {
    const expectedDefinitionId = definitionDigest(entry.toolName)
    if (brokerStoppingSignal.aborted) return { ok: false, reason: BROKER_REFUSE.STOPPING }
    if (activationBinding === null) {
      return { ok: false, reason: BROKER_REFUSE.ACTIVATION_UNBOUND }
    }
    const control = identityControlAdmits(authorityContext)
    if (!control.ok) return control
    if (boundRendererId === null) return { ok: false, reason: BROKER_REFUSE.RENDERER_UNBOUND }
    const now = Date.now()
    const exp = prepared?.exp ?? Math.min(
      Math.floor(now / 1000) + BROKER_PROPOSAL_GRANT_TTL_SECONDS,
      authorityContext.delegationClaim.expiresAt,
    )
    const request = prepared?.request ?? { toolName: entry.toolName, arguments: entry.arguments }
    const action = prepared?.action ?? delegatedAction(entry.toolName, entry.arguments)
    const expectedOperationDigest = prepared?.operationDigest ?? operationDigest(buildOperation(entry.arguments, exp, entry.toolName))
    const claims = {
      toolName: entry.toolName,
      digest: payloadDigest(entry.toolName, entry.arguments),
      nonce: newNonce(),
      exp,
      definitionId: expectedDefinitionId,
      operationDigest: expectedOperationDigest,
      receiptKeyId,
      subject: authorityContext.subject,
      parentDigest: authorityContext.parentDigest,
      delegationDigest: authorityContext.delegationDigest,
      controlDigest: authorityContext.activeControlDigest,
      delegationKind: 'agent',
      activationDigest: authorityContext.activationDigest,
      audience: authorityContext.audience,
      resource: action.resource,
      budget: action.budget,
    }
    const inspected = inspectAuthorizationClaimsV5({
      claims,
      toolName: entry.toolName,
      args: entry.arguments,
      now,
      expectedDefinitionId,
      expectedOperationDigest: claims.operationDigest,
      expectedReceiptKeyId: receiptKeyId,
      parentDelegationClaim: authorityContext.parentDelegationClaim,
      delegationClaim: authorityContext.delegationClaim,
      expectedSubject: authorityContext.subject,
      expectedControlDigest: authorityContext.activeControlDigest,
      expectedParentDigest: authorityContext.parentDigest,
      expectedActivationDigest: authorityContext.activationDigest,
      expectedAudience: authorityContext.audience,
      expectedResource: action.resource,
      expectedBudget: action.budget,
    })
    if (!inspected.ok) return inspected
    const digest = authorizationDigestV5(claims)
    let approvalArtifact = prepared?.approvalArtifact
    let artifactDigest = prepared?.artifactDigest
    if (approvalArtifact === undefined || artifactDigest === undefined) {
      try {
        approvalArtifact = createApprovalArtifact({
          toolName: entry.toolName,
          operationArguments: entry.arguments,
          expiry: exp,
          activationDigest: activationBinding,
          occurrenceId: randomBytes(16).toString('hex'),
          rendererId: boundRendererId,
        })
        artifactDigest = approvalArtifactDigest(approvalArtifact)
      } catch {
        return { ok: false, reason: BROKER_REFUSE.APPROVAL_ARTIFACT_MALFORMED }
      }
    }
    if (approvalArtifact.operationDigest !== claims.operationDigest
      || approvalArtifact.expiry !== exp
      || approvalArtifact.definitionId !== expectedDefinitionId) {
      return { ok: false, reason: BROKER_REFUSE.APPROVAL_ARTIFACT_MALFORMED }
    }
    const reviewRequest = Object.freeze({
      type: BROKER_REVIEW_REQUEST,
      reviewId: randomBytes(16).toString('hex'),
      proposalId: entry.proposalId,
      artifact: approvalArtifact,
      artifactDigest,
      operationDigest: claims.operationDigest,
      authorizationDigest: digest,
      expiresAt: exp,
    })
    let reviewDecision
    try {
      reviewDecision = await review(reviewRequest, brokerStoppingSignal)
    } catch (error) {
      const reason = String(error?.message ?? error)
      const reviewFailure = [
        BROKER_REFUSE.REVIEW_CHANNEL_UNAVAILABLE,
        BROKER_REFUSE.REVIEW_RESPONSE_MALFORMED,
        BROKER_REFUSE.REVIEW_TIMED_OUT,
        BROKER_REFUSE.STOPPING,
      ].includes(reason)
      return {
        ok: false,
        reason: reviewFailure
          ? reason
          : brokerStoppingSignal.aborted
            ? BROKER_REFUSE.STOPPING
            : BROKER_REFUSE.REVIEW_CHANNEL_UNAVAILABLE,
      }
    }
    if (reviewDecision !== 'approved' && reviewDecision !== 'denied') {
      return { ok: false, reason: BROKER_REFUSE.REVIEW_RESPONSE_MALFORMED }
    }
    if (reviewDecision === 'denied') return { ok: false, reason: BROKER_REFUSE.REVIEW_DENIED }
    if (brokerStoppingSignal.aborted) return { ok: false, reason: BROKER_REFUSE.STOPPING }
    const controlAfterReview = identityControlAdmits(authorityContext)
    if (!controlAfterReview.ok) return controlAfterReview
    let admitted
    let authorized
    try {
      admitted = await requestIssuer(issuerSocket, { op: 'admit.v5', digest }, brokerStoppingSignal)
      if (!isExactIssuerSuccess(admitted, ['ok'])) {
        return { ok: false, reason: issuerFailureReason(admitted) }
      }
      authorized = await requestIssuer(issuerSocket, {
        op: 'authorize.v5',
        digest,
        artifact: approvalArtifact,
        artifactDigest,
      }, brokerStoppingSignal)
    } catch {
      return {
        ok: false,
        reason: brokerStoppingSignal.aborted ? BROKER_REFUSE.STOPPING : BROKER_REFUSE.ISSUER_TRANSPORT_FAILED,
      }
    }
    if (brokerStoppingSignal.aborted) return { ok: false, reason: BROKER_REFUSE.STOPPING }
    if (!isExactIssuerSuccess(authorized, ['ok', 'digest', 'signature'])
      || authorized.digest !== digest
      || !isCanonicalEd25519Signature(authorized.signature)) {
      return { ok: false, reason: issuerFailureReason(authorized) }
    }
    const grant = { ...claims, signature: authorized.signature }
    const artifact = verifyIssuedGrantV5({
      grant,
      toolName: entry.toolName,
      args: entry.arguments,
      rootPublicKeyPem,
      now: Date.now(),
      expectedDefinitionId,
      expectedOperationDigest: claims.operationDigest,
      expectedReceiptKeyId: receiptKeyId,
      parentDelegationClaim: authorityContext.parentDelegationClaim,
      delegationClaim: authorityContext.delegationClaim,
      expectedSubject: authorityContext.subject,
      expectedControlDigest: authorityContext.activeControlDigest,
      expectedParentDigest: authorityContext.parentDigest,
      expectedActivationDigest: authorityContext.activationDigest,
      expectedAudience: authorityContext.audience,
      expectedResource: action.resource,
      expectedBudget: action.budget,
    })
    if (!artifact.ok) return { ok: false, reason: BROKER_REFUSE.ISSUER_RESPONSE_MALFORMED }
    return {
      ok: true,
      request,
      grant,
      ...settlementChecksForV5Authority(authorityContext),
    }
  }

  /** Bind KIRA record identity, subject, and privacy before choosing a grant family. */
  function admitKiraWrite(args, hasSubjectAuthority) {
    const fields = snapshotExactDataFields(args, ['key', 'value'])
    if (fields === null || typeof fields.key !== 'string' || !fields.key.startsWith('kira:')) {
      return { ok: true }
    }
    if (!hasSubjectAuthority) {
      return { ok: false, reason: BROKER_REFUSE.KIRA_WRITE_AUTHORITY_UNBOUND }
    }
    if (!KIRA_RECORD_ID.test(fields.key)) {
      return { ok: false, reason: BROKER_REFUSE.KIRA_WRITE_KEY_INVALID }
    }
    if (kiraPolicy === null) {
      return { ok: false, reason: BROKER_REFUSE.KIRA_WRITE_UNCONFIGURED }
    }
    const verified = verifyKiraMemoryRecord(fields.value)
    if (!verified.verified) {
      return {
        ok: false,
        reason: verified.reason === 'identity-mismatch'
          ? BROKER_REFUSE.KIRA_WRITE_RECORD_IDENTITY_MISMATCH
          : BROKER_REFUSE.KIRA_WRITE_RECORD_MALFORMED,
      }
    }
    if (verified.record.recordId !== fields.key) {
      return { ok: false, reason: BROKER_REFUSE.KIRA_WRITE_KEY_MISMATCH }
    }
    if (verified.record.subject !== kiraPolicy.subject) {
      return { ok: false, reason: BROKER_REFUSE.KIRA_WRITE_SUBJECT_MISMATCH }
    }
    if (!kiraPolicy.privacy.includes(verified.record.privacy)) {
      return { ok: false, reason: BROKER_REFUSE.KIRA_WRITE_PRIVACY_REFUSED }
    }
    return { ok: true }
  }

  /** Shared pre-effect and settlement ladder for code-selected v3, v4, and v5 verifiers. */
  async function settleGrantRequest({
    request,
    connection,
    grant = request?.grant,
    authorityAdmits,
    verify,
    activationDigest = null,
  }) {
    // Graceful stop aborts before this request can reserve a nonce or begin an
    // effect, including when it was already waiting behind another settlement.
    if (brokerStoppingSignal.aborted) {
      return { ok: false, state: 'REFUSED', reason: BROKER_REFUSE.STOPPING }
    }
    // The socket can change while this request waits for an earlier settlement.
    // This is the admission check, before nonce claim and every later effect.
    if (!routeIsIntact()) {
      return { ok: false, state: 'REFUSED', reason: BROKER_REFUSE.SOCKET_ROUTE_LOST }
    }
    if (sealStateIndeterminate) {
      return { ok: false, state: 'REFUSED', reason: BROKER_REFUSE.CONFINEMENT_STATE_INDETERMINATE }
    }
    // THE APPEND LOCK, taken here: before the grant is consumed, before the
    // seal is raised, and before the chain is read. A record path that cannot
    // be appended to refuses with no nonce spent, no seal raised, no prepared
    // marker and no effect — so REFUSED is true of the authorization as well as
    // of the world. Holding it across the preflight below makes one answer
    // cover both halves of "is the record usable": the head that verifies here
    // is the head the append extends.
    const auraFile = join(stateDir, 'aura.jsonl')
    let auraLock
    try {
      auraLock = acquireAppendLock(auraFile)
    } catch (error) {
      return {
        ok: false,
        state: 'REFUSED',
        reason: `broker:aura-preflight (${String(error?.message ?? error)})`,
        detail: `${auraFile}.lock is present; an operator must establish that no writer owns it before removing it`,
      }
    }
    try {
      // Preflight the golden chain BEFORE consuming the grant or touching state:
      // a broken record must refuse up front, never surface after an effect.
      try {
        readSettlementHead(stateDir)
      } catch (error) {
        return { ok: false, state: 'REFUSED', reason: String(error?.message ?? error) }
      }
      // THE RATCHET, checked here: before the grant is consumed, before the
      // effect, so a below-seal request leaves no nonce spent, no object written
      // and no record entry — the same posture as every other refusal.
      // The state directory is re-measured on EVERY request rather than trusted
      // from boot: `chmod 777` on a running broker's state is exactly the
      // sabotage this must catch, and it happens after the boot gate ran.
      const measurement = measureStateDirectory({ stateDir, euid: process.geteuid() })
      const peer = currentPeerObservation()
      const servedClass = effectiveClass(measurement, peer.separable ? connection.provenClass : null)
      if (!classAtLeast(servedClass, seal.class)) {
        return {
          ok: false,
          state: 'REFUSED',
          reason: CONFINEMENT_REFUSE.BELOW_SEAL,
          detail: `this state directory has served ${seal.class}; this connection is ${servedClass}${measurement.defect ? ` (${measurement.defect})` : ''}`,
        }
      }
      if (!isGovernedEffect(request.toolName)) return { ok: false, state: 'REFUSED', reason: REFUSE.TOOL_MISMATCH }
      const expectedDefinitionId = definitionDigest(request.toolName)
      if (request.toolName === WORKSPACE_PATCH) {
        if (!v5Mode || authorityAdmits === undefined) return { ok: false, state: 'REFUSED', reason: 'broker:workspace-subject-authority-required' }
        try { preflightWorkspacePatch(roots, request.arguments) } catch (error) {
          return { ok: false, state: 'REFUSED', reason: String(error?.message ?? error) }
        }
      } else if (!isExactMemoryPutArgs(request.arguments)) {
        return { ok: false, state: 'REFUSED', reason: BROKER_REFUSE.ARGUMENTS_NOT_EXACT }
      }
      // Pre-effect boundary: a name the effect would refuse must be REFUSED
      // here, never reach the pipeline and come back as INDETERMINATE.
      if (request.toolName === MEMORY_PUT && !KEY_SHAPE.test(request.arguments.key)) {
        return { ok: false, state: 'REFUSED', reason: BROKER_REFUSE.KEY_NOT_A_NAME }
      }
      if (grant === undefined || grant === null) return { ok: false, state: 'REFUSED', reason: REFUSE.NO_GRANT }
      // Activation admission precedes grant verification because verification
      // atomically reserves the nonce. A stale, unbound, or replaced activation
      // is not an attempt to spend this authorization and must leave it usable
      // in the activation that actually owns it.
      const activationVerdictBeforeVerification = activationAdmits(activationDigest)
      if (!activationVerdictBeforeVerification.ok) {
        return {
          ok: false,
          state: 'REFUSED',
          reason: activationVerdictBeforeVerification.reason,
          detail: activationVerdictBeforeVerification.detail,
        }
      }
      if (authorityAdmits !== undefined) {
        const authorityVerdictBeforeVerification = authorityAdmits()
        if (!authorityVerdictBeforeVerification.ok) {
          return {
            ok: false,
            state: 'REFUSED',
            reason: authorityVerdictBeforeVerification.reason,
            detail: authorityVerdictBeforeVerification.detail,
          }
        }
      }
      // The WYSIWYS binding is MANDATORY: the operation is always recomputed from
      // the presented arguments and the grant's own expiry, so omission can never
      // disable it — an operationless grant refuses by name.
      const expectedOperationDigest = operationDigest(buildOperation(request.arguments, grant.exp, request.toolName))
      // Grant verification is unconditional. There is no flag, config field, or
      // request field that can bypass it; mutation testing patches a temporary
      // copy of this module outside the repository instead.
      const verdict = verify({ grant, request, expectedOperationDigest })
      if (!verdict.ok) return {
        ok: false,
        state: verdict.reason === REFUSE.NONCE_UNCERTAIN ? 'INDETERMINATE' : 'REFUSED',
        reason: verdict.reason,
      }
      // Verification reserves the nonce. Re-read the broker-owned binding after
      // that synchronous reservation and before the effect so a replacement
      // racing the first check cannot authorize a write. A failure here is
      // INDETERMINATE because the authorization was consumed even though the
      // effect did not begin.
      const activationVerdictAfterVerification = activationAdmits(activationDigest)
      if (!activationVerdictAfterVerification.ok) {
        return {
          ok: false,
          state: 'INDETERMINATE',
          reason: activationVerdictAfterVerification.reason,
          detail: `${activationVerdictAfterVerification.detail}; activation changed after grant reservation; effect did not begin`,
        }
      }
      const identityControlVerdictAfterVerification = authorityAdmits?.() ?? { ok: true }
      if (!identityControlVerdictAfterVerification.ok) {
        return {
          ok: false,
          state: 'INDETERMINATE',
          reason: identityControlVerdictAfterVerification.reason,
          detail: `${identityControlVerdictAfterVerification.detail ?? 'identity control changed'}; authority changed after grant reservation; effect did not begin`,
        }
      }
      // A pathname check cannot atomically join nonce reservation to the effect.
      // Recheck immediately after admission; if it changed, do not begin the
      // effect and report the consumed authorization conservatively.
      if (!routeIsIntact()) {
        return {
          ok: false,
          state: 'INDETERMINATE',
          reason: BROKER_REFUSE.SOCKET_ROUTE_LOST,
          detail: 'route changed after grant reservation; effect did not begin',
        }
      }
      // Everything after this point happens AFTER the effect has begun. A
      // failure here is reported as INDETERMINATE - never as a refusal - because
      // the store may already hold the written object.
      try {
        return await settle({
          opRequest: request,
          grant,
          expectedDefinitionId,
          stateDir,
          measurement,
          peer,
          servedClass,
          peerEchoedAt: connection.peerEchoedAt,
          routeIsIntact,
          authority: verdict.authority,
          auraLock,
        })
      } catch (error) {
        return {
          ok: false,
          state: 'INDETERMINATE',
          reason: 'broker:effect-outcome-indeterminate',
          detail: String(error?.message ?? error),
        }
      }
    } finally {
      releaseAppendLock(auraLock)
    }
  }

  async function settle({
    opRequest: request,
    grant,
    expectedDefinitionId,
    stateDir,
    measurement,
    peer,
    servedClass,
    peerEchoedAt,
    routeIsIntact,
    authority,
    auraLock,
  }) {
    if (!routeIsIntact()) throw new Error(BROKER_REFUSE.SOCKET_ROUTE_LOST)
    // Raise before the prepared marker and effect. The atomic replacement leaves
    // either the old or new seal across interruption, and no peer-separated
    // effect can begin while only the weaker high-water mark remains.
    try {
      seal = raiseSeal({ stateDir, seal, servedClass, measurement })
    } catch (error) {
      sealStateIndeterminate = true
      throw error
    }
    if (!routeIsIntact()) throw new Error(BROKER_REFUSE.SOCKET_ROUTE_LOST)
    writeIntent(stateDir, grant.nonce, grant.operationDigest)
    if (!routeIsIntact()) throw new Error(BROKER_REFUSE.SOCKET_ROUTE_LOST)
    const evidence = request.toolName === WORKSPACE_PATCH
      ? workspacePatch(roots, request.arguments)
      : memoryPut(stateDir, request.arguments)
    // Inside the signature, and identical in the record entry below.
    // `state-owned` says only that the leaf directory matched the broker euid
    // and had no group/other POSIX permission bits when measured. It does not
    // identify the caller or inspect ACLs and ancestors.
    const confinementStamp = confinementField({
      confinementClass: servedClass,
      measurement,
      peer,
      sealClass: seal.class,
      peerEchoedAt,
    })
    // THE RECORD. Every settlement appends to the Aura chain before the
    // caller hears about it: the reply is the settlement, and the record is
    // part of it. The entry binds the receipt's digest and the exact
    // post-write evidence at a content-addressed location that the broker API
    // does not overwrite. A state-owning process can still replace it.
    let receipt
    const chain = appendEntry({
      file: join(stateDir, 'aura.jsonl'),
      // Held since before the grant was consumed, so this append cannot fail
      // for want of the lock. `appendEntry` neither re-acquires nor releases it.
      lock: auraLock,
      // Sequence allocation and append share the Aura writer lock. The
      // sequence file is a local head witness, not an authority: it makes a
      // suffix or zero-length truncation fail closed on the next request.
      buildFields: ({ count }) => {
        const witnessed = readSequence(stateDir)
        if (witnessed !== count) throw new Error(BROKER_REFUSE.AURA_SEQUENCE_MISMATCH)
        receipt = mintReceipt({
          requestDigest: requestDigest(request.toolName, request.arguments),
          definitionId: expectedDefinitionId,
          nonce: grant.nonce,
          sequence: count + 1,
          evidence,
          confinement: confinementStamp,
          brokerPrivateKey,
        })
        const observed = verifyReceipt({ receipt, brokerPublicKeyPem, observe })
        if (!observed.ok) throw new Error(observed.reason)
        return {
          verdict: 'settled',
          sequence: receipt.sequence,
          ...(request.toolName === MEMORY_PUT
            ? { key: request.arguments.key }
            : {
                toolName: WORKSPACE_PATCH,
                workspace: request.arguments.workspace,
                relativePath: request.arguments.path,
                beforeSha256: request.arguments.beforeSha256,
              }),
          requestDigest: receipt.requestDigest,
          definitionId: expectedDefinitionId,
          nonce: receipt.nonce,
          receiptSha256: createHash('sha256').update(canonicalJSON(receipt), 'utf8').digest('hex'),
          path: evidence.path,
          bytes: evidence.bytes,
          contentSha256: evidence.contentSha256,
          inode: evidence.inode,
          mtimeNs: evidence.mtimeNs,
          confinement: confinementStamp,
        }
      },
      afterAppend: ({ fields }) => writeSequence(stateDir, fields.sequence),
    })
    writeReceipt({ stateDir, receipt })
    // The Receipt v3 export is SIDE EVIDENCE: a portable document assembled from
    // the v1 receipt, the Aura entry and a new signed head statement. Its failure
    // cannot make a completed settlement indeterminate, because the authority for
    // this settlement is the v1 receipt and the chain entry above, both already
    // durable. A failure here leaves the original evidence intact and is reported
    // as `receiptV3Refusal` rather than swallowed.
    if (authority !== undefined) {
      writeAuthorityEvidence({
        stateDir,
        auraChainHash: chain.hash,
        authority,
      })
    }
    verifySettledEffect({ stateDir, request, receipt, chain, authority, brokerPublicKeyPem })
    // THE CANONICAL SETTLEMENT CHECKS RUN FIRST.
    //
    // The export attests that a settlement happened and that its post-conditions
    // held, so it must not be published until they have. Publishing here also
    // means a document is never left behind for a settlement whose own
    // verification failed: the order is receipt, chain, verify, THEN export.
    //
    // The export is still SIDE EVIDENCE and its failure is still not
    // indeterminacy. `verifySettledEffect` throwing above leaves the settlement
    // as it already was — recorded and indeterminate — and the catch below runs
    // only around the export itself, so an export failure cannot convert a
    // verified settlement into a refused one.
    let receiptV3Refusal = null
    try {
      // THE EXPORT INSTANT IS THE EXPORT INSTANT. It is not clamped, moved, or
      // fitted to any other instant: an earlier version pulled it back to
      // `grant.exp * 1000 - 1` so the document's ordered times would hold, which
      // backdates a recorded observation to satisfy a check. The document now
      // reports each instant's provenance, so expiring later than the grant is
      // stated rather than hidden.
      const receiptV3 = buildReceiptV3({
        stateDir,
        receipt,
        operation: request.toolName,
        resource: receipt.path,
        // The exact bytes the grant bound: `payloadDigest` is sha256 over
        // canonicalJSON({ tool, arguments }), which is also the grant's `digest`.
        approvedCanonical: canonicalJSON({ tool: request.toolName, arguments: request.arguments ?? null }),
        actionDigest: receipt.requestDigest,
        // The issued grant, verbatim as signed. Without it the document refuses
        // `grant:signature`, which is a whole check a reader cannot perform —
        // the grant IS the record of what was authorized.
        authorization: grant === undefined ? null : {
          payload: {
            domain: GRANT_DOMAIN_V4,
            tool: grant.toolName,
            digest: grant.digest,
            nonce: grant.nonce,
            exp: grant.exp,
            definitionId: grant.definitionId,
            operationDigest: grant.operationDigest,
            receiptKeyId: grant.receiptKeyId,
          },
          signature: grant.signature,
          // The key that actually signed this grant: the ROOT the broker
          // verified it against. `receiptKeyIdForPublicKey` is a sha256 over the
          // canonical SPKI DER bytes of any Ed25519 key, so it names the root
          // here even though its name mentions receipts.
          //
          // This matters because a recipient anchors the issuer set separately
          // from the executor set. A v4 authorization is signed by the issuer
          // root, whose key is deliberately unavailable to the executor process,
          // so a document naming the executor key here could never have its
          // grant checked against an independently held issuer key.
          keyId: receiptKeyIdForPublicKey(rootPublicKeyPem),
        },
        executorPrivateKey: brokerPrivateKey,
        at: Date.now(),
      })
      writeReceiptV3({ stateDir, document: receiptV3 })
    } catch (error) {
      receiptV3Refusal = String(error?.message ?? error)
    }
    clearIntent(stateDir, grant.nonce)
    return {
      ok: true,
      state: 'SETTLED',
      evidence,
      receipt,
      brokerPublicKeyPem,
      chainHash: chain.hash,
      receiptV3Refusal,
    }
  }
}

/**
 * Reopen the just-published memory settlement before its serialized turn ends.
 * The projection must still name this turn's value; later same-key turns may
 * replace it only after this observation. Failure preserves the intent and
 * nonce and is reported by the caller as an indeterminate effect outcome.
 */
/**
 * Reopen the settled effect and compare it against the receipt before SETTLED.
 *
 * Each effect re-observes its own product: `memory.put` re-reads the content
 * object and its key projection, `workspace.patch` re-reads the published file.
 * The Aura tail is shared because the record is one chain regardless of effect.
 * A re-observation that cannot confirm the write throws rather than reporting a
 * clean refusal — the effect may already have happened.
 * @param settlement - the settled request, its receipt, chain, and authority.
 */
function verifySettledEffect(settlement) {
  if (settlement.request.toolName === WORKSPACE_PATCH) {
    verifySettledWorkspacePatch(settlement)
    return
  }
  verifySettledMemory(settlement)
}

/**
 * Re-read the published file and compare it against the signed receipt.
 *
 * `workspacePatch` already reopened the destination before returning; this is
 * the independent second observation, taken after the Aura append, through a
 * fresh `O_NOFOLLOW` descriptor so a symlink substituted between the two reads
 * refuses instead of being followed.
 * @param settlement - the settled request, its receipt, chain, and authority.
 */
function verifySettledWorkspacePatch({ stateDir, request, receipt, chain, authority, brokerPublicKeyPem }) {
  const body = workspacePatchBody(request.arguments)
  const contentSha256 = createHash('sha256').update(body, 'utf8').digest('hex')
  if (receipt.contentSha256 !== contentSha256
    || receipt.bytes !== Buffer.byteLength(body, 'utf8')
    || receipt.requestDigest !== requestDigest(request.toolName, request.arguments)) {
    throw new Error('broker:settlement-receipt-mismatch')
  }
  let descriptor
  try {
    descriptor = openSync(receipt.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    const stat = fstatSync(descriptor)
    if (!stat.isFile() || stat.size !== receipt.bytes
      || createHash('sha256').update(readFileSync(descriptor)).digest('hex') !== contentSha256) {
      throw new Error('broker:settlement-published-mismatch')
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('broker:')) throw error
    throw new Error('broker:settlement-published-unavailable')
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
  const receiptVerdict = verifyReceipt({ receipt, brokerPublicKeyPem, observe })
  if (!receiptVerdict.ok) throw new Error(receiptVerdict.reason)
  verifySettledAura({ stateDir, request, receipt, chain, authority })
}

function verifySettledMemory({ stateDir, request, receipt, chain, authority, brokerPublicKeyPem }) {
  const body = effectBody(request.arguments)
  const contentSha256 = createHash('sha256').update(body, 'utf8').digest('hex')
  const objectPath = join(stateDir, 'memory', 'objects', `${contentSha256}.json`)
  for (const path of [stateDir, join(stateDir, 'memory'), join(stateDir, 'memory', 'objects'), join(stateDir, 'memory', 'keys')]) {
    const state = lstatSync(path)
    if (!state.isDirectory() || state.isSymbolicLink()) throw new Error('broker:settlement-directory-mismatch')
  }
  if (receipt.path !== objectPath
    || receipt.contentSha256 !== contentSha256
    || receipt.bytes !== Buffer.byteLength(body, 'utf8')
    || receipt.requestDigest !== requestDigest(request.toolName, request.arguments)) {
    throw new Error('broker:settlement-receipt-mismatch')
  }
  const receiptVerdict = verifyReceipt({ receipt, brokerPublicKeyPem, observe })
  if (!receiptVerdict.ok) throw new Error(receiptVerdict.reason)

  const projectionPath = join(stateDir, 'memory', 'keys', `${request.arguments.key}.json`)
  let descriptor
  try {
    descriptor = openSync(projectionPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    const stat = fstatSync(descriptor)
    const expected = `${JSON.stringify({ key: request.arguments.key, contentSha256 })}\n`
    if (!stat.isFile() || stat.size !== Buffer.byteLength(expected, 'utf8')
      || readFileSync(descriptor, 'utf8') !== expected) {
      throw new Error('broker:settlement-projection-mismatch')
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }

  verifySettledAura({ stateDir, request, receipt, chain, authority })
}

/**
 * Compare the retained Aura chain against the settlement that produced it.
 *
 * Shared by every effect: the effect-specific fields come from the same branch
 * the append used, so a record written for one effect cannot verify as another.
 * @param settlement - the settled request, its receipt, chain, and authority.
 */
function verifySettledAura({ stateDir, request, receipt, chain, authority }) {
  const retained = readVerifiedChain(join(stateDir, 'aura.jsonl'))
  if (!retained.ok || retained.count !== receipt.sequence || retained.lastChainHash !== chain.hash
    || readSettlementHead(stateDir) !== receipt.sequence) {
    throw new Error('broker:settlement-aura-mismatch')
  }
  const expectedEntry = {
    hash: chain.hash,
    prev: chain.prev,
    verdict: 'settled',
    sequence: receipt.sequence,
    ...(request.toolName === MEMORY_PUT
      ? { key: request.arguments.key }
      : {
          toolName: WORKSPACE_PATCH,
          workspace: request.arguments.workspace,
          relativePath: request.arguments.path,
          beforeSha256: request.arguments.beforeSha256,
        }),
    requestDigest: receipt.requestDigest,
    definitionId: receipt.definitionId,
    nonce: receipt.nonce,
    receiptSha256: createHash('sha256').update(canonicalJSON(receipt), 'utf8').digest('hex'),
    path: receipt.path,
    bytes: receipt.bytes,
    contentSha256: receipt.contentSha256,
    inode: receipt.inode,
    mtimeNs: receipt.mtimeNs,
    confinement: receipt.confinement,
  }
  if (canonicalJSON(retained.entries.at(-1)) !== canonicalJSON(expectedEntry)) {
    throw new Error('broker:settlement-entry-mismatch')
  }
  const retainedReceipt = readReceipt({ stateDir, receiptSha256: expectedEntry.receiptSha256 })
  if (canonicalJSON(retainedReceipt) !== canonicalJSON(receipt)) {
    throw new Error('broker:settlement-receipt-mismatch')
  }
  if (authority !== undefined) {
    const retainedAuthority = verifyAuthorityEvidence({ stateDir, auraChainHash: chain.hash, authority })
    if (!retainedAuthority.ok) throw new Error(retainedAuthority.reason)
  }
}

/** Accept only a shallow JSON scalar that can be echoed without recursive serialization. */
function readTransportId(request) {
  if (typeof request !== 'object' || request === null || !Object.hasOwn(request, 'id')) {
    return { ok: true, value: undefined }
  }
  const value = request.id
  if (value === null
    || (typeof value === 'number' && Number.isFinite(value))
    || (typeof value === 'string'
      && Buffer.byteLength(value, 'utf8') <= BROKER_REQUEST_ID_MAX_BYTES)) {
    return { ok: true, value }
  }
  return { ok: false }
}

/** Serialize one broker-owned reply without allowing a result defect to terminate the server. */
function serializeBrokerReply(id, reply) {
  try {
    return `${JSON.stringify({ id, ...reply })}\n`
  } catch {
    return RESPONSE_SERIALIZATION_FAILURE_FRAME
  }
}

/** Copy one exact plain data frame without invoking accessors. */
function snapshotExactDataFields(value, requiredKeys, optionalKeys = []) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return null
    const allowed = new Set([...requiredKeys, ...optionalKeys])
    const ownKeys = Reflect.ownKeys(value)
    if (ownKeys.some((key) => typeof key !== 'string' || !allowed.has(key))) return null
    if (requiredKeys.some((key) => !ownKeys.includes(key))) return null
    const snapshot = Object.create(null)
    for (const key of ownKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null
      snapshot[key] = descriptor.value
    }
    return Object.freeze(snapshot)
  } catch {
    return null
  }
}

const INVALID_JSON_VALUE = Symbol('invalid-json-value')

/** Detach one bounded-depth JSON value without running caller-owned code. */
function snapshotJsonValue(value, ancestors = new WeakSet(), depth = 0) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : INVALID_JSON_VALUE
  if (typeof value !== 'object' || depth > 64) return INVALID_JSON_VALUE
  if (ancestors.has(value)) return INVALID_JSON_VALUE
  try {
    ancestors.add(value)
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_FRAME_BYTES) {
        return INVALID_JSON_VALUE
      }
      const ownKeys = Reflect.ownKeys(value)
      if (ownKeys.length !== value.length + 1 || !ownKeys.includes('length')) return INVALID_JSON_VALUE
      const snapshot = []
      for (let index = 0; index < value.length; index += 1) {
        const key = String(index)
        if (!ownKeys.includes(key)) return INVALID_JSON_VALUE
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
          return INVALID_JSON_VALUE
        }
        const item = snapshotJsonValue(descriptor.value, ancestors, depth + 1)
        if (item === INVALID_JSON_VALUE) return INVALID_JSON_VALUE
        snapshot.push(item)
      }
      return Object.freeze(snapshot)
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return INVALID_JSON_VALUE
    const ownKeys = Reflect.ownKeys(value)
    if (ownKeys.some((key) => typeof key !== 'string')) return INVALID_JSON_VALUE
    const snapshot = Object.create(null)
    for (const key of ownKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        return INVALID_JSON_VALUE
      }
      const item = snapshotJsonValue(descriptor.value, ancestors, depth + 1)
      if (item === INVALID_JSON_VALUE) return INVALID_JSON_VALUE
      snapshot[key] = item
    }
    return Object.freeze(snapshot)
  } catch {
    return INVALID_JSON_VALUE
  } finally {
    ancestors.delete(value)
  }
}

/** Snapshot and size the one effect argument alphabet accepted by proposal.deposit. */
function snapshotProposalArguments(value, toolName = MEMORY_PUT) {
  if (toolName === WORKSPACE_PATCH) {
    const fields = snapshotExactDataFields(value, ['workspace', 'path', 'beforeSha256', 'content'])
    if (fields === null || !isExactWorkspacePatchArgs(fields)) {
      return { ok: false, reason: BROKER_REFUSE.ARGUMENTS_NOT_EXACT }
    }
    if (Buffer.byteLength(workspacePatchBody(fields), 'utf8') > BROKER_PROPOSAL_MAX_EFFECT_BYTES) {
      return { ok: false, reason: BROKER_REFUSE.PROPOSAL_ARGUMENTS_TOO_LARGE }
    }
    return { ok: true, arguments: Object.freeze({ ...fields }) }
  }
  const fields = snapshotExactDataFields(value, ['key', 'value'])
  if (fields === null || typeof fields.key !== 'string' || fields.value === undefined) {
    return { ok: false, reason: BROKER_REFUSE.ARGUMENTS_NOT_EXACT }
  }
  if (!KEY_SHAPE.test(fields.key)) return { ok: false, reason: BROKER_REFUSE.KEY_NOT_A_NAME }
  const copiedValue = snapshotJsonValue(fields.value)
  if (copiedValue === INVALID_JSON_VALUE) {
    return { ok: false, reason: BROKER_REFUSE.ARGUMENTS_NOT_EXACT }
  }
  const args = Object.freeze({ key: fields.key, value: copiedValue })
  if (Buffer.byteLength(effectBody(args), 'utf8') > BROKER_PROPOSAL_MAX_EFFECT_BYTES) {
    return { ok: false, reason: BROKER_REFUSE.PROPOSAL_ARGUMENTS_TOO_LARGE }
  }
  return { ok: true, arguments: args }
}

/**
 * Derive the exact v5 resource and one-call budget for one registered action.
 *
 * This must be derived from the same frozen arguments that are sent to the
 * effect. A proposal cannot choose a broader resource or budget field.
 *
 * @param {string} toolName - registered effect name.
 * @param {object} args - exact effect-specific proposal arguments.
 * @returns {{resource: string, budget: Readonly<{calls: number, bytes: number, computeMs: number, costMicrounits: number}>}} action bounds.
 */
function delegatedAction(toolName, args) {
  return Object.freeze({
    resource: toolName === WORKSPACE_PATCH ? `workspace:file:${args.workspace}:${args.path}` : `memory:key:${args.key}`,
    budget: Object.freeze({
      calls: 1,
      bytes: Buffer.byteLength(toolName === WORKSPACE_PATCH ? workspacePatchBody(args) : effectBody(args), 'utf8'),
      computeMs: 0,
      costMicrounits: 0,
    }),
  })
}

/** Validate a workspace resource using the same path grammar as the executor. */
function isWorkspaceResource(resource) {
  const match = /^workspace:file:([^:]+):(.+)$/.exec(resource)
  return match !== null && isExactWorkspacePatchArgs({
    workspace: match[1], path: match[2], beforeSha256: null, content: '',
  })
}

/** Read an operator-owned alias map without following roots or evaluating accessors. */
function readWorkspaceRoots(input = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('broker:workspace-roots-invalid')
  const roots = Object.create(null)
  const descriptors = Object.getOwnPropertyDescriptors(input)
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(key)) throw new TypeError('broker:workspace-roots-invalid')
    const descriptor = descriptors[key]
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError('broker:workspace-roots-invalid')
    const path = descriptor.value
    if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path
      || realpathSync(path) !== path || !lstatSync(path).isDirectory()) throw new TypeError('broker:workspace-root-not-canonical')
    roots[key] = path
  }
  return Object.freeze(roots)
}

/** Preserve alias meaning across broker restarts; a different mapping needs a separate state directory. */
function bindWorkspaceRoots(stateDir, input) {
  const roots = readWorkspaceRoots(input)
  const stateRoot = realpathSync(stateDir)
  for (const root of Object.values(roots)) {
    const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`
    const statePrefix = stateRoot.endsWith(sep) ? stateRoot : `${stateRoot}${sep}`
    if (root === stateRoot || root.startsWith(statePrefix) || stateRoot.startsWith(rootPrefix)) {
      throw new Error('broker:workspace-overlaps-state')
    }
  }
  const path = join(stateDir, 'workspace-roots.json')
  const body = `${canonicalJSON(roots)}\n`
  if (Object.keys(roots).length === 0 && !inspectEntry(path, 'broker:workspace-roots-unavailable').present) return roots
  try { writeFileSync(path, body, { flag: 'wx', mode: 0o600 }) } catch (error) {
    if (error?.code !== 'EEXIST') throw error
  }
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || readFileSync(path, 'utf8') !== body) throw new Error('broker:workspace-roots-mismatch')
  return roots
}

/** Whether one parent-selected Agent claim is exact for one proposal request. */
function selectedAuthorityMatchesRequest(authority, expectation, request) {
  const delegation = authority.delegationClaim
  return authority.subject === expectation.subject
    && authority.activeControlDigest === expectation.activeControlDigest
    && authority.activationDigest === request.activationDigest
    && authority.audience === request.audience
    && delegation.kind === 'agent'
    && delegation.operations.length === 1
    && delegation.operations[0] === request.toolName
    && delegation.resources.length === 1
    && delegation.resources[0] === request.resource
    && delegation.audiences.length === 1
    && delegation.audiences[0] === request.audience
    && delegation.activationDigests.length === 1
    && delegation.activationDigests[0] === request.activationDigest
    && delegation.budgets.calls === request.budget.calls
    && delegation.budgets.bytes === request.budget.bytes
    && delegation.budgets.computeMs === request.budget.computeMs
    && delegation.budgets.costMicrounits === request.budget.costMicrounits
    && delegation.expiresAt === request.expiresAt
}

/** Whether one tool-call occurrence name fits the closed UTF-8 range. */
function isBoundedCallId(value) {
  return typeof value === 'string'
    && value.length > 0
    && Buffer.byteLength(value, 'utf8') <= BROKER_PROPOSAL_MAX_CALL_ID_BYTES
}

/** A proposal refusal carries no occurrence details or authority artifacts. */
function proposalRefusal(reason) {
  return { ok: false, state: BROKER_PROPOSAL_STATUS.REFUSED, reason }
}

/** Project one retained entry onto the complete public protocol vocabulary. */
function publicProposal(entry) {
  if (entry.status === BROKER_PROPOSAL_STATUS.PENDING) {
    return { ok: true, proposalId: entry.proposalId, state: entry.status }
  }
  if (entry.status === BROKER_PROPOSAL_STATUS.SETTLED) {
    return {
      ok: true,
      proposalId: entry.proposalId,
      state: entry.status,
      receipt: entry.receipt,
    }
  }
  return { ok: false, proposalId: entry.proposalId, state: entry.status, reason: entry.reason }
}

/** End one occurrence and release every retained effect or connection value. */
function terminalizeProposal(entry, status, reason, receipt) {
  entry.status = status
  if (reason === undefined) delete entry.reason
  else entry.reason = reason
  if (receipt === undefined) delete entry.receipt
  else entry.receipt = receipt
  delete entry.arguments
  delete entry.connection
}

/** Send one bounded request and accept exactly one newline-terminated issuer frame. */
function requestIssuer(socketPath, request, signal) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    const decoder = new StringDecoder('utf8')
    let buffer = ''
    let settled = false
    const finish = (fn) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', fail)
      socket.destroy()
      fn()
    }
    const fail = () => finish(() => reject(new Error(BROKER_REFUSE.ISSUER_TRANSPORT_FAILED)))
    const timer = setTimeout(fail, ISSUER_REQUEST_TIMEOUT_MS)
    signal?.addEventListener('abort', fail, { once: true })
    if (signal?.aborted) {
      fail()
      return
    }
    socket.once('connect', () => { socket.write(`${JSON.stringify(request)}\n`) })
    socket.once('error', fail)
    socket.once('close', fail)
    socket.on('data', (chunk) => {
      buffer += decoder.write(chunk)
      if (Buffer.byteLength(buffer, 'utf8') > MAX_FRAME_BYTES) fail()
    })
    socket.once('end', () => {
      buffer += decoder.end()
      if (Buffer.byteLength(buffer, 'utf8') > MAX_FRAME_BYTES || !buffer.endsWith('\n')) {
        fail()
        return
      }
      const lines = buffer.split('\n')
      if (lines.length !== 2 || lines[0].trim() === '' || lines[1] !== '') {
        fail()
        return
      }
      let reply
      try {
        reply = JSON.parse(lines[0])
      } catch {
        fail()
        return
      }
      finish(() => resolve(reply))
    })
  })
}

/** Require one exact successful issuer envelope. */
function isExactIssuerSuccess(value, keys) {
  const reply = snapshotExactDataFields(value, keys)
  return reply !== null && reply.ok === true
}

/** Collapse every valid issuer refusal to one broker-owned public reason. */
function issuerFailureReason(value) {
  const reply = snapshotExactDataFields(value, ['ok', 'reason'])
  return reply !== null && reply.ok === false && typeof reply.reason === 'string'
    ? BROKER_REFUSE.ISSUER_REFUSED
    : BROKER_REFUSE.ISSUER_RESPONSE_MALFORMED
}

/** Require the canonical Base64 encoding of one Ed25519 signature. */
function isCanonicalEd25519Signature(value) {
  if (typeof value !== 'string') return false
  const bytes = Buffer.from(value, 'base64')
  return bytes.length === 64 && bytes.toString('base64') === value
}

/**
 * Load the broker's receipt-signing key, creating it on first run. Durable:
 * receipts must verify after this process dies.
 *
 * @param {string} stateDir - the broker's own directory.
 * @returns {{ privateKey: import('node:crypto').KeyObject, publicPem: string }}
 */
function loadBrokerKey(stateDir) {
  ensureExactDirectory(stateDir, BROKER_REFUSE.STATE_PATH_MALFORMED, { recursive: true })
  const dir = join(stateDir, 'keys')
  ensureExactDirectory(dir, BROKER_REFUSE.KEY_DIRECTORY_MALFORMED)
  const keyFile = join(dir, 'broker.json')
  const keyState = inspectEntry(keyFile, 'broker:key-state-unobservable')
  if (keyState.present) {
    if (!keyState.stat.isFile() || keyState.stat.isSymbolicLink()) throw new Error('broker:key-state-malformed')
    return loadBrokerKeyFile(keyFile)
  }
  // Key downgrade refusal: if history already exists, the receipt-signing key
  // must NOT be silently regenerated — a fresh key would sign over prior
  // evidence with no continuity anchor.
  if (inspectEntry(join(stateDir, 'aura.jsonl'), 'broker:history-state-unobservable').present
    || inspectEntry(join(stateDir, 'seq'), 'broker:history-state-unobservable').present) {
    throw new Error('broker:key-downgrade-refused')
  }
  const pair = generateKeyPairSync('ed25519')
  const saved = {
    privatePem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
  const candidate = join(dir, `.broker-candidate-${process.pid}-${randomBytes(12).toString('hex')}`)
  let descriptor = null
  try {
    // Publish only complete, fsynced bytes. Writing broker.json directly with
    // a check-then-write race lets simultaneous first launches return
    // different private keys and exposes a partial JSON file to readers.
    descriptor = openSync(candidate, 'wx', 0o600)
    writeFileSync(descriptor, `${JSON.stringify(saved)}\n`, 'utf8')
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = null
    try {
      // A hard link is an atomic create-if-absent publication on the same
      // filesystem. Exactly one candidate wins; every loser reads that
      // winner instead of overwriting it.
      linkSync(candidate, keyFile)
      syncDirectory(dir)
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
    return loadBrokerKeyFile(keyFile)
  } finally {
    if (descriptor !== null) {
      try {
        closeSync(descriptor)
      } catch {
        // The provisioning attempt is already failing. The candidate path is
        // still unlinked below; no caller receives an identity from it.
      }
    }
    try {
      unlinkSync(candidate)
      syncDirectory(dir)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
}

/** Read and validate the one published broker identity. */
function loadBrokerKeyFile(keyFile) {
  let saved
  try {
    saved = JSON.parse(readFileSync(keyFile, 'utf8'))
  } catch {
    throw new Error('broker:key-state-malformed')
  }
  return loadSavedBrokerKey(saved)
}

/** Make a published or removed key-directory entry survive a host crash. */
function syncDirectory(dir) {
  const descriptor = openSync(dir, 'r')
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

/** Observe one directory entry without treating a dangling link or an I/O failure as absence. */
function inspectEntry(path, unavailableReason) {
  try {
    return { present: true, stat: lstatSync(path) }
  } catch (error) {
    if (error?.code === 'ENOENT') return { present: false, stat: null }
    throw new Error(unavailableReason)
  }
}

/**
 * Require the directory that owns the socket name to exclude every other uid
 * from changing that name.
 *
 * The broker may grant execute access on its socket inode to a guest; the
 * directory itself must remain owned by the serving uid and have no group or
 * other write bit. Otherwise another uid can unlink the live socket and bind
 * a replacement without touching the broker's state directory. POSIX ACLs and
 * ancestor-directory custody remain deployment obligations.
 */
function assertSocketDirectoryCustody(socketPath, socketGroupAccess) {
  const socketDir = dirname(socketPath)
  ensureExactDirectory(socketDir, BROKER_REFUSE.SOCKET_DIRECTORY_MALFORMED, { recursive: true })
  const entry = inspectEntry(socketDir, BROKER_REFUSE.SOCKET_DIRECTORY_MALFORMED)
  if (!entry.present || !entry.stat.isDirectory() || entry.stat.isSymbolicLink()) {
    throw new Error(BROKER_REFUSE.SOCKET_DIRECTORY_MALFORMED)
  }
  if (entry.stat.uid !== process.geteuid() || (entry.stat.mode & 0o022) !== 0) {
    throw new Error(BROKER_REFUSE.SOCKET_DIRECTORY_UNTRUSTED)
  }
  if (socketGroupAccess) {
    if (typeof process.getegid !== 'function'
      || entry.stat.gid !== process.getegid()
      || (entry.stat.mode & 0o777) !== 0o710) {
      throw new Error(BROKER_REFUSE.SOCKET_DIRECTORY_UNTRUSTED)
    }
  }
}

/** Apply and re-observe the fixed socket mode before the route is published. */
function configureServingSocketAccess(socketPath, socketGroupAccess) {
  const before = lstatSync(socketPath)
  const expectedMode = socketGroupAccess ? 0o660 : 0o600
  if (!before.isSocket()) {
    throw new Error(BROKER_REFUSE.SOCKET_PATH_OCCUPIED)
  }
  if (before.uid !== process.geteuid()) {
    throw new Error(BROKER_REFUSE.SOCKET_ROUTE_LOST)
  }
  if (socketGroupAccess
    && (typeof process.getegid !== 'function' || before.gid !== process.getegid())) {
    throw new Error(BROKER_REFUSE.SOCKET_ROUTE_LOST)
  }
  chmodSync(socketPath, expectedMode)
  const after = lstatSync(socketPath)
  if (!after.isSocket()
    || after.dev !== before.dev
    || after.ino !== before.ino
    || after.uid !== process.geteuid()
    || (after.mode & 0o777) !== expectedMode
    || (socketGroupAccess && after.gid !== process.getegid())) {
    throw new Error(BROKER_REFUSE.SOCKET_ROUTE_LOST)
  }
}

/**
 * Is the socket path still the secured directory entry this broker bound?
 *
 * This is not a substitute for a non-writable socket directory: it detects a
 * post-bind replacement only for clients already connected to this listener.
 */
function socketRouteIsIntact(socketPath, identity, socketGroupAccess) {
  if (identity === null) return false
  try {
    const socketDir = lstatSync(dirname(socketPath))
    if (!socketDir.isDirectory() || socketDir.isSymbolicLink()
      || socketDir.uid !== process.geteuid() || (socketDir.mode & 0o022) !== 0) {
      return false
    }
    if (socketGroupAccess
      && (typeof process.getegid !== 'function'
        || socketDir.gid !== process.getegid()
        || (socketDir.mode & 0o777) !== 0o710)) {
      return false
    }
    const entry = lstatSync(socketPath)
    const expectedMode = socketGroupAccess ? 0o660 : 0o600
    return entry.isSocket()
      && entry.dev === identity.dev
      && entry.ino === identity.ino
      && entry.uid === process.geteuid()
      && (entry.mode & 0o777) === expectedMode
      && (!socketGroupAccess || entry.gid === process.getegid())
  } catch {
    return false
  }
}

/**
 * Read the identity of one socket pathname, refusing every other entry type.
 *
 * @param {string} socketPath - pathname to inspect.
 * @returns {{ dev: number, ino: number }} the socket inode identity.
 */
function socketIdentityAt(socketPath) {
  const entry = lstatSync(socketPath)
  if (!entry.isSocket()) throw new Error(BROKER_REFUSE.SOCKET_PATH_OCCUPIED)
  return { dev: entry.dev, ino: entry.ino }
}

/**
 * Confirm that the currently named socket is this newly bound listener.
 *
 * A pathname stat alone proves only that some socket occupies the name. The
 * listener signs a freshly generated challenge under the broker's persisted
 * key; its inode must remain unchanged across that exchange before this broker
 * is returned. This does not resist a same-uid process that can read that key.
 *
 * @param {string} socketPath - pathname the listener just bound.
 * @param {string} routeChallenge - base64 challenge generated before bind.
 * @param {import('node:crypto').KeyObject} routePublicKey - public half of the broker identity.
 * @returns {Promise<{ dev: number, ino: number }>} this listener's pathname identity.
 */
async function identifyServingSocket(socketPath, routeChallenge, routePublicKey) {
  const before = socketIdentityAt(socketPath)
  if (!await routeProbeAnswers(socketPath, routeChallenge, routePublicKey)) {
    throw new Error(BROKER_REFUSE.SOCKET_ROUTE_LOST)
  }
  const after = socketIdentityAt(socketPath)
  if (before.dev !== after.dev || before.ino !== after.ino) {
    throw new Error(BROKER_REFUSE.SOCKET_ROUTE_LOST)
  }
  return after
}

/**
 * Ask a just-bound listener to prove possession of its private signing key.
 *
 * @param {string} socketPath - socket to connect.
 * @param {string} routeChallenge - base64 challenge that the listener must sign.
 * @param {import('node:crypto').KeyObject} routePublicKey - key used to verify the response.
 * @returns {Promise<boolean>} whether that socket returned a valid signature.
 */
function routeProbeAnswers(socketPath, routeChallenge, routePublicKey) {
  return new Promise((resolve) => {
    const socket = createConnection(socketPath)
    let output = ''
    let settled = false
    const finish = (matches) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(matches)
    }
    const timer = setTimeout(() => finish(false), 500)
    if (typeof timer.unref === 'function') timer.unref()
    socket.once('connect', () => {
      socket.write(`${JSON.stringify({ op: 'broker:route-probe', challenge: routeChallenge })}\n`)
    })
    socket.on('data', (chunk) => {
      output += String(chunk)
      const newline = output.indexOf('\n')
      if (newline === -1) return
      let reply
      try {
        reply = JSON.parse(output.slice(0, newline))
      } catch {
        finish(false)
        return
      }
      let signature
      try {
        signature = typeof reply?.signature === 'string' ? Buffer.from(reply.signature, 'base64') : null
      } catch {
        signature = null
      }
      finish(reply?.ok === true && signature !== null
        && edVerify(null, Buffer.from(routeChallenge, 'base64'), routePublicKey, signature))
    })
    socket.once('error', () => finish(false))
  })
}

/** Remove the Unix socket only while the pathname still names this server's inode. */
function removeOwnedSocket(path, identity) {
  if (identity === null) return false
  try {
    const entry = lstatSync(path)
    if (!entry.isSocket() || entry.dev !== identity.dev || entry.ino !== identity.ino) return false
    unlinkSync(path)
    return true
  } catch (error) {
    return error?.code === 'ENOENT'
  }
}

/** Create or validate one exact directory without following a leaf link. */
function ensureExactDirectory(path, malformedReason, { recursive = false } = {}) {
  let state = inspectEntry(path, malformedReason)
  if (!state.present) {
    try {
      mkdirSync(path, { recursive, mode: 0o700 })
    } catch (error) {
      // Another first-run provisioner may have won the same mkdir. The lstat
      // below decides whether the published entry is the required directory.
      if (error?.code !== 'EEXIST') throw new Error(malformedReason)
    }
    state = inspectEntry(path, malformedReason)
  }
  if (!state.present || !state.stat.isDirectory() || state.stat.isSymbolicLink()) {
    throw new Error(malformedReason)
  }
}

/**
 * Hold the exclusive state-writer entry for serving or a stopped-service upgrade.
 * @param {string} stateDir - existing broker-owned directory.
 * @returns {() => void} release only after all writes are quiescent and their outcome is known.
 */
export function acquireStateLease(stateDir) {
  const lockPath = join(stateDir, ACTIVE_LOCK)
  let descriptor
  try {
    descriptor = openSync(lockPath, 'wx', 0o600)
    writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, startedAt: Date.now() })}\n`, 'utf8')
    fsyncSync(descriptor)
    syncDirectory(stateDir)
  } catch (error) {
    if (descriptor !== undefined) {
      try { closeSync(descriptor) } catch { /* the failed lease has no live writer to preserve */ }
      try { unlinkSync(lockPath) } catch { /* a failed unpublished lease remains fail-closed */ }
    }
    if (error?.code === 'EEXIST') throw new Error(BROKER_REFUSE.STATE_ACTIVE)
    throw new Error('broker:state-lease-unavailable')
  }
  let released = false
  return () => {
    if (released) return
    released = true
    closeSync(descriptor)
    unlinkSync(lockPath)
    syncDirectory(stateDir)
  }
}

/** Parse one closed broker-key record and prove its public and private halves agree. */
function loadSavedBrokerKey(saved) {
  if (saved === null || typeof saved !== 'object' || Array.isArray(saved)) {
    throw new Error('broker:key-state-malformed')
  }
  const keys = Object.keys(saved).sort()
  if (keys.length !== 2 || keys[0] !== 'privatePem' || keys[1] !== 'publicPem'
    || typeof saved.privatePem !== 'string' || typeof saved.publicPem !== 'string') {
    throw new Error('broker:key-state-malformed')
  }
  let privateKey
  let publicKey
  try {
    privateKey = createPrivateKey(saved.privatePem)
    publicKey = canonicalEd25519PublicKey(saved.publicPem)
  } catch {
    throw new Error('broker:key-state-malformed')
  }
  if (privateKey.asymmetricKeyType !== 'ed25519' || publicKey === null) {
    throw new Error('broker:key-state-malformed')
  }
  const derived = createPublicKey(privateKey).export({ type: 'spki', format: 'der' })
  const declared = publicKey.export({ type: 'spki', format: 'der' })
  if (!derived.equals(declared)) throw new Error('broker:key-pair-mismatch')
  return {
    privateKey,
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

/**
 * Create or load the broker receipt identity before launch.
 *
 * The installer or launch supervisor calls this while it owns `stateDir`, then
 * pins the returned public identity into the issuer's environment. The private
 * key is never returned. Calling this from the eventual guest principal would
 * defeat provisioning custody; the launch supervisor must run it before it
 * starts that principal. The macOS target uses launchd principals rather than
 * an in-process uid drop.
 *
 * @param {string} stateDir - the future broker-owned state directory.
 * @returns {{ brokerPublicKeyPem: string, receiptKeyId: string }} public provisioning data.
 */
export function provisionBrokerIdentity(stateDir) {
  const { publicPem } = loadBrokerKey(stateDir)
  return {
    brokerPublicKeyPem: publicPem,
    receiptKeyId: receiptKeyIdForPublicKey(publicPem),
  }
}

/** Read one exact non-negative sequence counter; only a missing entry means zero. */
function readSequence(stateDir) {
  const seqFile = join(stateDir, 'seq')
  const state = inspectEntry(seqFile, 'broker:sequence-state-unobservable')
  if (!state.present) return 0
  if (!state.stat.isFile() || state.stat.isSymbolicLink()) throw new Error('broker:sequence-state-malformed')
  let raw
  let descriptor
  try {
    descriptor = openSync(seqFile, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    if (!fstatSync(descriptor).isFile()) throw new Error('broker:sequence-state-malformed')
    raw = readFileSync(descriptor, 'utf8')
  } catch (error) {
    if (error?.message === 'broker:sequence-state-malformed') throw error
    throw new Error('broker:sequence-state-unobservable')
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
  if (!/^(?:0|[1-9][0-9]*)$/.test(raw)) throw new Error('broker:sequence-state-malformed')
  const sequence = Number(raw)
  if (!Number.isSafeInteger(sequence)) throw new Error('broker:sequence-state-malformed')
  return sequence
}

/** Write the local Aura-head witness through one non-following descriptor. */
function writeSequence(stateDir, sequence) {
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new TypeError('broker: invalid sequence')
  const seqFile = join(stateDir, 'seq')
  let descriptor
  try {
    descriptor = openSync(seqFile, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0), 0o600)
    if (!fstatSync(descriptor).isFile()) throw new Error('broker:sequence-state-malformed')
    writeFileSync(descriptor, String(sequence), 'utf8')
    fsyncSync(descriptor)
  } catch (error) {
    if (error?.message === 'broker:sequence-state-malformed' || error?.code === 'ELOOP') {
      throw new Error('broker:sequence-state-malformed')
    }
    throw new Error('broker:sequence-state-unobservable')
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
  syncDirectory(stateDir)
}

/**
 * Verify Aura's complete local order against the separate head witness.
 *
 * This detects a chain shortened without the sequence file changing. It does
 * not resist a same-uid attacker who coherently rewrites both files; that
 * requires an anchor outside this uid's authority.
 * @param {string} stateDir - retained broker state.
 * @returns {number} verified local sequence, not an independently anchored latest head.
 */
export function readSettlementHead(stateDir) {
  const auraFile = join(stateDir, 'aura.jsonl')
  const auraState = inspectEntry(auraFile, 'broker:aura-state-unobservable')
  let count = 0
  let auraChainHashes = new Set()
  let receiptSha256s = new Set()
  if (auraState.present) {
    if (!auraState.stat.isFile() || auraState.stat.isSymbolicLink()) {
      throw new Error('broker:aura-preflight (record:unavailable)')
    }
    const verified = readVerifiedChain(auraFile)
    if (!verified.ok) throw new Error(`broker:aura-preflight (${verified.reason})`)
    for (let index = 0; index < verified.entries.length; index++) {
      if (verified.entries[index]?.sequence !== index + 1) {
        throw new Error(BROKER_REFUSE.AURA_SEQUENCE_MISMATCH)
      }
    }
    count = verified.count
    auraChainHashes = new Set(verified.entries.map(entry => entry.hash))
    receiptSha256s = new Set(verified.entries.map(entry => entry.receiptSha256).filter(Boolean))
  }
  const authorityEvidence = verifyAuthorityEvidenceDirectory({ stateDir, auraChainHashes })
  if (!authorityEvidence.ok) {
    throw new Error(`broker:aura-preflight (${authorityEvidence.reason})`)
  }
  const receipts = verifyReceiptDirectory({ stateDir, receiptSha256s })
  if (!receipts.ok) {
    throw new Error(`broker:aura-preflight (${receipts.reason})`)
  }
  if (readSequence(stateDir) !== count) {
    throw new Error(BROKER_REFUSE.AURA_SEQUENCE_MISMATCH)
  }
  return count
}

// ── process-restart prepared markers ───────────────────────────────────────

const INTENTS_DIR = 'intents'
const INTENT_NONCE = /^[a-zA-Z0-9_-]{1,128}$/
const INTENT_DIGEST = /^[0-9a-f]{64}$/
const INTENT_KEYS = Object.freeze(['nonce', 'operationDigest', 'startedAt'])

/** Write a marker before the effect starts for reconciliation after a process restart. */
function writeIntent(stateDir, nonce, operationDigestValue) {
  if (!INTENT_NONCE.test(nonce)) throw new TypeError(`writeIntent: nonce is not a safe filename`)
  const dir = join(stateDir, INTENTS_DIR)
  ensureExactDirectory(dir, 'broker:intent-state-malformed')
  const file = join(dir, `${nonce}.json`)
  let descriptor
  try {
    descriptor = openSync(file, 'wx', 0o600)
    writeFileSync(descriptor, `${JSON.stringify({ nonce, operationDigest: operationDigestValue, startedAt: Date.now() })}\n`, 'utf8')
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

/** Remove the prepared marker after Aura settlement. */
function clearIntent(stateDir, nonce) {
  try {
    unlinkSync(join(stateDir, INTENTS_DIR, `${nonce}.json`))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

/**
 * Classify every entry in the prepared-marker directory on startup.
 *
 * A valid marker proves only that its cleanup did not complete before the
 * previous process ended. It does not prove whether the effect ran or whether
 * Aura settlement completed; both outcomes are INDETERMINATE. The filesystem
 * write supports process-restart reconciliation only. It makes no host-crash
 * durability claim.
 *
 * An entry that cannot be proven to be one exact prepared-marker record is
 * malformed. It remains on disk and blocks startup rather than disappearing
 * from the reconciliation result. The return field `orphaned` is retained for
 * callers, but contains valid unresolved marker nonces, not proven orphans.
 * @param {string} stateDir
 * @returns {{ orphaned: string[], malformed: Array<{entry: string, reason: string}> }}
 * unresolved nonces and entries that could not be classified.
 */
export function reconcileIntents(stateDir) {
  const intentsDir = join(stateDir, INTENTS_DIR)
  let directory
  try {
    directory = lstatSync(intentsDir)
  } catch (error) {
    if (error?.code === 'ENOENT') return { orphaned: [], malformed: [] }
    const reason = 'intent-path-unobservable'
    console.error(`broker:intent-malformed entry=${JSON.stringify(INTENTS_DIR)} reason=${reason} code=${String(error?.code ?? 'UNKNOWN')}`)
    return { orphaned: [], malformed: [{ entry: INTENTS_DIR, reason }] }
  }
  if (directory.isSymbolicLink()) {
    const reason = 'intent-path-is-symbolic-link'
    console.error(`broker:intent-malformed entry=${JSON.stringify(INTENTS_DIR)} reason=${reason}`)
    return { orphaned: [], malformed: [{ entry: INTENTS_DIR, reason }] }
  }
  if (!directory.isDirectory()) {
    const reason = 'intent-path-not-a-directory'
    console.error(`broker:intent-malformed entry=${JSON.stringify(INTENTS_DIR)} reason=${reason}`)
    return { orphaned: [], malformed: [{ entry: INTENTS_DIR, reason }] }
  }
  const unresolved = []
  const malformed = []
  const reject = (entry, reason) => {
    malformed.push({ entry, reason })
    console.error(`broker:intent-malformed entry=${JSON.stringify(entry)} reason=${reason}`)
  }
  let entries
  try {
    entries = readdirSync(intentsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    const reason = 'intent-directory-unreadable'
    console.error(`broker:intent-malformed entry=${JSON.stringify(INTENTS_DIR)} reason=${reason} code=${String(error?.code ?? 'UNKNOWN')}`)
    return { orphaned: [], malformed: [{ entry: INTENTS_DIR, reason }] }
  }
  for (const entry of entries) {
    const f = entry.name
    if (!entry.isFile() || entry.isSymbolicLink()) {
      reject(f, 'not-a-regular-file')
      continue
    }
    if (!f.endsWith('.json')) {
      reject(f, 'unexpected-filename')
      continue
    }
    let intent
    try {
      intent = JSON.parse(readFileSync(join(intentsDir, f), 'utf8'))
    } catch {
      reject(f, 'unparseable-json')
      continue
    }
    if (intent === null || typeof intent !== 'object' || Array.isArray(intent)) {
      reject(f, 'record-not-an-object')
      continue
    }
    const keys = Object.keys(intent).sort()
    if (keys.length !== INTENT_KEYS.length || keys.some((key, index) => key !== INTENT_KEYS[index])) {
      reject(f, 'record-fields-not-exact')
      continue
    }
    if (typeof intent.nonce !== 'string' || !INTENT_NONCE.test(intent.nonce)) {
      reject(f, 'invalid-nonce')
      continue
    }
    if (f !== `${intent.nonce}.json`) {
      reject(f, 'filename-nonce-mismatch')
      continue
    }
    if (typeof intent.operationDigest !== 'string' || !INTENT_DIGEST.test(intent.operationDigest)) {
      reject(f, 'invalid-operation-digest')
      continue
    }
    if (!Number.isSafeInteger(intent.startedAt) || intent.startedAt < 0) {
      reject(f, 'invalid-started-at')
      continue
    }
    unresolved.push(intent.nonce)
    console.error(`broker:intent-unresolved nonce=${intent.nonce} operationDigest=${intent.operationDigest} — cleanup incomplete; effect and Aura settlement are each INDETERMINATE`)
  }
  return { orphaned: unresolved, malformed }
}

/**
 * Does this process's signature primitive still refuse a corrupted signature?
 *
 * Not a defence — a first-mover owns any randomness a probe would use. It is
 * a report of this process's own state, which is exactly what the caller
 * cannot supply for it.
 *
 * @returns {boolean} true when a good signature verifies and a corrupted one does not.
 */
export function cryptoIsHonest() {
  const { generateKeyPairSync, sign, verify, randomBytes } = require_crypto()
  const pair = generateKeyPairSync('ed25519')
  const message = randomBytes(32)
  const signature = sign(null, message, pair.privateKey)
  if (verify(null, message, pair.publicKey, signature) !== true) return false
  const corrupted = Buffer.from(signature)
  corrupted[0] ^= 0xff
  return verify(null, message, pair.publicKey, corrupted) === false
}

/** Bound at call time so a poisoned parent cannot pre-empt this module's import. */
function require_crypto() {
  // eslint-disable-next-line no-undef
  return process.getBuiltinModule('crypto')
}

/**
 * Launch the canonical broker as its own process and wait for its direct-child
 * IPC readiness message.
 *
 * @param {object} options
 * @param {string} options.socketPath - socket the broker will create.
 * @param {string} options.stateDir - directory the broker will own.
 * @param {string} options.rootPublicKeyPem - root grants must verify against.
 * @param {string} [options.issuerSocket] - trusted issuer route for proposal.deposit.
 * @param {(request: object, signal: AbortSignal) => Promise<'approved'|'denied'>|'approved'|'denied'} [options.review] -
 *   parent-owned renderer and human-decision callback. Throws naming REVIEW_CHANNEL_UNAVAILABLE,
 *   REVIEW_TIMED_OUT, or STOPPING preserve those refusals; other failures produce REVIEW_RESPONSE_MALFORMED.
 * @param {boolean} [options.exitOnParentDisconnect] - close this direct child when its launcher IPC route disappears.
 * @param {boolean} [options.socketGroupAccess] - publish the socket through
 *   the fixed `0710` directory and `0660` socket policy.
 * @param {Record<string, string | undefined>} [options.env] - environment to scrub, defaults to the parent's.
 * @param {string} [options.peerTokenPath] - path of a launch-provisioned token whose broker read must fail.
 * @param {string} [options.peerTokenSha256] - sha256 hex of that token's bytes, so the broker can check an echo it cannot read.
 * @param {{subject: string, privacy: readonly string[]}} [options.kiraRecallPolicy] -
 *   parent-owned KIRA subject and privacy policy.
 * @param {unknown} [options.subjectAuthority] - launch-pinned session-to-Agent
 *   delegation that selects v5 proposal grants.
 * @param {(request: object, signal: AbortSignal) => Promise<unknown>|unknown} [options.selectSubjectAuthority] -
 *   parent-owned selector for one exact proposal-specific delegation.
 * @param {unknown} [options.subjectAuthorityExpectation] - public subject,
 *   control, activation, and audience required from every selection.
 * @param {unknown} [options.rootControlState] - active hybrid AUMLOK control head to bind create-if-absent.
 * @param {number} [options.timeoutMs] - how long to wait for the socket.
 * @returns {Promise<import('node:child_process').ChildProcess>} the running broker.
 */
export async function spawnBroker(options) {
  if (Object.hasOwn(options, 'entry')) {
    throw new Error(BROKER_REFUSE.CUSTOM_ENTRY_FORBIDDEN)
  }
  const {
    socketPath,
    stateDir,
    rootPublicKeyPem,
    issuerSocket,
    review,
    exitOnParentDisconnect = false,
    socketGroupAccess = false,
    env = process.env,
    peerTokenPath,
    peerTokenSha256,
    activationDigest,
    rendererId,
    kiraRecallPolicy,
    workspaceRoots,
    subjectAuthority,
    selectSubjectAuthority,
    subjectAuthorityExpectation,
    rootControlState,
    timeoutMs = 5000,
  } = options
  if (review !== undefined && typeof review !== 'function') {
    throw new TypeError('broker: parent review callback must be a function')
  }
  if (selectSubjectAuthority !== undefined && typeof selectSubjectAuthority !== 'function') {
    throw new TypeError('broker: parent subject-authority selector must be a function')
  }
  if (typeof exitOnParentDisconnect !== 'boolean') {
    throw new TypeError('broker: exitOnParentDisconnect must be boolean')
  }
  if (typeof socketGroupAccess !== 'boolean') {
    throw new TypeError('broker: socketGroupAccess must be boolean')
  }
  if (canonicalEd25519PublicKey(rootPublicKeyPem) === null) {
    throw new Error(BROKER_REFUSE.ROOT_PUBLIC_KEY_INVALID)
  }
  const validatedKiraPolicy = readKiraPolicy(kiraRecallPolicy)
  const subjectAuthorityContext = subjectAuthority === undefined
    ? null
    : createSubjectAuthorityContext(subjectAuthority)
  const dynamicAuthorityExpectation = subjectAuthorityExpectation === undefined
    ? null
    : createSubjectAuthorityExpectation(subjectAuthorityExpectation)
  if (subjectAuthorityContext !== null && dynamicAuthorityExpectation !== null) {
    throw new Error(BROKER_REFUSE.AUTHORITY_CONFIGURATION_INVALID)
  }
  if ((dynamicAuthorityExpectation === null) !== (typeof selectSubjectAuthority !== 'function')) {
    throw new Error(BROKER_REFUSE.AUTHORITY_CONFIGURATION_INVALID)
  }
  const authorityExpectation = subjectAuthorityContext ?? dynamicAuthorityExpectation
  if (authorityExpectation !== null && authorityExpectation.activationDigest !== activationDigest) {
    throw new Error(BROKER_REFUSE.ACTIVATION_MISMATCH)
  }
  if (authorityExpectation !== null
    && validatedKiraPolicy !== null
    && validatedKiraPolicy.subject !== authorityExpectation.subject) {
    throw new Error(BROKER_REFUSE.KIRA_RECALL_POLICY_INVALID)
  }
  if (rootControlState !== undefined) {
    if (authorityExpectation === null) throw new Error(BROKER_REFUSE.IDENTITY_CONTROL_UNBOUND)
    const candidate = admitIdentityControl({
      state: rootControlState,
      expectedSubject: authorityExpectation.subject,
      expectedControlDigest: authorityExpectation.activeControlDigest,
      rootPublicKeyPem,
    })
    if (!candidate.ok) throw new Error(candidate.reason)
    ensureExactDirectory(stateDir, BROKER_REFUSE.STATE_PATH_MALFORMED, { recursive: true })
    bindIdentityControlState(stateDir, rootControlState)
  }
  const persistedIdentityControl = readIdentityControlState(stateDir)
  if ((authorityExpectation === null) !== (persistedIdentityControl === null)) {
    throw new Error(BROKER_REFUSE.IDENTITY_CONTROL_UNBOUND)
  }
  if (authorityExpectation !== null) {
    const persisted = admitIdentityControl({
      state: persistedIdentityControl,
      expectedSubject: authorityExpectation.subject,
      expectedControlDigest: authorityExpectation.activeControlDigest,
      rootPublicKeyPem,
    })
    if (!persisted.ok) throw new Error(persisted.reason)
  }
  if (inspectEntry(socketPath, BROKER_REFUSE.SOCKET_PATH_OCCUPIED).present) {
    throw new Error(BROKER_REFUSE.SOCKET_PATH_OCCUPIED)
  }
  const childEnv = { ...scrubEnv(env) }
  childEnv.AUKORA_SOCKET = socketPath
  childEnv.AUKORA_STATE_DIR = stateDir
  childEnv.AUKORA_ROOT_PEM = rootPublicKeyPem
  if (issuerSocket !== undefined) childEnv.AUKORA_ISSUER_SOCKET = issuerSocket
  if (review !== undefined) childEnv.AUKORA_PARENT_REVIEW = '1'
  if (selectSubjectAuthority !== undefined) childEnv[PARENT_AUTHORITY_ENV] = '1'
  if (exitOnParentDisconnect) childEnv[EXIT_ON_PARENT_DISCONNECT_ENV] = '1'
  if (socketGroupAccess) childEnv[SOCKET_GROUP_ACCESS_ENV] = '1'
  // Set explicitly after the scrub, never inherited: an ambient peer token in
  // the caller's environment is a value the caller chose, and the class must
  // never turn on anything the caller can set.
  if (peerTokenPath !== undefined) childEnv[PEER_TOKEN_PATH_ENV] = peerTokenPath
  if (peerTokenSha256 !== undefined) childEnv[PEER_TOKEN_SHA256_ENV] = peerTokenSha256
  // Only the digest crosses the frame. The statement stays in the parent, so a
  // child can compare its activation but can never present a wider one.
  if (activationDigest !== undefined) childEnv[ACTIVATION_DIGEST_ENV] = activationDigest
  if (rendererId !== undefined) childEnv[RENDERER_ID_ENV] = rendererId
  if (validatedKiraPolicy !== null) {
    childEnv[KIRA_RECALL_POLICY_ENV] = canonicalJSON(validatedKiraPolicy)
  }
  if (workspaceRoots !== undefined) {
    childEnv[WORKSPACE_ROOTS_ENV] = canonicalJSON(readWorkspaceRoots(workspaceRoots))
  }
  if (subjectAuthorityContext !== null) {
    childEnv.AUKORA_SUBJECT_AUTHORITY_B64 = encodeSubjectAuthorityContext(subjectAuthorityContext)
  }
  if (dynamicAuthorityExpectation !== null) {
    childEnv[SUBJECT_AUTHORITY_EXPECTATION_ENV] = encodeSubjectAuthorityExpectation(dynamicAuthorityExpectation)
  }
  // `spawn()` receives only this explicit argv; unlike `fork()`, it does not
  // inherit the parent's `process.execArgv`. `--` also fixes the script slot
  // so Node cannot parse it as an engine option.
  const child = spawn(NODE_EXECUTABLE, ['--', BROKER_ENTRY], {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  await waitForBrokerReady(child, timeoutMs)
  if (review !== undefined) installParentReviewHandler(child, review)
  if (selectSubjectAuthority !== undefined) {
    installParentAuthorityHandler(child, selectSubjectAuthority)
  }
  return child
}

/**
 * Connect child review requests to one parent-owned decision callback.
 *
 * The parent echoes every identity and digest field; the child rejects a
 * mismatched, late, malformed, or unknown decision before contacting the
 * issuer. The callback receives a frozen copy and returns only the human
 * decision, so no guest-controlled value becomes an approval response.
 * Named review-channel, deadline, and stopping failures cross as refusals.
 *
 * @param {import('node:child_process').ChildProcess} child - broker child with an IPC descriptor.
 * @param {(request: object, signal: AbortSignal) => Promise<'approved'|'denied'>|'approved'|'denied'} review - parent review callback.
 */
function installParentReviewHandler(child, review) {
  const active = new Map()
  const onMessage = (message) => {
    if (isExactReviewCancel(message)) {
      const current = active.get(message.reviewId)
      if (current?.proposalId !== message.proposalId) return
      active.delete(message.reviewId)
      current.controller.abort('broker stopped waiting for this review')
      return
    }
    if (!isExactReviewRequest(message)) return
    if (active.has(message.reviewId)) return
    const request = Object.freeze({ ...message })
    const controller = new AbortController()
    active.set(request.reviewId, { controller, proposalId: request.proposalId })
    void Promise.resolve().then(() => review(request, controller.signal)).then(
      (decision) => {
        if (!controller.signal.aborted) sendReviewDecision(child, request, decision)
      },
      (error) => {
        const reason = String(error?.message ?? error)
        if (!controller.signal.aborted) {
          sendReviewDecision(child, request, PARENT_REVIEW_FAILURES.has(reason) ? reason : 'invalid')
        }
      },
    ).finally(() => {
      active.delete(request.reviewId)
    })
  }
  const cleanup = () => {
    child.removeListener('message', onMessage)
    child.removeListener('disconnect', cleanup)
    child.removeListener('exit', cleanup)
    for (const current of active.values()) {
      current.controller.abort('broker child exited before the review completed')
    }
    active.clear()
  }
  child.on('message', onMessage)
  child.once('exit', cleanup)
  child.once('disconnect', cleanup)
}

/** Connect proposal-specific authority requests to the launch parent's selector. */
function installParentAuthorityHandler(child, selectSubjectAuthority) {
  const active = new Map()
  const onMessage = (message) => {
    if (isExactAuthorityCancel(message)) {
      const current = active.get(message.selectionId)
      if (current?.proposalId !== message.proposalId) return
      active.delete(message.selectionId)
      current.controller.abort('broker stopped waiting for this authority selection')
      return
    }
    if (!isExactAuthorityRequest(message) || active.has(message.selectionId)) return
    const request = Object.freeze({ ...message, budget: Object.freeze({ ...message.budget }) })
    const controller = new AbortController()
    active.set(request.selectionId, { controller, proposalId: request.proposalId })
    void Promise.resolve().then(() => selectSubjectAuthority(request, controller.signal)).then(
      (authority) => {
        if (!controller.signal.aborted) sendAuthoritySelection(child, request, authority)
      },
      () => {
        if (!controller.signal.aborted) sendAuthoritySelection(child, request, null)
      },
    ).finally(() => {
      active.delete(request.selectionId)
    })
  }
  const cleanup = () => {
    child.removeListener('message', onMessage)
    child.removeListener('disconnect', cleanup)
    child.removeListener('exit', cleanup)
    for (const current of active.values()) {
      current.controller.abort('broker child exited before the authority selection completed')
    }
    active.clear()
  }
  child.on('message', onMessage)
  child.once('exit', cleanup)
  child.once('disconnect', cleanup)
}

/** Whether one child cancellation names exactly one outstanding authority selection. */
function isExactAuthorityCancel(message) {
  return isExactDataObject(message, ['type', 'selectionId', 'proposalId'])
    && message.type === BROKER_AUTHORITY_CANCEL
    && typeof message.selectionId === 'string' && /^[0-9a-f]{32}$/.test(message.selectionId)
    && typeof message.proposalId === 'string' && /^[0-9a-f]{32}$/.test(message.proposalId)
}

/** Send one closed selection frame that echoes every proposal-owned authority field. */
function sendAuthoritySelection(child, request, authorityInput) {
  if (!child.connected || child.exitCode !== null || child.signalCode !== null) return
  let authority = null
  try {
    authority = createSubjectAuthorityContext(authorityInput)
  } catch {
    // A callback failure crosses as a malformed selection, never as authority.
  }
  const frame = {
    type: BROKER_AUTHORITY_SELECTION,
    selectionId: request.selectionId,
    proposalId: request.proposalId,
    operationDigest: request.operationDigest,
    artifactDigest: request.artifactDigest,
    toolName: request.toolName,
    activationDigest: request.activationDigest,
    audience: request.audience,
    resource: request.resource,
    budget: request.budget,
    expiresAt: request.expiresAt,
    authority,
  }
  try {
    child.send(frame, () => {})
  } catch {
    // Child exit owns this race; the selected context remains parent-local.
  }
}

/** Whether one child request contains exactly the dynamic-v5 selection field set. */
function isExactAuthorityRequest(message) {
  return isExactDataObject(message, [
    'type', 'selectionId', 'proposalId', 'operationDigest', 'artifactDigest',
    'activationDigest', 'audience', 'resource', 'budget', 'expiresAt', 'toolName',
  ])
    && message.type === BROKER_AUTHORITY_REQUEST
    && typeof message.selectionId === 'string' && /^[0-9a-f]{32}$/.test(message.selectionId)
    && typeof message.proposalId === 'string' && /^[0-9a-f]{32}$/.test(message.proposalId)
    && typeof message.operationDigest === 'string' && HEX_SHA256.test(message.operationDigest)
    && typeof message.artifactDigest === 'string' && HEX_SHA256.test(message.artifactDigest)
    && typeof message.activationDigest === 'string' && HEX_SHA256.test(message.activationDigest)
    && typeof message.audience === 'string' && message.audience.length > 0
    && Buffer.byteLength(message.audience, 'utf8') <= 256
    && typeof message.resource === 'string'
    && ((message.toolName === MEMORY_PUT
      && message.resource.startsWith(MEMORY_RESOURCE_PREFIX)
      && KEY_SHAPE.test(message.resource.slice(MEMORY_RESOURCE_PREFIX.length)))
      || (message.toolName === WORKSPACE_PATCH && isWorkspaceResource(message.resource)))
    && isExactAuthorityBudget(message.budget)
    && Number.isSafeInteger(message.expiresAt) && message.expiresAt > 0
}

/** Whether one IPC value is the closed one-action budget emitted by this broker. */
function isExactAuthorityBudget(value) {
  return isExactDataObject(value, ['calls', 'bytes', 'computeMs', 'costMicrounits'])
    && value.calls === 1
    && Number.isSafeInteger(value.bytes) && value.bytes >= 0
    && value.computeMs === 0
    && value.costMicrounits === 0
}

/** Whether one child cancellation names exactly one outstanding review. */
function isExactReviewCancel(message) {
  return isExactDataObject(message, ['type', 'reviewId', 'proposalId'])
    && message.type === BROKER_REVIEW_CANCEL
    && typeof message.reviewId === 'string' && /^[0-9a-f]{32}$/.test(message.reviewId)
    && typeof message.proposalId === 'string' && /^[0-9a-f]{32}$/.test(message.proposalId)
}

/** Send one exact echoed parent decision; unknown callback values remain invalid. */
function sendReviewDecision(child, request, decision) {
  if (!child.connected || child.exitCode !== null || child.signalCode !== null) return
  const frame = {
    type: BROKER_REVIEW_DECISION,
    reviewId: request.reviewId,
    proposalId: request.proposalId,
    artifactDigest: request.artifactDigest,
    operationDigest: request.operationDigest,
    authorizationDigest: request.authorizationDigest,
    decision,
  }
  try {
    child.send(frame, () => {})
  } catch {
    // Child exit owns this race; no authority state is retained in the parent.
  }
}

/** Whether one child review request contains exactly the closed v2 field set. */
function isExactReviewRequest(message) {
  if (!isExactDataObject(message, [
    'type', 'reviewId', 'proposalId', 'artifact', 'artifactDigest', 'operationDigest', 'authorizationDigest', 'expiresAt',
  ])) return false
  if (message.type !== BROKER_REVIEW_REQUEST
    || typeof message.reviewId !== 'string' || !/^[0-9a-f]{32}$/.test(message.reviewId)
    || typeof message.proposalId !== 'string' || !/^[0-9a-f]{32}$/.test(message.proposalId)
    || typeof message.artifactDigest !== 'string' || !HEX_SHA256.test(message.artifactDigest)
    || typeof message.operationDigest !== 'string' || !HEX_SHA256.test(message.operationDigest)
    || typeof message.authorizationDigest !== 'string' || !HEX_SHA256.test(message.authorizationDigest)
    || !Number.isSafeInteger(message.expiresAt) || message.expiresAt <= 0) {
    return false
  }
  try {
    const artifact = parseApprovalArtifact(message.artifact)
    if (approvalArtifactDigest(artifact) !== message.artifactDigest) return false
    if (artifact.operationDigest !== message.operationDigest) return false
    if (artifact.expiry !== message.expiresAt) return false
    return Buffer.byteLength(JSON.stringify(artifact), 'utf8') <= MAX_FRAME_BYTES
  } catch {
    return false
  }
}

/** Whether an IPC value is a plain data object with one exact enumerable field set. */
function isExactDataObject(value, keys) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  if (Reflect.ownKeys(value).length !== keys.length) return false
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor !== undefined && descriptor.enumerable && Object.hasOwn(descriptor, 'value')
  })
}

/**
 * Await the readiness message written by the process this function spawned.
 *
 * A socket connection is not evidence of child custody: another process can
 * bind the name before or during launch. The IPC channel joins this parent to
 * the child it spawned, and the child sends this exact frame after
 * {@link serve} has bound the socket. The frame is not a cryptographic peer
 * authentication mechanism; that remains a deployment requirement.
 *
 * @param {import('node:child_process').ChildProcess} child - the spawned broker.
 * @param {number} timeoutMs - maximum launch time.
 * @returns {Promise<void>} when this child reports that it is serving.
 */
function waitForBrokerReady(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer
    let settled = false
    let stderr = ''
    const onStderr = (chunk) => {
      stderr += chunk.toString('utf8')
      if (stderr.length > 8192) stderr = stderr.slice(-8192)
    }
    const cleanup = () => {
      clearTimeout(timer)
      child.removeListener('message', onMessage)
      child.removeListener('error', onError)
      child.removeListener('exit', onExit)
      child.stderr?.removeListener('data', onStderr)
    }
    const stop = () => new Promise((done) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        done()
        return
      }
      const onStopped = () => done()
      child.once('exit', onStopped)
      if (child.exitCode !== null || child.signalCode !== null) {
        child.removeListener('exit', onStopped)
        done()
        return
      }
      try {
        // A child that sent a malformed readiness frame is not a graceful
        // shutdown peer. SIGKILL stops that direct child before this function
        // rejects; its state residue remains deliberately fail-closed for
        // operator reconciliation. This is not process-tree containment: a
        // child-controlled detached descendant remains a launch-custody risk.
        if (child.kill('SIGKILL')) return
      } catch {
        // An already-exited child reaches the checks below. No other error can
        // make a live malformed child safe to leave running.
      }
      child.removeListener('exit', onStopped)
      done()
    })
    const fail = (error) => {
      if (settled) return
      settled = true
      cleanup()
      void stop().then(() => reject(error))
    }
    const onMessage = (message) => {
      if (message?.type !== BROKER_READY) {
        fail(new Error('broker:launch-readiness-malformed'))
        return
      }
      settled = true
      cleanup()
      resolve()
    }
    const onError = (error) => fail(error)
    const onExit = (code, signal) => {
      const detail = stderr.trim()
      fail(new Error(`broker exited before child IPC readiness with code ${code ?? 'null'} signal ${signal ?? 'null'}${detail === '' ? '' : `: ${detail}`}`))
    }
    timer = setTimeout(() => fail(new Error(`broker did not report child IPC readiness within ${timeoutMs}ms`)), timeoutMs)
    child.once('message', onMessage)
    child.once('error', onError)
    child.once('exit', onExit)
    child.stderr?.on('data', onStderr)
  })
}

/**
 * Ask the launch parent to render and decide one exact operation over IPC.
 *
 * @param {object} request - closed review request constructed by the broker.
 * @param {AbortSignal} signal - broker shutdown signal.
 * @returns {Promise<'approved'|'denied'>} the exact parent decision.
 * @throws {Error} the named parent review failure or a malformed-response refusal.
 */
function requestParentReview(request, signal) {
  return new Promise((resolve, reject) => {
    if (typeof process.send !== 'function' || !process.connected) {
      reject(new Error(BROKER_REFUSE.REVIEW_CHANNEL_UNAVAILABLE))
      return
    }
    if (signal.aborted) {
      reject(new Error(BROKER_REFUSE.STOPPING))
      return
    }
    let settled = false
    const finish = (done) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      process.removeListener('message', onMessage)
      process.removeListener('disconnect', onDisconnect)
      done()
    }
    const cancel = () => sendReviewCancel(request)
    const onAbort = () => finish(() => {
      cancel()
      reject(new Error(BROKER_REFUSE.STOPPING))
    })
    const onDisconnect = () => finish(() => {
      reject(new Error(BROKER_REFUSE.REVIEW_CHANNEL_UNAVAILABLE))
    })
    const onMessage = (message) => {
      if (message?.type !== BROKER_REVIEW_DECISION || message?.reviewId !== request.reviewId) return
      finish(() => {
        if (!isExactDataObject(message, [
          'type', 'reviewId', 'proposalId', 'artifactDigest', 'operationDigest', 'authorizationDigest', 'decision',
        ])
          || message.proposalId !== request.proposalId
          || message.artifactDigest !== request.artifactDigest
          || message.operationDigest !== request.operationDigest
          || message.authorizationDigest !== request.authorizationDigest
          || (message.decision !== 'approved' && message.decision !== 'denied'
            && !PARENT_REVIEW_FAILURES.has(message.decision))) {
          cancel()
          reject(new Error(BROKER_REFUSE.REVIEW_RESPONSE_MALFORMED))
          return
        }
        if (PARENT_REVIEW_FAILURES.has(message.decision)) {
          reject(new Error(message.decision))
          return
        }
        resolve(message.decision)
      })
    }
    const timer = setTimeout(() => {
      finish(() => {
        cancel()
        reject(new Error(BROKER_REFUSE.REVIEW_TIMED_OUT))
      })
    }, BROKER_REVIEW_TIMEOUT_MS)
    signal.addEventListener('abort', onAbort, { once: true })
    process.on('message', onMessage)
    process.once('disconnect', onDisconnect)
    try {
      process.send(request, (error) => {
        if (error !== null && error !== undefined) {
          finish(() => {
            cancel()
            reject(new Error(BROKER_REFUSE.REVIEW_CHANNEL_UNAVAILABLE))
          })
        }
      })
    } catch {
      finish(() => {
        cancel()
        reject(new Error(BROKER_REFUSE.REVIEW_CHANNEL_UNAVAILABLE))
      })
    }
  })
}

/** Tell the parent that one prompt no longer has a waiting broker occurrence. */
function sendReviewCancel(request) {
  if (typeof process.send !== 'function' || !process.connected) return
  try {
    process.send({
      type: BROKER_REVIEW_CANCEL,
      reviewId: request.reviewId,
      proposalId: request.proposalId,
    }, () => {})
  } catch {
    // A disconnected parent has no live prompt route to cancel.
  }
}

/** Ask the launch parent for one proposal-specific subject-authority context. */
function requestParentAuthority(request, signal) {
  return new Promise((resolve, reject) => {
    if (typeof process.send !== 'function' || !process.connected) {
      reject(new Error(BROKER_REFUSE.AUTHORITY_CHANNEL_UNAVAILABLE))
      return
    }
    if (signal.aborted) {
      reject(new Error(BROKER_REFUSE.STOPPING))
      return
    }
    let settled = false
    const finish = (done) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      process.removeListener('message', onMessage)
      process.removeListener('disconnect', onDisconnect)
      done()
    }
    const cancel = () => sendAuthorityCancel(request)
    const onAbort = () => finish(() => {
      cancel()
      reject(new Error(BROKER_REFUSE.STOPPING))
    })
    const onDisconnect = () => finish(() => {
      reject(new Error(BROKER_REFUSE.AUTHORITY_CHANNEL_UNAVAILABLE))
    })
    const onMessage = (message) => {
      if (message?.type !== BROKER_AUTHORITY_SELECTION || message?.selectionId !== request.selectionId) return
      finish(() => {
        if (!isExactDataObject(message, [
          'type', 'selectionId', 'proposalId', 'operationDigest', 'artifactDigest',
          'activationDigest', 'audience', 'resource', 'budget', 'expiresAt', 'authority', 'toolName',
        ])
          || message.proposalId !== request.proposalId
          || message.operationDigest !== request.operationDigest
          || message.artifactDigest !== request.artifactDigest
          || message.toolName !== request.toolName
          || message.activationDigest !== request.activationDigest
          || message.audience !== request.audience
          || message.resource !== request.resource
          || !equalAuthorityBudget(message.budget, request.budget)
          || message.expiresAt !== request.expiresAt) {
          cancel()
          reject(new Error(BROKER_REFUSE.AUTHORITY_RESPONSE_MALFORMED))
          return
        }
        try {
          resolve(createSubjectAuthorityContext(message.authority))
        } catch {
          cancel()
          reject(new Error(BROKER_REFUSE.AUTHORITY_RESPONSE_MALFORMED))
        }
      })
    }
    const timer = setTimeout(() => {
      finish(() => {
        cancel()
        reject(new Error(BROKER_REFUSE.AUTHORITY_TIMED_OUT))
      })
    }, BROKER_REVIEW_TIMEOUT_MS)
    signal.addEventListener('abort', onAbort, { once: true })
    process.on('message', onMessage)
    process.once('disconnect', onDisconnect)
    try {
      process.send(request, (error) => {
        if (error !== null && error !== undefined) {
          finish(() => {
            cancel()
            reject(new Error(BROKER_REFUSE.AUTHORITY_CHANNEL_UNAVAILABLE))
          })
        }
      })
    } catch {
      finish(() => {
        cancel()
        reject(new Error(BROKER_REFUSE.AUTHORITY_CHANNEL_UNAVAILABLE))
      })
    }
  })
}

/** Compare two closed one-action budgets without trusting prototypes or accessors. */
function equalAuthorityBudget(left, right) {
  return isExactAuthorityBudget(left)
    && isExactAuthorityBudget(right)
    && left.calls === right.calls
    && left.bytes === right.bytes
    && left.computeMs === right.computeMs
    && left.costMicrounits === right.costMicrounits
}

/** Tell the parent that one authority request no longer has a waiting proposal. */
function sendAuthorityCancel(request) {
  if (typeof process.send !== 'function' || !process.connected) return
  try {
    process.send({
      type: BROKER_AUTHORITY_CANCEL,
      selectionId: request.selectionId,
      proposalId: request.proposalId,
    }, () => {})
  } catch {
    // A disconnected parent has no live authority selector to cancel.
  }
}

/** Entrypoint: serve on $AUKORA_SOCKET with the state and root from the env. */
export async function main() {
  const {
    AUKORA_SOCKET,
    AUKORA_STATE_DIR,
    AUKORA_ROOT_PEM,
    AUKORA_ISSUER_SOCKET,
    AUKORA_PARENT_REVIEW,
    AUKORA_SUBJECT_AUTHORITY_B64,
    AUKORA_EXIT_ON_PARENT_DISCONNECT,
    AUKORA_SOCKET_GROUP_ACCESS,
  } = process.env
  if (!AUKORA_SOCKET || !AUKORA_STATE_DIR || !AUKORA_ROOT_PEM) {
    throw new Error('broker: AUKORA_SOCKET, AUKORA_STATE_DIR and AUKORA_ROOT_PEM are required')
  }
  if (AUKORA_SOCKET_GROUP_ACCESS !== undefined && AUKORA_SOCKET_GROUP_ACCESS !== '1') {
    throw new Error('broker: AUKORA_SOCKET_GROUP_ACCESS must be 1 when present')
  }
  if (process.env[PARENT_AUTHORITY_ENV] !== undefined && process.env[PARENT_AUTHORITY_ENV] !== '1') {
    throw new Error(`broker: ${PARENT_AUTHORITY_ENV} must be 1 when present`)
  }
  let kiraRecallPolicy
  if (process.env[KIRA_RECALL_POLICY_ENV] !== undefined) {
    try {
      kiraRecallPolicy = readKiraPolicy(JSON.parse(process.env[KIRA_RECALL_POLICY_ENV]))
    } catch {
      throw new Error(BROKER_REFUSE.KIRA_RECALL_POLICY_INVALID)
    }
  }
  let subjectAuthority
  if (AUKORA_SUBJECT_AUTHORITY_B64 !== undefined) {
    try {
      subjectAuthority = decodeSubjectAuthorityContext(AUKORA_SUBJECT_AUTHORITY_B64)
    } catch {
      throw new Error(BROKER_REFUSE.ACTIVATION_MISMATCH)
    }
  }
  let subjectAuthorityExpectation
  if (process.env[SUBJECT_AUTHORITY_EXPECTATION_ENV] !== undefined) {
    try {
      subjectAuthorityExpectation = decodeSubjectAuthorityExpectation(
        process.env[SUBJECT_AUTHORITY_EXPECTATION_ENV],
      )
    } catch {
      throw new Error(BROKER_REFUSE.AUTHORITY_CONFIGURATION_INVALID)
    }
  }
  const broker = await serve({
    socketPath: AUKORA_SOCKET,
    stateDir: AUKORA_STATE_DIR,
    rootPublicKeyPem: AUKORA_ROOT_PEM,
    issuerSocket: AUKORA_ISSUER_SOCKET,
    review: AUKORA_PARENT_REVIEW === '1' ? requestParentReview : undefined,
    activationDigest: process.env[ACTIVATION_DIGEST_ENV],
    rendererId: process.env[RENDERER_ID_ENV],
    kiraRecallPolicy: kiraRecallPolicy ?? undefined,
    workspaceRoots: process.env[WORKSPACE_ROOTS_ENV] === undefined
      ? undefined
      : readWorkspaceRoots(JSON.parse(process.env[WORKSPACE_ROOTS_ENV])),
    subjectAuthority,
    selectSubjectAuthority: process.env[PARENT_AUTHORITY_ENV] === '1'
      ? requestParentAuthority
      : undefined,
    subjectAuthorityExpectation,
    socketGroupAccess: AUKORA_SOCKET_GROUP_ACCESS === '1',
  })
  const stop = () => {
    void broker.close().then(
      () => process.exit(0),
      // A graceful close after route loss could unlink an unrelated listener.
      // Process exit closes only this process's descriptor and leaves the
      // ambiguity plus its state residue fail-closed for an operator.
      () => process.exit(1),
    )
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  if (AUKORA_EXIT_ON_PARENT_DISCONNECT === '1') process.on('disconnect', stop)
  if (typeof process.send === 'function') {
    await new Promise((resolve, reject) => {
      process.send({ type: BROKER_READY }, (error) => error === null || error === undefined ? resolve() : reject(error))
    })
  }
}

if (process.argv[1] && process.argv[1].endsWith('broker.mjs')) {
  main().catch((error) => { console.error(String(error?.message ?? error)); process.exit(1) })
}
