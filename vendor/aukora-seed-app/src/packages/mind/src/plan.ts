// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Plan grammar — mind-authored straightaways, harness-verified per step.
 *
 * A plan is a bounded list of further steps the harness may execute without a
 * model call, each guarded by a cheap reality check ("expect"). Parsing is
 * drop-not-fail: malformed steps are skipped, the list is capped, and the
 * expectation string is bounded. Verification of an expectation against real
 * grids lives in grid.ts (`checkPlanExpectation`), which shares ONE rigid-move
 * law with diff rendering.
 *
 * Re-authored from the ARC-AGI-3 reasoning engine, aukora-symbiote branch
 * fable/arc3-reasoning-engine-20260710 @ e5768a2f.
 */
import type { MindAction } from './ports.js';

/** Hard cap on plan length: the mind may pre-commit at most 8 further steps. */
export const PLAN_MAX_STEPS = 8;
/** Hard cap on one expectation string. */
export const EXPECT_MAX_CHARS = 40;
/** Expectation used when a step names none: the step must not be a pure no-op. */
export const DEFAULT_EXPECTATION = 'changed';

export type MoveDirection = 'up' | 'down' | 'left' | 'right';

/**
 * The expectation grammar. Anything outside it fails safe at check time:
 *   'any'                  -> always passes
 *   'changed'              -> some cell changed (not a pure no-op)
 *   'moved'                -> any color block registered a rigid move
 *   'moved:<color>:<dir>'  -> that color moved that direction
 */
export type PlanExpectation = 'any' | 'changed' | 'moved' | `moved:${number}:${MoveDirection}`;

export interface PlanStep {
  readonly action: MindAction;
  /** Free string on the wire (models improvise); the grammar above is what verifies. */
  readonly expect: string;
}

/**
 * Normalizes one raw step's action; returns null to drop the step. Injected by
 * the reply parser (which owns the tolerant action forms) so this module stays
 * a pure grammar with no dependency on parsing.
 */
export type PlanActionNormalizer = (candidate: unknown, step: unknown) => MindAction | null;

/**
 * Parse a raw `plan` value from a mind reply: cap at PLAN_MAX_STEPS, drop
 * malformed steps, default the expectation to 'changed', bound it to
 * EXPECT_MAX_CHARS. Never throws; a non-array yields an empty plan.
 */
export function parsePlanSteps(raw: unknown, normalizeStepAction: PlanActionNormalizer): PlanStep[] {
  const plan: PlanStep[] = [];
  if (!Array.isArray(raw)) return plan;
  for (const step of raw) {
    if (plan.length >= PLAN_MAX_STEPS) break;
    const record = step !== null && typeof step === 'object' ? (step as Record<string, unknown>) : null;
    const action = normalizeStepAction(record ? record['action'] ?? step : step, step);
    if (!action) continue;
    const expectRaw = record ? record['expect'] : undefined;
    const expect = typeof expectRaw === 'string' ? expectRaw.slice(0, EXPECT_MAX_CHARS) : DEFAULT_EXPECTATION;
    plan.push({ action, expect });
  }
  return plan;
}
