#!/usr/bin/env node
// create-core-session.mjs — PREPARED, NOT RUN. One `CORE` session, created once, after the cutover.
//
// CORE is the conductor inside Auma: a session on the `core` preset, which has no shell, no web tool and a
// read guard that refuses it Peter's keys (`presets/core/agent.cordis.yml`, `plugins/aukora-core-read-deny`).
// This tool is the ONE thing that brings such a session into existence, and it is deliberately the smallest
// possible actor: it creates a session and prints two facts — the session id, and the exact config line
// AUMA's `[core]` binding needs. It does not prompt the session, does not bind it, and does not write app
// state beyond the one creation the controller performs.
//
// FOUR REFUSALS, BECAUSE A SESSION CREATED TWICE OR ON A RELEASE WITHOUT CORE IS A SESSION NOBODY EXPECTED:
//
//   * `release-lacks-core-preset` — the RUNNING release has no `presets/core/agent.cordis.yml`, so a `core`
//     session could not be composed at all. Checked against the release `config.json` names, not the
//     checkout: the checkout is not what runs (`.agents/skills/aukora-release-vs-head`).
//   * `core-session-exists` — a session titled `CORE` is already there. Refused rather than reused, because
//     "which CORE session is THE one" is not a question this tool may answer by picking the newest.
//   * `controller-unavailable` — no controller could be loaded. REFUSED RATHER THAN GUESSED: this tool will
//     not invent a write into Peter's session store, and the probe it ran is printed by name.
//   * `controller-refused` — the controller itself said no; its reason is printed verbatim.
//
// THE CONTROLLER CONTRACT (a module, `--controller <path>`, default `scripts/aukora/core-session-controller.mjs`):
//
//   listSessions(): Promise<Array<{ id: string, title?: string }>>
//   createSession({ title, preset, model, effort }): Promise<{ id: string }>
//
// USAGE: node scripts/aukora/create-core-session.mjs [--support-root <dir>] [--controller <path>]
// EXIT: 0 created, with the id and the config line printed · 1 refused, by name · 2 bad usage.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DEFAULT_SUPPORT = join(homedir(), 'Library', 'Application Support', 'AUKORA');
const DEFAULT_CONTROLLER = join(HERE, 'core-session-controller.mjs');
const TITLE = 'CORE';
const PRESET = 'core';
const MODEL = 'deepseek-official/deepseek-flash';
const EFFORT = 'high';

class Refused extends Error {
  // `detail` IS SET, NOT ONLY PASSED TO `super`: the catch block prints `error.detail`, and a class that
  // only interpolated it into the message made every refusal read `REFUSED: <reason>: undefined` — MEASURED
  // by the court, which is exactly the sort of thing a refusal message must not do.
  constructor(reason, detail) { super(`${reason}: ${detail}`); this.reason = reason; this.detail = detail; }
}
const refuse = (reason, detail) => { throw new Refused(reason, detail); };
const say = (line = '') => { process.stdout.write(`${line}\n`); };
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  if (argv[i + 1] === undefined) refuse('bad-usage', `${name} needs a value`);
  return resolve(argv[i + 1]);
};
const support = option('--support-root', DEFAULT_SUPPORT);
const controllerPath = option('--controller', DEFAULT_CONTROLLER);

// ── THE ROOT THIS PROCESS NAMED IS THE ROOT THE CONTROLLER READS (alpha-8 item 0) ─────────────────────
// MEASURED: `core-session-controller.mjs` takes its support root from `AUKORA_SUPPORT_ROOT` (else the default)
// and REFUSES when the `--support-root` in `process.argv` disagrees with it — a fence the controller's own
// header calls "NOT FENCED HERE: a caller given no --support-root while AUKORA_SUPPORT_ROOT points elsewhere
// checks the default". So a lane that inherited `AUKORA_SUPPORT_ROOT` (or `DSH_HOME`) pointing at ANOTHER tree
// decided which support root this tool inspected, and the operator's own flag lost. The tool knows its
// effective root — the flag or its default — so it DECLARES it to the controller rather than leaving it to
// whatever the environment happened to carry.
process.env.AUKORA_SUPPORT_ROOT = resolve(support);

/** THE RELEASE THAT IS ACTUALLY RUNNING, named by the app's own config — not by the checkout. */
function runningRelease(configFile) {
  if (!existsSync(configFile)) refuse('missing-app-support', `${configFile} is absent: nothing is running from here`);
  const config = readJson(configFile);
  if (typeof config.release !== 'string' || config.release.length === 0) {
    refuse('running-release-unknown', `${configFile} names no release`);
  }
  return config.release;
}

try {
  const configFile = join(support, 'config.json');
  const release = runningRelease(configFile);
  say(`create-core-session`);
  say(`  running release ${release}`);
  const corePreset = join(release, 'presets', 'core', 'agent.cordis.yml');
  if (!existsSync(corePreset)) {
    refuse('release-lacks-core-preset', `${corePreset} is absent, so the running release cannot compose a \`${PRESET}\` session. Cut over to a release that carries the core preset first`);
  }
  say(`  core preset     ${corePreset}`);
  if (!existsSync(controllerPath)) {
    refuse('controller-unavailable', `no controller at ${controllerPath}. The default controller speaks to the app's session API and refuses when it cannot establish the transport; pass --controller with a module exporting listSessions() and createSession({title,preset,model,effort})`);
  }
  const controller = await import(pathToFileURL(controllerPath).href);
  for (const name of ['listSessions', 'createSession']) {
    if (typeof controller[name] !== 'function') refuse('controller-unavailable', `${controllerPath} exports no ${name}()`);
  }
  let existing;
  try { existing = await controller.listSessions(); } catch (error) {
    refuse('controller-unavailable', `${controllerPath}.listSessions() failed: ${String(error?.message ?? error)}`);
  }
  const already = (Array.isArray(existing) ? existing : []).filter((session) => session !== null && typeof session === 'object' && session.title === TITLE);
  if (already.length > 0) {
    refuse('core-session-exists', `${String(already.length)} session(s) titled ${TITLE} already exist (${already.map((s) => String(s.id)).join(', ')}). Refusing to create a second: this tool does not choose which CORE session is THE one`);
  }
  say(`  no ${TITLE} session exists yet (${String(Array.isArray(existing) ? existing.length : 0)} session(s) seen)`);
  let created;
  try {
    created = await controller.createSession({ title: TITLE, preset: PRESET, model: MODEL, effort: EFFORT });
  } catch (error) {
    refuse('controller-refused', `${controllerPath}.createSession() refused: ${String(error?.message ?? error)}`);
  }
  const id = created?.id;
  if (typeof id !== 'string' || id.length === 0) {
    refuse('controller-refused', `${controllerPath}.createSession() returned no session id`);
  }
  say('');
  say(`  CREATED  session ${id}`);
  say(`    title  ${TITLE}`);
  say(`    preset ${PRESET}`);
  say(`    model  ${MODEL}`);
  say(`    effort ${EFFORT}`);
  say('');
  say(`  THE LINE AUMA'S [core] BINDING NEEDS, exactly:`);
  say(`    [core]`);
  say(`    sessionId = ${id}`);
  say(`    preset = ${PRESET}`);
  say(`    model = ${MODEL}`);
  say(`    effort = ${EFFORT}`);
} catch (error) {
  if (error instanceof Refused) {
    process.stderr.write(`REFUSED: ${error.reason}: ${error.detail}\n`);
    process.exit(1);
  }
  throw error;
}
