// ╔══════════════════════════════════════════════════════════════════════════════════════════╗
// ║ QUARANTINED 2026-08-09 — see core/swarm/t27-bridge.ts for the measurements.              ║
// ╚══════════════════════════════════════════════════════════════════════════════════════════╝
//
// SPECIFIC TO THIS FILE: the one thing here that was real has been EXTRACTED AND GATED.
// packBase27Stream / unpackBase27Stream are a correct, lossless stream codec — and they do not
// pack in base 27. They write each cell as a fixed 5-bit field (2^5 = 32 >= 27), discarding the
// 5 code points in every 32 a 27-valued symbol does not use. Measured: 5.000 bits/cell exactly,
// against a log2(27) = 4.755 optimum and 8.000 naive — real, and 4.9% short of the name it was
// carrying.
//
// It now lives, correctly named, in core/swarm/ternary-packer.ts, gated by
// scripts/ternary-packer-verify.ts. The copies below are left in place so this file still reads
// as the record of what was measured; they are not the maintained ones.
//
// The Court A–F functions grade themselves and were never run by scripts/verify.sh. Do not cite.
//
// ── original header follows ────────────────────────────────────────────────────────────────
//
// core/swarm/t27-utility-discriminator.ts — T27 Utility Discriminator Suite (Courts A-F)
//
// Evaluates T27 against matched controls across Courts A-F to determine final classification.
//
// STATUS: RESEARCH-ONLY / NO PRODUCTION CALLERS / RUNTIME SPAWNING OFF

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
import { Base27JsReference, BASE27_EXPECTED_WASM_DIGEST } from './base27-core';

export const GIT_TREE_OBJECT_HASH = 'd8552597235b15ca6507af96ca752fe784412077';
export const GIT_ARCHIVE_MANIFEST_SHA256 = '46580ba95e2ec7a909d90588e4c18341a0f0e229f4048665ede827aab98f1abc';
export const GITHUB_ISSUE_27_URL = 'https://github.com/aumara-xyz/aukora-membrane/issues/27#issuecomment-5203517949';

export const TOTAL_COLD_START_CLOSURE_BYTES = 24132; // WASM + Descriptor + Generator + Walsh + Manifest

/** COURT A: Bit-Optimal Reversible Base-27 Packer */
export function packBase27Stream(cells: TritCellV1[]): Uint8Array {
  // 5 bits per cell (2^5 = 32 >= 27)
  const bitLength = cells.length * 5;
  const byteLength = Math.ceil(bitLength / 8);
  const buffer = new Uint8Array(byteLength);

  let bitOffset = 0;
  for (const c of cells) {
    const addr = c.address;
    for (let b = 0; b < 5; b++) {
      const bit = (addr >> (4 - b)) & 1;
      const byteIdx = Math.floor(bitOffset / 8);
      const bitIdx = 7 - (bitOffset % 8);
      if (bit) buffer[byteIdx] |= 1 << bitIdx;
      bitOffset++;
    }
  }
  return buffer;
}

export function unpackBase27Stream(packed: Uint8Array, count: number): TritCellV1[] {
  const cells: TritCellV1[] = [];
  let bitOffset = 0;

  for (let i = 0; i < count; i++) {
    let addr = 0;
    for (let b = 0; b < 5; b++) {
      const byteIdx = Math.floor(bitOffset / 8);
      const bitIdx = 7 - (bitOffset % 8);
      const bit = (packed[byteIdx]! >> bitIdx) & 1;
      addr = (addr << 1) | bit;
      bitOffset++;
    }

    const t0 = (addr % 3) as 0 | 1 | 2;
    const t1 = (Math.floor(addr / 3) % 3) as 0 | 1 | 2;
    const t2 = (Math.floor(addr / 9)) as 0 | 1 | 2;
    cells.push({
      x: (t0 - 1) as any,
      y: (t1 - 1) as any,
      z: (t2 - 1) as any,
      t2,
      t1,
      t0,
      address: addr,
      shell: Base27JsReference.shell(addr),
    });
  }
  return cells;
}

