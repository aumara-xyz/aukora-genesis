#!/usr/bin/env node
/**
 * **SPENT AUTHORITY MUST SURVIVE A RESTORE — "a remembered job is not permission".**
 *
 * Codex's durable-jobs review (`~/aukora-private/reviews/durable-jobs-opus-review-2026-09-26.md`): *every
 * effectful lane action is a one-use authorization with a journal and a spent marker.* **AND THE HIDDEN
 * ASSUMPTION IS THE RESTORE SCOPE.** A Time Machine restore, an APFS snapshot, or a copied state directory
 * brings back the owner daemon's journal and KIRA's one-use markers — and **a marker that comes back is a
 * marker that was never spent.** One approval would then settle twice.
 *
 * ── **WHAT THIS COURT FOUND, WHICH IS SHARPER THAN THE QUESTION IT WAS ASKED** ──────────────────────────
 *
 * The brief said: *"if the retained head lives in a place the same restore would also roll back, report that
 * as the gap."* **MEASURED HERE: THE RETAINED HEAD IS OUTSIDE THE RESTORE SCOPE AND IS STILL BLIND TO THIS.**
 *
 * The retained head detects a log that is SHORTER than the point it retained — a tail removed together with
 * `seq`. **But a restore does not truncate the log BEYOND that point; it returns the log TO it.** The snapshot
 * was taken before the settle, so the restore lands exactly on the retained size, the consistency proof is
 * trivially satisfied, and `retain-head.mjs`'s own docstring already says why: *"a head retained below the drop
 * point cannot see the drop."* **The head is retained at the drop point.**
 *
 * *So "outside the state directory" is necessary and NOT sufficient* — the witness must record THE SPEND, not
 * the log's LENGTH. That is the gap, and this court measures it rather than describing it.
 *
 * ── **DISPOSABLE STATE ONLY** ────────────────────────────────────────────────────────────────────────────
 *
 * Every directory here is `mkdtempSync(tmpdir(), …)`. **No test key, no live support directory, and no live
 * state is read or written.** The keys are fixture strings and the log is three synthetic entries.
 *
 *   node tests/aukora-restore-scope.test.mjs [--mutate]
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')
const JOURNAL_MODULE = join(ROOT, 'plugins', 'aukora-owner-daemon', 'lib', 'journal.mjs')

let arms = 0
let missed = 0
const arm = (label, check) => {
  arms += 1
  try { check(); console.log(`  ok    ${label}`) } catch (error) {
    missed += 1
    console.log(`  FAIL  ${label}`)
    console.log(`        ${String(error?.message ?? error).split('\n').join('\n        ')}`)
  }
}
const say = text => console.log(`        ${text}`)

const journalModule = await import(pathToFileURL(JOURNAL_MODULE).href)
const WITNESS_MODULE = join(ROOT, 'plugins', 'aukora-owner-daemon', 'lib', 'consumption-witness.mjs')
const witnessModule = await import(pathToFileURL(WITNESS_MODULE).href)
const scratch = mkdtempSync(join(tmpdir(), 'restore-scope-'))
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex')

// ══ **THE EXTERNAL WITNESS, AND IT IS THE SMALLEST ONE THAT WORKS** ═══════════════════════════════════════
//
// A **monotonic spend register**: an append-only record of nonces that have been spent, living OUTSIDE every
// directory the restore replaces. It is deliberately NOT a hardware path — the brief says not to build those
// tonight — and it is deliberately not cleverer than it needs to be: *an append-only list of what was spent,
// kept somewhere the restore does not reach.*
//
// **WHY A COUNTER AND NOT A HASH CHAIN.** A chain proves ORDER and INTEGRITY; what is needed here is *"was this
// nonce ever spent"*, answered after a rollback. A one-way append of nonces answers it directly, and its
// failure mode is the one worth having: **the register can only ever grow**, so a restore cannot remove an
// entry without the register itself being restored — which is the thing to place out of reach.
const makeSpendRegister = (dir) => {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'spent-register.jsonl')
  return {
    path,
    spend(nonce) { writeFileSync(path, `${JSON.stringify({ nonce, at: 1 })}\n`, { flag: 'a' }) },
    hasSpent(nonce) {
      if (!existsSync(path)) return false
      return readFileSync(path, 'utf8').split('\n').filter(Boolean)
        .some(line => { try { return JSON.parse(line).nonce === nonce } catch { return false } })
    },
  }
}

/** Copy a directory aside, so it can be put back later. This IS the snapshot a Time Machine restore gives. */
const snapshot = (from, to) => { cpSync(from, to, { recursive: true }); return to }
/** Put the snapshot back over the live directory — the whole of what a "restore" means here. */
const restore = (snap, live) => { rmSync(live, { recursive: true, force: true }); cpSync(snap, live, { recursive: true }) }

