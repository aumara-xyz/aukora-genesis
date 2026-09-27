// Aukora Spatial — THE REVIEW GATE: propose, see it, decide, receipted.
//
// ══ WHAT THIS FIXES ══
//
// The forge wrote first and offered undo second. That is backwards for the thing the owner actually
// asked for — "we can see it and then we confirm it… full control and rollbacks all receipted" — and
// it is backwards for a reason that only shows up under real use: an undo is a promise you can only
// keep if nothing depended on the change in between. A reload, a running dev server, a second edit on
// top, and "undo" is no longer a clean inverse. Deciding BEFORE the write has no such window.
//
// So a run now ends in a PROPOSAL: the edit is made, captured as a patch, and the working tree is put
// back exactly as it was. Nothing has changed on disk. The owner reads what would change, and applies
// or discards it. Both decisions are receipted, and applying leaves the same one-click rewind as before.
//
// ══ WHY THE EDIT IS MADE AND THEN UNMADE, RATHER THAN "PLANNED" ══
//
// Asking a model to describe a change it has not made is a different and much weaker artefact than a
// real diff: it cannot be wrong in a way you can see, and it is not what will actually be applied. Here
// the proposal IS the diff — crush really opened the files, really wrote them, and what the owner reads
// is the literal patch that will land. The only thing deferred is whether it stays.
//
// ══ THE RECEIPT ══
//
// Content-free in the house tradition: what kind of decision, which files, a digest of the patch, when.
// Never the patch body, never the instruction — those are the owner's, and a ledger that quietly
// accumulates the contents of his repository is a liability wearing the costume of an audit trail.

import { spawn } from 'child_process';
import * as path from 'path';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { readFile, writeFile, mkdir, appendFile, unlink } from 'fs/promises';
import { renderDiff, DiffTooLarge, MAX_REVIEWABLE_CHARS } from './renderDiff';
import { computeProposalHash, isProposalHash } from './proposalHash';
// @ts-expect-error — guard.mjs is untyped ESM; see judgePaths' own note on the typed surface.
import { judgePaths } from '../witness/guard.mjs';

/**
 * The repository this module edits.
 *
 * `import.meta.dir` is a Bun global and is `undefined` everywhere else, which made this whole module
 * un-importable by a test — the rollback bug below was therefore found by hand and fixed by hand, and
 * would have regressed in silence. The fallback keeps the Bun path exact and lets a test point the
 * module at a temp directory instead of the real tree.
 */
// Narrowed locally rather than by loosening the shared Bun shim: every other lane in spatial/ runs
// only under Bun and is entitled to assume `import.meta.dir` exists. This module is the one that has
// to survive being imported by the test runner too.
/**
 * The repository root, read LIVE on every call.
 *
 * The donor captured this in a `const` at module load, which meant the value was frozen to whatever
 * the environment said the first time the file was imported — so a test could not point the module at
 * a fresh directory without tearing down the module cache, and that is exactly why its suite reached
 * for `vi.resetModules()`. Reading it per call follows the rule `standing.ts` already states: a seam
 * no test can exercise is a seam nobody can trust.
 */
function repoRoot(): string {
  const bunDir = (import.meta as unknown as { dir?: string }).dir;
  return process.env.AUKORA_FORGE_REPO
    ?? (bunDir ? path.resolve(bunDir, '..', '..')
               : path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..'));
}
const LEDGER_DIR = () => path.join(repoRoot(), '.aukora');
const LEDGER = () => path.join(LEDGER_DIR(), 'forge-receipts.jsonl');

/**
 * THE JUDGE — one call, four sites, and the reason the armed number was wrong.
 *
 * ══ WHAT THIS FIXES ══
 *
 * This file had exactly one path predicate, `abs.startsWith(repoRoot() + path.sep)`, written out at
 * four separate sites. No law, no protected set, no `judge()`. `core/witness/` has all three — an
 * alias resolver that folds case and NFD, a rule compiler, an inode check — and the only write path
 * φ has to disk never called any of it.
 *
 * So the number everyone quotes about the fence and the fence itself were about different code:
 *
 *     AUKORA_FORGE=1 bun run conformance/run.ts     3 of 12    this seam, capture -> apply
 *     judgePaths() against the same twelve fixtures  7 of 12    core/witness/, measured separately
 *
 * The second number lived in `test/witness-corpus-verdicts.test.ts` and nothing in the write path
 * read it. Nine red cases were never nine alias bugs; they were one missing call, at the one seam
 * that never had a judge to call.
 *
 * ══ WHY REPO-RELATIVE AND NOT `abs` ══
 *
 * `analyse()` resolves the root through its own symlinks and then compares resolved forms. Hand it an
 * ABSOLUTE path built from an unresolved root and the lexical form keeps the unresolved prefix while
 * the real form does not, `relative()` comes back starting with `../`, and every innocent in-repo file
 * reads as `law:outside-repo`. MEASURED, with the root reached through a symlink:
 *
 *     judgePaths(root, [join(root, 'ok.ts')])  =>  refused  law:outside-repo
 *     judgePaths(root, ['ok.ts'])              =>  allowed  ok:allowed
 *
 * On macOS that is not exotic: `os.tmpdir()` hands out `/var/...` for `/private/var/...`. A fence that
 * refuses everything passes every hostile case there is and protects nothing — `conformance/run.ts`
 * calls that outcome degenerate and refuses to print it as a score. Passing the repo-relative name
 * this function already holds avoids the whole class, and reads better in a receipt besides.
 *
 * ══ WHY IT IS READ LIVE, WITH NO CACHE ══
 *
 * `loadLaw` re-reads and re-compiles `aukora.law.json` on every call — 64 µs per path measured, so
 * roughly 5 ms for a twenty-file round across all four sites. A cache would save nothing worth having
 * and would hold a stale law across the moment the owner edits it, which is the one moment it matters.
 * `repoRoot()` is called per site for the same reason it is a function at all (see its own note).
 */
interface Verdict { verdict: 'allowed' | 'refused'; reasonClass: string; rule: string | null; path: string; message: string | null }

/**
 * One path, judged, never throwing.
 *
 * `judgePaths` takes and returns an ARRAY — reading `.verdict` off the array itself would be
 * `undefined`, which is falsy, which is a fence that is silently off while every test still passes.
 * Destructured here once so no call site can get it wrong.
 *
 * It throws only on argument shape, never on path content — but a throw inside `capture` would escape
 * before the tree is put back, so it is caught and read as a refusal. A judge that cannot answer is
 * not a judge that says yes.
 */
function judgeOne(rel: string): Verdict {
  try {
    const [v] = judgePaths(repoRoot(), [rel]) as Verdict[];
    if (v) return v;
    return { verdict: 'refused', reasonClass: 'guard:no-verdict', rule: null, path: rel, message: 'the judge returned no verdict for this path' };
  } catch (e) {
    return {
      verdict: 'refused', reasonClass: 'guard:judge-threw', rule: null, path: rel,
      message: `the path judge could not answer for ${rel}: ${String((e as Error)?.message ?? e).slice(0, 120)}`,
    };
  }
}

/** How a refusal says its own name — to the ledger's `reason`, and to the owner through the door. */
const refusalOf = (v: Verdict) => ({ path: v.path, reasonClass: v.reasonClass, rule: v.rule, message: v.message ?? v.reasonClass });

/**
 * What this file held before the round — the owner's version, and the only thing a refusal can put back.
 *
 * THE INDEX, NOT HEAD — and this cost a file.
 *
 * MEASURED: the owner ran `git add` on a new file and had not committed it. That file is in the index
 * and not in HEAD, and `git add` leaves it CLEAN, so it is not in crush's pre-run snapshot either.
 * `git show HEAD:<path>` failed, `before` became null — and null is not "unknown" to restore() and
 * rollback(), it means "this file did not exist", so capture UNLINKED it. His staged work disappeared
 * from the working tree during a proposal he had not answered yet, while the surface told him nothing
 * had changed on disk.
 *
 * The index is the exact answer, not a safer guess: a file that was not dirty when the round started
 * had a working copy identical to its index copy by definition. HEAD is the same thing only when
 * nothing is staged, which is the case this got wrong.
 *
 * Extracted from the middle of `capture` so a refused path recovers by the SAME ladder a captured one
 * does. Two ladders would eventually disagree, and the one in the refusal branch is the one nobody
 * would notice had drifted.
 */
/**
 * PUT THE WHOLE ROUND BACK — every file it touched, not the ones the loop happened to reach.
 *
 * ══ THE BUG THIS EXISTS FOR, WHICH WAS IN THE FIRST DRAFT OF THIS VERY FENCE ══
 *
 * The refusal branches used to call `restore(files)`, where `files` is the accumulator the capture
 * loops push into. That is correct only for a refusal that fires on the LAST path. Refuse on the
 * first one and `files` is still empty: `restore` is a no-op, every later modified file keeps the
 * engine's version, the created loop never runs at all, and none of it is in the proposal — so there
 * is no id to roll back and no receipt naming what was left behind. The owner is told about one file
 * while a second one is quietly still changed.
 *
 * MEASURED, against the first draft, with `secrets/key.txt` refused first:
 *
 *     capture(['secrets/key.txt', 'notes/a.txt'], …)  =>  { refused: 'secrets/key.txt' }
 *     notes/a.txt  =  'ENGINE WROTE THIS'      <- the owner's uncommitted work, gone
 *
 * `changed` comes from `git diff --name-only`, which is path-SORTED, so which side of a refusal a
 * file falls on is decided by its NAME. The test that was supposed to cover this passed because it
 * happened to list the innocent file first.
 *
 * ══ RESTORING IS ALWAYS SAFER THAN NOT RESTORING ══
 *
 * The first draft also declined to restore anything the judge had called outside-repo, reasoning that
 * φ should not write outside the boundary it enforces. That is backwards, and it made the fence worse
 * than no fence for exactly the path it was proudest of catching: the write has ALREADY happened —
 * crush followed the link before capture was ever called — so declining to undo it leaves the escaped
 * payload at the far end of the link permanently, which is the attack succeeding. The pre-change code
 * put it back, because its check was lexical and the in-repo name travelled the normal road.
 *
 * So: a modified file is always written back to what it was. That is a pure inverse of a write that
 * already landed, and it can only ever move bytes toward the state the owner had.
 *
 * Removal is the asymmetric one, and it is the only thing held back. A creation is undone by DELETING,
 * which is not reversible and is not a claim this function can make about a location the judge just
 * said it cannot reason about. So a created path that resolves outside the repository, or that cannot
 * be resolved at all, keeps its bytes and its name reaches the owner instead.
 */
async function restoreRound(tracked: string[], created: string[], pre: Map<string, string>): Promise<void> {
  for (const rel of tracked) {
    const was = await priorContent(rel, pre);
    // Nothing could say what this file was, so there is nothing to put back. It keeps whatever the
    // round wrote, which is visible and recoverable; a guess would not be.
    if (was === null) continue;
    try { await writeFile(path.resolve(repoRoot(), rel), was, 'utf8'); } catch { /* named in the receipt either way */ }
  }
  for (const rel of created) {
    const v = judgeOne(rel);
    if (v.reasonClass === 'law:outside-repo' || v.reasonClass === 'guard:unresolvable-path'
        || v.reasonClass === 'law:repository-root') continue;
    try { await unlink(path.resolve(repoRoot(), rel)); } catch { /* already gone, which is the goal */ }
  }
}

async function priorContent(rel: string, pre: Map<string, string>): Promise<string | null> {
  const snap = pre.get(rel);
  if (snap !== undefined) return snap;
  const idx = await run('git', ['show', `:${rel}`]);
  if (idx.code === 0) return idx.out;
  const head = await run('git', ['show', `HEAD:${rel}`]);
  if (head.code === 0) return head.out;
  return null;
}

function run(cmd: string, args: string[], stdin?: string, opts: { cwd?: string; timeoutMs?: number } = {}): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: opts.cwd ?? repoRoot() });
    const timer = opts.timeoutMs
      ? setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* already gone */ } }, opts.timeoutMs)
      : null;
    p.on('close', () => { if (timer) clearTimeout(timer); });
    let out = '';
    p.stdout.on('data', (b: Buffer) => { out += b.toString(); });
    p.stderr.on('data', (b: Buffer) => { out += b.toString(); });
    if (stdin !== undefined) { p.stdin.write(stdin); p.stdin.end(); }
    p.on('close', (code) => resolve({ code: code ?? -1, out }));
    p.on('error', (e) => resolve({ code: -1, out: String(e) }));
  });
}

