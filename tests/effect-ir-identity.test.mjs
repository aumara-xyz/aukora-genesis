/**
 * Court for plugins/aukora-effect-ir/lib/identity.mjs. Equal digests are not an ALLOW.
 */
import assert from 'node:assert/strict'
import { seeSignExecute } from '../plugins/aukora-effect-ir/lib/identity.mjs'

const SEE = 'a'.repeat(64)
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

process.stdout.write('effect-ir identity\n')
arm('three equal digests bind and do not allow', () => {
  const out = seeSignExecute(SEE, SEE, SEE)
  assert.equal(out.ok, true)
  assert.equal(out.allows, false)
  assert.equal(out.verdict, undefined)
  assert.equal(out.see, out.sign)
  assert.equal(out.sign, out.execute)
})
arm('a different sign diverges', () => {
  const out = seeSignExecute(SEE, 'b'.repeat(64), SEE)
  assert.equal(out.ok, false)
  assert.equal(out.code, 'see-sign-execute:diverge')
})
arm('a different execute digest diverges', () => {
  assert.equal(seeSignExecute(SEE, SEE, 'c'.repeat(64)).code, 'see-sign-execute:diverge')
})
arm('a missing sign diverges and a short see is refused', () => {
  assert.equal(seeSignExecute(SEE, null, SEE).code, 'see-sign-execute:diverge')
  assert.equal(seeSignExecute('aa', SEE, SEE).code, 'see-sign-execute:see')
})
process.stdout.write(`  ${String(passed)}/${String(passed + failures)} arms green\n`)
if (failures > 0) {
  process.stdout.write('EFFECT IR IDENTITY: RED\n')
  process.exit(1)
}
process.stdout.write('EFFECT IR IDENTITY: GREEN\n')
process.exit(0)
