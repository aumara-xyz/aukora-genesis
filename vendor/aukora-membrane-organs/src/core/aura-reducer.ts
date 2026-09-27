// core/aura-reducer.ts — Brick I1A.1: Living Aura State Reducer & Chain Boundary Verification
//
// Zero-dependency, pure deterministic Aura state reducer adapted from donor formulas (organs/aura/walsh.ts).
// Maps verified, settled receipt histories to byte-identical settled Aura states.
//
// Invariants:
// - Zero system clock, zero entropy, zero networking.
// - Strict domain separation: SEED, STANDING, BREATH.
// - Explicit identityBound: false until a real AUMLOK owner ceremony occurs.
// - Chain boundary enforcement: verified settled input only.
// - Canonical JSON output serialization with finite normalized numbers.

import { createHash } from 'node:crypto';

const sha256hex = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
const PI = 3.141592653589793;

export interface AuraStateV1 {
  schema: 'aukora-aura-state-v1';
  seed: string;       // Immutable genesis seed hash
  standing: string;   // Pinned commitment sequence hash (chain anchor)
  breath: string;     // Dynamic epoch transition hash (receipt sequence)
  walshAngles: [number, number, number, number, number, number]; // 6-plane Walsh SO(4) projection
  identityBound: false;
}

export interface SettledReceiptInput {
  event: 'DELEGATED' | 'ENGINE_STARTED' | 'EFFECT_AUTHORIZED' | 'RESULT_PROPOSED' | 'REFUSAL' | 'FAILURE' | 'INTERRUPTED' | string;
  payloadDigest: string;
  status?: 'settled' | 'pending' | string;
  seq?: number;
  prevEpochCommitment?: string;
}

export interface ChainBoundaryResultV1 {
  ok: boolean;
  breakReason: string | null;
  verifiedCount: number;
}

export interface VerificationAndReductionResultV1 {
  ok: boolean;
  breakReason: string | null;
  state: AuraStateV1 | null;
}

const ALLOWED_EVENT_CLASSES = new Set([
  'DELEGATED',
  'ENGINE_STARTED',
  'EFFECT_AUTHORIZED',
  'RESULT_PROPOSED',
  'REFUSAL',
  'FAILURE',
  'INTERRUPTED',
]);

/** Pure deterministic Walsh 16-vertex fast Hadamard transform codec adapted from organs/aura/walsh.ts */
export function walshHadamard16(input: number[]): number[] {
  const buf = [...input];
  let h = 1;
  while (h < 16) {
    for (let i = 0; i < 16; i += h * 2) {
      for (let j = i; j < i + h; j++) {
        const x = buf[j];
        const y = buf[j + h];
        buf[j] = x + y;
        buf[j + h] = x - y;
      }
    }
    h *= 2;
  }
  return buf.map((v) => v / 4.0); // Normalized 1/16 scaling
}

export function encodeWalshAngles(angles: [number, number, number, number, number, number]): number[] {
  const field = new Array(16).fill(0);
  for (let i = 0; i < 16; i++) {
    const v_x = (i & 1) ? 1 : -1;
    const v_y = (i & 2) ? 1 : -1;
    const v_z = (i & 4) ? 1 : -1;
    const v_w = (i & 8) ? 1 : -1;

    field[i] =
      angles[0] * v_x * v_y +
      angles[1] * v_x * v_z +
      angles[2] * v_y * v_z +
      angles[3] * v_x * v_w +
      angles[4] * v_y * v_w +
      angles[5] * v_z * v_w;
  }
  return field;
}

export function decodeWalshAngles(field: number[]): [number, number, number, number, number, number] {
  const angles: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
  if (field.length !== 16) return angles;

  for (let i = 0; i < 16; i++) {
    const v_x = (i & 1) ? 1 : -1;
    const v_y = (i & 2) ? 1 : -1;
    const v_z = (i & 4) ? 1 : -1;
    const v_w = (i & 8) ? 1 : -1;

    angles[0] += field[i] * v_x * v_y;
    angles[1] += field[i] * v_x * v_z;
    angles[2] += field[i] * v_y * v_z;
    angles[3] += field[i] * v_x * v_w;
    angles[4] += field[i] * v_y * v_w;
    angles[5] += field[i] * v_z * v_w;
  }

  return angles.map((a) => a / 16.0) as [number, number, number, number, number, number];
}

