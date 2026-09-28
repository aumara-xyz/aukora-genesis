#!/usr/bin/env node
/**
 * PHASE 1 court — reserved slots for governed records (no live store, no OpenViking).
 */
import assert from 'node:assert/strict'
import { GOVERNED_RESERVED_SLOTS, mergeReservedSlots, refuseTierScoreMultiplier } from '../plugins/aukora-kira/lib/reserved-slots.mjs'

let failures = 0
let passed = 0
const arm = (name, body) => {
  try { body(); passed += 1; process.stdout.write(`  ok    ${name}\n`) }
  catch (error) {
    failures += 1
    process.stdout.write(`  FAIL  ${name}\n        ${String(error?.message ?? error).split('\n')[0].slice(0, 400)}\n`)
  }
}

arm('reserved default is 2', () => {
  assert.equal(GOVERNED_RESERVED_SLOTS, 2)
})

arm('tier score multiplier is refused', () => {
  const r = refuseTierScoreMultiplier()
  assert.equal(r.allowed, false)
  assert.match(r.reason, /reserved slots/i)
})

arm('fills up to 2 governed when eligible, rest ambient', () => {
  const ambient = [
    { id: 'rem:a', score: 0.9 },
    { id: 'rem:b', score: 0.8 },
    { id: 'rem:c', score: 0.7 },
  ]
  const governed = [
    { id: 'kira:1', score: 0.55, tier: 'signed' },
    { id: 'kira:2', score: 0.50, tier: 'signed' },
    { id: 'kira:3', score: 0.45, tier: 'signed' },
  ]
  const out = mergeReservedSlots({ ambient, governed, ceiling: 3, reserved: 2 })
  assert.equal(out.selected.length, 3)
  assert.equal(out.selected.filter(s => s.slot === 'governed').length, 2)
  assert.equal(out.selected.filter(s => s.slot === 'ambient').length, 1)
  assert.equal(out.selected[0].id, 'kira:1')
  assert.equal(out.selected[1].id, 'kira:2')
  assert.equal(out.selected[2].id, 'rem:a')
  assert.equal(out.wastedReserved, 0)
  assert.equal(out.droppedGoverned, 1) // kira:3
})

arm('wasted reserved when no governed clears eligibility', () => {
  const out = mergeReservedSlots({
    ambient: [{ id: 'rem:a', score: 0.9 }, { id: 'rem:b', score: 0.8 }, { id: 'rem:c', score: 0.7 }],
    governed: [],
    ceiling: 3,
    reserved: 2,
  })
  assert.equal(out.selected.length, 3)
  assert.equal(out.selected.every(s => s.slot === 'ambient'), true)
  assert.equal(out.wastedReserved, 2)
})

arm('never lets governed exceed reserved even if higher scored', () => {
  const out = mergeReservedSlots({
    ambient: [{ id: 'rem:a', score: 0.2 }],
    governed: [
      { id: 'kira:1', score: 0.99 },
      { id: 'kira:2', score: 0.98 },
      { id: 'kira:3', score: 0.97 },
      { id: 'kira:4', score: 0.96 },
    ],
    ceiling: 3,
    reserved: 2,
  })
  assert.equal(out.selected.filter(s => s.slot === 'governed').length, 2)
  assert.equal(out.droppedGoverned, 2)
})

arm('dedupes id across ambient and governed', () => {
  const out = mergeReservedSlots({
    ambient: [{ id: 'kira:1', score: 0.9 }],
    governed: [{ id: 'kira:1', score: 0.5 }],
    ceiling: 3,
    reserved: 2,
  })
  assert.equal(out.selected.filter(s => s.id === 'kira:1').length, 1)
  assert.equal(out.selected[0].slot, 'governed')
})

arm('ceiling 0 yields empty', () => {
  const out = mergeReservedSlots({
    ambient: [{ id: 'rem:a', score: 1 }],
    governed: [{ id: 'kira:1', score: 1 }],
    ceiling: 0,
  })
  assert.equal(out.selected.length, 0)
})

process.stdout.write(`kira-reserved-slots: ${passed} passed, ${failures} failed\n`)
process.exit(failures === 0 ? 0 : 1)
