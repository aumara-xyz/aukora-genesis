import { afterEach, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { grantPreimage, payloadDigest, REFUSE, verifyGrant } from '@aukora/core/host-dsh/src/grant.mjs'
import { mintGrant } from '@aukora/core/issuer/mint.mjs'

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const ISSUER_ENTRY = join(REPO_ROOT, 'aukora', 'issuer', 'issuer.mjs')
const RECEIPT_KEY_ID = 'b'.repeat(64)
const DEFINITION_ID = 'd'.repeat(64)
const OPERATION_DIGEST = 'a'.repeat(64)
const GRANT_ARGS = { key: 'algorithm-check', value: { held: true } }

interface SpawnedIssuer {
  child: ChildProcess
  stderr: () => string
}

const children = new Set<ChildProcess>()
const tempDirectories = new Set<string>()

function processOwnership(): { uid: number; gid: number } {
  if (process.geteuid === undefined || process.getegid === undefined) {
    throw new Error('process ownership is unavailable on this platform')
  }
  return { uid: process.geteuid(), gid: process.getegid() }
}

afterEach(async () => {
  await Promise.all([...children].map(stopIssuer))
  children.clear()
  for (const directory of tempDirectories) rmSync(directory, { recursive: true, force: true })
  tempDirectories.clear()
})

function fixture(rootPrivateKey?: KeyObject): { directory: string; keyFile: string; socketPath: string } {
  const directory = mkdtempSync(join(tmpdir(), 'aukora-issuer-custody-'))
  tempDirectories.add(directory)
  const keyFile = join(directory, 'root.pem')
  const privateKey = rootPrivateKey ?? generateKeyPairSync('ed25519').privateKey
  writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  chmodSync(keyFile, 0o600)
  return { directory, keyFile, socketPath: join(directory, 'socket', 'issuer.sock') }
}

function signedGrant(privateKey: KeyObject, nonce: string, now: number): Record<string, unknown> {
  const claims = {
    toolName: 'memory.put',
    digest: payloadDigest('memory.put', GRANT_ARGS),
    nonce,
    exp: Math.floor(now / 1000) + 300,
    definitionId: DEFINITION_ID,
    operationDigest: OPERATION_DIGEST,
    receiptKeyId: RECEIPT_KEY_ID,
  }
  return { ...claims, signature: sign(null, grantPreimage(claims), privateKey).toString('base64') }
}

function verifyWithRoot(grant: Record<string, unknown>, publicKey: KeyObject, now: number): ReturnType<typeof verifyGrant> {
  return verifyGrant({
    grant,
    toolName: 'memory.put',
    args: GRANT_ARGS,
    rootPublicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    seenNonces: new Set(),
    now,
    expectedDefinitionId: DEFINITION_ID,
    expectedOperationDigest: OPERATION_DIGEST,
    expectedReceiptKeyId: RECEIPT_KEY_ID,
  })
}

function spawnIssuer(socketPath: string, keyFile: string, extraEnv: NodeJS.ProcessEnv = {}): SpawnedIssuer {
  const child = spawn(process.execPath, [ISSUER_ENTRY], {
    env: {
      ...process.env,
      AUKORA_ISSUER_SOCKET: socketPath,
      AUKORA_ISSUER_KEY_FILE: keyFile,
      AUKORA_EXPECTED_RECEIPT_KEY_ID: RECEIPT_KEY_ID,
      ...extraEnv,
    },
    stdio: ['pipe', 'ignore', 'pipe'],
  })
  children.add(child)
  let captured = ''
  child.stderr?.on('data', (chunk: Buffer) => { captured += String(chunk) })
  return { child, stderr: () => captured }
}

async function waitForExit(subject: SpawnedIssuer): Promise<number | null> {
  if (subject.child.exitCode !== null) return subject.child.exitCode
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { reject(new Error(`issuer did not exit; stderr=${subject.stderr()}`)) }, 3_000)
    subject.child.once('exit', (code) => {
      clearTimeout(timeout)
      resolve(code)
    })
  })
}

async function stopIssuer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { reject(new Error('issuer did not stop after SIGTERM')) }, 3_000)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
  })
}

async function waitForSocket(subject: SpawnedIssuer, path: string): Promise<void> {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    if (subject.child.exitCode !== null) throw new Error(`issuer exited ${subject.child.exitCode}; stderr=${subject.stderr()}`)
    try {
      if (lstatSync(path).isSocket()) return
    } catch {
      // The listening entry does not exist yet.
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`issuer socket did not appear; stderr=${subject.stderr()}`)
}

