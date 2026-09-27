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
import {
  deriveCredentialRef,
  secretFingerprint,
  type CredentialMetadata,
  type CredentialStoreAdapter,
  type CredentialRef,
} from './credentialStore.js';

const NAMESPACE = 'aukora:';

function keychainService(service: string): string {
  return `${NAMESPACE}${service}`;
}

export class MacKeychainAdapter implements CredentialStoreAdapter {
  readonly kind = 'macos-keychain' as const;
  private readonly meta = new Map<CredentialRef, CredentialMetadata>();

  store(service: string, account: string, secret: string, scope: string, nowIso: string): CredentialMetadata {
    execFileSync('security', ['add-generic-password', '-U', '-s', keychainService(service), '-a', account, '-w', secret], { stdio: 'ignore' });
    const ref = deriveCredentialRef(service, account);
    const m: CredentialMetadata = { ref, service, account, fingerprint: secretFingerprint(secret), scope, createdAt: nowIso, rotatedAt: null, revoked: false };
    this.meta.set(ref, m);
    return m;
  }

  retrieve(ref: CredentialRef): string | null {
    const m = this.meta.get(ref);
    if (!m || m.revoked) return null;
    try {
      return execFileSync('security', ['find-generic-password', '-s', keychainService(m.service), '-a', m.account, '-w'], { encoding: 'utf8' }).replace(/\n$/, '');
    } catch {
      return null;
    }
  }

  rotate(ref: CredentialRef, newSecret: string, nowIso: string): CredentialMetadata | null {
    const m = this.meta.get(ref);
    if (!m || m.revoked) return null;
    execFileSync('security', ['add-generic-password', '-U', '-s', keychainService(m.service), '-a', m.account, '-w', newSecret], { stdio: 'ignore' });
    const next: CredentialMetadata = { ...m, fingerprint: secretFingerprint(newSecret), rotatedAt: nowIso };
    this.meta.set(ref, next);
    return next;
  }

  revoke(ref: CredentialRef): boolean {
    const m = this.meta.get(ref);
    if (!m) return false;
    try {
      execFileSync('security', ['delete-generic-password', '-s', keychainService(m.service), '-a', m.account], { stdio: 'ignore' });
    } catch {
      // already absent — revocation still tombstones the metadata
    }
    this.meta.set(ref, { ...m, revoked: true });
    return true;
  }

  metadata(ref: CredentialRef): CredentialMetadata | null {
    return this.meta.get(ref) ?? null;
  }

  list(): readonly CredentialMetadata[] {
    return [...this.meta.values()];
  }
}
