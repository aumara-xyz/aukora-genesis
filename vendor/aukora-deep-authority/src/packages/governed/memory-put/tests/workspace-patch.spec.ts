/** ToolRuntime coverage of workspace proposals; socket replies are fixtures, not settlement evidence. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { createServer, type Server, type Socket } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { BrokerProposalClient } from '../src/proposal-client.ts'
import * as workspacePatch from '../src/workspace-patch.ts'

const namespace = '1'.repeat(32)
const proposalId = '2'.repeat(32)
const receipt = { signature: 'fixture-signature', requestDigest: 'fixture-digest', sequence: 1 }
const terminal = { ok: true, proposalId, state: 'SETTLED', receipt }
const args = {
  workspace: 'project',
  path: 'notes.txt',
  beforeSha256: null,
  content: 'exact café\r\n',
}

interface Fixture {
  directory: string
  socketPath: string
  frames: Array<Record<string, unknown>>
  sockets: Set<Socket>
  server: Server
}

const fixtures: Fixture[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  vi.restoreAllMocks()
  for (const fixture of fixtures.splice(0).reverse()) {
    for (const socket of fixture.sockets) socket.destroy()
    if (fixture.server.listening) {
      await new Promise<void>((resolve, reject) => {
        fixture.server.close((error) => {
          if (error === undefined) resolve()
          else reject(error)
        })
      })
    }
    rmSync(fixture.directory, { recursive: true, force: true })
  }
})

async function startPeer(
  reply: (frame: Record<string, unknown>, socket: Socket) => Record<string, unknown> | null = () => terminal,
): Promise<Fixture> {
  const directory = mkdtempSync(join(tmpdir(), 'workspace-tool-'))
  const socketPath = join(directory, 'broker.sock')
  const frames: Array<Record<string, unknown>> = []
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    const decoder = new StringDecoder('utf8')
    let buffered = ''
    socket.on('data', (chunk: Buffer) => {
      buffered += decoder.write(chunk)
      const end = buffered.indexOf('\n')
      if (end < 0) return
      const frame = JSON.parse(buffered.slice(0, end)) as Record<string, unknown>
      frames.push(frame)
      const response = frame.op === 'proposal.open'
        ? { ok: true, proposalNamespace: namespace }
        : reply(frame, socket)
      if (response !== null) socket.end(`${JSON.stringify(response)}\n`)
    })
  })
  const fixture = { directory, socketPath, frames, sockets, server }
  fixtures.push(fixture)
  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error): void => { reject(error) }
    server.once('error', failed)
    server.listen(socketPath, () => {
      server.off('error', failed)
      resolve()
    })
  })
  return fixture
}

async function mount(socketPath: string, config: Partial<workspacePatch.Config> = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const fiber = await ctx.plugin(workspacePatch, {
    brokerSocket: socketPath,
    proposalPollIntervalMs: 1,
    ...config,
  })
  return { ctx, fiber }
}

function execute(ctx: Context, input: unknown = args, callId = 'workspace-call') {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(callId),
    name: 'workspace.patch',
    arguments: input,
  })
}

describe.runIf(process.platform !== 'win32')('opt-in workspace.patch tool', () => {
  it('exports a function plugin and resolves the parent route configuration', () => {
    expect('default' in workspacePatch).toBe(false)
    expect(workspacePatch.inject).toEqual(['tools'])
    expect(workspacePatch.Config({ brokerSocket: '/tmp/parent-broker.sock' })).toEqual({
      brokerSocket: '/tmp/parent-broker.sock', proposalPollIntervalMs: 50, reviewLimitBytes: 8192,
    })
    for (const invalid of [
      {},
      { brokerSocket: '' },
      { brokerSocket: '/tmp/broker.sock', reviewLimitBytes: 0 },
      { brokerSocket: '/tmp/broker.sock', reviewLimitBytes: 1.5 },
      { brokerSocket: '/tmp/broker.sock', proposalPollIntervalMs: 1001 },
    ]) {
      expect(() => { Reflect.apply(workspacePatch.Config, undefined, [invalid]) }).toThrow()
    }
  })

  it('submits exact arguments and exposes the terminal result and receipt without guest approval', async () => {
    const peer = await startPeer(frame => frame.op === 'proposal.deposit'
      ? { ok: true, proposalId, state: 'PENDING' }
      : terminal)
    const { ctx } = await mount(peer.socketPath)

    const result = await execute(ctx)

    expect(result.isError).toBe(false)
    expect(result.value).toEqual(terminal)
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(terminal) }])
    expect(peer.frames).toEqual([
      { op: 'proposal.open' },
      { op: 'proposal.deposit', proposalNamespace: namespace, callId: 'workspace-call', toolName: 'workspace.patch', arguments: args },
      { op: 'proposal.status', proposalNamespace: namespace, proposalId },
    ])
    expect(ctx.tools.schemas().map(tool => tool.name)).toEqual(['workspace.patch'])
    const tool = ctx.tools.get('workspace.patch')!
    expect(tool.presentCall?.(args)).toEqual({ card: 'generic', title: 'workspace.patch' })
    expect(tool.presentResult?.(args, result)).toEqual({ card: 'generic', title: 'workspace.patch', content: result.content })
  })

  it('accepts an already settled proposal and a digest-bound replacement', async () => {
    const peer = await startPeer()
    const { ctx } = await mount(peer.socketPath)
    const replacement = { ...args, beforeSha256: 'a'.repeat(64) }

    expect(await execute(ctx, replacement)).toMatchObject({ isError: false, value: terminal })
    expect(peer.frames[1]).toMatchObject({ arguments: replacement })
    expect(peer.frames.map(frame => frame.op)).toEqual(['proposal.open', 'proposal.deposit'])
  })

  it('keeps broker refusal distinct from an uncertain terminal result', async () => {
    for (const state of ['REFUSED', 'INDETERMINATE'] as const) {
      const peer = await startPeer(frame => frame.op === 'proposal.deposit'
        ? { ok: true, proposalId, state: 'PENDING' }
        : { ok: false, proposalId, state, reason: 'fixture-outcome' })
      const { ctx } = await mount(peer.socketPath)
      const word = state === 'REFUSED' ? 'refused' : 'indeterminate'
      const result = await execute(ctx)

      expect(result).toMatchObject({
        isError: true,
        error: { message: `workspace.patch ${word}: fixture-outcome`, info: { code: `AUKORA_WORKSPACE_${state}` } },
      })
      expect(result.value).toBeUndefined()
    }
  })

  it('reports a rejected deposit as refused', async () => {
    const peer = await startPeer(() => ({ ok: false, state: 'REFUSED', reason: 'broker:workspace-subject-authority-required' }))
    const { ctx } = await mount(peer.socketPath)

    expect(await execute(ctx)).toMatchObject({
      isError: true,
      error: { info: { code: 'AUKORA_WORKSPACE_REFUSED' } },
    })
    expect(peer.frames.map(frame => frame.op)).toEqual(['proposal.open', 'proposal.deposit'])
  })

  it('preserves uncertainty when observation is lost after a deposit', async () => {
    const peer = await startPeer((_frame, socket) => {
      socket.destroy()
      return null
    })
    const { ctx } = await mount(peer.socketPath)

    expect(await execute(ctx)).toMatchObject({
      isError: true,
      error: { info: { code: 'AUKORA_WORKSPACE_INDETERMINATE' } },
    })
  })

  it('retains an unexpected client failure without calling it a broker refusal', async () => {
    vi.spyOn(BrokerProposalClient.prototype, 'settleWorkspacePatch')
      .mockRejectedValueOnce(new Error('fixture-client-failure'))
    const { ctx } = await mount('/unused-workspace-broker.sock')

    const result = await execute(ctx)

    expect(result).toMatchObject({ isError: true, error: { message: 'fixture-client-failure' } })
    expect(result.error?.info?.code).not.toBe('AUKORA_WORKSPACE_REFUSED')
  })

  it.each([
    ['extra fields', { ...args, command: 'unsupported' }],
    ['unknown workspace grammar', { ...args, workspace: '/path' }],
    ['invalid destination grammar', { ...args, path: '../outside' }],
    ['malformed preimage digest', { ...args, beforeSha256: 'short' }],
    ['missing content', { workspace: args.workspace, path: args.path, beforeSha256: null }],
    ['non-string content', { ...args, content: 123 }],
  ])('rejects %s before allocating a proposal namespace', async (_label, invalid) => {
    const peer = await startPeer()
    const { ctx } = await mount(peer.socketPath)

    expect((await execute(ctx, invalid)).isError).toBe(true)
    expect(peer.frames).toEqual([])
  })

  it('measures the exact UTF-8 byte limit without trimming replacement text', async () => {
    const peer = await startPeer()
    const { ctx } = await mount(peer.socketPath, { reviewLimitBytes: 4 })

    expect(await execute(ctx, { ...args, content: 'ééx' }, 'over-limit')).toMatchObject({
      isError: true,
      error: {
        message: 'workspace.patch refused: replacement is 5 bytes and exceeds the 4-byte review limit',
        info: { code: 'AUKORA_WORKSPACE_REFUSED' },
      },
    })
    expect(peer.frames).toEqual([])
    expect((await execute(ctx, { ...args, content: 'éé' }, 'at-limit')).isError).toBe(false)
    expect(peer.frames[1]).toMatchObject({ arguments: { ...args, content: 'éé' } })
  })

  it('unregisters and stops pending observation when its owner unloads', async () => {
    const peer = await startPeer(frame => frame.op === 'proposal.deposit'
      ? { ok: true, proposalId, state: 'PENDING' }
      : null)
    const { ctx, fiber } = await mount(peer.socketPath)
    const running = execute(ctx)
    await expect.poll(() => peer.frames.some(frame => frame.op === 'proposal.status')).toBe(true)

    await fiber.dispose()

    expect(ctx.tools.get('workspace.patch')).toBeUndefined()
    expect(await running).toMatchObject({
      isError: true,
      error: { info: { code: 'AUKORA_WORKSPACE_INDETERMINATE' } },
    })
    await expect.poll(() => peer.sockets.size).toBe(0)
  })

  it('leaves other registered tools and their execution policy intact', async () => {
    const peer = await startPeer()
    const { ctx, fiber } = await mount(peer.socketPath)
    ctx.tools.register(defineTool({
      name: 'other.tool', description: 'Fixture echo.', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: () => Promise.resolve('retained'),
    }))
    ctx.on('tools/pre-execute', (exec, next) => exec.name === 'other.tool'
      ? Promise.resolve({ kind: 'deny' as const, reason: 'fixture-policy' })
      : next())

    const other = () => ctx.tools.execute({
      name: 'other.tool', callId: CallId('other'), arguments: {}, signal: new AbortController().signal,
    })
    expect(await other()).toMatchObject({ isError: true, error: { message: 'fixture-policy' } })
    await fiber.dispose()
    expect(ctx.tools.schemas().map(tool => tool.name)).toEqual(['other.tool'])
    expect(await other()).toMatchObject({ isError: true, error: { message: 'fixture-policy' } })
    expect(peer.frames).toEqual([])
  })
})
