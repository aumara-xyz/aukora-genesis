/**
 * Focused contracts for the governed package's own in-process authority and
 * local socket adapters. The end-to-end court owns broker cryptography and
 * settlement; these cases prove the guest-facing layer fails closed before a
 * malformed, cross-call, or unavailable transport can become an effect.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import { createServer, Socket } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MEMORY_PUT } from '@aukora/core/broker/effect.mjs'
import { GovernedMemory, GovernedMemoryService, buildOperation, operationDigest, type Grant } from '../src/index.ts'
import { registerIssuerBridge } from '../src/bridge.ts'

interface SocketServer {
  socketPath: string
  close(): Promise<void>
}

const servers: SocketServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()))
})

/** Start a one-test Unix-socket peer and retain cleanup ownership locally. */
async function socketServer(onConnection: (socket: Socket) => void): Promise<SocketServer> {
  const directory = mkdtempSync(join(tmpdir(), 'aukora-memory-bridge-contract-'))
  const socketPath = join(directory, 'peer.sock')
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.once('close', () => { sockets.delete(socket) })
    onConnection(socket)
  })
  await new Promise<void>((resolve, reject) => {
    const fail = (error: Error): void => { server.off('error', fail); reject(error) }
    server.once('error', fail)
    server.listen(socketPath, () => { server.off('error', fail); resolve() })
  })
  const started: SocketServer = {
    socketPath,
    async close(): Promise<void> {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve()
          else reject(error)
        })
      })
      rmSync(directory, { recursive: true, force: true })
    },
  }
  servers.push(started)
  return started
}

/** Minimal agent identity; direct tool-body cases never inspect its session. */
function fakeAgent(): Agent {
  return { session: { events: [], append: () => ({}) } } as unknown as Agent
}

/** Agent fixture whose log permits an approval request to be durably paired. */
function approvalAgent(): Agent {
  return {
    session: {
      events: [{ type: 'turn/start' }, { type: 'user/message' }],
      append: (type: string, data: Record<string, unknown>) => ({ type, data }),
    },
  } as unknown as Agent
}

/** Create an unissued but otherwise valid grant for the local broker stub. */
function grantFor(args: { key: string; value: unknown }, exp: number, overrides: Partial<Grant> = {}): Grant {
  const operation = buildOperation(args, exp)
  return {
    toolName: MEMORY_PUT,
    digest: 'a'.repeat(64),
    nonce: 'bridge-contract-nonce',
    exp,
    definitionId: 'b'.repeat(64),
    operationDigest: operationDigest(operation),
    receiptKeyId: 'c'.repeat(64),
    signature: Buffer.alloc(64).toString('base64'),
    ...overrides,
  }
}

/** Assemble the package without the issuer bridge for direct ticket checks. */
async function directHarness(brokerSocket: string): Promise<{
  authority: ReturnType<typeof GovernedMemory>
  tool: NonNullable<ReturnType<Context['tools']['get']>>
}> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const authority = GovernedMemory(ctx, {
    brokerSocket,
    issuerSocket: join(tmpdir(), 'unused-legacy-issuer.sock'),
  })
  const tool = ctx.tools.get(MEMORY_PUT)
  if (tool === undefined) throw new Error('governed memory tool was not registered')
  return { authority, tool }
}

/** Assemble the real ToolRuntime seam for pre-execute and output rendering cases. */
async function runtimeHarness(config: Parameters<typeof GovernedMemory>[1]): Promise<{
  ctx: Context
  authority: ReturnType<typeof GovernedMemory>
}> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ApprovalService)
  const authority = GovernedMemory(ctx, config)
  return { ctx, authority }
}

/** Drive a registered tool through ToolRuntime's actual pre/result lifecycle. */
function runtimeCall(ctx: Context, callId: string, name: string, args: unknown, agent: Agent | undefined = approvalAgent()) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(callId),
    name,
    arguments: args,
    agent,
  })
}

