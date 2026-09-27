// φ — THE CONVERSATION ON DISK. Actual words, under `.aukora/`, so a restart does not erase her.
//
// ══ THIS HOLDS THE WORDS THEMSELVES ══
//
// Content-free receipts (`.aukora/forge-receipts.jsonl`) are NOT the model here. A receipt names a
// kind, a file list, a digest and a time — never the owner's instruction and never the engine's reply.
// This file does the opposite on purpose: every turn is who said it, what was said, when, and which
// engine. That is the only way AUMA can still know who she was talking to after a door restart, a
// reload, or a five-minute gap. If you need a ledger that is safe to publish, look at the receipt
// file. If you need memory, look here.
//
// ══ WHAT THIS IS ══
//
//   · the durable prior for `core/forge/voice.ts` — oldest first, clipped, shape-validated on read
//   · one JSONL under `.aukora/conversation.jsonl`, local to this node, gitignored with the rest
//   · written by the door when a turn finishes with real words, not by the browser POST body
//
// ══ WHAT THIS IS NOT ══
//
//   · not a receipt, not evidence, not something the record plane shows
//   · not encryption, not multi-user, not a shared transcript across machines
//   · not the forge repair prior (`surface/repair.ts` still carries diffs and outcomes for the hand)
//   · not the OpenRouter presence ring (`surface/presence.ts` stays ephemeral in process)
//   · not a promise the surface will re-paint the transcript after a reload — only that the MIND
//     behind the next chat turn still has the words
//
// The browser used to ship the last six rounds in every POST. A reload emptied that; a door restart
// emptied anything the process held. Trusting the wire for memory made "are you there love?" arrive
// cold every time. The door owns the store now.

import * as path from 'path';
import { existsSync } from 'fs';
import { readFile, appendFile, mkdir } from 'fs/promises';
import type { VoiceTurn } from '../core/forge/voice';
import {
  rememberTurn as sealTurnInLedger,
  recallTurn as readSealedTurn,
  forgetOccurrence as eraseSealedTurn,
  liveLedgerDigest,
  liveLedgerRecords,
} from '../core/memory/ledger';

/**
 * The repository root, read LIVE on every call — same seam as `review.ts` / `deadDoor.ts`, so a test
 * can point the store at a scratch tree via `AUKORA_FORGE_REPO` without tearing down the module cache.
 */
function repoRoot(): string {
  const bunDir = (import.meta as unknown as { dir?: string }).dir;
  // ── ONE `..`, NOT TWO. THIS FILE IS `surface/`, NOT `core/forge/` ──────────────────────────────
  //
  // MEASURED, on the first live conversation after this store landed. The pattern was copied verbatim
  // from `core/forge/review.ts`, which sits TWO directories down and therefore climbs twice to reach
  // the root. `surface/conversation.ts` sits ONE down, so the same two hops land in the PARENT of the
  // repository — every remembered word went to `~/.aukora/conversation.jsonl`, outside the tree,
  // silently, while the door reported the turn as recorded.
  //
  // AND EVERY TEST PASSED THROUGH IT. `test/conversation.test.ts` sets `AUKORA_FORGE_REPO` in its
  // `beforeEach`, which is correct and necessary — a suite must not write into the real repository —
  // but it means the fallback below, the branch a running door actually takes, was executed by
  // nothing. Eleven green cases over a store that wrote to the wrong disk location. The suite was
  // measuring the override; the door was using the default.
  //
  // So the resolution is asserted at the use site rather than trusted: the fallback is checked for
  // `aukora.law.json`, which every real root has, and a root that does not carry it is refused
  // instead of guessed at.
  const fromEnv = process.env.AUKORA_FORGE_REPO;
  if (fromEnv) return fromEnv;
  const here = bunDir ?? path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(here, '..');
}

const STORE_DIR = () => path.join(repoRoot(), '.aukora');
const STORE = () => path.join(STORE_DIR(), 'conversation.jsonl');

