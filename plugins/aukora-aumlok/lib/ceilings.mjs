/**
 * The ceilings this lane prints, and the one place they are spelled.
 *
 * WHY THEY ARE CODE AND NOT A PARAGRAPH. This is `scripts/composition/ceilings.py`'s
 * argument, applied to identity. A limit that is not printed beside a result reads
 * as a claim that the limit does not apply. So the ceilings are a list, every
 * human-facing path in this lane emits them, and the court asserts they appear on
 * the paths that ACCEPT as well as the paths that REFUSE — a refusal that drops its
 * ceilings is just as misleading as an acceptance that does.
 *
 * THE CEILINGS, AND WHAT EACH ONE DENIES:
 *
 *   AUMLOK_SUBJECT_IS_A_NAME
 *       The subject is `sha256(genesis)`. It is a stable name for an identity
 *       record. It is not a person, not attendance, not consent, and not a
 *       permission. A matching name — or a matching DID — never authorizes.
 *
 *   CONTROL_SIGNATURES_UNVERIFIED
 *       The projection path re-derives the head's digest and rules but does not
 *       verify the signatures that authorized the head. A digest proves the bytes
 *       are these bytes; it does not prove anyone approved them. Only
 *       `verifyAndApplyRootControlPromotion` verifies, and it refuses without the
 *       primitives to finish the job.
 *
 *   ED25519_POINT_UNVALIDATED
 *       Deep rejects small-order and torsion Ed25519 public keys through
 *       `@noble/curves`. This closure carries no Ed25519 point validation —
 *       `lib/vendor/noble-ml-dsa/` vendors only the `@noble/curves` modules ML-DSA's
 *       FFT needs (`utils.js`, `abstract/fft.js`), not `ed25519.js` — and AGENTS.md
 *       forbids a new curve implementation, so parsing here checks length and hex
 *       only. That is a SUPERSET of Deep's accepted inputs and it is fail-open, so
 *       it is never allowed to reach a signature verdict: promotion verification
 *       refuses by name unless a point validator is supplied.
 *
 *   ML_DSA_65_UNMEASURED
 *       The root-control suite is hybrid (`aumlok-ed25519-ml-dsa-65-v1`). This
 *       closure now DOES carry an ML-DSA-65 implementation — vendored
 *       `@noble/post-quantum@0.6.1`, measured and pinned in
 *       `lib/vendor/noble-ml-dsa/` — and BINDING PROVES the registered pair
 *       corresponds and round-trips before it writes (`lib/pq-generator.mjs`).
 *       What is NOT established, and what this ceiling still denies, is that the
 *       implementation IS FIPS 204 ML-DSA-65: this lane holds no known-answer
 *       vector from the standard and no second, independent ML-DSA implementation
 *       on this host, and it fetched neither. Defect-freedom of the vendored
 *       primitives is likewise not established. Separately, a promotion still
 *       refuses `aumlok:ml-dsa-65-verifier-unavailable` unless a verifier
 *       capability is supplied, because `nodeCryptoVerifierCapabilities()`
 *       supplies none. No hybrid control rotation is claimed as verified here.
 *
 *   SAME_UID_POSIX_MODE_ONLY
 *       The custody class is Deep's own string: `same-uid-posix-mode-only`. Owner,
 *       mode and link count are checked; ACLs are not, and the reader shares the
 *       UID with everything else in this process. This is not key custody and not
 *       isolation.
 *
 *   SUCCESSION_UNMEASURED
 *       UNOWNABLE-CORE.md §5's observer-succession court is a separate
 *       prerequisite. Its verdict vocabulary is SURVIVES / FAILS / INCONCLUSIVE /
 *       UNMEASURED and its current status is UNMEASURED. Nothing here moves it.
 *
 *   NO_IDENTITY_BINDING
 *       UNOWNABLE-CORE.md §13: an identity binding is not a milestone until the
 *       observer-succession/no-sovereign-operator court is executed and published.
 *       This lane never emits `identityBound`, and no ceremony, hardware custody or
 *       succession claim is made or implied by anything it prints.
 *
 * @module @aukora/dsh-plugin-aumlok/ceilings
 */
import { ATTENDANCE_STATES } from './attendance.mjs'


/** The ceiling names, printed in this order, in this exact spelling. */
export const CEILINGS = Object.freeze([
  'AUMLOK_SUBJECT_IS_A_NAME',
  'CONTROL_SIGNATURES_UNVERIFIED',
  'ED25519_POINT_UNVALIDATED',
  'ML_DSA_65_UNMEASURED',
  'SAME_UID_POSIX_MODE_ONLY',
  'SUCCESSION_UNMEASURED',
  'NO_IDENTITY_BINDING',
  'ROOT_KEY_OFFLINE_GUESSABLE',
  'SIGNER_NOT_PRESENCE_BOUND',
])

