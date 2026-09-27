// A SCRATCH DIRECTORY THE DAEMON'S BOUNDARY WILL ACTUALLY ACCEPT.
//
// THE PROBLEM, AND IT BREAKS CI RATHER THAN A LAPTOP. The owner daemon refuses a run directory reached
// through a GROUP- OR OTHER-WRITABLE ANCESTOR (`aukora-owner:ancestor-writable`) — correctly, because a
// world-writable ancestor means anyone can swap the directory out from under a socket the owner trusts.
// `os.tmpdir()` IS `/tmp` ON UBUNTU CI, MODE 1777, SO EVERY COURT THAT BUILDS ITS SCRATCH UNDER `tmpdir()`
// INHERITS THAT ANCESTOR AND THE DAEMON REFUSES IT. On macOS `tmpdir()` is a per-user `/var/folders/...`
// directory and the problem is invisible, which is why these courts passed here and failed there.
//
// SEVEN COURTS, ONE CAUSE: owner-protocol, owner-detect, owner-phone, owner-admission-chain,
// owner-journal-kill, kira-owner-settle-join and kira-owner-ledger-binding.
//
// THE RULE IS NOT REIMPLEMENTED HERE. The ancestor question is asked with THE BOUNDARY MODULE'S OWN
// `assertTrustedAncestors`, so a court and the daemon cannot come to different conclusions about the same
// directory. A COURT THAT DECIDES FOR ITSELF WHAT THE BOUNDARY ALLOWS IS TESTING ITS OWN OPINION.
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { openScratch } from '../../scripts/lib/run-root.mjs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { assertTrustedAncestors, systemHost } from '../../plugins/aukora-owner-daemon/lib/boundary.mjs'
import { scratchBase } from '../../scripts/lib/run-root.mjs'

/** The base used when `tmpdir()` itself cannot be trusted: private to this user, and 0700. */
// SHORT, BECAUSE A UNIX SOCKET PATH IS LIMITED TO 104 BYTES ON macOS AND TWO RUNS OF THE SAME COURT
// TRUNCATE TO THE SAME PATH AND COLLIDE WITH EADDRINUSE. MEASURED:
//   ~/.cache/aukora-court-scratch/aukora-kill-XXXXXX/at-effect-started-restart/run/approve/approve.sock
// is about 129 bytes, so a court that RESTARTS its daemon could not rebind its own socket. The socket is
// the daemon s only door, so the court reported a daemon that never opened one.
// `acs` RATHER THAN A DESCRIPTIVE NAME: every byte here is spent by a path the kernel must fit.
export const FALLBACK_BASE = join(systemHost.home ?? process.env.HOME ?? tmpdir(), '.cache', 'acs')

/** The kernel limit this base must leave room under: `sun_path` is 104 bytes, and two runs must differ. */
export const SUN_PATH_LIMIT = 104
/** The budget a court may spend BELOW the base: prefix, mkdtemp suffix, and its own run/approve/name.sock. */
export const SUN_PATH_BUDGET = 60

/**
 * **A SOCKET PATH THAT FITS, WHATEVER `$TMPDIR` IS (report §3.2 item 11).**
 *
 * MEASURED: with `TMPDIR` of 65 bytes, `aukora-shell-signer` goes red with `signer-socket-unusable` — because a
 * unix socket path is capped by the kernel at 104 bytes (`sun_path`) and the court was building it as
 * `join(tmpdir(), …, 'aumlok-signer.sock')`. **The court was green or red according to an environment variable
 * nobody was testing**, and a contributor with a long `$TMPDIR` would have concluded the signer was broken.
 *
 * **SO THE SOCKET DOES NOT LIVE UNDER `$TMPDIR`.** It lives under the guard's own short base —
 * `/private/tmp/aukora-scratch-$UID` — which `scripts/lib/run-root.mjs` already keeps for exactly this reason:
 * *the disk guard needed the same 104 bytes, and a second implementation of "a short base" is a second thing that
 * can disagree with the first about how short.* The name is short and per-process, so two runs cannot collide.
 *
 * @param {string} label a few characters naming the socket, so a failure says which court's it was.
 * @returns {string} an absolute socket path that fits under `SUN_PATH_LIMIT`.
 */
