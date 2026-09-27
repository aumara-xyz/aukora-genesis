import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { snapshotAuthorityDependencies, type AuthorityDependencyFile } from './launchd-authority-dependencies.mjs'

const SOURCE_ROOT = fileURLToPath(new URL('../', import.meta.url))
const CONSUMER = join(SOURCE_ROOT, 'aukora/identity/control.mjs')
const SOURCE_FILES = ['identity/control.mjs', 'identity/genesis.mjs', 'identity/validation.mjs', 'kernel-seed/canonical-json.mjs']
const IMPORTS = ['@noble/curves/ed25519.js', '@noble/post-quantum/ml-dsa.js']
  .map(specifier => ({ specifier, consumerPath: CONSUMER }))
const scratchDirectories: string[] = []
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

function scratch() {
  const directory = mkdtempSync(join(tmpdir(), 'a-deps-'))
  scratchDirectories.push(directory)
  return directory
}

function write(path: string, bytes: string | Buffer) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, bytes)
}

function fixture(options: { dependencies?: Record<string, string>; version?: string; value?: string } = {}) {
  const directory = scratch()
  const consumerPath = join(directory, 'consumer.mjs')
  write(consumerPath, '')
  const root = join(directory, 'node_modules/@noble/curves')
  write(join(root, 'package.json'), JSON.stringify({ name: '@noble/curves', version: options.version ?? '2.2.0',
    type: 'module', exports: { '.': './index.js', './ed25519.js': './index.js' }, dependencies: options.dependencies }))
  write(join(root, 'index.js'), `export const marker = ${JSON.stringify(options.value ?? 'original')};\n`)
  write(join(root, 'LICENSE'), 'Synthetic fixture license, not a copied package.\n')
  return { root, consumerPath, imports: [{ specifier: '@noble/curves/ed25519.js', consumerPath }] }
}

function stageDependencies(root: string, files: AuthorityDependencyFile[]) {
  for (const file of files) write(join(root, file.path), file.bytes)
}

function stageControl(root: string) {
  for (const file of SOURCE_FILES) write(join(root, 'aukora', file), readFileSync(join(SOURCE_ROOT, 'aukora', file)))
}

