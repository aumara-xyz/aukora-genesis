/**
 * Parent-owned review for the broker proposal route.
 *
 * These rows exercise the real broker child and its parent IPC callback. The
 * issuer fixture signs only after the broker has completed review; it does not
 * stand in for deployed issuer custody or human authentication.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import { generateKeyPairSync, sign as edSign, type KeyObject } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConnection, createServer, type Socket } from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  BROKER_REVIEW_DECISION,
  BROKER_REVIEW_REQUEST,
  BROKER_REFUSE,
  scrubEnv,
  spawnBroker,
  type BrokerReviewRequest,
} from '@aukora/core/broker/broker.mjs'
import { MEMORY_PUT } from '@aukora/core/broker/effect.mjs'
import { buildOperation, operationDigest } from '@aukora/core/broker/operation.mjs'
import { authorizationSignedMessageFromHex } from '@aukora/core/host-dsh/src/grant.mjs'
import { stageKiraMemoryRecord } from '@aukora/core/kira/stage.mjs'
import { GovernedMemory } from '../src/index.ts'

type ReviewDecision = 'approved' | 'denied'
type Reviewer = (
  request: Readonly<BrokerReviewRequest>,
  signal: AbortSignal,
) => Promise<ReviewDecision> | ReviewDecision

interface IssuerFrame {
  op: string
  digest: string
  artifact?: unknown
  artifactDigest?: string
}

interface Fixture {
  broker: ChildProcess
  brokerSocket: string
  issuerFrames: IssuerFrame[]
  stateDir: string
  tempDir: string
  close: () => Promise<void>
}

const fixtures: Fixture[] = []
const BROKER_ENTRY = fileURLToPath(new URL('../../../../aukora/broker/broker.mjs', import.meta.url))
const LIVE_DOOR_ACTIVATION = 'ab'.repeat(32)
const LIVE_DOOR_RENDERER = 'cd'.repeat(32)

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

/** Wait for a child process to exit instead of treating a kill request as cleanup. */
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

/** Stop one direct child and await its observed exit. */
async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await waitForExit(child)
}

