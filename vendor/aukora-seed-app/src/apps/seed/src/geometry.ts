// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * AURA geometry (GEOMETRY_ONLY — a shape the Spatial shell renders, NOT a capability).
 *
 * A safe, bounded numeric summary of a ceremony's evolving state — epoch, phase, lineage depth, attempts,
 * a witness mode, and a coherence scalar in [0,1] — plus a SHORT intent correlator. The Spatial shell renders
 * evolving geometry from these numbers WITHOUT recomputing any governance verdict: the verdict is already baked
 * into `phase`/`coherence` as data. Hard law: geometry grants no authority, carries no secret/private material,
 * and passes the AURA forbidden-field fence (positive allowlist + recursive forbidden-key/value refusal).
 *
 * This module is a leaf: it imports only the fence, never the ceremony. Pure/in-memory.
 */
import { scanForbiddenKeys, scanForbiddenValues, scanForbiddenAuthorityClaims } from './forbiddenContent.js';

export type WitnessMode = 'write' | 'witness' | 'release' | 'unknown';

/** Frozen geometry bounds. */
export const GEOMETRY_LIMITS = Object.freeze({
  MAX_FRAMES: 1024,
  MAX_INTENT_PREFIX: 12,
  MAX_STRING: 64,
} as const);

export interface AuraGeometry {
  readonly schema: 'aukora-aura-geometry-v1';
  readonly epoch: number;
  /** A SAFE phase category (e.g. `sandbox-applied`, `refused-stale-epoch`). */
  readonly phase: string;
  readonly lineageDepth: number;
  readonly attemptsUsed: number;
  readonly witnessMode: WitnessMode;
  /** Coherence scalar in [0,1] — display only; 1 = a committed apply, lower = a refusal. */
  readonly coherence: number;
  /** SHORT intent correlator (≤ MAX_INTENT_PREFIX hex) — never the full 64-hex intent id. */
  readonly intentPrefix?: string;
  readonly classification: 'GEOMETRY_ONLY';
  readonly advisoryOnly: true;
  readonly grantsAuthority: false;
}

const WITNESS_MODES: ReadonlySet<string> = new Set(['write', 'witness', 'release', 'unknown']);
const HEX = /^[0-9a-f]*$/;

export const GEOMETRY_ALLOWED_FIELDS: ReadonlySet<string> = new Set([
  'schema', 'epoch', 'phase', 'lineageDepth', 'attemptsUsed', 'witnessMode', 'coherence',
  'intentPrefix', 'classification', 'advisoryOnly', 'grantsAuthority',
]);

export interface DeriveGeometryInput {
  readonly epoch: number;
  readonly phase: string;
  readonly applied: boolean;
  readonly lineageDepth: number;
  readonly attemptsUsed: number;
  readonly intentId: string | null;
}

const safeInt = (v: number): number => (Number.isSafeInteger(v) && v >= 0 ? v : 0);
const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Derive geometry from a decided outcome. Pure; the coherence encodes the ALREADY-decided verdict, so the shell
 *  never recomputes governance. */
