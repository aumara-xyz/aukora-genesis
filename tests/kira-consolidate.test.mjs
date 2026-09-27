#!/usr/bin/env node
/**
 * THE CONSOLIDATION COURT — GOLDEN's harmless future court, built now rather than later.
 *
 * The Golden boundary permits a court in which "agents repeat one false report, preserve contrary evidence, and
 * test that the chorus creates no authority". That is what this is. The chorus below is three lanes repeating
 * ONE false claim, and every arm checks that repetition did not become evidence, authority, or a way to undo a
 * person's decision.
 *
 * EVERY EXPECTATION IS FIXED; the mutant changes the WORLD. And the store is a SCRATCH store under the system
 * temp directory — the live store is never touched by this file, or by anything it drives.
 *
 *   node tests/kira-consolidate.test.mjs [--mutate]
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {UNKNOWN_ANCESTRY, ancestrySetOf, authorityFieldsIn, buildCoreDigest, headlineOf, observationsOf, proposalDigestOf, stageCoreDigest} from '../plugins/aukora-kira/lib/consolidate.mjs'

const MUTATE = process.argv.includes('--mutate')
const ROOT = fileURLToPath(new URL('../', import.meta.url))
const { createMemoryOwner } = await import(pathToFileURL(join(ROOT, 'plugins/aukora-kira/lib/memory-owner.mjs')).href)
let arms = 0

const arm = async (name, scenario) => {
  arms += 1
  await scenario(false)
  if (!MUTATE) return
  await assert.rejects(() => scenario(true), () => true,
    `mutate arm ${name}: the check did not fail when its protection was removed`)
  process.stdout.write(`arm ${name}: fails when broken\n`)
}

const scratch = mkdtempSync(join(tmpdir(), 'kira-consolidate-'))
const owner = createMemoryOwner({ stateDir: join(scratch, 'state'), queueDir: join(scratch, 'queue') })
const queue = {
  enqueuePending: staged => owner.enqueuePending(staged),
  list: () => owner.listPending(),
  read: recordId => owner.readPending(recordId),
}
const rows = () => {
  try {
    const listed = owner.listPending()
    return Array.isArray(listed) ? listed : (listed?.entries ?? [])
  } catch { return [] }
}

const FALSE_CLAIM = 'the relay was compromised'
/**
 * A DETERMINISTIC KIRA RECORD IDENTIFIER, because the record contract requires one: MEASURED, a fixture id like
 * `summary-AURA` is refused with `source.recordId must be a deterministic KIRA record identifier`. A settled
 * lane summary IS a Kira record, so the fixture says so rather than inventing a friendlier shape.
 */
const kiraIdOf = (seed) => `kira:${createHash('sha256').update(seed, 'utf8').digest('hex')}`
/** One lane's newest settled summary. `ancestry` is the recorded thing it traces to. */
const settled = (lane, ancestry, claim = FALSE_CLAIM, extra = {}) => ({
  lane, recordId: kiraIdOf(`summary-${lane}`), settledAt: '2026-09-25T00:00:00Z', headline: claim, claim, ancestry, ...extra,
})

// 1. THREE LANES REPEAT ONE FALSE REPORT, AND THE DIGEST COUNTS ONE OBSERVATION.
await arm('three-restatements-with-shared-ancestry-count-as-one-observation', async (broken) => {
  // BROKEN: each lane's restatement traces to a DIFFERENT recorded thing — which is the only way three
  // restatements could honestly be three observations. What a hash-based count does by default, this does
  // deliberately: it treats every speaker as a source.
  const lanes = broken
    ? [settled('AURA', ['obs-1']), settled('BETA', ['obs-2']), settled('KIRA', ['obs-3'])]
    : [settled('AURA', ['obs-1']), settled('BETA', ['obs-1']), settled('KIRA', ['obs-1', 'obs-9'])]
  const digest = buildCoreDigest({ laneSummaries: lanes })
  assert.equal(digest.core.observations.length, 1,
    `three restatements of one observation are ONE observation: ${JSON.stringify(digest.core.observations.map(o => o.restaters))}`)
  const one = digest.core.observations[0]
  assert.equal(one.observations, 1, 'and the count says so in the record, not only in the array length')
  assert.deepEqual(one.restaters, ['AURA', 'BETA', 'KIRA'], 'while every lane that said it is named')
  assert.deepEqual(one.sharedAncestry, ['obs-1', 'obs-9'], 'and the shared record ids are shown, so the count can be checked')
})