/** Start a digest-only issuer fixture and retain every frame it receives. */
async function startIssuer(
  tempDir: string,
  rootPrivateKey: KeyObject,
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
      const reply = frame.op === 'admit'
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
      socket.end(`${JSON.stringify(reply)}\n`)
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

/** Start the real broker with an optional parent review callback and live-door bind. */
async function startFixture(
  review?: Reviewer,
  options: { activationDigest?: string | null; rendererId?: string | null } = {},
): Promise<Fixture> {
  const tempDir = mkdtempSync(join(tmpdir(), 'aukora-parent-review-'))
  const stateDir = join(tempDir, 'state')
  const brokerSocket = join(tempDir, 'broker.sock')
  const root = generateKeyPairSync('ed25519')
  const rootPublicKeyPem = root.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const issuer = await startIssuer(tempDir, root.privateKey)
  let broker: ChildProcess
  try {
    broker = await spawnBroker({
      socketPath: brokerSocket,
      stateDir,
      rootPublicKeyPem,
      issuerSocket: issuer.path,
      ...(options.activationDigest === null ? {} : { activationDigest: options.activationDigest ?? LIVE_DOOR_ACTIVATION }),
      ...(options.rendererId === null ? {} : { rendererId: options.rendererId ?? LIVE_DOOR_RENDERER }),
      ...review === undefined ? {} : { review },
    })
  } catch (error: unknown) {
    await issuer.close()
    rmSync(tempDir, { recursive: true, force: true })
    throw error
  }
  const fixture: Fixture = {
    broker,
    brokerSocket,
    issuerFrames: issuer.frames,
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

/** Start the real broker entry with a test parent that controls the raw echoed decision. */
async function startRawReviewFixture(
  transform: (request: Readonly<BrokerReviewRequest>) => Record<string, unknown>,
): Promise<Fixture> {
  const tempDir = mkdtempSync(join(tmpdir(), 'aukora-parent-review-raw-'))
  const stateDir = join(tempDir, 'state')
  const brokerSocket = join(tempDir, 'broker.sock')
  const root = generateKeyPairSync('ed25519')
  const rootPublicKeyPem = root.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const issuer = await startIssuer(tempDir, root.privateKey)
  const env = {
    ...scrubEnv(process.env),
    AUKORA_SOCKET: brokerSocket,
    AUKORA_STATE_DIR: stateDir,
    AUKORA_ROOT_PEM: rootPublicKeyPem,
    AUKORA_ISSUER_SOCKET: issuer.path,
    AUKORA_PARENT_REVIEW: '1',
    AUKORA_ACTIVATION_DIGEST: LIVE_DOOR_ACTIVATION,
    AUKORA_RENDERER_ID: LIVE_DOOR_RENDERER,
  }
  const broker = spawn(process.execPath, ['--', BROKER_ENTRY], {
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  broker.on('message', (message) => {
    if (typeof message !== 'object' || message === null
      || (message as { type?: unknown }).type !== BROKER_REVIEW_REQUEST) return
    const response = transform(Object.freeze({ ...message }) as Readonly<BrokerReviewRequest>)
    if (!broker.connected || broker.exitCode !== null || broker.signalCode !== null) return
    try {
      broker.send(response, () => {})
    } catch {
      // Broker teardown owns this raw-fixture race.
    }
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('raw broker did not report readiness')) }, 5_000)
      const finish = (done: () => void): void => {
        clearTimeout(timer)
        broker.removeListener('message', onMessage)
        broker.removeListener('error', onError)
        broker.removeListener('exit', onExit)
        done()
      }
      const onMessage = (message: unknown): void => {
        if ((message as { type?: unknown })?.type === 'aukora:broker-ready') finish(resolve)
      }
      const onError = (error: Error): void => { finish(() => { reject(error) }) }
      const onExit = (): void => { finish(() => { reject(new Error('raw broker exited before readiness')) }) }
      broker.on('message', onMessage)
      broker.once('error', onError)
      broker.once('exit', onExit)
    })
  } catch (error: unknown) {
    if (broker.exitCode === null && broker.signalCode === null) broker.kill('SIGTERM')
    await issuer.close()
    rmSync(tempDir, { recursive: true, force: true })
    throw error
  }
  const fixture: Fixture = {
    broker,
    brokerSocket,
    issuerFrames: issuer.frames,
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

/** Build the one exact decision frame the broker accepts for this request. */
function approvedDecision(request: Readonly<BrokerReviewRequest>): Record<string, unknown> {
  return {
    type: BROKER_REVIEW_DECISION,
    reviewId: request.reviewId,
    proposalId: request.proposalId,
    artifactDigest: request.artifactDigest,
    operationDigest: request.operationDigest,
    authorizationDigest: request.authorizationDigest,
    decision: 'approved',
  }
}

/** Allocate a proposal namespace or return its named refusal. */
async function openProposal(fixture: Fixture): Promise<Record<string, unknown>> {
  return await brokerRequest(fixture.brokerSocket, { op: 'proposal.open' })
}

/** Deposit one memory.put proposal through a previously opened namespace. */
async function depositProposal(
  fixture: Fixture,
  proposalNamespace: string,
  callId: string,
  key: string,
): Promise<Record<string, unknown>> {
  return await brokerRequest(fixture.brokerSocket, {
    op: 'proposal.deposit',
    proposalNamespace,
    callId,
    toolName: MEMORY_PUT,
    arguments: { key, value: { source: 'parent-review' } },
  })
}

/** Poll one accepted proposal to a public terminal state. */
async function waitForTerminal(
  fixture: Fixture,
  proposalNamespace: string,
  proposalId: string,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 8_000
  for (;;) {
    const reply = await brokerRequest(fixture.brokerSocket, {
      op: 'proposal.status',
      proposalNamespace,
      proposalId,
    })
    if (reply.state !== 'PENDING') return reply
    if (Date.now() >= deadline) throw new Error('proposal did not reach a terminal state')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

function namespaceOf(reply: Record<string, unknown>): string {
  if (typeof reply.proposalNamespace !== 'string') throw new Error('broker omitted proposal namespace')
  return reply.proposalNamespace
}

function proposalIdOf(reply: Record<string, unknown>): string {
  if (typeof reply.proposalId !== 'string') throw new Error('broker omitted proposal id')
  return reply.proposalId
}

/** Count only the three externally relevant settlement artifacts. */
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

describe('parent-owned proposal review', () => {
  it('binds one delayed approval to the exact operation and issuer digest', async () => {
    const requests: Readonly<BrokerReviewRequest>[] = []
    let releaseReview: (() => void) | undefined
    const reviewGate = new Promise<void>((resolve) => { releaseReview = resolve })
    const fixture = await startFixture(async (request) => {
      requests.push(request)
      await reviewGate
      return 'approved' as const
    })
    const opened = await openProposal(fixture)
    const proposalNamespace = namespaceOf(opened)
    const deposited = await depositProposal(fixture, proposalNamespace, 'review-delay', 'review:delay')
    const proposalId = proposalIdOf(deposited)
    await expect.poll(() => requests.length).toBe(1)
    expect(fixture.issuerFrames).toEqual([])
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
    if (releaseReview === undefined) throw new Error('parent review did not install its decision gate')
    releaseReview()
    const terminal = await waitForTerminal(fixture, proposalNamespace, proposalId)

    expect(terminal).toMatchObject({ ok: true, proposalId, state: 'SETTLED' })
    expect(terminal.receipt).toBeTypeOf('object')
    expect(requests).toHaveLength(1)
    const request = requests[0]!
    expect(Object.keys(request).sort()).toEqual([
      'artifact',
      'artifactDigest',
      'authorizationDigest',
      'expiresAt',
      'operationDigest',
      'proposalId',
      'reviewId',
      'type',
    ])
    expect(request.type).toBe('aukora:review-request:v2')
    expect(Object.isFrozen(request)).toBe(true)
    expect(request.proposalId).toBe(proposalId)
    expect(request.reviewId).toMatch(/^[0-9a-f]{32}$/)
    expect(request.artifactDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(request.operationDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(request.authorizationDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(Number.isSafeInteger(request.expiresAt)).toBe(true)
    const expectedOperation = buildOperation({
      key: 'review:delay',
      value: { source: 'parent-review' },
    }, request.expiresAt)
    expect(request.operationDigest).toBe(operationDigest(expectedOperation))
    expect(request.artifact).toMatchObject({
      operationDigest: request.operationDigest,
      definitionId: expectedOperation.definitionId,
      expiry: request.expiresAt,
      activationDigest: LIVE_DOOR_ACTIVATION,
      rendererId: LIVE_DOOR_RENDERER,
    })
    expect(fixture.issuerFrames).toEqual([
      { op: 'admit', digest: request.authorizationDigest },
      {
        op: 'authorize',
        digest: request.authorizationDigest,
        artifact: request.artifact,
        artifactDigest: request.artifactDigest,
      },
    ])
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 1, nonces: 1, objects: 1 })
  })

  it('spends no issuer, nonce, effect, or Aura state when the parent denies', async () => {
    const fixture = await startFixture(async () => 'denied' as const)
    const opened = await openProposal(fixture)
    const proposalNamespace = namespaceOf(opened)
    const deposited = await depositProposal(fixture, proposalNamespace, 'review-denied', 'review:denied')
    const proposalId = proposalIdOf(deposited)

    await expect(waitForTerminal(fixture, proposalNamespace, proposalId)).resolves.toEqual({
      ok: false,
      proposalId,
      state: 'REFUSED',
      reason: BROKER_REFUSE.REVIEW_DENIED,
    })
    expect(fixture.issuerFrames).toEqual([])
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })

  it('names a missing parent review channel before allocating a namespace', async () => {
    const fixture = await startFixture()

    await expect(openProposal(fixture)).resolves.toEqual({
      ok: false,
      state: 'REFUSED',
      reason: BROKER_REFUSE.REVIEW_CHANNEL_UNAVAILABLE,
    })
    expect(fixture.issuerFrames).toEqual([])
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })

  it.each([
    [BROKER_REFUSE.REVIEW_CHANNEL_UNAVAILABLE, BROKER_REFUSE.REVIEW_CHANNEL_UNAVAILABLE],
    [BROKER_REFUSE.REVIEW_TIMED_OUT, BROKER_REFUSE.REVIEW_TIMED_OUT],
    [BROKER_REFUSE.STOPPING, BROKER_REFUSE.STOPPING],
    ['review fixture failed', BROKER_REFUSE.REVIEW_RESPONSE_MALFORMED],
  ])('carries a parent callback failure %s as %s through the real broker child', async (message, reason) => {
    const fixture = await startFixture(() => { throw new Error(message) })
    const proposalNamespace = namespaceOf(await openProposal(fixture))
    const deposited = await depositProposal(fixture, proposalNamespace, 'review-failed', 'review:failed')
    const proposalId = proposalIdOf(deposited)

    await expect(waitForTerminal(fixture, proposalNamespace, proposalId)).resolves.toEqual({
      ok: false,
      proposalId,
      state: 'REFUSED',
      reason,
    })
    expect(fixture.issuerFrames).toEqual([])
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
    expect((await brokerRequest(fixture.brokerSocket, { op: 'status' })).pid).toBe(fixture.broker.pid)
  })

  it('refuses a malformed parent decision before contacting the issuer', async () => {
    const fixture = await startFixture(async () => 'malformed' as ReviewDecision)
    const opened = await openProposal(fixture)
    const proposalNamespace = namespaceOf(opened)
    const deposited = await depositProposal(fixture, proposalNamespace, 'review-malformed', 'review:malformed')
    const proposalId = proposalIdOf(deposited)

    await expect(waitForTerminal(fixture, proposalNamespace, proposalId)).resolves.toEqual({
      ok: false,
      proposalId,
      state: 'REFUSED',
      reason: BROKER_REFUSE.REVIEW_RESPONSE_MALFORMED,
    })
    expect(fixture.issuerFrames).toEqual([])
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })

  it('accepts one exact raw parent echo as the malformed-echo positive control', async () => {
    const fixture = await startRawReviewFixture(approvedDecision)
    const opened = await openProposal(fixture)
    const proposalNamespace = namespaceOf(opened)
    const deposited = await depositProposal(fixture, proposalNamespace, 'review-raw-control', 'review:raw-control')
    const proposalId = proposalIdOf(deposited)

    const terminal = await waitForTerminal(fixture, proposalNamespace, proposalId)
    expect(terminal).toMatchObject({
      ok: true,
      proposalId,
      state: 'SETTLED',
    })
    expect(terminal.receipt).toBeTypeOf('object')
    expect(fixture.issuerFrames).toHaveLength(2)
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 1, nonces: 1, objects: 1 })
  })

  it('refuses an approved parent echo whose artifact digest changed', async () => {
    const fixture = await startRawReviewFixture(request => ({
      ...approvedDecision(request),
      artifactDigest: '0'.repeat(64),
    }))
    const opened = await openProposal(fixture)
    const proposalNamespace = namespaceOf(opened)
    const deposited = await depositProposal(fixture, proposalNamespace, 'review-artifact-echo', 'review:artifact-echo')
    const proposalId = proposalIdOf(deposited)

    await expect(waitForTerminal(fixture, proposalNamespace, proposalId)).resolves.toEqual({
      ok: false,
      proposalId,
      state: 'REFUSED',
      reason: BROKER_REFUSE.REVIEW_RESPONSE_MALFORMED,
    })
    expect(fixture.issuerFrames).toEqual([])
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })

  it('refuses a named parent review failure whose echoed authorization digest changed', async () => {
    const fixture = await startRawReviewFixture(request => ({
      ...approvedDecision(request),
      authorizationDigest: '0'.repeat(64),
      decision: BROKER_REFUSE.REVIEW_CHANNEL_UNAVAILABLE,
    }))
    const proposalNamespace = namespaceOf(await openProposal(fixture))
    const deposited = await depositProposal(fixture, proposalNamespace, 'review-failure-echo', 'review:failure-echo')
    const proposalId = proposalIdOf(deposited)

    await expect(waitForTerminal(fixture, proposalNamespace, proposalId)).resolves.toEqual({
      ok: false,
      proposalId,
      state: 'REFUSED',
      reason: BROKER_REFUSE.REVIEW_RESPONSE_MALFORMED,
    })
    expect(fixture.issuerFrames).toEqual([])
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })

  it('names a missing renderer before issuer contact, nonce, effect, or Aura', async () => {
    const fixture = await startFixture(async () => 'approved' as const, { rendererId: null })
    const opened = await openProposal(fixture)
    const proposalNamespace = namespaceOf(opened)
    const deposited = await depositProposal(fixture, proposalNamespace, 'review-renderer-unbound', 'review:renderer-unbound')
    const proposalId = proposalIdOf(deposited)

    await expect(waitForTerminal(fixture, proposalNamespace, proposalId)).resolves.toEqual({
      ok: false,
      proposalId,
      state: 'REFUSED',
      reason: BROKER_REFUSE.RENDERER_UNBOUND,
    })
    expect(fixture.issuerFrames).toEqual([])
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })

  it('names a missing activation before issuer contact, nonce, effect, or Aura', async () => {
    const fixture = await startFixture(async () => 'approved' as const, { activationDigest: null })
    const opened = await openProposal(fixture)
    const proposalNamespace = namespaceOf(opened)
    const deposited = await depositProposal(fixture, proposalNamespace, 'review-activation-unbound', 'review:activation-unbound')
    const proposalId = proposalIdOf(deposited)

    await expect(waitForTerminal(fixture, proposalNamespace, proposalId)).resolves.toEqual({
      ok: false,
      proposalId,
      state: 'REFUSED',
      reason: BROKER_REFUSE.ACTIVATION_UNBOUND,
    })
    expect(fixture.issuerFrames).toEqual([])
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })

  it('refuses an approved parent echo whose operation digest changed', async () => {
    const fixture = await startRawReviewFixture(request => ({
      ...approvedDecision(request),
      operationDigest: '0'.repeat(64),
    }))
    const opened = await openProposal(fixture)
    const proposalNamespace = namespaceOf(opened)
    const deposited = await depositProposal(fixture, proposalNamespace, 'review-echo-mismatch', 'review:echo-mismatch')
    const proposalId = proposalIdOf(deposited)

    await expect(waitForTerminal(fixture, proposalNamespace, proposalId)).resolves.toEqual({
      ok: false,
      proposalId,
      state: 'REFUSED',
      reason: BROKER_REFUSE.REVIEW_RESPONSE_MALFORMED,
    })
    expect(fixture.issuerFrames).toEqual([])
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })

  it('does not let an allowed guest answer bypass a denying parent reviewer', async () => {
    const fixture = await startFixture(async () => 'denied' as const)
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ApprovalService)
    GovernedMemory(ctx, { brokerSocket: fixture.brokerSocket, proposalPollIntervalMs: 1 })
    ctx.on('approval/request', async () => 'allowed-once' as const)
    const agent = {
      session: {
        events: [{ type: 'turn/start' }, { type: 'user/message' }],
        append: (type: string, data: Record<string, unknown>) => ({ type, data }),
      },
    } as unknown as Agent

    await expect(ctx.approval.request({
      agent,
      toolName: MEMORY_PUT,
      callId: CallId('guest-approval-positive-control'),
    })).resolves.toBe('allowed-once')

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('guest-cannot-approve'),
      name: MEMORY_PUT,
      arguments: { key: 'review:guest-bypass', value: { source: 'guest-approval' } },
      agent,
    })

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: `Error: memory.put refused: ${BROKER_REFUSE.REVIEW_DENIED}` }])
    expect(fixture.issuerFrames).toEqual([])
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })

  it('aborts an outstanding parent prompt before its broker child exits', async () => {
    let reviewSignal: AbortSignal | undefined
    let abortedWhileBrokerAlive = false
    let reviewStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => { reviewStarted = resolve })
    const fixture = await startFixture(async (_request, signal) => {
      reviewSignal = signal
      reviewStarted?.()
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => {
          abortedWhileBrokerAlive = fixture.broker.exitCode === null && fixture.broker.signalCode === null
          resolve()
        }, { once: true })
      })
      return 'approved' as const
    })
    const opened = await openProposal(fixture)
    const proposalNamespace = namespaceOf(opened)
    await depositProposal(fixture, proposalNamespace, 'review-abort', 'review:abort')
    await started

    await stopChild(fixture.broker)

    expect(reviewSignal?.aborted).toBe(true)
    expect(abortedWhileBrokerAlive).toBe(true)
    expect(fixture.issuerFrames).toEqual([])
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })

  it('aborts and refuses an outstanding review when parent IPC disconnects', async () => {
    let reviewSignal: AbortSignal | undefined
    let reviewStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => { reviewStarted = resolve })
    const fixture = await startFixture(async (_request, signal) => {
      reviewSignal = signal
      reviewStarted?.()
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
      return 'approved' as const
    })
    const opened = await openProposal(fixture)
    const proposalNamespace = namespaceOf(opened)
    const deposited = await depositProposal(fixture, proposalNamespace, 'review-disconnect', 'review:disconnect')
    const proposalId = proposalIdOf(deposited)
    await started

    fixture.broker.disconnect()

    await expect.poll(() => reviewSignal?.aborted).toBe(true)
    await expect(waitForTerminal(fixture, proposalNamespace, proposalId)).resolves.toEqual({
      ok: false,
      proposalId,
      state: 'REFUSED',
      reason: BROKER_REFUSE.REVIEW_CHANNEL_UNAVAILABLE,
    })
    expect(fixture.broker.exitCode).toBeNull()
    expect(fixture.broker.signalCode).toBeNull()
    expect(fixture.issuerFrames).toEqual([])
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })

  it('refuses a staged KIRA record before parent review on the unsubjected v4 route', async () => {
    const staged = stageKiraMemoryRecord({
      subject: 'aumlok:subject:kira-court',
      kind: 'observation',
      source: [],
      content: { saw: 'the parent gate holds' },
      links: [],
      privacy: 'local',
      createdAt: '2026-08-29T00:00:00Z',
    })
    const executeThrough = async (fixture: Fixture, callId: string): Promise<{ isError: boolean; value?: unknown; content?: unknown }> => {
      const ctx = new Context()
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(ApprovalService)
      GovernedMemory(ctx, { brokerSocket: fixture.brokerSocket, proposalPollIntervalMs: 1 })
      ctx.on('approval/request', async () => 'allowed-once' as const)
      const agent = {
        session: {
          events: [{ type: 'turn/start' }, { type: 'user/message' }],
          append: (type: string, data: Record<string, unknown>) => ({ type, data }),
        },
      } as unknown as Agent
      return await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: CallId(callId),
        name: MEMORY_PUT,
        arguments: staged.memoryPut,
        agent,
      })
    }

    let reviews = 0
    const fixture = await startFixture(async () => {
      reviews += 1
      return 'approved' as const
    })
    const refused = await executeThrough(fixture, 'kira-staged-v4')
    expect(refused.isError).toBe(true)
    expect(refused.content).toEqual([
      { type: 'text', text: `Error: memory.put refused: ${BROKER_REFUSE.KIRA_WRITE_AUTHORITY_UNBOUND}` },
    ])
    expect(reviews).toBe(0)
    expect(fixture.issuerFrames).toEqual([])
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })
})
