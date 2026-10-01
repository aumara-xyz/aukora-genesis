#!/usr/bin/env node
/**
 * THE TOOL'S OUTPUT SEAM — a result must VALIDATE against the schema the tool declares.
 *
 * This court exists because everything was green while the live tool was broken.
 *
 * On 2026-09-29 the running app (release 7933048d7) answered every non-empty `kira_recall` call with
 * `Error: tool "kira_recall" returned invalid output: "value.partialFailure" is not a declared
 * property (additionalProperties: false)`. `reconcileRecallAvailability` returns `partialFailure` on
 * every reconciled answer; `recallTool(...).output.schema` declared `additionalProperties: false` and
 * did not list it. The phase 9 courts bound the DECISION (`proceed | ask | stop`) and never bound that
 * the result the tool RETURNS is one the tool's own schema accepts. That is the seam this file binds.
 *
 * WHAT MAKES THIS BINDING RATHER THAN DECORATIVE. It reads the real schema from `recallTool` and the
 * real value from `reconcileRecallAvailability` — not copies — and asserts the one rule the host
 * enforces: with `additionalProperties: false`, every key of the value must appear in `properties`.
 * Delete `partialFailure` from the schema and this file goes red; add an undeclared field to the
 * return and it goes red too.
 *
 * CI-SAFE BY DESIGN. The host's own validator lives in the gitignored `vendor/dsh` tree, which the
 * CI workflow does NOT build (`check.yml` runs `sh scripts/check.sh` on a fresh checkout). So the
 * binding arms above use no harness import, and the real validator is used as a CROSS-CHECK when it
 * exists — reported loudly when it does not, never silently skipped.
 * Registration also checks every maintained tool factory and the definitions produced by actual
 * Kira apply, including its inline remember tool. No tool or capture event is executed by that arm.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as kiraTools from '../plugins/aukora-kira/lib/tools.mjs'
import { apply } from '../plugins/aukora-kira/lib/index.js'
import {
  reconcileRecallAvailability, PARTIAL_FAILURE_ACTIONS, REMEMBERED_STATES, STORE_AVAILABILITY,
} from '../plugins/aukora-kira/lib/partial-failure.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)
const { recallTool } = kiraTools

let failures = 0
let passed = 0
const arm = async (name, body) => {
  try { await body(); passed += 1; process.stdout.write(`  ok    ${name}\n`) }
  catch (error) { failures += 1; process.stdout.write(`  FAIL  ${name}\n        ${String(error?.message ?? error).split('\n')[0]}\n`) }
}

const schema = recallTool(() => {}).output.schema
const declared = Object.keys(schema.properties)

/** The rule the host applies to an object with `additionalProperties: false`. */
const undeclaredKeys = value => Object.keys(value).filter(key => !Object.hasOwn(schema.properties, key))

/** A realistic `kira.recall` answer, in the shape the conversation route returns. */
const answerOf = availability => ({
  availability,
  status: availability === 'found' ? 'match' : 'insufficient',
  snippets: [],
  relations: [],
  interpretation: { kind: 'query' },
  retrieval: {},
  ceiling: ['this answer grants no authority'],
  state: {},
})

process.stdout.write('\nkira_recall output seam — the result must satisfy the declared schema\n\n')

await arm('the tool declares an object schema that closes itself', async () => {
  assert.equal(schema.type, 'object')
  assert.equal(schema.additionalProperties, false,
    'this court only means something while additionalProperties is false')
  assert.ok(Array.isArray(declared) && declared.length > 0, 'the schema must declare properties')
})

await arm('THE BINDING ARM: every reconciled answer has NO undeclared key', async () => {
  // Every combination the seam can produce, because `partialFailure` is unconditional.
  for (const outer of STORE_AVAILABILITY) {
    for (const remembered of [...REMEMBERED_STATES, undefined]) {
      const result = reconcileRecallAvailability(answerOf(outer), remembered === undefined ? undefined : { state: remembered })
      const extra = undeclaredKeys(result)
      assert.deepEqual(extra, [],
        `outer=${outer} remembered=${String(remembered)}: the tool would reject this result — undeclared ${extra.join(', ')}`)
    }
  }
})

