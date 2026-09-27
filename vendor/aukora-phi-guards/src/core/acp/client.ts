// φ — TOLD DIRECTLY. An ACP client over `grok agent --always-approve stdio`.
//
// ══ WHY A CLIENT AND NOT ANOTHER HOOK ══
//
// The hook lane (`bin/witness.mjs`) only exists if someone installed it, and LIMITS §5 measured that a
// project hook is not read at all until the folder is trusted — clone-and-run is ungoverned with no
// warning. As an ACP client φ is not waiting to be told by a configuration file; it is the party that
// STARTED the agent, and the tool-call updates arrive on a pipe it owns.
//
// That is a robustness and distribution win, and it is exactly as far as it goes. LIMITS §11, restated
// here because this file is where someone would overclaim: **being told directly is not being told
// everything.** An engine that spawns a process without declaring a tool call is invisible to this
// client for the same reason it is invisible to a hook. §8 is untouched by anything in this file.
//
// ══ WHAT IS VERIFIED AND WHAT IS NOT — CORRECTED 2026-08-03 ══
//
// This block used to open: **"This client has never completed a turn against a live Grok agent."** That
// was true when it was written and had stopped being true long before anyone read it again. Measured on
// this disk rather than inferred:
//
//     .aukora/last-acp-turn.jsonl   35,015,867 bytes · 32,087 lines · 0 unparseable
//     46 distinct sessionIds, 2026-07-30T07:38:12Z → 2026-07-31T08:45:54Z (25.1 hours)
//     every line a `session/update` notification written by THIS client's mirror
//
// So the wire behaviour below has been answered by a real `grok agent stdio` process, repeatedly, and
// the two documented disagreements between the published examples are settled by those runs:
// `protocolVersion` is accepted as the NUMBER 1, and `stopReason` comes back in the spec's `end_turn`
// form rather than the `EndTurn` casing Grok's headless JSON prints.
//
// THE SAME STALE CLAIM ALSO STOOD IN `core/forge/grokEngine.ts`, and that is the part worth keeping
// after the fact itself is corrected: a caveat is written once, at the moment of least knowledge, and
// then the machine moves and the paragraph does not. Fixing the copy you happened to open leaves the
// other one standing, and a surviving copy reads as confirmation rather than as an oversight. Both were
// corrected together.
//
// STILL UNPROVEN, so the correction does not overshoot: the scripted fake agent in
// `test/acpclient.test.ts` remains the only thing that exercises the error and timeout paths, and no
// live turn has been run through this client since `5bb6ebe` unwired `grokEngine` from the registry.
//
// ══ WHERE THE TWO PUBLISHED EXAMPLES DISAGREE, AND WHAT WE CHOSE ══
//
//   protocolVersion   `~/.grok/docs/user-guide/15-agent-mode.md` sends the number `1`; the bundled
//                     `~/.grok/README.md` sends the string `"1"`. The ACP spec's initialization page
//                     shows the number. We send the number, and it is overridable.
//   stopReason        The spec enumerates `end_turn` / `max_tokens` / `max_turn_requests` / `refusal` /
//                     `cancelled`; Grok's headless `--output-format json` prints `EndTurn`. We never
//                     branch on it — the turn is over when the RESPONSE to our `session/prompt` id
//                     arrives — and record whatever came back verbatim.
//
// Framing needed no guess. ACP v1 transports: *"Messages are delimited by newlines (`\n`), and MUST NOT
// contain embedded newlines."* `JSON.stringify` escapes newlines inside strings, so one message is
// always one line.
//
// ══ TWO DEFECTS IN THE VENDOR EXAMPLES THAT ARE NOT COPIED ══
//
// Both published TypeScript clients (a) hard-code `id: 1` on every request and (b) resolve a request
// with `rl.once('line', …)` — the NEXT line off stdout. During a prompt turn the next line is almost
// always a `session/update` notification, so that client resolves a request with a notification and
// then mismatches every reply after it. Responses here are matched by id, and ids are monotonic.

import { spawn } from 'child_process';
import { openSync, writeSync, closeSync, mkdirSync, statSync, renameSync, unlinkSync, existsSync } from 'fs';
import { dirname } from 'path';

