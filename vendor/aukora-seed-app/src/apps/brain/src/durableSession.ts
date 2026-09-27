// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * DurableWorkflowSession — R50: the TYPED SEAM the production mind-door composition uses so a mutating
 * request is never reported durable until its pending save has SETTLED into the local self-hosted Convex
 * backend. Falsifies the "cache-backed save/load looks green before settle()" failure mode by construction:
 * the session's only mutating entrypoint runs the machine step AND settles before returning a durability
 * verdict. Cache/OCC semantics are unchanged — this wraps, never reimplements.
 *
 * Failure classes are DISTINCT and CONTENT-FREE (class names + workflow ids only — never state contents):
 *   durable · hydration-failure · store-unavailable · validation-refused · occ-conflict · settle-divergence · pending
 * Boundary preserved: Convex persists/projects workflow state only — no owner keys, raw signatures, authority
 * material, raw proposal content, Git effects, or authorization functions cross this seam. AUMLOK and candidate
 * staging stay outside. Process-kill ceremony is Sam 3's; this seam only makes durability HONEST and typed.
 */
import type { ConvexWorkflowStore } from './convexWorkflowStore.js';

export type DurabilityClass =
  | 'durable'            // machine step accepted AND settle pushed it; zero pending remains
  | 'hydration-failure'  // durable row exists but failed fail-closed validation on hydrate
  | 'store-unavailable'  // the local backend was unreachable; the save REMAINS pending (retry-safe)
  | 'validation-refused' // the machine's save was refused by the injected validator (never persisted)
  | 'occ-conflict'       // a competing writer holds the version; durable truth re-hydrated
  | 'settle-divergence'  // cache accepted but the authoritative mutation lost the race; winner re-hydrated
  | 'pending';           // step accepted but not yet settled (only reachable via stepWithoutSettle — test/diagnostic)

export interface DurableVerdict<T> {
  readonly outcome: T;
  readonly durability: DurabilityClass;
  /** Content-free settle evidence: counts + workflow ids only. */
  readonly settled: { readonly pushed: number; readonly divergence: readonly string[]; readonly unavailable: readonly string[] } | null;
  readonly pendingCount: number;
}

/** The step result shape the seam inspects — the machine's DurableOutcome satisfies it structurally. */
export interface StepOutcomeLike { readonly reasonClass: string }

export class DurableWorkflowSession {
  constructor(private readonly store: ConvexWorkflowStore) {}

  /**
   * HYDRATE-BEFORE-LISTEN: pull the durable truth for the workflow before any machine step runs.
   * Distinguishes backend-unreachable from fail-closed validation of a corrupt durable row.
   */
  async begin(workflowId: string): Promise<{ ok: true } | { ok: false; durability: 'store-unavailable' | 'hydration-failure' }> {
    try {
      await this.store.hydrate(workflowId);
      return { ok: true };
    } catch (err) {
      const validation = /failed validation/.test(String(err));
      return { ok: false, durability: validation ? 'hydration-failure' : 'store-unavailable' };
    }
  }

  /**
   * SETTLE-AFTER-MUTATION: run the sync machine step, then settle. The verdict is 'durable' ONLY when the
   * settle drained every pending save (zero-pending success). A refused/conflicted step is classified from
   * the machine's own reason class WITHOUT settling phantom saves.
   */
  async runMutating<T extends StepOutcomeLike>(step: () => T): Promise<DurableVerdict<T>> {
    const outcome = step();
    if (this.store.pendingCount() === 0) {
      // The step persisted nothing: classify the refusal honestly — nothing to settle, nothing durable.
      const cls: DurabilityClass = /store-conflict|conflict/.test(outcome.reasonClass) ? 'occ-conflict'
        : /refused|malformed/.test(outcome.reasonClass) ? 'validation-refused'
        : 'validation-refused';
      return { outcome, durability: cls, settled: null, pendingCount: 0 };
    }
    const settled = await this.store.settle();
    const durability: DurabilityClass = settled.unavailable.length > 0 ? 'store-unavailable'
      : settled.divergence.length > 0 ? 'settle-divergence'
      : 'durable';
    return {
      outcome,
      durability,
      settled: { pushed: settled.pushed, divergence: settled.divergence, unavailable: settled.unavailable },
      pendingCount: this.store.pendingCount(),
    };
  }

  /** Diagnostic-only: a step WITHOUT settle — exists to make the green-before-settle hazard expressible in tests. */
  stepWithoutSettle<T extends StepOutcomeLike>(step: () => T): DurableVerdict<T> {
    const outcome = step();
    return { outcome, durability: 'pending', settled: null, pendingCount: this.store.pendingCount() };
  }

  /** IDEMPOTENT RETRY: re-settle whatever remains pending (after store-unavailable). Safe to call repeatedly. */
  async retrySettle(): Promise<DurableVerdict<null>> {
    const settled = await this.store.settle();
    const durability: DurabilityClass = settled.unavailable.length > 0 ? 'store-unavailable'
      : settled.divergence.length > 0 ? 'settle-divergence'
      : 'durable';
    return { outcome: null, durability, settled: { pushed: settled.pushed, divergence: settled.divergence, unavailable: settled.unavailable }, pendingCount: this.store.pendingCount() };
  }
}

/** The session persists projections through the store; it grants no authority. Constant. */
export function durableSessionGrantsAuthority(): false {
  return false;
}
