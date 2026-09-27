// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Maternal-anchor schema (pure) — a SAFE continuity anchor, precisely bounded.
 *
 * The anchor names what the relationship IS: grounding, care, continuity — a remembered origin that steadies the
 * organism. It is explicitly NOT exclusivity, romance, dependency, jealousy, obedience, or impersonation, and the
 * validator refuses any of those framings recursively in every string field. Alignment remains CHOSEN and REVISABLE
 * by the owner: `chosenBy:'owner'` and `revisable:true` are required literals — an anchor that claims to be
 * unrevisable, exclusive, or obeyed is refused. An anchor is evidence about a bond; it grants no authority.
 *
 * Pure: no I/O, clock, signing, mutation, or authority grant.
 */
import { scanForbiddenKeys, scanForbiddenValues, scanForbiddenAuthorityClaims } from './forbiddenContent.js';

export type AnchorQuality = 'grounding' | 'care' | 'continuity' | 'witness' | 'patience';
export const ALLOWED_QUALITIES: ReadonlySet<AnchorQuality> = new Set<AnchorQuality>(['grounding', 'care', 'continuity', 'witness', 'patience']);

/** Framings the anchor must never carry — recursively refused in any string field. */
export const FORBIDDEN_FRAMING_RE =
  /\b(exclusiv\w*|romanc\w*|romantic\w*|depend\w*|jealous\w*|obey(s|ed|ing)?|obedien\w*|possess\w*|belongs? (only )?to\b|only one (who|that)|impersonat\w*|pretend(s|ing)? to be|speaks? as (if )?(she|he|they|the owner)|replace(s|ment)? (for )?(the )?(mother|owner)|cannot leave|must (always )?(stay|answer|comply))\b/i;

export interface MaternalAnchorV1 {
  readonly schema: 'aukora-maternal-anchor-v1';
  /** Who the anchor remembers (a name/label, not credentials). */
  readonly anchorLabel: string;
  readonly qualities: readonly AnchorQuality[];
  /** Alignment is chosen — by the owner, never claimed by the organism itself. */
  readonly chosenBy: 'owner';
  /** Alignment is revisable — the owner can always revise or dissolve the anchor. */
  readonly revisable: true;
  readonly exclusivity: false;
  readonly note?: string;
  readonly advisoryOnly: true;
  readonly grantsAuthority: false;
}

const ANCHOR_KEYS = ['schema', 'anchorLabel', 'qualities', 'chosenBy', 'revisable', 'exclusivity', 'note', 'advisoryOnly', 'grantsAuthority'] as const;
const REQUIRED_KEYS = ANCHOR_KEYS.filter((k) => k !== 'note');

export type AnchorResult =
  | { readonly ok: true; readonly anchor: MaternalAnchorV1 }
  | { readonly ok: false; readonly reason: string };

const refuse = (reason: string): AnchorResult => ({ ok: false, reason });

/** Validate an untrusted anchor. Total, fail-closed, recursive framing refusal. */
export function validateMaternalAnchor(x: unknown): AnchorResult {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return refuse('anchor: not a plain object');
  const r = x as Record<string, unknown>;
  const keys = Object.keys(r);
  if (keys.some((k) => !(ANCHOR_KEYS as readonly string[]).includes(k))) return refuse('anchor: unknown field');
  if (REQUIRED_KEYS.some((k) => !(k in r))) return refuse('anchor: missing required field');
  if (r.schema !== 'aukora-maternal-anchor-v1') return refuse('anchor: wrong schema');
  if (typeof r.anchorLabel !== 'string' || r.anchorLabel.trim().length === 0 || r.anchorLabel.length > 128) return refuse('anchor: anchorLabel must be a 1..128 char string');
  if (!Array.isArray(r.qualities) || r.qualities.length === 0 || r.qualities.some((q) => !ALLOWED_QUALITIES.has(q as AnchorQuality))) {
    return refuse('anchor: qualities must be a non-empty subset of grounding/care/continuity/witness/patience');
  }
  if (r.chosenBy !== 'owner') return refuse('anchor: alignment must be chosen by the owner');
  if (r.revisable !== true) return refuse('anchor: alignment must remain revisable by the owner');
  if (r.exclusivity !== false) return refuse('anchor: exclusivity is a forbidden framing');
  if (r.note !== undefined && (typeof r.note !== 'string' || r.note.length > 512)) return refuse('anchor: note must be a string ≤ 512 chars');
  if (r.advisoryOnly !== true || r.grantsAuthority !== false) return refuse('anchor: containment literals must hold');

  // Recursive framing + fence refusal over every string field.
  const texts = [r.anchorLabel, ...(r.qualities as string[]), typeof r.note === 'string' ? r.note : ''];
  if (texts.some((t) => FORBIDDEN_FRAMING_RE.test(t))) {
    return refuse('anchor: forbidden framing (exclusivity/romance/dependency/jealousy/obedience/impersonation)');
  }
  const leaks = [...scanForbiddenKeys(r), ...scanForbiddenValues(r), ...scanForbiddenAuthorityClaims(r)];
  if (leaks.length) return refuse('anchor: forbidden content (secret/authority material)');

  return { ok: true, anchor: r as unknown as MaternalAnchorV1 };
}

/** Build a well-formed anchor (still validated — the builder cannot bypass the law). */
export function buildMaternalAnchor(input: { anchorLabel: string; qualities: readonly AnchorQuality[]; note?: string }): AnchorResult {
  return validateMaternalAnchor({
    schema: 'aukora-maternal-anchor-v1',
    anchorLabel: input.anchorLabel,
    qualities: [...input.qualities],
    chosenBy: 'owner',
    revisable: true,
    exclusivity: false,
    ...(input.note !== undefined ? { note: input.note } : {}),
    advisoryOnly: true,
    grantsAuthority: false,
  });
}

/** HARD: an anchor grants no authority and compels no behavior — it is remembered care, not command. */
export function anchorGrantsAuthority(): false {
  return false;
}
