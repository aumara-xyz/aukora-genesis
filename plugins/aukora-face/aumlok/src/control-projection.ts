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

import {
  isAumlokRecordControlProjection,
  isAumlokRecordProjection,
  parseAumlokRecordControlProjection,
  parseAumlokRecordProjection,
} from './client/record-projection.ts'

const SUBJECT = /^aukora:1:[0-9a-f]{64}$/u
const DIGEST = /^[0-9a-f]{64}$/u
const DID_KEY = /^did:key:z[1-9A-HJ-NP-Za-km-z]{16,}$/u

/** The closed field set of `plugins/aukora-aumlok/lib/projection.mjs`. */
const FIELDS = [
  'domain',
  'subject',
  'epoch',
  'activeControlDigest',
  'revoked',
  'approvalKeyDid',
  'custodyClass',
] as const

/** The one domain a public control projection may carry. */
export const AUMLOK_PUBLIC_CONTROL_DOMAIN = 'aukora:aumlok-public-control:v1'

/** The one custody ceiling the local controller declares. */
export const AUMLOK_LOCAL_CUSTODY_CLASS = 'same-uid-posix-mode-only'

/**
 * Why this launch has no projection to show. Each value is a DIFFERENT fact and they
 * must not be collapsed: no controller service in the composition at all, a service
 * mounted with no directory, and a directory that could not be read are three separate
 * states of the system, and an operator acts differently on each.
 */
export type AumlokNotConnectedReason =
  | 'no-controller-service'
  | 'adapter-unbound'
  | 'controller-absent'
  | 'control-unreadable'
  /**
   * A record that NAMES SEVERAL MACHINES, read by a caller that did not say which one it is.
   *
   * IT IS A FIFTH ABSENCE BECAUSE IT IS A FIFTH SITUATION, and the operator acts differently on it than
   * on the other four: nothing is unbound, nothing is broken, and no directory is missing — the record
   * lists more than one machine and this read was given no key. It used to arrive as `control-unreadable`,
   * which sends a person to investigate a record that is perfectly good.
   */
  | 'record-names-no-machine'

/** Exact body served when this launch can show no public control. */
export interface AumlokNotConnectedBody {
  readonly status: 'not-connected'
  readonly reason: AumlokNotConnectedReason
  /**
   * The refusal code the controller itself produced, when there was one. Carried
   * verbatim so the screen quotes the system instead of paraphrasing it.
   */
  readonly code?: string
  /**
   * THE SENTENCE THE READER WROTE, so the screen shows the answer and not only the code.
   *
   * A code is not something a person can act on: `aumlok:record-names-no-machine` does not say which
   * reader CAN name the machine, and the reader's own message does. Carried verbatim and bounded — it is
   * data from the controller and this route renders it.
   */
  readonly detail?: string
}

/** Same-origin GET route serving the current AUMLOK public control. */
export const AUMLOK_CONTROL_STATUS_ENDPOINT = '/api/aukora/aumlok-control'

/**
 * Public control metadata: the controller's closed seven fields, PLUS the one optional receipt time a
 * v3 record carries and a v1 control does not.
 */
export interface AumlokControlProjection {
  /** Projection domain; a projection carrying any other domain is not one of these. */
  readonly domain: typeof AUMLOK_PUBLIC_CONTROL_DOMAIN
  /** Stable public AUKORA subject. */
  readonly subject: `aukora:1:${string}`
  /** Active root-control epoch. */
  readonly epoch: number
  /** SHA-256 digest of the active root-control record. */
  readonly activeControlDigest: string
  /**
   * The public handle this identity was bound under, when its record carries one (X8).
   *
   * IT IS PUBLIC BY CONSTRUCTION: it salts the key, it is recorded in the public record, and it is the
   * local part of a NIP-05 `name@domain`. A record bound before X8 carries none, so this is optional
   * and the bound screen shows no locked field rather than an empty one.
   */
  readonly handle?: string
  /** Terminal state of the active head. A revoked subject still HAS a subject. */
  readonly revoked: boolean
  /** `did:key` of the Ed25519 approval key registered in the active control. */
  readonly approvalKeyDid: string
  /** The declared custody ceiling that qualifies every value above. */
  readonly custodyClass: typeof AUMLOK_LOCAL_CUSTODY_CLASS
  /**
   * WHEN THIS IDENTITY WAS BOUND, and only a v3 record carries it.
   *
   * IT IS OPTIONAL BECAUSE THE v1 CONTROL HAS NO SUCH FIELD and must not be made to claim one: the
   * seven-field parser below accepts exactly the controller's seven fields and returns exactly those
   * seven, so a v1 control leaves this undefined and the receipt says the record reports no time
   * rather than inventing one. The v3 record projection fills it from the record's own `boundAt`
   * (`plugins/aukora-aumlok/lib/record-v3.mjs`), which is the binding time the receipt is for. It is
   * NOT part of the closed seven-field wire contract and is not accepted from the wire here: only the
   * v3 record branch, which builds its own object field by field, can set it.
   */
  readonly boundAt?: string | number
}

/**
 * Build one not-connected body.
 * @param reason - which of the three absences this is.
 * @param code - the controller's own refusal code, when it produced one.
 * @returns the frozen body.
 */
