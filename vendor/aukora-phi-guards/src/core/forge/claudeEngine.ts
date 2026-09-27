// φ — CLAUDE AS THE HAND, under the same law as every other hand.
//
// ══ WHAT CHANGES AND WHAT DOES NOT ══
//
// Nothing about the round changes. The arming switch, the custody refusal, the pre-run snapshots, the
// changed/created accounting, the review gate, the receipt, the undo — all of it is engine-agnostic and
// already tested (`test/forge-accounting.test.ts`). This file supplies only the middle: who does the
// typing. Same seam as `grokEngine.ts`.
//
// ══ HOW ══
//
// Headless Claude Code: `claude -p <instruction>` with cwd pinned to the repository root. Stdout and
// stderr stream as log frames exactly the way crush does — line-split, trimmed, handed to `onEvent` as
// they arrive — so a round is watchable rather than a spinner waiting on exit.
//
// ══ WHAT THIS DOES NOT CLAIM ══
//
// A live headless round has not been proven through this driver. Availability is the binary answering
// `--version`; readiness is that answer plus the standing caveat that sign-in, credit and a completed
// turn are not measured here. The law and the witness are unchanged: Claude Code's own hooks still
// govern tool calls, and forge still refuses protected paths after the hand exits.

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import type { ForgeEngine } from './crush';
import { FORGE_CONTEXT, FORGE_TIMEOUT_MS } from './crush';

/**
 * Same shape as the private `run` in crush.ts: capture the whole stream, and also emit each finished
 * line so the surface can paint as the engine works. Kept local rather than shared so this driver does
 * not force crush.ts to export an internal, and so a future change to crush's spawn cannot silently
 * change what Claude sees.
 */
function run(
  cmd: string,
  args: string[],
  opts: {
    cwd: string;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    onLine?: (line: string) => void;
    signal?: AbortSignal;
  },
): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    // stdin is CLOSED, not piped. `claude -p` reads the instruction from argv, but with an open stdin
    // it still waits for a pipe that never arrives and prints "no stdin data received in 3s" into the
    // owner's stream before doing anything — three seconds of noise on every round, and the warning
    // reads like a fault in the round rather than in how it was launched. `ignore` is /dev/null.
    const p = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let pending = '';
    const cap = (b: Buffer) => {
      const s = b.toString();
      if (out.length < 200_000) out += s;
      if (!opts.onLine) return;
      pending += s;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const l of lines) { const t = l.trim(); if (t) opts.onLine(t); }
    };
    p.stdout.on('data', cap);
    p.stderr.on('data', cap);
    const t = opts.timeoutMs
      ? setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* already gone */ } }, opts.timeoutMs)
      : null;
    const onAbort = () => { try { p.kill('SIGKILL'); } catch { /* already gone */ } };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    p.on('close', (code) => {
      if (t) clearTimeout(t);
      opts.signal?.removeEventListener('abort', onAbort);
      // Flush a trailing partial line so the last words of a quiet exit still reach the screen.
      if (opts.onLine && pending.trim()) opts.onLine(pending.trim());
      resolve({ code: code ?? -1, out });
    });
    p.on('error', (e) => {
      if (t) clearTimeout(t);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({ code: -1, out: out + '\n' + String(e) });
    });
  });
}

/**
 * Claude Code, pinned to THIS repository by cwd and nothing else.
 *
 * `-p` is the headless / print path: one instruction in, text out, no TUI. Without
 * `--permission-mode bypassPermissions`, Claude Code's OWN interactive permission gate still applies
 * even in `-p` mode — it has no terminal to prompt on, so it silently blocks the write and the round
 * comes back with `changed: []`, indistinguishable from the model choosing to do nothing. Measured:
 * a round asked to edit a file produced no diff and no error, only for `claude --debug` to show the
 * edit tool call being refused before it ever reached disk.
 *
 * This does not widen what the hand may write. `crush.ts`'s `round()` re-derives every changed and
 * created file from `git status`/`git diff` AFTER the engine exits and judges each one against
 * `aukora.law.json` before a proposal is ever captured (the BANANA check, `test/forge-accounting.test.ts`)
 * — that check does not ask the engine what it did or trust any flag passed here. Bypassing Claude
 * Code's own gate only lets the engine attempt the write; whether it survives review is still decided
 * one layer up, the same as grok's `--always-approve`.
 */
