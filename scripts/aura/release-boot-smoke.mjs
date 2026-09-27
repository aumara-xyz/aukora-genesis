#!/usr/bin/env node
/**
 * release-boot-smoke.mjs — START THE RELEASE AND SEE WHETHER IT LIVES.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────────────────────────
 *
 * The closure court proves every specifier RESOLVES. This proves the process actually STARTS — because
 * resolution is static and a release can resolve everything it names and still die on the way up. The
 * outage this pair exists for was `ERR_MODULE_NOT_FOUND` at boot: the closure court names it by line, and
 * this one proves the consequence.
 *
 * ── THE FOUR RULES, EACH OF WHICH IS A WAY TO HURT PETER ─────────────────────────────────────────
 *
 * 1. **A THROWAWAY STATE ROOT.** `--state-root` is a fresh scratch directory. `~/Library/Application
 *    Support/AUKORA` IS NEVER TOUCHED — not read, not written. (The existing `dry-boot-release.sh` reads
 *    the live state directory for its launch record; this smoke takes NO fact from Peter's world.)
 * 2. **A FREE LOOPBACK PORT, AND NEVER 3187 OR 50093.** Those two are the live app's and the rehearsal's;
 *    binding either would fight a running process for the port Peter's app is on. `3187` is also
 *    `launch-dsh.py`'s DEFAULT, so it is passed explicitly and never left to default.
 * 3. **STOP ONLY THE PID THIS SCRIPT SPAWNED, READ FROM ITS OWN CHILD HANDLE.** Not `lsof` by port: a
 *    pid looked up by port is whatever holds the port when the lookup runs, which — if this smoke failed
 *    to start — is SOMEBODY ELSE'S PROCESS. The child handle is the only pid this script can prove it
 *    created.
 * 4. **THE URL IS WAITED FOR, NOT ASSUMED.** A process that is alive is not a process that is serving.
 *
 * EXIT: 0 the release booted and answered · 1 it did not, with the reason · 2 bad usage.
 */
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, chmodSync, mkdtempSync, rmSync, writeFileSync, readFileSync, appendFileSync, cpSync } from 'node:fs'
import { createRunRoot } from '../lib/run-root.mjs'
import { tmpdir } from 'node:os'
import { basename, join, resolve as resolvePath } from 'node:path'
// THE REPOINT IS THE DESKTOP'S, NOT A SECOND COPY OF IT (alpha-30; alpha-31). `prepare` copies each overlay into
// scratch and rewrites every row resolving under the LIVE release to the same relative path under the candidate;
// alpha-30 exported that rule as a pure function precisely so the smoke could compose what the desktop composes.
import { repointOverlayText } from '../aukora/desktop-cutover.mjs'
import { isMainModule } from '../lib/is-main.mjs'

/** The two ports this smoke must never take: the live app's and the rehearsal's. */
export const FORBIDDEN_PORTS = Object.freeze([3187, 50093])

/** How long to wait for the URL before calling it a failure. */
export const BOOT_TIMEOUT_MS = Number(process.env.AUKORA_SMOKE_GRACE_MS ?? 60_000) || 60_000

/**
 * Every process whose ARGV names `stateRoot`, waited for until there are none or the clock runs out.
 *
 * ── WHY ARGV AND NOT THE HANDLE ─────────────────────────────────────────────────────────────────
 *
 * The backend RE-PARENTS TO PID 1 when the launcher exits, so it is not the pid this script spawned and
 * no handle in this process points at it. **The one thing it cannot change is the state root it was told
 * to use**, so that string is the only reliable way to find it.
 *
 * `ps` IS READ-ONLY HERE AND IS NOT HOW ANYTHING IS KILLED. This smoke still stops ONLY what it spawned,
 * by group; nothing in it looks up a pid and signals it, so **a smoke that failed to start cannot kill
 * the app Peter is using.** The scan is a CHECK on the kill, not a substitute for it.
 */
async function waitForNoProcessNaming(stateRoot) {
  const deadline = Date.now() + ORPHAN_GRACE_MS
  let found = []
  do {
    found = processesNaming(stateRoot)
    if (found.length === 0) return []
    await new Promise(settle => setTimeout(settle, 200))
  } while (Date.now() < deadline)
  return found
}

/**
 * The processes whose ENVIRONMENT names `needle`, as `ps` lines.
 *
 * ── WHY THE ENVIRONMENT AND NOT argv, WHICH IS THE BUG FABLE MEASURED ───────────────────────────
 *
 * MY FIRST VERSION SCANNED `ps -Ao pid=,ppid=,args=` AND FOUND NOTHING WHILE THE BACKEND WAS RUNNING.
 * Fable, twice: the smoke printed `stopped pid 52271 … removed aura-boot-HEBJXJ` while **pid 52348
 * (PPID 1, `DSH_HOME=…/aura-boot-HEBJXJ/home`) kept running**; on a second release, stopped 29398 and
 * leaked 29418.
 *
 * **THE STATE ROOT IS IN THE ENVIRONMENT. IT NEED NOT APPEAR IN argv AT ALL** — so a command-line grep
 * looks in the one place the evidence is not, and **reports a leak as clean.** *A check that cannot see
 * the thing it is checking for is worse than no check: it converts an unknown into a green.*
 *
 * `ps -E` prints the environment on macOS. It is the only portable way to read another process's env
 * without `/proc`, which macOS does not have.
 */
function processesNaming(needle) {
  // ── THE MATCH IS `DSH_HOME=<path>`, AND THAT PRECISION IS A SAFETY PROPERTY, NOT A NICETY ────────
  // A BARE SUBSTRING MATCH WOULD KILL INNOCENT PROCESSES: measured on this host, `ps -E` also matched
  // **my own `grep -F aura-boot-` command line**, because the pattern itself appears in the argv of the
  // grep looking for it. **A REAPER THAT MATCHES COMMAND LINES IS A REAPER THAT CAN KILL A PERSON'S
  // SEARCH** — and `grep aura-boot` is exactly what somebody investigating this leak would type.
  //
  // `DSH_HOME=` + the full path appears in the ENVIRONMENT of the backend and in nobody's command line.
  const marker = `DSH_HOME=${needle}`
  try {
    const out = execFileSync('ps', ['-E', '-Ao', 'pid=,ppid=,args='], { encoding: 'utf8' })
    return out.split('\n').filter(line => line.includes(marker) && !line.includes('ps -E'))
  } catch {
    // A HOST WITHOUT `ps -E` HAS NOT PROVED THERE IS NO LEAK. Say so rather than reporting clean, and
    // fall back to argv so the check is weaker rather than absent.
    try {
      const out = execFileSync('ps', ['-Ao', 'pid=,ppid=,args='], { encoding: 'utf8' })
      const hits = out.split('\n').filter(line => line.includes(marker) && !line.includes('ps -Ao'))
      if (hits.length > 0) return hits
      return [`(could not read the environment of other processes: ps -E unavailable — argv found `
        + `nothing, which is UNVERIFIED, not clean)`]
    } catch {
      return [`(could not scan for processes with ${marker}: ps unavailable — UNVERIFIED, not clean)`]
    }
  }
}

