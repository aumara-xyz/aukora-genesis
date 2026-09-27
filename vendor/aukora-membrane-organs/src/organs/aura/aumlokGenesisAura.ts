// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * `aumlok-genesis-aura-v1` — the persistent genesis Aura base (#288, the brick after the #324 echo).
 *
 * The #324 ceremony echo is a TRANSIENT: one success ripple, then gone. This module is the STANDING
 * half of the product requirement: the same day-one silver base pattern must reappear on every
 * refresh/reopen of the same node — reconstructed read-only, without minting an event and without
 * ever requesting a phrase.
 *
 * DERIVATION LAW (verified against the ceremony kernel before this was written): a phrase rotation
 * rewrites ONLY the fingerprint file and appends `receipt.rotations[]` — the authority-root manifest
 * `keyId` and the receipt's `boundAt` are written at bind and never change. The base is therefore
 * derived from EXACTLY those two rotation-stable, content-free, public facts. Nothing that varies
 * with a rotation (fingerprint, salts, rotation count, drand anchors) parameterizes the base — so a
 * rotation may lay the existing transient ripple OVER the base, but can never replace it.
 *
 * PROHIBITED, refusing by construction and by test: phrase words, anchor letters, normalized forms,
 * fingerprints, salts, KDF data, typed input, attempt counts, keys, signatures, audio, scores,
 * tokens, and humanity claims. The packet's field set is CLOSED; unknown fields refuse the whole
 * packet; refusal reasons are categorical and never echo contents. The base is display/evidence only
 * — never authority, never a gate input, never proof of humanity. The visible state is the NAMED
 * word `silver`; the only text beside it is the content-free genesis reference.
 */
import { createHash } from 'crypto';

export const GENESIS_AURA_SCHEMA = 'aumlok-genesis-aura-v1' as const;

const ID_RE = /^[a-z0-9._-]{1,64}$/;
const ALLOWED_KEYS = new Set(['schema', 'rootId', 'genesisRef', 'boundAt']);

export interface GenesisAuraPacket {
  schema: typeof GENESIS_AURA_SCHEMA;
  rootId: string;     // public authority-root id (bind-only; rotation never rewrites it)
  genesisRef: string; // content-free ref derived ONLY from rootId + boundAt (see deriveGenesisRef)
  boundAt: string;    // the original binding instant (bind-only; rotation never rewrites it)
}

export type GenesisAuraRefusal =
  | 'genesis_not_an_object' | 'genesis_wrong_schema' | 'genesis_root_invalid'
  | 'genesis_ref_invalid' | 'genesis_bound_at_invalid' | 'genesis_unknown_field'
  | 'genesis_ref_mismatch';

export type GenesisAuraVerdict =
  | { ok: true; packet: GenesisAuraPacket }
  | { ok: false; refused: GenesisAuraRefusal };

const refuse = (refused: GenesisAuraRefusal): GenesisAuraVerdict => ({ ok: false, refused });

function canonicalIso(at: unknown): string | null {
  if (typeof at !== 'string' || at.length === 0 || at.length > 40) return null;
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/** The genesis reference: a content-free identifier of the ORIGINAL binding, derived only from the
 *  two rotation-stable public facts. Deterministic forever for a given binding — the ref IS the
 *  refresh/rotation-stability property. (Distinct domain string from the transient echo's ref, so
 *  the two families can never collide or be confused.) */
export function deriveGenesisRef(input: { rootId: string; boundAt: string }): string {
  return createHash('sha256')
    .update(`aumlok-genesis-aura-ref:${input.rootId}|${input.boundAt}`)
    .digest('hex').slice(0, 24);
}

/** The acceptance matrix — closed field set, identifier grammar, canonical instant, and the ref
 *  RE-DERIVED and compared (a tampered or transplanted ref refuses; the base cannot be moved to a
 *  different binding). No replay semantics: a STANDING base is re-read every load by design. */
export function validateGenesisAuraPacket(input: unknown): GenesisAuraVerdict {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return refuse('genesis_not_an_object');
  const p = input as Record<string, unknown>;
  for (const k of Object.keys(p)) if (!ALLOWED_KEYS.has(k)) return refuse('genesis_unknown_field');
  if (p.schema !== GENESIS_AURA_SCHEMA) return refuse('genesis_wrong_schema');
  if (typeof p.rootId !== 'string' || !ID_RE.test(p.rootId)) return refuse('genesis_root_invalid');
  if (typeof p.genesisRef !== 'string' || !ID_RE.test(p.genesisRef)) return refuse('genesis_ref_invalid');
  const boundAt = canonicalIso(p.boundAt);
  if (boundAt === null) return refuse('genesis_bound_at_invalid');
  if (p.genesisRef !== deriveGenesisRef({ rootId: p.rootId, boundAt })) return refuse('genesis_ref_mismatch');
  return { ok: true, packet: { schema: GENESIS_AURA_SCHEMA, rootId: p.rootId, genesisRef: p.genesisRef, boundAt } };
}

/** Build the standing base packet from the two stable facts. Refuses rather than guesses. */
export function buildGenesisAuraPacket(input: { rootId: string; boundAt: string }): GenesisAuraVerdict {
  const boundAt = canonicalIso(input.boundAt);
  if (boundAt === null) return refuse('genesis_bound_at_invalid');
  return validateGenesisAuraPacket({
    schema: GENESIS_AURA_SCHEMA,
    rootId: input.rootId,
    genesisRef: deriveGenesisRef({ rootId: input.rootId, boundAt }),
    boundAt,
  });
}

/**
 * Deterministic base-pattern parameters — byte-identical for the same binding across every call,
 * refresh, and rotation (nothing rotation-varying is an input). Bounded renderer-internal floats
 * only; none is ever displayed. The state is the NAMED word `silver`.
 */
export interface GenesisAuraBase {
  state: 'silver';
  /** three standing rings: bounded [0,1) radius jitter + phase, deterministic from the genesisRef */
  rings: Array<{ radius: number; phase: number; weight: number }>;
}

export function genesisAuraParams(packet: GenesisAuraPacket): GenesisAuraBase {
  const seed = createHash('sha256')
    .update(`genesis-aura-base:${packet.rootId}|${packet.genesisRef}`)
    .digest();
  const unit = (i: number) => seed.readUInt16BE(i * 2) / 0x10000;
  return {
    state: 'silver',
    rings: [0, 1, 2].map((i) => ({ radius: unit(i * 3), phase: unit(i * 3 + 1), weight: unit(i * 3 + 2) })),
  };
}

/** The one visible caption: the named state + the content-free genesis reference. No dates, no
 *  counts, no person-derived number — the binding FACT lives in the receipt; the base is display. */
export function genesisAuraCaption(packet: GenesisAuraPacket): string {
  return `silver · genesis ${packet.genesisRef.slice(0, 12)}`;
}
