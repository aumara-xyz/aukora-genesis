import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir, userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  inspectTopology,
  parseTopologyManifest,
  topologyCliExitCode,
  topologyDisposition,
  TopologyManifestError,
} from '../aukora/supervisor/topology.mjs'

const repoRoot = resolve(import.meta.dirname, '..')
const examplePath = join(repoRoot, 'ops/launch-downward/topology.example.json')
const supportedHost = process.platform === 'darwin' || process.platform === 'linux'
const temporaryRoots: string[] = []
const liveServers: Server[] = []

afterEach(async () => {
  await Promise.all(liveServers.splice(0).map(server => new Promise<void>(resolveClose => server.close(() => {
    resolveClose()
  }))))
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('topology manifest', () => {
  it('accepts the closed example inventory', () => {
    const manifest = parseTopologyManifest(readFileSync(examplePath))

    expect(manifest.schema).toBe('aukora:launch-topology:v1')
    expect(manifest.protectedPaths.map(item => item.kind)).toEqual([
      'socket-root',
      'root-key',
      'receipt-key',
      'nonce-state',
      'evidence',
      'active-profile',
      'active-artifact',
      'implementation-closure',
      'guest-scratch',
    ])
  })

  it.each([
    ['uid', 501],
    ['gid', 20],
    ['pid', 1234],
    ['observedUid', 501],
    ['accountExists', true],
  ])('refuses an injected %s fact', (field, claimedValue) => {
    const manifest = JSON.parse(readFileSync(examplePath, 'utf8')) as Record<string, unknown>
    const services = manifest.services as Record<string, Record<string, unknown>>
    services.issuer![field] = claimedValue

    expectManifestRefusal(
      () => parseTopologyManifest(manifest),
      'topology:manifest-unknown-field',
      `$.services.issuer.${field}`,
    )
  })

  it('refuses a manifest-supplied mode instead of treating it as an observation', () => {
    const manifest = JSON.parse(readFileSync(examplePath, 'utf8')) as Record<string, unknown>
    const routes = manifest.routes as Record<string, Record<string, unknown>>
    routes.guestBroker!.mode = '0660'

    expectManifestRefusal(
      () => parseTopologyManifest(manifest),
      'topology:manifest-unknown-field',
      '$.routes.guestBroker.mode',
    )
  })

  it('refuses an empty protected inventory before any forall can pass', () => {
    const manifest = JSON.parse(readFileSync(examplePath, 'utf8')) as Record<string, unknown>
    manifest.protectedPaths = []

    expectManifestRefusal(
      () => parseTopologyManifest(manifest),
      'topology:manifest-malformed',
      '$.protectedPaths',
    )
  })

  it('requires every route directory to be an immediate child of socket-root', () => {
    const manifest = JSON.parse(readFileSync(examplePath, 'utf8')) as Record<string, unknown>
    const routes = manifest.routes as Record<string, Record<string, unknown>>
    routes.guestBroker!.directoryPath = '/private/var/run/outside-aukora/guest-broker'
    routes.guestBroker!.socketPath = '/private/var/run/outside-aukora/guest-broker/effect.sock'

    expectManifestRefusal(
      () => parseTopologyManifest(manifest),
      'topology:route-outside-socket-root',
      '$.routes.guestBroker.directoryPath',
    )
  })

  it('uses POSIX path rules independently of the test host', () => {
    const manifest = JSON.parse(readFileSync(examplePath, 'utf8')) as Record<string, unknown>
    const protectedPaths = manifest.protectedPaths as Array<Record<string, unknown>>
    protectedPaths.find(item => item.kind === 'root-key')!.path = String.raw`C:\aukora\root.json`

    expectManifestRefusal(
      () => parseTopologyManifest(manifest),
      'topology:manifest-malformed',
      '$.protectedPaths[1].path',
    )
  })

  it('has no successful disposition before separation evidence exists', () => {
    const matched = topologyDisposition([])
    const refused = topologyDisposition([{ reason: 'test:refused', subject: 'test', detail: 'control' }])

    expect(matched).toEqual({ status: 'UNVERIFIED', configurationMatched: true })
    expect(refused).toEqual({ status: 'REFUSED', configurationMatched: false })
    expect([topologyCliExitCode(matched.status), topologyCliExitCode(refused.status)]).toEqual([2, 1])
    expect([topologyCliExitCode(matched.status), topologyCliExitCode(refused.status)]).not.toContain(0)
  })

  it('labels usage and unreadable input as input-only without claiming live facts', () => {
    const binPath = join(repoRoot, 'aukora/supervisor/bin.mjs')
    const usage = spawnSync(process.execPath, [binPath], { encoding: 'utf8' })
    const unreadable = spawnSync(process.execPath, [binPath, join(repoRoot, 'does-not-exist-topology.json')], { encoding: 'utf8' })

    expect(usage.status).toBe(1)
    expect(JSON.parse(usage.stdout)).toMatchObject({
      schema: 'aukora:topology-input-refusal:v1',
      status: 'REFUSED',
      factsSource: 'none',
      configurationMatched: false,
      refusals: [{ reason: 'topology:usage' }],
    })
    expect(unreadable.status).toBe(1)
    expect(JSON.parse(unreadable.stdout)).toMatchObject({
      schema: 'aukora:topology-input-refusal:v1',
      factsSource: 'none',
      refusals: [{ reason: 'topology:manifest-unreadable' }],
    })
  })

  it('labels malformed JSON as input-only rather than live observation', () => {
    const root = makeTemporaryRoot()
    const manifestPath = join(root, 'malformed.json')
    writeFileSync(manifestPath, '{not-json\n')

    const result = spawnSync(process.execPath, [join(repoRoot, 'aukora/supervisor/bin.mjs'), manifestPath], { encoding: 'utf8' })
    const refusal = JSON.parse(result.stdout) as Record<string, unknown>

    expect(result.status).toBe(1)
    expect(refusal).toMatchObject({
      schema: 'aukora:topology-input-refusal:v1',
      factsSource: 'none',
      refusals: [{ reason: 'topology:manifest-malformed', subject: '$' }],
    })
  })
})

describe.skipIf(!supportedHost)('live topology observation', () => {
  it('derives repeated principal UIDs from the host and refuses the merge', () => {
    const root = makeTemporaryRoot()
    const account = userInfo().username
    const manifest = makeManifest(root, account, primaryGroupName(account))

    const observation = inspectTopology(manifest)

    expect(observation.humanSession.uid).toBe(userInfo().uid)
    expect(observation.observer).toEqual({
      source: 'invoking-process-user',
      uid: userInfo().uid,
      privilegeClass: userInfo().uid === 0 ? 'PRIVILEGED' : 'UNPRIVILEGED',
      serviceStateTraversalClaimed: false,
    })
    expect(observation.principals.issuer?.uid).toBe(userInfo().uid)
    expect(observation.principals.broker?.uid).toBe(userInfo().uid)
    expect(observation.principals.guest?.uid).toBe(userInfo().uid)
    expect(observation.refusals).toContainEqual(expect.objectContaining({
      reason: 'supervisor:principals-merged',
      subject: 'human-session,issuer,broker,guest',
    }))
    expect(observation.refusals.some(refusal => refusal.reason === 'supervisor:route-groups-merged'
      && refusal.subject === 'humanIssuer,brokerIssuer,guestBroker'
      && refusal.detail.includes('live gid'))).toBe(true)
    const outsiderRefusals = observation.refusals.filter(refusal => refusal.reason === 'supervisor:route-outsider-group-member')
    expect(outsiderRefusals.some(refusal => refusal.subject === 'humanIssuer'
      && refusal.detail.startsWith('issuer is also'))).toBe(false)
    expect(outsiderRefusals.some(refusal => refusal.subject === 'brokerIssuer'
      && refusal.detail.startsWith('issuer is also'))).toBe(false)
    expect(outsiderRefusals.some(refusal => refusal.subject === 'guestBroker'
      && refusal.detail.startsWith('broker is also'))).toBe(false)
    expect(observation.separationVerified).toBe(false)
    expect(observation.verificationBlockers).toContain('supervisor:observer-privilege-unresolved')
  })

  it('positively observes live files, directories, and Unix sockets before refusing merged principals', async () => {
    const root = makeTemporaryRoot()
    const account = userInfo().username
    const manifest = makeManifest(root, account, primaryGroupName(account))
    materializeProtectedPaths(manifest)
    await materializeRouteSockets(manifest)

    const observation = inspectTopology(manifest)

    expect(Object.values(observation.protectedPaths).every(item => item !== null && item.type !== 'unobservable')).toBe(true)
    expect(Object.values(observation.routes).every(route => route.directory?.type === 'directory' && route.socket?.type === 'socket')).toBe(true)
    expect(observation.refusals.filter(refusal => refusal.reason.startsWith('supervisor:path-'))).toEqual([])
    expect(observation.refusals).toContainEqual(expect.objectContaining({
      reason: 'supervisor:ancestor-posix-replaceable-by-guest',
      subject: 'routes.guestBroker.socketPath',
    }))
    expect(observation.status).toBe('REFUSED')
    expect(observation.observationClass).toBe('CONFIGURATION_ONLY')
    expect(observation.activationPerformed).toBe(false)
    expect(observation.hostMutationPerformed).toBe(false)
    expect(observation.separationVerified).toBe(false)
  })

  it('refuses an exact protected leaf beneath a guest-replaceable ancestor', async () => {
    const root = makeTemporaryRoot()
    const account = userInfo().username
    const manifest = makeManifest(root, account, primaryGroupName(account))
    materializeProtectedPaths(manifest)
    await materializeRouteSockets(manifest)

    const observation = inspectTopology(manifest)

    expect(observation.protectedPaths['receipt-key']).toMatchObject({ type: 'file', mode: 0o600 })
    expect(observation.refusals.some(refusal => refusal.reason === 'supervisor:ancestor-posix-replaceable-by-guest'
      && refusal.subject === 'protectedPaths.receipt-key'
      && refusal.detail.includes(root))).toBe(true)
  })

  it('refuses an intermediate symlink even when the final protected leaf is exact', () => {
    const root = makeTemporaryRoot()
    const account = userInfo().username
    const manifest = makeManifest(root, account, primaryGroupName(account))
    const realDirectory = join(root, 'real-broker-key')
    const aliasDirectory = join(root, 'alias-broker-key')
    mkdirSync(realDirectory)
    symlinkSync(realDirectory, aliasDirectory, 'dir')
    manifest.protectedPaths.find(item => item.kind === 'receipt-key')!.path = join(aliasDirectory, 'receipt.json')
    materializeProtectedPaths(manifest)

    const observation = inspectTopology(manifest)

    expect(observation.protectedPaths['receipt-key']).toMatchObject({ type: 'file', mode: 0o600 })
    expect(observation.refusals.some(refusal => refusal.reason === 'supervisor:ancestor-symlink'
      && refusal.subject === 'protectedPaths.receipt-key'
      && refusal.detail.includes(aliasDirectory))).toBe(true)
  })

  it('treats a guest-owned ancestor as replaceable even when its current mode has no write bit', () => {
    const root = makeTemporaryRoot()
    const account = userInfo().username
    const manifest = makeManifest(root, account, primaryGroupName(account))
    materializeProtectedPaths(manifest)
    const receiptKey = manifest.protectedPaths.find(item => item.kind === 'receipt-key')!.path
    const guestOwnedAncestor = dirname(receiptKey)
    chmodSync(guestOwnedAncestor, 0o500)

    let observation: ReturnType<typeof inspectTopology>
    try {
      observation = inspectTopology(manifest)
    }
    finally {
      chmodSync(guestOwnedAncestor, 0o700)
    }

    expect(observation.refusals.some(refusal => refusal.reason === 'supervisor:ancestor-posix-replaceable-by-guest'
      && refusal.subject === 'protectedPaths.receipt-key'
      && refusal.detail.includes(`ancestor ${guestOwnedAncestor}`)
      && refusal.detail.includes('live POSIX mode 0500'))).toBe(true)
  })

  it('detects a live mode mutation rather than trusting fixture intent', async () => {
    const root = makeTemporaryRoot()
    const account = userInfo().username
    const manifest = makeManifest(root, account, primaryGroupName(account))
    materializeProtectedPaths(manifest)
    await materializeRouteSockets(manifest)
    const receiptKey = manifest.protectedPaths.find(item => item.kind === 'receipt-key')!.path
    chmodSync(receiptKey, 0o666)

    const observation = inspectTopology(manifest)

    expect(observation.refusals).toContainEqual(expect.objectContaining({
      reason: 'supervisor:path-mode-mismatch',
      subject: 'protectedPaths.receipt-key',
      detail: 'live mode is 0666; required mode is 0600',
    }))
  })

  it('names unobserved principals and absent objects without modifying the manifest directory', () => {
    const root = makeTemporaryRoot()
    const missingAccount = `aukora_missing_${process.pid}`
    const manifest = makeManifest(root, missingAccount, `aukora_missing_group_${process.pid}`)
    const manifestPath = join(root, 'topology.json')
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`)
    const before = readdirSync(root).sort()

    const result = spawnSync(process.execPath, [join(repoRoot, 'aukora/supervisor/bin.mjs'), manifestPath], { encoding: 'utf8' })
    const observation = JSON.parse(result.stdout) as ReturnType<typeof inspectTopology>

    expect(result.status).toBe(1)
    expect(result.stderr).toBe('')
    expect(observation.refusals.some(refusal => refusal.reason === 'supervisor:principal-unobserved'
      && refusal.subject === 'issuer'
      && refusal.detail.includes(missingAccount))).toBe(true)
    expect(observation.refusals.some(refusal => refusal.reason === 'supervisor:path-absent'
      && refusal.detail.includes('absence is not evidence of denial'))).toBe(true)
    expect(observation.hostMutationPerformed).toBe(false)
    expect(observation.separationVerified).toBe(false)
    expect(readdirSync(root).sort()).toEqual(before)
  })
})

function makeTemporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'aukora-topology-'))
  chmodSync(root, 0o755)
  temporaryRoots.push(root)
  return root
}

function primaryGroupName(account: string): string {
  return execFileSync('/usr/bin/id', ['-gn', account], { encoding: 'utf8' }).trim()
}

function makeManifest(root: string, account: string, group: string) {
  return {
    schema: 'aukora:launch-topology:v1',
    platform: process.platform,
    humanSession: {
      source: 'invoking-process-user',
      approvalJobLabel: 'test.aukora.approval',
    },
    services: {
      issuer: { account, jobLabel: 'test.aukora.issuer' },
      broker: { account, jobLabel: 'test.aukora.broker' },
      guest: { account, jobLabel: 'test.aukora.guest' },
    },
    routes: {
      humanIssuer: route(join(root, 'human-issuer'), group),
      brokerIssuer: route(join(root, 'broker-issuer'), group),
      guestBroker: route(join(root, 'guest-broker'), group),
    },
    protectedPaths: [
      { kind: 'socket-root', path: root },
      { kind: 'root-key', path: join(root, 'state/issuer/root.json') },
      { kind: 'receipt-key', path: join(root, 'state/broker/receipt.json') },
      { kind: 'nonce-state', path: join(root, 'state/broker/nonces') },
      { kind: 'evidence', path: join(root, 'state/broker/aura.jsonl') },
      { kind: 'active-profile', path: join(root, 'active/profile') },
      { kind: 'active-artifact', path: join(root, 'active/artifact') },
      { kind: 'implementation-closure', path: join(root, 'active/implementation') },
      { kind: 'guest-scratch', path: join(root, 'guest/scratch') },
    ],
  }
}

function route(directoryPath: string, group: string) {
  return { group, directoryPath, socketPath: join(directoryPath, 'service.sock') }
}

function materializeProtectedPaths(manifest: ReturnType<typeof makeManifest>): void {
  const directoryModes = new Map([
    ['socket-root', 0o755],
    ['nonce-state', 0o700],
    ['active-profile', 0o555],
    ['active-artifact', 0o555],
    ['implementation-closure', 0o555],
    ['guest-scratch', 0o700],
  ])
  for (const item of manifest.protectedPaths) {
    const directoryMode = directoryModes.get(item.kind)
    if (directoryMode !== undefined) {
      mkdirSync(item.path, { recursive: true })
      chmodSync(item.path, directoryMode)
    }
    else {
      mkdirSync(dirname(item.path), { recursive: true })
      writeFileSync(item.path, '{}\n')
      chmodSync(item.path, 0o600)
    }
  }
}

async function materializeRouteSockets(manifest: ReturnType<typeof makeManifest>): Promise<void> {
  for (const routeValue of Object.values(manifest.routes)) {
    mkdirSync(routeValue.directoryPath, { recursive: true })
    chmodSync(routeValue.directoryPath, 0o710)
    const server = createServer()
    liveServers.push(server)
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject)
      server.listen(routeValue.socketPath, resolveListen)
    })
    chmodSync(routeValue.socketPath, 0o660)
  }
}

function expectManifestRefusal(action: () => unknown, reason: string, subject: string): void {
  let caught: unknown
  try {
    action()
  }
  catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(TopologyManifestError)
  expect((caught as TopologyManifestError).reason).toBe(reason)
  expect((caught as TopologyManifestError).subject).toBe(subject)
}
