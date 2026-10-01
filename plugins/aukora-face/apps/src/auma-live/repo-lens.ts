// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Read-only repository lens for the Auma Live presence mind. The voice lane
 * lives inside this repository; the lens lets it read what it lives in —
 * bounded file reads, directory listings, and a bounded grep, under one root.
 *
 * WHAT MAKES IT SAFE TO AIM AT A WHOLE REPOSITORY, in three rules checked in
 * this order, because a later rule cannot see what an earlier one let through:
 *
 *   1. CONTAINMENT. The lexical resolution AND the filesystem realpath must both
 *      stay below the root, so `../` and a symlink that points outside are
 *      refused before anything else is considered.
 *   2. TRACKEDNESS. Only files git tracks are served. What git tracks is what the
 *      repository IS; a scratch file, a build output, a live token file and an
 *      untracked `.env` are things the worktree happens to contain. The index is
 *      cached and refreshed when HEAD moves, because a cache that never notices
 *      a commit serves a repository that no longer exists.
 *   3. SECRET-SHAPED NAMES. A `*-key.json`, a `.pem`, a `door.token` and a
 *      `launch.json` are withheld BY NAME, and the refusal says which rule it
 *      was — a name is a decision someone made, and a spoken turn that reads one
 *      out loud is not recoverable.
 *
 * THE GREP VERB OBEYS THE SAME THREE RULES. It shells out to nothing (argv, no
 * shell), it searches tracked files because that is what `git grep` searches,
 * and it filters the OUTPUT through rule 3 — the one verb that reads many files
 * must not become the one verb that reads a file the lens refuses.
 */
