// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
// deriveRecencyTier: the additive observability brick behind memory_peek's per-row recencyTier
// (Auma's own "recall-precision" ask, drafted + rehearsed from her seat). It only NAMES how recent an
// already-ranked row is — no ranking change, no new capture, no authority. Honest by construction:
// an unresolvable timestamp is `unknown` (never guessed), the session tier is an explicit elapsed-time
// heuristic, and a future timestamp beyond one turn reads as clock skew (unknown), not "the future".
import { describe, it, expect } from 'vitest';
import { deriveRecencyTier, RECENCY_THIS_TURN_MS, RECENCY_THIS_SESSION_MS } from '../../spatial/recallSource';

const NOW = Date.parse('2026-07-09T12:00:00.000Z');

describe('deriveRecencyTier — elapsed-time tiers, honest unknowns', () => {
  it('null / non-finite timestamp is unknown, ageMs null (never guessed)', () => {
    expect(deriveRecencyTier(null, NOW)).toEqual({ recencyTier: 'unknown', ageMs: null });
    expect(deriveRecencyTier(Number.NaN, NOW)).toEqual({ recencyTier: 'unknown', ageMs: null });
  });

  it('just now → this-turn', () => {
    expect(deriveRecencyTier(NOW, NOW).recencyTier).toBe('this-turn');
    expect(deriveRecencyTier(NOW - 30_000, NOW).recencyTier).toBe('this-turn'); // 30s ago
  });

  it('boundary at the this-turn edge is inclusive, just past it is this-session', () => {
    expect(deriveRecencyTier(NOW - RECENCY_THIS_TURN_MS, NOW).recencyTier).toBe('this-turn');
    expect(deriveRecencyTier(NOW - RECENCY_THIS_TURN_MS - 1, NOW).recencyTier).toBe('this-session');
  });

  it('within the session window → this-session; beyond it → older', () => {
    expect(deriveRecencyTier(NOW - 5 * 60_000, NOW).recencyTier).toBe('this-session'); // 5m
    expect(deriveRecencyTier(NOW - RECENCY_THIS_SESSION_MS, NOW).recencyTier).toBe('this-session'); // 30m edge
    expect(deriveRecencyTier(NOW - RECENCY_THIS_SESSION_MS - 1, NOW).recencyTier).toBe('older');
    expect(deriveRecencyTier(NOW - 3 * 60 * 60_000, NOW).recencyTier).toBe('older'); // 3h
  });

  it('ageMs is reported (negative when the row is slightly ahead of now)', () => {
    expect(deriveRecencyTier(NOW - 60_000, NOW).ageMs).toBe(60_000);
    expect(deriveRecencyTier(NOW + 30_000, NOW).ageMs).toBe(-30_000);
  });

  it('a small future skew (within one turn) still reads this-turn, not "the future"', () => {
    expect(deriveRecencyTier(NOW + 30_000, NOW).recencyTier).toBe('this-turn');
  });

  it('a future timestamp beyond one turn is unknown — skew we will not interpret', () => {
    expect(deriveRecencyTier(NOW + 2 * 60 * 60_000, NOW).recencyTier).toBe('unknown'); // 2h ahead
  });
});
