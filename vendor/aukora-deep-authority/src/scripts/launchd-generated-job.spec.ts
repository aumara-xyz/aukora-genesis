/**
 * The generated broker job, executed. The program, the working directory and
 * every environment value come from the rendered property list, and the
 * implementation root holds the installer's staged file set, so no relative
 * import and no environment value here comes from the developer checkout.
 * The explicitly instrumented v4 replay cases alter only scratch copies before
 * activation measurement; they do not prove installed-service or v5 behavior.
 *
 * Bare-specifier resolution still walks ancestor directories, as it does for a
 * real installed root, so this proves the staged set is sufficient rather than
 * that the child is sealed against every ancestor.
 *
 * The generator inputs here are scratch-rooted rather than produced by the
 * installer's `launchInputs`, because plan validation pins every managed path
 * under `/private/var/db/aukora`, which this suite cannot own. The
 * installer-to-generator connection is covered separately, against the
 * checked-in operator plan, in `install-launchd-custody-pair.spec.ts`. The
 * terminal public key is written here for the same reason: the installer
 * requires an operator-placed root-owned key, which this suite cannot create.
 *
 * The terminal answer and the issuer signature are SCRIPTED scratch fixtures.
 * They are not human approval, a production issuer terminal, or installed-UID
 * evidence, and this file runs as one ordinary user rather than as the
 * installed service principals.
 */
import { generateKeyPairSync, sign } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createConnection, createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { authorizationSignedMessageFromHex } from '../aukora/host-dsh/src/grant.mjs'
import { encodeSubjectAuthorityContext } from '../aukora/broker/subject-authority.mjs'
import { loadOrCreateLocalAumlokControl } from '../aukora/identity/local-control-store.mjs'
import { createDeveloperAumlokAuthority } from '../aukora/supervisor/developer-aumlok.mjs'
import { renderJobs, validateInputs } from './generate-launchd-jobs.mjs'
import { installedAuthorityFiles } from './install-launchd-custody-pair.mjs'
import { INSTALLED_ACTIVATION_STATEMENT, buildInstalledActivationStatement } from './launchd-activation.mjs'
import { connectReviewTransport, type ReviewTransportClient } from './launchd-review-transport.mjs'

const CHECKOUT = fileURLToPath(new URL('..', import.meta.url))
const serverId = '7a'.repeat(32)
const cleanups: Array<() => Promise<void>> = []
const entries = (path: string): number => existsSync(path) ? readdirSync(path).length : 0

interface SettlementReplay {
  frame: string
  mode: string
  observations: string
}

/** Require each scratch-source edit to affect its one intended statement. */
function replaceOnce(source: string, before: string, after: string): string {
  expect(source.split(before), 'unique scratch-source instrumentation anchor').toHaveLength(2)
  return source.replace(before, after)
}

/** Retain and re-present a v4 authorization without changing its consuming verifier. */
function instrumentSettlement(source: string, replay: SettlementReplay): string {
  const call = `      const settled = await withSettlementTurn(authorized.request, () => settleGrantRequest({
        request: authorized.request,
        connection: entry.connection,
        grant: authorized.grant,`
  return replaceOnce(source, call, `      const fixtureMode = readFileSync(${JSON.stringify(replay.mode)}, 'utf8')
      let fixtureAuthorization = { request: authorized.request, grant: authorized.grant }
      if (fixtureMode === 'capture') {
        writeFileSync(${JSON.stringify(replay.frame)}, JSON.stringify(fixtureAuthorization), { flag: 'wx', mode: 0o600 })
      } else if (fixtureMode === 'replay') {
        fixtureAuthorization = JSON.parse(readFileSync(${JSON.stringify(replay.frame)}, 'utf8'))
      }
      writeFileSync(${JSON.stringify(replay.observations)}, JSON.stringify({
        pid: process.pid, frame: JSON.stringify(fixtureAuthorization),
      }) + '\\n', { flag: 'a', mode: 0o600 })
      const settled = await withSettlementTurn(fixtureAuthorization.request, () => settleGrantRequest({
        request: fixtureAuthorization.request,
        connection: entry.connection,
        grant: fixtureAuthorization.grant,`)
}

/** Read every retained filename and byte, not only directory entry counts. */
function directoryBytes(path: string): Record<string, Buffer> {
  return Object.fromEntries(readdirSync(path).sort().map(name => [name, readFileSync(join(path, name))]))
}

