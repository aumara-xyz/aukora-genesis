/**
 * The KIRA memory artifact verifier court judges the verifier against evidence
 * a real governed settlement actually produced.
 *
 * Every row starts from one genuine artifact written by
 * `scripts/aukora-verified-memory-demo.mjs`, which drives a real broker
 * process, a real issuer daemon, the broker-owned proposal route, and the
 * parent review. The human decisions in that run are SIMULATED and labeled
 * there; nothing on the authority path is stubbed. Mutations are applied to
 * copies of that artifact, so a red row measures the verifier against evidence
 * of the same kind it will meet in production.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { entryHash } from '@aukora/core/aura/record.mjs'
import { stageKiraMemoryRecord } from '@aukora/core/kira/stage.mjs'
import {
  KIRA_MEMORY_ARTIFACT_CHECKS,
  KIRA_MEMORY_ARTIFACT_REFUSE,
  type KiraMemoryArtifactResult,
  verifyKiraMemoryArtifact,
} from '@aukora/core/verifier/kira-memory-artifact-verifier.mjs'

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const DEMO_ENTRY = join(REPO_ROOT, 'scripts', 'aukora-verified-memory-demo.mjs')
const VERIFIER_BIN = join(REPO_ROOT, 'aukora', 'verifier', 'kira-memory-artifact-verifier-bin.mjs')
const NAMED_REFUSALS = new Set(Object.values(KIRA_MEMORY_ARTIFACT_REFUSE))

interface KiraRecord {
  recordId: string
  subject: string
  kind: string
  content: { note: string }
  [field: string]: unknown
}

interface Artifact {
  kind: string
  record: KiraRecord
  memoryPut: { key: string; value: KiraRecord }
  object: { name: string; body: string }
  projection: { key: string; contentSha256: string }
  aura: string
  head: string
  recall: {
    query: { subject: string; kind?: string }
    status: string
    records?: KiraRecord[]
    reason?: string
  }
}

let temporaryDirectory: string
let artifactPath: string
let genuineText: string
let trustedHead: string

/** A fresh mutable copy of the genuine artifact. */
function clone(): Artifact {
  return JSON.parse(genuineText) as Artifact
}

/** The Aura chain as parsed entries, newest last. */
function chainEntries(artifact: Artifact): Array<Record<string, unknown>> {
  return artifact.aura.split('\n').filter(line => line !== '').map(line => JSON.parse(line) as Record<string, unknown>)
}

/** Re-serialize entries into the exact `aura.jsonl` text, terminal newline included. */
function chainText(entries: ReadonlyArray<Record<string, unknown>>): string {
  return entries.map(entry => JSON.stringify(entry)).join('\n') + '\n'
}

beforeAll(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'aukora-kira-memory-artifact-verifier-'))
  artifactPath = join(temporaryDirectory, 'artifact.json')
  const summary = execFileSync(process.execPath, [DEMO_ENTRY, '--out', artifactPath], { encoding: 'utf8' })
  trustedHead = (JSON.parse(summary) as { head: string }).head
  genuineText = readFileSync(artifactPath, 'utf8')
}, 180_000)

