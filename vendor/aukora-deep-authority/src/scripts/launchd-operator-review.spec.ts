import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { main, assertOperatorInvocationTree, readIssuerOnlyGroup, readOperatorReviewFile } from './launchd-operator-review.mjs'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'operator-review-'))
  roots.push(root)
  const path = join(root, 'terminal.pem')
  writeFileSync(path, 'fixture terminal bytes', { mode: 0o600 })
  return { root, path, uid: process.geteuid!() }
}

describe.skipIf(process.platform === 'win32')('operator terminal prerequisites', () => {
  it.each(['issuer-only', 'broker-member', 'extra-primary-member', 'nested-group', 'missing-issuer', 'shared-route-group'])(
    'checks %s directory-service observations before publication', (mode) => {
      const plan = { issuerUser: '_issuer', issuerUid: 602, issuerGid: 602,
        brokerUser: '_broker', brokerUid: 601, brokerGid: 601, guestUser: '_guest', guestUid: 603 }
      // SCRIPTED host observations exercise selection; no accounts are provisioned.
      const observe = (binary: string, args: string[]): string => {
        if (binary === '/usr/bin/id') {
          if (args[0] === '-u') return args[1] === '_issuer' ? '602' : args[1] === '_broker' ? '601' : '603'
          return args[1] === '_issuer' && mode !== 'missing-issuer' ? '602 604' : '601'
        }
        // A stock macOS listing includes system accounts whose primary group is -2 (nobody).
        if (args[1] === '-list') return mode === 'extra-primary-member' ? '_issuer 602\n_extra 604' : '_issuer 602\n_ftp -2'
        if (args[2] === '/Users/_issuer') return 'UniqueID: 602\nGeneratedUID: ISSUER-UUID\n'
        return `PrimaryGroupID: ${mode === 'shared-route-group' ? '602' : '604'}\n`
          + `GroupMembership: ${mode === 'broker-member' ? '_broker' : '_issuer'}\nGroupMembers: ISSUER-UUID\n`
          + `NestedGroups: ${mode === 'nested-group' ? 'ANOTHER-GROUP' : ''}\n`
      }
      if (mode === 'issuer-only') expect(readIssuerOnlyGroup(plan, '_review', observe)).toBe(604)
      else expect(() => readIssuerOnlyGroup(plan, '_review', observe)).toThrow('approval-group-not-isolated')
    },
  )

  it('reads protected fixture bytes without changing them', () => {
    const test = fixture()
    expect(readOperatorReviewFile(test.path, test.uid, true)).toBe('fixture terminal bytes')
    expect(readFileSync(test.path, 'utf8')).toBe('fixture terminal bytes')
  })

  it('requires private key permissions while accepting public configuration permissions', () => {
    const test = fixture()
    chmodSync(test.path, 0o644)
    expect(() => readOperatorReviewFile(test.path, test.uid, true)).toThrow('file-custody-invalid')
    expect(readOperatorReviewFile(test.path, test.uid, false)).toBe('fixture terminal bytes')
  })

  it('refuses a replaced path, oversized input, and a writable parent', () => {
    const test = fixture()
    const alias = join(test.root, 'alias')
    symlinkSync(test.path, alias)
    expect(() => readOperatorReviewFile(alias, test.uid, true)).toThrow()
    writeFileSync(test.path, 'x'.repeat(32 * 1024 + 1))
    expect(() => readOperatorReviewFile(test.path, test.uid, true)).toThrow('file-custody-invalid')
    writeFileSync(test.path, 'fixture')
    chmodSync(test.root, 0o777)
    expect(() => readOperatorReviewFile(test.path, test.uid, true)).toThrow('file-parent-not-protected')
    chmodSync(test.root, 0o700)
  })

  it('refuses extra command flags before reading any file', async () => {
    await expect(main(['--approve-all'])).rejects.toThrow('usage:')
  })

  it.skipIf(process.platform !== 'darwin' || process.geteuid?.() === 0)('requires root for installed preflight before opening a route', async () => {
    const test = fixture()
    await expect(main(['--inputs', test.path, '--private-key', test.path, '--approval-group', '_fixture', '--check']))
      .rejects.toThrow('root-required')
  })

  it('refuses an untrusted invocation tree by exact name from a disposable fixture', () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), 'operator-invocation-tree-'))
    roots.push(root)
    const modulePath = join(root, 'launchd-operator-review.mjs')
    writeFileSync(modulePath, 'fixture')
    chmodSync(root, 0o777)
    try {
      expect(() => assertOperatorInvocationTree({ modulePath, repoRoot: root }))
        .toThrow('operator-review:invocation-tree-untrusted')
    } finally {
      chmodSync(root, 0o700)
    }
  })

  it('accepts a modeled root-owned tree and refuses each custody corruption', () => {
    const clean = () => ({ isDirectory: () => true, isSymbolicLink: () => false, uid: 0, mode: 0o755 })
    const options = { modulePath: '/repo/scripts/launchd-operator-review.mjs', repoRoot: '/repo' }
    expect(() => assertOperatorInvocationTree({ ...options, stat: () => clean() })).not.toThrow()
    for (const corrupt of [
      () => ({ ...clean(), uid: 501 }),
      () => ({ ...clean(), mode: 0o775 }),
      () => ({ ...clean(), mode: 0o755 | 0o002 }),
      () => ({ isDirectory: () => false, isSymbolicLink: () => false, uid: 0, mode: 0o755 }),
      () => ({ isDirectory: () => true, isSymbolicLink: () => true, uid: 0, mode: 0o755 }),
    ]) {
      expect(() => assertOperatorInvocationTree({ ...options, stat: () => corrupt() }))
        .toThrow('operator-review:invocation-tree-untrusted')
    }
    expect(() => assertOperatorInvocationTree({ ...options, stat: () => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }) } }))
      .toThrow('operator-review:invocation-tree-untrusted')
  })

  it('gates the attaching path on the invocation tree without gating --check', async () => {
    const test = fixture()
    await expect(main(['--inputs', test.path, '--private-key', test.path, '--approval-group', '_fixture']))
      .rejects.toThrow('operator-review:invocation-tree-untrusted')
    const checkError = await main(['--inputs', test.path, '--private-key', test.path, '--approval-group', '_fixture', '--check'])
      .then(() => null, (error: unknown) => error)
    expect(String((checkError as Error | null)?.message ?? checkError)).not.toContain('operator-review:invocation-tree-untrusted')
  })
})
