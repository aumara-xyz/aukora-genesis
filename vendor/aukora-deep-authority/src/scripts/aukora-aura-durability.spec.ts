/**
 * Aura append durability and append-lock ownership: the record's bytes reach the
 * disk before anything is told the entry exists, and a caller that must not begin
 * work it cannot record can hold the lock across that work itself.
 *
 * `appendEntry` takes an `afterAppend` witness callback, and the broker uses it
 * to advance a durable sequence (`aukora/broker/broker.mjs:2005`,
 * `afterAppend: ({ fields }) => writeSequence(stateDir, fields.sequence)`). That
 * sequence is a claim that the entry is recorded. Before this change the append
 * wrote and closed without flushing, so the claim could outlive the bytes it
 * described. These cases fix the ordering and the failure direction: the flush
 * happens first, and when it fails the witness is never reached.
 *
 * Every case uses a disposable directory. Nothing here touches a populated
 * store, an installed path, or the broker's own state.
 *
 * Scope ceiling: this proves ordering and failure propagation against the real
 * `fsync` calls the module makes. It does not establish complete power-loss
 * transaction safety — no test here pulls power, and a single-file append with
 * a separate witness file is not an atomic transaction across the two.
 */

import { chmodSync, closeSync, mkdtempSync, existsSync, openSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function scratch(): string {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'aura-durability-'))
  roots.push(root)
  return root
}

/** Load the record module fresh, with `node:fs` partially mocked to record call order. */
type RecordModule = typeof import('../aukora/aura/record.mjs')

async function loadWithFsSpy(options: { failFsyncOn?: (path: unknown) => boolean } = {}): Promise<{
  appendEntry: RecordModule['appendEntry']
  acquireAppendLock: RecordModule['acquireAppendLock']
  releaseAppendLock: RecordModule['releaseAppendLock']
  verifyChain: RecordModule['verifyChain']
  order: string[]
}> {
  const order: string[] = []
  // Each load installs its own spy, so the module registry is cleared first;
  // otherwise a second load in one case silently reuses the first one's mock.
  vi.resetModules()
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  // Only the two calls under test are observed; every other operation is the
  // real one, so the chain, the lock and the bytes are genuine.
  vi.doMock('node:fs', () => ({
    ...actual,
    default: actual,
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      order.push('write')
      return actual.writeFileSync(...args)
    },
    fsyncSync: (descriptor: number) => {
      order.push('fsync')
      if (options.failFsyncOn?.(descriptor) === true) {
        throw Object.assign(new Error('EIO: simulated flush failure'), { code: 'EIO' })
      }
      return actual.fsyncSync(descriptor)
    },
  }))
  const module = await import('../aukora/aura/record.mjs')
  // The lock handle registry is module-private, so a handle only authenticates
  // against the instance that issued it: these must come from this same load.
  return {
    appendEntry: module.appendEntry,
    acquireAppendLock: module.acquireAppendLock,
    releaseAppendLock: module.releaseAppendLock,
    verifyChain: module.verifyChain,
    order,
  }
}

describe('the record is durable before the witness advances', () => {
  it('flushes the entry before calling afterAppend', async () => {
    const { appendEntry, order } = await loadWithFsSpy()
    const file = join(scratch(), 'aura.jsonl')
    appendEntry({ file, fields: { sequence: 1 }, afterAppend: () => { order.push('afterAppend') } })
    // The write must be flushed before anything is told the entry exists.
    expect(order.indexOf('write')).toBeLessThan(order.indexOf('fsync'))
    expect(order.indexOf('fsync')).toBeLessThan(order.indexOf('afterAppend'))
  })

  it('flushes the parent directory when the append creates the record', async () => {
    const { appendEntry, order } = await loadWithFsSpy()
    const file = join(scratch(), 'aura.jsonl')
    appendEntry({ file, fields: { sequence: 1 }, afterAppend: () => { order.push('afterAppend') } })
    // Two flushes on a creating append: the file's bytes, then its directory
    // entry, both before the witness.
    expect(order.filter(step => step === 'fsync')).toHaveLength(2)
    expect(order.lastIndexOf('fsync')).toBeLessThan(order.indexOf('afterAppend'))
  })

  it('does not re-flush the directory on a later append to an existing record', async () => {
    const { appendEntry } = await loadWithFsSpy()
    const file = join(scratch(), 'aura.jsonl')
    appendEntry({ file, fields: { sequence: 1 } })
    const second = await loadWithFsSpy()
    second.appendEntry({ file, fields: { sequence: 2 } })
    expect(second.order.filter(step => step === 'fsync')).toHaveLength(1)
  })
})

