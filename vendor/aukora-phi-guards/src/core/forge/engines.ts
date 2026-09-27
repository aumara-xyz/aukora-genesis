// φ — WHICH HAND DOES THE WORK, and whether it can actually do it.
//
// ══ WHY A REGISTRY, AND WHY IT PROBES ══
//
// The door decided the engine with `const wantGrok = b.engine === 'grok'`, in two places, and everything
// that was not that string silently became crush. A surface cannot render a choice it is not told about,
// so the owner met one engine and a query parameter nobody could see.
//
// The harder half is the word AVAILABLE. This repository has now been bitten four times by a NAME being
// trusted where a RESOLUTION was required, and the closest relative is `surface/key.ts`: a non-empty
// string was treated as a working key, so a dead credential inherited from an old install won by
// position and handed every engine a 401. A binary on $PATH is the same shape of claim. So availability
// here is MEASURED — the binary is actually run, and only a clean exit counts.
//
// ══ AND A CLEAN --version IS STILL NOT A WORKING ENGINE ══
//
// This is no longer a warning. It happened. The owner lost a DAY to `forge_failed (exit 1)` because
// crush was pinned to a provider it had no credentials for while its OpenRouter key sat unused in the
// same config — and this file had checked that the crush BINARY EXISTED and concluded it could work.
// The fifth time this project has trusted a NAME where a RESOLUTION was required.
//
// So there are now THREE separate claims here and they must never be collapsed into each other:
//
//   available   the binary ran and exited cleanly. A fact about a file on disk.
//   readiness   the engine resolves something that could actually serve a round. PREFLIGHT, three-valued
//               like `validateKey`, and only an authoritative negative may disqualify.
//   liveProven  a round has ACTUALLY completed through this engine. Not a check — a history.
//
// ══ MEASURED ON THIS MACHINE — RE-RUN 2026-08-01, crush v0.86.0 ══
//
// The block below was written on 2026-07-30 against v0.87.0 and three of its four lines had gone
// stale by the time anyone checked. That is the ordinary fate of a measurement written in prose: the
// machine moves and the paragraph does not. Every number here was re-taken today, and where the old
// claim survived it is marked so, because "still true" is itself a measurement.
//
//   crush   `crush --version` → `crush version v0.86.0`, exit 0, 0.04–0.06s over three runs.
//           NOTE THE VERSION WENT DOWN, not up: the comments cited v0.87.0 and the installed binary
//           is v0.86.0. Nobody wrote a wrong number — the machine was rolled back under a comment
//           that had no way to notice.
//           The preflight (see CRUSH_PREFLIGHT_SENTINEL) runs 3.00–3.29s, exit 1, spends no tokens,
//           and still stops exactly where it is supposed to: `Failed to override models: small model
//           "aukora-preflight/no-such-model" not found.` Slower than the 1.8–2.9s recorded for
//           v0.87.0, and still comfortably inside READINESS_TIMEOUT_MS.
//           Configuration still comes entirely from the ENVIRONMENT: `crush dirs` reports
//           `~/.config/crush`, which STILL does not exist here, and `~/.local/share/crush`, which
//           does. `crush models` was tried as a readiness check and REJECTED — it prints the whole
//           bundled catalogue even with every credential removed, so it answers a question about
//           that shared directory and none about this machine.
//   grok    NOW ON PATH — `/Users/…/.local/bin/grok`, alongside the `~/.grok/bin/grok` the installer
//           writes, with `~/.grok/auth.json` present. The old line said "not on PATH", and the whole
//           paragraph after it explained why the presence probe and the session check disagreed on
//           this machine. They no longer disagree here. They remain separate fields for the reason
//           that has not changed: a hosted node has the session and no binary at all.
//   claude  on PATH, and `claudeBinary()` resolves it at `~/.local/bin/claude` before PATH is ever
//           consulted. Availability is `claude --version` / `--help`; no measured credential
//           preflight — presence is as far as honesty goes without inventing an answer about
//           sign-in. Not liveProven until a real headless round completes.
//   codex   no driver in this repository.
//
// WHAT THE PREFLIGHT LEAVES BEHIND, corrected. The note under CRUSH_PREFLIGHT_SENTINEL concluded "no
// session is created" from the evidence "`.crush/crush.db` mtime did not move". The conclusion is
// right and the evidence only holds on the second run: in a repository with no `.crush/`, the first
// preflight CREATES `.crush/crush.db` (90112 bytes, schema only) and `.crush/logs/crush.log`. Asked
// directly — `select count(*) from sessions` — the answer is 0, and a repeat preflight leaves the
// file byte-identical (same sha256, same size, same mtime). So the claim survives, measured properly
// this time: the preflight costs a schema file once and a session never.

import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { crushEngine, engineTail, forgeChildEnv, forgeRepoRoot, type ForgeEngine } from './crush';
import { claudeEngine, claudeBinary } from './claudeEngine';
// `grokEngine` (the ACP driver) is deliberately NOT imported. `5bb6ebe` made `grokChatBuilder` the
// registered hand for `grok` — the hosted node has no `grok` binary and a live chat session is enough —
// and the ACP import stayed behind, unused, telling every reader of this table that grok runs over ACP.
// The module is still on disk; nothing here resolves to it.
import { grokChatBuilder } from './grokChatBuilder';
import { nebiusEngine, nebiusHealth, NEBIUS_URL } from './nebiusEngine';
import { fableEngine, fableBinary, fableAcpArgs } from './fableEngine';
import { grokBinary } from '../acp/client';

export type EngineId = 'crush' | 'grok' | 'claude' | 'nebius' | 'codex' | 'fable';

/** How φ would talk to it. `none` means there is nothing to talk to yet. */
export type EngineTransport = 'cli' | 'acp' | 'none';

// ENGINE_IDS IS DERIVED FROM THE REGISTRY, and is declared below it for that reason. It used to be a
// hand-written array annotated `readonly EngineId[]` — which is an ANNOTATION, not a constraint, so an
// id added to the union and to `REGISTRY` and forgotten here compiled cleanly, was accepted by
// `isEngineId` and `pickEngine` (both of which read REGISTRY), and was silently missing from
// `listEngines` — and therefore from `GET /api/forge/engines` and from the engine pills on the glass.
// A registered engine nobody can see is the frozen-APPS defect in a second organ.
//
// No test could have caught it either: both suites that enumerate engines compare `listEngines()`
// against `ENGINE_IDS`, and `listEngines` ITERATES `ENGINE_IDS` — so the assertion was
// `map(ENGINE_IDS) === ENGINE_IDS`, which is true no matter what is missing from both.
// (`test/engines.test.ts:316`, `:983`.) Found while adding `fable`, which is exactly the operation
// that would have tripped it.
export const DEFAULT_ENGINE: EngineId = process.env.AUKORA_HOSTED === '1' || process.env.AUKORA_MIND === 'grok' ? 'grok' : 'crush';

