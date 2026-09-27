// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Aukora Fu — the hardened eight-seat glyph council (H1-H8 from PR #352's
 * docs/AUKORA_FU_COUNCIL_HARDENING.md), replayed onto current main as the minimal component the
 * Fusion-Council chat lane needs (fusion-chat integration round, 2026-07-13). The source of this
 * module is `fable/aukora-fu-eight-seat@c8072cc4` (PR #352); it was NOT merged wholesale — only this
 * orchestrator, its spend ledger, and their tests were replayed, with two deliberate additions:
 *   - `nonvote_truncated`: a non-`stop` finish whose packet is incomplete is recorded as a TRUNCATED
 *     non-vote (FUSION_REACTOR.md mechanical test 3), distinct from a merely malformed reply.
 *   - `CouncilOpts.quorum`: the quorum rule is explicit and caller-configurable. The default is
 *     unchanged (≥6 valid packets from ≥6 distinct families + a verified Fable seat). The chat lane
 *     passes a majority-of-requested-roster rule because its roster may be env-narrowed to 2 seats;
 *     the rule actually applied is carried in the outcome so no surface can misreport it.
 *
 * This is the ADVISORY deliberation orchestrator. It builds on the existing glyph engine
 * (aukoraFuGlyph.ts: GlyphPacket, tilde, perceive, parseGlyphResponse) and adds the hardening the
 * design doc specified over the sequential, 5-capped, no-synthesizer engine path:
 *   H1 parallel bounded fan-out (Promise.allSettled — a rejected seat is a non-vote, never a
 *      whole-council reject; Codex's safety correction over Promise.all)
 *   H2 all EIGHT canonical seats (was .slice(0,5))
 *   H3 English-last synthesis (a single final render; the old top-HYP shortcut is the fallback)
 *   H4 claim-anchor manifold (seats emit a vector over a shared enumerated claim basis)
 *   H5 lineage-cluster weighting (one effective vote per model family)
 *   H6 evidence-aware phase-lock (matched-prior consensus flagged; the #336 mislabel fixed)
 *   H7 calibration input (per-seat track-record multiplier feeds the weights)
 *   H8 frozen+digested claim basis before round 1, and a strip-neutral replay for verdict drift
 *
 * NAMING DISCIPLINE: the packets exchanged here are structured, API-visible semantic projections —
 * transport representations. They are NOT raw model activations, native latent states, embeddings,
 * or chain-of-thought, and nothing in this module may describe them as such.
 *
 * PURITY: all deliberation logic here is pure. The only outside effect is the injected `Transport`
 * (the model calls). Tests run fully offline with a fake transport. Nothing here writes the repo,
 * touches Nebius, or grants authority — the council is EVIDENCE, never authority (see §7 of the spec).
 */
import {
  type GlyphPacket, type StanceGlyph, type FrameworkType,
  tilde, perceive, GlyphChannel, confidenceToNumber, parseGlyphResponse,
} from './aukoraFuGlyph';
import { createHash } from 'crypto';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// ── Canonical roster (H2) ─────────────────────────────────────────────────────────────────────
export interface CouncilSeat {
  id: string;
  slug: string;
  name: string;
  family: string;                 // training lineage — the H5 cluster key
  framework: FrameworkType;
  /** Informational $/1M output tokens for the spend ESTIMATE only — never a selection or quorum input.
   *  Unknown prices must fail HIGH (see SpendMeter) so an estimate can never sneak under a ceiling. */
  costPer1M: number;
}

/** The eight seats accepted as H1-H8 (Grok-4.5 is seat eight). The OpenAI seat is `gpt-5.6-sol`,
 *  following the accepted FUSION_REACTOR.md roster; both `-sol` and `-terra` were confirmed served on
 *  the live OpenRouter catalog (2026-07-13), so this is a canon choice, not an availability fallback —
 *  PR #341 registered Terra; the Sol/Terra decision remains flagged for Codex confirmation. */
export const CANONICAL_SEATS: readonly CouncilSeat[] = [
  { id: 'FBL', slug: 'anthropic/claude-fable-5',   name: 'Fable-5',          family: 'anthropic', framework: 'symbolic',    costPer1M: 3.0 },
  { id: 'QWN', slug: 'qwen/qwen3.7-max',           name: 'Qwen-3.7',         family: 'alibaba',   framework: 'geometric',   costPer1M: 1.2 },
  { id: 'DSK', slug: 'deepseek/deepseek-v4-pro',   name: 'DeepSeek-V4',      family: 'deepseek',  framework: 'statistical', costPer1M: 0.9 },
  { id: 'KIM', slug: 'moonshotai/kimi-k2.7-code',  name: 'Kimi-K2.7',        family: 'moonshot',  framework: 'embodied',    costPer1M: 0.74 },
  { id: 'MST', slug: 'mistralai/mistral-large-2512', name: 'Mistral-Large',  family: 'mistral',   framework: 'embodied',    costPer1M: 2.0 },
  { id: 'SOL', slug: 'openai/gpt-5.6-sol',         name: 'GPT-5.6-Sol',      family: 'openai',    framework: 'statistical', costPer1M: 4.0 },
  { id: 'GEM', slug: 'google/gemini-3.5-flash',    name: 'Gemini-3.5-Flash', family: 'google',    framework: 'geometric',   costPer1M: 0.4 },
  { id: 'GRK', slug: 'x-ai/grok-4.5',              name: 'Grok-4.5',         family: 'xai',        framework: 'narrative',   costPer1M: 3.0 },
];

// ── Claim-anchor manifold (H4/H8) ─────────────────────────────────────────────────────────────
export interface Claim { id: string; text: string; }
export interface ClaimBasis {
  problemDigest: string;
  claims: readonly Claim[];
  frozenAt: number;
  /** Digest over the canonicalized basis. The synthesis seat cannot move the question after votes:
   *  the digest is recomputed and compared at synthesis time (H8). */
  digest: string;
}

/** Freeze + digest the shared claim basis BEFORE round 1 (H8). Claim ids are normalized to C1..Ck. */
export function freezeClaimBasis(problem: string, claimTexts: readonly string[], now = Date.now()): ClaimBasis {
  const claims = claimTexts.map((text, i) => ({ id: `C${i + 1}`, text: text.trim() }));
  const problemDigest = sha256(problem.trim());
  const canonical = JSON.stringify({ problemDigest, claims });
  return { problemDigest, claims, frozenAt: now, digest: sha256(canonical) };
}

export function verifyClaimBasis(basis: ClaimBasis, problem: string): boolean {
  const canonical = JSON.stringify({ problemDigest: sha256(problem.trim()), claims: basis.claims });
  return sha256(canonical) === basis.digest && sha256(problem.trim()) === basis.problemDigest;
}

/** A seat's projection into claim space: signed confidence in [-1,1] per claim id. */
export type ClaimVector = Record<string, number>;

/** Parse a `CLAIMS:(C1=+0.8,C2=-0.3)` suffix into a vector confined to the frozen basis ids.
 *  Out-of-basis ids and out-of-range values are dropped (the basis is authoritative, not the seat). */
export function parseClaimVector(text: string, basis: ClaimBasis): ClaimVector {
  const ids = new Set(basis.claims.map((c) => c.id));
  const v: ClaimVector = {};
  const m = /CLAIMS:\(([^)]*)\)/i.exec(text);
  if (!m) return v;
  for (const pair of m[1].split(',')) {
    const kv = /\s*(C\d+)\s*=\s*([+-]?\d*\.?\d+)\s*/i.exec(pair);
    if (!kv) continue;
    const id = kv[1].toUpperCase();
    const val = Number(kv[2]);
    if (ids.has(id) && Number.isFinite(val) && val >= -1 && val <= 1) v[id] = val;
  }
  return v;
}

// ── Seat outcome (strict non-votes) ───────────────────────────────────────────────────────────
export type SeatStatus =
  | 'voted' | 'nonvote_empty' | 'nonvote_malformed' | 'nonvote_truncated' | 'nonvote_substituted'
  | 'nonvote_unverified' | 'nonvote_timeout' | 'nonvote_error';
export interface SeatResult {
  seatId: string;
  slug: string;
  requestedSlug: string;
  served?: string;
  status: SeatStatus;
  packet?: GlyphPacket;
  claimVector?: ClaimVector;
  reason?: string;
  repaired?: boolean;   // true if this vote came from the one bounded format-repair attempt
}
export const isVote = (r: SeatResult): boolean => r.status === 'voted';

/** Transport is injected: the ONLY outside effect. It MUST honor `signal` — on deadline the controller
 *  aborts so a timed-out PAID request is actually cancelled, not left billing outside the outcome
 *  (blocker 2). `costUsd` (provider-returned cost) is preferred for spend accounting; `outputTokens`
 *  is only the fallback when the provider does not return a cost. `finishReason` is the provider's
 *  finish/native-finish reason — a non-`stop` finish whose packet is incomplete becomes a TRUNCATED
 *  non-vote rather than a generic malformed one. A throw becomes a non-vote. */
export interface SeatResponse { text: string; served?: string; outputTokens?: number; costUsd?: number; finishReason?: string; }
export type Transport = (
  seat: CouncilSeat, prompt: string, phase: 'round1' | 'round2' | 'synthesis', signal: AbortSignal,
) => Promise<SeatResponse>;

/** Thrown when a seat call exceeds its deadline — distinguished from other failures so the outcome
 *  records a timeout as `nonvote_timeout` (a cancelled paid call), not a generic error. */
export class DeadlineError extends Error {}

// ── Bounded packet extraction (blocker 5) ─────────────────────────────────────────────────────
export const PACKET_OPEN = '<<<AUKORA_FU_PACKET>>>';
export const PACKET_CLOSE = '<<<END_AUKORA_FU_PACKET>>>';
const GLYPH_RE =
  /STANCE:\s*[⊕⊖⊙⊘⊚]\s+CONFIDENCE:\s*[⇈↑→↓⇊]\s+STRATEGY:\s*[↗↘↙↖⇄]\s+FRAMEWORK:\s*(?:geometric|symbolic|statistical|narrative|embodied|social)\s+DIST:\([^)]*\)/;

export type PacketExtraction =
  | { ok: true; glyphLine: string; claimsLine: string; hyp: string }
  | { ok: false; reason: string };

/** Extract EXACTLY ONE uniquely-tagged packet block, and within it exactly one glyph line, one CLAIMS
 *  line, and one HYP. Rejects zero, duplicate, ambiguous, unterminated, or trailing-conflict payloads —
 *  bounded, NOT a permissive prose scrape (blocker 5). Claim ids are validated separately against the basis. */
export function extractPacketBlock(text: string): PacketExtraction {
  const opens = text.split(PACKET_OPEN).length - 1;
  const closes = text.split(PACKET_CLOSE).length - 1;
  if (opens === 0) return { ok: false, reason: 'no-packet-block' };
  if (opens > 1 || closes > 1) return { ok: false, reason: 'duplicate-packet-block' };
  if (closes === 0) return { ok: false, reason: 'unterminated-packet-block' };
  const start = text.indexOf(PACKET_OPEN) + PACKET_OPEN.length;
  const end = text.indexOf(PACKET_CLOSE);
  if (end < start) return { ok: false, reason: 'malformed-packet-block' };
  const block = text.slice(start, end);
  const glyphs = block.match(new RegExp(GLYPH_RE, 'g')) ?? [];
  if (glyphs.length === 0) return { ok: false, reason: 'no-glyph-line' };
  if (glyphs.length > 1) return { ok: false, reason: 'ambiguous-multiple-glyph-lines' };
  const claimsAll = block.match(/CLAIMS:\([^)]*\)/gi) ?? [];
  if (claimsAll.length > 1) return { ok: false, reason: 'ambiguous-multiple-claims-lines' };
  const hypAll = block.match(/HYP:\s*"[^"]*"/g) ?? [];
  if (hypAll.length === 0) return { ok: false, reason: 'no-hyp' };
  if (hypAll.length > 1) return { ok: false, reason: 'ambiguous-multiple-hyp' };
  const hyp = /HYP:\s*"([^"]*)"/.exec(block)![1];
  return { ok: true, glyphLine: glyphs[0]!, claimsLine: claimsAll[0] ?? 'CLAIMS:()', hyp }; // length checked === 1 above
}

