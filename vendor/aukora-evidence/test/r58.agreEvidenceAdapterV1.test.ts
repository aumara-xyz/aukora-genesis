// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * R58 — AGRE evidence adapter adversarial suite (first real producer of SwarmRunEvidenceV1).
 * Directive-named hostile classes, each with vectors: (1) forged acceptance, (2) source-label
 * laundering, (3) missing replay, (4) contradictory outcomes, (5) source-assisted runs mislabeled
 * as blind. Plus REMOTE_ONLY/SELF_REPORTED saturation-until-LOCAL_REPRODUCTION and structural
 * fail-closed coverage. Synthetic vectors only; no game runtime, model, or network is touched.
 */
import { describe, it, expect } from 'vitest';
import {
  AGRE_RUN_RECEIPT_SCHEMA, AGRE_RUN_ORIGINS, AGRE_METHODS,
  validateAgreRunReceipt, agreReceiptDigest, agreTaskId, epistemicSourceForOrigin,
  buildAgreSwarmEvidence, agreEnvelopeMatchesReceipt,
  type AgreRunReceiptV1, type AgreRunContextV1, type AgreValidationResult,
} from '../src/agreEvidenceAdapterV1';
import {
  EPISTEMIC_SOURCES, ACCEPTANCE_ELIGIBLE_SOURCES,
  governSwarmRunEvidence, sealSwarmRunEvidence, verifySwarmRunEnvelope,
  type SwarmRunEvidenceV1,
} from '../src/swarmRunEvidenceV1';

const T0 = 1752796800000; // 2025-07-18T00:00:00Z
const HEX64 = 'c'.repeat(64);
const HEX64B = 'd'.repeat(64);
const GITSHA = 'feb11bf179cff2fa9523f9471159da5b0473c1aa';

function goodReceipt(overrides: Record<string, unknown> = {}): AgreRunReceiptV1 {
  return {
    schema: AGRE_RUN_RECEIPT_SCHEMA,
    gameId: 'tu93',
    level: 4,
    origin: 'LOCAL_RUN',
    method: 'source-analysis',
    blind: false,
    levelBeaten: true,
    counts: { actionsSent: 17, expandedStates: 2847, deaths: 0 },
    replay: { episodeDigest: HEX64, actionLogDigest: HEX64B },
    ...overrides,
  } as unknown as AgreRunReceiptV1;
}

function goodContext(overrides: Record<string, unknown> = {}): AgreRunContextV1 {
  return {
    model: { id: 'local/agre-v2', revision: 'r58.0' },
    harnessVersion: 'agre-harness-0.1.0',
    baseCommit: GITSHA,
    execution: {
      outcome: 'completed',
      startedAtMs: T0,
      completedAtMs: T0 + 30_000,
      runner: 'sam2-local-seat',
      sandboxed: true,
      networkEgress: 'none',
    },
    ...overrides,
  } as unknown as AgreRunContextV1;
}

function expectErr(r: AgreValidationResult, code: string, pathFragment?: string) {
  expect(r.ok, `expected ${code}, got ok`).toBe(false);
  if (!r.ok) {
    expect(r.code).toBe(code);
    if (pathFragment) expect(r.path).toContain(pathFragment);
  }
}

