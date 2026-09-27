/** Assembled same-UID parent launch through the real ToolRuntime. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import childProcess, { spawn } from 'node:child_process'
import { createHash, generateKeyPairSync, type KeyObject } from 'node:crypto'
import { EventEmitter } from 'node:events'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { createConnection, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'
import { load as loadYaml } from 'js-yaml'
import {
  DEVELOPER_OBSERVATION_CLASS,
  DeveloperLaunchError,
  buildSourceActivationStatement,
  launchDeveloperAssembly as launchDeveloperAssemblyWithRenderer,
  parseDeveloperLaunchConfig,
  parseDeveloperLiveTurn,
  parseDeveloperMemoryPut,
  prepareWebUpgradeStatement,
  SOURCE_LIVE_TURN_OVERLAY_SHA256,
  SOURCE_PROFILE_PATCH_SHA256,
  sourceOutcomeExitCode,
  validateLiveTurnOverlays,
  validateSourceProfileManifest,
  validateSourceProfilePatch,
  type DeveloperAssembly,
} from '../aukora/supervisor/developer-launch.mjs'
import {
  AUKORA_MEMORY_REFUSED,
  classifyMemoryToolResult,
} from '../aukora/broker/public-outcome.mjs'
import { MEMORY_PUT_PROPOSAL_WASM_SHA256 } from '../aukora/guest/wasm-proposal-cell.mjs'
import { activationDigest } from '../aukora/activation/statement.mjs'
import { activationBindingPath, readActivationBinding } from '../aukora/activation/broker-state.mjs'
import { readAuthorityEvidence } from '../aukora/aura/authority-evidence.mjs'
import { effectBody } from '../aukora/broker/operation.mjs'
import { createDelegationClaim, delegationClaimDigest } from '../aukora/identity/delegation.mjs'
import {
  AUMLOK_ROOT_CONTROL_SUITE,
  createInitialIdentityControl,
  identityControlDigest,
  rootKeySetId,
  type RootControlStateV1,
} from '../aukora/identity/control.mjs'
import { createIdentityGenesis } from '../aukora/identity/genesis.mjs'
import { loadOrCreateLocalAumlokControl } from '../aukora/identity/local-control-store.mjs'
import { mintGrant } from '../aukora/issuer/mint.mjs'
import { createDeveloperAumlokAuthority } from '../aukora/supervisor/developer-aumlok.mjs'
import { stageKiraMemoryRecord } from '../aukora/kira/stage.mjs'

const tempRoots: string[] = []
const assemblies: DeveloperAssembly[] = []
const commandChildren: ReturnType<typeof spawn>[] = []
const orphanCandidates: number[] = []
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const TEST_RENDERER_ID = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex')
const SOURCE_GUEST = join(ROOT, 'aukora', 'supervisor', 'developer-guest.mjs')
const SOURCE_TURN_GUEST = join(ROOT, 'aukora', 'supervisor', 'developer-guest-turn.mjs')
const LIVE_TURN_OVERLAY = join(ROOT, 'aukora', 'supervisor', 'live-turn.overlay.yml')
const TSX_ESM_IMPORT = createRequire(import.meta.url).resolve('tsx/esm')

interface GovernedGuestFixture {
  home: string
  marker: string
}

interface GuestLaunchResult {
  code: number | null
  signal: NodeJS.Signals | null
  messages: unknown[]
  stderr: string
}

interface GovernedGuestLaunchOptions {
  entry?: string
  liveTurn?: boolean
  /** Preserve package symlinks only for the Loader-module-identity coverage. */
  preserveSymlinks?: boolean
}

/** Bind every in-module test renderer callback to this fixture's exact bytes. */
function launchDeveloperAssembly(
  options: Omit<Parameters<typeof launchDeveloperAssemblyWithRenderer>[0], 'rendererId'>,
): Promise<DeveloperAssembly> {
  return launchDeveloperAssemblyWithRenderer({ ...options, rendererId: TEST_RENDERER_ID })
}

afterEach(async () => {
  for (const child of commandChildren.splice(0)) {
    await stopCommandChild(child)
  }
  for (const pid of orphanCandidates.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
  for (const assembly of assemblies.splice(0).reverse()) await assembly.close()
  for (const root of tempRoots.splice(0).reverse()) rmSync(root, { recursive: true, force: true })
})

async function stopCommandChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolveExit, reject) => {
    const cleanup = () => {
      clearTimeout(forceTimer)
      clearTimeout(ceilingTimer)
      child.removeListener('error', onError)
      child.removeListener('exit', onExit)
    }
    const onError = (error: Error) => { cleanup(); reject(error) }
    const onExit = () => { cleanup(); resolveExit() }
    child.once('error', onError)
    child.once('exit', onExit)
    const forceTimer = setTimeout(() => { child.kill('SIGKILL') }, 1_000)
    const ceilingTimer = setTimeout(() => {
      cleanup()
      reject(new Error('launcher child did not exit after SIGKILL'))
    }, 5_000)
    if (!child.kill('SIGTERM') && (child.exitCode !== null || child.signalCode !== null)) onExit()
  })
}

function keyFixture() {
  const root = mkdtempSync(join(tmpdir(), 'aukora-parent-launch-'))
  tempRoots.push(root)
  const keys = generateKeyPairSync('ed25519')
  const privatePath = join(root, 'root-private.pem')
  const publicPath = join(root, 'root-public.pem')
  writeFileSync(privatePath, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  writeFileSync(publicPath, keys.publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o600 })
  chmodSync(privatePath, 0o600)
  chmodSync(publicPath, 0o600)
  return { privateKey: keys.privateKey, privatePath, publicKey: keys.publicKey, publicPath, root }
}

/** Create one persistent local controller and the issuer files derived from it. */
function webAumlokFixture() {
  const root = mkdtempSync(join(tmpdir(), 'aukora-parent-web-'))
  tempRoots.push(root)
  const control = loadOrCreateLocalAumlokControl(join(root, 'control'))
  const privatePath = join(root, 'root-private.pem')
  const publicPath = join(root, 'root-public.pem')
  writeFileSync(privatePath, control.record.ed25519PrivateKeyPem, { mode: 0o600 })
  writeFileSync(publicPath, control.ed25519PublicKeyPem, { mode: 0o600 })
  const authority = createDeveloperAumlokAuthority(control, {
    audience: 'broker:source-launch',
  })
  return { authority, control, privatePath, publicPath, root }
}

/** Return the lowercase SHA-256 of one fixture-owned file. */
function fixtureFileSha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Build one active control head whose Ed25519 key is the source-launch root. */
function rootControlFixture(publicKey: KeyObject): RootControlStateV1 {
  const exported = publicKey.export({ format: 'jwk' })
  if (typeof exported.x !== 'string') throw new Error('source-launch root omitted its raw public key')
  const publicKeys = {
    ed25519: Buffer.from(exported.x, 'base64url').toString('hex'),
    mlDsa65: Buffer.from(ml_dsa65.keygen(new Uint8Array(32).fill(9)).publicKey).toString('hex'),
  }
  const genesis = createIdentityGenesis({
    genesisNonce: '10'.repeat(32),
    initialRootKeySetId: rootKeySetId(publicKeys),
    amendmentRuleDigest: '20'.repeat(32),
  })
  return createInitialIdentityControl(genesis, {
    suite: AUMLOK_ROOT_CONTROL_SUITE,
    publicKeys,
    authorizedAt: 1,
  })
}

/** Create the smallest custom profile accepted by the exact source guest. */
function createGovernedGuestFixture(
  patch: string,
  files: Readonly<Record<string, string>>,
): GovernedGuestFixture {
  const home = mkdtempSync(join(tmpdir(), 'aukora-governed-guest-'))
  tempRoots.push(home)
  const profileDir = join(home, 'profiles', '8088-inside-out')
  mkdirSync(profileDir, { recursive: true })
  for (const [name, content] of Object.entries(files)) writeFileSync(join(profileDir, name), content)
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-8088-inside-out',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: [] } },
  }, undefined, 2))
  writeFileSync(
    join(profileDir, 'cordis.patch.yml'),
    patch.replaceAll('__PROFILE__/', pathToFileURL(`${profileDir}/`).href),
  )
  return { home, marker: join(home, 'marker') }
}

/** Run the production source guest under a direct IPC parent until it exits. */
function runGovernedSourceGuest(
  fixture: GovernedGuestFixture,
  options: GovernedGuestLaunchOptions = {},
): Promise<GuestLaunchResult> {
  const entry = options.entry ?? SOURCE_GUEST
  const liveTurnEnvironment = options.liveTurn
    ? { AUKORA_LIVE_TURN_OVERLAY: LIVE_TURN_OVERLAY, AUKORA_LIVE_TURN_MODE: 'live' }
    : {}
  const env: NodeJS.ProcessEnv = {
    DSH_HOME: fixture.home,
    DSH_TELEMETRY_DISABLED: '1',
    GOVERNED_PROFILE_MARKER: fixture.marker,
    LANG: process.env.LANG ?? 'C.UTF-8',
    ...liveTurnEnvironment,
  }
  if (typeof process.env.PATH === 'string') env.PATH = process.env.PATH
  if (options.preserveSymlinks ?? true) {
    env.NODE_OPTIONS = [process.env.NODE_OPTIONS, '--preserve-symlinks'].filter(Boolean).join(' ')
  }
  const child = spawn(process.execPath, ['--import', TSX_ESM_IMPORT, entry], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  })
  commandChildren.push(child)
  return new Promise((resolveRun, rejectRun) => {
    let stderr = ''
    const messages: unknown[] = []
    const timer = setTimeout(() => {
      cleanup()
      child.kill('SIGKILL')
      rejectRun(new Error('governed source guest did not exit during refusal preflight'))
    }, 10_000)
    const cleanup = () => {
      clearTimeout(timer)
      child.removeListener('error', onError)
      child.removeListener('close', onClose)
    }
    const onError = (error: Error) => {
      cleanup()
      rejectRun(error)
    }
    const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup()
      resolveRun({ code, signal, messages, stderr })
    }
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('message', (message: unknown) => { messages.push(message) })
    child.once('error', onError)
    child.once('close', onClose)
  })
}

function brokerRequest(socketPath: string, request: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolveReply, rejectReply) => {
    const socket = createConnection(socketPath)
    let buffer = ''
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      callback()
    }
    const timer = setTimeout(() => {
      finish(() => { rejectReply(new Error('broker request timed out')) })
    }, 5_000)
    socket.once('connect', () => { socket.write(`${JSON.stringify(request)}\n`) })
    socket.once('error', (error) => { finish(() => { rejectReply(error) }) })
    socket.once('close', () => {
      finish(() => { rejectReply(new Error('broker closed without a reply')) })
    })
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const cut = buffer.indexOf('\n')
      if (cut === -1) return
      finish(() => {
        try {
          resolveReply(JSON.parse(buffer.slice(0, cut)) as Record<string, unknown>)
        } catch (error) {
          rejectReply(error instanceof Error ? error : new Error(String(error)))
        }
      })
    })
  })
}

/** Ask the host for one currently unused loopback port, then release it. */
async function unusedLoopbackPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { resolveListen() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new Error('loopback server did not receive an IP port')
  }
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => {
      if (error === undefined) resolveClose()
      else reject(error)
    })
  })
  return address.port
}

function createSubjectAuthorityFactory(
  key: string,
  subject: string,
  activationOverride?: string,
  selectedControlDigest = '12'.repeat(32),
) {
  return (activationDigest: string) => {
    const boundActivation = activationOverride ?? activationDigest
    const controlDigest = selectedControlDigest
    const resource = `memory:key:${key}`
    const now = Math.floor(Date.now() / 1000)
    const parent = createDelegationClaim({
      subject,
      kind: 'session',
      parentDigest: '34'.repeat(32),
      controlDigest,
      childKeyId: '56'.repeat(32),
      operations: ['memory.put', 'workspace.patch'],
      resources: [resource, 'memory:key:other'],
      audiences: ['broker:source-launch', 'broker:recovery'],
      activationDigests: [boundActivation, '78'.repeat(32)],
      budgets: { calls: 2, bytes: 16_384, computeMs: 1, costMicrounits: 1 },
      notBefore: now - 60,
      expiresAt: now + 600,
      revocationId: 'source-launch:session',
      nonce: '9a'.repeat(32),
    })
    const agent = createDelegationClaim({
      subject,
      kind: 'agent',
      parentDigest: delegationClaimDigest(parent),
      controlDigest,
      childKeyId: 'bc'.repeat(32),
      operations: ['memory.put'],
      resources: [resource],
      audiences: ['broker:source-launch'],
      activationDigests: [boundActivation],
      budgets: { calls: 1, bytes: 8_192, computeMs: 0, costMicrounits: 0 },
      notBefore: now - 30,
      expiresAt: now + 480,
      revocationId: 'source-launch:agent',
      nonce: 'de'.repeat(32),
    })
    return {
      subject,
      activeControlDigest: controlDigest,
      activationDigest: boundActivation,
      audience: 'broker:source-launch',
      parentDelegationClaim: parent,
      delegationClaim: agent,
    }
  }
}

