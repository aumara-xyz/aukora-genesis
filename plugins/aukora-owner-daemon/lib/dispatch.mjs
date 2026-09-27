/**
 * WHAT AN APPROVAL ACTUALLY AUTHORISES — ONE TABLE, KEYED BY THE FROZEN PROPOSAL'S OPERATION.
 *
 * **CODEX P1 #2: THE APPROVED OPERATION DID NOT CONSTRAIN WHAT EXECUTED.** MEASURED: with a Kira store
 * configured, the phone path — and the console path — called Kira **whatever the operation was**, and
 * `settle-adapter.mjs` parsed the frozen bytes and checked `OWNER_DAEMON` while ignoring the proposal's
 * operation and scope entirely. So an approval the owner granted for one thing could execute another: the
 * owner answered a question about an artifact admission and a memory write happened, or the reverse.
 *
 * **ONE APPROVAL, ONE EFFECT, AND THE EFFECT IS DECIDED BY THE FROZEN OPERATION.** Nothing else in the daemon
 * decides what an approval does: the settle paths ask this table and do what it says, or refuse by name. A
 * second place that could decide would be a second answer, and the two would disagree in exactly the case
 * that matters.
 */

import { OPERATIONS, SCOPE_KINDS, parseScope } from './operations.mjs'

/** The refusal a caller sees when an operation is not one this daemon will execute. */
export const DISPATCH_REFUSE = Object.freeze({
  OPERATION_NOT_DISPATCHED: 'aukora-owner:operation-not-dispatched',
  /** The operation is a real kind this daemon knows, and it is deliberately not enabled. */
  OPERATION_NOT_ENABLED: 'aukora-owner:operation-not-enabled',
  SCOPE_NOT_THIS_STORE: 'aukora-owner:scope-not-this-store',
})

/** The two effects this daemon knows how to perform. */
export const EFFECTS = Object.freeze({
  /** Write one approved memory record through Kira's owner store. */
  KIRA_SETTLE: 'kira-settle',
  /** Sign an admission grant with the daemon's key. Writes NOTHING. */
  GRANT_ONLY: 'grant-only',
  /**
   * **MOVE `main`, BY COMPARE-AND-SWAP, AFTER THE OWNER APPROVED THE RANGE (aumlok-135).**
   *
   * The one effect that reaches outside this machine. It is not a Kira store and not a signature, so it has its
   * own name rather than borrowing one — *an effect that borrows a name is an effect whose scope check is about
   * something else.*
   */
  REPO_ADVANCE: 'repo-advance',
})

/**
 * THE TABLE. Keyed by the OPERATION FROZEN IN THE PROPOSAL — the same string the owner read on the sheet —
 * and each row is one effect.
 *
 * `kira.memory.put` IS THE CANONICAL SPELLING and the namespaced one Fable named. `kira.settle` is the
 * spelling the protocol court freezes TODAY and is kept as an explicit alias rather than renamed: they are
 * one effect, the alias is recorded HERE with its reason, and `effectFor` is the only place either is read.
 * **Two spellings in one table is a statement about the tree, not a second mechanism** — the alternative was
 * to change a frozen operation name and invalidate digests the owner has already been shown.
 */
export const DISPATCH = Object.freeze({
  [OPERATIONS.KIRA_MEMORY_PUT]: EFFECTS.KIRA_SETTLE,
  [OPERATIONS.ADMIT_ARTIFACT]: EFFECTS.GRANT_ONLY,
  [OPERATIONS.ADMIT_SET]: EFFECTS.GRANT_ONLY,
  // **THE ROW THAT WAS MISSING.** Without it `effectFor('repo.advance')` refused
  // `aukora-owner:operation-not-dispatched` and the executor wired in `advance-main.mjs` could never be reached.
  [OPERATIONS.REPO_ADVANCE]: EFFECTS.REPO_ADVANCE,
})

/**
 * **OPERATIONS THIS DAEMON RECOGNISES AND DELIBERATELY DOES NOT PERFORM.**
 *
 * An entry here is not a TODO and not a stub: it is the statement that a proposal naming this operation is
 * WELL-FORMED and would be refused for a reason a reader can act on. **`repo.advance` IS HERE BECAUSE PETER HAS
 * NOT DECIDED THE VERIFIER YET** — the record and its plain-words display are built (AUMLOK, plan row 2), the
 * verifier and the compare-and-swap push are not (ALPHA, row 3), and until they are, a signed approval naming
 * this operation must grant nothing at all.
 *
 * **DELETING AN ENTRY IS THE ACT OF ENABLING**, which is why the check below consults `DISPATCH` first: an
 * operation with a real effect is never caught here, so this list cannot quietly disable something that works.
 */
