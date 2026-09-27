// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/**
 * Pure Aura coefficient mappings for the local session-log adapter: the named
 * durable-count channels the surface renders and the provenance table that
 * attributes each of them.
 */

import type {
  AuraActivityChannelSources,
  AuraChannelSources,
  AuraPersistentChannelSources,
} from './aggregate.ts'
import type { Coeffs6 } from './walsh.ts'

/** One full rotation in radians. */
export const TAU = Math.PI * 2

/** Immutable exact rest position of the breath triad. */
export const REST: readonly [number, number, number] = Object.freeze([0, 0, 0])

/** Golden-ratio conjugate used as the non-repeating interaction phase step. */
export const HISTORY_PHASE_STEP = (Math.sqrt(5) - 1) / 2

/**
 * Ordered, attributable source of every coefficient emitted by the local
 * adapter. `signed` marks channels spanning `[-1, 1]`, whose readout needs a
 * bipolar center-origin meter; unsigned channels stay in `[0, 1)`.
 */
export const AURA_COEFFICIENT_PROVENANCE = Object.freeze([
  Object.freeze({
    plane: 'xy',
    channel: 'historyPhase',
    lifetime: 'persistent',
    signed: true,
    source: 'counts.interactions',
  }),
  Object.freeze({
    plane: 'xz',
    channel: 'toolHealth',
    lifetime: 'persistent',
    signed: false,
    source: 'counts.toolCalls, counts.toolResults, counts.toolErrors',
  }),
  Object.freeze({
    plane: 'yz',
    channel: 'approvalPosture',
    lifetime: 'persistent',
    signed: true,
    source: 'approvals.asked, approvals.allowed, approvals.rejected, approvals.unavailable, approvals.cancelled',
  }),
  Object.freeze({
    plane: 'xw',
    channel: 'humanActivity',
    lifetime: 'transient',
    signed: false,
    source: 'positive delta of counts.humanMessages',
  }),
  Object.freeze({
    plane: 'yw',
    channel: 'assistantActivity',
    lifetime: 'transient',
    signed: false,
    source: 'positive delta of counts.assistantMessages',
  }),
  Object.freeze({
    plane: 'zw',
    channel: 'toolActivity',
    lifetime: 'transient',
    signed: false,
    source: 'positive delta of counts.toolCalls + counts.toolResults',
  }),
] as const)

/** Three ordered plane values. */
export type Triad = [number, number, number]

function countOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function boundedCount(value: unknown): number {
  const count = countOrZero(value)
  return count / (1 + count)
}

function positiveDelta(previous: unknown, current: unknown): number {
  return Math.max(0, countOrZero(current) - countOrZero(previous))
}

function fractionalPart(value: number): number {
  return value - Math.floor(value)
}

/**
 * Map a committed interaction count to a bounded, visibly advancing phase.
 *
 * The Kronecker sequence `2 × frac(n × φ⁻¹) - 1` never saturates, so each
 * representable positive count moves the persistent `xy` coefficient. Zero
 * remains the neutral initial state.
 *
 * @param value - committed high-level interaction count.
 * @returns deterministic phase in `[-1, 1)` or zero for an invalid/empty count.
 */
export function historyPhaseOf(value: unknown): number {
  const count = countOrZero(value)
  return count === 0 ? 0 : 2 * fractionalPart(count * HISTORY_PHASE_STEP) - 1
}

/**
 * Normalize the local adapter's three durable channels into persistent coefficients.
 *
 * History phase uses the non-saturating Kronecker sequence
 * `2 × frac(interactions × φ⁻¹) - 1`. Tool health is the fraction of requested
 * calls with a committed non-error result. Approval posture is the signed
 * allowed-minus-refused share of the larger of asks or recorded outcomes;
 * cancellations and unanswered asks remain neutral mass in the denominator.
 * Every coefficient is finite and bounded to `[-1, 1]`.
 *
 * @param sources - named durable count sources from the session-log adapter.
 * @returns `xy` history phase, `xz` tool health, and `yz` approval posture.
 */
export function persistentChannelsOf(sources: AuraPersistentChannelSources): Triad {
  const toolCalls = countOrZero(sources.toolCalls)
  const toolResults = countOrZero(sources.toolResults)
  const toolErrors = Math.min(toolResults, countOrZero(sources.toolErrors))
  const successfulToolResults = Math.max(0, toolResults - toolErrors)
  const toolHealth = toolCalls === 0
    ? 0
    : clamp(successfulToolResults / toolCalls, 0, 1)

  const approvalsAsked = countOrZero(sources.approvalsAsked)
  const approvalsAllowed = countOrZero(sources.approvalsAllowed)
  const approvalsRefused = countOrZero(sources.approvalsRejected)
    + countOrZero(sources.approvalsUnavailable)
  const approvalOutcomes = approvalsAllowed
    + approvalsRefused
    + countOrZero(sources.approvalsCancelled)
  const approvalCoverage = Math.max(approvalsAsked, approvalOutcomes)
  const approvalPosture = approvalCoverage === 0
    ? 0
    : clamp((approvalsAllowed - approvalsRefused) / approvalCoverage, -1, 1)

  return [
    historyPhaseOf(sources.historyInteractions),
    toolHealth,
    approvalPosture,
  ]
}

/**
 * Normalize new durable activity into three independent transient drives.
 *
 * An absent previous snapshot represents initial hydration and produces exact
 * rest, so historical records never masquerade as live activity. Positive
 * deltas use `n / (1 + n)` and removals or projection resets produce zero.
 *
 * @param previous - preceding monotonic activity totals, absent during initial hydration.
 * @param current - current monotonic activity totals.
 * @returns `xw` human, `yw` assistant, and `zw` tool activity in `[0, 1)`.
 */
export function transientChannelsOf(
  previous: AuraActivityChannelSources | null | undefined,
  current: AuraActivityChannelSources,
): Triad {
  if (previous === null || previous === undefined) return [0, 0, 0]
  return [
    boundedCount(positiveDelta(previous.humanMessages, current.humanMessages)),
    boundedCount(positiveDelta(previous.assistantMessages, current.assistantMessages)),
    boundedCount(positiveDelta(previous.toolEvents, current.toolEvents)),
  ]
}

/**
 * Produce all six ordered local-adapter coefficients from named logged sources.
 * @param current - current persistent inputs and monotonic activity totals.
 * @param previousActivity - preceding activity totals, absent during initial hydration.
 * @returns coefficients in canonical `xy, xz, yz, xw, yw, zw` order.
 */
export function auraCoefficientsOf(
  current: AuraChannelSources,
  previousActivity?: AuraActivityChannelSources | null,
): Coeffs6 {
  const persistent = persistentChannelsOf(current.persistent)
  const transient = transientChannelsOf(previousActivity, current.activity)
  return [...persistent, ...transient]
}

/**
 * Report the figure mapping's authority status.
 * @returns Always `false`; a visualization of a record grants no permission.
 */
export function figureGrantsAuthority(): false {
  return false
}