describe('R58: adapter good path — AGRE becomes a real SwarmRunEvidenceV1 producer', () => {
  it('a local source-analysis levelBeaten run seals into a verifying, PAIRED, ungoverned envelope', () => {
    const receipt = goodReceipt();
    const env = buildAgreSwarmEvidence(receipt, goodContext());
    expect(verifySwarmRunEnvelope(env)).toBe(true);
    expect(env.body.taskId).toBe('agre.tu93.l4');
    expect(env.body.epistemicSource).toBe('LOCAL_MEASUREMENT');
    expect(env.body.inputDigest).toBe(agreReceiptDigest(receipt));
    expect(env.body.outputDigest).toBe(HEX64); // replay.episodeDigest, never raw content
    expect(env.body.governance.outcome).toBe('ungoverned'); // transport success ≠ acceptance, structurally
    expect(agreEnvelopeMatchesReceipt(env, receipt)).toBe(true);
  });

  it('every origin maps to its fixed epistemic label — no caller-supplied label exists', () => {
    expect(epistemicSourceForOrigin('LOCAL_RUN')).toBe('LOCAL_MEASUREMENT');
    expect(epistemicSourceForOrigin('LOCAL_REPLAY')).toBe('LOCAL_REPRODUCTION');
    expect(epistemicSourceForOrigin('REMOTE_ONLY')).toBe('REMOTE_ONLY');
    expect(epistemicSourceForOrigin('SELF_REPORTED_DOC')).toBe('SELF_REPORTED');
    for (const origin of AGRE_RUN_ORIGINS) {
      const env = buildAgreSwarmEvidence(goodReceipt({ origin }), goodContext());
      expect(env.body.epistemicSource).toBe(epistemicSourceForOrigin(origin));
      expect(env.body.governance.outcome).toBe('ungoverned');
    }
  });

  it('REMOTE_ONLY exists in the envelope vocabulary but is NOT acceptance-eligible', () => {
    expect(EPISTEMIC_SOURCES).toContain('REMOTE_ONLY');
    expect(ACCEPTANCE_ELIGIBLE_SOURCES).not.toContain('REMOTE_ONLY');
    expect([...ACCEPTANCE_ELIGIBLE_SOURCES].sort()).toEqual(['LOCAL_MEASUREMENT', 'LOCAL_REPRODUCTION']);
  });

  it('an unbeaten discovery run with no replay is honestly representable (no over-refusal)', () => {
    const receipt = goodReceipt({ method: 'discovery-probing', blind: true, levelBeaten: false, replay: null });
    const env = buildAgreSwarmEvidence(receipt, goodContext());
    expect(env.body.outputDigest).toBeNull();
    expect(agreEnvelopeMatchesReceipt(env, receipt)).toBe(true);
  });
});

describe('R58 class 1: forged acceptance', () => {
  const decision = { outcome: 'accepted', classifierVersion: 'clf-1.3.0', decidedAtMs: T0 + 60_000 } as const;

  it('post-seal governance flip is detected — verify and pairing both fail', () => {
    const receipt = goodReceipt();
    const env = buildAgreSwarmEvidence(receipt, goodContext());
    const forged = JSON.parse(JSON.stringify(env)) as { body: Record<string, unknown>; runDigest: string };
    forged.body.governance = { outcome: 'accepted', classifierVersion: 'clf-1.3.0', decidedAtMs: T0 + 60_000 };
    expect(verifySwarmRunEnvelope(forged)).toBe(false);
    expect(agreEnvelopeMatchesReceipt(forged as never, receipt)).toBe(false);
  });

  it('the governance door refuses acceptance of REMOTE_ONLY and SELF_REPORTED_DOC runs (saturation)', () => {
    for (const origin of ['REMOTE_ONLY', 'SELF_REPORTED_DOC'] as const) {
      const env = buildAgreSwarmEvidence(goodReceipt({ origin }), goodContext());
      expect(() => governSwarmRunEvidence(env, decision)).toThrow(/E_EPISTEMIC_OVERCLAIM/);
      // ...but quarantine and rejection remain open — saturation, not erasure.
      const q = governSwarmRunEvidence(env, { ...decision, outcome: 'quarantined' });
      expect(q.body.governance.outcome).toBe('quarantined');
    }
  });

  it('the qualifying LOCAL_REPLAY reproduction CAN be accepted — the upgrade path exists', () => {
    const env = buildAgreSwarmEvidence(goodReceipt({ origin: 'LOCAL_REPLAY' }), goodContext());
    const accepted = governSwarmRunEvidence(env, decision);
    expect(accepted.body.governance.outcome).toBe('accepted');
    expect(accepted.body.epistemicSource).toBe('LOCAL_REPRODUCTION');
  });

  it('direct re-seal of a forged accepted+REMOTE_ONLY body fails closed at the narrowed seal (R59 M2)', () => {
    const env = buildAgreSwarmEvidence(goodReceipt({ origin: 'REMOTE_ONLY' }), goodContext());
    const forgedBody = {
      ...env.body,
      governance: { outcome: 'accepted', classifierVersion: 'clf-1.3.0', decidedAtMs: T0 + 60_000 },
    } as SwarmRunEvidenceV1;
    // R59: the public seal now refuses ANY governed body before validation — it cannot mint acceptance.
    expect(() => sealSwarmRunEvidence(forgedBody)).toThrow(/E_SEAL_NOT_UNGOVERNED/);
  });

  it('acceptance of a run whose transport did not complete is refused at the door', () => {
    const receipt = goodReceipt({ levelBeaten: false, replay: null });
    const env = buildAgreSwarmEvidence(receipt, goodContext({
      execution: { ...goodContext().execution, outcome: 'refused' },
    }));
    expect(() => governSwarmRunEvidence(env, decision)).toThrow(/E_OUTCOME_CONTRADICTION/);
  });
});

