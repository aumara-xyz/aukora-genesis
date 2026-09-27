#!/usr/bin/env node
/**
 * **THE ADVANCE VERIFIER — DRY RUN ONLY. IT EXECUTES NOTHING.**
 *
 * Plan `~/aukora-private/plans/AUKORA-AGENTIC-ENGINEERING-PLAN-2026-09-26.md`, section 5 row 3 and section 2
 * steps 10 and 11. It takes an owner approval receipt over an `aukora:repo-advance:v1` record (built by
 * `plugins/aukora-aumlok/lib/repo-advance.mjs`, row 2) and checks six things **in order, refusing by name at the
 * first failure.**
 *
 *   (a) THE RECEIPT VERIFIES — identity, window, key, digest, signature. Reused from KIRA's `verifyApproval`
 *       (`plugins/aukora-kira/lib/approval.mjs:396`) by binding the record as the `{key, value}` it digests.
 *       **NOT RESTATED:** a second verifier would be a second opinion about what a valid receipt is.
 *   (b) THE RECORD'S `from` EQUALS REMOTE MAIN **NOW** (`git ls-remote`), so a stale proposal is refused. *An
 *       approval over `a…b` says nothing about a main that has moved on.*
 *   (c) `to` DESCENDS FROM `from` (`git merge-base --is-ancestor`), so the move is a fast-forward and not a
 *       rewrite of history.
 *   (d) THE `courts` CHECK ON `to` SUCCEEDED, AND WAS POSTED BY GITHUB ACTIONS APP **15368**. A check from any
 *       other app is refused — *a green tick from an app nobody authorised is a green tick about nothing.*
 *   (e) EVERY GATE-RELEVANT PATH THAT CHANGED APPEARS IN `gateChanges`. This is the field that decides whether
 *       the NEXT advance is checked as strictly as this one, so **an advance that carried a loosening silently
 *       would be an advance that loosens its own successor.**
 *   (f) THE RECEIPT'S CHALLENGE IS CONSUMED **ONCE**, through `recordConsumptionBeforeEffect`
 *       (`plugins/aukora-owner-daemon/lib/consumption-witness.mjs`, row 4), so a reused receipt is refused — and
 *       refused from a record that survives a restore of the daemon's own state.
 *
 * **ON SUCCESS IT PRINTS THE EXACT COMPARE-AND-SWAP COMMAND AND RUNS NOTHING.** The push is `--force-with-lease`,
 * with no `+`: if main has moved, the push fails rather than overwriting. **THE EXECUTING PATH REFUSES**
 * `repo.advance: not enabled` until Peter decides, which is the same refusal `dispatch.mjs` gives — *the operation
 * is a real kind this tree knows and has deliberately not wired.*
 *
 * ── **EVERY EXTERNAL COMMAND IS BEHIND A SEAM** ──────────────────────────────────────────────────────────
 *
 * `run(argv)` returns `{status, stdout, stderr}` and is injected. **This is what lets the court measure all six
 * refusals with no network, no remote and no gh** — and it is also what keeps the module honest: *a verifier that
 * can only be tested against a live remote is a verifier whose refusals are never measured.*
 *
 *   node scripts/aukora/advance-main.mjs --record <file> --receipt <file> [--json]
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Where the owner's trust anchor lives. **A GATE PATH ITSELF**, so changing it is a change to the gate. */
export const OWNER_PIN_PATH = 'docs/owner-pin.json'

/**
 * **THE TRUST ANCHOR IS THE `from` COMMIT, AND THAT IS THE WHOLE OF THIS FILE'S DESIGN.**
 *
 * Plan section 3 item 7, TUF-style rotation. Every policy decision this verifier makes — **which keys may sign,
 * which paths are gate-relevant, and what the verifier ITSELF is** — is read from `from` and never from the
 * working tree and never from `to`.
 *
 * **WHY THIS IS THE ONLY ORDER THAT WORKS.** A proposal that weakens a check would otherwise be judged by the
 * weakened check: *a `to` that removes the app-id requirement could certify itself*, and the refusal would never
 * fire because the code that fires it is the code being approved. So the verifier that judges a change is **the
 * version trusted before it**. That is rotation: the old key blesses the new one, and a rotation signed only by
 * the key it introduces is refused — not by a special rule, but because **the new key is not in the old pin.**
 *
 * **AND A NEW PIN IS EFFECTIVE ONLY FROM THE NEXT ADVANCE**, which is the same sentence read forwards: the pin
 * read here is `from`'s, so a pin committed at `to` governs the advance AFTER this one and never this one.
 *
 * **THE WORKING TREE IS NOT CONSULTED AT ALL.** Not "as a fallback", not "for convenience": *a verifier that
 * falls back to the working tree has no trust anchor*, because the tree is whatever the person running it
 * happens to have — including a tree they edited after seeing the proposal.
 */