/** Invoke the tool body after tests have staged the exact pending/ticket state. */
function directCall(
  tool: NonNullable<ReturnType<Context['tools']['get']>>,
  callId: string,
  args: { key: string; value: unknown },
  agent: Agent | undefined,
  token: PropertyKey,
): Promise<unknown> {
  return tool.execute(args, {
    callId: CallId(callId),
    rootCallId: CallId(callId),
    name: MEMORY_PUT,
    arguments: args,
    signal: new AbortController().signal,
    token,
    agent,
    deferContext: () => {},
    concludeTurn: () => {},
  } as never)
}

interface StageOverrides {
  pendingAgentKey: string
  pendingToken: PropertyKey
  ticketAgentKey: string
  ticketExpiry: number
  ticketDigest: string
}

/** Stage the exact pending operation and its one-use ticket. */
function stage(
  authority: ReturnType<typeof GovernedMemory>,
  callId: string,
  agent: Agent,
  token: PropertyKey,
  args: { key: string; value: unknown },
  overrides: Partial<StageOverrides> = {},
): void {
  const exp = Math.floor(Date.now() / 1000) + 300
  const operation = buildOperation(args, exp)
  const agentKey = authority.agentKeyOf(agent)
  authority.recordPending(callId, {
    agentKey: overrides.pendingAgentKey ?? agentKey,
    executionToken: overrides.pendingToken ?? token,
    operation,
    args,
  })
  authority.issueTicket({
    callId,
    agentKey: overrides.ticketAgentKey ?? agentKey,
    operationDigest: overrides.ticketDigest ?? operationDigest(operation),
    expiry: overrides.ticketExpiry ?? exp,
    grant: grantFor(args, exp),
  })
}

/** Shrink only the test peer's socket timeout while preserving the real socket implementation. */
function shortSocketTimeout() {
  const descriptor = Object.getOwnPropertyDescriptor(Socket.prototype, 'setTimeout')
  if (descriptor === undefined || typeof descriptor.value !== 'function') throw new Error('Socket.prototype.setTimeout is unavailable')
  const setTimeout = descriptor.value as (this: Socket, milliseconds: number, callback?: () => void) => Socket
  return vi.spyOn(Socket.prototype, 'setTimeout').mockImplementation(function (this: Socket, _milliseconds, callback) {
    return setTimeout.call(this, 1, callback)
  })
}

