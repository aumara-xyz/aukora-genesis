// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/** Pure system aggregation over per-session Aura projections. */

import type {
  AuraApprovalCounts,
  AuraCoherenceProjection,
  AuraInteractionCounts,
  AuraRecordDescriptor,
} from './types.ts'

const RECENT_LIMIT = 18
const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

/** Durable count sources consumed by Aura's three persistent coefficients. */
export interface AuraPersistentChannelSources {
  /** High-level committed interactions retained by the content-free projection. */
  historyInteractions: number
  /** Tool calls requested by the model. */
  toolCalls: number
  /** Tool results committed to the log. */
  toolResults: number
  /** Committed tool results carrying an internal failure. */
  toolErrors: number
  /** Approval requests committed to the audit log. */
  approvalsAsked: number
  /** One-shot approval grants. */
  approvalsAllowed: number
  /** Explicit approval rejections. */
  approvalsRejected: number
  /** Approval requests that failed closed without an answerer. */
  approvalsUnavailable: number
  /** Approval requests withdrawn through cancellation. */
  approvalsCancelled: number
}

/** Monotonic durable totals used only to detect new transient activity. */
export interface AuraActivityChannelSources {
  /** Direct human messages committed to the log. */
  humanMessages: number
  /** Assembled assistant messages committed to the log. */
  assistantMessages: number
  /** Committed tool calls and results. */
  toolEvents: number
}

/** Named logged sources for all six local-adapter Aura coefficients. */
export interface AuraChannelSources {
  /** Sources for coefficients that remain after activity decays. */
  persistent: AuraPersistentChannelSources
  /** Monotonic totals whose positive deltas drive transient coefficients. */
  activity: AuraActivityChannelSources
}

/** One session face available to the system Aura aggregator. */
export interface AuraSessionProjectionEntry {
  /** Stable opaque session id, used only to make aggregation deterministic. */
  id: string
  /** Current display title for the record portal. */
  title: string
  /** Host-folded durable projection, absent until that session has a baseline. */
  projection?: AuraCoherenceProjection
}

/** One recent content-free record with its source session disclosed. */
export interface AuraSystemRecord extends AuraRecordDescriptor {
  /** Opaque source session id. */
  sessionId: string
  /** Source session display title. */
  sessionTitle: string
}

/** Commutative system summary consumed by the Aura surface. */
export interface AuraSystemProjection {
  /** Sessions visible through the Host session list. */
  sessions: number
  /** Visible sessions with an Aura projection baseline. */
  projectedSessions: number
  /** Sums of content-free durable session counts. */
  counts: AuraInteractionCounts
  /** Sums of durable approval-audit outcomes. */
  approvals: AuraApprovalCounts
  /** Named logged totals supplying Aura's six local-adapter coefficients. */
  channelSources: AuraChannelSources
  /** Stable non-cryptographic checksum of the contributing projection heads. */
  recordFingerprint: string
  /** Newest observed durable record time. */
  lastTime: number | null
  /** Bounded newest content-free records across projected sessions. */
  recent: AuraSystemRecord[]
}

function emptyCounts(): AuraInteractionCounts {
  return {
    records: 0,
    interactions: 0,
    turns: 0,
    humanMessages: 0,
    contextMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolResults: 0,
    toolErrors: 0,
  }
}

function emptyApprovals(): AuraApprovalCounts {
  return { asked: 0, allowed: 0, rejected: 0, cancelled: 0, unavailable: 0 }
}

/**
 * Name the durable session-log totals available to Aura's coefficient map.
 *
 * Identity, cryptographic receipts, and external anchoring are deliberately
 * absent: this adapter reports those capabilities as unmounted and never
 * converts its checksum or timestamps into evidence coefficients.
 *
 * @param projection - one session or system summary with folded counts and approvals.
 * @returns the exact monotonic totals used by the persistent and transient maps.
 */
export function auraChannelSourcesOf(
  projection: Pick<AuraCoherenceProjection, 'counts' | 'approvals'>,
): AuraChannelSources {
  return {
    persistent: {
      historyInteractions: projection.counts.interactions,
      toolCalls: projection.counts.toolCalls,
      toolResults: projection.counts.toolResults,
      toolErrors: projection.counts.toolErrors,
      approvalsAsked: projection.approvals.asked,
      approvalsAllowed: projection.approvals.allowed,
      approvalsRejected: projection.approvals.rejected,
      approvalsUnavailable: projection.approvals.unavailable,
      approvalsCancelled: projection.approvals.cancelled,
    },
    activity: {
      humanMessages: projection.counts.humanMessages,
      assistantMessages: projection.counts.assistantMessages,
      toolEvents: projection.counts.toolCalls + projection.counts.toolResults,
    },
  }
}

function extendFingerprint(hash: number, value: string): number {
  let next = hash >>> 0
  for (let index = 0; index < value.length; index += 1) {
    next ^= value.charCodeAt(index)
    next = Math.imul(next, FNV_PRIME) >>> 0
  }
  return next
}

/**
 * Combine per-session durable projections without inventing cross-session order.
 *
 * Totals are commutative. Recent records use their durable timestamps for display,
 * with session id and sequence as deterministic tie-breakers; that ordering is not
 * presented as a global receipt chain.
 *
 * @param entries - Host-listed sessions and any available Aura projections.
 * @returns one content-free system life-state summary.
 */
export function aggregateAuraCoherence(
  entries: readonly AuraSessionProjectionEntry[],
): AuraSystemProjection {
  const counts = emptyCounts()
  const approvals = emptyApprovals()
  const projected = entries
    .filter((entry): entry is AuraSessionProjectionEntry & { projection: AuraCoherenceProjection } =>
      entry.projection !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id))
  const recent: AuraSystemRecord[] = []
  let fingerprint = FNV_OFFSET
  let lastTime: number | null = null

  for (const entry of projected) {
    const projection = entry.projection
    for (const key of Object.keys(counts) as Array<keyof AuraInteractionCounts>) {
      counts[key] += projection.counts[key]
    }
    for (const key of Object.keys(approvals) as Array<keyof AuraApprovalCounts>) {
      approvals[key] += projection.approvals[key]
    }
    fingerprint = extendFingerprint(
      fingerprint,
      `${entry.id}|${projection.recordFingerprint}|${projection.lastSeq};`,
    )
    if (projection.lastTime !== null) {
      lastTime = lastTime === null ? projection.lastTime : Math.max(lastTime, projection.lastTime)
    }
    recent.push(...projection.recent.map(record => ({
      ...record,
      sessionId: entry.id,
      sessionTitle: entry.title,
    })))
  }

  recent.sort((left, right) =>
    right.time - left.time
    || left.sessionId.localeCompare(right.sessionId)
    || right.seq - left.seq)

  return {
    sessions: entries.length,
    projectedSessions: projected.length,
    counts,
    approvals,
    channelSources: auraChannelSourcesOf({ counts, approvals }),
    recordFingerprint: fingerprint.toString(16).padStart(8, '0'),
    lastTime,
    recent: recent.slice(0, RECENT_LIMIT),
  }
}
