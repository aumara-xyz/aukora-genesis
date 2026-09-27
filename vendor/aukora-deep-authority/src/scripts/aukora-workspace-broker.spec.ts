/** Real broker and issuer processes with scripted review; no attended approval or OS-custody claim. */
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { readVerifiedChain } from '../aukora/aura/record.mjs'
import { spawnBroker, type BrokerReviewRequest } from '../aukora/broker/broker.mjs'
import { loadOrCreateLocalAumlokControl } from '../aukora/identity/local-control-store.mjs'
import { createDeveloperAumlokAuthority } from '../aukora/supervisor/developer-aumlok.mjs'
import { BrokerProposalClient } from '../packages/governed/memory-put/src/proposal-client.ts'

const ACTIVATION = 'ab'.repeat(32)
const RENDERER = 'cd'.repeat(32)
const ISSUER = fileURLToPath(new URL('../aukora/issuer/issuer.mjs', import.meta.url))
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

interface Fixture {
  directory: string
  stateDir: string
  workspace: string
  brokerSocket: string
  namespace: string
  brokerOptions?: Parameters<typeof spawnBroker>[0]
  broker?: ChildProcess
  issuer?: ChildProcess
  reviews: Readonly<BrokerReviewRequest>[]
  issuerPrompts: number
  issuerStderr: string
  brokerStderr: string
}
const fixtures: Fixture[] = []

async function stop(child: ChildProcess | undefined): Promise<void> {
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off('exit', done)
      reject(new Error('test-owned child did not exit'))
    }, 5000)
    function done(): void { clearTimeout(timer); resolve() }
    child.once('exit', done)
    child.kill('SIGTERM')
  })
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0).reverse()) {
    await stop(fixture.broker)
    await stop(fixture.issuer)
    rmSync(fixture.directory, { recursive: true, force: true })
  }
})

function request(socketPath: string, frame: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    let text = ''
    let finished = false
    const finish = (action: () => void): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      socket.destroy()
      action()
    }
    const timer = setTimeout(() => { finish(() => { reject(new Error('broker request timed out')) }) }, 5000)
    socket.once('connect', () => socket.write(`${JSON.stringify(frame)}\n`))
    socket.once('error', (error) => { finish(() => { reject(error) }) })
    socket.once('close', () => { finish(() => { reject(new Error('broker closed before replying')) }) })
    socket.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8')
      const cut = text.indexOf('\n')
      if (cut === -1) return
      finish(() => {
        try { resolve(JSON.parse(text.slice(0, cut)) as Record<string, unknown>) }
        catch (error: unknown) { reject(error instanceof Error ? error : new Error(String(error))) }
      })
    })
  })
}

