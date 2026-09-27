/**
 * THE TRUSTED SELF-CHANGE TOOL, `aukora_self_change`: how a CONTAINED agent proposes a change to its own code.
 *
 * In a `workspace-write` session the agent's shell runs under Seatbelt with AUKORA's rules (plugins/aukora-seatbelt): it
 * may write ~/aukora-worktrees and temp, never the governing checkout, the support root, the signer socket or the
 * Aumlok state, so it cannot run scripts/aukora/self-change.mjs (and the gate refuses it trying, routes.mjs
 * `routedScript`). This tool is the route. The harness runs the OWNER'S copy of self-change.mjs (repoRoots[0], which a
 * contained shell cannot write) as a host child process, outside the sandbox, against the agent's worktree
 * (AUKORA_SELF_CHANGE_SOURCE). Nothing the agent wrote is executed: the program, its imports, its environment and its
 * arguments are fixed here; the worktree supplies only the bytes of the named files, which self-change reads without
 * following links and shows in full in the owner's Aumlok popup.
 *
 *   worktree  a name directly under ~/aukora-worktrees (or that path). A name that does not exist yet is created at
 *             GitHub main (`git fetch origin main`, `git worktree add --detach`) and handed back for editing.
 *   paths     plain relative file paths in it: no `..`, no patterns, no `.git`.
 *   preview   true stops at the exact operation text; otherwise the popup is raised and the call waits for the owner.
 *
 * WHAT IT DOES NOT ESTABLISH: the approval in the popup is the authority; this tool only carries the request, and the
 * approving key is a software key on this Mac (same UID; who clicked is not proven). A worktree's git state is trusted
 * because a contained shell cannot write it (its `.git` pointer and the checkout's `.git` are denied by the seatbelt
 * rows); in Full access the agent can write anything and this tool adds nothing there. From a worktree self-change.mjs
 * refuses face changes, whose build would run worktree code on this machine.
 *
 * @module @aukora/dsh-plugin-action-gate/self-change-tool
 */
