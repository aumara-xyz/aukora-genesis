// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Focused, PURE tests for the hardened Aukora Fu council (replayed from PR #352 onto current main
 * for the fusion-chat integration round). No network: a fake transport returns canned seat text.
 * Covers H1-H8 plus the five PR #352 merge-blocker fixes:
 *   B1 exact served identity (alias table; Max≠Pro, Flash≠Pro fail closed)
 *   B2 AbortSignal cancellation → nonvote_timeout
 *   B3 reserve/reconcile spend + provider-cost preference (+ persistent ledger tested separately)
 *   B4 quorum before verdict (≥6 distinct families + verified Fable)
 *   B5 bounded uniquely-tagged glyph extraction + synthesis USED_CLAIMS gating
 * plus the two replay additions and one structural proof:
 *   T  truncation honesty (non-`stop` finish + incomplete packet → nonvote_truncated, not repairable)
 *   Q  the explicit, caller-configurable quorum rule (default byte-equal to B4's gate)
 *   C  in-wave concurrency (every seat's call is IN FLIGHT before any resolves)
 */
import { describe, it, expect } from 'vitest';
import {
  CANONICAL_SEATS, freezeClaimBasis, verifyClaimBasis, parseClaimVectorStrict,
  extractPacketBlock, parseUsedClaims, PACKET_OPEN, PACKET_CLOSE,
  classifySeatResult, servedMatches, lineageWeights, assessPhaseLock, neutralReplayDrift,
  SpendMeter, SpendCeilingExceeded, QUORUM_MIN, DEFAULT_QUORUM_RULE, isRepairable,
  runAukoraFuCouncil, councilGrantsAuthority,
  type CouncilSeat, type SeatResponse, type Transport, type ClaimBasis,
} from '../src/aukoraFuCouncil';

const basis = (): ClaimBasis => freezeClaimBasis('Is the gate safe?', ['refuses forged sigs', 'blocks replay'], 1000);

/** Build a well-formed, uniquely-tagged packet block. */
const pkt = (o: Partial<{ stance: string; conf: string; strat: string; fw: string; dist: string; claims: string; hyp: string }> = {}): string => {
  const d = { stance: '⊕', conf: '↑', strat: '↙', fw: 'statistical', dist: 'explore=0.10,exploit=0.30,verify=0.50,abstain=0.10', claims: 'C1=0.8,C2=0.7', hyp: 'the gate holds', ...o };
  return [PACKET_OPEN, `STANCE:${d.stance} CONFIDENCE:${d.conf} STRATEGY:${d.strat} FRAMEWORK:${d.fw} DIST:(${d.dist})`, `CLAIMS:(${d.claims})`, `HYP:"${d.hyp}"`, PACKET_CLOSE].join('\n');
};
const synth = (used = 'C1,C2', text = 'Final: the gate holds on verify-anchored claims.'): SeatResponse =>
  ({ text: `${text}\nUSED_CLAIMS:(${used})`, served: 'anthropic/claude-fable-5' });

describe('roster (H2) — eight canonical seats incl. Grok-4.5, distinct families', () => {
  it('eight seats, Grok is eighth, all families distinct', () => {
    expect(CANONICAL_SEATS.length).toBe(8);
    expect(CANONICAL_SEATS[7].slug).toBe('x-ai/grok-4.5');
    expect(new Set(CANONICAL_SEATS.map((s) => s.family)).size).toBe(8);
    expect(QUORUM_MIN).toBe(6);
  });
});

// ── B1: exact served identity ─────────────────────────────────────────────────────────────────
describe('B1 exact served identity (alias table, fail-closed)', () => {
  it('accepts a dated exact match and the explicit Fable reorder alias', () => {
    expect(servedMatches('qwen/qwen3.7-max', 'qwen/qwen3.7-max-20260520')).toBe(true);
    expect(servedMatches('anthropic/claude-fable-5', 'anthropic/claude-5-fable-20260609')).toBe(true);
  });
  it('REJECTS Max-for-Pro and Flash-for-Pro swaps (the reproduced false accepts)', () => {
    expect(servedMatches('qwen/qwen3.7-max', 'qwen/qwen3.7-pro')).toBe(false);
    expect(servedMatches('google/gemini-3.5-flash', 'google/gemini-3.5-pro')).toBe(false);
  });
  it('rejects a different vendor and any unknown alias', () => {
    expect(servedMatches('anthropic/claude-fable-5', 'deepseek/deepseek-v4-pro')).toBe(false);
    expect(servedMatches('openai/gpt-5.6-sol', 'openai/gpt-5.6-terra')).toBe(false); // Sol canonical; Terra ≠ Sol
  });
  it('a well-formed packet with NO served identity fails closed as nonvote_unverified (the last truth bug)', () => {
    const r = classifySeatResult(CANONICAL_SEATS[0], { text: pkt() /* no served */ }, basis());
    expect(r.status).toBe('nonvote_unverified');
  });
});

// ── B5: bounded extraction ──────────────────────────────────────────────────────────────────────
describe('B5 bounded packet extraction', () => {
  it('extracts exactly one payload from a single tagged block', () => {
    const e = extractPacketBlock(pkt());
    expect(e.ok).toBe(true);
    if (e.ok) { expect(e.hyp).toBe('the gate holds'); expect(e.claimsLine).toContain('C1=0.8'); }
  });
  it('rejects the four malformed/empty live paths', () => {
    const sv = CANONICAL_SEATS[0].slug;
    expect(classifySeatResult(CANONICAL_SEATS[0], { text: '', served: sv }, basis()).status).toBe('nonvote_empty');
    expect(classifySeatResult(CANONICAL_SEATS[0], { text: 'STANCE:⊕ CONFIDENCE:↑ STRATEGY:↙ FRAMEWORK:statistical DIST:(explore=0.1,exploit=0.3,verify=0.5,abstain=0.1) HYP:"x"', served: sv }, basis()).reason).toBe('no-packet-block');
    expect(classifySeatResult(CANONICAL_SEATS[0], { text: pkt() + '\n' + pkt(), served: sv }, basis()).reason).toBe('duplicate-packet-block');
    expect(classifySeatResult(CANONICAL_SEATS[0], { text: pkt({ claims: 'C1=0.8,C9=0.5' }), served: sv }, basis()).reason).toBe('out-of-basis-or-malformed-claim');
  });
  it('rejects an unterminated block and a block with two HYP lines', () => {
    expect(extractPacketBlock(`${PACKET_OPEN}\nSTANCE:⊕ CONFIDENCE:↑ STRATEGY:↙ FRAMEWORK:statistical DIST:(a=1)\nHYP:"x"`)).toEqual({ ok: false, reason: 'unterminated-packet-block' });
    const twoHyp = [PACKET_OPEN, 'STANCE:⊕ CONFIDENCE:↑ STRATEGY:↙ FRAMEWORK:statistical DIST:(explore=0.1,exploit=0.3,verify=0.5,abstain=0.1)', 'HYP:"a"', 'HYP:"b"', PACKET_CLOSE].join('\n');
    expect(extractPacketBlock(twoHyp)).toEqual({ ok: false, reason: 'ambiguous-multiple-hyp' });
  });
  it('parseClaimVectorStrict rejects out-of-basis, accepts empty', () => {
    expect(parseClaimVectorStrict('CLAIMS:(C1=0.8,C2=-0.3)', basis())).toEqual({ C1: 0.8, C2: -0.3 });
    expect(parseClaimVectorStrict('CLAIMS:(C1=0.8,C9=0.1)', basis())).toBeNull();
    expect(parseClaimVectorStrict('CLAIMS:()', basis())).toEqual({});
  });
  it('parseUsedClaims rejects unknown/missing ids', () => {
    expect(parseUsedClaims('answer USED_CLAIMS:(C1,C2)', basis())).toEqual(['C1', 'C2']);
    expect(parseUsedClaims('answer USED_CLAIMS:(C1,C9)', basis())).toBeNull();
    expect(parseUsedClaims('answer with no used-claims line', basis())).toBeNull();
  });
});

describe('claim basis (H8) frozen + verifiable', () => {
  it('digest is content-addressed and the question cannot move after freeze', () => {
    const b = freezeClaimBasis('Q?', ['a', 'b'], 1);
    expect(verifyClaimBasis(b, 'Q?')).toBe(true);
    expect(verifyClaimBasis(b, 'OTHER?')).toBe(false);
  });
});

describe('lineage cap (H5) and phase-lock (H6)', () => {
  it('two same-family seats each get half a vote', () => {
    const twin: CouncilSeat[] = [
      { ...CANONICAL_SEATS[1] },
      { id: 'QW2', slug: 'qwen/qwen3.7-plus', name: 'Q2', family: 'alibaba', framework: 'geometric', costPer1M: 1 },
    ];
    const votes = twin.map((s) => classifySeatResult(s, { text: pkt(), served: s.slug }, basis()));
    const w = lineageWeights(votes, twin);
    expect(w.get('QWN')).toBe(0.5);
    expect(w.get('QW2')).toBe(0.5);
  });
  it('unanimous without an evidence anchor is suspect (the #336 fix)', () => {
    const votes = CANONICAL_SEATS.slice(0, 5).map((s) =>
      classifySeatResult(s, { text: pkt({ strat: '↘', dist: 'explore=0.1,exploit=0.8,verify=0.05,abstain=0.05', claims: 'C1=0.2,C2=0.1' }), served: s.slug }, basis()));
    const a = assessPhaseLock(votes, basis());
    expect(a.reason).toBe('suspect-matched-prior-consensus');
    expect(a.suspect).toBe(true);
  });
  it('neutral replay returns a numeric drift', () => {
    const votes = CANONICAL_SEATS.slice(0, 4).map((s) => classifySeatResult(s, { text: pkt(), served: s.slug }, basis()));
    expect(typeof neutralReplayDrift(votes).drift).toBe('number');
  });
});

// ── B3: reserve / reconcile spend ────────────────────────────────────────────────────────────
describe('B3 spend meter reserve/reconcile (fail-closed)', () => {
  it('a normal eight-seat pass projects under the $2 ceiling', () => {
    const est = new SpendMeter().guardPass(CANONICAL_SEATS, 2, 700, 700);
    expect(est).toBeGreaterThan(0);
    expect(est).toBeLessThan(2.0);
  });
  it('reserve is fail-closed against committed spend; reconcile books actual', () => {
    const m = new SpendMeter({ perPassUsd: 1.0, perDayUsd: 10 });
    m.beginPass();
    m.reserve(0.6);
    expect(() => m.reserve(0.6)).toThrow(SpendCeilingExceeded); // 0.6 + 0.6 > 1.0 committed
    m.reconcile(0.6, 0.1);                                       // actual came in far under reservation
    expect(m.passTotalUsd).toBe(0.1);
    expect(m.reserve(0.5)).toBe(0.5);                            // 0.1 spent + 0.5 reserved ≤ 1.0
  });
  it('day ceiling counts prior day-to-date (persisted seed)', () => {
    const m = new SpendMeter({ perPassUsd: 2, perDayUsd: 10 }, 9.9);
    m.beginPass();
    expect(() => m.reserve(0.5)).toThrow(SpendCeilingExceeded);
  });
});

// ── The orchestrator, end-to-end, offline ────────────────────────────────────────────────────
const fakeTransport = (script: Record<string, SeatResponse | 'throw' | 'hang'>): Transport =>
  async (seat, _prompt, phase, signal) => {
    const r = script[`${seat.id}:${phase}`] ?? script[`${seat.id}:*`] ?? { text: pkt(), served: seat.slug };
    if (r === 'throw') throw new Error('seat blew up');
    if (r === 'hang') return new Promise<SeatResponse>((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))));
    return r;
  };

