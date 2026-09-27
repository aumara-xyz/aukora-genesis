// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * AURA TRACE v1 — the qualitative epoch (AURA lane round 2, docs/mesh/handoff/AURA.md).
 *
 * The substrate BENEATH the coherence glyph, not a product claim: one epoch is a strict,
 * bounded, deterministic record of COMMITMENTS to governed receipt-chain evidence — the
 * shape of a history, never its content and never a number about a person.
 *
 * WHAT AN EPOCH IS:
 *   - an ordered list of one-way commitments, each sha256(domain-tag ‖ chainKey ‖ chainHeadHash).
 *     The chain head hash already commits to the entire recorded history of that chain; hashing
 *     it once more with the key makes the payload non-recoverable: nothing in an epoch can be
 *     reversed into keys, content, prompts, contacts, vouch edges, or model outputs.
 *   - an epoch commitment: sha256 over the canonical serialization of the fixed field list —
 *     the same ordered inputs ALWAYS produce the same commitment; any changed, reordered, or
 *     missing input produces a DIFFERENT commitment. There is no repair path and no guessing.
 *   - a glyph seed derived from the epoch commitment — the deterministic handle the cymatic
 *     glyph MAY consume in a later round. A seed is a shape-picker, never a score.
 *   - optionally, drand evidence (round + randomness) — public-time freshness ONLY.
 *
 * TRUTH LIMITS (stamped into every epoch and re-checked by the verifier — TRACE_LIMITS):
 *   drand proves public-time freshness only; receipt commitments prove continuity of recorded
 *   history only; key signatures prove key possession only. NONE of these — alone or together —
 *   proves biological humanity, honesty, or exclusive human control. An epoch is
 *   advisoryOnly:true / grantsAuthority:false forever: it cannot unlock, sign, approve, rank,
 *   gate, or apply anything, and it carries no score, balance, rank, count-as-AURA, or
 *   personhood percentage — the verifier REFUSES payloads that smuggle one in.
 *
 * ERASURE, respected by construction: when a source row is erased, its receipt chain grows an
 * erasure receipt, so its chain head CHANGES — an old epoch then fails verification against the
 * live evidence (honest: the world moved), while the old payload itself remains one-way hashes
 * from which nothing about the erased content is recoverable.
 *
 * Pure module: no IO, no clock reads (timestamps are inputs), no imports beyond node crypto.
 */
import { createHash } from 'crypto';
import { verifyDrandRound } from './drandAnchor';

export const AURA_TRACE_SCHEMA = 'aura-trace-v1' as const;

/** Hard bounds — an epoch is small, always. */
export const MAX_TRACE_COMMITMENTS = 256;
export const MAX_OWNER_CHARS = 64;

/** The stamped truth limits. Frozen; the verifier requires them VERBATIM in every epoch so no
 *  copy of a trace can quietly drop what it may not claim. */
export const TRACE_LIMITS = Object.freeze({
  drand: 'public-time freshness only',
  receipts: 'continuity of recorded history only',
  signatures: 'key possession only',
  never: 'not humanity, not honesty, not exclusive control; cannot unlock, sign, approve, rank, gate, or apply',
});

/** Field names an epoch may NEVER carry (nor any nested object inside it) — the numeric-AURA
 *  ghost words. Checked recursively by the verifier: a payload that smuggles a score is refused
 *  no matter how it got there. */
export const FORBIDDEN_TRACE_FIELDS = Object.freeze([
  'aura', 'score', 'balance', 'rank', 'points', 'personhood', 'streak', 'level', 'reputation', 'weight',
]);

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
const HEX64 = /^[0-9a-f]{64}$/;
const HEX96 = /^[0-9a-f]{96}$/;
// chainKey grammar: segments of the identity-name alphabet joined by ':' (e.g. mem:aumara.root:turn.x.0)
const CHAIN_KEY_RE = /^[a-z0-9._-]{1,64}(:[a-z0-9._-]{1,64}){0,3}$/;

export class AuraTraceError extends Error {
  constructor(public readonly code: string, message: string) { super(`${code}: ${message}`); this.name = 'AuraTraceError'; }
}
const fail = (code: string, message: string): never => { throw new AuraTraceError(code, message); };