afterAll(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('KIRA memory artifact verifier', () => {
  it('verifies an artifact a real governed settlement produced', () => {
    const verdict = verifyKiraMemoryArtifact(clone(), { trustedHead })

    expect(verdict.ok).toBe(true)
    expect(verdict.checks.map(row => row.check)).toEqual([...KIRA_MEMORY_ARTIFACT_CHECKS])
    expect(verdict.checks.every(row => row.ok)).toBe(true)
    expect(verdict.ceiling.length).toBeGreaterThan(0)
  })

  it('names its ceiling in every verdict rather than in prose somewhere else', () => {
    const passing = verifyKiraMemoryArtifact(clone(), { trustedHead })
    const refusing = verifyKiraMemoryArtifact(clone(), { trustedHead: 'f'.repeat(64) })

    expect(passing.ceiling).toEqual(refusing.ceiling)
    expect(passing.ceiling.some(limit => limit.startsWith('no signature is checked'))).toBe(true)
    expect(passing.ceiling.some(limit => limit.startsWith('no latestness is proven'))).toBe(true)
    expect(passing.ceiling.some(limit => limit.startsWith('no protection against a coherent same-uid rewrite'))).toBe(true)
  })

  it('refuses a tampered record with the recordId reason', () => {
    const artifact = clone()
    artifact.record.content.note = 'a note the recordId was never computed over'

    const verdict = verifyKiraMemoryArtifact(artifact, { trustedHead })

    expect(verdict).toMatchObject({ ok: false, failed: KIRA_MEMORY_ARTIFACT_REFUSE.RECORD_IDENTITY_MISMATCH })
    expect(verdict.checks.find(row => row.check === 'record-identity')).toMatchObject({
      ok: false,
      reason: KIRA_MEMORY_ARTIFACT_REFUSE.RECORD_IDENTITY_MISMATCH,
    })
  })

  it('refuses a record whose stored bytes no longer carry the claimed record', () => {
    const artifact = clone()
    const stored = JSON.parse(artifact.object.body) as { key: string; value: KiraRecord }
    stored.value.content.note = 'rewritten in the object store'
    artifact.object.body = `${JSON.stringify(stored)}\n`

    const verdict = verifyKiraMemoryArtifact(artifact, { trustedHead })

    expect(verdict).toMatchObject({ ok: false, failed: KIRA_MEMORY_ARTIFACT_REFUSE.OBJECT_BODY_MISMATCH })
  })

  it('refuses a tampered Aura line with the chain reason', () => {
    const artifact = clone()
    const entries = chainEntries(artifact)
    entries[0]!.key = `kira:${'f'.repeat(64)}`
    artifact.aura = chainText(entries)

    const verdict = verifyKiraMemoryArtifact(artifact, { trustedHead })

    expect(verdict).toMatchObject({ ok: false, failed: KIRA_MEMORY_ARTIFACT_REFUSE.CHAIN_TAMPERED })
    expect(verdict.checks.find(row => row.check === 'chain')).toMatchObject({ ok: false })
  })

  it('refuses a canonical Aura line carrying the writer-impossible domain field', () => {
    const artifact = clone()
    const first = chainEntries(artifact)[0]!
    const { hash: _hash, prev, ...fields } = first
    fields.domain = 'chosen by an attacker'
    const forged = { hash: entryHash(prev as string, fields), prev, ...fields }
    artifact.aura = chainText([forged])
    artifact.head = forged.hash

    // entryHash overwrites the hostile domain with its separator, so the
    // reader must enforce the writer's reserved-field predicate explicitly.
    expect(verifyKiraMemoryArtifact(artifact, { trustedHead: forged.hash })).toMatchObject({
      ok: false,
      failed: KIRA_MEMORY_ARTIFACT_REFUSE.CHAIN_RESERVED_FIELD,
    })
  })

  it('refuses an Aura line whose duplicate key hides a decoy from the hash', () => {
    const artifact = clone()
    const [genuine, ...rest] = artifact.aura.split('\n').filter(line => line !== '')
    const decoyed = genuine!
      .replace('"verdict":"settled"', '"verdict":"refused","verdict":"settled"')
      .replace(`"key":${JSON.stringify(artifact.memoryPut.key)}`,
        `"key":"kira:${'0'.repeat(64)}","key":${JSON.stringify(artifact.memoryPut.key)}`)
    // The fixture must exercise the hole, or this row proves nothing: the
    // decoys are what a human or first-wins reader sees, and JSON.parse keeps
    // the last of two duplicate keys, so every hashed check reads past them.
    expect(decoyed).not.toBe(genuine)
    expect(/"verdict":"([^"]*)"/.exec(decoyed)?.[1]).toBe('refused')
    const collapsed = JSON.parse(decoyed) as { verdict: string; key: string }
    expect([collapsed.verdict, collapsed.key]).toEqual(['settled', artifact.memoryPut.key])
    artifact.aura = [decoyed, ...rest].join('\n') + '\n'

    const verdict = verifyKiraMemoryArtifact(artifact, { trustedHead })

    expect(verdict).toMatchObject({ ok: false, failed: KIRA_MEMORY_ARTIFACT_REFUSE.CHAIN_NOT_CANONICAL })
    expect(verdict.checks.find(row => row.check === 'chain')).toMatchObject({
      ok: false,
      reason: KIRA_MEMORY_ARTIFACT_REFUSE.CHAIN_NOT_CANONICAL,
    })
  })

  // One predicate covers every divergence between what a line says and what its
  // hash covers, because the producer emits each line as one JSON.stringify.
  it.each([
    ['padding the parser discards', (line: string) => line.replace('"verdict":"settled"', '"verdict": "settled"')],
    ['a number that is not its own shortest form', (line: string) => line.replace(/"bytes":(\d+)/, '"bytes":$1.0')],
    ['an integer beyond the safe range', (line: string) => line.replace(/"bytes":\d+/, '"bytes":9007199254740993')],
    ['an escape the parser folds away', (line: string) => line.replace('"settled"', '"settle\\u0064"')],
  ])('refuses an Aura line carrying %s', (_label, mutate) => {
    const artifact = clone()
    const [genuine, ...rest] = artifact.aura.split('\n').filter(line => line !== '')
    const rewritten = mutate(genuine!)
    expect(rewritten).not.toBe(genuine)
    artifact.aura = [rewritten, ...rest].join('\n') + '\n'

    expect(verifyKiraMemoryArtifact(artifact, { trustedHead })).toMatchObject({
      ok: false,
      failed: KIRA_MEMORY_ARTIFACT_REFUSE.CHAIN_NOT_CANONICAL,
    })
  })

  it('refuses a chain whose last line was cut short', () => {
    const artifact = clone()
    artifact.aura = artifact.aura.trimEnd()

    expect(verifyKiraMemoryArtifact(artifact, { trustedHead })).toMatchObject({
      ok: false,
      failed: KIRA_MEMORY_ARTIFACT_REFUSE.CHAIN_TRUNCATED,
    })
  })

  it.each([
    ['before the first entry', (aura: string) => `\n${aura}`, 1],
    ['after the last entry', (aura: string) => `${aura}\n`, 2],
  ])('refuses a blank Aura line %s', (_label, mutate, line) => {
    const artifact = clone()
    artifact.aura = mutate(artifact.aura)

    const verdict = verifyKiraMemoryArtifact(artifact, { trustedHead })

    expect(verdict).toMatchObject({
      ok: false,
      failed: KIRA_MEMORY_ARTIFACT_REFUSE.CHAIN_NOT_CANONICAL,
    })
    expect(verdict.checks.find(row => row.check === 'chain')).toMatchObject({
      ok: false,
      reason: KIRA_MEMORY_ARTIFACT_REFUSE.CHAIN_NOT_CANONICAL,
      detail: `chain breaks at line ${line} of the supplied aura.jsonl`,
    })
  })

  it('refuses a wrong trusted head with the head reason', () => {
    const verdict = verifyKiraMemoryArtifact(clone(), { trustedHead: '0'.repeat(64) })

    expect(verdict).toMatchObject({ ok: false, failed: KIRA_MEMORY_ARTIFACT_REFUSE.HEAD_MISMATCH })
    expect(verdict.checks.find(row => row.check === 'chain')).toMatchObject({ ok: true })
  })

  it('requires the trusted head rather than accepting a self-consistent artifact', () => {
    expect(verifyKiraMemoryArtifact(clone(), {})).toMatchObject({
      ok: false,
      failed: KIRA_MEMORY_ARTIFACT_REFUSE.TRUSTED_HEAD_MISSING,
    })
    expect(verifyKiraMemoryArtifact(clone(), { trustedHead: 'not-a-digest' })).toMatchObject({
      ok: false,
      failed: KIRA_MEMORY_ARTIFACT_REFUSE.TRUSTED_HEAD_NOT_HEX,
    })
  })

  it.each([
    ['memoryPut', (artifact: Artifact) => { Object.assign(artifact.memoryPut, { ignored: true }) }],
    ['object', (artifact: Artifact) => { Object.assign(artifact.object, { ignored: true }) }],
    ['projection', (artifact: Artifact) => { Object.assign(artifact.projection, { ignored: true }) }],
    ['recall', (artifact: Artifact) => { Object.assign(artifact.recall, { ignored: true }) }],
    ['a found recall reason', (artifact: Artifact) => { Object.assign(artifact.recall, { reason: 'memory-unverified' }) }],
    ['an undetermined recall record list', (artifact: Artifact) => {
      artifact.recall = {
        query: { subject: artifact.record.subject },
        status: 'undetermined',
        reason: 'memory-unverified',
        records: [artifact.record],
      }
    }],
    ['an empty recall reason', (artifact: Artifact) => {
      artifact.recall = {
        query: { subject: 'somebody-else' },
        status: 'empty',
        reason: 'memory-unverified',
      }
    }],
  ])('refuses an ignored field in %s', (_site, mutate) => {
    const artifact = clone()
    mutate(artifact)

    expect(verifyKiraMemoryArtifact(artifact, { trustedHead })).toMatchObject({
      ok: false,
      failed: KIRA_MEMORY_ARTIFACT_REFUSE.ARTIFACT_FIELD_UNKNOWN,
    })
  })

  it('refuses an option field beside the trusted head', () => {
    expect(verifyKiraMemoryArtifact(clone(), { trustedHead, ignored: true })).toMatchObject({
      ok: false,
      failed: KIRA_MEMORY_ARTIFACT_REFUSE.OPTIONS_FIELD_UNKNOWN,
    })
  })

  it('refuses a rider property on the recalled-record array', () => {
    const artifact = clone()
    Object.assign(artifact.recall.records!, { ignored: true })

    expect(verifyKiraMemoryArtifact(artifact, { trustedHead })).toMatchObject({
      ok: false,
      failed: KIRA_MEMORY_ARTIFACT_REFUSE.ARTIFACT_NOT_JSON_DATA,
    })
  })

  it('measures its own ceiling: a coherent rewrite passes against its own head and fails against the retained one', () => {
    const artifact = clone()
    const entries = chainEntries(artifact)
    const first = entries[0]!
    const { hash: _hash, prev, ...fields } = first
    // A filesystem observation is not a function of content: rewriting it and
    // recomputing the chain produces a coherent, self-consistent forgery.
    fields.inode = (fields.inode as number) + 1
    const forged = { hash: entryHash(prev as string, fields), prev, ...fields }
    artifact.aura = chainText([forged])
    artifact.head = forged.hash

    expect(verifyKiraMemoryArtifact(artifact, { trustedHead })).toMatchObject({
      ok: false,
      failed: KIRA_MEMORY_ARTIFACT_REFUSE.HEAD_MISMATCH,
    })
    expect(verifyKiraMemoryArtifact(artifact, { trustedHead: forged.hash }).ok).toBe(true)
  })

  it('refuses a reserved `domain` the digest cannot cover, which the trusted head cannot see', () => {
    // The preimage writes `domain` after the body spread, so a `domain` key on
    // the wire is discarded before hashing. Every hash, every link, and the
    // trusted head stay exactly those of the genuine record: unlike the
    // coherent rewrite above, the attacker never has to choose the delivered
    // head. That is why the anchor alone cannot carry this case.
    const artifact = clone()
    const genuineLine = artifact.aura.split('\n').filter(line => line !== '')[0]!
    const injected = genuineLine.slice(0, -1) + ',"domain":"ATTACKER-CONTROLLED-UNHASHED-DATA"}'
    artifact.aura = injected + '\n'

    // The head is untouched: this artifact still anchors to the genuine head.
    expect((JSON.parse(injected) as { hash: string }).hash).toBe(trustedHead)
    expect(artifact.head).toBe(trustedHead)

    expect(verifyKiraMemoryArtifact(artifact, { trustedHead })).toMatchObject({
      ok: false,
      failed: KIRA_MEMORY_ARTIFACT_REFUSE.CHAIN_RESERVED_FIELD,
    })
  })

  it('control: an ordinary extra field stays covered by the digest', () => {
    // Only the reserved names are uncoverable. Any other rider changes what the
    // hash commits to, so a stale hash refuses as a tamper and the chain grammar
    // keeps accepting caller-chosen fields.
    const artifact = clone()
    const genuineLine = artifact.aura.split('\n').filter(line => line !== '')[0]!
    artifact.aura = genuineLine.slice(0, -1) + ',"rider":"not-reserved"}\n'

    expect(verifyKiraMemoryArtifact(artifact, { trustedHead })).toMatchObject({
      ok: false,
      failed: KIRA_MEMORY_ARTIFACT_REFUSE.CHAIN_TAMPERED,
    })
  })

  it('refuses a settlement entry that does not bind this key and content digest', () => {
    const artifact = clone()
    const entries = chainEntries(artifact)
    const first = entries[0]!
    const { hash: _hash, prev, ...fields } = first
    fields.verdict = 'observed'
    const rewritten = { hash: entryHash(prev as string, fields), prev, ...fields }
    artifact.aura = chainText([rewritten])
    artifact.head = rewritten.hash

    expect(verifyKiraMemoryArtifact(artifact, { trustedHead: rewritten.hash })).toMatchObject({
      ok: false,
      failed: KIRA_MEMORY_ARTIFACT_REFUSE.SETTLEMENT_ABSENT,
    })
  })

  it('refuses a recall that claims found over a record which does not verify', () => {
    const artifact = clone()
    expect(artifact.recall.status).toBe('found')
    artifact.recall.records![0]!.content.note = 'a recall reply the store cannot support'

    const verdict = verifyKiraMemoryArtifact(artifact, { trustedHead })

    expect(verdict).toMatchObject({ ok: false, failed: KIRA_MEMORY_ARTIFACT_REFUSE.RECALL_LIES })
    expect(verdict.checks.find(row => row.check === 'recall-honesty')).toMatchObject({ ok: false })
  })

  it('refuses a found recall that omits the settled record the artifact proves', () => {
    const artifact = clone()
    artifact.recall.records = []

    expect(verifyKiraMemoryArtifact(artifact, { trustedHead })).toMatchObject({
      ok: false,
      failed: KIRA_MEMORY_ARTIFACT_REFUSE.RECALL_LIES,
    })
  })

  it('accepts a found recall that also names a record this artifact carries no evidence about', () => {
    const artifact = clone()
    const other = stageKiraMemoryRecord({
      subject: artifact.record.subject,
      kind: 'observation',
      source: [],
      content: { note: 'another record this artifact does not describe' },
      links: [],
      privacy: 'local',
      createdAt: '2026-08-29T00:00:00Z',
    })
    artifact.recall.records!.push(other.record as unknown as KiraRecord)

    expect(verifyKiraMemoryArtifact(artifact, { trustedHead }).ok).toBe(true)
  })

  it('refuses a found recall naming a record that does not answer its own query', () => {
    const artifact = clone()
    const foreign = stageKiraMemoryRecord({
      subject: 'somebody-else',
      kind: 'observation',
      source: [],
      content: { note: 'a record about a different subject' },
      links: [],
      privacy: 'local',
      createdAt: '2026-08-29T00:00:00Z',
    })
    artifact.recall.records!.push(foreign.record as unknown as KiraRecord)

    expect(verifyKiraMemoryArtifact(artifact, { trustedHead })).toMatchObject({
      ok: false,
      failed: KIRA_MEMORY_ARTIFACT_REFUSE.RECALL_LIES,
    })
  })

  it('refuses a recall that reports empty over a record the artifact itself stores', () => {
    const artifact = clone()
    artifact.recall = { query: { subject: artifact.record.subject }, status: 'empty' }

    expect(verifyKiraMemoryArtifact(artifact, { trustedHead })).toMatchObject({
      ok: false,
      failed: KIRA_MEMORY_ARTIFACT_REFUSE.RECALL_LIES,
    })
  })

  it('accepts an undetermined recall, which under-claims and never over-claims', () => {
    const artifact = clone()
    artifact.recall = { query: { subject: artifact.record.subject }, status: 'undetermined', reason: 'memory-unverified' }

    expect(verifyKiraMemoryArtifact(artifact, { trustedHead }).ok).toBe(true)
  })

  it('requires an undetermined recall to name its reason', () => {
    const artifact = clone()
    artifact.recall = { query: { subject: artifact.record.subject }, status: 'undetermined' }

    expect(verifyKiraMemoryArtifact(artifact, { trustedHead })).toMatchObject({
      ok: false,
      failed: KIRA_MEMORY_ARTIFACT_REFUSE.RECALL_REASON_MISSING,
    })
  })

  it('refuses an undetermined reason outside the broker vocabulary', () => {
    const artifact = clone()
    artifact.recall = { query: { subject: artifact.record.subject }, status: 'undetermined', reason: 'network-timeout' }

    expect(verifyKiraMemoryArtifact(artifact, { trustedHead })).toMatchObject({
      ok: false,
      failed: KIRA_MEMORY_ARTIFACT_REFUSE.RECALL_REASON_UNKNOWN,
    })
  })

  it('returns a named refusal for hostile input instead of throwing', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const throwingGetter = clone() as unknown as Record<string, unknown>
    Object.defineProperty(throwingGetter, 'record', {
      configurable: true,
      enumerable: true,
      get: () => { throw new Error('the artifact must never run caller code') },
    })
    const withUnknownField = clone() as unknown as Record<string, unknown>
    withUnknownField.trustedHead = trustedHead
    const unparseableChain = clone()
    unparseableChain.aura = '{not json}\n'

    const hostile: Array<[string, unknown]> = [
      ['null', null],
      ['undefined', undefined],
      ['a string', 'artifact'],
      ['an array', []],
      ['a revoked-style proxy', new Proxy({}, { get: () => { throw new Error('trap') } })],
      ['a cyclic object', cyclic],
      ['a throwing getter', throwingGetter],
      ['an unknown top-level field', withUnknownField],
      ['an unparseable chain line', unparseableChain],
      ['an object with a custom prototype', Object.create({ inherited: true }) as unknown],
    ]

    for (const [label, input] of hostile) {
      let verdict: KiraMemoryArtifactResult | undefined
      expect(() => { verdict = verifyKiraMemoryArtifact(input, { trustedHead }) }, label).not.toThrow()
      expect(verdict?.ok, label).toBe(false)
      expect(
        verdict !== undefined && !verdict.ok && NAMED_REFUSALS.has(verdict.failed),
        `${label} refusal is named`,
      ).toBe(true)
    }
  })

  it('returns a named refusal for hostile options instead of throwing', () => {
    expect(verifyKiraMemoryArtifact(clone(), null)).toMatchObject({
      ok: false,
      failed: KIRA_MEMORY_ARTIFACT_REFUSE.OPTIONS_NOT_PLAIN,
    })
    expect(verifyKiraMemoryArtifact(clone(), { trustedHead: 7 })).toMatchObject({
      ok: false,
      failed: KIRA_MEMORY_ARTIFACT_REFUSE.TRUSTED_HEAD_NOT_HEX,
    })
  })
})