/** Strict claim-vector parse: REJECTS out-of-basis ids or malformed pairs (returns null) rather than
 *  silently dropping them (blocker 5). An empty `CLAIMS:()` is a valid empty vector. */
export function parseClaimVectorStrict(claimsLine: string, basis: ClaimBasis): ClaimVector | null {
  const ids = new Set(basis.claims.map((c) => c.id));
  const v: ClaimVector = {};
  const m = /CLAIMS:\(([^)]*)\)/i.exec(claimsLine);
  if (!m) return v;
  const body = m[1].trim();
  if (!body) return v;
  for (const pair of body.split(',')) {
    const kv = /^\s*(C\d+)\s*=\s*([+-]?\d*\.?\d+)\s*$/i.exec(pair);
    if (!kv) return null;                                    // malformed pair
    const id = kv[1].toUpperCase();
    const val = Number(kv[2]);
    if (!ids.has(id)) return null;                           // out-of-basis id → reject the packet
    if (!Number.isFinite(val) || val < -1 || val > 1) return null;
    v[id] = val;
  }
  return v;
}

/** Classify one raw seat response into a strict outcome. Missing OR mismatched served identity is a
 *  non-vote (fail-closed — an unverifiable model must never be counted as that seat); so is any packet
 *  that fails the bounded extraction or carries an out-of-basis claim. A failed extraction under a
 *  non-`stop` finish is recorded as TRUNCATED — the reply was cut, not merely misformatted. */
