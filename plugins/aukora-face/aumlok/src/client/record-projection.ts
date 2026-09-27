/**
 * THE v3 RECORD, AS THE WIRE ACTUALLY CARRIES IT.
 *
 * WHY THIS FILE EXISTS, MEASURED. `lib/store.mjs` dispatches on the record's own domain: a v3
 * record projects through `recordProjection` in `lib/record-v3.mjs`, and that projection is NOT
 * the seven-field public control `lib/projection.mjs` defines. Measured at this tip, with a
 * disposable phrase bound in a temporary directory:
 *
 *   loadLocalAumlokPublicControl(dir)             -> { projection, path, custodyClass }
 *   loadLocalAumlokPublicControl(dir).projection  -> the RECORD view, eight fields:
 *       subject, rootId, ed25519, mlDsa65, boundAt, genesisRef, epoch, receipt
 *   ctx.aumlokControl.refresh()                   -> that same eight-field record view (the service
 *                                                    unwraps `.projection` at `service.mjs`)
 *
 * The screen validates the seven closed fields of `aukora:aumlok-public-control:v1`, so a machine
 * bound the v3 way arrived at `readControl` as an unrecognised projection and the badge read PREVIEW
 * for ever. THE NESTING IS NOT THE DEFECT — `service.refresh()` already unwraps `.projection`; the
 * FIELD SET is. This file is the face half of that: the second record shape, read where it is.
 *
 * SO THERE ARE TWO RECOGNISED SHAPES AT THIS BOUNDARY. The v1 control record and the v3 record are
 * two NAMED formats, exactly as `store.mjs` says when it dispatches on the domain rather than
 * guessing by shape. A screen that accepts only one of them reports a bound machine as unbound.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO. It does not widen the seven-field parser: an unknown
 * field is still a refusal there, because that strictness is what stops a private half riding along
 * to the screen. It reads no private key material, emits no raw key bytes, and IT DERIVES NO KEY AT
 * ALL — the one key-shaped field the screen renders, `approvalKeyDid`, is carried through from the
 * organ's projection rather than computed here. That is a repair, not a preference: this file used to
 * derive it from `publicRoot.ed25519`, which is the ROOT key, while the key that signs an approval on
 * a bound machine is the MACHINE key whose seed sits in `machine-seed-v3.json`. Two different keys on
 * a real record, and a signature made with one cannot verify under the other.
 */
// TYPE-ONLY, DELIBERATELY: this module is imported BY `control-projection.ts`, and a value import
// back into it would be a cycle. The one domain constant this file needs is its own, below.
import type { AumlokControlProjection } from '../control-projection.ts'

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
export const AUMLOK_RECORD_FIELDS = [
  'subject',
  'rootId',
  'ed25519',
  'mlDsa65',
  'boundAt',
  'genesisRef',
  'epoch',
  'receipt',
  'approvalKeyDid',
] as const

/**
 * The seven control fields, as the ORGAN defines them (`plugins/aukora-aumlok/lib/projection.mjs`).
 *
 * SPELLED HERE RATHER THAN IMPORTED because that module is `node:crypto` code and cannot come into the
 * bundle, exactly as the base58 encoder below is spelled for the same reason. The court that asserts
 * this list is the organ's is `tests/aukora-face-aumlok-control.test.mjs`, which parses a projection the
 * ORGAN produced rather than one this file invented.
 */
export const AUMLOK_RECORD_CONTROL_PROJECTION_FIELDS = [
  'domain',
  'subject',
  'epoch',
  'activeControlDigest',
  'revoked',
  'approvalKeyDid',
  'custodyClass',
] as const

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
export const AUMLOK_CONTROL_CARRIED_RECORD_FIELDS = ['boundAt', 'handle'] as const

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
export const AUMLOK_CONTROL_RECORD_FIELDS = ['boundAt'] as const

/**
 * Whether a candidate is the ORGAN'S CONTROL projection of a v3 record: the seven control fields, the
 * binding moment, and the public handle when the record carries one.
 *
 * STRICT IN BOTH DIRECTIONS, like every other shape check in this file. A missing required field is not
 * this shape, and an EXTRA field is not either — an unknown field reaching the screen is what the closed
 * sets exist to prevent. The control fields are spelled here rather than imported from the v1 parser
 * because that parser's list is its own contract and this shape is a different one.
 */
