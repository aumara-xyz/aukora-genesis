/** Runtime-file identity checks; these fixtures do not establish installed custody. */
import { createHash } from 'node:crypto'
import { linkSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

import { CUSTODY_PAIR_REFUSE, measureLaunchdRuntime, validateCustodyPairPlan } from './install-launchd-custody-pair.mjs'

const digest = (text: string): string => createHash('sha256').update(text).digest('hex')

describe('launchd runtime byte pin', () => {
  it('accepts exactly the pinned file and refuses a same-length replacement', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'aukora-runtime-pin-')))
    const path = join(root, 'runtime')
    try {
      writeFileSync(path, 'pinned bytes')
      expect(measureLaunchdRuntime(path, digest('pinned bytes'))).toEqual({
        path, sha256: digest('pinned bytes'), bytes: 12,
      })
      writeFileSync(path, 'hostile code')
      expect(() => measureLaunchdRuntime(path, digest('pinned bytes'))).toThrow(expect.objectContaining({
        reason: CUSTODY_PAIR_REFUSE.RUNTIME_BYTES_MISMATCH,
      }))
      writeFileSync(path, 'pinned bytes')
      expect(measureLaunchdRuntime(path, digest('pinned bytes')).sha256).toBe(digest('pinned bytes'))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not follow a symlink or accept a hard-linked runtime', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'aukora-runtime-pin-')))
    const path = join(root, 'runtime')
    try {
      writeFileSync(path, 'pinned bytes')
      symlinkSync(path, join(root, 'link'))
      expect(() => measureLaunchdRuntime(join(root, 'link'), digest('pinned bytes'))).toThrow()
      linkSync(path, join(root, 'hard-link'))
      expect(() => measureLaunchdRuntime(path, digest('pinned bytes'))).toThrow(expect.objectContaining({
        reason: CUSTODY_PAIR_REFUSE.RUNTIME_CHANGED,
      }))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('requires a canonical digest in the closed installer input', () => {
    const example = JSON.parse(readFileSync(new URL('../ops/launchd/custody-pair.example.json', import.meta.url), 'utf8')) as Record<string, unknown>
    expect(validateCustodyPairPlan(example).nodeSha256).toBe('0'.repeat(64))
    for (const invalid of ['', 'a'.repeat(63), 'A'.repeat(64), 'g'.repeat(64)]) {
      expect(() => validateCustodyPairPlan({ ...example, nodeSha256: invalid })).toThrow(expect.objectContaining({
        reason: CUSTODY_PAIR_REFUSE.FIELD_INVALID,
      }))
    }
    const { nodeSha256: _removed, ...unpinned } = example
    expect(() => validateCustodyPairPlan(unpinned)).toThrow(expect.objectContaining({
      reason: CUSTODY_PAIR_REFUSE.FIELD_MISSING,
    }))
    expect(() => validateCustodyPairPlan({ ...example, format: 'aukora:launchd-custody-pair:v1' })).toThrow(expect.objectContaining({
      reason: CUSTODY_PAIR_REFUSE.FIELD_INVALID,
    }))
  })

  it('the same wrong-digest assertion fails when only the byte comparison is disabled', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'aukora-runtime-mutant-')))
    try {
      const sourceUrl = new URL('./install-launchd-custody-pair.mjs', import.meta.url)
      let source = readFileSync(sourceUrl, 'utf8')
      const site = 'if (digest !== expectedSha256) {'
      expect(source.split(site)).toHaveLength(2)
      source = source.replace(site, 'if (false) {')
        .replace(/from '(\.[^']+)'/gu, (_match, specifier: string) => `from ${JSON.stringify(new URL(specifier, sourceUrl).href)}`)
      const mutantPath = join(root, 'installer-mutant.mjs')
      writeFileSync(mutantPath, source)
      const mutant = await import(pathToFileURL(mutantPath).href) as { measureLaunchdRuntime: typeof measureLaunchdRuntime }
      const path = join(root, 'runtime')
      writeFileSync(path, 'hostile code')
      const requiresMismatchRefusal = (measure: typeof measureLaunchdRuntime): void => {
        expect(() => measure(path, digest('pinned bytes'))).toThrow(expect.objectContaining({
          reason: CUSTODY_PAIR_REFUSE.RUNTIME_BYTES_MISMATCH,
        }))
      }
      requiresMismatchRefusal(measureLaunchdRuntime)
      expect(() => { requiresMismatchRefusal(mutant.measureLaunchdRuntime) }).toThrow(expect.objectContaining({ name: 'AssertionError' }))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
