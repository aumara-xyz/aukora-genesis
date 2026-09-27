/** Actual macOS enforcement through the prepared 8088 Cordis guest and ToolRuntime. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import childProcess, { type SpawnOptions } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { loadOrCreateLocalAumlokControl } from '../aukora/identity/local-control-store.mjs'
import { createDeveloperAumlokAuthority } from '../aukora/supervisor/developer-aumlok.mjs'
import { launchDeveloperAssembly, parseDeveloperMemoryPut, type DeveloperAssembly } from '../aukora/supervisor/developer-launch.mjs'
import { prepareGuestConfinement, requireGuestConfinement } from '../aukora/supervisor/guest-confinement.mjs'
import { stageKiraMemoryRecord } from '../aukora/kira/stage.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const GUEST = join(ROOT, 'aukora/supervisor/developer-guest.mjs')
const rendererId = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex')
const roots: string[] = []
const assemblies: DeveloperAssembly[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  syncBuiltinESMExports()
  for (const assembly of assemblies.splice(0)) await assembly.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'deep-confined-')))
  roots.push(root)
  const control = loadOrCreateLocalAumlokControl(join(root, 'authority'))
  const authority = createDeveloperAumlokAuthority(control, { audience: 'broker:confined-test' })
  const privatePath = join(root, 'issuer-private.pem')
  const publicPath = join(root, 'issuer-public.pem')
  writeFileSync(privatePath, control.ed25519PrivateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  writeFileSync(publicPath, control.ed25519PublicKeyPem, { mode: 0o600 })
  const staged = stageKiraMemoryRecord({ subject: control.subject, kind: 'observation', source: [],
    content: { note: 'confined ToolRuntime' }, links: [], privacy: 'local', createdAt: '2026-09-06T00:00:00Z' })
  return { root, privatePath, operation: parseDeveloperMemoryPut(JSON.stringify(staged.memoryPut)), options: {
    runtimeDir: join(root, 'runtime'), rootPrivateKeyFile: privatePath, rootPublicKeyFile: publicPath,
    rootControlState: control.activeControl, rendererId, guestConfinement: 'macos-seatbelt' as const,
    kiraRecallPolicy: { subject: control.subject, privacy: ['local'] },
    subjectAuthorityExpectation: authority.subjectAuthorityExpectation,
    selectSubjectAuthority: authority.selectSubjectAuthority,
    issuerStderr: () => {},
  } }
}

function counts(state: string) {
  const count = (path: string) => existsSync(path) ? readdirSync(path).length : 0
  return {
    objects: count(join(state, 'memory/objects')), keys: count(join(state, 'memory/keys')),
    nonces: count(join(state, 'nonces')),
    aura: existsSync(join(state, 'aura.jsonl')) ? readFileSync(join(state, 'aura.jsonl'), 'utf8').trim().split('\n').filter(Boolean).length : 0,
  }
}

/** Insert adversarial code into the actual guest; the preflight remains untouched. */
function instrumentGuest(source: string) {
  const originalSpawn = childProcess.spawn
  let output = ''
  const instrumented = (command: string, args: readonly string[], options: SpawnOptions) => {
    let selectedCommand = command
    let selectedArgs = [...args]
    const actualGuest = command === '/usr/bin/sandbox-exec' && args.includes(GUEST)
    if (actualGuest) {
      const nodeIndex = args.indexOf('--') + 1
      const nodeArgs = ['--import', `data:text/javascript,${encodeURIComponent(source)}`, ...args.slice(nodeIndex + 1)]
      if (process.env.AUKORA_TEST_REMOVE_GUEST_RESTRICTION === '1') {
        selectedCommand = process.execPath
        selectedArgs = nodeArgs
      } else selectedArgs = [...args.slice(0, nodeIndex + 1), ...nodeArgs]
    }
    const child = originalSpawn(selectedCommand, selectedArgs, options)
    if (actualGuest) child.stdout?.on('data', (chunk) => { output += String(chunk) })
    return child
  }
  vi.spyOn(childProcess, 'spawn').mockImplementation(instrumented)
  syncBuiltinESMExports()
  return () => JSON.parse(output.trim()) as Record<string, unknown>
}