await arm('THE BINDING ARM: every reconciled answer carries the keys the schema REQUIRES', async () => {
  for (const outer of STORE_AVAILABILITY) {
    const result = reconcileRecallAvailability(answerOf(outer), { state: 'found' })
    const missing = (schema.required ?? []).filter(key => !Object.hasOwn(result, key))
    assert.deepEqual(missing, [], `outer=${outer}: the tool would reject this result — missing ${missing.join(', ')}`)
  }
})

await arm('partialFailure is DECLARED, and its declared shape covers exactly what is returned', async () => {
  const declaredShape = schema.properties.partialFailure
  assert.ok(declaredShape !== undefined,
    'partialFailure must be declared: it is returned unconditionally and the schema is closed')
  assert.equal(declaredShape.additionalProperties, false,
    'the nested object closes itself too, so a future sub-field cannot slip through undeclared')

  const returned = reconcileRecallAvailability(answerOf('found'), { state: 'found' }).partialFailure
  assert.deepEqual(Object.keys(declaredShape.properties).sort(), Object.keys(returned).sort(),
    'the declared sub-keys and the returned sub-keys must be the same set')
  assert.deepEqual([...declaredShape.required].sort(), Object.keys(returned).sort(),
    'every sub-key that is always returned must be required')
})

await arm('the schema enums ARE the policy arrays, so the two cannot drift', async () => {
  const shape = schema.properties.partialFailure.properties
  assert.deepEqual(shape.action.enum, [...PARTIAL_FAILURE_ACTIONS])
  assert.deepEqual(shape.outer.enum, [...STORE_AVAILABILITY])
  assert.deepEqual(shape.remembered.enum, [...REMEMBERED_STATES])
  assert.deepEqual(shape.reconciledAvailability.enum, [...STORE_AVAILABILITY])
})

await arm('the declared action enum is exactly the three the policy can return', async () => {
  const returned = new Set()
  for (const outer of STORE_AVAILABILITY) {
    for (const remembered of REMEMBERED_STATES) {
      returned.add(reconcileRecallAvailability(answerOf(outer), { state: remembered }).partialFailure.action)
    }
  }
  for (const action of returned) {
    assert.ok(PARTIAL_FAILURE_ACTIONS.includes(action), `${action} is returned but not declared`)
  }
  assert.ok(returned.size > 1, 'the corpus of answers above should exercise more than one action')
})

await arm('runtime count validation still rejects values the schema subset cannot constrain', async () => {
  for (const memory of [
    { dropped: -1, reasons: {} }, { dropped: 0.5, reasons: {} },
    { dropped: 0, reasons: { scope: -1 } }, { dropped: 0, reasons: { scope: 0.5 } },
    { dropped: 0, reasons: { scope: '1' } }, { dropped: 0, reasons: [] },
  ]) await assert.rejects(recallTool(async () => ({ memory })).execute({}, {}), /memory counts must be non-negative integers/u)
  const memory = { dropped: 2, reasons: { scope: 2 } }
  assert.deepEqual((await recallTool(async () => ({ memory })).execute({}, {})).memory, memory)
})