export interface EngineStatus {
  id: EngineId;
  /** Probed, never assumed. True only when the engine's binary ran and exited cleanly. */
  available: boolean;
  /** Has a round ACTUALLY completed through this engine? Not "should work". */
  liveProven: boolean;
  transport: EngineTransport;
  /**
   * What would have to be present for this engine to work — a binary NAME, or `driver`.
   *
   * THE NAME, NOT THE PATH WE HAPPENED TO PROBE, and the distinction is not cosmetic. `claudeBinary()`
   * and `grokBinary()` resolve where their installers actually put things, so the probe correctly asks
   * about `/Users/<someone>/.local/bin/claude`. This field went out over HTTP carrying that string —
   * to the surface, and to anything else that can GET `/api/forge/engines` on a hosted node.
   *
   * Two things wrong with it, and the smaller one is the disclosure of an operator's `$HOME`. The
   * bigger one is that it is not ACTIONABLE: the owner cannot install a path. He installs `claude`.
   * The resolved argv is still reported verbatim in `note`, which is where a detail that varies by
   * machine belongs.
   */
  missing?: string[];
  /** What actually happened when we asked, plus the standing caveat. Shown to the owner verbatim. */
  note?: string;
  /**
   * CAN THIS ENGINE ACTUALLY RUN A ROUND? A deeper and more expensive question than `available`.
   *
   * ABSENT MEANS NOBODY ASKED — it is not a fourth verdict. The check costs a subprocess, so it runs
   * only where it is worth paying for (`listEngines`, and therefore `GET /api/forge/engines`) and not
   * on the round's own critical path. A field that said `unknown` for "we did not ask" would make an
   * unasked question indistinguishable from an unanswerable one, which is the exact confusion the
   * three-valued vocabulary exists to prevent.
   */
  readiness?: Readiness;
  /** Actionable when not-ready; names what could not be asked when unknown; names the standing caveat
   *  when ready. Always present when `readiness` is. */
  readyReason?: string;
}

export interface ProbeResult {
  ok: boolean;
  detail: string;
  /**
   * `false` when NOTHING WAS LEARNED — a probe that timed out, or a prober that threw.
   *
   * Absent means the answer is conclusive, which is what a real spawn's negative always is: ENOENT is a
   * fact about this machine. This bit exists so the deeper readiness claim below cannot inherit a
   * certainty the shallow one never had. `available` is unchanged by it and stays exactly as strict as
   * it was.
   */
  conclusive?: boolean;
}

/**
 * ══ PREFLIGHT: A DIFFERENT QUESTION FROM PRESENCE ══
 *
 * `available` asks whether a binary answers. THIS asks whether a round can complete. They came apart
 * expensively: the owner lost a day to `forge_failed (exit 1)` because crush was pinned to a provider it
 * had no credentials for while its OpenRouter key sat unused in the same config. `crush --version`
 * answered perfectly the whole time.
 *
 * The verdict vocabulary is `validateKey`'s in `surface/key.ts`, deliberately and for the same reason:
 * two values would be wrong. A timeout, an offline laptop or a check that could not be run means we
 * learned NOTHING, and a candidate must never be disqualified for that. ONLY AN AUTHORITATIVE NEGATIVE
 * MAY DISQUALIFY. Inconclusive is not negative.
 */
export type Readiness = 'ready' | 'not-ready' | 'unknown';

export interface ReadinessRun {
  /** null when the process never exited on its own — see `timedOut` / `spawnError`. */
  code: number | null;
  out: string;
  /** We stopped waiting. Nothing was learned; this must never become a negative. */
  timedOut?: boolean;
  /** It could not be started at all. This IS authoritative — it is a fact about this machine. */
  spawnError?: string;
}

export interface ReadinessFile {
  ok: boolean;
  text?: string;
  /**
   * `true` only for "this file is not here", which is an authoritative fact. An unreadable file is a
   * DIFFERENT answer: a permissions error means we could not ask, and a session that exists is not
   * disqualified by our inability to look at it.
   */
  missing?: boolean;
  error?: string;
}

/**
 * Everything a readiness check is allowed to touch, in one injectable object.
 *
 * A test that had to spawn crush, read this machine's `~/.grok/auth.json` or consult the wall clock
 * would go green or red for reasons unrelated to the code — and would pass most reliably on exactly the
 * machine where the defect could never be reproduced. `test/engines.test.ts` fakes all four.
 */
export interface ReadinessWorld {
  /** `env` is the environment the ROUND would use, not this process's. See `forgeChildEnv`. */
  run(bin: string, args: string[], timeoutMs: number, env?: NodeJS.ProcessEnv): Promise<ReadinessRun>;
  readFile(path: string): ReadinessFile;
  now(): number;
  home(): string;
  /**
   * THE NETWORK, AND IT BELONGS HERE BECAUSE THIS INTERFACE ALREADY CLAIMED IT.
   *
   * The paragraph above says "everything a readiness check is allowed to touch, in one injectable
   * object", and it was a subprocess runner, a file reader and a clock — no network. `nebiusReadiness`
   * needs none of those and one HTTP question, so it took a `fetchImpl` PARAMETER instead, defaulting
   * to the global. That seam was reachable from nothing: `askReadiness` calls `spec.ready(world,
   * budget, childEnv)` with three arguments, so the fourth was always the real `fetch`.
   *
   * MEASURED: with the whole suite otherwise sealed — zero crush spawns — pointing `AUKORA_NEBIUS_URL`
   * at an unroutable address still took `test/engines.test.ts` from 1.5s to 105s and failed 11 tests.
   * A seam a test cannot reach is not a seam; it is a comment about one. This repository's own rule:
   * a capability that cannot be demonstrated does not exist.
   */
  fetch: typeof fetch;
}

/**
 * A model id that cannot resolve, and the reason the crush preflight costs nothing.
 *
 * MEASURED on crush v0.87.0, 2026-07-30; the ORDERING re-confirmed on v0.86.0, 2026-08-01. `crush
 * run` checks in this order:
 *
 *   1. a prompt is present            → "No prompt provided."
 *   2. PROVIDER RESOLUTION            → "No providers configured - please run 'crush' to set up a
 *                                        provider interactively."   ← the answer we want
 *   3. the model override resolves    → 'Failed to override models: small model "X" not found.'
 *   4. the model is actually called   → "…unauthorized: User not found.."
 *
 * Handing `--small-model` an id that cannot exist makes crush stop at step 3 — AFTER it has resolved
 * providers and BEFORE it has spoken to a model. Timed at 1.8–2.9s on v0.87.0 and 3.00–3.29s on
 * v0.86.0, exit 1, zero tokens.
 *
 * NO SESSION IS CREATED — and the evidence for that used to be "the repository's `.crush/crush.db`
 * mtime did not move", which is only true from the SECOND run onward. In a repository that has no
 * `.crush/` yet, the first preflight creates `crush.db` (90112 bytes of schema) and `logs/crush.log`.
 * Asked the database directly instead of watching a timestamp: `select count(*) from sessions` → 0,
 * and a repeat preflight leaves the file byte-identical. Same conclusion, evidence that does not
 * depend on which run you happened to watch.
 *
 * `--small-model` and not `-m`: `-m` REPLACES the large-model pin, which is the very thing a round uses
 * and therefore the thing worth resolving. Overriding the small model leaves the real pin to be resolved
 * from the real config, which is what the round will meet.
 */
export const CRUSH_PREFLIGHT_SENTINEL = 'aukora-preflight/no-such-model';

/**
 * Inert on purpose. It is not expected to reach a model — the sentinel above stops crush first — but
 * "not expected" is not "cannot", so if some future crush accepted the sentinel this must be a prompt
 * that asks for no work rather than an instruction that would edit the owner's repository.
 */
const CRUSH_PREFLIGHT_PROMPT = 'aukora preflight: answer nothing, change nothing';

/** Where grok keeps the session, relative to home. Measured on this machine 2026-07-30. */
export const GROK_AUTH_FILE = '.grok/auth.json';

/** Injectable so a test can drive this without a binary, a PATH, or a process. */
export interface Prober {
  (bin: string, args: string[], timeoutMs: number): Promise<ProbeResult>;
}

