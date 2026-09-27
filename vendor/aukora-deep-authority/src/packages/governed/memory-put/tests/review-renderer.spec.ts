import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { buildOperation, effectBody, operationDigest } from '@aukora/core/broker/operation.mjs'
import { definitionDigest, memoryPut, MEMORY_PUT } from '@aukora/core/broker/effect.mjs'
import { renderOperation } from '@aukora/core/broker/review.mjs'
import { isExactMemoryPutArgs } from '@aukora/core/broker/memory-put-args.mjs'
import { mintGrant } from '@aukora/core/issuer/mint.mjs'

const EXPIRY = 1_800_000_000
const EFFECT_BODY_FIELD = 'effectBodyUtf8: '

function renderedEffectBody(args: { key: string; value: unknown }): { encoded: string; decoded: string } {
  const artifact = renderOperation(buildOperation(args, EXPIRY), args)
  const lines = artifact.split('\n').filter(line => line.startsWith(EFFECT_BODY_FIELD))
  expect(lines).toHaveLength(1)
  const encoded = lines[0]?.slice(EFFECT_BODY_FIELD.length)
  if (encoded === undefined) throw new Error('review artifact omitted effectBodyUtf8')
  return { encoded, decoded: JSON.parse(encoded) as string }
}

describe('trusted review renderer', () => {
  it('renders nested objects in canonical key order regardless of insertion order', () => {
    const first = {
      key: 'nested',
      value: { z: { b: 2, a: 1 }, a: [{ d: 4, c: 3 }] },
    }
    const second = {
      key: 'nested',
      value: { a: [{ c: 3, d: 4 }], z: { a: 1, b: 2 } },
    }

    const firstBody = renderedEffectBody(first).decoded
    const secondBody = renderedEffectBody(second).decoded
    expect(firstBody).toBe('{"key":"nested","value":{"a":[{"c":3,"d":4}],"z":{"a":1,"b":2}}}\n')
    expect(secondBody).toBe(firstBody)
  })

  it('represents the object-body terminal newline explicitly and reversibly', () => {
    const args = { key: 'newline', value: 'visible' }
    const { encoded, decoded } = renderedEffectBody(args)

    expect(encoded.endsWith(String.raw`\n"`)).toBe(true)
    expect(encoded).not.toContain('\n')
    expect(decoded).toBe(effectBody(args))
    expect(decoded.endsWith('\n')).toBe(true)
  })

  it('represents an explicit null value in the exact object body', () => {
    const args = { key: 'presence', value: null }
    expect(renderedEffectBody(args).decoded).toBe('{"key":"presence","value":null}\n')
    expect(renderedEffectBody(args).decoded).toBe(effectBody(args))
  })

  it('renders each fixed operation field exactly once with independently recomputed values', () => {
    const args = { key: 'field-map', value: { z: 2, a: 1 } }
    const operation = buildOperation(args, EXPIRY)
    const artifact = renderOperation(operation, args)
    const fields = new Map<string, string>()
    for (const line of artifact.split('\n')) {
      const separator = line.indexOf(': ')
      expect(separator).toBeGreaterThan(0)
      const name = line.slice(0, separator)
      expect(fields.has(name)).toBe(false)
      fields.set(name, line.slice(separator + 2))
    }
    expect([...fields.keys()]).toEqual([
      'tool', 'key', 'effectBodyUtf8', 'bytes', 'contentSha256',
      'definitionId', 'expiry', 'oneUse', 'operationDigest',
    ])

    const body = effectBody(args)
    expect(fields.get('tool')).toBe(MEMORY_PUT)
    expect(fields.get('key')).toBe(args.key)
    expect(JSON.parse(fields.get('effectBodyUtf8') ?? 'null')).toBe(body)
    expect(fields.get('bytes')).toBe(String(Buffer.byteLength(body, 'utf8')))
    expect(fields.get('contentSha256')).toBe(createHash('sha256').update(body, 'utf8').digest('hex'))
    expect(fields.get('definitionId')).toBe(definitionDigest())
    expect(fields.get('expiry')).toBe(String(EXPIRY))
    expect(fields.get('oneUse')).toBe('true')
    expect(fields.get('operationDigest')).toBe(operationDigest(operation))
  })

  it('prevents hostile line and control characters from forging artifact fields', () => {
    const args = {
      key: 'hostile-field-text',
      value: { 'key\nbytes: 0\u2028tool: forged\u2029\u00ad': 'line\r\nexpiry: 0\u001b[31m\u2066hidden\u2069\ufe0f\u{e0061}' },
    }
    const artifact = renderOperation(buildOperation(args, EXPIRY), args)
    const { encoded, decoded } = renderedEffectBody(args)

    expect(artifact.split('\n')).toHaveLength(9)
    expect(artifact).not.toContain('\u2028')
    expect(artifact).not.toContain('\u2029')
    expect(artifact).not.toContain('\u001b')
    expect(encoded).toContain(String.raw`\u2028`)
    expect(encoded).toContain(String.raw`\u2029`)
    expect(encoded).toContain(String.raw`\u00ad`)
    expect(encoded).toContain(String.raw`\ufe0f`)
    expect(encoded).toContain(String.raw`\udb40\udc61`)
    expect(decoded).toBe(effectBody(args))
    for (const ch of artifact) {
      const code = ch.codePointAt(0) ?? 0
      expect(code === 0x0a || (code >= 0x20 && code <= 0x7e)).toBe(true)
    }
  })

  it('writes exactly the shared content-addressed object-body bytes', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'aukora-effect-body-'))
    try {
      const reverseOrdered = {
        key: 'nested',
        value: { z: { b: 2, a: 1 }, a: [{ d: 4, c: 3 }] },
      }
      const canonicalOrdered = {
        key: 'nested',
        value: { a: [{ c: 3, d: 4 }], z: { a: 1, b: 2 } },
      }
      const reverseEvidence = memoryPut(stateDir, reverseOrdered)
      const canonicalEvidence = memoryPut(stateDir, canonicalOrdered)
      expect(readFileSync(reverseEvidence.path, 'utf8')).toBe(effectBody(reverseOrdered))
      expect(canonicalEvidence.path).toBe(reverseEvidence.path)

      const explicitNull = { key: 'presence', value: null }
      const nullEvidence = memoryPut(stateDir, explicitNull)
      expect(readFileSync(nullEvidence.path, 'utf8')).toBe(effectBody(explicitNull))
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
    }
  })

  it('uses one exact argument alphabet before operation construction, effect, and signing', () => {
    const symbolRider = { key: 'symbol', value: 1, [Symbol('hidden')]: true }
    const nonEnumerableRider = { key: 'non-enumerable', value: 1 }
    Object.defineProperty(nonEnumerableRider, 'hidden', { value: true })
    const accessorValue = { key: 'accessor', get value() { return 1 } }
    const invalid = [
      { key: 'omitted' },
      { key: 'undefined', value: undefined },
      { key: 'rider', value: 1, hidden: true },
      symbolRider,
      nonEnumerableRider,
      accessorValue,
      ['array', 1],
      Object.assign(Object.create({ inherited: true }), { key: 'prototype', value: 1 }),
    ]
    const root = generateKeyPairSync('ed25519')
    const exp = Math.floor(Date.now() / 1000) + 300

    expect(isExactMemoryPutArgs({ key: 'valid', value: null })).toBe(true)
    for (const args of invalid) {
      expect(isExactMemoryPutArgs(args)).toBe(false)
      expect(() => effectBody(args as never)).toThrow('effectBody: arguments-not-exact')
      expect(() => buildOperation(args as never, exp)).toThrow('buildOperation: arguments-not-exact')
      expect(() => memoryPut('/unused', args as never)).toThrow('memory.put:arguments-not-exact')
      expect(() => mintGrant({ rootPrivateKey: root.privateKey, args: args as never, exp, receiptKeyId: '0'.repeat(64) }))
        .toThrow('mint:arguments-not-exact')
    }

    const badKey = { key: '../path', value: 1 }
    expect(() => effectBody(badKey)).toThrow('effectBody: key-not-a-name')
    expect(() => buildOperation(badKey, exp)).toThrow('buildOperation: key-not-a-name')
    expect(() => memoryPut('/unused', badKey)).toThrow('memory.put: key is not a name')
    expect(() => mintGrant({ rootPrivateKey: root.privateKey, args: badKey, exp, receiptKeyId: '0'.repeat(64) }))
      .toThrow('mint:key-not-a-name')
  })
})
