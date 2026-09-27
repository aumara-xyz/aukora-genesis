// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Governed effect CANCELLATION (overnight brick 8 — cancellation) — a projection-time filter that revokes a
 * cancelled workflow's effects from the ACTIVE canonical projection, deterministically and auditably.
 *
 * The protected event stream is append-only and is NEVER rewritten: cancellation is applied at PROJECTION time
 * against a set of cancelled `rehearsalKey`s (the governed cancellation set). So the raw stream still shows what
 * was there — the cancellation is visible by comparing the projection with and without the set — while the
 * active projection and its root reflect only the effects of non-cancelled workflows. Cancellation is TERMINAL:
 * re-delivering a cancelled key's effects after the fact cannot resurrect them while the key stays cancelled.
 *
 * Additive: this does not modify the effect-event core; it composes projectEffectEvents + effectProjectionRoot.
 */
import {
  type EffectProjection,
  validateEffectEvent, projectEffectEvents, effectProjectionRoot,
} from './effectEvent.js';

export interface CancellableProjection extends EffectProjection {
  /** How many otherwise-valid effects were suppressed because their rehearsalKey was cancelled. */
  readonly cancelledEffects: number;
  /** The cancelled rehearsalKeys actually observed in the stream (auditable — cancelling an absent key is a no-op). */
  readonly cancelledKeysObserved: readonly string[];
}

/**
 * Project a delivery stream with a governed cancellation set. Effects whose `rehearsalKey` is cancelled are
 * excluded from the canonical projection (and its root); everything else projects exactly as normal.
 */
export function projectWithCancellations(deliveries: readonly unknown[], cancelledKeys: Iterable<string>): CancellableProjection {
  const cancelled = new Set(cancelledKeys);
  const kept: unknown[] = []; // valid non-cancelled events + any malformed deliveries (the core re-counts refusals)
  let cancelledEffects = 0;
  const observed = new Set<string>();
  for (const d of deliveries) {
    const e = validateEffectEvent(d);
    if (e === null) { kept.push(d); continue; }
    if (cancelled.has(e.rehearsalKey)) { cancelledEffects += 1; observed.add(e.rehearsalKey); continue; }
    kept.push(e);
  }
  const base = projectEffectEvents(kept);
  return { ...base, cancelledEffects, cancelledKeysObserved: [...observed].sort() };
}

/** Root over the active (post-cancellation) canonical projection. */
export function cancellableProjectionRoot(p: CancellableProjection): string {
  return effectProjectionRoot(p);
}
