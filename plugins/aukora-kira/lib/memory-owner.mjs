/**
 * The admitted memory owner: a production read path and a governed settlement
 * path for one memory state directory.
 *
 * WHY THIS EXISTS. Until now Kira reported `no-admitted-memory-producer`: it
 * could stage an inert proposal and read a snapshot somebody else supplied, and
 * nothing in this repository could turn one into the other. This module is that
 * producer. It is the seam the earlier increments deliberately left open, and it
 * is written to the same discipline as `scripts/composition/` — the gate whose
 * governed transition this mirrors:
 *
 *   - one grant authorizes one transition, and a grant is one-use;
 *   - the grant binds the EXACT bytes the transition applies, by digest;
 *   - the byte binding is checked BEFORE the spend, so presenting a grant for
 *     different bytes does not burn its nonce;
 *   - the nonce is consumed only after every check passes and immediately before
 *     the effect, so a refused attempt leaves it spent-and-unused rather than
 *     reusable;
 *   - every accepted transition emits a signed receipt naming the prior head,
 *     the new head, the sequence, the nonce and the digest;
 *   - the effect appends one entry to an append-only hash-linked log.
 *
 * WHAT IT IS NOT, and these ceilings travel on every result rather than living
 * only here: the issuer key is generated locally and stored in the clear in the
 * state directory, so a grant proves THIS INSTALLATION authorized a transition
 * and never that a person did; the owner shares the process and uid of its
 * caller, so the binding is a digest binding and not isolation; and a receipt
 * reports that a transition occurred, never that anyone attended.
 *
 * READS SPEND NOTHING. `createReadOwner()` walks the same store and returns
 * citations; it consults no grant, touches no nonce store, and cannot mutate.
 * That split is the point: a question is free, a durable write is authorized.
 *
 * @module @aukora/dsh-plugin-kira/memory-owner
 */
import { durableAppend, durableWrite, exclusiveCreate, readBytesStrict, readJsonStrict, readJsonStrictBytes, readTextStrict, withFileLock } from './strict-read.mjs'
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign as edSign, verify as edVerify } from 'node:crypto'
import {
  chmodSync, closeSync, constants, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync, writeSync,
} from 'node:fs'
import { userInfo } from 'node:os'
import { join, dirname } from 'node:path'
import {
  KIRA_RECORD_ID,
  KIRA_SETTLEMENT_AVAILABLE,
  KIRA_STAGE_GRANTS_AUTHORITY,
  canonicalJSON,
  kiraRecordContentSha256,
  stageKiraMemoryRecord,
  memoryEffectBody,
  verifyKiraMemoryRecord,
} from './record.mjs'
import {
  ARTIFACT_DOMAIN,
  RECEIPT_APPROVAL_FIELDS,
  plainMemoryPut,
  receiptApprovalBlock,
  verifyApproval,
} from './approval.mjs'
// The queue's CONTRACT, not its storage. `queue.mjs` is pure and holds no filesystem route —
// this package's boundary allows one module a filesystem route, and it is this one — so the
// entry shape, its encoding and its re-verification are shared code while every byte that
// touches a disk is written here.
import {
  MAX_QUEUE_LIST,
  queueEntryFor,
  queueEntryText,
  queueRowOf,
  readQueueEntry,
} from './queue.mjs'

/** Domain separator of a memory-transition grant; the kind string is the algorithm binding. */
export const GRANT_KIND = 'aukora-kira-memory-grant/v1'

/** Domain separator of a memory-transition receipt. */
export const RECEIPT_KIND = 'aukora-kira-memory-receipt/v1'

/** Aura's entry-preimage domain separator, as the artifact verifier restates it. */
export const AURA_RECORD_DOMAIN = 'aukora:aura-record:v1'

/** R4: the domain of the latest-decision marker — the one document that can supersede an approval. */
export const DECISION_KIND = 'aukora:kira-decision:v1'

/** R4: the domain of the content-scoped declined document. Audit evidence, never a gate. */
export const DECLINED_KIND = 'aukora:kira-declined:v1'

/** R4: the refusal a settle earns when the latest decision for its grant is a decline. */
export const APPROVAL_DECLINED = 'APPROVAL_DECLINED'

/** The only operation a grant in this module can authorize. */
export const OPERATIONS = Object.freeze(['memory.put'])

/**
 * The refusal a write with no owner approval earns.
 *
 * `confirm: true` is a caller's statement of intent; it is not an approval, it is not signed, and it
 * cannot be one. Before this code existed the governed transition settled on a grant alone, and a
 * grant can be minted by the same turn that wants the write — so "authorization" and "effect" could
 * come from one actor, and nothing in the receipt could tell that apart from an owner act.
 */
export const APPROVAL_REQUIRED = 'APPROVAL_REQUIRED'

/** The closed grant field set; anything else is refused by name. */
const GRANT_FIELDS = Object.freeze(['kind', 'operation', 'effectDigest', 'recordId', 'expiry', 'nonce', 'sig'])

/** Names whose presence means the grant is claiming something this gate cannot check. */
const FORBIDDEN_FIELDS = Object.freeze(['alg', 'algorithm', 'hash', 'curve', 'owner', 'identity', 'did', 'subject'])

/** Named ceilings, returned on every path — accepted, refused and read alike. */
export const MEMORY_OWNER_CEILINGS = Object.freeze([
  'SAME_UID: the owner shares the process and uid of its caller; the grant is a digest binding, not isolation, and no process or uid boundary may be claimed from this code',
  'ISSUER_LOCAL: the issuer key is generated by this owner and stored in the clear in its state directory, so a grant proves this installation authorized a transition and never that a person did',
  'ATTENDANCE: reported-not-proven — a receipt says a transition occurred and which key signed for it, and cannot show a person was present',
  'NOT_CONFINEMENT: nothing here stops another process, or a caller that skips this module, from writing the same state directory',
  'NO_LATESTNESS: the receipt names this log\'s head AT THE POSITION IT WAS ISSUED FOR; it does not show that head is the tip of every fork, and anyone who can write the log can rewrite it and recompute every hash in it',
  'TRUNCATION_UNANCHORED: the log is append-only and self-contained, so a tail removed TOGETHER WITH the store\'s own `seq` marker is indistinguishable from a log that was never extended; detecting that needs a head retained OUTSIDE this store',
  'APPROVAL_CONSUMED_IN_STORE: an owner approval is spent by a marker inside this state directory, so "the same approval cannot authorize two writes" holds for one writer over one store. Two stores settling from one approval file would each spend their own marker; that is the same SAME_UID shape as NOT_CONFINEMENT, named rather than hidden',
])

/**
 * One closed `undetermined` read result.
 *
 * The read vocabulary is `found | empty | undetermined`, and this module never
 * emits `empty` for damage: a store that could not be read or verified is a
 * different fact from a store that held nothing matching, and reporting the
 * first as the second hides a safety failure.
 * @param {'memory-unavailable' | 'memory-corrupt' | 'memory-unverified' | 'integrity'} reason - the named reason.
 *   `integrity` is its own answer rather than another `memory-unverified`: an object whose BYTES no
 *   longer hash to the name it is filed under is a different fact from a missing object or a record
 *   that does not re-stage, and the remedy differs. Its dotted name is `kira.recall:integrity`.
 * @returns {Readonly<Record<string, unknown>>} the read result.
 */
function undetermined(reason, policy) {
  return Object.freeze({
    availability: 'undetermined',
    reason,
    // THE POLICY FIELDS ARE NOT OPTIONAL HERE, and leaving them out was a real defect rather than an
    // omission of convenience. `conversation.mjs` validates every owner reply through
    // `readOwnerSnapshot`, which REQUIRES `subject` and `policyRevision`; a reply that carried only an
    // availability threw `kira.read-owner:snapshot-field-missing` on the way to the caller. MEASURED:
    // a store with one rewritten object made `kira_recall` (and the recall injection) THROW instead of
    // reporting `undetermined`, and the injection's own guard then swallowed the throw — so a damaged
    // store reached a reader as NO CONTRIBUTION rather than as "could not be verified", which is the
    // exact confusion the tri-state vocabulary exists to prevent. `found` and `empty` always carried
    // these fields; only the damaged answer did not.
    subject: policy.subject,
    policyRevision: policy.policyRevision ?? 'policy-1',
    projection: { name: 'kira-content-text', version: '1', digest: projectionDigest() },
    records: Object.freeze([]),
  })
}

/** A named refusal; every refusal carries one stable code and exits nothing silently. */
export class MemoryOwnerRefusal extends Error {
  /** Stable machine-readable code, matching the composition gate's vocabulary where the meaning matches. */
  code

  /**
   * THE CEILINGS, ON THE REFUSED PATH TOO.
   *
   * The module's ceilings are "returned on every path — accepted, refused and read alike", and until
   * 2026-09-23 that sentence was false for exactly this class: a refusal does not return, it throws, so
   * the accepted path carried eight named limits and the refused path carried a code and nothing else.
   * A caller learned what the mechanism does not prove at the moment it worked, and learned nothing at
   * the moment it did not. Class 4 of the AUKORA-37 review is that shape, and this field is the smallest
   * fix that makes the sentence true on both paths. THE COURT THAT MEASURES IT IS NOT NAMED HERE,
   * deliberately: the recall court enforces a write boundary over these sources with a substring rule,
   * so a test path written into a lib comment reddens it — measured, by doing exactly that.
   */
  ceilings

  /**
   * @param {string} code - stable refusal code.
   * @param {string} reason - what was wrong, without echoing caller data wholesale.
   */
  constructor(code, reason) {
    super(`${code}: ${reason}`)
    this.name = 'MemoryOwnerRefusal'
    this.code = code
    this.ceilings = MEMORY_OWNER_CEILINGS
  }
}

/** @param {string} code @param {string} reason @returns {never} */
/** The dedicated macOS/Debian account the owner daemon runs as. */
// THE ACCOUNT NAME IS CONFIGURABLE, AND THAT IS NOT A WEAKENING. What protects an owner store is the
// filesystem — its uid and its modes — not the name this process answers to. The name exists so the
// daemon's own process is RECOGNISED as the owner (OWNER_DAEMON) instead of mistaken for an agent; a
// single-uid host (a court, or this Mac before Peter creates the account) sets it to its own user.
const OWNER_ACCOUNT = process.env.AUKORA_OWNER_ACCOUNT ?? 'aukora-owner'

function refuse(code, reason) {
  throw new MemoryOwnerRefusal(code, reason)
}

/**
 * The Aura entry hash, under the same rule the artifact verifier restates.
 * @param {string} prev - predecessor hash, or the domain separator at genesis.
 * @param {Record<string, unknown>} fields - entry body without `hash` and `prev`.
 * @returns {string} lowercase hex digest.
 */
export function auraEntryHash(prev, fields) {
  return createHash('sha256').update(auraEntryPreimage(prev, fields), 'utf8').digest('hex')
}

/**
 * The EXACT BYTES an Aura entry hash covers, restated independently of the hashing.
 *
 * WHY THIS EXISTS AS ITS OWN EXPORT. `verifyChain` re-derives every entry hash to decide whether the
 * chain is intact. When it called `auraEntryHash` to do that, the WRITER and the CHECKER were the
 * same function: a mutation to the rule moved both, they agreed by construction, and tampering
 * passed. MEASURED — dropping `prev` from the preimage left a full acceptance suite GREEN, because
 * the entry was only ever compared against the function that built it.
 *
 * Naming the bytes lets the verifier compare a stored hash against a LITERAL restatement of the
 * rule, so a drift between the rule and the check becomes a finding instead of a silent agreement.
 * A verifier that shares its arithmetic with the producer is not verifying; it is agreeing.
 *
 * @param {string} prev - predecessor hash, or the domain separator at genesis.
 * @param {Record<string, unknown>} fields - entry body without `hash` and `prev`.
 * @returns {string} the canonical preimage text.
 */
export function auraEntryPreimage(prev, fields) {
  return canonicalJSON({ prev, ...fields, domain: AURA_RECORD_DOMAIN })
}

/**
 * Sign or verify over domain-separated canonical bytes.
 * @param {string} kind - domain separator.
 * @param {Record<string, unknown>} body - the signed body, without `sig`.
 * @returns {Buffer} the exact bytes signed.
 */
function signedBytes(kind, body) {
  return Buffer.from(`${kind}\n${canonicalJSON(body)}`, 'utf8')
}

/**
 * Open (or create) one memory state directory and return its owner.
 *
 * @param {{stateDir: string, now?: () => number}} options - state directory and an optional clock, for tests.
 * @returns {Readonly<Record<string, unknown>>} the owner.
 */
// THE INTERLOCK WITH THE APPROVAL LANE. This owner is configured with a subject, and that
// subject is what the approval lane is later asked to approve. Nothing here used to READ it, so
// a release shipped `aumlok:subject:owner` -- outside the `aukora:1:<64 hex>` grammar both lanes
// agreed on -- and the mismatch surfaced only as memory that could be staged and never minted,
// with recall empty for the honest reason that nothing had been written. The reader is Aumlok's
// own, so the two sides cannot drift: one grammar, one implementation, imported rather than copied.
// read THROUGH the sibling the boundary allows to touch the approving lane; see the note there.
import { parseSubject } from './approval.mjs'

// ── **A GRANT AND AN APPROVAL ARE SMALL DOCUMENTS, AND ARE READ AS SMALL DOCUMENTS (A37 distill)** ─────────
//
// `readJsonStrict` forwarded `{ label }` and DROPPED `maxBytes`, so these two readers took the 64 MiB default
// while documenting a limit they never applied. That is now fixed in the reader (both copies, byte-identical),
// and these are the call sites that were relying on it being honoured: **a grant and an approval are operator
// documents measured in kilobytes**, and a reader that will accumulate 64 MiB of one is a reader an attacker
// fills the heap through rather than a reader that refuses.
//
// **64 KiB IS DELIBERATELY GENEROUS** — roughly sixteen times the largest grant this tree writes — because *a cap
// that refuses a legitimate document is a cap somebody removes*, and the point is to bound the pathological case
// rather than to police the ordinary one.
const GRANT_APPROVAL_MAX_BYTES = 64 * 1024