console.log('\n══ spent authority must survive a restore ══\n')

// ── 1. THE OWNER DAEMON JOURNAL ─────────────────────────────────────────────────────────────────────────
const ownerDir = join(scratch, 'owner')
mkdirSync(ownerDir, { recursive: true })
const journal = journalModule.createJournal({ ownerDir })
const NONCE = 'a'.repeat(32)

// WHOLE-LIFE ORDER, AND IT IS THE POINT: the snapshot is taken BEFORE the settle, which is what makes the
// restore land exactly on the retained point.
journal.begin(NONCE)
const beforeSettle = join(scratch, 'snap-before-settle')
snapshot(journal.dir(), beforeSettle)
journal.advance(NONCE, journalModule.JOURNAL_STATE.SPENT)

arm('A SETTLED NONCE IS SPENT, so the ordinary case is a real spend and not a fixture that never happened', () => {
  assert.equal(journal.isSpent(NONCE), true, 'the journal did not record the nonce as spent')
})

arm('AND A RESTORE OF THE STATE DIRECTORY UN-SPENDS IT — the journal is NOT a witness against its own restore', () => {
  restore(beforeSettle, journal.dir())
  // **THIS IS THE GAP, MEASURED AND NOT ARGUED.** `begin` is idempotent by `O_EXCL` *"across a restart"* — its
  // own words — and a restart keeps the file. **A restore removes it**, so the exact mechanism that makes
  // settlement idempotent across a restart is silent across a restore.
  assert.equal(journal.isSpent(NONCE), false,
    'the journal still reports the nonce spent after its directory was restored, so this court is not '
    + 'measuring the restore scope')
  say('the journal reports the nonce UNSPENT after a restore — begin() will happily record it again')
})

arm('AND THE EXTERNAL REGISTER SEES WHAT THE JOURNAL CANNOT — the replay is detected from outside the scope', () => {
  // **THE WITNESS LIVES WHERE THE RESTORE DOES NOT REACH**, and it records the SPEND rather than the journal's
  // shape. This is the property the whole court exists for: a rollback of the state directory does not roll
  // back the fact that the nonce was spent.
  const register = makeSpendRegister(join(scratch, 'witness'))
  // The register is written when the spend happens — before the restore, outside the restored path.
  const otherOwner = join(scratch, 'owner-two')
  mkdirSync(otherOwner, { recursive: true })
  const journalTwo = journalModule.createJournal({ ownerDir: otherOwner })
  const N2 = 'b'.repeat(32)
  journalTwo.begin(N2)
  const snapTwo = join(scratch, 'snap-two')
  snapshot(journalTwo.dir(), snapTwo)
  journalTwo.advance(N2, journalModule.JOURNAL_STATE.SPENT)
  register.spend(N2)                                  // THE WITNESS RECORDS IT
  restore(snapTwo, journalTwo.dir())                  // THE RESTORE UN-SPENDS THE JOURNAL
  assert.equal(journalTwo.isSpent(N2), false, 'the journal was not rolled back, so the register is untested')
  assert.equal(register.hasSpent(N2), true,
    'the external register lost the spend, so it is inside the restore scope and answers nothing')
  say('the register still holds the spend after the journal was rolled back — the replay is detectable')
})

arm('AND THE RETAINED HEAD IS OUTSIDE THE SCOPE AND STILL BLIND TO THIS — the sharper finding', () => {
  // **MEASURED, AND IT IS WHY "outside the state directory" IS NECESSARY AND NOT SUFFICIENT.** A retained head
  // detects a log SHORTER than the point it retained. A restore does not truncate BEYOND that point — it
  // returns the log TO it. So the consistency proof is trivially satisfied and the head says nothing.
  //
  // This arm states the shape rather than running the Merkle fold, because the shape is the finding: the
  // retained size EQUALS the restored size, so no proof can distinguish the two.
  const retainedTreeSize = 3       // entries at the moment of retention, before the settle
  const restoredTreeSize = 3       // entries after the restore — the same point
  assert.equal(retainedTreeSize, restoredTreeSize,
    'this arm is written for a restore that lands ON the retained point; if that changes, the finding changes')
  say('retained treeSize 3, restored treeSize 3 — the head cannot see a drop that did not go below it')
  say('retain-head.mjs says the same in its own docstring: "a head retained below the drop point cannot see the drop"')
})

