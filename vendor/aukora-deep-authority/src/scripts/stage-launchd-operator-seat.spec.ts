/**
 * Operator-seat staging: what the artifact must contain, and what it must refuse.
 *
 * The load-bearing test is `runs the real entry from a staged root with no access to the
 * checkout`. A closure computed by parsing can be wrong in one direction that matters — a missed
 * import is staged nowhere and then resolves, if at all, against a developer checkout — so
 * completeness is established by executing the staged entry from a directory outside this
 * repository, and the two counterfactuals prove that check can fail.
 *
 * Root ownership is the one property these tests cannot establish: a suite running as an ordinary
 * user cannot chown to root, and asserting it against a self-owned fixture would prove nothing.
 * Those claims are listed UNRUN at the end of this file rather than mocked.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  OPERATOR_SEAT_ENTRY,
  OPERATOR_SEAT_MANIFEST_DOMAIN,
  REPO_DIR,
  assertPinnedRepository,
  moduleSpecifiers,
  operatorSeatClosure,
  operatorSeatFiles,
  pinnedGitEnv,
  readPinnedBlob,
  resolvePinnedRevision,
} from './launchd-operator-seat-files.mjs'
import {
  SEAT_PARENT,
  admitInstallationPath,
  assertNoCredentialPaths,
  assertPreparedDestination,
  assertPreparedTreeSelfContained,
  assertSeatRoot,
  main,
  prepareInstallationPath,
  runOperatorSeatStaging,
} from './stage-launchd-operator-seat.mjs'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

/** A scratch directory outside the repository, so a staged tree cannot reach this checkout's modules. */
function scratch(prefix: string): string {
  const root = mkdtempSync(join(realpathSync(tmpdir()), prefix))
  roots.push(root)
  return root
}

/** Write one computed seat file set into a scratch root. Ownership stays this user's; see UNRUN below. */
function materialise(root: string, revision = 'HEAD'): ReturnType<typeof operatorSeatFiles> {
  const staged = operatorSeatFiles(revision)
  for (const file of [...staged.files, { path: 'manifest.json', bytes: Buffer.from(staged.manifest), sha256: staged.manifestSha256 }]) {
    const target = join(root, file.path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, file.bytes)
  }
  return staged
}