/**
 * Kill everything whose environment names `stateRoot`, and return what was found.
 *
 * ── WHY THIS IS STILL "ONLY WHAT THIS SMOKE SPAWNED" ────────────────────────────────────────────
 *
 * The smoke's state root is `mkdtempSync`'d and unique to this run, so **a process with
 * `DSH_HOME=<that path>` in its environment can only be one this smoke started.** That is a stronger
 * guarantee than a process group, which the backend had already escaped: **Fable's survivor was at PPID
 * 1, so the group kill could not reach it, while its environment still said exactly whose it was.**
 *
 * AND IT KILLS RATHER THAN REPORTS. **A survivor found and left running IS the leak** — Fable had to
 * kill 52348 by hand, and a check whose output is a console line has closed nothing.
 */
function reapNaming(stateRoot) {
  const found = processesNaming(stateRoot)
  let killed = 0
  for (const line of found) {
    const pid = Number.parseInt(line.trim().split(/\s+/u)[0], 10)
    // NEVER SIGNAL OURSELVES OR PID 0/1: a scan can match this very process's own environment.
    if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) continue
    // ── AND ONLY A NODE PROCESS, WHICH IS WHAT THE BACKEND IS ───────────────────────────────────
    // MEASURED ON THIS HOST: searching for the marker also matched **the `grep` searching for it and
    // the `bash -c` around that grep**, because a person typing the pattern puts it in their own
    // command line. **A reaper that kills a person's search is a worse defect than the leak it
    // closes** — and `DSH_HOME=<path>` is exactly what somebody investigating this would type.
    //
    // The backend is node. Requiring that is precise, and it costs nothing: **the thing being reaped
    // has a known shape, so the matcher may demand it.**
    if (!/(?:^|\/)node(?:\s|$)/u.test(line)) continue
    try { process.kill(pid, 'SIGKILL'); killed += 1 } catch { /* it exited between the scan and here */ }
  }
  return { found, killed }
}

/** How long to wait for a killed group to actually disappear before calling it a leak. */
const ORPHAN_GRACE_MS = 10_000

/** How long to keep polling AFTER the launcher exits, because the launcher spawns and returns. */
// *** THE SMOKE MUST COMPOSE WHAT THE DESKTOP COMPOSES (aura-99). ***
// *`desktop-cutover.mjs:373-391` reads `<support>/config.json`'s `patch[]`, DROPS any stale composition patch
// wherever it sits, and places the release's own at [0]. This smoke passed ONLY the release's composition, so
// every candidate booted without the deployment overlays -- `auma-live.patch.yml` among them -- and the face
// answered 404 in every run.* *** FABLE'S CONTROL SETTLED IT: the LIVE known-good release 404s under this harness
// too, so the fault was here and never in a release. ***
// THE LIST IS READ, NEVER TYPED: a hand-written list would drift from the desktop the first time an overlay is
// added, and would prove a composition nobody launches.
const OVERLAY_REFUSAL = 'deployment-overlay-absent'

/**
 * reportPatchList — NAME EVERY PATCH THIS BOOT COMPOSES WITH, AND SAY IF THERE IS NO COMPOSITION AMONG THEM.
 *
 * MEASURED (alpha-31; AURA's aura-103): the explicit-`--patch` branch printed ONLY THE COUNT — "patch list (7), given
 * explicitly" — and none of the seven. A2's boot therefore passed seven OVERLAYS with the composition patch absent, its
 * server.log carried no plugin ledger and no [apps] rows, and the face 404'd. THE ARTEFACT COULD NOT SAY WHY, because
 * the list it composed with was never written down. Both branches report through here now, so the count is never the
 * only thing a reader gets, and a boot with no composition patch says so in the log rather than only in a 404.
 */
function reportPatchList(list, note) {
  console.log(`  patch list (${String(list.length)})${note}`);
  for (const entry of list) {
    const there = existsSync(entry) ? '' : '   *** MISSING ***';
    console.log(`    ${String(entry).split('/').pop()}${there}`);
  }
  // A COMPOSITION PATCH IS WHAT CARRIES THE FACE ROWS. Without one, plugins do not load and /app/aumalive.js 404s --
  // which is a legitimate BARE boot (AURA_SMOKE_NO_PATCH makes that explicit) but never a composed one.
  if (!list.some((entry) => String(entry).endsWith('/aukora-composition.patch.yml'))) {
    console.log('    *** NO COMPOSITION PATCH IN THIS LIST: no plugin rows will compose, so this boot cannot prove\n' +
      '        the face loads. Pass --support with the deployment config, or omit --patch so the release\'s own\n' +
      '        aukora-composition.patch.yml is added. ***');
  }
  return list;
}

/**
 * repointOverlays — THE SMOKE MUST COMPOSE WHAT THE DESKTOP COMPOSES (alpha-31; AURA's aura-103).
 *
 * MEASURED, AND IT IS THE FIRST DECIDING DIFFERENCE: the desktop runs `prepare` first, which copies each overlay into a
 * scratch file and rewrites every row that resolves under the LIVE release to the same relative path under the
 * candidate. THE SMOKE DID NO REPOINT AT ALL — it handed the launcher the ORIGINAL support overlays, whose rows still
 * name `$HOME/aukora-release-fbcc1f20a1cf/...`, and `launch-dsh.py` refused, correctly, with
 * `patch-not-release-local`. With the composition patch omitted it was worse in a quieter way: the boot succeeded as a
 * BARE harness, `server.log` carried no plugin ledger and no `[apps]` rows, and `/app/aumalive.js` 404'd.
 *
 * THE RULE ITSELF IS NOT REIMPLEMENTED HERE. It is `repointOverlayText`, exported from desktop-cutover.mjs in alpha-30
 * and guarded by its own court; this function only supplies the live roots (from the support's own `config.json`
 * declaration, exactly as `prepare` does) and writes the copies into a scratch directory.
 */
