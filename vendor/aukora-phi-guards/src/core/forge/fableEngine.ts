// φ — FABLE AS THE HAND, under the same law as every other hand.
//
// ══ WHAT CHANGES AND WHAT DOES NOT ══
//
// Nothing about the round changes. The arming switch, the custody refusal, the pre-run snapshots, the
// changed/created accounting, the review gate, the receipt, the undo — all of it is engine-agnostic and
// already tested (`test/forge-accounting.test.ts`). This file supplies only the middle: who does the
// typing. Same seam as `claudeEngine.ts` and `grokEngine.ts`.
//
// AUTHORIZATION IS UNTOUCHED, and that is deliberate rather than incidental. A proposal from this hand
// is captured by the same review gate and waits for the owner exactly like every other. Nothing here
// auto-applies, and this driver passes NO approval or permission-bypass flag to the child — see
// "WHAT IS NOT PASSED" below, which is the one design decision in this file worth arguing about.
//
// ══ WHAT IS MEASURED, AS OF 2026-08-03, ON THE MACHINE THIS WAS WRITTEN ON ══
//
// There is no `fable` binary here. Checked, not assumed:
//
//     fable                      absent (not on PATH)
//     ~/.fable/bin/fable         absent
//     ~/.local/bin/fable         absent
//     /opt/homebrew/bin/fable    absent
//     /usr/local/bin/fable       absent
//
// So this is a SEAT, not a proven hand, and the vocabulary in `engines.ts` already has the right words
// for that: `available` stays false because no binary answered, `readiness` reports `not-ready` with
// the name of what is missing, and `liveProven` is false because no round has completed. Three claims,
// none of them borrowed from another.
//
// ══ THE ARGV IS UNVERIFIED AND IS NAMED AS SUCH ══
//
// Both transports below are shaped after their siblings — ACP after `GROK_STDIO`, the print mode after
// `claude -p` — because that is the honest place to start and because both are overridable. NEITHER HAS
// BEEN ANSWERED BY A REAL `fable` BINARY. Whoever runs the first live turn should correct these from
// what the binary actually accepts, and correct this paragraph in the same commit.
//
// That last clause is not a pious hope. `test/fable-engine.test.ts` FAILS if evidence of a completed
// turn appears on disk while this file still calls itself unproven — which is exactly the failure mode
// that left `grokEngine.ts` claiming "this has never completed a turn against a live agent" while a
// 35 MB mirror on the same disk held 46 distinct sessions. A claim that cannot notice its own
// falsification is the defect; a dated measurement with a test behind it is the fix.
//
// ══ WHY TWO TRANSPORTS ══
//
// ACP first. Being the party that STARTED the agent means tool-call updates arrive on a pipe φ owns,
// rather than depending on a hook the owner may never have installed (LIMITS §5). When the ACP shape is
// not answered — the subcommand does not exist, the handshake fails, the binary is older — the round
// falls back to the print mode rather than failing. A fallback that is never exercised is a claim; this
// one reports which transport actually served the round, in the round's own output.
//
// It remains exactly as limited as LIMITS §11 says: being told directly is not being told everything.
// An engine that spawns a process without declaring a tool call is invisible to this client for the
// same reason it is invisible to a hook.

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
// STATICALLY IMPORTED, unlike `grokEngine`'s dynamic `await import`. `engines.ts` already imports
// `grokBinary` from this module at the top level, so the ACP client is loaded whatever this file does —
// a dynamic import here would buy nothing and would put the one class this driver must recognise
// (`AcpTurnFailed`, whose `partial.sessionId` decides whether to fall back) out of scope of the
// function that has to test for it.
import { runTurn, AcpTurnFailed, type AcpSpawn } from '../acp/client';
import type { ForgeEngine } from './crush';
import { FORGE_CONTEXT, FORGE_TIMEOUT_MS } from './crush';

