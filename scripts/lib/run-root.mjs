// run-root.mjs — ONE mktemp run root per run, cleaned by signal, with stale runs reaped safely.
//
// MEASURED, 2026-09-26: my own cut and parity tools left support copies, worktrees, parity scratch and logs in
// /private/tmp, and the parity boot left TWO BACKENDS RUNNING at PPID 1 — because a backend re-parents to init
// when its parent dies, and nothing reaped it. This module is the fix, and it is deliberately narrow:
//
//   * createRunRoot() makes ONE mktemp dir containing a `.aukora-run-root` marker (owner, pid, pgid, created,
//     realpath). Own it — every support copy, worktree, scratch dir and log lives INSIDE it.
//   * installCleanup() registers EXIT, INT, TERM and HUP. Cleanup reaps children FIRST — the process GROUP and
//     any process whose ENVIRONMENT names the run root (that is what catches a backend re-parented to PID 1) —
//     and only THEN removes the root.
//   * A run removes paths IT created. Caller-supplied paths (--support, --target, …) are never removed.
//   * reapStaleRuns() removes a directory ONLY with a valid marker, a realpath inside os.tmpdir() or
//     /private/tmp, older than 6h, no open file descriptors and a DEAD pid — and it names every skip. It never
//     sweeps generic temp, and it never removes a directory it cannot prove it owns.
//   * assertDiskBudget() refuses BY NAME before any full copy.
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, statfsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { platformTool, platformToolSkip } from './platform-tools.mjs';
import { tmpdir } from 'node:os';
import { basename, join, sep } from 'node:path';

export const MARKER = '.aukora-run-root';
export const RUN_ROOT_ENV = 'AUKORA_RUN_ROOT';
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const GRACE_MS = 1500;

/** A refusal with a NAME, so every caller can say which protection refused. */
export class RunRootRefusal extends Error {
  constructor(reason, detail) { super(`${reason}: ${detail}`); this.name = 'RunRootRefusal'; this.reason = reason; this.detail = detail; }
}

const dead = (pid) => {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; }
};
const inside = (candidate, parent) => candidate === parent || candidate.startsWith(parent.endsWith(sep) ? parent : parent + sep);

/** The set of roots this process created, so cleanup can never reach a path it does not own. */
const owned = new Set();

