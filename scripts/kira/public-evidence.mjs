#!/usr/bin/env node
/**
 * PUBLIC EVIDENCE — one durable, allowlisted handoff directory for an INDEPENDENT consumer.
 *
 *   node scripts/kira/public-evidence.mjs export \
 *     --store <stateDir> --out <dir> --producer-commit <40 hex> --release <abs release dir> \
 *     --anchor issuer=<file> [--anchor <name>=<file>]... \
 *     [--approval <contentSha256>=<flat aukora:approval-receipt:v1 file>]...
 *
 *   node scripts/kira/public-evidence.mjs verify --export <dir> [--json]
 *
 * WHY THIS FILE EXISTS. A digest is not a handoff. A digest reported without the path and the commit
 * it was computed from is not portable evidence about anything, and this project has already paid for
 * that lesson once: the same commit, the same built source, materialized at two paths, produced TWO
 * different release-record digests (`a42561b1…` and `4ce74e33…`), because the materializer bakes the
 * release's ABSOLUTE path into `aukora-composition.patch.yml` and `aukora-lanes.patch.yml`, and the
 * record covers `*.patch.yml`. So this exporter never reports a bare digest. Every digest it writes
 * travels beside the path, the commit and the byte count it was measured from.
 *
 * WHAT A HANDOFF DIRECTORY IS. A fixed layout an independent consumer can be pointed at:
 *
 *   <out>/manifest.json                          the handoff itself: every file, its digest and size
 *   <out>/producer-commit.txt                    the Genesis commit that produced the evidence
 *   <out>/release-record.json                    the release path, record path and record digest
 *   <out>/release-record/genesis-artifacts.json  the record BYTES the digest is about
 *   <out>/evidence/aura.jsonl                    the Aura log (Diamond: --log)
 *   <out>/evidence/objects/<sha256>.json         exact content bytes {key,value}+"\n" (--artifact-content)
 *   <out>/evidence/records/<sha256>.json         the record as its own document (--record)
 *   <out>/evidence/receipts/<sha256>.json        the producer's receipt (--receipt)
 *   <out>/evidence/approvals/<sha256>.json       the flat approval artifact (--artifact)
 *   <out>/anchors/<name>.<ext>                   PUBLIC anchors, supplied from OUTSIDE the store
 *
 * THE MANIFEST CARRIES THE RECORD BYTES, NOT ONLY ITS DIGEST. A digest naming an artifact the
 * receiver does not hold is exactly the failure this directory exists to end, so the release record
 * travels inside the export and `verify` re-hashes it offline against the digest in the manifest.
 *
 * ALLOWLIST ONLY, DEFAULT-DENY, NAMED ON EVERY REFUSAL. A whole-store copy is not an export.
 * `plugins/aukora-kira/lib/memory-owner.mjs:194-200` stores the issuer PRIVATE KEY — a PKCS#8 PEM —
 * in `<stateDir>/issuer.json` beside the public half, and a reviewer's reproduction of a whole-store
 * copy leaked a synthetic canary through exactly that shape. Three store members are evidence and are
 * copied; every other member is left behind and NAMED in `manifest.excluded[]` with the reason it
 * stayed. There is no `--include-all`, no glob, and no wildcard directory copy anywhere in this file:
 *
 *   aura.jsonl                        the Aura chain
 *   objects/<64 lower hex>.json       content-addressed object bodies
 *   receipt-memory.put-<digits>.json  the producer's receipts
 *
 * The private members are refused BY NAME rather than merely dropped, so a caller that asks for one
 * is told which member it asked for and why it is not evidence:
 *
 *   issuer.json    the owner's own key pair, private half included  (memory-owner.mjs:194-200)
 *   grant.json     a one-use operator grant document
 *   approval.json  a one-use operator approval document
 *   seq            the store's private sequence counter
 *   spent/**       the one-use nonce registry
 *   approvals/**   the approval consumption registry, which names which operations were approved
 *
 * EVERY BYTE THAT IS COPIED IS RE-CHECKED, NOT TRUSTED. A symlink anywhere in the store or in an
 * export is refused by name; every JSON document written is checked against a CLOSED field set taken
 * from the producer's own contract; and every document is scanned for private-key material by field
 * name and by PEM header, at any depth, because a record's `content` is caller-supplied and is the
 * one place a key could ride out inside an otherwise clean export.
 *
 * DETERMINISM. Two runs over identical inputs produce byte-identical output, which is a property
 * `tests/public-evidence.test.mjs` measures rather than asserts. That is why the manifest carries NO
 * CLOCK and no host name: a `generatedAt` field would make every run disagree with every other and
 * would put a value in the handoff that no consumer can check. The temporal anchor is the producer
 * commit, and the spatial anchor is the release path.
 *
 * WHAT THIS DOES NOT DO. It does not verify the evidence — that is Diamond's job, and a producer that
 * also judged its own bytes would be agreeing with itself. It does not authorize anything, does not
 * mount a plugin, does not touch a running process, and reads no state directory but the one it is
 * given. It computes no signature and holds no key. `evidence/approvals/*` is a COPY of an artifact
 * another lane's signer produced; this file never mints one.
 */
