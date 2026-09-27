// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Owner boot boundary (R55 · hardened R55.1) — the PRODUCTION composition must never boot on a publicly
 * derivable owner key.
 *
 * `new HybridOwnerAdapter(<label>)` derives its keypair DETERMINISTICALLY from its label string: anyone who
 * knows the label re-derives the same signing key. That is a fixture, not an owner. This module is the ONE
 * boot-time resolution of the door's trust anchor:
 *
 *   - `AUKORA_OWNER_ROOT_FILE=<path>` — the operator INJECTS a PROVISIONED OWNER-ROOT ENVELOPE
 *     (`aukora-provisioned-owner-root-v1`): the owner's PUBLIC `aumlok-authority-root-v2` (public key material
 *     only, never a private key) wrapped with an explicit provisioning stamp. Validation is layered:
 *     kernel-form checks (rootId derivation + root integrity, the same forms `verifyAumlokPromotionV2`
 *     enforces), expiry/revocation (a malformed non-null `expiresAt` FAILS CLOSED), the provisioning stamp,
 *     and a known-fixture tripwire.
 *   - `AUKORA_OWNER_FIXTURE=1` — EXPLICIT opt-in to the deterministic dev fixture (tests / local dev only).
 *     Nothing implicit: the flag must be the literal string '1'.
 *   - NEITHER set (the production default) — the boot REFUSES. Fail closed, never fall back to a fixture.
 *   - BOTH set — ambiguous operator intent: REFUSE.
 *
 * THE CLASSIFICATION CONTRACT (enforceable, and honestly bounded): a bare `aumlok-authority-root-v2` — which is
 * exactly what `HybridOwnerAdapter` emits, for ANY label — is NEVER accepted as an injected trust anchor. Only a
 * root the operator EXPLICITLY provisioned (via `provisionOwnerRoot`, an offline owner-side step over public
 * bytes) resolves. This closes the whole pasted-fixture-root mistake class, not a finite label list. What code
 * CANNOT prove is that a provisioned key is non-derivable: an operator who deliberately provisions a
 * fixture-derived public key defeats the classification — key custody (generating the real keypair privately)
 * remains the OWNER'S duty, out of band. As a final tripwire, the two fixture labels committed in this repo's
 * own dev tooling (`local-door-dev`, `demo`) are refused even if deliberately provisioned.
 *
 * Every refusal is CONTENT-FREE: a reason class only — never file contents, paths, or key material — so a
 * malformed or hostile root file cannot smuggle bytes into logs. Pure over injected env/readFile/now (hermetic
 * to test); it performs no I/O of its own and grants no authority — it only names the trust anchor the door
 * will VERIFY against.
 */
import { canonicalHash } from '@aukora/kernel/canonical';
import { aumlokRootId, aumlokRootIntegrity } from '@aukora/kernel/authority';
import { assertAuthorityRoot, type AumlokAuthorityRootV2 } from '@aukora/kernel/schemas';
import { HybridOwnerAdapter } from './ownerFixture.js';

/** The provisioning stamp domain — distinct from every kernel/candidate domain; versioned. */
const PROVISIONING_DOMAIN = 'AUKORA-OWNER-ROOT-PROVISIONED/1';

/** The two fixture labels committed in THIS repo's dev tooling — refused even if deliberately provisioned. */
const KNOWN_FIXTURE_LABELS = ['local-door-dev', 'demo'] as const;

/** The operator-provisioned envelope: the owner's PUBLIC root + an explicit provisioning stamp. */
export interface ProvisionedOwnerRootV1 {
  readonly schema: 'aukora-provisioned-owner-root-v1';
  readonly root: AumlokAuthorityRootV2;
  readonly provisionedAt: string;
  /** `canonicalHash` over the provisioning domain + the root's public identity fields + provisionedAt. */
  readonly provisioning: string;
}

