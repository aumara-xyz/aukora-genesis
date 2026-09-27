/**
 * Deterministic KIRA memory-record staging and read-only recall.
 *
 * These rows pin the KIRA v0 record contract: digest-is-identity naming,
 * closed-input refusal with named errors, inert governed-memory arguments,
 * and the three-state recall vocabulary. Authorization stays broker-owned;
 * nothing here writes memory.
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { canonicalJSON } from '@aukora/core/kernel-seed/canonical-json.mjs'
import { isExactMemoryPutArgs, KEY_SHAPE } from '@aukora/core/broker/memory-put-args.mjs'
import {
  KIRA_PRIVACY_CLASSES,
  KIRA_RECORD_DOMAIN,
  KIRA_RECORD_ID,
  KIRA_RECORD_KINDS,
  KIRA_STAGE_GRANTS_AUTHORITY,
  KIRA_STAGE_TOOL,
  KiraStageError,
  stageKiraMemoryRecord,
  verifyKiraMemoryRecord,
} from '@aukora/core/kira/stage.mjs'
import {
  KIRA_RECALL_MAX_RECORDS,
  KIRA_RECALL_MAX_RESULT_BYTES,
  KIRA_RECALL_MAX_SUBJECT_BYTES,
  KIRA_RECALL_STATES,
  KIRA_RECALL_UNDETERMINED_REASONS,
  KiraRecallError,
  kiraRecordContentSha256,
  recallKiraMemoryRecords,
} from '@aukora/core/kira/recall.mjs'

const VECTOR_ID = 'kira:1962a3d683824f80851275fa01055054edc90cabd21fed0503399c6f8ba552d2'

/** One complete valid candidate; rows copy and perturb it. */
function candidate(): Record<string, unknown> {
  return {
    subject: 'aumlok:subject:demo',
    kind: 'observation',
    source: [],
    content: { move: 37, nested: ['rainbow', true] },
    links: [],
    privacy: 'local',
    createdAt: '2026-08-29T00:00:00Z',
  }
}

function stagedVector(): ReturnType<typeof stageKiraMemoryRecord> {
  return stageKiraMemoryRecord(candidate())
}

/** One revoked proxy; even brand checks on it must stay named refusals. */
function revokedProxy(): object {
  const { proxy, revoke } = Proxy.revocable({}, {})
  revoke()
  return proxy
}

/** Expect one KiraStageError whose stable code matches. */
function expectStageRefusal(input: unknown, code: string): void {
  let caught: unknown
  try {
    stageKiraMemoryRecord(input)
  } catch (error: unknown) {
    caught = error
  }
  expect(caught).toBeInstanceOf(KiraStageError)
  expect((caught as KiraStageError).name).toBe('KiraStageError')
  expect((caught as KiraStageError).code).toBe(code)
}