import { createHash } from 'node:crypto'
import {
  existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
// ── THE STRICT READ RULE IS KIRA'S, AND IT IS IMPORTED RATHER THAN RESTATED ──────────────────────
// `strict-read.mjs` was ported to the same AUKORA-37 source (`src37/store37.py:67-114`), and **a second
// implementation of "strict" is a second thing to keep in step** — which is the failure the shared module
// exists to prevent.
import { readBytesStrict, StrictReadRefusal } from '../../plugins/aukora-kira/lib/strict-read.mjs'
// THE CHAIN RULE IS shared, NOT RESTATED: a second implementation of the chain would be a second thing to
// keep in step, and the whole point of the chain is that two readers agree.
import { readChain, verifyChain, findConfirmed } from '../../apps/aukora-desktop/card-chain.mjs'

// ── the manifest identity ─────────────────────────────────────────────────────────────────────

/** The manifest's kind. A consumer that does not know this string must refuse the directory. */
export const MANIFEST_KIND = 'aukora-public-evidence-handoff/v1'
/** The manifest's schema version, bumped only when a consumer would have to change. */
export const MANIFEST_SCHEMA_VERSION = 1
/** The producer this exporter belongs to. Named so the handoff is not anonymous. */
export const PRODUCER_REPOSITORY = 'aumara-xyz/aukora-genesis'
/** Where a materialized release keeps the record the release digest is computed over. */
export const RELEASE_RECORD_RELATIVE = join('.dsh-build', 'genesis-artifacts.json')
/** The manifest file name, which is never listed inside itself. */
export const MANIFEST_NAME = 'manifest.json'

/**
 * The chained card ledger, as a member of the handoff.
 *
 * EXPORTED BECAUSE A CHAIN ONLY ITS AUTHOR CAN READ PROVES NOTHING TO A STRANGER. It rides the SAME
 * `writes` array as every other member, so **the manifest's own digest covers it** — a member written
 * outside that array is a member the manifest does not attest.
 */
export const CARD_LEDGER_NAME = 'card-ledger.jsonl'

/**
 * The card chain's verdicts.
 *
 * `INCOMPLETE` IS ITS OWN CODE AND NOT A REUSED BREAK. **One code for two situations sends a reader to the
 * wrong repair**: a BREAK means somebody edited the file, an INCOMPLETE means entries are MISSING and the
 * answer is to go and find them.
 */
export const CARD_CHAIN_INCOMPLETE = 'card-chain/incomplete'
export const CARD_CHAIN_BROKEN = 'card-chain/broken'
export const CARD_CHAIN_TORN = 'card-chain/torn'

// ── the closed grammar this exporter will and will not copy ────────────────────────────────────

const HEX64 = /^[0-9a-f]{64}$/
const RECORD_ID = /^kira:[0-9a-f]{64}$/
const AURA_RECORD_DOMAIN = 'aukora:aura-record:v1'
const OPERATION_CONTENT_DOMAIN = 'aukora:operation-content:v1'
const APPROVAL_RECEIPT_DOMAIN = 'aukora:approval-receipt:v1'

/**
 * The store allowlist, by name. A store member is copied only if one of these matches its path
 * relative to the store root; everything else stays behind and is named in `manifest.excluded[]`.
 * These three are the evidence. Nothing else in a Kira state directory is.
 */
export const STORE_ALLOWLIST = Object.freeze([
  Object.freeze({ name: 'aura-log', pattern: /^aura\.jsonl$/, what: 'the Aura chain the receipt names' }),
  Object.freeze({ name: 'object', pattern: /^objects\/[0-9a-f]{64}\.json$/, what: 'one content-addressed object body' }),
  Object.freeze({ name: 'receipt', pattern: /^receipt-memory\.put-[0-9]{3,}\.json$/, what: "the producer's receipt for one settled write" }),
])

/**
 * Store members that are refused BY NAME when a caller asks for them, each with the reason it is not
 * public evidence. Presence in a store is normal; being EXPORTED is what these names forbid.
 */
export const PRIVATE_STORE_MEMBERS = Object.freeze(new Map([
  ['issuer.json', 'carries the owner PRIVATE KEY in the clear (plugins/aukora-kira/lib/memory-owner.mjs:194-200 stores publicKey and privateKey together)'],
  ['grant.json', 'a one-use operator grant document; a grant is a digest binding and is not public evidence'],
  ['approval.json', 'a one-use operator approval document; one approval authorizes one write and is consumed'],
  ['seq', 'the store\'s private sequence counter'],
]))

/** Store subtrees that are refused BY NAME when a caller asks for them. */
export const PRIVATE_STORE_PREFIXES = Object.freeze(new Map([
  ['spent', 'the one-use nonce registry: it names nonces that were spent, not evidence of a write'],
  ['approvals', 'the approval consumption registry: it names which operations were approved and by which approvalId'],
]))

/**
 * Field names that carry private key material. Refused ANYWHERE in a JSON document, at any depth,
 * because a record's `content` is caller-supplied: the deepest object is the one place a key could
 * ride out inside an otherwise clean export.
 */
export const PRIVATE_FIELD_NAMES = Object.freeze([
  'privateKey', 'privateKeyPem', 'privateKeyDer', 'ed25519PrivateKeyPem', 'secretKey', 'seedHex',
  'mnemonic', 'passphrase', 'pkcs8',
  // NOT KEY MATERIAL, AND REFUSED FOR A DIFFERENT REASON — which is why it is named here rather than
  // folded in silently. A settled summary carries `content.summary`, a CAPPED rendering written for a
  // reader; `rawOutput` is the model's uncapped, uncensored text, and a public handoff is not the place
  // for it. The two share a refusal because they share a property: **neither can be un-published once
  // the packet is out**, and the export is the last gate that can still say no. The message names the
  // field, so a producer that adds it learns which one leaked rather than only that something did.
  'rawOutput',
])

/** A PEM private-key header, matched on RAW BYTES so a non-JSON carrier is caught too. */
export const PRIVATE_PEM = /-----BEGIN [A-Z ]*PRIVATE KEY-----/

/** The closed field set of one object body, from the producer's own `memoryEffectBody`. */
export const OBJECT_FIELDS = Object.freeze(['key', 'value'])
/** The closed field set of one KIRA record, from `record.mjs` RECORD_FIELDS plus optional `transform`. */
export const RECORD_FIELDS = Object.freeze([
  'domain', 'grantsAuthority', 'recordId', 'subject', 'kind', 'source', 'content', 'links', 'privacy',
  'createdAt',
])
export const RECORD_OPTIONAL_FIELDS = Object.freeze(['transform'])
/** The receipt's closed profile, from `memory-owner.mjs` and Diamond's `kira_evidence.py:71-77`. */
export const RECEIPT_FIELDS = Object.freeze([
  'kind', 'operation', 'recordId', 'effectDigest', 'nonce', 'issuedAt', 'aura', 'sig', 'issuerPk',
])
export const RECEIPT_OPTIONAL_FIELDS = Object.freeze(['approval'])
export const RECEIPT_AURA_FIELDS = Object.freeze(['entryHash', 'head', 'seq', 'priorHead'])
export const RECEIPT_APPROVAL_FIELDS = Object.freeze([
  'approvalId', 'artifactDomain', 'challenge', 'subject', 'approverDid', 'operationDigest',
  'signature', 'approvalClass', 'keyClass',
])
/** Field names a receipt may not carry, from Diamond `kira_evidence.py:100` FORBIDDEN_CLAIM_FIELDS. */
export const FORBIDDEN_CLAIM_FIELDS = Object.freeze([
  'alg', 'algorithm', 'hash', 'curve', 'owner', 'identity', 'did', 'ownerPk', 'ownerPublicKey',
])
/** The flat artifact's closed field set, from Diamond `diamond/approval_artifact.py:59-64`. */
export const APPROVAL_RECEIPT_FIELDS = Object.freeze([
  'domain', 'verdict', 'keyClass', 'keyClassMeaning', 'approvalClass', 'subject',
  'activeControlDigest', 'approvalKeyDid', 'operationDigest', 'challenge', 'issuedAt', 'expiresAt',
  'signature', 'signedBytesDigest', 'verifiedAt', 'attendance', 'signerDeviceTrusted', 'succession',
  'identityBound', 'ceilings',
])
/** The Aura chain entry's closed field set, from `memory-owner.mjs` appendAura/auraEntryHash. */
export const AURA_ENTRY_FIELDS = Object.freeze([
  'verdict', 'key', 'contentSha256', 'operation', 'sequence', 'prev', 'hash',
])

// ── refusals ───────────────────────────────────────────────────────────────────────────────────

/** A named refusal. `code` is a stable string a control can assert on. */
export class PublicEvidenceRefusal extends Error {
  /**
   * @param {string} code - the stable refusal code.
   * @param {string} detail - what was refused, by name.
   */
  constructor(code, detail = '') {
    super(detail === '' ? code : `${code}: ${detail}`)
    this.name = 'PublicEvidenceRefusal'
    this.code = code
    this.detail = detail
  }
}

/**
 * Refuse by name.
 * @param {string} code - the stable refusal code.
 * @param {string} detail - what was refused.
 * @returns {never} never returns.
 */
function refuse(code, detail) {
  throw new PublicEvidenceRefusal(code, detail)
}

// ── small deterministic helpers ────────────────────────────────────────────────────────────────

/**
 * The SHA-256 of one byte buffer, lowercase hex.
 * @param {Buffer|string} bytes - the bytes to digest.
 * @returns {string} lowercase hex digest.
 */
export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * The SHA-256 of one file's exact bytes.
 * @param {string} path - the file to hash.
 * @returns {string} lowercase hex digest.
 */
export function sha256File(path) {
  return sha256(readFileSync(path))
}

/**
 * Recursively sort object keys so serialisation depends on content and not on insertion order.
 * @param {unknown} value - any JSON value.
 * @returns {unknown} the same value with every object's keys sorted.
 */
export function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value !== null && typeof value === 'object') {
    const record = /** @type {Record<string, unknown>} */ (value)
    return Object.fromEntries(Object.keys(record).sort().map(key => [key, sortDeep(record[key])]))
  }
  return value
}

/**
 * Deterministic serialisation: sorted keys, two-space indent, exactly one trailing newline, no clock.
 * @param {unknown} value - any JSON value.
 * @returns {string} the bytes to write.
 */
export function stableJSON(value) {
  return `${JSON.stringify(sortDeep(value), null, 2)}\n`
}

// ── the field policy: closed sets, private names, private bytes ────────────────────────────────

/**
 * Refuse any object key that names private key material, at any depth.
 * @param {unknown} value - the parsed JSON document.
 * @param {string} label - the document's path, for the refusal message.
 * @param {string} [at] - the dotted path reached so far.
 * @returns {void} throws on the first private field name.
 */
function assertNoPrivateFields(value, label, at = '') {
  if (value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item, index) => { assertNoPrivateFields(item, label, `${at}[${String(index)}]`) })
    return
  }
  for (const [key, child] of Object.entries(value)) {
    if (PRIVATE_FIELD_NAMES.includes(key)) {
      refuse('PUBLIC_EVIDENCE_PRIVATE_FIELD',
        `${label}${at} carries the unpublishable field name \`${key}\`; a public export carries no private half`)
    }
    assertNoPrivateFields(child, label, `${at}.${key}`)
  }
}

/**
 * Refuse a document whose RAW BYTES carry a private-key PEM header.
 * @param {Buffer} bytes - the exact bytes that would be written.
 * @param {string} label - the document's path, for the refusal message.
 * @returns {void} throws when a private-key header is present.
 */
function assertNoPrivateBytes(bytes, label) {
  if (PRIVATE_PEM.test(bytes.toString('utf8'))) {
    refuse('PUBLIC_EVIDENCE_PRIVATE_MATERIAL',
      `${label} carries a private-key PEM header; no private key material may enter a public export`)
  }
}

/**
 * Refuse a document whose own field set is not the closed set the contract declares.
 * @param {unknown} document - the parsed document.
 * @param {readonly string[]} required - fields that must all be present.
 * @param {readonly string[]} optional - fields that may additionally be present.
 * @param {string} label - the document's path, for the refusal message.
 * @returns {Record<string, unknown>} the same document, typed.
 */
function assertClosed(document, required, optional, label) {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    refuse('PUBLIC_EVIDENCE_NOT_CLOSED', `${label} must be one plain JSON record`)
  }
  const record = /** @type {Record<string, unknown>} */ (document)
  const allowed = new Set([...required, ...optional])
  const extra = Object.keys(record).filter(key => !allowed.has(key)).sort()
  const missing = required.filter(key => !Object.hasOwn(record, key)).sort()
  if (extra.length > 0 || missing.length > 0) {
    refuse('PUBLIC_EVIDENCE_NOT_CLOSED',
      `${label} is not the closed field set: missing=[${missing.join(', ')}] extra=[${extra.join(', ')}] — `
      + 'a consumer that tolerates an extra field would verify bytes nobody agreed to')
  }
  return record
}

/**
 * Refuse a document that repeats a key WITHIN ONE OBJECT.
 *
 * `JSON.parse` keeps the last of a repeated key silently, so two readers of the same bytes can
 * disagree about the document while both reporting success. The scan is depth-aware — `fileCount`
 * appearing in `host` and again in `clientFace` is two keys in two objects and is not a repeat —
 * and it is done by hand because the parser has already discarded the evidence.
 *
 * @param {string} text - the document's exact text.
 * @param {string} label - the document's path, for the refusal message.
 * @returns {void} throws on the first repeated key.
 */