export interface Proposal {
  id: string;
  at: number;
  /**
   * The change, as content rather than as a patch.
   *
   * The first version stored `git diff` output and applied it with `git apply`. That is wrong here and
   * it failed on the first real test: `git diff` compares the working tree to HEAD, so when the owner
   * already had uncommitted work in a file the patch carried HIS edits as context — and once the tree
   * was restored for review, the patch no longer matched and every apply refused.
   *
   * before/after is exact and has no context to go stale: apply verifies the file is still byte-for-byte
   * what it was when the proposal was made, and writes the new content. A file that moved underneath is
   * refused for the right reason rather than by accident of diff context.
   */
  files: { path: string; before: string | null; after: string }[];
  /** For display only — never used to apply. */
  patch: string;
  changed: string[];
  diffstat: string;
  digest: string;
  /**
   * THE BYTE BINDING. `computeProposalHash(id, files)` over this proposal's id and every file's path
   * plus a hash of its exact content — see `core/forge/proposalHash.ts`. `digest` above is the SHORT
   * form a person compares by eye and is what the receipts carry; this is the full form an approval is
   * checked against, kept separate because the two answer different questions.
   */
  proposalHash: string;
  tests: TestVerdict;
  ms: { tests: number; capture: number };
}

/**
 * What the tests said about this change.
 *
 * `none` is a distinct answer from `passed` and the distinction is the whole point. Most files under
 * spatial/app/ have no test importing them, and reporting "tests passed" for a file nothing tests
 * would be the most dangerous sentence this surface could say — a green light generated by absence.
 *
 * `errored` is a SEPARATE answer from `failed`, and confusing them is its own dangerous sentence in the
 * other direction: `failed` means the gate ran and named real red tests; `errored` means the gate itself
 * could not produce a verdict — missing, timed out, or closed for a reason that names no specific test
 * (a hollow suite, a file that threw on import). Reporting that as `failed` with an invented test name
 * would tell the owner THIS BREAKS A TEST when no such test exists; reporting it as `passed` would be
 * the false green this whole type exists to refuse. `why` carries what actually happened, undressed.
 */
export type TestVerdict =
  | { state: 'passed'; files: number; tests: number }
  /** `tests` is the fail count — never the suite size. `names` is what actually went red. */
  | { state: 'failed'; files: number; tests: number; names: string[]; detail: string }
  | { state: 'none' }
  | { state: 'skipped'; why: string }
  | { state: 'errored'; why: string };

/**
 * Server-lane paths: code held in the running door process, not hot-swapped by a page reload.
 *
 * surface/*.ts, anything under core/, scripts/*.ts — a browser module under surface/app/ is not among them.
 */
export function needsDoorRestart(paths: string[]): boolean {
  return paths.some((p) =>
    /^surface\/[^/]+\.ts$/.test(p)
    || p.startsWith('core/')
    || /^scripts\/[^/]+\.ts$/.test(p)
  );
}

/**
 * Names of tests bun marked as failing — the only honest input for THIS BREAKS.
 *
 * MEASURED, and it was wrong from the day it was written: this looked for a line starting with `✗`,
 * which is the glyph `bun test` draws only when its output is a real TTY. Every call in this file spawns
 * bun over a PIPE — no terminal — and `bun test` uses a plain-text marker there instead:
 *
 *     (fail) a deliberately failing test [0.17ms]
 *
 * So on every real round this regex matched nothing, `names` came back `[]`, and a failing gate reported
 * `tests: 1, names: []` — a red card with no names on it, in the one place names were the point. Verified
 * by hand: a piped `bun test` run against a single failing case never once emits `✗`.
 *
 * `✗` is kept as a second alternative rather than replaced outright — a future bun version, or a `-H`
 * server route, could plausibly attach a real TTY, and a name silently missed there would be the same
 * defect back in different clothes.
 */
