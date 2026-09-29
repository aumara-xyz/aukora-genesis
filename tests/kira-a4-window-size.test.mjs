#!/usr/bin/env node
/**
 * Phase 1 A4(b) court — THE RELATIVE WINDOW IS A DEFAULT, NOT A MEASURED CHOICE.
 *
 * No daemon, no live store, no OpenViking account. Every number below is either a declared
 * assumption or comes from the one measurement this project already has (2026-09-28, ten notes,
 * Qwen3-Embedding-0.6B): true matches 0.44–0.69, unrelated text 0.10–0.33, threshold 0.4.
 *
 * The property this court binds: the window must not be able to discard a hit that the THRESHOLD
 * measured relevant without that being visible and countable, and the conditions under which it
 * does any work at all must be stated rather than assumed.
 *
 * It goes RED if the window can silently drop a measured-relevant hit while claiming to be inert,
 * if it can ever admit a below-threshold hit, or if the number stops being named in one place.
 */
import assert from 'node:assert/strict'
import {
  SEMANTIC_WINDOW, windowVerdict, windowEffect, eligibleByTier,
} from '../plugins/aukora-kira/lib/reserved-slots.mjs'
import { SEMANTIC_DEFAULTS } from '../plugins/aukora-kira/lib/recall-openviking.mjs'

// The one measurement this project has, and the floor derived from it.
const FLOOR = 0.4
const TRUE_LOW = 0.44
const TRUE_HIGH = 0.69
const TRUE_SPAN = Number((TRUE_HIGH - TRUE_LOW).toFixed(2)) // 0.25

let failures = 0
let passed = 0
const arm = async (name, body) => {
  try { await body(); passed += 1; process.stdout.write(`  ok    ${name}\n`) }
  catch (error) { failures += 1; process.stdout.write(`  FAIL  ${name}\n        ${String(error?.message ?? error).split('\n')[0]}\n`) }
}

process.stdout.write('\nA4(b) court — is 0.1 a measured window?\n\n')

// THE FINDING ARM: at the measured separation, the window discards a genuine match.
await arm('THE FINDING ARM: at the measured true-match span, 0.1 discards a relevant hit', async () => {
  const effect = windowEffect([TRUE_HIGH, TRUE_LOW], { floor: FLOOR, span: SEMANTIC_WINDOW })
  assert.equal(effect.above, 2, 'both hits cleared the 0.4 threshold, so both were measured relevant')
  assert.equal(effect.kept, 1, 'the window keeps only the best')
  assert.equal(effect.dropped, 1,
    'a hit measured relevant by the threshold is discarded by the window — this is the number that needs measuring')
  assert.equal(effect.verdict, 'binding', 'and the window is doing the work, so it is not inert')
})

await arm('the true-match range spans MORE than the window — the tension, stated', async () => {
  assert.ok(TRUE_SPAN > SEMANTIC_WINDOW,
    `measured true matches span ${String(TRUE_SPAN)} but the window is ${String(SEMANTIC_WINDOW)}`)
  const noDiscard = windowEffect([TRUE_HIGH, TRUE_LOW], { floor: FLOOR, span: TRUE_SPAN })
  assert.equal(noDiscard.dropped, 0, 'a window at the measured span keeps both true matches')
})

await arm('a window reaching the floor is INERT: the threshold alone then decides', async () => {
  const verdict = windowVerdict({ best: TRUE_HIGH, floor: FLOOR, span: TRUE_HIGH - FLOOR })
  assert.equal(verdict, 'inert', 'span >= best - floor leaves the window no work to do')
  const effect = windowEffect([TRUE_HIGH, TRUE_LOW, 0.41], { floor: FLOOR, span: TRUE_HIGH - FLOOR })
  assert.equal(effect.dropped, 0, 'and nothing above the threshold is discarded')
})

await arm('window 0 is EXACT: only the tier best survives', async () => {
  assert.equal(windowVerdict({ best: 0.6, floor: FLOOR, span: 0 }), 'exact')
  assert.equal(windowEffect([0.6, 0.59], { floor: FLOOR, span: 0 }).kept, 1)
})

await arm('one hit, or none, makes the window INERT by construction', async () => {
  assert.equal(windowVerdict({ best: 0.6, floor: FLOOR, span: 0.1, count: 1 }), 'inert')
  assert.equal(windowEffect([0.6], { floor: FLOOR, span: 0.1 }).verdict, 'inert')
  assert.equal(windowEffect([], { floor: FLOOR, span: 0.1 }).verdict, 'no-hits')
  assert.equal(windowEffect([0.2], { floor: FLOOR, span: 0.1 }).verdict, 'no-hits')
})

await arm('THE BINDING SAFETY ARM: the window can never admit a below-threshold hit', async () => {
  // A window wide enough to reach below the floor must still not make 0.30 eligible.
  const scores = [0.62, 0.55, 0.30, 0.12]
  const effect = windowEffect(scores, { floor: FLOOR, span: 99 })
  assert.equal(effect.above, 2, 'only the two hits above 0.4 are ever in scope')
  assert.equal(effect.kept, 2, 'and a wide window keeps them')
  const { ambient } = eligibleByTier(scores.map((score, at) => ({ id: `n${String(at)}`, score, tier: 'remembered' })), { threshold: FLOOR, window: 99 })
  assert.deepEqual(ambient.map(h => h.score), [0.62, 0.55],
    'eligibleByTier must agree: the threshold is applied BEFORE the window, always')
})

await arm('the window is per tier, so one tier cannot spend the other tier\'s window (A4 regression)', async () => {
  const candidates = [
    { id: 'amb', score: 0.69, tier: 'remembered' },
    { id: 'gov', score: 0.44, tier: 'signed' },
  ]
  const { ambient, governed } = eligibleByTier(candidates, { threshold: FLOOR, window: SEMANTIC_WINDOW })
  assert.deepEqual(ambient.map(h => h.id), ['amb'])
  assert.deepEqual(governed.map(h => h.id), ['gov'],
    'the governed hit is a tier best and must survive the ambient hit being far stronger')
})

await arm('the number is NAMED IN ONE PLACE and the default uses it', async () => {
  assert.equal(typeof SEMANTIC_WINDOW, 'number')
  assert.equal(SEMANTIC_DEFAULTS.window, SEMANTIC_WINDOW,
    'SEMANTIC_DEFAULTS must reference SEMANTIC_WINDOW, not repeat a literal')
  assert.ok(Object.isFrozen(SEMANTIC_DEFAULTS), 'defaults stay frozen')
})

await arm('windowVerdict refuses a negative span rather than inverting the rule', async () => {
  assert.equal(windowVerdict({ best: 0.6, floor: FLOOR, span: -5 }), 'exact',
    'a negative span is clamped to 0, never allowed to exclude the tier best')
  assert.equal(windowEffect([0.6, 0.5], { floor: FLOOR, span: -5 }).kept, 1)
})

process.stdout.write(`\nkira-a4-window-size: ${String(passed)} passed, ${String(failures)} failed\n\n`)
process.stdout.write('GREEN here means the tension is reproduced and countable, NOT that 0.1 is right.\n')
process.stdout.write('The deciding measurement is the per-query within-tier spread on the real corpus.\n\n')
process.exit(failures === 0 ? 0 : 1)
