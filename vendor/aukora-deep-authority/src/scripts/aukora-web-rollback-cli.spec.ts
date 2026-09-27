/** Preauthorized rollback CLI on disposable state; native terminal inputs are SCRIPTED, not attendance. */
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { readActivationBinding } from '../aukora/activation/broker-state.mjs'
import { verifyWebRollbackBundle, type WebActivationRollbackBundle } from '../aukora/activation/web-rollback-record.mjs'
import { spawnBroker } from '../aukora/broker/broker.mjs'
import { loadOrCreateLocalAumlokControl } from '../aukora/identity/local-control-store.mjs'
import { createDeveloperAumlokAuthority } from '../aukora/supervisor/developer-aumlok.mjs'

const roots: string[] = []
const OLD_ACTIVATION = 'ab'.repeat(32)
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rollback-cli-')))
  const data = join(root, 'data')
  const control = join(root, 'control')
  mkdirSync(data, { mode: 0o700 })
  mkdirSync(control, { mode: 0o700 })
  roots.push(root)
  const bundle = join(root, 'rollback.json')
  return { root, data, control, bundle,
    upgrade: ['--data-dir', data, '--control-dir', control, '--review-config', join(root, 'review.json'), '--port', '5173'] }
}

/** Real broker provisioning supplies the retained controller, private key, seal, and legacy binding. */
async function retainedFixture() {
  const f = fixture()
  const control = loadOrCreateLocalAumlokControl(f.control)
  const authority = createDeveloperAumlokAuthority(control, { audience: 'broker:source-launch' })
  const state = join(f.data, 'broker-state')
  const broker = await spawnBroker({
    socketPath: join(f.root, 'broker.sock'), stateDir: state, issuerSocket: join(f.root, 'issuer.sock'),
    rootPublicKeyPem: control.ed25519PublicKeyPem, rootControlState: control.activeControl,
    selectSubjectAuthority: authority.selectSubjectAuthority,
    subjectAuthorityExpectation: { ...authority.subjectAuthorityExpectation, activationDigest: OLD_ACTIVATION },
    activationDigest: OLD_ACTIVATION, rendererId: 'cd'.repeat(32),
    kiraRecallPolicy: { subject: control.subject, privacy: ['private'] },
    review: () => 'denied',
  })
  const exited = once(broker, 'exit')
  const deadline = setTimeout(() => { broker.kill('SIGKILL') }, 5_000)
  broker.kill('SIGTERM')
  try { await exited } finally { clearTimeout(deadline) }
  expect(existsSync(join(state, '.broker-active.lock'))).toBe(false)
  writeFileSync(join(f.data, 'activation-epoch'), '1\n', { mode: 0o600 })
  writeFileSync(join(f.root, 'review.json'), JSON.stringify({
    domain: 'aukora:web-review-config:v1', socketPath: join(f.root, 'review.sock'), subject: control.subject,
    terminalPublicKeyPem: control.ed25519PublicKeyPem,
  }), { mode: 0o600 })
  return { ...f, state, controller: control,
    upgrade: [...f.upgrade, '--expected-previous-activation', OLD_ACTIVATION, '--rollback-bundle', f.bundle] }
}

/** Independent file bytes and identity; new rollback audit evidence is compared separately. */
function witness(root: string, excluded = new Set<string>(), relative = ''): unknown[] {
  const path = join(root, relative)
  const stat = lstatSync(path)
  const row = { relative, inode: stat.ino, mode: stat.mode }
  if (!stat.isDirectory()) return [{ ...row, bytes: readFileSync(path).toString('base64') }]
  return [row, ...readdirSync(path).sort().flatMap((name) => {
    const child = join(relative, name)
    return excluded.has(child) ? [] : witness(root, excluded, child)
  })]
}

