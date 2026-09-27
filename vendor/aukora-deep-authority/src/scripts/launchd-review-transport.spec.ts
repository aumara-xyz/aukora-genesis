import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { mkdtempSync, rmSync, lstatSync, readdirSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs'
import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApprovalArtifact, approvalArtifactDigest } from '../aukora/approval/artifact.mjs'
import { renderApprovalArtifact } from '../aukora/approval/render.mjs'
import { BROKER_REVIEW_REQUEST, BROKER_REVIEW_DECISION, BROKER_REVIEW_CANCEL, type BrokerReviewRequest } from '../aukora/broker/broker.mjs'
import {
  createReviewTransportServer, connectReviewTransport,
  type IssuerReviewInput, type IssuerReviewRequest, type ReviewClientOptions,
  type ReviewRouteOptions, type ReviewTransportClient, type ReviewTransportServer,
} from './launchd-review-transport.mjs'

type Frame = Record<string, unknown>
const prefix = 'aukora:review-transport:'
const keys = generateKeyPairSync('ed25519')
const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const directories: string[] = []
const servers: ReviewTransportServer[] = []
const clients: ReviewTransportClient[] = []
const sockets: Socket[] = []
const listeners: Server[] = []

/**
 * Read one numeric constant out of a module's source text.
 *
 * These constants are read rather than imported because `broker.mjs` is a root of the frozen
 * authority graph: adding an `export` to make its window importable moves
 * `FROZEN_VERIFIER_SHA256` and forces the installed custody pair to be restaged. The other
 * modules are read the same way so one mechanism pins every cross-file timing relationship.
 * A rename or reshape fails here by name — update the caller, do not export the constant.
 */
function constant(file: string, name: string): number {
  const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
  const found = new RegExp(`^(?:export )?const ${name} = ([\\d_]+)$`, 'mu').exec(source)?.[1]
  expect(found, `${name} not found in ${file} by the pattern this suite pins it with`).toBeDefined()
  return Number(found!.replaceAll('_', ''))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function route(overrides: Partial<ReviewRouteOptions> = {}): ReviewRouteOptions {
  const directory = mkdtempSync(join(tmpdir(), 'arv-'))
  directories.push(directory)
  return { socketPath: join(directory, 'r.sock'), role: 'broker', serverId: 'a'.repeat(64), ...overrides }
}

function request(): BrokerReviewRequest {
  const artifact = createApprovalArtifact({ operationArguments: { key: 'transport_test', value: 'synthetic unit-test value' },
    expiry: Math.floor(Date.now() / 1000) + 120, activationDigest: 'b'.repeat(64), occurrenceId: 'c'.repeat(32), rendererId: 'd'.repeat(64) })
  return { type: BROKER_REVIEW_REQUEST, reviewId: 'e'.repeat(32), proposalId: 'f'.repeat(32),
    artifact: { ...artifact }, artifactDigest: approvalArtifactDigest(artifact), operationDigest: artifact.operationDigest,
    authorizationDigest: '1'.repeat(64), expiresAt: artifact.expiry }
}

async function server(options: ReviewRouteOptions) {
  const result = await createReviewTransportServer({ ...options, terminalPublicKeyPem: publicPem })
  servers.push(result)
  return result
}

async function client(options: ReviewRouteOptions, review: ReviewClientOptions['review'], reviewIssuer?: ReviewClientOptions['reviewIssuer']) {
  const result = await connectReviewTransport({ ...options, terminalPrivateKey: keys.privateKey, review,
    ...(reviewIssuer === undefined ? {} : { reviewIssuer }) })
  clients.push(result)
  return result
}

function wire(socket: Socket) {
  sockets.push(socket)
  const frames: Frame[] = []
  const waiters: Array<{ resolve(value: Frame): void; reject(error: Error): void }> = []
  let buffer = ''
  let closed = false
  const done = new Promise<void>(resolve => socket.once('close', () => {
    closed = true
    for (const waiter of waiters.splice(0)) waiter.reject(new Error('wire closed'))
    resolve()
  }))
  socket.on('error', () => { /* Refusal tests observe socket closure. */ })
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8')
    let cut
    while ((cut = buffer.indexOf('\n')) !== -1) {
      const frame = JSON.parse(buffer.slice(0, cut)) as Frame
      buffer = buffer.slice(cut + 1)
      const waiter = waiters.shift()
      if (waiter) waiter.resolve(frame)
      else frames.push(frame)
    }
  })
  return { socket, done, send(frame: Frame) { socket.write(`${JSON.stringify(frame)}\n`) },
    read(): Promise<Frame> {
      const frame = frames.shift()
      if (frame) return Promise.resolve(frame)
      if (closed) return Promise.reject(new Error('wire closed'))
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }))
    } }
}

function signature(kind: string, hello: Frame, message: Frame | null = null, key: KeyObject = keys.privateKey) {
  return sign(null, Buffer.from(JSON.stringify([`${prefix}${kind}:v1`, hello, message])), key).toString('base64')
}

async function authenticated(options: ReviewRouteOptions) {
  const peer = wire(createConnection(options.socketPath))
  const hello = await peer.read()
  const proof = { type: `${prefix}auth:v1`, sessionId: hello.sessionId, signature: signature('auth', hello) }
  peer.send(proof)
  expect(await peer.read()).toEqual({ type: `${prefix}ready:v1`, sessionId: hello.sessionId })
  return { ...peer, hello, proof }
}

function decision(hello: Frame, input: BrokerReviewRequest, verdict = 'approved') {
  const message = { type: BROKER_REVIEW_DECISION, reviewId: input.reviewId, proposalId: input.proposalId,
    artifactDigest: input.artifactDigest, operationDigest: input.operationDigest,
    authorizationDigest: input.authorizationDigest, decision: verdict }
  return { type: `${prefix}message:v1`, sessionId: hello.sessionId, message,
    signature: signature('decision', hello, message) }
}