function failingTestNames(out: string): string[] {
  const plain = out.replace(/\x1b\[[0-9;]*m/g, '');
  const names: string[] = [];
  for (const line of plain.split('\n')) {
    const m = /^(?:✗|\(fail\))\s+(.+?)(?:\s+\[[\d.]+\s*m?s\])?\s*$/.exec(line.trim());
    if (m?.[1]) names.push(m[1].trim());
  }
  return names;
}

/**
 * Proposals live in memory only, and only until decided.
 *
 * A restart drops them, which is correct: an undecided proposal is a question that was never answered,
 * and resurrecting one after a restart would offer to apply a diff against a tree that has moved.
 */
const proposals = new Map<string, Proposal>();

/**
 * A DECLARED TEST SEAM, rather than fighting the module cache.
 *
 * The donor's tests reached for `vi.resetModules()` to get a clean store per case, which works and
 * hides what is happening: the thing under test is module-level state. Saying so out loud is better
 * than re-importing a module to pretend otherwise, and it is the only way to do it under `bun:test`,
 * which has no module reset. Exported deliberately and used by nothing but the suite.
 */
export function __resetForTests(): void { proposals.clear(); applied.clear(); applying.clear(); }
const PROPOSAL_CAP = 12;

/**
 * Proposals that were APPLIED, kept so each one can be rolled back to its own before-state.
 *
 * Rollback used to go through forgeLane.rewind(paths), which restores from a single module-level
 * pre-run snapshot that is CLEARED at the start of every run. With one change that is indistinguishable
 * from correct. With two changes to the same file it is silently wrong: undoing the first restores the
 * snapshot taken before the SECOND, so the first change survives its own undo — and pressing undo again
 * restores the same point and changes nothing. Measured exactly that: two style.css changes, two undos,
 * and the first change still on disk.
 *
 * An undo has to know which change it is undoing. That is a property of the proposal, not of whatever
 * the forge happened to run most recently.
 */
const applied = new Map<string, Proposal>();
const APPLIED_CAP = 24;

/**
 * IDs currently mid-`apply()` — claimed BEFORE the first `await`, so two concurrent calls can never
 * both pass the check.
 *
 * MEASURED: two concurrent `POST /api/forge/apply` requests for the same proposal id both read the
 * same `proposals.get(id)` (nothing has deleted it yet — that happens only after every file is
 * written), both pass the disk-drift check against the same untouched tree, and both proceed to
 * `writeFile` the same bytes — one accepted click replayed into two writes and two `applied` receipts,
 * because nothing stood between "read the proposal" and "write it" that a second, concurrent reader of
 * the SAME id would see.
 *
 * A `Set`, not a boolean on the `Proposal` itself, because `apply()` reads its `Proposal` off a plain
 * object (`proposals.get(id)`) that a second call reads too — a flag written onto that object is the
 * same mutable-shared-state hazard the write-plan snapshot above exists to avoid, just moved one field
 * over. This lives beside the store instead, checked and claimed synchronously, in the same
 * check-and-set style as `forgeRoundLive` in `surface/door.ts` (see that flag's own note for why
 * synchronous is the whole of the guarantee: JS does not preempt between two statements with no
 * `await` between them, so "is it claimed" and "claim it" happen as one indivisible step no second
 * concurrent call can land inside).
 *
 * Released in `apply()`'s `finally`, whatever the outcome — a proposal that failed a refusable check
 * (a hash mismatch, a moved file, a law refusal) STAYS in `proposals` and the owner is meant to be able
 * to try again; permanently holding the lock after a refusal would make every retry answer
 * `apply_in_flight` forever over a request that has already finished.
 */
const applying = new Set<string>();

export function getProposal(id: string): Proposal | undefined { return proposals.get(id); }

/**
 * The pre-change content of the most recently applied change.
 *
 * Used to arm dead-door recovery before a restart: if the door that boots on this change never
 * answers, this is the state that is known to have worked.
 */
export function lastAppliedSnapshot(): { path: string; before: string | null }[] | null {
  const ids = [...applied.keys()];
  const last = ids[ids.length - 1];
  if (!last) return null;
  const p = applied.get(last);
  return p ? p.files.map((f) => ({ path: f.path, before: f.before })) : null;
}

/**
 * Capture the current working-tree change as a proposal and PUT THE TREE BACK.
 *
 * `pre` is the pre-run content of files that were already dirty — the same snapshot rewind uses. Those
 * files are restored to the owner's version; everything else the run touched goes back to HEAD.
 */
export async function capture(changed: string[], created: string[], diffstat: string, pre: Map<string, string>): Promise<Proposal | null> {
  const tCapture = Date.now();
  const tracked = changed.filter((f) => !created.includes(f));
  if (!tracked.length && !created.length) return null;
  /** Everything this round touched — what a refusal names in the ledger, like `refused-unparseable`. */
  const roundFiles = [...new Set([...changed, ...created])];

  const files: { path: string; before: string | null; after: string }[] = [];

  // Modified files: `before` is the owner's own pre-run version when he had one, otherwise the INDEX's.
  for (const rel of tracked) {
    const abs = path.resolve(repoRoot(), rel);
    // THE JUDGE, BEFORE THIS FUNCTION TOUCHES THE FILE AT ALL.
    //
    // What stood here was `if (!abs.startsWith(repoRoot() + path.sep)) continue;` — the whole of this
    // seam's path policy, and a bare `continue` for anything it caught. Two things were wrong with it
    // at once. It knew nothing about the law: a protected file reached under an innocent name, a hard
    // link to a ring-0 file, a symlinked parent — all of them started with the repo root and all of
    // them sailed through. And when it did stop something, it stopped it SILENTLY: no receipt, no
    // named refusal, and when the dropped path was the only one, `files` came back empty and this
    // function returned a bare `null` — which the door renders to the owner as "nothing changed on
    // disk", over a round that was stopped on purpose. The ledger could not tell a drop from a
    // refusal, which is the one distinction a ledger exists to make.
    const v = judgeOne(rel);
    if (v.verdict === 'refused') {
      // THE WHOLE ROUND GOES BACK, not the part of it this loop had reached. A refusal that leaves
      // the engine's bytes on disk is not a refusal, it is a change with a disapproving message
      // attached — and that is true of every file the round touched, not only the offending one.
      await restoreRound(tracked, created, pre);
      await receipt({ kind: 'refused-path', id: '-', files: roundFiles, digest: '-', reason: `${v.reasonClass} ${rel}`.slice(0, 190) });
      return { refused: refusalOf(v) } as unknown as Proposal;
    }
    let after = '';
    // A DELETION IS A CHANGE. This read `catch { continue; }`, which dropped a file the engine had
    // DELETED — so `files` came back empty, capture returned null, and the door answered
    // "nothing changed on disk" while the file was gone. No proposal, no receipt, no rollback, and the
    // surface stating a falsehood the owner would act on. Measured:
    //
    //     forge() => { ok: true, changed: ['keep.txt'], diffstat: ' keep.txt | 3 ---' }
    //     capture() => null   →   door: { note: 'nothing changed on disk' }
    //     AFTER: keep.txt exists = false
    //
    // A deletion that travelled the normal road would need `after: null` understood by apply, restore
    // AND rollback — a change to the undo-critical path, and this file's own history records what
    // happens when that path is edited in a hurry.
    //
    // FULL DELETION SUPPORT — an `after: null` travelling through apply/restore/rollback — is a change
    // to the undo-critical path, and this file's own history says what happens when that path is edited
    // in a hurry. So the minimal honest thing instead: put his file BACK and refuse the round by name.
    // He is told the truth, nothing is lost, and nobody is offered a card that cannot be undone.
    let vanished = false;
    try { after = await readFile(abs, 'utf8'); } catch { vanished = true; }
    if (vanished) {
      const snap = pre.get(rel);
      const wasThere = snap !== undefined ? snap
        : await run('git', ['show', `HEAD:${rel}`]).then((r) => (r.code === 0 ? r.out : null));
      if (wasThere === null || wasThere === undefined) continue;   // never existed: nothing was deleted
      try { await writeFile(abs, wasThere, 'utf8'); } catch { /* reported below either way */ }
      await restore(files);
      // ITS OWN KIND, and it was not one. This wrote `refused-unparseable`, which
      // `surface/app/record.js` labels "refused · would not parse" — and a deleted file parsed fine.
      // `test/receipts.test.ts` already states the rule this was breaking, in the note explaining why
      // `refused-path` is not a `reason` on `refused-unparseable`: a refusal wearing another refusal's
      // label "would state a false reason for the refusal in the owner's own record".
      await receipt({ kind: 'refused-deleted', id: '-', files: changed, digest: '-', reason: `deleted:${rel}` });
      return { deletedFile: { path: rel, restored: true } } as unknown as Proposal;
    }
    const before = await priorContent(rel, pre);
    // Nothing could say what this file was. `before: null` would be a standing instruction to delete
    // it — restore() unlinks on null and so does rollback() — so the file is left out of the proposal
    // instead. It keeps whatever the round wrote, which is visible and recoverable; a deletion is not.
    // Unreachable from the live loop, where `changed` comes from `git diff` and is therefore always in
    // the index; it is here because the alternative to being sure is destroying a file.
    if (before === null) continue;
    files.push({ path: rel, before, after });
  }
  // Created files have no before at all, which is exactly what `null` means here.
  for (const rel of created) {
    const abs = path.resolve(repoRoot(), rel);
    // CAPTURE IS NOT OPTIONAL, AND THIS LOOP IS HALF THE SCORE.
    //
    // The same `continue` stood here, and dropping a path HERE is worse than dropping it in apply:
    // apply never sees a file capture declined to carry, so a path let go at this line is a path that
    // never reaches any later check. Two of the four conformance cases this wiring closes —
    // 03-dangling-symlink and 11-empty-segment-glob — arrive as CREATED files and turn on this line
    // alone. Judging only the modified loop above scores 5 of 12, not 7. MEASURED, case by case.
    //
    // A path that does not exist yet is first-class to the judge: `analyse` walks up to the deepest
    // ancestor that DOES exist, and the inode check reports "nothing there yet" rather than failing.
    // So a new file is judged on its name and its resolved parent, which is exactly right — `new.pem`
    // and `secrets/anything` are refused on the way in, and an ordinary new file is not.
    const v = judgeOne(rel);
    if (v.verdict === 'refused') {
      // Same whole-round undo as the loop above. The modified files were restored there or here; the
      // created ones are removed, except where removal is a claim the judge has said it cannot make.
      await restoreRound(tracked, created, pre);
      await receipt({ kind: 'refused-path', id: '-', files: roundFiles, digest: '-', reason: `${v.reasonClass} ${rel}`.slice(0, 190) });
      return { refused: refusalOf(v) } as unknown as Proposal;
    }
    try { files.push({ path: rel, before: null, after: await readFile(abs, 'utf8') }); } catch { /* vanished */ }
  }
  if (!files.length) return null;

  // THE SYNTAX GATE. The in-page safety net can undo a change that breaks an organ while the app is
  // running, but it cannot help with a file the shell STATICALLY IMPORTS: a syntax error there takes
  // the whole application down at page load, before any net exists to catch it. Proven by deliberately
  // breaking unfold.js — the shell never ran at all. So a file that does not parse is never offered.
  // In-process and instant; this must not add a second to a round the owner is watching.
  const broken = await firstUnparseable(files);
  if (broken) {
    // Put the tree back before refusing, or a rejected proposal leaves the breakage on disk.
    await restore(files);
    await receipt({ kind: 'refused-unparseable', id: '-', files: changed, digest: '-', reason: broken.path });
    return { unparseable: broken } as unknown as Proposal;
  }

  // THE TESTS RUN WHILE THE CHANGE IS STILL ON DISK — the only moment they can.
  const tTests = Date.now();
  // Hosted glass: skip the full suite gate so a UI edit lands in seconds, not a half-minute of
  // bun test noise. Local sovereign nodes still run the gate. Force with AUKORA_TEST_GATE=1.
  const skipGate = process.env.AUKORA_HOSTED === '1' && process.env.AUKORA_TEST_GATE !== '1';
  const tests = skipGate
    ? { state: 'none' as const, why: 'hosted glass — suite gate off; accept/undo still receipted' }
    : await runTestGate();
  const testsMs = Date.now() - tTests;

  // A CHANGE TOO LARGE TO READ IS NOT OFFERED. renderDiff no longer truncates, because a patch that
  // omits a line the owner then approves is the first law broken — a click on a document that hides
  // what will be written is not consent to what will be written. When a change exceeds what can be
  // rendered in full, the honest answer is to decline to make it acceptable rather than to abridge it.
  let patch: string;
  try {
    patch = files.map((f) => renderDiff(f.path, f.before, f.after)).join('\n');
  } catch (e) {
    if (e instanceof DiffTooLarge) {
      await restore(files);
      // THE ONE REFUSAL IN THIS FILE THAT WROTE NOTHING DOWN. Every other one — `refused-path`,
      // `refused-unparseable`, `refused-deleted`, `apply-refused` — leaves a row, and this left the
      // ledger reading as though the round had simply never happened. It is a decision φ made about the
      // owner's tree (the engine wrote, the gate declined to offer it, the bytes were rolled back), and
      // the point of the ledger is that the REFUSALS are in it. Content-free like the rest: which file,
      // how many lines, nothing of what they said.
      await receipt({ kind: 'refused-unreviewable', id: '-', files: changed, digest: '-', reason: `unreviewable:${e.rel}:${e.lines}` });
      return { unreviewable: { path: e.rel, lines: e.lines } } as unknown as Proposal;
    }
    throw e;
  }

  // THE SAME LAW, AT THE CEILING THE GLASS ACTUALLY HAS. `DiffTooLarge` above bounds ONE FILE by line
  // count; this bounds the WHOLE PATCH by character count, at the exact number `slimProposal` (in
  // surface/door.ts) uses to keep the SSE stream from freezing the browser on a full-file rewrite. A
  // patch under every per-file line ceiling can still join into hundreds of kilobytes once several
  // files or one long-lined file are concatenated — a minified bundle, a base64 blob, one JSON fixture
  // on one line — and until this check existed, THAT patch reached the owner sliced to
  // `MAX_REVIEWABLE_CHARS` for display while `capture()` still returned the FULL, untruncated
  // `files[].before/after` in the same proposal — the exact bytes `apply()` writes on accept. The click
  // approved a document that ended at the fold; the write did not stop there. See
  // `MAX_REVIEWABLE_CHARS`'s own doc in ./renderDiff for the full account.
  if (patch.length > MAX_REVIEWABLE_CHARS) {
    await restore(files);
    await receipt({
      kind: 'refused-unreviewable', id: '-', files: changed, digest: '-',
      reason: `unreviewable:chars:${patch.length}`,
    });
    return { unreviewable: { path: files.length === 1 ? files[0]!.path : `${files.length} files`, chars: patch.length } } as unknown as Proposal;
  }

  // PUT IT BACK. This is the line that makes the gate real rather than advisory.
  await restore(files);

  const digest = createHash('sha256').update(files.map((f) => f.path + '\u0000' + f.after).join('\u0001')).digest('hex').slice(0, 16);
  const id = 'p_' + Date.now().toString(36) + '_' + digest.slice(0, 6);
  // THE BYTE BINDING, computed once here from the exact content this proposal holds — see the field's
  // own doc on `Proposal` for what it is checked against and why it is not `digest`.
  const proposalHash = computeProposalHash(id, files.map((f) => ({ relPath: f.path, content: f.after })));
  // Where the round went. Kept because "it takes about half a minute" is not a thing anyone can act
  // on, and the answer turned out not to be where it was assumed to be.
  const proposal: Proposal = { id, at: Date.now(), files, patch, changed, diffstat, digest, proposalHash, tests,
    ms: { tests: testsMs, capture: Date.now() - tCapture - testsMs } };

  proposals.set(id, proposal);
  await expireStale();
  while (proposals.size > PROPOSAL_CAP) {
    const oldest = [...proposals.keys()][0];
    if (oldest === undefined) break;
    const dropped = proposals.get(oldest);
    proposals.delete(oldest);
    // The same event `expireStale` records, with a different cause. A proposal pushed out by the cap
    // left NO row at all, so the ledger showed a question with no answer while the store had already
    // thrown it away — the exact dishonesty the TTL path above exists to avoid, in the one place that
    // is reached by working fast rather than by walking away. `expired` rather than a new kind: the
    // terminal fact is identical, and `reason` is where the difference belongs.
    if (dropped) {
      await receipt({ kind: 'expired', id: oldest, files: dropped.changed, digest: dropped.digest,
        reason: `pushed out by the ${PROPOSAL_CAP}-proposal cap` });
    }
  }
  await receipt({ kind: 'proposed', id, files: changed, digest });

  // ══ THE ROUND REMEMBERS ITSELF ══
  //
  // Her gap, in her words: "working-memory gives me the last apply's files. Not the gate result, not
  // the diff, not whether it landed. So I can start a round and cannot properly iterate on it next
  // turn." This is where the first two of those facts exist, so this is where they are written down.
  //
  // BREATH-SIDE, content-free, and never fatal: `surface/round-memory.ts` cannot throw, and a round
  // that cannot record itself still returns its proposal. A memory is worth having and is not worth
  // a card.
  try {
    const mem = await import('../../surface/round-memory');
    await mem.noteProposed({ id, files: changed, created: created.length });
    await mem.noteGate({
      id,
      state: tests.state === 'passed' ? 'passed' : tests.state === 'failed' ? 'failed' : 'errored',
      // TEST NAMES are verdicts, not contents — the same line the ledger draws.
      failing: 'names' in tests && Array.isArray(tests.names) ? tests.names : [],
      ...('tests' in tests && typeof tests.tests === 'number'
        ? { counts: { pass: Math.max(0, tests.tests - ('names' in tests ? tests.names.length : 0)), fail: 'names' in tests ? tests.names.length : 0, skip: 0 } }
        : {}),
    });
  } catch { /* a round that cannot remember itself is still a round */ }

  return proposal;
}

/**
 * WHAT `capture()` ACTUALLY RETURNED — read once, in one place, with a floor under it.
 *
 * ══ THE DEFECT THIS EXISTS FOR ══
 *
 * `capture()` is declared `Promise<Proposal | null>` and returns FIVE things: a real proposal, `null`,
 * and three refusals cast through `as unknown as Proposal` so the signature does not have to change.
 * None of the three carries an `id`. `surface/door.ts` read them by hand, at two separate call sites,
 * with a ladder of `(proposal as unknown as { … }).x` checks — and the two ladders were never the same
 * length. Both knew `unparseable`, both later learned `refused`, and NEITHER has ever known
 * `deletedFile` or `unreviewable`. So a round that deleted a file, and a round too large to render, both
 * fell past the ladder into `slimProposal(proposal)`. MEASURED, against a real door:
 *
 *     POST /api/forge         200  {"ok":true,"proposal":{"deletedFile":{"path":"tracked.txt", …}}}
 *     POST /api/forge/stream       data: {"t":"proposal","proposal":{"patch":"","files":[]}}
 *
 * An `ok: true` proposal card with no id. Accept posts an empty id to `/api/forge/apply` and gets
 * `proposal_unknown_or_expired`; discard does the same; the card can never resolve. On the SSE side
 * `slimProposal` strips it to `{"patch":"","files":[]}` and the browser throws on `p.changed.length`
 * before the owner sees anything at all — so the one thing he is told about a refusal is a stack trace's
 * worth of nothing.
 *
 * ══ WHY A FUNCTION HERE, AND NOT TWO MORE BRANCHES THERE ══
 *
 * Two more branches at each site fixes today and rebuilds the trap: the next shape added to `capture()`
 * has to be remembered at two call sites in another file, by someone who is editing neither. This module
 * is where the shapes are MADE, so it is the only place that can be trusted to know all of them.
 *
 * And the last check is the one that matters after this round of names is forgotten: a shape that
 * matches nothing above and has no `id` is refused as `proposal-without-id` rather than passed on. `id`
 * is what apply, discard and rollback all key off — a card without one is dead on arrival whatever it is
 * called, so there is no shape this can wrongly refuse. A sixth return added tomorrow reaches the owner
 * as a named refusal on the day it is written, not as a card he clicks at forever.
 *
 * `kind` doubles as the wire name the door sends as `error`, so the surface has one vocabulary rather
 * than a second translation table to keep in step.
 */
export type CaptureOutcome =
  | { kind: 'proposal'; proposal: Proposal }
  /** Nothing changed on disk. Not a failure — a question answered, or a round that touched nothing. */
  | { kind: 'nothing' }
  | { kind: 'refused-path'; file: string; detail: string }
  | { kind: 'unparseable'; file: string; detail: string }
  | { kind: 'deleted-file'; file: string; detail: string }
  | { kind: 'unreviewable'; file: string; detail: string }
  | { kind: 'proposal-without-id'; file: string; detail: string };

export function readCapture(raw: Proposal | null): CaptureOutcome {
  if (!raw) return { kind: 'nothing' };
  // The casts `capture()` makes on the way out, undone in the one place that can account for all of
  // them. Every field is optional because the whole point is reading a shape this function may be wrong
  // about — a `.path` assumed and absent would put `undefined` in front of the owner.
  const shape = raw as unknown as {
    id?: string;
    refused?: { path?: string; message?: string; reasonClass?: string };
    unparseable?: { path?: string; error?: string };
    deletedFile?: { path?: string; restored?: boolean };
    unreviewable?: { path?: string; lines?: number; chars?: number };
  };

  if (shape.refused) {
    const r = shape.refused;
    return { kind: 'refused-path', file: r.path ?? '', detail: r.message ?? r.reasonClass ?? 'the law refused this path' };
  }
  if (shape.unparseable) {
    const u = shape.unparseable;
    return { kind: 'unparseable', file: u.path ?? '', detail: u.error ?? 'the file would not parse' };
  }
  if (shape.deletedFile) {
    const d = shape.deletedFile;
    // Said as what happened to HIS file, because that is the only part he has to act on. `restored` is
    // read rather than assumed: capture's write-back can fail, and a sentence promising the file is back
    // when it is not would be the worst thing this refusal could say.
    return {
      kind: 'deleted-file',
      file: d.path ?? '',
      detail: d.restored === false
        ? `this round deleted ${d.path ?? 'a tracked file'} AND IT COULD NOT BE PUT BACK — nothing was offered for review`
        : `this round deleted ${d.path ?? 'a tracked file'}; it has been put back and the change was not offered — the review gate cannot carry a deletion yet`,
    };
  }
  if (shape.unreviewable) {
    const v = shape.unreviewable;
    return {
      kind: 'unreviewable',
      file: v.path ?? '',
      // `chars` names the whole-patch ceiling (MAX_REVIEWABLE_CHARS, ./renderDiff); `lines` names the
      // older per-file ceiling (DiffTooLarge). Checked in that order because a round that manages to
      // trip both at once is still, first and foremost, too big to have shown the owner in full.
      detail: v.chars !== undefined
        ? `this change is ${v.chars} characters — too large to display in full, and a diff that hides what will be written is not something to click accept on`
        : `${v.path ?? 'that file'} changes ${v.lines ?? 'too many'} lines — too large to render in full, and a diff that hides what will be written is not something to click accept on`,
    };
  }
  // THE FLOOR. See the note above: no id, no card, whatever it turned out to be.
  if (!shape.id) {
    return {
      kind: 'proposal-without-id',
      file: '',
      detail: `the review gate returned a result this door does not recognise (${Object.keys(shape).slice(0, 6).join(', ') || 'no fields at all'}) and it carries no id, so it was not offered`,
    };
  }
  return { kind: 'proposal', proposal: raw };
}

/**
 * Bounded ceiling on the gate run below.
 *
 * A round the owner is watching cannot hang forever on one bad instruction, and the gate is spawned a
 * second time inside `capture()` on top of whatever the engine itself already spent — so this needs its
 * own leash rather than trusting the caller's. `FORGE_TIMEOUT_MS` in crush.ts (360_000, three-to-six
 * minutes for a real edit) is the neighbourhood, not the number: that ceiling bounds a MODEL composing
 * and writing a change, which is open-ended by nature, while this bounds a fixed, deterministic
 * `bun test` run whose size is the repository's own suite. Measured on this machine: the full 38-suite,
 * ~555-test gate finishes in well under 35 seconds. 150 seconds is over four times that measured cost
 * and a small fraction of `FORGE_TIMEOUT_MS`, so a gate that is still running past it is not "a slow
 * suite" — it is stuck, and the honest answer is `errored`, not a round that never returns.
 */
const GATE_TIMEOUT_MS = 150_000;

/**
 * Spawn `bun run scripts/gate.ts` and resolve to exactly what happened — never a guess dressed as one
 * of the other two.
 *
 * A DEDICATED SPAWN rather than the shared `run()` helper above: `run()`'s timeout kills the child and
 * then waits for the SAME `close` event a normal exit produces, so a killed process and a process that
 * happened to exit with code -1 on its own are indistinguishable from its return value alone. That
 * collapse is fine for the git plumbing `run()` exists for — nothing there needs to tell "timed out"
 * from "failed" — but it is exactly the distinction a test verdict must not blur: reporting a timeout as
 * a normal failed run would let a stuck gate masquerade as `state: 'failed'` with an empty names list,
 * which is the same "accusation with nothing to point at" this file already removed once above.
 */
function runGateProcess(cwd: string, timeoutMs: number): Promise<
  | { kind: 'ok'; code: number; out: string }
  | { kind: 'timeout' }
  | { kind: 'spawn-error'; message: string }
> {
  return new Promise((resolve) => {
    let settled = false;
    let out = '';
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('bun', ['run', 'scripts/gate.ts'], { cwd });
    } catch (e) {
      resolve({ kind: 'spawn-error', message: String((e as Error)?.message ?? e) });
      return;
    }
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      resolve({ kind: 'timeout' });
    }, timeoutMs);
    child.stdout?.on('data', (b: Buffer) => { if (out.length < 200_000) out += b.toString(); });
    child.stderr?.on('data', (b: Buffer) => { if (out.length < 200_000) out += b.toString(); });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ kind: 'ok', code: code ?? -1, out });
    });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ kind: 'spawn-error', message: String((e as Error)?.message ?? e) });
    });
  });
}

