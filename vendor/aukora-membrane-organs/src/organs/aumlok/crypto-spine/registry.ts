// LOCAL STUB (AUMLOK-SPINE-UNBLOCK-v0) — NOT @aukora/kernel parity.
// See LIMITS.md. Values satisfy TypeScript imports used by authority.ts / schema.ts /
// hybrid-signer only. PURPOSE_DOMAINS.aumlokPromotion is the one string documented in
// docs/swarm/patches/integr-I3/RECONCILIATION.md and hybrid-signer comments.

/** ML-DSA context domains used by local crypto-spine. */
export const PURPOSE_DOMAINS = {
  /** Documented: hybrid-signer + RECONCILIATION — owner promotion ML-DSA context. */
  aumlokPromotion: "aumlok-promotion-v2",
  /**
   * Receipt-head ML-DSA context. RECONCILIATION names the membrane receipt domain as
   * `aukora-membrane-receipt-v1` (distinct from aumlok-promotion-v2). Not a kernel export —
   * local fill so authority.ts resolves.
   */
  receiptHead: "aukora-membrane-receipt-v1",
} as const;

/**
 * Schema name tokens for schema.ts string compares. LOCAL-ONLY names (v0 prefix) so a
 * real @aukora/kernel document cannot be silently accepted under a false identity.
 */
export const KERNEL_SCHEMAS = {
  policy: "local-kernel-policy-v0",
  request: "local-kernel-request-v0",
  state: "local-kernel-state-v0",
  receiptDraft: "local-kernel-receipt-draft-v0",
  result: "local-kernel-result-v0",
} as const;

/**
 * Ring ladder for schema ring includes(). Donor RINGS list is not on this machine —
 * three ordinal rings as a minimal closed set. NOT claimed equal to aukora-one.
 */
export const RINGS = ["0", "1", "2"] as const;
export type Ring = (typeof RINGS)[number];
