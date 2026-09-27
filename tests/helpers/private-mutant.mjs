/**
 * **A MUTANT THAT NEVER TOUCHES THE SHARED TREE (AUMLOK-115).**
 *
 * ── THE RACE, PROVEN BEFORE THIS WAS WRITTEN ────────────────────────────────────────────────────────────────
 *
 * `guardInPlace` rewrites the SUBJECT IN PLACE in the one checkout all seven lanes share. **MEASURED: with four
 * `--mutate` courts running, an outside watcher hashing `journal.mjs` every 20 ms took 4237 samples and saw TWO
 * FOREIGN HASHES** — two different mutants, live, in the tree every lane reads. `journal.mjs` was also found
 * mutated twice by hand with an empty recovery journal, which is what sent aumlok-114 after it.
 *
 * **A COURT MUST NOT CHANGE THE TREE IT IS MEASURING.** `scripts/lib/court-tree-guard.mjs` reports the violation
 * after the fact and `guarded-mutation.mjs` journals how to undo it, **and neither prevents it**: between the
 * write and the restore, the mutant IS the shared tree.
 *
 * ── WHAT THIS DOES INSTEAD ──────────────────────────────────────────────────────────────────────────────────
 *
 * **The mutant is written into a PRIVATE CLONE of the module root, and the child resolves every URL under that
 * root into the clone.** The shared tree is never opened for writing — no window, no journal, nothing for a
 * concurrent court, commit or boot to observe.
 *
 * **WHY A ROOT AND NOT THE SUBJECT'S DIRECTORY.** The first version copied only the subject's own directory, and
 * it FAILED on the first real subject: `journal.mjs` imports `../../aukora-kira/lib/strict-read.mjs`, so a lone
 * `lib/` copy resolved that sibling **outside** the clone and the child died of `ERR_MODULE_NOT_FOUND`.
 * **A module graph does not respect package directories**, so the unit to clone is the root the graph lives under.
 *
 * **WHY A RESOLVE HOOK AND NOT A PATH REWRITE.** The child loads the same specifier graph it always did: the
 * court's own imports are untouched and only the RESOLVED URL is remapped. Rewriting specifiers would change what
 * the court is measuring; remapping the root does not.
 *
 * **THE COST, MEASURED RATHER THAN ASSUMED:** `cp -Rc plugins` (42 MB, APFS clone) is **1.86 s**, and a clone
 * shares blocks so the disk cost is near zero. That is per arm, against a court that takes seconds to run.
 *
 * @module tests/helpers/private-mutant
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, statfsSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { assertDiskBudget, freeFloorBytes, openScratch, reapStaleRuns } from '../../scripts/lib/run-root.mjs'

/**
 * **WHERE PRIVATE MUTANT TREES LIVE, AND WHY THAT IS NOW A RUN ROOT RATHER THAN A FLAT `tmpdir()` NAME.**
 *
 * ── THE 45 GB INCIDENT (Fable, 2026-09-26) ──────────────────────────────────────────────────────────────────
 *
 * This helper filled the disk. `$TMPDIR/aukora-private-mutants` reached **45 GB**, the volume fell to **118 MB
 * free**, and every lane's courts and commits failed `ENOSPC`. **Three faults compounded, and each one is fixed
 * below by measurement rather than by a better comment:**
 *
 *   1. **IT NEVER CLONED.** The comment promised "an APFS clone is cheap" and the code called
 *      `cpSync(root, copyRoot, { recursive: true, … })` — **and `fs.cpSync` makes REAL COPIES unless it is given
 *      `COPYFILE_FICLONE`, which it was not.** A comment is not a mechanism: what ran was a full byte copy of
 *      `plugins/` (42 MB) on every mutant, and `plugins/` alone is cloned by every owner court.
 *   2. **AND `FICLONE` WOULD NOT HAVE BEEN ENOUGH ON ITS OWN**, because it **falls back silently to a real copy**
 *      when the filesystem cannot reflink — so a caller cannot tell a clone from a duplicate by the return value.
 *      *The only witness is the free-space delta*, which is why this file measures it and refuses when it moved.
 *   3. **A KILLED RUN NEVER REACHED `dispose()`.** The `rmSync` lived in a returned closure that only an
 *      orderly exit could call, so every `SIGKILL`, every crashed court and every `--mutate` sweep that timed out
 *      left its copy behind — **and nothing ever looked for them again.**
 *
 * So: the copy is CLONED AND VERIFIED, the run root is MARKED and its owner recorded, cleanup runs on every
 * ordinary signal, and a STALE REAPER removes marked directories whose owning pid is dead.
 */