export function shortSocketPath(label = 'sock') {
  const base = scratchBase()
  mkdirSync(base, { recursive: true, mode: 0o700 })
  const name = `${String(label).replace(/[^a-z0-9]/giu, '').slice(0, 6).toLowerCase()}-${String(process.pid)}-${randomBytes(4).toString('hex')}.sock`
  const full = join(base, name)
  // **REFUSED BY NAME RATHER THAN TRUNCATED.** A path silently shortened to fit is a path some other run may
  // also choose, and the failure that follows is two courts sharing one socket.
  if (Buffer.byteLength(full, 'utf8') >= SUN_PATH_LIMIT) {
    throw new Error(`shortSocketPath produced ${String(Buffer.byteLength(full, 'utf8'))} bytes, over the `
      + `${String(SUN_PATH_LIMIT)}-byte sun_path limit: ${full}`)
  }
  return full
}

/** Refuse a base by name when it cannot carry a socket path; a truncated path is an EADDRINUSE, not a hint. */
/** True when a base leaves room for a socket path beneath it. Silent, so a caller can skip and try another. */
export function baseFitsSockets(base) {
  return Buffer.byteLength(base, 'utf8') + SUN_PATH_BUDGET < SUN_PATH_LIMIT
}

export function assertBaseFitsSockets(base) {
  const spent = Buffer.byteLength(base, 'utf8') + SUN_PATH_BUDGET
  if (spent >= SUN_PATH_LIMIT) {
    throw new Error(`court-scratch:base-too-long: ${base} is ${String(Buffer.byteLength(base, 'utf8'))} bytes `
      + `and a court spends about ${String(SUN_PATH_BUDGET)} more below it, so a socket path would reach `
      + `${String(spent)} against the kernel's ${String(SUN_PATH_LIMIT)}. Two runs would truncate to the `
      + 'same path and the restart would fail EADDRINUSE. Shorten the base.')
  }
  return base
}

/** Can the daemon accept a run directory under this base? Asked with the boundary's own rule. */
export function baseIsTrustable(base) {
  return baseTrustRefusal(base) === null
}

/**
 * WHY A BASE WAS REFUSED, OR `null` WHEN IT WAS NOT — and this exists because the reason was being discarded.
 *
 * **MEASURED, FROM A LINUX FRONT-DOOR LOG: 32 COURTS DIED WITH THE SAME SENTENCE AND NOT ONE OF THEM SAID WHY.**
 *
 *     Error: no scratch base the daemon boundary accepts; tried
 *            /home/runner/.court-tmp, /home/runner/work/_temp, /home/runner/.cache/acs
 *
 * **`baseIsTrustable` CAUGHT THE BOUNDARY'S NAMED REFUSAL AND RETURNED `false`**, so `courtScratch` skipped the
 * candidate and the final throw could only list what it had TRIED. **The boundary names its refusals —
 * `ACL_UNREADABLE`, a world-writable ancestor, a platform with no ACL reader — and every one of those names was
 * being thrown away one frame above the error that needed it.**
 *
 * **A FAILURE THAT CANNOT NAME ITS SUBJECT CANNOT BE FIXED**, which is the same lesson as the reaper that
 * reported a count of orphans instead of their command lines. **The diagnosis was available the whole time; it
 * was discarded at the catch.**
 *
 * @param {string} base
 * @returns {string|null} the refusal, or null when the base is accepted.
 */
export function baseTrustRefusal(base) {
  try {
    mkdirSync(base, { recursive: true, mode: 0o700 })
    // A CHILD PATH, because the assertion checks ANCESTORS: asking about the base itself would check the
    // base's parents and skip the base.
    assertTrustedAncestors(join(base, 'probe'), systemHost)
    return null
  } catch (error) {
    // **THE NAME AND THE MESSAGE, NOT JUST THE MESSAGE.** The boundary refuses by name (`ACL_UNREADABLE`), and a
    // reader needs the name to search for it; the prose says which path and why.
    const name = error?.reason ?? error?.code ?? error?.name ?? 'refused'
    const message = String(error?.message ?? error)
    // **THE NAME IS NOT REPEATED WHEN THE MESSAGE ALREADY OPENS WITH IT.** MEASURED: the boundary's refusals
    // are thrown as `aukora-owner:ancestor-writable: aukora-owner:ancestor-writable: /tmp/x is an ancestor …`,
    // because `reason` and `message` both carry the name — and a doubled name in a diagnostic reads like a
    // bug in the diagnostic rather than a fact about the base.
    return message.startsWith(String(name)) ? message : `${String(name)}: ${message}`
  }
}