// 2. A COUNT BASED ON HASHES WOULD SAY THREE — the difference is asserted directly, not implied.
await arm('hashes-and-signatures-are-not-independence', async (broken) => {
  const sameAncestry = [
    settled('AURA', ['obs-1'], FALSE_CLAIM, { sha256: 'aaa', signature: 'sig-1' }),
    settled('BETA', ['obs-1'], FALSE_CLAIM, { sha256: 'bbb', signature: 'sig-2' }),
    settled('KIRA', ['obs-1'], FALSE_CLAIM, { sha256: 'ccc', signature: 'sig-3' }),
  ]
  // THE NUMBER A HASH-BASED COUNT PRODUCES IS ASSERTED AS A FACT ABOUT THE FIXTURE, so the rule's whole point is
  // visible: three distinct hashes, one shared ancestry, and the count must follow the ancestry.
  assert.equal(new Set(sameAncestry.map(one => one.sha256)).size, 3, 'the fixture must carry three distinct hashes')
  // BROKEN: the ancestries are made DISTINCT, which is what treating every speaker as its own source assumes.
  const digest = buildCoreDigest({ laneSummaries: broken ? sameAncestry.map((one, index) => ({ ...one, ancestry: [`obs-${String(index)}`] })) : sameAncestry })
  assert.equal(digest.core.observations.length, 1,
    'three different hashes and three different signatures over ONE ancestry are still one observation')
})

// 3. UNKNOWN ANCESTRY IS REPORTED AS UNKNOWN, AND NEVER EARNS A VOTE.
await arm('unknown-ancestry-is-reported-and-never-votes', async (broken) => {
  // BROKEN: the unknown-ancestry restatement is handed a recorded ancestry, which is what "earning" a vote
  // would look like — it must change the count, and the assertion below must notice.
  const lanes = [
    settled('AURA', ['obs-1']), settled('BETA', ['obs-1']),
    settled('KIRA', broken ? ['obs-1'] : UNKNOWN_ANCESTRY),
  ]
  const digest = buildCoreDigest({ laneSummaries: lanes })
  // FIXED EXPECTATIONS. BROKEN gives the unknown-ancestry restatement a RECORDED ancestry — which is exactly
  // what "earning a vote" would look like, so the listing below must disappear and the arm must notice.
  assert.equal(digest.core.observations.length, 1, 'an unknown-ancestry restatement must not create a second observation')
  assert.equal(digest.core.unknownAncestry.length, 1, 'and it must be LISTED as unknown rather than dropped')
  assert.equal(digest.core.unknownAncestry[0].ancestry, UNKNOWN_ANCESTRY, 'still spelled unknown')
  assert.equal(digest.core.observations.some(one => one.restaters.includes('KIRA')), false,
    'and it must not appear among the restaters whose count is being relied on')
})

// 4. CONTRARY EVIDENCE SURVIVES BESIDE THE CLAIM.
await arm('contrary-evidence-survives-beside-the-claim', async (broken) => {
  const lanes = [settled('AURA', ['obs-1']), settled('BETA', ['obs-1']), settled('KIRA', ['obs-1'])]
  const counter = [{ lane: 'AUMA', claim: FALSE_CLAIM, headline: 'the relay logged a clean handshake at 03:12' }]
  // BROKEN: the counterevidence is not passed at all — the shape of "the chorus swallowed the dissent".
  const digest = buildCoreDigest({ laneSummaries: lanes, counterevidence: broken ? [] : counter })
  assert.equal(digest.core.counterevidence.length, 1, 'contrary evidence must be carried in the digest')
  assert.equal(digest.core.counterevidence[0].headline, counter[0].headline, 'verbatim, not summarised away')
  // AND IT IS NOT MERGED INTO ANYTHING: there is no field that combines it with the claim.
  assert.deepEqual(authorityFieldsIn(digest), [], 'and no field may combine agreement and disagreement into a score')
})