describe('a flush failure refuses the append instead of witnessing it', () => {
  it('never calls afterAppend when the entry cannot be flushed', async () => {
    const { appendEntry } = await loadWithFsSpy({ failFsyncOn: () => true })
    const file = join(scratch(), 'aura.jsonl')
    const witness = vi.fn()
    expect(() => appendEntry({ file, fields: { sequence: 1 }, afterAppend: witness })).toThrow(/EIO/u)
    // The broker advances its sequence inside this callback; not reaching it is
    // the whole point of flushing first.
    expect(witness).not.toHaveBeenCalled()
  })

  it('leaves no owned lock behind when the append fails', async () => {
    const { appendEntry } = await loadWithFsSpy({ failFsyncOn: () => true })
    const file = join(scratch(), 'aura.jsonl')
    expect(() => appendEntry({ file, fields: { sequence: 1 } })).toThrow()
    // The lock is released by the same `finally` that releases it on success;
    // no age-based or stale-lock reaping is introduced by this change.
    expect(existsSync(`${file}.lock`)).toBe(false)
  })

  it('still refuses and releases the lock when only the directory flush fails', async () => {
    vi.resetModules()
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
    const file = join(scratch(), 'aura.jsonl')
    // Fail the second flush only: the file's bytes succeed, the directory entry
    // does not, so the record could be unreachable by name.
    let flushes = 0
    const witness = vi.fn()
    vi.doMock('node:fs', () => ({
      ...actual,
      default: actual,
      fsyncSync: (descriptor: number) => {
        flushes += 1
        if (flushes === 2) throw Object.assign(new Error('EIO: simulated directory flush failure'), { code: 'EIO' })
        return actual.fsyncSync(descriptor)
      },
    }))
    const { appendEntry } = await import('../aukora/aura/record.mjs')
    expect(() => appendEntry({ file, fields: { sequence: 1 }, afterAppend: witness })).toThrow(/EIO/u)
    expect(witness).not.toHaveBeenCalled()
    expect(existsSync(`${file}.lock`)).toBe(false)
  })
})

describe('the canonical record is unchanged', () => {
  it('writes the same bytes this record always wrote', async () => {
    const { appendEntry, verifyChain } = await loadWithFsSpy()
    const file = join(scratch(), 'aura.jsonl')
    const first = appendEntry({ file, fields: { sequence: 1, note: 'alpha' } })
    const second = appendEntry({ file, fields: { sequence: 2, note: 'beta' } })

    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
    expect(lines).toHaveLength(2)
    // Envelope first, then the caller's fields in their own order — the
    // encoding the chain hash covers. Durability must not alter one byte of it.
    expect(lines[0]).toBe(JSON.stringify({ hash: first.hash, prev: first.prev, sequence: 1, note: 'alpha' }))
    expect(lines[1]).toBe(JSON.stringify({ hash: second.hash, prev: second.prev, sequence: 2, note: 'beta' }))
    expect(second.prev).toBe(first.hash)
    expect(verifyChain(file)).toMatchObject({ ok: true, count: 2 })
  })

  it('keeps the chain verifiable across the creating and the appending path', async () => {
    const { appendEntry, verifyChain } = await loadWithFsSpy()
    const file = join(scratch(), 'aura.jsonl')
    for (let sequence = 1; sequence <= 5; sequence += 1) appendEntry({ file, fields: { sequence } })
    expect(verifyChain(file)).toMatchObject({ ok: true, count: 5 })
  })
})

describe('the witness contract the broker depends on', () => {
  it('reports the entry the record actually holds', async () => {
    const { appendEntry } = await loadWithFsSpy()
    const file = join(scratch(), 'aura.jsonl')
    const seen: { hash: string; prev: string; fields: Record<string, unknown> }[] = []
    const result = appendEntry({
      file,
      fields: { sequence: 7 },
      afterAppend: (entry: { hash: string; prev: string; fields: Record<string, unknown> }) => { seen.push(entry) },
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ hash: result.hash, prev: result.prev, fields: { sequence: 7 } })
    // What the broker would write its sequence from is on disk by the time it
    // is handed the entry.
    expect(readFileSync(file, 'utf8')).toContain(`"hash":"${result.hash}"`)
  })

  it('refuses a reserved field before writing or witnessing anything', async () => {
    const { appendEntry } = await loadWithFsSpy()
    const file = join(scratch(), 'aura.jsonl')
    const witness = vi.fn()
    expect(() => appendEntry({ file, fields: { hash: 'x', sequence: 1 }, afterAppend: witness }))
      .toThrow(/record:reserved-field/u)
    expect(witness).not.toHaveBeenCalled()
    expect(existsSync(file)).toBe(false)
    expect(existsSync(`${file}.lock`)).toBe(false)
  })
})

