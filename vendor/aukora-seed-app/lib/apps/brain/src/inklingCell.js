// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * InklingCell — R48: the SMALLEST provider/evolution-cell boundary for a private Inkling endpoint.
 * A CONTRACT, not a transport: no default transport exists, no URL is known here, and constructing the cell
 * without an injected transport leaves it PARKED — every call refuses loudly. Laws:
 *   - typed request/response only; anything else refuses at the boundary;
 *   - deadline + caller cancellation (AbortSignal) are mandatory — an unbounded call cannot be expressed;
 *   - the serving identity (model + checkpoint) must be DECLARED by the transport and ECHOED per response;
 *     a response whose identity differs from the declared identity refuses (identity drift = refusal);
 *   - every exchange yields a CONTENT-FREE receipt (hashes + counts + identity — never prompt/completion text);
 *   - NO AUTHORITY: the cell cannot sign, apply, merge, or touch GitHub/main — those verbs do not exist here,
 *     and `inklingGrantsAuthority()` is constant false. Advisory text out, nothing more.
 */
import { canonicalHash } from '../../../../../authority/lib/canonical.js';
export const INKLING_MAX_DEADLINE_MS = 120_000;
/** The cell can never grant authority. Constant. */
export function inklingGrantsAuthority() {
    return false;
}
function receiptFor(req, res, outcome, reason) {
    return {
        kind: 'inkling-receipt-v1',
        requestHash: req ? canonicalHash({ prompt: req.prompt, maxTokens: req.maxTokens }) : '0'.repeat(64),
        responseHash: res ? canonicalHash({ text: res.text }) : null,
        identity: res?.identity ?? null,
        outcome,
        reason,
        promptChars: req?.prompt.length ?? 0,
        completionChars: res?.text.length ?? 0,
        advisoryOnly: true,
        grantsAuthority: false,
    };
}
function validRequest(x) {
    const r = x;
    return r !== null && typeof r === 'object' && r.kind === 'inkling-request-v1'
        && typeof r.prompt === 'string' && r.prompt.length > 0
        && Number.isSafeInteger(r.maxTokens) && r.maxTokens > 0 && r.maxTokens <= 8192
        && Number.isSafeInteger(r.deadlineMs) && r.deadlineMs > 0 && r.deadlineMs <= INKLING_MAX_DEADLINE_MS;
}
export class InklingCell {
    transport;
    /** No transport ⇒ PARKED: every call refuses. The transport is the operator's explicit act. */
    constructor(transport = null) {
        this.transport = transport;
    }
    async call(request, callerSignal) {
        if (!validRequest(request)) {
            return { ok: false, receipt: receiptFor(null, null, 'refused', 'refused: malformed inkling request (typed contract v1)') };
        }
        if (this.transport === null) {
            return { ok: false, receipt: receiptFor(request, null, 'refused', 'refused: no transport injected — the cell is PARKED (no default endpoint exists)') };
        }
        const timeout = AbortSignal.timeout(request.deadlineMs);
        const signal = callerSignal ? AbortSignal.any([timeout, callerSignal]) : timeout;
        try {
            const res = await this.transport.call(request, signal);
            if (res.kind !== 'inkling-response-v1' || typeof res.text !== 'string') {
                return { ok: false, receipt: receiptFor(request, null, 'refused', 'refused: malformed transport response') };
            }
            const want = this.transport.identity;
            if (res.identity.model !== want.model || res.identity.checkpoint !== want.checkpoint || res.identity.endpointClass !== 'private-inkling') {
                return { ok: false, receipt: receiptFor(request, null, 'refused', `refused: identity drift (served ${res.identity.model}@${res.identity.checkpoint}, declared ${want.model}@${want.checkpoint})`) };
            }
            return { ok: true, text: res.text, receipt: receiptFor(request, res, 'ok', null) };
        }
        catch (err) {
            const cancelled = callerSignal?.aborted === true;
            const timedOut = timeout.aborted && !cancelled;
            return {
                ok: false,
                receipt: receiptFor(request, null, cancelled ? 'cancelled' : timedOut ? 'timeout' : 'transport-error', cancelled ? 'cancelled by caller' : timedOut ? `deadline ${request.deadlineMs}ms exceeded` : `transport error: ${String(err).slice(0, 120)}`),
            };
        }
    }
}
