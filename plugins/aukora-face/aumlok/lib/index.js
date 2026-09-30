//#region lib/types/client/record-projection.js
/**
* The fields `recordProjection` in `plugins/aukora-aumlok/lib/record-v3.mjs` produces.
*
* EIGHT, PLUS THE HANDLE WHEN THE RECORD CARRIES ONE (Y2, 2026-09-23), PLUS THE APPROVAL KEY. This list
* used to be exhaustive at eight, and the organ's projection gained a ninth field when X8 made the
* handle half of the key: `recordProjection` spreads `handle` only for a record that has one, because a
* record bound before X8 carries none and must keep projecting. A list that demanded EXACTLY eight
* therefore refused every record the CURRENT ceremony writes — including, through
* `parseAumlokControl`, the answer the mounted adapter gives — so a machine that had just bound read
* `control-unreadable` and its badge stayed UNBOUND. MEASURED: the organ's own projection over a fresh
* bind carries `subject,rootId,ed25519,mlDsa65,boundAt,genesisRef,epoch,receipt,handle` and this parser
* refused it with "fields must be exactly boundAt, ed25519, epoch, genesisRef, mlDsa65, receipt, rootId,
* subject".
*
* SO THE REQUIRED SET IS THE EIGHT AND THE HANDLE IS OPTIONAL. An unknown ninth field is STILL a
* refusal: a v3 record's field set is closed, and a value nothing validates must not reach the screen.
*
* `approvalKeyDid` IS REQUIRED, AND THE HANDLE'S OPTIONALITY IS EXACTLY WHY IT IS (2026-09-23). The
* screen showed the WRONG KEY for as long as it derived one itself: it built `approvalKeyDid` from
* `ed25519`, which is `publicRoot.ed25519` — the ROOT key — while the key that signs an approval here is
* the MACHINE key whose seed sits in `machine-seed-v3.json` and whose public half the record lists in
* `machines[]`. Those are different keys on a real record (`161bc509…` against `59d6f06e…` on Peter's),
* and a signature made with one cannot verify under the other. The organ's projection now carries the
* approval key it derived, so this parser CARRIES THAT VALUE THROUGH instead of inventing a second
* answer. It is required rather than optional because an optional field would leave the old derivation
* as the fallback and the wrong key would come back the moment the field was absent — and
* `recordProjection` DOES omit it for a record that lists more than one machine, where the record alone
* cannot say which machine signs here. Such a projection is refused by name, which is the honest screen.
* `activeControlDigest` is still read from `rootId` rather than carried: for a v3 record the record's own
* root IS the control head, that is the mapping this file's own comment documents, and a second copy of
* one fact is a second thing to disagree.
*/
const AUMLOK_RECORD_FIELDS = [
	"subject",
	"rootId",
	"ed25519",
	"mlDsa65",
	"boundAt",
	"genesisRef",
	"epoch",
	"receipt",
	"approvalKeyDid"
];
/**
* The seven control fields, as the ORGAN defines them (`plugins/aukora-aumlok/lib/projection.mjs`).
*
* SPELLED HERE RATHER THAN IMPORTED because that module is `node:crypto` code and cannot come into the
* bundle, exactly as the base58 encoder below is spelled for the same reason. The court that asserts
* this list is the organ's is `tests/aukora-face-aumlok-control.test.mjs`, which parses a projection the
* ORGAN produced rather than one this file invented.
*/
const AUMLOK_RECORD_CONTROL_PROJECTION_FIELDS = [
	"domain",
	"subject",
	"epoch",
	"activeControlDigest",
	"revoked",
	"approvalKeyDid",
	"custodyClass"
];
/**
* The record facts the ORGAN'S CONTROL PROJECTION carries beside the seven control fields.
*
* WHY THIS EXISTS, AND IT IS THE SECOND HALF OF THE SAME REPAIR. `loadLocalAumlokPublicControl` now
* answers a v3 record with `projectRecordV3Control` — the seven fields the admission machinery reads,
* which is what makes an approval possible at all — and that function also carries `boundAt` and
* `handle`, because the SCREEN reads them and a read that answered with the control fields alone would
* have taken the binding time away from the receipt and the public name away from the ceremony lock.
* MEASURED: that read arrives here and, before this list existed, `parseAumlokControl` refused it
* `aumlok-control-projection:unrecognised` — a machine that had just bound read UNBOUND, which is the
* exact defect U6 exists to catch, arrived at from the other side.
*/
const AUMLOK_CONTROL_CARRIED_RECORD_FIELDS = ["boundAt", "handle"];
/**
* The record's own fields the ORGAN'S CONTROL PROJECTION carries, and the one it makes optional.
*
* WHAT THE ORGAN'S PROJECTION ACTUALLY IS, MEASURED RATHER THAN ASSUMED. `projectRecordV3Control`
* returns the seven control fields, plus `boundAt` — the one field a person reads as "when did I do
* this", which the receipt renders — plus `handle` when the record has one. It does NOT carry the
* record's other public fields (`rootId`, `ed25519`, `mlDsa65`, `genesisRef`, `receipt`), and that is
* the design rather than an omission: those are the RECORD's view, `recordProjection` answers them, and
* a read that answered both would be two field sets in one value, which is the shape ambiguity this
* file's predicates exist to remove. A caller that needs both — a screen rendering a receipt AND the
* record's keys — reads both, and each answer is closed.
*/
const AUMLOK_CONTROL_RECORD_FIELDS = ["boundAt"];
/**
* Whether a candidate is the ORGAN'S CONTROL projection of a v3 record: the seven control fields, the
* binding moment, and the public handle when the record carries one.
*
* STRICT IN BOTH DIRECTIONS, like every other shape check in this file. A missing required field is not
* this shape, and an EXTRA field is not either — an unknown field reaching the screen is what the closed
* sets exist to prevent. The control fields are spelled here rather than imported from the v1 parser
* because that parser's list is its own contract and this shape is a different one.
*/
function isAumlokRecordControlProjection(input) {
	if (input === null || typeof input !== "object" || Array.isArray(input)) return false;
	if (Object.getPrototypeOf(input) !== Object.prototype) return false;
	const allowed = new Set([
		...AUMLOK_RECORD_CONTROL_PROJECTION_FIELDS,
		...AUMLOK_CONTROL_RECORD_FIELDS,
		...AUMLOK_CONTROL_CARRIED_RECORD_FIELDS
	]);
	if (Object.keys(input).some((key) => !allowed.has(key))) return false;
	return [...AUMLOK_RECORD_CONTROL_PROJECTION_FIELDS, ...AUMLOK_CONTROL_RECORD_FIELDS].every((field) => Object.hasOwn(input, field));
}
/** The one field a v3 record carries only sometimes: the public handle X8 salts the key with. */
const AUMLOK_RECORD_OPTIONAL_FIELDS = ["handle"];
/**
* The domain this screen shows for a v3 record.
*
* IT IS NOT `aukora:aumlok-public-control:v1`, AND IT MUST NOT PRETEND TO BE. `store.mjs` names the
* two record formats by domain so a reader can tell which one it holds; a v3 record rendered under
* the v1 control domain would be the screen making the claim the controller refused to make. The
* field is on the screen precisely so a person can see which record they are reading.
*/
const AUMLOK_RECORD_DOMAIN = "aukora:local-aumlok-control:v3";
/**
* The domain a CONTROL projection carries, which is NOT this file's record domain.
*
* SPELLED HERE RATHER THAN IMPORTED, AND THE REASON IS A CYCLE. `control-projection.ts` already imports
* THIS module, so a value import back into it would be a cycle — the same reason the type import at the
* top is type-only. The value is the organ's (`PUBLIC_CONTROL_DOMAIN` in
* `plugins/aukora-aumlok/lib/projection.mjs`) and it is the same string the face's own
* `AUMLOK_PUBLIC_CONTROL_DOMAIN` holds; the arm in `tests/aukora-face-aumlok-control.test.mjs` parses a
* projection the ORGAN produced, so a drift between the three shows up as a refused projection rather
* than as three spellings agreeing with each other.
*/
const AUMLOK_CONTROL_PROJECTION_DOMAIN = "aukora:aumlok-public-control:v1";
const SUBJECT$1 = /^aukora:1:[0-9a-f]{64}$/u;
const DIGEST$1 = /^[0-9a-f]{64}$/u;
const REF24 = /^[0-9a-f]{24}$/u;
const LOWER_HEX = /^[0-9a-f]+$/u;
/** The one custody ceiling a local controller declares, v1 control and v3 record alike. */
const CUSTODY_CLASS = "same-uid-posix-mode-only";
/**
* Validate the ORGAN'S CONTROL projection of a v3 record and map it onto what the surface renders.
*
* IT DOES NOT RE-DERIVE THE APPROVAL KEY, AND THAT IS THE WHOLE POINT. The value carries
* `approvalKeyDid` because the organ decided which machine signs here — from the seed this laptop kept,
* held against the record's own `machines[]`. This parser checks the field's SHAPE and CARRIES IT. The
* version of this file that computed a DID itself computed the ROOT's, from `publicRoot.ed25519`, and a
* signature made by this laptop can never verify under that key.
*
* THE CLOCK AND THE DIGEST ARE READ THE SAME WAY as in the record view: `activeControlDigest` is
* carried, because on this shape the organ has already stated it, and `rootId` is the same value — the
* arm that asserts they agree is in `tests/aukora-face-aumlok-control.test.mjs`, so the two cannot drift.
* @param input - a value for which {@link isAumlokRecordControlProjection} is true.
* @returns the frozen projection the surface renders.
* @throws TypeError when the value is not exactly one control projection of a v3 record.
*/
function parseAumlokRecordControlProjection(input) {
	if (!isAumlokRecordControlProjection(input)) throw new TypeError(`aumlok-record-control-projection: fields must be exactly ${[...AUMLOK_RECORD_CONTROL_PROJECTION_FIELDS, ...AUMLOK_CONTROL_CARRIED_RECORD_FIELDS].sort().join(", ")}`);
	const record = input;
	const fail = (detail) => {
		throw new TypeError(`aumlok-record-control-projection: ${detail}`);
	};
	const { domain, subject, epoch, activeControlDigest, revoked, approvalKeyDid, custodyClass, boundAt } = record;
	if (domain !== "aukora:aumlok-public-control:v1") fail(`domain must equal ${AUMLOK_CONTROL_PROJECTION_DOMAIN}`);
	if (typeof revoked !== "boolean") fail("revoked must be a boolean");
	if (custodyClass !== CUSTODY_CLASS) fail(`custodyClass must equal ${CUSTODY_CLASS}`);
	const subjectText = typeof subject === "string" && SUBJECT$1.test(subject) ? subject : fail("subject must be aukora:1:<64 hex>");
	if (typeof epoch !== "number" || !Number.isSafeInteger(epoch) || epoch < 0) fail("epoch must be a non-negative integer");
	if (typeof activeControlDigest !== "string" || !DIGEST$1.test(activeControlDigest)) fail("activeControlDigest must be 64 hex characters");
	if (typeof approvalKeyDid !== "string" || !approvalKeyDid.startsWith("did:key:z")) fail("approvalKeyDid must be the did:key of the machine key that signs approvals here");
	if (typeof boundAt !== "string" && typeof boundAt !== "number") fail("boundAt must be a string or a number");
	const { handle } = record;
	if (handle !== void 0 && (typeof handle !== "string" || handle.length === 0)) fail("handle must be a non-empty string when the record carries one");
	return Object.freeze({
		domain,
		subject: subjectText,
		epoch,
		activeControlDigest,
		revoked,
		approvalKeyDid,
		custodyClass: CUSTODY_CLASS,
		boundAt,
		...typeof handle === "string" ? { handle } : {}
	});
}
/**
* Whether a candidate value is a v3 record projection.
*
* STRICT, FOR THE SAME REASON THE SEVEN-FIELD PARSER IS. The record module builds the eight required
* fields, plus `handle` on a record that carries one, and nothing else — so an extra field is a refusal
* rather than a value to ignore.
* @param input - candidate value decoded at a transport boundary.
* @returns true when the value's keys are {@link AUMLOK_RECORD_FIELDS}, plus only
*   {@link AUMLOK_RECORD_OPTIONAL_FIELDS} when present.
*/
function isAumlokRecordProjection(input) {
	if (input === null || typeof input !== "object" || Array.isArray(input)) return false;
	if (Object.getPrototypeOf(input) !== Object.prototype) return false;
	const allowed = new Set([...AUMLOK_RECORD_FIELDS, ...AUMLOK_RECORD_OPTIONAL_FIELDS]);
	if (Object.keys(input).some((key) => !allowed.has(key))) return false;
	return AUMLOK_RECORD_FIELDS.every((field) => Object.hasOwn(input, field));
}
/**
* Validate one v3 record projection and map it onto the projection the surface renders.
*
* EVERY FIELD IS CHECKED AGAINST THE SAME GRAMMARS THE SEVEN-FIELD PARSER USES, so a record this
* screen renders is held to the shapes the controller's own readers enforce. `receipt` is
* present-and-null-or-object: `buildRecordV3` writes it as `null` until a binding produces one, so
* the shape a reader sees never changes between an unbound and a bound root.
*
* THE TWO FIELDS A v3 RECORD DOES NOT CARRY, AND WHAT IS SHOWN FOR THEM:
*
*   `activeControlDigest` names the ACTIVE CONTROL HEAD in v1 — it changes on rotation and on
*   revocation while the subject stays put. A v3 record has no control heads, so the value shown is
*   the record's own `rootId`: the sha256 the organ computed over the record's public keys in
*   `aumlokRootId`, which IS the v3 spelling of "the keys in play now". It is a real digest of a
*   real public identity, it is 64 hex as the field demands, and it is labelled on the screen as
*   the record's digest rather than passed off as a control head's. IT IS NOT THE SUBJECT and must
*   not be required to equal it: a v3 subject is the GENESIS digest, so a refresh moves this field
*   to the new keys while the subject stays where it was — which is the whole point of the pin.
*
*   `revoked` has no v3 counterpart at all — there is no revocation in this record and no control
*   head to revoke. A lost phrase is a NEW INSTANCE, not a terminal state to publish, so this reads
*   the honest value for a record that carries no such statement and never claims one was made.
* @param input - a value for which {@link isAumlokRecordProjection} is true.
* @returns the frozen projection the surface renders.
* @throws TypeError when the value is not exactly one v3 record projection.
*/
function parseAumlokRecordProjection(input) {
	if (!isAumlokRecordProjection(input)) throw new TypeError(`aumlok-record-projection: fields must be exactly ${[...AUMLOK_RECORD_FIELDS].sort().join(", ")}`);
	const record = input;
	const fail = (detail) => {
		throw new TypeError(`aumlok-record-projection: ${detail}`);
	};
	const { subject, rootId, ed25519, mlDsa65, boundAt, genesisRef, epoch, receipt, approvalKeyDid, handle } = record;
	const subjectText = typeof subject === "string" && SUBJECT$1.test(subject) ? subject : fail("subject must be aukora:1:<64 hex>");
	if (typeof rootId !== "string" || !DIGEST$1.test(rootId)) fail("rootId must be 64 hex characters");
	if (typeof approvalKeyDid !== "string" || !approvalKeyDid.startsWith("did:key:z")) fail("approvalKeyDid must be the did:key of the machine key that signs approvals here — a record listing more than one machine does not settle which, and the root key is never the answer");
	if (typeof ed25519 !== "string" || !LOWER_HEX.test(ed25519) || ed25519.length !== 64) fail("ed25519 must be a 64-hex raw Ed25519 public key");
	if (typeof mlDsa65 !== "string" || !LOWER_HEX.test(mlDsa65) || mlDsa65.length === 0) fail("mlDsa65 must be the raw ML-DSA-65 public key in hex");
	if (typeof boundAt !== "string" && typeof boundAt !== "number") fail("boundAt must be a string or a number");
	if (typeof genesisRef !== "string" || !REF24.test(genesisRef)) fail("genesisRef must be 24 hex characters");
	if (typeof epoch !== "number" || !Number.isSafeInteger(epoch) || epoch < 0) fail("epoch must be a non-negative integer");
	if (receipt !== null && (typeof receipt !== "object" || Array.isArray(receipt))) fail("receipt must be null or the binding receipt object");
	if (handle !== void 0 && (typeof handle !== "string" || handle.length === 0)) fail("handle must be a non-empty string when the record carries one");
	return Object.freeze({
		domain: AUMLOK_RECORD_DOMAIN,
		subject: subjectText,
		epoch,
		activeControlDigest: rootId,
		revoked: false,
		approvalKeyDid,
		custodyClass: CUSTODY_CLASS,
		boundAt,
		...typeof handle === "string" ? { handle } : {}
	});
}
//#endregion
//#region lib/types/control-projection.js
/**
* The AUMLOK public control projection, exactly as the controller plugin defines it.
*
* THIS FILE OWNS NO SCHEMA OF ITS OWN. `plugins/aukora-aumlok/lib/projection.mjs`
* defines a closed seven-field public control and builds it field by field so that the
* private half — the Ed25519 private key PEM and the ML-DSA-65 secret — structurally
* cannot appear in it. The screen reproduces those seven fields and refuses anything
* else on the wire. A screen with its own shape would be a second definition of a
* public identity, and the first time the two disagreed the screen would be lying.
*
* WHAT THIS SURFACE IS NOT. It shows status. It never generates a phrase, never asks for one,
* never holds a key, and never approves anything. BINDING RUNS HERE, ON THIS SCREEN: the seven
* words are drawn once, typed back into their tiles, and the root is DERIVED from them — there is
* no separate window in v3 and nothing is unwrapped into a record, because the words themselves
* are the key. Approval is a separate signer process on a Unix socket. Neither is reachable from a
* browser, and neither should be.
*/
const SUBJECT = /^aukora:1:[0-9a-f]{64}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const DID_KEY = /^did:key:z[1-9A-HJ-NP-Za-km-z]{16,}$/u;
/** The closed field set of `plugins/aukora-aumlok/lib/projection.mjs`. */
const FIELDS = [
	"domain",
	"subject",
	"epoch",
	"activeControlDigest",
	"revoked",
	"approvalKeyDid",
	"custodyClass"
];
/** The one domain a public control projection may carry. */
const AUMLOK_PUBLIC_CONTROL_DOMAIN = "aukora:aumlok-public-control:v1";
/** The one custody ceiling the local controller declares. */
const AUMLOK_LOCAL_CUSTODY_CLASS = "same-uid-posix-mode-only";
/** Same-origin GET route serving the current AUMLOK public control. */
const AUMLOK_CONTROL_STATUS_ENDPOINT = "/api/aukora/aumlok-control";
/**
* Build one not-connected body.
* @param reason - which of the three absences this is.
* @param code - the controller's own refusal code, when it produced one.
* @returns the frozen body.
*/
function aumlokNotConnected(reason, code, detail) {
	return Object.freeze({
		status: "not-connected",
		reason,
		...code === void 0 ? {} : { code },
		...detail === void 0 || detail === "" ? {} : { detail }
	});
}
/**
* Validate a candidate not-connected body from the status endpoint.
* @param input - candidate value decoded at a transport boundary.
* @returns the frozen body when exact, undefined otherwise.
*/
function parseAumlokNotConnectedBody(input) {
	if (input === null || typeof input !== "object" || Array.isArray(input)) return void 0;
	if (Object.getPrototypeOf(input) !== Object.prototype) return void 0;
	const record = input;
	if (record["status"] !== "not-connected") return void 0;
	const reason = record["reason"];
	if (reason !== "no-controller-service" && reason !== "adapter-unbound" && reason !== "controller-absent" && reason !== "control-unreadable" && reason !== "record-names-no-machine") return;
	const code = record["code"];
	if (code !== void 0 && (typeof code !== "string" || code.length === 0 || code.length > 128)) return void 0;
	const detail = record["detail"];
	if (detail !== void 0 && (typeof detail !== "string" || detail.length === 0 || detail.length > 1024)) return void 0;
	const keys = Object.keys(record).sort();
	const expected = [
		...code === void 0 ? [] : ["code"],
		...detail === void 0 ? [] : ["detail"],
		"reason",
		"status"
	];
	if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return void 0;
	return aumlokNotConnected(reason, code, detail);
}
/**
* Validate a candidate public control projection against the controller's closed set.
*
* Exactness is the point. An extra field is a refusal, not a value to ignore: the
* controller builds this object field by field precisely so that nothing else can ride
* along, and a parser that tolerated extras would undo that at the last hop.
* @param input - candidate value decoded at a transport boundary.
* @returns the frozen projection.
* @throws TypeError when the value is not exactly one projection.
*/
function parseAumlokControlProjection(input) {
	const fail = (detail) => {
		throw new TypeError(`aumlok-control-projection: ${detail}`);
	};
	if (input === null || typeof input !== "object" || Array.isArray(input)) fail("not an object");
	if (Object.getPrototypeOf(input) !== Object.prototype) fail("not a plain object");
	const record = input;
	const actual = Object.keys(record).sort();
	const expected = [...FIELDS].sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(`fields must be exactly ${expected.join(", ")}`);
	const { domain, subject, epoch, activeControlDigest, revoked, approvalKeyDid, custodyClass } = record;
	if (domain !== "aukora:aumlok-public-control:v1") fail(`domain must equal ${AUMLOK_PUBLIC_CONTROL_DOMAIN}`);
	if (typeof subject !== "string" || !SUBJECT.test(subject)) fail("subject must be aukora:1:<64 hex>");
	if (typeof epoch !== "number" || !Number.isSafeInteger(epoch) || epoch < 0) fail("epoch must be a non-negative integer");
	if (typeof activeControlDigest !== "string" || !DIGEST.test(activeControlDigest)) fail("activeControlDigest must be 64 hex characters");
	if (typeof revoked !== "boolean") fail("revoked must be a boolean");
	if (typeof approvalKeyDid !== "string" || !DID_KEY.test(approvalKeyDid)) fail("approvalKeyDid must be a did:key");
	if (custodyClass !== "same-uid-posix-mode-only") fail(`custodyClass must equal ${AUMLOK_LOCAL_CUSTODY_CLASS}`);
	return Object.freeze({
		domain: AUMLOK_PUBLIC_CONTROL_DOMAIN,
		subject,
		epoch,
		activeControlDigest,
		revoked,
		approvalKeyDid,
		custodyClass: AUMLOK_LOCAL_CUSTODY_CLASS
	});
}
/**
* Validate and normalise EITHER record shape this screen may be handed.
*
* THREE RECOGNISED SHAPES NOW, AND THE THIRD IS WHY THE FIRST TWO COULD NOT BE LEFT ALONE. The
* controller's `lib/store.mjs` dispatches on the record's own domain, so a directory holding a v1
* control record serves the seven-field public control; a directory holding a v3 record serves the
* ORGAN'S CONTROL projection — the seven control fields plus the two record facts the screen reads,
* which is the shape that makes an approval possible at all; and `recordProjection` serves the record's
* own view, which the face's host half reads directly from a directory. All three are the controller's
* own output for a BOUND machine, and a screen that accepts only one of them reports the others as an
* unrecognised projection — which is how a machine bound the v3 way never showed BOUND at all.
*
* THE ORDER IS SPECIFIC-FIRST, AND THAT IS NOT AN ACCIDENT. The control projection and the record view
* have DISJOINT field sets, so at most one predicate can match and no input is read as the wrong shape;
* the v1 parser is last because it is the strictest and the oldest. A shape that is none of the three is
* still a refusal, and the failure names the seven-field contract because that is the one this module
* owns. Nothing unknown is ever rendered.
* @param input - candidate value decoded at a transport boundary.
* @returns the frozen projection, in the surface's own field set either way.
* @throws TypeError when the value is neither shape.
*/
function parseAumlokControl(input) {
	if (isAumlokRecordControlProjection(input)) return parseAumlokRecordControlProjection(input);
	if (isAumlokRecordProjection(input)) return parseAumlokRecordProjection(input);
	return parseAumlokControlProjection(input);
}
//#endregion
//#region lib/types/index.js
var __rewriteRelativeImportExtension = function(path, preserveJsx) {
	if (typeof path === "string" && /^\.\.?\//.test(path)) return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function(m, tsx, d, ext, cm) {
		return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : d + ext + "." + cm.toLowerCase() + "js";
	});
	return path;
};
/** The controller's own refusal when a mount carries no directory. */
const ADAPTER_UNBOUND = "aumlok:adapter-unbound";
/**
* THE RECORD READER'S OWN NAME FOR "THIS RECORD DOES NOT SAY WHICH MACHINE IS THIS LAPTOP".
*
* The shell passes its kept machine key so a second device reads BOUND; a caller that passes none, for a
* record listing several, gets this by name from `record-v3.mjs`. It is a FIFTH absence on this screen
* rather than `control-unreadable`, because the record is not unreadable — nobody said which machine
* this is.
*/
const RECORD_NAMES_NO_MACHINE = "aumlok:record-names-no-machine";
/**
* THE CONTROLLER'S OWN CODE FOR "THERE IS NO RECORD TO READ".
*
* IT IS NOT THE SAME FACT AS A BROKEN ONE, and a person acts differently on each: an empty bound
* directory means nobody has bound yet and the next step is the ceremony; a malformed record means
* something is wrong and the next step is to look. Both used to arrive as `control-unreadable`, so the
* screen told the owner of an empty directory to investigate a controller they had never created.
*/
const CONTROLLER_ABSENT = "aumlok-local:unavailable";
/**
* Required service: the loopback HTTP route registry.
*
* `aumlokControl` is deliberately NOT here. Declaring it would withhold this whole
* plugin from any composition without a controller row — the screen would vanish
* rather than report that there is no controller, which is the opposite of saying
* what is true. It is reached optionally instead, inside apply.
*/
const inject = ["webServer", "connection"];
/**
* Ask the controller for its current public control, and answer with the state the screen renders.
*
* EVERY ABSENCE CARRIES `status: 'not-connected'`, so a caller keys off ONE field whatever happened,
* and the connected case is the same discriminated shape. The reasons are never collapsed: no
* controller service in the composition at all; a service mounted with no directory, which refuses
* `aumlok:adapter-unbound` by name; and a directory that could not be read, whose own refusal code
* is carried verbatim.
* @param service - the mounted adapter, or undefined when no row provides one.
* @returns the fresh control state, or the named absence.
*/
function readControl(service) {
	if (service === void 0) return aumlokNotConnected("no-controller-service");
	return readControlFromAdapter(service);
}
/**
* THE ROUTE'S READ, WHICH HAS A SECOND SOURCE WHEN THE COMPOSITION HAS NONE.
*
* `readControl` keeps its own contract — the adapter, or the named absence — because it is called from
* more than one place and a signature that grew a Promise would move under every caller. This is the
* one the route uses, and it exists for the case Y2 measured: the adapter's row is absent, unpatched,
* or pointed at a directory other than the one the ceremony wrote, and a record on disk must still
* reach the badge.
* @param service - the mounted adapter, when a row provides one.
* @param directory - the controller directory this launch is bound to, when one was named.
* @returns the fresh control state, or the named absence.
*/
async function readControlWithFallback(service, directory) {
	return service === void 0 ? readControlFromDirectory(directory) : readControlFromAdapter(service);
}
/**
* Load one module by a specifier this build cannot see.
* @param specifier - the module to load.
* @returns the module, as the caller's own declared shape.
*/
async function loadUnseen(specifier) {
	return await import(__rewriteRelativeImportExtension(
		/* @vite-ignore */
		specifier
	));
}
/**
* THE DIRECTORY IS A SOURCE OF ITS OWN, AND PETER'S SCREEN IS WHY (Y2, 2026-09-23 17:02).
*
* A binding is a RECORD ON DISK: `bindV3` writes `local-control.json` into the directory the
* composition names, and every reader in this tree — the shell's `readBindingState`, the ceremony, the
* mount's own adapter — reads that file. This plugin ALSO HAS A MOUNT OF ITS OWN, and when that row is
* absent, unpatched, or pointed at a directory other than the one the ceremony wrote, the ONLY route
* the badge reads answered `no-controller-service` over a machine that had just bound. The ceremony
* succeeded, the record was on disk, and the screen could not see it.
*
* SO A MISSING ADAPTER IS NO LONGER AN ANSWER; IT IS A REASON TO READ THE DIRECTORY. The projection is
* built by the ORGAN'S OWN LOADER, `loadLocalAumlokPublicControl` from
* `plugins/aukora-aumlok/lib/store.mjs` — THE SAME CALL the mounted adapter's `refresh()` makes, so a
* record read here and a record read through the composition's row arrive at the screen as the SAME
* value, one field set and one set of grammars, with the public handle included exactly when the record
* carries one. Nothing private is read: the loader returns the public half, and the record's secret
* fields are never touched.
*
* IT USED TO CALL `recordProjection` DIRECTLY, AND THAT IS WHY THIS ROUTE WENT DARK. `recordProjection`
* is the RECORD's view — the published keys, the binding moment, the genesis — and it carries neither
* `activeControlDigest` nor `approvalKeyDid`. `projectControl` below hands what it returns to
* `parseAumlokControl`, which recognises the v1 control, the organ's CONTROL projection, and the record
* view; the record view of a v3 record was the one thing none of them accepted, so a machine that had
* just bound answered 404 with `aumlok-control-projection:unrecognised` on the very route the badge
* reads. The loader answers the control projection for a v3 record, which is what this route serves.
*
* THE ABSENCES KEEP THEIR NAMES: no directory named for this launch is `no-controller-service`
* (nothing has told this process where to look), a directory that is not there or holds no record is
* the organ's own `aumlok-local:unavailable` (`controller-absent`), and a record that IS there and
* cannot be read keeps its code verbatim.
* @param directory - the controller directory this launch is bound to, when one was named.
* @returns the fresh control state, or the named absence.
*/
async function readControlFromDirectory(directory) {
	if (typeof directory !== "string" || directory.length === 0) return aumlokNotConnected("no-controller-service");
	let store;
	try {
		store = await loadUnseen(new URL("../../../aukora-aumlok/lib/store.mjs", import.meta.url).href);
	} catch {
		return aumlokNotConnected("no-controller-service");
	}
	let raw;
	try {
		raw = store.loadLocalAumlokPublicControl(directory).projection;
	} catch (error) {
		return refusalOf(error);
	}
	return projectControl(raw);
}
/**
* One public control off the controller's own adapter, the composition's own service.
* @param service - the mounted adapter.
* @returns the fresh control state, or the named absence.
*/
function readControlFromAdapter(service) {
	let raw;
	try {
		raw = service.refresh();
	} catch (error) {
		return refusalOf(error);
	}
	return projectControl(raw);
}
/**
* The named absence for one refusal, never collapsed with the others.
*
* A THROW IS NOT A VERDICT, AND NOT EVERY THROW IS THE SAME. The adapter throws one named code when it
* was mounted with no directory; the store throws its own codes when a directory is there but
* unreadable. Collapsing both into a single not-found would erase the difference between "nobody
* configured this" and "something is wrong with what was configured".
* @param error - whatever the reader or the adapter threw.
* @returns the not-connected state carrying the reason and the raiser's own code.
*/
function refusalOf(error) {
	const code = typeof error?.code === "string" ? error.code : void 0;
	const message = typeof error?.message === "string" ? error.message : "";
	const rendered = code !== void 0 && message.startsWith(`${code}: `) ? message.slice(code.length + 2) : message === code ? "" : message;
	const detail = rendered.length > 1e3 ? rendered.slice(0, 1e3) : rendered;
	return aumlokNotConnected(code === ADAPTER_UNBOUND ? "adapter-unbound" : code === CONTROLLER_ABSENT ? "controller-absent" : code === RECORD_NAMES_NO_MACHINE ? "record-names-no-machine" : "control-unreadable", code, detail === "" ? void 0 : detail);
}
/**
* The state one projected control is, or the refusal that says why it is not one.
*
* EITHER RECORD SHAPE: the v1 public control and the v3 record are two NAMED formats the controller
* itself serves from one directory, and `store.mjs` says so when it dispatches on the record's own
* domain. `parseAumlokControl` accepts both and normalises them into the field set this screen renders;
* a shape that is neither is refused by name rather than rendered.
* @param raw - the value the adapter or the record reader returned.
* @returns the connected state, or the unrecognised-projection refusal.
*/
function projectControl(raw) {
	try {
		return Object.freeze({
			status: "connected",
			control: parseAumlokControl(raw)
		});
	} catch {
		return aumlokNotConnected("control-unreadable", "aumlok-control-projection:unrecognised");
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
function end(res, status) {
	res.writeHead(status, {
		"cache-control": "no-store",
		"x-content-type-options": "nosniff"
	});
	res.end();
}
function route(gate, read) {
	return {
		kind: "exact",
		path: AUMLOK_CONTROL_STATUS_ENDPOINT,
		handler: (req, res) => {
			const fence = fenceRejectionOf(gate(), req);
			if (fence.rejection !== void 0) {
				end(res, fence.rejection);
				return;
			}
			if (req.method !== "GET") {
				res.setHeader("allow", "GET");
				end(res, 405);
				return;
			}
			read().then((answer) => {
				const connected = answer.status === "connected";
				res.writeHead(connected ? 200 : 404, {
					"cache-control": "no-store",
					"content-type": "application/json; charset=utf-8",
					"x-content-type-options": "nosniff"
				});
				res.end(JSON.stringify(answer));
			});
		}
	};
}
/**
* Publish the controller's public control on one loopback, same-origin GET route.
*
* TWO SOURCES, ONE ANSWER, and the order matters: the composition's own adapter when a row provides
* one, because a mounted adapter can carry a pinned `expectation` this route knows nothing about; and
* otherwise the controller DIRECTORY this row names, read with the face's own record reader. Without
* the second source a machine whose record is on disk reads as no-controller-service, which is the
* state Y2's red arm measured on Peter's bind.
* @param ctx - host context carrying the route registry.
* @param config - this row's `directory`, when the composition names one.
*/
function apply(ctx, config) {
	if (ctx.webServer.host !== "127.0.0.1") throw new Error("ui-aumlok: control status requires a loopback web server");
	const directory = readConfiguredDirectory(config);
	const controller = () => {
		const service = ctx.get("aumlokControl");
		return typeof service === "object" && service !== null && typeof service.refresh === "function" ? service : void 0;
	};
	const gate = () => Reflect.get(ctx, "connection");
	ctx.effect(() => ctx.webServer.register(route(gate, () => readControlWithFallback(controller(), directory))), "ui-aumlok: control status route");
}
/**
* This row's `directory`, when the composition names one.
*
* THE ROW IS HOW A DEPLOYMENT TELLS THIS SCREEN WHERE TO LOOK. Peter's launch already patches an
* existing row rather than inserting one — `session-query-sqlite` in his own patch set is the measured
* example — so `aukora-face-aumlok` can be pointed at the controller directory the same way, and the
* shell's ceremony writes to the same path. Nothing is guessed here: a config that names no directory
* is not an error, it is the composition this plugin has always served, and the adapter's own source
* is preferred over it whenever a row provides one.
* @param config - the composition row's configuration.
* @returns the directory, or undefined when this row names none.
*/
function readConfiguredDirectory(config) {
	if (config === null || typeof config !== "object") return void 0;
	const directory = config.directory;
	return typeof directory === "string" && directory.length > 0 ? directory : void 0;
}
//#endregion
export { AUMLOK_CONTROL_STATUS_ENDPOINT, AUMLOK_LOCAL_CUSTODY_CLASS, AUMLOK_PUBLIC_CONTROL_DOMAIN, apply, aumlokNotConnected, fenceRejectionOf, inject, parseAumlokControl, parseAumlokControlProjection, parseAumlokNotConnectedBody, readControl, readControlWithFallback };