function settledBytes(stateDir: string) {
  return {
    aura: readFileSync(join(stateDir, 'aura.jsonl')),
    nonces: directoryBytes(join(stateDir, 'nonces')),
    objects: directoryBytes(join(stateDir, 'memory', 'objects')),
    keys: directoryBytes(join(stateDir, 'memory', 'keys')),
  }
}

/** The normal case and disposable guard mutation share this exact assertion. */
function expectReplayRefused(result: Record<string, unknown>): void {
  expect(result, 'spent v4 authorization must refuse after broker replacement')
    .toMatchObject({ ok: false, state: 'REFUSED', reason: 'grant:replayed' })
}

afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })

const unescapeXml = (value: string): string => value
  .replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&quot;/gu, '"')
  .replace(/&apos;/gu, "'").replace(/&amp;/gu, '&')

/** Return the argv the rendered job executes. */
function programArguments(plist: string): string[] {
  const block = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/u.exec(plist)?.[1] ?? ''
  return [...block.matchAll(/<string>([\s\S]*?)<\/string>/gu)].map(match => unescapeXml(match[1] as string))
}

/** Return one top-level string value from the rendered job. */
function plistString(plist: string, key: string): string | undefined {
  const match = new RegExp(`<key>${key}</key>\\s*<string>([\\s\\S]*?)</string>`, 'u').exec(plist)
  return match === null ? undefined : unescapeXml(match[1] as string)
}

/** Return the environment the rendered job hands its program. */
function environmentVariables(plist: string): Record<string, string> {
  const block = /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/u.exec(plist)?.[1] ?? ''
  const pairs = [...block.matchAll(/<key>([^<]+)<\/key>\s*<string>([\s\S]*?)<\/string>/gu)]
  return Object.fromEntries(pairs.map(match => [match[1] as string, unescapeXml(match[2] as string)]))
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
    const timer = setTimeout(() => { finish(new Error('generated job request timed out')) }, 8_000)
    socket.on('error', (error: Error) => { finish(error) })
    socket.on('connect', () => { socket.write(`${JSON.stringify(frame)}\n`) })
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const end = buffer.indexOf('\n')
      if (end >= 0) finish(undefined, JSON.parse(buffer.slice(0, end)) as Record<string, unknown>)
    })
  })
}

/**
 * Render one broker job for a scratch root, stage exactly the installer's file
 * set into its implementation root, and run the rendered program.
 */
