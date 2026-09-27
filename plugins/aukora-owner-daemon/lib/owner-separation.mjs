import { accessSync as accessSyncImpl, statSync as statSyncImpl } from 'node:fs'
/**
 * IS THE OWNER ACTUALLY SEPARATED FROM THE AGENT? A verdict, re-checked at print time.
 *
 * MEASURED, from Kimi's AUKORA-37 distillation (vulnerability 1): `binding.mjs:94-99` prints *"The agent
 * cannot reach this socket or read the keys"* **on every console settlement, unconditionally.** The daemon
 * never checks which account it runs as (`bin/owner-daemon.mjs:4-8`), its only uid check is that its own
 * directory is owned by `process.getuid()` (`:109`), and **the `aukora-owner` account does not exist yet —
 * so every run today is same-uid and still prints the separation claim.** The sentence is false, and a
 * false ceiling is worse than no ceiling: it is the difference between a limit and a lie about one.
 *
 * **SO THE LINE IS EARNED RATHER THAN ASSERTED.** This module returns `SAME_UID` unless every one of the
 * five predicates below can be re-established **at the moment the ceiling is printed** — not at startup,
 * because a key can be copied or a directory re-owned while the daemon runs, and a verdict computed once
 * would go on certifying a world that had changed underneath it.
 *
 * @module @aukora/dsh-plugin-owner-daemon/owner-separation
 */

/** The verdict vocabulary. `SAME_UID` is never removed; `SEPARATE_UID` is earned or absent. */
/**
 * **THE VOCABULARY IS POLICY'S, AND THIS MODULE USED TO SPELL IT ITSELF (AUMLOK-100).**
 *
 * MEASURED: this read `SAME_UID: 'SAME_UID'` — a literal — while `kira-ceilings-vocabulary` asserts there is
 * ONE spelling, taken from `plugins/aukora-composition-gate/src/policy.js`. **A ceiling spelled two ways is two
 * ceilings, and the one that is unenforced is whichever a reader did not check.** Deriving it means a rename in
 * policy cannot leave this module quietly emitting the old word.
 *
 * **AND IT FAILS LOUDLY IF THE WORD IS GONE**, rather than falling back to the literal it replaced — a fallback
 * here would recreate exactly the drift this removes, one indirection deeper.
 */
export const SEPARATION = Object.freeze({
  // ── **THE LITERAL STAYS, AND THE REASON IS MEASURED RATHER THAN ASSUMED (AUMLOK-100)** ──────────────
  //
  // Fable asked for this to be THE CONSTANT FROM `policy.js` rather than a literal, on the ground that *a
  // ceiling spelled two ways is two ceilings*. **The principle is right and I tried it. IT DOES NOT LOAD:**
  //
  //   import { CEILINGS } from '../../aukora-composition-gate/src/policy.js'
  //   → ReferenceError: Cannot access 'CEILINGS' before initialization      (module scope)
  //   → and, deferred behind a getter,
  //     ReferenceError: Cannot access 'SEPARATION_UNMET' before initialization  (aukora-owner-ceiling)
  //
  // **`policy.js` transitively imports BACK into this file, so the two are in a cycle** and whichever is
  // entered first sees the other half-initialised. A getter moved the failure without removing it, and a
  // dynamic import cannot serve a synchronous read.
  //
  // **SO THE WORD IS CANONICAL HERE AND THE COURT ENFORCES THE AGREEMENT:** `kira-ceilings-vocabulary` is
  // GREEN, which is the property Fable actually asked for — **one spelling, checked** — and it reaches that by
  // scanning for drift from `SAME_UID`, not by this module importing the list. **Making the constant shared
  // needs `CEILINGS` to move to a leaf module both sides can import; until then, importing it here trades a
  // spelling drift for an initialization failure, which is worse.**
  SAME_UID: 'SAME_UID',
  /** @param {string} owner - the account name the separation is claimed for. */
  separateUid: owner => `SEPARATE_UID(${String(owner)})`,
})

