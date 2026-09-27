/**
 * The live-dispatch court: drive the governed memory.put tool through the real
 * DSH ToolRuntime.execute seam — pre-execute ask, REAL approval answerer chain
 * (SIMULATED human decision in CI, labeled), trusted issuer bridge,
 * out-of-process issuer daemon, tool body, broker process, effect, receipt,
 * Aura. Every row passes only through that seam.
 *
 * Only the issuer daemon intentionally loads the root private key (provisioned
 * from a 0600 test file). Nothing in the Harness composition receives it. The
 * simulated human answerer and any simulated misbehaving issuer are test-only
 * and labeled SIMULATED: CI never claims a human clicked anything.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { generateKeyPairSync, sign } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConnection, createServer, type Socket } from 'node:net'
import type { ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import { GovernedMemory, escapeForReview, renderOperation, buildOperation, operationDigest, type GovernedMemoryConfig } from '../src/index.ts'
import { spawnBroker } from '@aukora/core/broker/broker.mjs'
import { verifyReceipt } from '@aukora/core/broker/receipt.mjs'
import { verifyChain } from '@aukora/core/aura/record.mjs'
import { MEMORY_PUT, definitionDigest, observe } from '@aukora/core/broker/effect.mjs'
import { grantPreimage, payloadDigest, newNonce } from '@aukora/core/host-dsh/src/grant.mjs'
import { mintGrant } from '@aukora/core/issuer/mint.mjs'
import { spawnMutantBroker } from '../../../../courts/harness/support/spawn-mutant-broker.mjs'

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const ISSUER_ENTRY = join(REPO_ROOT, 'aukora', 'issuer', 'issuer.mjs')

// Mutation mode: the runner points AUKORA_MUTANT_BROKER_ENTRY at a temporary
// patched COPY of the broker that lives outside the repository. The production
// package cannot import it; only this test process spawns it as a child.
const MUTANT_ENTRY = process.env.AUKORA_MUTANT_BROKER_ENTRY
const SENTINEL_PATH = process.env.AUKORA_MUTATION_SENTINEL
const MUTANT = Boolean(MUTANT_ENTRY && SENTINEL_PATH)
const SECURITY_ROWS = ['L4-forged', 'L6-replayed', 'L8-argument-mutation']
// Expiry is guarded EARLIER by the one-use artifact binding in the governed
// package, so removing broker verification alone cannot observe that exploit;
// the mutant run records it as still-refused defense-in-depth instead.

const TMP = mkdtempSync(join(tmpdir(), 'aukora-live-dispatch-'))
const stateDir = join(TMP, 'state')
const socketPath = join(TMP, 'broker.sock')
const issuerSocketPath = join(TMP, 'issuer.sock')
const root = generateKeyPairSync('ed25519')
const rootPublicPem = root.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const rootPrivatePem = root.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const authorities = new WeakMap<Context, ReturnType<typeof GovernedMemory>>()

let broker: ChildProcess
let brokerPublicKeyPem = ''
let activeReceiptKeyId = ''

function fakeAgent(): Agent {
  return {
    session: {
      events: [{ type: 'turn/start' }, { type: 'user/message' }],
      append: (type: string, data: Record<string, unknown>) => ({ type, data }),
    },
  } as unknown as Agent
}

function statusQuery(socketPath: string): Promise<{ brokerPublicKeyPem: string; receiptKeyId: string }> {
  return new Promise((resolve, reject) => {
    const conn = createConnection(socketPath)
    let buffer = ''
    conn.once('error', reject)
    conn.once('connect', () => conn.write(`${JSON.stringify({ id: 'status', op: 'status' })}\n`))
    conn.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const cut = buffer.indexOf('\n')
      if (cut === -1) return
      conn.destroy()
      resolve(JSON.parse(buffer.slice(0, cut)) as { brokerPublicKeyPem: string; receiptKeyId: string })
    })
  })
}

function rawBrokerRequest(request: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const conn = createConnection(socketPath)
    let buffer = ''
    conn.once('error', reject)
    conn.once('connect', () => conn.write(`${JSON.stringify(request)}\n`))
    conn.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const cut = buffer.indexOf('\n')
      if (cut === -1) return
      conn.destroy()
      resolve(JSON.parse(buffer.slice(0, cut)) as Record<string, unknown>)
    })
  })
}

function waitForSocket(path: string, timeoutMs: number, lastError?: () => string): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const attempt = (): void => {
      const conn = createConnection(path)
      conn.once('connect', () => { conn.destroy(); resolve() })
      conn.once('error', () => {
        if (Date.now() > deadline) reject(new Error(`socket ${path} did not accept: ${lastError?.() ?? 'timeout'}`))
        else setTimeout(attempt, 20)
      })
    }
    attempt()
  })
}

/** Wait for a test-owned child to exit before its temporary directory is removed. */
async function stopChild(child: ChildProcess | undefined, label: string): Promise<void> {
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve, reject) => {
    const done = (): void => {
      clearTimeout(timeout)
      child.removeListener('exit', done)
      resolve()
    }
    const timeout = setTimeout(() => {
      child.removeListener('exit', done)
      reject(new Error(`${label} did not stop after SIGTERM`))
    }, 3_000)
    child.once('exit', done)
    if (child.exitCode !== null || child.signalCode !== null) {
      done()
      return
    }
    try {
      child.kill('SIGTERM')
    } catch (error: unknown) {
      clearTimeout(timeout)
      child.removeListener('exit', done)
      reject(error instanceof Error ? error : new Error(`${label} failed to stop`))
    }
  })
}

