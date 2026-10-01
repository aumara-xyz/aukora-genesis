/**
 * The Messages face's wire contract, written once for both ends.
 *
 * WHY ONE MODULE. The host registers these routes and the screen fetches them. If each half
 * spelled its own path, a rename on one side would leave the other fetching a route nobody
 * serves; if each half spelled its own refusal vocabulary, a refusal would reach the screen
 * as an unrecognised shape and be shown as a generic failure instead of the named reason the
 * host chose. Both halves import this file, and nothing here touches the filesystem, the
 * environment or the DOM, so the browser bundle can carry it and a court can exercise every
 * parser without starting a server. It mirrors `documents-route.ts` deliberately: same
 * endpoint-constant shape, same exact-key parsers, same refusal body.
 *
 * THREE ROUTES, AND TWO OF THEM WRITE — ONE FILE, FOR ONE MESSAGE THAT REALLY EXISTS. The listing
 * only reads. The thread opens the gift wraps a relay served and the send route composes a NIP-17
 * message and hands it to the relays; both then write ONE EVIDENCE RECORD per gift wrap that
 * actually exists: the send for the wrap a relay accepted, the thread for each wrap it opened and
 * attributed to the requested sender. The record is the six-field
 * `aukora:nostr-message-evidence:v1` document `plugins/aukora-nostr/lib/evidence.mjs` produces, and
 * nothing else on this machine is written — not the contacts file, not a key. The only addresses
 * either route opens are relays from this face's own configured list.
 *
 * A RECORD THAT COULD NOT BE WRITTEN NEVER DESTROYS THE MESSAGE, AND IS NEVER SILENT. The message is
 * the point and the record is the evidence of it, so a failed write leaves the send or the read
 * exactly as it was and is reported in the answer's own `evidence` / `evidenceRefusal` pair. A send
 * no relay accepted is `not-recorded` too, under a different code: there is no published wrap to be
 * evidence of, which is a different fact from a record that could not be written.
 *
 * ONE MESSAGE IS TWO COPIES, AND THE TWO CAN LAND DIFFERENTLY. NIP-17 wraps a copy to each recipient
 * AND one to the sender, so a single send hands two gift wraps to the relays and either of them can
 * be refused on its own. A flat `accepted` list cannot state that: it collapses "your friend has it"
 * and "only your own copy was kept" into the same word, and `ok: true` reads as the first when it may
 * be the second. So a send answer carries `copies` BESIDE the aggregate — one outcome per copy, each
 * naming WHICH copy it is (`recipient` or `self`), that wrap's own `eventId`, whether relays took it,
 * which relays took it, and, when it was refused, the named code for why. `ok` and `accepted` stay
 * exactly what they were and are derived from those same outcomes, so nothing that reads the old
 * fields reads a different answer than it did before.
 *
 * AND THE RECORDS FOLLOW THE COPIES, ONE RECORD PER ACCEPTED COPY. Each accepted copy is a published
 * event of its own, named by its own id, so each is evidence of itself; a refused copy was never
 * published and is owed NO record, because a record for a message that never left is the false claim
 * this whole lane exists to remove. The aggregate `evidence` therefore means "every copy a relay
 * accepted has a record" — a refused copy is not counted against it, and its own outcome in `copies`
 * carries the code that says why it was never published.
 *
 * THE FOUR CONTACT STATES ARE THE HEART OF THE LISTING. A npub on its own proves nothing;
 * `plugins/aukora-nostr/lib/contact.mjs` owns the meaning of each state and
 * `contacts-store.ts` is the only thing that produces them. This file only carries the bytes,
 * and it carries them with the SAS INCLUDED ONLY WHEN A BINDING VERIFIED: `sas` is either a
 * two-field object or null, in the listing and in the thread alike, and the parsers below
 * refuse a body that breaks that pairing rather than rendering it.
 *
 * THE REFUSAL VOCABULARY IS CLOSED AND FINITE, one name per condition and never a generic
 * failure. The reader's five were:
 *
 *   messages:contacts-state-missing   no contacts file at `<stateDir>/nostr/contacts.json`.
 *   messages:contacts-unparseable     the file is there and is not JSON.
 *   messages:contacts-domain-unknown  JSON, and its `domain` is not the v1 domain.
 *   messages:contact-malformed        the domain is right and one entry is not.
 *   messages:no-controller-record     no controller record to verify anything against, so not
 *                                     one contact can be resolved.
 *   messages:aumlok-not-linked        no Aumlok phrase is linked on this install yet, so there is
 *                                     no controller directory at all: link it first.
 *   messages:unreadable-state         the contacts file exists and cannot be read.
 *   messages:key-missing              no Nostr key yet; READING never mints one.
 *   messages:key-unreadable           the key file carries no usable secret.
 *
 * and the wire adds:
 *
 *   messages:malformed-request        the request is not the shape this face takes — including
 *                                     a thread asked for an npub that is not a contact.
 *   messages:request-body-unreadable  a send body arrived and is not JSON, or is too large.
 *   messages:no-such-route            the request named no endpoint this face serves.
 *   messages:state-directory-named     the request tried to name the state directory or the
 *                                     controller record. It cannot: this face reads ONE root,
 *                                     resolved by the host from its own configuration, and a
 *                                     request that names another is refused rather than obeyed.
 *   messages:text-empty               a send with nothing in it.
 *   messages:text-too-long            a send over {@link MESSAGES_TEXT_MAX_BYTES}.
 *   messages:relays-unreachable       no relay answered a read at all.
 *   messages:nobody-accepted          the relays were reached and none took the message.
 *   messages:reads-unavailable        the relay read itself failed before it could answer.
 *   messages:sender-unproven          wraps arrived for this node and NOT ONE of them could be
 *                                     opened and attributed to the contact asked about. Named
 *                                     rather than answered `messages: []`, because "nobody wrote
 *                                     to you" and "somebody did and I cannot prove who" are
 *                                     opposite facts about a conversation.
 *   messages:send-timeout             the SEND route's own budget expired before the relays
 *                                     settled. See {@link MESSAGES_SEND_BUDGET_MS}.
 *   messages:thread-timeout           the THREAD route's own budget expired before the relays
 *                                     settled. See {@link MESSAGES_THREAD_BUDGET_MS}.
 *
 * and `messages:unreadable-state` covers one more condition than its first reader did: besides a
 * contacts file that cannot be read, it is the answer when the face's OWN ENGINE throws — the
 * loaded composer refusing a message, say. An exception escaping a handler is not an answer at all
 * (the harness answers a bare 400 and the screen reads a broken transport), so every throw inside a
 * route becomes this name instead.
 *
 * AND ONE FIELD THAT IS NOT A REFUSAL AT ALL. `evidence` has THREE outcomes — `recorded`,
 * `not-recorded` and `none` — with the named reason in `evidenceRefusal` for the last two, and it
 * rides on a SUCCESSFUL answer rather than replacing one: a message that was published and a record
 * that was not written are two facts, and the second must not turn the first into a failure.
 *
 * THE THREE ARE THREE FACTS AND NONE OF THEM IS VACUOUS. `recorded` means a record exists for at
 * least one opened wrap, and never means anything else. `not-recorded` means a record was OWED for
 * an opened wrap and could not be written. `none` is the thread that opened NO wrap at all — an
 * empty conversation — where no record was owed, so `not-recorded` would invent a failure that
 * never happened and `recorded` would claim evidence nobody holds. Its reasons therefore live
 * outside {@link MESSAGES_REFUSAL_REASONS} — `messages:evidence-no-publish` for a send no relay
 * took, which has no published wrap to be evidence of, `messages:evidence-no-wrap-opened` for a
 * thread that opened no wrap at all, and `messages:evidence-module-absent` for a deployment whose
 * nostr tree carries no evidence module — alongside the module's own `nostr-evidence-unwritable`
 * when the record itself could not be written to disk.
 *
 * `messages:nobody-accepted` and `messages:relays-unreachable` are kept apart on purpose: the
 * first means every relay was reached and declined, the second means none was reached. A person
 * who is told "nobody took it" retries later; one told "we could not reach anybody" checks the
 * network. Collapsing them would make the face's one honest sentence about a failed send
 * useless.
 *
 * @module @aukora/face-messages/route
 */

