// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * `aumlok-ceremony-echo-v1` — the first ripple, without the phrase (#288, approved design contract).
 *
 * A ONE-WAY VALVE between the ceremony door (upstream authority) and the display (downstream). After a
 * SUCCESSFUL bind/rotate — and only then — the door constructs one bounded, content-free packet from
 * exactly three inputs: the public authority-root identifier, a content-free receipt reference, and an
 * optional already-verified drand round. The renderer receives the packet, plays one slow silver-white
 * ripple that settles, shows one provenance line, and exposes NOTHING back — no completion state, no
 * query API, no event any auth code can observe. The visual verifies no one; it celebrates what the
 * receipt already proved.
 *
 * PROHIBITED BY CONTRACT (each is a pinned refusing test case): the phrase, its words or normalized
 * forms, fingerprints, KDF output, salts, any hash of phrase material, typing/keystroke events,
 * timings, durations, attempt counts, entropy/strength estimates, keys, signatures, audio, and any
 * score/rank/level/numeric-AURA field. The packet's field set is CLOSED — any unknown field refuses
 * the whole packet. Refusal reasons are categorical; offending contents are never echoed.
 *
 * AURA boundary (constitutional): evidence and display only — never authority, never a gate input,
 * never proof of humanity. Nonnumeric on the public surface: the only number the provenance line may
 * carry is a verified public drand round (public randomness, never person-derived).
 */
import { createHash } from 'crypto';

export const CEREMONY_ECHO_SCHEMA = 'aumlok-ceremony-echo-v1' as const;
export type CeremonyEchoEvent = 'bind' | 'rotate';

/** Identifier grammar for rootId/receiptRef (the contract's matrix): ≤64 chars of [a-z0-9._-]. */
const ID_RE = /^[a-z0-9._-]{1,64}$/;
const ALLOWED_KEYS = new Set(['schema', 'event', 'rootId', 'receiptRef', 'at', 'drand']);
const ALLOWED_DRAND_KEYS = new Set(['round']);

export interface CeremonyEchoPacket {
  schema: typeof CEREMONY_ECHO_SCHEMA;
  event: CeremonyEchoEvent;
  rootId: string;
  receiptRef: string;
  at: string; // canonical ISO instant
  drand?: { round: number };
}

export type CeremonyEchoRefusal =
  | 'packet_not_an_object' | 'packet_wrong_schema' | 'packet_bad_event' | 'packet_root_invalid'
  | 'packet_receipt_ref_invalid' | 'packet_at_invalid' | 'packet_drand_invalid'
  | 'packet_unknown_field' | 'packet_replayed';

export type CeremonyEchoVerdict =
  | { ok: true; packet: CeremonyEchoPacket }
  | { ok: false; refused: CeremonyEchoRefusal };

const refuse = (refused: CeremonyEchoRefusal): CeremonyEchoVerdict => ({ ok: false, refused });

