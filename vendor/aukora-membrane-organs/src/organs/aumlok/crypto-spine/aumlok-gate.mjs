// AUKORA ONE · authority/aumlok-gate.mjs — RING 1
//
// THE OWNER GATE. Verify-only, mandatory hybrid, holds no key.
//
// PROVENANCE: ADAPTED from AUKORA-EVOLUTION 🧬 @ 68210d479a35e325eda4e14ac8fba5dc87db979e,
// `apps/seed/src/aumlokGate.ts`, blob sha256
// 658062cb732242e27895ec5493489c5a304030700b41bbfc9b3827730255c6df.
// Adaptation is TypeScript → `.mjs` only: the two `import type` lines are erased
// (types are compile-time in the donor and carry no runtime behaviour), and the
// logic below is line-for-line the donor's. See PROVENANCE.md.
//
// ══ WHAT THIS MODULE IS ══
//
// An owner authorization is a `SignedPromotionV2` carrying BOTH an Ed25519 and an
// ML-DSA-65 signature, checked with the kernel's canonical
// `verifyAumlokPromotionV2` (suite `aumlok-ed25519-ml-dsa-65-v1`, mode
// `software_hybrid`).
//
// **There is NO Ed25519-only path.** A downgraded shape — either signature
// missing or corrupted — fails closed. That property is not asserted here in
// prose; it is proven in `test/authority-aumlok-gate.test.mjs` against the
// kernel's own frozen `negativeMutations`, which mutate exactly one signature
// field and require a refusal.
//
// This module only VERIFIES. It never signs, never mints authority, and holds no
// key. The owner's private halves live in the Keychain (`secure-custody.mjs`) and
// are never read by anything in this repository.
//
// ══ BINDING BEFORE CRYPTO — THE CONFUSED-DEPUTY DEFENCE ══
//
// Before the crypto verdict is trusted, the signature is bound to THIS request:
// the authorization's `proposalHash` must equal this proposal's canonical intent
// id, its `draftHash` the exact draft bytes, and its `rootId` the trusted owner
// root. A valid signature for one target or one draft can therefore never
// authorize another.
//
// The order matters: a caller that checked the crypto first and the binding
// second would still be correct, but every early return here is a refusal, and
// keeping the cheap total comparisons in front means a hostile authorization is
// rejected without the verifier ever being handed attacker-shaped input.
//
// ══ WHAT THIS DOES NOT PROVE ══
//
// A valid verdict says the owner signed THIS intent and THIS draft under a root
// the caller already trusted. It says nothing about whether the change is good,
// whether the root is the right root, or whether the signature was consumed
// before — replay defence is the reference monitor's consume-once ledger, which
// is not in this repository yet (see STATUS.md, BLOCKED).
//
// Nothing calls this module today. It is the gate; the lane that would consult it
// is still BLOCKED. It lands now, proven, so that the lane arrives to a gate that
// already fails closed rather than to a gate written in a hurry beside it.

import { verifyAumlokPromotionV2 } from './authority.js';

/** The one supported mode. Ed25519-only and ML-DSA-only are not modes; they are failures. */
export const AUMLOK_MODE = 'software_hybrid';

/**
 * Verify a hybrid owner authorization against the trusted owner root and the
 * expected intent/draft binding.
 *
 * Total: never throws. `receipt` is untrusted, so even a hostile object with
 * throwing property accessors fails CLOSED rather than propagating. A gate that
 * can be made to throw is a gate that can be made to skip a caller's `if`.
 *
 * @param receipt  the owner's `SignedPromotionV2`
 * @param root     the `AumlokAuthorityRootV2` the caller already trusts
 * @param binding  `{ rootId, proposalHash, draftHash }` this signature must match
 * @param nowMs    caller-supplied time — never read from the clock here, because
 *                 ambient time must not influence a constitutional decision
 */
export function verifyOwnerPromotion(receipt, root, binding, nowMs) {
  try {
    if (root.rootId !== binding.rootId) {
      return { valid: false, reason: 'owner: trusted-root/binding mismatch' };
    }
    if (receipt.authorization.rootId !== binding.rootId) {
      return { valid: false, reason: 'owner: authorization rootId mismatch' };
    }
    if (receipt.authorization.proposalHash !== binding.proposalHash) {
      return { valid: false, reason: 'owner: intent (proposalHash) binding mismatch' };
    }
    if (receipt.authorization.draftHash !== binding.draftHash) {
      return { valid: false, reason: 'owner: draft (draftHash) content binding mismatch' };
    }
    const verdict = verifyAumlokPromotionV2(receipt, root, nowMs);
    if (!verdict.valid) {
      return { valid: false, reason: `owner: hybrid verification failed (${verdict.reason})` };
    }
    return { valid: true };
  } catch {
    return { valid: false, reason: 'owner: malformed authorization' };
  }
}

/** The gate grants no authority by itself — it only verifies the owner's explicit hybrid signature. */
export function aumlokGateGrantsAuthority() {
  return false;
}
