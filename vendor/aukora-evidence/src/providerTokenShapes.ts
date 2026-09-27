// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Provider-token shapes (R56) — the CURRENT public LLM-provider credential prefixes (HuggingFace, Tinker) that
 * are NOT in the frozen donor `catalogue.ts`.
 *
 * PROVENANCE NOTE: `packages/evidence/src/catalogue.ts` and `index.ts` are byte-identity-pinned to the kernel
 * donor (`scripts/verify-provenance.mjs`), so these shapes cannot be added to the canonical `SECRET_CATALOGUE`
 * nor re-exported from the barrel without breaking publication. Folding them into the canonical catalogue is a
 * DONOR-PIN UPDATE = an owner-level decision, not an overnight change. This is the un-pinned companion module a
 * consumer can adopt DIRECTLY (`import { textHasProviderToken } from '@aukora/evidence/providerTokenShapes'`)
 * until that owner decision lands. It is standalone and additive: it does not modify or weaken any catalogue law.
 *
 * The same shapes already ship organism-wide via the seed-side scanner (`apps/seed` `FORBIDDEN_VALUE_RE`, R55),
 * which the public tracked-tree scan uses — so the detection is NOT missing from the system; this only brings the
 * (frozen) evidence package a parallel, adoptable primitive.
 *
 * Anti-ReDoS: every quantifier is a terminal `{m,}` (no trailing required token → no backtracking), matching the
 * donor catalogue's discipline. Shape-only detection; never emits or logs the matched bytes.
 */

export interface ProviderTokenPatternV1 { readonly id: string; readonly pattern: string; readonly flags: string; }

export const PROVIDER_TOKEN_SHAPES: readonly ProviderTokenPatternV1[] = Object.freeze([
  // HuggingFace user access tokens: `hf_` + base62 run.
  { id: 'huggingface-token', pattern: 'hf_[A-Za-z0-9]{16,}', flags: 'g' },
  // Tinker (Thinking Machines) keys. `sk-tinker-` is its own shape — the hyphens make the donor catalogue's
  // `openai-key` (`sk-[A-Za-z0-9]{20,}`) and `anthropic-key` (`sk-ant-…`) never match it.
  { id: 'tinker-key', pattern: 'sk-tinker-[A-Za-z0-9_\\-]{8,}', flags: 'g' },
  { id: 'tinker-token', pattern: 'tml_[A-Za-z0-9]{12,}', flags: 'g' },
  { id: 'tinker-raw', pattern: 'tinker_[A-Za-z0-9]{12,}', flags: 'g' },
]);

export interface ProviderTokenMatch { readonly patternId: string; readonly start: number; readonly end: number; }

/** All provider-token matches in `text` (sorted by position then id). Pure; returns positions, never the bytes. */
export function scanForProviderTokens(text: string): ProviderTokenMatch[] {
  const matches: ProviderTokenMatch[] = [];
  for (const p of PROVIDER_TOKEN_SHAPES) {
    const flags = p.flags.indexOf('g') === -1 ? p.flags + 'g' : p.flags;
    const re = new RegExp(p.pattern, flags);
    let m: RegExpExecArray | null = re.exec(text);
    while (m !== null) {
      matches.push({ patternId: p.id, start: m.index, end: m.index + m[0].length });
      if (m[0].length === 0) re.lastIndex++;
      m = re.exec(text);
    }
  }
  matches.sort((a, b) => (a.start - b.start) || (a.end - b.end) || (a.patternId < b.patternId ? -1 : a.patternId > b.patternId ? 1 : 0));
  return matches;
}

/** True if `text` contains any provider-token shape. Fail-closed convenience over `scanForProviderTokens`. */
export function textHasProviderToken(text: string): boolean {
  return scanForProviderTokens(text).length > 0;
}