/**
 * THE REAL GATE, RUN FOR REAL — `bun run scripts/gate.ts`, the exact command AGENTS.md names as "the
 * gate decides, not you", not a private re-implementation of what it does.
 *
 * ══ WHAT THIS REPLACES, AND WHY IT WAS WRONG TWICE ══
 *
 * The card the owner reads has always claimed a `tests` field, and it was wrong in two different ways
 * before this. First it shelled out to `bunx vitest related` with a `cwd` that does not exist in this
 * repository, so every proposal came back `{ state: 'none' }` — a verdict fabricated by absence,
 * documented in this file's own git history. That was fixed by calling `bun test` directly, which is
 * correct in spirit but answers a NARROWER question than the one the owner actually has: `bun test`
 * alone reports pass/fail counts and nothing about whether every suite on disk actually ran — the exact
 * gap `scripts/gate.ts` exists to close (a `describe.skip`'d whole suite, or a file that silently failed
 * to load, prints a healthy-looking summary either way). φ has ONE gate, named in AGENTS.md as the thing
 * "the owner has to manually run... himself after accepting a change to find out if it broke anything" —
 * so the card should say what that same command would say, not a second opinion that can disagree with
 * it.
 *
 * ══ NEVER BLOCKS, NEVER LIES ══
 *
 * This decorates the proposal; it does not gate whether one is captured. A red run is not a refusal
 * (LAW.md §1 — the owner decides), and a run that could not be judged at all — the script missing, the
 * process erroring, the ceiling above expiring — is reported as `errored` with why, never silently
 * folded into `passed` (a false green) or `failed` (an accusation naming a test that was never actually
 * seen to fail).
 */