export interface ProbeOptions {
  prober?: Prober;
  /** Total budget for ONE engine, across every argv form tried. */
  timeoutMs?: number;
  /** Also ask the deeper question. Off by default: it costs a subprocess per engine. */
  readiness?: boolean;
  /** Injectable so a readiness test needs no process, no network and no ~/.grok. */
  world?: ReadinessWorld;
  /** The environment the round would use. Defaults to the round's own builder — see `defaultChildEnv`. */
  childEnv?: () => Promise<NodeJS.ProcessEnv>;
  readinessTimeoutMs?: number;
}

/**
 * ══ A HALF-INJECTED FIXTURE IS THE WHOLE DEFECT, AND IT HAD NO NAME UNTIL IT WAS MEASURED ══
 *
 * There are two seams here — `prober` (does the binary answer) and `world` (can it serve a round) —
 * and `world` defaulted to `realWorld` on its own. So a caller could fake ONE of them and be silently
 * handed the real machine for the other. Every test in `test/engines.test.ts` did exactly that, and the
 * file's own header said the opposite in as many words:
 *
 *     "these tests drive that with an injected prober, so nothing below needs a binary, a network or
 *      a process to be exercised."
 *
 * MEASURED with a PATH shim that logged its own argv: that suite ran FIVE real `crush run` preflights
 * against the owner's live repository, per run, and reached the network. Shimmed it takes 1.93s; with
 * the real binary ~17s; with the Nebius endpoint pointed at an unroutable address it takes 105s and
 * fails 11 tests. That is `T-WWR` — 2 red runs in 20 serial ones on unmodified `main`, always the same
 * 5000ms signature, because `READINESS_TIMEOUT_MS` (10s) is twice bun's default per-test budget (5s):
 * a check in that band is killed as a test failure before its own deadline can turn it into `unknown`.
 *
 * The fix is not "remember to pass a world". Nobody remembers, and the thing that goes wrong when they
 * forget is invisible — green tests that quietly drive the owner's machine. So the fence is a TYPE:
 *
 *   · `listEngines` is the only entry point that turns readiness on for you (see below), so it is the
 *     only one that can hand an unwitting caller to `realWorld`. Its options are all-or-nothing —
 *     either you injected NEITHER seam and you get the real machine on purpose, or you injected BOTH.
 *     `listEngines({ prober })` is now a compile error, and `tsc` names every site.
 *   · `engineStatus`/`pickEngine` keep the loose `ProbeOptions`: readiness is OFF there unless asked
 *     for, and a prober-only injection genuinely never reaches a world. `askReadiness` carries the
 *     runtime belt for the one path a type cannot see — `engineStatus(id, { readiness: true, prober })`.
 */
export type HermeticProbeOptions = Omit<ProbeOptions, 'prober' | 'world' | 'readiness'>
  & { prober: Prober; world: ReadinessWorld };
export type ListEnginesOptions =
  | Omit<ProbeOptions, 'prober' | 'world' | 'readiness'>
  | HermeticProbeOptions;

/** Generous next to the 0.03–0.16s `crush --version` measured above; short enough not to stall a page. */
export const PROBE_TIMEOUT_MS = 4_000;

/**
 * Generous next to the 1.8–2.9s measured for the crush preflight, and bounded because it is not only
 * crush's own work: the preflight initialises crush's MCP clients on the way through (seen in
 * `.crush/logs/crush.log`), and a wedged MCP server would otherwise hang a page. A timeout here is
 * `unknown`, never a negative, so a slow machine costs the owner a vague answer and never a false one.
 */
export const READINESS_TIMEOUT_MS = 10_000;

export interface ReadinessVerdict { readiness: Readiness; readyReason: string }

/**
 * THE ROUND'S OWN ENVIRONMENT BUILDER, referenced rather than reimplemented.
 *
 * A preflight is only worth anything if it asks about the thing that will actually run. The first
 * version of this file ran crush with the ambient environment and reported `not-ready` about a working
 * engine, because `forge()` injects the resolved key and the check did not — caught by running it on
 * this machine rather than trusting the green tests. `test/engines.test.ts` asserts this is the SAME
 * function object, not merely an equivalent one.
 */
export const defaultChildEnv = forgeChildEnv;

/**
 * A deadline the CHECKER cannot miss, mirroring `withDeadline` one layer up.
 *
 * The per-`run` timeout only bounds the subprocess. The check around it also resolves a key, which on a
 * cold process means `surface/key.ts` asking OpenRouter whether that key is a key — a network call, and
 * therefore something that can be slow in ways a subprocess timeout never sees. Nothing that sits in
 * front of a page load may be able to wait forever, and a check that ran out of time is `unknown`.
 */
function readinessDeadline(p: Promise<ReadinessVerdict>, ms: number): Promise<ReadinessVerdict> {
  return new Promise<ReadinessVerdict>((resolve) => {
    const t = setTimeout(
      () => resolve({ readiness: 'unknown', readyReason: `the readiness check did not finish within ${ms}ms — nothing was learned` }),
      ms,
    );
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      // A checker that threw is a broken instrument, and a broken instrument must never be able to
      // condemn the thing it was measuring.
      (e) => { clearTimeout(t); resolve({ readiness: 'unknown', readyReason: `the readiness check itself failed: ${(e as Error)?.message ?? 'unknown'}` }); },
    );
  });
}

interface EngineSpec {
  /** null → known id, no driver. The door must say `engine_unavailable`, not `engine_unknown`. */
  engine: ForgeEngine | null;
  transport: EngineTransport;
  /**
   * Argv forms to try, in order. The first clean exit wins; null → nothing to probe.
   *
   * `bin` is RESOLVED — `claudeBinary()`, `grokBinary()` — because probing one path while spawning
   * another is two answers to one question. `name` is what the owner would have to INSTALL, and it is
   * the only one of the two that belongs on the wire. See `missing` on `EngineStatus`.
   */
  probe: { bin: string; name: string; args: string[][] } | null;
  liveProven: boolean;
  /** Carried onto every status for this engine, whatever the probe said. */
  caveat: string;
  /**
   * null → this engine has no deeper question to ask, because it has no driver to ask it of.
   *
   * `prober` is the FOURTH seam and was added for `fableReadiness`, which asks its deeper question by
   * spawning rather than by reading a file or opening a socket. Without it that check would consult the
   * real machine from inside a caller that had injected every other seam — which is the same
   * half-injection the belt in `askReadiness` was written to catch, arriving through a door the belt
   * does not watch. Implementations that do not spawn simply take fewer parameters.
   */
  ready: ((
    w: ReadinessWorld,
    timeoutMs: number,
    childEnv: () => Promise<NodeJS.ProcessEnv>,
    prober: Prober,
  ) => Promise<ReadinessVerdict>) | null;
}

/**
 * Can crush resolve a provider that will answer?
 *
 * See `CRUSH_PREFLIGHT_SENTINEL` for the measured ordering that makes this cost nothing. Every string
 * matched below was captured off crush v0.87.0 on 2026-07-30, not imagined:
 *
 *   no credentials anywhere        → "No providers configured - please run 'crush' to set up a provider"
 *   a provider pinned with no keys → the same, when nothing else has credentials either
 *   credentials the provider hates → "…failed to start agent processing stream: unauthorized: User not found.."
 *   a resolvable provider          → 'Failed to override models: small model "<sentinel>" not found.'
 *
 * WHAT IS DELIBERATELY NOT A NEGATIVE: anything else. An exit code this function has never seen is
 * `unknown` with the words quoted, because a crush that changed its wording must not be able to tell the
 * owner his working engine is broken.
 */