/**
 * A scratch directory the daemon's boundary accepts, created with `mkdtemp` under a trustable base.
 *
 * PREFERS `tmpdir()`, so the ordinary case is unchanged and nothing is left behind on a developer's machine.
 * Falls back to a 0700 base under HOME, which is created once and removed by `removeCourtScratch` — and
 * THAT IS WHY THE FALLBACK IS A NAMED BASE RATHER THAN ANOTHER mkdtemp: a court that crashed still leaves
 * its directory in a known place that the next run cleans, instead of filling a world-writable /tmp.
 */
// *** A 0700 DIRECTORY INSIDE /tmp IS STILL REFUSED, AND THAT IS THE WHOLE POINT. *** The rule walks EVERY
// ancestor, so `mkdtemp(join(tmpdir(), ...))` inherits the 777 parent and fails no matter what mode the new
// directory gets. There is no way to make a scratch directory under a world-writable /tmp acceptable, which
// is why the fallback exists rather than a chmod.
//
// **CORRECTED, BECAUSE IT WAS TRUE WHEN WRITTEN AND IS NOT TRUE NOW.** This block said the HOME fallback is
// ALSO refused on this Mac — the owner's home directory carries a write ACL
// (`aukor-owner:ancestor-acl-grants-write`) — and therefore that **the `/private/tmp` case CANNOT BE VERIFIED
// ON THIS MACHINE**.
//
// MEASURED, TWICE, WHILE MIGRATING THE THREE BOUNDARY COURTS: the fallback IS trustable. Under
// `TMPDIR=/private/tmp`, `courtScratch` returns `~/.cache/acs/<prefix>-XXXXXX`, and `owner-admission`,
// `owner-boundary-measure` and `owner-boundary` all pass there — **and the same three exit 2 through
// `courtScratchOrNotMeasured` when `HOME` is poisoned too, which is the path that proves the base really was
// being chosen rather than the courts quietly finding another one.**
//
// **AND LEAVING THE STALE VERSION WOULD HAVE BEEN WORSE THAN A WRONG COMMENT: it is a standing excuse to make
// an unverified claim later.** "This cannot be checked here" is exactly what a reader reaches for when a
// migration was not checked, and it would have been quoted rather than tested.
/**
 * THE BASES, IN THE ORDER THEY ARE TRIED — exported so the ORDER is a tested fact rather than a comment.
 *
 * `tmpdir()` first, because on a developer's machine it is the right answer and it is the caller's own choice.
 * `$RUNNER_TEMP` SECOND, because on the Ubuntu CI runner `tmpdir()` is `/tmp` (1777, refused by the daemon boundary)
 * and the HOME fallback was refused there too, so BOTH candidates failed and a court died with "no scratch base the
 * daemon boundary accepts; tried /tmp, /home/runner/.cache/acs" — measured in CI. The runner's own tree is a
 * directory it owns and does not share, which is what the boundary asks for. The HOME fallback stays LAST.
 */
export const scratchCandidates = () => [
  tmpdir(),
  ...(process.env.RUNNER_TEMP ? [process.env.RUNNER_TEMP] : []),
  FALLBACK_BASE,
]