function repointOverlays(list, release, support) {
  const liveRoots = new Set();
  try {
    const config = JSON.parse(readFileSync(join(support, 'config.json'), 'utf8'));
    if (typeof config.release === 'string' && config.release !== release) liveRoots.add(config.release.replace(/\/+$/u, ''));
    for (const entry of Array.isArray(config.patch) ? config.patch : []) {
      if (typeof entry !== 'string') continue;
      const directory = entry.replace(/\/[^/]*$/u, '');
      if (directory !== '' && directory !== release) liveRoots.add(directory);
    }
  } catch { /* no readable config: nothing to derive, and the list is passed through unchanged */ }
  const out = [];
  let copies = 0;
  for (const entry of list) {
    const repointed = repointOverlayText(readFileSync(entry, 'utf8'), { candidate: release, liveRoots });
    if (repointed.missing.length > 0) throw new Error(`${OVERLAY_REFUSAL}: ${entry}:${repointed.missing[0]} does not exist in ${release}`);
    if (repointed.foreign.length > 0) throw new Error(`${OVERLAY_REFUSAL}: ${entry}:${repointed.foreign[0]} still resolves into another release`);
    if (!repointed.changed) { out.push(entry); continue; }
    const directory = mkdtempSync(join(tmpdir(), 'aukora-smoke-patch-'));
    const target = join(directory, basename(entry));
    writeFileSync(target, repointed.text, { mode: 0o600 });
    out.push(target);
    copies += 1;
  }
  if (copies > 0) console.log(`  repointed ${String(copies)} overlay(s) into scratch — the desktop's own rewrite, not the live files`);
  return out;
}

function compositionPatches(release, support) {
  const wanted = join(release, 'aukora-composition.patch.yml')
  const own = existsSync(wanted) ? [wanted] : []
  if (support === null) {
    if (own.length > 0) console.log('  patch list: release composition only — no --support given, so the\n' +
      '              deployment overlays the desktop passes are ABSENT from this boot')
    return own
  }
  const configPath = join(support, 'config.json')
  if (!existsSync(configPath)) {
    throw new Error(`${OVERLAY_REFUSAL}: ${configPath} does not exist, so the overlays the desktop launches ` +
      'with cannot be read. Pass --support pointing at the support root, or the boot proves nothing about ' +
      'the composition a person actually runs.')
  }
  const declared = JSON.parse(readFileSync(configPath, 'utf8')).patch
  if (!Array.isArray(declared)) {
    throw new Error(`${OVERLAY_REFUSAL}: ${configPath} has no patch[] array, so the desktop's own list cannot ` +
      'be read and this boot would compose something nobody launches.')
  }
  const others = declared.filter((entry) => !String(entry).endsWith('/aukora-composition.patch.yml'))
  const list = [...own, ...others]
  reportPatchList(list, ', in the order the desktop uses:')
  return repointOverlays(list, release, support)
}

// **A COMPOSED BOOT ANSWERS LATER THAN A BARE ONE, AND THIS WINDOW WAS SIZED FOR THE BARE ONE (alpha-31).**
// MEASURED on A2 with the repoint in place: the launcher exited 0 and printed its URL, the backend was spawned,
// server.log grew from 607 to 2549 bytes — and this grace expired at 20s, so the face arm reported "the face check did
// not run" rather than a verdict about the face. The launcher's own window is already 90s
// (`AUKORA_LAUNCH_STARTUP_TIMEOUT`, set at the spawn below); this is the wait AFTER it returns, and it can be raised
// without touching anything the launcher does.
export const LAUNCHER_EXIT_GRACE_MS = Number(process.env.AUKORA_SMOKE_GRACE_MS ?? 20_000) || 20_000

/**
 * A free port on loopback, never one of the forbidden two.
 *
 * `listen(0)` asks the kernel for one, so the number is free AT THE MOMENT IT IS CHOSEN — and the
 * forbidden list is checked AGAIN anyway, because a check that cannot fail is not a check and `0` could
 * one day be replaced by a range.
 */
export function freePort(forbidden = FORBIDDEN_PORTS) {
  return new Promise((settle, fail) => {
    const probe = createServer()
    probe.on('error', fail)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => {
        if (forbidden.includes(port)) fail(new Error(`picked a forbidden port: ${port}`))
        else settle(port)
      })
    })
  })
}

/** Poll a URL until it answers, or the deadline passes. */
/**
 * ASK THE SERVER WHETHER THE FACE WAS COMPOSED IN — the arm `BOOTED` could never be.
 *
 * **FABLE MEASURED THE GAP THIS CLOSES**: with no `--patch`, the live known-good release
 * `fbcc1f20a1cf` booted in scratch and served **NO face** — every `/app/<name>.js` was 404,
 * `/api/auma-live/minds` was not found, and the page bundle lacked `@aukora/face-layout`.
 * **A boot-log scan cannot see a did-not-activate from rows that were never composed**, so the
 * check has to ASK THE SERVER rather than read the log.
 *
 * TWO FACTS, BECAUSE ONE IS NOT ENOUGH: `/app/aumalive.js` must answer **200**, *and* the page
 * bundle must **name** `@aukora/face-layout`. *A 200 alone could be any file; the bundle naming the
 * layout is what says the face was composed in rather than merely served.*
 */
async function probeFace(url, cookie) {
  // ── A MISSING COOKIE IS NOT AN ABSENT FACE (alpha-34). ────────────────────────────────────────────────────────
  // **MEASURED, BY HAND, AGAINST B:** `GET /app/aumalive.js?token=T` with NO cookie answers **401**, while the SAME
  // PATH with the cookie obtained from the 303 answers **200** and the page names `@aukora/face-layout`. So the asset
  // CANNOT be fetched with the query token alone, and a null cookie makes this probe's 404 meaningless: it reports a
  // face failure that is really a failed token exchange. **A CHECK THAT CANNOT TELL "no cookie" FROM "no route" IS HOW
  // A 404 CAME TO STAND FOR A 401.** It refuses in its own words now, so the reader is sent to the exchange.
  if (cookie === null) {
    return { ok: false, why: 'no cookie was obtained from the token exchange, so the face request would be answered ' +
      '401 whatever the face does — this is NOT evidence that the face is absent. Read the exchange line above.' }
  }
  // *** THE TOKEN IS A URL PARAMETER, NOT A COOKIE. *** *`launch-dsh.py` prints
  // `http://127.0.0.1:<port>/?token=<token>`, and this function then built `new URL('/app/aumalive.js', url)`,
  // WHICH DROPS THE QUERY -- so the asset was requested without the token and answered 401.* **`dsh_token` was
  // this lane's own invention and occurs nowhere in the harness.** *The launcher's search string is carried onto
  // every probed URL, and the `cookie` header is kept for any caller that still passes one.*
  const headers = cookie ? { cookie } : {}
  // ── THE ASSET IS REQUESTED CLEAN, WITH THE COOKIE — NEVER WITH THE QUERY TOKEN *AND* THE COOKIE (alpha-34) ──────
  // **MEASURED, BY HAND, AGAINST B — three requests, three different answers:**
  //   /app/aumalive.js?token=T   with NO cookie   -> 401
  //   /app/aumalive.js           WITH the cookie  -> 200   <-- what a browser does, and what the live app does
  //   /app/aumalive.js?token=T   WITH the cookie  -> 404   <-- WHAT THIS PROBE DID, and the source of the 404
  // The token's job is to be EXCHANGED for a cookie, once, by the 303. Carrying it on the asset request as well changes
  // how that path is served, and this smoke spent three rounds reporting a face failure for a face that serves.
  const withQuery = (path) => new URL(path, url)
  try {
    const asset = await fetch(withQuery('/app/aumalive.js'), { headers })
    if (asset.status !== 200) {
      return { ok: false, why: `/app/aumalive.js answered ${String(asset.status)}, not 200 — the face did not compose` }
    }
    const page = await fetch(withQuery('/'), { headers })
    const body = await page.text()
    if (!body.includes('@aukora/face-layout')) {
      return { ok: false, why: `the page bundle does not name @aukora/face-layout (${String(body.length)} bytes read) — a 200 is not a composition` }
    }
    return { ok: true, why: '/app/aumalive.js 200 and the bundle names @aukora/face-layout' }
  } catch (error) {
    return { ok: false, why: `the face request threw: ${String(error?.message ?? error).slice(0, 90)}` }
  }
}