async function crushReadiness(w: ReadinessWorld, timeoutMs: number, childEnv: () => Promise<NodeJS.ProcessEnv>): Promise<ReadinessVerdict> {
  // THE ROUND'S ENVIRONMENT, not this process's. Caught live: without this the preflight reported
  // `No providers configured` about a working crush, because `forge()` injects the resolved key into
  // the child and the check was not. See `forgeChildEnv` in crush.ts for the full account.
  const r = await w.run(
    'crush',
    ['run', '-q', '-c', forgeRepoRoot(), '--small-model', CRUSH_PREFLIGHT_SENTINEL, CRUSH_PREFLIGHT_PROMPT],
    timeoutMs,
    await childEnv(),
  );

  // A binary that cannot be started is an authoritative fact about this machine, not a failure to ask.
  if (r.spawnError) return { readiness: 'not-ready', readyReason: `crush could not be started: ${r.spawnError}` };
  if (r.timedOut) {
    return { readiness: 'unknown', readyReason: `crush did not answer the preflight within ${timeoutMs}ms — nothing was learned` };
  }

  const said = engineTail(r.out, [], 400);
  if (/no providers configured/i.test(said)) {
    return {
      readiness: 'not-ready',
      readyReason: `crush resolved no provider it has credentials for — it said: "${said}". `
        + 'This is the state that cost a day: the binary answers --version perfectly and cannot run a '
        + 'round. Give the node an OPENROUTER_API_KEY (see surface/key.ts for where it is looked for), '
        + 'or run `crush` once and configure a provider.',
    };
  }
  if (/unauthorized|user not found|invalid api key/i.test(said)) {
    return {
      readiness: 'not-ready',
      readyReason: `crush reached a provider and the provider refused the credential — it said: "${said}"`,
    };
  }
  if (said.includes(CRUSH_PREFLIGHT_SENTINEL) && /not found/i.test(said)) {
    return {
      readiness: 'ready',
      readyReason: 'crush resolved a provider with credentials and got as far as the model pin. '
        + 'WHAT THIS DOES NOT PROVE: that the provider will answer, that the account has credit, or '
        + 'that the pinned model exists — the preflight stops before the model is ever called, which '
        + 'is exactly why it costs nothing.',
    };
  }
  // Nothing was expected to succeed here — the sentinel is unresolvable by construction — so a clean
  // exit means a crush that ignored it and ran anyway. That is a working engine, said plainly.
  if (r.code === 0) {
    return { readiness: 'ready', readyReason: 'crush completed the preflight run cleanly' };
  }
  return {
    readiness: 'unknown',
    readyReason: `crush exited ${r.code} with something this check does not recognise: "${said}"`,
  };
}

/**
 * Does grok have a session, and what does that session actually entitle?
 *
 * MEASURED SHAPE, this machine, 2026-07-30: `~/.grok/auth.json` is an object keyed by
 * `<issuer>::<agent-id>`, each entry carrying `key` (a ~900-character JWT), `auth_mode`, `create_time`
 * and `expires_at` — measured six hours apart.
 *
 * THE TRAP THIS CANNOT CLOSE, and it is why a `ready` verdict here still carries a warning: `grok`
 * reported a free-tier refusal for hours while `auth.json` held a perfectly valid, perfectly unexpired
 * token — minted BEFORE the account was upgraded. Entitlements ride inside the token, so an unexpired
 * session is not a funded one, and no amount of reading this file can tell the difference. The mint
 * time is reported because it is the fact the owner needs in order to act on it.
 */
async function grokReadiness(w: ReadinessWorld): Promise<ReadinessVerdict> {
  const path = `${w.home()}/${GROK_AUTH_FILE}`;
  const f = w.readFile(path);

  if (!f.ok) {
    return f.missing
      ? { readiness: 'not-ready', readyReason: `there is no grok session at ~/${GROK_AUTH_FILE} — run \`grok\` once and sign in` }
      // Present but unreadable is a failure to ask, not an answer. A session that exists is not
      // disqualified by our inability to look at it.
      : { readiness: 'unknown', readyReason: `~/${GROK_AUTH_FILE} could not be read: ${f.error ?? 'unknown'}` };
  }

  let doc: Record<string, { key?: unknown; create_time?: unknown; expires_at?: unknown }>;
  try {
    doc = JSON.parse(f.text ?? '') as typeof doc;
    if (!doc || typeof doc !== 'object') throw new Error('not an object');
  } catch (e) {
    return { readiness: 'unknown', readyReason: `~/${GROK_AUTH_FILE} is present but could not be parsed: ${(e as Error)?.message ?? 'unknown'}` };
  }

  // Only entries that actually hold a token count. A file that exists with no credential in it is the
  // same practical state as no file, and it is an authoritative one.
  const sessions = Object.values(doc).filter((v) => v && typeof v === 'object' && typeof v.key === 'string' && v.key.length > 0);
  if (!sessions.length) {
    return { readiness: 'not-ready', readyReason: `~/${GROK_AUTH_FILE} holds no session token — run \`grok\` once and sign in` };
  }

  const now = w.now();
  // An entry with NO recorded expiry is not treated as expired. Absence of a field is not evidence, and
  // guessing the other way would disqualify a working session on a grok that simply records less.
  const stamp = (v: unknown): number | null => {
    const t = typeof v === 'string' ? Date.parse(v) : NaN;
    return Number.isFinite(t) ? t : null;
  };
  const live = sessions.filter((s) => { const e = stamp(s.expires_at); return e === null || e > now; });

  if (!live.length) {
    const latest = sessions
      .map((s) => (typeof s.expires_at === 'string' ? s.expires_at : ''))
      .filter(Boolean)
      .sort()
      .pop() ?? 'an unrecorded time';
    return {
      readiness: 'not-ready',
      readyReason: `the grok session expired at ${latest} — run \`grok\` and sign in again`,
    };
  }

  const minted = live.map((s) => (typeof s.create_time === 'string' ? s.create_time : '')).filter(Boolean).sort().pop();
  return {
    readiness: 'ready',
    readyReason: `a grok session token is present and unexpired${minted ? ` (minted ${minted})` : ''}. `
      + 'WHAT THIS DOES NOT PROVE: what that token is ENTITLED to. Measured, and it cost hours — grok '
      + 'reported a free-tier refusal while this file held a valid token minted before the account was '
      + 'upgraded, because entitlements ride inside the token. If grok refuses on entitlement grounds, '
      + 'sign out and back in so a new token is minted.',
  };
}

/**
 * Claude's binary answered. That is as far as this check goes.
 *
 * Crush has a measured, free preflight that stops before a model is called; grok has a session file
 * whose shape was measured on this machine. Claude has neither recorded here yet. Inventing a
 * credential check without that measurement would be the defect this file is written against — a name
 * trusted where a resolution was required. Presence is the claim; the caveat says what it is not.
 *
 * Called only after the shallow probe already succeeded, so this does not re-spawn the binary.
 */
async function claudeReadiness(): Promise<ReadinessVerdict> {
  return {
    readiness: 'ready',
    readyReason: 'claude answered its presence probe. '
      + 'WHAT THIS DOES NOT PROVE: that you are signed in, that the account has credit, or that a '
      + 'headless `claude -p` round will complete end to end — those have not been measured through '
      + 'this driver yet.',
  };
}

