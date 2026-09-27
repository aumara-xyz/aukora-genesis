#!/usr/bin/env node
// desktop-cutover.mjs — ONE COMMAND FOR A DESKTOP CUTOVER, AND IT CANNOT HALF-APPLY.
//
// ── THE OUTAGE THIS EXISTS FOR ──────────────────────────────────────────────────────────────────────
//
// The cutover to aukora-release-caaf716a88eb FAILED AT BOOT. `plugins/aukora-composition-gate/src/
// admission-grant.mjs:32` imports `../../aukora-owner-daemon/lib/binding.mjs`, the materializer never copied
// it, and the process could not start — after the digest was approved and the config.json had already been
// repointed. The release was fine to LOOK at and impossible to RUN, and the change that revealed it was made
// by hand in several files at once.
//
// SO THIS TOOL DOES THREE THINGS AND NOTHING ELSE:
//
//   prepare <release>   refuses unless the release passes AURA's import-closure court AND the boot smoke
//                       (both run through scripts/heavy-run.sh, one heavy run at a time), then prints the
//                       exact diff it WOULD write. It writes nothing.
//   apply <release>     writes timestamped 0600 backups first, then edits ONLY files under the app-support
//                       root, and refuses by name on anything it cannot verify.
//   rollback            restores exactly those backups, byte for byte, from the manifest apply wrote.
//
// WHAT IT NEVER DOES. It never starts, stops or signals a process: Peter quits and reopens the app, so a
// half-applied cutover cannot be blamed on this tool's timing. It never writes outside the support root. It
// refuses to run as a descendant of the live app (upgrade-release.py's rule 5: a process replacing the
// deployment must not BE inside it — the listener sweeps descendants by PPID). It never touches
// aukora-release.json: the launcher reads `approvedRecordSha` (launch-dsh.py:50,66) and the record to digest
// is `.dsh-build/genesis-artifacts.json`.
//
// EXIT: 0 done · 1 refused, with the reason named · 2 bad usage.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { constants as fsConstants } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zstdDecompressSync } from 'node:zlib';

import { readHolder } from '../lib/heavy-run.mjs';
import { isMainModule } from '../lib/is-main.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HEAVY = join(REPO, 'scripts', 'heavy-run.sh');
const CLOSURE = join(REPO, 'scripts', 'aura', 'release-closure.mjs');
const BOOT_SMOKE = join(REPO, 'scripts', 'aura', 'release-boot-smoke.mjs');
const DEFAULT_SUPPORT = join(homedir(), 'Library', 'Application Support', 'AUKORA');
const COMPOSITION_PATCH = 'aukora-composition.patch.yml';
const ARTIFACT_RECORD = join('.dsh-build', 'genesis-artifacts.json');
const RELEASE_MANIFEST = join('.dsh-build', 'aukora-release.json');
const MANIFEST_NAME = 'desktop-cutover.last.json';
// THE RECEIPT `prepare` WRITES AND `apply` REQUIRES (Codex finding 1), and the recovery record a write phase
// leaves behind when it cannot finish (Codex finding 7).
const RECEIPT_NAME = 'desktop-cutover.prepared.json';
const RECOVERY_NAME = 'desktop-cutover.incomplete.json';
const SESSION_LOG = 'session.v3.jsonl.zstd';

/** A refusal: named, printed, and NOTHING has been written when it is thrown. */
class Refused extends Error {
  constructor(reason, detail) { super(`${reason}: ${detail}`); this.reason = reason; this.detail = detail; }
}
const refuse = (reason, detail) => { throw new Refused(reason, detail); };
const say = (line = '') => { process.stdout.write(`${line}\n`); };
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// ── ARGUMENTS ───────────────────────────────────────────────────────────────────────────────────────
const USAGE = `usage: desktop-cutover.mjs prepare <release> [--support-root <dir>] [--minds a,b,c]
       desktop-cutover.mjs apply   <release> [--support-root <dir>] [--minds a,b,c] [--live-app-pid <pid>]
       desktop-cutover.mjs rollback          [--support-root <dir>]

  --home-session  the CORE session id to set as homeSession under aukora-face-apps.
  --support-root  the app-support tree to touch. DEFAULTS TO PETER'S REAL ONE; the courts pass a scratch
                  tree, and the effective root is always printed.
  --minds         minds the RELEASE declares, when the release carries no list of its own. They are MERGED
                  with the live list, which is never dropped.
  --live-app-pid  a pid to treat as the live app IN ADDITION to the ones this tool discovers. The courts
                  use it to prove the descendant guard; an operator never needs it.`;

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { command, release: null, support: DEFAULT_SUPPORT, minds: [], liveAppPid: null };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--support-root') { opts.support = resolve(rest[i += 1] ?? ''); } else if (arg === '--minds') {
      opts.minds = String(rest[i += 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg === '--home-session') { opts.homeSession = String(rest[i += 1] ?? ''); } else if (arg === '--live-app-pid') { opts.liveAppPid = Number(rest[i += 1]); } else if (arg.startsWith('--')) {
      refuse('bad-usage', `unknown option ${arg}\n${USAGE}`);
    } else if (opts.release === null) { opts.release = resolve(arg); } else { refuse('bad-usage', `unexpected ${arg}\n${USAGE}`); }
  }
  return opts;
}

// ── FILES ───────────────────────────────────────────────────────────────────────────────────────────
const readText = (path) => readFileSync(path, 'utf8');

/**
 * repointOverlayText — THE REPOINT AS A PURE FUNCTION (alpha-30).
 *
 * IT REFUSES NOTHING ITSELF. It returns { text, changed, missing, foreign } and the caller decides, which is what makes
 * the rule MEASURABLE without running `prepare`: a court can drive this with a candidate directory it controls, so the
 * three arms this objective names cost milliseconds instead of the ten-plus minutes a full prepare takes, and the
 * `plugins/`-only mutation becomes an arm rather than an intention.
 *
 * THE THREE CLASSES, AND WHY THEY DIFFER. A row is repointed when it is RELATIVE — it resolved against the patch file's
 * own directory, which is the live release — or when its absolute root is in `liveRoots`. A row under any OTHER release
 * is left exactly as it is and comes back in `foreign`, because repointing it would rewrite somebody else's release
 * reference into ours; `foreign` is what the caller turns into `repoint-incomplete`, with the file and line it adds.
 * A row whose relative path does not exist in the candidate comes back in `missing` (line:path) rather than being
 * written, because a repointed row naming a file that is not there would move the failure somewhere harder to read.
 */