/** argv for the agent process. Injectable so the tests can drive a fake — nothing here needs Grok. */
export interface AcpSpawn {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}

/** `grok` if the shell can see it, otherwise the path its own installer uses. */
export function grokBinary(): string {
  const home = process.env.HOME ?? '';
  const installed = home ? `${home}/.grok/bin/grok` : '';
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    if (installed && require('fs').existsSync(installed)) return installed;
  } catch { /* fall through to the bare name */ }
  return 'grok';
}

export const GROK_STDIO: AcpSpawn = {
  // RESOLVED, NOT NAMED. Grok's installer puts the binary at ~/.grok/bin/grok and does NOT add that
  // directory to a login shell's PATH — so a node started normally reported `Executable not found in
  // $PATH: "grok"` for a Grok that works perfectly when PATH is exported by hand. The owner would have
  // seen the hand he pays for listed as unavailable, on a machine where it runs.
  //
  // Sixth instance of the same defect class in this project: a NAME trusted where a RESOLUTION was
  // required. `which grok` is a question about the shell's configuration, not about the machine.
  command: grokBinary(),
  args: ['agent', '--always-approve', 'stdio'],
};

/** An ACP `update` object, verbatim. `sessionUpdate` names the kind; the rest varies by kind. */
export interface AcpUpdate {
  sessionUpdate?: string;
  toolCallId?: string;
  title?: string;
  rawInput?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface AcpTurnOptions {
  /** The session's working directory, and the child's. Grok keys its own session store by this path,
   *  so passing the same value both places is what makes `sessionDir(cwd, id)` in reconcile.ts resolve
   *  to the stream this turn produced on Grok's side. */
  cwd: string;
  prompt: string;
  spawn?: AcpSpawn;
  /** Mirror every update notification here, in Grok's own on-disk shape. Omitted → nothing is written. */
  updatesPath?: string;
  /** Bound on one mirror file before it rotates, and on one turn's own writes. Defaults to
   *  `MIRROR_MAX_BYTES`. Injectable so a test can reach the cap without writing 16 MiB. */
  mirrorMaxBytes?: number;
  onToolCall?: (update: AcpUpdate) => void;
  onUpdate?: (update: AcpUpdate, method: string) => void;
  timeoutMs?: number;
  /**
   * Aborted when the owner walks away from the round.
   *
   * Without it an abandoned turn keeps a coding agent alive and the NEXT turn contends with it —
   * measured: three orphaned `grok agent` processes turned an 8-second answer into a minute of nothing.
   * The failure reads as "it got slower the more I used it", which is the worst shape a bug can take.
   */
  signal?: AbortSignal;
  protocolVersion?: number;
  /** Merged into `session/new` `_meta`. `yoloMode: true` is the per-session form of `--always-approve`,
   *  for an agent that was launched without the flag. */
  meta?: Record<string, unknown>;
}

export interface AcpTurn {
  sessionId: string;
  /** The `update` object of every `sessionUpdate: "tool_call"`, exactly as the agent sent it. */
  toolCalls: AcpUpdate[];
  /**
   * WHAT THE AGENT ACTUALLY SAID, joined from its `agent_message_chunk` updates.
   *
   * It was collected by nobody, so a turn that answered a question in prose returned only bookkeeping —
   * "grok session X · 1 tool call · stop: end_turn" — and the owner saw a blank. He asked a question,
   * waited 65 seconds, and the surface showed nothing, because the one thing he wanted was the one
   * thing this object did not carry.
   */
  text: string;
  /** Notifications written to `updatesPath` — a superset of `toolCalls`. See mirroring below. */
  mirrored: number;
  stopReason: string | null;
  updatesPath: string | null;
  /**
   * How many times the agent asked US to authorize a tool call. Under `--always-approve` this is 0, so
   * any other number means the flag did not take and should be visible rather than swallowed.
   */
  permissionRequests: number;
  /** The child's stderr, plus any stdout line that was not JSON. Truncated; for diagnosis only. */
  diagnostics: string;
}

/** A turn that ended badly still saw what it saw. The partial record is attached rather than discarded. */
export class AcpTurnFailed extends Error {
  readonly partial: AcpTurn;
  constructor(message: string, partial: AcpTurn) {
    super(message);
    this.name = 'AcpTurnFailed';
    this.partial = partial;
  }
}

/** Measured in `core/forge/crush.ts`: a real edit to a real file runs ~50s, and a round that reads
 *  several files first runs past 90. A watchdog tuned for a chat reply kills working turns. */
export const ACP_TURN_TIMEOUT_MS = 300_000;
/** Grace between closing the agent's stdin and SIGKILL. Grok writes its own `updates.jsonl` as it goes,
 *  and that file is the second, non-ours record LIMITS §10 rests on — killing instantly can truncate it. */
export const ACP_EXIT_GRACE_MS = 2_000;
/** How long after 'exit' to wait for 'close' before giving up on the pipes. See the handlers below. */
const ACP_EXIT_FLUSH_MS = 250;
/** A line with no newline in sight. A `write` tool call legitimately carries a whole file in `rawInput`,
 *  so this is generous; it exists so a stuck or hostile agent cannot grow the buffer without bound. */
const MAX_LINE_BYTES = 8 * 1024 * 1024;
const MAX_DIAGNOSTICS = 8_000;

/**
 * The bound on ONE mirror file, before it is rotated aside.
 *
 * 16 MiB is chosen against the measurement rather than picked: the largest single session in the 35 MB
 * file that prompted this contributed 2,987 lines, and the largest single line was 152,639 bytes — so a
 * cap has to be far above one turn or it would rotate mid-diagnosis, and far below 35 MB or it is not a
 * cap. Two generations are kept, so the worst case per path is twice this.
 */
export const MIRROR_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Move an oversized mirror aside so the new turn starts clean, keeping exactly one previous generation.
 *
 * ROTATION, NOT DELETION, and never of the live file mid-turn: a diagnostic whose failure mode is "the
 * part you needed is the part that was dropped" has stopped being a diagnostic. `.1` is overwritten,
 * which is what makes this a bound and not a slower leak.
 *
 * Every failure here is swallowed into the turn's diagnostics on purpose. A mirror is a convenience;
 * refusing to run a round because a log file could not be renamed would let the least important thing
 * in this file veto the most important one.
 */
function rotateIfLarge(path: string, maxBytes: number, note: (s: string) => void): void {
  try {
    const size = statSync(path).size;
    if (size < maxBytes) return;
    const prev = `${path}.1`;
    try { if (existsSync(prev)) unlinkSync(prev); } catch { /* a stale generation is not fatal */ }
    renameSync(path, prev);
    note(`\n[mirror] ${path} reached ${size} bytes (cap ${maxBytes}) and was rotated to ${prev}\n`);
  } catch (e) {
    // ENOENT is the ordinary case — there is no mirror yet — and is not worth a note.
    if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      note(`\n[mirror] ${path} could not be rotated: ${(e as Error)?.message ?? 'unknown'}\n`);
    }
  }
}