/**
 * Fable's binary answered. HERMETIC — it opens no socket, reads no credential file, spends no token.
 *
 * ══ WHY THIS ASKS WHICH TRANSPORT, AND NOTHING DEEPER ══
 *
 * Every other readiness check here earned its depth from a measurement: crush has a free preflight that
 * stops before a model is called, grok has a session file whose shape was read on this machine, nebius
 * has a tool-choice probe that a mis-started server fails. Fable has NONE OF THAT — there is no `fable`
 * binary on the machine this was written on (checked; see `core/forge/fableEngine.ts`). Inventing a
 * credential check for a binary nobody has run is precisely the defect this file exists against.
 *
 * So the one deeper question that can be asked honestly is WHICH TRANSPORT THE BINARY ANSWERS, which is
 * a question about argv and exit codes and nothing else. It is worth asking because the driver prefers
 * ACP and falls back to the print mode: an owner whose binary speaks only one of them should learn that
 * here rather than from a round that half-works.
 *
 * ══ THE THREE ANSWERS, AND WHY NONE OF THEM IS BORROWED ══
 *
 *   ready       one of the two transports answered. The caveat says what that does not prove.
 *   not-ready   the binary is there and answered NEITHER shape. Authoritative: we asked and it said no.
 *   unknown     the probe did not finish, or the prober itself broke. NOTHING WAS LEARNED, and a slow
 *               machine must cost the owner a vague answer rather than a false negative.
 *
 * The one answer that is never reachable without a positive measurement is `ready` — there is no path
 * through this function that returns it from a session file, a config, or an id being present in a
 * table. That is the #186 trap stated as a property of this function.
 *
 * Called only after the shallow probe already succeeded, so the binary is known to exist; this asks a
 * second, cheap question of a binary that has already answered once.
 */
async function fableReadiness(
  _w: ReadinessWorld,
  timeoutMs: number,
  _childEnv: () => Promise<NodeJS.ProcessEnv>,
  prober: Prober = spawnProber,
): Promise<ReadinessVerdict> {
  const bin = fableBinary();
  const acp = fableAcpArgs();
  // The ACP subcommand with `--help` appended: a question about whether the shape EXISTS, which cannot
  // start a session, cannot open stdio, and cannot spend anything.
  const attempts: { argv: string[]; transport: 'acp' | 'cli'; how: string }[] = [
    { argv: [...acp.slice(0, 1), '--help'], transport: 'acp', how: `${bin} ${acp[0] ?? 'agent'} --help` },
    { argv: ['--help'], transport: 'cli', how: `${bin} --help` },
  ];

  const until = Date.now() + timeoutMs;
  const tried: string[] = [];
  // ONE budget for the whole check, split across attempts — the same rule `measure()` applies to probe
  // argv forms, and for the same reason: two forms each given the full timeout is a promise that takes
  // twice as long, in front of a page load.
  let learnedSomething = false;

  for (const a of attempts) {
    const left = until - Date.now();
    if (left <= 0) { tried.push(`${a.how} was not tried — the ${timeoutMs}ms budget was already spent`); continue; }
    const r = await withDeadline(prober(bin, a.argv, left), left);
    if (r.ok) {
      return {
        readiness: 'ready',
        readyReason: `fable answered the ${a.transport.toUpperCase()} shape (${a.how}). `
          + 'WHAT THIS DOES NOT PROVE: that you are signed in, that the account has credit, or that a '
          + 'round completes end to end — no turn has ever run through this driver. The argv itself is '
          + 'unverified and is overridable (AUKORA_FABLE_ACP_ARGS, AUKORA_FABLE_CLI_FLAG).',
      };
    }
    if (r.conclusive !== false) learnedSomething = true;
    tried.push(`${a.how} ${r.detail}`);
  }

  const note = tried.join('; ');
  return learnedSomething
    ? {
      readiness: 'not-ready',
      readyReason: `the fable binary answered no transport this driver speaks: ${note}. `
        + 'If it spells them differently, set AUKORA_FABLE_ACP_ARGS or AUKORA_FABLE_CLI_FLAG.',
    }
    : { readiness: 'unknown', readyReason: `nothing was learned about fable: ${note}` };
}

/**
 * Is the owner's own GPU serving a model that can actually run an AGENTIC round?
 *
 * ══ SERVING A MODEL AND SERVING AN AGENT ARE DIFFERENT CLAIMS ══
 *
 * MEASURED, and it is the reason this check exists rather than a bare reachability ping. A vLLM server
 * started without `--enable-auto-tool-choice --tool-call-parser` answers `GET /v1/models` perfectly,
 * returns a plain completion in 161ms — and refuses every round crush sends it:
 *
 *     bad request: "auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser
 *
 * A reachability check would have called that endpoint `ready` and handed the owner a hand that cannot
 * hold anything. So this asks the endpoint to do the thing that was actually failing: one tool-choice
 * request, the smallest that exercises the parser, with a trivial tool it will not be tempted to argue
 * with. What comes back is not read for its content — only for whether the server accepted the SHAPE.
 *
 * `unknown` is preserved wherever nothing was learned, per the vocabulary this whole file is built on:
 * a box mid-load reading 57GiB across eight GPUs takes minutes and is not a fault.
 */