/**
 * `claude` if the shell can see it, otherwise where its own installer puts it.
 *
 * SEVENTH INSTANCE OF THE SAME DEFECT IN THIS PROJECT: a NAME trusted where a RESOLUTION was required.
 * The list so far — a non-empty string treated as a working key; a path treated as a repository
 * identity; a script's checkmark trusted over the terminal that had just printed a failure; a doc line
 * about `SubagentStop` read as an answer about `PreToolUse`; a binary on $PATH treated as an engine that
 * can run; and `grok` named rather than resolved, which reported the hand the owner PAYS FOR as
 * unavailable on a machine where it runs.
 *
 * Claude Code's local install writes `~/.claude/local/claude` and does not put that directory on a login
 * shell's PATH. `which claude` is a question about the shell's configuration, not about the machine —
 * and this node is about to be handed to an owner whose ONLY hand is Claude Code. Getting this wrong
 * means his node reports its one engine missing and he has nothing to type into.
 *
 * One resolver, used by both the probe and the spawn. Two places naming a binary is how they drift.
 */
export function claudeBinary(env: NodeJS.ProcessEnv = process.env): string {
  // ── AN EXPLICIT ANSWER OUTRANKS A SEARCH, AND CONTAINMENT IS WHY ──
  //
  // The absolute-path search below is what stops an owner's node reporting its ONLY hand missing because
  // a login shell never got Claude Code's install directory onto PATH. It is also, exactly, a way to
  // reach outside a sandbox: `test/engines.test.ts` contains a live door it POSTs to on the standing
  // assumption that NO engine is reachable, and it strips PATH and HOME to guarantee that. This resolver
  // consulted `/opt/homebrew/bin` — which neither strip covers — and the suite caught it:
  //
  //     CONTAINMENT LOST: the child door can reach claude … an engine still answering here means its
  //     binary resolver consults something neither of them cover. Fix the containment — do not relax
  //     this check.
  //
  // That message was right, so the containment is fixed here rather than the check weakened. An explicit
  // `AUKORA_CLAUDE_BIN` is consulted first and is authoritative in both directions: it points an owner
  // at an unusual install, and it lets a sandbox STATE that there is no binary instead of hoping the
  // search comes up empty. A test that establishes a fact beats a test that depends on the machine —
  // which is the same rule this project applies to everything else.
  const forced = env.AUKORA_CLAUDE_BIN;
  if (forced) return forced;

  const home = env.HOME ?? homedir();
  for (const candidate of [
    `${home}/.claude/local/claude`,
    `${home}/.local/bin/claude`,
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ]) {
    // A stripped HOME is a deliberate statement that this process may not reach the owner's install.
    if (!env.HOME && candidate.startsWith(home)) continue;
    try { if (existsSync(candidate)) return candidate; } catch { /* unreadable is the same as absent */ }
  }
  return 'claude';
}

export const claudeEngine: ForgeEngine = async (task, ctx) => {
  const prompt = `${task}\n\n${ctx.brief ?? FORGE_CONTEXT}`;
  return run(claudeBinary(), ['-p', prompt, '--permission-mode', 'bypassPermissions'], {
    cwd: ctx.repoRoot,
    timeoutMs: FORGE_TIMEOUT_MS,
    env: ctx.env,
    signal: ctx.signal,
    onLine: ctx.onEvent ? (line) => ctx.onEvent!({ t: 'log', line }) : undefined,
  });
};
