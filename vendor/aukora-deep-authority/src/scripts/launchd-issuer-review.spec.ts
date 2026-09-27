/**
 * Real broker review, issuer carrier, signing, and retained KIRA state.
 * Only terminal decisions are SCRIPTED; this does not establish human attendance,
 * installed accounts, or the Web model/tool composition.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { renderApprovalArtifact } from '../aukora/approval/render.mjs'
import { readVerifiedChain } from '../aukora/aura/record.mjs'
import { BROKER_REFUSE, provisionBrokerIdentity, type BrokerReviewRequest, type BrokerServer } from '../aukora/broker/broker.mjs'
import { loadOrCreateLocalAumlokControl } from '../aukora/identity/local-control-store.mjs'
import { stageKiraMemoryRecord } from '../aukora/kira/stage.mjs'
import { createDeveloperAumlokAuthority } from '../aukora/supervisor/developer-aumlok.mjs'
import { BrokerProposalClient, requestBrokerKiraRecall } from '../packages/governed/memory-put/src/proposal-client.ts'
import { serveBrokerWithTerminalReview } from './launchd-broker-review.mjs'
import { connectIssuerReview, type IssuerReviewConnection } from './launchd-issuer-review.mjs'
import type { IssuerReviewRequest } from './launchd-review-transport.mjs'

const ISSUER = fileURLToPath(new URL('../aukora/issuer/issuer.mjs', import.meta.url))
const ACTIVATION = 'ab'.repeat(32)
const RENDERER = 'cd'.repeat(32)
const SERVER_ID = 'ef'.repeat(32)
const cleanups: Array<() => Promise<void>> = []
const signal = (): AbortSignal => AbortSignal.timeout(12_000)

afterEach(async () => {
  const results = await Promise.allSettled(cleanups.splice(0).reverse().map(close => close()))
  const failures = results.filter(result => result.status === 'rejected').map((result): unknown => result.reason)
  if (failures.length !== 0) throw new AggregateError(failures, 'issuer-review fixture cleanup failed')
})

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL') }, 5_000)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })
  child.kill('SIGTERM')
  await exited
}

async function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ir-')))
  const stateDir = join(root, 'state')
  const brokerSocket = join(root, 'b.sock')
  const issuerSocket = join(root, 'i.sock')
  const reviewSocket = join(root, 'r.sock')
  const carrierSocket = join(root, 'c.sock')
  const keyFile = join(root, 'issuer.pem')
  const control = loadOrCreateLocalAumlokControl(join(root, 'control'))
  const authority = createDeveloperAumlokAuthority(control, { audience: 'broker:issuer-review-test' })
  const terminalKey = generateKeyPairSync('ed25519')
  const identity = provisionBrokerIdentity(stateDir)
  writeFileSync(keyFile, control.record.ed25519PrivateKeyPem, { mode: 0o600, flag: 'wx' })
  const reviews: Readonly<BrokerReviewRequest>[] = []
  const issuerReviews: Readonly<IssuerReviewRequest>[] = []
  let issuerDecision: 'approved' | 'denied' = 'approved'
  let broker: BrokerServer | undefined
  const resources: { adapter?: IssuerReviewConnection; issuer?: ChildProcess } = {}
  let stderr = ''
  const client = new BrokerProposalClient({ socketPath: brokerSocket })
  cleanups.push(async () => {
    client.close()
    const stopped = await Promise.allSettled([
      resources.adapter?.close(), broker?.close(), resources.issuer === undefined ? undefined : stopChild(resources.issuer),
    ])
    const errors = stopped.filter(result => result.status === 'rejected').map((result): unknown => result.reason)
    if (errors.length !== 0) throw new AggregateError(errors, 'issuer-review resources did not close')
    rmSync(root, { recursive: true, force: true })
  })
  const startBroker = () => serveBrokerWithTerminalReview({
    broker: {
      socketPath: brokerSocket, stateDir, issuerSocket,
      rootPublicKeyPem: control.ed25519PublicKeyPem,
      activationDigest: ACTIVATION, rendererId: RENDERER,
      rootControlState: control.activeControl,
      selectSubjectAuthority: authority.selectSubjectAuthority,
      subjectAuthorityExpectation: { ...authority.subjectAuthorityExpectation, activationDigest: ACTIVATION },
      kiraRecallPolicy: { subject: control.subject, privacy: ['local'] },
    },
    review: {
      socketPath: reviewSocket, serverId: SERVER_ID,
      terminalPublicKeyPem: terminalKey.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    },
  })
  broker = await startBroker()
  const adapter = await connectIssuerReview({
    socketPath: reviewSocket, role: 'broker', serverId: SERVER_ID,
    terminalPrivateKey: terminalKey.privateKey, issuerSocketPath: carrierSocket,
    review: (request) => { reviews.push(request); return 'approved' },
    reviewIssuer: (request) => { issuerReviews.push(request); return issuerDecision },
  })
  resources.adapter = adapter
  const issuer = spawn(process.execPath, [ISSUER], {
    env: {
      AUKORA_ISSUER_SOCKET: issuerSocket,
      AUKORA_ISSUER_KEY_FILE: keyFile,
      AUKORA_EXPECTED_RECEIPT_KEY_ID: identity.receiptKeyId,
      AUKORA_ISSUER_APPROVAL_SOCKET: carrierSocket,
      AUKORA_ISSUER_APPROVAL_SOCKET_UID: String(process.getuid?.()),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  resources.issuer = issuer
  issuer.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
  const deadline = Date.now() + 5_000
  while (!existsSync(issuerSocket)) {
    if (issuer.exitCode !== null || issuer.signalCode !== null || Date.now() >= deadline) {
      throw new Error(`issuer did not listen: ${stderr}`)
    }
    await delay(10)
  }
  return {
    stateDir, reviews, issuerReviews, adapter,
    denyIssuer() { issuerDecision = 'denied' },
    approveIssuer() { issuerDecision = 'approved' },
    stage(content: string) {
      return stageKiraMemoryRecord({ subject: control.subject, kind: 'observation', source: [],
        content, links: [], privacy: 'local', createdAt: '2026-09-10T00:00:00Z' })
    },
    put(callId: string, args: { key: string; value: unknown }) { return client.settle(callId, args, signal()) },
    recall() { return requestBrokerKiraRecall(brokerSocket, undefined, signal()) },
    async restartBroker() {
      await broker!.close()
      await adapter.closed
      expect(existsSync(join(stateDir, '.broker-active.lock'))).toBe(false)
      broker = await startBroker()
    },
  }
}

function retainedBytes(stateDir: string) {
  const objects = join(stateDir, 'memory', 'objects')
  return {
    aura: readFileSync(join(stateDir, 'aura.jsonl')),
    sequence: readFileSync(join(stateDir, 'seq')),
    objects: Object.fromEntries(readdirSync(objects).sort().map(name => [name, readFileSync(join(objects, name))])),
  }
}

// The issuer and both review routes require non-root POSIX Unix sockets.
describe.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('installed issuer-review adapter in disposable same-UID assembly', () => {
  it('settles a staged KIRA record through both real approval transports and recalls its citation after broker restart', async () => {
    const test = await fixture()
    const staged = test.stage('Retain this source-backed note through the operator issuer adapter.')
    expect(await test.put('first-memory', staged.memoryPut)).toMatchObject({ ok: true, state: 'SETTLED' })
    expect(test.reviews).toHaveLength(1)
    expect(test.issuerReviews).toHaveLength(1)
    expect(test.issuerReviews[0]!.authorizationDigest).toBe(test.reviews[0]!.authorizationDigest)
    expect(test.issuerReviews[0]!.expiresAt).toBe(test.reviews[0]!.expiresAt)
    expect(test.issuerReviews[0]!.prompt).toBe(renderApprovalArtifact(test.reviews[0]!.artifact, test.issuerReviews[0]!.challenge))
    expect(test.adapter.error()).toBeUndefined()
    const recalled = await test.recall()
    expect(recalled.result).toEqual({ status: 'found', records: [staged.record] })
    expect(recalled.citations).toHaveLength(1)
    const citation = recalled.citations[0]!
    const chain = readVerifiedChain(join(test.stateDir, 'aura.jsonl'))
    expect(chain.ok).toBe(true)
    if (!chain.ok) throw new Error(chain.reason)
    expect(chain.entries).toHaveLength(1)
    expect(chain.entries[0]).toMatchObject({ verdict: 'settled', key: staged.recordId,
      contentSha256: citation.contentSha256, hash: citation.auraEntryHash, sequence: citation.auraSequence })
    expect(citation.verifiedHead).toBe(chain.lastChainHash)
    const bytes = readFileSync(join(test.stateDir, 'memory', 'objects', `${citation.contentSha256}.json`))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(citation.contentSha256)
    const before = retainedBytes(test.stateDir)
    await test.restartBroker()
    expect(await test.recall()).toEqual(recalled)
    expect(retainedBytes(test.stateDir)).toEqual(before)
    expect(test.reviews).toHaveLength(1)
    expect(test.issuerReviews).toHaveLength(1)
  }, 30_000)

  it('leaves retained memory and Aura unchanged when issuer review is denied, then accepts a fresh approval', async () => {
    const test = await fixture()
    const first = test.stage('Existing retained memory.')
    await test.put('retained-control', first.memoryPut)
    const before = retainedBytes(test.stateDir)
    const recalled = await test.recall()
    test.denyIssuer()
    const next = test.stage('Fresh memory requires its independent issuer decision.')
    await expect(test.put('issuer-denied', next.memoryPut)).rejects.toMatchObject({ state: 'REFUSED', message: BROKER_REFUSE.ISSUER_REFUSED })
    expect(test.reviews).toHaveLength(2)
    expect(test.issuerReviews).toHaveLength(2)
    expect(retainedBytes(test.stateDir)).toEqual(before)
    expect(await test.recall()).toEqual(recalled)
    test.approveIssuer()
    expect(await test.put('issuer-fresh-control', next.memoryPut)).toMatchObject({ ok: true, state: 'SETTLED' })
    expect(test.reviews).toHaveLength(3)
    expect(test.issuerReviews).toHaveLength(3)
    expect(test.adapter.error()).toBeUndefined()
    const after = await test.recall()
    expect(after.result.status).toBe('found')
    if (after.result.status !== 'found') throw new Error('fresh approved record was not recalled')
    expect(after.result.records.map(record => record.recordId)).toEqual([first.recordId, next.recordId].sort())
  }, 30_000)

  it('keeps recall available but refuses fresh writes after the operator adapter disconnects', async () => {
    const test = await fixture()
    const first = test.stage('Recall does not need an approval connection.')
    await test.put('disconnect-control', first.memoryPut)
    const before = retainedBytes(test.stateDir)
    const recalled = await test.recall()
    await test.adapter.close()
    await test.adapter.closed
    const next = test.stage('This write has no connected reviewer.')
    await expect(test.put('disconnected', next.memoryPut)).rejects.toMatchObject({
      state: 'REFUSED', message: BROKER_REFUSE.REVIEW_CHANNEL_UNAVAILABLE,
    })
    expect(await test.recall()).toEqual(recalled)
    expect(retainedBytes(test.stateDir)).toEqual(before)
    expect(test.reviews).toHaveLength(1)
    expect(test.issuerReviews).toHaveLength(1)
  }, 30_000)
})