describe('runAukoraFuCouncil — quorum + synthesis (B2/B4/B5)', () => {
  it('full eight-seat pass meets quorum and synthesizes ONE answer with declared claims', async () => {
    const out = await runAukoraFuCouncil(
      { problem: 'Is the gate safe?', claims: ['refuses forged sigs', 'blocks replay'] },
      fakeTransport({ 'FBL:synthesis': synth('C1,C2') }),
      { now: 1000 },
    );
    expect(out.round1.length).toBe(8);
    expect(out.votes.length).toBe(8);
    expect(out.quorumMet).toBe(true);
    expect(out.fableVerified).toBe(true);
    expect(out.answerSource).toBe('synthesis');
    expect(out.synthUsedClaims).toEqual(['C1', 'C2']);
    expect(out.grantsAuthority).toBe(false);
    expect(councilGrantsAuthority(out)).toBe(false);
  });

  it('B4: below-quorum returns insufficient-quorum with NO authoritative synthesis', async () => {
    const script: Record<string, SeatResponse> = {};
    for (const id of ['DSK', 'KIM', 'MST', 'SOL']) { script[`${id}:round1`] = { text: '' }; script[`${id}:round2`] = { text: '' }; }
    const out = await runAukoraFuCouncil({ problem: 'Q?', claims: ['a', 'b'] }, fakeTransport(script), { now: 1000 });
    expect(out.votes.length).toBe(4);
    expect(out.quorumMet).toBe(false);
    expect(out.verdict).toBe('insufficient-quorum');
    expect(out.answerSource).toBe('insufficient-quorum');
    expect(out.answer).toContain('insufficient quorum');
  });

  it('B4: 7 valid seats but Fable non-vote → still insufficient (Fable required)', async () => {
    const out = await runAukoraFuCouncil(
      { problem: 'Q?', claims: ['a', 'b'] },
      fakeTransport({ 'FBL:round1': { text: '' }, 'FBL:round2': { text: '' } }),
      { now: 1000 },
    );
    expect(out.votes.length).toBe(7);
    expect(out.fableVerified).toBe(false);
    expect(out.quorumMet).toBe(false);
    expect(out.verdict).toBe('insufficient-quorum');
  });

  it('B2: a hung seat is aborted at the deadline and recorded as nonvote_timeout', async () => {
    const out = await runAukoraFuCouncil(
      { problem: 'Q?', claims: ['a', 'b'] },
      fakeTransport({ 'GRK:round1': 'hang', 'GRK:round2': 'hang', 'FBL:synthesis': synth() }),
      { now: 1000, perSeatDeadlineMs: 25 },
    );
    const grk = out.round2.find((r) => r.seatId === 'GRK')!;
    expect(grk.status).toBe('nonvote_timeout');
    expect(out.votes.length).toBe(7);
    expect(out.quorumMet).toBe(true);
  });

  it('B5: synthesis that declares an unknown claim id is voided → fallback to top HYP', async () => {
    const out = await runAukoraFuCouncil(
      { problem: 'Q?', claims: ['a', 'b'] },
      fakeTransport({ 'FBL:synthesis': { text: 'answer USED_CLAIMS:(C1,C9)', served: 'anthropic/claude-fable-5' } }),
      { now: 1000 },
    );
    expect(out.answerSource).toBe('fallback-top-hyp');
    expect(out.answer).toBe('the gate holds');
  });

  it('spend ceiling blocks the pass before any transport call', async () => {
    let calls = 0;
    const counting: Transport = async (s) => { calls++; return { text: pkt(), served: s.slug }; };
    await expect(
      runAukoraFuCouncil({ problem: 'Q?', claims: ['a'] }, counting, { spend: new SpendMeter({ perPassUsd: 0.001, perDayUsd: 10 }), now: 1000 }),
    ).rejects.toBeInstanceOf(SpendCeilingExceeded);
    expect(calls).toBe(0);
  });

  it('REPAIR: an empty seat gets exactly ONE format-repair; a valid repaired packet counts (repaired:true)', async () => {
    const calls: Record<string, number> = {};
    const transport: Transport = async (seat, _p, phase) => {
      const key = `${seat.id}:${phase}`;
      calls[key] = (calls[key] ?? 0) + 1;
      if (seat.id === 'DSK') return calls[key] === 1 ? { text: '', served: seat.slug } : { text: pkt(), served: seat.slug };
      if (phase === 'synthesis') return synth();
      return { text: pkt(), served: seat.slug };
    };
    const out = await runAukoraFuCouncil({ problem: 'Q?', claims: ['a', 'b'] }, transport, { now: 1000 });
    const dsk = out.round2.find((r) => r.seatId === 'DSK')!;
    expect(dsk.status).toBe('voted');
    expect(dsk.repaired).toBe(true);
    expect(out.votes.length).toBe(8);         // DSK recovered via the single repair
    expect(calls['DSK:round2']).toBe(2);      // exactly one initial + one repair, never a loop
  });

  it('REPAIR: substitution is NOT repaired (only empty / dist_sum_mismatch)', async () => {
    let dskCalls = 0;
    const transport: Transport = async (seat, _p, phase) => {
      if (seat.id === 'DSK') { dskCalls++; return { text: pkt(), served: 'openai/gpt-5.6-sol' }; } // substituted
      if (phase === 'synthesis') return synth();
      return { text: pkt(), served: seat.slug };
    };
    const out = await runAukoraFuCouncil({ problem: 'Q?', claims: ['a', 'b'] }, transport, { now: 1000 });
    expect(out.round2.find((r) => r.seatId === 'DSK')!.status).toBe('nonvote_substituted');
    expect(dskCalls).toBe(2);                 // one per phase, NO repair attempt
  });
});