/**
 * **The word this lane prints about attendance — DECLARED IN THE VOCABULARY, NOT TYPED HERE (row 35).**
 *
 * MEASURED AT HEAD: this literal and `scripts/composition/ceilings.py`'s `"reported-not-proven"` were two states
 * of one axis, printed under one word, with **no file declaring which states exist**. The set is declared in
 * `attendance.mjs` now and a court holds every `ATTENDANCE:` literal in the tree to it — so this line reads the
 * declaration rather than restating one of its members.
 */
export const ATTENDANCE = ATTENDANCE_STATES.NOT_CLAIMED_BY_THIS_LANE

/** The ceiling `lines()` prints when the caller's Ed25519 point validator IS supplied. */
export const POINT_VALIDATED_CEILING = 'ED25519_POINT_UNVALIDATED'

/** One line of explanatory text per ceiling. */
export const CEILING_TEXTS = Object.freeze({
  AUMLOK_SUBJECT_IS_A_NAME:
    'the subject is sha256 over the immutable genesis record — a stable name, not a person, not attendance, '
    + 'not consent; a matching name or DID never authorizes',
  CONTROL_SIGNATURES_UNVERIFIED:
    'this path re-derives the control-head digest and applies the transition rules but verifies no signature; '
    + 'a digest proves the bytes are these bytes, not that anyone approved them',
  ED25519_POINT_UNVALIDATED:
    'Ed25519 public keys are checked for length and hex only, not for small-order or torsion points '
    + '(Deep uses @noble/curves for that, and this closure vendors only the @noble/curves modules ML-DSA '
    + 'needs, not ed25519.js); this is a fail-open superset, so promotion verification refuses by name '
    + 'unless a point validator is supplied',
  ML_DSA_65_UNMEASURED:
    'the root-control suite is hybrid ed25519 + ML-DSA-65. The ML-DSA-65 implementation IS present here — '
    + 'vendored noble-post-quantum@0.6.1 — and BINDING PROVES the registered pair corresponds and '
    + 'round-trips before it writes. What is NOT established is that the implementation IS FIPS 204 '
    + 'ML-DSA-65: no known-answer vector from the standard and no second, independent implementation exist '
    + 'on this host and none was fetched, so defect-freedom and standard conformance are assumptions about '
    + 'the vendored library, not measurements. Separately, a promotion still refuses '
    + 'aumlok:ml-dsa-65-verifier-unavailable unless a verifier capability is supplied, because '
    + 'nodeCryptoVerifierCapabilities() supplies none',
  SAME_UID_POSIX_MODE_ONLY:
    'custody is Deep\'s same-uid-posix-mode-only class: owner, mode and link count are checked, ACLs are not, '
    + 'and the reader shares the UID — this is not key custody and not isolation. The signer\'s socket and its '
    + 'IMMEDIATE parent directory are measured the same way (owner, and no group or other permission bits) '
    + 'before the channel is announced; a writable grandparent, ACLs and the rest of the ancestor chain are '
    + 'not measured, so this bounds the channel\'s custody and does not establish it',
  // ── **PETER DECIDED TO DISCLOSE THIS NOW AND REDESIGN IT AFTER THE SHARE (AUMLOK-113)** ────────────────
  //
  // REVIEWER ROW 8. The root key is derived from the seven acrostic words plus a handle that is PUBLIC, and the
  // pair is worth about 34.14 bits (`themed-entropy.mjs:23-33` sets that floor; the 64-bit floor was retired).
  // **A scrypt work factor of about one second per guess is a real cost and not a large one:** 2^34 guesses at
  // 1 s each is roughly 545 core-years, **and the search parallelises perfectly — it is a dictionary, not a
  // password, and every guess is independent.**
  //
  // **THE DESIGN LAW SAYS THE PHRASE NEVER DERIVES THE KEY, AND THIS IS WHERE IT DOES.** `derive-v3.mjs` takes
  // the words and the handle and scrypts them into the root, so the words are not a presence check over a key
  // held elsewhere — they ARE the key's whole secret. **Anyone who photographs the phrase, or finds it in a
  // backup, rebuilds the root offline, on their own machine, with no access to this one.**
  //
  // **THE ACROSTIC STAYS**, by Peter's ruling: seven typeable tokens are the property the ceremony exists for,
  // and what changes is WHAT THE WORDS RELEASE rather than how they read. That redesign — the seven tokens
  // gating a random root, or a secret of at least 128 bits kept on paper or in the device — is LATER. **Until it
  // lands, this ceiling is the number**, which is why it is disclosed rather than deferred.
  //
  // **AND THE WORDS ABOVE WERE CHOSEN AGAINST THIS FILE'S OWN BAN (AUMLOK-115).** The first version phrased the
  // redesign in the retired v2 vocabulary, and `tests/aukora-aumlok-v3-no-v2.test.mjs` went red on all three
  // hits — **correctly: one of them was the v2 concept written out in the exact spelling the ban exists to
  // catch, inside a comment only ever meant to describe a redesign.** A ban is not satisfied by meaning it
  // differently; **the spelling is what carries the concept into the next reader's head.**
  //
  // **AND THE FIRST REPAIR OF THIS COMMENT WAS ITSELF A HIT**, because it quoted the banned spelling in order to
  // explain the ban — *an instrument that writes down the words it hunts is one more place those words live*,
  // which is this very file's rule three paragraphs up. The explanation now names the concept and not the
  // spelling, and the court is what said so.
  // ── **THE OWNER'S SIGNING SEED DOES NOT REQUIRE THE OWNER (AUMLOK-115, SECURITY)** ──────────────────────
  //
  // MEASURED, NOT REPEATED. `record-v3.mjs` keeps the machine seed two ways and **NEITHER ASKS THE PERSON FOR
  // ANYTHING.** Demonstrated with disposable material rather than argued:
  //
  //   * **THE FILE CUSTODIAN, WHICH IS THE DEFAULT** (`DEFAULT_CUSTODIAN = 'file'`): a `0600` file under the
  //     owner directory. Read straight through by a child process, no prompt. Measured.
  //   * **THE KEYCHAIN CUSTODIAN:** created as `security add-generic-password -U -a … -s … -w …` **WITH NO
  //     `-T` AND NO `-A`** (`record-v3.mjs:261-264`), and read back as `security find-generic-password … -w`
  //     (`:287`). **A different process read the value with no prompt. Measured, then removed.**
  //
  // **SO `signed` PROVES ONLY THAT A SAME-UID PROCESS RAN.** Not that the owner was present, not that a person
  // saw the thing signed, and not that a person was awake. *This lane already prints `OWNER_KEY_SAME_UID` and
  // `ATTENDANCE_REPORTED_NOT_PROVEN`; this is the third leg of the same sentence* — those two say the signer
  // shares the uid and attendance is not proven, **and this one says WHY THE SEED IS AVAILABLE AT ALL.**
  //
  // **UNTIL A PRESENCE-BOUND CUSTODY LANDS, THIS IS THE NUMBER.** The design is written and spiked in
  // `aumlok-private/reviews/presence-bound-signer-proposal.md`; **it changes the live key and the binding, so
  // PETER DECIDES** and nothing here has been switched over.
  SIGNER_NOT_PRESENCE_BOUND:
    'the machine signing seed needs no person: the file custodian (the DEFAULT) is a 0600 file, and the keychain '
    + 'item is created without -T, so a same-uid process reads either with NO PROMPT. MEASURED with disposable '
    + 'material. A signature therefore proves a same-uid process ran, not that the owner was present. '
    + 'A presence-bound custody is designed and spiked; switching to it changes the live key and the binding, so '
    + 'it is the owner\'s call',
  ROOT_KEY_OFFLINE_GUESSABLE:
    'the root key is derived from the seven words PLUS A PUBLIC HANDLE: about 34.14 bits, public salt, about '
    + '1 second per guess with scrypt. 2^34 guesses is roughly 545 core-years and the search PARALLELISES, so '
    + 'the phrase is the whole secret: whoever has it rebuilds the root OFFLINE, with no access to this '
    + 'machine. The acrostic stays; what it unlocks is being redesigned',
  SUCCESSION_UNMEASURED:
    'the observer-succession court (UNOWNABLE-CORE.md section 5) is a separate prerequisite and is UNMEASURED',
  NO_IDENTITY_BINDING:
    'no identity binding is claimed here in the form the gate names, and no ceremony, hardware custody or '
    + 'succession claim is made or implied (UNOWNABLE-CORE.md section 13)',
})

