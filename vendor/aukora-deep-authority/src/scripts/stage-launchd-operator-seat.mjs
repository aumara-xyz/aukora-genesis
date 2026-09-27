#!/usr/bin/env node
/**
 * Publish or verify one root-owned operator review seat, staged from a pinned commit.
 *
 * The seat entry refuses to attach unless every ancestor of its own directory is root-owned
 * without group or world write. A checkout in a home directory fails that on the home directory
 * and `/private/tmp` fails it on mode `1777`, so before this command there was nowhere on a host
 * to run the seat from, and therefore no way to serve the approval socket the installed issuer
 * opens at startup. This publishes exactly such a tree.
 *
 * It stages the existing seat and nothing else. The review protocol, the operator custody checks,
 * the approval group rules and the issuer's fail-closed startup are all staged unchanged; this
 * command never starts a service, never connects to a route, and never approves anything.
 *
 * The content address binds bytes, not trust. The staged root's basename equals the manifest
 * digest and the manifest names the source commit, every dependency's name and version, and every
 * file digest — which lets any reader confirm WHAT was staged, and establishes nothing about who
 * staged it or whether the owner approved them doing so. A digest this program computed about its
 * own output cannot admit that program to privileged publication.
 *
 * So `--apply` takes the same invocation-custody admission as the installer's `--apply`:
 * {@link assertInvocationTree} must find every ancestor of the running installation path
 * root-owned without group or world write, and it runs before the revision is read, before
 * dependencies are snapshotted, and before any filesystem effect. The owner-authorized bootstrap
 * that satisfies it is the one already documented for the installer in `ops/launchd/README.md`:
 * the owner places the installation path root-owned and runs the privileged command from there.
 * That prerequisite is a custody gate on the executing path, not an attestation of its bytes, and
 * the report says so rather than implying the digest closed it.
 *
 * `--check` deliberately does not take the gate, so it stays available unprivileged and
 * read-only — and for that reason a passing `--check` says nothing about whether `--apply` will
 * be admitted. Its report carries that caveat instead of an implied approval.
 *
 * ```
 * node scripts/stage-launchd-operator-seat.mjs --revision <rev> --root <absolute> --check
 * sudo node scripts/stage-launchd-operator-seat.mjs --revision <rev> --root <absolute> --apply
 * ```
 */

import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CUSTODY_PAIR_REFUSE,
  CustodyPairError,
  assertInvocationTree,
  assertRootManagedDirectory,
  ensureDirectory,
  publishStagedRoot,
} from './install-launchd-custody-pair.mjs'
import {
  OPERATOR_SEAT_ENTRY,
  REPO_DIR,
  SeatFilesError,
  operatorSeatClosure,
  operatorSeatFiles,
  pinnedGitEnv,
  resolvePinnedRevision,
} from './launchd-operator-seat-files.mjs'
import { snapshotAuthorityDependencies } from './launchd-authority-dependencies.mjs'

/** Managed parent the seat root must be one direct child of. */
export const SEAT_PARENT = '/private/var/db/aukora/seat'

const usage = 'usage: stage-launchd-operator-seat.mjs --revision <rev> '
  + '(--prepare <absolute> | --root <absolute> (--apply | --check))'

/**
 * File names a staged root must never contain.
 *
 * The staged set is tracked `.mjs` sources plus complete npm packages, so a match means the
 * closure reached something it should not. Refusing by name is a cheap backstop against a key or
 * environment file arriving through a dependency, not a substitute for reviewing what is staged.
 */
const CREDENTIAL_NAMES = /(^|\/)(\.env(\..*)?|id_[a-z0-9]+|.*\.(pem|key|p12|pfx|keystore|jks))$/iu

/**
 * Require the seat root to be one direct, content-addressed child of the managed parent.
 *
 * @param {string} root - operator-supplied absolute path.
 * @param {string} manifestSha256 - digest the basename must equal.
 * @returns {void}
 * @throws {CustodyPairError} when the path is not normalized, not absolute, not a direct child, or not content-addressed.
 */