export function classifySeatResult(seat: CouncilSeat, resp: SeatResponse | undefined, basis: ClaimBasis): SeatResult {
  const base = { seatId: seat.id, slug: seat.slug, requestedSlug: seat.slug, served: resp?.served };
  if (!resp || !resp.text || !resp.text.trim()) return { ...base, status: 'nonvote_empty', reason: 'empty reply' };
  // Missing served identity fails CLOSED — a well-formed packet with no proof of WHICH model produced it
  // cannot be a vote (else a served-less response could even set fableVerified=true). PR #352 truth bug.
  if (!resp.served) return { ...base, status: 'nonvote_unverified', reason: 'no served-model identity' };
  if (!servedMatches(seat.slug, resp.served)) {
    return { ...base, status: 'nonvote_substituted', reason: `served ${resp.served} ≠ requested ${seat.slug}` };
  }
  const extracted = extractPacketBlock(resp.text);
  if (!extracted.ok) {
    const truncated = !!resp.finishReason && resp.finishReason !== 'stop';
    if (truncated) return { ...base, status: 'nonvote_truncated', reason: `truncated (finish=${resp.finishReason}): ${extracted.reason}` };
    return { ...base, status: 'nonvote_malformed', reason: extracted.reason };
  }
  const parsed = parseGlyphResponse(`${extracted.glyphLine} HYP:"${extracted.hyp}"`, seat.id);
  if (parsed.incident) return { ...base, status: 'nonvote_malformed', reason: parsed.incident.type };
  const cv = parseClaimVectorStrict(extracted.claimsLine, basis);
  if (cv === null) return { ...base, status: 'nonvote_malformed', reason: 'out-of-basis-or-malformed-claim' };
  return { ...base, status: 'voted', packet: parsed.packet, claimVector: cv };
}

/** Explicit provider-alias table (blocker 1): a canonical request slug → the additional served ids that
 *  are the SAME model under a different string. Only OBSERVED aliases are listed; a trailing date is
 *  stripped before comparison. Everything not exactly equal or explicitly aliased fails CLOSED — so
 *  `max`/`pro`/`flash`/`code` stay significant (Qwen-Max ≠ Qwen-Pro, Gemini-Flash ≠ Gemini-Pro). */
export const SERVED_ALIASES: Readonly<Record<string, readonly string[]>> = {
  // OpenRouter reports Fable with reordered tokens (caught by the council's own live run, 2026-07-12).
  'anthropic/claude-fable-5': ['anthropic/claude-5-fable'],
};

const stripDate = (s: string) => s.toLowerCase().trim().replace(/-\d{6,}$/, '');

/** Exact served-model identity: after stripping a trailing date, the served id must EQUAL the canonical
 *  request slug or an explicitly listed alias. No generic token stripping — a Flash-for-Pro or Max-for-Pro
 *  swap, or any unknown id, fails closed. */
