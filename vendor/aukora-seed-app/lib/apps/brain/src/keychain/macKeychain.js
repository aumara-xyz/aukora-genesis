// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * macOS Keychain adapter — real OS custody behind the narrow CredentialStoreAdapter seam.
 *
 * Secrets live in the login Keychain via the system `security` CLI (`add/find/delete-generic-password`),
 * namespaced under `aukora:<service>`. Adapter metadata (fingerprint/scope/rotation) is session-held; the
 * durable truth of the secret VALUE is the Keychain itself.
 *
 * NOT exercised by default tests — CI/tests use InMemoryTestAdapter (platform keychain access from tests is
 * unsuitable: it would write to the developer's real login keychain). A manual smoke test is gated behind
 * AUKORA_KEYCHAIN_SMOKE=1 and uses a disposable test credential.
 *
 * Known hazard (recorded for the next hardening round): `security add-generic-password -w <value>` passes the
 * value via argv, which is briefly visible to local process listing. Acceptable for a local single-user dev
 * foundation; the hardening path is the `security -i` stdin protocol.
 */
import { execFileSync } from 'node:child_process';
import { deriveCredentialRef, secretFingerprint, } from './credentialStore.js';
const NAMESPACE = 'aukora:';
function keychainService(service) {
    return `${NAMESPACE}${service}`;
}
export class MacKeychainAdapter {
    kind = 'macos-keychain';
    meta = new Map();
    store(service, account, secret, scope, nowIso) {
        execFileSync('security', ['add-generic-password', '-U', '-s', keychainService(service), '-a', account, '-w', secret], { stdio: 'ignore' });
        const ref = deriveCredentialRef(service, account);
        const m = { ref, service, account, fingerprint: secretFingerprint(secret), scope, createdAt: nowIso, rotatedAt: null, revoked: false };
        this.meta.set(ref, m);
        return m;
    }
    retrieve(ref) {
        const m = this.meta.get(ref);
        if (!m || m.revoked)
            return null;
        try {
            return execFileSync('security', ['find-generic-password', '-s', keychainService(m.service), '-a', m.account, '-w'], { encoding: 'utf8' }).replace(/\n$/, '');
        }
        catch {
            return null;
        }
    }
    rotate(ref, newSecret, nowIso) {
        const m = this.meta.get(ref);
        if (!m || m.revoked)
            return null;
        execFileSync('security', ['add-generic-password', '-U', '-s', keychainService(m.service), '-a', m.account, '-w', newSecret], { stdio: 'ignore' });
        const next = { ...m, fingerprint: secretFingerprint(newSecret), rotatedAt: nowIso };
        this.meta.set(ref, next);
        return next;
    }
    revoke(ref) {
        const m = this.meta.get(ref);
        if (!m)
            return false;
        try {
            execFileSync('security', ['delete-generic-password', '-s', keychainService(m.service), '-a', m.account], { stdio: 'ignore' });
        }
        catch {
            // already absent — revocation still tombstones the metadata
        }
        this.meta.set(ref, { ...m, revoked: true });
        return true;
    }
    metadata(ref) {
        return this.meta.get(ref) ?? null;
    }
    list() {
        return [...this.meta.values()];
    }
}