export function createRunRoot({ owner = basename(process.argv[1] ?? 'unknown'), prefix = 'aukora-run', base = tmpdir(), marker = MARKER } = {}) {
  if (!existsSync(base)) throw new RunRootRefusal('run-root-base-absent', `${base} does not exist`);
  const root = realpathSync(mkdtempSync(join(base, `${prefix}-`)));
  const record = { owner, pid: process.pid, pgid: safePgid(), created: new Date().toISOString(), realpath: root };
  writeFileSync(join(root, marker), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  owned.add(root);
  return {
    root, record, markerPath: join(root, marker),
    /** A path INSIDE the root. Every artifact of a run belongs here. */
    path: (...segments) => join(root, ...segments),
    /** The environment that lets a reaper find this run's children even after they re-parent to PID 1. */
    env: (extra = {}) => ({ ...extra, [RUN_ROOT_ENV]: root }),
    /** Reap children (group AND by environment), then remove the root. Idempotent. */
    dispose: () => disposeRunRoot(root, marker),
  };
}

const safePgid = () => { try { return process.getpgid(0); } catch { return process.pid; } };

/** Children whose ENVIRONMENT names the run root — the only reliable handle on a backend that re-parented. */
export function childrenNamingRunRoot(root, { ps = defaultPs } = {}) {
  const found = [];
  for (const line of ps().split('\n')) {
    if (!line.includes(`${RUN_ROOT_ENV}=${root}`)) continue;
    const pid = Number(line.trim().split(/\s+/)[0]);
    if (Number.isFinite(pid) && pid !== process.pid) found.push(pid);
  }
  return found;
}
const defaultPs = () => {
  // `-A` IS REQUIRED: MEASURED — `ps -E` alone does NOT list all processes (and on macOS prints no environment
  // for a system-wide list at all), while `ps -AE -o pid=,command=` does. Without `-A` the orphan sweep silently
  // finds nothing, which is exactly the bug the court's PPID-1 arm caught.
  const r = spawnSync('/bin/ps', ['-AE', '-o', 'pid=,command='], { encoding: 'utf8', timeout: 10000 });
  return r.stdout ?? '';
};

/** SIGTERM, brief grace, then SIGKILL. Never signals our own pid. */
export function reapRunRoot(root, { ps = defaultPs, graceMs = GRACE_MS, sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } = {}) {
  const targets = new Set(childrenNamingRunRoot(root, { ps }));
  for (const pid of targets) { try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ } }
  if (targets.size > 0) sleep(graceMs);
  for (const pid of targets) { if (!dead(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } }
  return [...targets];
}

/** Remove the root IF AND ONLY IF this process created it (or holds a marker for it). */
export function disposeRunRoot(root, marker = MARKER, { remove = true } = {}) {
  const resolved = existsSync(root) ? realpathSync(root) : root;
  const ours = owned.has(resolved) || ownsMarker(resolved, marker);
  if (!ours) return { removed: false, reason: 'not-created-by-this-process', root: resolved, reaped: [] };
  const reaped = reapRunRoot(resolved);
  if (remove && existsSync(resolved)) rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  owned.delete(resolved);
  return { removed: remove, reaped, root: resolved };
}

const ownsMarker = (root, marker) => {
  try { const r = JSON.parse(readFileSync(join(root, marker), 'utf8')); return r.pid === process.pid; } catch { return false; }
};

/** EXIT, INT, TERM and HUP, all pointing at the same idempotent cleanup. */
export function installCleanup(runRoot, { onSignal } = {}) {
  let done = false;
  const run = (signal) => {
    if (done) return; done = true;
    try { runRoot.dispose(); } catch { /* cleanup is a courtesy, never a crash */ }
    if (onSignal !== undefined) onSignal(signal);
    if (signal !== 'exit') process.exit(signal === 'INT' ? 130 : 128 + ({ HUP: 1, TERM: 15 }[signal] ?? 0));
  };
  process.on('exit', () => run('exit'));
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => run(signal.replace('SIG', '')));
  return run;
}

/** Refuse BY NAME before any full copy. */
export function assertDiskBudget({ needBytes, path = '/', label = 'the copy' }) {
  let freeBytes = null;
  try { const stats = statfsSync(path); freeBytes = Number(stats.bavail) * Number(stats.bsize); } catch { freeBytes = null; }
  if (freeBytes === null) throw new RunRootRefusal('disk-budget-unreadable', `could not read free space for ${path}, so ${label} is refused rather than attempted`);
  if (freeBytes < needBytes) throw new RunRootRefusal('disk-budget-insufficient', `${label} needs ${String(needBytes)} bytes and ${path} has ${String(freeBytes)} free`);
  return { freeBytes, needBytes };
}
/**
 * How big a tree is, counting FILES only and copying nothing — the input to `assertDiskBudget`, so a caller can
 * refuse a copy BEFORE making it.
 *
 * THIS FUNCTION WAS MISSING FROM THE MODULE WHILE THE API NOTE TOLD THREE LANES IT EXISTED. My import-tightening
 * pass deleted it, nothing called it, and no court measured it — so the only thing standing between the note and
 * the truth was a `SyntaxError: does not provide an export named 'directorySizeBytes'` raised by the first caller
 * that tried to use it. A documented export that no court calls is a claim, not an API. It is measured now.
 */
export function directorySizeBytes(root, { limit = 200000 } = {}) {
  let total = 0; let seen = 0;
  const walk = (dir) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (++seen > limit) return;
      const full = join(dir, entry.name);
      try { if (entry.isDirectory()) walk(full); else if (entry.isFile()) total += statSync(full).size; } catch { /* raced away */ }
    }
  };
  walk(root);
  return total;
}

/**
 * Remove ONLY stale run roots this module can prove are ours and dead. Every skip is named.
 * A directory is removed when ALL hold: a valid marker, a realpath inside an allowed parent, older than
 * maxAgeMs, no open file descriptors (`lsof +D`), and a DEAD pid. Anything else is reported, never touched.
 */