// 5. THE CHORUS CREATES NO PERMISSION FIELD AND DOES NOT FLIP A DECLINED PROPOSAL.
await arm('the-chorus-creates-no-authority-and-cannot-reopen-a-decline', async (broken) => {
  const lanes = [settled('AURA', ['obs-1']), settled('BETA', ['obs-1']), settled('KIRA', ['obs-1'])]
  // TWO DIFFERENT FACTS, DELIBERATELY: `core.declined` NAMES decisions already made (an older proposal a
  // person refused), while `declinedDigests` is what makes the stager refuse to bring THIS candidate back. A
  // list of past decisions cannot include the candidate's own digest, because that digest is computed FROM the
  // content — so the record names the past, and the stager is told about the present.
  const declinedEarlier = [{ digest: kiraIdOf('an-older-declined-proposal'), declinedAt: '2026-09-24T00:00:00Z', reason: 'a person refused it' }]
  const digest = buildCoreDigest({ laneSummaries: lanes, declined: declinedEarlier })
  assert.deepEqual(authorityFieldsIn(digest), [],
    `a digest must carry no authority-shaped field: ${JSON.stringify(authorityFieldsIn(digest))}`)
  assert.equal(digest.core.declined.length, 1, 'and a declined proposal is NAMED in the digest rather than forgotten')
  assert.equal(digest.core.declined[0].reason, 'a person refused it', 'with the reason a person gave, kept verbatim')
  const before = rows().length
  // BROKEN: this candidate's own decline is not passed to the stager, so a refused proposal comes back as pending.
  const outcome = stageCoreDigest(queue, digest, {
    subject: 'subject-under-test', privacy: 'local', now: '2026-09-25T00:00:00Z',
    declinedDigests: broken ? [] : [digest.proposalDigest],
  })
  assert.equal(outcome.staged, false, 'a declined proposal must NOT be staged again')
  assert.equal(outcome.reason, 'already-declined', `and the refusal must name the reason: ${JSON.stringify(outcome)}`)
  assert.equal(rows().length, before, 'so nothing changed in the queue')
})

// 5b. ONE VOICE PER LANE: AN OLDER SUMMARY IN THE SAME LANE IS NOT A SECOND SOURCE.
await arm('only-the-newest-settled-summary-per-lane-is-indexed', async (broken) => {
  const older = { ...settled('AURA', ['obs-1']), recordId: kiraIdOf('summary-AURA-older'), settledAt: '2026-09-01T00:00:00Z', headline: 'the relay was fine', claim: 'the relay was fine' }
  const newer = { ...settled('AURA', ['obs-1']), settledAt: '2026-09-25T00:00:00Z' }
  // BROKEN: the OLDER summary is given the later settled time, so the lane's superseded claim is what gets
  // indexed — the failure this arm exists to catch, and one the dedupe alone cannot prevent.
  const stamp = broken ? { ...older, settledAt: '2026-09-30T00:00:00Z' } : older
  const digest = buildCoreDigest({ laneSummaries: [newer, stamp] })
  assert.equal(digest.core.lanes.length, 1, 'a lane appears once, whatever it has settled before')
  assert.equal(digest.core.lanes[0].settledAt, '2026-09-25T00:00:00Z', 'and it is the NEWEST of them')
  assert.equal(digest.core.observations.length, 1, 'so an older claim in the same lane cannot add an observation')
  assert.equal(digest.core.observations[0].headline, newer.headline, 'and the claim indexed is the one the lane now holds')
})