export function servedMatches(requested: string, served: string): boolean {
  const r = stripDate(requested), sv = stripDate(served);
  if (sv === r) return true;
  const aliases = SERVED_ALIASES[requested.toLowerCase().trim()] ?? SERVED_ALIASES[r] ?? [];
  return aliases.some((a) => stripDate(a) === sv);
}

// ── Lineage-cluster weighting (H5) ────────────────────────────────────────────────────────────
/** One effective vote per family: each seat's base weight is divided by how many VOTING seats share
 *  its family. With eight distinct families this is a no-op; with two same-family seats each gets 0.5. */
export function lineageWeights(votes: SeatResult[], seats: readonly CouncilSeat[]): Map<string, number> {
  const familyOf = new Map(seats.map((s) => [s.id, s.family]));
  const familyCount = new Map<string, number>();
  for (const v of votes) {
    const fam = familyOf.get(v.seatId)!;
    familyCount.set(fam, (familyCount.get(fam) ?? 0) + 1);
  }
  const w = new Map<string, number>();
  for (const v of votes) {
    const fam = familyOf.get(v.seatId)!;
    w.set(v.seatId, 1 / (familyCount.get(fam) ?? 1));
  }
  return w;
}

// ── Evidence-aware phase-lock (H6, fixes #336) ────────────────────────────────────────────────
export interface PhaseLockAssessment {
  coherence: number;
  shearMagnitude: number;
  phaseLockDetected: boolean;
  hasEvidenceAnchor: boolean;
  /** The precise, non-misleading reason (the #336 fix: never print "no consensus" for TOO-PERFECT). */
  reason: 'genuine-consensus-with-evidence' | 'suspect-matched-prior-consensus' | 'genuine-divergence' | 'mixed';
  suspect: boolean;
}

/** Consensus is only trustworthy with a shared EVIDENCE anchor: at least one voting seat committed to a
 *  claim with strong signed confidence AND used a verify-leaning stance (strategy ↙ or a verify-heavy
 *  distribution). High coherence WITHOUT such an anchor is matched-prior phase-lock — flagged, not trusted. */
export function assessPhaseLock(votes: SeatResult[], basis: ClaimBasis): PhaseLockAssessment {
  const channel = new GlyphChannel();
  for (const v of votes) if (v.packet) channel.emit(v.packet);
  const verdict = perceive(channel);
  const anchored = votes.some((v) => {
    if (!v.claimVector || !v.packet) return false;
    const strongClaim = Object.values(v.claimVector).some((x) => Math.abs(x) >= 0.6);
    const verifyLean = v.packet.strategy === '↙' || v.packet.distribution.verify >= 0.4;
    return strongClaim && verifyLean;
  });
  const highConsensus = verdict.coherenceScore > 0.85;
  let reason: PhaseLockAssessment['reason'];
  if (highConsensus && anchored) reason = 'genuine-consensus-with-evidence';
  else if (highConsensus && !anchored) reason = 'suspect-matched-prior-consensus';
  else if (verdict.shearMagnitude > 0.5) reason = 'genuine-divergence';
  else reason = 'mixed';
  return {
    coherence: verdict.coherenceScore,
    shearMagnitude: verdict.shearMagnitude,
    phaseLockDetected: verdict.phaseLocked,
    hasEvidenceAnchor: anchored,
    reason,
    suspect: highConsensus && !anchored,
  };
}

// ── Strip-neutral replay (H8) ─────────────────────────────────────────────────────────────────
/** Re-perceive with every stance forced neutral (⊙). If the coherence verdict moves materially, the
 *  original consensus leaned on stance signalling rather than the underlying distributions — reported. */
export function neutralReplayDrift(votes: SeatResult[]): { baseCoherence: number; neutralCoherence: number; drift: number; material: boolean } {
  const base = new GlyphChannel();
  const neut = new GlyphChannel();
  for (const v of votes) {
    if (!v.packet) continue;
    base.emit(v.packet);
    neut.emit({ ...v.packet, stance: '⊙' as StanceGlyph });
  }
  const b = perceive(base).coherenceScore;
  const n = perceive(neut).coherenceScore;
  const drift = Math.abs(b - n);
  return { baseCoherence: b, neutralCoherence: n, drift, material: drift > 0.15 };
}

// ── Spend meter ($2/pass, $10/day; fail-closed) ───────────────────────────────────────────────
export class SpendCeilingExceeded extends Error {}
export interface SpendLimits { perPassUsd: number; perDayUsd: number; }
export const DEFAULT_SPEND_LIMITS: SpendLimits = { perPassUsd: 2.0, perDayUsd: 10.0 };

/** Pure spend estimator/guard. Estimates BEFORE any call and refuses to start a pass whose projected
 *  cost exceeds the per-pass ceiling, or whose addition to the day-to-date total exceeds the day ceiling.
 *  Unknown/zero prices are treated as a high floor so an estimate can never sneak under a ceiling. */
export class SpendMeter {
  private passSpentUsd = 0;   // ACTUAL spend recorded so far in the current pass (reset per pass)

  constructor(
    private readonly limits: SpendLimits = DEFAULT_SPEND_LIMITS,
    private dayToDateUsd = 0,
    private readonly priceFloorPer1M = 5.0,
    /** Most seats are reasoning models that bill hidden reasoning tokens on top of the visible output.
     *  The estimate multiplies the output-token cap by this factor so it OVER-predicts rather than under —
     *  fail-closed. ~8 matches the observed ~$0.46 for a real eight-seat two-round pass. */
    private readonly reasoningMultiplier = 8,
  ) {}

