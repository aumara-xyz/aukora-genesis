// scripts/swarm/validate-i1-aura-conformance.ts — Brick I1A.1: Living Aura Conformance Harness
//
// Imports production core module core/aura-reducer.ts and donor formulas from organs/aura/walsh.ts.
// Executes 10 required golden-vector conformance gates + 4 disposable mutation RED tests.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  reduceAuraState,
  verifyAndReduceAuraState,
  verifyAuraReceiptHistory,
  encodeWalshAngles,
  decodeWalshAngles,
  type AuraStateV1,
  type SettledReceiptInput,
} from '../../core/aura-reducer';
import { synth6, analyze6 } from '../../organs/aura/walsh';

const sha256hex = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

export interface ConformanceTestResultV1 {
  gateId: string;
  name: string;
  passed: boolean;
  rawObservation: string;
}

export function run10I1AConformanceGates(): ConformanceTestResultV1[] {
  const gates: ConformanceTestResultV1[] = [];
  const seed = sha256hex('aukora-membrane-golden-seed-v1');

  const history1: SettledReceiptInput[] = [
    { event: 'DELEGATED', payloadDigest: sha256hex('brief-1'), status: 'settled', seq: 0 },
    { event: 'ENGINE_STARTED', payloadDigest: sha256hex('crush-1'), status: 'settled', seq: 1 },
    { event: 'EFFECT_AUTHORIZED', payloadDigest: sha256hex('src/alpha.ts'), status: 'settled', seq: 2 },
    { event: 'RESULT_PROPOSED', payloadDigest: sha256hex('proposal-1'), status: 'settled', seq: 3 },
  ];

  // Gate 1: Identical histories ➔ byte-identical serialized Aura
  {
    const resA = verifyAndReduceAuraState(seed, history1);
    const resB = verifyAndReduceAuraState(seed, history1);
    const serA = JSON.stringify(resA.state);
    const serB = JSON.stringify(resB.state);
    const passed = resA.ok && resB.ok && serA === serB;
    gates.push({
      gateId: 'G1-BYTE-IDENTICAL',
      name: 'Identical histories produce byte-identical serialized Aura state',
      passed,
      rawObservation: `serA === serB: ${passed} (digest=${sha256hex(serA)})`,
    });
  }

  // Gate 2: One settled receipt mutation ➔ named deterministic state change
  {
    const historyMutated: SettledReceiptInput[] = [
      { event: 'DELEGATED', payloadDigest: sha256hex('brief-1'), status: 'settled', seq: 0 },
      { event: 'ENGINE_STARTED', payloadDigest: sha256hex('crush-1'), status: 'settled', seq: 1 },
      { event: 'EFFECT_AUTHORIZED', payloadDigest: sha256hex('src/alpha.ts'), status: 'settled', seq: 2 },
      { event: 'RESULT_PROPOSED', payloadDigest: sha256hex('proposal-1-MUTATED'), status: 'settled', seq: 3 },
    ];
    const resOrig = verifyAndReduceAuraState(seed, history1);
    const resMut = verifyAndReduceAuraState(seed, historyMutated);
    const passed = resOrig.ok && resMut.ok && resOrig.state!.breath !== resMut.state!.breath && resOrig.state!.standing !== resMut.state!.standing;
    gates.push({
      gateId: 'G2-MUTATION-STATE-CHANGE',
      name: 'One settled receipt mutation produces named deterministic state change',
      passed,
      rawObservation: `standing: ${resOrig.state!.standing.slice(0, 16)} ➔ ${resMut.state!.standing.slice(0, 16)}`,
    });
  }

  // Gate 3: Reordered/swapped history ➔ refused by chain boundary with named reason
  {
    const historySwapped: SettledReceiptInput[] = [
      history1[1], // seq 1 at index 0 (sequence break!)
      history1[0],
      history1[2],
      history1[3],
    ];
    const resSwap = verifyAndReduceAuraState(seed, historySwapped);
    const passed = !resSwap.ok && resSwap.breakReason !== null && resSwap.breakReason.includes('chain:sequence-break');
    gates.push({
      gateId: 'G3-SWAPPED-HISTORY-REFUSED',
      name: 'Reordered/swapped history refused by chain boundary with named reason',
      passed,
      rawObservation: `resSwap.ok=${resSwap.ok}, breakReason=${resSwap.breakReason}`,
    });
  }

  // Gate 4: Attention-only changes ➔ identity digest unchanged (identityBound: false)
  {
    const resNoAtt = verifyAndReduceAuraState(seed, history1, undefined);
    const resWithAtt = verifyAndReduceAuraState(seed, history1, 0.95);
    const serA = JSON.stringify(resNoAtt.state);
    const serB = JSON.stringify(resWithAtt.state);
    const passed = resNoAtt.ok && resWithAtt.ok && serA === serB && resNoAtt.state!.identityBound === false;
    gates.push({
      gateId: 'G4-ATTENTION-ISOLATION',
      name: 'Attention-only presentation changes leave identity digest unchanged',
      passed,
      rawObservation: `serA === serB: ${passed}, identityBound: ${resNoAtt.state?.identityBound}`,
    });
  }

  // Gate 5: Refusal/success/failure/interrupted classes produce documented state transitions
  {
    const historyFail: SettledReceiptInput[] = [
      ...history1,
      { event: 'REFUSAL', payloadDigest: sha256hex('parent:path-traversal-refused'), status: 'settled', seq: 4 },
    ];
    const historyInterrupted: SettledReceiptInput[] = [
      ...history1,
      { event: 'INTERRUPTED', payloadDigest: sha256hex('parent:child-killed-mid-effect'), status: 'settled', seq: 4 },
    ];

    const resSucc = verifyAndReduceAuraState(seed, history1);
    const resFail = verifyAndReduceAuraState(seed, historyFail);
    const resInter = verifyAndReduceAuraState(seed, historyInterrupted);

    const passed = resSucc.ok && resFail.ok && resInter.ok &&
      resSucc.state!.breath !== resFail.state!.breath &&
      resFail.state!.breath !== resInter.state!.breath;

    gates.push({
      gateId: 'G5-DOCUMENTED-TRANSITIONS',
      name: 'Refusal/success/failure/interrupted produce distinct documented state transitions',
      passed,
      rawObservation: `Fail breath=${resFail.state?.breath.slice(0, 12)}, Interrupted breath=${resInter.state?.breath.slice(0, 12)}`,
    });
  }

  // Gate 6: Walsh encode/decode round-trip accurate to <1e-12
  {
    const testAngles: [number, number, number, number, number, number] = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
    const field = encodeWalshAngles(testAngles);
    const decoded = decodeWalshAngles(field);
    let maxDiff = 0;
    for (let i = 0; i < 6; i++) {
      const diff = Math.abs(testAngles[i] - decoded[i]);
      if (diff > maxDiff) maxDiff = diff;
    }
    const passed = maxDiff < 1e-12;
    gates.push({
      gateId: 'G6-WALSH-ROUNDTRIP',
      name: 'Walsh SO(4) 16-vertex encode/decode round-trip accurate to <1e-12',
      passed,
      rawObservation: `Walsh round-trip max error: ${maxDiff.toExponential(3)}`,
    });
  }

  // Gate 7: Two independent processes produce identical vectors
  {
    if (process.env.I1A_IS_MUTATION === '1') {
      const resA = verifyAndReduceAuraState(seed, history1);
      const resB = verifyAndReduceAuraState(seed, history1);
      const str1 = JSON.stringify(resA);
      const str2 = JSON.stringify(resB);
      gates.push({
        gateId: 'G7-INDEPENDENT-PROCESSES',
        name: 'Two independent subprocesses produce byte-identical vector output',
        passed: resA.ok && str1 === str2,
        rawObservation: `In-memory mutation mode match=${str1 === str2}`,
      });
    } else {
      const env = { ...process.env, I1A_IS_MUTATION: '1' };
      const proc1 = spawnSync('bun', ['-e', `import { verifyAndReduceAuraState } from "./core/aura-reducer"; console.log(JSON.stringify(verifyAndReduceAuraState("${seed}", ${JSON.stringify(history1)})));`], { cwd: process.cwd(), env, encoding: 'utf8' });
      const proc2 = spawnSync('bun', ['-e', `import { verifyAndReduceAuraState } from "./core/aura-reducer"; console.log(JSON.stringify(verifyAndReduceAuraState("${seed}", ${JSON.stringify(history1)})));`], { cwd: process.cwd(), env, encoding: 'utf8' });

      const str1 = proc1.stdout ? proc1.stdout.trim() : '';
      const str2 = proc2.stdout ? proc2.stdout.trim() : '';
      const passed = proc1.status === 0 && proc2.status === 0 && str1 !== '' && str1 === str2;
      gates.push({
        gateId: 'G7-INDEPENDENT-PROCESSES',
        name: 'Two independent subprocesses produce byte-identical vector output',
        passed,
        rawObservation: `proc1 exit=${proc1.status}, proc2 exit=${proc2.status}, match=${str1 === str2}`,
      });
    }
  }

  // Gate 8: Date.now / Math.random mutations turn gates RED
  {
    const sourceCode = readFileSync(join(process.cwd(), 'core', 'aura-reducer.ts'), 'utf8');
    const hasDate = sourceCode.includes('Date.') || sourceCode.includes('new Date');
    const hasMathRandom = sourceCode.includes('Math.random');
    const passed = !hasDate && !hasMathRandom;
    gates.push({
      gateId: 'G8-ZERO-CLOCK-ENTROPY',
      name: 'Production core/aura-reducer.ts contains zero Date/Math.random dependencies',
      passed,
      rawObservation: `hasDate=${hasDate}, hasMathRandom=${hasMathRandom}`,
    });
  }

  // Gate 9: Donor golden vectors (organs/aura/walsh.ts synth6/analyze6) agree with adapter
  {
    const donorField = synth6([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    const donorDecoded = analyze6(donorField);
    const adapterDecoded = decodeWalshAngles(encodeWalshAngles([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]));
    let maxDiff = 0;
    for (let i = 0; i < 6; i++) {
      const diff = Math.abs(donorDecoded[i] - adapterDecoded[i]);
      if (diff > maxDiff) maxDiff = diff;
    }
    const passed = maxDiff < 1e-12;
    gates.push({
      gateId: 'G9-DONOR-AGREEMENT',
      name: 'Donor organs/aura/walsh.ts (synth6/analyze6) agree 100% with production adapter',
      passed,
      rawObservation: `Donor vs Adapter max diff: ${maxDiff.toExponential(3)}`,
    });
  }

  // Gate 10: Unsettled receipts and unknown classes fail closed
  {
    const historyUnsettled: SettledReceiptInput[] = [
      { event: 'DELEGATED', payloadDigest: sha256hex('brief-1'), status: 'pending', seq: 0 },
    ];
    const resUnset = verifyAndReduceAuraState(seed, historyUnsettled);
    const passed = !resUnset.ok && resUnset.breakReason?.includes('receipt:unsettled-excluded');
    gates.push({
      gateId: 'G10-UNSETTLED-REFUSED',
      name: 'Unsettled receipts refused by chain boundary with named reason',
      passed: Boolean(passed),
      rawObservation: `resUnset.ok=${resUnset.ok}, breakReason=${resUnset.breakReason}`,
    });
  }

  return gates;
}

// Disposable Mutation RED Tests
export function runI1AMutationTests(): {
  bypassVerificationTurnedRed: boolean;
  unsettledAdmitTurnedRed: boolean;
  clockMutationTurnedRed: boolean;
  walshAlterTurnedRed: boolean;
} {
  const tmpDir = join('/tmp', `i1a1-mut-${sha256hex(String(Math.random())).slice(0, 8)}`);
  mkdirSync(join(tmpDir, 'core'), { recursive: true });
  mkdirSync(join(tmpDir, 'organs', 'aura'), { recursive: true });
  mkdirSync(join(tmpDir, 'scripts', 'swarm'), { recursive: true });

  copyFileSync(join(process.cwd(), 'core', 'aura-reducer.ts'), join(tmpDir, 'core', 'aura-reducer.ts'));
  copyFileSync(join(process.cwd(), 'organs', 'aura', 'walsh.ts'), join(tmpDir, 'organs', 'aura', 'walsh.ts'));
  copyFileSync(join(process.cwd(), 'scripts', 'swarm', 'validate-i1-aura-conformance.ts'), join(tmpDir, 'scripts', 'swarm', 'validate-i1-aura-conformance.ts'));

  const targetFile = join(tmpDir, 'core', 'aura-reducer.ts');
  let originalCode = readFileSync(targetFile, 'utf8');

  const env = { ...process.env, I1A_IS_MUTATION: '1' };

  // Mutation 1: Bypass chain verification in verifyAndReduceAuraState
  const mut1Code = originalCode.replace(
    'if (!verification.ok) {\n    return { ok: false, breakReason: verification.breakReason, state: null };\n  }',
    '// Bypassed chain verification\n  '
  );
  writeFileSync(targetFile, mut1Code, 'utf8');
  const proc1 = spawnSync('bun', ['run', 'scripts/swarm/validate-i1-aura-conformance.ts'], { cwd: tmpDir, env, encoding: 'utf8' });
  const bypassVerificationTurnedRed = proc1.status !== 0 || (proc1.stdout + proc1.stderr).includes('FAIL');

  // Mutation 2: Admit unsettled receipts in verifyAuraReceiptHistory
  const mut2Code = originalCode.replace(
    "if (r.status && r.status !== 'settled') {",
    "if (false && r.status && r.status !== 'settled') {"
  );
  writeFileSync(targetFile, mut2Code, 'utf8');
  const proc2 = spawnSync('bun', ['run', 'scripts/swarm/validate-i1-aura-conformance.ts'], { cwd: tmpDir, env, encoding: 'utf8' });
  const unsettledAdmitTurnedRed = proc2.status !== 0 || (proc2.stdout + proc2.stderr).includes('FAIL');

  // Mutation 3: Inject Date.now into reducer standing hash
  const mut3Code = originalCode.replace(
    'standing = sha256hex(`${standing}:seq:${i}:${r.event}:${r.payloadDigest}:${classTransitionMarker}`);',
    'standing = sha256hex(`${standing}:seq:${i}:${r.event}:${r.payloadDigest}:${classTransitionMarker}:${Date.now()}`);'
  );
  writeFileSync(targetFile, mut3Code, 'utf8');
  const proc3 = spawnSync('bun', ['run', 'scripts/swarm/validate-i1-aura-conformance.ts'], { cwd: tmpDir, env, encoding: 'utf8' });
  const clockMutationTurnedRed = proc3.status !== 0 || (proc3.stdout + proc3.stderr).includes('FAIL');

  // Mutation 4: Alter donor Walsh coefficient scaling in organs/aura/walsh.ts
  const walshFile = join(tmpDir, 'organs', 'aura', 'walsh.ts');
  const walshCode = readFileSync(walshFile, 'utf8');
  const mut4Code = walshCode.replace('out[m] = s / 16;', 'out[m] = s / 15;');
  writeFileSync(walshFile, mut4Code, 'utf8');
  writeFileSync(targetFile, originalCode, 'utf8');
  const proc4 = spawnSync('bun', ['run', 'scripts/swarm/validate-i1-aura-conformance.ts'], { cwd: tmpDir, env, encoding: 'utf8' });
  const walshAlterTurnedRed = proc4.status !== 0 || (proc4.stdout + proc4.stderr).includes('FAIL');

  rmSync(tmpDir, { recursive: true, force: true });
  return { bypassVerificationTurnedRed, unsettledAdmitTurnedRed, clockMutationTurnedRed, walshAlterTurnedRed };
}

export function runI1AHarness() {
  console.log('--- I1A.1 LIVING AURA CONFORMANCE HARNESS ---');
  const gates = run10I1AConformanceGates();
  let allPassed = true;
  for (const g of gates) {
    if (!g.passed) allPassed = false;
    console.log(`  ${g.passed ? 'ok  ' : 'FAIL'} ${g.gateId}: ${g.name} ➔ ${g.rawObservation}`);
  }
  console.log('');

  if (process.env.I1A_IS_MUTATION === '1') {
    if (!allPassed) process.exit(1);
    return;
  }

  const muts = runI1AMutationTests();
  console.log('Disposable Mutation RED Tests (4/4):');
  console.log(`  ${muts.bypassVerificationTurnedRed ? 'ok  ' : 'FAIL'} Bypass chain verification turns suite RED`);
  console.log(`  ${muts.unsettledAdmitTurnedRed ? 'ok  ' : 'FAIL'} Admit unsettled receipt turns suite RED`);
  console.log(`  ${muts.clockMutationTurnedRed ? 'ok  ' : 'FAIL'} Clock mutation turns suite RED`);
  console.log(`  ${muts.walshAlterTurnedRed ? 'ok  ' : 'FAIL'} Alter donor Walsh coefficient turns suite RED`);
  console.log('');

  const mutsPassed = muts.bypassVerificationTurnedRed && muts.unsettledAdmitTurnedRed && muts.clockMutationTurnedRed && muts.walshAlterTurnedRed;
  console.log(`Actual Status: ${allPassed && mutsPassed ? 'LANDED DORMANT MODULE / NOT RUNTIME-WIRED' : 'FAILED'}`);
}

if (import.meta.main || process.argv[1]?.endsWith('validate-i1-aura-conformance.ts')) {
  runI1AHarness();
}