/** The contacts listing. One exact route, GET only. */
export const MESSAGES_CONTACTS_ENDPOINT = '/aukora-messages/contacts.json'

/**
 * The request prefix the listing ALSO answers on.
 *
 * The endpoint is the `.json` path and the prefix is the bare one, as the Documents face has
 * it. Both are served by the same handler and both accept the same two query fields, because
 * a caller that built a request from {@link messagesContactsRequest} must reach the listing
 * rather than a 400: the endpoint the host registers is the one the screen fetches, and the
 * bare prefix is refused by name because it names no state directory.
 */
export const MESSAGES_CONTACTS_REQUEST_ENDPOINT = '/aukora-messages/contacts'

/** The conversation with one contact. GET, and read-only: it opens wraps and reports. */
export const MESSAGES_THREAD_ENDPOINT = '/aukora-messages/thread'

/**
 * Compose and publish one NIP-17 message. POST, and A MUTATING ROUTE IN THIS FACE — no longer the
 * only one: `/aukora-messages/add-contact` writes `contacts.json`. That one MUTATES A LIST rather
 * than publishing to a relay, so the two are not alike; they are alike in being the only two
 * routes here through which a request can change something.
 *
 * It may do exactly two things: compose a message with this node's own key and hand it to the
 * relays. It cannot write the contacts file, cannot touch a key file, and cannot fetch an
 * arbitrary URL — the only address it ever opens is a relay from its own configured list.
 */
export const MESSAGES_SEND_ENDPOINT = '/aukora-messages/send'

/** Where the Confirm button POSTs: the backend asks the signer, verifies, and stores. */
export const MESSAGES_CONFIRM_CONTACT_ENDPOINT = '/aukora-messages/confirm-contact'
export const MESSAGES_REISSUE_IDENTITY_ENDPOINT = '/aukora-messages/reissue-identity'

/**
 * How long a SEND may take before this route answers, whatever the relays are doing.
 *
 * THE CLIENT'S OWN ABORT IS THE REASON THIS EXISTS, and it is a MEASURED reason rather than a
 * precaution. The Messages screen fetches every route under `CONTACTS_REQUEST_TIMEOUT_MS = 15_000`
 * (`src/client/contacts-client.ts`). A route that settles after that does not answer slowly — it
 * does not answer at all: the screen reports `no answer from the host route: signal timed out`, and
 * the real outcome of a message that may well have been published is never told to anyone. That is
 * exactly what happened live. A relay that accepted the socket and never acknowledged cost the
 * relay module's own 8s default per copy, NIP-17 produces two copies, the route published them one
 * after the other, and ~16s of work met a 15s abort.
 *
 * SO THE BUDGET IS PART OF THE CONTRACT AND NOT A TUNING KNOB, and it is deliberately NOT read from
 * the environment: a deployment that widened it past the client's abort would be choosing to hang
 * again, and would look like a working setting while it did. Two other things hold the same line —
 * every relay exchange is clamped to fit inside this budget ({@link budgetedRelayTimeoutMs} in
 * `index.ts`), and the copies of one send are published CONCURRENTLY rather than in sequence, so the
 * wall clock is one relay wait instead of one per copy. The whole handler is then raced against this
 * deadline, so a route can never answer later than this with anything but a named refusal.
 */
export const MESSAGES_SEND_BUDGET_MS = 9_000

/**
 * How long a THREAD read may take before this route answers, on the same terms as
 * {@link MESSAGES_SEND_BUDGET_MS} and for the same reason: a read of a relay that never answers is
 * the same silent hang from the other side, and the client's abort does not distinguish them.
 */
export const MESSAGES_THREAD_BUDGET_MS = 9_000

/**
 * The most text one message may carry, in UTF-8 BYTES.
 *
 * Measured in bytes rather than characters because the limit exists to bound what is encrypted
 * and published: 4000 characters of four-byte emoji is sixteen kilobytes on the wire, and a
 * limit that a message can quadruple by its choice of script is not a limit.
 */
export const MESSAGES_TEXT_MAX_BYTES = 4000

/** The four contact states a listing may carry. See the module header. */
export type MessagesWireContactState = 'VERIFIED' | 'BOUND' | 'TEST' | 'UNBOUND' | 'FOREIGN'

/** Every state, in the order the design names them. */
export const MESSAGES_WIRE_CONTACT_STATES: readonly MessagesWireContactState[] = [
  'VERIFIED',
  'BOUND',
  'TEST',
  'UNBOUND',
  'FOREIGN',
]

/** What vouched for a contact: nothing, a binding that verified, or a binding that did not. */
export type MessagesWireContactBinding = 'absent' | 'verified' | 'refused'

/** The short string two people compare out of band. */
export interface MessagesWireSas {
  /** This device's own 35-digit fingerprint; the expected peer half stays host-side. */
  readonly digits: string
  /** The same digits in groups of five. */
  readonly spoken: string
  readonly comparisonGroupIndex: number
}

/**
 * One contact on the wire: seven leaf fields and nothing else.
 *
 * THERE IS NO `verdict` HERE, AND NO BINDING DOCUMENT. The resolver's verdict carries the
 * ceilings, the digest, the signer and the whole statement; none of that belongs on a screen,
 * and the binding document is the thing under judgement rather than a fact about the contact.
 * `court` asserts an entry's key set exactly, so a field added here without a decision behind
 * it fails rather than shipping.
 */
export interface MessagesWireContactEntry {
  /** The npub held for this contact. */
  readonly npub: string
  /** The name held for this contact. */
  readonly name: string
  /** Which of the four states it resolved to. */
  readonly state: MessagesWireContactState
  /** Why it landed there; for a refusal, the underlying named reason. */
  readonly reason: string
  /** The subject a verified binding names, or null. */
  readonly subject: string | null
  /** The string to compare out of band, or NULL when no binding verified. */
  readonly sas: MessagesWireSas | null
  readonly safetyNumber?: MessagesWireSas | null
  /** What was presented. */
  readonly binding: MessagesWireContactBinding
  /**
   * The peer controller key this contact was verified against, as the contact record holds it.
   * Carried because it is the anchor the verdict rests on: without it a screen can say a
   * binding verified but not what it was verified against.
   */
  readonly peerControllerKey: string
}

/** The listing: the state directory that was read and every contact resolved from it. */
export interface MessagesContactsListBody {
  readonly status: 'ok'
  /** Absolute state directory the listing was built from, so the screen can name what it read. */
  readonly root: string
  readonly contacts: readonly MessagesWireContactEntry[]
  /** Malformed rows omitted from this listing, identified without unsafe control characters. */
  readonly skipped?: readonly MessagesSkippedContact[]
}

export interface MessagesSkippedContact {
  readonly index: number
  readonly reason: 'messages:contact-malformed'
  readonly subject: string
}

/**
 * The query fields a listing or a thread request may NEVER carry.
 *
 * THE STATE DIRECTORY IS HOST-OWNED, EXACTLY AS THE DOCUMENTS FACE'S ROOT IS. A route that reads
 * whichever directory the caller names is a path-traversal hole: the browser would be choosing
 * which node's contacts, keys and mail this process touches, and it has no way to know the right
 * answer anyway. So the host resolves both directories from its own configuration and a request
 * that names either one is REFUSED BY NAME rather than obeyed or ignored — silently ignoring it
 * would leave the caller believing it had chosen.
 */