export function isAumlokRecordControlProjection(input: unknown): boolean {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return false
  if (Object.getPrototypeOf(input) !== Object.prototype) return false
  const allowed = new Set<string>([
    ...AUMLOK_RECORD_CONTROL_PROJECTION_FIELDS,
    ...AUMLOK_CONTROL_RECORD_FIELDS,
    ...AUMLOK_CONTROL_CARRIED_RECORD_FIELDS,
  ])
  const keys = Object.keys(input)
  if (keys.some(key => !allowed.has(key))) return false
  return [...AUMLOK_RECORD_CONTROL_PROJECTION_FIELDS, ...AUMLOK_CONTROL_RECORD_FIELDS]
    .every(field => Object.hasOwn(input, field))
}

/** The one field a v3 record carries only sometimes: the public handle X8 salts the key with. */
export const AUMLOK_RECORD_OPTIONAL_FIELDS = ['handle'] as const

/**
 * The domain this screen shows for a v3 record.
 *
 * IT IS NOT `aukora:aumlok-public-control:v1`, AND IT MUST NOT PRETEND TO BE. `store.mjs` names the
 * two record formats by domain so a reader can tell which one it holds; a v3 record rendered under
 * the v1 control domain would be the screen making the claim the controller refused to make. The
 * field is on the screen precisely so a person can see which record they are reading.
 */
export const AUMLOK_RECORD_DOMAIN = 'aukora:local-aumlok-control:v3'

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
export const AUMLOK_CONTROL_PROJECTION_DOMAIN = 'aukora:aumlok-public-control:v1'

const SUBJECT = /^aukora:1:[0-9a-f]{64}$/u
const DIGEST = /^[0-9a-f]{64}$/u
const REF24 = /^[0-9a-f]{24}$/u
const LOWER_HEX = /^[0-9a-f]+$/u

/** The one custody ceiling a local controller declares, v1 control and v3 record alike. */
const CUSTODY_CLASS = 'same-uid-posix-mode-only'

/** Multicodec `ed25519-pub`, varint-encoded: 0xed needs two bytes, 0xed 0x01. */
const ED25519_PUB_MULTICODEC = [0xed, 0x01]

/** Multibase `base58btc` prefix character. */
const BASE58BTC_MULTIBASE = 'z'

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/**
 * Base58btc, the one encoder `did:key` needs. NOT a hash and not a curve: bit-grouping only.
 *
 * WHY IT IS SPELLED HERE RATHER THAN IMPORTED. The organ's `did-key.mjs` is `node:crypto` code and
 * this half runs in a browser, so it cannot come into the bundle. The construction is published
 * (W3C did:key v0.9, multicodec `ed25519-pub`): `base58btc(0xed01 || key)`.
 * `plugins/aukora-aumlok/lib/base58.mjs` is the specification of this code, and the court compares
 * this encoder's output against the organ's own `didKeyFromEd25519PublicKey` for a real key, so the
 * two cannot drift apart unnoticed.
 * @param bytes - the bytes to encode.
 * @returns the base58btc text, with no multibase prefix.
 */
