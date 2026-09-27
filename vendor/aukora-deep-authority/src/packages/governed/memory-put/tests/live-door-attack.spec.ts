/**
 * Attacks against the live bound `memory.put` door.
 *
 * Each row must land a named refuse or a counted world, not a reason-string
 * miss. These fixtures are SIMULATED HUMAN. They do not claim custody.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { generateKeyPairSync, sign as edSign, type KeyObject } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConnection, createServer, type Socket } from 'node:net'
import { type ChildProcess } from 'node:child_process'
import {
  BROKER_REFUSE,
  spawnBroker,
} from '@aukora/core/broker/broker.mjs'
import { MEMORY_PUT } from '@aukora/core/broker/effect.mjs'
import { authorizationSignedMessageFromHex } from '@aukora/core/host-dsh/src/grant.mjs'
import { mintGrant } from '@aukora/core/issuer/mint.mjs'

interface IssuerFrame {
  op: string
  digest: string
  artifact?: unknown
  artifactDigest?: string
}

type IssuerResponder = (
  frame: IssuerFrame,
  rootPrivateKey: KeyObject,
) => unknown

interface Fixture {
  broker: ChildProcess
  brokerSocket: string
  issuerFrames: IssuerFrame[]
  proposalNamespace: string
  rootPrivateKey: KeyObject
  stateDir: string
  tempDir: string
  close: () => Promise<void>
}

const fixtures: Fixture[] = []
const LIVE_DOOR_ACTIVATION = 'ab'.repeat(32)
const LIVE_DOOR_RENDERER = 'cd'.repeat(32)
const FOREIGN_DIGEST = 'ef'.repeat(32)

/** Send one request to the broker and return its first newline-delimited reply. */
function brokerRequest(socketPath: string, request: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ''
    let settled = false
    const finish = (done: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      done()
    }
    const timer = setTimeout(() => {
      finish(() => { reject(new Error('broker request timed out')) })
    }, 8_000)
    socket.once('connect', () => { socket.write(`${JSON.stringify(request)}\n`) })
    socket.once('error', (error) => { finish(() => { reject(error) }) })
    socket.once('close', () => {
      finish(() => { reject(new Error('broker closed without a reply')) })
    })
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const cut = buffer.indexOf('\n')
      if (cut === -1) return
      finish(() => {
        try {
          resolve(JSON.parse(buffer.slice(0, cut)) as Record<string, unknown>)
        } catch (error: unknown) {
          reject(error instanceof Error ? error : new Error('broker reply was not JSON'))
        }
      })
    })
  })
}

function waitForExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve()
      return
    }
    const timer = setTimeout(() => { reject(new Error('child did not exit')) }, 5_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await waitForExit(child)
}

async function startIssuer(
  tempDir: string,
  rootPrivateKey: KeyObject,
  responder?: IssuerResponder,
): Promise<{ frames: IssuerFrame[]; path: string; close: () => Promise<void> }> {
  const path = join(tempDir, 'issuer.sock')
  const frames: IssuerFrame[] = []
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.once('close', () => { sockets.delete(socket) })
    let buffer = ''
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const cut = buffer.indexOf('\n')
      if (cut === -1) return
      socket.removeAllListeners('data')
      const frame = JSON.parse(buffer.slice(0, cut)) as IssuerFrame
      frames.push(frame)
      const defaultReply = frame.op === 'admit'
        ? { ok: true }
        : {
          ok: true,
          digest: frame.digest,
          signature: edSign(
            null,
            authorizationSignedMessageFromHex(frame.digest),
            rootPrivateKey,
          ).toString('base64'),
        }
      const response = responder === undefined ? defaultReply : responder(frame, rootPrivateKey)
      void Promise.resolve(response).then((reply) => {
        if (socket.destroyed) return
        socket.end(`${JSON.stringify(reply)}\n`)
      }).catch(() => socket.destroy())
    })
    socket.on('error', () => { /* fixture teardown can close a pending exchange */ })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  return {
    frames,
    path,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve()
          else reject(error)
        })
      })
    },
  }
}

