// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Live composition helpers (R37) — wire the running LOCAL self-hosted Convex backend to the seams.
 *
 * `liveWorkflowIo(client)`  → the async IO the ConvexWorkflowStore adapter settles through, backed by a real
 *                             loopback ConvexHttpClient — the REAL composition path for DurableRecursion
 *                             (the caller constructs `new DurableRecursion(new ConvexWorkflowStore(io,
 *                             validateWorkflowState), env)`; the validator is injected by the seed-side wiring,
 *                             never imported here — no package cycle).
 * `liveDoorBackend(client)` → the DoorBackend the loopback projection/control door serves from — LIVE reads
 *                             only, no generated projection file can enter this path.
 *
 * The client must point at the loopback deployment (`http://127.0.0.1:3210`); nothing here may be handed a
 * non-loopback URL (fail-closed check). Zero outbound network by construction — the only permitted external
 * transport in the brain remains the explicitly injected model transport owned by the Fu lane (NebiusTransport
 * seam), which this module does not touch.
 */
import type { WorkflowIo, WorkflowStateLike, StoreSaveResult } from './convexWorkflowStore.js';
import type { DoorBackend } from './localDoor.js';
import { SAM4_CONVEX_CONTRACTS } from './spatialContracts.js';

/**
 * The minimal client face we need (ConvexHttpClient satisfies it) — injected, never constructed here, and
 * addressed by STRING function paths (the stable SAM4_CONVEX_CONTRACTS names), so this module imports nothing
 * from the convex package and the src-level boundary law (Convex confined to convex/) holds.
 */
export interface LoopbackConvexClient {
  query(fn: string, args: Record<string, unknown>): Promise<unknown>;
  mutation(fn: string, args: Record<string, unknown>): Promise<unknown>;
}

const FN = {
  ...SAM4_CONVEX_CONTRACTS.senses,
  ...SAM4_CONVEX_CONTRACTS.cancellation,
  saveWorkflow: 'workflows:saveWorkflow',
} as const;

/** Fail-closed: the composition only accepts loopback deployment URLs. */
export function assertLoopbackUrl(url: string): void {
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`compose_live: refusing non-loopback deployment URL host "${host}" (loopback only)`);
  }
}

/** The ConvexWorkflowStore IO seam over a live loopback client. */
export function liveWorkflowIo(client: LoopbackConvexClient): WorkflowIo {
  return {
    load: async (workflowId) => ((await client.query(FN.workflowState, { workflowId })) ?? null) as WorkflowStateLike | null,
    save: async (state, expectedVersion) => (await client.mutation(FN.saveWorkflow, { state, expectedVersion })) as StoreSaveResult,
  };
}

/**
 * The door's LIVE backend over the same loopback client. `subscribeSnapshot` is an OPTIONAL further injection:
 * the live wiring passes a Convex WebSocket-client subscription (constructed by the caller — tests/launcher —
 * so this module stays convex-import-free); when absent the door's /events answers 501.
 */
export function liveDoorBackend(
  client: LoopbackConvexClient,
  subscribeSnapshot?: (onChange: (snapshot: unknown) => void) => () => void,
): DoorBackend {
  return {
    health: () => client.query(FN.health, {}),
    snapshot: () => client.query(FN.snapshot, {}),
    workflow: (workflowId) => client.query(FN.workflowState, { workflowId }).then((s) => s ?? null),
    listWorkflows: (phase) => client.query(FN.listWorkflows, phase ? { phase } : {}),
    recall: (text) => client.query(FN.recall, { text }),
    receiptStream: (rehearsalKey) => client.query(FN.receiptStream, rehearsalKey ? { rehearsalKey } : {}),
    cancelRehearsal: (key) => client.mutation(FN.rehearsal, { key }),
    cancelImpulse: (impulseId) => client.mutation(FN.impulse, { impulseId }),
    subscribeSnapshot,
  };
}