async function generatedBrokerJob(replayMode?: 'guarded' | 'guard-removed', memory = false) {
  const root = mkdtempSync(join(tmpdir(), 'aukora-generated-'))
  cleanups.push(async () => { rmSync(root, { recursive: true, force: true }) })
  const rootKey = generateKeyPairSync('ed25519')
  const brokerKey = generateKeyPairSync('ed25519')
  const terminalKey = generateKeyPairSync('ed25519')
  const pem = (key: ReturnType<typeof generateKeyPairSync>): string =>
    key.publicKey.export({ type: 'spki', format: 'pem' }).toString()

  const implementationRoot = join(root, 'implementation')
  const reviewDirectory = join(root, 'review')
  const replay: SettlementReplay | undefined = replayMode === undefined ? undefined : {
    frame: join(root, 'authorized-frame.json'),
    mode: join(root, 'replay-mode'),
    observations: join(root, 'settlement-observations.jsonl'),
  }
  if (replay !== undefined) writeFileSync(replay.mode, 'capture', { flag: 'wx', mode: 0o600 })
  // The broker re-checks its own state and route custody at startup, so the
  // scratch tree is created at the modes it requires rather than at the umask.
  for (const path of [join(root, 'state'), reviewDirectory]) {
    mkdirSync(path, { recursive: true })
    chmodSync(path, 0o700)
  }
  // The installed broker publishes its route to a group, and re-checks that its
  // route parent is exactly 0710 under its own principal before binding.
  for (const path of [join(root, 'run', 'broker'), join(root, 'run', 'issuer')]) {
    mkdirSync(path, { recursive: true })
    chmodSync(path, 0o710)
  }
  chmodSync(root, 0o700)
  // Staged first, so the activation measures the bytes this job will execute.
  for (const file of installedAuthorityFiles()) {
    const destination = join(implementationRoot, file.path)
    mkdirSync(dirname(destination), { recursive: true })
    let bytes: string | Buffer = file.bytes
    if (replay !== undefined && file.path === 'aukora/broker/broker.mjs') {
      bytes = instrumentSettlement(file.bytes.toString('utf8'), replay)
    }
    if (replayMode === 'guard-removed' && file.path === 'aukora/host-dsh/src/grant.mjs') {
      bytes = replaceOnce(file.bytes.toString('utf8'),
        '    if (claimResult === false) return { ok: false, reason: REFUSE.REPLAYED }',
        '    if (claimResult === false) return verified')
    }
    writeFileSync(destination, bytes)
    // Staged read-only, as the installer stages them, and so a permissive umask
    // cannot make a measured member look mutable.
    chmodSync(destination, 0o444)
  }
  const coreMembers = installedAuthorityFiles()
    .map(file => file.path)
    .filter(path => path.startsWith('aukora/') && path.endsWith('.mjs'))
    .slice(0, 64)
  const activation = buildInstalledActivationStatement({
    implementationRoot, interpreter: process.execPath, coreMembers,
    selections: {
      epoch: 1,
      compositionDigest: 'a'.repeat(64),
      proposalCellSha256: 'b'.repeat(64),
      rendererId: 'c'.repeat(64),
      modelEmissionPolicy: 'installed-broker-review',
      issuerId: 'd'.repeat(64),
      brokerId: 'e'.repeat(64),
    },
  })
  // The operator's copy, which the installer verifies, and the copy inside the
  // implementation root, which is the fixed name the entry actually reads.
  const activationStatementFile = join(reviewDirectory, 'activation.json')
  writeFileSync(activationStatementFile, activation.frame)
  writeFileSync(join(implementationRoot, INSTALLED_ACTIVATION_STATEMENT), activation.frame)

  let memoryInputs = {}
  let rootPublicKeyPem = pem(rootKey)
  if (memory) {
    // SCRIPTED identity configuration; this probe reads and never requests approval.
    const control = loadOrCreateLocalAumlokControl(join(root, 'control'))
    const authority = createDeveloperAumlokAuthority(control, { audience: 'broker:generated-test' })
    const context = await authority.selectSubjectAuthority({
      type: 'aukora:authority-request:v1', selectionId: '23'.repeat(16),
      proposalId: 'proposal:generated-memory-test', toolName: 'memory.put',
      operationDigest: '3'.repeat(64), artifactDigest: '4'.repeat(64), activationDigest: activation.digest,
      audience: 'broker:generated-test', resource: 'memory:key:generated-memory-test',
      budget: { calls: 1, bytes: 4096, computeMs: 0, costMicrounits: 0 },
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    }, new AbortController().signal)
    const rootControlStateFile = join(reviewDirectory, 'root-control.json')
    writeFileSync(rootControlStateFile, JSON.stringify(control.activeControl), { mode: 0o600 })
    memoryInputs = {
      kiraRecallPolicy: JSON.stringify({ subject: control.subject, privacy: ['local'] }),
      subjectAuthority: encodeSubjectAuthorityContext(context), rootControlStateFile,
    }
    rootPublicKeyPem = control.ed25519PublicKeyPem
  }
  const inputs = validateInputs({
    brokerLabel: 'com.aukora.broker', brokerUser: '_aukora_broker', brokerGroup: '_aukora_broker_route',
    brokerSocket: join(root, 'run', 'broker', 'b.sock'), brokerStateDir: join(root, 'state'),
    brokerPublicKeyPem: pem(brokerKey), rootPublicKeyPem,
    issuerLabel: 'com.aukora.issuer', issuerUser: '_aukora_issuer', issuerGroup: '_aukora_issuer_route',
    issuerSocket: join(root, 'run', 'issuer', 'i.sock'), issuerStateDir: join(root, 'issuer'),
    issuerKeyFile: join(root, 'issuer', 'root.pem'),
    implementationRoot, nodeBin: process.execPath,
    reviewSocket: join(root, 'run', 'broker', 'r.sock'),
    reviewTerminalPublicKeyFile: join(reviewDirectory, 'terminal.pub'),
    reviewServerId: serverId,
    activationStatementFile,
    activationDigest: activation.digest,
    rendererId: 'c'.repeat(64),
    ...memoryInputs,
  }, CHECKOUT)
  const jobs = renderJobs(inputs)

  writeFileSync(inputs.reviewTerminalPublicKeyFile, pem(terminalKey))

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
      const reply = frame.op === 'admit'
        ? { ok: true }
        : { ok: true, digest: frame.digest,
          signature: sign(null, authorizationSignedMessageFromHex(frame.digest as string), rootKey.privateKey).toString('base64') }
      socket.end(`${JSON.stringify(reply)}\n`)
    })
  })
  await new Promise<void>((resolve, reject) => { issuer.once('error', reject); issuer.listen(inputs.issuerSocket, resolve) })

  const argv = programArguments(jobs.broker)
  const environment = environmentVariables(jobs.broker)
  // launchd runs the job in the property list's own WorkingDirectory. Inheriting
  // this suite's cwd would put the checkout on the child's relative-resolution
  // path, which the installed daemon never has.
  const workingDirectory = plistString(jobs.broker, 'WorkingDirectory')
  let output = ''
  const launch = (): ChildProcess => {
    const started = spawn(argv[0] as string, argv.slice(1), {
      env: environment, cwd: workingDirectory, stdio: ['ignore', 'pipe', 'pipe'],
    })
    started.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
    started.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
    return started
  }
  let child: ChildProcess = launch()
  const clients: ReviewTransportClient[] = []
  const stop = async (stopped: ChildProcess): Promise<void> => {
    if (stopped.exitCode !== null || stopped.signalCode !== null) return
    const exited = new Promise<void>((resolve) => { stopped.once('exit', () => { resolve() }) })
    const force = setTimeout(() => { stopped.kill('SIGKILL') }, 1_000)
    stopped.kill('SIGTERM')
    try { await exited } finally { clearTimeout(force) }
  }
  cleanups.push(async () => {
    for (const client of clients) await client.close()
    await stop(child)
    for (const peer of peers) peer.destroy()
    if (issuer.listening) await new Promise<void>((resolve) => { issuer.close(() => { resolve() }) })
  })

  const waitForRoute = async (): Promise<void> => {
    // Bounded, but wide enough that several subprocess specs running in
    // parallel cannot make readiness look like failure.
    for (let attempt = 0; attempt < 900 && !existsSync(inputs.brokerSocket); attempt++) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`generated broker job exited ${String(child.exitCode ?? child.signalCode)}: ${output}`)
      }
      await delay(20)
    }
  }
  await waitForRoute()
  return {
    inputs, argv, environment, workingDirectory, activation, replay, stateDir: inputs.brokerStateDir,
    get child() { return child },
    /** Stop this job and relaunch it over the same state directory. */
    async restart() {
      const stopped = child
      await stop(stopped)
      // Termination confirmed before relaunching, so the second process cannot
      // be serving beside the first.
      expect(stopped.exitCode !== null || stopped.signalCode !== null).toBe(true)
      rmSync(inputs.brokerSocket, { force: true })
      child = launch()
      await waitForRoute()
      return stopped
    },
    output: () => output,
    async terminal() {
      const client = await connectReviewTransport({
        socketPath: inputs.reviewSocket, role: 'broker', serverId,
        terminalPrivateKey: terminalKey.privateKey, timeoutMs: 4_000, review: async (): Promise<'approved'> => 'approved',
      })
      clients.push(client)
      return client
    },
  }
}