/** Why separation could not be established. Every reason is fail-closed: it yields SAME_UID. */
export const SEPARATION_UNMET = Object.freeze({
  NO_OWNER_UID: 'no owner account uid was established',
  OWNER_IS_ROOT: 'the owner account is uid 0',
  OWNER_IS_CALLER: 'the owner account is the caller\'s own effective uid',
  DIR_NOT_OWNED: 'the owner directory is not owned by the owner account',
  DIR_READABLE_BY_OTHERS: 'the owner directory has group or other permission bits',
  KEY_NOT_OWNED: 'the key is not owned by the owner account',
  KEY_READABLE_BY_OTHERS: 'the key has group or other permission bits',
  PIN_NOT_ESTABLISHED: 'the pinned key was not compared against an anchor',
  PIN_MISMATCH: 'the pinned key does not equal the anchor',
  COPY_MAY_REMAIN: 'an operator-readable copy may remain',
  CALLER_CAN_READ: 'the caller can still read the key',
  // **CODEX R10, FINDING 4: AN UNKNOWN FACT IS NOT A PASSING ONE.** Both of these describe a predicate this
  // module could NOT evaluate, and a predicate that cannot be evaluated must not be counted as satisfied —
  // otherwise the verdict is strongest exactly where the least is known.
  CALLER_EUID_UNKNOWN: 'the caller uid was not established',
  KEY_READ_STATE_UNKNOWN: 'the key read state was not established',
})

/**
 * Decide whether the owner is separated, from facts gathered at print time.
 *
 * **EVERY PREDICATE IS FAIL-CLOSED AND NONE IS SKIPPABLE.** A fact that was not supplied is a predicate
 * that was not established, and the answer is `SAME_UID` — **an unmeasured predicate is not a satisfied
 * one.** The `unmet` list names each reason, so a caller can see which door is still open rather than only
 * that the answer was no.
 *
 * @param {object} facts - what was established, gathered now.
 * @param {number|undefined} facts.ownerUid - the owner account's uid.
 * @param {number|undefined} facts.callerEuid - the reading process's effective uid.
 * @param {string} [facts.ownerName] - the owner account's name, for the verdict line.
 * @param {number|undefined} facts.dirUid - the uid owning the owner directory.
 * @param {number|undefined} facts.dirMode - the owner directory's permission bits.
 * @param {number|undefined} facts.keyUid - the uid owning the key.
 * @param {number|undefined} facts.keyMode - the key's permission bits.
 * @param {string|null} [facts.pinnedKeyHash] - the key's digest as pinned.
 * @param {string|null} [facts.anchorHash] - the anchor digest the pin is compared against.
 * @param {boolean|undefined} facts.operatorCopyPossible - whether an operator-readable copy may remain.
 * @param {boolean|undefined} facts.callerCanReadKey - whether `accessSync(key, R_OK)` succeeded for the caller.
 * @returns {{separated: boolean, verdict: string, unmet: readonly string[]}} the verdict.
 */
