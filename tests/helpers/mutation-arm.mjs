/**
 * **A `--mutate` ARM FOR A COURT WHOSE PROTECTION LIVES IN A FILE IT DOES NOT OWN.**
 *
 * `scripts/ci/green-only.mjs` requires every registered court to be invoked with `--mutate` or listed as
 * green-only — **and the list is SHRINK-ONLY**, so the fix for an entry is to give the court an arm rather than to
 * add a line. Four of AUMLOK's courts were registered without one and refused the whole front door.
 *
 * ── WHY A SELF-RUN RATHER THAN AN INLINE MUTATION ───────────────────────────────────────────────────────────
 *
 * The house idiom mutates before the first import and lets the court's own arms run against the mutant. **That
 * needs the mutation to be in place before `import`, which is fine when the court is written for it** — and these
 * four are not: they load their subjects at the top, through `install.js` and `policy.js`, so a mutation applied
 * mid-file arrives too late.
 *
 * **SO `--mutate` RE-RUNS THE COURT AS A CHILD WITH THE SUBJECT MUTATED, AND REQUIRES IT TO FAIL.** That is a
 * weaker statement than "this exact arm went red" — **and it is a real one**: a court that passes with its
 * protection removed is a court that cannot fail, which is precisely what the gate exists to find.
 *
 * ── THE ARMS, AND WHY THE FIRST AND LAST ARE NOT DECORATION ─────────────────────────────────────────────────
 *
 *   1. **PLAIN MUST PASS.** A court that is already red would make "the mutant failed" prove nothing at all.
 *   2. **THE MUTANT MUST FAIL.** The arm itself.
 *   3. **RESTORED MUST PASS AGAIN.** A court left mutated would make every LATER run red, and this helper would
 *      have become the hazard `tests/helpers/guarded-mutation.mjs` exists to remove.
 *
 * **AND THE MUTATION GOES THROUGH `guardInPlace`**, which journals the original bytes outside the repository
 * before writing and restores on every catchable signal — **so a killed `--mutate` cannot leave the tree
 * mutated**, the failure measured in aumlok-106.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { privateMutant } from './private-mutant.mjs'

/**
 * Run a court and report whether it passed.
 *
 * **THE CHILD NEVER GETS `--mutate`.** It is spawned with exactly the argument list given, and this helper is
 * only ever called FROM a `--mutate` run — so passing the flag through would recurse for ever.
 */