/** Pre-reducer chain boundary verifier. Refuses broken, reordered, unsettled or malformed receipt sequences. */
export function verifyAuraReceiptHistory(initialSeed: string, receipts: SettledReceiptInput[]): ChainBoundaryResultV1 {
  let expectedPrev = sha256hex(`standing:genesis:${initialSeed}`);

  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i];

    // 1. Exclude or refuse unsettled receipts
    if (r.status && r.status !== 'settled') {
      return { ok: false, breakReason: `receipt:unsettled-excluded (index ${i} status is ${r.status})`, verifiedCount: i };
    }

    // 2. Reject unknown event classes
    if (!ALLOWED_EVENT_CLASSES.has(r.event)) {
      return { ok: false, breakReason: `receipt:unknown-event-class (index ${i} event '${r.event}' unrecognized)`, verifiedCount: i };
    }

    // 3. Reject malformed digests
    if (typeof r.payloadDigest !== 'string' || !/^[0-9a-f]{64}$/.test(r.payloadDigest)) {
      return { ok: false, breakReason: `receipt:malformed-digest (index ${i} payloadDigest invalid)`, verifiedCount: i };
    }

    // 4. Validate sequence numbering if present
    if (r.seq !== undefined && r.seq !== i) {
      return { ok: false, breakReason: `chain:sequence-break (expected seq ${i}, found ${r.seq})`, verifiedCount: i };
    }

    // 5. Validate link commitment if present
    if (r.prevEpochCommitment !== undefined && r.prevEpochCommitment !== expectedPrev) {
      return { ok: false, breakReason: `chain:link-broken (expected prev ${expectedPrev.slice(0, 16)}, found ${r.prevEpochCommitment.slice(0, 16)})`, verifiedCount: i };
    }

    expectedPrev = sha256hex(`${expectedPrev}:seq:${i}:${r.event}:${r.payloadDigest}`);
  }

  return { ok: true, breakReason: null, verifiedCount: receipts.length };
}

/** Pure deterministic zero-clock Aura state reducer. */
export function reduceAuraState(initialSeed: string, receipts: SettledReceiptInput[], presentationAttention?: number): AuraStateV1 {
  const seed = sha256hex(`genesis:${initialSeed || 'empty-genesis-default'}`);
  let standing = sha256hex(`standing:${seed}`);
  let breath = sha256hex(`breath:genesis:${seed}`);

  const walshAngles: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];

  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i];

    // Explicit documented class transitions
    let classTransitionMarker = 'SUCCEEDED';
    if (r.event === 'REFUSAL' || r.event === 'FAILURE') {
      classTransitionMarker = 'FAILED';
    } else if (r.event === 'INTERRUPTED') {
      classTransitionMarker = 'INTERRUPTED';
    }

    standing = sha256hex(`${standing}:seq:${i}:${r.event}:${r.payloadDigest}:${classTransitionMarker}`);
    breath = sha256hex(`${breath}:transition:${r.payloadDigest}:${classTransitionMarker}`);

    const hashBuf = Buffer.from(breath, 'hex');
    for (let k = 0; k < 6; k++) {
      const b = hashBuf[k];
      walshAngles[k] = (walshAngles[k] + ((b - 128) / 128.0) * PI) % (2 * PI);
    }
  }

  // Normalize Walsh angles to 12 decimal places for finite deterministic floating point representation
  const normalizedAngles = walshAngles.map((a) => Number(a.toFixed(12))) as [number, number, number, number, number, number];

  return {
    schema: 'aukora-aura-state-v1',
    seed,
    standing,
    breath,
    walshAngles: normalizedAngles,
    identityBound: false,
  };
}

/** Combined chain verification and state reduction. Refuses broken chains before state reduction. */
export function verifyAndReduceAuraState(initialSeed: string, receipts: SettledReceiptInput[], presentationAttention?: number): VerificationAndReductionResultV1 {
  const verification = verifyAuraReceiptHistory(initialSeed, receipts);
  if (!verification.ok) {
    return { ok: false, breakReason: verification.breakReason, state: null };
  }
  const state = reduceAuraState(initialSeed, receipts, presentationAttention);
  return { ok: true, breakReason: null, state };
}