type Json = Record<string, unknown>;

/**
 * Start the agent, open a session on `cwd`, send one prompt, and resolve when the turn completes.
 *
 * Rejects with `AcpTurnFailed` on spawn failure, agent error, watchdog, or the child exiting before the
 * turn is done — never hangs on any of them, which is the whole reason requests are tracked by id in a
 * map that the exit handler can drain.
 */
export async function runTurn(opts: AcpTurnOptions): Promise<AcpTurn> {
  const spec = opts.spawn ?? GROK_STDIO;
  const toolCalls: AcpUpdate[] = [];
  const said: string[] = [];
  let sessionId = '';
  let stopReason: string | null = null;
  let mirrored = 0;
  let permissionRequests = 0;
  let diagnostics = '';

  const turn = (): AcpTurn => ({
    sessionId,
    toolCalls,
    text: said.join(''),
    mirrored,
    stopReason,
    updatesPath: opts.updatesPath ?? null,
    permissionRequests,
    diagnostics,
  });
  const note = (s: string): void => {
    if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics += s;
  };

  // Opened before the handshake, not on the first update: an empty mirror is the fact "this turn
  // declared nothing", and a run that dies early must not be indistinguishable from one never asked to
  // record. Written with an open fd and `writeSync` per line, so a crash cannot lose a buffer that a
  // deferred flush was still holding.
  //
  // ══ AND IT IS BOUNDED, WHICH IT WAS NOT ══
  //
  // MEASURED, on the machine that ran the live sessions above: `.aukora/last-acp-turn.jsonl` reached
  // 35,015,867 bytes across 32,087 lines and 46 distinct sessions in 25 hours, because this open was
  // `'a'` with no rotation, no truncation and no cap, and the constant that names it is called
  // `last-acp-turn` while the file is EVERY ACP turn ever run there.
  //
  // Size is the smaller half of the problem. The mirror has ZERO READERS — `reconcile.ts` deliberately
  // reads Grok's OWN store, which is the whole reason the engine returns Grok's `sessionId` — and it is
  // unreachable by either forgetting verb: `forget()` marks ids drawn from five named markdown shelves
  // under `.aukora/memory/`, and `forgetOccurrence()` operates only on sealed ledger events. So it
  // accumulated the owner's prompts and the agent's reasoning in a file nothing reads and nothing can
  // forget, and no repo-side hygiene could ever see it because `.aukora/` is gitignored.
  //
  // ROTATION, NOT TRUNCATION. One previous generation is kept: a diagnostic file whose failure mode is
  // "the thing you needed was in the part that got deleted" is not much of a diagnostic. The bound is
  // therefore two generations of `MIRROR_MAX_BYTES` per path, and it is a bound per FILE — a round in a
  // worktree mirrors to that worktree's root, so there is no single total to promise.
  let fd = -1;
  const mirrorCap = opts.mirrorMaxBytes ?? MIRROR_MAX_BYTES;
  let mirrorBytes = 0;
  if (opts.updatesPath) {
    mkdirSync(dirname(opts.updatesPath), { recursive: true });
    rotateIfLarge(opts.updatesPath, mirrorCap, note);
    fd = openSync(opts.updatesPath, 'a');
  }

  const child = spawn(spec.command, spec.args, { cwd: opts.cwd, env: spec.env ?? process.env });

  const pending = new Map<number, { resolve: (v: Json) => void; reject: (e: Error) => void }>();
  let nextId = 1;
  let dead: Error | null = null;

  const failAll = (e: Error): void => {
    dead ??= e;
    for (const [, p] of pending) p.reject(e);
    pending.clear();
  };

  const send = (msg: Json): void => {
    try {
      child.stdin.write(JSON.stringify(msg) + '\n');
    } catch (e) {
      failAll(new Error(`the agent's stdin is gone: ${e instanceof Error ? e.message : String(e)}`));
    }
  };

  const request = (method: string, params: Json): Promise<Json> =>
    new Promise((resolve, reject) => {
      if (dead) { reject(dead); return; }
      const id = nextId++;
      pending.set(id, { resolve, reject });
      send({ jsonrpc: '2.0', id, method, params });
    });

  // An inbound message with BOTH `method` and `id` is a request aimed at us, and an unanswered request
  // deadlocks the turn on the agent's side — it is waiting, we are waiting, the watchdog is the only
  // thing left. Every one of them gets an answer, including the ones we refuse.
  const onRequest = (msg: Json): void => {
    const method = String(msg.method);
    if (method === 'session/request_permission') {
      // We launched with `--always-approve`, so arriving here means that did not take. φ answers
      // `cancelled`, never `selected`. A client that says "allow" to a question it did not expect has
      // quietly appointed itself the authorizer, and this repository has exactly one rule about that.
      // `cancelled` also ends the turn cleanly instead of leaving both sides blocked.
      permissionRequests++;
      send({ jsonrpc: '2.0', id: msg.id, result: { outcome: { outcome: 'cancelled' } } });
      return;
    }
    // We advertise no fs and no terminal capability, so `fs/read_text_file` and friends should never
    // arrive. If one does, -32601 is the answer the agent can recover from; silence is not.
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `φ does not implement ${method}` } });
  };

  const onNotification = (msg: Json): void => {
    const method = String(msg.method);
    // `session/update` and Grok's `_x.ai/session/update` both carry updates — measured on this disk:
    // `tool_call`, `agent_message_chunk` and `tool_call_update` arrive under the plain method, while
    // `hook_execution`, `retry_state` and `turn_completed` arrive under the namespaced one. Keying on
    // the method spelling would have dropped half the stream, so the suffix is what is matched and the
    // update KIND is what is acted on.
    if (!method.endsWith('session/update')) return;
    const params = msg.params as { update?: AcpUpdate } | undefined;
    const update = params?.update;
    if (!update) return;

    // Mirrored in Grok's own on-disk shape, `params` passed through untouched. Everything is written,
    // not just tool calls: Grok's `updates.jsonl` is the whole update stream, and a mirror that filters
    // is a different file that happens to reconcile. `acpToolCalls()` in reconcile.ts already selects
    // `sessionUpdate: "tool_call"` and ignores the rest, so it consumes this with no change.
    // `timestamp` is unix SECONDS because that is what Grok writes (1785384321 in the recorded stream).
    // ROTATION BOUNDS THE FILE ACROSS TURNS; THIS BOUNDS ONE TURN. Without it a single session could
    // still run away — the measured worst case in the 35 MB file was one session contributing 2,987
    // lines with a longest line of 152,639 bytes, and a hostile or looping agent has no such ceiling at
    // all. Stopping is announced ONCE, in the mirror and in the diagnostics: a mirror that quietly
    // stopped recording would be a file that says "this turn declared nothing more", which is the one
    // thing a record must never be able to say by accident.
    if (fd >= 0 && mirrorBytes < mirrorCap) {
      const line = JSON.stringify({ timestamp: Math.floor(Date.now() / 1000), method, params: msg.params }) + '\n';
      writeSync(fd, line);
      mirrorBytes += Buffer.byteLength(line);
      mirrored++;
      if (mirrorBytes >= mirrorCap) {
        const stop = `[mirror] this turn reached the ${mirrorCap}-byte cap; nothing further was mirrored\n`;
        try { writeSync(fd, JSON.stringify({ timestamp: Math.floor(Date.now() / 1000), method: 'aukora/mirror-capped', params: { bytes: mirrorBytes, cap: mirrorCap } }) + '\n'); } catch { /* the notice is best effort */ }
        note(`\n${stop}`);
      }
    }

    if (update.sessionUpdate === 'agent_message_chunk') {
      const c = (update as { content?: { text?: string } }).content;
      if (typeof c?.text === 'string') said.push(c.text);
    }
    if (update.sessionUpdate === 'tool_call') {
      toolCalls.push(update);
      try { opts.onToolCall?.(update); } catch (e) { note(`\n[onToolCall threw] ${String(e)}`); }
    }
    try { opts.onUpdate?.(update, method); } catch (e) { note(`\n[onUpdate threw] ${String(e)}`); }
  };

  const onLine = (line: string): void => {
    if (!line.trim()) return;
    let msg: Json;
    try {
      msg = JSON.parse(line) as Json;
    } catch {
      // Not every byte on an agent's stdout is protocol — a banner, an update nag, a stray warning.
      // Dropping it is right; dropping it silently is not, so it lands in diagnostics.
      note(`\n[non-JSON stdout] ${line.slice(0, 200)}`);
      return;
    }
    if (typeof msg.method === 'string') {
      if (msg.id === undefined || msg.id === null) onNotification(msg);
      else onRequest(msg);
      return;
    }
    if (typeof msg.id !== 'number') return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    const err = msg.error as { code?: number; message?: string } | undefined;
    if (err) p.reject(new Error(`agent error ${err.code ?? '?'}: ${err.message ?? 'no message'}`));
    else p.resolve((msg.result as Json | undefined) ?? {});
  };

  let buf = '';
  child.stdout.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf8');
    if (buf.length > MAX_LINE_BYTES && !buf.includes('\n')) {
      buf = '';
      failAll(new Error(`the agent sent over ${MAX_LINE_BYTES} bytes with no newline — that is not ACP framing`));
      return;
    }
    const parts = buf.split('\n');
    buf = parts.pop() ?? '';
    for (const line of parts) onLine(line);
  });
  child.stderr.on('data', (chunk: Buffer) => note(chunk.toString('utf8')));

  // Writing to a dead child's stdin raises EPIPE as an ASYNC 'error' event on the stream, not as a
  // throw from `write()`. Unhandled, that event takes the whole test runner down with it — so the
  // failure of the thing being tested would present as the harness crashing.
  for (const s of [child.stdin, child.stdout, child.stderr]) {
    s.on('error', (e: Error) => note(`\n[stdio] ${e.message}`));
  }

  // ENOENT lands here, which on a machine without `grok` on PATH is the first thing anyone will hit.
  child.on('error', (e) => failAll(new Error(`could not run \`${spec.command}\`: ${e.message}`)));

  // 'close' and not 'exit'. 'exit' fires when the process ends; the stdio pipes may still hold bytes,
  // so failing pending requests there can discard a response the agent had already written — the turn
  // would report "exited before completing" for a turn that in fact completed. 'close' is emitted only
  // after every stdio stream is done, i.e. after the last 'data' handler above has run.
  // The 'exit' path is kept as a fallback with a flush window, for the case where a grandchild
  // inherited the pipes and 'close' therefore never arrives.
  const killOnAbort = () => { try { child.kill('SIGKILL'); } catch { /* already gone */ } };
  opts.signal?.addEventListener('abort', killOnAbort, { once: true });

  const exited = (code: number | null, signal: string | null): Error =>
    new Error(`the agent exited before the turn completed (code ${code}, signal ${signal})`);
  child.on('close', (code, signal) => failAll(exited(code, signal)));
  child.on('exit', (code, signal) => {
    setTimeout(() => failAll(exited(code, signal)), ACP_EXIT_FLUSH_MS).unref?.();
  });

  let timedOut = false;
  const watchdog = setTimeout(() => {
    timedOut = true;
    failAll(new Error(`no answer within ${opts.timeoutMs ?? ACP_TURN_TIMEOUT_MS}ms`));
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }, opts.timeoutMs ?? ACP_TURN_TIMEOUT_MS);

  try {
    await request('initialize', {
      protocolVersion: opts.protocolVersion ?? 1,
      // Declared false because they ARE false. Claiming `fs`/`terminal` we do not serve would invite
      // requests we can only answer with -32601, mid-turn, after the agent has committed to the path.
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'aukora-phi', title: 'φ witness', version: '0' },
    });

    const created = await request('session/new', {
      cwd: opts.cwd,
      mcpServers: [],
      _meta: { yoloMode: true, ...(opts.meta ?? {}) },
    });
    sessionId = typeof created.sessionId === 'string' ? created.sessionId : '';
    if (!sessionId) throw new Error(`session/new returned no sessionId: ${JSON.stringify(created).slice(0, 200)}`);

    // The turn is complete when THIS response arrives. Not when a `turn_completed` notification shows
    // up (that one is `_x.ai`-namespaced and Grok-specific), and not when `stopReason` says a
    // particular word — the two published sources spell its values differently.
    const done = await request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: opts.prompt }],
    });
    stopReason = typeof done.stopReason === 'string' ? done.stopReason : null;
    return turn();
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    throw new AcpTurnFailed(timedOut ? `ACP turn timed out: ${why}` : `ACP turn failed: ${why}`, turn());
  } finally {
    clearTimeout(watchdog);
    if (fd >= 0) { try { closeSync(fd); } catch { /* best effort */ } }
    await shutdown(child);
  }
}

/** Close stdin and let the agent finish its own writes; SIGKILL only if it will not go. */
async function shutdown(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try { child.stdin?.end(); } catch { /* already closed */ }
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      resolve();
    }, ACP_EXIT_GRACE_MS);
    child.once('exit', () => { clearTimeout(t); resolve(); });
  });
}
