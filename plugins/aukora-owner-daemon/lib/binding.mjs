/**
 * THE FROZEN PROPOSAL AND THE ONE-USE APPROVAL — the settlement core of the two-principal cut.
 *
 * WHAT THIS FILE IS, IN THE DESIGN'S OWN TERMS (codex-uid-design.md:5,19): "the daemon freezes exact
 * proposal bytes and binds approval to their digest, operation/scope, ledger identity, random nonce and
 * expiry; consume approval atomically once." And the single most important change: "make settlement require
 * a one-use approval bound to the exact proposed action, authenticated by an authority the agent cannot
 * impersonate; remove the shell-Boolean fallback."
 *
 * WHY THE BINDING IS FIVE FIELDS AND NOT ONE. A digest alone binds the BYTES. It does not bind the ACTION
 * those bytes are for: the same bytes settled as a Kira record and as an Aumlok rotation are different acts,
 * and an approval for one must not settle the other. Nor does a digest say WHICH LEDGER ENTRY the approval
 * authorises, WHEN it stops being valid, or that THIS approval has not already been spent. So approval is
 * bound to all five — `digest`, `operation`, `scope`, `ledgerId`, `nonce`, `expiresAt` — and consumption is
 * atomic, because an approval that can be spent twice is not an approval.
 *
 * NOTHING HERE SIGNS ANYTHING. Key custody lives beside this file and the daemon holds the key; this module
 * is the bookkeeping that decides whether a settlement is ALLOWED. It deliberately contains no crypto
 * primitive of its own: digests are `node:crypto`, and no curve is implemented (AGENTS.md).
 *
 * THE REFUSALS ARE NAMED, AND EVERY WRONG PEER OR WRONG APPROVAL HAS ONE. A caller that cannot tell "your
 * approval expired" from "your approval was already spent" cannot tell a person what to do next.
 */
import { createHash, randomBytes } from 'node:crypto'
// **THE SCOPE BUILDER, IMPORTED RATHER THAN RE-SPELLED.** The check below compares the submitter's scope to
// `gateReleaseScope(release)`, and re-spelling the format here would be a SECOND definition of it — **the two
// would drift and the check would start refusing the callers who are right.** A module import that is only
// read at call time does NOT fail at import: my first version of this threw `ReferenceError` from inside the
// refusal path, so every case "refused" with `code: undefined` and the check looked like it was working.
import { OPERATIONS, gateReleaseScope } from './operations.mjs'
import { gatherSeparationFacts, separationVerdict, SEPARATION_UNMET } from './owner-separation.mjs'

/** The names this daemon refuses with. Every one of them is a different fact. */
export const OWNER_REFUSE = Object.freeze({
  // **IT LIVES HERE, NOT IN `STORE_REFUSE` (CODEX R6 ITEM 2).** MEASURED: this constant was added to the STORE
  // refusals while the daemon read `OWNER_REFUSE.RESULT_NOT_SETTLED` — **so a recorded-but-unfinished nonce was
  // refused with `reason: undefined`**, which is the signature of somebody else's failure: a caller sees a
  // refusal with no name and cannot tell it from a bug in the thing refusing. **The owner asked for a result;
  // the answer is about their request, not about a bound on the store.**
  RESULT_NOT_SETTLED: 'aukora-owner:result-not-settled',
  /** The peer's kernel credential is not the owner uid. */
  PEER_NOT_OWNER: 'aukora-owner:peer-not-owner',
  /** The peer's kernel credential is neither the agent uid nor the owner uid. */
  PEER_UNKNOWN: 'aukora-owner:peer-unknown',
  /** **A HELLO WITH NO CHALLENGE IS REFUSED, NOT ANSWERED (Codex r11, finding 3).** Answering one would
   * sign the v1 preimage, **which is replayable** — so an old client would keep the hole open while a new
   * client believed it was closed. The way to retire a replayable hello is to stop producing it. */
  HELLO_CHALLENGE_REQUIRED: 'aukora-owner:hello-challenge-required',
  /** The kernel did not tell us who the peer is. FAIL CLOSED — an unknown peer is not a permitted one. */
  PEER_UNVERIFIABLE: 'aukora-owner:peer-unverifiable',
  /** No such frozen proposal. */
  PROPOSAL_ABSENT: 'aukora-owner:proposal-absent',
  /** The proposal was already settled. A frozen proposal is settled at most once. */
  PROPOSAL_SETTLED: 'aukora-owner:proposal-settled',
  /** The approval names a digest that is not the frozen bytes. */
  DIGEST_MISMATCH: 'aukora-owner:digest-mismatch',
  /** The approval names another operation or another scope than the proposal. */
  SCOPE_MISMATCH: 'aukora-owner:scope-mismatch',
  /** The approval names another ledger entry than the proposal. */
  LEDGER_MISMATCH: 'aukora-owner:ledger-mismatch',
  /** The nonce is not the one this proposal was frozen with. */
  NONCE_MISMATCH: 'aukora-owner:nonce-mismatch',
  /** The approval's window has closed. */
  KIRA_LEDGER_NOT_CONFIGURED: 'aukora-owner:kira-ledger-not-configured',
  KIRA_STORE_NOT_CONFIGURED: 'aukora-owner:kira-store-not-configured',
  APPROVAL_EXPIRY_NOT_FROZEN: 'aukora-owner:approval-expiry-not-frozen',
  PROPOSAL_EXPIRED: 'aukora-owner:proposal-expired',
  APPROVAL_EXPIRED: 'aukora-owner:approval-expired',
  /** This approval was already consumed. ONE USE, AND THIS IS THE NAME FOR THE SECOND. */
  APPROVAL_SPENT: 'aukora-owner:approval-spent',
  /** A shell-supplied boolean is not an approval. THERE IS NO FALLBACK. */
  SHELL_BOOLEAN_REFUSED: 'aukora-owner:shell-boolean-refused',
  /** The proposal is not the shape this daemon freezes. */
  PROPOSAL_MALFORMED: 'aukora-owner:proposal-malformed',
  EXPIRY_OUT_OF_RANGE: 'aukora-owner:expiry-out-of-range',
  OPERATION_DISAGREES_WITH_ENVELOPE: 'aukora-owner:operation-disagrees-with-envelope',
  SCOPE_DISAGREES_WITH_ENVELOPE: 'aukora-owner:scope-disagrees-with-envelope',
  /**
   * **THE OWNER SAID NO.** A person was asked and answered.
   *
   * MEASURED (Fable, 2026-09-26): this code used to cover *"the owner console was not reachable, OR the owner did
   * not answer"* — **one name for two facts, and the wrong one for the common case.** A CI run whose console was
   * simply absent reported *"1 SETTLED, 9 DECLINED"*: **it accused the owner of nine refusals nobody made.** A
   * caller cannot fix a missing console by reading a decline, so the two are now separate codes.
   */
  OWNER_DECLINED: 'aukora-owner:owner-declined',
  /**
   * **NOBODY ASKED THE OWNER, BECAUSE THE CONSOLE WAS NOT THERE.** The refusal is the same — nothing settles —
   * **and the NAME is different, because "the owner declined" is an accusation and this is a diagnosis.**
   *
   * `NOT_READY` is the reading: the run cannot be judged until a console exists, and a court that reports a
   * decline here is reporting an owner's decision that never happened.
   */
  CONSOLE_UNREACHABLE: 'aukora-owner:console-unreachable',
  /** A phone key was offered for enrolment on the wrong socket. */
  ENROL_ON_SUBMIT: 'aukora-owner:enrolment-on-submit-socket',
  /** No phone is enrolled, so a relayed approval cannot be checked against anything. */
  PHONE_NOT_ENROLLED: 'aukora-owner:phone-not-enrolled',
  /** A directory the daemon needs does not exist. */
  OWNER_DIR_ABSENT: 'aukora-owner:owner-dir-absent',
  /** A directory or key file is the wrong mode, the wrong owner, or under a writable ancestor. */
  OWNER_DIR_INSECURE: 'aukora-owner:owner-dir-insecure',
})

/**
 * WHAT EACH AUTHORITY EARNS, PRINTED VERBATIM WITH THE SETTLEMENT.
 *
 * THE TWO ARE NOT THE SAME CLAIM AND MUST NOT SHARE A LINE. A console answer is an owner uid on a terminal
 * and retires the shell-Boolean fallback; it says nothing about who read the bytes or who was present. A
 * phone approval pins a signer and asks the phone to display the operation, which moves the review surface
 * OFF the shell — but the phone's display is the phone\u2019s claim, and an independent display has not been
 * measured here.
 */
export const AUTHORITY_CEILING = Object.freeze({
  console: Object.freeze([
    'AUTHORITY: owner-uid console answer.',
    // **THE SEPARATION SENTENCE IS NOT HERE, BECAUSE IT WAS NEVER TRUE (KIMI AUKORA-37 v1).** MEASURED:
    // this line read *"The agent cannot reach this socket or read the keys"* -- on EVERY console settlement,
    // unconditionally. The daemon never checked which account it ran as, its only uid check was that its own
    // directory is owned by `process.geteuid()`, and **the `aukora-owner` account does not exist yet, so
    // every run today is same_uid and still printed the separation claim.** A false ceiling is worse than no
    // ceiling: it is the difference between a limit and a lie about one.
    //
    // The sentence is BUILT PER PRINT by `consoleCeiling()` below, which re-checks every predicate in
    // `owner-separation.mjs` AT THE MOMENT IT IS ASKED -- not at startup, because a key can be copied or a
    // directory re-owned while the daemon runs. `AUTHORITY_CEILING.console[0]` is unchanged: callers index it.
  ]),
  phone: Object.freeze([
    'AUTHORITY: a pinned-signer phone approval, relayed by whoever carried it.',
    'The signature proves the ENROLLED PHONE KEY signed these exact tags, and the phone was asked to display '
    + 'the operation — so the review surface is no longer the shell\u2019s. It does NOT prove a person read what '
    + 'the phone showed: the display is the phone\u2019s claim, this daemon cannot see it, and no independent '
    + 'display has been measured.',
  ]),
})