export function assertSeatRoot(root, manifestSha256) {
  if (typeof root !== 'string' || !isAbsolute(root) || normalize(root) !== root) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.MANAGED_PATH_REQUIRED, 'seat root must be one absolute normalized path')
  }
  if (dirname(root) !== SEAT_PARENT) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.MANAGED_PATH_REQUIRED, `seat root must be one direct child of ${SEAT_PARENT}`)
  }
  if (basename(root) !== manifestSha256) {
    throw new CustodyPairError(
      CUSTODY_PAIR_REFUSE.IMPLEMENTATION_CONFLICT,
      `seat root basename must equal the seat manifest digest ${manifestSha256}`,
    )
  }
}

/**
 * Refuse a staged set containing a credential-shaped path.
 *
 * @param {ReadonlyArray<{path: string}>} files - the staged file set.
 * @returns {void}
 * @throws {CustodyPairError} naming every offending path.
 */
export function assertNoCredentialPaths(files) {
  const offending = files.map(file => file.path).filter(path => CREDENTIAL_NAMES.test(path))
  if (offending.length > 0) {
    throw new CustodyPairError(
      CUSTODY_PAIR_REFUSE.IMPLEMENTATION_CONFLICT,
      `credential-shaped paths refused: ${offending.join(', ')}`,
    )
  }
}

/** Report whether this checkout has uncommitted changes, so the report can say the staged bytes are not these. */
function workingTreeDirty() {
  const out = execFileSync('git', ['-C', REPO_DIR, 'status', '--porcelain'], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  })
  return out.trim() !== ''
}

/**
 * Packages the prepared installation path needs beyond the pinned sources.
 *
 * `typescript` is what the stager parses the seat closure with, and the `@noble` packages have to
 * resolve from inside the prepared tree so the stager running there snapshots them locally rather
 * than reaching back into whatever checkout prepared it. Both arrive as byte copies: no package
 * manager runs, so no install hook runs either, privileged or not.
 */
const PREPARED_TOOLCHAIN = Object.freeze(['typescript'])

/** Paths a prepared installation path must never carry, whatever the source checkout holds. */
const PREPARED_FORBIDDEN = /(^|\/)(\.env(\..*)?|\.npmrc|\.netrc|\.ssh|node_modules\/\.pnpm)(\/|$)/u

/**
 * Git invocation environment for preparation: one policy, shared with the pinned reads.
 *
 * {@link pinnedGitEnv} is an allowlist, so repository and object pointers such as `GIT_DIR`,
 * `GIT_OBJECT_DIRECTORY` and `GIT_ALTERNATE_OBJECT_DIRECTORIES` cannot arrive from the ambient
 * environment here either. Preparation supplies its own throwaway `HOME` so the fetch cannot
 * reach the user's configuration or credential helpers.
 *
 * @param {string} home - throwaway home directory for this preparation.
 * @returns {Record<string, string>} the complete environment for one Git invocation.
 */
function preparedGitEnv(home) {
  return pinnedGitEnv(home)
}

/** Run one Git command for preparation, with no inherited configuration. */
function preparedGit(args, home) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    timeout: 300_000,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: preparedGitEnv(home),
  })
}

/**
 * Require a destination this command may create as a fresh prepared path.
 *
 * @param {string} destination - operator-supplied absolute path.
 * @returns {void}
 * @throws {CustodyPairError} when the path is relative, unnormalized, already present, or nested in a place that would confuse it with another artifact.
 */
export function assertPreparedDestination(destination) {
  if (typeof destination !== 'string' || !isAbsolute(destination) || normalize(destination) !== destination) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.MANAGED_PATH_REQUIRED, 'prepared path must be one absolute normalized path')
  }
  if (existsSync(destination)) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.IMPLEMENTATION_CONFLICT, `${destination} already exists; prepare into a new path`)
  }
  const inside = (parent) => {
    const rel = relative(parent, destination)
    return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
  }
  if (inside(REPO_DIR)) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.STATE_INSIDE_CHECKOUT, 'prepared path must be outside the checkout preparing it')
  }
  if (inside(SEAT_PARENT)) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.MANAGED_PATH_REQUIRED, `prepared path must not sit under ${SEAT_PARENT}, which holds staged seats`)
  }
}