describe('KIRA deterministic staging', () => {
  it('pins the domain-separated identity vector and inert memory.put arguments', () => {
    const staged = stagedVector()

    expect(KIRA_RECORD_DOMAIN).toBe('aukora:kira-memory-record:v0')
    expect(KIRA_STAGE_TOOL).toBe('kira.stage')
    expect(KIRA_STAGE_GRANTS_AUTHORITY).toBe(false)
    expect(staged.recordId).toBe(VECTOR_ID)
    expect(staged.record).toEqual({
      domain: KIRA_RECORD_DOMAIN,
      grantsAuthority: false,
      recordId: VECTOR_ID,
      subject: 'aumlok:subject:demo',
      kind: 'observation',
      source: [],
      content: { move: 37, nested: ['rainbow', true] },
      links: [],
      privacy: 'local',
      createdAt: '2026-08-29T00:00:00Z',
    })
    expect(staged.memoryPut).toEqual({ key: VECTOR_ID, value: staged.record })

    // Independent recomputation: sha256(domain || NUL || canonical identity JSON).
    const identity = { ...staged.record } as Record<string, unknown>
    delete identity.recordId
    const digest = createHash('sha256')
      .update(KIRA_RECORD_DOMAIN, 'utf8')
      .update('\0', 'utf8')
      .update(canonicalJSON(identity), 'utf8')
      .digest('hex')
    expect(staged.recordId).toBe(`kira:${digest}`)

    // The staged arguments pass the door's own argument alphabet and key grammar.
    expect(isExactMemoryPutArgs(staged.memoryPut)).toBe(true)
    expect(KEY_SHAPE.test(staged.memoryPut.key)).toBe(true)
    expect(KIRA_RECORD_ID.test(staged.recordId)).toBe(true)

    expect(Object.isFrozen(staged)).toBe(true)
    expect(Object.isFrozen(staged.record)).toBe(true)
    expect(Object.isFrozen(staged.memoryPut)).toBe(true)
    expect(Object.isFrozen(staged.record.content)).toBe(true)
  })

  it('detaches the record from caller references', () => {
    const input = candidate()
    const staged = stageKiraMemoryRecord(input)
    ;(input.content as Record<string, unknown>).move = 999
    expect((staged.record.content as Record<string, unknown>).move).toBe(37)
    expect(staged.record.content).not.toBe(input.content)
  })

  it('is stable under object-key reordering at every level', () => {
    const reordered = stageKiraMemoryRecord({
      createdAt: '2026-08-29T00:00:00Z',
      privacy: 'local',
      links: [],
      content: { nested: ['rainbow', true], move: 37 },
      source: [],
      kind: 'observation',
      subject: 'aumlok:subject:demo',
    })
    expect(reordered.recordId).toBe(VECTOR_ID)
    expect(reordered.memoryPut).toEqual(stagedVector().memoryPut)
  })

  it.each([
    ['subject', { subject: 'aumlok:subject:other' }],
    ['kind', { kind: 'claim' }],
    ['content', { content: { move: 38, nested: ['rainbow', true] } }],
    ['source', { source: [{ recordId: VECTOR_ID }] }],
    ['links', { links: [{ recordId: VECTOR_ID, relation: 'refines' }] }],
    ['privacy', { privacy: 'private' }],
    ['createdAt', { createdAt: '2026-08-30T00:00:00Z' }],
    ['transform', {
      source: [{ recordId: VECTOR_ID }],
      transform: { name: 'summarize', version: '1', outputDigest: 'a'.repeat(64) },
    }],
  ])('changes the identifier when %s changes', (_field, patch) => {
    const changed = stageKiraMemoryRecord({ ...candidate(), ...patch })
    expect(changed.recordId).not.toBe(VECTOR_ID)
    expect(KIRA_RECORD_ID.test(changed.recordId)).toBe(true)
  })

  it('names the object without local-time participation', () => {
    // Same explicit createdAt bytes under two distant fake wall clocks.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2001-01-01T00:00:00Z'))
      const early = stagedVector()
      vi.setSystemTime(new Date('2077-07-07T07:07:07Z'))
      const late = stagedVector()
      expect(early.recordId).toBe(VECTOR_ID)
      expect(late.recordId).toBe(VECTOR_ID)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the closed kind and privacy vocabularies', () => {
    expect(KIRA_RECORD_KINDS).toEqual([
      'observation', 'summary', 'claim', 'preference', 'plan', 'training-slice', 'erasure',
    ])
    expect(KIRA_PRIVACY_CLASSES).toEqual(['local', 'exportable', 'private'])
    for (const kind of KIRA_RECORD_KINDS) {
      expect(stageKiraMemoryRecord({ ...candidate(), kind }).record.kind).toBe(kind)
    }
    for (const privacy of KIRA_PRIVACY_CLASSES) {
      expect(stageKiraMemoryRecord({ ...candidate(), privacy }).record.privacy).toBe(privacy)
    }
  })

  it('binds the transform itself into the identity digest', () => {
    // Same source throughout, so only transform participation separates ids.
    const base = { ...candidate(), source: [{ recordId: VECTOR_ID }] }
    const plain = stageKiraMemoryRecord(base)
    const derived = stageKiraMemoryRecord({
      ...base,
      transform: { name: 'summarize', version: '1', outputDigest: 'a'.repeat(64) },
    })
    const rederived = stageKiraMemoryRecord({
      ...base,
      transform: { name: 'summarize', version: '1', outputDigest: 'b'.repeat(64) },
    })
    expect(derived.recordId).not.toBe(plain.recordId)
    expect(rederived.recordId).not.toBe(derived.recordId)
  })

  it('carries a derived-view transform only over at least one source record', () => {
    const derived = stageKiraMemoryRecord({
      ...candidate(),
      source: [{ recordId: VECTOR_ID }],
      transform: {
        name: 'summarize',
        version: '2026-08',
        model: 'deepseek-chat',
        parametersDigest: 'b'.repeat(64),
        outputDigest: 'c'.repeat(64),
      },
    })
    expect(derived.record.grantsAuthority).toBe(false)
    expect(derived.record.transform).toEqual({
      name: 'summarize',
      version: '2026-08',
      model: 'deepseek-chat',
      parametersDigest: 'b'.repeat(64),
      outputDigest: 'c'.repeat(64),
    })
    expectStageRefusal(
      { ...candidate(), transform: { name: 'summarize', version: '1', outputDigest: 'a'.repeat(64) } },
      'kira.stage:transform-without-source',
    )
  })
})