async function nebiusReadiness(w: ReadinessWorld, timeoutMs: number, _childEnv: () => Promise<NodeJS.ProcessEnv>): Promise<ReadinessVerdict> {
  // THE WORLD CARRIES THE NETWORK NOW. This took `fetchImpl` as a fourth parameter defaulting to the
  // global `fetch`, and wrote that `_w` was unused on purpose because readiness here is "one HTTP
  // question to a port" rather than a subprocess or a file. The reasoning was right and the wiring was
  // not: `askReadiness` calls `spec.ready(world, budget, childEnv)` with THREE arguments, so the
  // fourth was always the real `fetch` and no caller could ever reach it. See `ReadinessWorld.fetch`.
  const fetchImpl = w.fetch;
  const health = await nebiusHealth(NEBIUS_URL, fetchImpl);
  if (!health.ok) {
    return health.inconclusive
      ? { readiness: 'unknown', readyReason: health.detail }
      : { readiness: 'not-ready', readyReason: health.detail };
  }

  // THE TOOL-PROTOCOL PROBE. `tool_choice: 'auto'` with one tool declared is exactly what crush sends
  // and exactly what a server without the two flags rejects.
  let res: Response;
  try {
    res = await fetchImpl(`${NEBIUS_URL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: (process.env.AUKORA_NEBIUS_MODEL ?? 'nebius/coder').split('/').pop(),
        messages: [{ role: 'user', content: 'reply with the single word ok' }],
        max_tokens: 8,
        tools: [{ type: 'function', function: { name: 'noop', description: 'does nothing', parameters: { type: 'object', properties: {} } } }],
        tool_choice: 'auto',
      }),
    });
  } catch (e) {
    // The endpoint answered `/models` a moment ago, so it exists. A failure HERE is a slow or busy
    // server, not an absent one — inconclusive, never a negative.
    return { readiness: 'unknown', readyReason: `${NEBIUS_URL} is serving, but did not answer a tool-choice probe within ${timeoutMs}ms — nothing was learned about whether tool calling is enabled: ${String((e as Error)?.message ?? e)}` };
  }

  if (res.ok) {
    return {
      readiness: 'ready',
      readyReason: `${health.detail} · tool calling accepted. WHAT THIS DOES NOT PROVE: that a full agentic `
        + 'round completes — only that the endpoint takes the shape crush sends. And sovereignty is not '
        + 'safety: this hand is governed by exactly the same law as every other.',
    };
  }

  // An authoritative rejection, and the one message worth quoting verbatim because it names its own fix.
  const said = (await res.text().catch(() => '')).slice(0, 300);
  if (/enable-auto-tool-choice|tool-call-parser/i.test(said)) {
    return {
      readiness: 'not-ready',
      readyReason: 'the endpoint is serving but was started WITHOUT tool calling — it can answer questions and '
        + 'cannot run a round. Relaunch it with --enable-auto-tool-choice --tool-call-parser qwen3_coder '
        + `(scripts/serve-coder.sh on the box does this). It said: "${said}"`,
    };
  }
  return { readiness: 'not-ready', readyReason: `the endpoint refused a tool-choice probe with HTTP ${res.status}: "${said}"` };
}

const REGISTRY: Record<EngineId, EngineSpec> = {
  crush: {
    engine: crushEngine,
    transport: 'cli',
    probe: { bin: 'crush', name: 'crush', args: [['--version']] },
    // The only engine here that has completed a live round. `core/forge/crush.ts` carries the timings
    // that could only have come from real ones (a real edit to a real file runs ~50s), and the whole
    // forge accounting was built around rounds it actually ran.
    liveProven: true,
    caveat: 'the only engine here that has completed a live round',
    ready: crushReadiness,
  },
  grok: {
    // Chat builder is the hosted hand when ACP agent binary is absent; same proposal/accept law.
    engine: grokChatBuilder,
    transport: 'acp',
    // WHICH FLAG GROK ANSWERS IS UNVERIFIED: it is not installed on the machine this was written on, so
    // both forms are tried and only a clean exit counts. Guessing one and calling a non-zero exit
    // "missing" would invent an absence on a machine that has it.
    // The same resolver the spawn uses. Probing `grok` while spawning `~/.grok/bin/grok` — or the
    // reverse — is two answers to one question, and the owner meets whichever is wrong.
    probe: { bin: grokBinary(), name: 'grok', args: [['--version'], ['--help']] },
    // PROVEN LIVE 2026-07-30, and the claim is retired the same commit that made it false. A real
    // `grok agent --always-approve stdio` turn completed end to end: session
    // 019fb1e3-fb5e-7973-a540-70c9c866a45a, one tool call, stopReason "end_turn", zero permission
    // requests. Both documented protocol uncertainties are settled by that run — `protocolVersion` is
    // accepted as the NUMBER 1, and `stopReason` comes back in the ACP spec's `end_turn` form rather
    // than the `EndTurn` casing Grok's headless JSON prints.
    liveProven: true,
    caveat: 'governed by the witness, and the shell route-around of LIMITS §1 is recorded rather than '
      + 'prevented — measured on the same machine that proved the handshake',
    ready: (w) => grokReadiness(w),
  },
  claude: {
    engine: claudeEngine,
    transport: 'cli',
    // WHICH FLAG CLAUDE ANSWERS IS UNVERIFIED on the machine this was first wired on (binary not on
    // PATH there). Both forms are tried; only a clean exit counts — same posture as grok.
    // The same resolver the spawn uses — probing one path while spawning another is two answers to one
    // question, and the owner meets whichever is wrong.
    probe: { bin: claudeBinary(), name: 'claude', args: [['--version'], ['--help']] },
    liveProven: false,
    caveat: 'headless via `claude -p`; a live forge round through this driver has not been proven yet',
    ready: () => claudeReadiness(),
  },
  nebius: {
    engine: nebiusEngine,
    // The transport IS crush — this engine is crushEngine with the model pinned at an endpoint on the
    // owner's own GPU. Naming it `cli` rather than inventing an `http` transport keeps the field
    // honest about what actually spawns: a `crush run` child, exactly like the crush lane.
    transport: 'cli',
    // AVAILABILITY IS CRUSH, READINESS IS THE ENDPOINT, and the split is the whole point. crush being
    // installed is a fact about this machine that a probe can settle; whether a GPU box eight thousand
    // kilometres away is serving an agent-capable model is a different question, asked below.
    probe: { bin: 'crush', name: 'crush', args: [['--version']] },
    // A live agentic round through this driver is proven in the commit that added it: a real edit to a
    // real file, made by the owner's own hardware, captured as a proposal by the ordinary review gate.
    liveProven: true,
    caveat: "the owner's own GPU — no vendor sees the prompt or the repository; reached over an SSH "
      + 'tunnel because vLLM has no authentication of its own',
    ready: nebiusReadiness,
  },
  fable: {
    engine: fableEngine,
    // THE PREFERRED TRANSPORT, WHICH IS NOT THE SAME CLAIM AS THE TRANSPORT THAT SERVED A ROUND. The
    // driver tries ACP first and falls back to the print mode, and it says which one actually ran in
    // the round's own output. This field is an intention; only that sentence is a fact. Naming an
    // `acp` transport whose driver is not even imported is exactly how `grokEngine.ts` came to tell
    // every reader of this table something that had stopped being true — see the note above the
    // grokChatBuilder import.
    transport: 'acp',
    // WHICH FLAG FABLE ANSWERS IS UNVERIFIED, and more so than for grok or claude: there is no `fable`
    // binary on the machine this was written on at all. Both `--version` and `--help` are tried, only a
    // clean exit counts, and `fableBinary()` is THE SAME RESOLVER THE SPAWN USES — probing one path
    // while spawning another is two answers to one question, and the owner meets whichever is wrong.
    probe: { bin: fableBinary(), name: 'fable', args: [['--version'], ['--help']] },
    // No round has completed through this driver. Not "probably works" — nothing has run.
    liveProven: false,
    caveat: 'a seat, not a proven hand: no `fable` binary was present on the machine this was written '
      + 'on, no round has completed through this driver, and both the ACP and print-mode argv are '
      + `unverified (currently \`${fableAcpArgs().join(' ')}\`, overridable)`,
    ready: fableReadiness,
  },
  codex: {
    engine: null,
    transport: 'none',
    probe: null,
    liveProven: false,
    // Listed rather than omitted, so the surface can say "there is no driver" instead of implying the
    // choice does not exist. Writing one is not this lane's work.
    caveat: 'no driver in this repository yet',
    ready: null,
  },
};

/**
 * Every engine this node knows about, in registry order.
 *
 * DERIVED, never maintained. `REGISTRY` is `Record<EngineId, EngineSpec>`, so the compiler already
 * refuses a union member with no entry; taking the list from its keys makes the reverse impossible
 * too. The union, the registry and the list are now one fact with one place to change it.
 */
export const ENGINE_IDS: readonly EngineId[] = Object.freeze(Object.keys(REGISTRY) as EngineId[]);

export function isEngineId(id: string | undefined): id is EngineId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(REGISTRY, id);
}

/**
 * The hand for an id — crush when nothing was asked for.
 *
 * `null` has TWO causes and they are not the same refusal: an id nobody has heard of (`engine_unknown`)
 * and a known engine with no driver behind it (`engine_unavailable`). This function cannot tell them
 * apart and callers must not guess — ask `isEngineId`, or use `pickEngine` below, which resolves the
 * whole question in one place so the two routes cannot drift apart.
 */
export function resolveEngine(id: string | undefined): ForgeEngine | null {
  const key = (id ?? '').trim();
  if (!key) return REGISTRY[DEFAULT_ENGINE].engine;
  if (!isEngineId(key)) return null;
  return REGISTRY[key].engine;
}

/**
 * Run a binary and see whether it comes back.
 *
 * Never throws and never leaves a child behind: a spawn that fails (ENOENT is the common one) resolves
 * as a plain negative, and a binary that hangs is SIGKILLed at the deadline. `stdout` is captured only
 * so the note can quote what the tool said about itself — `crush version v0.87.0` is a better thing to
 * show a person than the word "yes".
 */
export const spawnProber: Prober = (bin, args, timeoutMs) => new Promise<ProbeResult>((resolve) => {
  let settled = false;
  const finish = (r: ProbeResult) => { if (!settled) { settled = true; resolve(r); } };

  let child;
  try {
    child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    finish({ ok: false, detail: (e as Error)?.message ?? 'could not be started' });
    return;
  }

  let said = '';
  const take = (b: Buffer) => { if (said.length < 400) said += b.toString(); };
  child.stdout?.on('data', take);
  child.stderr?.on('data', take);

  const t = setTimeout(() => {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
    // NOT conclusive. A binary we stopped waiting for has told us nothing about itself, and the deeper
    // readiness claim must not inherit a certainty this never had.
    finish({ ok: false, detail: `did not answer within ${timeoutMs}ms`, conclusive: false });
  }, timeoutMs);

  child.on('error', (e) => { clearTimeout(t); finish({ ok: false, detail: e?.message ?? 'could not be started' }); });
  child.on('close', (code) => {
    clearTimeout(t);
    const first = said.split('\n').map((l) => l.trim()).filter(Boolean)[0] ?? '';
    finish(code === 0
      ? { ok: true, detail: first || 'exited 0' }
      : { ok: false, detail: `exited ${code}${first ? ` — ${first}` : ''}` });
  });
});

/**
 * A deadline the PROBER cannot miss.
 *
 * `spawnProber` already kills its own child, and this is deliberately a second guard rather than a
 * duplicate one: that kill only covers children we spawned. This covers any prober — including an
 * injected one that hangs or rejects — so nothing upstream can be made to wait forever by something
 * below it. A probe that times out is an unavailable engine with a reason, never a hang and never a
 * crash.
 */
function withDeadline(p: Promise<ProbeResult>, ms: number): Promise<ProbeResult> {
  return new Promise<ProbeResult>((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, detail: `did not answer within ${ms}ms`, conclusive: false }), ms);
    p.then(
      (r) => { clearTimeout(t); resolve(r); },
      // A prober that threw is a broken instrument, not a broken engine.
      (e) => { clearTimeout(t); resolve({ ok: false, detail: (e as Error)?.message ?? 'the probe threw', conclusive: false }); },
    );
  });
}

