/**
 * Phase 9 court — partial-failure policy.
 *
 * Proves (MEMORY-SPEC-v4 Phase 9 / GROK-REDTEAM-v4 A1):
 *   1. remembered.state is reconciled with outer availability (no found+undetermined coexistence).
 *   2. injection throw does NOT return the previous decision unchanged.
 *   3. each failure combo yields stop or ask for a consequential effect — not merely an
 *      undetermined count.
 *
 * No live store writes. No merge. No door_send. No become.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

if (process.argv.includes('--mutate')) {
  const run = args => spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], { encoding: 'utf8', timeout: 30_000 })
  const plain = run([]), mutant = run(['--mutant'])
  process.stdout.write(plain.stdout + plain.stderr)
  const caught = mutant.status === 1 && mutant.stdout.includes('FAIL  injection: throw path does not return previous decision unchanged')
  console.log(`Phase 9: ${Number(caught)}/1 fault-policy reverts caught`)
  if (!caught) process.stdout.write(mutant.stdout + mutant.stderr)
  process.exit(plain.status === 0 && caught ? 0 : 1)
}
if (process.argv.includes('--mutant')) registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context)
  if (!url.endsWith('/partial-failure.mjs')) return result
  const source = Buffer.from(result.source).toString('utf8')
  const from = 'export function mayReturnPreviousDecisionOnMemoryFault() {\n  return false\n}'
  if (source.split(from).length !== 2) throw new Error('fault-policy mutant anchor missing')
  return { ...result, source: source.replace(from, from.replace('return false', 'return true')) }
} })
const {
  decidePartialFailure,
  mayReturnPreviousDecisionOnMemoryFault,
  memoryFaultInjectionLine,
  reconcileRecallAvailability,
  rememberedStateOf,
} = await import('../plugins/aukora-kira/lib/partial-failure.mjs')
const { registerRecallInjection, MAX_INJECTION_CHARS } = await import('../plugins/aukora-kira/lib/injection.mjs')

let failures = 0
let passed = 0
const arm = async (name, body) => {
  try {
    await body()
    passed += 1
    process.stdout.write(`  ok    ${name}\n`)
  } catch (error) {
    failures += 1
    process.stdout.write(`  FAIL  ${name}\n        ${String(error?.message ?? error).split('\n')[0]}\n`)
  }
}

process.stdout.write('kira-partial-failure (Phase 9)\n')

await arm('policy: outer undetermined → stop (consequential must halt)', () => {
  for (const remembered of ['found', 'empty', 'undetermined', 'not-asked']) {
    const d = decidePartialFailure({ outer: 'undetermined', remembered })
    assert.equal(d.action, 'stop', `remembered=${remembered}`)
  }
})

await arm('policy: outer found + ambient undetermined → ask (not silent proceed)', () => {
  const d = decidePartialFailure({ outer: 'found', remembered: 'undetermined' })
  assert.equal(d.action, 'ask')
  assert.match(d.reason, /ambient remembered state is undetermined/u)
})

await arm('policy: outer empty + ambient undetermined → ask', () => {
  assert.equal(decidePartialFailure({ outer: 'empty', remembered: 'undetermined' }).action, 'ask')
})

await arm('policy: determined combos → proceed', () => {
  for (const [outer, remembered] of [
    ['found', 'found'],
    ['found', 'empty'],
    ['found', 'not-asked'],
    ['empty', 'found'],
    ['empty', 'empty'],
    ['empty', 'not-asked'],
  ]) {
    assert.equal(decidePartialFailure({ outer, remembered }).action, 'proceed', `${outer}+${remembered}`)
  }
})

await arm('reconcile: found + undetermined ambient downgrades outer availability', () => {
  const out = reconcileRecallAvailability(
    { availability: 'found', status: 'match', snippets: [{ text: 'governed hit' }], relations: [], interpretation: { kind: 'query' }, retrieval: {}, ceiling: [], state: {} },
    { state: 'undetermined', reason: 'semantic-recall-failed', notes: [] },
  )
  assert.equal(out.availability, 'undetermined')
  assert.equal(out.partialFailure.action, 'ask')
  assert.equal(out.partialFailure.outer, 'found')
  assert.equal(out.partialFailure.remembered, 'undetermined')
  assert.equal(out.remembered.state, 'undetermined')
  assert.notEqual(out.partialFailure.action, 'proceed')
})

await arm('reconcile: outer undetermined stays stop regardless of ambient found', () => {
  const out = reconcileRecallAvailability(
    { availability: 'undetermined', status: 'insufficient', reason: 'store-unverified', snippets: [], relations: [], interpretation: { kind: 'query' }, retrieval: {}, ceiling: [], state: {} },
    { state: 'found', notes: [{ id: 'rem:x', text: 'ambient' }] },
  )
  assert.equal(out.availability, 'undetermined')
  assert.equal(out.partialFailure.action, 'stop')
})

await arm('reconcile: healthy found+found proceeds without downgrade', () => {
  const out = reconcileRecallAvailability(
    { availability: 'found', status: 'match', snippets: [], relations: [], interpretation: { kind: 'query' }, retrieval: {}, ceiling: [], state: {} },
    { state: 'found', notes: [{ id: 'rem:y', text: 'note' }] },
  )
  assert.equal(out.availability, 'found')
  assert.equal(out.partialFailure.action, 'proceed')
})

await arm('guard: mayReturnPreviousDecisionOnMemoryFault is always false', () => {
  assert.equal(mayReturnPreviousDecisionOnMemoryFault(), false)
})

await arm('injection: throw path does not return previous decision unchanged', async () => {
  for (const failedLeg of ['governed', 'remembered', 'newest']) {
  const prior = Object.freeze({ kind: 'continue', messages: Object.freeze([{ id: 'prior', role: 'user', content: 'hello' }]) })
  const injected = []
  const seenFailures = []
  const reads = []
  const read = leg => {
    reads.push(leg)
    if (leg === failedLeg) throw Object.assign(new Error('simulated-recall-fault'), { code: 'kira.phase9:fault' })
    return { availability: 'found', snippets: [{ recordId: `fixture:${leg}`, text: `HEALTHY-SIBLING-${leg}` }] }
  }
  let preStep
  registerRecallInjection(
    {
      on: (_name, listener) => {
        preStep = listener
        return () => {}
      },
    },
    {
      conversation: {
        async turn() { return read('governed') },
      },
      remembered: async () => read('remembered'),
      newest: async () => read('newest'),
      queries: ['phase9 probe'],
      newId: () => 'phase9-fault-msg',
      onInjected: line => injected.push(line),
      onFailure: error => seenFailures.push(error),
    },
  )
  const result = await preStep({ agent: { session: {} } }, async () => prior)
  assert.equal(seenFailures.length, 1, 'onFailure must observe the throw')
  assert.notEqual(result, prior, 'must not return the previous decision object unchanged')
  assert.notDeepEqual(result.messages, prior.messages, 'messages must change — fault contribution required')
  assert.equal(injected.length, 1, 'fault line must be injected')
  assert.match(injected[0], /FAILED before a verified answer/u)
  assert.match(injected[0], /ASK before any consequential effect/u)
  assert.match(injected[0], /HEALTHY-SIBLING-/u, 'the healthy leg must survive a sibling fault')
  assert.deepEqual(reads, ['governed', 'remembered', 'newest'])
  assert.ok(injected[0].length <= MAX_INJECTION_CHARS)
  assert.equal(result.messages.at(-1).source.form, 'snapshot')
  assert.ok(result.messages.length === prior.messages.length + 1)
  assert.equal(result.kind, 'continue', 'turn itself still continues (fault is named, not a crash)')
  }
})

await arm('injection: fault line names stop/ask duty for consequential effects', () => {
  const line = memoryFaultInjectionLine({ code: 'kira.phase9:timeout' })
  assert.match(line, /kira\.phase9:timeout/u)
  assert.match(line, /ASK before any consequential effect/u)
  assert.match(line, /commit, raise, door_send, become/u)
})

await arm('consequential matrix: every undetermined combo is stop or ask (never proceed)', () => {
  const outers = ['found', 'empty', 'undetermined']
  const ambients = ['found', 'empty', 'undetermined', 'not-asked']
  const rows = []
  for (const outer of outers) {
    for (const remembered of ambients) {
      const d = decidePartialFailure({ outer, remembered })
      rows.push({ outer, remembered, action: d.action })
      if (outer === 'undetermined' || remembered === 'undetermined') {
        assert.ok(d.action === 'stop' || d.action === 'ask', JSON.stringify({ outer, remembered, action: d.action }))
        assert.notEqual(d.action, 'proceed')
      }
    }
  }
  // Load-bearing: counting undetermined alone is insufficient — actions must be named.
  assert.ok(rows.some(r => r.action === 'stop'))
  assert.ok(rows.some(r => r.action === 'ask'))
  assert.equal(rememberedStateOf({ state: 'undetermined' }), 'undetermined')
})

process.stdout.write(`\n${passed} passed, ${failures} failed\n`)
if (failures > 0) process.exit(1)