describe('parent-owned governed source launch', () => {
  it('refuses malformed and widened launch configuration', () => {
    const valid = {
      schema: 'aukora:developer-launch:v1',
      runtimeDir: '/private/tmp/aukora-runtime',
      rootPrivateKeyFile: '/private/tmp/root-private.pem',
      rootPublicKeyFile: '/private/tmp/root-public.pem',
    }
    expect(parseDeveloperLaunchConfig(JSON.stringify(valid))).toEqual(valid)
    expect(parseDeveloperLaunchConfig(JSON.stringify({
      ...valid,
      kiraSubject: 'aukora:subject:owner',
      kiraPrivacy: ['private', 'local'],
    }))).toEqual({
      ...valid,
      kiraSubject: 'aukora:subject:owner',
      kiraPrivacy: ['local', 'private'],
    })
    expect(() => parseDeveloperLaunchConfig({
      ...valid,
      kiraSubject: 'aukora:subject:owner',
    })).toThrow('supervisor:kira-recall-policy-invalid')
    expect(() => parseDeveloperLaunchConfig({
      ...valid,
      kiraSubject: 'aukora:subject:owner',
      kiraPrivacy: ['shared'],
    })).toThrow('supervisor:kira-recall-policy-invalid')
    expect(() => parseDeveloperLaunchConfig({
      ...valid,
      kiraSubject: 'x'.repeat(1025),
      kiraPrivacy: ['local'],
    })).toThrow('supervisor:kira-recall-policy-invalid')
    expect(() => parseDeveloperLaunchConfig(' '.repeat(65_537))).toThrow('supervisor:launch-config-oversize')
    expect(() => parseDeveloperLaunchConfig({ ...valid, extra: true })).toThrow(DeveloperLaunchError)
    expect(() => parseDeveloperLaunchConfig({ ...valid, runtimeDir: 'relative' })).toThrow('supervisor:launch-path-malformed')
    expect(parseDeveloperLaunchConfig({
      ...valid,
      runtimeDir: '/private/tmp/Aukora Demo/运行',
      rootPrivateKeyFile: '/private/tmp/Mobile Documents/root private.pem',
    })).toMatchObject({
      runtimeDir: '/private/tmp/Aukora Demo/运行',
      rootPrivateKeyFile: '/private/tmp/Mobile Documents/root private.pem',
    })
    expect(() => parseDeveloperLaunchConfig({ ...valid, runtimeDir: '/private/tmp/bad\npath' })).toThrow(
      'supervisor:launch-path-malformed',
    )
    expect(() => parseDeveloperLaunchConfig({
      ...valid,
      rootPublicKeyFile: valid.rootPrivateKeyFile,
    })).toThrow('supervisor:launch-key-paths-collide')

    expect(parseDeveloperMemoryPut('{"key":"config.test","value":null}')).toEqual({
      key: 'config.test',
      value: null,
    })
    expect(() => parseDeveloperMemoryPut(' '.repeat(8193))).toThrow('supervisor:operation-oversize')
    expect(() => parseDeveloperMemoryPut('{')).toThrow('supervisor:operation-malformed')
    expect(() => parseDeveloperMemoryPut({ key: 'config.test', value: null, extra: true })).toThrow(
      'supervisor:operation-fields',
    )
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -0, 1n, Symbol('value')]) {
      expect(() => parseDeveloperMemoryPut({ key: 'config.test', value })).toThrow(
        'supervisor:operation-json-value',
      )
    }
    expect(() => parseDeveloperMemoryPut({ key: 'config.test', value: undefined })).toThrow(
      'supervisor:operation-fields',
    )
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    expect(() => parseDeveloperMemoryPut({ key: 'config.test', value: cyclic })).toThrow(
      'supervisor:operation-json-value',
    )
    expect(parseDeveloperLiveTurn(JSON.stringify({
      schema: 'aukora:live-turn:v1',
      prompt: 'Store one object.',
    }))).toEqual({
      schema: 'aukora:live-turn:v1',
      prompt: 'Store one object.',
    })
    expect(() => parseDeveloperLiveTurn({ schema: 'aukora:live-turn:v1', prompt: '' })).toThrow(
      'supervisor:live-turn-prompt',
    )
    expect(() => parseDeveloperLiveTurn({ schema: 'aukora:developer-launch:v1', prompt: 'x' })).toThrow(
      'supervisor:live-turn-schema',
    )
    expect(() => parseDeveloperMemoryPut({ key: 'config.test', value: new Date(0) })).toThrow(
      'supervisor:operation-json-value',
    )
    expect(() => parseDeveloperMemoryPut({ key: 'config.test', value: [, 'sparse'] })).toThrow(
      'supervisor:operation-json-value',
    )
    const mutable = { nested: ['before'] }
    const detached = parseDeveloperMemoryPut({ key: 'config.test', value: mutable })
    mutable.nested[0] = 'after'
    expect(detached).toEqual({ key: 'config.test', value: { nested: ['before'] } })
    expect(Object.isFrozen(detached.value)).toBe(true)
  })

  it('keeps the guest protocol module outside the authority implementation graph', () => {
    const protocol = readFileSync(join(ROOT, 'aukora', 'supervisor', 'developer-protocol.mjs'), 'utf8')
    const guest = readFileSync(join(ROOT, 'aukora', 'supervisor', 'developer-guest.mjs'), 'utf8')
    const turnGuest = readFileSync(join(ROOT, 'aukora', 'supervisor', 'developer-guest-turn.mjs'), 'utf8')
    const publicOutcome = readFileSync(join(ROOT, 'aukora', 'broker', 'public-outcome.mjs'), 'utf8')

    expect(protocol).not.toMatch(/^import /mu)
    expect(protocol.match(/from ['"][^'"]+['"]/gu)).toEqual([
      "from '../broker/public-outcome.mjs'",
    ])
    expect(publicOutcome).not.toMatch(/^\s*(?:import|export\s+.+\s+from)\s/mu)
    expect(guest).toContain("from './developer-protocol.mjs'")
    expect(guest).not.toContain("from './developer-launch.mjs'")
    expect(guest).not.toContain("from '../broker/broker.mjs'")
    expect(guest).not.toContain('loadLayeredEnv')
    expect(guest).toContain('createLaunchEnvironmentSnapshot')
    expect(turnGuest).toContain("from './developer-protocol.mjs'")
    expect(turnGuest).toContain('AUKORA_LIVE_TURN_OVERLAY')
    expect(turnGuest).not.toContain("from './developer-launch.mjs'")
    expect(turnGuest).not.toContain("from '../broker/broker.mjs'")
    expect(turnGuest).not.toContain('loadLayeredEnv')
  })

  it('retains parent disconnect across the guest startup window exactly once', async () => {
    const { createParentDisconnectLatch } = await import('../aukora/supervisor/developer-protocol.mjs') as unknown as {
      createParentDisconnectLatch(
        this: void,
        channel: EventEmitter & { connected: boolean },
      ): { attach(shutdown: () => void): void }
    }
    const earlyChannel = Object.assign(new EventEmitter(), { connected: true })
    const earlyLatch = createParentDisconnectLatch(earlyChannel)
    earlyChannel.connected = false
    earlyChannel.emit('disconnect')
    let earlyShutdowns = 0
    earlyLatch.attach(() => { earlyShutdowns += 1 })
    earlyChannel.emit('disconnect')
    expect(earlyShutdowns).toBe(1)

    const liveChannel = Object.assign(new EventEmitter(), { connected: true })
    const liveLatch = createParentDisconnectLatch(liveChannel)
    let liveShutdowns = 0
    liveLatch.attach(() => { liveShutdowns += 1 })
    liveChannel.connected = false
    liveChannel.emit('disconnect')
    expect(liveShutdowns).toBe(1)
  })

  it('admits the source-profile license without changing the zero-bundle composition', () => {
    const source = readFileSync(join(ROOT, 'profiles', '8088-inside-out', 'package.json'), 'utf8')
    expect(() => { validateSourceProfileManifest(source) }).not.toThrow()
    expect(() => {
      validateSourceProfileManifest(JSON.stringify({
        name: 'dsh-profile-8088-inside-out',
        private: true,
        dependencies: {},
        dsh: { profile: { bundles: [] } },
      }))
    }).not.toThrow()
  })

  it.each([
    ['different license', { license: 'MIT' }],
    ['executable license', { license: { '!!js': 'process.env' } }],
    ['different profile', { name: 'dsh-profile-web' }],
    ['public package', { private: false }],
    ['dependency', { dependencies: { '@deepseek-ai/dsh-tool-bash': 'workspace:^' } }],
    ['missing dependencies', { dependencies: undefined }],
    ['script', { scripts: { prepare: 'node inject.mjs' } }],
    ['bundle', { dsh: { profile: { bundles: ['@deepseek-ai/dsh-bundle-web-app'] } } }],
    ['non-array bundles', { dsh: { profile: { bundles: {} } } }],
    ['profile authority field', { dsh: { profile: { bundles: [], authority: 'ambient' } } }],
    ['DSH authority field', { dsh: { profile: { bundles: [] }, authority: 'ambient' } }],
  ])('refuses a source-profile %s alongside license metadata', (_label, change) => {
    const manifest = {
      name: 'dsh-profile-8088-inside-out',
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: [] } },
      license: 'AGPL-3.0-or-later',
      ...change,
    }
    expect(() => { validateSourceProfileManifest(JSON.stringify(manifest)) }).toThrow(
      'supervisor:source-profile-unexpected',
    )
  })

  it.each(['not JSON', 'null', '[]', '"text"', '42', undefined])(
    'refuses a non-manifest source profile: %s',
    (source) => {
      expect(() => { validateSourceProfileManifest(source) }).toThrow('supervisor:source-profile-unexpected')
    },
  )

  it('refuses any unreviewed source-profile byte before staging it', () => {
    const source = readFileSync(join(ROOT, 'profiles', '8088-inside-out', 'cordis.patch.yml'), 'utf8')
    expect(MEMORY_PUT_PROPOSAL_WASM_SHA256).toMatch(/^[0-9a-f]{64}$/u)
    expect(SOURCE_PROFILE_PATCH_SHA256).toMatch(/^[0-9a-f]{64}$/u)
    expect(() => { validateSourceProfilePatch(source) }).not.toThrow()
    expect(() => { validateSourceProfilePatch(`${source}\n- name: '@deepseek-ai/dsh-tool-bash'\n`) }).toThrow(
      'supervisor:source-profile-unexpected',
    )
    const overlay = readFileSync(join(ROOT, 'aukora', 'supervisor', 'live-turn.overlay.yml'), 'utf8')
    expect(SOURCE_LIVE_TURN_OVERLAY_SHA256).toMatch(/^[0-9a-f]{64}$/u)
    expect(() => { validateLiveTurnOverlays(false) }).not.toThrow()
    expect(() => { validateLiveTurnOverlays(true) }).not.toThrow()
    expect(overlay).toContain("'@deepseek-ai/dsh-session'")
    expect(overlay).toContain("'@deepseek-ai/dsh-agent'")
    expect(overlay).toContain("'@deepseek-ai/dsh-agent-loop'")
    expect(overlay).toContain("'@deepseek-ai/dsh-llm-deepseek'")
    expect(overlay).toContain("'@deepseek-ai/dsh-aukora-kira'")
    expect(overlay).not.toContain('!!js')
    expect(readFileSync(join(ROOT, 'aukora', 'supervisor', 'live-turn-fixture.overlay.yml'), 'utf8'))
      .toContain("'@aukora/core/supervisor/live-turn-fixture-llm.ts'")
    expect(source).not.toContain("'@deepseek-ai/dsh-agent-loop'")
    expect(source).not.toContain("'@deepseek-ai/dsh-llm-deepseek'")
    // The staging route reaches a model only through the parent-staged overlay;
    // the idle 8088 inventory keeps the tools it always shipped.
    expect(source).not.toContain("'@deepseek-ai/dsh-aukora-kira'")
    expect(readFileSync(join(ROOT, 'packages', 'governed', 'memory-put', 'src', 'index.ts'), 'utf8'))
      .toMatch(/kind:\s*'allow'/)
  })

  it('keeps the pinned proposal cell in the governed ToolRuntime path', () => {
    const tool = readFileSync(join(ROOT, 'packages', 'governed', 'memory-put', 'src', 'index.ts'), 'utf8')
    expect(tool).toContain("import { proposeMemoryPutThroughCell } from './wasm-proposal.ts'")
    expect(tool).toContain('proposeMemoryPutThroughCell(args, pendingEntry.args)')
  })

  it('derives public outcomes and command exits without trusting the guest frame', () => {
    expect(classifyMemoryToolResult({ isError: false, content: [] })).toBe('SETTLED')
    expect(classifyMemoryToolResult({
      isError: true,
      content: [],
      error: { message: 'refused', info: { name: 'HarnessError', code: AUKORA_MEMORY_REFUSED } },
    })).toBe('REFUSED')
    expect(classifyMemoryToolResult({
      isError: true,
      content: [],
      error: { message: 'unknown' },
    })).toBe('INDETERMINATE')
    expect(classifyMemoryToolResult({ isError: false, content: [], error: {} })).toBeNull()
    expect(classifyMemoryToolResult({ isError: true, content: [] })).toBeNull()
    expect(sourceOutcomeExitCode('SETTLED')).toBe(0)
    expect(sourceOutcomeExitCode('REFUSED')).toBe(2)
    expect(sourceOutcomeExitCode('INDETERMINATE')).toBe(3)
    expect(() => sourceOutcomeExitCode('UNKNOWN' as never)).toThrow('supervisor:source-outcome-unknown')
  })

  it('refuses executable config in the IPC source guest before READY under preserved symlinks', async () => {
    const fixture = createGovernedGuestFixture([
      '- insert:',
      '    - id: executable-config',
      '      name: __PROFILE__/executable-probe.mjs',
      '      config:',
      `        value: !!js ${JSON.stringify("process.getBuiltinModule('fs').writeFileSync(process.env.GOVERNED_PROFILE_MARKER, 'executed')")}`,
      '',
    ].join('\n'), {
      'executable-probe.mjs': [
        "export const name = 'source-guest-executable-probe'",
        'export function apply() {}',
        '',
      ].join('\n'),
    })
    const result = await runGovernedSourceGuest(fixture)
    expect(result.code).not.toBe(0)
    expect(result.signal).toBeNull()
    expect(result.messages).toEqual([])
    // The static preflight over the composed entries refuses this row before
    // any entry mounts. It also reaches a disabled row's config, which the
    // Loader's evaluation-time trap cannot: a disabled row's config is never
    // read, so nothing evaluates the expression sitting in it.
    expect(result.stderr).toContain('profile-boot:governed-composition-refuses-executable-config')
    expect(existsSync(fixture.marker)).toBe(false)
  }, 30_000)

  it('refuses executable config in the IPC live-turn guest before READY under preserved symlinks', async () => {
    const fixture = createGovernedGuestFixture([
      '- insert:',
      '    - id: executable-config',
      '      name: __PROFILE__/executable-probe.mjs',
      '      config:',
      `        value: !!js ${JSON.stringify("process.getBuiltinModule('fs').writeFileSync(process.env.GOVERNED_PROFILE_MARKER, 'executed')")}`,
      '',
    ].join('\n'), {
      'executable-probe.mjs': [
        "export const name = 'source-turn-guest-executable-probe'",
        'export function apply() {}',
        '',
      ].join('\n'),
    })
    const result = await runGovernedSourceGuest(fixture, {
      entry: SOURCE_TURN_GUEST,
      liveTurn: true,
    })
    expect(result.code).not.toBe(0)
    expect(result.signal).toBeNull()
    expect(result.messages).toEqual([])
    // The same static preflight covers the live-turn guest's composition.
    expect(result.stderr).toContain('profile-boot:governed-composition-refuses-executable-config')
    expect(existsSync(fixture.marker)).toBe(false)
  }, 30_000)

  it('refuses configured HMR in the IPC source guest before its dependent entry publishes', async () => {
    const fixture = createGovernedGuestFixture([
      '- insert:',
      '    - id: timer',
      "      name: '@deepseek-ai/cordis-plugin-timer'",
      '    - id: hmr',
      "      name: '@deepseek-ai/cordis-plugin-hmr'",
      '      config:',
      '        root: []',
      '    - id: hmr-probe',
      '      name: __PROFILE__/hmr-probe.mjs',
      '      inject:',
      '        - hmr',
      '',
    ].join('\n'), {
      'hmr-probe.mjs': [
        "import { writeFileSync } from 'node:fs'",
        "export const name = 'source-guest-hmr-probe'",
        "export const inject = ['hmr']",
        'export function apply() {',
        "  writeFileSync(process.env.GOVERNED_PROFILE_MARKER, 'published')",
        '}',
        '',
      ].join('\n'),
    })
    const result = await runGovernedSourceGuest(fixture)
    expect(result.code).not.toBe(0)
    expect(result.signal).toBeNull()
    expect(result.messages).toEqual([])
    expect(result.stderr).toContain('profile-boot:governed-composition-refuses-configured-hmr')
    expect(existsSync(fixture.marker)).toBe(false)
  }, 30_000)

  it.each([
    ['source', {}],
    ['live-turn', { entry: SOURCE_TURN_GUEST, liveTurn: true }],
  ] as const)('refuses a query-adorned HMR package before the IPC %s guest reaches READY', async (_label, options) => {
    const fixture = createGovernedGuestFixture([
      '- insert:',
      '    - id: timer',
      "      name: '@deepseek-ai/cordis-plugin-timer'",
      '    - id: hmr',
      "      name: '@deepseek-ai/cordis-plugin-hmr?review#fragment'",
      '      config:',
      '        root: []',
      '    - id: hmr-probe',
      '      name: __PROFILE__/hmr-probe.mjs',
      '      inject:',
      '        - hmr',
      '',
    ].join('\n'), {
      'hmr-probe.mjs': [
        "import { writeFileSync } from 'node:fs'",
        "export const name = 'source-guest-adorned-hmr-probe'",
        "export const inject = ['hmr']",
        'export function apply() {',
        "  writeFileSync(process.env.GOVERNED_PROFILE_MARKER, 'published')",
        '}',
        '',
      ].join('\n'),
    })
    const result = await runGovernedSourceGuest(fixture, options)
    expect(result.code).not.toBe(0)
    expect(result.signal).toBeNull()
    expect(result.messages).toEqual([])
    expect(result.stderr).toContain('profile-boot:governed-composition-refuses-configured-module-adornment')
    expect(existsSync(fixture.marker)).toBe(false)
  }, 30_000)

  it('refuses an HMR package subpath in the IPC source guest under production module resolution', async () => {
    const fixture = createGovernedGuestFixture([
      '- insert:',
      '    - id: hmr',
      "      name: '@deepseek-ai/cordis-plugin-hmr/src/index.ts'",
      '      config:',
      '        root: []',
      '    - id: hmr-probe',
      '      name: __PROFILE__/hmr-probe.mjs',
      '      inject:',
      '        - hmr',
      '',
    ].join('\n'), {
      'hmr-probe.mjs': [
        "import { writeFileSync } from 'node:fs'",
        "export const name = 'source-guest-hmr-subpath-probe'",
        "export const inject = ['hmr']",
        'export function apply() {',
        "  writeFileSync(process.env.GOVERNED_PROFILE_MARKER, 'published')",
        '}',
        '',
      ].join('\n'),
    })
    const result = await runGovernedSourceGuest(fixture, { preserveSymlinks: false })
    expect(result.code).not.toBe(0)
    expect(result.signal).toBeNull()
    expect(result.messages).toEqual([])
    expect(result.stderr).toContain('profile-boot:governed-composition-refuses-configured-hmr')
    expect(existsSync(fixture.marker)).toBe(false)
  }, 30_000)

  it('refuses an HMR package subpath in the IPC live-turn guest under production module resolution', async () => {
    const fixture = createGovernedGuestFixture([
      '- insert:',
      '    - id: hmr',
      "      name: '@deepseek-ai/cordis-plugin-hmr/src/index.ts'",
      '      config:',
      '        root: []',
      '    - id: hmr-probe',
      '      name: __PROFILE__/hmr-probe.mjs',
      '      inject:',
      '        - hmr',
      '',
    ].join('\n'), {
      'hmr-probe.mjs': [
        "import { writeFileSync } from 'node:fs'",
        "export const name = 'source-turn-hmr-subpath-probe'",
        "export const inject = ['hmr']",
        'export function apply() {',
        "  writeFileSync(process.env.GOVERNED_PROFILE_MARKER, 'published')",
        '}',
        '',
      ].join('\n'),
    })
    const result = await runGovernedSourceGuest(fixture, {
      entry: SOURCE_TURN_GUEST,
      liveTurn: true,
      preserveSymlinks: false,
    })
    expect(result.code).not.toBe(0)
    expect(result.signal).toBeNull()
    expect(result.messages).toEqual([])
    expect(result.stderr).toContain('profile-boot:governed-composition-refuses-configured-hmr')
    expect(existsSync(fixture.marker)).toBe(false)
  }, 30_000)

  it('refuses an Include package subpath before its uninspected child can publish', async () => {
    const fixture = createGovernedGuestFixture([
      '- insert:',
      '    - id: child-tree',
      "      name: '@deepseek-ai/cordis-plugin-include/src/index.ts'",
      '      config:',
      '        path: __PROFILE__/child.cordis.yml',
      '',
    ].join('\n'), {
      'child.cordis.yml': [
        '- id: child-probe',
        '  name: ./child-probe.mjs',
        '',
      ].join('\n'),
      'child-probe.mjs': [
        "import { writeFileSync } from 'node:fs'",
        "export const name = 'source-guest-include-subpath-probe'",
        'export function apply() {',
        "  writeFileSync(process.env.GOVERNED_PROFILE_MARKER, 'published')",
        '}',
        '',
      ].join('\n'),
    })
    const result = await runGovernedSourceGuest(fixture, { preserveSymlinks: false })
    expect(result.code).not.toBe(0)
    expect(result.signal).toBeNull()
    expect(result.messages).toEqual([])
    expect(result.stderr).toContain('profile-boot:governed-composition-refuses-configured-include')
    expect(existsSync(fixture.marker)).toBe(false)
  }, 30_000)

  it('recurses through a Group package subpath before its nested HMR can publish', async () => {
    const fixture = createGovernedGuestFixture([
      '- insert:',
      '    - id: grouped',
      "      name: '@deepseek-ai/cordis-plugin-group/src/index.ts'",
      '      config:',
      '        - id: hmr',
      "          name: '@deepseek-ai/cordis-plugin-hmr'",
      '          config:',
      '            root: []',
      '        - id: hmr-probe',
      '          name: __PROFILE__/hmr-probe.mjs',
      '          inject:',
      '            - hmr',
      '',
    ].join('\n'), {
      'hmr-probe.mjs': [
        "import { writeFileSync } from 'node:fs'",
        "export const name = 'source-guest-group-subpath-probe'",
        "export const inject = ['hmr']",
        'export function apply() {',
        "  writeFileSync(process.env.GOVERNED_PROFILE_MARKER, 'published')",
        '}',
        '',
      ].join('\n'),
    })
    const result = await runGovernedSourceGuest(fixture, { preserveSymlinks: false })
    expect(result.code).not.toBe(0)
    expect(result.signal).toBeNull()
    expect(result.messages).toEqual([])
    expect(result.stderr).toContain('profile-boot:governed-composition-refuses-configured-hmr')
    expect(existsSync(fixture.marker)).toBe(false)
  }, 30_000)

  it('starts the real guest broker and issuer, then settles through ToolRuntime and v4', async () => {
    const keys = keyFixture()
    const reviewRequests: object[] = []
    const issuerChallenges: string[] = []
    let issuerProjection = ''
    const assembly = await launchDeveloperAssembly({
      runtimeDir: join(keys.root, 'runtime'),
      rootPrivateKeyFile: keys.privatePath,
      rootPublicKeyFile: keys.publicPath,
      review: (request) => {
        reviewRequests.push(request)
        return reviewRequests.length === 1 ? 'denied' : 'approved'
      },
      issuerApproval: ({ challenge }) => {
        issuerChallenges.push(challenge)
        return 'approved'
      },
      issuerStderr: (text) => { issuerProjection += text },
    })
    assemblies.push(assembly)

    expect(assembly.observationClass).toBe(DEVELOPER_OBSERVATION_CLASS)
    expect(new Set([assembly.broker.pid, assembly.issuer.pid, assembly.guest.pid]).size).toBe(3)
    expect(assembly.paths.brokerSocket.startsWith(assembly.paths.runtimeDir)).toBe(true)
    expect(assembly.paths.issuerSocket.startsWith(assembly.paths.runtimeDir)).toBe(true)
    expect(assembly.artifact.brokerEntrySha256).toMatch(/^[0-9a-f]{64}$/)
    expect(assembly.artifact.guestEntrySha256).toMatch(/^[0-9a-f]{64}$/)
    expect(assembly.artifact.issuerEntrySha256).toMatch(/^[0-9a-f]{64}$/)
    expect(assembly.artifact.profileBootSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(assembly.artifact.profileManifestSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(assembly.artifact.profilePatchSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(assembly.artifact.proposalCellModuleSha256).toBe(MEMORY_PUT_PROPOSAL_WASM_SHA256)
    expect(assembly.artifact.sourceProfileManifestSha256).toMatch(/^[0-9a-f]{64}$/)
    const activePatch = readFileSync(join(
      assembly.paths.activationHome,
      'profiles',
      '8088-inside-out',
      'cordis.patch.yml',
    ), 'utf8')
    expect(activePatch).toContain(`brokerSocket: ${JSON.stringify(assembly.paths.brokerSocket)}`)
    expect(activePatch).not.toContain("brokerSocket: '/run/aukora/broker.sock'")
    expect(activePatch).not.toContain('!!js')
    expect(JSON.parse(readFileSync(join(
      assembly.paths.activationHome,
      'profiles',
      '8088-inside-out',
      'package.json',
    ), 'utf8'))).toMatchObject({ dsh: { profile: { bundles: [] } } })

    const execute = () => assembly.executeMemoryPut({
      key: 'parent.launch',
      value: { wasm: true, governed: true },
    })
    const denied = await execute()
    expect(denied.outcome).toBe('REFUSED')
    expect(denied.result.isError).toBe(true)
    expect(denied.result.content).toEqual([
      { type: 'text', text: 'Error: memory.put refused: broker:review-denied' },
    ])
    expect(issuerChallenges).toHaveLength(0)
    expect(existsSync(join(assembly.paths.stateDir, 'aura.jsonl'))).toBe(false)
    expect(existsSync(join(assembly.paths.stateDir, 'memory'))).toBe(false)
    const nonceDir = join(assembly.paths.stateDir, 'nonces')
    expect(existsSync(nonceDir) ? readdirSync(nonceDir) : []).toEqual([])

    const execution = await execute()

    expect(execution.outcome).toBe('SETTLED')
    expect(execution.result.isError).not.toBe(true)
    expect(execution.result.content).toHaveLength(1)
    const resultBlock = execution.result.content[0]
    expect(resultBlock?.type).toBe('text')
    if (resultBlock?.type !== 'text' || typeof resultBlock.text !== 'string') {
      throw new Error('settled result omitted its text block')
    }
    const publicResult = JSON.parse(resultBlock.text) as Record<string, unknown>
    expect(publicResult.state).toBe('SETTLED')
    expect(reviewRequests).toHaveLength(2)
    expect(Object.isFrozen(reviewRequests[0])).toBe(true)
    expect(Object.isFrozen(reviewRequests[1])).toBe(true)
    expect(issuerChallenges).toHaveLength(1)
    expect(issuerProjection).toContain('approvalArtifactDigest:')
    expect(issuerProjection).toContain('MEMORY.WRITE - approve this exact operation')
    expect(existsSync(join(assembly.paths.stateDir, 'aura.jsonl'))).toBe(true)
    expect(readFileSync(join(assembly.paths.stateDir, 'aura.jsonl'), 'utf8').trim()).not.toBe('')
    expect(existsSync(join(assembly.paths.stateDir, 'authority-evidence'))).toBe(false)

    await assembly.close()
    assemblies.splice(assemblies.indexOf(assembly), 1)
    expect(assembly.guest.exitCode ?? assembly.guest.signalCode).not.toBeNull()
    expect(assembly.broker.exitCode ?? assembly.broker.signalCode).not.toBeNull()
    expect(assembly.issuer.exitCode ?? assembly.issuer.signalCode).not.toBeNull()
  }, 30_000)

  it('rejects a mismatched parent authority context before any child starts', async () => {
    const keys = keyFixture()
    const runtimeDir = join(keys.root, 'runtime')
    await expect(launchDeveloperAssembly({
      runtimeDir,
      rootPrivateKeyFile: keys.privatePath,
      rootPublicKeyFile: keys.publicPath,
      createSubjectAuthority: createSubjectAuthorityFactory(
        'source.authority.invalid',
        `aukora:1:${'ef'.repeat(32)}`,
        'ab'.repeat(32),
      ),
      review: () => 'approved',
      issuerApproval: () => 'approved',
      issuerStderr: () => {},
    })).rejects.toMatchObject({ reason: 'supervisor:subject-authority-activation-mismatch' })
    expect(existsSync(join(runtimeDir, 'broker.sock'))).toBe(false)
    expect(existsSync(join(runtimeDir, 'issuer.sock'))).toBe(false)
    expect(existsSync(join(runtimeDir, 'broker-state', 'aura.jsonl'))).toBe(false)
  })

  it('rejects a KIRA subject different from the authority context before any child starts', async () => {
    const keys = keyFixture()
    const runtimeDir = join(keys.root, 'runtime')
    await expect(launchDeveloperAssembly({
      runtimeDir,
      rootPrivateKeyFile: keys.privatePath,
      rootPublicKeyFile: keys.publicPath,
      kiraRecallPolicy: { subject: `aukora:1:${'cd'.repeat(32)}`, privacy: ['local'] },
      createSubjectAuthority: createSubjectAuthorityFactory(
        'source.authority.kira',
        `aukora:1:${'ef'.repeat(32)}`,
      ),
      review: () => 'approved',
      issuerApproval: () => 'approved',
      issuerStderr: () => {},
    })).rejects.toMatchObject({ reason: 'supervisor:subject-authority-kira-subject-mismatch' })
    expect(existsSync(join(runtimeDir, 'broker.sock'))).toBe(false)
    expect(existsSync(join(runtimeDir, 'issuer.sock'))).toBe(false)
    expect(existsSync(join(runtimeDir, 'broker-state', 'aura.jsonl'))).toBe(false)
  })

  it('settles one source proposal through v5 and refuses a direct v3 grant', async () => {
    const keys = keyFixture()
    const key = 'source.authority.v5'
    const rootControlState = rootControlFixture(keys.publicKey)
    const subject = rootControlState.subject
    let factoryActivation: string | undefined
    const sourceAuthority = createSubjectAuthorityFactory(
      key,
      subject,
      undefined,
      identityControlDigest(rootControlState),
    )
    const assembly = await launchDeveloperAssembly({
      runtimeDir: join(keys.root, 'runtime'),
      rootPrivateKeyFile: keys.privatePath,
      rootPublicKeyFile: keys.publicPath,
      rootControlState,
      createSubjectAuthority: (activationDigest) => {
        factoryActivation = activationDigest
        return sourceAuthority(activationDigest)
      },
      review: () => 'approved',
      issuerApproval: () => 'approved',
      issuerStderr: () => {},
    })
    assemblies.push(assembly)

    expect(factoryActivation).toBe(assembly.activationDigest)
    const status = await brokerRequest(assembly.paths.brokerSocket, { op: 'status' })
    if (typeof status.receiptKeyId !== 'string') throw new Error('broker omitted its receipt key id')
    const directArguments = { key: 'source.authority.raw-v3', value: { direct: true } }
    const directGrant = mintGrant({
      rootPrivateKey: keys.privateKey,
      args: directArguments,
      exp: Math.floor(Date.now() / 1000) + 60,
      receiptKeyId: status.receiptKeyId,
    }).grant
    await expect(brokerRequest(assembly.paths.brokerSocket, {
      op: 'memory.put',
      toolName: 'memory.put',
      arguments: directArguments,
      grant: directGrant,
    })).resolves.toMatchObject({
      ok: false,
      state: 'REFUSED',
      reason: 'broker:legacy-route-forbidden',
    })
    expect(worldCounts(assembly.paths.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })

    const arguments_ = { key, value: { through: 'subject-bound proposal' } }
    await expect(assembly.executeMemoryPut(arguments_)).resolves.toMatchObject({ outcome: 'SETTLED' })
    const evidenceFiles = readdirSync(join(assembly.paths.stateDir, 'authority-evidence'))
    expect(evidenceFiles).toHaveLength(1)
    const evidence = readAuthorityEvidence(JSON.parse(readFileSync(
      join(assembly.paths.stateDir, 'authority-evidence', evidenceFiles[0] as string),
      'utf8',
    )))
    expect(evidence).toMatchObject({
      grantDomain: 'aukora:tool-grant:v5',
      subject,
      activationDigest: assembly.activationDigest,
      audience: 'broker:source-launch',
      resource: `memory:key:${key}`,
      budget: {
        calls: 1,
        bytes: Buffer.byteLength(effectBody(arguments_), 'utf8'),
        computeMs: 0,
        costMicrounits: 0,
      },
    })
  }, 30_000)

  it('binds one activation at launch and enforces it again before the effect', async () => {
    const keys = keyFixture()
    const assembly = await launchDeveloperAssembly({
      runtimeDir: join(keys.root, 'runtime'),
      rootPrivateKeyFile: keys.privatePath,
      rootPublicKeyFile: keys.publicPath,
      review: () => 'approved',
      issuerApproval: () => 'approved',
      issuerStderr: () => {},
    })
    assemblies.push(assembly)

    // LAUNCH VALIDATION, observed from outside: the parent validated one exact
    // statement, and the broker that actually started adopted its digest. The
    // launcher refuses to publish an assembly whose broker reports another.
    expect(assembly.activationDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(assembly.artifact.activationDigest).toBe(assembly.activationDigest)
    expect(activationDigest(assembly.activationStatement)).toBe(assembly.activationDigest)
    expect(assembly.activationStatement.brokerId).toMatch(/^[0-9a-f]{64}$/)
    expect(readActivationBinding(assembly.paths.stateDir)).toBe(assembly.activationDigest)

    // POSITIVE CONTROL: the identical operation settles while the activation
    // the broker serves is the activation its state records.
    const settled = await assembly.executeMemoryPut({
      key: 'parent.activation.control',
      value: { governed: true },
    })
    expect(settled.outcome).toBe('SETTLED')

    // CHECK-AT-USE: replace the broker-owned binding underneath the running
    // broker. Nothing else changes — same guest, same broker process, same
    // review and issuer decisions — so only a check that re-reads this file at
    // effect admission can refuse the second operation.
    writeFileSync(activationBindingPath(assembly.paths.stateDir), JSON.stringify({
      activationDigest: 'cd'.repeat(32),
      domain: 'aukora:activation-binding:v1',
    }), { mode: 0o600 })

    const refused = await assembly.executeMemoryPut({
      key: 'parent.activation.swapped',
      value: { governed: true },
    })
    expect(refused.outcome).not.toBe('SETTLED')
    expect(refused.result.isError).toBe(true)
    // The effect never began: no object was written for the refused key.
    const objects = existsSync(join(assembly.paths.stateDir, 'memory'))
      ? readdirSync(join(assembly.paths.stateDir, 'memory'))
      : []
    expect(objects.some(entry => entry.includes('swapped'))).toBe(false)
  }, 40_000)

  it('reports an exact guest loss and reaps the remaining direct children', async () => {
    const keys = keyFixture()
    const assembly = await launchDeveloperAssembly({
      runtimeDir: join(keys.root, 'runtime'),
      rootPrivateKeyFile: keys.privatePath,
      rootPublicKeyFile: keys.publicPath,
      review: () => 'denied',
      issuerApproval: () => 'denied',
      issuerStderr: () => {},
    })
    assemblies.push(assembly)

    const failed = assembly.failure.catch((error: unknown) => error as DeveloperLaunchError)
    expect(assembly.guest.kill('SIGKILL')).toBe(true)
    await expect(failed).resolves.toMatchObject({ reason: 'supervisor:guest-exited' })

    expect(assembly.guest.exitCode ?? assembly.guest.signalCode).not.toBeNull()
    expect(assembly.broker.exitCode ?? assembly.broker.signalCode).not.toBeNull()
    expect(assembly.issuer.exitCode ?? assembly.issuer.signalCode).not.toBeNull()
    await expect(assembly.close()).resolves.toBeUndefined()
  }, 30_000)

  it('fails the assembly when an issuer callback abandons its occurrence', async () => {
    const keys = keyFixture()
    let abandonedSignal: AbortSignal | undefined
    const assembly = await launchDeveloperAssembly({
      runtimeDir: join(keys.root, 'runtime'),
      rootPrivateKeyFile: keys.privatePath,
      rootPublicKeyFile: keys.publicPath,
      review: () => 'approved',
      issuerApproval: async (_request, signal) => {
        abandonedSignal = signal
        return new Promise<'approved'>(() => {})
      },
      issuerStderr: () => {},
    })
    assemblies.push(assembly)

    const failed = assembly.failure.catch((error: unknown) => error as DeveloperLaunchError)
    const execution = assembly.executeMemoryPut({ key: 'approval.timeout', value: 1 }).catch(() => undefined)
    await expect(failed).resolves.toMatchObject({ reason: 'supervisor:issuer-approval-timeout' })
    await execution
    expect(abandonedSignal?.aborted).toBe(true)
    expect(assembly.guest.exitCode ?? assembly.guest.signalCode).not.toBeNull()
    expect(assembly.broker.exitCode ?? assembly.broker.signalCode).not.toBeNull()
    expect(assembly.issuer.exitCode ?? assembly.issuer.signalCode).not.toBeNull()
  }, 40_000)

  it('coalesces concurrent close callers onto one teardown', async () => {
    const keys = keyFixture()
    const assembly = await launchDeveloperAssembly({
      runtimeDir: join(keys.root, 'runtime'),
      rootPrivateKeyFile: keys.privatePath,
      rootPublicKeyFile: keys.publicPath,
      review: () => 'denied',
      issuerApproval: () => 'denied',
      issuerStderr: () => {},
    })
    assemblies.push(assembly)

    const first = assembly.close()
    const second = assembly.close()
    expect(second).toBe(first)
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])

    expect(assembly.guest.exitCode ?? assembly.guest.signalCode).not.toBeNull()
    expect(assembly.broker.exitCode ?? assembly.broker.signalCode).not.toBeNull()
    expect(assembly.issuer.exitCode ?? assembly.issuer.signalCode).not.toBeNull()
  }, 30_000)

  it('refuses an operation after close begins without review or state', async () => {
    const keys = keyFixture()
    let reviews = 0
    const assembly = await launchDeveloperAssembly({
      runtimeDir: join(keys.root, 'runtime'),
      rootPrivateKeyFile: keys.privatePath,
      rootPublicKeyFile: keys.publicPath,
      review: () => { reviews += 1; return 'approved' },
      issuerApproval: () => 'approved',
      issuerStderr: () => {},
    })
    assemblies.push(assembly)

    const closing = assembly.close()
    await expect(assembly.executeMemoryPut({ key: 'closing.race', value: 1 })).rejects.toMatchObject({
      reason: 'supervisor:assembly-closing',
    })
    await closing

    expect(reviews).toBe(0)
    expect(existsSync(join(assembly.paths.stateDir, 'aura.jsonl'))).toBe(false)
    expect(existsSync(join(assembly.paths.stateDir, 'memory'))).toBe(false)
  }, 30_000)

  it('refuses a second operation while the first occurrence is active', async () => {
    const keys = keyFixture()
    let settleReview: ((decision: 'denied') => void) | undefined
    const assembly = await launchDeveloperAssembly({
      runtimeDir: join(keys.root, 'runtime'),
      rootPrivateKeyFile: keys.privatePath,
      rootPublicKeyFile: keys.publicPath,
      review: () => new Promise<'denied'>((resolve) => { settleReview = resolve }),
      issuerApproval: () => 'denied',
      issuerStderr: () => {},
    })
    assemblies.push(assembly)

    const first = assembly.executeMemoryPut({ key: 'single.flight', value: 1 })
    await expect(assembly.executeMemoryPut({ key: 'single.flight', value: 2 })).rejects.toMatchObject({
      reason: 'supervisor:operation-already-active',
    })
    for (let attempts = 0; settleReview === undefined && attempts < 200; attempts += 1) {
      await new Promise((resolve) => { setTimeout(resolve, 10) })
    }
    if (settleReview === undefined) throw new Error('broker did not request parent review')
    settleReview('denied')
    await expect(first).resolves.toMatchObject({ outcome: 'REFUSED' })
  }, 30_000)

  it('contains a throwing issuer projection and reaps the assembly', async () => {
    const keys = keyFixture()
    const assembly = await launchDeveloperAssembly({
      runtimeDir: join(keys.root, 'runtime'),
      rootPrivateKeyFile: keys.privatePath,
      rootPublicKeyFile: keys.publicPath,
      review: () => 'approved',
      issuerApproval: () => 'approved',
      issuerStderr: () => { throw new Error('projection failed') },
    })
    assemblies.push(assembly)

    const failed = assembly.failure.catch((error: unknown) => error as DeveloperLaunchError)
    const execution = assembly.executeMemoryPut({ key: 'projection.failure', value: true }).catch(() => undefined)
    await expect(failed).resolves.toMatchObject({ reason: 'supervisor:issuer-stderr-sink-failed' })
    await execution

    expect(assembly.guest.exitCode ?? assembly.guest.signalCode).not.toBeNull()
    expect(assembly.broker.exitCode ?? assembly.broker.signalCode).not.toBeNull()
    expect(assembly.issuer.exitCode ?? assembly.issuer.signalCode).not.toBeNull()
  }, 30_000)

  it('contains an asynchronously rejected issuer projection and reaps the assembly', async () => {
    const keys = keyFixture()
    const asynchronousSink = async () => {
      await Promise.resolve()
      throw new Error('async projection failed')
    }
    const untypedSink: unknown = asynchronousSink
    const assembly = await launchDeveloperAssembly({
      runtimeDir: join(keys.root, 'runtime'),
      rootPrivateKeyFile: keys.privatePath,
      rootPublicKeyFile: keys.publicPath,
      review: () => 'approved',
      issuerApproval: () => 'approved',
      issuerStderr: untypedSink as () => void,
    })
    assemblies.push(assembly)

    const failed = assembly.failure.catch((error: unknown) => error as DeveloperLaunchError)
    const execution = assembly.executeMemoryPut({ key: 'projection.async-failure', value: true }).catch(() => undefined)
    await expect(failed).resolves.toMatchObject({ reason: 'supervisor:issuer-stderr-sink-failed' })
    await execution

    expect(assembly.guest.exitCode ?? assembly.guest.signalCode).not.toBeNull()
    expect(assembly.broker.exitCode ?? assembly.broker.signalCode).not.toBeNull()
    expect(assembly.issuer.exitCode ?? assembly.issuer.signalCode).not.toBeNull()
  }, 30_000)

  it('runs one real interactive command from operation to public settlement', async () => {
    const keys = keyFixture()
    const configPath = join(keys.root, 'launch.json')
    const operationPath = join(keys.root, 'memory-put.json')
    writeFileSync(configPath, JSON.stringify({
      schema: 'aukora:developer-launch:v1',
      runtimeDir: join(keys.root, 'runtime'),
      rootPrivateKeyFile: keys.privatePath,
      rootPublicKeyFile: keys.publicPath,
    }))
    writeFileSync(operationPath, JSON.stringify({
      key: 'source.launch.cli',
      value: { guest: 'cordis', proposalCell: 'wasm' },
    }))

    const child = spawn(process.execPath, [
      '--',
      join(ROOT, 'aukora', 'supervisor', 'developer-launch-bin.mjs'),
      configPath,
      operationPath,
    ], {
      cwd: ROOT,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    commandChildren.push(child)
    let stdout = ''
    let stderr = ''
    const answered = new Set<string>()
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
      for (const match of stderr.matchAll(/approve\? type "yes ([0-9a-f]{16})": /g)) {
        const challenge = match[1]
        if (challenge === undefined || answered.has(challenge)) continue
        answered.add(challenge)
        child.stdin.write(`yes ${challenge}\n`)
      }
    })
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => { resolveExit({ code, signal }) })
    })

    expect(exit).toEqual({ code: 0, signal: null })
    expect(answered.size).toBe(2)
    const lines = stdout.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({
      schema: 'aukora:developer-launch:v1',
      status: 'READY',
      observationClass: DEVELOPER_OBSERVATION_CLASS,
    })
    expect(lines[1]).toMatchObject({
      schema: 'aukora:source-launch-result:v1',
      observationClass: DEVELOPER_OBSERVATION_CLASS,
      outcome: 'SETTLED',
    })
    const result = lines[1]?.result as {
      isError?: boolean
      content?: Array<{ type?: string; text?: string }>
    }
    expect(result.isError).not.toBe(true)
    expect(JSON.parse(result.content?.[0]?.text ?? '{}')).toMatchObject({ state: 'SETTLED' })
    expect(stderr).toContain('approvalArtifactDigest:')
    expect(stderr).toContain('MEMORY.WRITE - approve this exact operation')
    expect(stderr).toContain('key: source.launch.cli')
    expect(stderr).toMatch(/operationDigest: [0-9a-f]{64}\n/)
    expect(stderr).toMatch(/approve\? type "yes [0-9a-f]{16}": /)
    commandChildren.splice(commandChildren.indexOf(child), 1)
  }, 30_000)

  it('returns exit two for one real operator refusal', async () => {
    const keys = keyFixture()
    const configPath = join(keys.root, 'launch-refused.json')
    const operationPath = join(keys.root, 'memory-put-refused.json')
    writeFileSync(configPath, JSON.stringify({
      schema: 'aukora:developer-launch:v1',
      runtimeDir: join(keys.root, 'runtime'),
      rootPrivateKeyFile: keys.privatePath,
      rootPublicKeyFile: keys.publicPath,
    }))
    writeFileSync(operationPath, JSON.stringify({ key: 'source.launch.refused', value: true }))

    const child = spawn(process.execPath, [
      '--',
      join(ROOT, 'aukora', 'supervisor', 'developer-launch-bin.mjs'),
      configPath,
      operationPath,
    ], { cwd: ROOT, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })
    commandChildren.push(child)
    let stdout = ''
    let stderr = ''
    let answered = false
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
      if (!answered && /approve\? type "yes [0-9a-f]{16}": /.test(stderr)) {
        answered = true
        child.stdin.write('no\n')
      }
    })
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => { resolveExit({ code, signal }) })
    })

    expect(exit).toEqual({ code: 2, signal: null })
    expect(answered).toBe(true)
    const lines = stdout.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toMatchObject({ outcome: 'REFUSED' })
    expect(stderr).not.toContain('authorizationDigest:')
    commandChildren.splice(commandChildren.indexOf(child), 1)
  }, 30_000)

  it('refuses closed approval input promptly without issuer contact or effect', async () => {
    const keys = keyFixture()
    const runtimeDir = join(keys.root, 'runtime')
    const configPath = join(keys.root, 'launch-closed-input.json')
    const operationPath = join(keys.root, 'memory-put-closed-input.json')
    writeFileSync(configPath, JSON.stringify({
      schema: 'aukora:developer-launch:v1',
      runtimeDir,
      rootPrivateKeyFile: keys.privatePath,
      rootPublicKeyFile: keys.publicPath,
    }))
    writeFileSync(operationPath, JSON.stringify({ key: 'source.launch.closed-input', value: true }))

    const child = spawn(process.execPath, [
      '--',
      join(ROOT, 'aukora', 'supervisor', 'developer-launch-bin.mjs'),
      configPath,
      operationPath,
    ], { cwd: ROOT, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })
    commandChildren.push(child)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.stdin.end()
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, reject) => {
      const timer = setTimeout(() => { reject(new Error('closed approval input did not settle promptly')) }, 5_000)
      child.once('error', (error) => { clearTimeout(timer); reject(error) })
      child.once('exit', (code, signal) => { clearTimeout(timer); resolveExit({ code, signal }) })
    })

    expect(exit).toEqual({ code: 2, signal: null })
    const lines = stdout.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toMatchObject({ outcome: 'REFUSED' })
    expect(stderr).toContain('approve?')
    expect(stderr).toContain('approvalArtifactDigest:')
    expect(stderr).not.toContain('authorizationDigest:')
    expect(existsSync(join(runtimeDir, 'broker-state', 'aura.jsonl'))).toBe(false)
    expect(existsSync(join(runtimeDir, 'broker-state', 'memory'))).toBe(false)
    commandChildren.splice(commandChildren.indexOf(child), 1)
  }, 10_000)

  it('does not leave authority or guest children after an abrupt launcher loss', async () => {
    const keys = keyFixture()
    const configPath = join(keys.root, 'launch.json')
    writeFileSync(configPath, JSON.stringify({
      schema: 'aukora:developer-launch:v1',
      runtimeDir: join(keys.root, 'runtime'),
      rootPrivateKeyFile: keys.privatePath,
      rootPublicKeyFile: keys.publicPath,
    }))
    const child = spawn(process.execPath, [
      '--',
      join(ROOT, 'aukora', 'supervisor', 'developer-launch-bin.mjs'),
      configPath,
    ], {
      cwd: ROOT,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    commandChildren.push(child)
    const ready = await readJsonLine(child)
    const pids = Object.values(ready.pids as Record<string, unknown>)
    expect(pids).toHaveLength(3)
    expect(pids.every(pid => typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0)).toBe(true)
    orphanCandidates.push(...pids as number[])

    expect(child.kill('SIGKILL')).toBe(true)
    await new Promise<void>((resolveExit, reject) => {
      child.once('error', reject)
      child.once('exit', () => { resolveExit() })
    })
    await expect.poll(() => (pids as number[]).map(processExists), { timeout: 10_000 }).toEqual([
      false,
      false,
      false,
    ])
    orphanCandidates.splice(0)
    commandChildren.splice(commandChildren.indexOf(child), 1)
  }, 30_000)

  it('serves the measured Web profile and restarts only its guest', async () => {
    const keys = webAumlokFixture()
    const port = await unusedLoopbackPort()
    const assembly = await launchDeveloperAssembly({
      runtimeDir: join(keys.root, 'runtime'),
      rootPrivateKeyFile: keys.privatePath,
      rootPublicKeyFile: keys.publicPath,
      rootControlState: keys.control.activeControl,
      reviewConfigurationDigest: 'a2'.repeat(32),
      web: { port },
      webAumlokProjection: keys.authority.projection,
      kiraRecallPolicy: { subject: keys.control.subject, privacy: ['private'] },
      selectSubjectAuthority: keys.authority.selectSubjectAuthority,
      subjectAuthorityExpectation: keys.authority.subjectAuthorityExpectation,
      review: () => 'denied',
      issuerApproval: () => 'denied',
      issuerStderr: () => {},
    })
    assemblies.push(assembly)
    const firstGuestPid = assembly.guest.pid
    const brokerPid = assembly.broker.pid
    const issuerPid = assembly.issuer.pid

    expect(assembly.activationStatement.modelEmissionPolicy)
      .toBe('aukora:model-emission:parent-staged-web:v1')
    expect(assembly.activationStatement.rendererId).toBe(TEST_RENDERER_ID)
    expect(assembly.activationStatement.closure.resolver['owner-review-configuration']).toBe('a2'.repeat(32))
    expect(Object.keys(assembly.activationStatement.closure.executable).toSorted()).toEqual([
      'activation-measure',
      'activation-statement',
      'chat-approval-card',
      'chat-approval-style',
      'chat-owner-client',
      'chat-owner-panel',
      'developer-launch-error',
      'guest-entry',
      'issuer-approval-bridge',
      'local-aumlok-control',
      'node',
      'owner-review-client',
      'owner-review-server',
      'owner-review-socket',
      'owner-review-transport',
      'parent-aumlok-authority',
      'parent-launcher',
      'parent-owner-review',
      'parent-terminal-renderer',
      'parent-terminal-review',
    ])
    expect(Object.keys(assembly.activationStatement.closure.resolver)).toEqual(expect.arrayContaining([
      'source-preset-composition',
      'source-preset-manifest',
      'staged-preset-composition',
      'staged-preset-manifest',
      'staged-profile-root',
      // The two selected bundle files enter the resolver, so a changed bundle
      // byte refuses re-entry rather than silently composing configuration the
      // parent-staged literal overrides were never proven to cover.
      'bundle-base-manifest',
      'bundle-base-patch',
      'bundle-web-app-manifest',
      'bundle-web-app-patch',
    ]))
    expect(readFileSync(join(assembly.paths.activationHome, 'agent-presets', 'aukora', 'preset.yml'), 'utf8'))
      .toContain('name: AUKORA')
    const stagedManifestPath = join(
      assembly.paths.activationHome,
      'profiles',
      'aukora-web',
      'package.json',
    )
    const stagedPatchPath = join(
      assembly.paths.activationHome,
      'profiles',
      'aukora-web',
      'cordis.patch.yml',
    )
    const stagedRootPath = join(assembly.paths.activationHome, 'profiles', 'aukora-web', 'cordis.yml')
    const stagedRoot = readFileSync(stagedRootPath)
    const stagedRootIdentity = lstatSync(stagedRootPath)
    expect(stagedRootIdentity.mode & 0o777).toBe(0o444)
    expect(assembly.activationStatement.closure.resolver['staged-profile-root'])
      .toBe(fixtureFileSha256(stagedRootPath))
    const presetManifestPath = join(
      assembly.paths.activationHome,
      'agent-presets',
      'aukora',
      'preset.yml',
    )
    const presetCompositionPath = join(
      assembly.paths.activationHome,
      'agent-presets',
      'aukora',
      'agent.cordis.yml',
    )
    const stagedComposition = readFileSync(presetCompositionPath, 'utf8')
    expect(stagedComposition).toContain(keys.control.subject)
    expect(stagedComposition).not.toContain('aumlok:subject:local-web')
    // Both governed consumers carry the same real broker route: the memory
    // effect and the workspace.patch adapter. No placeholder survives entry.
    const stagedPatch = readFileSync(stagedPatchPath, 'utf8')
    const realRoute = assembly.paths.brokerSocket
    expect(stagedPatch.split(`brokerSocket: ${JSON.stringify(realRoute)}`)).toHaveLength(3)
    expect(stagedPatch).not.toContain('/run/aukora/broker.sock')
    expect(stagedPatch).toContain('@deepseek-ai/dsh-aukora-memory/workspace-patch')
    // The lead preset admits the governed patch tool and keeps the memory-only
    // global mask; workers on other presets are untouched.
    expect(stagedComposition).toContain('additionalInheritedTools')
    expect(stagedComposition).toContain('workspace.patch')
    expect(stagedComposition).toContain('restrictGlobalToolsToMemoryPut: true')
    const activationFor = (audience: string, reviewConfigurationDigest = 'a2'.repeat(32)) => buildSourceActivationStatement({
      stagedManifestPath,
      stagedPatchPath,
      stagedProfile: {
        manifestSha256: fixtureFileSha256(stagedManifestPath),
        patchSha256: fixtureFileSha256(stagedPatchPath),
        presetManifestPath,
        presetManifestSha256: fixtureFileSha256(presetManifestPath),
        presetCompositionPath,
        presetCompositionSha256: fixtureFileSha256(presetCompositionPath),
      },
      rendererId: TEST_RENDERER_ID,
      reviewConfigurationDigest,
      issuerId: assembly.activationStatement.issuerId,
      brokerId: assembly.activationStatement.brokerId,
      epoch: assembly.activationStatement.epoch,
      web: { port },
      webAumlokProjection: keys.authority.projection,
      kiraRecallPolicy: { subject: keys.control.subject, privacy: ['private'] },
      subjectAuthorityExpectation: {
        ...keys.authority.subjectAuthorityExpectation,
        audience,
      },
    })
    expect(activationDigest(activationFor('broker:source-launch'))).toBe(assembly.activationDigest)
    expect(activationDigest(activationFor('broker:alternate'))).not.toBe(assembly.activationDigest)
    expect(activationDigest(activationFor('broker:source-launch', 'b3'.repeat(32)))).not.toBe(assembly.activationDigest)
    await expect(assembly.executeMemoryPut({ key: 'not.a.browser.proposal', value: true }))
      .rejects.toMatchObject({ reason: 'supervisor:web-browser-only' })

    const firstResponse = await fetch(`http://127.0.0.1:${String(port)}/`)
    expect(firstResponse.status).toBe(200)
    const firstHtml = await firstResponse.text()
    expect(firstHtml).toContain('globalThis["__DSH_BOOT__"]')
    expect(firstHtml).toContain('@deepseek-ai/dsh-client-ui-aumlok')

    const restartedPid = await assembly.restartGuest()
    expect(restartedPid).toBe(assembly.guest.pid)
    expect(restartedPid).not.toBe(firstGuestPid)
    expect(assembly.broker.pid).toBe(brokerPid)
    expect(assembly.issuer.pid).toBe(issuerPid)

    const restartedResponse = await fetch(`http://127.0.0.1:${String(port)}/`)
    expect(restartedResponse.status).toBe(200)
    expect(await restartedResponse.text()).toContain('globalThis["__DSH_BOOT__"]')
    expect(readFileSync(stagedRootPath)).toEqual(stagedRoot)
    expect(lstatSync(stagedRootPath).mtimeMs).toBe(stagedRootIdentity.mtimeMs)
    expect(lstatSync(stagedRootPath).ino).toBe(stagedRootIdentity.ino)
  }, 120_000)

  it('measures the retained Web upgrade with the same workspace mapping as the running launcher', async () => {
    const keys = webAumlokFixture()
    const root = realpathSync(keys.root)
    const dataDir = join(root, 'deployment')
    const workspace = join(root, 'project')
    mkdirSync(workspace, { mode: 0o700 })
    const workspaceRoots = { project: workspace }
    const port = await unusedLoopbackPort()
    const reviewConfigurationDigest = 'a2'.repeat(32)
    const assembly = await launchDeveloperAssembly({
      runtimeDir: join(root, 'runtime'), dataDir, workspaceRoots,
      rootPrivateKeyFile: keys.privatePath, rootPublicKeyFile: keys.publicPath,
      rootControlState: keys.control.activeControl, web: { port }, reviewConfigurationDigest,
      webAumlokProjection: keys.authority.projection,
      kiraRecallPolicy: { subject: keys.control.subject, privacy: ['private'] },
      selectSubjectAuthority: keys.authority.selectSubjectAuthority,
      subjectAuthorityExpectation: keys.authority.subjectAuthorityExpectation,
      review: () => 'denied', issuerApproval: () => 'denied', issuerStderr: () => {},
    })
    assemblies.push(assembly)
    const launched = assembly.activationStatement
    await assembly.close()
    const activationPath = join(assembly.paths.stateDir, 'activation.json')
    const retainedBinding = readFileSync(activationPath)
    const prepare = (aliases?: Readonly<Record<string, string>>) => {
      const stagingDir = realpathSync(mkdtempSync(join(root, 'upgrade-stage-')))
      return prepareWebUpgradeStatement({
        stagingDir, dataDir, ...(aliases === undefined ? {} : { workspaceRoots: aliases }), rendererId: TEST_RENDERER_ID,
        reviewConfigurationDigest, rootPublicKeyPem: keys.control.ed25519PublicKeyPem,
        rootControlState: keys.control.activeControl, web: { port },
        webAumlokProjection: keys.authority.projection,
        selectSubjectAuthority: keys.authority.selectSubjectAuthority,
        subjectAuthorityExpectation: keys.authority.subjectAuthorityExpectation,
      })
    }
    expect(prepare(workspaceRoots)).toEqual(launched)
    expect(activationDigest(prepare())).not.toBe(activationDigest(launched))
    expect(() => prepare({ project: dataDir })).toThrow('supervisor:workspace-protected-path-overlap')
    expect(readFileSync(activationPath)).toEqual(retainedBinding)
    expect(readdirSync(workspace)).toEqual([])
  }, 120_000)

  it('measures the selected Capsule configuration without changing retained state', async () => {
    const keys = webAumlokFixture()
    const root = realpathSync(keys.root)
    const dataDir = join(root, 'deployment')
    const workspace = join(root, 'project')
    mkdirSync(workspace, { mode: 0o700 })
    const workspaceRoots = { project: workspace }
    const webCapsule = {
      worker: { kind: 'opencode' as const, executable: realpathSync(process.execPath),
        // An OpenCode worker runs in the isolated runtime, which composes the CLI's
        // whole configuration from this model and refuses to load without it.
        defaultModel: 'fixture/measured', maxOutputBytes: 1024, maxSpillBytes: 2048, disposeGraceMs: 100 },
      protectedChecks: [{ id: 'fixture-check', program: 'process.exit(0)', timeoutMs: 1000 }],
    }
    const port = await unusedLoopbackPort()
    const reviewConfigurationDigest = 'a2'.repeat(32)
    const assembly = await launchDeveloperAssembly({
      runtimeDir: join(root, 'runtime'), dataDir, workspaceRoots, webCapsule,
      rootPrivateKeyFile: keys.privatePath, rootPublicKeyFile: keys.publicPath,
      rootControlState: keys.control.activeControl, web: { port }, reviewConfigurationDigest,
      webAumlokProjection: keys.authority.projection,
      kiraRecallPolicy: { subject: keys.control.subject, privacy: ['private'] },
      selectSubjectAuthority: keys.authority.selectSubjectAuthority,
      subjectAuthorityExpectation: keys.authority.subjectAuthorityExpectation,
      review: () => 'denied', issuerApproval: () => 'denied', issuerStderr: () => {},
    })
    assemblies.push(assembly)
    await assembly.close()
    const activationPath = join(assembly.paths.stateDir, 'activation.json')
    const retainedBinding = readFileSync(activationPath)
    const capsuleRoot = join(dataDir, 'capsules')
    const capsuleIdentity = lstatSync(capsuleRoot)
    const prepare = (selection: typeof webCapsule | undefined, aliases: Readonly<Record<string, string>> = workspaceRoots) => {
      const stagingDir = realpathSync(mkdtempSync(join(root, 'upgrade-stage-')))
      const statement = prepareWebUpgradeStatement({
        stagingDir, dataDir, workspaceRoots: aliases, webCapsule: selection, rendererId: TEST_RENDERER_ID,
        reviewConfigurationDigest, rootPublicKeyPem: keys.control.ed25519PublicKeyPem,
        rootControlState: keys.control.activeControl, web: { port },
        webAumlokProjection: keys.authority.projection,
        selectSubjectAuthority: keys.authority.selectSubjectAuthority,
        subjectAuthorityExpectation: keys.authority.subjectAuthorityExpectation,
      })
      return { statement, stagingDir }
    }
    const prepared = prepare(webCapsule)
    expect(prepared.statement).toEqual(assembly.activationStatement)
    expect(activationDigest(prepared.statement)).toBe(assembly.activationDigest)
    const capsuleOverlay = JSON.parse(readFileSync(join(prepared.stagingDir, 'profiles', 'aukora-web', 'helix-capsule.overlay.yml'), 'utf8')) as Array<{
      insert: Array<{ config: {
        capsuleRoot: string
        worker: object
        protectedChecks: object[]
        broker: { workspaceAliases: object; receiptPublicKeyPem: string }
      } }>
    }>
    const retainedIdentity = JSON.parse(readFileSync(join(assembly.paths.stateDir, 'keys', 'broker.json'), 'utf8')) as { publicPem: string }
    expect(capsuleOverlay[0]?.insert[0]?.config).toMatchObject({
      capsuleRoot, worker: webCapsule.worker, protectedChecks: webCapsule.protectedChecks,
      broker: { workspaceAliases: workspaceRoots, receiptPublicKeyPem: retainedIdentity.publicPem },
    })
    const leadPreset = readFileSync(join(prepared.stagingDir, 'agent-presets', 'aukora', 'agent.cordis.yml'), 'utf8')
    expect(leadPreset).toContain('Use capsule workspaces to discover operator-registered aliases')
    expect(leadPreset).toContain('inspect with taskId to read the candidate')
    expect(leadPreset).toContain('Native worker dispatch is not a brokered effect or a model-spend grant')
    expect(leadPreset).toContain('Only the operator submits /capsule-promote taskId for broker review')
    expect(activationDigest(prepare(undefined).statement)).not.toBe(assembly.activationDigest)
    expect(activationDigest(prepare({ ...webCapsule,
      protectedChecks: webCapsule.protectedChecks.map(check => ({ ...check, timeoutMs: 2000 })),
    }).statement)).not.toBe(assembly.activationDigest)
    expect(() => prepare(webCapsule, {})).toThrow('supervisor:web-capsule-config-invalid')
    const savedRoot = join(root, 'saved-capsules')
    renameSync(capsuleRoot, savedRoot)
    try {
      expect(() => prepare(webCapsule)).toThrow('supervisor:staging-root-unavailable')
      expect(existsSync(capsuleRoot)).toBe(false)
      symlinkSync(savedRoot, capsuleRoot)
      expect(() => prepare(webCapsule)).toThrow('supervisor:staging-root-unavailable')
    } finally {
      if (existsSync(capsuleRoot) && lstatSync(capsuleRoot).isSymbolicLink()) unlinkSync(capsuleRoot)
      renameSync(savedRoot, capsuleRoot)
    }
    expect(lstatSync(capsuleRoot).ino).toBe(capsuleIdentity.ino)
    expect(readdirSync(capsuleRoot)).toEqual([])
    expect(readFileSync(activationPath)).toEqual(retainedBinding)
    expect(readdirSync(workspace)).toEqual([])
  }, 120_000)

  it('measures and launches the explicit operator Web home without replacing retained state', async () => {
    const keys = webAumlokFixture()
    const root = realpathSync(keys.root)
    const dataDir = join(root, 'deployment')
    const workspace = join(root, 'project')
    const webOperatorHome = join(root, 'operator-home')
    mkdirSync(workspace, { mode: 0o700 })
    mkdirSync(webOperatorHome, { mode: 0o700 })
    const workspaceRoots = { project: workspace }
    const port = await unusedLoopbackPort()
    const reviewConfigurationDigest = 'a2'.repeat(32)
    const observed: Array<{ pid: number | undefined; home: string | undefined; dshHome: string | undefined }> = []
    const realSpawn = childProcess.spawn
    const capture = vi.spyOn(childProcess, 'spawn').mockImplementation((...args: Parameters<typeof spawn>) => {
      const child = realSpawn(...args)
      if (args[1].includes(join(ROOT, 'aukora', 'supervisor', 'developer-web-guest.mjs'))) {
        observed.push({ pid: child.pid, home: args[2].env?.HOME, dshHome: args[2].env?.DSH_HOME })
      }
      return child
    })
    syncBuiltinESMExports()
    let assembly: DeveloperAssembly
    try {
      assembly = await launchDeveloperAssembly({
        runtimeDir: join(root, 'runtime'), dataDir, workspaceRoots, webOperatorHome,
        rootPrivateKeyFile: keys.privatePath, rootPublicKeyFile: keys.publicPath,
        rootControlState: keys.control.activeControl, web: { port }, reviewConfigurationDigest,
        webAumlokProjection: keys.authority.projection,
        kiraRecallPolicy: { subject: keys.control.subject, privacy: ['private'] },
        selectSubjectAuthority: keys.authority.selectSubjectAuthority,
        subjectAuthorityExpectation: keys.authority.subjectAuthorityExpectation,
        review: () => 'denied', issuerApproval: () => 'denied', issuerStderr: () => {},
      })
      assemblies.push(assembly)
    } finally {
      capture.mockRestore()
      syncBuiltinESMExports()
    }
    expect(observed).toEqual([{ pid: assembly.guest.pid, home: webOperatorHome, dshHome: join(dataDir, 'dsh-home') }])
    expect(assembly).toHaveProperty('guestGlobalTools', expect.arrayContaining(['council', 'memory.put', 'workspace.patch']))
    const url = `http://127.0.0.1:${String(port)}`
    expect((await fetch(url)).status).toBe(200)
    const response = await fetch(`${url}/api/session.create`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'operator-home-fixture', method: 'session.create',
        payload: { cwd: workspace, agentPreset: 'aukora' } }),
    })
    expect(response.status).toBe(200)
    const created: unknown = await response.json()
    expect(created).toMatchObject({ result: { ok: true, value: { agentPreset: 'aukora' } } })
    expect(typeof (created as { result: { value: { sessionId?: unknown } } }).result.value.sessionId).toBe('string')
    const presetPath = join(assembly.paths.activationHome, 'agent-presets', 'aukora', 'agent.cordis.yml')
    const preset = JSON.parse(readFileSync(presetPath, 'utf8')) as Array<{ id: string; name: string }>
    expect(preset.map(row => row.id)).toEqual(expect.arrayContaining([
      'tool-bash', 'tool-fs', 'tool-fs-search', 'tool-jobs', 'tool-goal', 'kira', 'auma-canvas-tool',
    ]))
    const profilePatchPath = join(assembly.paths.activationHome, 'profiles', 'aukora-web', 'cordis.patch.yml')
    const profilePatch = loadYaml(readFileSync(profilePatchPath, 'utf8')) as Array<{ id: string; config?: object }>
    expect(profilePatch.find(row => row.id === 'sandbox-policy')).toMatchObject({ config: { mode: 'workspace-write' } })
    expect(profilePatch.find(row => row.id === 'approval')).toMatchObject({ config: { policy: 'ask' } })
    await assembly.close()
    const activationPath = join(assembly.paths.stateDir, 'activation.json')
    const retainedBinding = readFileSync(activationPath)
    const prepare = (operatorHome: string | undefined) => prepareWebUpgradeStatement({
      stagingDir: realpathSync(mkdtempSync(join(root, 'operator-upgrade-stage-'))), dataDir, workspaceRoots,
      ...(operatorHome === undefined ? {} : { webOperatorHome: operatorHome }),
      rendererId: TEST_RENDERER_ID, reviewConfigurationDigest,
      rootPublicKeyPem: keys.control.ed25519PublicKeyPem, rootControlState: keys.control.activeControl,
      web: { port }, webAumlokProjection: keys.authority.projection,
      selectSubjectAuthority: keys.authority.selectSubjectAuthority,
      subjectAuthorityExpectation: keys.authority.subjectAuthorityExpectation,
    })
    expect(prepare(webOperatorHome)).toEqual(assembly.activationStatement)
    expect(activationDigest(prepare(undefined))).not.toBe(assembly.activationDigest)
    const alternateHome = join(root, 'alternate-operator-home')
    mkdirSync(alternateHome, { mode: 0o700 })
    expect(activationDigest(prepare(alternateHome))).not.toBe(assembly.activationDigest)
    const fileHome = join(root, 'operator-home-file')
    writeFileSync(fileHome, 'not a directory', { mode: 0o600 })
    const linkedHome = join(root, 'operator-home-link')
    symlinkSync(webOperatorHome, linkedHome)
    const writableHome = join(root, 'operator-home-writable')
    mkdirSync(writableHome, { mode: 0o700 })
    chmodSync(writableHome, 0o722)
    const missingHome = join(root, 'operator-home-missing')
    for (const invalidHome of [fileHome, linkedHome, `${webOperatorHome}/../operator-home`, writableHome, missingHome]) {
      expect(() => prepare(invalidHome)).toThrow('supervisor:web-operator-home-invalid')
    }
    expect(existsSync(missingHome)).toBe(false)
    await expect(launchDeveloperAssembly({
      runtimeDir: join(root, 'non-web-runtime'), dataDir, webOperatorHome,
      rootPrivateKeyFile: keys.privatePath, rootPublicKeyFile: keys.publicPath,
      review: () => 'denied', issuerApproval: () => 'denied', issuerStderr: () => {},
    })).rejects.toThrow('supervisor:web-operator-home-invalid')
    expect(existsSync(join(root, 'non-web-runtime'))).toBe(false)
    expect(readFileSync(activationPath)).toEqual(retainedBinding)
  }, 120_000)

  it('refuses Web guest restart when a retained activation member changes', async () => {
    const keys = webAumlokFixture()
    const port = await unusedLoopbackPort()
    const assembly = await launchDeveloperAssembly({
      runtimeDir: join(keys.root, 'runtime'),
      rootPrivateKeyFile: keys.privatePath,
      rootPublicKeyFile: keys.publicPath,
      rootControlState: keys.control.activeControl,
      web: { port },
      webAumlokProjection: keys.authority.projection,
      kiraRecallPolicy: { subject: keys.control.subject, privacy: ['private'] },
      selectSubjectAuthority: keys.authority.selectSubjectAuthority,
      subjectAuthorityExpectation: keys.authority.subjectAuthorityExpectation,
      review: () => 'denied',
      issuerApproval: () => 'denied',
      issuerStderr: () => {},
    })
    assemblies.push(assembly)
    const firstGuestPid = assembly.guest.pid
    if (firstGuestPid === undefined) throw new Error('Web guest omitted its pid')
    const stagedPreset = join(
      assembly.paths.activationHome,
      'agent-presets',
      'aukora',
      'agent.cordis.yml',
    )
    const originalPreset = readFileSync(stagedPreset, 'utf8')
    writeFileSync(stagedPreset, `${originalPreset}\n# changed after READY\n`)

    await expect(assembly.restartGuest()).rejects.toMatchObject({
      reason: 'supervisor:activation-input-changed',
    })
    expect(assembly.guest.pid).toBe(firstGuestPid)
    expect(processExists(firstGuestPid)).toBe(true)
    const retainedResponse = await fetch(`http://127.0.0.1:${String(port)}/`)
    expect(retainedResponse.status).toBe(200)
    expect(await retainedResponse.text()).toContain('globalThis["__DSH_BOOT__"]')

    writeFileSync(stagedPreset, originalPreset)
    const restartedPid = await assembly.restartGuest()
    expect(restartedPid).not.toBe(firstGuestPid)
    expect(restartedPid).toBe(assembly.guest.pid)
  }, 120_000)

  // ROW 2A. dsh composes [bundle, staged profile, HOME LAYER, overlays], so a
  // `cordis.patch.yml` in the DSH home outranks the measured staged profile and
  // is not a member of the activation statement. A per-launch home could not
  // carry one; a durable home can, and it is written after READY, so only a
  // check at the restart boundary can see it.
  it('refuses a Web guest restart when a home composition layer appears after READY', async () => {
    const keys = webAumlokFixture()
    const port = await unusedLoopbackPort()
    const assembly = await launchDeveloperAssembly({
      runtimeDir: join(keys.root, 'runtime'),
      dataDir: join(keys.root, 'deployment'),
      rootPrivateKeyFile: keys.privatePath,
      rootPublicKeyFile: keys.publicPath,
      rootControlState: keys.control.activeControl,
      web: { port },
      webAumlokProjection: keys.authority.projection,
      kiraRecallPolicy: { subject: keys.control.subject, privacy: ['private'] },
      selectSubjectAuthority: keys.authority.selectSubjectAuthority,
      subjectAuthorityExpectation: keys.authority.subjectAuthorityExpectation,
      review: () => 'approved',
      issuerApproval: () => 'approved',
      issuerStderr: () => {},
    })
    assemblies.push(assembly)
    const firstGuestPid = assembly.guest.pid
    const brokerPid = assembly.broker.pid
    const issuerPid = assembly.issuer.pid
    if (firstGuestPid === undefined) throw new Error('Web guest omitted its pid')

    // POSITIVE CONTROL: this deployment restarts its guest before the plant.
    const cleanRestartPid = await assembly.restartGuest()
    expect(cleanRestartPid).not.toBe(firstGuestPid)

    const landed = join(keys.root, 'HOSTILE-LANDED')
    const hostileModule = join(keys.root, 'hostile-plugin.mjs')
    writeFileSync(hostileModule, [
      "import { writeFileSync } from 'node:fs'",
      `writeFileSync(${JSON.stringify(landed)}, 'mounted')`,
      'export const apply = () => {}',
      'export default apply',
      '',
    ].join('\n'))
    writeFileSync(join(assembly.paths.activationHome, 'cordis.patch.yml'), [
      '- insert:',
      '    - id: hostile',
      `      name: ${JSON.stringify(`file://${hostileModule}`)}`,
      '',
    ].join('\n'))

    const servingPid = assembly.guest.pid
    await expect(assembly.restartGuest()).rejects.toMatchObject({
      reason: 'supervisor:home-composition-layer-present',
    })

    // The serving assembly is untouched: same guest, same broker, same issuer.
    expect(assembly.guest.pid).toBe(servingPid)
    expect(processExists(servingPid as number)).toBe(true)
    expect(assembly.broker.pid).toBe(brokerPid)
    expect(assembly.issuer.pid).toBe(issuerPid)
    const retained = await fetch(`http://127.0.0.1:${String(port)}/`)
    expect(retained.status).toBe(200)
    // The hostile plugin never mounted, in either the refused spawn or the
    // guest that kept serving.
    expect(existsSync(landed)).toBe(false)
  }, 120_000)

  it('refuses a durable Web relaunch before clearing a symlinked profile staging parent', async () => {
    const keys = webAumlokFixture()
    const dataDir = join(keys.root, 'deployment')
    const port = await unusedLoopbackPort()
    const launchWith = (runtimeDir: string) => launchDeveloperAssembly({
      runtimeDir,
      dataDir,
      rootPrivateKeyFile: keys.privatePath,
      rootPublicKeyFile: keys.publicPath,
      rootControlState: keys.control.activeControl,
      web: { port },
      webAumlokProjection: keys.authority.projection,
      kiraRecallPolicy: { subject: keys.control.subject, privacy: ['private'] },
      selectSubjectAuthority: keys.authority.selectSubjectAuthority,
      subjectAuthorityExpectation: keys.authority.subjectAuthorityExpectation,
      review: () => 'approved' as const,
      issuerApproval: () => 'approved' as const,
      issuerStderr: () => {},
    })

    const first = await launchWith(join(keys.root, 'runtime-one'))
    assemblies.push(first)
    await first.close()

    const profilesRoot = join(dataDir, 'dsh-home', 'profiles')
    const canaryProfile = join(keys.root, 'canary', 'aukora-web')
    const marker = join(canaryProfile, 'marker.txt')
    rmSync(profilesRoot, { recursive: true, force: true })
    mkdirSync(canaryProfile, { recursive: true, mode: 0o700 })
    writeFileSync(marker, 'untouched\n', { mode: 0o600 })
    symlinkSync(join(keys.root, 'canary'), profilesRoot, process.platform === 'win32' ? 'junction' : 'dir')

    let failure: unknown
    try {
      const second = await launchWith(join(keys.root, 'runtime-two'))
      assemblies.push(second)
    } catch (error) {
      failure = error
    }
    expect(readFileSync(marker, 'utf8')).toBe('untouched\n')
    expect(readdirSync(canaryProfile)).toEqual(['marker.txt'])
    expect(lstatSync(profilesRoot).isSymbolicLink()).toBe(true)
    expect(failure).toMatchObject({ reason: 'supervisor:staging-root-unavailable' })
  }, 120_000)

  // The broker route enters the staged composition and therefore the activation
  // digest. Reading TMPDIR would make a parent started with a different value
  // measure a different activation and be refused entry to the state its own
  // previous launch wrote.
  it('keeps one durable deployment on one route and one activation across TMPDIR values', async () => {
    const keys = webAumlokFixture()
    const dataDir = join(keys.root, 'deployment')
    const port = await unusedLoopbackPort()
    const launchWith = async (temporaryDirectory: string) => {
      const previous = process.env.TMPDIR
      process.env.TMPDIR = temporaryDirectory
      try {
        const assembly = await launchDeveloperAssembly({
          runtimeDir: join(keys.root, `runtime-${basename(temporaryDirectory)}`),
          dataDir,
          rootPrivateKeyFile: keys.privatePath,
          rootPublicKeyFile: keys.publicPath,
          rootControlState: keys.control.activeControl,
          web: { port },
          webAumlokProjection: keys.authority.projection,
          kiraRecallPolicy: { subject: keys.control.subject, privacy: ['private'] },
          selectSubjectAuthority: keys.authority.selectSubjectAuthority,
          subjectAuthorityExpectation: keys.authority.subjectAuthorityExpectation,
          review: () => 'approved',
          issuerApproval: () => 'approved',
          issuerStderr: () => {},
        })
        return assembly
      } finally {
        if (previous === undefined) delete process.env.TMPDIR
        else process.env.TMPDIR = previous
      }
    }
    const first = join(keys.root, 'tmp-a')
    const second = join(keys.root, 'tmp-b')
    mkdirSync(first, { recursive: true, mode: 0o700 })
    mkdirSync(second, { recursive: true, mode: 0o700 })

    const one = await launchWith(first)
    const oneDigest = one.activationDigest
    const oneRoute = one.paths.brokerSocket
    expect(Buffer.byteLength(oneRoute, 'utf8')).toBeLessThanOrEqual(103)
    await one.close()

    const two = await launchWith(second)
    assemblies.push(two)
    // Same canonical data root, different TMPDIR: one route, one activation.
    expect(two.paths.brokerSocket).toBe(oneRoute)
    expect(two.activationDigest).toBe(oneDigest)
    expect(oneRoute.includes(first)).toBe(false)
    expect(oneRoute.includes(second)).toBe(false)
  }, 120_000)

  // ROW 2B. The user preset root is a separate question from the home patch
  // layer and must not be answered by a home-layer refusal. The governed Web
  // composition disables it, so the mechanism under test is exclusion by a
  // measured row rather than refusal.
  it('excludes the user preset root from the durable Web assembly across restart', async () => {
    const keys = webAumlokFixture()
    const port = await unusedLoopbackPort()
    const assembly = await launchDeveloperAssembly({
      runtimeDir: join(keys.root, 'runtime'),
      dataDir: join(keys.root, 'deployment'),
      rootPrivateKeyFile: keys.privatePath,
      rootPublicKeyFile: keys.publicPath,
      rootControlState: keys.control.activeControl,
      web: { port },
      webAumlokProjection: keys.authority.projection,
      kiraRecallPolicy: { subject: keys.control.subject, privacy: ['private'] },
      selectSubjectAuthority: keys.authority.selectSubjectAuthority,
      subjectAuthorityExpectation: keys.authority.subjectAuthorityExpectation,
      review: () => 'approved',
      issuerApproval: () => 'approved',
      issuerStderr: () => {},
    })
    assemblies.push(assembly)

    // The mechanism: the measured staged composition disables the user root, so
    // the roster never resolves one. Read it from the staged bytes the
    // activation digests, not from the source profile.
    const stagedPatch = readFileSync(
      join(assembly.paths.activationHome, 'profiles', 'aukora-web', 'cordis.patch.yml'),
      'utf8',
    )
    expect(stagedPatch).toContain('includeUserRoot: false')

    // Plant a user preset in the durable home the excluded root would name.
    const userPresetDir = join(assembly.paths.activationHome, '.agent-presets', 'intruder')
    mkdirSync(userPresetDir, { recursive: true, mode: 0o700 })
    writeFileSync(join(userPresetDir, 'preset.yml'), 'label: intruder\n')

    // No home patch layer exists, so a refusal here would be the wrong
    // mechanism. The restart must SUCCEED and simply not adopt the preset.
    const restartedPid = await assembly.restartGuest()
    expect(restartedPid).toBe(assembly.guest.pid)
    const serving = await fetch(`http://127.0.0.1:${String(port)}/`)
    expect(serving.status).toBe(200)
    // The planted preset is still on disk and was never adopted into the
    // measured composition.
    expect(existsSync(join(userPresetDir, 'preset.yml'))).toBe(true)
    expect(readFileSync(
      join(assembly.paths.activationHome, 'profiles', 'aukora-web', 'cordis.patch.yml'),
      'utf8',
    )).toBe(stagedPatch)
  }, 120_000)

  it('refuses a live turn without credentials and writes nothing', async () => {
    const keys = keyFixture()
    const previous = process.env.DEEPSEEK_API_KEY
    delete process.env.DEEPSEEK_API_KEY
    let reviews = 0
    try {
      const assembly = await launchDeveloperAssembly({
        runtimeDir: join(keys.root, 'runtime'),
        rootPrivateKeyFile: keys.privatePath,
        rootPublicKeyFile: keys.publicPath,
        liveTurn: {},
        kiraRecallPolicy: { subject: 'aukora:subject:owner', privacy: ['local'] },
        review: () => { reviews += 1; return 'approved' },
        issuerApproval: () => 'approved',
        issuerStderr: () => {},
      })
      assemblies.push(assembly)
      expect(assembly.observationClass).toBe(DEVELOPER_OBSERVATION_CLASS)
      expect(assembly.activationStatement.modelEmissionPolicy).toBe('aukora:model-emission:parent-staged-loop:v1')
      const execution = await assembly.executeUserTurn('Store one object at live.turn')
      expect(execution.outcome).toBe('REFUSED')
      expect(execution.result.isError).toBe(true)
      expect(String(execution.result.error && typeof execution.result.error === 'object'
        && 'message' in execution.result.error
        ? execution.result.error.message
        : '')).toContain('supervisor:model-credential-missing')
      expect(reviews).toBe(0)
      expect(worldCounts(assembly.paths.stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
    } finally {
      if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
      else process.env.DEEPSEEK_API_KEY = previous
    }
  }, 90_000)

  it('returns exit two when a fixture turn is denied on the parent artifact frame', async () => {
    const keys = keyFixture()
    const { exit, stdout, stderr, answered, expectedRecordId, subject } = await runLiveTurnCommand(keys, 'no')
    expect(exit).toEqual({ code: 2, signal: null })
    expect(answered.size).toBe(1)
    const lines = stdout.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(lines[0]).toMatchObject({
      schema: 'aukora:developer-launch:v1',
      status: 'READY',
      observationClass: DEVELOPER_OBSERVATION_CLASS,
      aumlok: {
        subject,
        grantDomain: 'aukora:tool-grant:v5',
      },
    })
    expect(lines[1]).toMatchObject({
      schema: 'aukora:source-launch-result:v1',
      observationClass: DEVELOPER_OBSERVATION_CLASS,
      outcome: 'REFUSED',
    })
    expect(stderr).toContain('approvalArtifactDigest:')
    // The proposed key is the record identifier KIRA derived, not a constant
    // the fixture carried: the parent reviewed the staged record itself.
    expect(stderr).toContain(`key: ${expectedRecordId}`)
    const stateDir = join(keys.root, 'runtime', 'broker-state')
    expect(worldCounts(stateDir)).toEqual({ aura: 0, nonces: 0, objects: 0 })
    expect(storedKeys(stateDir)).toEqual([])
    expect(existsSync(join(stateDir, 'authority-evidence'))).toBe(false)
    // The refusal lands on the parent frame: exactly one challenge is visible
    // on the captured route. The approve row renders two, which keeps this
    // count non-vacuous without treating it as direct signature evidence.
    expect(approvalChallengeCount(stderr)).toBe(1)
  }, 90_000)

  it('returns exit zero when a fixture turn receives parent yes and writes one object', async () => {
    const keys = keyFixture()
    const { exit, stdout, stderr, answered, expectedRecordId, subject } = await runLiveTurnCommand(keys, 'yes')
    expect(exit).toEqual({ code: 0, signal: null })
    expect(answered.size).toBe(2)
    const lines = stdout.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(lines[0]).toMatchObject({
      schema: 'aukora:developer-launch:v1',
      status: 'READY',
      observationClass: DEVELOPER_OBSERVATION_CLASS,
      aumlok: {
        subject,
        grantDomain: 'aukora:tool-grant:v5',
      },
    })
    expect(lines[1]).toMatchObject({
      schema: 'aukora:source-launch-result:v1',
      observationClass: DEVELOPER_OBSERVATION_CLASS,
      outcome: 'SETTLED',
    })
    expect(stderr).toContain('approvalArtifactDigest:')
    expect(stderr).toContain(`key: ${expectedRecordId}`)
    const stateDir = join(keys.root, 'runtime', 'broker-state')
    expect(worldCounts(stateDir)).toEqual({ aura: 1, nonces: 1, objects: 1 })
    expect(approvalChallengeCount(stderr)).toBe(2)
    // The settled key IS the deterministic record identifier: the write landed
    // where KIRA named it, through memory.put, with nothing renaming it on the way.
    expect(storedKeys(stateDir)).toEqual([expectedRecordId])
    // Aura records that same key, so the settlement and its evidence agree.
    const aura = readFileSync(join(stateDir, 'aura.jsonl'), 'utf8')
      .split('\n').filter(line => line !== '')
      .map(line => JSON.parse(line) as Record<string, unknown>)
    expect(aura).toHaveLength(1)
    expect(aura[0]).toMatchObject({
      verdict: 'settled',
      key: expectedRecordId,
    })
    const evidenceFiles = readdirSync(join(stateDir, 'authority-evidence'))
    expect(evidenceFiles).toHaveLength(1)
    const evidence = readAuthorityEvidence(JSON.parse(readFileSync(
      join(stateDir, 'authority-evidence', evidenceFiles[0] as string),
      'utf8',
    )))
    expect(evidence).toMatchObject({
      grantDomain: 'aukora:tool-grant:v5',
      subject,
      audience: 'broker:source-launch',
      resource: `memory:key:${expectedRecordId}`,
    })
  }, 90_000)

  it('binds KIRA reachability into the reviewed overlay digest', () => {
    // The staging route reaches the turn only through these overlay bytes.
    // This row proves removing it changes the bytes the launcher pins; launch
    // ordering and the validator's named refusal are separate assertions.
    const overlayPath = join(ROOT, 'aukora', 'supervisor', 'live-turn.overlay.yml')
    const overlay = readFileSync(overlayPath, 'utf8')
    expect(() => { validateLiveTurnOverlays(true) }).not.toThrow()
    expect(createHash('sha256').update(overlay).digest('hex')).toBe(SOURCE_LIVE_TURN_OVERLAY_SHA256)

    const withoutKira = overlay.replace(/ {4}- id: aukora-kira\n {6}name: '@deepseek-ai\/dsh-aukora-kira'\n\n/, '')
    expect(withoutKira).not.toBe(overlay)
    expect(withoutKira).not.toContain('dsh-aukora-kira')
    expect(createHash('sha256').update(withoutKira).digest('hex')).not.toBe(SOURCE_LIVE_TURN_OVERLAY_SHA256)
  })
})

