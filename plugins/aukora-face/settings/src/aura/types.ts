// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/**
 * Wire and fold types for the Aura Coherence session-log adapter.
 *
 * The adapter is intentionally weaker than the eventual Aukora receipt
 * source: it projects content-free metadata from the durable session log and
 * says explicitly that identity, cryptographic receipts, and an external
 * anchor are unavailable. The Aura renderer consumes this stable face without
 * needing to know which evidence provider produced it.
 *
 * @module @aukora/face-settings/aura/types
 */

/** High-level class of one content-free record descriptor. */
export type AuraRecordKind =
  | 'message'
  | 'action'
  | 'approval'
  | 'policy'
  | 'lifecycle'
  | 'system'

/** One bounded, content-free descriptor retained for the Aura record portal. */
export interface AuraRecordDescriptor {
  /** Durable session-log sequence number. */
  seq: number
  /** Durable event timestamp in Unix epoch milliseconds. */
  time: number
  /** Exact session event type. */
  type: string
  /** Presentation class derived from the event type. */
  kind: AuraRecordKind
  /** Content-free presentation label; may include a tool name or decision outcome. */
  label: string
}

/** Folded message and action totals used by the Aura portals. */
export interface AuraInteractionCounts {
  /** Durable records observed, excluding raw token chunks. */
  records: number
  /** User, assistant, tool-call, approval, and policy interactions. */
  interactions: number
  /** Entered turns. */
  turns: number
  /** Direct human messages. */
  humanMessages: number
  /** Non-human user-role context injections. */
  contextMessages: number
  /** Assembled assistant messages. */
  assistantMessages: number
  /** Tool invocations requested by a model. */
  toolCalls: number
  /** Tool results appended to the session. */
  toolResults: number
  /** Tool results carrying an internal failure. */
  toolErrors: number
}

/** Folded approval audit totals. */
export interface AuraApprovalCounts {
  /** Approval requests appended to the audit log. */
  asked: number
  /** One-shot grants. */
  allowed: number
  /** Explicit rejections. */
  rejected: number
  /** Requests withdrawn through cancellation. */
  cancelled: number
  /** Requests that failed closed without an answerer. */
  unavailable: number
}

/** Latest durable confinement choices, when this session overrides them. */
export interface AuraConfinementState {
  /** Selected user-facing permission preset. */
  preset: string | null
  /** Effective session sandbox-mode override. */
  sandbox: string | null
  /** Effective session approval-policy override. */
  approval: string | null
}

/**
 * Client-visible life-state projected from one durable session log.
 *
 * `recordFingerprint` is an FNV-1a checksum of event metadata. It is useful
 * for deterministic drawing and corruption detection inside this view, but it
 * is not a receipt, signature, identity binding, or external proof.
 */
export interface AuraCoherenceProjection {
  /** Projection payload version. */
  version: 1
  /** Current adapter supplying the posture. */
  source: 'durable-session-log'
  /** Folded message and action totals. */
  counts: AuraInteractionCounts
  /** Folded approval audit totals. */
  approvals: AuraApprovalCounts
  /** Latest confinement choices. */
  confinement: AuraConfinementState
  /** Last observed non-chunk record sequence, or `-1` for an empty log. */
  lastSeq: number
  /** Last observed non-chunk record time, or `null` for an empty log. */
  lastTime: number | null
  /** Non-cryptographic, content-free checksum of observed event metadata. */
  recordFingerprint: string
  /** Newest content-free record descriptors, in log order. */
  recent: AuraRecordDescriptor[]
  /** This adapter has no immutable identity/genesis binding. */
  identityBound: false
  /** This adapter does not expose cryptographically signed receipts. */
  cryptographicReceipts: false
  /** This adapter does not expose an independently anchored head. */
  externallyAnchored: false
}

/** Internal persisted fold state; currently identical to the wire face. */
export type AuraCoherenceState = AuraCoherenceProjection

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Aura's deterministic whole-log session adapter. */
    auraCoherence: AuraCoherenceState
  }

  interface SessionProjectionMap {
    /** Aura's deterministic whole-log session adapter. */
    auraCoherence: AuraCoherenceProjection
  }
}
