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
import { ed25519 } from '../../../../../authority/deps/@noble/curves@2.2.0/ed25519.js';
import { ml_dsa65 } from '../../../../../authority/deps/@noble/post-quantum@0.6.1/ml-dsa.js';
import { sha256 } from '../../../../../authority/deps/@noble/hashes@2.2.0/sha2.js';
import { bytesToHex, utf8ToBytes } from '../../../../../authority/deps/@noble/hashes@2.2.0/utils.js';
import { aumlokRootId, aumlokRootIntegrity, canonicalAumlokPromotion } from '../../../../../authority/lib/authority.js';
import { PURPOSE_DOMAINS } from '../../../../../authority/lib/registry.js';
const SUITE = 'aumlok-ed25519-ml-dsa-65-v1';
export class HybridOwnerAdapter {
    edSeed;
    mlSigningKey;
    /** The trusted hybrid authority root the recursion env should carry as `ownerRoot`. */
    root;
    constructor(seedLabel, opts) {
        this.edSeed = sha256(utf8ToBytes(`aukora-owner-ed25519:${seedLabel}`)); // 32-byte deterministic seed
        const mlKeygenSeed = sha256(utf8ToBytes(`aukora-owner-ml-dsa-65:${seedLabel}`)); // 32-byte keygen seed
        const mlKeys = ml_dsa65.keygen(mlKeygenSeed);
        this.mlSigningKey = mlKeys.secretKey;
        const publicKeys = { ed25519: bytesToHex(ed25519.getPublicKey(this.edSeed)), mlDsa65: bytesToHex(mlKeys.publicKey) };
        const rootId = aumlokRootId(publicKeys);
        const base = {
            schema: 'aumlok-authority-root-v2',
            suite: SUITE,
            rootId,
            publicKeys,
            mode: 'software_hybrid',
            createdAt: opts?.createdAt ?? '2026-07-16T00:00:00.000Z',
            expiresAt: opts?.expiresAt ?? null,
            revoked: opts?.revoked ?? false,
        };
        this.root = { ...base, integrity: aumlokRootIntegrity(base) };
    }
    /** Produce a hybrid authorization over an intent/draft binding. Signs Ed25519 + ML-DSA-65 over the canonical payload. */
    authorize(input) {
        const authorization = {
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