/** Stop a test-owned socket server before removing the directory holding its socket. */
async function stopServer(
  server: ReturnType<typeof createServer>,
  sockets: ReadonlySet<Socket>,
  label: string,
): Promise<void> {
  for (const socket of sockets) socket.destroy()
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { reject(new Error(`${label} did not close`)) }, 3_000)
    server.close((error) => {
      clearTimeout(timeout)
      if (error === undefined) resolve()
      else reject(error)
    })
  })
}

function writeKeyFile(dir: string): string {
  mkdirSync(dir, { recursive: true })
  const keyFile = join(dir, 'root.pem')
  writeFileSync(keyFile, rootPrivatePem, { mode: 0o600 })
  chmodSync(keyFile, 0o600)
  return keyFile
}

async function spawnIssuer(keyFile: string): Promise<ChildProcess> {
  const { spawn } = await import('node:child_process')
  const child = spawn(process.execPath, [ISSUER_ENTRY], {
    env: {
      ...process.env,
      AUKORA_ISSUER_SOCKET: issuerSocketPath,
      AUKORA_ISSUER_KEY_FILE: keyFile,
      AUKORA_EXPECTED_RECEIPT_KEY_ID: activeReceiptKeyId,
    },
    stdio: ['pipe', 'ignore', 'pipe'],
  })
  // SIMULATED HUMAN DECISION: answer only after the issuer has rendered the
  // operation and emitted its prompt. Input entered before a prompt is not an
  // approval for a future operation.
  let stderr = ''
  let pending = ''
  const promptPattern = /\+- approve\? type "yes ([0-9a-f]{16})": /
  child.stderr?.on('data', (d: Buffer) => {
    const text = String(d)
    stderr += text
    pending += text
    let match
    while ((match = promptPattern.exec(pending)) !== null) {
      const challenge = match[1]
      if (challenge === undefined) throw new Error('issuer prompt omitted its challenge')
      pending = pending.slice(match.index + match[0].length)
      child.stdin?.write(`yes ${challenge}\n`)
    }
  })
  await waitForSocket(issuerSocketPath, 10000, () => stderr)
  return child
}

/**
 * SIMULATED issuer: serves crafted replies without validation. Test-only —
 * refusal rows use it to prove the BROKER rejects bad artifacts.
 */
interface IssuerRequest {
  op?: string
  toolName?: string
  arguments?: { key: string; value: unknown }
  expiry?: number
}

async function startSimulatedIssuer(
  reply: (request: IssuerRequest) => unknown,
): Promise<{ socketPath: string; connectionClosed: Promise<void>; close: () => Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), 'aukora-simulated-issuer-'))
  const path = join(dir, 'simulated.sock')
  const sockets = new Set<Socket>()
  let markConnectionClosed: () => void = () => {}
  const connectionClosed = new Promise<void>((resolve) => { markConnectionClosed = resolve })
  const server = createServer((socket) => {
    sockets.add(socket)
    let buffer = ''
    socket.on('error', () => { /* delayed simulated replies may lose the cancellation race */ })
    socket.once('close', () => {
      sockets.delete(socket)
      markConnectionClosed()
    })
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      let cut
      while ((cut = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 1)
        if (line.trim() === '') continue
        const parsed = JSON.parse(line) as unknown
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          socket.destroy(new Error('simulated issuer request must be an object'))
          continue
        }
        let response: unknown
        try { response = reply(parsed) }
        catch (error: unknown) {
          socket.destroy(error instanceof Error ? error : new Error('simulated issuer reply failed'))
          continue
        }
        void Promise.resolve(response).then((value) => {
          if (!socket.destroyed) socket.write(`${JSON.stringify(value)}\n`)
        }).catch((error: unknown) => {
          if (!socket.destroyed) socket.destroy(error instanceof Error ? error : new Error('simulated issuer reply failed'))
        })
      }
    })
  })
  await new Promise<void>((resolve) => { server.listen(path, () => { resolve() }) })
  return {
    socketPath: path,
    connectionClosed,
    close: async () => {
      await stopServer(server, sockets, 'simulated issuer server')
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/** SIMULATED issuer transport that accepts one request and closes without a reply. */
async function startClosingIssuer(): Promise<{ socketPath: string; close: () => Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), 'aukora-closing-issuer-'))
  const path = join(dir, 'closing.sock')
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.once('close', () => { sockets.delete(socket) })
    socket.end()
  })
  await new Promise<void>((resolve) => { server.listen(path, () => { resolve() }) })
  return {
    socketPath: path,
    close: async () => {
      await stopServer(server, sockets, 'closing issuer server')
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

interface ComposeOptions {
  brokerSocket?: string
  issuerSocket?: string
  reviewLimitBytes?: number
  /** SIMULATED HUMAN DECISION — CI only; no human clicked anything. */
  simulatedDecision?: (req: ApprovalRequest) => ApprovalOutcome
}

async function compose(options: ComposeOptions = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ApprovalService)
  const cfg: GovernedMemoryConfig = { brokerSocket: options.brokerSocket ?? socketPath }
  if (options.reviewLimitBytes !== undefined) cfg.reviewLimitBytes = options.reviewLimitBytes
  cfg.issuerSocket = options.issuerSocket ?? issuerSocketPath
  const authority = GovernedMemory(ctx, cfg)
  authorities.set(ctx, authority)
  // SIMULATED HUMAN DECISION (CI only, labeled): deterministic stand-in for the
  // interactive answerer. Test-only; decides nothing in production.
  const decide = options.simulatedDecision ?? (() => 'allowed-once')
  ctx.on('approval/request', async (req: ApprovalRequest): Promise<ApprovalOutcome> => decide(req))
  return ctx
}

function futureExp(): number {
  return Math.floor(Date.now() / 1000) + 300
}

/** Return the exact expiry the bridge bound into the approved operation. */
function issuedExpiry(req: IssuerRequest): number {
  const expiry = req.expiry
  if (typeof expiry !== 'number' || !Number.isSafeInteger(expiry)) {
    throw new Error('simulated issuer request omitted its expiry')
  }
  return expiry
}

/** Keep a multi-request test inside one operation-expiry tick. */
async function withFixedNow<T>(run: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now)
  try {
    return await run()
  } finally {
    nowSpy.mockRestore()
  }
}

