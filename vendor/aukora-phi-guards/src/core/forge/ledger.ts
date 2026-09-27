// core/forge/ledger.ts — THE OWNER'S OWN DECISIONS, MADE TRUSTWORTHY BEFORE ANYTHING CONSUMES THEM.
//
// ══ WHAT THIS LEDGER IS, AND WHY IT IS NOT THE WITNESS CHAIN ══
//
// `.aukora/forge-receipts.jsonl` holds apply / discard / rollback: the decisions the OWNER made. The
// witness chain holds what a TOOL was allowed to do. They are different facts and only one of them is
// a biography — which is GLM's finding, that the acts he genuinely earned are the ones the face cannot
// see.
//
// ══ THREE THINGS IT LACKED, ALL MEASURED ══
//
//   1 · SILENCE ON FAILURE. `review.ts` ended its append with
//       `} catch { /* a ledger that cannot be written must never take the surface down with it */ }`.
//       Right about the remedy, wrong about the silence: a full disk or a changed permission lost acts
//       and nothing anywhere said so. A biography with holes reads as complete, which is worse than
//       no biography at all.
//
//   2 · NO INTEGRITY. Plain JSONL. An edited, removed or reordered line left no trace whatever — in
//       the one ledger holding the owner's own choices.
//
//   3 · NO CAUSAL ID. One accepted proposal writes ONE row here and produces SEVERAL path receipts in
//       the witness chain, so anything counting both double-counts the same act.
//
// ══ WHAT IT DELIBERATELY STILL DOES NOT DO ══
//
// It does not reach standing. `core/aura/figure.ts` makes standing a pure function of receipt counts,
// and feeding a second ledger into that is a decision for the lane that owns it — after this one is
// trustworthy, not as part of making it so. There is a test asserting this file never imports it.
//
// It also stays CONTENT-FREE, which was already right: paths, a digest, a kind and a time. Never the
// patch, never the instruction. A receipt proves a decision happened and cannot be denied; it is not
// a way to reconstruct the owner's work from a log.

import { appendFile, mkdir, readFile } from 'fs/promises';
import { createHash } from 'crypto';
import { join } from 'path';

// Imported, not rewritten. THREE canonicalisers exist in this repository — `chain.mjs`'s
// `canonicalJSON`, `memory/hash.ts`'s `stableStringify`, and the one that used to live in this file.
// The first two recurse; the third was written independently, was shallow, and was the one with the
// hole. That is the argument for reuse stated as a measurement rather than as a preference.
import { stableStringify } from '../memory/hash';

const root = () => process.env.AUKORA_FORGE_REPO || process.cwd();
const DIR = () => join(root(), '.aukora');
const FILE = () => join(DIR(), 'forge-receipts.jsonl');

/** The kinds that are the OWNER choosing. Everything else happened to him. */
const OWNER_ACTS = new Set(['applied', 'discarded', 'rolled-back']);

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

// ══ A CAUSAL BRACKET WAS CLAIMED HERE AND IS WITHDRAWN ══
//
// #150 recorded the chain BEFORE and AFTER an owner act and offered `causedReceipts()` as "exact
// arithmetic" for how many witness receipts one accepted proposal produced. Two things were wrong and
// the second cannot be repaired:
//
//   1 · All three call sites passed an empty callback — `actReceipt({…}, () => {})` — so the two reads
//       were adjacent observations of the same instant, taken after the work. Normally zero; under
//       concurrency, whatever another agent appended in between. A FALSE causal claim, worse than none.
//
//   2 · Wrapping the operation properly would not have saved it. `review.apply()` writes with plain
//       `fs.writeFile` inside the door. The chain records the AGENT RUNTIME's declared tool calls
//       through a PreToolUse hook, and nothing hooks the door's own writes. MEASURED, twice, through
//       the real capture-and-apply path: the chain moves by ZERO across an apply.
//
// The receipts a proposal is associated with were appended during the ROUND, by the engine's fenced
// tool calls, before the proposal existed. The bracket was around the wrong event, and no correct
// wrapping puts it around the right one.
//
// So: one honest observation. `chainAt` says WHERE THE CHAIN STOOD when he decided — enough to locate
// the decision against the chain, and not a claim that the decision caused any part of it. The double
// count is answered by never summing two ledgers, which is `core/forge/sources.ts`'s job.

export interface ChainMark {
  /** `frontierOf(repo).receiptCount` — how many witness receipts existed at this instant. */
  receipts: number;
  /** `frontierOf(repo).frontierDigest` — which chain those receipts belonged to. */
  frontier: string;
}

export interface ReceiptInput {
  kind: string;
  id: string;
  files: string[];
  digest: string;
  reason?: string;
  /** Present only for an owner act: where the chain stood when the decision was taken. */
  act?: { chainAt: ChainMark };
}

