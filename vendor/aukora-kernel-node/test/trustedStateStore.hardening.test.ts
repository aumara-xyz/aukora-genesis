// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Overnight brick 6 — constitutional hardening through the store (real `decide()`): a paused root (salama),
 * a revoked authority root, and corrupt/unknown store schemas all refuse and PERSIST NOTHING. Same genuine
 * AUMLOK v2 hybrid fixture as brick 4.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ed25519 } from '@noble/curves/ed25519.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import {
  PURPOSE_DOMAINS, aumlokRootId, aumlokRootIntegrity, canonicalAumlokPromotion, canonicalBytes, canonicalHash,
  type AumlokAuthorityRootV2, type KernelRequestV1, type PolicyV1, type SignedPromotionV2, type TrustedStateV1,
} from '@aukora/kernel';
import { TrustedStateStore, TrustedStoreCorruptError, STORE_SCHEMA_VERSION } from '../src/trustedStateStore.js';

const nowMs = 1_735_689_600_000;
const payloadHash = canonicalHash('proposal-v1');
function fixture(over: { salama?: boolean; revoked?: boolean } = {}) {
  const edSeed = hexToBytes('11'.repeat(32)); const mlSeed = hexToBytes('22'.repeat(32));
  const mlKeys = ml_dsa65.keygen(mlSeed);
  const publicKeys = { ed25519: bytesToHex(ed25519.getPublicKey(edSeed)), mlDsa65: bytesToHex(mlKeys.publicKey) };
  const rootId = aumlokRootId(publicKeys);
  const rootBase = { schema: 'aumlok-authority-root-v2', suite: 'aumlok-ed25519-ml-dsa-65-v1', rootId, publicKeys, mode: 'software_hybrid', createdAt: '2024-01-01T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z', revoked: over.revoked ?? false } as Omit<AumlokAuthorityRootV2, 'integrity'>;
  const root = { ...rootBase, integrity: aumlokRootIntegrity(rootBase) } as AumlokAuthorityRootV2;
  const authorization = { rootId, proposalHash: payloadHash, draftHash: payloadHash, nonce: 'promotion-1', issuedAt: '2024-12-31T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z' };
  const message = canonicalAumlokPromotion(authorization as never);
  const receipt = { schema: 'aumlok-signed-promotion-v2', suite: 'aumlok-ed25519-ml-dsa-65-v1', authorization, signatures: { ed25519: bytesToHex(ed25519.sign(message, edSeed)), mlDsa65: bytesToHex(ml_dsa65.sign(message, mlKeys.secretKey, { extraEntropy: false, context: utf8ToBytes(PURPOSE_DOMAINS.aumlokPromotion) })) }, mode: 'software_hybrid' } as SignedPromotionV2;
  const state: TrustedStateV1 = { schema: 'aukora-trusted-state-v1', salama: { active: over.salama ?? false, reason: over.salama ? 'paused' : null }, trustedRoots: [root], consumedIds: [], receiptHead: { count: 0, headHash: null } };
  const policy: PolicyV1 = { schema: 'aukora-policy-v1', rules: [{ action: { namespace: 'symbiote', kind: 'source', verb: 'promote' }, resourceNamespace: 'repo', maxRing: 'self-modify', requiresAuthorization: true }], sacred: [{ actionNamespace: 'kernel', actionKind: 'authority', resourceNamespace: 'kernel' }] };
  const request: KernelRequestV1 = { schema: 'aukora-kernel-request-v1', requestId: 'request-1', action: { namespace: 'symbiote', kind: 'source', verb: 'promote' }, resource: { namespace: 'repo', id: 'aukora-symbiote' }, ring: 'self-modify', payloadHash, consumptionId: 'proposal-1', humanClearance: true, authorization: receipt, evidenceRefs: ['tests-green'] };
  return { state, request, policyBytes: canonicalBytes(policy as never) };
}
const effect = { effectId: 'e-h', descriptorKind: 'git-candidate', targetPath: 'a/b.ts', contentHash: 'c'.repeat(64) };

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'aukora-harden-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('[LIVE real decide] constitutional refusals persist nothing', () => {
  it('SALAMA active → refused (salama_active); no consumption, no prepare', () => {
    const f = fixture({ salama: true });
    const s = new TrustedStateStore(dir); s.open();
    const r = s.authorizeAndPrepare({ genesis: f.state, request: f.request, policyBytes: f.policyBytes, effect, nowMs });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.decision.code).toBe('salama_active');
    expect(s.load(f.state).state.receiptHead.count).toBe(0);
    expect(s.load(f.state).prepared).toHaveLength(0);
    s.close();
  });

  it('REVOKED root → refused; no consumption, no prepare', () => {
    const f = fixture({ revoked: true });
    const s = new TrustedStateStore(dir); s.open();
    const r = s.authorizeAndPrepare({ genesis: f.state, request: f.request, policyBytes: f.policyBytes, effect, nowMs });
    expect(r.ok).toBe(false);                          // a revoked root cannot authorize
    expect(s.load(f.state).state.receiptHead.count).toBe(0);
    s.close();
  });
});

describe('schema migration + corruption fail closed', () => {
  it('an UNKNOWN store schema refuses on load (migration required, never silently trusted)', () => {
    const f = fixture();
    writeFileSync(join(dir, 'trusted-state.json'), JSON.stringify({ storeSchema: STORE_SCHEMA_VERSION + 999, state: f.state, prepared: [] }));
    const s = new TrustedStateStore(dir); s.open();
    expect(() => s.load(f.state)).toThrow(TrustedStoreCorruptError);
    s.close();
  });

  it('an UNPARSEABLE trusted-state file refuses on load (never read as empty/allowed)', () => {
    writeFileSync(join(dir, 'trusted-state.json'), '{ this is not json');
    const s = new TrustedStateStore(dir); s.open();
    expect(() => s.load(fixture().state)).toThrow(TrustedStoreCorruptError);
    s.close();
  });

  it('a structurally-invalid trusted state (unsorted consumedIds) refuses on load via the kernel validator', () => {
    const f = fixture();
    const bad = { ...f.state, consumedIds: ['zzz', 'aaa'] }; // not sorted → kernel assertTrustedState refuses
    writeFileSync(join(dir, 'trusted-state.json'), JSON.stringify({ storeSchema: STORE_SCHEMA_VERSION, state: bad, prepared: [] }));
    const s = new TrustedStateStore(dir); s.open();
    expect(() => s.load(f.state)).toThrow();            // fail-closed on a forged/corrupt durable row
    s.close();
  });
});
