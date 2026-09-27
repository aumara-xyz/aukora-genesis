/**
 * The attribution court: judge the classification table against the two
 * refusal tables it classifies, and against marks actually produced.
 *
 * The table rows are claims about causation, so the rows that matter here are
 * the executed ones: a non-subject actor produces `head-mismatch` and
 * `chain-truncated` against untouched producer bytes, and no chain-file content
 * produces `record:reserved-field` at all. The totality row keeps the table
 * from silently falling behind either refusal table.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RECORD_DOMAIN, RECORD_REFUSE, appendEntry, entryHash, verifyChain } from '@aukora/core/aura/record.mjs'
import { KIRA_MEMORY_ARTIFACT_REFUSE, type KiraMemoryArtifactRow, verifyKiraMemoryArtifact } from '@aukora/core/verifier/kira-memory-artifact-verifier.mjs'
import {
  type AttributionClass,
  ATTRIBUTION_CLASSES,
  MARK_ATTRIBUTION,
  SUBJECT_ARTIFACT_PRODUCER,
  SUBJECT_CHAIN_APPENDER,
  attributionGrantsAuthority,
  attributionOf,
  isAttributable,
  mayAccrueAsWeight,
} from '@aukora/core/witness/attribution.mjs'

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const AURA_MARKS = Object.values(RECORD_REFUSE)
const VERIFIER_MARKS = Object.values(KIRA_MEMORY_ARTIFACT_REFUSE)
const CLASSIFIED = new Map(MARK_ATTRIBUTION.map(entry => [entry.mark, entry]))

/** A trusted head the producer never emitted; any 64-hex value serves. */
const FOREIGN_HEAD = 'f'.repeat(64)

/**
 * Read one mark out of its refusal table, failing loudly when the name is gone.
 * Both tables are typed as open string records, so a renamed member would
 * otherwise reach an assertion as `undefined`.
 */
function mark(table: Readonly<Record<string, string>>, name: string): string {
  const value = table[name]
  if (value === undefined) throw new Error(`the refusal table has no member named ${name}`)
  return value
}

const HEAD_MISMATCH = mark(KIRA_MEMORY_ARTIFACT_REFUSE, 'HEAD_MISMATCH')
const CHAIN_TRUNCATED = mark(KIRA_MEMORY_ARTIFACT_REFUSE, 'CHAIN_TRUNCATED')
const RESERVED_FIELD = mark(RECORD_REFUSE, 'RESERVED_FIELD')
const RESERVED_FIELD_ON_WIRE = mark(RECORD_REFUSE, 'RESERVED_FIELD_ON_WIRE')
const TAMPERED = mark(RECORD_REFUSE, 'TAMPERED')
const BROKEN_LINK = mark(RECORD_REFUSE, 'BROKEN_LINK')

let scratch: string

function chainText(bodies: Array<Record<string, unknown>>): string {
  const file = join(scratch, `chain-${Math.random().toString(36).slice(2)}.jsonl`)
  for (const fields of bodies) appendEntry({ file, fields })
  return readFileSync(file, 'utf8')
}

/** One chain line in the writer's own encoding, for bodies `appendEntry` refuses to write. */
function entryLine(prev: string, fields: Record<string, unknown>): string {
  return `${JSON.stringify({ hash: entryHash(prev, fields), prev, ...fields })}\n`
}

/**
 * An artifact whose chain walks clean and whose claimed head is the head that
 * chain computes. Every other check is free to be red: `verifyKiraMemoryArtifact`
 * emits all nine rows regardless, and these rows read `chain` and `head-anchor`.
 */
function artifactWithChain(aura: string, head: string): Record<string, unknown> {
  return {
    kind: 'aukora:kira-memory-artifact:v1',
    record: { recordId: 'x' },
    memoryPut: { key: 'k', value: 1 },
    object: { name: 'o.json', body: '{}\n' },
    projection: { key: 'k', contentSha256: '0'.repeat(64) },
    aura,
    head,
    recall: { query: { subject: 's' }, status: 'undetermined', reason: 'not asserted here' },
  }
}

