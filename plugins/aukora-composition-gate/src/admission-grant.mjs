/**
 * ADMISSION GRANTS — the pilot's approval slot, filled by the owner daemon's own key.
 *
 * WHAT CHANGES. Until now the recorded artifact carried `approval.state = 'unimplemented'`: the digest
 * said what the bytes WERE and nothing said who approved them. This module is the other half. The daemon
 * freezes the canonical artifact manifest as a proposal of operation `admit-plugin-artifact`, the owner
 * approves it (console or phone), and the daemon signs an ADMISSION GRANT over the bound fields with the
 * key it holds in root-owned state. The gate admits the pilot only when that grant verifies under the
 * DAEMON PUBLIC KEY PINNED AT INSTALL and names the artifact digest that was actually recorded.
 *
 * WHY Ed25519 AND `node:crypto` HERE, WHEN THE PHONE PATH DELIBERATELY DID NOT. The phone signs a Nostr
 * event, so it needs BIP-340 — which `node:crypto` does not have, and the near-miss (ECDSA over
 * secp256k1, verified happily) is the trap `identity.mjs:8` records. THIS IS A DIFFERENT KEY WITH A
 * DIFFERENT JOB: the daemon's own Ed25519 key, signing its own envelope, never a Nostr event. Ed25519 is
 * in `node:crypto` and is the right tool for it; reaching for the vendored Schnorr here would be the
 * mirror-image mistake. AGENTS.md's rule — no new curve implementation — is satisfied by both, for
 * different reasons.
 *
 * WHERE THE PIN COMES FROM, AND WHY THAT IS THE WHOLE DESIGN. The daemon's public key is read from the
 * path the INSTALL wrote, under `/Library/Application Support/AUKORA-Owner/` — root-owned. It is NEVER
 * read from agent-writable state, because a pin the agent can rewrite is not a pin, and a grant verified
 * against a key the agent supplied is the agent approving itself.
 */
