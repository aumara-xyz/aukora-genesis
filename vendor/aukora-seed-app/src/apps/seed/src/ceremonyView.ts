// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Ceremony UI projection boundary (DISPLAY_ONLY) — the ONE-WAY window from the governed ceremony to a browser/UI.
 *
 * The UI receives ceremony STATE, challenges, PUBLIC fingerprints, verdicts, trace/geometry, and receipt/Merkle
 * references — and nothing else. It never receives signing seeds, private keys, unlock minting, or any authority
 * derived from display state. To keep that boundary provable:
 *   - keys are surfaced only as a short PUBLIC fingerprint (a hash of the public keys), never the keys themselves;
 *   - hashes are surfaced only as short prefixes (< 64 hex), so the view carries no key-shaped material;
 *   - the whole view passes the AURA forbidden-field fence (`assertViewSafe`) — a leak is detectable, not implicit;
 *   - `grantsAuthority:false` is a typed literal: a consumer can mint no authority from what it displays.
 *
 * Pure/in-memory. This module never signs and never touches the owner fixture.
 */
import { canonicalHash } from '@aukora/kernel/canonical';
import type { AumlokAuthorityRootV2 } from '@aukora/kernel/schemas';
import { scanForbiddenKeys, scanForbiddenValues, scanForbiddenAuthorityClaims } from './forbiddenContent.js';
import type { CeremonyOutcome } from './ceremony.js';
import type { AuraGeometry } from './geometry.js';
import type { AumaCapability } from './capabilities.js';

export interface CeremonyView {
  readonly schema: 'aukora-ceremony-view-v1';
  readonly phase: string;
  readonly verdict: 'applied' | 'refused';
  readonly stage: string;
  readonly epoch: number;
  readonly capability: AumaCapability;
  /** A 16-hex hash of the PUBLIC keys — a fingerprint, never a key. */
  readonly ownerFingerprint: string;
  readonly intentPrefix: string;
  readonly gateArgsPrefix: string;
  readonly receiptPrefix: string | null;
  readonly merkleRootPrefix: string | null;
  readonly councilVerdict: 'advisory-pass' | 'advisory-hold' | null;
  readonly geometry: AuraGeometry;
  readonly classification: 'DISPLAY_ONLY';
  readonly advisoryOnly: true;
  readonly grantsAuthority: false;
}

/** Short PUBLIC fingerprint over the owner's PUBLIC hybrid keys (a hash — never the private material). */
export function ownerFingerprint(root: AumlokAuthorityRootV2): string {
  return canonicalHash({ ed25519: root.publicKeys.ed25519, mlDsa65: root.publicKeys.mlDsa65 }).slice(0, 16);
}

const prefix12 = (h: string | null): string | null => (typeof h === 'string' && h.length > 0 ? h.slice(0, 12) : null);

/** Project a ceremony outcome into the display-safe view. Carries only public references — no key material, no
 *  full 64-hex hash, no sandbox content. */
export function toCeremonyView(outcome: CeremonyOutcome, root: AumlokAuthorityRootV2): CeremonyView {
  return {
    schema: 'aukora-ceremony-view-v1',
    phase: outcome.phase,
    verdict: outcome.completed ? 'applied' : 'refused',
    stage: outcome.phase,
    epoch: outcome.challenge.epoch,
    capability: outcome.challenge.capability,
    ownerFingerprint: ownerFingerprint(root),
    intentPrefix: outcome.challenge.intentId.slice(0, 12),
    gateArgsPrefix: outcome.challenge.gateArgsHash.slice(0, 12),
    receiptPrefix: prefix12(outcome.receiptHash),
    merkleRootPrefix: prefix12(outcome.merkleRootHex),
    councilVerdict: outcome.recursion ? outcome.recursion.councilVerdict : null,
    geometry: outcome.geometry,
    classification: 'DISPLAY_ONLY',
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

export type ViewSafety = { readonly safe: true } | { readonly safe: false; readonly leaks: string[] };

/**
 * Prove a view carries NO secret/private material and asserts no authority — the recursive AURA fence over the whole
 * view (keys + values + false-authority content). A safe view is the concrete form of "no authority from display state".
 */
export function assertViewSafe(view: unknown): ViewSafety {
  const leaks = [
    ...scanForbiddenKeys(view),
    ...scanForbiddenValues(view).map((p) => `value@${p}`),
    ...scanForbiddenAuthorityClaims(view).map((p) => `authority@${p}`),
  ];
  return leaks.length ? { safe: false, leaks } : { safe: true };
}

/** HARD: the display projection grants no authority — ever. Constant, by construction. */
export function viewGrantsAuthority(): false {
  return false;
}