describe('R58 class 2: source-label laundering', () => {
  it('editing the receipt origin after the fact breaks the receipt↔envelope pairing', () => {
    const honest = goodReceipt({ origin: 'REMOTE_ONLY' });
    const env = buildAgreSwarmEvidence(honest, goodContext());
    const laundered = goodReceipt({ origin: 'LOCAL_RUN' }); // same run, upgraded origin story
    expect(agreEnvelopeMatchesReceipt(env, laundered)).toBe(false); // inputDigest + label both mismatch
    expect(agreEnvelopeMatchesReceipt(env, honest)).toBe(true);
  });

  it('re-sealing the envelope with an upgraded label is internally valid but fails the pairing', () => {
    const honest = goodReceipt({ origin: 'REMOTE_ONLY' });
    const env = buildAgreSwarmEvidence(honest, goodContext());
    const launderedBody = { ...env.body, epistemicSource: 'LOCAL_MEASUREMENT' } as SwarmRunEvidenceV1;
    const launderedEnv = sealSwarmRunEvidence(launderedBody); // validator alone cannot know the origin…
    expect(verifySwarmRunEnvelope(launderedEnv)).toBe(true);
    // …but the adapter pairing law can: the label no longer derives from the bound receipt.
    expect(agreEnvelopeMatchesReceipt(launderedEnv, honest)).toBe(false);
  });

  it('an unknown origin cannot smuggle a label in — closed enum, fail closed', () => {
    expectErr(validateAgreRunReceipt(goodReceipt({ origin: 'TRUSTED_RUN' })), 'E_AGRE_ENUM', 'origin');
    expectErr(validateAgreRunReceipt(goodReceipt({ origin: 'LOCAL_MEASUREMENT' })), 'E_AGRE_ENUM', 'origin'); // envelope labels are not origins
    expect(() => buildAgreSwarmEvidence(goodReceipt({ origin: 'TRUSTED_RUN' }), goodContext())).toThrow(/E_AGRE_ENUM/);
  });

  it('swapping the replay digest to another run breaks the pairing', () => {
    const receipt = goodReceipt();
    const env = buildAgreSwarmEvidence(receipt, goodContext());
    const otherReplay = goodReceipt({ replay: { episodeDigest: HEX64B, actionLogDigest: HEX64 } });
    expect(agreEnvelopeMatchesReceipt(env, otherReplay)).toBe(false);
  });
});