/**
 * Complete Aura entry bodies with the three fields THE LOG OWNS: `sequence`, `prev` and `hash`.
 *
 * *** WHY THIS IS EXPORTED, AND WHAT IT FIXES. *** `memory-owner.mjs`'s `appendAura` is the only writer that chains, and it is a closure: a command that appends to `aura.jsonl` itself
 * cannot reach it. So `scripts/kira/housekeeping.mjs` wrote `{op, id, at, by, because, index}` — a hand-computed INDEX, not a sequence, and no `prev` and no `hash` — and §5.1's
 * requirement is that *"every change is recorded in the Aura chain"*. MEASURED on Peter's real store after the fact: 143 of 146 aura lines carry no `sequence` and no `hash`, and the
 * tail is one of them, which means `readHead()` refuses and **the next settle fails**. A writer that does not chain does not merely skip a field; it breaks the log for everyone after it.
 *
 * THE TAIL RULES ARE MIRRORED FROM `readHead` RATHER THAN RESTATED LOOSELY, and they REFUSE here too: a torn tail, a last line that is not JSON, or a last line with no hash all stop this
 * function by name. That is deliberate and it is the honest behaviour — a caller cannot chain onto a tail that is not a chain entry, and silently writing an unchained line is exactly how
 * this store got into its present state. `memory-owner.mjs:400` records that this codebase already restates this rule once instead of calling it; this is the second restatement, and
 * the alternative was a third writer with its own idea of the chain.
 *
 * WHICH CHAIN (2026-09-27, the original memory law): by default the approved chain `aura.jsonl`. A writer of the UNSIGNED
 * tier passes `{file: <stateDir>/remembered/aura.jsonl}` (`STORE_PATHS.rememberedAura`), so the entries it is about to append
 * are chained onto the chain they will actually land in, and never onto the approved one.
 *
 * @param {string} stateDir - the store directory holding `aura.jsonl`.
 * @param {ReadonlyArray<Record<string, unknown>>} bodies - entry bodies WITHOUT the reserved fields.
 * @param {{file?: string}} [options] - the chain file, when it is not the approved chain.
 * @returns {ReadonlyArray<Record<string, unknown>>} the same bodies, each with `sequence`, `prev` and `hash`.
 */
export function chainAuraEntries(stateDir, bodies, options = {}) {
  const list = Array.isArray(bodies) ? bodies : []
  if (list.length === 0) return Object.freeze([])
  for (const body of list) {
    for (const reserved of ['sequence', 'prev', 'hash']) {
      if (Object.hasOwn(body, reserved)) {
        throw new MemoryOwnerRefusal('AURA_RESERVED_FIELD', `an Aura entry body may not carry \`${reserved}\`; the log owns it`)
      }
    }
  }
  const path = typeof options?.file === 'string' && options.file !== '' ? options.file : join(stateDir, 'aura.jsonl')
  let sequence = 1
  let prev = AURA_RECORD_DOMAIN
  if (existsSync(path)) {
    const text = readTextStrict(path)
    if (text !== '') {
      if (!text.endsWith('\n')) {
        throw new MemoryOwnerRefusal('AURA_TAIL_TORN', 'the aura log does not end at a line boundary; the last append was interrupted, so the chain cannot be continued from a line that was never completed')
      }
      const lines = text.slice(0, -1).split('\n')
      let last
      try {
        last = JSON.parse(lines[lines.length - 1])
      } catch (error) {
        throw new MemoryOwnerRefusal('AURA_TAIL_TORN', `the aura log's last complete line is not JSON (${String(error?.message ?? 'unreadable')}); the chain cannot be continued from a line that does not parse`)
      }
      if (last === null || typeof last !== 'object' || typeof last.hash !== 'string') {
        throw new MemoryOwnerRefusal('AURA_TAIL_TORN', "the aura log's last line carries no hash, so it is not a chain entry — nothing may be chained onto it until the log's tail is repaired")
      }
      sequence = lines.length + 1
      prev = last.hash
    }
  }
  // EACH ENTRY NAMES THE ONE BEFORE IT, including the entries before it in THIS batch: the first names the log's current head, and each later one names its predecessor's hash. Hashing
  // them all against the same head would produce a batch of siblings rather than a chain, which is the defect this function exists to stop.
  let runningPrev = prev
  return Object.freeze(list.map((body, index) => {
    const withSequence = { ...body, sequence: sequence + index }
    const entry = Object.freeze({ ...withSequence, prev: runningPrev, hash: auraEntryHash(runningPrev, withSequence) })
    runningPrev = entry.hash
    return entry
  }))
}