/**
 * The real outside world, and the only place in this file that touches it.
 *
 * `run` is deliberately its own function rather than a reuse of `spawnProber`: a readiness check needs
 * the EXIT CODE and the FULL output, and it needs "could not start" told apart from "ran and failed",
 * which a boolean-plus-first-line cannot express.
 */
export const realWorld: ReadinessWorld = {
  run: (bin, args, timeoutMs, env) => new Promise<ReadinessRun>((resolve) => {
    let settled = false;
    const finish = (r: ReadinessRun) => { if (!settled) { settled = true; resolve(r); } };

    let child;
    try {
      child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env: env ?? process.env });
    } catch (e) {
      finish({ code: null, out: '', spawnError: (e as Error)?.message ?? 'could not be started' });
      return;
    }

    let out = '';
    const take = (b: Buffer) => { if (out.length < 8_000) out += b.toString(); };
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);

    const t = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      finish({ code: null, out, timedOut: true });
    }, timeoutMs);

    child.on('error', (e) => { clearTimeout(t); finish({ code: null, out, spawnError: e?.message ?? 'could not be started' }); });
    child.on('close', (code) => { clearTimeout(t); finish({ code: code ?? -1, out }); });
  }),

  readFile: (p) => {
    try {
      return { ok: true, text: readFileSync(p, 'utf8') };
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      // ABSENT AND UNREADABLE ARE DIFFERENT FACTS, and collapsing them is how a permissions error would
      // come to mean "you never signed in".
      return { ok: false, missing: err?.code === 'ENOENT', error: err?.message ?? 'unreadable' };
    }
  },

  now: () => Date.now(),
  home: () => homedir(),
  // The global itself, so the type is exactly `typeof fetch` and nothing is re-declared here. What a
  // fake supplies in its place is the whole point; see `fakeWorld` in test/engines.test.ts.
  fetch,
};

/**
 * Probed once per process.
 *
 * Whether crush is installed does not change while a node is running, and this sits in front of every
 * forge round — a spawn per request would be a real cost for an answer that does not move. Only the
 * default prober is cached: a caller that injected its own has said it wants THAT answer, and serving it
 * a leftover from the real PATH (or leaving one behind for the next caller) would make the cache the
 * thing that decides. The same rule covers an injected `world`, for the same reason.
 *
 * TWO ENTRIES PER ENGINE, keyed by whether readiness was asked for. A shallow answer served to a caller
 * that asked the deeper question would silently drop the preflight; a deep answer served to `pickEngine`
 * would put a subprocess back on the round's critical path, which is the cost this split exists to
 * avoid.
 *
 * The cost of caching, stated rather than hidden: a node that was running when crush was installed — or
 * when the owner fixed his provider config — goes on reporting the old answer until it is restarted.
 * `forgetEngineProbes()` clears both the probe and the readiness verdict, and nothing calls it outside
 * the tests: no route exposes it, because "re-check on demand" is a request the door would then have to
 * rate-limit, and a restart already answers it.
 */
const cached = new Map<string, Promise<EngineStatus>>();
export function forgetEngineProbes(): void { cached.clear(); }

export function engineStatus(id: EngineId, opts: ProbeOptions = {}): Promise<EngineStatus> {
  if (opts.prober || opts.world) return measure(id, opts);
  const key = `${id}:${opts.readiness ? 'ready' : 'probe'}`;
  const hit = cached.get(key);
  if (hit) return hit;
  const fresh = measure(id, opts);
  cached.set(key, fresh);
  return fresh;
}

/**
 * `$HOME` OUT OF ANYTHING THAT GOES ON THE WIRE.
 *
 * MEASURED against a door booted exactly as `scripts/serve-hosted.sh` boots one, with a plain curl
 * carrying no cookie and no bearer — `GET /api/forge/engines` is open by design, and it answered:
 *
 *     note: "/Users/<someone>/.local/bin/claude --version EACCES: permission denied, posix_spawn
 *            '/Users/<someone>/.local/bin/claude'"
 *
 * It takes both halves to get there, which is why reading the code did not find it: `claudeBinary()`
 * has to RESOLVE an absolute path (it does, before PATH is ever consulted — a name trusted where a
 * resolution was required is this repository's oldest defect) and the probe then has to FAIL. An
 * installed-but-unrunnable binary is not exotic: a partial install, a bad chmod, a quarantined
 * download. The route's own comment claims it "names capabilities, never a path, a key or an
 * identity", and that was true of every field except the one written to be read by a person.
 *
 * A REDACTION, NOT A SILENCING. `missing` already carries the actionable name (`claude`) and the note
 * keeps the argv and the operating system's own words, which is everything an operator needs. What it
 * loses is the one part they already know and a stranger should not: where their home is.
 */
function redactHome(s: string | undefined): string | undefined {
  if (!s) return s;
  const home = homedir();
  // `split`/`join` rather than a regex: a home directory is arbitrary text and may contain regex
  // metacharacters. Both the real path and its `/private` prefix on macOS, where `os.homedir()` and a
  // resolved `realpath` disagree about the same directory.
  return [home, `/private${home}`].reduce((acc, h) => (h ? acc.split(h).join('~') : acc), s);
}

