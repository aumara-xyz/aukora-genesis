// surface/round-memory.ts — WHAT THE LAST ROUND ACTUALLY DID, SO THE NEXT ONE CAN ITERATE.
//
// ══ THE GAP, IN HER OWN WORDS ══
//
//   "What I learn about my own round is thin. working-memory gives me the last apply's files. Not the
//    gate result, not the diff, not whether it landed. So I can start a round and cannot properly
//    iterate on it next turn."
//
// Measured — `surface/working-memory.ts:18` in full:
//
//     lastApply?: { files: string[]; note: string; at: number };
//
// Files, a note, a timestamp. She could see that three files changed and could not see that the round
// failed. So the next turn began from the same blank page as the last one, which is the whole of what
// "cannot iterate" means.
//
// Four facts, because those are the four she named: what was PROPOSED, what the GATE said, whether it
// LANDED on origin, and what REFUSED if anything did.
//
// ══ THREE CONSTRAINTS, AND EACH IS LOAD-BEARING ══
//
// CONTENT-FREE. Paths, counts, verdicts, reason classes. Never a file's contents, never the owner's
// prompt, never a patch. Same discipline as the forge ledger and the same reason: a working memory
// that can reconstruct the work is a different artefact with different consequences, and nobody
// decided to build that one. `noteProposed` and friends take a closed shape; anything else is dropped
// rather than stored, and there is a test that puts a prompt and a patch in and reads the file back.
//
// BREATH-SIDE, NOT BIOGRAPHY. This is working state — what just happened, for the next turn's benefit.
// It is not a claim about the past that anybody may rely on, so it must never reach the witness chain.
// `test/talk-action-boundary.test.ts` enforces that and is right to; this file is in its TALK_PATHS.
//
// A FAILED READ IS NOT AN EMPTY ONE. Fourth instance of that class in this repository, and the file
// this fills the gap in is itself an example: `working-memory.ts`'s `load()` returns
// `{ facts: [], summary: '', updatedAt: 0 }` from its catch, so an unreadable file and a fresh node
// are the same object. `readRounds()` returns a three-valued answer instead, and the rendered block
// says "could not be read" rather than "nothing happened".

import { existsSync } from 'fs';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';

const root = () => process.env.AUKORA_FORGE_REPO ?? join(new URL('..', import.meta.url).pathname);
const FILE = () => join(root(), '.aukora', 'round-memory.json');

/** Enough to iterate on; not a log. The oldest fall off the end. */
export const MAX_ROUNDS = 8;

export type GateState = 'passed' | 'failed' | 'errored' | 'unknown';

export interface RoundProposed { files: string[]; created: number }
export interface RoundGate { state: GateState; failing: string[]; counts?: { pass: number; fail: number; skip: number } }
export interface RoundLanded { landed: boolean; verified: { path: string; state: string }[]; main?: string }
export interface RoundRefusal { kind: string; path?: string; reasonClass?: string }

export interface Round {
  id: string;
  at: number;
  proposed?: RoundProposed;
  gate?: RoundGate;
  landed?: RoundLanded;
  refused?: RoundRefusal[];
}

/**
 * THREE-VALUED ON PURPOSE.
 *
 * `ok: true` with an empty array is a fresh node. `ok: false` is a memory that exists and could not be
 * read. Collapsing those is the defect this file is written not to repeat.
 */
export type RoundRead = { ok: true; rounds: Round[] } | { ok: false; why: string };

