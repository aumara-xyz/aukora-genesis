// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
// STARVATION GUARD (overnight hardening round, 2026-07-17) — the over-fetch/re-admit block in
// convexRecallHits (spatial/recallSource.ts) had ZERO test execution: every prior test injected
// convexImpl, which replaces the whole function. These tests drive the REAL guard through the
// deeper convexQueryImpl seam with stub kernel rows:
//   - an admission exclusion inside the kernel's narrow top-k must NOT starve the turn to empty
//     while admissible rows exist deeper — one widened fetch re-admits them,
//   - a wide fetch that throws keeps the narrow (already lawful) answer — never a throw over width,
//   - a wide fetch that is ALSO all-excluded still serves the lawful (empty) narrow outcome,
//   - the widened result re-applies the k cap,
//   - withheld hits are counted on the process-wide crossThreadExcludedTotal (never a silent cap).
// Consent law itself (admitRecallHit) is pinned in crossThreadRecall.test.ts; this file is about
// the guard's plumbing around it.
import { describe, it, expect } from 'vitest';
import { fuzzyRecallHits, recallSourceStatus, type ConvexQueryImpl } from '../../spatial/recallSource';
import { buildTurnSummaryValue, withCoreStamp } from '../src/conversationShadowCapture';
import { buildCoreReceiptStamp } from '../src/coreMemoryEnvelope';

const URL = 'http://127.0.0.1:3210';
const OWNER = 'aumara.root';
const THREAD_A = 'sess.20260713t090000000z.aaaa'; // the caller
const THREAD_B = 'sess.20260713t080000000z.bbbb'; // another thread's private rows

function stampedValue(text: string, thread: string, scope?: 'owner-shared' | 'thread-private'): string {
  const built = buildTurnSummaryValue({
    ownerText: text,
    replyText: 'noted.',
    model: 'anthropic/claude-fable-5',
    at: '2026-07-13T09:30:00.000Z',
    origin: 'chat',
  });
  if (!built.ok) throw new Error('fixture build failed');
  const stamp = buildCoreReceiptStamp({
    deploymentUrl: URL,
    ownerRootId: OWNER,
    provenance: 'distilled-turn',
    at: '2026-07-13T09:30:00.000Z',
    thread,
    ...(scope ? { scope } : {}),
  });
  return JSON.stringify(withCoreStamp(built.value, stamp));
}

function row(key: string, value: string, rank: number) {
  return { key, value, citation: `convex:mem:${OWNER}:${key}`, rank };
}

/** k excluded-for-the-caller rows: thread-private, owned by THREAD_B (withheld from THREAD_A by the
 *  consent law regardless of the owner switch — the switch stays at its default in these tests). */
function privateRows(n: number): Array<{ key: string; value: string; citation: string; rank: number }> {
  return Array.from({ length: n }, (_, i) =>
    row(`turn.20260713t08000000${i}z.${i}`, stampedValue(`private note ${i} about the teal button`, THREAD_B, 'thread-private'), i + 1));
}

function sharedRows(n: number, offset = 0): Array<{ key: string; value: string; citation: string; rank: number }> {
  return Array.from({ length: n }, (_, i) =>
    row(`turn.20260713t09000000${i}z.${i + offset}`, stampedValue(`shared fact ${i} about the teal button`, THREAD_B, 'owner-shared'), i + 1 + offset));
}

function queryStub(
  narrow: Awaited<ReturnType<ConvexQueryImpl>>,
  wide: Awaited<ReturnType<ConvexQueryImpl>> | 'throw',
): { impl: ConvexQueryImpl; calls: number[] } {
  const calls: number[] = [];
  const impl: ConvexQueryImpl = async (_input, k) => {
    calls.push(k);
    if (calls.length === 1) return narrow;
    if (wide === 'throw') throw new Error('kernel width refused');
    return wide;
  };
  return { impl, calls };
}

const CALLER = { thread: THREAD_A };
const QUERY = 'teal button';