export function createMemoryOwner(options) {
  const stateDir = options.stateDir
  const now = options.now ?? (() => Math.floor(Date.now() / 1000))
  if (typeof stateDir !== 'string' || stateDir === '') refuse('STATE_INVALID', 'stateDir must be a non-empty path')

  // WHETHER THE COMPOSITION NAMES ONE FILE FOR BOTH DOCUMENTS. That is the shape the producer writes:
  // `scripts/kira/kira-approve.mjs` emits `{authorization, approval}` as ONE operator document, and
  // the materializer names that document twice on purpose, with the reasoning written out
  // (`scripts/materialize-aukora-release.py:691-700`). So it is allowed. What is NOT allowed is
  // reading one file as both documents — see `readApproval` below.
  const sharedDocumentPath = typeof options.grantFile === 'string' && options.grantFile !== ''
    && options.grantFile === options.approvalFile

  // REFUSED BEFORE ANYTHING IS CREATED. A subject the approval lane cannot parse is a store that
  // can accept a write and can never mint one, so this fails at construction rather than at the
  // first settle -- and it fails by name, carrying what it saw, because the original defect was a
  // value that failed silently at a distance from its cause. An ABSENT subject is not this check's
  // business: it is a different question with its own refusal elsewhere.
  if (options.subject !== undefined) {
    const verdict = parseSubject(options.subject)
    if (!verdict.ok) refuse('SUBJECT_INVALID', `the owner subject must be the grammar the approval lane reads: ${verdict.reason} -- ${verdict.detail}`)
  }

  // Owner-only, chmodded after: `mode` is masked by the umask, and a directory an earlier build made 0775 stays so.
  for (const dir of ['objects', 'keys', 'spent', 'approvals']) {
    mkdirSync(join(stateDir, dir), { recursive: true, mode: 0o700 })
    chmodSync(join(stateDir, dir), 0o700)
  }

  // ── THE PENDING REVIEW QUEUE ────────────────────────────────────────────────────────────────────
  // A record staged inside a turn used to evaporate when the turn ended: nothing durable named it, so
  // an owner could not review what nobody had written down. The queue is the written-down half.
  //
  // IT LIVES INSIDE THE OWNER'S OWN STATE DIRECTORY, beside `objects/`, `keys/`, `spent/` and
  // `approvals/`, and it is created LAZILY — on the first enqueue, never by this constructor. That is
  // deliberate: a store that has never queued anything then has NO queue directory, so "nothing was
  // ever staged for review" is observable rather than inferred from an empty directory this code
  // created on every read. `queueDir` is overridable so a deployment can put the queue on a different
  // volume, and an unusable value is refused rather than ignored.
  const queueDir = options.queueDir ?? join(stateDir, 'queue')
  if (typeof queueDir !== 'string' || queueDir === '') {
    refuse('STATE_INVALID', 'queueDir must be a non-empty path when supplied')
  }

  // The issuer key is this owner's own and is disposable, exactly as the gate's
  // is. `ISSUER_LOCAL` names what that costs: it proves this installation, never
  // a person.
  const keyPath = join(stateDir, 'issuer.json')
  if (!existsSync(keyPath)) {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    // CREATE-IF-ABSENT, DURABLE: the identity is written once and never replaced, and its bytes must be on disk
    // before the name exists — a reader that finds `issuer.json` must find a usable key inside it.
    exclusiveCreate(keyPath, JSON.stringify({
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    }), { dir: stateDir, mode: 0o600 })
  }
  const keys = readJsonStrict(keyPath)
  const publicKey = createPublicKey(keys.publicKey)
  const privateKey = createPrivateKey(keys.privateKey)

  /** @returns {{head: string | null, count: number}} */
  function readHead() {
    const path = join(stateDir, 'aura.jsonl')
    if (!existsSync(path)) return { head: null, count: 0 }
    const text = readTextStrict(path)
    if (text === '') return { head: null, count: 0 }
    // A TORN TAIL REFUSES BY NAME. The old code sliced the last byte, split, and `JSON.parse`d the final line, so
    // a kill mid-append produced a raw SyntaxError here and EVERY LATER SETTLE failed with no named reason. A log
    // whose last line is incomplete is a fact about the store, and it gets a name a reader can act on.
    if (!text.endsWith('\n')) {
      refuse('AURA_TAIL_TORN', 'the aura log does not end at a line boundary; the last append was interrupted, so '
        + 'the chain cannot be continued from a line that was never completed')
    }
    const lines = text.slice(0, -1).split('\n')
    let last
    try {
      last = JSON.parse(lines[lines.length - 1])
    } catch (error) {
      refuse('AURA_TAIL_TORN', `the aura log's last complete line is not JSON (${error?.message ?? 'unreadable'}); `
        + 'the chain cannot be continued from a line that does not parse')
    }
    if (last === null || typeof last !== 'object' || typeof last.hash !== 'string') {
      refuse('AURA_TAIL_TORN', "the aura log's last line carries no hash, so it is not a chain entry")
    }
    return { head: last.hash, count: lines.length }
  }


  /**
   * Walk the append-only log and re-derive it from its own bytes, from genesis.
   *
   * WHY IT TAKES A LIMIT. A receipt speaks about ONE entry and the prefix that led to it, while the
   * store's current integrity is a question about everything after it. The same bytes answer both
   * only if the walk can stop: `limit` is the receipt's own sequence, so the prefix is re-derived
   * without letting anything AFTER the receipt decide its fate. That conflation is exactly what made
   * every later honest write refuse an honest earlier receipt.
   *
   * `complete` is REPORTED rather than treated as failure here: an unterminated last line is damage,
   * but damage at the END of the file must not be able to accuse an entry that lies before it. The
   * whole-log caller (`verifyChain`) is the one that turns it into a named failure.
   *
   * @param {number} [limit] - stop after this many entries.
   * @returns {{ok: boolean, reason?: string, failedAt?: number, entries: Record<string, unknown>[],
   *   head: string | null, entryCount: number, complete: boolean}} the walked prefix or a named failure.
   */
  function walkAura(limit = Number.POSITIVE_INFINITY) {
    const path = join(stateDir, 'aura.jsonl')
    if (!existsSync(path)) return { ok: true, entries: [], head: null, entryCount: 0, complete: true }
    const text = readTextStrict(path)
    if (text === '') return { ok: true, entries: [], head: null, entryCount: 0, complete: true }
    const complete = text.endsWith('\n')
    const lines = (complete ? text.slice(0, -1) : text).split('\n')
    const entries = []
    let prev = AURA_RECORD_DOMAIN
    let head = null
    for (let index = 0; index < lines.length && entries.length < limit; index += 1) {
      const failed = (reason, failedAt = index + 1) => ({
        ok: false, reason, failedAt, entries, head, entryCount: lines.length, complete,
      })
      if (index === lines.length - 1 && !complete) return failed('CHAIN_TRUNCATED')
      const line = lines[index]
      let entry
      try {
        entry = JSON.parse(line)
      } catch {
        return failed('CHAIN_UNPARSEABLE')
      }
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        return failed('CHAIN_UNPARSEABLE')
      }
      const { hash, prev: link, ...fields } = entry
      if (JSON.stringify(entry) !== line) {
        // A line whose re-serialization differs is not the bytes that were
        // hashed: duplicate keys are the classic way to make a decoy read.
        return failed('CHAIN_NOT_CANONICAL')
      }
      if (link !== prev) return failed('CHAIN_BROKEN_LINK')
      // THE CHECK RESTATES THE RULE, IT DOES NOT CALL IT. `auraEntryHash(link, fields)` would be
      // the same function the writer used two hundred lines above, so a mutated preimage would move
      // producer and verifier together and this line would always agree. It builds the preimage
      // from `auraEntryPreimage` — the named, separately readable rule — and hashes THAT here.
      // Measured: with the old form, dropping `prev` from the rule left the whole suite green.
      if (createHash('sha256').update(auraEntryPreimage(link, fields), 'utf8').digest('hex') !== hash) {
        return failed('CHAIN_TAMPERED')
      }
      prev = hash
      head = hash
      entries.push(entry)
    }
    return { ok: true, entries, head, entryCount: lines.length, complete }
  }

  /**
   * The WHOLE log, re-derived. The question the read path asks, kept under its own name so the
   * limited walk above cannot quietly become the only walk this module performs.
   * @returns {{ok: true, entries: Record<string, unknown>[], head: string | null}
   *   | {ok: false, reason: string}} the validated chain or a named failure.
   */
  function verifyChain() {
    const walk = walkAura()
    if (walk.ok !== true) return { ok: false, reason: walk.reason }
    return { ok: true, entries: walk.entries, head: walk.head }
  }

  /**
   * The store's own record of how many entries it has written.
   *
   * `appendAura` writes this beside the log, so a log shorter than the count this store recorded is
   * a log with entries MISSING — the one shape of tail truncation an append-only log cannot see by
   * itself. It is a detection aid, not evidence: the same writer that can truncate the log can
   * rewrite this number (measured, and named as a gap in the receipt-history suite).
   *
   * DAMAGE IS NOT ABSENCE (AUKORA-37 class 3, MEASURED 2026-09-23). This used to return `null` for a
   * marker that is present but UNUSABLE — unparsable, zero, negative, not a whole number — and the caller
   * read `null` as "no expectation", so a damaged anchor produced exactly the clean verdict an intact one
   * produces. Absence is a CEILING this lane names and courts: with the marker gone the store truly
   * cannot see a removed tail, and TRUNCATION_UNANCHORED says so. Damage is a FAULT that merely looks
   * like absence, and the read path already refuses the analogous damage by name — a projection that will
   * not parse is `memory-corrupt`, a missing object is `memory-unverified`. The states are therefore told
   * apart here rather than collapsed, and the caller refuses only the damaged one.
   * @returns {Readonly<{state: 'recorded', count: number} | {state: 'absent'} | {state: 'unusable', detail: string}>}
   */
  function readSequenceMarker() {
    const path = join(stateDir, 'seq')
    if (!existsSync(path)) return Object.freeze({ state: 'absent' })
    let raw
    try {
      raw = readTextStrict(path).trim()
    } catch (error) {
      return Object.freeze({ state: 'unusable', detail: `the marker could not be read (${error?.code ?? 'unknown'})` })
    }
    const value = Number(raw)
    if (!Number.isSafeInteger(value) || value <= 0) {
      return Object.freeze({
        state: 'unusable',
        detail: `it holds ${JSON.stringify(raw.slice(0, 32))}, which is not a positive whole number of entries`,
      })
    }
    return Object.freeze({ state: 'recorded', count: value })
  }

  /**
   * THE LATER QUESTION: has the log been extended since the receipt's entry, and is the extension
   * well formed? Answered on its own, never folded into the receipt's verdict.
   *
   * WHY THIS IS ITS OWN FUNCTION. These are two questions about one file:
   *
   *   "was this receipt issued for this content at this position in this log?"   ← the receipt
   *   "has the log grown since, and does the growth re-derive?"                  ← the store
   *
   * Conflating them is the defect this module carried: the log's CURRENT head was compared with the
   * head the receipt named, so every later honest write refused an honest earlier receipt (a false
   * accusation), while a signed receipt lying about the current head was accepted (a false accept).
   * A caller that wants both facts must read both fields; neither is inferred from the other.
   *
   * `currentHead` is reported ONLY when the whole log re-derived. A damaged extension has no
   * verified head, and returning one would present an unverified value under a verified name.
   *
   * @param {number} seq - the receipt's own position.
   * @param {string} historicalHead - the head re-derived AT that position.
   * @returns {Readonly<Record<string, unknown>>} the extension result.
   */
  function describeExtension(seq, historicalHead) {
    const full = walkAura()
    if (full.ok !== true) {
      // The prefix already verified, so any failure here lies AFTER the receipt's entry: the
      // receipt is not what is damaged, and its verdict must not turn on this.
      return Object.freeze({
        status: full.reason === 'CHAIN_TRUNCATED' ? 'truncated' : 'invalid',
        verified: false,
        entriesSince: full.entryCount - seq,
        currentHead: null,
        reason: full.reason,
        failedAt: full.failedAt ?? null,
      })
    }
    const marker = readSequenceMarker()
    // A DAMAGED ANCHOR IS NAMED, NOT SKIPPED (AUKORA-37 class 3). It is reported on the EXTENSION and
    // never folded into the receipt's own verdict, exactly as the truncated case above is: what is
    // damaged is the store's count, not the receipt's position in the log. `verified: false` matches the
    // truncated sibling — the extension question could not be answered — while `currentHead` remains,
    // because the log itself re-derived here and that is a fact about the log, not about the anchor.
    if (marker.state === 'unusable') {
      return Object.freeze({
        status: 'unanchored',
        verified: false,
        entriesSince: full.entryCount - seq,
        currentHead: full.head,
        reason: `SEQUENCE_MARKER_UNUSABLE: ${marker.detail}; the log re-derived, and nothing can now say whether entries are missing from it`,
        failedAt: null,
      })
    }
    if (marker.state === 'recorded' && marker.count > full.entryCount) {
      return Object.freeze({
        status: 'truncated',
        verified: false,
        entriesSince: full.entryCount - seq,
        currentHead: null,
        reason: `this store recorded ${marker.count} entr${marker.count === 1 ? 'y' : 'ies'} but the log holds ${full.entryCount}`,
        failedAt: null,
      })
    }
    if (full.entryCount > seq) {
      return Object.freeze({
        status: 'extended',
        verified: true,
        entriesSince: full.entryCount - seq,
        currentHead: full.head,
        reason: null,
        failedAt: null,
      })
    }
    return Object.freeze({
      status: 'unchanged',
      verified: true,
      entriesSince: 0,
      currentHead: historicalHead,
      reason: null,
      failedAt: null,
    })
  }

  /**
   * Append one entry to the append-only log.
   *
   * The sequence is derived here and written INTO the entry, not merely returned
   * from the call: a caller that supplied its own would be able to disagree with
   * the position the log actually holds, and the citation a reader re-derives
   * would then point at the wrong line. `prev`, `hash` and `sequence` are the
   * envelope's, so a body carrying them is refused rather than overwritten.
   *
   * @param {Record<string, unknown>} fields - body without `sequence`, `prev` and `hash`.
   * @returns {{hash: string, prev: string | null, sequence: number}} the appended entry.
   */
  function appendAura(fields) {
    for (const reserved of ['sequence', 'prev', 'hash']) {
      if (Object.hasOwn(fields, reserved)) {
        refuse('AURA_RESERVED_FIELD', `an Aura entry body may not carry \`${reserved}\`; the log owns it`)
      }
    }
    // ONE WRITER AT A TIME (2026-09-27, red team): the capture hooks append to this log from another process, so the
    // head is read and the entry appended under the log's lock. Without it two writers name the same head, and the
    // copy-then-rename below can drop a line a capture appended to the file it replaces.
    return withFileLock(join(stateDir, 'aura.jsonl'), () => {
      const prior = readHead()
      const prev = prior.head ?? AURA_RECORD_DOMAIN
      const sequence = prior.count + 1
      const body = { ...fields, sequence }
      const entry = { ...body, prev, hash: auraEntryHash(prev, body) }
      // AN APPEND CANNOT BE MADE ATOMIC IN PLACE, SO IT IS NOT ATTEMPTED IN PLACE: the existing bytes are copied,
      // the addition is appended to the copy, the copy is fsynced, and only then does it replace the original. A
      // kill leaves either the old file or the new one — never the torn tail that readHead used to turn into a raw
      // SyntaxError. `seq` is replaced durably for the same reason: it is the number the chain continues from.
      durableAppend(join(stateDir, 'aura.jsonl'), `${JSON.stringify(entry)}\n`, { dir: stateDir })
      durableWrite(join(stateDir, 'seq'), String(sequence), { dir: stateDir })
      return { hash: entry.hash, prev: prior.head, sequence }
    })
  }

  /**
   * Mint a one-use grant for one exact effect.
   *
   * The grant binds the EFFECT BYTES, not a plugin's bytes: the governed
   * transition here is the settlement of one memory.put, so the digest that must
   * match is the digest of the arguments about to be applied.
   *
   * @param {Readonly<{key: string, value: unknown}>} memoryPut - the effect arguments.
   * @param {{expiry?: number, nonce?: string}} [grantOptions] - expiry (unix seconds) and an explicit nonce.
   * @returns {Readonly<Record<string, unknown>>} the signed grant.
   */
  function grantFor(memoryPut, grantOptions = {}) {
    const body = {
      kind: GRANT_KIND,
      operation: 'memory.put',
      effectDigest: createHash('sha256').update(memoryEffectBody(memoryPut), 'utf8').digest('hex'),
      recordId: memoryPut.key,
      expiry: grantOptions.expiry ?? now() + 300,
      nonce: grantOptions.nonce ?? randomUUID(),
    }
    return Object.freeze({ ...body, sig: edSign(null, signedBytes(GRANT_KIND, body), privateKey).toString('hex') })
  }

  /**
   * Verify one grant against the exact effect about to be applied.
   *
   * Check order is deliberate and matches the gate's: structure, forbidden
   * fields, signature, byte binding, operation, expiry — and the spend is NOT
   * here. Consuming a nonce is a separate, later step so a refused attempt
   * leaves it unspent.
   *
   * @param {unknown} grant - the presented grant.
   * @param {Readonly<{key: string, value: unknown}>} memoryPut - the effect about to be applied.
   * @returns {Readonly<Record<string, unknown>>} the verified grant body.
   */
  function verifyGrant(grant, memoryPut) {
    if (grant === null || typeof grant !== 'object' || Array.isArray(grant)) {
      refuse('GRANT_MALFORMED', 'a grant must be one plain object')
    }
    const record = /** @type {Record<string, unknown>} */ (grant)
    for (const name of FORBIDDEN_FIELDS) {
      if (Object.hasOwn(record, name)) {
        refuse('GRANT_MALFORMED', `grant carries a forbidden \`${name}\` field — the kind string is the algorithm and identity binding, not a field`)
      }
    }
    for (const name of Object.keys(record)) {
      if (!GRANT_FIELDS.includes(name)) refuse('GRANT_MALFORMED', `grant carries an unknown field \`${name}\``)
    }
    for (const name of GRANT_FIELDS) {
      if (!Object.hasOwn(record, name)) refuse('GRANT_MALFORMED', `grant is missing \`${name}\``)
    }
    if (record.kind !== GRANT_KIND) refuse('GRANT_MALFORMED', `kind is not ${GRANT_KIND}`)
    if (typeof record.sig !== 'string' || !/^[0-9a-f]{128}$/.test(record.sig)) {
      refuse('GRANT_MALFORMED', 'sig must be a lowercase hex Ed25519 signature')
    }
    if (!Number.isSafeInteger(record.expiry)) refuse('GRANT_MALFORMED', 'expiry must be an integer')
    if (typeof record.nonce !== 'string' || record.nonce === '') refuse('GRANT_MALFORMED', 'nonce must be a non-empty string')

    const body = {
      kind: record.kind, operation: record.operation, effectDigest: record.effectDigest,
      recordId: record.recordId, expiry: record.expiry, nonce: record.nonce,
    }
    if (!edVerify(null, signedBytes(GRANT_KIND, body), publicKey, Buffer.from(record.sig, 'hex'))) {
      refuse('GRANT_MALFORMED', 'the signature does not verify under the key this owner holds')
    }
    // Byte binding before the spend: a grant for other bytes must not burn its nonce.
    const expected = createHash('sha256').update(memoryEffectBody(memoryPut), 'utf8').digest('hex')
    if (record.effectDigest !== expected) {
      refuse('GRANT_BYTES_MISMATCH', 'the grant binds a different effect digest than the bytes being applied')
    }
    if (record.operation !== 'memory.put') refuse('GRANT_OPERATION_MISMATCH', 'the grant is for another operation')
    if (record.recordId !== memoryPut.key) refuse('GRANT_BYTES_MISMATCH', 'the grant names a different record')
    if (record.expiry < now()) refuse('GRANT_EXPIRED', 'the grant has expired')
    return Object.freeze(body)
  }

  /**
   * Consume one grant's nonce. Creation is the decision, so the kernel
   * arbitrates: `O_CREAT|O_EXCL` means exactly one caller wins and every other
   * attempt gets EEXIST. Two processes cannot both read "not spent".
   * @param {string} nonce - the grant's nonce.
   */
  /**
   * The marker that makes ONE approval one-use, and the marker that makes ONE grant nonce one-use.
   *
   * ONE DEFINITION EACH, because a pre-check and a spend that build the same key in two places are two
   * chances to disagree, and a key that disagreed would read as "nothing was consumed yet".
   */
  function approvalMarkerPath(approvalId) {
    return join(stateDir, 'approvals', `${String(approvalId)}.json`)
  }

  /** @param {string} nonce @returns {string} the path of the grant's one-use marker. */
  function nonceMarkerPath(nonce) {
    return join(stateDir, 'spent', createHash('sha256').update(nonce, 'utf8').digest('hex'))
  }

  /**
   * BOTH ONE-USE RECORDS ARE CHECKED BEFORE EITHER IS CONSUMED (AUKORA-37 class 2).
   *
   * MEASURED 2026-09-23, reachable through shipped commands. A write spends two one-use records in
   * sequence — the approval's marker, then the grant's nonce. When the SECOND refuses, the FIRST has
   * already been consumed: a grant whose nonce is spent stays in the operator's documents, the
   * daemon-free approval command can mint a fresh approval for the same bytes at any moment, and the
   * attempt then burns that approval to learn `GRANT_SPENT` — a fact the store could have answered for
   * free. The mirror case was safe only by accident of the same ordering.
   *
   * This pre-flight makes the common refusals cost nothing on EITHER side. The `O_CREAT|O_EXCL` writes
   * below remain the guard that arbitrates two concurrent writers, which no pre-check can replace.
   * @param {Readonly<Record<string, unknown>>} verified - the verified approval.
   * @param {string} nonce - the verified grant's one-use nonce.
   * @returns {void}
   */
  function assertSpendable(verified, nonce) {
    if (existsSync(approvalMarkerPath(verified.approvalId))) {
      refuse('APPROVAL_REPLAY', 'this approval was already consumed; one approval authorizes one write')
    }
    if (existsSync(nonceMarkerPath(nonce))) {
      refuse('GRANT_SPENT', 'the grant\'s one-use nonce was already consumed')
    }
  }

  function spendNonce(nonce) {
    const path = nonceMarkerPath(nonce)
    // DURABLE AND ATOMIC. This was `openSync(O_CREAT|O_EXCL)` plus `writeSync` with NO FSYNC, so a kill between
    // them left an EMPTY marker — a one-use nonce that reads as consumed while nothing records what consumed it.
    // `exclusiveCreate` writes a temporary, fsyncs it, LINKS it into place and fsyncs the directory.
    // THE COLLISION IS ANSWERED OUTSIDE THE `try`, AND THAT PLACEMENT IS THE FIX (MEASURED BY FABLE, 2026-09-25,
    // on this very code, in worktree wf_06032274-f90-2). The `GRANT_SPENT` refusal used to be thrown INSIDE it, so
    // the `catch` below caught its OWN refusal, saw a code that was not `EEXIST`, and re-refused it as
    // `SPEND_STORE_UNAVAILABLE: ... could not be written: GRANT_SPENT` — the loser of a real race was told the
    // STORE WAS BROKEN rather than that the nonce was already spent. A named refusal renamed by its own error
    // handler is worse than no name at all, and NO COURT HERE CAUGHT IT, because not one of them races.
    let created
    try {
      created = exclusiveCreate(path, `${nonce}\n`, { dir: dirname(path) }).created
    } catch (error) {
      if (error?.code === 'EEXIST') refuse('GRANT_SPENT', 'the grant\'s one-use nonce was already consumed')
      refuse('SPEND_STORE_UNAVAILABLE', `the nonce store could not be written: ${error?.code ?? 'unknown'}`)
    }
    if (created !== true) refuse('GRANT_SPENT', 'the grant\'s one-use nonce was already consumed')
  }

  /**
   * Consume one approval, exactly once, and remember which write it paid for.
   *
   * Creation is the decision, so the kernel arbitrates: `O_CREAT|O_EXCL` means exactly one caller
   * wins and every other attempt gets EEXIST — the same rule the grant's nonce store uses, for the
   * same reason. A marker that already exists is a REPLAY and is refused by its own name, because
   * "this approval was already used" and "this approval was not valid" call for different actions.
   *
   * THE ORDER IS THE POINT. The marker is written BEFORE the object, the key projection and the Aura
   * entry, so a crash between here and the effect leaves the approval spent-and-unused rather than
   * reusable. Everything that can refuse this write — a malformed record, a mismatched grant, an
   * unbound approval — has already refused by the time this runs.
   *
   * @param {Readonly<Record<string, unknown>>} verified - the verified approval.
   * @param {Readonly<{key: string, value: unknown}>} memoryPut - the effect it is being spent on.
   */
  function spendApproval(verified, memoryPut) {
    const path = approvalMarkerPath(verified.approvalId)
    // DURABLE AND ATOMIC. This was `openSync(O_CREAT|O_EXCL)` plus `writeSync` with NO FSYNC, so a kill between
    // them left an EMPTY marker — an approval that reads as consumed while nothing records which effect consumed
    // it. `exclusiveCreate` writes a temporary, fsyncs it, LINKS it into place and fsyncs the directory.
    // THE REPLAY IS ANSWERED OUTSIDE THE `try`, for the reason `spendNonce` records above: thrown inside it, the
    // `catch` below caught `APPROVAL_REPLAY` and renamed it `APPROVAL_STORE_UNAVAILABLE` (MEASURED 2026-09-25), so
    // the loser of a race learned "the registry is broken" instead of "this approval was already used".
    let created
    try {
      created = exclusiveCreate(path, `${JSON.stringify({
        approvalId: verified.approvalId,
        // WHICH ARTIFACT, AND WHAT IT LABELLED ITSELF. The artifact's class fields are outside its
        // signed preimage, so they are a label and not a claim to have earned anything; recording
        // them BESIDE the label's meaning is the difference between printing a verdict and
        // repeating a word the artifact chose for itself.
        artifactDomain: verified.artifactDomain,
        approvalClass: verified.approvalClass,
        keyClass: verified.keyClass,
        challenge: verified.challenge,
        operationDigest: verified.operationDigest,
        subject: verified.subject,
        approverDid: verified.approverDid,
        recordId: memoryPut.key,
        spentAt: now(),
      })}\n`, { dir: dirname(path) }).created
    } catch (error) {
      if (error?.code === 'EEXIST') {
        refuse('APPROVAL_REPLAY', 'this approval was already consumed; one approval authorizes one write')
      }
      refuse('APPROVAL_STORE_UNAVAILABLE', `the approval registry could not be written: ${error?.code ?? 'unknown'}`)
    }
    if (created !== true) {
      refuse('APPROVAL_REPLAY', 'this approval was already consumed; one approval authorizes one write')
    }
  }

  /**
   * The approval consumption record this store holds for one record, if any.
   *
   * Read from the registry rather than from the receipt, so a receipt cannot choose which record it is
   * answered against. Returns null when no approval was ever consumed for this key — the honest state
   * of every store that predates owner approval, and of a store whose writes were all refused.
   *
   * @param {unknown} recordId - the record key a receipt names.
   * @returns {Record<string, unknown> | null} the consumption record, or null.
   */
  function readApprovalMarkerFor(recordId) {
    const dir = join(stateDir, 'approvals')
    if (typeof recordId !== 'string' || !existsSync(dir)) return null
    let names
    try {
      names = readdirSync(dir).filter(name => name.endsWith('.json'))
    } catch {
      return null
    }
    for (const name of names) {
      let marker
      try {
        marker = readJsonStrict(join(dir, name))
      } catch {
        return { approvalId: name.slice(0, -'.json'.length), recordId: '__unparseable__', operationDigest: null, challenge: null, approverDid: null }
      }
      if (marker !== null && typeof marker === 'object' && marker.recordId === recordId) return marker
    }
    return null
  }

  /**
   * Settle one staged record: the governed transition.
   *
   * TWO ACTS AUTHORIZE ONE WRITE, and neither substitutes for the other:
   *
   *   the GRANT      this installation's one-use authorization for exactly these effect bytes;
   *   the APPROVAL   the owner's signed approval, whose operation digest is RE-COMPUTED here from
   *                  the bytes about to be written.
   *
   * The approval is checked first, so a write that no owner approved cannot reach the nonce spend,
   * the approval registry or the log. It is consumed before the effect, so replay is refused by name
   * and a crash between the two leaves the approval spent rather than reusable.
   *
   * @param {Readonly<{recordId: string, record: Readonly<Record<string, unknown>>, memoryPut: Readonly<{key: string, value: unknown}>}>} staged - output of `stageKiraMemoryRecord`.
   * @param {unknown} grant - the one-use grant to present.
   * @param {unknown} approval - the approval bundle to present; there is no unapproved path.
   * @param {Readonly<{subject: string, approverDid?: string}>} expectation - the subject this owner serves and an optional registered approver key. NO CLOCK IS ACCEPTED HERE: the owner reads its own (`createMemoryOwner({now})`), because a caller-supplied clock lets a caller void an expired approval window by passing an earlier instant.
   * @returns {Readonly<Record<string, unknown>>} the receipt and the settlement.
   */
  function settle(staged, grant, approval, expectation) {
    // THE DUTY. A settlement with no approval is refused HERE, before it can reach any other check:
    // an early refusal is the only kind that can promise nothing was written.
    if (approval === undefined || approval === null) {
      refuse(APPROVAL_REQUIRED,
        'no owner approval was presented for this content; a grant, a `confirm:true` flag and an identity label are not approvals')
    }
    if (expectation === null || typeof expectation !== 'object' || typeof expectation.subject !== 'string'
      || expectation.subject === '') {
      refuse('APPROVAL_INPUT_MALFORMED',
        'settling requires the subject this owner serves, so an approval for another subject cannot authorize this write')
    }
    const verdict = verifyKiraMemoryRecord(staged.record)
    if (verdict.verified !== true) refuse('RECORD_MALFORMED', `the record does not verify: ${verdict.reason}`)
    if (staged.record.grantsAuthority !== KIRA_STAGE_GRANTS_AUTHORITY) {
      refuse('RECORD_GRANTS_AUTHORITY', 'a settled record must carry grantsAuthority:false')
    }
    // ── THE RECORD'S SUBJECT IS THE OWNER'S SUBJECT ────────────────────────────────────────────────
    // The approval binds the whole `{key, value}` pair, so a record carrying SOMEBODY ELSE'S subject
    // is still content an approver signed for — and it would land in a store whose read path filters
    // by the OWNER's subject, becoming a record nobody can recall and a write nobody can see. The
    // grammar the approval wire uses is Aumlok's `aukora:1:<sha256>`; this check does not restate
    // that grammar, it requires the two strings to BE one string, which is the property that makes
    // "an approval for this owner's memory" mean the record is this owner's.
    if (staged.record.subject !== expectation.subject) {
      refuse('RECORD_SUBJECT_MISMATCH',
        `the record being settled names subject ${JSON.stringify(staged.record.subject)} and this owner serves `
        + `${JSON.stringify(expectation.subject)}; the approval would authorize a write into a memory the `
        + 'read owner can never show')
    }
    // ── P1: THE ARGUMENTS ARE READ AS DATA, ONCE ────────────────────────────────────────────────────
    // MEASURED DEFECT, found by a separate read-only reviewer agent (same operator) in the first version of this change. `memoryPut`
    // is caller-supplied and `value` may be an accessor: the approval digest, the grant digest and the
    // written body each read it again, so a caller could have one value approved and another written.
    // Measured on the old bytes: "WROTE seq=1 … reads of memoryPut.value during settle: 3 … OBJECT
    // ACTUALLY WRITTEN (note): Cedar endpoint listens on port 8098 | note the approval was issued for:
    // Rollback runbook lives in ops/rollback.md".
    //
    // `plainMemoryPut` reads each field ONCE, from a property descriptor, and refuses an accessor. From
    // here on the approval, the grant and the object body all describe THIS copy — the value cannot
    // answer twice.
    const memoryPut = plainMemoryPut(staged.memoryPut)
    // ── P2: THE IDENTIFIER IS THE RECORD'S OWN ──────────────────────────────────────────────────────
    // MEASURED DEFECT, same audit: `staged.recordId` was never checked against the record it names, so
    // a caller could write `keys/<a>` and an Aura entry keyed `<a>` over a body whose own `recordId` is
    // something else — leaving the read owner `undetermined (memory-corrupt)` and the receipt for that
    // very write unverifiable. A record identity that is not the record's identity is not an identity.
    if (staged.recordId !== staged.record.recordId) {
      refuse('RECORD_MALFORMED',
        `the settlement names record ${String(staged.recordId)} and the record it would store identifies itself as ${String(staged.record.recordId)}`)
    }
    // ── THE APPROVAL BINDS THE BYTES BEING SETTLED ─────────────────────────────────────────────────
    // It is verified against THE PLAIN-DATA COPY above and never against anything the approval document
    // says about itself, so an accessor cannot answer the digest and then the write. The window is
    // checked against THE OWNER'S clock: MEASURED DEFECT, same audit — a per-call `now` let a caller
    // pass `now: 0` and settle an approval whose window had closed
    // ("settleAuthorized({... now: 0}): WROTE (no throw)").
    const approved = verifyApproval(approval, {
      subject: expectation.subject,
      memoryPut,
      now: now(),
      // The registered approver key, when the composition pinned one. Absent means "any key the
      // bundle names", which is a NAMED ceiling on every verdict rather than a silent widening.
      ...(expectation.approverDid === undefined ? {} : { approverDid: expectation.approverDid }),
      // The control head this deployment CURRENTLY serves, when the composition supplies it. Absent
      // means "whatever head the artifact names", which is a NAMED ceiling — and without it an
      // approval is admitted by a control that may since have been rotated or revoked (MEASURED
      // 2026-09-21: controller served 811340dc…, artifact named a7811fe9…, settlement WROTE).
      ...(expectation.activeControlDigest === undefined ? {} : { activeControlDigest: expectation.activeControlDigest }),
    })
    const body = verifyGrant(grant, memoryPut)

    // ── THE LATEST HUMAN DECISION WINS (R4) ───────────────────────────────────────────────────────
    // Checked AFTER both documents verify and BEFORE either is consumed. That ordering is the only one
    // that satisfies both requirements at once: a decline must be able to supersede a perfectly valid
    // signed approval, and it must leave the grant UNSPENT — a refusal that burns a nonce is not a
    // refusal, it is a write that failed expensively. The marker binds the grant's fingerprint, so a
    // decline recorded against an OLDER grant is stale and does not shadow a freshly minted one.
    const decision = readDecision()
    if (decision.state === 'unreadable') {
      // FAIL CLOSED. A store whose gate cannot be read must not settle as though nothing had been
      // written there, and nothing is consumed on this path either.
      refuse('DECISION_UNREADABLE',
        `the latest decision could not be read (${String(decision.reason)}); nothing was consumed`)
    }
    // ── ONE DECISION PER RECORD, BECAUSE THE GATE MUST OUTLIVE THE NEXT DECISION (MEASURED 2026-09-25)
    // A single `decision.json` CANNOT GATE MORE THAN ONE RECORD: it is replaced on every write, so
    // decline A, decline B, settle A read B's decision and WROTE, and a `--prepare` of any record wrote
    // an `approved` marker that wiped an earlier decline outright. The CONTENT-SCOPED DECLINED DOCUMENT
    // is therefore THE GATE — one file per record, keyed by the sha256 of the exact effect body about to
    // be written — and the marker keeps only its own, narrower rule: a decline whose fingerprint matches
    // THIS grant supersedes that grant. Both refusals leave the approval file and the nonce untouched.
    const writingDigest = createHash('sha256').update(memoryEffectBody(memoryPut), 'utf8').digest('hex')
    const aboutTheseBytes = readDecisionFor(writingDigest)
    if (aboutTheseBytes.state === 'unreadable') {
      refuse('DECISION_UNREADABLE',
        `the decision recorded for these bytes could not be read (${String(aboutTheseBytes.reason)}); nothing was consumed`)
    }
    // THE DECISION ABOUT *THESE BYTES* IS THE GATE. The single `decision.json` is the LATEST decision
    // ANYWHERE, which is why it could not gate two records: declining B replaced A's decline, and
    // preparing C replaced it with an approval. A decision that the next unrelated decision erases is not
    // a decision. R4 still holds, because a LATER DECISION ABOUT THE SAME BYTES overwrites this file: a
    // decline is not forever, it is the latest word about that record.
    if (aboutTheseBytes.state === 'declared' && aboutTheseBytes.decision === 'declined') {
      refuse(APPROVAL_DECLINED,
        'these exact bytes were declined by the latest decision about them, which supersedes the signed approval; nothing was consumed')
    }
    // The marker keeps its own, narrower rule: a decline whose fingerprint matches THIS grant supersedes
    // that grant. The per-record file above speaks for the bytes; this speaks for the grant, and a store
    // written before per-record decisions existed is still gated by it.
    // LEGACY FALLBACK, AND ONLY THAT. The singleton speaks for a store written before per-record
    // decisions existed; when these bytes have a decision of their own, that decision is the gate and the
    // singleton cannot shadow it. This is also what makes a decline impossible to lose to the next one:
    // the per-record file is never overwritten by another record's decision.
    if (aboutTheseBytes.state === 'absent'
      && decision.state === 'declared' && decision.decision === 'declined'
      && decision.grantDigest === grantFingerprint(grant)) {
      refuse(APPROVAL_DECLINED,
        'the latest decision for this grant is a decline, and it supersedes the signed approval; the approval file is untouched and nothing was consumed')
    }

    // THE LAST CHECK RUNS BEFORE THE POINT OF NO RETURN, NOT AFTER IT (AUKORA-37 class 1).
    //
    // MEASURED 2026-09-23: this guard sat BELOW the two consumptions, where a refusal is not free. As the
    // code stands it can never fire — `kiraRecordContentSha256(record)` is DEFINED as
    // `sha256(memoryEffectBody({key: record.recordId, value: record}))`, and `memoryPut` is derived from
    // this same re-staged record, so the guard compares a value with itself. That is exactly why it
    // belongs here rather than there: the day a refactor makes it reachable — a caller-supplied
    // `memoryPut`, a projection that stops agreeing with the record — the refusal must cost nothing,
    // because the alternative is a spent grant and a consumed approval with nothing written: "a write
    // that failed expensively", in this function's own words about the decision marker above.
    const effectBody = memoryEffectBody(memoryPut)
    const contentSha256 = createHash('sha256').update(effectBody, 'utf8').digest('hex')
    if (contentSha256 !== kiraRecordContentSha256(staged.record)) {
      refuse('RECORD_MALFORMED', 'the record digest disagrees with the object body it would be stored as')
    }

    // Everything verified. BOTH one-use records are checked before EITHER is consumed, so a refusal
    // costs nothing on either side (AUKORA-37 class 2); then they are consumed here, immediately before
    // the effect, so a crash leaves them spent-and-unused rather than reusable.
    // THE AURA TAIL IS CHECKED BEFORE ANYTHING IS SPENT OR WRITTEN. On 2026-09-27 a torn tail refused only at
    // `appendAura`, after the approval and nonce were spent and the object and key written: a half-settled record.
    // AND THE LOG'S LOCK IS TAKEN HERE, BEFORE THE SPEND (2026-09-27, red team): a capture writing the log from another
    // process refuses this settle by name while it still costs nothing. `appendAura` takes the same lock re-entrantly.
    const aura = withFileLock(join(stateDir, 'aura.jsonl'), () => {
      chainAuraEntries(stateDir, [{ verdict: 'preflight' }])
      assertSpendable(approved, body.nonce)
      spendApproval(approved, memoryPut)
      spendNonce(body.nonce)
      // DURABLE: temporary, fsync, replace, directory fsync — an object named before its bytes are on disk is an
      // object every reader believes and none can read.
      durableWrite(join(stateDir, 'objects', `${contentSha256}.json`), effectBody,
        { dir: join(stateDir, 'objects'), mode: 0o600 })
      durableWrite(
        join(stateDir, 'keys', `${memoryPut.key}.json`),
        `${JSON.stringify({ key: staged.recordId, contentSha256 })}\n`,
        { dir: join(stateDir, 'keys'), mode: 0o600 },
      )
      return appendAura({
        verdict: 'settled', key: memoryPut.key, contentSha256, operation: 'memory.put',
      })
    })
    const receiptBody = {
      kind: RECEIPT_KIND,
      operation: 'memory.put',
      recordId: memoryPut.key,
      effectDigest: contentSha256,
      nonce: body.nonce,
      issuedAt: now(),
      // WHICH APPROVAL AUTHORIZED THIS WRITE. Inside the signed body, so the receipt names the
      // approval that covered exactly these bytes: a receipt that cannot name its approval is a
      // receipt that cannot tell an approved write from an unapproved one.
      approval: receiptApprovalBlock(approved),
      aura: { entryHash: aura.hash, seq: aura.sequence, priorHead: aura.prev, head: aura.hash },
    }
    const receipt = Object.freeze({
      ...receiptBody,
      sig: edSign(null, signedBytes(RECEIPT_KIND, receiptBody), privateKey).toString('hex'),
      issuerPk: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    })
    durableWrite(join(stateDir, `receipt-memory.put-${String(aura.sequence).padStart(3, '0')}.json`),
      `${JSON.stringify(receipt, null, 2)}\n`, { dir: stateDir, mode: 0o600 })
    return Object.freeze({
      receipt,
      sequence: aura.sequence,
      head: aura.hash,
      contentSha256,
      approvalId: approved.approvalId,
      // WHICH PINS WERE ACTUALLY APPLIED, carried out to the caller instead of being left behind in
      // `verifyApproval`'s return. MEASURED DEFECT, Codex's review of the first version of this
      // wiring: `controlPinned` was computed and then dropped here, so a caller could not tell an
      // admission enforced against the CURRENT control head from one that was never pinned at all —
      // the same "available is not authorized" mistake, one layer out.
      approverPinned: approved.approverPinned,
      controlPinned: approved.controlPinned,
      ceilings: MEMORY_OWNER_CEILINGS,
    })
  }

  /**
   * Verify one receipt against this store's log — TWO questions, answered separately.
   *
   *   HISTORICAL  `verdict` / `history`  — was this receipt issued for this content at this
   *              position in this log? Answered from the PREFIX ending at the receipt's own
   *              entry; a later write cannot move it, and nothing after the entry participates.
   *   EXTENSION   `extension`            — has the log grown since, and does the growth re-derive?
   *              `unchanged | extended | invalid | truncated`, with the current head reported only
   *              when the whole log re-derived and `verified` saying so.
   *
   * A damaged extension does NOT refuse the receipt: the receipt is not the damaged thing, and
   * letting a later injury convict it is the same false accusation, one step further out. A caller
   * that needs "the store is intact" must read `extension.verified`; `verdict: 'verified'` answers
   * only the historical question and must never be read as the other.
   *
   * @param {unknown} receipt - the receipt to verify.
   * @returns {Readonly<Record<string, unknown>>} the verdict.
   */
  function verifyReceipt(receipt) {
    if (receipt === null || typeof receipt !== 'object' || Array.isArray(receipt)) {
      refuse('RECEIPT_TAMPERED', 'a receipt must be one plain object')
    }
    const r = /** @type {Record<string, unknown>} */ (receipt)
    for (const name of FORBIDDEN_FIELDS) {
      if (Object.hasOwn(r, name)) refuse('RECEIPT_TAMPERED', `receipt carries a forbidden \`${name}\` field`)
    }
    if (r.kind !== RECEIPT_KIND) refuse('RECEIPT_TAMPERED', `kind is not ${RECEIPT_KIND}`)
    if (typeof r.sig !== 'string') refuse('RECEIPT_TAMPERED', 'receipt carries no signature')
    const { sig, issuerPk, ...body } = r
    void issuerPk
    if (!edVerify(null, signedBytes(RECEIPT_KIND, body), publicKey, Buffer.from(String(sig), 'hex'))) {
      refuse('RECEIPT_TAMPERED', 'the receipt signature does not verify')
    }
    const aura = /** @type {Record<string, unknown>} */ (body.aura)
    if (aura === null || typeof aura !== 'object' || Array.isArray(aura)) {
      refuse('RECEIPT_TAMPERED', 'the receipt carries no aura block to check against the log')
    }

    // BOUND TO THE ACTUAL OBJECT BYTES. Existence is not evidence: the bytes on
    // disk must hash to the digest the receipt names, and the record inside them
    // must re-stage to the identifier the receipt names. A receipt that verifies
    // while its object is damaged is a receipt saying nothing about this store.
    const objectPath = join(stateDir, 'objects', `${body.effectDigest}.json`)
    if (!existsSync(objectPath)) refuse('RECEIPT_TAMPERED', 'the object the receipt names is not in this store')
    const { bytes, value: parsedObject } = readJsonStrictBytes(objectPath)
    if (createHash('sha256').update(bytes).digest('hex') !== body.effectDigest) {
      refuse('MEMORY_TAMPERED', 'the object bytes do not hash to the digest the receipt names')
    }
    let stored
    try {
      stored = parsedObject
    } catch {
      refuse('MEMORY_CORRUPT', 'the stored object is not parseable')
    }
    if (stored === null || typeof stored !== 'object' || stored.key !== body.recordId) {
      refuse('MEMORY_CORRUPT', 'the stored object does not carry the record the receipt names')
    }
    const restaged = verifyKiraMemoryRecord(stored.value)
    if (restaged.verified !== true || restaged.record.recordId !== body.recordId) {
      refuse('MEMORY_UNVERIFIED', 'the stored record does not re-stage to the identifier the receipt names')
    }

    // ── THE HISTORICAL QUESTION ────────────────────────────────────────────────────────────────────
    // "Was this receipt issued for this content at this position in this log?" The receipt binds one
    // entry and the prefix that led to it, so the PREFIX is what is re-derived here — never the
    // log's current tip, which later honest writes move. MEASURED, and the reason this block was
    // rewritten: with the tip compared instead, an honest receipt at seq 1 was refused MEMORY_TAMPERED
    // as soon as a second write landed (a false accusation, repeated for every earlier receipt), while
    // a SIGNED receipt lying that its head was the current one verified (a false accept). One wrong
    // comparison, unsound in both directions, is not evidence of anything.
    const seq = Number(aura.seq)
    if (!Number.isSafeInteger(seq) || seq < 1) {
      refuse('MEMORY_TAMPERED', 'the receipt names a sequence that is not a positive integer')
    }
    const prefix = walkAura(seq)
    if (prefix.ok !== true) {
      refuse('MEMORY_UNVERIFIED', `the Aura prefix this receipt names does not verify: ${prefix.reason}`)
    }
    const entry = prefix.entries[seq - 1]
    if (entry === undefined) refuse('MEMORY_UNVERIFIED', 'the chain holds no entry at the sequence the receipt names')
    if (entry.hash !== aura.entryHash) refuse('MEMORY_TAMPERED', 'the chain entry hash is not the one the receipt names')
    if (entry.key !== body.recordId) refuse('MEMORY_TAMPERED', 'the chain entry names a different record')
    const prior = entry.prev === AURA_RECORD_DOMAIN ? null : entry.prev
    if (prior !== aura.priorHead) refuse('MEMORY_TAMPERED', 'the chain entry does not link the prior head the receipt names')
    // THE RECEIPT'S `head` IS ITS OWN ENTRY. `settle` appends the entry and then records the head the
    // append produced, so the two are the same value at issuance; a receipt whose `head` is some
    // OTHER entry's hash is describing a position it was not issued at. This is the check the old
    // tip comparison stood in for, and it is the one that refuses the re-signed forgery above.
    if (aura.head !== aura.entryHash) {
      refuse('MEMORY_TAMPERED',
        `the receipt names head ${String(aura.head)} but the entry it was issued for hashes to ${String(aura.entryHash)}`)
    }

    // ── WHICH APPROVAL AUTHORIZED THIS WRITE ───────────────────────────────────────────────────────
    // A receipt that carries an approval block must name an approval THIS STORE actually consumed,
    // for this record, by this approver, over this challenge, and it must carry the shapes an
    // approval has. This is a store fact and not a second signature check, deliberately: the
    // approval's window may legitimately have closed since the write, and re-checking it here would
    // turn a genuine receipt into a false accusation because time passed. The record's own identity
    // is already bound above; what this adds is that an approval was SPENT for it.
    //
    // IT IS OPTIONAL FOR HISTORY AND MANDATORY FOR A STORE THAT CONSUMED ONE. Receipts issued before
    // owner approval existed carry no such block and keep verifying: this change does not re-label or
    // invalidate history. But when THIS STORE holds a consumption record for this very record, a
    // receipt that names no approval is not describing the write that happened, and it is refused —
    // which closes the "re-sign an approved write as an unapproved-looking one" direction of the same
    // seam. MEASURED, from the audit of the previous revision: a receipt with no approval block
    // returned "ACCEPTED verdict=verified" over a store that had consumed an approval for that record.
    const storedMarkerOfRecord = readApprovalMarkerFor(body.recordId)
    if (body.approval === undefined && storedMarkerOfRecord !== null) {
      refuse('MEMORY_UNVERIFIED',
        'this store consumed an approval for this record and the receipt names none, so it does not describe the write that happened')
    }
    if (body.approval !== undefined) {
      const block = body.approval
      if (block === null || typeof block !== 'object' || Array.isArray(block)) {
        refuse('RECEIPT_TAMPERED', 'the receipt carries an approval block that is not a plain object')
      }
      for (const name of RECEIPT_APPROVAL_FIELDS) {
        if (!Object.hasOwn(block, name)) refuse('RECEIPT_TAMPERED', `the receipt's approval block is missing \`${name}\``)
      }
      if (typeof block.approvalId !== 'string' || !/^[0-9a-f]{64}$/.test(block.approvalId)) {
        refuse('RECEIPT_TAMPERED', 'the receipt names an approval id that is not a digest')
      }
      if (typeof block.challenge !== 'string' || !/^[0-9a-f]{64}$/.test(block.challenge)) {
        refuse('RECEIPT_TAMPERED', 'the receipt names an approval challenge that is not a digest')
      }
      if (typeof block.operationDigest !== 'string' || !/^[0-9a-f]{64}$/.test(block.operationDigest)) {
        refuse('RECEIPT_TAMPERED', 'the receipt names an approval operation digest that is not a digest')
      }
      // WHICH ARTIFACT. A receipt that names an approval must say which document that approval WAS,
      // and it is one domain: the Aumlok receipt this gate consumes. A block naming any other
      // document would be a receipt about an approval format nothing in this repository produces.
      if (block.artifactDomain !== ARTIFACT_DOMAIN) {
        refuse('RECEIPT_TAMPERED',
          `the receipt names an approval artifact domain ${JSON.stringify(block.artifactDomain)}; this gate consumes ${ARTIFACT_DOMAIN}`)
      }
      const spendPath = join(stateDir, 'approvals', `${block.approvalId}.json`)
      if (!existsSync(spendPath)) {
        refuse('MEMORY_UNVERIFIED', 'the receipt names an approval this store has no record of consuming')
      }
      let spent
      try {
        spent = readJsonStrict(spendPath)
      } catch {
        refuse('MEMORY_CORRUPT', 'the approval record this store holds is not parseable')
      }
      if (spent === null || typeof spent !== 'object' || spent.approvalId !== block.approvalId) {
        refuse('MEMORY_CORRUPT', 'the approval record does not carry the approval the receipt names')
      }
      if (spent.recordId !== body.recordId) {
        refuse('MEMORY_TAMPERED', 'the approval this receipt names was consumed for a different record')
      }
      if (spent.challenge !== block.challenge || spent.approverDid !== block.approverDid) {
        refuse('MEMORY_TAMPERED', 'the approval this receipt names is not the approval this store consumed')
      }
      if (spent.artifactDomain !== block.artifactDomain) {
        refuse('MEMORY_TAMPERED', 'the approval this receipt names is a different artifact than this store consumed')
      }
      if (spent.approvalClass !== block.approvalClass || spent.keyClass !== block.keyClass) {
        refuse('MEMORY_TAMPERED', 'the approval labels this receipt names are not the ones this store consumed')
      }
      // AND THE DIGEST THE APPROVAL BOUND, compared with the one the CONSUMPTION RECORD holds — a
      // value written before the effect, so it cannot be re-signed into agreement with a forged
      // block. MEASURED, from the same audit: a block carrying a FABRICATED `operationDigest` was
      // "ACCEPTED verdict=verified", because the field's shape was checked and its value never was.
      if (spent.operationDigest !== block.operationDigest) {
        refuse('MEMORY_TAMPERED',
          `the receipt names approved operation digest ${String(block.operationDigest)} and this store recorded ${String(spent.operationDigest)}`)
      }
    }

    // ── THE LATER QUESTION, ANSWERED SEPARATELY ────────────────────────────────────────────────────
    // "Has the log been extended since, and is the extension well formed?" Reported, never folded
    // into the verdict above: a damaged tail is a fact about the store, and a receipt issued before
    // the damage is not thereby false. A caller needing both reads both.
    const extension = describeExtension(seq, entry.hash)

    return Object.freeze({
      verdict: 'verified',
      recordId: body.recordId,
      seq,
      // The head re-derived AT THE RECEIPT'S OWN POSITION. This is the value a retained observation
      // can be compared with, and it is the only head this receipt's verification established — the
      // log's current head is `extension.currentHead`, reported only when the whole log re-derived.
      verifiedHead: entry.hash,
      // The two answers, side by side and never merged into one another.
      history: Object.freeze({
        verdict: 'verified',
        seq,
        entryHash: entry.hash,
        priorHead: prior,
        head: entry.hash,
        prefixLength: prefix.entries.length,
      }),
      extension,
      objectBytes: bytes.length,
      ceilings: MEMORY_OWNER_CEILINGS,
    })
  }

  /**
   * The read owner over this same store. It consults no grant and touches no
   * nonce: a question is free.
   * @param {{subject: string, policyRevision?: string, permittedPrivacy?: readonly string[]}} policy - subject and permitted privacy classes.
   * @returns {Readonly<Record<string, unknown>>} a read owner for the plugin.
   */
  function createReadOwner(policy) {
    return Object.freeze({
      async describe() {
        return {
          subject: policy.subject,
          policyRevision: policy.policyRevision ?? 'policy-1',
          permittedPrivacy: [...(policy.permittedPrivacy ?? ['local'])],
        }
      },
      async read() {
        // DAMAGED EVIDENCE IS AN INTEGRITY OUTCOME, NEVER AN EMPTY CORPUS.
        //
        // A store that failed once cannot certify what it did not fail on. If any
        // projection, object or chain entry is damaged, this returns
        // `undetermined` with a named reason rather than skipping the bad rows
        // and reporting `empty`: "I could not read the memory" and "there is
        // nothing matching" are different facts, and collapsing the first into
        // the second is the exact failure the read vocabulary exists to prevent.
        const chain = verifyChain()
        if (chain.ok !== true) return undetermined('memory-unverified', policy)

        const keysDir = join(stateDir, 'keys')
        let names = []
        if (existsSync(keysDir)) {
          try {
            names = readdirSync(keysDir).filter(name => name.endsWith('.json')).sort()
          } catch {
            return undetermined('memory-unavailable', policy)
          }
        }
        const records = []
        for (const name of names) {
          let projection
          try {
            projection = readJsonStrict(join(keysDir, name))
          } catch {
            return undetermined('memory-corrupt', policy)
          }
          if (projection === null || typeof projection !== 'object'
            || typeof projection.key !== 'string' || typeof projection.contentSha256 !== 'string') {
            return undetermined('memory-corrupt', policy)
          }
          const { key, contentSha256 } = projection
          const objectPath = join(stateDir, 'objects', `${contentSha256}.json`)
          if (!existsSync(objectPath)) return undetermined('memory-unverified', policy)
          // THE BYTES DECIDE, NOT THE PARSE. `readJsonStrictBytes` REFUSES a file that is not JSON — right for a
          // caller that needs a document, wrong here: a TRUNCATED object is one of the rewrites this check exists
          // to catch, and it was arriving as a thrown `json:malformed` instead of a named verdict, so the arm died
          // instead of measuring. MEASURED — that is the red the front door was showing.
          let bytes, parsedObject
          try {
            ({ bytes, value: parsedObject } = readJsonStrictBytes(objectPath, { label: 'the stored object' }))
          } catch (error) {
            if (String(error?.code) !== 'json:malformed') throw error
            // ONE READ, THEN THE DIGEST: the bytes come from the SAME file the parse failed on, so what the digest
            // comparison below answers is a fact about the bytes on disk and not about a second read of a file that
            // may have changed in between.
            bytes = readBytesStrict(objectPath, { label: 'the stored object' }).bytes
            parsedObject = undefined
          }
          // The content address is re-derived from the BYTES, not trusted, and not re-derived from a
          // re-encoding of the parsed record. That distinction is the whole check: a file rewritten
          // with different whitespace, reordered keys, a truncation, or another record's body parses
          // into something that can still re-stage to the right identifier, so only hashing the bytes
          // on disk catches it. MEASURED: all four of those rewrites are refused here, and the same
          // store reads `found` intact.
          if (createHash('sha256').update(bytes).digest('hex') !== contentSha256) {
            // ITS OWN NAME, BECAUSE IT IS ITS OWN FACT. `memory-unverified` already covers the object
            // being ABSENT (above) and the record inside not re-staging (below); a reader told only
            // "unverified" cannot tell a missing file from a substituted one, and those call for
            // different actions. `kira.recall:integrity` is this answer.
            return undetermined('integrity', policy)
          }
          // THE ADDRESS IS RIGHT AND THE FILE STILL DOES NOT PARSE: impossible for bytes this store wrote, and its
          // own named answer rather than a crash.
          if (parsedObject === undefined) return undetermined('memory-corrupt', policy)
          const stored = parsedObject
          if (stored === null || typeof stored !== 'object' || stored.key !== key) {
            return undetermined('memory-corrupt', policy)
          }
          const verdict = verifyKiraMemoryRecord(stored.value)
          if (verdict.verified !== true || verdict.record.recordId !== key) {
            return undetermined('memory-unverified', policy)
          }
          const record = verdict.record
          if (record.subject !== policy.subject) continue
          if (!(policy.permittedPrivacy ?? ['local']).includes(record.privacy)) continue
          const settled = chain.entries.find(entry => entry.key === key)
          if (settled === undefined) return undetermined('memory-unverified', policy)
          // Use the existing receipt verifier; a valid object and a rehashed chain alone
          // do not establish that this record was settled under a signed receipt.
          let receipt
          try {
            receipt = readJsonStrict(join(stateDir, `receipt-memory.put-${String(settled.sequence).padStart(3, '0')}.json`))
            const checked = verifyReceipt(receipt)
            if (checked.verdict !== 'verified' || checked.recordId !== key
              || checked.seq !== settled.sequence || checked.verifiedHead !== settled.hash
              || receipt.effectDigest !== contentSha256) return undetermined('memory-unverified', policy)
          } catch {
            return undetermined('memory-unverified', policy)
          }
          records.push({
            record,
            text: projectionOf(record),
            settlement: { issuedAt: receipt.issuedAt, approverDid: receipt.approval?.approverDid ?? null },
            citation: {
              recordId: key,
              contentSha256,
              auraSequence: settled.sequence,
              auraEntryHash: settled.hash,
              // The head comes from the chain just re-derived, not from a second
              // read that could disagree with it.
              verifiedHead: chain.head,
            },
          })
        }
        return {
          availability: records.length === 0 ? 'empty' : 'found',
          subject: policy.subject,
          policyRevision: policy.policyRevision ?? 'policy-1',
          projection: { name: 'kira-content-text', version: '1', digest: projectionDigest() },
          records,
        }
      },
    })
  }

  /**
   * Settle the record an operator authorization names, presenting BOTH the grant and the approval.
   *
   * The caller supplies the documents; the record travels beside them and is re-staged here, so the
   * bytes settled are the bytes authorized rather than whatever a caller claims. A caller offering a
   * different record is refused by the byte binding, and nothing is spent.
   *
   * THERE IS NO UNGOVERNED VARIANT OF THIS CALL. `settle()` itself refuses without an approval, so an
   * omission cannot be expressed: the approval is required, not defaulted, and a caller holding only
   * a grant has not yet earned a write.
   *
   * @param {Readonly<{authorization: unknown, approval: unknown, subject: string, approverDid?: string}>} command - the operator outputs. `subject` is MANDATORY: it is the expectation the approval is checked against, and a missing one used to fall back to the record's own subject, which made the check as strong as the caller's omission.
   * @returns {Readonly<Record<string, unknown>>} the settlement and its receipt.
   */
  /**
   * WHO MAY WRITE THE SETTLEMENT FILES — THE TWO-PRINCIPAL CUT, AND THE MODE IT RUNS IN TODAY.
   *
   * The design puts the settlement write path in an owner daemon: a dedicated `aukora-owner` macOS account
   * (root-owned LaunchDaemon, UserName=aukora-owner, code installed outside this checkout), with keys, the
   * ledger, the witness, the per-record decisions and the consumption markers under an owner-owned
   * directory. The agent — Electron and the lanes, Peter's uid — may SUBMIT exact bytes and may never
   * write those files.
   *
   * TWO SIGNALS, BOTH THE DAEMON'S, AND NEITHER ONE A CLAIMED FIELD:
   *   * the filesystem: if the directory's uid is not this process's euid, the OS will refuse the write
   *     anyway, and this function names that state before anything is attempted;
   *   * `settlement/OWNER-DAEMON`, a marker the daemon leaves in a directory the agent cannot write. On a
   *     real owner store the agent cannot create or remove it; on a store the agent CAN write, the marker
   *     is a declaration rather than a protection, which is why the uid check above is the real one.
   *
   * THE MODES ARE PRINTED, NOT IMPLIED: `OWNER_DAEMON` (this process IS the owner account),
   * `SAME_UID` (today's single-uid mode, where the same account writes everything and NOTHING below is a
   * boundary), and `OWNER_DAEMON_REQUIRED` (an owner-owned store reached from the agent side — refused).
   */
  function settleAuthority() {
    const euid = typeof process.geteuid === 'function' ? process.geteuid() : null
    let storeUid = null
    try { storeUid = statSync(settlementDir).uid } catch { storeUid = null }
    let account = null
    try { account = userInfo().username } catch { account = null }
    const ownerAccount = account === OWNER_ACCOUNT
    const foreignStore = storeUid !== null && euid !== null && storeUid !== euid
    const declared = existsSync(join(settlementDir, 'OWNER-DAEMON'))
    const ownerOwned = foreignStore || declared
    return Object.freeze({
      mode: ownerAccount ? 'OWNER_DAEMON' : (ownerOwned ? 'OWNER_DAEMON_REQUIRED' : 'SAME_UID'),
      euid, storeUid, account, declared, foreignStore,
    })
  }

  function settleAuthorized(command) {
    // ── ONLY THE OWNER DAEMON SETTLES AN OWNER-OWNED STORE, AND THERE IS NO FALLBACK ────────────────
    // Refused BEFORE the record is read, the grant verified, the approval examined or any marker spent:
    // a refusal here consumes nothing and writes nothing.
    const authority = settleAuthority()
    if (authority.mode === 'OWNER_DAEMON_REQUIRED') {
      refuse('SETTLE_REQUIRES_OWNER_DAEMON',
        `the settlement files belong to uid ${String(authority.storeUid)} and this process is uid `
        + `${String(authority.euid)} (${String(authority.account)}), so only the owner daemon running as `
        + `\`${OWNER_ACCOUNT}\` may settle them; the agent side has no settle path that writes here`)
    }
    if (command === null || typeof command !== 'object') {
      refuse('GRANT_MALFORMED', 'no operator authorization was supplied')
    }
    const { authorization, approval, subject, approverDid, activeControlDigest } = /** @type {Record<string, unknown>} */ (command)
    if (authorization === null || typeof authorization !== 'object') {
      refuse('GRANT_MALFORMED', 'the operator authorization carries no grant')
    }
    const { grant, record } = /** @type {Record<string, unknown>} */ (authorization)
    if (record === null || typeof record !== 'object') {
      refuse('RECORD_MALFORMED', 'the authorization carries no record to settle')
    }
    const verified = verifyKiraMemoryRecord(record)
    if (verified.verified !== true) refuse('RECORD_MALFORMED', `the authorized record does not verify: ${verified.reason}`)
    // RE-STAGE rather than trust the stored shape: `settle` applies
    // `memoryPut` arguments, and the only way to hold arguments that provably
    // belong to these bytes is to derive them from the bytes again.
    const staged = stageKiraMemoryRecord({
      subject: verified.record.subject,
      kind: verified.record.kind,
      source: verified.record.source,
      content: verified.record.content,
      links: verified.record.links,
      privacy: verified.record.privacy,
      createdAt: verified.record.createdAt,
      ...(verified.record.transform === undefined ? {} : { transform: verified.record.transform }),
    })
    if (staged.recordId !== verified.record.recordId) {
      refuse('RECORD_MALFORMED', 'the authorized record does not re-stage to its own identifier')
    }
    // THE SUBJECT IS MANDATORY AND IS NOT INFERRED. Falling back to the record's own subject (the
    // previous behaviour) meant an approval issued for a different subject settled whenever the
    // caller omitted the argument — the check was only as strong as the caller's silence.
    if (typeof subject !== 'string' || subject === '') {
      refuse('APPROVAL_INPUT_MALFORMED',
        'settling requires the subject this owner serves; it is the expectation the approval is checked against and is never inferred from the record')
    }
    // ── A PIN THE CALLER SUPPLIED IS EITHER USABLE OR A REFUSAL — NEVER SILENTLY DROPPED ──────────
    //
    // MEASURED DEFECT, found by a Codex reviewer agent's pass over the first version of this wiring: a
    // non-string or empty `activeControlDigest` fell through the `typeof … === 'string'` guard and the
    // settlement proceeded **UNPINNED**. A caller who tried to pin the control head and got the type
    // wrong therefore received the WEAKER check instead of an error — the exact fail-open shape this
    // change exists to close, reintroduced by the guard meant to apply it.
    //
    // The rule now: ABSENT is the unpinned ceiling, named on every verdict by `controlPinned: false`.
    // PRESENT-AND-UNUSABLE is a usage fault that refuses before anything is read or spent. `approverDid`
    // carried the identical guard and is fixed with it, because fixing one of two identical holes
    // leaves the other open and the asymmetry would be invisible.
    const pins = {}
    if (approverDid !== undefined) {
      if (typeof approverDid !== 'string' || approverDid === '') {
        refuse('APPROVAL_INPUT_MALFORMED',
          'approverDid was supplied and is not a non-empty string; a malformed pin is a usage fault, not an unpinned settlement')
      }
      pins.approverDid = approverDid
    }
    if (activeControlDigest !== undefined) {
      if (typeof activeControlDigest !== 'string' || activeControlDigest === '') {
        refuse('APPROVAL_INPUT_MALFORMED',
          'activeControlDigest was supplied and is not a non-empty string; a malformed pin is a usage fault, not an unpinned settlement')
      }
      pins.activeControlDigest = activeControlDigest
    }
    return settle(staged, grant, approval, { subject, ...pins })
  }

  /**
   * Read the operator-minted authorization from disk.
   *
   * This lives HERE, not in the plugin entry, because `memory-owner.mjs` is the
   * one module permitted to hold a filesystem route: a boundary that says "one
   * module touches the disk" is only true if the other modules really do not.
   *
   * @param {string} grantFile - path to the operator command's output.
   * @returns {unknown} the parsed authorization, or null when no file is present.
   */
  function readAuthorization(grantFile) {
    if (typeof grantFile !== 'string' || grantFile === '') {
      refuse('GRANT_UNCONFIGURED', 'no grantFile is configured for this composition')
    }
    if (!existsSync(grantFile)) return null
    try {
      const parsed = readJsonStrict(grantFile, { maxBytes: GRANT_APPROVAL_MAX_BYTES, label: grantFile })
      // ONE FILE MAY CARRY BOTH DOCUMENTS. A composition may name `grantFile` and `approvalFile` at
      // the same path, in which case the file is the operator bundle `{authorization, approval}` and
      // the grant is the `authorization` FIELD — not the whole document. The two are unwrapped
      // separately and never merged: reading the document whole would hand the settlement path a
      // grant-shaped object with no record in it, which is a refusal a reader could not diagnose.
      return parsed !== null && typeof parsed === 'object' && Object.hasOwn(parsed, 'authorization')
        ? parsed.authorization
        : parsed
    } catch (error) {
      refuse('GRANT_UNREADABLE', `the authorization file could not be read: ${error?.code ?? 'unreadable'}`)
    }
  }

  /**
   * Read the owner approval bundle from disk.
   *
   * The approval is the OWNER's act and travels in its own file, separate from the grant: one file
   * would let either document stand in for the other, and the whole point of this increment is that
   * they are two acts. Missing is `null` — a named refusal the tool turns into `approval-absent` —
   * and unreadable is its own refusal, because "nobody approved" and "the approval could not be read"
   * call for different actions.
   *
   * @param {string} approvalFile - path to the approval command's output.
   * @returns {unknown} the parsed bundle, or null when no file is present.
   */
  function readApproval(approvalFile) {
    if (typeof approvalFile !== 'string' || approvalFile === '') {
      refuse('APPROVAL_UNCONFIGURED', 'no approvalFile is configured for this composition')
    }
    if (!existsSync(approvalFile)) return null
    try {
      const parsed = readJsonStrict(approvalFile,
        { maxBytes: GRANT_APPROVAL_MAX_BYTES, label: approvalFile })
      // Same one-file-two-documents rule as `readAuthorization`: the approval is the `approval`
      // field when the file is the operator bundle, and the document itself otherwise. A bundle
      // nested twice is NOT unwrapped twice — `verifyApproval` refuses a record with an unknown
      // field, by name, which is the answer a caller needs.
      if (parsed !== null && typeof parsed === 'object' && Object.hasOwn(parsed, 'authorization')) {
        return parsed.approval
      }
      // A SHARED PATH MUST CARRY THE BUNDLE, and this is the floor under "they are two documents".
      // When the composition names ONE file for both, a document with no `authorization` field is the
      // GRANT — and returning it here offered the grant itself to the approval verifier: one document
      // standing in for two. Measured before this guard by the shared-path court (arm 2), which saw
      // `{"grant":{"kind":"aukora-kira-memory-grant/v1",…}}` returned as the approval. Two separate
      // paths keep the old behaviour below, where each file IS its own document.
      //
      // THE COURT'S PATH IS NOT NAMED HERE ON PURPOSE: a shipped module may not name a test path, and
      // the lane's own boundary court holds that by grepping every `lib/` source. The message below
      // therefore points at the OPERATOR command, which is what a person can actually run.
      if (sharedDocumentPath && approvalFile === options.grantFile) {
        refuse('APPROVAL_SHARED_FILE_NOT_A_BUNDLE',
          'grantFile and approvalFile name the same document, and that document is not the operator '
          + 'bundle: it carries no `authorization` field, so it is the grant and not an approval. Mint '
          + 'the operator bundle with the approval command, or name two separate files.')
      }
      return parsed
    } catch (error) {
      refuse('APPROVAL_UNREADABLE', `the approval file could not be read: ${error?.code ?? 'unreadable'}`)
    }
  }

  /**
   * Put one staged record in the pending queue, exactly once.
   *
   * THE RECORD IS RE-VERIFIED BEFORE ANY BYTE IS WRITTEN. A queue entry is what a person reads weeks
   * later and what an operator command mints a grant against, so the bytes that reach the disk are
   * bytes that verify — checked here at the boundary where they leave the turn, rather than assumed
   * from the fact that a tool called a staging function.
   *
   * @param {Readonly<{recordId: string, record: Readonly<Record<string, unknown>>}>} staged - output of `stageKiraMemoryRecord`.
   * @returns {Readonly<Record<string, unknown>>} the queue outcome: `queued` or `already-queued`.
   * @throws {MemoryOwnerRefusal} `QUEUE_ENTRY_UNREADABLE` when a name is taken by bytes that do not verify.
   */
  function enqueuePending(staged) {
    const entry = queueEntryFor(staged)
    const path = join(queueDir, `${entry.recordId}.json`)
    // ALREADY QUEUED IS NOT AN ERROR, AND IT IS NOT ASSUMED EITHER. The name is the digest of the record, so
    // re-staging the same bytes can only collide with itself: that is idempotent, and must not read as a duplicate
    // a reviewer has to de-duplicate by eye. A name already taken by bytes that do NOT verify is a different fact —
    // something else wrote there — so it is refused by name and never overwritten.
    //
    // IT IS ONE FUNCTION CALLED FROM TWO PLACES, because the collision now arrives as `exclusiveCreate`'s ANSWER
    // rather than as a caught `EEXIST`: duplicating this block in the `catch` as well would be two copies of a
    // verification that must not drift, and keeping ONLY the caught-`EEXIST` one would answer a real race with
    // `QUEUE_UNAVAILABLE` — the store is broken — when the truth is that the entry is already queued.
    const alreadyQueued = () => {
      let existing
      try {
        existing = readQueueEntry(readTextStrict(path))
      } catch {
        refuse('QUEUE_ENTRY_UNREADABLE', 'an entry already exists at this identifier and could not be read; it was not overwritten')
      }
      if (existing.state !== 'pending' || existing.entry.recordId !== entry.recordId) {
        refuse('QUEUE_ENTRY_UNREADABLE',
          `an entry already exists at this identifier and does not verify (${existing.reason ?? 'identity-mismatch'}); it was not overwritten`)
      }
      return Object.freeze({ state: 'already-queued', recordId: entry.recordId, dir: queueDir })
    }
    let created
    try {
      mkdirSync(queueDir, { recursive: true, mode: 0o700 })
      // DURABLE AND ATOMIC: temporary, fsync, LINK into place, directory fsync. The raw create-then-write this
      // replaces could be killed into an EMPTY entry — a queue file that reads as an entry and holds nothing.
      created = exclusiveCreate(path, queueEntryText(entry), { dir: queueDir, mode: 0o600 }).created
    } catch (error) {
      if (error?.code === 'EEXIST') return alreadyQueued()
      refuse('QUEUE_UNAVAILABLE', `the pending queue could not be written: ${error?.code ?? 'unknown'}`)
    }
    if (created !== true) return alreadyQueued()
    return Object.freeze({ state: 'queued', recordId: entry.recordId, dir: queueDir })
  }

  /**
   * Every pending entry this store holds, with unusable files NAMED rather than dropped.
   *
   * The listing is the one place a person looks to decide what to approve, so a tampered, truncated or
   * half-written file must appear as a row that says it is unusable. Skipping it would make a damaged
   * queue read as a shorter queue — the exact confusion this contract exists to prevent.
   *
   * @returns {Readonly<Record<string, unknown>>} the listing: `exists` false when nothing was ever queued, plus `total`, `returned`, `truncated` and `entries`.
   */
  function listPending() {
    let names
    try {
      if (!existsSync(queueDir)) {
        // NOT AN ERROR, AND NOT AN EMPTY QUEUE EITHER: the directory is created on first enqueue, so
        // its absence is the observation that nothing was ever staged for review in this store.
        return Object.freeze({ dir: queueDir, exists: false, total: 0, returned: 0, pending: 0, truncated: false, entries: Object.freeze([]) })
      }
      names = readdirSync(queueDir).filter(name => name.endsWith('.json')).sort()
    } catch (error) {
      refuse('QUEUE_UNAVAILABLE', `the pending queue could not be read: ${error?.code ?? 'unknown'}`)
    }
    const total = names.length
    const shown = names.slice(0, MAX_QUEUE_LIST)
    const entries = shown.map((name) => {
      // THE FILESYSTEM'S OWN CLOCK, never a clock this module reads. The record carries a
      // caller-supplied `createdAt`, which is a claim; this is when the file was last written, which is
      // an observation. They travel in differently-named fields because they are different facts.
      let mtimeMs
      try {
        mtimeMs = statSync(join(queueDir, name)).mtimeMs
      } catch {
        mtimeMs = undefined
      }
      let text
      try {
        text = readTextStrict(join(queueDir, name))
      } catch {
        return Object.freeze({ state: 'unreadable', name, reason: 'unreadable' })
      }
      const decoded = readQueueEntry(text)
      if (decoded.state !== 'pending') return Object.freeze({ state: 'unreadable', name, reason: decoded.reason })
      // SETTLED IS DERIVED FROM THE STORE, so the queue is self-cleaning by observation and there is no
      // dequeue action: a record the store already holds stops asking to be approved, and nothing has to
      // be deleted for that to be true. The `keys/` projection is the store's own record of what it
      // wrote, so this reads the same fact the read path reads rather than a second bookkeeping.
      const settled = existsSync(join(stateDir, 'keys', `${decoded.entry.recordId}.json`))
      // DECLINED IS ANSWERED PER RECORD, from the CONTENT-scoped document, because that is the only one
      // that can: the decision marker is grant-scoped, a grant is minted per attempt, and a row still
      // pending has no grant at all.
      const declined = isDeclined(kiraRecordContentSha256(decoded.entry.record))
      return queueRowOf(decoded.entry, mtimeMs, settled, declined)
    })
    return Object.freeze({
      dir: queueDir,
      exists: true,
      total,
      returned: entries.length,
      // HOW MUCH IS ACTUALLY WAITING FOR A PERSON. `total` counts FILES, which is the right number for
      // "was anything damaged or dropped"; `pending` counts what still needs a decision, which is the
      // number a reviewer acts on. Collapsing them would make a fully-settled queue read as a backlog.
      pending: entries.filter(row => row.state === 'pending').length,
      // A LISTING THAT STOPPED AT THE BOUND SAYS SO. A silently truncated review queue is a queue whose
      // remaining entries a person will never be shown, which is indistinguishable from having none.
      truncated: total > entries.length,
      entries: Object.freeze(entries),
    })
  }

    /**
   * *** EVERY PENDING ENTRY WITH THE EXACT BYTES THE OWNER WOULD BE APPROVING. ***
   *
   * WHY THIS IS NOT `listPending()`. That listing returns ROWS built for a reviewer scanning a queue: ids, states and a
   * short review text. *A settle does not bind a row, it binds BYTES* — so a screen built from rows would show the owner
   * one sentence and hand the settle a different document, which is the failure the approvals queue's own header names.
   * *** SO THE BYTES TRAVEL, and the screen renders them; a row's `review` is a convenience beside them, never instead of
   * them. ***
   *
   * IT IS ADDITIVE, NOT A SECOND LISTING. Same directory, same `readQueueEntry` verification, same refusal to drop a file
   * that does not verify — `listPending` keeps its shape because a client already reads it.
   *
   * @returns {Readonly<Record<string, unknown>>} `entries`, each carrying `recordId` and its own `bytes`.
   */
  function pendingWithBytes() {
    let names
    try {
      if (!existsSync(queueDir)) {
        return Object.freeze({ dir: queueDir, exists: false, total: 0, returned: 0, pending: 0, truncated: false, entries: Object.freeze([]) })
      }
      names = readdirSync(queueDir).filter(name => name.endsWith('.json')).sort()
    } catch (error) {
      refuse('QUEUE_UNAVAILABLE', `the pending queue could not be read: ${error?.code ?? 'unknown'}`)
    }
    const total = names.length
    const shown = names.slice(0, MAX_QUEUE_LIST)
    const entries = []
    for (const name of shown) {
      let text
      try {
        text = readTextStrict(join(queueDir, name))
      } catch {
        // *** A FILE THAT CANNOT BE READ IS A NAMED ROW, NEVER A DROPPED ONE. *** *Skipping it would make a damaged queue
        // read as a shorter queue, and the owner would approve what is left believing he had seen everything.*
        entries.push(Object.freeze({ state: 'unreadable', name, reason: 'unreadable', bytes: null }))
        continue
      }
      const decoded = readQueueEntry(text)
      if (decoded.state !== 'pending') {
        entries.push(Object.freeze({ state: 'unreadable', name, reason: decoded.reason, bytes: null }))
        continue
      }
      // SETTLED AND DECLINED ARE DERIVED FROM THE STORE, exactly as `listPending` derives them, so the queue is
      // self-cleaning by observation and the two listings cannot disagree about what is still waiting.
      if (existsSync(join(stateDir, 'keys', `${decoded.entry.recordId}.json`))) continue
      if (isDeclined(kiraRecordContentSha256(decoded.entry.record))) continue
      entries.push(Object.freeze({
        state: 'pending',
        recordId: decoded.entry.recordId,
        // *** THE EXACT BYTES — the document the settle binds, and the only thing the owner can actually judge. ***
        bytes: text,
        subject: decoded.entry.subject ?? null,
        kind: decoded.entry.kind ?? null,
        createdAt: decoded.entry.createdAt ?? null,
        privacy: decoded.entry.privacy ?? null,
        record: decoded.entry.record,
      }))
    }
    return Object.freeze({
      dir: queueDir, exists: true, total, returned: entries.length,
      pending: entries.filter(row => row.state === 'pending').length,
      truncated: total > entries.length,
      entries: Object.freeze(entries),
    })
  }

