/**
 * RUNNING ONE SUBSCRIPTION HAND.
 *
 * Four things happen here that no vendored adapter does, and each is a pin rather than a convenience:
 *
 * ① **A FRESH WORKTREE PER TASK.** `git worktree add --detach` under {@link WORKTREES_ROOT}, so a hand's commits
 *    land on a branch a lane can verify and merge, and **never in the shared checkout**. The adapters take the
 *    child's cwd from the PARENT SESSION, so without this a hand would edit the tree this session is working in.
 *
 * ② **ONE CHILD AT A TIME.** The lock is `scripts/lib/heavy-run.mjs`'s — the SAME lock `scripts/heavy-run.sh`
 *    takes, not a second one. Two locks would be two answers to "is something heavy running", and the measurement
 *    that matters (a second task WAITS) is only true of a shared lock.
 *
 * ③ **A WALL-CLOCK TIMEOUT.** The adapters expose `disposeGraceMs`, which is termination grace — how long to wait
 *    between kill tiers — and NOT a deadline. Nothing stops a hand that never finishes.
 *
 * ④ **THE PROCESS GROUP IS REAPED ON EVERY EXIT PATH.** A CLI that spawns children leaves them behind when only
 *    the parent is killed, so the child is `detached` and the whole group is signalled. `finally` covers the
 *    timeout, an abort and a throw alike.
 *
 * @module run
 */

import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'

import { withHeavyRun } from '../../../scripts/lib/heavy-run.mjs'
import {
  CEILING, CLAUDE_ALLOWED_TOOLS, CLAUDE_PERMISSION_MODE, CODEX_APPROVAL_POLICY, CODEX_SANDBOX_MODE,
  HANDS_ROOT, WALL_CLOCK_MS, WORKTREES_ROOT, assertHandCwd, claudeSettingsJson, codexConfigToml,
} from './pins.mjs'

/** The one CLI this module knows how to launch. A name, not a path: the court supplies a stub. */
export const HANDS = Object.freeze(['codex', 'claude-code'])

/**
 * The argv for one hand. **BUILT HERE, NEVER SUPPLIED BY A CALLER OR A MODEL.**
 *
 * The model contributes a task STRING and nothing else, which is what makes these pins unoverridable rather than
 * merely defaulted: there is no parameter through which a different sandbox, mode or tool list could arrive.
 *
 * @param hand - `codex` or `claude-code`.
 * @param worktree - the task's own worktree.
 * @returns the argv, without the executable.
 */
export function handArgv(hand, worktree) {
  if (hand === 'codex') {
    // Codex reads CODEX_HOME (set in handEnv) rather than ~/.codex, and that file carries approval_policy=never
    // with sandbox_mode=workspace-write and network_access=false. The flags below restate the same pins so a
    // reader of the argv does not have to open a config file to see them — and so a court can assert on them.
    return [
      'exec',
      '--sandbox', CODEX_SANDBOX_MODE,
      '--ask-for-approval', CODEX_APPROVAL_POLICY,
      '-c', 'sandbox_workspace_write.network_access=false',
      '--cd', worktree,
      '--skip-git-repo-check',
      '-',
    ]
  }
  if (hand === 'claude-code') {
    return [
      '-p',
      '--permission-mode', CLAUDE_PERMISSION_MODE,
      '--allowedTools', ...CLAUDE_ALLOWED_TOOLS,
      '--add-dir', worktree,
    ]
  }
  throw new Error(`subscription-hands: unknown hand ${JSON.stringify(hand)}`)
}

/**
 * The environment for one hand.
 *
 * **THE CONFIG DIRECTORIES ARE THE POINT.** `CODEX_HOME` and `CLAUDE_CONFIG_DIR` are redirected into the owned
 * hand root, so neither tool reads Peter's machine-wide settings — the trust decision is this deployment's and
 * not whatever `~/.codex/config.toml` happens to say today.
 *
 * @param hand - `codex` or `claude-code`.
 * @param worktree - the task's own worktree.
 * @param root - the checkout root the hand root lives under.
 * @returns the extra environment entries.
 */
