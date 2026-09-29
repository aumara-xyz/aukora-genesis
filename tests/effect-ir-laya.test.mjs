/**
 * Court for plugins/aukora-effect-ir/lib/laya.mjs. STOP/ASK only, rank never falls.
 */
import assert from 'node:assert/strict'
import { layaStep } from '../plugins/aukora-effect-ir/lib/laya.mjs'

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

process.stdout.write('effect-ir laya\n')
arm('ask and stop are the only admitted moves', () => {
  assert.equal(layaStep('none', 'ask').verdict, 'ASK')
  assert.equal(layaStep('ask', 'ask').verdict, 'ASK')
  assert.equal(layaStep('none', 'stop').verdict, 'STOP')
  assert.equal(layaStep('ask', 'stop').verdict, 'STOP')
  assert.equal(layaStep('stop', 'stop').verdict, 'STOP')
  for (const move of ['allow', 'ALLOW', 'go', '']) {
    const out = layaStep('none', move)
    assert.equal(out.verdict, 'REFUSE')
    assert.equal(out.code, 'laya:not-stop-ask')
  }
})
arm('stop then ask is not monotonic', () => {
  const out = layaStep('stop', 'ask')
  assert.equal(out.ok, false)
  assert.equal(out.verdict, 'REFUSE')
  assert.equal(out.code, 'laya:not-monotonic')
})
arm('a prior allow is not a Laya rank', () => {
  assert.equal(layaStep('allow', 'stop').code, 'laya:not-stop-ask')
})
process.stdout.write(`  ${String(passed)}/${String(passed + failures)} arms green\n`)
if (failures > 0) {
  process.stdout.write('EFFECT IR LAYA: RED\n')
  process.exit(1)
}
process.stdout.write('EFFECT IR LAYA: GREEN\n')
process.exit(0)
