/** The deliberate, documented mapping. A test pins it so the vocabulary can't silently drift. */
export const CONVEX_ROLE_MAP = {
    'reactive-query': 'sense',
    'mutation': 'atomic-reflex',
    'scheduled-function': 'delayed-impulse',
    'cron': 'rhythm',
    'workflow': 'durable-rehearsal',
    'workpool': 'attention-spend',
    'action': 'external-nerve',
};
/** Where authority lives — NEVER in this adapter; always outside/above, in the kernel/AUMLOK layer. */
export const AUTHORITY_LOCATION = 'kernel/AUMLOK (outside and above Convex)';
/** The adapter grants no authority. Constant. */
export function reactiveBrainAdapterGrantsAuthority() {
    return false;
}
const DEFAULT_DECLARED = {
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
export function reactiveBrainAdapter(store, deployment, declared = DEFAULT_DECLARED) {
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