import { createPublicKey, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { digestOf } from './artifact.mjs'
// AUMLOK'S ENVELOPE HELPERS, IMPORTED RATHER THAN RE-IMPLEMENTED. The daemon freezes the envelope and
// signs over it; this side must compute the SAME digest from the SAME canonical bytes, and two
// implementations of "canonical" is exactly how a signature verifies on one side and not the other. If his
// canonicalisation changes, this side follows automatically or breaks loudly — both better than agreeing
// by coincidence.
import { canonicalEnvelope, envelopeOf } from '../../aukora-owner-daemon/lib/binding.mjs'

/** The operation a single-artifact approval is a proposal OF. */
export const ADMIT_OPERATION = 'admit-plugin-artifact'

/**
 * The operation a WHOLE-SET approval is a proposal OF.
 *
 * COORDINATED WITH AUMLOK: the daemon signs set grants with the same machinery as artifact grants, so
 * this is a second operation NAME over the same preimage shape rather than a second protocol. If he
 * names it differently, this constant is the only thing that changes.
 */
export const ADMIT_SET_OPERATION = 'admit-plugin-set'

/** Every way an admission grant can be refused, by name. */
export const GRANT_REFUSE = Object.freeze({
  /** No grant was presented for an artifact that requires one. */
  GRANT_ABSENT: 'grant-absent',
  /** The grant is malformed, or its signature does not verify under the pinned key. */
  GRANT_INVALID: 'grant-invalid',
  /** The grant is genuine and names a different artifact. */
  GRANT_FOR_OTHER_ARTIFACT: 'grant-for-other-artifact',
  // ── **THE TWO CHECKS THIS FUNCTION DID NOT MAKE (Codex, plan section 8; row 185-232)** ────────────────
  //
  // MEASURED at HEAD: `approvedAt` was carried into the verified grant and **never compared to a clock**, and
  // `nonce` was carried out and **never checked against anything**. So a genuine grant was accepted with no
  // bound on when it was made and no bound on how many times it was used — *a signature that says WHO approved,
  // with nothing to say WHEN or HOW OFTEN*, which is the difference between an approval and a standing permit.
  //
  // **THEY ARE SEPARATE CODES ON PURPOSE.** A stale grant and a replayed one are different facts about different
  // parties — the first is a delay, the second is a second use — and a single "invalid" would send a reader to
  // the wrong one.
  /** The grant is genuine, its window has closed. */
  GRANT_EXPIRED: 'grant-expired',
  /** The grant is genuine and its timestamp is in the future, so it was not made when it claims. */
  GRANT_NOT_YET_VALID: 'grant-not-yet-valid',
  /** The grant is genuine and its nonce has already been consumed — a replay. */
  GRANT_NONCE_REUSED: 'grant-nonce-reused',
  /** No daemon public key is pinned, so nothing can establish who approved anything. */
  DAEMON_KEY_UNPINNED: 'daemon-key-unpinned',
  /**
   * AN OWNER DAEMON IS INSTALLED AND NO GRANT WAS PRESENTED.
   *
   * This is the fallback the whole cut forbids. While no daemon exists, admitting the pilot on its
   * recorded digest is the honest weaker state and says so in its ceiling. Once one IS installed, the
   * daemon is the authority that can approve an artifact, and admitting on a digest alone would be the
   * gate quietly continuing to trust itself after the thing that could have vouched for it arrived.
   */
  GRANT_REQUIRED: 'grant-required-when-owner-present',
  /** The plugin's artifact digest is not in the owner-approved set. */
  PLUGIN_NOT_IN_SET: 'plugin-not-in-set',
  /** The plugin IS in the set by id, and its bytes are not the bytes that were approved. */
  PLUGIN_BYTES_CHANGED: 'plugin-bytes-changed',
})

const refuse = (code, detail) => Object.assign(new Error(detail), { code })

/**
 * EVERY STRING FIELD OF A PREIMAGE, CHECKED BEFORE IT IS JOINED.
 *
 * THE DEFECT THIS CLOSES, AND IT IS FIELD SMUGGLING RATHER THAN TIDINESS. The preimage is a set of
 * `name value` lines joined by `\n`. If any VALUE may itself contain `\n`, then two DIFFERENT field sets
 * produce THE SAME BYTES — `release "a\nnonce b"` and `release "a"` + `nonce "b"` are indistinguishable
 * once joined — so one signature would verify for two different approvals. A control character is the
 * carrier, so the rule is: no control characters at all, in any field, on BOTH the signing and the
 * verifying side. Refusing only on one side would leave the other able to PRODUCE the ambiguity.
 *
 * `version` IS REQUIRED TO BE EXACTLY 1, checked here rather than trusted: the version is the only field
 * that says which preimage SHAPE these bytes are, and a signature over an unstated shape is a signature
 * over whatever the reader assumes.
 */
function assertPreimageFields(fields) {
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value !== 'string') continue
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/u.test(value)) {
      throw refuse(GRANT_REFUSE.GRANT_INVALID,
        `the ${name} field contains a control character. The preimage is newline-joined, so a value able to `
        + 'carry a newline lets two different field sets produce the same bytes and one signature verify '
        + 'for two different approvals')
    }
  }
  if (fields.version !== undefined && fields.version !== 1) {
    throw refuse(GRANT_REFUSE.GRANT_INVALID,
      `the grant declares version ${String(fields.version)} and this verifier knows version 1`)
  }
  return true
}
const HEX64 = /^[0-9a-f]{64}$/u
const HEX128 = /^[0-9a-f]{128}$/u