/**
 * Check out exactly one commit into a fresh, independent repository.
 *
 * A shallow fetch over `file://` is used rather than a local clone because a local clone links or
 * hardlinks into the source object store, which is the tie back to the preparing checkout this
 * path exists to break. The result carries no alternates, no remote-tracking branches beyond the
 * fetched tip, and an empty template so none of the user's hooks arrive with it.
 *
 * @param {string} destination - absolute path to create.
 * @param {string} commit - a 40-hex commit id.
 * @param {string} source - repository to fetch the commit from.
 * @returns {void}
 * @throws {CustodyPairError} when the populated head is not the pinned commit.
 */
function populatePinnedPath(destination, commit, source) {
  const home = mkdtempSync(join(realpathSync(tmpdir()), 'aukora-prepare-home-'))
  try {
    const template = join(home, 'empty-template')
    mkdirSync(template)
    preparedGit(['init', '-q', `--template=${template}`, destination], home)
    // Only the trees the stager itself runs from need to exist as files; every other path in the
    // commit stays reachable through the object store, which is what `git cat-file` reads.
    preparedGit(['-C', destination, 'sparse-checkout', 'set', '--cone', 'scripts', 'aukora'], home)
    preparedGit(['-C', destination, 'fetch', '-q', '--depth', '1', '--no-tags', `file://${source}`, commit], home)
    preparedGit(['-C', destination, 'checkout', '-q', '--detach', 'FETCH_HEAD'], home)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
  const head = preparedGit(['-C', destination, 'rev-parse', 'HEAD'], tmpdir()).trim()
  if (head !== commit) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.IMPLEMENTATION_CONFLICT, `prepared path resolved ${head}, not the pinned ${commit}`)
  }
}

/** Copy one package directory as exact bytes, refusing anything that is not a regular file or directory. */
function copyPackageBytes(from, to) {
  const files = []
  const walk = (source, target) => {
    mkdirSync(target, { recursive: true })
    for (const name of readdirSync(source).sort()) {
      const entry = lstatSync(join(source, name))
      if (entry.isDirectory()) {
        walk(join(source, name), join(target, name))
      } else if (entry.isFile()) {
        const bytes = readFileSync(join(source, name))
        writeFileSync(join(target, name), bytes)
        chmodSync(join(target, name), 0o644)
        files.push({ path: join(target, name), bytes })
      } else {
        // A symlink or device inside a staged package is the tie back this preparation removes.
        throw new CustodyPairError(CUSTODY_PAIR_REFUSE.PATH_SYMLINK, `${join(source, name)} is not a regular file or directory`)
      }
    }
  }
  walk(from, to)
  return files
}

/**
 * Put every package the prepared stager imports inside the prepared path, as bytes.
 *
 * @param {string} destination - the prepared path.
 * @param {string} commit - the pinned commit, whose closure names the packages to resolve.
 * @param {string} source - checkout whose installed packages supply the bytes.
 * @returns {Array<{name: string, version: string, files: number}>} one record per package, sorted by name.
 */
function materialisePreparedDependencies(destination, commit, source) {
  const { externalEdges } = operatorSeatClosure(commit)
  // The authority snapshot already resolves through pnpm's links with realpathSync and refuses
  // anything that is not an exact regular file, so reuse it rather than re-deriving resolution.
  const snapshot = snapshotAuthorityDependencies(externalEdges.map(({ from, specifier }) => ({
    specifier,
    consumerPath: join(source, from),
  })))
  for (const file of snapshot) {
    const target = join(destination, file.path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, file.bytes)
    chmodSync(target, 0o644)
  }
  const packages = new Map()
  for (const file of snapshot) {
    const parsed = /^node_modules\/(?<name>@[^/]+\/[^/]+|[^/@][^/]*)\//u.exec(file.path)
    if (parsed === null) continue
    packages.set(parsed.groups.name, (packages.get(parsed.groups.name) ?? 0) + 1)
  }
  for (const name of PREPARED_TOOLCHAIN) {
    const from = realpathSync(join(source, 'node_modules', name))
    packages.set(name, copyPackageBytes(from, join(destination, 'node_modules', name)).length)
  }
  return [...packages].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([name, files]) => ({
      name,
      version: String(JSON.parse(readFileSync(join(destination, 'node_modules', name, 'package.json'), 'utf8')).version),
      files,
    }))
}