/** SIMULATED trusted side: mints WITHOUT validation (compromised-issuer rows). */
function craftGrant(args: { key: string; value: unknown }, exp: number): Record<string, unknown> {
  const claims = {
    toolName: MEMORY_PUT,
    digest: payloadDigest(MEMORY_PUT, args),
    nonce: newNonce(),
    exp,
    definitionId: definitionDigest(),
    operationDigest: operationDigest(buildOperation(args, exp)),
    receiptKeyId: activeReceiptKeyId,
  }
  const signature = sign(null, grantPreimage(claims), root.privateKey).toString('base64')
  return { ...claims, signature }
}

/** The honest trusted-side mint for green rows (SIMULATED provisioning). */
function realMint(args: { key: string; value: unknown }, exp: number): Record<string, unknown> {
  return mintGrant({ rootPrivateKey: root.privateKey, args, exp, receiptKeyId: activeReceiptKeyId }).grant
}

function execute(ctx: Context, id: string, args: unknown): Promise<ToolExecutionResult> {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(id),
    name: MEMORY_PUT,
    arguments: args,
    agent: fakeAgent(),
  })
}

function errorMessage(result: ToolExecutionResult): string {
  if (!result.isError) throw new Error('expected a failed tool result')
  return result.error.message
}

function resultValue(result: ToolExecutionResult): unknown {
  return result.isError ? undefined : result.value
}

function zeroed(ctx: Context): boolean {
  const authority = authorities.get(ctx)
  if (authority === undefined) throw new Error('test composition omitted its authority store')
  const sizes = authority.sizes()
  return sizes.pending === 0 && sizes.tickets === 0
}

function observedOf(result: ToolExecutionResult): { isError: boolean; error?: string } {
  return result.isError
    ? { isError: true, error: errorMessage(result).slice(0, 200) }
    : { isError: false }
}

function memoryObjectCount(): number {
  try {
    return readdirSync(join(stateDir, 'memory', 'objects')).filter(f => f.endsWith('.json')).length
  } catch {
    return 0
  }
}

function chainCount(): number {
  const chain = verifyChain(join(stateDir, 'aura.jsonl'))
  return chain.ok ? chain.count : 0
}

function nonceClaimCount(): number {
  try {
    return readdirSync(join(stateDir, 'nonces')).length
  } catch {
    return 0
  }
}

