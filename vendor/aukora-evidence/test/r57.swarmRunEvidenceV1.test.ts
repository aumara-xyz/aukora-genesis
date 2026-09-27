// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * R57 — SwarmRunEvidenceV1 adversarial suite. Imported DIRECTLY, not via the barrel (index.ts is
 * donor-pinned). Every law in the contract header has at least one hostile vector here: malformed
 * hashes, missing provenance, embedded plaintext/secrets, contradictory outcome combinations,
 * unknown versions/enums, epistemic overclaiming, and planted digest tamper. Synthetic vectors only.
 */
import { describe, it, expect } from 'vitest';
import {
  SWARM_RUN_EVIDENCE_SCHEMA, EPISTEMIC_SOURCES, EXECUTION_OUTCOMES, GOVERNANCE_OUTCOMES,
  ACCEPTANCE_ELIGIBLE_SOURCES, EPOCH_MIN_MS,
  validateSwarmRunBody, validateSwarmRunEnvelope, verifySwarmRunEnvelope,
  sealSwarmRunEvidence, swarmRunDigest, buildSwarmRunEvidenceV1, governSwarmRunEvidence, sha256OfUtf8,
  type SwarmRunEvidenceV1, type SwarmRunSourceV1, type SwarmValidationResult,
} from '../src/swarmRunEvidenceV1';

const T0 = 1752796800000; // 2025-07-18T00:00:00Z — comfortably past the plausibility floor
const HEX64 = 'a'.repeat(64);
const HEX64B = 'b'.repeat(64);
const GITSHA = '0ceb517398b34d99ed2c55d1d67c292d67e4a935';

function goodBody(overrides: Record<string, unknown> = {}): SwarmRunEvidenceV1 {
  return {
    schema: SWARM_RUN_EVIDENCE_SCHEMA,
    advisoryOnly: true,
    grantsAuthority: false,
    taskId: 'r57-brick-2.proposal-01',
    epistemicSource: 'LOCAL_MEASUREMENT',
    model: { id: 'local/fable-worker', revision: 'r57.0' },
    harnessVersion: 'swarm-harness-0.1.0',
    baseCommit: GITSHA,
    inputDigest: HEX64,
    outputDigest: HEX64B,
    execution: {
      outcome: 'completed',
      startedAtMs: T0,
      completedAtMs: T0 + 60_000,
      runner: 'sam2-local-seat',
      sandboxed: true,
      networkEgress: 'none',
    },
    governance: { outcome: 'ungoverned', classifierVersion: null, decidedAtMs: null },
    ...overrides,
  } as unknown as SwarmRunEvidenceV1;
}

function expectErr(r: SwarmValidationResult, code: string, pathFragment?: string) {
  expect(r.ok, `expected ${code}, got ok`).toBe(false);
  if (!r.ok) {
    expect(r.code).toBe(code);
    if (pathFragment) expect(r.path).toContain(pathFragment);
  }
}