/** Canonicalize an ISO instant or refuse — never guess. */
function canonicalIso(at: unknown): string | null {
  if (typeof at !== 'string' || at.length === 0 || at.length > 40) return null;
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/**
 * The acceptance matrix, implemented verbatim (contract §6). `seenReceiptRefs` enforces single-use:
 * one packet per ceremony receipt — a repeated ref refuses so the ripple can never become a signaling
 * channel or probing oracle. The set is caller-owned (the door's process lifetime).
 */
export function validateCeremonyEchoPacket(input: unknown, seenReceiptRefs: Set<string>): CeremonyEchoVerdict {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return refuse('packet_not_an_object');
  const p = input as Record<string, unknown>;
  for (const k of Object.keys(p)) if (!ALLOWED_KEYS.has(k)) return refuse('packet_unknown_field');
  if (p.schema !== CEREMONY_ECHO_SCHEMA) return refuse('packet_wrong_schema');
  if (p.event !== 'bind' && p.event !== 'rotate') return refuse('packet_bad_event');
  if (typeof p.rootId !== 'string' || !ID_RE.test(p.rootId)) return refuse('packet_root_invalid');
  if (typeof p.receiptRef !== 'string' || !ID_RE.test(p.receiptRef)) return refuse('packet_receipt_ref_invalid');
  const at = canonicalIso(p.at);
  if (at === null) return refuse('packet_at_invalid');
  let drand: { round: number } | undefined;
  if (p.drand !== undefined) {
    if (!p.drand || typeof p.drand !== 'object' || Array.isArray(p.drand)) return refuse('packet_drand_invalid');
    const d = p.drand as Record<string, unknown>;
    for (const k of Object.keys(d)) if (!ALLOWED_DRAND_KEYS.has(k)) return refuse('packet_drand_invalid');
    if (!Number.isSafeInteger(d.round) || (d.round as number) <= 0) return refuse('packet_drand_invalid');
    drand = { round: d.round as number };
  }
  if (seenReceiptRefs.has(p.receiptRef as string)) return refuse('packet_replayed');
  seenReceiptRefs.add(p.receiptRef as string);
  return { ok: true, packet: { schema: CEREMONY_ECHO_SCHEMA, event: p.event, rootId: p.rootId, receiptRef: p.receiptRef, at, ...(drand ? { drand } : {}) } as CeremonyEchoPacket };
}

/**
 * Content-free receipt reference — derived ONLY from already-public receipt facts (the authority
 * keyId, the receipt's boundAt instant, the event, and the packet instant). By construction it can
 * carry nothing about the phrase: none of its inputs ever touched phrase material.
 */
export function deriveReceiptRef(input: { keyId: string; boundAt: string; event: CeremonyEchoEvent; atIso: string }): string {
  return createHash('sha256')
    .update(`aumlok-ceremony-echo-ref:${input.keyId}|${input.boundAt}|${input.event}|${input.atIso}`)
    .digest('hex').slice(0, 24);
}

/** Build a packet at the door's success path (the ONE construction site). Refuses rather than guesses. */
export function buildCeremonyEchoPacket(
  input: { event: CeremonyEchoEvent; rootId: string; receiptRef: string; atMs: number; drandRound?: number },
  seenReceiptRefs: Set<string>,
): CeremonyEchoVerdict {
  const candidate: Record<string, unknown> = {
    schema: CEREMONY_ECHO_SCHEMA,
    event: input.event,
    rootId: input.rootId,
    receiptRef: input.receiptRef,
    at: new Date(input.atMs).toISOString(),
    ...(input.drandRound !== undefined ? { drand: { round: input.drandRound } } : {}),
  };
  return validateCeremonyEchoPacket(candidate, seenReceiptRefs);
}

/**
 * Deterministic animation parameters — identical packet → byte-identical params (the #290 determinism
 * property). The envelope is FIXED (rise → brief sustain → settle, ~10s total); the optional drand
 * round seeds transient phase offsets only — public randomness, never person-derived. The state is the
 * NAMED word `silver`: a qualitative state, never a value, never computed from a person-derived number.
 * All floats here are renderer-internal and bounded; none is ever displayed.
 */
export interface CeremonyEchoEnvelope {
  state: 'silver';
  riseMs: 2400;
  sustainMs: 1800;
  settleMs: 6000;
  /** bounded [0,1) transient phase offsets, deterministic from public packet fields only */
  phase: [number, number, number];
}

export function echoEnvelopeParams(packet: CeremonyEchoPacket): CeremonyEchoEnvelope {
  const seed = createHash('sha256')
    .update(`ceremony-echo-phase:${packet.rootId}|${packet.receiptRef}|${packet.drand ? packet.drand.round : 'none'}`)
    .digest();
  const unit = (i: number) => seed.readUInt16BE(i * 2) / 0x10000;
  return { state: 'silver', riseMs: 2400, sustainMs: 1800, settleMs: 6000, phase: [unit(0), unit(1), unit(2)] };
}

/**
 * The one visible provenance line (contract §4): recorded binding fact, then the aesthetic returns.
 * Shape: `bound locally · receipt <short-ref>` (+ ` · drand <round>` ONLY when a verified round is
 * present — never invented). The short-ref is ≤12 chars of the receipt reference. The binding fact is
 * the receipt; the ripple is aesthetic inference — motion is never data.
 */
export function ceremonyEchoProvenanceLine(packet: CeremonyEchoPacket): string {
  const verb = packet.event === 'bind' ? 'bound' : 'rotated';
  const base = `${verb} locally · receipt ${packet.receiptRef.slice(0, 12)}`;
  return packet.drand ? `${base} · drand ${packet.drand.round}` : base;
}