/**
 * Refuse a prepared path that still reaches outside itself.
 *
 * @param {string} destination - the prepared path.
 * @returns {{symlinks: number}} what was observed, for the report.
 * @throws {CustodyPairError} on an alternates file, an escaping symlink, or a forbidden path.
 */
export function assertPreparedTreeSelfContained(destination) {
  if (existsSync(join(destination, '.git', 'objects', 'info', 'alternates'))) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.IMPLEMENTATION_CONFLICT, 'prepared path borrows objects from another repository')
  }
  if (existsSync(join(destination, '.git', 'worktrees'))) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.IMPLEMENTATION_CONFLICT, 'prepared path carries nested worktree registrations')
  }
  let symlinks = 0
  const visit = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = join(directory, name)
      const rel = relative(destination, absolute).split(sep).join('/')
      if (PREPARED_FORBIDDEN.test(rel)) {
        throw new CustodyPairError(CUSTODY_PAIR_REFUSE.IMPLEMENTATION_CONFLICT, `prepared path carries ${rel}`)
      }
      const entry = lstatSync(absolute)
      if (entry.isSymbolicLink()) {
        symlinks++
        // Tracked links such as CLAUDE.md -> AGENTS.md are fine; one that leaves the prepared
        // path would reach whatever prepared it, which is the tie this check exists to catch.
        const target = resolve(dirname(absolute), readlinkSync(absolute))
        const outside = relative(destination, target)
        if (outside.startsWith(`..${sep}`) || outside === '..' || isAbsolute(outside)) {
          throw new CustodyPairError(CUSTODY_PAIR_REFUSE.PATH_SYMLINK, `${rel} resolves outside the prepared path`)
        }
        continue
      }
      if (entry.isDirectory()) visit(absolute)
    }
  }
  visit(destination)
  return { symlinks }
}

/**
 * Build one pinned, self-contained installation path, unprivileged.
 *
 * This is the bootstrap `--apply` refuses without: the operator places the result root-owned and
 * runs the privileged command from there. Preparation itself needs no privilege, runs no package
 * manager and therefore no install hook, and takes its sources from the commit rather than from
 * the working tree, so an uncommitted edit in the preparing checkout cannot reach it.
 *
 * The final check is the load-bearing one: the prepared path computes the seat manifest with its
 * own stager, its own `typescript` and its own dependency copies, and that digest must equal the
 * one computed here. A prepared path that cannot reproduce the digest is refused, not reported.
 *
 * @param {{revision: string, destination: string, source?: string}} request - pinned revision and where to build.
 * @returns {Readonly<object>} the machine-readable preparation report.
 */
