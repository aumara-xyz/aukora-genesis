/** Guest proposal client wire behavior and authority-artifact exclusion. */
import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server, type Socket } from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BrokerProposalClient,
  brokerConnectDiagnostic,
  requestBrokerKiraRecall,
} from '../src/proposal-client.ts'
import {
  KIRA_RECALL_MAX_RECORDS,
  KIRA_RECALL_MAX_RESULT_BYTES,
  kiraRecordContentSha256,
} from '@aukora/core/kira/recall.mjs'
import { stageKiraMemoryRecord } from '@aukora/core/kira/stage.mjs'

interface Fixture {
  directory: string
  frames: Array<Record<string, unknown>>
  server: Server
  socketPath: string
  sockets: Set<Socket>
}

const fixtures: Fixture[] = []

afterEach(async () => {
  for (const fixture of fixtures.splice(0).reverse()) {
    for (const socket of fixture.sockets) socket.destroy()
    await new Promise<void>((resolve, reject) => {
      fixture.server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    })
    rmSync(fixture.directory, { recursive: true, force: true })
  }
})

async function fixtureFor(
  reply: (frame: Record<string, unknown>, index: number, socket: Socket) => Record<string, unknown> | null,
): Promise<Fixture> {
  const directory = mkdtempSync(join(tmpdir(), 'aukora-proposal-client-'))
  const socketPath = join(directory, 'broker.sock')
  const frames: Array<Record<string, unknown>> = []
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    let buffer = ''
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const cut = buffer.indexOf('\n')
      if (cut === -1) return
      const frame = JSON.parse(buffer.slice(0, cut)) as Record<string, unknown>
      frames.push(frame)
      const response = reply(frame, frames.length - 1, socket)
      if (response !== null) socket.end(`${JSON.stringify(response)}\n`)
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => {
      server.removeAllListeners('error')
      resolve()
    })
  })
  const fixture = { directory, frames, server, socketPath, sockets }
  fixtures.push(fixture)
  return fixture
}

const namespace = '1'.repeat(32)
const proposalId = '2'.repeat(32)

const recalledRecord = stageKiraMemoryRecord({
  subject: 'aukora:subject:client',
  kind: 'observation',
  source: [],
  content: { note: 'client validation' },
  links: [],
  privacy: 'local',
  createdAt: '2026-08-30T00:00:00Z',
}).record

function successfulRecallReply(): Record<string, unknown> {
  return {
    ok: true,
    query: { subject: recalledRecord.subject, kind: recalledRecord.kind },
    privacy: ['local'],
    bounds: { maxRecords: KIRA_RECALL_MAX_RECORDS, maxBytes: KIRA_RECALL_MAX_RESULT_BYTES },
    citations: [{
      recordId: recalledRecord.recordId,
      contentSha256: kiraRecordContentSha256(recalledRecord),
      auraSequence: 1,
      auraEntryHash: 'a'.repeat(64),
      verifiedHead: 'a'.repeat(64),
    }],
    result: { status: 'found', records: [recalledRecord] },
  }
}