describe('KIRA closed-input refusal', () => {
  it('refuses without running a hostile accessor', () => {
    const trap = Object.defineProperty({}, 'subject', {
      enumerable: true,
      get: () => { throw new Error('accessor must not run') },
    })
    expectStageRefusal(trap, 'kira.stage:candidate-field-not-data')
  })

  it.each([
    ['a primitive candidate', 'candidate', 'kira.stage:candidate-not-plain'],
    ['an array candidate', [candidate()], 'kira.stage:candidate-not-plain'],
    ['a proxied candidate', new Proxy(candidate(), {}), 'kira.stage:candidate-not-plain'],
    ['a revoked-proxy candidate', revokedProxy(), 'kira.stage:candidate-not-plain'],
    ['a custom-prototype candidate', Object.assign(Object.create({ inherited: true }) as object, candidate()), 'kira.stage:candidate-not-plain'],
    ['a rider field', { ...candidate(), grantsAuthority: true }, 'kira.stage:candidate-field-unknown'],
    ['a caller-supplied recordId', { ...candidate(), recordId: VECTOR_ID }, 'kira.stage:candidate-field-unknown'],
    ['a caller-supplied domain', { ...candidate(), domain: 'aukora:kira-memory-record:v0' }, 'kira.stage:candidate-field-unknown'],
    ['grant bytes riding the candidate', { ...candidate(), grant: { toolName: 'memory.put', signature: 'AAAA', nonce: '1' } }, 'kira.stage:candidate-field-unknown'],
    ['a symbol rider', Object.assign(candidate(), { [Symbol('rider')]: true }), 'kira.stage:candidate-field-unknown'],
    ['a missing field', (() => { const missing = candidate(); delete missing.privacy; return missing })(), 'kira.stage:candidate-field-missing'],
    ['an empty subject', { ...candidate(), subject: '' }, 'kira.stage:subject-invalid'],
    ['a control-character subject', { ...candidate(), subject: 'aumlok:\u0000demo' }, 'kira.stage:subject-invalid'],
    ['an unknown kind', { ...candidate(), kind: 'dream' }, 'kira.stage:kind-invalid'],
    ['an unknown privacy class', { ...candidate(), privacy: 'public' }, 'kira.stage:privacy-invalid'],
    ['a zoneless createdAt', { ...candidate(), createdAt: '2026-08-29T00:00:00' }, 'kira.stage:created-at-invalid'],
    ['an impossible createdAt date', { ...candidate(), createdAt: '2026-02-30T00:00:00Z' }, 'kira.stage:created-at-invalid'],
    ['a fractional-seconds createdAt (one instant, one encoding)', { ...candidate(), createdAt: '2026-08-29T00:00:00.000Z' }, 'kira.stage:created-at-invalid'],
    ['a Date-object createdAt', { ...candidate(), createdAt: new Date(0) }, 'kira.stage:created-at-invalid'],
    ['a non-array source', { ...candidate(), source: {} }, 'kira.stage:source-invalid'],
    ['a source rider field', { ...candidate(), source: [{ recordId: VECTOR_ID, extra: true }] }, 'kira.stage:source-field-unknown'],
    ['a malformed source recordId', { ...candidate(), source: [{ recordId: 'kira:nope' }] }, 'kira.stage:source-invalid'],
    ['a sparse source array', { ...candidate(), source: Array(1) }, 'kira.stage:source-invalid'],
    ['a revoked-proxy source array', { ...candidate(), source: revokedProxy() }, 'kira.stage:source-invalid'],
    ['a source array over the entry limit', { ...candidate(), source: Array.from({ length: 10_001 }, () => ({ recordId: VECTOR_ID })) }, 'kira.stage:source-invalid'],
    ['a link without a relation', { ...candidate(), links: [{ recordId: VECTOR_ID }] }, 'kira.stage:links-field-missing'],
    ['a control-character link relation', { ...candidate(), links: [{ recordId: VECTOR_ID, relation: 're\u0007fines' }] }, 'kira.stage:links-relation-invalid'],
    ['a non-object transform', { ...candidate(), source: [{ recordId: VECTOR_ID }], transform: 'summarize' }, 'kira.stage:transform-not-plain'],
    ['a transform digest that is not hex', { ...candidate(), source: [{ recordId: VECTOR_ID }], transform: { name: 'summarize', version: '1', outputDigest: 'Z'.repeat(64) } }, 'kira.stage:transform-invalid'],
  ])('refuses %s with its named error', (_label, input, code) => {
    expectStageRefusal(input, code)
  })

  it.each([
    ['undefined', undefined, 'kira.stage:content-not-json'],
    ['a function', () => true, 'kira.stage:content-not-json'],
    ['a bigint', 1n, 'kira.stage:content-not-json'],
    ['a symbol', Symbol('content'), 'kira.stage:content-not-json'],
    ['NaN', Number.NaN, 'kira.stage:content-not-json'],
    ['infinity', Number.POSITIVE_INFINITY, 'kira.stage:content-not-json'],
    ['negative zero', -0, 'kira.stage:content-not-json'],
    ['a Date instance', new Date(0), 'kira.stage:content-not-plain'],
    ['a proxy', new Proxy({ value: true }, {}), 'kira.stage:content-not-json'],
    ['a revoked proxy', revokedProxy(), 'kira.stage:content-not-json'],
    ['a nested accessor', Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => { throw new Error('nested accessor must not run') },
    }), 'kira.stage:content-not-plain'],
    ['a sparse array', Array(1), 'kira.stage:content-not-plain'],
    ['an array with a rider', Object.assign([true], { rider: true }), 'kira.stage:content-not-plain'],
    ['a symbol-bearing record', Object.assign({ value: true }, { [Symbol('rider')]: true }), 'kira.stage:content-not-plain'],
  ])('refuses content containing %s', (_label, content, code) => {
    expectStageRefusal({ ...candidate(), content }, code)
  })

  it('refuses a content cycle and enforces the depth and node ceilings', () => {
    const cycle: { self?: unknown } = {}
    cycle.self = cycle
    expectStageRefusal({ ...candidate(), content: cycle }, 'kira.stage:content-cycle')

    let deep: unknown = true
    for (let index = 0; index < 65; index += 1) deep = [deep]
    expectStageRefusal({ ...candidate(), content: deep }, 'kira.stage:content-depth')
    expectStageRefusal(
      { ...candidate(), content: Array.from({ length: 10_001 }, () => null) },
      'kira.stage:content-nodes',
    )
    expectStageRefusal({ ...candidate(), content: new Array(2 ** 32 - 1) }, 'kira.stage:content-nodes')
  })

  it('keeps a null-prototype __proto__ data key as data without prototype mutation', () => {
    const content = Object.create(null) as Record<string, unknown>
    Object.defineProperty(content, '__proto__', { enumerable: true, value: 'data', configurable: true })
    const staged = stageKiraMemoryRecord({ ...candidate(), content })
    const detached = staged.record.content as Record<string, unknown>
    expect(Object.getPrototypeOf(detached)).toBe(Object.prototype)
    expect(Object.hasOwn(detached, '__proto__')).toBe(true)
    expect(JSON.stringify(detached)).toBe('{"__proto__":"data"}')
  })

  it('separates lone-surrogate strings into distinct identifiers', () => {
    const high = stageKiraMemoryRecord({ ...candidate(), content: '\ud800' })
    const other = stageKiraMemoryRecord({ ...candidate(), content: '\ud801' })
    expect(high.recordId).not.toBe(other.recordId)
  })

  it('duplicates shared references as data while keeping them detached', () => {
    const shared = { value: true }
    const staged = stageKiraMemoryRecord({ ...candidate(), content: { first: shared, second: shared } })
    const content = staged.record.content as { first: unknown; second: unknown }
    expect(content).toEqual({ first: { value: true }, second: { value: true } })
    expect(content.first).not.toBe(content.second)
  })
})