/**
 * The ceiling for one authority, with the separation verdict applied where it belongs.
 *
 * **AN UNKNOWN AUTHORITY REFUSES BY NAME.** MEASURED: this used to be
 * `AUTHORITY_CEILING[authority] ?? AUTHORITY_CEILING.console`, **so an authority nobody had classified
 * inherited the console claim** -- the strongest sentence available went to the least understood case.
 *
 * @param {string} authority - the authority that answered.
 * @param {object} verdict - the separation verdict, gathered now.
 * @returns {readonly string[]} the ceiling lines.
 */
export function ceilingFor(authority, verdict) {
  if (authority === 'console') return consoleCeiling(verdict)
  const known = Object.hasOwn(AUTHORITY_CEILING, authority) ? AUTHORITY_CEILING[authority] : undefined
  if (known === undefined) {
    throw ownerRefusal(AUTHORITY_CEILING_REFUSE.UNKNOWN_AUTHORITY,
      `the authority ${JSON.stringify(String(authority))} has no ceiling, and an authority nobody has `
      + 'classified must not inherit the console claim')
  }
  return known
}

/** Why a ceiling could not be produced. */
export const AUTHORITY_CEILING_REFUSE = Object.freeze({
  UNKNOWN_AUTHORITY: 'aukora-owner:unknown-authority',
})

/**
 * The console ceiling, with its separation line EARNED AT PRINT TIME.
 *
 * @param {object} verdict - the result of `separationVerdict`.
 * @returns {readonly string[]} the ceiling lines.
 */
/**
 * **THE REASONS THAT MEAN "NOBODY LOOKED" RATHER THAN "THEY ARE EQUAL"** (Codex r11, finding 5).
 *
 * Every one of these describes a predicate the daemon could NOT evaluate. **They are fail-closed — they still
 * yield `SAME_UID` — but they do NOT establish that the owner and the daemon share a uid**, so the ceiling must
 * not say they do. The distinction is measured-versus-unmeasured, not safe-versus-unsafe.
 */
const UNESTABLISHED_REASONS = Object.freeze([
  SEPARATION_UNMET.PIN_NOT_ESTABLISHED,
  SEPARATION_UNMET.CALLER_EUID_UNKNOWN,
  SEPARATION_UNMET.KEY_READ_STATE_UNKNOWN,
])

/**
 * **THE REASONS THAT MEASURE AN ACTUAL SHARED UID.** One of these present means the equality WAS observed, and
 * the sentence must say so even when other predicates went unevaluated.
 *
 * **MEASURED, FIRST ATTEMPT AT THIS FIX: I keyed the branch on the unknown reasons alone, and a MEASURED
 * same_uid (`OWNER_IS_CALLER`) also printed "NOT ESTABLISHED"** — because unrelated predicates were still
 * missing. **That would have weakened the one case that must not be weakened.** A measured equality dominates;
 * the unknowns only decide the sentence when nothing established either way.
 */
const ESTABLISHED_SAME_UID_REASONS = Object.freeze([
  // **ONLY THIS ONE OBSERVES THE EQUALITY.** `OWNER_IS_CALLER` means the owner's uid IS this daemon's effective
  // uid — the comparison the sentence is about.
  //
  // **MEASURED, SECOND ATTEMPT: I also listed `OWNER_IS_ROOT` and `NO_OWNER_UID`, AND THAT REINTRODUCED THE
  // ORIGINAL DEFECT** — with no facts at all the line went back to asserting *"are the same uid"*, because
  // `NO_OWNER_UID` was in the list. **"No owner uid was established" is the ABSENCE of a measurement**, and
  // `OWNER_IS_ROOT` says the owner is uid 0, which is a different question from whether the DAEMON shares it.
  SEPARATION_UNMET.OWNER_IS_CALLER,
])

export function consoleCeiling(verdict) {
  // ── WHICH PRINCIPAL WAS MEASURED (CODEX R10, FINDING 3) ──────────────────────────────────────────
  //
  // **MEASURED: THE LINE SAID "the agent shares this uid" — AND THE MEASUREMENT WAS OF THE DAEMON'S OWN.**
  // `gatherSeparationFacts` calls `process.geteuid()`, and **inside the daemon that is the OWNER's uid**, so
  // the comparison proves a fact about THIS PROCESS. The line then asserted a fact about the AGENT.
  //
  // **THE AGENT'S UID IS A DIFFERENT QUESTION AND THIS DAEMON CANNOT ANSWER IT FROM HERE.** It has no view
  // of the process that invoked it — the socket is a socket. So both branches now name what was measured and
  // say plainly that the agent's own access is unmeasured, **which is the same defect item 1 exists to remove,
  // in a second place: a ceiling may not be stronger than its evidence.**
  const separation = verdict.separated
    ? `${verdict.verdict}: the owner account is a different, non-root uid, it owns the key and the `
      + 'directory, the pin matches the anchor, no operator-readable copy remains, and THIS DAEMON cannot '
      + 'read the key. It does NOT establish that the agent cannot: the agent is a separate process this '
      + 'daemon cannot see.'
    // **THE UNMET LIST TRAVELS WITH THE LINE**, so a reader sees which door is still open rather than only
    // that the claim was not made.
    // **CODEX R12, FINDING 2: THE CONDITION WAS INVERTED, AND IT MADE THE FALSE CLAIM ANYWAY.**
    //
    // MEASURED, AND THE FAILING CASE IS EXACT: `ownerUid` is a non-zero number, `callerEuid` is a number, and
    // THEY DIFFER — so `separationVerdict` pushes NEITHER `CALLER_EUID_UNKNOWN` NOR `OWNER_IS_CALLER`. Add any
    // other open door (`COPY_MAY_REMAIN`, `owner-separation.mjs:145`) and `unmet` holds only that. **The old
    // test was `!ESTABLISHED_SAME_UID_REASONS.some(…)` — "OWNER_IS_CALLER is NOT unmet" — WHICH IS TRUE BOTH
    // WHEN THE UIDS ARE EQUAL AND WHEN THEY WERE MEASURED TO DIFFER.** So a daemon that had MEASURED a
    // different uid printed *"the owner account and THIS DAEMON are the same uid"*.
    //
    // **ABSENCE FROM `unmet` IS NOT EVIDENCE OF EQUALITY.** For most predicates a failed one pushes a code, so
    // absence means satisfaction — but equality is the one fact whose code is pushed on SUCCESS, so its absence
    // means the opposite. **A NEGATIVE TEST ON A POSITIVELY-SPELLED FACT READS AS PRESENT AND IS NOT**, which is
    // the same shape as the optional-pin guard this repository keeps re-finding.
    //
    // **THE FIX IS A POSITIVE REQUIREMENT: ONLY `OWNER_IS_CALLER` PRESENT IN `unmet` ESTABLISHES EQUALITY.**
    // Everything else — different uids, an unknown fact, or another door open — is refused in words that do not
    // claim an identity nobody measured.
    // **THE SECOND HALF IS KEPT, AND MY OWN COURT IS WHY.** I first dropped it, and
    // `aukora-owner-separation-ceiling` went RED on two arms: *"a MEASURED same-uid still says the owner and
    // this daemon are the same uid"* and *"it does NOT hedge into 'not established' — that would be a ceiling
    // weaker than its evidence."* **A MEASURED equality outranks a neighbouring unknown fact**: if
    // `OWNER_IS_CALLER` was established, the two uids ARE equal whatever else is missing, and hedging there
    // would be a ceiling weaker than its own evidence. The defect was never this test — it was the FALL-THROUGH.
    : (UNESTABLISHED_REASONS.some(code => verdict.unmet.includes(code))
      && !ESTABLISHED_SAME_UID_REASONS.some(code => verdict.unmet.includes(code))
      // **CODEX R11, FINDING 5: MISSING FACTS DO NOT ESTABLISH UID EQUALITY.**
      //
      // MEASURED: any unmet predicate yielded `SAME_UID`, and this branch rendered that as *"the owner account
      // and THIS DAEMON are the same uid"* — **a claim the missing facts do not support.** A pin that was never
      // compared, or a caller uid that was never read, establishes NOTHING about identity; it establishes that
      // nobody looked. **The verdict stays fail-closed — `separated: false` is unchanged — but the SENTENCE now
      // says what was actually found: not measured.**
      //
      // **AND A MEASURED SAME_UID STILL READS AS ONE**, which is the half that must not be weakened: the
      // positive arm below asserts it, so a fix that hedged every case would go red.
      ? `${verdict.verdict}: separation was NOT ESTABLISHED — the owner account and this daemon were not `
        + `measured to be the same uid, and the facts needed to tell are missing (${verdict.unmet.join('; ')}). `
        + 'Nothing here says the owner and the daemon are equal; it says the question was not answered, and an '
        + 'unanswered question is refused rather than assumed either way.'
      : (ESTABLISHED_SAME_UID_REASONS.some(code => verdict.unmet.includes(code))
        // **THE ONLY BRANCH THAT MAY SAY "SAME_UID", AND IT REQUIRES THE FACT RATHER THAN ITS ABSENCE.**
        ? `${verdict.verdict}: the owner account and THIS DAEMON are the same uid, so anything running as that `
          + `uid CAN reach this socket and read the keys (${verdict.unmet.join('; ')}). The agent's own uid is `
          + 'not measured here — this says what the daemon is, not what invoked it.'
        // **AND EVERYTHING ELSE SAYS WHAT WAS ACTUALLY FOUND.** The uids were measured to DIFFER, or another
        // door is open and equality was never the finding. Either way this line must not assert an identity.
        : `${verdict.verdict}: the owner account and this daemon were NOT shown to be the same uid, and they `
          + `were not shown to differ by this line either — separation was refused for another reason `
          + `(${verdict.unmet.join('; ')}). Nothing here claims the two uids are equal.`))
  return Object.freeze([
    AUTHORITY_CEILING.console[0],
    `${separation} It does NOT prove a person read the frozen bytes: the console is a terminal, and an `
    + 'answer on it is indistinguishable from an answer typed by anything holding that uid.',
  ])
}

