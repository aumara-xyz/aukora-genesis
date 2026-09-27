/**
 * **A MUTATION THAT SURVIVES BEING KILLED.**
 *
 * ── THE HAZARD ──────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The house `--mutate` idiom reads a protected file, writes a mutant over it, and restores the original in a
 * `finally`. **MEASURED, BY ME, 2026-09-26:** a `--mutate` run of `aukora-owner-journal-scaling` **was killed by
 * the runner's timeout**, its `finally` never ran, and `plugins/aukora-owner-daemon/lib/journal.mjs` **stayed
 * mutated through two subsequent green measurements.** I found it by grepping the source, not by trusting a run.
 *
 * **A `finally` CANNOT RUN ON SIGKILL.** So can no handler — **which is why a signal-safe handler is only half an
 * answer, and the other half has to happen at the NEXT START.**
 *
 * ── WHAT THIS DOES ───────────────────────────────────────────────────────────────────────────────────────────
 *
 * `guardedMutation(subject, mutations, run)`:
 *
 *   1. **RECOVERS FIRST.** Before anything is read, every unfinished mutation this helper ever left — including
 *      from a run killed with SIGKILL days ago — is restored from its journal. **A lane that inherits a
 *      corrupted tree should not have to notice it in `git status`.**
 *   2. **JOURNALS THE ORIGINAL BYTES** to a directory OUTSIDE the repository, so the record cannot itself dirty
 *      the tree it is protecting.
 *   3. **WRITES THE MUTANT**, then runs the court's body.
 *   4. **RESTORES ON EVERY PATH A HANDLER CAN CATCH** — normal return, a throw, `exit`, `SIGINT`, `SIGTERM`,
 *      `SIGHUP` — and removes the journal entry, **so a clean run leaves nothing to recover.**
 *
 * **AND THE JOURNAL IS KEYED BY THE SUBJECT'S ABSOLUTE PATH**, so a recovery knows exactly which file to restore
 * and can verify the bytes it finds before overwriting anything.
 *
 * ── WHY THIS RATHER THAN A COPY, FOR THESE COURTS ───────────────────────────────────────────────────────────
 *
 * `mutationCopy` (`tests/helpers/mutation-copy.mjs`) is the stronger answer **and is used where a court can import
 * the copy instead of the subject.** Most of the twenty mutate a module they then spawn a CHILD to load, or import
 * by a path fixed at the top of the file — **so pointing them at a copy means changing what each one imports and
 * threading a path through every child.** The hazard here is a **left-mutated tree**, not a stale import, and this
 * closes exactly that with a one-line change per write. **Both exist deliberately: use `mutationCopy` in new
 * courts, and this where the subject is loaded by something this file cannot re-point.**
 *
 * ── HOW TO USE IT ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *     import { guardedMutation } from './helpers/guarded-mutation.mjs'
 *
 *     await guardedMutation(JOURNAL, [['the guard', 'if (x) {', 'if (false) {']], async (mutantPath) => {
 *       const m = await import(`${pathToFileURL(mutantPath).href}?m=the-guard`)
 *       // … measure …
 *     })
 */
import assert from 'node:assert/strict'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

/** **OUTSIDE THE REPOSITORY ON PURPOSE** — a recovery record must not be able to dirty the tree it protects. */
const JOURNAL_DIR = join(tmpdir(), 'aukora-mutation-guard')

const digestOf = (text) => createHash('sha256').update(text, 'utf8').digest('hex')
const entryPath = (subject) => join(JOURNAL_DIR, `${digestOf(subject)}.json`)

/**
 * Restore every unfinished mutation, from this run or from any earlier one.
 *
 * **IT VERIFIES BEFORE IT WRITES.** An entry records the ORIGINAL digest and the MUTANT digest; a recovery only
 * restores when the file currently holds the MUTANT. **If the file holds neither, something else has changed it
 * and this refuses rather than overwriting a third party's work** — a recovery that blindly restores is a
 * recovery that can destroy a real edit.
 *
 * @returns {{restored: string[], refused: string[]}}
 */