describe('an append lock may be held by the caller', () => {
  it('refuses acquisition against a lock already on disk, and touches neither the lock nor the chain', async () => {
    const { acquireAppendLock } = await import('../aukora/aura/record.mjs')
    const file = join(scratch(), 'aura.jsonl')
    const lockPath = `${file}.lock`
    const foreign = openSync(lockPath, 'wx')
    try {
      expect(() => acquireAppendLock(file, { attempts: 2, spinMs: 1 })).toThrow('record:lock-timeout')
      // The foreign lock is someone else's; nothing here may remove it.
      expect(existsSync(lockPath)).toBe(true)
      expect(existsSync(file)).toBe(false)
    } finally {
      closeSync(foreign)
      unlinkSync(lockPath)
    }
  })

  it('writes the same bytes through a caller-held lock as through its own', async () => {
    const { acquireAppendLock, releaseAppendLock, appendEntry } = await import('../aukora/aura/record.mjs')
    const fields = { sequence: 1, verdict: 'settled' }
    const own = join(scratch(), 'aura.jsonl')
    appendEntry({ file: own, fields })
    const held = join(scratch(), 'aura.jsonl')
    const lock = acquireAppendLock(held)
    appendEntry({ file: held, lock, fields })
    releaseAppendLock(lock)
    expect(readFileSync(held, 'utf8')).toBe(readFileSync(own, 'utf8'))
  })

  it('neither releases nor unlinks a caller-held lock, on the returning path or the throwing one', async () => {
    const { appendEntry, acquireAppendLock, releaseAppendLock } = await loadWithFsSpy({ failFsyncOn: () => true })
    const file = join(scratch(), 'aura.jsonl')
    const lockPath = `${file}.lock`
    const lock = acquireAppendLock(file)
    const witness = vi.fn()
    expect(() => appendEntry({ file, lock, fields: { sequence: 1 }, afterAppend: witness })).toThrow(/EIO/u)
    expect(witness).not.toHaveBeenCalled()
    // Still the caller's, so the caller can still close its own critical section.
    expect(existsSync(lockPath)).toBe(true)
    expect(releaseAppendLock(lock)).toEqual({ released: true })
    expect(existsSync(lockPath)).toBe(false)
  })

  it('refuses a handle for another chain file before writing anything', async () => {
    const { acquireAppendLock, releaseAppendLock, appendEntry } = await import('../aukora/aura/record.mjs')
    const root = scratch()
    const file = join(root, 'aura.jsonl')
    const lock = acquireAppendLock(join(root, 'other.jsonl'))
    const witness = vi.fn()
    try {
      expect(() => appendEntry({ file, lock, fields: { sequence: 1 }, afterAppend: witness }))
        .toThrow(/record:lock-handle-invalid/u)
      expect(witness).not.toHaveBeenCalled()
      expect(existsSync(file)).toBe(false)
      expect(existsSync(`${file}.lock`)).toBe(false)
    } finally {
      releaseAppendLock(lock)
    }
  })

  it('refuses a released handle rather than silently acquiring for itself', async () => {
    const { acquireAppendLock, releaseAppendLock, appendEntry } = await import('../aukora/aura/record.mjs')
    const file = join(scratch(), 'aura.jsonl')
    const lock = acquireAppendLock(file)
    expect(releaseAppendLock(lock)).toEqual({ released: true })
    expect(() => appendEntry({ file, lock, fields: { sequence: 1 } })).toThrow(/record:lock-handle-invalid/u)
    expect(existsSync(file)).toBe(false)
    expect(existsSync(`${file}.lock`)).toBe(false)
  })

  it('will not unlink a lock path that is no longer the file it holds', async () => {
    const { acquireAppendLock, releaseAppendLock } = await import('../aukora/aura/record.mjs')
    const file = join(scratch(), 'aura.jsonl')
    const lockPath = `${file}.lock`
    const lock = acquireAppendLock(file)
    unlinkSync(lockPath)
    const replacement = openSync(lockPath, 'wx')
    const replacementIno = statSync(lockPath).ino
    try {
      expect(releaseAppendLock(lock)).toEqual({ released: false, reason: 'record:lock-replaced' })
      // Someone else's live lock survives untouched.
      expect(existsSync(lockPath)).toBe(true)
      expect(statSync(lockPath).ino).toBe(replacementIno)
    } finally {
      closeSync(replacement)
      unlinkSync(lockPath)
    }
  })

  it('is total: a second release and an unremovable lock both refuse instead of throwing', async () => {
    const { acquireAppendLock, releaseAppendLock } = await import('../aukora/aura/record.mjs')
    const root = scratch()
    const file = join(root, 'aura.jsonl')
    const once = acquireAppendLock(file)
    expect(releaseAppendLock(once)).toEqual({ released: true })
    expect(releaseAppendLock(once)).toEqual({ released: false, reason: 'record:lock-handle-invalid' })

    // A release that cannot unlink must not throw: it runs in a finally on a
    // path whose verdict is already decided, and a throw would rewrite it.
    const stuck = acquireAppendLock(file)
    chmodSync(root, 0o500)
    try {
      const outcome = releaseAppendLock(stuck)
      expect(outcome.released).toBe(false)
      expect(existsSync(`${file}.lock`)).toBe(true)
    } finally {
      chmodSync(root, 0o700)
    }
  })
})