export function reapStaleRuns({ parents = [tmpdir(), scratchParent()], maxAgeMs = SIX_HOURS_MS, now = Date.now(), marker = MARKER, lsof = defaultLsof, kill = dead } = {}) {
  const removed = []; const skipped = [];
  for (const parent of parents) {
    let entries = [];
    try { entries = readdirSync(parent, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = join(parent, entry.name);
      const skip = (reason) => skipped.push({ dir, reason });
      let real; try { real = realpathSync(dir); } catch { skip('unreadable'); continue; }
      if (!parents.some((p) => inside(real, real)) ) { /* realpath must stay inside an allowed parent */ }
      if (!parents.some((p) => inside(real, realpathOr(p)))) { skip('outside-allowed-parents'); continue; }
      let record; try { record = JSON.parse(readFileSync(join(dir, marker), 'utf8')); } catch { skip('no-marker'); continue; }
      if (record.realpath !== real) { skip('marker-realpath-mismatch'); continue; }
      let ageMs; try { ageMs = now - statSync(dir).mtimeMs; } catch { skip('unstattable'); continue; }
      if (ageMs < maxAgeMs) { skip('too-young'); continue; }
      if (!kill(record.pid)) { skip('pid-alive'); continue; }
      const fds = lsof(dir);
      if (fds === null) { skip('lsof-unavailable'); continue; }
      if (fds.length > 0) { skip('open-fd'); continue; }
      try { rmSync(real, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); removed.push({ dir: real, owner: record.owner }); }
      catch { skip('remove-failed'); }
    }
  }
  return { removed, skipped };
}
const realpathOr = (p) => { try { return realpathSync(p); } catch { return p; } };
const defaultLsof = (dir) => {
  // **A MISSING INSTRUMENT IS NOT PERMISSION.** MEASURED (alpha-26): this called the absolute path `/usr/sbin/lsof`,
  // and on a host without it `spawnSync` sets `error` and leaves `stdout` null — so the function returned `[]`, which
  // the reaper below reads as "this directory has NO open file descriptors", the last precondition before it deletes
  // it. A hard-coded macOS path that fails open into a DELETION is worse than the crash this lane set out to remove.
  // The tool now comes from the one shared seam (so `AUKORA_LSOF_BIN` can stand in for it), and an absent tool
  // returns NULL rather than an empty list, because the two mean opposite things.
  const lsof = platformTool('lsof');
  if (!lsof.available) {
    process.stderr.write(`${platformToolSkip('lsof')}\n`);
    return null;
  }
  const r = spawnSync(lsof.bin, ['+D', dir], { encoding: 'utf8', timeout: 10000 });
  if (r.error !== undefined && r.error !== null) {
    process.stderr.write(`${platformToolSkip('lsof', { reason: `lsof could not be run: ${String(r.error.message)}` })}\n`);
    return null;
  }
  return (r.stdout ?? '').split('\n').filter((line) => line.trim() !== '').slice(1);
};

// ── THE DISK GUARD (§3 of the disk-leak audit, 2026-09-26) ────────────────────────────────────────────────────────
//
// Peter lost disk every day to scratch nobody collected. The module above makes ONE run root and cleans it by signal;
// this is the policy layer the audit asks for, composed from it rather than beside it: a FIXED base the guard owns
// outright, a marker rich enough to spot a reused pid, a reaper for the base, a budget that refuses by name, and a
// clone that will not silently fall back to copying bytes.
//
// FOUR PROPERTIES ARE LOAD-BEARING, and each is a court arm:
//   * **THE BASE IS OURS.** `/private/tmp/aukora-scratch-$UID`, mode 0700, refused if it is a symlink or owned by
//     somebody else. `$TMPDIR` is never wiped and never owned; this is.
//   * **REMOVAL NEVER FOLLOWS A LINK.** Every removal goes through `lstat` and a realpath check, so a symlink planted
//     in the base points at a sentinel that survives — an arm drives exactly that.
//   * **A REFUSAL CANNOT HIDE.** `SCRATCH_CAP` and `FREE_FLOOR` refuse BY NAME and the process exits **2**, which the
//     front door counts as not-green.
//   * **NO SILENT BYTE COPY.** `cp -c -R` is a clone on APFS; if it is unavailable the guard refuses rather than
//     spending the disk it is protecting.
import { spawnSync as spawnGuard } from 'node:child_process';
import { homedir } from 'node:os';

/** The audit's numbers. A court asserts both defaults, because a cap that drifts silently is not a cap. */
export const SCRATCH_CAP_BYTES = 5 * 1024 ** 3;
export const FREE_FLOOR_BYTES = 20 * 1024 ** 3;
/** The largest source `clone` will copy without being told twice. */
export const CLONE_MAX_BYTES = 512 * 1024 ** 2;
/** A child with no marker is scratch by definition in a base the guard owns — but only once it is this old. */
export const UNMARKED_MAX_AGE_MS = 60 * 60 * 1000;
/** The only names the reaper will ever consider. Nothing is derived from `dirname`. */
export const SCRATCH_NAME = /^[a-z0-9-]+-[A-Za-z0-9]{6}$/;

/**
 * THE SHORT TEMP PARENT THIS PLATFORM ACTUALLY HAS. `/private/tmp` is a macOS path: on Linux it does not exist, so
 * `mkdir` of anything under it fails with EACCES — which is how owner-cut-linux on bf564e7 died
 * (`EACCES mkdir /private/tmp/aukora-scratch-1001`, via tests/helpers/court-scratch.mjs shortSocketPath). `/tmp` is the
 * equivalent short path there, and both are short enough for a socket under the 104-byte `sun_path` limit.
 *
 * The platform is a parameter rather than a read of the ambient one at every call, so a court can ask about BOTH
 * platforms on one machine. It must not be stubbed instead: a stub would prove nothing about this rule.
 */
export function scratchParent(platform = process.platform) {
  return platform === 'darwin' ? '/private/tmp' : '/tmp';
}

/** The guard's own base, per uid. Short enough for a socket under the 104-byte `sun_path` limit. */
export function scratchBase(uid = typeof process.getuid === 'function' ? process.getuid() : 'unknown',
                           platform = process.platform) {
  return `${scratchParent(platform)}/aukora-scratch-${String(uid)}`;
}

/**
 * Create the base if needed and REFUSE if it is not ours to use.
 *
 * A symlinked base would silently redirect every root, every reaper and every removal somewhere else — including to a
 * directory this process does not own — so it is refused rather than resolved.
 */
export function ensureScratchBase(base = scratchBase()) {
  let stats = null;
  try { stats = lstatSync(base); } catch { stats = null; }
  if (stats !== null && stats.isSymbolicLink()) {
    throw new RunRootRefusal('scratch-base-symlink', `${base} is a symlink; the guard will not use a base that can be redirected`);
  }
  if (stats === null) {
    mkdirSync(base, { recursive: true, mode: 0o700 });
    stats = lstatSync(base);
  }
  if (!stats.isDirectory()) throw new RunRootRefusal('scratch-base-not-a-directory', `${base} exists and is not a directory`);
  if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) {
    throw new RunRootRefusal('scratch-base-foreign-owner', `${base} is owned by uid ${String(stats.uid)}, not ${String(process.getuid())}`);
  }
  if ((stats.mode & 0o777) !== 0o700) {
    // NOT A REFUSAL: tightening a directory we own is the fix, and refusing would strand a machine that has one.
    try { chmodSync(base, 0o700); } catch { /* reported by the next reading */ }
  }
  return base;
}