export function deriveGeometry(input: DeriveGeometryInput): AuraGeometry {
  const coherence = input.applied ? 1 : input.phase === 'challenge-issued' ? 0.5 : 0.25;
  return {
    schema: 'aukora-aura-geometry-v1',
    epoch: safeInt(input.epoch),
    phase: input.phase.slice(0, GEOMETRY_LIMITS.MAX_STRING),
    lineageDepth: safeInt(input.lineageDepth),
    attemptsUsed: safeInt(input.attemptsUsed),
    witnessMode: input.applied ? 'write' : 'witness',
    coherence,
    intentPrefix: input.intentId ? input.intentId.slice(0, GEOMETRY_LIMITS.MAX_INTENT_PREFIX) : undefined,
    classification: 'GEOMETRY_ONLY',
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

export interface GeometrySanitizeResult {
  readonly ok: boolean;
  readonly geometry: AuraGeometry | null;
  readonly droppedFields: string[];
  readonly forbiddenFound: string[];
  readonly reason: string;
}

/**
 * Sanitize an untrusted geometry object: (1) recursive forbidden-key/value/authority scan → reject the WHOLE
 * record on any hit (fail-closed — geometry-field smuggling is refused); (2) positive allowlist → drop unknown
 * fields; (3) clamp coherence to [0,1], coerce enums, bound strings, and keep only a SHORT hex intent prefix.
 */
export function sanitizeGeometry(raw: unknown): GeometrySanitizeResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, geometry: null, droppedFields: [], forbiddenFound: [], reason: 'not a plain object' };
  }
  const forbiddenFound = [
    ...scanForbiddenKeys(raw),
    ...scanForbiddenValues(raw).map((p) => `value@${p}`),
    ...scanForbiddenAuthorityClaims(raw).map((p) => `authority@${p}`),
  ];
  if (forbiddenFound.length) {
    return { ok: false, geometry: null, droppedFields: [], forbiddenFound, reason: `forbidden content at depth: ${forbiddenFound.join(', ')}` };
  }
  const r = raw as Record<string, unknown>;
  const droppedFields = Object.keys(r).filter((k) => !GEOMETRY_ALLOWED_FIELDS.has(k));
  const witnessMode = (typeof r.witnessMode === 'string' && WITNESS_MODES.has(r.witnessMode)) ? (r.witnessMode as WitnessMode) : 'unknown';
  const rawPrefix = typeof r.intentPrefix === 'string' ? r.intentPrefix.slice(0, GEOMETRY_LIMITS.MAX_INTENT_PREFIX) : undefined;
  const intentPrefix = rawPrefix !== undefined && HEX.test(rawPrefix) ? rawPrefix : undefined;

  const geometry: AuraGeometry = {
    schema: 'aukora-aura-geometry-v1',
    epoch: typeof r.epoch === 'number' ? safeInt(r.epoch) : 0,
    phase: typeof r.phase === 'string' ? r.phase.slice(0, GEOMETRY_LIMITS.MAX_STRING) : 'unknown',
    lineageDepth: typeof r.lineageDepth === 'number' ? safeInt(r.lineageDepth) : 0,
    attemptsUsed: typeof r.attemptsUsed === 'number' ? safeInt(r.attemptsUsed) : 0,
    witnessMode,
    coherence: typeof r.coherence === 'number' ? clamp01(r.coherence) : 0,
    intentPrefix,
    classification: 'GEOMETRY_ONLY',
    advisoryOnly: true,
    grantsAuthority: false,
  };
  const rec = geometry as unknown as Record<string, unknown>;
  for (const k of Object.keys(rec)) if (rec[k] === undefined) delete rec[k];
  return { ok: true, geometry, droppedFields, forbiddenFound: [], reason: 'ok' };
}

/** Bounded, append-only stream of geometry frames — lets the Spatial shell render EVOLVING geometry. */
export class GeometryLog {
  private readonly frames: AuraGeometry[] = [];

  /** Append a geometry frame (sanitized). A frame that fails the fence is NOT stored (fail-closed). */
  push(raw: AuraGeometry): boolean {
    const res = sanitizeGeometry(raw);
    if (!res.ok || !res.geometry) return false;
    this.frames.push(res.geometry);
    if (this.frames.length > GEOMETRY_LIMITS.MAX_FRAMES) this.frames.shift();
    return true;
  }

  all(): readonly AuraGeometry[] {
    return this.frames.slice();
  }

  latest(): AuraGeometry | null {
    return this.frames.length ? this.frames[this.frames.length - 1] : null;
  }

  clear(): void {
    this.frames.length = 0;
  }

  /** Self-audit: every stored frame is forbidden-content free. */
  audit(): { clean: boolean; forbiddenFound: string[] } {
    const forbiddenFound = [...scanForbiddenKeys(this.frames), ...scanForbiddenValues(this.frames).map((p) => `value@${p}`)];
    return { clean: forbiddenFound.length === 0, forbiddenFound };
  }
}

/** HARD: geometry grants no authority — ever. Constant, by construction. */
export function auraGeometryGrantsAuthority(): false {
  return false;
}
