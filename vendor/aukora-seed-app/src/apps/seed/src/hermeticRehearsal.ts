// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Hermetic rehearsal (#22 overnight, mission items 7–9) — the honest distinction between:
 *
 *   - a POLICY / BINDING SIMULATION: a Map-only check that a proposal satisfies policy and that its bindings
 *     (intent, draft, head) are consistent. It EXECUTES NOTHING. It is NOT evidence that the change works — it is
 *     evidence that the change is well-formed and permitted. (The ceremony's Map-only "rehearsal" is this.)
 *
 *   - a HERMETIC REHEARSAL: actually running a FIXED, DIGEST-BOUND test plan inside a no-secret / no-network cell,
 *     or refusing HONESTLY as `unavailable` when no such cell is armed. It never fabricates a pass.
 *
 * Two hard laws:
 *   (item 9) a caller — including a model — may only NAME an approved test-plan id. The plan STEPS live in the
 *     closed registry here and are never supplied by the caller, so no arbitrary shell command can ever be run.
 *   (item 8) the runner either executes the approved plan in an injected no-secret/no-network cell, or returns
 *     `unavailable`. A missing cell, a plan whose content digest drifted, an unknown id, or a cell that admits
 *     network/secret access all REFUSE — never a silent or fabricated pass.
 *
 * Pure over an injected cell: this module spawns nothing and grants no authority.
 */
import { canonicalHash } from '@aukora/kernel/canonical';

// ── policy / binding simulation (the Map-only check — EXECUTES NOTHING) ──────────────────────────────
export interface BindingSet {
  readonly intentId: string;
  readonly draftHash: string;
  readonly headBefore: string;
}
export interface PolicySimulationResult {
  readonly kind: 'policy-binding-simulation';
  readonly executed: false;             // HARD: a simulation never runs code — it is not proof the change works
  readonly ok: boolean;
  readonly reasonClass: string;
  readonly grantsAuthority: false;
}

/** Map-only policy + binding consistency check. Renamed from "rehearsal" so a simulation is never mistaken for
 *  executed evidence. Verifies the bindings are well-shaped and self-consistent; runs nothing. */
export function simulatePolicyBinding(bindings: BindingSet, allowedIntents: ReadonlySet<string>): PolicySimulationResult {
  const hex64 = /^[0-9a-f]{64}$/;
  const hex40 = /^[0-9a-f]{40}$/;
  const shaped = hex64.test(bindings.intentId) && hex64.test(bindings.draftHash) && hex40.test(bindings.headBefore);
  if (!shaped) return { kind: 'policy-binding-simulation', executed: false, ok: false, reasonClass: 'simulation:binding-malformed', grantsAuthority: false };
  if (!allowedIntents.has(bindings.intentId)) return { kind: 'policy-binding-simulation', executed: false, ok: false, reasonClass: 'simulation:intent-not-permitted', grantsAuthority: false };
  return { kind: 'policy-binding-simulation', executed: false, ok: true, reasonClass: 'simulation:ok', grantsAuthority: false };
}

// ── hermetic rehearsal (REAL execution in an isolated cell, or honest unavailable) ───────────────────
export type TestStepKind = 'assert-file-shape' | 'typecheck' | 'unit';
export interface TestStep {
  readonly kind: TestStepKind;
  /** A step ARGUMENT (e.g. a target file id or a fixture name) — NEVER a shell command; the cell interprets it. */
  readonly arg: string;
}

/** A fixed test plan. The registry is closed and digest-bound: callers name an id; the steps live here. */
export interface TestPlan {
  readonly planId: string;
  readonly digest: string;             // content-address of the steps (drift-detecting)
  readonly steps: readonly TestStep[];
  readonly requiresNetwork: false;
  readonly requiresSecrets: false;
}

/** The injected no-secret / no-network execution cell. This module NEVER spawns; the cell is the only executor. */
export interface RehearsalCell {
  readonly noNetwork: true;
  readonly noSecrets: true;
  runStep(step: TestStep): { readonly ok: boolean; readonly detail: string };
}

export type RehearsalStatus = 'passed' | 'failed' | 'unavailable' | 'refused';
export interface RehearsalOutcome {
  readonly kind: 'hermetic-rehearsal';
  readonly status: RehearsalStatus;
  readonly planId: string;
  readonly reasonClass: string;
  /** Content-free per-step results (kind + ok only) — never step output, never secrets. */
  readonly steps: ReadonlyArray<{ readonly kind: TestStepKind; readonly ok: boolean }>;
  readonly grantsAuthority: false;
}

function planDigest(steps: readonly TestStep[]): string {
  return canonicalHash(steps.map((s) => ({ kind: s.kind, arg: s.arg })));
}

/** Build an approved plan with a self-consistent digest (used to seed the closed registry). */
export function makeApprovedPlan(planId: string, steps: readonly TestStep[]): TestPlan {
  return { planId, digest: planDigest(steps), steps, requiresNetwork: false, requiresSecrets: false };
}

/** The CLOSED registry of approved plans. A model/caller may only select one of these ids. */
export class ApprovedTestPlans {
  private readonly plans = new Map<string, TestPlan>();
  constructor(plans: readonly TestPlan[] = []) {
    for (const p of plans) this.plans.set(p.planId, p);
  }
  get(planId: string): TestPlan | null {
    return this.plans.get(planId) ?? null;
  }
  ids(): readonly string[] {
    return [...this.plans.keys()];
  }
}

function outcome(planId: string, status: RehearsalStatus, reasonClass: string, steps: RehearsalOutcome['steps'] = []): RehearsalOutcome {
  return { kind: 'hermetic-rehearsal', status, planId, reasonClass, steps, grantsAuthority: false };
}

/**
 * Run an APPROVED hermetic rehearsal. `planId` is the ONLY caller-supplied value that selects work — never a
 * command. With no cell armed the honest answer is `unavailable`, never a fabricated pass.
 */
export function runHermeticRehearsal(planId: string, registry: ApprovedTestPlans, cell?: RehearsalCell): RehearsalOutcome {
  const plan = registry.get(planId);
  if (plan === null) return outcome(planId, 'refused', 'rehearsal:unknown-plan');           // item 9: only approved ids
  if (plan.digest !== planDigest(plan.steps)) return outcome(planId, 'refused', 'rehearsal:plan-tampered'); // drift → refuse
  if (plan.requiresNetwork !== false || plan.requiresSecrets !== false) return outcome(planId, 'refused', 'rehearsal:plan-not-hermetic');
  if (cell === undefined) return outcome(planId, 'unavailable', 'rehearsal:no-cell-armed');   // item 8: honest unavailable
  if (cell.noNetwork !== true || cell.noSecrets !== true) return outcome(planId, 'refused', 'rehearsal:cell-not-hermetic'); // a cell claiming net/secrets is refused

  const results: Array<{ kind: TestStepKind; ok: boolean }> = [];
  for (const step of plan.steps) {
    let stepOk = false;
    try { stepOk = cell.runStep(step).ok === true; } catch { stepOk = false; } // a throwing cell step is a fail, never a pass
    results.push({ kind: step.kind, ok: stepOk });
    if (!stepOk) return outcome(planId, 'failed', 'rehearsal:step-failed', results); // fail-fast; never a partial pass
  }
  return outcome(planId, 'passed', 'rehearsal:passed', results);
}

/** HARD: rehearsal is evidence plumbing — it never signs, applies, or mints authority. Constant. */
export function hermeticRehearsalGrantsAuthority(): false {
  return false;
}
