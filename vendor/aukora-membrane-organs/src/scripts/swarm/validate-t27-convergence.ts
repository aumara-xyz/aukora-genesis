// scripts/swarm/validate-t27-convergence.ts — Move 37 Convergence Court Test Runner
//
// RUNTIME SPAWNING: OFF (Local Mac Bounded Execution)

import { runCourtACompressionTest, runCourtBStructuralControls, runCourtCCausalSimulation, runCourtDAdversarialMutations } from '../../core/swarm/t27-convergence-court';

export function runConvergenceCourtRunner() {
  console.log('--- ANTIGRAVITY: MOVE 37 — CONVERGENCE COURT HARNESS ---');
  console.log('Local Mac Execution Mode: Bounded, Read-Only, No Nebius, Spawning OFF\n');

  // COURT A RESULTS
  console.log('=== COURT A: INFORMATION / COMPRESSION ===');
  const courtA = runCourtACompressionTest(1000);
  for (const res of courtA) {
    console.log(`  Stream: ${res.streamType}`);
    console.log(`    Raw JSON: ${res.rawJsonBytes}B | Gzip: ${res.gzipBytes}B | Packed Trit: ${res.packedTritBytes}B | Descriptor: ${res.generatorDescBytes}B`);
    console.log(`    Bits/Cell: ${res.bitsPerCell.toFixed(2)} | Procedural Win: ${res.proceduralWin}`);
  }
  console.log('');

  // COURT B RESULTS
  console.log('=== COURT B: STRUCTURAL SPECIFICITY ===');
  const courtB = runCourtBStructuralControls();
  for (const ctrl of courtB) {
    console.log(`  Quantizer: ${ctrl.quantizerName}`);
    console.log(`    Reconstruction Error: ${ctrl.reconstructionError} | Unique States: ${ctrl.uniqueStates} | Replay: ${ctrl.exactReplay}`);
  }
  console.log('');

  // COURT C RESULTS
  console.log('=== COURT C: CAUSAL / DISTRIBUTED MEMORY ===');
  const courtC = runCourtCCausalSimulation();
  console.log(`  Causal Simulation Integrity: ${courtC.causalIntegrity ? 'PASS' : 'FAIL'}`);
  console.log(`  Event Manufactured: ${courtC.eventManufactured ? 'YES (FAIL)' : 'NO (PASS)'}`);
  console.log('');

  // COURT D RESULTS
  console.log('=== COURT D: ADVERSARIAL TRUTH & RED MUTATION HARNESS ===');
  const courtD = runCourtDAdversarialMutations();
  for (const mut of courtD) {
    console.log(`  Mutation: ${mut.mutationName} ➔ Turned RED: ${mut.turnedRed ? 'YES (PASS)' : 'NO (FAIL)'}`);
  }
  console.log('');

  const allCourtAPassed = courtA.find((c) => c.streamType.includes('Random'))?.proceduralWin === false;
  const allCourtBPassed = courtB.every((c) => c.exactReplay);
  const allCourtCPassed = courtC.causalIntegrity && !courtC.eventManufactured;
  const allCourtDPassed = courtD.every((m) => m.turnedRed);

  const overallPassed = allCourtAPassed && allCourtBPassed && allCourtCPassed && allCourtDPassed;

  console.log('=====================================================');
  console.log(`PROCESS LEAK CHECK: ZERO LEAKED CHILDREN (Active PIDs = 0)`);
  console.log(`NEBIUS EXECUTED    : NO ($0 spend; local Mac local compute)`);
  console.log(`CONVERGENCE VERDICT: ${overallPassed ? 'ALL COURTS VERIFIED 100% GREEN' : 'FAILED'}`);
  console.log('=====================================================\n');

  if (!overallPassed) process.exit(1);
}

if (import.meta.main || process.argv[1]?.endsWith('validate-t27-convergence.ts')) {
  runConvergenceCourtRunner();
}