describe('R57: SwarmRunEvidenceV1 — good-path and non-collapse of outcomes', () => {
  it('a well-formed ungoverned run validates and seals with a stable domain-separated digest', () => {
    const body = goodBody();
    expect(validateSwarmRunBody(body).ok).toBe(true);
    const env = sealSwarmRunEvidence(body);
    expect(env.runDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(env.runDigest).toBe(swarmRunDigest(env.body));
    expect(verifySwarmRunEnvelope(env)).toBe(true);
    expect(Object.isFrozen(env)).toBe(true);
    expect(Object.isFrozen(env.body.execution)).toBe(true);
  });

  it('all six required states are distinctly representable — nothing collapses', () => {
    // refusal, timeout, transport failure (execution axis) — each stays ungoverned-representable.
    for (const outcome of ['refused', 'timed-out', 'transport-failed'] as const) {
      const b = goodBody({
        outputDigest: outcome === 'transport-failed' ? null : HEX64B,
        execution: { ...goodBody().execution, outcome },
      });
      expect(validateSwarmRunBody(b).ok, outcome).toBe(true);
    }
    // acceptance, rejection, quarantine (governance axis) on a completed run.
    const gov = (outcome: 'accepted' | 'rejected' | 'quarantined') =>
      goodBody({ governance: { outcome, classifierVersion: 'clf-1.2.0', decidedAtMs: T0 + 120_000 } });
    for (const g of ['accepted', 'rejected', 'quarantined'] as const) {
      expect(validateSwarmRunBody(gov(g)).ok, g).toBe(true);
    }
    // The enums themselves stay separate closed sets.
    expect(EXECUTION_OUTCOMES).toHaveLength(4);
    expect(GOVERNANCE_OUTCOMES).toHaveLength(4);
    expect(EPISTEMIC_SOURCES).toContain('EXTERNAL_RESEARCH');
  });

  it('builder: transport success NEVER implies acceptance — output is always ungoverned', () => {
    const source: SwarmRunSourceV1 = {
      taskId: 'r57-research-task-3',
      epistemicSource: 'EXTERNAL_RESEARCH',
      model: { id: 'local/fable-worker', revision: 'r57.0' },
      harnessVersion: 'swarm-harness-0.1.0',
      baseCommit: GITSHA,
      rawInput: 'Survey OCC retry strategies for Convex mutations; propose adversarial tests.',
      rawOutput: 'Proposal: contested-key write storms; stale-read commit race; replay of settled outcome.',
      execution: { outcome: 'completed', startedAtMs: T0, completedAtMs: T0 + 5_000, runner: 'sam2-local-seat', sandboxed: true, networkEgress: 'none' },
    };
    const env = buildSwarmRunEvidenceV1(source);
    expect(env.body.governance.outcome).toBe('ungoverned');
    expect(env.body.governance.classifierVersion).toBeNull();
    expect(env.body.governance.decidedAtMs).toBeNull();
    expect(env.body.execution.outcome).toBe('completed'); // transport truth preserved, acceptance NOT implied
  });
});

describe('R57: adversarial — malformed hashes', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['63-hex inputDigest', { inputDigest: HEX64.slice(1) }, 'E_BAD_SHA'],
    ['65-hex inputDigest', { inputDigest: HEX64 + 'a' }, 'E_BAD_SHA'],
    ['uppercase hex inputDigest', { inputDigest: HEX64.toUpperCase() }, 'E_BAD_SHA'],
    ['non-hex character', { inputDigest: 'g' + HEX64.slice(1) }, 'E_BAD_SHA'],
    ['git-sha in a sha256 slot', { inputDigest: GITSHA }, 'E_BAD_SHA'],
    ['sha256 in the git-sha slot', { baseCommit: HEX64 }, 'E_BAD_GITSHA'],
    ['uppercase baseCommit', { baseCommit: GITSHA.toUpperCase() }, 'E_BAD_GITSHA'],
    ['whitespace-padded digest', { outputDigest: ` ${HEX64B.slice(1)}` }, 'E_BAD_SHA'],
    ['numeric digest', { inputDigest: 123 as unknown }, 'E_BAD_SHA'],
  ];
  for (const [name, patch, code] of cases) {
    it(name, () => expectErr(validateSwarmRunBody(goodBody(patch)), code));
  }

  it('a tampered runDigest fails the envelope echo', () => {
    const env = sealSwarmRunEvidence(goodBody());
    const flipped = env.runDigest[0] === '0' ? '1' + env.runDigest.slice(1) : '0' + env.runDigest.slice(1);
    expectErr(validateSwarmRunEnvelope({ body: env.body, runDigest: flipped }), 'E_DIGEST_MISMATCH');
    expect(verifySwarmRunEnvelope({ body: env.body, runDigest: flipped })).toBe(false);
  });

  it('planted tamper: any post-seal body mutation is detected by verify', () => {
    const env = sealSwarmRunEvidence(goodBody());
    const dirty = JSON.parse(JSON.stringify(env)) as { body: Record<string, unknown>; runDigest: string };
    dirty.body.taskId = 'r57-brick-2.proposal-02';
    expect(verifySwarmRunEnvelope(dirty)).toBe(false);
  });
});