export function courtScratch(prefix = 'aukora-court-') {
  // THE RUNNER'S OWN TREE IS TRIED BEFORE THE HOME FALLBACK. On the Ubuntu CI runner `tmpdir()` is /tmp (1777, and
  // the daemon boundary refuses a world-writable ancestor) and something on the `~/.cache/acs` path is refused too,
  // so BOTH candidates failed and the court died with "no scratch base the daemon boundary accepts; tried /tmp,
  // /home/runner/.cache/acs" — measured in CI, not hypothesised. `$RUNNER_TEMP` is a directory the runner itself
  // owns and does not share, which is exactly what the boundary asks for. It stays SECOND: a developer's own TMPDIR
  // remains the first choice when it is usable.
  const candidates = scratchCandidates()
  const refusals = []
  for (const base of candidates) {
    // *** THE LENGTH GUARD APPLIES TO `tmpdir()` TOO, AND IT DID NOT, WHICH IS THE BUG. *** I reasoned that
    // `tmpdir()` "is not ours to shorten" and left it unchecked — TRUE, AND NOT A REASON TO USE IT. On this
    // machine `tmpdir()` is 48 bytes and most courts spend far less than the budget beneath it, SO THE
    // ORDINARY CASE PASSED AND THE DEFECT STAYED HIDDEN. Under a TMPDIR that is itself long — a nested
    // sentinel, `mktemp -d` inside `mktemp -d`, anything a harness hands a court — the same 48 becomes 75 or
    // more, a signer socket reaches about 114 bytes, AND macOS SILENTLY TRUNCATES AT 104.
    //
    // AND THE TRUNCATION IS THE DANGEROUS PART: `server.address()` REPORTS THE PATH IT WAS GIVEN, NOT THE
    // ONE THE KERNEL KEPT, SO THE DAEMON BELIEVES IT BOUND A SOCKET THAT TWO DIFFERENT LONG PATHS CAN SHARE.
    // The file is the only witness, which is why the court below checks it with `lstat`.
    //
    // SO A BASE THAT CANNOT CARRY A SOCKET IS SKIPPED RATHER THAN USED, and the short fallback is chosen
    // instead. WE STILL DO NOT SHORTEN `tmpdir()` — we decline it, which is the part that was always ours.
    // **EVERY REFUSAL IS RECORDED.** A candidate skipped in silence is a candidate nobody can account for, and
    // the throw below is the only thing a reader ever sees.
    if (!baseFitsSockets(base)) { refusals.push(`${base} (too long to carry a unix socket)`); continue }
    // ── **A BASE THE PROJECT OWNS IS CREATED IF IT IS ABSENT (steps 486-487, MEASURED ON LINUX)** ─────────────
    //
    // MEASURED on the Ubuntu runner: `~/.cache/acs` had **never existed**, so `mkdtempSync(join(base, prefix))`
    // threw `ENOENT: … mkdtemp` — and the court died with *"no scratch base the daemon boundary accepts; tried
    // /tmp, /home/runner/.court-tmp, /home/runner/.cache/acs"* before a single arm ran. On this Mac the same
    // court passed, because earlier work of mine happened to have left the directory behind: **a court whose
    // colour depends on who ran what first is measuring the machine.**
    //
    // **ONLY `FALLBACK_BASE` IS CREATED, AND ONLY IT.** `tmpdir()` and `$RUNNER_TEMP` are not this project's to
    // create — *a helper that makes directories wherever it is pointed is a helper that writes outside its lane* —
    // whereas `~/.cache/acs` is this project's own name for its own scratch, and creating it is what the fallback
    // was always for.
    //
    // **AND THE BOUNDARY IS RE-CHECKED AFTERWARDS, WHICH IS WHAT MAKES THIS SAFE:** creating a leaf directory
    // cannot make an untrusted or world-writable ANCESTOR trusted, so a base refused for its ancestors is still
    // refused below. *The order is create-then-judge, never judge-then-assume.*
    if (resolve(base) === resolve(FALLBACK_BASE) && !existsSync(base)) {
      try { mkdirSync(base, { recursive: true, mode: 0o700 }) } catch { /* judged below, where the refusal is named */ }
    }
    const untrusted = baseTrustRefusal(base)
    if (untrusted !== null) { refusals.push(`${base} (${untrusted})`); continue }
    // ── THE DISK GUARD OWNS THE SCRATCH; THIS HELPER KEEPS ITS OWN GUARDS (akui-21) ──────────────────────────
    // `openScratch` brings the MARKER a base-wide reaper can read after a SIGKILL, the BUDGET that refuses by name,
    // and a reaper that also collects UNMARKED roots an hour old. What it does NOT bring is this helper's own two
    // guards, which run BEFORE this line: a base too long to carry a unix socket is declined, and a base whose
    // ancestors are untrusted is refused. AUMLOK's `shortSocketPath` and the Linux base fix are untouched above.
    const scratch = openScratch({ owner: 'court-scratch', label: prefix.replace(/-+$/u, '') || 'court', base })
    const dir = scratch.root
    CREATED.add(resolve(dir))
    installReaper()
    chmodSync(dir, 0o700)
    return dir
  }
  throw new Error('no scratch base the daemon boundary accepts; tried '
    + `${candidates.join(', ')}\n  REFUSALS, one per candidate:\n    ${refusals.join('\n    ')}`
    + '\n  **THE REASON IS THE POINT:** if these all say ACL_UNREADABLE, the boundary cannot read POSIX ACLs on '
    + 'this host and NOTHING about the court is wrong — a failed read is not an absence of ACEs, so it refuses, '
    + 'correctly. Install the ACL tooling or pick a host that has it; do not relax the boundary.')
}