const str = (v: unknown, n = 200) => String(v ?? '').slice(0, n);
const paths = (v: unknown, n = 40) =>
  (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string').slice(0, n).map((p) => str(p, 240));

/** Read, distinguishing "nothing yet" from "could not look". */
export async function readRounds(): Promise<RoundRead> {
  if (!existsSync(FILE())) return { ok: true, rounds: [] };
  let raw: string;
  try {
    raw = await readFile(FILE(), 'utf8');
  } catch (e) {
    return { ok: false, why: `the round memory could not be read: ${str((e as Error)?.message ?? e, 160)}` };
  }
  if (!raw.trim()) return { ok: true, rounds: [] };
  try {
    const j = JSON.parse(raw) as { rounds?: unknown };
    if (!Array.isArray(j?.rounds)) return { ok: false, why: 'the round memory is not the shape this build writes' };
    return { ok: true, rounds: j.rounds as Round[] };
  } catch (e) {
    return { ok: false, why: `the round memory is not readable JSON: ${str((e as Error)?.message ?? e, 160)}` };
  }
}

/**
 * Merge one fact into the round it belongs to.
 *
 * NEVER THROWS, and reports. Same shape as the forge ledger's writer and for the same reason: working
 * memory that cannot be written must not take a round down, and a write that vanished silently is how
 * a memory quietly stops being one.
 *
 * A CORRUPT FILE IS NOT OVERWRITTEN. If `readRounds` cannot read it, this refuses rather than starting
 * a fresh history over the top — the unreadable bytes may be the only copy of something, and a writer
 * that heals by deleting is the worst possible answer to "a failed read is not an empty one".
 */
async function merge(id: string, patch: Partial<Round>): Promise<{ ok: boolean; error?: string }> {
  try {
    const read = await readRounds();
    if (!read.ok) return { ok: false, error: read.why };

    const rounds = [...read.rounds];
    const i = rounds.findIndex((r) => r && r.id === id);
    if (i >= 0) rounds[i] = { ...rounds[i]!, ...patch, id, at: rounds[i]!.at ?? Date.now() };
    // Newest FIRST, so "the last round" is `rounds[0]` and nobody has to sort to find it.
    else rounds.unshift({ id, at: Date.now(), ...patch });

    await mkdir(dirname(FILE()), { recursive: true });
    await writeFile(FILE(), JSON.stringify({ rounds: rounds.slice(0, MAX_ROUNDS) }, null, 1), 'utf8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: str((e as Error)?.message ?? e, 200) };
  }
}

/** What this round offered. `files` are paths; `created` is a count. No patch, no instruction. */
export function noteProposed(x: { id: string; files: string[]; created: number }) {
  return merge(str(x.id), { proposed: { files: paths(x.files), created: Number(x.created) || 0 } });
}

/** What the gate said. `failing` are TEST NAMES — verdicts, not contents. */
export function noteGate(x: { id: string; state: GateState; failing?: string[]; counts?: RoundGate['counts'] }) {
  const state: GateState = ['passed', 'failed', 'errored'].includes(x.state) ? x.state : 'unknown';
  return merge(str(x.id), {
    gate: {
      state,
      failing: paths(x.failing, 12),
      ...(x.counts ? { counts: { pass: Number(x.counts.pass) || 0, fail: Number(x.counts.fail) || 0, skip: Number(x.counts.skip) || 0 } } : {}),
    },
  });
}

/** Whether the bytes reached origin. `verified` mirrors the land act's own per-path verdict. */
export function noteLanded(x: { id: string; landed: boolean; verified?: { path: string; state: string }[]; main?: string }) {
  return merge(str(x.id), {
    landed: {
      landed: !!x.landed,
      verified: (Array.isArray(x.verified) ? x.verified : []).slice(0, 40)
        .map((v) => ({ path: str(v?.path, 240), state: str(v?.state, 24) })),
      ...(x.main ? { main: str(x.main, 40) } : {}),
    },
  });
}

/** What refused. A reason CLASS and a path — never the body of the file that was refused. */
export async function noteRefused(x: { id: string; kind: string; path?: string; reasonClass?: string }) {
  const read = await readRounds();
  const existing = read.ok ? (read.rounds.find((r) => r?.id === x.id)?.refused ?? []) : [];
  return merge(str(x.id), {
    refused: [...existing, {
      kind: str(x.kind, 48),
      ...(x.path ? { path: str(x.path, 240) } : {}),
      ...(x.reasonClass ? { reasonClass: str(x.reasonClass, 64) } : {}),
    }].slice(-12),
  });
}

/**
 * The last round, in the words her next turn needs.
 *
 * The sentence this exists to make possible is "the gate went red on X, here is the smaller change" —
 * so the failing name is in it, and so is whether the work is actually on origin. An unreadable memory
 * says so; an empty one says THAT, and the two are different lines.
 */
export async function roundMemoryBlock(): Promise<string> {
  const read = await readRounds();
  if (!read.ok) return `[the last round] could not be read — ${read.why}`;
  if (!read.rounds.length) return '[the last round] no rounds yet on this node.';

  const r = read.rounds[0]!;
  const out: string[] = ['[the last round]'];

  if (r.proposed) {
    out.push(`  proposed: ${r.proposed.files.length} file(s)`
      + (r.proposed.created ? `, ${r.proposed.created} new` : '')
      + (r.proposed.files.length ? ` — ${r.proposed.files.slice(0, 6).join(', ')}` : ''));
  }
  if (r.gate) {
    const c = r.gate.counts;
    out.push(`  gate: ${r.gate.state}`
      + (c ? ` (${c.pass} pass, ${c.fail} fail${c.skip ? `, ${c.skip} skip` : ''})` : '')
      + (r.gate.failing.length ? ` — red on: ${r.gate.failing.slice(0, 4).join(' · ')}` : ''));
  }
  if (r.landed) {
    // NAMED IN BOTH DIRECTIONS. "landed" is the fact she could not see at all before, and silence on
    // success would make the absence of the word mean two different things.
    const bad = r.landed.verified.filter((v) => v.state !== 'landed');
    out.push(r.landed.landed
      ? `  landed: yes${r.landed.main ? ` — verified on origin/main ${r.landed.main}` : ''}`
      : `  NOT LANDED${bad.length ? ` — ${bad.map((v) => `${v.path}: ${v.state}`).join('; ')}` : ''}`);
  }
  if (r.refused?.length) {
    out.push(`  refused: ${r.refused.map((x) => `${x.kind}${x.path ? ` ${x.path}` : ''}${x.reasonClass ? ` (${x.reasonClass})` : ''}`).slice(0, 4).join(' · ')}`);
  }
  if (out.length === 1) out.push('  a round was started and nothing about it was recorded.');
  return out.join('\n');
}