import { lensExec } from './lens-exec.ts'
import { createHash } from 'node:crypto'
import { readdir, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

/** Directory names never entered, listed, or grepped: noise and never spoken material. */
const DENIED_SEGMENTS = new Set(['.git', 'node_modules', '.venv', '__pycache__'])

/**
 * Secret-shaped names, withheld outright.
 *
 * THE SEPARATOR GROUP IS THE POINT of the first alternative: `key` alone would withhold `keyboard.md`
 * and `monkey.md`, while `(^|[._-])key` withholds `api-key.json`, `signing_key.txt` and `key.json` and
 * leaves the prose alone. The rest names the shapes a credential actually arrives in — including `door`
 * and `launch.json`, which is where this deployment keeps the eye's and the lane door's own addresses.
 */
const WITHHELD_NAME = /(^|[._-])(key|seed|token|secret|credential|private)|\.pem$|\.p12$|grant\.json|issuer\.json|door|launch\.json|^\.env/iu

/** A second, older rule kept as well: an env file or a credential is never spoken. */
const DENIED_BASENAME = /^\.env(\..+)?$|credential/iu

/** The refusal for a path git does not track. Named, so an empty answer can never stand in for it. */
const NOT_TRACKED_MESSAGE = 'not tracked by git — this lens serves the files the repository tracks'

/** The refusal for a secret-shaped name. */
const WITHHELD_MESSAGE = 'withheld: that name is secret-shaped'

/** Directory entries returned per listing before the remainder is summarized. */
const MAX_LIST_ENTRIES = 300

/** Matching lines returned by one grep before the remainder is summarized. */
const MAX_GREP_LINES = 40

/** One cached view of what git tracks, keyed by the commit it was taken at. */
interface TrackedIndex {
  /** HEAD as git reported it, or '' when the repository has no commits yet. */
  head: string
  /** Every tracked path, relative to the root, with `/` separators. */
  paths: Set<string>
  /** Every directory that CONTAINS a tracked path, so an empty tracked directory is not invented. */
  directories: Set<string>
}

/**
 * **WHETHER `root` IS THE TOP OF A GIT WORK TREE — THE ONLY KIND OF ROOT THIS LENS SHOULD SERVE.**
 *
 * TRACKEDNESS (rule 2) is answered by `git ls-files`, so a root that is not in a work tree can answer nothing: every
 * summary throws. A fresh install's backend cwd is `<stateRoot>/workspace`, an empty non-git directory, and the default
 * `repoLensRoot` of `.` pointed the lens straight at it. The caller uses this to mean NO LENS (and to say so at startup)
 * instead of a lens that fails on every turn.
 *
 * **THE ROOT MUST BE THE WORK TREE'S OWN TOP, NOT MERELY SOMEWHERE INSIDE ONE.** A workspace folder that sits under a
 * repository the owner never meant to share (a dotfiles repo at `~`) would otherwise turn "inside a work tree" into
 * "serves that repository", which is a wider disclosure than the config named. A git that cannot run at all is also
 * `false`: no lens beats a broken one.
 *
 * @param root - Absolute directory to test.
 * @returns `true` only when git says `root` is itself a work tree's top-level directory.
 */
export async function isGitWorkTree(root: string): Promise<boolean> {
  const run = await lensExec('git', ['rev-parse', '--show-toplevel'], { cwd: root, maxBuffer: 4096 })
  if (run.status !== 0) return false
  const top = run.stdout.trim()
  if (top.length === 0) return false
  try {
    return (await realpath(top)) === (await realpath(root))
  } catch {
    return false
  }
}

/** Lens construction settings. */
export interface RepoLensConfig {
  /** Absolute repository root the lens may read below. */
  root: string
  /** Byte cap for one file read; longer files are truncated with a marker. */
  maxFileBytes: number
}

/** One lens answer, ready to frame into a model message. */
export interface RepoLensResult {
  /** The request exactly as the model wrote it. */
  request: string
  /** File text, listing, grep matches, or a one-line refusal/error the model can speak. */
  text: string
  /**
   * **SHA-256 OVER EXACTLY `text`, HEX — THE DIGEST THE ATTENTION VIEW SHOWS AND WILL NOT INVENT.**
   *
   * AK-UI, on the per-reply manifest: *"a wrong digest makes the attention view answer confidently and wrongly."* The
   * view exists to show what was really held, so the digest has to be taken **where the bytes are**, by the component
   * holding them — **not re-read later by the engine, where a second read is a second chance to read something else.**
   *
   * **IT IS REQUIRED RATHER THAN OPTIONAL, AND THAT IS DELIBERATE:** `exactOptionalPropertyTypes` would let an absent
   * field pass as `undefined`, and a manifest item whose digest is quietly missing is the invented digest by another
   * route. A required field means every return site must produce one, and the wrapper below is what guarantees it.
   */
  sha256: string
}

/**
 * One-line message for a lens failure, safe to speak.
 * @param error - The thrown value.
 * @returns The Error message, or the stringified value for a non-Error throw.
 */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Bounded read-only reads, listings and greps below one repository root. */
export class RepoLens {
  private readonly config: RepoLensConfig
  private readonly root: string
  private rootReal: string | undefined
  private summaryCache: string | undefined
  private index: TrackedIndex | undefined

  /**
   * @param config - Root and per-read bound.
   *
   * THE FIELD IS DECLARED AND ASSIGNED RATHER THAN A CONSTRUCTOR PARAMETER PROPERTY, so this module can be
   * imported by plain Node: `--experimental-strip-types` erases types but cannot rewrite a parameter
   * property into a field, and a court that cannot import the lens can only read its text.
   */
  constructor(config: RepoLensConfig) {
    this.config = config
    this.root = resolve(config.root)
  }

  /**
   * Answer one model-authored lens request, **WITH A DIGEST OVER THE TEXT IT RETURNS.**
   *
   * **THE DIGEST IS TAKEN HERE RATHER THAN BY THE CALLER, AND THE WRAPPER IS WHY.** `answerText` below has four return
   * sites — grep, list, read, and the refusal — **and computing a digest at each one is four chances to miss one.**
   * A missed digest on a refusal is harmless; **a missed digest on a FILE READ is the attention view showing a page
   * with no way to tell what was on it.** So the body was renamed and this wrapper digests whatever it returns,
   * **which makes "every answer carries a digest" a property of the shape rather than of four remembered edits.**
   *
   * @param request - `list <path>`, `grep <pattern>`, or a path to read.
   * @returns The request echoed with its bounded result or refusal text, and the digest of that text.
   */
  async answer(request: string): Promise<RepoLensResult> {
    const answered = await this.answerText(request)
    // **OVER THE TEXT, NOT OVER THE FILE.** For a read they are the same bytes; **for a grep or a listing the text IS
    // what she was shown**, and digesting the underlying file would claim she saw something she did not.
    return { ...answered, sha256: createHash('sha256').update(answered.text, 'utf8').digest('hex') }
  }

  /**
   * The lens answer, before its digest is taken. **PRIVATE, AND ONLY `answer` CALLS IT.**
   *
   * @param request - the model-authored request, as received.
   * @returns the bounded result or refusal text.
   */
  private async answerText(request: string): Promise<Omit<RepoLensResult, 'sha256'>> {
    const trimmed = request.trim()
    const grepMatch = /^grep\s+(?<pattern>[\s\S]+)$/u.exec(trimmed)
    const listMatch = /^list(\s+(?<path>.*))?$/u.exec(trimmed)
    try {
      if (grepMatch !== null) return { request: trimmed, text: await this.grep(grepMatch.groups?.pattern ?? '') }
      if (listMatch !== null) {
        const target = listMatch.groups?.path?.trim()
        return { request: trimmed, text: await this.list(target === undefined || target.length === 0 ? '.' : target) }
      }
      return { request: trimmed, text: await this.read(trimmed) }
    } catch (error: unknown) {
      return { request: trimmed, text: `not readable: ${errorText(error)}` }
    }
  }

  /**
   * A cached two-level map of the repository for the system prompt.
   * @returns Root entries, with one level of children for root directories.
   */
  async summary(): Promise<string> {
    if (this.summaryCache !== undefined) return this.summaryCache
    const lines: string[] = []
    for (const entry of await this.entries('.')) {
      if (!entry.endsWith('/')) {
        lines.push(entry)
        continue
      }
      const children = await this.entries(entry).catch(() => [])
      lines.push(`${entry} ${children.slice(0, 24).join(' ')}${children.length > 24 ? ' …' : ''}`)
    }
    this.summaryCache = lines.join('\n')
    return this.summaryCache
  }

  /** Read one tracked file, bounded and text-only. */
  private async read(relPath: string): Promise<string> {
    const normalized = normalizeRequestPath(relPath)
    // CONTAINMENT FIRST, THEN TRACKEDNESS: a symlink that leaves the root is refused for where it points,
    // which is the more specific and more useful refusal even though the link is also untracked.
    const target = await this.contain(normalized)
    await this.assertTrackedFile(normalized)
    const bytes = await readFile(target)
    if (bytes.subarray(0, 8_192).includes(0)) return 'binary file — not speakable'
    const truncated = bytes.byteLength > this.config.maxFileBytes
    const text = bytes.subarray(0, this.config.maxFileBytes).toString('utf8')
    return truncated ? `${text}\n… (truncated at ${String(this.config.maxFileBytes)} bytes)` : text
  }

  /** List one tracked directory, bounded and sorted, directories suffixed `/`. */
  private async list(relPath: string): Promise<string> {
    const entries = await this.entries(relPath)
    const shown = entries.slice(0, MAX_LIST_ENTRIES)
    const rest = entries.length - shown.length
    return shown.join('\n') + (rest > 0 ? `\n… (+${String(rest)} more)` : '')
  }

  /**
   * Search tracked file contents through git, capped, and filtered through the name rule.
   *
   * NO SHELL AND NO INTERPOLATION: the pattern is one argv entry after `-e`, so a pattern that looks like
   * an option is a pattern, and a pattern full of shell metacharacters is a regular expression that
   * matches nothing. The pathspec is left empty because `git grep` already searches only tracked files;
   * the withheld names are removed from the OUTPUT, which is the invariant that actually matters.
   * @param pattern - the regular expression the model asked for.
   * @returns matching `path:line:text` rows, or a one-line statement of what was found.
   */
  private async grep(pattern: string): Promise<string> {
    const trimmed = pattern.trim()
    if (trimmed.length === 0) throw new Error('grep needs a pattern')
    // **THE EVENT LOOP IS NOT HELD WHILE GIT SEARCHES.** `git grep` over a large repository is the longest
    // command in the lens path, and it used to run synchronously inside the one process hosting every lane.
    const run = await lensExec('git', ['grep', '-n', '-I', '-e', trimmed], {
      cwd: this.root,
      maxBuffer: 8 * 1024 * 1024,
    })
    // 1 IS "NO MATCHES", which is an answer; anything else is git refusing to run.
    if (run.status !== 0 && run.status !== 1) {
      throw new Error(`grep is not available here (git exited ${String(run.status ?? 'unknown')})`)
    }
    const lines = String(run.stdout ?? '').split('\n').filter(line => line.length > 0)
    const allowed = lines.filter((line) => {
      const match = /^(?<path>[^:]+):(?<line>\d+):/u.exec(line)
      const path = match?.groups?.path
      if (path === undefined) return false
      if (this.withheld(path)) return false
      return !path.split('/').some(segment => DENIED_SEGMENTS.has(segment))
    })
    if (allowed.length === 0) return 'no tracked file matches that pattern'
    const shown = allowed.slice(0, MAX_GREP_LINES)
    const rest = allowed.length - shown.length
    return shown.join('\n') + (rest > 0 ? `\n… (+${String(rest)} more matching lines; the lens shows ${String(MAX_GREP_LINES)})` : '')
  }

  private async entries(relPath: string): Promise<string[]> {
    const normalized = normalizeRequestPath(relPath)
    const target = await this.contain(normalized)
    const index = await this.tracked()
    // A DIRECTORY IS SERVED ONLY IF GIT TRACKS SOMETHING IN IT. An empty listing would be a true statement
    // about the disk and a misleading one about the repository, and it is how an untracked scratch
    // directory would still get named to the model.
    if (normalized !== '.' && !index.directories.has(normalized) && !index.paths.has(normalized)) {
      throw new Error(NOT_TRACKED_MESSAGE)
    }
    const prefix = normalized === '.' ? '' : `${normalized}/`
    const listed = await readdir(target, { withFileTypes: true })
    return listed
      .filter(entry => !DENIED_SEGMENTS.has(entry.name) && !this.withheld(entry.name))
      .filter((entry) => {
        const path = `${prefix}${entry.name}`
        return index.paths.has(path) || index.directories.has(path)
      })
      .map(entry => entry.isDirectory() ? `${entry.name}/` : entry.name)
      .sort()
  }

  /**
   * Resolve one relative request inside the root, or throw. Both the lexical
   * resolution and the filesystem realpath must stay below the root, and no
   * traversed segment may be denied or secret-shaped.
   */
  private async contain(relPath: string): Promise<string> {
    if (isAbsolute(relPath)) throw new Error('absolute paths are outside the lens')
    const resolved = resolve(this.root, relPath)
    const inside = relative(this.root, resolved)
    if (inside.startsWith('..') || isAbsolute(inside)) throw new Error('path escapes the repository')
    for (const segment of inside.split(sep)) {
      if (DENIED_SEGMENTS.has(segment)) throw new Error(`${segment} is outside the lens`)
      if (segment.length > 0 && this.withheld(segment)) throw new Error(WITHHELD_MESSAGE)
    }
    this.rootReal ??= await realpath(this.root)
    const real = await realpath(resolved)
    if (real !== this.rootReal && !real.startsWith(this.rootReal + sep)) {
      throw new Error('path escapes the repository')
    }
    return resolved
  }

  /** Whether any segment of a relative path is secret-shaped or an env file. */
  private withheld(relPath: string): boolean {
    return relPath.split('/').some(segment => WITHHELD_NAME.test(segment) || DENIED_BASENAME.test(segment))
  }

  /** Refuse a path git does not track, by name. */
  private async assertTrackedFile(relPath: string): Promise<void> {
    if (!(await this.tracked()).paths.has(relPath)) throw new Error(NOT_TRACKED_MESSAGE)
  }

  /**
   * What git tracks right now, cached until HEAD moves.
   *
   * THE REFRESH IS THE CACHE'S REASON TO EXIST. A lens that snapshotted the index once would keep serving
   * a repository that has since committed or deleted files, and the failure would be silent, because the
   * paths it serves still exist on disk.
   * @returns the tracked paths and the directories that hold them.
   */
  private async tracked(): Promise<TrackedIndex> {
    const head = (await this.git(['rev-parse', 'HEAD'])).stdout.trim()
    if (this.index !== undefined && head !== '' && this.index.head === head) return this.index
    const listed = await this.git(['ls-files', '-z'])
    if (listed.status !== 0) throw new Error('this repository cannot be read: git ls-files failed')
    const paths = new Set(listed.stdout.split('\0').filter(path => path.length > 0))
    const directories = new Set<string>()
    for (const path of paths) {
      const segments = path.split('/')
      for (let depth = 1; depth < segments.length; depth += 1) {
        directories.add(segments.slice(0, depth).join('/'))
      }
    }
    this.index = { head, paths, directories }
    return this.index
  }

  /** One git invocation, argv only — never a shell, never an interpolated command line. */
  private async git(args: string[]): Promise<{ status: number | null; stdout: string }> {
    // A DEADLINE, WHICH THIS CALL NEVER HAD. The synchronous version carried no timeout at all, so a wedged git
    // held the backend open indefinitely rather than for ten seconds.
    const run = await lensExec('git', args, { cwd: this.root, maxBuffer: 8 * 1024 * 1024 })
    return { status: run.status, stdout: run.stdout }
  }
}

/**
 * One request path as the tracked index spells it: no leading `./`, no trailing slash, `/` separators.
 * @param relPath - the path as the model wrote it.
 * @returns the normalized relative path.
 */
function normalizeRequestPath(relPath: string): string {
  const trimmed = relPath.trim().replace(/^\.\//u, '').replace(/\/+$/u, '')
  return trimmed.length === 0 ? '.' : trimmed
}
