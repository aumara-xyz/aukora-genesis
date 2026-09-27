/**
 * The installed broker entry, exercised by execution rather than by matching a
 * string in a property list. A real broker and the real transport run; the
 * terminal answer and the issuer signature are SCRIPTED scratch fixtures, not
 * human approval, a production issuer terminal, or installed-UID evidence.
 */
import { generateKeyPairSync, sign } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createConnection, createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { appendEntry, readVerifiedChain } from '../aukora/aura/record.mjs'
import { memoryPut as seedMemoryPut } from '../aukora/broker/effect.mjs'
import { stageKiraMemoryRecord } from '../aukora/kira/stage.mjs'
import { BROKER_REFUSE, provisionBrokerIdentity, type BrokerServer } from '../aukora/broker/broker.mjs'
import { authorizationSignedMessageFromHex } from '../aukora/host-dsh/src/grant.mjs'
import { encodeSubjectAuthorityContext } from '../aukora/broker/subject-authority.mjs'
import { loadOrCreateLocalAumlokControl } from '../aukora/identity/local-control-store.mjs'
import { createDeveloperAumlokAuthority } from '../aukora/supervisor/developer-aumlok.mjs'
import { connectReviewTransport, type ReviewTransportClient } from './launchd-review-transport.mjs'
import { BROKER_ENTRY_REFUSE, main, readEntryOptions } from './launchd-broker-entry.mjs'
import { buildInstalledActivationStatement, verifyInstalledActivation } from './launchd-activation.mjs'
import { measureDigestManifest } from '../aukora/activation/measure.mjs'
import {
  activationDigest, encodeActivationStatement, parseActivationStatement, parseActivationStatementFrame,
} from '../aukora/activation/statement.mjs'

const CHECKOUT = fileURLToPath(new URL('..', import.meta.url))
// One core member is enough to make the manifest non-empty and to make a
// changed authority byte change the activation digest.
const CORE_MEMBERS = ['aukora/broker/broker.mjs']
const hex = (character: string): string => character.repeat(64)

/** Members every installed activation names, plus the entry itself. */
const STAGED_MEMBERS = [
  ...CORE_MEMBERS,
  'scripts/launchd-broker-entry.mjs',
  'scripts/launchd-broker-review.mjs',
  'scripts/launchd-review-transport.mjs',
  'scripts/launchd-socket-listener.mjs',
  'scripts/launchd-activation.mjs',
  'aukora/activation/measure.mjs',
  'aukora/activation/statement.mjs',
]

/**
 * Stage one implementation root holding every member an installed activation
 * names, and author the statement over it.
 *
 * The entry reads its activation from a fixed name inside the root it is
 * staged in, so every test here runs the installed shape rather than the
 * checkout. Relative imports in the staged entry are rewritten to this
 * checkout, so only its location differs from the real one.
 */
function stageRoot(directory: string, mutate: (source: string) => string = source => source) {
  for (const member of STAGED_MEMBERS) {
    const destination = join(directory, member)
    mkdirSync(dirname(destination), { recursive: true })
    const body = member === 'scripts/launchd-broker-entry.mjs'
      ? mutate(readFileSync(join(CHECKOUT, member), 'utf8')).replace(
        /from '(\.[^']+)'/gu,
        (_match, specifier: string) => `from ${JSON.stringify(new URL(specifier, import.meta.url).href)}`,
      )
      : readFileSync(join(CHECKOUT, member))
    writeFileSync(destination, body)
    // Measured members must not be writable beyond their owner. Set explicitly
    // so a permissive umask on another platform cannot refuse the measurement.
    chmodSync(destination, 0o444)
  }
  const built = buildInstalledActivationStatement({
    implementationRoot: directory, interpreter: process.execPath, coreMembers: CORE_MEMBERS,
    selections: {
      epoch: 1,
      compositionDigest: hex('a'),
      proposalCellSha256: hex('b'),
      rendererId: hex('c'),
      modelEmissionPolicy: 'installed-broker-review',
      issuerId: hex('d'),
      brokerId: hex('e'),
    },
  })
  writeFileSync(join(directory, 'activation.json'), built.frame)
  return { entryModule: join(directory, 'scripts', 'launchd-broker-entry.mjs'), digest: built.digest }
}