  /** Price of the synthesis call ($/1M tokens). Synthesis runs on a mid-priced seat; kept as a
   *  named constant so the estimate is auditable rather than buried in an expression. */
  private static readonly SYNTHESIS_PRICE_PER_1M = 4.0;

  private perCall(price: number, toks: number): number {
    return (Math.max(price, this.priceFloorPer1M) / 1_000_000) * toks * this.reasoningMultiplier;
  }

  /** Estimated cost of ONE fan-out batch (one call per seat). */
  estimateBatchUsd(seats: readonly CouncilSeat[], maxTokensPerCall: number): number {
    return seats.reduce((sum, s) => sum + this.perCall(s.costPer1M, maxTokensPerCall), 0);
  }

  estimateSynthesisUsd(synthesisTokens: number): number {
    return this.perCall(SpendMeter.SYNTHESIS_PRICE_PER_1M, synthesisTokens);
  }

  estimatePassUsd(seats: readonly CouncilSeat[], rounds: number, maxTokensPerCall: number, synthesisTokens: number): number {
    return this.estimateBatchUsd(seats, maxTokensPerCall) * rounds + this.estimateSynthesisUsd(synthesisTokens);
  }

  /** Whole-pass PROJECTION check — the first line of defense, run once before anything dispatches. */
  guardPass(seats: readonly CouncilSeat[], rounds: number, maxTokensPerCall: number, synthesisTokens: number): number {
    const est = this.estimatePassUsd(seats, rounds, maxTokensPerCall, synthesisTokens);
    if (est > this.limits.perPassUsd) {
      throw new SpendCeilingExceeded(`estimated pass $${est.toFixed(2)} > per-pass ceiling $${this.limits.perPassUsd.toFixed(2)}`);
    }
    if (this.dayToDateUsd + est > this.limits.perDayUsd) {
      throw new SpendCeilingExceeded(`day-to-date $${this.dayToDateUsd.toFixed(2)} + pass $${est.toFixed(2)} > day ceiling $${this.limits.perDayUsd.toFixed(2)}`);
    }
    return est;
  }

  private reservedUsd = 0;    // worst-case cost RESERVED but not yet reconciled to actual

  /** Reset the per-pass accumulators. Call once at the start of a pass, after guardPass. */
  beginPass(): void { this.passSpentUsd = 0; this.reservedUsd = 0; }

  /** Committed = actual spent + outstanding reservations. Ceiling checks use this so a reserved-but-not-
   *  yet-billed batch still counts against the cap (blocker 3: reserve worst-case BEFORE dispatch). */
  get committedUsd(): number { return this.passSpentUsd + this.reservedUsd; }

  /** RESERVE worst-case cost before a batch/synthesis dispatch (blocker 3 + C2). Fail-closed: throws if
   *  the reservation would breach the per-pass or per-day ceiling, BEFORE any paid call goes out. */
  reserve(estUsd: number): number {
    if (this.committedUsd + estUsd > this.limits.perPassUsd) {
      throw new SpendCeilingExceeded(`committed $${this.committedUsd.toFixed(2)} + reserve $${estUsd.toFixed(2)} > per-pass ceiling $${this.limits.perPassUsd.toFixed(2)}`);
    }
    if (this.dayToDateUsd + this.reservedUsd + estUsd > this.limits.perDayUsd) {
      throw new SpendCeilingExceeded(`day-to-date $${this.dayToDateUsd.toFixed(2)} + reserved $${(this.reservedUsd + estUsd).toFixed(2)} > day ceiling $${this.limits.perDayUsd.toFixed(2)}`);
    }
    this.reservedUsd += estUsd;
    return estUsd;
  }

  /** RECONCILE a reservation to ACTUAL cost after the response (release the reservation, book the real
   *  spend to both the pass and the persistent day total). Actual comes from provider cost when available. */
  reconcile(reservedEstUsd: number, actualUsd: number): void {
    this.reservedUsd = Math.max(0, this.reservedUsd - reservedEstUsd);
    this.passSpentUsd += actualUsd;
    this.dayToDateUsd += actualUsd;
  }

  get passTotalUsd(): number { return this.passSpentUsd; }
  get dayTotalUsd(): number { return this.dayToDateUsd; }
}

// ── Prompts ───────────────────────────────────────────────────────────────────────────────────
const GLYPH_LINE =
  'STANCE:(⊕|⊖|⊙|⊘|⊚) CONFIDENCE:(⇈|↑|→|↓|⇊) STRATEGY:(↗|↘|↙|↖|⇄) ' +
  'FRAMEWORK:(geometric|symbolic|statistical|narrative|embodied|social) ' +
  'DIST:(explore=X,exploit=Y,verify=Z,abstain=W)';

function basisBlock(basis: ClaimBasis): string {
  return basis.claims.map((c) => `  ${c.id}: ${c.text}`).join('\n');
}

export function round1Prompt(seat: CouncilSeat, problem: string, basis: ClaimBasis): string {
  return [
    `You are ${seat.name} on the Aukora Fu council. Reasoning style: ${seat.framework}.`,
    `<problem>\n${problem}\n</problem>`,
    `Shared claim basis (frozen, digest ${basis.digest.slice(0, 12)}):`,
    basisBlock(basis),
    `You may think first, but your packet MUST be a single block delimited EXACTLY by these tags,`,
    `appearing ONCE, containing exactly one glyph line, one CLAIMS line, and one HYP:`,
    PACKET_OPEN,
    GLYPH_LINE,
    `CLAIMS:(C1=<signed −1..1>,C2=<...>)   // only claim ids from the basis above`,
    `HYP:"one sentence"`,
    PACKET_CLOSE,
  ].join('\n');
}

