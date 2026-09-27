/** The public Node entry requires build:lib:host for its Cordis dependencies. */
import { spawnSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as loadYaml } from 'js-yaml'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as brokerModule from '../aukora/broker/broker.mjs'
import {
  launchDeveloperAssembly,
  readDeveloperWorkspaceRoots,
} from '../aukora/supervisor/developer-launch.mjs'
import { loadOrCreateLocalAumlokControl } from '../aukora/identity/local-control-store.mjs'
import { createDeveloperAumlokAuthority } from '../aukora/supervisor/developer-aumlok.mjs'

const REPOSITORY = fileURLToPath(new URL('..', import.meta.url))
const WEB_ENTRY = join(REPOSITORY, 'aukora/supervisor/developer-web-bin.mjs')
const scratchDirectories: string[] = []

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'aw-')))
  scratchDirectories.push(root)
  const workspace = join(root, 'workspace')
  mkdirSync(workspace, { mode: 0o700 })
  return { root, workspace, controlDir: join(root, 'control'), dataDir: join(root, 'data') }
}

function runCli(args: string[]) {
  return spawnSync(process.execPath, [WEB_ENTRY, ...args], {
    cwd: REPOSITORY,
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 64 * 1024,
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of scratchDirectories.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('operator workspace root selection', () => {
  it('captures immutable names and does not change the caller record', () => {
    const { workspace, controlDir, dataDir } = fixture()
    const input = { code: workspace }
    const roots = readDeveloperWorkspaceRoots(input, [controlDir, dataDir])
    input.code = '/changed-after-selection'
    expect(roots).toEqual({ code: workspace })
    expect(Object.isFrozen(roots)).toBe(true)
    expect(existsSync(controlDir)).toBe(false)
    expect(existsSync(dataDir)).toBe(false)
    expect(readDeveloperWorkspaceRoots({})).toEqual({})
  })

  it('refuses accessors, inherited configuration, hidden names, and path-like aliases', () => {
    const { workspace } = fixture()
    let reads = 0
    const accessor = { get code() { reads++; return workspace } }
    expect(() => readDeveloperWorkspaceRoots(accessor)).toThrow('supervisor:workspace-roots-invalid')
    expect(reads).toBe(0)
    expect(() => readDeveloperWorkspaceRoots(Object.create({ code: workspace }) as Record<string, string>)).toThrow('supervisor:workspace-roots-invalid')
    expect(() => readDeveloperWorkspaceRoots(Object.defineProperty({}, 'code', { value: workspace }))).toThrow('supervisor:workspace-roots-invalid')
    expect(() => readDeveloperWorkspaceRoots({ '../code': workspace })).toThrow('supervisor:workspace-alias-invalid')
  })

  it('rejects either direction of overlap before creating protected directories', () => {
    const { root, workspace, controlDir, dataDir } = fixture()
    for (const protectedPath of [workspace, root, join(workspace, 'not-created')]) {
      expect(() => readDeveloperWorkspaceRoots({ code: workspace }, [protectedPath])).toThrow('supervisor:workspace-protected-path-overlap')
    }
    expect(() => readDeveloperWorkspaceRoots({ code: root }, [controlDir, dataDir])).toThrow('supervisor:workspace-protected-path-overlap')
    expect(existsSync(join(workspace, 'not-created'))).toBe(false)
    expect(existsSync(controlDir)).toBe(false)
    expect(existsSync(dataDir)).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('rejects symlinked roots and detects protected paths behind parent aliases', () => {
    const { root, workspace } = fixture()
    const alias = join(root, 'workspace-link')
    symlinkSync(workspace, alias)
    expect(() => readDeveloperWorkspaceRoots({ code: alias })).toThrow('supervisor:workspace-root-not-canonical')
    expect(() => readDeveloperWorkspaceRoots({ code: workspace }, [join(alias, 'control')])).toThrow('supervisor:workspace-protected-path-overlap')
    expect(existsSync(join(workspace, 'control'))).toBe(false)
  })
})

describe('existing governed Web CLI workspace option', () => {
  it.each([
    ['missing separator', (workspace: string) => ['--workspace', workspace], 'aukora:web:workspace-argument-invalid'],
    ['empty path', () => ['--workspace', 'code='], 'aukora:web:workspace-argument-invalid'],
    ['invalid name', (workspace: string) => ['--workspace', `../code=${workspace}`], 'supervisor:workspace-alias-invalid'],
    ['relative root', () => ['--workspace', 'code=relative'], 'supervisor:workspace-root-not-canonical'],
    ['noncanonical root', (workspace: string) => ['--workspace', `code=${workspace}/.`], 'supervisor:workspace-root-not-canonical'],
    ['absent root', (workspace: string) => ['--workspace', `code=${workspace}/missing`], 'supervisor:workspace-root-unavailable'],
    ['duplicate alias', (workspace: string) => ['--workspace', `code=${workspace}`, '--workspace', `code=${workspace}`], 'aukora:web:workspace-alias-duplicate'],
  ] as const)('refuses %s before controller or data creation', (_label, extraArgs, expected) => {
    const { workspace, controlDir, dataDir } = fixture()
    const result = runCli(['--control-dir', controlDir, '--data-dir', dataDir, ...extraArgs(workspace)])
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(expected)
    expect(result.stdout).not.toContain('READY')
    expect(existsSync(controlDir)).toBe(false)
    expect(existsSync(dataDir)).toBe(false)
  })

  it('refuses overlap with a not-yet-created control or data directory', () => {
    const { root, controlDir, dataDir } = fixture()
    const result = runCli(['--workspace', `code=${root}`, '--control-dir', controlDir, '--data-dir', dataDir])
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('supervisor:workspace-protected-path-overlap')
    expect(existsSync(controlDir)).toBe(false)
    expect(existsSync(dataDir)).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('refuses a symlink root before loading the controller', () => {
    const { root, workspace, controlDir, dataDir } = fixture()
    const linked = join(root, 'linked-workspace')
    symlinkSync(workspace, linked)
    const result = runCli(['--control-dir', controlDir, '--data-dir', dataDir, '--workspace', `code=${linked}`])
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('supervisor:workspace-root-not-canonical')
    expect(existsSync(controlDir)).toBe(false)
    expect(existsSync(dataDir)).toBe(false)
  })

  it('accepts distinct repeated aliases before the ordinary durable-root validation', () => {
    const { workspace, dataDir } = fixture()
    const controlDir = join(REPOSITORY, '.workspace-launch-prohibited-control')
    const result = runCli([
      '--workspace', `code=${workspace}`, '--workspace', `notes=${workspace}`,
      '--control-dir', controlDir, '--data-dir', dataDir,
    ])
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('is inside this checkout; durable state belongs outside the source tree')
    expect(existsSync(controlDir)).toBe(false)
    expect(existsSync(dataDir)).toBe(false)
  })
})

describe.runIf(typeof process.geteuid === 'function')('developer assembly workspace forwarding', () => {
  it('passes a detached frozen alias map to the broker launch', async () => {
    const { root, workspace } = fixture()
    const keys = generateKeyPairSync('ed25519')
    const rootPrivateKeyFile = join(root, 'issuer-private.pem')
    const rootPublicKeyFile = join(root, 'issuer-public.pem')
    writeFileSync(rootPrivateKeyFile, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
    writeFileSync(rootPublicKeyFile, keys.publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o600 })
    const spawn = vi.spyOn(brokerModule, 'spawnBroker').mockRejectedValue(new Error('test:broker-forwarding-observed'))
    const input = { code: workspace }
    await expect(launchDeveloperAssembly({
      runtimeDir: join(root, 'runtime'), rootPrivateKeyFile, rootPublicKeyFile,
      rendererId: 'ab'.repeat(32), workspaceRoots: input,
      review: () => 'denied', issuerApproval: () => 'denied',
    })).rejects.toThrow('test:broker-forwarding-observed')
    expect(spawn).toHaveBeenCalledTimes(1)
    const received = spawn.mock.calls[0]?.[0].workspaceRoots
    expect(received).toEqual({ code: workspace })
    expect(received).not.toBe(input)
    expect(Object.isFrozen(received)).toBe(true)
  }, 30_000)

  it('threads the provisioned broker public key into the generated capsule overlay', async () => {
    const { root, workspace } = fixture()
    const control = loadOrCreateLocalAumlokControl(join(root, 'control'))
    const rootPrivateKeyFile = join(root, 'issuer-private.pem')
    const rootPublicKeyFile = join(root, 'issuer-public.pem')
    writeFileSync(rootPrivateKeyFile, control.record.ed25519PrivateKeyPem, { mode: 0o600 })
    writeFileSync(rootPublicKeyFile, control.ed25519PublicKeyPem, { mode: 0o600 })
    const authority = createDeveloperAumlokAuthority(control, { audience: 'broker:developer-web' })
    // The broker never runs: staging writes the overlay before any spawn, so
    // a pin found in the overlay cannot have come from a broker reply.
    const spawn = vi.spyOn(brokerModule, 'spawnBroker').mockRejectedValue(new Error('test:pin-forwarding-observed'))
    const runtimeDir = join(root, 'runtime')
    const dataDir = join(root, 'data')
    await expect(launchDeveloperAssembly({
      runtimeDir, dataDir, rootPrivateKeyFile, rootPublicKeyFile,
      rootControlState: control.activeControl,
      rendererId: 'ab'.repeat(32),
      workspaceRoots: { code: workspace },
      web: { port: 18791 },
      webAumlokProjection: authority.projection,
      kiraRecallPolicy: { subject: control.subject, privacy: ['private'] },
      selectSubjectAuthority: authority.selectSubjectAuthority,
      subjectAuthorityExpectation: authority.subjectAuthorityExpectation,
      webCapsule: {
        worker: { kind: 'opencode', executable: process.execPath, defaultModel: 'fixture/local',
          maxOutputBytes: 1024, maxSpillBytes: 2048, disposeGraceMs: 100 },
        protectedChecks: [{ id: 'pin-check', program: 'process.exit(0)', timeoutMs: 1000 }],
      },
      review: () => 'denied', issuerApproval: () => 'denied',
    })).rejects.toThrow('test:pin-forwarding-observed')
    expect(spawn).toHaveBeenCalledTimes(1)
    const overlayPath = join(dataDir, 'dsh-home', 'profiles', 'aukora-web', 'helix-capsule.overlay.yml')
    expect(existsSync(overlayPath)).toBe(true)
    interface StagedBrokerConfig {
      socketPath: string
      workspaceAliases: Record<string, string>
      receiptPublicKeyPem: string
    }
    const overlay = JSON.parse(readFileSync(overlayPath, 'utf8')) as Array<{
      insert: Array<{ id: string; config: { broker: StagedBrokerConfig } }>
    }>
    const brokerConfig = overlay[0]?.insert[0]?.config.broker
    expect(brokerConfig?.workspaceAliases).toEqual({ code: workspace })
    // Independence: the pin equals the parent-provisioned state key, read
    // back from disk — the broker never ran to supply it.
    const provisioned = JSON.parse(
      readFileSync(join(dataDir, 'broker-state', 'keys', 'broker.json'), 'utf8'),
    ) as { publicPem: string }
    expect(typeof provisioned.publicPem).toBe('string')
    expect(brokerConfig?.receiptPublicKeyPem).toBe(provisioned.publicPem)
    for (const [name, inheritedTools] of [
      ['aukora', ['workspace.patch', 'capsule']],
      ['aukora-capsule-worker', ['workspace.patch']],
    ] as const) {
      const compositionPath = join(dataDir, 'dsh-home', 'agent-presets', name, 'agent.cordis.yml')
      const composition = loadYaml(readFileSync(compositionPath, 'utf8')) as Array<{
        id: string
        config: Array<{ id: string; config: unknown }>
      }>
      const kira = composition.find(row => row.id === 'kira')?.config.find(row => row.id === 'kira-routes')
      expect(kira?.config).toEqual({
        restrictGlobalToolsToMemoryPut: true,
        additionalInheritedTools: inheritedTools,
      })
    }
  }, 120_000)
})
