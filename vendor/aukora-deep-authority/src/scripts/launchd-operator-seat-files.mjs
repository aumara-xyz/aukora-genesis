/**
 * The exact file set one root-owned operator review seat needs, read from a pinned commit.
 *
 * The installed issuer opens its approval carrier before taking its lease, so it cannot start
 * until something serves the configured approval socket. The only thing that serves it is
 * `scripts/launchd-operator-review.mjs`, and that entry refuses
 * `aukora:operator-review:invocation-tree-untrusted` unless every ancestor of its own directory
 * is root-owned without group or world write. No such tree existed, so the seat could not be run
 * at all. This module computes what has to be staged into one.
 *
 * Two properties separate this from copying a checkout. Source bytes come from
 * `git cat-file` at one resolved commit, never from the working tree, so an unrelated dirty
 * edit cannot reach the staged artifact. Dependency bytes come from
 * {@link snapshotAuthorityDependencies}, which reads through pnpm's symlinks with
 * `realpathSync` and refuses anything that is not an exact regular file, so no staged entry
 * can resolve back into a user-writable checkout. The manifest names both the commit and each
 * dependency's version and per-file digest, which is what makes the staged root attributable.
 *
 * This module stages the existing seat. It is not a launcher and holds no approval logic: the
 * entry, its protocol, its custody checks and its fail-closed startup are staged unchanged.
 *
 * @module
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

import { canonicalJSON } from '../aukora/kernel-seed/canonical-json.mjs'
import { snapshotAuthorityDependencies } from './launchd-authority-dependencies.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/** The checkout this module runs from. Source bytes never come from here; dependency bytes do. */
export const REPO_DIR = resolve(HERE, '..')

/** Repository-relative entry whose closure is staged. */
export const OPERATOR_SEAT_ENTRY = 'scripts/launchd-operator-review.mjs'

/** Manifest domain for a staged seat. Distinct from the authority manifest so the two roots can never be confused. */
export const OPERATOR_SEAT_MANIFEST_DOMAIN = 'aukora:operator-seat-files:v1'

/** Directory trees a staged seat module may come from. Anything else refuses. */
const SEAT_SOURCE_ROOTS = Object.freeze(['scripts/', 'aukora/'])

/** Refusal reasons, kept machine-readable in the installer's style. */
export const SEAT_FILES_REFUSE = Object.freeze({
  REPOSITORY_UNEXPECTED: 'seat-files:repository-unexpected',
  REVISION_INVALID: 'seat-files:revision-invalid',
  REVISION_UNRESOLVED: 'seat-files:revision-unresolved',
  BLOB_UNREADABLE: 'seat-files:blob-unreadable',
  BLOB_NOT_REGULAR: 'seat-files:blob-not-regular',
  MODULE_OUTSIDE_SEAT_ROOTS: 'seat-files:module-outside-seat-roots',
  UNSUPPORTED_MODULE: 'seat-files:unsupported-module',
  DYNAMIC_IMPORT_UNRESOLVABLE: 'seat-files:dynamic-import-unresolvable',
  CONSUMER_ABSENT: 'seat-files:consumer-absent',
  CLOSURE_LIMIT_EXCEEDED: 'seat-files:closure-limit-exceeded',
})

/** One refusal carrying a stable reason alongside its message. */
export class SeatFilesError extends Error {
  /**
   * @param {string} reason - one `SEAT_FILES_REFUSE` value.
   * @param {string} detail - operator-readable detail; never raw file bytes.
   */
  constructor(reason, detail) {
    super(`${reason}: ${detail}`)
    this.name = 'SeatFilesError'
    this.reason = reason
  }
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

/**
 * The only environment a pinned Git read runs under.
 *
 * This is an allowlist, not a scrub. Git takes its repository, object store, index and
 * configuration from the environment — `GIT_DIR`, `GIT_OBJECT_DIRECTORY`,
 * `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_INDEX_FILE`, `GIT_WORK_TREE`, `GIT_CONFIG_*` and more —
 * and every one of them outranks `-C <repo>`. Inheriting the ambient environment therefore let an
 * ambient variable decide which repository a "pinned" read consulted. Naming what may pass keeps
 * a variable nobody has thought of yet from deciding it, which a denylist cannot.
 *
 * @param {string} [home] - value for `HOME`; only pinned local reads use the default.
 * @returns {Record<string, string>} the complete environment for one Git invocation.
 */
export function pinnedGitEnv(home = tmpdir()) {
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: home,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '',
    LANG: 'C',
    LC_ALL: 'C',
  }
}

