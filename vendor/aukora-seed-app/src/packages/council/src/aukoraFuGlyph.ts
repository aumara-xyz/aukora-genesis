// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Pure glyph vocabulary, parsing, interference geometry, and perception primitives extracted from
 * Aukora Fu v8.0.0 for the canonical hardened council. This module performs no network, filesystem,
 * environment, credential, capture, authority, or repository operation.
 */
const PHI = 1.618033988749894;
const SHEAR_FLOOR = 1 / PHI;

// ═══════════════════════════════════════════════════════════════════════════════
// GLYPH VOCABULARY
// ═══════════════════════════════════════════════════════════════════════════════

export type StanceGlyph = "⊕" | "⊖" | "⊙" | "⊘" | "⊚";
export type ConfidenceGlyph = "⇈" | "↑" | "→" | "↓" | "⇊";
export type StrategyGlyph = "↗" | "↘" | "↙" | "↖" | "⇄";
export type ChannelGlyph = "⎋" | "⏵" | "⏸" | "↻";
export type OutcomeGlyph = "✓" | "✗" | "⏳" | "⚡";
export type FrameworkType = "geometric" | "symbolic" | "statistical" | "narrative" | "embodied" | "social";

export interface GlyphPacket {
  modelId: string;
  stance: StanceGlyph;
  confidence: ConfidenceGlyph;
  strategy: StrategyGlyph;
  distribution: {
    explore: number;
    exploit: number;
    verify: number;
    abstain: number;
  };
  framework?: FrameworkType;  // which reasoning style produced this
  hypothesis: string;
  reasoning: string;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTRADICTION — the ~ operator's first-class output
// ═══════════════════════════════════════════════════════════════════════════════

export interface Contradiction {
  id: string;
  modelA: string;
  modelB: string;
  shearMagnitude: number;       // 0 = resolved, 1 = maximal shear
  interferenceVector: number[];  // where and how they diverge
  phaseLockStatus: "open" | "decaying" | "stabilized";
  decayOrigin: number;           // timestamp — refreshed on query
  frameworkTypes: [FrameworkType | undefined, FrameworkType | undefined];
  queryCount: number;
}

/** The ~ operator: interference between two frameworks.
 *  Not AND. Not OR. INTERFERENCE. The contradiction IS the information. */
export function tilde(A: GlyphPacket, B: GlyphPacket): Contradiction {
  const dA = normalizeDist(A.distribution);
  const dB = normalizeDist(B.distribution);
  const iv = [
    dA.explore - dB.explore,
    dA.exploit - dB.exploit,
    dA.verify - dB.verify,
    dA.abstain - dB.abstain,
  ];
  const shearMag = clamp(1 - cosineSimilarity(Object.values(dA), Object.values(dB)), SHEAR_FLOOR, 1.0);
  return {
    id: `~${A.modelId}_${B.modelId}_${Date.now()}`,
    modelA: A.modelId,
    modelB: B.modelId,
    shearMagnitude: shearMag,
    interferenceVector: iv,
    phaseLockStatus: "open",
    decayOrigin: Date.now(),
    frameworkTypes: [A.framework, B.framework],
    queryCount: 0,
  };
}

/** φ-governed decay: contradictions lose salience but never vanish.
 *  shear → SHEAR_FLOOR as t → ∞. The gap is permanent. */
export function decayShear(c: Contradiction, now: number = Date.now()): number {
  const dt = now - c.decayOrigin;
  const tau = 1000 * 60 * 60 * 24; // 24 hour decay constant
  if (dt < 1000 * 60 * 10) return c.shearMagnitude; // active within 10 min
  const decayFactor = Math.exp(-dt / (tau * PHI));
  return SHEAR_FLOOR + (c.shearMagnitude - SHEAR_FLOOR) * decayFactor;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GLYPH CHANNEL — shared buffer with contradiction tracking
// ═══════════════════════════════════════════════════════════════════════════════

export class GlyphChannel {
  private packets: GlyphPacket[] = [];
  private directives: ChannelGlyph[] = [];
  private contradictions: Contradiction[] = [];

  emit(packet: GlyphPacket) {
    // Auto-~ with all prior packets from different models
    for (const prior of this.packets) {
      if (prior.modelId !== packet.modelId) {
        this.contradictions.push(tilde(prior, packet));
      }
    }
    this.packets.push(packet);
  }
  directive(g: ChannelGlyph) { this.directives.push(g); }
  from(modelId: string): GlyphPacket[] { return this.packets.filter(p => p.modelId === modelId); }
  latest(): Map<string, GlyphPacket> {
    const map = new Map<string, GlyphPacket>();
    for (const p of this.packets) map.set(p.modelId, p);
    return map;
  }
  all(): GlyphPacket[] { return [...this.packets]; }
  clear() { this.packets = []; this.directives = []; this.contradictions = []; }
  stagnationDetected(): boolean { return this.directives.includes("⎋"); }
  toDistributions() { return this.packets.map(p => p.distribution); }

  /** Get all contradictions tracked by the ~ operator */
  getContradictions(): Contradiction[] { return this.contradictions; }

  /** Find the most productive contradiction (highest shear, still open) */
  strongestContradiction(): Contradiction | undefined {
    return this.contradictions
      .filter(c => c.phaseLockStatus === "open")
      .sort((a, b) => b.shearMagnitude - a.shearMagnitude)[0];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GLYPH PERCEIVER — KL divergence + shear magnitude + phase-lock detection
// ═══════════════════════════════════════════════════════════════════════════════

export interface PerceiverVerdict {
  coherenceScore: number;
  pinch: number;
  shearMagnitude: number;
  phaseLocked: boolean;     // true if all models converged dangerously
  verdict: "GREEN" | "YELLOW" | "RED";
  divergenceMatrix: number[][];
  modelStances: Array<{ modelId: string; stance: StanceGlyph; confidence: number; framework?: FrameworkType }>;
  recommendedAction: StrategyGlyph | "⎋";
  contradictions: Contradiction[];
}

const EPS = 1e-9;
const QUARANTINE_PINCH = 1e6;

function conflictThreshold(n: number): number {
  return n <= 1 ? 1.0 : 1.0 / Math.sqrt(n - 1) * 1.414;
}

function smoothDist(d: GlyphPacket["distribution"]) {
  const sum = d.explore + d.exploit + d.verify + d.abstain;
  if (sum <= 0) return { explore: 0.25, exploit: 0.25, verify: 0.25, abstain: 0.25 };
  return {
    explore: (d.explore + EPS) / (sum + 4 * EPS),
    exploit: (d.exploit + EPS) / (sum + 4 * EPS),
    verify: (d.verify + EPS) / (sum + 4 * EPS),
    abstain: (d.abstain + EPS) / (sum + 4 * EPS),
  };
}

function klDiv(p: ReturnType<typeof smoothDist>, q: ReturnType<typeof smoothDist>): number {
  let kl = 0;
  for (const key of ["explore", "exploit", "verify", "abstain"] as const) {
    kl += p[key] * Math.log(p[key] / q[key]);
  }
  return Math.max(0, kl);
}

// Bug found and fixed while landing this module (2026-07-01): the source export's threshold here was
// a hardcoded 0.15, but tilde()'s shear is clamp()ed to a floor of SHEAR_FLOOR (~0.618) — so
// maxShear < 0.15 could NEVER be true, meaning this detector was silently dead code (always returned
// false) in every version of the source zip. Fixed to a threshold relative to the actual floor: "close
// to the floor" (near-total agreement) rather than an absolute value the floor makes unreachable.
const PHASE_LOCK_NEAR_FLOOR_MARGIN = 0.05;

/** Phase-lock detection: if all models agree too perfectly, that's suspicious.
 *  Returns true if max pairwise shear is near the shear floor (all frameworks collapsed). */
function detectPhaseLock(contradictions: Contradiction[]): boolean {
  if (contradictions.length === 0) return false;
  const maxShear = Math.max(...contradictions.map(c => c.shearMagnitude));
  return maxShear < SHEAR_FLOOR + PHASE_LOCK_NEAR_FLOOR_MARGIN; // near-total agreement = groupthink
}

export function perceive(channel: GlyphChannel): PerceiverVerdict {
  const dists = channel.toDistributions();
  const contradictions = channel.getContradictions();

  if (dists.length === 0) {
    return {
      coherenceScore: 0, pinch: QUARANTINE_PINCH,
      shearMagnitude: 0, phaseLocked: false,
      verdict: "RED", divergenceMatrix: [], modelStances: [],
      recommendedAction: "⎋", contradictions: [],
    };
  }

  const n = dists.length;
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  let totalDiv = 0, pairs = 0;

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const kl = klDiv(smoothDist(dists[i]), smoothDist(dists[j]));
      matrix[i][j] = kl;
      totalDiv += kl; pairs++;
    }
  }

  const avgDiv = pairs > 0 ? totalDiv / pairs : 0;
  const pinch = avgDiv * 10;
  const coherenceScore = Math.exp(-avgDiv);
  const shearMagnitude = contradictions.length > 0
    ? contradictions.reduce((s, c) => s + c.shearMagnitude, 0) / contradictions.length
    : 0;
  const phaseLocked = detectPhaseLock(contradictions);

  const ct = conflictThreshold(n);
  let verdict: "GREEN" | "YELLOW" | "RED";
  if (pinch >= ct) verdict = "RED";
  else if (pinch >= ct * 0.4) verdict = "YELLOW";
  else verdict = "GREEN";

  // Phase-lock is also dangerous (too much agreement = groupthink)
  if (phaseLocked && verdict === "GREEN") verdict = "YELLOW";

  const latest = channel.latest();
  const modelStances = Array.from(latest.entries()).map(([id, p]) => ({
    modelId: id, stance: p.stance,
    confidence: confidenceToNumber(p.confidence),
    framework: p.framework,
  }));

  const packets = channel.all();
  const strategyWeights: Record<string, number> = {};
  for (const p of packets) {
    const w = confidenceToNumber(p.confidence) * (p.stance === "⊖" && coherenceScore > 0.85 ? 2.0 : 1.0);
    strategyWeights[p.strategy] = (strategyWeights[p.strategy] || 0) + w;
  }
  const recAction = (Object.entries(strategyWeights).sort((a, b) => b[1] - a[1])[0]?.[0] || "↗") as StrategyGlyph | "⎋";

  return {
    coherenceScore, pinch, shearMagnitude, phaseLocked, verdict,
    divergenceMatrix: matrix, modelStances,
    recommendedAction: recAction, contradictions,
  };
}

// Exported (unlike the rest of this file's private helpers) so selfEditReviewCouncil.ts's
// GlyphPacket -> AdvisoryResult adapter can reuse this exact mapping rather than redefining it.
export function confidenceToNumber(c: ConfidenceGlyph): number {
  const map: Record<ConfidenceGlyph, number> = { "⇈": 0.95, "↑": 0.80, "→": 0.60, "↓": 0.40, "⇊": 0.20 };
  return map[c] || 0.5;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GLYPH EMITTER
// ═══════════════════════════════════════════════════════════════════════════════

export interface SecurityIncident {
  type: "malformed_glyph" | "dist_sum_mismatch" | "model_timeout" | "phase_lock_detected";
  modelId: string;
  raw?: string;
  timestamp: number;
  action: "quarantined" | "abstained" | "boosted_contrarian";
}

export function parseGlyphResponse(text: string, modelId: string): { packet: GlyphPacket; incident?: SecurityIncident } {
  const fallback: GlyphPacket = {
    modelId, stance: "⊚", confidence: "↓", strategy: "↙",
    distribution: { explore: 0.1, exploit: 0.1, verify: 0.4, abstain: 0.4 },
    framework: undefined, hypothesis: "Parse failed — abstaining",
    reasoning: "", timestamp: Date.now(),
  };

  const stanceMatch = text.match(/STANCE:([⊕⊖⊙⊘⊚])/);
  const confMatch = text.match(/CONFIDENCE:([⇈↑→↓⇊])/);
  const stratMatch = text.match(/STRATEGY:([↗↘↙↖⇄])/);
  const frameMatch = text.match(/FRAMEWORK:(geometric|symbolic|statistical|narrative|embodied|social)/);
  // Round 2 (issue #22): the prompt's own instructions and examples (below, ~line 340) tell every
  // model to answer with `DIST:(explore=X,exploit=Y,verify=Z,abstain=W)` — parentheses included. This
  // regex required NO parentheses, so any model that correctly followed the prompt's own format could
  // never parse — discovered via a real live council run (2 of 5 real replies were well-formed glyph
  // lines with parenthesized DIST and were still marked malformed_glyph). `\(?...\)?` tolerates either.
  //
  // Round 6 (issue #34): a SECOND real live council run found a real DeepSeek reply
  // (`DIST:(exploit=0.10,verify=0.70,explore=0.10,abstain=0.10)`) with all four required values,
  // correctly labeled, correctly summing to 1.0 — just in a different order than the prompt's own
  // example. A fixed-order regex rejected it as malformed even though a reasonable reader would call it
  // fully compliant. Extract the DIST block, then find each of the four required keys BY NAME within it,
  // in any order — still fail-closed: all four must be present with a numeric value, exactly as strict
  // as before for a genuinely incomplete/garbled DIST block (a missing key, or none of this text present
  // at all, still falls through to malformed_glyph below).
  const distBlock = text.match(/DIST:\s*\(?([^)\n]*)\)?/)?.[1] ?? '';
  const distExplore = distBlock.match(/explore=([\d.]+)/);
  const distExploit = distBlock.match(/exploit=([\d.]+)/);
  const distVerify = distBlock.match(/verify=([\d.]+)/);
  const distAbstain = distBlock.match(/abstain=([\d.]+)/);
  const distMatch = (distExplore && distExploit && distVerify && distAbstain)
    ? { explore: distExplore[1], exploit: distExploit[1], verify: distVerify[1], abstain: distAbstain[1] }
    : null;
  const hypMatch = text.match(/HYP:\s*"([^"]*)"/);

  if (!stanceMatch || !confMatch || !stratMatch || !distMatch) {
    return {
      packet: fallback,
      incident: { type: "malformed_glyph", modelId, raw: text.slice(0, 200), timestamp: Date.now(), action: "quarantined" },
    };
  }

  const distSum = parseFloat(distMatch.explore) + parseFloat(distMatch.exploit) + parseFloat(distMatch.verify) + parseFloat(distMatch.abstain);
  if (Math.abs(distSum - 1.0) > 0.2) {
    return {
      packet: fallback,
      incident: { type: "dist_sum_mismatch", modelId, raw: `sum=${distSum.toFixed(2)}`, timestamp: Date.now(), action: "quarantined" },
    };
  }

  return {
    packet: {
      modelId,
      stance: stanceMatch[1] as StanceGlyph,
      confidence: confMatch[1] as ConfidenceGlyph,
      strategy: stratMatch[1] as StrategyGlyph,
      framework: frameMatch?.[1] as FrameworkType | undefined,
      distribution: {
        explore: parseFloat(distMatch.explore) / distSum,
        exploit: parseFloat(distMatch.exploit) / distSum,
        verify: parseFloat(distMatch.verify) / distSum,
        abstain: parseFloat(distMatch.abstain) / distSum,
      },
      hypothesis: hypMatch?.[1] || "No hypothesis stated",
      reasoning: "", timestamp: Date.now(),
    },
  };
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + EPS);
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function normalizeDist(d: GlyphPacket["distribution"]) {
  const sum = d.explore + d.exploit + d.verify + d.abstain;
  if (sum <= 0) return { explore: 0.25, exploit: 0.25, verify: 0.25, abstain: 0.25 };
  return { explore: d.explore / sum, exploit: d.exploit / sum, verify: d.verify / sum, abstain: d.abstain / sum };
}