/** One named refusal, as an `Error` whose `code` is the name. */
export function ownerRefusal(code, message) {
  const error = new Error(`${code}: ${message}`)
  error.code = code
  return error
}

/** The digest of exact bytes. The ONE crypto call in this file, and it implements no curve. */
export function digestOf(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Freeze a proposal: THE BYTES ARE COPIED AND HASHED NOW, and every later comparison uses that digest.
 *
 * THE BYTES ARE FROZEN AS A BUFFER, NOT AS A PATH. A proposal that named a file would be a proposal whose
 * contents could change between the person reading it and the daemon writing it — the whole class of defect
 * this lane has spent its life closing. The agent hands over bytes; the daemon keeps them and their digest.
 *
 * @param {{bytes: Buffer|Uint8Array|string, operation: string, scope: string, ledgerId: string, expiresAt: number, now?: number}} input
 * @returns {Readonly<Record<string, unknown>>} the frozen proposal.
 */
export function freezeProposal(input) {
  const bytes = Buffer.isBuffer(input?.bytes) ? Buffer.from(input.bytes)
    : typeof input?.bytes === 'string' ? Buffer.from(input.bytes, 'utf8')
      : input?.bytes instanceof Uint8Array ? Buffer.from(input.bytes) : null
  if (bytes === null || bytes.length === 0) {
    throw ownerRefusal(OWNER_REFUSE.PROPOSAL_MALFORMED, 'a proposal is bytes, and these are not')
  }
  for (const [field, value] of [['operation', input.operation], ['scope', input.scope], ['ledgerId', input.ledgerId]]) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
      throw ownerRefusal(OWNER_REFUSE.PROPOSAL_MALFORMED, `a proposal names its ${field}, and this one does not`)
    }
  }
  if (!Number.isInteger(input.expiresAt)) {
    throw ownerRefusal(OWNER_REFUSE.PROPOSAL_MALFORMED, 'a proposal names the instant it stops being valid')
  }
  // ── AND THE INSTANT MUST BE ONE THAT CAN BE SAID OUT LOUD ─────────────────────────────────────────
  //
  // **AN INTEGER IS NOT AN INSTANT.** `1e15` is an integer, and `new Date(1e15 * 1000).toISOString()` throws
  // `RangeError` — so the console died WHILE LISTING, which is the one thing the owner needs to be able to do.
  const frozenAt = input.now ?? Math.floor(Date.now() / 1000)
  if (input.expiresAt > MAX_RENDERABLE_INSTANT) {
    throw ownerRefusal(OWNER_REFUSE.EXPIRY_OUT_OF_RANGE,
      `the proposal expires at ${String(input.expiresAt)}, and no instant after `
      + `${String(MAX_RENDERABLE_INSTANT)} (9999-12-31T23:59:59Z) can be rendered as a date at all — so the `
      + 'owner could not be shown when it lapses, and this daemon will not freeze an expiry it cannot print')
  }
  if (input.expiresAt > frozenAt + MAX_PROPOSAL_LIFETIME_SECONDS) {
    throw ownerRefusal(OWNER_REFUSE.EXPIRY_OUT_OF_RANGE,
      `the proposal expires at ${String(input.expiresAt)}, more than `
      + `${String(MAX_PROPOSAL_LIFETIME_SECONDS / 86_400)} days after it was frozen (${String(frozenAt)}). A `
      + 'pending proposal holds its slot until its expiry sweeps it, so an expiry is also how long the agent '
      + 'can hold one — and thirty days is already far beyond any real approval')
  }
  // **BEFORE THE PROPOSAL EXISTS.** A scope that disagrees with the bytes is refused here, so it is never
  // stored, never listed, and never reaches an owner's terminal.
  assertScopeNamesTheEnvelopeRelease(bytes, input.operation, input.scope)
  assertOperationNamesTheEnvelopeKind(bytes, input.operation)
  return Object.freeze({
    digest: digestOf(bytes),
    bytes,
    operation: input.operation,
    scope: input.scope,
    ledgerId: input.ledgerId,
    // **THE COUNT THE PHONE EVENT IS CHECKED AGAINST, READ FROM THE BYTES THE OWNER WILL SEE.** Without it the
    // verifier's `proposal.count !== undefined` guard skipped the comparison entirely, so an approval event
    // could name any number of records. **A check whose subject is absent does not fail; it does not run.**
    count: recordCountOf(bytes),
    // THE NONCE IS THE DAEMON'S, NEVER THE CALLER'S. A nonce the agent chose is a nonce the agent can
    // replay into a second proposal and have the same approval answer both.
    nonce: randomBytes(32).toString('hex'),
    expiresAt: input.expiresAt,
    frozenAt: input.now ?? Math.floor(Date.now() / 1000),
    settledAt: null,
  })
}

/**
 * THE ADMISSION ENVELOPE — ONE COMPLETE ACTION, FROZEN, AND THE ONLY SOURCE OF EVERY GRANT FIELD.
 *
 * **CODEX'S SINGLE MOST IMPORTANT CHANGE, AND IT IS A CLASS OF DEFECT RATHER THAN FIVE BUGS.** The daemon
 * used to take the artifact set from `request.artifacts`, the release from a separate `request.release`, and
 * the count from `request.artifacts.length` — three values that reached the SIGNATURE without ever being
 * checked against the bytes the owner was shown. The owner approved a 400-character preview while the grant
 * was built from fields that preview did not contain.
 *
 * **SO THE ENVELOPE IS THE BYTES.** `freezeAdmissionEnvelope` serialises it canonically, and
 * `envelopeOf(proposal.bytes)` PARSES IT BACK OUT — the grant is derived from the frozen text and from
 * nothing else. There is no second copy to disagree with the first, and no request field reaches a
 * signature.
 *
 * CANONICAL, BECAUSE THE DIGEST IS THE IDENTITY: keys in a fixed order and artifacts SORTED, so the same
 * admission has exactly one representation and therefore exactly one digest. Two spellings of one set would
 * be two proposals, two approvals and two grants for one action.
 */
export const ADMISSION_ENVELOPE_VERSION = 1

/** The two shapes an admission takes, and the only kinds this daemon will freeze. */
export const ADMISSION_KINDS = Object.freeze({
  ARTIFACT: 'artifact',
  SET: 'set',
})

const HEX64 = /^[0-9a-f]{64}$/u

/**
 * THE LAST INSTANT A UNIX TIME CAN BE RENDERED, **MEASURED RATHER THAN GUESSED.**
 *
 * `new Date(253402300799 * 1000).toISOString()` is `9999-12-31T23:59:59.000Z`; one second more throws
 * `RangeError: Invalid time value`. **INDEPENDENT REVIEW R3: an `expiresAt` outside this range CRASHED THE
 * OWNER CONSOLE WHILE IT WAS LISTING** — the listing is what the owner reads before approving, so a submitter
 * could take the console down with one field and leave the owner with no way to see anything.
 *
 * `Number.isInteger` was the whole of the old check, and `1e15` is an integer.
 */
export const MAX_RENDERABLE_INSTANT = 253402300799

/**
 * HOW FAR AHEAD A PROPOSAL MAY EXPIRE — **BECAUSE AN EXPIRY IS ALSO HOW LONG A PENDING SLOT IS HELD.**
 *
 * The store sweeps a pending proposal when its expiry passes, so the expiry is not only a claim about the
 * owner's window: **it is the lifetime of a slot the agent cannot get back by any other means.** A proposal
 * expiring in the year 9999 holds one for eight thousand years, and an agent can submit as many as it likes.
 * Thirty days is chosen to be far beyond any real approval (the callers use five minutes) and still a bounded
 * commitment rather than an unbounded one.
 */
export const MAX_PROPOSAL_LIFETIME_SECONDS = 30 * 24 * 60 * 60

/**
 * The canonical text of an envelope: fixed key order, sorted artifacts, no whitespace.
 * @param {Readonly<Record<string, unknown>>} envelope
 * @returns {string}
 */
export function canonicalEnvelope(envelope) {
  return JSON.stringify({
    version: ADMISSION_ENVELOPE_VERSION,
    kind: envelope.kind,
    operation: envelope.operation,
    release: envelope.release,
    artifacts: [...envelope.artifacts].sort(),
  })
}

/**
 * HOW MANY RECORDS THE FROZEN BYTES AUTHORISE — **DERIVED FROM THE BYTES, NEVER SUPPLIED.**
 *
 * **THE DESIGN GAP BETA FOUND.** The phone verifier cross-checks the `count` tag on the owner's event against
 * `proposal.count`, and **the frozen proposal carried no `count` at all** — so the check was
 * `proposal.count !== undefined && …`, which is to say the check never ran. An approval event could name any
 * number of records and nothing compared it to what was actually being authorised.
 *
 * **THE COUNT IS A READING OF THE FROZEN BYTES, IN THE SAME SENSE `digest` AND `scope` ARE.** It is computed
 * when the proposal is frozen and stored BESIDE the bytes rather than inside them: the bytes are the
 * submitter's and are already signed, so the daemon cannot edit them, and a count the submitter could write
 * into the envelope would be a number checked against itself.
 *
 * THE RULE, and it is the whole of it:
 *
 *   · an ADMISSION ENVELOPE authorises its `artifacts` — the set size for `admit-plugin-set`, and 1 for a
 *     single `artifact`, which is the same expression because a single artifact's list has one entry;
 *   · ANYTHING ELSE authorises exactly one record, which is what the memory and grant operations do.
 *
 * A COUNT THAT CANNOT BE ESTABLISHED IS NOT ZERO. Malformed bytes, a non-object, an envelope of another
 * version, or a missing or empty artifact list all answer **1** — the one-record reading — because this is the
 * number the owner's ceiling prints and the number the phone event is checked against, and **zero would mean
 * "this approval authorises nothing", which is a claim about the request rather than a fallback.** The
 * envelope's own shape is refused by name on the way in by `assertEnvelope`; this function is not a validator
 * and must not be read as one.
 *
 * @param {Buffer|Uint8Array|string} bytes - the FROZEN bytes.
 * @returns {number} a positive integer.
 */