async function measure(id: EngineId, opts: ProbeOptions): Promise<EngineStatus> {
  const spec = REGISTRY[id];
  const base = { id, liveProven: spec.liveProven, transport: spec.transport };
  const wanted = opts.readiness === true;
  // Every exit from this function goes through `told`, so a new return cannot forget the redaction.
  const told = (st: EngineStatus): EngineStatus => ({ ...st, note: redactHome(st.note), readyReason: redactHome(st.readyReason) });

  if (!spec.engine || !spec.probe) {
    return told({
      ...base, available: false, missing: ['driver'], note: spec.caveat,
      // Authoritative: there is no driver in this repository, and that is not a thing a check could
      // have failed to learn.
      ...(wanted ? { readiness: 'not-ready' as const, readyReason: `there is no driver for ${id} in this repository — nothing can run a round` } : {}),
    });
  }

  const prober = opts.prober ?? spawnProber;
  const budget = opts.timeoutMs ?? PROBE_TIMEOUT_MS;
  const until = Date.now() + budget;
  const tried: string[] = [];
  // Did any argv form come back with a real answer? If every attempt was a timeout or a broken prober,
  // this engine is unavailable AND unexplained, and the readiness verdict must say so rather than
  // borrow a confidence nobody earned.
  let learnedSomething = false;

  for (const args of spec.probe.args) {
    const argv = `${spec.probe.bin} ${args.join(' ')}`;
    // ONE budget for the whole engine, not one per argv form: two forms each given the full timeout is
    // a four-second promise that takes eight, and this sits in front of a page load.
    const left = until - Date.now();
    if (left <= 0) { tried.push(`${argv} was not tried — the ${budget}ms budget was already spent`); continue; }
    const r = await withDeadline(prober(spec.probe.bin, args, left), left);
    if (r.ok) {
      const status: EngineStatus = { ...base, available: true, note: [r.detail, spec.caveat].filter(Boolean).join(' · ') };
      if (!wanted) return told(status);
      return told({ ...status, ...await askReadiness(spec, opts) });
    }
    if (r.conclusive !== false) learnedSomething = true;
    tried.push(`${argv} ${r.detail}`);
  }

  // Hosted Grok Build: no `grok` binary, but a live chat session is enough for grokChatBuilder.
  if (id === 'grok') {
    const world = opts.world ?? realWorld;
    const ready = await grokReadiness(world);
    if (ready.readiness === 'ready') {
      const status: EngineStatus = {
        ...base,
        available: true,
        transport: 'cli',
        note: 'Grok chat builder (session token) — proposes edits; nothing sticks without accept',
        ...(wanted ? ready : {}),
      };
      return told(status);
    }
  }

  const note = [tried.join('; '), spec.caveat].filter(Boolean).join(' · ');
  return told({
    ...base,
    available: false,
    // The name he would install, never the path this machine resolved — see `missing` on EngineStatus.
    // `note` already carries `tried`, which is every resolved argv verbatim.
    missing: [spec.probe.name],
    note,
    // THE DEEPER QUESTION IS NOT ASKED OF A BINARY THAT DID NOT ANSWER — there is nothing to ask it of,
    // and spawning it again to hear the same ENOENT would be paying twice for one fact.
    //
    // But the verdict it inherits depends on WHAT the probe learned. A binary that is definitively not
    // there is an authoritative negative. A probe that timed out learned nothing at all, and `available:
    // false` is as far as that goes: the engine may be perfectly fine and simply slow. Reporting that
    // second case as `not-ready` would be the one thing this whole vocabulary exists to prevent.
    ...(wanted
      ? learnedSomething
        ? { readiness: 'not-ready' as const, readyReason: note }
        : { readiness: 'unknown' as const, readyReason: `nothing was learned about ${id}: ${note}` }
      : {}),
  });
}

/**
 * The deeper question, asked of the one engine that knows how to answer it.
 *
 * Never throws: a readiness checker that broke is a broken instrument, and an instrument that fails must
 * not be able to condemn the thing it was measuring. That is the same rule `withDeadline` applies to the
 * prober, one layer up.
 */
async function askReadiness(spec: EngineSpec, opts: ProbeOptions): Promise<ReadinessVerdict> {
  if (!spec.ready) return { readiness: 'not-ready', readyReason: 'there is no driver for this engine in this repository' };
  // ── THE BELT UNDER THE TYPE FENCE. See `ListEnginesOptions` for the measurement behind it. ────────
  //
  // `engineStatus(id, { readiness: true, prober })` is the one route to a half-injected fixture that no
  // type on `listEngines` can reach. A caller that injected a prober has SAID it does not want this
  // machine touched; serving it `realWorld` anyway spawns `crush run` against the owner's repository
  // from inside a unit test. Loud, and naming its own fix, because the silent version of this cost
  // eleven red tests in a suite whose header promised no process at all.
  if (opts.prober && !opts.world) {
    throw new Error(
      'half-injected probe options: a `prober` was supplied without a `world`, so the readiness check '
      + 'would fall through to the REAL machine — spawning `crush run` against the live repository and '
      + 'reaching the network — inside a caller that asked for neither. Inject both seams or neither.',
    );
  }
  const world = opts.world ?? realWorld;
  const budget = opts.readinessTimeoutMs ?? READINESS_TIMEOUT_MS;
  const childEnv = opts.childEnv ?? (async () => (await defaultChildEnv()).env);
  // The whole check is inside the deadline, not just the subprocess — a checker that throws SYNCHRONOUSLY
  // would otherwise escape both guards, which is a real shape: `spec.ready` is an ordinary call before it
  // is ever a promise.
  try {
    // The prober travels WITH the other seams. A readiness check that spawns must be injectable by the
    // same call that injects the world, or `engineStatus(id, { readiness: true, prober, world })`
    // reaches the real machine through the one seam nobody threaded.
    return await readinessDeadline(spec.ready(world, budget, childEnv, opts.prober ?? spawnProber), budget);
  } catch (e) {
    return { readiness: 'unknown', readyReason: `the readiness check itself failed: ${(e as Error)?.message ?? 'unknown'}` };
  }
}

/**
 * Every engine and what this machine can actually do with it. Probes run in parallel.
 *
 * READINESS IS ON HERE BY DEFAULT and off everywhere else. This is the call behind
 * `GET /api/forge/engines`, which exists to tell the owner what his node can do — and "crush is
 * installed" was precisely the answer that cost him a day. The subprocess it costs is paid once per
 * process and then cached.
 */
export function listEngines(opts: ListEnginesOptions = {}): Promise<EngineStatus[]> {
  // `readiness` is forced rather than defaulted, and it is not in `ListEnginesOptions` at all: a caller
  // that could turn it off would be asking a different question through the same door, and the reason
  // this function exists is that "crush is installed" was the answer that cost the owner a day.
  const withReadiness: ProbeOptions = { ...opts, readiness: true };
  return Promise.all(ENGINE_IDS.map((id) => engineStatus(id, withReadiness)));
}

export type EnginePick =
  | { ok: true; id: EngineId; engine: ForgeEngine; status: EngineStatus }
  | { ok: false; error: 'engine_unknown'; id: string }
  | { ok: false; error: 'engine_unavailable'; id: EngineId; status: EngineStatus };

/**
 * The whole decision, in one place, for every route that runs a round.
 *
 * It lives here rather than in the door because the two forge routes had already drifted into two copies
 * of the same three-line guess, and a third caller would have made three.
 */
export async function pickEngine(id: string | undefined, opts: ProbeOptions = {}): Promise<EnginePick> {
  const key = (id ?? '').trim() || DEFAULT_ENGINE;
  if (!isEngineId(key)) return { ok: false, error: 'engine_unknown', id: key };
  const status = await engineStatus(key, opts);
  const engine = REGISTRY[key].engine;
  if (!engine || !status.available) return { ok: false, error: 'engine_unavailable', id: key, status };
  return { ok: true, id: key, engine, status };
}

/** What a refused pick says on the wire. Named here so both routes refuse in identical words. */
export function engineRefusal(pick: Extract<EnginePick, { ok: false }>): {
  ok: false; error: string; engine: string; missing?: string[]; note?: string;
} {
  if (pick.error === 'engine_unknown') return { ok: false, error: pick.error, engine: pick.id };
  return { ok: false, error: pick.error, engine: pick.id, missing: pick.status.missing, note: pick.status.note };
}
