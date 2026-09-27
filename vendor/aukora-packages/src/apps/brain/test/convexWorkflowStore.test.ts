// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/// <reference types="vite/client" />
/**
 * ConvexWorkflowStore (R36) — the local self-hosted Convex implementation of Sam 3's WorkflowStore contract.
 *
 * Proven here, all under convex-test (headless simulated Convex — the LIVE local-deployment proof is in
 * docs/LOCAL_DEV_EVIDENCE.md):
 *   - spec PARITY: the adapter behaves exactly like InMemoryWorkflowStore (the contract's executable spec)
 *     for create / version bump / OCC conflict / malformed refusal — using the REAL seed validator;
 *   - the REAL DurableRecursion machine (Sam 3's, unmodified) runs over this adapter end-to-end: idempotent
 *     propose, owner-gated complete (authority verified OUTSIDE the store), at-most-once apply, cancellation;
 *   - projections only: the persisted row carries no authorization/signature/key/content, and tampering a row
 *     (e.g. flipping ownerVerified) decides nothing — the gate re-verifies from scratch.
 *
 * The seed lane is reached by RELATIVE import (test-only) to avoid a package cycle; the validator and machine
 * are REUSED, never cloned.
 */
import { convexTest } from 'convex-test';
import { describe, it, expect } from 'vitest';
import schema from '../convex/schema';
import { api } from '../convex/_generated/api';
import { ConvexWorkflowStore, convexWorkflowStoreGrantsAuthority, type WorkflowIo } from '../src/index.js';
import {
  DurableRecursion, InMemoryWorkflowStore, validateWorkflowState, deriveWorkflowId, deriveIntentId, deriveDraftHash,
  type WorkflowStateV1,
} from '../../seed/src/index.js';
import { makeWorld, makeProposal, authFor } from '../../seed/test/support.js';
import { canonicalHash } from '@aukora/kernel/canonical';

const modules = import.meta.glob('../convex/**/*.*s');

function ioFor(t: ReturnType<typeof convexTest>): WorkflowIo {
  return {
    load: async (workflowId) => (await t.query(api.workflows.loadWorkflow, { workflowId })) ?? null,
    save: async (state, expectedVersion) => await t.mutation(api.workflows.saveWorkflow, { state, expectedVersion }),
  };
}

const hex = (s: string) => canonicalHash({ s });
function validState(over: Record<string, unknown> = {}) {
  return {
    schema: 'aukora-recursion-workflow-v1', workflowId: hex('wf'), version: 1, phase: 'awaiting-owner',
    intentId: hex('intent'), draftHash: hex('draft'), nonce: 'wf-1', councilVerdict: 'advisory-pass',
    councilEvidenceDigest: hex('evidence'), stage: 'refused-owner-gate', refusals: [], receiptHash: null,
    ownerVerified: false, createdAtIso: '2026-07-16T12:00:00.000Z', updatedAtIso: '2026-07-16T12:00:00.000Z',
    advisoryOnly: true, grantsAuthority: false, ...over,
  };
}

describe('ConvexWorkflowStore — spec parity with InMemoryWorkflowStore (real validator)', () => {
  it('create, load, version bump, OCC conflict, and malformed refusal match the executable spec', async () => {
    const t = convexTest(schema, modules);
    const convexStore = new ConvexWorkflowStore(ioFor(t), validateWorkflowState);
    const spec = new InMemoryWorkflowStore();
    const s1 = validState();

    // identical verdicts, step by step
    expect(convexStore.save(s1 as never, 0)).toEqual(spec.save(s1 as never, 0));               // create ok
    expect(convexStore.save(s1 as never, 0)).toEqual(spec.save(s1 as never, 0));               // duplicate create → conflict
    const s2 = validState({ version: 2, phase: 'applied', receiptHash: hex('receipt') });
    expect(convexStore.save(s2 as never, 1)).toEqual(spec.save(s2 as never, 1));               // bump ok
    expect(convexStore.save(validState({ version: 5 }) as never, 9)).toEqual(spec.save(validState({ version: 5 }) as never, 9)); // bad OCC → conflict
    const malformed = validState({ grantsAuthority: true });
    expect(convexStore.save(malformed as never, 2)).toEqual(spec.save(malformed as never, 2)); // authority claim → refused
    expect(convexStore.load(s1.workflowId as string)?.version).toBe(spec.load(s1.workflowId as string)?.version);

    // durability point: settle pushes; a fresh adapter hydrates the same durable truth
    const settle = await convexStore.settle();
    expect(settle.ok).toBe(true);
    expect(settle.pushed).toBe(2);
    const fresh = new ConvexWorkflowStore(ioFor(t), validateWorkflowState);
    const rehydrated = (await fresh.hydrate(s1.workflowId as string)) as WorkflowStateV1 | null;
    expect(rehydrated?.version).toBe(2);
    expect(rehydrated?.phase).toBe('applied');
    expect(convexWorkflowStoreGrantsAuthority()).toBe(false);
  });

  it('listWorkflows serves current projections (most recent first, phase-filterable, bounded)', async () => {
    const t = convexTest(schema, modules);
    const store = new ConvexWorkflowStore(ioFor(t), validateWorkflowState);
    store.save(validState() as never, 0);
    store.save(validState({ workflowId: hex('wf2'), nonce: 'wf-2', phase: 'applied', receiptHash: hex('r2') }) as never, 0);
    await store.settle();
    const all = (await t.query(api.workflows.listWorkflows, {})) as { workflowId: string }[];
    expect(all.length).toBe(2);
    const applied = (await t.query(api.workflows.listWorkflows, { phase: 'applied' })) as { phase: string }[];
    expect(applied.length).toBe(1);
    expect(applied[0].phase).toBe('applied');
    const bounded = (await t.query(api.workflows.listWorkflows, { limit: 1 })) as unknown[];
    expect(bounded.length).toBe(1);
  });

  it('server-side OCC is authoritative: a stale writer diverges on settle and defers to the winner', async () => {
    const t = convexTest(schema, modules);
    const winner = new ConvexWorkflowStore(ioFor(t), validateWorkflowState);
    const loser = new ConvexWorkflowStore(ioFor(t), validateWorkflowState);
    const s1 = validState();
    winner.save(s1 as never, 0);
    await winner.settle();
    await loser.hydrate(s1.workflowId as string);
    // both write version 2; winner settles first
    winner.save(validState({ version: 2, stage: 'refused-owner-gate' }) as never, 1);
    loser.save(validState({ version: 2, phase: 'cancelled' }) as never, 1);
    expect((await winner.settle()).ok).toBe(true);
    const lost = await loser.settle();
    expect(lost.ok).toBe(false);
    expect(lost.divergence).toEqual([s1.workflowId]);
    expect((loser.load(s1.workflowId as string) as WorkflowStateV1 | null)?.stage).toBe('refused-owner-gate'); // deferred to the winner
  });
});