function rowOf(verdict: ReturnType<typeof verifyKiraMemoryArtifact>, check: string): KiraMemoryArtifactRow {
  const found = verdict.checks.find(entry => entry.check === check)
  if (found === undefined) throw new Error(`the verdict carries no ${check} row`)
  return found
}

/** The `hash` one chain line commits to. */
function lineHash(line: string | undefined): string {
  const parsed: unknown = line === undefined ? undefined : JSON.parse(line)
  if (typeof parsed !== 'object' || parsed === null || !('hash' in parsed) || typeof parsed.hash !== 'string') {
    throw new Error('a chain line must be one JSON object carrying a string hash')
  }
  return parsed.hash
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'aukora-witness-attribution-'))
})

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

describe('attribution table totality', () => {
  it('classifies every member of KIRA_MEMORY_ARTIFACT_REFUSE and RECORD_REFUSE', () => {
    // TOTALITY. Adding a refusal to either table without an attribution row
    // turns this red: the question has been asked of nobody for that mark.
    const declared = [...VERIFIER_MARKS, ...AURA_MARKS].sort()
    expect(declared.filter(name => !CLASSIFIED.has(name))).toEqual([])
    expect([...CLASSIFIED.keys()].sort()).toEqual(declared)
  })

  it('classifies no mark that neither refusal table emits', () => {
    const emitted = new Set([...VERIFIER_MARKS, ...AURA_MARKS])
    expect(MARK_ATTRIBUTION.filter(entry => !emitted.has(entry.mark)).map(entry => entry.mark)).toEqual([])
  })

  it('names each mark once', () => {
    expect(CLASSIFIED.size).toBe(MARK_ATTRIBUTION.length)
  })

  it('files every mark under the subject its own table answers to', () => {
    const verifier = new Set(VERIFIER_MARKS)
    for (const entry of MARK_ATTRIBUTION) {
      expect(entry.subject).toBe(verifier.has(entry.mark) ? SUBJECT_ARTIFACT_PRODUCER : SUBJECT_CHAIN_APPENDER)
    }
  })
})

describe('attribution table well-formedness', () => {
  it('leaves alsoProducibleBy empty exactly for SUBJECT_ONLY', () => {
    for (const entry of MARK_ATTRIBUTION) {
      expect(ATTRIBUTION_CLASSES).toContain(entry.attribution)
      expect(entry.alsoProducibleBy.length === 0).toBe(entry.attribution === 'SUBJECT_ONLY')
    }
  })

  it('names a producer rather than an empty string', () => {
    for (const entry of MARK_ATTRIBUTION) {
      for (const producer of entry.alsoProducibleBy) expect(producer.trim().length).toBeGreaterThan(0)
    }
  })

  it('reports no mark as attributable before producer signatures exist', () => {
    expect(MARK_ATTRIBUTION.filter(entry => entry.attribution === 'SUBJECT_ONLY').map(entry => entry.mark))
      .toEqual([])
  })

  it('holds the two wire-producible marks the verifier reports as NOT_ATTRIBUTABLE', () => {
    expect(attributionOf(HEAD_MISMATCH)?.attribution).toBe('NOT_ATTRIBUTABLE')
    expect(attributionOf(CHAIN_TRUNCATED)?.attribution).toBe('NOT_ATTRIBUTABLE')
  })
})