describe('starvation guard — a narrow all-excluded top-k widens once and re-admits deeper rows', () => {
  it('serves admissible rows found ONLY by the widened fetch (and asks the kernel for the widened k)', async () => {
    const excludedNarrow = privateRows(3);
    const { impl, calls } = queryStub(
      { ok: true, hits: excludedNarrow },
      { ok: true, hits: [...excludedNarrow, ...sharedRows(2, 3)] },
    );
    const before = recallSourceStatus().crossThreadExcludedTotal;
    const r = await fuzzyRecallHits(QUERY, 3, { caller: CALLER, convexQueryImpl: impl });
    expect(r.refused).toBeNull();
    expect(r.source).toBe('convex');
    // Without the guard this turn would have starved to zero hits.
    expect(r.hits.length).toBe(2);
    for (const h of r.hits) expect(h.supportQuote).toContain('shared fact');
    // One narrow fetch at k, one widened fetch at min(20, max(k*3, k+excluded)) = 9. Never a third.
    expect(calls).toEqual([3, 9]);
    // The withheld rows are COUNTED (final pass excluded 3) — never a silent cap.
    expect(recallSourceStatus().crossThreadExcludedTotal - before).toBe(3);
  });

  it('re-applies the k cap to a widened fetch that returns more admissible rows than k', async () => {
    const excludedNarrow = privateRows(2);
    const { impl } = queryStub(
      { ok: true, hits: [...excludedNarrow, row('turn.20260713t090000009z.9', stampedValue('shared fact nine about the teal button', THREAD_B, 'owner-shared'), 3)] },
      { ok: true, hits: [...excludedNarrow, ...sharedRows(6, 2)] },
    );
    const r = await fuzzyRecallHits(QUERY, 3, { caller: CALLER, convexQueryImpl: impl });
    expect(r.refused).toBeNull();
    expect(r.hits.length).toBe(3); // capped at k even though 6 admissible came back wide
  });

  it('keeps the narrow lawful answer when the wide fetch THROWS (width is best-effort, never a turn-killer)', async () => {
    const { impl, calls } = queryStub({ ok: true, hits: privateRows(3) }, 'throw');
    const before = recallSourceStatus().crossThreadExcludedTotal;
    const r = await fuzzyRecallHits(QUERY, 3, { caller: CALLER, convexQueryImpl: impl });
    expect(r.refused).toBeNull(); // the guard's failure is contained — NOT a governed-path refusal
    expect(r.hits).toEqual([]); // the narrow pass's lawful (empty) answer stands
    expect(calls.length).toBe(2); // the widen was attempted exactly once
    expect(recallSourceStatus().crossThreadExcludedTotal - before).toBe(3); // narrow exclusions still counted
  });

  it('serves the lawful empty result when the wide fetch is ALSO all-excluded, counting the wide exclusions', async () => {
    const { impl } = queryStub(
      { ok: true, hits: privateRows(3) },
      { ok: true, hits: privateRows(5) },
    );
    const before = recallSourceStatus().crossThreadExcludedTotal;
    const r = await fuzzyRecallHits(QUERY, 3, { caller: CALLER, convexQueryImpl: impl });
    expect(r.refused).toBeNull();
    expect(r.hits).toEqual([]); // honest empty beats serving a withheld row
    expect(recallSourceStatus().crossThreadExcludedTotal - before).toBe(5); // the FINAL pass's exclusions are counted
  });

  it('does not widen at all when the narrow top-k has no exclusions (one kernel round-trip)', async () => {
    const { impl, calls } = queryStub({ ok: true, hits: sharedRows(3) }, { ok: true, hits: [] });
    const r = await fuzzyRecallHits(QUERY, 3, { caller: CALLER, convexQueryImpl: impl });
    expect(r.hits.length).toBe(3);
    expect(calls).toEqual([3]);
  });

  it('a narrow fetch refusal is still the loud honest-empty road (guard never masks it)', async () => {
    const impl: ConvexQueryImpl = async () => ({ ok: false, error: 'kernel refused: custody' });
    const r = await fuzzyRecallHits(QUERY, 3, { caller: CALLER, convexQueryImpl: impl });
    expect(r.hits).toEqual([]);
    expect(r.refused).toContain('kernel refused: custody');
  });
});