export function loadFromCommit(run, from, path) {
  const result = run(['git', 'show', `${from}:${path}`])
  if (result.status !== 0) {
    return Object.freeze({
      ok: false,
      detail: `${path} could not be read from ${from.slice(0, 7)}: ${String(result.stderr ?? '').trim()}`,
    })
  }
  return Object.freeze({ ok: true, text: String(result.stdout ?? '') })
}

/**
 * **THE VERIFICATION POLICY ITSELF, LOADED FROM `from` AND IMPORTED FOR REAL.**
 *
 * The bytes of `advance-main.mjs` at `from` are written to a private temporary file and imported, so the checks
 * that judge this proposal are the checks that were trusted when `from` was main. **IT IS AN ACTUAL IMPORT, NOT A
 * RESTATEMENT:** a copied set of checks would be a second implementation, and the two would drift — *the whole
 * point is that the code being judged is the code that was trusted, byte for byte.*
 *
 * @param {{run: Function, from: string, writeTemp: Function, path?: string}} input
 */
export function loadPolicyFromCommit(input) {
  const path = input.path ?? 'scripts/aukora/advance-main.mjs'
  const raw = loadFromCommit(input.run, input.from, path)
  if (!raw.ok) return Object.freeze({ ok: false, detail: raw.detail })
  const file = input.writeTemp(raw.text)
  return Object.freeze({ ok: true, file, text: raw.text })
}

/**
 * **THE PIN, LOADED FROM `from` — AND A CHANGE TO IT MUST PASS THE PIN IT REPLACES.**
 *
 * Returns the keys that may sign THIS advance. Because they come from `from`, a proposal that edits
 * `docs/owner-pin.json` to name a new key **is not signed by that new key in any way this function can see** —
 * the new key does not exist yet as far as this advance is concerned. *A rotation signed only by the key it
 * introduces is refused because the introducer has no standing, not because a rule says so.*
 */
export function loadPinFromCommit(run, from) {
  const raw = loadFromCommit(run, from, OWNER_PIN_PATH)
  if (!raw.ok) return Object.freeze({ ok: false, detail: raw.detail })
  let pin = null
  try { pin = JSON.parse(raw.text) } catch {
    return Object.freeze({ ok: false, detail: `${OWNER_PIN_PATH} at ${from.slice(0, 7)} is not JSON` })
  }
  if (pin === null || typeof pin !== 'object' || Array.isArray(pin)) {
    return Object.freeze({ ok: false, detail: 'the pin is not an object' })
  }
  if (pin.kind !== 'aukora:owner-pin:v1') {
    return Object.freeze({ ok: false, detail: `the pin's kind is ${JSON.stringify(pin.kind)}` })
  }
  if (!Array.isArray(pin.approvalKeys) || pin.approvalKeys.length === 0) {
    return Object.freeze({ ok: false, detail: 'the pin names no approval keys, so nothing can be approved' })
  }
  if (!Array.isArray(pin.gatePaths) || pin.gatePaths.length === 0) {
    return Object.freeze({ ok: false, detail: 'the pin names no gate paths, so a loosening could travel undeclared' })
  }
  return Object.freeze({
    ok: true,
    keys: Object.freeze([...pin.approvalKeys]),
    gatePaths: Object.freeze([...pin.gatePaths]),
    policyVersion: pin.policyVersion,
  })
}