// ── T: truncation honesty (replay addition) ───────────────────────────────────────────────────
describe('T truncated replies are their own non-vote, never repaired', () => {
  const sv = CANONICAL_SEATS[0].slug;

  it('a non-`stop` finish whose packet is incomplete is nonvote_truncated with the finish reason recorded', () => {
    const cut = pkt().slice(0, 60); // packet opened but cut mid-line — no close tag ever arrived
    const r = classifySeatResult(CANONICAL_SEATS[0], { text: cut, served: sv, finishReason: 'length' }, basis());
    expect(r.status).toBe('nonvote_truncated');
    expect(r.reason).toContain('finish=length');
  });

  it('the same incomplete packet WITHOUT a finish reason stays nonvote_malformed (no invented truncation)', () => {
    const cut = pkt().slice(0, 60);
    const r = classifySeatResult(CANONICAL_SEATS[0], { text: cut, served: sv }, basis());
    expect(r.status).toBe('nonvote_malformed');
  });

  it('a COMPLETE packet under a non-`stop` finish still counts — the cut only lost trailing prose', () => {
    const r = classifySeatResult(CANONICAL_SEATS[0], { text: pkt() + '\nand furthermore', served: sv, finishReason: 'length' }, basis());
    expect(r.status).toBe('voted');
  });

  it('truncated is NOT repairable (no parser loosening, no second chance after a cut reply)', () => {
    const cut = pkt().slice(0, 60);
    const r = classifySeatResult(CANONICAL_SEATS[0], { text: cut, served: sv, finishReason: 'length' }, basis());
    expect(isRepairable(r)).toBe(false);
  });

  it('end-to-end: a seat truncated in both rounds is a recorded non-vote; the rest of the council still reads', async () => {
    const cut = pkt().slice(0, 60);
    const out = await runAukoraFuCouncil(
      { problem: 'Q?', claims: ['a', 'b'] },
      fakeTransport({ 'GEM:round1': { text: cut, served: 'google/gemini-3.5-flash', finishReason: 'length' }, 'GEM:round2': { text: cut, served: 'google/gemini-3.5-flash', finishReason: 'length' }, 'FBL:synthesis': synth() }),
      { now: 1000 },
    );
    expect(out.round2.find((r) => r.seatId === 'GEM')!.status).toBe('nonvote_truncated');
    expect(out.votes.length).toBe(7);
    expect(out.quorumMet).toBe(true);
  });
});

