import type { ApprovalArtifactRefusal } from './artifact.mjs'

/** The public view of the one occurrence currently open for approval. */
export interface ApprovalOccurrence {
  readonly occurrenceId: string
  readonly artifactDigest: string
  readonly challenge: string
  readonly openedAt: number
}

/** A channel call that succeeded in opening one occurrence. */
export interface ApprovalOpened {
  readonly ok: true
  readonly occurrence: ApprovalOccurrence
}

/** A channel call that produced one settled outcome. */
export interface ApprovalSettled {
  readonly ok: true
  readonly outcome: typeof APPROVAL_OUTCOME[keyof typeof APPROVAL_OUTCOME]
}

/** One exact refusal returned by the occurrence channel. */
export type ApprovalOccurrenceRefusal =
  | ApprovalArtifactRefusal
  | typeof REFUSE_OCCURRENCE[keyof typeof REFUSE_OCCURRENCE]

/** A channel call refused by name. */
export interface ApprovalRefused {
  readonly ok: false
  readonly reason: ApprovalOccurrenceRefusal
}

/** The one-at-a-time approval channel. */
export interface ApprovalChannel {
  open(input: { artifact: unknown; challenge: string }): ApprovalOpened | ApprovalRefused
  submit(input: { occurrenceId: unknown; artifactDigest: unknown; answer: unknown }): ApprovalSettled | ApprovalRefused
  cancel(outcome?: string): boolean
  active(): ApprovalOccurrence | null
}

/** How long one occurrence stays answerable. A security invariant, not a tunable. */
export declare const APPROVAL_OCCURRENCE_DEADLINE_MS: number

/** What actually happened at one occurrence. */
export declare const APPROVAL_OUTCOME: Readonly<{
  APPROVED: 'approved'
  DENIED: 'denied'
  TIMED_OUT: 'timed-out'
  CANCELLED: 'cancelled'
}>

/** Named refusals raised when an answer cannot be applied to any occurrence. */
export declare const REFUSE_OCCURRENCE: Readonly<{
  BUSY: 'approval:occurrence-busy'
  NONE_ACTIVE: 'approval:no-active-occurrence'
  MISMATCH: 'approval:occurrence-mismatch'
  ARTIFACT_MUTATED: 'approval:artifact-mutated'
  CHALLENGE_MALFORMED: 'approval:challenge-malformed'
}>

/** Whether one outcome may reach a signature; exhaustive over the outcome union. */
export declare function isSigningOutcome(outcome: string): boolean

/** Create one approval channel over an injectable clock. */
export declare function createApprovalChannel(options?: { now?: () => number }): ApprovalChannel
