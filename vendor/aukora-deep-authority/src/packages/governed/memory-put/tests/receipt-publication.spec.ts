/**
 * Focused publication controls for broker settlement receipts.
 *
 * Exercises writeReceipt atomic publication, final-name collisions, winner protection
 * against overwrite or deletion, and pre/post-link cleanup failures using disposable
 * fixtures and test-local coordination. No production fault API is introduced.
 */
import fs, {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettlementReceipt } from '@aukora/core/broker/receipt.mjs'
import {
  RECEIPT_REFUSE,
  readReceipt,
  verifyReceiptDirectory,
  writeReceipt,
} from '@aukora/core/broker/receipt.mjs'

describe('receipt publication controls', () => {
  let tempDir: string
  let stateDir: string
  let receiptsDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'aukora-receipt-pub-'))
    stateDir = join(tempDir, 'state')
    mkdirSync(stateDir, { mode: 0o700, recursive: true })
    receiptsDir = join(stateDir, 'receipts')
    mkdirSync(receiptsDir, { mode: 0o700, recursive: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    syncBuiltinESMExports()
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // Discard temp directory removal errors during teardown
    }
  })

  function createTestReceipt(key = 'test-key', sequence = 1): SettlementReceipt {
    return {
      requestDigest: 'a'.repeat(64),
      definitionId: 'b'.repeat(64),
      nonce: `nonce-${key}-${sequence}`,
      sequence,
      path: '/dev/null',
      bytes: 0,
      contentSha256: 'c'.repeat(64),
      inode: 1,
      mtimeNs: '1000',
      confinement: {
        class: 'state-owned',
        euid: typeof process.geteuid === 'function' ? process.geteuid() : 0,
        stateUid: typeof process.geteuid === 'function' ? process.geteuid() : 0,
        stateMode: '0700',
        stateDev: 1,
        stateIno: 1,
        platform: process.platform,
        sealClass: 'state-owned',
        peerProof: null,
      },
      signature: Buffer.alloc(64, 1).toString('base64'),
    }
  }

  it('publishes receipt atomically with create-if-absent semantics and cleans staging', () => {
    const receipt = createTestReceipt('positive-control', 1)
    const result = writeReceipt({ stateDir, receipt })

    expect(result).toMatchObject({
      path: expect.any(String),
      receiptSha256: expect.any(String),
      receipt: expect.any(Object),
    })
    expect(existsSync(result.path)).toBe(true)

    // Mode is 0o600 on the final publication
    const stat = lstatSync(result.path)
    expect(stat.isFile()).toBe(true)
    expect(stat.mode & 0o777).toBe(0o600)

    // Content on disk is canonical JSON + newline
    const onDisk = readReceipt({ stateDir, receiptSha256: result.receiptSha256 })
    expect(onDisk).toEqual(receipt)

    // Staging file is unlinked; only the published receipt exists in receiptsDir
    const entries = readdirSync(receiptsDir)
    expect(entries).toEqual([`${result.receiptSha256}.json`])

    // Independent directory verification passes
    expect(verifyReceiptDirectory({
      stateDir,
      receiptSha256s: new Set([result.receiptSha256]),
    })).toEqual({ ok: true, count: 1 })
  })

  it('pins pre-link final-name collision: existing destination throws and winner is unmodified', () => {
    const receipt = createTestReceipt('existing-collision', 1)
    const winnerResult = writeReceipt({ stateDir, receipt })
    const winnerPath = winnerResult.path
    const winnerStat = lstatSync(winnerPath, { bigint: true })
    const winnerBytes = readFileSync(winnerPath, 'utf8')

    // Second writeReceipt encounters existing file on pre-link check
    expect(() => writeReceipt({ stateDir, receipt })).toThrow(RECEIPT_REFUSE.ALREADY_EXISTS)

    // Winner's file is intact: identical inode, bytes, size, and mtime
    const currentStat = lstatSync(winnerPath, { bigint: true })
    expect(currentStat.ino).toBe(winnerStat.ino)
    expect(currentStat.size).toBe(winnerStat.size)
    expect(currentStat.mtimeNs).toBe(winnerStat.mtimeNs)
    expect(readFileSync(winnerPath, 'utf8')).toBe(winnerBytes)

    // No leftover staging file from the loser
    const entries = readdirSync(receiptsDir)
    expect(entries).toEqual([`${winnerResult.receiptSha256}.json`])
  })

  it('pins link-time final-name collision: loser linkSync EEXIST fails closed and never overwrites or removes winner', () => {
    const receipt = createTestReceipt('racing-collision', 1)

    // Compute expected final path manually by doing one publication then removing
    const { receiptSha256 } = writeReceipt({ stateDir, receipt })
    const expectedPath = join(receiptsDir, `${receiptSha256}.json`)
    fs.unlinkSync(expectedPath)

    const CANARY_WINNER_CONTENT = JSON.stringify({ winner: true, canary: 'do-not-overwrite' }) + '\n'

    // Simulate link-time race: canonical path appears after pre-lstat check and before linkSync
    const realLinkSync = fs.linkSync
    vi.spyOn(fs, 'linkSync').mockImplementationOnce((staging, target) => {
      // Winner publishes to canonical target right before loser's linkSync
      writeFileSync(target, CANARY_WINNER_CONTENT, { mode: 0o600, flag: 'wx' })
      // Real linkSync now encounters EEXIST against the winner
      return realLinkSync(staging, target)
    })
    syncBuiltinESMExports()

    // Loser attempts publication and fails with ALREADY_EXISTS
    expect(() => writeReceipt({ stateDir, receipt })).toThrow(RECEIPT_REFUSE.ALREADY_EXISTS)

    // Prove winner's file at canonical target was NEVER overwritten or removed by loser
    expect(existsSync(expectedPath)).toBe(true)
    expect(readFileSync(expectedPath, 'utf8')).toBe(CANARY_WINNER_CONTENT)

    // Prove loser's staging file was cleaned up and not left on disk
    const entries = readdirSync(receiptsDir)
    expect(entries).toEqual([`${receiptSha256}.json`])
  })

  it('pins pre-link write failure: throws primary error, cleans staging, and never creates final path', () => {
    const receipt = createTestReceipt('prelink-failure', 1)
    const realWriteFileSync = fs.writeFileSync

    vi.spyOn(fs, 'writeFileSync').mockImplementationOnce((target, ...args) => {
      if (typeof target === 'number') {
        throw new Error('disk full ENOSPC')
      }
      return realWriteFileSync(target, ...args)
    })
    syncBuiltinESMExports()

    expect(() => writeReceipt({ stateDir, receipt })).toThrow(RECEIPT_REFUSE.UNAVAILABLE)

    // On-disk outcome: canonical destination was NEVER created
    const entries = readdirSync(receiptsDir)
    expect(entries).toEqual([])
  })

  it('pins pre-link failure with staging cleanup failure: preserves primary error and does not create final path', () => {
    const receipt = createTestReceipt('prelink-cleanup-failure', 1)
    const realWriteFileSync = fs.writeFileSync

    vi.spyOn(fs, 'writeFileSync').mockImplementationOnce((target, ...args) => {
      if (typeof target === 'number') {
        throw new Error('write failure EIO')
      }
      return realWriteFileSync(target, ...args)
    })
    vi.spyOn(fs, 'unlinkSync').mockImplementationOnce((target) => {
      if (String(target).includes('.tmp-')) {
        throw new Error('staging unlink failure EPERM')
      }
      return fs.unlinkSync(target)
    })
    syncBuiltinESMExports()

    // Primary error (receipt:unavailable) is preserved, not masked by the staging cleanup failure
    expect(() => writeReceipt({ stateDir, receipt })).toThrow(RECEIPT_REFUSE.UNAVAILABLE)

    // On-disk outcome: canonical destination was never created
    const entries = readdirSync(receiptsDir)
    expect(entries.some(e => !e.startsWith('.tmp-'))).toBe(false)

    // Assert actual retained staging file exists when cleanup is faulted (an empty directory must not pass)
    const tmpEntries = entries.filter(e => e.startsWith('.tmp-'))
    expect(tmpEntries.length).toBe(1)
    const retainedStagingPath = join(receiptsDir, tmpEntries[0]!)
    expect(existsSync(retainedStagingPath)).toBe(true)
    expect(lstatSync(retainedStagingPath).isFile()).toBe(true)
  })

  it('pins post-link cleanup failure: throws primary error while canonical on-disk publication is preserved and verifiable', () => {
    const receipt = createTestReceipt('postlink-cleanup-failure', 1)
    const realUnlinkSync = fs.unlinkSync

    // linkSync succeeds creating canonical path, but unlinking staging throws
    vi.spyOn(fs, 'unlinkSync').mockImplementation((target) => {
      if (String(target).includes('.tmp-')) {
        throw new Error('post-link staging unlink EIO')
      }
      return realUnlinkSync(target)
    })
    syncBuiltinESMExports()

    let thrownError: unknown
    try {
      writeReceipt({ stateDir, receipt })
    } catch (error) {
      thrownError = error
    }

    // Primary error thrown is receipt:unavailable
    expect(thrownError).toMatchObject({ message: RECEIPT_REFUSE.UNAVAILABLE })

    // On-disk outcome is distinguished: canonical receipt file WAS created and is valid!
    const entries = readdirSync(receiptsDir)
    const receiptFile = entries.find(e => !e.startsWith('.tmp-'))
    expect(receiptFile).toBeDefined()
    const canonicalPath = join(receiptsDir, receiptFile!)
    expect(existsSync(canonicalPath)).toBe(true)

    // Winner/destination bytes are intact and match readReceipt
    const onDisk = JSON.parse(readFileSync(canonicalPath, 'utf8')) as Record<string, unknown>
    expect(onDisk).toEqual(receipt)
    const verifiedDisk = readReceipt({ stateDir, receiptSha256: receiptFile!.replace('.json', '') })
    expect(verifiedDisk).toEqual(receipt)

    // Assert actual retained staging file exists alongside destination when cleanup is faulted (an empty directory must not pass)
    const tmpEntries = entries.filter(e => e.startsWith('.tmp-'))
    expect(tmpEntries.length).toBe(1)
    const retainedStagingPath = join(receiptsDir, tmpEntries[0]!)
    expect(existsSync(retainedStagingPath)).toBe(true)
    expect(lstatSync(retainedStagingPath).isFile()).toBe(true)
    expect(readFileSync(retainedStagingPath, 'utf8')).toBe(readFileSync(canonicalPath, 'utf8'))

    // verifyReceiptDirectory ignores the .tmp- residue and verifies canonical receipt
    const receiptSha = receiptFile!.replace('.json', '')
    expect(verifyReceiptDirectory({
      stateDir,
      receiptSha256s: new Set([receiptSha]),
    })).toEqual({ ok: true, count: 1 })
  })

  it('pins link-time collision with staging cleanup failure: throws ALREADY_EXISTS, preserves winner bytes, and retains staging residue', () => {
    const receipt = createTestReceipt('collision-cleanup-failure', 1)

    // Compute expected final path manually
    const { receiptSha256 } = writeReceipt({ stateDir, receipt })
    const expectedPath = join(receiptsDir, `${receiptSha256}.json`)
    fs.unlinkSync(expectedPath)

    const CANARY_WINNER_CONTENT = JSON.stringify({ winner: true, canary: 'do-not-overwrite' }) + '\n'

    // Winner publishes right before loser's linkSync, and loser's staging cleanup throws
    const realLinkSync = fs.linkSync
    vi.spyOn(fs, 'linkSync').mockImplementationOnce((staging, target) => {
      writeFileSync(target, CANARY_WINNER_CONTENT, { mode: 0o600, flag: 'wx' })
      return realLinkSync(staging, target)
    })
    vi.spyOn(fs, 'unlinkSync').mockImplementationOnce((target) => {
      if (String(target).includes('.tmp-')) {
        throw new Error('staging unlink failure EPERM')
      }
      return fs.unlinkSync(target)
    })
    syncBuiltinESMExports()

    // Primary error (ALREADY_EXISTS) is preserved
    expect(() => writeReceipt({ stateDir, receipt })).toThrow(RECEIPT_REFUSE.ALREADY_EXISTS)

    // Winner's destination and bytes are preserved intact
    expect(existsSync(expectedPath)).toBe(true)
    expect(readFileSync(expectedPath, 'utf8')).toBe(CANARY_WINNER_CONTENT)

    // Loser's staging file was retained due to cleanup failure (an empty directory does not pass)
    const entries = readdirSync(receiptsDir)
    const tmpEntries = entries.filter(e => e.startsWith('.tmp-'))
    expect(tmpEntries.length).toBe(1)
    const stagingPath = join(receiptsDir, tmpEntries[0]!)
    expect(existsSync(stagingPath)).toBe(true)
    expect(lstatSync(stagingPath).isFile()).toBe(true)
  })
})