describe.skipIf(MUTANT)('governed memory.put through the live dispatch seam', () => {
  let issuerChild: ChildProcess | undefined

  beforeAll(async () => {
    broker = await spawnBroker({
      socketPath,
      stateDir,
      rootPublicKeyPem: rootPublicPem,
    })
    const status = await statusQuery(socketPath)
    brokerPublicKeyPem = status.brokerPublicKeyPem
    activeReceiptKeyId = status.receiptKeyId
    issuerChild = await spawnIssuer(writeKeyFile(join(TMP, 'issuer-key')))
  }, 30000)

  afterAll(async () => {
    await stopChild(broker, 'broker')
    await stopChild(issuerChild, 'issuer')
    rmSync(TMP, { recursive: true, force: true })
  }, 30000)

  it('L1: valid approved memory.put succeeds; receipt verifies; Aura records it', async () => {
    const ctx = await compose()
    const before = chainCount()
    const result = await execute(ctx, 'valid-1', { key: 'user:balance', value: 1000 })
    expect(result.isError).toBe(false)
    const receipt = resultValue(result) as Record<string, unknown>
    expect(verifyReceipt({ receipt, brokerPublicKeyPem, observe }).ok).toBe(true)
    expect(chainCount()).toBe(before + 1)
    expect(zeroed(ctx)).toBe(true)
  })

  it('L2: no approval produces no effect', async () => {
    const ctx = await compose({ simulatedDecision: () => 'unavailable' })
    const before = memoryObjectCount()
    const result = await execute(ctx, 'no-approval', { key: 'no:approval', value: 1 })
    expect(result.isError).toBe(true)
    expect(memoryObjectCount()).toBe(before)
    expect(zeroed(ctx)).toBe(true)
  })

  it('L3: cancelled approval produces no effect', async () => {
    const ctx = await compose({ simulatedDecision: () => 'cancelled' })
    const before = memoryObjectCount()
    const result = await execute(ctx, 'cancelled', { key: 'cancelled', value: 1 })
    expect(result.isError).toBe(true)
    expect(memoryObjectCount()).toBe(before)
    expect(zeroed(ctx)).toBe(true)
  })

  it('caller cancellation before issuer contact leaves no authorization state', async () => {
    const controller = new AbortController()
    let issuerRequests = 0
    const sim = await startSimulatedIssuer(() => {
      issuerRequests += 1
      return { ok: false, reason: 'simulated:unexpected-issuer-contact' }
    })
    try {
      const ctx = await compose({
        issuerSocket: sim.socketPath,
        simulatedDecision: () => {
          controller.abort('cancel after approval')
          return 'allowed-once'
        },
      })
      const before = memoryObjectCount()
      const result = await ctx.tools.execute({
        signal: controller.signal,
        callId: CallId('cancelled-after-issuance'),
        name: MEMORY_PUT,
        arguments: { key: 'cancelled:after-issuance', value: 1 },
        agent: fakeAgent(),
      })

      expect(result.isError).toBe(true)
      expect(issuerRequests).toBe(0)
      expect(memoryObjectCount()).toBe(before)
      expect(zeroed(ctx)).toBe(true)
    } finally {
      await sim.close()
    }
  })

  it('caller cancellation while issuance is pending cannot plant a late ticket', async () => {
    const controller = new AbortController()
    let markRequestSeen: () => void = () => {}
    let releaseReply: () => void = () => {}
    let markReplyBuilt: () => void = () => {}
    const requestSeen = new Promise<void>((resolve) => { markRequestSeen = resolve })
    const replyRelease = new Promise<void>((resolve) => { releaseReply = resolve })
    const replyBuilt = new Promise<void>((resolve) => { markReplyBuilt = resolve })
    const sim = await startSimulatedIssuer(async (req) => {
      markRequestSeen()
      await replyRelease
      const grant = realMint(req.arguments as { key: string; value: unknown }, issuedExpiry(req))
      markReplyBuilt()
      return { ok: true, grant }
    })
    try {
      const ctx = await compose({ issuerSocket: sim.socketPath })
      const before = memoryObjectCount()
      const execution = ctx.tools.execute({
        signal: controller.signal,
        callId: CallId('cancelled-during-issuance'),
        name: MEMORY_PUT,
        arguments: { key: 'cancelled-during-issuance', value: 1 },
        agent: fakeAgent(),
      })
      await requestSeen
      controller.abort('cancel while issuer is pending')
      const result = await execution
      expect(result.isError).toBe(true)
      expect(memoryObjectCount()).toBe(before)
      expect(zeroed(ctx)).toBe(true)
      await sim.connectionClosed

      releaseReply()
      await replyBuilt
      await new Promise<void>((resolve) => { setImmediate(resolve) })
      expect(zeroed(ctx)).toBe(true)
    } finally {
      releaseReply()
      await sim.close()
    }
  })

  it('approval audit failure after issuance still clears both authority maps', async () => {
    let issuerRequests = 0
    const sim = await startSimulatedIssuer((req) => {
      issuerRequests += 1
      return {
        ok: true,
        grant: realMint(req.arguments as { key: string; value: unknown }, issuedExpiry(req)),
      }
    })
    try {
      const ctx = await compose({ issuerSocket: sim.socketPath })
      const agent = {
        session: {
          events: [{ type: 'turn/start' }, { type: 'user/message' }],
          append: (type: string, data: Record<string, unknown>) => {
            if (type === 'approval/decided') {
              expect(authorities.get(ctx)?.sizes()).toEqual({ pending: 1, tickets: 1 })
              throw new Error('simulated approval audit append failure')
            }
            return { type, data }
          },
        },
      } as unknown as Agent
      const result = await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: CallId('approval-audit-failure'),
        name: MEMORY_PUT,
        arguments: { key: 'approval-audit-failure', value: 1 },
        agent,
      })
      expect(result.isError).toBe(true)
      expect(errorMessage(result)).toContain('simulated approval audit append failure')
      expect(issuerRequests).toBe(1)
      expect(zeroed(ctx)).toBe(true)
    } finally { await sim.close() }
  })

  it('snapshots the broker route instead of following a mutated mount config', async () => {
    let redirectedRequests = 0
    const redirected = await startSimulatedIssuer(() => {
      redirectedRequests += 1
      return { ok: true, receipt: { invented: true } }
    })
    try {
      const ctx = new Context()
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(ApprovalService)
      const config: GovernedMemoryConfig = {
        brokerSocket: socketPath,
        issuerSocket: issuerSocketPath,
      }
      const authority = GovernedMemory(ctx, config)
      authorities.set(ctx, authority)
      ctx.on('approval/request', async (): Promise<ApprovalOutcome> => 'allowed-once')
      config.brokerSocket = redirected.socketPath

      const before = memoryObjectCount()
      const result = await execute(ctx, 'immutable-broker-route', {
        key: 'immutable-broker-route',
        value: 1,
      })
      expect(result.isError).toBe(false)
      expect(memoryObjectCount()).toBe(before + 1)
      expect(redirectedRequests).toBe(0)
      expect(zeroed(ctx)).toBe(true)
    } finally { await redirected.close() }
  })

  it('plugin disposal aborts pending issuance and cannot plant a late ticket', async () => {
    let markRequestSeen: () => void = () => {}
    let releaseReply: () => void = () => {}
    let markReplyBuilt: () => void = () => {}
    const requestSeen = new Promise<void>((resolve) => { markRequestSeen = resolve })
    const replyRelease = new Promise<void>((resolve) => { releaseReply = resolve })
    const replyBuilt = new Promise<void>((resolve) => { markReplyBuilt = resolve })
    const sim = await startSimulatedIssuer(async (req) => {
      markRequestSeen()
      await replyRelease
      const grant = realMint(req.arguments as { key: string; value: unknown }, issuedExpiry(req))
      markReplyBuilt()
      return { ok: true, grant }
    })
    try {
      const ctx = new Context()
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(ApprovalService)
      let authority: ReturnType<typeof GovernedMemory> | undefined
      const owner = await ctx.plugin({
        name: 'pending-issuance-disposal-probe',
        inject: ['tools'],
        apply(inner) {
          authority = GovernedMemory(inner, {
            brokerSocket: socketPath,
            issuerSocket: sim.socketPath,
          })
          inner.on('approval/request', async (): Promise<ApprovalOutcome> => 'allowed-once')
        },
      })
      const execution = ctx.tools.execute({
        signal: new AbortController().signal,
        callId: CallId('disposed-during-issuance'),
        name: MEMORY_PUT,
        arguments: { key: 'disposed-during-issuance', value: 1 },
        agent: fakeAgent(),
      })
      await requestSeen

      await owner.dispose()
      expect(authority?.sizes()).toEqual({ pending: 0, tickets: 0 })
      const result = await execution
      expect(result.isError).toBe(true)
      await sim.connectionClosed

      releaseReply()
      await replyBuilt
      await new Promise<void>((resolve) => { setImmediate(resolve) })
      expect(authority?.sizes()).toEqual({ pending: 0, tickets: 0 })
    } finally {
      releaseReply()
      await sim.close()
    }
  })

  it('refuses omitted values and rider fields in pre-execute before approval or effect', async () => {
    const ctx = await compose()
    const beforeObjects = memoryObjectCount()
    const beforeChain = chainCount()
    for (const [id, args] of [
      ['arguments-omitted', { key: 'arguments-omitted' }],
      ['arguments-rider', { key: 'arguments-rider', value: 1, hidden: true }],
    ] as const) {
      const result = await execute(ctx, id, args)
      expect(result.isError).toBe(true)
      expect(errorMessage(result)).toContain('memory.put:arguments-not-exact')
      expect(zeroed(ctx)).toBe(true)
    }
    expect(memoryObjectCount()).toBe(beforeObjects)
    expect(chainCount()).toBe(beforeChain)
  })

  it('rechecks the exact argument alphabet inside the tool body', async () => {
    const ctx = await compose()
    const tool = ctx.tools.get(MEMORY_PUT)
    if (tool === undefined) throw new Error('memory.put tool was not registered')
    const accessor = { key: 'execute-rider', get value() { return 1 } }
    await expect(tool.execute(accessor, {
      callId: CallId('execute-rider'),
      rootCallId: CallId('execute-rider'),
      name: MEMORY_PUT,
      arguments: accessor,
      signal: new AbortController().signal,
      token: Symbol('execute-rider'),
      agent: fakeAgent(),
      deferContext: () => {},
      concludeTurn: () => {},
    } as never)).rejects.toThrow('memory.put:arguments-not-exact')
    const badKey = { key: '../execute-path', value: 1 }
    await expect(tool.execute(badKey, {
      callId: CallId('execute-bad-key'),
      rootCallId: CallId('execute-bad-key'),
      name: MEMORY_PUT,
      arguments: badKey,
      signal: new AbortController().signal,
      token: Symbol('execute-bad-key'),
      agent: fakeAgent(),
      deferContext: () => {},
      concludeTurn: () => {},
    } as never)).rejects.toThrow('memory.put:key-not-a-name')
    expect(zeroed(ctx)).toBe(true)
  })

  it('L4: forged signature refuses (SIMULATED compromised issuer)', async () => {
    const sim = await startSimulatedIssuer((req) => {
      const g = realMint(req.arguments as { key: string; value: unknown }, issuedExpiry(req))
      const sig = Buffer.from(g.signature as string, 'base64')
      sig[0] = (sig[0] ?? 0) ^ 0xff
      return { ok: true, grant: { ...g, signature: sig.toString('base64') } }
    })
    try {
      const ctx = await compose({ issuerSocket: sim.socketPath })
      const result = await execute(ctx, 'forged', { key: 'forged', value: 1 })
      expect(result.isError).toBe(true)
      expect(errorMessage(result)).toContain('signature-invalid')
      expect(zeroed(ctx)).toBe(true)
    } finally { await sim.close() }
  })

  it('L5: expired grant refuses (SIMULATED compromised issuer)', async () => {
    const sim = await startSimulatedIssuer(req => ({
      ok: true,
      grant: craftGrant(req.arguments as { key: string; value: unknown }, Math.floor(Date.now() / 1000) - 100),
    }))
    try {
      const ctx = await compose({ issuerSocket: sim.socketPath })
      const result = await execute(ctx, 'expired', { key: 'expired', value: 1 })
      expect(result.isError).toBe(true)
      // The artifact binding (recomputed from the grant's own expiry) catches
      // the expired claim before the broker ever sees it.
      expect(errorMessage(result)).toMatch(/does not bind|expired/)
      expect(zeroed(ctx)).toBe(true)
    } finally { await sim.close() }
  })

  it('L6: replayed grant refuses (SIMULATED compromised issuer)', async () => {
    await withFixedNow(async () => {
      let fixed: Record<string, unknown> | undefined
      const sim = await startSimulatedIssuer((req) => {
        if (fixed === undefined) fixed = realMint(req.arguments as { key: string; value: unknown }, issuedExpiry(req))
        return { ok: true, grant: fixed }
      })
      try {
        const ctx = await compose({ issuerSocket: sim.socketPath })
        const first = await execute(ctx, 'replayed', { key: 'replayed', value: 1 })
        expect(first.isError).toBe(false)
        const second = await execute(ctx, 'replayed', { key: 'replayed', value: 1 })
        expect(second.isError).toBe(true)
        expect(errorMessage(second)).toContain('replayed')
        expect(zeroed(ctx)).toBe(true)
      } finally { await sim.close() }
    })
  })

  it('L7: tool-name substitution refuses (SIMULATED compromised issuer)', async () => {
    const sim = await startSimulatedIssuer((req) => {
      const g = realMint(req.arguments as { key: string; value: unknown }, issuedExpiry(req))
      return { ok: true, grant: { ...g, toolName: 'net:outbound' } }
    })
    try {
      const ctx = await compose({ issuerSocket: sim.socketPath })
      const result = await execute(ctx, 'substituted', { key: 'substituted', value: 1 })
      expect(result.isError).toBe(true)
      expect(errorMessage(result)).toContain('tool-mismatch')
      expect(zeroed(ctx)).toBe(true)
    } finally { await sim.close() }
  })

  it('L8: argument mutation after approval refuses (SIMULATED compromised issuer)', async () => {
    const sim = await startSimulatedIssuer(req => ({
      ok: true,
      grant: realMint({ key: `${(req.arguments as { key: string }).key}-other`, value: (req.arguments as { value: unknown }).value }, issuedExpiry(req)),
    }))
    try {
      const ctx = await compose({ issuerSocket: sim.socketPath })
      const result = await execute(ctx, 'arg-mutated', { key: 'mutated', value: 1 })
      expect(result.isError).toBe(true)
      expect(errorMessage(result)).toContain('payload-mismatch')
      expect(zeroed(ctx)).toBe(true)
    } finally { await sim.close() }
  })

  it('L9: content mutation after approval refuses (SIMULATED compromised issuer)', async () => {
    const sim = await startSimulatedIssuer(req => ({
      ok: true,
      grant: realMint({ key: (req.arguments as { key: string }).key, value: 999 }, issuedExpiry(req)),
    }))
    try {
      const ctx = await compose({ issuerSocket: sim.socketPath })
      const result = await execute(ctx, 'content-mutated', { key: 'content', value: 1 })
      expect(result.isError).toBe(true)
      expect(errorMessage(result)).toContain('payload-mismatch')
      expect(zeroed(ctx)).toBe(true)
    } finally { await sim.close() }
  })

  it('W1: reordered keys keep one canonical meaning (admits); Unicode drift refuses', async () => {
    const reorderSim = await startSimulatedIssuer(req => ({
      ok: true,
      grant: realMint(req.arguments as { key: string; value: unknown }, issuedExpiry(req)),
    }))
    try {
      const ctx = await compose({ issuerSocket: reorderSim.socketPath })
      const reordered = await execute(ctx, 'reordered', { key: 'reordered', value: { b: 2, a: 1 } })
      expect(reordered.isError).toBe(false)
      expect(zeroed(ctx)).toBe(true)
    } finally { await reorderSim.close() }

    const driftSim = await startSimulatedIssuer(req => ({
      ok: true,
      grant: realMint({ key: (req.arguments as { key: string }).key, value: 'caf\u00e9' }, issuedExpiry(req)),
    }))
    try {
      const ctx = await compose({ issuerSocket: driftSim.socketPath })
      const drifted = await execute(ctx, 'unicode', { key: 'unicode', value: 'cafe\u0301' })
      expect(drifted.isError).toBe(true)
      expect(errorMessage(drifted)).toContain('payload-mismatch')
    } finally { await driftSim.close() }
  })

  it('L11: traversal destinations refuse', async () => {
    const ctx = await compose()
    const before = memoryObjectCount()
    const result = await execute(ctx, 'traversal', { key: '../etc/passwd', value: 'pwn' })
    expect(result.isError).toBe(true)
    expect(memoryObjectCount()).toBe(before)
    expect(zeroed(ctx)).toBe(true)
  })

  it('L11b: a planted symlink never carries the write outside the store', async () => {
    // Real symlink attack: plant a link in the broker's key projection dir and
    // write the key it points at. Projections are replaced by atomic rename,
    // never followed, so the outside target's bytes must be untouched.
    const target = join(TMP, 'outside.txt')
    writeFileSync(target, 'original\n')
    symlinkSync(target, join(stateDir, 'memory', 'keys', 'escape.json'))
    const ctx = await compose()
    const result = await execute(ctx, 'symlink', { key: 'escape', value: 'pwn' })
    // Whichever way the call lands, the symlink must not carry the write.
    const outside = await import('node:fs')
    expect(outside.readFileSync(target, 'utf8')).toBe('original\n')
    expect(result.isError).toBe(false)
  })

  it('L12: broker unavailable returns an honest failure (never dressed as a refusal)', async () => {
    const ctx = await compose({ brokerSocket: join(TMP, 'no-such-broker.sock') })
    const result = await execute(ctx, 'broker-down', { key: 'down', value: 1 })
    expect(result.isError).toBe(true)
    expect(errorMessage(result)).not.toContain('refused')
  })

  it('W2: issuer unavailable fails closed and denies honestly', async () => {
    const ctx = await compose({ issuerSocket: join(TMP, 'no-such-issuer.sock') })
    const result = await execute(ctx, 'issuer-down', { key: 'down', value: 1 })
    expect(result.isError).toBe(true)
    expect(zeroed(ctx)).toBe(true)
  })

  it('an issuer connection that closes without a reply fails closed promptly', async () => {
    const sim = await startClosingIssuer()
    try {
      const ctx = await compose({ issuerSocket: sim.socketPath })
      const result = await execute(ctx, 'issuer-close-without-reply', { key: 'issuer-close', value: 1 })
      expect(result.isError).toBe(true)
      expect(errorMessage(result)).toContain('no approval channel is available')
      expect(zeroed(ctx)).toBe(true)
    } finally { await sim.close() }
  }, 2000)

  it('an issuer success reply without a typed grant fails closed before ticket issue', async () => {
    const sim = await startSimulatedIssuer(() => ({ ok: true, grant: { recordedByTheCourt: true } }))
    try {
      const ctx = await compose({
        issuerSocket: sim.socketPath,
        brokerSocket: join(TMP, 'malformed-grant-must-not-reach-broker.sock'),
      })
      const before = memoryObjectCount()
      const result = await execute(ctx, 'malformed-issuer-grant', { key: 'malformed-grant', value: 1 })
      expect(result.isError).toBe(true)
      expect(errorMessage(result)).toContain('no approval channel is available')
      expect(memoryObjectCount()).toBe(before)
      expect(zeroed(ctx)).toBe(true)
    } finally { await sim.close() }
  })

  it('W3: oversized operations refuse instead of truncating', async () => {
    const ctx = await compose({ reviewLimitBytes: 64 })
    const result = await execute(ctx, 'oversize', { key: 'big', value: 'x'.repeat(4096) })
    expect(result.isError).toBe(true)
    expect(errorMessage(result)).toContain('review limit')
    expect(zeroed(ctx)).toBe(true)
  })

  it('W4: control characters render escaped, never raw', () => {
    const hostile = 'k\u202enul\0l\nansi\x1b[31m'
    const args = { key: 'escaped-value', value: `${hostile}v\tline\r\\end` }
    const rendered = renderOperation(buildOperation(args, futureExp()), args)
    // No raw control character anywhere except the field separators.
    for (const ch of rendered) {
      const code = ch.codePointAt(0) ?? 0
      if (code < 0x20) expect(code).toBe(0x0a)
      expect(code).not.toBe(0x7f)
      expect(code).not.toBe(0x1b)
    }
    expect(escapeForReview(hostile)).toBe(String.raw`k\u{202e}nul\u{0}l\nansi\u{1b}[31m`)
    expect(rendered).toContain(String.raw`v\\tline\\r\\\\end`)
  })

  it('W6: operation-digest omission refuses before ticket issue', async () => {
    const sim = await startSimulatedIssuer((req) => {
      // A consistently signed operationless grant. The typed issuer seam must
      // reject it before it can become a ticket; spine C2 reaches the broker's
      // independently named refusal.
      const args = req.arguments as { key: string; value: unknown }
      const exp = issuedExpiry(req)
      const claims = {
        toolName: MEMORY_PUT,
        digest: payloadDigest(MEMORY_PUT, args),
        nonce: newNonce(),
        exp,
        definitionId: definitionDigest(),
      }
      const signature = sign(null, grantPreimage(claims as never), root.privateKey).toString('base64')
      return { ok: true, grant: { ...claims, signature } }
    })
    try {
      const ctx = await compose({ issuerSocket: sim.socketPath })
      const result = await execute(ctx, 'operationless', { key: 'operationless', value: 1 })
      expect(result.isError).toBe(true)
      expect(errorMessage(result)).toContain('no approval channel is available')
      expect(zeroed(ctx)).toBe(true)
    } finally { await sim.close() }
  })

  it('W9: a hidden unsigned field on the grant refuses before ticket issue', async () => {
    const sim = await startSimulatedIssuer((req) => {
      const g = realMint(req.arguments as { key: string; value: unknown }, issuedExpiry(req))
      return { ok: true, grant: { ...g, role: 'admin' } }
    })
    try {
      const ctx = await compose({ issuerSocket: sim.socketPath })
      const result = await execute(ctx, 'hidden-field', { key: 'hidden', value: 1 })
      expect(result.isError).toBe(true)
      expect(errorMessage(result)).toContain('no approval channel is available')
      expect(zeroed(ctx)).toBe(true)
    } finally { await sim.close() }
  })

  it('package pre-execute refuses non-name keys before issuer contact', async () => {
    let issuerRequests = 0
    const sim = await startSimulatedIssuer(() => {
      issuerRequests += 1
      return { ok: false, reason: 'simulated:unexpected-issuer-contact' }
    })
    try {
      const ctx = await compose({ issuerSocket: sim.socketPath })
      const result = await execute(ctx, 'bad-key-live', { key: '../escape', value: 1 })
      expect(result.isError).toBe(true)
      expect(errorMessage(result)).toContain('memory.put:key-not-a-name')
      expect(issuerRequests).toBe(0)
      expect(zeroed(ctx)).toBe(true)
    } finally { await sim.close() }
  })

  it('W10: the raw broker refuses invalid keys and rider arguments before nonce claim or effect', async () => {
    const beforeObjects = memoryObjectCount()
    const beforeChain = chainCount()
    const beforeNonces = nonceClaimCount()
    const dummyGrant = { present: true }

    await expect(rawBrokerRequest({
      op: MEMORY_PUT,
      toolName: MEMORY_PUT,
      arguments: { key: '../escape', value: 1 },
      grant: dummyGrant,
    })).resolves.toMatchObject({ ok: false, state: 'REFUSED', reason: 'broker:key-not-a-name' })
    await expect(rawBrokerRequest({
      op: MEMORY_PUT,
      toolName: MEMORY_PUT,
      arguments: { key: 'rider', value: 1, hidden: true },
      grant: dummyGrant,
    })).resolves.toMatchObject({ ok: false, state: 'REFUSED', reason: 'broker:arguments-not-exact' })

    expect(memoryObjectCount()).toBe(beforeObjects)
    expect(chainCount()).toBe(beforeChain)
    expect(nonceClaimCount()).toBe(beforeNonces)
  })

  it('W7: rendered A / executed B refuses as operation mismatch (SIMULATED issuer)', async () => {
    const sim = await startSimulatedIssuer(req => ({
      ok: true,
      grant: realMint({ key: (req.arguments as { key: string }).key, value: 'approved-content' }, issuedExpiry(req)),
    }))
    try {
      const ctx = await compose({ issuerSocket: sim.socketPath })
      const result = await execute(ctx, 'render-swap', { key: 'render-swap', value: 'executed-content' })
      expect(result.isError).toBe(true)
      expect(errorMessage(result)).toContain('payload-mismatch')
      expect(zeroed(ctx)).toBe(true)
    } finally { await sim.close() }
  })

  it('W8: a bare allowed-once string is not evidence — without issuance nothing runs', async () => {
    // The SIMULATED human approves, but no bridge/issuer is composed, so no
    // one-use artifact ever exists: the bare outcome string alone is refused.
    const ctx = await compose({ issuerSocket: join(TMP, 'unused-issuer.sock') })
    const result = await execute(ctx, 'bare-allowed', { key: 'bare', value: 1 })
    expect(result.isError).toBe(true)
    expect(errorMessage(result)).not.toContain('refused')
    expect(zeroed(ctx)).toBe(true)
  })

  it('L13: refused requests leave no object, projection, receipt, or Aura record', async () => {
    const sim = await startSimulatedIssuer(() => ({ ok: false, reason: 'issuer:mint-refused (simulated)' }))
    try {
      const ctx = await compose({ issuerSocket: sim.socketPath })
      const beforeObjects = memoryObjectCount()
      const beforeChain = chainCount()
      const result = await execute(ctx, 'no-trace', { key: 'no-trace', value: 1 })
      expect(result.isError).toBe(true)
      expect(memoryObjectCount()).toBe(beforeObjects)
      expect(chainCount()).toBe(beforeChain)
      expect(resultValue(result)).toBeUndefined()
      expect(zeroed(ctx)).toBe(true)
    } finally { await sim.close() }
  })

  it('L14: a success result carries the verified settlement receipt', async () => {
    const ctx = await compose()
    const result = await execute(ctx, 'receipt-verified', { key: 'receipt', value: 'evidence' })
    expect(result.isError).toBe(false)
    const receipt = resultValue(result) as Record<string, unknown>
    expect(verifyReceipt({ receipt, brokerPublicKeyPem, observe }).ok).toBe(true)
  })
})

