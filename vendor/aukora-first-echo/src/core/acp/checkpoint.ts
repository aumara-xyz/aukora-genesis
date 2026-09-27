// φ — THE ANCHOR, as a third mode of the same joint.
//
// ══ THE PROBLEM, STATED EXACTLY ══
//
// A hash chain proves that entry N follows entry N-1. It does not prove that entry N-1 was ever the
// last entry. **Every prefix of a valid chain is itself a valid chain** — so an actor who can write the
// file can delete its tail, or rewrite the whole history from genesis, and `verify` will report it
// clean. That is LIMITS.md §2, and it is the question a competent evaluator asks first: *who verifies
// this?* Today's honest answer has been "you verify it against yourself", which is not an answer.
//
// ══ WHY THIS IS RECONCILIATION AND NOT NEW MACHINERY ══
//
// `reconcile.ts` already compares two independent records of the same events and returns
// agree / gap / no-record. The vendor's ACP stream was the first second party. A CHECKPOINT RETAINED BY
// ANOTHER MACHINE is the same shape with a different counterpart: a small statement of "at this time,
// this chain had N entries and its head was H", held somewhere the writer of the chain cannot reach.
//
// Truncation then stops being invisible. The local chain still self-verifies — it always will — but it
// no longer matches what another machine remembers about it. One implementation, two properties.
//
// ══ WHAT THIS IS NOT ══
//
// Not a cryptographic anchor to a neutral third party, and not proof of time. It defends against a
// machine rewriting its OWN history, and only for as long as the peer's copy is genuinely out of the
// attacker's reach. An attacker holding both machines defeats it, and so does one who simply waits for
// a period no checkpoint covers. Signing raises the bar — an unsigned checkpoint can be forged by
// whoever holds the peer — but the retention, not the signature, is what does the work here.
//
// Not blockchain. An append-only log held by two parties who both care is the whole mechanism.

import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';

export interface Checkpoint {
  /** Which chain this is about — the repo identity, never a path. See core/witness/identity.mjs. */
  repoId: string;
  /** Wall-clock of the emitting machine. Evidence of ordering, never proof of it. */
  at: string;
  /** How many entries the chain had. The number truncation cannot survive. */
  count: number;
  /** The hash of entry `count - 1`. Pins the CONTENT of the prefix, not merely its length. */
  head: string;
  /** A running digest over every entry hash, so a rewrite that preserves length is caught too. */
  root: string;
  /** Who says so. A label, not an authority — see the module note on signing. */
  machine: string;
  sig?: string | null;
}

export interface CheckpointVerdict {
  /**
   * `uninspected` is NOT a fourth flavour of failure — it is the absence of a comparison, and it must
   * never be coerced to either side. A caller that treats it as `agree` has reinstated the collapse
   * this type exists to prevent; one that treats it as `gap` accuses on evidence it does not have.
   *
   * `foreign` is a fifth: the checkpoint is not even ABOUT this chain. `repoId` said so, and comparing
   * hashes anyway would produce a confident-sounding `gap` — TRUNCATED or REWRITTEN — against a
   * machine that never held these entries at all. That is a worse answer than `uninspected`, because
   * it reads as an accusation rather than as an unanswered question.
   */
  kind: 'agree' | 'gap' | 'no-record' | 'uninspected' | 'foreign';
  /** Entries the chain has now. */
  now: number;
  /** Entries the checkpoint remembers. */
  then: number;
  detail: string;
}

/**
 * ══ MALFORMED IS NOT EMPTY, AND EMPTY IS NOT AGREEMENT ══
 *
 * This mapped an unparseable line to `''` and then filtered it out. So a chain file of pure garbage
 * returned `[]` — indistinguishable from a chain that legitimately has no entries — and every caller
 * downstream compared that emptiness and found nothing to disagree with. Three states collapsed into
 * the most reassuring one: malformed → empty → agree.
 *
 * The same shape as the `no-record`/`gap` conflation this repository has already paid for twice. A line
 * that will not parse is EVIDENCE OF DAMAGE; dropping it converts damage into absence, and absence
 * reads as innocence.
 *
 * So the count of unreadable lines comes back with the hashes and the callers must decide. Nothing
 * here silently decides for them.
 */