/** When this process started, from `ps -o lstart=`, so a REUSED pid is detectable rather than mistaken for alive. */
export function processStartTime(pid = process.pid, { ps = defaultPsLstart } = {}) {
  try { return ps(pid).trim(); } catch { return null; }
}
const defaultPsLstart = (pid) => {
  const r = spawnGuard('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', timeout: 5000 });
  return r.stdout ?? '';
};

/** Whether the pid is alive AND still the process that wrote the marker. A reused pid is not a live holder. */
export function holderIsLive(record, { kill = dead, startTime = processStartTime } = {}) {
  if (record === null || typeof record !== 'object') return false;
  if (!Number.isFinite(record.pid) || record.pid <= 0) return false;
  if (kill(record.pid)) return false;
  if (typeof record.processStartTime !== 'string' || record.processStartTime === '') return true;
  const now = startTime(record.pid);
  if (now === null || now === '') return true;
  // The SAME pid with a DIFFERENT start time is a different process, and the root it left behind is garbage.
  return now.trim() === record.processStartTime.trim();
};

/** The sum of what live roots in the base say they are charged, plus what a caller is about to add. */
export function chargedBytesIn(base = scratchBase(), { holderLive = holderIsLive } = {}) {
  let total = 0; const holders = [];
  let entries = [];
  try { entries = readdirSync(base, { withFileTypes: true }); } catch { return { total, holders }; }
  for (const entry of entries) {
    if (!entry.isDirectory() || !SCRATCH_NAME.test(entry.name)) continue;
    const dir = join(base, entry.name);
    let record = null;
    try { record = JSON.parse(readFileSync(join(dir, MARKER), 'utf8')); } catch { continue; }
    if (!holderLive(record)) continue;
    const charged = Number(record.chargedBytes);
    if (Number.isFinite(charged) && charged > 0) { total += charged; holders.push({ owner: record.owner ?? 'unknown', pid: record.pid, bytes: charged }); }
  }
  holders.sort((a, b) => b.bytes - a.bytes);
  return { total, holders };
}

