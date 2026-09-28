// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Door guards (R38, pure) — the loopback door's origin allowlist + local POST token.
 *
 * PROVENANCE: the law (not the secret/custody material) is ported from the donor `core/src/localPostGuard.ts`
 * (aukora-symbiote). A browser page on any origin can fire blind POSTs at localhost; these guards refuse them
 * VISIBLY with stable reason classes so a governed write can only originate from the shell (or an explicitly
 * tokened local tool). No key, no signature, no custody — just origin/referer/token checks.
 *
 * Pure: no I/O, no network, no clock, no authority.
 */
import { bytesToHex } from '../../../../../authority/deps/@noble/hashes@2.2.0/utils.js';
/** A well-formed provisioned POST token: a non-empty string with no whitespace or control characters. */
export function doorTokenIsWellFormed(t) {
    if (typeof t !== 'string' || t.length === 0)
        return false;
    for (let i = 0; i < t.length; i++) {
        const c = t.charCodeAt(i);
        if (c <= 0x20 || c === 0x7f)
            return false; // reject whitespace / control / space characters
    }
    return true;
}
/** Constant-time string equality (length-guarded; total, never throws). */
function constantTimeEqual(a, b) {
    if (a.length !== b.length)
        return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++)
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}
export function headerReader(headers) {
    const lower = {};
    for (const [k, v] of Object.entries(headers))
        if (typeof v === 'string')
            lower[k.toLowerCase()] = v;
    return { get: (name) => lower[name.toLowerCase()] ?? null };
}
function parseOriginFromReferer(referer) {
    try {
        const u = new URL(referer);
        return `${u.protocol}//${u.host}`;
    }
    catch {
        return null;
    }
}
const OK = { ok: true, status: 200, reason: 'guard:ok', text: 'ok' };
const refuse = (status, reason, text) => ({ ok: false, status, reason, text });
/**
 * Check a local POST request. Total: an unknown/unlisted origin, a bad/unlisted referer, a browser request with no
 * origin when disallowed, or a missing/mismatched token each refuse with a stable reason class and a 403.
 */
export function checkDoorGuard(headers, opts) {
    const allowed = new Set(opts.allowedOrigins);
    const origin = headers.get('origin');
    const referer = headers.get('referer');
    const allowNoBrowserOrigin = opts.allowNoBrowserOrigin ?? true;
    if (origin && !allowed.has(origin))
        return refuse(403, 'guard:origin-not-allowed', `refused: origin ${origin} is not in the door allowlist`);
    if (!origin && referer) {
        const refOrigin = parseOriginFromReferer(referer);
        if (!refOrigin)
            return refuse(403, 'guard:bad-referer', 'refused: unparseable Referer');
        if (!allowed.has(refOrigin))
            return refuse(403, 'guard:referer-not-allowed', `refused: referer origin ${refOrigin} is not in the door allowlist`);
    }
    if (!origin && !referer && !allowNoBrowserOrigin)
        return refuse(403, 'guard:no-browser-origin', 'refused: a browser request must carry an allowed Origin');
    // R60 P1 token gate. UNPROVISIONED (undefined) ⇒ skip (origin-only, R38 mode). Anything ELSE is PROVISIONED:
    // a MISPROVISIONED (empty/whitespace/malformed) token fails CLOSED and can never disable authentication — the
    // prior `if (opts.requiredToken)` truthiness let an empty token silently skip the whole check (the fail-open).
    if (opts.requiredToken !== undefined) {
        if (!doorTokenIsWellFormed(opts.requiredToken)) {
            return refuse(503, 'guard:token-misprovisioned', 'refused: POST token is provisioned but malformed (fail-closed)');
        }
        const headerName = opts.tokenHeader ?? 'x-aukora-door-token';
        const presented = headers.get(headerName);
        if (presented === null || !constantTimeEqual(presented, opts.requiredToken)) {
            return refuse(403, 'guard:missing-or-bad-token', 'refused: missing or bad local POST token');
        }
    }
    return OK;
}
/** The door's own loopback origins on a given port. */
export function loopbackOrigins(port) {
    return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
}
/** Mint a per-boot local POST token from OS CSPRNG. Held in memory only; never written to repo/receipts. */
export function newDoorToken() {
    const bytes = new Uint8Array(24);
    globalThis.crypto.getRandomValues(bytes); // Node >=20.19 exposes the Web Crypto global
    return bytesToHex(bytes);
}
/** The guards grant no authority — they only refuse. Constant, by construction. */
export function doorGuardsGrantAuthority() {
    return false;
}
