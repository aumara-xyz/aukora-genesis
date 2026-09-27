/** Mixed-effect Aura readers; fixture rows exercise reconstruction, not authorization. */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appendEntry, readVerifiedChain } from '../aukora/aura/record.mjs'
import { definitionDigest, MEMORY_PUT, WORKSPACE_PATCH } from '../aukora/broker/effect-definition.mjs'
import { memoryPut, rebuildIndex } from '../aukora/broker/effect.mjs'
import { readBrokerKiraRecall } from '../aukora/broker/kira-recall.mjs'
import { stageKiraMemoryRecord } from '../aukora/kira/stage.mjs'

const roots: string[] = []
const subject = 'aumlok:subject:mixed-effect-owner'
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aukora-mixed-memory-'))
  roots.push(root)
  const stateDir = join(root, 'state')
  mkdirSync(stateDir)
  let sequence = 0
  const append = (fields: Record<string, unknown>) => {
    sequence += 1
    const written = appendEntry({
      file: join(stateDir, 'aura.jsonl'),
      fields: { verdict: 'settled', sequence, ...fields },
    })
    writeFileSync(join(stateDir, 'seq'), String(sequence))
    return { ...written, sequence }
  }
  const recall = () => readBrokerKiraRecall(stateDir, { subject, permittedPrivacy: ['private'] })
  return { root, stateDir, append, recall }
}

function memory(base: ReturnType<typeof fixture>, content: string) {
  const staged = stageKiraMemoryRecord({
    subject, kind: 'observation', source: [], content, links: [],
    privacy: 'private', createdAt: '2026-09-06T00:00:00Z',
  })
  const evidence = memoryPut(base.stateDir, staged.memoryPut)
  const entry = base.append({ key: staged.recordId, ...evidence })
  return { staged, evidence, entry }
}

function workspaceFields(base: ReturnType<typeof fixture>): Record<string, unknown> {
  return {
    toolName: WORKSPACE_PATCH,
    definitionId: definitionDigest(WORKSPACE_PATCH),
    workspace: 'source', relativePath: 'src/answer.txt', beforeSha256: null,
    path: join(base.root, 'workspace', 'src', 'answer.txt'),
    bytes: 7, contentSha256: digest('answer\n'), inode: 1, mtimeNs: '1',
  }
}

