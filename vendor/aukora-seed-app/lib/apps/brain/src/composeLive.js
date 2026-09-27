import { SAM4_CONVEX_CONTRACTS } from './spatialContracts.js';
const FN = {
    ...SAM4_CONVEX_CONTRACTS.senses,
    ...SAM4_CONVEX_CONTRACTS.cancellation,
    saveWorkflow: 'workflows:saveWorkflow',
};
/** Fail-closed: the composition only accepts loopback deployment URLs. */
export function assertLoopbackUrl(url) {
    const host = new URL(url).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') {
        throw new Error(`compose_live: refusing non-loopback deployment URL host "${host}" (loopback only)`);
    }
}
/** The ConvexWorkflowStore IO seam over a live loopback client. */
export function liveWorkflowIo(client) {
    return {
        load: async (workflowId) => ((await client.query(FN.workflowState, { workflowId })) ?? null),
        save: async (state, expectedVersion) => (await client.mutation(FN.saveWorkflow, { state, expectedVersion })),
    };
}
/**
 * The door's LIVE backend over the same loopback client. `subscribeSnapshot` is an OPTIONAL further injection:
 * the live wiring passes a Convex WebSocket-client subscription (constructed by the caller — tests/launcher —
 * so this module stays convex-import-free); when absent the door's /events answers 501.
 */
export function liveDoorBackend(client, subscribeSnapshot) {
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
