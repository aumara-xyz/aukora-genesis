// φ · core/council/cast.ts — MANY MINDS, READ-ONLY, AT ONCE.
//
// ══ WHAT THIS IS, AND WHY IT COULD SHIP BEFORE THE HARD BRICK ══
//
// The owner's ask is a conductor that casts one sentence to many hands and shows every answer arriving
// live. The obvious blocker is `docs/EXPECTATIONS.md` #3: two rounds against one working tree can eat
// uncommitted work, so fanning WRITES out concurrently is a bomb until worktree isolation lands.
//
// That blocker does not apply here, and the distinction is the whole reason this file exists first.
// A council never writes. It reads a tree, in parallel, and reports. There is no diff to conflict, no
// snapshot to lose, no undo to fork. So the many-minds half of the vision is reachable now, and the
// dangerous half stays behind its brick where it belongs.
//
// ══ TRANSPLANTED, ADAPTED — see PROVENANCE.md ══
//
// From `aukora-one/scripts/council.mjs` (donor commit e704324). The donor is a CLI: `Promise.all`, then
// results. This is a door, so the shape had to change — every model's output is streamed line by line as
// it arrives, tagged by model, or the "situation room" is a spinner that eventually prints a wall.
//
// Everything the donor learned the hard way came across unchanged, because each line of it was paid for:
//
//   · macOS has no `timeout(1)`. A `setTimeout` + `kill`, which needs no coreutils.
//   · The worktree must NOT be under /tmp — on macOS that is a symlink to /private/tmp, a realpath'd
//     root and a literal cwd then disagree, and a PreToolUse hook refuses every read. Measured on the
//     donor: three of nine models could not open a single file and correctly said so. Fail-closed, so
//     not a security defect, but it silently halved a review round.
//   · Reasoning counts against max_tokens. The donor measured four models returning ZERO words, billed
//     in full, at 900. Crush owns that setting here; the note survives so nobody re-derives it.
//   · Every parallel run needs its own --data-dir or the sessions collide.
//   · `permissions.allowed_tools` IS NOT A RESTRICTION. Crush's own schema calls it the list of tools
//     that skip the permission PROMPT, and `crush run` is non-interactive — there is no prompt to skip,
//     so everything runs. A model asked to create a file created it. `readonly.mjs`, installed as a
//     PreToolUse hook, is the thing that actually makes a council read-only. Verbatim from the donor.
//
// ══ WHY A SEPARATE WORKTREE AND NOT THIS TREE ══
//
// `installFence()` writes `crush.json` into whatever directory it governs, because Crush reads config
// from the directory it is pointed at and has no --config flag (measured on the donor, v0.86.0). Aiming
// that at φ's live root would have the council mutate the repository it was convened to read.
//
// So the council reads a detached git worktree pinned to HEAD. Two consequences, both stated rather
// than discovered later: the council sees COMMITTED state, never the owner's uncommitted edits; and it
// physically cannot touch the tree he is working in, which is the stronger of the two properties.

import { spawn, execFileSync } from 'child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { tmpdir, homedir } from 'os';
import * as path from 'path';

/** A council member. `tier` decides what a round costs; `eyes` decides whether it can drive tools. */
export interface Model {
  name: string;
  id: string;
  tier: 'cheap' | 'deep';
  eyes: boolean;
}

/**
 * The roster, carried over from the donor with its measurements intact.
 *
 * `eyes` is MEASURED, not assumed: the donor found Fable 5 returning one byte in seven seconds and
 * Mistral Large emitting a malformed `<function=crush_logs>` call instead of using its tools. Both
 * answer fine as plain chat and neither can review a repository. A roster that pretends otherwise
 * spends a round to find out again.
 */
