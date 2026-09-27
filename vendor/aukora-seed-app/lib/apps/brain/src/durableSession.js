export class DurableWorkflowSession {
    store;
    constructor(store) {
        this.store = store;
    }
    /**
     * HYDRATE-BEFORE-LISTEN: pull the durable truth for the workflow before any machine step runs.
     * Distinguishes backend-unreachable from fail-closed validation of a corrupt durable row.
     */
    async begin(workflowId) {
        try {
            await this.store.hydrate(workflowId);
            return { ok: true };
        }
        catch (err) {
            const validation = /failed validation/.test(String(err));
            return { ok: false, durability: validation ? 'hydration-failure' : 'store-unavailable' };
        }
    }
    /**
     * SETTLE-AFTER-MUTATION: run the sync machine step, then settle. The verdict is 'durable' ONLY when the
     * settle drained every pending save (zero-pending success). A refused/conflicted step is classified from
     * the machine's own reason class WITHOUT settling phantom saves.
     */
    async runMutating(step) {
        const outcome = step();
        if (this.store.pendingCount() === 0) {
            // The step persisted nothing: classify the refusal honestly — nothing to settle, nothing durable.
            const cls = /store-conflict|conflict/.test(outcome.reasonClass) ? 'occ-conflict'
                : /refused|malformed/.test(outcome.reasonClass) ? 'validation-refused'
                    : 'validation-refused';
            return { outcome, durability: cls, settled: null, pendingCount: 0 };
        }
        const settled = await this.store.settle();
        const durability = settled.unavailable.length > 0 ? 'store-unavailable'
            : settled.divergence.length > 0 ? 'settle-divergence'
                : 'durable';
        return {
            outcome,
            durability,
            settled: { pushed: settled.pushed, divergence: settled.divergence, unavailable: settled.unavailable },
            pendingCount: this.store.pendingCount(),
        };
    }
    /** Diagnostic-only: a step WITHOUT settle — exists to make the green-before-settle hazard expressible in tests. */
    stepWithoutSettle(step) {
        const outcome = step();
        return { outcome, durability: 'pending', settled: null, pendingCount: this.store.pendingCount() };
    }
    /** IDEMPOTENT RETRY: re-settle whatever remains pending (after store-unavailable). Safe to call repeatedly. */
    async retrySettle() {
        const settled = await this.store.settle();
        const durability = settled.unavailable.length > 0 ? 'store-unavailable'
            : settled.divergence.length > 0 ? 'settle-divergence'
                : 'durable';
        return { outcome: null, durability, settled: { pushed: settled.pushed, divergence: settled.divergence, unavailable: settled.unavailable }, pendingCount: this.store.pendingCount() };
    }
}
/** The session persists projections through the store; it grants no authority. Constant. */
export function durableSessionGrantsAuthority() {
    return false;
}
