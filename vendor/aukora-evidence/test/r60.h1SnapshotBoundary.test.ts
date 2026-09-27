// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * R60 H1 — snapshot-first evidence boundary. Reproduces the accepted Avengers TOCTOU/accessor class
 * (Kimi H1a–H1e + Fable hand-built envelope) and proves the repair:
 *  - the public seal, the govern door, and the AGRE pairing each take ONE inert snapshot at entry and
 *    read every decision from it — a chameleon getter can no longer show `ungoverned` to a gate and a
 *    governed value to the digest;
 *  - accessor/prototype tricks are REJECTED (E_PROTO), consistent with validateSwarmRunBody;
 *  - the exported law tables are frozen — acceptance eligibility cannot be widened at runtime;
 *  - integrity is split from authenticity: a bare digest verifier is never authority.
 * Synthetic vectors only.
 */
import { describe, it, expect } from 'vitest';
import {
  SWARM_RUN_EVIDENCE_SCHEMA, EPISTEMIC_SOURCES, ACCEPTANCE_ELIGIBLE_SOURCES,
  EXECUTION_OUTCOMES, GOVERNANCE_OUTCOMES, NETWORK_EGRESS,
  sealSwarmRunEvidence, governSwarmRunEvidence, swarmRunDigest,
  verifySwarmRunEnvelope, verifySwarmRunEnvelopeIntegrity, readGovernanceDecision,
  type SwarmRunEvidenceV1,
} from '../src/swarmRunEvidenceV1';

const T0 = 1752796800000;
const HEX = (c: string) => c.repeat(64);
const GITSHA = '1e1bfcf437b7ee8ece1b4ecb66c859ee17377d2e';

function ungovernedBody(over: Record<string, unknown> = {}): SwarmRunEvidenceV1 {
  return {
    schema: SWARM_RUN_EVIDENCE_SCHEMA, advisoryOnly: true, grantsAuthority: false,
    taskId: 'r60-h1', epistemicSource: 'LOCAL_MEASUREMENT',
    model: { id: 'local/fable', revision: 'r60.0' }, harnessVersion: 'h-0.1.0', baseCommit: GITSHA,
    inputDigest: HEX('a'), outputDigest: HEX('b'),
    execution: { outcome: 'completed', startedAtMs: T0, completedAtMs: T0 + 1000, runner: 'sam2-seat', sandboxed: true, networkEgress: 'none' },
    governance: { outcome: 'ungoverned', classifierVersion: null, decidedAtMs: null },
    ...over,
  } as unknown as SwarmRunEvidenceV1;
}

describe('R60 H1 — frozen law tables (acceptance eligibility cannot widen at runtime)', () => {
  it('every exported enum/table is frozen', () => {
    for (const t of [EPISTEMIC_SOURCES, ACCEPTANCE_ELIGIBLE_SOURCES, EXECUTION_OUTCOMES, GOVERNANCE_OUTCOMES, NETWORK_EGRESS]) {
      expect(Object.isFrozen(t)).toBe(true);
    }
  });

  it('H1e: pushing a source into ACCEPTANCE_ELIGIBLE_SOURCES throws instead of widening acceptance', () => {
    expect(() => (ACCEPTANCE_ELIGIBLE_SOURCES as unknown as string[]).push('REMOTE_ONLY')).toThrow();
    expect(ACCEPTANCE_ELIGIBLE_SOURCES).not.toContain('REMOTE_ONLY');
  });
});

describe('H1a/H1b — chameleon getter on governance.outcome cannot bypass the seal gate', () => {
  function chameleonGovernanceBody(first: string, rest: string) {
    // A body whose governance.outcome getter returns `first` on read #1 then `rest` after.
    let reads = 0;
    const governance = {};
    Object.defineProperty(governance, 'outcome', { enumerable: true, configurable: true, get() { reads++; return reads <= 1 ? first : rest; } });
    Object.defineProperty(governance, 'classifierVersion', { enumerable: true, value: reads <= 1 ? null : 'clf-1' });
    Object.defineProperty(governance, 'decidedAtMs', { enumerable: true, value: null });
    const b = ungovernedBody() as unknown as Record<string, unknown>;
    b.governance = governance;
    return b as unknown as SwarmRunEvidenceV1;
  }

  it('the seal REJECTS a body with an accessor governance.outcome (E_PROTO), never seals a chameleon', () => {
    expect(() => sealSwarmRunEvidence(chameleonGovernanceBody('ungoverned', 'accepted'))).toThrow(/E_PROTO/);
  });

  it('a plain governed body is still refused by the narrowed seal (E_SEAL_NOT_UNGOVERNED)', () => {
    const governed = ungovernedBody({ governance: { outcome: 'accepted', classifierVersion: 'clf-1', decidedAtMs: T0 + 2000 } });
    expect(() => sealSwarmRunEvidence(governed)).toThrow(/E_SEAL_NOT_UNGOVERNED/);
  });

  it('a clean ungoverned body still seals and verifies', () => {
    const env = sealSwarmRunEvidence(ungovernedBody());
    expect(env.body.governance.outcome).toBe('ungoverned');
    expect(verifySwarmRunEnvelopeIntegrity(env)).toBe(true);
  });
});