/**
 * Refuse BY NAME, with the audit's message, and let the caller exit 2.
 *
 * `AUKORA_SCRATCH_CAP` and `AUKORA_FREE_FLOOR` exist so a court can drive both refusals without filling a disk.
 */
/**
 * **THE FREE-SPACE FLOOR, FROM `AUKORA_FREE_FLOOR`, PARSED ONCE FOR EVERY CALLER.**
 *
 * The default is 20 GiB, which is right for a workstation and wrong for an ephemeral CI runner — MEASURED on
 * `owner-cut-linux`: **`/ has 14229106688 free` (13.25 GiB)**, so every mutant was refused by a floor larger than
 * the disk it was measuring. *A budget that cannot be met on the machine running it is not a budget, it is a
 * refusal to start.*
 *
 * ── **AND THE TWO WAYS THE OBVIOUS SPELLING FAILS OPEN, WHICH IS WHY THIS IS A FUNCTION** ─────────────────
 *
 * `Number(process.env.AUKORA_FREE_FLOOR ?? DEFAULT)` reads as safe and is not:
 *
 *   * **`AUKORA_FREE_FLOOR=abc` gives `NaN`**, and `free < NaN` is **false** — so a typo in an environment
 *     variable silently DISABLES the floor. A fail-open guard is worse than no guard, because it is believed.
 *   * **`AUKORA_FREE_FLOOR=` (set, empty) gives `0`** — a floor of zero bytes, which is exactly the "never 0"
 *     case: a variable exported with no value must not turn a budget into no budget.
 *
 * So a value counts only if it parses to a **positive finite number**; anything else — unset, empty, garbage,
 * negative, `Infinity` — falls back to the default. **The floor can be lowered deliberately and never by accident.**
 *
 * **`raw` IS REQUIRED AND HAS NO DEFAULT, WHICH IS A CORRECTION I MADE AFTER MEASURING MY OWN ARM.** It was
 * `raw = process.env.AUKORA_FREE_FLOOR`, and a default parameter that reads the environment **cannot express
 * "unset"**: a court passing `undefined` to test the fallback silently re-read the variable it was trying to
 * bypass, so the arm failed while the code was right. *A knob you cannot hand an absent value to is a knob whose
 * fallback nobody can test.* Every caller now passes the environment in explicitly.
 *
 * @param {string|undefined} raw the environment value — `undefined` means genuinely unset.
 * @returns {number} a positive byte count.
 */
export function freeFloorBytes(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return FREE_FLOOR_BYTES;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : FREE_FLOOR_BYTES;
}