export function repointOverlayText(text, { candidate, liveRoots = new Set() } = {}) {
  const rowRe = /(^|\n)(\s*(?:name|path):\s*)(?:(\.\/)|(\S*?\/aukora-release-[0-9a-f]+)\/)((?:plugins|packages|apps)\/[^\s'"]*)/gu;
  const lineOf = (whole, offset) => whole.slice(0, offset).split('\n').length;
  const source = String(text);
  const missing = [];
  let changed = false;
  const out = source.replace(rowRe, (all, lead, key, relative, root, rel, offset) => {
    const isLive = relative === './' || liveRoots.has(root);
    if (!isLive) return all;
    const target = join(candidate, rel);
    if (!exists(target)) {
      missing.push(`${String(lineOf(source, offset))}:${rel}`);
      return all;
    }
    changed = true;
    return `${lead}${key}${target}`;
  });
  const foreign = [];
  out.split('\n').forEach((line, index) => {
    const found = /(?:name|path):\s*(\S*?\/aukora-release-[0-9a-f]+\/)/u.exec(line);
    if (found !== null && !found[1].startsWith(`${candidate}/`)) foreign.push(`${String(index + 1)} → ${found[1]}`);
  });
  return { text: out, changed, missing, foreign };
}
const readJson = (path) => {
  try { return JSON.parse(readText(path)); } catch (error) { refuse('unreadable-json', `${path} is not readable JSON: ${error.message}`); }
};
const digestOf = (path) => sha256(readFileSync(path));
const exists = (path) => { try { return statSync(path).isFile(); } catch { return false; } };

/** Atomic: a temp file beside the target, then a rename, so a crash cannot leave a half-written file. */
function writeAtomic(path, text, mode) {
  const temp = `${path}.cutover-tmp-${String(process.pid)}`;
  writeFileSync(temp, text, { mode });
  chmodSync(temp, mode);
  renameSync(temp, path);
}
/** Every path this tool writes must be inside the support root, checked rather than assumed. */
function assertInside(root, path) {
  const r = resolve(root); const p = resolve(path);
  if (p !== r && !p.startsWith(`${r}/`)) refuse('outside-support-root', `${p} is not under ${r}`);
  // ── LEXICAL CONTAINMENT IS NOT CONTAINMENT ────────────────────────────────────────────────────────
  // CODEX FOUND THIS: `resolve()` does not resolve symlinks, so a symlinked PARENT keeps every path string
  // inside the support root while the bytes land outside it (`support/state -> /tmp/outside` redirects the
  // manifest), and a symlinked DESTINATION makes rollback write through the link. The check is made on the
  // REAL paths now, and it fails closed when they cannot be resolved — an unprovable containment is not a
  // containment. MEASURED so a refusal cannot block a legitimate cutover: none of the eight patch files in
  // Peter's support root is a symlink, and `state/` is a real directory (the only symlinks there are
  // Chromium's own Singleton* files, which this tool never writes).
  let realRoot;
  let realParent;
  try {
    realRoot = realpathSync(r);
    realParent = realpathSync(dirname(p));
  } catch (error) {
    refuse('unresolvable-containment', `${p} cannot be resolved against ${r} (${String(error?.code ?? error)}), so this tool cannot prove the write stays inside the support root`);
  }
  const realPath = join(realParent, basename(p));
  if (realPath !== realRoot && !realPath.startsWith(`${realRoot}${sep}`)) {
    refuse('write-escapes-support', `${p} resolves to ${realPath}, which is NOT under ${realRoot}: a symlinked parent or link would redirect this write outside the support root`);
  }
  if (exists(p) && lstatSync(p).isSymbolicLink()) {
    refuse('write-follows-symlink', `${p} IS A SYMBOLIC LINK, and a backup or a rollback would follow it (reading or writing its target). This tool refuses rather than resolving which of the two ends the operator meant`);
  }
  return p;
}
function walkFiles(root, match, skipped = []) {
  const out = [];
  const visit = (dir, depth) => {
    // ── A SUBTREE THIS WALK COULD NOT ENTER IS A SUBTREE IT DID NOT INSPECT ────────────────────────
    // CODEX FOUND THIS: unreadable directories and deeper subtrees were silently skipped, so a scan that
    // certifies every session log certified only the ones it happened to reach. The caller now receives the
    // skipped paths and REFUSES on a non-empty list, because "I could not look" is not "there is nothing".
    if (depth > 6) { skipped.push(`${dir} (deeper than six levels: this walk does not go further)`); return; }
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch (error) {
      skipped.push(`${dir} (${String(error?.code ?? error)}: this directory could not be read)`);
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) visit(full, depth + 1); else if (entry.isFile() && match(entry.name)) out.push(full);
    }
  };
  visit(root, 0);
  return out.sort();
}

// ── THE LIVE APP, AND WHY THIS PROCESS MUST NOT BE INSIDE IT (upgrade-release.py rule 5) ────────────
function processAncestry(pid) {
  const chain = [pid];
  for (let i = 0; i < 64; i += 1) {
    const r = spawnSync('/bin/ps', ['-o', 'ppid=', '-p', String(chain[chain.length - 1])], { encoding: 'utf8' });
    const parent = Number(String(r.stdout ?? '').trim());
    if (!Number.isInteger(parent) || parent <= 0) return chain;
    chain.push(parent);
    if (parent === 1) return chain;
  }
  return chain;
}
/** The pids this host can name for the running desktop app: the listener's, and launchd's own label. */
function liveAppPids(support) {
  const pids = new Set();
  const inconclusive = [];
  const attach = join(support, 'config.json');
  if (exists(attach)) {
    try {
      const url = JSON.parse(readText(attach)).attachUrl;
      if (typeof url === 'string' && url.includes(':')) {
        const port = url.slice(url.lastIndexOf(':') + 1).replace(/\D/g, '');
        if (port.length === 0) {
          // THE SAME FAIL-OPEN, ONE LINE EARLIER: an `attachUrl` with no parsable port skipped the port probe
          // ALTOGETHER — no error, no empty result, just no probe — so discovery returned an empty set that
          // the descendant guard accepts. MEASURED: this is the path a court can reproduce without any knob.
          inconclusive.push(`the app's attachUrl ${JSON.stringify(url)} names no port, so the listener could not be probed`);
        } else {
          const lsof = spawnSync(process.env.AUKORA_LSOF_BIN ?? '/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' });
          // ── A PROBE THAT COULD NOT RUN IS NOT A PROBE THAT FOUND NOTHING ───────────────────────────
          // CODEX FOUND THIS AND IT FAILS OPEN: neither probe looked at its own status, so a missing
          // `lsof`, a spawn error or a signal produced an EMPTY pid set — and the descendant guard accepts an
          // empty set. The guard's whole job is to refuse a cutover run from inside the app, so "I could not
          // find out" must never read as "nothing is running".
          //
          // `lsof` exits 1 when it matches nothing, and THAT is a conclusive empty. Anything else — no status
          // (killed, spawn error), 126/127 (not executable) or any other code — is inconclusive.
          if (lsof.error !== undefined || lsof.status === null || (lsof.status !== 0 && lsof.status !== 1)) {
            inconclusive.push(`lsof on port ${port} could not be trusted (status ${String(lsof.status)}, error ${String(lsof.error?.code ?? 'none')})`);
          } else {
            for (const line of String(lsof.stdout ?? '').split('\n')) if (line.trim()) pids.add(Number(line.trim()));
          }
        }
      }
    } catch { /* a config this tool cannot read is handled by apply's own preflight */ }
  }
  const jobs = spawnSync(process.env.AUKORA_LAUNCHCTL_BIN ?? '/bin/launchctl', ['list'], { encoding: 'utf8' });
  if (jobs.error !== undefined || jobs.status !== null && jobs.status !== 0) {
    inconclusive.push(`launchctl list could not be trusted (status ${String(jobs.status)}, error ${String(jobs.error?.code ?? 'none')})`);
  } else {
    for (const line of String(jobs.stdout ?? '').split('\n')) {
      if (!line.includes('application.xyz.aukora.desktop')) continue;
      const pid = Number(line.trim().split(/\s+/)[0]);
      if (Number.isInteger(pid) && pid > 0) pids.add(pid);
    }
  }
  return { pids: [...pids].filter((pid) => Number.isInteger(pid) && pid > 0), inconclusive };
}
function assertNotInsideLiveApp(support, extraPid) {
  const chain = processAncestry(process.pid);
  if (chain[chain.length - 1] !== 1) {
    refuse('ancestry-unavailable', `the process ancestry walk stopped at ${chain[chain.length - 1]} instead of pid 1, so this tool cannot tell whether it is running inside the app it would repoint. Nothing has been changed`);
  }
  const discovered = liveAppPids(support);
  if (discovered.inconclusive.length > 0) {
    // FAIL CLOSED, BY NAME. An operator whose shell cannot run the probes still has `--live-app-pid`
    // (which ADDS a pid and never replaces the guard), so this refusal is actionable rather than a dead end.
    refuse('live-app-unknown',
      `whether the app is running could not be established, and this tool REFUSES to repoint a configuration while it cannot tell — an unproven "nothing is running" is exactly what the descendant guard must not accept:\n  ${discovered.inconclusive.join('\n  ')}\n  Run this from a shell where lsof and launchctl work, or quit the app and pass the pid it had as --live-app-pid (which ADDS a pid to the guard and never replaces it). Nothing has been changed`);
  }
  const pids = new Set(discovered.pids);
  if (Number.isInteger(extraPid) && extraPid > 0) pids.add(extraPid);
  for (const pid of pids) {
    if (chain.includes(pid)) {
      refuse('live-app-descendant', `this process (${String(process.pid)}) is a descendant of pid ${String(pid)}, which is the running app: the app SWEEPS ITS DESCENDANTS BY PPID on shutdown, so a cutover run from inside it can be killed halfway. Quit the app, then run this from a terminal that is not its child`);
    }
  }
  return [...pids];
}

// ── SESSION LOGS: AN UNMARKED UNKNOWN EVENT WOULD STRAND THREADS ON RESTART ─────────────────────────
//
// THE LOG IS A CONCATENATION OF INDEPENDENT ZSTD FRAMES, and the FIRST FRAME IS EXACTLY THE HEADER LINE.
// MEASURED on 2026-09-25: `zstdDecompressSync(file)` decodes the FIRST frame only and silently returns one
// line for a 19 MB log; a naive rewrite of such a log destroys every frame after the header. This reader
// walks the frame magics and decodes each frame on its own, and REFUSES rather than reporting a log it
// could not read — a log this tool cannot read is a log it cannot certify.
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
function readSessionEvents(path) {
  const bytes = readFileSync(path);
  const frames = [];
  for (let i = 0; i + 3 < bytes.length; i += 1) {
    if (bytes[i] === ZSTD_MAGIC[0] && bytes[i + 1] === ZSTD_MAGIC[1] && bytes[i + 2] === ZSTD_MAGIC[2] && bytes[i + 3] === ZSTD_MAGIC[3]) frames.push(i);
  }
  if (frames.length === 0) refuse('unreadable-session-log', `${path} carries no Zstandard frame`);
  const events = [];
  for (let i = 0; i < frames.length; i += 1) {
    const slice = bytes.subarray(frames[i], i + 1 < frames.length ? frames[i + 1] : bytes.length);
    let text;
    try { text = zstdDecompressSync(slice).toString('utf8'); } catch (error) {
      refuse('unreadable-session-log', `${path}: frame ${String(i)} at byte ${String(frames[i])} did not decode (${error.code ?? error.message}); NOTHING is proven about this log`);
    }
    for (const line of text.split('\n')) if (line.length > 0) events.push(line);
  }
  const parsed = events.map((line, index) => {
    try { return { index, value: JSON.parse(line) }; } catch { return { index, value: null, unparseable: line.slice(0, 60) }; }
  });
  // THE PREVIOUS VERSION RETURNED `null` FOR A MALFORMED LINE AND THE SCAN SKIPPED IT, under a comment that
  // claimed the line "was refused above" — nothing refused it, so a log with a corrupt record passed the scan
  // and the cutover proceeded. Codex found exactly that. It is refused here, by name and by position.
  const broken = parsed.filter((event) => event.unparseable !== undefined);
  if (broken.length > 0) {
    refuse('session-log-unparsable',
      `${path}: ${String(broken.length)} line(s) are not JSON, so this log cannot be certified (first at line ${String(broken[0].index + 1)}: ${JSON.stringify(broken[0].unparseable)})`);
  }
  return parsed;
}
/** The list the release itself will admit events by — imported FROM THE RELEASE, not retyped here. */
async function knownEventTypes(release) {
  const entry = join(release, 'packages', 'core', 'session', 'lib', 'index.js');
  if (!exists(entry)) refuse('release-cannot-read-logs', `${entry} is absent, so the target release cannot say which session events it admits`);
  const module = await import(pathToFileURL(entry).href);
  const set = module.KNOWN_SESSION_EVENT_TYPES;
  if (!(set instanceof Set)) refuse('release-cannot-read-logs', `${entry} does not export KNOWN_SESSION_EVENT_TYPES`);
  return set;
}
async function scanSessionLogs(support, release) {
  const known = await knownEventTypes(release);
  const skipped = [];
  const logs = walkFiles(join(support, 'state', 'home', 'sessions'), (name) => name === SESSION_LOG, skipped);
  if (skipped.length > 0) {
    refuse('session-scan-incomplete', `the session scan could not inspect everything, so NOTHING is proven about the logs it missed:\n  ${skipped.join('\n  ')}`);
  }
  const offenders = [];
  for (const log of logs) {
    const events = readSessionEvents(log);
    const header = events[0]?.value;
    if (header === null || header === undefined || header.type !== 'session') {
      refuse('session-log-header', `${log} does not begin with a session header record`);
    }
    for (const event of events.slice(1)) {
      const type = event.value?.type;
      if (type === undefined) continue;                                  // an unparseable line was refused above
      if (!known.has(type) && event.value.ignorable !== true) {
        offenders.push(`${log}: event ${String(event.index + 1)} has type ${JSON.stringify(type)}, which this release does not know and which is NOT marked ignorable: true`);
      }
    }
  }
  return { logs: logs.length, offenders, known: known.size };
}