/**
 * THE PREIMAGE THE DAEMON SIGNS, and every field is in it for a reason.
 *
 * `authority` is included so a grant can say WHICH surface approved it — `console` or `phone` — and so
 * that changing it invalidates the signature. The ceiling printed with the settlement is chosen from it
 * rather than guessed, because "an owner-uid console answer" and "a pinned-signer phone approval" earn
 * genuinely different claims and collapsing them would overstate the weaker one.
 *
 * **`envelopeDigest` IS IN THIS LIST NOW, AND IT WAS MISSING (Codex, plan section 8).** The preimage below has
 * always included it — this docstring simply did not name it, so a reader trusting the documentation would not
 * know that the envelope digest is BOUND BY THE SIGNATURE. *An incomplete list of signed fields is a list that
 * understates what the owner's click covers*, and understating it is the direction that matters.
 *
 * @param {{operation: string, envelopeDigest: string, artifactDigest: string, release: string, nonce: string, approvedAt: number, authority: string}} parts
 * @returns {string} the canonical bytes to sign.
 */
export function admissionGrantPreimage(parts) {
  assertPreimageFields({ ...parts, version: parts.version ?? 1 })
  return [
    'aukora:plugin-artifact-admission:v1',
    `operation ${parts.operation}`,
    `envelopeDigest ${parts.envelopeDigest}`,
    `artifactDigest ${parts.artifactDigest}`,
    `release ${parts.release}`,
    `nonce ${parts.nonce}`,
    `approvedAt ${String(parts.approvedAt)}`,
    `authority ${parts.authority}`,
  ].join('\n')
}

/**
 * Sign an admission grant. THE DAEMON'S HALF, and it exists here so a court can produce one with a
 * fixture key; the real daemon does the same thing with the key in its own root-owned directory.
 *
 * @param {object} input - the bound fields plus the daemon's Ed25519 private key (PEM or KeyObject).
 * @returns {Readonly<object>} the grant.
 */
export function signAdmissionGrant(input) {
  const fields = {
    operation: input.operation,
    envelopeDigest: input.envelopeDigest,
    artifactDigest: input.artifactDigest,
    release: input.release,
    nonce: input.nonce,
    approvedAt: input.approvedAt,
    authority: input.authority,
  }
  // `null` IS THE ALGORITHM FOR ED25519, and it is not a placeholder: Ed25519 hashes internally, so
  // passing a digest name here is an error rather than a choice. That is also why this key is not the
  // Nostr one — a Nostr event would need BIP-340, which node:crypto does not have at all.
  assertPreimageFields({ ...fields, version: 1 })
  const signature = cryptoSign(null, Buffer.from(admissionGrantPreimage(fields), 'utf8'), input.privateKey).toString('hex')
  return Object.freeze({ ...fields, version: 1, signature })
}

/**
 * Read the DAEMON PUBLIC KEY the install pinned.
 *
 * A MISSING PIN IS ITS OWN REFUSAL, not a missing grant: "no daemon key is pinned, so nothing here can
 * establish who approved anything" is a different fact from "no grant was presented", and a caller that
 * collapsed them would report the second when the first is true.
 *
 * @param {string} pubkeyPath - the root-owned path the install wrote.
 * @returns {string} the pinned public key as PEM.
 * @throws {Error} `daemon-key-unpinned`.
 */
export function readPinnedDaemonKey(pubkeyPath) {
  if (typeof pubkeyPath !== 'string' || pubkeyPath === '' || !existsSync(pubkeyPath)) {
    throw refuse(GRANT_REFUSE.DAEMON_KEY_UNPINNED,
      `no owner-daemon public key is pinned at ${String(pubkeyPath)}. A pin read from agent-writable `
      + 'state would not be a pin, and a grant verified against a key the agent supplied is the agent '
      + 'approving itself')
  }
  return readFileSync(pubkeyPath, 'utf8')
}

/**
 * Verify an admission grant against the pinned daemon key and the recorded artifact.
 *
 * @param {{grant: object|null, pinnedPubkeyPem: string, artifactDigest: string, release: string}} input
 * @returns {Readonly<object>} the verified grant's bound fields.
 * @throws {Error} one of `GRANT_REFUSE`, by name.
 */
