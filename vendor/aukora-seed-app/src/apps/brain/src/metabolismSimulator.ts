// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Digital-metabolism simulator — RESEARCH_ONLY, pure, deterministic, ADVISORY.
 *
 * See docs/ADR-0001-digital-metabolism-research-only.md. This is NOT an authority implementation. Inputs are
 * INTEGER fixed-point; there is NO ambient clock (time is injected), NO float ever enters a hash, and the
 * simulator can ONLY CONTRACT a ceiling (a monotone ratchet down) and NEVER grants authority or mints any
 * challenge/effect. Untrusted sensors are advisory-only and cannot contract the ceiling (no adversarial ratchet
 * or DoS-to-zero). Dimensions are normalized per-sample by integer division and never summed together. The
 * "topological isomorphism" idea is treated as an UNPROVEN analogy — nothing rests on it.
 */
import { canonicalHash, type CanonicalValue } from '@aukora/kernel/canonical';

export type MetabolismDimension = 'energy' | 'load' | 'temperature' | 'io';
const DIMENSIONS: readonly MetabolismDimension[] = ['energy', 'load', 'temperature', 'io'];

/** Canonical budget base for integer fixed-point normalization (no floats). */
export const BUDGET_BASE = 1_000_000;

export interface MetabolismSampleV1 {
  readonly schema: 'aukora-metabolism-sample-v1';
  readonly sensorId: string;
  readonly dimension: MetabolismDimension;
  /** Integer fixed-point scale (e.g. 1000 = milli-units). */
  readonly unitScale: number;
  /** Integer fixed-point reading. */
  readonly value: number;
  /** Injected integer time — NO ambient clock. */
  readonly timestampMs: number;
  readonly trusted: boolean;
}

export interface MetabolismStateV1 {
  readonly schema: 'aukora-metabolism-state-v1';
  /** Integer budget ceiling in canonical units. ONLY ever contracts. */
  readonly budgetCeiling: number;
  readonly lastTimestampMs: number;
  readonly samplesApplied: number;
  /** Canonical hash over the integer state — no float. */
  readonly stateHash: string;
  /** Structurally false. */
  readonly grantsAuthority: false;
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n);

export function validateSample(s: unknown): string[] {
  const v: string[] = [];
  if (s === null || typeof s !== 'object') return ['sample_not_object'];
  const o = s as Record<string, unknown>;
  if (o.schema !== 'aukora-metabolism-sample-v1') v.push('schema_invalid');
  if (typeof o.sensorId !== 'string' || o.sensorId.length === 0) v.push('sensorId_invalid');
  if (typeof o.dimension !== 'string' || !DIMENSIONS.includes(o.dimension as MetabolismDimension)) v.push('dimension_invalid');
  if (!isInt(o.unitScale) || (o.unitScale as number) <= 0) v.push('unitScale_not_positive_integer');
  if (!isInt(o.value) || (o.value as number) < 0) v.push('value_not_nonnegative_integer'); // fixed-point, no floats
  if (!isInt(o.timestampMs) || (o.timestampMs as number) < 0) v.push('timestampMs_not_integer');
  if (typeof o.trusted !== 'boolean') v.push('trusted_not_boolean');
  return v;
}

function hashState(fields: Omit<MetabolismStateV1, 'stateHash' | 'schema' | 'grantsAuthority'>): string {
  return canonicalHash({ schema: 'aukora-metabolism-state-v1', ...fields } as unknown as CanonicalValue);
}

export function initialMetabolismState(initialCeiling: number): MetabolismStateV1 {
  if (!isInt(initialCeiling) || initialCeiling < 0) throw new Error('metabolism_initial_ceiling_invalid');
  const base = { budgetCeiling: initialCeiling, lastTimestampMs: 0, samplesApplied: 0 };
  return { schema: 'aukora-metabolism-state-v1', ...base, stateHash: hashState(base), grantsAuthority: false };
}

export interface StepResult {
  readonly state: MetabolismStateV1;
  readonly applied: boolean;
  readonly reason?: string;
}

/** The pressure a sample proposes as a ceiling, in canonical integer units (per-dimension normalization). */
function pressureCeiling(sample: MetabolismSampleV1): number {
  // integer division only: value scaled to the canonical base by its unit scale.
  return Math.floor((sample.value * BUDGET_BASE) / sample.unitScale);
}

/**
 * Apply one sample. Fail-closed: invalid samples and out-of-order timestamps are refused (state unchanged);
 * untrusted samples are advisory-only (recorded, never contract). A trusted, valid sample can only CONTRACT the
 * ceiling: `min(ceiling, pressure)`, clamped at a floor of 0. The ceiling never rises.
 */
export function stepMetabolism(state: MetabolismStateV1, sample: MetabolismSampleV1): StepResult {
  const violations = validateSample(sample);
  if (violations.length > 0) return { state, applied: false, reason: `refused: ${violations.join(',')}` };
  if (sample.timestampMs < state.lastTimestampMs) return { state, applied: false, reason: 'refused: out-of-order timestamp' };
  if (!sample.trusted) {
    // advisory-only: advance the clock but NEVER contract from an untrusted sensor.
    const base = { budgetCeiling: state.budgetCeiling, lastTimestampMs: sample.timestampMs, samplesApplied: state.samplesApplied + 1 };
    return { state: { schema: 'aukora-metabolism-state-v1', ...base, stateHash: hashState(base), grantsAuthority: false }, applied: false, reason: 'advisory-only: untrusted sensor cannot contract the ceiling' };
  }
  const contracted = Math.max(0, Math.min(state.budgetCeiling, pressureCeiling(sample)));
  const base = { budgetCeiling: contracted, lastTimestampMs: sample.timestampMs, samplesApplied: state.samplesApplied + 1 };
  return { state: { schema: 'aukora-metabolism-state-v1', ...base, stateHash: hashState(base), grantsAuthority: false }, applied: true };
}

/** Deterministic fold over samples. Same inputs ⇒ identical final state (and stateHash). */
export function runMetabolism(initialCeiling: number, samples: readonly MetabolismSampleV1[]): MetabolismStateV1 {
  let state = initialMetabolismState(initialCeiling);
  for (const s of samples) state = stepMetabolism(state, s).state;
  return state;
}

/** The metabolism simulator grants no authority. Constant. */
export function metabolismGrantsAuthority(): false {
  return false;
}