export const MESSAGES_HOST_OWNED_QUERY_FIELDS: readonly string[] = ['root', 'controllerDir']

/** Every reason this face refuses. See the module header for each condition. */
export type MessagesRefusalReason =
  | 'messages:confirm-npub-invalid'
  | 'messages:confirm-body-unreadable'
  | 'messages:confirm-no-such-contact'
  | 'messages:confirm-not-bound'
  | 'messages:confirm-safety-version-mismatch'
  | 'messages:confirm-comparison-required'
  | 'messages:confirm-signer-unreachable'
  | 'messages:confirm-signer-declined'
  | 'messages:confirm-challenge-mismatch'
  | 'messages:confirm-not-verified'
  | 'messages:confirm-write-failed'
  | 'messages:confirm-writer-absent'
  // **"THE MODULE IS THERE AND WILL NOT LOAD" IS NOT "THE MODULE IS NOT THERE."** `confirm-contact-route.ts`'s
  // refusals map gained these two names so a broken writer and a missing one stop being one fact to every caller —
  // and a route that says "absent" about a file that is present sends somebody looking in the wrong place.
  //
  // **THE NAMES REACHED THE MAP AND NOT THIS UNION, WHICH IS THE ONLY PLACE THAT DECIDES WHAT A `messages:` KEY MAY
  // BE.** The result was two errors that looked like different problems — `TS2345` at the map, because the new values
  // are not members of this type, and `TS2678` at the switch in `index.ts`, because a case cannot compare against a
  // union that excludes it. **One omission, two symptoms, and neither symptom is where the fix goes.**
  | 'messages:confirm-writer-unloadable'
  | 'messages:confirm-writer-unusable'
  | 'messages:identity-reissue-failed'
  | 'messages:identity-changed'
  | 'messages:add-npub-invalid'
  | 'messages:add-controller-invalid'
  | 'messages:add-binding-invalid'
  | 'messages:add-name-invalid'
  | 'messages:add-body-unreadable'
  | 'messages:add-already-present'
  | 'messages:add-refresh-target'
  | 'messages:add-refresh-binding'
  | 'messages:add-contacts-unreadable'
  | 'messages:add-writer-absent'
  | 'messages:add-write-failed'
  | 'messages:contacts-state-missing'
  | 'messages:contacts-unparseable'
  | 'messages:contacts-domain-unknown'
  | 'messages:contact-malformed'
  | 'messages:no-controller-record'
  | 'messages:aumlok-not-linked'
  | 'messages:malformed-request'
  | 'messages:request-body-unreadable'
  | 'messages:no-such-route'
  | 'messages:unreadable-state'
  | 'messages:state-directory-named'
  | 'messages:text-empty'
  | 'messages:text-too-long'
  | 'messages:key-missing'
  | 'messages:key-unreadable'
  | 'messages:contact-peer-key-malformed'
  | 'messages:relays-unreachable'
  | 'messages:nobody-accepted'
  | 'messages:reads-unavailable'
  | 'messages:sender-unproven'
  | 'messages:send-timeout'
  | 'messages:thread-timeout'

/** The reader's refusals: the ones a node's own files produce. */
export const MESSAGES_STORE_REFUSALS: readonly MessagesRefusalReason[] = [
  'messages:contacts-state-missing',
  'messages:contacts-unparseable',
  'messages:contacts-domain-unknown',
  'messages:contact-malformed',
  'messages:no-controller-record',
  'messages:aumlok-not-linked',
  'messages:unreadable-state',
  'messages:key-missing',
  'messages:key-unreadable',
  'messages:contact-peer-key-malformed',
]

/** The wire's own refusals: the ones a caller can earn without any file being involved. */
export const MESSAGES_WIRE_REFUSALS: readonly MessagesRefusalReason[] = [
  'messages:identity-reissue-failed',
  'messages:identity-changed',
  'messages:malformed-request',
  'messages:request-body-unreadable',
  'messages:no-such-route',
  'messages:state-directory-named',
  'messages:text-empty',
  'messages:text-too-long',
  'messages:relays-unreachable',
  'messages:nobody-accepted',
  'messages:reads-unavailable',
  'messages:sender-unproven',
  'messages:send-timeout',
  'messages:thread-timeout',
]

/**
 * The relay-side refusals: the ones that mean "the network did not carry this".
 *
 * They are kept in their own group because they are the only refusals in this vocabulary whose
 * cause is OUTSIDE this machine, and because the difference between them is the difference
 * between "nobody answered my read" and "nobody took my message" — which are the two things a
 * person waiting needs told apart. The two budget refusals and the unproven-sender refusal belong
 * to the same group for the same reason: none of them is the caller's mistake and none is a fact
 * about this node's own files.
 */
export const MESSAGES_RELAY_REFUSALS: readonly MessagesRefusalReason[] = [
  'messages:relays-unreachable',
  'messages:nobody-accepted',
  'messages:reads-unavailable',
  'messages:sender-unproven',
  'messages:send-timeout',
  'messages:thread-timeout',
]

/** Every refusal reason, reader-side and wire-side. */
export const MESSAGES_REFUSAL_REASONS: readonly MessagesRefusalReason[] = [
  'messages:add-refresh-target',
  'messages:add-refresh-binding',
  ...MESSAGES_STORE_REFUSALS,
  ...MESSAGES_WIRE_REFUSALS,
  'messages:add-binding-invalid',
  'messages:confirm-npub-invalid',
  'messages:confirm-body-unreadable',
  'messages:confirm-no-such-contact',
  'messages:confirm-not-bound',
  'messages:confirm-safety-version-mismatch',
  'messages:confirm-comparison-required',
  'messages:confirm-signer-unreachable',
  'messages:confirm-signer-declined',
  'messages:confirm-challenge-mismatch',
  'messages:confirm-not-verified',
  'messages:confirm-write-failed',
  'messages:confirm-writer-absent',
  'messages:confirm-writer-unloadable',
  'messages:confirm-writer-unusable',
]

/**
 * Whether an evidence record was written for the message(s) an answer is about, or was never owed.
 *
 * This is NOT a refusal and it does not replace one. A message that was published and a record that
 * was not written are two different facts, and the second must never be allowed to destroy the
 * first — nor to hide inside it. So a successful send or read carries this, and `not-recorded` is
 * reported exactly as plainly as a refusal is.
 *
 * `none` IS NOT A THIRD WAY OF SAYING `not-recorded`. It is the empty thread: a read that opened no
 * wrap, where no record was owed at all. Without it, an empty conversation had to report one of the
 * other two and both would be false — `recorded` vacuously, because no record exists, and
 * `not-recorded` because nothing failed.
 */
export type MessagesEvidenceOutcome = 'recorded' | 'not-recorded' | 'none'

/** All three outcomes, so a parser and a caller can assert the set is closed. */
export const MESSAGES_EVIDENCE_OUTCOMES: readonly MessagesEvidenceOutcome[] = ['recorded', 'not-recorded', 'none']

/**
 * A send no relay accepted has nothing to record: no wrap of this message was published.
 *
 * Kept apart from {@link MESSAGES_EVIDENCE_UNWRITABLE} on purpose. "The message never left" and "the
 * message left and its record could not be written" call for different actions, and collapsing them
 * would make the one honest sentence about a failed send useless.
 */
export const MESSAGES_EVIDENCE_NO_PUBLISH = 'messages:evidence-no-publish'

/**
 * A thread that opened no wrap has nothing to record and nothing it FAILED to record.
 *
 * The only reason `none` ever carries, and the reason `none` is neither of the other two outcomes:
 * no wrap was opened, so no record was owed, and reporting a failure here would invent one — while
 * `recorded` would claim a record exists for a wrap that was never read.
 */