export function recoverPending() {
  const restored = []
  const refused = []
  if (!existsSync(JOURNAL_DIR)) return { restored, refused }
  for (const name of readdirSync(JOURNAL_DIR)) {
    if (!name.endsWith('.json')) continue
    const entryFile = join(JOURNAL_DIR, name)
    let entry
    try { entry = JSON.parse(readFileSync(entryFile, 'utf8')) } catch { rmSync(entryFile, { force: true }); continue }
    try {
      // ── **A MISSING SUBJECT IS A REASON TO RESTORE, NOT A REASON TO GIVE UP (AUMLOK-114)** ─────────────
      //
      // MEASURED: this was `if (!existsSync(entry.subject)) { rmSync(entryFile); continue }` — **and the entry
      // is the ONLY copy of the original bytes.** So a subject that was absent at the moment of recovery —
      // because a concurrent lane was mid-`git checkout`, because a mutation had DELETED it, or because a write
      // that creates it had not landed — made the recovery **destroy the one record that could put the file
      // back**, and the change became permanent. *A recovery that gives up when the file is gone is a recovery
      // that only works when it is not needed.*
      //
      // **SO THE BYTES GO BACK.** A missing subject whose entry survives is exactly the case the journal exists
      // for: writing `entry.original` recreates the file at its recorded path with its recorded bytes.
      if (!existsSync(entry.subject)) {
        writeFileSync(entry.subject, entry.original, 'utf8')
        rmSync(entryFile, { force: true })
        restored.push(`${entry.subject} (was MISSING — restored from the journal)`)
        continue
      }
      const current = readFileSync(entry.subject, 'utf8')
      const currentDigest = digestOf(current)
      if (currentDigest === entry.originalDigest) {
        // ALREADY BACK — a handler got there before the kill, or a previous recovery did.
        rmSync(entryFile, { force: true })
        continue
      }
      if (currentDigest !== entry.mutantDigest) {
        // **NEITHER THE ORIGINAL NOR OUR MUTANT.** Refuse, and KEEP the entry so a person can see it.
        refused.push(entry.subject)
        continue
      }
      writeFileSync(entry.subject, entry.original, 'utf8')
      rmSync(entryFile, { force: true })
      restored.push(entry.subject)
    } catch { refused.push(entry.subject) }
  }
  return { restored, refused }
}

/** The subjects with an unfinished mutation right now. Used by the court that proves this works. */
export function pendingSubjects() {
  if (!existsSync(JOURNAL_DIR)) return []
  return readdirSync(JOURNAL_DIR).filter(name => name.endsWith('.json'))
    .map(name => { try { return JSON.parse(readFileSync(join(JOURNAL_DIR, name), 'utf8')).subject } catch { return null } })
    .filter(Boolean)
}

/**
 * Apply mutations to `subject`, run `body`, and restore on every path a handler can catch — journalling the
 * original first so that even SIGKILL is survivable at the next start.
 *
 * @param {string} subject - the TRACKED file to mutate.
 * @param {Array<[string, string, string]>} mutations - `[label, from, to]`.
 * @param {(mutantPath: string) => Promise<void>|void} body - what to measure. The subject IS the mutant here.
 * @returns {Promise<void>}
 */
/**
 * **THE THREE THINGS A COURT THAT CANNOT USE A PRIVATE COPY MUST DO (AUMLOK-115 (2), THE FALLBACK).**
 *
 * `guardInPlace` and `guardedMutation` CANNOT run on a copy the way `mutationArm` does: they mutate a module
 * **their own process imports**, in the same tick. A clone would leave their `import` statements resolving into
 * the SHARED tree, so the mutant would be written where nobody reads it and every arm would pass while measuring
 * nothing. *A copy the subject's own imports do not resolve into is not a copy of the subject.*
 *
 * So this path takes the three things the item asks of it:
 *
 *   1. **AN EXCLUSIVE PER-SUBJECT LOCK.** Two concurrent `--mutate` runs over one subject is the race that was
 *      MEASURED (2 foreign hashes in 4237 observations). The lock is a `wx` create — an atomic test-and-set.
 *   2. **THE SHARED-TREE MUTATION NAMED AS A CEILING, PRINTED EVERY TIME.** *A ceiling that is not printed reads
 *      as a claim that it does not apply.*
 *   3. **A REFUSAL WHEN THE SUBJECT HAS UNCOMMITTED CHANGES.** "The original" this helper would restore is then
 *      somebody's work in progress, and putting it back is a second edit racing the first.
 *
 * ── **AND THE LOCK IS CHECKED AGAINST ITS OWNER, NOT MERELY ITS EXISTENCE** ─────────────────────────────────
 *
 * MEASURED, AND IT IS WHY MY FIRST VERSION WEDGED EVERY COURT THAT USED IT: the lock was created and the release
 * depended on `process.on('exit')` registering on the path the court actually took — and on the `guardedMutation`
 * path it did not, so the lock outlived its owner and the NEXT honest run refused against a process that had
 * already finished. *A lock nobody releases is a court nobody can run.*
 *
 * **SO A LOCK WHOSE OWNING PID IS DEAD IS BROKEN AND RETAKEN**, which makes the release an optimisation rather
 * than a requirement. `/proc` is not consulted: `process.kill(pid, 0)` is the portable question, and it is asked
 * only about a pid this file wrote down.
 *
 * @param {string} subject the shared file about to be rewritten in place.
 * @returns {{path: string, release: () => void}}
 */
