// φ · core/forge/worktree.ts — ONE ROUND, ONE TREE.
//
// ══ WHY THIS EXISTS ══
//
// `docs/EXPECTATIONS.md` #3 measured the cost of two forge rounds on one working tree: the module-global
// pre-run snapshot is cleared at the start of each round, and concurrent engines write the same files.
// Uncommitted work can vanish with no receipt of what was lost. The browser's `forging` flag is per-tab
// memory; a second tab or a bare curl never sees it.
//
// The council already solved the isolation half of this (`core/council/cast.ts` `ensureWorktree`): a
// detached git worktree, never under /tmp (macOS `/tmp` → `/private/tmp` blinds PreToolUse hooks), with
// the owner's uncommitted work mirrored in so the agent sees what he is looking at. This file is that
// shape, aimed at WRITE rounds rather than a read-only council.
//
// ══ EACH ROUND GETS ITS OWN ══
//
// The council reuses one named mirror and force-checkouts it every cast. A forge round WRITES, so two
// concurrent rounds sharing one mirror would race each other the same way they raced the owner's tree.
// Every call therefore mints a fresh path (`aukora-forge-<repo>-<id>` under $HOME), and the caller
// disposes it when capture is done. Concurrent rounds cannot touch the same files because they do not
// share a directory.
//
// What does NOT change: apply / discard / rollback still write the owner's real tree. The worktree is
// only where the engine is allowed to type. The proposal carries the bytes; the owner's click lands them.

import { copyFileSync, existsSync, mkdirSync, rmSync, symlinkSync } from 'fs';
import { homedir } from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

// `execFileSync` rather than `Bun.spawnSync`: this module is imported by the test runner as well as by
// the door, and the Bun global is not shimmed for the former. Same reason as the council.
function git(args: string[], cwd: string): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

/**
 * Where this round's tree will live — under $HOME, never under /tmp, named after the repo and the round.
 *
 * `AUKORA_FORGE_WORKTREE_ROOT` overrides the parent directory (tests use it so a suite never leaves a
 * tree in the developer's home). The leaf is still unique per call.
 */
export function forgeRoundRoot(repoRoot: string, id: string): string {
  const parent = process.env.AUKORA_FORGE_WORKTREE_ROOT
    ?? path.join(homedir(), `aukora-forge-${path.basename(repoRoot)}`);
  return path.join(parent, id);
}

/**
 * Make a detached worktree of `repoRoot` at HEAD, with the owner's uncommitted work mirrored in.
 *
 * Shape and sync are the council's (`core/council/cast.ts` `ensureWorktree`), including the two halves
 * of the mirror — tracked edits as a patch, then untracked files — because a new file is invisible to
 * `diff` and that is the exact case the first live council round got wrong. The difference is only that
 * every forge round gets a FRESH path: a shared mirror cannot host two writers.
 */
export function ensureForgeWorktree(repoRoot: string): { ok: true; cwd: string; head: string | null } | { ok: false; error: string } {
  const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const cwd = forgeRoundRoot(repoRoot, id);

  if (cwd.startsWith('/tmp/') || cwd.startsWith('/private/tmp/')) {
    return { ok: false, error: 'the forge worktree must NOT be under /tmp — on macOS it is a symlink to '
      + '/private/tmp, so a realpath\'d root and a literal cwd disagree and the PreToolUse hook then refuses '
      + 'every read. Measured on the donor (council); same trap applies to any hooked hand.' };
  }

  const head = git(['rev-parse', 'HEAD'], repoRoot);
  if (head.code !== 0) return { ok: false, error: `not a git repository: ${head.out.trim().slice(0, 200)}` };
  const sha = head.out.trim();

  mkdirSync(path.dirname(cwd), { recursive: true });
  if (existsSync(path.join(cwd, '.git'))) {
    // Unique ids should never collide; if one does, refuse rather than force-checkout a tree another
    // round may still be writing into.
    return { ok: false, error: `forge worktree path already exists: ${cwd}` };
  }
  const add = git(['worktree', 'add', '--detach', cwd, sha], repoRoot);
  if (add.code !== 0) return { ok: false, error: `could not create the forge worktree: ${add.out.trim().slice(0, 300)}` };

  // ── THE ENGINE MUST SEE WHAT HE ACTUALLY HAS ────────────────────────────────────────────────────
  //
  // Same defect the council hit on its first live round, same fix. A worktree pinned to HEAD answers
  // questions about yesterday; the owner asks about the thing he is looking at. Tracked edits first
  // (as a patch), then the files git has never heard of — both halves, because a new file is invisible
  // to `diff`.
  //
  // Separation is the property this exists for: the engine types in a mirror, never his repository.
  // Sync makes the round accurate; the separation is what keeps concurrent rounds (and a runaway hand)
  // from destroying the tree he is working in. A failed sync is reported in `head` and the round
  // continues against HEAD — a slightly stale forge is worth more than no forge.
  const dirty = git(['diff', 'HEAD', '--binary'], repoRoot);
  let synced = true;
  if (dirty.code === 0 && dirty.out.trim()) {
    try {
      execFileSync('git', ['apply', '--whitespace=nowarn', '-'], { cwd, input: dirty.out, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch { synced = false; }
  }
  const untracked = git(['ls-files', '--others', '--exclude-standard'], repoRoot);
  if (untracked.code === 0) {
    for (const rel of untracked.out.split('\n').map((s) => s.trim()).filter(Boolean)) {
      try {
        const dst = path.join(cwd, rel);
        if (!path.resolve(dst).startsWith(path.resolve(cwd) + path.sep)) continue;
        mkdirSync(path.dirname(dst), { recursive: true });
        copyFileSync(path.join(repoRoot, rel), dst);
      } catch { synced = false; }
    }
  }

  // The gate (`scripts/gate.ts` → `bun test`) and any hand that resolves packages need `node_modules`.
  // A bare worktree does not have it (gitignored). Point at the owner's — read-only from the engine's
  // perspective for anything that matters; the alternative is a red gate on every proposal.
  const ownerNm = path.join(repoRoot, 'node_modules');
  const roundNm = path.join(cwd, 'node_modules');
  if (existsSync(ownerNm) && !existsSync(roundNm)) {
    try { symlinkSync(ownerNm, roundNm, 'dir'); } catch { /* gate will say so if it matters */ }
  }

  return { ok: true, cwd, head: `${sha.slice(0, 12)}${synced ? '' : ' (uncommitted work could NOT be mirrored — engine sees HEAD only)'}` };
}

/**
 * Drop a round's worktree. Force: the engine may have left it dirty, and that is exactly what should be
 * thrown away rather than merged forward. Best-effort — a leak under $HOME is recoverable; a throw
 * during door teardown is not.
 */
export function disposeForgeWorktree(repoRoot: string, cwd: string): void {
  if (!cwd || !repoRoot) return;
  // Never delete anything that is not one of ours. The path is minted by `forgeRoundRoot`; anything
  // else reaching here is a bug, not a cleanup target.
  const base = process.env.AUKORA_FORGE_WORKTREE_ROOT
    ?? path.join(homedir(), `aukora-forge-${path.basename(repoRoot)}`);
  const resolved = path.resolve(cwd);
  if (!resolved.startsWith(path.resolve(base) + path.sep) && resolved !== path.resolve(base)) return;

  git(['worktree', 'remove', '--force', cwd], repoRoot);
  try { rmSync(cwd, { recursive: true, force: true }); } catch { /* already gone */ }
  // Prune the registry in case remove left a stale entry after a hard rm.
  git(['worktree', 'prune'], repoRoot);
}
