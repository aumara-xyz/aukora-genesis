/** Real broker-process coverage for the parent-bound KIRA recall route. */
import { createConnection } from 'node:net'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BROKER_REFUSE,
  KIRA_RECALL_POLICY_ENV,
  provisionBrokerIdentity,
  spawnBroker,
} from '@aukora/core/broker/broker.mjs'
import { appendEntry, readHead } from '@aukora/core/aura/record.mjs'
import { memoryPut } from '@aukora/core/broker/effect.mjs'
import { requestBrokerKiraRecall } from '@deepseek-ai/dsh-aukora-memory/src/proposal-client.ts'
import { KIRA_RECALL_TOOL } from '@aukora/core/kira/recall.mjs'
import { stageKiraMemoryRecord } from '@aukora/core/kira/stage.mjs'

const roots: string[] = []
const children: Array<import('node:child_process').ChildProcess> = []

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      await once(child, 'exit')
    }
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aukora-kira-recall-broker-'))
  roots.push(root)
  const stateDir = join(root, 'state')
  mkdirSync(stateDir, { mode: 0o700 })
  const socketPath = join(root, 'broker.sock')
  const pair = generateKeyPairSync('ed25519')
  const rootPublicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  provisionBrokerIdentity(stateDir)
  return { root, stateDir, socketPath, rootPublicKeyPem }
}

async function launch(
  base: ReturnType<typeof fixture>,
  options: {
    policy?: { subject: string; privacy: readonly string[] }
    env?: Record<string, string | undefined>
  } = {},
) {
  const child = await spawnBroker({
    socketPath: base.socketPath,
    stateDir: base.stateDir,
    rootPublicKeyPem: base.rootPublicKeyPem,
    ...(options.policy === undefined ? {} : { kiraRecallPolicy: options.policy }),
    ...(options.env === undefined ? {} : { env: options.env }),
  })
  children.push(child)
  return child
}

function request(socketPath: string, frame: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    let text = ''
    socket.once('connect', () => socket.write(`${JSON.stringify(frame)}\n`))
    socket.once('error', reject)
    socket.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8')
      const cut = text.indexOf('\n')
      if (cut === -1) return
      socket.destroy()
      resolve(JSON.parse(text.slice(0, cut)) as Record<string, unknown>)
    })
  })
}

function recordSettlement(
  stateDir: string,
  key: string,
  contentSha256: string,
): void {
  const sequence = readHead(join(stateDir, 'aura.jsonl')).count + 1
  appendEntry({
    file: join(stateDir, 'aura.jsonl'),
    fields: { verdict: 'settled', sequence, key, contentSha256 },
  })
  writeFileSync(join(stateDir, 'seq'), String(sequence), { mode: 0o600 })
}

function settleRecord(stateDir: string, options: {
  subject: string
  privacy: 'local' | 'exportable' | 'private'
  note?: string
  createdAt?: string
}) {
  const staged = stageKiraMemoryRecord({
    subject: options.subject,
    kind: 'observation',
    source: [],
    content: { note: options.note ?? 'the remembered bytes' },
    links: [],
    privacy: options.privacy,
    createdAt: options.createdAt ?? '2026-08-30T00:00:00Z',
  })
  const evidence = memoryPut(stateDir, staged.memoryPut)
  recordSettlement(stateDir, staged.recordId, evidence.contentSha256)
  return { staged, evidence }
}

