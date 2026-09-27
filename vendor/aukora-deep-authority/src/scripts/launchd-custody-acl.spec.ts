import childProcess, { type SpawnSyncReturns } from 'node:child_process'
import { lstatSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertNoExtendedAcl, assertNoExtendedAclAncestors } from './launchd-custody-acl.mjs'

const nativeSpawn = childProcess.spawnSync
const roots: string[] = []
const unobserved = { reason: 'launchd-install:acl-unobserved' }
const present = { reason: 'launchd-install:extended-acl-present' }

function fixture(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'aukora-custody-acl-')))
  roots.push(root)
  const path = join(root, 'protected file')
  writeFileSync(path, 'private\n', { mode: 0o600 })
  return path
}

function listing(path: string): SpawnSyncReturns<string> {
  const result = nativeSpawn('/bin/ls', ['-ldeniT', '--', path], {
    encoding: 'utf8', env: { LANG: 'C', LC_ALL: 'C' },
  })
  expect(result.status).toBe(0)
  expect(result.signal).toBeNull()
  expect(result.stderr).toBe('')
  return result
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe.skipIf(process.platform !== 'darwin')('strict macOS custody ACL observation', () => {
  it('accepts native ACL absence without altering the entry', () => {
    const path = fixture()
    const before = lstatSync(path, { bigint: true })
    assertNoExtendedAcl(path)
    const after = lstatSync(path, { bigint: true })
    expect([after.ino, after.mode, after.ctimeNs]).toEqual([before.ino, before.mode, before.ctimeNs])
  })

  it.each([
    ' 0: user:other allow write,append,delete',
    ' 0: group:everyone deny delete',
  ])('refuses the extended ACL entry %s', (entry) => {
    const path = fixture()
    const result = listing(path)
    vi.spyOn(childProcess, 'spawnSync').mockReturnValue({ ...result, stdout: `${result.stdout}${entry}\n` })
    expect(() => { assertNoExtendedAcl(path) }).toThrow(expect.objectContaining({ ...present, path }))
  })

  it('refuses an ACL marker even when its detail is missing', () => {
    const path = fixture()
    const result = listing(path)
    const stdout = result.stdout.replace(/^([0-9]+ [rwxStTsd-]{10})@?/u, '$1+')
    vi.spyOn(childProcess, 'spawnSync').mockReturnValue({ ...result, stdout })
    expect(() => { assertNoExtendedAcl(path) }).toThrow(expect.objectContaining(present))
  })

  it.each([
    { status: 1, stderr: 'ls: Permission denied\n' },
    { status: 0, stderr: 'ls: access warning\n' },
    { status: 0, signal: 'SIGTERM' as const },
    { error: Object.assign(new Error('denied'), { code: 'EACCES' }) },
    { error: Object.assign(new Error('output overflow'), { code: 'ENOBUFS' }) },
    { stdout: '' },
    { stdout: 'unrecognized listing\n' },
  ])('fails closed on an unavailable native observation: %j', (failure) => {
    const path = fixture()
    vi.spyOn(childProcess, 'spawnSync').mockReturnValue({ ...listing(path), ...failure })
    expect(() => { assertNoExtendedAcl(path) }).toThrow(expect.objectContaining(unobserved))
  })

  it.each(['inode', 'owner', 'mode', 'path', 'detail', 'truncated'])('refuses mismatched %s output', (mismatch) => {
    const path = fixture()
    const result = listing(path)
    let stdout = result.stdout
    switch (mismatch) {
      case 'inode': stdout = stdout.replace(/^[0-9]+/u, '0'); break
      case 'owner': stdout = stdout.replace(/^(\S+\s+\S+\s+\S+\s+)\S+/u, '$1999999'); break
      case 'mode': stdout = stdout.replace(/-rw-------/u, '-rw-rw-rw-'); break
      case 'path': stdout = stdout.replace(path, `${path}.other`); break
      case 'detail': stdout += 'unparsed access metadata\n'; break
      case 'truncated': stdout = stdout.slice(0, -1); break
    }
    vi.spyOn(childProcess, 'spawnSync').mockReturnValue({ ...result, stdout })
    expect(() => { assertNoExtendedAcl(path) }).toThrow(expect.objectContaining(unobserved))
  })

  it('refuses an inode replacement during the native observation', () => {
    const path = fixture()
    const result = listing(path)
    vi.spyOn(childProcess, 'spawnSync').mockImplementation(() => {
      renameSync(path, `${path}.old`)
      writeFileSync(path, 'replacement\n', { mode: 0o600 })
      return result
    })
    expect(() => { assertNoExtendedAcl(path) }).toThrow(expect.objectContaining(unobserved))
  })

  it('does not classify missing, ambiguous, or linked paths as ACL absence', () => {
    const path = fixture()
    const directory = dirname(path)
    const link = join(directory, 'linked')
    symlinkSync(path, link)
    const realDirectory = join(directory, 'real')
    mkdirSync(realDirectory)
    writeFileSync(join(realDirectory, 'leaf'), '')
    const alias = join(directory, 'alias')
    symlinkSync(realDirectory, alias)
    const command = vi.spyOn(childProcess, 'spawnSync')
    for (const candidate of [`${path}.missing`, 'relative', `${directory}/../leaf`, `${path}\n`, link, join(alias, 'leaf')]) {
      expect(() => { assertNoExtendedAcl(candidate) }).toThrow(expect.objectContaining(unobserved))
    }
    expect(command).not.toHaveBeenCalled()
  })

  it('observes every ancestor in root-to-leaf order with exact shell-free arguments', () => {
    const path = fixture()
    const command = vi.spyOn(childProcess, 'spawnSync')
    assertNoExtendedAclAncestors(path)
    const expected = [path]
    while (dirname(expected.at(-1)!) !== expected.at(-1)) expected.push(dirname(expected.at(-1)!))
    expect(command.mock.calls.map(call => call[1])).toEqual(expected.reverse().map(entry => ['-ldeniT', '--', entry]))
    for (const call of command.mock.calls) {
      expect(call[0]).toBe('/bin/ls')
      expect(call[2]).toEqual({ encoding: 'utf8', env: { LANG: 'C', LC_ALL: 'C' }, timeout: 5_000, maxBuffer: 64 * 1024 })
    }
  })

  it('refuses a parent ACL even when the leaf has no ACL', () => {
    const path = fixture()
    const parent = dirname(path)
    vi.spyOn(childProcess, 'spawnSync').mockImplementation((command, args, options) => {
      const result = nativeSpawn(command, args, options)
      return args?.[2] === parent
        ? { ...result, stdout: `${String(result.stdout)} 0: group:everyone allow delete_child\n` }
        : result
    })
    expect(() => { assertNoExtendedAclAncestors(path) }).toThrow(expect.objectContaining({ ...present, path: parent }))
  })
})