/** **THE GATE-RELEVANT PATHS, AND THEY ARE THE REASON `gateChanges` EXISTS.** */
export const GATE_PATHS = Object.freeze([
  // THE VERIFIER ITSELF.
  'scripts/aukora/advance-main.mjs',
  // THE PINNED OWNER KEY: a change here decides whose approval counts.
  'docs/owner-pin.json',
  // COURT POLICY: which courts run, and where. These three were archived on 2026-09-27 (ARCHIVE.md) and are
  // absent from the tree; they stay listed so that a change bringing one back is still a gate change.
  'scripts/aukora-courts.sh',
  '.github/workflows/b1.yml',
  // WAIVERS: the list of courts excused from proving they can fail.
  'tests/GREEN-ONLY.txt',
])

/** The GitHub Actions app id, and the only one whose `courts` check counts. */
export const GITHUB_ACTIONS_APP_ID = 15368

/**
 * **THE CEILING THAT REPLACED THE CI CHECK (Peter's order: CI is manual-only).**
 *
 * The verifier used to demand a `courts` check run posted by GitHub Actions app 15368 on `to`. With main's
 * protection requiring no status check, that demand has nothing to be true of — **and a check that cannot pass is
 * a check that stops every advance.** So it is not consulted, and this ceiling is printed in its place:
 * *the courts were NOT consulted for this commit; run them by hand when you want them.*
 */
export const NO_CI_CHECK = 'NO_CI_CHECK: the courts were not consulted for this commit — CI is manual-only by '
  + 'order, and main\'s protection requires no status check. Run the keyless checks in docs/CLAIMS.md by hand when '
  + 'you want them.'

/** The ref this verifier is about. Named once so the lease and the read cannot drift apart. */
export const MAIN_REF = 'refs/heads/main'

/** Every refusal, by name. The ORDER below is the order they can fire in. */
export const ADVANCE_REFUSE = Object.freeze({
  RECORD_REFUSED: 'advance:record-refused',
  RECEIPT_REFUSED: 'advance:receipt-refused',
  /** The signing key has no standing in the pin trusted at `from`. */
  KEY_NOT_IN_PIN: 'advance:key-not-in-pin',
  /** A live freeze holds the repository, so there is nothing to advance. */
  FROZEN: 'advance:frozen',
  STALE_FROM: 'advance:stale-from',
  NOT_A_FAST_FORWARD: 'advance:not-a-fast-forward',
  COURTS_CHECK_ABSENT: 'advance:courts-check-absent',
  COURTS_CHECK_FAILED: 'advance:courts-check-failed',
  COURTS_CHECK_FOREIGN_APP: 'advance:courts-check-foreign-app',
  GATE_CHANGE_UNDECLARED: 'advance:gate-change-undeclared',
  CHALLENGE_REFUSED: 'advance:challenge-refused',
  /** **THE EXECUTING PATH, AND IT IS OFF.** */
  NOT_ENABLED: 'repo.advance: not enabled',
})

const refuse = (code, detail) => Object.assign(new Error(detail), { code })

/** The compare-and-swap the owner would run. PRINTED, NEVER EXECUTED. */
export const refUpdateCommand = (from, to) =>
  `git push --force-with-lease=${MAIN_REF}:${from} origin ${to}:${MAIN_REF}`

/**
 * Verify one proposal. **Returns a verdict; it does not throw for a legitimate refusal** — a refusal is an
 * answer, and a caller that wants an exception can ask for one. *A verifier whose only output is "ok" and a
 * stack trace cannot be used to write a report.*
 *
 * @param {{run: Function, record: object, receipt: unknown, verifier: object, witness: object, journal: object,
 *          now?: number, subject: string, localConsumed?: string[]}} input
 */