export function recordCountOf(bytes) {
  let parsed = null
  try { parsed = JSON.parse(typeof bytes === 'string' ? bytes : Buffer.from(bytes).toString('utf8')) } catch {
    return 1
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return 1
  if (parsed.version !== ADMISSION_ENVELOPE_VERSION) return 1
  if (!Array.isArray(parsed.artifacts) || parsed.artifacts.length === 0) return 1
  return parsed.artifacts.length
}

/**
 * THE SCOPE THE OWNER READS MUST BE THE RELEASE THE SIGNED BYTES NAME.
 *
 * **INDEPENDENT REVIEW R1.** For an admission, the caller sends `scope` BESIDE the envelope — and nothing
 * compared it to `envelope.release`. **The two are the same fact written twice**, and only one of them is
 * inside the bytes the owner is authorising: `release` is in the canonical envelope (so the digest covers it
 * and the approval binds it), while `scope` is the caller's own string, stored on the proposal and PRINTED IN
 * THE LISTING.
 *
 * So a submitter could freeze bytes that admit into release A and a scope that says `gate.release:B`. **The
 * owner reads B, the signature covers A, and every check in between agrees with itself** — the scope is
 * compared to the grant's release later, and that grant is derived from the same caller-supplied string. **A
 * VALUE CHECKED ONLY AGAINST A COPY OF ITSELF IS NOT CHECKED.**
 *
 * THE CONVENTION IS ALREADY IN THE CODE: `gateReleaseScope(release)` is how every caller builds this scope,
 * so the check is an equality rather than a new rule. It runs AT FREEZE TIME, so a proposal that disagrees
 * with its own bytes is refused before it is ever stored or shown to anyone.
 *
 * ONLY ADMISSION OPERATIONS ARE CHECKED. The memory and grant operations carry no envelope with a `release`
 * in it, and a check that guessed at their scope shape would refuse legitimate work.
 *
 * @param {Buffer|Uint8Array|string} bytes - the bytes about to be frozen.
 * @param {string} operation
 * @param {string} scope
 * @throws {Error} `aukora-owner:scope-disagrees-with-envelope`.
 */
export function assertScopeNamesTheEnvelopeRelease(bytes, operation, scope) {
  if (operation !== OPERATIONS.ADMIT_ARTIFACT && operation !== OPERATIONS.ADMIT_SET) return
  let parsed = null
  try { parsed = JSON.parse(typeof bytes === 'string' ? bytes : Buffer.from(bytes).toString('utf8')) } catch {
    return
  }
  // A MALFORMED ENVELOPE IS `assertEnvelope`'S JOB, NOT THIS ONE'S. Answering here as well would report the
  // same fault under two names, and the caller would not know which check to satisfy.
  if (parsed === null || typeof parsed !== 'object' || parsed.version !== ADMISSION_ENVELOPE_VERSION) return
  if (typeof parsed.release !== 'string' || parsed.release.length === 0) return
  const expected = gateReleaseScope(parsed.release)
  if (scope !== expected) {
    throw ownerRefusal(OWNER_REFUSE.SCOPE_DISAGREES_WITH_ENVELOPE,
      `the submitter names the scope ${String(scope)} and the frozen bytes admit into release `
      + `${JSON.stringify(parsed.release)}, whose scope is ${expected}. The owner reads the SCOPE and the `
      + 'signature covers the RELEASE, so a proposal where they disagree shows one thing and authorises '
      + 'another')
  }
}

/**
 * THE OPERATION THE OWNER READS MUST BE THE KIND THE SIGNED BYTES DECLARE.
 *
 * **CODEX ITEM 5.** An admission submit carries `operation` BESIDE the envelope — and nothing compared it to
 * `envelope.kind`. `assertEnvelope` ties `kind: 'artifact'` to exactly one artifact, so the KIND is pinned to
 * the bytes; **the OPERATION was pinned to nothing.**
 *
 * So a submitter could send `operation: 'admit-plugin-artifact'` — the singular, one-record reading — with
 * `kind: 'set'` and fifty artifacts inside. **The listing would say "artifact" and the count beside it would
 * say fifty**, which is the contradiction a person is least likely to stop and resolve, and the operation is
 * the field the ceiling is described by. **A LABEL THAT DISAGREES WITH THE THING IT LABELS IS NOT A
 * DISAGREEMENT THE READER CAN SEE.**
 *
 * This is R1's shape exactly, one field over: the same fact written twice, once inside the bytes and once
 * beside them, with only the inside copy signed. **THE TWO ARE CHECKED TOGETHER NOW.**
 *
 * @param {Buffer|Uint8Array|string} bytes - the bytes about to be frozen.
 * @param {string} operation
 * @throws {Error} `aukora-owner:operation-disagrees-with-envelope`.
 */
export function assertOperationNamesTheEnvelopeKind(bytes, operation) {
  const expected = OPERATION_FOR_KIND.get(operation)
  // NOT AN ADMISSION OPERATION, so this check has no opinion: the memory and grant operations carry no
  // envelope with a `kind` in it.
  if (expected === undefined) return
  let parsed = null
  try { parsed = JSON.parse(typeof bytes === 'string' ? bytes : Buffer.from(bytes).toString('utf8')) } catch {
    return
  }
  // A MALFORMED ENVELOPE IS `assertEnvelope`'S JOB, NOT THIS ONE'S — reporting it twice under two names would
  // leave the caller unsure which check to satisfy.
  if (parsed === null || typeof parsed !== 'object' || parsed.version !== ADMISSION_ENVELOPE_VERSION) return
  if (parsed.kind === expected) return
  throw ownerRefusal(OWNER_REFUSE.OPERATION_DISAGREES_WITH_ENVELOPE,
    `the submitter names the operation ${operation}, and the frozen bytes declare kind `
    + `${JSON.stringify(parsed.kind)} — whose operation is `
    + `${String([...OPERATION_FOR_KIND].find(([, kind]) => kind === parsed.kind)?.[0])}. The owner reads the `
    + 'OPERATION and the signature covers the KIND, so a proposal where they disagree is described as one '
    + 'thing and authorises another')
}

/** The one operation each admission kind belongs to, both ways round, so neither can drift alone. */
const OPERATION_FOR_KIND = new Map([
  [OPERATIONS.ADMIT_ARTIFACT, ADMISSION_KINDS.ARTIFACT],
  [OPERATIONS.ADMIT_SET, ADMISSION_KINDS.SET],
])

/**
 * Validate an envelope and refuse malformed ones BY NAME. This runs on the way IN and again on the way OUT,
 * because the frozen bytes are what the grant is derived from and a parse that trusted its own earlier
 * validation would be trusting a file rather than a value.
 */
export function assertEnvelope(envelope, where) {
  const at = where ?? 'the admission envelope'
  if (envelope === null || typeof envelope !== 'object') {
    throw ownerRefusal(OWNER_REFUSE.PROPOSAL_MALFORMED, `${at} is not an object`)
  }
  if (envelope.version !== ADMISSION_ENVELOPE_VERSION) {
    throw ownerRefusal(OWNER_REFUSE.PROPOSAL_MALFORMED,
      `${at} declares version ${String(envelope.version)} and this daemon freezes version `
      + String(ADMISSION_ENVELOPE_VERSION))
  }
  if (!Object.values(ADMISSION_KINDS).includes(envelope.kind)) {
    throw ownerRefusal(OWNER_REFUSE.PROPOSAL_MALFORMED, `${at} names an unknown kind: ${String(envelope.kind)}`)
  }
  if (typeof envelope.operation !== 'string' || envelope.operation.length === 0) {
    throw ownerRefusal(OWNER_REFUSE.PROPOSAL_MALFORMED, `${at} does not name its operation`)
  }
  // **AND THE OPERATION MUST BE THE ONE ITS `kind` IMPLIES (CODEX R4 ITEM 5).** MEASURED: this asked only that
  // the field be a NONEMPTY STRING, so an envelope could declare `kind: artifact` and
  // `operation: admit-plugin-set` — **two statements about the same act, frozen together, with only the kind
  // ever checked against anything.** The daemon derives the operation from the kind before freezing, so its own
  // path cannot produce this; **an envelope is also built by callers, and a rule enforced only on the path that
  // happens to be careful is not a rule.**
  //
  // The kind→operation map is the SAME one `assertOperationNamesTheEnvelopeKind` reads, so the two checks
  // cannot drift into disagreeing about which operation belongs to which kind.
  const implied = OPERATION_FOR_KIND.get(envelope.operation)
  if (implied !== undefined && implied !== envelope.kind) {
    throw ownerRefusal(OWNER_REFUSE.OPERATION_DISAGREES_WITH_ENVELOPE,
      `${at} declares kind ${String(envelope.kind)} and names the operation ${String(envelope.operation)}, `
      + `which belongs to kind ${String(implied)}. The two describe one act and must agree`)
  }
  if (implied === undefined) {
    throw ownerRefusal(OWNER_REFUSE.OPERATION_DISAGREES_WITH_ENVELOPE,
      `${at} names the operation ${String(envelope.operation)}, which is not an admission operation at all`)
  }
  if (typeof envelope.release !== 'string' || envelope.release.length === 0 || envelope.release.length > 256) {
    throw ownerRefusal(OWNER_REFUSE.PROPOSAL_MALFORMED, `${at} does not name the release it admits into`)
  }
  if (!Array.isArray(envelope.artifacts) || envelope.artifacts.length === 0) {
    throw ownerRefusal(OWNER_REFUSE.PROPOSAL_MALFORMED, `${at} names no artifacts`)
  }
  for (const digest of envelope.artifacts) {
    if (typeof digest !== 'string' || !HEX64.test(digest)) {
      throw ownerRefusal(OWNER_REFUSE.PROPOSAL_MALFORMED,
        `${at} carries an artifact digest that is not 64 hex characters: ${String(digest).slice(0, 24)}`)
    }
  }
  if (new Set(envelope.artifacts).size !== envelope.artifacts.length) {
    throw ownerRefusal(OWNER_REFUSE.PROPOSAL_MALFORMED,
      `${at} names the same artifact more than once, so its count would overstate what was approved`)
  }
  // AN ARTIFACT ENVELOPE ADMITS EXACTLY ONE, AND THE COUNT IS DERIVED NOWHERE ELSE. A single-artifact
  // admission carrying three digests is a set wearing the wrong name, and the grant that followed would
  // have been signed over whichever count the caller happened to send.
  if (envelope.kind === ADMISSION_KINDS.ARTIFACT && envelope.artifacts.length !== 1) {
    throw ownerRefusal(OWNER_REFUSE.PROPOSAL_MALFORMED,
      `${at} is a single-artifact admission and names ${String(envelope.artifacts.length)} artifacts`)
  }
  return Object.freeze({
    version: ADMISSION_ENVELOPE_VERSION,
    kind: envelope.kind,
    operation: envelope.operation,
    release: envelope.release,
    artifacts: Object.freeze([...envelope.artifacts].sort()),
  })
}

/**
 * THE FROZEN ENVELOPE, PARSED BACK OUT OF THE BYTES THAT WERE FROZEN. Every grant field comes from here.
 * @param {Buffer|string} bytes
 * @returns {Readonly<Record<string, unknown>>}
 */
export function envelopeOf(bytes) {
  let parsed = null
  try {
    parsed = JSON.parse(typeof bytes === 'string' ? bytes : bytes.toString('utf8'))
  } catch (cause) {
    throw ownerRefusal(OWNER_REFUSE.PROPOSAL_MALFORMED,
      `the frozen admission is not parseable JSON: ${String(cause?.message ?? cause)}`)
  }
  return assertEnvelope(parsed, 'the frozen admission')
}

/**
 * Freeze one complete admission. The BYTES ARE THE CANONICAL ENVELOPE, so the digest the owner is shown is a
 * digest of exactly what the grant will be derived from.
 */
export function freezeAdmissionEnvelope(input) {
  const envelope = assertEnvelope(input.envelope)
  // ── THE REQUEST'S OPERATION IS CHECKED, NOT IGNORED ─────────────────────────────────────────────
  //
  // **THIS FUNCTION USES `envelope.operation` AND NEVER LOOKED AT `input.operation` AT ALL.** So a caller
  // sending `operation: 'admit-plugin-set'` beside an artifact envelope got an ARTIFACT proposal and no error:
  // **the field it set was silently discarded, and it would go on believing it had submitted a set.** The
  // daemon's own rule elsewhere is that a field nobody reads is a field that lies — the same shape as a
  // refusal nobody raises.
  //
  // It is checked rather than trusted: the operation inside the bytes is the one the owner reads and the one
  // the digest covers, so it is the authority. **The request must AGREE with it or be refused.**
  if (input.operation !== undefined && input.operation !== envelope.operation) {
    throw ownerRefusal(OWNER_REFUSE.OPERATION_DISAGREES_WITH_ENVELOPE,
      `the request names the operation ${String(input.operation)} and the envelope names `
      + `${String(envelope.operation)}. The envelope's is the one frozen, printed and signed, so a request that `
      + 'disagrees would be silently discarded — and the caller would believe it had submitted something else')
  }
  return freezeProposal({
    bytes: Buffer.from(canonicalEnvelope(envelope), 'utf8'),
    operation: envelope.operation,
    scope: input.scope,
    ledgerId: input.ledgerId,
    expiresAt: input.expiresAt,
    now: input.now,
  })
}

/**
 * The store of frozen proposals and consumed approvals, IN MEMORY AND PER DAEMON.
 *
 * IN MEMORY IS DELIBERATE FOR THIS CUT. The journal and the witness are the durable record and they live in
 * the owner's protected directory; this object is the working set that makes "consumed once" true while the
 * process runs. A daemon that persisted consumption here instead would let anyone who can write that file
 * make the owner refuse forever — the same reasoning `signer-channel.mjs` gives for its `seen` set.
 */
/**
 * THE STATES A PROPOSAL CAN BE IN, AND THE ONLY TRANSITIONS BETWEEN THEM.
 *
 * **CODEX P1 #4.** The store had no terminal states at all: a proposal was in the map or not, `spend` added a
 * nonce to a set, and NOTHING recorded that the owner had DECLINED something. So a declined proposal was still
 * pending as far as every later check was concerned — the owner said no and the same approval could be
 * presented again and settle.
 *
 *     pending ──approve──▶ approved ──settle──▶ settled      (terminal)
 *        │                    │
 *        ├────decline─────────┴──────────────▶ declined      (terminal)
 *        └────deadline───────────────────────▶ expired       (terminal)
 *
 * **`settled` IS TERMINAL AND SO ARE `declined` AND `expired`, so a state only ever moves forward.** There is
 * no transition out of a terminal state, which is what makes "the owner declined this" a fact rather than a
 * note that a later caller may overwrite.
 */
export const PROPOSAL_STATE = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  SETTLED: 'settled',
  DECLINED: 'declined',
  EXPIRED: 'expired',
})