export function prepareInstallationPath({ revision, destination, source = REPO_DIR }) {
  const commit = resolvePinnedRevision(revision)
  assertPreparedDestination(destination)
  const expected = operatorSeatFiles(commit)
  let observed
  try {
    populatePinnedPath(destination, commit, source)
    const dependencies = materialisePreparedDependencies(destination, commit, source)
    const { symlinks } = assertPreparedTreeSelfContained(destination)
    // The prepared stager sanitizes its own Git reads, but it is launched here; passing the
    // allowlist rather than this process's environment keeps an ambient pointer from reaching it
    // before its own guard runs.
    const preparedDigest = execFileSync(process.execPath, [
      '--input-type=module',
      '-e',
      `import { operatorSeatFiles } from ${JSON.stringify(join(destination, 'scripts', 'launchd-operator-seat-files.mjs'))}\n`
      + 'process.stdout.write(operatorSeatFiles(process.argv[1]).manifestSha256)',
      commit,
    ], {
      encoding: 'utf8', cwd: destination, timeout: 300_000, maxBuffer: 16 * 1024 * 1024,
      env: { ...pinnedGitEnv(), NODE_OPTIONS: '' },
    }).trim()
    if (preparedDigest !== expected.manifestSha256) {
      throw new CustodyPairError(
        CUSTODY_PAIR_REFUSE.IMPLEMENTATION_CONFLICT,
        `prepared path computes ${preparedDigest}, not ${expected.manifestSha256}`,
      )
    }
    observed = { dependencies, symlinks, preparedDigest }
  } catch (error) {
    // A half-built path must not be mistaken for a prepared one.
    rmSync(destination, { recursive: true, force: true })
    throw error
  }
  return Object.freeze({
    ok: true,
    status: 'OPERATOR_PATH_PREPARED',
    preparedPath: destination,
    sourceCommit: commit,
    seatManifestSha256: observed.preparedDigest,
    dependencies: observed.dependencies,
    internalSymlinks: observed.symlinks,
    privileged: false,
    packageInstallHooksRun: 0,
    blockers: [
      // Preparation establishes reproducibility, never custody: the path is still owned by the
      // unprivileged user who built it until the operator places it root-owned.
      'prepared-path-not-yet-root-owned',
      'attended-seat-attachment-not-performed',
    ],
  })
}

/**
 * Admit this installation path to privileged publication, or refuse naming the bootstrap.
 *
 * This is the installer's own gate, not a second one: {@link assertInvocationTree} requires every
 * ancestor of the running path to be root-owned without group or world write. The refusal keeps
 * that mechanism's reason so callers match one string, and adds the documented remedy, because an
 * operator who hits this needs to know the prerequisite exists rather than look for a flag.
 *
 * There is deliberately no override. A path that cannot be admitted does not publish.
 *
 * @param {() => void} admit - the admission check; injectable so a test can prove ordering.
 * @returns {void}
 * @throws {CustodyPairError} `launchd-install:invocation-tree-untrusted` when the path is untrusted.
 */
export function admitInstallationPath(admit = assertInvocationTree) {
  try {
    admit()
  } catch (error) {
    if (error instanceof CustodyPairError && error.reason === CUSTODY_PAIR_REFUSE.INVOCATION_TREE_UNTRUSTED) {
      // CustodyPairError already prefixes its reason, so carry only the inner detail forward.
      const detail = error.message.startsWith(`${error.reason} — `)
        ? error.message.slice(error.reason.length + 3)
        : error.message
      throw new CustodyPairError(
        CUSTODY_PAIR_REFUSE.INVOCATION_TREE_UNTRUSTED,
        `${detail}. Privileged publication requires the bootstrap documented in ops/launchd/README.md: `
        + 'place this installation path root-owned without group or world write, and run --apply from there. '
        + 'The manifest digest states which bytes would be staged; it is not approval to stage them.',
      )
    }
    throw error
  }
}

/**
 * Compute the seat file set, then publish or verify it at `root`.
 *
 * @param {{revision: string, root: string, apply: boolean, platform?: string, euid?: number}} request - operator inputs.
 * @returns {Readonly<object>} the machine-readable staging report.
 */