export interface LedgerRow extends Record<string, unknown> {
  kind: string;
  id: string;
  files: string[];
  digest: string;
  at: string;
  seq: number;
  prev: string | null;
  self: string;
  act?: { actId: string; chainAt: ChainMark };
}

// ── HEALTH ────────────────────────────────────────────────────────────────────────────────────────
//
// Module-scoped, because the point is that a LATER reader learns the ledger has holes. Throwing would
// take the surface down over a log, which the original comment was right to refuse; returning `ok:
// false` and forgetting it is the same silence with extra steps.
let lost = 0;
let lastError: string | null = null;

/** Whether every act this process tried to record actually reached disk. */
export function ledgerHealth(): { ok: boolean; lost: number; lastError: string | null } {
  return { ok: lost === 0, lost, lastError };
}

/** Test seam, and an honest one: nothing in production resets this. */
export function resetLedgerHealth(): void { lost = 0; lastError = null; }

/**
 * The id for one owner decision.
 *
 * DERIVED, not random: two readers of the same ledger agree on it without coordinating, and a line
 * replayed into the file cannot quietly become a second act. Proposal id + digest + timestamp is the
 * decision — the same proposal accepted twice at different instants is genuinely two acts.
 */
export // The separator is written as the ESCAPE `\u0000`, never as a literal NUL byte, and the distinction
// is not cosmetic. A literal NUL makes this file BINARY to grep, which then reports nothing and exits
// 1 - silently. Measured: `grep -n "OWNER_ACTS" core/forge/ledger.ts` printed nothing while the
// constant sat at line 49. That is why an audit hunting the shallow-canonicaliser bug IN THIS FILE
// could not find it, and why repo-wide grep sweeps have been skipping this file in silence.
// A source file that defeats the tools used to audit it is a hole in the audit, not a quirk.
// The runtime value is identical: the escape IS the NUL character.
function actIdFor(d: { id: string; digest: string; at: string }): string {
  return 'act_' + sha(`${d.id}\u0000${d.digest}\u0000${d.at}`).slice(0, 32);
}

/**
 * The bytes a row's hash covers: everything except the hash itself.
 *
 * ══ THE HOLE THIS REPLACES, REPRODUCED ══
 *
 * This was `JSON.stringify(rest, Object.keys(rest).sort())`. A replacer ARRAY is applied at EVERY
 * DEPTH, not just the top level — so any key not in that top-level list is dropped wherever it appears.
 * The row's nested block was the casualty:
 *
 *     canonical({... act: {actId, chainAt: {receipts: 14, ...}}})
 *       →  {"act":{},"at":...}                       ← the whole causal link, hashed as nothing
 *
 * Measured: change a stored `act.after.receipts` from 14 to 999 and `verifyLedger()` still returned
 * ok. `actId`, `before`, `after`, `receipts` and `frontier` were all outside the hash, in the one
 * ledger holding the owner's own decisions — and `causedReceipts()` reads exactly those fields, so the
 * number answering "what did this decision cause" was unprotected by the mechanism above it.
 *
 * `stableStringify` recurses, so nested keys are sorted and INCLUDED. It is imported rather than
 * rewritten: two definitions of "the canonical form" is precisely how they come to disagree, and the
 * one that disagrees silently is the one nobody is running.
 */
function canonical(row: Record<string, unknown>): string {
  const { self: _self, ...rest } = row;
  return stableStringify(rest);
}

/**
 * The OLD, shallow form. Kept for one reason: to recognise rows written under it.
 *
 * Switching the scheme outright would make every row already on disk fail its own hash — and this file
 * records what that looks like, because it happened once already: the verifier's first run called the
 * owner's real 57-row ledger a forgery. A false accusation against his own history is the overclaim
 * this repository exists to refuse, and it would be the first thing he saw.
 *
 * So a row that matches only this is accepted and COUNTED SEPARATELY as weakly verified. It is not
 * called intact, because for those rows the `act` block genuinely is unverified.
 */
function canonicalWeak(row: Record<string, unknown>): string {
  const { self: _self, ...rest } = row;
  return JSON.stringify(rest, Object.keys(rest).sort());
}