describe.skipIf(!MUTANT)('mutation observation: broker grant verification patched out', () => {
  let mutantBroker: ChildProcess
  let issuerChild: ChildProcess | undefined
  const breached: string[] = []
  const observations: Record<string, { isError: boolean; error?: string }> = {}
  let controlPassed = false

  beforeAll(async () => {
    mutantBroker = await spawnMutantBroker({
      entry: MUTANT_ENTRY as string,
      socketPath,
      stateDir,
      rootPublicKeyPem: rootPublicPem,
    })
    activeReceiptKeyId = (await statusQuery(socketPath)).receiptKeyId
    issuerChild = await spawnIssuer(writeKeyFile(join(TMP, 'mutant-issuer-key')))
  })

  afterAll(async () => {
    await stopChild(mutantBroker, 'mutant broker')
    await stopChild(issuerChild, 'issuer')
    rmSync(TMP, { recursive: true, force: true })
    // The sentinel is written LAST so an infra failure anywhere above leaves it
    // missing and the runner reports RED.
    const detected = controlPassed && SECURITY_ROWS.every(row => breached.includes(row))
    writeFileSync(SENTINEL_PATH ?? join(TMP, 'sentinel.json'), `${JSON.stringify({
      mutant: 'broker-copy-with-verifyGrant-patched-to-ok',
      controlRow: 'control-valid-settles',
      controlPassed,
      securityRowsExpected: SECURITY_ROWS,
      stillRefusedRows: Object.entries(observations).filter(([, v]) => v.isError).map(([k]) => k),
      breachedRows: [...breached].sort(),
      observations,
      testsCollected: Object.keys(observations).length,
      mutationDetected: detected,
    }, null, 2)}\n`)
  })

  it('control: a valid approved memory.put still settles under the mutant', async () => {
    const ctx = await compose()
    const result = await execute(ctx, 'mutant-control', { key: 'mutant-control', value: 'valid' })
    controlPassed = !result.isError
    observations['control'] = observedOf(result)
    expect(controlPassed).toBe(true)
  })

  it('security L4-forged: forged signature admits under the mutant', async () => {
    const sim = await startSimulatedIssuer((req) => {
      const g = realMint(req.arguments as { key: string; value: unknown }, issuedExpiry(req))
      const sig = Buffer.from(g.signature as string, 'base64')
      sig[0] = (sig[0] ?? 0) ^ 0xff
      return { ok: true, grant: { ...g, signature: sig.toString('base64') } }
    })
    try {
      const ctx = await compose({ issuerSocket: sim.socketPath })
      const result = await execute(ctx, 'm-forged', { key: 'm-forged', value: 1 })
      observations['m-forged'] = observedOf(result)
      if (!result.isError) breached.push('L4-forged')
    } finally { await sim.close() }
  })

  it('defense L5-expired: STILL refused under the mutant (artifact binding)', async () => {
    const sim = await startSimulatedIssuer(req => ({
      ok: true,
      grant: craftGrant(req.arguments as { key: string; value: unknown }, Math.floor(Date.now() / 1000) - 100),
    }))
    try {
      const ctx = await compose({ issuerSocket: sim.socketPath })
      const result = await execute(ctx, 'm-expired', { key: 'm-expired', value: 1 })
      observations['m-expired'] = observedOf(result)
      expect(result.isError).toBe(true)
      expect(errorMessage(result)).toMatch(/does not bind|expired/)
    } finally { await sim.close() }
  })

  it('security L6-replayed: spent grant re-admits under the mutant', async () => {
    await withFixedNow(async () => {
      let fixed: Record<string, unknown> | undefined
      const sim = await startSimulatedIssuer((req) => {
        if (fixed === undefined) fixed = realMint(req.arguments as { key: string; value: unknown }, issuedExpiry(req))
        return { ok: true, grant: fixed }
      })
      try {
        const ctx = await compose({ issuerSocket: sim.socketPath })
        const first = await execute(ctx, 'm-replayed', { key: 'm-replayed', value: 1 })
        expect(first.isError).toBe(false)
        const second = await execute(ctx, 'm-replayed', { key: 'm-replayed', value: 1 })
        observations['m-replayed'] = observedOf(second)
        if (!second.isError) breached.push('L6-replayed')
      } finally { await sim.close() }
    })
  })

  it('security L8-argument-mutation: mutated arguments admit under the mutant', async () => {
    const sim = await startSimulatedIssuer(req => ({
      ok: true,
      grant: realMint({ key: `${(req.arguments as { key: string }).key}-other`, value: (req.arguments as { value: unknown }).value }, issuedExpiry(req)),
    }))
    try {
      const ctx = await compose({ issuerSocket: sim.socketPath })
      const result = await execute(ctx, 'm-mutated', { key: 'm-mutated', value: 1 })
      observations['m-mutated'] = observedOf(result)
      if (!result.isError) breached.push('L8-argument-mutation')
    } finally { await sim.close() }
  })
})
