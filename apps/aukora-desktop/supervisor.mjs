// The shell's own launcher supervisor.
//
// WHY THIS FILE EXISTS. The harness mints one random launch token per process and
// writes it only to the private server log of the state root it was given. A shell
// that wants to show the app must therefore own that state root: it creates the
// directories at mode 0700, spawns the launcher against them, and reads the token
// out of a log no other party can read. The token never travels through a shared
// log, an argument list, an environment variable or the clipboard.
//
// WHAT THIS FILE WILL NOT DO. It never touches a state root it did not create, it
// never kills a listener it did not spawn, and it never edits a release. The only
// process it will stop is the pid it started in this session.
import { spawn, spawnSync } from 'node:child_process'
import { FOOTPRINT_LIMIT_BYTES, readFootprintBytes, restartDecision, restartLogLine } from './footprint-watch.mjs'
import { createServer } from 'node:net'
import { mkdir, chmod, stat, open, access, readFile, rm, writeFile, link } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

export const STATE_DIRS = ['home', 'agents', 'workspace', 'logs']
const TOKEN_URL = /http:\/\/127\.0\.0\.1:(\d+)\/\?token=[A-Za-z0-9_-]+/
const START_TIMEOUT_MS = 90_000
const POLL_MS = 250
/** How long a launch waits for a pinned port the last backend is still letting go of, and how
 *  long a quit waits for the child it signalled. Bounded on purpose: a wait with no ceiling
 *  turns one bad state into a hung window. */
export const PORT_WAIT_MS = 10_000
export const PORT_POLL_MS = 200
export const STOP_WAIT_MS = 8_000
export const STOP_POLL_MS = 100

/** A port the kernel just told us is free. Racy by nature, so the launcher's own
 *  bind is still the authority; this only avoids asking for a port already taken. */
export async function freePort() {
  return await new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

/**
 * Whether a port can be BOUND right now — asked by binding it, because that is the operation the
 * launcher is about to perform and the only one whose answer is the truth.
 *
 * WHY NOT A CONNECT. "Nothing answers on it" is not "I can bind it": a socket that is still being
 * closed refuses connections while it holds the bind, so a connect-based probe would report a busy
 * port as free and the launcher would meet the refusal this exists to prevent.
 * @param {number} port - the port to test.
 * @returns {Promise<boolean>} true when this process can listen on it.
 */
export async function portIsFree(port) {
  return await new Promise(resolve => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, '127.0.0.1', () => { probe.close(() => resolve(true)) })
  })
}

/**
 * Wait, bounded, for a port to become bindable.
 *
 * THE DEFECT THIS EXISTS FOR. AUKORA's port is pinned (`launchctl getenv AUKORA_DESKTOP_PORT`), so
 * the next launch cannot take another one. Twice, a quit-and-reopen put `port-unavailable: 50843`
 * in the window: the shell exited the moment it had SIGTERM'd its backend, and the reopening shell
 * asked for the pinned port while the previous backend was still letting go of it. Waiting is the
 * only honest answer — the alternative is asking for a different port, which is not the deployment
 * the owner configured.
 *
 * A refused launch is not a crash: the caller gets a named error after the ceiling, and the ceiling
 * is short enough that a person sees a slow start rather than a hang.
 * @param {number} port - the port that must be free.
 * @param {object} [o]
 * @param {number} [o.timeoutMs] how long to wait before refusing; 0 refuses on the first look.
 * @param {number} [o.pollMs] how often to look.
 * @param {(line: string) => void} [o.onWait] told once, when the port is not free on the first look.
 * @returns {Promise<{port: number, waitedMs: number}>} when the port is bindable.
 * @throws `port-unavailable` when it is still held at the ceiling.
 */
export async function waitForPortFree(port, o = {}) {
  const timeoutMs = o.timeoutMs ?? PORT_WAIT_MS
  const pollMs = o.pollMs ?? PORT_POLL_MS
  const started = Date.now()
  let announced = false
  for (;;) {
    if (await portIsFree(port)) return { port, waitedMs: Date.now() - started }
    if (!announced) {
      announced = true
      o.onWait?.(`port-wait: ${port} is still held; waiting up to ${timeoutMs} ms for the previous backend to let go of it`)
    }
    if (Date.now() - started >= timeoutMs) {
      throw new Error(
        `port-unavailable: ${port} is still held after ${Date.now() - started} ms. The port is pinned, so ` +
        'this launch cannot take another one. Another backend is probably still quitting; wait a moment ' +
        'and open AUKORA again, or find the listener with `lsof -tiTCP:' + port + ' -sTCP:LISTEN`.')
    }
    await new Promise(r => setTimeout(r, pollMs))
  }
}