// ── the real validator, when the built harness is present ──────────────────────────────────────
// `vendor/dsh` is gitignored, so it exists only where the build ran — the main checkout, not this
// linked worktree. Resolve it the way tests/kira-memory-live-path.test.mjs does: an explicit
// --dsh / $AUKORA_DSH_SOURCE, then this tree, then the main checkout this worktree belongs to.
const commonDir = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: HERE, encoding: 'utf8' }).stdout?.trim()
const mainRoot = commonDir === undefined || commonDir === '' ? undefined : dirname(resolve(HERE, commonDir))
const dshArg = process.argv.includes('--dsh') ? process.argv[process.argv.indexOf('--dsh') + 1] : undefined
assert.ok(!process.argv.includes('--dsh') || (dshArg && !dshArg.startsWith('--')), '--dsh requires a harness directory')
// An explicit host path is authoritative, including an absent host; never silently use another.
const candidates = dshArg === undefined
  ? [process.env.AUKORA_DSH_SOURCE, join(ROOT, 'vendor', 'dsh'), mainRoot === undefined ? undefined : join(mainRoot, 'vendor', 'dsh')].filter(Boolean)
  : [dshArg]
const validatorPath = candidates.map(base => join(base, 'packages', 'core', 'tools', 'lib', 'types', 'json-schema.js')).find(existsSync)