describe('governed memory ticket binding', () => {
  it('refuses missing and cross-call authority before contacting the broker', async () => {
    const { authority, tool } = await directHarness(join(tmpdir(), 'no-broker.sock'))
    const args = { key: 'binding', value: 1 }
    const agent = fakeAgent()
    const token = Symbol('correct')

    await expect(directCall(tool, 'no-pending', args, agent, token)).rejects.toThrow('no pending approved operation')

    stage(authority, 'wrong-token', agent, token, args, { pendingToken: Symbol('other') })
    await expect(directCall(tool, 'wrong-token', args, agent, token)).rejects.toThrow('different execution')

    stage(authority, 'missing-agent', agent, token, args)
    await expect(directCall(tool, 'missing-agent', args, undefined, token)).rejects.toThrow('different agent')

    const otherAgent = fakeAgent()
    stage(authority, 'other-agent', agent, token, args)
    await expect(directCall(tool, 'other-agent', args, otherAgent, token)).rejects.toThrow('different agent')

    authority.recordPending('no-ticket', {
      agentKey: authority.agentKeyOf(agent),
      executionToken: token,
      operation: buildOperation(args, Math.floor(Date.now() / 1000) + 300),
      args,
    })
    await expect(directCall(tool, 'no-ticket', args, agent, token)).rejects.toThrow('no authorization artifact')

    stage(authority, 'ticket-agent', agent, token, args, { ticketAgentKey: 'other-agent' })
    await expect(directCall(tool, 'ticket-agent', args, agent, token)).rejects.toThrow('artifact belongs to a different agent')

    const expiry = Math.floor(Date.now() / 1000) + 5
    stage(authority, 'expired-ticket', agent, token, args, { ticketExpiry: expiry })
    const clock = vi.spyOn(Date, 'now')
    clock.mockReturnValueOnce(Date.now()).mockReturnValueOnce((expiry + 1) * 1000)
    await expect(directCall(tool, 'expired-ticket', args, agent, token)).rejects.toThrow('artifact has expired')
    clock.mockRestore()

    stage(authority, 'wrong-digest', agent, token, args, { ticketDigest: 'd'.repeat(64) })
    await expect(directCall(tool, 'wrong-digest', args, agent, token)).rejects.toThrow('does not bind to these arguments')

    expect(authority.sizes()).toEqual({ pending: 0, tickets: 0 })
  })

  it('sweeps expired state without discarding still-live authority', async () => {
    const { authority } = await directHarness(join(tmpdir(), 'no-broker.sock'))
    const args = { key: 'expiry', value: 1 }
    const agent = fakeAgent()
    const token = Symbol('expiry')
    const future = Math.floor(Date.now() / 1000) + 300
    const expiredOperation = buildOperation(args, 0)
    const liveOperation = buildOperation(args, future)

    authority.recordPending('expired', {
      agentKey: authority.agentKeyOf(agent), executionToken: token, operation: expiredOperation, args,
    })
    authority.issueTicket({
      callId: 'expired', agentKey: authority.agentKeyOf(agent), operationDigest: operationDigest(expiredOperation), expiry: 0, grant: grantFor(args, 0),
    })
    authority.recordPending('live', {
      agentKey: authority.agentKeyOf(agent), executionToken: token, operation: liveOperation, args,
    })
    authority.issueTicket({
      callId: 'live', agentKey: authority.agentKeyOf(agent), operationDigest: operationDigest(liveOperation), expiry: future, grant: grantFor(args, future),
    })

    expect(authority.sizes()).toEqual({ pending: 1, tickets: 1 })
    authority.clear()
    expect(authority.sizes()).toEqual({ pending: 0, tickets: 0 })
  })
})

