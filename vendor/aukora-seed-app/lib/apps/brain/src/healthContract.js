/**
 * Project a store into the read-only health/snapshot contract. Read-only: calls only `store.health()` and
 * `store.snapshot()`; never mutates. Safe for a UI to poll.
 */
export function brainHealthSnapshot(store, meta = {}) {
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