/**
 * THE REFUSAL, AND IT IS A REGISTRY RATHER THAN A LIST OF DANGEROUS PATHS.
 *
 * **THIS EXISTS BECAUSE I DELETED THE SYSTEM TEMP DIRECTORY.** An experimental arm set its base to
 * `tmpdir()` itself and then called `removeCourtScratch` on it, and `rmSync(tmpdir(), …)` was one line away
 * from taking out every other process's scratch on the machine. It happened to fail first, on a different
 * assertion, and I only noticed the shape of it afterwards. THE SAME CLASS CRASHED THE AUKORA BACKEND ON
 * 09-24, so AVOIDING IT IS NOT ENOUGH — the function must be UNABLE to do it.
 *
 * THE RULE IS NARROW ON PURPOSE: only a path THIS PROCESS created through `courtScratch` may be removed. A
 * deny-list of dangerous paths is a list somebody has to keep complete, and the one path nobody thought of is
 * the one that matters. A registry fails CLOSED: anything not in it is refused, INCLUDING paths that are
 * perfectly safe to remove.
 */
const CREATED = new Set()

/**
 * *** A REAPER, BECAUSE A COURT THAT FORGETS TO CLEAN UP IS THE NORMAL CASE AND NOT THE EXCEPTION. ***
 *
 * Naming a helper is not the same as calling it. `aukora-launch-gate-config` created three `adm-` directories
 * through `courtScratch` and never called `removeCourtScratch` at all — SO ROUTING ALONE WOULD HAVE CHANGED
 * NOTHING, and a court can always gain a new early return or a failing assertion that skips its cleanup.
 *
 * THIS REMOVES EVERYTHING STILL REGISTERED WHEN THE PROCESS ENDS, on the ordinary exit and on an uncaught
 * exception alike, SO A COURT THAT FORGETS STILL LEAVES NOTHING BEHIND. It cannot help a `SIGKILL`, and that
 * is stated rather than implied: `kira-join`, `kira-ledger-binding` and `aukora-kill` kill processes on
 * purpose, and a tree left by a killed court is a tree this reaper never sees.
 *
 * IT USES `removeCourtScratch`, SO A REAPED DIRECTORY PASSES THE SAME REGISTRY AND PROTECTED-PATH CHECKS AS A
 * NAMED ONE: the reaper cannot delete anything the explicit call would have refused.
 */
let reaperInstalled = false
function installReaper() {
  if (reaperInstalled) return
  reaperInstalled = true
  process.on('exit', () => {
    for (const dir of [...CREATED]) {
      try { removeCourtScratch(dir) } catch { /* a path already gone, or one the guard refuses */ }
    }
  })
}

/** Paths that must NEVER be removed, and every ancestor of them. Belt as well as braces. */
const NEVER = ['/', '/tmp', '/private/tmp', tmpdir(), systemHost.home ?? process.env.HOME ?? '']
  .filter(entry => typeof entry === 'string' && entry.length > 0)
  .map(entry => resolve(entry))

/**
 * Remove a directory `courtScratch` returned and registered.
 *
 * @param {string} dir
 * @returns {string} the path, for logging.
 * @throws {Error} `court-scratch:refused` when the directory was not created here, or is a protected path.
 */
