// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Overnight brick 4 — the store flows the REAL @aukora/kernel `decide()` end-to-end (NO stub), consuming a REAL
 * AUMLOK v2 hybrid-signed promotion. Proves durability of a genuine constitutional consumption: a real
 * authorization is consumed + the receipt head advances + PREPARED effect persisted; a fresh process refuses to
 * reuse it (replay, durable); a forged/expired promotion is refused and NOTHING is persisted. The fixture mirrors
 * the kernel's own reducer.test.ts (fixed seeds → deterministic hybrid signatures).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ed25519 } from '@noble/curves/ed25519.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import {
  PURPOSE_DOMAINS, aumlokRootId, aumlokRootIntegrity, canonicalAumlokPromotion, canonicalBytes, canonicalHash,
  type AumlokAuthorityRootV2, type KernelRequestV1, type PolicyV1, type SignedPromotionV2, type TrustedStateV1,
} from '@aukora/kernel';
import { TrustedStateStore } from '../src/trustedStateStore.js';

const nowMs = 1_735_689_600_000; // 2025-01-01, inside the fixture authorization window
const payloadHash = canonicalHash('proposal-v1');

function fixture(authOver: Partial<{ nonce: string; expiresAt: string; consumptionId: string }> = {}) {
  const edSeed = hexToBytes('11'.repeat(32));
  const mlSeed = hexToBytes('22'.repeat(32));
  const mlKeys = ml_dsa65.keygen(mlSeed);
  const publicKeys = { ed25519: bytesToHex(ed25519.getPublicKey(edSeed)), mlDsa65: bytesToHex(mlKeys.publicKey) };
  const rootId = aumlokRootId(publicKeys);
  const rootBase = { schema: 'aumlok-authority-root-v2', suite: 'aumlok-ed25519-ml-dsa-65-v1', rootId, publicKeys, mode: 'software_hybrid', createdAt: '2024-01-01T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z', revoked: false } as Omit<AumlokAuthorityRootV2, 'integrity'>;
  const root = { ...rootBase, integrity: aumlokRootIntegrity(rootBase) } as AumlokAuthorityRootV2;
  const authorization = { rootId, proposalHash: payloadHash, draftHash: payloadHash, nonce: authOver.nonce ?? 'promotion-1', issuedAt: '2024-12-31T00:00:00.000Z', expiresAt: authOver.expiresAt ?? '2099-01-01T00:00:00.000Z' };
  const message = canonicalAumlokPromotion(authorization as never);
  const receipt = { schema: 'aumlok-signed-promotion-v2', suite: 'aumlok-ed25519-ml-dsa-65-v1', authorization, signatures: { ed25519: bytesToHex(ed25519.sign(message, edSeed)), mlDsa65: bytesToHex(ml_dsa65.sign(message, mlKeys.secretKey, { extraEntropy: false, context: utf8ToBytes(PURPOSE_DOMAINS.aumlokPromotion) })) }, mode: 'software_hybrid' } as SignedPromotionV2;
  const state: TrustedStateV1 = { schema: 'aukora-trusted-state-v1', salama: { active: false, reason: null }, trustedRoots: [root], consumedIds: [], receiptHead: { count: 0, headHash: null } };
  const policy: PolicyV1 = { schema: 'aukora-policy-v1', rules: [{ action: { namespace: 'symbiote', kind: 'source', verb: 'promote' }, resourceNamespace: 'repo', maxRing: 'self-modify', requiresAuthorization: true }], sacred: [{ actionNamespace: 'kernel', actionKind: 'authority', resourceNamespace: 'kernel' }] };
  const request: KernelRequestV1 = { schema: 'aukora-kernel-request-v1', requestId: 'request-1', action: { namespace: 'symbiote', kind: 'source', verb: 'promote' }, resource: { namespace: 'repo', id: 'aukora-symbiote' }, ring: 'self-modify', payloadHash, consumptionId: authOver.consumptionId ?? 'proposal-1', humanClearance: true, authorization: receipt, evidenceRefs: ['tests-green'] };
  return { root, receipt, state, policy, request, policyBytes: canonicalBytes(policy as never) };
}
const effect = { effectId: 'e-real', descriptorKind: 'git-candidate', targetPath: 'apps/x/y.ts', contentHash: 'c'.repeat(64) };

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'aukora-realdecide-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('[LIVE real decide] a genuine AUMLOK v2 promotion consumed through the store, durably', () => {
  it('consumes a real hybrid-signed promotion, advances the head, and persists the prepared effect', () => {
    const f = fixture();
    const store = new TrustedStateStore(dir); store.open(); // no injected decide → the REAL kernel decide()
    const r = store.authorizeAndPrepare({ genesis: f.state, request: f.request, policyBytes: f.policyBytes, effect, nowMs });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.decision.status).toBe('allowed');
      expect(r.record.state.consumedIds).toEqual(['proposal-1']);
      expect(r.record.state.receiptHead.count).toBe(1);
      expect(r.record.prepared).toHaveLength(1);
    }
    store.close();
  });

  it('a FRESH process refuses to reuse the same real promotion → replay (durable across restart)', () => {
    const f = fixture();
    const a = new TrustedStateStore(dir); a.open();
    expect(a.authorizeAndPrepare({ genesis: f.state, request: f.request, policyBytes: f.policyBytes, effect, nowMs }).ok).toBe(true);
    a.close();
    // reopen = a fresh process attaching to the durable trusted state; genesis is ignored (state exists)
    const b = new TrustedStateStore(dir); b.open();
    const replay = b.authorizeAndPrepare({ genesis: f.state, request: { ...f.request, requestId: 'request-2' }, policyBytes: f.policyBytes, effect, nowMs: nowMs + 1 });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.decision.code).toBe('replay');
    expect(b.load(f.state).state.receiptHead.count).toBe(1); // exactly one, not doubled
    b.close();
  });

  it('a FORGED promotion signature is refused (authority_invalid) and NOTHING is persisted', () => {
    const f = fixture();
    const flip = f.receipt.signatures.mlDsa65.startsWith('0') ? '1' : '0';
    const forged = { ...f.receipt, signatures: { ...f.receipt.signatures, mlDsa65: flip + f.receipt.signatures.mlDsa65.slice(1) } } as SignedPromotionV2;
    const store = new TrustedStateStore(dir); store.open();
    const r = store.authorizeAndPrepare({ genesis: f.state, request: { ...f.request, authorization: forged }, policyBytes: f.policyBytes, effect, nowMs });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.decision.code).toBe('authority_invalid');
    expect(store.load(f.state).state.receiptHead.count).toBe(0); // nothing consumed, nothing prepared
    expect(store.load(f.state).prepared).toHaveLength(0);
    store.close();
  });

  it('BOUNDED TTL (via policy/authority): an EXPIRED authorization is refused, nothing persisted', () => {
    const f = fixture({ expiresAt: '2025-06-01T00:00:00.000Z' }); // expires before a far-future now
    const store = new TrustedStateStore(dir); store.open();
    const farFuture = Date.parse('2026-01-01T00:00:00.000Z');
    const r = store.authorizeAndPrepare({ genesis: f.state, request: f.request, policyBytes: f.policyBytes, effect, nowMs: farFuture });
    expect(r.ok).toBe(false);                          // verifyAumlokPromotionV2 rejects an expired authorization
    expect(store.load(f.state).state.receiptHead.count).toBe(0);
    store.close();
  });
});

describe('[structural] Convex/model/Fu cannot mutate the trusted state', () => {
  it('kernel-node imports ONLY node fs/path/os/url/crypto + @aukora/kernel — no Convex, model, memory, or network', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/trustedStateStore.ts', import.meta.url), 'utf8');
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    for (const i of imports) {
      const ok = i.startsWith('node:') || i === '@aukora/kernel';
      expect(ok, `unexpected import "${i}" in the trusted store`).toBe(true);
    }
    // strip comments before the forbidden-term scan — the LAW may NAME Convex/model as what it excludes; the CODE may not.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    expect(code).not.toMatch(/convex|ConvexHttpClient|@aukora\/memory|@aukora\/brain|\bfetch\(/i);
  });
});
