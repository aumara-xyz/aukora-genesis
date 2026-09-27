// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Trace — pure receipt-PAYLOAD builders. Plain JSON objects only.
 *
 * The mind is advisory: it authors observations and proposals; it signs,
 * applies, and authorizes NOTHING. Every payload built here carries the house
 * containment literals (`advisoryOnly: true`, `grantsAuthority: false`) so a
 * downstream receipt chain can never mistake a reasoning row for a capability.
 * Persistence is the caller's job — this module performs no I/O and reads no
 * clock; every field is caller-supplied.
 *
 * Re-authored from the ARC-AGI-3 reasoning engine, aukora-symbiote branch
 * fable/arc3-reasoning-engine-20260710 @ e5768a2f.
 */
import type { EnvState } from './ports.js';
import type { RolloutOutcome } from './rollout.js';

/** House invariant pin: the mind can never grant authority. */
export function mindGrantsAuthority(): false {
  return false;
}

export type MindTraceKind = 'start' | 'move' | 'plan_move' | 'council' | 'rollout_reject' | 'summary';

interface Containment {
  readonly advisoryOnly: true;
  readonly grantsAuthority: false;
}
const CONTAINMENT: Containment = { advisoryOnly: true, grantsAuthority: false };

export interface StartTraceInput {
  readonly runId: string;
  readonly environmentId: string;
  readonly maxMoves: number;
  readonly maxResets: number;
  readonly windowPairs: number;
}
export type StartTrace = Containment & StartTraceInput & { readonly kind: 'start' };

export function buildStartTrace(input: StartTraceInput): StartTrace {
  return { kind: 'start', ...input, ...CONTAINMENT };
}

export interface MoveTraceInput {
  readonly move: number;
  /** Human-readable action label, e.g. "ACTION4" or "ACTION6(30,24)". */
  readonly action: string;
  readonly noop: boolean;
  readonly state: EnvState;
  readonly levelsCompleted: number;
  readonly whatISee: string;
  readonly delta: string;
  readonly hypothesis: string;
  readonly reason: string;
  readonly prediction: string;
  readonly memo: string;
  readonly planLength: number;
}
export type MoveTrace = Containment & MoveTraceInput & { readonly kind: 'move' };

export function buildMoveTrace(input: MoveTraceInput): MoveTrace {
  return { kind: 'move', ...input, ...CONTAINMENT };
}

export interface PlanMoveTraceInput {
  readonly move: number;
  readonly action: string;
  readonly expect: string;
  readonly ok: boolean;
  readonly note: string;
  readonly state: EnvState;
  readonly levelsCompleted: number;
}
export type PlanMoveTrace = Containment & PlanMoveTraceInput & { readonly kind: 'plan_move' };

export function buildPlanMoveTrace(input: PlanMoveTraceInput): PlanMoveTrace {
  return { kind: 'plan_move', ...input, ...CONTAINMENT };
}

export interface CouncilTraceInput {
  readonly afterMove: number;
  readonly deathsThisLevel: number;
  /** Independent-model advice, carried verbatim as hypotheses — never as truth. */
  readonly advice: readonly string[];
}
export type CouncilTrace = Containment & CouncilTraceInput & { readonly kind: 'council' };

export function buildCouncilTrace(input: CouncilTraceInput): CouncilTrace {
  return { kind: 'council', ...input, ...CONTAINMENT };
}

export interface RolloutRejectTraceInput {
  readonly move: number;
  readonly outcome: RolloutOutcome;
}
export type RolloutRejectTrace = Containment & RolloutRejectTraceInput & { readonly kind: 'rollout_reject' };

/** Every rejected ghost future is recorded — lookahead refusals are evidence too. */
export function buildRolloutRejectTrace(input: RolloutRejectTraceInput): RolloutRejectTrace {
  return { kind: 'rollout_reject', ...input, ...CONTAINMENT };
}

export interface SummaryTraceInput {
  readonly runId: string;
  readonly environmentId: string;
  readonly won: boolean;
  readonly state: EnvState;
  readonly levelsCompleted: number;
  readonly winLevels: number;
  readonly moves: number;
  readonly resets: number;
  readonly planMoves: number;
}
export type SummaryTrace = Containment & SummaryTraceInput & { readonly kind: 'summary' };

export function buildSummaryTrace(input: SummaryTraceInput): SummaryTrace {
  return { kind: 'summary', ...input, ...CONTAINMENT };
}

export type MindTraceRow = StartTrace | MoveTrace | PlanMoveTrace | CouncilTrace | RolloutRejectTrace | SummaryTrace;