// *** THE TOKEN EXCHANGE IS A 303 THE CLIENT MUST NOT FOLLOW. *** *Measured from the release's own e2e and written
// down in `desktop-parity-boot.mjs`, which has done it correctly all along:* **the token in the URL is exchanged for
// a COOKIE, and the cookie is what the face accepts.** *A client that sends the token as a cookie named
// `dsh_token` is sending a name this harness has never heard of, and the face answers 401.*
async function exchangeTokenForCookie(url, token) {
  if (token === null) return null
  try {
    const base = String(url).replace(/\/+$/u, '')
    const res = await fetch(`${base}/?token=${encodeURIComponent(token)}`, { redirect: 'manual' })
    const setCookie = res.headers.get('set-cookie')
    // THE ONE LINE THAT WOULD HAVE SAVED THREE ROUNDS: which status, which token length, and whether a cookie came back.
    // `server.log` records the url with `token=<redacted>`, so a smoke that takes its token from THERE exchanges the
    // literal string and gets no cookie. The launcher's own stdout prints it in full. THIS LINE IS NOT A GUESS.
    console.log(`  exchange: ${String(res.status)} token=${String(token).length}ch cookie=${setCookie === null ? 'NONE' : 'yes'}`
      + `${token === '<redacted>' ? '  *** THE TOKEN IS THE REDACTED LITERAL — TAKE IT FROM THE LAUNCHER STDOUT ***' : ''}`)
    // *** THE 303 CARRIES NO COOKIE IS ITS OWN REFUSAL IN THE PARITY BOOT: "the 303 carried no cookie, so the
    // face would answer 401". *** *Here it returns null and the probe reports the 401 it causes.*
    return setCookie === null ? null : setCookie.split(';')[0]
  } catch (error) {
    // A SWALLOWED EXCEPTION LOOKED LIKE AN ABSENT CREDENTIAL (alpha-34 section F). Say what threw.
    console.log(`  exchange FAILED: ${String(error?.message ?? error).slice(0, 120)}`)
    return null
  }
}

