// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/**
 * Conversation Distiller — the PURE, testable core of Auma's conversation lane.
 *
 * It turns a chat transcript into advisory SUMMARY atoms. It is deliberately UNWIRED: no capture, no write
 * path, no Convex, no model call. It grants NO authority and applies NOTHING. Fable wires its output into the
 * governed memoryAppend path (the LIVE Convex brain) in a LATER, ratified step — this file must stay a pure
 * function so that wiring can be reviewed in isolation. Every result and every atom carries advisoryOnly:true
 * and grantsAuthority:false, matching the invariant mirrored across core/src (kiraBrain, governedWorkOrder).
 *
 * Four laws are load-bearing (Auma's + Codex's invariants), each with a test:
 *   1. HEDGE-PRESERVATION — distillation may never launder uncertainty. A hedged source ("maybe", "I think",
 *      "not sure", "seems"…) MUST yield a summary that still reads as hedged. A drifted mind that hardens its
 *      own guesses into bare assertions is exactly what this law prevents; so if truncation/collapse would
 *      strip the last hedge, we re-mark it rather than emit a false certainty.
 *   2. NO RAW TRANSCRIPTS — output is SUMMARY only: whitespace collapsed, capped at MAX_SUMMARY (=kiraBrain's
 *      MAX_QUOTE), a marker appended when the source was longer than the cap so a truncated turn is never
 *      passed off as the whole thing.
 *   3. FORBIDDEN-CONTENT HARD FAIL — every candidate summary is scanned (scanForbiddenKeys/Values). A
 *      secret-shaped or forbidden token means that atom is REFUSED (fail-closed), never sanitized-and-kept:
 *      a distilled secret is worse than a raw one because it looks safe.
 *   4. SCOPE-AWARE RANKING — a pure, deterministic order of which turns become atoms: owner turns and
 *      decision-bearing turns rank above small talk. No model, no randomness — same input, same atoms.
 */
import { scanForbiddenKeys, scanForbiddenValues } from './forbiddenContent';
import { tokenize } from './kiraBrain';

export type ConversationRole = 'owner' | 'auma' | 'system';

export interface ConversationTurn {
  role: ConversationRole;
  text: string;
  at?: string;
}

export interface DistillOptions {
  /** Cap on how many atoms the result may carry (highest-ranked first). Default 12. */
  maxAtoms?: number;
  /** Minimum collapsed length for a turn to be summary-worthy — below this it is small talk. Default 12. */
  minChars?: number;
}

export interface DistilledAtom {
  /** The distilled SUMMARY line — collapsed, capped, hedge-preserving. Never a verbatim raw turn. */
  text: string;
  role: ConversationRole;
  at?: string;
  rank: number;
  /** True iff the source turn carried an epistemic hedge that this summary preserves (law 1). */
  hedged: boolean;
  /** True iff the source was longer than MAX_SUMMARY and was truncated (a marker is present in text). */
  truncated: boolean;
  advisoryOnly: true;
  grantsAuthority: false;
}

export type DistillResult =
  | { ok: true; atoms: DistilledAtom[]; advisoryOnly: true; grantsAuthority: false }
  | { ok: false; reason: string; advisoryOnly: true; grantsAuthority: false };

// = MAX_QUOTE (kiraBrain): a summary atom is capped exactly where a recall support-quote is, so the two
// surfaces never disagree about "how long is a summary". The truncation marker is inside this budget.
const MAX_SUMMARY = 280;
const MAX_TURNS = 5_000;        // a transcript that large is not a conversation — refuse rather than churn
const MAX_TURN_CHARS = 40_000;  // mirrors kiraBrain MAX_TEXT — bound the per-turn scan
const TRUNC_MARK = ' …';        // trailing marker: this summary is a truncation, not the whole turn
const HEDGE_MARK = '[hedged] '; // leading marker re-applied when collapse/truncation strips the last hedge

const VALID_ROLES: ReadonlySet<string> = new Set<ConversationRole>(['owner', 'auma', 'system']);

// Epistemic hedges (law 1). Kept as a word/phrase net over the LOWERCASED source; deliberately conservative —
// a false "this was hedged" only ever ADDS a hedge marker (safe direction), while a missed hedge would let a
// guess harden (the unsafe direction), so the net is broad and the failure mode is one-directional.
const HEDGE_RE =
  /\b(maybe|might|mightn't|perhaps|possibly|probably|i think|i believe|i guess|i suppose|not sure|unsure|uncertain|seems?|seemed|appears?|appeared|could be|may be|might be|i'?m not sure|not certain|i'?d guess|likely|unlikely|tentativ|presumabl|apparent|allegedl|reportedl|arguabl|conceivabl|it'?s possible|hard to say|my guess)\b/;

