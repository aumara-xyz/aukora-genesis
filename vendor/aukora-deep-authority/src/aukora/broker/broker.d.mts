import type { ChildProcess } from 'node:child_process'
import type {
  SubjectAuthorityContext,
  SubjectAuthorityContextInput,
  SubjectAuthorityExpectationInput,
} from './subject-authority.mjs'
import type { RootControlStateV1 } from '../identity/control.mjs'

/** Stable names for broker-owned refusal reasons. */
export type BrokerRefuseKey =
  | 'OVERSIZE'
  | 'UNPARSEABLE'
  | 'UNKNOWN_OP'
  | 'LEGACY_ROUTE_FORBIDDEN'
  | 'ARGUMENTS_NOT_EXACT'
  | 'KEY_NOT_A_NAME'
  | 'STATE_ACTIVE'
  | 'STATE_PATH_MALFORMED'
  | 'SOCKET_DIRECTORY_MALFORMED'
  | 'SOCKET_DIRECTORY_UNTRUSTED'
  | 'SOCKET_PATH_OCCUPIED'
  | 'SOCKET_ROUTE_LOST'
  | 'KEY_DIRECTORY_MALFORMED'
  | 'NONCE_DIRECTORY_MALFORMED'
  | 'ROOT_PUBLIC_KEY_INVALID'
  | 'CUSTOM_DISPATCH_FORBIDDEN'
  | 'CUSTOM_ENTRY_FORBIDDEN'
  | 'AURA_SEQUENCE_MISMATCH'
  | 'CONFINEMENT_STATE_INDETERMINATE'
  | 'STOPPING'
  | 'PROPOSAL_ROUTE_UNAVAILABLE'
  | 'PROPOSAL_FRAME_NOT_EXACT'
  | 'PROPOSAL_NAMESPACE_INVALID'
  | 'PROPOSAL_NAMESPACE_TABLE_FULL'
  | 'PROPOSAL_CALL_ID_INVALID'
  | 'PROPOSAL_CALL_ID_REUSED'
  | 'PROPOSAL_TABLE_FULL'
  | 'PROPOSAL_ARGUMENTS_TOO_LARGE'
  | 'PROPOSAL_UNAVAILABLE'
  | 'PROPOSAL_INTERNAL_FAILURE'
  | 'REVIEW_CHANNEL_UNAVAILABLE'
  | 'REVIEW_DENIED'
  | 'REVIEW_RESPONSE_MALFORMED'
  | 'REVIEW_TIMED_OUT'
  | 'AUTHORITY_CHANNEL_UNAVAILABLE'
  | 'AUTHORITY_CONFIGURATION_INVALID'
  | 'AUTHORITY_RESPONSE_MALFORMED'
  | 'AUTHORITY_TIMED_OUT'
  | 'ISSUER_REFUSED'
  | 'ISSUER_RESPONSE_MALFORMED'
  | 'ISSUER_TRANSPORT_FAILED'
  | 'REQUEST_ID_INVALID'
  | 'RESPONSE_SERIALIZATION_FAILED'
  | 'ACTIVATION_STATE_MALFORMED'
  | 'ACTIVATION_MISMATCH'
  | 'ACTIVATION_STALE'
  | 'ACTIVATION_UNBOUND'
  | 'IDENTITY_CONTROL_STATE_MALFORMED'
  | 'IDENTITY_CONTROL_STATE_CONFLICT'
  | 'IDENTITY_CONTROL_UNBOUND'
  | 'IDENTITY_CONTROL_SUBJECT_MISMATCH'
  | 'IDENTITY_CONTROL_DIGEST_MISMATCH'
  | 'IDENTITY_CONTROL_REVOKED'
  | 'IDENTITY_CONTROL_SIGNER_MISMATCH'
  | 'RENDERER_UNBOUND'
  | 'APPROVAL_ARTIFACT_MALFORMED'
  | 'KIRA_RECALL_UNCONFIGURED'
  | 'KIRA_RECALL_POLICY_INVALID'
  | 'KIRA_RECALL_FRAME_NOT_EXACT'
  | 'KIRA_RECALL_KIND_INVALID'
  | 'KIRA_WRITE_UNCONFIGURED'
  | 'KIRA_WRITE_AUTHORITY_UNBOUND'
  | 'KIRA_WRITE_KEY_INVALID'
  | 'KIRA_WRITE_RECORD_MALFORMED'
  | 'KIRA_WRITE_RECORD_IDENTITY_MISMATCH'
  | 'KIRA_WRITE_KEY_MISMATCH'
  | 'KIRA_WRITE_SUBJECT_MISMATCH'
  | 'KIRA_WRITE_PRIVACY_REFUSED'

