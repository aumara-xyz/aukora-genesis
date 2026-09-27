/**
 * Same-UID integration through the real broker and authenticated transport.
 * Terminal decisions and issuer signatures are scripted scratch fixtures,
 * not human approval, a production issuer terminal, or installed-UID evidence.
 */
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createConnection, createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { parseApprovalArtifact, approvalArtifactDigest } from '../aukora/approval/artifact.mjs'
import { readVerifiedChain } from '../aukora/aura/record.mjs'
import { BROKER_REFUSE, type BrokerServer, type BrokerReviewRequest } from '../aukora/broker/broker.mjs'
import { authorizationSignedMessageFromHex } from '../aukora/host-dsh/src/grant.mjs'
import { serveBrokerWithTerminalReview, type TerminalReviewedBrokerOptions } from './launchd-broker-review.mjs'
import { connectReviewTransport, type ReviewClientOptions, type ReviewTransportClient } from './launchd-review-transport.mjs'

const activationDigest = 'ab'.repeat(32)
const rendererId = 'cd'.repeat(32)
const serverId = 'ef'.repeat(32)
const memoryPut = { key: 'terminal-review-test', value: { scripted: true } }
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
})

function request(socketPath: string, frame: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ''
    let finished = false
    const finish = (error?: Error, reply?: Record<string, unknown>) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else resolve(reply!)
    }
    const timer = setTimeout(() => { finish(new Error('scripted broker request timed out')) }, 3_000)
    socket.once('connect', () => { socket.write(`${JSON.stringify({ id: randomUUID(), ...frame })}\n`) })
    socket.once('error', (error) => { finish(error) })
    socket.once('close', () => { finish(new Error('broker closed without a reply')) })
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const end = buffer.indexOf('\n')
      if (end < 0) return
      try { finish(undefined, JSON.parse(buffer.slice(0, end)) as Record<string, unknown>) }
      catch (error) { finish(error instanceof Error ? error : new Error('broker reply was not JSON')) }
    })
  })
}

function worldCounts(stateDir: string) {
  const entries = (path: string) => existsSync(path) ? readdirSync(path).length : 0
  const auraPath = join(stateDir, 'aura.jsonl')
  let count = 0
  if (existsSync(auraPath)) {
    const aura = readVerifiedChain(auraPath)
    if (!aura.ok) throw new Error(`scripted broker wrote unverified Aura: ${aura.reason}`)
    count = aura.count
  }
  return { aura: count, nonces: entries(join(stateDir, 'nonces')), objects: entries(join(stateDir, 'memory/objects')) }
}