/**
 * Run one Git plumbing command against this checkout and return raw stdout.
 *
 * Buffer encoding is required: `git cat-file blob` emits the object's exact bytes, and decoding
 * them as text would corrupt any source file that is not valid UTF-8.
 *
 * @param {readonly string[]} args - plumbing arguments after `-C <repo>`.
 * @param {Buffer} [input] - stdin for batch plumbing; `encoding: 'buffer'` requires bytes, not a string.
 * @returns {Buffer} exact stdout bytes.
 */
function git(args, input = undefined) {
  return execFileSync('git', ['-C', REPO_DIR, ...args], {
    encoding: 'buffer',
    maxBuffer: 256 * 1024 * 1024,
    timeout: 60_000,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    env: pinnedGitEnv(),
    ...(input === undefined ? {} : { input }),
  })
}

/**
 * Require the repository these reads reach to be this module's own checkout.
 *
 * The environment allowlist removes the known redirections; this observes the outcome rather than
 * trusting the enumeration, so a future Git variable that still moved the repository would be
 * caught here instead of silently supplying someone else's objects.
 *
 * @param {{readToplevel?: () => string}} [options] - fixture-injectable resolution, so the refusal can be exercised without a hostile environment.
 * @returns {void}
 * @throws {SeatFilesError} when Git resolves a working tree other than `REPO_DIR`.
 */
export function assertPinnedRepository({ readToplevel } = {}) {
  const read = readToplevel ?? (() => git(['rev-parse', '--show-toplevel']).toString('utf8').trim())
  let toplevel
  try {
    toplevel = read()
  } catch (error) {
    throw new SeatFilesError(SEAT_FILES_REFUSE.REPOSITORY_UNEXPECTED, `${REPO_DIR} is not a Git working tree`, { cause: error })
  }
  // An unresolvable answer is as disqualifying as a wrong one; neither may escape unnamed.
  let resolved
  try {
    resolved = realpathSync(toplevel)
  } catch (error) {
    throw new SeatFilesError(SEAT_FILES_REFUSE.REPOSITORY_UNEXPECTED, `pinned reads resolved ${toplevel}, which does not exist`, { cause: error })
  }
  if (resolved !== realpathSync(REPO_DIR)) {
    throw new SeatFilesError(SEAT_FILES_REFUSE.REPOSITORY_UNEXPECTED, `pinned reads resolved ${toplevel}, not ${REPO_DIR}`)
  }
}

/**
 * Resolve one caller-supplied revision to the exact commit it names.
 *
 * Pinning is the point: the caller may pass a branch or tag for convenience, but everything
 * downstream — closure, manifest, staged-root basename — uses only the resolved 40-hex commit,
 * so the artifact stays attributable after the branch moves.
 *
 * @param {string} revision - any revision this checkout can resolve.
 * @returns {string} the 40-character lowercase commit id.
 * @throws {SeatFilesError} when the revision is malformed or names no commit.
 */