/**
 * Sleep without spinning, on a thread that cannot await.
 *
 * `Atomics.wait` on a `SharedArrayBuffer` is the one sleep available to synchronous code here: a
 * busy loop would burn a core of the machine the person is trying to quit, and the quit path is
 * exactly where that is least acceptable.
 * @param {number} ms - milliseconds to block.
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * The launcher runs `which node`, and a GUI application inherits none of a login
 * shell's PATH — launched from the Dock it sees roughly /usr/bin:/bin:/usr/sbin:/sbin
 * and the launcher dies with a CalledProcessError before it does anything. So the
 * shell finds a node itself and hands the child a PATH that contains it. The first
 * existing candidate wins, and an explicit nodePath always beats discovery.
 */
export const NODE_CANDIDATES = [
  join(homedir(), '.local/bin/node'),
  '/opt/homebrew/bin/node',
  '/usr/local/bin/node',
  '/usr/bin/node',
]

export async function findNode(explicit) {
  const candidates = explicit ? [explicit, ...NODE_CANDIDATES] : NODE_CANDIDATES
  for (const candidate of candidates) {
    try { await access(candidate); return candidate } catch { /* next */ }
  }
  return null
}

/** A PATH the child can actually use: node's own directory first, then the basics. */
export function childPath(nodeBin, inherited) {
  const base = ['/usr/bin', '/bin', '/usr/sbin', '/sbin', '/usr/local/bin', '/opt/homebrew/bin']
  const parts = []
  if (nodeBin) parts.push(dirname(nodeBin))
  for (const part of (inherited ?? '').split(':')) if (part && !parts.includes(part)) parts.push(part)
  for (const part of base) if (!parts.includes(part)) parts.push(part)
  return parts.join(':')
}

/** Create the private state root. Mode 0700 on every level: the token lands inside.
 *
 *  A directory that ALREADY exists and is readable by anyone else is refused, not
 *  repaired. Widening happens for a reason — another tool, another user, a copy
 *  from elsewhere — and quietly narrowing it again would hide the only evidence
 *  that something else can read this shell's token. New directories we create
 *  ourselves, so those we simply create private. */
async function privateDir(path) {
  let existing = null
  try { existing = await stat(path) } catch (err) { if (err.code !== 'ENOENT') throw err }
  if (existing) {
    if (!existing.isDirectory()) throw new Error(`state-not-a-directory: ${path}`)
    if (existing.mode & 0o077) {
      throw new Error(`state-permissions: ${path} is readable by others; this shell will not widen or repair it`)
    }
    return
  }
  await mkdir(path, { recursive: true, mode: 0o700 })
  await chmod(path, 0o700)
}

export async function prepareStateRoot(root) {
  await privateDir(root)
  for (const name of STATE_DIRS) await privateDir(join(root, name))
  return root
}

/** Read the authenticated URL out of OUR log, from the offset the log had when we
 *  spawned. Reading from a remembered offset is what makes a re-launch into an
 *  existing state root safe: a stale URL from an earlier process can never win. */
async function readUrlAfter(logPath, fromOffset) {
  let handle
  try {
    handle = await open(logPath, 'r')
    const { size } = await handle.stat()
    if (size <= fromOffset) return null
    const buffer = Buffer.alloc(size - fromOffset)
    await handle.read(buffer, 0, buffer.length, fromOffset)
    const match = buffer.toString('utf8').match(TOKEN_URL)
    return match ? match[0] : null
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  } finally {
    await handle?.close()
  }
}

async function logSize(logPath) {
  try { return (await stat(logPath)).size } catch { return 0 }
}

/**
 * Start one harness process and return its authenticated URL.
 * @param {object} o
 * @param {string} o.checkout  a Genesis checkout at the release's own commit
 * @param {string} o.release   a materialized release directory
 * @param {string} o.stateRoot the private state root this shell owns
 * @param {number} [o.port]    a port to ask for; one is chosen when absent
 * @param {number} [o.portWaitMs] how long to wait for a PINNED port to be released (court knob)
 * @param {string[]} [o.patch] extra composition patch overlays
 * @param {string[]} [o.approvedRecordSha] approved artifact record digests
 * @param {boolean} [o.allowUnapproved] launch a release with no approved record
 * @param {(line: string) => void} [o.onDiagnostic]
 */