function assertNoDuplicateKeys(text, label) {
  /** @type {{keys: Set<string>}[]} */
  const stack = []
  let index = 0
  while (index < text.length) {
    const character = text[index]
    if (character === '"') {
      const start = index
      index += 1
      while (index < text.length) {
        if (text[index] === '\\') { index += 2; continue }
        if (text[index] === '"') break
        index += 1
      }
      const raw = text.slice(start + 1, index)
      index += 1
      let probe = index
      while (probe < text.length && /\s/u.test(text[probe])) probe += 1
      const frame = stack[stack.length - 1]
      if (text[probe] === ':' && frame !== undefined) {
        const key = /** @type {string} */ (JSON.parse(`"${raw}"`))
        if (frame.keys.has(key)) {
          refuse('PUBLIC_EVIDENCE_DUPLICATE_KEY',
            `${label} repeats the key \`${key}\` inside one object; JSON.parse keeps the last silently, `
            + 'so two readers of these bytes can disagree while both reporting success')
        }
        frame.keys.add(key)
      }
      continue
    }
    if (character === '{') { stack.push({ keys: new Set() }); index += 1; continue }
    if (character === '[') { stack.push({ keys: new Set() }); index += 1; continue }
    if (character === '}' || character === ']') { stack.pop(); index += 1; continue }
    index += 1
  }
}

/**
 * Parse one JSON document from exact bytes, refusing duplicated keys.
 * @param {Buffer} bytes - the document's bytes.
 * @param {string} label - the document's path, for the refusal message.
 * @returns {unknown} the parsed value.
 */
/**
 * Read a path STRICTLY: O_NOFOLLOW, S_ISREG on the descriptor, and the bytes read from THAT descriptor.
 *
 * THE RULE IS KIRA'S AND IT IS IMPORTED, NOT RESTATED. `strict-read.mjs` was ported to the same
 * AUKORA-37 source, and **a second implementation of "strict" is a second thing to keep in step** —
 * the failure mode the shared module exists to prevent.
 */
function readStrict(path, label) {
  try {
    // ── `.bytes`, BECAUSE THAT IS WHAT THIS FUNCTION PROMISES ITS CALLERS ──────────────────────────
    // `readBytesStrict` returns `{bytes, text}` — ONE strict read that yields both, so a digest and a
    // parse can never come from two different reads. **The callers here want the BYTES**, and returning
    // the wrapper handed an object to `sha256` and to the JSON parse: MEASURED as
    // `The "data" argument must be of type string or an instance of Buffer...`, which broke 21 controls in
    // `tests/public-evidence.test.mjs`. A shared module's return SHAPE is part of its contract.
    return readBytesStrict(path).bytes
  } catch (error) {
    if (error instanceof StrictReadRefusal) {
      // A SYMLINK, A FIFO OR A DIRECTORY IS A REFUSAL BY NAME, not an unnamed errno and not a follow.
      refuse('PUBLIC_EVIDENCE_NONREGULAR_FILE', `${label}: ${error.message}`)
    }
    throw error
  }
}

function parseJSONBytes(bytes, label) {
  // ── THE DECODE IS FATAL, NOT LOSSY ─────────────────────────────────────────────────────────────
  // This was `bytes.toString('utf8')`, WHICH NEVER THROWS: an invalid byte becomes U+FFFD, the string is
  // still JSON, and **the reader reports a document the bytes do not contain.** A corrupt packet would
  // verify. `TextDecoder` with `fatal: true` is the decode that refuses.
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    refuse('PUBLIC_EVIDENCE_NOT_UTF8', `${label} is not valid UTF-8`)
  }
  let value
  try {
    value = JSON.parse(text)
  } catch (error) {
    refuse('PUBLIC_EVIDENCE_UNPARSEABLE', `${label} is not JSON: ${/** @type {Error} */ (error).message}`)
  }
  assertNoDuplicateKeys(text, label)
  return value
}

// ── the derived rules, restated rather than imported from the producer ─────────────────────────

/**
 * `sha256(utf8("aukora:operation-content:v1") ‖ 0x00 ‖ contentBytes)` — the ONE operation digest
 * rule, restated here. It is restated rather than imported because a producer that calls its own
 * helper agrees with itself by construction, and agreement is not verification.
 * @param {Buffer} contentBytes - the exact `canonicalJSON({key, value})` + "\n" bytes.
 * @returns {string} lowercase hex digest.
 */
export function operationDigestOf(contentBytes) {
  return sha256(Buffer.concat([
    Buffer.from(OPERATION_CONTENT_DOMAIN, 'utf8'), Buffer.from([0x00]), contentBytes,
  ]))
}

/**
 * `sha256("aukora:approval-receipt:v1" ‖ 0x00 ‖ challenge ‖ 0x00 ‖ signature)` — the approval
 * identity, from the two SIGNED values and nothing else. Diamond restates the same rule at
 * `diamond/approval_artifact.py:369-381`; an unsigned label cannot move this.
 * @param {{challenge: unknown, signature: unknown}} artifact - the flat artifact.
 * @returns {string} lowercase hex digest.
 */
export function approvalIdOf(artifact) {
  return sha256(Buffer.concat([
    Buffer.from(APPROVAL_RECEIPT_DOMAIN, 'utf8'), Buffer.from([0x00]),
    Buffer.from(String(artifact.challenge), 'utf8'), Buffer.from([0x00]),
    Buffer.from(String(artifact.signature), 'utf8'),
  ]))
}

/**
 * The Aura entry hash under the protocol rule, restated: `sha256(canonicalJSON({prev, ...fields,
 * domain}))` where the fields are the entry without `hash` and `prev`.
 * @param {string} prev - the predecessor hash, or the domain separator at genesis.
 * @param {Record<string, unknown>} fields - the entry body without `hash` and `prev`.
 * @returns {string} lowercase hex digest.
 */
export function auraEntryHash(prev, fields) {
  const sorted = sortDeep({ prev, ...fields, domain: AURA_RECORD_DOMAIN })
  return sha256(`${JSON.stringify(sorted)}`)
}

// ── the store walk: allowlist by name, symlinks refused by name ────────────────────────────────

/**
 * The directories this exporter descends into. Everything else is a member in its own right,
 * reported BY NAME and never entered — a directory that is not evidence is also not a place to go
 * looking for some.
 */
export const STORE_CONTAINER_DIRECTORIES = Object.freeze(['objects'])

/**
 * List the members directly under one directory, refusing any symlink by name.
 *
 * A directory that is not a declared container is returned as a MEMBER with `directory: true` and is
 * not entered, so `spent/` and `approvals/` are named in `excluded[]` instead of vanishing. A member
 * that disappears without a word is indistinguishable from a member that was never there.
 *
 * @param {string} dir - the directory to list.
 * @param {string} prefix - the store-relative prefix for reporting.
 * @returns {{name: string, path: string, relative: string, directory: boolean}[]} the entries, sorted by name.
 */
function listEntries(dir, prefix) {
  /** @type {{name: string, path: string, relative: string, directory: boolean}[]} */
  const out = []
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name)
    const relative = prefix === '' ? name : `${prefix}/${name}`
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) {
      refuse('PUBLIC_EVIDENCE_SYMLINK_REFUSED',
        `${relative} is a symbolic link; an export follows no link, because the bytes a link resolves `
        + 'to are not the bytes this exporter measured')
    }
    if (stat.isDirectory()) {
      if (STORE_CONTAINER_DIRECTORIES.includes(relative)) {
        out.push(...listEntries(path, relative))
        continue
      }
      out.push({ name, path, relative, directory: true })
      continue
    }
    if (!stat.isFile()) {
      refuse('PUBLIC_EVIDENCE_STORE_MEMBER_UNREADABLE', `${relative} is neither a file nor a directory`)
    }
    out.push({ name, path, relative, directory: false })
  }
  return out
}

/**
 * Decide what each store member is: evidence (copied), or a named exclusion (left behind).
 *
 * DEFAULT-DENY: a member is evidence only when one of {@link STORE_ALLOWLIST} matches it. Everything
 * else is excluded, and the exclusion NAMES the member and why it stayed, so a reader can see what a
 * whole-store copy would have carried away.
 *
 * @param {string} storeDir - the Kira memory state directory.
 * @returns {{evidence: {name: string, path: string, relative: string, kind: string}[], excluded: {path: string, reason: string}[]}} the selection.
 */
export function selectStoreMembers(storeDir) {
  if (!existsSync(storeDir)) refuse('PUBLIC_EVIDENCE_STORE_UNREADABLE', `${storeDir} does not exist`)
  if (!lstatSync(storeDir).isDirectory()) {
    refuse('PUBLIC_EVIDENCE_STORE_UNREADABLE', `${storeDir} is not a directory`)
  }
  /** @type {{name: string, path: string, relative: string, kind: string}[]} */
  const evidence = []
  /** @type {{path: string, reason: string}[]} */
  const excluded = []
  for (const entry of listEntries(storeDir, '')) {
    if (entry.directory) {
      const privateReason = PRIVATE_STORE_PREFIXES.get(entry.relative)
      excluded.push({
        path: `${entry.relative}/`,
        reason: privateReason === undefined
          ? 'NOT ON THE ALLOWLIST — this exporter copies only the three declared evidence members, and it does not enter a directory that is not one'
          : `NOT EVIDENCE — ${privateReason}`,
      })
      continue
    }
    if (PRIVATE_STORE_MEMBERS.has(entry.relative)) {
      excluded.push({ path: entry.relative, reason: `NOT EVIDENCE — ${PRIVATE_STORE_MEMBERS.get(entry.relative)}` })
      continue
    }
    const rule = STORE_ALLOWLIST.find(candidate => candidate.pattern.test(entry.relative))
    if (rule === undefined) {
      excluded.push({ path: entry.relative, reason: 'NOT ON THE ALLOWLIST — this exporter copies only the three declared evidence members' })
      continue
    }
    evidence.push({ name: entry.name, path: entry.path, relative: entry.relative, kind: rule.name })
  }
  if (!evidence.some(entry => entry.kind === 'aura-log')) {
    refuse('PUBLIC_EVIDENCE_AURA_LOG_MISSING',
      `${storeDir} carries no aura.jsonl; a handoff with no chain is not evidence of a write`)
  }
  return { evidence, excluded }
}

