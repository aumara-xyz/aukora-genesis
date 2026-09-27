import type { Branded } from '@deepseek-ai/dsh-brand'

/** Deterministic KIRA record identifier: `kira:` plus 64 lowercase hex. */
export type KiraRecordId = Branded<'KiraRecordId'>

/** Closed lossless-JSON values accepted as KIRA record content. */
export type KiraJsonValue = null | boolean | number | string | readonly KiraJsonValue[] | {
  readonly [key: string]: KiraJsonValue
}

/** Closed record kinds from the KIRA memory specification. */
export type KiraRecordKind =
  | 'observation'
  | 'summary'
  | 'claim'
  | 'preference'
  | 'plan'
  | 'training-slice'
  | 'erasure'

/** Closed privacy classes from the KIRA memory specification. */
export type KiraPrivacyClass = 'local' | 'exportable' | 'private'

/** Reference to one prior KIRA record this record derives from. */
export type KiraSourceRefV0 = Readonly<{
  recordId: KiraRecordId
}>

/** Semantic link from this record to one other KIRA record. */
export type KiraLinkV0 = Readonly<{
  recordId: KiraRecordId
  relation: string
}>

/**
 * Identity of the transform that produced a derived view: name, version,
 * model or algorithm identifier when one was used, prompt or parameter digest
 * when applicable, and the output digest.
 */
export type KiraTransformRefV0 = Readonly<{
  name: string
  version: string
  model?: string
  parametersDigest?: string
  outputDigest: string
}>

/** One canonical KIRA memory record (KIRA memory specification section 3). */
export type KiraMemoryRecordV0 = Readonly<{
  domain: 'aukora:kira-memory-record:v0'
  grantsAuthority: false
  recordId: KiraRecordId
  subject: string
  kind: KiraRecordKind
  source: ReadonlyArray<KiraSourceRefV0>
  content: KiraJsonValue
  links: ReadonlyArray<KiraLinkV0>
  privacy: KiraPrivacyClass
  createdAt: string
  transform?: KiraTransformRefV0
}>

/** The staging candidate: every record field KIRA does not derive itself. */
export type KiraMemoryCandidateV0 = Readonly<{
  subject: string
  kind: KiraRecordKind
  source: ReadonlyArray<KiraSourceRefV0>
  content: KiraJsonValue
  links: ReadonlyArray<KiraLinkV0>
  privacy: KiraPrivacyClass
  createdAt: string
  transform?: KiraTransformRefV0
}>

/** Fixed record domain; changing it changes every KIRA record identifier. */
export declare const KIRA_RECORD_DOMAIN: 'aukora:kira-memory-record:v0'

/** Model-facing staging route name for the governed memory proposal path. */
export declare const KIRA_STAGE_TOOL: 'kira.stage'

/** KIRA records are proposals and never authority artifacts. */
export declare const KIRA_STAGE_GRANTS_AUTHORITY: false

/** Closed record kinds from the KIRA memory specification. */
export declare const KIRA_RECORD_KINDS: readonly KiraRecordKind[]

/** Closed privacy classes from the KIRA memory specification. */
export declare const KIRA_PRIVACY_CLASSES: readonly KiraPrivacyClass[]

/** Grammar of a deterministic KIRA record identifier. */
export declare const KIRA_RECORD_ID: RegExp

/** A named staging refusal; every refusal carries one stable code. */
export declare class KiraStageError extends Error {
  /** Stable machine-readable refusal code, e.g. `kira.stage:content-cycle`. */
  readonly code: string
  constructor(code: string, message: string)
}

/**
 * Convert one exact KIRA memory candidate into inert governed-memory
 * arguments. The identifier hashes every record field except `recordId`, so
 * it is stable under object-key reordering and changes with any meaningful
 * field change; `createdAt` is caller-supplied canonical seconds-precision
 * UTC data (`YYYY-MM-DDTHH:MM:SSZ`, one encoding per instant) and no local
 * clock participates. Content carries depth and node ceilings and the
 * reference arrays an entry ceiling; byte ceilings belong to the broker
 * review limit. Throws {@link KiraStageError} when the candidate is not one
 * closed lossless-JSON record inside those ceilings.
 */
export declare function stageKiraMemoryRecord(input: unknown): Readonly<{
  recordId: KiraRecordId
  record: KiraMemoryRecordV0
  memoryPut: Readonly<{ key: KiraRecordId; value: KiraMemoryRecordV0 }>
}>

/**
 * Re-check one stored value against the deterministic record contract.
 * Digest is identity: a record is verified only when its own `recordId`
 * recomputes from its other fields. Never throws for bad data and never
 * proves authorization or Aura inclusion.
 */
export declare function verifyKiraMemoryRecord(value: unknown):
  | Readonly<{ verified: true; record: KiraMemoryRecordV0 }>
  | Readonly<{ verified: false; reason: 'malformed' | 'identity-mismatch' }>