/**
 * `fable` if the shell can see it, otherwise where an installer would put it.
 *
 * EIGHTH INSTANCE OF THE SAME DEFECT CLASS, written down before it happens again rather than after: a
 * NAME trusted where a RESOLUTION was required. The list so far — a non-empty string treated as a
 * working key; a path treated as a repository identity; a script's checkmark trusted over the terminal
 * that had just printed a failure; a doc line about `SubagentStop` read as an answer about
 * `PreToolUse`; a binary on $PATH treated as an engine that can run; `grok` named rather than resolved,
 * which reported the hand the owner PAYS FOR as unavailable on a machine where it runs; and `claude`,
 * whose installer writes `~/.claude/local/claude` and puts that directory on no login shell's PATH.
 *
 * `which fable` is a question about the shell's configuration, not about the machine.
 *
 * ── CONTAINMENT, WHICH THIS RESOLVER MUST NOT BREAK ──
 *
 * `test/engines.test.ts` boots a live door on the standing assumption that NO engine is reachable, and
 * enforces it by stripping PATH and HOME. An absolute-path search is exactly how a resolver reaches
 * around that — `claudeBinary()` consulted `/opt/homebrew/bin`, which neither strip covers, and the
 * suite caught it and was right to. So the same two rules apply here:
 *
 *   · `AUKORA_FABLE_BIN` is authoritative in BOTH directions. It points an owner at an unusual install,
 *     and it lets a sandbox STATE that there is no binary instead of hoping a search comes up empty.
 *   · A stripped HOME is a deliberate statement that this process may not reach the owner's install, so
 *     `$HOME`-derived candidates are skipped when HOME is absent.
 *
 * The one candidate under neither rule is the bare name, which resolves through PATH and is therefore
 * covered by the PATH strip. There is deliberately NO `/opt/homebrew` or `/usr/local` entry here: those
 * are the two paths that broke containment last time, and a seat with no live binary has nothing to
 * gain from them. Add one only with a measurement showing a real install lands there.
 */
export function fableBinary(env: NodeJS.ProcessEnv = process.env): string {
  const forced = env.AUKORA_FABLE_BIN;
  if (forced) return forced;

  const home = env.HOME ?? homedir();
  if (env.HOME) {
    for (const candidate of [`${home}/.fable/bin/fable`, `${home}/.local/bin/fable`]) {
      try { if (existsSync(candidate)) return candidate; } catch { /* unreadable is the same as absent */ }
    }
  }
  return 'fable';
}

/**
 * The ACP argv, UNVERIFIED, and overridable because of it.
 *
 * Shaped after `GROK_STDIO` (`grok agent --always-approve stdio`) minus the approval flag — see below.
 * `AUKORA_FABLE_ACP_ARGS` is a space-separated override so an owner whose binary spells this
 * differently does not need a code change to run a round.
 *
 * ══ WHAT IS NOT PASSED, AND WHY THAT IS THE POINT ══
 *
 * No `--always-approve`. No `--permission-mode bypassPermissions`. Not because they would be unsafe in
 * φ's terms — `crush.ts`'s `round()` re-derives every changed and created file from git AFTER the
 * engine exits and judges each against `aukora.law.json`, so a vendor flag cannot widen what survives
 * review — but because INVENTING AN AUTHORIZATION FLAG FOR A BINARY NOBODY HAS RUN is a guess in the
 * one category where this repository does not guess. `claudeEngine` passes its flag on the strength of
 * a measured round that came back with `changed: []` until it did; there is no such measurement here.
 *
 * The consequence is visible rather than hidden, which is why it is safe to ship this way: if the agent
 * asks φ to authorize a tool call, `core/acp/client.ts` answers `cancelled` — never `selected` — counts
 * the request, and the driver surfaces the count in the round's output. A blocked round says it was
 * blocked. It does not hang, and φ never appoints itself the authorizer.
 */