export const MESSAGES_EVIDENCE_NO_WRAP_OPENED = 'messages:evidence-no-wrap-opened'

/** This deployment's nostr tree carries no `evidence.mjs`, so no record can be written at all. */
export const MESSAGES_EVIDENCE_MODULE_ABSENT = 'messages:evidence-module-absent'

/**
 * The evidence module's own code for a record that could not be written to disk.
 *
 * A LITERAL, MIRRORING `EVIDENCE_REFUSE.UNWRITABLE` IN `plugins/aukora-nostr/lib/evidence.mjs`, and
 * it has to be: this face may not import that module statically — the face build compiles inside a
 * clone of the pinned harness where the nostr tree does not exist — so the name is repeated here and
 * the court asserts the loaded module's own constant equals it. It is also the fallback for a throw
 * that carries no code at all, where "could not be written" is the only true thing left to say.
 */
export const MESSAGES_EVIDENCE_UNWRITABLE = 'nostr-evidence-unwritable'

/**
 * The two leaf fields an answer carries about evidence.
 *
 * THEY ARE A PAIR, AND THE PAIR IS THE CONTRACT: `recorded` carries no reason because there is
 * nothing to explain, and each of the other two always carries one, so no caller has to guess
 * whether a missing reason meant success or a swallowed failure. `none` carries exactly one reason —
 * {@link MESSAGES_EVIDENCE_NO_WRAP_OPENED} — because there is exactly one thing to say about it.
 */
export interface MessagesEvidenceFields {
  /**
   * `recorded` when the record for this message was written, `not-recorded` when one was owed and
   * could not be written, `none` when no wrap was opened and so no record was owed.
   */
  readonly evidence: MessagesEvidenceOutcome
  /**
   * The named reason `evidence` is not `recorded`: the module's own code, one of this face's own, or
   * {@link MESSAGES_EVIDENCE_NO_WRAP_OPENED} for `none`. Null exactly when the record was written.
   */
  readonly evidenceRefusal: string | null
}

/** Whether a value is one of the three outcomes. */
export function isMessagesEvidenceOutcome(value: unknown): value is MessagesEvidenceOutcome {
  return MESSAGES_EVIDENCE_OUTCOMES.some(outcome => outcome === value)
}

/**
 * Validate the evidence pair off the wire.
 *
 * THE PAIR IS CHECKED, NOT TWO FIELDS IN ISOLATION: `recorded` with a reason, `not-recorded`
 * without one, and `none` with anything other than its own code are all refused, because each is a
 * body that would leave a screen unable to say whether the record exists, was owed, or neither.
 * `undefined` means "not a pair this face wrote".
 *
 * WHAT THIS FUNCTION CANNOT SEE is whether the outcome matches the body it rides on — a thread's
 * messages or a send's accepted list. That pairing is asserted by the two body parsers below, at
 * the place each body's own signal is in hand.
 *
 * @param value - the body or entry carrying `evidence` and `evidenceRefusal`.
 * @returns the pair, or undefined when it is not one this face serves.
 */
function parseEvidencePair(
  value: Record<string, unknown>,
): MessagesEvidenceFields | undefined {
  if (!isMessagesEvidenceOutcome(value.evidence)) return undefined
  if (value.evidence === 'recorded') {
    return value.evidenceRefusal === null ? { evidence: 'recorded', evidenceRefusal: null } : undefined
  }
  if (value.evidence === 'none') {
    // `none` HAS ONE REASON AND IT IS NOT NULL. A body offering a different code, or none at all,
    // would leave a screen unable to tell "there was nothing to record" from "the record failed",
    // which is the whole difference this outcome was added to carry.
    return value.evidenceRefusal === MESSAGES_EVIDENCE_NO_WRAP_OPENED
      ? { evidence: 'none', evidenceRefusal: MESSAGES_EVIDENCE_NO_WRAP_OPENED }
      : undefined
  }
  return isText(value.evidenceRefusal)
    ? { evidence: 'not-recorded', evidenceRefusal: value.evidenceRefusal }
    : undefined
}

/**
 * Build the pair, and make the mismatch unrepresentable at the place it would be written.
 *
 * @param evidence - the outcome.
 * @param evidenceRefusal - the named reason, ignored when the outcome is `recorded` or `none`: the
 * first has nothing to explain and the second has exactly one thing to say.
 * @returns the pair, never `recorded` with a reason and never `not-recorded` or `none` without one.
 */
export function messagesEvidenceFields(
  evidence: MessagesEvidenceOutcome,
  evidenceRefusal: string | null,
): MessagesEvidenceFields {
  if (evidence === 'recorded') return { evidence: 'recorded', evidenceRefusal: null }
  if (evidence === 'none') return { evidence: 'none', evidenceRefusal: MESSAGES_EVIDENCE_NO_WRAP_OPENED }
  return {
    evidence: 'not-recorded',
    // An uncoded throw is still a record that could not be written, and saying so is the only
    // honest answer left. A bare `not-recorded` with no reason would read as a shrug.
    evidenceRefusal: evidenceRefusal === null || evidenceRefusal === '' ? MESSAGES_EVIDENCE_UNWRITABLE : evidenceRefusal,
  }
}

/** A refusal: the named reason plus the request it refused. */
export interface MessagesRefusalBody {
  readonly status: 'refused'
  readonly reason: MessagesRefusalReason
  /** The request (or path, or entry) as it arrived, so the reason names its subject. */
  readonly subject: string
}

/** What a listing returns: the contacts, or a named refusal. */
export type MessagesContactsAnswer = MessagesContactsListBody | MessagesRefusalBody

/** A request for one conversation: which contact, and how far back to look. */
export interface MessagesThreadRequest {
  /** The npub whose conversation is being asked for. */
  readonly npub: string
  /** Unix seconds: the oldest message to look for. Absent means the relay module's lookback. */
  readonly since: number | null
}

/** One message on the wire. Four leaf fields, and `at` is the RUMOR's real time. */
export interface MessagesWireMessage {
  /** The rumor's own id; the same message from two relays de-duplicates to one entry. */
  readonly id: string
  /** `them` for a message the peer sent, `me` for this node's own copy of what it sent. */
  readonly from: 'them' | 'me'
  /** The message text. */
  readonly text: string
  /** Unix seconds from the RUMOR, never from the jittered gift wrap around it. */
  readonly at: number
}

/** The conversation with one contact, and what is known about who that is. */
export interface MessagesThreadBody {
  readonly status: 'ok'
  readonly npub: string
  /**
   * One of the four contact states, or UNKNOWN when this npub is not in the contacts file.
   * UNKNOWN is stated rather than refused: the messages really arrived, and hiding them would
   * be a worse lie than saying plainly that no claim exists about this key.
   */
  readonly contactState: 'VERIFIED' | 'BOUND' | 'TEST' | 'UNBOUND' | 'FOREIGN' | 'UNKNOWN'
  /** The SAS to compare out of band, or null — present only for a binding that verified. */
  readonly sas: MessagesWireSas | null
  readonly safetyNumber?: MessagesWireSas | null
  /** Oldest first. */
  readonly messages: readonly MessagesWireMessage[]
  /** Which relays answered this read. An empty list means the refusal was not a read. */
  readonly answered: readonly string[]
  /** False when bounded relay paging still has unfinished windows. */
  readonly inboxComplete?: boolean
  /**
   * Whether every wrap this read OPENED AND ATTRIBUTED to the requested sender has an evidence
   * record. A wrap that failed to open, or that came from somebody else, is owed no record and is
   * not counted here — an unopenable wrap is not evidence of a message.
   *
   * THE THREE OUTCOMES ARE THREE FACTS, AND NONE OF THEM IS VACUOUS. `recorded` means a record
   * exists for at least one opened wrap, and never means anything else. `not-recorded` means a
   * record was OWED for an opened wrap and could not be written, with its reason in
   * {@link evidenceRefusal}. `none` means this read opened NO wrap at all — an empty thread — where
   * no record was owed, so neither of the other two would be true: `recorded` would claim evidence
   * nobody holds and `not-recorded` would claim a failure that did not happen. `none` carries
   * {@link MESSAGES_EVIDENCE_NO_WRAP_OPENED} for the same reason the others carry theirs.
   */
  readonly evidence: MessagesEvidenceOutcome
  /**
   * The named reason `evidence` is not `recorded`: a code for `not-recorded`, and always
   * {@link MESSAGES_EVIDENCE_NO_WRAP_OPENED} for `none`. Null exactly when it is `recorded`.
   */
  readonly evidenceRefusal: string | null
}