export function beginSharedTreeMutation(subject) {
  const lockPath = join(tmpdir(), `aukora-guard-lock-${createHash('sha256').update(resolve(subject)).digest('hex').slice(0, 16)}`)
  let fd = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fd = openSync(lockPath, 'wx')
      writeFileSync(fd, `${String(process.pid)}\n${new Date().toISOString()}\n${resolve(subject)}\n`)
      break
    } catch (error) {
      if (String(error?.code) !== 'EEXIST') throw error
      // **IS THE OWNER ALIVE?** A pid this file wrote down, asked with signal 0. EPERM means it exists and is not
      // ours, which is still alive; ESRCH means it is gone and the lock is a tombstone.
      let owner = null
      let since = ''
      try {
        const held = readFileSync(lockPath, 'utf8').split('\n')
        owner = Number(held[0]) || null
        since = String(held[1] ?? '')
      } catch { /* unreadable, treat as held by an unknown owner */ }
      let alive = owner !== null
      if (owner !== null) {
        try { process.kill(owner, 0) } catch (probe) { alive = String(probe?.code) !== 'ESRCH' }
      }
      if (alive && attempt === 0) {
        console.log(`REFUSED: another mutation holds this subject — ${resolve(subject)}`)
        console.log(`  lock: ${lockPath} (pid ${String(owner)} since ${since})`)
        console.log('CEILING: this court mutates the SHARED tree in place, so two runs over one subject interleave.')
        console.log('  2 means NOT RUN — not passed, and not an arm that failed.')
        process.exit(2)
      }
      // STALE: the owner is gone. Broken and retaken rather than left to refuse the next honest run forever.
      console.log(`  … breaking a STALE guard lock held by pid ${String(owner)} (it is gone)`)
      try { rmSync(lockPath, { force: true }) } catch { /* the retry will say so */ }
    }
  }
  if (fd === null) {
    console.log(`REFUSED: the guard lock at ${lockPath} could not be taken after breaking a stale one.`)
    console.log('  2 means NOT RUN.')
    process.exit(2)
  }
  // **`release` IS DECLARED FIRST, BECAUSE THE REFUSALS BELOW CALL IT.** MEASURED TWICE IN THIS FILE ALREADY:
  // a `const` used above its declaration is a temporal dead zone, and the failure is a `ReferenceError` at the
  // moment the guard is supposed to be refusing cleanly — *so the refusal path throws instead of refusing.*
  let released = false
  const release = () => {
    if (released) return
    released = true
    try { closeSync(fd) } catch { /* already closed */ }
    try { rmSync(lockPath, { force: true }) } catch { /* the pid check will recover it */ }
  }

  // ── THE CEILING, PRINTED WHETHER OR NOT ANYTHING GOES WRONG ────────────────────────────────────────────
  //
  // Mutating the shared tree is a real hazard — a concurrent court, commit or boot can observe the mutant — and a
  // run that does not say so reads as one that does not do it. *A ceiling that is not printed reads as a claim
  // that it does not apply.*
  console.log(`CEILING: SHARED_TREE_MUTATION — ${resolve(subject)} is rewritten IN PLACE for the duration of this arm`)
  console.log(`  (lock ${lockPath}; exclusive per subject, broken only when its owner is gone).`)

  // ── AND A SUBJECT THAT IS ALREADY DIRTY IS REFUSED, NOT MUTATED ─────────────────────────────────────────
  //
  // What this helper would read as "the original" is an UNCOMMITTED EDIT by whoever is working in this shared
  // tree. Restoring it afterwards would put back a version nobody asked for, and the mutant would be measured
  // against a subject that was already moving. `git status` answers the question; **a question that cannot be
  // answered is not a "yes"** — with no git the mutation proceeds and the ceiling says the check did not run.
  let dirty = null
  try {
    dirty = execFileSync('git', ['status', '--porcelain', '--', resolve(subject)], { encoding: 'utf8' }).trim().length > 0
  } catch { dirty = null }
  if (dirty === true) {
    console.log(`REFUSED: ${resolve(subject)} has UNCOMMITTED CHANGES, so there is no "original" to restore it to.`)
    console.log('CEILING: this court mutates the SHARED tree in place. A dirty subject makes the restore a second')
    console.log('  edit racing the first. Commit or revert it, then run this court. 2 means NOT RUN.')
    release()
    process.exit(2)
  }
  if (dirty === null) {
    console.log('  ! the uncommitted-changes check could not run (no git), so the subject may be dirty')
  }

  // **REGISTERED HERE, SO EVERY CALLER GETS IT** — that was the bug: it lived inside one of the two shapes, so
  // the other took the lock and never gave it back.
  process.on('exit', release)
  return { path: lockPath, release }
}

