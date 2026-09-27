// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Effect-event projection primitives (overnight brick 1+2) — the CLOSED, deterministic foundation for
 * append-only effect projections keyed by a content-addressed effect id.
 *
 * The durable brain persists PROJECTIONS of trusted journal events, never authority. An effect event names a
 * step effect that was applied exactly once, keyed by `(rehearsalKey, step)` — the same "written exactly once"
 * law the Convex `rehearsalEffects` table enforces (schema.ts). This module gives that law a pure, testable,
 * transport-independent core so a convergent projection can be built AND rebuilt from the protected event
 * stream on any backend (local Convex, in-memory, or a fresh clone) with identical results.
 *
 * Constitutional fence (kept OUTSIDE Convex, enforced here): an effect event is `advisoryOnly:true`,
 * `grantsAuthority:false`, carries no signature/key/authorization, and is secret-scanned — so a projection can
 * never smuggle authority material into the store, and a compromised backend row fails validation closed.
 */
import { canonicalHash } from '@aukora/kernel/canonical';
import { textHasSecret } from '@aukora/evidence';

export const EFFECT_EVENT_SCHEMA = 'aukora-effect-event-v1';
export const MAX_EFFECT_LEN = 4096;
export const MAX_KEY_LEN = 256;

export interface EffectEventV1 {
  readonly schema: typeof EFFECT_EVENT_SCHEMA;
  /** 64-hex, content-addressed = deriveEffectId(rehearsalKey, step). A forged id fails validation. */
  readonly effectId: string;
  readonly rehearsalKey: string;
  readonly step: number;
  /** Bounded, content-free effect descriptor (e.g. 'step-effect-applied'). Never plaintext secret material. */
  readonly effect: string;
  readonly createdAtIso: string;
  readonly advisoryOnly: true;
  readonly grantsAuthority: false;
}

const HEX64 = /^[0-9a-f]{64}$/;
const EXACT_KEYS = ['schema', 'effectId', 'rehearsalKey', 'step', 'effect', 'createdAtIso', 'advisoryOnly', 'grantsAuthority'] as const;

/**
 * Deterministic, content-addressed effect id keyed by `(rehearsalKey, step)` — the exactly-once key. Two
 * deliveries of the same step yield the SAME id, so duplicates converge; different steps never collide.
 */
export function deriveEffectId(rehearsalKey: string, step: number): string {
  return canonicalHash({ domain: 'AUKORA-EFFECT/1', rehearsalKey, step });
}

/**
 * CLOSED, exact-shape validation. Total: a malformed, extra-keyed, authority-claiming, secret-bearing, or
 * forged-id event is refused (returns null). Compatible: a well-formed event round-trips unchanged.
 */
export function validateEffectEvent(x: unknown): EffectEventV1 | null {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  // CLOSED: exactly the declared keys — no unknown extras, none missing.
  const keys = Object.keys(r);
  if (keys.length !== EXACT_KEYS.length || !EXACT_KEYS.every((k) => Object.hasOwn(r, k))) return null;
  if (r.schema !== EFFECT_EVENT_SCHEMA) return null;
  if (typeof r.rehearsalKey !== 'string' || r.rehearsalKey.length === 0 || r.rehearsalKey.length > MAX_KEY_LEN) return null;
  if (typeof r.step !== 'number' || !Number.isInteger(r.step) || r.step < 0) return null;
  if (typeof r.effect !== 'string' || r.effect.length > MAX_EFFECT_LEN) return null;
  if (typeof r.createdAtIso !== 'string' || r.createdAtIso.length === 0 || r.createdAtIso.length > 40) return null;
  // AUTHORITY FENCE: these are constants by construction — anything else means authority material leaked in.
  if (r.advisoryOnly !== true || r.grantsAuthority !== false) return null;
  if (typeof r.effectId !== 'string' || !HEX64.test(r.effectId)) return null;
  // ID BINDING: the id MUST be the deterministic derivation — a re-delivered row with a swapped id is refused.
  if (r.effectId !== deriveEffectId(r.rehearsalKey, r.step)) return null;
  // SECRET FENCE: no plaintext secret may enter the projection.
  if (textHasSecret(r.effect) || textHasSecret(r.rehearsalKey)) return null;
  return r as unknown as EffectEventV1;
}

