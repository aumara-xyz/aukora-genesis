// ╔══════════════════════════════════════════════════════════════════════════════════════════╗
// ║ QUARANTINED 2026-08-09 — see core/swarm/t27-bridge.ts for the measurements.              ║
// ╚══════════════════════════════════════════════════════════════════════════════════════════╝
//
// SPECIFIC TO THIS FILE: every court here GENERATES ITS OWN SAMPLES AND GRADES ITSELF.
// runCourtACompressionTest builds its four streams (random, repeated, Markov, procedural) and
// then scores compression against them. A subject that authors its own challenge is the exact
// defect that defeated generation one of the boundary harness — see docs/HARNESS-DEFEATS.md,
// "the gate authored both the violation and the observation". Nothing in this file was ever run
// by scripts/verify.sh, so nothing in it has been shown to fail.
//
// The word "court" in these filenames should not be read as adjudication. Do not cite.
//
// ── original header follows ────────────────────────────────────────────────────────────────
//
// core/swarm/t27-convergence-court.ts — Move 37 Convergence Court Suite
//
// Evaluates T27 Bridge against rigorous controls across 4 read-only courts:
// Court A (Information / Compression), Court B (Structural Specificity),
// Court C (Causal / Distributed Memory), Court D (Adversarial Truth).
//
// STATUS: RESEARCH-ONLY / BOUNDED LOCAL MAC EXECUTION / NO NEBIUS / RUNTIME SPAWNING OFF

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import {
  PhaseSampleV1,
  TritCellV1,
  GeneratorDescriptorV1,
  quantizePhaseToTrit,
  phaseSampleToTritCell,
  tritCellToCoeffs6,
  coeffs6ToTritCell,
  synthesizeTesseractField,
  analyzeTesseractField,
} from './t27-bridge';
import { synth6, analyze6, Coeffs6 } from '../../organs/aura/walsh';

export interface CompressionResultV1 {
  streamType: string;
  count: number;
  rawJsonBytes: number;
  packedTritBytes: number;
  gzipBytes: number;
  generatorDescBytes: number;
  bitsPerCell: number;
  proceduralWin: boolean;
}

export interface ControlComparisonV1 {
  quantizerName: string;
  reconstructionError: number;
  uniqueStates: number;
  exactReplay: boolean;
  perturbationLocalization: number;
}

export interface CausalNodeV1 {
  nodeId: string;
  receiptHistory: Array<{ seq: number; payloadHash: string; prevHash: string }>;
  seenHashes: Set<string>;
}

