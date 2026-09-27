import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs, { linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync,
  symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { acquireStateLease } from '../aukora/broker/broker.mjs'
import { inspectKiraRecovery } from './aukora-kira-recovery.mjs'

const script = fileURLToPath(new URL('./aukora-kira-recovery.mjs', import.meta.url))
const fixtures: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  syncBuiltinESMExports()
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true })
})

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'kira-recovery-')))
  fixtures.push(root)
  const state = join(root, 'state')
  mkdirSync(state, { mode: 0o700 })
  // Deliberately not a valid KIRA store: inspection must neither read nor verify these bytes.
  for (const name of ['activation.json', 'aura.jsonl', 'seq', 'private-key']) {
    writeFileSync(join(state, name), `fixture retained bytes: ${name}\n`, { mode: 0o600 })
  }
  const lock = join(state, '.broker-active.lock')
  const setLease = (pid = process.pid) => {
    writeFileSync(lock, `${JSON.stringify({ pid, startedAt: 1788890000000 })}\n`, { mode: 0o600 })
  }
  return { root, state, lock, setLease }
}

function witness(state: string) {
  return readdirSync(state).sort().map((name) => {
    const path = join(state, name)
    const stat = lstatSync(path, { bigint: true })
    return { name, ino: stat.ino, mode: stat.mode, mtime: stat.mtimeNs, bytes: readFileSync(path).toString('base64') }
  })
}

function run(...args: string[]) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 5000 })
}