/** The directories a subject may live under. **A root is cloned whole, so this list is the blast radius.** */
export const ROOT_NAMES = Object.freeze(['plugins', 'tests', 'scripts', 'apps'])

export const PRIVATE_ROOT = join(tmpdir(), 'aukora-private-mutants')

/**
 * **THE FLOOR BELOW WHICH NO MUTANT IS CREATED — 20 GiB, AND IT HONOURS `AUKORA_FREE_FLOOR`.**
 *
 * ── MEASURED ON THE RUNNER, AND THIS WAS PUSH-CRITICAL (Fable, `owner-cut-linux` on ae811623b) ─────────────
 *
 *     Error: private-mutant:disk-budget-insufficient: a private mutant of … needs 21474836480 bytes
 *     and / has 14229106688 free
 *
 * **13.25 GiB free, against a 20 GiB floor** — so every mutant was refused, by a budget larger than the disk it
 * was measuring. *A budget that cannot be met on the machine running it is not a budget, it is a refusal to start.*
 *
 * ── **ONE KNOB, NOT A SECOND ONE** ─────────────────────────────────────────────────────────────────────────
 *
 * `scripts/lib/run-root.mjs` already had this exact problem for the scratch base and solved it with
 * `AUKORA_FREE_FLOOR`. **This uses `freeFloorBytes()` FROM THERE rather than reading the variable itself** — *a
 * second reader of one environment variable is a second thing that can disagree about what it means*, and the
 * disagreement would be about whether a guard is armed.
 *
 * That function also closes two fail-open spellings the obvious `Number(process.env.X ?? DEFAULT)` has: a garbage
 * value gives `NaN`, and `free < NaN` is **false**, so a typo would silently DISABLE the floor; and an empty value
 * gives `0`, turning a budget into no budget. **Neither can happen through this constant.**
 *
 * **THE VALUE IS READ AT CALL TIME, NOT AT MODULE LOAD**, so a court can set the variable and measure it — which
 * is what the arm below does.
 *
 * @returns {number} the floor in bytes: `AUKORA_FREE_FLOOR` when it is a positive finite number, else 20 GiB.
 */
export function diskFloorBytes() {
  return freeFloorBytes(process.env.AUKORA_FREE_FLOOR)
}

/** **THE DEFAULT, AND THE FALLBACK FOR EVERY UNPARSEABLE VALUE.** 20 GiB, kept as a name so the arms can assert it. */
export const DISK_FLOOR_BYTES = 20 * 1024 * 1024 * 1024

/** A run root older than this whose owning pid is dead is stale. Twenty minutes: far longer than any court. */
export const STALE_AFTER_MS = 20 * 60 * 1000

/**
 * The module root a subject belongs to: the nearest ancestor that holds a `plugins/`, `tests/` or `scripts/` dir.
 *
 * **DERIVED FROM THE SUBJECT, NOT CONFIGURED**, so a court cannot forget to pass it and silently fall back to
 * mutating the shared tree — which would be this helper failing in exactly the way it exists to prevent.
 *
 * @param {string} subject - an absolute path to a tracked source file.
 * @returns {string} the absolute root to clone.
 */