describe('governed memory broker and dispatch contracts', () => {
  it('keeps broker refusal and indeterminacy distinct, even for non-string fields', async () => {
    const indeterminate = await socketServer((socket) => {
      socket.once('data', () => { socket.end('{"ok":false,"state":"INDETERMINATE","detail":17}\n') })
    })
    const indeterminateHarness = await directHarness(indeterminate.socketPath)
    const args = { key: 'indeterminate', value: 1 }
    const agent = fakeAgent()
    const token = Symbol('indeterminate')
    stage(indeterminateHarness.authority, 'indeterminate', agent, token, args)
    await expect(directCall(indeterminateHarness.tool, 'indeterminate', args, agent, token))
      .rejects.toThrow('indeterminate — the broker reports the effect outcome is unknown (17)')

    const refusal = await socketServer((socket) => {
      socket.once('data', () => { socket.end('\n{"ok":false,"state":false,"reason":true}\n') })
    })
    const refusalHarness = await directHarness(refusal.socketPath)
    const refusalToken = Symbol('refusal')
    stage(refusalHarness.authority, 'refusal', agent, refusalToken, args)
    await expect(directCall(refusalHarness.tool, 'refusal', args, agent, refusalToken))
      .rejects.toThrow('memory.put refused: true')

    const opaque = await socketServer((socket) => {
      socket.once('data', () => { socket.end('{"ok":false,"state":{},"reason":{}}\n') })
    })
    const opaqueHarness = await directHarness(opaque.socketPath)
    const opaqueToken = Symbol('opaque-refusal')
    stage(opaqueHarness.authority, 'opaque-refusal', agent, opaqueToken, args)
    await expect(directCall(opaqueHarness.tool, 'opaque-refusal', args, agent, opaqueToken))
      .rejects.toThrow('memory.put refused: unknown')

    const reasonOnly = await socketServer((socket) => {
      socket.once('data', () => { socket.end('{"ok":false,"state":"INDETERMINATE","reason":"effect may have run"}\n') })
    })
    const reasonOnlyHarness = await directHarness(reasonOnly.socketPath)
    const reasonOnlyToken = Symbol('reason-only')
    stage(reasonOnlyHarness.authority, 'reason-only', agent, reasonOnlyToken, args)
    await expect(directCall(reasonOnlyHarness.tool, 'reason-only', args, agent, reasonOnlyToken))
      .rejects.toThrow('indeterminate — the broker reports the effect outcome is unknown (effect may have run)')

    expect(indeterminateHarness.authority.sizes()).toEqual({ pending: 0, tickets: 0 })
    expect(refusalHarness.authority.sizes()).toEqual({ pending: 0, tickets: 0 })
  })

  it('fails closed on malformed, closed, unreachable, and timed-out broker peers', async () => {
    const args = { key: 'broker-transport', value: 1 }
    const agent = fakeAgent()

    const malformed = await socketServer((socket) => {
      socket.once('data', () => { socket.end('not-json\n') })
    })
    const malformedHarness = await directHarness(malformed.socketPath)
    const malformedToken = Symbol('malformed')
    stage(malformedHarness.authority, 'malformed', agent, malformedToken, args)
    await expect(directCall(malformedHarness.tool, 'malformed', args, agent, malformedToken)).rejects.toBeInstanceOf(Error)

    const rawThrow = await socketServer((socket) => {
      socket.once('data', () => { socket.end('{"ok":true}\n') })
    })
    const rawThrowHarness = await directHarness(rawThrow.socketPath)
    const rawThrowToken = Symbol('raw-throw')
    stage(rawThrowHarness.authority, 'raw-throw', agent, rawThrowToken, args)
    const parser = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => { throw 'raw parser fault' })
    try {
      await expect(directCall(rawThrowHarness.tool, 'raw-throw', args, agent, rawThrowToken)).rejects.toThrow('raw parser fault')
    } finally {
      parser.mockRestore()
    }

    const closed = await socketServer((socket) => {
      socket.once('data', () => { socket.destroy() })
    })
    const closedHarness = await directHarness(closed.socketPath)
    const closedToken = Symbol('closed')
    stage(closedHarness.authority, 'closed', agent, closedToken, args)
    await expect(directCall(closedHarness.tool, 'closed', args, agent, closedToken)).rejects.toThrow('broker closed without a reply')

    const absentHarness = await directHarness(join(tmpdir(), 'missing-broker.sock'))
    const absentToken = Symbol('absent')
    stage(absentHarness.authority, 'absent', agent, absentToken, args)
    await expect(directCall(absentHarness.tool, 'absent', args, agent, absentToken)).rejects.toBeInstanceOf(Error)

    const stalled = await socketServer((socket) => { socket.once('data', () => {}) })
    const stalledHarness = await directHarness(stalled.socketPath)
    const stalledToken = Symbol('stalled')
    stage(stalledHarness.authority, 'stalled', agent, stalledToken, args)
    const timeout = shortSocketTimeout()
    try {
      await expect(directCall(stalledHarness.tool, 'stalled', args, agent, stalledToken)).rejects.toThrow('broker timed out')
    } finally {
      timeout.mockRestore()
    }
  })

  it('passes unrelated tools through and refuses oversized operations', async () => {
    const first = await runtimeHarness({
      brokerSocket: join(tmpdir(), 'unused-broker.sock'),
      reviewLimitBytes: 32,
    })
    first.ctx.tools.register(defineTool({
      name: 'other.tool',
      description: 'A non-governed control tool.',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async () => 'passed-through',
    }))
    await expect(runtimeCall(first.ctx, 'other-tool', 'other.tool', {})).resolves.toMatchObject({ value: 'passed-through' })

    const big = await runtimeCall(first.ctx, 'oversize', MEMORY_PUT, { key: 'big', value: 'x'.repeat(1024) })
    expect(big.isError).toBe(true)

    const noAgent = await runtimeHarness({ brokerSocket: join(tmpdir(), 'unused-broker.sock') })
    const noAgentResult = await noAgent.ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('no-agent'),
      name: MEMORY_PUT,
      arguments: { key: 'no-agent', value: 1 },
    })
    expect(noAgentResult.isError).toBe(true)
  })

  it('renders scalar success output and composes through the service wrapper', async () => {
    const args = { key: 'scalar-receipt', value: 1 }
    const exp = Math.floor(Date.now() / 1000) + 300
    const issuer = await socketServer((socket) => {
      socket.once('data', () => { socket.end(`${JSON.stringify({ ok: true, grant: grantFor(args, exp) })}\n`) })
    })
    const broker = await socketServer((socket) => {
      socket.once('data', () => { socket.end('{"ok":true,"receipt":"scalar-receipt"}\n') })
    })
    const runtime = await runtimeHarness({ brokerSocket: broker.socketPath, issuerSocket: issuer.socketPath })
    runtime.ctx.on('approval/request', async () => 'allowed-once' as const)
    await expect(runtimeCall(runtime.ctx, 'scalar-receipt', MEMORY_PUT, args)).resolves.toMatchObject({ value: 'scalar-receipt' })

    const wrapper = new Context()
    await wrapper.plugin(SystemPrompt)
    await wrapper.plugin(ToolRuntime)
    await wrapper.plugin(GovernedMemoryService, { brokerSocket: join(tmpdir(), 'unused-broker.sock') })
    expect(wrapper.tools.get(MEMORY_PUT)).toBeDefined()
  })
})