describe('H1c/H1d — accessor/prototype tricks are rejected consistently (E_PROTO) at seal and govern', () => {
  it('a getter anywhere in the body is rejected by the seal', () => {
    const b = ungovernedBody() as unknown as Record<string, unknown>;
    Object.defineProperty(b, 'taskId', { enumerable: true, configurable: true, get() { return 'r60-h1'; } });
    expect(() => sealSwarmRunEvidence(b as unknown as SwarmRunEvidenceV1)).toThrow(/E_PROTO/);
  });

  it('a foreign-prototype nested object is rejected by the seal', () => {
    const b = ungovernedBody() as unknown as Record<string, unknown>;
    b.model = Object.assign(Object.create({ evil: true }), { id: 'local/fable', revision: 'r60.0' });
    expect(() => sealSwarmRunEvidence(b as unknown as SwarmRunEvidenceV1)).toThrow(/E_PROTO/);
  });

  it('the govern door rejects an envelope whose body carries a chameleon governance getter (E_PROTO)', () => {
    const env = sealSwarmRunEvidence(ungovernedBody());
    const hostile = { body: {}, runDigest: env.runDigest } as Record<string, unknown>;
    let reads = 0;
    const gov = {};
    Object.defineProperty(gov, 'outcome', { enumerable: true, get() { reads++; return reads <= 1 ? 'ungoverned' : 'accepted'; } });
    Object.defineProperty(gov, 'classifierVersion', { enumerable: true, value: null });
    Object.defineProperty(gov, 'decidedAtMs', { enumerable: true, value: null });
    Object.assign(hostile.body as object, { ...env.body, governance: gov });
    expect(() => governSwarmRunEvidence(hostile as never, { outcome: 'rejected', classifierVersion: 'clf-1', decidedAtMs: T0 + 5000 })).toThrow(/E_PROTO/);
  });

  it('the govern door still works on a clean ungoverned envelope', () => {
    const env = sealSwarmRunEvidence(ungovernedBody({ epistemicSource: 'LOCAL_REPRODUCTION' }));
    const accepted = governSwarmRunEvidence(env, { outcome: 'accepted', classifierVersion: 'clf-1', decidedAtMs: T0 + 5000 });
    expect(accepted.body.governance.outcome).toBe('accepted');
    expect(verifySwarmRunEnvelopeIntegrity(accepted)).toBe(true);
  });
});

describe('Fable hand-built-envelope vector — integrity is not authenticity', () => {
  it('a hand-built accepted envelope for a LOCAL_* source verifies (integrity) but is read as advisory only', () => {
    const body = ungovernedBody({ epistemicSource: 'LOCAL_MEASUREMENT', governance: { outcome: 'accepted', classifierVersion: 'clf-1', decidedAtMs: T0 + 2000 } });
    const handEnvelope = { body, runDigest: swarmRunDigest(body) };
    expect(verifySwarmRunEnvelopeIntegrity(handEnvelope)).toBe(true); // integrity holds — NOT authority
    const reading = readGovernanceDecision(handEnvelope);
    expect(reading).not.toBeNull();
    expect(reading!.outcome).toBe('accepted');
    expect(reading!.grantsAuthority).toBe(false);          // never yields authority
    expect(reading!.advisoryOnly).toBe(true);
    expect('authorized' in (reading as object)).toBe(false); // no boolean authorization exists
  });

  it('a hand-built accepted envelope for a PROTECTED source fails integrity (validation refuses the promotion)', () => {
    const body = ungovernedBody({ epistemicSource: 'REMOTE_ONLY', governance: { outcome: 'accepted', classifierVersion: 'clf-1', decidedAtMs: T0 + 2000 } });
    const handEnvelope = { body, runDigest: swarmRunDigest(body) };
    expect(verifySwarmRunEnvelopeIntegrity(handEnvelope)).toBe(false);
    expect(readGovernanceDecision(handEnvelope)).toBeNull();
  });

  it('verifySwarmRunEnvelope is a deprecated alias of the integrity verifier (name split is real)', () => {
    expect(verifySwarmRunEnvelope).toBe(verifySwarmRunEnvelopeIntegrity);
  });

  it('readGovernanceDecision is total and fail-closed on hostile input', () => {
    for (const hostile of [null, undefined, 42, 'x', {}, { body: null, runDigest: HEX('a') }]) {
      expect(() => readGovernanceDecision(hostile)).not.toThrow();
      expect(readGovernanceDecision(hostile)).toBeNull();
    }
  });
});

describe('R60 H1 — no alternate minter / re-govern path remains', () => {
  it('the door refuses to re-govern an already-governed envelope', () => {
    const env = sealSwarmRunEvidence(ungovernedBody({ epistemicSource: 'LOCAL_REPRODUCTION' }));
    const once = governSwarmRunEvidence(env, { outcome: 'accepted', classifierVersion: 'clf-1', decidedAtMs: T0 + 2000 });
    expect(() => governSwarmRunEvidence(once, { outcome: 'rejected', classifierVersion: 'clf-2', decidedAtMs: T0 + 3000 })).toThrow(/E_OUTCOME_CONTRADICTION/);
  });

  it('there is no exported seal that admits a governed body (public seal is the only seal export)', () => {
    // Both non-door minting attempts (hand-built governed body, re-seal edit) go through the public seal → refused.
    const governed = ungovernedBody({ governance: { outcome: 'quarantined', classifierVersion: 'clf-1', decidedAtMs: T0 + 2000 } });
    expect(() => sealSwarmRunEvidence(governed)).toThrow(/E_SEAL_NOT_UNGOVERNED/);
  });
});