/** The named refusals this store makes. */
export const STORE_REFUSE = Object.freeze({
  TOO_MANY_PENDING: 'aukora-owner:too-many-pending',
  TOO_MANY_BYTES: 'aukora-owner:too-many-pending-bytes',
  NONCE_NOT_RECORDED: 'aukora-owner:nonce-not-recorded',
  NONCE_COLLISION: 'aukora-owner:nonce-collision',
  NOT_PENDING: 'aukora-owner:proposal-not-pending',
  DECLINED: 'aukora-owner:proposal-declined',
  EXPIRED: 'aukora-owner:proposal-expired',
  ALREADY_SETTLED: 'aukora-owner:proposal-already-settled',
  // **CODEX R5 ITEM C.** The retained cap had no refusal of its own: `put` checked only the two PENDING
  // bounds, and the retained cap lived entirely in `reclaim`, which the daemon calls AFTER the insert.
  RETAINED_CAP: 'aukora-owner:retained-cap',
})

/**
 * THE BOUNDS, AND THEY EXIST BECAUSE NOTHING ELSE BOUNDED THEM.
 *
 * Codex: "proposal/spent storage and daemon history have no eviction or quotas." An agent that submits in a
 * loop grows the daemon's heap until it dies, and the daemon it kills is the one holding the owner's sockets.
 * **A quota without a NAMED REFUSAL is a crash**, so each limit refuses by name and the caller can tell which.
 */
export const STORE_LIMITS = Object.freeze({
  /** How many proposals may be PENDING at once. Terminal ones do not count against it. */
  MAX_PENDING: 64,
  /** The total bytes of PENDING proposals. The frames are capped; the sum of them was not. */
  MAX_PENDING_BYTES: 4 * 1024 * 1024,
  /** How long a TERMINAL proposal is kept before it is dropped. */
  RETENTION_SECONDS: 3_600,
  /**
   * HOW MANY PROPOSALS MAY BE RETAINED AT ALL — PENDING **AND** TERMINAL, WHICH IS THE PART THAT WAS MISSING.
   *
   * **CODEX R4'S SINGLE MOST IMPORTANT CHANGE.** The two bounds above cover only PENDING entries, so terminal
   * ones kept their bytes for the whole retention hour with nothing counting them: **an agent that submitted,
   * let each proposal expire, and submitted again grew the daemon's heap for an hour at whatever rate the
   * socket allowed**, and the daemon it kills is the one holding the owner's doors. A retention CLOCK is not a
   * bound; it is a delay.
   *
   * **THE RETAINED CAP MUST EXCEED THE PENDING ONE, OR PENDING WOULD BE EVICTED TO SATISFY IT.** Four times
   * the pending cap leaves history room without ever making the owner's live work the thing that gives way.
   */
  MAX_RETAINED: 256,
  /** And the same for bytes, for the reason the pending pair gives: a count bound alone permits N huge ones. */
  MAX_RETAINED_BYTES: 16 * 1024 * 1024,
})

const terminal = state => state === PROPOSAL_STATE.SETTLED || state === PROPOSAL_STATE.DECLINED
  || state === PROPOSAL_STATE.EXPIRED

/**
 * The store of frozen proposals and consumed approvals, IN MEMORY AND PER DAEMON.
 *
 * **KEYED BY NONCE, WHICH IS THE IDENTITY AN APPROVAL NAMES.** It was keyed by DIGEST, so submitting the same
 * bytes twice REPLACED the pending proposal — including its nonce. The owner's sheet then showed a proposal
 * whose handle had changed underneath it, and an approval answering the first could settle the second. The
 * nonce is minted by the daemon (32 random bytes) and never by the caller, so keying on it means identical
 * bytes submitted twice are **two proposals**, each with its own handle, and neither replaces the other.
 *
 * IN MEMORY IS DELIBERATE FOR THIS CUT, and P1 #5 is the durable half of it.
 */