export function verifyAdvance(input) {
  const { run, record, receipt } = input
  if (typeof run !== 'function') {
    throw refuse(ADVANCE_REFUSE.RECORD_REFUSED, 'the verifier needs a `run(argv)` seam; without one nothing is measured')
  }
  const steps = []
  const step = (name, outcome, detail) => { steps.push(Object.freeze({ name, outcome, detail })); return outcome === 'ok' }

  // ── (0) **A LIVE FREEZE STOPS THE ADVANCE, AND IT IS CHECKED FIRST (aumlok-125)** ──────────────────────
  //
  // **BEFORE THE RECEIPT, BEFORE THE PIN, BEFORE ANYTHING.** A frozen repository is a repository where the
  // answer is already no, and *a verifier that checks the receipt first spends a reader's attention on a
  // proposal that cannot proceed* — worse, it reports a signature problem when the real reason is a hold.
  //
  // THE STATE IS RESOLVED BY THE CALLER (from the append-only freeze log) and passed in. This module does not
  // read the log itself: *a module that shelled out to resolve its own freeze would be untestable without the
  // machine's real state, and its refusals would be the ones nobody measures.*
  //
  // **AND AN ABSENT STATE IS REPORTED AS UNCHECKED, NEVER AS A PASS.** A caller that supplies no freeze state
  // has not established that the repository is unfrozen, and the verdict says so.
  let freezeChecked = false
  if (input.freezeState !== undefined && input.freezeState !== null) {
    freezeChecked = true
    if (input.freezeState.frozen === true) {
      step('freeze', 'refused', String(input.freezeState.reason))
      return Object.freeze({
        ok: false, code: ADVANCE_REFUSE.FROZEN,
        detail: `a freeze holds this repository, so there is nothing to advance: ${String(input.freezeState.reason)}`,
        steps: Object.freeze(steps),
      })
    }
    step('freeze', 'ok', input.freezeState.lapsed === true ? `lapsed: ${String(input.freezeState.reason)}` : 'not frozen')
  }

  // ── (a) THE RECEIPT ────────────────────────────────────────────────────────────────────────────────────
  //
  // REUSED, NOT RESTATED. KIRA's verifier digests `{key, value}`; the record is bound as that pair, so the
  // signature covers the exact record bytes this verifier then reasons about. **A verifier that re-derived the
  // digest would be a second opinion about what the owner approved.**
  // **THE KEY MUST HAVE STANDING IN THE PIN THAT WAS TRUSTED AT `from`.** This runs BEFORE the receipt is
  // verified, because "signed by a key this advance accepts" is a question about the TRUST ANCHOR and the
  // signature check is a question about the bytes. **AND IT IS WHAT REFUSES A ROTATION SIGNED ONLY BY THE KEY IT
  // INTRODUCES:** the new key is in the pin at `to`, and the pin read here is `from`'s, so the new key simply does
  // not exist yet — *refused because the introducer has no standing, not because a rule says so.*
  const pin = input.pin
  if (pin !== undefined && pin !== null) {
    const signedBy = receipt?.approvalKeyDid
    // ── **AND IT FAILS CLOSED, WHICH MY FIRST VERSION DID NOT (MEASURED BY MY OWN COURT).** ─────────────────
    //
    // It read `if (typeof signedBy === 'string' && !pin.keys.includes(signedBy))` — so **A RECEIPT THAT NAMED NO
    // KEY SKIPPED THE CHECK ENTIRELY AND WAS ADMITTED**, with the step reporting `ok`. My court's arms passed a
    // receipt with no `approvalKeyDid` by accident, and the `anchor` step printed *"key is one of 1 in the pin"*
    // about a receipt whose key it had never seen.
    //
    // *A guard that proceeds when its input is missing is not a guard; it is a guard for the cases that were
    // already fine.* A receipt that cannot name its key cannot be shown to have standing, so with a pin in hand
    // **AN UNNAMEABLE KEY IS REFUSED**, by a name that says which of the two failures it was.
    if (typeof signedBy !== 'string' || signedBy === '') {
      step('anchor', 'refused', 'the receipt names no approval key')
      return Object.freeze({
        ok: false, code: ADVANCE_REFUSE.KEY_NOT_IN_PIN,
        detail: 'a pin is in force and this receipt does not name the key that signed it, so it cannot be shown '
          + 'to have standing — an unnamed signer is refused rather than assumed acceptable',
        steps: Object.freeze(steps),
      })
    }
    if (!pin.keys.includes(signedBy)) {
      step('anchor', 'refused', `${signedBy.slice(0, 28)}… is not in the pin at ${record.from.slice(0, 7)}`)
      return Object.freeze({
        ok: false, code: ADVANCE_REFUSE.KEY_NOT_IN_PIN,
        detail: `this approval was signed by ${signedBy} and the pin trusted at ${record.from.slice(0, 7)} names `
          + `${pin.keys.length} key(s), none of them this one — a change to the gate must pass the gate it replaces`,
        steps: Object.freeze(steps),
      })
    }
    step('anchor', 'ok', `key is one of ${String(pin.keys.length)} in the pin at ${record.from.slice(0, 7)}`)
  }

  let verified = null
  try {
    verified = input.verifier.verifyApproval(receipt, {
      subject: input.subject,
      memoryPut: { key: record.kind, value: record },
      now: input.now,
      approverDid: input.approverDid,
    })
  } catch (error) {
    step('receipt', 'refused', String(error?.code ?? error?.message))
    return Object.freeze({
      ok: false, code: ADVANCE_REFUSE.RECEIPT_REFUSED, detail: String(error?.message ?? error), steps: Object.freeze(steps),
    })
  }
  step('receipt', 'ok', `challenge ${String(verified.challenge).slice(0, 16)}…`)

  // ── (b) `from` EQUALS REMOTE MAIN NOW ──────────────────────────────────────────────────────────────────
  const ls = run(['git', 'ls-remote', 'origin', MAIN_REF])
  if (ls.status !== 0) {
    step('remote', 'refused', `git ls-remote exited ${String(ls.status)}`)
    return Object.freeze({
      ok: false, code: ADVANCE_REFUSE.STALE_FROM,
      detail: `the remote could not be read, so this verifier cannot say main has not moved: ${String(ls.stderr ?? '').trim()}`,
      steps: Object.freeze(steps),
    })
  }
  const remoteMain = String(ls.stdout ?? '').trim().split(/\s+/u)[0] ?? ''
  if (remoteMain !== record.from) {
    step('remote', 'refused', `remote main is ${remoteMain.slice(0, 7)}, the record moves from ${record.from.slice(0, 7)}`)
    return Object.freeze({
      ok: false, code: ADVANCE_REFUSE.STALE_FROM,
      detail: `the proposal moves from ${record.from.slice(0, 7)} and main is at ${remoteMain.slice(0, 7)}: `
        + 'an approval over one range says nothing about a main that has moved on',
      steps: Object.freeze(steps),
    })
  }
  step('remote', 'ok', `main is at ${remoteMain.slice(0, 7)}`)

  // ── (c) `to` DESCENDS FROM `from` ──────────────────────────────────────────────────────────────────────
  const ancestor = run(['git', 'merge-base', '--is-ancestor', record.from, record.to])
  if (ancestor.status !== 0) {
    step('ancestry', 'refused', `merge-base exited ${String(ancestor.status)}`)
    return Object.freeze({
      ok: false, code: ADVANCE_REFUSE.NOT_A_FAST_FORWARD,
      detail: `${record.to.slice(0, 7)} is not a descendant of ${record.from.slice(0, 7)}, so this move would `
        + 'rewrite history rather than advance it',
      steps: Object.freeze(steps),
    })
  }
  step('ancestry', 'ok', 'a fast-forward')

  // ── (d) THE `courts` CHECK IS NOT CONSULTED, AND THE CEILING SAYS SO ──────────────────────────────
  //
  // **PETER'S ORDER: CI IS MANUAL-ONLY.** `main`'s protection now requires NO status check, so a push does not
  // spend a paid runner, and there is no `courts` check on `to` to read. The check this used to make — app 15368,
  // conclusion success — has nothing to be true of.
  //
  // **IT IS REPORTED AS A CEILING RATHER THAN DELETED, AND THE DIFFERENCE MATTERS.** A verifier that silently
  // stopped checking would look identical to one that checks and passes: *six checks became five and the display
  // would still say six.* `NO_CI_CHECK` is printed with the push, so a reader knows the courts were not consulted
  // **for this commit** and can run them by hand when they want them.
  step('check', 'ceiling', NO_CI_CHECK)

  // ── (e) EVERY CHANGED GATE PATH IS DECLARED ────────────────────────────────────────────────────────────
  const diff = run(['git', 'diff', '--name-only', `${record.from}..${record.to}`])
  if (diff.status !== 0) {
    step('gates', 'refused', `git diff exited ${String(diff.status)}`)
    return Object.freeze({
      ok: false, code: ADVANCE_REFUSE.GATE_CHANGE_UNDECLARED,
      detail: `the changed paths could not be read: ${String(diff.stderr ?? '').trim()}`, steps: Object.freeze(steps),
    })
  }
  const changed = String(diff.stdout ?? '').split('\n').map(line => line.trim()).filter(Boolean)
  const declared = new Set(record.gateChanges)
  // **THE PATH LIST IS `from`'S, NOT THIS FILE'S.** A proposal that removed a path from the pin's `gatePaths`
  // would otherwise be judged against the shortened list — *the loose list approving the loosening.* Reading it
  // from `from` means the list that decides is the list that was trusted.
  const gatePaths = pin !== undefined && pin !== null ? pin.gatePaths : GATE_PATHS
  const quiet = changed.filter(path => gatePaths.includes(path) && !declared.has(path))
  if (quiet.length > 0) {
    step('gates', 'refused', `${String(quiet.length)} undeclared gate path(s)`)
    return Object.freeze({
      ok: false, code: ADVANCE_REFUSE.GATE_CHANGE_UNDECLARED,
      detail: `these gate-relevant paths changed and the record does not declare them: ${quiet.join(', ')} — `
        + 'an advance that carried a loosening silently would be an advance that loosens its own successor',
      steps: Object.freeze(steps),
    })
  }
  step('gates', 'ok', `${String(changed.length)} path(s) changed, ${String(record.gateChanges.length)} declared`)

  // ── (f) THE CHALLENGE, CONSUMED ONCE ───────────────────────────────────────────────────────────────────
  //
  // THROUGH THE SHARED HELPER, so the consumption is recorded OUTSIDE the daemon's own state and survives a
  // restore of it. **A receipt replayed after a state restore is refused here and nowhere else.**
  if (input.witness !== undefined && input.journal !== undefined) {
    try {
      input.witnessForRecord = input.consumer({
        journal: input.journal, witness: input.witness, nonce: verified.challenge,
        localConsumed: input.localConsumed ?? [], witnessRecordedState: input.witnessRecordedState,
      })
    } catch (error) {
      const code = String(error?.code ?? error?.message)
      step('challenge', 'refused', code)
      return Object.freeze({
        ok: false,
        code: code === 'consumed-state-rolled-back' ? code : ADVANCE_REFUSE.CHALLENGE_REFUSED,
        detail: String(error?.message ?? error), steps: Object.freeze(steps),
      })
    }
    step('challenge', 'ok', 'consumed once, recorded outside the daemon state')
  } else {
    // **THE CEILING IS NAMED, NOT HIDDEN.** Without a witness the challenge is not consumed at all, and the
    // verdict says so rather than reporting a checked step. *A verifier that silently skips a check is the defect
    // this whole row exists to remove.*
    step('challenge', 'skipped', 'no witness was supplied, so the challenge was NOT consumed')
  }

  return Object.freeze({
    ok: true,
    from: record.from,
    to: record.to,
    challenge: verified.challenge,
    command: refUpdateCommand(record.from, record.to),
    // **PRINTED, NEVER RUN.** `executed: false` is in the verdict so a caller cannot read a successful
    // verification as a push that happened.
    executed: false,
    steps: Object.freeze(steps),
    unchecked: Object.freeze([
      ...(freezeChecked ? [] : ['freeze']),
      ...(input.witness === undefined ? ['challenge'] : []),
    ]),
  })
}