export function handEnv(hand, worktree, root, parentEnv = process.env, runKey) {
  // **PER RUN, BECAUSE THE SETTINGS CARRY THE TASK'S OWN WORKTREE.** A shared config directory meant every new
  // task rewrote the settings a starting or running hand was reading, and the Claude settings name the worktree in
  // `additionalDirectories` — so task B decided what task A was allowed to read. The key is supplied by `runHand`;
  // omitting it keeps the old shared path, which is what the court's red arm measures.
  const configRoot = runKey === undefined
    ? resolve(root, HANDS_ROOT, 'config')
    : resolve(root, HANDS_ROOT, 'config', String(runKey))
  // **AN ALLOWLIST, NOT THE PARENT'S WHOLE ENVIRONMENT.** The runner used to spread `process.env` into every hand,
  // so whatever this process carried — provider keys, tokens, SSH agent sockets, proxies — was readable by a CLI
  // that then runs code of its own. None of it is needed to run a hand: it needs a PATH to find `node` and `git`,
  // a HOME for its own tooling, and a temporary directory.
  const KEEP = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'USER', 'LOGNAME', 'SHELL', 'TERM',
    'SYSTEMROOT', 'COMSPEC', 'PATHEXT']
  const inherited = {}
  for (const name of KEEP) {
    const value = parentEnv[name]
    if (typeof value === 'string' && value !== '') inherited[name] = value
  }
  // **THE OWNED VARS ARE APPLIED LAST AND ARE NOT IN `KEEP`**, so nothing inherited can shadow the sandbox pin or
  // redirect a hand at the operator's own `~/.codex` or `~/.claude`.
  const owned = hand === 'codex'
    ? { CODEX_HOME: join(configRoot, 'codex'), CODEX_SANDBOX_NETWORK_DISABLED: '1' }
    : { CLAUDE_CONFIG_DIR: join(configRoot, 'claude'), CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }
  return { ...inherited, ...owned }
}

/** The owned configuration root, kept out of the allowlist so it can never be shadowed by an inherited name. */
const ownedDir = (owned) => owned

/**
 * Create the task's own worktree.
 *
 * @param options - the repo, the task name and an optional git runner (the court supplies a recorder).
 * @returns the worktree path.
 */
export function createWorktree({ repo, task, root, git = defaultGit }) {
  const safe = String(task).toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 40) || 'task'
  // **A UNIQUE SUFFIX, BECAUSE "A FRESH WORKTREE PER TASK" IS A CLAIM ABOUT COLLISIONS TOO.** Measured: two
  // concurrent tasks whose names reduced to the same slug computed the SAME path, and the second `rmSync` deleted
  // the first's worktree out from under its running child. The lock serialises hand RUNS, but a caller may create
  // worktrees before taking it, so uniqueness cannot be left to the lock.
  const unique = randomUUID().slice(0, 8)
  const worktree = resolve(root, WORKTREES_ROOT, `${safe}-${unique}`)
  mkdirSync(resolve(root, WORKTREES_ROOT), { recursive: true })
  rmSync(worktree, { recursive: true, force: true })
  // `--detach` so a hand cannot land commits on a branch by accident; its work is returned as a branch by
  // `collectBranch`, which names it explicitly.
  const result = git(repo, ['worktree', 'add', '--detach', worktree, 'HEAD'])
  if (result.status !== 0) {
    throw new Error(`subscription-hands: could not create a worktree at ${worktree}: ${result.stderr}`)
  }
  return worktree
}