describe('R57: adversarial — missing/broken provenance', () => {
  for (const field of ['baseCommit', 'model', 'harnessVersion', 'execution', 'inputDigest', 'epistemicSource'] as const) {
    it(`missing ${field} fails closed`, () => {
      const b = goodBody() as unknown as Record<string, unknown>;
      delete b[field];
      expectErr(validateSwarmRunBody(b), 'E_MISSING_FIELD', field);
    });
  }

  it('missing execution.runner (who ran it) fails closed', () => {
    const ex = { ...goodBody().execution } as unknown as Record<string, unknown>;
    delete ex.runner;
    expectErr(validateSwarmRunBody(goodBody({ execution: ex })), 'E_MISSING_FIELD', 'runner');
  });

  it('timestamps below the plausibility floor are refused (zeroed clock)', () => {
    const ex = { ...goodBody().execution, startedAtMs: 0, completedAtMs: 0 };
    expectErr(validateSwarmRunBody(goodBody({ execution: ex })), 'E_TIME_RANGE');
    expect(EPOCH_MIN_MS).toBe(1577836800000);
  });

  it('completion before start is refused', () => {
    const ex = { ...goodBody().execution, startedAtMs: T0 + 1000, completedAtMs: T0 };
    expectErr(validateSwarmRunBody(goodBody({ execution: ex })), 'E_TIME_ORDER');
  });

  it('non-integer timestamps are refused', () => {
    const ex = { ...goodBody().execution, startedAtMs: T0 + 0.5 };
    expectErr(validateSwarmRunBody(goodBody({ execution: ex })), 'E_BAD_INTEGER');
  });
});

describe('R57: adversarial — embedded plaintext and secrets', () => {
  it('a prompt smuggled into taskId is refused by the label wall', () => {
    expectErr(validateSwarmRunBody(goodBody({ taskId: 'Please summarize the internal design of the authority kernel and paste it here for me' })), 'E_BAD_LABEL', 'taskId');
  });

  it('raw output text cannot pose as a digest', () => {
    expectErr(validateSwarmRunBody(goodBody({ outputDigest: 'The mutation retries three times before settling; see convex/memory.ts.' })), 'E_BAD_SHA');
  });

  it('provider tokens in label fields are refused (synthetic vectors)', () => {
    expectErr(validateSwarmRunBody(goodBody({ taskId: 'hf_ABCDefghIJKLmnopQRSTuvwx12345678' })), 'E_SECRET_CONTENT', 'taskId');
    expectErr(validateSwarmRunBody(goodBody({ harnessVersion: 'tml_ABCdef123456789012' })), 'E_SECRET_CONTENT', 'harnessVersion');
  });

  it('donor-catalogue secret shapes in label fields are refused (synthetic vectors)', () => {
    expectErr(validateSwarmRunBody(goodBody({ model: { id: 'AKIA' + 'A1B2C3D4E5F6G7H8'.slice(0, 16), revision: 'r1' } })), 'E_SECRET_CONTENT', 'model.id');
    const ex = { ...goodBody().execution, runner: 'npm_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7' };
    expectErr(validateSwarmRunBody(goodBody({ execution: ex })), 'E_SECRET_CONTENT', 'runner');
  });

  it('sanitizing builder digests raws and the sealed envelope contains no raw content', () => {
    const secretish = 'the vault passphrase is korovavision-9000';
    const env = buildSwarmRunEvidenceV1({
      taskId: 'r57-sanitize-check',
      epistemicSource: 'MODEL_GENERATED',
      model: { id: 'local/fable-worker', revision: 'r57.0' },
      harnessVersion: 'swarm-harness-0.1.0',
      baseCommit: GITSHA,
      rawInput: `PROMPT WITH PAYLOAD: ${secretish}`,
      rawOutput: 'a long raw model answer that must never be published anywhere in the envelope',
      execution: { outcome: 'completed', startedAtMs: T0, completedAtMs: T0 + 1000, runner: 'sam2-local-seat', sandboxed: true, networkEgress: 'none' },
    });
    const wire = JSON.stringify(env);
    expect(wire).not.toContain('PAYLOAD');
    expect(wire).not.toContain('korovavision');
    expect(wire).not.toContain('raw model answer');
    expect(env.body.inputDigest).toBe(sha256OfUtf8(`PROMPT WITH PAYLOAD: ${secretish}`));
    expect(env.body.outputDigest).toBe(sha256OfUtf8('a long raw model answer that must never be published anywhere in the envelope'));
  });

  it('NFC discipline: a non-NFC label is refused', () => {
    expectErr(validateSwarmRunBody(goodBody({ taskId: 'r57-étude' })), 'E_BAD_LABEL', 'taskId');
  });
});