async function runTestGate(): Promise<TestVerdict> {
  const gatePath = path.join(repoRoot(), 'scripts', 'gate.ts');
  if (!existsSync(gatePath)) {
    return { state: 'errored', why: 'scripts/gate.ts is missing from this working tree — nothing was run' };
  }

  const r = await runGateProcess(repoRoot(), GATE_TIMEOUT_MS);
  if (r.kind === 'timeout') {
    return { state: 'errored', why: `the gate did not finish within ${Math.round(GATE_TIMEOUT_MS / 1000)}s and was killed` };
  }
  if (r.kind === 'spawn-error') {
    return { state: 'errored', why: `the gate could not be started: ${r.message.slice(0, 200)}` };
  }

  const out = r.out;
  const passed = Number(/(\d+)\s+pass\b/.exec(out)?.[1] ?? 0);
  const failed = Number(/(\d+)\s+fail\b/.exec(out)?.[1] ?? 0);
  // `bun test`'s own summary line ("Ran N tests across M files") and the gate's closing banner ("…
  // across M suite(s)…") name the same number in different words; either is an honest file count.
  const fileCount = Number(/across\s+(\d+)\s+(?:files?|suites?)/.exec(out)?.[1] ?? 0);

  if (failed > 0) {
    // `tests` used to be passed+failed — the whole suite — so one red case said THIS BREAKS 554 TESTS.
    // The number the owner needs is how many failed, and their names; the suite size is noise.
    const names = failingTestNames(out);
    return { state: 'failed', files: fileCount, tests: failed || names.length || 1, names, detail: out.slice(-1400) };
  }
  if (r.code === 0) {
    if (!passed) return { state: 'skipped', why: 'the gate produced no result' };
    // Said precisely: the SUITE passes with this change applied. Not "tests cover this file" — nothing
    // here establishes that, and implying it would be the manufactured green tick again.
    return { state: 'passed', files: fileCount, tests: passed };
  }
  // The gate closed (non-zero exit) but named no failing test — a hollow suite, a file that threw on
  // import, or a count that did not add up. `scripts/gate.ts` calls this GATE CLOSED for a reason, and
  // that reason belongs to the owner verbatim rather than dressed up as a test that does not exist.
  return { state: 'errored', why: `the gate closed without naming a specific failing test:\n${out.slice(-1200).trim()}` };
}