/**
 * Refuse a caller-named store member that is not on the allowlist, BY NAME.
 * @param {string} requested - the store-relative path the caller asked for.
 * @returns {never} always throws.
 */
function refuseRequestedMember(requested) {
  if (PRIVATE_STORE_MEMBERS.has(requested)) {
    refuse('PUBLIC_EVIDENCE_PRIVATE_MEMBER_REQUESTED',
      `\`${requested}\` was requested explicitly and is refused by name: ${PRIVATE_STORE_MEMBERS.get(requested)}`)
  }
  const top = requested.split('/')[0]
  if (PRIVATE_STORE_PREFIXES.has(top)) {
    refuse('PUBLIC_EVIDENCE_PRIVATE_MEMBER_REQUESTED',
      `\`${requested}\` was requested explicitly and is refused by name: ${PRIVATE_STORE_PREFIXES.get(top)}`)
  }
  refuse('PUBLIC_EVIDENCE_MEMBER_NOT_ALLOWED',
    `\`${requested}\` was requested explicitly and is not on the store allowlist; the allowlist is `
    + `${STORE_ALLOWLIST.map(rule => rule.pattern.source).join(', ')}`)
}

// ── anchors: supplied from outside the store, never lifted from it ─────────────────────────────

/**
 * Check that one anchor file lies OUTSIDE the store.
 *
 * An anchor read out of the thing it is checking checks nothing, and a verifier that discovers its
 * anchor inside the store it is auditing has confirmed only that the store agrees with itself. This
 * is enforced by path, and it is a refusal rather than a warning.
 *
 * @param {string} anchorPath - the resolved anchor file.
 * @param {string} storeDir - the resolved store root.
 * @returns {void} throws when the anchor is inside the store.
 */
function assertAnchorOutsideStore(anchorPath, storeDir) {
  // ── RESOLVED, NOT COMPARED AS TEXT ────────────────────────────────────────────────────────────
  // A string prefix test cannot see a SYMLINK sitting outside the store whose TARGET is inside it: the
  // text of the path is outside, so the check passes, and the bytes read are the store's. **The check
  // exists precisely to stop the store agreeing with itself, so it has to ask where the path LANDS.**
  const realAnchor = realpathSync(anchorPath)
  const realStore = realpathSync(storeDir)
  const inside = realAnchor === realStore
    || realAnchor.startsWith(realStore.endsWith(sep) ? realStore : `${realStore}${sep}`)
  if (inside) {
    refuse('PUBLIC_EVIDENCE_ANCHOR_INSIDE_STORE',
      `${anchorPath} is inside the store ${storeDir}; an anchor is supplied from OUTSIDE the thing it `
      + 'anchors, or it is the store agreeing with itself')
  }
}

// ── the export ─────────────────────────────────────────────────────────────────────────────────

/**
 * Read one named `--flag name=value` pair list.
 * @param {readonly string[]} values - the raw flag values.
 * @param {string} flag - the flag name, for the refusal message.
 * @returns {Map<string, string>} name → value, refusing a malformed or duplicated pair.
 */
function namedPairs(values, flag) {
  const out = new Map()
  for (const raw of values) {
    const at = raw.indexOf('=')
    if (at <= 0) refuse('PUBLIC_EVIDENCE_USAGE', `${flag} expects <name>=<path>, got ${JSON.stringify(raw)}`)
    const name = raw.slice(0, at)
    if (out.has(name)) refuse('PUBLIC_EVIDENCE_USAGE', `${flag} names \`${name}\` twice`)
    out.set(name, raw.slice(at + 1))
  }
  return out
}

/**
 * Build the public evidence handoff directory.
 * @param {object} options - the export inputs.
 * @param {string} options.storeDir - the Kira memory state directory.
 * @param {string} options.outDir - the directory to create.
 * @param {string} options.producerCommit - the Genesis commit that produced the evidence.
 * @param {string} options.releaseDir - the materialized release the record digest is about.
 * @param {Map<string, string>} options.anchors - anchor name → file, supplied from outside the store.
 * @param {Map<string, string>} options.approvals - content digest → flat approval artifact file.
 * @param {readonly string[]} [options.include] - store members the caller asked for BY NAME. Each one
 *   is checked against the allowlist and REFUSED if it is not evidence, so there is no flag that
 *   widens what leaves the store.
 * @returns {Record<string, unknown>} the manifest that was written.
 */