/** What the BUILDER reads. Never serialized into the epoch — only its one-way commitment is. */
export interface TraceEvidenceInput {
  chainKey: string; // identifier of a governed receipt chain (e.g. mem:<owner>:<key>)
  chainHeadHash: string; // 64-hex head of that chain — itself a commitment to the whole history
}

export interface TraceDrandEvidence {
  round: number; // the beacon round identifier (technical id, not a score)
  randomness: string; // 64-hex beacon output
  signature: string; // 96-hex BLS signature, verified against the pinned quicknet key
}

export interface AuraTraceEpochV1 {
  schema: typeof AURA_TRACE_SCHEMA;
  epochOf: string; // pseudonymous root id (e.g. aumara.root) — an identifier, never a name
  at: string; // ISO technical timestamp (builder input, not a clock read)
  drand: TraceDrandEvidence | null; // optional public-time evidence — freshness ONLY
  commitments: string[]; // ordered one-way commitments (64-hex each)
  prevEpochCommitment: string | null; // epoch chaining (continuity across epochs); null = genesis
  epochCommitment: string; // sha256 over the canonical fixed field list — THE identity of this epoch
  glyphSeed: string; // deterministic seed the glyph MAY consume later — a shape-picker, never a score
  advisoryOnly: true;
  grantsAuthority: false;
  limits: typeof TRACE_LIMITS;
}

const EPOCH_KEYS: ReadonlySet<string> = new Set([
  'schema', 'epochOf', 'at', 'drand', 'commitments', 'prevEpochCommitment', 'epochCommitment', 'glyphSeed', 'advisoryOnly', 'grantsAuthority', 'limits',
]);

/** One evidence input → one one-way commitment. Domain-tagged so a trace commitment can never be
 *  confused with any other hash in the system. */
export function commitEvidence(e: TraceEvidenceInput): string {
  if (!e || typeof e.chainKey !== 'string' || !CHAIN_KEY_RE.test(e.chainKey)) return fail('trace_chain_key_invalid', 'evidence chainKey must match the governed chain-key grammar');
  if (typeof e.chainHeadHash !== 'string' || !HEX64.test(e.chainHeadHash)) return fail('trace_head_hash_invalid', 'evidence chainHeadHash must be 64-hex');
  return sha256(`aura-trace-v1:commit:${e.chainKey}:${e.chainHeadHash}`);
}

/** Canonical preimage of the epoch commitment — a FIXED field list in a FIXED order. Order of
 *  commitments is part of identity: reordered inputs are a different epoch, by design. */
function epochPreimage(p: { epochOf: string; at: string; drand: TraceDrandEvidence | null; commitments: string[]; prevEpochCommitment: string | null }): string {
  const drand = p.drand ? [p.drand.round, p.drand.randomness, p.drand.signature] : null;
  return JSON.stringify(['aura-trace-v1', p.epochOf, p.at, drand, p.commitments, p.prevEpochCommitment]);
}

function drandRandomness(signatureHex: string): string {
  return createHash('sha256').update(Buffer.from(signatureHex, 'hex')).digest('hex');
}

export interface BuildTraceInput {
  epochOf: string;
  at: string; // ISO timestamp, supplied by the caller (this module never reads a clock)
  evidence: TraceEvidenceInput[]; // ORDERED — order is part of the epoch's identity
  drand?: TraceDrandEvidence | null;
  prevEpochCommitment?: string | null;
}

/** Build one epoch. Deterministic and fail-closed: malformed input throws typed — never a
 *  best-effort epoch. */