export const ROSTER: readonly Model[] = [
  { name: 'qwen3.7-plus',     id: 'qwen/qwen3.7-plus',        tier: 'cheap', eyes: true },
  { name: 'deepseek-v4-pro',  id: 'deepseek/deepseek-v4-pro', tier: 'cheap', eyes: true },
  { name: 'glm-5.2',          id: 'z-ai/glm-5.2',             tier: 'cheap', eyes: true },
  { name: 'gemini-3.6-flash', id: 'google/gemini-3.6-flash',  tier: 'cheap', eyes: true },
  { name: 'mistral-large',    id: 'mistralai/mistral-large-2512', tier: 'cheap', eyes: false },
  { name: 'gpt-5.6-sol',      id: 'openai/gpt-5.6-sol',       tier: 'deep',  eyes: true },
  { name: 'kimi-k3',          id: 'moonshotai/kimi-k3',       tier: 'deep',  eyes: true },
  { name: 'sakana-fugu',      id: 'sakana/fugu-ultra',        tier: 'deep',  eyes: true },
  { name: 'fable-5',          id: 'anthropic/claude-fable-5', tier: 'deep',  eyes: false },
];

export function selectRoster({ tier = 'cheap', eyesOnly = true }: { tier?: 'cheap' | 'deep' | 'all'; eyesOnly?: boolean } = {}): Model[] {
  return ROSTER
    .filter((m) => (tier === 'cheap' ? m.tier === 'cheap' : true))
    .filter((m) => (eyesOnly ? m.eyes : true));
}

/** A member is done. `killed` is the watchdog, and is reported rather than folded into `ok`. */
export interface Seat {
  model: string;
  ok: boolean;
  killed: boolean;
  code: number | null;
  secs: number;
  words: number;
  out: string;
  err: string;
}

export type CastEvent =
  | { t: 'council-begin'; models: string[]; cwd: string; head: string | null }
  | { t: 'council-line'; model: string; line: string }
  | { t: 'council-seat'; model: string; ok: boolean; killed: boolean; secs: number; words: number }
  | { t: 'council-end'; seats: Omit<Seat, 'out' | 'err'>[]; ms: number };

/** Never below 60s: a model that reads a repository before answering routinely runs past a chat budget. */
export const CAST_TIMEOUT_MS = 900_000;

/**
 * The council's own worktree — a detached checkout of this repository at HEAD.
 *
 * Named after the repository it mirrors, exactly as the donor does, and for the reason the donor's own
 * comment records: its default was one shared constant, so three lanes on the same day reviewed a tree
 * five commits stale and reported functions "missing" that existed. Every model was accurate and honest
 * about the wrong tree. The tool was the liar.
 */
export function councilRoot(repoRoot: string): string {
  return process.env.AUKORA_COUNCIL_ROOT
    ?? path.join(homedir(), `aukora-council-${path.basename(repoRoot)}`);
}

// `execFileSync` rather than `Bun.spawnSync`: this module is imported by the test runner as well as by
// the door, and the Bun global is not shimmed for the former. The donor shells out the same way.
function git(args: string[], cwd: string): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

/**
 * Make sure the council has a tree to read, pinned to this repository's HEAD.
 *
 * Detached on purpose: a council worktree that shared a branch with the owner would move under him the
 * moment either side committed.
 */