// 6. ONE WRITE, ONE PROPOSAL, AND IT IS PENDING — never settled by this path.
await arm('one-core-record-is-staged-and-it-is-only-a-proposal', async (broken) => {
  const lanes = [settled('AURA', ['obs-1']), settled('BETA', ['obs-1'])]
  const digest = buildCoreDigest({ laneSummaries: lanes })
  const before = rows().length
  let writes = 0
  const counting = { enqueuePending: (staged) => { writes += 1; return owner.enqueuePending(staged) } }
  const outcome = stageCoreDigest(counting, digest, { subject: 'subject-under-test', privacy: 'local', now: '2026-09-25T00:00:00Z' })
  assert.equal(outcome.staged, true, `one core record must stage: ${JSON.stringify(outcome)}`)
  // BROKEN: ONE DIGEST PER LANE — the shape of "a proposal per lane", which is what a per-speaker count would
  // have produced. The invariant below is what stops a chorus becoming a queue of near-identical proposals.
  if (broken) {
    for (const lane of lanes) {
      stageCoreDigest(counting, buildCoreDigest({ laneSummaries: [lane] }), { subject: 'subject-under-test', privacy: 'local', now: '2026-09-25T00:00:00Z' })
    }
  }
  assert.equal(writes, 1, 'ONE write for one digest, however many lanes are in it')
  assert.equal(rows().length, before + 1, 'exactly one entry, not one per lane')
  // ITS OWN ROW, BY ID — NOT THE LAST ONE. MEASURED: this arm used to read the last queue row, and in a
  // `--mutate` run an EARLIER arm's mutant had left a row of its own behind, so this arm failed on that row's
  // sources. The fault was cross-arm coupling in the court, not in the module, and reading by id removes the
  // coupling instead of depending on the order the arms happen to run in.
  const row = rows().find(one => one.recordId === outcome.recordId)
  assert.notEqual(row, undefined, 'the staged record must be the one the stager named')
  assert.equal(row.state, 'pending', 'and it is PENDING: this path has no settle in it')
  const entry = owner.readPending(outcome.recordId).entry
  assert.equal(entry.record.kind, 'summary')
  assert.equal(entry.record.content.label, 'model-inference')
  assert.deepEqual(entry.record.source, [{ recordId: kiraIdOf('summary-AURA') }, { recordId: kiraIdOf('summary-BETA') }],
    'the settled summaries are cited as sources, as record references')
})

// 6b. AN AUTHORITY-SHAPED FIELD IS REFUSED BEFORE IT REACHES A REVIEWER.
await arm('an-authority-shaped-field-is-refused-outright', async (broken) => {
  const digest = buildCoreDigest({ laneSummaries: [settled('AURA', ['obs-1'])] })
  const before = rows().length
  // BROKEN: the poison is absent, so the digest stages and the refusal below cannot happen.
  const poisoned = broken ? digest : { ...digest, core: { ...digest.core, authority: 'approved' } }
  const outcome = stageCoreDigest(queue, poisoned, { subject: 'subject-under-test', privacy: 'local', now: '2026-09-25T00:00:00Z' })
  assert.equal(outcome.staged, false, `a digest carrying authority must not stage: ${JSON.stringify(outcome)}`)
  assert.match(String(outcome.reason), /^authority-field:/u, 'and the refusal must name the field it found')
  assert.equal(rows().length, before, 'so a reviewer never sees a record that could be read as permission')
})

// 7. THE STAGE PATH IMPORTS NO SETTLE ANYTHING — a static arm, because "never settled" is a property of the code.
await arm('the-module-imports-no-settle-path', async (broken) => {
  const source = readFileSync(join(ROOT, 'plugins/aukora-kira/lib/consolidate.mjs'), 'utf8')
  const imports = [...source.matchAll(/^\s*import[^\n]*from\s+'([^']+)'/gmu)].map(match => match[1])
  const settling = imports.filter(spec => /settle|settlement/u.test(spec))
  assert.deepEqual(broken ? [...settling, './settle.mjs'] : settling, [],
    `consolidation must not import a settle path: ${JSON.stringify(settling)}`)
  assert.deepEqual(imports.sort(), ['./record.mjs', 'node:crypto'], 'and its imports are exactly these two')
})

// 8. THE SAME INPUTS GIVE THE SAME BYTES — determinism is what makes the digest comparable at all.
await arm('the-digest-is-deterministic', async (broken) => {
  const lanes = [settled('KIRA', ['obs-1'], FALSE_CLAIM), settled('AURA', ['obs-1'], FALSE_CLAIM)]
  const once = buildCoreDigest({ laneSummaries: lanes })
  const twice = buildCoreDigest({ laneSummaries: [...lanes].reverse() })
  assert.equal(twice.proposalDigest, once.proposalDigest, 'a digest must not depend on the order its inputs arrived in')
  // AND THE ASSERTION ABOVE MUST BE ABLE TO FAIL: with a lane ADDED, the digest must change. (The first mutant
  // here reversed the order and moved `now` — neither of which the module reads for the digest, so it could
  // not redden: an arm whose mutation cannot change the outcome is not measuring the property it names.)
  const more = broken
    ? buildCoreDigest({ laneSummaries: lanes })
    : buildCoreDigest({ laneSummaries: [...lanes, settled('ALPHA', ['obs-2'], 'a second, different claim')] })
  assert.notEqual(more.proposalDigest, once.proposalDigest, 'a changed input must change the digest')
  assert.equal(headlineOf('a\nb'), 'a', 'and a headline is the first line')
  assert.equal(observationsOf([]).observations.length, 0, 'an empty input is an empty index, not an error')
})


