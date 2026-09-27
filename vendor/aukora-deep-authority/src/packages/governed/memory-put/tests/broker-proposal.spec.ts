/**
 * The broker-owned proposal protocol and its default governed-memory caller.
 * These rows exercise the real broker process and a test-owned issuer
 * transport. They do not claim authenticated human review or OS custody.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import { createHash, createPublicKey, generateKeyPairSync, sign as edSign, type KeyObject } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConnection, createServer, type Socket } from 'node:net'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  ACTIVATION_DIGEST_ENV,
  BROKER_AUTHORITY_REQUEST,
  BROKER_AUTHORITY_SELECTION,
  BROKER_REVIEW_DECISION,
  BROKER_REVIEW_REQUEST,
  BROKER_PROPOSAL_MAX_CALL_ID_BYTES,
  BROKER_PROPOSAL_MAX_EFFECT_BYTES,
  BROKER_PROPOSAL_MAX_ENTRIES,
  BROKER_REFUSE,
  MAX_FRAME_BYTES,
  PARENT_AUTHORITY_ENV,
  SUBJECT_AUTHORITY_EXPECTATION_ENV,
  scrubEnv,
  serve,
  spawnBroker,
  type BrokerAuthorityRequest,
} from '@aukora/core/broker/broker.mjs'
import { MEMORY_PUT } from '@aukora/core/broker/effect.mjs'
import { effectBody } from '@aukora/core/broker/effect-body.mjs'
import { authorizationSignedMessageFromHex } from '@aukora/core/host-dsh/src/grant.mjs'
import { authorizationSignedMessageV5FromHex } from '@aukora/core/host-dsh/src/grant-v5.mjs'
import { activationBindingPath } from '@aukora/core/activation/broker-state.mjs'
import {
  createSubjectAuthorityContext,
  encodeSubjectAuthorityExpectation,
  type SubjectAuthorityContextInput,
} from '@aukora/core/broker/subject-authority.mjs'
import { createDelegationClaim, delegationClaimDigest } from '@aukora/core/identity/delegation.mjs'
import {
  AUMLOK_ROOT_CONTROL_SUITE,
  createInitialIdentityControl,
  identityControlDigest,
  rootKeySetId,
} from '@aukora/core/identity/control.mjs'
import { createIdentityGenesis } from '@aukora/core/identity/genesis.mjs'
import {
  bindIdentityControlState,
  identityControlStatePath,
  readIdentityControlState,
} from '@aukora/core/identity/broker-state.mjs'
import { stageKiraMemoryRecord } from '@aukora/core/kira/stage.mjs'
import { mintGrant } from '@aukora/core/issuer/mint.mjs'
import { canonicalJSON } from '@aukora/core/kernel-seed/canonical-json.mjs'
import { GovernedMemory } from '../src/index.ts'

interface IssuerFrame {
  op: string
  digest: string
  artifact?: unknown
  artifactDigest?: string
}

interface RawIssuerReply {
  raw: string
}

type IssuerResponder = (
  frame: IssuerFrame,
  rootPrivateKey: KeyObject,
) => unknown

interface Fixture {
  authorityRequests: Readonly<BrokerAuthorityRequest>[]
  broker: ChildProcess
  brokerSocket: string
  issuerFrames: IssuerFrame[]
  proposalNamespace: string
  rootPrivateKey: KeyObject
  stateDir: string
  tempDir: string
  close: () => Promise<void>
}

interface FixtureOptions {
  activationDigest?: string | null
  rendererId?: string | null
  env?: Record<string, string | undefined>
  review?: (request: Record<string, unknown>, signal: AbortSignal) => Promise<'approved' | 'denied'> | 'approved' | 'denied'
  subjectAuthorityKey?: string
  dynamicSubjectAuthorityKey?: string
  selectDynamicAuthority?: (
    request: Readonly<BrokerAuthorityRequest>,
    rootPublicKeyPem: string,
    authority: SubjectAuthorityContextInput,
    signal: AbortSignal,
  ) => SubjectAuthorityContextInput | Promise<SubjectAuthorityContextInput>
  kiraSubject?: string
  kiraPrivacy?: readonly ('local' | 'exportable' | 'private')[]
  socketGroupAccess?: boolean
}

const fixtures: Fixture[] = []
const LIVE_DOOR_ACTIVATION = 'ab'.repeat(32)
const LIVE_DOOR_RENDERER = 'cd'.repeat(32)
const BROKER_ENTRY = fileURLToPath(new URL('../../../../aukora/broker/broker.mjs', import.meta.url))

/** Build one attenuated session-to-Agent context for the broker child path. */
function subjectAuthorityFixture(
  key: string,
  rootPublicKeyPem: string,
  selection?: Readonly<BrokerAuthorityRequest>,
) {
  const issuerJwk = createPublicKey(rootPublicKeyPem).export({ format: 'jwk' })
  if (typeof issuerJwk.x !== 'string') throw new Error('fixture issuer omitted its raw Ed25519 key')
  const mlDsa65 = ml_dsa65.keygen(new Uint8Array(32).fill(7))
  const publicKeys = {
    ed25519: Buffer.from(issuerJwk.x, 'base64url').toString('hex'),
    mlDsa65: Buffer.from(mlDsa65.publicKey).toString('hex'),
  }
  const genesis = createIdentityGenesis({
    genesisNonce: '10'.repeat(32),
    initialRootKeySetId: rootKeySetId(publicKeys),
    amendmentRuleDigest: '20'.repeat(32),
  })
  const rootControlState = createInitialIdentityControl(genesis, {
    suite: AUMLOK_ROOT_CONTROL_SUITE,
    publicKeys,
    authorizedAt: 1,
  })
  const subject = rootControlState.subject
  const controlDigest = identityControlDigest(rootControlState)
  const audience = selection?.audience ?? 'broker:primary'
  const resource = selection?.resource ?? `memory:key:${key}`
  const expiresAt = selection === undefined
    ? Math.floor(Date.now() / 1000) + 600
    : selection.expiresAt + 1
  const parent = createDelegationClaim({
    subject,
    kind: 'session',
    parentDigest: '56'.repeat(32),
    controlDigest,
    childKeyId: '78'.repeat(32),
    operations: ['memory.put', 'workspace.patch'],
    resources: [resource, 'memory:key:other'],
    audiences: [audience, 'broker:recovery'],
    activationDigests: [selection?.activationDigest ?? LIVE_DOOR_ACTIVATION, '9a'.repeat(32)],
    budgets: { calls: 2, bytes: 16_384, computeMs: 1, costMicrounits: 1 },
    notBefore: 0,
    expiresAt,
    revocationId: 'test:session',
    nonce: 'bc'.repeat(32),
  })
  const agent = createDelegationClaim({
    subject,
    kind: 'agent',
    parentDigest: delegationClaimDigest(parent),
    controlDigest,
    childKeyId: 'de'.repeat(32),
    operations: ['memory.put'],
    resources: [resource],
    audiences: [audience],
    activationDigests: [selection?.activationDigest ?? LIVE_DOOR_ACTIVATION],
    budgets: selection?.budget ?? { calls: 1, bytes: 8_192, computeMs: 0, costMicrounits: 0 },
    notBefore: 1,
    expiresAt: selection?.expiresAt ?? expiresAt - 1,
    revocationId: 'test:agent',
    nonce: 'f0'.repeat(32),
  })
  return {
    rootControlState,
    subjectAuthority: createSubjectAuthorityContext({
      subject,
      activeControlDigest: controlDigest,
      activationDigest: selection?.activationDigest ?? LIVE_DOOR_ACTIVATION,
      audience,
      parentDelegationClaim: parent,
      delegationClaim: agent,
    }),
  }
}

/** Rebuild one valid context under a different control digest. */
function authorityWithControlDigest(
  authorityInput: SubjectAuthorityContextInput,
  controlDigest: string,
): SubjectAuthorityContextInput {
  const authority = createSubjectAuthorityContext(authorityInput)
  const { domain: _parentDomain, ...parentInput } = authority.parentDelegationClaim
  const parent = createDelegationClaim({
    ...parentInput,
    controlDigest,
  })
  const { domain: _agentDomain, ...agentInput } = authority.delegationClaim
  const agent = createDelegationClaim({
    ...agentInput,
    parentDigest: delegationClaimDigest(parent),
    controlDigest,
  })
  return {
    subject: authority.subject,
    activeControlDigest: controlDigest,
    activationDigest: authority.activationDigest,
    audience: authority.audience,
    parentDelegationClaim: parent,
    delegationClaim: agent,
  }
}

function processOwnership(): { uid: number; gid: number } {
  if (process.geteuid === undefined || process.getegid === undefined) {
    throw new Error('process ownership is unavailable on this platform')
  }
  return { uid: process.geteuid(), gid: process.getegid() }
}

/** Send one request to a broker connection and return its first frame. */
function brokerRequest(socketPath: string, request: unknown, timeoutMs = 5_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ''
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      fn()
    }
    const timer = setTimeout(() => {
      finish(() => { reject(new Error('broker request timed out')) })
    }, timeoutMs)
    socket.once('connect', () => { socket.write(`${JSON.stringify(request)}\n`) })
    socket.once('error', (error) => { finish(() => { reject(error) }) })
    socket.once('close', () => { finish(() => { reject(new Error('broker closed without a reply')) }) })
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const cut = buffer.indexOf('\n')
      if (cut === -1) return
      finish(() => {
        try { resolve(JSON.parse(buffer.slice(0, cut)) as Record<string, unknown>) }
        catch (error: unknown) { reject(error instanceof Error ? error : new Error('broker reply was not JSON')) }
      })
    })
  })
}

/** Wait for one accepted proposal to reach a terminal public state. */
async function waitForTerminal(fixture: Fixture, proposalId: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 8_000
  for (;;) {
    const reply = await proposalRequest(fixture, { op: 'proposal.status', proposalId })
    if (reply.state !== 'PENDING') {
      if (reply.state !== 'SETTLED' && reply.state !== 'REFUSED' && reply.state !== 'INDETERMINATE') {
        throw new Error(`proposal ${proposalId} returned an unknown state`)
      }
      return reply
    }
    if (Date.now() > deadline) throw new Error(`proposal ${proposalId} did not terminate`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

/** Send one proposal-protocol request in the broker-minted retry namespace. */
function proposalRequest(fixture: Fixture, request: Record<string, unknown>): Promise<Record<string, unknown>> {
  return brokerRequest(fixture.brokerSocket, { ...request, proposalNamespace: fixture.proposalNamespace })
}

/** Wait for a test-owned process to exit without hiding a teardown leak. */
function waitForExit(child: ChildProcess, timeoutMs = 5_000): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode })
      return
    }
    const timer = setTimeout(() => { reject(new Error('child did not exit')) }, timeoutMs)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal })
    })
  })
}

