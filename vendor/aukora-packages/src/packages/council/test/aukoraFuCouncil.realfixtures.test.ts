// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * R42 — the REAL local Fu execution path proven on the REAL captured council replies (deterministic, offline).
 *
 * The five fixtures under fixtures/fusion-replies/ are the verbatim raw replies from the donor's live council run
 * (aukora-symbiote issue #34, capture mode on). Until now they only proved the glyph PARSER; this suite drives them
 * through the FULL `runAukoraFuCouncil` orchestrator — packet law, per-seat classification, spend metering, quorum,
 * geometry, synthesis/fallback — via a deterministic fixture transport. No network, no paid call, advisory-only.
 *
 * Two honest modes:
 *   RAW      — the replies exactly as captured. The capture PREDATES the packet envelope, so the hardened law must
 *              fail CLOSED: every seat becomes a non-vote (`no-packet-block`) and the council refuses quorum. This
 *              pins the protocol evolution: old raw-format output can never be counted by the current orchestrator.
 *   ENVELOPE — the same real payloads wrapped in the CURRENT canonical packet envelope with an honest empty
 *              `CLAIMS:()` (a legal empty vector). The real compliant payloads become real votes (DeepSeek's
 *              reordered-DIST reply exercises the order-independent parser fix through the full orchestrator);
 *              the really-empty and really-prose replies stay non-votes. Quorum under the DEFAULT rule still
 *              refuses (3 votes < 6 + no Fable) — and under an EXPLICIT 3-of-3-families rule (the historical
 *              5-seat roster's shape, passed through the public `quorum` option) the council completes with the
 *              real models' own hypotheses as the advisory answer.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runAukoraFuCouncil, councilGrantsAuthority, SpendMeter,
  PACKET_OPEN, PACKET_CLOSE, DEFAULT_QUORUM_RULE,
  type CouncilSeat, type Transport, type SeatResponse,
} from '../src/aukoraFuCouncil';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'fusion-replies');
const fixture = (name: string) => fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8');

/** The donor live run's ACTUAL roster (issue #34): three seats that are still canonical + the two models the
 *  canonical roster no longer carries. Passed through the public `seats` option — no engine change. */
const LIVE_ROSTER: readonly CouncilSeat[] = [
  { id: 'GLM', slug: 'z-ai/glm-5.2',                    name: 'GLM-5.2',        family: 'z-ai',      framework: 'symbolic',    costPer1M: 0.8 },
  { id: 'QWN', slug: 'qwen/qwen3.7-max',                name: 'Qwen-3.7',       family: 'alibaba',   framework: 'geometric',   costPer1M: 1.2 },
  { id: 'DSK', slug: 'deepseek/deepseek-v4-pro',        name: 'DeepSeek-V4',    family: 'deepseek',  framework: 'statistical', costPer1M: 0.9 },
  { id: 'KIM', slug: 'moonshotai/kimi-k2.7-code',       name: 'Kimi-K2.7',      family: 'moonshot',  framework: 'embodied',    costPer1M: 0.74 },
  { id: 'LLA', slug: 'meta-llama/llama-4-maverick',     name: 'Llama-4-Mav',    family: 'meta',      framework: 'narrative',   costPer1M: 0.5 },
];

const REPLY_BY_SEAT: Record<string, string> = {
  GLM: fixture('glm-5.2-compliant.txt'),
  QWN: fixture('qwen3.7-max-compliant.txt'),
  DSK: fixture('deepseek-v4-pro-dist-reordered.txt'),
  KIM: fixture('kimi-k2.7-code-empty.txt'),          // really empty (0 bytes)
  LLA: fixture('llama-4-maverick-prose-noncompliant.txt'),
};

/** Wrap a REAL captured payload in the CURRENT canonical packet envelope with an honest empty claim vector.
 *  The payload (glyph line + HYP) is the model's verbatim output; only the framing is current-protocol. An
 *  empty capture stays empty (wrapping nothing would manufacture a reply that never happened). */
function envelope(raw: string): string {
  if (!raw.trim()) return raw;
  return `${PACKET_OPEN}\n${raw.trim()}\nCLAIMS:()\n${PACKET_CLOSE}`;
}

const fixtureTransport = (wrap: boolean): Transport => async (seat): Promise<SeatResponse> => {
  const raw = REPLY_BY_SEAT[seat.id] ?? '';
  return { text: wrap ? envelope(raw) : raw, served: seat.slug, finishReason: 'stop' };
};