export function runOperatorSeatStaging({ revision, root, apply, platform = process.platform, euid = process.geteuid?.(), admit = assertInvocationTree }) {
  if (typeof apply !== 'boolean') {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.FIELD_INVALID, 'apply must be one explicit boolean')
  }
  // Admission precedes every read and every effect. Deciding to publish, and only then asking
  // whether the path that decided was trusted, is the defect this ordering exists to prevent:
  // an untrusted path must not reach a revision, a dependency snapshot, or the filesystem.
  if (apply) {
    if (platform !== 'darwin') {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.PLATFORM_UNSUPPORTED, 'staging a root-owned seat requires macOS')
    }
    if (euid !== 0) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.ROOT_REQUIRED, 'publishing a root-owned seat requires uid 0')
    }
    admitInstallationPath(admit)
  }

  const staged = operatorSeatFiles(revision)
  assertNoCredentialPaths(staged.files)
  assertSeatRoot(root, staged.manifestSha256)

  const expectedFiles = new Map(staged.files.map(file => [file.path, file]))
  expectedFiles.set('manifest.json', {
    path: 'manifest.json',
    bytes: Buffer.from(staged.manifest),
    sha256: staged.manifestSha256,
  })

  const present = existsSync(root)
  const report = {
    ok: true,
    status: apply ? 'OPERATOR_SEAT_STAGED' : 'OPERATOR_SEAT_CHECKED',
    apply,
    entry: OPERATOR_SEAT_ENTRY,
    sourceCommit: staged.commit,
    workingTreeDirty: workingTreeDirty(),
    seatRoot: root,
    manifestSha256: staged.manifestSha256,
    files: expectedFiles.size,
    sourceFiles: staged.files.filter(file => !file.path.startsWith('node_modules/')).length,
    dependencyFiles: staged.files.filter(file => file.path.startsWith('node_modules/')).length,
    presentBeforeRun: present,
    seatEntryPath: join(root, OPERATOR_SEAT_ENTRY),
    blockers: [
      apply
        // Admission established custody of the executing path, not provenance of its bytes: the
        // owner authorized placing that path root-owned, and nothing attests what it contains.
        ? 'installation-path-bytes-unattested'
        // --check takes no admission gate, so passing here is not a prediction that --apply will
        // be admitted. It reports what would be staged, never that staging is permitted.
        : 'check-mode-admission-not-taken',
      // Staging makes the seat runnable. It does not seat anyone: attendance is a separate,
      // attended step through the unchanged operator entry.
      'attended-seat-attachment-not-performed',
    ],
  }

  if (!apply) {
    if (!present) return Object.freeze({ ...report, verified: false, detail: `${root} is absent; --apply publishes it` })
    publishStagedRoot(root, expectedFiles, false)
    return Object.freeze({ ...report, verified: true })
  }

  // The managed parent may only be created below a directory that is already root-owned and
  // unwritable by group or other, matching how the installer admits its own managed parents.
  assertRootManagedDirectory(dirname(SEAT_PARENT))
  ensureDirectory(SEAT_PARENT, { uid: 0, gid: 0, mode: 0o755, apply: true })
  publishStagedRoot(root, expectedFiles, true)
  return Object.freeze({ ...report, verified: true })
}

/** CLI entry. */
export function main(argv = process.argv.slice(2)) {
  const revisionAt = argv.indexOf('--revision')
  const prepareAt = argv.indexOf('--prepare')
  const rootAt = argv.indexOf('--root')
  const apply = argv.includes('--apply')
  const check = argv.includes('--check')
  const value = (at) => at === -1 || argv[at + 1] === undefined || argv[at + 1].startsWith('--') ? undefined : argv[at + 1]
  const revision = value(revisionAt)
  if (revision === undefined) throw new CustodyPairError(CUSTODY_PAIR_REFUSE.ARGUMENTS_NOT_EXACT, usage)

  if (prepareAt !== -1) {
    const destination = value(prepareAt)
    if (argv.length !== 4 || destination === undefined || apply || check || rootAt !== -1) {
      throw new CustodyPairError(CUSTODY_PAIR_REFUSE.ARGUMENTS_NOT_EXACT, usage)
    }
    return prepareInstallationPath({ revision, destination })
  }

  const root = value(rootAt)
  if (argv.length !== 5 || root === undefined || apply === check) {
    throw new CustodyPairError(CUSTODY_PAIR_REFUSE.ARGUMENTS_NOT_EXACT, usage)
  }
  return runOperatorSeatStaging({ revision, root, apply })
}

if (process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(main())}\n`)
  } catch (error) {
    const reason = error instanceof CustodyPairError || error instanceof SeatFilesError
      ? error.reason
      : CUSTODY_PAIR_REFUSE.HOST_OBSERVATION_FAILED
    process.stderr.write(`${JSON.stringify({ ok: false, reason, detail: String(error?.message ?? error) })}\n`)
    process.exitCode = 1
  }
}