export function resolvePinnedRevision(revision) {
  if (typeof revision !== 'string' || revision === '' || revision.length > 256 || /[\s\0]/u.test(revision)) {
    throw new SeatFilesError(SEAT_FILES_REFUSE.REVISION_INVALID, 'revision must be one non-empty whitespace-free string')
  }
  assertPinnedRepository()
  let resolved
  try {
    resolved = git(['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]).toString('utf8').trim()
  } catch (error) {
    throw new SeatFilesError(SEAT_FILES_REFUSE.REVISION_UNRESOLVED, `${revision} names no commit in ${REPO_DIR}`, { cause: error })
  }
  if (!/^[0-9a-f]{40}$/u.test(resolved)) {
    throw new SeatFilesError(SEAT_FILES_REFUSE.REVISION_UNRESOLVED, `${revision} did not resolve to one commit id`)
  }
  return resolved
}

/**
 * Require every named path to be a regular file in the commit's tree.
 *
 * `git cat-file -t` reports `blob` for a symlink too, and its content is the link target rather
 * than a module, so a type check alone would stage a symlink's target path as if it were source.
 * The tree entry's mode is the only place that distinction exists: `100644` and `100755` are
 * regular files, `120000` is a symlink and `160000` a submodule.
 *
 * @param {string} commit - a 40-hex commit id.
 * @param {readonly string[]} paths - repository-relative POSIX paths.
 * @returns {void}
 * @throws {SeatFilesError} when a path is absent or is not a regular file at that commit.
 */
function assertRegularEntries(commit, paths) {
  const listing = git(['ls-tree', '-z', '--full-tree', commit, '--', ...paths]).toString('utf8')
  const modes = new Map()
  for (const record of listing.split('\0')) {
    if (record === '') continue
    const parsed = /^(?<mode>\d{6}) (?<kind>[a-z]+) (?<oid>[0-9a-f]+)\t(?<path>.*)$/su.exec(record)
    if (parsed === null) throw new SeatFilesError(SEAT_FILES_REFUSE.BLOB_UNREADABLE, `unparsable tree record at ${commit}`)
    modes.set(parsed.groups.path, parsed.groups.mode)
  }
  for (const path of paths) {
    const mode = modes.get(path)
    if (mode === undefined) throw new SeatFilesError(SEAT_FILES_REFUSE.BLOB_UNREADABLE, `${path} is absent at ${commit}`)
    if (mode !== '100644' && mode !== '100755') {
      throw new SeatFilesError(SEAT_FILES_REFUSE.BLOB_NOT_REGULAR, `${path} has tree mode ${mode} at ${commit}, not a regular file`)
    }
  }
}

/**
 * Read several repository paths' exact bytes at one resolved commit.
 *
 * `git cat-file --batch` answers every request from one process against one object database
 * view, so a whole closure level costs one spawn rather than two per file and cannot observe a
 * repository that changed midway through.
 *
 * @param {string} commit - a 40-hex commit id from {@link resolvePinnedRevision}.
 * @param {readonly string[]} paths - repository-relative POSIX paths.
 * @returns {Map<string, Buffer>} each path's exact bytes, in request order.
 * @throws {SeatFilesError} when a path is absent at that commit or is not a blob.
 */
export function readPinnedBlobs(commit, paths) {
  if (paths.length === 0) return new Map()
  assertRegularEntries(commit, paths)
  const output = git(['cat-file', '--batch'], Buffer.from(`${paths.map(path => `${commit}:${path}`).join('\n')}\n`, 'utf8'))
  const bytes = new Map()
  let offset = 0
  for (const path of paths) {
    const newline = output.indexOf(0x0a, offset)
    if (newline === -1) throw new SeatFilesError(SEAT_FILES_REFUSE.BLOB_UNREADABLE, `${path} produced no header at ${commit}`)
    const header = output.toString('utf8', offset, newline)
    // A missing or ambiguous object answers `<request> missing` / `<request> ambiguous`.
    const parsed = /^(?<oid>[0-9a-f]{40,64}) (?<kind>[a-z]+) (?<size>\d+)$/u.exec(header)
    if (parsed === null) {
      throw new SeatFilesError(SEAT_FILES_REFUSE.BLOB_UNREADABLE, `${path} is absent at ${commit}`)
    }
    const { kind, size } = parsed.groups
    if (kind !== 'blob') {
      throw new SeatFilesError(SEAT_FILES_REFUSE.BLOB_UNREADABLE, `${path} is a ${kind} at ${commit}, not a regular file`)
    }
    const start = newline + 1
    const end = start + Number(size)
    bytes.set(path, output.subarray(start, end))
    offset = end + 1
  }
  return bytes
}

/**
 * Read one repository path's exact bytes at a resolved commit.
 *
 * @param {string} commit - a 40-hex commit id from {@link resolvePinnedRevision}.
 * @param {string} path - repository-relative POSIX path.
 * @returns {Buffer} the blob's exact bytes.
 * @throws {SeatFilesError} when the path is absent at that commit or is not a blob.
 */
export function readPinnedBlob(commit, path) {
  return readPinnedBlobs(commit, [path]).get(path)
}

/**
 * Every module specifier one source file imports or re-exports.
 *
 * TypeScript's parser is used rather than a regular expression because a specifier inside a
 * comment or string literal must not be followed, and a missed real import would be staged
 * nowhere and then resolve, if at all, against a developer checkout. A dynamic `import()` whose
 * argument is not a literal cannot be resolved statically at all, so it refuses here instead of
 * producing a closure that is quietly incomplete.
 *
 * @param {string} source - module text.
 * @param {string} path - repository-relative path, for refusal messages.
 * @returns {string[]} specifiers in source order, duplicates preserved.
 */
export function moduleSpecifiers(source, path) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const specifiers = []
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
      if (!ts.isStringLiteral(node.moduleSpecifier)) {
        throw new SeatFilesError(SEAT_FILES_REFUSE.DYNAMIC_IMPORT_UNRESOLVABLE, `${path} declares a non-literal module specifier`)
      }
      specifiers.push(node.moduleSpecifier.text)
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments
      if (argument === undefined || !ts.isStringLiteral(argument)) {
        throw new SeatFilesError(SEAT_FILES_REFUSE.DYNAMIC_IMPORT_UNRESOLVABLE, `${path} calls import() with a non-literal specifier`)
      }
      specifiers.push(argument.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return specifiers
}

/** Whether one repository-relative path is inside a directory the seat may be assembled from. */
const insideSeatRoots = (path) => SEAT_SOURCE_ROOTS.some(root => path.startsWith(root))

/**
 * Walk the seat entry's transitive relative-import closure at one commit.
 *
 * @param {string} commit - a 40-hex commit id.
 * @returns {{nodes: Array<{path: string, bytes: Buffer, sha256: string}>, externalEdges: Array<{from: string, specifier: string}>}}
 *   staged source files sorted by path, and the non-relative specifiers they reach.
 * @throws {SeatFilesError} when a module leaves the permitted roots, is not `.mjs`, or the closure runs away.
 */
export function operatorSeatClosure(commit) {
  const visited = new Set()
  const nodes = []
  const externalEdges = []
  // Breadth-first by frontier so each level is one `cat-file --batch` spawn against one
  // repository view, rather than two spawns per module against as many views.
  let frontier = [OPERATOR_SEAT_ENTRY]
  while (frontier.length > 0) {
    for (const path of frontier) {
      visited.add(path)
      if (!insideSeatRoots(path)) {
        throw new SeatFilesError(SEAT_FILES_REFUSE.MODULE_OUTSIDE_SEAT_ROOTS, `${path} is outside ${SEAT_SOURCE_ROOTS.join(' and ')}`)
      }
      if (extname(path) !== '.mjs') {
        throw new SeatFilesError(SEAT_FILES_REFUSE.UNSUPPORTED_MODULE, `${path} is not an .mjs module`)
      }
    }
    if (visited.size > 512) throw new SeatFilesError(SEAT_FILES_REFUSE.CLOSURE_LIMIT_EXCEEDED, 'seat closure exceeds 512 modules')
    const level = readPinnedBlobs(commit, frontier)
    const next = new Set()
    for (const path of frontier) {
      const bytes = level.get(path)
      nodes.push({ path, bytes, sha256: sha256(bytes) })
      for (const specifier of moduleSpecifiers(bytes.toString('utf8'), path)) {
        if (specifier.startsWith('node:')) continue
        if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
          externalEdges.push({ from: path, specifier })
          continue
        }
        const target = posix.normalize(posix.join(posix.dirname(path), specifier))
        if (target.startsWith('../')) {
          throw new SeatFilesError(SEAT_FILES_REFUSE.MODULE_OUTSIDE_SEAT_ROOTS, `${path} imports ${specifier}, which leaves the repository`)
        }
        if (!visited.has(target)) next.add(target)
      }
    }
    frontier = [...next].sort()
  }
  nodes.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  return { nodes, externalEdges }
}

/**
 * Name and version every package in a staged dependency set.
 *
 * Each package's `package.json` is itself staged and digested, so its version is already pinned
 * by that digest. Naming it here as well makes the artifact attributable by reading rather than
 * by recomputation: an operator can see which versions a staged root carries without unpacking it.
 *
 * @param {ReadonlyArray<{path: string, bytes: Buffer}>} dependencyFiles - files from `snapshotAuthorityDependencies`.
 * @returns {Array<{name: string, version: string}>} one entry per package, sorted by name.
 */
function stagedDependencyVersions(dependencyFiles) {
  const versions = new Map()
  for (const file of dependencyFiles) {
    // A package root's manifest is `node_modules/<name>/package.json`; nested manifests belong to
    // files inside the package and are not the package's own identity.
    const parsed = /^node_modules\/(?<name>@[^/]+\/[^/]+|[^/@][^/]*)\/package\.json$/u.exec(file.path)
    if (parsed === null) continue
    const { version } = JSON.parse(file.bytes.toString('utf8'))
    if (typeof version !== 'string' || version === '') {
      throw new SeatFilesError(SEAT_FILES_REFUSE.BLOB_UNREADABLE, `${file.path} declares no version`)
    }
    versions.set(parsed.groups.name, version)
  }
  return [...versions].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([name, version]) => ({ name, version }))
}