export function exportPublicEvidence(options) {
  const storeDir = resolve(options.storeDir)
  const outDir = resolve(options.outDir)
  const releaseDir = resolve(options.releaseDir)
  const producerCommit = options.producerCommit

  if (!/^[0-9a-f]{40}$/u.test(String(producerCommit))) {
    refuse('PUBLIC_EVIDENCE_PRODUCER_COMMIT_INVALID',
      `--producer-commit must be 40 lowercase hex characters, got ${JSON.stringify(producerCommit)}; `
      + 'a handoff without the commit it was produced at is not a handoff')
  }
  if (storeDir === outDir || outDir.startsWith(`${storeDir}${sep}`) || storeDir.startsWith(`${outDir}${sep}`)) {
    refuse('PUBLIC_EVIDENCE_USAGE', `the export directory ${outDir} overlaps the store ${storeDir}`)
  }
  if (existsSync(outDir) && readdirSync(outDir).length > 0) {
    refuse('PUBLIC_EVIDENCE_OUT_DIR_NOT_EMPTY',
      `${outDir} is not empty; this exporter never writes into a directory it did not create`)
  }

  // A member the caller NAMED is checked before anything else happens, and a member that is not
  // evidence is refused by name rather than quietly ignored. There is no `--include-all`.
  for (const requested of options.include ?? []) refuseRequestedMember(requested)

  // ── the release record: carried as bytes AND named by path AND digested ──────────────────────
  const recordPath = join(releaseDir, RELEASE_RECORD_RELATIVE)
  if (!existsSync(recordPath)) {
    refuse('PUBLIC_EVIDENCE_RELEASE_RECORD_MISSING',
      `${recordPath} does not exist; a release without its artifact record attests no artifact set`)
  }
  const recordBytes = readStrict(recordPath, 'the release record')
  const recordDigest = sha256(recordBytes)
  const record = /** @type {Record<string, unknown>} */ (parseJSONBytes(recordBytes, recordPath))
  const recordProducer = /** @type {Record<string, unknown>} */ (record.producer ?? {})
  const recordGenesisCommit = typeof recordProducer.genesisCommit === 'string' ? recordProducer.genesisCommit : null
  const recordHost = /** @type {Record<string, unknown>} */ (record.host ?? {})

  // ── the public anchors, each one REFUSED if it came from inside the store ────────────────────
  /** @type {{name: string, path: string, bytes: number, sha256: string, source: string, keyMaterial: string}[]} */
  const anchorEntries = []
  /** @type {Map<string, string>} */
  const anchorBodies = new Map()
  for (const [name, rawPath] of [...options.anchors].sort(([a], [b]) => a.localeCompare(b))) {
    const anchorPath = resolve(isAbsolute(rawPath) ? rawPath : join(process.cwd(), rawPath))
    if (!existsSync(anchorPath)) refuse('PUBLIC_EVIDENCE_ANCHOR_MISSING', `anchor \`${name}\` names ${anchorPath}, which does not exist`)
    assertAnchorOutsideStore(anchorPath, storeDir)
    const bytes = readStrict(anchorPath, `anchor \`${name}\``)
    assertNoPrivateBytes(bytes, `anchor \`${name}\``)
    if (anchorBodies.has(name)) refuse('PUBLIC_EVIDENCE_USAGE', `anchor \`${name}\` was named twice`)
    anchorBodies.set(name, anchorPath)
    anchorEntries.push({
      name,
      path: `anchors/${name}`,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      source: 'supplied-outside-the-store',
      keyMaterial: 'public-only',
    })
  }
  if (!anchorBodies.has('issuer')) {
    refuse('PUBLIC_EVIDENCE_ANCHOR_UNDECLARED',
      'no anchor named `issuer` was supplied; the independent consumer takes the issuer public key as '
      + 'a NAMED anchor and has no unanchored mode, and this exporter never reads one out of the store')
  }

  // ── the store selection ──────────────────────────────────────────────────────────────────────
  const { evidence, excluded } = selectStoreMembers(storeDir)
  const objectMembers = new Map()
  /** @type {Map<string, string>} */
  const receiptMembers = new Map()
  for (const member of evidence) {
    if (member.kind === 'object') objectMembers.set(member.name.slice(0, -'.json'.length), member)
    if (member.kind === 'receipt') receiptMembers.set(member.name, member)
  }

  // ── the chain ───────────────────────────────────────────────────────────────────────────────
  const auraMember = evidence.find(member => member.kind === 'aura-log')
  const auraBytes = readFileSync(auraMember.path)
  assertNoPrivateBytes(auraBytes, 'evidence/aura.jsonl')
  if (!auraBytes.toString('utf8').endsWith('\n') || auraBytes.byteLength === 0) {
    refuse('PUBLIC_EVIDENCE_AURA_LOG_MALFORMED', 'aura.jsonl does not end with exactly one newline')
  }
  const auraLines = auraBytes.toString('utf8').slice(0, -1).split('\n')
  /** @type {{sequence: number, recordId: string, contentSha256: string, hash: string, prev: string}[]} */
  const chain = []
  let prior = AURA_RECORD_DOMAIN
  for (const [index, line] of auraLines.entries()) {
    const entry = /** @type {Record<string, unknown>} */ (parseJSONBytes(Buffer.from(line, 'utf8'), `aura.jsonl:${String(index + 1)}`))
    assertClosed(entry, AURA_ENTRY_FIELDS, [], `aura.jsonl:${String(index + 1)}`)
    if (!RECORD_ID.test(String(entry.key))) {
      refuse('PUBLIC_EVIDENCE_AURA_LOG_MALFORMED', `aura.jsonl:${String(index + 1)} names key ${JSON.stringify(entry.key)}`)
    }
    if (!HEX64.test(String(entry.contentSha256))) {
      refuse('PUBLIC_EVIDENCE_AURA_LOG_MALFORMED', `aura.jsonl:${String(index + 1)} carries no content digest`)
    }
    if (entry.prev !== prior) {
      refuse('PUBLIC_EVIDENCE_AURA_CHAIN_BROKEN',
        `aura.jsonl:${String(index + 1)} names prev ${String(entry.prev)} and the entry before it hashes to ${prior}`)
    }
    const { hash, prev, ...fields } = entry
    void prev
    if (auraEntryHash(prior, fields) !== hash) {
      refuse('PUBLIC_EVIDENCE_AURA_CHAIN_BROKEN',
        `aura.jsonl:${String(index + 1)} does not recompute from its own fields and its predecessor`)
    }
    prior = String(hash)
    chain.push({
      sequence: Number(entry.sequence),
      recordId: String(entry.key),
      contentSha256: String(entry.contentSha256),
      hash: String(hash),
      prev: String(entry.prev),
    })
  }

  // ── per-record evidence: object bytes, the record projection, the receipt, the approval ──────
  /** @type {{records: Record<string, unknown>[], approvals: Record<string, unknown>[], writes: {path: string, bytes: Buffer}[]} } */
  const assembled = { records: [], approvals: [], writes: [] }
  const approvalInputs = options.approvals
  for (const entry of approvalInputs.keys()) {
    if (!objectMembers.has(entry)) {
      refuse('PUBLIC_EVIDENCE_APPROVAL_UNBOUND',
        `--approval names content ${entry}, which is not an object in this store; an approval over bytes `
        + 'the export does not carry binds nothing a consumer can check')
    }
  }

  for (const step of chain) {
    const objectMember = objectMembers.get(step.contentSha256)
    if (objectMember === undefined) {
      refuse('PUBLIC_EVIDENCE_OBJECT_MISSING',
        `the chain settles ${step.recordId} at ${step.contentSha256} and objects/${step.contentSha256}.json `
        + 'is not in this store; a position without its object is a claim, not evidence')
    }
    const objectBytes = readFileSync(objectMember.path)
    assertNoPrivateBytes(objectBytes, `objects/${step.contentSha256}.json`)
    const body = /** @type {Record<string, unknown>} */ (parseJSONBytes(objectBytes, `objects/${step.contentSha256}.json`))
    // The private-field scan runs BEFORE the closed-set check on purpose: both refuse by name, and
    // the more alarming one must be the one that names the failure.
    assertNoPrivateFields(body, `objects/${step.contentSha256}.json`)
    assertClosed(body, OBJECT_FIELDS, [], `objects/${step.contentSha256}.json`)
    if (body.key !== step.recordId) {
      refuse('PUBLIC_EVIDENCE_OBJECT_KEY_MISMATCH',
        `objects/${step.contentSha256}.json addresses ${String(body.key)} and the chain settles ${step.recordId}`)
    }
    const record = /** @type {Record<string, unknown>} */ (body.value)
    assertClosed(record, RECORD_FIELDS, RECORD_OPTIONAL_FIELDS, `objects/${step.contentSha256}.json.value`)
    assertNoPrivateFields(record, `objects/${step.contentSha256}.json.value`)
    if (record.recordId !== step.recordId) {
      refuse('PUBLIC_EVIDENCE_OBJECT_KEY_MISMATCH',
        `objects/${step.contentSha256}.json carries a record whose own recordId is ${String(record.recordId)}`)
    }
    if (sha256(objectBytes) !== step.contentSha256) {
      refuse('PUBLIC_EVIDENCE_CONTENT_MISMATCH',
        `objects/${step.contentSha256}.json does not hash to the digest its own name claims`)
    }

    // The receipt the store wrote for this sequence. Found BY NAME, then checked BY CONTENT.
    const receiptName = `receipt-memory.put-${String(step.sequence).padStart(3, '0')}.json`
    const receiptMember = receiptMembers.get(receiptName)
    if (receiptMember === undefined) {
      refuse('PUBLIC_EVIDENCE_RECEIPT_MISSING',
        `the chain settles sequence ${String(step.sequence)} and ${receiptName} is not in this store`)
    }
    const receiptBytes = readFileSync(receiptMember.path)
    assertNoPrivateBytes(receiptBytes, receiptName)
    const receipt = /** @type {Record<string, unknown>} */ (parseJSONBytes(receiptBytes, receiptName))
    assertNoPrivateFields(receipt, receiptName)
    assertClosed(receipt, RECEIPT_FIELDS, RECEIPT_OPTIONAL_FIELDS, receiptName)
    for (const forbidden of FORBIDDEN_CLAIM_FIELDS) {
      if (Object.hasOwn(receipt, forbidden)) {
        refuse('PUBLIC_EVIDENCE_NOT_CLOSED',
          `${receiptName} carries the forbidden field \`${forbidden}\`; the kind string is the algorithm `
          + 'binding and identity never crowns')
      }
    }
    if (receipt.recordId !== step.recordId || receipt.effectDigest !== step.contentSha256) {
      refuse('PUBLIC_EVIDENCE_RECEIPT_MISMATCH',
        `${receiptName} names record ${String(receipt.recordId)} / effect ${String(receipt.effectDigest)} and the `
        + `chain settles ${step.recordId} / ${step.contentSha256}`)
    }
    const receiptAura = /** @type {Record<string, unknown>} */ (assertClosed(receipt.aura, RECEIPT_AURA_FIELDS, [], `${receiptName}.aura`))
    if (receiptAura.entryHash !== step.hash || Number(receiptAura.seq) !== step.sequence) {
      refuse('PUBLIC_EVIDENCE_RECEIPT_MISMATCH',
        `${receiptName} names Aura entry ${String(receiptAura.entryHash)} at seq ${String(receiptAura.seq)} and the `
        + `chain's entry ${String(step.sequence)} hashes to ${step.hash}`)
    }

    const projected = Buffer.from(`${JSON.stringify(sortDeep(record), null, 2)}\n`, 'utf8')
    const stem = step.contentSha256
    assembled.writes.push({ path: `evidence/objects/${stem}.json`, bytes: objectBytes })
    assembled.writes.push({ path: `evidence/records/${stem}.json`, bytes: projected })
    assembled.writes.push({ path: `evidence/receipts/${stem}.json`, bytes: receiptBytes })

    /** @type {Record<string, unknown>|null} */
    let approvalSummary = null
    const approvalPath = approvalInputs.get(stem)
    if (approvalPath !== undefined) {
      const resolvedApproval = resolve(isAbsolute(approvalPath) ? approvalPath : join(process.cwd(), approvalPath))
      if (!existsSync(resolvedApproval)) {
        refuse('PUBLIC_EVIDENCE_APPROVAL_MISSING', `the approval for content ${stem} names ${resolvedApproval}, which does not exist`)
      }
      const artifactBytes = readFileSync(resolvedApproval)
      assertNoPrivateBytes(artifactBytes, `approval for ${stem}`)
      const artifact = /** @type {Record<string, unknown>} */ (parseJSONBytes(artifactBytes, `approval for ${stem}`))
      assertNoPrivateFields(artifact, `approval for ${stem}`)
      assertClosed(artifact, APPROVAL_RECEIPT_FIELDS, [], `approval for ${stem}`)
      const derived = operationDigestOf(objectBytes)
      if (artifact.operationDigest !== derived) {
        refuse('PUBLIC_EVIDENCE_APPROVAL_DIGEST_MISMATCH',
          `the approval for content ${stem} names operation digest ${String(artifact.operationDigest)} and the `
          + `exported bytes derive ${derived}; an approval binds the bytes it was issued for`)
      }
      const approvalId = approvalIdOf(artifact)
      const block = receipt.approval
      if (block === undefined) {
        refuse('PUBLIC_EVIDENCE_APPROVAL_NOT_LINKED',
          `${receiptName} carries no approval block, so nothing links the artifact for ${stem} to this write`)
      }
      const closedBlock = assertClosed(block, RECEIPT_APPROVAL_FIELDS, [], `${receiptName}.approval`)
      if (closedBlock.approvalId !== approvalId) {
        refuse('PUBLIC_EVIDENCE_APPROVAL_NOT_LINKED',
          `${receiptName}.approval names approval ${String(closedBlock.approvalId)} and the artifact derives `
          + `${approvalId}; a digest does not identify an approval, the signed pair does`)
      }
      assembled.writes.push({ path: `evidence/approvals/${stem}.json`, bytes: artifactBytes })
      approvalSummary = {
        contentSha256: stem,
        recordId: step.recordId,
        artifactPath: `evidence/approvals/${stem}.json`,
        artifactSha256: sha256(artifactBytes),
        contentPath: `evidence/objects/${stem}.json`,
        approvalId,
        challenge: String(artifact.challenge),
        subject: String(artifact.subject),
        approverDid: String(artifact.approvalKeyDid),
        operationDigest: String(artifact.operationDigest),
        approvalClass: String(artifact.approvalClass),
        attendance: String(artifact.attendance),
        identityBound: artifact.identityBound === true,
        authorization: 'OWNER_APPROVAL_UNCHECKED — an approval is evidence and evidence never authorizes',
      }
    } else if (receipt.approval !== undefined) {
      // The receipt names an approval the export does not carry. That is a real gap and it is NAMED
      // rather than silently absent, because a consumer asked for the approval lane would fail on
      // the missing file with no idea whether the producer or the exporter dropped it.
      const block = /** @type {Record<string, unknown>} */ (receipt.approval)
      approvalSummary = {
        contentSha256: stem,
        recordId: step.recordId,
        artifactPath: null,
        approvalId: typeof block.approvalId === 'string' ? block.approvalId : null,
        reason: 'the receipt names an approval this export does not carry; supply it with '
          + `--approval ${stem}=<artifact> to let a consumer check the approval lane`,
      }
    }

    assembled.records.push({
      contentSha256: stem,
      recordId: step.recordId,
      auraSequence: step.sequence,
      auraEntryHash: step.hash,
      objectPath: `evidence/objects/${stem}.json`,
      recordPath: `evidence/records/${stem}.json`,
      receiptPath: `evidence/receipts/${stem}.json`,
      approval: approvalSummary,
    })
    // A receipt that names an approval is an approval this manifest must account for, carried or
    // not. An entry with `artifactPath: null` is the named gap; an absent entry would be silence.
    if (approvalSummary !== null) assembled.approvals.push(approvalSummary)
  }

  // ── write the directory: evidence, anchors, the record, the commit, then the manifest ─────────
  mkdirSync(outDir, { recursive: true })
  const writes = [...assembled.writes]
  writes.push({ path: 'evidence/aura.jsonl', bytes: auraBytes })
  for (const member of [...anchorBodies.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    writes.push({ path: `anchors/${member[0]}`, bytes: readFileSync(member[1]) })
  }
  writes.push({ path: `release-record/${'genesis-artifacts.json'}`, bytes: recordBytes })
  writes.push({ path: 'release-record.json', bytes: Buffer.from(stableJSON({
    kind: 'aukora-release-record/v1',
    releasePath: releaseDir,
    recordPath,
    recordRelativePath: RELEASE_RECORD_RELATIVE,
    recordDigest: { algorithm: 'sha256', value: recordDigest },
    recordBytes: recordBytes.byteLength,
    pathDependent: true,
    pathDependenceMeasured: 'the record covers *.patch.yml, and the materializer bakes the release ABSOLUTE path into '
      + 'aukora-composition.patch.yml and aukora-lanes.patch.yml, so the SAME commit and the SAME built source at two '
      + 'paths produce two different record digests. Report this digest WITH releasePath, never as a portable constant',
    producerGenesisCommit: recordGenesisCommit,
    hostDigest: typeof recordHost.sha256 === 'string' ? recordHost.sha256 : null,
    hostFileCount: typeof recordHost.fileCount === 'number' ? recordHost.fileCount : null,
  }), 'utf8') })
  writes.push({ path: 'producer-commit.txt', bytes: Buffer.from(`${String(producerCommit)}\n`, 'utf8') })

  // ── THE CARD LEDGER RIDES THE SAME `writes` ARRAY AS EVERY OTHER MEMBER ───────────────────────
  // THE ORDER MATTERS: it is pushed BEFORE the loop that writes, so the manifest built a few lines later
  // from `writes` **covers it by construction** rather than by a second, forgettable step. A member
  // written outside this array is a member the manifest does not attest, and the whole handoff is an
  // attestation.
  let cardChainFacts = { present: false, entries: 0, head: null }
  if (typeof options.cardLedgerPath === 'string' && options.cardLedgerPath.length > 0) {
    const ledgerBytes = readStrict(options.cardLedgerPath, 'the card ledger')
    const chain = readChain(options.cardLedgerPath)
    if (chain.ok !== true) {
      // A TORN OR BROKEN LEDGER IS NOT EXPORTED AS IF IT WERE FINE. Shipping it would put the damage
      // inside an attestation that then vouches for it.
      refuse('PUBLIC_EVIDENCE_CARD_CHAIN_TORN',
        `the card ledger could not be read (${chain.code}): ${chain.reason}`)
    }
    const verdict = verifyChain(chain.entries)
    if (verdict.ok !== true) {
      refuse('PUBLIC_EVIDENCE_CARD_CHAIN_BROKEN',
        `the card ledger does not verify (${verdict.code}): ${verdict.reason}`)
    }
    writes.push({ path: CARD_LEDGER_NAME, bytes: ledgerBytes })
    cardChainFacts = { present: true, entries: chain.entries.length, head: verdict.head }
  }

  for (const write of writes) {
    const target = join(outDir, write.path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, write.bytes, { mode: 0o644 })
  }

  /** @type {{path: string, bytes: number, sha256: string}[]} */
  const files = writes.map(write => ({
    path: write.path, bytes: write.bytes.byteLength, sha256: sha256(write.bytes),
  })).sort((a, b) => a.path.localeCompare(b.path))

  const manifest = {
    kind: MANIFEST_KIND,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    producer: {
      repository: PRODUCER_REPOSITORY,
      commit: String(producerCommit),
      role: 'the Genesis commit whose code produced the evidence in this directory',
    },
    releaseRecord: {
      releasePath: releaseDir,
      recordPath,
      recordRelativePath: RELEASE_RECORD_RELATIVE,
      recordDigest: { algorithm: 'sha256', value: recordDigest },
      carriedAt: 'release-record/genesis-artifacts.json',
      recordBytes: recordBytes.byteLength,
      pathDependent: true,
      producerGenesisCommit: recordGenesisCommit,
      producerCommitAgrees: recordGenesisCommit === producerCommit,
      hostDigest: typeof recordHost.sha256 === 'string' ? recordHost.sha256 : null,
    },
    // THE CHAIN'S OWN FACTS, so a reader can tell "this handoff carries no card ledger" from "it carries
    // one and it is short" — which is the difference between nothing to check and something missing.
    cardChain: cardChainFacts,
    anchors: anchorEntries,
    records: assembled.records.sort((a, b) => Number(a.auraSequence) - Number(b.auraSequence)),
    approvals: assembled.approvals.sort((a, b) => String(a.contentSha256).localeCompare(String(b.contentSha256))),
    store: { path: storeDir, allowlist: STORE_ALLOWLIST.map(rule => rule.pattern.source) },
    excluded: excluded.sort((a, b) => a.path.localeCompare(b.path)),
    files,
    limits: [
      'PRODUCER COMMIT IS NOT THE RELEASE COMMIT: `producer.commit` names the checkout whose code wrote the '
      + 'evidence. `releaseRecord.producerGenesisCommit` is what the carried record itself claims. When '
      + '`releaseRecord.producerCommitAgrees` is false, this directory crosses two commits and says so here '
      + 'rather than implying one.',
      'THE RECORD DIGEST IS PATH-DEPENDENT: report it only beside `releaseRecord.releasePath`.',
      'NO CLOCK: the manifest carries no generatedAt, so two runs over identical inputs are byte-identical. '
      + 'The temporal anchor is the producer commit.',
      'A COPY IS NOT A SIGNATURE: this exporter re-hashes what it copies and mints nothing. It holds no key '
      + 'and computes no signature.',
      'AN APPROVAL IS NOT AUTHORIZATION: `approvals[].authorization` stays OWNER_APPROVAL_UNCHECKED, and '
      + 'attendance is reported-not-proven unless a consumer establishes something narrower.',
      'NOT VERIFIED HERE: this directory is a handoff, not a verdict. An independent consumer must re-derive '
      + 'every digest and every signature from these bytes.',
    ],
  }

  writeFileSync(join(outDir, MANIFEST_NAME), stableJSON(manifest), { mode: 0o644 })
  return manifest
}

// ── the verifier: the handoff checked against its own bytes ────────────────────────────────────

/**
 * List every file in one export directory, refusing symlinks BY NAME.
 * @param {string} root - the export directory.
 * @param {string} [prefix] - the relative prefix reached so far.
 * @returns {string[]} the relative paths, sorted.
 */
function listExportFiles(root, prefix = '') {
  /** @type {string[]} */
  const out = []
  for (const name of readdirSync(join(root, prefix)).sort()) {
    const relative = prefix === '' ? name : `${prefix}/${name}`
    const stat = lstatSync(join(root, relative))
    if (stat.isSymbolicLink()) {
      refuse('PUBLIC_EVIDENCE_SYMLINK_REFUSED',
        `${relative} is a symbolic link; an export is read through no link`)
    }
    if (stat.isDirectory()) { out.push(...listExportFiles(root, relative)); continue }
    // ── A LISTED MEMBER MUST BE A REGULAR FILE ───────────────────────────────────────────────────
    // Without this the walk pushed ANYTHING that was not a directory or a link: a FIFO would BLOCK the
    // read that follows, and a socket or device would be read as if it were the handoff. **The walk is
    // the only place that sees every member, so it is the only place that can refuse them all.**
    if (!stat.isFile()) {
      refuse('PUBLIC_EVIDENCE_NONREGULAR_FILE',
        `${relative} is not a regular file; an export carries files`)
    }
    out.push(relative)
  }
  return out
}

/**
 * Re-derive the whole handoff from its own bytes.
 *
 * This is the export's own verifier and it is DELIBERATELY NOT the acceptance test: a producer that
 * grades its own evidence agrees with itself. What it establishes is narrower and still necessary —
 * that the manifest describes the bytes actually present, that no file rode along unlisted, that no
 * document carries a private field, and that every derived document re-derives.
 *
 * @param {string} exportDir - the handoff directory to check.
 * @returns {Record<string, unknown>} the verdict.
 */
/**
 * Verify the exported card chain, and answer a stranger's question about one digest.
 *
 * ── THE CLAUSE THAT MATTERS MOST: MISSING ENTRIES READ AS INCOMPLETE, NOT CLEAN ──────────────────
 *
 * A verifier that reports "the entries I found are all correctly chained" is describing a ledger **it
 * cannot see the hole in** — the same fault as a Python verifier skipping a record it could not parse, and
 * the same fault the chain itself was built to refuse. So the manifest's `cardChain.entries` count is
 * checked AGAINST what is actually there: **a reader that trusts only the file cannot notice that the file
 * is short, and the count is the one fact that lives outside it.**
 *
 * @param {string} exportDir
 * @param {string} [digest] - a text digest to look for, for a stranger holding one goal text.
 */
export function verifyCardChain(exportDir, digest) {
  const root = resolve(exportDir)
  const manifestBytes = readStrict(join(root, MANIFEST_NAME), 'the manifest')
  const manifest = /** @type {Record<string, unknown>} */ (parseJSONBytes(manifestBytes, MANIFEST_NAME))
  const declared = /** @type {Record<string, unknown>} */ (manifest.cardChain ?? {})
  const memberPath = join(root, CARD_LEDGER_NAME)

  if (declared.present !== true) {
    // NOTHING TO CHECK IS NOT THE SAME AS CHECKED AND FINE, and it is not a failure either. The caller
    // gets a verdict that says which of the three it is.
    return { ok: true, present: false, entries: 0, reason: 'this handoff declares no card ledger' }
  }
  if (!existsSync(memberPath)) {
    return { ok: false, code: CARD_CHAIN_INCOMPLETE, declared: declared.entries,
      reason: `the manifest declares a card ledger of ${String(declared.entries)} entr(ies) and `
        + `${CARD_LEDGER_NAME} is not present` }
  }

  const chain = readChain(memberPath)
  if (chain.ok !== true) {
    return { ok: false, code: chain.code === 'card-chain/torn-tail' ? CARD_CHAIN_TORN : CARD_CHAIN_BROKEN,
      reason: chain.reason }
  }
  const verdict = verifyChain(chain.entries)
  if (verdict.ok !== true) {
    // A GAP IS INCOMPLETE AND A BROKEN LINK IS BROKEN — different names, because they send a reader to
    // different repairs.
    return { ok: false,
      code: verdict.code === 'card-chain/gap' ? CARD_CHAIN_INCOMPLETE : CARD_CHAIN_BROKEN,
      reason: verdict.reason, seq: verdict.seq ?? null, expected: verdict.expected ?? null }
  }
  // ── THE COUNT THE FILE CANNOT CHECK ABOUT ITSELF ───────────────────────────────────────────────
  if (typeof declared.entries === 'number' && declared.entries !== chain.entries.length) {
    return { ok: false, code: CARD_CHAIN_INCOMPLETE, declared: declared.entries,
      found: chain.entries.length,
      reason: `the manifest declares ${declared.entries} card entr(ies) and the ledger holds `
        + `${chain.entries.length}: THE LEDGER IS SHORT, which is not the same as the entries in it being `
        + 'correctly chained' }
  }
  const answer = digest === undefined ? null : findConfirmed(chain.entries, digest)
  return { ok: true, present: true, entries: chain.entries.length, head: verdict.head, digest: answer }
}

export function verifyPublicEvidence(exportDir) {
  const root = resolve(exportDir)
  if (!existsSync(root) || !lstatSync(root).isDirectory()) {
    refuse('PUBLIC_EVIDENCE_MANIFEST_MISSING', `${root} is not a directory`)
  }
  const manifestPath = join(root, MANIFEST_NAME)
  if (!existsSync(manifestPath)) {
    refuse('PUBLIC_EVIDENCE_MANIFEST_MISSING',
      `${root} carries no ${MANIFEST_NAME}; a directory without a manifest is a pile of files, not a handoff`)
  }
  // ── THE WALK RUNS FIRST, SO ITS REFUSALS COVER THE MANIFEST TOO ──────────────────────────────
  // The manifest was read BEFORE the walk, so a symlinked manifest was read by a path that nothing had
  // inspected — and `readFileSync` followed it. **Order is the protection here**: the walk is what
  // refuses a link, so anything read before it is read unprotected.
  const walked = listExportFiles(root)
  const manifestBytes = readStrict(manifestPath, 'the manifest')
  const manifest = /** @type {Record<string, unknown>} */ (parseJSONBytes(manifestBytes, MANIFEST_NAME))
  if (manifest.kind !== MANIFEST_KIND) {
    refuse('PUBLIC_EVIDENCE_MANIFEST_KIND',
      `${MANIFEST_NAME} names kind ${JSON.stringify(manifest.kind)}, not ${JSON.stringify(MANIFEST_KIND)}`)
  }
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    refuse('PUBLIC_EVIDENCE_MANIFEST_KIND',
      `${MANIFEST_NAME} names schemaVersion ${JSON.stringify(manifest.schemaVersion)}, not ${String(MANIFEST_SCHEMA_VERSION)}`)
  }

  const listed = /** @type {{path: string, bytes: number, sha256: string}[]} */ (manifest.files ?? [])
  const listedPaths = new Set(listed.map(entry => entry.path))
  const present = listExportFiles(root).filter(path => path !== MANIFEST_NAME)

  // ── EVERY LISTED PATH MUST BE A PATH INSIDE THE EXPORT ─────────────────────────────────────────
  // MEASURED DEFECT, found by reading this file after three rounds of the same class elsewhere: a
  // manifest naming `../outside.txt`, with that file's CORRECT byte count and digest, was accepted and
  // `verifyPublicEvidence` returned `{ok: true, files: 1}`. `join(root, entry.path)` resolves the
  // traversal and the read leaves the export entirely, so a verifier asked to check ONE DIRECTORY
  // would read — and hash, and private-material-scan — a file outside it, then call the result
  // verified. The unlisted-file check above cannot catch it: the escapee is listed, by its escaping
  // name. `listExportFiles` built its own paths and never consults the manifest, so nothing had
  // constrained what the manifest may name.
  //
  // The refusal is by name and comes BEFORE ANYTHING IS READ OR LISTED, so a manifest can neither
  // escape the export nor use this verifier to probe the filesystem. It must precede the unlisted
  // check: repointing an entry outside makes the genuine member it replaced look unlisted, so the
  // listing check would fire first and name a different defect. A path is accepted only as a
  // non-empty relative path whose segments are neither `..` nor `.`, with no backslash and no
  // leading separator — the shape the producer emits, stated rather than assumed.
  for (const entry of listed) {
    const listedPath = String(entry.path ?? '')
    const segments = listedPath.split('/')
    const unsafe = listedPath === ''
      || listedPath.startsWith('/')
      || listedPath.includes('\\')
      || segments.some(segment => segment === '..' || segment === '.' || segment === '')
    if (unsafe) {
      refuse('PUBLIC_EVIDENCE_PATH_ESCAPES_EXPORT',
        `manifest.json lists ${JSON.stringify(entry.path)}, which is not a relative path inside the export; `
        + 'a verifier reads only what the handoff carries, so an entry that resolves outside it is refused '
        + 'before any file is opened')
    }
  }

  // Unlisted files first: a file nobody declared is the shape a leak arrives in.
  for (const path of present) {
    if (!listedPaths.has(path)) {
      refuse('PUBLIC_EVIDENCE_UNLISTED_FILE',
        `${path} is present in the export and named by no manifest entry; an unlisted file is a file `
        + 'nobody agreed to hand over')
    }
  }
  for (const entry of listed) {
    const target = join(root, entry.path)
    if (!existsSync(target)) {
      refuse('PUBLIC_EVIDENCE_FILE_MISSING', `the manifest names ${entry.path} and it is absent from the export`)
    }
    const bytes = readFileSync(target)
    if (bytes.byteLength !== entry.bytes) {
      refuse('PUBLIC_EVIDENCE_FILE_TAMPERED',
        `${entry.path} is ${String(bytes.byteLength)} bytes and the manifest names ${String(entry.bytes)}`)
    }
    const digest = sha256(bytes)
    if (digest !== entry.sha256) {
      refuse('PUBLIC_EVIDENCE_FILE_TAMPERED',
        `${entry.path} hashes to ${digest} and the manifest names ${entry.sha256}`)
    }
    assertNoPrivateBytes(bytes, entry.path)
    if (entry.path.endsWith('.json')) {
      const document = parseJSONBytes(bytes, entry.path)
      assertNoPrivateFields(document, entry.path)
    }
  }

  // The record projection must re-derive from the object bytes it was projected out of.
  const records = /** @type {Record<string, unknown>[]} */ (manifest.records ?? [])
  for (const step of records) {
    const objectBytes = readFileSync(join(root, String(step.objectPath)))
    const body = /** @type {Record<string, unknown>} */ (parseJSONBytes(objectBytes, String(step.objectPath)))
    const projected = Buffer.from(`${JSON.stringify(sortDeep(body.value), null, 2)}\n`, 'utf8')
    const carried = readFileSync(join(root, String(step.recordPath)))
    if (!projected.equals(carried)) {
      refuse('PUBLIC_EVIDENCE_RECORD_PROJECTION_MISMATCH',
        `${String(step.recordPath)} is not the projection of ${String(step.objectPath)}; the record file is `
        + 'derived, so a verifier must be able to re-derive it')
    }
    if (sha256(objectBytes) !== step.contentSha256) {
      refuse('PUBLIC_EVIDENCE_CONTENT_MISMATCH',
        `${String(step.objectPath)} does not hash to the content digest the manifest names`)
    }
  }

  // An approval must still derive the approvalId and the operation digest the manifest claims.
  const approvals = /** @type {Record<string, unknown>[]} */ (manifest.approvals ?? [])
  for (const approval of approvals) {
    if (approval.artifactPath === null || approval.artifactPath === undefined) continue
    const artifact = /** @type {Record<string, unknown>} */ (
      parseJSONBytes(readFileSync(join(root, String(approval.artifactPath))), String(approval.artifactPath)))
    const derivedId = approvalIdOf(artifact)
    if (derivedId !== approval.approvalId) {
      refuse('PUBLIC_EVIDENCE_APPROVAL_ID_MISMATCH',
        `${String(approval.artifactPath)} derives approval ${derivedId} and the manifest names ${String(approval.approvalId)}`)
    }
    const contentBytes = readFileSync(join(root, String(approval.contentPath)))
    const derivedOperation = operationDigestOf(contentBytes)
    if (derivedOperation !== artifact.operationDigest) {
      refuse('PUBLIC_EVIDENCE_APPROVAL_DIGEST_MISMATCH',
        `${String(approval.artifactPath)} names operation digest ${String(artifact.operationDigest)} and `
        + `${String(approval.contentPath)} derives ${derivedOperation}`)
    }
  }

  // The carried release record must hash to the digest the manifest reports.
  const releaseRecord = /** @type {Record<string, unknown>} */ (manifest.releaseRecord ?? {})
  const carriedRelative = String(releaseRecord.carriedAt ?? '')
  if (carriedRelative !== '') {
    const carried = readFileSync(join(root, carriedRelative))
    const derived = sha256(carried)
    const claimed = /** @type {Record<string, unknown>} */ (releaseRecord.recordDigest ?? {}).value
    if (derived !== claimed) {
      refuse('PUBLIC_EVIDENCE_RELEASE_RECORD_MISMATCH',
        `${carriedRelative} hashes to ${derived} and the manifest names ${String(claimed)} at `
        + `${String(releaseRecord.releasePath)}; the digest is only meaningful beside that path`)
    }
  }

  return {
    ok: true,
    kind: MANIFEST_KIND,
    files: listed.length,
    records: records.length,
    approvals: approvals.length,
    producerCommit: /** @type {Record<string, unknown>} */ (manifest.producer ?? {}).commit,
    releasePath: releaseRecord.releasePath,
    releaseRecordDigest: /** @type {Record<string, unknown>} */ (releaseRecord.recordDigest ?? {}).value,
    producerCommitAgreesWithReleaseRecord: releaseRecord.producerCommitAgrees === true,
    manifestSha256: sha256(manifestBytes),
  }
}

