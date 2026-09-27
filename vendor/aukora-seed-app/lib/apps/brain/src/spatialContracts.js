// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Stable READ-ONLY local contracts for Sam 4's shell (the CONSOLE center-pane organ).
 *
 * The shell consumes data shapes, never brain internals — no UI is coupled into brain code. Everything here is
 * read-only and advisory. `source` is the VISIBLE honesty label: `'live'` = projected from a real local store;
 * `'fixture'` = canned demo data, and consumers MUST render that label. Event subscription is a plain
 * listener seam over the store decorator — no vendor client in the contract.
 */
import { ReactiveMemoryStore } from './reactiveStore.js';
import { brainHealthSnapshot } from './healthContract.js';
import { providerTruthTable } from './brainProvider.js';
/**
 * Store decorator that emits events on ingest/forget — the subscription seam. Listener errors are swallowed
 * (an observer can never break a reflex); reads pass straight through.
 */
export class SubscribableMemoryStore extends ReactiveMemoryStore {
    listeners = new Set();
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    emit(event) {
        for (const l of this.listeners) {
            try {
                l(event);
            }
            catch { /* an observer never breaks a reflex */ }
        }
    }
    ingest(record) {
        const verdict = super.ingest(record);
        if (verdict.ok)
            this.emit({ kind: 'ingested', recordId: verdict.recordId });
        return verdict;
    }
    forget(recordId, verifyOwner, at) {
        const verdict = super.forget(recordId, verifyOwner, at);
        if (verdict.ok)
            this.emit({ kind: 'forgotten', recordId });
        return verdict;
    }
}
/** Project a LIVE contract from a real local store. Read-only: reads + subscription only. */
export function liveBrainContract(input) {
    return {
        schema: 'aukora-brain-local-contract-v1',
        source: 'live',
        health: brainHealthSnapshot(input.store, { providerMode: 'deterministic-offline', nodePrintId: input.nodePrintId }),
        kiraCounts: input.kiraCounts ?? { ROOT: 0, UNITE: 0, RISE: 0, GOLD: 0 },
        kiraRefs: input.kiraRefs ?? [],
        providerTruth: providerTruthTable(),
        recall: (query) => input.store.recall(query),
        subscribe: (listener) => input.store.subscribe(listener),
        grantsAuthority: false,
    };
}
/**
 * The STABLE Convex function names Sam 4's console wires to on the LOCAL deployment. Senses are reactive
 * queries (subscribe via the Convex client); the two cancellation reflexes are the only writes exposed, and
 * neither grants authority. Names are contract — renaming any is a breaking change requiring a round.
 */
export const SAM4_CONVEX_CONTRACTS = {
    senses: {
        health: 'memory:health',
        snapshot: 'memory:snapshot',
        recall: 'memory:recall',
        verify: 'memory:verify',
        impulseStatus: 'memory:impulseStatus',
        impulseBudget: 'memory:impulseBudgetRemaining',
        scheduledStatus: 'memory:scheduledStatus',
        rehearsalStatus: 'rehearsal:rehearsalStatus',
        receiptStream: 'rehearsal:receiptStream',
        verifyReceiptEvents: 'rehearsal:verifyReceiptEvents',
        workflowState: 'workflows:loadWorkflow',
        listWorkflows: 'workflows:listWorkflows',
    },
    cancellation: {
        impulse: 'memory:cancelImpulse',
        rehearsal: 'rehearsal:cancelRehearsal',
    },
    grantsAuthority: false,
};
/**
 * The FIXTURE fallback — canned data, VISIBLY labelled (`source: 'fixture'`). It emits nothing and recalls
 * nothing; a consumer that hides the label is out of contract.
 */
export function fixtureBrainContract() {
    const store = new SubscribableMemoryStore();
    return {
        schema: 'aukora-brain-local-contract-v1',
        source: 'fixture',
        health: brainHealthSnapshot(store),
        kiraCounts: { ROOT: 2, UNITE: 1, RISE: 1, GOLD: 1 },
        kiraRefs: [
            { legacyRef: 'fixture#0', kiraClass: 'ROOT', contentHash: '0'.repeat(64) },
            { legacyRef: 'fixture#1', kiraClass: 'GOLD', contentHash: '1'.repeat(64) },
        ],
        providerTruth: providerTruthTable(),
        recall: () => [],
        subscribe: () => () => { },
        grantsAuthority: false,
    };
}