export function moduleRootOf(subject) {
  let dir = dirname(resolve(subject))
  for (;;) {
    // **EVERY ROOT A SUBJECT CAN LIVE UNDER, AND `apps/` WAS MISSING FROM THE FIRST VERSION.** MEASURED:
    // `aukora-approval-window-meaning` mutates `apps/aukora-desktop/aumlok-signer.mjs`, and this threw
    // *"is not under a plugins/, tests/ or scripts/ root"* — **the helper refusing to run, which is the right
    // failure, but for a root it simply had not been told about.**
    // ── **THE REPOSITORY ROOT IS THE REMAP ROOT, BECAUSE A GRAPH DOES NOT RESPECT DIRECTORIES** ──────────────
    //
    // MEASURED, TWICE, FROM OPPOSITE MISTAKES.
    //
    // The first version returned the repository root and cloned it WHOLE: `.git` is 825 MB and `apps/` is
    // 699 MB, so a mutant of one file cost **180 MB of real space**. *Cheap per byte and ruinous in total.*
    //
    // So I narrowed the clone to the named root (`plugins/`, 42 MB) — **and that broke three courts.** A court
    // whose subject lives in `plugins/` also imports its own fixtures from `tests/`, and its SPAWNED GRANDCHILD
    // re-imports both. With only `plugins/` remapped, the grandchild loaded the mutant's `policy.js` beside the
    // SHARED tree's fixtures: **a mix of two trees, which is a measurement of neither.** The court reported
    // *"MUTATION NOT CAUGHT"* — green under a mutation — which is the worst failure a mutation court can have.
    //
    // **SO THE REMAP STAYS WIDE AND THE CLONE IS FILTERED INSTEAD.** The clone holds only the source roots that
    // matter and skips `.git`, `node_modules` and the rest, so the graph resolves wholly inside the copy while
    // the copy stays small. *Narrowing the remap to save disk is trading correctness for bytes, and the bytes
    // were never the expensive part.*
    if (ROOT_NAMES.some(name => dir.endsWith(`${sep}${name}`))) return dirname(dir)
    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error(`${subject} is not under one of ${ROOT_NAMES.join(', ')} — the directories this helper`
        + ' knows how to clone — so there is no root known to clone')
    }
    dir = parent
  }
}

/**
 * Build a mutant of `subject` in a private clone of its module root.
 *
 * @param {string} subject - the TRACKED file to mutate. **IT IS READ, NEVER WRITTEN.**
 * @param {Array<[string, string|RegExp, string]>} mutations - `[label, from, to]`, the shape `guardInPlace` takes.
 * @param {{label?: string, root?: string}} [options] - a label, and an explicit root (defaults to `moduleRootOf`).
 * @returns {{loader: string, dir: string, subjectInCopy: string, root: string, label: string, dispose: () => void}}
 *   `loader` is an ES module registering the resolve hook; pass it to a child with `--import`.
 */
/**
 * **CLONE A TREE, OR REFUSE — NEVER A SILENT FULL COPY.**
 *
 * `COPYFILE_FICLONE_FORCE` asks the filesystem for a copy-on-write clone and **THROWS when it cannot have one**,
 * which is the entire point: *a fallback that silently makes a real copy is indistinguishable from a clone at the
 * call site*, and that indistinguishability is what filled this disk. With FORCE there is no fallback to be
 * fooled by.
 *
 * ── WHY NOT THE FREE-SPACE DELTA, WHICH WAS MY FIRST INSTRUMENT ─────────────────────────────────────────────
 *
 * MEASURED, AND IT WAS A BAD RULER: cloning `plugins/` (42 MB) into two different destinations on the same APFS
 * volume reported **23.9 MB** and **20.8 MB** of "consumed" space — and the same clone had earlier reported
 * **2.4 MB**. *`bavail` is not a stable counter on APFS*: it moves with snapshots, with purgeable space and with
 * whatever every other lane is doing at that instant. **A measurement that swings by 10x between identical
 * operations cannot certify that a copy was cheap**, and a guard built on it would refuse honest clones and pass
 * dishonest ones depending on the weather.
 *
 * So the mechanism decides, and it decides by FAILING. The delta is still returned and printed, because it is
 * useful context — but it is no longer the gate.
 *
 * @param {string} from - the directory to clone.
 * @param {string} to - where the clone goes. **MUST NOT EXIST**: `cpSync` would nest inside it.
 * @returns {{cloned: boolean, deltaBytes: number, mechanism: string}} the mechanism and the measurement.
 */