export function round2Prompt(seat: CouncilSeat, problem: string, basis: ClaimBasis, priorVotes: SeatResult[]): string {
  const priors = priorVotes
    .filter((v) => v.packet)
    .map((v) => {
      const p = v.packet!;
      const cv = v.claimVector ? ` CLAIMS(${Object.entries(v.claimVector).map(([k, x]) => `${k}=${x}`).join(',')})` : '';
      return `  ${v.seatId}: ${p.stance}${p.confidence}${p.strategy} ${p.framework ?? ''}${cv} | "${p.hypothesis}"`;
    })
    .join('\n');
  return [
    round1Prompt(seat, problem, basis),
    ``,
    `PRIOR PACKETS (all valid round-1 seats — revise your VECTOR, do not re-argue in prose):`,
    priors,
  ].join('\n');
}

export function synthesisPrompt(problem: string, basis: ClaimBasis, votes: SeatResult[], geo: PhaseLockAssessment): string {
  const packets = votes
    .filter((v) => v.packet)
    .map((v) => {
      const p = v.packet!;
      const cv = v.claimVector ? ` CLAIMS(${Object.entries(v.claimVector).map(([k, x]) => `${k}=${x}`).join(',')})` : '';
      return `  ${v.seatId}: ${p.stance}${p.confidence}${p.strategy}${cv} | "${p.hypothesis}"`;
    })
    .join('\n');
  return [
    `You are the Aukora Fu SYNTHESIS seat. Your input is the geometric state of the deliberation;`,
    `your output is the ONE final answer. Do not add new claims beyond the frozen basis.`,
    `<problem>\n${problem}\n</problem>`,
    `Frozen claim basis (digest ${basis.digest.slice(0, 12)}):`,
    basisBlock(basis),
    `Deliberation geometry: coherence=${geo.coherence.toFixed(2)} shear=${geo.shearMagnitude.toFixed(2)} ` +
      `phaseLock=${geo.phaseLockDetected} evidenceAnchor=${geo.hasEvidenceAnchor} reason=${geo.reason}`,
    `Round-2 packets:`,
    packets,
    `Render the single best answer in plain English. If the geometry says ` +
      `"suspect-matched-prior-consensus", say so and hedge accordingly.`,
    `On the FINAL line, list ONLY the basis claim ids your answer relied on, exactly as:`,
    `USED_CLAIMS:(C1,C2)   // only ids from the basis above; an unknown id voids the synthesis`,
  ].join('\n');
}

/** Parse the synthesis `USED_CLAIMS:(C1,C2)` line. Returns the ids, or null if any id is not in the basis
 *  (blocker 5: synthesis must declare the claims it used, and an unknown id voids the English output). */
export function parseUsedClaims(text: string, basis: ClaimBasis): string[] | null {
  const ids = new Set(basis.claims.map((c) => c.id));
  const m = /USED_CLAIMS:\(([^)]*)\)/i.exec(text);
  if (!m) return null;                                       // synthesis must declare its claims
  const used = m[1].split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  for (const id of used) if (!ids.has(id)) return null;      // unknown id → void the synthesis
  return used;
}

/** FIXED controller repair prompt — the ONE bounded format-only repair (Codex ruling, 2026-07-12): used
 *  ONLY for `nonvote_empty` or `dist_sum_mismatch`, never for substitution/missing-identity/timeout/
 *  truncation/other. Same frozen basis and strict parser; it does NOT normalize the model's distribution
 *  in the parser (that would change what the seat said) — one chance to re-emit correctly. */
export function formatRepairPrompt(seat: CouncilSeat, problem: string, basis: ClaimBasis): string {
  return [
    `FORMAT REPAIR (one attempt only). Your previous reply was empty or its DIST did not sum to 1.0.`,
    `Re-emit ONLY the tagged packet — nothing outside the tags. The four DIST numbers MUST sum to 1.0,`,
    `and CLAIMS must use ONLY claim ids from the basis.`,
    ``,
    round1Prompt(seat, problem, basis),
  ].join('\n');
}

/** A non-vote is eligible for the single format-repair ONLY if it was empty or a DIST-sum mismatch.
 *  A truncated reply is NOT repairable — no parser loosening or second chance after a cut reply. */
export function isRepairable(r: SeatResult): boolean {
  return r.status === 'nonvote_empty' || (r.status === 'nonvote_malformed' && r.reason === 'dist_sum_mismatch');
}

// ── The one entrypoint (§5) ───────────────────────────────────────────────────────────────────
export interface CouncilInput { problem: string; claims: readonly string[]; }

/** The quorum rule actually applied to a pass — explicit and carried in the outcome so no surface can
 *  claim a stricter (or looser) gate than the one that ran. The default reproduces PR #352's blocker-4
 *  rule exactly; the chat lane substitutes a majority-of-requested-roster rule for env-narrowed rosters. */
export interface QuorumRule {
  minVotes: number;                 // minimum valid round-2 packets
  minFamilies: number;              // minimum DISTINCT lineages among those packets
  requireSeatId: string | null;     // a seat that must itself have a verified vote (null = none)
}
export const DEFAULT_QUORUM_RULE: QuorumRule = { minVotes: 6, minFamilies: 6, requireSeatId: 'FBL' };