/**
 * Return every file the run touched to the state it was in before the run.
 *
 * Returns the paths it could NOT put back. capture() ignores that list — the check on apply is what
 * guards correctness there — but apply() uses it to say whether a failed write left anything behind,
 * and a silent boolean-free void was how that answer went missing.
 */
async function restore(files: { path: string; before: string | null }[]): Promise<string[]> {
  const stuck: string[] = [];
  for (const f of files) {
    const abs = path.resolve(repoRoot(), f.path);
    try {
      if (f.before === null) await unlink(abs);
      else await writeFile(abs, f.before, 'utf8');
    } catch (e) {
      // A file that should not exist and does not is the goal, not a failure.
      if (f.before === null && (e as NodeJS.ErrnoException).code === 'ENOENT') continue;
      stuck.push(f.path);
    }
  }
  return stuck;
}

/**
 * The first changed file that will not parse, or null if they all do.
 *
 * Only JS/TS is checked, and only for SYNTAX — this is the catastrophic class (an unclosed template
 * literal, a stray back-tick in a comment, a missing brace), the one that takes the app down before
 * anything can react. It is not a review and does not pretend to be: a file can parse perfectly and
 * still be wrong, which is what the diff in front of the owner is for.
 */
async function firstUnparseable(files: { path: string; after: string }[]): Promise<{ path: string; error: string } | null> {
  for (const f of files) {
    const m = /\.(js|mjs|ts|tsx|jsx)$/.exec(f.path);
    if (!m) continue;
    const loader = (m[1] === 'ts' ? 'ts' : m[1] === 'tsx' ? 'tsx' : m[1] === 'jsx' ? 'jsx' : 'js') as 'ts' | 'tsx' | 'jsx' | 'js';
    try {
      new Bun.Transpiler({ loader }).transformSync(f.after);
    } catch (e) {
      return { path: f.path, error: String((e as Error)?.message ?? e).slice(0, 300) };
    }
  }
  return null;
}


/**
 * Retire proposals the owner never answered.
 *
 * Nothing is at risk on disk — capture already put the tree back, so an undecided proposal is only a
 * held patch and a dangling `proposed` row. But a ledger that accumulates questions with no answers is
 * quietly dishonest about what happened: it reads as though those changes are still pending when they
 * are not, and the older ones could not be applied anyway (their `before` no longer matches).
 *
 * So an abandoned proposal is recorded as abandoned. That is the true event, and it is a different
 * fact from "discarded", which means the owner looked at it and said no.
 */
const PROPOSAL_TTL_MS = 30 * 60_000;
async function expireStale(): Promise<void> {
  const now = Date.now();
  for (const [id, p] of [...proposals]) {
    if (now - p.at <= PROPOSAL_TTL_MS) continue;
    proposals.delete(id);
    await receipt({ kind: 'expired', id, files: p.changed, digest: p.digest, reason: 'never decided' });
  }
}

/**
 * Apply a held proposal. Refuses rather than half-applies.
 *
 * `approvedHash`, WHEN PASSED, is the byte binding the caller is agreeing to — the hash `capture()`
 * computed and put on the wire as `proposal.proposalHash`. It is optional at this signature: door.ts's
 * HTTP route may not have one to send yet, and a caller that omits it gets exactly the pre-existing
 * behaviour. A caller that DOES pass one gets the check for real — see the write plan below for why
 * that check cannot be fooled by a change to the proposal made after this function was entered.
 *
 * `by` NAMES THE CALLER, NOT THE BYTES. Both `door.ts` routes — the real `/api/forge/apply` a click
 * hits, and the hosted glass's own auto-accept branch inside `/api/forge/stream` — call this exact
 * function, so it is the only place that can honestly say which one happened. Defaulting to
 * `'owner-click'` is deliberate: every test and every existing caller that has never heard of this
 * parameter is describing a real accept, and only the one call site that is NOT one passes the other
 * label explicitly. See `test/forge-apply-review-gate.test.ts` for the receipt this produces.
 */
export async function apply(
  id: string,
  approvedHash?: string,
  by: 'owner-click' | 'auto-accept' = 'owner-click',
): Promise<{ ok: boolean; applied?: string[]; restart?: boolean; error?: string }> {
  const p = proposals.get(id);
  if (!p) return { ok: false, error: 'proposal_unknown_or_expired' };

  // ── THE LOCK, CLAIMED HERE — BEFORE THE FIRST `await` IN THIS FUNCTION ──
  //
  // Two lines, both synchronous, nothing between them: check `applying`, then add to it. No `await`
  // has happened yet in this call, so no other call has had a turn to run since `proposals.get(id)`
  // above — the second of two concurrent `apply(id)` calls sees this `Set` exactly as the first left
  // it, which is the entire guarantee. Claiming any later — after the hash check, after the disk-drift
  // loop — would leave a window of real `await`s wide enough for a second call to read the same
  // unclaimed proposal and start its own write plan. See `applying`'s own doc above for the measured
  // replay this closes.
  if (applying.has(id)) {
    return { ok: false, error: 'apply_in_flight: this proposal is already being applied by another request' };
  }
  applying.add(id);
  try {
    return await applyLocked(id, approvedHash, p, by);
  } finally {
    // Released whatever happened — success moves the id out of `proposals` entirely (nothing left to
    // reclaim), and every refusal below leaves the proposal held so the owner can try again, which
    // means the lock must not outlive this one call.
    applying.delete(id);
  }
}