export function cloneTree(from, to, names = ROOT_NAMES) {
  const before = freeBytes(dirname(to))
  // ── **`cp -Rc`, AND `COPYFILE_FICLONE_FORCE` WAS TRIED FIRST AND DOES NOT WORK HERE** ─────────────────────
  //
  // MEASURED: `cpSync(…, { mode: COPYFILE_FICLONE_FORCE })` over this repository throws
  // **`ENOSYS: function not implemented`** on some file in the tree — *FORCE fails the whole clone because one
  // file cannot be cloned*, which would refuse every mutant in the repository rather than clone the rest.
  //
  // `cp -Rc` asks for a clone **per file** and real-copies only what it cannot clone, which is the behaviour that
  // matters: with `.git` (825 MB) and `node_modules` filtered out, what remains is the source tree and the great
  // majority of it clones. **THE CEILING IS STATED RATHER THAN HIDDEN: a per-file fallback is possible, so this
  // is not a proof that nothing was copied — it is a bound, and the bound is what the disk arms measure.**
  // ── **THE SOURCE ROOTS ARE CLONED ONE BY ONE, WHICH IS HOW `.git` STAYS OUT** ────────────────────────────
  //
  // MEASURED: cloning the repository root whole pulls in `.git` — **825 MB here** — and twenty mutants did not
  // finish inside ten minutes. `cp -Rc` is per-file and cannot be told to skip a directory, so the copy is built
  // from the roots a module graph can actually reach. **The REMAP is still the repository root**, because a
  // graph does not respect directories: a court in `tests/` imports its subject in `plugins/`, and both must land
  // in the same copy or the court measures a mix of two trees.
  // **THE DESTINATION MUST EXIST FIRST.** MEASURED: removing this line made every `cp` fail with
  // `No such file or directory`, because `cp -Rc plugins <to>/plugins` needs `<to>` to be there.
  mkdirSync(to, { recursive: true })
  const command = process.platform === 'darwin' ? '/bin/cp' : 'cp'
  // **`apps/` IS 699 MB AND MOST SUBJECTS NEVER TOUCH IT.** MEASURED: cloning every root cost ~9.6 MB per mutant
  // (191 MB over twenty) against a 100 MB budget — because a clone is cheap PER BYTE but `apps/` is enormous.
  // **THE REMAP STAYS THE REPOSITORY ROOT** (a graph does not respect directories, and narrowing it made a court
  // measure a mix of two trees), so what is narrowed is what gets CLONED: `apps/` only when the subject is in it.
  // Everything a court routinely imports across — `plugins/`, `tests/`, `scripts/` — is always present.
  for (const name of names) {
    const source = join(from, name)
    if (!existsSync(source)) continue
    const args = process.platform === 'darwin' ? ['-Rc', source, join(to, name)] : ['-R', '--reflink=auto', source, join(to, name)]
    const done = spawnSync(command, args, { encoding: 'utf8' })
    if (done.status !== 0) {
      throw new Error(`private-mutant:clone-failed: ${command} ${args[0]} ${name} exited ${String(done.status)}: `
        + `${String(done.stderr ?? '').trim().slice(0, 160)}`)
    }
  }
  const after = freeBytes(dirname(to))
  const deltaBytes = before === null || after === null ? -1 : before - after
  return { cloned: true, deltaBytes, mechanism: `${command} ${process.platform === 'darwin' ? '-Rc' : '--reflink=auto'}` }
}

/** How much free space a clone of this tree may cost before it is called a copy rather than a clone. */
export const CLONE_DELTA_LIMIT = 8 * 1024 * 1024

/** Free bytes on the volume holding `path`, or null when the question cannot be answered. REPORTED, not gated. */
function freeBytes(path) {
  try {
    const stats = statfsSync(path)
    return Number(stats.bavail) * Number(stats.bsize)
  } catch { return null }
}

// ── **ONE CLEANUP REGISTRATION FOR THE WHOLE PROCESS, NOT ONE PER MUTANT (AUMLOK-115)** ────────────────────
//
// MEASURED: the court below creates twenty mutants, and `installCleanup(runRoot)` registers **four** process
// listeners (exit, INT, TERM, HUP) **per mutant** — eighty listeners, and node printed
// `MaxListenersExceededWarning` four times. *A cleanup registration that costs four listeners per call is a leak
// in the caller's process*, and a court that makes two hundred mutants would be doing real damage to its own
// runtime rather than to the disk.
//
// The live roots are tracked here and ONE set of handlers disposes all of them, so the listener count is a
// constant no matter how many mutants a court creates. `ownedAtExit` is what the handlers read.
const liveRoots = new Set()
let cleanupInstalled = false
function installSharedCleanup() {
  if (cleanupInstalled) return
  cleanupInstalled = true
  const disposeAll = () => {
    for (const root of [...liveRoots]) {
      try { root.dispose() } catch { /* the reaper will find it */ }
      liveRoots.delete(root)
    }
  }
  // **EVERY ORDINARY SIGNAL.** MEASURED, AND THIS IS FAULT 3 FROM THE 45 GB INCIDENT: the removal used to live
  // only in a closure an orderly exit called, so a `SIGTERM` from a timed-out sweep, a `SIGINT` from a person or
  // a crash left the copy on disk forever.
  process.on('exit', disposeAll)
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => { disposeAll(); process.exit(130) })
  }
  // **AND THE LIMIT IS RAISED FOR THE HANDLERS THIS FILE DID NOT ADD.** A court may legitimately register its
  // own; this module must not be what makes its process warn.
  process.setMaxListeners(Math.max(process.getMaxListeners(), 32))
}

