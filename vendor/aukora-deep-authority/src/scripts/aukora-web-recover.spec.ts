import { generateKeyPairSync } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { once } from 'node:events'
import fs, { chmodSync, existsSync, linkSync, lstatSync, mkdtempSync, readFileSync, readdirSync,
  realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawnBroker } from '../aukora/broker/broker.mjs'
import { memoryPut } from '../aukora/broker/effect.mjs'
import { readBrokerKiraRecall } from '../aukora/broker/kira-recall.mjs'
import { appendEntry } from '../aukora/aura/record.mjs'
import { stageKiraMemoryRecord } from '../aukora/kira/stage.mjs'
import { inspectWebRecovery, recoverWebStore } from './aukora-web-recover.mjs'

const cleanups: Array<() => Promise<void>> = []
const SUBJECT = 'aumlok:subject:recovery-fixture'
const BIN = fileURLToPath(new URL('./aukora-web-recover-bin.mjs', import.meta.url))
afterEach(async () => {
  vi.restoreAllMocks()
  syncBuiltinESMExports()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** Independent byte/mode witness; no recovery implementation helpers. */
function witness(root: string, prefix = ''): unknown[] {
  return readdirSync(join(root, prefix)).sort().flatMap((name): unknown[] => {
    const path = join(prefix, name)
    const stat = lstatSync(join(root, path))
    return stat.isDirectory() ? witness(root, path) : [{ path, mode: stat.mode,
      bytes: readFileSync(join(root, path)).toString('base64') }]
  })
}

function request(socketPath: string, value: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const connection = createConnection(socketPath)
    let text = ''
    const timer = setTimeout(() => connection.destroy(new Error('fixture socket deadline')), 3000)
    connection.once('error', reject)
    connection.once('close', () => { clearTimeout(timer); reject(new Error('fixture socket closed')) })
    connection.once('connect', () => connection.write(`${JSON.stringify(value)}\n`))
    connection.on('data', (bytes: Buffer) => {
      text += bytes.toString()
      if (!text.includes('\n')) return
      try { resolve(JSON.parse(text.split('\n')[0]!) as unknown) }
      catch (error) { reject(error instanceof Error ? error : new Error(String(error))) }
      connection.destroy()
    })
  })
}

/** Real broker crash/lease; retained input is SCRIPTED, not a human-approved memory write. */
async function fixture() {
  const dataDir = realpathSync(mkdtempSync(join(tmpdir(), 'wr-')))
  const stateDir = join(dataDir, 'broker-state')
  const socketPath = join(dataDir, 'broker.sock')
  const { publicKey } = generateKeyPairSync('ed25519')
  const options = { socketPath, stateDir, activationDigest: 'ab'.repeat(32), rendererId: 'cd'.repeat(32),
    rootPublicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    kiraRecallPolicy: { subject: SUBJECT, privacy: ['private'] } }
  let child: Awaited<ReturnType<typeof spawnBroker>> | undefined
  const stop = async (signal: 'SIGKILL' | 'SIGTERM') => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit')
      child.kill(signal)
      await stopped
    }
    child = undefined
  }
  cleanups.push(async () => { await stop('SIGKILL'); rmSync(dataDir, { recursive: true, force: true }) })
  child = await spawnBroker(options)
  const pid = child.pid!
  await stop('SIGKILL')
  expect(existsSync(join(stateDir, '.broker-active.lock'))).toBe(true)
  expect(() => process.kill(pid, 0)).toThrow()
  unlinkSync(socketPath)
  const staged = stageKiraMemoryRecord({ subject: SUBJECT, kind: 'observation', source: [], links: [],
    privacy: 'private', createdAt: '2026-09-09T00:00:00Z', content: { text: 'retained recovery control' } })
  const effect = memoryPut(stateDir, staged.memoryPut)
  const entry = appendEntry({ file: join(stateDir, 'aura.jsonl'), fields: {
    verdict: 'settled', sequence: 1, key: staged.recordId, contentSha256: effect.contentSha256,
  } })
  writeFileSync(join(stateDir, 'seq'), '1', { mode: 0o600 })
  const sealPath = join(stateDir, 'confinement.seal')
  const original = JSON.parse(readFileSync(sealPath, 'utf8')) as { stateDev: number }
  chmodSync(sealPath, 0o600)
  writeFileSync(sealPath, `${JSON.stringify({ ...original, stateDev: original.stateDev + 1 })}\n`)
  chmodSync(sealPath, 0o400)
  const inspect = () => inspectWebRecovery({ dataDir, expectedHead: entry.hash })
  const recall = () => readBrokerKiraRecall(stateDir, { subject: SUBJECT, permittedPrivacy: ['private'] })
  const restart = async () => { child = await spawnBroker(options) }
  return { dataDir, stateDir, socketPath, sealPath, pid, inspect, recall, restart, stop, head: entry.hash }
}