describe('R57: adversarial — inconsistent outcome combinations', () => {
  const governed = (outcome: string) => ({ outcome, classifierVersion: 'clf-1.2.0', decidedAtMs: T0 + 120_000 });

  it('transport-failed + accepted is a contradiction', () => {
    const b = goodBody({ outputDigest: null, execution: { ...goodBody().execution, outcome: 'transport-failed' }, governance: governed('accepted') });
    expectErr(validateSwarmRunBody(b), 'E_OUTCOME_CONTRADICTION', 'governance.outcome');
  });

  it('refused + accepted is a contradiction', () => {
    const b = goodBody({ execution: { ...goodBody().execution, outcome: 'refused' }, governance: governed('accepted') });
    expectErr(validateSwarmRunBody(b), 'E_OUTCOME_CONTRADICTION', 'governance.outcome');
  });

  it('timed-out + accepted is a contradiction', () => {
    const b = goodBody({ execution: { ...goodBody().execution, outcome: 'timed-out' }, governance: governed('accepted') });
    expectErr(validateSwarmRunBody(b), 'E_OUTCOME_CONTRADICTION', 'governance.outcome');
  });

  it('accepted with no output digest is a contradiction (accepting nothing)', () => {
    const b = goodBody({ outputDigest: null, governance: governed('accepted') });
    expectErr(validateSwarmRunBody(b), 'E_OUTCOME_CONTRADICTION', 'outputDigest');
  });

  it('transport-failed with an output digest is a fabrication', () => {
    const b = goodBody({ execution: { ...goodBody().execution, outcome: 'transport-failed' } });
    expectErr(validateSwarmRunBody(b), 'E_OUTCOME_CONTRADICTION', 'outputDigest');
  });

  it('governed outcome without classifier version / decision time fails closed', () => {
    expectErr(validateSwarmRunBody(goodBody({ governance: { outcome: 'rejected', classifierVersion: null, decidedAtMs: T0 + 1 } })), 'E_GOVERNANCE_INCOMPLETE', 'classifierVersion');
    expectErr(validateSwarmRunBody(goodBody({ governance: { outcome: 'quarantined', classifierVersion: 'clf-1.2.0', decidedAtMs: null } })), 'E_GOVERNANCE_INCOMPLETE', 'decidedAtMs');
  });

  it('ungoverned with decision fields is an overclaim-shaped inconsistency', () => {
    expectErr(validateSwarmRunBody(goodBody({ governance: { outcome: 'ungoverned', classifierVersion: 'clf-1.2.0', decidedAtMs: null } })), 'E_GOVERNANCE_INCOMPLETE');
    expectErr(validateSwarmRunBody(goodBody({ governance: { outcome: 'ungoverned', classifierVersion: null, decidedAtMs: T0 + 1 } })), 'E_GOVERNANCE_INCOMPLETE');
  });

  it('a governance decision timestamped before execution completed is refused', () => {
    const b = goodBody({ governance: { outcome: 'rejected', classifierVersion: 'clf-1.2.0', decidedAtMs: T0 + 1000 } });
    // execution completes at T0+60000; decision at T0+1000 precedes it.
    expectErr(validateSwarmRunBody(b), 'E_TIME_ORDER', 'decidedAtMs');
  });

  it('governSwarmRunEvidence refuses an illegal acceptance at the door', () => {
    const refusedRun = buildSwarmRunEvidenceV1({
      taskId: 'r57-refusal', epistemicSource: 'LOCAL_MEASUREMENT',
      model: { id: 'local/fable-worker', revision: 'r57.0' },
      harnessVersion: 'swarm-harness-0.1.0', baseCommit: GITSHA,
      rawInput: 'in', rawOutput: 'refusal text',
      execution: { outcome: 'refused', startedAtMs: T0, completedAtMs: T0 + 1000, runner: 'sam2-local-seat', sandboxed: true, networkEgress: 'none' },
    });
    expect(() => governSwarmRunEvidence(refusedRun, { outcome: 'accepted', classifierVersion: 'clf-1.2.0', decidedAtMs: T0 + 2000 }))
      .toThrow(/E_OUTCOME_CONTRADICTION/);
    // ...but quarantining the same refused run is legal.
    const q = governSwarmRunEvidence(refusedRun, { outcome: 'quarantined', classifierVersion: 'clf-1.2.0', decidedAtMs: T0 + 2000 });
    expect(q.body.governance.outcome).toBe('quarantined');
  });

  it('governSwarmRunEvidence refuses to re-govern an already-governed envelope', () => {
    const run = buildSwarmRunEvidenceV1({
      taskId: 'r57-once', epistemicSource: 'LOCAL_MEASUREMENT',
      model: { id: 'local/fable-worker', revision: 'r57.0' },
      harnessVersion: 'swarm-harness-0.1.0', baseCommit: GITSHA,
      rawInput: 'in', rawOutput: 'out',
      execution: { outcome: 'completed', startedAtMs: T0, completedAtMs: T0 + 1000, runner: 'sam2-local-seat', sandboxed: true, networkEgress: 'none' },
    });
    const once = governSwarmRunEvidence(run, { outcome: 'accepted', classifierVersion: 'clf-1.2.0', decidedAtMs: T0 + 2000 });
    expect(() => governSwarmRunEvidence(once, { outcome: 'rejected', classifierVersion: 'clf-1.2.0', decidedAtMs: T0 + 3000 }))
      .toThrow(/E_OUTCOME_CONTRADICTION/);
  });
});

