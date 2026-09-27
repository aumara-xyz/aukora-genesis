// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * AUMLOK owner gate — canonical HYBRID verification (verify-only).
 *
 * The demonstration's Ed25519-only owner fixture is replaced here by the real hybrid AUMLOK authority: the
 * owner authorization is a `SignedPromotionV2` carrying BOTH an Ed25519 and an ML-DSA-65 signature, and it is
 * checked with the kernel's canonical `verifyAumlokPromotionV2` (`@aukora/kernel/authority`,
 * suite `aumlok-ed25519-ml-dsa-65-v1`, mode `software_hybrid`). There is NO Ed25519-only path: a downgraded
 * shape simply fails closed. This module only VERIFIES — it never signs, never mints authority, holds no key.
 *
 * Before trusting the crypto verdict we bind the signature to THIS request: the authorization's proposalHash
 * must equal the proposal's canonical intent id, its draftHash the exact draft bytes, and its rootId the trusted
 * owner root — so a valid signature for one target/draft can never authorize another.
 */
import { verifyAumlokPromotionV2 } from '@aukora/kernel/authority';
import type { AumlokAuthorityRootV2, SignedPromotionV2 } from '@aukora/kernel/schemas';

export const AUMLOK_MODE = 'software_hybrid' as const;

export type OwnerVerdict = { readonly valid: true } | { readonly valid: false; readonly reason: string };

export interface OwnerBinding {
  /** rootId of the trusted owner root the caller expects this authorization to be under. */
  readonly rootId: string;
  /** canonical 64-hex intent id the signature must be bound to. */
  readonly proposalHash: string;
  /** canonical 64-hex draft hash (exact bytes) the signature must be bound to. */
  readonly draftHash: string;
}

/**
 * Verify a hybrid owner authorization against the trusted owner root and the expected intent/draft binding.
 * Total: never throws. Fail-closed on any binding mismatch or any hybrid-signature failure.
 */
export function verifyOwnerPromotion(
  receipt: SignedPromotionV2,
  root: AumlokAuthorityRootV2,
  binding: OwnerBinding,
  nowMs: number,
): OwnerVerdict {
  // Total: `receipt` is untrusted, so even a hostile object with throwing accessors fails CLOSED, never throws.
  try {
    if (root.rootId !== binding.rootId) return { valid: false, reason: 'owner: trusted-root/binding mismatch' };
    if (receipt.authorization.rootId !== binding.rootId) return { valid: false, reason: 'owner: authorization rootId mismatch' };
    if (receipt.authorization.proposalHash !== binding.proposalHash) return { valid: false, reason: 'owner: intent (proposalHash) binding mismatch' };
    if (receipt.authorization.draftHash !== binding.draftHash) return { valid: false, reason: 'owner: draft (draftHash) content binding mismatch' };
    const verdict = verifyAumlokPromotionV2(receipt, root, nowMs);
    if (!verdict.valid) return { valid: false, reason: `owner: hybrid verification failed (${verdict.reason})` };
    return { valid: true };
  } catch {
    return { valid: false, reason: 'owner: malformed authorization' };
  }
}

/** The gate grants no authority by itself — it only verifies the owner's explicit hybrid signature. */
export function aumlokGateGrantsAuthority(): false {
  return false;
}