export function ensureWorktree(repoRoot: string): { ok: true; cwd: string; head: string | null } | { ok: false; error: string } {
  const cwd = councilRoot(repoRoot);
  if (cwd.startsWith('/tmp/') || cwd.startsWith('/private/tmp/')) {
    return { ok: false, error: 'the council worktree must NOT be under /tmp — on macOS it is a symlink to '
      + '/private/tmp, so a realpath\'d root and a literal cwd disagree and the PreToolUse hook then refuses '
      + 'every read, blinding the council silently. Measured on the donor.' };
  }
  const head = git(['rev-parse', 'HEAD'], repoRoot);
  if (head.code !== 0) return { ok: false, error: `not a git repository: ${head.out.trim().slice(0, 200)}` };
  const sha = head.out.trim();

  if (!existsSync(path.join(cwd, '.git'))) {
    const add = git(['worktree', 'add', '--detach', cwd, sha], repoRoot);
    if (add.code !== 0) return { ok: false, error: `could not create the council worktree: ${add.out.trim().slice(0, 300)}` };
  } else {
    // Already there — move it to today's HEAD. `--detach` again rather than a pull: this tree is a
    // mirror, never a place work happens, so discarding whatever it held is the correct outcome.
    // `-f` because the previous round left the synced diff below in it, and that is exactly what
    // should be thrown away rather than merged forward.
    const co = git(['checkout', '--detach', '-f', sha], cwd);
    if (co.code !== 0) return { ok: false, error: `could not update the council worktree: ${co.out.trim().slice(0, 300)}` };
    git(['clean', '-fdq', '-e', 'crush.json', '-e', '.council-readonly.mjs'], cwd);
  }

  // ── THE COUNCIL MUST REVIEW WHAT HE ACTUALLY HAS ────────────────────────────────────────────────
  //
  // MEASURED, on the first live round through the surface, and it is the donor's own defect arriving
  // in new clothes. Asked about a file that existed in the working tree but was not yet committed, all
  // four seats answered — correctly, honestly, in unison — that it did not exist. The donor's header
  // records the identical failure costing three lanes a round each: "Every model was accurate and
  // honest about the wrong tree. Not one fabricated a finding. The tool was the liar."
  //
  // A council convened on HEAD answers questions about yesterday. The owner asks about the thing he is
  // looking at, so the mirror carries his uncommitted work: tracked edits as a patch, then the files
  // git has never heard of. Both halves are needed — a new file is invisible to `diff`, and that is the
  // exact case that failed.
  //
  // What does NOT change is the property this worktree exists for: it is still a separate directory, so
  // a seat that somehow got past the read-only fence would corrupt a mirror rather than his repository.
  // Sync makes the council accurate; the separation is what keeps it safe. Neither substitutes for the
  // other. A sync that fails is reported as a warning and the round continues against HEAD, because a
  // slightly stale council is worth more than no council and the head line says which one he got.
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
        // Never outside the mirror. `ls-files` will not emit a traversal, but a path from a subprocess
        // reaching a `copyFileSync` is exactly the shape this repository checks rather than assumes.
        if (!path.resolve(dst).startsWith(path.resolve(cwd) + path.sep)) continue;
        mkdirSync(path.dirname(dst), { recursive: true });
        copyFileSync(path.join(repoRoot, rel), dst);
      } catch { synced = false; }
    }
  }

  return { ok: true, cwd, head: `${sha.slice(0, 12)}${synced ? '' : ' (uncommitted work could NOT be mirrored — reading HEAD only)'}` };
}

/**
 * Install the read-only fence into the worktree, and wire it into that worktree's `crush.json`.
 *
 * FIRST in the PreToolUse list and additive — whatever hooks the tree already carries keep their jobs;
 * this adds the one they were never meant to do. Written every round rather than assumed present,
 * because a worktree built by hand or by an older version would otherwise run a WRITABLE council and
 * nothing would say so.
 */
export function installFence(worktree: string, hookSource: string): string {
  const HOOK = '.council-readonly.mjs';
  copyFileSync(hookSource, path.join(worktree, HOOK));

  const cfgPath = path.join(worktree, 'crush.json');
  let cfg: Record<string, unknown> = {};
  try { cfg = JSON.parse(readFileSync(cfgPath, 'utf8')); } catch { /* fresh worktree */ }
  cfg.permissions = { ...(cfg.permissions as object ?? {}), allowed_tools: ['view', 'ls', 'glob', 'grep'] };
  const hooks = (cfg.hooks ?? {}) as Record<string, unknown[]>;
  const existing = ((hooks.PreToolUse ?? []) as { name?: string }[]).filter((h) => h?.name !== 'council-readonly');
  hooks.PreToolUse = [
    { name: 'council-readonly', matcher: '', command: `node ${HOOK} || exit 2`, timeout: 10 },
    ...existing,
  ];
  cfg.hooks = hooks;
  writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
  return cfgPath;
}