const serverId = 'ef'.repeat(32)
// Names the witness assertion a mutant must fail, so the failure is attributable.
const WITNESS_OPEN = 'positive witness: proposal.open must succeed'
const memoryPut = { key: 'entry-review-test', value: { scripted: true } }
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })

const entries = (path: string): number => existsSync(path) ? readdirSync(path).length : 0

function world(stateDir: string): { aura: number; nonces: number; objects: number } {
  const auraPath = join(stateDir, 'aura.jsonl')
  let aura = 0
  if (existsSync(auraPath)) {
    const chain = readVerifiedChain(auraPath)
    if (!chain.ok) throw new Error(`entry wrote unverified Aura: ${chain.reason}`)
    aura = chain.count
  }
  return { aura, nonces: entries(join(stateDir, 'nonces')), objects: entries(join(stateDir, 'memory/objects')) }
}

function request(socketPath: string, frame: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ''
    let done = false
    const finish = (error?: Error, reply?: Record<string, unknown>): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      socket.destroy()
      if (error !== undefined) reject(error); else resolve(reply as Record<string, unknown>)
    }
    const timer = setTimeout(() => { finish(new Error('entry request timed out')) }, 8_000)
    socket.on('error', (error: Error) => { finish(error) })
    socket.on('connect', () => { socket.write(`${JSON.stringify(frame)}\n`) })
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const end = buffer.indexOf('\n')
      if (end >= 0) finish(undefined, JSON.parse(buffer.slice(0, end)) as Record<string, unknown>)
    })
  })
}

