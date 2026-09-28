// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Local credential custody — the smallest safe foundation for issue #30.
 *
 * Custody stays LOCAL and is exposed only through this NARROW adapter seam:
 *   - `CredentialRef` is OPAQUE: derived from the credential's identity (service+account), never from the secret —
 *     a ref carries zero secret material and is safe in logs, Git, memory records, and model context.
 *   - Metadata carries a domain-separated FINGERPRINT (canonical hash — reuse, not clone), scope, and rotation
 *     state; `list()`/`metadata()` never return secret values.
 *   - The broker CONTRACT is loopback-only (127.0.0.1) — validated, fail-closed.
 *   - Revocation deletes the secret and tombstones the metadata.
 *   - Logging goes through `redactForLog`, which masks both known stored values and anything the canonical
 *     @aukora/evidence secret scanner detects.
 *
 * RAW SECRETS ARE NEVER STORED in Git, Convex, browser state, Aukora memory, receipts, model context, or
 * fixtures — the only holders are the OS credential store (MacKeychainAdapter) or the in-memory test double
 * (disposable test credentials only). No credential grants authority by existing; AUMLOK stays above.
 */
import { canonicalHash } from '../../../../../../authority/lib/canonical.js';
import { scanForSecrets } from '../../../../packages/evidence/src/index.js';
export function deriveCredentialRef(service, account) {
    return `secref:v1:${canonicalHash({ domain: 'aukora-keychain-ref-v1', service, account }).slice(0, 16)}`;
}
/** Fingerprint of a secret value: domain-separated canonical hash. A fingerprint is metadata, never a key. */
export function secretFingerprint(secret) {
    return canonicalHash({ domain: 'aukora-keychain-fp-v1', secret });
}
/** In-memory TEST DOUBLE — used where platform keychain access is unsuitable (CI/tests). Disposable creds only. */
export class InMemoryTestAdapter {
    kind = 'test-double';
    vault = new Map();
    meta = new Map();
    store(service, account, secret, scope, nowIso) {
        const ref = deriveCredentialRef(service, account);
        const m = { ref, service, account, fingerprint: secretFingerprint(secret), scope, createdAt: nowIso, rotatedAt: null, revoked: false };
        this.vault.set(ref, secret);
        this.meta.set(ref, m);
        return m;
    }
    retrieve(ref) {
        const m = this.meta.get(ref);
        if (!m || m.revoked)
            return null;
        return this.vault.get(ref) ?? null;
    }
    rotate(ref, newSecret, nowIso) {
        const m = this.meta.get(ref);
        if (!m || m.revoked)
            return null;
        const next = { ...m, fingerprint: secretFingerprint(newSecret), rotatedAt: nowIso };
        this.vault.set(ref, newSecret);
        this.meta.set(ref, next);
        return next;
    }
    revoke(ref) {
        const m = this.meta.get(ref);
        if (!m)
            return false;
        this.vault.delete(ref); // the secret is GONE
        this.meta.set(ref, { ...m, revoked: true }); // tombstoned metadata remains
        return true;
    }
    metadata(ref) {
        return this.meta.get(ref) ?? null;
    }
    list() {
        return [...this.meta.values()];
    }
}
/** Fail-closed broker-config validation. Any non-loopback binding is a violation. */
export function validateBrokerConfig(c) {
    const v = [];
    if (c === null || typeof c !== 'object')
        return ['config_not_object'];
    const o = c;
    if (o.schema !== 'aukora-keychain-broker-v1')
        v.push('schema_invalid');
    if (o.host !== '127.0.0.1')
        v.push('broker_must_bind_loopback_only');
    if (typeof o.port !== 'number' || !Number.isInteger(o.port) || o.port < 1024 || o.port > 65535)
        v.push('port_invalid');
    if (!Array.isArray(o.allowedScopes) || !o.allowedScopes.every((s) => typeof s === 'string' && s.length > 0))
        v.push('allowed_scopes_invalid');
    if (o.grantsAuthority !== false)
        v.push('grants_authority_must_be_false');
    return v;
}
// ── Redacted logging ───────────────────────────────────────────────────────────────────────────────────────
/**
 * Redact a log line: masks every span the canonical @aukora/evidence scanner detects, plus every literal
 * `knownValues` occurrence (values the caller knows are secrets, e.g. just-stored ones). Refs and metadata
 * pass through untouched — they carry no secret material by construction.
 */
export function redactForLog(line, knownValues = []) {
    let out = line;
    for (const value of knownValues) {
        if (value.length > 0)
            out = out.split(value).join('[REDACTED]');
    }
    const matches = scanForSecrets(out);
    for (let i = matches.length - 1; i >= 0; i--) {
        out = out.slice(0, matches[i].start) + '[REDACTED]' + out.slice(matches[i].end);
    }
    return out;
}
/** The keychain grants no authority. Constant. */
export function keychainGrantsAuthority() {
    return false;
}