export async function guardedMutation(subject, mutations, body) {
  // **RECOVER FIRST, ALWAYS.** This is the half that answers SIGKILL, and running it here — rather than in a
  // separate "recovery step" somebody has to remember — is what makes it a guarantee instead of a ritual.
  const recovery = recoverPending()
  if (recovery.restored.length > 0) {
    console.log(`  … recovered ${String(recovery.restored.length)} mutation(s) an earlier run left behind`)
  }
  for (const stuck of recovery.refused) {
    console.log(`  ! ${stuck} holds bytes that are neither the original nor our mutant — NOT overwritten`)
  }
  // **THE SHARED-TREE FALLBACK, FOR BOTH SHAPES.** See `beginSharedTreeMutation`: exclusive per-subject
  // lock, the ceiling printed, and a stale lock whose owner is gone broken rather than left to wedge the
  // next honest run.
  const lock = beginSharedTreeMutation(subject)

  const original = readFileSync(subject, 'utf8')
  const entryFile = entryPath(subject)
  mkdirSync(JOURNAL_DIR, { recursive: true })

  let restored = false
  const restore = () => {
    // **THE LOCK IS RELEASED IN `restore`, BECAUSE BOTH SHAPES CALL IT ON EVERY PATH.** An exit
    // handler is the net for a kill; this is the ordinary release, and doing it here rather than at
    // each call site is why the two shapes cannot drift on it.
    lock.release()
    if (restored) return
    restored = true
    // ── **THE ENTRY IS REMOVED ONLY IF THE BYTES ACTUALLY WENT BACK (AUMLOK-114, REPRODUCED)** ─────────────
    //
    // MEASURED, AND THIS IS THE DEFECT THE ROUND WAS SENT TO FIND. Both copies of this function used to be:
    //
    //     try { writeFileSync(subject, original, 'utf8') } catch { /* the journal still has it */ }
    //     try { rmSync(entryFile, { force: true }) } catch { /* the next recovery will */ }
    //
    // **THE COMMENT WAS A LIE AND THE NEXT LINE MADE IT ONE.** If the write THREW, the catch said *"the journal
    // still has it"* — **and then the entry was deleted anyway, taking the only copy of the original bytes with
    // it.** The mutant stayed on disk and nothing could restore it: no handler retries, and `recoverPending`
    // has no entry to work from. *A fallback named in a comment and destroyed on the next line is worse than no
    // fallback, because it is believed.*
    //
    // **FOUND LIVE, NOT IN THEORY:** `plugins/aukora-owner-daemon/lib/journal.mjs` was sitting mutated in the
    // shared checkout (`eachRecord` → `entries`) with `pendingSubjects()` reporting **ZERO** — a mutant and an
    // empty journal is exactly this bug's signature.
    //
    // SO THE ENTRY IS KEPT UNLESS THE WRITE SUCCEEDED. A failed restore now leaves the journal entry in place,
    // and the NEXT run's `recoverPending` puts the file back.
    let wrote = false
    try { writeFileSync(subject, original, 'utf8'); wrote = true } catch { /* the entry below is kept, and it is the only copy */ }
    if (wrote) {
      try { rmSync(entryFile, { force: true }) } catch { /* the next recovery will */ }
    }
  }
  // **EVERY PATH A HANDLER CAN CATCH.** `exit` covers a normal return and an uncaught throw; the signals cover a
  // runner that asks politely. **NONE of them covers SIGKILL — that is what the journal is for.**
  process.on('exit', restore)
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => { restore(); process.exit(130) })
  }

  try {
    for (const [label, from, to] of mutations) {
      // **AN ANCHOR MAY BE A REGEX, AND `String.includes` DOES NOT TEST ONE.** MEASURED: several courts remove a
      // whole BLOCK with `/if \(…\) \{[\s\S]*?\n  \}/u`, and passing that to `includes` coerces it to a string
      // that never occurs — **so a perfectly good mutation was refused as "the protection was not found".** The
      // refusal was correct behaviour from a check that could not see the anchor, which is exactly the kind of
      // honest-looking failure this whole goal is about. **The count is asserted for a REGEX**, because
      // `String.replace` with a global regex is the case where one match can silently become many.
      const found = from instanceof RegExp
        ? (() => {
          const flags = from.flags.includes('g') ? from.flags : `${from.flags}g`
          const matches = original.match(new RegExp(from.source, flags)) ?? []
          assert.equal(matches.length, 1,
            `${label}: the anchor matches ${String(matches.length)} times in ${subject}, and a mutation must `
            + 'remove exactly one protection — zero proves nothing and more than one removes more than it says')
          return true
        })()
        : original.includes(from)
      assert.ok(found,
        `${label}: the protection was not found in ${subject}, so this mutation proves nothing`)
      const mutant = original.replace(from, to)
      assert.notEqual(mutant, original, `${label}: the mutation changed no bytes`)
      // **THE JOURNAL IS WRITTEN BEFORE THE MUTATION**, so there is no instant in which a mutant exists on disk
      // without a record of how to undo it.
      writeFileSync(entryFile, JSON.stringify({
        subject, original, originalDigest: digestOf(original), mutantDigest: digestOf(mutant), label,
      }), 'utf8')
      writeFileSync(subject, mutant, 'utf8')
      await body(subject)
      writeFileSync(subject, original, 'utf8')
    }
  } finally {
    restore()
  }
}

