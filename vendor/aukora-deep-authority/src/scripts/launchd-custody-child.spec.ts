import { generateKeyPairSync } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import {
  CUSTODY_CHILD_REFUSE,
  exactAbsolutePath,
  probeFileAccess,
  probeSocketAccess,
  provisionBroker,
  provisionIssuerKey,
} from './launchd-custody-child.mjs'

const SCRIPT = fileURLToPath(new URL('./launchd-custody-child.mjs', import.meta.url))
const temporaryDirectories: string[] = []
const servers = new Set<Server>()

function runChild(args: string[], env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env })
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'aukora-launchd-child-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  const closures = [...servers].map(server => new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    })
  }))
  await Promise.all(closures)
  servers.clear()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('launchd custody principal child', () => {
  it('accepts only normalized absolute paths', () => {
    expect(exactAbsolutePath('/private/var/lib/aukora/issuer.key')).toBe('/private/var/lib/aukora/issuer.key')
    expect(() => exactAbsolutePath('issuer.key')).toThrow(
      expect.objectContaining({ reason: CUSTODY_CHILD_REFUSE.PATH_NOT_ABSOLUTE }),
    )
    expect(() => exactAbsolutePath('/private/var/lib/../issuer.key')).toThrow(
      expect.objectContaining({ reason: CUSTODY_CHILD_REFUSE.PATH_NOT_NORMALIZED }),
    )
  })

  it('creates and reloads one exact issuer key without returning private bytes', () => {
    const directory = temporaryDirectory()
    const keyPath = join(directory, 'issuer.key')

    const first = provisionIssuerKey(keyPath)
    const privateBytes = readFileSync(keyPath, 'utf8')
    const second = provisionIssuerKey(keyPath)

    expect(first.rootPublicKeyPem).toContain('BEGIN PUBLIC KEY')
    expect(JSON.stringify(first)).not.toContain('PRIVATE KEY')
    expect(second).toEqual(first)
    expect(readFileSync(keyPath, 'utf8')).toBe(privateBytes)
    expect(lstatSync(keyPath).mode & 0o777).toBe(0o600)
  })

  it('returns only the issuer public key through the executable', () => {
    const keyPath = join(temporaryDirectory(), 'issuer.key')
    const result = runChild(['issuer-key', keyPath])

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).not.toContain('PRIVATE KEY')
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      operation: 'issuer-key',
      euid: process.geteuid?.(),
      egid: process.getegid?.(),
    })
    expect(result.stdout).toContain('BEGIN PUBLIC KEY')
  })

  it('preserves an occupied link and its target', () => {
    const directory = temporaryDirectory()
    const target = join(directory, 'foreign.key')
    const keyPath = join(directory, 'issuer.key')
    const foreign = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    writeFileSync(target, foreign, { mode: 0o600 })
    symlinkSync(target, keyPath)

    expect(() => provisionIssuerKey(keyPath)).toThrow(
      expect.objectContaining({ reason: CUSTODY_CHILD_REFUSE.KEY_STATE_UNOBSERVABLE }),
    )
    expect(lstatSync(keyPath).isSymbolicLink()).toBe(true)
    expect(readFileSync(target, 'utf8')).toBe(foreign)
  })

  it('preserves malformed and overly broad existing key files', () => {
    const directory = temporaryDirectory()
    const malformed = join(directory, 'malformed.key')
    const broad = join(directory, 'broad.key')
    writeFileSync(malformed, 'not a key\n', { mode: 0o600 })
    const foreign = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    writeFileSync(broad, foreign, { mode: 0o640 })
    chmodSync(broad, 0o640)

    expect(() => provisionIssuerKey(malformed)).toThrow(
      expect.objectContaining({ reason: CUSTODY_CHILD_REFUSE.KEY_STATE_MALFORMED }),
    )
    expect(() => provisionIssuerKey(broad)).toThrow(
      expect.objectContaining({ reason: CUSTODY_CHILD_REFUSE.KEY_MODE_UNSAFE }),
    )
    expect(readFileSync(malformed, 'utf8')).toBe('not a key\n')
    expect(readFileSync(broad, 'utf8')).toBe(foreign)
  })

  it('creates and reloads the broker identity through the broker provisioner', () => {
    const stateDir = join(temporaryDirectory(), 'broker-state')

    const first = provisionBroker(stateDir)
    const keyBytes = readFileSync(join(stateDir, 'keys', 'broker.json'), 'utf8')
    const second = provisionBroker(stateDir)

    expect(first.receiptKeyId).toMatch(/^[0-9a-f]{64}$/)
    expect(first.brokerPublicKeyPem).toContain('BEGIN PUBLIC KEY')
    expect(JSON.stringify(first)).not.toContain('PRIVATE KEY')
    expect(second).toEqual(first)
    expect(readFileSync(join(stateDir, 'keys', 'broker.json'), 'utf8')).toBe(keyBytes)
  })

  it('reports no-follow file access without reading contents', () => {
    const directory = temporaryDirectory()
    const file = join(directory, 'secret')
    const link = join(directory, 'secret-link')
    writeFileSync(file, 'must-not-enter-the-result', { mode: 0o600 })
    symlinkSync(file, link)

    expect(probeFileAccess(file)).toEqual({ opened: true, errno: null })
    expect(probeFileAccess(link)).toEqual({ opened: false, errno: 'ELOOP' })
    expect(probeFileAccess(join(directory, 'absent'))).toEqual({ opened: false, errno: 'ENOENT' })
    expect(JSON.stringify(probeFileAccess(file))).not.toContain('must-not-enter-the-result')
  })

  it('reports live and absent Unix-socket reachability', async () => {
    const directory = temporaryDirectory()
    const socketPath = join(directory, 'probe.sock')
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(socketPath, resolve)
    })
    servers.add(server)

    await expect(probeSocketAccess(socketPath)).resolves.toEqual({ connected: true, errno: null })
    await expect(probeSocketAccess(join(directory, 'absent.sock'))).resolves.toEqual({ connected: false, errno: 'ENOENT' })
  })

  it('refuses root key and broker provisioning through the executable', () => {
    const directory = temporaryDirectory()
    const keyPath = join(directory, 'issuer.key')
    const stateDir = join(directory, 'broker-state')
    const preload = join(directory, 'pretend-root.mjs')
    writeFileSync(preload, 'process.geteuid = () => 0\n', { mode: 0o600 })
    const env = {
      ...process.env,
      NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
    }
    const keyResult = runChild(['issuer-key', keyPath], env)
    const brokerResult = runChild(['broker-identity', stateDir], env)

    for (const result of [keyResult, brokerResult]) {
      expect(result.status).toBe(1)
      expect(JSON.parse(result.stderr)).toMatchObject({
        ok: false,
        reason: CUSTODY_CHILD_REFUSE.PROVISION_AS_ROOT,
      })
      expect(result.stdout).toBe('')
    }
    expect(existsSync(keyPath)).toBe(false)
    expect(existsSync(stateDir)).toBe(false)
  })

  it('refuses unknown operations and extra arguments', () => {
    const directory = temporaryDirectory()
    const unknown = runChild(['erase', directory])
    const extra = runChild(['probe-file', directory, 'rider'])

    expect(unknown.status).toBe(1)
    expect(JSON.parse(unknown.stderr)).toMatchObject({
      ok: false,
      reason: CUSTODY_CHILD_REFUSE.OPERATION_UNKNOWN,
    })
    expect(extra.status).toBe(1)
    expect(JSON.parse(extra.stderr)).toMatchObject({
      ok: false,
      reason: CUSTODY_CHILD_REFUSE.ARGUMENTS_NOT_EXACT,
    })
  })
})
