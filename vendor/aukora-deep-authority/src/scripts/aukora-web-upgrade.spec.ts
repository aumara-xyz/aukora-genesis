import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs, { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { beginWebActivationRollback, beginWebActivationUpgrade } from '../aukora/broker/web-activation-upgrade.mjs'
import { provisionBrokerIdentity, spawnBroker } from '../aukora/broker/broker.mjs'
import { loadLocalAumlokControl, loadOrCreateLocalAumlokControl } from '../aukora/identity/local-control-store.mjs'
import { createDeveloperAumlokAuthority } from '../aukora/supervisor/developer-aumlok.mjs'
import { stageKiraMemoryRecord } from '../aukora/kira/stage.mjs'
import { ACTIVATION_STATEMENT_DOMAIN, activationDigest } from '../aukora/activation/statement.mjs'
import { readActivationBinding } from '../aukora/activation/broker-state.mjs'
import { UPGRADED_BINDING_DOMAIN, WEB_UPGRADE_SIGNATURE_DOMAIN, parseWebUpgrade, webUpgradeBytes, type WebActivationUpgrade } from '../aukora/activation/web-upgrade-record.mjs'
import { createWebActivationRollback, webRollbackBytes, verifyWebRollbackBundle, WEB_ROLLBACK_BUNDLE_DOMAIN,
  SIGNED_WEB_ROLLBACK_DOMAIN, WEB_ROLLBACK_SIGNATURE_DOMAIN, type WebActivationRollback } from '../aukora/activation/web-rollback-record.mjs'
import { receiptKeyIdForPublicKey } from '../aukora/host-dsh/src/grant.mjs'
import { startWebIssuer } from '../examples/headless-agent/tests/fixtures/web-transaction-issuer.ts'
import { readReceipt, verifyReceiptSignature } from '../aukora/broker/receipt.mjs'

const OLD = 'ab'.repeat(32)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  syncBuiltinESMExports()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function request(path: string, value: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path)
    let pending = ''
    const timer = setTimeout(() => socket.destroy(new Error('fixture request timeout')), 8_000)
    socket.once('error', reject)
    socket.once('close', () => { clearTimeout(timer); reject(new Error('fixture closed without reply')) })
    socket.once('connect', () => socket.write(`${JSON.stringify(value)}\n`))
    socket.on('data', (chunk: Buffer) => {
      pending += chunk.toString()
      if (!pending.includes('\n')) return
      try { resolve(JSON.parse(pending.split('\n')[0]!) as Record<string, unknown>) }
      catch (error) { reject(error instanceof Error ? error : new Error(String(error))) }
      socket.destroy()
    })
  })
}

/** Independent retained-byte and file-identity witness, excluding only the activation and active lease. */
function witness(root: string, prefix = ''): unknown[] {
  return readdirSync(join(root, prefix)).sort().flatMap((name): unknown[] => {
    if (prefix === '' && ['activation.json', '.broker-active.lock'].includes(name)) return []
    const relative = join(prefix, name)
    const stat = lstatSync(join(root, relative))
    return stat.isDirectory() ? witness(root, relative) : [{ relative, inode: stat.ino, mode: stat.mode,
      bytes: readFileSync(join(root, relative)).toString('base64') }]
  })
}

async function fixture(populated = true) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'web-upgrade-')))
  const state = join(root, 'state')
  const workspace = join(root, 'workspace')
  mkdirSync(workspace, { mode: 0o700 })
  const socket = join(root, 'broker.sock')
  const issuerSocket = join(root, 'issuer.sock')
  const control = loadOrCreateLocalAumlokControl(join(root, 'control'))
  const authority = createDeveloperAumlokAuthority(control, { audience: 'broker:source-launch' })
  let reviews = 0
  let decision: 'approved' | 'denied' = 'approved'
  let broker: Awaited<ReturnType<typeof spawnBroker>> | undefined
  const services: { issuer?: Awaited<ReturnType<typeof startWebIssuer>> } = {}
  const stop = async () => {
    if (broker !== undefined) {
      const child = broker
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM')
        await new Promise<void>((resolve) => { child.once('exit', () => { resolve() }) })
      }
      broker = undefined
    }
  }
  cleanups.push(async () => { await stop(); await services.issuer?.stop(); rmSync(root, { recursive: true, force: true }) })
  const start = async (digest: string) => {
    broker = await spawnBroker({ socketPath: socket, stateDir: state, issuerSocket,
      workspaceRoots: { project: workspace },
      rootPublicKeyPem: control.ed25519PublicKeyPem, rootControlState: control.activeControl,
      selectSubjectAuthority: authority.selectSubjectAuthority,
      subjectAuthorityExpectation: { ...authority.subjectAuthorityExpectation, activationDigest: digest },
      activationDigest: digest, rendererId: 'cd'.repeat(32),
      kiraRecallPolicy: { subject: control.subject, privacy: ['private'] },
      review: () => { reviews += 1; return decision }, // SCRIPTED; no human receipt is claimed.
    })
  }
  await start(OLD)
  const status = await request(socket, { op: 'status' })
  const key = join(root, 'issuer.pem')
  writeFileSync(key, control.record.ed25519PrivateKeyPem, { mode: 0o600 })
  services.issuer = await startWebIssuer(issuerSocket, key, String(status.receiptKeyId))
  for (let count = 0; !existsSync(issuerSocket); count += 1) {
    if (count === 200) throw new Error('fixture issuer did not start')
    await delay(10)
  }
  let calls = 0
  const submit = async (toolName: string, args: unknown) => {
    const opened = await request(socket, { op: 'proposal.open' })
    const deposited = await request(socket, { op: 'proposal.deposit', proposalNamespace: opened.proposalNamespace,
      callId: `upgrade-test-${++calls}`, toolName, arguments: args })
    expect(deposited.ok, JSON.stringify(deposited)).toBe(true)
    for (let count = 0; count < 800; count += 1) {
      const result = await request(socket, { op: 'proposal.status', proposalNamespace: opened.proposalNamespace, proposalId: deposited.proposalId })
      if (result.state !== 'PENDING') return result
      await delay(10)
    }
    throw new Error('fixture proposal did not finish')
  }
  const put = async (text: string) => {
    const record = stageKiraMemoryRecord({ subject: control.subject, kind: 'observation', source: [], links: [],
      privacy: 'private', createdAt: '2026-09-07T00:00:00Z', content: { text } })
    return submit('memory.put', record.memoryPut)
  }
  const patch = (path: string, content: string, beforeSha256: string | null = null) => submit('workspace.patch', {
    workspace: 'project', path, content, beforeSha256,
  })
  if (populated) expect(await put('retained')).toMatchObject({ ok: true, state: 'SETTLED' })
  const recall = await request(socket, { op: 'kira.recall' })
  const next = {
    domain: ACTIVATION_STATEMENT_DOMAIN, epoch: 1,
    coreManifest: { 'aukora/broker/broker.mjs': '11'.repeat(32) }, compositionDigest: '22'.repeat(32),
    closure: { executable: { node: '33'.repeat(32) }, resolver: { 'owner-review-configuration': '44'.repeat(32) } },
    proposalCellSha256: '55'.repeat(32), rendererId: 'cd'.repeat(32),
    modelEmissionPolicy: 'aukora:model-emission:parent-staged-web:v1',
    issuerId: receiptKeyIdForPublicKey(control.ed25519PublicKeyPem), brokerId: String(status.receiptKeyId),
  }
  const signed = (operation: WebActivationUpgrade) => {
    const bytes = webUpgradeBytes(operation)
    return { domain: UPGRADED_BINDING_DOMAIN, operation, signatures: {
      ed25519: sign(null, bytes, control.ed25519PrivateKey).toString('hex'),
      mlDsa65: Buffer.from(ml_dsa65.sign(bytes, control.mlDsa65SecretKey,
        { context: Buffer.from(WEB_UPGRADE_SIGNATURE_DOMAIN) })).toString('hex'),
    } }
  }
  const signedRollback = (operation: WebActivationRollback) => {
    const bytes = webRollbackBytes(operation)
    return { domain: SIGNED_WEB_ROLLBACK_DOMAIN, operation, signatures: {
      ed25519: sign(null, bytes, control.ed25519PrivateKey).toString('hex'),
      mlDsa65: Buffer.from(ml_dsa65.sign(bytes, control.mlDsa65SecretKey,
        { context: Buffer.from(WEB_ROLLBACK_SIGNATURE_DOMAIN) })).toString('hex'),
    } }
  }
  return { root, state, socket, workspace, next, signed, signedRollback, control, start, stop, put, patch, recall,
    reviews: () => reviews, deny: () => { decision = 'denied' } }
}