function importControl(root: string) {
  const url = pathToFileURL(join(root, 'aukora/identity/control.mjs')).href
  return spawnSync(process.execPath, ['--input-type=module', '--eval',
    `const control = await import(${JSON.stringify(url)}); process.stdout.write(control.AUMLOK_ROOT_CONTROL_SUITE);`],
  { cwd: root, env: {}, encoding: 'utf8' })
}

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('installed authority dependency bytes', () => {
  it('imports the actual control module using only detached installed bytes', () => {
    const files = snapshotAuthorityDependencies(IMPORTS)
    const names = ['ciphers', 'curves', 'hashes', 'post-quantum']
    expect(files.filter(file => file.path.endsWith('/package.json')).map(file => file.path))
      .toEqual(names.map(name => `node_modules/@noble/${name}/package.json`))
    for (const name of names) expect(files.some(file => file.path === `node_modules/@noble/${name}/LICENSE`)).toBe(true)
    expect(files.map(file => file.path)).toEqual(files.map(file => file.path).sort())
    expect(new Set(files.map(file => file.path)).size).toBe(files.length)
    for (const file of files) expect(file.sha256).toBe(sha256(file.bytes))
    const root = scratch()
    stageDependencies(root, files)
    stageControl(root)
    const result = importControl(root)
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('aumlok-ed25519-ml-dsa-65-v1')
  })

  it('fails the detached control import when its package files are absent', () => {
    const root = scratch()
    stageControl(root)
    const result = importControl(root)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('ERR_MODULE_NOT_FOUND')
  })

  it.each(['@noble/unknown', 'unlisted-package', 'node:crypto', '@noble/curves/../hashes'])('refuses the external import %s', (specifier) => {
    expect(() => snapshotAuthorityDependencies([{ specifier, consumerPath: CONSUMER }])).toThrow(/not-allowed/)
  })

  it('refuses unknown declared runtime dependencies even when the selected entry does not import them', () => {
    const pkg = fixture({ dependencies: { 'unlisted-package': '1.0.0' } })
    expect(() => snapshotAuthorityDependencies(pkg.imports)).toThrow('import-not-allowed')
  })

  it('fails on a missing installed declared dependency', () => {
    const pkg = fixture({ dependencies: { '@noble/hashes': '2.2.0' } })
    // Native Node owns resolution here; Vitest's workspace resolver can supply otherwise missing packages.
    const moduleUrl = new URL('./launchd-authority-dependencies.mjs', import.meta.url).href
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval',
      `import { snapshotAuthorityDependencies } from ${JSON.stringify(moduleUrl)}; snapshotAuthorityDependencies(${JSON.stringify(pkg.imports)});`],
    { cwd: dirname(pkg.consumerPath), env: {}, encoding: 'utf8' })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('dependency-unresolvable')
  })

  it('fails on an unknown exported subpath', () => {
    const pkg = fixture()
    expect(() => snapshotAuthorityDependencies([{ specifier: '@noble/curves/absent.js', consumerPath: pkg.consumerPath }]))
      .toThrow('dependency-unresolvable')
  })

  it('changes the file manifest when an installed dependency file is modified', () => {
    const pkg = fixture()
    const first = snapshotAuthorityDependencies(pkg.imports)
    writeFileSync(join(pkg.root, 'LICENSE'), 'Modified fixture license.\n')
    const second = snapshotAuthorityDependencies(pkg.imports)
    expect(first.map(({ path, sha256: digest }) => ({ path, sha256: digest })))
      .not.toEqual(second.map(({ path, sha256: digest }) => ({ path, sha256: digest })))
    expect(first.find(file => file.path.endsWith('/index.js'))?.sha256)
      .toBe(second.find(file => file.path.endsWith('/index.js'))?.sha256)
  })

  it.each(['version', 'bytes'] as const)('refuses conflicting installed package %s across real consumers', (difference) => {
    const first = fixture()
    const second = fixture(difference === 'version' ? { version: '2.3.0' } : { value: 'different bytes' })
    expect(() => snapshotAuthorityDependencies([...first.imports, ...second.imports])).toThrow('conflicting-package-copies')
  })

  it('deduplicates byte-identical packages resolved from different consumers', () => {
    const first = fixture()
    const second = fixture()
    expect(snapshotAuthorityDependencies([...first.imports, ...second.imports])).toEqual(snapshotAuthorityDependencies(first.imports))
  })

  it('refuses internal links without following their targets', () => {
    const pkg = fixture()
    const target = join(scratch(), 'foreign.txt')
    writeFileSync(target, 'Foreign bytes')
    symlinkSync(target, join(pkg.root, 'linked-file'))
    expect(() => snapshotAuthorityDependencies(pkg.imports)).toThrow('package-entry-not-regular')
    expect(readFileSync(target, 'utf8')).toBe('Foreign bytes')
  })

  it('fails instead of silently excluding a nested node_modules directory', () => {
    const pkg = fixture()
    mkdirSync(join(pkg.root, 'node_modules'))
    expect(() => snapshotAuthorityDependencies(pkg.imports)).toThrow('nested-node-modules')
  })

  it('requires the actual absolute consumer and matching package identity', () => {
    const pkg = fixture()
    expect(() => snapshotAuthorityDependencies([{ specifier: '@noble/curves', consumerPath: 'consumer.mjs' }]))
      .toThrow('consumer-not-absolute')
    writeFileSync(join(pkg.root, 'package.json'), JSON.stringify({ name: '@noble/hashes', version: '2.2.0', main: 'index.js' }))
    expect(() => snapshotAuthorityDependencies([{ specifier: '@noble/curves', consumerPath: pkg.consumerPath }]))
      .toThrow('package-identity-mismatch')
  })
})
