// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * R59 M2 — evidence sealing boundary. Reproduces Kimi's two M2 PoCs and proves the fix:
 *  PoC 1 — the exported seal API could self-certify a hand-built `accepted` body (mint governance
 *          without the door).
 *  PoC 2 — a re-sealed axis edit (ungoverned→governed) could pass the AGRE pairing predicate, whose
 *          docstring falsely claimed to detect outcome edits.
 * Fix: the public `sealSwarmRunEvidence` admits ONLY ungoverned bodies (governed outcomes exist solely
 * through `governSwarmRunEvidence`); `agreEnvelopeMatchesReceipt` pairs only the ungoverned run stage.
 * The epistemic-promotion law and the door's own checks remain the value-level backstop.
 */
import { describe, it, expect } from 'vitest';
import {
  SWARM_RUN_EVIDENCE_SCHEMA, SWARM_ERROR_CODES,
  sealSwarmRunEvidence, governSwarmRunEvidence, verifySwarmRunEnvelope, validateSwarmRunBody,
  buildSwarmRunEvidenceV1, swarmRunDigest,
  type SwarmRunEvidenceV1,
} from '../src/swarmRunEvidenceV1';
import {
  buildAgreSwarmEvidence, agreEnvelopeMatchesReceipt,
  type AgreRunReceiptV1, type AgreRunContextV1, AGRE_RUN_RECEIPT_SCHEMA,
} from '../src/agreEvidenceAdapterV1';

const T0 = 1752796800000;
const HEX = (c: string) => c.repeat(64);
const GITSHA = 'c87880da79934559faf36515e84ffdc9ddd70f16';

function ungovernedBody(over: Record<string, unknown> = {}): SwarmRunEvidenceV1 {
  return {
    schema: SWARM_RUN_EVIDENCE_SCHEMA,
    advisoryOnly: true,
    grantsAuthority: false,
    taskId: 'r59-seal-check',
    epistemicSource: 'LOCAL_MEASUREMENT',
    model: { id: 'local/fable', revision: 'r59.0' },
    harnessVersion: 'h-0.1.0',
    baseCommit: GITSHA,
    inputDigest: HEX('a'),
    outputDigest: HEX('b'),
    execution: { outcome: 'completed', startedAtMs: T0, completedAtMs: T0 + 1000, runner: 'sam2-seat', sandboxed: true, networkEgress: 'none' },
    governance: { outcome: 'ungoverned', classifierVersion: null, decidedAtMs: null },
    ...over,
  } as unknown as SwarmRunEvidenceV1;
}

const agreReceipt = (over: Record<string, unknown> = {}): AgreRunReceiptV1 => ({
  schema: AGRE_RUN_RECEIPT_SCHEMA, gameId: 'tu93', level: 4, origin: 'LOCAL_RUN', method: 'source-analysis',
  blind: false, levelBeaten: true, counts: { actionsSent: 17, expandedStates: 10, deaths: 0 },
  replay: { episodeDigest: HEX('e'), actionLogDigest: HEX('f') }, ...over,
} as unknown as AgreRunReceiptV1);
const agreCtx = (): AgreRunContextV1 => ({
  model: { id: 'local/agre', revision: 'r59.0' }, harnessVersion: 'h-0.1.0', baseCommit: GITSHA,
  execution: { outcome: 'completed', startedAtMs: T0, completedAtMs: T0 + 1000, runner: 'sam2-seat', sandboxed: true, networkEgress: 'none' },
});

