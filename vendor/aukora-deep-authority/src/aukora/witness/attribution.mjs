/**
 * Attribution: which of this repository's named refusals could only have been
 * caused by the subject they would accrue against.
 *
 * THE RULE. A mark may accrue against a subject only if the subject is the only
 * actor who could have caused it. If any other actor — counterparty, peer,
 * network, filesystem, or bystander — can produce the same mark, the mark is
 * `NOT_ATTRIBUTABLE`: it may be counted and surfaced, and it may never become
 * weight against the subject.
 *
 * Attribution is stronger than asking whether the producer is a party to the
 * exchange. A counterparty is a party, and a mark a counterparty can
 * manufacture is still not a fact about the subject. Party-ness is a claim
 * about topology, which changes as a system grows; attribution is a claim about
 * causation, which does not.
 *
 * ASKING IT PER MARK. For each mark M that can accrue against subject S:
 * enumerate every way M can be produced — not the intended way, every way; for
 * each, ask whether an actor other than S can produce it; if yes, M is
 * `NOT_ATTRIBUTABLE`. A row here is the recorded answer, so a refusal cannot be
 * added to either table without someone answering the question for it.
 *
 * WHAT THE ANSWER IS FOR THIS REPOSITORY, MEASURED. Every
 * `KIRA_MEMORY_ARTIFACT_REFUSE` mark is `NOT_ATTRIBUTABLE`. That is not caution, it
 * is the consequence of a fact the verifier already states in
 * `KIRA_MEMORY_ARTIFACT_CEILING`: no signature is checked, because the settlement
 * receipt is signed by the broker and never persisted. The artifact is
 * unsigned JSON, its head is a hash rather than a signature, and its trusted
 * head arrives from the caller. Nothing in it binds any byte to the producer
 * that claims to have written it, so no verifier refusal is evidence about that
 * producer. Deep can hand a counterparty something checkable and cannot yet
 * hand it anything attributable. Every mark in both tables is
 * `NOT_ATTRIBUTABLE`. `record:reserved-field` is the closest call: it is raised
 * on a body the local appending process assembled and the readers deliberately
 * refuse the same names under their own marks
 * (`record:reserved-field-on-wire`, `chain-reserved-field`) so chain bytes
 * cannot produce it. It is still not attributable, because no signature binds a
 * chain body to the process that assembled it — the mark shows a reserved name
 * was present, never whose hand put it there. Keeping the marks separate buys a
 * diagnostic distinction, not weight.
 *
 * THAT LAST CLAIM IS LOAD-BEARING AND IS WHY THE READERS RAISE A DIFFERENT
 * MARK. The chain readers do now refuse a body carrying a reserved name, because
 * `domain` is written into the preimage after the body spread and so is not
 * covered by the digest — an injected value left the stored hash, every link,
 * and the trusted head identical to the genuine record's. Had the readers
 * raised `record:reserved-field` for it, the one attributable mark in this
 * repository would have become plantable by anyone who can write a byte. They
 * raise `record:reserved-field-on-wire` and `chain-reserved-field` instead:
 * same repair, and the write-time precondition still never travels.
 *
 * `head-mismatch` IS THE MARK THAT MOST LOOKS LIKE PROOF AND IS NOT. It fires
 * when the head recomputed from the chain differs from `options.trustedHead`,
 * and `trustedHead` is chosen by the verifier's caller — the `--head` flag, or
 * whatever a caller passes. Any 64-hex string refuses a wholly honest artifact.
 * A second, independent producer exists: a carrier can delete a valid suffix of
 * `artifact.aura` and restate `artifact.head` to that shorter prefix's head, at
 * which point the chain walks clean, `head-not-as-claimed` stays green, and
 * `head-mismatch` fires against a producer who emitted the longer chain
 * correctly. Reading `head-mismatch` as a forked or rewritten chain therefore
 * attributes to the subject a mark two other actors can produce for free.
 *
 * `chain-truncated` IS THE CHEAPEST MARK IN THE TABLE TO MANUFACTURE. It fires
 * when `artifact.aura` is non-empty and does not end in a newline: one deleted
 * byte, anywhere between the producer and the verifier. A copy interrupted
 * mid-write produces it, a full disk at the producer produces it, and so does
 * any carrier that wants to. It is the shape of an incomplete transfer, and it
 * is never the shape of a claim about the producer.
 *
 * SUBJECTS ARE NAMED PER ROW. The two refusal tables answer to different
 * subjects — the verifier judges bytes a remote producer claims to have
 * written, while the record module judges a chain file a local process owns —
 * so `attribution` is meaningless without the subject it is relative to.
 *
 * THE TRADE THIS RULE MAKES, NAMED RATHER THAN LEFT TO BE FOUND. Refusing to
 * weight what a third actor can produce means a dishonest subject sheds weight
 * by arranging for a third actor to be a possible cause. That is real. The
 * answer is not to weight unattributable marks; it is to make marks
 * attributable, which for this repository means signing what it hands over.
 *
 * THIS MODULE IS A LIBRARY AND ITS COURT, WIRED INTO NO PRODUCT PATH. No
 * verifier, broker, supervisor, or checkpoint path reads {@link MARK_ATTRIBUTION},
 * and no refusal is weighted anywhere in this repository. Consuming it is a
 * separate change that must state where weight accrues and who reads it.
 *
 * @module @aukora/witness/attribution
 */

