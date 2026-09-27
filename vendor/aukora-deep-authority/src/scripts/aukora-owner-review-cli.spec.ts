/** Browser CLI lifecycle with disposable credentials; no browser or approval is exercised. */
import { spawn } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { connectWebReviewRenderer, createWebReview, readWebReviewConfig } from '../aukora/supervisor/developer-review.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const entry = fileURLToPath(new URL('./aukora-web-review.mjs', import.meta.url))
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function fixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'orc-')))
  chmodSync(directory, 0o700)
  cleanups.push(() => {
    rmSync(directory, { recursive: true, force: true })
    return Promise.resolve()
  })
  const keys = generateKeyPairSync('ed25519')
  const configPath = join(directory, 'review.json')
  const privateKeyPath = join(directory, 'owner.pem')
  const pairingPath = join(directory, 'pairing.url')
  const subject = `aukora:1:${'ab'.repeat(32)}`
  writeFileSync(configPath, JSON.stringify({ domain: 'aukora:web-review-config:v1', subject,
    socketPath: join(directory, 'review.sock'),
    terminalPublicKeyPem: keys.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  }), { mode: 0o600, flag: 'wx' })
  writeFileSync(privateKeyPath, keys.privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600, flag: 'wx' })
  const config = readWebReviewConfig(configPath)
  const transport = await createWebReview(config, subject)
  cleanups.push(() => transport.close())
  return { config, privateKeyPath, pairingPath,
    args: ['--config', configPath, '--private-key', privateKeyPath] }
}

interface CliExit {
  code: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  stdout: string
  stderr: string
}

function launch(args: readonly string[]) {
  const child = spawn(process.execPath, [entry, ...args], { cwd: root,
    env: Object.fromEntries(Object.entries(process.env)
      .filter(([name]) => !/(?:KEY|SECRET|TOKEN|PASSWORD)/iu.test(name) && name !== 'NODE_OPTIONS')),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  let timedOut = false
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
  const deadline = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 8000)
  const exited = new Promise<CliExit>((resolve, reject) => {
    child.once('error', (error) => { clearTimeout(deadline); reject(error) })
    child.once('close', (code, signal) => {
      clearTimeout(deadline)
      resolve({ code, signal, timedOut, stdout, stderr })
    })
  })
  cleanups.push(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited
  })
  return { child, exited, output: () => ({ stdout, stderr }) }
}

async function assertTransportAvailable(f: Awaited<ReturnType<typeof fixture>>) {
  expect(lstatSync(f.config.socketPath).isSocket()).toBe(true)
  const client = await connectWebReviewRenderer(f.config, f.privateKeyPath, {
    review: () => { throw new Error('CLI fixture does not request approvals') },
  })
  await client.close()
}

// Private Unix sockets, POSIX ownership, and graceful SIGTERM are required by this CLI.
describe.skipIf(process.platform === 'win32')('owner browser CLI without opening a browser', () => {
  it('writes only a private pairing file and closes its HTTP listener without stopping the review transport', async () => {
    const f = await fixture()
    const running = launch([...f.args, '--browser', '--no-open', '--pairing-file', f.pairingPath])
    await expect.poll(() => running.output().stderr, { timeout: 5000 }).toContain('Owner approval API:')
    const file = lstatSync(f.pairingPath)
    expect(file.isFile()).toBe(true)
    expect(file.mode & 0o777).toBe(0o600)
    expect(file.uid).toBe(process.geteuid?.())
    const bytes = readFileSync(f.pairingPath, 'utf8')
    expect(bytes.endsWith('\n')).toBe(true)
    const ownerUrl = new URL(bytes.trim())
    expect(ownerUrl.protocol).toBe('http:')
    expect(ownerUrl.hostname).toBe('127.0.0.1')
    expect(ownerUrl.origin).toBe('http://127.0.0.1:5173')
    const fields = new URLSearchParams(ownerUrl.hash.slice(1))
    const apiOrigin = fields.get('owner-review')
    expect(apiOrigin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u)
    if (apiOrigin === null) throw new Error('CLI pairing fixture has no API origin')
    const token = fields.get('pair')
    expect(token).toMatch(/^[0-9a-f]{64}$/u)
    if (token === null) throw new Error('CLI pairing fixture has no token')
    const page = await fetch(`${apiOrigin}/api/state`, { signal: AbortSignal.timeout(2000) })
    expect(page.status).toBe(401)
    expect(page.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(await page.json()).toEqual({ error: 'owner-session-required' })

    running.child.kill('SIGTERM')
    const result = await running.exited
    expect(result).toMatchObject({ code: 0, signal: null, timedOut: false, stdout: '' })
    expect(result.stderr).toBe(`Owner approval API: ${apiOrigin}. Approvals appear in the AUKORA chat.\n`)
    expect(result.stdout + result.stderr).not.toContain(token)
    expect(result.stdout + result.stderr).not.toContain(ownerUrl.href)
    await expect(fetch(apiOrigin, { signal: AbortSignal.timeout(2000) })).rejects.toThrow()
    expect(readFileSync(f.pairingPath, 'utf8')).toBe(bytes)
    await assertTransportAvailable(f)
  }, 10_000)

  it.each([
    ['browser-only flags without browser mode', ['--no-open']],
    ['no-open without a pairing file', ['--browser', '--no-open']],
    ['an out-of-range port', ['--browser', '--no-open', '--port', '65536']],
    ['an unknown option', ['--unknown-owner-option']],
  ] as const)('rejects %s before creating a pairing file', async (_name, args) => {
    const f = await fixture()
    const result = await launch([...f.args, ...args]).exited
    expect(result).toMatchObject({ code: 1, signal: null, timedOut: false, stdout: '' })
    expect(result.stderr).toMatch(/usage: node scripts\/aukora-web-review\.mjs|Unknown option/u)
    expect(result.stderr).not.toContain('Owner approval window:')
    expect(existsSync(f.pairingPath)).toBe(false)
    await assertTransportAvailable(f)
  }, 10_000)

  it('refuses an existing pairing file without changing its bytes or identity', async () => {
    const f = await fixture()
    const contents = 'Owner-created fixture; preserve these bytes.\n'
    writeFileSync(f.pairingPath, contents, { flag: 'wx', mode: 0o600 })
    const before = lstatSync(f.pairingPath)
    const result = await launch([...f.args, '--browser', '--no-open', '--pairing-file', f.pairingPath]).exited
    expect(result).toMatchObject({ code: 1, signal: null, timedOut: false, stdout: '' })
    expect(result.stderr).toContain('EEXIST')
    expect(result.stderr).not.toContain('Owner approval window:')
    expect(readFileSync(f.pairingPath, 'utf8')).toBe(contents)
    const after = lstatSync(f.pairingPath)
    expect({ ino: after.ino, dev: after.dev, mode: after.mode })
      .toEqual({ ino: before.ino, dev: before.dev, mode: before.mode })
    await assertTransportAvailable(f)
  }, 10_000)
})
