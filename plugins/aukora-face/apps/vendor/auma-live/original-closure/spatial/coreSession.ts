// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/**
 * ONE CORE MEMORY — the per-process session identity edge (issues #45/#244).
 *
 * The core receipt stamp (core/src/coreMemoryEnvelope.ts) wants two facts only the running edge
 * can know: WHICH thread/session is writing, and WHICH repo commit the process runs. This leaf
 * resolves both, once per process:
 *
 *   - thread id: `sess.<compact-utc-boot-time>.<4hex>` — minted at first use, stable for the
 *     process lifetime. This is honest PROCESS-SESSION granularity: the node has no finer live
 *     thread concept today (voice history is process-local, doors share one chat-serve process),
 *     so one boot = one thread, and different doors in the same boot are told apart by `origin`.
 *     A finer per-conversation id can ride the same field later without a schema change.
 *   - source commit: resolved purely from the filesystem (no `git` subprocess), reusing
 *     capabilityPreamble.readGitHead and additionally following a worktree's `gitdir:` pointer
 *     (where `.git` is a FILE) including the commondir hop for refs. Unresolvable reads are
 *     reported as undefined — the stamp drops the field, never guesses.
 *
 * Leaf module: fs + crypto only; never starts anything on import; grants nothing.
 */
import { existsSync, readFileSync, statSync } from 'fs';
import { isAbsolute, join, resolve } from 'path';
import { randomBytes } from 'crypto';
import { readGitHead } from './capabilityPreamble';

/** Pure mint (exported for tests): `sess.<compact-utc>.<4hex>` — THREAD_ID_RE-safe by construction. */
export function mintThreadId(nowMs: number, randHex4: string): string {
  const ts = new Date(nowMs).toISOString().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
  const rand = /^[0-9a-f]{4}$/.test(randHex4) ? randHex4 : '0000';
  return `sess.${ts}.${rand}`;
}

let processThreadId: string | null = null;

/** The ONE thread/session id of this process — minted lazily, then constant. */
export function currentThreadId(): string {
  if (processThreadId === null) {
    processThreadId = mintThreadId(Date.now(), randomBytes(2).toString('hex'));
  }
  return processThreadId;
}

/** Test seam: forget the minted id between hermetic tests. */
export function _resetCoreSessionForTests(): void {
  processThreadId = null;
  cachedCommit = undefined;
  commitResolved = false;
}

/** Resolve the short HEAD commit for a repo root, handling both a normal `.git` DIRECTORY
 *  (readGitHead as-is) and a worktree's `.git` FILE (`gitdir: <path>` + commondir hop so branch
 *  refs still resolve). Returns undefined when nothing resolves — never throws, never guesses. */
export function resolveSourceCommit(repoRoot: string): string | undefined {
  try {
    const dotGit = join(repoRoot, '.git');
    if (!existsSync(dotGit)) return undefined;
    let gitDir = dotGit;
    if (statSync(dotGit).isFile()) {
      const m = readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+)\s*$/m);
      if (!m) return undefined;
      gitDir = isAbsolute(m[1].trim()) ? m[1].trim() : resolve(repoRoot, m[1].trim());
    }
    const direct = readGitHead(gitDir);
    if (/^[0-9a-f]{7,40}$/.test(direct.head)) return direct.head;
    // Worktree gitdirs keep HEAD locally but branch refs in the COMMON dir — hop and retry there.
    const commonPath = join(gitDir, 'commondir');
    if (existsSync(commonPath)) {
      const common = readFileSync(commonPath, 'utf8').trim();
      const commonDir = isAbsolute(common) ? common : resolve(gitDir, common);
      const headRaw = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
      const refMatch = headRaw.match(/^ref:\s*(refs\/\S+)$/);
      if (refMatch) {
        const loose = join(commonDir, refMatch[1]);
        if (existsSync(loose)) return readFileSync(loose, 'utf8').trim().slice(0, 12);
        const packed = join(commonDir, 'packed-refs');
        if (existsSync(packed)) {
          for (const line of readFileSync(packed, 'utf8').split('\n')) {
            const pm = line.match(/^([0-9a-f]{40})\s+(refs\/\S+)$/i);
            if (pm && pm[2] === refMatch[1]) return pm[1].slice(0, 12);
          }
        }
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

let cachedCommit: string | undefined;
let commitResolved = false;

/** The running commit of THIS process's repo tree, resolved once (undefined stays undefined —
 *  a node without git metadata stamps no commit, honestly). */
export function currentSourceCommit(repoRoot: string = join(__dirname, '..')): string | undefined {
  if (!commitResolved) {
    cachedCommit = resolveSourceCommit(repoRoot);
    commitResolved = true;
  }
  return cachedCommit;
}

/** The mechanical guarantee: session identity grants nothing. */
export function coreSessionGrantsAuthority(): false {
  return false;
}
