// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * The pure GATE decision for the device-local AUMLOK approval door — the CSRF perimeter for every
 * authority-bearing endpoint (challenge + approve).
 *
 * PROVENANCE (WAVE 2): ported VERBATIM from the donor `core/src/aumlokApproveGuard.ts` (aukora-symbiote, #105b).
 * No bytes of the decision law changed — the same fail-closed order (off ⇒ lockdown ⇒ host ⇒ origin ⇒
 * sec-fetch-site), the same loopback-host / same-origin discipline. It must refuse unless the door is armed,
 * capability mode is advisory (not lockdown), the request is to this loopback host, and it is same-origin.
 *
 * This is the FIRST membrane the local approve/bind door runs, and it is distinct from (and stricter than) the
 * generic [[doorGuards]] (R38) origin allowlist: this one additionally requires the door to be explicitly ARMED
 * and NOT in lockdown before any owner gesture proceeds. Every refusal is fail-closed and carries no authority;
 * this function signs nothing and reads no key — it only decides whether the owner's own local gesture may proceed.
 */

export interface ApprovalGateInputs {
  readonly enabled: boolean;             // AUKORA_AUMLOK_UI_APPROVE === '1' (the door is ARMED)
  readonly advisory: boolean;            // capability mode is 'advisory' (false ⇒ lockdown)
  readonly host: string | null;         // req host header
  readonly origin: string | null;       // req origin header
  readonly secFetchSite: string | null; // req sec-fetch-site header
  readonly allowedHosts: ReadonlySet<string>;
  readonly allowedOrigins: ReadonlySet<string>;
}

export type ApprovalGateDecision = { readonly ok: true } | { readonly ok: false; readonly status: number; readonly reason: string };

/** A loopback door must only answer to its own loopback authority. A missing Host (HTTP/1.0-style) or a foreign
 *  Host (the hallmark of a DNS-rebinding page pointed at 127.0.0.1) is refused — independent of Origin, so the CSRF
 *  perimeter does not rest on a single header. */
export function hostAllowed(host: string | null, allowedHosts: ReadonlySet<string>): boolean {
  if (!host) return false;
  return allowedHosts.has(host);
}

/** A cross-origin page cannot pass this: if an Origin is present it must be one of ours. A no-Origin local request
 *  (curl) is not blocked here — it still cannot approve without the unguessable, single-use phrase. */
export function originAllowed(origin: string | null, allowedOrigins: ReadonlySet<string>): boolean {
  if (origin && !allowedOrigins.has(origin)) return false;
  return true;
}

/** Sec-Fetch-Site, when the browser sends it, must be same-origin or none (a top-level/local fetch); a cross-site
 *  or same-site value is refused. Absent (non-browser client) falls through to the other guards. */
export function secFetchSiteAllowed(secFetchSite: string | null): boolean {
  if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') return false;
  return true;
}

/**
 * The single gate that must hold for EVERY authority-bearing endpoint. All paths are 403 refusals. Returns
 * { ok: true } only when the door is armed, not in lockdown, on our loopback host, and same-origin. (Donor law,
 * unchanged; reason strings preserved.)
 */
export function evaluateApprovalGate(inp: ApprovalGateInputs): ApprovalGateDecision {
  if (!inp.enabled) return { ok: false, status: 403, reason: 'local approval is OFF — set AUKORA_AUMLOK_UI_APPROVE=1 and restart this gate to arm it' };
  if (!inp.advisory) return { ok: false, status: 403, reason: 'capability mode is lockdown — approval is disabled' };
  if (!hostAllowed(inp.host, inp.allowedHosts)) return { ok: false, status: 403, reason: 'host not recognized — refused (loopback only)' };
  if (!originAllowed(inp.origin, inp.allowedOrigins)) return { ok: false, status: 403, reason: 'cross-origin request refused' };
  if (!secFetchSiteAllowed(inp.secFetchSite)) return { ok: false, status: 403, reason: 'cross-site request refused' };
  return { ok: true };
}

/** A stable reason CLASS for a gate refusal (for reason-classed receipts) — never leaks request content. */
export function approvalGateReasonClass(inp: ApprovalGateInputs): string {
  if (!inp.enabled) return 'gate:not-armed';
  if (!inp.advisory) return 'gate:lockdown';
  if (!hostAllowed(inp.host, inp.allowedHosts)) return 'gate:host-not-loopback';
  if (!originAllowed(inp.origin, inp.allowedOrigins)) return 'gate:cross-origin';
  if (!secFetchSiteAllowed(inp.secFetchSite)) return 'gate:cross-site';
  return 'gate:ok';
}

/** The gate grants no authority — constant, by construction. */
export function approvalGateGrantsAuthority(): false {
  return false;
}