// ── Q: the explicit quorum rule (replay addition) ─────────────────────────────────────────────
describe('Q configurable quorum rule — default byte-equal to blocker 4', () => {
  it('the default rule IS the PR #352 gate: ≥6 votes, ≥6 families, verified Fable', () => {
    expect(DEFAULT_QUORUM_RULE).toEqual({ minVotes: 6, minFamilies: 6, requireSeatId: 'FBL' });
    expect(QUORUM_MIN).toBe(6);
  });

  it('the outcome carries the rule that was actually applied', async () => {
    const out = await runAukoraFuCouncil({ problem: 'Q?', claims: ['a'] }, fakeTransport({ 'FBL:synthesis': synth('C1') }), { now: 1000 });
    expect(out.quorumRule).toEqual(DEFAULT_QUORUM_RULE);
  });

  it('a majority rule lets a two-seat env-narrowed council read (both vote), with the rule reported', async () => {
    const two = [CANONICAL_SEATS[0], CANONICAL_SEATS[1]]; // FBL + QWN — distinct families
    const out = await runAukoraFuCouncil(
      { problem: 'Q?', claims: ['a', 'b'] },
      fakeTransport({ 'FBL:synthesis': synth() }),
      { now: 1000, seats: two, quorum: { minVotes: 2, minFamilies: 2, requireSeatId: null } },
    );
    expect(out.votes.length).toBe(2);
    expect(out.quorumMet).toBe(true);
    expect(out.answerSource).toBe('synthesis');
    expect(out.quorumRule.requireSeatId).toBeNull();
  });

  it('below the caller rule → insufficient-quorum diagnostic naming the rule, no synthesis', async () => {
    const two = [CANONICAL_SEATS[0], CANONICAL_SEATS[1]];
    const out = await runAukoraFuCouncil(
      { problem: 'Q?', claims: ['a', 'b'] },
      fakeTransport({ 'QWN:round1': { text: '' }, 'QWN:round2': { text: '' } }),
      { now: 1000, seats: two, quorum: { minVotes: 2, minFamilies: 2, requireSeatId: null } },
    );
    expect(out.quorumMet).toBe(false);
    expect(out.answerSource).toBe('insufficient-quorum');
    expect(out.answer).toContain('≥2 votes from ≥2 families');
  });

  it('requireSeatId in a caller rule is enforced (a rule naming FBL fails when FBL non-votes)', async () => {
    const out = await runAukoraFuCouncil(
      { problem: 'Q?', claims: ['a', 'b'] },
      fakeTransport({ 'FBL:round1': { text: '' }, 'FBL:round2': { text: '' } }),
      { now: 1000, quorum: { minVotes: 2, minFamilies: 2, requireSeatId: 'FBL' } },
    );
    expect(out.votes.length).toBe(7);
    expect(out.quorumMet).toBe(false);
  });
});