// **`repo.advance` IS ENABLED (aumlok-135).** Peter's first real transaction: the effect runs, or nothing does.
// `release.activate` stays held — *switching the app to code the courts have not seen is a different act from
// moving main, and the second one is the one that was asked for today.*
export const NOT_ENABLED = Object.freeze(new Set([OPERATIONS.RELEASE_ACTIVATE]))

/**
 * **THE REFUSAL NAMES THE OPERATION THAT IS OFF, AND MY FIRST VERSION HARDCODED IT (aumlok-125).**
 *
 * It read `OPERATION_NOT_ENABLED: 'repo.advance: not enabled'`, so the MOMENT A SECOND OPERATION WAS ADDED TO THE
 * LIST, `release.activate` would have been refused with a message naming **repo.advance** — *a refusal that names
 * the wrong operation sends a reader to the wrong place, and it would have looked correct in every court that
 * only ever checked one operation.* The code is now a family name and the message is built per operation.
 */
export const notEnabledRefusal = operation => `${String(operation)}: not enabled`

/**
 * WHETHER THIS PROPOSAL'S SCOPE NAMES THE PLACE THIS DAEMON WOULD ACTUALLY ACT.
 *
 * **THE SCOPE NAMES *WHERE*, THE OPERATION NAMES *WHAT*.** `kira.store:<ledgerId>` names one store;
 * `gate.release:<release>` names one release. The check is that the scope is of the RIGHT KIND **and names
 * the RIGHT TARGET** — a scope of the right kind pointing at another store is a different act from the one
 * the person read, and it is refused rather than accepted because it parsed.
 *
 * @param {unknown} scope - the scope as frozen in the proposal.
 * @param {string} expectedKind - one of {@link SCOPE_KINDS}.
 * @param {string} expectedTarget - the store or release name this daemon is configured for.
 * @returns {true}
 * @throws {Error} `aukora-owner:scope-not-this-store`, by name.
 */
/**
 * **CAN THIS PROPOSAL BE DISPATCHED AT ALL? ASKED BEFORE THE APPROVAL IS SPENT (cohesion plan row 27).**
 *
 * ── THE DEFECT, MEASURED AT HEAD ──────────────────────────────────────────────────────────────────────────
 *
 * `bin/owner-daemon.mjs` did this, in this order:
 *
 *     :541   journal.advance(nonce, JOURNAL_STATE.EFFECT_STARTED)   <-- THE APPROVAL IS CONSUMED HERE
 *     :542   authoriseSettlement({ store, approval, authority })
 *     :544   performApprovedEffect(proposal, result.authority)      <-- effectFor and the scope, in here
 *     :593     effectFor(proposal.operation)                        <-- REFUSES, TOO LATE
 *
 * **SO AN OPERATION THIS DAEMON CANNOT RUN CONSUMED THE OWNER'S ONE-SHOT APPROVAL AND THEN REFUSED.** The person
 * answered a question, the answer was spent, and nothing happened — and `journal.advance(EFFECT_STARTED)` had
 * already made that spend DURABLE. *A proposal that cannot run must be refused before it can cost anything.*
 *
 * ── WHY A SEPARATE FUNCTION RATHER THAN REORDERING THE TWO CALLS ──────────────────────────────────────────
 *
 * `performApprovedEffect` needs `authority`, and `authority` comes back **from** `authoriseSettlement` — so the
 * body cannot simply move earlier. What CAN move is the part that needs nothing but the proposal: **whether an
 * effect exists for the operation, and whether the scope names the store the effect will write to.** Both are
 * pure. **`performApprovedEffect` still calls this first**, so the two sites cannot drift about what
 * "dispatchable" means — *a precondition checked in two places in two ways is a precondition that holds in one.*
 *
 * @param {{operation: unknown, scope?: unknown, ledgerId?: unknown}} proposal the frozen proposal.
 * @throws {Error} `aukora-owner:operation-not-dispatched` or the scope refusal, both by name.
 */
export function assertDispatchable(proposal) {
  const effect = effectFor(proposal?.operation);
  // A KIRA SETTLE WRITES, AND ONLY WHERE THE PERSON READ — the same condition `performApprovedEffect` applies,
  // asked here so a scope naming another store is refused BEFORE the approval is consumed.
  //
  // **AND A REPO ADVANCE HAS NO KIRA STORE TO BE SCOPED TO.** The condition above is `effect !== GRANT_ONLY`, so
  // the new effect would have been asked for a `kira.store:` scope it cannot have and **refused for having the
  // wrong kind of scope rather than for anything that was wrong** — *a scope check written for one effect and
  // applied to all of them is a check that refuses the second effect by construction.* The store scope is asked
  // of the effects that WRITE A STORE, and the advance's own scope is checked where the advance is performed.
  if (effect === EFFECTS.KIRA_SETTLE) {
    assertScopeInStore(proposal?.scope, SCOPE_KINDS.KIRA_STORE, proposal?.ledgerId);
  }
  return effect;
}