// 11. RECORDING A DECLINE MUST NOT CHANGE THE IDENTITY BEING REFUSED. Decline history is BOOKKEEPING about a
//     proposal, not part of the proposal: if it enters the digest, then recording a rejection mints a NEW identity
//     for UNCHANGED lane claims — and the new identity walks straight past the `already-declined` gate, which is
//     how a refusal becomes pending work again. Red-first: this arm fails today.
await arm('recording-a-decline-does-not-change-the-identity-being-refused', async (broken) => {
  const lanes = [settled('AURA', ['obs-1'], FALSE_CLAIM)]
  const before = buildCoreDigest({ laneSummaries: lanes })
  const after = buildCoreDigest({
    laneSummaries: lanes,
    declined: [{ digest: before.proposalDigest, declinedAt: '2026-09-25T00:00:00Z', reason: 'refused by a person' }],
  })
  // THE TWO IDENTITIES, AND THE MUTANT IS THE DEFECT ITSELF: `broken` takes the identity from the WHOLE core —
  // declines included — which is exactly the shape this finding is about, so the same claims get two identities.
  const identityOf = (digest) => (broken ? proposalDigestOf({ ...digest.core }) : digest.proposalDigest)
  assert.equal(identityOf(after), identityOf(before),
    'the same lane claims must keep ONE identity, whether or not a decline was recorded against it')
  // AND THE GATE MUST STILL HOLD: the declined proposal may not be staged again.
  const outcome = stageCoreDigest(queue, after, {
    subject: 'subject-under-test', privacy: 'local', now: '2026-09-25T00:00:00Z',
    declinedDigests: [identityOf(before)],
  })
  assert.equal(outcome.staged, false, 'a declined proposal must not come back as pending work')
  assert.equal(outcome.reason, 'already-declined', `and it must refuse by that name: ${String(outcome.reason)}`)
})

// 12. AND CONTENT DRIFT INVALIDATES THE DIGEST — the other half of the same requirement, so that "stable" cannot
//     be achieved by ignoring the content. Red-first: nothing verifies a digest against what is being staged.
await arm('content-drift-invalidates-the-digest-and-staging-verifies-it', async (broken) => {
  const digest = buildCoreDigest({ laneSummaries: [settled('AURA', ['obs-1'], FALSE_CLAIM)] })
  const drifted = {
    ...digest,
    core: { ...digest.core, lanes: [{ ...digest.core.lanes[0], headline: 'a headline nobody proposed' }] },
  }
  // BROKEN: the digest that MATCHES its content is staged, so the refusal below cannot happen and the arm shows
  // that the check is what stops the drifted one.
  const outcome = stageCoreDigest(queue, broken ? digest : drifted, {
    subject: 'subject-under-test', privacy: 'local', now: '2026-09-25T00:00:00Z',
  })
  assert.equal(outcome.staged, false, 'a digest that does not describe the content being staged must be refused')
  assert.equal(outcome.reason, 'digest-mismatch', `and it must refuse by that name: ${String(outcome.reason)}`)
})


// 13. THE UNKNOWN SENTINEL INSIDE AN ARRAY IS STILL THE SENTINEL. `ancestrySetOf` returned a STRING for the scalar
//     sentinel but an ARRAY for `['unknown']`, and an array is never `=== UNKNOWN_ANCESTRY` — so two lanes that both
//     said "my ancestry is not recorded" were treated as two summaries that SHARE a recorded observation, and the
//     unknown sentinel earned a vote. Red-first: this arm fails today.
await arm('the-unknown-sentinel-inside-an-array-never-votes', async (broken) => {
  // BROKEN: the DEFECT'S OWN NORMALIZATION, reproduced locally — filter the empties and keep the sentinel — which
  // is what the module did. The live assertions below use the module itself, so the arm measures the shipped code.
  const normalize = (raw) => (broken
    ? raw.filter(one => typeof one === 'string' && one !== '')
    : ancestrySetOf({ ancestry: raw }))
  assert.equal(normalize(['unknown']), UNKNOWN_ANCESTRY,
    'a list whose only entry is the sentinel IS the sentinel, not an ancestry')
  const digest = buildCoreDigest({
    laneSummaries: [settled('AURA', ['unknown'], FALSE_CLAIM), settled('BETA', ['unknown'], FALSE_CLAIM)],
  })
  assert.equal(digest.core.observations.length, 0,
    'two lanes that recorded NO ancestry are not each other\'s corroboration: the sentinel never votes')
  assert.equal(digest.core.unknownAncestry.length, 2, 'and both are reported as unknown, side by side')
})