export declare const BROKER_REFUSE: Readonly<Record<BrokerRefuseKey, string>>
export declare const BROKER_PROPOSAL_STATUS: Readonly<{
  PENDING: 'PENDING'
  SETTLED: 'SETTLED'
  REFUSED: 'REFUSED'
  INDETERMINATE: 'INDETERMINATE'
}>
export declare const BROKER_PROPOSAL_MAX_ENTRIES: number
export declare const BROKER_PROPOSAL_MAX_NAMESPACES: number
export declare const BROKER_PROPOSAL_MAX_CALL_ID_BYTES: number
export declare const BROKER_PROPOSAL_MAX_EFFECT_BYTES: number
export declare const MAX_FRAME_BYTES: number
export declare const BROKER_REVIEW_REQUEST: 'aukora:review-request:v2'
export declare const BROKER_REVIEW_DECISION: 'aukora:review-decision:v1'
export declare const BROKER_REVIEW_CANCEL: 'aukora:review-cancel:v1'
export declare const BROKER_AUTHORITY_REQUEST: 'aukora:authority-request:v1'
export declare const BROKER_AUTHORITY_SELECTION: 'aukora:authority-selection:v1'
export declare const BROKER_AUTHORITY_CANCEL: 'aukora:authority-cancel:v1'
export declare const ACTIVATION_DIGEST_ENV: 'AUKORA_ACTIVATION_DIGEST'
export declare const RENDERER_ID_ENV: 'AUKORA_RENDERER_ID'
export declare const KIRA_RECALL_POLICY_ENV: 'AUKORA_KIRA_RECALL_POLICY'
export declare const WORKSPACE_ROOTS_ENV: 'AUKORA_WORKSPACE_ROOTS_JSON'
export declare const PARENT_AUTHORITY_ENV: 'AUKORA_PARENT_AUTHORITY'
export declare const SUBJECT_AUTHORITY_EXPECTATION_ENV: 'AUKORA_SUBJECT_AUTHORITY_EXPECTATION_B64'

/** Closed parent-review request emitted by the broker child. */
export interface BrokerReviewRequest {
  type: 'aukora:review-request:v2'
  reviewId: string
  proposalId: string
  artifact: Readonly<Record<string, unknown>>
  artifactDigest: string
  operationDigest: string
  authorizationDigest: string
  expiresAt: number
}

/** Closed proposal-specific authority request emitted by the broker child. */
export interface BrokerAuthorityRequest {
  type: 'aukora:authority-request:v1'
  toolName: string
  selectionId: string
  proposalId: string
  operationDigest: string
  artifactDigest: string
  activationDigest: string
  audience: string
  resource: string
  budget: Readonly<{
    calls: 1
    bytes: number
    computeMs: 0
    costMicrounits: 0
  }>
  expiresAt: number
}

/** Closed parent response echoing one exact proposal-specific authority request. */
export interface BrokerAuthoritySelection extends Omit<BrokerAuthorityRequest, 'type'> {
  type: 'aukora:authority-selection:v1'
  authority: SubjectAuthorityContext
}

/** Closed child cancellation for one outstanding authority selection. */
export interface BrokerAuthorityCancel {
  type: 'aukora:authority-cancel:v1'
  selectionId: string
  proposalId: string
}

export declare function scrubEnv(source: Record<string, string | undefined>): Record<string, string>

export declare function provisionBrokerIdentity(stateDir: string): {
  brokerPublicKeyPem: string
  receiptKeyId: string
}

export declare function reconcileIntents(stateDir: string): {
  orphaned: string[]
  malformed: Array<{ entry: string; reason: string }>
}

/** One serving broker. `close` resolves only after the listener is quiescent. */
export interface BrokerServer {
  close(): Promise<void>
}

