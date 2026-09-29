/**
 * Court for plugins/aukora-effect-ir/lib/ir.mjs.
 * Not mounted. The action gate and become.mjs do not import it.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decideEffect, parseEffect } from '../plugins/aukora-effect-ir/lib/ir.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCHEMA = 'aukora-effect-ir:v0'
const NOW = 0
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
const row = (verdict, reason) => ({ verdict, reason })
const clean = () => ({
  chains: {
    code: row('APPEND_ONLY', 'identical_trees_match'),
    actions: row('APPEND_ONLY', 'valid_append_only_extension'),
    memory: row('UNDETERMINED', 'missing_prior_observation'),
    remembered: row('APPEND_ONLY', 'identical_trees_match'),
  },
})
const signed = (extra = {}) => {
  const parsed = parseEffect(memory(extra))
  if (!parsed.ok) throw new Error(parsed.code)
  return { ...memory(extra), sign: parsed.see }
}
const job = () => {
  const input = {
    schema: SCHEMA,
    effect: 'compute.job',
    args: {
      endpoint: 'local',
      imageSha256: DIGEST,
      volumeSha256: 'b'.repeat(64),
      decodeSha256: 'c'.repeat(64),
      budgetSha256: 'd'.repeat(64),
    },
  }
  const parsed = parseEffect(input)
  if (!parsed.ok) throw new Error(parsed.code)
  return { ...input, sign: parsed.see }
}
const refused = (out, code) => {
  if (out.verdict === 'ALLOW' || out.code !== code) throw new Error(code)
}

process.stdout.write('effect-ir v0\n')
arm('the live gate and become do not import this module', () => {
  const gate = readFileSync(join(ROOT, 'plugins', 'aukora-action-gate', 'lib', 'index.mjs'), 'utf8')
  const become = readFileSync(join(ROOT, 'scripts', 'aukora', 'become.mjs'), 'utf8')
  assert.equal(gate.includes('aukora-effect-ir'), false)
  assert.equal(become.includes('aukora-effect-ir'), false)
})
arm('typed memory.put refuses by default when see, sign, and execute match', () => {
  const out = decideEffect(signed(), NOW, clean())
  refused(out, 'kernel:policy_no_match')
  assert.equal(out.see, out.sign)
  assert.equal(out.sign, out.execute)
})
arm('a missing membrane refuses before the kernel', () => {
  refused(decideEffect(signed(), NOW), 'membrane:absent')
  refused(decideEffect(signed(), NOW, null), 'membrane:absent')
  const conflict = clean()
  conflict.chains.code = row('OBSERVATION_CONFLICT', 'same_size_root_mismatch')
  refused(decideEffect(signed(), NOW, conflict), 'membrane:conflict')
})
arm('a sign that is not the see-digest diverges', () => {
  const out = decideEffect({ ...signed(), sign: 'e'.repeat(64) }, NOW, clean())
  refused(out, 'see-sign-execute:diverge')
})
arm('Laya ask then stop stays STOP or ASK and does not execute', () => {
  const ask = decideEffect(signed({ proposer: 'laya', laya: 'ask', layaPrior: 'none' }), NOW, clean())
  assert.equal(ask.verdict, 'ASK')
  assert.equal(ask.code, 'laya:ask')
  const stop = decideEffect(signed({ proposer: 'laya', laya: 'stop', layaPrior: 'ask' }), NOW, clean())
  assert.equal(stop.verdict, 'STOP')
  assert.equal(stop.code, 'laya:stop')
  refused(decideEffect(signed({ proposer: 'laya', laya: 'ask', layaPrior: 'stop' }), NOW, clean()), 'laya:not-monotonic')
  refused(decideEffect(signed({ proposer: 'laya', laya: 'allow', layaPrior: 'none' }), NOW, clean()), 'laya:not-stop-ask')
})
arm('Aura allow is refused and a map does not authorize', () => {
  refused(decideEffect(signed({ aura: { role: 'allow' } }), NOW, clean()), 'aura:map-only')
  const mapped = decideEffect(signed({ aura: { role: 'map' } }), NOW, clean())
  refused(mapped, 'kernel:policy_no_match')
  assert.equal(mapped.map[mapped.see].role, 'map')
  assert.equal(JSON.stringify(mapped.map).includes('ALLOW'), false)
})
arm('staged compute.job and a missing clock refuse', () => {
  refused(decideEffect(job(), NOW, clean()), 'staged:not-admissible')
  refused(decideEffect(signed(), undefined, clean()), 'usage:now')
})
process.stdout.write(`  ${String(passed)}/${String(passed + failures)} arms green\n`)
if (failures > 0) {
  process.stdout.write('EFFECT IR v0: RED\n')
  process.exit(1)
}
process.stdout.write('EFFECT IR v0: GREEN\n')
process.exit(0)