/**
 * The complete staged seat: pinned sources, complete dependency packages, and a manifest.
 *
 * Source bytes are pinned to `commit`. Dependency bytes are not in Git, so they are captured from
 * this checkout's installed packages and pinned instead by version and per-file digest, which the
 * manifest records alongside the commit. Both halves are therefore attributable, by different
 * means, and the manifest digest is the staged root's required basename.
 *
 * @param {string} revision - any revision this checkout resolves; recorded as its exact commit.
 * @returns {{commit: string, files: ReadonlyArray<{path: string, bytes: Buffer, sha256: string}>, manifest: string, manifestSha256: string}}
 *   the file set excluding `manifest.json` itself, plus the canonical manifest and its digest.
 */
export function operatorSeatFiles(revision) {
  const commit = resolvePinnedRevision(revision)
  const { nodes, externalEdges } = operatorSeatClosure(commit)
  const imports = externalEdges.map(({ from, specifier }) => {
    const consumerPath = join(REPO_DIR, from)
    return { specifier, consumerPath }
  })
  for (const { consumerPath } of imports) {
    // snapshotAuthorityDependencies resolves through the consumer's real path, so the module must
    // exist in this checkout even though its staged bytes come from the commit.
    try {
      readPinnedBlob(commit, consumerPath.slice(REPO_DIR.length + 1))
    } catch (error) {
      throw new SeatFilesError(SEAT_FILES_REFUSE.CONSUMER_ABSENT, `${consumerPath} cannot anchor dependency resolution`, { cause: error })
    }
  }
  const dependencyFiles = snapshotAuthorityDependencies(imports)
  const files = [...nodes, ...dependencyFiles]
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  const manifest = canonicalJSON({
    domain: OPERATOR_SEAT_MANIFEST_DOMAIN,
    entry: OPERATOR_SEAT_ENTRY,
    sourceCommit: commit,
    dependencies: stagedDependencyVersions(dependencyFiles),
    files: files.map(({ path, sha256: digest }) => ({ path, sha256: digest })),
  })
  return { commit, files, manifest, manifestSha256: sha256(manifest) }
}