/**
 * The ceilings as printable lines.
 * @param {{verbose?: boolean, omit?: readonly string[]}} [options] - `verbose` adds the explanatory text a human reads.
 * @returns {string[]} printable lines, always ending with the attendance word.
 */
export function ceilingLines(options = {}) {
  const omit = new Set(options.omit ?? [])
  const out = []
  for (const name of CEILINGS) {
    if (omit.has(name)) continue
    out.push(`CEILING: ${name}`)
    if (options.verbose === true) out.push(`         ${CEILING_TEXTS[name]}`)
  }
  out.push(`ATTENDANCE: ${ATTENDANCE}`)
  return out
}

/**
 * Write the ceilings to a sink.
 * @param {{verbose?: boolean, omit?: readonly string[], write?: (line: string) => void}} [options] - sink and shape.
 * @returns {void}
 */
export function printCeilings(options = {}) {
  const write = options.write ?? (line => { process.stdout.write(`${line}\n`) })
  for (const line of ceilingLines(options)) write(line)
}

/**
 * The D2 approval status lines, printed beside every owner signature.
 *
 * These are Genesis plan D2's own tokens, each rendered with its HONEST value
 * rather than as a bare assertion. D2 says to print `SIGNER_DEVICE_TRUSTED`;
 * printing that token as though the device were trusted would be a claim nothing in
 * this lane measured, so it is printed as `not-established` with the reason. The
 * same applies to the two `true` values — they are true statements about what is
 * *not* claimed. `OWNER_KEY_SIGNED` is printed as the condition under which it is
 * earned, because a line that says "signed" before verification is exactly the
 * confusion this lane exists to prevent.
 *
 * `OWNER_KEY_SAME_UID` retires only when a scoped court establishes that the private
 * key is unreadable by the broker's uid (D3). Process separation alone does not
 * remove it: the two processes share this uid.
 * @returns {string[]} printable status lines.
 */
