/** Scripted retained Web rollback; optionally exercises a clean previous checkout, never live state. */
import { execFileSync } from 'node:child_process'
import { createHash, sign } from 'node:crypto'
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createConnection, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'
import { afterEach, describe, expect, it } from 'vitest'
import { activationDigest } from '../aukora/activation/statement.mjs'
import { readActivationBinding } from '../aukora/activation/broker-state.mjs'
import { createWebActivationRollback, SIGNED_WEB_ROLLBACK_DOMAIN, WEB_ROLLBACK_BUNDLE_DOMAIN, WEB_ROLLBACK_SIGNATURE_DOMAIN, webRollbackBytes } from '../aukora/activation/web-rollback-record.mjs'
import { UPGRADED_BINDING_DOMAIN, WEB_UPGRADE_SIGNATURE_DOMAIN, webUpgradeBytes } from '../aukora/activation/web-upgrade-record.mjs'
import { beginWebActivationRollback, beginWebActivationUpgrade } from '../aukora/broker/web-activation-upgrade.mjs'
import { loadOrCreateLocalAumlokControl } from '../aukora/identity/local-control-store.mjs'
import { createDeveloperAumlokAuthority } from '../aukora/supervisor/developer-aumlok.mjs'
import { launchDeveloperAssembly, prepareWebUpgradeStatement, type DeveloperAssembly } from '../aukora/supervisor/developer-launch.mjs'

const roots: string[] = []
const assemblies: DeveloperAssembly[] = []
const fixtureBytes = readFileSync(fileURLToPath(import.meta.url))
const terminalRenderer = createHash('sha256').update(fixtureBytes).update('terminal').digest('hex')
const browserRenderer = createHash('sha256').update(fixtureBytes).update('browser').digest('hex')

afterEach(async () => {
  for (const assembly of assemblies.splice(0).reverse()) await assembly.close()
  for (const root of roots.splice(0).reverse()) rmSync(root, { recursive: true, force: true })
})

/** An explicit previous checkout supplies its own measured source and built guest artifacts. */
async function previousLauncher() {
  const checkout = process.env.AUKORA_ROLLBACK_PREVIOUS_CHECKOUT
  if (checkout === undefined) return { launch: launchDeveloperAssembly, assertUnchanged() {} }
  if (!isAbsolute(checkout) || resolve(checkout) !== checkout || realpathSync(checkout) !== checkout
    || !lstatSync(checkout).isDirectory()) throw new Error('Fixture previous checkout must be a canonical directory')
  const git = (...args: string[]) => execFileSync('git', ['--no-optional-locks', '-C', checkout, ...args],
    { encoding: 'utf8', timeout: 10_000 }).trim()
  if (git('rev-parse', '--show-toplevel') !== checkout) throw new Error('Fixture previous checkout must be its Git root')
  const head = git('rev-parse', 'HEAD')
  const branch = git('branch', '--show-current')
  if (!/^[0-9a-f]{40}$/u.test(head) || git('status', '--short') !== '') {
    throw new Error('Fixture previous checkout must have a clean pinned Git state')
  }
  process.stdout.write(`ROLLBACK_PREVIOUS_CHECKOUT ${JSON.stringify({ checkout, head, branch: branch || '(detached)', status: 'clean' })}\n`)
  const moduleUrl = pathToFileURL(join(checkout, 'aukora/supervisor/developer-launch.mjs')).href
  const previous: unknown = await import(/* @vite-ignore */ moduleUrl)
  if (typeof previous !== 'object' || previous === null || !('launchDeveloperAssembly' in previous)
    || typeof previous.launchDeveloperAssembly !== 'function') throw new Error('Fixture previous checkout lacks its launcher')
  return {
    launch: previous.launchDeveloperAssembly as typeof launchDeveloperAssembly,
    assertUnchanged() {
      expect(git('rev-parse', 'HEAD')).toBe(head)
      expect(git('status', '--short')).toBe('')
    },
  }
}

/** Preserve file bytes and identity; authorization audit creation is asserted separately. */
function witness(root: string, excluded: ReadonlySet<string> = new Set(), relative = ''): unknown[] {
  const path = join(root, relative)
  const stat = lstatSync(path)
  const row = { relative, inode: stat.ino, dev: stat.dev, mode: stat.mode }
  if (!stat.isDirectory()) return [{ ...row, bytes: readFileSync(path).toString('base64') }]
  return [row, ...readdirSync(path).sort().flatMap((name) => {
    const child = join(relative, name)
    return excluded.has(child) ? [] : witness(root, excluded, child)
  })]
}