async function start(
  review: (request: Readonly<BrokerReviewRequest>) => 'approved' | 'denied' | Promise<'approved' | 'denied'> = () => 'approved',
  roots: (fixture: Fixture) => Readonly<Record<string, string>> = fixture => ({ work: fixture.workspace }),
): Promise<Fixture> {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'aukora-workspace-broker-')))
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace, { mode: 0o700 })
  const fixture: Fixture = {
    directory, workspace, stateDir: join(directory, 'state'), brokerSocket: join(directory, 'broker.sock'),
    namespace: '', reviews: [], issuerPrompts: 0, issuerStderr: '', brokerStderr: '',
  }
  fixtures.push(fixture)
  const control = loadOrCreateLocalAumlokControl(join(directory, 'control'))
  const authority = createDeveloperAumlokAuthority(control, { audience: 'broker:primary' })
  const issuerSocket = join(directory, 'issuer.sock')
  const keyFile = join(directory, 'issuer.pem')
  writeFileSync(keyFile, control.record.ed25519PrivateKeyPem, { mode: 0o600, flag: 'wx' })
  fixture.brokerOptions = {
    socketPath: fixture.brokerSocket,
    stateDir: fixture.stateDir,
    rootPublicKeyPem: control.ed25519PublicKeyPem,
    issuerSocket,
    activationDigest: ACTIVATION,
    rendererId: RENDERER,
    rootControlState: control.activeControl,
    selectSubjectAuthority: authority.selectSubjectAuthority,
    subjectAuthorityExpectation: { ...authority.subjectAuthorityExpectation, activationDigest: ACTIVATION },
    workspaceRoots: roots(fixture),
    review: async (proposal) => {
      fixture.reviews.push(proposal)
      return await review(proposal)
    },
  }
  fixture.broker = await spawnBroker(fixture.brokerOptions)
  fixture.broker.stderr?.on('data', (chunk: Buffer) => { fixture.brokerStderr += chunk.toString('utf8') })
  const status = await request(fixture.brokerSocket, { op: 'status' })
  if (typeof status.receiptKeyId !== 'string') throw new Error('broker omitted receipt key identity')
  fixture.issuer = spawn(process.execPath, [ISSUER], {
    env: {
      AUKORA_ISSUER_SOCKET: issuerSocket,
      AUKORA_ISSUER_KEY_FILE: keyFile,
      AUKORA_EXPECTED_RECEIPT_KEY_ID: status.receiptKeyId,
    },
    stdio: ['pipe', 'ignore', 'pipe'],
  })
  let pending = ''
  fixture.issuer.stderr?.on('data', (chunk: Buffer) => {
    pending += chunk.toString('utf8')
    fixture.issuerStderr += chunk.toString('utf8')
    for (;;) {
      const match = /\+- approve\? type "yes ([0-9a-f]{16})": /.exec(pending)
      if (match === null) return
      pending = pending.slice(match.index + match[0].length)
      fixture.issuerPrompts += 1
      fixture.issuer?.stdin?.write(`yes ${match[1]}\n`)
    }
  })
  await expect.poll(() => {
    if (fixture.issuer?.exitCode !== null) throw new Error(`issuer exited: ${fixture.issuerStderr}`)
    return existsSync(issuerSocket)
  }, { timeout: 5000 }).toBe(true)
  const opened = await request(fixture.brokerSocket, { op: 'proposal.open' })
  if (typeof opened.proposalNamespace !== 'string') throw new Error('broker omitted proposal namespace')
  fixture.namespace = opened.proposalNamespace
  return fixture
}

function deposit(fixture: Fixture, callId: string, toolName: string, args: unknown) {
  return request(fixture.brokerSocket, {
    op: 'proposal.deposit', proposalNamespace: fixture.namespace, callId, toolName, arguments: args,
  })
}

async function settled(fixture: Fixture, admission: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (admission.state !== 'PENDING') return admission
  const deadline = Date.now() + 7000
  while (Date.now() < deadline) {
    const status = await request(fixture.brokerSocket, {
      op: 'proposal.status', proposalNamespace: fixture.namespace, proposalId: admission.proposalId,
    })
    if (status.state !== 'PENDING') return status
    await pause(10)
  }
  throw new Error(`proposal remained pending; broker=${fixture.brokerStderr}; issuer=${fixture.issuerStderr}`)
}

function chain(fixture: Fixture) {
  const result = readVerifiedChain(join(fixture.stateDir, 'aura.jsonl'))
  if (!result.ok) throw new Error(`Aura verification failed: ${result.reason}`)
  return result
}

function auraBytes(fixture: Fixture): Buffer | null {
  const path = join(fixture.stateDir, 'aura.jsonl')
  return existsSync(path) ? readFileSync(path) : null
}