describe('R59 M2 PoC 1 — the seal API cannot self-certify a governed body', () => {
  it('E_SEAL_NOT_UNGOVERNED is a registered code', () => {
    expect(SWARM_ERROR_CODES).toContain('E_SEAL_NOT_UNGOVERNED');
  });

  it('a hand-built accepted body is REFUSED by the public seal (was: self-certified)', () => {
    const handBuilt = ungovernedBody({ governance: { outcome: 'accepted', classifierVersion: 'clf-1', decidedAtMs: T0 + 2000 } });
    expect(() => sealSwarmRunEvidence(handBuilt)).toThrow(/E_SEAL_NOT_UNGOVERNED/);
  });

  it('every non-ungoverned outcome is refused by the public seal', () => {
    for (const outcome of ['accepted', 'rejected', 'quarantined'] as const) {
      const b = ungovernedBody({ governance: { outcome, classifierVersion: 'clf-1', decidedAtMs: T0 + 2000 } });
      expect(() => sealSwarmRunEvidence(b), outcome).toThrow(/E_SEAL_NOT_UNGOVERNED/);
    }
  });

  it('the check precedes validation: even an epistemically-illegal accepted body throws the seal code, not the overclaim code', () => {
    // REMOTE_ONLY + accepted would be E_EPISTEMIC_OVERCLAIM at validation; the seal gate fires first.
    const b = ungovernedBody({ epistemicSource: 'REMOTE_ONLY', governance: { outcome: 'accepted', classifierVersion: 'clf-1', decidedAtMs: T0 + 2000 } });
    expect(() => sealSwarmRunEvidence(b)).toThrow(/E_SEAL_NOT_UNGOVERNED/);
    // …and the value-level backstop still holds independently: validation refuses the promotion.
    expect(validateSwarmRunBody(b).ok).toBe(false);
  });

  it('an ungoverned body still seals, and the door remains the ONLY minter of governed envelopes', () => {
    const env = sealSwarmRunEvidence(ungovernedBody());
    expect(env.body.governance.outcome).toBe('ungoverned');
    const accepted = governSwarmRunEvidence(env, { outcome: 'accepted', classifierVersion: 'clf-1', decidedAtMs: T0 + 2000 });
    expect(accepted.body.governance.outcome).toBe('accepted');
    expect(verifySwarmRunEnvelope(accepted)).toBe(true); // the door's product verifies
  });
});

describe('R59 M2 PoC 2 — a re-sealed / hand-forged axis edit no longer pairs', () => {
  it('the falsified case: a governed envelope does NOT pair with its receipt (pairing is ungoverned-only)', () => {
    const receipt = agreReceipt({ origin: 'LOCAL_RUN' });
    const env = buildAgreSwarmEvidence(receipt, agreCtx());
    expect(agreEnvelopeMatchesReceipt(env, receipt)).toBe(true); // ungoverned run pairs
    // Legitimately govern it through the door (LOCAL_RUN → LOCAL_MEASUREMENT is acceptance-eligible)…
    const accepted = governSwarmRunEvidence(env, { outcome: 'accepted', classifierVersion: 'clf-1', decidedAtMs: T0 + 2000 });
    expect(verifySwarmRunEnvelope(accepted)).toBe(true);
    // …and it no longer satisfies the RUN pairing predicate — governance is a separate stage.
    expect(agreEnvelopeMatchesReceipt(accepted, receipt)).toBe(false);
  });

  it('a hand-forged accepted envelope (correct digest, no door) cannot be produced for a protected source', () => {
    // For REMOTE_ONLY the body itself is invalid when accepted, so no verifiable forged envelope exists.
    const forgedBody = ungovernedBody({ epistemicSource: 'REMOTE_ONLY', governance: { outcome: 'accepted', classifierVersion: 'clf-1', decidedAtMs: T0 + 2000 } });
    const handEnvelope = { body: forgedBody, runDigest: swarmRunDigest(forgedBody) };
    expect(verifySwarmRunEnvelope(handEnvelope)).toBe(false); // validation refuses the promotion → verify false
  });

  it('a hand-forged accepted envelope for a LOCAL_* source verifies but still fails the AGRE run pairing', () => {
    const receipt = agreReceipt({ origin: 'LOCAL_RUN' });
    const env = buildAgreSwarmEvidence(receipt, agreCtx());
    // Attacker computes a correct digest over an accepted edit (bypassing the narrowed seal entirely).
    const forgedBody = { ...env.body, governance: { outcome: 'accepted', classifierVersion: 'clf-1', decidedAtMs: T0 + 2000 } } as SwarmRunEvidenceV1;
    const handEnvelope = { body: forgedBody, runDigest: swarmRunDigest(forgedBody) };
    expect(verifySwarmRunEnvelope(handEnvelope)).toBe(true);           // internally well-formed…
    expect(agreEnvelopeMatchesReceipt(handEnvelope, receipt)).toBe(false); // …but not the ungoverned run pairing
  });

  it('builder output is unaffected: transport success still yields an ungoverned, pairing envelope', () => {
    const env = buildSwarmRunEvidenceV1({
      taskId: 'r59-build', epistemicSource: 'EXTERNAL_RESEARCH',
      model: { id: 'local/fable', revision: 'r59.0' }, harnessVersion: 'h-0.1.0', baseCommit: GITSHA,
      rawInput: 'in', rawOutput: 'out',
      execution: { outcome: 'completed', startedAtMs: T0, completedAtMs: T0 + 1000, runner: 'sam2-seat', sandboxed: true, networkEgress: 'none' },
    });
    expect(env.body.governance.outcome).toBe('ungoverned');
    expect(verifySwarmRunEnvelope(env)).toBe(true);
  });
});
