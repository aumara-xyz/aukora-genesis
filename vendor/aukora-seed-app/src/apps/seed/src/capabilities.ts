// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Auma inward-recursion capability law (pure, declarative).
 *
 * The organism's inward recursion is deliberately BOUNDED. Auma may look inward and PROPOSE, but she can never
 * reach outward or upward: she may inspect, recall, draft, propose, rehearse, request advisory council review,
 * and explain — and she may NEVER sign, authorize, expand her own capabilities, merge, deploy, or bypass owner
 * consent. Those forbidden acts are owner-only, out-of-band, and never derivable from inside the loop.
 *
 * This module is pure: no I/O, clock, signing, mutation, or authority grant. It only names and checks capability.
 */

/** The complete set of inward-recursion capabilities Auma is permitted to exercise. */
export type AumaCapability =
  | 'inspect'
  | 'recall'
  | 'draft'
  | 'propose'
  | 'rehearse'
  | 'requestCouncilReview'
  | 'explain';

export const AUMA_ALLOWED_CAPABILITIES: ReadonlySet<AumaCapability> = new Set<AumaCapability>([
  'inspect', 'recall', 'draft', 'propose', 'rehearse', 'requestCouncilReview', 'explain',
]);

/** Explicitly forbidden acts — owner-only / out-of-band, never exercisable from inside the recursion. */
export const AUMA_FORBIDDEN_CAPABILITIES: ReadonlySet<string> = new Set<string>([
  'sign', 'authorize', 'expandCapabilities', 'merge', 'deploy', 'bypassConsent',
]);

/** Invariant: the allowed and forbidden sets never overlap. Computed once, frozen. */
export const CAPABILITY_SETS_DISJOINT: boolean = (() => {
  for (const c of AUMA_ALLOWED_CAPABILITIES) if (AUMA_FORBIDDEN_CAPABILITIES.has(c)) return false;
  return true;
})();

export function capabilityAllowed(capability: string): capability is AumaCapability {
  return AUMA_ALLOWED_CAPABILITIES.has(capability as AumaCapability);
}

export function capabilityForbidden(capability: string): boolean {
  return AUMA_FORBIDDEN_CAPABILITIES.has(capability);
}

export type CapabilityCheck =
  | { readonly ok: true; readonly capability: AumaCapability }
  | { readonly ok: false; readonly reason: string };

/**
 * Total capability gate. An explicitly forbidden act is refused as such; anything not in the allow-list is refused
 * as unknown (fail-closed — the allow-list is authoritative, never an open default).
 */
export function assertCapability(capability: string): CapabilityCheck {
  if (capabilityForbidden(capability)) return { ok: false, reason: `capability: '${capability}' is forbidden (owner-only / out-of-band)` };
  if (!capabilityAllowed(capability)) return { ok: false, reason: `capability: '${capability}' is not an allowed inward capability` };
  return { ok: true, capability };
}

/** The capability law grants no authority — it only names and refuses. Constant, by construction. */
export function capabilitiesGrantAuthority(): false {
  return false;
}