describe('R57: adversarial — unknown versions, unknown members, unknown fields', () => {
  it('unknown schema version fails closed', () => {
    expectErr(validateSwarmRunBody(goodBody({ schema: 'aukora-swarm-run-evidence-v2' })), 'E_SCHEMA');
    expectErr(validateSwarmRunBody(goodBody({ schema: 'aukora-fu-evidence-pack-v1' })), 'E_SCHEMA');
  });

  it('advisory literals cannot be weakened', () => {
    expectErr(validateSwarmRunBody(goodBody({ advisoryOnly: false })), 'E_ADVISORY_LITERAL');
    expectErr(validateSwarmRunBody(goodBody({ grantsAuthority: true })), 'E_ADVISORY_LITERAL');
  });

  it('unknown enum members fail closed (no silent widening)', () => {
    expectErr(validateSwarmRunBody(goodBody({ epistemicSource: 'TRUSTED' })), 'E_BAD_ENUM', 'epistemicSource');
    expectErr(validateSwarmRunBody(goodBody({ execution: { ...goodBody().execution, outcome: 'succeeded' } })), 'E_BAD_ENUM', 'execution.outcome');
    expectErr(validateSwarmRunBody(goodBody({ governance: { outcome: 'approved', classifierVersion: 'clf-1', decidedAtMs: T0 + 120_000 } })), 'E_BAD_ENUM', 'governance.outcome');
    expectErr(validateSwarmRunBody(goodBody({ execution: { ...goodBody().execution, networkEgress: 'full' } })), 'E_BAD_ENUM', 'networkEgress');
  });

  it('unknown extra fields fail closed (positive allowlist)', () => {
    expectErr(validateSwarmRunBody(goodBody({ rawOutput: 'smuggled payload' } as Record<string, unknown>)), 'E_UNKNOWN_FIELD');
    expectErr(validateSwarmRunBody(goodBody({ governance: { outcome: 'ungoverned', classifierVersion: null, decidedAtMs: null, note: 'lgtm' } })), 'E_UNKNOWN_FIELD');
  });

  it('non-ordinary objects fail closed (accessor / prototype games)', () => {
    const b = goodBody() as unknown as Record<string, unknown>;
    let reads = 0;
    Object.defineProperty(b, 'taskId', { get() { reads++; return reads > 1 ? 'evil' : 'r57-clean'; }, enumerable: true, configurable: true });
    expectErr(validateSwarmRunBody(b), 'E_PROTO');
    expect(verifySwarmRunEnvelope({ body: b, runDigest: HEX64 })).toBe(false);
  });

  it('the envelope wrapper is also a closed surface', () => {
    const env = sealSwarmRunEvidence(goodBody());
    expectErr(validateSwarmRunEnvelope({ body: env.body, runDigest: env.runDigest, signature: 'trust-me' }), 'E_UNKNOWN_FIELD');
    expectErr(validateSwarmRunEnvelope({ body: env.body }), 'E_MISSING_FIELD', 'runDigest');
  });
});