// ── the command line ───────────────────────────────────────────────────────────────────────────

/**
 * Read one `--flag value` argument.
 * @param {readonly string[]} args - argv after the subcommand.
 * @param {string} flag - the flag to read.
 * @returns {string|undefined} the value, if present.
 */
function option(args, flag) {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}

/**
 * Read every occurrence of a repeatable `--flag value`.
 * @param {readonly string[]} args - argv after the subcommand.
 * @param {string} flag - the flag to collect.
 * @returns {string[]} the values, in order.
 */
function options(args, flag) {
  /** @type {string[]} */
  const out = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1] !== undefined) out.push(args[index + 1])
  }
  return out
}

/**
 * Run the exporter or its verifier.
 * @param {readonly string[]} argv - process arguments after the executable.
 * @returns {number} the exit status.
 */
export function main(argv) {
  const args = [...argv]
  const command = args.shift()
  if (command === 'export') {
    const store = option(args, '--store')
    const out = option(args, '--out')
    const producerCommit = option(args, '--producer-commit')
    const release = option(args, '--release')
    if (store === undefined || out === undefined || producerCommit === undefined || release === undefined) {
      process.stderr.write('usage: public-evidence.mjs export --store <dir> --out <dir> '
        + '--producer-commit <40 hex> --release <dir> --anchor name=path [--approval digest=path]\n')
      return 2
    }
    const requested = options(args, '--include')
    for (const member of requested) refuseRequestedMember(member)
    // ── THE FLAG THAT MAKES THE EXPORT CARRY THE CHAIN ─────────────────────────────────────────────
    // `exportPublicEvidence` has taken `cardLedgerPath` since item 2 and **NOTHING EVER PASSED IT** — the
    // CLI had no flag for it, so the member was never written and `cardChain.present` was `false` in every
    // handoff. **The same fault as the door never appending, one layer out: the capability existed and
    // nothing exercised it.** The export is told where the chain is; it does not go looking.
    const cardLedger = option(args, '--card-ledger')
    const manifest = exportPublicEvidence({
      storeDir: store,
      outDir: out,
      producerCommit,
      releaseDir: release,
      ...(cardLedger === null ? {} : { cardLedgerPath: cardLedger }),
      anchors: namedPairs(options(args, '--anchor'), '--anchor'),
      approvals: namedPairs(options(args, '--approval'), '--approval'),
      include: requested,
    })
    if (args.includes('--json')) {
      process.stdout.write(`${stableJSON(manifest)}\n`)
    } else {
      process.stdout.write(`PUBLIC EVIDENCE EXPORT — ${MANIFEST_KIND}\n`)
      process.stdout.write(`  producer commit     : ${String(/** @type {any} */ (manifest.producer).commit)}\n`)
      process.stdout.write(`  release path        : ${String(/** @type {any} */ (manifest.releaseRecord).releasePath)}\n`)
      process.stdout.write(`  release record      : ${String(/** @type {any} */ (manifest.releaseRecord).recordDigest.value)}\n`)
      process.stdout.write(`  record is from      : ${String(/** @type {any} */ (manifest.releaseRecord).producerGenesisCommit)}\n`)
      process.stdout.write(`  producer agrees     : ${String(/** @type {any} */ (manifest.releaseRecord).producerCommitAgrees)}\n`)
      process.stdout.write(`  records             : ${String(/** @type {any[]} */ (manifest.records).length)}\n`)
      process.stdout.write(`  approvals carried   : ${String(/** @type {any[]} */ (manifest.approvals).length)}\n`)
      process.stdout.write(`  files               : ${String(/** @type {any[]} */ (manifest.files).length)}\n`)
      process.stdout.write(`  store members left  : ${String(/** @type {any[]} */ (manifest.excluded).length)} (named in manifest.excluded)\n`)
    }
    return 0
  }
  if (command === 'verify') {
    const target = option(args, '--export')
    if (target === undefined) {
      process.stderr.write('usage: public-evidence.mjs verify --export <dir> [--json]\n')
      return 2
    }
    const verdict = verifyPublicEvidence(target)
    if (args.includes('--json')) process.stdout.write(`${stableJSON(verdict)}\n`)
    else {
      process.stdout.write(`PUBLIC EVIDENCE VERIFY — ${MANIFEST_KIND}\n`)
      process.stdout.write(`  files               : ${String(verdict.files)}\n`)
      process.stdout.write(`  records             : ${String(verdict.records)}\n`)
      process.stdout.write(`  manifest sha256     : ${String(verdict.manifestSha256)}\n`)
      process.stdout.write(`  producer agrees     : ${String(verdict.producerCommitAgreesWithReleaseRecord)}\n`)
      process.stdout.write('  VERDICT: the manifest describes the bytes present, no file is unlisted, and every derived document re-derives\n')
    }
    return 0
  }
  process.stderr.write('usage: public-evidence.mjs <export|verify> ...\n')
  return 2
}

const invokedDirectly = process.argv[1] !== undefined
  && resolve(process.argv[1]).endsWith(join('scripts', 'kira', 'public-evidence.mjs'))
if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    if (error instanceof PublicEvidenceRefusal) {
      process.stderr.write(`REFUSED ${error.code}\n  ${error.detail}\n`)
      process.exitCode = 1
    } else {
      throw error
    }
  }
}
