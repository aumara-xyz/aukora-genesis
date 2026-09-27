// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * DURABLE RECEIPT BRIDGE (R56) — the smallest content-free seam between the two KIRA receipt stores.
 *
 * There are two receipt-chained KIRA stores over the SAME canonical primitives (`@aukora/kernel/evidence`
 * receipt chain + `@aukora/memory` `memoryCommitment`):
 *   - the in-process `ReactiveMemoryStore` — the door/ceremony's per-boot working memory (receipt-before-row +
 *     reactive snapshot within ONE process life); ephemeral, dies with the process;
 *   - the Convex `memoryChain` — the DURABLE projection the Spatial reads observe; it already guarantees
 *     exactly-once (idempotent by content-addressed `recordId`, R34), no-resurrection (R44), receipt-before-row,
 *     and `grantsAuthority:false` on every row.
 *
 * The seam the R56 audit flagged: a permitted door receipt is written to the in-process store but never reaches
 * the durable Convex projection. This bridge closes it with NOTHING new: it appends the receipt to the local
 * store AND forwards the SAME content-free record to an injected Convex ingest face. Exactly-once and
 * restart-safety come for FREE from the Convex side's content-addressed idempotency — a re-forward after a
 * restart (a fresh in-process store, same durable backend) is deduped to the existing row.
 *
 * HARD BOUNDARIES: it GRANTS NO AUTHORITY (it forwards a record; the durable path validates + refuses
 * authority-shaped memory). It carries no key, signature, or proposal content. A locally-refused record is
 * NEVER forwarded. A backend outage FAILS HONESTLY — the local receipt stands, the durable leg is marked
 * unreachable (retryable), never silently "applied".
 */
import { ReactiveMemoryStore, type IngestVerdict } from './reactiveStore.js';

/** The durable projection's ingest face (injected). In production this wraps a Convex client call to the public
 *  `ingest` action / internal `memory.ingestValidated`; in tests it wraps a `convex-test` handle. Content-free. */
export interface DurableProjectionIo {
  ingest(record: unknown): Promise<DurableIngestResult>;
}

export interface DurableIngestResult {
  readonly ok: boolean;
  readonly recordId?: string;
  readonly chainHash?: string;
  readonly idempotent?: boolean;
  readonly refusal?: string;
}

export type DurableLeg =
  | DurableIngestResult
  | { readonly ok: false; readonly refusal: 'local-refused' | 'projection-unreachable' };

export interface BridgedReceipt {
  /** The in-process append (unchanged door behavior). */
  readonly local: IngestVerdict;
  /** The durable projection leg. `local-refused` ⇒ never forwarded; `projection-unreachable` ⇒ backend outage. */
  readonly durable: DurableLeg;
  /** True only when BOTH the local receipt and the durable projection accepted the SAME record. */
  readonly bridged: boolean;
}

/**
 * Bridge a single permitted door receipt into the durable Convex projection. The local receipt-chain append is
 * authoritative for the door's in-process snapshot; the durable leg is the projection the Spatial reads observe.
 */
export class DurableReceiptBridge {
  constructor(
    private readonly local: ReactiveMemoryStore,
    private readonly projection: DurableProjectionIo,
  ) {}

  async ingest(record: unknown): Promise<BridgedReceipt> {
    const local = this.local.ingest(record);
    // A record the local store refuses (malformed / authority-shaped / secret) is NEVER forwarded to the durable
    // projection — the seam only carries receipts the in-process KIRA already accepted.
    if (!local.ok) return { local, durable: { ok: false, refusal: 'local-refused' }, bridged: false };
    try {
      const durable = await this.projection.ingest(record);
      return { local, durable, bridged: durable.ok };
    } catch {
      // A backend outage fails HONESTLY: the local receipt stands, the durable leg is retryable, nothing lies green.
      return { local, durable: { ok: false, refusal: 'projection-unreachable' }, bridged: false };
    }
  }
}

/** HARD: the bridge forwards content-free receipts; it mints and grants no authority. Constant, by construction. */
export function durableReceiptBridgeGrantsAuthority(): false {
  return false;
}