// ── RELEASE FACTS ───────────────────────────────────────────────────────────────────────────────────
function releaseFacts(release) {
  if (!exists(release) && !exists(join(release, 'apps', 'cli', 'lib', 'bin.js'))) {
    refuse('not-a-release', `${release} has no apps/cli/lib/bin.js`);
  }
  const manifestFile = join(release, RELEASE_MANIFEST);
  if (!exists(manifestFile)) refuse('not-a-release', `${manifestFile} is absent: this tree was not materialized`);
  const manifest = readJson(manifestFile);
  const record = join(release, ARTIFACT_RECORD);
  if (!exists(record)) refuse('unverified-release', `${record} is absent; run the pinned build and verification first`);
  const composition = join(release, COMPOSITION_PATCH);
  if (!exists(composition)) refuse('release-missing-composition-patch', `${composition} is absent, so there is no patch to name in config.patch[0]`);
  const carried = new Set();
  const entries = readJson(record).entries;
  if (!Array.isArray(entries)) {
    refuse('release-record-unreadable', `${record} carries no entries list, so WHAT THE RELEASE CARRIES cannot be established and no repoint may be made`);
  }
  for (const entry of entries) if (typeof entry?.path === 'string') for (const segment of entry.path.split('/')) carried.add(segment);
  return { release, tipSha: manifest.tipSha ?? null, recordSha: digestOf(record), composition, carried };
}

// ── THE PLAN: EVERY WRITE, COMPUTED BEFORE ANY OF IT HAPPENS ─────────────────────────────────────────
/** The structural prefix of a line, and its VALUE. Four shapes occur in the files this tool edits, and the
 *  difference between them is exactly what broke the first attempt: a mapping (`key: value`), a mapping
 *  inside a list item (`- name: value`), a scalar list item (`- value`), and a bare JSON string in an array
 *  (`    "value",` in gate-config.json). ONLY THE VALUE may be repointed; the prefix goes back untouched. */