export function signerCeilingLines() {
  return [
    'OWNER_KEY_SIGNED: earned only after the broker verified the signature under the registered key',
    'OWNER_KEY_SAME_UID: true — the signer and the broker share this uid; a second process is not a uid boundary',
    'SIGNER_DEVICE_TRUSTED: not-established — no platform custody measurement exists in this brick (D3)',
    // **THE THIRD LEG OF THE SAME SENTENCE (AUMLOK-115).** `OWNER_KEY_SAME_UID` says the signer shares the uid;
    // `ATTENDANCE_REPORTED_NOT_PROVEN` says a signature never proves a person attended. **THIS SAYS WHY: the
    // seed is available to any same-uid process with no prompt at all**, so "signed" is a statement about a
    // process and never about a person.
    'SIGNER_NOT_PRESENCE_BOUND: true — the seed is a 0600 file by DEFAULT and the keychain item is created '
    + 'without -T, so ANY same-uid process reads it with no prompt; a signature proves a process ran, not that '
    + 'the owner was present',
    'ATTENDANCE_REPORTED_NOT_PROVEN: true — a signature proves a key signed, never that a person attended',
    'SUCCESSION_UNMEASURED: true — the observer-succession court is a separate prerequisite',
    'NO_IDENTITY_BINDING: true — no identity binding is earned by an approval',
  ]
}

/**
 * **THE ONE SENTENCE EVERY SIGNING PATH PRINTS, SO THE THREE CANNOT DRIFT (AUMLOK-115, SECURITY).**
 *
 * MEASURED: the file custodian (the DEFAULT) is a `0600` file and the keychain item is created without `-T`, so
 * **any same-uid process reads the seed with no prompt.** A signing path that does not say so is reporting a
 * signature as though a person were involved.
 *
 * Kept as a function rather than three literals because three copies of a sentence about a security property is
 * three places for it to become untrue — and the court asserts THIS string on every path.
 * @returns {string} the line, without a trailing newline.
 */
export function presenceCeilingLine() {
  return 'CEILING: SIGNER_NOT_PRESENCE_BOUND — signing needs no person: the seed is a 0600 file by DEFAULT and '
    + 'the keychain item is created without -T, so any same-uid process reads it with NO PROMPT. A signature '
    + 'proves a same-uid process ran, not that the owner was present.'
}

/**
 * Say the presence ceiling on a signing path, once.
 * @param {{write?: (line: string) => void}} [options] - sink.
 * @returns {void}
 */
export function printPresenceCeiling(options = {}) {
  const write = options.write ?? (line => { process.stdout.write(`${line}\n`) })
  write(presenceCeilingLine())
}

/**
 * Write the D2 approval status lines to a sink.
 * @param {{write?: (line: string) => void}} [options] - sink.
 * @returns {void}
 */
export function printSignerCeilings(options = {}) {
  const write = options.write ?? (line => { process.stdout.write(`${line}\n`) })
  for (const line of signerCeilingLines()) write(line)
}