describe.skipIf(process.platform === 'win32')('attended Web activation upgrade (SCRIPTED controller signatures)', () => {
  it.each([false, true])('upgrades and rolls back retained workspace history with memory=%s', async (memory) => {
    const f = await fixture(memory)
    expect(await f.patch('proof.txt', 'first\n')).toMatchObject({ ok: true, state: 'SETTLED' })
    const first = createHash('sha256').update('first\n').digest('hex')
    expect(await f.patch('proof.txt', 'second\n', first)).toMatchObject({ ok: true, state: 'SETTLED' })
    const recall = await request(f.socket, { op: 'kira.recall' })
    await f.stop()
    const before = witness(f.state)
    const file = witness(f.workspace)
    const session = beginWebActivationUpgrade(f.state, f.next)
    const upgrade = f.signed(session.operation)
    const rollback = createWebActivationRollback(session.operation, session.previousBinding)
    const bundle = { domain: WEB_ROLLBACK_BUNDLE_DOMAIN, previousBinding: session.previousBinding,
      upgrade, rollback: f.signedRollback(rollback) }
    expect(session.commit(upgrade)).toMatchObject({ status: 'ACTIVATION_UPGRADED' })
    expect(witness(f.state)).toEqual(before)
    await f.start(activationDigest(f.next))
    expect(await request(f.socket, { op: 'kira.recall' })).toEqual(recall)
    expect(witness(f.workspace)).toEqual(file)
    await f.stop()
    const recovery = beginWebActivationRollback(f.state, bundle)
    expect(recovery.commit()).toMatchObject({ status: 'ACTIVATION_ROLLED_BACK' })
    expect(readActivationBinding(f.state)).toBe(OLD)
    expect(witness(f.workspace)).toEqual(file)
    expect(readFileSync(join(f.workspace, 'proof.txt'), 'utf8')).toBe('second\n')
  }, 30_000)

  it.each(['changed', 'missing', 'symlink'] as const)('refuses %s latest workspace bytes without changing activation', async (mutation) => {
    const f = await fixture(false)
    expect(await f.patch('proof.txt', 'retained\n')).toMatchObject({ ok: true, state: 'SETTLED' })
    await f.stop()
    const path = join(f.workspace, 'proof.txt')
    if (mutation === 'changed') writeFileSync(path, 'different\n')
    else {
      unlinkSync(path)
      if (mutation === 'symlink') {
        writeFileSync(join(f.root, 'outside.txt'), 'retained\n')
        symlinkSync(join(f.root, 'outside.txt'), path)
      }
    }
    const before = witness(f.state)
    expect(() => beginWebActivationUpgrade(f.state, f.next)).toThrow()
    expect(readActivationBinding(f.state)).toBe(OLD)
    expect(witness(f.state)).toEqual(before)
  })

  it('rechecks workspace bytes between authorization preparation and commit', async () => {
    const f = await fixture(false)
    expect(await f.patch('proof.txt', 'retained\n')).toMatchObject({ ok: true, state: 'SETTLED' })
    await f.stop()
    const session = beginWebActivationUpgrade(f.state, f.next)
    try {
      writeFileSync(join(f.workspace, 'proof.txt'), 'changed\n')
      expect(() => session.commit(f.signed(session.operation))).toThrow()
      expect(readActivationBinding(f.state)).toBe(OLD)
    } finally { session.close() }
  })

  it('authenticates historical workspace receipts without claiming their bytes are current', async () => {
    const f = await fixture(false)
    expect(await f.patch('proof.txt', 'first\n')).toMatchObject({ ok: true, state: 'SETTLED' })
    expect(await f.patch('proof.txt', 'second\n', createHash('sha256').update('first\n').digest('hex')))
      .toMatchObject({ ok: true, state: 'SETTLED' })
    await f.stop()
    const receiptFile = readdirSync(join(f.state, 'receipts'))[0]!
    const receipt = readReceipt({ stateDir: f.state, receiptSha256: receiptFile.slice(0, -5) })
    const key = provisionBrokerIdentity(f.state).brokerPublicKeyPem
    expect(verifyReceiptSignature({ receipt, brokerPublicKeyPem: key })).toEqual({ ok: true })
    expect(verifyReceiptSignature({ receipt: { ...receipt, signature: Buffer.alloc(64).toString('base64') }, brokerPublicKeyPem: key }))
      .toEqual({ ok: false, reason: 'receipt:signature-invalid' })
    expect(verifyReceiptSignature({ receipt: { ...receipt, path: join(f.workspace, 'different.txt') }, brokerPublicKeyPem: key }))
      .toEqual({ ok: false, reason: 'receipt:signature-invalid' })
  })

  it('refuses a workspace mapping that no longer names the signed destination', async () => {
    const f = await fixture(false)
    expect(await f.patch('proof.txt', 'retained\n')).toMatchObject({ ok: true, state: 'SETTLED' })
    await f.stop()
    const other = join(f.root, 'other')
    mkdirSync(other, { mode: 0o700 })
    writeFileSync(join(f.state, 'workspace-roots.json'), JSON.stringify({ project: other }))
    expect(() => beginWebActivationUpgrade(f.state, f.next)).toThrow('upgrade:workspace-destination-mismatch')
    expect(readActivationBinding(f.state)).toBe(OLD)
  })

  it('keeps the populated store and key, rejects old activation, then recalls after a full broker replacement', async () => {
    const f = await fixture()
    expect(() => beginWebActivationUpgrade(f.state, f.next)).toThrow('broker:state-active')
    await f.stop()
    const before = witness(f.state)
    const session = beginWebActivationUpgrade(f.state, f.next)
    const record = f.signed(session.operation)
    expect(session.commit(record)).toMatchObject({ status: 'ACTIVATION_UPGRADED', previousActivation: OLD,
      activationDigest: activationDigest(f.next) })
    expect(witness(f.state)).toEqual(before)
    expect(() => session.commit(record)).toThrow('upgrade:review-closed')
    // An upgraded store is upgradable again, so this no longer refuses on the binding
    // format. Re-proposing the activation it is already bound to is still refused, now by
    // the operation check that forbids a transition to its own predecessor.
    expect(() => beginWebActivationUpgrade(f.state, f.next)).toThrow('upgrade:operation-invalid')
    await expect(f.start(OLD)).rejects.toThrow('broker:activation-state-conflict')
    const reviews = f.reviews()
    await f.start(activationDigest(f.next))
    expect(await request(f.socket, { op: 'kira.recall' })).toEqual(f.recall)
    expect(f.reviews()).toBe(reviews)
    f.deny()
    expect(await f.put('denied-after-upgrade')).toMatchObject({ ok: false, state: 'REFUSED', reason: 'broker:review-denied' })
    expect(witness(f.state)).toEqual(before)
  }, 30_000)

  it('rejects tampered signatures, substituted statements, and changed retained bytes without rebinding', async () => {
    const f = await fixture()
    await f.stop()
    const before = witness(f.state)
    const session = beginWebActivationUpgrade(f.state, f.next)
    try {
      const record = f.signed(session.operation)
      expect(() => session.commit({ ...record, signatures: { ...record.signatures, ed25519: '00'.repeat(64) } })).toThrow('upgrade:signature-invalid')
      expect(() => session.commit({ ...record, signatures: { ...record.signatures, mlDsa65: '00'.repeat(3309) } })).toThrow('upgrade:signature-invalid')
      expect(() => session.commit({ ...record, domain: 'aukora:tool-grant:v5' })).toThrow('upgrade:binding-domain-invalid')
      expect(() => session.commit(f.signed({ ...session.operation, nextStatement: { ...f.next, epoch: 2 } }))).toThrow('upgrade:operation-substituted')
      const clock = vi.spyOn(Date, 'now').mockReturnValue(session.operation.expiresAt * 1000)
      expect(() => session.commit(record)).toThrow('upgrade:approval-expired')
      clock.mockRestore()
      const manifest = Object.fromEntries(Array.from({ length: 256 }, (_, index) => [`entry-${index}-${'x'.repeat(230)}`, 'ab'.repeat(32)]))
      expect(() => parseWebUpgrade({ ...session.operation, nextStatement: { ...f.next, coreManifest: manifest,
        closure: { ...f.next.closure, executable: manifest } } })).toThrow('activation:frame-oversize')
      expect(witness(f.state)).toEqual(before)
      writeFileSync(join(f.state, 'unexpected'), 'changed', { mode: 0o600 })
      expect(() => session.commit(record)).toThrow('upgrade:stale-store')
      expect(readActivationBinding(f.state)).toBe(OLD)
    } finally { session.close() }
    expect(existsSync(join(f.state, '.broker-active.lock'))).toBe(false)
  }, 30_000)

  it('refuses a populated store whose settled nonce burn is missing', async () => {
    const f = await fixture()
    await f.stop()
    const nonceDir = join(f.state, 'nonces')
    expect(readdirSync(nonceDir)).toHaveLength(1)
    unlinkSync(join(nonceDir, readdirSync(nonceDir)[0]!))
    const before = witness(f.state)
    expect(() => beginWebActivationUpgrade(f.state, f.next)).toThrow('upgrade:nonce-evidence-missing')
    expect(witness(f.state)).toEqual(before)
    expect(readActivationBinding(f.state)).toBe(OLD)
  })

  it('refuses an unpopulated store instead of authorizing an empty replacement', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'web-upgrade-empty-')))
    cleanups.push(async () => { rmSync(root, { recursive: true, force: true }) })
    const state = join(root, 'state')
    const control = loadOrCreateLocalAumlokControl(join(root, 'control'))
    const authority = createDeveloperAumlokAuthority(control, { audience: 'broker:source-launch' })
    const broker = await spawnBroker({ socketPath: join(root, 'broker.sock'), stateDir: state,
      issuerSocket: join(root, 'issuer.sock'), rootPublicKeyPem: control.ed25519PublicKeyPem,
      rootControlState: control.activeControl, selectSubjectAuthority: authority.selectSubjectAuthority,
      subjectAuthorityExpectation: { ...authority.subjectAuthorityExpectation, activationDigest: OLD },
      activationDigest: OLD, rendererId: 'cd'.repeat(32),
      kiraRecallPolicy: { subject: control.subject, privacy: ['private'] },
      review: () => 'approved', // SCRIPTED; no human receipt is claimed.
    })
    broker.kill('SIGTERM')
    await new Promise<void>((resolve) => { broker.once('exit', () => { resolve() }) })
    const next = {
      domain: ACTIVATION_STATEMENT_DOMAIN, epoch: 1,
      coreManifest: { 'aukora/broker/broker.mjs': '11'.repeat(32) }, compositionDigest: '22'.repeat(32),
      closure: { executable: { node: '33'.repeat(32) }, resolver: { 'owner-review-configuration': '44'.repeat(32) } },
      proposalCellSha256: '55'.repeat(32), rendererId: 'cd'.repeat(32),
      modelEmissionPolicy: 'aukora:model-emission:parent-staged-web:v1',
      issuerId: receiptKeyIdForPublicKey(control.ed25519PublicKeyPem), brokerId: '66'.repeat(32),
    }
    const before = witness(state)
    expect(() => beginWebActivationUpgrade(state, next)).toThrow('upgrade:populated-history-required')
    expect(witness(state)).toEqual(before)
    expect(readActivationBinding(state)).toBe(OLD)
    expect(existsSync(join(state, '.broker-active.lock'))).toBe(false)
  })

  it.each(['absent', 'empty'] as const)('upgrades explicitly pinned retained identity with %s history without creating evidence', async (history) => {
    const f = await fixture(false)
    await f.stop()
    if (history === 'empty') {
      writeFileSync(join(f.state, 'aura.jsonl'), '', { mode: 0o600 })
      writeFileSync(join(f.state, 'seq'), '0', { mode: 0o600 })
    }
    const before = witness(f.state)
    expect(() => beginWebActivationUpgrade(f.state, f.next)).toThrow('upgrade:populated-history-required')
    expect(() => beginWebActivationUpgrade(f.state, f.next, { expectedPreviousActivation: '00'.repeat(32) }))
      .toThrow('upgrade:previous-activation-mismatch')
    expect(witness(f.state)).toEqual(before)
    const session = beginWebActivationUpgrade(f.state, f.next, { expectedPreviousActivation: OLD })
    expect(session.commit(f.signed(session.operation))).toMatchObject({
      status: 'ACTIVATION_UPGRADED', previousActivation: OLD, activationDigest: activationDigest(f.next),
    })
    expect(witness(f.state)).toEqual(before)
    expect(existsSync(join(f.state, 'aura.jsonl'))).toBe(history === 'empty')
    expect(existsSync(join(f.state, 'receipts'))).toBe(false)
    // Same change of reason: the binding format is accepted, and the stale pin is what
    // refuses — OLD is no longer the activation this store is bound to.
    expect(() => beginWebActivationUpgrade(f.state, f.next, { expectedPreviousActivation: OLD }))
      .toThrow('upgrade:previous-activation-mismatch')
    await f.start(activationDigest(f.next))
    expect(await request(f.socket, { op: 'kira.recall' })).toEqual(f.recall)
  }, 30_000)

  it.each([
    ['memory/objects', `${'11'.repeat(32)}.json`, '{}', 'upgrade:objects-unverified'],
    ['memory/keys', 'unrecorded.json', '{}', 'upgrade:empty-store-evidence-present'],
    ['nonces', 'retained-burn', JSON.stringify({ nonce: 'retained-burn', exp: 10, pid: 1, ts: 1 }), 'upgrade:empty-store-evidence-present'],
    ['receipts', '.tmp-unpublished', 'retained bytes', 'upgrade:empty-store-evidence-present'],
    ['intents', 'unresolved.json', JSON.stringify({ nonce: 'unresolved', operationDigest: '12'.repeat(32), startedAt: 1 }), 'upgrade:unresolved-intents'],
  ])('preserves and refuses zero-history residue in %s', async (directory, filename, contents, refusal) => {
    const f = await fixture(false)
    await f.stop()
    mkdirSync(join(f.state, directory), { recursive: true, mode: 0o700 })
    writeFileSync(join(f.state, directory, filename), contents, { mode: 0o600 })
    const before = witness(f.state)
    expect(() => beginWebActivationUpgrade(f.state, f.next, { expectedPreviousActivation: OLD })).toThrow(refusal)
    expect(witness(f.state)).toEqual(before)
    expect(readActivationBinding(f.state)).toBe(OLD)
    expect(existsSync(join(f.state, '.broker-active.lock'))).toBe(false)
  })

  it('refuses a zero-history target with a different broker key and a missing retained key', async () => {
    const f = await fixture(false)
    await f.stop()
    const before = witness(f.state)
    expect(() => beginWebActivationUpgrade(f.state, { ...f.next, brokerId: '77'.repeat(32) }, { expectedPreviousActivation: OLD }))
      .toThrow('upgrade:broker-identity-changed')
    expect(witness(f.state)).toEqual(before)
    unlinkSync(join(f.state, 'keys', 'broker.json'))
    const missing = witness(f.state)
    expect(() => beginWebActivationUpgrade(f.state, f.next, { expectedPreviousActivation: OLD })).toThrow()
    expect(witness(f.state)).toEqual(missing)
    expect(existsSync(join(f.state, 'keys', 'broker.json'))).toBe(false)
    expect(readActivationBinding(f.state)).toBe(OLD)
    expect(existsSync(join(f.state, '.broker-active.lock'))).toBe(false)
  })

  it('does not commit when an explicitly empty store gains effect evidence after review', async () => {
    const f = await fixture(false)
    await f.stop()
    const session = beginWebActivationUpgrade(f.state, f.next, { expectedPreviousActivation: OLD })
    mkdirSync(join(f.state, 'receipts'), { mode: 0o700 })
    writeFileSync(join(f.state, 'receipts', '.tmp-unpublished'), 'retained bytes', { mode: 0o600 })
    const changed = witness(f.state)
    try {
      expect(() => session.commit(f.signed(session.operation))).toThrow('upgrade:empty-store-evidence-present')
      expect(witness(f.state)).toEqual(changed)
      expect(readActivationBinding(f.state)).toBe(OLD)
    } finally { session.close() }
    expect(existsSync(join(f.state, '.broker-active.lock'))).toBe(false)
  })

  it('refuses a target statement whose issuer identity is not the retained controller', async () => {
    const f = await fixture()
    await f.stop()
    const before = witness(f.state)
    const stranger = generateKeyPairSync('ed25519')
    const strangerId = receiptKeyIdForPublicKey(stranger.publicKey.export({ type: 'spki', format: 'pem' }).toString())
    expect(strangerId).not.toBe(f.next.issuerId)
    expect(() => beginWebActivationUpgrade(f.state, { ...f.next, issuerId: strangerId })).toThrow('upgrade:issuer-identity-changed')
    expect(witness(f.state)).toEqual(before)
    expect(readActivationBinding(f.state)).toBe(OLD)
    expect(existsSync(join(f.state, '.broker-active.lock'))).toBe(false)
  })

  it('refuses a target statement without the reconnectable owner-review configuration', async () => {
    const f = await fixture()
    await f.stop()
    const before = witness(f.state)
    const resolver = { 'staged-profile-patch': '44'.repeat(32) }
    const next = { ...f.next, closure: { ...f.next.closure, resolver } }
    expect(() => beginWebActivationUpgrade(f.state, next)).toThrow('upgrade:reconnectable-web-required')
    expect(witness(f.state)).toEqual(before)
    expect(readActivationBinding(f.state)).toBe(OLD)
    expect(existsSync(join(f.state, '.broker-active.lock'))).toBe(false)
  })

  it('refuses oversized activation bytes before parsing them', async () => {
    const f = await fixture()
    await f.stop()
    const path = join(f.state, 'activation.json')
    writeFileSync(path, ' '.repeat(256 * 1024 + 1))
    const before = readFileSync(path)
    expect(() => beginWebActivationUpgrade(f.state, f.next)).toThrow('upgrade:file-too-large')
    expect(readFileSync(path)).toEqual(before)
    expect(existsSync(join(f.state, '.broker-active.lock'))).toBe(false)
  })

  it('refuses approval that expires during candidate fsync without publishing or leaving residue', async () => {
    const f = await fixture()
    await f.stop()
    const before = witness(f.state)
    const session = beginWebActivationUpgrade(f.state, f.next)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(session.operation.issuedAt * 1000)
    const fsync = fs.fsyncSync
    const injected = vi.spyOn(fs, 'fsyncSync').mockImplementation((fd) => {
      fsync(fd)
      clock.mockReturnValue(session.operation.expiresAt * 1000)
    })
    syncBuiltinESMExports()
    try { expect(() => session.commit(f.signed(session.operation))).toThrow('upgrade:approval-expired') }
    finally { injected.mockRestore(); clock.mockRestore(); syncBuiltinESMExports(); session.close() }
    expect(readActivationBinding(f.state)).toBe(OLD)
    expect(witness(f.state)).toEqual(before)
    expect(existsSync(join(f.state, '.broker-active.lock'))).toBe(false)
  })

  it.each(['before-publication', 'after-publication'] as const)('keeps the writer lease and one complete binding after %s uncertainty', async (phase) => {
    const f = await fixture()
    await f.stop()
    const before = witness(f.state)
    const session = beginWebActivationUpgrade(f.state, f.next)
    const record = f.signed(session.operation)
    const rename = fs.renameSync
    const injected = vi.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
      if (phase === 'after-publication') rename(source, target)
      throw new Error('injected-publication-uncertain')
    })
    syncBuiltinESMExports()
    try { expect(() => session.commit(record)).toThrow('injected-publication-uncertain') }
    finally { injected.mockRestore(); syncBuiltinESMExports(); session.close() }
    expect(existsSync(join(f.state, '.broker-active.lock'))).toBe(true)
    expect(readActivationBinding(f.state)).toBe(phase === 'before-publication' ? OLD : activationDigest(f.next))
    expect(witness(f.state).filter(row => !(row as { relative: string }).relative.startsWith('.activation-upgrade-'))).toEqual(before)
    await expect(f.start(activationDigest(f.next))).rejects.toThrow('broker:state-active')
  })

  it('refuses invalid CLI arguments and non-TTY launch without rewriting retained state', async () => {
    const f = await fixture()
    await f.stop()
    const before = witness(f.state)
    const cli = fileURLToPath(new URL('./aukora-web-upgrade.mjs', import.meta.url))
    const reviewPath = join(f.root, 'review.json')
    const terminalKeys = generateKeyPairSync('ed25519')
    writeFileSync(reviewPath, JSON.stringify({ domain: 'aukora:web-review-config:v1',
      socketPath: join(f.root, 'review.sock'), subject: loadLocalAumlokControl(join(f.root, 'control')).subject,
      terminalPublicKeyPem: terminalKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString() }), { mode: 0o600 })
    const valid = ['--data-dir', f.root, '--control-dir', join(f.root, 'control'),
      '--review-config', reviewPath, '--port', '5000']
    const run = (args: string[]): Promise<{ code: number | null; stderr: string }> =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cli, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
        let stderr = ''
        child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
        child.once('error', reject)
        child.once('exit', (code) => { resolve({ code, stderr }) })
      })
    for (const shape of [
      [],
      ['--data-dir', f.root],
      valid.slice(0, 7),
      ['--data-dir', 'relative', ...valid.slice(2)],
      [...valid.slice(0, 6), '--port', '0'],
      [...valid.slice(0, 6), '--port', '65536'],
      [...valid.slice(0, 6), '--port', 'abc'],
      ['--port', '5000', ...valid.slice(0, 6)],
      [...valid, 'extra'],
      [...valid, '--workspace'],
      [...valid, '--unknown', 'project=/tmp'],
    ]) {
      const result = await run(shape)
      expect(result.code, JSON.stringify(shape)).toBe(1)
      expect(result.stderr, JSON.stringify(shape)).toContain('usage: node scripts/aukora-web-upgrade.mjs')
    }
    const nonTty = await run(valid)
    expect(nonTty.code).toBe(1)
    expect(nonTty.stderr).toContain('upgrade:attended-terminal-required')
    expect(nonTty.stderr).not.toContain('usage: node scripts/aukora-web-upgrade.mjs')
    const pinned = await run([...valid, '--expected-previous-activation', OLD])
    expect(pinned).toMatchObject({ code: 1 })
    expect(pinned.stderr).toContain('upgrade:attended-terminal-required')
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'web-upgrade-workspace-')))
    cleanups.push(async () => { rmSync(workspace, { recursive: true, force: true }) })
    const capsulePath = join(f.root, 'capsule.json')
    writeFileSync(capsulePath, JSON.stringify({ domain: 'aukora:web-capsule:v1',
      worker: { kind: 'opencode', executable: process.execPath, defaultModel: 'fixture/local',
        maxOutputBytes: 1024, maxSpillBytes: 2048, disposeGraceMs: 100 },
      protectedChecks: [{ id: 'fixture-check', program: 'process.exit(0)', timeoutMs: 1000 }],
    }), { mode: 0o600 })
    const mapped = await run([...valid, '--workspace', `project=${workspace}`])
    expect(mapped).toMatchObject({ code: 1 })
    expect(mapped.stderr).toContain('upgrade:attended-terminal-required')
    expect(mapped.stderr).not.toContain('usage: node scripts/aukora-web-upgrade.mjs')
    const capsule = await run([...valid, '--capsule-config', capsulePath, '--workspace', `project=${workspace}`])
    expect(capsule).toMatchObject({ code: 1 })
    expect(capsule.stderr).toContain('upgrade:attended-terminal-required')
    expect(capsule.stderr).not.toContain('usage: node scripts/aukora-web-upgrade.mjs')
    const operator = await run([...valid, '--operator-home', workspace])
    expect(operator).toMatchObject({ code: 1 })
    expect(operator.stderr).toContain('upgrade:attended-terminal-required')
    for (const [extra, refusal] of [
      [['--operator-home', 'relative'], 'upgrade:operator-home-path-invalid'],
      [['--operator-home', workspace, '--operator-home', workspace], 'upgrade:operator-home-duplicate'],
      [['--capsule-config', capsulePath], 'upgrade:capsule-workspace-required'],
      [['--capsule-config', 'relative'], 'upgrade:capsule-config-path-invalid'],
      [['--capsule-config', join(f.root, 'missing-capsule.json')], 'aukora:web:capsule-config-invalid'],
      [['--capsule-config', reviewPath], 'aukora:web:capsule-config-invalid'],
      [['--capsule-config', capsulePath, '--capsule-config', capsulePath], 'upgrade:capsule-config-duplicate'],
      [['--expected-previous-activation', 'invalid'], 'upgrade:previous-activation-pin-invalid'],
      [['--expected-previous-activation', OLD, '--expected-previous-activation', OLD], 'upgrade:previous-activation-pin-invalid'],
      [['--workspace', 'project'], 'upgrade:workspace-argument-invalid'],
      [['--workspace', '='], 'upgrade:workspace-argument-invalid'],
      [['--workspace', 'project='], 'upgrade:workspace-argument-invalid'],
      [['--workspace', `bad/name=${workspace}`], 'supervisor:workspace-alias-invalid'],
      [['--workspace', 'project=relative'], 'supervisor:workspace-root-not-canonical'],
      [['--workspace', `project=${join(f.root, 'control')}`], 'supervisor:workspace-protected-path-overlap'],
      [['--workspace', `project=${workspace}`, '--workspace', `project=${workspace}`], 'upgrade:workspace-alias-duplicate'],
    ] as const) {
      const result = await run([...valid, ...extra])
      expect(result.code, JSON.stringify(extra)).toBe(1)
      expect(result.stderr, JSON.stringify(extra)).toContain(refusal)
      expect(result.stderr).not.toContain('upgrade:attended-terminal-required')
    }
    expect(readActivationBinding(f.state)).toBe(OLD)
    expect(witness(f.state)).toEqual(before)
    expect(existsSync(join(f.state, '.broker-active.lock'))).toBe(false)
    expect(existsSync(join(f.root, 'capsules'))).toBe(false)
  })
})

