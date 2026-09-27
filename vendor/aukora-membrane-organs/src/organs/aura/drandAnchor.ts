// core/aura/drandAnchor.ts — φ DOES NOT CARRY THE BEACON. IT REFUSES IT.
//
// ══ A DELIBERATE REDUCTION FROM THE DONOR, NOT A PORT ══
//
// `core/aura/auraTrace.ts` is a faithful port of symbiote 9a950afc. That module
// calls `verifyDrandRound` in two places, and in the donor it is real: BLS12-381
// signature verification against a pinned drand public key
// (`core/src/drandAnchor.ts`, 6,591 bytes).
//
// Porting it would add `@noble/curves` and `@noble/hashes` to φ, which today has
// no `@noble` at all — a pairing-curve dependency pulled in by the lane that
// draws a figure. That is a `package.json` change and a new cryptographic
// dependency, for a code path nothing in φ currently produces.
//
// ══ SO IT REFUSES, RATHER THAN PRETENDING ══
//
// `verifyDrandRound` returns `false`, always. Read the two call sites before
// deciding whether that is a weakening — it is the opposite:
//
//   auraTrace.ts:146   if (!verifyDrandRound(...)) return fail('trace_drand_unverified')
//   auraTrace.ts:221   if (!verifyDrandRound(...)) return refuse('trace_drand_unverified')
//
// The drand block is OPTIONAL (`if (drand !== null)`), so an epoch that carries
// no beacon is built and validated exactly as the donor builds and validates it.
// An epoch that DOES carry one is refused as `trace_drand_unverified` instead of
// being accepted on an unchecked signature.
//
// A stub that returned `true` would be the actual weakening, and it is the one
// someone reaches for when the tests go red. This returns false so that the only
// way to make drand-anchored epochs work in φ is to port the real verifier —
// which is a decision with a dependency attached, and therefore the owner's.
//
// STATUS: drand anchoring is BLOCKED in φ, not implemented and not claimed.

/**
 * Always false. See the header — φ has no pinned-key verifier, so it cannot
 * verify a beacon round, and "cannot verify" must never render as "verified".
 */
export function verifyDrandRound(_round: number, _signature: string): boolean {
  return false;
}