async function askUnknownOperation(path: string): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const socket = createConnection(path)
    let response = ''
    socket.once('error', reject)
    socket.once('connect', () => socket.write('{"op":"custody-probe"}\n'))
    socket.on('data', (chunk) => {
      response += String(chunk)
      const cut = response.indexOf('\n')
      if (cut === -1) return
      socket.destroy()
      resolve(JSON.parse(response.slice(0, cut)))
    })
  })
}

describe('issuer entry hardening lifecycle', () => {
  it('refuses root and a root key not owned by the issuer euid', async () => {
    const rootFixture = fixture()
    const rootPreload = join(rootFixture.directory, 'pretend-root.mjs')
    writeFileSync(rootPreload, 'process.geteuid = () => 0\n', { mode: 0o600 })
    const root = spawnIssuer(rootFixture.socketPath, rootFixture.keyFile, {
      NODE_OPTIONS: `--import=${pathToFileURL(rootPreload).href}`,
    })

    await expect(waitForExit(root)).resolves.toBe(1)
    expect(root.stderr()).toContain('issuer must not run as root')
    expect(existsSync(rootFixture.socketPath)).toBe(false)
    expect(existsSync(`${rootFixture.socketPath}.lock`)).toBe(false)

    const ownerFixture = fixture()
    const currentEuid = process.geteuid?.()
    if (currentEuid === undefined) throw new Error('issuer custody test requires POSIX euid support')
    const foreignEuid = currentEuid + 1
    const ownerPreload = join(ownerFixture.directory, 'pretend-foreign-euid.mjs')
    writeFileSync(ownerPreload, `process.geteuid = () => ${foreignEuid}\n`, { mode: 0o600 })
    const foreignOwner = spawnIssuer(ownerFixture.socketPath, ownerFixture.keyFile, {
      NODE_OPTIONS: `--import=${pathToFileURL(ownerPreload).href}`,
    })

    await expect(waitForExit(foreignOwner)).resolves.toBe(1)
    expect(foreignOwner.stderr()).toContain('root key file must be owned by the issuer euid')
    expect(existsSync(ownerFixture.socketPath)).toBe(false)
    expect(existsSync(`${ownerFixture.socketPath}.lock`)).toBe(false)
  })

  it('refuses a root-key symlink before creating a socket or lease', async () => {
    const { directory, keyFile, socketPath } = fixture()
    const keyLink = join(directory, 'root-link.pem')
    symlinkSync(keyFile, keyLink)

    const subject = spawnIssuer(socketPath, keyLink)

    await expect(waitForExit(subject)).resolves.toBe(1)
    expect(subject.stderr()).toContain('root key file must be an exact regular file opened without following links')
    expect(existsSync(socketPath)).toBe(false)
    expect(existsSync(`${socketPath}.lock`)).toBe(false)
  })

  it('refuses a root key with group or other mode bits', async () => {
    const { keyFile, socketPath } = fixture()
    chmodSync(keyFile, 0o640)

    const subject = spawnIssuer(socketPath, keyFile)

    await expect(waitForExit(subject)).resolves.toBe(1)
    expect(subject.stderr()).toContain('root key file must have mode 0600 or stricter')
    expect(existsSync(socketPath)).toBe(false)
    expect(existsSync(`${socketPath}.lock`)).toBe(false)
  })

  it('refuses parsed RSA-512 and EC-P224 private roots before creating a socket or lease', async () => {
    const keypairs = [
      generateKeyPairSync('rsa', { modulusLength: 512 }),
      generateKeyPairSync('ec', { namedCurve: 'secp224r1' }),
    ]

    for (const keypair of keypairs) {
      expect(keypair.privateKey.asymmetricKeyType).not.toBe('ed25519')
      const { keyFile, socketPath } = fixture(keypair.privateKey)
      const subject = spawnIssuer(socketPath, keyFile)

      await expect(waitForExit(subject)).resolves.toBe(1)
      expect(subject.stderr()).toContain('root private key must be Ed25519')
      expect(existsSync(socketPath)).toBe(false)
      expect(existsSync(`${socketPath}.lock`)).toBe(false)
    }
  })

  it('refuses RSA-512 and EC-P224 at the grant signing and verification boundaries', () => {
    const now = Date.now()
    const rsa = generateKeyPairSync('rsa', { modulusLength: 512 })
    const ec = generateKeyPairSync('ec', { namedCurve: 'secp224r1' })
    const ed25519 = generateKeyPairSync('ed25519')

    for (const privateKey of [rsa.privateKey, ec.privateKey]) {
      expect(() => mintGrant({
        rootPrivateKey: privateKey,
        args: GRANT_ARGS,
        exp: Math.floor(now / 1000) + 300,
        receiptKeyId: RECEIPT_KEY_ID,
      })).toThrow('mintGrant: rootPrivateKey must be an Ed25519 private key')
    }

    const rsaGrant = signedGrant(rsa.privateKey, 'rsa-512-root', now)
    expect(Buffer.from(String(rsaGrant.signature), 'base64')).toHaveLength(64)
    expect(verifyWithRoot(rsaGrant, rsa.publicKey, now)).toEqual({
      ok: false,
      reason: REFUSE.ROOT_KEY_TYPE,
    })

    const validEd25519Grant = signedGrant(ed25519.privateKey, 'ec-p224-root', now)
    expect(verifyWithRoot(validEd25519Grant, ec.publicKey, now)).toEqual({
      ok: false,
      reason: REFUSE.ROOT_KEY_TYPE,
    })
  })

  it('refuses a private Ed25519 PEM where a canonical public root is required', () => {
    const now = Date.now()
    const root = generateKeyPairSync('ed25519')
    const grant = signedGrant(root.privateKey, 'private-root-input', now)
    const verdict = verifyGrant({
      grant,
      toolName: 'memory.put',
      args: GRANT_ARGS,
      rootPublicKeyPem: root.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      seenNonces: new Set(),
      now,
      expectedDefinitionId: DEFINITION_ID,
      expectedOperationDigest: OPERATION_DIGEST,
      expectedReceiptKeyId: RECEIPT_KEY_ID,
    })

    expect(verdict).toEqual({ ok: false, reason: REFUSE.ROOT_KEY_TYPE })
  })

  it('burns the nonce from the signed snapshot when a direct caller presents a Proxy', () => {
    const now = Date.now()
    const root = generateKeyPairSync('ed25519')
    const signedNonce = 'signed-snapshot-nonce'
    const signed = signedGrant(root.privateKey, signedNonce, now)
    let observations = 0
    const alternating = new Proxy(signed, {
      ownKeys(target) {
        observations++
        return Reflect.ownKeys(target)
      },
      getOwnPropertyDescriptor(target, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
        if (key !== 'nonce' || descriptor === undefined) return descriptor
        return { ...descriptor, value: observations === 1 ? signedNonce : 'unsigned-reservation-nonce' }
      },
    })
    const spent = new Set<string>()
    const common = {
      toolName: 'memory.put',
      args: GRANT_ARGS,
      rootPublicKeyPem: root.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      seenNonces: spent,
      now,
      expectedDefinitionId: DEFINITION_ID,
      expectedOperationDigest: OPERATION_DIGEST,
      expectedReceiptKeyId: RECEIPT_KEY_ID,
    }

    expect(verifyGrant({ ...common, grant: alternating }).ok).toBe(true)
    expect([...spent]).toEqual([signedNonce])
    expect(verifyGrant({ ...common, grant: signed })).toMatchObject({ ok: false, reason: REFUSE.REPLAYED })
    expect(observations).toBe(1)
  })

  it('keeps the first issuer reachable, refuses a second owner, and releases on graceful stop', async () => {
    const { keyFile, socketPath } = fixture()
    const first = spawnIssuer(socketPath, keyFile)
    await waitForSocket(first, socketPath)

    const second = spawnIssuer(socketPath, keyFile)
    await expect(waitForExit(second)).resolves.toBe(1)
    expect(second.stderr()).toContain('issuer lease already exists; stale and live owners are not guessed apart')
    await expect(askUnknownOperation(socketPath)).resolves.toEqual({ ok: false, reason: 'issuer:unknown-op' })

    await stopIssuer(first.child)
    expect(existsSync(socketPath)).toBe(false)
    expect(existsSync(`${socketPath}.lock`)).toBe(false)

    const replacement = spawnIssuer(socketPath, keyFile)
    await waitForSocket(replacement, socketPath)
    await expect(askUnknownOperation(socketPath)).resolves.toEqual({ ok: false, reason: 'issuer:unknown-op' })
  })

  it('refuses a linked socket parent and never creates entries through it', async () => {
    const { directory, keyFile } = fixture()
    const realParent = join(directory, 'real-parent')
    const linkedParent = join(directory, 'linked-parent')
    mkdirSync(realParent, { mode: 0o700 })
    symlinkSync(realParent, linkedParent)
    const socketPath = join(linkedParent, 'issuer.sock')

    const subject = spawnIssuer(socketPath, keyFile)

    await expect(waitForExit(subject)).resolves.toBe(1)
    expect(subject.stderr()).toContain('socket parent must be an exact directory, not a link or other entry')
    expect(existsSync(join(realParent, 'issuer.sock'))).toBe(false)
    expect(existsSync(join(realParent, 'issuer.sock.lock'))).toBe(false)
  })

  it('refuses a socket parent with group or other mode bits', async () => {
    const { directory, keyFile, socketPath } = fixture()
    const socketParent = join(directory, 'socket')
    mkdirSync(socketParent, { mode: 0o750 })
    chmodSync(socketParent, 0o750)

    const subject = spawnIssuer(socketPath, keyFile)

    await expect(waitForExit(subject)).resolves.toBe(1)
    expect(subject.stderr()).toContain('socket parent must have mode 0700 or stricter')
    expect(existsSync(socketPath)).toBe(false)
    expect(existsSync(`${socketPath}.lock`)).toBe(false)
  })

  it('publishes the installed-job route as 0710 directory plus 0660 socket', async () => {
    const { directory, keyFile, socketPath } = fixture()
    const socketParent = join(directory, 'socket')
    mkdirSync(socketParent, { mode: 0o710 })
    chmodSync(socketParent, 0o710)

    const subject = spawnIssuer(socketPath, keyFile, {
      AUKORA_ISSUER_SOCKET_GROUP_ACCESS: '1',
    })
    await waitForSocket(subject, socketPath)
    await expect(askUnknownOperation(socketPath)).resolves.toEqual({ ok: false, reason: 'issuer:unknown-op' })

    const owner = processOwnership()
    const directoryEntry = lstatSync(socketParent)
    expect(directoryEntry.uid).toBe(owner.uid)
    expect(directoryEntry.gid).toBe(owner.gid)
    expect(directoryEntry.mode & 0o777).toBe(0o710)
    const socketEntry = lstatSync(socketPath)
    expect(socketEntry.uid).toBe(owner.uid)
    expect(socketEntry.gid).toBe(owner.gid)
    expect(socketEntry.mode & 0o777).toBe(0o660)
  })

  it('keeps the default issuer route owner-only', async () => {
    const { keyFile, socketPath } = fixture()
    const subject = spawnIssuer(socketPath, keyFile)
    await waitForSocket(subject, socketPath)
    await expect(askUnknownOperation(socketPath)).resolves.toEqual({ ok: false, reason: 'issuer:unknown-op' })

    expect(lstatSync(join(socketPath, '..')).mode & 0o777).toBe(0o700)
    expect(lstatSync(socketPath).mode & 0o777).toBe(0o600)
  })

  it('refuses installed-job group access through a directory wider than 0710', async () => {
    const { directory, keyFile, socketPath } = fixture()
    const socketParent = join(directory, 'socket')
    mkdirSync(socketParent, { mode: 0o750 })
    chmodSync(socketParent, 0o750)

    const subject = spawnIssuer(socketPath, keyFile, {
      AUKORA_ISSUER_SOCKET_GROUP_ACCESS: '1',
    })

    await expect(waitForExit(subject)).resolves.toBe(1)
    expect(subject.stderr()).toContain('shared socket parent must have mode 0710')
    expect(existsSync(socketPath)).toBe(false)
    expect(existsSync(`${socketPath}.lock`)).toBe(false)
  })

  it('refuses an ambiguous installed-job group-access value before creating state', async () => {
    const { keyFile, socketPath } = fixture()
    const subject = spawnIssuer(socketPath, keyFile, {
      AUKORA_ISSUER_SOCKET_GROUP_ACCESS: 'true',
    })

    await expect(waitForExit(subject)).resolves.toBe(1)
    expect(subject.stderr()).toContain('AUKORA_ISSUER_SOCKET_GROUP_ACCESS must be 1 when present')
    expect(existsSync(socketPath)).toBe(false)
    expect(existsSync(`${socketPath}.lock`)).toBe(false)
  })

  it('preserves an existing socket-path entry and an ambiguous stale lease', async () => {
    const firstFixture = fixture()
    mkdirSync(join(firstFixture.directory, 'socket'), { mode: 0o700 })
    writeFileSync(firstFixture.socketPath, 'operator-owned\n', { mode: 0o600 })
    const occupied = spawnIssuer(firstFixture.socketPath, firstFixture.keyFile)

    await expect(waitForExit(occupied)).resolves.toBe(1)
    expect(occupied.stderr()).toContain('socket path already exists; issuer will not unlink an unowned entry')
    expect(readFileSync(firstFixture.socketPath, 'utf8')).toBe('operator-owned\n')
    expect(existsSync(`${firstFixture.socketPath}.lock`)).toBe(false)

    const secondFixture = fixture()
    mkdirSync(join(secondFixture.directory, 'socket'), { mode: 0o700 })
    writeFileSync(`${secondFixture.socketPath}.lock`, 'unknown-owner\n', { mode: 0o600 })
    const stale = spawnIssuer(secondFixture.socketPath, secondFixture.keyFile)

    await expect(waitForExit(stale)).resolves.toBe(1)
    expect(stale.stderr()).toContain('issuer lease already exists; stale and live owners are not guessed apart')
    expect(readFileSync(`${secondFixture.socketPath}.lock`, 'utf8')).toBe('unknown-owner\n')
    expect(existsSync(secondFixture.socketPath)).toBe(false)
  })

})