/**
 * The resolved store path, for the one test that must check the DEFAULT root rather than the override.
 *
 * Exported rather than re-derived in the test, because a test that recomputes the path is testing its
 * own arithmetic — which is precisely how the two-hop defect stayed invisible while eleven cases
 * passed over it.
 */
export function storePathForTest(): string { return STORE(); }

/** One spoken turn. The words are the point. */
export interface Turn {
  role: 'user' | 'assistant';
  content: string;
  /** Unix ms when the door recorded it. */
  at: number;
  /** Which mind produced the assistant half; on the user half, which mind was addressed. */
  engine?: string;
}

/** How many turns voice actually receives — matches the old browser window of six exchanges. */
export const VOICE_PRIOR_MAX = 40;
/** Longest single turn kept on disk or handed to her. */
export const TURN_CHARS = 3_000;

const ROLES = new Set(['user', 'assistant']);

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

/**
 * Read a raw value into turns this module will handle.
 *
 * TOTAL, never throwing, never trusting a shape — the same rail as `readPrior` in
 * `surface/repair.ts`. A malformed line on disk is dropped, not repaired into something plausible.
 * Oldest-first order is preserved for whatever survives.
 */
export function readTurns(v: unknown): Turn[] {
  if (!Array.isArray(v)) return [];
  const out: Turn[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const role = r.role;
    if (role !== 'user' && role !== 'assistant') continue;
    const content = str(r.content, TURN_CHARS).trim();
    if (!content) continue;
    const at = typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : 0;
    const engine = str(r.engine, 24).trim() || undefined;
    out.push({ role, content, at, engine });
  }
  return out;
}

/**
 * Append one turn. Failure to write must never take a live round down with it — a missing memory is
 * worse only if we claim we wrote it.
 */
export async function appendTurn(turn: {
  role: 'user' | 'assistant';
  content: string;
  engine?: string;
  at?: number;
}): Promise<void> {
  const content = String(turn.content ?? '').trim().slice(0, TURN_CHARS);
  if (!content || !ROLES.has(turn.role)) return;
  const row: Turn = {
    role: turn.role,
    content,
    at: typeof turn.at === 'number' && Number.isFinite(turn.at) ? turn.at : Date.now(),
    engine: str(turn.engine, 24).trim() || undefined,
  };
  try {
    await mkdir(STORE_DIR(), { recursive: true, mode: 0o700 });
    await appendFile(STORE(), JSON.stringify(row) + '\n', { encoding: 'utf8', mode: 0o600 });
  } catch { /* store is best-effort; the round already answered */ }

  // ══ THE GOVERNED MEMORY LEDGER — BRICK 2 ══
  //
  // "The moment φ remembers a conversation, port the minimal slice" — aukora-one's BRICK_ORDER.md,
  // naming this exact file as the trigger. `core/memory/ledger.ts` seals the same turn under its own
  // AES-256-GCM key in a SEPARATE file (`.aukora/memory/log.jsonl`), so forgetting it later is real key
  // destruction with a checkable certificate, not a line deleted from a plaintext file. Additive and
  // best-effort, same as the write above: a ledger failure must never fail a live round, and it can
  // never corrupt `conversation.jsonl` because it never touches it.
  try {
    await sealTurnInLedger({ role: row.role, content: row.content, engine: row.engine });
  } catch { /* best-effort, see above */ }
}

/**
 * ══ CLOSING THE LOOP: READ AND FORGET ══
 *
 * This file has SEALED turns into the ledger since BRICK 2 and nothing has ever read one back or
 * forgotten one. Measured on the owner's node: 95 events — one genesis, 94 inserts, and ZERO
 * tombstones. Sealed, encrypted, and unreachable in both directions.
 *
 * `recallTurn` and `forgetOccurrence` were written, reviewed and tested, and had no production caller
 * — the same shape as `bind` before it got a verb. A memory that cannot be read is indistinguishable
 * from one that was never written, and a memory that cannot be forgotten is not the owner's.
 *
 * These are the callers. They live here, beside the write, because the surface that seals a turn is
 * the one entitled to unseal or destroy it.
 */