function issuerInput(approved: BrokerReviewRequest, kind: 'artifact' | 'digest' = 'artifact'): IssuerReviewInput {
  const challenge = '0123456789abcdef'
  return kind === 'artifact' ? { challenge, prompt: renderApprovalArtifact(approved.artifact, challenge) }
    : { authorizationDigest: approved.authorizationDigest, challenge,
      prompt: '  +- AUTHORIZE DIGEST -----------------------------------------\n'
        + '  | DIGEST APPROVAL - the operation behind this digest is NOT shown\n'
        + '  | and cannot be recovered from it. Confirm only if you know why\n'
        + '  | this digest was admitted.\n  | \n'
        + `  | authorizationDigest: ${approved.authorizationDigest}\n  +- approve? type "yes ${challenge}": ` }
}

function issuerFrame(approved: BrokerReviewRequest): IssuerReviewRequest {
  const input = issuerInput(approved)
  return { ...input, type: `${prefix}issuer-request:v1`, reviewId: '2'.repeat(32),
    authorizationDigest: approved.authorizationDigest, expiresAt: approved.expiresAt,
    promptDigest: createHash('sha256').update(input.prompt).digest('hex') }
}

function issuerDecision(hello: Frame, input: IssuerReviewRequest, changes: Frame = {}) {
  const message = { type: `${prefix}issuer-decision:v1`, reviewId: input.reviewId,
    authorizationDigest: input.authorizationDigest, challenge: input.challenge,
    promptDigest: input.promptDigest, expiresAt: input.expiresAt, decision: 'approved', ...changes }
  return { type: `${prefix}message:v1`, sessionId: hello.sessionId, message,
    signature: signature('decision', hello, message) }
}

async function approveWithPeer(daemon: ReviewTransportServer, peer: Awaited<ReturnType<typeof authenticated>>, input: BrokerReviewRequest) {
  const pending = daemon.requestReview(input, new AbortController().signal)
  await peer.read()
  peer.send(decision(peer.hello, input))
  expect(await pending).toBe('approved')
}