/** A real broker under the entry, with a scripted issuer and a written terminal key. */
async function fixture({
  issuerApproves = true,
  memory = false,
  configure = (_environment: Record<string, string>, _root: string) => {},
  entryModule = undefined as string | undefined,
  activationDigest = undefined as string | undefined,
  authorityActivationDigest = undefined as string | undefined,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aukora-entry-'))
  const rootKey = generateKeyPairSync('ed25519')
  const terminalKey = generateKeyPairSync('ed25519')
  const issuerSocket = join(root, 'i.sock')
  const peers = new Set<Socket>()
  const issuer = createServer((socket) => {
    peers.add(socket)
    socket.once('close', () => { peers.delete(socket) })
    socket.on('error', () => { /* a cancelled broker request closes this scripted peer */ })
    let buffer = ''
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const end = buffer.indexOf('\n')
      if (end < 0) return
      socket.removeAllListeners('data')
      const frame = JSON.parse(buffer.slice(0, end)) as Record<string, unknown>
      const reply = frame.op === 'admit' ? { ok: true }
        : !issuerApproves ? { ok: false, reason: 'issuer:human-denied' }
          : { ok: true, digest: frame.digest,
            signature: sign(null, authorizationSignedMessageFromHex(frame.digest as string), rootKey.privateKey).toString('base64') }
      socket.end(`${JSON.stringify(reply)}\n`)
    })
  })
  const keyFile = join(root, 'terminal.pub.pem')
  writeFileSync(keyFile, terminalKey.publicKey.export({ type: 'spki', format: 'pem' }).toString())
  const stateDir = join(root, 'state')
  const implementation = join(root, 'implementation')
  mkdirSync(implementation, { recursive: true })
  const staged = entryModule === undefined ? stageRoot(implementation) : { entryModule, digest: activationDigest as string }
  const environment: Record<string, string> = {
    AUKORA_SOCKET: join(root, 'b.sock'),
    AUKORA_STATE_DIR: stateDir,
    AUKORA_ROOT_PEM: rootKey.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    AUKORA_ISSUER_SOCKET: issuerSocket,
    AUKORA_REVIEW_SOCKET: join(root, 'r.sock'),
    AUKORA_REVIEW_TERMINAL_PUBLIC_KEY_FILE: keyFile,
    AUKORA_REVIEW_SERVER_ID: serverId,
    AUKORA_ACTIVATION_DIGEST: staged.digest,
    AUKORA_RENDERER_ID: hex('c'),
  }
  if (memory) {
    // Synthetic controller, never a live identity or attended authorization.
    const control = loadOrCreateLocalAumlokControl(join(root, 'control'))
    const authority = createDeveloperAumlokAuthority(control, { audience: 'broker:installed-test' })
    const context = await authority.selectSubjectAuthority({
      type: 'aukora:authority-request:v1', selectionId: '23'.repeat(16),
      proposalId: 'proposal:installed-memory-test', toolName: 'memory.put',
      operationDigest: hex('3'), artifactDigest: hex('4'), activationDigest: authorityActivationDigest ?? staged.digest,
      audience: 'broker:installed-test', resource: 'memory:key:entry-review-test',
      budget: { calls: 1, bytes: 4096, computeMs: 0, costMicrounits: 0 },
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    }, new AbortController().signal)
    const controlPath = join(root, 'root-control.json')
    writeFileSync(controlPath, JSON.stringify(control.activeControl), { mode: 0o600 })
    environment.AUKORA_ROOT_PEM = control.ed25519PublicKeyPem
    environment.AUKORA_KIRA_RECALL_POLICY = JSON.stringify({ subject: control.subject, privacy: ['local'] })
    environment.AUKORA_SUBJECT_AUTHORITY_B64 = encodeSubjectAuthorityContext(context)
    environment.AUKORA_ROOT_CONTROL_STATE_FILE = controlPath
  }
  // Registered before startup so a refusing entry still releases the fixture;
  // a holder keeps that ordering without a reassigned binding.
  const started: { server?: BrokerServer } = {}
  const clients: ReviewTransportClient[] = []
  cleanups.push(async () => {
    for (const client of clients) await client.close()
    await started.server?.close()
    for (const peer of peers) peer.destroy()
    if (issuer.listening) await new Promise<void>((resolve, reject) => {
      issuer.close((error) => { if (error !== undefined && error !== null) reject(error); else resolve() })
    })
    rmSync(root, { recursive: true, force: true })
  })
  await new Promise<void>((resolve, reject) => { issuer.once('error', reject); issuer.listen(issuerSocket, resolve) })
  configure(environment, root)
  const module = await import(pathToFileURL(staged.entryModule).href) as { main: typeof main }
  started.server = await module.main(environment)
  let opened: Record<string, unknown> | undefined
  return {
    environment, stateDir, server: started.server,
    async restart() {
      await started.server?.close()
      started.server = await module.main(environment)
    },
    get opened() { return opened },
    // Opening is part of the positive witness rather than of fixture setup, so
    // the witness performs its own request against whichever entry is running.
    async open() {
      opened = await request(environment.AUKORA_SOCKET as string, { op: 'proposal.open' })
      return opened
    },
    async terminal(decision: 'approved' | 'denied') {
      const client = await connectReviewTransport({
        socketPath: environment.AUKORA_REVIEW_SOCKET as string, role: 'broker', serverId,
        terminalPrivateKey: terminalKey.privateKey, timeoutMs: 4_000,
        review: async () => decision,
      })
      clients.push(client)
      return client
    },
    deposit: async () => {
      const deposited = await request(environment.AUKORA_SOCKET as string, {
        op: 'proposal.deposit',
        proposalNamespace: (opened as Record<string, unknown>).proposalNamespace,
        callId: `entry-${String(Date.now())}`,
        toolName: 'memory.put',
        arguments: memoryPut,
      })
      // The deposit acknowledgement is PENDING; the review outcome is the
      // terminal state, so a test asserting the acknowledgement would pass
      // whatever the terminal answered.
      for (let attempt = 0; attempt < 200; attempt++) {
        const status = await request(environment.AUKORA_SOCKET as string, {
          op: 'proposal.status', proposalNamespace: (opened as Record<string, unknown>).proposalNamespace, proposalId: deposited.proposalId,
        })
        if (status.state !== 'PENDING') return status
        await delay(10)
      }
      throw new Error('scripted proposal did not terminate')
    },
  }
}

