/**
 * ATTENDANCE — A SECOND, DIFFERENT-PURPOSE SIGNATURE THAT SAYS A FINGER WAS ON THIS MAC.
 *
 * WHY THIS EXISTS. An outside reviewer read this project and wrote two sentences that are both true and
 * both fatal to the claim Peter wants to be able to make: "the owner key lives under the same OS user as
 * the agent — a procedure, not an isolation boundary", and "a signature records that a key signed; it does
 * not prove a person was at the keyboard." Nothing in this file makes either sentence false. What it does
 * is let AUKORA say one more true thing, and it prints exactly how much more.
 *
 * MEASURED FEASIBILITY, `~/aukora-private/se-spike`, 2026-09-24: an ad-hoc-signed helper CANNOT create a
 * Secure Enclave key — `errSecMissingEntitlement (-34018)` — because an SE key lives in the data-protection
 * keychain and needs an `application-identifier` / `keychain-access-groups` entitlement, which needs a Team
 * ID and a real signing identity. The SAME process created a SOFTWARE P-256 key without complaint, so the
 * refusal is the enclave and not keychain access. **This Mac has no signing identity at all**
 * (`security find-identity -v -p codesigning` -> 0 valid identities), so the SE path below is written,
 * courted against a fixture, and NOT SHIPPED until Peter buys one. The Team ID is a signing change only.
 *
 * ── WHERE THE TRUST COMES FROM: ENROLMENT, ONCE, IN FRONT OF THE OWNER ─────────────────────────────
 *
 * The undetectable case in the ceiling below says `keyType` is a label anyone can write. **THE ANSWER IS
 * NOT A BETTER LABEL; IT IS WHERE THE LABEL IS WRITTEN.** The attendance point is enrolled exactly once,
 * in an owner-witnessed ceremony: the helper creates the key inside the enclave and returns its public
 * point, the person approves THAT on the same one-bit sheet every approval uses, the machine key signs the
 * enrolment, and the enrolment is recorded in the record's history beside the succession lines.
 *
 * FROM THEN ON, every attendance signature that verifies under that enrolled point came from the one
 * private key only that enclave holds — **if the enrolment was genuine**. The residual trust is therefore
 * concentrated in ONE WITNESSED MOMENT rather than spread thin over every signature: a forger must be
 * present at enrolment, in front of the owner, on the machine, with the sheet showing the point being
 * enrolled. The question a verifier then answers is "was this point enrolled under the owner's hand",
 * which is a question about one recorded event rather than about every signature.
 *
 * THAT IS WHY ENROLMENT BELONGS IN THE RECORD'S HISTORY AND NOT A SIDE FILE: the record is where the
 * succession lines and the machine list live and what a second device reads, and an enrolment a verifier
 * cannot see is an enrolment nobody can rely on.
 *
 * ATTENDANCE IS A SEPARATE FACT FROM AUTHORITY, AND IT NEVER INVALIDATES AN APPROVAL. A missing attendance
 * signature does not make an approval bad; it makes the CLAIM weaker, and the claim is what a verifier
 * prints. If absence invalidated authority, a headless process, a CLI path, or a Mac with no enrolled
 * finger would lose the ability to approve at all — this lane would have traded a working custody path for
 * a badge. `attendanceClaimOf` is therefore the single place the claim is decided, and it is the function a
 * court mutates.
 *
 * NO NEW CURVE IMPLEMENTATION (AGENTS.md). P-256 verification is `node:crypto`, the same rule this lane
 * already follows for Ed25519: the SE's X9.63 point is wrapped in a fixed SPKI prefix and handed to
 * `createPublicKey`, and the DER signature to `verify(..., {dsaEncoding:'der'})`.
 */
import { createPublicKey, verify as nodeVerify } from 'node:crypto'