export function fableAcpArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const override = env.AUKORA_FABLE_ACP_ARGS;
  if (override && override.trim()) return override.trim().split(/\s+/);
  return ['agent', 'stdio'];
}

/** The ACP spawn spec, resolved at call time so an env change does not need a reload. */
export function fableAcpSpawn(env: NodeJS.ProcessEnv = process.env): AcpSpawn {
  return { command: fableBinary(env), args: fableAcpArgs(env), env };
}

/**
 * The print-mode argv, UNVERIFIED, and overridable for the same reason.
 *
 * Shaped after `claude -p <prompt>`. `AUKORA_FABLE_CLI_FLAG` names the flag alone; the prompt is always
 * the final argument, because that is the shape every print-mode CLI in this repository uses and a
 * flag that takes its value elsewhere is a difference an owner can express with the ACP override.
 */
export function fableCliArgs(prompt: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const flag = (env.AUKORA_FABLE_CLI_FLAG ?? '-p').trim();
  return flag ? [flag, prompt] : [prompt];
}

/** Where the diagnostic mirror goes when one is asked for. Never a second witness — LIMITS §11. */
export const FABLE_MIRROR = '.aukora/fable-acp-turn.jsonl';

/**
 * Same shape as the private `run` in crush.ts and the one in claudeEngine.ts: capture the whole stream,
 * and emit each finished line so the surface can paint as the engine works.
 *
 * `spawnFailed` is separated from a non-zero exit ON PURPOSE. "The binary is not there" and "the binary
 * ran and disagreed" are different facts, and the fallback below must only fire on the first — falling
 * back because a real engine returned exit 1 would rerun a failed instruction through a second
 * transport and report whichever answer it liked better.
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
): Promise<{ code: number; out: string; spawnFailed: boolean }> {
  return new Promise((resolve) => {
    // stdin CLOSED, not piped — the same three seconds of "no stdin data received" noise that
    // `claudeEngine` documents, printed into the owner's stream before anything happens.
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
      if (opts.onLine && pending.trim()) opts.onLine(pending.trim());
      resolve({ code: code ?? -1, out, spawnFailed: false });
    });
    p.on('error', (e) => {
      if (t) clearTimeout(t);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({ code: -1, out: out + '\n' + String(e), spawnFailed: true });
    });
  });
}

/**
 * Did the ACP attempt fail in a way that means "this binary does not speak ACP"?
 *
 * ══ THE SIGNAL IS STRUCTURAL, NOT TEXTUAL, AND THE FIRST DRAFT GOT THIS WRONG ══
 *
 * The first version matched the error MESSAGE against `/ENOENT|unknown command|usage:/i`. It failed
 * against a binary that printed `unknown command: agent` on stderr and exited 2 — because that text
 * lands in `AcpTurnFailed.partial.diagnostics`, and the message says the child exited. So the fallback
 * never fired, which is the defect this function exists to prevent, arriving through the instrument
 * meant to detect it.
 *
 * A REPORTED SESSION ID IS THE FACT THAT MATTERS. `session/new` returning an id is the moment the
 * binary demonstrates it speaks this protocol. So:
 *
 *   no session was ever established  →  this binary does not speak ACP. Fall back; nothing was asked
 *                                       of the model, so nothing is asked twice.
 *   a session existed and then failed →  a real engine failed a real turn. DO NOT fall back: re-running
 *                                       the instruction through a second transport asks the same
 *                                       question twice and reports whichever answer reads better, and
 *                                       the agent may already have written files the accounting will
 *                                       find.
 *
 * That distinction cannot be spelled differently by a different vendor, which a message pattern can.
 */
function acpUnsupported(e: unknown): boolean {
  if (e instanceof AcpTurnFailed) return !e.partial?.sessionId;
  // A spawn that never produced an AcpTurnFailed at all — ENOENT, a permission error, the module not
  // loading. Nothing reached a session either.
  return true;
}