/**
 * **HOW LONG AN ADMISSION GRANT IS WORTH, AND WHY IT IS A DAY.**
 *
 * The grant carries `approvedAt` and is signed over it, so the time is the owner's own and cannot be edited —
 * but a signed TIME is only useful if somebody bounds it. **A GRANT WITH NO WINDOW IS A STANDING PERMIT THAT
 * NAMES A MOMENT**, and the moment it names stops mattering the longer it sits.
 *
 * A DAY IS CHOSEN TO BE GENEROUS RATHER THAN TIGHT. An admission is answered by a person and settled by a
 * daemon on the same machine, so the honest interval is minutes; a day leaves room for a stopped daemon, a
 * laptop that slept, and an owner who answers before breakfast. **A window that refuses real work is a window
 * somebody widens**, so this is set where the ordinary case never notices it and the pathological case cannot
 * hide in it.
 *
 * **IT IS AN OPTION, NOT A LITERAL, SO A CALLER CAN SAY WHAT IT MEANS.** A test that wants an expired grant
 * passes `now`; a deployment with a different rhythm passes `maxAgeMs`. Neither has to edit this file.
 */
export const MAX_GRANT_AGE_MS = 24 * 60 * 60 * 1000

export function verifyAdmissionGrant(input) {
  const { grant, pinnedPubkeyPem, artifactDigest, release } = input
  if (grant === null || grant === undefined) {
    throw refuse(GRANT_REFUSE.GRANT_ABSENT,
      `no admission grant was presented for artifact ${artifactDigest.slice(0, 16)}…, and this artifact `
      + 'requires one')
  }
  assertPreimageFields(grant ?? {})
  if (typeof grant !== 'object' || grant.operation !== ADMIT_OPERATION
    || !HEX64.test(grant.envelopeDigest ?? '')
    || !HEX64.test(grant.artifactDigest ?? '') || typeof grant.release !== 'string'
    || typeof grant.nonce !== 'string' || grant.nonce === ''
    || !Number.isInteger(grant.approvedAt) || typeof grant.authority !== 'string'
    || grant.version !== 1 || !HEX128.test(grant.signature ?? '')) {
    throw refuse(GRANT_REFUSE.GRANT_INVALID, 'the grant is not a complete version-1 admission grant')
  }
  // THE SIGNATURE IS CHECKED FIRST, AND THE ORDER MATTERS HERE. Checking the artifact digest before the
  // signature would let a forged grant be reported as "for another artifact" — a TRUE statement about a
  // document nobody signed, which reads as a near-miss rather than as a forgery.
  let ok = false
  try {
    ok = cryptoVerify(
      null,
      Buffer.from(admissionGrantPreimage(grant), 'utf8'),
      createPublicKey(pinnedPubkeyPem),
      Buffer.from(grant.signature, 'hex'),
    )
  } catch {
    ok = false
  }
  if (!ok) {
    throw refuse(GRANT_REFUSE.GRANT_INVALID,
      'the grant does not verify under the owner-daemon public key pinned at install')
  }
  // ── **THE WINDOW, CHECKED AFTER THE SIGNATURE AND FOR THE SAME REASON AS THE ARTIFACT BELOW** ─────────
  //
  // A window check on a forged grant would report *"expired"* — **a TRUE statement about a document nobody
  // signed**, which reads as a near-miss rather than as a forgery. The signature decides first; only then does
  // the clock get to say anything.
  //
  // **AND THE FUTURE IS REFUSED TOO, WHICH IS NOT PEDANTRY.** `approvedAt` is inside the signed preimage, so an
  // attacker cannot move it — but a CLOCK that is wrong (or a grant minted on a machine whose clock is ahead)
  // produces `now < approvedAt`, and without this branch the age is negative and **every** window check passes.
  // *A one-sided bound computed by subtraction is no bound at all when the subtraction can go negative.*
  // ── **THE UNITS, WHICH I GOT WRONG FIRST AND THE COURT CAUGHT (MEASURED)** ─────────────────────────────
  //
  // My first version compared `Date.now()` — **milliseconds** — against `grant.approvedAt` and reported the
  // fixture as *"approved 1788641596s ago"*, about fifty-six years. **`approvedAt` IS IN SECONDS**: the
  // producer signs `approvedAt: Math.floor(Date.now() / 1000)`
  // (`tests/aukora-owner-admission.test.mjs:291`), and the preimage writes it with `String(parts.approvedAt)`,
  // so the unit is carried by the producer and not by the field's name.
  //
  // *A field called `approvedAt` with no unit in its name is a field two readers will read two ways* — and my
  // window check is the first reader to care. The comparison is done in SECONDS here, and `now` is accepted in
  // the same unit as `approvedAt` so a caller passing `Date.now() / 1000` gets what it expects.
  const nowSeconds = Number.isFinite(input.now) ? Number(input.now) : Math.floor(Date.now() / 1000)
  const maxAgeMs = Number.isFinite(input.maxAgeMs) ? Number(input.maxAgeMs) : MAX_GRANT_AGE_MS
  const maxAgeSeconds = Math.floor(maxAgeMs / 1000)
  const age = nowSeconds - grant.approvedAt
  if (age < 0) {
    throw refuse(GRANT_REFUSE.GRANT_NOT_YET_VALID,
      `the grant is dated ${String(grant.approvedAt)} and this check ran at ${String(nowSeconds)} (seconds), so it `
      + `was approved ${String(-age)}s in the future — it was not made when it claims, or a clock is wrong`)
  }
  if (age > maxAgeSeconds) {
    throw refuse(GRANT_REFUSE.GRANT_EXPIRED,
      `the grant was approved ${String(age)}s ago and an admission grant is worth ${String(maxAgeSeconds)}s, so `
      + `its window closed ${String(age - maxAgeSeconds)}s ago`)
  }
  // ── **AND ONE USE, WHICH A SIGNATURE CANNOT PROVIDE BY ITSELF** ─────────────────────────────────────────
  //
  // `nonce` is in the signed preimage, so it is unique per grant and cannot be forged or edited — **and a
  // unique value that nobody records is a value that identifies nothing.** A grant replayed twice admits the
  // same artifact twice, and both times the signature verifies.
  //
  // **THE CALLER OWNS THE RECORD, AND THAT IS DELIBERATE.** This module is pure — no disk, no clock of its own —
  // so it cannot consume the nonce itself without becoming a store. It takes the set of CONSUMED nonces, refuses
  // one that is already in it, and the caller adds the nonce after the effect lands. *Check-then-consume, with
  // the caller between them*, because consuming before the effect would burn a grant whose effect then failed.
  //
  // **AN ABSENT SET IS NOT A PASS.** A caller that passes no `consumedNonces` gets a grant with NO reuse check,
  // and this says so in the returned object rather than pretending: `reuseChecked: false`. *A protection that
  // silently does not run is the defect this whole module exists to remove.*
  const consumed = input.consumedNonces
  const reuseChecked = consumed !== undefined && consumed !== null
  if (reuseChecked && typeof consumed.has === 'function' && consumed.has(grant.nonce)) {
    throw refuse(GRANT_REFUSE.GRANT_NONCE_REUSED,
      `the grant's nonce ${grant.nonce.slice(0, 16)}… has already been consumed, so this is a second use of one `
      + 'approval — the signature verifies because the grant is genuine, which is exactly why a replay needs a record')
  }
  if (grant.artifactDigest !== artifactDigest || grant.release !== release) {
    throw refuse(GRANT_REFUSE.GRANT_FOR_OTHER_ARTIFACT,
      `the grant admits ${grant.artifactDigest.slice(0, 16)}… of release ${grant.release} and the recorded `
      + `artifact is ${artifactDigest.slice(0, 16)}… of release ${release}`)
  }
  return Object.freeze({
    operation: grant.operation,
    envelopeDigest: grant.envelopeDigest,
    artifactDigest: grant.artifactDigest,
    release: grant.release,
    nonce: grant.nonce,
    approvedAt: grant.approvedAt,
    authority: grant.authority,
    // **WHAT WAS CHECKED AND WHAT WAS NOT**, so a caller cannot read a verified grant as having had a reuse
    // check it never had. The window is always checked; the nonce only when a record was supplied.
    windowChecked: true,
    reuseChecked,
  })
}