const INPUT = {
  problem: 'Should a one-line clarifying comment be added above terminalState in workbenchRunReport.ts?',
  claims: ['Add the comment as proposed', 'The existing block comment already covers it'],
};

describe('R42 · REAL captured replies through the FULL orchestrator (deterministic fixture transport)', () => {
  it('RAW capture format (pre-envelope) fails CLOSED: every seat non-vote, insufficient quorum', async () => {
    const out = await runAukoraFuCouncil(INPUT, fixtureTransport(false), { seats: LIVE_ROSTER, now: 1000 });
    expect(out.votes).toHaveLength(0);
    // the four non-empty raw replies all refuse for the same bounded-extraction reason; the empty one is empty
    for (const r of out.round2) {
      expect(r.status).toMatch(/^nonvote_/);
      if (r.seatId === 'KIM') expect(r.status).toBe('nonvote_empty');
      else expect(r.reason).toContain('no-packet-block');
    }
    expect(out.quorumMet).toBe(false);
    expect(out.verdict).toBe('insufficient-quorum');
    expect(out.answerSource).toBe('insufficient-quorum');
    expect(out.advisory).toBe(true);
    expect(out.grantsAuthority).toBe(false);
    expect(councilGrantsAuthority(out)).toBe(false);
  });

  it('ENVELOPE mode: the real compliant payloads become REAL votes (incl. DeepSeek reordered DIST); empty/prose stay non-votes; DEFAULT quorum still refuses', async () => {
    const out = await runAukoraFuCouncil(INPUT, fixtureTransport(true), { seats: LIVE_ROSTER, now: 1000 });
    const votedIds = out.votes.map((v) => v.seatId).sort();
    expect(votedIds).toEqual(['DSK', 'GLM', 'QWN']);
    // DeepSeek's REAL reply has DIST keys in a non-canonical order — through the FULL path it must still vote,
    // with the distribution parsed correctly (the issue-#34 parser fix, now proven at orchestrator level).
    const dsk = out.votes.find((v) => v.seatId === 'DSK')!;
    expect(dsk.packet!.distribution.explore).toBeGreaterThan(0);
    const kim = out.round2.find((r) => r.seatId === 'KIM')!;
    expect(kim.status).toBe('nonvote_empty');
    const lla = out.round2.find((r) => r.seatId === 'LLA')!;
    expect(lla.status).toBe('nonvote_malformed'); // real prose reply: envelope or not, there is no glyph line
    // the current DEFAULT rule (≥6 votes, ≥6 families, verified Fable) rightly refuses this historical 5-seat run
    expect(out.quorumRule).toEqual(DEFAULT_QUORUM_RULE);
    expect(out.quorumMet).toBe(false);
    expect(out.verdict).toBe('insufficient-quorum');
    expect(out.fableVerified).toBe(false);
    expect(out.grantsAuthority).toBe(false);
  });

  it('ENVELOPE mode under the EXPLICIT historical rule (3 votes / 3 families, no required seat): the pass completes with a REAL model hypothesis as the advisory answer', async () => {
    const out = await runAukoraFuCouncil(INPUT, fixtureTransport(true), {
      seats: LIVE_ROSTER, now: 1000,
      quorum: { minVotes: 3, minFamilies: 3, requireSeatId: null },
    });
    expect(out.quorumMet).toBe(true);
    expect(out.votes).toHaveLength(3);
    expect(out.votingFamilies).toBe(3);
    // no FBL in this roster and the synthesis reply (a real captured packet, no USED_CLAIMS declaration) is
    // rightly voided by the blocker-5 law → the answer falls back to the top-weighted REAL hypothesis.
    expect(out.answerSource).toBe('fallback-top-hyp');
    const realHyps = out.votes.map((v) => v.packet!.hypothesis);
    expect(realHyps).toContain(out.answer);
    expect(out.answer.length).toBeGreaterThan(20);
    expect(['consensus', 'consensus-suspect', 'divergence']).toContain(out.verdict);
    expect(out.grantsAuthority).toBe(false);
  });

  it('spend law holds on the fixture pass: projection > 0, fail-closed meter, zero actual (no billed tokens in fixtures)', async () => {
    const spend = new SpendMeter({ perPassUsd: 2, perDayUsd: 10 });
    const out = await runAukoraFuCouncil(INPUT, fixtureTransport(true), { seats: LIVE_ROSTER, now: 1000, spend });
    expect(out.estimatedUsd).toBeGreaterThan(0);
    expect(out.actualUsd).toBe(0);
  });
});