async function waitForUrl(url, deadline, child) {
  // Set when the spawned process exits: the launcher may have spawned a child that is still coming up.
  let graceUntil = null
  let exitedAt = null
  while (Date.now() < deadline) {
    // THE LAUNCHER EXITS AND SOMETHING ELSE SERVES — MEASURED, AND MY FIRST VERSION GOT THIS WRONG.
    // `launch-dsh.py` prints `Spawned Genesis PID <n>` and **returns 0 while its child keeps running**,
    // so treating the parent's exit as fatal reported DID NOT BOOT for a release that was serving on the
    // port the whole time. **A daemonising launcher makes "the process I spawned has exited" a fact about
    // the LAUNCHER, not about the release.**
    //
    // So an exited child is not a verdict: it starts a GRACE WINDOW in which the URL is still polled, and
    // only if nothing answers within it does the exit become the reason.
    if (child.exitCode !== null || child.signalCode !== null) {
      if (graceUntil === null) {
        graceUntil = Date.now() + LAUNCHER_EXIT_GRACE_MS
        exitedAt = `code ${String(child.exitCode)}, signal ${String(child.signalCode)}`
      } else if (Date.now() > graceUntil) {
        return { ok: false, reason: `the launcher exited (${exitedAt}) and nothing answered on ${url} within ${LAUNCHER_EXIT_GRACE_MS} ms of it` }
      }
    }
    try {
      const answer = await fetch(url, { signal: AbortSignal.timeout(2000) })
      // ANY HTTP ANSWER IS A BOOT. A 401 is the door doing its job, not a failure to start.
      return { ok: true, status: answer.status }
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 400))
  }
  return { ok: false, reason: `nothing answered on ${url} within ${BOOT_TIMEOUT_MS} ms` }
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2)
  const releaseIndex = args.indexOf('--release')
  const repoIndex = args.indexOf('--repo')
  // ── `--log-out <path>`: THE CALLER ASKS FOR THE EVIDENCE AS A FILE ──────────────────────────────
  // **STDOUT IS THE DEFAULT AND IS ALWAYS EMITTED**; this flag is for a caller that wants the bytes to
  // survive this process. `desktop-cutover.mjs prepare` reads them out of `boot.out`, so the default is
  // what unblocks it — the flag exists so a later caller need not parse a prefix out of a stream.
  const supportIndex = args.indexOf('--support')
  const logOutIndex = args.indexOf('--log-out')
  const support = supportIndex === -1 ? null : args[supportIndex + 1]
  // *** AN EXPLICIT PATCH LIST WINS OVER THE SUPPORT CONFIG (aura-102). ***
  // *`prepare` REPOINTS the deployment overlays into a scratch directory and does not commit them back to the
  // support root, so passing `--support` alone hands this smoke the ORIGINAL, stale files -- which is why A2 kept
  // answering `patch-not-release-local` with alpha-30 on HEAD. `--patch` (repeatable) is how the repointed set is
  // named directly; the support config is then not consulted at all.*
  const explicitPatches = args.reduce((acc, a, i) =>
    (a === '--patch' && args[i + 1] !== undefined ? [...acc, args[i + 1]] : acc), [])
  const logOut = logOutIndex === -1 ? null : (args[logOutIndex + 1] ?? null)
  if (logOutIndex !== -1 && logOut === null) {
    console.error('release-boot-smoke: --log-out needs a path')
    process.exit(2)
  }
  const release = releaseIndex === -1 ? null : resolvePath(args[releaseIndex + 1])
  const repo = repoIndex === -1 ? process.cwd() : resolvePath(args[repoIndex + 1])
  // ── AN ENFORCED BOOT, WHEN ASKED FOR (2026-09-27) ──────────────────────────────────────────────
  // `--approved-record-sha <sha>` replaces `--allow-unapproved`, so the launcher ENFORCES the plugin set;
  // `--gate-state <dir>` copies that directory's files (a plugin-set approval and its pinned approver)
  // into the throwaway state root's gate-state before the launch. Without them this stays what it was:
  // a boot proof that approves nothing.
  const approvedIndex = args.indexOf('--approved-record-sha')
  const approvedRecordSha = approvedIndex === -1 ? null : (args[approvedIndex + 1] ?? null)
  const gateStateIndex = args.indexOf('--gate-state')
  const gateStateFrom = gateStateIndex === -1 ? null : resolvePath(args[gateStateIndex + 1])

  // ── THE VERIFIER'S SUBJECT MUST NOT MOVE BETWEEN THE CUT AND THE CHECK (aura-85, R620-R624) ──────────
  // *** `launch-dsh.py` resolves its verification root from ITS OWN PATH, so `genesis-check.mjs` copies the
  // covered files out of whichever checkout invoked it and compares them against the record found in the
  // RELEASE. *** *When `--repo` is the main checkout and the release was cut from an earlier sha, every file a
  // lane committed in between is either missing from the record or a different size than it attests* -- **which
  // produced two false refusals in this repository (`genesis-artifact-changed` for four files, then
  // `genesis-coverage-set-mismatch` for one) before the cause was found.** *** SO THE REQUIRED RELATION IS
  // STATED HERE AND ENFORCED, RATHER THAN ASSUMED: the checkout that supplies the bytes must be at the commit
  // the release's own record names. *** *Fails CLOSED, by name, and names the fix.*
  const releaseCommit = (() => {
    try {
      const raw = readFileSync(join(release, '.dsh-build/genesis-artifacts.json'), 'utf8')
      return JSON.parse(raw)?.producer?.genesisCommit ?? null
    } catch { return null }
  })()
  if (releaseCommit !== null) {
    let repoCommit = null
    try { repoCommit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } catch { repoCommit = null }
    if (repoCommit !== null && repoCommit !== releaseCommit) {
      console.error('release-boot-smoke: repo-not-at-release-commit: --repo ' + repo
        + ' is at ' + repoCommit.slice(0, 12) + ' but the release record names ' + releaseCommit.slice(0, 12) + '.')
      console.error('  genesis-check copies covered files out of --repo and compares them against the RELEASE record,')
      console.error('  so this would compare two revisions and refuse a release nobody damaged.')
      console.error('  pass --repo pointing at a checkout of ' + releaseCommit.slice(0, 12) + '.')
      process.exit(2)
    }
  }
  if (release === null || !existsSync(join(release, 'apps/cli/lib/bin.js'))) {
    console.error('usage: release-boot-smoke.mjs --release <dir> [--repo <dir>]')
    console.error(`  ${String(release)} does not look like a release (no apps/cli/lib/bin.js)`)
    process.exit(2)
  }

  // ── ONE MARKED RUN ROOT, FROM ALPHA'S run-root.mjs ─────────────────────────────────────────────
  // **THIS LINE WAS `mkdtempSync(join(tmpdir(), 'aura-boot-'))` AND IT LEAKED TWO BACKENDS THIS
  // MORNING** — *a bare mkdtemp has no marker, so a stale-run reaper cannot tell it from anyone else's
  // scratch, and nothing ties the directory to the processes it spawned.*
  // **The replace gives the root a `.aukora-run-root` marker (owner, pid, pgid, created, realpath) and
  // an `env()` that lets a reaper find this run's children by ENVIRONMENT even after they re-parent to
  // PID 1** — *which is exactly how the two backends survived.*
  const runRoot = createRunRoot({ owner: 'release-boot-smoke', prefix: 'aura-boot' })
  const stateRoot = runRoot.root
  // THE LAUNCHER PREFLIGHTS ITS OWN STATE ROOT, AND IT IS RIGHT TO. `launch-dsh.py` refuses with
  // `missing-private-state` unless `home`, `agents`, `workspace` and `logs` exist, and with
  // `state-permissions` unless the root is 0700 — MEASURED by running this smoke, which failed on exactly
  // that the first time. `mkdtempSync` already gives 0700, but the mode is SET rather than assumed:
  // **`chmod` is not masked by the umask, and this lane has already been bitten once by a mode that was
  // requested instead of established.**
  for (const name of ['home', 'agents', 'workspace', 'logs']) mkdirSync(join(stateRoot, name), { recursive: true })
  chmodSync(stateRoot, 0o700)
  if (gateStateFrom !== null) {
    cpSync(gateStateFrom, join(stateRoot, 'gate-state'), { recursive: true })
    console.log(`  gate-state copied from ${gateStateFrom}`)
  }
  let child = null
  let killed = null
  /** The `ps` lines that survived the kill, if any. */
  let leaked = []
  try {
    const port = await freePort()
    const url = `http://127.0.0.1:${port}/`
    console.log(`release-boot-smoke: release ${release}`)
    console.log(`  state root ${stateRoot} (throwaway, never Peter's)`)
    console.log(`  port ${port}${FORBIDDEN_PORTS.includes(port) ? ' — FORBIDDEN' : ' (free, and not 3187 or 50093)'}`)

    // THE CHILD HANDLE IS THE ONLY PID THIS SCRIPT CAN PROVE IT CREATED.
    // ── ITS OWN PROCESS GROUP, BECAUSE THE THING THAT LEAKED WAS NEVER THE HANDLE ────────────────
    // MEASURED: three node processes were left with PPID 1 and `aura-boot-*` homes after this smoke ran.
    // `launch-dsh.py` SPAWNS THE BACKEND AND RETURNS, so the process this script holds is a WRAPPER that
    // is already gone while the thing it started keeps running. **A handle can only ever address the
    // wrapper.** `detached: true` makes the child a GROUP LEADER, so the group has a name this script can
    // address even after the leader exits and its children re-parent to 1.
    // ── `-u`, BECAUSE A PIPED PYTHON BUFFER IS NOT READABLE WHILE THE CHILD LIVES ─────────────
    // *** MEASURED (R653): `python3 -c "print('x'); time.sleep(2)"` THROUGH A PIPE YIELDS NOTHING FOR TWO
    // SECONDS AND THE LINE ARRIVES ONLY AT EXIT; WITH `-u` IT ARRIVES AT ONCE. *** *And MEASURED (R658): this
    // exact spawn shape -- `spawn('python3', [...], { detached: true, stdio: ['ignore','pipe','pipe'] })` --
    // CAPTURES STDOUT PERFECTLY, so the pipe is not the problem and the buffering is.* **`launch-dsh.py` prints
    // the authenticated `dsh web: …?token=…` line once, early, and then keeps running** -- *so the buffer never
    // fills and never flushes while this smoke is reading.* *** THE PARITY BOOT READS THE SAME LINE FROM THE SAME
    // LAUNCHER AND SUCCEEDS, BECAUSE IT READS AFTER THE RUN. ***
    child = spawn('python3', [
      '-u',
      join(repo, 'scripts/launch-dsh.py'),
      '--release', release,
      '--state-root', stateRoot,
      '--port', String(port),
      // ── THE COMPOSITION PATCH, WITHOUT WHICH EVERY SMOKE BOOTED A BARE HARNESS ──────────────────
      // **FABLE MEASURED THIS**: `launch-dsh.py` adds composition patches ONLY from its `--patch`
      // arguments (line 391), and this smoke passed NONE. So every boot proved the BARE harness started
      // -- no face, Kira, Aumlok, board or CORE rows. *"BOOTED" never proved the composition loads, and a
      // boot-log scan cannot see a did-not-activate from rows that were never composed.*
      //
      // **PASSED ONLY WHEN THE RELEASE CARRIES ONE.** A release without a patch is a legitimate shape
      // (the harness alone), and demanding one would fail a healthy artefact -- *but the ABSENCE is
      // reported, so a bare boot can never again be mistaken for a composed one.*
      // `AURA_SMOKE_NO_PATCH` IS THE RED ARM'S LEVER: it reproduces the pre-fix behaviour exactly --
      // a bare boot -- so a court can require the face check to FAIL without it. **A check that has
      // never been seen to fail is a check nobody has tested.**
      ...(process.env.AURA_SMOKE_NO_PATCH === undefined
        ? (explicitPatches.length > 0
            ? (reportPatchList(explicitPatches, ', given explicitly — the support config is NOT consulted:'),
               explicitPatches.flatMap((entry) => ['--patch', entry]))
            : compositionPatches(release, support).flatMap((entry) => ['--patch', entry]))
        : []),
      // THE SMOKE IS NOT AN APPROVAL. These two say so explicitly rather than by omission: this run proves
      // the release BOOTS, and it is not a claim that anything was approved or gated.
      '--allow-ungated',
      ...(approvedRecordSha === null ? ['--allow-unapproved'] : ['--approved-record-sha', approvedRecordSha]),
      // THE RUN ROOT GOES INTO THE CHILD'S ENVIRONMENT, which is what makes `ps -E` able to find it
      // later *by name rather than by guesswork*.
      // **AND `process.env` IS MERGED IN, WHICH IS NOT OPTIONAL AND WAS A BUG I SHIPPED.** `env()`
      // returns `{...extra, AUKORA_RUN_ROOT: root}` -- *so called with NO argument it REPLACES the
      // child's entire environment with one variable.* **The launcher then has no `PATH`, and
      // `launch-dsh.py:35` runs `which node` and dies with `CalledProcessError`.** *MEASURED on
      // ~/aukora-release-b5fac836e479: "did not boot -- the launcher exited (code 1) ... Command
      // '['which', 'node']' returned non-zero exit status 1."* **A run-root binding must ADD a variable,
      // never subtract the world**, and the boot proof is the only thing that could have found this:
      // *every node court stayed green because they read the source, not the environment.*
    // *** REVERTED (R663). THE CWD IS THE RELEASE, AND `cwd: stateRoot` WAS A REGRESSION. *** *R661 reasoned that
    // `cwd: release` blows the launcher's 20s startup window -- the parity boot's comment measures an EMFILE cost for
    // watching a 77k-file cwd.* **The measurement refutes it:** with `cwd: stateRoot` the SAME smoke produced
    // `server.log 964 bytes` with NO `dsh web:` line at all, against 3885 bytes and a printed URL with `cwd: release`.
    // *** THE BACKEND STOPPED STARTING. THE 401 BECAME A 404 BECAUSE NOTHING WAS THERE TO AUTHENTICATE. ***
    // *A changed symptom is not a changed cause, and this lane called it progress before measuring what the change
    // was.* The release's cwd is required by whatever the backend does in it; the EMFILE cost the parity boot
    // measured is real and is NOT this arm's symptom.*
    // *** THE STARTUP WINDOW MUST OUTLAST THE CHILD'S STARTUP (R667). *** *`launch-dsh.py:413` reads
    // `AUKORA_LAUNCH_STARTUP_TIMEOUT` (default 20s), and `:485-486` prints the authenticated url **only `if url`** -- so a
    // child that starts more slowly than the window produces NO unredacted line at all, and this smoke's face arm then has
    // no token while `server.log` still ends up carrying the redacted one.* **R666 narrowed the arm to exactly this
    // question: the verification passed, the backend served, `server.log` had the redacted url, and the launcher's print
    // never happened.** *R660 and R661 were looking at the right symptom -- a child that starts too slowly -- and at the
    // wrong knob: the cwd does not set the window, this does.*
    ], { cwd: release, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
      env: runRoot.env({ ...process.env, AUKORA_LAUNCH_STARTUP_TIMEOUT: '90' }) })

    let faceOutcome = { ok: false, why: 'the face check did not run' }
  const log = []
    child.stdout.on('data', chunk => log.push(String(chunk)))
    child.stderr.on('data', chunk => log.push(String(chunk)))

    const outcome = await waitForUrl(url, Date.now() + BOOT_TIMEOUT_MS, child)
    if (outcome.ok) {
      console.log(`  BOOTED — ${url} answered ${outcome.status}`)
      // ── "BOOTED" IS NOT "COMPOSED", AND THIS IS THE ARM THAT SAYS SO ────────────────────────────
      // **FABLE MEASURED THE GAP**: with no `--patch`, the live known-good release `fbcc1f20a1cf`
      // booted in scratch and served NO face -- every `/app/<name>.js` was 404, `/api/auma-live/minds` was
      // not found, and the page bundle lacked `@aukora/face-layout`. **A boot-log scan cannot see a
      // did-not-activate from rows that were never composed**, so the check has to ASK THE SERVER.
      //
      // THE FACE IS THE PROOF: through the token cookie, `/app/aumalive.js` must answer 200 **and** the
      // page bundle must NAME `@aukora/face-layout`. *A 200 alone could be any file; the bundle naming
      // the layout is what says the face was composed in rather than merely served.*
      // ── THE TOKEN COMES FROM THE LAUNCHER'S OWN READY LINE, WHICH IS WHERE IT IS PRINTED ───────
      // **THIS LINE WAS `probeFace(url, token)` AND `token` WAS NEVER DEFINED** — measured: the composed
      // run BOOTED, stopped its pid, removed its scratch root, **and then threw
      // `ReferenceError: token is not defined`**, *so the boot worked and the face check never ran.*
      // *A name I wrote in a call and never bound* — the compile-time equivalent of the mutations that did
      // not apply, and `node --check` cannot see it because an undefined identifier is a runtime error.
      // The launcher prints `dsh web: http://127.0.0.1:<port>/?token=<token>`; the token is read from there.
      // ── THE TOKEN COMES FROM THE FILE THE LAUNCHER PUBLISHES (aura-88) ───────────────────────────
      // *** THIS READ THE CHILD'S STDOUT AND THEN `server.log`, AND BOTH ARE THE WRONG PLACE. *** *The log is
      // REDACTED BY DESIGN -- `launch-dsh.py` rewrites `?token=...` to `<redacted>` before it reaches disk -- so
      // the only place the real url ever existed was inside the launcher's memory. Measured three times with
      // identical arguments: the token arrived once and was absent twice, and the face arm reported
      // `the face did not compose`, a claim about the FACE made from a failure to AUTHENTICATE.*
      // **So the launcher now publishes `{url, token, pid, at}` to `<state>/launch-url.json` (mode 0600, atomic),
      // and this polls THAT.**
      // *** AND IT CHECKS THE PID. *** *A url file left by an earlier launch is a credential for a process that
      // is gone; accepting it would make this arm authenticate against the wrong child, so a record naming any
      // pid but this one is refused rather than used.*
      const faceToken = await (async () => {
        const urlFile = join(stateRoot, 'launch-url.json')
        const deadline = Date.now() + 120000
        while (Date.now() < deadline) {
          try {
            const record = JSON.parse(readFileSync(urlFile, 'utf8'))
            // *** THE RECORD NAMES THE BACKEND, NOT THE LAUNCHER -- AND MY FIRST VERSION COMPARED IT TO THE
            // LAUNCHER. *** *`_publish_url` writes `child.pid` from INSIDE `launch-dsh.py`, where `child` is the
            // process the launcher spawned; this script's own `child` is the LAUNCHER. Measured: the file carried
            // pid 63281 while the launcher announced `Spawned Genesis PID 63281` -- two different processes -- so a
            // perfectly good record was refused and the face arm reported that it had no credential.*
            // **So the pid the launcher ANNOUNCES is read from its own words, and a record naming EITHER process is
            // accepted.** *A record naming neither is still refused, which is the property the check exists for: a
            // launch-url.json left by an earlier run must never authenticate this one.*
            const backendPid = (() => {
              const announced = log.join('').match(/Spawned Genesis PID (\d+)/u)
              return announced === null ? null : Number(announced[1])
            })()
            const named = record !== null && typeof record === 'object' ? record.pid : null
            if ((named === child.pid || (backendPid !== null && named === backendPid))
                && typeof record.token === 'string' && record.token.length > 0) {
              return record.token
            }
          } catch { /* not written yet, or being replaced -- both are "ask again" */ }
          await new Promise((resolve) => { setTimeout(resolve, 250) })
        }
        return null
      })()
      const face = existsSync(join(release, 'aukora-composition.patch.yml'))
        // *** `probeFace` IS `async`, SO WITHOUT `await` THIS BOUND A PENDING PROMISE: `face.ok` AND `face.why`
        // WERE BOTH `undefined`, THE ARM PRINTED `FACE ABSENT — undefined` ON EVERY RUN, AND AFTER `f0f2b456`
        // MADE THE FACE VERDICT DECIDE THE EXIT CODE THAT FALSE VERDICT REFUSED EVERY RELEASE. *** *The face was
        // never checked; the await was never written.*
        // *** A MISSING CREDENTIAL IS NOT A VERDICT ABOUT THE FACE (aura-88). *** *Before this, a token that
        // never arrived collapsed into the same `FACE ABSENT` line as a face that genuinely did not compose, and
        // the receipt-reader could not tell them apart* -- **which is the defect that cost aura-85 its receipt.**
        // *So the absent case refuses BY NAME and never calls `probeFace` at all: probing without a credential can
        // only produce a 401, and reporting that as `the face did not compose` is a claim the run cannot support.*
        ? (faceToken === null
            ? { ok: false, why: 'launch-url-absent: the launcher published no launch-url.json naming its own pid '
                + 'within 120s, so this arm has NO CREDENTIAL and CANNOT JUDGE the face -- this is a refusal to '
                + 'authenticate, not evidence about the composition' }
            : await probeFace(url, await exchangeTokenForCookie(url, faceToken)))
        : { ok: false, why: 'this release carries no aukora-composition.patch.yml, so a bare boot is '
            + 'all that was asked for -- and it is NOT evidence that the composition loads' }
      faceOutcome = face
      console.log(`  ${face.ok ? 'FACE SERVES' : 'FACE ABSENT'} — ${face.why}`)
    } else {
      console.log(`  DID NOT BOOT — ${outcome.reason}`)
      // `text` IS STILL BOUND HERE because the arms below reason about the child's words — the module
      // error and the damaged-release markers. My first edit deleted this binding with the duplicated
      // print loop and the next line threw `ReferenceError: text is not defined`. **The emission block
      // below builds its OWN `logText`, so the two do not share a name and cannot drift.**
      const text = log.join('')
      // THE MODULE ERROR IS NAMED, because the whole point of this smoke is to reproduce that outage.
      const moduleError = /ERR_MODULE_NOT_FOUND|cannot find module|Cannot find package/iu.test(text)
      if (moduleError) console.log('  the failure is ERR_MODULE_NOT_FOUND — the release is not import-closed')
      // A DAMAGED RELEASE IS OFTEN REFUSED BEFORE IT EVER RUNS, AND THAT IS THE BETTER OUTCOME. An
      // attestation that catches a deleted plugin is doing its job; saying so is more useful than
      // reporting a generic failure and leaving a reader to wonder whether the module error was missed.
      if (/missing-artifact|release-verification-failed|record-coverage-set-mismatch/iu.test(text)) {
        console.log('  the failure is RELEASE VERIFICATION — the record caught the damage before boot, '
          + 'which is earlier and better than ERR_MODULE_NOT_FOUND')
      }
    }

  // ── THE FACE ARM: WITHOUT IT, "BOOTED" STILL MEANS NOTHING ────────────────────────────────────
  // **The red arm Fable asked for**: with `AURA_SMOKE_NO_PATCH` set this is FALSE and the smoke
  // exits non-zero. *Measured against the live known-good release `fbcc1f20a1cf`, which serves no
  // face when booted bare.*
  const faceOk = outcome.ok && faceOutcome.ok
  console.log(faceOk
    ? '  face: SERVED — the composition loaded'
    : `  face: ABSENT — ${faceOutcome.why}`)
  // *** THE LINE THAT USED TO STAND HERE SET `process.exitCode = 1` FOR AN ABSENT FACE, AND THE TWO LINES
  // BELOW IT THEN OVERWROTE IT WITH `0` WHENEVER THE BOOT SUCCEEDED. *** *MEASURED, in the prepare receipt this
  // lane has been reporting all evening:*
  //     face: ABSENT — the face check did not run
  //     === prepare exit: 0 ===
  // **AND THE COMMENT ABOVE THE FACE ARM CLAIMS THE OPPOSITE** -- *"with `AURA_SMOKE_NO_PATCH` set this is FALSE
  // and **the smoke exits non-zero**"* -- **so the arm Fable asked for was computed, printed, and discarded.**
  // *A boot whose composition did not load is not a boot that passed, whatever the boot itself did.*
  process.exitCode = (outcome.ok && faceOk) ? 0 : 1

    // ── THE EVIDENCE OUTLIVES THE RUN, ON BOTH EXITS AND BEFORE ANY CLEANUP ──────────────────────────
    // MEASURED BY ALPHA, AND THIS IS THE WHOLE ORDER: the smoke printed `BOOTED — …` while **a plugin that
    // failed to activate left its only record in an in-memory `log[]` that was printed ONLY on failure and
    // NEVER written anywhere** — and on success the scratch root it came from was deleted. **So a release
    // whose plugins did not activate was reported BOOTED and the evidence was thrown away**, which is the
    // exact opposite of what this smoke exists for.
    //
    // **THE RULE IS: THE LOG IS EMITTED ON EVERY EXIT PATH, BEFORE ANY CLEANUP.** Not on failure only — a
    // successful boot is precisely the case where "it booted" and "its plugins activated" differ, and the
    // difference is only visible in the log. **The `  log:` prefix is part of the contract**: it makes the
    // child's words unmistakable in the smoke's own output, so a reader (or `desktop-cutover.mjs prepare`)
    // can tell what the CHILD said from what the SMOKE said.
    const logText = log.join('')
    console.log(`  log: ${logText.split('\n').length} line(s) captured from the child`)
    for (const line of logText.split('\n')) console.log(`  log: ${line}`)
    if (logOut !== null) {
      try {
        writeFileSync(logOut, logText, { mode: 0o600 })
        console.log(`  log: written to ${logOut}`)
      } catch (error) {
        // A LOG THAT COULD NOT BE WRITTEN IS NAMED, NOT SWALLOWED. `--log-out` was asked for, so failing to
        // produce it is a refusal rather than a note — *the reader asked for the evidence and did not get it.*
        console.log(`  log: COULD NOT WRITE ${logOut} (${error?.code ?? 'error'})`)
        process.exitCode = 1
      }
    }
  // ── THE BACKEND'S OWN LOG IS A FILE, NOT STDOUT, AND IT WAS BEING DELETED ──────────────────────
  // **FABLE**: *"the empty smoke.log you refused on (boot-log-absent) is the same blindness, since
  // the backend's log is a file in the scratch root and never goes to stdout."* The launcher's
  // stdout is all this smoke ever captured, and `launch-dsh.py` spawns the backend and RETURNS — so
  // the rows that would say `aukora-board failed to import` are written to
  // `<stateRoot>/logs/server.log` and then removed by the `rmSync` below.
  //
  // **READ BEFORE THE CLEANUP, NOT AFTER**, and toward `--log-out` when one was given.
  const serverLog = join(stateRoot, 'logs', 'server.log')
  if (existsSync(serverLog)) {
    const text = readFileSync(serverLog, 'utf8')
    console.log(`  server.log ${String(text.length)} bytes`)
    for (const line of text.split(/\r?\n/u)) if (line !== '') console.log(`  slog: ${line}`)
    if (logOut !== null) {
      try { appendFileSync(logOut, text, { mode: 0o600 }) } catch { /* reported by the caller's own check */ }
    }
  } else {
    console.log('  server.log ABSENT — the backend never wrote one, which is itself a finding')
  }

  } finally {
    // STOP ONLY WHAT THIS SCRIPT SPAWNED. `child.kill` addresses the handle; nothing here looks up a pid
    // by port, so a smoke that failed to start CANNOT kill the app Peter is using.
    if (child !== null) {
      killed = child.pid
      // ── THE GROUP, NOT THE HANDLE ───────────────────────────────────────────────────────────────
      // A NEGATIVE PID IS THE WHOLE GROUP. `child.kill()` addresses the wrapper — the python launcher,
      // which has already exited — and leaves the node backend it started running forever. This is the
      // exact line that leaked.
      const signalGroup = (sig) => {
        try { process.kill(-child.pid, sig) } catch { /* the group is already gone */ }
        // AND THE HANDLE TOO, for the case where the group never formed (a spawn that failed before exec).
        try { child.kill(sig) } catch { /* gone */ }
      }
      signalGroup('SIGTERM')
      // AND WAIT FOR IT. `kill` returns when the signal is SENT, not when the process is gone.
      await new Promise(settle => {
        if (child.exitCode !== null || child.signalCode !== null) { settle(); return }
        const timer = setTimeout(() => { signalGroup('SIGKILL'); settle() }, 5000)
        child.once('exit', () => { clearTimeout(timer); settle() })
      })
    }
    // ── PROVE IT IS GONE BEFORE REMOVING THE HOME, AND FAIL IF IT IS NOT ─────────────────────────
    // **A SCRATCH HOME REMOVED UNDER A STILL-RUNNING PROCESS IS HOW A LEAK BECOMES INVISIBLE**: the
    // directory disappears and nothing points at the survivor, so the next person sees a green boot and
    // three orphans they cannot attribute. The check cannot be "did my child exit" — the backend
    // RE-PARENTS TO 1 — so it is **"does anything still name MY state root in its argv"**, which is the
    // only question that sees a process nobody holds a handle to.
    // ── REAP FIRST, THEN PROVE ──────────────────────────────────────────────────────────────────
    // The group kill above is the FAST path and it is kept, because it is cheap and correct when the
    // backend stays in the group. The sweep is the one that actually closes the leak Fable measured:
    // **a backend at PPID 1 is outside any group this script can name, but its ENVIRONMENT still says
    // which smoke it belongs to.**
    const reaped = reapNaming(stateRoot)
    if (reaped.killed > 0) {
      console.log(`  reaped ${String(reaped.killed)} process(es) whose environment named ${stateRoot}`
        + ' (the group kill could not reach them — they had re-parented)')
    }
    const survivors = await waitForNoProcessNaming(stateRoot)
    leaked = survivors
    if (survivors.length > 0) {
      process.exitCode = 1
      console.log(`  LEAK: ${String(survivors.length)} process(es) still name ${stateRoot} after the kill:`)
      for (const line of survivors) console.log(`    ${line}`)
      console.log('  (the smoke FAILS on a leak: a survivor holding a deleted home is a boot that did not'
        + ' stop, and reporting it as green is the defect this check exists for)')
    }

    // A SCRATCH DIRECTORY THAT WILL NOT DELETE MUST NOT FAIL THE SMOKE. The launcher writes into this
    // root, so `rmSync` can race a dying child and throw `ENOTEMPTY` — MEASURED. Cleanup is a courtesy;
    // the verdict is the boot. It retries briefly and then says so rather than throwing.
    try {
      // `dispose()` REAPS CHILDREN FIRST -- by process group AND by environment -- and only then
      // removes the root. *That order is the whole point: removing first races a dying child, which is
      // the ENOTEMPTY this try/catch was written for.*
      runRoot.dispose()
    } catch (error) {
      console.log(`  note: ${stateRoot} could not be removed (${error?.code ?? error}); it is scratch and safe to delete later`)
    }
    console.log(`  stopped pid ${String(killed)} (the one this smoke spawned) and removed ${stateRoot}`)
  }
}
