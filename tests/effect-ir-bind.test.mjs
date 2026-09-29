/**
 * Failing arms for the Effect IR courts. Each arm removes one protection.
 * The child is the court file; this file does not edit the subject.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { proveMutation } from './effect-ir-mutate.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const court = (name) => join(ROOT, 'tests', name)
const subject = (name) => join(ROOT, 'plugins', 'aukora-effect-ir', 'lib', name)
const arms = [
  {
    label: 'closed-field refusal',
    court: court('effect-ir-parse.test.mjs'),
    subject: subject('parse.mjs'),
    from: "if (keys.some(key => typeof key !== 'string' || !allowed.includes(key))) return { ok: false, code: 'parse:unknown-field' }",
    to: "if (false) return { ok: false, code: 'parse:unknown-field' }",
    expectArm: 'unknown effect, extra field, bad args, and a non-object are refused',
  },
  {
    label: 'monotonic rank',
    court: court('effect-ir-laya.test.mjs'),
    subject: subject('laya.mjs'),
    from: 'if (LAYA_RANK[move] < LAYA_RANK[from]) {',
    to: 'if (false && LAYA_RANK[move] < LAYA_RANK[from]) {',
    expectArm: 'stop then ask is not monotonic',
  },
  {
    label: 'missing-prior exception',
    court: court('effect-ir-membrane.test.mjs'),
    subject: subject('membrane.mjs'),
    from: "if (row.reason === 'missing_prior_observation') continue",
    to: "if (false && row.reason === 'missing_prior_observation') continue",
    expectArm: 'a clean observation is admitted and a missing one is not',
  },
  {
    label: 'digest equality',
    court: court('effect-ir-identity.test.mjs'),
    subject: subject('identity.mjs'),
    from: 'if (sign !== see || execute !== see) {',
    to: 'if (false && (sign !== see || execute !== see)) {',
    expectArm: 'a different sign diverges',
  },
  {
    label: 'empty allow-rule list',
    court: court('effect-ir.test.mjs'),
    subject: subject('ir.mjs'),
    from: '  rules: [],',
    to: "  rules: [{ action: { namespace: 'effect-ir', kind: 'memory.put', verb: 'call' }, resourceNamespace: 'effect-ir', maxRing: 'local-write', requiresAuthorization: false }],",
    expectArm: 'kernel:policy_no_match',
  },
]

let missed = 0
for (const spec of arms) {
  const result = proveMutation(spec)
  if (!result.caught) {
    missed += 1
    process.stdout.write(`MUTATION NOT CAUGHT: ${spec.label} (${result.reason})\n${result.output ?? ''}\n`)
  } else {
    process.stdout.write(`MUTATION caught: ${spec.label} (exit ${String(result.status)})\n`)
  }
}
process.exit(missed === 0 ? 0 : 1)