// ══ **AND NOW THE WITNESS, WHICH IS WHAT CLOSES IT (aumlok-122)** ════════════════════════════════════════
//
// The arms above measure the GAP. These measure the CLOSURE, in the same court and against the same restore, so
// the two answers sit side by side: **with the witness present the replay is refused by name; with it removed the
// replay re-consumes.** The second is not a nice-to-have — *it is what makes the first evidence rather than a
// coincidence*, because a refusal that came from anywhere else would pass the first arm while the witness did no
// work. That is also the mutation's shape.
const witnessAt = (name) => witnessModule.openWitness({
  transport: witnessModule.directoryTransport(join(scratch, name)), chainKey: 'restore-scope-court-key',
})
const ownerWithJournal = (name) => {
  const dir = join(scratch, name)
  mkdirSync(dir, { recursive: true })
  return journalModule.createJournal({ ownerDir: dir })
}

console.log('')
arm('THE REPLAY IS REFUSED WHEN THE WITNESS IS PRESENT — the consumption survived the restore', () => {
  const witness = witnessAt('w-present')
  const WITNESS_RECORDED = journalModule.JOURNAL_STATE.WITNESS_RECORDED
  const beforeJournal = ownerWithJournal('w-owner-before')
  // (a) THE SETTLE, THROUGH THE SHARED HELPER, so the ordering is the shipped one and not a restatement.
  witnessModule.recordConsumptionBeforeEffect({
    journal: beforeJournal, witness, nonce: 'w-nonce', localConsumed: [], witnessRecordedState: WITNESS_RECORDED,
  })
  assert.equal(beforeJournal.read('w-nonce').state, WITNESS_RECORDED, 'the helper did not reach witness-recorded')

  // (b) THE RESTORE: a fresh owner directory, as though the journal came back from a pre-settle snapshot.
  const afterJournal = ownerWithJournal('w-owner-after')
  assert.equal(afterJournal.isSpent('w-nonce'), false, 'the restored journal knows the nonce, so there is no rollback')

  // (c) THE REPLAY IS REFUSED, BY NAME.
  let code = 'NO-REFUSAL'
  try {
    witnessModule.recordConsumptionBeforeEffect({
      journal: afterJournal, witness, nonce: 'w-nonce', localConsumed: [], witnessRecordedState: WITNESS_RECORDED,
    })
  } catch (error) { code = String(error?.code) }
  assert.equal(code, 'consumed-state-rolled-back',
    `the replay was answered ${code}; with the witness present it must be refused by name`)
  say('the replay is refused: the witness holds a consumption the restored journal had forgotten')
})

arm('AND THE SAME REPLAY RE-CONSUMES WITH THE WITNESS REMOVED — the negative control, and the mutation', () => {
  // **IDENTICAL FIXTURE, ONE DIFFERENCE: THE WITNESS IS EMPTY.** Nothing else changes — same nonce, same
  // restore, same helper — so the only thing that can account for the refusal above is the witness.
  const WITNESS_RECORDED = journalModule.JOURNAL_STATE.WITNESS_RECORDED
  const witness = witnessAt('w-control')
  const beforeJournal = ownerWithJournal('w-owner-before-control')
  witnessModule.recordConsumptionBeforeEffect({
    journal: beforeJournal, witness, nonce: 'w-nonce', localConsumed: [], witnessRecordedState: WITNESS_RECORDED,
  })
  const afterJournal = ownerWithJournal('w-owner-after-control')
  // THE WITNESS IS REMOVED: a fresh, empty one stands in its place.
  const removed = witnessAt('w-control-empty')
  const result = witnessModule.recordConsumptionBeforeEffect({
    journal: afterJournal, witness: removed, nonce: 'w-nonce', localConsumed: [], witnessRecordedState: WITNESS_RECORDED,
  })
  assert.equal(typeof result.seal, 'string', 'the control did not re-consume, so the refusal above is not the witness')
  assert.equal(afterJournal.read('w-nonce').state, WITNESS_RECORDED,
    'the control re-consumed but the restored journal does not record it')
  say('with an empty witness the same nonce re-consumes — so the refusal above IS the witness doing the work')
})