/** Read one bounded JSON line from a command child. */
function readJsonLine(child: ReturnType<typeof spawn>): Promise<Record<string, unknown>> {
  return new Promise((resolveLine, reject) => {
    let buffer = ''
    const timer = setTimeout(() => {
      finish(() => { reject(new Error('command omitted its ready line')) })
    }, 10_000)
    const finish = (callback: () => void) => {
      clearTimeout(timer)
      child.stdout?.removeListener('data', onData)
      child.removeListener('exit', onExit)
      callback()
    }
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(() => {
        reject(new Error(`command exited before readiness with code ${String(code)} signal ${String(signal)}`))
      })
    }
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      if (Buffer.byteLength(buffer, 'utf8') > 64 * 1024) {
        finish(() => { reject(new Error('command ready line exceeded 65536 bytes')) })
        return
      }
      const cut = buffer.indexOf('\n')
      if (cut === -1) return
      finish(() => {
        try {
          resolveLine(JSON.parse(buffer.slice(0, cut)) as Record<string, unknown>)
        } catch (error: unknown) {
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
    }
    child.stdout?.on('data', onData)
    child.once('exit', onExit)
  })
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}

function worldCounts(stateDir: string): { aura: number; nonces: number; objects: number } {
  const auraPath = join(stateDir, 'aura.jsonl')
  const nonceDir = join(stateDir, 'nonces')
  const objectDir = join(stateDir, 'memory', 'objects')
  return {
    aura: existsSync(auraPath)
      ? readFileSync(auraPath, 'utf8').split('\n').filter(line => line !== '').length
      : 0,
    nonces: existsSync(nonceDir) ? readdirSync(nonceDir).length : 0,
    objects: existsSync(objectDir) ? readdirSync(objectDir).length : 0,
  }
}

/**
 * Keys the governed store holds, which is where a settled `memory.put` names
 * its record. Separate from {@link worldCounts} so a deny pass can assert the
 * key namespace stayed empty without changing the counts other rows pin.
 */
function storedKeys(stateDir: string): string[] {
  const keyDir = join(stateDir, 'memory', 'keys')
  if (!existsSync(keyDir)) return []
  // The store names each key file `<key>.json`; the extension is the file's,
  // not the key's, so it is dropped here rather than written into the expected
  // value where it would read as part of the record identifier.
  return readdirSync(keyDir).map(entry => entry.replace(/\.json$/, '')).sort()
}

/**
 * Approval challenges rendered on the command's stderr.
 *
 * A parent-staged turn renders one for the parent artifact frame and a second
 * for the issuer, in that order. The approve row pins two so the deny row's
 * one is a measurement rather than a count of something never emitted. This
 * is route-progress evidence, not direct observation of the signing call.
 */
function approvalChallengeCount(stderr: string): number {
  return [...stderr.matchAll(/approve\? type "yes [0-9a-f]{16}": /g)].length
}

/**
 * The record identifier `kira.stage` derives from the fixture's fixed
 * candidate. Restated here rather than imported so a change to the staging
 * rule has to be adopted deliberately in both places.
 */
function fixtureRecordId(subject: string, privacy: 'local' | 'exportable' | 'private'): string {
  return stageKiraMemoryRecord({
    subject,
    kind: 'observation',
    source: [],
    content: { note: 'live turn fixture' },
    links: [],
    privacy,
    createdAt: '2026-08-29T00:00:00Z',
  }).recordId
}

async function runLiveTurnCommand(
  keys: { privatePath: string; publicPath: string; root: string },
  decision: 'yes' | 'no',
): Promise<{
  exit: { code: number | null; signal: NodeJS.Signals | null }
  stdout: string
  stderr: string
  answered: Set<string>
  expectedRecordId: string
  subject: string
}> {
  const configPath = join(keys.root, 'launch.json')
  const turnPath = join(keys.root, 'turn.json')
  const controlDir = join(keys.root, 'aumlok-control')
  const control = loadOrCreateLocalAumlokControl(controlDir)
  const expectedRecordId = fixtureRecordId(control.subject, 'private')
  writeFileSync(configPath, JSON.stringify({
    schema: 'aukora:developer-launch:v1',
    runtimeDir: join(keys.root, 'runtime'),
    rootPrivateKeyFile: keys.privatePath,
    rootPublicKeyFile: keys.publicPath,
  }))
  writeFileSync(turnPath, JSON.stringify({
    schema: 'aukora:live-turn:v1',
    prompt: 'Store one object at live.turn',
  }))
  const child = spawn(process.execPath, [
    '--',
    join(ROOT, 'aukora', 'supervisor', 'developer-live-turn-bin.mjs'),
    configPath,
    turnPath,
    '--control-dir',
    controlDir,
  ], {
    cwd: ROOT,
    env: { ...process.env, AUKORA_LIVE_TURN_FIXTURE: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  commandChildren.push(child)
  let stdout = ''
  let stderr = ''
  const answered = new Set<string>()
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
    for (const match of stderr.matchAll(/approve\? type "yes ([0-9a-f]{16})": /g)) {
      const challenge = match[1]
      if (challenge === undefined || answered.has(challenge)) continue
      answered.add(challenge)
      child.stdin.write(decision === 'yes' ? `yes ${challenge}\n` : 'no\n')
      if (decision === 'no') break
    }
  })
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => { resolveExit({ code, signal }) })
  })
  commandChildren.splice(commandChildren.indexOf(child), 1)
  return { exit, stdout, stderr, answered, expectedRecordId, subject: control.subject }
}
