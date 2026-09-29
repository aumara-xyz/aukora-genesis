/**
 * Court for plugins/aukora-effect-ir/lib/parse.mjs. A typed record is not an ALLOW.
 */
import assert from 'node:assert/strict'
import { parseEffect } from '../plugins/aukora-effect-ir/lib/parse.mjs'

const SCHEMA = 'aukora-effect-ir:v0'
const DIGEST = 'a'.repeat(64)
let failures = 0
let passed = 0
const arm = (name, body) => {
  try {
    body()
    passed += 1
    process.stdout.write(`  ok    ${name}\n`)
  } catch (error) {
    failures += 1
    process.stdout.write(`  FAIL  ${name}\n        ${String(error?.message ?? error).split('\n')[0]}\n`)
  }
}
const memory = (extra = {}) => ({ schema: SCHEMA, effect: 'memory.put', args: { key: 'note', value: 'hello' }, ...extra })

process.stdout.write('effect-ir parse\n')
arm('a closed memory.put is typed and is not ALLOW', () => {
  const parsed = parseEffect(memory())
  assert.equal(parsed.ok, true)
  assert.equal(parsed.typed, true)
  assert.equal(parsed.verdict, undefined)
  assert.equal(parsed.staged, false)
  assert.match(parsed.see, /^[0-9a-f]{64}$/u)
  assert.equal(parsed.see, parsed.digest)
})
arm('the see-digest ignores proposer, aura, sign, and laya', () => {
  const plain = parseEffect(memory())
  const named = parseEffect(memory({ proposer: 'laya', laya: 'ask', aura: { role: 'map' }, sign: DIGEST }))
  assert.equal(plain.see, named.see)
})
arm('unknown effect, extra field, bad args, and a non-object are refused', () => {
  assert.equal(parseEffect(memory({ effect: 'shell.exec' })).code, 'parse:effect')
  assert.equal(parseEffect({ ...memory(), decision: 'ALLOW' }).code, 'parse:unknown-field')
  assert.equal(parseEffect(memory({ args: { key: '../x', value: 'no' } })).code, 'parse:args')
  assert.equal(parseEffect(null).code, 'parse:not-object')
  assert.equal(parseEffect([]).code, 'parse:not-object')
})
arm('a decimal memory value is not canonical', () => {
  assert.equal(parseEffect(memory({ args: { key: 'note', value: 1.5 } })).code, 'parse:not-canonical')
})
arm('a kernel proposer cannot carry a laya move', () => {
  assert.equal(parseEffect(memory({ proposer: 'kernel', laya: 'ask' })).code, 'parse:laya')
})
process.stdout.write(`  ${String(passed)}/${String(passed + failures)} arms green\n`)
if (failures > 0) {
  process.stdout.write('EFFECT IR PARSE: RED\n')
  process.exit(1)
}
process.stdout.write('EFFECT IR PARSE: GREEN\n')
process.exit(0)