export function createProposalStore(limits) {
  const bound = { ...STORE_LIMITS, ...(limits ?? {}) }
  const proposals = new Map()
  // **THE DIGEST INDEX HOLDS EVERY NONCE THAT HAS THESE BYTES, NOT THE LATEST ONE.** MEASURED (Codex r3): it
  // was `Map<digest, nonce>`, so a second submission of IDENTICAL BYTES overwrote the entry — and then settling
  // BY DIGEST marked the SECOND proposal settled while the first was the one being settled. **Two proposals
  // with one byte string are two acts, and an index that keeps one of them silently answers for the other.**
  // It is a SET now, and nothing that CHANGES state resolves through it — see `markSettled`.
  const byDigest = new Map()
  // **SPENT AND SETTLED ARE TWO FACTS, AND MY FIRST REFACTOR MADE THEM ONE.** MEASURED: I had `isSpent` read
  // the proposal's STATE, so `markSettled` — which is only told a digest — also made the nonce spent, the spent
  // check answered first, and `PROPOSAL_SETTLED` became **unreachable**. `codex-uid-design.md:7` requires each
  // protection be exercisable "so another gate cannot mask it", and a guard that can only ever be shadowed is a
  // guard nobody has tested. **A state machine that merges two facts deletes the guard that told them apart.**
  const spent = new Set()
  const refuse = (code, message) => {
    const error = new Error(`${code}: ${message}`)
    error.code = code
    return error
  }
  const pending = () => [...proposals.values()].filter(entry => entry.state === PROPOSAL_STATE.PENDING)
  const pendingBytes = () => pending().reduce((total, entry) => total + entry.bytes.length, 0)
  /** EVERYTHING HELD, whatever state — the denominator the retained cap is about. */
  const retainedBytes = () => [...proposals.values()].reduce((total, entry) => total + entry.bytes.length, 0)

  /**
   * LET ONE PROPOSAL GO, FROM THE STORE AND FROM EVERY INDEX THAT NAMES IT.
   *
   * **ONE IMPLEMENTATION, BECAUSE THERE ARE NOW TWO CALLERS AND THE INDEX IS EASY TO HALF-CLEAN.** Retention
   * dropped entries inside `sweep`; the retained cap has to drop them too, and **a second copy of this would be
   * the version that forgets `byDigest` or `spent`** — leaving a digest pointing at a nonce that no longer
   * exists, or a spend set that grows for the daemon's lifetime while its proposals are gone.
   */
  const forget = nonce => {
    const entry = proposals.get(nonce)
    if (entry === undefined) return false
    proposals.delete(nonce)
    // THE INDEX LOSES ONLY THIS NONCE, or dropping one proposal makes its twin unfindable by digest.
    const holders = byDigest.get(entry.digest)
    if (holders !== undefined) {
      holders.delete(nonce)
      if (holders.size === 0) byDigest.delete(entry.digest)
    }
    // A DROPPED PROPOSAL FORGETS ITS SPEND TOO, or the set grows for the daemon's lifetime.
    spent.delete(nonce)
    return true
  }

  /** Expire what is past its deadline, and drop terminal proposals past retention. Returns what changed. */
  const sweepAt = now => {
    let expired = 0
    let dropped = 0
    for (const entry of [...proposals.values()]) {
      if (entry.state === PROPOSAL_STATE.PENDING && entry.expiresAt !== undefined && now >= entry.expiresAt) {
        proposals.set(entry.nonce, Object.freeze({ ...entry, state: PROPOSAL_STATE.EXPIRED, stateAt: now }))
        expired += 1
      } else if (terminal(entry.state) && now - entry.stateAt >= bound.RETENTION_SECONDS) {
        if (forget(entry.nonce)) dropped += 1
      }
    }
    return Object.freeze({ expired, dropped })
  }

  /**
   * MAKE ROOM BEFORE TAKING ANY, WHICH IS THE ORDER CODEX R4 NAMES AND THE ONE THAT WAS WRONG.
   *
   * **MEASURED BUG: RECLAMATION RAN AFTER THE REFUSAL.** `put` checked the pending bounds and refused, and the
   * sweep that would have freed those slots ran later — on `list`. **So a queue full of EXPIRED proposals
   * rejected new work while the very entries blocking it were reclaimable**, and the agent was told to "let one
   * expire first" about proposals that had already expired. **A REFUSAL THAT THE NEXT LINE WOULD HAVE AVOIDED IS
   * A LIE ABOUT THE STATE.**
   *
   * It reclaims in the order that costs the owner least: the sweep first (deadlines and retention, the entries
   * the store has already decided are finished), then **TERMINAL ENTRIES OLDEST FIRST** if the retained cap is
   * still exceeded. **PENDING IS NEVER EVICTED HERE** — those are the owner's live work, and if they alone
   * exceed the cap the existing pending bounds refuse by name, which is the honest answer rather than silently
   * discarding something the owner was about to read.
   */
  const reclaim = (now, incomingBytes = 0) => {
    const swept = sweepAt(now)
    let evicted = 0
    // **THE ROOM IS MADE FOR THE ENTRY ABOUT TO ARRIVE, NOT FOR THE ONE ALREADY HERE.** MEASURED OFF BY ONE:
    // evicting until `size <= MAX_RETAINED` and THEN inserting leaves `MAX_RETAINED + 1`, so the cap is a
    // number the store sits one above. `incomingBytes` is the same correction for the byte half.
    const fits = () => proposals.size < bound.MAX_RETAINED
      && retainedBytes() + incomingBytes <= bound.MAX_RETAINED_BYTES
    if (!fits()) {
      const finished = [...proposals.values()].filter(entry => terminal(entry.state))
        .sort((left, right) => left.stateAt - right.stateAt)
      for (const entry of finished) {
        if (fits()) break
        if (forget(entry.nonce)) evicted += 1
      }
    }
    // **AND WHETHER IT WORKED, WHICH IS THE HALF THAT WAS MISSING (CODEX R5 ITEM C).** This returned only a
    // count of what it evicted, so a caller could not tell "there is room now" from "there is still none" —
    // **and the second is the case that needs a refusal rather than a shrug.** `fits` is the same closure the
    // eviction loop uses, so the answer cannot drift from the decision it describes.
    return Object.freeze({ ...swept, evicted, fits: fits() })
  }

  return Object.freeze({
    /**
     * Freeze one proposal, refusing BY NAME when the store is full.
     *
     * @param {Readonly<Record<string, unknown>>} proposal
     * @returns {Readonly<Record<string, unknown>>}
     * @throws {Error} `too-many-pending`, `too-many-pending-bytes` or `nonce-collision`.
     */
    put(proposal) {
      // **RECLAIM BEFORE INSERTING (CODEX R4).** This runs FIRST, before the collision check and before both
      // bounds: a full expired queue used to reject here and only free itself on the next `list`.
      reclaim(proposal.frozenAt ?? Math.floor(Date.now() / 1000), proposal.bytes.length)
      // A COLLISION IS REFUSED RATHER THAN REPLACING. The nonce is 32 random bytes so this cannot happen by
      // chance; if it happens at all, something is choosing nonces that are not random, and overwriting the
      // entry would silently drop a pending proposal the owner may be looking at.
      if (proposals.has(proposal.nonce)) {
        throw refuse(STORE_REFUSE.NONCE_COLLISION,
          `a proposal with nonce ${String(proposal.nonce).slice(0, 12)}… is already frozen. Replacing it would `
          + 'change the handle the owner is reading')
      }
      // THE COUNT AND THE BYTES ARE BOTH CHECKED, BEFORE THE INSERT. A count bound alone lets 64 proposals of
      // a megabyte each; a byte bound alone lets a million empty ones.
      // ── RECLAIM FIRST, THEN REFUSE — AND REFUSE ON THE CAP THAT NOTHING ELSE COULD FREE (ITEM C) ──
      //
      // **THE TWO PENDING BOUNDS BELOW COUNT ONLY `PENDING`.** MEASURED: an entry in `APPROVED` is not
      // `pending()` and not `terminal()`, so it is **counted by neither bound and evicted by neither sweep** —
      // an owner approving proposals one after another grows the store past `MAX_RETAINED` while every check
      // in this function reads as satisfied. `sweep()` was the only thing that saw them, and it runs after
      // the insert and cannot evict them.
      //
      // **SO THE RETAINED CAP IS ENFORCED HERE, WHERE THE INSERT HAPPENS**, and it is enforced AFTER a
      // reclaim rather than instead of one: the entries this can free are the terminal ones, and refusing
      // before trying is the lie about state that `reclaim` was written to stop telling.
      const room = reclaim(proposal.frozenAt, proposal.bytes.length)
      if (!room.fits) {
        const approved = [...proposals.values()].filter(entry => entry.state === PROPOSAL_STATE.APPROVED)
        throw refuse(STORE_REFUSE.RETAINED_CAP,
          `the store holds ${String(proposals.size)} proposals and ${String(retainedBytes())} bytes, and this `
          + `one does not fit under the ${String(bound.MAX_RETAINED)}-proposal / `
          + `${String(bound.MAX_RETAINED_BYTES)}-byte retained cap even after reclaiming. `
          + `${String(approved.length)} of them are APPROVED: **an approved proposal is neither the owner's `
          + 'pending work nor a finished one, so it is retained by design and cannot be reclaimed — it must be '
          + 'settled or the daemon restarted to release it**')
      }
      if (pending().length >= bound.MAX_PENDING) {
        throw refuse(STORE_REFUSE.TOO_MANY_PENDING,
          `${String(bound.MAX_PENDING)} proposals are already awaiting the owner and no more will be frozen. `
          + 'Approve, decline or let one expire first')
      }
      if (pendingBytes() + proposal.bytes.length > bound.MAX_PENDING_BYTES) {
        throw refuse(STORE_REFUSE.TOO_MANY_BYTES,
          `the pending proposals already hold ${String(pendingBytes())} bytes and this one would pass the `
          + `${String(bound.MAX_PENDING_BYTES)}-byte bound`)
      }
      const entry = Object.freeze({
        ...proposal, state: PROPOSAL_STATE.PENDING, stateAt: proposal.frozenAt,
        settledAt: proposal.settledAt ?? null,
      })
      proposals.set(proposal.nonce, entry)
      if (!byDigest.has(proposal.digest)) byDigest.set(proposal.digest, new Set())
      byDigest.get(proposal.digest).add(proposal.nonce)
      return entry
    },
    /** The proposal with this nonce, whatever state it is in. */
    byNonce(nonce) {
      return proposals.get(String(nonce)) ?? null
    },
    /**
     * The proposal whose digest this is — **THE OLDEST ONE STILL HELD, DETERMINISTICALLY**.
     *
     * A digest does not identify a proposal and never did: identical bytes submitted twice are two proposals.
     * This is a convenience for callers that only know a digest, so it answers with the FIRST one recorded
     * rather than whichever was written last, and **nothing that CHANGES state goes through it.**
     */
    get(digest) {
      const nonces = byDigest.get(digest)
      if (nonces === undefined) return null
      for (const nonce of nonces) {
        const entry = proposals.get(nonce)
        if (entry !== undefined) return entry
      }
      return null
    },
    state(nonce) {
      return proposals.get(String(nonce))?.state ?? null
    },
    /** Move one proposal to a new state, refusing a move out of a terminal one. */
    transition(nonce, to, at) {
      const entry = proposals.get(String(nonce))
      if (entry === undefined) return null
      // **A TERMINAL STATE IS TERMINAL.** Every refusal below names the state the proposal is in rather than
      // saying "not pending", so an operator reading the reply knows whether the owner declined it, it expired,
      // or it was already settled.
      if (entry.state === PROPOSAL_STATE.DECLINED) {
        throw refuse(STORE_REFUSE.DECLINED,
          `the owner DECLINED proposal ${String(nonce).slice(0, 12)}… and a declined proposal is terminal: it `
          + 'cannot be approved, settled or revisited later')
      }
      if (entry.state === PROPOSAL_STATE.EXPIRED) {
        throw refuse(STORE_REFUSE.EXPIRED, `proposal ${String(nonce).slice(0, 12)}… expired`)
      }
      if (entry.state === PROPOSAL_STATE.SETTLED) {
        throw refuse(STORE_REFUSE.ALREADY_SETTLED, `proposal ${String(nonce).slice(0, 12)}… is already settled`)
      }
      if (entry.state === PROPOSAL_STATE.APPROVED && to === PROPOSAL_STATE.APPROVED) {
        throw refuse(STORE_REFUSE.NOT_PENDING, `proposal ${String(nonce).slice(0, 12)}… is already approved`)
      }
      // **`settledAt` IS KEPT BESIDE THE STATE, AND MEASURED: I DROPPED IT AND TWO ARMS WENT RED.** The
      // console prints it and `authoriseSettlement` reads it to refuse a second settlement, so removing it made
      // a settled proposal look unsettled — **an arm reading a field that is gone fails as though the FEATURE
      // were gone**, which is how a state-machine refactor reports a defect it did not cause. The state and the
      // timestamp are two facts about one transition and both are recorded here.
      const next = Object.freeze({
        ...entry, state: to, stateAt: at,
        ...(to === PROPOSAL_STATE.SETTLED ? { settledAt: at } : {}),
      })
      proposals.set(entry.nonce, next)
      return next
    },
    approve(nonce, at) { return this.transition(nonce, PROPOSAL_STATE.APPROVED, at) },
    decline(nonce, at) { return this.transition(nonce, PROPOSAL_STATE.DECLINED, at) },
    /**
     * The proposal's own deadline, ENFORCED INDEPENDENTLY of whoever is asking.
     * @throws {Error} `proposal-expired`.
     */
    assertLive(nonce, now) {
      const entry = proposals.get(String(nonce))
      if (entry === null || entry === undefined) return null
      if (entry.state === PROPOSAL_STATE.EXPIRED || (entry.expiresAt !== undefined && now >= entry.expiresAt)) {
        if (entry.state === PROPOSAL_STATE.PENDING) {
          proposals.set(entry.nonce, Object.freeze({ ...entry, state: PROPOSAL_STATE.EXPIRED, stateAt: now }))
        }
        throw refuse(STORE_REFUSE.EXPIRED,
          `proposal ${String(nonce).slice(0, 12)}… expired at ${String(entry.expiresAt)}`)
      }
      return entry
    },
    /** Consume one approval. THE CALLER MUST HAVE ALREADY DECIDED; this records the transition. */
    /**
     * Consume one approval.
     *
     * **`at` IS THE SETTLEMENT'S OWN CLOCK, PASSED IN.** MEASURED: my first version read `Date.now()` here, so
     * a caller that supplied `now` got a settlement stamped with a SECOND reading of the wall clock — and the
     * authority court, which settles at a fixed `now` and asserts the proposal records it, saw a timestamp it
     * never asked for. **Two readings of the same clock inside one decision is one reading too many**: the
     * expiry check and the settle stamp must agree about when it is.
     */
    spend(nonce, at = Math.floor(Date.now() / 1000)) {
      this.transition(nonce, PROPOSAL_STATE.SETTLED, at)
      // THE SPEND IS RECORDED BESIDE THE STATE, NOT DERIVED FROM IT — see the note on `spent` above.
      spent.add(String(nonce))
      return true
    },
    isSpent(nonce) {
      return spent.has(String(nonce))
    },
    /**
     * Record that a proposal was settled, WITHOUT spending its nonce.
     *
     * **THE TWO ARE SEPARATE ON PURPOSE.** A second writer that settles a proposal without consuming an
     * approval must still be caught by `PROPOSAL_SETTLED`, and that guard is only reachable while "settled"
     * and "spent" can disagree. Kept for the callers that know a digest rather than a nonce.
     */
    markSettled(nonce, at) {
      const entry = proposals.get(String(nonce))
      if (entry === undefined) {
        // **KEYED BY NONCE, AND A DIGEST IS REFUSED RATHER THAN RESOLVED.** The old signature took a digest and
        // resolved it through an index that could point at ANOTHER proposal with the same bytes — so this call
        // could settle a proposal nobody was settling. A nonce cannot express that mistake, and an unknown one
        // is NAMED rather than quietly doing nothing.
        throw refuse(STORE_REFUSE.NONCE_NOT_RECORDED,
          `markSettled is keyed by nonce and ${String(nonce).slice(0, 16)}… is not one this store holds. A `
          + 'digest identifies BYTES, and two proposals can share them')
      }
      if (!terminal(entry.state)) {
        proposals.set(entry.nonce, Object.freeze({
          ...entry, state: PROPOSAL_STATE.SETTLED, stateAt: at, settledAt: at,
        }))
      }
    },
    /** Expire what is past its deadline, and drop terminal proposals past retention. Returns what changed. */
    sweep(now) {
      return sweepAt(now)
    },
    /** The sweep AND the retained-cap eviction, in that order. `put` calls this BEFORE it decides anything. */
    reclaim,
    counts() {
      const byState = {}
      for (const state of Object.values(PROPOSAL_STATE)) byState[state] = 0
      for (const entry of proposals.values()) byState[entry.state] += 1
      return Object.freeze({ proposals: proposals.size, byState, pendingBytes: pendingBytes(), spent: spent.size })
    },
  })
}