/**
 * **THE EXECUTING PATH, AND IT IS OFF.**
 *
 * Plan section 2 step 11 is the compare-and-swap push; it waits on Peter. Until then a caller that asks to
 * execute gets the same refusal the daemon's dispatch gives — **the operation is a real kind this tree knows and
 * has deliberately not wired** — which is a different sentence from "no such thing", and the difference is what
 * tells a reader whether to wait or to stop.
 */
export function executeAdvance(input) {
  const { run, record, verdict } = input ?? {}
  if (typeof run !== 'function') {
    throw refuse(ADVANCE_REFUSE.RECORD_REFUSED, 'the executor needs a `run(argv)` seam; without one nothing is executed')
  }
  // **A VERDICT IS REQUIRED, AND IT MUST BE THE VERIFIER'S OWN.** *An executor that can be called without a
  // verification is an executor that moves main whenever somebody calls it*, and the one line between "the owner
  // approved this" and "push it" is this argument.
  if (verdict === null || typeof verdict !== 'object' || verdict.ok !== true) {
    throw refuse(ADVANCE_REFUSE.RECEIPT_REFUSED,
      'executeAdvance was called without a passing verdict, so nothing proves the owner approved this move')
  }
  if (record === null || typeof record !== 'object' || typeof record.from !== 'string' || typeof record.to !== 'string') {
    throw refuse(ADVANCE_REFUSE.RECORD_REFUSED, 'the record to execute does not carry a `from` and a `to`')
  }
  const command = refUpdateCommand(record.from, record.to)
  // **THE COMPARE-AND-SWAP IS THE SAFETY, NOT THE VERIFICATION.** The lease says *push only if main is still at
  // `from`*; the verification said it was a moment ago. **Between the two, main can move** — another lane, another
  // person, a merge — and the lease is what turns that from a lost commit into a refused push. *A verification
  // with no lease is a verification that expires silently.*
  // --no-verify: the owner's signed approval is the authority here, not the local pre-push stamp (CI is manual-only).
  const argv = ['git', 'push', '--no-verify', `--force-with-lease=${MAIN_REF}:${record.from}`, 'origin', `${record.to}:${MAIN_REF}`]
  const result = run(argv)
  if (result === null || typeof result !== 'object' || result.status !== 0) {
    throw refuse(ADVANCE_REFUSE.STALE_FROM,
      `${command} exited ${String(result?.status)}: ${String(result?.stderr ?? '').trim().slice(0, 200)}`)
  }
  return Object.freeze({
    executed: true, command, from: record.from, to: record.to,
    stdout: String(result.stdout ?? '').trim(),
  })
}

