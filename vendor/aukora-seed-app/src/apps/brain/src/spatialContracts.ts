// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Stable READ-ONLY local contracts for Sam 4's shell (the CONSOLE center-pane organ).
 *
 * The shell consumes data shapes, never brain internals — no UI is coupled into brain code. Everything here is
 * read-only and advisory. `source` is the VISIBLE honesty label: `'live'` = projected from a real local store;
 * `'fixture'` = canned demo data, and consumers MUST render that label. Event subscription is a plain
 * listener seam over the store decorator — no vendor client in the contract.
 */
import { ReactiveMemoryStore } from './reactiveStore.js';
import { brainHealthSnapshot, type BrainHealthSnapshotV1 } from './healthContract.js';
import { providerTruthTable } from './brainProvider.js';
import type { ModelTruth } from './brainProvider.js';
import type { RecallQuery, RecallHit } from '@aukora/memory';
import type { IngestVerdict, ForgetVerdict } from './reactiveStore.js';
import type { KiraClass } from './memoryBridge.js';

export type BrainEvent =
  | { readonly kind: 'ingested'; readonly recordId: string }
  | { readonly kind: 'forgotten'; readonly recordId: string };

export type BrainEventListener = (event: BrainEvent) => void;

/**
 * Store decorator that emits events on ingest/forget — the subscription seam. Listener errors are swallowed
 * (an observer can never break a reflex); reads pass straight through.
 */
export class SubscribableMemoryStore extends ReactiveMemoryStore {
  private readonly listeners = new Set<BrainEventListener>();

  subscribe(listener: BrainEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: BrainEvent): void {
    for (const l of this.listeners) {
      try { l(event); } catch { /* an observer never breaks a reflex */ }
    }
  }

  override ingest(record: unknown): IngestVerdict {
    const verdict = super.ingest(record);
    if (verdict.ok) this.emit({ kind: 'ingested', recordId: verdict.recordId });
    return verdict;
  }

  override forget(recordId: string, verifyOwner: () => boolean, at: string): ForgetVerdict {
    const verdict = super.forget(recordId, verifyOwner, at);
    if (verdict.ok) this.emit({ kind: 'forgotten', recordId });
    return verdict;
  }
}

export interface KiraCatalogEntryV1 {
  readonly legacyRef: string;
  readonly kiraClass: KiraClass;
  readonly contentHash: string;
}

/** The versioned, read-only contract Sam 4's console renders. All fields content-free. */
export interface BrainLocalContractV1 {
  readonly schema: 'aukora-brain-local-contract-v1';
  /** VISIBLE honesty label — consumers must render it. */
  readonly source: 'live' | 'fixture';
  readonly health: BrainHealthSnapshotV1;
  readonly kiraCounts: Readonly<Record<KiraClass, number>>;
  readonly kiraRefs: readonly KiraCatalogEntryV1[];
  readonly providerTruth: readonly { readonly id: string; readonly truth: ModelTruth }[];
  recall(query: RecallQuery): RecallHit[];
  subscribe(listener: BrainEventListener): () => void;
  readonly grantsAuthority: false;
}

export interface LiveContractInput {
  readonly store: SubscribableMemoryStore;
  readonly kiraCounts?: Readonly<Record<KiraClass, number>>;
  readonly kiraRefs?: readonly KiraCatalogEntryV1[];
  readonly nodePrintId?: string;
}

/** Project a LIVE contract from a real local store. Read-only: reads + subscription only. */
export function liveBrainContract(input: LiveContractInput): BrainLocalContractV1 {
  return {
    schema: 'aukora-brain-local-contract-v1',
    source: 'live',
    health: brainHealthSnapshot(input.store, { providerMode: 'deterministic-offline', nodePrintId: input.nodePrintId }),
    kiraCounts: input.kiraCounts ?? { ROOT: 0, UNITE: 0, RISE: 0, GOLD: 0 },
    kiraRefs: input.kiraRefs ?? [],
    providerTruth: providerTruthTable(),
    recall: (query) => input.store.recall(query),
    subscribe: (listener) => input.store.subscribe(listener),
    grantsAuthority: false,
  };
}

// ── Convex-side contracts for Sam 4 (R35) ─────────────────────────────────────────────────────────────────

/** Read-only rehearsal (workflow) state, as returned by the `rehearsal.rehearsalStatus` query. */
export interface RehearsalStateV1 {
  readonly key: string;
  readonly status: 'running' | 'completed' | 'cancelled';
  readonly totalSteps: number;
  readonly currentStep: number;
  readonly authorityRef: string;
  readonly effectsApplied: number;
}

/** One immutable receipt-stream event, as returned by the `rehearsal.receiptStream` query (logical time). */
export interface ReceiptStreamEventV1 {
  readonly index: number;
  readonly rehearsalKey: string;
  readonly event: string;
  readonly step: number | null;
  readonly chainHash: string;
}

/**
 * The STABLE Convex function names Sam 4's console wires to on the LOCAL deployment. Senses are reactive
 * queries (subscribe via the Convex client); the two cancellation reflexes are the only writes exposed, and
 * neither grants authority. Names are contract — renaming any is a breaking change requiring a round.
 */
export const SAM4_CONVEX_CONTRACTS = {
  senses: {
    health: 'memory:health',
    snapshot: 'memory:snapshot',
    recall: 'memory:recall',
    verify: 'memory:verify',
    impulseStatus: 'memory:impulseStatus',
    impulseBudget: 'memory:impulseBudgetRemaining',
    scheduledStatus: 'memory:scheduledStatus',
    rehearsalStatus: 'rehearsal:rehearsalStatus',
    receiptStream: 'rehearsal:receiptStream',
    verifyReceiptEvents: 'rehearsal:verifyReceiptEvents',
    workflowState: 'workflows:loadWorkflow',
    listWorkflows: 'workflows:listWorkflows',
  },
  cancellation: {
    impulse: 'memory:cancelImpulse',
    rehearsal: 'rehearsal:cancelRehearsal',
  },
  grantsAuthority: false,
} as const;

/**
 * The FIXTURE fallback — canned data, VISIBLY labelled (`source: 'fixture'`). It emits nothing and recalls
 * nothing; a consumer that hides the label is out of contract.
 */
export function fixtureBrainContract(): BrainLocalContractV1 {
  const store = new SubscribableMemoryStore();
  return {
    schema: 'aukora-brain-local-contract-v1',
    source: 'fixture',
    health: brainHealthSnapshot(store),
    kiraCounts: { ROOT: 2, UNITE: 1, RISE: 1, GOLD: 1 },
    kiraRefs: [
      { legacyRef: 'fixture#0', kiraClass: 'ROOT', contentHash: '0'.repeat(64) },
      { legacyRef: 'fixture#1', kiraClass: 'GOLD', contentHash: '1'.repeat(64) },
    ],
    providerTruth: providerTruthTable(),
    recall: () => [],
    subscribe: () => () => {},
    grantsAuthority: false,
  };
}