export function aumlokNotConnected(
  reason: AumlokNotConnectedReason,
  code?: string,
  detail?: string,
): Readonly<AumlokNotConnectedBody> {
  // ABSENT FIELDS ARE ABSENT, NOT PRESENT-AND-UNDEFINED. The parser on the other side is a closed reader
  // that counts keys, and this body is also compared whole by courts, so a `code: undefined` that
  // serialised away would still make an in-process `deepStrictEqual` disagree with a wire round trip.
  return Object.freeze({
    status: 'not-connected' as const,
    reason,
    ...(code === undefined ? {} : { code }),
    ...(detail === undefined || detail === '' ? {} : { detail }),
  })
}

/**
 * Validate a candidate not-connected body from the status endpoint.
 * @param input - candidate value decoded at a transport boundary.
 * @returns the frozen body when exact, undefined otherwise.
 */
export function parseAumlokNotConnectedBody(input: unknown): Readonly<AumlokNotConnectedBody> | undefined {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return undefined
  if (Object.getPrototypeOf(input) !== Object.prototype) return undefined
  const record = input as Record<string, unknown>
  if (record['status'] !== 'not-connected') return undefined
  const reason = record['reason']
  if (reason !== 'no-controller-service' && reason !== 'adapter-unbound'
    && reason !== 'controller-absent' && reason !== 'control-unreadable'
    && reason !== 'record-names-no-machine') {
    return undefined
  }
  const code = record['code']
  if (code !== undefined && (typeof code !== 'string' || code.length === 0 || code.length > 128)) return undefined
  // THE SENTENCE IS BOUNDED LIKE THE CODE IS, and for the same reason: it is data from the controller on a
  // route this screen renders. 1,024 characters is a generous sentence and a small payload, and the host
  // truncates at the source as well, so a long message costs a person the tail of a sentence rather than
  // the whole body — a body this reader refuses would lose the REASON with it.
  const detail = record['detail']
  if (detail !== undefined
    && (typeof detail !== 'string' || detail.length === 0 || detail.length > 1024)) return undefined
  const keys = Object.keys(record).sort()
  // SORTED, AND `code` < `detail` < `reason` < `status` IS THE ONLY COMBINATION THAT PASSES. Adding a
  // field to the body means adding it here too, or the body the host produces is one the browser refuses.
  const expected = [
    ...(code === undefined ? [] : ['code']),
    ...(detail === undefined ? [] : ['detail']),
    'reason',
    'status',
  ]
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return undefined
  return aumlokNotConnected(reason, code as string | undefined, detail as string | undefined)
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
export function parseAumlokControlProjection(input: unknown): Readonly<AumlokControlProjection> {
  // Annotated on the VARIABLE, not just the arrow: TypeScript only treats a call as a
  // control-flow terminator when the callee is a name with an explicit type, and
  // without that every field below stays `unknown` after its own check.
  const fail: (detail: string) => never = (detail) => {
    throw new TypeError(`aumlok-control-projection: ${detail}`)
  }
  if (input === null || typeof input !== 'object' || Array.isArray(input)) fail('not an object')
  if (Object.getPrototypeOf(input) !== Object.prototype) fail('not a plain object')
  const record = input as Record<string, unknown>
  const actual = Object.keys(record).sort()
  const expected = [...FIELDS].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`fields must be exactly ${expected.join(', ')}`)
  }
  const { domain, subject, epoch, activeControlDigest, revoked, approvalKeyDid, custodyClass } = record
  if (domain !== AUMLOK_PUBLIC_CONTROL_DOMAIN) fail(`domain must equal ${AUMLOK_PUBLIC_CONTROL_DOMAIN}`)
  if (typeof subject !== 'string' || !SUBJECT.test(subject)) fail('subject must be aukora:1:<64 hex>')
  if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 0) fail('epoch must be a non-negative integer')
  if (typeof activeControlDigest !== 'string' || !DIGEST.test(activeControlDigest)) {
    fail('activeControlDigest must be 64 hex characters')
  }
  if (typeof revoked !== 'boolean') fail('revoked must be a boolean')
  if (typeof approvalKeyDid !== 'string' || !DID_KEY.test(approvalKeyDid)) fail('approvalKeyDid must be a did:key')
  if (custodyClass !== AUMLOK_LOCAL_CUSTODY_CLASS) fail(`custodyClass must equal ${AUMLOK_LOCAL_CUSTODY_CLASS}`)
  return Object.freeze({
    domain: AUMLOK_PUBLIC_CONTROL_DOMAIN,
    subject: subject as `aukora:1:${string}`,
    epoch,
    activeControlDigest,
    revoked,
    approvalKeyDid,
    custodyClass: AUMLOK_LOCAL_CUSTODY_CLASS,
  })
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
export function parseAumlokControl(input: unknown): Readonly<AumlokControlProjection> {
  if (isAumlokRecordControlProjection(input)) return parseAumlokRecordControlProjection(input)
  if (isAumlokRecordProjection(input)) return parseAumlokRecordProjection(input)
  return parseAumlokControlProjection(input)
}