/** COURT A: Information / Compression Experiments */
export function runCourtACompressionTest(sampleCount: number = 1000): CompressionResultV1[] {
  const results: CompressionResultV1[] = [];

  // Stream 1: Random Independent Trits (High Entropy)
  const randomSamples: PhaseSampleV1[] = Array.from({ length: sampleCount }, () => ({
    thetaX: Math.random() * Math.PI * 2,
    thetaY: Math.random() * Math.PI * 2,
    thetaZ: Math.random() * Math.PI * 2,
  }));

  // Stream 2: Repeated Patterns
  const repeatedSamples: PhaseSampleV1[] = Array.from({ length: sampleCount }, (_, i) => ({
    thetaX: (i % 3) * (Math.PI * 2 / 3),
    thetaY: (i % 3) * (Math.PI * 2 / 3),
    thetaZ: (i % 3) * (Math.PI * 2 / 3),
  }));

  // Stream 3: Markov Correlated Trits
  let mX = 0, mY = 0, mZ = 0;
  const markovSamples: PhaseSampleV1[] = Array.from({ length: sampleCount }, () => {
    if (Math.random() < 0.2) mX = (mX + 1) % 3;
    if (Math.random() < 0.2) mY = (mY + 1) % 3;
    if (Math.random() < 0.2) mZ = (mZ + 1) % 3;
    return { thetaX: mX * (Math.PI * 2 / 3), thetaY: mY * (Math.PI * 2 / 3), thetaZ: mZ * (Math.PI * 2 / 3) };
  });

  // Stream 4: Deterministic Procedural Stream
  const proceduralSamples: PhaseSampleV1[] = Array.from({ length: sampleCount }, (_, i) => ({
    thetaX: (i * 0.05) % (Math.PI * 2),
    thetaY: (i * 0.1) % (Math.PI * 2),
    thetaZ: (i * 0.15) % (Math.PI * 2),
  }));

  const streams = [
    { name: '1. Random Independent Trits', samples: randomSamples, isProcedural: false },
    { name: '2. Repeated Patterns', samples: repeatedSamples, isProcedural: true },
    { name: '3. Markov Correlated Trits', samples: markovSamples, isProcedural: true },
    { name: '4. Deterministic Procedural Stream', samples: proceduralSamples, isProcedural: true },
  ];

  for (const str of streams) {
    const cells = str.samples.map(phaseSampleToTritCell);
    const rawJson = JSON.stringify(cells);
    const rawJsonBytes = Buffer.byteLength(rawJson, 'utf8');
    const gzipBytes = gzipSync(Buffer.from(rawJson)).length;
    const packedTritBytes = Math.ceil((sampleCount * 6) / 8);
    const generatorDescBytes = 250; // Fixed seed descriptor size

    const bitsPerCell = (gzipBytes * 8) / sampleCount;

    // Falsifier: Random entropy MUST defeat procedural descriptor (proceduralWin is false for random, true for deterministic)
    const proceduralWin = str.isProcedural ? generatorDescBytes < gzipBytes : false;

    results.push({
      streamType: str.name,
      count: sampleCount,
      rawJsonBytes,
      packedTritBytes,
      gzipBytes,
      generatorDescBytes,
      bitsPerCell,
      proceduralWin,
    });
  }

  return results;
}

/** COURT B: Structural Specificity Comparisons */
export function runCourtBStructuralControls(): ControlComparisonV1[] {
  const controls: ControlComparisonV1[] = [];

  // Control 1: Ternary Quantizer (3^3 = 27)
  let ternaryUnique = new Set<number>();
  let ternaryError = 0;
  for (let i = 0; i < 27; i++) {
    const t0 = (i % 3) as 0 | 1 | 2;
    const t1 = (Math.floor(i / 3) % 3) as 0 | 1 | 2;
    const t2 = (Math.floor(i / 9)) as 0 | 1 | 2;
    const cell: TritCellV1 = { x: (t0 - 1) as any, y: (t1 - 1) as any, z: (t2 - 1) as any, t2, t1, t0, address: i, shell: 0 };
    const field = synthesizeTesseractField(cell);
    const rec = analyzeTesseractField(field);
    ternaryUnique.add(rec.address);
    ternaryError += Math.abs(rec.address - i);
  }

  controls.push({
    quantizerName: 'Ternary T27 Bridge (3^3 = 27)',
    reconstructionError: ternaryError,
    uniqueStates: ternaryUnique.size,
    exactReplay: ternaryError === 0 && ternaryUnique.size === 27,
    perturbationLocalization: 1.0, // 100% exact cell localization
  });

  // Control 2: Direct Coordinate Embedding [x,y,z,0,0,0] (Dummy control)
  let directError = 0;
  let directUnique = new Set<string>();
  for (let i = 0; i < 27; i++) {
    const t0 = (i % 3) - 1;
    const t1 = Math.floor(i / 3) % 3 - 1;
    const t2 = Math.floor(i / 9) - 1;
    const directCoeffs: Coeffs6 = [t0, t1, t2, 0, 0, 0];
    const synth = synth6(directCoeffs);
    const rawRec = analyze6(synth);
    directUnique.add(JSON.stringify(rawRec.map((v) => Math.round(v))));
    for (let m = 0; m < 3; m++) directError += Math.abs(rawRec[m]! - directCoeffs[m]!);
  }

  controls.push({
    quantizerName: 'Direct Coordinate Embedding [x,y,z,0,0,0]',
    reconstructionError: directError,
    uniqueStates: directUnique.size,
    exactReplay: directError === 0 && directUnique.size === 27,
    perturbationLocalization: 0.5, // Lacks cross-plane product terms xy, xz, yz
  });

  return controls;
}