// A launchd-generated job is a macOS artifact: the rendered environment sets
// group socket access, and the broker then requires its route parent to be
// exactly 0710 under its own principal. Guarded like the other macOS-only
// launchd specs rather than asserted against a platform where the installed
// pair does not exist.
describe.skipIf(process.platform !== 'darwin')('generated broker job', () => {
  it('carries configured memory through the rendered plist into a detached broker and its replacement', async () => {
    const job = await generatedBrokerJob(undefined, true)
    expect(job.environment.AUKORA_KIRA_RECALL_POLICY).toBe(job.inputs.kiraRecallPolicy)
    expect(job.environment.AUKORA_SUBJECT_AUTHORITY_B64).toBe(job.inputs.subjectAuthority)
    expect(job.environment.AUKORA_ROOT_CONTROL_STATE_FILE).toBe(job.inputs.rootControlStateFile)
    const recall = await request(job.inputs.brokerSocket, { op: 'kira.recall' })
    expect(recall).toMatchObject({ ok: true, result: { status: 'empty' }, privacy: ['local'] })
    const control = readFileSync(join(job.stateDir, 'root-control.json'))
    const previous = await job.restart()
    expect(job.child.pid).not.toBe(previous.pid)
    expect(await request(job.inputs.brokerSocket, { op: 'kira.recall' })).toEqual(recall)
    expect(readFileSync(join(job.stateDir, 'root-control.json'))).toEqual(control)
  })

  it('runs the rendered program from the staged root and binds both routes', async () => {
    const job = await generatedBrokerJob()
    // The program under test is the one the property list names, not a path
    // this test chose.
    expect(job.argv).toEqual([process.execPath, join(job.inputs.implementationRoot, 'scripts', 'launchd-broker-entry.mjs')])
    expect(job.environment.AUKORA_REVIEW_SOCKET).toBe(job.inputs.reviewSocket)
    expect(job.environment.AUKORA_REVIEW_SERVER_ID).toBe(serverId)
    expect(job.workingDirectory).toBe(job.inputs.brokerStateDir)
    expect(existsSync(job.inputs.brokerSocket)).toBe(true)

    // A governed session opens, which the unreviewed broker refuses. The review
    // route therefore reached the entry from the generated environment.
    const opened = await request(job.inputs.brokerSocket, { op: 'proposal.open' })
    expect(opened).toMatchObject({ ok: true })
    await job.terminal()
  })

  it('settles one reviewed, issuer-authorized effect under its measured activation', async () => {
    // The whole path in one process: the rendered program, under the activation
    // its retained statement measures, reviewed on the terminal route and
    // authorized by the issuer, settling one memory effect into Aura.
    const job = await generatedBrokerJob()
    await job.terminal()
    const opened = await request(job.inputs.brokerSocket, { op: 'proposal.open' })
    const deposited = await request(job.inputs.brokerSocket, {
      op: 'proposal.deposit', proposalNamespace: opened.proposalNamespace,
      callId: 'generated-job', toolName: 'memory.put',
      arguments: { key: 'generated-job-test', value: { scripted: true } },
    })
    let status: Record<string, unknown> = deposited
    for (let attempt = 0; attempt < 200; attempt++) {
      status = await request(job.inputs.brokerSocket, {
        op: 'proposal.status', proposalNamespace: opened.proposalNamespace, proposalId: deposited.proposalId,
      })
      if (status.state !== 'PENDING') break
      await delay(10)
    }
    expect(status).toMatchObject({ ok: true, state: 'SETTLED' })
    // One Aura row, one spent nonce, one stored object: the effect happened
    // exactly once, under the activation the statement measures.
    expect({
      aura: readFileSync(join(job.stateDir, 'aura.jsonl'), 'utf8').split('\n').filter(Boolean).length,
      nonces: entries(join(job.stateDir, 'nonces')),
      objects: entries(join(job.stateDir, 'memory', 'objects')),
    }).toEqual({ aura: 1, nonces: 1, objects: 1 })
  })

  it('retains its nonce records and settled evidence across broker replacement', async () => {
    // The installed-shaped counterpart of the organism's restart arrow: the
    // process that settled is gone, a new one serves the same state directory,
    // and the evidence that the effect already happened is still there.
    const job = await generatedBrokerJob()
    await job.terminal()
    const opened = await request(job.inputs.brokerSocket, { op: 'proposal.open' })
    const deposited = await request(job.inputs.brokerSocket, {
      op: 'proposal.deposit', proposalNamespace: opened.proposalNamespace,
      callId: 'generated-restart', toolName: 'memory.put',
      arguments: { key: 'generated-restart-test', value: { scripted: true } },
    })
    let status: Record<string, unknown> = deposited
    for (let attempt = 0; attempt < 200; attempt++) {
      status = await request(job.inputs.brokerSocket, {
        op: 'proposal.status', proposalNamespace: opened.proposalNamespace, proposalId: deposited.proposalId,
      })
      if (status.state !== 'PENDING') break
      await delay(10)
    }
    expect(status).toMatchObject({ ok: true, state: 'SETTLED' })
    const settled = {
      aura: readFileSync(join(job.stateDir, 'aura.jsonl'), 'utf8'),
      nonces: readdirSync(join(job.stateDir, 'nonces')),
    }
    expect(settled.nonces).toHaveLength(1)

    const stopped = await job.restart()
    expect(stopped.pid).not.toBe(job.child.pid)
    // Retained bytes alone do not prove that another admission refuses replay.
    expect(readdirSync(join(job.stateDir, 'nonces'))).toEqual(settled.nonces)
    expect(readFileSync(join(job.stateDir, 'aura.jsonl'), 'utf8')).toBe(settled.aura)
    expect(entries(join(job.stateDir, 'memory', 'objects'))).toBe(1)

    // The relaunched job serves under the same measured activation.
    expect(await request(job.inputs.brokerSocket, { op: 'proposal.open' })).toMatchObject({ ok: true })
  })

  /** Execute the same captured v4 authorization in two distinct broker processes. */
  async function replayAfterReplacement(mode: 'guarded' | 'guard-removed') {
    const job = await generatedBrokerJob(mode)
    const replay = job.replay
    if (replay === undefined) throw new Error('generated replay fixture was not instrumented')
    const submit = async (key: string): Promise<Record<string, unknown>> => {
      const opened = await request(job.inputs.brokerSocket, { op: 'proposal.open' })
      expect(opened).toMatchObject({ ok: true })
      const deposited = await request(job.inputs.brokerSocket, {
        op: 'proposal.deposit', proposalNamespace: opened.proposalNamespace,
        callId: key, toolName: 'memory.put', arguments: { key, value: { scripted: true } },
      })
      let result = deposited
      for (let attempt = 0; attempt < 200; attempt++) {
        result = await request(job.inputs.brokerSocket, {
          op: 'proposal.status', proposalNamespace: opened.proposalNamespace, proposalId: deposited.proposalId,
        })
        if (result.state !== 'PENDING') return result
        await delay(10)
      }
      throw new Error(`generated proposal did not complete: ${JSON.stringify(result)}`)
    }
    await job.terminal()
    expect(await submit('generated-v4-replay')).toMatchObject({ ok: true, state: 'SETTLED' })
    const before = settledBytes(job.stateDir)
    expect(Object.keys(before.nonces)).toHaveLength(1)
    expect(Object.keys(before.objects)).toHaveLength(1)
    const captured = readFileSync(replay.frame, 'utf8')
    const stopped = await job.restart()
    expect(stopped.pid).not.toBe(job.child.pid)
    expect(settledBytes(job.stateDir)).toEqual(before)
    await job.terminal()
    writeFileSync(replay.mode, 'replay')
    const result = await submit('generated-v4-replay')
    const observations = readFileSync(replay.observations, 'utf8').trimEnd().split('\n')
      .map(line => JSON.parse(line) as { pid: number; frame: string })
    expect(observations).toEqual([
      { pid: stopped.pid, frame: captured },
      { pid: job.child.pid, frame: captured },
    ])
    expect(readFileSync(replay.frame, 'utf8')).toBe(captured)
    return { job, replay, result, before, submit }
  }

  it('refuses an instrumented v4 replay after broker replacement and settles fresh authority', async () => {
    const { job, replay, result, before, submit } = await replayAfterReplacement('guarded')
    expectReplayRefused(result)
    expect(settledBytes(job.stateDir)).toEqual(before)
    expect(entries(join(job.stateDir, 'intents'))).toBe(0)

    writeFileSync(replay.mode, 'fresh')
    expect(await submit('generated-v4-fresh')).toMatchObject({ ok: true, state: 'SETTLED' })
    const fresh = settledBytes(job.stateDir)
    expect(Object.keys(fresh.nonces)).toHaveLength(2)
    expect(Object.keys(fresh.objects)).toHaveLength(2)
    expect(fresh.aura.toString('utf8').split('\n').filter(Boolean)).toHaveLength(2)
    expect(fresh.aura.subarray(0, before.aura.length)).toEqual(before.aura)
    for (const [name, bytes] of Object.entries(before.nonces)) expect(fresh.nonces[name]).toEqual(bytes)
    for (const [name, bytes] of Object.entries(before.objects)) expect(fresh.objects[name]).toEqual(bytes)
  })

  it('detects removal of the v4 replay guard in a disposable staged copy', async () => {
    const { job, result, before } = await replayAfterReplacement('guard-removed')
    expect(() => { expectReplayRefused(result) })
      .toThrow('spent v4 authorization must refuse after broker replacement')
    expect(result).toMatchObject({ ok: true, state: 'SETTLED' })
    const repeated = settledBytes(job.stateDir)
    expect(repeated.nonces).toEqual(before.nonces)
    expect(repeated.aura.toString('utf8').split('\n').filter(Boolean)).toHaveLength(2)
    expect(repeated.aura.equals(before.aura)).toBe(false)
  })
})
