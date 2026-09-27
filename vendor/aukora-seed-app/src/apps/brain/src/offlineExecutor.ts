// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Reproducible offline executor harness.
 *
 * Runs a node stamped from an `AukoraNodePrintV1` entirely OFFLINE end-to-end: a real ReactiveMemoryStore + the
 * deterministic offline provider + the supervised-generation envelope (bounded by the print's budgets) →
 * advisory output, a sandbox-only PR candidate, a receipt-chained memory, and the read-only health snapshot.
 *
 * Deterministic and reproducible: the same print + seed yields byte-identical output (no clock, no randomness,
 * no network — timestamps are supplied by the seed). FAIL-CLOSED: it runs ONLY the deterministic-offline
 * provider; a print asking for a live (nebius) mode is refused unless its code/image/model hashes are really
 * bound — and even then a live run is out of this harness's scope. No fake digest is ever synthesised.
 */
import { ReactiveMemoryStore } from './reactiveStore.js';
import { DeterministicOfflineProvider } from './brainProvider.js';
import { SupervisedGenerationEnvelope, offlineGenerator, type SupervisedLimits } from './supervisedGeneration.js';
import { brainHealthSnapshot, type BrainHealthSnapshotV1 } from './healthContract.js';
import { nodePrintId, nodePrintDigestsBound, type AukoraNodePrintV1 } from './nodePrint.js';
import type { GitChangeCandidate } from './nebiusProvider.js';
import { buildMemoryRecord } from '@aukora/memory';

export interface OfflineSeed {
  readonly content: string;
  readonly createdAt: string;
  readonly receiptAt: string;
  readonly proposedPatch?: { readonly targetPath: string; readonly diff: string };
}

export interface OfflineNodeRun {
  readonly ok: boolean;
  readonly printId: string;
  readonly refusal?: string;
  readonly advisory?: string;
  readonly candidate?: GitChangeCandidate | null;
  readonly receiptHash?: string;
  readonly health?: BrainHealthSnapshotV1;
}

function limitsFromPrint(print: AukoraNodePrintV1): SupervisedLimits {
  return {
    maxGenerations: print.budgets.maxGenerations,
    maxWallClockMs: print.budgets.maxWallClockMs,
    maxOutputTokens: print.budgets.maxOutputTokens,
    maxCostMicroUsd: print.budgets.maxCostMicroUsd,
    maxPatchBytes: print.budgets.maxPatchBytes,
  };
}

export async function runOfflineNode(print: AukoraNodePrintV1, seed: OfflineSeed): Promise<OfflineNodeRun> {
  const printId = nodePrintId(print);
  // Fail-closed: this harness runs only the offline provider. A live provider mode is refused, and — since no
  // fake digest is ever synthesised — an unbound live print is refused before anything runs.
  if (print.providerMode !== 'deterministic-offline') {
    if (!nodePrintDigestsBound(print)) {
      return { ok: false, printId, refusal: 'fail-closed: live provider mode requires bound code/image/model hashes' };
    }
    return { ok: false, printId, refusal: 'fail-closed: offline executor runs only the deterministic-offline provider' };
  }

  const store = new ReactiveMemoryStore();
  store.ingest(buildMemoryRecord({ content: seed.content, createdAt: seed.createdAt, provenance: 'offline-executor' }));

  const envelope = new SupervisedGenerationEnvelope(offlineGenerator(new DeterministicOfflineProvider()), limitsFromPrint(print));
  const gen = await envelope.run({ prompt: seed.content, proposedPatch: seed.proposedPatch });
  if (!gen.ok) return { ok: false, printId, refusal: gen.refusals[0], health: brainHealthSnapshot(store, { providerMode: print.providerMode, nodePrintId: printId }) };

  // Record the advisory result as a receipt-chained memory (deterministic; content-addressed).
  const receipt = store.ingest(buildMemoryRecord({
    content: `offline-node advisory ${(gen.advisory ?? '').slice(0, 40)}`,
    createdAt: seed.receiptAt,
    kind: 'receipt',
    consent: 'owner-only',
    provenance: 'offline-executor',
  }));

  return {
    ok: true,
    printId,
    advisory: gen.advisory ?? undefined,
    candidate: gen.candidate,
    receiptHash: receipt.ok ? receipt.chainHash : undefined,
    health: brainHealthSnapshot(store, { providerMode: print.providerMode, nodePrintId: printId }),
  };
}
