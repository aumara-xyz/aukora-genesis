// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Durable effect-event STORE (overnight brick 3) — projects trusted effect events into the backend
 * IDEMPOTENTLY, and rebuilds the canonical projection from the durable rows.
 *
 * Mirrors the shape of Sam 2's `ConvexWorkflowStore` (async `WorkflowIo` seam → convex-test or a live
 * `ConvexHttpClient`, loopback-only): here `EffectIo` is the durable effect-row seam, and `InMemoryEffectIo`
 * is the executable reference the convex adapter mirrors. This is the adapter the PRIMARY runtime uses to
 * project journal effects — not just a test harness (directive item 10).
 *
 * Fail-closed guarantees (proven in the test):
 *   - a malformed / authority-claiming / secret-bearing delivery is REFUSED before any IO;
 *   - a re-delivery of the SAME effect (id + payload) is a no-op ('exists') — 10 identical writes → one row;
 *   - a CONFLICTING delivery (same effectId, different payload) is REFUSED ('conflict') — never overwrites;
 *   - a backend OUTAGE (io throws) is reported as 'unavailable' and the row REMAINS pending for a retry —
 *     nothing is silently dropped;
 *   - authority material can never enter: only `validateEffectEvent`-passing rows reach IO.
 */
import {
  type EffectEventV1,
  validateEffectEvent, effectPayloadHash, projectEffectEvents, effectProjectionRoot,
} from './effectEvent.js';

export type InsertOutcome = 'inserted' | 'exists' | 'conflict';

/**
 * Async IO seam for durable effect-event rows. `insert` is idempotent-by-contract: a second identical row is
 * 'exists'; a different payload under the same effectId is 'conflict'; it may THROW on a backend outage.
 */
export interface EffectIo {
  insert(row: EffectEventV1): Promise<InsertOutcome>;
  /** All durable rows — the protected event stream as the backend holds it. */
  list(): Promise<readonly unknown[]>;
}

export type EffectWriteResult =
  | { readonly ok: true; readonly outcome: 'inserted' | 'exists' }
  | { readonly ok: false; readonly reason: 'refused' | 'conflict' | 'unavailable' };

export class EffectEventStore {
  constructor(private readonly io: EffectIo) {}

  /** Project one trusted delivery into the durable backend, idempotently + fail-closed. */
  async write(delivery: unknown): Promise<EffectWriteResult> {
    const e = validateEffectEvent(delivery);
    if (e === null) return { ok: false, reason: 'refused' }; // fail-closed BEFORE any IO
    let outcome: InsertOutcome;
    try {
      outcome = await this.io.insert(e);
    } catch {
      return { ok: false, reason: 'unavailable' }; // outage — caller retries; nothing silently dropped
    }
    if (outcome === 'conflict') return { ok: false, reason: 'conflict' };
    return { ok: true, outcome };
  }

  /** Rebuild the canonical projection PURELY from the durable rows (destroy-and-rebuild). */
  async rebuild(): Promise<{ readonly root: string; readonly canonicalSize: number; readonly quarantined: number }> {
    const rows = await this.io.list();
    const p = projectEffectEvents(rows);
    return { root: effectProjectionRoot(p), canonicalSize: p.canonical.size, quarantined: p.quarantined.length };
  }
}

/**
 * In-memory reference `EffectIo` — the executable spec the convex-test / live adapter mirrors. Durable rows
 * survive a fresh `EffectEventStore` over the SAME io (the adapter-restart model); `setOutage(true)` models a
 * backend outage so the store's fail-closed retry contract is testable without killing a real process.
 */
export class InMemoryEffectIo implements EffectIo {
  private readonly rows = new Map<string, EffectEventV1>();
  private readonly payloadHashes = new Map<string, string>();
  /** Rows a COMPROMISED backend wrote directly, bypassing the store's validating `write()`. */
  private readonly injected: unknown[] = [];
  private outage = false;

  setOutage(on: boolean): void { this.outage = on; }

  async insert(row: EffectEventV1): Promise<InsertOutcome> {
    if (this.outage) throw new Error('effect_io: local backend unavailable');
    const h = effectPayloadHash(row);
    const prior = this.payloadHashes.get(row.effectId);
    if (prior === undefined) { this.rows.set(row.effectId, row); this.payloadHashes.set(row.effectId, h); return 'inserted'; }
    return prior === h ? 'exists' : 'conflict';
  }

  async list(): Promise<readonly unknown[]> {
    // The store re-validates every row on rebuild, so an injected hostile row is present in the raw stream but
    // can never enter the canonical projection — modelling exactly a compromised/tampered backend table.
    return [...this.rows.values(), ...this.injected];
  }

  /**
   * ADVERSARY hook: write an ARBITRARY, UNVALIDATED row straight into the durable set, bypassing `write()` —
   * modelling a compromised backend, a malformed migration, or a tampered SQLite row. `rebuild()` must fail
   * closed: `projectEffectEvents` re-validates, so a hostile row is refused and never mints authority.
   */
  injectRaw(row: unknown): void { this.injected.push(row); }

  /** Test/ops helper: destroy the durable projection rows (the event stream is what gets replayed to rebuild). */
  destroyRows(): void { this.rows.clear(); this.payloadHashes.clear(); this.injected.length = 0; }
}