/**
 * **THE SAME GUARANTEE FOR A COURT WHOSE BODY IS THE REST OF THE FILE.**
 *
 * `guardedMutation` takes a `body` callback, which fits a court that runs its arms inside a loop. **It does not
 * fit the `--mutant-run` shape**, where the child writes the mutant and then the WHOLE MODULE — arms and all —
 * executes against it. Those courts registered a bare `process.on('exit', restore)` and, in the better ones,
 * `uncaughtException` — **neither of which runs on SIGTERM, and neither of which survives SIGKILL.** MEASURED:
 * that is exactly how a killed `--mutate` left a tracked module mutated through two green measurements.
 *
 * **SO THIS RETURNS THE RESTORE INSTEAD OF TAKING A CALLBACK.** It journals first (so a SIGKILL is recoverable at
 * the next start), installs `exit`, `uncaughtException` and the three catchable signals, and hands the caller a
 * `restore` for any path it wants to handle itself. **`dispose` is the same function** — one name for the
 * caller's convenience, not two ways to do it.
 *
 * @param {string} subject - the TRACKED file to mutate.
 * @param {Array<[string, string|RegExp, string]>} mutations - `[label, from, to]`.
 * @returns {{restore: () => void, dispose: () => void, original: string, mutant: string, entryFile: string}}
 */