/**
 * Serve one broker in this process. Setup faults — an occupied socket, an
 * unresolved prepared marker, a state directory bound to another activation —
 * throw synchronously, before the returned promise exists.
 */
export declare function serve(options: {
  socketPath: string
  stateDir: string
  rootPublicKeyPem: string
  issuerSocket?: string
  review?: (
    request: Readonly<BrokerReviewRequest>,
    signal: AbortSignal,
  ) => Promise<'approved' | 'denied'> | 'approved' | 'denied'
  /** Activation digest this broker must serve, bound create-if-absent in its state. */
  activationDigest?: string
  /** SHA-256 identity of the parent renderer that will display the approval artifact. */
  rendererId?: string
  /** Parent-owned subject and privacy classes for KIRA recall. */
  kiraRecallPolicy?: { subject: string; privacy: readonly string[] }
  workspaceRoots?: Readonly<Record<string, string>>
  /** Launch-pinned session-to-Agent delegation selecting v5 proposal grants. */
  subjectAuthority?: SubjectAuthorityContextInput
  /** Parent callback that selects one exact delegation for each accepted proposal. */
  selectSubjectAuthority?: (
    request: Readonly<BrokerAuthorityRequest>,
    signal: AbortSignal,
  ) => Promise<SubjectAuthorityContextInput> | SubjectAuthorityContextInput
  /** Public identity and route fields required from every dynamic selection. */
  subjectAuthorityExpectation?: SubjectAuthorityExpectationInput
  /** Active hybrid AUMLOK control head persisted in broker-owned state. */
  rootControlState?: RootControlStateV1
  /** Publish the route as an owner-held 0710 directory and 0660 group socket. */
  socketGroupAccess?: boolean
}): Promise<BrokerServer>

/** Validate and detach the launch-owned subject/privacy selection; absence disables recall. */
export declare function readKiraPolicy(policy: unknown): Readonly<{ subject: string; privacy: readonly string[] }> | null

export declare function spawnBroker(options: {
  /** Fixed operator workspace aliases; absent disables workspace.patch. */
  workspaceRoots?: Readonly<Record<string, string>>
  socketPath: string
  stateDir: string
  rootPublicKeyPem: string
  issuerSocket?: string
  /**
   * Human decisions resolve approved or denied. Throws naming
   * REVIEW_CHANNEL_UNAVAILABLE, REVIEW_TIMED_OUT, or STOPPING preserve those
   * refusals across child IPC; other failures produce REVIEW_RESPONSE_MALFORMED.
   */
  review?: (
    request: Readonly<BrokerReviewRequest>,
    signal: AbortSignal,
  ) => Promise<'approved' | 'denied'> | 'approved' | 'denied'
  subjectAuthority?: SubjectAuthorityContextInput
  /** Parent callback that selects one exact delegation for each accepted proposal. */
  selectSubjectAuthority?: (
    request: Readonly<BrokerAuthorityRequest>,
    signal: AbortSignal,
  ) => Promise<SubjectAuthorityContextInput> | SubjectAuthorityContextInput
  /** Public identity and route fields required from every dynamic selection. */
  subjectAuthorityExpectation?: SubjectAuthorityExpectationInput
  /** Active hybrid AUMLOK control head persisted create-if-absent before child spawn. */
  rootControlState?: RootControlStateV1
  env?: Record<string, string | undefined>
  peerTokenPath?: string
  peerTokenSha256?: string
  /** Activation digest this broker must serve. Only the digest crosses the frame. */
  activationDigest?: string
  /** SHA-256 identity of the parent renderer that will display the approval artifact. */
  rendererId?: string
  /** Parent-owned subject and privacy classes for KIRA recall. */
  kiraRecallPolicy?: { subject: string; privacy: readonly string[] }
  /** Publish the route as an owner-held 0710 directory and 0660 group socket. */
  socketGroupAccess?: boolean
  timeoutMs?: number
}): Promise<ChildProcess>
/** Exclusively own retained state until all writes are quiescent; crash residue requires operator recovery. */
export declare function acquireStateLease(stateDir: string): () => void

/** Verify local Aura order, authority-evidence inventory and sequence witness. */
export declare function readSettlementHead(stateDir: string): number