/**
 * The positive witness: every assertion that must hold when the reviewed entry
 * settles one governed effect. The real entry and the mutant run this same
 * function unchanged, so a mutant failure is a failure of the positive witness
 * rather than of a separately written negative expectation.
 */
async function positiveWitness(test: Awaited<ReturnType<typeof fixture>>) {
  expect(await test.open(), WITNESS_OPEN).toMatchObject({ ok: true })
  await test.terminal('approved')
  const outcome = await test.deposit()
  expect(outcome).toMatchObject({ ok: true, state: 'SETTLED' })
  expect(world(test.stateDir)).toEqual({ aura: 1, nonces: 1, objects: 1 })
}

describe('installed broker entry', () => {
  it('uses the launch-owned KIRA policy and control head on the actual broker socket', async () => {
    const test = await fixture({ memory: true })
    const recall = await request(test.environment.AUKORA_SOCKET as string, { op: 'kira.recall' })
    expect(recall).toMatchObject({ ok: true, result: { status: 'empty' }, privacy: ['local'] })
    expect(JSON.parse(readFileSync(join(test.stateDir, 'root-control.json'), 'utf8')))
      .toEqual(JSON.parse(readFileSync(test.environment.AUKORA_ROOT_CONTROL_STATE_FILE as string, 'utf8')))
    await expect(request(test.environment.AUKORA_SOCKET as string, {
      op: 'kira.recall', subject: 'another-subject', privacy: ['private'],
    })).resolves.toMatchObject({ ok: false, reason: BROKER_REFUSE.KIRA_RECALL_FRAME_NOT_EXACT })
  })

  it('retains cited permitted records across entry restart without disclosing other subjects or privacy classes', async () => {
    const test = await fixture({ memory: true, configure(environment, root) {
      const policy = JSON.parse(environment.AUKORA_KIRA_RECALL_POLICY as string) as { subject: string }
      const state = join(root, 'state')
      mkdirSync(state, { mode: 0o700 })
      provisionBrokerIdentity(state)
      // SCRIPTED retained history tests reading only, not issuer approval or settlement.
      const rows = [
        { subject: policy.subject, privacy: 'local' as const, note: 'permitted local record' },
        { subject: policy.subject, privacy: 'private' as const, note: 'private canary' },
        { subject: `aukora:1:${hex('7')}`, privacy: 'local' as const, note: 'foreign canary' },
      ]
      rows.forEach((row, index) => {
        const staged = stageKiraMemoryRecord({
          subject: row.subject, privacy: row.privacy, kind: 'observation', content: { note: row.note },
          createdAt: '2026-09-09T00:00:00Z', source: [], links: [],
        })
        const effect = seedMemoryPut(state, staged.memoryPut)
        appendEntry({ file: join(state, 'aura.jsonl'), fields: {
          verdict: 'settled', sequence: index + 1, key: staged.recordId, contentSha256: effect.contentSha256,
        } })
        writeFileSync(join(state, 'seq'), String(index + 1), { mode: 0o600 })
      })
    } })
    const socket = test.environment.AUKORA_SOCKET as string
    const before = await request(socket, { op: 'kira.recall' })
    expect(before).toMatchObject({ ok: true, result: {
      status: 'found', records: [{ content: { note: 'permitted local record' }, grantsAuthority: false }],
    } })
    expect((before.result as { records: unknown[] }).records).toHaveLength(1)
    expect(before.citations).toHaveLength(1)
    const aura = readFileSync(join(test.stateDir, 'aura.jsonl'))
    await test.restart()
    expect(await request(socket, { op: 'kira.recall' })).toEqual(before)
    expect(readFileSync(join(test.stateDir, 'aura.jsonl'))).toEqual(aura)
  })

  it.each([
    'AUKORA_KIRA_RECALL_POLICY', 'AUKORA_SUBJECT_AUTHORITY_B64', 'AUKORA_ROOT_CONTROL_STATE_FILE',
  ])('refuses partial memory configuration missing %s before creating state or sockets', async (absent) => {
    let root = ''
    await expect(fixture({ memory: true, configure(environment, directory) {
      root = directory
      Reflect.deleteProperty(environment, absent)
    } })).rejects.toThrow(BROKER_ENTRY_REFUSE.MEMORY_CONFIGURATION_INCOMPLETE)
    for (const path of ['state', 'b.sock', 'r.sock']) expect(existsSync(join(root, path))).toBe(false)
  })

  it.each([
    ['invalid JSON', '{', BROKER_REFUSE.KIRA_RECALL_POLICY_INVALID],
    ['invalid privacy', JSON.stringify({ subject: 'owner', privacy: ['public'] }), BROKER_REFUSE.KIRA_RECALL_POLICY_INVALID],
    ['different subject', JSON.stringify({ subject: `aukora:1:${hex('7')}`, privacy: ['local'] }), BROKER_REFUSE.KIRA_RECALL_POLICY_INVALID],
  ])('refuses %s in the launch policy', async (_label, policy, reason) => {
    await expect(fixture({ memory: true, configure(environment) {
      environment.AUKORA_KIRA_RECALL_POLICY = policy
    } })).rejects.toThrow(reason)
  })

  it('refuses malformed authority instead of serving unbound memory', async () => {
    await expect(fixture({ memory: true, configure(environment) {
      environment.AUKORA_SUBJECT_AUTHORITY_B64 = 'not-base64'
    } })).rejects.toThrow(BROKER_REFUSE.AUTHORITY_CONFIGURATION_INVALID)
  })

  it('refuses a control head whose signer differs from the installed issuer', async () => {
    await expect(fixture({ memory: true, configure(environment) {
      environment.AUKORA_ROOT_PEM = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString()
    } })).rejects.toThrow(BROKER_REFUSE.IDENTITY_CONTROL_SIGNER_MISMATCH)
  })

  it('refuses valid authority bound to a different activation before creating state or listeners', async () => {
    let root = ''
    await expect(fixture({ memory: true, authorityActivationDigest: hex('9'), configure(_environment, directory) {
      root = directory
    } })).rejects.toThrow(BROKER_REFUSE.ACTIVATION_MISMATCH)
    for (const path of ['state', 'b.sock', 'r.sock']) expect(existsSync(join(root, path))).toBe(false)
  })

  it.each(['symlink', 'hardlink', 'shared-write', 'oversize', 'invalid-json', 'directory', 'relative'])
  ('refuses an unsafe control file: %s', async (kind) => {
    await expect(fixture({ memory: true, configure(environment, root) {
      const path = environment.AUKORA_ROOT_CONTROL_STATE_FILE as string
      if (kind === 'symlink') {
        const alias = join(root, 'control-link.json')
        symlinkSync(path, alias)
        environment.AUKORA_ROOT_CONTROL_STATE_FILE = alias
      } else if (kind === 'hardlink') linkSync(path, join(root, 'control-copy.json'))
      else if (kind === 'shared-write') chmodSync(path, 0o666)
      else if (kind === 'oversize') writeFileSync(path, ' '.repeat(16 * 1024 + 1))
      else if (kind === 'invalid-json') writeFileSync(path, '{')
      else if (kind === 'directory') environment.AUKORA_ROOT_CONTROL_STATE_FILE = root
      else environment.AUKORA_ROOT_CONTROL_STATE_FILE = 'root-control.json'
    } })).rejects.toThrow(BROKER_REFUSE.IDENTITY_CONTROL_STATE_MALFORMED)
  })

  it('refuses to start without a review route rather than serving unreviewed', () => {
    const complete = {
      AUKORA_SOCKET: '/tmp/b.sock', AUKORA_STATE_DIR: '/tmp/s', AUKORA_ROOT_PEM: 'pem',
      AUKORA_ISSUER_SOCKET: '/tmp/i.sock', AUKORA_REVIEW_SOCKET: '/tmp/r.sock',
      AUKORA_REVIEW_TERMINAL_PUBLIC_KEY_FILE: '/tmp/k.pem', AUKORA_REVIEW_SERVER_ID: serverId,
      AUKORA_ACTIVATION_DIGEST: hex('a'), AUKORA_RENDERER_ID: hex('c'),
    }
    for (const absent of ['AUKORA_REVIEW_SOCKET', 'AUKORA_REVIEW_TERMINAL_PUBLIC_KEY_FILE', 'AUKORA_REVIEW_SERVER_ID']) {
      const environment = { ...complete, [absent]: undefined }
      expect(() => readEntryOptions(environment)).toThrow(BROKER_ENTRY_REFUSE.REVIEW_ROUTE_REQUIRED)
    }
    for (const absent of ['AUKORA_SOCKET', 'AUKORA_STATE_DIR', 'AUKORA_ROOT_PEM', 'AUKORA_ISSUER_SOCKET']) {
      const environment = { ...complete, [absent]: undefined }
      expect(() => readEntryOptions(environment)).toThrow(BROKER_ENTRY_REFUSE.BROKER_ENVIRONMENT_INCOMPLETE)
    }
    // An installed broker with no declared activation can never settle, so it
    // refuses to start rather than serving a broker that will refuse everything.
    for (const absent of ['AUKORA_ACTIVATION_DIGEST', 'AUKORA_RENDERER_ID']) {
      const environment = { ...complete, [absent]: undefined }
      expect(() => readEntryOptions(environment)).toThrow(BROKER_ENTRY_REFUSE.ACTIVATION_REQUIRED)
    }
    expect(() => readEntryOptions(complete)).toThrow(BROKER_ENTRY_REFUSE.TERMINAL_KEY_UNREADABLE)
  })

  it('settles through the entry when the terminal approves and the issuer signs', async () => {
    await positiveWitness(await fixture())
  })

  it('publishes the review route restricted to the broker principal', async () => {
    // The review route is a third node in the broker's 0710 route parent, whose
    // group contains the guest. Its 0600 mode is the only thing keeping the
    // guest off the approval channel, and it is a default nothing else asserts.
    const test = await fixture()
    expect(lstatSync(test.environment.AUKORA_REVIEW_SOCKET as string).mode & 0o777).toBe(0o600)
  })

  it('refuses with no terminal connected and settles nothing', async () => {
    const test = await fixture()
    expect(await test.open()).toMatchObject({ ok: true })
    const outcome = await test.deposit()
    expect(outcome).toMatchObject({ state: 'REFUSED', reason: BROKER_REFUSE.REVIEW_CHANNEL_UNAVAILABLE })
    expect(world(test.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })

  it('preserves a terminal denial without settling', async () => {
    const test = await fixture()
    expect(await test.open()).toMatchObject({ ok: true })
    await test.terminal('denied')
    const outcome = await test.deposit()
    expect(outcome).toMatchObject({ state: 'REFUSED', reason: BROKER_REFUSE.REVIEW_DENIED })
    expect(world(test.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })

  it('does not turn a terminal approval into issuer authorization', async () => {
    const test = await fixture({ issuerApproves: false })
    expect(await test.open()).toMatchObject({ ok: true })
    await test.terminal('approved')
    const outcome = await test.deposit()
    expect(outcome).toMatchObject({ state: 'REFUSED', reason: BROKER_REFUSE.ISSUER_REFUSED })
    expect(world(test.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })

  it('refuses a digest no measured statement produces, and a statement that names nothing', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aukora-activation-'))
    cleanups.push(async () => { rmSync(directory, { recursive: true, force: true }) })
    const staged = stageRoot(directory)
    const options = {
      statementPath: join(directory, 'activation.json'),
      implementationRoot: directory, interpreter: process.execPath, expectedDigest: staged.digest,
    }
    expect(verifyInstalledActivation(options)).toBe(staged.digest)
    expect(() => verifyInstalledActivation({ ...options, expectedDigest: hex('f') }))
      .toThrow('activation:digest-mismatch')
    expect(() => verifyInstalledActivation({ ...options, statementPath: join(directory, 'absent.json') }))
      .toThrow('launchd-activation:statement-unreadable')

    // A statement is not free to choose what it commits to. One that names only
    // an innocuous readable file would otherwise satisfy every manifest while
    // measuring none of the code it is supposed to protect.
    const innocuous = measureDigestManifest(
      [{ name: CORE_MEMBERS[0] as string, path: join(directory, CORE_MEMBERS[0] as string) }],
      { allowAncestorLinks: true },
    )
    const hollow = parseActivationStatement({
      ...parseActivationStatementFrame(readFileSync(options.statementPath, 'utf8')),
      coreManifest: innocuous,
      closure: { executable: innocuous, resolver: innocuous },
    })
    const hollowPath = join(directory, 'hollow.json')
    writeFileSync(hollowPath, encodeActivationStatement(hollow))
    expect(() => verifyInstalledActivation({
      statementPath: hollowPath, implementationRoot: directory, interpreter: process.execPath, expectedDigest: activationDigest(hollow),
    })).toThrow('launchd-activation:closure-incomplete')
  })

  it('asks about the interpreter the caller names, not the one it happens to be running', () => {
    // Two callers ask different questions of the same statement. A running
    // entry asks about the interpreter executing it; an installer asks about
    // the binary the job it is about to write will launch. Silently answering
    // with process.execPath would validate the wrong program on any host where
    // those differ.
    const directory = mkdtempSync(join(tmpdir(), 'aukora-interpreter-'))
    cleanups.push(async () => { rmSync(directory, { recursive: true, force: true }) })
    const staged = stageRoot(directory)
    const options = {
      statementPath: join(directory, 'activation.json'),
      implementationRoot: directory, expectedDigest: staged.digest,
    }
    // Positive control: the interpreter the statement was built against.
    expect(verifyInstalledActivation({ ...options, interpreter: process.execPath })).toBe(staged.digest)
    // Negative control: a different real binary, refused on its measured bytes.
    expect(() => verifyInstalledActivation({ ...options, interpreter: '/bin/sh' }))
      .toThrow('activation:closure-member-digest-mismatch')
  })

  it('refuses when a measured member no longer holds the bytes its activation names', async () => {
    // The statement is retained beside the implementation it describes, so the
    // question at launch is whether those bytes are still the measured ones.
    const directory = mkdtempSync(join(tmpdir(), 'aukora-activation-drift-'))
    cleanups.push(async () => { rmSync(directory, { recursive: true, force: true }) })
    for (const member of [...CORE_MEMBERS,
      'scripts/launchd-broker-entry.mjs', 'scripts/launchd-broker-review.mjs',
      'scripts/launchd-review-transport.mjs',
      'aukora/activation/measure.mjs', 'aukora/activation/statement.mjs']) {
      const destination = join(directory, member)
      mkdirSync(dirname(destination), { recursive: true })
      copyFileSync(join(CHECKOUT, member), destination)
    }
    const staged = stageRoot(directory)
    const options = {
      statementPath: join(directory, 'activation.json'),
      implementationRoot: directory, interpreter: process.execPath, expectedDigest: staged.digest,
    }
    expect(verifyInstalledActivation(options)).toBe(staged.digest)

    const member = join(directory, CORE_MEMBERS[0] as string)
    chmodSync(member, 0o644)
    writeFileSync(member, '// a different authority byte\n')
    chmodSync(member, 0o444)
    expect(() => verifyInstalledActivation(options)).toThrow('activation:closure-member-digest-mismatch')
  })

  it('a subject with the activation comparison removed fails the unchanged negative witness', async () => {
    // The negative witness: a digest the statement does not measure must refuse.
    // It is run unchanged against the real module and against a disposable copy
    // whose comparison is removed, so the check is shown to be load-bearing
    // rather than merely present.
    const directory = mkdtempSync(join(tmpdir(), 'aukora-activation-mutant-'))
    cleanups.push(async () => { rmSync(directory, { recursive: true, force: true }) })
    const staged = stageRoot(directory)
    const wrong = {
      statementPath: join(directory, 'activation.json'),
      implementationRoot: directory, interpreter: process.execPath, expectedDigest: hex('f'),
    }
    const negativeWitness = (verify: typeof verifyInstalledActivation): void => {
      expect(() => verify(wrong)).toThrow('activation:digest-mismatch')
    }
    negativeWitness(verifyInstalledActivation)

    const source = readFileSync(new URL('./launchd-activation.mjs', import.meta.url), 'utf8')
    const site = 'return assertActivationDigest(statement, expectedDigest)'
    expect(source).toContain(site)
    const mutantPath = join(directory, 'launchd-activation.mjs')
    const mutated = source
      .replace(site, 'return activationDigest(statement)')
      .replace(/from '(\.[^']+)'/gu, (_match, specifier: string) =>
        `from ${JSON.stringify(new URL(specifier, import.meta.url).href)}`)
    expect(mutated).not.toContain(site)
    writeFileSync(mutantPath, mutated)
    const mutant = await import(pathToFileURL(mutantPath).href) as {
      verifyInstalledActivation: typeof verifyInstalledActivation
    }

    let witnessFailure: unknown
    try { negativeWitness(mutant.verifyInstalledActivation) } catch (error) { witnessFailure = error }
    expect(witnessFailure, 'removing the comparison must fail the negative witness').toBeDefined()
    // It fails by accepting the wrong digest, not by throwing something else.
    expect(mutant.verifyInstalledActivation(wrong)).toBe(staged.digest)
  })

  it('a mutant entry selecting plain serve fails the unchanged positive witness', async () => {
    // Rule 3 applied to this entry: the positive case must depend on the
    // adapter. Both mutation anchors are asserted before use, because a
    // silently unmatched replacement would leave a module that fails to import
    // and an import failure is not detection.
    const site = 'await serveBrokerWithTerminalReview(readEntryOptions(environment))'
    const adapterImport = "import { serveBrokerWithTerminalReview } from './launchd-broker-review.mjs'"
    const directory = mkdtempSync(join(tmpdir(), 'aukora-entry-mutant-'))
    cleanups.push(async () => { rmSync(directory, { recursive: true, force: true }) })
    const staged = stageRoot(directory, (source) => {
      expect(source).toContain(adapterImport)
      expect(source).toContain(site)
      const mutated = source
        .replace(adapterImport, `import { serve } from ${JSON.stringify(new URL('../aukora/broker/broker.mjs', import.meta.url).href)}`)
        .replace(site, 'await serve(readEntryOptions(environment).broker)')
      expect(mutated).not.toContain(adapterImport)
      expect(mutated).not.toContain(site)
      return mutated
    })

    // The unchanged positive witness is the detector: it runs against the
    // mutant, issues its own request, and its failure is what convicts.
    const test = await fixture({ entryModule: staged.entryModule, activationDigest: staged.digest })
    let witnessFailure: unknown
    try { await positiveWitness(test) } catch (error) { witnessFailure = error }
    expect(witnessFailure, 'the mutant must fail the positive witness').toBeDefined()
    expect((witnessFailure as Error).message).toContain(WITNESS_OPEN)

    // Corroboration that the mutant reached the broker and the broker answered.
    expect(test.opened).toMatchObject({ ok: false, reason: 'broker:review-channel-unavailable' })
    expect(world(test.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
  })

})