/**
 * THE SAME, BUT A HOST THAT CAN OFFER NO ACCEPTED PARENT IS **NOT MEASURED** RATHER THAN FAILED.
 *
 * **`courtScratch` THROWS WHEN NO BASE IS TRUSTABLE, AND A THROW IS THE WRONG ANSWER.** It exits non-zero with
 * a stack trace, which every reader downstream — a person and CI alike — reads as **this court FAILED**. It did
 * not fail: **it did not run.** The distinction is the whole of Alpha's convention (`a021bc171`):
 *
 *   · **exit 0** means every arm ran and passed;
 *   · **exit 1** means an arm ran and failed;
 *   · **exit 2** means an arm did NOT RUN.
 *
 * **AND IT MUST NOT BE 0 EITHER.** CI SEES ONLY THE EXIT CODE, so "N/N green but M not measured" with exit 0
 * reads as FULL COVERAGE to every reader downstream — **a court reporting a clean sheet over arms that never
 * executed is the false assurance this repository's courts exist to refuse.** Exit 2 says the one thing that is
 * true: nothing here was measured.
 *
 * A host with no accepted parent is a real shape rather than a hypothetical: `/tmp` is mode 1777 on Ubuntu CI,
 * and a home directory carrying a write ACL is refused by the same rule. Both are environment facts, neither is
 * a defect in the daemon, and neither should be reported as one.
 *
 * @param {string} prefix
 * @param {string} what - what could not be measured, named for the reader.
 * @returns {string} the scratch directory, when there is one.
 */
export function courtScratchOrNotMeasured(prefix, what) {
  try {
    return courtScratch(prefix)
  } catch (cause) {
    process.stdout.write(`\nNOT RUN: no parent this host can offer would be accepted for ${what}\n`)
    process.stdout.write(`         ${String(cause?.message ?? cause).slice(0, 400)}\n`)
    process.stdout.write('Exit 2 means NOT RUN. It does not mean passed, and it does not mean failed.\n')
    process.exit(2)
  }
}

/** Remove a directory `courtScratch` returned, and the fallback base itself once it is empty. */
export function removeCourtScratch(dir) {
  if (typeof dir !== 'string' || dir.length === 0) {
    throw new Error('court-scratch:refused: nothing to remove')
  }
  const absolute = resolve(dir)
  // 1. A REGISTRY, SO ANYTHING UNKNOWN IS REFUSED. This is the check that would have caught me.
  if (!CREATED.has(absolute)) {
    throw new Error(`court-scratch:refused: ${absolute} was not created by courtScratch in this process, `
      + 'so this function will not remove it. Only a directory this process made may be removed.')
  }
  // 2. AND THE PROTECTED PATHS, SO EVEN A REGISTERED ENTRY CANNOT TAKE ONE OUT. Belt as well as braces: the
  // registry cannot be wrong about what it made, but it could be wrong about what is safe.
  for (const never of NEVER) {
    if (absolute === never || never.startsWith(`${absolute}/`)) {
      throw new Error(`court-scratch:refused: ${absolute} is ${never}, or an ancestor of it, and removing it `
        + 'would take out paths this process does not own')
    }
  }
  // 3. AND A DEPTH FLOOR — ONE COMPONENT IS THE ROOT AND NOTHING ELSE IS THAT SHALLOW.
  //
  // *** THIS WAS THREE AND IT BROKE SIX COURTS, WHICH IS WHY IT IS ONE. *** I set the floor at three
  // components to keep `removeCourtScratch` away from anything near the root, and it refuses `/x` — CORRECT —
  // but it ALSO REFUSES `/tmp/npub-a-MtA5Tf`, WHICH IS A LEGITIMATE SCRATCH DIRECTORY AND EXACTLY WHAT
  // `courtScratch` CREATES WHEN `tmpdir()` IS `/tmp`. MEASURED: under `env -i` with no TMPDIR, Node falls
  // back to `/tmp`, `baseFitsSockets('/tmp')` is TRUE at 4 bytes, and every court that reaps its own
  // directory then died with `court-scratch:refused: /tmp/npub-a-… is only 2 path component(s) deep`.
  //
  // AND THE FLOOR WAS NEVER THE GUARD ANYWAY: THE REGISTRY ALREADY REFUSES EVERYTHING THIS PROCESS DID NOT
  // CREATE, so a path near the root can only reach here if `courtScratch` made it — and to make it,
  // `courtScratch` had to pass the protected-path check above. THE FLOOR WAS BELT-AND-BRACES THAT ONLY EVER
  // FIRED ON OUR OWN DIRECTORIES. One component is the honest floor: it refuses `/` and nothing legitimate.
  const depth = absolute.split('/').filter(part => part.length > 0).length
  if (depth < 1) {
    throw new Error(`court-scratch:refused: ${absolute} has no path components, so it is the root or empty. `
      + 'Refusing rather than deleting something near the root.')
  }
  rmSync(absolute, { recursive: true, force: true })
  CREATED.delete(absolute)
  return absolute
}