/** The ceiling line the gate prints once a grant is in force, chosen from the grant's own authority. */
export function admissionCeilingLine(artifact, authority) {
  return `PILOT: ${String(artifact.id)} admitted by owner-approved grant (${String(authority)})`
}

// ── THE SET: ONE APPROVAL OVER EVERY DECLARED PLUGIN ─────────────────────────────────────────────

/**
 * The canonical set digest: sha256 over the SORTED artifact digests, one per line.
 *
 * SORTED AND DIGEST-ONLY, for two reasons that both matter. Sorted, so the same set always produces the
 * same digest regardless of the order a walk found the plugins in — an unordered digest would make the
 * owner's approval depend on a directory listing. Digests only, because a set approval is about the
 * BYTES; the plugin ids are how a caller looks one up, not what is being approved.
 *
 * @param {Record<string, {digest: string}>|string[]} artifacts - artifact records, or digests directly.
 * @returns {string} the set digest.
 */
export function pluginSetDigest(artifacts) {
  const digests = Array.isArray(artifacts)
    ? artifacts
    : Object.values(artifacts).map(artifact => artifact.digest)
  const canonical = [...digests].sort().map(digest => `${digest}\n`).join('')
  return digestOf(Buffer.from(canonical, 'utf8'))
}

/** The preimage a SET grant signs. Same shape as an artifact grant, over the set digest. */
export function setGrantPreimage(parts) {
  assertPreimageFields({ ...parts, version: parts.version ?? 1 })
  return [
    'aukora:plugin-set-admission:v1',
    `operation ${parts.operation}`,
    `envelopeDigest ${parts.envelopeDigest}`,
    `setDigest ${parts.setDigest}`,
    `count ${String(parts.count)}`,
    `release ${parts.release}`,
    `nonce ${parts.nonce}`,
    `approvedAt ${String(parts.approvedAt)}`,
    `authority ${parts.authority}`,
  ].join('\n')
}