async function startFixture(options: {
  responder?: IssuerResponder
  review?: (request: { artifactDigest?: string }) => Promise<'approved' | 'denied'> | 'approved' | 'denied'
} = {}): Promise<Fixture> {
  const tempDir = mkdtempSync(join(tmpdir(), 'aukora-live-door-attack-'))
  const stateDir = join(tempDir, 'state')
  const brokerSocket = join(tempDir, 'broker.sock')
  const root = generateKeyPairSync('ed25519')
  const rootPublicKeyPem = root.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const issuer = await startIssuer(tempDir, root.privateKey, options.responder)
  const broker = await spawnBroker({
    socketPath: brokerSocket,
    stateDir,
    rootPublicKeyPem,
    issuerSocket: issuer.path,
    activationDigest: LIVE_DOOR_ACTIVATION,
    rendererId: LIVE_DOOR_RENDERER,
    review: options.review ?? (async () => 'approved' as const),
  })
  const opened = await brokerRequest(brokerSocket, { op: 'proposal.open' })
  if (typeof opened.proposalNamespace !== 'string') throw new Error('broker omitted its proposal namespace')
  const fixture: Fixture = {
    broker,
    brokerSocket,
    issuerFrames: issuer.frames,
    proposalNamespace: opened.proposalNamespace,
    rootPrivateKey: root.privateKey,
    stateDir,
    tempDir,
    close: async () => {
      await stopChild(broker)
      await issuer.close()
      rmSync(tempDir, { recursive: true, force: true })
    },
  }
  fixtures.push(fixture)
  return fixture
}

function proposalRequest(fixture: Fixture, request: Record<string, unknown>): Promise<Record<string, unknown>> {
  return brokerRequest(fixture.brokerSocket, { ...request, proposalNamespace: fixture.proposalNamespace })
}

function proposalIdOf(reply: Record<string, unknown>): string {
  if (typeof reply.proposalId !== 'string') throw new Error('proposal reply omitted its id')
  return reply.proposalId
}

async function waitForTerminal(fixture: Fixture, proposalId: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 8_000
  for (;;) {
    const reply = await proposalRequest(fixture, { op: 'proposal.status', proposalId })
    if (reply.state !== 'PENDING') return reply
    if (Date.now() > deadline) throw new Error(`proposal ${proposalId} did not terminate`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

function worldCounts(stateDir: string): { aura: number; nonces: number; objects: number } {
  const countDirectory = (path: string): number => existsSync(path) ? readdirSync(path).length : 0
  const auraPath = join(stateDir, 'aura.jsonl')
  return {
    aura: existsSync(auraPath) ? readFileSync(auraPath, 'utf8').trim().split('\n').filter(Boolean).length : 0,
    nonces: countDirectory(join(stateDir, 'nonces')),
    objects: countDirectory(join(stateDir, 'memory', 'objects')),
  }
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0).reverse()) await fixture.close()
})

