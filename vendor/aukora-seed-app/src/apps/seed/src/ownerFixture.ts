// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Out-of-band owner custody — DEMO / TEST FIXTURE ONLY.
 *
 * A real owner supplies the hybrid secret keys out-of-band and they never enter this repository; here they are
 * derived deterministically from a fixture label so demos and tests reproduce byte-for-byte. This fixture is the
 * ONLY thing that signs, and it lives OUTSIDE the recursion runtime: `runGovernedRecursion` and the AUMLOK gate
 * never import it. That separation is the concrete form of "no runtime may self-sign" — signing is an out-of-band
 * owner act, verification is the machine's job.
 *
 * It builds a canonical AUMLOK authority root (hybrid Ed25519 + ML-DSA-65) and produces `SignedPromotionV2`
 * authorizations bound to an intent/draft. The signature payload and context are exactly what the kernel's
 * `verifyAumlokPromotionV2` expects.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { aumlokRootId, aumlokRootIntegrity, canonicalAumlokPromotion } from '@aukora/kernel/authority';
import { PURPOSE_DOMAINS } from '@aukora/kernel/registries';
import type { AumlokAuthorityRootV2, PromotionAuthorizationV2, SignedPromotionV2 } from '@aukora/kernel/schemas';

const SUITE = 'aumlok-ed25519-ml-dsa-65-v1' as const;

export interface AuthorizeInput {
  /** canonical 64-hex intent id being authorized. */
  readonly proposalHash: string;
  /** canonical 64-hex draft hash (exact bytes) being authorized. */
  readonly draftHash: string;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string | null;
}

export interface OwnerRootOptions {
  readonly createdAt?: string;
  readonly expiresAt?: string | null;
  readonly revoked?: boolean;
}

export class HybridOwnerAdapter {
  private readonly edSeed: Uint8Array;
  private readonly mlSigningKey: Uint8Array;
  /** The trusted hybrid authority root the recursion env should carry as `ownerRoot`. */
  readonly root: AumlokAuthorityRootV2;

  constructor(seedLabel: string, opts?: OwnerRootOptions) {
    this.edSeed = sha256(utf8ToBytes(`aukora-owner-ed25519:${seedLabel}`)); // 32-byte deterministic seed
    const mlKeygenSeed = sha256(utf8ToBytes(`aukora-owner-ml-dsa-65:${seedLabel}`)); // 32-byte keygen seed
    const mlKeys = ml_dsa65.keygen(mlKeygenSeed);
    this.mlSigningKey = mlKeys.secretKey;
    const publicKeys = { ed25519: bytesToHex(ed25519.getPublicKey(this.edSeed)), mlDsa65: bytesToHex(mlKeys.publicKey) };
    const rootId = aumlokRootId(publicKeys);
    const base = {
      schema: 'aumlok-authority-root-v2' as const,
      suite: SUITE,
      rootId,
      publicKeys,
      mode: 'software_hybrid' as const,
      createdAt: opts?.createdAt ?? '2026-07-16T00:00:00.000Z',
      expiresAt: opts?.expiresAt ?? null,
      revoked: opts?.revoked ?? false,
    };
    this.root = { ...base, integrity: aumlokRootIntegrity(base) };
  }

  /** Produce a hybrid authorization over an intent/draft binding. Signs Ed25519 + ML-DSA-65 over the canonical payload. */
  authorize(input: AuthorizeInput): SignedPromotionV2 {
    const authorization: PromotionAuthorizationV2 = {
      rootId: this.root.rootId,
      proposalHash: input.proposalHash,
      draftHash: input.draftHash,
      nonce: input.nonce,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
    };
    const message = canonicalAumlokPromotion(authorization);
    const edSignature = bytesToHex(ed25519.sign(message, this.edSeed));
    const mlSignature = bytesToHex(ml_dsa65.sign(message, this.mlSigningKey, { context: utf8ToBytes(PURPOSE_DOMAINS.aumlokPromotion) }));
    return {
      schema: 'aumlok-signed-promotion-v2',
      suite: SUITE,
      authorization,
      signatures: { ed25519: edSignature, mlDsa65: mlSignature },
      mode: 'software_hybrid',
    };
  }
}