/** A send request: one npub, and the text to put in the message. */
export interface MessagesSendRequest {
  /** The recipient's npub. */
  readonly npub: string
  /** The message text, as typed. */
  readonly text: string
}

/**
 * Which copy of one NIP-17 send a per-copy outcome is about.
 *
 * CLOSED, AND TWO NAMES, because NIP-17 produces exactly two kinds of copy for this face's send:
 * the one addressed to the contact the message was typed to, and the one addressed to this node's
 * own key so the sent message can be read back. A third name would have to mean a third kind of
 * copy, and there is none.
 */
export type MessagesCopyRole = 'recipient' | 'self'

/** Both roles, so a parser and a caller can assert the set is closed. */
export const MESSAGES_COPY_ROLES: readonly MessagesCopyRole[] = ['recipient', 'self']

/**
 * What happened to ONE copy of a NIP-17 message, on its own.
 *
 * THIS IS THE FACT A FLAT `accepted` LIST CANNOT CARRY. The two copies are published separately, so
 * the recipient's copy can be refused while this node's own is accepted; the aggregate `ok` is
 * `true` in that case, and only this outcome says which copy the relays kept. `refusal` is the
 * named code the relay module gave for a copy nobody took — never prose to parse, and never a code
 * invented here.
 *
 * THE PAIRING IS THE CONTRACT, IN BOTH DIRECTIONS: an accepted copy names at least one relay and no
 * refusal, and a refused copy names no relay and always a refusal. The parser below refuses a body
 * that breaks either half, so a screen can never show a copy as taken without a relay to show for
 * it, nor as refused without a reason.
 */
export interface MessagesCopyOutcome {
  /** Which copy of the send this outcome is about. */
  readonly copy: MessagesCopyRole
  /**
   * The gift wrap's OWN event id — the event that was handed to the relays, and the id the evidence
   * record for this copy is named by. It is never the rumor's id, which names no published bytes.
   */
  readonly eventId: string
  /** True only when at least one relay accepted THIS copy. */
  readonly accepted: boolean
  /** The relays that accepted this copy, in the order they were asked. Empty when it was refused. */
  readonly relays: readonly string[]
  /** The named code for why this copy was refused: null exactly when `accepted` is true. */
  readonly refusal: string | null
}

/**
 * What a send reports when it was attempted.
 *
 * `ok` IS DERIVED FROM THE PER-COPY OUTCOMES, NEVER SET BY HAND, and `accepted` is the union of
 * their relay lists. A send that no relay accepted reports `ok: false` with the relay module's
 * verdict in `verdict`, because telling a person their message was sent when nobody took it is the
 * one failure this route exists to avoid.
 *
 * THE STATUS IS THE SINGLE LITERAL `sent`, and that is load-bearing: a member whose `status` is
 * a UNION of literals is not removed by a `status === 'refused'` check, so every caller that
 * narrows an answer would keep this type in the refusal branch and fail to compile on `reason`.
 * A send that no relay took is still `sent` — it was composed and published — with `ok: false`.
 */
export interface MessagesSendBody {
  readonly status: 'sent'
  /** True only when at least one relay accepted the wrap. */
  readonly ok: boolean
  /** The relays that accepted, in the order they were asked. Empty when none did. */
  readonly accepted: readonly string[]
  /**
   * ONE OUTCOME PER COPY OF THIS SEND, added BESIDE the aggregate and never instead of it.
   *
   * NIP-17 wraps the recipient's copy and this node's own copy, and this route publishes each of
   * them on its own, so one can be refused while the other is accepted. `ok` above is the aggregate
   * of these outcomes — true when ANY copy was accepted — and `accepted` above is the union of the
   * relays they name. The parser refuses a body where the aggregate and the outcomes disagree, in
   * either direction, so the two can never tell a person different stories about one send.
   *
   * Every copy of the send appears here exactly once: a body naming one copy twice would describe a
   * send this face did not make.
   */
  readonly copies: readonly MessagesCopyOutcome[]
  /** The relay module's own verdict: null when accepted is non-empty, else its named refusal. */
  readonly verdict: string | null
  /** The npub the message went to. */
  readonly npub: string
  /** The rumor's id, so the screen can match its own message when the thread is re-read. */
  readonly id: string
  /** Unix seconds from the RUMOR — the same clock the thread reports. */
  readonly at: number
  /**
   * Whether the evidence records for this send's ACCEPTED copies were written.
   *
   * ONE RECORD PER ACCEPTED COPY, each named by its own wrap's id, so `recorded` here means EVERY
   * copy a relay accepted has a record — and it means that with one copy accepted or with two. A
   * REFUSED COPY OWES NO RECORD AND IS NOT COUNTED AGAINST THIS OUTCOME: nothing was published for
   * it, and a record for a message that never left is exactly the false claim this lane removes; the
   * code saying why that copy was not published rides in its own entry in `copies`. So a send whose
   * recipient copy was refused and whose own copy was accepted answers `evidence: 'recorded'`, and
   * that is true: one copy was published, and the record of it exists.
   *
   * A SEND THAT A RELAY ACCEPTED AND A RECORD THAT COULD NOT BE WRITTEN ARE BOTH TRUE AT ONCE, and
   * `ok` stays true: the message is the point and the record is the evidence of it. A send whose
   * `accepted` is empty has no published wrap to be evidence of, and is `not-recorded` under
   * {@link MESSAGES_EVIDENCE_NO_PUBLISH} rather than under a write failure.
   *
   * A SEND IS NEVER `none`. That outcome is a thread that opened no wrap, and a send always has a
   * message: either one a relay took, or one that never left. The parser refuses a body that claims
   * otherwise while naming a relay that accepted.
   */
  readonly evidence: MessagesEvidenceOutcome
  /**
   * The named reason `evidence` is not `recorded`, or null when it is `recorded`. A send is never
   * `none`, so this is always the code for a record that could not be written or
   * {@link MESSAGES_EVIDENCE_NO_PUBLISH}.
   */
  readonly evidenceRefusal: string | null
}

/** What a send answers with: the accounting, or a named refusal. */
export type MessagesSendAnswer = MessagesSendBody | MessagesRefusalBody

/** Whether a value is a plain JSON object, for the parsers below. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether an object carries exactly the named keys and nothing else. */
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(value)
  return present.length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

/** A non-empty string, for the parsers below. */
function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/** Validate contact data before trimming or projecting it, including nested unsigned metadata. */
export function contactFieldsAreSafe(value: unknown, depth = 0): boolean {
  if (depth > 32) return false
  if (typeof value === 'string') return !/[\p{Cc}\u202a-\u202e\u2066-\u2069\p{Zl}\p{Zp}]/u.test(value)
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).every(([key, field]) => contactFieldsAreSafe(key, depth + 1) && contactFieldsAreSafe(field, depth + 1))
  }
  return true
}