export const fableEngine: ForgeEngine = async (task, ctx) => {
  const env = ctx.env ?? process.env;
  const bin = fableBinary(env);
  const prompt = `${task}\n\n${ctx.brief ?? FORGE_CONTEXT}`;
  const log = ctx.onEvent ? (line: string) => ctx.onEvent!({ t: 'log', line }) : undefined;

  // ── ACP FIRST ────────────────────────────────────────────────────────────────────────────────
  let acpDetail = '';
  {
    try {
      const turn = await runTurn({
        cwd: ctx.repoRoot,
        prompt,
        spawn: fableAcpSpawn(env),
        signal: ctx.signal,
        onUpdate: log ? (_u, method) => log(`acp ${method}`) : undefined,
      });

      // A non-zero count means the agent asked US to authorize a tool call and `core/acp/client.ts`
      // answered `cancelled`. The turn completed; what it was allowed to do did not. Said, never
      // swallowed — a round that was blocked must not read like a round that chose to do nothing.
      const asked = turn.permissionRequests > 0
        ? `\n\nNOTE: the agent asked for tool permission ${turn.permissionRequests} time(s) and φ answered `
          + 'cancelled every time — φ does not authorize on the owner\'s behalf. Nothing this turn '
          + 'attempted through those calls happened.'
        : '';

      return {
        code: 0,
        // HIS ANSWER FIRST, bookkeeping after — the defect `grokEngine` had to fix twice, not
        // reintroduced here: a turn that answers a question in prose must not surface as a blank.
        said: turn.text?.trim() || undefined,
        out: (turn.text ? `${turn.text.trim()}\n\n` : '')
          + `fable session ${turn.sessionId || 'unknown'} · ${turn.toolCalls.length} tool call(s) · `
          + `stop: ${turn.stopReason ?? 'unknown'} · transport: acp`
          + asked
          + (turn.diagnostics ? `\n\n${turn.diagnostics.slice(-2000)}` : ''),
      };
    } catch (e) {
      const detail = e instanceof AcpTurnFailed ? e.message : (e as Error)?.message ?? 'unknown';
      if (!acpUnsupported(e)) {
        // A real ACP engine that failed a real turn. Not a transport question — report it, and let the
        // accounting decide, because the agent may have written files before it died.
        return { code: 1, out: `fable ACP turn failed: ${detail}` };
      }
      // The stderr the binary printed while refusing the subcommand lives in `diagnostics`, not in the
      // message — and it is the only place an owner can read WHY the ACP shape was not understood.
      // Dropping it is how the first draft of `acpUnsupported` came to match nothing.
      const said = e instanceof AcpTurnFailed ? e.partial?.diagnostics?.trim() : '';
      acpDetail = said ? `${detail} — ${said.slice(-300)}` : detail;
    }
  }

  // ── CLI FALLBACK ─────────────────────────────────────────────────────────────────────────────
  if (log) log(`fable: ACP did not answer (${acpDetail.slice(0, 160)}) — falling back to the print mode`);
  const r = await run(bin, fableCliArgs(prompt, env), {
    cwd: ctx.repoRoot,
    timeoutMs: FORGE_TIMEOUT_MS,
    env: ctx.env,
    signal: ctx.signal,
    onLine: log,
  });
  return {
    code: r.code,
    // WHICH TRANSPORT ACTUALLY SERVED THE ROUND, in the round's own words. The registry's `transport`
    // field names a PREFERENCE; only this names a fact, and the two are allowed to differ.
    out: `${r.out}\n\ntransport: cli (ACP was tried first and did not answer: ${acpDetail.slice(0, 200)})`,
  };
};

/**
 * Does this node have a Fable seat that could be sat in? A statement about THIS FILE, never a probe.
 *
 * The sibling of `localEngineRunsRounds()`: a literal a caller can read without spawning anything, so
 * "is there a driver" and "does the binary answer" stay separate questions with separate answers.
 */
export function fableEngineIsWired(): true {
  return true;
}
