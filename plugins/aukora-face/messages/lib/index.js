import { appendFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
//#region lib/types/messages-route.js
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
const MESSAGES_CONTACTS_ENDPOINT = "/aukora-messages/contacts.json";
/**
* The request prefix the listing ALSO answers on.
*
* The endpoint is the `.json` path and the prefix is the bare one, as the Documents face has
* it. Both are served by the same handler and both accept the same two query fields, because
* a caller that built a request from {@link messagesContactsRequest} must reach the listing
* rather than a 400: the endpoint the host registers is the one the screen fetches, and the
* bare prefix is refused by name because it names no state directory.
*/
const MESSAGES_CONTACTS_REQUEST_ENDPOINT = "/aukora-messages/contacts";
/** The conversation with one contact. GET, and read-only: it opens wraps and reports. */
const MESSAGES_THREAD_ENDPOINT = "/aukora-messages/thread";
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
const MESSAGES_SEND_ENDPOINT = "/aukora-messages/send";
/** Where the Confirm button POSTs: the backend asks the signer, verifies, and stores. */
const MESSAGES_CONFIRM_CONTACT_ENDPOINT = "/aukora-messages/confirm-contact";
const MESSAGES_REISSUE_IDENTITY_ENDPOINT = "/aukora-messages/reissue-identity";
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
const MESSAGES_SEND_BUDGET_MS = 9e3;
/**
* How long a THREAD read may take before this route answers, on the same terms as
* {@link MESSAGES_SEND_BUDGET_MS} and for the same reason: a read of a relay that never answers is
* the same silent hang from the other side, and the client's abort does not distinguish them.
*/
const MESSAGES_THREAD_BUDGET_MS = 9e3;
/**
* The most text one message may carry, in UTF-8 BYTES.
*
* Measured in bytes rather than characters because the limit exists to bound what is encrypted
* and published: 4000 characters of four-byte emoji is sixteen kilobytes on the wire, and a
* limit that a message can quadruple by its choice of script is not a limit.
*/
const MESSAGES_TEXT_MAX_BYTES = 4e3;
/** Every state, in the order the design names them. */
const MESSAGES_WIRE_CONTACT_STATES = [
	"VERIFIED",
	"BOUND",
	"TEST",
	"UNBOUND",
	"FOREIGN"
];
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
const MESSAGES_HOST_OWNED_QUERY_FIELDS = ["root", "controllerDir"];
/** The reader's refusals: the ones a node's own files produce. */
const MESSAGES_STORE_REFUSALS = [
	"messages:contacts-state-missing",
	"messages:contacts-unparseable",
	"messages:contacts-domain-unknown",
	"messages:contact-malformed",
	"messages:no-controller-record",
	"messages:aumlok-not-linked",
	"messages:unreadable-state",
	"messages:key-missing",
	"messages:key-unreadable",
	"messages:contact-peer-key-malformed"
];
/** The wire's own refusals: the ones a caller can earn without any file being involved. */
const MESSAGES_WIRE_REFUSALS = [
	"messages:identity-reissue-failed",
	"messages:identity-changed",
	"messages:malformed-request",
	"messages:request-body-unreadable",
	"messages:no-such-route",
	"messages:state-directory-named",
	"messages:text-empty",
	"messages:text-too-long",
	"messages:relays-unreachable",
	"messages:nobody-accepted",
	"messages:reads-unavailable",
	"messages:sender-unproven",
	"messages:send-timeout",
	"messages:thread-timeout"
];
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
const MESSAGES_RELAY_REFUSALS = [
	"messages:relays-unreachable",
	"messages:nobody-accepted",
	"messages:reads-unavailable",
	"messages:sender-unproven",
	"messages:send-timeout",
	"messages:thread-timeout"
];
/** Every refusal reason, reader-side and wire-side. */
const MESSAGES_REFUSAL_REASONS = [
	"messages:add-refresh-target",
	"messages:add-refresh-binding",
	...MESSAGES_STORE_REFUSALS,
	...MESSAGES_WIRE_REFUSALS,
	"messages:add-binding-invalid",
	"messages:confirm-npub-invalid",
	"messages:confirm-body-unreadable",
	"messages:confirm-no-such-contact",
	"messages:confirm-not-bound",
	"messages:confirm-safety-version-mismatch",
	"messages:confirm-comparison-required",
	"messages:confirm-signer-unreachable",
	"messages:confirm-signer-declined",
	"messages:confirm-challenge-mismatch",
	"messages:confirm-not-verified",
	"messages:confirm-write-failed",
	"messages:confirm-writer-absent",
	"messages:confirm-writer-unloadable",
	"messages:confirm-writer-unusable"
];
/** All three outcomes, so a parser and a caller can assert the set is closed. */
const MESSAGES_EVIDENCE_OUTCOMES = [
	"recorded",
	"not-recorded",
	"none"
];
/**
* A send no relay accepted has nothing to record: no wrap of this message was published.
*
* Kept apart from {@link MESSAGES_EVIDENCE_UNWRITABLE} on purpose. "The message never left" and "the
* message left and its record could not be written" call for different actions, and collapsing them
* would make the one honest sentence about a failed send useless.
*/
const MESSAGES_EVIDENCE_NO_PUBLISH = "messages:evidence-no-publish";
/**
* A thread that opened no wrap has nothing to record and nothing it FAILED to record.
*
* The only reason `none` ever carries, and the reason `none` is neither of the other two outcomes:
* no wrap was opened, so no record was owed, and reporting a failure here would invent one — while
* `recorded` would claim a record exists for a wrap that was never read.
*/
const MESSAGES_EVIDENCE_NO_WRAP_OPENED = "messages:evidence-no-wrap-opened";
/** This deployment's nostr tree carries no `evidence.mjs`, so no record can be written at all. */
const MESSAGES_EVIDENCE_MODULE_ABSENT = "messages:evidence-module-absent";
/**
* The evidence module's own code for a record that could not be written to disk.
*
* A LITERAL, MIRRORING `EVIDENCE_REFUSE.UNWRITABLE` IN `plugins/aukora-nostr/lib/evidence.mjs`, and
* it has to be: this face may not import that module statically — the face build compiles inside a
* clone of the pinned harness where the nostr tree does not exist — so the name is repeated here and
* the court asserts the loaded module's own constant equals it. It is also the fallback for a throw
* that carries no code at all, where "could not be written" is the only true thing left to say.
*/
const MESSAGES_EVIDENCE_UNWRITABLE = "nostr-evidence-unwritable";
/** Whether a value is one of the three outcomes. */
function isMessagesEvidenceOutcome(value) {
	return MESSAGES_EVIDENCE_OUTCOMES.some((outcome) => outcome === value);
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
function parseEvidencePair(value) {
	if (!isMessagesEvidenceOutcome(value.evidence)) return void 0;
	if (value.evidence === "recorded") return value.evidenceRefusal === null ? {
		evidence: "recorded",
		evidenceRefusal: null
	} : void 0;
	if (value.evidence === "none") return value.evidenceRefusal === "messages:evidence-no-wrap-opened" ? {
		evidence: "none",
		evidenceRefusal: MESSAGES_EVIDENCE_NO_WRAP_OPENED
	} : void 0;
	return isText(value.evidenceRefusal) ? {
		evidence: "not-recorded",
		evidenceRefusal: value.evidenceRefusal
	} : void 0;
}
/**
* Build the pair, and make the mismatch unrepresentable at the place it would be written.
*
* @param evidence - the outcome.
* @param evidenceRefusal - the named reason, ignored when the outcome is `recorded` or `none`: the
* first has nothing to explain and the second has exactly one thing to say.
* @returns the pair, never `recorded` with a reason and never `not-recorded` or `none` without one.
*/
function messagesEvidenceFields(evidence, evidenceRefusal) {
	if (evidence === "recorded") return {
		evidence: "recorded",
		evidenceRefusal: null
	};
	if (evidence === "none") return {
		evidence: "none",
		evidenceRefusal: MESSAGES_EVIDENCE_NO_WRAP_OPENED
	};
	return {
		evidence: "not-recorded",
		evidenceRefusal: evidenceRefusal === null || evidenceRefusal === "" ? MESSAGES_EVIDENCE_UNWRITABLE : evidenceRefusal
	};
}
/** Both roles, so a parser and a caller can assert the set is closed. */
const MESSAGES_COPY_ROLES = ["recipient", "self"];
/** Whether a value is a plain JSON object, for the parsers below. */
function isRecord$3(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Whether an object carries exactly the named keys and nothing else. */
function hasExactKeys(value, keys) {
	return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
/** A non-empty string, for the parsers below. */
function isText(value) {
	return typeof value === "string" && value !== "";
}
/** Validate contact data before trimming or projecting it, including nested unsigned metadata. */
function contactFieldsAreSafe(value, depth = 0) {
	if (depth > 32) return false;
	if (typeof value === "string") return !/[\p{Cc}\u202a-\u202e\u2066-\u2069\p{Zl}\p{Zp}]/u.test(value);
	if (value !== null && typeof value === "object") return Object.entries(value).every(([key, field]) => contactFieldsAreSafe(key, depth + 1) && contactFieldsAreSafe(field, depth + 1));
	return true;
}
/** Escape controls before a rejected field is named in a diagnostic. Never echo raw JSON. */
function safeContactDiagnostic(value) {
	if (typeof value !== "string") return "unreadable";
	return JSON.stringify(value.slice(0, 120)).replace(/[\p{Cc}\p{Bidi_Control}\p{Zl}\p{Zp}]/gu, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
/** Keep usable contacts readable while explicitly accounting for each omitted row. */
function skippedContact(index, value) {
	const fields = isRecord$3(value) ? value : {};
	return {
		index,
		reason: "messages:contact-malformed",
		subject: `entry ${index}${typeof fields.name === "string" ? ` name ${safeContactDiagnostic(fields.name)}` : ""}${typeof fields.npub === "string" ? ` npub ${safeContactDiagnostic(fields.npub)}` : ""}`
	};
}
/** The displayed own half; the backend independently verifies the complete submitted pair. */
function parseSafetyNumber(value) {
	if (value === null) return null;
	if (!isRecord$3(value) || !hasExactKeys(value, [
		"digits",
		"spoken",
		"comparisonGroupIndex"
	]) || !contactFieldsAreSafe(value)) return void 0;
	if (typeof value.digits !== "string" || !/^[0-9]{35}$/u.test(value.digits)) return void 0;
	if (value.spoken !== value.digits.match(/.{5}/gu)?.join(" ")) return void 0;
	if (value.comparisonGroupIndex !== 0 && value.comparisonGroupIndex !== 7) return void 0;
	return {
		digits: value.digits,
		spoken: String(value.spoken),
		comparisonGroupIndex: value.comparisonGroupIndex
	};
}
/** Whether a value is one of the four states. */
function isMessagesContactState(value) {
	return MESSAGES_WIRE_CONTACT_STATES.some((state) => state === value);
}
/** Whether a value is one of the three binding statuses. */
function isMessagesContactBinding(value) {
	return value === "absent" || value === "verified" || value === "refused";
}
/** Whether a value is one of the named refusal reasons. */
function isMessagesRefusalReason(value) {
	return MESSAGES_REFUSAL_REASONS.some((reason) => reason === value);
}
/** Whether a value is one of the two copy roles. */
function isMessagesCopyRole(value) {
	return MESSAGES_COPY_ROLES.some((role) => role === value);
}
/**
* Build a refusal body.
* @param reason - the named reason.
* @param subject - what was refused.
* @returns the body the route answers with.
*/
function messagesRefusalBody(reason, subject) {
	return {
		status: "refused",
		reason,
		subject
	};
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
function messagesContactsRequest() {
	return MESSAGES_CONTACTS_ENDPOINT;
}
/**
* Whether a query string names a field the host owns.
* @param search - the request query string, with or without its leading `?`.
* @returns the offending field name, or undefined when the query names none.
*/
function messagesHostOwnedQueryField(search) {
	const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
	return MESSAGES_HOST_OWNED_QUERY_FIELDS.find((field) => params.has(field));
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
function parseMessagesContactsRequest(pathname, search) {
	if (pathname !== "/aukora-messages/contacts.json" && pathname !== "/aukora-messages/contacts") return false;
	return messagesHostOwnedQueryField(search) === void 0;
}
/** Parse one SAS off the wire, or undefined when it is not one this face serves. */
function parseWireSas(value) {
	return parseSafetyNumber(value) ?? void 0;
}
/**
* Parse one contact entry off the wire.
* @param value - one element of the listing's `contacts`.
* @returns the entry, or undefined when it is not what this face serves.
*/
function parseMessagesContactEntry(value) {
	if (!isRecord$3(value) || !contactFieldsAreSafe(value)) return void 0;
	const keys = [
		"npub",
		"name",
		"state",
		"reason",
		"subject",
		"sas",
		"binding",
		"peerControllerKey"
	];
	if (Object.hasOwn(value, "safetyNumber")) keys.push("safetyNumber");
	if (!hasExactKeys(value, keys)) return void 0;
	if (!isText(value.npub) || !isText(value.name)) return void 0;
	if (!isMessagesContactState(value.state)) return void 0;
	if (typeof value.peerControllerKey !== "string") return void 0;
	if (!/^[0-9a-f]{64}$/iu.test(value.peerControllerKey) && !(value.peerControllerKey === "" && value.state === "UNBOUND" && value.binding === "absent")) return void 0;
	if (typeof value.reason !== "string") return void 0;
	if (value.subject !== null && !isText(value.subject)) return void 0;
	const binding = value.binding;
	if (!isMessagesContactBinding(binding)) return void 0;
	const sas = parseWireSasForBinding(value.sas, binding, value.state);
	if (sas === void 0) return void 0;
	const safetyNumber = value.safetyNumber === void 0 ? null : parseSafetyNumber(value.safetyNumber);
	if (safetyNumber === void 0 || safetyNumber !== null && (binding !== "verified" || ![
		"BOUND",
		"TEST",
		"VERIFIED"
	].includes(value.state))) return void 0;
	return {
		npub: value.npub,
		name: value.name,
		state: value.state,
		reason: value.reason,
		subject: value.subject,
		sas,
		...Object.hasOwn(value, "safetyNumber") ? { safetyNumber } : {},
		binding,
		peerControllerKey: value.peerControllerKey
	};
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
function parseWireSasForBinding(value, binding, state) {
	if (binding === "verified") return parseThreadSas(value, state);
	return value === null && state !== "VERIFIED" ? null : void 0;
}
/**
* Validate a listing body off the wire.
* @param value - the parsed JSON body.
* @returns the body, or undefined when it is not what this face serves.
*/
function parseMessagesContactsBody(value) {
	if (!isRecord$3(value)) return void 0;
	const keys = [
		"status",
		"root",
		"contacts"
	];
	if (Object.hasOwn(value, "skipped")) keys.push("skipped");
	if (!hasExactKeys(value, keys)) return void 0;
	if (value.status !== "ok" || !isText(value.root) || !Array.isArray(value.contacts)) return void 0;
	const skipped = [];
	if (Object.hasOwn(value, "skipped")) {
		if (!Array.isArray(value.skipped)) return void 0;
		for (const raw of value.skipped) {
			if (!isRecord$3(raw) || !hasExactKeys(raw, [
				"index",
				"reason",
				"subject"
			])) return void 0;
			if (typeof raw.index !== "number" || !Number.isSafeInteger(raw.index) || raw.index < 0 || raw.reason !== "messages:contact-malformed" || !isText(raw.subject) || raw.subject.length > 2048 || !contactFieldsAreSafe(raw.subject)) return void 0;
			skipped.push({
				index: raw.index,
				reason: raw.reason,
				subject: raw.subject
			});
		}
	}
	const contacts = [];
	for (const [index, raw] of value.contacts.entries()) {
		const entry = parseMessagesContactEntry(raw);
		if (entry === void 0) skipped.push(skippedContact(index, raw));
		else contacts.push(entry);
	}
	return {
		status: "ok",
		root: value.root,
		contacts,
		...skipped.length === 0 ? {} : { skipped }
	};
}
/**
* Validate a listing answer, refusal included, off the wire.
* @param value - the parsed JSON body.
* @returns the answer, or undefined when it is neither a listing nor a named refusal.
*/
function parseMessagesContactsAnswer(value) {
	if (isRecord$3(value) && value.status === "refused") return parseMessagesRefusalBody(value);
	return parseMessagesContactsBody(value);
}
/**
* Validate a refusal body off the wire.
* @param value - the parsed JSON body.
* @returns the refusal, or undefined when the reason is not one this face defines.
*/
function parseMessagesRefusalBody(value) {
	if (!isRecord$3(value)) return void 0;
	if (!hasExactKeys(value, [
		"status",
		"reason",
		"subject"
	])) return void 0;
	if (value.status !== "refused" || typeof value.subject !== "string") return void 0;
	if (!isMessagesRefusalReason(value.reason)) return void 0;
	return {
		status: "refused",
		reason: value.reason,
		subject: value.subject
	};
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
function messagesTextBytes(text) {
	return new TextEncoder().encode(text).length;
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
function parseMessagesThreadRequest(pathname, search) {
	if (pathname !== "/aukora-messages/thread") return void 0;
	const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
	if (messagesHostOwnedQueryField(search) !== void 0) return void 0;
	const npub = params.get("npub");
	if (!isText(npub)) return void 0;
	const since = params.get("since");
	if (since === null) return {
		npub,
		since: null
	};
	if (!/^\d+$/u.test(since) || Number(since) <= 0) return void 0;
	return {
		npub,
		since: Number(since)
	};
}
/**
* Validate one message off the wire.
* @param value - one element of a thread's `messages`.
* @returns the message, or undefined when it is not what this face serves.
*/
function parseMessagesWireMessage(value) {
	if (!isRecord$3(value)) return void 0;
	if (!hasExactKeys(value, [
		"id",
		"from",
		"text",
		"at"
	])) return void 0;
	if (!isText(value.id) || !isText(value.text)) return void 0;
	if (value.from !== "them" && value.from !== "me") return void 0;
	if (typeof value.at !== "number" || !Number.isInteger(value.at) || value.at < 0) return void 0;
	return {
		id: value.id,
		from: value.from,
		text: value.text,
		at: value.at
	};
}
/**
* Validate a thread body off the wire.
* @param value - the parsed JSON body.
* @returns the body, or undefined when it is not what this face serves.
*/
function parseMessagesThreadBody(value) {
	if (!isRecord$3(value)) return void 0;
	const keys = [
		"status",
		"npub",
		"contactState",
		"sas",
		"messages",
		"answered",
		"evidence",
		"evidenceRefusal"
	];
	if (Object.hasOwn(value, "safetyNumber")) keys.push("safetyNumber");
	if (Object.hasOwn(value, "inboxComplete")) keys.push("inboxComplete");
	if (value.inboxComplete !== void 0 && typeof value.inboxComplete !== "boolean") return void 0;
	if (!hasExactKeys(value, keys)) return void 0;
	if (value.status !== "ok" || !isText(value.npub)) return void 0;
	const state = value.contactState;
	if (state !== "VERIFIED" && state !== "BOUND" && state !== "TEST" && state !== "UNBOUND" && state !== "FOREIGN" && state !== "UNKNOWN") return;
	const parsedSas = parseThreadSas(value.sas, state);
	if (parsedSas === void 0) return void 0;
	const sas = parsedSas;
	const safetyNumber = value.safetyNumber === void 0 ? null : parseSafetyNumber(value.safetyNumber);
	if (!contactFieldsAreSafe(value.npub) || safetyNumber === void 0 || safetyNumber !== null && ![
		"BOUND",
		"TEST",
		"VERIFIED"
	].includes(state)) return void 0;
	if (!Array.isArray(value.messages) || !Array.isArray(value.answered)) return void 0;
	if (value.answered.some((relay) => typeof relay !== "string")) return void 0;
	const evidence = parseEvidencePair(value);
	if (evidence === void 0) return void 0;
	const messages = [];
	for (const raw of value.messages) {
		const message = parseMessagesWireMessage(raw);
		if (message === void 0) return void 0;
		messages.push(message);
	}
	if (evidence.evidence === "none" && messages.length > 0) return void 0;
	if (evidence.evidence === "recorded" && messages.length === 0) return void 0;
	return {
		status: "ok",
		npub: value.npub,
		contactState: state,
		sas,
		...Object.hasOwn(value, "safetyNumber") ? { safetyNumber } : {},
		messages,
		answered: value.answered,
		...Object.hasOwn(value, "inboxComplete") ? { inboxComplete: value.inboxComplete } : {},
		...evidence
	};
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
function parseThreadSas(value, state) {
	if (value === null) return state === "VERIFIED" ? void 0 : null;
	if (state !== "VERIFIED" && state !== "BOUND" && state !== "TEST") return void 0;
	return parseWireSas(value);
}
/**
* Validate a send request off the wire.
* @param value - the parsed JSON body.
* @returns the request, or undefined when it is not the shape this face takes.
*/
function parseMessagesSendRequest(value) {
	if (!isRecord$3(value)) return void 0;
	if (!hasExactKeys(value, ["npub", "text"])) return void 0;
	if (!isText(value.npub)) return void 0;
	if (typeof value.text !== "string") return void 0;
	return {
		npub: value.npub,
		text: value.text
	};
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
function parseMessagesCopyOutcome(value) {
	if (!isRecord$3(value)) return void 0;
	if (!hasExactKeys(value, [
		"copy",
		"eventId",
		"accepted",
		"relays",
		"refusal"
	])) return void 0;
	if (!isMessagesCopyRole(value.copy)) return void 0;
	if (!isText(value.eventId)) return void 0;
	if (typeof value.accepted !== "boolean") return void 0;
	if (!Array.isArray(value.relays) || value.relays.some((relay) => !isText(relay))) return void 0;
	if (value.accepted) {
		if (value.relays.length === 0) return void 0;
		if (value.refusal !== null) return void 0;
		return {
			copy: value.copy,
			eventId: value.eventId,
			accepted: true,
			relays: value.relays,
			refusal: null
		};
	}
	if (value.relays.length > 0) return void 0;
	if (!isText(value.refusal)) return void 0;
	return {
		copy: value.copy,
		eventId: value.eventId,
		accepted: false,
		relays: [],
		refusal: value.refusal
	};
}
/**
* Validate a send answer off the wire, refusal included.
*
* @param value - the parsed JSON body.
* @returns the answer, or undefined when it is not what this face serves.
*/
function parseMessagesSendBody(value) {
	if (!isRecord$3(value)) return void 0;
	if (value.status === "refused") return parseMessagesRefusalBody(value);
	if (!hasExactKeys(value, [
		"status",
		"ok",
		"accepted",
		"copies",
		"verdict",
		"npub",
		"id",
		"at",
		"evidence",
		"evidenceRefusal"
	])) return void 0;
	if (value.status !== "sent" || !isText(value.npub) || !isText(value.id)) return void 0;
	if (typeof value.ok !== "boolean") return void 0;
	if (typeof value.at !== "number" || !Number.isInteger(value.at) || value.at < 0) return void 0;
	if (!Array.isArray(value.accepted) || value.accepted.some((relay) => typeof relay !== "string")) return void 0;
	if (value.verdict !== null && typeof value.verdict !== "string") return void 0;
	const accepted = value.accepted;
	if (value.ok !== accepted.length > 0) return void 0;
	if (value.verdict === null !== accepted.length > 0) return void 0;
	if (!Array.isArray(value.copies) || value.copies.length === 0) return void 0;
	const copies = [];
	const roles = /* @__PURE__ */ new Set();
	for (const raw of value.copies) {
		const copy = parseMessagesCopyOutcome(raw);
		if (copy === void 0) return void 0;
		if (roles.has(copy.copy)) return void 0;
		roles.add(copy.copy);
		copies.push(copy);
	}
	if (value.ok !== copies.some((copy) => copy.accepted)) return void 0;
	const namedByCopies = /* @__PURE__ */ new Set();
	for (const copy of copies) for (const relay of copy.relays) namedByCopies.add(relay);
	const namedByBody = new Set(accepted);
	if (namedByBody.size !== namedByCopies.size) return void 0;
	for (const relay of namedByBody) if (!namedByCopies.has(relay)) return void 0;
	const evidence = parseEvidencePair(value);
	if (evidence === void 0) return void 0;
	if (evidence.evidence === "recorded" && accepted.length === 0) return void 0;
	if (evidence.evidence === "none" && accepted.length > 0) return void 0;
	return {
		status: "sent",
		ok: value.ok,
		accepted,
		copies,
		verdict: value.verdict,
		npub: value.npub,
		id: value.id,
		at: value.at,
		...evidence
	};
}
//#endregion
//#region lib/types/client/add-contact.js
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERATOR = [
	996825010,
	642813549,
	513874426,
	1027748829,
	705979059
];
const ADD_REFUSE = Object.freeze({
	NPUB: "messages:add-npub-invalid",
	CONTROLLER: "messages:add-controller-invalid",
	NAME: "messages:add-name-invalid",
	QR: "messages:add-qr-invalid",
	BINDING: "messages:add-binding-invalid"
});
function refuse$2(reason, detail) {
	return {
		ok: false,
		reason,
		detail
	};
}
function polymod(values) {
	let checksum = 1;
	for (const value of values) {
		const top = checksum >> 25;
		checksum = (checksum & 33554431) << 5 ^ value;
		for (let bit = 0; bit < 5; bit += 1) if ((top >> bit & 1) === 1) checksum ^= GENERATOR[bit] ?? 0;
	}
	return checksum;
}
function checkNpub(value) {
	const raw = typeof value === "string" ? value.trim().replace(/^nostr:/iu, "") : "";
	if (!raw) return refuse$2(ADD_REFUSE.NPUB, "no npub was given");
	const lower = raw.toLowerCase();
	if (raw !== lower && raw !== raw.toUpperCase()) return refuse$2(ADD_REFUSE.NPUB, "mixed case is not valid bech32");
	if (lower.length !== 63 || !lower.startsWith("npub1")) return refuse$2(ADD_REFUSE.NPUB, "an npub must be 63 characters starting with npub1");
	const values = [];
	for (const character of lower.slice(5)) {
		const index = CHARSET.indexOf(character);
		if (index === -1) return refuse$2(ADD_REFUSE.NPUB, "invalid bech32 character");
		values.push(index);
	}
	const hrp = [..."npub"].map((character) => character.charCodeAt(0));
	if (polymod([
		...hrp.map((code) => code >> 5),
		0,
		...hrp.map((code) => code & 31),
		...values
	]) !== 1) return refuse$2(ADD_REFUSE.NPUB, "the npub checksum does not match");
	let accumulator = 0;
	let bits = 0;
	let bytes = 0;
	for (const value of values.slice(0, -6)) {
		accumulator = (accumulator << 5 | value) & 4095;
		bits += 5;
		while (bits >= 8) {
			bits -= 8;
			bytes += 1;
		}
	}
	if (bytes !== 32 || bits >= 5 || (accumulator << 8 - bits & 255) !== 0) return refuse$2(ADD_REFUSE.NPUB, "an npub must encode 32 bytes with zero padding");
	return {
		ok: true,
		npub: lower
	};
}
//#endregion
//#region lib/types/contacts-store.js
/**
* The reader behind the Messages face: this node's contacts, each in ONE of four states.
*
* WHAT THIS MODULE MAY DO. It READS TWO THINGS — `<stateDir>/nostr/contacts.json` into a
* string, and the Aumlok controller record that `resolveContact` consults — and that is the
* whole of its reach. There is no writer in this file: no `writeFile`, `mkdir`, `rm`,
* `rename` or `copyFile`, and no request reaches it that could ask for one. Every call
* re-reads the file, so a listing cannot outlive the contacts it describes.
*
* IT IS TOLD WHICH TWO THINGS TO READ, AND FINDS NEITHER FOR ITSELF. The state directory is the
* harness home the process was started with; the controller record directory is the mounted
* `aumlokControl` service's own `directory`, read by the host half out of the context and passed in as
* {@link messagesContactsRoots}'s argument. This module reads no environment name for the controller
* and composes no default path for it: a directory this file invented would be a guess, and a guess
* that lands on nothing is what made a performed enrolment read as a missing record on a live machine.
*
* THE FOUR STATES ARE THE POINT, AND THE SAS IS THE REASON THEY EXIST.
* `plugins/aukora-nostr/lib/contact.mjs` is the source of truth and this module does not
* re-implement a line of it:
*
*   VERIFIED  a binding verifies and is not TEST-labelled: the controller key vouched for
*             this npub and subject, and we accept that controller.
*   TEST      a binding verifies and IS TEST-labelled. The claim is structurally sound and
*             means nothing yet, because the only controller record on this machine is
*             disposable until the owner enrols.
*   UNBOUND   we hold an npub and no binding at all. We can exchange encrypted bytes; we
*             cannot say who is on the other end.
*   FOREIGN   a binding was presented and does NOT verify for this contact — a bad
*             signature, a wrong domain, a different npub, a different subject. This is the
*             adversarial state and stays distinct from UNBOUND, because "nobody vouched"
*             and "somebody vouched for something else" are different facts.
*
* A SAS IS RETURNED ONLY WHEN A BINDING VERIFIED. UNBOUND and FOREIGN contacts carry
* `sas: null` — never a placeholder, never a zero, never an empty string. That is the single
* most important property in this file: showing a string for an unproven contact invites two
* people to read it to each other and come away believing they confirmed an identity that
* was never proven, which is worse than showing nothing. `resolveContact` refuses to
* synthesise one, this module copies what it returned rather than deriving its own, and the
* court asserts the null for both states explicitly.
*
* WHAT IS RETURNED IS OWNED, SMALL, AND LOSSLESS JSON. One object per contact, carrying
* seven leaf fields and nothing else — never `resolveContact`'s `verdict`, never the binding
* document, never a Buffer or a live object, never the controller key. The controller key
* matters in particular: it is the SAS preimage, and the SAS is the one form of it a person
* is meant to compare out loud.
*
* REFUSALS ARE NAMED AND DISTINCT, one name per condition and never one generic failure,
* because "you have no contacts file yet" and "your contacts file is not the document this
* face reads" call for different actions from whoever reads the answer:
*
*   messages:contacts-state-missing     no `<stateDir>/nostr/contacts.json` on disk.
*   messages:contacts-unparseable       the file is there and is not JSON.
*   messages:contacts-domain-unknown    JSON, but its `domain` is not the v1 domain.
*   messages:contact-malformed          the document is the right shape, and one entry in
*                                       it is not: no npub, no name, or a binding that is
*                                       neither absent nor a binding document.
*   messages:no-controller-record       no Aumlok controller record to verify against, so
*                                       NOTHING in this list can be resolved at all.
*   messages:aumlok-not-linked          this install has not linked an Aumlok phrase yet: the
*                                       composition names no controller directory. A state to
*                                       act on (link it), not a fault.
*   messages:unreadable-state           the file is there and this process cannot read it.
*   messages:key-missing                this node has no Nostr key yet. READING does not mint
*                                       one: a person opening the Messages screen must not
*                                       silently become a new Nostr identity.
*   messages:key-unreadable             the key file is there and carries no usable secret.
*
* ─────────────────────────────────────────────────────────────────────────────────────────────
* THE MAIL SIDE: WHERE A CONVERSATION COMES FROM, AND WHAT IT DOES NOT CLAIM.
*
* A conversation is read back out of the gift wraps this node already received. There is no
* message store here and none is invented: {@link readMailThread} opens what a relay read
* returned, keeps the ones whose PROVEN sender is the requested npub, and ignores the rest. A
* wrap that will not open is dropped rather than reported, because this face cannot say
* anything true about it.
*
* AND THE SAME SELECTION IS WHAT EVIDENCE IS WRITTEN FOR. {@link openedThreadWraps} is the one
* function that decides which wraps this face read, and {@link readMailThread} hands the route both
* the conversation and exactly those wraps — so the thread route cannot write a record for a wrap it
* never opened, nor show a message with no record behind it. Writing itself lives in the nostr
* tree's own `evidence.mjs`, called from the host half; this file still writes nothing.
*
* NIP-17 wraps a copy of every message to its sender as well, so this node's own sent messages
* arrive in the SAME read and are kept with `from: 'me'`. Sent history is therefore real
* whenever the relays still hold the sender's own copy — and it is EMPTY when they do not, for
* instance when a relay was never reached at send time. That is a limit of NIP-17 without a
* local store, and the thread route reports it by returning the messages it could actually
* read rather than by inventing the others.
*
* {@link mailThread} adds what is known about who is on the other end — one of the four contact
* states, or UNKNOWN when the npub is not a contact at all — and withholds the SAS exactly as
* the listing does: present only for a binding that verified.
* ─────────────────────────────────────────────────────────────────────────────────────────────
*
* Malformed entries are omitted individually and named in `skipped`, with controls escaped.
* One broken or hostile record must not hide the remaining usable contacts.
*
* A BINDING THAT IS PRESENT BUT BROKEN IS NOT A REFUSAL. It is FOREIGN, the adversarial
* state, and it is reported per contact with the underlying refusal kept in `reason` — that
* is `resolveContact`'s contract and this module preserves it.
*
* @module @aukora/face-messages/contacts-store
*/
var __rewriteRelativeImportExtension$3 = function(path, preserveJsx) {
	if (typeof path === "string" && /^\.\.?\//.test(path)) return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function(m, tsx, d, ext, cm) {
		return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : d + ext + "." + cm.toLowerCase() + "js";
	});
	return path;
};
/** The `domain` every contacts document must carry. A different one is a different format. */
const MESSAGES_CONTACTS_DOMAIN = "aukora:nostr-contacts:v1";
/**
* The names this module reads from the environment.
*
* Enumerated rather than looked up by an arbitrary string: the harness declares `process.env`
* with only the `DSH_CLIENT_*` build-time keys and `NODE_ENV`, so reading this face's OWN
* names has to go through a stated list rather than a general index.
*/
const MESSAGES_STATE_DIR_ENV_NAME = "DSH_HOME";
/**
* WHERE THE AUMLOK CONTROLLER LIVES IS NOT DECIDED HERE, AND IS NOT READ FROM THE ENVIRONMENT.
*
* The directory is the `aukora-aumlok` row's `config.directory` — the same value the organ is mounted
* with — and the organ publishes it as the `aumlokControl` service's own `directory` field. The host
* half of this face asks the context for that service on every request and hands the answer to
* {@link messagesContactsRoots}; this module looks for nothing.
*
* AN ENVIRONMENT NAME USED TO LIVE HERE AND HAS BEEN REMOVED RATHER THAN LEFT UNUSED. It could not
* have worked: `scripts/launch-dsh.py` forwards a fixed whitelist of names to the backend, so a new
* `AUKORA_*` name never arrives, and {@link environmentValue} serves only the names declared in it, so
* even a name set in this process could not be read. A constant nobody can honour is worse than no
* constant, because the next reader believes it works.
*/
/** The resolver module override; declared here so {@link environmentValue} can read it. */
const MESSAGES_CONTACT_MODULE_ENV_NAME = "AUKORA_NOSTR_CONTACT_MODULE";
/** The relay list override; declared here so {@link environmentValue} can read it. */
const MESSAGES_RELAYS_ENV_NAME = "AUKORA_NOSTR_RELAYS";
/** The per-relay timeout override; declared here so {@link environmentValue} can read it. */
const MESSAGES_RELAY_TIMEOUT_ENV_NAME = "AUKORA_NOSTR_TIMEOUT_MS";
/**
* Read one of this face's environment names.
* @param name - one of the names this module declares.
* @returns the configured value, or undefined when unset.
*/
function environmentValue(name) {
	for (const declared of [
		MESSAGES_STATE_DIR_ENV_NAME,
		MESSAGES_CONTACT_MODULE_ENV_NAME,
		MESSAGES_RELAYS_ENV_NAME,
		MESSAGES_RELAY_TIMEOUT_ENV_NAME
	]) if (declared === name) return process.env[declared];
}
/**
* Environment variable naming the state directory this face reads.
*
* This is the project's own harness-home convention, not a new one: `DSH_HOME` is the single
* root the harness keeps user data under (the release launcher exports
* `DSH_HOME=<state>/home`, and every storage row in the composition resolves its path from
* it), so the contacts file sits beside `nostr/identity.json` — the key
* `loadOrCreateNostrKey(stateDir)` reads and writes at exactly `<stateDir>/nostr/`.
*
* Read at CALL time rather than at import time, so one process can be pointed at a
* disposable state directory, and so a test can move it without reloading a module.
* Unset or whitespace-only falls back to `~/.dsh`, exactly as `resolveDshHome` does; a blank
* override never resolves the state directory to the working directory.
*/
const MESSAGES_STATE_DIR_ENV = MESSAGES_STATE_DIR_ENV_NAME;
/** Every reason the reader produces, so a caller can assert the vocabulary is closed. */
const MESSAGES_CONTACTS_REFUSAL_REASONS = [
	"messages:contacts-state-missing",
	"messages:contacts-unparseable",
	"messages:contacts-domain-unknown",
	"messages:contact-malformed",
	"messages:no-controller-record",
	"messages:aumlok-not-linked",
	"messages:unreadable-state",
	"messages:key-missing",
	"messages:key-unreadable",
	"messages:contact-peer-key-malformed"
];
/** A refusal body, built in one place so every refusal names its subject. */
function refused(reason, subject) {
	return {
		status: "refused",
		reason,
		subject
	};
}
/** A filesystem error's stable code, or undefined when it carries none. */
function errorCode(error) {
	const code = error?.code;
	return typeof code === "string" ? code : void 0;
}
/** Whether a value is a plain JSON object, for the document reader below. */
function isRecord$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* The state directory this face reads, resolved on every call from {@link MESSAGES_STATE_DIR_ENV}.
*
* The same convention `documents-reader.ts` follows for its private root: one fixed,
* non-configurable location, so no request can name a different one. The difference is that
* this root is the harness home the process was started with rather than a literal path,
* because the contacts file lives in the state directory the Nostr key already lives in.
*
* @returns the absolute state directory.
*/
function messagesStateDir() {
	const configured = environmentValue(MESSAGES_STATE_DIR_ENV_NAME);
	if (configured?.trim()) return resolve(configured);
	const support = process.env.AUKORA_SUPPORT_ROOT;
	return support?.trim() ? resolve(support, "state", "home") : join(homedir(), ".dsh");
}
/**
* The directory holding this node's NOSTR state for a given state directory.
* @param stateDir - the absolute state directory.
* @returns `<stateDir>/nostr`.
*/
function messagesNostrDir(stateDir) {
	return join(stateDir, "nostr");
}
/**
* The contacts file this face reads.
* @param stateDir - the absolute state directory.
* @returns the absolute path of `contacts.json`.
*/
function messagesContactsPath(stateDir) {
	return join(messagesNostrDir(stateDir), "contacts.json");
}
/**
* Both roots this face reads, composed from the state directory and from the controller directory the
* host half was given.
*
* `controllerDir` IS AN INPUT, NOT SOMETHING THIS FUNCTION FINDS. It is the `directory` field of the
* mounted `aumlokControl` service — the `aukora-aumlok` row's `config.directory` as the composition
* actually loaded it — read by the host half through `ctx.get('aumlokControl')` on every request and
* passed here. This module resolves nothing about it: no environment name, no default, no path
* composed out of `stateDir`. The value is used exactly as the service gave it, because normalising it
* would be this face deciding something the composition already decided.
*
* @param controllerDir - the controller record directory the service named, or `undefined` when no
*   mounted service supplied one. `undefined` is a real answer; {@link listContacts} refuses by name.
* @returns the state directory and the controller record directory.
*/
function messagesContactsRoots(controllerDir) {
	return {
		stateDir: messagesStateDir(),
		controllerDir
	};
}
/**
* Validate one stored contact, at the depth this face actually needs.
*
* A binding is deliberately NOT validated here. Whether a presented binding is well-formed is
* `verifyBinding`'s business, and an answer of "this binding does not verify" must reach the
* screen as FOREIGN — the adversarial state — rather than as a refusal that would hide it.
*
* @param value - one entry of the contacts array.
* @returns the entry, or undefined when it is not a contact this face can resolve.
*/
function parseStoredContact(value) {
	if (!isRecord$2(value) || !contactFieldsAreSafe(value)) return void 0;
	const npub = checkNpub(value.npub);
	if (!npub.ok || npub.npub !== value.npub) return void 0;
	if (typeof value.name !== "string" || value.name.trim() === "" || value.name.length > 120) return void 0;
	if (typeof value.peerControllerKey !== "string") return void 0;
	if (!/^[0-9a-f]{64}$/iu.test(value.peerControllerKey) && !(value.peerControllerKey === "" && value.binding === null)) return void 0;
	if (value.binding === void 0) return void 0;
	return {
		npub: value.npub,
		name: value.name,
		peerControllerKey: value.peerControllerKey,
		binding: value.binding,
		...value.confirmation === void 0 ? {} : { confirmation: value.confirmation }
	};
}
/**
* Validate a whole contacts document off disk.
* @param value - the parsed JSON.
* @returns the document, or undefined when it is not one this face reads.
*/
function parseMessagesContactsDocument(value) {
	if (!isRecord$2(value)) return void 0;
	if (value.domain !== "aukora:nostr-contacts:v1") return void 0;
	if (!Array.isArray(value.contacts)) return void 0;
	if (!Object.entries(value).every(([key, field]) => contactFieldsAreSafe(key) && (key === "contacts" || contactFieldsAreSafe(field)))) return void 0;
	const contacts = [];
	const skipped = [];
	for (const [index, raw] of value.contacts.entries()) {
		const entry = parseStoredContact(raw);
		if (entry === void 0) skipped.push(skippedContact(index, raw));
		else contacts.push(entry);
	}
	return {
		domain: MESSAGES_CONTACTS_DOMAIN,
		contacts,
		...skipped.length === 0 ? {} : { skipped }
	};
}
/**
* Read the contacts file, naming each way it can fail.
*
* The file's absence gets its own name rather than sharing the parse failure's: an operator
* who has not written a contacts file yet has a different next action from one whose file is
* corrupt. The two are separately reachable and separately asserted.
*
* @param stateDir - the absolute state directory.
* @returns the stored contacts, or the named refusal.
*/
async function readContactsFile(stateDir) {
	const path = messagesContactsPath(stateDir);
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		return {
			kind: "refused",
			refusal: refused(errorCode(error) === "ENOENT" ? "messages:contacts-state-missing" : "messages:unreadable-state", path)
		};
	}
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return {
			kind: "refused",
			refusal: refused("messages:contacts-unparseable", path)
		};
	}
	if (!isRecord$2(parsed) || parsed.domain !== "aukora:nostr-contacts:v1") return {
		kind: "refused",
		refusal: refused("messages:contacts-domain-unknown", `${path} (domain ${isRecord$2(parsed) ? safeContactDiagnostic(parsed.domain) : "not-an-object"})`)
	};
	const document = parseMessagesContactsDocument(parsed);
	if (document === void 0) return {
		kind: "refused",
		refusal: refused("messages:contact-malformed", `${path} (document envelope is malformed)`)
	};
	return {
		kind: "contacts",
		contacts: document.contacts,
		...document.skipped === void 0 ? {} : { skipped: document.skipped }
	};
}
/** A reason as a string, whatever the resolver put there. */
function reasonText(value) {
	return typeof value === "string" ? value : "";
}
/** One of the four state strings, or undefined for anything else. */
function asContactState(value) {
	return value === "VERIFIED" || value === "BOUND" || value === "TEST" || value === "UNBOUND" || value === "FOREIGN" ? value : void 0;
}
/** What was presented, or undefined for anything else. */
function asBindingStatus(value) {
	return value === "absent" || value === "verified" || value === "refused" ? value : void 0;
}
/**
* The SAS to show, or null.
*
* NULL IS THE ANSWER FOR EVERYTHING THAT IS NOT A VERIFIED BINDING, and it stays null when
* the resolver's own SAS is missing, malformed, or carries a non-string in either field. A
* placeholder here would be compared out loud and "confirmed", so there is deliberately no
* fallback: an unreadable SAS is no SAS.
*
* @param value - the resolver's `sas`.
* @returns the two leaf fields, or null.
*/
function contactSas(value) {
	if (!isRecord$2(value) || typeof value.digits !== "string" || !/^[0-9]{70}$/u.test(value.digits) || value.spoken !== value.digits.match(/.{5}/gu)?.join(" ") || value.comparisonGroupIndex !== 0 && value.comparisonGroupIndex !== 7) return null;
	const digits = value.digits.slice(value.comparisonGroupIndex * 5, value.comparisonGroupIndex * 5 + 35);
	return parseSafetyNumber({
		digits,
		spoken: digits.match(/.{5}/gu)?.join(" "),
		comparisonGroupIndex: value.comparisonGroupIndex
	}) ?? null;
}
/**
* Resolve one stored contact into the seven leaf fields this face serves.
*
* NOTHING IS DERIVED HERE. `state`, `reason`, `subject`, `sas` and the binding status are
* copied from `resolveContact`'s answer; the one thing this function does on its own is
* REFUSE to carry anything else — no `verdict`, no binding document, no controller key, no
* frozen object graph.
*
* @param resolveContact - the resolver from `aukora-nostr/lib/contact.mjs`.
* @param roots - the state and controller directories.
* @param contact - one stored contact.
* @returns the contact as this face serves it.
*/
function resolveStoredContact(resolveContact, roots, contact) {
	const declared = isRecord$2(contact.binding) && isRecord$2(contact.binding.statement) ? contact.binding.statement.subject : void 0;
	const peer = contact.peerControllerKey;
	if (peer === "" && contact.binding === null) return {
		npub: contact.npub,
		name: contact.name,
		state: "UNBOUND",
		reason: "contact:no-binding",
		subject: null,
		sas: null,
		safetyNumber: null,
		binding: "absent",
		peerControllerKey: ""
	};
	if (typeof peer !== "string" || !/^[0-9a-f]{64}$/iu.test(peer)) return {
		npub: contact.npub,
		name: contact.name,
		state: "FOREIGN",
		reason: "messages:contact-peer-key-malformed: a contact records the peer controller key as 64 hex characters",
		subject: null,
		sas: null,
		safetyNumber: null,
		binding: "refused",
		peerControllerKey: typeof peer === "string" ? peer : ""
	};
	const spec = peer === "" ? {
		npub: contact.npub,
		binding: contact.binding ?? null,
		...roots.controllerDir === void 0 ? {} : { controllerDir: roots.controllerDir }
	} : {
		npub: contact.npub,
		binding: contact.binding ?? null,
		peerControllerKey: peer
	};
	spec.ownerStateDir = roots.stateDir;
	if (roots.controllerDir !== void 0) spec.ownerControllerDir = roots.controllerDir;
	if (contact.confirmation !== void 0 && roots.controllerDir !== void 0) spec.confirmation = contact.confirmation;
	if (typeof declared === "string" && declared !== "") spec.expectSubject = declared;
	let answer;
	try {
		answer = resolveContact(spec);
	} catch (error) {
		return {
			npub: contact.npub,
			name: contact.name,
			state: "FOREIGN",
			reason: reasonText(error instanceof Error ? error.message : error),
			subject: null,
			sas: null,
			safetyNumber: null,
			binding: "refused",
			peerControllerKey: peer
		};
	}
	if (!isRecord$2(answer)) return {
		npub: contact.npub,
		name: contact.name,
		state: "FOREIGN",
		reason: "contact:resolution-returned-no-verdict",
		subject: null,
		sas: null,
		safetyNumber: null,
		binding: "refused",
		peerControllerKey: peer
	};
	const state = asContactState(answer.state) ?? "FOREIGN";
	const binding = asBindingStatus(answer.binding) ?? "absent";
	const verified = binding === "verified" && (state === "VERIFIED" || state === "BOUND" || state === "TEST");
	return {
		npub: contact.npub,
		name: contact.name,
		state,
		reason: reasonText(answer.reason),
		subject: typeof answer.subject === "string" && answer.subject !== "" ? answer.subject : null,
		sas: verified ? contactSas(answer.sas) : null,
		safetyNumber: verified ? contactSas(answer.safetyNumber) : null,
		binding,
		peerControllerKey: peer
	};
}
/**
* The relay list to use, from {@link MESSAGES_RELAYS_ENV} or the module's defaults.
*
* A comma- or whitespace-separated list. An entry that is not `ws://` or `wss://` is DROPPED,
* and a list that ends up empty falls back to the defaults rather than to an empty transport:
* an unparseable override must not silently mean "no relays", which would read to a person as
* "nobody answered me".
*
* @param defaults - the relay module's own default list.
* @returns the relays to use.
*/
function messagesRelays(defaults) {
	const configured = environmentValue(MESSAGES_RELAYS_ENV_NAME);
	if (configured === void 0 || configured.trim() === "") return defaults;
	const parsed = configured.split(/[\s,]+/u).filter((relay) => /^wss?:\/\//u.test(relay));
	return parsed.length === 0 ? defaults : parsed;
}
/**
* The per-relay timeout to use, from {@link MESSAGES_RELAY_TIMEOUT_ENV} or a default.
*
* A court sets this low so a relay that never acknowledges fails in milliseconds instead of
* seconds; production leaves it at the default.
*
* @param fallbackSeconds - the default in seconds.
* @returns the timeout in milliseconds.
*/
function messagesRelayTimeoutMs(fallbackSeconds) {
	const configured = environmentValue(MESSAGES_RELAY_TIMEOUT_ENV_NAME);
	if (configured === void 0 || configured.trim() === "") return fallbackSeconds * 1e3;
	const parsed = Number(configured);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackSeconds * 1e3;
}
/**
* This node's own Nostr secret key, READ and never created.
*
* `loadOrCreateNostrKey` would mint a key when none exists, and this face must not do that as a
* side effect of a request: a person opening the Messages screen should not silently become a
* new Nostr identity, and a court that ran the route would leave a key behind. Creation stays
* with the tool that means it.
*
* @param stateDir - the absolute state directory.
* @returns the secret key in hex, or the named refusal.
*/
async function readNodeSecretKey(stateDir) {
	const path = join(messagesNostrDir(stateDir), "identity.json");
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		return {
			kind: "refused",
			refusal: refused(errorCode(error) === "ENOENT" ? "messages:key-missing" : "messages:key-unreadable", path)
		};
	}
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return {
			kind: "refused",
			refusal: refused("messages:key-unreadable", path)
		};
	}
	const secret = isRecord$2(parsed) ? parsed.secretKeyHex : void 0;
	if (typeof secret !== "string" || !/^[0-9a-f]{64}$/u.test(secret)) return {
		kind: "refused",
		refusal: refused("messages:key-unreadable", path)
	};
	return {
		kind: "key",
		secretKeyHex: secret
	};
}
/**
* Every wrap in one read that this face OPENED and ATTRIBUTED to the requested sender.
*
* THE ONE SELECTION PATH. {@link readMailThread} and the thread route both come through here, so
* the wraps a conversation is built from and the wraps an evidence record is written for cannot
* drift apart: a second, similar-looking filter is exactly how a record gets written for a message
* the thread never showed, or a message gets shown with no record behind it.
*
* A WRAP THAT WILL NOT OPEN IS NOT HERE, and a wrap from somebody else is not here either. Both are
* dropped rather than reported — this face cannot say anything true about either — and neither is
* evidence of a message, so neither gets a record.
*
* MORE THAN ONE WRAP MAY CARRY THE SAME MESSAGE. NIP-17 seals one rumor into a wrap per recipient,
* so the same message legitimately arrives twice; each wrap is its own published event and appears
* here once. De-duplication belongs to the conversation rather than to this list, and
* {@link readMailThread} is where it happens — keyed by the RUMOR's id, which is the mechanism;
* the `has` guard above it only skips a redundant `set` of a key already present.
*
* @param wraps - the gift wraps a relay read returned.
* @param openGiftWrap - the decoder from `aukora-nostr/lib/giftwrap.mjs`.
* @param spec - `{recipientSecretKey, senderPubkeyHex, selfPubkey}`.
* @returns the opened, attributed wraps, oldest first.
*/
const openedCache = /* @__PURE__ */ new Map();
function openedThreadWraps(wraps, openGiftWrap, spec) {
	const wanted = spec.senderPubkeyHex.toLowerCase();
	const self = spec.selfPubkey.toLowerCase();
	const opened = [];
	const seen = /* @__PURE__ */ new Set();
	const recipient = createHash("sha256").update(spec.recipientSecretKey).digest("hex");
	for (const wrap of wraps) {
		let decoded;
		try {
			if (!isRecord$2(wrap) || typeof wrap.id !== "string" || seen.has(wrap.id)) continue;
			if (typeof wrap.created_at !== "number" || !Number.isSafeInteger(wrap.created_at) || wrap.created_at < 0 || wrap.created_at > Math.floor(Date.now() / 1e3)) continue;
			const cacheKey = `${recipient}:${wrap.id}`;
			const wire = JSON.stringify(wrap);
			const cached = openedCache.get(cacheKey);
			if (cached?.wire === wire) decoded = cached.decoded;
			else {
				decoded = openGiftWrap(wrap, { recipientSecretKey: spec.recipientSecretKey });
				if (openedCache.size >= 2048) openedCache.delete(openedCache.keys().next().value);
				openedCache.set(cacheKey, {
					wire,
					decoded
				});
			}
			seen.add(wrap.id);
		} catch {
			continue;
		}
		if (!isRecord$2(decoded) || !isRecord$2(decoded.rumor)) continue;
		const rumor = decoded.rumor;
		const sender = typeof decoded.sender === "string" ? decoded.sender.toLowerCase() : "";
		const from = sender === self ? "me" : "them";
		if (from === "them" && sender !== wanted) continue;
		if (rumor.kind !== 14 || !Array.isArray(rumor.tags)) continue;
		const recipients = rumor.tags.filter((tag) => Array.isArray(tag) && tag[0] === "p" && typeof tag[1] === "string").map((tag) => tag[1]?.toLowerCase());
		if (!recipients.includes(from === "me" ? wanted : self) || recipients.some((recipient) => recipient !== wanted && recipient !== self)) continue;
		if (typeof rumor.id !== "string" || typeof rumor.content !== "string" || typeof rumor.created_at !== "number" || !Number.isSafeInteger(rumor.created_at) || rumor.created_at < 0 || rumor.created_at > Math.floor(Date.now() / 1e3) + 900) continue;
		const at = typeof rumor.created_at === "number" && Number.isFinite(rumor.created_at) ? rumor.created_at : 0;
		const id = typeof rumor.id === "string" && rumor.id !== "" ? rumor.id : `${sender}:${String(at)}:${typeof rumor.content === "string" ? rumor.content : ""}`;
		opened.push({
			wrap,
			message: {
				id,
				from,
				text: typeof rumor.content === "string" ? rumor.content : "",
				at
			}
		});
	}
	return opened.sort((left, right) => left.message.at - right.message.at || left.message.id.localeCompare(right.message.id));
}
/**
* Read the thread for one requested npub: the conversation, and the wraps it came from.
*
* A REQUIRED SENDER WITH NO STATE IS NOT HIDDEN. When the npub is not in the contacts file the
* conversation is still served, with `contactState: 'UNKNOWN'` — refusing would hide messages
* that really arrived, and serving them silently would let a screen imply a contact it does not
* have. And the SAS obeys the same rule as the listing: it is present only for a binding that
* verified, because a string to compare for an unproven identity is worse than no string.
*
* @param wraps - the gift wraps a relay read returned.
* @param openGiftWrap - the decoder from `aukora-nostr/lib/giftwrap.mjs`.
* @param spec - `{recipientSecretKey, senderPubkeyHex, selfPubkey, senderNpub, contact}`.
* @returns the thread and the wraps it was read from.
*/
function readMailThread(wraps, openGiftWrap, spec) {
	const opened = openedThreadWraps(wraps, openGiftWrap, spec);
	const byId = /* @__PURE__ */ new Map();
	for (const entry of opened) {
		if (byId.has(entry.message.id)) continue;
		byId.set(entry.message.id, entry.message);
	}
	return {
		thread: {
			npub: spec.senderNpub,
			contactState: spec.contact?.state ?? "UNKNOWN",
			sas: spec.contact?.sas ?? null,
			safetyNumber: spec.contact?.safetyNumber ?? null,
			messages: [...byId.values()]
		},
		opened
	};
}
/**
* The thread for one requested npub, with what is known about it appended.
*
* The thread alone, for a caller that has no record to write. The route calls
* {@link readMailThread} instead, so that what it serves and what it records come from one read.
*
* @param wraps - the gift wraps a relay read returned.
* @param openGiftWrap - the decoder from `aukora-nostr/lib/giftwrap.mjs`.
* @param spec - `{recipientSecretKey, senderPubkeyHex, selfPubkey, senderNpub, contact}`.
* @returns the thread.
*/
function mailThread(wraps, openGiftWrap, spec) {
	return readMailThread(wraps, openGiftWrap, spec).thread;
}
/** Resolvers already loaded, by specifier. Loading one reads a file, and the answer cannot change. */
const resolverCache = /* @__PURE__ */ new Map();
/**
* Load `resolveContact` from the `aukora-nostr` module this face defers to.
*
* WHY NOT A STATIC IMPORT. The face build compiles each face inside a clone of the pinned
* harness, where `../../aukora-nostr/...` does not exist: `scripts/build-face.py` carries
* `src`, `package.json`, the tsconfigs and `tsdown.config.ts`, and nothing outside the face
* directory. A static import of this module therefore resolves in the source tree and fails
* to type-check and to bundle in the only build that produces `lib/index.js`. `contact.mjs`
* is looked up AT RUNTIME through {@link resolveContactModuleSpecifier}, which walks up from
* this module's own location and honours {@link MESSAGES_CONTACT_MODULE_ENV}, and a
* deployment that carries the two trees apart states where it put them with that variable.
*
* WHAT IT DOES NOT PROVE. The module is imported by path, so the face trusts the bytes at
* that path to be the resolver it names. Nothing here verifies a digest of them; the pin
* court and the source layout are what stand behind that, and this ceiling is stated rather
* than implied away.
*
* @param specifier - module specifier or path. Defaults to {@link defaultContactModuleSpecifier}.
* @returns the resolver, ready to call.
* @throws {Error} `messages:nostr-tree-absent` when this deployment carries no nostr tree, or
*   `messages:contact-module-unloadable` when the module it names cannot be loaded.
*/
async function loadContactResolver(specifier = defaultContactModuleSpecifier()) {
	const cached = resolverCache.get(specifier);
	if (cached !== void 0) return cached;
	let loaded;
	try {
		loaded = await import(__rewriteRelativeImportExtension$3(specifier));
	} catch (cause) {
		throw Object.assign(/* @__PURE__ */ new Error(`the contact resolver could not be loaded from ${specifier}: ${cause instanceof Error ? cause.message : String(cause)}`), { code: "messages:contact-module-unloadable" });
	}
	const resolver = isRecord$2(loaded) ? loaded.resolveContact : void 0;
	if (typeof resolver !== "function") throw Object.assign(/* @__PURE__ */ new Error(`${specifier} exports no resolveContact function`), { code: "messages:contact-module-unloadable" });
	const typed = resolver;
	resolverCache.set(specifier, typed);
	return typed;
}
/**
* Where this face expects the `contact.mjs` module to be, when nothing else says otherwise.
*
* A literal path, exactly the way `documents-reader.ts` names its one private root: the
* resolver is a fixed dependency of this face, not something a request may choose. It is read
* only as the LAST candidate in {@link resolveContactModuleSpecifier}, so a differently laid
* out deployment is found by walking up from this module's own location rather than by
* editing this line.
*/
/** The refusal a deployment gets when it carries no nostr tree to resolve against. */
const MESSAGES_NOSTR_TREE_ABSENT = "messages:nostr-tree-absent";
/** The plugin directory the resolver lives in, named once for every candidate below. */
const CONTACT_MODULE_PLUGIN_DIR = "aukora-nostr";
/** The resolver's path under its plugin directory. */
const CONTACT_MODULE_RELATIVE = ["lib", "contact.mjs"];
/**
* The candidate sources this face resolves `contact.mjs` from, named so a court can assert what
* they are WITHOUT running the resolution.
*
* It exists because of the bug it replaced: the list used to end in an absolute path into one
* developer's checkout. That is invisible to a behavioural arm on the machine that path names —
* every test passed there — so the property has to be checked structurally, on the declared
* sources themselves. `relative` is the fragment joined onto this module's directory at runtime.
*/
const MESSAGES_CONTACT_MODULE_CANDIDATES = Object.freeze({
	env: MESSAGES_CONTACT_MODULE_ENV_NAME,
	relative: [
		"..",
		"..",
		"..",
		CONTACT_MODULE_PLUGIN_DIR,
		...CONTACT_MODULE_RELATIVE
	].join("/")
});
/**
* Environment variable naming the `contact.mjs` module to load, when it is not where this face
* expects it. An absolute path or a `file:` URL. Set it to point the face at another tree; the
* test court uses it to measure the loader against a throwaway module.
*/
const MESSAGES_CONTACT_MODULE_ENV = MESSAGES_CONTACT_MODULE_ENV_NAME;
/**
* Environment variable naming the relays a send or a read uses. A comma- or whitespace-separated
* list; entries that are not `ws://` or `wss://` are dropped. The court points this at its own
* in-process relay so nothing touches the public internet.
*/
const MESSAGES_RELAYS_ENV = MESSAGES_RELAYS_ENV_NAME;
/**
* Environment variable naming the per-relay timeout in MILLISECONDS. A court sets it low so a
* relay that never acknowledges is a refusal in milliseconds rather than seconds.
*/
const MESSAGES_RELAY_TIMEOUT_ENV = MESSAGES_RELAY_TIMEOUT_ENV_NAME;
/**
* The module specifier this face loads the resolver from.
*
* CANDIDATES, IN ORDER, and the first one that exists on disk wins:
*
*   1. `$AUKORA_NOSTR_CONTACT_MODULE`, for a deployment that moved one tree or the other.
*   2. `<this module's directory>/../../../aukora-nostr/lib/contact.mjs`, which is
*      `plugins/aukora-nostr/lib/contact.mjs` both from `src/` in this repository and from
*      `lib/` in a release that keeps every face beside the plugins it uses.
*
* A candidate is checked with `existsSync` and never loaded speculatively, so the answer is a
* path this process can actually import rather than a guess.
*
* THERE IS NO ABSOLUTE-PATH FALLBACK, DELIBERATELY. This used to end in a hardcoded path into
* one developer's checkout. It made the routes work on exactly the machine that path names and
* fail everywhere else, and it failed by falling through to a module-not-found from deep inside
* an import — the least actionable form of the failure. A machine without the tree now gets
* `messages:nostr-tree-absent`, which says what is missing.
*
* @returns an absolute path or the configured specifier.
* @throws {Error} `messages:nostr-tree-absent` when no candidate exists on disk.
*/
function resolveContactModuleSpecifier() {
	const configured = environmentValue(MESSAGES_CONTACT_MODULE_ENV_NAME);
	if (configured !== void 0 && configured.trim() !== "") return configured;
	const candidate = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", CONTACT_MODULE_PLUGIN_DIR, ...CONTACT_MODULE_RELATIVE);
	if (existsSync(candidate)) return candidate;
	throw Object.assign(/* @__PURE__ */ new Error(`this deployment carries no nostr tree at ${candidate}, so no contact can be resolved. Install the tree beside this face, or set ${MESSAGES_CONTACT_MODULE_ENV_NAME} to the contact.mjs to use.`), { code: MESSAGES_NOSTR_TREE_ABSENT });
}
/**
* Where `contact.mjs` is loaded from when nothing else says otherwise.
* @returns the specifier {@link resolveContactModuleSpecifier} chose.
*/
function defaultContactModuleSpecifier() {
	return resolveContactModuleSpecifier();
}
/**
* Read and resolve the whole contact list.
*
* @param resolver - the resolver to read contacts through; see {@link loadContactResolver}.
* @param roots - where the contacts file and the controller record live. The controller directory in
*   it is the mounted service's answer, never a value this module looked up; there is deliberately no
*   default, because a default would be the face deciding where the controller is.
* @returns the list, or the named refusal.
*/
async function listContacts(resolver, roots) {
	if (roots.controllerDir === void 0) return refused("messages:aumlok-not-linked", "no Aumlok phrase is linked on this install yet (the aumlokControl service names no controller directory). Link your seven words in Aumlok, then quit and reopen AUKORA.");
	const controllerRecord = join(roots.controllerDir, "local-control.json");
	try {
		await readFile(controllerRecord, "utf8");
	} catch {
		return refused("messages:no-controller-record", controllerRecord);
	}
	const read = await readContactsFile(roots.stateDir);
	if (read.kind === "refused" && read.refusal.reason === "messages:contacts-state-missing") return {
		status: "ok",
		root: roots.stateDir,
		contacts: []
	};
	if (read.kind === "refused") return read.refusal;
	const contacts = read.contacts.map((contact) => resolveStoredContact(resolver, roots, contact));
	return {
		status: "ok",
		root: roots.stateDir,
		contacts,
		...read.skipped === void 0 ? {} : { skipped: read.skipped }
	};
}
//#endregion
//#region lib/types/add-contact-route.js
/** Insert or explicitly refresh through the release's signed-binding validator and locked writer. */
var __rewriteRelativeImportExtension$2 = function(path, preserveJsx) {
	if (typeof path === "string" && /^\.\.?\//.test(path)) return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function(m, tsx, d, ext, cm) {
		return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : d + ext + "." + cm.toLowerCase() + "js";
	});
	return path;
};
const MESSAGES_ADD_CONTACT_ENDPOINT = "/aukora-messages/add-contact";
const MESSAGES_ADD_CONTACT_REFUSALS = Object.freeze({
	NPUB_INVALID: "messages:add-npub-invalid",
	CONTROLLER_INVALID: "messages:add-controller-invalid",
	BINDING_INVALID: "messages:add-binding-invalid",
	NAME_INVALID: "messages:add-name-invalid",
	BODY_UNREADABLE: "messages:add-body-unreadable",
	ALREADY_PRESENT: "messages:add-already-present",
	REFRESH_TARGET: "messages:add-refresh-target",
	REFRESH_BINDING: "messages:add-refresh-binding",
	CONTACTS_UNREADABLE: "messages:add-contacts-unreadable",
	WRITER_ABSENT: "messages:add-writer-absent",
	WRITE_FAILED: "messages:add-write-failed"
});
const MESSAGES_ADD_LEDGER = "contacts-additions.log";
/** The writer imports its resolver and encoder from this same nostr tree. */
async function loadWriter() {
	try {
		const writer = resolve(dirname(resolveContactModuleSpecifier()), "..", "bin", "add-contact.mjs");
		if (!existsSync(writer)) return void 0;
		return await import(__rewriteRelativeImportExtension$2(pathToFileURL(writer).href));
	} catch {
		return;
	}
}
function isRecord$1(value) {
	return value !== null && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
/** Read the request body as text, bounded by the caller's own limit. */
async function readBody$1(req, limit = 64 * 1024) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
		size += buf.byteLength;
		if (size > limit) return void 0;
		chunks.push(buf);
	}
	return Buffer.concat(chunks).toString("utf8");
}
/** Answer with a named refusal and the status that goes with it. */
function refuse$1(res, name, url, status = 400) {
	res.statusCode = status;
	res.setHeader("content-type", "application/json");
	res.end(JSON.stringify(messagesRefusalBody(name, url)));
}
/** Map writer refusals, including duplicate races decided under its lock. */
function refuseWrite(res, cause, url) {
	switch (cause !== null && typeof cause === "object" && "code" in cause ? cause.code : void 0) {
		case "nostr:add-contact-bad-npub":
			refuse$1(res, MESSAGES_ADD_CONTACT_REFUSALS.NPUB_INVALID, url);
			return;
		case "nostr:add-contact-bad-controller":
			refuse$1(res, MESSAGES_ADD_CONTACT_REFUSALS.CONTROLLER_INVALID, url);
			return;
		case "nostr:add-contact-bad-binding":
			refuse$1(res, MESSAGES_ADD_CONTACT_REFUSALS.BINDING_INVALID, url);
			return;
		case "nostr:add-contact-already-present":
			refuse$1(res, MESSAGES_ADD_CONTACT_REFUSALS.ALREADY_PRESENT, url, 409);
			return;
		case "nostr:add-contact-refresh-target":
			refuse$1(res, MESSAGES_ADD_CONTACT_REFUSALS.REFRESH_TARGET, url, 409);
			return;
		case "nostr:add-contact-refresh-binding":
			refuse$1(res, MESSAGES_ADD_CONTACT_REFUSALS.REFRESH_BINDING, url, 409);
			return;
		case "nostr:add-contact-existing-unreadable":
			refuse$1(res, MESSAGES_ADD_CONTACT_REFUSALS.CONTACTS_UNREADABLE, url, 409);
			return;
		case "nostr:add-contact-locked":
		case "EEXIST":
			res.setHeader("retry-after", "1");
			refuse$1(res, MESSAGES_ADD_CONTACT_REFUSALS.WRITE_FAILED, url, 409);
			return;
		default: refuse$1(res, MESSAGES_ADD_CONTACT_REFUSALS.WRITE_FAILED, url, 500);
	}
}
function addContactRoute(admitted, stateDirOf) {
	return {
		kind: "exact",
		path: MESSAGES_ADD_CONTACT_ENDPOINT,
		handler: async (req, res) => {
			if (!admitted("POST", req, res)) return;
			const url = req.url ?? "/aukora-messages/add-contact";
			let body;
			try {
				const text = await readBody$1(req);
				if (text === void 0) throw new Error("body exceeds limit");
				body = JSON.parse(text);
			} catch {
				refuse$1(res, MESSAGES_ADD_CONTACT_REFUSALS.BODY_UNREADABLE, url);
				return;
			}
			if (!isRecord$1(body)) {
				refuse$1(res, MESSAGES_ADD_CONTACT_REFUSALS.BODY_UNREADABLE, url);
				return;
			}
			const fields = body;
			if (Object.keys(fields).some((key) => ![
				"npub",
				"controller",
				"name",
				"binding",
				"mode"
			].includes(key)) || fields.mode !== void 0 && fields.mode !== "insert" && fields.mode !== "refresh") {
				refuse$1(res, MESSAGES_ADD_CONTACT_REFUSALS.BODY_UNREADABLE, url);
				return;
			}
			const name = typeof fields.name === "string" ? fields.name.trim() : "";
			if (name === "") {
				refuse$1(res, MESSAGES_ADD_CONTACT_REFUSALS.NAME_INVALID, url);
				return;
			}
			if (fields.binding !== void 0 && fields.binding !== null && !isRecord$1(fields.binding)) {
				refuse$1(res, MESSAGES_ADD_CONTACT_REFUSALS.BINDING_INVALID, url);
				return;
			}
			const writer = await loadWriter();
			if (writer === void 0 || typeof writer.addContact !== "function") {
				refuse$1(res, MESSAGES_ADD_CONTACT_REFUSALS.WRITER_ABSENT, url, 500);
				return;
			}
			const stateDir = stateDirOf();
			let written;
			try {
				written = writer.addContact({
					stateDir,
					npub: fields.npub,
					controller: fields.controller,
					name,
					binding: fields.binding,
					mode: fields.mode ?? "insert"
				});
			} catch (cause) {
				refuseWrite(res, cause, url);
				return;
			}
			try {
				appendFileSync(join(stateDir, MESSAGES_ADD_LEDGER), `${(/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/u, "Z")} ${fields.mode === "refresh" ? "refresh" : "add"} npub=${written.entry.npub.slice(0, 12)}… name=${name.length} chars\n`, { mode: 384 });
			} catch {}
			res.statusCode = 200;
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify({
				status: "ok",
				npub: written.entry.npub,
				name: written.entry.name,
				state: written.state,
				binding: written.bindingStatus,
				total: written.total
			}));
		}
	};
}
//#endregion
//#region lib/types/confirm-contact-route.js
/**
* CONFIRM A CONTACT — the route behind the Confirm button.
*
* WHY IT IS A BACKEND ROUTE AND NOT A RENDERER CALL. The live binding travelled a backend process to
* the signer's socket (`aukora-nostr/bin/reissue-binding.mjs` -> `askTheSigner` -> `<state>/signer.sock`
* -> the one-bit window). The face has NO bridge channel to the signer, and it does not need one: this
* route runs host-side Node, so it speaks the same socket the binding did. **The button only POSTs
* here; no preload, no IPC, no renderer change.**
*
* WHAT IT WILL NOT DO. It will not confirm a contact that is not BOUND — a confirmation is a statement
* about a key that has already verified, and there is nothing to confirm about a key that has not. It
* will not store anything the signer did not sign, or anything whose signature does not verify against
* the digits THIS ROUTE PUT IN FRONT OF THE PERSON. And it will not change the binding: when the key
* moves afterwards, the stored confirmation becomes stale and the row drops back to BOUND, which is the
* property that makes the confirmation mean something.
*/
var __rewriteRelativeImportExtension$1 = function(path, preserveJsx) {
	if (typeof path === "string" && /^\.\.?\//.test(path)) return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function(m, tsx, d, ext, cm) {
		return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : d + ext + "." + cm.toLowerCase() + "js";
	});
	return path;
};
/**
* WHERE THE SIGNER CLIENT IS, IN EITHER LAYOUT.
*
* `plugins/aukora-nostr/bin/reissue-binding.mjs:69-70` names both, and its comments say which is which: a release is
* **flat** (`../../aukora-aumlok/lib/signer-client.mjs`) and this checkout is **nested**
* (`../../plugins/aukora-aumlok/lib/signer-client.mjs`). This route resolved only the nested form, so in a release the
* shared transport silently failed to load and the route carried on without it.
*
* @param specifier - the resolved contact-module specifier the writer paths are relative to.
* @returns the client's absolute path, or null when it is in neither layout.
*/
function signerClientIn(specifier) {
	const here = dirname(specifier);
	const candidates = [resolve(here, "..", "..", "aukora-aumlok", "lib", "signer-client.mjs"), resolve(here, "..", "..", "plugins", "aukora-aumlok", "lib", "signer-client.mjs")];
	for (const candidate of candidates) if (existsSync(candidate)) return candidate;
	return null;
}
/** Every way this route can refuse, by name. */
const MESSAGES_CONFIRM_CONTACT_REFUSALS = Object.freeze({
	NPUB_INVALID: "messages:confirm-npub-invalid",
	BODY_UNREADABLE: "messages:confirm-body-unreadable",
	NO_SUCH_CONTACT: "messages:confirm-no-such-contact",
	/** The row is not BOUND, so there is no verified key for a confirmation to be about. */
	NOT_BOUND: "messages:confirm-not-bound",
	SAFETY_VERSION: "messages:confirm-safety-version-mismatch",
	COMPARISON: "messages:confirm-comparison-required",
	/** No signer is reachable, or it answered with something that is not a reply. */
	SIGNER_UNREACHABLE: "messages:confirm-signer-unreachable",
	SIGNER_DECLINED: "messages:confirm-signer-declined",
	/** The reply did not carry this caller's challenge back. */
	CHALLENGE_MISMATCH: "messages:confirm-challenge-mismatch",
	/** The signature came back and does not verify against the digits that were shown. */
	NOT_VERIFIED: "messages:confirm-not-verified",
	WRITE_FAILED: "messages:confirm-write-failed",
	WRITER_ABSENT: "messages:confirm-writer-absent",
	WRITER_UNLOADABLE: "messages:confirm-writer-unloadable",
	WRITER_UNUSABLE: "messages:confirm-writer-unusable"
});
/** Compare the complete pair of identity fingerprints obtained from the peer, never fixed prefixes. */
function comparisonMatches(digits, groups) {
	return /^[0-9]{70}$/u.test(digits) && Array.isArray(groups) && groups.length === 2 && groups.every((group) => typeof group === "string" && /^[0-9]{35}$/u.test(group)) && groups.join("") === digits;
}
const SIGNER_TIMEOUT_MS = 31e4;
/** The largest reply line this route will read. */
const MAX_REPLY_BYTES = 64 * 1024;
async function loadContactParts(specifier) {
	if (specifier === void 0) try {
		specifier = resolveContactModuleSpecifier();
	} catch {
		return { kind: "absent" };
	}
	const writer = resolve(dirname(specifier), "..", "bin", "add-contact.mjs");
	const binding = resolve(dirname(specifier), "..", "bin", "reissue-binding.mjs");
	if (!existsSync(writer) || !existsSync(binding)) return { kind: "absent" };
	try {
		const writerModule = await import(__rewriteRelativeImportExtension$1(pathToFileURL(writer).href));
		const bindingModule = await import(__rewriteRelativeImportExtension$1(pathToFileURL(binding).href));
		const client = signerClientIn(specifier);
		const confirmation = resolve(dirname(specifier), "confirmation.mjs");
		const contact = resolve(dirname(specifier), "contact.mjs");
		const parts = { ...writerModule };
		if (client !== null) Object.assign(parts, await import(__rewriteRelativeImportExtension$1(pathToFileURL(client).href)));
		if (existsSync(confirmation)) Object.assign(parts, await import(__rewriteRelativeImportExtension$1(pathToFileURL(confirmation).href)));
		if (existsSync(contact)) Object.assign(parts, await import(__rewriteRelativeImportExtension$1(pathToFileURL(contact).href)));
		parts.resolveSignerSocketPath = bindingModule.resolveSignerSocketPath;
		return {
			kind: "loaded",
			parts
		};
	} catch (cause) {
		return {
			kind: "unloadable",
			because: cause instanceof Error ? cause.message : String(cause)
		};
	}
}
async function readBody(req, limit = 64 * 1024) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
		size += buf.byteLength;
		if (size > limit) return void 0;
		chunks.push(buf);
	}
	return Buffer.concat(chunks).toString("utf8");
}
function refuse(res, name, url, status = 400) {
	res.statusCode = status;
	res.setHeader("content-type", "application/json");
	res.end(JSON.stringify(messagesRefusalBody(name, url)));
}
/**
* Build the confirm route.
*
* @param admitted - the gate, called before anything is read.
* @param rootsOf - the state and controller directories, read per request.
* @returns the route the web server registers.
*/
function confirmContactRoute(admitted, rootsOf) {
	return {
		kind: "exact",
		path: MESSAGES_CONFIRM_CONTACT_ENDPOINT,
		handler: async (req, res) => {
			if (!admitted("POST", req, res)) return;
			const url = req.url ?? "/aukora-messages/confirm-contact";
			const text = await readBody(req);
			let body;
			try {
				body = JSON.parse(text ?? "");
			} catch {
				refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.BODY_UNREADABLE, url);
				return;
			}
			if (body === null || typeof body !== "object" || Array.isArray(body) || !contactFieldsAreSafe(body) || Object.keys(body).sort().join(",") !== "comparisonGroups,npub,safetyVersion,sasDigits") {
				refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.BODY_UNREADABLE, url);
				return;
			}
			const npub = typeof body.npub === "string" ? String(body.npub) : "";
			if (npub === "") {
				refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.NPUB_INVALID, url);
				return;
			}
			const comparison = body;
			if (comparison.safetyVersion !== 2) {
				refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.SAFETY_VERSION, url, 409);
				return;
			}
			const roots = rootsOf();
			if (roots.controllerDir === void 0) {
				refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.WRITER_ABSENT, url, 500);
				return;
			}
			const loaded = await loadContactParts();
			if (loaded.kind === "absent") {
				refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.WRITER_ABSENT, url, 500);
				return;
			}
			if (loaded.kind === "unloadable") {
				refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.WRITER_UNLOADABLE, url, 500);
				return;
			}
			const parts = loaded.parts;
			const canWrite = typeof parts?.setContactConfirmation === "function";
			const canResolve = typeof parts?.resolveContact === "function";
			const canAsk = typeof parts?.askSignerOperation === "function";
			const canResolveSocket = typeof parts?.resolveSignerSocketPath === "function";
			const canVerify = typeof parts?.verifySasConfirmation === "function";
			if (!canWrite || !canResolve || !canAsk || !canResolveSocket || !canVerify) {
				refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.WRITER_UNUSABLE, url, 500);
				return;
			}
			const stored = parts.readExistingContacts(parts.contactsPath(roots.stateDir)).map(parseStoredContact).find((entry) => entry?.npub === npub);
			if (stored === void 0) {
				refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.NO_SUCH_CONTACT, url, 404);
				return;
			}
			const resolved = parts.resolveContact({
				npub,
				peerControllerKey: stored.peerControllerKey,
				binding: stored.binding ?? null,
				confirmation: stored.confirmation,
				ownerControllerDir: roots.controllerDir,
				ownerStateDir: roots.stateDir
			});
			if (resolved.state !== "BOUND") {
				refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.NOT_BOUND, url, 409);
				return;
			}
			if (resolved.code === "contact:safety-version-mismatch") {
				refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.SAFETY_VERSION, url, 409);
				return;
			}
			const sas = resolved.sas;
			const digits = typeof sas?.digits === "string" ? sas.digits : "";
			const controllerKeyHex = typeof resolved.controllerKeyHex === "string" ? resolved.controllerKeyHex : "";
			const subject = typeof resolved.subject === "string" ? resolved.subject : "";
			if (!/^[0-9]{70}$/u.test(digits) || controllerKeyHex === "") {
				refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.NOT_VERIFIED, url, 409);
				return;
			}
			if (comparison.sasDigits !== digits || !comparisonMatches(digits, comparison.comparisonGroups)) {
				refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.COMPARISON, url, 409);
				return;
			}
			const challenge = randomBytes(32).toString("hex");
			const confirmedAt = (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/u, "Z");
			const { socketPath } = parts.resolveSignerSocketPath(process.env, roots.stateDir);
			let reply;
			try {
				reply = await parts.askSignerOperation({
					operation: "confirm-nostr-sas",
					subject,
					npub,
					controllerKeyHex,
					sasDigits: digits,
					confirmedAt,
					safetyVersion: 2,
					challenge
				}, socketPath, {
					unreachable: MESSAGES_CONFIRM_CONTACT_REFUSALS.SIGNER_UNREACHABLE,
					malformed: MESSAGES_CONFIRM_CONTACT_REFUSALS.SIGNER_UNREACHABLE,
					timeoutMs: SIGNER_TIMEOUT_MS,
					maxBytes: MAX_REPLY_BYTES
				});
			} catch {
				refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.SIGNER_UNREACHABLE, url, 503);
				return;
			}
			if (typeof reply?.refusal === "string" && reply.refusal !== "") {
				refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.SIGNER_DECLINED, url, 409);
				return;
			}
			if (reply.challenge !== challenge) {
				refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.CHALLENGE_MISMATCH, url, 409);
				return;
			}
			if (typeof reply.signature !== "string" || !/^[0-9a-f]{128}$/u.test(reply.signature)) {
				refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.SIGNER_UNREACHABLE, url, 502);
				return;
			}
			const machineHex = parts.ownerController(roots.controllerDir).publicHex;
			const document = {
				domain: String(parts.SAS_CONFIRMATION_DOMAIN ?? ""),
				statement: {
					subject,
					npub,
					controllerKeyHex,
					sasDigits: digits,
					confirmedAt,
					safetyVersion: 2
				},
				signature: reply.signature,
				approvalKeyDid: `did:key:${machineHex}`
			};
			const checked = parts.verifySasConfirmationDetailed ?? parts.verifySasConfirmation;
			const outcome = typeof parts.verifySasConfirmationDetailed === "function" ? parts.verifySasConfirmationDetailed(document, {
				npub,
				subject,
				controllerKeyHex,
				sasDigits: digits,
				safetyVersion: 2,
				ownerControllerDir: roots.controllerDir
			}) : { verdict: parts.verifySasConfirmation(document, {
				npub,
				subject,
				controllerKeyHex,
				sasDigits: digits,
				safetyVersion: 2,
				ownerControllerDir: roots.controllerDir
			}) };
			if (checked === void 0 || outcome.verdict !== "verified") {
				refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.NOT_VERIFIED, url, 409);
				return;
			}
			try {
				parts.setContactConfirmation({
					stateDir: roots.stateDir,
					npub,
					confirmation: document
				});
			} catch {
				refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.WRITE_FAILED, url, 500);
				return;
			}
			const current = parts.readExistingContacts(parts.contactsPath(roots.stateDir)).map(parseStoredContact).find((entry) => entry?.npub === npub);
			if ((current === void 0 ? null : parts.resolveContact({
				npub,
				peerControllerKey: current.peerControllerKey,
				binding: current.binding,
				confirmation: current.confirmation,
				ownerControllerDir: roots.controllerDir,
				ownerStateDir: roots.stateDir
			}))?.state !== "VERIFIED") {
				refuse(res, MESSAGES_CONFIRM_CONTACT_REFUSALS.NOT_VERIFIED, url, 409);
				return;
			}
			res.statusCode = 200;
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify({
				status: "ok",
				npub,
				state: "VERIFIED",
				binding: "verified",
				sas: { digits }
			}));
		}
	};
}
//#endregion
//#region lib/types/index.js
var __rewriteRelativeImportExtension = function(path, preserveJsx) {
	if (typeof path === "string" && /^\.\.?\//.test(path)) return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function(m, tsx, d, ext, cm) {
		return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : d + ext + "." + cm.toLowerCase() + "js";
	});
	return path;
};
/**
* Required services: the loopback HTTP route registry, and the harness's own request gate.
* A missing gate must fail the mount rather than serve the contact graph ungated.
*/
const inject = ["webServer", "connection"];
/**
* WHY THE EVIDENCE WRITER IS NOT THERE — AND THE THREE ANSWERS ARE NOT ONE.
*
* The loader's own comment says it: "… evidence module" and "**the module is there and will not load**" are worth
* being able to tell". It then wrote the SAME code for both, with the cause's message appended — so a human reading
* the wire could tell the difference and **a caller routing on the code could not**. That is the cohesion plan's item
* (5): a module that is absent, one that is present and throws while loading, and one that loads but exports nothing
* usable are three facts about the world.
*
* **EVERY NAME STILL CARRIES `messages:evidence-module-absent`**, so a caller that already routes on the old code
* keeps working; the specific case is appended after it.
*/
function writerAbsenceName(kind, cause) {
	const base = MESSAGES_EVIDENCE_MODULE_ABSENT;
	if (kind === "absent") return base;
	const why = cause instanceof Error ? cause.message : cause === null ? "" : String(cause);
	const suffix = why === "" ? "" : `: ${why}`;
	return kind === "unloadable" ? `${base}: writer-unloadable${suffix}` : `${base}: writer-unusable${suffix}`;
}
/** The loaded modules, by directory, so two requests do not re-read the same files. */
const mailModules = /* @__PURE__ */ new Map();
/**
* Load the gift-wrap, relay, identity and evidence modules from the same `lib/` directory as the
* contact resolver.
*
* WHY NOT STATIC IMPORTS. Same reason as `loadContactResolver`: the face build compiles each
* face inside a clone of the pinned harness where the nostr tree is not present, so a static
* import of those modules fails to type-check and to bundle in the only build that produces
* `lib/index.js`. The directory is derived from the resolver's own path, so the whole nostr
* tree is located once and `AUKORA_NOSTR_CONTACT_MODULE` moves all of it together.
*
* THE EVIDENCE MODULE IS LOADED HERE, FROM THAT SAME DIRECTORY, AND IS NOT A HARD DEPENDENCY.
* There is deliberately no second path resolution anywhere in this face: one resolution names the
* tree, and every module this face uses comes out of the one directory it named, so a deployment
* that moves the tree moves all of it. Evidence is optional because the message is the point and the
* record is the evidence of it: a tree that carries the mail modules and not `evidence.mjs` must
* still send and read, and reports the missing record by name rather than failing the request. The
* four modules above are not optional — nothing can be composed or opened without them.
*
* @param resolverSpecifier - the resolver path; its directory is the module directory.
* @returns the loaded modules.
* @throws {Error} `messages:mail-modules-unloadable` when a required module or export is missing.
*/
async function loadMailModules(resolverSpecifier = resolveContactModuleSpecifier()) {
	const cached = mailModules.get(resolverSpecifier);
	if (cached !== void 0) return cached;
	const directory = resolverSpecifier.slice(0, resolverSpecifier.lastIndexOf("/") + 1);
	const unloadable = (what, cause) => Object.assign(/* @__PURE__ */ new Error(`the ${what} could not be loaded from ${directory}: ${cause instanceof Error ? cause.message : String(cause)}`), { code: "messages:mail-modules-unloadable" });
	let giftwrap;
	let relay;
	let identity;
	let event;
	let evidence;
	let evidenceAbsent = null;
	try {
		giftwrap = await import(__rewriteRelativeImportExtension(`${directory}giftwrap.mjs`));
		relay = await import(__rewriteRelativeImportExtension(`${directory}relay.mjs`));
		identity = await import(__rewriteRelativeImportExtension(`${directory}identity.mjs`));
		event = await import(__rewriteRelativeImportExtension(`${directory}event.mjs`));
	} catch (cause) {
		throw unloadable("nostr mail modules", cause);
	}
	try {
		evidence = await import(__rewriteRelativeImportExtension(`${directory}evidence.mjs`));
	} catch (cause) {
		evidence = void 0;
		evidenceAbsent = writerAbsenceName("unloadable", cause);
	}
	if (evidence !== void 0 && (typeof evidence.writeMessageEvidence !== "function" || typeof evidence.evidenceDir !== "function")) {
		evidenceAbsent = writerAbsenceName("unusable", /* @__PURE__ */ new Error("it exports no writeMessageEvidence and evidenceDir"));
		evidence = void 0;
	}
	const exports = {
		openGiftWrap: [giftwrap, "openGiftWrap"],
		composeDirectMessage: [giftwrap, "composeDirectMessage"],
		fetchGiftWraps: [relay, "fetchGiftWraps"],
		publishToRelays: [relay, "publishToRelays"],
		npubDecode: [identity, "npubDecode"],
		publicKeyOf: [event, "publicKeyOf"],
		publishDmRelays: [relay, "publishDmRelays"],
		fetchDmRelays: [relay, "fetchDmRelays"],
		readStoredGiftWraps: [evidence ?? {}, "readStoredGiftWraps"],
		retainGiftWrap: [evidence ?? {}, "retainGiftWrap"]
	};
	for (const [name, [module, key]] of Object.entries(exports)) if (typeof module[key] !== "function") throw unloadable(name, "it is not a function");
	if (!Array.isArray(relay.DEFAULT_RELAYS)) throw unloadable("DEFAULT_RELAYS", "it is not an array");
	const modules = {
		openGiftWrap: giftwrap.openGiftWrap,
		composeDirectMessage: giftwrap.composeDirectMessage,
		fetchGiftWraps: relay.fetchGiftWraps,
		publishToRelays: relay.publishToRelays,
		DEFAULT_RELAYS: relay.DEFAULT_RELAYS,
		npubDecode: identity.npubDecode,
		publicKeyOf: event.publicKeyOf,
		evidence: evidence === void 0 ? void 0 : {
			writeMessageEvidence: evidence.writeMessageEvidence,
			evidenceDir: evidence.evidenceDir
		},
		evidenceAbsent,
		readStoredGiftWraps: evidence?.readStoredGiftWraps,
		retainGiftWrap: evidence?.retainGiftWrap,
		publishDmRelays: relay.publishDmRelays,
		fetchDmRelays: relay.fetchDmRelays
	};
	mailModules.set(resolverSpecifier, modules);
	return modules;
}
/** Answer with no body but the honest status code. */
function end(res, status) {
	res.writeHead(status, {
		"cache-control": "no-store",
		"x-content-type-options": "nosniff"
	});
	res.end();
}
/** Answer with one JSON body. Nothing served here is cacheable or sniffable. */
function json(res, status, body) {
	res.writeHead(status, {
		"cache-control": "no-store",
		"content-type": "application/json; charset=utf-8",
		"x-content-type-options": "nosniff"
	});
	res.end(JSON.stringify(body));
}
/**
* The HTTP status each refusal reason carries. The reason, not the code, is the contract.
*
* 422 for the three "your document is not one I read" reasons: the request was understood and
* the file's content is what cannot be used, which 400 would misreport as a bad request.
* 503 for a missing controller record or key because that is this node's own missing
* prerequisite, not the caller's mistake. 502 for the relay refusals, because the failure is
* upstream of this machine — 502 rather than 504 because none of them is only a timeout.
*
* @param reason - the named refusal.
* @returns the status code.
*/
function messagesRefusalStatus(reason) {
	switch (reason) {
		case "messages:confirm-npub-invalid": return 400;
		case "messages:confirm-body-unreadable": return 400;
		case "messages:confirm-no-such-contact": return 404;
		case "messages:confirm-not-bound": return 409;
		case "messages:confirm-safety-version-mismatch": return 409;
		case "messages:confirm-comparison-required": return 409;
		case "messages:confirm-signer-unreachable": return 503;
		case "messages:confirm-signer-declined": return 409;
		case "messages:confirm-challenge-mismatch": return 409;
		case "messages:confirm-not-verified": return 409;
		case "messages:confirm-write-failed": return 500;
		case "messages:confirm-writer-absent": return 500;
		case "messages:confirm-writer-unloadable": return 500;
		case "messages:confirm-writer-unusable": return 500;
		case "messages:identity-reissue-failed": return 409;
		case "messages:identity-changed": return 409;
		case "messages:add-npub-invalid": return 400;
		case "messages:add-controller-invalid": return 400;
		case "messages:add-binding-invalid": return 400;
		case "messages:add-name-invalid": return 400;
		case "messages:add-body-unreadable": return 400;
		case "messages:add-already-present": return 409;
		case "messages:add-refresh-target": return 409;
		case "messages:add-refresh-binding": return 409;
		case "messages:add-contacts-unreadable": return 409;
		case "messages:add-writer-absent": return 500;
		case "messages:add-write-failed": return 500;
		case "messages:contacts-state-missing": return 404;
		case "messages:contacts-unparseable": return 422;
		case "messages:contacts-domain-unknown": return 422;
		case "messages:contact-malformed": return 422;
		case "messages:contact-peer-key-malformed": return 422;
		case "messages:no-controller-record": return 503;
		case "messages:aumlok-not-linked": return 503;
		case "messages:key-missing": return 503;
		case "messages:key-unreadable": return 503;
		case "messages:malformed-request": return 400;
		case "messages:state-directory-named": return 400;
		case "messages:request-body-unreadable": return 400;
		case "messages:text-empty": return 400;
		case "messages:text-too-long": return 413;
		case "messages:no-such-route": return 404;
		case "messages:unreadable-state": return 500;
		case "messages:relays-unreachable": return 502;
		case "messages:nobody-accepted": return 502;
		case "messages:reads-unavailable": return 502;
		case "messages:sender-unproven": return 502;
		case "messages:send-timeout": return 504;
		case "messages:thread-timeout": return 504;
	}
}
/**
* THE FENCE, AND THE ANSWER TO THE QUESTION THIS ITEM ASKS FIRST: a route that cannot verify its caller must not
* serve.
*
* Security has one home — the composition's `connection` service — and `vendor/dsh/packages/host/open-in-app/src/
* index.ts` states what its fence does: it "defeats DNS rebinding and cross-site calls", and its browser
* authentication "gates every caller before any resolution result, icon, or launch is reachable". This face used to
* call that fence **and** keep a fifteen-line local Host/Origin check of its own, which is a second fence that can
* drift from the one the rest of the organism uses. The local one is gone; this is the only one left.
*
* **THE FOUR CASES, AND WHY NONE OF THEM SERVES UNFENCED.** The rule on optional pins is that absent is a ceiling and
* present-and-unusable is a fault — but a security dependency is not an optional pin, so there is no ceiling branch
* here: without a working fence the request is refused, and the reason says which of the four it was.
*
* @param connection - the composition's connection service, as `ctx` holds it (possibly nothing at all).
* @param request - the incoming request, which the fence reads headers from.
* @returns the status to refuse with, and the reason; `rejection` undefined means the fence let it through.
*/
function fenceRejectionOf(connection, request) {
	if (connection === null || typeof connection !== "object") return {
		rejection: 403,
		reason: "no-connection"
	};
	const ask = connection.requestRejection;
	if (typeof ask !== "function") return {
		rejection: 500,
		reason: "rejection-not-callable"
	};
	let answer;
	try {
		answer = ask.call(connection, request);
	} catch (error) {
		return {
			rejection: 500,
			reason: `rejection-threw: ${error instanceof Error ? error.message : String(error)}`
		};
	}
	if (answer === 401 || answer === 403) return {
		rejection: answer,
		reason: "fence-rejected"
	};
	if (answer !== void 0) return {
		rejection: 500,
		reason: `rejection-unknown: ${String(answer)}`
	};
	return {
		rejection: void 0,
		reason: null
	};
}
/**
* Run the three checks every request must pass, answering the refusal when it fails.
* @param gate - the harness's per-route request gate.
* @param method - the one HTTP method this route accepts.
* @param req - the request.
* @param res - the response, written to when the request is refused.
* @returns true when the handler may serve.
*/
function admitted(gate, method, req, res) {
	const fence = fenceRejectionOf(gate(), req);
	if (fence.rejection !== void 0) {
		end(res, fence.rejection);
		return false;
	}
	if (req.method !== method) {
		res.setHeader("allow", method);
		end(res, 405);
		return false;
	}
	if (!isSameOriginLoopbackRequest(req)) {
		end(res, 403);
		return false;
	}
	return true;
}
/** The loopback authority a `Host` header may name: `127.0.0.1`, with an optional valid port. */
function parseLoopbackAuthority(authority) {
	const match = /^127\.0\.0\.1(?::([1-9][0-9]{0,4}))?$/u.exec(authority);
	if (match === null) return void 0;
	if (match[1] !== void 0 && Number(match[1]) > 65535) return void 0;
	return new URL(`http://${authority}`);
}
/**
* Whether a request is a same-origin loopback request: a `Host` naming this machine's loopback, no cross-site
* fetch metadata, and — when an `Origin` is present at all — an `http` origin that equals itself and matches the
* `Host`.
*
* **THE NAME IS DELIBERATELY NOT THE ONE THE TWO COPIES USED.** The fence court requires that identifier to be
* absent from the messages face's code, because two same-named predicates in two packages is the shape that drifts
* silently. One shared function with one name, imported, is the same rule with one home.
*
* A NULL ORIGIN IS REFUSED with the rest: a sandbox without `allow-same-origin` sends exactly `Origin: null`, and
* the embedded-app case is decided by the sandbox that produced it, not by this route accepting it.
*/
function isSameOriginLoopbackRequest(req) {
	const header = (name) => {
		const value = req.headers[name];
		return Array.isArray(value) ? value[0] : value;
	};
	const host = header("host");
	if (host === void 0) return false;
	const hostUrl = parseLoopbackAuthority(host);
	if (hostUrl === void 0) return false;
	if (header("sec-fetch-site") === "cross-site") return false;
	const origin = header("origin");
	if (origin === "null") return false;
	if (origin === void 0) return true;
	try {
		const originUrl = new URL(origin);
		return originUrl.protocol === "http:" && originUrl.origin === origin && originUrl.host === hostUrl.host;
	} catch {
		return false;
	}
}
/**
* Refuse a request that tried to name the state directory or the controller record.
*
* @param search - the request query string.
* @param req - the request, for its url in the refusal subject.
* @returns the refusal to answer with, or undefined when the request named neither.
*/
function hostOwnedRefusal(search, req) {
	const field = messagesHostOwnedQueryField(search);
	if (field === void 0) return void 0;
	return messagesRefusalBody("messages:state-directory-named", `${field} in ${req.url ?? ""} — this face reads one state directory, resolved by the host`);
}
/** The largest send body this face will read, in bytes. */
const SEND_BODY_MAX_BYTES = 256 * 1024;
/**
* Read one request body, with a cap and a named refusal for every way it can fail.
*
* The cap is enforced on the COMPLETE body as it arrives, not on a field inside it: a caller
* that streams a gigabyte at this route must be refused before the process holds it.
*
* @param req - the request.
* @returns the text, or the named refusal.
*/
async function readRequestBody(req) {
	const chunks = [];
	let size = 0;
	try {
		for await (const chunk of req) {
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
			size += buffer.length;
			if (size > SEND_BODY_MAX_BYTES) return {
				kind: "refused",
				refusal: messagesRefusalBody("messages:request-body-unreadable", `over ${SEND_BODY_MAX_BYTES} bytes`)
			};
			chunks.push(buffer);
		}
	} catch (cause) {
		return {
			kind: "refused",
			refusal: messagesRefusalBody("messages:request-body-unreadable", cause instanceof Error ? cause.message : String(cause))
		};
	}
	return {
		kind: "body",
		text: Buffer.concat(chunks).toString("utf8")
	};
}
/** Serve one answer under its named status. */
function answer(res, body) {
	if (body.status === "refused") {
		const refusal = messagesRefusalBody(body.reason, body.subject);
		json(res, messagesRefusalStatus(refusal.reason), refusal);
		return;
	}
	json(res, 200, body);
}
/**
* The Cordis service the composition publishes the Aumlok controller directory under.
*
* THE ORGAN'S OWN NAME, SPELLED ONCE HERE. The `aukora-aumlok` row mounts
* `plugins/aukora-aumlok/lib/service.mjs`, whose `SERVICE_NAME` is this exact string, and the sibling
* face `plugins/aukora-face/aumlok` asks for it under the same name. A court asserts the two are the
* same string, because a name nothing publishes would make every listing refuse for a reason nobody
* could see from this file.
*/
const MESSAGES_CONTROLLER_SERVICE_NAME = "aumlokControl";
/**
* The controller record directory, as the mounted `aumlokControl` service names it.
*
* ASKED OF THE CONTEXT ON EVERY REQUEST, not captured in `apply`. The sibling face reads the same
* service the same way for the same reason: a composition can mount a row after this one, and a
* directory captured at mount time would be a launch-pinned value a later mount could never correct.
* `ctx.get` answers `undefined` when no row provides the service — a state this face must REPORT
* rather than vanish in, which is why `aumlokControl` is deliberately NOT declared in `inject`:
* declaring it would withhold the whole Messages face from any composition without a controller row.
*
* NOTHING HERE SUPPLIES A DEFAULT. An absent service, a service naming no `directory`, and a
* `directory` that is not a non-empty string all answer `undefined`, and `listContacts` reports that
* by name. A path composed here would be a guess about a deployment this file cannot see — and on the
* live app the guess `join(stateDir, 'aumlok')` named a directory that does not exist, which turned a
* completed enrolment into `messages:no-controller-record`.
*
* @param ctx - the host context.
* @returns the directory exactly as the service named it, or `undefined` when none was named.
*/
function controllerDirectory(ctx) {
	const get = ctx.get;
	if (typeof get !== "function") return void 0;
	const service = get.call(ctx, MESSAGES_CONTROLLER_SERVICE_NAME);
	if (typeof service !== "object" || service === null) return void 0;
	const directory = service.directory;
	return typeof directory === "string" && directory !== "" ? directory : void 0;
}
/** The roots THIS PROCESS reads, never a directory a request named. */
function roots(ctx) {
	return messagesContactsRoots(controllerDirectory(ctx));
}
const inboxAnnouncements = /* @__PURE__ */ new Map();
async function identityBootstrap() {
	return await import(__rewriteRelativeImportExtension(`${resolveContactModuleSpecifier().replace(/contact\.mjs$/u, "")}bootstrap.mjs`));
}
async function prepareIdentity(stateRoots) {
	const identity = await (await identityBootstrap()).readMessagesIdentity(stateRoots);
	if (Date.now() >= (inboxAnnouncements.get(stateRoots.stateDir) ?? 0)) {
		inboxAnnouncements.set(stateRoots.stateDir, Date.now() + 3e4);
		(async () => {
			const modules = await loadMailModules();
			const key = await readNodeSecretKey(stateRoots.stateDir);
			if (key.kind !== "key") return;
			const publication = await modules.publishDmRelays({
				secretKeyHex: key.secretKeyHex,
				relays: messagesRelays(modules.DEFAULT_RELAYS),
				timeoutMs: 2e3
			});
			const accepted = isRecord(publication) && Array.isArray(publication.accepted) && publication.accepted.length > 0;
			inboxAnnouncements.set(stateRoots.stateDir, Date.now() + (accepted ? 15 * 6e4 : 3e4));
		})().catch(() => {
			inboxAnnouncements.set(stateRoots.stateDir, Date.now() + 3e4);
		});
	}
	return identity;
}
function identityRoute(gate, rootsOf) {
	return {
		kind: "exact",
		path: "/aukora-messages/identity",
		handler: async (req, res) => {
			if (!admitted(gate, "GET", req, res)) return;
			try {
				json(res, 200, {
					status: "ok",
					...await prepareIdentity(rootsOf())
				});
			} catch (error) {
				answer(res, messagesRefusalBody("messages:unreadable-state", causeMessage(error)));
			}
		}
	};
}
/** Only an explicit POST can request a Messages binding; paths and signer anchors stay host-owned. */
function reissueIdentityRoute(gate, rootsOf) {
	return {
		kind: "exact",
		path: MESSAGES_REISSUE_IDENTITY_ENDPOINT,
		handler: async (req, res) => {
			if (!admitted(gate, "POST", req, res)) return;
			const named = hostOwnedRefusal(new URL(req.url ?? "/", "http://x").search, req);
			if (named !== void 0) {
				answer(res, named);
				return;
			}
			const read = await readRequestBody(req);
			if (read.kind === "refused") {
				answer(res, read.refusal);
				return;
			}
			let body;
			try {
				body = JSON.parse(read.text);
			} catch {}
			if (!isRecord(body) || Object.keys(body).sort().join(",") !== "npub,subject" || !contactFieldsAreSafe(body) || typeof body.npub !== "string" || typeof body.subject !== "string" || body.subject === "") {
				answer(res, messagesRefusalBody("messages:malformed-request", MESSAGES_REISSUE_IDENTITY_ENDPOINT));
				return;
			}
			try {
				json(res, 200, {
					status: "ok",
					...await (await identityBootstrap()).reissueMessagesIdentity({
						...rootsOf(),
						expectedNpub: body.npub,
						expectedSubject: body.subject
					})
				});
			} catch (error) {
				const code = typeof error?.code === "string" ? String(error.code) : "nostr:identity-runtime-unavailable";
				json(res, code === "nostr:identity-signer-unreachable" ? 503 : 409, messagesRefusalBody(code === "nostr:identity-changed" ? "messages:identity-changed" : "messages:identity-reissue-failed", code));
			}
		}
	};
}
/** The mail modules, or the refusal when they cannot be loaded. */
async function modulesOrRefusal() {
	try {
		return {
			ok: true,
			modules: await loadMailModules()
		};
	} catch (cause) {
		return {
			ok: false,
			refusal: messagesRefusalBody("messages:unreadable-state", cause instanceof Error ? cause.message : String(cause))
		};
	}
}
/** The contact resolver, or the refusal when it cannot be loaded. */
async function resolverOrRefusal() {
	try {
		return {
			ok: true,
			resolver: await loadContactResolver()
		};
	} catch (cause) {
		return {
			ok: false,
			refusal: messagesRefusalBody("messages:unreadable-state", cause instanceof Error ? cause.message : String(cause))
		};
	}
}
/** The contact row for one npub, or undefined when it is not in the contacts file. */
async function contactFor(resolver, roots, npub) {
	const read = await readContactsFile(roots.stateDir);
	if (read.kind === "refused") return {
		ok: false,
		refusal: read.refusal
	};
	const stored = read.contacts.find((entry) => entry.npub === npub);
	return {
		ok: true,
		contact: stored === void 0 ? void 0 : resolveStoredContact(resolver, roots, stored)
	};
}
/**
* Write ONE evidence record for a gift wrap that really exists, and report it as a pair of fields.
*
* THIS FUNCTION CANNOT FAIL A REQUEST, AND IT CANNOT FAIL SILENTLY. `writeMessageEvidence` is
* synchronous and throws a named code; every throw is turned into `not-recorded` with that code, and
* every success into `recorded`. The message the record is about is never touched: it was already
* published or already opened by the time this runs, and a records directory this process cannot
* write is a fact about the records, not about the message.
*
* `rewritten` IS NOT AN ERROR AND IS DELIBERATELY DISCARDED. The module names each record by the
* event id and writes bytes that are a pure function of the event, so re-reading a message rewrites
* identical bytes; that is idempotence, which is the property that keeps one message to one record.
*
* @param modules - the loaded nostr modules, including whatever this tree has for evidence.
* @param stateDir - the state root the record belongs under.
* @param wrap - the event AS PUBLISHED OR RECEIVED, never a recomposed copy of it.
* @returns whether a record was written, and the named reason when it was not.
*/
async function recordEvidence(modules, stateDir, wrap) {
	const writer = modules.evidence;
	if (writer === void 0) return messagesEvidenceFields("not-recorded", modules.evidenceAbsent ?? "messages:evidence-module-absent");
	try {
		writer.writeMessageEvidence({
			stateDir,
			wrap
		});
		return messagesEvidenceFields("recorded", null);
	} catch (cause) {
		const code = cause?.code;
		return messagesEvidenceFields("not-recorded", typeof code === "string" && code !== "" ? code : MESSAGES_EVIDENCE_UNWRITABLE);
	}
}
/**
* Write one record for each wrap a thread read opened and attributed, and report the aggregate.
*
* EVERY WRAP GETS ITS OWN ATTEMPT, so one unwritable record does not silently cost the others theirs.
* `recorded` here means every wrap that was owed a record has one. A read that opened NOTHING is
* `none`, never `recorded`: no wrap was read, so no record was owed, and `recorded` on an empty
* thread is evidence claimed for a conversation nobody wrote to — the vacuous answer this outcome
* replaced. It is not `not-recorded` either, because claiming a failure that did not happen is its
* own kind of lie. The first refusal is the one reported, because a caller routing on one code is
* better served by a reason than by a count.
*
* @param modules - the loaded nostr modules.
* @param stateDir - the state root the records belong under.
* @param opened - the wraps this read opened and attributed.
* @returns whether every owed record was written, and the first named reason when one was not.
*/
async function recordOpenedWraps(modules, stateDir, opened) {
	if (opened.length === 0) return messagesEvidenceFields("none", null);
	let outcome = messagesEvidenceFields("recorded", null);
	for (const entry of opened) {
		const one = await recordEvidence(modules, stateDir, entry.wrap);
		if (one.evidence === "recorded") continue;
		if (outcome.evidence === "recorded") outcome = one;
	}
	return outcome;
}
/**
* The listing handler: read the contacts file, resolve every contact, answer.
* @param gate - the harness's per-route request gate.
* @param rootsOf - the roots to read, asked per request so the controller directory is the one the
*   service names NOW rather than the one it named when this route was mounted.
* @returns the route.
*/
function contactsRoute(gate, rootsOf) {
	return {
		kind: "exact",
		path: MESSAGES_CONTACTS_ENDPOINT,
		handler: async (req, res) => {
			if (!admitted(gate, "GET", req, res)) return;
			const url = new URL(req.url ?? "/", "http://x");
			const named = hostOwnedRefusal(url.search, req);
			if (named !== void 0) {
				answer(res, named);
				return;
			}
			if (!parseMessagesContactsRequest(url.pathname, url.search)) {
				json(res, 400, messagesRefusalBody("messages:malformed-request", req.url ?? ""));
				return;
			}
			const resolver = await resolverOrRefusal();
			if (!resolver.ok) {
				answer(res, resolver.refusal);
				return;
			}
			await prepareIdentity(rootsOf());
			answer(res, await listContacts(resolver.resolver, rootsOf()));
		}
	};
}
/**
* The bare-prefix handler: the request named no listing, so it is refused by name rather than
* answered with one.
* @param gate - the harness's per-route request gate.
* @returns the route.
*/
function requestRoute(gate) {
	return {
		kind: "exact",
		path: MESSAGES_CONTACTS_REQUEST_ENDPOINT,
		handler: (req, res) => {
			if (!admitted(gate, "GET", req, res)) return;
			const named = hostOwnedRefusal(new URL(req.url ?? "/", "http://x").search, req);
			if (named !== void 0) answer(res, named);
			else json(res, 404, messagesRefusalBody("messages:no-such-route", req.url ?? ""));
		}
	};
}
/**
* The thread handler: read this node's gift wraps, keep the requested contact's messages.
*
* @param gate - the harness's per-route request gate.
* @param rootsOf - the roots to read, asked per request; see {@link contactsRoute}.
* @returns the route.
*/
function threadRoute(gate, rootsOf) {
	return {
		kind: "exact",
		path: MESSAGES_THREAD_ENDPOINT,
		handler: async (req, res) => {
			if (!admitted(gate, "GET", req, res)) return;
			const url = new URL(req.url ?? "/", "http://x");
			const named = hostOwnedRefusal(url.search, req);
			if (named !== void 0) {
				answer(res, named);
				return;
			}
			const requested = parseMessagesThreadRequest(url.pathname, url.search);
			if (requested === void 0) {
				json(res, 400, messagesRefusalBody("messages:malformed-request", req.url ?? ""));
				return;
			}
			const stateRoots = rootsOf();
			await prepareIdentity(stateRoots);
			const modules = await modulesOrRefusal();
			if (!modules.ok) {
				answer(res, modules.refusal);
				return;
			}
			const resolver = await resolverOrRefusal();
			if (!resolver.ok) {
				answer(res, resolver.refusal);
				return;
			}
			const key = await readNodeSecretKey(stateRoots.stateDir);
			if (key.kind === "refused") {
				answer(res, key.refusal);
				return;
			}
			const found = await contactFor(resolver.resolver, stateRoots, requested.npub);
			if (!found.ok) {
				answer(res, found.refusal);
				return;
			}
			const recipientPubkey = npubHexOrRefusal(modules.modules, requested.npub);
			if (typeof recipientPubkey !== "string") {
				answer(res, recipientPubkey);
				return;
			}
			const budgetMs = MESSAGES_THREAD_BUDGET_MS;
			const selfPubkey = modules.modules.publicKeyOf(key.secretKeyHex);
			const stored = modules.modules.readStoredGiftWraps(stateRoots.stateDir);
			const read = await withinBudget(budgetMs, () => fetchWraps(modules.modules, {
				recipientPubkey: selfPubkey,
				secretKeyHex: key.secretKeyHex,
				since: requested.since ?? 0,
				relays: messagesRelays(modules.modules.DEFAULT_RELAYS),
				timeoutMs: budgetedRelayTimeoutMs(messagesRelayTimeoutMs(4), budgetMs)
			}));
			const settled = read.kind === "answered" ? read.value : void 0;
			const threadRead = readMailThread([...stored, ...settled?.wraps ?? []], modules.modules.openGiftWrap, {
				recipientSecretKey: key.secretKeyHex,
				selfPubkey,
				senderPubkeyHex: recipientPubkey,
				senderNpub: requested.npub,
				contact: found.contact
			});
			if (!settled?.answered.length && threadRead.thread.messages.length === 0) {
				answer(res, messagesRefusalBody(read.kind === "timeout" ? "messages:thread-timeout" : read.kind === "failed" ? "messages:unreadable-state" : settled === void 0 ? "messages:reads-unavailable" : "messages:relays-unreachable", read.kind === "failed" ? causeMessage(read.cause) : requested.npub));
				return;
			}
			const thread = threadRead.thread;
			const evidence = await recordOpenedWraps(modules.modules, stateRoots.stateDir, threadRead.opened);
			answer(res, {
				status: "ok",
				npub: thread.npub,
				contactState: thread.contactState,
				sas: thread.sas,
				messages: thread.messages.map((message) => ({
					id: message.id,
					from: message.from,
					text: message.text,
					at: message.at
				})),
				answered: settled?.answered ?? [],
				...evidence
			});
		}
	};
}
/**
* The send handler: compose one NIP-17 message and publish it, reporting what the relays did.
*
* @param gate - the harness's per-route request gate.
* @param rootsOf - the roots to read, asked per request; see {@link contactsRoute}.
* @returns the route.
*/
function sendRoute(gate, rootsOf) {
	return {
		kind: "exact",
		path: MESSAGES_SEND_ENDPOINT,
		handler: async (req, res) => {
			if (!admitted(gate, "POST", req, res)) return;
			const named = hostOwnedRefusal(new URL(req.url ?? "/", "http://x").search, req);
			if (named !== void 0) {
				answer(res, named);
				return;
			}
			const read = await readRequestBody(req);
			if (read.kind === "refused") {
				answer(res, read.refusal);
				return;
			}
			let parsedBody;
			try {
				parsedBody = JSON.parse(read.text);
			} catch {
				answer(res, messagesRefusalBody("messages:request-body-unreadable", req.url ?? ""));
				return;
			}
			const requested = parseMessagesSendRequest(parsedBody);
			if (requested === void 0) {
				answer(res, messagesRefusalBody("messages:malformed-request", req.url ?? ""));
				return;
			}
			if (requested.text === "") {
				answer(res, messagesRefusalBody("messages:text-empty", requested.npub));
				return;
			}
			if (messagesTextBytes(requested.text) > 4e3) {
				answer(res, messagesRefusalBody("messages:text-too-long", `${messagesTextBytes(requested.text)} bytes, over ${MESSAGES_TEXT_MAX_BYTES}`));
				return;
			}
			const stateRoots = rootsOf();
			if (!(await prepareIdentity(stateRoots)).binding) {
				answer(res, messagesRefusalBody("messages:aumlok-not-linked", "Approve the Messages identity binding in the Aumlok popup before sending."));
				return;
			}
			const modules = await modulesOrRefusal();
			if (!modules.ok) {
				answer(res, modules.refusal);
				return;
			}
			const resolver = await resolverOrRefusal();
			if (!resolver.ok) {
				answer(res, resolver.refusal);
				return;
			}
			const key = await readNodeSecretKey(stateRoots.stateDir);
			if (key.kind === "refused") {
				answer(res, key.refusal);
				return;
			}
			const found = await contactFor(resolver.resolver, stateRoots, requested.npub);
			if (!found.ok) {
				answer(res, found.refusal);
				return;
			}
			if (found.contact === void 0) {
				answer(res, messagesRefusalBody("messages:malformed-request", `${requested.npub} is not a contact of this node`));
				return;
			}
			const recipientPubkey = npubHexOrRefusal(modules.modules, requested.npub);
			if (typeof recipientPubkey !== "string") {
				answer(res, recipientPubkey);
				return;
			}
			const relays = messagesRelays(modules.modules.DEFAULT_RELAYS);
			const discovered = await modules.modules.fetchDmRelays({
				pubkey: recipientPubkey,
				relays,
				secretKeyHex: key.secretKeyHex,
				timeoutMs: 2500
			});
			const inbox = isRecord(discovered) && Array.isArray(discovered.relays) ? discovered.relays.filter((relay) => typeof relay === "string") : [];
			if (!isRecord(discovered) || !Array.isArray(discovered.answered) || discovered.answered.length === 0) {
				answer(res, messagesRefusalBody("messages:relays-unreachable", requested.npub));
				return;
			}
			if (inbox.length === 0) {
				answer(res, messagesRefusalBody("messages:reads-unavailable", "nostr:dm-relays-missing"));
				return;
			}
			const budgetMs = MESSAGES_SEND_BUDGET_MS;
			const relayTimeoutMs = budgetedRelayTimeoutMs(messagesRelayTimeoutMs(8), budgetMs);
			const outcome = await withinBudget(budgetMs, async () => {
				const composed = modules.modules.composeDirectMessage({
					text: requested.text,
					senderSecretKey: key.secretKeyHex,
					recipientPubkeys: [recipientPubkey]
				});
				if (!isRecord(composed) || !Array.isArray(composed.wraps) || !isRecord(composed.rumor)) return messagesRefusalBody("messages:reads-unavailable", "the composer returned no wraps");
				const publishedWraps = [];
				let recipientAccepted = false;
				const ordered = [...composed.wraps].sort((a, b) => Number(isRecord(b) && b.recipient === recipientPubkey) - Number(isRecord(a) && a.recipient === recipientPubkey));
				for (const entry of ordered) {
					if (!isRecord(entry) || !isRecord(entry.wrap)) continue;
					const recipient = entry.recipient === recipientPubkey;
					if (!recipient && recipientAccepted) modules.modules.retainGiftWrap(stateRoots.stateDir, entry.wrap);
					const one = recipient || recipientAccepted ? await publishOne(modules.modules, entry.wrap, recipient ? inbox : relays, Math.min(3500, relayTimeoutMs), key.secretKeyHex) : {
						accepted: [],
						verdict: "nostr:recipient-not-accepted"
					};
					if (recipient) recipientAccepted = one.accepted.length > 0;
					publishedWraps.push({
						wrap: entry.wrap,
						copy: recipient ? "recipient" : "self",
						eventId: typeof entry.wrap.id === "string" ? entry.wrap.id : "",
						accepted: one.accepted,
						verdict: one.verdict
					});
				}
				const accepted = publishedWraps.flatMap((entry) => entry.accepted);
				const verdict = publishedWraps.find((entry) => entry.verdict !== null)?.verdict ?? null;
				const acceptedCopies = publishedWraps.filter((entry) => entry.accepted.length > 0);
				let evidence;
				if (acceptedCopies.length === 0) evidence = messagesEvidenceFields("not-recorded", MESSAGES_EVIDENCE_NO_PUBLISH);
				else {
					evidence = messagesEvidenceFields("recorded", null);
					for (const entry of acceptedCopies) {
						const one = await recordEvidence(modules.modules, stateRoots.stateDir, entry.wrap);
						if (one.evidence === "recorded") continue;
						if (evidence.evidence === "recorded") evidence = one;
					}
				}
				const rumor = composed.rumor;
				const at = typeof rumor.created_at === "number" && Number.isFinite(rumor.created_at) ? rumor.created_at : Math.floor(Date.now() / 1e3);
				return {
					status: "sent",
					ok: accepted.length > 0,
					accepted,
					copies: publishedWraps.map((entry) => ({
						copy: entry.copy,
						eventId: entry.eventId,
						accepted: entry.accepted.length > 0,
						relays: entry.accepted,
						refusal: entry.accepted.length > 0 ? null : entry.verdict ?? "nostr:no-relay-accepted"
					})),
					verdict: accepted.length > 0 ? null : verdict ?? "nostr:no-relay-accepted",
					npub: requested.npub,
					id: typeof rumor.id === "string" ? rumor.id : "",
					at,
					...evidence
				};
			});
			if (outcome.kind === "timeout") {
				answer(res, messagesRefusalBody("messages:send-timeout", `${requested.npub} — no relay settled within ${budgetMs}ms, so this send has no accounting to report`));
				return;
			}
			if (outcome.kind === "failed") {
				answer(res, messagesRefusalBody("messages:unreadable-state", causeMessage(outcome.cause)));
				return;
			}
			answer(res, outcome.value);
		}
	};
}
/** Whether a value is a plain JSON object, for the module boundaries above. */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* The 32-byte hex a npub encodes, or the refusal when it is not a npub this face can address.
*
* @param modules - the loaded nostr modules.
* @param npub - the npub from the request.
* @returns the hex, or the refusal to answer with.
*/
function npubHexOrRefusal(modules, npub) {
	try {
		return modules.npubDecode(npub);
	} catch {
		return messagesRefusalBody("messages:malformed-request", `${npub} is not a valid npub`);
	}
}
/** One relay read, or undefined when the read itself failed before it could answer. */
async function fetchWraps(modules, spec) {
	try {
		const result = await modules.fetchGiftWraps({
			recipientPubkey: spec.recipientPubkey,
			secretKeyHex: spec.secretKeyHex,
			...spec.since === null ? {} : { since: spec.since },
			relays: spec.relays,
			timeoutMs: spec.timeoutMs
		});
		if (!isRecord(result)) return void 0;
		return {
			wraps: Array.isArray(result.wraps) ? result.wraps : [],
			answered: Array.isArray(result.answered) ? result.answered.filter((relay) => typeof relay === "string") : []
		};
	} catch {
		return;
	}
}
/** One publish, reduced to the accounting this face reports. */
async function publishOne(modules, wrap, relays, timeoutMs, secretKeyHex) {
	try {
		const result = await modules.publishToRelays(wrap, {
			relays,
			timeoutMs,
			secretKeyHex
		});
		if (!isRecord(result)) return {
			accepted: [],
			verdict: "nostr:no-relay-accepted"
		};
		return {
			accepted: Array.isArray(result.accepted) ? result.accepted.filter((relay) => typeof relay === "string") : [],
			verdict: typeof result.verdict === "string" ? result.verdict : null
		};
	} catch (cause) {
		const code = cause?.code;
		return {
			accepted: [],
			verdict: typeof code === "string" ? code : "nostr:no-relay-accepted"
		};
	}
}
/** The message of any thrown value, without inventing one. */
function causeMessage(cause) {
	return cause instanceof Error ? cause.message : String(cause);
}
/**
* How much of a route's budget is held back from the relay calls it makes.
*
* A relay exchange clamped to exactly the budget would settle at the same instant the deadline
* fires, and which of the two answered would be a race. The margin makes the relay's own named
* outcome the answer whenever it can be, and leaves the deadline for the cases it cannot.
*/
const RELAY_BUDGET_MARGIN_MS = 500;
/**
* The per-relay timeout this route may actually use: the deployment's own, reduced to fit its budget.
*
* @param configuredMs - what `messagesRelayTimeoutMs` read from the environment, or its default.
* @param budgetMs - the route's own budget.
* @returns a positive number of milliseconds strictly inside the budget.
*/
function budgetedRelayTimeoutMs(configuredMs, budgetMs) {
	return Math.max(1, Math.min(configuredMs, budgetMs - RELAY_BUDGET_MARGIN_MS));
}
/**
* Run one request's work under the route's own budget, so a request ALWAYS ends in an answer.
*
* WHY A DEADLINE AND NOT ONLY TIMEOUTS ON THE CALLS. Every relay exchange has its own timeout and
* this face clamps it, so in the ordinary case the relay module's named outcome is what the route
* answers with — which is better than a deadline, because it says what the relays did rather than
* only that nothing settled. But a route that is only as bounded as the calls it happens to make is
* bounded by an assumption, and the assumption is what failed live: nothing in the send route knew
* how long a send was allowed to take, so a slow path simply took longer than the person would wait.
* This is the bound that does not depend on any of them.
*
* THE LOSER IS ABANDONED, NOT CANCELLED. Work still running when the deadline fires cannot be
* un-run, and it must not be able to write the answer: `work` returns a value and never touches the
* response, so an abandoned send may still finish its publishes and records behind the answered
* refusal but can never speak for it. Its rejection is deliberately swallowed below — with the
* deadline already answered there is nothing left to read it, and an unhandled rejection would end
* the process instead.
*
* @param budgetMs - how long the work may take.
* @param work - the work, which must return a value rather than write a response.
* @returns the value, or that the deadline expired, or that the work threw.
*/
async function withinBudget(budgetMs, work) {
	let started;
	try {
		started = work();
	} catch (cause) {
		return {
			kind: "failed",
			cause
		};
	}
	started.catch(() => {});
	let timer;
	try {
		return await Promise.race([started.then((value) => ({
			kind: "answered",
			value
		})), new Promise((resolve) => {
			timer = setTimeout(() => resolve({ kind: "timeout" }), budgetMs);
		})]);
	} catch (cause) {
		return {
			kind: "failed",
			cause
		};
	} finally {
		if (timer !== void 0) clearTimeout(timer);
	}
}
/**
* Register the four routes on the loopback web server.
* @param ctx - host context carrying the route registry and the request gate.
*/
function apply(ctx) {
	if (ctx.webServer.host !== "127.0.0.1") throw new Error("ui-messages: the messages routes require a loopback web server");
	const register = (route) => ctx.webServer.register({
		...route,
		handler: async (req, res) => {
			try {
				await route.handler(req, res);
			} catch (cause) {
				if (!res.headersSent) answer(res, messagesRefusalBody("messages:unreadable-state", causeMessage(cause)));
				else if (!res.writableEnded) res.end();
			}
		}
	});
	const gate = () => Reflect.get(ctx, "connection");
	const rootsOf = () => roots(ctx);
	ctx.effect(() => register(identityRoute(gate, rootsOf)), "ui-messages: identity route");
	ctx.effect(() => register(reissueIdentityRoute(gate, rootsOf)), "ui-messages: explicit identity reissue route");
	ctx.effect(() => register(contactsRoute(gate, rootsOf)), "ui-messages: contacts route");
	ctx.effect(() => register(requestRoute(gate)), "ui-messages: contacts request route");
	ctx.effect(() => register(threadRoute(gate, rootsOf)), "ui-messages: thread route");
	ctx.effect(() => register(sendRoute(gate, rootsOf)), "ui-messages: send route");
	ctx.effect(() => register(addContactRoute((method, req, res) => admitted(gate, method, req, res), () => rootsOf().stateDir)), "ui-messages: add-contact route");
	ctx.effect(() => register(confirmContactRoute((method, req, res) => admitted(gate, method, req, res), () => rootsOf())), "ui-messages: confirm-contact route");
}
//#endregion
export { MESSAGES_CONTACTS_DOMAIN, MESSAGES_CONTACTS_ENDPOINT, MESSAGES_CONTACTS_REFUSAL_REASONS, MESSAGES_CONTACTS_REQUEST_ENDPOINT, MESSAGES_CONTACT_MODULE_CANDIDATES, MESSAGES_CONTACT_MODULE_ENV, MESSAGES_CONTROLLER_SERVICE_NAME, MESSAGES_COPY_ROLES, MESSAGES_EVIDENCE_MODULE_ABSENT, MESSAGES_EVIDENCE_NO_PUBLISH, MESSAGES_EVIDENCE_NO_WRAP_OPENED, MESSAGES_EVIDENCE_OUTCOMES, MESSAGES_EVIDENCE_UNWRITABLE, MESSAGES_HOST_OWNED_QUERY_FIELDS, MESSAGES_NOSTR_TREE_ABSENT, MESSAGES_REFUSAL_REASONS, MESSAGES_RELAYS_ENV, MESSAGES_RELAY_REFUSALS, MESSAGES_RELAY_TIMEOUT_ENV, MESSAGES_SEND_BUDGET_MS, MESSAGES_SEND_ENDPOINT, MESSAGES_STATE_DIR_ENV, MESSAGES_STORE_REFUSALS, MESSAGES_TEXT_MAX_BYTES, MESSAGES_THREAD_BUDGET_MS, MESSAGES_THREAD_ENDPOINT, MESSAGES_WIRE_CONTACT_STATES, MESSAGES_WIRE_REFUSALS, apply, contactSas, defaultContactModuleSpecifier, fenceRejectionOf, inject, isMessagesContactBinding, isMessagesContactState, isMessagesCopyRole, isMessagesEvidenceOutcome, isMessagesRefusalReason, listContacts, loadContactResolver, loadMailModules, mailThread, messagesContactsPath, messagesContactsRequest, messagesContactsRoots, messagesEvidenceFields, messagesHostOwnedQueryField, messagesNostrDir, messagesRefusalBody, messagesRefusalStatus, messagesRelayTimeoutMs, messagesRelays, messagesStateDir, messagesTextBytes, openedThreadWraps, parseMessagesContactEntry, parseMessagesContactsAnswer, parseMessagesContactsBody, parseMessagesContactsDocument, parseMessagesContactsRequest, parseMessagesRefusalBody, parseMessagesSendBody, parseMessagesSendRequest, parseMessagesThreadBody, parseMessagesThreadRequest, parseMessagesWireMessage, parseStoredContact, readContactsFile, readMailThread, readNodeSecretKey, reissueIdentityRoute, resolveContactModuleSpecifier, resolveStoredContact, writerAbsenceName };