describe('KIRA memory artifact verifier CLI', () => {
  it('exits 0 and prints one verdict line for a genuine artifact', () => {
    const run = spawnSync(process.execPath, [VERIFIER_BIN, artifactPath, '--head', trustedHead], { encoding: 'utf8' })

    expect(run.status).toBe(0)
    expect(run.stdout.split('\n').filter(line => line !== '')).toHaveLength(1)
    expect(JSON.parse(run.stdout) as { ok: boolean }).toMatchObject({ ok: true })
  })

  it('exits 1 with a named refusal for a wrong head, a missing head, and a missing file', () => {
    const wrongHead = spawnSync(process.execPath, [VERIFIER_BIN, artifactPath, '--head', '0'.repeat(64)], { encoding: 'utf8' })
    const noHead = spawnSync(process.execPath, [VERIFIER_BIN, artifactPath], { encoding: 'utf8' })
    const missingFile = spawnSync(process.execPath, [VERIFIER_BIN, join(temporaryDirectory, 'absent.json'), '--head', trustedHead], { encoding: 'utf8' })
    const notJson = join(temporaryDirectory, 'not-json.json')
    writeFileSync(notJson, 'this is not JSON\n')
    const unparseable = spawnSync(process.execPath, [VERIFIER_BIN, notJson, '--head', trustedHead], { encoding: 'utf8' })
    const noArguments = spawnSync(process.execPath, [VERIFIER_BIN], { encoding: 'utf8' })

    expect([wrongHead.status, noHead.status, missingFile.status, unparseable.status, noArguments.status]).toEqual([1, 1, 1, 1, 1])
    expect(JSON.parse(wrongHead.stdout) as { failed: string }).toMatchObject({ failed: KIRA_MEMORY_ARTIFACT_REFUSE.HEAD_MISMATCH })
    expect(JSON.parse(noHead.stdout) as { failed: string }).toMatchObject({ failed: KIRA_MEMORY_ARTIFACT_REFUSE.TRUSTED_HEAD_MISSING })
    expect(JSON.parse(missingFile.stdout) as { failed: string }).toMatchObject({ failed: KIRA_MEMORY_ARTIFACT_REFUSE.ARTIFACT_UNREADABLE })
    expect(JSON.parse(unparseable.stdout) as { failed: string }).toMatchObject({ failed: KIRA_MEMORY_ARTIFACT_REFUSE.ARTIFACT_NOT_JSON })
    expect(JSON.parse(noArguments.stdout) as { failed: string }).toMatchObject({ failed: KIRA_MEMORY_ARTIFACT_REFUSE.USAGE })
  })

  it('exits 1 with the encoding refusal for a duplicate key in the chain', () => {
    const artifact = clone()
    const [genuine, ...rest] = artifact.aura.split('\n').filter(line => line !== '')
    artifact.aura = [genuine!.replace('"verdict":"settled"', '"verdict":"refused","verdict":"settled"'), ...rest].join('\n') + '\n'
    const decoyPath = join(temporaryDirectory, 'decoyed.json')
    writeFileSync(decoyPath, JSON.stringify(artifact))

    const run = spawnSync(process.execPath, [VERIFIER_BIN, decoyPath, '--head', trustedHead], { encoding: 'utf8' })

    expect(run.status).toBe(1)
    expect(JSON.parse(run.stdout) as { failed: string }).toMatchObject({
      failed: KIRA_MEMORY_ARTIFACT_REFUSE.CHAIN_NOT_CANONICAL,
    })
  })

  // JSON.parse makes `__proto__` a real own key, so an artifact file can carry
  // one at any depth. Reading it by assignment would reach the Object.prototype
  // setter and silently drop it, leaving this verifier weaker than the organ it
  // exists to check independently: KIRA refuses such a record as malformed.
  it.each([
    ['the artifact root', (text: string) => text.replace('{', '{"__proto__":"injected",')],
    ['the record', (text: string) => text.replace('"record":{', '"record":{"__proto__":"injected",')],
    ['the record content', (text: string) => text.replace('"content":{', '"content":{"__proto__":"injected",')],
    ['the recall query', (text: string) => text.replace('"query":{', '"query":{"__proto__":"injected",')],
  ])('refuses a __proto__ own key injected into %s', (_site, inject) => {
    const compact = JSON.stringify(clone())
    const injected = inject(compact)
    expect(injected).not.toBe(compact)
    const parsed = JSON.parse(injected) as Artifact

    const verdict = verifyKiraMemoryArtifact(parsed, { trustedHead })

    expect(verdict.ok).toBe(false)
    expect(!verdict.ok && NAMED_REFUSALS.has(verdict.failed)).toBe(true)
  })

  it('reads __proto__ as an own field rather than reaching the prototype setter', () => {
    const compact = JSON.stringify(clone())
    const parsed = JSON.parse(compact.replace('"record":{', '"record":{"__proto__":"injected",')) as Artifact

    // The fixture itself must carry the key, or the row above proves nothing.
    expect(Reflect.ownKeys(parsed.record as object)).toContain('__proto__')
    expect(Object.getPrototypeOf(parsed.record)).toBe(Object.prototype)
  })
})