/**
 * CRASH RESILIENCE (Fable, 2026-09-26, measured): after the macOS login session crashed, the backend survived as
 * an ORPHAN at PPID 1 holding the state root, and the app then refused `state-root-in-use` until a human killed
 * it. This proves, before touching anything, that the occupant is THIS deployment's own orphan, and stops it
 * GRACEFULLY. It never signals a process it cannot prove is its own:
 *
 *   same RELEASE        the process's command line names this release directory
 *   same STATE ROOT     its DSH_HOME is this state root (or inside it)
 *   NO WINDOW OWNS IT   it is re-parented (PPID 1) and no caller-supplied window predicate claims it
 *
 * Every proof must hold. If any fails the process is LEFT ALONE and the caller keeps its refusal. If all hold it
 * is SIGTERMed and given `waitMs` to leave on its own; it is NEVER SIGKILLed here, because a graceful stop is the
 * offer and a process that ignores it is a human's decision, not this function's.
 *
 * @returns {Promise<{action: 'none'|'stopped'|'refused', pid?: number, reasons: string[], proofs?: object}>}
 */
export async function reapOrphanBackend({ release, stateRoot, pid, ps = defaultProcessReader, kill = process.kill.bind(process), log = () => {}, waitMs = 5000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), ownsWindow } = {}) {
  const occupant = pid !== undefined ? pid : await occupyingPid(stateRoot)
  if (occupant === null || occupant === undefined) return { action: 'none', reasons: ['no-occupant'] };
  const info = ps(occupant);
  if (info === null) return { action: 'refused', pid: occupant, reasons: ['process-not-readable'] };
  const proofs = {
    sameRelease: release !== undefined && info.command.includes(release),
    sameStateRoot: stateRoot !== undefined && info.dshHome !== null
      && (info.dshHome === stateRoot || info.dshHome.startsWith(`${stateRoot}/`)),
    noWindowOwnsIt: info.ppid === 1 && (ownsWindow === undefined || ownsWindow(occupant) === false),
  };
  const reasons = Object.entries(proofs).filter(([, held]) => !held).map(([name]) => name);
  if (reasons.length > 0) {
    log(`orphan-recovery: NOT stopping pid ${occupant} — it is not proven to be this deployment's orphan (${reasons.join(', ')})`);
    return { action: 'refused', pid: occupant, reasons, proofs };
  }
  log(`orphan-recovery: pid ${occupant} is this release's own orphan holding ${stateRoot} with no window; stopping it gracefully`);
  try { kill(occupant, 'SIGTERM'); } catch { return { action: 'stopped', pid: occupant, reasons: [], proofs }; }
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await sleep(100);
    try { kill(occupant, 0); } catch { log(`orphan-recovery: pid ${occupant} left after SIGTERM; the state root is free`); return { action: 'stopped', pid: occupant, reasons: [], proofs }; }
  }
  log(`orphan-recovery: pid ${occupant} IGNORED SIGTERM after ${String(waitMs)}ms and is LEFT ALONE (this function never force-kills)`);
  return { action: 'refused', pid: occupant, reasons: ['survived-sigterm'], proofs };
}

/** pid, ppid, DSH_HOME and command line for one process, from `ps -AE` (without -A the sweep finds nothing). */
export function defaultProcessReader(pid) {
  const r = spawnSync('/bin/ps', ['-AE', '-o', 'pid=,ppid=,command=', '-p', String(pid)], { encoding: 'utf8', timeout: 10000 });
  const line = (r.stdout ?? '').split('\n').find((l) => l.trim() !== '');
  if (line === undefined) return null;
  const ppid = Number(line.trim().split(/\s+/)[1]);
  const dshHome = /(?:^|\s)DSH_HOME=(\S+)/.exec(line)?.[1] ?? null;
  return { ppid: Number.isFinite(ppid) ? ppid : null, dshHome, command: line };
}

export async function startHarness(o) {
  // REFUSE BEFORE PREPARING ANYTHING. A state root with a live process in its record is
  // somebody's running deployment — possibly this shell's own from a session that did not
  // quit cleanly. Either way the answer is the same: do not put a second writer on it.
  const occupant = await occupyingPid(o.stateRoot)
  if (occupant !== null) {
    // CRASH RESILIENCE FIRST (Fable, 2026-09-26): a backend can survive a crashed login session as an orphan at
    // PPID 1 holding this very state root. If — AND ONLY IF — it is provably this release's own orphan with no
    // window, it is stopped GRACEFULLY and the launch continues. Anything unproven keeps this refusal.
    const recovery = await reapOrphanBackend({
      release: o.release, stateRoot: o.stateRoot, pid: occupant,
      log: o.onDiagnostic ?? (() => {}),
    })
    if (recovery.action !== 'stopped') {
      throw new Error(
        `state-root-in-use: process ${occupant} is already running against ${o.stateRoot}. ` +
          'Starting a second backend there would put two writers on one set of storages. ' +
          `Stop it first (kill ${occupant}), or set attachUrl to show the backend it is already serving.` +
          (recovery.action === 'refused' ? ` Orphan recovery declined: ${recovery.reasons.join(', ')}.` : ''))
    }
    if (o.onDiagnostic !== undefined) o.onDiagnostic(`orphan-recovery: relaunching after stopping ${String(occupant)}`)
  }
  // The record check above is a courtesy that produces a better message; THIS is the
  // decision. The state root must exist before it can be claimed, and the claim must be
  // held for the whole spawn, not merely consulted before it.
  await prepareStateRoot(o.stateRoot)
  const claim = await claimStateRoot(o.stateRoot)
  try {
    return await spawnHarness(o, claim)
  } catch (error) {
    // A claim outlives only a backend that actually started. Every failure path from
    // here gives it back, or the next launch refuses against a backend that never ran.
    await claim.release()
    throw error
  }
}