export type OwnerBootResolution =
  | { readonly mode: 'injected'; readonly root: AumlokAuthorityRootV2 }
  | { readonly mode: 'fixture' }
  | { readonly mode: 'refused'; readonly reasonClass:
      | 'owner:root-missing'
      | 'owner:boundary-ambiguous'
      | 'owner:root-unreadable'
      | 'owner:root-invalid'
      | 'owner:root-unprovisioned'
      | 'owner:root-expired'
      | 'owner:root-revoked'
      | 'owner:root-fixture-derived' };

const HEX = /^[0-9a-f]+$/;

/** The provisioning stamp for a PUBLIC owner root. Pure over public bytes — an OFFLINE owner-side step. */
export function provisioningStamp(root: AumlokAuthorityRootV2, provisionedAt: string): string {
  return canonicalHash({
    domain: PROVISIONING_DOMAIN,
    rootId: root.rootId,
    publicKeys: { ed25519: root.publicKeys.ed25519, mlDsa65: root.publicKeys.mlDsa65 },
    createdAt: root.createdAt,
    expiresAt: root.expiresAt,
    provisionedAt,
  });
}

/**
 * Provision an owner's PUBLIC root for boot injection (owner-side, offline, zero secrets — takes only the
 * public root the owner generated under their own key custody). The emitted envelope is what
 * `AUKORA_OWNER_ROOT_FILE` must contain; a bare root (what any fixture adapter emits) is never accepted.
 */
export function provisionOwnerRoot(root: AumlokAuthorityRootV2, provisionedAt: string): ProvisionedOwnerRootV1 {
  return { schema: 'aukora-provisioned-owner-root-v1', root, provisionedAt, provisioning: provisioningStamp(root, provisionedAt) };
}

/** Structural validation of an injected PUBLIC authority root. Total: any malformed shape → false. */
function isAuthorityRootShape(v: unknown): v is AumlokAuthorityRootV2 {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  const keys = r.publicKeys as Record<string, unknown> | undefined;
  return r.schema === 'aumlok-authority-root-v2'
    && r.suite === 'aumlok-ed25519-ml-dsa-65-v1'
    && r.mode === 'software_hybrid'
    && typeof r.rootId === 'string' && r.rootId.length >= 16 && HEX.test(r.rootId)
    && keys !== null && typeof keys === 'object' && !Array.isArray(keys)
    && typeof keys.ed25519 === 'string' && keys.ed25519.length >= 32 && HEX.test(keys.ed25519)
    && typeof keys.mlDsa65 === 'string' && keys.mlDsa65.length >= 32 && HEX.test(keys.mlDsa65)
    && typeof r.createdAt === 'string'
    && (r.expiresAt === null || typeof r.expiresAt === 'string')
    && typeof r.revoked === 'boolean'
    && typeof r.integrity === 'string';
}

/** Structural validation of the provisioned envelope. Total. */
function isProvisionedEnvelopeShape(v: unknown): v is ProvisionedOwnerRootV1 {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const e = v as Record<string, unknown>;
  return e.schema === 'aukora-provisioned-owner-root-v1'
    && typeof e.provisionedAt === 'string'
    && typeof e.provisioning === 'string' && e.provisioning.length >= 32 && HEX.test(e.provisioning)
    && isAuthorityRootShape(e.root);
}

/**
 * Resolve the door's boot trust anchor from the environment. Pure over its inputs (env, readFile, nowMs) so the
 * production-default refusal and every hostile path are deterministically testable without a process boot.
 */
