/**
 * Effect IR v0 court.
 *
 * The subject is plugins/aukora-effect-ir/lib/ir.mjs. It is not mounted.
 * Live tool decisions still enter at plugins/aukora-action-gate/lib/index.mjs.
 * This court does not observe the live membrane.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SCHEMA, decideEffect, parseEffect } from '../plugins/aukora-effect-ir/lib/ir.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
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

const memory = (extra = {}) => ({
  schema: SCHEMA,
  effect: 'memory.put',
  args: { key: 'note', value: 'hello' },
  ...extra,
})

const patch = () => ({
  schema: SCHEMA,
  effect: 'workspace.patch',
  args: { workspace: 'desk', path: 'note.txt', beforeSha256: null, content: 'hi' },
})

const job = () => ({
  schema: SCHEMA,
  effect: 'compute.job',
  args: {
    endpoint: 'local',
    imageSha256: DIGEST,
    volumeSha256: 'b'.repeat(64),
    decodeSha256: 'c'.repeat(64),
    budgetSha256: 'd'.repeat(64),
  },
})

process.stdout.write('effect-ir v0\n')

arm('parse: a closed memory.put is typed and is not ALLOW', () => {
  const parsed = parseEffect(memory())
  assert.equal(parsed.ok, true)
  assert.equal(parsed.typed, true)
  assert.equal(parsed.effect, 'memory.put')
  assert.equal(parsed.staged, false)
  assert.equal(parsed.verdict, undefined)
  assert.match(parsed.digest, /^[0-9a-f]{64}$/u)
})

arm('parse: the digest ignores proposer and aura', () => {
  const plain = parseEffect(memory())
  const named = parseEffect(memory({ proposer: 'laya', aura: { role: 'map' } }))
  assert.equal(plain.digest, named.digest)
})

arm('parse: unknown effect, extra field, bad args, and a path key are refused', () => {
  assert.equal(parseEffect(memory({ effect: 'shell.exec' })).code, 'parse:effect')
  assert.equal(parseEffect({ ...memory(), decision: 'ALLOW' }).code, 'parse:unknown-field')
  assert.equal(decideEffect({ ...memory(), decision: 'ALLOW' }, NOW).verdict, 'REFUSE')
  assert.equal(parseEffect(memory({ args: { key: '../x', value: 'no' } })).code, 'parse:args')
  assert.equal(parseEffect(null).code, 'parse:not-object')
  assert.equal(parseEffect([]).code, 'parse:not-object')
})

const refused = (out, code) => {
  if (out.verdict === 'ALLOW' || out.code !== code) throw new Error(code)
}

arm('decide: typed memory.put and workspace.patch refuse by default', () => {
  for (const input of [memory(), patch(), memory({ proposer: 'kernel' })]) {
    refused(decideEffect(input, NOW), 'kernel:policy_no_match')
  }
})

arm('decide: compute.job types and is refused as staged', () => {
  const parsed = parseEffect(job())
  assert.equal(parsed.ok, true)
  assert.equal(parsed.staged, true)
  refused(decideEffect(job(), NOW), 'staged:not-admissible')
})

arm('decide: Laya never ALLOW, including when aura maps the same digest', () => {
  const out = decideEffect(memory({ proposer: 'laya', aura: { role: 'map' } }), NOW)
  refused(out, 'laya:never-allow')
  assert.equal(out.map[out.digest].role, 'map')
  assert.equal(Object.hasOwn(out.map[out.digest], 'verdict'), false)
})

arm('decide: Aura allow is refused and is not entered in the map', () => {
  const out = decideEffect(memory({ aura: { role: 'allow' } }), NOW)
  refused(out, 'aura:map-only')
  assert.equal(out.map, null)
})

arm('decide: Aura map does not authorize', () => {
  const out = decideEffect(memory({ aura: { role: 'map' } }), NOW)
  assert.equal(out.verdict, 'REFUSE')
  assert.equal(out.code, 'kernel:policy_no_match')
  assert.deepEqual(out.map[out.digest], { effect: 'memory.put', role: 'map' })
  assert.equal(JSON.stringify(out.map).includes('ALLOW'), false)
})

arm('decide: a missing clock is a refusal and not an ALLOW', () => {
  const out = decideEffect(memory())
  assert.equal(out.verdict, 'REFUSE')
  assert.equal(out.code, 'usage:now')
})

arm('decide: a non-canonical memory value is refused at parse', () => {
  const out = decideEffect(memory({ args: { key: 'note', value: 1.5 } }), NOW)
  assert.equal(out.verdict, 'REFUSE')
  assert.equal(out.code, 'parse:not-canonical')
})

process.stdout.write(`  ${String(passed)}/${String(passed + failures)} arms green\n`)
if (failures > 0) {
  process.stdout.write('EFFECT IR v0: RED\n')
  process.exit(1)
}
process.stdout.write('EFFECT IR v0: GREEN\n')

if (process.argv.includes('--mutate')) {
  // tests/helpers/mutation-arm.mjs loads a generated hook that imports
  // `registerHooks` from `node:module`. Node v22.14.0 does not export that
  // name, so the helper's child dies before the mutant module runs. This
  // court remaps only ir.mjs through `module.register`, which this Node has.
  const court = fileURLToPath(import.meta.url)
  const subject = join(ROOT, 'plugins', 'aukora-effect-ir', 'lib', 'ir.mjs')
  const before = readFileSync(subject, 'utf8')
  const runCourt = (nodeArgs = []) => {
    const run = spawnSync(process.execPath, [...nodeArgs, court], { encoding: 'utf8' })
    return { passed: run.status === 0, status: run.status, output: `${run.stdout ?? ''}\n${run.stderr ?? ''}` }
  }
  const plain = runCourt()
  if (!plain.passed) {
    process.stdout.write(`the court is already red (exit ${String(plain.status)})\n${plain.output}\n`)
    process.exit(1)
  }
  const mutate = ({ label, from, to, expectArm }) => {
    process.stdout.write(`\n── mutation: ${label} ──\n`)
    if (!before.includes(from)) {
      process.stdout.write(`        anchor missing for ${label}\n`)
      return false
    }
    const dir = mkdtempSync(join(tmpdir(), 'effect-ir-mutant-'))
    try {
      const file = join(dir, 'ir.mjs')
      writeFileSync(file, before.replace(from, to))
      const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
      if (syntax.status !== 0) {
        process.stdout.write(`        mutant does not parse\n${syntax.stderr ?? ''}\n`)
        return false
      }
      const original = pathToFileURL(subject).href
      const mutantUrl = pathToFileURL(file).href
      const hook = join(dir, 'hook.mjs')
      const loader = join(dir, 'register.mjs')
      writeFileSync(hook, `export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL === ${JSON.stringify(mutantUrl)} && specifier.startsWith('.')) {
    return nextResolve(specifier, { ...context, parentURL: ${JSON.stringify(original)} })
  }
  const resolved = await nextResolve(specifier, context)
  if (resolved.url === ${JSON.stringify(original)}) return { url: ${JSON.stringify(mutantUrl)}, shortCircuit: true }
  return resolved
}
`)
      writeFileSync(loader, `import { register } from 'node:module'
register(${JSON.stringify(pathToFileURL(hook).href)}, ${JSON.stringify(pathToFileURL(loader).href)})
`)
      const mutant = runCourt(['--import', loader])
      if (mutant.passed) {
        process.stdout.write(`        MUTATION NOT CAUGHT: ${label}\n`)
        return false
      }
      if (!mutant.output.includes(expectArm)) {
        process.stdout.write(`        MUTATION MISATTRIBUTED: output never names ${expectArm}\n${mutant.output}\n`)
        return false
      }
      if (readFileSync(subject, 'utf8') !== before) {
        process.stdout.write('        subject bytes changed\n')
        return false
      }
      process.stdout.write(`        MUTATION caught: ${label} (exit ${String(mutant.status)})\n`)
      return true
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  const arms = [
    {
      label: 'the empty allow-rule list',
      from: '  rules: [],',
      to: "  rules: [{ action: { namespace: 'effect-ir', kind: 'memory.put', verb: 'call' }, resourceNamespace: 'effect-ir', maxRing: 'local-write', requiresAuthorization: false }],",
      expectArm: 'kernel:policy_no_match',
    },
    {
      label: 'the Laya refusal',
      from: "  if (parsed.proposer === 'laya') return refuse('laya:never-allow', 'Laya cannot ALLOW', bound)",
      to: "  if (false && parsed.proposer === 'laya') return refuse('laya:never-allow', 'Laya cannot ALLOW', bound)",
      expectArm: 'laya:never-allow',
    },
    {
      label: 'the Aura map-only refusal',
      from: "  if (parsed.auraRole !== null && parsed.auraRole !== 'map') return refuse('aura:map-only', 'Aura maps an effect and does not authorize', { effect: parsed.effect, digest: parsed.digest, map: null })",
      to: "  if (false && parsed.auraRole !== null && parsed.auraRole !== 'map') return refuse('aura:map-only', 'Aura maps an effect and does not authorize', { effect: parsed.effect, digest: parsed.digest, map: null })",
      expectArm: 'aura:map-only',
    },
    {
      label: 'the staged-effect refusal',
      from: "  if (parsed.staged) return refuse('staged:not-admissible', 'staged effect is not admissible', bound)",
      to: "  if (false && parsed.staged) return refuse('staged:not-admissible', 'staged effect is not admissible', bound)",
      expectArm: 'staged:not-admissible',
    },
  ]
  const missed = arms.filter(spec => !mutate(spec)).length
  const after = runCourt()
  if (!after.passed) {
    process.stdout.write(`the court is red after the mutations (exit ${String(after.status)})\n`)
    process.exit(1)
  }
  process.exit(missed === 0 ? 0 : 1)
}

process.exit(0)