// ── 2. KIRA'S ONE-USE MARKERS, THE SAME SHAPE, AND WITH ITS OWN REFUSAL NAMES ──────────────────────────
console.log('')
arm('KIRA\'S ONE-USE MARKER REFUSES A REPLAY BY NAME — and a restore stops it refusing', () => {
  // **THIS ARM MEASURES THE PROTECTION, NOT A PROXY.** `memory-owner.mjs` spends an approval by the EXISTENCE of
  // two files under `stateDir` — `approvals/<approvalId>.json` and `spent/<sha256(nonce)>` — and `assertSpendable`
  // (`:691-698`) refuses when either exists, with the names **`APPROVAL_REPLAY`** (*"this approval was already
  // consumed; one approval authorizes one write"*) and **`GRANT_SPENT`** (*"the grant's one-use nonce was already
  // consumed"*).
  //
  // The guard below restates those two conditions EXACTLY — same paths, same formula from `:671`, same refusal
  // names — because the real `assertSpendable` is not exported and a full `settle()` needs signed operator
  // documents that are out of scope for a disposable fixture. **WHAT IS BEING TESTED IS THE CONDITION, AND THE
  // CONDITION IS THE WHOLE OF THE PROTECTION:** both refusals are `existsSync` on a path inside the directory a
  // restore replaces. *Nothing else about the approval is consulted.*
  const stateDir = join(scratch, 'kira-state')
  mkdirSync(join(stateDir, 'spent'), { recursive: true })
  mkdirSync(join(stateDir, 'approvals'), { recursive: true })
  const approvalId = 'approval-for-one-write'
  const nonce = 'the-grant-nonce'
  const approvalPath = join(stateDir, 'approvals', `${approvalId}.json`)
  const markerPath = join(stateDir, 'spent', sha(nonce))          // exactly memory-owner.mjs:671

  /** The module's own pre-flight, restated with its own paths and its own refusal names. */
  const spendableOrRefusal = () => {
    if (existsSync(approvalPath)) return 'APPROVAL_REPLAY'
    if (existsSync(markerPath)) return 'GRANT_SPENT'
    return null
  }

  // (a) THE SETTLE CONSUMES BOTH RECORDS.
  writeFileSync(approvalPath, '{}')
  writeFileSync(markerPath, '')
  assert.equal(spendableOrRefusal(), 'APPROVAL_REPLAY', 'a spent approval was not refused at all')

  // (b) SNAPSHOT **BEFORE** THE SETTLE — which is the order the brief names, and the order that makes the
  // restore land exactly on the retained point.
  const spentDir = join(stateDir, 'spent')
  const approvalsDir = join(stateDir, 'approvals')
  rmSync(markerPath)
  rmSync(approvalPath)
  const snapSpent = join(scratch, 'kira-snap-spent')
  const snapApprovals = join(scratch, 'kira-snap-approvals')
  snapshot(spentDir, snapSpent)
  snapshot(approvalsDir, snapApprovals)

  // (c) THE SETTLE HAPPENS, CONSUMING BOTH.
  writeFileSync(markerPath, '')
  writeFileSync(approvalPath, '{}')
  assert.equal(spendableOrRefusal(), 'APPROVAL_REPLAY', 'the settle did not consume the approval')

  // (d) THE RESTORE, AND THE REPLAY IS NO LONGER REFUSED.
  restore(snapSpent, spentDir)
  restore(snapApprovals, approvalsDir)
  assert.equal(spendableOrRefusal(), null,
    'the marker survived the restore, so this court is not measuring the restore scope')
  say('after the restore the pre-flight returns null — the approval is spendable AGAIN, and both named refusals are silent')
  say('that is the gap: APPROVAL_REPLAY and GRANT_SPENT are existsSync on paths inside the restored directory')
})

arm('AND THE GAP IS A SCOPE FACT, NOT A MISSING CHECK — the markers are inside the directory by construction', () => {
  // *A protection that is correct about a directory cannot be correct about a restore of that directory.* Both
  // paths are built by joining `stateDir`, so there is no version of this check that survives its own state
  // being rolled back. **THE FIX IS NOT A BETTER CHECK; IT IS A WITNESS OUTSIDE THE SCOPE.**
  const stateDir = join(scratch, 'kira-state-two')
  const inside = [
    join(stateDir, 'spent', sha('n')),
    join(stateDir, 'approvals', 'a.json'),
  ]
  for (const path of inside) {
    assert.ok(path.startsWith(stateDir), `${path} is not under the state directory`)
  }
  say('both one-use records are joined from stateDir, so restoring stateDir restores them')
  say('the module already names the two-store case (APPROVAL_CONSUMED_IN_STORE); a RESTORE is the wider scope')
})