/** Replace one test-owned state file with a distinct FIFO for each broker read. */
function startStateWriter(path: string, values: readonly string[]) {
  unlinkSync(path)
  const fifo = spawnSync('mkfifo', [path], { encoding: 'utf8' })
  expect(fifo.status, fifo.stderr).toBe(0)
  const child = spawn(process.execPath, [
    fileURLToPath(new URL('./fixtures/fifo-state-writer.ts', import.meta.url)),
    path,
    ...values,
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  const observations = new Promise<string>((resolve) => {
    let text = ''
    child.stdout.on('data', (chunk: Buffer) => { text += chunk.toString('utf8') })
    child.stdout.once('end', () => { resolve(text) })
  })
  return { child, observations }
}

/** Require one exact value per rendezvous with a different FIFO for the next read. */
async function expectStateReads(observations: Promise<string>, values: readonly string[]): Promise<void> {
  const rows = (await observations).trimEnd().split('\n').map(line => JSON.parse(line) as {
    index: number
    inode: number
    value: string
  })
  expect(rows).toEqual(values.map((value, index): { index: number; inode: unknown; value: string } => (
    { index, inode: expect.any(Number), value }
  )))
  for (let index = 1; index < rows.length; index += 1) {
    expect(rows[index]?.inode).not.toBe(rows[index - 1]?.inode)
  }
}

/** Stop one test-owned child and observe its real exit. */
async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await waitForExit(child)
}

/** Start a digest-only issuer whose default path signs exactly what it receives. */
async function startIssuer(
  tempDir: string,
  rootPrivateKey: KeyObject,
  responder?: IssuerResponder,
): Promise<{
  frames: IssuerFrame[]
  path: string
  close: () => Promise<void>
}> {
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
        if (typeof reply === 'object' && reply !== null && 'raw' in reply) {
          socket.end((reply as RawIssuerReply).raw)
        } else {
          socket.end(`${JSON.stringify(reply)}\n`)
        }
      }).catch(() => socket.destroy())
    })
    socket.on('error', () => { /* fixture teardown can close a pending reply */ })
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

/** Start one real broker with a test-owned root and issuer route. */
async function startFixture(responder?: IssuerResponder, options: FixtureOptions = {}): Promise<Fixture> {
  const tempDir = mkdtempSync(join(tmpdir(), 'aukora-broker-proposal-'))
  if (options.socketGroupAccess === true) chmodSync(tempDir, 0o710)
  const stateDir = join(tempDir, 'state')
  const brokerSocket = join(tempDir, 'broker.sock')
  const root = generateKeyPairSync('ed25519')
  const rootPublicKeyPem = root.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const selectedAuthority = options.subjectAuthorityKey === undefined
    ? undefined
    : subjectAuthorityFixture(options.subjectAuthorityKey, rootPublicKeyPem)
  const dynamicAuthorityBase = options.dynamicSubjectAuthorityKey === undefined
    ? undefined
    : subjectAuthorityFixture(options.dynamicSubjectAuthorityKey, rootPublicKeyPem)
  const kiraPolicyAuthority = dynamicAuthorityBase ?? selectedAuthority
  if (options.kiraPrivacy !== undefined
    && options.kiraSubject === undefined
    && kiraPolicyAuthority === undefined) {
    throw new Error('KIRA policy fixture requires subject authority')
  }
  const kiraRecallPolicy = options.kiraPrivacy === undefined
    ? undefined
    : {
      subject: options.kiraSubject ?? kiraPolicyAuthority?.subjectAuthority.subject ?? '',
      privacy: options.kiraPrivacy,
    }
  const authorityRequests: Readonly<BrokerAuthorityRequest>[] = []
  const issuer = await startIssuer(tempDir, root.privateKey, responder)
  const broker = await spawnBroker({
    socketPath: brokerSocket,
    stateDir,
    rootPublicKeyPem,
    issuerSocket: issuer.path,
    review: options.review ?? (async () => 'approved' as const),
    ...(options.socketGroupAccess === undefined ? {} : { socketGroupAccess: options.socketGroupAccess }),
    ...(options.activationDigest === null
      ? {}
      : { activationDigest: options.activationDigest ?? LIVE_DOOR_ACTIVATION }),
    ...(options.rendererId === null
      ? {}
      : { rendererId: options.rendererId ?? LIVE_DOOR_RENDERER }),
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(kiraRecallPolicy === undefined ? {} : { kiraRecallPolicy }),
    ...(selectedAuthority === undefined ? {} : selectedAuthority),
    ...(dynamicAuthorityBase === undefined ? {} : {
      rootControlState: dynamicAuthorityBase.rootControlState,
      subjectAuthorityExpectation: {
        subject: dynamicAuthorityBase.subjectAuthority.subject,
        activeControlDigest: dynamicAuthorityBase.subjectAuthority.activeControlDigest,
        activationDigest: dynamicAuthorityBase.subjectAuthority.activationDigest,
        audience: dynamicAuthorityBase.subjectAuthority.audience,
      },
      selectSubjectAuthority: (
        request: Readonly<BrokerAuthorityRequest>,
        signal: AbortSignal,
      ): SubjectAuthorityContextInput | Promise<SubjectAuthorityContextInput> => {
        authorityRequests.push(request)
        const selected = subjectAuthorityFixture(
          options.dynamicSubjectAuthorityKey ?? '',
          rootPublicKeyPem,
          request,
        ).subjectAuthority
        return options.selectDynamicAuthority?.(request, rootPublicKeyPem, selected, signal) ?? selected
      },
    }),
  })
  const opened = await brokerRequest(brokerSocket, { op: 'proposal.open' })
  if (typeof opened.proposalNamespace !== 'string') throw new Error('broker omitted its proposal namespace')
  const fixture: Fixture = {
    authorityRequests,
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

/** Start the broker entry with a raw parent that can corrupt one selection echo. */
async function startRawAuthorityFixture(
  key: string,
  transform: (
    request: Readonly<BrokerAuthorityRequest>,
    authority: SubjectAuthorityContextInput,
  ) => Record<string, unknown> | readonly Record<string, unknown>[],
): Promise<Fixture> {
  const tempDir = mkdtempSync(join(tmpdir(), 'aukora-broker-authority-raw-'))
  const stateDir = join(tempDir, 'state')
  const brokerSocket = join(tempDir, 'broker.sock')
  const root = generateKeyPairSync('ed25519')
  const rootPublicKeyPem = root.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const identity = subjectAuthorityFixture(key, rootPublicKeyPem)
  const expectation = {
    subject: identity.subjectAuthority.subject,
    activeControlDigest: identity.subjectAuthority.activeControlDigest,
    activationDigest: identity.subjectAuthority.activationDigest,
    audience: identity.subjectAuthority.audience,
  }
  mkdirSync(stateDir, { mode: 0o700 })
  bindIdentityControlState(stateDir, identity.rootControlState)
  const issuer = await startIssuer(tempDir, root.privateKey, (frame, rootPrivateKey) => {
    if (frame.op === 'admit.v5') return { ok: true }
    if (frame.op === 'authorize.v5') {
      return {
        ok: true,
        digest: frame.digest,
        signature: edSign(
          null,
          authorizationSignedMessageV5FromHex(frame.digest),
          rootPrivateKey,
        ).toString('base64'),
      }
    }
    return { ok: false, reason: 'issuer:unexpected-op' }
  })
  const authorityRequests: Readonly<BrokerAuthorityRequest>[] = []
  const broker = spawn(process.execPath, ['--', BROKER_ENTRY], {
    env: {
      ...scrubEnv(process.env),
      AUKORA_SOCKET: brokerSocket,
      AUKORA_STATE_DIR: stateDir,
      AUKORA_ROOT_PEM: rootPublicKeyPem,
      AUKORA_ISSUER_SOCKET: issuer.path,
      AUKORA_PARENT_REVIEW: '1',
      [PARENT_AUTHORITY_ENV]: '1',
      [ACTIVATION_DIGEST_ENV]: LIVE_DOOR_ACTIVATION,
      AUKORA_RENDERER_ID: LIVE_DOOR_RENDERER,
      [SUBJECT_AUTHORITY_EXPECTATION_ENV]: encodeSubjectAuthorityExpectation(expectation),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  broker.on('message', (message) => {
    if (typeof message !== 'object' || message === null) return
    if ((message as { type?: unknown }).type === BROKER_REVIEW_REQUEST) {
      const request = message as {
        reviewId: string
        proposalId: string
        artifactDigest: string
        operationDigest: string
        authorizationDigest: string
      }
      if (!broker.connected || broker.exitCode !== null || broker.signalCode !== null) return
      broker.send({
        type: BROKER_REVIEW_DECISION,
        reviewId: request.reviewId,
        proposalId: request.proposalId,
        artifactDigest: request.artifactDigest,
        operationDigest: request.operationDigest,
        authorizationDigest: request.authorizationDigest,
        decision: 'approved',
      }, () => {})
      return
    }
    if ((message as { type?: unknown }).type !== BROKER_AUTHORITY_REQUEST) return
    const request = Object.freeze({
      ...(message as BrokerAuthorityRequest),
      budget: Object.freeze({ ...(message as BrokerAuthorityRequest).budget }),
    })
    authorityRequests.push(request)
    const authority = subjectAuthorityFixture(key, rootPublicKeyPem, request).subjectAuthority
    if (!broker.connected || broker.exitCode !== null || broker.signalCode !== null) return
    try {
      const transformed = transform(request, authority)
      const frames = Array.isArray(transformed)
        ? transformed as readonly Record<string, unknown>[]
        : [transformed as Record<string, unknown>]
      for (const frame of frames) broker.send(frame, () => {})
    } catch {
      // Broker teardown owns this raw-fixture race.
    }
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('raw authority broker did not report readiness'))
      }, 5_000)
      const cleanup = (): void => {
        clearTimeout(timer)
        broker.removeListener('message', onMessage)
        broker.removeListener('error', onError)
        broker.removeListener('exit', onExit)
      }
      const onMessage = (message: unknown): void => {
        if ((message as { type?: unknown })?.type !== 'aukora:broker-ready') return
        cleanup()
        resolve()
      }
      const onError = (error: Error): void => {
        cleanup()
        reject(error)
      }
      const onExit = (): void => {
        cleanup()
        reject(new Error('raw authority broker exited before readiness'))
      }
      broker.on('message', onMessage)
      broker.once('error', onError)
      broker.once('exit', onExit)
    })
  } catch (error) {
    if (broker.exitCode === null && broker.signalCode === null) broker.kill('SIGTERM')
    await issuer.close()
    rmSync(tempDir, { recursive: true, force: true })
    throw error
  }
  const opened = await brokerRequest(brokerSocket, { op: 'proposal.open' })
  if (typeof opened.proposalNamespace !== 'string') throw new Error('broker omitted its proposal namespace')
  const fixture: Fixture = {
    authorityRequests,
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

function proposalIdOf(reply: Record<string, unknown>): string {
  if (typeof reply.proposalId !== 'string') throw new Error('proposal reply omitted its id')
  return reply.proposalId
}

function expectPublicReply(reply: Record<string, unknown>, keys: string[]): void {
  expect(Object.keys(reply).sort()).toEqual([...keys].sort())
  const serialized = JSON.stringify(reply)
  for (const forbidden of ['grant', 'signature', 'nonce', 'digest', 'claims', 'receipt', 'arguments']) {
    expect(serialized).not.toContain(forbidden)
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

function authorityEvidenceCount(stateDir: string): number {
  const path = join(stateDir, 'authority-evidence')
  return existsSync(path) ? readdirSync(path).length : 0
}

function kiraRecord(
  subject: string,
  privacy: 'local' | 'exportable' | 'private' = 'private',
  content: unknown = { remembered: true },
) {
  return stageKiraMemoryRecord({
    subject,
    kind: 'observation',
    source: [],
    content,
    links: [],
    privacy,
    createdAt: '2026-09-03T00:00:00Z',
  })
}

/** Send one pre-encoded frame so hostile JSON depth does not recurse in the test process. */
function rawBrokerRequest(socketPath: string, line: string): Promise<Record<string, unknown>> {
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
      finish(() => { reject(new Error('raw broker request timed out')) })
    }, 5_000)
    socket.once('connect', () => { socket.write(`${line}\n`) })
    socket.once('error', (error) => { finish(() => { reject(error) }) })
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const cut = buffer.indexOf('\n')
      if (cut === -1) return
      finish(() => { resolve(JSON.parse(buffer.slice(0, cut)) as Record<string, unknown>) })
    })
  })
}