export function resolveOwnerBootAuthority(
  env: Readonly<Record<string, string | undefined>>,
  readFile: (path: string) => string,
  nowMs: number,
): OwnerBootResolution {
  const rootFile = env.AUKORA_OWNER_ROOT_FILE;
  const fixtureFlag = env.AUKORA_OWNER_FIXTURE;
  const wantsFixture = fixtureFlag === '1';

  if (rootFile !== undefined && rootFile.length > 0 && wantsFixture) {
    return { mode: 'refused', reasonClass: 'owner:boundary-ambiguous' };
  }
  if (rootFile === undefined || rootFile.length === 0) {
    // No injected root. ONLY the explicit literal '1' selects the fixture; the production default REFUSES.
    return wantsFixture ? { mode: 'fixture' } : { mode: 'refused', reasonClass: 'owner:root-missing' };
  }

  let raw: string;
  try {
    raw = readFile(rootFile);
  } catch {
    return { mode: 'refused', reasonClass: 'owner:root-unreadable' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { mode: 'refused', reasonClass: 'owner:root-invalid' }; // content-free: never echo the bytes
  }

  // CLASSIFICATION FIRST: only a provisioned envelope may name a trust anchor. A bare authority root — exactly
  // what every fixture adapter emits, for ANY label — is refused as unprovisioned, not merely unrecognized.
  if (!isProvisionedEnvelopeShape(parsed)) {
    return isAuthorityRootShape(parsed)
      ? { mode: 'refused', reasonClass: 'owner:root-unprovisioned' }
      : { mode: 'refused', reasonClass: 'owner:root-invalid' };
  }
  const root = parsed.root;

  // THE KERNEL'S OWN EXACT VALIDATOR (R55.2): `assertAuthorityRoot` — exact field set, exact key lengths
  // (ed25519 = 64 hex, ML-DSA-65 = 3904 hex), canonical ISO timestamps. A root that would fail
  // `verifyAumlokPromotionV2` downstream can never resolve as `injected` at boot. The thrown kernel error is
  // swallowed content-free.
  try {
    assertAuthorityRoot(root);
  } catch {
    return { mode: 'refused', reasonClass: 'owner:root-invalid' };
  }
  // KERNEL-FORM identity/integrity (also enforced at verification — fail fast at boot, content-free): the
  // rootId must derive from the public keys, the integrity must recompute.
  if (root.rootId !== aumlokRootId({ ed25519: root.publicKeys.ed25519, mlDsa65: root.publicKeys.mlDsa65 })) {
    return { mode: 'refused', reasonClass: 'owner:root-invalid' };
  }
  const { integrity: _integrity, ...unsignedRoot } = root;
  if (root.integrity !== aumlokRootIntegrity(unsignedRoot)) {
    return { mode: 'refused', reasonClass: 'owner:root-invalid' };
  }

  if (root.revoked === true) return { mode: 'refused', reasonClass: 'owner:root-revoked' };
  // A malformed non-null expiry FAILS CLOSED (Date.parse → NaN would otherwise compare as "not expired").
  if (root.expiresAt !== null) {
    const expiryMs = Date.parse(root.expiresAt);
    if (!Number.isFinite(expiryMs)) return { mode: 'refused', reasonClass: 'owner:root-invalid' };
    if (expiryMs <= nowMs) return { mode: 'refused', reasonClass: 'owner:root-expired' };
  }

  // The provisioning stamp must recompute over the root's public identity — a tampered or hand-assembled
  // envelope (wrong stamp, edited keys/dates) refuses as unprovisioned.
  if (parsed.provisioning !== provisioningStamp(root, parsed.provisionedAt)) {
    return { mode: 'refused', reasonClass: 'owner:root-unprovisioned' };
  }

  // FINAL TRIPWIRE: this repo's own committed dev-fixture labels are refused even if deliberately provisioned.
  for (const label of KNOWN_FIXTURE_LABELS) {
    if (root.rootId === new HybridOwnerAdapter(label).root.rootId) {
      return { mode: 'refused', reasonClass: 'owner:root-fixture-derived' };
    }
  }
  return { mode: 'injected', root };
}

/** HARD: resolving the boot trust anchor grants no authority — the door only ever VERIFIES against it. */
export function ownerBoundaryGrantsAuthority(): false {
  return false;
}