async function noProcess(pid: number | undefined): Promise<boolean> {
  if (pid === undefined) return false
  for (let attempt = 0; attempt < 100; attempt++) {
    try { process.kill(pid, 0) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true
      throw error
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  return false
}

describe('parent-owned governed source launch confinement', () => {
  it('refuses an unsupported requested mode before launching any assembly', () => {
    expect(() => { requireGuestConfinement('unconfined-fallback') }).toThrow('confined:mode-unsupported')
  })

  it('names unsupported platforms instead of accepting an ordinary guest', () => {
    if (process.platform === 'darwin') expect(() => { requireGuestConfinement('macos-seatbelt') }).not.toThrow()
    else expect(() => { requireGuestConfinement('macos-seatbelt') }).toThrow('confined:platform-unsupported')
  })

  it.runIf(process.platform === 'darwin')('refuses private symlink and hard-link aliases before admission', () => {
    const f = fixture()
    const root = join(f.root, 'code')
    const paths = { guestHome: join(f.root, 'guest'), activationHome: join(f.root, 'activation'),
      stateDir: join(f.root, 'state'), brokerSocket: join(f.root, 'broker.sock'), issuerSocket: join(f.root, 'issuer.sock') }
    for (const path of ['aukora', 'apps/cli/lib', 'apps/cli/node_modules', 'node_modules', 'packages', 'vendor']) {
      mkdirSync(join(root, path), { recursive: true })
    }
    for (const path of [paths.stateDir, join(paths.activationHome, 'profiles/8088-inside-out'), join(paths.activationHome, 'profiles/node_modules')]) {
      mkdirSync(path, { recursive: true })
    }
    writeFileSync(join(root, 'package.json'), '{}')
    const alias = join(root, 'packages', 'private-alias')
    symlinkSync(f.privatePath, alias)
    expect(() => prepareGuestConfinement({ root, paths, issuerKey: f.privatePath })).toThrow('confined:read-alias-escapes')
    rmSync(alias)
    linkSync(f.privatePath, alias)
    expect(() => prepareGuestConfinement({ root, paths, issuerKey: f.privatePath })).toThrow('confined:hardlinked-private-key')
  })

  it.runIf(process.platform === 'darwin')('records the public confined command with scripted approval and denial', async () => {
    const transcript = []
    for (const decision of ['yes', 'no']) {
      const f = fixture()
      const config = join(f.root, 'launch.json')
      const operation = join(f.root, 'operation.json')
      writeFileSync(config, JSON.stringify({ schema: 'aukora:developer-launch:v1',
        runtimeDir: f.options.runtimeDir, rootPrivateKeyFile: f.privatePath, rootPublicKeyFile: f.options.rootPublicKeyFile }))
      writeFileSync(operation, JSON.stringify({ key: 'confined.command', value: { source: 'ToolRuntime' } }))
      const child = childProcess.spawn(process.execPath, ['--', join(ROOT, 'aukora/supervisor/developer-launch-bin.mjs'), '--confined', config, operation], {
        cwd: ROOT, env: { LANG: 'C' }, stdio: ['pipe', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      const answered = new Set<string>()
      child.stdout.on('data', (chunk) => { stdout += String(chunk) })
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk)
        for (const match of stderr.matchAll(/approve\? type "yes ([0-9a-f]{16})": /g)) {
          const challenge = match[1]
          if (challenge === undefined || answered.has(challenge)) continue
          answered.add(challenge)
          child.stdin.write(decision === 'yes' ? `yes ${challenge}\n` : 'no\n')
        }
      })
      try {
        const code = await new Promise<number | null>((resolve, reject) => {
          child.once('error', reject)
          child.once('close', (value) => { resolve(value) })
        })
        const rows = stdout.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
        expect(rows, stderr).toHaveLength(2)
        transcript.push({ decision, status: rows[0]?.status, observationClass: rows[0]?.observationClass,
          outcome: rows[1]?.outcome, code, prompts: answered.size, world: counts(join(f.options.runtimeDir, 'broker-state')) })
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
        await noProcess(child.pid)
      }
    }
    expect(transcript).toMatchInlineSnapshot(`
      [
        {
          "code": 0,
          "decision": "yes",
          "observationClass": "MACOS_SEATBELT_GUEST / SAME_UID_AUTHORITIES / NO_CUSTODY_CLAIM",
          "outcome": "SETTLED",
          "prompts": 2,
          "status": "READY",
          "world": {
            "aura": 1,
            "keys": 1,
            "nonces": 1,
            "objects": 1,
          },
        },
        {
          "code": 2,
          "decision": "no",
          "observationClass": "MACOS_SEATBELT_GUEST / SAME_UID_AUTHORITIES / NO_CUSTODY_CLAIM",
          "outcome": "REFUSED",
          "prompts": 1,
          "status": "READY",
          "world": {
            "aura": 0,
            "keys": 0,
            "nonces": 0,
            "objects": 0,
          },
        },
      ]
    `)
  }, 40_000)

  it.runIf(process.platform === 'darwin')('settles approved KIRA memory through actual ToolRuntime and keeps denied state unchanged', async () => {
    const f = fixture()
    let approved = false
    let issuerPrompts = 0
    const assembly = await launchDeveloperAssembly({ ...f.options,
      review: () => approved ? 'approved' : 'denied',
      issuerApproval: () => { issuerPrompts++; return 'approved' },
    })
    assemblies.push(assembly)
    expect(assembly.observationClass).toContain('MACOS_SEATBELT_GUEST')
    expect(assembly.artifact.guestConfinementProfileSha256).toMatch(/^[0-9a-f]{64}$/)
    const before = counts(assembly.paths.stateDir)
    const denied = await assembly.executeMemoryPut(f.operation)
    expect(denied.outcome).toBe('REFUSED')
    expect(JSON.stringify(denied)).toContain('broker:review-denied')
    expect(counts(assembly.paths.stateDir)).toEqual(before)
    expect(issuerPrompts).toBe(0)
    approved = true
    const accepted = await assembly.executeMemoryPut(f.operation)
    expect(accepted.outcome).toBe('SETTLED')
    expect(issuerPrompts).toBe(1)
    expect(counts(assembly.paths.stateDir)).toEqual({ objects: 1, keys: 1, nonces: 1, aura: 1 })
    await assembly.close()
    for (const child of [assembly.guest, assembly.broker, assembly.issuer]) {
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
    }
  }, 40_000)

  it.runIf(process.platform === 'darwin')('denies protected resources in the actual guest while its broker and parent routes work', async () => {
    const f = fixture()
    const server = createServer(socket => socket.end())
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('live network canary did not bind')
    const runtime = f.options.runtimeDir
    const startup = join(runtime, 'activation/profiles/8088-inside-out/cordis.patch.yml')
    const unrelatedSecret = join(f.root, 'host-secret-canary')
    writeFileSync(unrelatedSecret, 'private-host-canary', { mode: 0o600 })
    const source = `import fs from 'node:fs';import cp from 'node:child_process';import net from 'node:net';
      const attempt=fn=>{try{fn();return 'LANDED'}catch(e){return e.code}};
      const connect=endpoint=>new Promise(resolve=>{const socket=net.connect(endpoint);socket.once('connect',()=>{socket.destroy();resolve('LANDED')});socket.once('error',e=>resolve(e.code));socket.setTimeout(1000,()=>{socket.destroy();resolve('TIMEOUT')})});
      const state=${JSON.stringify(join(runtime, 'broker-state'))};
      const startup=${JSON.stringify(startup)};
      console.log(JSON.stringify({
        issuerKey:attempt(()=>fs.readFileSync(${JSON.stringify(f.privatePath)})),
        otherSecret:attempt(()=>fs.readFileSync(${JSON.stringify(unrelatedSecret)})),
        state:attempt(()=>fs.readdirSync(state)),
        stateWrite:attempt(()=>fs.writeFileSync(state+'/guest-attack','bad')),
        startupWrite:attempt(()=>fs.writeFileSync(startup,fs.readFileSync(startup))),
        process:cp.spawnSync(process.execPath,['-e',''],{stdio:'ignore'}).error?.code??'LANDED',
        detached:cp.spawnSync(process.execPath,['-e',''],{detached:true,stdio:'ignore'}).error?.code??'LANDED',
        broker:await connect({path:${JSON.stringify(join(runtime, 'broker.sock'))}}),
        issuer:await connect({path:${JSON.stringify(join(runtime, 'issuer.sock'))}}),
        network:await connect({host:'127.0.0.1',port:${String(address.port)}}),
        env:Object.keys(process.env).sort()
      }));`
    const observation = instrumentGuest(source)
    try {
      const assembly = await launchDeveloperAssembly({ ...f.options, review: () => 'approved', issuerApproval: () => 'approved' })
      assemblies.push(assembly)
      const actual = observation()
      expect(actual.issuerKey, 'actual guest must not read issuer key').toBe('EPERM')
      expect(actual.otherSecret).toBe('EPERM')
      expect(actual.state).toBe('EPERM')
      expect(actual.stateWrite).toBe('EPERM')
      expect(actual.startupWrite).toBe('EPERM')
      expect(actual.process).toBe('EPERM')
      expect(actual.detached).toBe('EPERM')
      expect(actual.issuer).toBe('EPERM')
      expect(actual.network).toBe('EPERM')
      expect(actual.broker).toBe('LANDED')
      expect(actual.env).toEqual(['DSH_HOME', 'DSH_TELEMETRY_DISABLED', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', '__CF_USER_TEXT_ENCODING'])
      expect((await assembly.executeMemoryPut(f.operation)).outcome).toBe('SETTLED')
    } finally { await new Promise<void>(resolve => server.close(() => { resolve() })) }
  }, 40_000)

  it.runIf(process.platform === 'darwin')('child loss closes the broker and issuer instead of leaving authorities alive', async () => {
    const f = fixture()
    const assembly = await launchDeveloperAssembly({ ...f.options, review: () => 'approved', issuerApproval: () => 'approved' })
    assemblies.push(assembly)
    assembly.guest.kill('SIGKILL')
    await expect(assembly.failure).rejects.toThrow('supervisor:guest-exited')
    expect(await noProcess(assembly.guest.pid)).toBe(true)
    expect(await noProcess(assembly.broker.pid)).toBe(true)
    expect(await noProcess(assembly.issuer.pid)).toBe(true)
  }, 40_000)

  it.runIf(process.platform === 'darwin')('refuses before guest admission when the enforcement probe loses its actual restriction', async () => {
    const f = fixture()
    const originalSpawn = childProcess.spawn
    let guests = 0
    const removeProbeRestriction = (command: string, args: readonly string[], options: SpawnOptions) => {
      if (command === '/usr/bin/sandbox-exec' && args.includes(GUEST)) guests++
      if (command === '/usr/bin/sandbox-exec' && args.includes('-e')) {
        const nodeIndex = args.indexOf('--') + 1
        return originalSpawn(process.execPath, args.slice(nodeIndex + 1), options)
      }
      return originalSpawn(command, args, options)
    }
    vi.spyOn(childProcess, 'spawn').mockImplementation(removeProbeRestriction)
    syncBuiltinESMExports()
    await expect(launchDeveloperAssembly({ ...f.options, review: () => 'approved', issuerApproval: () => 'approved' }))
      .rejects.toThrow('confined:enforcement-unavailable')
    expect(guests).toBe(0)
    expect(counts(join(f.options.runtimeDir, 'broker-state'))).toEqual({ objects: 0, keys: 0, nonces: 0, aura: 0 })
  }, 40_000)

  it.runIf(process.platform === 'darwin')('parent IPC loss terminates its guest, broker, and issuer', async () => {
    const f = fixture()
    const source = `
      import {launchDeveloperAssembly} from './aukora/supervisor/developer-launch.mjs';
      import {loadOrCreateLocalAumlokControl} from './aukora/identity/local-control-store.mjs';
      import {createDeveloperAumlokAuthority} from './aukora/supervisor/developer-aumlok.mjs';
      const options=${JSON.stringify(f.options)};
      const control=loadOrCreateLocalAumlokControl(${JSON.stringify(join(f.root, 'authority'))});
      const authority=createDeveloperAumlokAuthority(control,{audience:'broker:confined-test'});
      const assembly=await launchDeveloperAssembly({...options,selectSubjectAuthority:authority.selectSubjectAuthority,
        review:()=> 'approved',issuerApproval:()=> 'approved',issuerStderr:()=>{}});
      process.send([assembly.guest.pid,assembly.broker.pid,assembly.issuer.pid]);`
    const parent = childProcess.spawn(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', source], {
      cwd: ROOT, env: { LANG: 'C' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    let stderr = ''
    parent.stdout?.resume()
    parent.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    try {
      const pids = await new Promise<number[]>((resolve, reject) => {
        parent.once('message', (value) => { resolve(value as number[]) })
        parent.once('error', reject)
        parent.once('exit', (code) => { reject(new Error(`parent exited ${String(code)}: ${stderr}`)) })
      })
      parent.kill('SIGKILL')
      expect(await noProcess(parent.pid)).toBe(true)
      for (const pid of pids) expect(await noProcess(pid), `orphan process ${String(pid)}`).toBe(true)
    } finally {
      if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL')
      await noProcess(parent.pid)
    }
  }, 40_000)
})