export function base58btcEncode(bytes: readonly number[]): string {
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  let out = ''
  while (value > 0n) {
    out = BASE58_ALPHABET[Number(value % 58n)] + out
    value /= 58n
  }
  // A leading zero byte is a leading '1', and the loop emits nothing at all for an all-zero input,
  // so the leading zero bytes are counted out here.
  for (const byte of bytes) {
    if (byte !== 0) break
    out = '1' + out
  }
  return out === '' ? '1' : out
}

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
export function parseAumlokRecordControlProjection(input: unknown): Readonly<AumlokControlProjection> {
  if (!isAumlokRecordControlProjection(input)) {
    throw new TypeError('aumlok-record-control-projection: fields must be exactly '
      + `${[...AUMLOK_RECORD_CONTROL_PROJECTION_FIELDS, ...AUMLOK_CONTROL_CARRIED_RECORD_FIELDS].sort().join(', ')}`)
  }
  const record = input as Record<string, unknown>
  const fail = (detail: string): never => {
    throw new TypeError(`aumlok-record-control-projection: ${detail}`)
  }
  const { domain, subject, epoch, activeControlDigest, revoked, approvalKeyDid, custodyClass, boundAt } = record
  // THE DOMAIN IS THE CONTROL PROJECTION'S, NOT THE RECORD'S, AND THIS WAS MEASURED WRONG FIRST. The
  // organ's control projection carries `aukora:aumlok-public-control:v1` — the same domain a v1 control
  // record's projection carries, because that is the shape it is. An earlier cut of this function
  // required this file's own `aukora:local-aumlok-control:v3` here, so it refused every control
  // projection the loader actually produces with `domain must equal aukora:local-aumlok-control:v3`.
  if (domain !== AUMLOK_CONTROL_PROJECTION_DOMAIN) fail(`domain must equal ${AUMLOK_CONTROL_PROJECTION_DOMAIN}`)
  if (typeof revoked !== 'boolean') fail('revoked must be a boolean')
  if (custodyClass !== CUSTODY_CLASS) fail(`custodyClass must equal ${CUSTODY_CLASS}`)
  const subjectText: AumlokControlProjection['subject'] =
    typeof subject === 'string' && SUBJECT.test(subject)
      ? subject as AumlokControlProjection['subject']
      : fail('subject must be aukora:1:<64 hex>')
  if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 0) {
    fail('epoch must be a non-negative integer')
  }
  if (typeof activeControlDigest !== 'string' || !DIGEST.test(activeControlDigest)) {
    fail('activeControlDigest must be 64 hex characters')
  }
  // THE KEY IS SHAPE-CHECKED AND NOT DERIVED. What makes it the RIGHT key is that the organ derived it
  // from the machine the record lists; what this refuses is a string that merely starts `did:key:z`.
  if (typeof approvalKeyDid !== 'string' || !approvalKeyDid.startsWith('did:key:z')) {
    fail('approvalKeyDid must be the did:key of the machine key that signs approvals here')
  }
  if (typeof boundAt !== 'string' && typeof boundAt !== 'number') fail('boundAt must be a string or a number')
  const { handle } = record
  if (handle !== undefined && (typeof handle !== 'string' || handle.length === 0)) {
    fail('handle must be a non-empty string when the record carries one')
  }
  return Object.freeze({
    domain: domain as AumlokControlProjection['domain'],
    subject: subjectText,
    epoch: epoch as number,
    activeControlDigest: activeControlDigest as string,
    revoked: revoked as boolean,
    approvalKeyDid: approvalKeyDid as string,
    custodyClass: CUSTODY_CLASS,
    boundAt: boundAt as string | number,
    ...(typeof handle === 'string' ? { handle } : {}),
  })
}

/**
 * The `did:key` of one raw 32-byte Ed25519 public key, per Genesis plan D1.
 * @param rawHex - 64 lowercase hex characters of the raw Ed25519 public key.
 * @returns `did:key:z…`.
 */