describe('memory readers over mixed-effect Aura history', () => {
  it('rebuilds and recalls memory while preserving global citation sequence and head', () => {
    const base = fixture()
    const first = memory(base, 'first memory')
    base.append(workspaceFields(base))
    const second = memory(base, 'second memory')
    const latest = base.append({ ...workspaceFields(base), beforeSha256: digest('before\n') })

    expect(rebuildIndex(base.stateDir)).toEqual({ ok: true, projections: 2 })
    expect(readdirSync(join(base.stateDir, 'memory', 'keys')).sort()).toEqual([
      `${first.staged.recordId}.json`, `${second.staged.recordId}.json`,
    ].sort())
    const recalled = base.recall()
    expect(recalled.result.status).toBe('found')
    expect(recalled.citations).toHaveLength(2)
    for (const expected of [first, second]) {
      expect(recalled.citations.find(citation => citation.recordId === expected.staged.recordId)).toEqual({
        recordId: expected.staged.recordId,
        contentSha256: expected.evidence.contentSha256,
        auraSequence: expected.entry.sequence,
        auraEntryHash: expected.entry.hash,
        verifiedHead: latest.hash,
      })
    }
    const chain = readVerifiedChain(join(base.stateDir, 'aura.jsonl'))
    expect(chain).toMatchObject({ ok: true, count: 4, lastChainHash: latest.hash })
  })

  it('returns empty for a workspace-only history without creating memory objects', () => {
    const base = fixture()
    base.append(workspaceFields(base))
    expect(base.recall()).toMatchObject({ result: { status: 'empty' }, citations: [] })
    expect(existsSync(join(base.stateDir, 'memory'))).toBe(false)
    expect(rebuildIndex(base.stateDir)).toEqual({ ok: true, projections: 0 })
    expect(existsSync(join(base.stateDir, 'memory', 'objects'))).toBe(false)
    expect(base.recall()).toMatchObject({ result: { status: 'empty' }, citations: [] })
  })

  it.each([
    ['unknown tool', { toolName: 'shell.exec' }, 'unknown effect'],
    ['missing workspace', { workspace: undefined }, 'malformed workspace settlement'],
    ['wrong definition', { definitionId: '0'.repeat(64) }, 'malformed workspace settlement'],
    ['escaped relative path', { relativePath: '../answer.txt' }, 'malformed workspace settlement'],
    ['wrong absolute path', { path: '/other/answer.txt' }, 'malformed workspace settlement'],
    ['missing precondition', { beforeSha256: undefined }, 'malformed workspace settlement'],
    ['memory-key rider', { key: 'fake-memory-key' }, 'malformed workspace settlement'],
    ['non-settlement', { verdict: 'refused' }, 'malformed workspace settlement'],
  ] as const)('refuses %s without changing existing memory projections', (_label, mutation, reason) => {
    const base = fixture()
    const saved = memory(base, 'keep this memory')
    const projection = join(base.stateDir, 'memory', 'keys', `${saved.staged.recordId}.json`)
    const before = readFileSync(projection)
    base.append({ ...workspaceFields(base), ...mutation })

    expect(base.recall()).toMatchObject({
      result: { status: 'undetermined', reason: 'memory-unverified' }, citations: [],
    })
    expect(rebuildIndex(base.stateDir)).toEqual({
      ok: false, reason: `rebuild: memory-entries: ${reason} at entry 2`,
    })
    expect(readFileSync(projection)).toEqual(before)
  })

  it('verifies workspace rows in the full chain before selecting memory entries', () => {
    const base = fixture()
    const saved = memory(base, 'retained memory')
    base.append(workspaceFields(base))
    const path = join(base.stateDir, 'aura.jsonl')
    const original = readFileSync(path, 'utf8')
    const changed = original.replace('"workspace":"source"', '"workspace":"forged"')
    expect(changed).not.toBe(original)
    writeFileSync(path, changed)

    expect(base.recall()).toMatchObject({
      result: { status: 'undetermined', reason: 'memory-unverified' }, citations: [],
    })
    expect(rebuildIndex(base.stateDir)).toEqual({ ok: false, reason: 'rebuild: aura invalid (record:tampered)' })
    expect(existsSync(join(base.stateDir, 'memory', 'keys', `${saved.staged.recordId}.json`))).toBe(true)

    writeFileSync(path, original)
    expect(base.recall().result.status).toBe('found')
    expect(rebuildIndex(base.stateDir)).toEqual({ ok: true, projections: 1 })
  })

  it('does not let a workspace row account for an unrecorded memory object', () => {
    const base = fixture()
    const evidence = memoryPut(base.stateDir, { key: 'unrecorded', value: 'not memory-settled' })
    base.append({ ...workspaceFields(base), contentSha256: evidence.contentSha256 })

    expect(base.recall()).toMatchObject({
      result: { status: 'undetermined', reason: 'memory-unverified' }, citations: [],
    })
    expect(rebuildIndex(base.stateDir)).toMatchObject({ ok: false })
    expect(readFileSync(evidence.path, 'utf8')).toContain('not memory-settled')
  })

  it('accepts explicit memory identities and rejects a substituted definition', () => {
    const base = fixture()
    const saved = memory(base, 'typed memory')
    base.append({
      toolName: MEMORY_PUT, definitionId: definitionDigest(MEMORY_PUT),
      key: saved.staged.recordId, ...saved.evidence,
    })
    expect(base.recall().result.status).toBe('found')
    expect(rebuildIndex(base.stateDir)).toEqual({ ok: true, projections: 2 })

    base.append({
      toolName: MEMORY_PUT, definitionId: definitionDigest(WORKSPACE_PATCH),
      key: saved.staged.recordId, ...saved.evidence,
    })
    expect(base.recall()).toMatchObject({
      result: { status: 'undetermined', reason: 'memory-unverified' }, citations: [],
    })
    expect(rebuildIndex(base.stateDir)).toEqual({
      ok: false, reason: 'rebuild: memory-entries: definition mismatch at entry 3',
    })
  })
})