describe.skipIf(process.platform === 'win32')('preauthorized activation rollback (SCRIPTED fixture signatures)', () => {
  async function upgraded(populated = true) {
    const f = await fixture(populated)
    await f.stop()
    const before = witness(f.state)
    const session = beginWebActivationUpgrade(f.state, f.next, { expectedPreviousActivation: OLD })
    const bundle = { domain: WEB_ROLLBACK_BUNDLE_DOMAIN, previousBinding: session.previousBinding,
      upgrade: f.signed(session.operation),
      rollback: f.signedRollback(createWebActivationRollback(session.operation, session.previousBinding)) }
    session.commit(bundle.upgrade)
    return { ...f, bundle, before }
  }

  it.each([false, true])('restarts both activations and preserves retained effects (populated=%s)', async (populated) => {
    const f = await upgraded(populated)
    await f.start(activationDigest(f.next))
    expect(() => beginWebActivationRollback(f.state, f.bundle)).toThrow('broker:state-active')
    expect(await request(f.socket, { op: 'kira.recall' })).toEqual(f.recall)
    await f.stop()
    const session = beginWebActivationRollback(f.state, f.bundle)
    const result = session.commit()
    expect(result).toMatchObject({ status: 'ACTIVATION_ROLLED_BACK', activationDigest: OLD })
    expect(readFileSync(join(f.state, 'activation.json'), 'utf8')).toBe(f.bundle.previousBinding)
    expect(verifyWebRollbackBundle(JSON.parse(readFileSync(result.auditPath, 'utf8')), f.control.activeControl))
      .toEqual(f.bundle)
    expect(witness(f.state).filter(row => !(row as { relative: string }).relative.startsWith('.activation-rollback-')))
      .toEqual(f.before)
    expect(() => session.commit()).toThrow('rollback:review-closed')
    expect(() => beginWebActivationRollback(f.state, f.bundle)).toThrow('rollback:current-binding-mismatch')
    await f.start(OLD)
    expect(await request(f.socket, { op: 'kira.recall' })).toEqual(f.recall)
    expect(f.reviews()).toBe(populated ? 1 : 0)
  }, 30_000)

  it('rejects substituted bytes and either invalid signature without modifying state', async () => {
    const f = await upgraded(false)
    const before = witness(f.state)
    const activation = readFileSync(join(f.state, 'activation.json'))
    for (const field of ['ed25519', 'mlDsa65'] as const) {
      const invalid = { ...f.bundle, rollback: { ...f.bundle.rollback,
        signatures: { ...f.bundle.rollback.signatures, [field]: '00'.repeat(field === 'ed25519' ? 64 : 3309) } } }
      expect(() => beginWebActivationRollback(f.state, invalid)).toThrow('rollback:signature-invalid')
    }
    expect(() => beginWebActivationRollback(f.state, { ...f.bundle, previousBinding: `${f.bundle.previousBinding}\n` }))
      .toThrow('rollback:previous-binding-mismatch')
    const different = { ...f.bundle, upgrade: f.signed({ ...f.bundle.upgrade.operation, nonce: 'ef'.repeat(32) }) }
    expect(() => beginWebActivationRollback(f.state, different)).toThrow('rollback:upgrade-mismatch')
    expect(readFileSync(join(f.state, 'activation.json'))).toEqual(activation)
    expect(witness(f.state)).toEqual(before)
    expect(existsSync(join(f.state, '.broker-active.lock'))).toBe(false)
  })

  it('refuses a real post-upgrade settlement without rewinding its record, nonce or receipt', async () => {
    const f = await upgraded()
    await f.start(activationDigest(f.next))
    expect(await f.put('new-effect')).toMatchObject({ state: 'SETTLED' })
    const recalled = await request(f.socket, { op: 'kira.recall' })
    await f.stop()
    const before = witness(f.state)
    expect(() => beginWebActivationRollback(f.state, f.bundle)).toThrow('rollback:store-changed')
    expect(witness(f.state)).toEqual(before)
    expect(readActivationBinding(f.state)).toBe(activationDigest(f.next))
    await f.start(activationDigest(f.next))
    expect(await request(f.socket, { op: 'kira.recall' })).toEqual(recalled)
  }, 30_000)

  it('rechecks expiry and retained bytes at commit, and never replenishes the recovery window', async () => {
    const f = await upgraded(false)
    const session = beginWebActivationRollback(f.state, f.bundle)
    const operation = f.bundle.rollback.operation
    expect(operation.expiresAt).toBe(f.bundle.upgrade.operation.issuedAt + 900)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(operation.expiresAt * 1000)
    expect(() => session.commit()).toThrow('rollback:approval-expired')
    clock.mockRestore()
    writeFileSync(join(f.state, 'mapping-change'), 'different', { mode: 0o600 })
    const before = witness(f.state)
    expect(() => session.commit()).toThrow('rollback:store-changed')
    session.close()
    expect(witness(f.state)).toEqual(before)
    expect(existsSync(join(f.state, '.broker-active.lock'))).toBe(false)
  })

  it.each(['candidate-sync', 'audit-sync', 'before-binding', 'after-binding', 'directory-sync'] as const)
  ('preserves evidence and lease according to publication phase: %s', async (phase) => {
    const f = await upgraded(false)
    const session = beginWebActivationRollback(f.state, f.bundle)
    const fsync = fs.fsyncSync
    const rename = fs.renameSync
    let syncs = 0
    const syncFault = vi.spyOn(fs, 'fsyncSync').mockImplementation((fd) => {
      syncs += 1
      if ((phase === 'candidate-sync' && syncs === 1) || (phase === 'audit-sync' && syncs === 2)
          || (phase === 'directory-sync' && syncs === 4)) throw new Error('fixture-publication-failure')
      fsync(fd)
    })
    const renameFault = vi.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
      if (phase === 'before-binding') throw new Error('fixture-publication-failure')
      rename(source, target)
      if (phase === 'after-binding') throw new Error('fixture-publication-failure')
    })
    syncBuiltinESMExports()
    try { expect(() => session.commit()).toThrow('fixture-publication-failure') }
    finally { syncFault.mockRestore(); renameFault.mockRestore(); syncBuiltinESMExports(); session.close() }
    const published = phase === 'after-binding' || phase === 'directory-sync'
    expect(readActivationBinding(f.state)).toBe(published ? OLD : activationDigest(f.next))
    expect(existsSync(join(f.state, '.broker-active.lock'))).toBe(phase !== 'candidate-sync')
    const audits = readdirSync(f.state).filter(name => name.startsWith('.activation-rollback-'))
    expect(audits).toHaveLength(phase === 'candidate-sync' ? 0 : 1)
    expect(witness(f.state).filter(row => !(row as { relative: string }).relative.startsWith('.activation-')))
      .toEqual(f.before)
  })

  it.each(['close-after-sync-failure', 'unlink-after-sync-failure', 'close-only'] as const)(
    'retains the primary error and lease after uncertain candidate cleanup: %s', async (phase) => {
      const f = await upgraded(false)
      const session = beginWebActivationRollback(f.state, f.bundle)
      const close = fs.closeSync
      const unlink = fs.unlinkSync
      const fsync = fs.fsyncSync
      let candidate: number | undefined
      const original = new Error(phase === 'close-only' ? 'fixture-close-error' : 'fixture-sync-error')
      const syncFault = vi.spyOn(fs, 'fsyncSync').mockImplementation((fd) => {
        candidate = fd
        if (phase !== 'close-only') throw original
        fsync(fd)
      })
      const closeFault = vi.spyOn(fs, 'closeSync').mockImplementation((fd) => {
        close(fd)
        if (fd === candidate && phase !== 'unlink-after-sync-failure') {
          throw phase === 'close-only' ? original : new Error('fixture-close-error')
        }
      })
      const unlinkFault = vi.spyOn(fs, 'unlinkSync').mockImplementation((path) => {
        if (phase === 'unlink-after-sync-failure' && String(path).includes('.activation-upgrade-rollback-')) {
          throw new Error('fixture-unlink-error')
        }
        unlink(path)
      })
      syncBuiltinESMExports()
      try {
        let observed: unknown
        try { session.commit() } catch (error) { observed = error }
        expect(observed).toBeInstanceOf(AggregateError)
        expect((observed as AggregateError).errors[0]).toBe(original)
        expect((observed as Error).message).toContain('rollback:cleanup-uncertain')
      } finally {
        syncFault.mockRestore(); closeFault.mockRestore(); unlinkFault.mockRestore()
        syncBuiltinESMExports(); session.close()
      }
      expect(readActivationBinding(f.state)).toBe(activationDigest(f.next))
      expect(existsSync(join(f.state, '.broker-active.lock'))).toBe(true)
      expect(readdirSync(f.state).filter(name => name.startsWith('.activation-rollback-'))).toHaveLength(0)
      expect(readdirSync(f.state).filter(name => name.startsWith('.activation-upgrade-rollback-')))
        .toHaveLength(phase === 'unlink-after-sync-failure' ? 1 : 0)
    },
  )
})

