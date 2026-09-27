import type { KiraMemoryRecordV0, KiraRecordKind } from './stage.mjs'

/** Model-facing recall route name for broker-owned governed reads. */
export declare const KIRA_RECALL_TOOL: 'kira.recall'

/** Maximum records returned by one broker recall. */
export declare const KIRA_RECALL_MAX_RECORDS: number

/** Maximum combined object-body bytes returned by one broker recall. */
export declare const KIRA_RECALL_MAX_RESULT_BYTES: number

/** Maximum UTF-8 bytes accepted for one parent-owned recall subject. */
export declare const KIRA_RECALL_MAX_SUBJECT_BYTES: number

/** Closed recall states; the recall reply vocabulary is a public contract. */
export declare const KIRA_RECALL_STATES: readonly ['found', 'empty', 'undetermined']

/** Closed reasons an undetermined recall names. */
export declare const KIRA_RECALL_UNDETERMINED_REASONS: readonly [
  'memory-unavailable',
  'memory-corrupt',
  'memory-unverified',
]

/** One recall query: an exact subject and an optional record-kind filter. */
export type KiraRecallQuery = Readonly<{
  subject: string
  kind?: KiraRecordKind
}>

/** Exactly one of the three public recall states. */
export type KiraRecallResult =
  | Readonly<{ status: 'found'; records: ReadonlyArray<KiraMemoryRecordV0> }>
  | Readonly<{ status: 'empty' }>
  | Readonly<{ status: 'undetermined'; reason: 'memory-unavailable' | 'memory-corrupt' | 'memory-unverified' }>

/** One Aura citation supporting one returned KIRA record. */
export interface KiraRecallCitation {
  recordId: string
  contentSha256: string
  auraSequence: number
  auraEntryHash: string
  verifiedHead: string
}

/** Effective parent-owned query returned by the broker. */
export interface EffectiveKiraRecallQuery {
  subject: string
  kind?: KiraRecordKind
}

/** Complete validated broker recall envelope, excluding the wire `ok` field. */
export type BrokerKiraRecallResult = Readonly<{
  query: EffectiveKiraRecallQuery
  privacy: ReadonlyArray<import('./stage.mjs').KiraPrivacyClass>
  bounds: Readonly<{ maxRecords: number; maxBytes: number }>
  citations: ReadonlyArray<KiraRecallCitation>
  result: KiraRecallResult
}>

/** A named recall-query refusal; every refusal carries one stable code. */
export declare class KiraRecallError extends Error {
  /** Stable machine-readable refusal code, e.g. `kira.recall:query-not-plain`. */
  readonly code: string
  constructor(code: string, message: string)
}

/**
 * Recall verified KIRA memory records for one subject from one caller-read
 * snapshot of governed-memory `{key, value}` entries. Missing backing is
 * `undetermined: memory-unavailable`; an unreadable snapshot or malformed
 * KIRA-keyed record is `undetermined: memory-corrupt`; a well-formed record
 * whose identity does not recompute is `undetermined: memory-unverified`.
 * Throws {@link KiraRecallError} only for a malformed query.
 */
export declare function recallKiraMemoryRecords(query: unknown, backing: unknown): KiraRecallResult

/** Compute the exact content-addressed object digest for one verified KIRA record. */
export declare function kiraRecordContentSha256(record: KiraMemoryRecordV0): string