/**
 * ── **THE ATTENDANCE VOCABULARY, DECLARED ONCE (cohesion plan row 35)** ───────────────────────────────────
 *
 * The row: *"ATTENDANCE carries five meanings (`ceilings.py:94`, `aumlok ceilings.mjs:84`/`:195`/`:238`,
 * `attendance.mjs:152-…)."* **MEASURED AT HEAD, the word `ATTENDANCE:` is printed by three different organs with
 * three different values, and no file declared which values exist:**
 *
 *     13 sites   ATTENDANCE: reported-not-proven          scripts/composition/ceilings.py
 *      8 sites   ATTENDANCE: not-claimed-by-this-lane     plugins/aukora-aumlok/lib/ceilings.mjs
 *      2 sites   ATTENDANCE: not-claimed-by-this-window   scripts/face/approval-probe.mjs
 *
 * **THE THREE DO NOT CONTRADICT EACH OTHER — THEY ARE THREE STATES OF ONE AXIS**, which is what the row means by
 * one vocabulary: *what can this organ say about whether a person was present?* They read as contradictory only
 * because the same word introduces all three, so a reader sees **one field with three values and no declaration
 * of the field.** *A vocabulary that is never written down is a vocabulary that drifts by addition.*
 *
 * **THIS IS THE DECLARATION.** Every state has a name, every name has what it asserts, and **a court holds every
 * `ATTENDANCE:` literal in the tree to this set** — so adding a fourth state is a deliberate act in one file
 * rather than a string typed at a print site.
 *
 * WHY IT LIVES HERE RATHER THAN IN A SHARED PACKAGE: this module already owns the attendance axis — the key
 * types, the refusals, the per-platform ceiling texts and `ceilingLines` that print them. **AND A CROSS-PLUGIN
 * IMPORT IS FORBIDDEN BY THIS PLUGIN'S OWN RULE** (`aukora-aumlok.test.mjs:706`: every module in `lib/` imports
 * only `node:` builtins or its own siblings), so the vocabulary is *declared* here and *checked* by a court
 * rather than imported by the other organs. *The court is what makes it one vocabulary; an import would only
 * have made it one file.*
 */
export const ATTENDANCE_STATES = Object.freeze({
  /** This lane signs, and makes NO claim about a person: it cannot see one. */
  NOT_CLAIMED_BY_THIS_LANE: 'not-claimed-by-this-lane',
  /** A windowed producer signs, and likewise claims nothing about a person. */
  NOT_CLAIMED_BY_THIS_WINDOW: 'not-claimed-by-this-window',
  /** A receipt says a transition occurred and which key signed — which is never proof a person was present. */
  REPORTED_NOT_PROVEN: 'reported-not-proven',
  /** A Secure Enclave key signed and the enrolment requires a finger per signature. Presence, not identity. */
  BIOMETRIC_PRESENCE: 'biometric-user-presence',
  /** No attendance was offered at all, and the record says so rather than staying silent. */
  NONE: 'none',
})

/** Every short state word, for a court that holds the tree to this set. */
export const ATTENDANCE_STATE_WORDS = Object.freeze(Object.values(ATTENDANCE_STATES))

/** The key types a record may name. THE FIXTURE IS NOT AN SE KEY AND MUST NEVER BE READ AS ONE. */
export const ATTENDANCE_KEY_TYPES = Object.freeze({
  /** A Secure Enclave P-256 key. Non-exportable; `biometryCurrentSet` requires a finger per signature. */
  SECURE_ENCLAVE: 'p256-se',
  /**
   * A SOFTWARE P-256 key, for courts and rigs only. It is not in any enclave, its private half is readable
   * by the process that made it, and it proves NOTHING about presence. Named so plainly that no reader and
   * no screen can mistake it for the real thing.
   */
  SOFTWARE_FIXTURE: 'p256-software-fixture',
})

/** The four refusals, named. NONE of them refuses an operation on its own — see the header. */
export const ATTENDANCE_REFUSE = Object.freeze({
  /** This machine has no enrolled attendance key, so no presence could be asked for. */
  KEY_ABSENT: 'aumlok:attendance-key-absent',
  /** A finger was asked for and the person cancelled or failed the prompt. */
  REFUSED: 'aumlok:attendance-refused',
  /** No biometry on this machine, or no enclave to hold a key. */
  UNAVAILABLE: 'aumlok:attendance-unavailable',
  /** A signature was offered and it does not verify over the preimage. */
  NOT_VERIFIED: 'aumlok:attendance-not-verified',
})

/** The SPKI prefix that turns an X9.63 P-256 point (04 || X || Y) into something `node:crypto` reads. */
const P256_SPKI_PREFIX = Buffer.from(
  '3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex')