export function assertScratchBudget({ base = scratchBase(), needBytes = 0, label = 'a scratch root', owner = 'unknown', freeFloor = freeFloorBytes(process.env.AUKORA_FREE_FLOOR), cap = Number(process.env.AUKORA_SCRATCH_CAP ?? SCRATCH_CAP_BYTES) } = {}) {
  const { total, holders } = chargedBytesIn(base);
  const giB = (bytes) => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  if (total + needBytes > cap) {
    const top = holders.slice(0, 3).map(h => `${h.owner} pid ${String(h.pid)} ${giB(h.bytes)}`).join('; ');
    throw new RunRootRefusal('scratch-cap', `AUKORA-DISK-GUARD REFUSED scratch-cap: ${owner} wants ${label} (${giB(needBytes)}); scratch ${giB(total)} of ${giB(cap)} [top holders: ${top}]`);
  }
  let freeBytes = null;
  try { const stats = statfsSync(base); freeBytes = Number(stats.bavail) * Number(stats.bsize); } catch { freeBytes = null; }
  if (freeBytes === null) throw new RunRootRefusal('scratch-free-unreadable', `AUKORA-DISK-GUARD REFUSED free-floor: could not read free space at ${base}, so ${label} is refused rather than attempted`);
  if (freeBytes - needBytes < freeFloor) {
    throw new RunRootRefusal('free-floor', `AUKORA-DISK-GUARD REFUSED free-floor: ${owner} wants ${label} (${giB(needBytes)}); free ${giB(freeBytes)} (floor ${giB(freeFloor)})`);
  }
  return { total, freeBytes, holders };
}

/**
 * Reap the guard's OWN base: dead or reused pids, and unmarked children older than an hour.
 *
 * **WHY THIS IS NOT `reapStaleRuns`.** That function skips an unmarked directory on purpose, because it sweeps
 * `$TMPDIR` where anything might belong to anybody. **THE BASE IS DIFFERENT: the guard owns it outright**, so an
 * unmarked child in it is scratch by definition — and skipping those was the blind spot that let a failed run's
 * directory sit there forever. The name pattern is checked FIRST, so nothing derived from a directory listing can
 * ever name a path outside the base.
 */
export function reapScratchBase({ base = scratchBase(), now = Date.now(), holderLive = holderIsLive, remove = rmSync } = {}) {
  const removed = []; const skipped = [];
  let entries = [];
  try { entries = readdirSync(base, { withFileTypes: true }); } catch { return { removed, skipped }; }
  for (const entry of entries) {
    if (!SCRATCH_NAME.test(entry.name)) { skipped.push({ name: entry.name, reason: 'name-not-a-run-root' }); continue; }
    const dir = join(base, entry.name);
    let stats = null;
    try { stats = lstatSync(dir); } catch { skipped.push({ name: entry.name, reason: 'unstattable' }); continue; }
    // **A SYMLINK IS NEVER FOLLOWED AND NEVER REMOVED AS A TREE**: the name matched, so something is imitating a run
    // root, and the honest thing is to name it rather than to recurse into wherever it points.
    if (stats.isSymbolicLink()) { skipped.push({ name: entry.name, reason: 'symlink-not-followed' }); continue; }
    if (!stats.isDirectory()) { skipped.push({ name: entry.name, reason: 'not-a-directory' }); continue; }
    let record = null;
    let marked = true;
    try { record = JSON.parse(readFileSync(join(dir, MARKER), 'utf8')); } catch { marked = false; }
    if (marked) {
      if (record?.realpath !== undefined && record.realpath !== realpathOr(dir)) { skipped.push({ name: entry.name, reason: 'marker-realpath-mismatch' }); continue; }
      if (holderLive(record)) { skipped.push({ name: entry.name, reason: 'holder-live' }); continue; }
    } else {
      const ageMs = now - stats.mtimeMs;
      if (ageMs < UNMARKED_MAX_AGE_MS) { skipped.push({ name: entry.name, reason: 'unmarked-too-young' }); continue; }
    }
    try { remove(join(base, entry.name), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); removed.push({ name: entry.name, marked }); }
    catch { skipped.push({ name: entry.name, reason: 'remove-failed' }); }
  }
  return { removed, skipped };
}

/**
 * Open one scratch root under the guard's base: budget first, marker second, cleanup registered last.
 *
 * **THE ORDER IS THE PROTECTION.** A budget refusal must happen BEFORE anything is created, or the guard spends the
 * disk it exists to protect; the marker must exist BEFORE the caller can put anything in the root, or a crash leaves
 * an unmarked directory the reaper has to age out; and cleanup must be registered before the caller writes, or the
 * first failure leaks.
 *
 * @returns the run root from `createRunRoot`, with its marker rewritten to the guard's richer shape.
 */