function splitValue(line) {
  const mapping = /^(\s*(?:-\s+)?(?:"[^"]*"|[A-Za-z_][\w.-]*)?\s*:\s*)(.*)$/.exec(line);
  if (mapping !== null) return { head: mapping[1], value: mapping[2] };
  const item = /^(\s*-\s+)(.*)$/.exec(line);
  if (item !== null) return { head: item[1], value: item[2] };
  const bare = /^(\s*)(.*)$/.exec(line);
  return { head: bare[1], value: bare[2] };
}
/** Only a line whose VALUE carries the old root is repointed; comments are left alone. */
function repointLines(text, oldRoot, newRoot, label, refusals, seen) {
  const out = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    const isComment = trimmed.startsWith('#');
    const carriesOld = line.includes(oldRoot);
    if (isComment || !carriesOld) { out.push(line); continue; }
    const { head, value } = splitValue(line);
    const candidate = value.split(oldRoot).join(newRoot);
    const target = candidate.trim().replace(/,$/, '').replace(/^['"]|['"]$/g, '');
    if (!exists(target)) {
      refusals.push(`${label}: ${value.trim()} would repoint to ${target}, WHICH DOES NOT EXIST in the new release`);
      out.push(line); continue;
    }
    const from = value.trim().replace(/,$/, '').replace(/^['"]|['"]$/g, '');
    // FAIL CLOSED: a repoint may only be made when BOTH sides can be read and are the same bytes. A source
    // that does not exist is not "probably fine" — it is a repoint nobody can prove, so it is refused.
    if (!exists(from)) {
      refusals.push(`${label}: ${from} does not exist on this host, so the repoint to ${target} cannot be proven byte-identical`);
      out.push(line); continue;
    }
    if (digestOf(from) !== digestOf(target)) {
      refusals.push(`${label}: ${from} and its new-release counterpart ${target} are NOT byte-identical (${digestOf(from).slice(0, 12)} vs ${digestOf(target).slice(0, 12)}), so a repoint would change behaviour`);
      out.push(line); continue;
    }
    seen.push(`${label}: ${from} -> ${target}`);
    out.push(head + candidate);
  }
  return out.join('\n');
}
function configPlan(support, facts) {
  const path = assertInside(support, join(support, 'config.json'));
  const before = readText(path);
  const config = readJson(path);
  const declared = Array.isArray(config.patch) ? [...config.patch] : [];
  const wanted = join(facts.release, COMPOSITION_PATCH);
  // ── EVERY COMPOSITION PATCH THAT IS NOT THE TARGET'S IS A STALE PATCH FROM A PREVIOUS RELEASE ──────
  // MEASURED, ON PETER'S LIVE APP: the first `apply` INSERTED the new patch at [0] and left the OLD
  // release's composition patch at [1], and the launcher refused the whole launch —
  // `patch-not-release-local: …/aukora-release-bd69f9cd/plugins/aukora-foundation/lib/index.js is outside
  // the verified release`. Fable removed it by hand to get the app up. An insert is not a replacement:
  // the patch is the release's OWN composition, there is exactly one per release, and a cutover that
  // leaves the previous one in the list is a cutover that cannot boot.
  //
  // So the stale entries are DROPPED wherever they sit (not only when they happen to be first), the
  // target's patch is placed at [0], and the other entries keep their order. `resolve` is not enough to
  // recognise one, because the stale path is the OLD release's file and never equals the wanted path.
  const stale = declared.filter((entry) => basename(entry) === COMPOSITION_PATCH);
  const patches = [wanted, ...declared.filter((entry) => basename(entry) !== COMPOSITION_PATCH)];
  // ── AND NO REMAINING PATCH MAY NAME A RELEASE OTHER THAN THE TARGET ────────────────────────────────
  // A second way to leave the same landmine: an overlay that points INTO another release. It is refused
  // by name here, with both paths, rather than at launch with a launcher message about a plugin path.
  // MEASURED, AND THIS WAS MY OWN BUG, FOUND BY THE REAL REHEARSAL OF 2026-09-25: the first version captured
  // the SHA after `aukora-release-` and compared it to the FULL basename, so `fbcc1f20a1cf` was compared with
  // `aukora-release-fbcc1f20a1cf`, EVERY patch naming the target release was refused as foreign, and the real
  // cutover of `aukora-release-fbcc1f20a1cf` could not start. Like is compared with like now.
  //
  // AND THE OLD REGEX ONLY KNEW `aukora-release-`: a patch pointing into a PARKED release
  // (`aukora-parked-release-4e92597fdb62`) was MISSED entirely, which is a fail-open in the same check. The
  // directory segment is what is compared now, so any `aukora-…release-…` spelling is caught by name.
  const targetName = basename(facts.release);
  const foreign = patches
    .map((entry) => {
      const named = /(?:^|\/)(aukora-[a-z-]*release-[^/]+)\//.exec(entry);
      return named === null ? null : { entry, dir: named[1] };
    })
    .filter((found) => found !== null && found.dir !== targetName)
    .map((found) => `${found.entry} names release ${found.dir}, not ${targetName}`);
  if (foreign.length > 0) {
    // THE REFUSAL NAMES THE TARGET IN FULL, not only its directory name: an operator reading this needs the
    // path that was wanted as well as the path that is wrong. MEASURED: the first version printed only the
    // basename, and the court arm that requires BOTH the foreign release and the target to appear failed —
    // the arm was right about what a refusal owes its reader.
    refuse('patch-names-another-release',
      `the patch list would still name a release other than the target ${facts.release}, so the launcher would refuse it:\n  ${foreign.join('\n  ')}`);
  }
  const approved = Array.isArray(config.approvedRecordSha) ? [...config.approvedRecordSha] : [];
  const kept = approved.length;
  if (!approved.includes(facts.recordSha)) approved.push(facts.recordSha);
  const after = { ...config, release: facts.release, patch: patches, approvedRecordSha: approved };
  // ── aura-82 (3b, HERE TOO): THE EFFECTIVE KIRA SUBJECT, ACROSS THE LIST THIS PLAN WOULD WRITE. ──────
  // **FABLE NAMED TWO PLACES AND THIS IS THE SECOND.** *`desktop-parity-boot` checks the list it is about to
  // COMPOSE; this checks the list `config.json` would CARRY after the cutover writes it.* **They are different
  // moments on purpose**: *a plan can be sound and the written list still wrong if a later patch re-broke the
  // subject* — **and this is the file a launcher reads afterwards.**
  //
  // **THE DIRECTORY IS THE SUPPORT ROOT, NOT THE PATCH'S OWN.** *That is the bug aura-80 chased for eight
  // MISSING specifiers*: a `./plugins/...` row resolves against **the patch file's directory**, and for the
  // overlays that IS the support root. *Reading the subject only needs the files, but the same convention
  // decides which file is read, so it is written down here rather than assumed.*
  {
    const setting = [];
    for (const entry of patches) {
      const file = entry.startsWith('/') ? entry : join(support, entry);
      if (!exists(file)) continue;
      const lines = readText(file).split('\n');
      const start = lines.findIndex((l) => /^\s*memoryOwner:\s*$/.test(l));
      if (start === -1) continue;
      const col = lines[start].length - lines[start].trimStart().length;
      for (let i = start + 1; i < lines.length; i += 1) {
        if (lines[i].trim() === '') continue;
        const indent = lines[i].length - lines[i].trimStart().length;
        if (indent <= col) break;
        const hit = /^\s*subject:\s*(\S+)\s*$/.exec(lines[i]);
        if (hit !== null) { setting.push({ file, subject: hit[1] }); break; }
      }
    }
    if (setting.length === 0) {
      refuse('kira-subject-unstated',
        `no patch in the list this plan would write sets a kira memoryOwner subject, so aukora-kira takes its `
        + `own default and memory lands under a subject this deployment never chose; the deployment overlay must `
        + `set \`aukora:1:<64hex>\``);
    }
    const effective = setting[setting.length - 1];
    if (!/^aukora:1:[0-9a-f]{64}$/.test(effective.subject)) {
      refuse('kira-subject-not-canonical',
        `the EFFECTIVE kira subject after this plan is ${JSON.stringify(effective.subject)}, which is not `
        + `\`aukora:1:<64hex>\`; it comes from ${basename(effective.file)}. A release may carry the documented `
        + `placeholder, but an INSTALLATION may not run on one — memory staged under it cannot be approved, so `
        + `the write is unmintable and the memory path is unusable`);
    }
  }

  return {
    path, before, after: `${JSON.stringify(after, null, 2)}\n`,
    summary: [`config.json: release -> ${facts.release}`,
      `config.json: patch[0] -> ${wanted}${stale.length === 0 ? '' : ` (REPLACED ${String(stale.length)} composition patch(es) left by a previous release: ${stale.map((entry) => basename(dirname(entry))).join(', ')})`}`,
      `config.json: approvedRecordSha appended ${facts.recordSha.slice(0, 12)}… (${String(kept)} kept, ${String(approved.length)} total) — NOT aukora-release.json`],
  };
}
/** A patch overlay may only be repointed at a release that CARRIES the plugin it names. */
function patchOverlayPlan(support, facts, oldRoot, refusals, seen, unproven) {
  const plans = [];
  // THE LIVE OVERLAYS ARE THE FILES DIRECTLY IN THE SUPPORT ROOT — NOT EVERY `*.patch.yml` UNDERNEATH IT.
  // MEASURED: this tree also carries `checkouts/`, whose own copies of overlays are materialized trees, and
  // a recursive walk would offer to rewrite a checkout's file as if it were a live overlay. A cutover edits
  // the running configuration, so it looks exactly where the running configuration lives.
  for (const path of readdirSync(support, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.patch.yml'))
    .map((entry) => join(support, entry.name)).sort()) {
    const before = readText(path);
    const label = basename(path);
    // A PLUGIN ENTRY IS CARRIED WHEN THE RELEASE'S OWN RECORD CARRIES IT. `plugins/<id>/` WAS A GUESS AND A
    // WRONG ONE: MEASURED on the live release, it refused six overlays that are fine — four of them because the
    // plugin lives at another path (`packages/extensions/tool-cordis`, `packages/session-query/…`) and three
    // because the id is an ALIAS whose real module is the entry's `name:`
    // (`tool-subagent-aura` → `@deepseek-ai/dsh-tool-subagent`), which cannot be resolved from outside the
    // release at all. So: a plugin the record does not carry and whose entry declares no `name:` is REFUSED BY
    // NAME (that is the caaf outage), and an ALIAS is reported as UNPROVEN rather than refused, because
    // refusing what cannot be established would block every cutover — and the release's import-closure court is
    // the authority on whether it actually loads.
    for (const match of before.matchAll(/^\s*-?\s*id:\s*(\S+)\s*$\n(?:\s+name:\s*(\S+)\s*$)?/gm)) {
      const id = match[1].replace(/['"]/g, '');
      const name = match[2] === undefined ? null : match[2].replace(/['"]/g, '');
      if (facts.carried.has(id)) continue;
      if (name !== null && !name.startsWith('/')) {
        unproven.push(`${label}: ${JSON.stringify(id)} is an alias for ${JSON.stringify(name)}; whether the release carries it cannot be established from here (its import-closure court is the authority), so it is NOT refused`);
        continue;
      }
      refusals.push(`${label}: the composition names plugin ${JSON.stringify(id)}${name === null ? '' : ` (${name})`}, and NOTHING the release's own verified record carries matches it`);
    }
    if (oldRoot === null || !before.includes(oldRoot)) continue;
    const after = repointLines(before, oldRoot, facts.release, label, refusals, seen);
    if (after !== before) plans.push({ path: assertInside(support, path), before, after });
  }
  const gate = join(support, 'state', 'gate-state', 'gate-config.json');
  if (exists(gate)) {
    const before = readText(gate);
    if (oldRoot !== null && before.includes(oldRoot)) {
      const after = repointLines(before, oldRoot, facts.release, 'gate-config.json', refusals, seen);
      if (after !== before) plans.push({ path: assertInside(support, gate), before, after });
    }
  }
  return plans;
}
/** THE PATCH LIST `config.json` NAMES, or a refusal. A patch that cannot be read is a set of entry points
 *  nobody walked, so it is named rather than skipped. */
function livePatches(support) {
  const path = join(support, 'config.json');
  if (!exists(path)) return [];
  const config = readJson(path);
  const declared = Array.isArray(config.patch) ? config.patch : [];
  const missing = declared.filter((entry) => !exists(entry));
  if (missing.length > 0) {
    refuse('live-patch-missing', `config.json names patch(es) that do not exist, so their entry points would be unwalked:\n  ${missing.join('\n  ')}`);
  }
  return declared;
}

/** THE MINDS THE RELEASE ITSELF OFFERS, READ FROM THE RELEASE'S OWN COMPOSITION PATCH.
 *
 * MEASURED ON PETER'S LIVE APP, BY FABLE: the cutover reported "the release declared no additional mind" —
 * and the release's `aukora-composition.patch.yml` offers `opus` right there at its `aukora-face-apps` row
 * (`offeredMinds: [balanced, deep, quick, muse, opus]`). Fable added `opus` to the overlay BY HAND.
 *
 * WHY IT WAS MISSED: the "declared" list came from a `--mind` OPTION on the command line and nothing else, so
 * the release's own offer was never read — a knob nobody turns is not a source. The release is the authority
 * on what it offers, so it is read from the bytes that carry it. Both spellings are supported, because the
 * generated patch and the overlays do not have to agree on one: the inline `[a, b]` list and the block list.
 *
 * @param {string} release - the release directory.
 * @returns {string[]} the minds, in the order the patch lists them (empty when it offers none).
 */
function declaredMinds(release) {
  const patch = join(release, COMPOSITION_PATCH);
  if (!exists(patch)) return [];
  const lines = readText(patch).split('\n');
  const start = lines.findIndex((line) => /^\s*-\s*id:\s*aukora-face-apps\s*$/.test(line));
  if (start === -1) return [];
  const minds = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*-\s*id:\s*\S+\s*$/.test(lines[i])) break; // the next row: the block ended
    const inline = /^\s*offeredMinds:\s*\[([^\]]*)\]\s*$/.exec(lines[i]);
    if (inline !== null) {
      for (const mind of inline[1].split(',')) { const clean = mind.trim(); if (clean !== '') minds.push(clean); }
      continue;
    }
    if (/^\s*offeredMinds:\s*$/.test(lines[i])) {
      for (let j = i + 1; j < lines.length; j += 1) {
        const item = /^\s*-\s*(\S+)\s*$/.exec(lines[j]);
        if (item === null) break;
        minds.push(item[1]);
      }
    }
  }
  return minds;
}
function mindsPlan(support, declared, refusals, pending = new Map()) {
  const path = join(support, 'auma-live.patch.yml');
  if (!exists(path)) { refusals.push(`auma-live.patch.yml is absent from ${support}`); return null; }
  // ── OVERLAPPING PLANS LOSE EDITS, AND THIS IS MEASURED ON PETER'S LIVE APP ────────────────────────
  // `auma-live.patch.yml` needs BOTH a repoint (it names a tool under the old release) AND the minds merge.
  // Read from disk, both plans started from the ORIGINAL bytes, the minds write ran last, and it restored
  // the old release paths — which is exactly the "opus miss" Fable fixed by hand. So a later plan reads what
  // an earlier plan already decided, through `pending` (path -> text), and the caller drops the superseded
  // write so the file is written ONCE with both edits.
  const before = readText(path);
  const current = pending.get(path) ?? before;
  const match = /^(\s*offeredMinds:\s*)\[([^\]]*)\]\s*$/m.exec(current);
  if (match === null) { refusals.push('auma-live.patch.yml carries no offeredMinds list to merge into'); return null; }
  const live = match[2].split(',').map((s) => s.trim()).filter(Boolean);
  const merged = [...live];
  for (const mind of declared) if (!merged.includes(mind)) merged.push(mind);
  if (merged.length === live.length) {
    return { path: null, before, after: current, summary: [`auma-live.patch.yml: offeredMinds unchanged (${live.join(', ')}) — the release declared no additional mind, and NOTHING live was dropped`] };
  }
  const after = current.replace(match[0], `${match[1]}[${merged.join(', ')}]`);
  return { path: assertInside(support, path), before, after,
    summary: [`auma-live.patch.yml: offeredMinds ${live.join(', ')} -> ${merged.join(', ')} (live entries kept, the release's list merged in)`] };
}
/** SET `homeSession` UNDER THE FACE-APPS CONFIG, in the same file the minds merge edits.
 *
 * alpha-7 item 3: apply must set `homeSession: <id>` under `aukora-face-apps`'s `config:` in
 * `auma-live.patch.yml`. It reads through `pending` and returns a write whose `before` is the UNTOUCHED
 * original, so it composes with the repoint and the minds merge into ONE write of the file (finding 3).
 */
function homeSessionPlan(support, sessionId, refusals, pending = new Map()) {
  const path = join(support, 'auma-live.patch.yml');
  if (!exists(path)) { refusals.push(`auma-live.patch.yml is absent from ${support}, so homeSession cannot be set`); return null; }
  const before = readText(path);
  const current = pending.get(path) ?? before;
  const lines = current.split('\n');
  const start = lines.findIndex((line) => /^\s*-\s*id:\s*aukora-face-apps\s*$/.test(line));
  if (start === -1) { refusals.push('auma-live.patch.yml has no aukora-face-apps row, so homeSession has no config to go under'); return null; }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) if (/^\s*-\s*id:\s*\S+\s*$/.test(lines[i])) { end = i; break; }
  let anchor = -1;
  let indent = '    ';
  for (let i = start + 1; i < end; i += 1) {
    const existing = /^(\s*)homeSession:\s*(\S+)\s*$/.exec(lines[i]);
    if (existing !== null) {
      if (existing[2] === sessionId) {
        return { path: null, before, after: current, summary: [`auma-live.patch.yml: homeSession is already ${sessionId} — unchanged`] };
      }
      const updated = [...lines];
      updated[i] = `${existing[1]}homeSession: ${sessionId}`;
      return { path: assertInside(support, path), before, after: updated.join('\n'),
        summary: [`auma-live.patch.yml: homeSession ${existing[2]} -> ${sessionId} under aukora-face-apps`] };
    }
    if (/^\s*config:\s*$/.test(lines[i])) {
      anchor = i;
      for (let j = i + 1; j < end; j += 1) {
        const sibling = /^(\s+)\S/.exec(lines[j]);
        if (sibling !== null) { indent = sibling[1]; break; }
      }
    }
  }
  if (anchor === -1) { refusals.push("auma-live.patch.yml's aukora-face-apps row has no config: block to put homeSession under"); return null; }
  const updated = [...lines];
  updated.splice(anchor + 1, 0, `${indent}homeSession: ${sessionId}`);
  return { path: assertInside(support, path), before, after: updated.join('\n'),
    summary: [`auma-live.patch.yml: homeSession -> ${sessionId} under aukora-face-apps (added)`] };
}
async function plan(opts) {
  const facts = releaseFacts(opts.release);
  const configFile = join(opts.support, 'config.json');
  if (!exists(configFile)) refuse('missing-app-support', `${configFile} is absent; there is nothing to repoint`);
  const current = readJson(configFile);
  const oldRoot = typeof current.release === 'string' ? current.release : null;
  const refusals = [];
  const seen = [];
  const config = configPlan(opts.support, facts);
  const unproven = [];
  const overlays = patchOverlayPlan(opts.support, facts, oldRoot, refusals, seen, unproven);
  // THE RELEASE'S OWN OFFER IS A SOURCE, NOT A DEFAULT: the command line may add to it, never stand in for it.
  const declaredMindsList = [...new Set([...(opts.minds ?? []), ...declaredMinds(facts.release)])];
  const pending = new Map(overlays.map((write) => [write.path, write.after]));
  const minds = mindsPlan(opts.support, declaredMindsList, refusals, pending);
  // THE MINDS WRITE FEEDS THE HOME-SESSION WRITE (both edit the same file), and the later plan's `after`
  // contains every earlier plan's edits — so the LAST plan on a path owns the single write of that file.
  if (minds !== null && minds.path !== null) pending.set(minds.path, minds.after);
  const home = typeof opts.homeSession === 'string' && opts.homeSession.length > 0
    ? homeSessionPlan(opts.support, opts.homeSession, refusals, pending)
    : null;
  const late = home !== null && home.path !== null ? home : minds;
  if (refusals.length > 0) {
    refuse('plan-refused', `the cutover would not be faithful, so NOTHING has been written:\n  ${refusals.join('\n  ')}`);
  }
  // A LATER PLAN THAT TOUCHED THE SAME FILE REPLACES THE EARLIER WRITE WHOLESALE, because its `after` already
  // contains the earlier plan's edits and its `before` is the untouched original the backup must hold.
  const superseded = new Set([late].filter((entry) => entry !== null && entry.path !== null).map((entry) => entry.path));
  const writes = [config, ...overlays.filter((write) => !superseded.has(write.path))];
  if (late !== null && late.path !== null) writes.push({ path: late.path, before: late.before, after: late.after });
  return { facts, oldRoot, writes, summary: [...config.summary, ...seen, ...unproven, ...(late === null ? [] : late.summary)] };
}

// ── PREPARE ─────────────────────────────────────────────────────────────────────────────────────────
/** IS THIS PROCESS ALREADY INSIDE THE HEAVY-RUN LOCK? MEASURED THE HARD WAY: the first `prepare` run was
 *  invoked through scripts/heavy-run.sh and DID NOTHING FOR 35 MINUTES — 1.9 s of CPU, holding the lock the
 *  whole time — because it asked the wrapper for the closure court, and the wrapper was already held by the
 *  run that had started it. A nested request for a lock its own ancestor holds is a deadlock, and it stops
 *  every other lane, so the tool asks instead of assuming: if the lock's holder is one of MY ancestors, the
 *  courts run DIRECTLY (this process is already the heavy run); otherwise the wrapper is used as intended. */
function alreadyUnderHeavyLock() {
  let holder = null;
  try { holder = readHolder(); } catch { return false; }
  if (holder === null || !Number.isInteger(holder.pid) || holder.pid <= 0) return false;
  return processAncestry(process.pid).includes(holder.pid);
}
function heavy(command, args) {
  const wrapped = alreadyUnderHeavyLock();
  const argv = wrapped ? [command, ...args] : [HEAVY, '--', command, ...args];
  if (wrapped) say(`    (already inside the heavy-run lock, held by an ancestor of this process: running ${basename(command)} directly)`);
  const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8' });
  return { rc: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
function withDetachedWorktree(commit, fn) {
  if (commit === null) refuse('release-has-no-commit', 'the release manifest names no tipSha, so there is no commit to check out');
  const dir = mkdtempSync(join(tmpdir(), 'cutover-worktree-'));
  rmSync(dir, { recursive: true, force: true });
  const add = spawnSync('/usr/bin/git', ['-C', REPO, 'worktree', 'add', '--detach', dir, commit], { encoding: 'utf8' });
  if (add.status !== 0) refuse('worktree-failed', `git worktree add --detach ${dir} ${commit} failed: ${(add.stderr ?? '').trim()}`);
  try { return fn(dir); } finally {
    spawnSync('/usr/bin/git', ['-C', REPO, 'worktree', 'remove', '--force', dir], { encoding: 'utf8' });
    rmSync(dir, { recursive: true, force: true });
  }
}
async function prepare(opts) {
  const facts = releaseFacts(opts.release);
  say(`desktop-cutover prepare`);
  say(`  release   ${facts.release}`);
  say(`  commit    ${facts.tipSha ?? '(none named)'}`);
  say(`  support   ${opts.support}${opts.support === DEFAULT_SUPPORT ? '' : '  (NOT Peter\'s real tree — court mode)'}`);
  say('');
  say(`  the import-closure court, through scripts/heavy-run.sh`);
  // ── EVERY PATCH `config.json` NAMES IS CODE THIS RELEASE LOADS, SO EVERY ONE IS WALKED ─────────────
  // MEASURED ON THE LIVE APP, BY FABLE: the app loads EIGHT patches — the release's own composition patch
  // plus seven overlays in the support root — and this step walked ONLY the release's own. A closure that
  // reports CLOSED about a set it never looked at is the false clean AURA's walker was built to refuse, so
  // the overlays go to it as repeated `--patch` (the walker resolves overlay entries BESIDE THE OVERLAY, and
  // refuses an overlay it cannot read rather than skipping it).
  //
  // The release's own patch is skipped: it is already the release argument, and passing it twice would walk
  // it twice.
  const overlayPatches = livePatches(opts.support).filter((entry) => resolve(entry) !== resolve(join(facts.release, COMPOSITION_PATCH)));
  // ── aura-80: RELATIVE `./plugins/…` ROWS ARE POINTED AT THE RELEASE BEFORE THE WALK ────────────────
  // **THE 8 MISSING THAT BLOCKED THIS CUTOVER WERE NEVER A RESOLUTION DEFECT.** *Bisected one patch at a
  // time: `aukora-composition.patch.yml` alone produced all eight, and the other seven produced none.*
  // **THE MECHANISM IS THAT A RELATIVE ROW RESOLVES AGAINST THE PATCH FILE'S OWN DIRECTORY** — *and
  // `config.json`'s `patch[0]` is `~/aukora-release-fbcc1f20a1cf/aukora-composition.patch.yml`, AN OLDER
  // RELEASE* — so the walker walked the OLD release's `plugins/aukora-face-apps/lib/index.js` **while
  // reporting the path as though it belonged to the release under test.** *The report blamed the release for
  // a walk of a different tree, and the old tree resolves itself perfectly (`CLOSED`, 21 files).*
  //
  // **AND `desktop-parity-boot.mjs` HAD ALREADY SOLVED EXACTLY THIS** (its lines 169-179 rewrote these rows
  // in its mirror). *Prepare did not*, so **the boot measured the release while prepare measured an old one.**
  // The same rewrite is applied here, into a scratch copy: *the live overlays are never written*, so this
  // stays read-only with respect to Peter's tree.
  // ── THE REPOINT MUST BE COMPLETE (alpha-30; AURA's aura-101) — the rule lives in repointOverlayText above ────
  // **THE LIVE ROOT IS DECLARED, NOT GUESSED.** `config.json` states it: `release` is the release the desktop composes
  // and the overlays it names live inside it. A name pattern (`/aukora-release-<hex>/`) cannot recognise a fixture root
  // like `/private/tmp/aukora-release-old0000` — `old0000` is not hexadecimal — and a rule that finds the live root by
  // how a directory is NAMED will be wrong somewhere. The declaration is read first; the patch entries' directories are a
  // second source; the name pattern is kept only as a last resort.
  const liveRoots = new Set();
  const configPath = join(opts.support, 'config.json');
  if (exists(configPath)) {
    let config = null;
    try { config = JSON.parse(readText(configPath)); } catch { config = null; }
    if (config !== null && typeof config.release === 'string' && config.release !== '') {
      const stated = config.release.replace(/\/+$/u, '');
      if (stated !== facts.release) liveRoots.add(stated);
    }
    if (config !== null && Array.isArray(config.patch)) {
      for (const entry of config.patch) {
        if (typeof entry !== 'string') continue;
        const directory = entry.replace(/\/[^/]*$/u, '');
        if (directory !== '' && directory !== facts.release) liveRoots.add(directory);
      }
    }
    for (const found of readText(configPath).matchAll(/(\/\S*?\/aukora-release-[0-9a-f]+)\//gu)) {
      if (found[1] !== facts.release) liveRoots.add(found[1]);
    }
  }
  const rewritten = [];
  const incomplete = [];
  let scratch = null;
  for (const overlay of overlayPatches) {
    const before = readFileSync(overlay, 'utf8');
    const repointed = repointOverlayText(before, { candidate: facts.release, liveRoots });
    if (repointed.missing.length > 0) {
      refuse('repoint-target-missing', `${overlay}:${repointed.missing[0]} — that relative path does not exist in the candidate ${facts.release}`);
    }
    if (!repointed.changed) { rewritten.push(overlay); }
    else {
      if (scratch === null) scratch = mkdtempSync(join(tmpdir(), 'aukora-cutover-patch-'));
      const target = join(scratch, basename(overlay));
      writeFileSync(target, repointed.text, { mode: 0o600 });
      rewritten.push(target);
    }
    for (const line of repointed.foreign) incomplete.push(`${overlay}:${line}`);
  }
  if (incomplete.length > 0) {
    refuse('repoint-incomplete', `${String(incomplete.length)} row(s) still resolve into a release other than the candidate after repointing: ${incomplete.slice(0, 3).join('; ')}`);
  }
  if (scratch !== null) {
    say(`    ${String(rewritten.filter((entry) => entry.startsWith(scratch)).length)} overlay(s) name relative ./plugins/… rows: pointed at the RELEASE, not copied`);
  }
  const closureArgs = [CLOSURE, '--release', facts.release];
  for (const overlay of rewritten) closureArgs.push('--patch', overlay);
  say(`    ${String(overlayPatches.length)} overlay patch(es) from config.json walked as well: ${overlayPatches.map((entry) => basename(entry)).join(', ') || 'none'}`);
  const closure = heavy('node', closureArgs);
  say(`    exit ${String(closure.rc)}`);
  if (closure.rc !== 0) refuse('closure-court-failed', `the release cannot resolve everything it loads, so it is not cut over:\n${closure.out.trim()}`);
  say(`    ${closure.out.trim().split('\n').slice(-1)[0]}`);
  say('');
  say(`  the boot smoke, in a CLEAN DETACHED WORKTREE at ${facts.tipSha ?? '?'} (a scratch state root, never Peter's)`);
  // *** THE SMOKE MUST COMPOSE WHAT THE DESKTOP COMPOSES, AND THIS CALL WAS THE LAST PLACE IT DID NOT (aura-100). ***
  // *`release-boot-smoke.mjs` reads the patch list from `<support>/config.json`, but THIS invocation passed only
  // `--release` and `--repo` -- so `prepare`'s own smoke booted without the deployment overlays and answered 404 on
  // the face for exactly the reason every earlier candidate did.
  // *** AND MY FIRST FIX FOR THAT WAS HALF RIGHT (aura-102). *** *It passed `--support opts.support`, on the
  // assumption that the support root is where the composed overlays live by the time this smoke runs.* *** IT IS
  // NOT: the loop above REPOINTS EVERY OVERLAY INTO A SCRATCH DIRECTORY (`:809-811`) AND DOES NOT COMMIT IT BACK, so
  // `--support` handed this smoke the ORIGINAL, unrepointed files -- and the launcher refused the stale absolute path
  // with `patch-not-release-local` even with the complete repoint in the tree. ***
  // THE REPOINTED SET IS WHAT THIS SMOKE MUST COMPOSE, AND `rewritten` ALREADY HOLDS ITS PATHS.
  const boot = withDetachedWorktree(facts.tipSha, (dir) => heavy('node',
    [BOOT_SMOKE, '--release', facts.release, '--repo', dir,
      ...rewritten.flatMap((entry) => ['--patch', entry])]));
  say(`    exit ${String(boot.rc)}`);
  if (boot.rc !== 0) {
    // ── A HARNESS REASON IS NOT A RELEASE DEFECT, AND THE REFUSAL SAYS WHICH (alpha-7) ────────────────
    // MEASURED, FROM THE SMOKE'S OWN SCRATCH server.log: the boot died with
    //   `include (cordis:include): Error: config file not found: …/home/profiles/web/cordis.yml`
    // and `required startup failure: 1 entry did not activate` — the throwaway DSH home the smoke builds was
    // never seeded with the PROFILE CONFIG. The profile's include failed BEFORE any plugin was asked to load,
    // so a generic `boot-smoke-failed` sends a reader looking for a release defect that is not there. The
    // smoke's own log is on disk, so it is read here rather than the failure being reported blind.
    const failedRoot = /state root (\S+)/.exec(boot.out);
    let tail = '';
    if (failedRoot !== null && exists(join(failedRoot[1], 'logs', 'server.log'))) {
      tail = readText(join(failedRoot[1], 'logs', 'server.log'));
    }
    const classified = classifyBootFailure(`${boot.out}\n${tail}`);
    if (classified !== null) {
      refuse(classified.reason,
        `the boot smoke booted the release with a throwaway DSH home that holds no ${classified.file}, so the profile's include failed BEFORE any plugin was asked to load — this is a reason in the SMOKE (scripts/aura/release-boot-smoke.mjs, AURA's file), not a defect in the release. The smoke must leave the evidence where a reader can find it; NOTHING has been written`);
    }
    refuse('boot-smoke-failed', `the release resolves but does not live, so it is not cut over:\n${boot.out.trim()}`);
  }
  say(`    ${boot.out.trim().split('\n').slice(-1)[0]}`);
  // ── A RELEASE THAT BOOTS IS NOT A RELEASE WHOSE PLUGINS ACTIVATED (alpha-5 item 4) ────────────────
  // The smoke's `BOOTED` means the URL answered; a plugin can fail to activate and still be advertised, which
  // is how a dead panel ships. The smoke prints its scratch `state root`, so the evidence is read from THAT
  // root's logs rather than trusted from the smoke's summary line — and any "did not activate" other than
  // `aukora-board` is a refusal by name. `aukora-board` is the ONE exception because its missing sibling
  // (aukora-organism) is being fixed in the materializer, not silently tolerated: it is named in the output.
  const stateRoot = /state root (\S+)/.exec(boot.out);
  if (stateRoot === null) {
    refuse('boot-log-root-unknown', `the boot smoke printed no "state root", so the activation evidence it left behind cannot be found; NOTHING is proven about which plugins activated:\n${boot.out.trim().split('\n').slice(0, 4).join('\n')}`);
  }
  const skippedBoot = [];
  const bootLogs = walkFiles(join(stateRoot[1], 'logs'), (name) => name.endsWith('.log'), skippedBoot);
  // ── THE EVIDENCE MAY ARRIVE TWO WAYS, AND BOTH ARE READ (alpha-8) ─────────────────────────────────
  // MEASURED, FROM AURA'S `6cf9e011f`: the smoke now emits its captured child log on EVERY exit path with a
  // `  log:` prefix, and also accepts `--log-out <path>`. Reading only the scratch root would mean the two
  // halves fail to interlock — the smoke preserving evidence in its OUTPUT while this scan looks for a FILE —
  // so the output form is read as well. A boot whose evidence is in neither place still refuses.
  // MEASURED, AND THIS WAS A FAIL-OPEN OF MINE: the smoke prints `  log: N line(s) captured from the child`,
  // `  log: written to <path>` and a blank `  log: ` as BOOKKEEPING — not as the child's output. Counting those
  // as evidence made the scan pass a boot whose captured log was EMPTY, which is precisely the blindness Fable
  // measured: the launcher's stdout is not the backend's log, and the backend's log is a file in the scratch
  // root. Bookkeeping is filtered out, so an empty child log is NO evidence and refuses `boot-log-absent`.
  const BOOKKEEPING = /^(\d+ line\(s\) captured from the child|written to \S+|)$/;
  const prefixed = boot.out.split('\n').filter((line) => /^\s*log:/.test(line))
    .map((line) => line.replace(/^\s*log:\s?/, ''))
    .filter((text) => !BOOKKEEPING.test(text.trim()));
  const evidence = [
    ...bootLogs.map((log) => ({ where: log, text: readText(log) })),
    ...(prefixed.length === 0 ? [] : [{ where: 'the smoke output (  log: lines)', text: prefixed.join('\n') }]),
  ];
  if (evidence.length === 0) {
    refuse('boot-log-absent', `the boot smoke left no log under ${join(stateRoot[1], 'logs')} (skipped: ${skippedBoot.join('; ') || 'nothing'}) and printed no "  log:" lines either, so "the plugins activated" is UNPROVEN`);
  }
  const notActivated = [];
  for (const source of evidence) {
    source.text.split('\n').forEach((line, index) => {
      if (!/did not activate/i.test(line)) return;
      const named = /([A-Za-z0-9_@./-]*aukora[A-Za-z0-9_@./-]*|@[A-Za-z0-9_./-]+)/.exec(line);
      notActivated.push({ log: source.where, line: index + 1, id: named === null ? '(unnamed)' : named[1], text: line.trim().slice(0, 160) });
    });
  }
  const real = notActivated.filter((entry) => !entry.id.includes('aukora-board'));
  if (real.length > 0) {
    refuse('plugin-did-not-activate', `the release booted but these plugins did NOT activate, so it is not cut over:\n${real.map((entry) => `  ${entry.log}:${String(entry.line)} ${entry.text}`).join('\n')}`);
  }
  say(`    activation: ${String(bootLogs.length)} boot log(s) read, ${String(notActivated.length)} "did not activate" line(s)${notActivated.length === 0 ? '' : ` — all aukora-board: ${notActivated.map((entry) => entry.id).join(', ')}`}`);
  say('');
  const planned = await plan(opts);
  say(`  THE EXACT DIFF IT WOULD WRITE (nothing has been written):`);
  for (const line of planned.summary) say(`    ${line}`);
  for (const write of planned.writes) {
    say('');
    say(`    --- ${write.path}`);
    const before = write.before.split('\n'); const after = write.after.split('\n');
    // THE DIFF MUST BE READABLE, AND THE FIRST VERSION WAS NOT: when the only difference was a trailing
    // newline it printed a bare `+` with nothing after it, which tells a reviewer nothing at all. Line
    // numbers now, and the no-line-differs case is NAMED instead of shown as an empty change.
    let shown = 0;
    let differences = 0;
    for (let i = 0; i < Math.max(before.length, after.length); i += 1) {
      if (before[i] === after[i]) continue;
      differences += 1;
      if (shown >= 40) continue;
      shown += 1;
      if (before[i] !== undefined) say(`    ${String(i + 1).padStart(4)} - ${before[i]}`);
      if (after[i] !== undefined) say(`    ${String(i + 1).padStart(4)} + ${after[i]}`);
    }
    if (differences === 0) {
      say(`    (NO LINE DIFFERS: the bytes differ only in a trailing newline or in line endings, ${String(write.before.length)} -> ${String(write.after.length)} bytes)`);
    } else if (differences > shown) {
      say(`    … and ${String(differences - shown)} more differing line(s), not shown`);
    }
  }
  say('');
  say(`  ${String(planned.writes.length)} file(s) would change, each backed up 0600 first. This tool never starts, stops or signals a process: quit the app, then run apply, then reopen it.`);
  // ── THE RECEIPT: WHAT WAS VALIDATED, AGAINST WHICH BYTES (Codex finding 1) ────────────────────────
  // `apply` used to stage whatever it found, so bytes that were never prepared — or that changed after they
  // were — could be cut over. The receipt binds this validation to these bytes: the release, its tipSha, the
  // record digest, the composition digest, and the digest of every file this plan would write from.
  const receipt = {
    formatVersion: 1,
    release: facts.release,
    tipSha: facts.tipSha,
    recordSha: facts.recordSha,
    compositionSha: digestOf(join(facts.release, COMPOSITION_PATCH)),
    preparedAt: new Date().toISOString(),
    writes: planned.writes.map((write) => ({ path: write.path, beforeSha: sha256(write.before) })),
  };
  const receiptPath = assertInside(opts.support, join(opts.support, 'state', RECEIPT_NAME));
  mkdirSync(dirname(receiptPath), { recursive: true });
  writeAtomic(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 0o600);
  say(`  the receipt is ${receiptPath}: apply REQUIRES it and refuses if these bytes are no longer the bytes`);
}

// ── APPLY ───────────────────────────────────────────────────────────────────────────────────────────
async function apply(opts) {
  const facts = releaseFacts(opts.release);
  say(`desktop-cutover apply`);
  say(`  support   ${opts.support}${opts.support === DEFAULT_SUPPORT ? '' : '  (NOT Peter\'s real tree — court mode)'}`);
  const guarded = assertNotInsideLiveApp(opts.support, opts.liveAppPid);
  say(`  live app pids considered: ${guarded.length === 0 ? '(none found)' : guarded.join(', ')} — this process is not inside any of them`);
  const scan = await scanSessionLogs(opts.support, facts.release);
  say(`  session logs: ${String(scan.logs)} scanned against ${String(scan.known)} event types this release knows`);
  if (scan.offenders.length > 0) {
    refuse('session-event-unknown', `the restart would strand threads, so NOTHING has been written:\n  ${scan.offenders.join('\n  ')}`);
  }
  // ── F1: APPLY REQUIRES A RECEIPT THAT STILL MATCHES THE RELEASE'S BYTES ───────────────────────────
  const receiptPath = assertInside(opts.support, join(opts.support, 'state', RECEIPT_NAME));
  if (!exists(receiptPath)) {
    refuse('prepare-receipt-absent',
      `there is no prepare receipt at ${receiptPath}, so the bytes this cutover would stage were never validated. Run \`prepare ${facts.release}\` first — THIS IS NOT A STATEMENT ABOUT THE LIVE CONFIGURATION: an absent receipt means "run prepare", never "this configuration cannot be re-pointed"`);
  }
  const receipt = readJson(receiptPath);
  const stale = [];
  if (resolve(String(receipt.release ?? '')) !== resolve(facts.release)) stale.push(`the receipt names release ${String(receipt.release)}, not ${facts.release}`);
  if (receipt.tipSha !== facts.tipSha) stale.push(`the receipt was prepared for tipSha ${String(receipt.tipSha)}, and this release is ${String(facts.tipSha)}`);
  if (receipt.recordSha !== facts.recordSha) stale.push(`the release's record digest is ${facts.recordSha.slice(0, 12)}… but the receipt validated ${String(receipt.recordSha).slice(0, 12)}…`);
  const compositionSha = digestOf(join(facts.release, COMPOSITION_PATCH));
  if (receipt.compositionSha !== compositionSha) stale.push(`the release's composition patch is ${compositionSha.slice(0, 12)}… but the receipt validated ${String(receipt.compositionSha).slice(0, 12)}…`);
  if (stale.length > 0) {
    refuse('prepare-receipt-stale', `the release has changed since it was prepared, so this cutover would stage bytes nobody validated:\n  ${stale.join('\n  ')}\n  Run \`prepare ${facts.release}\` again. NOTHING has been written`);
  }
  // ── THE AUKORA PLUGIN SET MUST BE APPROVED BEFORE THE SWITCH ─────────────────────────────────────
  // A release that records its plugin set is launched with the set ENFORCED unless config.json says
  // `"allowUnapproved": true`, and the launcher refuses to start it with no installed approval. So a switch
  // without one would take the app down. The check is the RELEASE's own verifier, the code that will run.
  const setRecordPath = join(facts.release, '.dsh-build', 'plugin-set.json');
  const configPath = join(opts.support, 'config.json');
  if (exists(setRecordPath) && !(exists(configPath) && readJson(configPath).allowUnapproved === true)) {
    const gateState = join(opts.support, 'state', 'gate-state');
    const readOr = (path) => (exists(path) ? readJson(path) : null);
    const { verifySetApproval } = await import(pathToFileURL(
      join(facts.release, 'plugins', 'aukora-composition-gate', 'src', 'plugin-set.mjs')).href);
    try {
      const approved = verifySetApproval({
        record: readJson(setRecordPath),
        receipt: readOr(join(gateState, 'plugin-set-approval.json')),
        pin: readOr(join(gateState, 'plugin-set-approver.json')),
      });
      say(`  plugin set ${approved.setDigest.slice(0, 16)}… (${String(approved.count)} plugins) approved by pinned ${approved.approverDid}`);
    } catch (error) {
      refuse('plugin-set-unapproved', `${error instanceof Error ? error.message : String(error)}. The new release would not `
        + 'start: every AUKORA plugin is admitted only by the owner\'s approval of its record. NOTHING has been written. '
        + `Approve the set first, in ONE popup: node scripts/aukora/plugin-set.mjs approve --release ${facts.release}`);
    }
  }
  const planned = await plan(opts);
  // ── F6: A TARGET THAT MOVED UNDER THE PLAN IS REFUSED, NOT OVERWRITTEN ────────────────────────────
  const moved = [];
  for (const entry of Array.isArray(receipt.writes) ? receipt.writes : []) {
    const write = planned.writes.find((candidate) => candidate.path === entry.path);
    if (write === undefined) continue;
    const now = sha256(readText(write.path));
    if (now !== entry.beforeSha) moved.push(`${entry.path} is ${now.slice(0, 12)}… now, but the plan was made from ${String(entry.beforeSha).slice(0, 12)}… — a newer write landed under this cutover`);
  }
  if (moved.length > 0) {
    refuse('concurrent-change', `a file changed after this cutover was planned, so applying it would replace a newer write with stale content:\n  ${moved.join('\n  ')}\n  Re-run prepare against the current bytes. NOTHING has been written`);
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const manifestPath = assertInside(opts.support, join(opts.support, 'state', MANIFEST_NAME));
  mkdirSync(dirname(manifestPath), { recursive: true });
  const recoveryPath = assertInside(opts.support, join(opts.support, 'state', RECOVERY_NAME));
  const recovery = {
    formatVersion: 1, startedAt: new Date().toISOString(), release: facts.release, support: opts.support, phase: 'staging',
    writes: planned.writes.map((write) => ({ path: write.path, beforeSha: sha256(write.before), afterSha: sha256(write.after) })),
  };
  const writeRecovery = (phase, extra = {}) => {
    writeAtomic(recoveryPath, `${JSON.stringify({ ...recovery, ...extra, phase }, null, 2)}\n`, 0o600);
  };
  // F7: THE INTENT IS RECORDED BEFORE THE FIRST MUTATION, so an interrupted cutover is recoverable rather than
  // merely detectable.
  writeRecovery('staging');
  const backups = [];
  const staged = [];
  let manifest = null;
  try {
    // PHASE 1 — BACK UP AND STAGE. Nothing visible changes yet, and a failure here leaves every target alone.
    for (const write of planned.writes) {
      // F8: UNIQUE NAMES, NEVER OVERWRITTEN. One-second resolution plus `copyFileSync`'s overwrite meant a
      // retry inside the same second could replace the previous recovery bytes before its manifest was
      // replaced. The pid and a monotonic counter make the name unique, and COPYFILE_EXCL refuses a collision
      // rather than destroying whatever is there.
      const backup = `${write.path}.${stamp}-${String(process.pid)}-${String(backups.length)}.backup.bak`;
      copyFileSync(write.path, backup, fsConstants.COPYFILE_EXCL);
      chmodSync(backup, 0o600);
      backups.push({ path: write.path, backup, sha256Before: sha256(write.before), sha256Backup: digestOf(backup) });
      const temp = `${write.path}.cutover-stage-${String(process.pid)}-${String(staged.length)}`;
      writeFileSync(temp, write.after, { mode: 0o644 });
      chmodSync(temp, 0o644);
      staged.push({ write, temp });
    }
    // PHASE 2 — COMMIT. A rename in the same directory is the closest thing to atomic this tool has, and if one
    // fails the ones already committed are PUT BACK from their backups before the refusal.
    writeRecovery('committing');
    const committed = [];
    try {
      for (const entry of staged) {
        renameSync(entry.temp, entry.write.path);
        committed.push(entry);
      }
    } catch (error) {
      for (const entry of committed) {
        const taken = backups.find((candidate) => candidate.path === entry.write.path);
        if (taken !== undefined) copyFileSync(taken.backup, entry.write.path);
      }
      writeRecovery('rolled-back', { failure: String(error?.code ?? error), restored: committed.map((entry) => entry.write.path) });
      refuse('write-phase-failed', `the write phase could not finish (${String(error?.code ?? error)}), so the ${String(committed.length)} file(s) already committed were RESTORED from their backups. The recovery record at ${recoveryPath} says exactly what happened. NOTHING is half-applied`);
    }
    // PHASE 3 — THE MANIFEST, then the recovery record is cleared: the cutover is whole.
    // MEASURED: this was `const manifest = …` INSIDE the try, while the function's `return manifest` sits
    // outside it — so every apply wrote every file correctly and then died with a ReferenceError, which the
    // court reported as `exit 1` on arms that had already observed the writes they assert.
    manifest = { formatVersion: 1, appliedAt: stamp, release: facts.release, recordSha: facts.recordSha, support: opts.support, oldRoot: planned.oldRoot, backups };
    writeAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 0o600);
    rmSync(recoveryPath, { force: true });
    say(`  ${String(backups.length)} backup(s), mode 0600, unique names under ${stamp}`);
  } finally {
    for (const entry of staged) { try { rmSync(entry.temp, { force: true }); } catch { /* already renamed */ } }
  }
  say('');
  for (const line of planned.summary) say(`  ${line}`);
  say('');
  say(`  the manifest is ${manifestPath}`);
  say(`  NOTHING was started, stopped or signalled. Quit the app and reopen it to boot ${facts.release}.`);
  return manifest;
}

// ── ROLLBACK ───────────────────────────────────────────────────────────────────────────────────────
function rollback(opts) {
  const manifestPath = assertInside(opts.support, join(opts.support, 'state', MANIFEST_NAME));
  if (!exists(manifestPath)) refuse('nothing-to-roll-back', `${manifestPath} is absent, so this tool does not know what it changed`);
  const manifest = readJson(manifestPath);
  say(`desktop-cutover rollback`);
  say(`  manifest  ${manifestPath} (applied ${manifest.appliedAt}, release ${manifest.release})`);
  for (const entry of manifest.backups) {
    if (!exists(entry.backup)) refuse('backup-missing', `${entry.backup} is gone, so a byte-for-byte rollback is impossible`);
    const now = digestOf(entry.backup);
    if (now !== entry.sha256Backup) refuse('backup-changed', `${entry.backup} is ${now.slice(0, 12)} but was ${String(entry.sha256Backup).slice(0, 12)} when it was written; refusing to restore bytes that are not the ones taken`);
    assertInside(opts.support, entry.path);
  }
  for (const entry of manifest.backups) {
    copyFileSync(entry.backup, entry.path);
    chmodSync(entry.path, 0o600);
    say(`  restored ${entry.path} byte for byte (${digestOf(entry.path).slice(0, 12)})`);
  }
  say(`  ${String(manifest.backups.length)} file(s) restored. Nothing was started, stopped or signalled.`);
}

/** WHICH BOOT FAILURE IS THIS? A pure function so a court can call it with REAL captured output.
 *
 * MEASURED (alpha-7): a boot can die because the SMOKE's throwaway DSH home holds no profile config —
 * `include (cordis:include): Error: config file not found: …/home/profiles/web/cordis.yml` — and that is a
 * reason in the smoke, not a defect in the release. Reporting it as a generic `boot-smoke-failed` sends a
 * reader hunting a release bug that is not there, so the failure is NAMED. Returns null for every other
 * failure, which keeps `boot-smoke-failed` for the cases where the release really is the suspect.
 */
export function classifyBootFailure(text) {
  const missingProfile = /config file not found:\s*(\S*profiles\/\S*cordis\.yml)/.exec(String(text ?? ''));
  if (missingProfile !== null) return { reason: 'boot-smoke-profile-config-missing', file: missingProfile[1] };
  return null;
}

// ── MAIN ───────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  try {
    if (opts.command === 'prepare') { if (opts.release === null) refuse('bad-usage', USAGE); await prepare(opts); } else if (opts.command === 'apply') {
      if (opts.release === null) refuse('bad-usage', USAGE); await apply(opts);
    } else if (opts.command === 'rollback') { rollback(opts); } else { refuse('bad-usage', USAGE); }
  } catch (error) {
    if (error instanceof Refused) { process.stderr.write(`REFUSED: ${error.reason}: ${error.detail}\n`); process.exit(1); }
    throw error;
  }
}

// RUN ONLY WHEN INVOKED, so a court can IMPORT this file to call `classifyBootFailure` without the CLI
// dispatching on the court's own argv — MEASURED: without this guard the import called `parseArgs(['...court
// path...'])` and refused with bad-usage before a single arm ran.
// **THE NAIVE MAIN GUARD, REPLACED BY THE ONE THIS FILE ALREADY IMPORTS.** MEASURED, and it was the whole Mac/Linux
// split: `import.meta.url` is canonicalised by Node while `pathToFileURL(process.argv[1])` keeps the operating system's
// spelling, and the court's scratch lives under /var/folders/... on macOS whose real path is /private/var/folders/... —
// so the two never matched, `main()` never ran, and every MUTANT COPY exited 0 with ZERO OUTPUT. That is precisely the
// failure `is-main.mjs` documents in its own header (":9-11 … exit 0 and ZERO lines of output. A guard whose failure
// mode is 'silently does nothing' is worse than no guard, because a caller reads the exit code as a verdict") — the
// file imported the fixed guard at :39 and never used it. On Linux /tmp has no such indirection, which is why the same
// court was 58/58 green there. `isMainModule` canonicalises BOTH sides (is-main.mjs:30-34), and `mutated()` pins this
// module's import of it back to the real checkout, so a mutant copy takes the same path the real tool does.
if (isMainModule(import.meta.url)) await main();