/** Sign a set grant. THE DAEMON'S HALF, so a court can produce one with a fixture key. */
export function signSetGrant(input) {
  const fields = {
    operation: input.operation, envelopeDigest: input.envelopeDigest,
    setDigest: input.setDigest, count: input.count,
    release: input.release, nonce: input.nonce, approvedAt: input.approvedAt,
    authority: input.authority,
  }
  assertPreimageFields({ ...fields, version: 1 })
  const signature = cryptoSign(null, Buffer.from(setGrantPreimage(fields), 'utf8'), input.privateKey).toString('hex')
  return Object.freeze({ ...fields, version: 1, signature })
}

/**
 * Verify a set grant against the pinned daemon key.
 *
 * THE SIGNATURE IS CHECKED BEFORE THE SET DIGEST, for the same reason it is in the single-artifact case:
 * checking the digest first would let a forgery be reported as "about a different set", which is a true
 * statement about a document nobody signed.
 *
 * @param {{grant: object|null, pinnedPubkeyPem: string, setDigest: string, release: string}} input
 * @returns {Readonly<object>} the verified grant's bound fields.
 */
export function verifySetGrant(input) {
  const { grant, pinnedPubkeyPem, setDigest, release } = input
  if (grant === null || grant === undefined) {
    throw refuse(GRANT_REFUSE.GRANT_ABSENT, 'no set admission grant was presented')
  }
  assertPreimageFields(grant ?? {})
  if (typeof grant !== 'object' || grant.operation !== ADMIT_SET_OPERATION
    || !HEX64.test(grant.envelopeDigest ?? '')
    || !HEX64.test(grant.setDigest ?? '') || !Number.isInteger(grant.count)
    || typeof grant.release !== 'string' || typeof grant.nonce !== 'string' || grant.nonce === ''
    || !Number.isInteger(grant.approvedAt) || typeof grant.authority !== 'string'
    || grant.version !== 1 || !HEX128.test(grant.signature ?? '')) {
    throw refuse(GRANT_REFUSE.GRANT_INVALID, 'the grant is not a complete version-1 set admission grant')
  }
  let ok = false
  try {
    ok = cryptoVerify(null, Buffer.from(setGrantPreimage(grant), 'utf8'),
      createPublicKey(pinnedPubkeyPem), Buffer.from(grant.signature, 'hex'))
  } catch { ok = false }
  if (!ok) {
    throw refuse(GRANT_REFUSE.GRANT_INVALID,
      'the set grant does not verify under the owner-daemon public key pinned at install')
  }
  // COUNT IS VERIFIED AGAINST THE SET, NOT TRUSTED FROM THE GRANT. A grant that says it covers 156 plugins
  // while the set it names covers 3 is a TRUE SIGNATURE OVER A FALSE DESCRIPTION, and the ceiling line
  // prints the count a reader believes. `expectedCount` is the size of the set the caller actually built,
  // so the number in the line and the number in the signature cannot disagree.
  if (input.expectedCount !== undefined && grant.count !== input.expectedCount) {
    throw refuse(GRANT_REFUSE.GRANT_INVALID,
      `the grant says it covers ${String(grant.count)} plugins and the set it names has `
      + `${String(input.expectedCount)}. A count is a claim about the set and is checked against the set`)
  }
  if (grant.setDigest !== setDigest || grant.release !== release) {
    throw refuse(GRANT_REFUSE.GRANT_FOR_OTHER_ARTIFACT,
      `the grant admits set ${grant.setDigest.slice(0, 16)}… of release ${grant.release} and this release's `
      + `set is ${setDigest.slice(0, 16)}…`)
  }
  return Object.freeze({
    operation: grant.operation, envelopeDigest: grant.envelopeDigest,
    setDigest: grant.setDigest, count: grant.count,
    release: grant.release, nonce: grant.nonce, approvedAt: grant.approvedAt, authority: grant.authority,
  })
}