// 14. A MIXED LIST KEEPS ITS REAL IDS AND DROPS THE SENTINEL — the sentinel is excluded, not the whole list.
await arm('a-mixed-ancestry-list-keeps-its-real-ids-and-drops-the-sentinel', async (broken) => {
  // BROKEN: the filter without the sentinel exclusion, which keeps `unknown` beside a real id and lets it take part
  // in overlap while claiming to be an identifier.
  const normalize = (raw) => (broken
    ? raw.filter(one => typeof one === 'string' && one !== '')
    : ancestrySetOf({ ancestry: raw }))
  assert.deepEqual(normalize(['obs-1', 'unknown']), ['obs-1'],
    'the real identifier stands and the sentinel is dropped: a partly-known ancestry is still known')
  assert.deepEqual(normalize(['unknown', 'obs-1']), ['obs-1'], 'in whatever order they arrived')
})


// 15. THE DIGEST AND ITS CONTENT CANNOT BE MADE TO DISAGREE. Staging copies nested contents while carrying the
//     digest that was computed earlier, so if a caller can still reach into the core after it was built, the bytes
//     that get staged are not the bytes the digest describes. Freezing was SHALLOW: the outer objects were frozen
//     and the arrays and lane objects inside them were not. Red-first: the nested assertions below fail today.
await arm('the-digest-and-its-content-cannot-be-made-to-disagree', async (broken) => {
  const digest = buildCoreDigest({
    laneSummaries: [
      settled('AURA', ['obs-1'], FALSE_CLAIM),
      settled('BETA', ['obs-1'], FALSE_CLAIM),
      settled('KIRA', ['obs-1'], FALSE_CLAIM),
    ],
  })
  // BROKEN: THE SHALLOW FREEZE, REPRODUCED ON A LIVE STRUCTURE. Freezing a COPY of the fixed core proves nothing —
  // its children are already frozen, so the copy is inert and the arm would redden nothing while appearing to
  // measure the defect (measured: that is exactly what the first version did). The mutant therefore freezes a
  // FRESH structure at its top level only, which is the shape the module actually had.
  const live = { lanes: [{ lane: 'AURA' }], observations: [{ restaters: ['AURA'], sharedAncestry: ['obs-1'], summaryIds: ['s-1'] }] }
  const core = broken ? Object.freeze({ ...live }) : digest.core
  assert.ok(Object.isFrozen(core), 'the core is frozen')
  assert.ok(Object.isFrozen(core.lanes), 'and the lane LIST is frozen')
  assert.ok(Object.isFrozen(core.lanes[0]), 'BUT THE LANE OBJECTS INSIDE IT MUST BE FROZEN TOO')
  const one = core.observations[0]
  assert.ok(Object.isFrozen(one), 'an observation is frozen')
  assert.ok(Object.isFrozen(one.restaters), 'and so is every array it carries')
  assert.ok(Object.isFrozen(one.sharedAncestry), 'every one of them')
  // AND A WRITE INTO A FROZEN CORE IS REFUSED, which is the property the digest depends on: content that can change
  // after the digest is computed is content the digest does not describe.
  assert.throws(() => { core.lanes.push({ lane: 'INVENTED' }) }, 'a lane cannot be added after the fact')
  assert.throws(() => { core.observations[0].restaters.push('INVENTED') }, 'nor a restater')
})

console.log(`kira-consolidate: ok${MUTATE ? ` (${String(arms)} arms)` : ''} — `
  + `${String(rows().length)} queue entr(ies), scratch store only`)
process.on('exit', () => { try { rmSync(scratch, { recursive: true, force: true }) } catch { /* gone */ } })