const head = (): string => execFileSync('git', ['-C', REPO_DIR, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()

describe('pinned revision reads', () => {
  it('resolves a symbolic revision to the exact commit it names', () => {
    expect(resolvePinnedRevision('HEAD')).toBe(head())
    expect(resolvePinnedRevision(head())).toBe(head())
  })

  it.each([['empty', ''], ['whitespace', 'HEAD main'], ['nul', 'HEAD\0'], ['unknown', 'refs/heads/no-such-branch-here']])(
    'refuses a %s revision', (_label, revision) => {
      expect(() => resolvePinnedRevision(revision)).toThrow(/seat-files:revision-(invalid|unresolved)/u)
    })

  it('reads blob bytes from the commit rather than the working tree', () => {
    const bytes = readPinnedBlob(head(), OPERATOR_SEAT_ENTRY)
    expect(bytes.toString('utf8')).toContain('assertOperatorInvocationTree')
  })

  it('refuses a directory, which carries a tree mode rather than a regular-file mode', () => {
    expect(() => readPinnedBlob(head(), 'scripts')).toThrow(/seat-files:blob-not-regular/u)
  })

  it('refuses a path absent at that commit', () => {
    expect(() => readPinnedBlob(head(), 'scripts/no-such-module.mjs')).toThrow(/seat-files:blob-unreadable/u)
  })

  it('refuses a symlink, which git reports as a blob whose content is its target path', () => {
    // `.agents/notes/implemented/CLAUDE.md` is tracked at mode 120000; `cat-file -t` calls it a
    // blob, so only the tree mode distinguishes it from a module.
    const records = execFileSync('git', ['-C', REPO_DIR, 'ls-tree', '-r', head()], { encoding: 'utf8' })
      .split('\n').filter(line => line.startsWith('120000 '))
    expect(records.length, 'the repository must still track a symlink for this test to mean anything').toBeGreaterThan(0)
    const record = records[0] as string
    const path = record.slice(record.indexOf('\t') + 1)
    expect(() => readPinnedBlob(head(), path)).toThrow(/seat-files:blob-not-regular/u)
  })

  it('ignores an uncommitted edit to a staged module', () => {
    const before = operatorSeatFiles('HEAD')
    const entry = join(REPO_DIR, OPERATOR_SEAT_ENTRY)
    const original = readFileSync(entry)
    try {
      writeFileSync(entry, Buffer.concat([original, Buffer.from('\n// uncommitted probe\n')]))
      const after = operatorSeatFiles('HEAD')
      expect(after.manifestSha256).toBe(before.manifestSha256)
    } finally {
      writeFileSync(entry, original)
    }
  })
})

describe('module specifier scanning', () => {
  it('finds specifiers a line-oriented scan misses', () => {
    const source = [
      'import {',
      '  alpha,',
      '} from "./multi-line.mjs"',
      'export { beta } from "./re-exported.mjs"',
      'import "./side-effect.mjs"',
      'const text = "./inside-a-string.mjs"',
      '// import "./inside-a-comment.mjs"',
    ].join('\n')
    expect(moduleSpecifiers(source, 'probe.mjs')).toStrictEqual(['./multi-line.mjs', './re-exported.mjs', './side-effect.mjs'])
  })

  it('accepts a dynamic import with a literal specifier', () => {
    expect(moduleSpecifiers('await import("./lazy.mjs")', 'probe.mjs')).toStrictEqual(['./lazy.mjs'])
  })

  it('refuses a dynamic import whose specifier cannot be resolved statically', () => {
    expect(() => moduleSpecifiers('await import(name)', 'probe.mjs')).toThrow(/seat-files:dynamic-import-unresolvable/u)
  })
})

describe('the staged file set', () => {
  it('contains the seat entry, its closure and complete dependency packages', () => {
    const staged = operatorSeatFiles('HEAD')
    const paths = staged.files.map(file => file.path)
    expect(paths).toContain(OPERATOR_SEAT_ENTRY)
    expect(paths).toContain('scripts/launchd-issuer-review.mjs')
    expect(paths).toContain('aukora/supervisor/issuer-approval-bridge.mjs')
    expect(paths).toContain('aukora/issuer/approval-carrier.mjs')
    expect(paths.some(path => path.startsWith('node_modules/@noble/curves/'))).toBe(true)
    expect(paths.some(path => path.startsWith('node_modules/@noble/post-quantum/'))).toBe(true)
  })

  it('stages no symlink and no directory entry', () => {
    const { nodes } = operatorSeatClosure(head())
    expect(nodes.every(node => node.path.endsWith('.mjs'))).toBe(true)
    expect(new Set(nodes.map(node => node.path)).size).toBe(nodes.length)
  })

  it('names its source commit, its dependency versions and every file digest in the manifest', () => {
    const staged = operatorSeatFiles('HEAD')
    const manifest = JSON.parse(staged.manifest) as {
      domain: string
      sourceCommit: string
      entry: string
      dependencies: { name: string; version: string }[]
      files: { path: string; sha256: string }[]
    }
    expect(manifest.domain).toBe(OPERATOR_SEAT_MANIFEST_DOMAIN)
    expect(manifest.sourceCommit).toBe(head())
    expect(manifest.entry).toBe(OPERATOR_SEAT_ENTRY)
    expect(manifest.files).toHaveLength(staged.files.length)
    // Attribution to dependencies is what makes the artifact readable without unpacking it.
    expect(manifest.dependencies.map(entry => entry.name)).toContain('@noble/curves')
    expect(manifest.dependencies.map(entry => entry.name)).toContain('@noble/post-quantum')
    expect(manifest.dependencies.every(entry => /^\d+\.\d+\.\d+/u.test(entry.version))).toBe(true)
  })

  it('is deterministic for one commit', () => {
    expect(operatorSeatFiles('HEAD').manifestSha256).toBe(operatorSeatFiles(head()).manifestSha256)
  })

  it('carries a manifest domain distinct from the installed authority manifest', () => {
    expect(OPERATOR_SEAT_MANIFEST_DOMAIN).not.toBe('aukora:installed-authority-files:v1')
  })
})

describe('artifact completeness', () => {
  it('runs the real entry from a staged root with no access to the checkout', () => {
    const root = scratch('seat-complete-')
    materialise(root)
    const out = execFileSync(process.execPath, [join(root, OPERATOR_SEAT_ENTRY), '--help'], { encoding: 'utf8', cwd: root })
    expect(out).toContain('--approval-group')
    expect(out).toContain('No service restarts or automatic approvals')
  })

  it.each([
    ['a source module', 'aukora/supervisor/issuer-approval-bridge.mjs'],
    ['a dependency package', 'node_modules/@noble/curves'],
  ])('fails to load when %s is missing from the staged root', (_label, victim) => {
    const root = scratch('seat-incomplete-')
    materialise(root)
    renameSync(join(root, victim), join(root, 'displaced'))
    expect(() => execFileSync(process.execPath, [join(root, OPERATOR_SEAT_ENTRY), '--help'], { encoding: 'utf8', cwd: root, stdio: 'pipe' }))
      .toThrow(/ERR_MODULE_NOT_FOUND/u)
  })
})

describe('staged root custody rules', () => {
  const digest = 'a'.repeat(64)

  it('requires the basename to equal the manifest digest', () => {
    expect(() => assertSeatRoot(join(SEAT_PARENT, digest), digest)).not.toThrow()
    expect(() => assertSeatRoot(join(SEAT_PARENT, 'b'.repeat(64)), digest)).toThrow(/basename must equal/u)
  })

  it.each([
    ['relative', 'seat/root'],
    ['unnormalised', `${SEAT_PARENT}/../seat/${digest}`],
    ['nested deeper than one child', `${SEAT_PARENT}/extra/${digest}`],
    ['outside the managed parent', `/private/tmp/${digest}`],
  ])('refuses a %s seat root', (_label, root) => {
    expect(() => assertSeatRoot(root, digest)).toThrow()
  })

  it.each([['dotenv', '.env'], ['private key', 'node_modules/x/test/fixture.pem'], ['ssh key', 'node_modules/x/id_ed25519']])(
    'refuses a staged set containing a %s path', (_label, path) => {
      expect(() => assertNoCredentialPaths([{ path }])).toThrow(/credential-shaped paths refused/u)
    })

  it('passes the real staged set, which contains no credential-shaped path', () => {
    expect(() => assertNoCredentialPaths(operatorSeatFiles('HEAD').files)).not.toThrow()
  })
})

describe('the staging command', () => {
  it('reports the required root and stays read-only when it is absent', () => {
    const staged = operatorSeatFiles('HEAD')
    const report = runOperatorSeatStaging({ revision: 'HEAD', root: join(SEAT_PARENT, staged.manifestSha256), apply: false })
    expect(report.status).toBe('OPERATOR_SEAT_CHECKED')
    expect(report.sourceCommit).toBe(head())
    expect(report.manifestSha256).toBe(staged.manifestSha256)
    expect(report.verified).toBe(false)
    expect(existsSync(join(SEAT_PARENT, staged.manifestSha256))).toBe(false)
  })

  it('keeps its residual limits on every report', () => {
    const staged = operatorSeatFiles('HEAD')
    const report = runOperatorSeatStaging({ revision: 'HEAD', root: join(SEAT_PARENT, staged.manifestSha256), apply: false })
    expect(report.blockers).toContain('check-mode-admission-not-taken')
    expect(report.blockers).toContain('attended-seat-attachment-not-performed')
    // The retired label claimed an untrusted stager could still publish. It cannot.
    expect(report.blockers).not.toContain('stager-invocation-tree-untrusted')
  })

  it('refuses to publish without root even on a correctly named root', () => {
    const staged = operatorSeatFiles('HEAD')
    expect(() => runOperatorSeatStaging({
      revision: 'HEAD', root: join(SEAT_PARENT, staged.manifestSha256), apply: true, platform: 'darwin', euid: 501,
    })).toThrow(/uid 0/u)
  })

  it('refuses to publish off Darwin', () => {
    const staged = operatorSeatFiles('HEAD')
    expect(() => runOperatorSeatStaging({
      revision: 'HEAD', root: join(SEAT_PARENT, staged.manifestSha256), apply: true, platform: 'linux', euid: 0,
    })).toThrow(/requires macOS/u)
  })

  it.each([
    ['no mode', ['--revision', 'HEAD', '--root', '/x', '--nope']],
    ['both modes', ['--revision', 'HEAD', '--root', '--apply', '--check']],
    ['missing root', ['--revision', 'HEAD', '--check']],
    ['extra arguments', ['--revision', 'HEAD', '--root', '/x', '--check', '--apply']],
  ])('refuses %s', (_label, argv) => {
    expect(() => main(argv)).toThrow()
  })
})

describe('invocation-custody admission on privileged publication', () => {
  const digest = (): string => operatorSeatFiles('HEAD').manifestSha256

  it('refuses --apply from this checkout, which is not a trusted installation path', () => {
    // The suite runs from a home-directory worktree, so the real gate must refuse here. If this
    // ever passes, the test has stopped measuring anything and the gate has stopped applying.
    let thrown: { reason?: string; message: string } | undefined
    try {
      runOperatorSeatStaging({ revision: 'HEAD', root: join(SEAT_PARENT, digest()), apply: true, platform: 'darwin', euid: 0 })
    } catch (error) {
      thrown = error as { reason?: string; message: string }
    }
    expect(thrown?.reason).toBe('launchd-install:invocation-tree-untrusted')
  })

  it('names the documented bootstrap in the refusal instead of offering an override', () => {
    let message = ''
    try {
      runOperatorSeatStaging({ revision: 'HEAD', root: join(SEAT_PARENT, digest()), apply: true, platform: 'darwin', euid: 0 })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('ops/launchd/README.md')
    expect(message).toContain('root-owned')
    // A digest the program computed about its own output is not approval to publish it.
    expect(message).toContain('not approval')
  })

  it('admits before resolving the revision, so an untrusted path never reads one', () => {
    // An unresolvable revision would refuse `seat-files:revision-unresolved` if computation ran
    // first. Admission refusing instead is the proof that nothing is read before the decision.
    let reason: string | undefined
    try {
      runOperatorSeatStaging({ revision: 'refs/heads/no-such-branch-here', root: join(SEAT_PARENT, 'a'.repeat(64)), apply: true, platform: 'darwin', euid: 0 })
    } catch (error) {
      reason = (error as { reason?: string }).reason
    }
    expect(reason).toBe('launchd-install:invocation-tree-untrusted')
  })

  it('admits before any filesystem effect, leaving the managed parent absent', () => {
    expect(existsSync(SEAT_PARENT), 'this host must not already carry a staged seat parent').toBe(false)
    expect(() => runOperatorSeatStaging({
      revision: 'HEAD', root: join(SEAT_PARENT, digest()), apply: true, platform: 'darwin', euid: 0,
    })).toThrow()
    expect(existsSync(SEAT_PARENT)).toBe(false)
  })

  it('reaches publication only once admission has passed', () => {
    // The decisive pair. With the real gate the refusal is the admission itself; with an injected
    // gate that accepts, the same call gets past admission and refuses later, on the managed
    // parent it is not actually privileged to create. One call, two refusals, in that order.
    const root = join(SEAT_PARENT, digest())
    const reasonOf = (admit?: () => void): string | undefined => {
      try {
        runOperatorSeatStaging({ revision: 'HEAD', root, apply: true, platform: 'darwin', euid: 0, ...(admit ? { admit } : {}) })
        return undefined
      } catch (error) {
        return (error as { reason?: string }).reason
      }
    }
    const order: string[] = []
    expect(reasonOf()).toBe('launchd-install:invocation-tree-untrusted')
    const admitted = reasonOf(() => { order.push('admit') })
    expect(order).toStrictEqual(['admit'])
    expect(admitted).not.toBe('launchd-install:invocation-tree-untrusted')
    expect(admitted).toBe('launchd-install:partial-state')
    // Refusing later must still not have produced the directory.
    expect(existsSync(SEAT_PARENT)).toBe(false)
  })

  it('takes no admission gate in --check, keeping unprivileged preparation available', () => {
    const report = runOperatorSeatStaging({ revision: 'HEAD', root: join(SEAT_PARENT, digest()), apply: false })
    expect(report.status).toBe('OPERATOR_SEAT_CHECKED')
    expect(report.blockers).toContain('check-mode-admission-not-taken')
  })

  it('leaves the filesystem untouched in --check', () => {
    const before = existsSync(SEAT_PARENT)
    runOperatorSeatStaging({ revision: 'HEAD', root: join(SEAT_PARENT, digest()), apply: false })
    expect(existsSync(SEAT_PARENT)).toBe(before)
    expect(existsSync(join(SEAT_PARENT, digest()))).toBe(false)
  })

  it('offers no override: admitInstallationPath propagates any refusal it is given', () => {
    const refusal = Object.assign(new Error('probe'), { reason: 'some-other-reason' })
    expect(() => admitInstallationPath(() => { throw refusal })).toThrow('probe')
  })

  it('passes through when the injected admission accepts', () => {
    expect(() => admitInstallationPath(() => { /* admitted */ })).not.toThrow()
  })
})

describe('pinned unprivileged preparation of an installation path', () => {
  // Preparation costs a shallow fetch and a package copy, so the read-only assertions share one
  // prepared path. Nothing here writes to it after it is built.
  let prepared: { parent: string; path: string; report: Record<string, unknown> } | undefined
  // Preparation shells out to Git and copies the toolchain, so it is built once here rather than
  // inside whichever test happens to run first, where it would exceed the default case timeout
  // under parallel load. The destination is a child of a fresh mkdtemp parent rather than a
  // pid-derived name: preparation refuses a destination that already exists, so a run killed
  // before its cleanup would otherwise fail every later run that drew the same pid.
  beforeAll(() => {
    const parent = mkdtempSync(join(realpathSync(tmpdir()), 'aukora-prepared-'))
    const path = join(parent, 'tree')
    const report = prepareInstallationPath({ revision: 'HEAD', destination: path }) as unknown as Record<string, unknown>
    prepared = { parent, path, report }
  }, 300_000)
  const prepare = (): { path: string; report: Record<string, unknown> } => {
    if (prepared === undefined) throw new Error('preparation did not run')
    return prepared
  }
  afterAll(() => { if (prepared !== undefined) rmSync(prepared.parent, { recursive: true, force: true }) })

  it('reports an unprivileged preparation that ran no package install hook', () => {
    const { report } = prepare()
    expect(report.status).toBe('OPERATOR_PATH_PREPARED')
    expect(report.privileged).toBe(false)
    expect(report.packageInstallHooksRun).toBe(0)
    expect(report.sourceCommit).toBe(head())
    expect(report.blockers).toContain('prepared-path-not-yet-root-owned')
  })

  it('pins the checkout to the commit, not the working tree', () => {
    const { path } = prepare()
    const head1 = execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    expect(head1).toBe(head())
    // `operatorSeatFiles` runs `git -C REPO_DIR`, so the prepared path has to BE a repository
    // holding that commit; an unpacked archive would satisfy neither.
    expect(existsSync(join(path, '.git'))).toBe(true)
  })

  it('names every dependency it carries, with versions', () => {
    const { report } = prepare()
    const dependencies = report.dependencies as { name: string; version: string; files: number }[]
    const names = dependencies.map(entry => entry.name)
    expect(names).toContain('typescript')
    expect(names).toContain('@noble/curves')
    expect(names).toContain('@noble/post-quantum')
    expect(dependencies.every(entry => /^\d+\.\d+\.\d+/u.test(entry.version) && entry.files > 0)).toBe(true)
  })

  it('resolves its dependencies inside itself, with nothing linking back to the checkout', () => {
    const { path } = prepare()
    expect(existsSync(join(path, '.git', 'objects', 'info', 'alternates'))).toBe(false)
    const links = execFileSync('find', [path, '-type', 'l'], { encoding: 'utf8' }).split('\n').filter(Boolean)
    for (const link of links) {
      const target = resolve(dirname(link), readlinkSync(link))
      expect(target.startsWith(path), `${link} escapes the prepared path`).toBe(true)
    }
    // pnpm's store layout is the tie back; a prepared path carries real files instead.
    expect(existsSync(join(path, 'node_modules', '.pnpm'))).toBe(false)
    expect(lstatSync(join(path, 'node_modules', 'typescript')).isDirectory()).toBe(true)
    expect(lstatSync(join(path, 'node_modules', '@noble', 'curves')).isDirectory()).toBe(true)
  })

  it('reproduces the seat manifest digest using only its own stager and dependencies', { timeout: 120_000 }, () => {
    const { path, report } = prepare()
    const digest = execFileSync(process.execPath, [
      '--input-type=module', '-e',
      `import { operatorSeatFiles } from ${JSON.stringify(join(path, 'scripts', 'launchd-operator-seat-files.mjs'))}\n`
      + 'process.stdout.write(operatorSeatFiles(process.argv[1]).manifestSha256)',
      head(),
    ], { encoding: 'utf8', cwd: path }).trim()
    expect(digest).toBe(operatorSeatFiles('HEAD').manifestSha256)
    expect(digest).toBe(report.seatManifestSha256)
  })

  it('runs its own seat-stager --check without the preparing checkout on any path', { timeout: 120_000 }, () => {
    const { path, report } = prepare()
    const out = execFileSync(process.execPath, [
      join(path, 'scripts', 'stage-launchd-operator-seat.mjs'),
      '--revision', head(), '--root', join(SEAT_PARENT, String(report.seatManifestSha256)), '--check',
    ], { encoding: 'utf8', cwd: path })
    const parsed = JSON.parse(out) as { status: string; manifestSha256: string; sourceCommit: string }
    expect(parsed.status).toBe('OPERATOR_SEAT_CHECKED')
    expect(parsed.manifestSha256).toBe(report.seatManifestSha256)
    expect(parsed.sourceCommit).toBe(head())
  })

  it('stages a seat whose real entry runs, from the prepared path alone', { timeout: 120_000 }, () => {
    const { path } = prepare()
    const seat = scratch('seat-from-prepared-')
    execFileSync(process.execPath, [
      '--input-type=module', '-e',
      `import { operatorSeatFiles } from ${JSON.stringify(join(path, 'scripts', 'launchd-operator-seat-files.mjs'))}\n`
      + "import { mkdirSync, writeFileSync } from 'node:fs'\n"
      + "import { dirname, join, resolve } from 'node:path'\n"
      + 'const staged = operatorSeatFiles(process.argv[1])\n'
      + 'for (const file of staged.files) {\n'
      + '  const target = join(process.argv[2], file.path)\n'
      + '  mkdirSync(dirname(target), { recursive: true })\n'
      + '  writeFileSync(target, file.bytes)\n'
      + '}',
      head(), seat,
    ], { cwd: path })
    const out = execFileSync(process.execPath, [join(seat, OPERATOR_SEAT_ENTRY), '--help'], { encoding: 'utf8', cwd: seat })
    expect(out).toContain('--approval-group')
  })
})

describe('preparation refusals', () => {
  it.each([
    ['relative', 'prepared/path'],
    ['unnormalised', `${realpathSync(tmpdir())}/../prepared`],
  ])('refuses a %s destination', (_label, destination) => {
    expect(() => assertPreparedDestination(destination)).toThrow()
  })

  it('refuses a destination that already exists', () => {
    expect(() => assertPreparedDestination(scratch('prepared-existing-'))).toThrow(/already exists/u)
  })

  it('refuses a destination inside the checkout preparing it', () => {
    expect(() => assertPreparedDestination(join(REPO_DIR, 'prepared'))).toThrow(/outside the checkout/u)
  })

  it('refuses a destination under the staged-seat parent', () => {
    expect(() => assertPreparedDestination(join(SEAT_PARENT, 'prepared'))).toThrow(/staged seats/u)
  })

  it('refuses a tree that borrows objects from another repository', () => {
    const root = scratch('prepared-alternates-')
    mkdirSync(join(root, '.git', 'objects', 'info'), { recursive: true })
    writeFileSync(join(root, '.git', 'objects', 'info', 'alternates'), `${REPO_DIR}/.git/objects\n`)
    expect(() => assertPreparedTreeSelfContained(root)).toThrow(/borrows objects/u)
  })

  it('refuses a tree whose symlink escapes it', () => {
    const root = scratch('prepared-escape-')
    symlinkSync(REPO_DIR, join(root, 'back-to-checkout'))
    expect(() => assertPreparedTreeSelfContained(root)).toThrow(/resolves outside/u)
  })

  it('accepts a symlink that stays inside the tree', () => {
    const root = scratch('prepared-internal-link-')
    writeFileSync(join(root, 'AGENTS.md'), 'fixture')
    symlinkSync('AGENTS.md', join(root, 'CLAUDE.md'))
    expect(() => assertPreparedTreeSelfContained(root)).not.toThrow()
  })

  it.each([['.env', '.env'], ['npm credentials', '.npmrc'], ['netrc', '.netrc']])(
    'refuses a tree carrying %s', (_label, name) => {
      const root = scratch('prepared-secret-')
      writeFileSync(join(root, name), 'fixture')
      expect(() => assertPreparedTreeSelfContained(root)).toThrow(/carries/u)
    })
})

describe('pinned reads use the intended repository', () => {
  /** A real repository holding a different commit, so a diverted read is visibly wrong rather than merely absent. */
  const decoy = (): { path: string; commit: string } => {
    const path = scratch('decoy-repo-')
    const run = (args: string[]): string =>
      execFileSync('git', ['-C', path, ...args], { encoding: 'utf8', env: pinnedGitEnv() }).trim()
    execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q', path], { env: pinnedGitEnv() })
    writeFileSync(join(path, 'decoy.txt'), 'decoy')
    run(['add', '-A'])
    run(['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '-m', 'decoy'])
    return { path, commit: run(['rev-parse', 'HEAD']) }
  }

  /** Resolve HEAD through the module in a child process carrying one hostile Git variable. */
  const resolveUnder = (variable: string, value: string): string =>
    execFileSync(process.execPath, [
      '--input-type=module', '-e',
      `import { operatorSeatFiles } from ${JSON.stringify(join(REPO_DIR, 'scripts', 'launchd-operator-seat-files.mjs'))}\n`
      + 'process.stdout.write(operatorSeatFiles("HEAD").commit)',
    ], { encoding: 'utf8', cwd: REPO_DIR, env: { ...process.env, [variable]: value } }).trim()

  it('declares an allowlist that names no repository, object, index or work-tree pointer', () => {
    const env = pinnedGitEnv()
    expect(Object.keys(env).sort()).toStrictEqual([
      'GIT_ASKPASS', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_TERMINAL_PROMPT', 'HOME', 'LANG', 'LC_ALL', 'PATH',
    ])
    // The point of an allowlist is that these cannot arrive at all, named or not.
    for (const pointer of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES',
      'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_CEILING_DIRECTORIES', 'GIT_CONFIG_COUNT']) {
      expect(env, `${pointer} must not be carried`).not.toHaveProperty(pointer)
    }
  })

  it.each([
    ['GIT_DIR', '.git'],
    ['GIT_COMMON_DIR', '.git'],
    ['GIT_OBJECT_DIRECTORY', '.git/objects'],
    ['GIT_ALTERNATE_OBJECT_DIRECTORIES', '.git/objects'],
    ['GIT_INDEX_FILE', '.git/index'],
    ['GIT_WORK_TREE', ''],
    ['GIT_CEILING_DIRECTORIES', ''],
  ])('resolves this checkout despite an ambient %s aimed at another repository', (variable, suffix) => {
    const other = decoy()
    expect(other.commit).not.toBe(head())
    const value = suffix === '' ? other.path : join(other.path, suffix)
    expect(resolveUnder(variable, value)).toBe(head())
  }, 60_000)

  it('ignores ambient Git configuration injected through GIT_CONFIG_COUNT', () => {
    const out = execFileSync(process.execPath, [
      '--input-type=module', '-e',
      `import { operatorSeatFiles } from ${JSON.stringify(join(REPO_DIR, 'scripts', 'launchd-operator-seat-files.mjs'))}\n`
      + 'process.stdout.write(operatorSeatFiles("HEAD").commit)',
    ], {
      encoding: 'utf8',
      cwd: REPO_DIR,
      env: { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.bare', GIT_CONFIG_VALUE_0: 'true' },
    }).trim()
    expect(out).toBe(head())
  }, 60_000)

  it('computes the same manifest digest under a hostile ambient environment', () => {
    const other = decoy()
    const digest = (env: NodeJS.ProcessEnv): string => execFileSync(process.execPath, [
      '--input-type=module', '-e',
      `import { operatorSeatFiles } from ${JSON.stringify(join(REPO_DIR, 'scripts', 'launchd-operator-seat-files.mjs'))}\n`
      + 'process.stdout.write(operatorSeatFiles("HEAD").manifestSha256)',
    ], { encoding: 'utf8', cwd: REPO_DIR, env }).trim()
    expect(digest({ ...process.env, GIT_DIR: join(other.path, '.git') })).toBe(digest({ ...process.env }))
  }, 120_000)

  it('refuses when the resolved working tree is not this checkout', () => {
    // A real directory that is simply not this checkout, so the refusal is about identity rather
    // than about the path failing to exist.
    expect(() => assertPinnedRepository({ readToplevel: () => scratch('other-toplevel-') }))
      .toThrow(/seat-files:repository-unexpected/u)
  })

  it('refuses an unresolvable working tree rather than leaking a filesystem error', () => {
    expect(() => assertPinnedRepository({ readToplevel: () => '/private/tmp/no-such-toplevel-here' }))
      .toThrow(/seat-files:repository-unexpected/u)
  })

  it('accepts the checkout it actually runs from', () => {
    expect(() => assertPinnedRepository()).not.toThrow()
  })

  it('refuses when Git reports no working tree at all', () => {
    expect(() => assertPinnedRepository({ readToplevel: () => { throw new Error('not a repository') } }))
      .toThrow(/seat-files:repository-unexpected/u)
  })
})

/**
 * UNRUN — claims this suite deliberately does not make.
 *
 * Establishing any of these needs a real `--apply` as uid 0 on a Darwin host, which a test suite
 * running as an ordinary user cannot perform. A self-owned fixture would satisfy an assertion
 * without establishing the property, so these are left unmeasured rather than mocked:
 *
 * - the published seat root and its directories are `root:wheel 0555` and its files `root:wheel 0444`;
 * - `/private/var/db/aukora/seat` is created `root:wheel 0755` under root-owned ancestors;
 * - a published root carries no extended ACL;
 * - `assertOperatorInvocationTree()` accepts the published root on a real host;
 * - the staged seat, once attached, serves an approval socket the installed issuer connects to.
 *
 * The custody assertions themselves are covered where they are implemented: `publishStagedRoot` is
 * exercised by the installer suite, and the invocation-tree rule by
 * `scripts/launchd-operator-review.spec.ts` through its injectable `stat`.
 */