import { spawn, spawnSync } from 'node:child_process'
import { lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

export const SELF_CHANGE_TOOL = 'aukora_self_change'
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u
const MAX_PATHS = 64
const MAX_OUTPUT = 24_000

const refuse = (message) => { throw new Error(`${SELF_CHANGE_TOOL} refused: ${message}`) }

/** The worktree's absolute path: a single name under the root, spelled as a name or as that exact path. */
export function worktreePath(root, raw) {
  if (typeof raw !== 'string' || raw === '') refuse('name the worktree')
  const name = isAbsolute(raw) && dirname(raw) === root ? raw.slice(root.length + 1) : raw
  if (!NAME.test(name) || name === '.' || name === '..') refuse(`the worktree is a plain name directly under ${root} (letters, digits, . _ -)`)
  return join(root, name)
}

/** A path self-change may name: relative, no empty, `.`, `..` or `.git` segment, no pattern or control characters. */
export function plainPath(path) {
  if (typeof path !== 'string' || path === '' || path.length > 300 || isAbsolute(path) || path.startsWith(':')
    || /[\u0000-\u001f\\*?[\]]/u.test(path)) refuse(`${JSON.stringify(path)} is not a plain relative file path`)
  if (path.split('/').some(part => part === '' || part === '.' || part === '..' || part.toLowerCase() === '.git')) {
    refuse(`${JSON.stringify(path)} has an empty, ., .. or .git segment`)
  }
  return path
}

/**
 * The tool definition.
 * @param {{repo: string, worktreesRoot: string, supportRoot: string, env?: Record<string, string>}} options - the
 *   owner's checkout (its self-change.mjs runs), the worktree root, the support root; `env` is for scratch checks only.
 * @returns {object} a harness ToolDefinition.
 */
export function createSelfChangeTool({ repo, worktreesRoot, supportRoot, env = {} }) {
  const script = join(repo, 'scripts', 'aukora', 'self-change.mjs')
  const childEnv = () => Object.fromEntries(Object.entries({
    PATH: process.env.PATH, HOME: process.env.HOME, USER: process.env.USER, LOGNAME: process.env.LOGNAME,
    TMPDIR: process.env.TMPDIR, LANG: process.env.LANG ?? 'en_US.UTF-8', AUKORA_SUPPORT_ROOT: supportRoot, ...env,
  }).filter(([, value]) => typeof value === 'string'))
  const git = (args) => {
    const run = spawnSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'credential.helper=osxkeychain',
      '-C', repo, ...args], { encoding: 'utf8', env: childEnv(), timeout: 300_000 })
    if (run.status !== 0) refuse(`git ${args[0]} failed: ${String(run.stderr ?? run.error?.message ?? '').trim().split('\n').pop()}`)
    return run.stdout.trim()
  }

  async function execute(args, exec) {
    mkdirSync(worktreesRoot, { recursive: true, mode: 0o700 })  // a fresh machine has none, and a confined shell cannot make it
    const root = realpathSync(worktreesRoot)
    const worktree = worktreePath(root, args?.worktree)
    const why = args?.why
    if (typeof why !== 'string' || why.trim() === '' || why.length > 300 || /[\u0000-\u001f]/u.test(why)) refuse('why is one line of at most 300 characters')
    const paths = Array.isArray(args?.paths) ? args.paths.map(plainPath) : []
    if (paths.length > MAX_PATHS) refuse(`at most ${String(MAX_PATHS)} paths`)
    const common = realpathSync(git(['rev-parse', '--path-format=absolute', '--git-common-dir']))

    const st = lstatSync(worktree, { throwIfNoEntry: false })
    if (st === undefined) {
      git(['fetch', '-q', 'origin', 'main'])
      git(['worktree', 'add', '-q', '--detach', worktree, 'origin/main'])
      return `CREATED ${worktree} at GitHub main ${git(['rev-parse', '--short', 'origin/main'])}. Edit the files there, then call `
        + `${SELF_CHANGE_TOOL} again with this worktree and the paths you changed (preview: true first).`
    }
    if (!st.isDirectory() || realpathSync(worktree) !== worktree) refuse(`${worktree} is not a plain directory`)
    const pointer = lstatSync(join(worktree, '.git'), { throwIfNoEntry: false })
    const gitdir = pointer?.isFile() ? /^gitdir: (.+)\n?$/u.exec(readFileSync(join(worktree, '.git'), 'utf8'))?.[1] : undefined
    let admin
    try { admin = gitdir === undefined ? undefined : realpathSync(gitdir) } catch { admin = undefined }
    if (admin === undefined || dirname(admin) !== join(common, 'worktrees')) refuse(`${worktree} is not a worktree of ${repo}`)
    if (paths.length === 0) refuse('name the files you changed in paths')
    if (!readFileSync(script, 'utf8').includes('AUKORA_SELF_CHANGE_SOURCE')) {
      refuse(`${script} cannot propose from a worktree yet; bring ${repo} to GitHub main`)
    }

    const child = spawn(process.execPath, [script, ...args.preview === true ? ['--preview'] : [], why, ...paths], {
      cwd: worktree, env: { ...childEnv(), AUKORA_SELF_CHANGE_SOURCE: worktree }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const take = chunk => { output = (output + chunk).slice(-MAX_OUTPUT) }
    child.stdout.setEncoding('utf8').on('data', take)
    child.stderr.setEncoding('utf8').on('data', take)
    const stop = () => child.kill('SIGTERM')
    exec?.signal?.addEventListener('abort', stop, { once: true })
    const code = await new Promise(done => { child.once('close', (status, signal) => done(status ?? signal)); child.once('error', e => done(e.message)) })
    exec?.signal?.removeEventListener('abort', stop)
    return `SELF-CHANGE ${args.preview === true ? 'PREVIEW ' : ''}EXIT ${String(code)} (${worktree})\n${output}`
  }

  return {
    name: SELF_CHANGE_TOOL,
    description: 'Propose a change to AUKORA\'s own code (plugins, apps, scripts, overlays, anything governing). Name a worktree '
      + 'under ~/aukora-worktrees: a new name is created at GitHub main for you; edit the files there with your shell, then call '
      + 'again with why (one line) and the paths you changed. preview: true returns the exact text Peter will see. Without '
      + 'preview the Aumlok popup opens on his screen and this call waits: Approve commits exactly that tree to GitHub main '
      + 'and restarts into it; Refuse commits nothing. Never run self-change.mjs from your shell.',
    // A JSON Schema object: the model API refuses a bare field map ("schema must be type: object"), and one bad tool
    // schema fails EVERY turn in the app (live, 2026-09-27 21:40).
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        why: { type: 'string', description: 'Why, in one line. It becomes the commit subject.' },
        worktree: { type: 'string', description: 'A worktree name (or path) directly under ~/aukora-worktrees.' },
        paths: { type: 'array', items: { type: 'string' }, description: 'Repository-relative files changed in that worktree.' },
        preview: { type: 'boolean', description: 'true: show the operation text only; no popup, nothing written.' },
      },
      required: ['why', 'worktree'],
    },
    timeoutMs: 20 * 60_000,
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    isConcurrencySafe: () => false,
    execute,
  }
}
