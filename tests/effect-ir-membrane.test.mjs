/**
 * Court for plugins/aukora-effect-ir/lib/membrane.mjs.
 * The chain list is read off scripts/aukora/become.mjs. This court does not import it.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHAINS, membraneAdmit } from '../plugins/aukora-effect-ir/lib/membrane.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
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
const row = (verdict, reason) => ({ verdict, reason })
const clean = (patch = {}) => ({
  chains: {
    code: row('APPEND_ONLY', 'identical_trees_match'),
    actions: row('APPEND_ONLY', 'valid_append_only_extension'),
    memory: row('UNDETERMINED', 'missing_prior_observation'),
    remembered: row('APPEND_ONLY', 'identical_trees_match'),
    ...patch,
  },
})

process.stdout.write('effect-ir membrane\n')
arm('chain names match become.mjs chainPaths', () => {
  const source = readFileSync(join(ROOT, 'scripts', 'aukora', 'become.mjs'), 'utf8')
  const listed = source.match(/export const chainPaths = Object\.freeze\(\{([^}]+)\}/u)
  assert.ok(listed)
  const names = [...listed[1].matchAll(/([a-z]+):/gu)].map(match => match[1])
  assert.deepEqual([...CHAINS], names)
  assert.equal(source.includes('aukora-effect-ir'), false)
})
arm('a clean observation is admitted and a missing one is not', () => {
  assert.equal(membraneAdmit(clean()).ok, true)
  assert.equal(membraneAdmit(undefined).code, 'membrane:absent')
  assert.equal(membraneAdmit({}).code, 'membrane:absent')
  const dropped = clean()
  delete dropped.chains.remembered
  assert.equal(membraneAdmit(dropped).code, 'membrane:absent')
})
arm('conflict, rotation, undetermined, and a forged append refuse', () => {
  assert.equal(membraneAdmit(clean({ code: row('OBSERVATION_CONFLICT', 'same_size_root_mismatch') })).code, 'membrane:conflict')
  assert.equal(membraneAdmit(clean({ actions: { verdict: 'APPEND_ONLY', reason: 'identical_trees_match', rotation: { failure: true } } })).code, 'membrane:rotation')
  assert.equal(membraneAdmit(clean({ memory: row('UNDETERMINED', 'verifier_unknown_output') })).code, 'membrane:undetermined')
  assert.equal(membraneAdmit(clean({ remembered: row('APPEND_ONLY', 'forged') })).code, 'membrane:unknown')
  assert.equal(membraneAdmit(clean({ code: row('ALLOW', 'identical_trees_match') })).code, 'membrane:unknown')
})
process.stdout.write(`  ${String(passed)}/${String(passed + failures)} arms green\n`)
if (failures > 0) {
  process.stdout.write('EFFECT IR MEMBRANE: RED\n')
  process.exit(1)
}
process.stdout.write('EFFECT IR MEMBRANE: GREEN\n')
process.exit(0)