/** The real git. Replaced in courts, which must not touch a repository. */
function defaultGit(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/**
 * Turn a hand's worktree into a branch a lane can verify and merge.
 *
 * **THE WORK COMES BACK AS A BRANCH, NOT AS A PUSH.** Nothing here writes to a remote, and a lane decides what
 * to do with it — a hand that could publish its own work would be a hand that approves it.
 *
 * @param options - the worktree, the branch name and an optional git runner.
 * @returns the branch name, or null when the hand committed nothing.
 */
export function collectBranch({ worktree, branch, git = defaultGit }) {
  const dirty = git(worktree, ['status', '--porcelain'])
  const head = git(worktree, ['rev-parse', 'HEAD'])
  if (dirty.stdout.trim().length === 0) return null
  git(worktree, ['add', '-A'])
  git(worktree, ['-c', 'user.name=AUKORA hand', '-c', 'user.email=hands@aukora.invalid', 'commit', '-m',
    `subscription hand: ${branch}`])
  const made = git(worktree, ['branch', '-f', branch, head.stdout.trim() === '' ? 'HEAD' : 'HEAD'])
  return made.status === 0 ? branch : null
}

/**
 * Run one hand under every pin.
 *
 * @param options - hand, task, repo, root, and injectable `spawn`/`git`/`now`/`clock` for the courts.
 * @returns what happened, including the argv and env the child received.
 */
export async function runHand(options) {
  const {
    hand, task, repo, root, sharedCheckout = repo,
    spawn: spawnImpl = spawn, git = defaultGit, wallClockMs = WALL_CLOCK_MS, onWait,
    // **AN INTERPRETER, WHEN THE CLI IS A SCRIPT.** The real hands are `codex` and `claude` on PATH, so the
    // default is to exec them directly. A court's stub is a `.mjs` file, which is not executable and spawns as
    // ENOENT — measured here as exit 127 with every pin correct, which is exactly the kind of failure that
    // looks like a broken pin. Stated as an explicit option rather than sniffed from the filename: a
    // security-relevant runner should not guess how to interpret its own command.
    cliRunner = null,
    // Per-run environment entries, layered AFTER the owned ones so a caller cannot overwrite a pin — the pins
    // win by being applied last. Needed because two concurrent runs cannot share one process environment.
    extraEnv = {},
    // `noReap` exists ONLY so a court can measure what reaping does, exactly like `noLock`. Nothing in the
    // deployment passes it: it is the defect the arm names, not a tuning knob.
    noReap = false,
  } = options
  if (!HANDS.includes(hand)) throw new Error(`subscription-hands: unknown hand ${JSON.stringify(hand)}`)

  // **THE REAL PATH, NOT THE PATH WE ASKED FOR.** On macOS `/var` is a symlink to `/private/var`, so a worktree
  // under a temp root comes back from the child as `/private/var/...` while the argv said `/var/...`. Measured:
  // `--add-dir` then named a directory the child's own cwd did not equal, and the pin read as absent while every
  // byte of it was correct. `realpathSync` makes the argv, the cwd and the owned settings name ONE directory.
  const worktree = realpathSync(createWorktree({ repo, task, root, git }))
  assertHandCwd(worktree, sharedCheckout)
  const argv = handArgv(hand, worktree)
  // **ONE CONFIG DIRECTORY PER RUN, AND IT IS UNIQUE RATHER THAN DERIVED FROM THE TASK NAME.** Two tasks can share
  // a slug; a name-derived directory would collide exactly where the worktree no longer does.
  const runKey = randomUUID().slice(0, 8)
  const ownedEnv = handEnv(hand, worktree, root, process.env, runKey)

  // The owned config, written before the child exists so the CLI cannot read a stale one.
  const owned = resolve(root, HANDS_ROOT, 'config', runKey)
  mkdirSync(join(owned, 'codex'), { recursive: true })
  mkdirSync(join(owned, 'claude'), { recursive: true })
  writeFileSync(join(owned, 'codex', 'config.toml'), codexConfigToml())
  writeFileSync(join(owned, 'claude', 'settings.json'), claudeSettingsJson(worktree))

  const record = { hand, worktree, argv, env: ownedEnv, timedOut: false, reaped: false, code: null }

  // `noLock` exists ONLY so a court can measure what the lock does; nothing in the deployment passes it, and it
  // is named as the defect it is rather than as a tuning knob.
  const body = async () => {
    let child = null
    try {
      const command = options.cli ?? hand
      child = spawnImpl(cliRunner ?? command, cliRunner === null ? argv : [command, ...argv], {
        cwd: worktree,
        // **THE CHILD GETS THE ALLOWLISTED ENVIRONMENT, NOT THIS PROCESS'S.** `extraEnv` is layered over it so a
        // court can record where the stub writes, and the owned pins are last so nothing can shadow them.
        env: { ...handEnv(hand, worktree, root, process.env), ...extraEnv, ...ownedEnv },
        // ITS OWN PROCESS GROUP, so the whole tree can be signalled rather than only the parent. A CLI that
        // spawns helpers leaves them running otherwise, and "no child left behind" is a court.
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      if (child.stdin !== null && child.stdin !== undefined) {
        child.stdin.end(String(task))
      }
      // **THE TIMEOUT MUST SETTLE THE PROMISE, NOT MERELY SET A FLAG.** The first version of this only flipped
      // `timedOut`, so a hand that never exited held the run open forever — a deadline that cannot end a task is
      // a comment, and it was in the one place the whole item exists for.
      const code = await new Promise((settle) => {
        const deadline = setTimeout(() => {
          record.timedOut = true
          if (!noReap && child.pid !== undefined) { reapGroup(child.pid); record.reaped = true }
          settle(124)
        }, wallClockMs)
        child.on('exit', (status, signal) => {
          clearTimeout(deadline)
          settle(signal === null ? (status ?? 1) : 128)
        })
        child.on('error', () => { clearTimeout(deadline); settle(127) })
      })
      record.code = code
      return record
    } finally {
      // EVERY EXIT PATH REAPS. A throw above, an abort, or a timeout all land here, and a hand that outlives its
      // own run is a process nobody is watching.
      if (!noReap && child !== null && child.pid !== undefined) {
        reapGroup(child.pid)
        record.reaped = true
      }
      // **THE PER-RUN CONFIG GOES WITH ITS RUN.** It exists to make one task's settings unreachable by another, and
      // leaving them behind would accumulate a directory per task for no reader. Removed AFTER the reap, so a
      // surviving child can never lose the settings it is still reading.
      rmSync(owned, { recursive: true, force: true })
    }
  }
  // **TWO LOCKS, BECAUSE ONE OF THEM DOES NOT SERIALISE TWO HANDS IN THIS PROCESS — MEASURED.**
  //
  // `withHeavyRun` is a FILE lock keyed on a pid. Both hands run as tools inside ONE host process, so they carry
  // the SAME pid: the second sees a lock whose holder is alive, and that holder is itself. The court for this
  // item failed on exactly that — two concurrent runs interleaved while the lock file was dutifully written the
  // whole time. The file lock is still taken, because it is what serialises this host against every OTHER lane's
  // heavy run; the queue below is what serialises the two hands against each other.
  return options.noLock === true
    ? await body()
    : await withInProcessQueue(async () => await withHeavyRun(body, { onWait }))
}

/**
 * One hand at a time INSIDE this process.
 *
 * A promise chain rather than a boolean: each caller appends to the tail, so a task waits for every task queued
 * before it and not merely for the one currently running. A failed run must not break the chain, hence the
 * two-argument `then` that swallows the rejection for the NEXT waiter while still rejecting for its own caller.
 */
let handQueue = Promise.resolve()

function withInProcessQueue(body) {
  const mine = handQueue.then(body, body)
  handQueue = mine.then(() => undefined, () => undefined)
  return mine
}

/**
 * Signal the child's whole process group.
 *
 * A negative pid targets the GROUP, which is why the child was spawned `detached`. `ESRCH` means the group is
 * already gone, which is the outcome we wanted — it is swallowed rather than reported as a failure.
 *
 * @param pid - the child's pid, which is also its process-group id.
 */
export function reapGroup(pid) {
  try {
    process.kill(-pid, 'SIGKILL')
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return true
    return false
  }
}

/** The ceiling, for printing beside any result. */
export { CEILING }