/** Run one member, streaming every finished line as it arrives. Never throws — a dead model is a row. */
function seat(
  model: Model,
  opts: { cwd: string; task: string; timeoutMs: number; apiKey: string; onLine: (line: string) => void; signal?: AbortSignal },
): Promise<Seat> {
  return new Promise((done) => {
    const dataDir = mkdtempSync(path.join(tmpdir(), `council-${model.name}-`));
    const started = Date.now();
    let out = ''; let err = ''; let pending = ''; let killed = false;

    const child = spawn('crush', ['run', '-q', '-c', opts.cwd, '-D', dataDir, '-m', `openrouter/${model.id}`, opts.task], {
      env: { ...process.env, OPENROUTER_API_KEY: opts.apiKey },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const take = (b: Buffer): void => {
      const s = b.toString();
      if (out.length < 400_000) out += s;
      pending += s;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const l of lines) { const t = l.trim(); if (t) opts.onLine(t); }
    };
    child.stdout.on('data', take);
    child.stderr.on('data', (b: Buffer) => { if (err.length < 40_000) err += b.toString(); });

    // The watchdog. `timeout(1)` does not exist on macOS; this needs nothing.
    const watchdog = setTimeout(() => { killed = true; try { child.kill('SIGKILL'); } catch { /* gone */ } }, opts.timeoutMs);
    const onAbort = (): void => { killed = true; try { child.kill('SIGKILL'); } catch { /* gone */ } };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    const finish = (code: number | null): void => {
      clearTimeout(watchdog);
      opts.signal?.removeEventListener('abort', onAbort);
      if (pending.trim()) opts.onLine(pending.trim());
      rmSync(dataDir, { recursive: true, force: true });
      done({
        model: model.name, ok: code === 0 && !killed, killed, code,
        secs: Math.round((Date.now() - started) / 1000),
        words: out.split(/\s+/).filter(Boolean).length,
        out, err,
      });
    };
    child.on('error', (e: Error) => { err += String(e?.message ?? e); finish(null); });
    child.on('close', (code: number | null) => finish(code));
  });
}

export interface CastOptions {
  question: string;
  repoRoot: string;
  apiKey: string;
  /** Absolute path to `readonly.mjs`. Passed in so this module never guesses at its own location. */
  hookSource: string;
  tier?: 'cheap' | 'deep' | 'all';
  eyesOnly?: boolean;
  timeoutMs?: number;
  onEvent?: (e: CastEvent) => void;
  signal?: AbortSignal;
}

/**
 * CAST. One question, every seat, in parallel, read-only.
 *
 * Returns when the last seat is done. Each seat's lines reach `onEvent` as they arrive, so the caller
 * can paint N live tiles rather than one spinner — that is the entire difference from the donor's CLI,
 * and the reason this is a module rather than a shell-out.
 */
export async function cast(opts: CastOptions): Promise<{ ok: true; seats: Seat[]; ms: number; cwd: string } | { ok: false; error: string }> {
  const started = Date.now();
  if (!opts.apiKey) {
    return { ok: false, error: 'council: no OpenRouter key resolved — the council rents foreign models and cannot run without one' };
  }
  const tree = ensureWorktree(opts.repoRoot);
  if (!tree.ok) return { ok: false, error: `council: ${tree.error}` };

  // BEFORE SPENDING ANYTHING. A round that convened first and fenced second would be a writable
  // council for exactly as long as it took to notice.
  try {
    installFence(tree.cwd, opts.hookSource);
  } catch (e) {
    return { ok: false, error: `council: could not install the read-only fence, refusing to convene: ${(e as Error)?.message ?? e}` };
  }

  const roster = selectRoster({ tier: opts.tier ?? 'cheap', eyesOnly: opts.eyesOnly ?? true });
  if (roster.length === 0) return { ok: false, error: 'council: that tier and eyes filter selects no models' };

  opts.onEvent?.({ t: 'council-begin', models: roster.map((m) => m.name), cwd: tree.cwd, head: tree.head });

  const seats = await Promise.all(roster.map((m) => seat(m, {
    cwd: tree.cwd,
    task: opts.question,
    timeoutMs: opts.timeoutMs ?? CAST_TIMEOUT_MS,
    apiKey: opts.apiKey,
    signal: opts.signal,
    onLine: (line) => opts.onEvent?.({ t: 'council-line', model: m.name, line }),
  }).then((s) => {
    opts.onEvent?.({ t: 'council-seat', model: s.model, ok: s.ok, killed: s.killed, secs: s.secs, words: s.words });
    return s;
  })));

  const ms = Date.now() - started;
  opts.onEvent?.({
    t: 'council-end',
    seats: seats.map(({ out: _o, err: _e, ...rest }) => rest),
    ms,
  });
  return { ok: true, seats, ms, cwd: tree.cwd };
}

/**
 * Ring 3. A council advises; it has never authorized anything.
 *
 * A literal `false`, not a computed boolean, in the house tradition — the same pin every advisory organ
 * in this family of repositories carries, so a test can assert the value rather than the type.
 */
export function councilGrantsAuthority(): false {
  return false;
}
