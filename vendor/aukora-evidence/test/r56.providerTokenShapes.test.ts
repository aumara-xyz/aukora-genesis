// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * R56 — the un-pinned provider-token companion module (HuggingFace + Tinker shapes). Imported DIRECTLY, not via
 * the barrel, because `index.ts`/`catalogue.ts` are donor-pinned (see providerTokenShapes.ts provenance note).
 * Synthetic, non-real vectors only — never a live credential.
 */
import { describe, it, expect } from 'vitest';
import { PROVIDER_TOKEN_SHAPES, scanForProviderTokens, textHasProviderToken } from '../src/providerTokenShapes';

describe('R56: provider-token companion shapes (un-pinned; catalogue.ts stays byte-identical to donor)', () => {
  const vectors: Array<{ token: string; patternId: string }> = [
    { token: 'hf_ABCDefghIJKLmnopQRSTuvwx12345678', patternId: 'huggingface-token' },
    { token: 'sk-tinker-Abc123_def-456xyz789', patternId: 'tinker-key' },
    { token: 'tml_ABCdef123456789012', patternId: 'tinker-token' },
    { token: 'tinker_ABCdef123456789012', patternId: 'tinker-raw' },
  ];

  it('each planted provider token is detected and tagged with the right patternId', () => {
    for (const { token, patternId } of vectors) {
      const hits = scanForProviderTokens(`export PROVIDER=${token}`);
      expect(hits.length, token).toBeGreaterThan(0);
      expect(hits.some((h) => h.patternId === patternId), `${token} → ${patternId}`).toBe(true);
      expect(textHasProviderToken(`  ${token}  `), token).toBe(true);
    }
  });

  it('reports positions only — never the matched bytes', () => {
    const hits = scanForProviderTokens('leak hf_ABCDefghIJKLmnopQRSTuvwx12345678 here');
    expect(JSON.stringify(hits)).not.toContain('ABCDefgh');
    for (const h of hits) { expect(typeof h.start).toBe('number'); expect(typeof h.end).toBe('number'); }
  });

  it('benign near-misses stay clean (no over-refusal)', () => {
    for (const benign of ['hf_short', 'the shelf_label is fine', 'tinker with the config', 'html_encode(x)', 'sk-tinker- (a bare prefix)']) {
      expect(textHasProviderToken(benign), benign).toBe(false);
    }
  });

  it('the shapes are anti-ReDoS: linear on adversarial repeated-prefix input', () => {
    const adversarial = 'hf_'.repeat(20000) + 'tml_'.repeat(20000);
    const start = Date.now();
    scanForProviderTokens(adversarial);          // must not backtrack into O(n^2)
    expect(Date.now() - start).toBeLessThan(1000);
    // every shape is a terminal {m,} quantifier (no trailing required token → no catastrophic backtracking)
    for (const p of PROVIDER_TOKEN_SHAPES) expect(p.pattern).toMatch(/\{\d+,\}$/);
  });
});