function persistentExchange(fixture: Fixture): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(fixture.brokerSocket)
    const frames: Array<Record<string, unknown>> = []
    let buffer = ''
    let quietTimer: NodeJS.Timeout | undefined
    let settled = false
    const overall = setTimeout(() => {
      finish(() => { reject(new Error('persistent proposal exchange timed out')) })
    }, 5_000)
    const finish = (done: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(overall)
      clearTimeout(quietTimer)
      socket.destroy()
      done()
    }
    socket.once('connect', () => {
      socket.write(`${JSON.stringify({
        id: 'deposit-frame',
        op: 'proposal.deposit',
        proposalNamespace: fixture.proposalNamespace,
        callId: 'persistent-wire',
        toolName: 'memory.put',
        arguments: { key: 'persistent:wire', value: true },
      })}\n`)
    })
    socket.once('error', (error) => { finish(() => { reject(error) }) })
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      for (;;) {
        const cut = buffer.indexOf('\n')
        if (cut === -1) return
        const line = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 1)
        frames.push(JSON.parse(line) as Record<string, unknown>)
        if (frames.length === 1) {
          socket.write(`${JSON.stringify({
            id: 'status-frame',
            op: 'proposal.status',
            proposalNamespace: fixture.proposalNamespace,
            proposalId: proposalIdOf(frames[0]!),
          })}\n`)
        } else if (frames.length === 2) {
          quietTimer = setTimeout(() => { finish(() => { resolve(frames) }) }, 100)
        } else {
          finish(() => { reject(new Error('broker emitted an unsolicited proposal frame')) })
        }
      }
    })
  })
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0).reverse()) await fixture.close()
})