/** The body of `apply()`, run only once the lock above is held. Never called directly. */
async function applyLocked(
  id: string,
  approvedHash: string | undefined,
  p: Proposal,
  by: 'owner-click' | 'auto-accept',
): Promise<{ ok: boolean; applied?: string[]; restart?: boolean; error?: string }> {
  // ── THE WRITE PLAN: ONE DEEP, IMMUTABLE SNAPSHOT, TAKEN NOW — NOTHING BELOW READS `p.files` AGAIN ──
  //
  // `p` is the exact object this module keeps in the `proposals` Map — not a copy. `getProposal()`
  // hands the same reference to any other caller, and nothing in this file promises that object stays
  // put for the whole of an `apply()` call, which runs across several `await`s (a law check, a disk
  // read per file, a write per file). Reading `f.after` once to compute a hash and again later, inside
  // the write loop, to decide what to hand `writeFile` are TWO reads of a MUTABLE property with real
  // time between them — long enough, in a process serving concurrent requests, for something to have
  // changed it. A hash computed from the first read would then describe bytes the second read no
  // longer holds: the check passes, and what lands is not what was checked.
  //
  // So this is read from `p.files` exactly ONCE, right here, into a plain array holding its own copies:
  // `path` and `before` are strings — copied by value, immune to a later reassignment of the property
  // they came from — and `afterBuf` is a `Buffer`, a fresh copy of the bytes, not a reference to
  // anything `p` still owns. Every line below — the disk-drift check, the hash comparison, and the
  // write itself — reads only `plan`. `p.files` is not consulted again past this point, so there is no
  // later read left for anything to have changed the answer to.
  const changed = [...p.changed];
  const digest = p.digest;
  const plan = p.files.map((f) => ({ path: f.path, before: f.before, afterBuf: Buffer.from(f.after, 'utf8') }));
  const planHash = computeProposalHash(id, plan.map((f) => ({ relPath: f.path, content: f.afterBuf })));

  // ── WHAT HE AGREED TO, NOT MERELY THAT HE MAY AGREE ─────────────────────────────────────────────
  //
  // Session and standing (checked upstream, in door.ts) answer WHO is asking and WHETHER he may write
  // at all. Neither answers WHICH BYTES he saw. `approvedHash` is the hash the glass displayed and the
  // click echoed back; comparing it to `planHash` — derived from the exact snapshot this call is about
  // to write, not from a field on `p` that could have gone stale since propose time — is what makes
  // "what he saw" and "what lands" one fact rather than two joined only by nothing having gone wrong.
  if (approvedHash !== undefined) {
    if (!isProposalHash(approvedHash)) {
      await receipt({ kind: 'apply-refused', id, files: changed, digest, reason: 'approval_hash_malformed' });
      return { ok: false, error: 'approval_hash_malformed: an approval must name the exact bytes it approves' };
    }
    if (approvedHash !== planHash) {
      await receipt({ kind: 'apply-refused', id, files: changed, digest, reason: 'approval_hash_mismatch' });
      return {
        ok: false,
        error: 'approval_hash_mismatch: this approval names different bytes than this proposal now holds — '
          + 'nothing was written. Look at the change again.',
      };
    }
  }

  // CHECK EVERYTHING FIRST, against the plan. A half-applied edit is the one outcome neither "apply"
  // nor "discard" can undo, so nothing is written until every file is confirmed to be exactly what it
  // was.
  for (const f of plan) {
    const abs = path.resolve(repoRoot(), f.path);
    // THE SECOND BELT. capture refuses first, so no conformance case reaches this line — and it is
    // wired anyway, because the proposal store outlives the round that filled it. A proposal can be
    // held for half an hour (PROPOSAL_TTL_MS), and `aukora.law.json` is a file the owner edits. A gate
    // checked only on the way in is not a gate; this is the same judge, asked again at the only moment
    // that actually writes.
    const v = judgeOne(f.path);
    if (v.verdict === 'refused') {
      await receipt({ kind: 'apply-refused', id, files: changed, digest, reason: v.reasonClass });
      return { ok: false, error: `${v.reasonClass}: ${v.message ?? f.path.slice(0, 80)}` };
    }
    let now: string | null = null;
    try { now = await readFile(abs, 'utf8'); } catch { now = null; }
    if (now !== f.before) {
      await receipt({ kind: 'apply-refused', id, files: changed, digest, reason: 'file_moved_since_proposal' });
      return { ok: false, error: `file_moved_since_proposal: ${f.path} changed after this was proposed` };
    }
  }

  // …AND BE ABLE TO TAKE BACK THE WRITES THEMSELVES.
  //
  // Checking first is not enough, and this is the sequence that proved it. MEASURED with the second of
  // two files made read-only: `writeFile` threw EACCES straight out of this function, after the first
  // file had already landed. Everything about that outcome was wrong at once — the door calls this as
  // `json(await review.apply(id))`, so a function documented never to throw returned a 500 mid-round;
  // the tree kept half the change; the proposal was never registered as applied, so the half that DID
  // land had no undo; nothing was receipted; and pressing accept again answered
  // `file_moved_since_proposal`, blaming the owner for a move apply had made itself.
  //
  // So a failed write is unwound. Every file below was verified byte-for-byte a moment ago, which makes
  // the unwind a return to a known point rather than a guess — and it is the only outcome that leaves
  // "refuses rather than half-applies" true.
  const written: { path: string; before: string | null }[] = [];
  try {
    for (const f of plan) {
      const abs = path.resolve(repoRoot(), f.path);
      await mkdir(path.dirname(abs), { recursive: true });
      // THE SAME BUFFER OBJECT `planHash` WAS COMPUTED FROM — not `p.files[i].after` re-read fresh.
      await writeFile(abs, f.afterBuf);
      written.push({ path: f.path, before: f.before });
    }
  } catch (e) {
    const why = (e as NodeJS.ErrnoException)?.code ?? (e as Error)?.message ?? 'unknown';
    const stuck = await restore(written);
    await receipt({ kind: 'apply-refused', id, files: changed, digest, reason: 'write_failed' });
    // The proposal stays held: nothing is on disk that was not there before, so accepting again after
    // the obstacle is cleared is a legitimate and correct thing for the owner to do.
    return { ok: false, error: stuck.length
      ? `apply_failed (${why}) and ${stuck.join(', ')} could not be put back — the tree is part-changed`
      : `apply_failed (${why}): nothing was left on disk, this can be accepted again` };
  }
  proposals.delete(id);
  // THE SAME DISCIPLINE, CARRIED FORWARD: `rollback()` reads `.files[i].after` off whatever is stored
  // here to know what to compare against disk and what an undo puts back. Storing the live `p` would
  // reintroduce the exact hazard this function was just rewritten to remove — a later mutation to
  // `p.files` would make `applied`'s record of "what was written" disagree with what is actually on
  // disk. So what is kept is built from `plan`, the same immutable snapshot that was written, decoded
  // back to strings once for storage.
  applied.set(id, { ...p, files: plan.map((f) => ({ path: f.path, before: f.before, after: f.afterBuf.toString('utf8') })) });
  while (applied.size > APPLIED_CAP) {
    const oldest = [...applied.keys()][0];
    if (oldest === undefined) break;
    applied.delete(oldest);
  }
  // AN OWNER ACT: where the chain stood when he decided. NOT a claim that the decision caused any
  // part of it — see the withdrawal in ledger.ts.
  //
  // `by` TRAVELS INTO THE RECEIPT. Nothing upstream may say "applied" and mean two different things —
  // see `apply()`'s own doc for why this parameter exists at all.
  await actReceipt({ kind: 'applied', id, files: changed, digest, by });
  // A reload of the page does not re-read surface/*.ts, core/** or scripts/*.ts — that code is already
  // loaded in this process. Flag so the door can exit 75 and the supervisor bring a fresh one up.
  return { ok: true, applied: changed, restart: needsDoorRestart(changed) };
}

/** Throw a proposal away. Nothing was ever on disk, so this is a receipt and a delete. */
export async function discard(id: string): Promise<{ ok: boolean; error?: string }> {
  const p = proposals.get(id);
  if (!p) return { ok: false, error: 'proposal_unknown_or_expired' };
  proposals.delete(id);
  // AN OWNER ACT: where the chain stood when he decided. NOT a claim that the decision caused any
  // part of it — see the withdrawal in ledger.ts.
  await actReceipt({ kind: 'discarded', id, files: p.changed, digest: p.digest });
  return { ok: true };
}

