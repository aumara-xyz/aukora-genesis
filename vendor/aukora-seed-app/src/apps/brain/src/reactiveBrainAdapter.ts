// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * ReactiveBrainAdapter — the Aukora-owned boundary over a reactive backend (Convex).
 *
 * Convex primitives are mapped DELIBERATELY to brain roles, so the organism reasons in its own vocabulary and
 * never leaks a vendor concept into brain logic:
 *
 *   reactive queries   → SENSES / shared state   (read-only; senses never write)
 *   mutations          → ATOMIC REFLEXES         (one mutation = one serializable receipt-write reflex)
 *   scheduled functions→ DELAYED IMPULSES        (a future one-shot impulse; declared, not fired here)
 *   cron               → RHYTHM ONLY             (periodic tick; carries no authority, only cadence)
 *   Workflow           → DURABLE REHEARSAL       (a durable multi-step rehearsal; advisory, resumable)
 *   Workpool           → ATTENTION / SPEND       (bounded concurrency + spend attention)
 *   actions            → EXTERNAL NERVES         (the only path that may touch the outside; bounded, advisory)
 *
 * KERNEL / AUMLOK REMAINS OUTSIDE AND ABOVE CONVEX. This adapter holds no key, signs nothing, and grants no
 * authority; owner/authority verification is injected from the kernel/AUMLOK layer, never performed here. The
 * same contract is implemented by a LOCAL_DEV Convex deployment and by convex-test — they are semantic twins.
 */
import type { ReceiptChainVerdict } from '@aukora/kernel/evidence';
import type { ReactiveMemoryStore, BrainSnapshot, IngestVerdict, ForgetVerdict } from './reactiveStore.js';
import type { RecallQuery, RecallHit } from '@aukora/memory';

export type ConvexRole =
  | 'sense'            // reactive query
  | 'atomic-reflex'    // mutation
  | 'delayed-impulse'  // scheduled function
  | 'rhythm'           // cron
  | 'durable-rehearsal'// workflow
  | 'attention-spend'  // workpool
  | 'external-nerve';  // action

/** The deliberate, documented mapping. A test pins it so the vocabulary can't silently drift. */
export const CONVEX_ROLE_MAP: Readonly<Record<string, ConvexRole>> = {
  'reactive-query': 'sense',
  'mutation': 'atomic-reflex',
  'scheduled-function': 'delayed-impulse',
  'cron': 'rhythm',
  'workflow': 'durable-rehearsal',
  'workpool': 'attention-spend',
  'action': 'external-nerve',
};

/** Where authority lives — NEVER in this adapter; always outside/above, in the kernel/AUMLOK layer. */
export const AUTHORITY_LOCATION = 'kernel/AUMLOK (outside and above Convex)' as const;

/**
 * The read-only face of the brain (SENSES): reactive reads only. Safe for the Spatial shell to poll.
 * A sense NEVER writes and NEVER grants authority.
 */
export interface BrainSenses {
  /** reactive query → shared state */
  snapshot(): BrainSnapshot;
  /** reactive query → chain verdict (fail-closed when corrupt) */
  health(): ReceiptChainVerdict;
  /** reactive query → recall (forgotten never surfaced) */
  recall(query: RecallQuery): RecallHit[];
}

/**
 * The write face (ATOMIC REFLEXES): each is one atomic receipt-writing reflex. Owner verification for a forget
 * reflex is INJECTED (kernel/AUMLOK), never held here.
 */
export interface BrainReflexes {
  /** mutation → atomic ingest reflex (receipt-before-row; fail-closed on corrupt store) */
  ingest(record: unknown): IngestVerdict;
  /** mutation → atomic governed-forget reflex (owner verification injected) */
  forget(recordId: string, verifyOwner: () => boolean, at: string): ForgetVerdict;
}

/** Declared-but-not-fired impulses/rhythm/rehearsal/attention/nerves — role descriptors, no side effects here. */
export interface DeclaredReactiveRoles {
  readonly delayedImpulses: readonly string[]; // scheduled-function names (not fired here)
  readonly rhythms: readonly string[];         // cron names (cadence only)
  readonly durableRehearsals: readonly string[];// workflow names
  readonly attentionPools: readonly string[];  // workpool names (concurrency/spend)
  readonly externalNerves: readonly string[];  // action names (bounded external I/O)
}

export interface ReactiveBrainAdapter {
  readonly deployment: 'local-dev' | 'convex-test';
  readonly senses: BrainSenses;
  readonly reflexes: BrainReflexes;
  readonly declared: DeclaredReactiveRoles;
  /** Structurally false — the adapter grants no authority; the kernel/AUMLOK layer is above it. */
  readonly grantsAuthority: false;
}

/** The adapter grants no authority. Constant. */
export function reactiveBrainAdapterGrantsAuthority(): false {
  return false;
}

const DEFAULT_DECLARED: DeclaredReactiveRoles = {
  delayedImpulses: ['memory.staleSweep'],
  rhythms: ['memory.heartbeat'],
  durableRehearsals: ['memory.migrationRehearsal'],
  attentionPools: ['provider.generation'],
  externalNerves: ['provider.nebius'],
};

/**
 * Wrap a ReactiveMemoryStore as a ReactiveBrainAdapter. The SAME factory serves a LOCAL_DEV Convex deployment
 * and convex-test — they are semantic twins (identical role mapping, identical sense/reflex surface), differing
 * only by the `deployment` label. Senses are read-only; reflexes are atomic; authority stays outside/above.
 */
export function reactiveBrainAdapter(
  store: ReactiveMemoryStore,
  deployment: 'local-dev' | 'convex-test',
  declared: DeclaredReactiveRoles = DEFAULT_DECLARED,
): ReactiveBrainAdapter {
  return {
    deployment,
    senses: {
      snapshot: () => store.snapshot(),
      health: () => store.health(),
      recall: (query) => store.recall(query),
    },
    reflexes: {
      ingest: (record) => store.ingest(record),
      forget: (recordId, verifyOwner, at) => store.forget(recordId, verifyOwner, at),
    },
    declared,
    grantsAuthority: false,
  };
}
