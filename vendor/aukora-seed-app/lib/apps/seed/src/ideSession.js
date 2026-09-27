import { AumaIdeEnvelope } from './ideEnvelope.js';
import { scanForbiddenKeys, scanForbiddenValues, scanForbiddenAuthorityClaims } from './forbiddenContent.js';
const MAX_VIEW_ROWS = 100;
const MAX_REFUSAL_LOG = 512;
export class AumaIdeSession {
    env;
    envelope;
    refusalLog = [];
    seq = 0;
    constructor(repo, env) {
        this.env = env;
        this.envelope = new AumaIdeEnvelope(repo);
    }
    log(surface, r, fallback) {
        const entry = r ?? fallback;
        if (!entry || !entry.reasonClass || !entry.text)
            return;
        this.seq += 1;
        this.refusalLog.push({ seq: this.seq, surface, reasonClass: entry.reasonClass, text: entry.text, path: r?.path });
        if (this.refusalLog.length > MAX_REFUSAL_LOG)
            this.refusalLog.shift();
    }
    // ── inspect ──────────────────────────────────────────────────────────────
    list(dir) {
        const out = this.envelope.list(dir);
        for (const r of out.refusals)
            this.log('read', r);
        return out;
    }
    read(path) {
        const out = this.envelope.read(path);
        if (!out.ok)
            this.log('read', out.refusal);
        return out;
    }
    search(root, query) {
        const out = this.envelope.search(root, query);
        for (const r of out.refusals)
            this.log('search', r);
        return out;
    }
    // ── cite ─────────────────────────────────────────────────────────────────
    recall(query) {
        return this.envelope.recall(this.env.store, query);
    }
    // ── draft / rehearse / stage ─────────────────────────────────────────────
    draft(input) {
        const out = this.envelope.draft(input);
        if (!out.ok && out.refusal)
            this.log('draft', out.refusal);
        return out;
    }
    rehearse(proposal, auth) {
        const out = this.envelope.rehearse(this.env, proposal, auth);
        if (!out.accepted)
            this.log('rehearse', { reasonClass: out.stage, text: out.refusals.join('; ') || out.stage, path: proposal.targetPath });
        return out;
    }
    stageBranchCandidate(drafts, explanation) {
        const out = this.envelope.stageBranchCandidate(this.env, drafts, explanation);
        if (!out.ok)
            this.log('stage', out.refusal);
        return out;
    }
    // ── evidence surfaces ────────────────────────────────────────────────────
    /** Every refusal this session witnessed — stable classes, quotable text, bounded. */
    refusals() {
        return this.refusalLog.slice();
    }
    /** DISPLAY-ONLY receipt view over the session store: prefixes + kinds only, chain verified, fence-clean. */
    receiptView() {
        const store = this.env.store;
        const chain = store.chain();
        const snap = store.snapshot();
        const start = Math.max(0, chain.length - MAX_VIEW_ROWS);
        const rows = chain.slice(start).map((e, i) => {
            const payload = e.payload;
            return {
                index: start + i,
                kind: typeof payload.kind === 'string' ? payload.kind.slice(0, 24) : 'unknown',
                chainHashPrefix: e.chainHash.slice(0, 12),
                prevHashPrefix: e.prevHash ? e.prevHash.slice(0, 12) : null,
            };
        });
        const view = {
            schema: 'aukora-receipt-view-v1',
            chainLength: chain.length,
            chainValid: store.verifyChain().valid,
            merkleRootPrefix: snap.merkleRootHex ? snap.merkleRootHex.slice(0, 12) : null,
            rows,
            classification: 'DISPLAY_ONLY',
            advisoryOnly: true,
            grantsAuthority: false,
        };
        // Fence-audit the view itself — a display surface must never leak forbidden material.
        const leaks = [...scanForbiddenKeys(view), ...scanForbiddenValues(view), ...scanForbiddenAuthorityClaims(view)];
        if (leaks.length > 0) {
            return { ...view, rows: [], chainLength: view.chainLength, classification: 'DISPLAY_ONLY' };
        }
        return view;
    }
}
/** The IDE session grants no authority — constant, by construction. */
export function ideSessionGrantsAuthority() {
    return false;
}