describe('broker-owned proposal protocol', () => {
  it('removes both active and legacy ambient broker route names', () => {
    expect(scrubEnv({
      NODE_PATH: '/tmp/attacker-modules',
      AUKORA_SOCKET: '/tmp/active-attacker.sock',
      AUKORA_BROKER_SOCKET: '/tmp/legacy-attacker.sock',
      AUKORA_SOCKET_GROUP_ACCESS: '1',
      SAFE_VALUE: 'retained',
    })).toEqual({ SAFE_VALUE: 'retained' })
  })

  it('does not inherit an ambient activation digest when the spawn option is absent', async () => {
    const fixture = await startFixture(undefined, {
      activationDigest: null,
      env: { ...process.env, [ACTIVATION_DIGEST_ENV]: 'ab'.repeat(32) },
    })
    expect(await brokerRequest(fixture.brokerSocket, { op: 'status' }))
      .toMatchObject({ ok: true, activationDigest: null })
  })

  it('publishes the installed-job route as 0710 directory plus 0660 socket', async () => {
    const fixture = await startFixture(undefined, { socketGroupAccess: true })
    const owner = processOwnership()
    expect(lstatSync(fixture.tempDir).mode & 0o777).toBe(0o710)
    const socket = lstatSync(fixture.brokerSocket)
    expect(socket.isSocket()).toBe(true)
    expect(socket.uid).toBe(owner.uid)
    expect(socket.gid).toBe(owner.gid)
    expect(socket.mode & 0o777).toBe(0o660)
  })

  it('keeps the default broker route owner-only', async () => {
    const fixture = await startFixture()
    expect(lstatSync(fixture.tempDir).mode & 0o777).toBe(0o700)
    expect(lstatSync(fixture.brokerSocket).mode & 0o777).toBe(0o600)
  })

  it('refuses installed group access through a directory wider than 0710', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'aukora-broker-group-route-'))
    const socketPath = join(tempDir, 'broker.sock')
    const stateDir = join(tempDir, 'state')
    chmodSync(tempDir, 0o750)
    const root = generateKeyPairSync('ed25519')
    const rootPublicKeyPem = root.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    try {
      await expect(spawnBroker({
        socketPath,
        stateDir,
        rootPublicKeyPem,
        socketGroupAccess: true,
      })).rejects.toThrow(BROKER_REFUSE.SOCKET_DIRECTORY_UNTRUSTED)
      expect(existsSync(socketPath)).toBe(false)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')(
    'rechecks activation after nonce reservation and reports the consumed authorization before effect',
    async () => {
      const activation = 'ab'.repeat(32)
      let enterReview: () => void = () => {}
      let releaseReview: () => void = () => {}
      const reviewEntered = new Promise<void>((resolve) => { enterReview = resolve })
      const reviewGate = new Promise<void>((resolve) => { releaseReview = resolve })
      const fixture = await startFixture(undefined, {
        activationDigest: activation,
        review: async () => {
          enterReview()
          await reviewGate
          return 'approved' as const
        },
      })
      const pending = await proposalRequest(fixture, {
        op: 'proposal.deposit',
        callId: 'activation-race',
        toolName: MEMORY_PUT,
        arguments: { key: 'activation:race', value: true },
      })
      const proposalId = proposalIdOf(pending)
      await reviewEntered

      const bindingPath = activationBindingPath(fixture.stateDir)
      const changedActivation = 'cd'.repeat(32)
      const states = [
        JSON.stringify({ activationDigest: activation, domain: 'aukora:activation-binding:v1' }),
        JSON.stringify({ activationDigest: changedActivation, domain: 'aukora:activation-binding:v1' }),
      ]
      const { child: writer, observations } = startStateWriter(bindingPath, states)
      try {
        releaseReview()
        const raced = await waitForTerminal(fixture, proposalId)
        expect(raced, JSON.stringify(raced)).toMatchObject({ state: 'INDETERMINATE' })
        expect(await waitForExit(writer)).toEqual({ code: 0, signal: null })
        await expectStateReads(observations, states)
        expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 1, objects: 0 })
      } finally {
        if (writer.exitCode === null && writer.signalCode === null) {
          writer.kill('SIGKILL')
          await waitForExit(writer).catch(() => {})
        }
      }
    },
    15_000,
  )

  it('settles through the real ToolRuntime plugin without returning authority artifacts', async () => {
    const fixture = await startFixture()
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

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('product-proposal'),
      name: MEMORY_PUT,
      arguments: { key: 'product:proposal', value: { actual: true } },
      agent,
    }) as { isError: boolean; value?: unknown }

    expect(result.isError).toBe(false)
    expect(result.value).toBeTypeOf('object')
    const value = result.value as Record<string, unknown>
    expect(value.ok).toBe(true)
    expect(value.proposalId).toMatch(/^[0-9a-f]{32}$/)
    expect(value.state).toBe('SETTLED')
    expect(value.receipt).toBeTypeOf('object')
    const receipt = value.receipt as Record<string, unknown>
    expect(receipt.requestDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(receipt.signature).toBeTypeOf('string')
    const rendered = JSON.stringify(result)
    for (const forbidden of ['grant', 'authorizationDigest', 'delegation', 'privateKey']) {
      expect(rendered).not.toContain(forbidden)
    }
    const auraLines = readFileSync(join(fixture.stateDir, 'aura.jsonl'), 'utf8').trim().split('\n')
    const auraEntry = JSON.parse(auraLines[0]!) as { receiptSha256: string }
    const receiptSha256 = createHash('sha256').update(canonicalJSON(value.receipt), 'utf8').digest('hex')
    expect(auraEntry.receiptSha256).toBe(receiptSha256)
    expect(existsSync(join(fixture.stateDir, 'receipts', `${receiptSha256}.json`))).toBe(true)
    expect(fixture.issuerFrames.map(frame => frame.op)).toEqual(['admit', 'authorize'])
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 1, nonces: 1, objects: 1 })
    const projection = JSON.parse(
      readFileSync(join(fixture.stateDir, 'memory', 'keys', 'product:proposal.json'), 'utf8'),
    ) as { contentSha256: string }
    expect(readFileSync(
      join(fixture.stateDir, 'memory', 'objects', `${projection.contentSha256}.json`),
      'utf8',
    )).toContain('"actual":true')
  })

  it('propagates a launch-selected subject context through the child without returning a v5 grant', async () => {
    const key = 'v5:subject'
    let reviewed: Record<string, unknown> | undefined
    const fixture = await startFixture((frame, rootPrivateKey) => {
      if (frame.op === 'admit.v5') return { ok: true }
      if (frame.op === 'authorize.v5') {
        return {
          ok: true,
          digest: frame.digest,
          signature: edSign(
            null,
            authorizationSignedMessageV5FromHex(frame.digest),
            rootPrivateKey,
          ).toString('base64'),
        }
      }
      return { ok: false, reason: 'issuer:unexpected-op' }
    }, {
      subjectAuthorityKey: key,
      review: async (request): Promise<'approved'> => {
        reviewed = request
        return 'approved'
      },
    })
    const pending = await proposalRequest(fixture, {
      op: 'proposal.deposit',
      callId: 'v5-subject-path',
      toolName: 'memory.put',
      arguments: { key, value: { subjectBound: true } },
    })
    const terminal = await waitForTerminal(fixture, proposalIdOf(pending))

    expect(terminal).toMatchObject({ ok: true, state: 'SETTLED' })
    expect(fixture.issuerFrames.map(frame => frame.op)).toEqual(['admit.v5', 'authorize.v5'])
    expect(Object.keys(fixture.issuerFrames[1] ?? {}).sort())
      .toEqual(['artifact', 'artifactDigest', 'digest', 'op'])
    expect(Object.keys(reviewed ?? {}).sort()).toEqual([
      'artifact', 'artifactDigest', 'authorizationDigest', 'expiresAt',
      'operationDigest', 'proposalId', 'reviewId', 'type',
    ])
    expect(terminal.receipt).toBeTypeOf('object')
    expect((terminal.receipt as Record<string, unknown>).signature).toBeTypeOf('string')
    expect(JSON.stringify({ pending, reviewed })).not.toContain('signature')
    for (const forbidden of ['grant', 'delegation', 'privateKey']) {
      expect(JSON.stringify({ pending, terminal, reviewed })).not.toContain(forbidden)
    }
    const authorityFiles = readdirSync(join(fixture.stateDir, 'authority-evidence'))
    expect(authorityFiles).toHaveLength(1)
    const authority = JSON.parse(readFileSync(
      join(fixture.stateDir, 'authority-evidence', authorityFiles[0] ?? ''),
      'utf8',
    )) as { grantDomain: string; subject: string }
    const activeControl = readIdentityControlState(fixture.stateDir)
    if (activeControl === null) throw new Error('fixture omitted its identity control head')
    expect(authority).toMatchObject({
      grantDomain: 'aukora:tool-grant:v5',
      subject: activeControl.subject,
    })
  })

  it('selects one exact v5 authority context per proposal over the parent IPC route', async () => {
    const key = 'V5:Dynamic'
    const fixture = await startFixture((frame, rootPrivateKey) => {
      if (frame.op === 'admit.v5') return { ok: true }
      if (frame.op === 'authorize.v5') {
        return {
          ok: true,
          digest: frame.digest,
          signature: edSign(
            null,
            authorizationSignedMessageV5FromHex(frame.digest),
            rootPrivateKey,
          ).toString('base64'),
        }
      }
      return { ok: false, reason: 'issuer:unexpected-op' }
    }, { dynamicSubjectAuthorityKey: key })
    const value = { selectedForOneProposal: true }
    const pending = await proposalRequest(fixture, {
      op: 'proposal.deposit',
      callId: 'v5-dynamic-path',
      toolName: MEMORY_PUT,
      arguments: { key, value },
    })
    const terminal = await waitForTerminal(fixture, proposalIdOf(pending))

    expect(terminal).toMatchObject({ ok: true, state: 'SETTLED' })
    expect(fixture.authorityRequests).toHaveLength(1)
    const selected = fixture.authorityRequests[0]
    expect(Object.keys(selected ?? {}).sort()).toEqual([
      'activationDigest', 'artifactDigest', 'audience', 'budget', 'expiresAt',
      'operationDigest', 'proposalId', 'resource', 'selectionId', 'toolName', 'type',
    ])
    expect(selected).toMatchObject({
      type: 'aukora:authority-request:v1',
      toolName: MEMORY_PUT,
      proposalId: pending.proposalId,
      activationDigest: LIVE_DOOR_ACTIVATION,
      audience: 'broker:primary',
      resource: `memory:key:${key}`,
      budget: {
        calls: 1,
        bytes: Buffer.byteLength(effectBody({ key, value }), 'utf8'),
        computeMs: 0,
        costMicrounits: 0,
      },
    })
    expect(terminal.receipt).toBeTypeOf('object')
    expect((terminal.receipt as Record<string, unknown>).signature).toBeTypeOf('string')
    expect(JSON.stringify({ pending, selected })).not.toContain('signature')
    expect(JSON.stringify({ pending, terminal, selected })).not.toMatch(/grant|delegation|privateKey/u)
    expect(fixture.issuerFrames.map(frame => frame.op)).toEqual(['admit.v5', 'authorize.v5'])
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 1, nonces: 1, objects: 1 })
  })

  it('settles one verified KIRA record through proposal-specific v5 authority', async () => {
    const fixture = await startFixture((frame, rootPrivateKey) => {
      if (frame.op === 'admit.v5') return { ok: true }
      if (frame.op === 'authorize.v5') {
        return {
          ok: true,
          digest: frame.digest,
          signature: edSign(
            null,
            authorizationSignedMessageV5FromHex(frame.digest),
            rootPrivateKey,
          ).toString('base64'),
        }
      }
      return { ok: false, reason: 'issuer:unexpected-op' }
    }, {
      dynamicSubjectAuthorityKey: 'kira:dynamic',
      kiraPrivacy: ['private'],
    })
    const control = readIdentityControlState(fixture.stateDir)
    if (control === null) throw new Error('fixture omitted its identity control head')
    const staged = kiraRecord(control.subject)
    const pending = await proposalRequest(fixture, {
      op: 'proposal.deposit',
      callId: 'kira-v5-settles',
      toolName: MEMORY_PUT,
      arguments: staged.memoryPut,
    })

    expect(await waitForTerminal(fixture, proposalIdOf(pending))).toMatchObject({
      ok: true,
      state: 'SETTLED',
    })
    expect(fixture.authorityRequests).toHaveLength(1)
    expect(fixture.issuerFrames.map(frame => frame.op)).toEqual(['admit.v5', 'authorize.v5'])
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 1, nonces: 1, objects: 1 })
    expect(authorityEvidenceCount(fixture.stateDir)).toBe(1)
  })

  it('refuses KIRA records on the unsubjected v4 proposal route', async () => {
    const subject = 'aukora:local:v4-must-not-write-kira'
    const staged = kiraRecord(subject)
    const fixture = await startFixture(undefined, {
      kiraSubject: subject,
      kiraPrivacy: ['private'],
    })
    const pending = await proposalRequest(fixture, {
      op: 'proposal.deposit',
      callId: 'kira-v4-refused',
      toolName: MEMORY_PUT,
      arguments: staged.memoryPut,
    })

    expect(await waitForTerminal(fixture, proposalIdOf(pending))).toMatchObject({
      ok: false,
      state: 'REFUSED',
      reason: BROKER_REFUSE.KIRA_WRITE_AUTHORITY_UNBOUND,
    })
    expect(fixture.issuerFrames).toEqual([])
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })

  it('refuses KIRA records on the direct v3 bearer route', async () => {
    const fixture = await startFixture()
    const staged = kiraRecord('aukora:local:v3-must-not-write-kira')
    const status = await brokerRequest(fixture.brokerSocket, { op: 'status' })
    if (typeof status.receiptKeyId !== 'string') throw new Error('broker status omitted receipt key identity')
    const { grant } = mintGrant({
      rootPrivateKey: fixture.rootPrivateKey,
      args: staged.memoryPut,
      exp: Math.floor(Date.now() / 1000) + 60,
      receiptKeyId: status.receiptKeyId,
    })

    expect(await brokerRequest(fixture.brokerSocket, {
      op: 'memory.put',
      toolName: MEMORY_PUT,
      arguments: staged.memoryPut,
      grant,
    })).toEqual({
      ok: false,
      state: 'REFUSED',
      reason: BROKER_REFUSE.KIRA_WRITE_AUTHORITY_UNBOUND,
    })
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })

  it.each([
    {
      label: 'an invalid KIRA key',
      reason: BROKER_REFUSE.KIRA_WRITE_KEY_INVALID,
      argumentsFor: (subject: string) => ({
        key: 'kira:not-a-digest',
        value: kiraRecord(subject).record,
      }),
    },
    {
      label: 'a malformed KIRA record',
      reason: BROKER_REFUSE.KIRA_WRITE_RECORD_MALFORMED,
      argumentsFor: () => ({ key: `kira:${'11'.repeat(32)}`, value: { malformed: true } }),
    },
    {
      label: 'a KIRA record whose identity no longer matches its bytes',
      reason: BROKER_REFUSE.KIRA_WRITE_RECORD_IDENTITY_MISMATCH,
      argumentsFor: (subject: string) => {
        const staged = kiraRecord(subject)
        return {
          key: staged.recordId,
          value: { ...staged.record, content: { changedAfterStaging: true } },
        }
      },
    },
    {
      label: 'a KIRA key that differs from the verified record id',
      reason: BROKER_REFUSE.KIRA_WRITE_KEY_MISMATCH,
      argumentsFor: (subject: string) => ({
        key: `kira:${'22'.repeat(32)}`,
        value: kiraRecord(subject).record,
      }),
    },
    {
      label: 'a KIRA record for another subject',
      reason: BROKER_REFUSE.KIRA_WRITE_SUBJECT_MISMATCH,
      argumentsFor: () => kiraRecord('aukora:foreign:subject').memoryPut,
    },
    {
      label: 'a KIRA record outside the parent privacy policy',
      reason: BROKER_REFUSE.KIRA_WRITE_PRIVACY_REFUSED,
      argumentsFor: (subject: string) => kiraRecord(subject, 'exportable').memoryPut,
    },
  ])('refuses $label before authority selection or settlement', async ({ reason, argumentsFor }) => {
    const fixture = await startFixture(undefined, {
      dynamicSubjectAuthorityKey: 'kira:refusal',
      kiraPrivacy: ['private'],
    })
    const control = readIdentityControlState(fixture.stateDir)
    if (control === null) throw new Error('fixture omitted its identity control head')
    const pending = await proposalRequest(fixture, {
      op: 'proposal.deposit',
      callId: `kira-refusal-${reason}`,
      toolName: MEMORY_PUT,
      arguments: argumentsFor(control.subject),
    })

    expect(await waitForTerminal(fixture, proposalIdOf(pending))).toMatchObject({
      ok: false,
      state: 'REFUSED',
      reason,
    })
    expect(fixture.authorityRequests).toEqual([])
    expect(fixture.issuerFrames).toEqual([])
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
    expect(authorityEvidenceCount(fixture.stateDir)).toBe(0)
  })

  it('refuses a KIRA record when the parent supplied no KIRA policy', async () => {
    const fixture = await startFixture(undefined, { dynamicSubjectAuthorityKey: 'kira:unconfigured' })
    const control = readIdentityControlState(fixture.stateDir)
    if (control === null) throw new Error('fixture omitted its identity control head')
    const pending = await proposalRequest(fixture, {
      op: 'proposal.deposit',
      callId: 'kira-policy-unconfigured',
      toolName: MEMORY_PUT,
      arguments: kiraRecord(control.subject).memoryPut,
    })

    expect(await waitForTerminal(fixture, proposalIdOf(pending))).toMatchObject({
      ok: false,
      state: 'REFUSED',
      reason: BROKER_REFUSE.KIRA_WRITE_UNCONFIGURED,
    })
    expect(fixture.authorityRequests).toEqual([])
    expect(fixture.issuerFrames).toEqual([])
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
    expect(authorityEvidenceCount(fixture.stateDir)).toBe(0)
  })

  it('refuses a dynamic selection that does not grant the requested exact resource', async () => {
    const key = 'v5:dynamic-mismatch'
    const fixture = await startFixture(undefined, {
      dynamicSubjectAuthorityKey: key,
      selectDynamicAuthority: (request, rootPublicKeyPem) => subjectAuthorityFixture(
        key,
        rootPublicKeyPem,
        Object.freeze({ ...request, resource: 'memory:key:different' }),
      ).subjectAuthority,
    })
    const pending = await proposalRequest(fixture, {
      op: 'proposal.deposit',
      callId: 'v5-dynamic-resource-mismatch',
      toolName: MEMORY_PUT,
      arguments: { key, value: { mustNotSettle: true } },
    })

    expect(await waitForTerminal(fixture, proposalIdOf(pending))).toMatchObject({
      ok: false,
      state: 'REFUSED',
      reason: BROKER_REFUSE.AUTHORITY_RESPONSE_MALFORMED,
    })
    expect(fixture.issuerFrames).toEqual([])
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })

  it.each([
    ['subject', (
      request: Readonly<BrokerAuthorityRequest>,
    ) => {
      const foreignRoot = generateKeyPairSync('ed25519').publicKey
        .export({ type: 'spki', format: 'pem' }).toString()
      return subjectAuthorityFixture('v5:dynamic-dimension', foreignRoot, request).subjectAuthority
    }],
    ['control', (
      _request: Readonly<BrokerAuthorityRequest>,
      _rootPublicKeyPem: string,
      authority: SubjectAuthorityContextInput,
    ) => authorityWithControlDigest(authority, '44'.repeat(32))],
    ['activation', (
      request: Readonly<BrokerAuthorityRequest>,
      rootPublicKeyPem: string,
    ) => subjectAuthorityFixture('v5:dynamic-dimension', rootPublicKeyPem, Object.freeze({
      ...request,
      activationDigest: '45'.repeat(32),
    })).subjectAuthority],
    ['audience', (
      request: Readonly<BrokerAuthorityRequest>,
      rootPublicKeyPem: string,
    ) => subjectAuthorityFixture('v5:dynamic-dimension', rootPublicKeyPem, Object.freeze({
      ...request,
      audience: 'broker:other',
    })).subjectAuthority],
    ['budget', (
      request: Readonly<BrokerAuthorityRequest>,
      rootPublicKeyPem: string,
    ) => subjectAuthorityFixture('v5:dynamic-dimension', rootPublicKeyPem, Object.freeze({
      ...request,
      budget: Object.freeze({ ...request.budget, bytes: request.budget.bytes + 1 }),
    })).subjectAuthority],
    ['expiry', (
      request: Readonly<BrokerAuthorityRequest>,
      rootPublicKeyPem: string,
    ) => subjectAuthorityFixture('v5:dynamic-dimension', rootPublicKeyPem, Object.freeze({
      ...request,
      expiresAt: request.expiresAt + 1,
    })).subjectAuthority],
  ])('refuses a selected authority with a mismatched %s', async (_dimension, mutate) => {
    const key = 'v5:dynamic-dimension'
    const fixture = await startFixture(undefined, {
      dynamicSubjectAuthorityKey: key,
      selectDynamicAuthority: (request, rootPublicKeyPem, authority) => {
        return mutate(request, rootPublicKeyPem, authority)
      },
    })
    const pending = await proposalRequest(fixture, {
      op: 'proposal.deposit',
      callId: `v5-dynamic-${_dimension}`,
      toolName: MEMORY_PUT,
      arguments: { key, value: { mustNotSettle: true } },
    })

    expect(await waitForTerminal(fixture, proposalIdOf(pending))).toMatchObject({
      ok: false,
      state: 'REFUSED',
      reason: BROKER_REFUSE.AUTHORITY_RESPONSE_MALFORMED,
    })
    expect(fixture.issuerFrames).toEqual([])
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
    expect(authorityEvidenceCount(fixture.stateDir)).toBe(0)
  })

  it.each([
    ['a mismatched artifact echo', (request: Readonly<BrokerAuthorityRequest>, authority: SubjectAuthorityContextInput) => ({
      ...request,
      type: BROKER_AUTHORITY_SELECTION,
      artifactDigest: '00'.repeat(32),
      authority,
    })],
    ['an extra response field', (request: Readonly<BrokerAuthorityRequest>, authority: SubjectAuthorityContextInput) => ({
      ...request,
      type: BROKER_AUTHORITY_SELECTION,
      authority,
      extra: true,
    })],
    ['a missing resource echo', (request: Readonly<BrokerAuthorityRequest>, authority: SubjectAuthorityContextInput) => {
      const { resource: _resource, ...withoutResource } = request
      return {
        ...withoutResource,
        type: BROKER_AUTHORITY_SELECTION,
        authority,
      }
    }],
  ])('refuses %s before review, issuer admission, or nonce burn', async (_label, transform) => {
    const key = 'v5:dynamic-raw'
    const fixture = await startRawAuthorityFixture(key, transform)
    const pending = await proposalRequest(fixture, {
      op: 'proposal.deposit',
      callId: `v5-dynamic-raw-${_label}`,
      toolName: MEMORY_PUT,
      arguments: { key, value: { mustNotSettle: true } },
    })

    expect(await waitForTerminal(fixture, proposalIdOf(pending))).toMatchObject({
      ok: false,
      state: 'REFUSED',
      reason: BROKER_REFUSE.AUTHORITY_RESPONSE_MALFORMED,
    })
    expect(fixture.authorityRequests).toHaveLength(1)
    expect(fixture.issuerFrames).toEqual([])
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })

  it('ignores an unknown selection id and accepts the exact matching response', async () => {
    const key = 'v5:dynamic-unknown-selection'
    const fixture = await startRawAuthorityFixture(key, (request, authority) => {
      const selection = {
        ...request,
        type: BROKER_AUTHORITY_SELECTION,
        authority,
      }
      return [
        { ...selection, selectionId: 'ff'.repeat(16) },
        selection,
      ]
    })
    const pending = await proposalRequest(fixture, {
      op: 'proposal.deposit',
      callId: 'v5-dynamic-unknown-selection',
      toolName: MEMORY_PUT,
      arguments: { key, value: { selectedExactlyOnce: true } },
    })

    expect(await waitForTerminal(fixture, proposalIdOf(pending))).toMatchObject({
      ok: true,
      state: 'SETTLED',
    })
    expect(fixture.authorityRequests).toHaveLength(1)
    expect(fixture.issuerFrames.map(frame => frame.op)).toEqual(['admit.v5', 'authorize.v5'])
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 1, nonces: 1, objects: 1 })
    expect(authorityEvidenceCount(fixture.stateDir)).toBe(1)
  })

  it('cancels an outstanding parent authority selector before broker shutdown completes', async () => {
    const key = 'v5:dynamic-shutdown'
    let selectionEntered: () => void = () => {}
    let releaseSelection: () => void = () => {}
    const entered = new Promise<void>((resolve) => { selectionEntered = resolve })
    let selectorAborted = false
    const fixture = await startFixture(undefined, {
      dynamicSubjectAuthorityKey: key,
      selectDynamicAuthority: (_request, _rootPublicKeyPem, authority, signal) => new Promise((resolve) => {
        selectionEntered()
        releaseSelection = () => { resolve(authority) }
        signal.addEventListener('abort', () => {
          selectorAborted = true
        }, { once: true })
      }),
    })
    const pending = await proposalRequest(fixture, {
      op: 'proposal.deposit',
      callId: 'v5-dynamic-shutdown',
      toolName: MEMORY_PUT,
      arguments: { key, value: { mustNotSettle: true } },
    })
    expect(pending).toMatchObject({ ok: true, state: 'PENDING' })
    await entered

    await stopChild(fixture.broker)

    expect(selectorAborted).toBe(true)
    releaseSelection()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(fixture.issuerFrames).toEqual([])
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })

  it('closes a direct server while its authority selector ignores cancellation', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'aukora-broker-authority-close-'))
    const stateDir = join(tempDir, 'state')
    const brokerSocket = join(tempDir, 'broker.sock')
    const root = generateKeyPairSync('ed25519')
    const rootPublicKeyPem = root.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const identity = subjectAuthorityFixture('v5:direct-close', rootPublicKeyPem)
    const issuer = await startIssuer(tempDir, root.privateKey)
    let selectionEntered: () => void = () => {}
    const entered = new Promise<void>((resolve) => { selectionEntered = resolve })
    let selectorAborted = false
    const server = await serve({
      socketPath: brokerSocket,
      stateDir,
      rootPublicKeyPem,
      issuerSocket: issuer.path,
      review: async () => 'approved' as const,
      activationDigest: LIVE_DOOR_ACTIVATION,
      rendererId: LIVE_DOOR_RENDERER,
      rootControlState: identity.rootControlState,
      subjectAuthorityExpectation: {
        subject: identity.subjectAuthority.subject,
        activeControlDigest: identity.subjectAuthority.activeControlDigest,
        activationDigest: identity.subjectAuthority.activationDigest,
        audience: identity.subjectAuthority.audience,
      },
      selectSubjectAuthority: (_request, signal) => new Promise(() => {
        selectionEntered()
        signal.addEventListener('abort', () => { selectorAborted = true }, { once: true })
      }),
    })
    try {
      const opened = await brokerRequest(brokerSocket, { op: 'proposal.open' })
      const pending = await brokerRequest(brokerSocket, {
        op: 'proposal.deposit',
        proposalNamespace: opened.proposalNamespace,
        callId: 'v5-direct-close',
        toolName: MEMORY_PUT,
        arguments: { key: 'v5:direct-close', value: { mustNotSettle: true } },
      })
      expect(pending).toMatchObject({ ok: true, state: 'PENDING' })
      await entered

      const closeDeadline = new Promise<never>((_resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error('direct broker close did not quiesce')) }, 1_000)
        timer.unref()
      })
      await Promise.race([server.close(), closeDeadline])

      expect(selectorAborted).toBe(true)
      expect(existsSync(brokerSocket)).toBe(false)
      expect(existsSync(join(stateDir, '.broker-active.lock'))).toBe(false)
      expect(worldCounts(stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
      expect(authorityEvidenceCount(stateDir)).toBe(0)
    } finally {
      await server.close().catch(() => {})
      await issuer.close()
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('refuses a direct legacy grant while dynamic v5 selection is configured', async () => {
    const key = 'v5:dynamic-legacy'
    const fixture = await startFixture(undefined, { dynamicSubjectAuthorityKey: key })
    const status = await brokerRequest(fixture.brokerSocket, { op: 'status' })
    if (typeof status.receiptKeyId !== 'string') throw new Error('broker status omitted receipt key identity')
    const argumentsValue = { key, value: { mustNotSettle: true } }
    const { grant } = mintGrant({
      rootPrivateKey: fixture.rootPrivateKey,
      args: argumentsValue,
      exp: Math.floor(Date.now() / 1000) + 60,
      receiptKeyId: status.receiptKeyId,
    })

    expect(await brokerRequest(fixture.brokerSocket, {
      op: 'memory.put',
      toolName: MEMORY_PUT,
      arguments: argumentsValue,
      grant,
    })).toEqual({
      ok: false,
      state: 'REFUSED',
      reason: BROKER_REFUSE.LEGACY_ROUTE_FORBIDDEN,
    })
    expect(fixture.authorityRequests).toEqual([])
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })

  it('refuses to restart identity-bound state without its subject authority', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'aukora-broker-identity-restart-'))
    const stateDir = join(tempDir, 'state')
    const brokerSocket = join(tempDir, 'broker.sock')
    const root = generateKeyPairSync('ed25519')
    const rootPublicKeyPem = root.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const identity = subjectAuthorityFixture('v5:restart', rootPublicKeyPem)
    const issuer = await startIssuer(tempDir, root.privateKey)
    let first: ChildProcess | undefined
    try {
      first = await spawnBroker({
        socketPath: brokerSocket,
        stateDir,
        rootPublicKeyPem,
        issuerSocket: issuer.path,
        review: () => 'approved',
        activationDigest: LIVE_DOOR_ACTIVATION,
        rendererId: LIVE_DOOR_RENDERER,
        ...identity,
      })
      await stopChild(first)
      first = undefined

      await expect(spawnBroker({
        socketPath: brokerSocket,
        stateDir,
        rootPublicKeyPem,
        issuerSocket: issuer.path,
        review: () => 'approved',
        activationDigest: LIVE_DOOR_ACTIVATION,
        rendererId: LIVE_DOOR_RENDERER,
      })).rejects.toThrow(BROKER_REFUSE.IDENTITY_CONTROL_UNBOUND)
    } finally {
      if (first !== undefined) await stopChild(first)
      await issuer.close()
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('refuses a mismatched control signer before publishing identity state', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'aukora-broker-identity-signer-'))
    const stateDir = join(tempDir, 'state')
    const selectedRoot = generateKeyPairSync('ed25519')
    const selectedRootPem = selectedRoot.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const wrongRoot = generateKeyPairSync('ed25519')
    const identity = subjectAuthorityFixture('v5:signer-mismatch', selectedRootPem)
    try {
      await expect(spawnBroker({
        socketPath: join(tempDir, 'broker.sock'),
        stateDir,
        rootPublicKeyPem: wrongRoot.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        activationDigest: LIVE_DOOR_ACTIVATION,
        rendererId: LIVE_DOOR_RENDERER,
        ...identity,
      })).rejects.toThrow(BROKER_REFUSE.IDENTITY_CONTROL_SIGNER_MISMATCH)
      expect(existsSync(identityControlStatePath(stateDir))).toBe(false)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('direct serve refuses an unbound or mismatched control before publishing identity state', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'aukora-broker-direct-identity-'))
    const selectedRoot = generateKeyPairSync('ed25519')
    const selectedRootPem = selectedRoot.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const wrongRoot = generateKeyPairSync('ed25519')
    const identity = subjectAuthorityFixture('v5:direct-serve', selectedRootPem)
    const unboundStateDir = join(tempDir, 'unbound-state')
    const mismatchedStateDir = join(tempDir, 'mismatched-state')
    try {
      expect(() => serve({
        socketPath: join(tempDir, 'unbound.sock'),
        stateDir: unboundStateDir,
        rootPublicKeyPem: selectedRootPem,
        activationDigest: LIVE_DOOR_ACTIVATION,
        rendererId: LIVE_DOOR_RENDERER,
        rootControlState: identity.rootControlState,
      })).toThrow(BROKER_REFUSE.IDENTITY_CONTROL_UNBOUND)
      expect(existsSync(identityControlStatePath(unboundStateDir))).toBe(false)

      expect(() => serve({
        socketPath: join(tempDir, 'mismatched.sock'),
        stateDir: mismatchedStateDir,
        rootPublicKeyPem: wrongRoot.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        activationDigest: LIVE_DOOR_ACTIVATION,
        rendererId: LIVE_DOOR_RENDERER,
        ...identity,
      })).toThrow(BROKER_REFUSE.IDENTITY_CONTROL_SIGNER_MISMATCH)
      expect(existsSync(identityControlStatePath(mismatchedStateDir))).toBe(false)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('re-reads identity control after review and refuses before nonce admission when it changes', async () => {
    const key = 'v5:control-change'
    let controlPath = ''
    const fixture = await startFixture((frame, rootPrivateKey) => {
      if (frame.op === 'admit.v5') return { ok: true }
      if (frame.op === 'authorize.v5') {
        return {
          ok: true,
          digest: frame.digest,
          signature: edSign(
            null,
            authorizationSignedMessageV5FromHex(frame.digest),
            rootPrivateKey,
          ).toString('base64'),
        }
      }
      return { ok: false, reason: 'issuer:unexpected-op' }
    }, {
      subjectAuthorityKey: key,
      review: async (): Promise<'approved'> => {
        writeFileSync(controlPath, '{"not":"a root control state"}', { mode: 0o600 })
        return 'approved'
      },
    })
    controlPath = identityControlStatePath(fixture.stateDir)
    const pending = await proposalRequest(fixture, {
      op: 'proposal.deposit',
      callId: 'v5-control-change',
      toolName: 'memory.put',
      arguments: { key, value: { mustNotSettle: true } },
    })
    expect(await waitForTerminal(fixture, proposalIdOf(pending))).toMatchObject({
      ok: false,
      state: 'REFUSED',
      reason: BROKER_REFUSE.IDENTITY_CONTROL_STATE_MALFORMED,
    })
    expect(fixture.issuerFrames).toEqual([])
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })

  it.skipIf(process.platform === 'win32').each([
    ['refuses a control replacement at check-at-use before nonce reservation', true],
    ['settles when the same control remains active through check-at-use', false],
  ])('%s', async (_label, replaceControl) => {
    const key = 'v5:control-race'
    let enterReview: () => void = () => {}
    let releaseReview: () => void = () => {}
    const reviewEntered = new Promise<void>((resolve) => { enterReview = resolve })
    const reviewGate = new Promise<void>((resolve) => { releaseReview = resolve })
    // The reader accepts a regular leaf only. Sequence the replacement at the
    // grant authorization: the earlier checks have accepted and the issuer's
    // two expected operations occur, so the next check-at-use read is the later
    // grant-verification checkpoint, not the post-review one.
    const control: { path?: string } = {}
    const malformedControl = '{"not":"the admitted root control"}'
    const fixture = await startFixture((frame, rootPrivateKey) => {
      if (frame.op === 'admit.v5') return { ok: true }
      if (frame.op === 'authorize.v5') {
        if (replaceControl) {
          if (control.path === undefined) throw new Error('control path was not resolved before authorization')
          writeFileSync(control.path, malformedControl, { mode: 0o600 })
        }
        return {
          ok: true,
          digest: frame.digest,
          signature: edSign(
            null,
            authorizationSignedMessageV5FromHex(frame.digest),
            rootPrivateKey,
          ).toString('base64'),
        }
      }
      return { ok: false, reason: 'issuer:unexpected-op' }
    }, {
      subjectAuthorityKey: key,
      review: async (): Promise<'approved'> => {
        enterReview()
        await reviewGate
        return 'approved'
      },
    })
    const pending = await proposalRequest(fixture, {
      op: 'proposal.deposit',
      callId: 'v5-control-race',
      toolName: MEMORY_PUT,
      arguments: { key, value: { mustNotSettle: true } },
    })
    const proposalId = proposalIdOf(pending)
    await reviewEntered
    control.path = identityControlStatePath(fixture.stateDir)
    releaseReview()
    const terminal = await waitForTerminal(fixture, proposalId)
    if (replaceControl) {
      expect(terminal).toMatchObject({
        ok: false,
        state: 'REFUSED',
        reason: BROKER_REFUSE.IDENTITY_CONTROL_STATE_MALFORMED,
      })
      expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
      expect(authorityEvidenceCount(fixture.stateDir)).toBe(0)
      // Both expected issuer operations ran before the replaced leaf refused at
      // the later grant-verification check, and no effect followed.
      expect(fixture.issuerFrames.map(frame => frame.op)).toEqual(['admit.v5', 'authorize.v5'])
    } else {
      expect(terminal, JSON.stringify(terminal)).toMatchObject({ ok: true, state: 'SETTLED' })
      expect(worldCounts(fixture.stateDir)).toEqual({ aura: 1, nonces: 1, objects: 1 })
      expect(authorityEvidenceCount(fixture.stateDir)).toBe(1)
      expect(fixture.issuerFrames.map(frame => frame.op)).toEqual(['admit.v5', 'authorize.v5'])
    }
  }, 15_000)

  it('refuses a direct legacy grant on a v5-selected broker before nonce admission', async () => {
    const fixture = await startFixture(undefined, {
      subjectAuthorityKey: 'v5:legacy-route',
    })
    const status = await brokerRequest(fixture.brokerSocket, { op: 'status' })
    if (typeof status.receiptKeyId !== 'string') throw new Error('broker status omitted receipt key identity')
    const argumentsValue = { key: 'v5:legacy-route', value: { mustNotSettle: true } }
    const { grant } = mintGrant({
      rootPrivateKey: fixture.rootPrivateKey,
      args: argumentsValue,
      exp: Math.floor(Date.now() / 1000) + 60,
      receiptKeyId: status.receiptKeyId,
    })

    expect(await brokerRequest(fixture.brokerSocket, {
      op: 'memory.put',
      toolName: 'memory.put',
      arguments: argumentsValue,
      grant,
    })).toEqual({
      ok: false,
      state: 'REFUSED',
      reason: BROKER_REFUSE.LEGACY_ROUTE_FORBIDDEN,
    })
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })

  it('refuses namespace allocation when the proposal route is unavailable', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'aukora-broker-proposal-unavailable-'))
    const stateDir = join(tempDir, 'state')
    const brokerSocket = join(tempDir, 'broker.sock')
    const root = generateKeyPairSync('ed25519')
    const broker = await spawnBroker({
      socketPath: brokerSocket,
      stateDir,
      rootPublicKeyPem: root.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    })
    try {
      for (let attempt = 0; attempt <= BROKER_PROPOSAL_MAX_ENTRIES; attempt += 1) {
        expect(await brokerRequest(brokerSocket, { op: 'proposal.open' })).toEqual({
          ok: false,
          state: 'REFUSED',
          reason: BROKER_REFUSE.PROPOSAL_ROUTE_UNAVAILABLE,
        })
      }
      expect(worldCounts(stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
    } finally {
      await stopChild(broker)
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('settles exact bytes while public replies expose no authority artifact', async () => {
    const fixture = await startFixture()
    const pending = await proposalRequest(fixture, {
      op: 'proposal.deposit',
      callId: 'honest-1',
      toolName: 'memory.put',
      arguments: { key: 'honest', value: { canary: 'private-proposal-value' } },
    })
    expectPublicReply(pending, ['ok', 'proposalId', 'state'])
    expect(pending).toMatchObject({ ok: true, state: 'PENDING' })
    expect(proposalIdOf(pending)).toMatch(/^[0-9a-f]{32}$/)

    const terminal = await waitForTerminal(fixture, proposalIdOf(pending))
    expect(Object.keys(terminal).sort()).toEqual(['ok', 'proposalId', 'receipt', 'state'])
    expect(terminal).toMatchObject({ ok: true, proposalId: proposalIdOf(pending), state: 'SETTLED' })
    expect(terminal.receipt).toBeTypeOf('object')
    const serializedTerminal = JSON.stringify(terminal)
    for (const forbidden of ['grant', 'authorizationDigest', 'delegation', 'privateKey', 'arguments']) {
      expect(serializedTerminal).not.toContain(forbidden)
    }
    const receiptSha256 = createHash('sha256').update(canonicalJSON(terminal.receipt), 'utf8').digest('hex')
    const auraLines = readFileSync(join(fixture.stateDir, 'aura.jsonl'), 'utf8').trim().split('\n')
    const auraEntry = JSON.parse(auraLines[0]!) as { receiptSha256: string }
    expect(auraEntry.receiptSha256).toBe(receiptSha256)
    const persistedReceiptFile = join(fixture.stateDir, 'receipts', `${receiptSha256}.json`)
    expect(existsSync(persistedReceiptFile)).toBe(true)
    expect(readFileSync(persistedReceiptFile, 'utf8')).toBe(`${canonicalJSON(terminal.receipt)}\n`)
    expect(fixture.issuerFrames.map(frame => frame.op)).toEqual(['admit', 'authorize'])
    for (const frame of fixture.issuerFrames) {
      expect(frame.digest).toMatch(/^[0-9a-f]{64}$/)
      if (frame.op === 'admit') {
        expect(Object.keys(frame).sort()).toEqual(['digest', 'op'])
      } else {
        expect(Object.keys(frame).sort()).toEqual(['artifact', 'artifactDigest', 'digest', 'op'])
        expect(frame.artifactDigest).toMatch(/^[0-9a-f]{64}$/)
      }
    }
    const objects = readdirSync(join(fixture.stateDir, 'memory', 'objects'))
    expect(objects).toHaveLength(1)
    expect(readFileSync(join(fixture.stateDir, 'memory', 'objects', objects[0]!), 'utf8')).toContain('private-proposal-value')
    expect(readFileSync(join(fixture.stateDir, 'aura.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1)
  })

  it('emits exactly one authority-free frame for each persistent request', async () => {
    const fixture = await startFixture()
    const frames = await persistentExchange(fixture)
    expect(frames).toHaveLength(2)
    expectPublicReply(frames[0]!, ['id', 'ok', 'proposalId', 'state'])
    expectPublicReply(frames[1]!, ['id', 'ok', 'proposalId', 'state'])
    expect(frames.map(frame => frame.id)).toEqual(['deposit-frame', 'status-frame'])
  })

  it('refuses a recursively encoded transport id without terminating the broker', async () => {
    const fixture = await startFixture()
    const depth = 10_000
    const recursiveId = `${'['.repeat(depth)}0${']'.repeat(depth)}`
    const line = `{"id":${recursiveId},"op":"proposal.open"}`
    expect(Buffer.byteLength(line, 'utf8')).toBeLessThan(MAX_FRAME_BYTES)
    expect(await rawBrokerRequest(fixture.brokerSocket, line)).toEqual({
      ok: false,
      state: 'REFUSED',
      reason: BROKER_REFUSE.REQUEST_ID_INVALID,
    })
    expect(fixture.broker.exitCode).toBeNull()
    expect(await brokerRequest(fixture.brokerSocket, { id: 'alive', op: 'status' }))
      .toMatchObject({ id: 'alive', ok: true })
  })

  it('owns namespaced call-id idempotency before and after settlement', async () => {
    let releaseAuthorization: () => void = () => {}
    const authorizationGate = new Promise<void>((resolve) => { releaseAuthorization = resolve })
    const fixture = await startFixture(async (frame, key) => {
      if (frame.op === 'admit') return { ok: true }
      await authorizationGate
      return {
        ok: true,
        digest: frame.digest,
        signature: edSign(null, authorizationSignedMessageFromHex(frame.digest), key).toString('base64'),
      }
    })
    const request = {
      op: 'proposal.deposit',
      callId: 'idempotent-1',
      toolName: 'memory.put',
      arguments: { key: 'idempotent', value: 1 },
    }
    const first = await proposalRequest(fixture, request)
    const retry = await proposalRequest(fixture, request)
    expect(first).toMatchObject({ ok: true, state: 'PENDING' })
    expect(retry).toEqual(first)
    const conflict = await proposalRequest(fixture, {
      ...request,
      arguments: { key: 'idempotent', value: 2 },
    })
    expect(conflict).toEqual({
      ok: false,
      state: 'REFUSED',
      reason: BROKER_REFUSE.PROPOSAL_CALL_ID_REUSED,
    })
    releaseAuthorization()
    const terminal = await waitForTerminal(fixture, proposalIdOf(first))
    expect(await proposalRequest(fixture, request)).toEqual(terminal)
    expect(fixture.issuerFrames.map(frame => frame.op)).toEqual(['admit', 'authorize'])
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 1, nonces: 1, objects: 1 })
  })

  it('does not alias identical call ids across broker-minted namespaces', async () => {
    const fixture = await startFixture()
    const second = await brokerRequest(fixture.brokerSocket, { op: 'proposal.open' })
    expectPublicReply(second, ['ok', 'proposalNamespace'])
    if (typeof second.proposalNamespace !== 'string') throw new Error('second namespace was absent')
    const request = {
      op: 'proposal.deposit',
      callId: 'shared-provider-call-id',
      toolName: 'memory.put',
      arguments: { key: 'namespace:one', value: true },
    }
    const first = await proposalRequest(fixture, request)
    const other = await brokerRequest(fixture.brokerSocket, {
      ...request,
      proposalNamespace: second.proposalNamespace,
      arguments: { key: 'namespace:two', value: true },
    })
    expect(proposalIdOf(other)).not.toBe(proposalIdOf(first))
    expect(await brokerRequest(fixture.brokerSocket, {
      op: 'proposal.status',
      proposalNamespace: second.proposalNamespace,
      proposalId: proposalIdOf(first),
    })).toEqual({ ok: false, state: 'REFUSED', reason: BROKER_REFUSE.PROPOSAL_UNAVAILABLE })
  })

  it('rejects authority riders and enforces UTF-8 and effect-body ceilings', async () => {
    const fixture = await startFixture()
    const base = {
      op: 'proposal.deposit',
      callId: 'closed-frame',
      toolName: 'memory.put',
      arguments: { key: 'closed', value: 1 },
    }
    for (const rider of ['grant', 'signature', 'nonce', 'exp', 'definitionId', 'operationDigest', 'receiptKeyId', 'version']) {
      const refusal = await proposalRequest(fixture, { ...base, [rider]: 'attacker-owned' })
      expect(refusal).toEqual({ ok: false, state: 'REFUSED', reason: BROKER_REFUSE.PROPOSAL_FRAME_NOT_EXACT })
    }
    expect(fixture.issuerFrames).toHaveLength(0)

    const exactCallId = '💚'.repeat(BROKER_PROPOSAL_MAX_CALL_ID_BYTES / 4)
    const exactCall = await proposalRequest(fixture, { ...base, callId: exactCallId })
    expect(exactCall).toMatchObject({ ok: true, state: 'PENDING' })
    const longCall = await proposalRequest(fixture, { ...base, callId: `${exactCallId}💚` })
    expect(longCall).toEqual({ ok: false, state: 'REFUSED', reason: BROKER_REFUSE.PROPOSAL_CALL_ID_INVALID })

    const emptyBytes = Buffer.byteLength(effectBody({ key: 'size', value: '' }), 'utf8')
    const exactValue = 'x'.repeat(BROKER_PROPOSAL_MAX_EFFECT_BYTES - emptyBytes)
    expect(Buffer.byteLength(effectBody({ key: 'size', value: exactValue }), 'utf8')).toBe(BROKER_PROPOSAL_MAX_EFFECT_BYTES)
    const exactBody = await proposalRequest(fixture, {
      ...base,
      callId: 'exact-body',
      arguments: { key: 'size', value: exactValue },
    })
    expect(exactBody).toMatchObject({ ok: true, state: 'PENDING' })
    const oversized = await proposalRequest(fixture, {
      ...base,
      callId: 'oversized-body',
      arguments: { key: 'size', value: `${exactValue}x` },
    })
    expect(oversized).toEqual({ ok: false, state: 'REFUSED', reason: BROKER_REFUSE.PROPOSAL_ARGUMENTS_TOO_LARGE })

    let multiCount = Math.floor((BROKER_PROPOSAL_MAX_EFFECT_BYTES - emptyBytes) / 4)
    while (Buffer.byteLength(effectBody({ key: 'size', value: '💚'.repeat(multiCount + 1) }), 'utf8') <= BROKER_PROPOSAL_MAX_EFFECT_BYTES) multiCount += 1
    while (Buffer.byteLength(effectBody({ key: 'size', value: '💚'.repeat(multiCount) }), 'utf8') > BROKER_PROPOSAL_MAX_EFFECT_BYTES) multiCount -= 1
    expect(await proposalRequest(fixture, {
      ...base,
      callId: 'multibyte-within-limit',
      arguments: { key: 'size', value: '💚'.repeat(multiCount) },
    })).toMatchObject({ ok: true, state: 'PENDING' })
    expect(await proposalRequest(fixture, {
      ...base,
      callId: 'multibyte-over-limit',
      arguments: { key: 'size', value: '💚'.repeat(multiCount + 1) },
    })).toEqual({ ok: false, state: 'REFUSED', reason: BROKER_REFUSE.PROPOSAL_ARGUMENTS_TOO_LARGE })
  })

  it('retains exactly sixteen process-lifetime occurrences without eviction', async () => {
    const fixture = await startFixture()
    const accepted = []
    for (let index = 0; index < BROKER_PROPOSAL_MAX_ENTRIES; index += 1) {
      accepted.push(await proposalRequest(fixture, {
        op: 'proposal.deposit',
        callId: `capacity-${index}`,
        toolName: 'memory.put',
        arguments: { key: `capacity:${index}`, value: index },
      }))
    }
    expect(accepted.every(reply => reply.ok === true)).toBe(true)
    const seventeenth = await proposalRequest(fixture, {
      op: 'proposal.deposit',
      callId: 'capacity-overflow',
      toolName: 'memory.put',
      arguments: { key: 'capacity:overflow', value: true },
    })
    expect(seventeenth).toEqual({ ok: false, state: 'REFUSED', reason: BROKER_REFUSE.PROPOSAL_TABLE_FULL })
    const terminal = await Promise.all(accepted.map(reply => waitForTerminal(fixture, proposalIdOf(reply))))
    expect(terminal.every(reply => reply.ok === true && reply.state === 'SETTLED')).toBe(true)
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 16, nonces: 16, objects: 16 })
    expect(await proposalRequest(fixture, {
      op: 'proposal.deposit',
      callId: 'capacity-still-full',
      toolName: 'memory.put',
      arguments: { key: 'capacity:still-full', value: true },
    })).toEqual({ ok: false, state: 'REFUSED', reason: BROKER_REFUSE.PROPOSAL_TABLE_FULL })
  })

  it('serializes complete issuer admission and authorization pairs', async () => {
    let releaseFirstAdmission: () => void = () => {}
    const firstAdmissionGate = new Promise<void>((resolve) => { releaseFirstAdmission = resolve })
    let held = false
    const fixture = await startFixture(async (frame, key) => {
      if (!held && frame.op === 'admit') {
        held = true
        await firstAdmissionGate
      }
      return frame.op === 'admit'
        ? { ok: true }
        : {
          ok: true,
          digest: frame.digest,
          signature: edSign(null, authorizationSignedMessageFromHex(frame.digest), key).toString('base64'),
        }
    })
    const deposits = await Promise.all(['one', 'two'].map(callId => proposalRequest(fixture, {
      op: 'proposal.deposit',
      callId,
      toolName: 'memory.put',
      arguments: { key: `fifo:${callId}`, value: callId },
    })))
    const admissionDeadline = Date.now() + 5_000
    while (fixture.issuerFrames.length < 1) {
      if (Date.now() > admissionDeadline) throw new Error('first admission never reached issuer')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(fixture.issuerFrames).toHaveLength(1)
    releaseFirstAdmission()
    await Promise.all(deposits.map(reply => waitForTerminal(fixture, proposalIdOf(reply))))
    expect(fixture.issuerFrames.map(frame => frame.op)).toEqual(['admit', 'authorize', 'admit', 'authorize'])
    expect(fixture.issuerFrames[0]?.digest).toBe(fixture.issuerFrames[1]?.digest)
    expect(fixture.issuerFrames[2]?.digest).toBe(fixture.issuerFrames[3]?.digest)
    expect(fixture.issuerFrames[0]?.digest).not.toBe(fixture.issuerFrames[2]?.digest)
  })

  it('collapses hostile issuer replies to broker-owned reasons', async () => {
    const cases: Array<{ name: string; responder: IssuerResponder; reason: string }> = [
      {
        name: 'explicit refusal',
        responder: () => ({ ok: false, reason: 'issuer:secret-internal-reason' }),
        reason: BROKER_REFUSE.ISSUER_REFUSED,
      },
      {
        name: 'extra field',
        responder: frame => frame.op === 'admit' ? { ok: true, rider: true } : { ok: true },
        reason: BROKER_REFUSE.ISSUER_RESPONSE_MALFORMED,
      },
      {
        name: 'wrong digest',
        responder: (frame, key) => frame.op === 'admit'
          ? { ok: true }
          : {
            ok: true,
            digest: '0'.repeat(64),
            signature: edSign(null, authorizationSignedMessageFromHex(frame.digest), key).toString('base64'),
          },
        reason: BROKER_REFUSE.ISSUER_RESPONSE_MALFORMED,
      },
      {
        name: 'noncanonical signature',
        responder: frame => frame.op === 'admit'
          ? { ok: true }
          : { ok: true, digest: frame.digest, signature: 'AAAA' },
        reason: BROKER_REFUSE.ISSUER_RESPONSE_MALFORMED,
      },
      {
        name: 'extra frame',
        responder: () => ({ raw: '{"ok":true}\n{"ok":true}\n' }),
        reason: BROKER_REFUSE.ISSUER_TRANSPORT_FAILED,
      },
      {
        name: 'invalid json',
        responder: () => ({ raw: 'not-json\n' }),
        reason: BROKER_REFUSE.ISSUER_TRANSPORT_FAILED,
      },
      {
        name: 'unterminated frame',
        responder: () => ({ raw: '{"ok":true}' }),
        reason: BROKER_REFUSE.ISSUER_TRANSPORT_FAILED,
      },
      {
        name: 'oversized frame',
        responder: () => ({ raw: `${'x'.repeat(MAX_FRAME_BYTES + 1)}\n` }),
        reason: BROKER_REFUSE.ISSUER_TRANSPORT_FAILED,
      },
    ]
    for (const row of cases) {
      const fixture = await startFixture(row.responder)
      const pending = await proposalRequest(fixture, {
        op: 'proposal.deposit',
        callId: `hostile-${row.name}`,
        toolName: 'memory.put',
        arguments: { key: `hostile:${row.name.replaceAll(' ', '-')}`, value: 'issuer-canary' },
      })
      const terminal = await waitForTerminal(fixture, proposalIdOf(pending))
      expectPublicReply(terminal, ['ok', 'proposalId', 'reason', 'state'])
      expect(terminal).toMatchObject({ ok: false, state: 'REFUSED', reason: row.reason })
      expect(JSON.stringify(terminal)).not.toContain('secret-internal')
      expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
    }
  })

  it('refuses a v3 grant on a bound broker without waiting for proposal authorization', async () => {
    let releaseAuthorization: () => void = () => {}
    const authorizationGate = new Promise<void>((resolve) => { releaseAuthorization = resolve })
    const fixture = await startFixture(async (frame, key) => {
      if (frame.op === 'admit') return { ok: true }
      await authorizationGate
      return {
        ok: true,
        digest: frame.digest,
        signature: edSign(null, authorizationSignedMessageFromHex(frame.digest), key).toString('base64'),
      }
    })
    const proposal = await proposalRequest(fixture, {
      op: 'proposal.deposit',
      callId: 'issuer-wait-does-not-block-v3',
      toolName: 'memory.put',
      arguments: { key: 'issuer:wait', value: 'proposal' },
    })
    const frameDeadline = Date.now() + 5_000
    while (fixture.issuerFrames.length < 2) {
      if (Date.now() > frameDeadline) throw new Error('proposal never reached issuer authorization')
      await new Promise(resolve => setTimeout(resolve, 10))
    }

    const status = await brokerRequest(fixture.brokerSocket, { op: 'status' })
    if (typeof status.receiptKeyId !== 'string') throw new Error('broker status omitted receipt key identity')
    const argumentsValue = { key: 'legacy:while-proposal-waits', value: 'settled' }
    const { grant } = mintGrant({
      rootPrivateKey: fixture.rootPrivateKey,
      args: argumentsValue,
      exp: Math.floor(Date.now() / 1000) + 60,
      receiptKeyId: status.receiptKeyId,
    })
    expect(await brokerRequest(fixture.brokerSocket, {
      op: 'memory.put',
      toolName: 'memory.put',
      arguments: argumentsValue,
      grant,
    }, 1_000)).toMatchObject({
      ok: false,
      state: 'REFUSED',
      reason: BROKER_REFUSE.ACTIVATION_UNBOUND,
    })

    releaseAuthorization()
    expect(await waitForTerminal(fixture, proposalIdOf(proposal))).toMatchObject({ ok: true, state: 'SETTLED' })
  })

  it('cancels pre-effect approval work before releasing the route and state lease', async () => {
    let releaseAuthorization: () => void = () => {}
    const authorizationGate = new Promise<void>((resolve) => { releaseAuthorization = resolve })
    const fixture = await startFixture(async (frame, key) => {
      if (frame.op === 'admit') return { ok: true }
      await authorizationGate
      return {
        ok: true,
        digest: frame.digest,
        signature: edSign(null, authorizationSignedMessageFromHex(frame.digest), key).toString('base64'),
      }
    })
    await proposalRequest(fixture, {
      op: 'proposal.deposit',
      callId: 'shutdown-drain',
      toolName: 'memory.put',
      arguments: { key: 'shutdown:drain', value: true },
    })
    const frameDeadline = Date.now() + 5_000
    while (fixture.issuerFrames.length < 2) {
      if (Date.now() > frameDeadline) throw new Error('proposal never reached issuer authorization')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    const stopStarted = Date.now()
    fixture.broker.kill('SIGTERM')
    expect(await waitForExit(fixture.broker, 1_000)).toEqual({ code: 0, signal: null })
    expect(Date.now() - stopStarted).toBeLessThan(1_000)
    releaseAuthorization()
    expect(existsSync(fixture.brokerSocket)).toBe(false)
    expect(existsSync(join(fixture.stateDir, '.broker-active.lock'))).toBe(false)
    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })

  it('refuses preflight before effect when expected receipt is missing from verified Aura history', async () => {
    const fixture = await startFixture()
    const initial = await proposalRequest(fixture, {
      op: 'proposal.deposit',
      callId: 'call-initial',
      toolName: 'memory.put',
      arguments: { key: 'initial-key', value: { step: 1 } },
    })
    const initialTerminal = await waitForTerminal(fixture, proposalIdOf(initial))
    expect(initialTerminal).toMatchObject({ ok: true, state: 'SETTLED' })
    const receiptSha256 = createHash('sha256').update(canonicalJSON(initialTerminal.receipt), 'utf8').digest('hex')
    const receiptFile = join(fixture.stateDir, 'receipts', `${receiptSha256}.json`)
    expect(existsSync(receiptFile)).toBe(true)

    unlinkSync(receiptFile)

    const second = await proposalRequest(fixture, {
      op: 'proposal.deposit',
      callId: 'call-second',
      toolName: 'memory.put',
      arguments: { key: 'second-key', value: { step: 2 } },
    })
    const secondTerminal = await waitForTerminal(fixture, proposalIdOf(second))
    expect(secondTerminal).toMatchObject({
      ok: false,
      state: 'REFUSED',
      reason: 'broker:aura-preflight (receipt:missing-aura-receipt)',
    })

    expect(worldCounts(fixture.stateDir)).toEqual({ aura: 1, nonces: 1, objects: 1 })
    expect(existsSync(join(fixture.stateDir, 'memory', 'keys', 'second-key.json'))).toBe(false)
  })

  it('refuses before the effect when the Aura append lock is already held', async () => {
    // The append lock is taken before the grant is consumed, so a record path
    // that cannot be appended to refuses with the authorization intact. This
    // replaces a case that held the same lock to park the broker INSIDE
    // appendEntry's retry loop — a window that no longer exists, because the
    // lock is now acquired before the effect rather than after it.
    const fixture = await startFixture()
    const before = worldCounts(fixture.stateDir)
    const lockPath = join(fixture.stateDir, 'aura.jsonl.lock')
    const intentsDir = join(fixture.stateDir, 'intents')
    const lockFd = openSync(lockPath, 'wx')
    try {
      const deposit = await proposalRequest(fixture, {
        op: 'proposal.deposit',
        callId: 'call-append-lock-held',
        toolName: 'memory.put',
        arguments: { key: 'stale-lock-key', value: { mustNotBeWritten: true } },
      })
      expect(await waitForTerminal(fixture, proposalIdOf(deposit))).toMatchObject({
        ok: false,
        state: 'REFUSED',
        reason: 'broker:aura-preflight (record:lock-timeout)',
      })

      // REFUSED is true of the authorization as well as of the world: no nonce
      // spent, no prepared marker, no object, no chain entry.
      expect(worldCounts(fixture.stateDir)).toEqual(before)
      expect(existsSync(intentsDir) ? readdirSync(intentsDir) : []).toEqual([])
      expect(existsSync(join(fixture.stateDir, 'memory', 'keys', 'stale-lock-key.json'))).toBe(false)

      // The broker does not touch a lock it did not take.
      expect(existsSync(lockPath)).toBe(true)
    } finally {
      closeSync(lockFd)
      unlinkSync(lockPath)
    }

    // Positive control: the same request settles once the residue is gone, and
    // the broker leaves no lock of its own behind.
    const settled = await proposalRequest(fixture, {
      op: 'proposal.deposit',
      callId: 'call-append-lock-cleared',
      toolName: 'memory.put',
      arguments: { key: 'stale-lock-key', value: { mustNotBeWritten: true } },
    })
    expect(await waitForTerminal(fixture, proposalIdOf(settled))).toMatchObject({ ok: true, state: 'SETTLED' })
    expect(existsSync(lockPath)).toBe(false)
    expect(worldCounts(fixture.stateDir)).toEqual({
      aura: before.aura + 1,
      nonces: before.nonces + 1,
      objects: before.objects + 1,
    })
  })

  it('proves the SETTLED wire response carries a receipt that verifies with trusted public key, matches canonical disk bytes, and survives restart', async () => {
    const fixture = await startFixture()
    const args = { key: 'wire-proof-key', value: { verifiedWire: true, data: 42 } }
    const deposit = await proposalRequest(fixture, {
      op: 'proposal.deposit',
      callId: 'call-wire-proof',
      toolName: 'memory.put',
      arguments: args,
    })

    // 1. Transport-only parsing delivers the SETTLED wire reply carrying the receipt object:
    const terminal = await waitForTerminal(fixture, proposalIdOf(deposit))
    expect(terminal).toMatchObject({ ok: true, state: 'SETTLED' })
    expect(terminal.receipt).toBeTypeOf('object')
    const wireReceipt = terminal.receipt as Record<string, unknown>

    // 2. Cryptographic verification: verify wire receipt with the trusted broker public verification key:
    const brokerKeyData = JSON.parse(readFileSync(join(fixture.stateDir, 'keys', 'broker.json'), 'utf8')) as {
      publicPem: string
    }
    const { observe } = await import('@aukora/core/broker/effect.mjs')
    const { verifyReceipt, verifyReceiptDirectory } = await import('@aukora/core/broker/receipt.mjs')
    const verdict = verifyReceipt({
      receipt: wireReceipt,
      brokerPublicKeyPem: brokerKeyData.publicPem,
      observe,
    })
    expect(verdict).toEqual({ ok: true })

    // 3. Match against retained canonical bytes on disk and Aura entry:
    const receiptSha256 = createHash('sha256').update(canonicalJSON(wireReceipt), 'utf8').digest('hex')
    const receiptDiskPath = join(fixture.stateDir, 'receipts', `${receiptSha256}.json`)
    expect(existsSync(receiptDiskPath)).toBe(true)
    const diskBytes = readFileSync(receiptDiskPath, 'utf8')
    expect(diskBytes).toBe(`${canonicalJSON(wireReceipt)}\n`)
    expect(JSON.parse(diskBytes)).toEqual(wireReceipt)

    const auraLines = readFileSync(join(fixture.stateDir, 'aura.jsonl'), 'utf8').trim().split('\n')
    expect(auraLines).toHaveLength(1)
    const auraEntry = JSON.parse(auraLines[0]!) as { receiptSha256: string; key: string }
    expect(auraEntry.key).toBe('wire-proof-key')
    expect(auraEntry.receiptSha256).toBe(receiptSha256)

    // 4. Restart observation: verify persistence and receipt verification survive broker restart:
    await stopChild(fixture.broker)
    const restartedBroker = await spawnBroker({
      socketPath: fixture.brokerSocket,
      stateDir: fixture.stateDir,
      rootPublicKeyPem: createPublicKey(fixture.rootPrivateKey).export({ type: 'spki', format: 'pem' }).toString(),
      issuerSocket: join(fixture.tempDir, 'issuer.sock'),
      review: async () => 'approved' as const,
      activationDigest: LIVE_DOOR_ACTIVATION,
      rendererId: LIVE_DOOR_RENDERER,
    })
    fixture.broker = restartedBroker

    // Destination file and receipt retain identical bytes and continue to verify after restart:
    const reloadedBytes = readFileSync(receiptDiskPath, 'utf8')
    expect(reloadedBytes).toBe(diskBytes)
    const reloadedReceipt = JSON.parse(reloadedBytes) as Record<string, unknown>
    expect(reloadedReceipt).toEqual(wireReceipt)
    expect(verifyReceipt({
      receipt: reloadedReceipt,
      brokerPublicKeyPem: brokerKeyData.publicPem,
      observe,
    })).toEqual({ ok: true })

    // Completeness of receipt directory against Aura remains intact after restart:
    expect(verifyReceiptDirectory({
      stateDir: fixture.stateDir,
      receiptSha256s: new Set([receiptSha256]),
    })).toEqual({ ok: true, count: 1 })
  })
})