/**
 * THE CLAIM A VERIFIER MAY PRINT, from one approval's attendance. The ONLY place this is decided.
 *
 * THE ORDER OF THESE CHECKS IS THE PROTECTION. A presence claim requires: an attendance block, a key type
 * the record recognises, a signature over the SAME preimage, and that signature verifying. Anything less is
 * `none` — and `none` is not a failure, it is the absence of a claim.
 *
 * @param {unknown} attendance - the approval's attendance block, or undefined.
 * @param {Buffer} preimage - the bytes the machine key signed.
 * @param {Readonly<Record<string, unknown>>|null} [record] - the record, when the enrolled key must match.
 * @returns {Readonly<{claim: 'none'|'fixture'|'secure-enclave', present: boolean, reason: string|null}>}
 */
export function attendanceClaimOf(attendance, preimage, record = null) {
  const none = reason => Object.freeze({ claim: 'none', present: false, reason })
  if (attendance === undefined || attendance === null) return none(ATTENDANCE_REFUSE.KEY_ABSENT)
  if (typeof attendance !== 'object' || Array.isArray(attendance)) {
    return none(ATTENDANCE_REFUSE.NOT_VERIFIED)
  }
  const keyType = attendance.keyType
  if (keyType !== ATTENDANCE_KEY_TYPES.SECURE_ENCLAVE
    && keyType !== ATTENDANCE_KEY_TYPES.SOFTWARE_FIXTURE) {
    return none(ATTENDANCE_REFUSE.KEY_ABSENT)
  }
  if (typeof attendance.rawPointHex !== 'string' || !/^04[0-9a-f]{128}$/u.test(attendance.rawPointHex)) {
    return none(ATTENDANCE_REFUSE.NOT_VERIFIED)
  }
  if (typeof attendance.signatureHex !== 'string' || !/^[0-9a-f]+$/u.test(attendance.signatureHex)) {
    return none(ATTENDANCE_REFUSE.NOT_VERIFIED)
  }
  // THE ENROLLED KEY IS THE ONE THAT ANSWERS. A record that names an attendance key, and an approval
  // carrying a DIFFERENT one, is a signature by a key this identity never enrolled — the same reading the
  // binding takes of a machine key the record does not list.
  if (record !== null && record !== undefined) {
    const enrolled = record?.attendanceKey
    if (enrolled === undefined || enrolled === null) return none(ATTENDANCE_REFUSE.KEY_ABSENT)
    if (enrolled.keyType !== keyType) return none(ATTENDANCE_REFUSE.NOT_VERIFIED)
    if (enrolled.rawPointHex !== attendance.rawPointHex) return none(ATTENDANCE_REFUSE.NOT_VERIFIED)
  }
  if (!p256Verifies(attendance.rawPointHex, preimage, attendance.signatureHex)) {
    return none(ATTENDANCE_REFUSE.NOT_VERIFIED)
  }
  // VERIFIED. THE TYPE DECIDES WHICH TRUE SENTENCE MAY BE SAID, and a fixture is never an enclave.
  return Object.freeze({
    claim: keyType === ATTENDANCE_KEY_TYPES.SECURE_ENCLAVE ? 'secure-enclave' : 'fixture',
    present: true,
    reason: null,
  })
}

/**
 * Verify one P-256 ECDSA signature over a preimage, through `node:crypto`.
 * @param {string} rawPointHex - the X9.63 uncompressed public point, `04 || X || Y`.
 * @param {Buffer} preimage - the signed bytes.
 * @param {string} signatureHex - the DER signature.
 * @returns {boolean} whether it verifies.
 */
export function p256Verifies(rawPointHex, preimage, signatureHex) {
  try {
    const spki = Buffer.concat([P256_SPKI_PREFIX, Buffer.from(rawPointHex, 'hex')])
    const key = createPublicKey({ key: spki, format: 'der', type: 'spki' })
    // THE PREIMAGE IS HASHED BY node:crypto (`'sha256'`), matching the SE's
    // `.ecdsaSignatureMessageX962SHA256` — the same construction the spike proved end to end.
    return nodeVerify('sha256', preimage, { key, dsaEncoding: 'der' }, Buffer.from(signatureHex, 'hex'))
  } catch {
    return false
  }
}

/**
 * THE CEILING, PRINTED EXACTLY. These lines are the whole point of the feature: they are what a reviewer
 * can check, and they are written to be UNIMPROVABLE BY PARAPHRASE. A screen that rewords them upward is
 * making a claim this code cannot support, so `ceilingLines` hands back the exact strings and callers are
 * expected to print them verbatim — `tests/aukora-attendance.test.mjs` asserts they are unchanged.
 */