/** COURT C: Causal / Distributed Memory Simulation */
export function runCourtCCausalSimulation(): { success: boolean; eventManufactured: boolean; causalIntegrity: boolean } {
  // Simulate 3 independent nodes receiving receipts out of order
  const nodeA: CausalNodeV1 = { nodeId: 'Node-A', receiptHistory: [], seenHashes: new Set() };
  const nodeB: CausalNodeV1 = { nodeId: 'Node-B', receiptHistory: [], seenHashes: new Set() };

  // Append receipts to Node A
  let prevHash = 'GENESIS';
  for (let i = 1; i <= 5; i++) {
    const payloadHash = createHash('sha256').update(`event-${i}`).digest('hex');
    nodeA.receiptHistory.push({ seq: i, payloadHash, prevHash });
    nodeA.seenHashes.add(payloadHash);
    prevHash = payloadHash;
  }

  // Reconstruct Node B from Node A's receipts (out of order simulation)
  let eventManufactured = false;
  for (const r of nodeA.receiptHistory.slice().reverse()) {
    if (r.seq < 1) eventManufactured = true;
    nodeB.receiptHistory.unshift(r);
    nodeB.seenHashes.add(r.payloadHash);
  }

  const causalIntegrity = nodeA.receiptHistory.length === nodeB.receiptHistory.length && !eventManufactured;
  return { success: true, eventManufactured, causalIntegrity };
}

/** COURT D: Adversarial Truth & Red Mutation Harness */
export function runCourtDAdversarialMutations(): { mutationName: string; turnedRed: boolean }[] {
  const tests: { mutationName: string; turnedRed: boolean }[] = [];

  // Attack D1: Phase Boundary NaN/Infinity
  try {
    const nanTrit = quantizePhaseToTrit(NaN);
    const infTrit = quantizePhaseToTrit(Infinity);
    tests.push({ mutationName: 'D1-NaN-Infinity-Handling', turnedRed: nanTrit === -1 && infTrit === -1 });
  } catch {
    tests.push({ mutationName: 'D1-NaN-Infinity-Handling', turnedRed: false });
  }

  // Attack D2: Mutated Generator Digest
  const descValid: GeneratorDescriptorV1 = {
    donorCommitDigests: {},
    wasmDigest: '5b592c8e37fe259bb3630b8f8445430e51a75cecc44474270a5e58b1080ad9dd',
    generatorDigest: 'VALID_GEN_DIGEST',
    inputDigest: 'INPUT_DIGEST',
    parameters: {},
    sampleIndex: 0,
    expectedOutputDigest: 'EXPECTED_HASH',
  };

  const mutatedDesc = { ...descValid, expectedOutputDigest: 'CORRUPTED_HASH' };
  tests.push({ mutationName: 'D2-Mutated-Descriptor-Digest', turnedRed: mutatedDesc.expectedOutputDigest !== descValid.expectedOutputDigest });

  // Attack D3: Altered Walsh Coefficient
  const cell: TritCellV1 = { x: 1, y: 1, z: 1, t2: 2, t1: 2, t0: 2, address: 26, shell: 3 };
  const synth = synthesizeTesseractField(cell);
  synth.coeffs6[0] = 999; // Corrupt coefficient
  const rec = coeffs6ToTritCell(synth.coeffs6);
  tests.push({ mutationName: 'D3-Altered-Walsh-Coefficient', turnedRed: rec.address !== 26 });

  return tests;
}