describe('R58 class 3: missing replay', () => {
  it('a beaten-level claim with no replay references fails closed', () => {
    expectErr(validateAgreRunReceipt(goodReceipt({ replay: null })), 'E_AGRE_MISSING_REPLAY', 'replay');
    expect(() => buildAgreSwarmEvidence(goodReceipt({ replay: null }), goodContext())).toThrow(/E_AGRE_MISSING_REPLAY/);
  });

  it('a beaten-level claim with zero actions sent is a contradiction', () => {
    const receipt = goodReceipt({ counts: { actionsSent: 0, expandedStates: 0, deaths: 0 } });
    expectErr(validateAgreRunReceipt(receipt), 'E_AGRE_OUTCOME_CONTRADICTION', 'actionsSent');
  });

  it('malformed replay digests are refused (63-hex, uppercase, git-sha in a sha256 slot)', () => {
    for (const bad of [HEX64.slice(1), HEX64.toUpperCase(), GITSHA]) {
      expectErr(validateAgreRunReceipt(goodReceipt({ replay: { episodeDigest: bad, actionLogDigest: HEX64B } })), 'E_AGRE_SHA', 'episodeDigest');
    }
  });

  it('replay fields cannot carry extra payload keys', () => {
    expectErr(validateAgreRunReceipt(goodReceipt({ replay: { episodeDigest: HEX64, actionLogDigest: HEX64B, frames: 'raw' } })), 'E_AGRE_UNKNOWN_FIELD', 'frames');
  });
});

describe('R58 class 4: contradictory outcomes', () => {
  it('a levelBeaten claim on a refused / timed-out / transport-failed run is refused', () => {
    for (const outcome of ['refused', 'timed-out', 'transport-failed'] as const) {
      const ctx = goodContext({ execution: { ...goodContext().execution, outcome } });
      expect(() => buildAgreSwarmEvidence(goodReceipt(), ctx), outcome).toThrow(/E_AGRE_OUTCOME_CONTRADICTION/);
    }
  });

  it('replay references on a transport-failed run are a fabrication', () => {
    const ctx = goodContext({ execution: { ...goodContext().execution, outcome: 'transport-failed' } });
    const receipt = goodReceipt({ levelBeaten: false }); // replay still present
    expect(() => buildAgreSwarmEvidence(receipt, ctx)).toThrow(/E_AGRE_OUTCOME_CONTRADICTION:receipt\.replay/);
  });

  it('an honest transport failure (no replay, no claim) is representable', () => {
    const ctx = goodContext({ execution: { ...goodContext().execution, outcome: 'transport-failed' } });
    const receipt = goodReceipt({ levelBeaten: false, replay: null });
    const env = buildAgreSwarmEvidence(receipt, ctx);
    expect(env.body.outputDigest).toBeNull();
    expect(env.body.execution.outcome).toBe('transport-failed');
  });

  it('the envelope contradiction laws still hold through the adapter (no bypass)', () => {
    // The adapter output re-enters governSwarmRunEvidence; a timed-out run can never become accepted.
    const ctx = goodContext({ execution: { ...goodContext().execution, outcome: 'timed-out' } });
    const env = buildAgreSwarmEvidence(goodReceipt({ levelBeaten: false }), ctx);
    expect(() => governSwarmRunEvidence(env, { outcome: 'accepted', classifierVersion: 'clf-1.3.0', decidedAtMs: T0 + 60_000 }))
      .toThrow(/E_OUTCOME_CONTRADICTION/);
  });
});

describe('R58 class 5: source-assisted runs mislabeled as blind', () => {
  it('a source-analysis run claiming blind:true fails closed', () => {
    expectErr(validateAgreRunReceipt(goodReceipt({ blind: true })), 'E_AGRE_BLIND_MISLABEL', 'blind');
    expect(() => buildAgreSwarmEvidence(goodReceipt({ blind: true }), goodContext())).toThrow(/E_AGRE_BLIND_MISLABEL/);
  });

  it('honest combinations stay representable: probing may be blind, source-analysis must not be', () => {
    expect(validateAgreRunReceipt(goodReceipt({ method: 'discovery-probing', blind: true })).ok).toBe(true);
    expect(validateAgreRunReceipt(goodReceipt({ method: 'discovery-probing', blind: false })).ok).toBe(true);
    expect(validateAgreRunReceipt(goodReceipt({ method: 'source-analysis', blind: false })).ok).toBe(true);
  });

  it('unknown methods cannot dodge the blind law', () => {
    expectErr(validateAgreRunReceipt(goodReceipt({ method: 'vision-first' })), 'E_AGRE_ENUM', 'method');
    expect(AGRE_METHODS).toHaveLength(2);
  });
});