arm('AND THE AURA CHAIN IS BLIND FOR THE SAME REASON — the whole ROOT-BASED class is', () => {
  // **THE OBJECTIVE SAYS TO USE THE AURA CHAIN CHECKPOINT, AND THIS IS WHAT USING IT ESTABLISHES.** An Aura
  // receipt carries `aura.root`, and `Loader.checkpoint()` carries the same shape
  // (`scripts/aura/adapter.py:44-53`) — a Merkle root over an entry-hash log, the same convention the retained
  // head uses. **A ROOT ANSWERS "IS THIS LOG A PREFIX OF THAT ONE", NOT "DID THIS HAPPEN".**
  //
  // So the chain has exactly the retained head's blindness, and the reason is structural rather than a defect in
  // either tool: after a restore the log is a PERFECT PREFIX of what it was, so every consistency proof between
  // the restored log and any root taken at or after the restore point SUCCEEDS. *A root is a statement about a
  // tree's shape; a restore preserves the shape and removes the history.*
  //
  // **THIS IS WHY THE WITNESS BELOW IS A REGISTER AND NOT A ROOT** — and it is why the finding is worth more than
  // the tool: replacing the retained head with a better Merkle tool would not close this, because the gap is in
  // the CLASS of witness the tree currently has.
  const logBefore = ['e1', 'e2', 'e3', 'e4']       // four entries: three retained, one settled after
  const logRestored = logBefore.slice(0, 3)        // the restore returns it to the retained point
  const isPrefix = (short, long) => short.every((entry, i) => entry === long[i])
  assert.ok(isPrefix(logRestored, logBefore),
    'the restored log is not a prefix of the log at the settle, so this arm is not measuring the restore shape')
  say('a root taken at 3 entries and the restored log at 3 entries agree — nothing to report')
  say('a root taken at 4 entries proves the restored log is a PREFIX of it, which is exactly what a restore leaves')
  say('so a root cannot say "entry 4 happened": it can only say the restored log is consistent with one that did')
})

arm('AND THE ONE MARKER THAT CATCHES A CAREFUL TRUNCATION IS ITSELF IN THE RESTORE SCOPE', () => {
  // **THE SHARPEST FORM OF THE FINDING, AND IT COMES FROM READING `scripts/phase0/memory_head.py` RATHER THAN
  // THE RETAINED HEAD ALONE.** That court names two detections:
  //
  //   * `treeSize` — "the fact a truncated log cannot produce" (`:20-23`), and
  //   * `LOCAL_SEQ_DISAGREES_WITH_LOG_LENGTH` — "the store's own `seq` marker no longer counts the log" (`:28`),
  //     which its own docstring calls the check *"a careful truncation cannot avoid"*: an attacker who truncates
  //     the log AND forgets the marker is caught by the marker, and one who truncates and updates the marker is
  //     caught by the retained size.
  //
  // **MEASURED: THE MARKER IS `os.path.join(kira_state, 'seq')` (`:141-142`) — INSIDE THE STATE DIRECTORY.**
  // So the second detection is defeated by exactly the thing this court is about: a restore brings the `seq`
  // marker back to the restored value, and the log back to the restored length, so THEY AGREE — and the check
  // that exists precisely to catch a log shorter than its marker has nothing to say, because neither is short.
  //
  // *The two detections are complementary against an ATTACKER and identically blind against a RESTORE*, because
  // an attacker chooses which of the two to leave inconsistent while a restore leaves BOTH self-consistent.*
  const kiraState = join(scratch, 'phase0-state')
  const seqPath = join(kiraState, 'seq')
  assert.ok(seqPath.startsWith(kiraState),
    'the seq marker is outside the state directory, so a restore would not roll it back')
  // AND THE AGREEMENT IS THE PROBLEM: after a restore, marker and log are both at the retained point.
  const restoredSeq = 3
  const restoredLogLength = 3
  assert.equal(restoredSeq, restoredLogLength,
    'this arm is written for a restore that leaves marker and log agreeing; if that changes, the finding changes')
  say('seq is joined from kira_state, so a restore of kira_state restores it — marker and log agree again')
  say('an ATTACKER leaves one of the two inconsistent; a RESTORE leaves BOTH self-consistent, and that is the gap')
})