export const ATTENDANCE_CEILING = Object.freeze({
  'secure-enclave': Object.freeze([
    'ATTENDANCE: biometric user presence on this Mac\'s Secure Enclave.',
    'An enrolled finger touched this Mac\'s sensor at the moment of signing, and the key that signed cannot be read or copied by any process.',
    'It does NOT prove that a person was at the keyboard: a finger is not a person, biometryCurrentSet invalidates on re-enrolment and not on coercion, the enclave signs the digest the shell hands it, a person can be farmed for reflexive touches, and the attestation is per-Mac rather than per-person.',
    // THE FOURTH LIMITATION, AND THIS COURT FOUND IT BY TRYING TO ASSERT THE OPPOSITE. See the arm
    // "A SOFTWARE KEY LABELLED AS AN ENCLAVE ONE IS UNDETECTABLE": `keyType` is a LABEL, the signature
    // carries no proof of WHERE the key lives, and nothing in this layer can tell an enclave P-256 key
    // from a software one that claims to be. Enclave residency is an ATTESTATION BY WHOEVER ENROLLED THE
    // KEY, and `biometryCurrentSet` is enforced by the OS at signing time rather than proved in the bytes.
    'WHERE THE TRUST IS: enrolment, once. The point is enrolled in an owner-witnessed ceremony, approved on this same sheet, signed by the machine key and recorded in the record history — so everything after it rests on that one witnessed moment rather than on every signature, and the question a verifier answers is "was this point enrolled under the owner\'s hand".',
    'The key type is an ATTESTATION, not a proof: a software key that both enrols and signs as `p256-se` is undetectable here, because a signature does not say where its key lives. What makes a real one meaningful is that the OS enforced the access control when it signed — visible to the person at the prompt, invisible in the signature.',
  ]),
  fixture: Object.freeze([
    'ATTENDANCE: NONE — this is a SOFTWARE FIXTURE key, not a Secure Enclave key.',
    'It was created by a court or a rig, its private half is readable by the process that made it, and it proves nothing whatsoever about who was present.',
  ]),
  none: Object.freeze([
    'ATTENDANCE: none recorded.',
    'This approval carries no presence claim. That is not a defect in the approval: authority and attendance are separate facts, and only the second one is missing.',
  ]),
})

/**
 * The exact lines to print for one claim.
 * @param {'none'|'fixture'|'secure-enclave'} claim - what `attendanceClaimOf` decided.
 * @returns {readonly string[]} the lines, verbatim.
 */
export function ceilingLines(claim) {
  return ATTENDANCE_CEILING[claim] ?? ATTENDANCE_CEILING.none
}

/**
 * WHAT THE OPERATING SYSTEM'S OWN DIALOG SAYS, so the prompt names what is being signed.
 *
 * HOW LITTLE THIS NARROWS CEILING #3, SAID PLAINLY: the shell still hands the enclave a digest, and the
 * enclave still signs whatever it is given. Putting the operation's summary and digest prefix in the OS
 * dialog means a person who READS the prompt sees something about the operation — which is strictly more
 * than a prompt that says "AUKORA wants to sign something". It does NOT make the prompt authoritative:
 * the summary is composed by the same shell that composes the sheet, a person who does not read it learns
 * nothing, and a same-UID process can still ask for a signature over a digest of its choosing. It narrows
 * the gap between "a finger touched" and "a person was shown what they authorised" — it does not close it.
 *
 * @param {{summary: string, digestPrefix: string}} input - the operation in a few words, and the digest.
 * @returns {string} the `localizedReason` for the SE key's access control.
 */
export function attendanceLocalizedReason(input) {
  const summary = String(input?.summary ?? '').trim().slice(0, 120)
  const digest = String(input?.digestPrefix ?? '').trim().slice(0, 16)
  return `AUKORA: approve ${summary} (${digest}…)`
}

/** The attendance block one approval carries. Built here so two callers cannot disagree about its shape. */
export function attendanceBlock({ keyType, rawPointHex, signatureHex, signedAt }) {
  return Object.freeze({
    keyType,
    rawPointHex,
    signatureHex,
    ...(signedAt === undefined ? {} : { signedAt }),
  })
}