if (validatorPath === undefined) {
  process.stdout.write('  ----  NOT RUN: the host validator is absent (vendor/dsh is gitignored and CI does not build it).\n')
  process.stdout.write('        Host registration/schema-support checks and original outage controls were NOT RUN.\n')
  process.stdout.write('        The binding arms above use the declared schema directly and do not need it.\n')
} else {
  const { validateJsonSchemaValue } = await import(pathToFileURL(validatorPath).href)
  await arm('CROSS-CHECK: the host\'s own validator accepts the reconciled answer', async () => {
    for (const outer of STORE_AVAILABILITY) {
      const result = reconcileRecallAvailability(answerOf(outer), { state: 'found' })
      const violations = validateJsonSchemaValue(schema, result)
      assert.deepEqual(violations, [], `host validator rejected: ${JSON.stringify(violations)}`)
    }
  })
  await arm('CROSS-CHECK: the host\'s own validator is what rejects an undeclared field', async () => {
    // The mutation this court exists for, executed against the real validator rather than described.
    const { partialFailure, ...stripped } = schema.properties
    const withoutIt = { ...schema, properties: stripped }
    const result = reconcileRecallAvailability(answerOf('found'), { state: 'found' })
    const violations = validateJsonSchemaValue(withoutIt, result)
    assert.ok(violations.some(one => String(one).includes('partialFailure') && String(one).includes('not a declared property')),
      `removing the declaration must be what the host rejects; got ${JSON.stringify(violations)}`)
  })
  const harness = resolve(dirname(validatorPath), '../../../../..')
  const toolsPath = join(harness, 'packages/core/tools/lib/index.js')
  const cordisPath = join(harness, 'vendor/cordis/lib/index.js')
  if (!existsSync(toolsPath) || !existsSync(cordisPath)) {
    process.stdout.write('  ----  NOT RUN: actual host ToolRuntime/Cordis is absent; registration checks and outage controls were NOT RUN.\n')
  } else await arm('HOST REGISTRATION: every actual Kira tool input/output schema; original outage rejected', async () => {
    const { ToolRuntime, JsonSchemaError, assertObjectJsonSchema, assertSupportedJsonSchema } = await import(pathToFileURL(toolsPath).href)
    const { Context } = await import(pathToFileURL(cordisPath).href)
    process.stdout.write(`        Host ToolRuntime: ${toolsPath}\n`)
    process.stdout.write(`        Host SHA256: ${createHash('sha256').update(readFileSync(toolsPath)).digest('hex')}\n`)
    const fixture = mkdtempSync(join(tmpdir(), 'kira-registration-seam-'))
    const ctx = new Context(), previousHome = process.env.AUKORA_OPENVIKING_HOME, previousFetch = globalThis.fetch
    try {
      assert.equal(statSync(fixture).mode & 0o777, 0o700)
      process.env.AUKORA_OPENVIKING_HOME = join(fixture, 'empty-openviking')
      let providerCalls = 0
      globalThis.fetch = () => { providerCalls += 1; throw Error('registration fixture prohibits network/provider calls') }
      ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {} })
      const runtime = new ToolRuntime(ctx, { mode: 'native' })
      ctx.provide('sessions', { flush: async () => true, get: () => undefined })
      const warnings = []
      const host = ctx.extend({ logger: { warn: message => warnings.push(message), info: () => {} } })
      const stateDir = join(fixture, 'kira-memory'); mkdirSync(stateDir, { mode: 0o700 })
      await apply(host, { memoryOwner: { stateDir, subject: `aukora:1:${'67'.repeat(32)}`, permittedPrivacy: ['local'] } })
      const mounted = runtime.view(undefined).visible
      assert.deepEqual([...mounted.keys()].sort(), ['kira_recall', 'kira_remember'])
      const definitions = new Map()
      // Discover exported factories so adding a maintained tool cannot silently omit it here.
      for (const [name, factory] of Object.entries(kiraTools)) {
        if (name.endsWith('Tool') && typeof factory === 'function') {
          const definition = factory() // constructors only; callbacks/provers are never invoked
          assert.ok(!definitions.has(definition.name), `duplicate factory for ${definition.name}`)
          definitions.set(definition.name, definition)
        }
      }
      assert.ok(definitions.size > 0, 'no maintained tool factories discovered')
      // Prefer the actual mounted definition, including remember's inline schema and recall closure.
      for (const [name, definition] of mounted) definitions.set(name, definition)
      for (const [name, definition] of definitions) {
        assertObjectJsonSchema(definition.parameters)
        assertSupportedJsonSchema(definition.output.schema)
        if (!mounted.has(name)) runtime.register(definition)
        process.stdout.write(`        ${name}: input/output supported; actual registry contains definition\n`)
      }
      assert.deepEqual([...runtime.view(undefined).visible.keys()].sort(), [...definitions.keys()].sort())
      assert.equal(runtime.sdkSchemas(undefined).length, definitions.size)
      assert.deepEqual(warnings, [])
      assert.equal(providerCalls, 0, 'registration must not call a provider')

      const current = runtime.view(undefined).visible.get('kira_recall')
      const original = structuredClone(current.output.schema)
      original.properties.memory.properties.dropped.minimum = 0
      original.properties.memory.properties.reasons.additionalProperties = { type: 'integer', minimum: 0 }
      const expectRejected = (schema, paths) => {
        let failure
        try { runtime.register({ ...current, name: 'kira_outage_control', output: { ...current.output, schema } }) }
        catch (error) { failure = error }
        assert.ok(failure instanceof JsonSchemaError, 'actual registration must reject unsupported schema')
        assert.deepEqual(failure.violations, paths)
        assert.ok(!runtime.view(undefined).visible.has('kira_outage_control'))
        process.stdout.write(`        Original outage control: ${failure.message}\n`)
      }
      expectRejected(original, [
        'schema.properties.memory.properties.dropped.minimum is not a supported keyword (subset: type/oneOf/properties/required/additionalProperties/items/enum/const + annotations)',
        'schema.properties.memory.properties.reasons.additionalProperties must be a boolean',
      ])
      const input = structuredClone(current.parameters)
      input.properties.text.minimum = 0
      assert.throws(() => assertObjectJsonSchema(input), error => error instanceof JsonSchemaError
        && error.violations.some(path => path.startsWith('schema.properties.text.minimum ')))
      process.stdout.write('        Unsupported input keyword rejected by the same host schema-support validator\n')
    } finally {
      try { await ctx.fiber._unload() }
      finally {
        globalThis.fetch = previousFetch
        if (previousHome === undefined) delete process.env.AUKORA_OPENVIKING_HOME
        else process.env.AUKORA_OPENVIKING_HOME = previousHome
        rmSync(fixture, { recursive: true, force: true })
      }
    }
  })
}

process.stdout.write(`\nkira-recall-output-seam: ${String(passed)} passed, ${String(failures)} failed\n\n`)
process.exit(failures === 0 ? 0 : 1)