describe('R58: structural fail-closed coverage', () => {
  it('unknown schema versions and unknown fields are refused', () => {
    expectErr(validateAgreRunReceipt(goodReceipt({ schema: 'aukora-agre-run-receipt-v2' })), 'E_AGRE_SCHEMA');
    expectErr(validateAgreRunReceipt(goodReceipt({ notes: 'the zigzag desyncs the projectile' })), 'E_AGRE_UNKNOWN_FIELD', 'notes');
    const r = goodReceipt() as unknown as Record<string, unknown>;
    delete r.origin;
    expectErr(validateAgreRunReceipt(r), 'E_AGRE_MISSING_FIELD', 'origin');
  });

  it('game ids are short lowercase identifiers — payloads cannot fit', () => {
    for (const bad of ['TU93', 'tu 93', 'tu93/../secrets', 'x'.repeat(40), '']) {
      expectErr(validateAgreRunReceipt(goodReceipt({ gameId: bad })), 'E_AGRE_LABEL', 'gameId');
    }
    expect(agreTaskId({ gameId: 'ls20', level: 1 })).toBe('agre.ls20.l1');
  });

  it('counts and level must be bounded safe integers', () => {
    expectErr(validateAgreRunReceipt(goodReceipt({ level: 2.5 })), 'E_AGRE_INTEGER', 'level');
    expectErr(validateAgreRunReceipt(goodReceipt({ level: -1 })), 'E_AGRE_INTEGER', 'level');
    expectErr(validateAgreRunReceipt(goodReceipt({ counts: { actionsSent: -1, expandedStates: 0, deaths: 0 } })), 'E_AGRE_INTEGER', 'actionsSent');
    expectErr(validateAgreRunReceipt(goodReceipt({ counts: { actionsSent: 17, expandedStates: Number.MAX_SAFE_INTEGER + 2, deaths: 0 } })), 'E_AGRE_INTEGER', 'expandedStates');
  });

  it('accessor and prototype games are refused at the receipt boundary', () => {
    const r = goodReceipt() as unknown as Record<string, unknown>;
    Object.defineProperty(r, 'levelBeaten', { get() { return true; }, enumerable: true, configurable: true });
    expectErr(validateAgreRunReceipt(r), 'E_AGRE_PROTO');
  });

  it('the pairing predicate is total on hostile input — never throws', () => {
    const env = buildAgreSwarmEvidence(goodReceipt(), goodContext());
    for (const hostile of [null, undefined, 42, 'receipt', {}, { schema: -0 }]) {
      expect(() => agreEnvelopeMatchesReceipt(env, hostile as never)).not.toThrow();
      expect(agreEnvelopeMatchesReceipt(env, hostile as never)).toBe(false);
    }
    expect(agreEnvelopeMatchesReceipt(null as never, goodReceipt())).toBe(false);
  });

  it('receipts are content-free by construction: the sealed envelope carries digests, not events', () => {
    const receipt = goodReceipt();
    const env = buildAgreSwarmEvidence(receipt, goodContext());
    const wire = JSON.stringify(env);
    // Identifier-shaped fields (agre.tu93.l4) are allowed; event/strategy payload vocabulary is not.
    for (const leak of ['zigzag', 'strategy_artifact', 'source_analysis', 'meta_learning', 'expandedStates']) {
      expect(wire).not.toContain(leak);
    }
    expect(wire).toContain(agreReceiptDigest(receipt));
  });
});