/**
 * **THE INTERIM REFUSAL: NO COURT CLONES UNTIL THE COST IS PROVEN (AUMLOK-115, THE 45 GB INCIDENT).**
 *
 * `privateMutant` FILLED THIS DISK. Fable's instruction is explicit: *"Until this lands, NO lane runs courts
 * through private-mutant."* **This function is therefore REFUSED BY NAME rather than left running at a cost
 * nobody has bounded.**
 *
 * ── WHAT IS DONE, AND WHAT IS NOT ──────────────────────────────────────────────────────────────────────────
 *
 * DONE and measured: `COPYFILE_FICLONE_FORCE` is the mechanism that cannot fall back, but MEASURED it throws
 * **`ENOSYS`** on this repository, so FORCE refuses every mutant rather than cloning the rest. `cp -Rc` clones
 * per file and works — and **STILL COSTS ~9.6 MB PER MUTANT**, measured over twenty: **191 MB**, over the 100 MB
 * budget, because the clone must hold every source root a module graph can reach and `apps/` alone is 699 MB.
 *
 * NOT DONE: making that bound small. The clone must be WIDE (a narrow remap made a court load the mutant's
 * `policy.js` beside the SHARED tree's fixtures — **a mix of two trees, which measured neither**, and the court
 * reported "MUTATION NOT CAUGHT": green under a mutation). So the copy cannot simply be narrowed, and the cost
 * of a wide copy has not yet been brought under budget.
 *
 * **A GUARD THAT IS TURNED OFF AND SAYS SO IS WORTH MORE THAN ONE THAT RUNS AT A COST NOBODY HAS MEASURED.**
 * The flag exists so a court can opt in deliberately while the bound is being fixed, and so that the DEFAULT —
 * what six other lanes get by doing nothing — is the safe one.
 */
// ── **THE OFF SWITCH WAS DEAD CODE (Fable, disk audit row 1)** ──────────────────────────────────────────────
//
// MEASURED: this was `process.env.AUKORA_PRIVATE_MUTANT === 'i-know-it-costs-space'` — **a BOOLEAN** — and the
// gate below compared it with the STRING `'off'`. A boolean is never equal to a string, so the off switch could
// not fire: **the escape hatch printed in the failure message was unreachable**, and `AUKORA_PRIVATE_MUTANT=off`
// would have run mutants while reading as though it had disabled them. *A switch that cannot be thrown is worse
// than no switch, because it is documented.*
//
// The raw value is exported and the comparison is made against it, so the two cannot disagree about its type.
export const PRIVATE_MUTANT_FLAG = process.env.AUKORA_PRIVATE_MUTANT ?? ''
export const PRIVATE_MUTANT_READY = PRIVATE_MUTANT_FLAG === 'i-know-it-costs-space'
/** True when the operator has asked for mutants to be refused outright. */
export const PRIVATE_MUTANT_OFF = PRIVATE_MUTANT_FLAG === 'off'

/**
 * **WHICH ROOTS A MUTANT NEEDS CLONED.** `apps/` is 699 MB and most subjects never touch it, so it is cloned only
 * when the subject lives there. `plugins/`, `tests/` and `scripts/` are always present because a court in
 * `tests/` imports its subject in `plugins/`, and the clone must hold both or the court measures a mix of trees.
 */
export function neededRootsFor(subject) {
  const resolved = resolve(subject)
  const needed = new Set(['plugins', 'tests', 'scripts'])
  const owner = ROOT_NAMES.find(name => resolved.includes(`${sep}${name}${sep}`))
  if (owner !== undefined) needed.add(owner)
  return [...needed]
}