export interface CouncilOpts {
  seats?: readonly CouncilSeat[];
  spend?: SpendMeter;
  calibration?: Record<string, number>;   // per-seat track-record multiplier (H7); default 1.0
  synthesisSeatId?: string;                 // default Fable
  maxTokensPerCall?: number;
  perSeatDeadlineMs?: number;
  quorum?: QuorumRule;                      // default DEFAULT_QUORUM_RULE (≥6 + ≥6 families + Fable)
  now?: number;
}
export interface CouncilOutcome {
  schema: 'aukora-fu-council-v1';
  problem: string;
  basis: ClaimBasis;
  round1: SeatResult[];
  round2: SeatResult[];
  votes: SeatResult[];               // round-2 voting seats
  nonVotes: SeatResult[];
  weights: Record<string, number>;   // lineage × calibration
  geometry: PhaseLockAssessment;
  neutralReplay: ReturnType<typeof neutralReplayDrift>;
  fableVerified: boolean;            // did the FBL seat produce a valid, identity-verified round-2 packet
  votingFamilies: number;           // distinct lineages among round-2 voters
  quorumRule: QuorumRule;           // the rule that was actually applied
  quorumMet: boolean;               // blocker 4 gate, under quorumRule
  answer: string;                   // synthesis, fallback HYP, or an insufficient-quorum diagnostic
  answerSource: 'synthesis' | 'fallback-top-hyp' | 'insufficient-quorum';
  synthUsedClaims?: string[];       // the basis claim ids the synthesis declared it used (blocker 5)
  verdict: 'consensus' | 'consensus-suspect' | 'divergence' | 'insufficient-quorum';
  estimatedUsd: number;
  actualUsd: number;
  advisory: true;
  grantsAuthority: false;
}

/** Minimum valid round-2 packets from DISTINCT families (plus a verified Fable seat) before the council
 *  may claim an authoritative verdict (blocker 4) under the DEFAULT rule. Below → `insufficient-quorum`. */
export const QUORUM_MIN = 6;

/** Race the seat call against its deadline; on deadline ABORT the underlying request so a timed-out PAID
 *  call is cancelled rather than left billing, and reject with DeadlineError (blocker 2). */