/** Build a valid effect event for `(rehearsalKey, step, effect)` — the canonical constructor. */
export function makeEffectEvent(rehearsalKey: string, step: number, effect: string, createdAtIso: string): EffectEventV1 | null {
  return validateEffectEvent({
    schema: EFFECT_EVENT_SCHEMA,
    effectId: deriveEffectId(rehearsalKey, step),
    rehearsalKey, step, effect, createdAtIso,
    advisoryOnly: true, grantsAuthority: false,
  });
}

export interface EffectProjection {
  /** effectId -> the ONE canonical event. Append-only: a settled entry is never overwritten. */
  readonly canonical: ReadonlyMap<string, EffectEventV1>;
  readonly accepted: number;
  readonly deduplicated: number;
  readonly refused: number;
  readonly quarantined: readonly { readonly effectId: string; readonly reason: 'conflict' }[];
}

/** Canonical hash of an event's PAYLOAD under its fixed id — the conflict discriminator (same id + same hash
 *  = an idempotent redelivery; same id + different hash = a conflict). Exported for the durable store adapter. */
export function effectPayloadHash(e: EffectEventV1): string {
  return canonicalHash({ domain: 'AUKORA-EFFECT-PAYLOAD/1', effectId: e.effectId, effect: e.effect, createdAtIso: e.createdAtIso });
}

/**
 * ORDER-INDEPENDENT, append-only projection of a delivery stream into ONE canonical row per effectId:
 *   - N identical deliveries of the same effect → ONE canonical entry (idempotent convergence);
 *   - a later delivery under the same effectId with a DIFFERENT payload → QUARANTINE (explicit refusal; the
 *     settled entry is NEVER silently overwritten — a compromised/replaying backend cannot flip a settled effect);
 *   - a malformed delivery → refused and dropped, counted.
 * Because acceptance is keyed by content-addressed id + payload hash, the projection is a pure function of the
 * event SET: any permutation of the same deliveries yields the identical canonical map (destroy-and-rebuild safe).
 */
export function projectEffectEvents(deliveries: readonly unknown[]): EffectProjection {
  const canonical = new Map<string, EffectEventV1>();
  const hashes = new Map<string, string>();
  let accepted = 0, deduplicated = 0, refused = 0;
  const quarantined: { effectId: string; reason: 'conflict' }[] = [];
  for (const d of deliveries) {
    const e = validateEffectEvent(d);
    if (e === null) { refused++; continue; }
    const h = effectPayloadHash(e);
    const prior = hashes.get(e.effectId);
    if (prior === undefined) { canonical.set(e.effectId, e); hashes.set(e.effectId, h); accepted++; }
    else if (prior === h) { deduplicated++; }
    else { quarantined.push({ effectId: e.effectId, reason: 'conflict' }); }
  }
  return { canonical, accepted, deduplicated, refused, quarantined };
}

/** A stable root over the canonical projection — identical iff the canonical SET is identical (rebuild proof). */
export function effectProjectionRoot(p: EffectProjection): string {
  const rows = [...p.canonical.values()]
    .map((e) => ({ effectId: e.effectId, payload: effectPayloadHash(e) }))
    .sort((a, b) => (a.effectId < b.effectId ? -1 : a.effectId > b.effectId ? 1 : 0));
  return canonicalHash({ domain: 'AUKORA-EFFECT-ROOT/1', rows });
}

/** HARD: an effect event can never mint authority. Constant, by construction. */
export function effectEventGrantsAuthority(): false {
  return false;
}