// Decision / commitment cues — a turn that decides, agrees, blocks or signs ranks above chit-chat (law 4).
const DECISION_RE =
  /\b(decide|decided|decision|let'?s|we will|we'?ll|i will|i'?ll|agree|agreed|approve|approved|reject|rejected|block|blocked|ship|shipped|sign|signed|ratif|commit|committed|plan|must|should|need to|will not|won'?t|do not|don'?t)\b/;

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Law 2: collapse + cap. If the collapsed source exceeds the cap it is truncated to fit WITH the marker
 *  inside the budget, so an atom is never both over-length and unmarked. Returns whether it was truncated. */
function summarize(collapsed: string): { text: string; truncated: boolean } {
  if (collapsed.length <= MAX_SUMMARY) return { text: collapsed, truncated: false };
  const room = MAX_SUMMARY - TRUNC_MARK.length;
  return { text: collapsed.slice(0, room).trimEnd() + TRUNC_MARK, truncated: true };
}

/** Law 1: never emit a hardened assertion for a hedged source. If the source was hedged but the produced
 *  summary no longer reads as hedged (collapse/truncation dropped the qualifier), re-apply a hedge marker —
 *  within the cap, so the marker can never push the atom back over-length. */
function preserveHedge(summary: string, sourceHedged: boolean): { text: string; hedged: boolean } {
  if (!sourceHedged) return { text: summary, hedged: false };
  if (HEDGE_RE.test(summary.toLowerCase())) return { text: summary, hedged: true };
  const marked = HEDGE_MARK + summary;
  // the marker must not itself break law 2 — if adding it overruns, trim the tail to make room.
  if (marked.length <= MAX_SUMMARY) return { text: marked, hedged: true };
  const room = MAX_SUMMARY - HEDGE_MARK.length - TRUNC_MARK.length;
  return { text: HEDGE_MARK + summary.slice(0, room).trimEnd() + TRUNC_MARK, hedged: true };
}

/** Law 3: a candidate summary is only admissible if it carries no secret-shaped / forbidden token. Scanned
 *  as both a KEY-bearing object and a VALUE — a distilled secret that "looks safe" is the worst case, so a
 *  hit REFUSES the atom (drop it) rather than trying to redact and keep it. */
function isForbidden(summary: string): boolean {
  return scanForbiddenKeys({ text: summary }).length > 0 || scanForbiddenValues({ text: summary }).length > 0;
}

/** Deterministic scope-aware weight (law 4). Pure integer arithmetic — same input, same order, no model. */
function rankOf(role: ConversationRole, collapsed: string, hedged: boolean): number {
  let r = 0;
  if (role === 'owner') r += 100;         // the owner's words are the highest-value signal to remember
  else if (role === 'auma') r += 40;      // Auma's own statements: kept, below the owner
  else r += 10;                           // system turns: lowest base
  if (DECISION_RE.test(collapsed.toLowerCase())) r += 50; // a decision/commitment outranks small talk
  if (hedged) r += 5;                     // a hedged statement is still worth keeping (its uncertainty matters)
  r += Math.min(20, Math.floor(collapsed.length / 40)); // longer (to a bound) ≈ more substance; capped so length can't dominate role
  return r;
}

/**
 * Distill a transcript into advisory summary atoms. Pure: no fs, no network, no side effects. Fails CLOSED —
 * a malformed transcript returns a typed refusal, and any single forbidden-shaped candidate is DROPPED (never
 * silently sanitized). An input with zero summary-worthy turns is a valid empty result, not an error.
 */
export function distillConversation(turns: ConversationTurn[], opts: DistillOptions = {}): DistillResult {
  const deny = (reason: string): DistillResult => ({ ok: false, reason, advisoryOnly: true, grantsAuthority: false });
  if (!Array.isArray(turns)) return deny('turns must be an array');
  if (turns.length > MAX_TURNS) return deny(`too many turns (>${MAX_TURNS})`);
  const maxAtoms = Number.isInteger(opts.maxAtoms) ? Math.max(0, opts.maxAtoms as number) : 12;
  const minChars = Number.isInteger(opts.minChars) ? Math.max(1, opts.minChars as number) : 12;

  const ranked: Array<{ atom: DistilledAtom; order: number }> = [];
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    // fail-closed on shape: a turn that is not {role,text} is a malformed transcript, not something to guess at.
    if (!t || typeof t !== 'object') return deny(`turn ${i} is not an object`);
    if (!VALID_ROLES.has((t as ConversationTurn).role)) return deny(`turn ${i} has invalid role`);
    if (typeof (t as ConversationTurn).text !== 'string') return deny(`turn ${i} text must be a string`);
    if (t.at !== undefined && typeof t.at !== 'string') return deny(`turn ${i} at must be a string when present`);
    if (t.text.length > MAX_TURN_CHARS) return deny(`turn ${i} exceeds ${MAX_TURN_CHARS} chars`);

    const collapsed = collapse(t.text);
    if (collapsed.length < minChars) continue; // small talk / empty — below the summary-worthiness floor
    if (tokenize(collapsed).length === 0) continue; // no lexical content (punctuation/whitespace only)

    const sourceHedged = HEDGE_RE.test(collapsed.toLowerCase());
    const summed = summarize(collapsed);
    const preserved = preserveHedge(summed.text, sourceHedged);
    if (isForbidden(preserved.text)) continue; // law 3: forbidden-shaped → refuse THIS atom, keep the rest

    const rank = rankOf(t.role, collapsed, preserved.hedged);
    const atom: DistilledAtom = {
      text: preserved.text,
      role: t.role,
      ...(t.at !== undefined ? { at: t.at } : {}),
      rank,
      hedged: preserved.hedged,
      truncated: summed.truncated,
      advisoryOnly: true,
      grantsAuthority: false,
    };
    ranked.push({ atom, order: i });
  }

  // stable, deterministic sort: rank desc, then original transcript order (ties never re-shuffle).
  ranked.sort((a, b) => b.atom.rank - a.atom.rank || a.order - b.order);
  const atoms = ranked.slice(0, maxAtoms).map((r) => r.atom);
  return { ok: true, atoms, advisoryOnly: true, grantsAuthority: false };
}

/** A distiller result NEVER grants authority — the mechanical guarantee mirrored across the governed surfaces. */
export function distillGrantsAuthority(_r?: DistillResult): false {
  return false;
}
