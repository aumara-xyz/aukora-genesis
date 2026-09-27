// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Armed provider egress (R39) — the owner-armed gate, content-free egress receipts, and durable spend accounting
 * around any live provider transport.
 *
 *   - OWNER-ARMED pre-synthesis gate: the provider is DISARMED by default. A call is made only when the owner has
 *     explicitly armed egress (`ProviderArm.armed()`); otherwise the transport returns a benign non-vote and NO
 *     call goes out. This is a second lock beyond the opt-in `AUKORA_FU_LIVE` flag.
 *   - CONTENT-FREE egress receipts: every call (armed or refused) chains a receipt into the governed store carrying
 *     ONLY metadata — seat id, phase, model id, response byte length, status — and NEVER the prompt, the response
 *     content, or the credential. The auditable trail proves what left the machine without leaking what was said.
 *   - DURABLE spend accounting: a persisted USD total the caller reads/writes, enforcing the $2/pass + $10/day
 *     ceilings across restarts. A call that would breach the ceiling is refused BEFORE dispatch (non-vote, no call).
 *
 * Pure w.r.t. authority. The credential is never seen here — only the inner transport (built with a CredentialSource)
 * holds it, and it never surfaces it either.
 */
import type { ReactiveMemoryStore } from '@aukora/brain';
import type { CouncilSeat, SeatResponse, Transport } from '@aukora/council';
import { buildMemoryRecord } from '@aukora/memory';
import { RUNNER_CEILINGS } from './councilRunnerBoundary.js';

/** Owner arming — DISARMED by default. `armed()` is checked before every live call. */
export interface ProviderArm {
  armed(): boolean;
}

export const envProviderArm: ProviderArm = {
  armed: () => (typeof process !== 'undefined' && process.env ? process.env.AUKORA_FU_ARMED === '1' : false),
};

/** A fixed arm state (for tests / explicit owner control). */
export function fixedArm(value: boolean): ProviderArm {
  return { armed: () => value };
}

/** Durable spend account — the caller persists `dayToDateUsd`; ceilings are the frozen runner ceilings. */
export class DurableSpendAccount {
  private day: number;
  private pass = 0;

  constructor(dayToDateUsd = 0) {
    this.day = Number.isFinite(dayToDateUsd) && dayToDateUsd > 0 ? dayToDateUsd : 0;
  }

  get dayToDateUsd(): number {
    return this.day;
  }

  get passUsd(): number {
    return this.pass;
  }

  beginPass(): void {
    this.pass = 0;
  }

  /** Would adding `usd` breach the per-pass or per-day ceiling? (Checked before a call — fail-closed.) */
  wouldExceed(usd: number): boolean {
    const cost = Number.isFinite(usd) && usd > 0 ? usd : 0;
    return this.pass + cost > RUNNER_CEILINGS.perPassUsd || this.day + cost > RUNNER_CEILINGS.perDayUsd;
  }

  /** Book actual spend to both the pass and the durable day total. */
  record(usd: number): void {
    const cost = Number.isFinite(usd) && usd > 0 ? usd : 0;
    this.pass += cost;
    this.day += cost;
  }
}

export interface EgressReceipt {
  readonly seq: number;
  readonly seatId: string;
  readonly phase: string;
  readonly model: string;
  readonly status: 'called' | 'refused-disarmed' | 'refused-ceiling';
  readonly bytes: number;
  readonly receiptHash: string | null;
}

export interface ArmedEgressOptions {
  readonly arm: ProviderArm;
  readonly store: ReactiveMemoryStore;
  readonly spend?: DurableSpendAccount;
  /** Per-call estimated cost used only for the pre-call ceiling check (actual cost comes from the response). */
  readonly perCallEstimateUsd?: number;
  readonly nowIso?: string;
}

/**
 * Wrap an inner live transport so every call is owner-armed, ceiling-guarded, and content-free-receipted. A disarmed
 * or over-ceiling call returns a benign non-vote and never dispatches. Content-free: only metadata is receipted.
 */
export function armedEgressTransport(inner: Transport, opts: ArmedEgressOptions): Transport {
  let seq = 0;
  const receipts: EgressReceipt[] = [];
  const nowIso = opts.nowIso ?? new Date(0).toISOString();

  const emit = (seat: CouncilSeat, phase: string, model: string, status: EgressReceipt['status'], bytes: number): void => {
    seq += 1;
    const ing = opts.store.ingest(buildMemoryRecord({
      content: `provider-egress · seq=${seq} · seat=${seat.id} · phase=${phase} · model=${model} · status=${status} · bytes=${bytes}`,
      createdAt: nowIso, kind: 'receipt', consent: 'owner-only', provenance: 'provider-egress',
    }));
    receipts.push({ seq, seatId: seat.id, phase, model, status, bytes, receiptHash: ing.ok ? ing.chainHash : null });
  };

  const t: Transport = async (seat, prompt, phase, signal): Promise<SeatResponse> => {
    const model = seat.slug;
    if (!opts.arm.armed()) { emit(seat, phase, model, 'refused-disarmed', 0); return { text: '', served: undefined }; }
    if (opts.spend && opts.perCallEstimateUsd !== undefined && opts.spend.wouldExceed(opts.perCallEstimateUsd)) {
      emit(seat, phase, model, 'refused-ceiling', 0); return { text: '', served: undefined };
    }
    const res = await inner(seat, prompt, phase, signal);
    const cost = typeof res.costUsd === 'number' ? res.costUsd : 0;
    if (opts.spend) opts.spend.record(cost);
    emit(seat, phase, model, 'called', typeof res.text === 'string' ? res.text.length : 0);
    return res;
  };
  // expose the receipt log for tests/audit via a property on the function
  (t as unknown as { egressReceipts: () => readonly EgressReceipt[] }).egressReceipts = () => receipts.slice();
  return t;
}

/** HARD: the egress wrapper gates and audits; it never mints authority. Constant, by construction. */
export function providerEgressGrantsAuthority(): false {
  return false;
}