describe.skipIf(process.platform === 'win32')('read-only KIRA recovery inspection', () => {
  it('observes the actual broker lease without authorizing release or reading retained files', () => {
    const f = fixture()
    const release = acquireStateLease(f.state)
    try {
      const before = witness(f.state)
      const result = run('--state-dir', f.state)
      expect(result.status, result.stderr).toBe(0)
      expect(result.stderr).toBe('')
      const report = JSON.parse(result.stdout) as Record<string, unknown>
      expect(report).toMatchObject({ schema: 'aukora:kira-recovery-inspection:v1', stateDir: f.state,
        status: 'pid-present', releaseAllowed: false, storeVerified: false,
        lease: { pid: process.pid, sha256: createHash('sha256').update(readFileSync(f.lock)).digest('hex') },
        process: { status: 'occupied', identity: 'unverified' } })
      expect(report.reason).toBe('kira-recovery:pid-exists-identity-unverified')
      expect({ ...report, stateDir: '<fixture>', lease: '<observed lease bytes>' }).toMatchInlineSnapshot(`
        {
          "lease": "<observed lease bytes>",
          "observationClass": "SAME_UID_ADVISORY / NOT_RELEASE_AUTHORITY",
          "process": {
            "identity": "unverified",
            "reason": "pid-exists-identity-unverified",
            "status": "occupied",
          },
          "reason": "kira-recovery:pid-exists-identity-unverified",
          "releaseAllowed": false,
          "schema": "aukora:kira-recovery-inspection:v1",
          "stateDir": "<fixture>",
          "status": "pid-present",
          "storeVerified": false,
        }
      `)
      expect(witness(f.state)).toEqual(before)
      expect(result.stdout).not.toContain('fixture retained bytes')

      const open = vi.spyOn(fs, 'openSync')
      syncBuiltinESMExports()
      expect(inspectKiraRecovery(f.state).status).toBe('pid-present')
      expect(open.mock.calls.map(call => call[0])).toEqual([f.lock, f.lock])
    } finally { release() }
  })

  it('reports an exited child PID as unobserved, not permission to unlink its lease', () => {
    const f = fixture()
    const child = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { timeout: 5000 })
    expect(child.status).toBe(0)
    expect(child.pid).toBeGreaterThan(0)
    f.setLease(child.pid)
    const before = witness(f.state)
    const result = run('--state-dir', f.state)
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'pid-not-observed', releaseAllowed: false,
      storeVerified: false, reason: 'kira-recovery:operator-recovery-required',
      process: { status: 'not-observed', identity: 'unverified' } })
    expect(witness(f.state)).toEqual(before)
  })

  it('distinguishes a missing lease from a missing state directory without creating either', () => {
    const f = fixture()
    const before = witness(f.state)
    expect(inspectKiraRecovery(f.state)).toMatchObject({ status: 'lease-absent', lease: null,
      storeVerified: false, releaseAllowed: false })
    const missing = run('--state-dir', join(f.root, 'missing'))
    expect(missing.status).toBe(2)
    expect(JSON.parse(missing.stdout)).toMatchObject({ status: 'undetermined', lease: null,
      reason: 'kira-recovery:state-directory-missing' })
    expect(readdirSync(f.root)).toEqual(['state'])
    expect(witness(f.state)).toEqual(before)
  })

  it.each([
    [], ['--state-dir', 'relative'], ['--state-dir', '/unused', '--release'],
    ['--release', '/unused'], ['--state-dir', '/unused', '--state-dir', '/other'],
  ])('refuses unsupported arguments without reading a store: %j', (...args) => {
    const result = run(...args)
    expect(result.status).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(/^usage: node scripts\/aukora-kira-recovery\.mjs /u)
  })

  it.each([
    '', 'x'.repeat(4097), '[]\n', '{"pid":0,"startedAt":1}\n', '{"pid":-1,"startedAt":1}\n',
    '{"pid":2147483648,"startedAt":1}\n', '{"pid":1.5,"startedAt":1}\n',
    '{"pid":1,"startedAt":"1"}\n', '{"pid":1,"startedAt":-1}\n',
    '{"pid":1,"startedAt":1,"approved":true}\n', '{"pid":1,"pid":2,"startedAt":1}\n',
  ])('refuses malformed or unbounded lease bytes (case %#)', (raw) => {
    const f = fixture()
    f.setLease()
    expect(inspectKiraRecovery(f.state).status).toBe('pid-present')
    writeFileSync(f.lock, raw)
    const before = witness(f.state)
    const kill = vi.spyOn(process, 'kill')
    const report = inspectKiraRecovery(f.state)
    expect(report).toMatchObject({ status: 'undetermined', lease: null, process: null, releaseAllowed: false })
    expect(report.reason).toMatch(/^kira-recovery:lease-(?:malformed|size-invalid)$/u)
    expect(kill).not.toHaveBeenCalled()
    expect(witness(f.state)).toEqual(before)
  })

  it('refuses directory aliases, symlink leases, hard links and special entries', () => {
    const f = fixture()
    f.setLease()
    expect(inspectKiraRecovery(f.state).status).toBe('pid-present')
    const alias = join(f.root, 'alias')
    symlinkSync(f.state, alias, 'dir')
    expect(inspectKiraRecovery(alias).reason).toBe('kira-recovery:state-directory-required')
    mkdirSync(join(f.state, 'nested'))
    expect(inspectKiraRecovery(join(alias, 'nested')).reason).toBe('kira-recovery:canonical-state-required')
    const target = join(f.root, 'lease-source')
    renameSync(f.lock, target)
    const retained = readFileSync(target)
    symlinkSync(target, f.lock)
    expect(inspectKiraRecovery(f.state).reason).toBe('kira-recovery:regular-single-link-lease-required')
    unlinkSync(f.lock)
    linkSync(target, f.lock)
    expect(inspectKiraRecovery(f.state).reason).toBe('kira-recovery:regular-single-link-lease-required')
    expect(readFileSync(target)).toEqual(retained)
    unlinkSync(f.lock)
    mkdirSync(f.lock)
    expect(inspectKiraRecovery(f.state).reason).toBe('kira-recovery:regular-single-link-lease-required')
  })

  it.each(['EPERM', 'EINVAL'])('does not treat a denied/unknown PID probe as a dead writer: %s', (code) => {
    const f = fixture()
    f.setLease()
    const before = witness(f.state)
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error(code), { code }) })
    expect(inspectKiraRecovery(f.state)).toMatchObject({ status: 'undetermined', lease: null, process: null,
      reason: code === 'EPERM' ? 'kira-recovery:pid-probe-denied' : 'kira-recovery:pid-probe-failed' })
    expect(kill).toHaveBeenCalledExactlyOnceWith(process.pid, 0)
    expect(witness(f.state)).toEqual(before)
    kill.mockRestore()
    expect(inspectKiraRecovery(f.state).status).toBe('pid-present')
  })

  it.each(['replace-lease', 'rewrite-lease', 'replace-directory'])('discards changed observations: %s', (mutation) => {
    const f = fixture()
    f.setLease()
    expect(inspectKiraRecovery(f.state).status).toBe('pid-present')
    vi.spyOn(process, 'kill').mockImplementation(() => {
      if (mutation === 'replace-lease') unlinkSync(f.lock)
      if (mutation === 'replace-directory') { renameSync(f.state, join(f.root, 'original')); mkdirSync(f.state) }
      f.setLease(process.pid + 1)
      return true
    })
    expect(inspectKiraRecovery(f.state)).toMatchObject({ status: 'undetermined', lease: null, process: null,
      releaseAllowed: false, reason: 'kira-recovery:observation-changed' })
  })
})
