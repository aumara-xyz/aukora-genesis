/**
 * THE LENS EXECUTOR: ASYNCHRONOUS, TIMED, AND NEVER IN THE WAY OF THE BACKEND.
 *
 * THE DEFECT. Every read the lenses perform ran through `spawnSync` — `git log`, `git status`, `gh run list` and
 * `git grep` — inside **the one Node process that hosts all seven lanes and every voice stream.** A synchronous
 * spawn does not merely take time; it takes the EVENT LOOP, so while git was running nothing else in the
 * process could: not another lane's turn, not a voice frame's socket callback, not a timer. Three of those calls
 * carried a ten-second timeout and one carried none at all, so the worst case was not a slow lens, it was a
 * stalled backend.
 *
 * **A TTL CACHE LIMITS HOW OFTEN THIS HAPPENS. IT DOES NOT LIMIT HOW LONG, AND IT DOES NOT UNBLOCK THE LOOP.**
 * That is why this module exists separately from the cache: the cache is about frequency, this is about the loop.
 *
 * TWO RULES, AND BOTH ARE COURTS:
 *
 *   ① **EVERY COMMAND IS ASYNCHRONOUS AND HAS A TIMEOUT.** `execFile` with an argv array (never a shell, so no
 *      branch name or path can become a command) and a deadline that KILLS the child. A timeout is reported BY
 *      NAME — "timed out after 8000 ms" — because a lens that says "git failed" when it meant "git was too slow"
 *      sends the reader looking in the wrong place.
 *   ② **`gh` FAILING IS NOT AN ERROR, IT IS AN UNKNOWN.** The CI reader is the only lens that reaches the
 *      network, and the honest answer when it cannot is "CI unknown" — not a thrown error, not a silent absence,
 *      and not a lens that blocks a turn waiting for GitHub. Every other failure keeps its own name.
 *
 * @module lens-exec
 */

import { execFile } from 'node:child_process'
import { lstat, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** What one executed lens command produced. Exactly the shape the readers' contracts already expect. */
export interface LensExecResult {
  stdout: string
  error: string | null
  /**
   * The child's exit status, or null when it did not exit normally (a signal, a timeout).
   *
   * **CARRIED BECAUSE `git grep` ANSWERS WITH IT.** Exit 1 from `grep` is "no matches", which is a real answer,
   * while any other non-zero status is git refusing to run — and a reader that cannot tell those apart reports
   * "nothing matched" for a repository it could not read at all.
   */
  status: number | null
}

/** Options one lens command may carry. */
export interface LensExecOptions {
  cwd?: string
  timeoutMs?: number
  maxBuffer?: number
}

/** The executor contract every reader takes. Asynchronous by construction. */
export type LensExec = (command: string, args: string[], options?: LensExecOptions) => Promise<LensExecResult>

/** The default deadline. A lens that has not answered in this long is not going to be useful to a spoken turn. */
export const LENS_TIMEOUT_MS = 8_000

/**
 * Run one lens command without ever blocking the event loop.
 *
 * **IT RESOLVES RATHER THAN REJECTS.** Every reader in the lens path treats a failure as a NAMED SOURCE IT COULD
 * NOT READ, so a rejection here would have to be caught and converted at four call sites; resolving with the
 * error in the result keeps the readers' existing discipline and loses no name.
 *
 * @param command - the program, run directly and never through a shell.
 * @param args - its arguments as an array.
 * @param options - working directory, deadline and output ceiling.
 * @returns stdout and an error string, exactly as the readers' contract says.
 */
export async function lensExec(command: string, args: string[], options: LensExecOptions = {}): Promise<LensExecResult> {
  let gitEnvironment: NodeJS.ProcessEnv | undefined
  if (command === 'git' || command === '/usr/bin/git') {
    try {
      // Each call checks the named root, including grep and cache refreshes. Gitfiles/worktrees and .git symlinks are refused.
      if (options.cwd === undefined) throw new Error('a repository root is required')
      const root = await realpath(options.cwd)
      const gitDir = join(root, '.git')
      if (!(await lstat(gitDir)).isDirectory()) throw new Error('.git must be a real directory')
      command = '/usr/bin/git'
      args = ['--no-replace-objects', '--no-optional-locks', `--git-dir=${gitDir}`, `--work-tree=${root}`,
        '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.attributesFile=/dev/null', ...args]
      // Match the repository's hardened subprocess pattern: an allowlisted environment, never inherited Git controls.
      gitEnvironment = {
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: '/dev/null', LANG: 'C.UTF-8',
        GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CEILING_DIRECTORIES: dirname(root), GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1',
      }
    } catch {
      return { stdout: '', status: null, error: 'repository root requires a real .git directory' }
    }
  }
  const timeoutMs = options.timeoutMs ?? LENS_TIMEOUT_MS
  return new Promise<LensExecResult>((resolve) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        ...(gitEnvironment === undefined ? {} : { env: gitEnvironment }),
        // THE DEADLINE IS ENFORCED BY KILLING THE CHILD. Without it a wedged `gh` would hold a lane's turn open
        // for as long as GitHub felt like taking.
        timeout: timeoutMs,
        encoding: 'utf8',
        maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout) => {
        const out = typeof stdout === 'string' ? stdout : ''
        if (error === null || error === undefined) {
          resolve({ stdout: out, error: null, status: 0 })
          return
        }
        // A TIMEOUT IS NAMED AS A TIMEOUT. `execFile` reports it as a killed process, and "git exited null" is
        // not a sentence anyone can act on.
        if (error.killed === true || error.signal !== null && error.signal !== undefined) {
          resolve({
            stdout: out,
            status: null,
            error: `timed out after ${String(timeoutMs)} ms (signal ${String(error.signal ?? 'unknown')})`,
          })
          return
        }
        const status = (error as { code?: unknown }).code
        resolve({
          stdout: out,
          status: typeof status === 'number' ? status : null,
          error: typeof status === 'number' ? `${command} exited ${String(status)}` : String(error.message),
        })
      },
    )
  })
}

/**
 * The CI reader's own executor: **`gh` failing degrades to "CI unknown" instead of costing the lens.**
 *
 * The string deliberately still contains `gh run list`, because the existing discipline is that an unread source
 * is NAMED in the report's tail, and a reader who sees "CI unknown" should also be able to see which command
 * could not answer. Both facts fit in one line.
 */
export async function ghLensExec(
  exec: LensExec,
  repo: string,
): Promise<LensExecResult> {
  const result = await exec(
    'gh',
    ['run', 'list', '--limit', '5', '--json', 'status,conclusion,headBranch,workflowName,createdAt'],
    { cwd: repo, timeoutMs: LENS_TIMEOUT_MS },
  )
  if (result.error === null) return result
  return { stdout: '', status: result.status, error: `CI unknown (gh run list: ${result.error})` }
}