describe('KIRA authority confinement', () => {
  it('exposes no authority material through staging output or module surface', async () => {
    const staged = stagedVector()
    // `grantsAuthority` is a required record field, so the scan looks for
    // whole quoted keys, never bare substrings.
    const rendered = JSON.stringify(staged)
    for (const forbidden of ['"grant"', '"signature"', '"nonce"', '"receipt"', '"issuer"', '"broker"']) {
      expect(rendered).not.toContain(forbidden)
    }
    const stageModule = await import('@aukora/core/kira/stage.mjs')
    const recallModule = await import('@aukora/core/kira/recall.mjs')
    expect(Object.keys(stageModule).sort()).toEqual([
      'KIRA_PRIVACY_CLASSES',
      'KIRA_RECORD_DOMAIN',
      'KIRA_RECORD_ID',
      'KIRA_RECORD_KINDS',
      'KIRA_STAGE_GRANTS_AUTHORITY',
      'KIRA_STAGE_TOOL',
      'KiraStageError',
      'stageKiraMemoryRecord',
      'verifyKiraMemoryRecord',
    ])
    expect(Object.keys(recallModule).sort()).toEqual([
      'KIRA_RECALL_MAX_RECORDS',
      'KIRA_RECALL_MAX_RESULT_BYTES',
      'KIRA_RECALL_MAX_SUBJECT_BYTES',
      'KIRA_RECALL_STATES',
      'KIRA_RECALL_TOOL',
      'KIRA_RECALL_UNDETERMINED_REASONS',
      'KiraRecallError',
      'kiraRecordContentSha256',
      'recallKiraMemoryRecords',
    ])
    expect(KIRA_RECALL_MAX_RECORDS).toBe(16)
    expect(KIRA_RECALL_MAX_RESULT_BYTES).toBe(48 * 1024)
    expect(KIRA_RECALL_MAX_SUBJECT_BYTES).toBe(1024)
    expect(kiraRecordContentSha256(staged.record)).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('imports no filesystem, network, or process capability', () => {
    for (const module of ['stage.mjs', 'recall.mjs']) {
      const source = readFileSync(
        fileURLToPath(new URL(`../../../../aukora/kira/${module}`, import.meta.url)),
        'utf8',
      )
      const specifiers = [...source.matchAll(/from '([^']+)'$/gm)].map(match => match[1])
      expect(specifiers.length).toBeGreaterThan(0)
      for (const specifier of specifiers) {
        expect([
          'node:crypto',
          'node:util',
          './stage.mjs',
          '../broker/effect-body.mjs',
          '../kernel-seed/canonical-json.mjs',
        ])
          .toContain(specifier)
      }
    }
  })
})

describe('KIRA record verification', () => {
  it('verifies its own staged record and rejects tampered identity', () => {
    const staged = stagedVector()
    expect(verifyKiraMemoryRecord(staged.record)).toEqual({ verified: true, record: staged.record })

    const tampered = { ...staged.record, content: { move: 99 } }
    expect(verifyKiraMemoryRecord(tampered)).toEqual({ verified: false, reason: 'identity-mismatch' })
  })

  it.each([
    ['a non-object', 'record'],
    ['a rider field', () => ({ ...stagedVector().record, rider: true })],
    ['a missing field', () => { const { privacy: _privacy, ...rest } = stagedVector().record; return rest }],
    ['a foreign domain', () => ({ ...stagedVector().record, domain: 'aukora:kira-record:v1' })],
    ['an authority claim', () => ({ ...stagedVector().record, grantsAuthority: true })],
  ])('classifies %s as malformed', (_label, make) => {
    const value = typeof make === 'function' ? make() : make
    expect(verifyKiraMemoryRecord(value)).toEqual({ verified: false, reason: 'malformed' })
  })
})

describe('KIRA read-only recall', () => {
  const SUBJECT = 'aumlok:subject:demo'

  function backingWith(...extra: Array<{ key: string; value: unknown }>): Array<{ key: string; value: unknown }> {
    const first = stagedVector()
    const second = stageKiraMemoryRecord({ ...candidate(), kind: 'claim' })
    return [
      { key: first.memoryPut.key, value: first.memoryPut.value },
      { key: second.memoryPut.key, value: second.memoryPut.value },
      { key: 'unrelated:setting', value: { theme: 'dark' } },
      ...extra,
    ]
  }

  it('keeps the closed public state and reason vocabularies', () => {
    expect(KIRA_RECALL_STATES).toEqual(['found', 'empty', 'undetermined'])
    expect(KIRA_RECALL_UNDETERMINED_REASONS).toEqual([
      'memory-unavailable', 'memory-corrupt', 'memory-unverified',
    ])
  })

  it('returns found with verified records sorted by identifier', () => {
    const result = recallKiraMemoryRecords({ subject: SUBJECT }, backingWith())
    expect(result.status).toBe('found')
    if (result.status !== 'found') throw new Error('unreachable')
    expect(result.records).toHaveLength(2)
    const ids = result.records.map(record => (record as { recordId: string }).recordId)
    expect(ids).toEqual([...ids].sort())
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.records)).toBe(true)
    for (const forbidden of ['"grant"', '"signature"', '"nonce"', '"receipt"', '"issuer"']) {
      expect(JSON.stringify(result)).not.toContain(forbidden)
    }
  })

  it('filters by kind without widening the vocabulary', () => {
    const claims = recallKiraMemoryRecords({ subject: SUBJECT, kind: 'claim' }, backingWith())
    expect(claims.status).toBe('found')
    if (claims.status !== 'found') throw new Error('unreachable')
    expect(claims.records).toHaveLength(1)
    expect((claims.records[0] as { kind: string }).kind).toBe('claim')
  })

  it.each([
    ['an unknown subject', { subject: 'aumlok:subject:unknown' }],
    ['an unmatched kind', { subject: SUBJECT, kind: 'erasure' }],
  ])('returns empty for %s over readable memory', (_label, query) => {
    expect(recallKiraMemoryRecords(query, backingWith())).toEqual({ status: 'empty' })
  })

  it('returns empty over an empty or KIRA-free snapshot', () => {
    expect(recallKiraMemoryRecords({ subject: SUBJECT }, [])).toEqual({ status: 'empty' })
    expect(recallKiraMemoryRecords(
      { subject: SUBJECT },
      [{ key: 'unrelated:setting', value: { theme: 'dark' } }],
    )).toEqual({ status: 'empty' })
  })

  it.each([
    ['undefined backing', undefined],
    ['null backing', null],
  ])('returns undetermined memory-unavailable for %s', (_label, backing) => {
    expect(recallKiraMemoryRecords({ subject: SUBJECT }, backing))
      .toEqual({ status: 'undetermined', reason: 'memory-unavailable' })
  })

  it.each([
    ['a non-array snapshot', (): unknown => ({ entries: [] })],
    ['a revoked-proxy snapshot', (): unknown => revokedProxy()],
    ['a sparse snapshot', (): unknown => Array(1)],
    ['a revoked-proxy entry', (): unknown => [revokedProxy()]],
    ['an entry that is not a key/value pair', (): unknown => [{ key: 'kira:x' }]],
    ['an entry with a rider', (): unknown => [{ key: `kira:${'0'.repeat(64)}`, value: true, rider: true }]],
    ['a malformed KIRA-keyed record', (): unknown => backingWith({ key: `kira:${'0'.repeat(64)}`, value: { bad: true } })],
  ])('returns undetermined memory-corrupt for %s', (_label, make) => {
    expect(recallKiraMemoryRecords({ subject: SUBJECT }, make()))
      .toEqual({ status: 'undetermined', reason: 'memory-corrupt' })
  })

  it.each([
    ['tampered record bytes', () => {
      const staged = stagedVector()
      return backingWith({ key: staged.recordId, value: { ...staged.record, content: { move: 99 } } })
    }],
    ['a record stored under a different key', () => {
      const staged = stagedVector()
      return backingWith({ key: `kira:${'f'.repeat(64)}`, value: staged.record })
    }],
  ])('returns undetermined memory-unverified for %s', (_label, make) => {
    expect(recallKiraMemoryRecords({ subject: SUBJECT }, make()))
      .toEqual({ status: 'undetermined', reason: 'memory-unverified' })
  })

  it('never collapses undetermined into empty for a matchless corrupt snapshot', () => {
    // No record matches this subject, so a lenient recall would say empty;
    // the corrupt entry must win, because a store that failed once cannot
    // certify that nothing relevant existed.
    const withCorrupt = backingWith({ key: `kira:${'0'.repeat(64)}`, value: { bad: true } })
    expect(recallKiraMemoryRecords({ subject: 'aumlok:subject:unknown' }, withCorrupt))
      .toEqual({ status: 'undetermined', reason: 'memory-corrupt' })
  })

  it.each([
    ['a primitive query', 'subject', 'kira.recall:query-not-plain'],
    ['a proxied query', new Proxy({ subject: 'x' }, {}), 'kira.recall:query-not-plain'],
    ['a revoked-proxy query', revokedProxy(), 'kira.recall:query-not-plain'],
    ['a query rider', { subject: 'x', limit: 5 }, 'kira.recall:query-field-unknown'],
    ['an empty subject', { subject: '' }, 'kira.recall:query-subject-invalid'],
    ['an unknown kind', { subject: 'x', kind: 'dream' }, 'kira.recall:query-kind-invalid'],
    ['an accessor query', Object.defineProperty({}, 'subject', {
      enumerable: true,
      get: () => { throw new Error('accessor must not run') },
    }), 'kira.recall:query-field-not-data'],
  ])('refuses %s with its named error', (_label, query, code) => {
    let caught: unknown
    try {
      recallKiraMemoryRecords(query, [])
    } catch (error: unknown) {
      caught = error
    }
    expect(caught).toBeInstanceOf(KiraRecallError)
    expect((caught as KiraRecallError).name).toBe('KiraRecallError')
    expect((caught as KiraRecallError).code).toBe(code)
  })
})