function runCourt(court, extra = [], nodeArgs = []) {
  const run = spawnSync(process.execPath, [...nodeArgs, court, ...extra], { encoding: 'utf8', timeout: 240_000 })
  const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`
  return { passed: run.status === 0, status: run.status, output }
}

/**
 * The whole arm: plain passes, the mutant fails, restored passes.
 *
 * @param {{court: string, subject: string, label: string, from: string, to: string, say: (line: string) => void}} spec
 * @returns {boolean} whether the mutation was CAUGHT (the mutant failed for the right shape of reason).
 */
export function mutationArm(spec) {
  const { court, subject, label, from, to, say } = spec
  const before = readFileSync(subject, 'utf8')

  // (1) PLAIN. **WITHOUT THIS THE ARM IS VACUOUS** — a court that is already red fails as a mutant too, and the
  // report would read "MUTATION caught" for a court that was never green.
  const plain = runCourt(court)
  if (!plain.passed) {
    say(`the court is ALREADY RED without any mutation (exit ${String(plain.status)}), so this arm proves `
      + 'nothing — fix the court first')
    say(plain.output.split('\n').filter(line => line.includes('FAIL')).slice(0, 3).join('\n'))
    return false
  }

  // ── **THE MUTANT LIVES IN A PRIVATE CLONE, AND THE SHARED TREE IS NEVER WRITTEN (AUMLOK-115)** ──────────
  //
  // MEASURED BEFORE THIS CHANGED: four `--mutate` courts on `journal.mjs` at once, with an outside watcher hashing
  // that file every 20 ms, gave **4237 samples and TWO FOREIGN HASHES** — two different mutants live in the one
  // checkout all seven lanes share. **A concurrent court, commit or boot could observe or commit a mutant**, and
  // `journal.mjs` was found mutated twice by hand because of it.
  //
  // `guardInPlace` journalled how to undo that and restored on every catchable signal. **It could not prevent the
  // window**, because the child has to import the mutant and the mutant has to be somewhere the child resolves.
  // `privateMutant` puts it in a clone under `tmpdir()` and redirects the module root into it, so **there is no
  // window at all** — and the restore machinery below stops being a safety net and becomes unnecessary.
  // ── **`privateMutant` IS INSIDE THE `try`, BECAUSE IT IS THE CALL THAT CAN RUN OUT OF DISK** ──────────────
  //
  // MEASURED (Fable, disk audit row 1): the call sat **above** the `try`, so when the clone failed part-way —
  // which is exactly what `ENOSPC` makes it do — **the run root had already been created and `pm.dispose()` was
  // never reached.** The mutation that was supposed to be contained leaked the very tree it had just failed to
  // build, and the court reported a clone failure while filling the disk it could not clone onto.
  //
  // *A CLEANUP THAT ONLY RUNS WHEN THE THING IT CLEANS UP SUCCEEDED IS NOT A CLEANUP.* The variable is declared
  // outside so the `finally` can see it, and the `finally` tolerates the case where nothing was ever assigned —
  // which is the failure path this exists for.
  let pm = null
  let mutant
  try {
    pm = privateMutant(subject, [[label, from, to]], { label })
    // ── *** THE MUTANT MUST BE PROVEN LOADABLE BEFORE ITS FAILURE IS CALLED A CATCH. *** ───────────────────
    //
    // MEASURED TONIGHT in `tests/aukora-lane-door.test.mjs`: a mutant written where its RELATIVE IMPORTS could not
    // resolve died with `ERR_MODULE_NOT_FOUND`, the child exited non-zero, and the engine read that as CAUGHT.
    // *** EVERY MATCHING MUTATION IN THAT COURT WAS "CAUGHT" BECAUSE THE MODULE NEVER EXECUTED. THE ARMS PROVED
    // NOTHING, AND THEY SAID SO IN GREEN. ***
    //
    //   (a) `node --check` — a mutant that does not PARSE fails the court for a syntax error and would be counted
    //       as a catch. *** A SYNTAX-ERROR MUTANT IS NOT A CAUGHT ARM. ***
    //   (b) AN ACTUAL IMPORT — parsing is not loading. A mutant whose imports cannot resolve parses perfectly and
    //       still never runs, which is exactly the shape above.
    // Both run BEFORE the court is spawned, and both refuse the arm BY NAME rather than reporting a catch.
    const syntax = spawnSync(process.execPath, ['--check', pm.subjectInCopy], { encoding: 'utf8' })
    if (syntax.status !== 0) {
      say(`MUTATION INVALID: the mutant does not PARSE (node --check exit ${String(syntax.status)}), so the court `
        + 'would fail for a syntax error and this arm would report a catch it did not earn')
      say((syntax.stderr ?? '').split('\n').slice(0, 3).join('\n'))
      return false
    }
    // *** THE IMPORT RUNS OUT OF PROCESS, BECAUSE A COURT THAT LOADED A MUTANT INTO ITS OWN PROCESS WOULD BE
    // MEASURING SOMETHING IT CANNOT PUT BACK. *** Only a RESOLUTION failure is refused: a module that throws at
    // import time is a different question the court may legitimately be testing, and its arms decide that.
    const loads = spawnSync(process.execPath, ['--import', pm.loader, '--input-type=module', '--eval',
      'await import(process.env.AUKORA_MUTANT_PROBE)'], {
      encoding: 'utf8',
      env: { ...process.env, AUKORA_MUTANT_PROBE: pm.subjectInCopy },
    })
    if (/ERR_MODULE_NOT_FOUND|Cannot find module|Cannot find package/u.test(loads.stderr ?? '')) {
      say('MUTATION INVALID: the mutant cannot RESOLVE its own imports, so it never executes — and a court that '
        + 'never executes cannot catch anything')
      say((loads.stderr ?? '').split('\n').filter(l => l.trim() !== '').slice(0, 3).join('\n'))
      return false
    }
    mutant = runCourt(court, [], ['--import', pm.loader])
  } finally {
    // **`pm?.dispose()` AND NOT `pm.dispose()`**: if the clone threw, there is still a half-built run root under
    // the private root and `private-mutant`'s own exit handler is the only other thing that knows about it.
    try { pm?.dispose() } catch { /* the exit handler and the stale reaper both still hold this */ }
  }

  // (3) UNCHANGED. **THE SHARED TREE MUST BE BYTE-IDENTICAL, AND NOW IT IS BY CONSTRUCTION RATHER THAN BY
  // RESTORATION.** This assertion is the one that would have caught the race: it was always true after a clean
  // restore and never true DURING one, which is why a watcher was needed to see the hazard at all.
  const restored = readFileSync(subject, 'utf8')
  assert.equal(restored, before,
    `${subject} CHANGED during a private-clone mutation, which must be impossible — this mutation arm has become `
    + 'the hazard it guards against')
  const after = runCourt(court)
  if (!after.passed) {
    say(`the court is red AFTER the restoration (exit ${String(after.status)}), so the mutant's failure cannot be `
      + 'attributed to the mutation')
    return false
  }

  if (mutant.passed) {
    say(`MUTATION NOT CAUGHT: with ${label} removed the court still passed (exit ${String(mutant.status)}) — `
      + 'a court that passes with its protection gone cannot fail')
    return false
  }
  // ── *** AND THE FAILURE MUST BE THE ARM THAT WAS SUPPOSED TO CATCH IT — BUT ONLY WHEN THE CALLER SAYS WHICH. ***
  //
  // *** A COURT GOES RED FOR MANY REASONS, AND ONLY ONE OF THEM IS THE PROTECTION THIS ARM REMOVED. *** A mutation
  // that breaks something unrelated — a stale anchor elsewhere, an unrelated assertion — is otherwise banked as a
  // caught arm, and the protection could be deleted entirely while the arm still said CAUGHT.
  //
  // *** AND THE FIRST VERSION OF THIS CHECK DEFAULTED TO THE MUTATION'S **LABEL**, WHICH WAS WRONG, MEASURED ON THE
  // RUNNER: `owner-cut-linux` at `48cf0f2db` printed ELEVEN `MUTATION MISATTRIBUTED` lines, every one of them
  // because the court's failing output words its arm differently from the label. A check that fires on WORDING
  // rather than on SUBSTANCE is the same failure as an arm that cannot go red, pointed the other way — it turns a
  // real catch into a red and teaches the next reader to ignore the message. ***
  // SO IT IS OPT-IN: `spec.expectArm` is checked when it is given, and omitted entirely when it is not. A court that
  // wants the stronger claim makes it explicitly, per mutation, and knows what text it is asserting.
  if (spec.expectArm !== undefined && !mutant.output.includes(spec.expectArm)) {
    say(`MUTATION MISATTRIBUTED: the mutant failed, but its output never names ${JSON.stringify(spec.expectArm)} — so `
      + 'the red came from something other than the arm this mutation is supposed to exercise')
    say(mutant.output.split('\n').filter(line => line.includes('FAIL')).slice(0, 3).join('\n'))
    return false
  }
  say(`MUTATION caught: with ${label} removed the court goes RED (exit ${String(mutant.status)}), and it is `
    + 'GREEN again once the mutation is undone')
  return true
}