/**
 * Spawn the launcher and wait for its authenticated URL. The state root is already
 * prepared and claimed by the caller.
 * @param {object} o - the same options startHarness received.
 * @param {{release: () => Promise<void>}} claim - the held ownership claim.
 * @returns {Promise<object>} url, port, state root and the claim's release.
 */
async function spawnHarness(o, claim) {
  const port = o.port ?? (await freePort())
  // Q1: THE PINNED PORT IS WAITED FOR, NEVER RACED. `freePort()` already tells us a port nobody
  // holds; a port the CALLER pinned is the one launchctl handed the deployment, and the previous
  // backend may still be closing its socket on it. Spawning into that produced
  // `port-unavailable: 50843` in the window, twice, on an ordinary quit-and-reopen.
  // `o.portWaitMs` exists for the court's mutation arm (0 = the wait removed); nothing reads it
  // from config or the environment, so no deployment can shorten this.
  await waitForPortFree(port, {
    timeoutMs: o.portWaitMs ?? PORT_WAIT_MS,
    pollMs: o.portPollMs ?? PORT_POLL_MS,
    onWait: o.onDiagnostic,
  })
  const logPath = join(o.stateRoot, 'logs', 'server.log')
  const offset = await logSize(logPath)

  const argv = [
    join(o.checkout, 'scripts', 'launch-dsh.py'),
    '--release', o.release,
    '--state-root', o.stateRoot,
    '--port', String(port),
  ]
  for (const patch of o.patch ?? []) argv.push('--patch', patch)
  for (const sha of o.approvedRecordSha ?? []) argv.push('--approved-record-sha', sha)
  if (o.allowUnapproved) argv.push('--allow-unapproved')

  const nodeBin = await findNode(o.nodePath)
  if (nodeBin === null) {
    throw new Error(
      'no-node-found: the launcher needs a node binary on PATH. Looked at ' +
      NODE_CANDIDATES.join(', ') + '. Name one as nodePath in config.json.')
  }
  // `eyeEnv` carries the shell's eye address and its per-launch token to the backend child AND
  // NOTHING ELSE carries them: not an argument (visible in `ps`), not a file, not this shell's log.
  const env = { ...process.env, PATH: childPath(nodeBin, process.env.PATH), ...(o.eyeEnv ?? {}) }
  const launcher = spawn('python3', argv, { cwd: o.checkout, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let launcherOut = ''
  launcher.stdout.on('data', d => { launcherOut += d })
  launcher.stderr.on('data', d => { launcherOut += d })
  const code = await new Promise((resolve, reject) => {
    launcher.once('error', reject)
    launcher.once('close', resolve)
  })
  o.onDiagnostic?.(launcherOut.trim())
  if (code !== 0) throw new Error(`launcher-refused (exit ${code}): ${launcherOut.trim()}`)

  const deadline = Date.now() + START_TIMEOUT_MS
  // The launcher redacts the token from its stdout and from server.log (SECURITY.md:169-172). The authenticated url is
  // in `<state>/launch-url.json` (0600, inside this shell's 0700 root), accepted only when it names the pid the launcher
  // announced: a file left by an earlier backend is a credential for a process that is gone.
  const announced = Number(launcherOut.match(/Spawned Genesis PID (\d+)/)?.[1] ?? NaN)
  for (;;) {
    let url = null
    try {
      const record = JSON.parse(await readFile(join(o.stateRoot, 'launch-url.json'), 'utf8'))
      if (record?.pid === announced && typeof record.url === 'string') url = record.url.match(TOKEN_URL)?.[0] ?? null
    } catch { /* not written yet, or being replaced */ }
    if (url) return { url, port, stateRoot: o.stateRoot, releaseClaim: claim.release }
    if (Date.now() > deadline) throw new Error('no-authenticated-url: the harness did not report one before the timeout')
    await new Promise(r => setTimeout(r, POLL_MS))
  }
}

/** The file whose exclusive creation IS the claim on a state root. */
export const OWNERSHIP_CLAIM = 'shell-owner.json'

/**
 * Claim a state root atomically, or refuse.
 *
 * A PID CHECK IS NOT A LOCK, AND THIS REPLACES ONE. `occupyingPid` reads a record and
 * then acts on what it read; two shells starting together both read "free" and both
 * proceed, and the window between the read and the spawn is the whole race. The launcher
 * does not close it either: its only mutual exclusion is a TCP bind on the port, and two
 * backends against one state root on two different ports is the ordinary case, not an
 * exotic one.
 *
 * `openSync(path, 'wx')` is one syscall with O_CREAT|O_EXCL: the kernel decides who wins
 * and the loser gets EEXIST. Whoever creates the file owns the root until it is removed.
 *
 * A CRASH LEAVES A CLAIM BEHIND, AND THAT IS WHY THE PID IS IN IT. A claim whose process
 * is gone is stale and may be taken over — but the decision to break it is made from the
 * claim's own contents, after losing the race, never instead of entering it.
 * @param {string} stateRoot - the root to claim.
 * @returns {Promise<{release: () => Promise<void>, takenOver: number|null}>} the claim.
 * @throws when another live process holds it.
 */
/**
 * This shell process's own identity, minted once.
 *
 * WHY A PID IS NOT ENOUGH. Re-entrancy is decided by comparing the claim's holder with
 * ourselves, and a pid alone cannot do that: the operating system reuses pids, so a shell
 * that crashed leaving a claim behind can be followed by a NEW shell that happens to be
 * given the same number, which would then read a stranger's claim as its own and start a
 * second writer against an occupied state root — the exact failure the claim exists to
 * prevent. A per-process nonce makes "is this mine" answerable rather than guessable.
 */
const SHELL_INSTANCE = randomUUID()

/**
 * Whether a claim record was written by THIS shell process.
 *
 * @param {unknown} held - the parsed claim, or anything at all.
 * @returns {boolean} true only when both the pid and the instance nonce are ours.
 */
function isOurs(held) {
  return held?.pid === process.pid && held?.instance === SHELL_INSTANCE
}

export async function claimStateRoot(stateRoot) {
  const path = join(stateRoot, OWNERSHIP_CLAIM)
  const record = () => JSON.stringify(
    { pid: process.pid, instance: SHELL_INSTANCE, at: new Date().toISOString() }) + '\n'
  const release = async () => {
    // Only ever our own claim: a file whose pid is not ours belongs to somebody else.
    try {
      const held = JSON.parse(await readFile(path, 'utf8'))
      if (!isOurs(held)) return
    } catch { return }
    await rm(path, { force: true })
  }

  for (const attempt of [1, 2]) {
    // POPULATED BEFORE IT IS OBSERVABLE. `open(path,'wx')` then write leaves a window in
    // which the claim exists and is EMPTY, and a competitor that loses the create race
    // reads it, finds no pid, concludes stale and DELETES a claim whose winner is still
    // writing it. `link()` closes that: the record is written to a private temporary
    // file first, and link is both atomic and exclusive — it fails EEXIST rather than
    // replacing — so the claim never exists in an unpopulated state at all.
    const staging = `${path}.${process.pid}.staging`
    try {
      await writeFile(staging, record(), { mode: 0o600, flag: 'w' })
      await link(staging, path)
      return { release, takenOver: null }
    } catch (err) {
      if (err.code !== 'EEXIST') {
        await rm(staging, { force: true })
        throw err
      }
      // We lost the link. Read the winner and decide whether it is alive.
      let held = null
      let readable = true
      let vanished = false
      try {
        held = JSON.parse(await readFile(path, 'utf8'))
      } catch (readError) {
        // GONE IS NOT THE SAME AS GARBAGE, and conflating them turned the ordinary handoff
        // into a refusal. When the holder releases between our link() failing EEXIST and
        // this read — which is exactly what happens when one shell quits as another starts
        // — the read is ENOENT and the root is FREE. Reporting that as
        // `state-root-claim-unreadable: <path> exists …` names a file that does not exist
        // and asks for it to be removed by hand. Measured under churn: thousands of
        // refusals against roots that were free.
        vanished = readError?.code === 'ENOENT'
        readable = false
      }
      if (vanished) {
        // Re-enter the race rather than assuming the removal makes us the winner.
        continue
      }
      const pid = Number.isInteger(held?.pid) && held.pid > 1 ? held.pid : null
      // OUR OWN CLAIM IS NOT A COMPETITOR. A shell that stops its backend and starts
      // another one — a crash recovery, a deliberate restart, the second half of any
      // reconnect — is the SAME writer, not a second one. Before this, that shell met its
      // own live claim and was refused with advice it could not act on ("stop it, or set
      // attachUrl"), because the holder it was told to stop was itself. Measured: the
      // second-start arm failed with `state-root-claimed: process <self> holds …`.
      // Re-entering is allowed only on pid AND instance, never on pid alone.
      if (isOurs(held)) {
        return { release, takenOver: null, reclaimed: true }
      }
      if (pid !== null && alive(pid)) {
        throw new Error(
          `state-root-claimed: process ${pid} holds ${path}. Two backends against one ` +
          'state root is corruption, not sharing. Stop it, or set attachUrl to show the ' +
          'backend it is already serving.')
      }
      if (!readable) {
        // A CLAIM WE CANNOT READ IS NOT A CLAIM WE MAY TAKE. It cannot be one of ours —
        // link() never publishes an unpopulated file — so something else wrote it, and
        // guessing that it is abandoned is how a live root gets a second writer. The
        // refusal names the file so a person can remove it deliberately.
        throw new Error(
          `state-root-claim-unreadable: ${path} exists and is not a claim this shell can ` +
          'read. Refusing to assume it is abandoned. Inspect it and remove it by hand if ' +
          'no backend is running against this state root.')
      }
      if (attempt === 2) {
        throw new Error(`state-root-claim-contended: ${path} could not be claimed or broken`)
      }
      // Stale: the record is readable and its holder is gone. Break it once, then
      // re-enter the race rather than assuming the removal makes us the winner.
      await rm(path, { force: true })
    } finally {
      await rm(staging, { force: true })
    }
  }
  throw new Error(`state-root-claim-contended: ${path}`)
}

/**
 * Whether a pid exists. Signal 0 delivers nothing; EPERM means it exists and is not ours.
 * @param {number} pid - process id.
 * @returns {boolean} true when the process exists.
 */
function alive(pid) {
  try { process.kill(pid, 0); return true } catch (err) { return err.code === 'EPERM' }
}

/**
 * The live process already recorded in a state root, or null.
 *
 * WHY THIS EXISTS. `stateRoot` names where an owned backend writes. Point it at a
 * deployment that is already running and you get two harness processes writing one set
 * of storages — sqlite databases among them — which is corruption, not sharing. The
 * launcher records its pid in the state root it was given, so the cheapest honest check
 * before starting anything is: is the process in that record still alive?
 *
 * A record with no live process is not an obstacle: that is the ordinary case after a
 * clean quit, and it is ignored. Signal 0 tests existence without delivering anything;
 * EPERM means the pid exists and belongs to somebody else, which still counts as alive.
 * @param {string} stateRoot - the state root about to be used.
 * @returns {Promise<number|null>} the live pid, or null when the root is free.
 */
export async function occupyingPid(stateRoot) {
  let record
  try {
    record = JSON.parse(await readFile(join(stateRoot, 'launch.json'), 'utf8'))
  } catch {
    return null // no record, unreadable, or not JSON: nothing is claiming this root
  }
  const pid = record?.pid
  if (!Number.isInteger(pid) || pid <= 1) return null
  try {
    process.kill(pid, 0)
    return pid
  } catch (err) {
    return err.code === 'EPERM' ? pid : null
  }
}

/** The pid this shell spawned, from the launch record the launcher wrote for us. */
export async function spawnedPid(stateRoot) {
  const handle = await open(join(stateRoot, 'launch.json'), 'r')
  try {
    const record = JSON.parse(await handle.readFile('utf8'))
    return typeof record.pid === 'number' ? record.pid : null
  } finally {
    await handle.close()
  }
}

/**
 * Stop only the process we started, and WAIT for it to be gone.
 *
 * A pid we did not spawn is never signalled: the shell refuses the by-port shape entirely,
 * because the listener on a port is not necessarily the process you launched.
 *
 * WHY THIS BLOCKS. Its caller is `app.on('will-quit')`, which cannot await anything — the handler
 * returns and Electron quits. Sending SIGTERM and exiting immediately is what produced the port
 * race twice: the backend needs a moment to close its listening socket, and the person reopening
 * AUKORA arrives inside that moment. So the wait is synchronous and bounded, and the ceiling is
 * short enough that a stubborn child delays the quit rather than hanging it. The listening socket
 * belongs to the child, so its exit IS the port closing; the launch side waits for the port itself
 * as well, which covers anything else that might still hold it. The pid the launcher records is the
 * LAUNCHER'S OWN child — the launcher exits and the backend is reparented — so its going is observed
 * as the pid disappearing. A pid that were this process's direct child would linger as a zombie that
 * `kill(pid, 0)` still reports, which is why the court's fixture spawns its quitter detached.
 *
 * NOTHING IS ESCALATED. This never sends SIGKILL: the child is closing databases, and a hard kill
 * would trade a slow quit for a corrupt one. A child that ignores SIGTERM past the ceiling is left
 * running, and the next launch says `port-unavailable` naming the port — the honest report.
 * @param {number} pid - the pid this shell spawned.
 * @param {object} [o]
 * @param {number} [o.timeoutMs] how long to wait for it to exit.
 * @param {number} [o.pollMs] how often to look.
 * @returns {boolean} true when the signal was delivered — the same answer as before the wait, so a
 *  caller that ignores the result is unaffected.
 */
export function stopSpawned(pid, o = {}) {
  if (!Number.isInteger(pid) || pid <= 1) return false
  try { process.kill(pid, 'SIGTERM') } catch { return false }
  const timeoutMs = o.timeoutMs ?? STOP_WAIT_MS
  const pollMs = o.pollMs ?? STOP_POLL_MS
  const deadline = Date.now() + timeoutMs
  while (alive(pid) && Date.now() < deadline) sleepSync(pollMs)
  return true
}

/**
 * THE GRACEFUL-RESTART WATCHDOG (Fable, alpha-17 item 1; deadline: the next OOM, due ≈18:50).
 *
 * THE FAILURE IT EXISTS FOR, MEASURED 2026-09-27 16:22: the live backend died with
 * `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory` after 8,222,171 ms (2.28 h
 * under seven-lane load), Mark-Compact at 4048 MB — V8's DEFAULT old-space cap, so it dies the moment it arrives.
 * This restarts the backend BEFORE that, at a quiet moment, and relies on goal-resume to re-arm the lanes.
 *
 * THE FOOTPRINT COMES FROM footprint(1), NOT ps. Resident size misses what a JS heap holds; `phys_footprint` is what
 * the crash actually reports, and the same reader the rest of this lane already validated against real output.
 *
 * **IT DECIDES FROM INJECTED SOURCES OF TRUTH, AND IT FAILS CLOSED WHEN A SOURCE DOES NOT EXIST.** "Never
 * mid-approval" is absolute, so it is NOT inferred from a log: MEASURED, the live state root has
 * `state/logs/aukora-signer.log` and NO `aukora-approval-events.log` at all, so a reader over that file would report
 * "no approval open" from a file that has never existed — the fail-open shape this lane refuses. Absent an
 * `approvalOpen` predicate the watchdog says `approval-state-unknown` once and restarts NOTHING.
 *
 * The stop/start pair is the caller's, so the ORDER is provable: stop the backend it was told to stop, wait, then
 * start. The restart line is written BEFORE the stop, so a restart that dies half-way is still recorded as attempted.
 *
 * @param {object} o
 * @param {() => Promise<number|null>} o.pidOf   the live backend pid, from the launch record.
 * @param {(pid: number) => Promise<void>} o.stop  graceful stop of that pid (SIGTERM + wait).
 * @param {() => Promise<object>} o.start          start a fresh backend.
 * @param {() => boolean|Promise<boolean>} [o.approvalOpen]  true while someone is being asked to approve.
 * @param {() => number|null|Promise<number|null>} [o.lastTurnAt]  epoch ms of the last lane turn START, if visible.
 * @param {(pid: number) => number|null} [o.readFootprint]  defaults to footprint(1).
 * @param {number} [o.pollMs] [o.quietWindowMs] [o.limit] [o.now] [(line: string) => void] [o.log]
 * @returns {{stop: () => void, tick: () => Promise<string>}} stop() disarms; tick() runs one sample (courts use it).
 */
export function startRestartWatchdog(o) {
  const pollMs = o.pollMs ?? 15_000
  const quietWindowMs = o.quietWindowMs ?? 60_000
  const limit = o.limit ?? FOOTPRINT_LIMIT_BYTES
  const readFootprint = o.readFootprint ?? readFootprintBytes
  const now = o.now ?? (() => Date.now())
  const log = o.log ?? (() => {})
  let stopped = false
  let busy = false
  let saidUnknown = false
  let saidNoTurns = false
  let lastReason = null

  const tick = async () => {
    if (stopped || busy) return 'busy'
    busy = true
    try {
      const pid = await o.pidOf()
      if (!Number.isInteger(pid) || pid <= 1) return 'no-backend'
      const footprintBytes = readFootprint(pid)
      // AN UNKNOWN APPROVAL STATE IS NOT AN OPEN ONE **AND NOT A CLOSED ONE EITHER**: it is a refusal to act.
      let approvalOpen = true
      if (o.approvalOpen === undefined) {
        if (!saidUnknown) {
          log('footprint-watch: approval-state-unknown — no source of truth for an open approval, so NO restart '
            + 'will be made (never mid-approval is absolute, and a missing log is not evidence of no approval)')
          saidUnknown = true
        }
      } else {
        // **A PREDICATE THAT CANNOT ANSWER IS NOT PERMISSION.** MEASURED: `Boolean(await o.approvalOpen())` turned an
        // `undefined` — "the approval surface is not available yet" — into `false`, which reads as "no approval is open"
        // and LETS THE RESTART PROCEED. That is the fail-open shape this guard exists to prevent, and it is exactly what a
        // shell reports before its bridge exists. A non-boolean answer is UNKNOWN: `approvalOpen` keeps the conservative
        // `true`, so `restartDecision` refuses and NOTHING is restarted.
        const answered = await o.approvalOpen()
        if (typeof answered !== 'boolean') {
          if (!saidUnknown) {
            log('footprint-watch: approval-state-unknown — the approval predicate did not answer with a boolean, so NO '
            + 'restart will be made (a predicate that cannot answer is not permission)')
            saidUnknown = true
          }
        } else {
          approvalOpen = answered
        }
      }
      let quiet = true
      if (o.lastTurnAt === undefined) {
        if (!saidNoTurns) {
          log('footprint-watch: lane-turn clock not visible to this shell, so the quiet rule reduces to the '
            + 'approval rule; supply lastTurnAt to enforce it')
          saidNoTurns = true
        }
      } else {
        const last = await o.lastTurnAt()
        quiet = last === null || last === undefined ? true : (now() - Number(last)) >= quietWindowMs
      }
      const decision = restartDecision({ footprintBytes: footprintBytes ?? Number.NaN, quiet, approvalOpen, limit })
      if (decision.restart) {
        // LOGGED BEFORE THE STOP: a restart that dies half-way is still recorded as attempted.
        log(restartLogLine({ pid, footprintBytes, reason: decision.reason }))
        await o.stop(pid)
        await o.start()
        lastReason = decision.reason
        return decision.reason
      }
      if (decision.reason !== lastReason && decision.reason !== 'below-threshold') {
        log(`footprint-watch: no restart (${decision.reason})`)
      }
      lastReason = decision.reason
      return decision.reason
    } finally {
      busy = false
    }
  }

  const timer = setInterval(() => { void tick() }, pollMs)
  if (typeof timer.unref === 'function') timer.unref()
  return { stop: () => { stopped = true; clearInterval(timer) }, tick }
}

/** The manual fallback, as one line, for while the watchdog is not live (Fable, alpha-17 item 1). */
/**
 * HOW THE SWAP ARMS THIS, AND WHY IT IS NOT ARMED HERE.
 *
 * `startRestartWatchdog` decides and acts only when a caller supplies the sources of truth, and nothing in the checkout
 * calls it yet. That is deliberate: arming it needs TWO things this module cannot invent, and a wrong one would restart
 * the running app at the wrong moment.
 *
 *   1. AN APPROVAL SOURCE. `aumlok-bridge.mjs` publishes `isDrawPending: () => draw.isPending()` (`:1458`), which is the
 *      shell's own answer to "is a person being asked to approve right now". MEASURED: the approval EVENT log does not
 *      exist in the live state root (`state/logs/aukora-signer.log` exists, `aukora-approval-events.log` does not), so a
 *      reader over that file would report "no approval open" from a file that has never existed. Without a predicate the
 *      watchdog logs `approval-state-unknown` and restarts NOTHING, which is the correct failure but not a guard.
 *
 *   2. A CALLABLE BOOT. `ownedPid` is set inside main.mjs's single startup block and the harness start is not a named
 *      function, so `start` cannot be wired without extracting that block. Two shapes work, and the choice is a product
 *      decision rather than a technical one:
 *        (a) extract the startup block into `async function bootBackend()` and pass it as `start`, keeping the window;
 *        (b) pass `async () => { stopSpawned(ownedPid); app.relaunch(); app.exit(0) }`, which restarts the whole shell —
 *            honest and one line, but it closes the person's window, so it is Fable's and Peter's call, not mine.
 *
 * The court asserts the INGREDIENTS exist (the bridge's published getter, `spawnedPid`, `stopSpawned`), so a swap that
 * follows this recipe fails loudly if one of them disappears rather than silently doing nothing.
 */
export const WATCHDOG_ARMING_RECIPE = {
  approvalOpen: 'aumlok-bridge.mjs publishes isDrawPending (line 1458)',
  pidOf: 'spawnedPid(stateRoot)',
  stop: 'stopSpawned(pid)',
  start: 'extract main.mjs startup into bootBackend(), or app.relaunch() — Fable/Peter decide',
}
export const MANUAL_RESTART_FALLBACK =
  "kill -TERM $(python3 -c \"import json,os;print(json.load(open(os.path.expanduser('~/Library/Application Support/AUKORA/state/launch.json')))['pid'])\")"