describe('R57: adversarial — epistemic overclaiming (KIRA promotion boundary)', () => {
  const accepted = { outcome: 'accepted', classifierVersion: 'clf-1.2.0', decidedAtMs: T0 + 120_000 };

  for (const source of ['EXTERNAL_RESEARCH', 'MODEL_GENERATED', 'SELF_REPORTED'] as const) {
    it(`${source} + accepted is an epistemic overclaim`, () => {
      expectErr(validateSwarmRunBody(goodBody({ epistemicSource: source, governance: accepted })), 'E_EPISTEMIC_OVERCLAIM', 'epistemicSource');
    });
    it(`${source} may still be quarantined or rejected (no over-refusal)`, () => {
      expect(validateSwarmRunBody(goodBody({ epistemicSource: source, governance: { ...accepted, outcome: 'quarantined' } })).ok).toBe(true);
      expect(validateSwarmRunBody(goodBody({ epistemicSource: source, governance: { ...accepted, outcome: 'rejected' } })).ok).toBe(true);
    });
  }

  it('only the LOCAL_* sources are acceptance-eligible', () => {
    expect([...ACCEPTANCE_ELIGIBLE_SOURCES].sort()).toEqual(['LOCAL_MEASUREMENT', 'LOCAL_REPRODUCTION']);
    for (const source of ACCEPTANCE_ELIGIBLE_SOURCES) {
      expect(validateSwarmRunBody(goodBody({ epistemicSource: source, governance: accepted })).ok).toBe(true);
    }
  });
});

describe('R57: digest domain separation and totality', () => {
  it('the swarm-run digest differs from an undomained sha256 of the canonical bytes', () => {
    const body = goodBody();
    expect(swarmRunDigest(body)).not.toBe(sha256OfUtf8(JSON.stringify(body)));
  });

  it('verify is total on hostile input — never throws', () => {
    for (const hostile of [null, undefined, 42, 'string', [], { body: null, runDigest: HEX64 }, { body: { schema: -0 }, runDigest: HEX64 }]) {
      expect(() => verifySwarmRunEnvelope(hostile)).not.toThrow();
      expect(verifySwarmRunEnvelope(hostile)).toBe(false);
    }
  });

  it('sealing an invalid body throws code:path and seals nothing', () => {
    expect(() => sealSwarmRunEvidence(goodBody({ baseCommit: 'HEAD' }))).toThrow(/E_BAD_GITSHA:body\.baseCommit/);
  });
});