async function callSeat(
  transport: Transport, seat: CouncilSeat, prompt: string, phase: 'round1' | 'round2' | 'synthesis', ms: number,
): Promise<SeatResponse> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => { controller.abort(); rej(new DeadlineError('seat deadline exceeded')); }, ms);
  });
  try {
    return await Promise.race([transport(seat, prompt, phase, controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Run one advisory Aukora Fu pass: two rounds, parallel all-settled fan-out with real per-call
 *  cancellation, geometry, quorum gate, and English-last synthesis. Pure except for the injected
 *  transport. Never writes anything, never grants authority. */
export async function runAukoraFuCouncil(input: CouncilInput, transport: Transport, opts: CouncilOpts = {}): Promise<CouncilOutcome> {
  const seats = opts.seats ?? CANONICAL_SEATS;
  const now = opts.now ?? Date.now();
  const maxTokens = opts.maxTokensPerCall ?? 700;
  const deadline = opts.perSeatDeadlineMs ?? 60_000;
  const spend = opts.spend ?? new SpendMeter();
  const calibration = opts.calibration ?? {};
  const quorumRule = opts.quorum ?? DEFAULT_QUORUM_RULE;

  // H8: freeze + digest the claim basis BEFORE any call.
  const basis = freezeClaimBasis(input.problem, input.claims, now);

  // Spend fail-closed: whole-pass projection first (budgeting round1 + round2 + one repair batch), then
  // reserve worst-case / reconcile actual per phase. Repairs beyond the projection still fail closed at reserve().
  const estimatedUsd = spend.guardPass(seats, 3, maxTokens, maxTokens);
  spend.beginPass();
  const familyOf = new Map(seats.map((s) => [s.id, s.family] as const));
  const priceOf = new Map(seats.map((s) => [s.id, s.costPer1M] as const));
  const actualCost = (seatId: string, resp: SeatResponse | undefined): number =>
    resp?.costUsd ?? (resp?.outputTokens ? (Math.max(priceOf.get(seatId) ?? 0, 0) / 1_000_000) * resp.outputTokens : 0);

  // Dispatch one batch of seats: reserve worst-case, call in parallel (each abortable), reconcile ACTUAL.
  const dispatchBatch = async (batch: readonly CouncilSeat[], phase: 'round1' | 'round2', promptFor: (s: CouncilSeat) => string): Promise<SeatResult[]> => {
    const reserved = spend.reserve(spend.estimateBatchUsd(batch, maxTokens)); // C2 + blocker 3 (throws if it would breach)
    let actual = 0;
    try {
      const settled = await Promise.allSettled(batch.map((s) => callSeat(transport, s, promptFor(s), phase, deadline)));
      return batch.map((s, i) => {
        const r = settled[i];
        if (r.status === 'rejected') {
          const timedOut = r.reason instanceof DeadlineError;
          return { seatId: s.id, slug: s.slug, requestedSlug: s.slug, status: (timedOut ? 'nonvote_timeout' : 'nonvote_error') as SeatStatus, reason: String(r.reason?.message ?? r.reason) };
        }
        actual += actualCost(s.id, r.value);
        return classifySeatResult(s, r.value, basis);
      });
    } finally {
      spend.reconcile(reserved, actual);
    }
  };

  // H1/H2: bounded parallel fan-out, then ONE format-repair attempt per seat for empty/dist-sum only.
  const fanOut = async (phase: 'round1' | 'round2', prompt: (s: CouncilSeat) => string): Promise<SeatResult[]> => {
    const results = await dispatchBatch(seats, phase, prompt);
    const toRepair = seats.filter((_, i) => isRepairable(results[i]!));
    if (toRepair.length === 0) return results;
    let repaired: SeatResult[];
    try { repaired = await dispatchBatch(toRepair, phase, (s) => formatRepairPrompt(s, input.problem, basis)); }
    catch { return results; } // repair reservation would breach the ceiling → keep the original non-votes (fail-closed)
    repaired.forEach((re, j) => {
      const idx = seats.findIndex((s) => s.id === toRepair[j]!.id);
      if (idx < 0) return;
      if (re.status === 'voted') results[idx] = { ...re, repaired: true };           // one successful repair → counts
      else results[idx] = { ...results[idx]!, reason: `${results[idx]!.reason} · repair-failed:${re.status}` };
    });
    return results;
  };

  const round1 = await fanOut('round1', (s) => round1Prompt(s, input.problem, basis));
  const round1Votes = round1.filter(isVote);

  // H1/H2 + complete carry: round 2 — every valid round-1 packet reaches every seat.
  const round2 = await fanOut('round2', (s) => round2Prompt(s, input.problem, basis, round1Votes));
  const votes = round2.filter(isVote);
  const nonVotes = round2.filter((r) => !isVote(r));

  // H5 × H7: lineage cap × calibration multiplier.
  const lineage = lineageWeights(votes, seats);
  const weights: Record<string, number> = {};
  for (const v of votes) weights[v.seatId] = (lineage.get(v.seatId) ?? 1) * (calibration[v.seatId] ?? 1);

  // H6: evidence-aware phase-lock; H8: neutral replay.
  const geometry = assessPhaseLock(votes, basis);
  const replay = neutralReplayDrift(votes);

  // Blocker 4: quorum before an authoritative verdict, under the EXPLICIT rule. `voted` already implies
  // the served model matched (classifySeatResult). fableVerified is always reported regardless of rule.
  const votingFamilies = new Set(votes.map((v) => familyOf.get(v.seatId))).size;
  const fableResult = round2.find((r) => r.seatId === 'FBL');
  const fableVerified = !!fableResult && isVote(fableResult);
  const requiredSeatOk = quorumRule.requireSeatId === null
    ? true
    : round2.some((r) => r.seatId === quorumRule.requireSeatId && isVote(r));
  const quorumMet = votes.length >= quorumRule.minVotes && votingFamilies >= quorumRule.minFamilies && requiredSeatOk;

  let answer: string;
  let answerSource: CouncilOutcome['answerSource'];
  let synthUsedClaims: string[] | undefined;
  let verdict: CouncilOutcome['verdict'];

  if (!quorumMet) {
    // No authoritative-sounding synthesis below quorum — a plain diagnostic instead (blocker 4).
    answer = `insufficient quorum: ${votes.length}/${seats.length} valid packets from ${votingFamilies} families`
      + `${quorumRule.requireSeatId ? `, required seat ${quorumRule.requireSeatId} verified=${requiredSeatOk}` : ''}`
      + ` (rule: ≥${quorumRule.minVotes} votes from ≥${quorumRule.minFamilies} families${quorumRule.requireSeatId ? ` + verified ${quorumRule.requireSeatId}` : ''}).`;
    answerSource = 'insufficient-quorum';
    verdict = 'insufficient-quorum';
  } else {
    // H3: English-last synthesis (one render). Fallback = top-weighted seat's own HYP.
    answerSource = 'fallback-top-hyp';
    answer = '';
    const synthSeat = seats.find((s) => s.id === (opts.synthesisSeatId ?? 'FBL')) ?? seats[0];
    try {
      const reserved = spend.reserve(spend.estimateSynthesisUsd(maxTokens));
      let actual = 0;
      try {
        const resp = await callSeat(transport, synthSeat, synthesisPrompt(input.problem, basis, votes, geometry), 'synthesis', deadline);
        actual = actualCost(synthSeat.id, resp);
        const used = resp?.text ? parseUsedClaims(resp.text, basis) : null; // blocker 5: unknown/missing ids void synthesis
        // Fail-closed on missing served identity here too (consistent with classifySeatResult).
        if (resp?.text?.trim() && !!resp.served && servedMatches(synthSeat.slug, resp.served) && verifyClaimBasis(basis, input.problem) && used !== null) {
          answer = resp.text.trim();
          answerSource = 'synthesis';
          synthUsedClaims = used;
        }
      } finally {
        spend.reconcile(reserved, actual);
      }
    } catch { /* synthesis failed or would breach budget → fallback below (fail-closed, no overspend) */ }
    if (answerSource === 'fallback-top-hyp') {
      const top = votes
        .map((v) => ({ v, score: (weights[v.seatId] ?? 1) * confidenceToNumber(v.packet!.confidence) }))
        .sort((a, b) => b.score - a.score)[0];
      answer = top ? top.v.packet!.hypothesis : '(no answer)';
    }
    verdict = geometry.suspect ? 'consensus-suspect'
      : geometry.reason === 'genuine-consensus-with-evidence' ? 'consensus'
        : 'divergence';
  }

  return {
    schema: 'aukora-fu-council-v1',
    problem: input.problem, basis, round1, round2, votes, nonVotes,
    weights, geometry, neutralReplay: replay,
    fableVerified, votingFamilies, quorumRule, quorumMet,
    answer, answerSource, synthUsedClaims, verdict,
    estimatedUsd, actualUsd: spend.passTotalUsd,
    advisory: true, grantsAuthority: false,
  };
}

/** Advisory pin: the council can never confer authority (mirrors the engine's own no-authority pins). */
export function councilGrantsAuthority(_o: CouncilOutcome): false { return false; }