async function fixture({ timeoutMs = 2_000, issuerApproves = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aukora-review-'))
  const rootKey = generateKeyPairSync('ed25519')
  const terminalKey = generateKeyPairSync('ed25519')
  const issuerSocket = join(root, 'issuer.sock')
  const issuerFrames: Array<Record<string, unknown>> = []
  const issuerPeers = new Set<Socket>()
  const issuer = createServer((socket) => {
    issuerPeers.add(socket)
    socket.once('close', () => { issuerPeers.delete(socket) })
    socket.on('error', () => { /* A cancelled broker request may close this scripted issuer peer. */ })
    let buffer = ''
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const end = buffer.indexOf('\n')
      if (end < 0) return
      socket.removeAllListeners('data')
      const frame = JSON.parse(buffer.slice(0, end)) as Record<string, unknown>
      issuerFrames.push(frame)
      const reply = frame.op === 'admit' ? { ok: true }
        : !issuerApproves ? { ok: false, reason: 'issuer:human-denied' }
          : { ok: true, digest: frame.digest,
            signature: sign(null, authorizationSignedMessageFromHex(frame.digest as string), rootKey.privateKey).toString('base64') }
      socket.end(`${JSON.stringify(reply)}\n`)
    })
  })
  let broker: BrokerServer | undefined = undefined
  const clients: ReviewTransportClient[] = []
  cleanups.push(async () => {
    for (const client of clients) await client.close()
    await broker?.close()
    for (const peer of issuerPeers) peer.destroy()
    if (issuer.listening) await new Promise<void>((resolve, reject) => {
      issuer.close((error) => { if (error) reject(error); else resolve() })
    })
    rmSync(root, { recursive: true, force: true })
  })
  await new Promise<void>((resolve, reject) => {
    issuer.once('error', reject)
    issuer.listen(issuerSocket, resolve)
  })
  const options: TerminalReviewedBrokerOptions = {
    broker: { socketPath: join(root, 'broker.sock'), stateDir: join(root, 'state'), issuerSocket,
      rootPublicKeyPem: rootKey.publicKey.export({ type: 'spki', format: 'pem' }).toString(), activationDigest, rendererId },
    review: { socketPath: join(root, 'review.sock'), terminalPublicKeyPem: terminalKey.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      serverId, timeoutMs },
  }
  broker = await serveBrokerWithTerminalReview(options)
  const opened = await request(options.broker.socketPath, { op: 'proposal.open' })
  expect(opened.ok).toBe(true)
  const proposalNamespace = opened.proposalNamespace
  return { options, broker, issuerFrames,
    async connect(review: ReviewClientOptions['review']) {
      const client = await connectReviewTransport({ socketPath: options.review.socketPath, role: 'broker', serverId,
        terminalPrivateKey: terminalKey.privateKey, timeoutMs: 2_000, review })
      clients.push(client)
      return client
    },
    async deposit() {
      const pending = await request(options.broker.socketPath, { op: 'proposal.deposit', proposalNamespace,
        callId: randomUUID(), toolName: 'memory.put', arguments: memoryPut })
      expect(pending).toMatchObject({ ok: true, state: 'PENDING' })
      return pending.proposalId
    },
    async outcome(proposalId: unknown) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const result = await request(options.broker.socketPath, { op: 'proposal.status', proposalNamespace, proposalId })
        if (result.state !== 'PENDING') return result
        await delay(10)
      }
      throw new Error('scripted proposal did not terminate')
    },
  }
}