async function tail(): Promise<{ seq: number; self: string | null }> {
  try {
    const raw = await readFile(FILE(), 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    if (!lines.length) return { seq: 0, self: null };
    const last = JSON.parse(lines[lines.length - 1]!) as LedgerRow;
    return { seq: Number(last.seq) || lines.length, self: typeof last.self === 'string' ? last.self : null };
  } catch {
    return { seq: 0, self: null };
  }
}

/**
 * One line per decision, append-only, hash-linked.
 *
 * NEVER THROWS. A ledger that cannot be written must not take the surface down — the original comment
 * was right — but the failure is now returned AND remembered, so `ledgerHealth()` can tell a reader the
 * record in front of them is incomplete.
 */
export async function writeReceipt(input: ReceiptInput): Promise<{ ok: boolean; error?: string; row?: LedgerRow }> {
  const at = new Date().toISOString();
  try {
    await mkdir(DIR(), { recursive: true });
    const prevRow = await tail();

    const base: Record<string, unknown> = {
      kind: input.kind,
      id: input.id,
      files: input.files,
      digest: input.digest,
      at,
      seq: prevRow.seq + 1,
      prev: prevRow.self,
    };
    if (input.reason !== undefined) base.reason = input.reason; if (input.by !== undefined) base.by = input.by; // `by`: see the reopened `ReceiptInput` below `verifyLedger` — packed onto this line so the pinned system-map anchor at line 259 does not move
    // ONLY an owner act carries an act id. A refusal or an expiry is something that happened TO him,
    // and giving those an act id would make a biography count events he took no part in.
    if (input.act && OWNER_ACTS.has(input.kind)) {
      base.act = { actId: actIdFor({ id: input.id, digest: input.digest, at }), ...input.act };
    }

    const row = { ...base, self: sha(canonical(base)) } as LedgerRow;
    await appendFile(FILE(), JSON.stringify(row) + '\n', 'utf8');
    return { ok: true, row };
  } catch (e) {
    lost += 1;
    lastError = `${input.kind} ${input.id}: ${String((e as Error)?.message ?? e).slice(0, 200)}`;
    return { ok: false, error: lastError };
  }
}

export interface LedgerVerdict {
  ok: boolean;
  rows: number;
  /** Rows written before this mechanism existed. Unverifiable, and NOT an accusation. */
  legacy: number;
  /** Rows that carry the mechanism and were checked against it IN FULL, nested fields included. */
  verified: number;
  /**
   * Rows whose hash matches only the old SHALLOW canonicalisation, under which the nested `act` block
   * hashed as `{}`. Their top-level fields are intact; their causal link is unverified. Counted rather
   * than folded into `verified`, because "intact" over a row whose `act` nobody checked is the kind of
   * quiet overclaim this ledger exists to avoid making.
   */
  weak: number;
  /** 1-indexed row where the chain first disagrees, or null. */
  broken: number | null;
  why: string | null;
}

/**
 * Does this file still say what it said when it was written?
 *
 * BOTH MECHANISMS, and each catches what the other cannot. The hash link catches an edit, a removal
 * from the middle, and a reorder. It CANNOT catch a clean truncation of the tail — the remaining
 * prefix is perfectly valid — which is exactly the shape a log loses acts in. The sequence counter
 * catches that, when a caller can say how many rows it expects.
 */
export async function verifyLedger(opts: { expectAtLeast?: number } = {}): Promise<LedgerVerdict> {
  let raw: string;
  try {
    raw = await readFile(FILE(), 'utf8');
  } catch {
    // No file is not a broken file. Nothing has been decided yet.
    return { ok: true, rows: 0, legacy: 0, verified: 0, weak: 0, broken: null, why: null };
  }
  const lines = raw.split('\n').filter(Boolean);
  let prev: string | null = null;
  let legacy = 0;
  let verified = 0;
  let weak = 0;
  let began = false;
  const bad = (n: number | null, why: string): LedgerVerdict =>
    ({ ok: false, rows: lines.length, legacy, verified, weak, broken: n, why });

  for (let i = 0; i < lines.length; i++) {
    const n = i + 1;
    let row: LedgerRow;
    try {
      row = JSON.parse(lines[i]!) as LedgerRow;
    } catch {
      // A line that will not parse is a BREAK, not a line to skip. `readLedger` skips them, and a
      // skipped line in a biography is a hole that reads as an absence of events.
      return bad(n, `row ${n} is not JSON`);
    }

    // ══ HISTORY THAT PREDATES THE MECHANISM IS NOT TAMPERING ══
    //
    // MEASURED the moment this verifier existed, against the owner's real 57-row ledger:
    // {"ok":false,"broken":1,"why":"row 1 content does not match its own hash — rewritten"}. That is an
    // accusation and it is false — those rows were written by a version that hashed nothing. A verifier
    // that calls its own past a forgery is exactly the overclaim this repository refuses, and it would
    // have been the first thing he saw.
    //
    // A row with no `self` is LEGACY: unverifiable, counted, and said out loud rather than judged.
    if (typeof row.self !== 'string') {
      // …but only BEFORE the mechanism begins. An unhashed row after hashed ones is not old history,
      // it is a line spliced in, and that is the thing the hashing is for.
      if (began) return bad(n, `row ${n} carries no hash and appears AFTER hashed rows — spliced, not legacy`);
      legacy += 1;
      continue;
    }

    began = true;
    // STRONG FIRST. A row that satisfies the recursive form needs no further indulgence; only one that
    // fails it is offered the old scheme, and taking that offer is recorded.
    if (sha(canonical(row as Record<string, unknown>)) !== row.self) {
      if (sha(canonicalWeak(row as Record<string, unknown>)) === row.self) {
        weak += 1;
      } else {
        return bad(n, `row ${n} content does not match its own hash — rewritten`);
      }
    } else {
      verified += 1;
    }
    if (verified + weak > 1 && (row.prev ?? null) !== prev) {
      return bad(n, `row ${n} names a different predecessor — a row was removed or reordered`);
    }
    if (Number(row.seq) !== n) {
      return bad(n, `row ${n} carries seq ${row.seq} — the order changed`);
    }
    prev = row.self;
  }

  if (opts.expectAtLeast !== undefined && lines.length < opts.expectAtLeast) {
    return {
      ok: false, rows: lines.length, legacy, verified, weak, broken: null,
      why: `the ledger is short: ${lines.length} rows where at least ${opts.expectAtLeast} were expected — truncated`,
    };
  }
  // Said even on success: "verified" over a ledger that is mostly legacy — or mostly weak — is a
  // weaker claim than it sounds, and the reader is entitled to know which part was actually checked.
  const caveats = [
    legacy ? `${legacy} row(s) predate the hash chain and could not be verified` : null,
    weak ? `${weak} row(s) were hashed under the shallow scheme, so their act block is unverified` : null,
  ].filter(Boolean);
  return {
    ok: true, rows: lines.length, legacy, verified, weak, broken: null,
    why: caveats.length ? caveats.join('; ') : null,
  };
}

// ══ `by` — REOPENED HERE, NOT UP WITH THE REST OF EACH INTERFACE, ON PURPOSE ══
//
// `ReceiptInput` and `LedgerRow` are declared near the top of this file. TypeScript merges same-named
// interface declarations, so this adds one field to each WITHOUT changing a single line above `export
// async function verifyLedger` a few lines up — that declaration is a pinned anchor in
// `surface/app/system-map/system-map.json` (line 259, quoted verbatim), and moving it silently breaks
// the portal's own proof that the function it names still exists where it says it does. That file is
// data for the system-map UI and is not this lane's to touch, so the type addition moves instead of it.
//
// WHAT `by` IS: how an `applied` row came to be written. `owner-click` is `/api/forge/apply` answering
// a real POST from the accept button; `auto-accept` is the hosted glass's own separately-labeled
// automation (`AUKORA_AUTO_ACCEPT=1`, LAW.md §1) applying a proposal with nobody having clicked
// anything. MEASURED: before this field existed, both callers of `core/forge/review.ts`'s `apply()`
// wrote the IDENTICAL row, so a reader had no way to tell "he accepted this" from "the node accepted
// this for him" apart — two facts a receipt exists to keep distinct, collapsed into one string. See
// `apply()`'s own doc for the full account and `test/auto-accept-label.test.ts` for the receipt this
// produces.
//
// Absent on every kind but `applied` — a refusal or an expiry happened TO him, not a decision either
// label may describe. A LEGACY `applied` row with no `by` at all predates this field and is not itself
// a claim of either label; only `auto-accept` is ever asserted affirmatively.
export interface ReceiptInput { by?: 'owner-click' | 'auto-accept' }
export interface LedgerRow { by?: 'owner-click' | 'auto-accept' }

// `causedReceipts()` WAS HERE AND IS DELETED, NOT SOFTENED.
//
// It subtracted two chain marks and returned a count. With the marks withdrawn there is nothing for it
// to subtract, and a version that always answers null is a trap: the next reader finds a function whose
// name promises causation and whose body cannot deliver it. The name was the defect.
//
// Nothing replaces it. The question it was invented for — "how do I count both ledgers without
// double-counting?" — is answered by NOT COUNTING BOTH. See `core/forge/sources.ts`.

/** Read the ledger, newest last. Unparseable lines are DROPPED here and reported by `verifyLedger`. */
export async function readLedger(limit = 200): Promise<LedgerRow[]> {
  try {
    const raw = await readFile(FILE(), 'utf8');
    return raw.split('\n').filter(Boolean).slice(-limit)
      .map((l) => { try { return JSON.parse(l) as LedgerRow; } catch { return null; } })
      .filter((x): x is LedgerRow => x !== null);
  } catch { return []; }
}