export function didKeyFromEd25519PublicKeyHex(rawHex: string): string {
  const bytes: number[] = [...ED25519_PUB_MULTICODEC]
  for (let index = 0; index < rawHex.length; index += 2) {
    bytes.push(Number.parseInt(rawHex.slice(index, index + 2), 16))
  }
  return `did:key:${BASE58BTC_MULTIBASE}${base58btcEncode(bytes)}`
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
export function isAumlokRecordProjection(input: unknown): boolean {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return false
  if (Object.getPrototypeOf(input) !== Object.prototype) return false
  // THE ORGAN'S CONTROL PROJECTION IS A DIFFERENT SHAPE AND IS NOT TOLERATED HERE. It carries
  // `activeControlDigest` as well, which is not a record field — `isAumlokRecordControlProjection`
  // below owns that shape, and `parseAumlokControl` asks it FIRST. Admitting the field here as well
  // would make two predicates match one value, and the choice between them would stop being decided by
  // the shape and start being decided by the order of two `if`s.
  const allowed = new Set<string>([...AUMLOK_RECORD_FIELDS, ...AUMLOK_RECORD_OPTIONAL_FIELDS])
  const keys = Object.keys(input)
  if (keys.some(key => !allowed.has(key))) return false
  return AUMLOK_RECORD_FIELDS.every(field => Object.hasOwn(input, field))
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
export function parseAumlokRecordProjection(input: unknown): Readonly<AumlokControlProjection> {
  if (!isAumlokRecordProjection(input)) {
    throw new TypeError('aumlok-record-projection: fields must be exactly '
      + `${[...AUMLOK_RECORD_FIELDS].sort().join(', ')}`)
  }
  const record = input as Record<string, unknown>
  const fail = (detail: string): never => {
    throw new TypeError(`aumlok-record-projection: ${detail}`)
  }
  const { subject, rootId, ed25519, mlDsa65, boundAt, genesisRef, epoch, receipt, approvalKeyDid, handle } = record
  // THE SUBJECT IS A GRAMMAR, AND THIS IS THE WHOLE OF WHAT IS REQUIRED OF IT. `subjectText` is
  // `typeof`-narrowed in the same expression rather than by a `fail()` inside a compound condition,
  // because TypeScript does not carry the narrowing out of that call (MEASURED against the pinned
  // compiler). ONE refusal, ONE sentence: a non-string and a mis-spelled string are the same defect
  // to a reader, and the U6c arm pins this message for every malformed subject it tries. Declaring
  // it as `AumlokControlProjection['subject']` is also why the assignment below is not widened back
  // to `string`: the brand IS the grammar, so the variable's type and the check say one thing.
  // Nothing here compares the subject to this record's `rootId` — see the note at the return.
  const subjectText: AumlokControlProjection['subject'] =
    typeof subject === 'string' && SUBJECT.test(subject)
      ? subject as AumlokControlProjection['subject']
      : fail('subject must be aukora:1:<64 hex>')
  if (typeof rootId !== 'string' || !DIGEST.test(rootId)) fail('rootId must be 64 hex characters')
  // THE APPROVAL KEY IS CARRIED, NOT DERIVED, AND THIS LINE IS THE DEFECT THAT WAS HERE.
  //
  // It used to read `didKeyFromEd25519PublicKeyHex(ed25519)`, which derives the did:key of
  // `publicRoot.ed25519` — THE ROOT. What signs an approval on a bound machine is the MACHINE key: root
  // custody is cold, `root-class-v3.mjs` refuses an approval signed by the root's class, and the seed
  // this laptop holds is `machine-seed-v3.json`. The two keys differ on a real record, so the screen
  // named a key that could never verify a signature the shell makes.
  //
  // THE FIELD IS REQUIRED, SO THERE IS NO FALLBACK TO THE OLD DERIVATION. A projection that omits it is
  // refused below rather than silently rendered with the root's DID, because a screen showing the wrong
  // key is worse than a screen showing a named refusal: the wrong key looks exactly like a right one.
  if (typeof approvalKeyDid !== 'string' || !approvalKeyDid.startsWith('did:key:z')) {
    fail('approvalKeyDid must be the did:key of the machine key that signs approvals here — a record '
      + 'listing more than one machine does not settle which, and the root key is never the answer')
  }
  if (typeof ed25519 !== 'string' || !LOWER_HEX.test(ed25519) || ed25519.length !== 64) {
    fail('ed25519 must be a 64-hex raw Ed25519 public key')
  }
  if (typeof mlDsa65 !== 'string' || !LOWER_HEX.test(mlDsa65) || mlDsa65.length === 0) {
    fail('mlDsa65 must be the raw ML-DSA-65 public key in hex')
  }
  if (typeof boundAt !== 'string' && typeof boundAt !== 'number') fail('boundAt must be a string or a number')
  if (typeof genesisRef !== 'string' || !REF24.test(genesisRef)) fail('genesisRef must be 24 hex characters')
  if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 0) {
    fail('epoch must be a non-negative integer')
  }
  if (receipt !== null && (typeof receipt !== 'object' || Array.isArray(receipt))) {
    fail('receipt must be null or the binding receipt object')
  }
  // THE HANDLE, WHEN THE RECORD CARRIES ONE, IS SHOWN RATHER THAN VALIDATED AWAY. It is the public name
  // half of the key (X8) and it is the only thing the bound screen can lock: without it the screen has
  // no name to show and the field it used to offer would have to stay editable. A record bound before
  // X8 carries none, and the screen then shows no handle rather than an empty one — the same rule this
  // parser already follows for a missing bound time.
  if (handle !== undefined && (typeof handle !== 'string' || handle.length === 0)) {
    fail('handle must be a non-empty string when the record carries one')
  }
  // THE SUBJECT IS HELD TO ITS GRAMMAR, AND NOT TO THIS RECORD'S rootId. MEASURED: an earlier cut
  // required `subject === \`aukora:1:${String(rootId)}\`` — "THE SUBJECT IS THE ROOT" — and that
  // refused the record the ceremony actually writes. `scripts/aumlok/bind` builds a genesis first
  // and passes it, so `recordProjection` returns `aukora:1:<sha256(genesis)>` while `rootId` names
  // only the CURRENT keys; the two differ by design, and the plan change of 2026-09-23 10:20 says
  // so ("THE SUBJECT IS THE GENESIS", carried unchanged across refreshes). A bound machine's own
  // record arrived here, failed this equality, and the screen reported `control-unreadable` with
  // the badge at UNBOUND for as long as the check stood.
  //
  // THE REASONING IS THE ORGAN'S OWN, in `plugins/aukora-aumlok/lib/subject.mjs`. Its `parseSubject`
  // reads exactly this spelling and hands back the 64 hex WITHOUT deciding whether it names a root
  // or a genesis — because it cannot, and a rule that guessed would be a second rule. `SUBJECT`
  // above is that same grammar. Whatever the screen needs to render a record comes from the record:
  // the digest it SHOWS is the record's own `rootId`, below, and the subject it shows is the
  // record's own subject. Nothing here needs the two to be equal, and the subject is not decoration
  // — it is the stable identity a refresh must not move.
  //
  // LOOSENING THE EQUALITY IS NOT LOOSENING THE CHECK: the grammar arm at the top of this function
  // already refused everything outside `aukora:1:<64 hex>`, and the U6c arm holds a malformed
  // subject to that refusal whether or not it equals the rootId. The narrowing below is what
  // TypeScript needs to carry the strings past their own checks; every value it narrows has already
  // been held to its grammar above.
  return Object.freeze({
    // The domain the surface renders is THIS record's own domain. `AumlokControlProjection.domain` is
    // typed as the v1 control domain because that is the only domain the v1 parser may carry; the
    // surface's one use of the field is to SHOW it, and showing the v3 record under the v1 control
    // domain would be the screen making the claim the controller refused to make.
    domain: AUMLOK_RECORD_DOMAIN as AumlokControlProjection['domain'],
    subject: subjectText,
    epoch: epoch as number,
    // THE DIGEST SHOWN IS THE RECORD'S OWN rootId, which is a value the record carries and not an
    // assumption about the subject. A refresh moves it; the subject stays put.
    activeControlDigest: rootId as string,
    revoked: false,
    // CARRIED VERBATIM FROM THE ORGAN'S PROJECTION. The screen shows the key the broker will verify
    // under, and the organ is the reader that derived it from the machine the record lists.
    approvalKeyDid: approvalKeyDid as string,
    custodyClass: CUSTODY_CLASS,
    // THE BINDING TIME, CARRIED THROUGH FOR THE RECEIPT. It is the record's own `boundAt` — seconds
    // as the organ writes them — and it is the one field on the screen a person reads as "when did I
    // do this". The seven-field contract above is untouched: this is the v3 record's own field, and
    // `aumlokReceipt` renders `undefined` for a record that carries no readable time rather than
    // inventing a date.
    boundAt: boundAt as string | number,
    // AND THE PUBLIC NAME, for the screen that must show what it is bound to. It is the record's own
    // field, passed through unchanged.
    ...(typeof handle === 'string' ? { handle } : {}),
  })
}