/** The subject the `KIRA_MEMORY_ARTIFACT_REFUSE` marks would accrue against. */
export const SUBJECT_ARTIFACT_PRODUCER = 'the producer the artifact claims settled this memory.put'

/** The subject the 10 `RECORD_REFUSE` marks would accrue against. */
export const SUBJECT_CHAIN_APPENDER = 'the process that owns and appends to this Aura chain'

/** The closed set of attribution classes, in the order a census reports them. */
export const ATTRIBUTION_CLASSES = Object.freeze(['SUBJECT_ONLY', 'NOT_ATTRIBUTABLE'])

/**
 * Every named refusal in `aukora/verifier/kira-memory-artifact-verifier.mjs` and
 * `aukora/aura/record.mjs`, classified.
 *
 * Marks are written as literal strings rather than imported, so a rename in
 * either refusal table is a disagreement between two independently authored
 * lists that the totality court reports, instead of a silent rename here.
 *
 * `alsoProducibleBy` names WHO ELSE can produce the mark and the cheapest way
 * they can. It is empty exactly for `SUBJECT_ONLY`.
 */
export const MARK_ATTRIBUTION = Object.freeze([
  // The verifier reads an artifact object and a caller-supplied trusted head.
  // The artifact carries no signature, so every edit below survives every check
  // it does not directly break, and none of them requires any key material.
  { mark: 'artifact-not-plain', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any carrier of the artifact (replace the JSON root with an array or a scalar)']) },
  { mark: 'artifact-not-json-data', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(["the verifier's caller (pass a live object holding a function, a cycle, or a proxy — no JSON text can carry one)"]) },
  { mark: 'artifact-field-unknown', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any carrier of the artifact (add one field)']) },
  { mark: 'artifact-field-missing', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any carrier of the artifact (delete one field)']) },
  { mark: 'artifact-field-invalid', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any carrier of the artifact (retype one field)']) },
  { mark: 'artifact-kind-unknown', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any carrier of the artifact (rewrite one string)']) },
  { mark: 'artifact-unreadable', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(["the reader's own filesystem (permissions, an unlinked or unreadable file)", 'whoever placed the file, who need not be the producer']) },
  { mark: 'artifact-not-json', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any carrier of the artifact (truncate the file by one byte)']) },
  { mark: 'options-not-plain', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(["the verifier's caller alone; options are never carried by the artifact"]) },
  { mark: 'options-field-unknown', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(["the verifier's caller alone (add one field beside trustedHead)"]) },
  { mark: 'trusted-head-missing', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(["the verifier's caller (omit --head)"]) },
  { mark: 'trusted-head-not-hex', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(["the verifier's caller (one mistyped --head)"]) },
  { mark: 'record-malformed', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any carrier of the artifact (retype one field of artifact.record)']) },
  { mark: 'record-identity-mismatch', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any carrier of the artifact (edit one record field and leave recordId)']) },
  { mark: 'key-not-record-id', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any carrier of the artifact (edit memoryPut.key)']) },
  { mark: 'object-body-unparseable', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any carrier of the artifact (corrupt object.body)']) },
  { mark: 'object-body-not-canonical', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any carrier of the artifact (add one space inside object.body)']) },
  { mark: 'object-body-mismatch', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any carrier of the artifact (edit memoryPut.value)']) },
  { mark: 'object-body-not-record', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any carrier of the artifact (substitute artifact.record for another well-formed record)']) },
  { mark: 'object-address-mismatch', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any carrier of the artifact (rename object.name)']) },
  { mark: 'content-digest-mismatch', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any carrier of the artifact (edit projection.contentSha256)']) },
  { mark: 'projection-key-mismatch', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any carrier of the artifact (edit projection.key)']) },
  { mark: 'chain-truncated', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any carrier of the artifact (delete the final newline byte)', 'a copy interrupted mid-write', "the producer's own disk filling between an entry and its newline"]) },
  { mark: 'chain-empty', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any carrier of the artifact (empty artifact.aura)']) },
  { mark: 'chain-unparseable', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any carrier of the artifact (corrupt one chain line)']) },
  { mark: 'chain-not-canonical', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any carrier of the artifact (add one space inside a chain line)']) },
  { mark: 'chain-reserved-field', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any carrier of the artifact (append `,"domain":"…"` inside a chain line; the stored hash, every link, and the head stay those of the genuine record)']) },
  { mark: 'chain-broken-link', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any carrier of the artifact (delete one interior chain line)']) },
  { mark: 'chain-tampered', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any carrier of the artifact (flip one byte inside a hashed field)']) },
  { mark: 'settlement-absent', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any carrier of the artifact (delete the settled entry, or edit memoryPut.key so no entry binds it)']) },
  { mark: 'head-not-as-claimed', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any carrier of the artifact (edit artifact.head)']) },
  { mark: 'head-mismatch', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(["the verifier's caller (any 64-hex --head refuses an honest artifact)", 'any carrier of the artifact (delete a valid chain suffix and restate artifact.head to the shorter prefix, which walks clean)']) },
  { mark: 'recall-status-unknown', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any carrier of the artifact (rewrite recall.status)']) },
  { mark: 'recall-reason-missing', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any carrier of the artifact (delete recall.reason)']) },
  { mark: 'recall-reason-unknown', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any carrier of the artifact (rewrite recall.reason)']) },
  { mark: 'recall-lies', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any carrier of the artifact (edit recall.status or recall.records)']) },
  { mark: 'verifier-internal-refusal', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(["the reader's own verifier install (a defect or an exhausted runtime on the reading machine)"]) },
  { mark: 'usage', subject: SUBJECT_ARTIFACT_PRODUCER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['the CLI invoker; an argument list is never supplied by the producer']) },

  // The record module judges a local chain file. `aukora/aura/record.mjs`
  // states that a same-uid process can rewrite that file into a self-consistent
  // forgery, so a same-uid process can also produce any partial break in it.
  { mark: 'record:unparseable', subject: SUBJECT_CHAIN_APPENDER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any same-uid process (write one non-JSON line)', 'a partial line left by a killed writer']) },
  { mark: 'record:chain-not-canonical', subject: SUBJECT_CHAIN_APPENDER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(["any same-uid process (rewrite one line's encoding without changing the value it parses to)"]) },
  { mark: 'record:reserved-field-on-wire', subject: SUBJECT_CHAIN_APPENDER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any same-uid process (append `,"domain":"…"` inside a chain line, which the preimage overwrites, so the stored hash and the head are unchanged)']) },
  // Raised on a body the appending process itself assembled, before any byte is
  // written. That is the closest thing here to a local precondition — and it is
  // still NOT_ATTRIBUTABLE, for the reason the header gives: no signature binds
  // a chain body to the process that assembled it, so the mark shows that a
  // reserved name was present and never shows whose hand put it there. The
  // readers refuse the same names under their own marks so this one keeps
  // naming a distinct event, not so it can carry weight.
  { mark: 'record:reserved-field', subject: SUBJECT_CHAIN_APPENDER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any process able to call appendEntry in this address space; nothing signs the body, so the mark does not name a writer']) },
  { mark: 'record:broken-link', subject: SUBJECT_CHAIN_APPENDER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any same-uid process (delete one interior line)']) },
  { mark: 'record:tampered', subject: SUBJECT_CHAIN_APPENDER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any same-uid process (flip one byte inside a hashed field)']) },
  { mark: 'record:truncated', subject: SUBJECT_CHAIN_APPENDER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any same-uid process (cut the tail, or unlink the file)', 'the local filesystem (a full disk, or a crash between an entry and its newline)']) },
  { mark: 'record:unavailable', subject: SUBJECT_CHAIN_APPENDER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any same-uid process (replace the file with a symlink, directory, or fifo)', 'the local filesystem (permissions, or an unreadable device)']) },
  { mark: 'record:lock-timeout', subject: SUBJECT_CHAIN_APPENDER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any same-uid process (create the lock path and hold it)', 'a writer killed between taking the lock and releasing it, which leaves the path behind with no owner']) },
  { mark: 'record:lock-handle-invalid', subject: SUBJECT_CHAIN_APPENDER, attribution: 'NOT_ATTRIBUTABLE', alsoProducibleBy: Object.freeze(['any caller in this address space (pass a handle for another chain file, a released handle, or an object this module did not issue); nothing signs a handle, so the mark names a broken caller and never names which one']) },
])

const BY_MARK = new Map(MARK_ATTRIBUTION.map(row => [row.mark, row]))

/**
 * The recorded answer for one mark.
 *
 * @param {string} mark - a refusal name as either table emits it.
 * @returns {{mark: string, subject: string, attribution: string, alsoProducibleBy: readonly string[]} | null}
 *   the classification, or null when the mark is unclassified. Null is loud: an
 *   unclassified mark has had the question asked of nobody, and a caller must
 *   never read it as permission to accrue.
 */
export function attributionOf(mark) {
  return BY_MARK.get(mark) ?? null
}

/**
 * The rule itself, asked of an explicit producer set rather than of this
 * module's table, so another altitude can ask it without adopting these marks.
 *
 * @param {string} subjectId - the subject a mark would accrue against.
 * @param {readonly string[]} producers - every actor who can cause the mark, the subject included.
 * @returns {boolean} whether the subject is the only possible cause.
 */
export function isAttributable(subjectId, producers) {
  return producers.length === 1 && producers[0] === subjectId
}

/**
 * Whether a mark of this class may become weight against its subject.
 *
 * @param {string} attribution - one member of {@link ATTRIBUTION_CLASSES}.
 * @returns {boolean} true only for `SUBJECT_ONLY`.
 * @throws {TypeError} when the class is outside the closed set.
 */
export function mayAccrueAsWeight(attribution) {
  switch (attribution) {
    case 'SUBJECT_ONLY': return true
    case 'NOT_ATTRIBUTABLE': return false
    default: return assertNever(attribution)
  }
}

/**
 * A classification is a statement about causation and never a permission.
 * `SUBJECT_ONLY` says the subject is the only possible cause; it does not
 * authorize accruing, disclosing, or acting on the mark, each of which is a
 * separate decision with its own authority.
 *
 * @returns {false} always.
 */
export function attributionGrantsAuthority() {
  return false
}

/**
 * @param {never} value - the unhandled member of a closed union.
 * @returns {never} never returns.
 * @throws {TypeError} always.
 */
function assertNever(value) {
  throw new TypeError(`unreachable attribution class: ${String(value)}`)
}