export function buildAuraTraceEpoch(input: BuildTraceInput): AuraTraceEpochV1 {
  if (!input || typeof input !== 'object') return fail('trace_input_invalid', 'input must be an object');
  const { epochOf, at } = input;
  if (typeof epochOf !== 'string' || epochOf.length === 0 || epochOf.length > MAX_OWNER_CHARS || !CHAIN_KEY_RE.test(epochOf)) {
    return fail('trace_owner_invalid', 'epochOf must be a bounded identifier');
  }
  if (typeof at !== 'string' || !Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at) return fail('trace_at_invalid', 'at must be a canonical ISO timestamp');
  if (!Array.isArray(input.evidence) || input.evidence.length === 0) return fail('trace_evidence_empty', 'an epoch commits to at least one evidence chain');
  if (input.evidence.length > MAX_TRACE_COMMITMENTS) return fail('trace_evidence_overflow', `at most ${MAX_TRACE_COMMITMENTS} commitments per epoch`);
  const drand = input.drand ?? null;
  if (drand !== null) {
    if (!Number.isSafeInteger(drand.round) || drand.round <= 0) return fail('trace_drand_invalid', 'drand round must be a positive safe integer');
    if (typeof drand.randomness !== 'string' || !HEX64.test(drand.randomness)) return fail('trace_drand_invalid', 'drand randomness must be 64-hex');
    if (typeof drand.signature !== 'string' || !HEX96.test(drand.signature)) return fail('trace_drand_invalid', 'drand signature must be 96-hex');
    if (!verifyDrandRound(drand.round, drand.signature)) return fail('trace_drand_unverified', 'drand signature failed pinned-key verification');
    if (drandRandomness(drand.signature) !== drand.randomness) return fail('trace_drand_randomness_mismatch', 'drand randomness does not match the verified signature');
  }
  const prev = input.prevEpochCommitment ?? null;
  if (prev !== null && (typeof prev !== 'string' || !HEX64.test(prev))) return fail('trace_prev_invalid', 'prevEpochCommitment must be 64-hex or null');

  const commitments = input.evidence.map(commitEvidence); // throws typed on any malformed input
  const epochCommitment = sha256(epochPreimage({ epochOf, at, drand, commitments, prevEpochCommitment: prev }));
  return {
    schema: AURA_TRACE_SCHEMA,
    epochOf,
    at,
    drand: drand ? { round: drand.round, randomness: drand.randomness, signature: drand.signature } : null,
    commitments,
    prevEpochCommitment: prev,
    epochCommitment,
    glyphSeed: sha256(`aura-trace-v1:glyph:${epochCommitment}`),
    advisoryOnly: true,
    grantsAuthority: false,
    limits: TRACE_LIMITS,
  };
}

/** What a VALID epoch is allowed to claim — and nothing more. The verifier names each claim with
 *  its limit fused in, so a caller cannot quote a claim without its boundary. */
export interface TraceClaims {
  continuity: string; // 'N commitment(s) to governed receipt-chain history — continuity only'
  freshness: string; // drand present: 'after drand round N — public-time freshness only' | 'none claimed'
  never: string; // the standing refusal, verbatim from TRACE_LIMITS.never
}

export type TraceVerifyResult =
  | { valid: true; epochCommitment: string; glyphSeed: string; claims: TraceClaims }
  | { valid: false; reason: string };

function findForbiddenField(o: unknown, pathStr: string): string | null {
  if (o === null || typeof o !== 'object') return null;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (FORBIDDEN_TRACE_FIELDS.includes(k.toLowerCase())) return `${pathStr}.${k}`;
    const nested = findForbiddenField(v, `${pathStr}.${k}`);
    if (nested) return nested;
  }
  return null;
}

/**
 * Verify one epoch. Fail-closed on everything: shape, bounds, the stamped limits (verbatim),
 * the no-authority literals, forbidden numeric-AURA fields anywhere in the payload, and the
 * commitment math. When live `evidence` is supplied, every commitment is RECOMPUTED in order —
 * a changed, missing, reordered, or extra source fails with a typed reason. Nothing is ever
 * repaired, guessed, or partially accepted.
 */