describe('broker-owned KIRA recall', () => {
  it('returns a cited record under the parent-owned subject and privacy policy', async () => {
    const base = fixture()
    const { staged, evidence } = settleRecord(base.stateDir, {
      subject: 'aumlok:subject:owner',
      privacy: 'local',
    })
    await launch(base, { policy: { subject: 'aumlok:subject:owner', privacy: ['local'] } })

    const recalled = await requestBrokerKiraRecall(
      base.socketPath,
      'observation',
      new AbortController().signal,
    )

    expect(recalled.query).toEqual({ subject: 'aumlok:subject:owner', kind: 'observation' })
    expect(recalled.privacy).toEqual(['local'])
    expect(recalled.result).toEqual({ status: 'found', records: [staged.memoryPut.value] })
    expect(recalled.citations).toEqual([{
      recordId: staged.recordId,
      contentSha256: evidence.contentSha256,
      auraSequence: 1,
      auraEntryHash: recalled.citations[0]?.verifiedHead,
      verifiedHead: recalled.citations[0]?.verifiedHead,
    }])
  })

  it('reports a verified empty result when the broker-owned store is empty', async () => {
    const base = fixture()
    await launch(base, { policy: { subject: 'aumlok:subject:owner', privacy: ['local'] } })

    await expect(requestBrokerKiraRecall(
      base.socketPath,
      undefined,
      new AbortController().signal,
    )).resolves.toMatchObject({
      query: { subject: 'aumlok:subject:owner' },
      privacy: ['local'],
      citations: [],
      result: { status: 'empty' },
    })
  })

  it('filters a verified record without revealing a disallowed privacy class', async () => {
    const base = fixture()
    settleRecord(base.stateDir, { subject: 'aumlok:subject:owner', privacy: 'private' })
    await launch(base, { policy: { subject: 'aumlok:subject:owner', privacy: ['local'] } })

    await expect(requestBrokerKiraRecall(
      base.socketPath,
      undefined,
      new AbortController().signal,
    )).resolves.toMatchObject({ citations: [], result: { status: 'empty' } })
  })

  it('returns only permitted records when verified memory mixes privacy classes', async () => {
    const base = fixture()
    const allowed = settleRecord(base.stateDir, {
      subject: 'aumlok:subject:owner',
      privacy: 'local',
      note: 'visible',
      createdAt: '2026-08-30T00:00:00Z',
    })
    settleRecord(base.stateDir, {
      subject: 'aumlok:subject:owner',
      privacy: 'private',
      note: 'hidden',
      createdAt: '2026-08-30T00:00:01Z',
    })
    await launch(base, { policy: { subject: 'aumlok:subject:owner', privacy: ['local'] } })

    await expect(requestBrokerKiraRecall(
      base.socketPath,
      undefined,
      new AbortController().signal,
    )).resolves.toMatchObject({
      citations: [{ recordId: allowed.staged.recordId }],
      result: { status: 'found', records: [allowed.staged.record] },
    })
  })

  it('keeps a stale key projection undetermined even when every object remains recorded', async () => {
    const base = fixture()
    const first = memoryPut(base.stateDir, { key: 'ordinary-key', value: { version: 1 } })
    recordSettlement(base.stateDir, 'ordinary-key', first.contentSha256)
    const second = memoryPut(base.stateDir, { key: 'ordinary-key', value: { version: 2 } })
    recordSettlement(base.stateDir, 'ordinary-key', second.contentSha256)
    writeFileSync(
      join(base.stateDir, 'memory', 'keys', 'ordinary-key.json'),
      `${JSON.stringify({ key: 'ordinary-key', contentSha256: first.contentSha256 })}\n`,
    )
    await launch(base, { policy: { subject: 'aumlok:subject:owner', privacy: ['local'] } })

    await expect(requestBrokerKiraRecall(
      base.socketPath,
      undefined,
      new AbortController().signal,
    )).resolves.toMatchObject({
      citations: [],
      result: { status: 'undetermined', reason: 'memory-unverified' },
    })
  })

  it('refuses rider fields and an unknown kind before reading state', async () => {
    const base = fixture()
    await launch(base, { policy: { subject: 'aumlok:subject:owner', privacy: ['local'] } })

    await expect(request(base.socketPath, {
      op: KIRA_RECALL_TOOL,
      subject: 'attacker-selected',
    })).resolves.toEqual({
      ok: false,
      state: 'REFUSED',
      reason: BROKER_REFUSE.KIRA_RECALL_FRAME_NOT_EXACT,
    })
    await expect(request(base.socketPath, {
      op: KIRA_RECALL_TOOL,
      kind: 'rumor',
    })).resolves.toEqual({
      ok: false,
      state: 'REFUSED',
      reason: BROKER_REFUSE.KIRA_RECALL_KIND_INVALID,
    })
  })

  it('does not inherit an ambient recall policy when the parent omits one', async () => {
    const base = fixture()
    await launch(base, {
      env: {
        ...process.env,
        [KIRA_RECALL_POLICY_ENV]: JSON.stringify({ subject: 'ambient', privacy: ['private'] }),
      },
    })

    await expect(request(base.socketPath, { op: KIRA_RECALL_TOOL })).resolves.toEqual({
      ok: false,
      state: 'REFUSED',
      reason: BROKER_REFUSE.KIRA_RECALL_UNCONFIGURED,
    })
  })

  it('refuses an oversized parent subject before spawning the broker', async () => {
    const base = fixture()
    await expect(spawnBroker({
      socketPath: base.socketPath,
      stateDir: base.stateDir,
      rootPublicKeyPem: base.rootPublicKeyPem,
      kiraRecallPolicy: { subject: 'x'.repeat(1025), privacy: ['local'] },
    })).rejects.toThrow(BROKER_REFUSE.KIRA_RECALL_POLICY_INVALID)
  })

  it('keeps corrupted backing undetermined instead of calling it empty', async () => {
    const base = fixture()
    const { staged } = settleRecord(base.stateDir, {
      subject: 'aumlok:subject:owner',
      privacy: 'local',
    })
    writeFileSync(join(base.stateDir, 'memory', 'keys', `${staged.recordId}.json`), '{"broken":true}\n')
    await launch(base, { policy: { subject: 'aumlok:subject:owner', privacy: ['local'] } })

    await expect(requestBrokerKiraRecall(
      base.socketPath,
      undefined,
      new AbortController().signal,
    )).resolves.toMatchObject({ citations: [], result: { status: 'undetermined' } })
  })
})
