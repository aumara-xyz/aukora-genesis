// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Shared test scaffolding for the governed-recursion suite. Not a test file (no `.test.ts`), so vitest does not
 * collect it. Everything here is deterministic and offline.
 */
import { ReactiveMemoryStore } from '../../brain/src/index.js';
import { HybridOwnerAdapter, RecursionLedger, LIMITS, deriveIntentId, deriveDraftHash, } from '../src/index.js';
export const NOW_ISO = '2026-07-16T12:00:00.000Z';
export const NOW_MS = Date.parse(NOW_ISO);
export const TARGET = 'apps/seed/src/recursion.ts';
export const TARGET2 = 'apps/brain/src/reactiveStore.ts';
export function makeProposal(over = {}) {
    return { id: 'p1', targetPath: TARGET, newContent: '// governed refinement to the note', createdAt: NOW_ISO, supersedes: null, ...over };
}
export function makeWorld(o = {}) {
    const store = new ReactiveMemoryStore();
    const owner = new HybridOwnerAdapter(o.ownerLabel ?? 'r29-test', o.ownerRootOpts);
    const ledger = o.ledger ?? new RecursionLedger();
    const nowMs = o.nowMs ?? NOW_MS;
    const env = {
        store,
        knownFiles: new Set(o.knownFiles ?? [TARGET, TARGET2]),
        ownerRoot: owner.root,
        ledger,
        nowMs,
        nowIso: o.nowIso ?? NOW_ISO,
        deadlineMs: o.deadlineMs ?? nowMs + LIMITS.DEFAULT_WALL_TIME_BUDGET_MS,
        review: o.review,
    };
    return { store, owner, ledger, env };
}
/** Produce a real hybrid owner authorization bound (by default) to the given proposal's intent + draft. */
export function authFor(owner, proposal, over = {}) {
    return owner.authorize({
        proposalHash: over.proposalHash ?? deriveIntentId(proposal),
        draftHash: over.draftHash ?? deriveDraftHash(proposal),
        nonce: over.nonce ?? 'nonce-1',
        issuedAt: over.issuedAt ?? NOW_ISO,
        expiresAt: over.expiresAt ?? null,
    });
}
