// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Read-only health/snapshot contract for the Spatial shell.
 *
 * A stable, UI-AGNOSTIC data shape the Spatial shell (or any consumer) reads to render node health — WITHOUT
 * coupling any UI into brain code. This module imports no view layer; it only projects the store's existing
 * read-only `health()` + `snapshot()` into a versioned contract. It performs NO mutation and grants no authority.
 */
import type { ReactiveMemoryStore, BrainSnapshot } from './reactiveStore.js';
import type { ProviderMode } from './brainProvider.js';

export interface BrainHealthV1 {
  /** Canonical chain verdict — false means the store is corrupt and fail-closed. */
  readonly ok: boolean;
  readonly breakIndex: number | null;
  readonly headHash: string | null;
  readonly chainLength: number;
}

export interface BrainHealthSnapshotV1 {
  readonly schema: 'aukora-brain-health-v1';
  readonly health: BrainHealthV1;
  readonly snapshot: BrainSnapshot;
  readonly providerMode: ProviderMode | null;
  readonly nodePrintId: string | null;
  /** Structurally false — a health read grants no authority. */
  readonly grantsAuthority: false;
}

export interface HealthSnapshotMeta {
  readonly providerMode?: ProviderMode;
  readonly nodePrintId?: string;
}

/**
 * Project a store into the read-only health/snapshot contract. Read-only: calls only `store.health()` and
 * `store.snapshot()`; never mutates. Safe for a UI to poll.
 */
export function brainHealthSnapshot(store: ReactiveMemoryStore, meta: HealthSnapshotMeta = {}): BrainHealthSnapshotV1 {
  const verdict = store.health();
  const snapshot = store.snapshot();
  return {
    schema: 'aukora-brain-health-v1',
    health: { ok: verdict.valid, breakIndex: verdict.breakIndex, headHash: verdict.headHash, chainLength: snapshot.chainLength },
    snapshot,
    providerMode: meta.providerMode ?? null,
    nodePrintId: meta.nodePrintId ?? null,
    grantsAuthority: false,
  };
}
