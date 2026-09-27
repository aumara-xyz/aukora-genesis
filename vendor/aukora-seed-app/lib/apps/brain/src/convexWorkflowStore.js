// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * ConvexWorkflowStore — the local self-hosted Convex implementation of Sam 3's `WorkflowStore` contract
 * (apps/seed/src/durableRecursion.ts). The missing convergence seam, R36.
 *
 * The machine's contract is SYNCHRONOUS (`load`/`save`), but a real backend is async — so this adapter is a
 * spec-faithful CACHE FACADE around an injected async IO seam:
 *
 *     await store.hydrate(workflowId);   // pull the durable state into the cache
 *     machine.propose(...) / complete(...) / cancel(...)   // sync steps against the cache (spec-identical
 *                                                          // semantics to InMemoryWorkflowStore)
 *     await store.settle();              // push accepted saves through the OCC mutation — durability point
 *
 * Laws:
 *   - the injected `validate` (the REAL `validateWorkflowState` from the seed lane — injected to avoid a
 *     package cycle, never cloned) runs before ANY save is accepted; a malformed or authority-claiming state is
 *     refused and never reaches Convex;
 *   - OCC is enforced twice: in the cache (mirroring the executable spec) and authoritatively by the
 *     `saveWorkflow` mutation; a server-side conflict (another writer) surfaces from `settle()` as
 *     `divergence`, and the cache is re-hydrated so the loser defers to the winner;
 *   - PROJECTIONS ONLY cross this seam — no authorization, signature, key, or proposal content exists in the
 *     state shape, and the kernel/AUMLOK gate re-verifies everything outside Convex;
 *   - a crash between a machine step and `settle()` loses only the UNSETTLED projection — exactly the
 *     reconciliation case the durable machine already handles honestly on restart.
 *
 * The same class serves convex-test (io backed by `t.query`/`t.mutation`) and the live local deployment
 * (io backed by `ConvexHttpClient` against `http://127.0.0.1:<port>` — loopback only).
 */
export class ConvexWorkflowStore {
    io;
    validate;
    cache = new Map();
    pending = [];
    constructor(io, validate) {
        this.io = io;
        this.validate = validate;
    }
    /** Pull the durable state for a workflow into the cache (call before running machine steps). */
    async hydrate(workflowId) {
        const state = await this.io.load(workflowId);
        if (state === null) {
            this.cache.delete(workflowId);
            return null;
        }
        const valid = this.validate(state);
        if (valid === null)
            throw new Error(`convex_workflow_store: durable row for ${workflowId.slice(0, 12)}… failed validation (fail-closed)`);
        this.cache.set(workflowId, valid);
        return valid;
    }
    /** SYNC load — spec-identical to InMemoryWorkflowStore over the hydrated cache. */
    load(workflowId) {
        return this.cache.get(workflowId) ?? null;
    }
    /** SYNC save — validate (full injected law) + OCC against the cache, then queue the durable push. */
    save(state, expectedVersion) {
        const valid = this.validate(state);
        if (valid === null)
            return { ok: false, reason: 'refused' };
        const current = this.cache.get(valid.workflowId)?.version ?? 0;
        if (current !== expectedVersion || valid.version !== current + 1)
            return { ok: false, reason: 'conflict' };
        this.cache.set(valid.workflowId, valid);
        this.pending.push({ state: valid, expectedVersion });
        return { ok: true };
    }
    /** Push queued saves through the authoritative OCC mutation. The durability point. */
    async settle() {
        const divergence = [];
        const unavailable = [];
        let pushed = 0;
        while (this.pending.length > 0) {
            // R50 fix (Fugu falsification): PEEK, don't shift — an io THROW (backend unreachable) must leave the
            // item pending so a retry settle() pushes it. Before this fix the item was shifted first and a transient
            // outage silently dropped the save (green cache, nothing durable).
            const { state, expectedVersion } = this.pending[0];
            let result;
            try {
                result = await this.io.save(state, expectedVersion);
            }
            catch {
                unavailable.push(state.workflowId);
                break; // stop the drain; order is preserved for the retry
            }
            this.pending.shift();
            if (result.ok) {
                pushed += 1;
                continue;
            }
            // Another writer won server-side (or the row was refused there): defer to the durable truth.
            divergence.push(state.workflowId);
            await this.hydrate(state.workflowId);
        }
        return { ok: divergence.length === 0 && unavailable.length === 0, pushed, divergence, unavailable };
    }
    /** Unsettled saves lost on a crash — the machine's restart reconciliation handles these honestly. */
    pendingCount() {
        return this.pending.length;
    }
}
/** The store persists projections; it grants no authority. Constant. */
export function convexWorkflowStoreGrantsAuthority() {
    return false;
}
