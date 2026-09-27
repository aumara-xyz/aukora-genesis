import childProcess from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const nativeSpawn = childProcess.spawnSync
const installerUrl = new URL('./install-launchd-custody-pair.mjs', import.meta.url)
const roots: string[] = []
const servers: Server[] = []
const refusal = { name: 'CustodyPairError', reason: 'launchd-install:extended-acl-present' }

interface CustodyFunctions {
  assertFileCustody(path: string, uid: number, gid: number, mode: number): void
  assertTrustedExecutable(path: string): void
  assertRootManagedDirectory(path: string): void
  ensureDirectory(path: string, options: { uid: number; gid: number; mode: number; apply: boolean }): void
  observeSocket(path: string, uid: number, gid: number): Promise<{ uid: number; gid: number; mode: string }>
}

function root(): string {
  const directory = realpathSync(mkdtempSync(join(realpathSync('/tmp'), 'aukora-acl-integration-')))
  roots.push(directory)
  return directory
}

/** Expose actual private functions in a temporary module without changing their bodies. */
async function installer(removeFileCheck = false): Promise<CustodyFunctions> {
  let source = readFileSync(installerUrl, 'utf8')
  if (removeFileCheck) {
    const start = source.indexOf('function assertFileCustody(')
    const end = source.indexOf('\n/**', start)
    const body = source.slice(start, end)
    const call = '  assertAclCustody(path, true)\n'
    expect(body.split(call)).toHaveLength(2)
    source = source.slice(0, start) + body.replace(call, '') + source.slice(end)
  }
  source = source.replace(/from '(\.[^']+)'/gu, (_match, specifier: string) => (
    `from ${JSON.stringify(new URL(specifier, installerUrl).href)}`
  ))
  const originalHere = 'const HERE = dirname(fileURLToPath(import.meta.url))'
  expect(source).toContain(originalHere)
  source = source.replace(originalHere, `const HERE = ${JSON.stringify(dirname(fileURLToPath(installerUrl)))}`)
  source += '\nexport { assertFileCustody, assertTrustedExecutable, assertRootManagedDirectory, ensureDirectory, observeSocket }\n'
  const path = join(root(), 'installer.mjs')
  writeFileSync(path, source)
  return await import(pathToFileURL(path).href) as CustodyFunctions
}

/** Supply an ACL fixture after the native listing has established the entry's identity. */
function grantFixture(path: string): void {
  vi.spyOn(childProcess, 'spawnSync').mockImplementation((command, args, options) => {
    expect(command).toBe('/bin/ls')
    const result = nativeSpawn(command, args, options)
    return args?.[2] === path
      ? { ...result, stdout: `${String(result.stdout)} 0: group:everyone allow write,delete\n` }
      : result
  })
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    if (!server.listening) { resolve(); return }
    server.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    })
  })))
  for (const directory of roots.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe.skipIf(process.platform !== 'darwin')('installer ACL custody integration', () => {
  it('accepts a real no-ACL file with its existing POSIX custody', async () => {
    const subject = await installer()
    const path = join(root(), 'state-key')
    writeFileSync(path, 'test-key', { mode: 0o600 })
    const state = lstatSync(path)
    expect(() => { subject.assertFileCustody(path, state.uid, state.gid, 0o600) }).not.toThrow()
  })

  it('keeps the POSIX owner refusal before ACL admission', async () => {
    const subject = await installer()
    const path = join(root(), 'state-key')
    writeFileSync(path, 'test-key', { mode: 0o600 })
    const state = lstatSync(path)
    const probe = vi.spyOn(childProcess, 'spawnSync')
    expect(() => { subject.assertFileCustody(path, state.uid + 1, state.gid, 0o600) })
      .toThrow(expect.objectContaining({ reason: 'launchd-install:path-custody-mismatch' }))
    expect(probe).not.toHaveBeenCalled()
  })

  it('refuses the ACL fixture through the real file check and detects removal of that call', async () => {
    const subject = await installer()
    const mutant = await installer(true)
    const path = join(root(), 'state-key')
    writeFileSync(path, 'test-key', { mode: 0o600 })
    const state = lstatSync(path)
    grantFixture(path)
    const requiresAclRefusal = (candidate: CustodyFunctions): void => {
      expect(() => { candidate.assertFileCustody(path, state.uid, state.gid, 0o600) })
        .toThrow(expect.objectContaining(refusal))
    }
    requiresAclRefusal(subject)
    expect(() => { requiresAclRefusal(mutant) }).toThrow(expect.objectContaining({ name: 'AssertionError' }))
  })

  it('preserves the named ACL refusal when checking an existing directory', async () => {
    const subject = await installer()
    const path = root()
    const state = lstatSync(path)
    grantFixture(path)
    expect(() => {
      subject.ensureDirectory(path, { uid: state.uid, gid: state.gid, mode: state.mode & 0o777, apply: false })
    }).toThrow(expect.objectContaining(refusal))
  })

  it('refuses a parent ACL fixture before creating a directory', async () => {
    const subject = await installer()
    const parent = root()
    const path = join(parent, 'not-created')
    const state = lstatSync(parent)
    grantFixture(parent)
    expect(() => {
      subject.ensureDirectory(path, { uid: state.uid, gid: state.gid, mode: 0o700, apply: true })
    }).toThrow(expect.objectContaining(refusal))
    expect(existsSync(path)).toBe(false)
  })

  it.each([
    ['assertRootManagedDirectory', '/private/var/db'],
    ['assertTrustedExecutable', '/usr/bin/true'],
  ] as const)('checks native root custody and refuses an ACL fixture in %s', async (method, path) => {
    const subject = await installer()
    expect(() => { subject[method](path) }).not.toThrow()
    grantFixture(path)
    expect(() => { subject[method](path) }).toThrow(expect.objectContaining(refusal))
  })

  it('preserves the named ACL refusal when observing a real route socket', async () => {
    const subject = await installer()
    const path = join(root(), 'route.sock')
    const server = createServer()
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(path, () => { server.off('error', reject); resolve() })
    })
    chmodSync(path, 0o660)
    const state = lstatSync(path)
    await expect(subject.observeSocket(path, state.uid, state.gid))
      .resolves.toEqual({ uid: state.uid, gid: state.gid, mode: '0660' })
    grantFixture(path)
    await expect(subject.observeSocket(path, state.uid, state.gid)).rejects.toMatchObject(refusal)
  })

  it('keeps access errors as unobserved ACL failures through the installer', async () => {
    const subject = await installer()
    const path = root()
    const state = lstatSync(path)
    vi.spyOn(childProcess, 'spawnSync').mockReturnValue({
      pid: 0, output: [], stdout: '', stderr: 'permission denied', status: 1, signal: null,
    })
    expect(() => {
      subject.ensureDirectory(path, { uid: state.uid, gid: state.gid, mode: state.mode & 0o777, apply: false })
    }).toThrow(expect.objectContaining({ name: 'CustodyPairError', reason: 'launchd-install:acl-unobserved' }))
  })
})