export function verifyAuraTraceEpoch(epoch: unknown, opts: { evidence?: TraceEvidenceInput[] } = {}): TraceVerifyResult {
  const refuse = (reason: string): TraceVerifyResult => ({ valid: false, reason });
  if (!epoch || typeof epoch !== 'object') return refuse('trace_not_an_object');
  const e = epoch as Record<string, unknown>;
  if (e.schema !== AURA_TRACE_SCHEMA) return refuse('trace_wrong_schema');
  for (const k of Object.keys(e)) if (!EPOCH_KEYS.has(k)) return refuse(`trace_unknown_field:${k}`);
  const forbidden = findForbiddenField(e, 'epoch');
  if (forbidden) return refuse(`trace_forbidden_field:${forbidden}`);
  if (e.advisoryOnly !== true) return refuse('trace_advisory_literal_missing');
  if (e.grantsAuthority !== false) return refuse('trace_authority_literal_missing');
  const limits = e.limits as Record<string, unknown> | null;
  if (!limits || Object.keys(limits).sort().join(',') !== Object.keys(TRACE_LIMITS).sort().join(',')) return refuse('trace_limits_shape_invalid');
  for (const [k, v] of Object.entries(TRACE_LIMITS)) {
    if (!limits || limits[k] !== v) return refuse(`trace_limits_altered:${k}`); // the boundaries travel VERBATIM or not at all
  }
  if (typeof e.epochOf !== 'string' || !CHAIN_KEY_RE.test(e.epochOf)) return refuse('trace_owner_invalid');
  if (typeof e.at !== 'string' || !Number.isFinite(Date.parse(e.at)) || new Date(e.at).toISOString() !== e.at) return refuse('trace_at_invalid');
  const drand = e.drand as TraceDrandEvidence | null;
  if (drand !== null) {
    if (!drand || Object.keys(drand).sort().join(',') !== 'randomness,round,signature') return refuse('trace_drand_shape_invalid');
    if (!drand || !Number.isSafeInteger(drand.round) || drand.round <= 0) return refuse('trace_drand_malformed');
    if (typeof drand.randomness !== 'string' || !HEX64.test(drand.randomness)) return refuse('trace_drand_malformed');
    if (typeof drand.signature !== 'string' || !HEX96.test(drand.signature)) return refuse('trace_drand_malformed');
    if (!verifyDrandRound(drand.round, drand.signature)) return refuse('trace_drand_unverified');
    if (drandRandomness(drand.signature) !== drand.randomness) return refuse('trace_drand_randomness_mismatch');
  }
  const commitments = e.commitments as unknown;
  if (!Array.isArray(commitments) || commitments.length === 0 || commitments.length > MAX_TRACE_COMMITMENTS) return refuse('trace_commitments_invalid');
  for (const c of commitments) if (typeof c !== 'string' || !HEX64.test(c)) return refuse('trace_commitments_invalid');
  const prev = e.prevEpochCommitment as unknown;
  if (prev !== null && (typeof prev !== 'string' || !HEX64.test(prev))) return refuse('trace_prev_invalid');

  const recomputed = sha256(epochPreimage({
    epochOf: e.epochOf as string,
    at: e.at as string,
    drand,
    commitments: commitments as string[],
    prevEpochCommitment: (prev as string | null),
  }));
  if (recomputed !== e.epochCommitment) return refuse('trace_commitment_mismatch'); // tampered — never repaired
  if (sha256(`aura-trace-v1:glyph:${recomputed}`) !== e.glyphSeed) return refuse('trace_glyph_seed_mismatch');

  if (opts.evidence) {
    if (opts.evidence.length !== (commitments as string[]).length) return refuse('trace_evidence_count_mismatch');
    // Iterated rather than indexed: `for...of` yields a DEFINED element, so the recomputation below
    // needs no assertion to satisfy `noUncheckedIndexedAccess`. The runtime behaviour is unchanged —
    // `commitEvidence` still throws typed on anything malformed, and that throw is still the refusal.
    let i = 0;
    for (const source of opts.evidence) {
      let expected: string;
      try { expected = commitEvidence(source); } catch (err) { return refuse(err instanceof AuraTraceError ? err.code : 'trace_evidence_invalid'); }
      if (expected !== (commitments as string[])[i]) return refuse(`trace_evidence_mismatch_at:${i}`); // changed / reordered / erased-and-moved-on — all land here
      i += 1;
    }
  }

  return {
    valid: true,
    epochCommitment: recomputed,
    glyphSeed: e.glyphSeed as string,
    claims: {
      continuity: `${(commitments as string[]).length} commitment(s) to governed receipt-chain history — ${TRACE_LIMITS.receipts}`,
      freshness: drand ? `after drand round ${drand.round} — ${TRACE_LIMITS.drand}` : 'none claimed',
      never: TRACE_LIMITS.never,
    },
  };
}

/** The standing mechanical refusal, mirrored across governed surfaces. */
export function auraTraceGrantsAuthority(): false { return false; }