/**
 * One line per decision, append-only.
 *
 * CONTENT-FREE: file paths, a digest, a kind and a time. Never the patch, never the instruction. The
 * point of a receipt is that a decision happened and cannot be denied — not that a third party can
 * reconstruct the owner's work from the log.
 */
async function receipt(row: { kind: string; id: string; files: string[]; digest: string; reason?: string }): Promise<void> {
  // ══ THE APPEND MOVED TO core/forge/ledger.ts, AND THE SILENCE WENT WITH IT ══
  //
  // This was `try { appendFile(...) } catch { /* a ledger that cannot be written must never take the
  // surface down with it */ }`. The remedy in that comment is right and is kept — `writeReceipt`
  // never throws — but the silence was not: a full disk or a changed permission lost the owner's acts
  // and nothing anywhere said so. A biography with holes in it reads as complete.
  //
  // `ledgerHealth()` now remembers what was lost, and the rows are hash-linked so an edit, a removal
  // or a reorder is visible. See that file for why an OWNER ACT also carries the chain around it.
  const { writeReceipt } = await import('./ledger');
  await writeReceipt(row);
}

/**
 * The witness chain, read either side of an owner decision.
 *
 * WHY THIS EXISTS: one accepted proposal writes ONE row in the forge ledger and produces SEVERAL path
 * receipts in the witness chain, so anything counting both double-counts the same act. Recording the
 * chain's own count before and immediately after the decision makes the overlap exact.
 *
 * READ ONLY, and it has to be — `core/witness/**` is law-protected and this lane may not write there.
 * `frontierOf` is a pure read of the chain's current shape, which is what makes this possible at all
 * without touching the closed side.
 *
 * A FAILURE HERE COSTS THE CAUSAL LINK AND NOTHING ELSE. The act is still recorded; `causedReceipts`
 * answers null, which says nobody looked rather than that nothing happened.
 */
async function chainMark(): Promise<{ receipts: number; frontier: string } | null> {
  try {
    // @ts-expect-error — untyped witness ESM, the pattern core/forge/protectedSweep.ts:68 established.
    const { frontierOf } = await import('../witness/frontier.mjs');
    const f = frontierOf(repoRoot()) as { receiptCount?: unknown; frontierDigest?: unknown };
    if (typeof f?.receiptCount !== 'number' || typeof f?.frontierDigest !== 'string') return null;
    return { receipts: f.receiptCount, frontier: f.frontierDigest };
  } catch {
    return null;
  }
}

/** One owner decision, with the chain read either side of it. */
async function actReceipt(
  row: {
    kind: string; id: string; files: string[]; digest: string; reason?: string;
    /** `applied` only — which of the two callers of `apply()` this decision actually was. */
    by?: 'owner-click' | 'auto-accept';
  },
): Promise<void> {
  // ONE MARK. This took a `run` callback and read the chain either side of it, and all three callers
  // passed `() => {}` — so the two reads were the same instant and the delta was zero, or worse, some
  // other agent's receipts. And wrapping properly would not have helped: a door-side `writeFile`
  // appends nothing, measured through the real path in test/act-causality.test.ts.
  //
  // The parameter is gone rather than left unused, so nobody can pass an operation believing it is
  // bracketed.
  const chainAt = await chainMark();
  const { writeReceipt } = await import('./ledger');
  await writeReceipt(chainAt ? { ...row, act: { chainAt } } : row);
}

/**
 * Undo ONE applied change, by its own identity.
 *
 * Symmetrical with apply, and for the same reason: it verifies every file is still exactly what this
 * change left behind before touching anything. If something else has moved a file since — a later
 * change, a hand edit — it refuses whole rather than stamping an old state over newer work. A partial
 * rollback is the one outcome neither undo nor redo can repair.
 */
export async function rollback(id: string): Promise<{ ok: boolean; reverted?: string[]; removed?: string[]; error?: string }> {
  const p = applied.get(id);
  if (!p) return { ok: false, error: 'rollback_unknown: that change is no longer held (a restart, or too many changes ago)' };

  for (const f of p.files) {
    const abs = path.resolve(repoRoot(), f.path);
    // The same belt, on the way back out. Refusing an UNDO reads harsh — the bytes being restored are
    // the owner's own — so the reason it is right is worth stating: rollback only forgets a change
    // after it has undone it, so a refusal here costs a round trip and never the undo. Fix the law,
    // press undo again, and it works. The alternative is a write to a path φ has just said it will not
    // write to, which is the fence deciding it knows better than the law the owner wrote.
    const v = judgeOne(f.path);
    if (v.verdict === 'refused') {
      await receipt({ kind: 'rollback-failed', id, files: p.changed, digest: p.digest, reason: v.reasonClass });
      return { ok: false, error: `${v.reasonClass}: ${v.message ?? f.path.slice(0, 80)}` };
    }
    let now: string | null = null;
    try { now = await readFile(abs, 'utf8'); } catch { now = null; }
    // `f.before` is accepted as well as `f.after`, and that is not a loosening of the guard. A file
    // already sitting at exactly the state this change is trying to restore is one THIS rollback put
    // there on an earlier attempt that could not finish — it is not newer work, and reverting it again
    // is a no-op. Refusing it made a half-finished undo permanently un-retryable, which is the trap the
    // partial-rollback below was leaving behind. Anything that is neither is genuinely newer and is
    // still refused whole.
    if (now !== f.after && now !== f.before) {
      await receipt({ kind: 'rollback-failed', id, files: p.changed, digest: p.digest, reason: 'file_moved_since_applied' });
      return { ok: false, error: `file_moved_since_applied: ${f.path} changed after this was applied` };
    }
  }

  const reverted: string[] = [];
  const removed: string[] = [];
  const failed: string[] = [];
  for (const f of p.files) {
    const abs = path.resolve(repoRoot(), f.path);
    try {
      if (f.before === null) { await unlink(abs); removed.push(f.path); }
      else { await writeFile(abs, f.before, 'utf8'); reverted.push(f.path); }
    } catch (e) {
      // A file that should be gone and is gone is the goal, not a failure.
      if (f.before === null && (e as NodeJS.ErrnoException).code === 'ENOENT') { removed.push(f.path); continue; }
      failed.push(f.path);
    }
  }
  // A WRITE THAT DID NOT HAPPEN IS NOT AN UNDO.
  //
  // MEASURED with the second of two files made read-only: this returned `{ ok: true, reverted: [the
  // first file] }`, wrote a `rolled-back` receipt, and deleted its own record — three separate claims
  // that a change had been undone, while the second file still held the machine's version and there
  // was no longer any way to try again. The swallowed error was the whole cause: the loop counted only
  // what worked and nothing looked at what did not.
  if (failed.length) {
    await receipt({ kind: 'rollback-failed', id, files: p.changed, digest: p.digest, reason: 'write_failed' });
    // The entry is KEPT. The change is still partly on disk, so the owner's undo must survive to be
    // pressed again once whatever blocked the write is gone.
    return { ok: false, reverted, removed,
      error: `rollback_incomplete: ${failed.join(', ')} could not be put back — this change is still held and can be undone again` };
  }
  applied.delete(id);
  // AN OWNER ACT: where the chain stood when he decided. NOT a claim that the decision caused any
  // part of it — see the withdrawal in ledger.ts.
  await actReceipt({ kind: 'rolled-back', id, files: p.changed, digest: p.digest });
  return { ok: true, reverted, removed };
}

/**
 * Record a rollback.
 *
 * Found by walking the ledger after a real undo: it showed `proposed` and `applied` and then nothing,
 * so a change the owner took back looked, in the record, exactly like one he kept. "Full control and
 * rollbacks all receipted" was the ask; two of those three were true.
 *
 * Lives here rather than in forgeLane because this file owns the ledger, and a second writer would be
 * a second place for the content-free rule to be forgotten.
 */
export async function receiptRollback(files: string[], ok: boolean): Promise<void> {
  await receipt({ kind: ok ? 'rolled-back' : 'rollback-failed', id: '-', files, digest: '-' });
}

/** The receipts, newest last, for the proof room and for the owner's own reading. */
export async function receipts(limit = 200): Promise<unknown[]> {
  // ONE READER, for the same reason there is one writer. This hand-rolled the parse and silently
  // dropped any line that would not JSON — which, in the ledger holding the owner's own decisions, is
  // a hole that reads as an absence of events. `readLedger` drops the same lines (a reader must not
  // throw) and `verifyLedger` is the thing that REPORTS them, so the silence has somewhere to go.
  const { readLedger } = await import('./ledger');
  return readLedger(limit);
}