/**
 * Decide whether one approval authorises one frozen proposal — AND CONSUME IT, ATOMICALLY, IF IT DOES.
 *
 * ONE FUNCTION, ONE DECISION, ONE SPEND. Splitting "check" from "consume" would leave a gap between them,
 * and that gap is where a replayed approval wins a race. Every refusal below is checked BEFORE the spend,
 * and the spend is the last thing that happens.
 *
 * THE SHELL BOOLEAN IS REFUSED FIRST AND BY NAME. `shellApproval` is the forbidden fallback: an approval
 * that is a boolean, or that arrived with one, is not an approval and there is no route that treats it as
 * one. This is the "remove the shell-Boolean fallback" line, made executable.
 *
 * @param {Readonly<Record<string, unknown>>} input
 * @returns {Readonly<{settled: true, digest: string, ledgerId: string}>}
 */
export function authoriseSettlement(input) {
  const { store, approval, now = Math.floor(Date.now() / 1000) } = input
  if (approval === true || approval === false || typeof approval === 'boolean'
    || (approval !== null && typeof approval === 'object' && typeof approval.shellApproval === 'boolean')) {
    throw ownerRefusal(OWNER_REFUSE.SHELL_BOOLEAN_REFUSED,
      'a shell-supplied boolean is not an approval. An Electron "approved: true" is a claim by the agent\'s '
      + 'own uid and carries no authority here, so it is refused BY NAME rather than treated as a weaker '
      + 'approval. There is no fallback: an owner-uid answer is the only thing that settles')
  }
  if (approval === null || typeof approval !== 'object') {
    throw ownerRefusal(OWNER_REFUSE.PROPOSAL_MALFORMED, 'an approval is a bound record, and this is not one')
  }
  const proposal = store.byNonce(approval.nonce)
  if (proposal === null) {
    // NO PROPOSAL BY THAT NONCE. The approval may be genuine and about something this daemon never froze —
    // which is exactly what a fabricated approval looks like, so it is refused rather than guessed at.
    throw ownerRefusal(OWNER_REFUSE.PROPOSAL_ABSENT,
      `no frozen proposal carries nonce ${String(approval.nonce).slice(0, 12)}…`)
  }
  // THE SPENT CHECK RUNS FIRST, AND THE ORDER IS LOAD-BEARING RATHER THAN TIDY.
  //
  // MEASURED, BEFORE THIS REORDER: a replayed approval was refused as `proposal-settled`, because the
  // proposal check ran first and the proposal it settled is indeed settled — so **`approval-spent` was
  // UNREACHABLE for the ordinary replay and the arm that asserts it was red.** That is exactly what
  // `codex-uid-design.md:7` warns about: "exercise each removed protection so another gate cannot mask it."
  // A refusal that can never fire is a refusal nobody has tested, and the person asking "why was my replay
  // refused?" is owed the fact about THEIR approval rather than the fact about the proposal.
  //
  // BOTH ARE NOW REACHABLE, AND THEY MEAN DIFFERENT THINGS:
  //   the same approval twice          -> APPROVAL_SPENT   (this approval has been consumed)
  //   a FRESH approval asking again    -> PROPOSAL_SETTLED (this proposal is already settled)
  if (store.isSpent(approval.nonce)) {
    throw ownerRefusal(OWNER_REFUSE.APPROVAL_SPENT,
      'this approval has already been consumed. An approval that can be spent twice is not an approval, and '
      + 'the second attempt is refused by this name rather than by whatever check happens to run first')
  }
  if (proposal.settledAt !== null) {
    throw ownerRefusal(OWNER_REFUSE.PROPOSAL_SETTLED,
      `this proposal was already settled at ${String(proposal.settledAt)}; a frozen proposal is settled at most once`)
  }
  if (approval.digest !== proposal.digest) {
    throw ownerRefusal(OWNER_REFUSE.DIGEST_MISMATCH,
      `the approval names ${String(approval.digest).slice(0, 16)}… and the frozen bytes hash to `
      + `${proposal.digest.slice(0, 16)}… — the person approved different bytes`)
  }
  if (approval.operation !== proposal.operation || approval.scope !== proposal.scope) {
    throw ownerRefusal(OWNER_REFUSE.SCOPE_MISMATCH,
      `the approval is for ${String(approval.operation)}/${String(approval.scope)} and the proposal is `
      + `${proposal.operation}/${proposal.scope}: a digest binds the BYTES, not the ACT, and the same bytes `
      + 'settled under another operation are a different settlement')
  }
  if (approval.ledgerId !== proposal.ledgerId) {
    throw ownerRefusal(OWNER_REFUSE.LEDGER_MISMATCH,
      `the approval names ledger entry ${String(approval.ledgerId)} and the proposal is `
      + `${proposal.ledgerId}`)
  }
  // ── THE APPROVAL'S EXPIRY MUST **EQUAL** THE FROZEN PROPOSAL'S ───────────────────────────────────────
  //
  // **CODEX P2.** The check was `approval.expiresAt <= now`, which asks only whether the approval has passed.
  // An approval carrying a LATER expiry therefore settled a proposal whose own deadline had gone — the window
  // the owner read on the sheet was not the window the settlement used, and the difference was a field the
  // approval carries rather than a fact about the frozen bytes.
  //
  // **EQUALITY, NOT "NO LATER THAN".** An earlier expiry is a different act too: it says the owner's answer
  // lapses sooner than the proposal they answered about. The expiry is a property OF THE FROZEN PROPOSAL, and
  // the approval records it rather than choosing it.
  if (approval.expiresAt !== proposal.expiresAt) {
    throw ownerRefusal(OWNER_REFUSE.APPROVAL_EXPIRY_NOT_FROZEN,
      `the approval expires at ${String(approval.expiresAt)} and the frozen proposal expires at `
      + `${String(proposal.expiresAt)}. The approval records the window the owner read; it does not choose one`)
  }
  // ── AND THE PROPOSAL'S OWN DEADLINE IS ENFORCED HERE, INDEPENDENTLY ──────────────────────────────────
  //
  // Nothing above reads `now` against the PROPOSAL, only against the approval — so the two could disagree and
  // only one of them was ever consulted. **A proposal past its deadline is expired whatever approval is
  // presented**, and this check does not care what the approval says.
  if (!Number.isInteger(proposal.expiresAt) || now >= proposal.expiresAt) {
    throw ownerRefusal(OWNER_REFUSE.PROPOSAL_EXPIRED,
      `the frozen proposal expired at ${String(proposal.expiresAt)} and the clock is ${String(now)}, whatever `
      + 'the approval carries')
  }
  // **`APPROVAL_EXPIRED` IS NOW UNREACHABLE FROM HERE, AND THAT IS A CONSEQUENCE OF THE EQUALITY CHECK RATHER
  // THAN A LOSS.** With `approval.expiresAt === proposal.expiresAt` enforced above, the approval's expiry IS
  // the proposal's — so "the approval expired" and "the proposal expired" are one fact, and `PROPOSAL_EXPIRED`
  // is the check that reports it. **Keeping a second check that can never fire is what
  // `codex-uid-design.md:7` warns about**: a refusal that cannot be reached is a refusal nobody has tested, and
  // the person asking why their approval was refused is owed the fact about the PROPOSAL, which is the thing
  // whose deadline they read. The name is kept in `OWNER_REFUSE` so an older caller matching on it still
  // compiles, and it is documented as unreachable rather than left looking live.
  // EVERY CHECK PASSED. THE SPEND IS THE LAST THING THAT HAPPENS, and it happens exactly once.
  // **BOTH BY NONCE.** MEASURED: the second call passed `proposal.digest`, so the settle was recorded against
  // whatever the digest index pointed at — and after a resubmission of identical bytes that was a DIFFERENT
  // proposal's nonce. The approval names a nonce; the settle names the same one.
  // ── EVERYTHING THAT CAN REFUSE IS COMPUTED BEFORE ANYTHING IS SPENT (CODEX R10, FINDING 2) ────────
  //
  // **MEASURED: THE NONCE WAS SPENT AND THE PROPOSAL MARKED SETTLED, AND ONLY THEN WAS THE CEILING ASKED
  // FOR** — and `ceilingFor` THROWS for an unknown authority. **So a refusal consumed the approval**: the
  // caller received a failure while the proposal was already recorded against a spent nonce, and the
  // operator had neither a settlement nor an approval to retry.
  //
  // **A REFUSAL MUST LEAVE THE WORLD AS IT FOUND IT.** The order IS the fix: ask every question that can
  // refuse first, and spend only once nothing can. This is the same rule the checks above already follow —
  // they run before the spend — and the ceiling was simply added in the wrong place when the unknown-authority
  // refusal landed.
  //
  // WHICH AUTHORITY APPROVED IT TRAVELS WITH THE RESULT, because the two are not the same claim and a
  // screen that printed one ceiling line for both would be overstating the weaker one.
  const authority = approval.attendance ?? input.authority ?? 'console'
  // **THE UNKNOWN-AUTHORITY FALLBACK IS GONE** -- see `ceilingFor`. The verdict is gathered HERE, at
  // print time, rather than once at startup.
  const ceiling = ceilingFor(authority, separationVerdict(gatherSeparationFacts(input)))
  store.spend(approval.nonce, now)
  store.markSettled(approval.nonce, now)
  return Object.freeze({
    settled: true, digest: proposal.digest, ledgerId: proposal.ledgerId, authority, ceiling,
  })
}