/** Escape controls before a rejected field is named in a diagnostic. Never echo raw JSON. */
export function safeContactDiagnostic(value: unknown): string {
  if (typeof value !== 'string') return 'unreadable'
  return JSON.stringify(value.slice(0, 120)).replace(/[\p{Cc}\p{Bidi_Control}\p{Zl}\p{Zp}]/gu,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

/** Keep usable contacts readable while explicitly accounting for each omitted row. */
export function skippedContact(index: number, value: unknown): MessagesSkippedContact {
  const fields = isRecord(value) ? value : {}
  const name = typeof fields.name === 'string' ? ` name ${safeContactDiagnostic(fields.name)}` : ''
  const npub = typeof fields.npub === 'string' ? ` npub ${safeContactDiagnostic(fields.npub)}` : ''
  return { index, reason: 'messages:contact-malformed', subject: `entry ${index}${name}${npub}` }
}

/** The displayed own half; the backend independently verifies the complete submitted pair. */
export function parseSafetyNumber(value: unknown): MessagesWireSas | null | undefined {
  if (value === null) return null
  if (!isRecord(value) || !hasExactKeys(value, ['digits', 'spoken', 'comparisonGroupIndex']) || !contactFieldsAreSafe(value)) return undefined
  if (typeof value.digits !== 'string' || !/^[0-9]{35}$/u.test(value.digits)) return undefined
  if (value.spoken !== value.digits.match(/.{5}/gu)?.join(' ')) return undefined
  if (value.comparisonGroupIndex !== 0 && value.comparisonGroupIndex !== 7) return undefined
  return { digits: value.digits, spoken: String(value.spoken), comparisonGroupIndex: value.comparisonGroupIndex }
}

/** Whether a value is one of the four states. */
export function isMessagesContactState(value: unknown): value is MessagesWireContactState {
  return MESSAGES_WIRE_CONTACT_STATES.some(state => state === value)
}

/** Whether a value is one of the three binding statuses. */
export function isMessagesContactBinding(value: unknown): value is MessagesWireContactBinding {
  return value === 'absent' || value === 'verified' || value === 'refused'
}

/** Whether a value is one of the named refusal reasons. */
export function isMessagesRefusalReason(value: unknown): value is MessagesRefusalReason {
  return MESSAGES_REFUSAL_REASONS.some(reason => reason === value)
}

/** Whether a value is one of the two copy roles. */
export function isMessagesCopyRole(value: unknown): value is MessagesCopyRole {
  return MESSAGES_COPY_ROLES.some(role => role === value)
}

/**
 * Build a refusal body.
 * @param reason - the named reason.
 * @param subject - what was refused.
 * @returns the body the route answers with.
 */
export function messagesRefusalBody(reason: MessagesRefusalReason, subject: string): MessagesRefusalBody {
  return { status: 'refused', reason, subject }
}

/**
 * The request path for the listing.
 *
 * Takes no state directory and no controller directory ON PURPOSE. Both are resolved by the
 * host: the state directory from its own environment (`messagesStateDir`) and the controller
 * directory from the `aumlokControl` service — the same `aukora-aumlok` row config the organ is
 * mounted with, NOT from an environment name of this face's own. So this helper returns the bare
 * endpoint and the screen fetches it.
 *
 * @returns the endpoint to fetch the listing from.
 */
export function messagesContactsRequest(): string {
  return MESSAGES_CONTACTS_ENDPOINT
}

/**
 * Whether a query string names a field the host owns.
 * @param search - the request query string, with or without its leading `?`.
 * @returns the offending field name, or undefined when the query names none.
 */
export function messagesHostOwnedQueryField(search: string): string | undefined {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  return MESSAGES_HOST_OWNED_QUERY_FIELDS.find(field => params.has(field))
}

/**
 * Whether a path names the listing.
 *
 * PURE: no filesystem, no environment, no clock. Both halves import this function, so the path
 * the screen builds and the path the host parses cannot drift apart.
 *
 * @param pathname - the request pathname, already stripped of its query.
 * @param search - the request query string, with or without its leading `?`.
 * @returns true when this request asks for the listing and names no host-owned field.
 */
export function parseMessagesContactsRequest(pathname: string, search: string): boolean {
  if (pathname !== MESSAGES_CONTACTS_ENDPOINT && pathname !== MESSAGES_CONTACTS_REQUEST_ENDPOINT) return false
  return messagesHostOwnedQueryField(search) === undefined
}

/** Parse one SAS off the wire, or undefined when it is not one this face serves. */
function parseWireSas(value: unknown): MessagesWireSas | undefined {
  return parseSafetyNumber(value) ?? undefined
}

/**
 * Parse one contact entry off the wire.
 * @param value - one element of the listing's `contacts`.
 * @returns the entry, or undefined when it is not what this face serves.
 */
export function parseMessagesContactEntry(value: unknown): MessagesWireContactEntry | undefined {
  if (!isRecord(value) || !contactFieldsAreSafe(value)) return undefined
  const keys = ['npub', 'name', 'state', 'reason', 'subject', 'sas', 'binding', 'peerControllerKey']
  if (Object.hasOwn(value, 'safetyNumber')) keys.push('safetyNumber')
  if (!hasExactKeys(value, keys)) return undefined
  if (!isText(value.npub) || !isText(value.name)) return undefined
  if (!isMessagesContactState(value.state)) return undefined
  // The anchor is 64 hex characters or the entry is not one this face wrote. An empty string is
  // how the store reports a malformed key, and it is refused here as well as there.
  if (typeof value.peerControllerKey !== 'string') return undefined
  if (!/^[0-9a-f]{64}$/iu.test(value.peerControllerKey)
    && !(value.peerControllerKey === '' && value.state === 'UNBOUND' && value.binding === 'absent')) return undefined
  // `reason` may be empty here and only here: a resolver answer with no reason is reported
  // as an empty string rather than invented, and the state is what a caller routes on.
  if (typeof value.reason !== 'string') return undefined
  if (value.subject !== null && !isText(value.subject)) return undefined
  const binding = value.binding
  if (!isMessagesContactBinding(binding)) return undefined
  const sas = parseWireSasForBinding(value.sas, binding, value.state)
  if (sas === undefined) return undefined
  const safetyNumber = value.safetyNumber === undefined ? null : parseSafetyNumber(value.safetyNumber)
  if (safetyNumber === undefined || (safetyNumber !== null && (binding !== 'verified' || !['BOUND', 'TEST', 'VERIFIED'].includes(value.state)))) return undefined
  return {
    npub: value.npub,
    name: value.name,
    state: value.state,
    reason: value.reason,
    subject: value.subject,
    sas,
    ...(Object.hasOwn(value, 'safetyNumber') ? { safetyNumber } : {}),
    binding,
    peerControllerKey: value.peerControllerKey,
  }
}

/**
 * The SAS one entry may carry, given what vouched for it.
 *
 * BOUND and TEST may lack a safety number when either identity cannot use the current
 * protocol. VERIFIED requires a current number; other states or unverified bindings
 * must not offer one.
 *
 * @param value - the entry's `sas` field.
 * @param binding - the entry's already-validated binding status.
 * @returns the SAS or null, or undefined when the pair is not one this face serves.
 */
function parseWireSasForBinding(
  value: unknown,
  binding: MessagesWireContactBinding,
  state: MessagesWireContactState,
): MessagesWireSas | null | undefined {
  if (binding === 'verified') return parseThreadSas(value, state)
  return value === null && state !== 'VERIFIED' ? null : undefined
}

/**
 * Validate a listing body off the wire.
 * @param value - the parsed JSON body.
 * @returns the body, or undefined when it is not what this face serves.
 */
export function parseMessagesContactsBody(value: unknown): MessagesContactsListBody | undefined {
  if (!isRecord(value)) return undefined
  const keys = ['status', 'root', 'contacts']
  if (Object.hasOwn(value, 'skipped')) keys.push('skipped')
  if (!hasExactKeys(value, keys)) return undefined
  if (value.status !== 'ok' || !isText(value.root) || !Array.isArray(value.contacts)) return undefined
  const skipped: MessagesSkippedContact[] = []
  if (Object.hasOwn(value, 'skipped')) {
    if (!Array.isArray(value.skipped)) return undefined
    for (const raw of value.skipped) {
      if (!isRecord(raw) || !hasExactKeys(raw, ['index', 'reason', 'subject'])) return undefined
      if (typeof raw.index !== 'number' || !Number.isSafeInteger(raw.index) || raw.index < 0
        || raw.reason !== 'messages:contact-malformed' || !isText(raw.subject)
        || raw.subject.length > 2048 || !contactFieldsAreSafe(raw.subject)) return undefined
      skipped.push({ index: raw.index, reason: raw.reason, subject: raw.subject })
    }
  }
  const contacts: MessagesWireContactEntry[] = []
  for (const [index, raw] of value.contacts.entries()) {
    const entry = parseMessagesContactEntry(raw)
    if (entry === undefined) skipped.push(skippedContact(index, raw))
    else contacts.push(entry)
  }
  return { status: 'ok', root: value.root, contacts, ...(skipped.length === 0 ? {} : { skipped }) }
}

/**
 * Validate a listing answer, refusal included, off the wire.
 * @param value - the parsed JSON body.
 * @returns the answer, or undefined when it is neither a listing nor a named refusal.
 */
export function parseMessagesContactsAnswer(value: unknown): MessagesContactsAnswer | undefined {
  if (isRecord(value) && value.status === 'refused') return parseMessagesRefusalBody(value)
  return parseMessagesContactsBody(value)
}

/**
 * Validate a refusal body off the wire.
 * @param value - the parsed JSON body.
 * @returns the refusal, or undefined when the reason is not one this face defines.
 */
export function parseMessagesRefusalBody(value: unknown): MessagesRefusalBody | undefined {
  if (!isRecord(value)) return undefined
  if (!hasExactKeys(value, ['status', 'reason', 'subject'])) return undefined
  if (value.status !== 'refused' || typeof value.subject !== 'string') return undefined
  if (!isMessagesRefusalReason(value.reason)) return undefined
  return { status: 'refused', reason: value.reason, subject: value.subject }
}

/**
 * The UTF-8 length of a message, which is what {@link MESSAGES_TEXT_MAX_BYTES} bounds.
 *
 * Measured with `TextEncoder` rather than a Node `Buffer`, because this module is carried by
 * the browser bundle as well as the host: a Node global here would make the contract
 * unloadable in the page it exists to serve. `TextEncoder` is the same UTF-8 encoder on both
 * sides, so the number is the one the host measures when the message is actually composed.
 *
 * @param text - the message text.
 * @returns the byte length.
 */
export function messagesTextBytes(text: string): number {
  return new TextEncoder().encode(text).length
}

/**
 * The conversation a thread path names, or undefined when it names something else.
 *
 * `since` is OPTIONAL and defaults to null, which the route reads as "use the relay module's
 * own lookback". That default is not a convenience: NIP-17 randomises gift-wrap timestamps
 * into the two days before now, so a caller that passed a narrow `since` would silently see no
 * messages from relays that did store them.
 *
 * @param pathname - the request pathname, already stripped of its query.
 * @param search - the request query string, with or without its leading `?`.
 * @returns the request, or undefined when it is not the shape this face takes.
 */
export function parseMessagesThreadRequest(pathname: string, search: string): MessagesThreadRequest | undefined {
  if (pathname !== MESSAGES_THREAD_ENDPOINT) return undefined
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  if (messagesHostOwnedQueryField(search) !== undefined) return undefined
  const npub = params.get('npub')
  if (!isText(npub)) return undefined
  const since = params.get('since')
  if (since === null) return { npub, since: null }
  // A `since` that is not a positive whole number of seconds names no window this face can
  // read. Refused rather than defaulted, because defaulting would answer a different question
  // than the caller asked.
  if (!/^\d+$/u.test(since) || Number(since) <= 0) return undefined
  return { npub, since: Number(since) }
}

/**
 * Validate one message off the wire.
 * @param value - one element of a thread's `messages`.
 * @returns the message, or undefined when it is not what this face serves.
 */
export function parseMessagesWireMessage(value: unknown): MessagesWireMessage | undefined {
  if (!isRecord(value)) return undefined
  if (!hasExactKeys(value, ['id', 'from', 'text', 'at'])) return undefined
  if (!isText(value.id) || !isText(value.text)) return undefined
  if (value.from !== 'them' && value.from !== 'me') return undefined
  if (typeof value.at !== 'number' || !Number.isInteger(value.at) || value.at < 0) return undefined
  return { id: value.id, from: value.from, text: value.text, at: value.at }
}

/**
 * Validate a thread body off the wire.
 * @param value - the parsed JSON body.
 * @returns the body, or undefined when it is not what this face serves.
 */
export function parseMessagesThreadBody(value: unknown): MessagesThreadBody | undefined {
  if (!isRecord(value)) return undefined
  const keys = ['status', 'npub', 'contactState', 'sas', 'messages', 'answered', 'evidence', 'evidenceRefusal']
  if (Object.hasOwn(value, 'safetyNumber')) keys.push('safetyNumber')
  if (Object.hasOwn(value, 'inboxComplete')) keys.push('inboxComplete')
  if (value.inboxComplete !== undefined && typeof value.inboxComplete !== 'boolean') return undefined
  if (!hasExactKeys(value, keys)) return undefined
  if (value.status !== 'ok' || !isText(value.npub)) return undefined
  const state = value.contactState
  if (state !== 'VERIFIED' && state !== 'BOUND' && state !== 'TEST' && state !== 'UNBOUND' && state !== 'FOREIGN' && state !== 'UNKNOWN') {
    return undefined
  }
  // The SAS rule, restated here: a thread may carry a SAS only when the contact state is one a
  // verified binding produces. A thread that showed a string for UNBOUND or UNKNOWN would undo
  // the whole point of the four states on the one screen where a person is most likely to
  // compare it.
  const parsedSas = parseThreadSas(value.sas, state)
  if (parsedSas === undefined) return undefined
  const sas = parsedSas
  const safetyNumber = value.safetyNumber === undefined ? null : parseSafetyNumber(value.safetyNumber)
  if (!contactFieldsAreSafe(value.npub) || safetyNumber === undefined
    || (safetyNumber !== null && !['BOUND', 'TEST', 'VERIFIED'].includes(state))) return undefined
  if (!Array.isArray(value.messages) || !Array.isArray(value.answered)) return undefined
  if (value.answered.some(relay => typeof relay !== 'string')) return undefined
  const evidence = parseEvidencePair(value)
  if (evidence === undefined) return undefined
  const messages: MessagesWireMessage[] = []
  for (const raw of value.messages) {
    const message = parseMessagesWireMessage(raw)
    if (message === undefined) return undefined
    messages.push(message)
  }
  // THE PAIRING, ENFORCED AGAINST THE SIGNAL A THREAD BODY ACTUALLY CARRIES. A thread body has no
  // `accepted` list, so the count that decides whether a record was owed is `messages`: this read
  // opened at least one wrap exactly when it served at least one message, because every message in
  // a thread comes from a wrap that was opened and attributed. Both directions are refused — `none`
  // over a body that reports messages, and `recorded` over one that reports none — because either
  // way the outcome describes a different read than the body does.
  if (evidence.evidence === 'none' && messages.length > 0) return undefined
  if (evidence.evidence === 'recorded' && messages.length === 0) return undefined
  return {
    status: 'ok',
    npub: value.npub,
    contactState: state,
    sas,
    ...(Object.hasOwn(value, 'safetyNumber') ? { safetyNumber } : {}),
    messages,
    answered: value.answered as string[],
    ...(Object.hasOwn(value, 'inboxComplete') ? { inboxComplete: value.inboxComplete as boolean } : {}),
    ...evidence,
  }
}

/**
 * The SAS a thread may carry, given the contact state it reports.
 *
 * The same pairing rule as the listing, restated for the thread: a SAS exists only for a
 * binding that verified. BOUND and TEST may lack one; only VERIFIED requires one.
 *
 * @param value - the thread's `sas` field.
 * @param state - the thread's own contact state.
 * @returns the SAS or null, or undefined when the pair is not one this face serves.
 */
function parseThreadSas(
  value: unknown,
  state: MessagesThreadBody['contactState'],
): MessagesWireSas | null | undefined {
  if (value === null) return state === 'VERIFIED' ? undefined : null
  if (state !== 'VERIFIED' && state !== 'BOUND' && state !== 'TEST') return undefined
  return parseWireSas(value)
}

/**
 * Validate a send request off the wire.
 * @param value - the parsed JSON body.
 * @returns the request, or undefined when it is not the shape this face takes.
 */
export function parseMessagesSendRequest(value: unknown): MessagesSendRequest | undefined {
  if (!isRecord(value)) return undefined
  if (!hasExactKeys(value, ['npub', 'text'])) return undefined
  if (!isText(value.npub)) return undefined
  // The text may be EMPTY here and is refused by the caller with its own name, because "you
  // typed nothing" and "this body is not a send request" are different answers for a person.
  if (typeof value.text !== 'string') return undefined
  return { npub: value.npub, text: value.text }
}

/**
 * Validate ONE per-copy outcome off the wire.
 *
 * THE PAIRING IS ENFORCED IN BOTH DIRECTIONS, and it is the whole reason this is a function rather
 * than three field checks inside the send parser: a copy that claims `accepted` with no relay to
 * show for it names a publish nobody made, and a copy that claims to be refused while naming a relay
 * that took it is the same lie from the other side. Either is refused rather than rendered, and
 * `refusal` is refused as well when it is empty prose — a code is what a caller routes on.
 *
 * @param value - one element of a send body's `copies`.
 * @returns the outcome, or undefined when it is not one this face serves.
 */
function parseMessagesCopyOutcome(value: unknown): MessagesCopyOutcome | undefined {
  if (!isRecord(value)) return undefined
  if (!hasExactKeys(value, ['copy', 'eventId', 'accepted', 'relays', 'refusal'])) return undefined
  if (!isMessagesCopyRole(value.copy)) return undefined
  if (!isText(value.eventId)) return undefined
  if (typeof value.accepted !== 'boolean') return undefined
  if (!Array.isArray(value.relays) || value.relays.some(relay => !isText(relay))) return undefined
  if (value.accepted) {
    // ACCEPTED MEANS A RELAY IS NAMED, AND NOTHING IS EXPLAINED. Both halves are asserted: a copy
    // taken by nobody is not accepted, and a copy that was taken has no refusal to carry.
    if (value.relays.length === 0) return undefined
    if (value.refusal !== null) return undefined
    return { copy: value.copy, eventId: value.eventId, accepted: true, relays: value.relays as string[], refusal: null }
  }
  // REFUSED MEANS NO RELAY, AND A NAMED REASON. The empty relay list is not decoration: it is the
  // fact that nothing took this copy, and the code is why.
  if (value.relays.length > 0) return undefined
  if (!isText(value.refusal)) return undefined
  return { copy: value.copy, eventId: value.eventId, accepted: false, relays: [], refusal: value.refusal }
}

/**
 * Validate a send answer off the wire, refusal included.
 *
 * @param value - the parsed JSON body.
 * @returns the answer, or undefined when it is not what this face serves.
 */
export function parseMessagesSendBody(value: unknown): MessagesSendAnswer | undefined {
  if (!isRecord(value)) return undefined
  if (value.status === 'refused') return parseMessagesRefusalBody(value)
  const keys = ['status', 'ok', 'accepted', 'copies', 'verdict', 'npub', 'id', 'at', 'evidence', 'evidenceRefusal']
  if (!hasExactKeys(value, keys)) return undefined
  if (value.status !== 'sent' || !isText(value.npub) || !isText(value.id)) return undefined
  if (typeof value.ok !== 'boolean') return undefined
  if (typeof value.at !== 'number' || !Number.isInteger(value.at) || value.at < 0) return undefined
  if (!Array.isArray(value.accepted) || value.accepted.some(relay => typeof relay !== 'string')) return undefined
  if (value.verdict !== null && typeof value.verdict !== 'string') return undefined
  // THE RULE THIS ROUTE EXISTS FOR, ENFORCED AT PARSE TIME TOO: ok is true only when at least
  // one relay accepted, and the verdict is null only in that same case. A body that says
  // otherwise did not come from this face, and a screen must not render it as a sent message.
  const accepted = value.accepted as string[]
  if (value.ok !== (accepted.length > 0)) return undefined
  if ((value.verdict === null) !== (accepted.length > 0)) return undefined
  // THE PER-COPY OUTCOMES, EACH CHECKED AS A PAIR AND EACH NAMED AT MOST ONCE. A send always has at
  // least one copy — the message was composed either way — so an empty list is a body about no
  // message, and the same copy twice is a body about a send this face did not make.
  if (!Array.isArray(value.copies) || value.copies.length === 0) return undefined
  const copies: MessagesCopyOutcome[] = []
  const roles = new Set<MessagesCopyRole>()
  for (const raw of value.copies) {
    const copy = parseMessagesCopyOutcome(raw)
    if (copy === undefined) return undefined
    if (roles.has(copy.copy)) return undefined
    roles.add(copy.copy)
    copies.push(copy)
  }
  // THE AGGREGATE AND THE OUTCOMES ARE ONE FACT READ TWICE, and the parser refuses a body where they
  // read differently IN EITHER DIRECTION: `ok` true while every copy says it was refused, and `ok`
  // false while a copy says a relay took it, are both bodies that would tell a person one thing and
  // a screen another. This is the case the flat list could not express, so it is the case that has
  // to be held together here.
  if (value.ok !== copies.some(copy => copy.accepted)) return undefined
  // AND THE FLAT LIST IS THE SAME FACT AGAIN: `accepted` must name exactly the relays the accepted
  // copies name — no relay that took nothing, and none of a taken copy's relays left out. Compared
  // as sets, because THIS face reports one entry per accepting publish, so one relay that took both
  // copies appears twice above and once per copy here.
  const namedByCopies = new Set<string>()
  for (const copy of copies) for (const relay of copy.relays) namedByCopies.add(relay)
  const namedByBody = new Set(accepted)
  if (namedByBody.size !== namedByCopies.size) return undefined
  for (const relay of namedByBody) if (!namedByCopies.has(relay)) return undefined
  const evidence = parseEvidencePair(value)
  if (evidence === undefined) return undefined
  // AND THE SAME RULE FOR THE RECORD: a send nobody took has no published wrap, so a body claiming
  // evidence for it claims evidence about a message that never left. Refused here rather than
  // rendered, which is the one failure this whole lane exists to remove.
  if (evidence.evidence === 'recorded' && accepted.length === 0) return undefined
  // AND THE OTHER DIRECTION, ON THIS BODY'S OWN SIGNAL: `none` says the read opened no wrap, which
  // cannot be true of a send a relay accepted — that send has a published wrap, so a record was
  // owed for it and "there was nothing to record" is a claim about a different body.
  if (evidence.evidence === 'none' && accepted.length > 0) return undefined
  return {
    status: 'sent',
    ok: value.ok,
    accepted,
    copies,
    verdict: value.verdict,
    npub: value.npub,
    id: value.id,
    at: value.at,
    ...evidence,
  }
}
