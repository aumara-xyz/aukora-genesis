import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { rebuildIndex } from '../../../../aukora/broker/effect.mjs'
import { appendEntry, compareObjectInventory } from '../../../../aukora/aura/record.mjs'

interface ObjectFixture {
  body: string
  contentSha256: string
  name: string
  path: string
}

function objectFixture(stateDir: string, key: string, value: unknown): ObjectFixture {
  const body = `${JSON.stringify({ key, value })}\n`
  const contentSha256 = createHash('sha256').update(body).digest('hex')
  const objectsDir = join(stateDir, 'memory', 'objects')
  mkdirSync(objectsDir, { recursive: true })
  const name = `${contentSha256}.json`
  const path = join(objectsDir, name)
  writeFileSync(path, body)
  return { body, contentSha256, name, path }
}

function withState(run: (stateDir: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'aukora-object-reconciliation-'))
  try {
    run(join(root, 'state'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function writeRecord(stateDir: string, entries: Array<Record<string, unknown>>): void {
  mkdirSync(stateDir, { recursive: true })
  const file = join(stateDir, 'aura.jsonl')
  if (entries.length === 0) writeFileSync(file, '')
  else for (const fields of entries) appendEntry({ file, fields })
}

describe('Aura object reconciliation', () => {
  it('does not reinterpret a missing Aura file as an authenticated empty history', () => {
    withState((stateDir) => {
      const keysDir = join(stateDir, 'memory', 'keys')
      const sentinel = join(keysDir, 'sentinel.json')
      mkdirSync(keysDir, { recursive: true })
      writeFileSync(sentinel, 'keep\n')

      expect(rebuildIndex(stateDir)).toEqual({
        ok: false,
        reason: 'rebuild: aura invalid (record:truncated)',
      })
      expect(readFileSync(sentinel, 'utf8')).toBe('keep\n')
    })
  })

  it('returns a named refusal for a valid JSON value that is not a record entry', () => {
    withState((stateDir) => {
      const keysDir = join(stateDir, 'memory', 'keys')
      const sentinel = join(keysDir, 'sentinel.json')
      mkdirSync(keysDir, { recursive: true })
      mkdirSync(stateDir, { recursive: true })
      writeFileSync(join(stateDir, 'aura.jsonl'), 'null\n')
      writeFileSync(sentinel, 'keep\n')

      expect(rebuildIndex(stateDir)).toEqual({
        ok: false,
        reason: 'rebuild: aura invalid (record:unparseable)',
      })
      expect(readFileSync(sentinel, 'utf8')).toBe('keep\n')
    })
  })

  it('returns a named refusal when the Aura path is not a regular file', () => {
    withState((stateDir) => {
      const keysDir = join(stateDir, 'memory', 'keys')
      const sentinel = join(keysDir, 'sentinel.json')
      mkdirSync(join(stateDir, 'aura.jsonl'), { recursive: true })
      mkdirSync(keysDir, { recursive: true })
      writeFileSync(sentinel, 'keep\n')

      expect(rebuildIndex(stateDir)).toEqual({
        ok: false,
        reason: 'rebuild: aura invalid (record:unavailable)',
      })
      expect(readFileSync(sentinel, 'utf8')).toBe('keep\n')
    })
  })

  it.skipIf(process.platform === 'win32')('does not follow a symbolic-link Aura path', () => {
    withState((stateDir) => {
      const target = join(stateDir, 'actual-aura.jsonl')
      const auraPath = join(stateDir, 'aura.jsonl')
      const keysDir = join(stateDir, 'memory', 'keys')
      const sentinel = join(keysDir, 'sentinel.json')
      mkdirSync(keysDir, { recursive: true })
      writeFileSync(target, '')
      symlinkSync(target, auraPath)
      writeFileSync(sentinel, 'keep\n')

      expect(rebuildIndex(stateDir)).toEqual({
        ok: false,
        reason: 'rebuild: aura invalid (record:unavailable)',
      })
      expect(readFileSync(sentinel, 'utf8')).toBe('keep\n')
    })
  })

  it('accepts an empty record when the object directory is absent', () => {
    withState((stateDir) => {
      writeRecord(stateDir, [])
      expect(compareObjectInventory(stateDir, [])).toEqual({ ok: true })
      expect(rebuildIndex(stateDir)).toEqual({ ok: true, projections: 0 })
      expect(existsSync(join(stateDir, 'memory', 'keys'))).toBe(true)
    })
  })

  it('reconstructs projections when every object is recorded', () => {
    withState((stateDir) => {
      const recorded = objectFixture(stateDir, 'alpha', 'recorded')
      const keysDir = join(stateDir, 'memory', 'keys')
      mkdirSync(keysDir, { recursive: true })
      writeFileSync(join(keysDir, 'stale.json'), 'stale\n')
      const entries = [{ key: 'alpha', contentSha256: recorded.contentSha256, path: recorded.path }]
      writeRecord(stateDir, entries)

      expect(compareObjectInventory(stateDir, entries)).toEqual({ ok: true })
      expect(rebuildIndex(stateDir)).toEqual({ ok: true, projections: 1 })
      expect(existsSync(join(keysDir, 'stale.json'))).toBe(false)
      expect(readFileSync(join(keysDir, 'alpha.json'), 'utf8')).toBe(
        `${JSON.stringify({ key: 'alpha', contentSha256: recorded.contentSha256 })}\n`,
      )
    })
  })

  it('refuses a correctly named object whose bytes do not match its digest', () => {
    withState((stateDir) => {
      const recorded = objectFixture(stateDir, 'alpha', 'recorded')
      writeFileSync(recorded.path, 'wrong bytes under the recorded digest name\n')
      const keysDir = join(stateDir, 'memory', 'keys')
      const sentinel = join(keysDir, 'sentinel.json')
      mkdirSync(keysDir, { recursive: true })
      writeFileSync(sentinel, 'keep\n')
      const entries = [{ key: 'alpha', contentSha256: recorded.contentSha256, path: recorded.path }]
      writeRecord(stateDir, entries)

      expect(compareObjectInventory(stateDir, entries)).toEqual({
        ok: false,
        reason: `object-inventory: content mismatch ${JSON.stringify([recorded.name])}`,
      })
      expect(rebuildIndex(stateDir)).toEqual({
        ok: false,
        reason: `rebuild: object-inventory: content mismatch ${JSON.stringify([recorded.name])}`,
      })
      expect(readFileSync(sentinel, 'utf8')).toBe('keep\n')
      expect(readFileSync(recorded.path, 'utf8')).toBe('wrong bytes under the recorded digest name\n')
    })
  })

  it('reports an unrecorded object before changing projections', () => {
    withState((stateDir) => {
      const recorded = objectFixture(stateDir, 'alpha', 'recorded')
      const orphan = objectFixture(stateDir, 'orphan', 'unrecorded')
      const keysDir = join(stateDir, 'memory', 'keys')
      const sentinel = join(keysDir, 'sentinel.json')
      mkdirSync(keysDir, { recursive: true })
      writeFileSync(sentinel, 'keep\n')
      const entries = [{ key: 'alpha', contentSha256: recorded.contentSha256, path: recorded.path }]
      writeRecord(stateDir, entries)

      expect(compareObjectInventory(stateDir, entries)).toEqual({
        ok: false,
        reason: `object-inventory: mismatch ${JSON.stringify({ missing: [], unrecorded: [orphan.name] })}`,
      })
      expect(rebuildIndex(stateDir)).toEqual({
        ok: false,
        reason: `rebuild: object-inventory: mismatch ${JSON.stringify({ missing: [], unrecorded: [orphan.name] })}`,
      })
      expect(readFileSync(sentinel, 'utf8')).toBe('keep\n')
      expect(existsSync(orphan.path)).toBe(true)
    })
  })

  it('refuses a non-file object entry even when its name is recorded', () => {
    withState((stateDir) => {
      const recorded = objectFixture(stateDir, 'alpha', 'recorded')
      rmSync(recorded.path)
      mkdirSync(recorded.path)
      const keysDir = join(stateDir, 'memory', 'keys')
      const sentinel = join(keysDir, 'sentinel.json')
      mkdirSync(keysDir, { recursive: true })
      writeFileSync(sentinel, 'keep\n')
      const entries = [{ key: 'alpha', contentSha256: recorded.contentSha256, path: recorded.path }]
      writeRecord(stateDir, entries)

      expect(compareObjectInventory(stateDir, entries)).toEqual({
        ok: false,
        reason: `object-inventory: mismatch ${JSON.stringify({ missing: [recorded.name], unrecorded: [recorded.name] })}`,
      })
      expect(rebuildIndex(stateDir)).toEqual({
        ok: false,
        reason: `rebuild: object-inventory: mismatch ${JSON.stringify({ missing: [recorded.name], unrecorded: [recorded.name] })}`,
      })
      expect(readFileSync(sentinel, 'utf8')).toBe('keep\n')
      expect(existsSync(recorded.path)).toBe(true)
    })
  })

  it('does not let a malformed record digest legitimize a same-named object', () => {
    withState((stateDir) => {
      const objectsDir = join(stateDir, 'memory', 'objects')
      const malformedName = 'not-a-digest.json'
      mkdirSync(objectsDir, { recursive: true })
      writeFileSync(join(objectsDir, malformedName), 'unrecorded\n')
      const keysDir = join(stateDir, 'memory', 'keys')
      const sentinel = join(keysDir, 'sentinel.json')
      mkdirSync(keysDir, { recursive: true })
      writeFileSync(sentinel, 'keep\n')
      const entries = [{ key: 'alpha', contentSha256: 'not-a-digest', path: join(objectsDir, malformedName) }]
      writeRecord(stateDir, entries)

      expect(compareObjectInventory(stateDir, entries)).toEqual({
        ok: false,
        reason: 'object-inventory: invalid content digest at entry 1',
      })
      expect(rebuildIndex(stateDir)).toEqual({
        ok: false,
        reason: 'rebuild: object-inventory: invalid content digest at entry 1',
      })
      expect(readFileSync(sentinel, 'utf8')).toBe('keep\n')
      expect(readFileSync(join(objectsDir, malformedName), 'utf8')).toBe('unrecorded\n')
    })
  })

  it('refuses a nonempty record when the object directory is absent', () => {
    withState((stateDir) => {
      const contentSha256 = 'a'.repeat(64)
      const keysDir = join(stateDir, 'memory', 'keys')
      const sentinel = join(keysDir, 'sentinel.json')
      mkdirSync(keysDir, { recursive: true })
      writeFileSync(sentinel, 'keep\n')
      const entries = [{ key: 'alpha', contentSha256 }]
      const missing = [`${contentSha256}.json`]

      expect(compareObjectInventory(stateDir, [{ key: 'alpha', contentSha256: 'not-a-digest' }])).toEqual({
        ok: false,
        reason: 'object-inventory: invalid content digest at entry 1',
      })
      writeRecord(stateDir, [{ key: 'alpha', contentSha256: 'not-a-digest' }])
      expect(rebuildIndex(stateDir)).toEqual({
        ok: false,
        reason: 'rebuild: object-inventory: invalid content digest at entry 1',
      })
      expect(readFileSync(sentinel, 'utf8')).toBe('keep\n')

      rmSync(join(stateDir, 'aura.jsonl'))
      writeRecord(stateDir, entries)

      expect(compareObjectInventory(stateDir, entries)).toEqual({
        ok: false,
        reason: `object-inventory: mismatch ${JSON.stringify({ missing, unrecorded: [] })}`,
      })
      expect(rebuildIndex(stateDir)).toEqual({
        ok: false,
        reason: `rebuild: object-inventory: mismatch ${JSON.stringify({ missing, unrecorded: [] })}`,
      })
      expect(readFileSync(sentinel, 'utf8')).toBe('keep\n')
    })
  })

  it('validates every key before deleting the existing projection', () => {
    withState((stateDir) => {
      const first = objectFixture(stateDir, 'alpha', 'recorded')
      const second = objectFixture(stateDir, 'beta', 'recorded')
      const keysDir = join(stateDir, 'memory', 'keys')
      const sentinel = join(keysDir, 'sentinel.json')
      mkdirSync(keysDir, { recursive: true })
      writeFileSync(sentinel, 'keep\n')
      const entries = [
        { key: 'alpha', contentSha256: first.contentSha256 },
        { key: '../escape', contentSha256: second.contentSha256 },
      ]
      writeRecord(stateDir, entries)

      expect(rebuildIndex(stateDir)).toEqual({
        ok: false,
        reason: 'rebuild: entry key is not a name at index 2: "../escape"',
      })
      expect(readFileSync(sentinel, 'utf8')).toBe('keep\n')
      expect(existsSync(join(keysDir, 'alpha.json'))).toBe(false)
    })
  })

  it('returns a named refusal when the objects path is not a directory', () => {
    withState((stateDir) => {
      const objectsPath = join(stateDir, 'memory', 'objects')
      const keysDir = join(stateDir, 'memory', 'keys')
      const sentinel = join(keysDir, 'sentinel.json')
      mkdirSync(join(stateDir, 'memory'), { recursive: true })
      writeFileSync(objectsPath, 'not a directory\n')
      mkdirSync(keysDir, { recursive: true })
      writeFileSync(sentinel, 'keep\n')
      writeRecord(stateDir, [])

      expect(rebuildIndex(stateDir)).toEqual({
        ok: false,
        reason: 'rebuild: object-inventory: unavailable (objects path is not a directory)',
      })
      expect(readFileSync(objectsPath, 'utf8')).toBe('not a directory\n')
      expect(readFileSync(sentinel, 'utf8')).toBe('keep\n')
    })
  })
})