/**
 * WHERE AN INDEPENDENT APPROVAL PLUGS IN LATER (codex-uid-design.md:11,13).
 *
 * The daemon does not care HOW the owner answered, only that an authority the agent cannot impersonate did.
 * This cut ships ONE implementation — `createConsoleApprover`, a CLI Peter runs as `aukora-owner` through
 * `sudo -u`, which the agent cannot do — and the slot is a function so a later one is a substitution and not
 * a rewrite:
 *
 *   phone / NIP-46   the phone displays the operation and signs an envelope carrying the bound digest,
 *                    nonce, scope and expiry; NIP-46 signs secp256k1 events and NOT the Ed25519 format, so
 *                    that needs a specified application approval event, not a re-used one
 *   Touch ID / SE    a fresh biometric-gated P-256 signature over the daemon's bound challenge, verified by
 *                    the daemon — never an "Touch ID succeeded" boolean, which is the same shell claim
 *   FIDO2            a fresh assertion bound to the proposal challenge with the expected credential, RP and
 *                    presence/verification flags
 *
 * EVERY ONE OF THEM ANSWERS THE SAME QUESTION — "do you approve THIS frozen proposal?" — and returns the
 * same bound record, so `authoriseSettlement` above needs no knowledge of which was used.
 *
 * @param {{ask: (proposal: Readonly<Record<string, unknown>>) => Promise<boolean>}} input
 * @returns {(proposal: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>}
 */
export function createApprovalChannel({ ask }) {
  return async proposal => {
    let approved = false
    try {
      approved = await ask(proposal)
    } catch (cause) {
      // **AN UNREACHABLE CONSOLE IS NOT THE OWNER DECLINING.** The refusal is identical — nothing settles — and
      // the code is `CONSOLE_UNREACHABLE` so that a caller, a court and a CI log can tell *"nobody was asked"*
      // from *"the owner said no".* **The old code made a missing console read as nine owner refusals.**
      throw ownerRefusal(OWNER_REFUSE.CONSOLE_UNREACHABLE,
        `the owner console could not be asked: ${String(cause?.message ?? cause)}`)
    }
    if (approved !== true) {
      // THE OWNER WAS ASKED AND ANSWERED. **This is the only path that may say `OWNER_DECLINED`.**
      throw ownerRefusal(OWNER_REFUSE.OWNER_DECLINED, 'the owner did not approve this proposal')
    }
    // THE BOUND RECORD, BUILT FROM THE PROPOSAL AND NOT FROM ANYTHING A CALLER SAID. Every field the
    // authoriser checks is copied off the frozen proposal here, so an approval cannot be widened in transit.
    return Object.freeze({
      digest: proposal.digest,
      operation: proposal.operation,
      scope: proposal.scope,
      ledgerId: proposal.ledgerId,
      nonce: proposal.nonce,
      expiresAt: proposal.expiresAt,
      answeredAt: Math.floor(Date.now() / 1000),
    })
  }
}