// ── C: in-wave concurrency (H1 proven, not assumed) ───────────────────────────────────────────
describe('C seats inside a wave run CONCURRENTLY', () => {
  it('every round-1 call is in flight before ANY resolves (a sequential loop would deadlock here and trip the guard timer)', async () => {
    const seatCount = CANONICAL_SEATS.length;
    let inFlight = 0;
    let releaseBarrier!: () => void;
    const allStarted = new Promise<void>((res) => { releaseBarrier = res; });
    // Fail LOUDLY (resolve the barrier and flag) rather than hanging the suite if fan-out regresses
    // to sequential — the assertion below then reports the real maximum concurrency observed.
    let maxObserved = 0;
    const guard = setTimeout(() => releaseBarrier(), 2_000);
    const transport: Transport = async (seat, _p, phase) => {
      if (phase === 'round1') {
        inFlight++;
        maxObserved = Math.max(maxObserved, inFlight);
        if (inFlight === seatCount) releaseBarrier();
        await allStarted;               // nobody finishes round 1 until everyone has started it
        inFlight--;
      }
      if (phase === 'synthesis') return synth();
      return { text: pkt(), served: seat.slug };
    };
    const out = await runAukoraFuCouncil({ problem: 'Q?', claims: ['a', 'b'] }, transport, { now: 1000 });
    clearTimeout(guard);
    expect(maxObserved).toBe(seatCount);  // all eight simultaneously in flight — concurrent, not serial
    expect(out.votes.length).toBe(seatCount);
  });

  it('round 2 does not begin before round 1 fully settles (the wave barrier holds)', async () => {
    let round1Settled = 0;
    let round2SeenBeforeBarrier = false;
    const transport: Transport = async (seat, _p, phase) => {
      if (phase === 'round1') {
        // Stagger settlement so a premature round-2 dispatch would be observable.
        await new Promise((res) => setTimeout(res, seat.id === 'FBL' ? 30 : 1));
        round1Settled++;
      }
      if (phase === 'round2' && round1Settled < CANONICAL_SEATS.length) round2SeenBeforeBarrier = true;
      if (phase === 'synthesis') return synth();
      return { text: pkt(), served: seat.slug };
    };
    await runAukoraFuCouncil({ problem: 'Q?', claims: ['a', 'b'] }, transport, { now: 1000 });
    expect(round2SeenBeforeBarrier).toBe(false);
  });
});