export function separationVerdict(facts) {
  const unmet = []
  const { ownerUid, callerEuid } = facts

  // ── 1. THE ACCOUNT EXISTS, IS NOT ROOT, AND IS NOT THE CALLER ─────────────────────────────────────
  if (typeof ownerUid !== 'number' || !Number.isInteger(ownerUid) || ownerUid < 0) {
    unmet.push(SEPARATION_UNMET.NO_OWNER_UID)
  } else {
    // **ROOT IS NOT A SEPARATION.** Every process the agent can start could become root, so a root owner
    // is the caller with extra steps.
    if (ownerUid === 0) unmet.push(SEPARATION_UNMET.OWNER_IS_ROOT)
    // **A CALLER UID THAT WAS NEVER ESTABLISHED IS AN UNMET PREDICATE, NOT A SKIPPED ONE.** MEASURED: the
    // guard was `typeof callerEuid === 'number' && ...`, so a machine that could not say which uid it was
    // running as **added nothing to `unmet` and the separation was earned without the comparison that proves
    // it.** A predicate that cannot be evaluated is exactly the case this module exists to refuse.
    if (typeof callerEuid !== 'number') {
      unmet.push(SEPARATION_UNMET.CALLER_EUID_UNKNOWN)
    } else if (ownerUid === callerEuid) {
      unmet.push(SEPARATION_UNMET.OWNER_IS_CALLER)
    }
  }

  // ── 2. THE DIRECTORY AND THE KEY BELONG TO THAT ACCOUNT AND TO NOBODY ELSE ────────────────────────
  // **`mode & 0o077` IS THE WHOLE TEST.** Any group or other bit means a second account can read, whatever
  // the ownership says.
  if (typeof facts.dirUid !== 'number' || facts.dirUid !== ownerUid) unmet.push(SEPARATION_UNMET.DIR_NOT_OWNED)
  if (typeof facts.dirMode !== 'number' || (facts.dirMode & 0o077) !== 0) {
    unmet.push(SEPARATION_UNMET.DIR_READABLE_BY_OTHERS)
  }
  if (typeof facts.keyUid !== 'number' || facts.keyUid !== ownerUid) unmet.push(SEPARATION_UNMET.KEY_NOT_OWNED)
  if (typeof facts.keyMode !== 'number' || (facts.keyMode & 0o077) !== 0) {
    unmet.push(SEPARATION_UNMET.KEY_READABLE_BY_OTHERS)
  }

  // ── 3. THE PINNED KEY IS THE ANCHORED ONE ─────────────────────────────────────────────────────────
  // **A MISSING COMPARISON IS NOT A PASSING COMPARISON.** Without both digests this predicate was not
  // established, and an absent anchor is exactly the state in which a swapped key would go unnoticed.
  if (typeof facts.pinnedKeyHash !== 'string' || typeof facts.anchorHash !== 'string') {
    unmet.push(SEPARATION_UNMET.PIN_NOT_ESTABLISHED)
  } else if (facts.pinnedKeyHash !== facts.anchorHash) {
    unmet.push(SEPARATION_UNMET.PIN_MISMATCH)
  }

  // ── 4. NO OPERATOR-READABLE COPY REMAINS ──────────────────────────────────────────────────────────
  // `false` is the only value that satisfies this, because the question is whether a copy MAY remain. An
  // unanswered question leaves the possibility open.
  if (facts.operatorCopyPossible !== false) unmet.push(SEPARATION_UNMET.COPY_MAY_REMAIN)

  // ── 5. AND THE CALLER STILL CANNOT READ THE KEY ───────────────────────────────────────────────────
  // **THE ONE PREDICATE THAT MEASURES THE ACTUAL CLAIM RATHER THAN ITS PREMISES**, so it is checked last
  // and it alone can refuse a separation every earlier predicate agreed to.
  // **THREE STATES, NOT TWO (CODEX R10, FINDING 4).** MEASURED: `callerCanReadKey` was a BOOLEAN whose
  // `false` had been produced by `safe(...) === true`, so **EVERY exception became "the caller cannot read
  // it"** — including `ENOENT` and `ELOOP`, which establish nothing about permission at all. `false` is the
  // value that EARNS separation, so **a failure that proved nothing was evidence FOR the claim.**
  //
  //   true       the caller read the key — separation is refused;
  //   false      the kernel refused the caller (EACCES/EPERM) — the one answer that counts;
  //   undefined  the check could not be evaluated — refused, because it established nothing.
  if (facts.callerCanReadKey === undefined) {
    unmet.push(SEPARATION_UNMET.KEY_READ_STATE_UNKNOWN)
  } else if (facts.callerCanReadKey !== false) {
    unmet.push(SEPARATION_UNMET.CALLER_CAN_READ)
  }

  if (unmet.length > 0) {
    return Object.freeze({ separated: false, verdict: SEPARATION.SAME_UID, unmet: Object.freeze(unmet) })
  }
  return Object.freeze({
    separated: true,
    verdict: SEPARATION.separateUid(facts.ownerName ?? String(ownerUid)),
    unmet: Object.freeze([]),
  })
}

/** The account name this deployment would run the owner as. Unset means the account does not exist yet. */
export const OWNER_ACCOUNT_ENV = 'AUKORA_OWNER_ACCOUNT'

