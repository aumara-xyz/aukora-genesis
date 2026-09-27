/** Owner configuration validation and reconnectable assembly callback refusals. */
import { generateKeyPairSync } from 'node:crypto'
import { spawn } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { readWebReviewConfig, createWebReview, connectWebReview } from '../aukora/supervisor/developer-review.mjs'
import { approvalArtifactDigest, createApprovalArtifact } from '../aukora/approval/artifact.mjs'
import { BROKER_REFUSE, BROKER_REVIEW_REQUEST } from '../aukora/broker/broker.mjs'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wr-')))
  roots.push(root)
  chmodSync(root, 0o700)
  const key = generateKeyPairSync('ed25519')
  const file = join(root, 'review.json')
  const subject = `aukora:1:${'ab'.repeat(32)}`
  const value = { domain: 'aukora:web-review-config:v1', socketPath: join(root, 'review.sock'), subject,
    terminalPublicKeyPem: key.publicKey.export({ format: 'pem', type: 'spki' }).toString() }
  writeFileSync(file, JSON.stringify(value), { mode: 0o600 })
  return { root, key, file, value, subject }
}

// This owner channel requires POSIX ownership/modes and Unix-domain socket publication.
describe.skipIf(process.platform === 'win32')('reconnectable Web owner review', () => {
  it('derives a stable route identity from every public configuration field, independent of JSON ordering', () => {
    const f = fixture()
    const original = readWebReviewConfig(f.file)
    writeFileSync(f.file, JSON.stringify(Object.fromEntries(Object.entries(f.value).reverse())))
    expect(readWebReviewConfig(f.file)).toEqual(original)
    writeFileSync(f.file, JSON.stringify({ ...f.value, subject: `aukora:1:${'bc'.repeat(32)}` }))
    expect(readWebReviewConfig(f.file).serverId).not.toBe(original.serverId)
    expect(original.role).toBe('web-owner')
    expect(Object.isFrozen(original)).toBe(true)
  })

  it.each([
    { subject: 'unverified' }, { socketPath: 'relative.sock' }, { domain: 'different' },
    { terminalPublicKeyPem: 'not a key' }, { extra: 'not admitted' },
  ])('refuses malformed or surplus configuration fields %j', (change) => {
    const f = fixture()
    writeFileSync(f.file, JSON.stringify({ ...f.value, ...change }))
    expect(() => readWebReviewConfig(f.file)).toThrow(/aukora:web-review:/)
  })

  it('refuses non-private files and linked review paths', () => {
    const f = fixture()
    chmodSync(f.file, 0o644)
    expect(() => readWebReviewConfig(f.file)).toThrow('file-not-private')
    chmodSync(f.file, 0o600)
    const alias = join(f.root, 'alias.json')
    symlinkSync(f.file, alias)
    expect(() => readWebReviewConfig(alias)).toThrow('file-not-private')
    const actual = join(f.root, 'actual')
    mkdirSync(actual, { mode: 0o700 })
    const linked = join(f.root, 'linked')
    symlinkSync(actual, linked)
    writeFileSync(f.file, JSON.stringify({ ...f.value, socketPath: join(linked, 'review.sock') }))
    expect(() => readWebReviewConfig(f.file)).toThrow('directory-not-private')
  })

  it('never publishes a route for a different controller subject', async () => {
    const f = fixture()
    const before = readFileSync(f.file)
    await expect(createWebReview(readWebReviewConfig(f.file), 'wrong-subject')).rejects.toThrow('subject-mismatch')
    expect(readFileSync(f.file)).toEqual(before)
  })

  it('rejects a mismatched terminal key before connecting', async () => {
    const f = fixture()
    const privateFile = join(f.root, 'terminal.pem')
    writeFileSync(privateFile, generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
    await expect(connectWebReview(readWebReviewConfig(f.file), privateFile)).rejects.toThrow('terminal-key-mismatch')
  })

  it('treats absent issuer owner as unavailable, not a decision or fatal assembly error', async () => {
    const f = fixture()
    const review = await createWebReview(readWebReviewConfig(f.file), f.subject)
    try {
      const result = await review.issuerApproval({ challenge: 'ab'.repeat(8), prompt: 'unbound prompt' }, new AbortController().signal)
      expect(result).toBe('unavailable')
    } finally { await review.close() }
  })

  async function idleTerminalDisconnect(stop: 'ctrl-c' | 'eof', realPty: boolean) {
    const f = fixture()
    const config = readWebReviewConfig(f.file)
    const privateFile = join(f.root, 'terminal.pem')
    writeFileSync(privateFile, f.key.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
    const review = await createWebReview(config, f.subject)
    const moduleUrl = new URL('../aukora/supervisor/developer-review.mjs', import.meta.url).href
    // TTY-mode readline consumes keyboard Ctrl-C itself. Its simulated OS pipe is released only
    // after the review connection closes; unlike a real TTY, the open pipe otherwise retains a handle.
    const source = `
      import { connectWebReview, readWebReviewConfig } from ${JSON.stringify(moduleUrl)};
      ${realPty ? '' : "Object.defineProperty(process.stdin, 'isTTY', { value: true }); process.stdin.setRawMode = () => {};"}
      const connection = await connectWebReview(readWebReviewConfig(${JSON.stringify(f.file)}), ${JSON.stringify(privateFile)});
      process.stdout.write('ready\\n');
      await connection.closed;
      process.stdout.write('closed\\n');
      ${realPty ? '' : 'process.stdin.destroy();'}
    `
    const args = ['--input-type=module', '-e', source]
    const ptyManifest = new URL('../packages/subprocess/subprocess-local/package.json', import.meta.url).href
    const ptyRunner = `
      import { createRequire } from 'node:module';
      const pty = createRequire(${JSON.stringify(ptyManifest)})('node-pty');
      const terminal = pty.spawn(${JSON.stringify(process.execPath)}, ${JSON.stringify(args)});
      const deadline = setTimeout(() => terminal.kill('SIGKILL'), 2500);
      terminal.onData(data => process.stdout.write(data));
      process.stdin.on('data', data => terminal.write(data.toString('utf8')));
      terminal.onExit(({ exitCode, signal }) => {
        clearTimeout(deadline);
        process.stdin.destroy();
        process.exitCode = signal ? 1 : exitCode;
      });
    `
    const child = spawn(process.execPath, realPty ? ['--input-type=module', '-e', ptyRunner] : args, {
      cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const ready = Promise.withResolvers<true>()
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = `${stdout}${chunk.toString('utf8')}`.replaceAll('\r\n', '\n')
      if (stdout.includes('ready\n')) ready.resolve(true)
    })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.once('error', ready.reject)
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
      child.once('exit', (code, signal) => {
        if (!stdout.includes('ready\n')) ready.reject(new Error(`terminal exited before connecting: ${stderr}`))
        resolveExit({ code, signal })
      })
    })
    const deadline = setTimeout(() => child.kill('SIGKILL'), 3_000)
    try {
      await ready.promise
      if (stop === 'ctrl-c') child.stdin.write('\u0003')
      else if (realPty) child.stdin.write('\u0004')
      else child.stdin.end()
      expect(await exited, JSON.stringify({ stdout, stderr })).toEqual({ code: 0, signal: null })
      expect(stdout).toBe('ready\nclosed\n')
      const artifact = createApprovalArtifact({ operationArguments: { key: 'idle_disconnect', value: true },
        expiry: Math.floor(Date.now() / 1000) + 120, activationDigest: 'b'.repeat(64), occurrenceId: 'c'.repeat(32), rendererId: 'd'.repeat(64) })
      await expect(review.review({ type: BROKER_REVIEW_REQUEST, reviewId: 'e'.repeat(32), proposalId: 'f'.repeat(32),
        artifact: { ...artifact }, artifactDigest: approvalArtifactDigest(artifact), operationDigest: artifact.operationDigest,
        authorizationDigest: '1'.repeat(64), expiresAt: artifact.expiry }, new AbortController().signal))
        .rejects.toThrow(BROKER_REFUSE.REVIEW_CHANNEL_UNAVAILABLE)
    } finally {
      clearTimeout(deadline)
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await exited
      await review.close()
    }
  }

  it.each(['ctrl-c', 'eof'] as const)('disconnects an idle simulated terminal after %s without stopping the review server', async (stop) => {
    await idleTerminalDisconnect(stop, false)
  })

  it.skipIf(process.platform !== 'darwin').each(['ctrl-c', 'eof'] as const)('disconnects an idle native macOS PTY after %s without stopping the review server', async (stop) => {
    await idleTerminalDisconnect(stop, true)
  })
})