describe.runIf(process.platform !== 'win32')('workspace.patch through the broker proposal route', () => {
  it('uses the existing proposal client for both effects without exposing grants', async () => {
    const fixture = await start()
    const client = new BrokerProposalClient({ socketPath: fixture.brokerSocket })
    try {
      const signal = new AbortController().signal
      const result = await client.settleWorkspacePatch('client-patch', {
        workspace: 'work', path: 'client.txt', beforeSha256: null, content: 'approved bytes\n',
      }, signal)
      expect(result).toMatchObject({ ok: true, state: 'SETTLED' })
      expect(Object.keys(result).sort()).toEqual(['ok', 'proposalId', 'state'])
      expect(readFileSync(join(fixture.workspace, 'client.txt'), 'utf8')).toBe('approved bytes\n')
      await expect(client.settle('client-memory', { key: 'client-note', value: 'retained' }, signal)).resolves.toMatchObject({ ok: true, state: 'SETTLED' })
      expect(fixture.reviews).toHaveLength(2)
      expect(fixture.issuerPrompts).toBe(2)
    } finally { client.close() }
  })
  it('refuses a workspace root containing broker state', async () => {
    await expect(start(() => 'approved', fixture => ({ work: fixture.directory })))
      .rejects.toThrow('broker:workspace-overlaps-state')
  }, 15000)

  it('refuses the filesystem root as a workspace containing broker state', async () => {
    await expect(start(() => 'approved', () => ({ work: '/' })))
      .rejects.toThrow('broker:workspace-overlaps-state')
  }, 15000)

  it('refuses to retarget a persisted workspace alias on restart and accepts the original map', async () => {
    const fixture = await start()
    if (fixture.brokerOptions === undefined) throw new Error('fixture omitted broker options')
    const mapping = join(fixture.stateDir, 'workspace-roots.json')
    const retainedMap = readFileSync(mapping)
    await stop(fixture.broker)
    const other = join(fixture.directory, 'other-workspace')
    mkdirSync(other, { mode: 0o700 })
    await expect(spawnBroker({ ...fixture.brokerOptions, workspaceRoots: { work: other } }))
      .rejects.toThrow('broker:workspace-roots-mismatch')
    expect(readFileSync(mapping)).toEqual(retainedMap)
    fixture.broker = await spawnBroker(fixture.brokerOptions)
    const opened = await request(fixture.brokerSocket, { op: 'proposal.open' })
    if (typeof opened.proposalNamespace !== 'string') throw new Error('restarted broker omitted namespace')
    fixture.namespace = opened.proposalNamespace
    const result = await settled(fixture, await deposit(fixture, 'after-restart', 'workspace.patch', {
      workspace: 'work', path: 'restart.txt', beforeSha256: null, content: 'original mapping',
    }))
    expect(result).toMatchObject({ ok: true, state: 'SETTLED' })
    expect(readFileSync(join(fixture.workspace, 'restart.txt'), 'utf8')).toBe('original mapping')
    expect(existsSync(join(other, 'restart.txt'))).toBe(false)
    expect(chain(fixture).count).toBe(1)
  }, 15000)

  it('settles workspace and memory effects under one v5 authority and Aura chain', async () => {
    const fixture = await start()
    const args = { workspace: 'work', path: 'hello.txt', beforeSha256: null, content: 'hello\n世界\n' }
    const workspace = await settled(fixture, await deposit(fixture, 'workspace-create', 'workspace.patch', args))
    expect(workspace, `${JSON.stringify(workspace)}\n${fixture.issuerStderr}\n${fixture.brokerStderr}`).toMatchObject({ ok: true, state: 'SETTLED' })
    expect(readFileSync(join(fixture.workspace, args.path), 'utf8')).toBe(args.content)
    const memory = await settled(fixture, await deposit(fixture, 'memory-note', 'memory.put', { key: 'note', value: 'workspace completed' }))
    expect(memory, `${JSON.stringify(memory)}\n${fixture.issuerStderr}\n${fixture.brokerStderr}`).toMatchObject({ ok: true, state: 'SETTLED' })
    const retained = chain(fixture)
    expect(retained.count).toBe(2)
    expect(retained.entries[0]).toMatchObject({
      verdict: 'settled', sequence: 1, toolName: 'workspace.patch', workspace: 'work', relativePath: args.path,
      beforeSha256: null, contentSha256: hash(args.content), bytes: Buffer.byteLength(args.content, 'utf8'),
    })
    expect(retained.entries[1]).toMatchObject({ verdict: 'settled', sequence: 2, key: 'note' })
    expect(fixture.reviews).toHaveLength(2)
    expect(fixture.issuerPrompts).toBe(2)
  }, 15000)

  it('denies a reviewed replacement without changing either the target or retained evidence', async () => {
    const fixture = await start(() => 'denied')
    const beforeAura = auraBytes(fixture)
    const path = join(fixture.workspace, 'denied.txt')
    writeFileSync(path, 'original', { mode: 0o600, flag: 'wx' })
    const result = await settled(fixture, await deposit(fixture, 'deny', 'workspace.patch', {
      workspace: 'work', path: 'denied.txt', beforeSha256: hash('original'), content: 'replacement',
    }))
    expect(result).toMatchObject({ ok: false, state: 'REFUSED', reason: 'broker:review-denied' })
    expect(readFileSync(path, 'utf8')).toBe('original')
    expect(auraBytes(fixture)).toEqual(beforeAura)
    expect(fixture.reviews).toHaveLength(1)
    expect(fixture.issuerPrompts).toBe(0)
  }, 15000)

  it('refuses a preimage changed while review was pending', async () => {
    let target = ''
    const fixture = await start(() => {
      writeFileSync(target, 'owner edit during review')
      return 'approved'
    })
    target = join(fixture.workspace, 'stale.txt')
    const beforeAura = auraBytes(fixture)
    writeFileSync(target, 'original', { mode: 0o600, flag: 'wx' })
    const result = await settled(fixture, await deposit(fixture, 'stale', 'workspace.patch', {
      workspace: 'work', path: 'stale.txt', beforeSha256: hash('original'), content: 'agent replacement',
    }))
    expect(result).toMatchObject({ ok: false, state: 'REFUSED', reason: 'workspace.patch:preimage-mismatch' })
    expect(readFileSync(target, 'utf8')).toBe('owner edit during review')
    expect(auraBytes(fixture)).toEqual(beforeAura)
    expect(fixture.reviews).toHaveLength(1)
  }, 15000)

  it('returns one settlement for an identical retry and refuses a new stale request', async () => {
    const fixture = await start()
    const args = { workspace: 'work', path: 'retry.txt', beforeSha256: null, content: 'first' }
    const first = await settled(fixture, await deposit(fixture, 'same-call', 'workspace.patch', args))
    expect(first).toMatchObject({ ok: true, state: 'SETTLED' })
    expect(await deposit(fixture, 'same-call', 'workspace.patch', args)).toEqual(first)
    const replay = await settled(fixture, await deposit(fixture, 'new-call', 'workspace.patch', args))
    expect(replay).toMatchObject({ ok: false, state: 'REFUSED', reason: 'workspace.patch:preimage-mismatch' })
    expect(readFileSync(join(fixture.workspace, args.path), 'utf8')).toBe('first')
    expect(chain(fixture).count).toBe(1)
    expect(fixture.reviews).toHaveLength(1)
    expect(fixture.issuerPrompts).toBe(1)
  }, 15000)

  it('refuses unconfigured workspaces and traversal before review or execution', async () => {
    const fixture = await start()
    const beforeAura = auraBytes(fixture)
    const unknown = await settled(fixture, await deposit(fixture, 'other', 'workspace.patch', {
      workspace: 'other', path: 'outside.txt', beforeSha256: null, content: 'unapproved',
    }))
    expect(unknown).toMatchObject({ ok: false, state: 'REFUSED', reason: 'workspace.patch:workspace-not-configured' })
    const traversal = await deposit(fixture, 'traversal', 'workspace.patch', {
      workspace: 'work', path: '../outside.txt', beforeSha256: null, content: 'unapproved',
    })
    expect(traversal).toMatchObject({ ok: false, state: 'REFUSED', reason: 'broker:arguments-not-exact' })
    expect(existsSync(join(fixture.directory, 'outside.txt'))).toBe(false)
    expect(auraBytes(fixture)).toEqual(beforeAura)
    expect(fixture.reviews).toHaveLength(0)
    expect(fixture.issuerPrompts).toBe(0)
  }, 15000)
})
