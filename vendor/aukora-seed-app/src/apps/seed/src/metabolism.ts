// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Metabolism / resource state as a MONOTONIC CONTRACTION input (pure).
 *
 * Any future notion of the organism's metabolism or resource budget enters the governed gate ONLY as a contraction:
 * it may refuse or defer work when capacity is low, but it can NEVER create or expand authority, widen capability, or
 * turn a refusal into an acceptance. Capacity is a scalar in [0,1] that only ever decreases (monotone); the gate
 * reads it and can only ADD a refusal. This is the safe direction: scarcity tightens, never loosens.
 */

export const METABOLISM_FLOOR = 0.15;

export interface MetabolismDecision {
  readonly admit: boolean;
  readonly reason: string;
}

/** A capacity below the floor, or a job whose cost would push it below the floor, is refused/deferred. Refuse-only. */
export function metabolismDecision(capacity: number, cost = 0): MetabolismDecision {
  if (!Number.isFinite(capacity) || capacity <= METABOLISM_FLOOR) {
    return { admit: false, reason: `metabolism: capacity ${Number.isFinite(capacity) ? capacity.toFixed(2) : 'invalid'} at/below floor ${METABOLISM_FLOOR}` };
  }
  const effectiveCost = Number.isFinite(cost) && cost > 0 ? cost : 0;
  if (capacity - effectiveCost < METABOLISM_FLOOR) {
    return { admit: false, reason: `metabolism: job cost ${effectiveCost.toFixed(2)} would breach floor ${METABOLISM_FLOOR}` };
  }
  return { admit: true, reason: 'metabolism: within capacity' };
}

/** Monotone contraction tracker — capacity can only decrease. It admits work; it never grants authority. */
export class Metabolism {
  private cap: number;

  constructor(initial = 1) {
    this.cap = Number.isFinite(initial) ? Math.min(1, Math.max(0, initial)) : 0;
  }

  get capacity(): number {
    return this.cap;
  }

  /** Contract capacity by `amount` (≥0). Returns the new capacity. Monotone: never increases. */
  contract(amount: number): number {
    const delta = Number.isFinite(amount) && amount > 0 ? amount : 0;
    this.cap = Math.max(0, this.cap - delta);
    return this.cap;
  }

  admits(cost = 0): boolean {
    return metabolismDecision(this.cap, cost).admit;
  }

  /** Constant: metabolism can never grant or expand authority. */
  grantsAuthority(): false {
    return false;
  }
}
