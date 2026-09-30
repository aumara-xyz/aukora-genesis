/**
 * Phase 9 H1 court — consequential action-gate wiring.
 *
 * This drives the actual action-gate guard, not prompt wording or a recall counter:
 * a missing/partial trusted handoff refuses the effect before the stand-in body can run.
 * No live memory write, merge, become, or door_send is performed.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createPartialFailureLedger,
  PARTIAL_FAILURE_SERVICE,
} from '../plugins/aukora-kira/lib/partial-failure.mjs'
import { createGuard } from '../plugins/aukora-action-gate/lib/index.mjs'
import { CONSEQUENTIAL_TOOL_NAMES } from '../plugins/aukora-action-gate/lib/policy.mjs'

const root = mkdtempSync(join(tmpdir(), 'aukora-phase9-gate-'))
const auraDir = join(root, 'aura-actions')
mkdirSync(auraDir, { recursive: true })
const settings = {
  auraDir,
  home: root,
  supportRoot: join(root, 'support'),
  dshHome: join(root, 'dsh'),
  repoRoots: [root],
  releaseRoots: [],
  extraWritableRoots: [],
  networkAllow: [],
  allowLoopback: true,
  mainBranch: 'main',
  defaultWorkspace: root,
  allowTools: ['memory.put', ...CONSEQUENTIAL_TOOL_NAMES],
}
const agent = { id: 'phase9-gate-agent', session: { header: { cwd: root } } }
const calls = (name, state, id = name) => {
  const guard = createGuard({ settings, partialFailureOf: () => state })
  return guard({ name, arguments: {}, agent, callId: id })
}

let passed = 0
let failed = 0
const arm = (name, body) => {
  try {
    body()
    passed += 1
    process.stdout.write(`  ok    ${name}\n`)
  } catch (error) {
    failed += 1
    process.stdout.write(`  FAIL  ${name}\n        ${String(error?.message ?? error).split('\n')[0]}\n`)
  }
}

process.stdout.write('kira-consequential-gate (Phase 9 H1)\n')

arm('memory.put is automatic even before recall; it grants no authority', () => {
  assert.equal(calls('memory.put', undefined, 'missing'), undefined)
})

arm('outer undetermined stops workspace.patch', () => {
  const message = calls('workspace.patch', { outer: 'undetermined', remembered: 'found' }, 'outer-undetermined')
  assert.match(message, /STOP/u)
  assert.match(message, /must stop until memory can be verified/u)
})

arm('outer healthy plus ambient undetermined asks before kira_settle', () => {
  const message = calls('kira_settle', { outer: 'found', remembered: 'undetermined' }, 'ambient-undetermined')
  assert.match(message, /ASK the owner/u)
  assert.match(message, /memory:partial-failure:ask/u)
})

arm('verified determined state allows the guarded effect', () => {
  assert.equal(calls('memory.put', { outer: 'found', remembered: 'found' }, 'proceed'), undefined)
})

arm('all named consequential tools fail closed without a trusted handoff', () => {
  for (const name of ['workspace.patch', 'kira_settle', 'commit', 'raise', 'door_send', 'become']) {
    const message = calls(name, undefined, `missing-${name}`)
    assert.match(message, /partial-failure:stop/u, name)
  }
})

arm('non-consequential tool remains independent of partial-failure state', () => {
  const guard = createGuard({ settings, partialFailureOf: () => undefined })
  assert.equal(guard({ name: 'read', arguments: {}, agent, callId: 'read' }), undefined)
})

arm('ledger is per-agent and a turn fault invalidates its prior result', () => {
  const ledger = createPartialFailureLedger()
  const other = {}
  ledger.record(agent, { outer: 'found', remembered: 'found' })
  ledger.record(other, { outer: 'empty', remembered: 'not-asked' })
  assert.equal(ledger.forAgent(agent).action, 'proceed')
  assert.equal(ledger.forAgent(other).action, 'proceed')
  ledger.failure(agent)
  assert.equal(ledger.forAgent(agent).action, 'stop')
  assert.equal(ledger.forAgent(other).action, 'proceed')
  assert.equal(PARTIAL_FAILURE_SERVICE, 'kira.partialFailure')
})

process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