describe('the REAL DurableRecursion machine over the Convex adapter (reuse, not clone)', () => {
  it('idempotent propose → owner-gated complete → at-most-once apply → durable across a machine restart', async () => {
    const t = convexTest(schema, modules);
    const w = makeWorld();
    const store = new ConvexWorkflowStore(ioFor(t), validateWorkflowState);
    const machine = new DurableRecursion(store as never, w.env);
    const p = makeProposal();
    const wfId = deriveWorkflowId(deriveIntentId(p), deriveDraftHash(p), 'r36-wf');

    const first = machine.propose(p, 'r36-wf');
    expect(first.ok).toBe(true);
    expect(first.state?.phase).toBe('awaiting-owner');
    await store.settle(); // durability point

    // "restart": a FRESH adapter + FRESH machine hydrate the durable projection — idempotent, no duplication
    const store2 = new ConvexWorkflowStore(ioFor(t), validateWorkflowState);
    await store2.hydrate(wfId);
    const machine2 = new DurableRecursion(store2 as never, w.env);
    const resumed = machine2.propose(p, 'r36-wf');
    expect(resumed.ok).toBe(true);
    expect(resumed.state?.version).toBe(1); // nothing re-written
    expect(resumed.state?.councilEvidenceDigest).toBe(first.state?.councilEvidenceDigest);

    // owner-gated complete: authority verified by the kernel gate OUTSIDE the store
    const done = machine2.complete(p, wfId, authFor(w.owner, p, { nonce: 'r36-wf' }));
    expect(done.ok).toBe(true);
    expect(done.state?.phase).toBe('applied');
    await store2.settle();

    // at-most-once: completing again is a terminal no-op
    const again = machine2.complete(p, wfId, authFor(w.owner, p, { nonce: 'r36-wf' }));
    expect(again.reasonClass).toBe('workflow:already-terminal');

    // the durable row is a PROJECTION carrying no authorization material
    const row = await t.query(api.workflows.loadWorkflow, { workflowId: wfId });
    expect(row?.phase).toBe('applied');
    const dump = JSON.stringify(row);
    for (const forbidden of ['signature', 'publicKey', 'secret', 'authorization']) expect(dump).not.toContain(forbidden);
  });

  it('cancellation persists; tampering the durable row decides nothing (gate re-verifies outside Convex)', async () => {
    const t = convexTest(schema, modules);
    const w = makeWorld();
    const store = new ConvexWorkflowStore(ioFor(t), validateWorkflowState);
    const machine = new DurableRecursion(store as never, w.env);
    const p = makeProposal();
    const wfId = deriveWorkflowId(deriveIntentId(p), deriveDraftHash(p), 'r36-cancel');
    machine.propose(p, 'r36-cancel');
    const cancelled = machine.cancel(wfId);
    expect(cancelled.state?.phase).toBe('cancelled');
    await store.settle();

    // tamper the projection directly in the store: flip ownerVerified on a fresh awaiting workflow
    const p2 = makeProposal({ id: 'p-tamper' });
    const wfId2 = deriveWorkflowId(deriveIntentId(p2), deriveDraftHash(p2), 'r36-tamper');
    machine.propose(p2, 'r36-tamper');
    await store.settle();
    await t.run(async (ctx) => {
      const row = await ctx.db.query('workflows').withIndex('by_workflowId', (q: any) => q.eq('workflowId', wfId2)).first();
      await ctx.db.patch(row!._id, { ownerVerified: true }); // lie in the projection
    });
    const store2 = new ConvexWorkflowStore(ioFor(t), validateWorkflowState);
    await store2.hydrate(wfId2);
    const machine2 = new DurableRecursion(store2 as never, w.env);
    const done = machine2.complete(p2, wfId2 /* NO authorization */);
    // the gate re-verified from scratch: NOT accepted, NOT applied — the lying projection decided nothing.
    expect(done.gate?.accepted).toBe(false);
    expect(done.state?.phase).toBe('awaiting-owner'); // deferral, not apply
    expect(done.state?.ownerVerified).toBe(false);    // the machine OVERWROTE the tampered lie
    await store2.settle();
    const durable = await t.query(api.workflows.loadWorkflow, { workflowId: wfId2 });
    expect(durable?.ownerVerified).toBe(false);       // durable truth corrected
  });
});
