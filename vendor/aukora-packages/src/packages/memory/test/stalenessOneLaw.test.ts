// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * ONE-LAW staleness proof (R33 item 1): `packages/memory/src/staleness.ts` is a pure re-export of the canonical
 * `@aukora/kernel/staleness` — no duplicate implementation exists. Proven two ways: (a) the module's source
 * contains no logic (export-from only); (b) the functions imported through `@aukora/memory` ARE the kernel's
 * functions (reference identity) and behave identically.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as memoryStaleness from '../src/staleness.js';
import * as kernelStaleness from '@aukora/kernel/staleness';

describe('one-law staleness — @aukora/memory re-exports @aukora/kernel/staleness', () => {
  it('the memory module source is export-only (no duplicate implementation)', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/staleness.ts', import.meta.url)), 'utf8');
    expect(src).toContain("from '@aukora/kernel/staleness'");
    // no function/const/class implementations — export-from only
    expect(/\b(function|=>|class |const [A-Z_]+\s*=\s*[^e])/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''))).toBe(false);
  });

  it('memory-imported staleness IS the kernel implementation (reference identity)', () => {
    expect(memoryStaleness.stalenessVerdict).toBe(kernelStaleness.stalenessVerdict);
    expect(memoryStaleness.stampExpiresBy).toBe(kernelStaleness.stampExpiresBy);
    expect(memoryStaleness.challengeStalenessGate).toBe(kernelStaleness.challengeStalenessGate);
    expect(memoryStaleness.stalenessGrantsAuthority).toBe(kernelStaleness.stalenessGrantsAuthority);
    expect(memoryStaleness.DEFAULT_DRAFT_HORIZON_MS).toBe(kernelStaleness.DEFAULT_DRAFT_HORIZON_MS);
  });

  it('behaves as the canonical law (strict canonical time; unknown age flagged stale; no authority)', () => {
    const now = Date.parse('2026-07-16T12:00:00.000Z');
    const fresh = memoryStaleness.stalenessVerdict({ createdAt: '2026-07-16T00:00:00.000Z' }, now);
    expect(fresh.state).toBe('fresh');
    // non-canonical timestamp → unknown age → flagged stale (the kernel's STRICT parser, not Date.parse)
    const loose = memoryStaleness.stalenessVerdict({ createdAt: 'July 16, 2026' }, now);
    expect(loose.horizon).toBe('unknown-age');
    expect(loose.flagged).toBe(true);
    expect(memoryStaleness.stalenessGrantsAuthority()).toBe(false);
  });
});