/**
 * Read one sealed turn back.
 *
 * Returns `null` for a turn that is not known. THROWS for one that is known and forgotten — that
 * distinction is `vault.ts`'s and it is right: "I have no record of this" and "I destroyed this and
 * will not reconstruct it" are different sentences, and collapsing them would make a forget look like
 * an absence.
 */
export async function recallSealedTurn(occurrenceId: string): Promise<{
  role: 'user' | 'assistant'; content: string; engine: string | null; at: string;
} | null> {
  return readSealedTurn(occurrenceId);
}

/**
 * Forget one sealed turn, and everything superseding it.
 *
 * NOT best-effort, unlike the write above. A write that quietly fails costs a record; a FORGET that
 * quietly fails leaves the owner believing something is gone when it is on disk, and he would act on
 * that belief. So the certificate comes back, and `null` means the id was unknown or already
 * forgotten — an honest answer rather than an error.
 *
 * The digest is captured either side, because "it is gone" is a claim about the field and not about
 * one row. See `liveLedgerDigest`: it is a function of the live SET, so an append that erased nothing
 * would not move it.
 */
export async function forgetSealedTurn(occurrenceId: string): Promise<{
  forgotten: boolean;
  certificate: Awaited<ReturnType<typeof eraseSealedTurn>>;
  before: string;
  after: string;
  liveBefore: number;
  liveAfter: number;
}> {
  const before = liveLedgerDigest();
  const liveBefore = liveLedgerRecords().length;
  const certificate = await eraseSealedTurn(occurrenceId);
  const after = liveLedgerDigest();
  const liveAfter = liveLedgerRecords().length;
  return { forgotten: certificate !== null, certificate, before, after, liveBefore, liveAfter };
}

/** What the ledger still asserts — the recomputation, for a caller that wants to show it moved. */
export function sealedTurnsDigest(): string {
  return liveLedgerDigest();
}

/**
 * Record one exchange: what he said, what was answered, which engine.
 *
 * Two lines, in order, so a half-written pair never looks like an orphaned assistant turn on the next
 * read (the assistant line is only written after the user line returns).
 */
export async function recordExchange(
  asked: string,
  said: string,
  engine: string,
): Promise<void> {
  const user = String(asked ?? '').trim();
  const reply = String(said ?? '').trim();
  if (!user || !reply) return;
  const eng = str(engine, 24).trim() || undefined;
  const at = Date.now();
  await appendTurn({ role: 'user', content: user, engine: eng, at });
  await appendTurn({ role: 'assistant', content: reply, engine: eng, at: at + 1 });
  try {
    const { noteExchange } = await import('./working-memory');
    await noteExchange(user, reply);
  } catch { /* best-effort */ }
  try {
    const mind = await import('./mind/memory');
    await mind.learnFromExchange(user, reply);
  } catch { /* best-effort */ }
}

/**
 * Everything on disk, oldest first, shape-validated.
 *
 * A missing or unreadable file is an empty conversation — the same answer a first boot has.
 */
export async function loadTurns(): Promise<Turn[]> {
  try {
    if (!existsSync(STORE())) return [];
    const raw = await readFile(STORE(), 'utf8');
    const rows: unknown[] = [];
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try { rows.push(JSON.parse(t)); } catch { /* drop a broken line; keep the rest */ }
    }
    return readTurns(rows);
  } catch {
    return [];
  }
}

/**
 * What `askAuma` gets as `prior` — the last few turns, oldest first, as real chat roles.
 *
 * The browser's `prior` field is no longer consulted for this. The door's own file is the only source.
 */
export async function priorForVoice(max = VOICE_PRIOR_MAX): Promise<VoiceTurn[]> {
  const all = await loadTurns();
  const tail = all.slice(-Math.max(0, max));
  return tail.map((t) => ({
    role: t.role,
    // Keep engine tag so she knows which mind said what last round
    content: t.engine && t.role === 'assistant'
      ? t.content
      : t.content,
  }));
}