describe('broker proposal client', () => {
  it('validates cited KIRA bytes and preserves refusal certainty', async () => {
    const accepted = await fixtureFor(() => successfulRecallReply())
    await expect(requestBrokerKiraRecall(
      accepted.socketPath,
      'observation',
      new AbortController().signal,
    )).resolves.toMatchObject({ result: { status: 'found', records: [recalledRecord] } })

    const falseCitation = await fixtureFor(() => {
      const reply = successfulRecallReply()
      const citations = reply.citations as Array<Record<string, unknown>>
      citations[0] = { ...citations[0], contentSha256: 'b'.repeat(64) }
      return reply
    })
    await expect(requestBrokerKiraRecall(
      falseCitation.socketPath,
      'observation',
      new AbortController().signal,
    )).rejects.toMatchObject({
      state: 'INDETERMINATE',
      message: 'broker:kira-recall-response-malformed',
    })

    const refused = await fixtureFor(() => ({
      ok: false, state: 'REFUSED', reason: 'broker:kira-recall-unconfigured',
    }))
    await expect(requestBrokerKiraRecall(
      refused.socketPath,
      undefined,
      new AbortController().signal,
    )).rejects.toMatchObject({
      state: 'REFUSED',
      message: 'broker:kira-recall-unconfigured',
    })

    const uncertain = await fixtureFor(() => ({
      ok: false,
      state: 'INDETERMINATE',
      reason: 'broker:dispatch-outcome-indeterminate',
      detail: 'reader fault',
    }))
    await expect(requestBrokerKiraRecall(
      uncertain.socketPath,
      undefined,
      new AbortController().signal,
    )).rejects.toMatchObject({
      state: 'INDETERMINATE',
      message: 'broker:dispatch-outcome-indeterminate',
    })

    const malformedFailure = await fixtureFor(() => ({
      ok: false, state: 'REFUSED', reason: 'broker:kira-recall-unconfigured', rider: true,
    }))
    await expect(requestBrokerKiraRecall(
      malformedFailure.socketPath,
      undefined,
      new AbortController().signal,
    )).rejects.toMatchObject({
      state: 'INDETERMINATE',
      message: 'broker:kira-recall-response-malformed',
    })
  })

  it('observes settlement carrying signed receipt while client requests carry no authority artifacts', async () => {
    let statusCount = 0
    const mockReceipt = {
      requestDigest: 'a'.repeat(64),
      definitionId: 'b'.repeat(64),
      nonce: 'mock-nonce',
      sequence: 1,
      path: '/mock/path',
      bytes: 12,
      contentSha256: 'c'.repeat(64),
      inode: 12345,
      mtimeNs: '1000',
      confinement: { class: 'state-owned' },
      signature: 'd'.repeat(86) + '==',
    }
    const fixture = await fixtureFor((frame) => {
      if (frame.op === 'proposal.open') return { ok: true, proposalNamespace: namespace }
      if (frame.op === 'proposal.deposit') return { ok: true, proposalId, state: 'PENDING' }
      if (frame.op === 'proposal.status' && statusCount++ === 0) {
        return { ok: true, proposalId, state: 'PENDING' }
      }
      return { ok: true, proposalId, state: 'SETTLED', receipt: mockReceipt }
    })
    const client = new BrokerProposalClient({ socketPath: fixture.socketPath, pollIntervalMs: 1 })

    await expect(client.settle(
      'call-1',
      { key: 'proposal', value: { exact: true } },
      new AbortController().signal,
    )).resolves.toEqual({ ok: true, proposalId, state: 'SETTLED', receipt: mockReceipt })

    expect(fixture.frames.map(frame => frame.op)).toEqual([
      'proposal.open', 'proposal.deposit', 'proposal.status', 'proposal.status',
    ])
    const transcript = JSON.stringify(fixture.frames)
    for (const forbidden of ['issuerSocket', 'grant', 'signature', 'nonce', 'authorizationDigest']) {
      expect(transcript).not.toContain(forbidden)
    }
  })

  it('rejects a settled response missing receipt as malformed', async () => {
    const fixture = await fixtureFor((frame) => {
      if (frame.op === 'proposal.open') return { ok: true, proposalNamespace: namespace }
      if (frame.op === 'proposal.deposit') return { ok: true, proposalId, state: 'PENDING' }
      if (frame.op === 'proposal.status') return { ok: true, proposalId, state: 'SETTLED' }
      return null
    })
    const client = new BrokerProposalClient({ socketPath: fixture.socketPath, pollIntervalMs: 1 })

    await expect(client.settle(
      'call-missing-receipt',
      { key: 'proposal', value: { exact: true } },
      new AbortController().signal,
    )).rejects.toMatchObject({
      state: 'INDETERMINATE',
      message: 'broker:proposal-response-malformed',
    })
  })

  it('allocates one fresh namespace after broker restart invalidates the old one', async () => {
    let opens = 0
    const secondNamespace = '3'.repeat(32)
    const mockReceipt = { note: 'restarted-receipt' }
    const fixture = await fixtureFor((frame) => {
      if (frame.op === 'proposal.open') {
        opens += 1
        return { ok: true, proposalNamespace: opens === 1 ? namespace : secondNamespace }
      }
      if (frame.op === 'proposal.deposit' && frame.proposalNamespace === namespace) {
        return { ok: false, state: 'REFUSED', reason: 'broker:proposal-namespace-invalid' }
      }
      if (frame.op === 'proposal.deposit') return { ok: true, proposalId, state: 'PENDING' }
      return { ok: true, proposalId, state: 'SETTLED', receipt: mockReceipt }
    })
    const client = new BrokerProposalClient({ socketPath: fixture.socketPath, pollIntervalMs: 1 })

    await expect(client.settle(
      'restart-call',
      { key: 'restart', value: true },
      new AbortController().signal,
    )).resolves.toMatchObject({ state: 'SETTLED', receipt: mockReceipt })
    expect(opens).toBe(2)
  })

  it('does not let one cancelled call cancel a namespace shared by another call', async () => {
    const mockReceipt = { note: 'surviving-receipt' }
    const fixture = await fixtureFor((frame, _index, socket) => {
      if (frame.op === 'proposal.open') {
        setTimeout(() => socket.end(`${JSON.stringify({ ok: true, proposalNamespace: namespace })}\n`), 100)
        return null
      }
      if (frame.op === 'proposal.deposit') return { ok: true, proposalId, state: 'SETTLED', receipt: mockReceipt }
      return null
    })
    const client = new BrokerProposalClient({ socketPath: fixture.socketPath, pollIntervalMs: 1 })
    const cancelled = new AbortController()
    const first = client.settle('cancelled-call', { key: 'cancelled', value: true }, cancelled.signal)
    const second = client.settle(
      'surviving-call',
      { key: 'surviving', value: true },
      new AbortController().signal,
    )
    while (!fixture.frames.some(frame => frame.op === 'proposal.open')) {
      await new Promise(resolve => setTimeout(resolve, 1))
    }
    cancelled.abort(new Error('first caller stopped'))

    const firstOutcome = await Promise.race<unknown>([
      first.then<unknown, unknown>(
        () => 'unexpected-success',
        (error: unknown) => error,
      ),
      new Promise<unknown>((resolve) => {
        setTimeout(() => { resolve('cancellation-timed-out') }, 25)
      }),
    ])
    expect(firstOutcome).toMatchObject({ state: 'REFUSED' })
    await expect(second).resolves.toMatchObject({ state: 'SETTLED' })
    expect(fixture.frames.filter(frame => frame.op === 'proposal.open')).toHaveLength(1)
  })

  it('distinguishes pre-admission refusal from lost observation after acceptance', async () => {
    const refused = await fixtureFor(frame => frame.op === 'proposal.open'
      ? { ok: true, proposalNamespace: namespace }
      : { ok: false, state: 'REFUSED', reason: 'broker:proposal-table-full' })
    const refusedClient = new BrokerProposalClient({ socketPath: refused.socketPath, pollIntervalMs: 1 })
    await expect(refusedClient.settle(
      'refused-call',
      { key: 'refused', value: true },
      new AbortController().signal,
    )).rejects.toMatchObject({
      state: 'REFUSED',
      message: 'broker:proposal-table-full',
    })

    const accepted = await fixtureFor((frame) => {
      if (frame.op === 'proposal.open') return { ok: true, proposalNamespace: namespace }
      if (frame.op === 'proposal.deposit') return { ok: true, proposalId, state: 'PENDING' }
      return null
    })
    const acceptedClient = new BrokerProposalClient({ socketPath: accepted.socketPath, pollIntervalMs: 1 })
    const controller = new AbortController()
    const outcome = acceptedClient.settle(
      'accepted-call',
      { key: 'accepted', value: true },
      controller.signal,
    )
    while (!accepted.frames.some(frame => frame.op === 'proposal.status')) {
      await new Promise(resolve => setTimeout(resolve, 1))
    }
    controller.abort(new Error('caller stopped'))
    await expect(outcome).rejects.toMatchObject({
      state: 'INDETERMINATE',
      message: 'proposal was accepted but its terminal outcome was not observed',
    })
  })

  it('reports uncertain deposit delivery and malformed deposit success as indeterminate', async () => {
    const lost = await fixtureFor((frame) => {
      if (frame.op === 'proposal.open') return { ok: true, proposalNamespace: namespace }
      return null
    })
    const lostClient = new BrokerProposalClient({ socketPath: lost.socketPath, pollIntervalMs: 1 })
    const controller = new AbortController()
    const lostOutcome = lostClient.settle(
      'lost-deposit-reply',
      { key: 'lost-deposit', value: true },
      controller.signal,
    )
    while (!lost.frames.some(frame => frame.op === 'proposal.deposit')) {
      await new Promise(resolve => setTimeout(resolve, 1))
    }
    controller.abort(new Error('deposit reply was lost'))
    await expect(lostOutcome).rejects.toMatchObject({
      state: 'INDETERMINATE',
      message: 'proposal was sent but its terminal outcome was not observed',
    })

    const malformed = await fixtureFor((frame) => {
      if (frame.op === 'proposal.open') return { ok: true, proposalNamespace: namespace }
      return { ok: true, proposalId, state: 'PENDING', rider: 'not-closed' }
    })
    const malformedClient = new BrokerProposalClient({ socketPath: malformed.socketPath, pollIntervalMs: 1 })
    await expect(malformedClient.settle(
      'malformed-deposit-reply',
      { key: 'malformed-deposit', value: true },
      new AbortController().signal,
    )).rejects.toMatchObject({
      state: 'INDETERMINATE',
      message: 'broker:proposal-response-malformed',
    })
  })

  it('refuses invalid configuration and malformed pre-admission replies', async () => {
    expect(() => new BrokerProposalClient({ socketPath: '' })).toThrow('requires a broker socket')
    expect(() => new BrokerProposalClient({ socketPath: '/tmp/broker', pollIntervalMs: 0 }))
      .toThrow('proposal poll interval')
    const fixture = await fixtureFor(() => ({ ok: true, proposalNamespace: 'not-a-namespace' }))
    const client = new BrokerProposalClient({ socketPath: fixture.socketPath })
    await expect(client.settle(
      'malformed-open',
      { key: 'malformed', value: true },
      new AbortController().signal,
    )).rejects.toMatchObject({ state: 'REFUSED' })

    const oversized = await fixtureFor(() => ({ ok: false, reason: 'x'.repeat(64 * 1024) }))
    const oversizedClient = new BrokerProposalClient({ socketPath: oversized.socketPath })
    await expect(oversizedClient.settle(
      'oversized-open',
      { key: 'oversized', value: true },
      new AbortController().signal,
    )).rejects.toMatchObject({
      state: 'REFUSED',
      message: 'broker reply exceeded the frame limit',
    })
  })
})