export function assertScopeInStore(scope, expectedKind, expectedTarget) {
  const parsed = parseScope(scope)
  // A SCOPE THAT DOES NOT PARSE IS REFUSED WITH THE SAME NAME: the person read a place, and a scope this
  // daemon cannot read is not that place. Distinguishing "malformed" here would let a caller tell the two
  // apart for no benefit, and the remedy is the same.
  if (parsed === null || parsed.kind !== expectedKind || parsed.target !== String(expectedTarget)) {
    const error = new Error(`${DISPATCH_REFUSE.SCOPE_NOT_THIS_STORE}: the owner approved scope `
      + `${JSON.stringify(String(scope))} and this daemon acts on ${expectedKind}:${String(expectedTarget)}. `
      + 'The scope is WHERE the person read the effect lands; acting on another store is a different act')
    error.code = DISPATCH_REFUSE.SCOPE_NOT_THIS_STORE
    throw error
  }
  return true
}

/**
 * The effect one frozen operation authorises, or a refusal BY NAME.
 *
 * **AN UNKNOWN OPERATION IS REFUSED, NEVER GUESSED AT.** A daemon that fell back to "probably a Kira settle"
 * would execute the most consequential effect it has for a question nobody asked, and the owner's approval
 * would be answering a different one.
 *
 * **AND A NON-STRING IS REFUSED THE SAME WAY.** `DISPATCH[undefined]` is a property lookup that finds
 * nothing, but `DISPATCH['constructor']` finds something — so the lookup goes through `Object.hasOwn` and the
 * table's own prototype is not a row in it. A table consulted by a caller-supplied key is a place a
 * prototype lookup becomes an authorisation.
 *
 * @param {unknown} operation - the operation as frozen in the proposal.
 * @returns {string} one of {@link EFFECTS}.
 * @throws {Error} `aukora-owner:operation-not-dispatched`, by name.
 */
export function effectFor(operation) {
  const key = typeof operation === 'string' ? operation : ''
  // ── **KNOWN BUT NOT ENABLED IS A DIFFERENT ANSWER FROM UNKNOWN (plan row 2)** ────────────────────────────
  //
  // MEASURED: without this branch, `repo.advance` — which `OPERATIONS` now names — would fall through to the
  // unknown-operation refusal and read as *"this daemon has never heard of it."* It HAS heard of it; it is
  // deliberately not wired. **THE TWO SENTENCES SEND A READER IN OPPOSITE DIRECTIONS:** one says the tree does
  // not have the concept and the proposal is malformed, the other says the concept is real, the record is fine,
  // and the effect is off until a verifier exists and Peter turns it on.
  //
  // **THE CHECK IS `Object.hasOwn(DISPATCH, key)` FIRST AND THIS SECOND**, so a kind that IS wired can never be
  // caught here — the day the effect is enabled, DELETING its entry from this list is the only edit needed, and
  // a stale entry cannot silently disable a working operation.
  if (!Object.hasOwn(DISPATCH, key) && NOT_ENABLED.has(key)) {
    const error = new Error(`${notEnabledRefusal(key)}: the owner approved `
      + `${JSON.stringify(key)}, which this daemon RECOGNISES and has no effect for. Nothing was written and `
      + 'nothing was spent: the record and its display are built, and the effect is not.')
    // **THE CODE IS THE PER-OPERATION STRING, NOT A FAMILY NAME**, because that is what callers and courts
    // already match on — `repo.advance: not enabled` is a refusal this tree has been printing since row 2, and
    // changing it to a generic code would break every reader that learned it.
    error.code = notEnabledRefusal(key)
    throw error
  }
  const effect = Object.hasOwn(DISPATCH, key) ? DISPATCH[key] : undefined
  if (typeof effect !== 'string') {
    const error = new Error(`${DISPATCH_REFUSE.OPERATION_NOT_DISPATCHED}: the owner approved `
      + `${JSON.stringify(String(operation))} and this daemon has no effect for it. A dispatched operation is `
      + `one of ${Object.keys(DISPATCH).join(', ')}; anything else is refused rather than executed as a guess`)
    error.code = DISPATCH_REFUSE.OPERATION_NOT_DISPATCHED
    throw error
  }
  return effect
}