function runScriptedTerminal(args: string[], mode: 'accept' | 'decline') {
  const manifest = new URL('../packages/subprocess/subprocess-local/package.json', import.meta.url).href
  const cli = fileURLToPath(new URL('./aukora-web-upgrade.mjs', import.meta.url))
  const source = `
    import { createRequire } from 'node:module';
    const pty = createRequire(${JSON.stringify(manifest)})('node-pty');
    const terminal = pty.spawn(${JSON.stringify(process.execPath)}, ${JSON.stringify([cli, ...args])});
    let text = '', answered = false, timedOut = false;
    const deadline = setTimeout(() => { timedOut = true; terminal.kill('SIGKILL'); }, 20000);
    terminal.onData(data => {
      text += data;
      const match = text.match(/Type "(upgrade [a-f0-9]{16})" to authorize both exact operations/);
      if (match && !answered) {
        answered = true;
        terminal.write(${JSON.stringify(mode)} === 'accept' ? match[1] + '\\r' : 'no\\r');
      }
    });
    terminal.onExit(({ exitCode, signal }) => {
      clearTimeout(deadline);
      process.stdout.write(JSON.stringify({ text, answered, timedOut, exitCode, signal }));
    });
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    encoding: 'utf8', timeout: 25_000, maxBuffer: 4 * 1024 * 1024,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(KEY|SECRET|TOKEN|PASSWORD)/iu.test(key) && key !== 'NODE_OPTIONS')),
  })
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout) as { text: string; answered: boolean; timedOut: boolean; exitCode: number }
}

function run(name: 'upgrade' | 'rollback', args: string[]) {
  return new Promise<{
    code: number | null
    signal: NodeJS.Signals | null
    stdout: string
    stderr: string
    timedOut: boolean
  }>((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL(`./aukora-web-${name}.mjs`, import.meta.url)), ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(KEY|SECRET|TOKEN|PASSWORD)/iu.test(key) && key !== 'NODE_OPTIONS')),
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    child.stdout.on('data', (bytes: Buffer) => { stdout += bytes.toString('utf8') })
    child.stderr.on('data', (bytes: Buffer) => { stderr += bytes.toString('utf8') })
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 10_000)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, timedOut }) })
  })
}

describe.skipIf(process.platform === 'win32')('upgrade and preauthorized rollback CLI', () => {
  it.skipIf(process.platform !== 'darwin').each(['accept', 'decline'] as const)(
    'runs the real CLI with SCRIPTED %s input and retains recovery evidence', async (mode) => {
      const f = await retainedFixture()
      const bindingPath = join(f.state, 'activation.json')
      const previousBinding = readFileSync(bindingPath, 'utf8')
      const retained = witness(f.state, new Set(['activation.json']))
      const unchanged = witness(f.state)
      const control = witness(f.control)
      const observed = runScriptedTerminal(f.upgrade, mode)
      expect(observed.answered, observed.text).toBe(true)
      expect(observed.timedOut, observed.text).toBe(false)
      expect(observed.exitCode, observed.text).toBe(mode === 'accept' ? 0 : 1)
      expect(observed.text).toContain('PREAUTHORIZED ROLLBACK')
      expect(witness(f.control)).toEqual(control)
      expect(existsSync(join(f.state, '.broker-active.lock'))).toBe(false)
      if (mode === 'decline') {
        expect(observed.text).toContain('upgrade:operator-declined')
        expect(existsSync(f.bundle)).toBe(false)
        expect(witness(f.state)).toEqual(unchanged)
        return
      }
      expect(observed.text).toContain('ACTIVATION_UPGRADED')
      expect(lstatSync(f.bundle).mode & 0o7777).toBe(0o600)
      expect(lstatSync(f.bundle).nlink).toBe(1)
      const bundleBytes = readFileSync(f.bundle)
      const bundle = JSON.parse(bundleBytes.toString('utf8')) as WebActivationRollbackBundle
      expect(verifyWebRollbackBundle(bundle, f.controller.activeControl)).toEqual(bundle)
      expect(bundle.previousBinding).toBe(previousBinding)
      expect(bundle.rollback.operation.expiresAt - bundle.upgrade.operation.issuedAt).toBe(900)
      expect(JSON.parse(readFileSync(bindingPath, 'utf8'))).toEqual(bundle.upgrade)
      expect(witness(f.state, new Set(['activation.json']))).toEqual(retained)
      const result = await run('rollback', ['--data-dir', f.data, '--bundle', f.bundle])
      expect(result, result.stderr).toMatchObject({ code: 0, signal: null, timedOut: false })
      expect(JSON.parse(result.stdout)).toMatchObject({ status: 'ACTIVATION_ROLLED_BACK', activationDigest: OLD_ACTIVATION })
      expect(readFileSync(bindingPath, 'utf8')).toBe(previousBinding)
      expect(readActivationBinding(f.state)).toBe(OLD_ACTIVATION)
      expect(readFileSync(f.bundle)).toEqual(bundleBytes)
      const auditName = `.activation-rollback-${bundle.upgrade.operation.nonce}.json`
      expect(JSON.parse(readFileSync(join(f.state, auditName), 'utf8'))).toEqual(bundle)
      expect(witness(f.state, new Set(['activation.json', auditName]))).toEqual(retained)
      expect(witness(f.control)).toEqual(control)
      expect(existsSync(join(f.state, '.broker-active.lock'))).toBe(false)
    }, 40_000,
  )

  it('requires actual terminal attendance even with a valid unused rollback destination', async () => {
    const f = fixture()
    const result = await run('upgrade', [...f.upgrade, '--rollback-bundle', f.bundle])
    expect(result).toMatchObject({ code: 1, signal: null, stdout: '', timedOut: false })
    expect(result.stderr).toContain('upgrade:attended-terminal-required')
    expect(existsSync(f.bundle)).toBe(false)
    expect(existsSync(join(f.data, 'broker-state'))).toBe(false)
  })

  it('refuses an existing bundle and preserves its exact bytes and inode', async () => {
    const f = fixture()
    writeFileSync(f.bundle, 'owner-retained bytes', { flag: 'wx', mode: 0o600 })
    const before = lstatSync(f.bundle)
    const result = await run('upgrade', [...f.upgrade, '--rollback-bundle', f.bundle])
    expect(result).toMatchObject({ code: 1, stdout: '', timedOut: false })
    expect(result.stderr).toContain('upgrade:rollback-bundle-exists')
    expect(readFileSync(f.bundle, 'utf8')).toBe('owner-retained bytes')
    expect(lstatSync(f.bundle).ino).toBe(before.ino)
  })

  it('refuses protected roots, relative paths, duplicate options, and nonprivate parents', async () => {
    const f = fixture()
    for (const path of [join(f.data, 'bundle.json'), join(f.control, 'bundle.json')]) {
      const result = await run('upgrade', [...f.upgrade, '--rollback-bundle', path])
      expect(result.stderr).toContain('upgrade:rollback-bundle-location-invalid')
      expect(existsSync(path)).toBe(false)
    }
    expect((await run('upgrade', [...f.upgrade, '--rollback-bundle', 'relative.json'])).stderr)
      .toContain('upgrade:rollback-bundle-path-invalid')
    expect((await run('upgrade', [...f.upgrade, '--rollback-bundle', f.bundle, '--rollback-bundle', f.bundle])).stderr)
      .toContain('upgrade:rollback-bundle-duplicate')
    const open = join(f.root, 'open')
    mkdirSync(open, { mode: 0o755 })
    chmodSync(open, 0o755)
    expect((await run('upgrade', [...f.upgrade, '--rollback-bundle', join(open, 'bundle.json')])).stderr)
      .toContain('upgrade:rollback-bundle-parent-not-private')
  })

  it('refuses malformed, oversize, public, linked and directory bundle inputs without touching broker state', async () => {
    const f = fixture()
    for (const [name, contents, mode, refusal] of [
      ['malformed.json', '{invalid', 0o600, 'JSON'],
      ['oversize.json', ' '.repeat(1024 * 1024 + 1), 0o600, 'rollback:bundle-not-private-regular'],
      ['public.json', '{}', 0o644, 'rollback:bundle-not-private-regular'],
    ] as const) {
      const path = join(f.root, name)
      writeFileSync(path, contents, { mode })
      chmodSync(path, mode)
      const before = lstatSync(path)
      const result = await run('rollback', ['--data-dir', f.data, '--bundle', path])
      expect(result).toMatchObject({ code: 1, stdout: '', timedOut: false })
      expect(result.stderr).toContain(refusal)
      expect(readFileSync(path, 'utf8')).toBe(contents)
      expect(lstatSync(path).ino).toBe(before.ino)
      expect(existsSync(join(f.data, 'broker-state'))).toBe(false)
    }
    const link = join(f.root, 'linked.json')
    symlinkSync(join(f.root, 'public.json'), link)
    expect((await run('rollback', ['--data-dir', f.data, '--bundle', link])).stderr).toContain('rollback:bundle-path-invalid')
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect((await run('rollback', ['--data-dir', f.data, '--bundle', f.control])).stderr)
      .toContain('rollback:bundle-not-private-regular')
  })
})
