import { buildMemoryRecord } from '../../../packages/memory/index.js';
import { RUNNER_CEILINGS } from './councilRunnerBoundary.js';
export const envProviderArm = {
    armed: () => (typeof process !== 'undefined' && process.env ? process.env.AUKORA_FU_ARMED === '1' : false),
};
/** A fixed arm state (for tests / explicit owner control). */
export function fixedArm(value) {
    return { armed: () => value };
}
/** Durable spend account — the caller persists `dayToDateUsd`; ceilings are the frozen runner ceilings. */
export class DurableSpendAccount {
    day;
    pass = 0;
    constructor(dayToDateUsd = 0) {
        this.day = Number.isFinite(dayToDateUsd) && dayToDateUsd > 0 ? dayToDateUsd : 0;
    }
    get dayToDateUsd() {
        return this.day;
    }
    get passUsd() {
        return this.pass;
    }
    beginPass() {
        this.pass = 0;
    }
    /** Would adding `usd` breach the per-pass or per-day ceiling? (Checked before a call — fail-closed.) */
    wouldExceed(usd) {
        const cost = Number.isFinite(usd) && usd > 0 ? usd : 0;
        return this.pass + cost > RUNNER_CEILINGS.perPassUsd || this.day + cost > RUNNER_CEILINGS.perDayUsd;
    }
    /** Book actual spend to both the pass and the durable day total. */
    record(usd) {
        const cost = Number.isFinite(usd) && usd > 0 ? usd : 0;
        this.pass += cost;
        this.day += cost;
    }
}
/**
 * Wrap an inner live transport so every call is owner-armed, ceiling-guarded, and content-free-receipted. A disarmed
 * or over-ceiling call returns a benign non-vote and never dispatches. Content-free: only metadata is receipted.
 */
export function armedEgressTransport(inner, opts) {
    let seq = 0;
    const receipts = [];
    const nowIso = opts.nowIso ?? new Date(0).toISOString();
    const emit = (seat, phase, model, status, bytes) => {
        seq += 1;
        const ing = opts.store.ingest(buildMemoryRecord({
            content: `provider-egress · seq=${seq} · seat=${seat.id} · phase=${phase} · model=${model} · status=${status} · bytes=${bytes}`,
            createdAt: nowIso, kind: 'receipt', consent: 'owner-only', provenance: 'provider-egress',
        }));
        receipts.push({ seq, seatId: seat.id, phase, model, status, bytes, receiptHash: ing.ok ? ing.chainHash : null });
    };
    const t = async (seat, prompt, phase, signal) => {
        const model = seat.slug;
        if (!opts.arm.armed()) {
            emit(seat, phase, model, 'refused-disarmed', 0);
            return { text: '', served: undefined };
        }
        if (opts.spend && opts.perCallEstimateUsd !== undefined && opts.spend.wouldExceed(opts.perCallEstimateUsd)) {
            emit(seat, phase, model, 'refused-ceiling', 0);
            return { text: '', served: undefined };
        }
        const res = await inner(seat, prompt, phase, signal);
        const cost = typeof res.costUsd === 'number' ? res.costUsd : 0;
        if (opts.spend)
            opts.spend.record(cost);
        emit(seat, phase, model, 'called', typeof res.text === 'string' ? res.text.length : 0);
        return res;
    };
    // expose the receipt log for tests/audit via a property on the function
    t.egressReceipts = () => receipts.slice();
    return t;
}
/** HARD: the egress wrapper gates and audits; it never mints authority. Constant, by construction. */
export function providerEgressGrantsAuthority() {
    return false;
}