describe('the attribution question', () => {
  it('returns null for an unclassified mark', () => {
    expect(attributionOf('ferry:malformed-envelope')).toBeNull()
    expect(attributionOf('')).toBeNull()
  })

  it('holds only when the subject is the sole producer', () => {
    expect(isAttributable('A', ['A'])).toBe(true)
    expect(isAttributable('A', ['A', 'the wire'])).toBe(false)
    expect(isAttributable('A', ['B'])).toBe(false)
    expect(isAttributable('A', [])).toBe(false)
  })

  it('permits weight only for SUBJECT_ONLY and refuses an unknown class', () => {
    expect(mayAccrueAsWeight('SUBJECT_ONLY')).toBe(true)
    expect(mayAccrueAsWeight('NOT_ATTRIBUTABLE')).toBe(false)
    expect(() => mayAccrueAsWeight('ROGUE' as unknown as AttributionClass))
      .toThrow('unreachable attribution class: ROGUE')
  })

  it('grants no authority', () => {
    expect(attributionGrantsAuthority()).toBe(false)
  })
})

describe('head-mismatch is produced by the caller, not the producer', () => {
  it('flips on the trusted head alone while the producer bytes stay byte-identical', () => {
    const aura = chainText([{ verdict: 'settled', sequence: 1 }, { verdict: 'settled', sequence: 2 }])
    const lines = aura.split('\n').filter(line => line !== '')
    const head = lineHash(lines[lines.length - 1])
    const artifact = artifactWithChain(aura, head)

    const honest = verifyKiraMemoryArtifact(artifact, { trustedHead: head })
    const foreign = verifyKiraMemoryArtifact(artifact, { trustedHead: FOREIGN_HEAD })

    expect(rowOf(honest, 'head-anchor')).toEqual({
      check: 'head-anchor',
      ok: true,
      detail: 'the recomputed head equals both the claimed head and the trusted out-of-band head',
    })
    expect(rowOf(foreign, 'head-anchor').reason).toBe(HEAD_MISMATCH)
    expect(JSON.stringify(artifact)).toBe(JSON.stringify(artifactWithChain(aura, head)))
  })

  it('is also produced by deleting a chain suffix and restating the head', () => {
    // The second producer named in the row: the shortened chain walks clean and
    // the restated head matches it, so `head-not-as-claimed` stays green and
    // the mark lands on a producer who emitted the longer chain correctly.
    const aura = chainText([{ verdict: 'settled', sequence: 1 }, { verdict: 'settled', sequence: 2 }])
    const lines = aura.split('\n').filter(line => line !== '')
    const fullHead = lineHash(lines[lines.length - 1])
    const shortHead = lineHash(lines[0])

    const carried = verifyKiraMemoryArtifact(artifactWithChain(`${lines[0]}\n`, shortHead), { trustedHead: fullHead })

    expect(rowOf(carried, 'chain').ok).toBe(true)
    expect(rowOf(carried, 'head-anchor').reason).toBe(HEAD_MISMATCH)
  })
})

describe('chain-truncated is produced by one deleted byte', () => {
  it('fires when a carrier drops the terminal newline from an otherwise clean chain', () => {
    const aura = chainText([{ verdict: 'settled', sequence: 1 }])
    const lines = aura.split('\n').filter(line => line !== '')
    const head = lineHash(lines[0])

    expect(rowOf(verifyKiraMemoryArtifact(artifactWithChain(aura, head), { trustedHead: head }), 'chain').ok).toBe(true)

    const cut = aura.slice(0, -1)
    expect(cut.length).toBe(aura.length - 1)
    expect(rowOf(verifyKiraMemoryArtifact(artifactWithChain(cut, head), { trustedHead: head }), 'chain').reason)
      .toBe(CHAIN_TRUNCATED)
  })
})

describe('Aura chain line framing', () => {
  it.each([
    ['before the first entry', (aura: string) => `\n${aura}`, 1],
    ['between entries', (aura: string) => aura.replace('\n', '\n\n'), 2],
    ['after the last entry', (aura: string) => `${aura}\n`, 3],
  ])('refuses a blank line %s', (_label, mutate, line) => {
    const aura = chainText([{ verdict: 'settled', sequence: 1 }, { verdict: 'settled', sequence: 2 }])
    const file = join(scratch, `blank-line-${line}.jsonl`)
    writeFileSync(file, mutate(aura))

    expect(verifyChain(file)).toEqual({
      ok: false,
      reason: RECORD_REFUSE.CHAIN_NOT_CANONICAL,
      line,
    })
  })
})

