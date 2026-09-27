// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/**
 * Shared safe repo READ-path resolver (issue #75). The single confinement primitive every read-side tool
 * routes through before it touches a path: read_file, list_files, and search (nativeIdeDispatcher.ts), and
 * the Kira self-map walk (kiraBrain.ingestSelfMap). It NARROWS what those tools may touch; it grants no new
 * capability and reads nothing itself.
 *
 * Why it exists — before #75 the read lane was defended LEXICALLY only (isSafeRelPath: string `..`/absolute/
 * NUL rejection). A repo-internal symlink pointing outside the repo passes every lexical check and would be
 * FOLLOWED by statSync/readFileSync — escaping read_file/search and, worst, letting ingestSelfMap walk a
 * symlinked directory outside the repo and ingest its contents as brain atoms. This module closes that class
 * by mirroring the write lane's proven idiom (sandboxApply.ts:126-148): realpath BOTH sides, confine with
 * `=== rootReal || startsWith(rootReal + path.sep)`, and refuse symlinks outright via lstat.
 *
 * Invariants (all enforced here, none by convention), in check order:
 *   1. Lexical gate first — isSafeRelPath, IMPORTED from the write lane, not reimplemented.
 *   2. Lexical sensitive-path refusal BEFORE any fs access — preserves read_file's refuse-before-existence
 *      semantics (a non-existent `.env` still refuses as sensitive, not "not found") and avoids leaking
 *      whether a sensitive path exists.
 *   3. The root is realpath'd once per call, on BOTH sides of every comparison — REPO_ROOT is __dirname-
 *      derived and never realpath'd, so a repo opened via a symlinked path (macOS /tmp -> /private/tmp) would
 *      else false-refuse everything under a naive comparison.
 *   4. lstat before following anything — symlinks are DENIED, dangling ones included (refused as a symlink,
 *      not as "not found"). Recon (issue #75) found zero legitimate in-repo symlinks under version control,
 *      so default-deny costs nothing real.
 *   5. realpath the target and confine it under the realpath'd root.
 *   6. realpath-derived sensitive re-check — with symlinks denied this rarely diverges from the lexical rel,
 *      but the #75 order asks for both and it is cheap.
 *
 * The sensitive-path policy applies UNIFORMLY to every consumer, including kiraBrain.ingestSelfMap. An
 * earlier draft let the self-map opt out (to keep mapping its own in-repo authority/apply-gate SOURCE), but
 * an adversarial review proved that unsafe: the self-map walk admits .ts/.tsx/.js/.json/.md/.sh, which is
 * exactly where real secrets live (auth.json, .aukora/identity.json, credentials.json, a key pasted into a
 * .ts), and classifyRisk was the ONLY layer recognizing secret-shaped paths — dropping it would let those
 * files' full content into the persistent, append-only brain. Uniform enforcement also keeps the self-map
 * CONSISTENT with read_file (which already refuses these paths). Consequence, recorded honestly: a real
 * `kira self-map` no longer ingests sensitive-pattern-named files — including in-repo apply-gate source
 * (sandboxApply.ts, aumlok*.ts, ...). If mapping that public gate source is ever wanted, it needs a
 * deliberate secret-vs-edit-risk split in changeRiskClassifier, not a blanket opt-out — a separate brick.
 *
 * NOT in scope: TOCTOU hardening. Like the write lane, this resolves-then-returns and the caller reads after;
 * a single-user headless tool has no concurrent adversary racing the filesystem between the two. The threat is
 * a committed-symlink escape, which this closes structurally.
 */
import * as fs from 'fs';
import * as path from 'path';
import { isSafeRelPath } from './sandboxApply';
import { classifyRisk } from './changeRiskClassifier';

export const REPO_ROOT = path.resolve(__dirname, '..', '..');

export type ResolveReadResult =
  | { ok: true; abs: string; real: string; rel: string }
  | { ok: false; reason: string };

export interface ResolveReadOptions {
  root?: string; // default REPO_ROOT; tests pass mkdtemp fixture roots
}

/** classifyRisk-based sensitive-path refusal — the exact policy read_file carried pre-#75. Returns a reason
 *  or null. EXPORTED so a read-only consumer that must gate a path BEFORE the file exists (e.g. a new-file
 *  diff preview) applies the same sensitive-path rule the resolver applies to existing files. Pure. */
export function sensitiveReason(rel: string): string | null {
  const { risk, reasons } = classifyRisk([{ path: rel, status: 'modified' }], '');
  return risk === 'high' ? (reasons[0] ?? 'sensitive path') : null;
}

/**
 * Resolve a repo-relative read path to a confined, symlink-free absolute path, or a refusal with a distinct
 * human-readable reason. Every read-side tool routes through this before it touches the filesystem.
 */
export function resolveRepoReadPath(relPath: string, opts: ResolveReadOptions = {}): ResolveReadResult {
  // 1) lexical gate — reuse the write lane's rule, do not reimplement.
  if (!isSafeRelPath(relPath)) return { ok: false, reason: `unsafe path (lexical): ${relPath}` };

  // 2) lexical sensitive-path refusal, before any fs access.
  const lexReason = sensitiveReason(relPath);
  if (lexReason) return { ok: false, reason: `sensitive path refused: ${lexReason}` };

  // 3) realpath the root once, used on both sides of every comparison below.
  const root = opts.root ?? REPO_ROOT;
  let rootReal: string;
  try { rootReal = fs.realpathSync(root); }
  catch { return { ok: false, reason: `read root does not exist: ${root}` }; }

  const abs = path.join(rootReal, relPath);
  const relCheck = path.relative(rootReal, abs);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    return { ok: false, reason: `path escapes read root: ${relPath}` };
  }

  // 4) lstat before following anything — deny symlinks (dangling included).
  let lst: fs.Stats;
  try { lst = fs.lstatSync(abs); }
  catch { return { ok: false, reason: `not found: ${relPath}` }; }
  if (lst.isSymbolicLink()) return { ok: false, reason: `symlink read target refused: ${relPath}` };

  // 5) realpath the target and confine under the realpath'd root.
  let real: string;
  try { real = fs.realpathSync(abs); }
  catch { return { ok: false, reason: `unresolved read target: ${relPath}` }; }
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
    return { ok: false, reason: `path escapes read root via realpath: ${relPath}` };
  }

  const rel = path.relative(rootReal, real);

  // 6) realpath-derived sensitive re-check.
  const realReason = sensitiveReason(rel);
  if (realReason) return { ok: false, reason: `sensitive path refused (realpath): ${realReason}` };

  return { ok: true, abs, real, rel };
}
