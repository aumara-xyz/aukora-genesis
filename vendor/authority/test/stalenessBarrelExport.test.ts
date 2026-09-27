// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * R47 carry-in — canonical staleness export smoke test. `packages/kernel/src/staleness.ts` existed but the
 * barrel `src/index.ts` did not export it, so `import { stalenessVerdict } from '@aukora/kernel'` failed while
 * the `@aukora/kernel/staleness` subpath worked. One-law semantics unchanged; @aukora/memory's re-export stays
 * the sanctioned consumer (no parallel implementation exists — asserted below).
 */
import { describe, it, expect } from 'vitest';
import * as kernel from '../src/index.js';
import * as subpath from '../src/staleness.js';

describe('R47 — staleness is exported from the kernel barrel (one law, one export surface)', () => {
  it('the barrel exposes the staleness surface', () => {
    for (const name of ['stalenessVerdict', 'stalenessGrantsAuthority', 'DEFAULT_DRAFT_HORIZON_MS', 'EXPIRING_SOON_WINDOW_MS']) {
      expect(name in kernel, `kernel barrel missing ${name}`).toBe(true);
    }
  });
  it('barrel and subpath are the SAME implementation (no parallel law)', () => {
    expect((kernel as Record<string, unknown>)['stalenessVerdict']).toBe(subpath.stalenessVerdict);
    expect((kernel as Record<string, unknown>)['stalenessGrantsAuthority']).toBe(subpath.stalenessGrantsAuthority);
  });
});