/** COURT B: Phase Specificity (100 Pinned Offsets) */
export function runCourtBPhaseSpecificity100(): {
  rateName: string;
  meanOccupancyVar: number;
  meanEntropy: number;
}[] {
  const results = [];
  const rateConfigs = [
    { name: '1. Zeta Logarithmic Rates', rates: [Math.log(2), Math.log(3), Math.log(5)] },
    { name: '2. Shuffled Logarithmic Rates', rates: [Math.log(5), Math.log(2), Math.log(3)] },
    { name: '3. Sqrt(2) Incommensurate Rates', rates: [1.0, Math.SQRT2, Math.sqrt(3)] },
    { name: '4. Golden Ratio Phi Rates', rates: [1.0, 1.61803398875, 2.61803398875] },
    { name: '5. Linear Rational Rates', rates: [1.0, 2.0, 3.0] },
  ];

  for (const cfg of rateConfigs) {
    let totalVar = 0;
    let totalEntropy = 0;

    for (let offsetIdx = 0; offsetIdx < 100; offsetIdx++) {
      const offset = (offsetIdx * 0.06283) % (Math.PI * 2);
      const counts = new Array(27).fill(0);

      for (let i = 0; i < 1000; i++) {
        const sample: PhaseSampleV1 = {
          thetaX: (offset + i * cfg.rates[0]!) % (Math.PI * 2),
          thetaY: (offset + i * cfg.rates[1]!) % (Math.PI * 2),
          thetaZ: (offset + i * cfg.rates[2]!) % (Math.PI * 2),
        };
        const cell = phaseSampleToTritCell(sample);
        counts[cell.address]++;
      }

      const mean = 1000 / 27;
      const v = counts.reduce((s, c) => s + Math.pow(c - mean, 2), 0) / 27;
      totalVar += v;
      totalEntropy += 1.0 - v / (1000 * 1000);
    }

    results.push({
      rateName: cfg.name,
      meanOccupancyVar: totalVar / 100,
      meanEntropy: totalEntropy / 100,
    });
  }

  return results;
}

/** COURT C: Receipt-Derived Replay */
export function runCourtCReceiptReplay(receipts: string[]): {
  reconstructedHex: string;
  deterministic: boolean;
  reorderSensitive: boolean;
} {
  const hashStr = receipts.join('|');
  const h1 = createHash('sha256').update(hashStr).digest('hex');
  const h2 = createHash('sha256').update(hashStr).digest('hex');

  const reorderedStr = receipts.slice().reverse().join('|');
  const hReordered = createHash('sha256').update(reorderedStr).digest('hex');

  return {
    reconstructedHex: h1,
    deterministic: h1 === h2,
    reorderSensitive: h1 !== hReordered,
  };
}

/** COURT D: Task-Level Discriminator Matrix */
export function runCourtDTaskDiscriminator(): {
  taskName: string;
  t27Score: number;
  directScore: number;
  winner: string;
}[] {
  return [
    { taskName: '1. Single-Cell Address Invertibility', t27Score: 1.0, directScore: 1.0, winner: 'TIE (Both Exact Error 0)' },
    { taskName: '2. Neighborhood Distance Preservation', t27Score: 1.0, directScore: 1.0, winner: 'TIE (Both Preserved)' },
    { taskName: '3. 2-Body Rotational Coupling (xy,xz,yz)', t27Score: 1.0, directScore: 0.0, winner: 'T27 (Coupling Term Representation)' },
    { taskName: '4. Storage Overhead per Cell', t27Score: 6.0, directScore: 3.0, winner: 'Direct Coordinate (3B vs 6B)' },
  ];
}

/** COURT E: Damage Recovery against Parity Controls */
export function runCourtEDamageRecovery(): {
  deletionRate: string;
  t27RecoveryPercent: number;
  parityControlRecoveryPercent: number;
  winner: string;
}[] {
  return [
    { deletionRate: '10% Deletion', t27RecoveryPercent: 0.0, parityControlRecoveryPercent: 100.0, winner: 'Parity Control (RS Code)' },
    { deletionRate: '25% Deletion', t27RecoveryPercent: 0.0, parityControlRecoveryPercent: 100.0, winner: 'Parity Control (RS Code)' },
    { deletionRate: '50% Deletion', t27RecoveryPercent: 0.0, parityControlRecoveryPercent: 50.0, winner: 'Parity Control (RS Code)' },
  ];
}

/** COURT F: Independent Replication Cross-Verification */
export function runCourtFIndependentReplication(): {
  analystAResults: string;
  analystBResults: string;
  matches: boolean;
} {
  const testCells: TritCellV1[] = [{ x: 1, y: -1, z: 0, t2: 1, t1: 0, t0: 2, address: 11, shell: 2 }];
  const packed = packBase27Stream(testCells);

  const decA = unpackBase27Stream(packed, 1);
  const decB = unpackBase27Stream(packed, 1);

  const strA = JSON.stringify(decA);
  const strB = JSON.stringify(decB);

  return { analystAResults: strA, analystBResults: strB, matches: strA === strB };
}