/**
 * Decide ONE plugin against an approved set — by DIGEST, and by name when it does not match.
 *
 * A PLUGIN WHOSE BYTES CHANGED IS REFUSED, NOT RE-ADMITTED. The id is how the gate knows which plugin it
 * is looking at; the digest is what was approved. A file that kept its name and changed its bytes is the
 * exact thing an approval over bytes exists to catch, and "it is in the set by name" would wave it past.
 *
 * @param {{artifact: object, approvedDigests: ReadonlySet<string>}} input
 * @returns {true}
 * @throws {Error} `plugin-not-in-set` or `plugin-bytes-changed`, by name.
 */
export function admitFromSet(input) {
  const { artifact, approvedDigests } = input
  if (!approvedDigests.has(artifact.digest)) {
    // TWO DIFFERENT FACTS, KEPT APART. If ANY digest in the set matches a file the artifact DECLARES, then
    // this plugin is known to the owner and its bytes have moved. Otherwise it was never in the set.
    const declaredDigests = Object.values(artifact.files ?? {})
    const known = declaredDigests.some(digest => approvedDigests.has(digest))
    if (known) {
      throw refuse(GRANT_REFUSE.PLUGIN_BYTES_CHANGED,
        `${String(artifact.id)} is approved by id and its bytes are not the bytes that were approved: the set `
        + `carries a digest this artifact's files still contain, and the artifact digest is now `
        + `${artifact.digest.slice(0, 16)}…`)
    }
    throw refuse(GRANT_REFUSE.PLUGIN_NOT_IN_SET,
      `${String(artifact.id)} (${artifact.digest.slice(0, 16)}…) is not in the owner-approved set`)
  }
  return true
}