describe('live memory.put door attacks', () => {
  it('refuses a leftover v3 grant for different bytes after one settled write', async () => {
    const fixture = await startFixture()
    const settled = await proposalRequest(fixture, {
      op: 'proposal.deposit',
      callId: 'attack-settled-a',
      toolName: MEMORY_PUT,
      arguments: { key: 'attack:a', value: 'bytes-a' },
    })
    expect(await waitForTerminal(fixture, proposalIdOf(settled))).toMatchObject({
      ok: true,
      state: 'SETTLED',
    })
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 1, nonces: 1, objects: 1 })

    const status = await brokerRequest(fixture.brokerSocket, { op: 'status' })
    if (typeof status.receiptKeyId !== 'string') throw new Error('broker status omitted receipt key identity')
    const { grant } = mintGrant({
      rootPrivateKey: fixture.rootPrivateKey,
      args: { key: 'attack:b', value: 'bytes-b' },
      exp: Math.floor(Date.now() / 1000) + 60,
      receiptKeyId: status.receiptKeyId,
    })
    expect(await brokerRequest(fixture.brokerSocket, {
      op: 'memory.put',
      toolName: MEMORY_PUT,
      arguments: { key: 'attack:b', value: 'bytes-b' },
      grant,
    })).toMatchObject({
      ok: false,
      state: 'REFUSED',
      reason: BROKER_REFUSE.ACTIVATION_UNBOUND,
    })
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 1, nonces: 1, objects: 1 })
  })

  it('does not write again when the same callId is redeposited after settlement', async () => {
    const fixture = await startFixture()
    const argumentsValue = { key: 'attack:replay-call', value: 'once' }
    const first = await proposalRequest(fixture, {
      op: 'proposal.deposit',
      callId: 'attack-replay-call',
      toolName: MEMORY_PUT,
      arguments: argumentsValue,
    })
    const proposalId = proposalIdOf(first)
    expect(await waitForTerminal(fixture, proposalId)).toMatchObject({ ok: true, state: 'SETTLED' })
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 1, nonces: 1, objects: 1 })

    const replay = await proposalRequest(fixture, {
      op: 'proposal.deposit',
      callId: 'attack-replay-call',
      toolName: MEMORY_PUT,
      arguments: argumentsValue,
    })
    expect(replay).toMatchObject({ ok: true, proposalId, state: 'SETTLED' })
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 1, nonces: 1, objects: 1 })
  })

  it('does not write a second occurrence while the first parent review is still open', async () => {
    let reviews = 0
    let releaseFirst: (() => void) | undefined
    const firstHeld = new Promise<void>((resolve) => { releaseFirst = resolve })
    const fixture = await startFixture({
      review: async () => {
        reviews += 1
        if (reviews === 1) {
          await firstHeld
          return 'approved'
        }
        return 'denied'
      },
    })
    const first = await proposalRequest(fixture, {
      op: 'proposal.deposit',
      callId: 'attack-concurrent-a',
      toolName: MEMORY_PUT,
      arguments: { key: 'attack:concurrent-a', value: 1 },
    })
    await expect.poll(() => reviews).toBe(1)
    const second = await proposalRequest(fixture, {
      op: 'proposal.deposit',
      callId: 'attack-concurrent-b',
      toolName: MEMORY_PUT,
      arguments: { key: 'attack:concurrent-b', value: 2 },
    })
    // authorizeProposal shares the issuer turn with parent review. A second
    // review starting here would mean that serialization did not hold.
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(reviews).toBe(1)
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
    expect(await proposalRequest(fixture, { op: 'proposal.status', proposalId: proposalIdOf(second) }))
      .toMatchObject({ state: 'PENDING' })
    if (releaseFirst === undefined) throw new Error('parent review did not install its decision gate')
    releaseFirst()

    expect(await waitForTerminal(fixture, proposalIdOf(first))).toMatchObject({
      ok: true,
      state: 'SETTLED',
    })
    expect(await waitForTerminal(fixture, proposalIdOf(second))).toMatchObject({
      ok: false,
      state: 'REFUSED',
      reason: BROKER_REFUSE.REVIEW_DENIED,
    })
    expect(reviews).toBe(2)
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 1, nonces: 1, objects: 1 })
  })

  it('refuses when the issuer signs a different digest than the reviewed artifact', async () => {
    const fixture = await startFixture({
      responder: (frame, key) => {
        if (frame.op === 'admit') return { ok: true }
        return {
          ok: true,
          digest: frame.digest,
          signature: edSign(
            null,
            authorizationSignedMessageFromHex(FOREIGN_DIGEST),
            key,
          ).toString('base64'),
        }
      },
    })
    const pending = await proposalRequest(fixture, {
      op: 'proposal.deposit',
      callId: 'attack-issuer-swap',
      toolName: MEMORY_PUT,
      arguments: { key: 'attack:issuer-swap', value: 'bytes-a' },
    })
    expect(await waitForTerminal(fixture, proposalIdOf(pending))).toMatchObject({
      ok: false,
      state: 'REFUSED',
      reason: BROKER_REFUSE.ISSUER_RESPONSE_MALFORMED,
    })
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })
})