describe('record:reserved-field matches the writer and reader predicates', () => {
  it('refuses the write when the caller assembles a body carrying a reserved name', () => {
    for (const reserved of ['hash', 'prev', 'domain']) {
      const file = join(scratch, `reserved-${reserved}.jsonl`)
      expect(() => appendEntry({ file, fields: { verdict: 'settled', [reserved]: 'chosen by the caller' } }))
        .toThrow(RESERVED_FIELD)
    }
  })

  it('is unreachable from chain-file bytes, so no other actor can produce it', () => {
    // The readers DO refuse a body carrying a reserved name now — a `domain`
    // key rehashes clean, because the preimage writes the separator after the
    // spread, so neither the chain nor an external head can see it. They raise
    // their OWN mark for it, so chain bytes cannot produce the write-time mark.
    // That buys a diagnostic distinction and nothing more: no mark here is
    // attributable, because nothing signs a chain body.
    const shadowed = { verdict: 'settled', domain: 'chosen by an attacker' }
    const shadowedFile = join(scratch, 'shadowed-domain.jsonl')
    writeFileSync(shadowedFile, entryLine(RECORD_DOMAIN, shadowed))
    const verified = verifyChain(shadowedFile)
    expect(verified).toMatchObject({ ok: false, reason: RESERVED_FIELD_ON_WIRE })
    if (verified.ok) throw new Error('expected reserved field on wire to refuse')
    expect(verified.reason).not.toBe(RESERVED_FIELD)
  })

  it('keeps hash and prev as framing while refusing them at the writer input', () => {
    // A parsed line has only one hash and one prev slot, so those names are
    // framing rather than recoverable body fields. Overriding either still
    // fails by the framing predicate: the hash mismatches, the prev breaks the
    // link. Neither reaches the write-time mark.
    const shadowedHash = { verdict: 'settled', hash: 'chosen by an attacker' }
    const hashFile = join(scratch, 'shadowed-hash.jsonl')
    writeFileSync(hashFile, entryLine(RECORD_DOMAIN, shadowedHash))
    expect(verifyChain(hashFile)).toMatchObject({ ok: false, reason: TAMPERED })

    const shadowedPrev = { verdict: 'settled', prev: 'chosen by an attacker' }
    const prevFile = join(scratch, 'shadowed-prev.jsonl')
    writeFileSync(prevFile, entryLine(RECORD_DOMAIN, shadowedPrev))
    expect(verifyChain(prevFile)).toMatchObject({ ok: false, reason: BROKEN_LINK })

    for (const file of [hashFile, prevFile]) {
      const verified = verifyChain(file)
      if (verified.ok) throw new Error('expected reserved field framing to refuse')
      expect(verified.reason).not.toBe(RESERVED_FIELD)
    }
  })

  it('pins the entry-body call sites that must share the writer predicate', () => {
    // Every writer currently assembles the body from source literals. A new
    // call site must still pass through appendEntry's reserved-name refusal;
    // the reader-side regression above separately covers carried chain bytes.
    const sources: string[] = []
    const pending = [join(REPO_ROOT, 'aukora')]
    for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        // node_modules holds workspace symlinks whose traversal never terminates.
        if (entry.isDirectory()) { if (entry.name !== 'node_modules') pending.push(path) }
        else if (entry.isFile() && entry.name.endsWith('.mjs') && !path.endsWith(join('aura', 'record.mjs'))
          && /\bappendEntry\s*\(/.test(readFileSync(path, 'utf8'))) sources.push(relative(REPO_ROOT, path))
      }
    }
    expect(sources.sort()).toEqual([join('aukora', 'broker', 'broker.mjs')])
  })
})
