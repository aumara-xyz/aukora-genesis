// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/** Lossy, read-only ternary coordinates of the persistent session-log channels. */
import type { AuraPersistentChannelSources } from './aggregate.ts'
import { persistentChannelsOf, type Triad } from './figure.ts'

/** Balanced ternary digit; its order denotes a numeric interval, not trust. */
export type AuraTrit = -1 | 0 | 1

/** Ascending balanced digits used to enumerate the three cube axes. */
export const AURA_TRITS = [-1, 0, 1] as const

/**
 * Encode three balanced digits as one base-27 digit's zero-based index.
 * @param trits - history, tool, and approval digits.
 * @returns the unique cell index in 0 through 26.
 */
export function auraCellIndex(trits: readonly [AuraTrit, AuraTrit, AuraTrit]): number {
  return (trits[0] + 1) * 9 + (trits[1] + 1) * 3 + trits[2] + 1
}

/**
 * Partition a normalized coefficient into equal-width thirds, with ties central.
 * @param value - finite coefficient in [-1, 1].
 * @returns lower, middle, or upper interval as a balanced digit.
 */
export function auraTritOf(value: number): AuraTrit {
  return value < -1 / 3 ? -1 : value > 1 / 3 ? 1 : 0
}

/** A partial coordinate has no selected cell until every axis has observations. */
export interface AuraTernaryReadout {
  /** Original, unsmoothed persistent coefficients; no animation clock involved. */
  values: Triad
  /** Missing interactions, tool calls, or approval coverage remain unknown. */
  trits: [AuraTrit | null, AuraTrit | null, AuraTrit | null]
  /** Lossy display index, never an identity, signature, or permission. */
  index: number | null
}

/**
 * Quantize the same persistent inputs used by the tesseract.
 * Tool health is rescaled from [0, 1] to [-1, 1] before equal-third binning.
 * @param sources - committed session-log totals, not verified effect receipts.
 * @returns source coefficients and an observed or partial 27-cell coordinate.
 */
export function auraTernaryOf(sources: AuraPersistentChannelSources): AuraTernaryReadout {
  const values = persistentChannelsOf(sources)
  const coverage = Math.max(sources.approvalsAsked, sources.approvalsAllowed
    + sources.approvalsRejected + sources.approvalsUnavailable + sources.approvalsCancelled)
  const history = sources.historyInteractions > 0 ? auraTritOf(values[0]) : null
  // Compare in the original domain so rounding in 2x-1 cannot move a boundary tie.
  const tool = sources.toolCalls > 0 ? values[1] < 1 / 3 ? -1 : values[1] > 2 / 3 ? 1 : 0 : null
  const approval = coverage > 0 ? auraTritOf(values[2]) : null
  return {
    values,
    trits: [history, tool, approval],
    index: history === null || tool === null || approval === null
      ? null
      : auraCellIndex([history, tool, approval]),
  }
}