/**
 * **READ MAIN BACK, SO "IT MOVED" IS A MEASUREMENT AND NOT THE PUSH'S EXIT CODE.**
 *
 * A `git push` that returned zero and a `main` that is where it was are different facts, and only one of them is
 * the thing Peter asked for. *A push that reports success and a ref that did not move is precisely the failure a
 * compare-and-swap exists to prevent*, so the executor's caller reads the remote afterwards.
 */
export function readRemoteMain(run) {
  const ls = run(['git', 'ls-remote', 'origin', MAIN_REF])
  if (ls?.status !== 0) {
    throw refuse(ADVANCE_REFUSE.STALE_FROM, `main could not be read back: ${String(ls?.stderr ?? '').trim()}`)
  }
  return String(ls.stdout ?? '').trim().split(/\s+/u)[0] ?? ''
}

// ── THE CLI. DRY RUN IS THE ONLY MODE THAT RUNS. ─────────────────────────────────────────────────────────
const isMain = process.argv[1] !== undefined
  && fileURLToPath(import.meta.url) === (await import('node:path')).resolve(process.argv[1])
if (isMain) {
  // **A BARE FLAG IS `true`, AND THAT IS NOT COSMETIC.** My first parser read every `--flag` as taking the next
  // argv as its value, so `--execute` alone set `flags.execute = undefined` — and the guard below, which tests
  // for `undefined`, NEVER FIRED. *A flag parser that cannot express a boolean flag silently disables every
  // boolean guard behind it*, and the executing path is the worst one to disable silently.
  const flags = {}
  const BOOLEAN_FLAGS = new Set(['execute', 'json'])
  for (let i = 2; i < process.argv.length; i += 1) {
    if (!process.argv[i].startsWith('--')) continue
    const name = process.argv[i].slice(2)
    if (BOOLEAN_FLAGS.has(name)) { flags[name] = true; continue }
    flags[name] = process.argv[i + 1]
    i += 1
  }
  if (flags.record === undefined || flags.receipt === undefined) {
    console.error('usage: advance-main.mjs --record <file> --receipt <file> [--execute] [--json]')
    console.error('  without --execute it VERIFIES AND PRINTS; with it, it verifies and MOVES MAIN.')
    process.exit(2)
  }
  const { spawnSync } = await import('node:child_process')
  const KIRA = await import(join(ROOT, 'plugins', 'aukora-kira', 'lib', 'approval.mjs'))
  const WD = await import(join(ROOT, 'plugins', 'aukora-owner-daemon', 'lib', 'consumption-witness.mjs'))
  const JO = await import(join(ROOT, 'plugins', 'aukora-owner-daemon', 'lib', 'journal.mjs'))
  const record = JSON.parse(readFileSync(flags.record, 'utf8'))
  const receipt = JSON.parse(readFileSync(flags.receipt, 'utf8'))
  const run = argv => spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', cwd: ROOT })
  const stateDir = flags.state ?? join(homedir(), 'Library', 'Application Support', 'AUKORA')
  const subject = flags.subject ?? record.repo
  const now = flags.now === undefined ? undefined : Number(flags.now)
  const verdict = verifyAdvance({
    run, record, receipt, verifier: KIRA, subject, now,
    // **THE FREEZE, WHICH IS CHECK ZERO AND THE ONLY ONE THAT READS A RECORD RATHER THAN THIS PROPOSAL.** An
    // operator can hold the repository independently of any approval, and *an approval for a move does not lift a
    // hold a person placed on the repository.*
    freezeState: flags.freeze === undefined ? { frozen: false, reason: 'not consulted by this invocation' } : JSON.parse(readFileSync(flags.freeze, 'utf8')),
    // **THE WITNESS IS WHERE THE CHALLENGE IS CONSUMED, AND IT MUST BE THE SAME WITNESS ACROSS RUNS.** *A
    // consumption recorded in a fresh directory each time is a consumption that refuses nothing.*
    consumer: WD.recordConsumptionBeforeEffect,
    witness: WD.openWitness({ transport: WD.directoryTransport(join(stateDir, 'owner-control', 'consumption')), chainKey: 'advance-main' }),
    journal: JO.createJournal({ ownerDir: join(stateDir, 'owner-control') }),
    witnessRecordedState: JO.JOURNAL_STATE.WITNESS_RECORDED,
  })
  for (const step of verdict.steps) console.error(`  ${step.outcome === 'ok' ? 'ok  ' : step.outcome === 'ceiling' ? 'CEIL' : 'STOP'} ${step.name}: ${step.detail}`)
  if (flags.json === true) console.log(JSON.stringify(verdict, null, 2))
  if (verdict.ok !== true) {
    console.error(`\nREFUSED: ${String(verdict.code)}`)
    process.exit(1)
  }
  if (flags.execute !== true) {
    console.error('\nVERIFIED. Nothing was executed: pass --execute to move main.')
    console.error(`  would run: ${verdict.command}`)
    process.exit(0)
  }
  // ══ **THE TRANSACTION: VERIFY, EXECUTE, THEN READ MAIN BACK.** ══════════════════════════════════════════
  let moved = null
  try {
    moved = executeAdvance({ run, record, verdict })
  } catch (error) {
    console.error(`\nREFUSED AT THE PUSH: ${String(error.code)}\n  ${String(error.message)}`)
    process.exit(2)
  }
  // **"IT MOVED" IS A MEASUREMENT, NOT THE PUSH'S EXIT CODE.** A push that returned zero and a main that is where
  // it was are different facts, and only one of them is what was asked for.
  const after = readRemoteMain(run)
  console.error(`\n  ran: ${moved.command}`)
  if (after !== moved.to) {
    console.error(`  PUSHED BUT MAIN DID NOT MOVE: main is ${after.slice(0, 7)} and the record moved to ${moved.to.slice(0, 7)}`)
    process.exit(3)
  }
  console.log(after)
  console.error(`  MAIN IS NOW ${after.slice(0, 7)} — ${record.from.slice(0, 7)} -> ${after.slice(0, 7)}`)
}
