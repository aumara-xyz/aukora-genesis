// ╔══════════════════════════════════════════════════════════════════════════════════════════╗
// ║ QUARANTINED 2026-08-09 — measured, not deleted. Do not cite this file as a result.        ║
// ╚══════════════════════════════════════════════════════════════════════════════════════════╝
//
// WHAT WAS MEASURED, by counting rather than by reading the prose:
//
//   · A TritCellV1 holds 27 distinct states — log2(27) = 4.75 BITS — presented across EIGHT
//     fields. (x,y,z), (t2,t1,t0) and `address` are three encodings BIJECTIVE WITH ONE ANOTHER
//     (verified: 27 = 27 = 27, one-to-one), and `shell` is derived from `address`. One number,
//     four coats.
//   · `field16` has sixteen slots holding SIX numbers: analyze6 ∘ synth6 round-trips exactly, so
//     the field lies in a 6-dimensional subspace of R^16 and the other ten are not free.
//   · The phase→cell map collapses a continuous θ ∈ [0, 2π) to THREE buckets per axis. That is
//     quantisation, not a bridge, and not a finding.
//   · The courts in t27-convergence-court.ts generate their own samples and grade themselves.
//     A subject authoring its own challenge is the defect that defeated generation one of the
//     harness; see docs/HARNESS-DEFEATS.md.
//   · Zero gates in scripts/verify.sh at the time of quarantine.
//
// AND THE FINDING THAT MATTERS MOST:
//
//     You have two balanced-ternary address engines that don't know about each other, and only
//     one of them is gated.
//
// core/vk-address.ts is a 3^6 = 729 balanced-ternary engine: shipped, gated, 729/729 round
// trips, vkGrantsAuthority() === false. This is 3^3 = 27 — the same substrate at half the width
// — and it asserted no relation to it whatsoever (a grep for "vk" across these files returned
// nothing). That relation is now stated in both directions: see the header of
// core/vk-address.ts and of core/swarm/ternary-packer.ts.
//
// WHAT SURVIVED. One thing, and it was real: the stream codec formerly called
// packBase27Stream. It is extracted, correctly renamed (it packs in base 32, not base 27), and
// gated in core/swarm/ternary-packer.ts + scripts/ternary-packer-verify.ts.
//
// Nothing here is deleted, because deletion is the owner's call and a quarantine that erased its
// own evidence would be the same error one level up.
//
// ── original header follows ────────────────────────────────────────────────────────────────
//
// core/swarm/t27-bridge.ts — T27 Bridge: Location as a Verified Generator Address
//
// Falsifiable, research-only bridge connecting continuous phase mechanics (Zeta Harp),
// ternary coordinates (Luminara Portal), Base-27 WASM/reference, and Walsh tesseract fields.
//
// STATUS: QUARANTINED / RESEARCH-ONLY / NO PRODUCTION CALLERS / NO MUTATION AUTHORITY

import { createHash } from 'node:crypto';
import { Base27JsReference, BASE27_EXPECTED_WASM_DIGEST, loadBase27WasmInstance } from './base27-core';
import { synth6, analyze6, Coeffs6, Field16 } from '../../organs/aura/walsh';

export const DONOR_PINNED_REFERENCES = {
  zetaHarp: 'aumara-xyz/zeta-harp@pinned-v1',
  luminaraPortal: 'zeb23ediah/luminara-portal@pinned-v1',
  coreWasmDigest: BASE27_EXPECTED_WASM_DIGEST,
};

export type BalancedTrit = -1 | 0 | 1;

export interface PhaseSampleV1 {
  thetaX: number; // Continuous phase radians [0, 2π)
  thetaY: number; // Continuous phase radians [0, 2π)
  thetaZ: number; // Continuous phase radians [0, 2π)
}

export interface TritCellV1 {
  x: BalancedTrit;
  y: BalancedTrit;
  z: BalancedTrit;
  t2: number; // 0, 1, 2
  t1: number; // 0, 1, 2
  t0: number; // 0, 1, 2
  address: number; // 0..26
  shell: number; // 0..3 (distance from center 13)
}

export interface TesseractFieldV1 {
  coeffs6: Coeffs6; // [x, y, z, xy, xz, yz]
  field16: Field16; // 16 vertex values
}

export interface GeneratorDescriptorV1 {
  donorCommitDigests: Record<string, string>;
  wasmDigest: string;
  generatorDigest: string;
  inputDigest: string;
  parameters: Record<string, any>;
  sampleIndex: number;
  expectedOutputDigest: string;
}