function entryHashes(chainFile: string): { hashes: string[]; unreadable: number; missing: boolean } {
  if (!existsSync(chainFile)) return { hashes: [], unreadable: 0, missing: true };
  const hashes: string[] = [];
  let unreadable = 0;
  for (const l of readFileSync(chainFile, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try {
      const h = (JSON.parse(l) as { hash?: string }).hash;
      // A parsed line with no hash is as unreadable as one that would not parse: it cannot contribute
      // to the digest, and pretending it was never there is the same lie in a quieter voice.
      if (typeof h === 'string' && h) hashes.push(h); else unreadable += 1;
    } catch { unreadable += 1; }
  }
  return { hashes, unreadable, missing: false };
}

/** A digest over the ordered entry hashes. Order-sensitive on purpose: a reordering is a rewrite. */
export function rootOf(hashes: string[]): string {
  const h = createHash('sha256');
  for (const x of hashes) h.update(x);
  return h.digest('hex');
}

export function emitCheckpoint(chainFile: string, repoId: string, machine: string, now = new Date()): Checkpoint {
  const { hashes, unreadable } = entryHashes(chainFile);
  // A checkpoint is a claim somebody else will rely on. Emitting one over a file we could not fully
  // read would commit us to a digest of the readable part while calling it the whole.
  if (unreadable > 0) {
    throw new Error(`refusing to emit a checkpoint: ${unreadable} line(s) of ${chainFile} could not be read`);
  }
  return {
    repoId, machine,
    at: now.toISOString(),
    count: hashes.length,
    head: hashes[hashes.length - 1] ?? '',
    root: rootOf(hashes),
    sig: null,
  };
}

/**
 * Check a chain against a checkpoint another machine retained.
 *
 * The chain is allowed to have GROWN — that is the normal case and must not read as tampering. What it
 * may not do is disagree about the prefix the checkpoint already witnessed.
 *
 * `localRepoId` is required, not optional — the same shape `emitCheckpoint` already takes it in. This
 * function used to trust `cp.repoId` was already the right one by the time it arrived, which meant the
 * check existed only where a caller remembered to add it (`scripts/checkpoint.ts` does, ahead of this
 * call); anyone else calling this library function directly got no such protection, and a checkpoint
 * retained for repo A checked against repo B's chain fell through to the hash/count comparison below —
 * producing a confident TRUNCATED or REWRITTEN verdict against a machine that never held those entries.
 * The proof this type exists to make travels with the checker now, not with one caller's memory of it.
 */
export function verifyAgainstCheckpoint(chainFile: string, cp: Checkpoint, localRepoId: string): CheckpointVerdict {
  const { hashes, unreadable, missing } = entryHashes(chainFile);
  const now = hashes.length;

  // FOREIGN, CHECKED BEFORE ANYTHING ELSE. A checkpoint about a different repository is not evidence
  // about this one, and comparing hashes anyway would produce a confident-sounding accusation over a
  // comparison that was never meaningful — see the `foreign` note on `CheckpointVerdict.kind`.
  if (cp.repoId !== localRepoId) {
    return {
      kind: 'foreign', now, then: cp.count,
      detail: `this checkpoint is about ${cp.repoId}, and this chain is ${localRepoId} — not evidence about each other`,
    };
  }

  // UNINSPECTED, AND IT DOES NOT COLLAPSE. A file we could only partly read cannot be compared: the
  // readable remainder may agree with the checkpoint perfectly while the damaged lines were the ones
  // that changed. Reporting that as `agree` is the malformed → empty → agree collapse; reporting it as
  // `gap` is an accusation the evidence does not support. It gets its own answer.
  if (unreadable > 0) {
    return {
      kind: 'uninspected', now, then: cp.count,
      detail: `${unreadable} line(s) of this chain could not be read, so it cannot be compared against ${cp.machine}'s checkpoint`,
    };
  }

  if (now === 0 && cp.count > 0) {
    return {
      kind: 'no-record', now, then: cp.count,
      detail: `the chain is ${missing ? 'gone' : 'empty'}, but ${cp.machine} retains a checkpoint of ${cp.count} entries`,
    };
  }
  if (now < cp.count) {
    return {
      kind: 'gap', now, then: cp.count,
      detail: `TRUNCATED — ${cp.count - now} entr${cp.count - now === 1 ? 'y has' : 'ies have'} been removed since ${cp.machine} witnessed this chain`,
    };
  }

  const prefix = hashes.slice(0, cp.count);
  if (rootOf(prefix) !== cp.root) {
    return {
      kind: 'gap', now, then: cp.count,
      detail: `REWRITTEN — the chain still self-verifies, but its first ${cp.count} entries are not the ones ${cp.machine} saw`,
    };
  }
  if ((prefix[prefix.length - 1] ?? '') !== cp.head) {
    return { kind: 'gap', now, then: cp.count, detail: `head mismatch at entry ${cp.count}` };
  }

  return {
    kind: 'agree', now, then: cp.count,
    detail: now === cp.count
      ? `unchanged since ${cp.machine} witnessed it`
      : `${now - cp.count} entr${now - cp.count === 1 ? 'y' : 'ies'} appended since; every witnessed entry is intact`,
  };
}

export function renderCheckpoint(v: CheckpointVerdict): string {
  const mark = v.kind === 'agree' ? '✓' : v.kind === 'gap' ? '✗' : '·';
  return `  ${mark} ${v.detail}\n    now ${v.now} entries · witnessed ${v.then}`;
}