describe('broker transport outage diagnostics', () => {
  const signal = new AbortController().signal

  it('names an absent broker socket with the route, path, and ENOENT', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'aukora-absent-broker-'))
    const absent = join(directory, 'broker.sock')
    try {
      await expect(requestBrokerKiraRecall(absent, undefined, signal)).rejects.toThrow(
        `broker route unreachable; broker may be stopped or restarting; retained memory has not been checked (${absent}: connect ENOENT)`,
      )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('distinguishes a refused connection with ECONNREFUSED', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'aukora-refused-broker-'))
    const socketPath = join(directory, 'broker.sock')
    // A crashed listener leaves a bound socket file behind: connect then fails
    // with ECONNREFUSED, distinguishing "nothing listens" from "route absent".
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { createServer } from 'node:net'
      const server = createServer(() => {})
      server.listen(process.argv[1], () => { process.send('bound') })
    `, socketPath], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] })
    const closed = new Promise<void>((resolve) => { child.once('close', () => { resolve() }) })
    try {
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error): void => {
          clearTimeout(timer)
          child.off('message', onMessage)
          child.off('error', onError)
          child.off('exit', onExit)
          if (error === undefined) resolve()
          else reject(error)
        }
        const onMessage = (message: unknown): void => {
          if (message === 'bound') finish()
        }
        const onError = (error: Error): void => { finish(error) }
        const onExit = (): void => { finish(new Error('crashed-listener fixture exited before binding')) }
        const timer = setTimeout(() => { finish(new Error('crashed-listener fixture did not bind')) }, 5000)
        child.on('message', onMessage)
        child.once('error', onError)
        child.once('exit', onExit)
      })
      child.kill('SIGKILL')
      await closed
      await expect(requestBrokerKiraRecall(socketPath, undefined, signal)).rejects.toThrow(
        `broker route unreachable; broker may be stopped or restarting; retained memory has not been checked (${socketPath}: connect ECONNREFUSED)`,
      )
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await closed
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('keeps non-connection transport failures out of the outage diagnostic', async () => {
    // A regular-file socket path reports ENOTSOCK on macOS and ECONNREFUSED
    // on Linux, so inject ENOTSOCK to pin preservation of that distinct cause.
    const wrongKind = brokerConnectDiagnostic(
      Object.assign(new Error('connect ENOTSOCK'), { code: 'ENOTSOCK' }),
      '/tmp/aukora-wrongkind.sock',
      false,
    )
    expect(wrongKind.message).toBe('connect ENOTSOCK')
    expect(wrongKind.message).not.toContain('broker route unreachable')

    const malformed = await fixtureFor(() => ({ ok: 'not-a-boolean' }))
    await expect(requestBrokerKiraRecall(malformed.socketPath, undefined, signal)).rejects.toThrow('broker:kira-recall-response-malformed')
    await expect(requestBrokerKiraRecall(malformed.socketPath, undefined, signal)).rejects.not.toThrow('broker route unreachable')

    // A broker-side authority refusal is a REFUSED outcome, not an outage.
    const refused = await fixtureFor(() => ({ ok: false, state: 'REFUSED', reason: 'broker:subject-unbound' }))
    await expect(requestBrokerKiraRecall(refused.socketPath, undefined, signal)).rejects.toMatchObject({ state: 'REFUSED', message: 'broker:subject-unbound' })
    await expect(requestBrokerKiraRecall(refused.socketPath, undefined, signal)).rejects.not.toThrow('broker route unreachable')
  })

  it('keeps healthy recall results and citations unchanged', async () => {
    const healthy = await fixtureFor(() => successfulRecallReply())
    const recalled = await requestBrokerKiraRecall(healthy.socketPath, undefined, signal)
    expect(recalled.result).toMatchObject({ status: 'found' })
    expect(recalled.citations[0]).toMatchObject({ recordId: recalledRecord.recordId, auraSequence: 1 })
  })

  it('treats a post-write connection failure as a lost outcome, not an unchecked route', () => {
    const path = '/tmp/aukora-written.sock'
    const preWrite = brokerConnectDiagnostic({ code: 'ENOENT' }, path, false)
    expect(preWrite.message).toContain('retained memory has not been checked')
    const postWrite = brokerConnectDiagnostic({ code: 'ENOENT' }, path, true)
    expect(postWrite.message).toContain('the request was written but no reply was observed')
    expect(postWrite.message).not.toContain('has not been checked')
    expect(postWrite.requestWritten).toBe(true)
    const refused = brokerConnectDiagnostic({ code: 'ECONNREFUSED' }, path, true)
    expect(refused.message).toContain('the request was written but no reply was observed')
    const other = brokerConnectDiagnostic(new Error('read ECONNRESET'), path, false)
    expect(other.message).toBe('read ECONNRESET')
  })

  it.each([undefined, null, false, 0, 'failure'])('handles a non-Error transport reason: %s', (reason) => {
    expect(brokerConnectDiagnostic(reason, '/tmp/aukora-broker.sock', false)).toMatchObject({
      message: 'broker transport failed',
      requestWritten: false,
    })
  })
})