async function fakeDaemon(options: ReviewRouteOptions) {
  const connection = deferred<ReturnType<typeof wire>>()
  const listener = createServer((socket) => { connection.resolve(wire(socket)) })
  listeners.push(listener)
  await new Promise<void>((resolve, reject) => { listener.once('error', reject); listener.listen(options.socketPath, resolve) })
  return { connection: connection.promise }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(clients.splice(0).map(value => value.close()))
  for (const socket of sockets.splice(0)) socket.destroy()
  await Promise.all(servers.splice(0).map(value => value.close()))
  await Promise.all(listeners.splice(0).map(listener => new Promise<void>(resolve => listener.close(() => { resolve() }))))
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

// Synthetic decisions exercise transport only; they are not human-approval flight evidence.
describe('launchd review transport with synthetic renderer callbacks', () => {
  it.each(['approved', 'denied'] as const)('reviews a locally attached issuer as %s after one broker artifact', async (verdict) => {
    const options = route()
    const daemon = await server(options)
    const reviewIssuer = vi.fn(() => verdict)
    const terminal = await client(options, () => 'approved', reviewIssuer)
    const approved = request()
    const signal = new AbortController().signal
    await expect(terminal.requestIssuerReview(issuerInput(approved), signal)).rejects.toThrow('issuer-binding-unavailable')
    expect(reviewIssuer).not.toHaveBeenCalled()
    expect(await daemon.requestReview(approved, signal)).toBe('approved')
    expect(await terminal.requestIssuerReview(issuerInput(approved), signal)).toBe(verdict)
    expect(reviewIssuer).toHaveBeenCalledOnce()
    expect(reviewIssuer.mock.calls[0]).toEqual([
      expect.objectContaining({ authorizationDigest: approved.authorizationDigest, expiresAt: approved.expiresAt }),
      expect.any(AbortSignal),
    ])
    await expect(terminal.requestIssuerReview(issuerInput(approved), signal)).rejects.toThrow('issuer-binding-unavailable')
    // The server's remaining binding cannot be used remotely after local consumption.
    await expect(daemon.requestIssuerReview(issuerInput(approved), signal)).rejects.toThrow('channel-unavailable')
    expect(reviewIssuer).toHaveBeenCalledOnce()
  })

  it.each(['cancel', 'disconnect', 'expiry'] as const)('closes local issuer review on %s and discards a late answer', async (reason) => {
    const options = route({ timeoutMs: reason === 'expiry' ? 150 : 5_000 })
    const daemon = await server(options)
    const entered = deferred<AbortSignal>()
    const answer = deferred<'approved'>()
    const terminal = await client(options, () => 'approved', (_request, signal) => {
      entered.resolve(signal)
      return answer.promise
    })
    const approved = request()
    const abort = new AbortController()
    expect(await daemon.requestReview(approved, abort.signal)).toBe('approved')
    const pending = terminal.requestIssuerReview(issuerInput(approved), abort.signal)
    const refused = expect(pending).rejects.toThrow(reason === 'cancel' ? 'cancelled' : reason === 'expiry' ? 'timed-out' : 'channel-unavailable')
    const issuerSignal = await entered.promise
    if (reason === 'cancel') abort.abort()
    if (reason === 'disconnect') await terminal.close()
    await refused
    expect(issuerSignal.aborted).toBe(true)
    answer.resolve('approved')
    await terminal.closed
    await expect(terminal.requestIssuerReview(issuerInput(approved), new AbortController().signal)).rejects.toThrow('channel-unavailable')
  })

  it('does not share local issuer approvals with a reconnected terminal', async () => {
    const options = route()
    const daemon = await server(options)
    const first = await client(options, () => 'approved', () => 'approved')
    const approved = request()
    const signal = new AbortController().signal
    expect(await daemon.requestReview(approved, signal)).toBe('approved')
    await first.close()
    const reviewIssuer = vi.fn(() => 'approved' as const)
    const second = await client(options, () => 'approved', reviewIssuer)
    await expect(second.requestIssuerReview(issuerInput(approved), signal)).rejects.toThrow('issuer-binding-unavailable')
    expect(reviewIssuer).not.toHaveBeenCalled()
    expect(await daemon.requestReview(approved, signal)).toBe('approved')
    expect(await second.requestIssuerReview(issuerInput(approved), signal)).toBe('approved')
  })

  it('rechecks the local issuer deadline before accepting an answer even before its timer runs', async () => {
    const options = route({ timeoutMs: 5_000 })
    const daemon = await server(options)
    const terminal = await client(options, () => 'approved', () => {
      const late = Date.now() + 6_000
      vi.spyOn(Date, 'now').mockReturnValue(late)
      return 'approved'
    })
    const approved = request()
    const signal = new AbortController().signal
    expect(await daemon.requestReview(approved, signal)).toBe('approved')
    await expect(terminal.requestIssuerReview(issuerInput(approved), signal)).rejects.toThrow('timed-out')
    await terminal.closed
  })

  it.each(['approved', 'denied'] as const)('transports %s without altering the artifact or inventing authority', async (verdict) => {
    const options = route()
    const daemon = await server(options)
    const review = vi.fn((_request: Readonly<BrokerReviewRequest>) => verdict)
    await client(options, review)
    const input = request()
    expect(await daemon.requestReview(input, new AbortController().signal)).toBe(verdict)
    expect(review).toHaveBeenCalledWith(input, expect.any(AbortSignal))
    expect(Object.isFrozen(review.mock.calls[0]?.[0])).toBe(true)
    expect(lstatSync(options.socketPath).mode & 0o777).toBe(0o600)
  })

  it('refuses without an authenticated terminal and preserves an occupied path', async () => {
    const options = route()
    const daemon = await server(options)
    await expect(daemon.requestReview(request(), new AbortController().signal)).rejects.toThrow('channel-unavailable')
    const occupied = route()
    writeFileSync(occupied.socketPath, 'do not overwrite')
    await expect(server(occupied)).rejects.toThrow('socket-path-occupied')
    expect(readFileSync(occupied.socketPath, 'utf8')).toBe('do not overwrite')
    expect(readdirSync(dirname(occupied.socketPath))).toEqual(['r.sock'])
  })

  it.each([
    ['an overlong public route', (directory: string) => join(directory, `${'r'.repeat(120)}.sock`)],
    // A public route that fits while its directory cannot hold the staging
    // name: the staging bound is the only check that can refuse this, so the
    // case is built to the exact widths that reach it.
    ['a public route whose directory cannot hold the staging name', (directory: string) => {
      const target = join(directory, 'd'.repeat(Math.max(1, 95 - directory.length - 1)), 'r.sock')
      expect(Buffer.byteLength(dirname(target), 'utf8')).toBe(95)
      expect(Buffer.byteLength(target, 'utf8')).toBeLessThanOrEqual(104)
      return target
    }],
  ])('refuses %s before binding, leaving no node behind', async (_label, build) => {
    // Publishing by link removes bind()'s own length refusal: link() accepts a
    // path longer than sun_path, so an unvalidated public route would publish a
    // node that no client can address while startup reported success.
    const options = route()
    const directory = dirname(options.socketPath)
    await expect(server({ ...options, socketPath: build(directory) })).rejects.toThrow('socket-path-too-long')
    expect(readdirSync(directory)).toEqual([])
  })

  it.each([[104, 'connect-ok'], [105, 'refused']])(
    'treats a %i-byte public route as the measured boundary', async (bytes, outcome) => {
      // 104 connects and 105 does not on the target platform, so the bound is a
      // measured limit rather than a remembered constant.
      const options = route()
      const directory = dirname(options.socketPath)
      const socketPath = join(directory, 'x'.repeat(bytes - directory.length - 1))
      expect(Buffer.byteLength(socketPath, 'utf8')).toBe(bytes)
      if (outcome === 'refused') {
        await expect(server({ ...options, socketPath })).rejects.toThrow('socket-path-too-long')
        return
      }
      const daemon = await server({ ...options, socketPath })
      await client({ ...options, socketPath }, () => 'approved')
      expect(await daemon.requestReview(request(), new AbortController().signal)).toBe('approved')
    })

  it('removes only its own published route when closing', async () => {
    // Publication is by link and teardown is by path. A close that unlinked by
    // name alone would delete whatever occupies the path, including a route a
    // replacement server published there after this one stopped listening.
    const options = route()
    const daemon = await server(options)
    unlinkSync(options.socketPath)
    writeFileSync(options.socketPath, 'a replacement owner')
    await daemon.close()
    expect(readFileSync(options.socketPath, 'utf8')).toBe('a replacement owner')
    unlinkSync(options.socketPath)
  })

  it('accepts a short public route as the working control for that refusal', async () => {
    const options = route()
    const daemon = await server(options)
    await client(options, () => 'approved')
    expect(lstatSync(options.socketPath).mode & 0o777).toBe(0o600)
    expect(await daemon.requestReview(request(), new AbortController().signal)).toBe('approved')
  })

  it('publishes the listener already restricted, leaving no staging residue', async () => {
    // The listener binds to a private staging name, is restricted there, and
    // reaches its published path by link, so no moment exists in which the
    // published path is connectable at a wider mode.
    const options = route()
    const daemon = await server(options)
    expect(lstatSync(options.socketPath).mode & 0o777).toBe(0o600)
    expect(readdirSync(dirname(options.socketPath))).toEqual(['r.sock'])
    // Publication binds a staging name, so closing must remove the published
    // link explicitly; a surviving link would look like a live route and would
    // refuse the next publication as occupied.
    await daemon.close()
    expect(readdirSync(dirname(options.socketPath))).toEqual([])
  })

  it('rejects a different terminal key without rendering', async () => {
    const options = route()
    await server(options)
    const review = vi.fn(() => 'approved' as const)
    await expect(connectReviewTransport({ ...options, terminalPrivateKey: generateKeyPairSync('ed25519').privateKey, review })).rejects.toThrow('channel-unavailable')
    expect(review).not.toHaveBeenCalled()
  })

  it.each(['role', 'serverId', 'socketPath'])('binds authentication to %s', async (field) => {
    const options = route()
    await server(options)
    const peer = wire(createConnection(options.socketPath))
    const hello = await peer.read()
    peer.send({ type: `${prefix}auth:v1`, sessionId: hello.sessionId,
      signature: signature('auth', { ...hello, [field]: 'another identity' }) })
    await peer.done
  })

  it('rejects authentication replay on a fresh connection', async () => {
    const options = route()
    await server(options)
    const first = await authenticated(options)
    first.socket.destroy()
    await first.done
    const second = wire(createConnection(options.socketPath))
    const hello = await second.read()
    expect(hello.sessionId).not.toBe(first.hello.sessionId)
    second.send({ ...first.proof, sessionId: hello.sessionId })
    await second.done
  })

  it('allows only one terminal and one active prompt', async () => {
    const options = route()
    const daemon = await server(options)
    const entered = deferred<boolean>()
    const answer = deferred<'approved'>()
    await client(options, () => { entered.resolve(true); return answer.promise })
    await expect(client(options, () => 'approved')).rejects.toThrow('channel-unavailable')
    const first = daemon.requestReview(request(), new AbortController().signal)
    await entered.promise
    await expect(daemon.requestReview({ ...request(), reviewId: '2'.repeat(32) }, new AbortController().signal)).rejects.toThrow('review-unavailable')
    answer.resolve('approved')
    await expect(first).resolves.toBe('approved')
    await expect(daemon.requestReview(request(), new AbortController().signal)).rejects.toThrow('review-unavailable')
    await expect(daemon.requestReview({ ...request(), reviewId: '2'.repeat(32) }, new AbortController().signal)).resolves.toBe('approved')
  })

  it.each(['artifactDigest', 'operationDigest', 'authorizationDigest', 'reviewId', 'proposalId'])(
    'refuses a signed but mismatched %s', async (field) => {
      const options = route()
      const daemon = await server(options)
      const peer = await authenticated(options)
      const input = request()
      const pending = expect(daemon.requestReview(input, new AbortController().signal)).rejects.toThrow('channel-unavailable')
      await peer.read()
      peer.send(decision(peer.hello, { ...input, [field]: '0'.repeat(field.endsWith('Id') ? 32 : 64) }))
      await pending
    })

  it.each(['extra', 'signature', 'session', 'outcome'])('rejects a malformed decision %s', async (fault) => {
    const options = route()
    const daemon = await server(options)
    const peer = await authenticated(options)
    const input = request()
    const pending = expect(daemon.requestReview(input, new AbortController().signal)).rejects.toThrow('channel-unavailable')
    await peer.read()
    const frame: Frame = decision(peer.hello, input, fault === 'outcome' ? 'yes' : 'approved')
    if (fault === 'extra') frame.extra = true
    if (fault === 'signature') frame.signature = Buffer.alloc(64).toString('base64')
    if (fault === 'session') frame.sessionId = '0'.repeat(64)
    peer.send(frame)
    await pending
  })

  it('rejects an old signed decision in another authenticated session', async () => {
    const options = route()
    const daemon = await server(options)
    const first = await authenticated(options)
    const input = request()
    const pending = daemon.requestReview(input, new AbortController().signal)
    await first.read()
    const old = decision(first.hello, input)
    first.send(old)
    await pending
    first.socket.destroy()
    await first.done
    const second = await authenticated(options)
    const result = expect(daemon.requestReview(input, new AbortController().signal)).rejects.toThrow('channel-unavailable')
    await second.read()
    second.send({ ...old, sessionId: second.hello.sessionId })
    await result
  })

  it.each(['abort', 'close'] as const)('invalidates pending answers on %s', async (kind) => {
    const options = route()
    const daemon = await server(options)
    const observed = deferred<AbortSignal>()
    const answer = deferred<'approved'>()
    const terminal = await client(options, (_input, signal) => { observed.resolve(signal); return answer.promise })
    const controller = new AbortController()
    const pending = expect(daemon.requestReview(request(), controller.signal)).rejects.toThrow(kind === 'abort' ? 'cancelled' : 'channel-unavailable')
    const signal = await observed.promise
    if (kind === 'abort') controller.abort()
    else await daemon.close()
    await pending
    await terminal.closed
    expect(signal.aborted).toBe(true)
    answer.resolve('approved')
  })

  it('bounds silent authentication and unanswered review lifetimes', async () => {
    const options = route({ timeoutMs: 50 })
    const daemon = await server(options)
    const silent = wire(createConnection(options.socketPath))
    await silent.read()
    await silent.done
    const peer = await authenticated(options)
    const pending = expect(daemon.requestReview(request(), new AbortController().signal)).rejects.toThrow('timed-out')
    await peer.read()
    const cancel = await peer.read()
    expect(cancel.message).toMatchObject({ type: BROKER_REVIEW_CANCEL })
    await pending
    peer.socket.end()
  })

  it.each(['extra', 'digest', 'expired'] as const)('rejects %s review input before rendering', async (kind) => {
    const options = route()
    const daemon = await server(options)
    const review = vi.fn(() => 'approved' as const)
    await client(options, review)
    const input = request()
    const malformed = kind === 'extra' ? { ...input, extra: true }
      : kind === 'digest' ? { ...input, artifactDigest: '0'.repeat(64) } : { ...input, expiresAt: 1 }
    await expect(daemon.requestReview(malformed, new AbortController().signal)).rejects.toThrow('request-invalid')
    expect(review).not.toHaveBeenCalled()
  })

  it.each(['oversize', 'json', 'utf8', 'extra'] as const)('closes on %s wire framing', async (kind) => {
    const options = route()
    await server(options)
    const peer = wire(createConnection(options.socketPath))
    const hello = await peer.read()
    if (kind === 'oversize') peer.socket.write('x'.repeat(128 * 1024 + 1))
    else if (kind === 'json') peer.socket.write('{no}\n')
    else if (kind === 'utf8') peer.socket.write(Buffer.from([0xff, 10]))
    else peer.send({ type: `${prefix}auth:v1`, sessionId: hello.sessionId, signature: signature('auth', hello), extra: true })
    await peer.done
  })

  it('rejects a daemon hello naming another configured role before rendering', async () => {
    const options = route()
    const fake = await fakeDaemon(options)
    const review = vi.fn(() => 'approved' as const)
    const pending = expect(client(options, review)).rejects.toThrow('channel-unavailable')
    const peer = await fake.connection
    peer.send({ type: `${prefix}hello:v1`, sessionId: '0'.repeat(64), role: 'issuer', serverId: options.serverId, socketPath: options.socketPath })
    await pending
    expect(review).not.toHaveBeenCalled()
  })

  it('aborts a renderer when a daemon sends a second concurrent prompt', async () => {
    const options = route()
    const fake = await fakeDaemon(options)
    const observed = deferred<AbortSignal>()
    const pending = client(options, (_request, signal) => { observed.resolve(signal); return new Promise(() => {}) })
    const peer = await fake.connection
    const hello = { type: `${prefix}hello:v1`, sessionId: '0'.repeat(64), role: options.role, serverId: options.serverId, socketPath: options.socketPath }
    peer.send(hello)
    await peer.read()
    peer.send({ type: `${prefix}ready:v1`, sessionId: hello.sessionId })
    const terminal = await pending
    peer.send({ type: `${prefix}message:v1`, sessionId: hello.sessionId, message: request() })
    const signal = await observed.promise
    peer.send({ type: `${prefix}message:v1`, sessionId: hello.sessionId, message: { ...request(), reviewId: '2'.repeat(32) } })
    await terminal.closed
    expect(signal.aborted).toBe(true)
  })

  it('bounds the artifact window by the broker wait it must finish inside', async () => {
    const brokerWait = constant('../aukora/broker/broker.mjs', 'BROKER_REVIEW_TIMEOUT_MS')
    expect(brokerWait).not.toBeNaN()
    const ceiling = brokerWait - 5_000
    const options = route()
    for (const malformed of [{ reviewTimeoutMs: ceiling + 1 }, { timeoutMs: 1_000, reviewTimeoutMs: 999 },
      { reviewTimeoutMs: 1.5 }, { reviewTimeoutMs: 0 }]) {
      await expect(server({ ...options, ...malformed })).rejects.toThrow('configuration-invalid')
      await expect(connectReviewTransport({ ...options, ...malformed, terminalPrivateKey: keys.privateKey,
        review: () => 'approved' })).rejects.toThrow('configuration-invalid')
    }
    await server({ ...options, timeoutMs: 1_000, reviewTimeoutMs: ceiling })
  })

  it('keeps both attended windows inside the guest operation budget', async () => {
    const guestCeiling = constant('../aukora/supervisor/developer-launch.mjs', 'GUEST_OPERATION_CEILING_MS')
    const artifact = constant('../aukora/supervisor/developer-review.mjs', 'ARTIFACT_REVIEW_TIMEOUT_MS')
    const issuer = constant('../aukora/supervisor/developer-review.mjs', 'REVIEW_TIMEOUT_MS')
    for (const value of [guestCeiling, artifact, issuer]) expect(value).not.toBeNaN()
    // Both human windows plus the broker, issuer and guest work between them must finish
    // before the launcher terminates the guest and returns INDETERMINATE. Ten seconds of
    // machine overhead is the least this assembly has been observed to need.
    expect(artifact + issuer + 10_000).toBeLessThanOrEqual(guestCeiling)
  })

  it('spends the wider window on the artifact stage and the tighter one on the issuer stage', async () => {
    const options = route({ timeoutMs: 120, reviewTimeoutMs: 900 })
    const daemon = await server(options)
    await client(options, () => new Promise<'approved'>(() => {}))
    const started = Date.now()
    await expect(daemon.requestReview(request(), new AbortController().signal)).rejects.toThrow('timed-out')
    expect(Date.now() - started).toBeGreaterThan(500)
  })

  it('holds the issuer stage to the tighter window while the artifact window stays wide', async () => {
    const options = route({ timeoutMs: 120, reviewTimeoutMs: 900 })
    const daemon = await server(options)
    await client(options, () => 'approved', () => new Promise<'approved'>(() => {}))
    const approved = request()
    expect(await daemon.requestReview(approved, new AbortController().signal)).toBe('approved')
    const started = Date.now()
    await expect(daemon.requestIssuerReview(issuerInput(approved), new AbortController().signal)).rejects.toThrow('timed-out')
    expect(Date.now() - started).toBeLessThan(500)
  })

  it('rejects non-Unix routes, unbounded timing and noncanonical public keys', async () => {
    const options = route()
    for (const malformed of [{ socketPath: 'tcp://localhost:8080' }, { timeoutMs: 25_001 }, { timeoutMs: 0 }, { role: 'Owner Session' }]) {
      await expect(server({ ...options, ...malformed })).rejects.toThrow('configuration-invalid')
    }
    await expect(createReviewTransportServer({ ...options, terminalPublicKeyPem: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() })).rejects.toThrow('public-key-invalid')
  })

  it.each(['artifact', 'digest'] as const)('requires two independent approvals for an issuer %s prompt', async (kind) => {
    const options = route()
    const daemon = await server(options)
    const reviewIssuer = vi.fn((_request: Readonly<IssuerReviewRequest>) => 'approved' as const)
    await client(options, () => 'approved', reviewIssuer)
    const approved = request()
    expect(await daemon.requestReview(approved, new AbortController().signal)).toBe('approved')
    const input = issuerInput(approved, kind)
    expect(await daemon.requestIssuerReview(input, new AbortController().signal)).toBe('approved')
    const received = reviewIssuer.mock.calls[0]
    expect(received).toEqual([expect.objectContaining({ ...input, authorizationDigest: approved.authorizationDigest,
      expiresAt: approved.expiresAt, promptDigest: createHash('sha256').update(input.prompt).digest('hex') }), expect.any(AbortSignal)])
    expect(Object.isFrozen(received?.[0])).toBe(true)
    await expect(daemon.requestIssuerReview(input, new AbortController().signal)).rejects.toThrow('issuer-binding-unavailable')
  })

  it('preserves an explicit issuer denial after parent approval', async () => {
    const options = route()
    const daemon = await server(options)
    await client(options, () => 'approved', () => 'denied')
    const approved = request()
    await daemon.requestReview(approved, new AbortController().signal)
    expect(await daemon.requestIssuerReview(issuerInput(approved), new AbortController().signal)).toBe('denied')
  })

  it('refuses issuer review without a parent approval, including after parent denial', async () => {
    const options = route()
    const daemon = await server(options)
    const reviewIssuer = vi.fn(() => 'approved' as const)
    await client(options, () => 'denied', reviewIssuer)
    const input = request()
    await expect(daemon.requestIssuerReview(issuerInput(input), new AbortController().signal)).rejects.toThrow('issuer-binding-unavailable')
    await daemon.requestReview(input, new AbortController().signal)
    await expect(daemon.requestIssuerReview(issuerInput(input), new AbortController().signal)).rejects.toThrow('issuer-binding-unavailable')
    expect(reviewIssuer).not.toHaveBeenCalled()
  })

  it('does not inherit a prior connection approval after reconnecting', async () => {
    const options = route()
    const daemon = await server(options)
    const first = await client(options, () => 'approved', () => 'approved')
    const input = request()
    await daemon.requestReview(input, new AbortController().signal)
    await first.close()
    const reviewIssuer = vi.fn(() => 'approved' as const)
    await client(options, () => 'approved', reviewIssuer)
    await expect(daemon.requestIssuerReview(issuerInput(input), new AbortController().signal)).rejects.toThrow('issuer-binding-unavailable')
    expect(reviewIssuer).not.toHaveBeenCalled()
    await daemon.requestReview(input, new AbortController().signal)
    expect(await daemon.requestIssuerReview(issuerInput(input), new AbortController().signal)).toBe('approved')
  })

  it('matches complete artifact bytes instead of selecting the last approved operation', async () => {
    const options = route()
    const daemon = await server(options)
    await client(options, () => 'approved', () => 'approved')
    const first = request()
    const second = { ...first, reviewId: '3'.repeat(32), authorizationDigest: '4'.repeat(64) }
    await daemon.requestReview(first, new AbortController().signal)
    await daemon.requestReview(second, new AbortController().signal)
    await expect(daemon.requestIssuerReview(issuerInput(first), new AbortController().signal)).rejects.toThrow('issuer-binding-unavailable')
    expect(await daemon.requestIssuerReview({ ...issuerInput(first), authorizationDigest: first.authorizationDigest }, new AbortController().signal)).toBe('approved')
    expect(await daemon.requestIssuerReview(issuerInput(second), new AbortController().signal)).toBe('approved')
  })

  it.each(['digest', 'challenge', 'controls', 'oversize', 'warning'] as const)('refuses an altered issuer prompt %s before rendering', async (fault) => {
    const options = route()
    const daemon = await server(options)
    const reviewIssuer = vi.fn(() => 'approved' as const)
    await client(options, () => 'approved', reviewIssuer)
    const approved = request()
    await daemon.requestReview(approved, new AbortController().signal)
    const input = issuerInput(approved, 'digest')
    if (fault === 'digest') input.authorizationDigest = '0'.repeat(64)
    if (fault === 'challenge') input.challenge = 'f'.repeat(16)
    if (fault === 'controls') input.prompt += '\u001b[2J'
    if (fault === 'oversize') input.prompt += 'x'.repeat(32 * 1024)
    if (fault === 'warning') input.prompt = input.prompt.replace('NOT shown', 'shown')
    await expect(daemon.requestIssuerReview(input, new AbortController().signal)).rejects.toThrow('issuer-binding-unavailable')
    expect(reviewIssuer).not.toHaveBeenCalled()
  })

  it('refuses an issuer prompt after its original artifact expires', async () => {
    const options = route()
    const daemon = await server(options)
    await client(options, () => 'approved', () => 'approved')
    const input = request()
    await daemon.requestReview(input, new AbortController().signal)
    vi.spyOn(Date, 'now').mockReturnValue(input.expiresAt * 1000)
    await expect(daemon.requestIssuerReview(issuerInput(input), new AbortController().signal)).rejects.toThrow('issuer-binding-unavailable')
  })

  it.each(['reviewId', 'authorizationDigest', 'challenge', 'promptDigest', 'expiresAt', 'type'] as const)('rejects a signed issuer reply with the wrong %s', async (field) => {
    const options = route()
    const daemon = await server(options)
    const peer = await authenticated(options)
    const input = request()
    await approveWithPeer(daemon, peer, input)
    const pending = expect(daemon.requestIssuerReview(issuerInput(input), new AbortController().signal)).rejects.toThrow('channel-unavailable')
    const frame = await peer.read()
    const sent = frame.message as IssuerReviewRequest
    const replacement = field === 'expiresAt' ? sent.expiresAt + 1
      : field === 'type' ? BROKER_REVIEW_DECISION : field === 'reviewId' ? '0'.repeat(32)
        : field === 'challenge' ? '0'.repeat(16) : '0'.repeat(64)
    peer.send(issuerDecision(peer.hello, sent, { [field]: replacement }))
    await pending
  })

  it('rejects an old signed issuer decision in a new authenticated session', async () => {
    const options = route()
    const daemon = await server(options)
    const first = await authenticated(options)
    const input = request()
    await approveWithPeer(daemon, first, input)
    const firstPending = daemon.requestIssuerReview(issuerInput(input), new AbortController().signal)
    const firstFrame = await first.read()
    const old = issuerDecision(first.hello, firstFrame.message as IssuerReviewRequest)
    first.send(old)
    expect(await firstPending).toBe('approved')
    first.socket.destroy()
    await first.done
    const second = await authenticated(options)
    await approveWithPeer(daemon, second, input)
    const secondPending = expect(daemon.requestIssuerReview(issuerInput(input), new AbortController().signal)).rejects.toThrow('channel-unavailable')
    const secondFrame = await second.read()
    const secondRequest = secondFrame.message as IssuerReviewRequest
    second.send({ ...old, sessionId: second.hello.sessionId, message: { ...old.message, reviewId: secondRequest.reviewId } })
    await secondPending
  })

  it('rejects a signed issuer decision after the original artifact expires during review', async () => {
    const options = route()
    const daemon = await server(options)
    const peer = await authenticated(options)
    const input = request()
    await approveWithPeer(daemon, peer, input)
    const pending = expect(daemon.requestIssuerReview(issuerInput(input), new AbortController().signal)).rejects.toThrow('channel-unavailable')
    const frame = await peer.read()
    vi.spyOn(Date, 'now').mockReturnValue(input.expiresAt * 1000)
    peer.send(issuerDecision(peer.hello, frame.message as IssuerReviewRequest))
    await pending
  })

  it.each(['promptDigest', 'challenge', 'authorizationDigest', 'expiresAt', 'type'] as const)('closes before rendering a malformed issuer request %s', async (field) => {
    const options = route()
    const fake = await fakeDaemon(options)
    const reviewIssuer = vi.fn(() => 'approved' as const)
    const pending = client(options, () => 'approved', reviewIssuer)
    const peer = await fake.connection
    const hello = { type: `${prefix}hello:v1`, sessionId: '0'.repeat(64), role: options.role, serverId: options.serverId, socketPath: options.socketPath }
    peer.send(hello)
    await peer.read()
    peer.send({ type: `${prefix}ready:v1`, sessionId: hello.sessionId })
    const terminal = await pending
    const input = request()
    peer.send({ type: `${prefix}message:v1`, sessionId: hello.sessionId, message: input })
    await peer.read()
    const issuer = issuerFrame(input)
    const replacement = field === 'expiresAt' ? issuer.expiresAt + 1
      : field === 'type' ? BROKER_REVIEW_REQUEST : field === 'challenge' ? '0'.repeat(16) : '0'.repeat(64)
    peer.send({ type: `${prefix}message:v1`, sessionId: hello.sessionId, message: { ...issuer, [field]: replacement } })
    await terminal.closed
    expect(reviewIssuer).not.toHaveBeenCalled()
  })

  it('closes an issuer request when the client has no issuer renderer', async () => {
    const options = route()
    const daemon = await server(options)
    const terminal = await client(options, () => 'approved')
    const input = request()
    await daemon.requestReview(input, new AbortController().signal)
    await expect(daemon.requestIssuerReview(issuerInput(input), new AbortController().signal)).rejects.toThrow('channel-unavailable')
    await terminal.closed
  })

  it.each(['abort', 'disconnect', 'timeout'] as const)('invalidates late issuer answers after %s while permitting future connections', async (kind) => {
    const options = route({ timeoutMs: kind === 'timeout' ? 100 : 25_000 })
    const daemon = await server(options)
    const observed = deferred<AbortSignal>()
    const answer = deferred<'approved'>()
    const terminal = await client(options, () => 'approved', (_input, signal) => { observed.resolve(signal); return answer.promise })
    const input = request()
    await daemon.requestReview(input, new AbortController().signal)
    const controller = new AbortController()
    const pending = expect(daemon.requestIssuerReview(issuerInput(input), controller.signal)).rejects.toThrow(
      kind === 'abort' ? 'cancelled' : kind === 'timeout' ? /timed-out|channel-unavailable/u : 'channel-unavailable')
    const signal = await observed.promise
    await expect(daemon.requestReview({ ...input, reviewId: '3'.repeat(32) }, new AbortController().signal)).rejects.toThrow('review-unavailable')
    if (kind === 'abort') controller.abort()
    if (kind === 'disconnect') await terminal.close()
    await pending
    await terminal.closed
    expect(signal.aborted).toBe(true)
    answer.resolve('approved')
    await client(options, () => 'approved', () => 'approved')
    await expect(daemon.requestIssuerReview(issuerInput(input), new AbortController().signal)).rejects.toThrow('issuer-binding-unavailable')
    await daemon.requestReview(input, new AbortController().signal)
    expect(await daemon.requestIssuerReview(issuerInput(input), new AbortController().signal)).toBe('approved')
  })
})

// Overnight KIRA hardening (transport lane): stage binding and lifecycle.
// Each refusal below carries its working positive control in the same test;
// the attack input differs from the control by one protocol variable, so a
// green refusal with a green control is an A/B pair, not a vacuous reject.
describe('overnight transport hardening: stage binding and lifecycle', () => {
  it('refuses a broker answer for a pending issuer request, then approves the correct issuer answer', async () => {
    const options = route()
    const daemon = await server(options)
    // Positive control: a complete correct two-stage approval on one connection.
    const first = await authenticated(options)
    const input = request()
    const parent = daemon.requestReview(input, new AbortController().signal)
    await first.read()
    first.send(decision(first.hello, input))
    await expect(parent).resolves.toBe('approved')
    const issuer = daemon.requestIssuerReview(issuerInput(input), new AbortController().signal)
    const issuerFrame = await first.read()
    first.send(issuerDecision(first.hello, issuerFrame.message as IssuerReviewRequest))
    await expect(issuer).resolves.toBe('approved')
    first.socket.destroy()
    await first.done
    // Attack: a validly signed broker-typed answer for a pending issuer request.
    const second = await authenticated(options)
    await approveWithPeer(daemon, second, input)
    const attack = expect(daemon.requestIssuerReview(issuerInput(input), new AbortController().signal)).rejects.toThrow('channel-unavailable')
    await second.read()
    second.send(decision(second.hello, input))
    await attack
    await second.done
  })

  it('refuses an issuer answer for a pending broker request, then approves the correct broker answer', async () => {
    const options = route()
    const daemon = await server(options)
    // Positive control: a correct broker approval on one connection.
    const first = await authenticated(options)
    const input = request()
    const ok = daemon.requestReview(input, new AbortController().signal)
    await first.read()
    first.send(decision(first.hello, input))
    await expect(ok).resolves.toBe('approved')
    first.socket.destroy()
    await first.done
    // Attack: a validly signed issuer-typed answer for a pending broker request.
    const second = await authenticated(options)
    const attack = expect(daemon.requestReview(input, new AbortController().signal)).rejects.toThrow('channel-unavailable')
    await second.read()
    second.send(issuerDecision(second.hello, issuerFrame(input)))
    await attack
    await second.done
  })

  it('serves a fresh two-stage approval on the same connection after a parent denial', async () => {
    const options = route()
    const daemon = await server(options)
    let calls = 0
    await client(options, () => (++calls === 1 ? 'denied' : 'approved'), () => 'approved')
    const denied = request()
    await expect(daemon.requestReview(denied, new AbortController().signal)).resolves.toBe('denied')
    // Negative control: the denied reviewId stays spent; denial frees nothing.
    await expect(daemon.requestReview(denied, new AbortController().signal)).rejects.toThrow('review-unavailable')
    expect(calls).toBe(1)
    // Fresh two-stage approval on the same connection.
    const fresh = { ...request(), reviewId: '2'.repeat(32), authorizationDigest: '4'.repeat(64) }
    await expect(daemon.requestReview(fresh, new AbortController().signal)).resolves.toBe('approved')
    await expect(daemon.requestIssuerReview(issuerInput(fresh), new AbortController().signal)).resolves.toBe('approved')
  })

  it('settles a split-frame answer once; a duplicate closes without a second settlement', async () => {
    const options = route()
    const daemon = await server(options)
    const peer = await authenticated(options)
    const input = request()
    const pending = daemon.requestReview(input, new AbortController().signal)
    // Positive control: a decision split across two TCP chunks still settles.
    const raw = Buffer.from(`${JSON.stringify(decision(peer.hello, input))}\n`)
    peer.socket.write(raw.subarray(0, 11))
    peer.socket.write(raw.subarray(11))
    await expect(pending).resolves.toBe('approved')
    // Negative: the identical answer repeated cannot settle again; fail-closed.
    peer.send(decision(peer.hello, input))
    await peer.done
    await expect(daemon.requestReview({ ...input, reviewId: '2'.repeat(32) }, new AbortController().signal)).rejects.toThrow('channel-unavailable')
    // The queue is not left unusable: a reconnected terminal serves fresh work.
    const secondInput = { ...input, reviewId: '2'.repeat(32) }
    const next = await authenticated(options)
    const fresh = daemon.requestReview(secondInput, new AbortController().signal)
    await next.read()
    next.send(decision(next.hello, secondInput))
    await expect(fresh).resolves.toBe('approved')
  })

  it('refuses a verbatim captured answer on a reconnected same-key connection', async () => {
    const options = route()
    const daemon = await server(options)
    const input = request()
    // Connection A: capture a genuinely signed approval.
    const first = await authenticated(options)
    const settled = daemon.requestReview(input, new AbortController().signal)
    await first.read()
    const captured = decision(first.hello, input)
    first.send(captured)
    await expect(settled).resolves.toBe('approved')
    first.socket.destroy()
    await first.done
    // Connection B, same terminal key: verbatim replay of A's bytes is refused.
    const second = await authenticated(options)
    expect(second.hello.sessionId).not.toBe(first.hello.sessionId)
    const refused = expect(daemon.requestReview(input, new AbortController().signal)).rejects.toThrow('channel-unavailable')
    await second.read()
    second.send({ ...captured })
    await refused
    await second.done
    // Positive control: a freshly signed answer on a new connection succeeds.
    const third = await authenticated(options)
    const fresh = daemon.requestReview(input, new AbortController().signal)
    await third.read()
    third.send(decision(third.hello, input))
    await expect(fresh).resolves.toBe('approved')
  })
})