describe('issuer bridge fail-closed behavior', () => {
  it('issues only after a real allowed-once answer binds a pending operation', async () => {
    const args = { key: 'bridge', value: 1 }
    const exp = Math.floor(Date.now() / 1000) + 300
    const operation = buildOperation(args, exp)
    const issuer = await socketServer((socket) => {
      socket.once('data', () => { socket.end(`${JSON.stringify({ ok: true, grant: grantFor(args, exp) })}\n`) })
    })
    const issued: unknown[] = []
    const authority = {
      getPending: (callId: string) => callId === 'bridge-call' ? { operation, args } : undefined,
      agentKeyOf: () => 'bridge-agent',
      issueTicket: (ticket: unknown) => { issued.push(ticket) },
    }
    const owner = new AbortController()
    const ctx = new Context()
    await ctx.plugin(ApprovalService)
    registerIssuerBridge(ctx, { issuerSocket: issuer.socketPath }, authority, owner.signal)
    ctx.on('approval/request', async () => 'allowed-once' as const)
    const agent = approvalAgent()

    await expect(ctx.approval.request({ agent, toolName: 'other.tool', callId: CallId('other-call') })).resolves.toBe('allowed-once')
    await expect(ctx.approval.request({ agent, toolName: MEMORY_PUT, callId: CallId('bridge-call') })).resolves.toBe('allowed-once')

    expect(issued).toEqual([expect.objectContaining({
      callId: 'bridge-call', agentKey: 'bridge-agent', operationDigest: operationDigest(operation), expiry: exp,
    })])
  })

  it('returns closed outcomes for cancellation, absent binding, and issuer denial', async () => {
    const args = { key: 'bridge-refusal', value: 1 }
    const exp = Math.floor(Date.now() / 1000) + 300
    const operation = buildOperation(args, exp)
    const issuer = await socketServer((socket) => {
      socket.once('data', () => { socket.end(`${JSON.stringify({ ok: false, reason: 17 })}\n`) })
    })
    const issued: unknown[] = []
    const authority = {
      getPending: (callId: string) => callId === 'bound-call' ? { operation, args } : undefined,
      agentKeyOf: () => 'bridge-agent',
      issueTicket: (ticket: unknown) => { issued.push(ticket) },
    }
    const ctx = new Context()
    await ctx.plugin(ApprovalService)
    const owner = new AbortController()
    registerIssuerBridge(ctx, { issuerSocket: issuer.socketPath }, authority, owner.signal)
    ctx.on('approval/request', async () => 'allowed-once' as const)
    const agent = approvalAgent()

    await expect(ctx.approval.request({ agent, toolName: MEMORY_PUT })).resolves.toBe('unavailable')
    await expect(ctx.approval.request({ agent, toolName: MEMORY_PUT, callId: CallId('missing-call') })).resolves.toBe('unavailable')
    await expect(ctx.approval.request({ agent, toolName: MEMORY_PUT, callId: CallId('bound-call') })).resolves.toBe('unavailable')
    expect(issued).toEqual([])

    owner.abort('owner stopped')
    await expect(ctx.approval.request({ agent, toolName: MEMORY_PUT, callId: CallId('bound-call') })).resolves.toBe('cancelled')
  })

  it('honors caller cancellation after the answerer rather than issuing a late ticket', async () => {
    const args = { key: 'bridge-cancel', value: 1 }
    const exp = Math.floor(Date.now() / 1000) + 300
    const operation = buildOperation(args, exp)
    const issuer = await socketServer((socket) => {
      socket.once('data', () => { socket.end(`${JSON.stringify({ ok: true, grant: grantFor(args, exp) })}\n`) })
    })
    const issued: unknown[] = []
    const authority = {
      getPending: () => ({ operation, args }),
      agentKeyOf: () => 'bridge-agent',
      issueTicket: (ticket: unknown) => { issued.push(ticket) },
    }
    const ctx = new Context()
    await ctx.plugin(ApprovalService)
    const owner = new AbortController()
    const caller = new AbortController()
    registerIssuerBridge(ctx, { issuerSocket: issuer.socketPath }, authority, owner.signal)
    ctx.on('approval/request', async () => {
      caller.abort('caller withdrew approval')
      return 'allowed-once' as const
    })

    await expect(ctx.approval.request({
      agent: approvalAgent(), toolName: MEMORY_PUT, callId: CallId('cancel-call'), signal: caller.signal,
    })).resolves.toBe('cancelled')
    expect(issued).toEqual([])
  })

  it('does not substitute a rejected answerer outcome with issuer approval', async () => {
    const authority = {
      getPending: () => { throw new Error('issuer bridge must not inspect a rejected request') },
      agentKeyOf: () => 'bridge-agent',
      issueTicket: () => { throw new Error('issuer bridge must not issue a rejected request') },
    }
    const ctx = new Context()
    await ctx.plugin(ApprovalService)
    registerIssuerBridge(ctx, { issuerSocket: join(tmpdir(), 'unreachable-issuer.sock') }, authority, new AbortController().signal)
    ctx.on('approval/request', async () => 'rejected' as const)

    await expect(ctx.approval.request({ agent: approvalAgent(), toolName: MEMORY_PUT, callId: CallId('rejected-call') }))
      .resolves.toBe('rejected')
  })

  it('refuses hostile parser products before a ticket is issued', async () => {
    const args = { key: 'hostile-parser', value: 1 }
    const exp = Math.floor(Date.now() / 1000) + 300
    const operation = buildOperation(args, exp)
    const issuer = await socketServer((socket) => {
      socket.once('data', () => { socket.end('{"ok":true,"grant":{}}\n') })
    })
    const base = grantFor(args, exp)
    const values: unknown[] = [
      'not-an-object',
      null,
      [],
      new Date(0),
      { ...base, [Symbol('hidden')]: true },
      new Proxy({ ...base }, {
        ownKeys: () => Reflect.ownKeys(base),
        getOwnPropertyDescriptor: () => undefined,
      }),
      Object.defineProperty({ ...base }, 'toolName', { value: MEMORY_PUT, enumerable: false }),
      Object.defineProperty({ ...base }, 'toolName', { get: () => MEMORY_PUT, enumerable: true }),
      (() => { const value = { ...base }; Reflect.deleteProperty(value, 'toolName'); return value })(),
      (() => { const value = { ...base, wrongName: MEMORY_PUT } as Record<string, unknown>; Reflect.deleteProperty(value, 'toolName'); return value })(),
      { ...base, toolName: 1 },
      { ...base, digest: 1 },
      { ...base, digest: 'not-a-digest' },
      { ...base, nonce: 1 },
      { ...base, nonce: 'not a nonce' },
      { ...base, exp: 1.5 },
      { ...base, definitionId: 'not-a-definition' },
      { ...base, operationDigest: 'not-an-operation' },
      { ...base, receiptKeyId: 'not-a-receipt-key' },
      { ...base, signature: 'not-a-signature' },
    ]

    for (const value of values) {
      const issued: unknown[] = []
      const authority = {
        getPending: () => ({ operation, args }),
        agentKeyOf: () => 'bridge-agent',
        issueTicket: (ticket: unknown) => { issued.push(ticket) },
      }
      const ctx = new Context()
      await ctx.plugin(ApprovalService)
      registerIssuerBridge(ctx, { issuerSocket: issuer.socketPath }, authority, new AbortController().signal)
      ctx.on('approval/request', async () => 'allowed-once' as const)
      const parser = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => ({ ok: true, grant: value }) as never)
      try {
        await expect(ctx.approval.request({ agent: approvalAgent(), toolName: MEMORY_PUT, callId: CallId('hostile-parser') }))
          .resolves.toBe('unavailable')
        expect(issued).toEqual([])
      } finally {
        parser.mockRestore()
      }
    }

    const issued: unknown[] = []
    const nullPrototypeAuthority = {
      getPending: () => ({ operation, args }),
      agentKeyOf: () => 'bridge-agent',
      issueTicket: (ticket: unknown) => { issued.push(ticket) },
    }
    const nullPrototypeCtx = new Context()
    await nullPrototypeCtx.plugin(ApprovalService)
    registerIssuerBridge(nullPrototypeCtx, { issuerSocket: issuer.socketPath }, nullPrototypeAuthority, new AbortController().signal)
    nullPrototypeCtx.on('approval/request', async () => 'allowed-once' as const)
    const nullPrototypeGrant = Object.assign(Object.create(null) as Record<string, unknown>, base)
    const parser = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => ({ ok: true, grant: nullPrototypeGrant }) as never)
    try {
      await expect(nullPrototypeCtx.approval.request({ agent: approvalAgent(), toolName: MEMORY_PUT, callId: CallId('null-prototype') }))
        .resolves.toBe('allowed-once')
      expect(issued).toHaveLength(1)
    } finally {
      parser.mockRestore()
    }
  })

  it('fails closed on blank, malformed, and timed-out issuer frames', async () => {
    const args = { key: 'issuer-transport', value: 1 }
    const exp = Math.floor(Date.now() / 1000) + 300
    const operation = buildOperation(args, exp)
    const authority = {
      getPending: () => ({ operation, args }),
      agentKeyOf: () => 'bridge-agent',
      issueTicket: () => { throw new Error('transport refusal must not issue a ticket') },
    }
    const malformed = await socketServer((socket) => {
      socket.once('data', () => { socket.end('\nnot-json\n') })
    })
    const malformedCtx = new Context()
    await malformedCtx.plugin(ApprovalService)
    registerIssuerBridge(malformedCtx, { issuerSocket: malformed.socketPath }, authority, new AbortController().signal)
    malformedCtx.on('approval/request', async () => 'allowed-once' as const)
    await expect(malformedCtx.approval.request({ agent: approvalAgent(), toolName: MEMORY_PUT, callId: CallId('malformed-issuer') }))
      .resolves.toBe('unavailable')

    const closed = await socketServer((socket) => {
      socket.once('data', () => { socket.destroy() })
    })
    const closedCtx = new Context()
    await closedCtx.plugin(ApprovalService)
    registerIssuerBridge(closedCtx, { issuerSocket: closed.socketPath }, authority, new AbortController().signal)
    closedCtx.on('approval/request', async () => 'allowed-once' as const)
    await expect(closedCtx.approval.request({ agent: approvalAgent(), toolName: MEMORY_PUT, callId: CallId('closed-issuer') }))
      .resolves.toBe('unavailable')

    const stalled = await socketServer((socket) => { socket.once('data', () => {}) })
    const timeout = shortSocketTimeout()
    try {
      const timeoutCtx = new Context()
      await timeoutCtx.plugin(ApprovalService)
      registerIssuerBridge(timeoutCtx, { issuerSocket: stalled.socketPath }, authority, new AbortController().signal)
      timeoutCtx.on('approval/request', async () => 'allowed-once' as const)
      await expect(timeoutCtx.approval.request({ agent: approvalAgent(), toolName: MEMORY_PUT, callId: CallId('timed-out-issuer') }))
        .resolves.toBe('unavailable')
    } finally {
      timeout.mockRestore()
    }
  })

  it('does not open an issuer route after the composed signal is already cancelled', async () => {
    const args = { key: 'issuer-race', value: 1 }
    const exp = Math.floor(Date.now() / 1000) + 300
    const operation = buildOperation(args, exp)
    let connections = 0
    const issuer = await socketServer((socket) => {
      connections += 1
      socket.once('data', () => { socket.end('{"ok":true,"grant":{}}\n') })
    })
    const authority = {
      getPending: () => ({ operation, args }),
      agentKeyOf: () => 'bridge-agent',
      issueTicket: () => { throw new Error('a withdrawn request must not issue a ticket') },
    }
    const ctx = new Context()
    await ctx.plugin(ApprovalService)
    const owner = new AbortController()
    const caller = new AbortController()
    const alreadyCancelled = {
      get aborted(): boolean { return true },
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as AbortSignal
    const any = vi.spyOn(AbortSignal, 'any').mockReturnValue(alreadyCancelled)
    registerIssuerBridge(ctx, { issuerSocket: issuer.socketPath }, authority, owner.signal)
    ctx.on('approval/request', async () => 'allowed-once' as const)
    try {
      await expect(ctx.approval.request({
        agent: approvalAgent(), toolName: MEMORY_PUT, callId: CallId('issuer-race'), signal: caller.signal,
      })).resolves.toBe('unavailable')
      await new Promise<void>((resolve) => { setImmediate(resolve) })
      expect(connections).toBe(0)
    } finally {
      any.mockRestore()
    }
  })

  it('withdraws an issuer reply that races an already-approved request', async () => {
    const args = { key: 'issuer-race', value: 1 }
    const exp = Math.floor(Date.now() / 1000) + 300
    const operation = buildOperation(args, exp)
    let connections = 0
    const issuer = await socketServer((socket) => {
      connections += 1
      socket.once('data', () => { socket.end('{"ok":true,"grant":{}}\n') })
    })
    const authority = {
      getPending: () => ({ operation, args }),
      agentKeyOf: () => 'bridge-agent',
      issueTicket: () => { throw new Error('a withdrawn request must not issue a ticket') },
    }
    const ctx = new Context()
    await ctx.plugin(ApprovalService)
    const owner = new AbortController()
    const caller = new AbortController()
    let signalReads = 0
    const racingSignal = {
      get aborted(): boolean { signalReads += 1; return signalReads >= 2 },
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as AbortSignal
    const any = vi.spyOn(AbortSignal, 'any').mockReturnValue(racingSignal)
    registerIssuerBridge(ctx, { issuerSocket: issuer.socketPath }, authority, owner.signal)
    ctx.on('approval/request', async () => 'allowed-once' as const)
    try {
      await expect(ctx.approval.request({
        agent: approvalAgent(), toolName: MEMORY_PUT, callId: CallId('issuer-race'), signal: caller.signal,
      })).resolves.toBe('cancelled')
      expect(connections).toBe(1)
    } finally {
      any.mockRestore()
    }
  })
})