/**
   * One queued entry by identifier, or the named reason it could not be established.
   *
   * Three answers and none of them is silence: `pending` with the verified record, `unreadable` with
   * the reason, or `absent` — which is a real answer about a name, not a failure to read.
   *
   * @param {string} recordId - the deterministic record identifier.
   * @returns {Readonly<Record<string, unknown>>} the entry or the named reason.
   */
  function readPending(recordId) {
    if (typeof recordId !== 'string' || !KIRA_RECORD_ID.test(recordId)) {
      refuse('QUEUE_ID_INVALID', 'a queue lookup needs a deterministic KIRA record identifier')
    }
    const path = join(queueDir, `${recordId}.json`)
    if (!existsSync(path)) return Object.freeze({ state: 'absent', recordId })
    let text
    try {
      text = readTextStrict(path)
    } catch (error) {
      return Object.freeze({ state: 'unreadable', recordId, reason: error?.code ?? 'unreadable' })
    }
    const decoded = readQueueEntry(text)
    if (decoded.state !== 'pending') return Object.freeze({ state: 'unreadable', recordId, reason: decoded.reason })
    // Settled is derived here too, so `show` cannot report a record as awaiting a decision the store has
    // already recorded making — and declined likewise, from the same content-scoped document.
    const settled = existsSync(join(stateDir, 'keys', `${decoded.entry.recordId}.json`))
    const declined = isDeclined(kiraRecordContentSha256(decoded.entry.record))
    return Object.freeze({ state: 'pending', recordId, settled, declined, entry: decoded.entry })
  }

  // ── THE LATEST HUMAN DECISION (R4) ──────────────────────────────────────────────────────────────
  // A decline must be able to SUPERSEDE a signed approval that was already minted. Nothing else in
  // this module can do that: an approval is one-use and content-bound, so once it exists the only
  // thing that stops it is a later statement about the same grant. That statement is a DECISION
  // marker, and it is the reason this module reads one more file before it spends anything.
  //
  // TWO DOCUMENTS, TWO SCOPES, and that split is the point rather than duplication:
  //   the DECISION marker binds the GRANT fingerprint — it gates the transition, and a marker for an
  //     old grant is stale and must not shadow a freshly minted one;
  //   the DECLINED document binds the CONTENT digest — it is the audit answer to "was this record
  //     declined?", which is a question about bytes and not about a nonce.
  // THE DECLINED DOCUMENT *IS* THE GATE (CHANGED 2026-09-25, and this comment with it): one file per
  // record, keyed by content digest, read by `settleAuthorized` before anything is consumed. It was
  // "evidence, never a gate" while a single decision marker did the refusing — and that marker is
  // replaced on every write, so it could speak for only the most recent record and a later `approved`
  // wiped an earlier decline. A gate that the next unrelated decision erases is not a gate. The
  // document is still audit evidence as well, and it is written before the marker so a crash between the
  // two leaves the refusal in force rather than the approval. The
  // approval file is left exactly as it was: a decline is a later fact about an operation, not an
  // erasure of an earlier one, and an audit that rewrites itself is not an audit.
  const settlementDir = join(queueDir, 'settlement')
  const decisionPath = join(settlementDir, 'decision.json')
  const declinedPath = join(settlementDir, 'declined.json')

  /**
   * The fingerprint a decision marker binds. Deterministic over the whole grant, so the nonce, the
   * effect digest and the expiry all travel in it and no two grants share one.
   * @param {unknown} grant - a grant this owner minted.
   * @returns {string} lowercase hex sha256 of the grant's canonical encoding.
   */
  function grantFingerprint(grant) {
    return createHash('sha256').update(canonicalJSON(grant), 'utf8').digest('hex')
  }

  /**
   * Read the latest decision, or the named reason it could not be established.
   *
   * `absent` is a real answer and the common one: no decision has been recorded. An unreadable marker
   * is NOT absent — a store whose gate cannot be read must not settle as though nothing were written —
   * so it is returned as its own state and the settle path refuses on it.
   * @returns {Readonly<Record<string, unknown>>} `{state: 'absent'}` | `{state: 'unreadable', reason}` | `{state: 'declared', decision, grantDigest, decidedAt}`.
   */
  function readDecision() {
    if (!existsSync(decisionPath)) return Object.freeze({ state: 'absent' })
    let marker
    try {
      marker = readJsonStrict(decisionPath)
    } catch {
      return Object.freeze({ state: 'unreadable', reason: 'not-json' })
    }
    if (marker === null || typeof marker !== 'object' || Array.isArray(marker)
      || marker.kind !== DECISION_KIND || (marker.decision !== 'declined' && marker.decision !== 'approved')
      || typeof marker.grantDigest !== 'string' || !/^[0-9a-f]{64}$/.test(marker.grantDigest)) {
      return Object.freeze({ state: 'unreadable', reason: 'not-a-decision' })
    }
    return Object.freeze({
      state: 'declared',
      decision: marker.decision,
      grantDigest: marker.grantDigest,
      // THE BYTES THE DECISION IS ABOUT, CARRIED TO THE GATE. Left out of this view at first, which made
      // the gate's byte branch read `undefined` and never fire — a writer and a reader that disagree
      // about a field is the same defect one layer down. Validated like the other fields: a marker whose
      // digest is not a 64-character hex string has no byte binding rather than a broken one.
      contentDigest: typeof marker.contentDigest === 'string' && /^[0-9a-f]{64}$/.test(marker.contentDigest)
        ? marker.contentDigest
        : null,
      decidedAt: typeof marker.decidedAt === 'number' ? marker.decidedAt : null,
    })
  }

  /**
   * The latest decision ABOUT ONE RECORD, keyed by the sha256 of its effect body.
   *
   * Distinct from `readDecision`, which answers "what was decided most recently anywhere" — the question
   * a per-record gate must not ask. Absent for a store written before these files existed, which is why
   * the marker's own grant rule is still checked.
   */
  function readDecisionFor(contentDigest) {
    const file = join(settlementDir, 'decision', `${String(contentDigest)}.json`)
    if (!existsSync(file)) return Object.freeze({ state: 'absent' })
    let marker
    try {
      marker = readJsonStrict(file)
    } catch {
      return Object.freeze({ state: 'unreadable', reason: 'not-json' })
    }
    if (marker === null || typeof marker !== 'object' || Array.isArray(marker)
      || marker.kind !== DECISION_KIND || (marker.decision !== 'declined' && marker.decision !== 'approved')
      || marker.contentDigest !== contentDigest) {
      return Object.freeze({ state: 'unreadable', reason: 'not-a-decision-for-these-bytes' })
    }
    return Object.freeze({ state: 'declared', decision: marker.decision, decidedAt: typeof marker.decidedAt === 'number' ? marker.decidedAt : null })
  }

  /**
   * Record one decision as the latest, atomically.
   *
   * TEMP FILE PLUS RENAME, because this file is REPLACED rather than created: `O_CREAT|O_EXCL` (the
   * discipline the one-use stores use) cannot express "the newest decision wins", and a plain write
   * leaves a window in which a concurrent settle could read a half-written marker. Rename is atomic
   * within a filesystem, so a reader sees the old marker or the new one and never a torn one.
   * @param {unknown} grant - the grant this decision is about.
   * @param {'declined'|'approved'} decision - the decision.
   * @param {number} at - unix seconds, caller-supplied so no clock is read here.
   * @returns {Readonly<Record<string, unknown>>} the marker that was written.
   */
  function writeDecision(grant, decision, at, contentDigest) {
    if (decision !== 'declined' && decision !== 'approved') {
      refuse('DECISION_INVALID', 'a decision is either declined or approved')
    }
    const marker = {
      kind: DECISION_KIND,
      grantDigest: grantFingerprint(grant),
      // ── WHICH BYTES THIS DECISION IS ABOUT (MEASURED 2026-09-24 ON THE LIVE STORE) ────────────────
      // The marker used to name only the GRANT, so a decline was a statement about one grant rather
      // than about the record it was asked to decline: declining two never-prepared entries wrote a
      // marker binding a stored grant that belonged to neither, and neither decline could refuse a
      // settle of the bytes it named. A decision that cannot stop the thing it decided about is not a
      // decision. Carried when the caller knows the bytes; absent markers keep their old meaning.
      ...(typeof contentDigest === 'string' && contentDigest !== '' ? { contentDigest } : {}),
      decision,
      decidedAt: at,
    }
    const temporary = `${decisionPath}.${String(process.pid)}.tmp`
    try {
      mkdirSync(settlementDir, { recursive: true, mode: 0o700 })
      // ── NO SINGLETON WRITE WHEN THE DECISION NAMES ITS BYTES (2026-09-25) ─────────────────────────
      // `decision.json` holds the LATEST DECISION ANYWHERE, so a second decline OVERWROTE the first: the
      // file could not outlive the next unrelated decision, and which grant had been superseded was lost
      // with it. Every operator decision now names the bytes it is about, so the singleton is written ONLY
      // by the older three-argument callers, and the per-record file below is the record of what was
      // decided. The legacy file is still READ by the gate, so a store written before these files existed
      // keeps its decisions — and the live file is left in place rather than deleted, because deleting
      // evidence is not how this lane retires a path.
      if (typeof marker.contentDigest !== 'string') {
        durableWrite(decisionPath, `${canonicalJSON(marker)}\n`, { dir: dirname(decisionPath), mode: 0o600 })
      }
      // PER RECORD, keyed by the bytes the decision is about. THIS is what the gate reads; the per-grant
      // overwrite below keeps the older three-argument callers answering for the bytes they named.
      const decisionDir = join(settlementDir, 'decision')
      if (typeof marker.contentDigest === 'string') {
        mkdirSync(decisionDir, { recursive: true, mode: 0o700 })
        const perRecord = join(decisionDir, `${marker.contentDigest}.json`)
        const tmpRecord = `${perRecord}.${String(process.pid)}.tmp`
        durableWrite(perRecord, `${canonicalJSON(marker)}\n`, { dir: dirname(perRecord), mode: 0o600 })
      } else if (existsSync(decisionDir)) {
        // A DECISION THAT NAMES NO BYTES STILL WINS FOR THE GRANT IT NAMES. The three-argument form is the
        // documented one, and `kira-decline` uses it for R4's "the later decision wins" — a caller that
        // cannot name the bytes must not be shadowed by a per-record file it has no way to reach. So any
        // per-record decision recorded by THIS grant is overwritten with this one, keeping the digest it
        // was filed under: the bytes keep an answer, and the answer is the latest thing said about them.
        for (const name of readdirSync(decisionDir)) {
          const file = join(decisionDir, name)
          try {
            const prior = readJsonStrict(file)
            if (prior !== null && typeof prior === 'object' && prior.grantDigest === marker.grantDigest
              && typeof prior.contentDigest === 'string') {
              durableWrite(file, `${canonicalJSON({ ...marker, contentDigest: prior.contentDigest })}\n`,
                { dir: dirname(file), mode: 0o600 })
            }
          } catch {
            // An unreadable per-record decision is not this caller's to clear, and the marker above still
            // carries this decision for every reader that asks the latest-decision question.
          }
        }
      }
    } catch (error) {
      refuse('DECISION_UNAVAILABLE', `the decision could not be recorded: ${error?.code ?? 'unknown'}`)
    }
    return Object.freeze(marker)
  }

  /**
   * Write the declined document: the audit answer for the CONTENT, never a gate.
   * @param {{key: string, value: unknown}} memoryPut - the effect that was declined.
   * @returns {Readonly<Record<string, unknown>>} the document written.
   */
  function writeDeclined(memoryPut) {
    const document = Object.freeze({
      kind: DECLINED_KIND,
      proposalDigest: createHash('sha256').update(memoryEffectBody(memoryPut), 'utf8').digest('hex'),
    })
    try {
      mkdirSync(settlementDir, { recursive: true, mode: 0o700 })
      const temporary = `${declinedPath}.${String(process.pid)}.tmp`
      durableWrite(declinedPath, `${canonicalJSON(document)}\n`, { dir: dirname(declinedPath), mode: 0o600 })
      // PER RECORD, because the single slot above made a decline of B un-decline A: the review row reads
      // its state from this evidence, so declining a second record returned the first to `pending`. The
      // legacy single file is still written for readers of the old shape and still read below.
      const perRecordDir = join(settlementDir, 'declined')
      mkdirSync(perRecordDir, { recursive: true, mode: 0o700 })
      durableWrite(join(perRecordDir, `${document.proposalDigest}.json`), `${canonicalJSON(document)}\n`,
        { dir: perRecordDir, mode: 0o600 })
    } catch (error) {
      refuse('DECISION_UNAVAILABLE', `the declined document could not be written: ${error?.code ?? 'unknown'}`)
    }
    return document
  }

  /**
   * Whether one record's BYTES have been declined, from the content-scoped document.
   * @param {string} contentSha256 - the record's effect-body digest.
   * @returns {boolean} true when the declined document names exactly these bytes.
   */
  function isDeclined(contentSha256) {
    // THE RECORD'S OWN EVIDENCE FIRST, then the legacy slot, so a store written before this change is
    // still read and a store written after it cannot lose one record's decline to another's.
    const perRecord = join(settlementDir, 'declined', `${String(contentSha256)}.json`)
    if (existsSync(perRecord)) {
      try {
        const document = readJsonStrict(perRecord)
        if (document !== null && typeof document === 'object'
          && document.kind === DECLINED_KIND && document.proposalDigest === contentSha256) return true
      } catch {
        // fall through to the legacy slot; an unreadable audit document gates nothing
      }
    }
    if (!existsSync(declinedPath)) return false
    try {
      const document = readJsonStrict(declinedPath)
      return document !== null && typeof document === 'object'
        && document.kind === DECLINED_KIND && document.proposalDigest === contentSha256
    } catch {
      // An unreadable audit document is not a decline. It also cannot gate anything — only the marker
      // can — so a damaged document degrades to "not declined" rather than blocking a write.
      return false
    }
  }

  return Object.freeze({
    stateDir,
    queueDir,
    grantFingerprint,
    readDecision,
    writeDecision,
    writeDeclined,
    isDeclined,
    enqueuePending,
    listPending,
    pendingWithBytes,
    readPending,
    settleAuthorized,
    settleAuthority,
    readAuthorization,
    readApproval,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    grantFor,
    verifyGrant,
    settle,
    verifyReceipt,
    verifyApproval,
    createReadOwner,
    head: readHead,
    settleable: KIRA_SETTLEMENT_AVAILABLE,
    ceilings: MEMORY_OWNER_CEILINGS,
  })
}

/**
 * The retrieval-text projection this owner applies to a stored record.
 * @param {Readonly<Record<string, unknown>>} record - a verified record.
 * @returns {string} the projection text.
 */
export function projectionOf(record) {
  const content = /** @type {Record<string, unknown>} */ (record.content)
  if (content !== null && typeof content === 'object' && !Array.isArray(content) && typeof content.note === 'string') {
    return content.note
  }
  return typeof record.content === 'string' ? record.content : canonicalJSON(record.content)
}

/** Digest of the projection rule, so a citation names which rendering matched. */
export function projectionDigest() {
  return createHash('sha256').update('kira-content-text/1: content.note else canonical content', 'utf8').digest('hex')
}