/**
 * The ceiling line the gate prints once a set grant is in force.
 *
 * "ADMITTED" IS NEVER PRINTED UNQUALIFIED, AND THE QUALIFIER IS NOT DECORATION. A set grant covers the
 * files the recorder records: each plugin's own package, its entry and its RELATIVE imports. Bare
 * specifiers are not followed, so NOTHING FROM node_modules IS COVERED — an installed dependency can be
 * changed byte for byte and no digest the gate holds will move. Measured in `aukora-dependency-coverage`,
 * which is named in the line itself so a reader who wants to check the limit has the court that proves it.
 *
 * THE FIRST VERSION OF THIS FUNCTION SAID "N of N declared plugins admitted by owner-approved set grant"
 * AND NOTHING ELSE. It was true about the recorder and read as a statement about the plugins, which is the
 * exact distance between a limit and a false assurance.
 *
 * @param {number} count - how many declared plugins the set covers.
 * @param {readonly string[]} residualList - plugins carrying residuals the loader cannot see.
 * @param {string} authority - who approved: 'console' or 'phone'.
 * @returns {string} the line.
 */
export function setCeilingLine(count, residualList, authority) {
  const residuals = residualList.length === 0
    ? 'none'
    : `${String(residualList.length)} carry residuals the loader cannot see: ${residualList.join(', ')}`
  return `PILOT: ${String(count)} of ${String(count)} declared plugins admitted by owner-approved set grant `
    + `(${String(authority)}) — entry and relative closure only; installed dependencies (bare specifiers) `
    + `are NOT covered (aukora-dependency-coverage); ${residuals}`
}

/** Aumlok's parser, re-exported so a caller of this module needs only one import. */
export { envelopeOf }

/**
 * THE ENVELOPE BINDING, and it is the point of the whole envelope.
 *
 * A GRANT IS VALID ONLY FOR THE EXACT ENVELOPE THE OWNER REVIEWED. The owner approved frozen bytes; the
 * digest of those bytes is what the signature travels with, so a grant cannot be re-pointed at a different
 * set of artifacts that happens to have the same size, and a set listing cannot be edited after approval
 * without the signature ceasing to match.
 *
 * THE COUNT IS CHECKED AGAINST THE ENVELOPE'S OWN LIST, never against a number either side supplies as a
 * request field. That is Codex P1 #1 on my side of the seam: a true signature over a false description,
 * where the ceiling line prints a count a reader believes.
 *
 * THE CANONICAL BYTES COME FROM AUMLOK'S `canonicalEnvelope`, not from a second implementation here: two
 * implementations of "canonical" is exactly how a signature verifies on one side and not the other.
 *
 * @param {{grant: object, envelope: object}} input
 * @returns {true}
 * @throws {Error} `grant-for-other-artifact` or `grant-invalid`, by name.
 */
export function bindGrantToEnvelope({ grant, envelope }) {
  const canonicalDigest = envelopeDigestOf(envelope)
  if (grant.envelopeDigest !== canonicalDigest) {
    throw refuse(GRANT_REFUSE.GRANT_FOR_OTHER_ARTIFACT,
      `the grant is bound to envelope ${String(grant.envelopeDigest).slice(0, 16)}… and these frozen bytes `
      + `hash to ${canonicalDigest.slice(0, 16)}…: the owner approved a different envelope`)
  }
  const listed = Array.isArray(envelope.artifacts) ? envelope.artifacts.length : -1
  if (grant.count !== undefined && grant.count !== listed) {
    throw refuse(GRANT_REFUSE.GRANT_INVALID,
      `the grant says it covers ${String(grant.count)} artifacts and the envelope it is bound to lists `
      + `${String(listed)}. The count is a claim about the frozen bytes and is checked against THEM`)
  }
  return true
}

/** The digest a grant must carry for this envelope, so a caller can mint one without guessing at it. */
export const envelopeDigestOf = envelope =>
  digestOf(Buffer.from(canonicalEnvelope(envelope), 'utf8'))