async function unusedLoopbackPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { resolve() })
  })
  const address = server.address()
  await new Promise<void>((resolve, reject) => {
    server.close((error) => { if (error === undefined) resolve(); else reject(error) })
  })
  if (address === null || typeof address === 'string') throw new Error('Fixture did not receive a loopback port')
  return address.port
}

async function recall(socketPath: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    const timer = setTimeout(() => socket.destroy(new Error('Fixture recall timed out')), 5_000)
    let response = ''
    socket.once('error', reject)
    socket.once('close', () => { clearTimeout(timer); reject(new Error('Fixture recall closed without a response')) })
    socket.once('connect', () => socket.write(`${JSON.stringify({ op: 'kira.recall' })}\n`))
    socket.on('data', (chunk: Buffer) => {
      response += chunk.toString('utf8')
      if (response.length > 65_536) { socket.destroy(new Error('Fixture recall response exceeded its limit')); return }
      const lineEnd = response.indexOf('\n')
      if (lineEnd === -1) return
      try { resolve(JSON.parse(response.slice(0, lineEnd)) as unknown) }
      catch (error) { reject(error instanceof Error ? error : new Error(String(error))) }
      socket.destroy()
    })
  })
}

describe.skipIf(process.platform === 'win32')('retained Web rollback real assembly', () => {
  it('rolls back the Capsule-enabled target to the same terminal identity, state, workspace and session marker', async () => {
    const previous = await previousLauncher()
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'awr-')))
    roots.push(root)
    const controlDir = join(root, 'control')
    const control = loadOrCreateLocalAumlokControl(controlDir)
    const authority = createDeveloperAumlokAuthority(control, { audience: 'broker:source-launch' })
    const rootPrivateKeyFile = join(root, 'issuer-private.pem')
    const rootPublicKeyFile = join(root, 'issuer-public.pem')
    writeFileSync(rootPrivateKeyFile, control.record.ed25519PrivateKeyPem, { mode: 0o600 })
    writeFileSync(rootPublicKeyFile, control.ed25519PublicKeyPem, { mode: 0o600 })
    const controlWitness = witness(controlDir)
    const dataDir = join(root, 'deployment')
    const project = join(root, 'project')
    mkdirSync(project, { mode: 0o700 })
    writeFileSync(join(project, 'canary.txt'), 'existing workspace bytes\n', { mode: 0o600 })
    const workspaceRoots = { project }
    const workspaceWitness = witness(project)
    const webCapsule = {
      worker: { kind: 'opencode' as const, executable: realpathSync(process.execPath), defaultModel: 'fixture/local',
        maxOutputBytes: 1024, maxSpillBytes: 2048, disposeGraceMs: 100 },
      protectedChecks: [{ id: 'fixture-check', program: 'process.exit(0)', timeoutMs: 1000 }],
    }
    const port = await unusedLoopbackPort()
    const reviewConfigurationDigest = 'a2'.repeat(32)
    const launch = async (name: string, reconnectable: boolean) => {
      const selectedLauncher = reconnectable ? launchDeveloperAssembly : previous.launch
      const assembly = await selectedLauncher({
        runtimeDir: join(root, name), dataDir, workspaceRoots, rootPrivateKeyFile, rootPublicKeyFile,
        rootControlState: control.activeControl,
        rendererId: reconnectable ? browserRenderer : terminalRenderer,
        ...(reconnectable ? { reviewConfigurationDigest, webCapsule } : {}),
        web: { port }, webAumlokProjection: authority.projection,
        kiraRecallPolicy: { subject: control.subject, privacy: ['private'] },
        selectSubjectAuthority: authority.selectSubjectAuthority,
        subjectAuthorityExpectation: authority.subjectAuthorityExpectation,
        review: () => 'denied', issuerApproval: () => 'denied', issuerStderr: () => {},
      })
      assemblies.push(assembly)
      expect(new Set([assembly.broker.pid, assembly.issuer.pid, assembly.guest.pid]).size).toBe(3)
      expect((await fetch(`http://127.0.0.1:${String(port)}/`)).status).toBe(200)
      return assembly
    }
    const original = await launch('terminal-before', false)
    const originalRecall = await recall(original.paths.brokerSocket)
    expect(originalRecall).toMatchObject({ ok: true })
    await original.close()
    const capsuleRoot = join(dataDir, 'capsules')
    mkdirSync(capsuleRoot, { mode: 0o700 })
    const capsuleWitness = witness(capsuleRoot)
    const sessionRoot = join(dataDir, 'dsh-home', 'sessions')
    mkdirSync(sessionRoot, { recursive: true, mode: 0o700 })
    writeFileSync(join(sessionRoot, '.rollback-session-marker'), 'retained session home marker\n', { mode: 0o600, flag: 'wx' })
    const sessionWitness = witness(sessionRoot)
    const stateDir = original.paths.stateDir
    const bindingPath = join(stateDir, 'activation.json')
    const originalBinding = readFileSync(bindingPath, 'utf8')
    const retainedWitness = witness(stateDir, new Set(['activation.json']))
    const stagingDir = realpathSync(mkdtempSync(join(root, 'upgrade-stage-')))
    const target = prepareWebUpgradeStatement({
      stagingDir, dataDir, workspaceRoots, webCapsule, rendererId: browserRenderer, reviewConfigurationDigest,
      rootPublicKeyPem: control.ed25519PublicKeyPem, rootControlState: control.activeControl,
      web: { port }, webAumlokProjection: authority.projection,
      selectSubjectAuthority: authority.selectSubjectAuthority,
      subjectAuthorityExpectation: authority.subjectAuthorityExpectation,
    })
    const signatures = (bytes: Buffer, domain: string) => ({
      ed25519: sign(null, bytes, control.ed25519PrivateKey).toString('hex'),
      mlDsa65: Buffer.from(ml_dsa65.sign(bytes, control.mlDsa65SecretKey,
        { context: Buffer.from(domain) })).toString('hex'),
    })
    const forward = beginWebActivationUpgrade(stateDir, target, { expectedPreviousActivation: original.activationDigest })
    let bundle: Parameters<typeof beginWebActivationRollback>[1]
    let auditName: string
    try {
      expect(forward.previousBinding).toBe(originalBinding)
      const rollbackOperation = createWebActivationRollback(forward.operation, forward.previousBinding)
      const upgrade = { domain: UPGRADED_BINDING_DOMAIN, operation: forward.operation,
        signatures: signatures(webUpgradeBytes(forward.operation), WEB_UPGRADE_SIGNATURE_DOMAIN) }
      bundle = { domain: WEB_ROLLBACK_BUNDLE_DOMAIN, previousBinding: forward.previousBinding, upgrade,
        rollback: { domain: SIGNED_WEB_ROLLBACK_DOMAIN, operation: rollbackOperation,
          signatures: signatures(webRollbackBytes(rollbackOperation), WEB_ROLLBACK_SIGNATURE_DOMAIN) } }
      auditName = `.activation-rollback-${forward.operation.nonce}.json`
      expect(forward.commit(upgrade)).toMatchObject({ status: 'ACTIVATION_UPGRADED', activationDigest: activationDigest(target) })
    } finally { forward.close() }
    expect(readActivationBinding(stateDir)).toBe(activationDigest(target))
    const upgraded = await launch('browser', true)
    expect(upgraded.activationStatement).toEqual(target)
    expect(upgraded.activationStatement.closure.resolver).toHaveProperty('capsule-staged-overlay')
    expect(upgraded.paths.brokerSocket).toBe(original.paths.brokerSocket)
    expect(await recall(upgraded.paths.brokerSocket)).toEqual(originalRecall)
    await upgraded.close()
    expect(witness(sessionRoot)).toEqual(sessionWitness)
    expect(witness(capsuleRoot)).toEqual(capsuleWitness)
    const rollback = beginWebActivationRollback(stateDir, bundle)
    try {
      expect(rollback.commit()).toMatchObject({ status: 'ACTIVATION_ROLLED_BACK', activationDigest: original.activationDigest })
    } finally { rollback.close() }
    expect(readFileSync(bindingPath, 'utf8')).toBe(originalBinding)
    expect(lstatSync(join(stateDir, auditName)).isFile()).toBe(true)
    expect(witness(stateDir, new Set(['activation.json', auditName]))).toEqual(retainedWitness)
    const restored = await launch('terminal-after', false)
    expect(restored.activationStatement).toEqual(original.activationStatement)
    expect(restored.paths.brokerSocket).toBe(original.paths.brokerSocket)
    expect(restored.paths.stateDir).toBe(stateDir)
    expect(await recall(restored.paths.brokerSocket)).toEqual(originalRecall)
    await restored.close()
    expect(readFileSync(bindingPath, 'utf8')).toBe(originalBinding)
    expect(witness(controlDir)).toEqual(controlWitness)
    expect(witness(project)).toEqual(workspaceWitness)
    expect(witness(sessionRoot)).toEqual(sessionWitness)
    expect(witness(capsuleRoot)).toEqual(capsuleWitness)
    expect(witness(stateDir, new Set(['activation.json', auditName]))).toEqual(retainedWitness)
    previous.assertUnchanged()
  }, 120_000)
})