export function guardInPlace(subject, mutations) {
  const recovery = recoverPending()
  // **THE SAME LOCK AS `guardedMutation`, FROM THE SAME FUNCTION.** MEASURED ONCE ALREADY: wiring only one of
  // two siblings leaves half the courts unguarded, and the half that is missing is the half nobody checked.
  const lock = beginSharedTreeMutation(subject)
  if (recovery.restored.length > 0) {
    console.log(`  … recovered ${String(recovery.restored.length)} mutation(s) an earlier run left behind`)
  }
  for (const stuck of recovery.refused) {
    console.log(`  ! ${stuck} holds bytes that are neither the original nor our mutant — NOT overwritten`)
  }

  const original = readFileSync(subject, 'utf8')
  let mutant = original
  let lastLabel = 'mutation'
  for (const [label, from, to] of mutations) {
    lastLabel = label
    if (from instanceof RegExp) {
      const flags = from.flags.includes('g') ? from.flags : `${from.flags}g`
      const matches = mutant.match(new RegExp(from.source, flags)) ?? []
      assert.equal(matches.length, 1,
        `${label}: the anchor matches ${String(matches.length)} times in ${subject}, and a mutation must remove `
        + 'exactly one protection — zero proves nothing and more than one removes more than it says')
    } else {
      assert.ok(mutant.includes(from),
        `${label}: the protection was not found in ${subject}, so this mutation proves nothing`)
    }
    const next = mutant.replace(from, to)
    assert.notEqual(next, mutant, `${label}: the mutation changed no bytes`)
    mutant = next
  }

  const entryFile = entryPath(subject)
  mkdirSync(JOURNAL_DIR, { recursive: true })
  // **THE JOURNAL IS WRITTEN BEFORE THE MUTATION**, so there is no instant in which a mutant exists on disk
  // without a record of how to undo it.
  writeFileSync(entryFile, JSON.stringify({
    subject, original, originalDigest: digestOf(original), mutantDigest: digestOf(mutant), label: lastLabel,
  }), 'utf8')
  writeFileSync(subject, mutant, 'utf8')

  let restored = false
  const restore = () => {
    // **THE LOCK IS RELEASED IN `restore`, BECAUSE BOTH SHAPES CALL IT ON EVERY PATH.** An exit
    // handler is the net for a kill; this is the ordinary release, and doing it here rather than at
    // each call site is why the two shapes cannot drift on it.
    lock.release()
    if (restored) return
    restored = true
    // ── **THE ENTRY IS REMOVED ONLY IF THE BYTES ACTUALLY WENT BACK (AUMLOK-114, REPRODUCED)** ─────────────
    //
    // MEASURED, AND THIS IS THE DEFECT THE ROUND WAS SENT TO FIND. Both copies of this function used to be:
    //
    //     try { writeFileSync(subject, original, 'utf8') } catch { /* the journal still has it */ }
    //     try { rmSync(entryFile, { force: true }) } catch { /* the next recovery will */ }
    //
    // **THE COMMENT WAS A LIE AND THE NEXT LINE MADE IT ONE.** If the write THREW, the catch said *"the journal
    // still has it"* — **and then the entry was deleted anyway, taking the only copy of the original bytes with
    // it.** The mutant stayed on disk and nothing could restore it: no handler retries, and `recoverPending`
    // has no entry to work from. *A fallback named in a comment and destroyed on the next line is worse than no
    // fallback, because it is believed.*
    //
    // **FOUND LIVE, NOT IN THEORY:** `plugins/aukora-owner-daemon/lib/journal.mjs` was sitting mutated in the
    // shared checkout (`eachRecord` → `entries`) with `pendingSubjects()` reporting **ZERO** — a mutant and an
    // empty journal is exactly this bug's signature.
    //
    // SO THE ENTRY IS KEPT UNLESS THE WRITE SUCCEEDED. A failed restore now leaves the journal entry in place,
    // and the NEXT run's `recoverPending` puts the file back.
    let wrote = false
    try { writeFileSync(subject, original, 'utf8'); wrote = true } catch { /* the entry below is kept, and it is the only copy */ }
    if (wrote) {
      try { rmSync(entryFile, { force: true }) } catch { /* the next recovery will */ }
    }
  }
  process.on('exit', restore)
  process.on('uncaughtException', (error) => { restore(); throw error })
  // **THE SIGNALS A `finally` AND AN `exit` HANDLER BOTH MISS.** SIGKILL is still uncovered — that is the journal.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => { restore(); process.exit(130) })
  }
  return { restore, dispose: restore, original, mutant, entryFile }
}