describe.skipIf(process.platform === 'win32' || process.geteuid?.() === 0)('offline developer KIRA recovery', () => {
  it('backs up a crashed populated store, preserves keys and activation, and permits real broker restart and identical recall', async () => {
    const f = await fixture()
    const before = witness(f.stateDir)
    const recall = f.recall()
    expect(recall).toMatchObject({ result: { status: 'found' } })
    await expect(f.restart()).rejects.toThrow('broker:seal-foreign-directory')
    const plan = f.inspect()
    expect(witness(f.stateDir)).toEqual(before)
    const result = recoverWebStore(plan)
    expect(result).toMatchObject({ status: 'WEB_STORE_RECOVERED', leaseArchived: true,
      activationUnchanged: true, brokerStarted: false, liveRecall: false,
      historicalVolumeIdentity: 'unverified', issuerSignaturesVerified: false })
    expect(witness(join(result.backupDir, 'state'))).toEqual(before)
    expect(lstatSync(result.backupDir).mode & 0o777).toBe(0o700)
    expect(readFileSync(join(result.backupDir, 'stale-writer.lock')))
      .toEqual(readFileSync(join(result.backupDir, 'state', '.broker-active.lock')))
    expect(witness(f.stateDir).filter(row => !['.broker-active.lock', 'confinement.seal'].includes((row as { path: string }).path)))
      .toEqual(before.filter(row => !['.broker-active.lock', 'confinement.seal'].includes((row as { path: string }).path)))
    expect(existsSync(join(f.stateDir, '.broker-active.lock'))).toBe(false)
    expect(() => recoverWebStore(plan)).toThrow()
    await f.restart()
    expect(f.recall()).toEqual(recall)
    expect(await request(f.socketPath, { op: 'kira.recall' })).toMatchObject({ ok: true, ...recall })
    await f.stop('SIGTERM')
  }, 20_000)

  it('refuses a live PID and an unobservable PID, then accepts the real dead PID', async () => {
    const f = await fixture()
    const lease = join(f.stateDir, '.broker-active.lock')
    const old = readFileSync(lease)
    writeFileSync(lease, `${JSON.stringify({ pid: process.pid, startedAt: Date.now() })}\n`)
    expect(() => f.inspect()).toThrow('web-recovery:writer-alive')
    writeFileSync(lease, old)
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EPERM' }) })
    expect(() => f.inspect()).toThrow('web-recovery:writer-state-undetermined')
    vi.restoreAllMocks()
    expect(f.inspect().lease.pid).toBe(f.pid)
  })

  it.each(['activation.json', 'seq', '.broker-active.lock', 'keys/broker.json'])('refuses changed %s after inspection without repairing the seal', async (path) => {
    const f = await fixture()
    const plan = f.inspect()
    const originalSeal = readFileSync(f.sealPath)
    const destination = join(f.stateDir, path)
    writeFileSync(destination, Buffer.concat([readFileSync(destination), Buffer.from(' ')]))
    expect(() => recoverWebStore(plan)).toThrow()
    expect(readFileSync(f.sealPath)).toEqual(originalSeal)
    expect(existsSync(join(f.stateDir, '.broker-active.lock'))).toBe(true)
    expect(existsSync(join(f.dataDir, 'recovery'))).toBe(false)
  })

  it('refuses a copied seal naming a different inode and a wrong expected head', async () => {
    const f = await fixture()
    expect(() => inspectWebRecovery({ dataDir: f.dataDir, expectedHead: '00'.repeat(32) })).toThrow('history-head-mismatch')
    const original = readFileSync(f.sealPath)
    const seal = JSON.parse(original.toString()) as { stateIno: number }
    chmodSync(f.sealPath, 0o600)
    writeFileSync(f.sealPath, JSON.stringify({ ...seal, stateIno: seal.stateIno + 1 }))
    chmodSync(f.sealPath, 0o400)
    expect(() => f.inspect()).toThrow('seal-recovery:seal-mismatch')
    chmodSync(f.sealPath, 0o600)
    writeFileSync(f.sealPath, original)
    chmodSync(f.sealPath, 0o400)
    expect(f.inspect().retained.head).toBe(f.head)
  })

  it.each([
    { kind: 'malformed JSON', payload: '{"stateDev":' },
    { kind: 'null', payload: 'null\n' },
    { kind: 'array', payload: '[1]\n' },
    { kind: 'primitive', payload: '42\n' },
  ])('refuses a malformed seal ($kind) without writes, then accepts the restored seal', async ({ payload }) => {
    const f = await fixture()
    const original = readFileSync(f.sealPath)
    chmodSync(f.sealPath, 0o600)
    writeFileSync(f.sealPath, payload)
    chmodSync(f.sealPath, 0o400)
    const before = witness(f.stateDir)
    expect(() => f.inspect()).toThrow('web-recovery:seal-malformed')
    expect(witness(f.stateDir)).toEqual(before)
    expect(existsSync(join(f.dataDir, 'recovery'))).toBe(false)
    chmodSync(f.sealPath, 0o600)
    writeFileSync(f.sealPath, original)
    chmodSync(f.sealPath, 0o400)
    expect(f.inspect().retained.head).toBe(f.head)
  })

  it('refuses an oversized seal as store-too-large rather than seal-malformed', async () => {
    const f = await fixture()
    const original = readFileSync(f.sealPath)
    chmodSync(f.sealPath, 0o600)
    writeFileSync(f.sealPath, 'x'.repeat(4097))
    chmodSync(f.sealPath, 0o400)
    const before = witness(f.stateDir)
    expect(() => f.inspect()).toThrow('web-recovery:store-too-large')
    expect(witness(f.stateDir)).toEqual(before)
    chmodSync(f.sealPath, 0o600)
    writeFileSync(f.sealPath, original)
    chmodSync(f.sealPath, 0o400)
    expect(f.inspect().retained.head).toBe(f.head)
  })

  it('refuses corrupted retained object bytes rather than treating a matching chain head as sufficient', async () => {
    const f = await fixture()
    const directory = join(f.stateDir, 'memory', 'objects')
    const path = join(directory, readdirSync(directory)[0]!)
    const original = readFileSync(path)
    const seal = readFileSync(f.sealPath)
    const mode = lstatSync(path).mode & 0o777
    chmodSync(path, 0o600)
    writeFileSync(path, 'corrupted object')
    chmodSync(path, mode)
    expect(() => f.inspect()).toThrow('objects-unverified')
    expect(readFileSync(f.sealPath)).toEqual(seal)
    chmodSync(path, 0o600)
    writeFileSync(path, original)
    chmodSync(path, mode)
    expect(f.inspect().retained.head).toBe(f.head)
  })

  it.each(['symlink', 'hardlink', 'public', 'residue'])('refuses %s entries with an intact-store control', async (attack) => {
    const f = await fixture()
    const target = join(f.stateDir, attack === 'residue' ? 'aura.jsonl.lock' : 'attack')
    if (attack === 'symlink') symlinkSync(join(f.stateDir, 'seq'), target)
    else if (attack === 'hardlink') linkSync(join(f.stateDir, 'seq'), target)
    else writeFileSync(target, 'probe', { mode: attack === 'public' ? 0o644 : 0o600 })
    expect(() => f.inspect()).toThrow()
    unlinkSync(target)
    expect(f.inspect().retained.head).toBe(f.head)
  })

  it('does not archive the lease or publish the seal after a backup durability failure', async () => {
    const f = await fixture()
    const plan = f.inspect()
    const before = witness(f.stateDir)
    vi.spyOn(fs, 'fsyncSync').mockImplementationOnce(() => { throw new Error('fixture-backup-fsync') })
    syncBuiltinESMExports()
    expect(() => recoverWebStore(plan)).toThrow('fixture-backup-fsync')
    expect(witness(f.stateDir)).toEqual(before)
    vi.restoreAllMocks()
    syncBuiltinESMExports()
    expect(recoverWebStore(f.inspect()).status).toBe('WEB_STORE_RECOVERED')
  })

  it('preserves a competing writer lease acquired after archival, without repairing the seal', async () => {
    const f = await fixture()
    const plan = f.inspect()
    const oldSeal = readFileSync(f.sealPath)
    const rename = fs.renameSync
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      rename(from, to)
      if (String(to).endsWith('stale-writer.lock')) {
        writeFileSync(join(f.stateDir, '.broker-active.lock'), JSON.stringify({ pid: process.pid, startedAt: Date.now() }), { mode: 0o600 })
      }
    })
    syncBuiltinESMExports()
    expect(() => recoverWebStore(plan)).toThrow('broker:state-active')
    expect(readFileSync(f.sealPath)).toEqual(oldSeal)
    expect(JSON.parse(readFileSync(join(f.stateDir, '.broker-active.lock'), 'utf8')) as unknown).toMatchObject({ pid: process.pid })
  })

  it('retains its lease and reports verified publication separately from a failed retained-state check', async () => {
    const f = await fixture()
    const plan = f.inspect()
    const rename = fs.renameSync
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      rename(from, to)
      if (String(to) === f.sealPath) writeFileSync(join(f.stateDir, 'seq'), '2')
    })
    syncBuiltinESMExports()
    let error: unknown
    try { recoverWebStore(plan) } catch (caught) { error = caught }
    expect(error).toMatchObject({ leaseArchived: true, sealRecovery: 'published',
      message: 'web-recovery:failed:seal-recovery:post-publication-check-failed',
      cause: { cause: { message: 'web-recovery:retained-state-changed' } } })
    expect(JSON.parse(readFileSync(join(f.stateDir, '.broker-active.lock'), 'utf8')) as unknown).toMatchObject({ pid: process.pid })
    expect(JSON.parse(readFileSync(f.sealPath, 'utf8')) as unknown).toMatchObject({ stateDev: lstatSync(f.stateDir).dev })
  })

  it('keeps publication indeterminate when the replacement cannot be verified', async () => {
    const f = await fixture()
    const plan = f.inspect()
    const rename = fs.renameSync
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      rename(from, to)
      if (String(to) === f.sealPath) {
        chmodSync(f.sealPath, 0o600)
        writeFileSync(f.sealPath, 'corrupted publication')
        chmodSync(f.sealPath, 0o400)
      }
    })
    syncBuiltinESMExports()
    let error: unknown
    try { recoverWebStore(plan) } catch (caught) { error = caught }
    expect(error).toMatchObject({ leaseArchived: true, sealRecovery: 'indeterminate',
      message: 'web-recovery:failed:seal-recovery:publication-indeterminate' })
    expect(JSON.parse(readFileSync(join(f.stateDir, '.broker-active.lock'), 'utf8')) as unknown).toMatchObject({ pid: process.pid })
    expect(readFileSync(f.sealPath, 'utf8')).toBe('corrupted publication')
  })

  it('runs the read-only CLI with pinned history and refuses apply over a pipe', async () => {
    const f = await fixture()
    const before = witness(f.stateDir)
    const args = [BIN, '--data-dir', f.dataDir, '--expect-head', f.head]
    const check = spawnSync(process.execPath, [...args, '--check'], { encoding: 'utf8', timeout: 10_000 })
    expect(check.status, check.stderr).toBe(0)
    const output = JSON.parse(check.stdout) as ReturnType<typeof inspectWebRecovery>
    expect({ entries: output.retained.entries, brokerStarted: output.brokerStarted,
      historicalVolumeIdentity: output.historicalVolumeIdentity, issuerSignaturesVerified: output.issuerSignaturesVerified })
      .toMatchInlineSnapshot(`
        {
          "brokerStarted": false,
          "entries": 1,
          "historicalVolumeIdentity": "unverified",
          "issuerSignaturesVerified": false,
        }
      `)
    const apply = spawnSync(process.execPath, [...args, '--apply'], { encoding: 'utf8', timeout: 10_000 })
    expect(apply.status).toBe(1)
    expect(JSON.parse(apply.stderr)).toEqual({ status: 'REFUSED', reason: 'web-recovery:attended-terminal-required' })
    expect(witness(f.stateDir)).toEqual(before)
  })

  it.skipIf(process.platform !== 'darwin').each(['accept', 'decline', 'interrupt'] as const)(
    'runs the real terminal CLI with SCRIPTED %s input over a native PTY', async (mode) => {
      const f = await fixture()
      const before = witness(f.stateDir)
      const args = [BIN, '--data-dir', f.dataDir, '--expect-head', f.head, '--apply']
      const manifest = new URL('../packages/subprocess/subprocess-local/package.json', import.meta.url).href
      const source = `
        import { createRequire } from 'node:module';
        const pty = createRequire(${JSON.stringify(manifest)})('node-pty');
        const terminal = pty.spawn(${JSON.stringify(process.execPath)}, ${JSON.stringify(args)});
        let text = '', answered = false, timedOut = false;
        const deadline = setTimeout(() => { timedOut = true; terminal.kill('SIGKILL'); }, 8000);
        terminal.onData(data => {
          text += data;
          const match = text.match(/Type "(recover [a-f0-9]{16})"/);
          if (match && !answered) {
            answered = true;
            terminal.write(${JSON.stringify(mode)} === 'accept' ? match[1] + '\\r'
              : ${JSON.stringify(mode)} === 'decline' ? 'no\\r' : '\\x03');
          }
        });
        terminal.onExit(({ exitCode, signal }) => {
          clearTimeout(deadline);
          process.stdout.write(JSON.stringify({ text, answered, timedOut, exitCode, signal }));
        });
      `
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', source],
        { encoding: 'utf8', timeout: 10_000, maxBuffer: 2 * 1024 * 1024 })
      expect(result.status, result.stderr).toBe(0)
      const observed = JSON.parse(result.stdout) as { text: string; answered: boolean; timedOut: boolean; exitCode: number }
      expect(observed.answered).toBe(true)
      expect(observed.timedOut).toBe(false)
      expect(observed.exitCode, observed.text).toBe(mode === 'accept' ? 0 : 1)
      if (mode === 'accept') {
        expect(observed.text).toContain('WEB_STORE_RECOVERED')
        expect(existsSync(join(f.stateDir, '.broker-active.lock'))).toBe(false)
        await f.restart()
        expect(await request(f.socketPath, { op: 'kira.recall' })).toMatchObject({ ok: true, ...f.recall() })
        await f.stop('SIGTERM')
      } else {
        expect(observed.text).toContain(mode === 'decline' ? 'operator-declined' : 'approval-input-closed')
        expect(witness(f.stateDir)).toEqual(before)
        expect(existsSync(join(f.dataDir, 'recovery'))).toBe(false)
      }
    }, 15_000,
  )
})
