// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * φ — THE MICRO-LEARNING STORE. What was decided, under which policy, and nothing else.
 *
 * ══ WHY THE LEDGER IS THE CORPUS ══
 *
 * The asset here is not a model, it is the record: a hash-linked history of governed acts, each
 * labelled refused / allowed / unguarded, tied to a session and a gate result. That is supervised
 * data about this agent's own behaviour, produced by using the thing, that no vendor holds. A core
 * meant to learn from the inside should learn from that rather than from a scrape.
 *
 * ══ THE WALL, AND IT IS THE ENTIRE DESIGN ══
 *
 * `core/aura/figure.ts` makes the standing triad a pure function of RECEIPT COUNTS. So a learning
 * loop that appended to the witness chain would make **learning volume into permanent posture** —
 * the figure would read as more accomplished for having thought a lot. That is the talk/action
 * boundary's exact failure, arriving through a new door, and it is why this file writes to its own
 * ledger at `.aukora/memory/learning.jsonl` the way governed recall writes `recall-receipts.jsonl`.
 *
 * `test/talk-action-boundary.test.ts` keeps an allowlist of exactly ONE module permitted to import
 * the chain's `append`, and it is the fence. **That allowlist is not widened for this store.** This
 * module imports nothing from `chain.mjs` at all, which is a structural claim rather than a promise,
 * and `test/memory-learning.test.ts` asserts it by reading this source.
 *
 * ══ CONTENT DISCIPLINE — STRICTER THAN A RECEIPT'S ══
 *
 * A receipt names a path, because the owner needs to know which file was refused. A learning corpus
 * that accumulated every path he ever touched is a DIFFERENT OBJECT with a different risk, and nobody
 * asked for that one. So `observationOf` is an ALLOW-LIST projection: it keeps the decision axes and
 * drops everything else, including fields a receipt grows later. Deny-lists are how content arrives
 * by accident.
 *
 * What is kept: the verdict, the reason class, the rule (a pattern from the public law), the policy
 * version, the tool name, and a timestamp. Every one of those is a label from a closed vocabulary or
 * a number. None of them is a sentence.
 */

import { mkdir, appendFile, readFile } from 'fs/promises';
import { join } from 'path';

export const LEARNING_SCHEMA = 'aukora-learning-v1';

/** The repository this store belongs to, read live — same rule the rest of the organ follows. */
const root = (repoRoot?: string) => repoRoot ?? process.env.AUKORA_FORGE_REPO ?? process.cwd();

/** Beside recall, never beside the chain. */
export function learningPath(repoRoot?: string): string {
  return join(root(repoRoot), '.aukora', 'memory', 'learning.jsonl');
}

/** The decision axes, and nothing else. Every field here is a label or a number. */
export interface Observation {
  readonly at: string;
  readonly tool: string;
  readonly verdict: string;
  readonly reasonClass: string;
  readonly rule: string | null;
  readonly policyVersion: string | null;
}

export interface LearningRecord {
  readonly schema: typeof LEARNING_SCHEMA;
  readonly at: string;
  readonly observed: number;
  /** `verdict|reasonClass|policyVersion` → how many. Counts, never examples. */
  readonly counts: Readonly<Record<string, number>>;
}

/**
 * Project one receipt into a content-free observation, or refuse it.
 *
 * ALLOW-LIST, and that is load-bearing. A deny-list ("drop `path`, drop `session`") passes anything
 * a receipt grows afterwards straight through — which is precisely how a transcript field, added for
 * some good reason elsewhere, would end up in a learning corpus without anyone deciding it should.
 *
 * Returns `null` for anything it cannot read. A store that guessed at a malformed receipt would be
 * inventing training data about decisions that were never made.
 */
export function observationOf(receipt: unknown): Observation | null {
  if (receipt === null || typeof receipt !== 'object') return null;
  const r = receipt as Record<string, unknown>;
  if (typeof r.verdict !== 'string' || typeof r.reasonClass !== 'string') return null;
  if (typeof r.ts !== 'string' || typeof r.tool !== 'string') return null;
  return {
    at: r.ts,
    tool: r.tool,
    verdict: r.verdict,
    reasonClass: r.reasonClass,
    rule: typeof r.rule === 'string' ? r.rule : null,
    policyVersion: typeof r.policyVersion === 'string' ? r.policyVersion : null,
  };
}

/**
 * Burn a batch of observations into one record.
 *
 * Counts, never examples — a store that kept representative cases would be keeping content by a
 * politer name. Keys are sorted so the same observations produce byte-identical records regardless of
 * arrival order; a corpus whose bytes depend on scheduling is one nobody can diff.
 */
export function burn(observations: readonly Observation[], { at }: { at: string }): LearningRecord {
  const tally: Record<string, number> = {};
  for (const o of observations) {
    const key = `${o.verdict}|${o.reasonClass}|${o.policyVersion ?? 'none'}`;
    tally[key] = (tally[key] ?? 0) + 1;
  }
  const counts: Record<string, number> = {};
  for (const k of Object.keys(tally).sort()) counts[k] = tally[k]!;
  return { schema: LEARNING_SCHEMA, at, observed: observations.length, counts };
}

/** Append one record to this repository's learning ledger. Creates the directory on first use. */
export async function appendLearning(repoRoot: string, record: LearningRecord): Promise<void> {
  const p = learningPath(repoRoot);
  await mkdir(join(root(repoRoot), '.aukora', 'memory'), { recursive: true });
  await appendFile(p, `${JSON.stringify(record)}\n`, 'utf8');
}

/**
 * Read the ledger back, skipping any line that does not parse.
 *
 * Skip rather than throw: this store is evidence about the agent's own behaviour, not a chain, and
 * one torn line must not make the rest unreadable. It is emphatically NOT the witness chain, where a
 * corrupt line is a finding — here it is a corrupt line.
 */
export async function readLearnings(repoRoot: string): Promise<LearningRecord[]> {
  let text = '';
  try { text = await readFile(learningPath(repoRoot), 'utf8'); } catch { return []; }
  const out: LearningRecord[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as LearningRecord;
      if (parsed?.schema === LEARNING_SCHEMA) out.push(parsed);
    } catch { /* a torn line is not a finding here */ }
  }
  return out;
}
