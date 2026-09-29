/**
 * Courts for continuity + sync-path metric stubs (MEMORY-SPEC-v4 §6).
 * Scratch only — no live agent, no store, no OV.
 */
import assert from 'node:assert/strict'
import {
  THREAD_CONTINUITY_SCRIPT,
  scoreContinuity,
  isJanuaryShaped,
  syncPathMetrics,
} from '../plugins/aukora-kira/lib/continuity-metrics.mjs'

let passed = 0
let failures = 0
const arm = async (name, body) => {
  try { await body(); passed += 1; process.stdout.write(`  ok    ${name}\n`) }
  catch (error) { failures += 1; process.stdout.write(`  FAIL  ${name}\n        ${String(error?.message ?? error).split('\n')[0]}\n`) }
}

await arm('healthy session scores non-silence and refuses fold-into-recall', async () => {
  const healthy = scoreContinuity({ pings: 3, replies: 3, injectionAttempts: 3, turns: 3, quietDeaths: 0 })
  assert.equal(healthy.non_silence_rate, 1)
  assert.equal(healthy.injection_attempt_rate, 1)
  assert.equal(healthy.quiet_death_events, 0)
  assert.equal(healthy.undetermined_to_empty_collapse, 0)
  assert.equal(healthy.fold_into_recall_at_ceiling, false)
  assert.equal(healthy.thread_continuity_at_N.status, 'UNLABELLED')
  assert.equal(isJanuaryShaped(healthy), false)
})

await arm('january-shaped quiet death is red and never folded into recall', async () => {
  const quiet = scoreContinuity({ pings: 11, replies: 0, injectionAttempts: 0, turns: 11, quietDeaths: 11 })
  assert.equal(quiet.non_silence_rate, 0)
  assert.equal(quiet.quiet_death_events, 11)
  assert.equal(isJanuaryShaped(quiet), true)
  assert.equal(quiet.fold_into_recall_at_ceiling, false)
})

await arm('undetermined→empty collapse is counted separately and must be zero when healthy', async () => {
  const bad = scoreContinuity({ pings: 2, replies: 2, injectionAttempts: 2, turns: 2, quietDeaths: 0, undeterminedToEmpty: 3 })
  assert.equal(bad.undetermined_to_empty_collapse, 3)
  const ok = scoreContinuity({ pings: 1, replies: 1, turns: 1, injectionAttempts: 1 })
  assert.equal(ok.undetermined_to_empty_collapse, 0)
})

await arm('rejects impossible observed counts', async () => {
  assert.throws(() => scoreContinuity({ pings: 1, replies: 2 }), /replies cannot exceed/)
  assert.throws(() => scoreContinuity({ pings: -1 }), /non-negative/)
})

await arm('thread continuity script stays UNLABELLED until Peter labels', async () => {
  assert.equal(THREAD_CONTINUITY_SCRIPT.labelStatus, 'UNLABELLED')
  assert.equal(THREAD_CONTINUITY_SCRIPT.turns.length, 2)
})

await arm('syncPathMetrics surfaces wastedReserved without claiming continuity', async () => {
  const m = syncPathMetrics({
    reserved: { wastedReserved: 2, droppedGoverned: 1, droppedAmbient: 0 },
    sync: { added: 3, removed: 1 },
    dropped: { unmapped: ['x'], belowThreshold: 4 },
  })
  assert.equal(m.wastedReserved, 2)
  assert.equal(m.droppedGoverned, 1)
  assert.equal(m.syncAdded, 3)
  assert.equal(m.syncRemoved, 1)
  assert.equal(m.droppedUnmapped, 1)
  assert.equal(m.droppedBelowThreshold, 4)
  assert.equal(m.fold_into_recall_at_ceiling, false)
  assert.equal(m.syncError, null)
})

await arm('syncPathMetrics records sync error string when present', async () => {
  const m = syncPathMetrics({ sync: { error: 'ECONNREFUSED' } })
  assert.equal(m.syncError, 'ECONNREFUSED')
  assert.equal(m.wastedReserved, 0)
})

process.stdout.write(`kira-continuity-metrics: ${passed} passed, ${failures} failed\n`)
process.exit(failures === 0 ? 0 : 1)