describe.skipIf(process.platform === 'win32')('repeatable retained-state upgrade (SCRIPTED controller signatures)', () => {
  // A store upgraded once used to be permanently unupgradable, so a later measured
  // target could not be bound to it at all. These cases exercise the second transition
  // and its recovery on the SAME store, with identity, history and evidence retained.
  const second = (f: Awaited<ReturnType<typeof fixture>>) => ({ ...f.next, epoch: 2 })

  it('upgrades a store twice and retains identity, history and evidence across both', async () => {
    const f = await fixture()
    await f.stop()
    const first = activationDigest(f.next)
    const secondStatement = second(f)
    const target = activationDigest(secondStatement)
    expect(target).not.toBe(first)

    // Transition one: legacy v1 binding -> upgraded binding.
    const one = beginWebActivationUpgrade(f.state, f.next)
    const beforeFirst = witness(f.state)
    expect(one.commit(f.signed(one.operation))).toMatchObject({ status: 'ACTIVATION_UPGRADED',
      previousActivation: OLD, activationDigest: first })
    expect(witness(f.state)).toEqual(beforeFirst)
    const bindingAfterFirst = readFileSync(join(f.state, 'activation.json'), 'utf8')

    // Transition two: upgraded binding -> upgraded binding. This is the newly supported path.
    const beforeSecond = witness(f.state)
    const two = beginWebActivationUpgrade(f.state, secondStatement)
    expect(two.operation).toMatchObject({ previousActivation: first, subject: one.operation.subject,
      controlDigest: one.operation.controlDigest, receiptKeyId: one.operation.receiptKeyId,
      storeDigest: one.operation.storeDigest })
    // The predecessor handed to recovery is the exact retained bytes, not a reconstruction.
    expect(two.previousBinding).toBe(bindingAfterFirst)
    expect(two.commit(f.signed(two.operation))).toMatchObject({ status: 'ACTIVATION_UPGRADED',
      previousActivation: first, activationDigest: target })

    // Retained: every byte outside the binding is untouched by either transition.
    expect(witness(f.state)).toEqual(beforeSecond)
    expect(witness(f.state)).toEqual(beforeFirst)
    // The store now serves the second activation, and its memory survived both.
    await f.start(target)
    expect(await request(f.socket, { op: 'kira.recall' })).toEqual(f.recall)
    // The superseded activation is refused on a fresh launch over the same store.
    await f.stop()
    await expect(f.start(first)).rejects.toThrow('broker:activation-state-conflict')
  }, 60_000)

  it('rolls the second upgrade back to its exact predecessor, not to the original v1 binding', async () => {
    const f = await fixture()
    await f.stop()
    const first = activationDigest(f.next)
    const secondStatement = second(f)
    const one = beginWebActivationUpgrade(f.state, f.next)
    one.commit(f.signed(one.operation))
    const bindingAfterFirst = readFileSync(join(f.state, 'activation.json'), 'utf8')

    const two = beginWebActivationUpgrade(f.state, secondStatement)
    const bundle = { domain: WEB_ROLLBACK_BUNDLE_DOMAIN, previousBinding: two.previousBinding,
      upgrade: f.signed(two.operation),
      rollback: f.signedRollback(createWebActivationRollback(two.operation, two.previousBinding)) }
    two.commit(bundle.upgrade)
    expect(readActivationBinding(f.state)).toBe(activationDigest(secondStatement))

    const recovery = beginWebActivationRollback(f.state, bundle)
    expect(recovery.commit()).toMatchObject({ status: 'ACTIVATION_ROLLED_BACK',
      activationDigest: first })
    // Restored to the UPGRADED predecessor byte-for-byte — not to the original v1 record.
    expect(readFileSync(join(f.state, 'activation.json'), 'utf8')).toBe(bindingAfterFirst)
    expect(readActivationBinding(f.state)).toBe(first)
    await f.start(first)
    expect(await request(f.socket, { op: 'kira.recall' })).toEqual(f.recall)
  }, 60_000)

  it('refuses a stale expected-activation pin on an already-upgraded store', async () => {
    const f = await fixture()
    await f.stop()
    const one = beginWebActivationUpgrade(f.state, f.next)
    one.commit(f.signed(one.operation))
    const before = witness(f.state)
    const binding = readFileSync(join(f.state, 'activation.json'), 'utf8')
    // OLD is two activations ago; the pin must name the CURRENT one.
    expect(() => beginWebActivationUpgrade(f.state, second(f), { expectedPreviousActivation: OLD }))
      .toThrow('upgrade:previous-activation-mismatch')
    // The correct pin is accepted.
    const ok = beginWebActivationUpgrade(f.state, second(f),
      { expectedPreviousActivation: activationDigest(f.next) })
    ok.close()
    expect(witness(f.state)).toEqual(before)
    expect(readFileSync(join(f.state, 'activation.json'), 'utf8')).toBe(binding)
  }, 60_000)

  it('leaves the upgraded binding unchanged when the second authorization is declined or expired', async () => {
    const f = await fixture()
    await f.stop()
    const one = beginWebActivationUpgrade(f.state, f.next)
    one.commit(f.signed(one.operation))
    const first = activationDigest(f.next)
    const before = witness(f.state)
    const binding = readFileSync(join(f.state, 'activation.json'), 'utf8')

    // Declined: the session is closed without a signed record.
    const declined = beginWebActivationUpgrade(f.state, second(f))
    declined.close()
    expect(readFileSync(join(f.state, 'activation.json'), 'utf8')).toBe(binding)

    // Expired: a real signed record presented past its own window. Expiry is not relaxed
    // for the second transition — the same 120-second ceiling applies.
    const expired = beginWebActivationUpgrade(f.state, second(f))
    const record = f.signed(expired.operation)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(expired.operation.expiresAt * 1000)
    try {
      expect(() => expired.commit(record)).toThrow('upgrade:approval-expired')
    } finally { clock.mockRestore(); expired.close() }

    expect(readFileSync(join(f.state, 'activation.json'), 'utf8')).toBe(binding)
    expect(witness(f.state)).toEqual(before)
    expect(readActivationBinding(f.state)).toBe(first)
    await f.start(first)
    expect(await request(f.socket, { op: 'kira.recall' })).toEqual(f.recall)
  }, 60_000)

  it('keeps the upgraded predecessor readable when a second transition is interrupted before commit', async () => {
    const f = await fixture()
    await f.stop()
    const one = beginWebActivationUpgrade(f.state, f.next)
    one.commit(f.signed(one.operation))
    const first = activationDigest(f.next)
    const binding = readFileSync(join(f.state, 'activation.json'), 'utf8')
    const before = witness(f.state)

    // Interrupt at the boundary this change moves: the session holds the lease and has
    // read the upgraded predecessor, then goes away without committing.
    const interrupted = beginWebActivationUpgrade(f.state, second(f))
    expect(interrupted.previousBinding).toBe(binding)
    interrupted.close()

    // The lease is released, the predecessor still parses, and the store still serves it.
    expect(readFileSync(join(f.state, 'activation.json'), 'utf8')).toBe(binding)
    expect(readActivationBinding(f.state)).toBe(first)
    expect(witness(f.state)).toEqual(before)
    // A fresh session over the same store proceeds normally afterwards.
    const retry = beginWebActivationUpgrade(f.state, second(f))
    expect(retry.operation.previousActivation).toBe(first)
    retry.close()
  }, 60_000)

  it('still refuses a binding that is neither supported format', async () => {
    const f = await fixture()
    await f.stop()
    const before = witness(f.state)
    writeFileSync(join(f.state, 'activation.json'),
      `${JSON.stringify({ domain: 'aukora:activation-binding:not-a-real-domain', activationDigest: OLD })}\n`,
      { mode: 0o600 })
    expect(() => beginWebActivationUpgrade(f.state, f.next)).toThrow('upgrade:supported-binding-required')
    expect(witness(f.state)).toEqual(before)
  }, 60_000)
})