/** Quantizes continuous phase radians [0, 2π) into 3 equal 2π/3 intervals mapped to balanced trits {-1, 0, +1} */
export function quantizePhaseToTrit(radians: number): BalancedTrit {
  // Normalize to [0, 2π)
  const TWO_PI = Math.PI * 2;
  let norm = radians % TWO_PI;
  if (norm < 0) norm += TWO_PI;

  const INTERVAL = TWO_PI / 3; // 2π/3 ~ 2.094395

  // Interval 0: [0, 2π/3) -> 0 (Center/Balance)
  // Interval 1: [2π/3, 4π/3) -> +1 (Positive)
  // Interval 2: [4π/3, 2π) -> -1 (Negative)
  if (norm < INTERVAL) return 0;
  if (norm < INTERVAL * 2) return 1;
  return -1;
}

/** Converts continuous 3-phase sample into balanced trits and Base-27 TritCellV1 */
export function phaseSampleToTritCell(sample: PhaseSampleV1): TritCellV1 {
  const x = quantizePhaseToTrit(sample.thetaX);
  const y = quantizePhaseToTrit(sample.thetaY);
  const z = quantizePhaseToTrit(sample.thetaZ);

  // Convert balanced trits {-1, 0, +1} to unsigned trits {0, 1, 2}
  const t0 = (x + 1) as 0 | 1 | 2;
  const t1 = (y + 1) as 0 | 1 | 2;
  const t2 = (z + 1) as 0 | 1 | 2;

  const address = Base27JsReference.encode(t2, t1, t0);
  const shell = Base27JsReference.shell(address);

  return { x, y, z, t2, t1, t0, address, shell };
}

/** Base-27 Cell to 6 Plane Coefficients: [x, y, z, x*y, x*z, y*z] */
export function tritCellToCoeffs6(cell: TritCellV1): Coeffs6 {
  const xy = cell.x * cell.y;
  const xz = cell.x * cell.z;
  const yz = cell.y * cell.z;
  return [cell.x, cell.y, cell.z, xy, xz, yz];
}

/** Reconstructs TritCellV1 from 6 Plane Coefficients */
export function coeffs6ToTritCell(coeffs: Coeffs6): TritCellV1 {
  const x = Math.round(coeffs[0]) as BalancedTrit;
  const y = Math.round(coeffs[1]) as BalancedTrit;
  const z = Math.round(coeffs[2]) as BalancedTrit;

  const t0 = (x + 1) as 0 | 1 | 2;
  const t1 = (y + 1) as 0 | 1 | 2;
  const t2 = (z + 1) as 0 | 1 | 2;

  const address = Base27JsReference.encode(t2, t1, t0);
  const shell = Base27JsReference.shell(address);

  return { x, y, z, t2, t1, t0, address, shell };
}

/** Synthesizes Base-27 TritCellV1 into a 16-vertex Tesseract Field */
export function synthesizeTesseractField(cell: TritCellV1): TesseractFieldV1 {
  const coeffs6 = tritCellToCoeffs6(cell);
  const field16 = synth6(coeffs6);
  return { coeffs6, field16 };
}

/** Analyzes a 16-vertex Tesseract Field back into Base-27 TritCellV1 */
export function analyzeTesseractField(field: TesseractFieldV1): TritCellV1 {
  const rawCoeffs = analyze6(field.field16);
  const coeffs6: Coeffs6 = [
    Math.round(rawCoeffs[0]),
    Math.round(rawCoeffs[1]),
    Math.round(rawCoeffs[2]),
    Math.round(rawCoeffs[3]),
    Math.round(rawCoeffs[4]),
    Math.round(rawCoeffs[5]),
  ];
  return coeffs6ToTritCell(coeffs6);
}

/** Runs a GeneratorDescriptorV1 and returns verified reconstructed output digest */
export function runGeneratorDescriptor(
  desc: GeneratorDescriptorV1,
  samples: PhaseSampleV1[],
): { outputDigest: string; matchExpected: boolean; cells: TritCellV1[] } {
  const cells = samples.map(phaseSampleToTritCell);
  const jsonStr = JSON.stringify(cells);
  const outputDigest = createHash('sha256').update(jsonStr).digest('hex');

  const matchExpected = outputDigest === desc.expectedOutputDigest;
  return { outputDigest, matchExpected, cells };
}
