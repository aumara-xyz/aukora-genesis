// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/** Session-continuity tracking for Aura's transient activity coefficients. */

import {
  auraChannelSourcesOf,
  type AuraActivityChannelSources,
  type AuraSessionProjectionEntry,
} from './aggregate.ts'
import { transientChannelsOf, type Triad } from './figure.ts'

/** One projected Session head used to distinguish new activity from hydration. */
export interface AuraActivityHead {
  /** Opaque Session id. */
  sessionId: string
  /** Latest durable sequence represented by the activity totals. */
  lastSeq: number
  /** Monotonic logged activity totals at that sequence. */
  activity: AuraActivityChannelSources
}

/** Stored activity head for a Session that remained present across projections. */
export type AuraActivityBaseline = Omit<AuraActivityHead, 'sessionId'>

/** Result of advancing per-Session activity continuity by one projection update. */
export interface AuraActivityAdvance {
  /** Current heads retained as the baseline for the next update. */
  baselines: ReadonlyMap<string, AuraActivityBaseline>
  /** Positive activity from continuing, monotonically advancing Sessions only. */
  impulse: Triad
}

function emptyActivity(): AuraActivityChannelSources {
  return { humanMessages: 0, assistantMessages: 0, toolEvents: 0 }
}

function addActivity(
  target: AuraActivityChannelSources,
  source: AuraActivityChannelSources,
): void {
  target.humanMessages += source.humanMessages
  target.assistantMessages += source.assistantMessages
  target.toolEvents += source.toolEvents
}

function isMonotonic(
  previous: AuraActivityChannelSources,
  current: AuraActivityChannelSources,
): boolean {
  return current.humanMessages >= previous.humanMessages
    && current.assistantMessages >= previous.assistantMessages
    && current.toolEvents >= previous.toolEvents
}

/**
 * Extract per-Session activity heads from the currently available projections.
 * @param entries - Host-listed Sessions and their optional Aura projections.
 * @returns current projected heads in Host-list order.
 */
export function auraActivityHeadsOf(
  entries: readonly AuraSessionProjectionEntry[],
): AuraActivityHead[] {
  return entries.flatMap((entry) => {
    if (entry.projection === undefined) return []
    return [{
      sessionId: entry.id,
      lastSeq: entry.projection.lastSeq,
      activity: auraChannelSourcesOf(entry.projection).activity,
    }]
  })
}

/**
 * Advance activity continuity without treating hydration, removal, or replay as live input.
 *
 * A Session contributes an impulse only when it existed in the preceding baseline,
 * its durable sequence advanced, and all three totals remained monotonic. New,
 * reappearing, rewound, and reset projections establish a new baseline at exact rest.
 *
 * @param previous - preceding heads keyed by opaque Session id.
 * @param current - currently projected Session heads.
 * @returns replacement baselines and the independently normalized activity impulse.
 */
export function advanceAuraActivity(
  previous: ReadonlyMap<string, AuraActivityBaseline>,
  current: readonly AuraActivityHead[],
): AuraActivityAdvance {
  const baselines = new Map<string, AuraActivityBaseline>()
  const comparablePrevious = emptyActivity()
  const comparableCurrent = emptyActivity()

  for (const head of current) {
    baselines.set(head.sessionId, {
      lastSeq: head.lastSeq,
      activity: { ...head.activity },
    })
    const baseline = previous.get(head.sessionId)
    if (baseline === undefined
      || head.lastSeq <= baseline.lastSeq
      || !isMonotonic(baseline.activity, head.activity)) continue
    addActivity(comparablePrevious, baseline.activity)
    addActivity(comparableCurrent, head.activity)
  }

  return {
    baselines,
    impulse: transientChannelsOf(comparablePrevious, comparableCurrent),
  }
}
