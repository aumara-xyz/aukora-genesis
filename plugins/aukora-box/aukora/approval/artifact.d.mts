import type { WorkspacePatchArgs } from '../broker/workspace-patch-args.mjs'
/** Maximum review-projection lines one approval artifact accepts. */
export declare const MAX_PROJECTION_LINES: 64

/** Maximum bytes of one review-projection line. */
export declare const MAX_PROJECTION_LINE_BYTES: 4096

/** Maximum bytes of one operation's canonical encoding. */
export declare const MAX_OPERATION_BYTES: 65536


/** Recursively immutable JSON accepted as a governed memory value. */
export type ApprovalJSONValue =
  | null
  | boolean
  | number
  | string
  | readonly ApprovalJSONValue[]
  | { readonly [key: string]: ApprovalJSONValue }

/** The exact `memory.put` arguments one approval artifact binds. */
export interface ApprovalOperationArguments {
  readonly key: string
  readonly value: ApprovalJSONValue
}

/** The closed set of arguments accepted by an approval artifact. */
export type ApprovalArguments = ApprovalOperationArguments | WorkspacePatchArgs

/** One validated, immutable approval artifact. */
export interface ApprovalArtifact<Arguments extends ApprovalArguments = ApprovalOperationArguments> {
  readonly version: 1
  readonly operationArguments: Readonly<Arguments>
  readonly operationCanonicalBytes: string
  readonly operationDigest: string
  readonly semanticProjection: readonly string[]
  readonly definitionId: string
  readonly activationDigest: string
  readonly occurrenceId: string
  readonly expiry: number
  readonly rendererId: string
  readonly oneUse: true
}

/** Inputs the trusted parent supplies to build one artifact. */
interface ApprovalArtifactContext {
  readonly expiry: number
  readonly activationDigest: string
  readonly occurrenceId: string
  readonly rendererId: string
}

/** Memory inputs retain the implicit `memory.put` effect name. */
export type MemoryApprovalArtifactInput = ApprovalArtifactContext & {
  readonly toolName?: 'memory.put'
  readonly operationArguments: { key: string; value: unknown }
}

/** Workspace inputs explicitly select the workspace effect. */
export type WorkspaceApprovalArtifactInput = ApprovalArtifactContext & {
  readonly toolName: 'workspace.patch'
  readonly operationArguments: WorkspacePatchArgs
}

/** Inputs the trusted parent supplies to build one registered artifact. */
export type ApprovalArtifactInput = MemoryApprovalArtifactInput | WorkspaceApprovalArtifactInput

/** Domain separating approval-artifact digests from every other AUKORA digest. */
export declare const APPROVAL_ARTIFACT_DOMAIN: string

/** Domain separating the issuer's approval signature from grant v3/v4 messages. */
export declare const APPROVAL_SIGNED_DOMAIN: string

/** The only artifact version this module reads or produces. */
export declare const APPROVAL_ARTIFACT_VERSION: 1

/** The exact field inventory of one approval artifact. */
export declare const APPROVAL_ARTIFACT_FIELDS: readonly string[]

/** Named approval refusals, one per cause. */
export declare const REFUSE_APPROVAL: Readonly<{
  MALFORMED: 'approval:artifact-malformed'
  VERSION_UNSUPPORTED: 'approval:version-unsupported'
  ARGUMENTS_NOT_EXACT: 'approval:arguments-not-exact'
  VALUE_NOT_JSON: 'approval:value-not-json'
  KEY_NOT_A_NAME: 'approval:key-not-a-name'
  ONE_USE_REQUIRED: 'approval:one-use-required'
  OCCURRENCE_MALFORMED: 'approval:occurrence-malformed'
  DISPLAY_TEXT_INVALID: 'approval:display-text-invalid'
  PROJECTION_MALFORMED: 'approval:projection-malformed'
  PROJECTION_OVERSIZE: 'approval:projection-oversize'
  PROJECTION_MISMATCH: 'approval:projection-mismatch'
  OPERATION_OVERSIZE: 'approval:operation-oversize'
  OPERATION_NOT_CANONICAL: 'approval:operation-not-canonical'
  OPERATION_BYTES_MISMATCH: 'approval:operation-bytes-mismatch'
  OPERATION_DIGEST_MISMATCH: 'approval:operation-digest-mismatch'
  DEFINITION_MISMATCH: 'approval:definition-mismatch'
  EXPIRY_MISMATCH: 'approval:expiry-mismatch'
  EXPIRY_MALFORMED: 'approval:expiry-malformed'
  DIGEST_MALFORMED: 'approval:digest-malformed'
  ARTIFACT_EXPIRED: 'approval:artifact-expired'
  TTL_UNBOUNDED: 'approval:ttl-unbounded'
  UNRENDERABLE: 'approval:unrenderable-operation'
  DIGEST_MISMATCH: 'approval:artifact-digest-mismatch'
}>

/** One exact registered approval-artifact refusal. */
export type ApprovalArtifactRefusal = typeof REFUSE_APPROVAL[keyof typeof REFUSE_APPROVAL]

/** Project any parser exception onto the closed approval refusal vocabulary. */
export declare function approvalRefusalReason(error: unknown): ApprovalArtifactRefusal

/** Validate one candidate artifact, recomputing every derived field. */
export declare function parseApprovalArtifact(input: unknown): ApprovalArtifact<ApprovalArguments>

/** Build one artifact from the exact inputs the trusted parent holds. */
export declare function createApprovalArtifact(input: MemoryApprovalArtifactInput): ApprovalArtifact
export declare function createApprovalArtifact(input: WorkspaceApprovalArtifactInput): ApprovalArtifact<WorkspacePatchArgs>
export declare function createApprovalArtifact(input: ApprovalArtifactInput): ApprovalArtifact<ApprovalArguments>

/** The digest every party derives independently from one artifact. */
export declare function approvalArtifactDigest(artifact: ApprovalArtifact<ApprovalArguments>): string

/** The exact bytes an issuer signs to attest one approved artifact. */
export declare function approvalSignedMessage(artifactDigest: string): Buffer

/** Re-derive an artifact from untrusted input and confirm its expected digest. */
export declare function verifyApprovalArtifact(input: unknown, expectedDigest: string): ApprovalArtifact<ApprovalArguments>