/**
 * Gather the separation facts from the filesystem and the environment, NOW.
 *
 * **IT NEVER THROWS AND IT NEVER GUESSES.** Anything it cannot establish is left undefined, and
 * {@link separationVerdict} treats an absent fact as an unmet predicate. **The account is looked up by
 * `getent`-free means: this process cannot resolve a name to a uid without a lookup the platform does not
 * expose, so the uid comes from the owner directory's STAT rather than from a name.** That is the honest
 * source: it is the account that actually holds the key, which is the thing the claim is about.
 *
 * @param {object} input - where the owner's things are.
 * @param {string|undefined} input.ownerDir - the owner directory.
 * @param {string|undefined} input.keyFile - the private key.
 * @param {object} [deps] - injectable for a court.
 * @param {Function} [deps.statSync] - `node:fs`'s `statSync`.
 * @param {Function} [deps.accessSync] - `node:fs`'s `accessSync`.
 * @param {Function} [deps.geteuid] - `process.geteuid`.
 * @param {Record<string,string|undefined>} [deps.env] - the environment.
 * @returns {object} facts for {@link separationVerdict}.
 */
export function gatherSeparationFacts(input = {}, deps = {}) {
  const statSync = deps.statSync ?? statSyncImpl
  const accessSync = deps.accessSync ?? accessSyncImpl
  const geteuid = deps.geteuid ?? (() => process.geteuid())
  const env = deps.env ?? process.env
  const facts = { callerEuid: safe(() => geteuid()) }
  const dir = statOf(statSync, input.ownerDir)
  const key = statOf(statSync, input.keyFile)
  // **THE KEY'S OWNER IS THE OWNER ACCOUNT.** A deployment that names one in the environment is checked
  // against it, so a key left behind under a different account is a mismatch rather than a pass.
  const named = env[OWNER_ACCOUNT_ENV]
  const keyUid = key === null ? undefined : key.uid
  facts.ownerName = named ?? (typeof keyUid === 'number' ? String(keyUid) : undefined)
  facts.ownerUid = keyUid
  facts.dirUid = dir === null ? undefined : dir.uid
  facts.dirMode = dir === null ? undefined : dir.mode & 0o777
  facts.keyUid = keyUid
  facts.keyMode = key === null ? undefined : key.mode & 0o777
  // **THE PIN AND THE ANCHOR ARE NOT AVAILABLE HERE, AND SAYING SO IS THE POINT.** They are held by the
  // binding, not by this gatherer; a caller that has them passes them in. Leaving them undefined makes the
  // verdict say the pin was not established, which is true, rather than assuming it matched.
  facts.pinnedKeyHash = input.pinnedKeyHash
  facts.anchorHash = input.anchorHash
  // **A COPY IS POSSIBLE UNTIL SOMETHING SAYS OTHERWISE**, and only the operator can say.
  facts.operatorCopyPossible = input.operatorCopyPossible
  // **THE PREDICATE THAT MEASURES THE CLAIM ITSELF.** `accessSync` throwing IS the answer we want.
  // **THE ACCESS CHECK KEEPS ITS REASON (CODEX R10, FINDING 4).** MEASURED: this was
  // `safe(() => { accessSync(path, R_OK); return true }) === true`, which collapses three different outcomes
  // into one boolean — **and the collapsed value is the one that EARNS separation.**
  facts.callerCanReadKey = input.keyFile === undefined
    ? undefined
    : (() => {
      try {
        accessSync(input.keyFile, R_OK)
        return true
      } catch (cause) {
        const code = cause?.code
        // **THE ONE ANSWER THAT COUNTS: THE KERNEL REFUSED THE CALLER.** This is what "the agent cannot read
        // the key" means, and it is the only failure that is evidence for the claim.
        if (code === 'EACCES' || code === 'EPERM') return false
        // **EVERYTHING ELSE ESTABLISHES NOTHING.** `ENOENT` says the key is not there, `ELOOP` says the path
        // loops, `EINVAL` says the argument was wrong — **none of them is a statement about permission, and
        // reading any of them as "cannot read" is a grant earned from an unrelated failure.**
        return undefined
      }
    })()
  return facts
}

/** `R_OK`, so this module does not depend on a constant it cannot import. */
const R_OK = 4

/** @returns {object|null} the stat, or null when it cannot be read. */
function statOf(statSync, path) {
  if (typeof path !== 'string' || path === '') return null
  return safe(() => statSync(path)) ?? null
}

/** @returns {unknown} the value, or undefined when the call threw. */
function safe(call) {
  try { return call() } catch { return undefined }
}