export function openScratch({ owner = basename(process.argv[1] ?? 'unknown'), label = 'scratch', maxBytes = 0, base = null, registerCleanup = true, reap = true, budget = true } = {}) {
  const root = base ?? ensureScratchBase(process.env.AUKORA_SCRATCH_BASE ?? scratchBase());
  if (reap) reapScratchBase({ base: root });
  if (budget) assertScratchBudget({ base: root, needBytes: maxBytes, label, owner });
  // NESTED USE: inside an existing run root, so a killed parent's tree takes its children with it.
  const parent = process.env[RUN_ROOT_ENV];
  const createBase = typeof parent === 'string' && parent !== '' && existsSync(parent) ? parent : root;
  const handle = createRunRoot({ owner, prefix: label.toLowerCase().replace(/[^a-z0-9-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'scratch', base: createBase });
  const record = {
    owner, label, pid: process.pid, pgid: safePgid(),
    processStartTime: processStartTime(process.pid),
    argv: process.argv.slice(0, 8),
    chargedBytes: maxBytes,
    createdAt: new Date().toISOString(),
    realpath: handle.root,
  };
  writeFileSync(handle.markerPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  if (registerCleanup) installGuardCleanup(handle);
  return { ...handle, record, base: root };
}

/**
 * EXIT, INT, TERM, HUP **and uncaughtException**, all pointing at the same idempotent cleanup.
 *
 * The module's `installCleanup` covers the four signals and exits with a truthful `128+n`. This adds the two things
 * §3 asks for on top: the root's **process group** is killed before the environment sweep, because a `spawnSync` blocks
 * the event loop and a group kill is what still reaches a child; and an **uncaughtException** cleans up rather than
 * leaving the tree behind.
 */
export function installGuardCleanup(runRoot, { onSignal } = {}) {
  const inner = installCleanup(runRoot, { onSignal });
  const killGroup = () => {
    const pgid = runRoot.record?.pgid;
    if (!Number.isFinite(pgid) || pgid <= 0 || pgid === process.pid) return [];
    try { process.kill(-pgid, 'SIGTERM'); } catch { return []; }
    return [pgid];
  };
  const once = (() => { let done = false; return (fn) => { if (done) return; done = true; fn(); }; })();
  process.on('uncaughtException', (error) => {
    once(() => {
      killGroup();
      try { runRoot.dispose(); } catch { /* cleanup is a courtesy */ }
      process.stderr.write(`aukora-disk-guard: cleaned ${runRoot.root} after ${String(error?.message ?? error)}\n`);
      process.exit(1);
    });
  });
  return (signal = 'exit') => { once(() => killGroup()); inner(signal); };
}

/** The refusals `clone` makes before it copies a byte. Each names what it refused and why. */
export function assertCloneSource(src, { repoRoot = process.cwd(), home = homedir() } = {}) {
  const real = realpathOr(src);
  const forbidden = [
    ['repo-root', realpathOr(repoRoot)],
    ['home', home],
    ['root', '/'],
    ['aukora-support', join(home, 'Library', 'Application Support', 'AUKORA')],
  ];
  for (const [reason, path] of forbidden) {
    if (real === realpathOr(path)) throw new RunRootRefusal(`clone-refuses-${reason}`, `${src} is the ${reason}; the guard will not copy a whole tree it was never meant to`);
  }
  return real;
}

/**
 * Copy a source tree into scratch — **and never silently as bytes.**
 *
 * `cp -c -R` clones on APFS: the copy costs no disk until something writes to it. If the platform cannot clone, the
 * guard REFUSES rather than falling back, because a silent byte copy spends exactly the disk this guard protects and
 * does it without telling anybody. `allowByteCopy: true` says so out loud and still counts against the budget.
 */
export function clone(src, dest, { maxBytes = CLONE_MAX_BYTES, allowByteCopy = false, budget = true } = {}) {
  const real = assertCloneSource(src);
  const size = directorySizeBytes(real);
  if (size > maxBytes) {
    throw new RunRootRefusal('clone-too-large', `${src} is ${String(size)} bytes, over the ${String(maxBytes)} byte limit`);
  }
  if (budget) assertScratchBudget({ base: dirnameOf(dest), needBytes: size, label: `a clone of ${basename(real)}` });
  const cloneable = process.platform === 'darwin' && !process.env.AUKORA_SCRATCH_NO_CLONE;
  if (!cloneable && !allowByteCopy) {
    throw new RunRootRefusal('clone-unavailable',
      `AUKORA-DISK-GUARD REFUSED clone-unavailable: ${src} cannot be cloned on ${process.platform}`
      + `${process.env.AUKORA_SCRATCH_NO_CLONE ? ' with AUKORA_SCRATCH_NO_CLONE set' : ''}, and the guard will not fall back to a byte copy silently`);
  }
  const args = cloneable ? ['-c', '-R', real, dest] : ['-R', '--reflink=auto', real, dest];
  const result = spawnGuard('/bin/cp', args, { encoding: 'utf8', timeout: 600000 });
  if (result.status !== 0) {
    throw new RunRootRefusal('clone-failed', `cp ${args.slice(0, 2).join(' ')} ${src} → ${dest} exited ${String(result.status)}: ${(result.stderr ?? '').trim().slice(0, 200)}`);
  }
  return { bytes: size, method: cloneable ? 'clone' : 'byte-copy' };
}
const dirnameOf = (p) => { const i = p.lastIndexOf(sep); return i <= 0 ? p : p.slice(0, i); };

// ── THE CLI THE TWO WRAPPERS CALL ─────────────────────────────────────────────────────────────────────────────────
//
// §3: "The bash wrapper `scripts/lib/run-root.sh` and a new Python wrapper `scripts/lib/run_root.py` both call
// `node scripts/lib/run-root.mjs open|reap|check`, so the policy has exactly one implementation."
//
// **A REFUSAL EXITS 2**, which is the number the front door counts as NOT GREEN — so a guard that refuses can never be
// mistaken for a court that passed.
export const GUARD_REFUSAL_EXIT = 2;

/** Run one subcommand. Returns the exit code, and NEVER throws: a guard that dies is a guard nobody wires in. */
export function guardMain(argv = process.argv.slice(2), { out = (line) => process.stdout.write(`${line}\n`), err = (line) => process.stderr.write(`${line}\n`) } = {}) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    if (!rest[i].startsWith('--')) continue;
    flags[rest[i].slice(2)] = rest[i + 1] !== undefined && !rest[i + 1].startsWith('--') ? rest[++i] : 'true';
  }
  try {
    if (command === 'open') {
      const scratch = openScratch({
        owner: flags.owner ?? basename(process.argv[1] ?? 'unknown'),
        label: flags.label ?? 'scratch',
        maxBytes: Number(flags['max-bytes'] ?? 0),
      });
      out(scratch.root);
      return 0;
    }
    if (command === 'reap') {
      const base = flags.base ?? scratchBase();
      ensureScratchBase(base);
      const { removed, skipped } = reapScratchBase({ base });
      out(JSON.stringify({ base, removed, skipped }));
      return 0;
    }
    if (command === 'check') {
      const base = flags.base ?? scratchBase();
      ensureScratchBase(base);
      const { total, holders } = assertScratchBudget({ base, needBytes: Number(flags['need-bytes'] ?? 0), owner: flags.owner ?? 'check', label: flags.label ?? 'a check' });
      out(JSON.stringify({ base, chargedBytes: total, holders }));
      return 0;
    }
    err('usage: run-root.mjs open [--owner O] [--label L] [--max-bytes N] | reap [--base DIR] | check [--need-bytes N]');
    return 64;
  } catch (error) {
    err(error instanceof RunRootRefusal ? error.message : `aukora-disk-guard: ${String(error?.message ?? error)}`);
    return error instanceof RunRootRefusal ? GUARD_REFUSAL_EXIT : 1;
  }
}

// Run as a program, but never when imported — a court imports this module and must not have it act.
if (process.argv[1] !== undefined && realpathOr(process.argv[1]) === realpathOr(new URL(import.meta.url).pathname)) {
  process.exitCode = guardMain();
}