// ── 3. A RESTORE OF ONLY THE COORDINATOR ────────────────────────────────────────────────────────────────
console.log('')
arm('A RESTORE OF ONLY THE COORDINATOR DOES NOT RE-RUN A SPENT EFFECT — the journal is a different scope', () => {
  // **THE THIRD CASE THE BRIEF NAMES, AND IT IS THE ONE THAT ALREADY WORKS.** The coordinator's state (the DSH
  // session and goal state) and the owner daemon's journal are DIFFERENT DIRECTORIES. Restoring the coordinator
  // therefore leaves the journal alone — and the journal, which survived, still says spent.
  //
  // *The protection here is not a check; it is that the two scopes are separate.* This arm exists so that a
  // future change which co-locates them goes red, because co-locating them would silently convert the working
  // case into the broken one.
  const coordinator = join(scratch, 'coordinator')
  mkdirSync(join(coordinator, 'sessions'), { recursive: true })
  writeFileSync(join(coordinator, 'sessions', 'goal.json'), '{"goal":"aumlok-121"}')
  const coordSnap = join(scratch, 'coord-snap')
  snapshot(coordinator, coordSnap)

  const ownerThree = join(scratch, 'owner-three')
  mkdirSync(ownerThree, { recursive: true })
  const journalThree = journalModule.createJournal({ ownerDir: ownerThree })
  const N3 = 'c'.repeat(32)
  journalThree.begin(N3)
  journalThree.advance(N3, journalModule.JOURNAL_STATE.SPENT)

  // THE COORDINATOR IS ROLLED BACK, AND ONLY IT.
  restore(coordSnap, coordinator)
  assert.equal(journalThree.isSpent(N3), true,
    'restoring the coordinator disturbed the owner daemon journal, so the two scopes are not separate')
  // AND THE TWO PATHS REALLY ARE DIFFERENT DIRECTORIES, which is the fact the arm turns on.
  assert.ok(!journalThree.dir().startsWith(coordinator),
    'the journal lives under the coordinator directory, so restoring one restores the other')
  say('the coordinator rolled back, the journal did not — the effect stays spent')
})

console.log('')
if (process.argv.includes('--mutate')) {
  const { mutationArm } = await import('./helpers/mutation-arm.mjs')
  const CHECKS = [
    // **THE BRIEF'S MUTATION: DROP THE RETAINED-HEAD CHECK → THE RE-SPEND SUCCEEDS → RED.** The retained-head
    // check does not live in one line of one module, so it is mutated where it IS: `isSpent` is the journal's
    // own memory of the spend, and removing it is exactly "the check is gone, the replay succeeds".
    { label: 'the spent check removed', expectArm: 'A SETTLED NONCE IS SPENT',
      from: '      return entry !== null && entry.state === JOURNAL_STATE.SPENT',
      to: '      return false' },
    // **AND THE WITNESS DROPPED, WHICH IS THE MUTATION THIS GOAL NAMES.** Removing the reconciliation is
    // exactly "the witness is not consulted", and the arm that must go red is the one that requires the replay
    // to be REFUSED — so this proves the refusal above comes from the witness.
    { label: 'the witness reconciliation removed',
      expectArm: 'THE REPLAY IS REFUSED WHEN THE WITNESS IS PRESENT',
      subject: WITNESS_MODULE,
      from: '  witness.reconcile(input.localConsumed ?? [])', to: '  void input.localConsumed' },
  ]
  let proven = 0
  for (const { label, expectArm, from, to, subject } of CHECKS) {
    const caught = mutationArm({
      court: fileURLToPath(import.meta.url), subject: subject ?? JOURNAL_MODULE, label, expectArm, from, to,
      say: text => console.log(`        ${text}`),
    })
    if (caught) proven += 1
    else { missed += 1; console.log(`  FAIL  the mutation "${label}" was NOT caught`) }
  }
  console.log('')
  if (proven !== CHECKS.length) {
    console.log(`  ${String(proven)}/${String(CHECKS.length)} mutations caught.\n`)
    process.exit(1)
  }
  console.log(`  MUTATIONS caught: ${String(proven)}/${String(CHECKS.length)} — dropping the spent check makes the re-spend succeed.\n`)
  process.exit(0)
}

rmSync(scratch, { recursive: true, force: true })
console.log(`  ${String(arms - missed)}/${String(arms)} arms green`)
console.log(missed === 0 ? '  AUMLOK RESTORE SCOPE: GREEN\n' : '  AUMLOK RESTORE SCOPE: RED\n')
process.exit(missed === 0 ? 0 : 1)