describe('standalone broker with scripted authenticated terminal review', () => {
  it('refuses without a terminal before issuer admission, nonce reservation, or settlement', async () => {
    const test = await fixture()
    expect(await test.outcome(await test.deposit())).toMatchObject({ state: 'REFUSED', reason: BROKER_REFUSE.REVIEW_CHANNEL_UNAVAILABLE })
    expect(test.issuerFrames).toEqual([])
    expect(worldCounts(test.options.broker.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })

  it('preserves scripted terminal denial without contacting the issuer', async () => {
    const test = await fixture()
    await test.connect(() => 'denied')
    expect(await test.outcome(await test.deposit())).toMatchObject({ state: 'REFUSED', reason: BROKER_REFUSE.REVIEW_DENIED })
    expect(test.issuerFrames).toEqual([])
    expect(worldCounts(test.options.broker.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })

  it('settles only through the existing issuer and grant path after scripted terminal approval', async () => {
    const test = await fixture()
    const reviews: Readonly<BrokerReviewRequest>[] = []
    await test.connect((review) => { reviews.push(review); return 'approved' })
    expect(await test.outcome(await test.deposit())).toMatchObject({ ok: true, state: 'SETTLED' })
    expect(reviews).toHaveLength(1)
    const review = reviews[0]!
    const artifact = parseApprovalArtifact(review.artifact)
    expect(artifact.operationArguments).toEqual(memoryPut)
    expect(artifact).toMatchObject({ activationDigest, rendererId })
    expect(review.artifactDigest).toBe(approvalArtifactDigest(artifact))
    expect(test.issuerFrames).toEqual([
      { op: 'admit', digest: review.authorizationDigest },
      { op: 'authorize', digest: review.authorizationDigest, artifact: review.artifact, artifactDigest: review.artifactDigest },
    ])
    expect(worldCounts(test.options.broker.stateDir)).toEqual({ aura: 1, nonces: 1, objects: 1 })
    const object = readdirSync(join(test.options.broker.stateDir, 'memory/objects'))[0]!
    expect(JSON.parse(readFileSync(join(test.options.broker.stateDir, 'memory/objects', object), 'utf8'))).toEqual(memoryPut)
    expect((await request(test.options.broker.socketPath, { op: 'status' })).pid).toBe(process.pid)
  })

  it('does not turn terminal approval into issuer authorization', async () => {
    const test = await fixture({ issuerApproves: false })
    await test.connect(() => 'approved')
    expect(await test.outcome(await test.deposit())).toMatchObject({ state: 'REFUSED', reason: BROKER_REFUSE.ISSUER_REFUSED })
    expect(test.issuerFrames.map(frame => frame.op)).toEqual(['admit', 'authorize'])
    expect(worldCounts(test.options.broker.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })

  it('refuses a disconnected terminal and ignores its late scripted approval', async () => {
    const test = await fixture()
    const entered = Promise.withResolvers<AbortSignal>()
    const decision = Promise.withResolvers<'approved'>()
    const client = await test.connect((_review, signal) => { entered.resolve(signal); return decision.promise })
    const proposal = await test.deposit()
    const signal = await entered.promise
    await client.close()
    decision.resolve('approved')
    expect(signal.aborted).toBe(true)
    expect(await test.outcome(proposal)).toMatchObject({ state: 'REFUSED', reason: BROKER_REFUSE.REVIEW_CHANNEL_UNAVAILABLE })
    expect(test.issuerFrames).toEqual([])
    expect(worldCounts(test.options.broker.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })

  it('preserves the broker timeout refusal and cancels the scripted renderer', async () => {
    const test = await fixture({ timeoutMs: 200 })
    const entered = Promise.withResolvers<AbortSignal>()
    const client = await test.connect((_review, signal) => {
      entered.resolve(signal)
      return new Promise<'denied'>((resolve) => { signal.addEventListener('abort', () => { resolve('denied') }, { once: true }) })
    })
    const proposal = await test.deposit()
    const signal = await entered.promise
    expect(await test.outcome(proposal)).toMatchObject({ state: 'REFUSED', reason: BROKER_REFUSE.REVIEW_TIMED_OUT })
    await client.closed
    expect(signal.aborted).toBe(true)
    expect(test.issuerFrames).toEqual([])
    expect(worldCounts(test.options.broker.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })

  it('closes active review, both listeners and the broker state lease before returning', async () => {
    const test = await fixture()
    const entered = Promise.withResolvers<AbortSignal>()
    const client = await test.connect((_review, signal) => {
      entered.resolve(signal)
      return new Promise<'approved'>((resolve) => { signal.addEventListener('abort', () => { resolve('approved') }, { once: true }) })
    })
    await test.deposit()
    const signal = await entered.promise
    const closing = test.broker.close()
    expect(test.broker.close()).toBe(closing)
    await closing
    await client.closed
    expect(signal.aborted).toBe(true)
    expect(existsSync(test.options.broker.socketPath)).toBe(false)
    expect(existsSync(test.options.review.socketPath)).toBe(false)
    expect(existsSync(join(test.options.broker.stateDir, '.broker-active.lock'))).toBe(false)
    expect(test.issuerFrames).toEqual([])
    expect(worldCounts(test.options.broker.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })

  it('closes the newly bound review route when the broker refuses startup', async () => {
    const test = await fixture()
    const socketPath = join(test.options.broker.stateDir, 'failed-review.sock')
    await expect(serveBrokerWithTerminalReview({
      broker: { ...test.options.broker, rootPublicKeyPem: 'not a public key' },
      review: { ...test.options.review, socketPath },
    })).rejects.toThrow(BROKER_REFUSE.ROOT_PUBLIC_KEY_INVALID)
    expect(existsSync(socketPath)).toBe(false)
    expect((await request(test.options.broker.socketPath, { op: 'status' })).ok).toBe(true)
  })
})