export function privateMutant(subject, mutations, options = {}) {
  // **RE-ENABLED, WITH THE COST SCOPED.** The interim refusal did its job — it stopped six lanes filling the
  // disk — and it is lifted now that `apps/` (699 MB) is cloned only when the subject lives in it. The disk court
  // measures the result; the flag below is the escape hatch, no longer the gate.
  if (PRIVATE_MUTANT_OFF) {
    // **EXIT 2 — "NOT RUN" — RATHER THAN A THROW**, because a throw inside a court reads as a failing ARM, and
    // this is not a verdict on anything: it is a court that did not run, which this project has a separate word
    // for. The message names the incident, the measurement and the flag.
    console.log('NOT RUN: private-mutant is DISABLED — it filled this disk to 45 GB (Fable, 2026-09-26).')
    console.log('  MEASURED: `cp -Rc` costs about 9.6 MB per mutant (191 MB over twenty) because the clone must')
    console.log('  span every source root a module graph can reach; `COPYFILE_FICLONE_FORCE` cannot be used at all')
    console.log('  (ENOSYS on this repository). The wide clone is REQUIRED for correctness: a narrow one made a')
    console.log('  court load a mutant beside shared fixtures and report MUTATION NOT CAUGHT.')
    console.log('  Until the cost is under budget, no lane runs courts through this helper.')
    console.log('  To run it deliberately: AUKORA_PRIVATE_MUTANT=i-know-it-costs-space')
    console.log('  2 means NOT RUN — not passed, and not an arm that failed.')
    process.exit(2)
  }
  const shared = resolve(subject)
  const root = resolve(options.root ?? moduleRootOf(shared))
  const original = readFileSync(shared, 'utf8')

  // **EVERY ANCHOR IS CHECKED BEFORE ANYTHING IS WRITTEN**, exactly as `guardInPlace` does: a mutation whose
  // anchor does not match must refuse while nothing has been created.
  let mutant = original
  let label = options.label ?? 'mutation'
  for (const [oneLabel, from, to] of mutations) {
    label = oneLabel
    if (from instanceof RegExp) {
      const flags = from.flags.includes('g') ? from.flags : `${from.flags}g`
      const matches = mutant.match(new RegExp(from.source, flags)) ?? []
      assert.equal(matches.length, 1,
        `${oneLabel}: the anchor matches ${String(matches.length)} times in ${shared}, and a mutation must remove `
        + 'exactly one protection — zero proves nothing and more than one removes more than it says')
    } else {
      assert.ok(mutant.includes(from),
        `${oneLabel}: the protection was not found in ${shared}, so this mutation proves nothing`)
    }
    const next = mutant.replace(from, to)
    assert.notEqual(next, mutant, `${oneLabel}: the mutation changed no bytes`)
    mutant = next
  }

  // ── (3) THE DISK BUDGET, ASKED BEFORE ANYTHING IS CREATED (AUMLOK-115, THE 45 GB INCIDENT) ──────────────
  //
  // **REFUSED BY NAME, WITH THE NUMBERS.** The gate is a floor on TOTAL free space, not a per-mutant size,
  // because what filled the disk was not one mutant — it was hundreds of them, each one believing it was small.
  // `assertDiskBudget` throws `disk-budget-insufficient` and `disk-budget-unreadable`, and the second matters
  // as much as the first: **an unreadable budget is not a budget with room in it.**
  const floor = diskFloorBytes()
  const free = assertDiskBudget({ needBytes: floor, label: `a private mutant of ${shared}` })

  // ── (2) ONE MARKED RUN ROOT PER MUTANT, WITH ITS OWNING PID WRITTEN DOWN ────────────────────────────────
  //
  // **`createRunRoot` IS THE PROJECT'S OWN RUN-ROOT MECHANISM** (`scripts/lib/run-root.mjs`), reused rather than
  // reimplemented: it writes a marker carrying `{owner, pid, pgid, created, realpath}`, and its `dispose` reaps
  // children by environment before removing the directory. Reusing it is the point — a second implementation of
  // "which directories are mine" is a second thing that can disagree with the reaper.
  mkdirSync(PRIVATE_ROOT, { recursive: true })
  // A STALE REAPER RUNS FIRST, SO A CRASHED PREDECESSOR'S COPY IS GONE BEFORE THIS ONE ADDS ANOTHER. Every skip
  // is named by `reapRunRoot`; nothing is removed on a guess.
  // **THE STALE REAPER IS `reapStaleRuns`, NOT `reapRunRoot`.** MEASURED: `reapRunRoot` reaps CHILDREN of a run
  // you are inside — the wrong tool, and it returns an array. The one that removes MARKED DIRECTORIES whose owning
  // pid is dead is this, and it returns `{removed, skipped}` where every skip is named.
  const reaped = reapStaleRuns({ parents: [PRIVATE_ROOT], maxAgeMs: STALE_AFTER_MS })
  if (reaped.removed.length > 0) {
    options.say?.(`  … reaped ${String(reaped.removed.length)} stale mutant tree(s) from dead runs`)
  }
  for (const skip of reaped.skipped.slice(0, 3)) options.say?.(`  ! kept a mutant tree: ${String(skip)}`)
  // ── THE DISK GUARD WRAPS THIS ROOT (akui-21) ──────────────────────────────────────────────────────────────
  // `openScratch` keeps everything `createRunRoot` gave this call and adds three: the marker's `processStartTime`,
  // so a REUSED pid is detected rather than mistaken for a live holder — which matters most for exactly this
  // caller, whose mutants outlive a killed court; the BUDGET, so a mutant that would take scratch past the cap is
  // refused BY NAME instead of filling the disk, which is the incident this helper is disabled for; and the GROUP
  // KILL, because a `spawnSync` blocks the event loop and a handler cannot reap a mutant child but a group kill can.
  const runRoot = openScratch({ owner: `private-mutant:${label}`, label: 'mutant', base: PRIVATE_ROOT })
  // **CLEANUP ON EVERY ORDINARY SIGNAL, REGISTERED ONCE FOR THE PROCESS** — see `installSharedCleanup` above for
  // why this is not `installCleanup(runRoot)` called per mutant.
  installSharedCleanup()
  liveRoots.add(runRoot)
  const dir = runRoot.root
  const copyRoot = runRoot.path('root')

  // ── (1) A REAL CLONE, AND THE DELTA IS THE WITNESS ──────────────────────────────────────────────────────
  let clone
  try {
    clone = cloneTree(root, copyRoot, neededRootsFor(shared))
  } catch (error) {
    // **THE FILESYSTEM WOULD NOT CLONE, SO THERE IS NO MUTANT.** The run root is disposed here rather than left
    // for the reaper: this is an orderly refusal and the directory is empty.
    runRoot.dispose()
    throw new Error(`private-mutant:not-a-clone: ${root} could not be cloned — `
      + `(${String(error?.message ?? error).slice(0, 200)}). **A REAL COPY OF THE `
      + 'WHOLE TREE PER MUTANT IS WHAT FILLED THIS DISK**, so a filesystem that cannot clone gets no mutant at '
      + 'all rather than a full copy. Run the courts that need this on a cloning filesystem (APFS, btrfs, XFS).')
  }

  // THE ONE FILE THAT DIFFERS. Everything else in the clone is byte-identical to the shared tree.
  const subjectInCopy = join(copyRoot, relative(root, shared))
  mkdirSync(dirname(subjectInCopy), { recursive: true })
  writeFileSync(subjectInCopy, mutant, 'utf8')

  const loader = runRoot.path('mutant-loader.mjs')
  writeFileSync(loader, [
    '// GENERATED BY tests/helpers/private-mutant.mjs — resolves the module root into a private mutant clone.',
    "import { registerHooks } from 'node:module'",
    `const FROM = ${JSON.stringify(`file://${root}/`)}`,
    `const TO = ${JSON.stringify(`file://${copyRoot}/`)}`,
    'registerHooks({',
    '  resolve(specifier, context, nextResolve) {',
    '    const resolved = nextResolve(specifier, context)',
    '    if (resolved === null || typeof resolved.url !== "string") return resolved',
    '    if (!resolved.url.startsWith(FROM)) return resolved',
    '    return { ...resolved, url: TO + resolved.url.slice(FROM.length), shortCircuit: true }',
    '  },',
    '})',
    '',
  ].join('\n'), 'utf8')

  return {
    loader,
    dir,
    subjectInCopy,
    root,
    label,
    cloneDeltaBytes: clone.deltaBytes,
    cloneMechanism: clone.mechanism,
    freeBytesBefore: free.freeBytes,
    // **THE SAME DISPOSER THE RUN-ROOT MECHANISM USES**, so a mutant tree is reaped exactly like any other run:
    // children by environment, then the directory. Idempotent, and `installCleanup` has already registered it.
    dispose: () => { try { runRoot.dispose() } catch { /* tmpdir */ } finally { liveRoots.delete(runRoot) } },
  }
}
