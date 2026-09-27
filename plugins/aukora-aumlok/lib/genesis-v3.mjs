/**
 * THE GENESIS: what the subject is made of, and why it survives a refresh.
 *
 * WHY THIS MODULE EXISTS. `derive-v3.mjs` built `subject: aukora:1:<rootId>` — the CURRENT key. That
 * is the one thing a subject must not be. The Kira memory chain is pinned to the subject, so a subject
 * made of the current key does not rotate with a refresh, it ABANDONS the chain: every record settled
 * under the old subject becomes unreachable by the identity that wrote it, and the person sees an
 * empty queue with nothing anywhere reporting an error. That failure is silent and arrives on the day
 * the memory matters.
 *
 * THE PLAN'S WORDING, WHICH THIS MODULE IMPLEMENTS LITERALLY (PLAN CHANGE 2026-09-23 10:20, item 2):
 *
 *   subject = aukora:1:<sha256(genesis)>
 *   genesis = the epoch-0 public root + the genesis nonce
 *   carried UNCHANGED across refreshes
 *   rootId names only the CURRENT keys
 *
 * THE SUBJECT DIGEST IS THE ONE ALREADY PORTED, NOT A NEW ONE. `genesis.mjs` carries Deep's
 * `aukoraIdFromGenesis` — `sha256("aukora:identity-subject:v1" || 0x00 || canonicalJSON(genesis))` —
 * ported with its domain strings unchanged so an identifier computed here equals the one Deep computes
 * for the same genesis. A second subject derivation in v3 would be a second opinion about the one
 * value the whole memory chain hangs from, so this module COMPOSES the v3 genesis into the shape that
 * function already hashes rather than hashing anything itself.
 *
 * WHAT IS IN THE GENESIS, IN FULL: the epoch-0 Ed25519 and ML-DSA-65 public keys, the suite, the
 * moment of the binding, the genesis nonce, and the amendment-rule digest. WHAT IS NOT: any later
 * key, any epoch number, any control head, any machine. Those all move; the genesis does not, and
 * that is the entire point.
 *
 * @module @aukora/dsh-plugin-aumlok/genesis-v3
 */
import { createHash } from 'node:crypto'
import { canonicalJSON } from './canonical.mjs'
import {
  AUKORA_ID_PREFIX,
  IDENTITY_GENESIS_DOMAIN,
  aukoraIdFromGenesis,
} from './genesis.mjs'
import {
  LOCAL_AUMLOK_AMENDMENT_POLICY,
  localAumlokAmendmentRuleDigest,
} from './store.mjs'

/** Domain separation for a v3 genesis reference. Distinct from the subject's, on purpose. */
export const V3_GENESIS_REF_DOMAIN = 'aukora:aumlok-genesis-ref:v3'

/** Domain of the v3 genesis record, so a v3 genesis cannot be read as a v1 one. */
export const V3_GENESIS_DOMAIN = 'aukora:aumlok-genesis:v3'

const DIGEST = /^[0-9a-f]{64}$/u
const LOWER_HEX = /^[0-9a-f]+$/u
const REF24 = /^[0-9a-f]{24}$/u

/**
 * Refusals this module produces by name.
 *
 * EVERY ONE IS A REFUSAL RATHER THAN A DEFAULT, because the alternative to each is a genesis that
 * silently changed and a chain nobody can read.
 */
export const GENESIS_V3_REFUSE = Object.freeze({
  ROOT_MALFORMED: 'aumlok:genesis-root-malformed',
  NONCE_MALFORMED: 'aumlok:genesis-nonce-malformed',
  CARRIED_MALFORMED: 'aumlok:genesis-carried-malformed',
  NONCE_MOVED: 'aumlok:genesis-nonce-moved-on-refresh',
})

/** A genesis this module will not build. */
export class GenesisV3Error extends TypeError {
  /**
   * @param {string} code - one {@link GENESIS_V3_REFUSE} value.
   * @param {string} detail - the observed defect.
   */
  constructor(code, detail) {
    super(`${code}: ${detail}`)
    this.name = 'GenesisV3Error'
    this.code = code
  }
}

/**
 * The genesis reference: a short, stable name for THIS genesis.
 *
 * IT IS DERIVED FROM THE SUBJECT, NOT FROM THE CURRENT KEYS. The v2-era `deriveGenesisRef({rootId,
 * boundAt})` was documented as "changes if either changes" — which is exactly what a reference carried
 * across refreshes may not do, and it is the defect this module replaces. Both values change on
 * refresh; the subject does not, so the subject is what this hashes.
 * @param {string} subject - the `aukora:1:<64 hex>` subject.
 * @returns {string} 24 lowercase hex characters.
 */
export function genesisRefFromSubject(subject) {
  return createHash('sha256')
    .update(V3_GENESIS_REF_DOMAIN, 'utf8')
    .update('\0', 'utf8')
    .update(subject, 'utf8')
    .digest('hex')
    .slice(0, 24)
}

/**
 * The genesis record for one epoch-0 root, in the shape the ported subject derivation hashes.
 * @param {{root: object, genesisNonce: string}} input - the epoch-0 root and the nonce.
 * @returns {Readonly<object>} the closed genesis record.
 */
function genesisRecordFor({ root, genesisNonce }) {
  // THE TWO PUBLIC KEYS ARE NOT THE SAME LENGTH, and assuming they were is what a first cut of this
  // check got wrong: Ed25519 is 32 bytes (64 hex) while ML-DSA-65 is 1952 bytes (3904 hex). A
  // `^[0-9a-f]{64}$` test on both refuses every real root — measured, `aumlok:genesis-root-malformed`
  // on a root that had just been derived — so the digest grammar is applied to the VALUES THAT ARE
  // digests (rootId, nonce) and the keys are held to lowercase hex of a plausible length.
  if (typeof root !== 'object' || root === null
    || typeof root.ed25519PublicKeyHex !== 'string' || !DIGEST.test(root.ed25519PublicKeyHex)
    || typeof root.mlDsa65PublicKeyHex !== 'string' || !LOWER_HEX.test(root.mlDsa65PublicKeyHex)
    || root.mlDsa65PublicKeyHex.length < 64
    || typeof root.suite !== 'string' || root.suite.length === 0
    || typeof root.rootId !== 'string' || !DIGEST.test(root.rootId)) {
    throw new GenesisV3Error(GENESIS_V3_REFUSE.ROOT_MALFORMED,
      'a genesis needs the epoch-0 root: suite, rootId (64 hex), a 64-hex Ed25519 key and the raw '
      + 'ML-DSA-65 public key in hex')
  }
  if (typeof genesisNonce !== 'string' || !DIGEST.test(genesisNonce)) {
    throw new GenesisV3Error(GENESIS_V3_REFUSE.NONCE_MALFORMED,
      'the genesis nonce must be 32 bytes of hex; it is the entropy that makes two installations '
      + 'with the same words into two identities')
  }
  // THE COMMITTED EPOCH-0 BYTES, IN A CLOSED RECORD. These are hashed into the subject; nothing
  // outside this object is. `initialRootKeySetId` is the epoch-0 rootId because that is what names
  // the first key set, and `amendmentRuleDigest` is the digest of the one policy this lane supports,
  // re-derived from the policy itself so an edited policy no longer reproduces its own commitment.
  return Object.freeze({
    domain: IDENTITY_GENESIS_DOMAIN,
    genesisNonce,
    initialRootKeySetId: root.rootId,
    amendmentRuleDigest: localAumlokAmendmentRuleDigest(LOCAL_AUMLOK_AMENDMENT_POLICY),
  })
}

/**
 * Build the genesis a first binding establishes, or CARRY the one a refresh must not change.
 *
 * THE TWO CALLS ARE DIFFERENT ON PURPOSE, AND THE DIFFERENCE IS THE WHOLE ITEM:
 *
 *   FIRST BINDING  `buildGenesisV3({ root, genesisNonce })` — the epoch-0 root and a fresh nonce
 *                  establish the subject. This is the only call that may invent one.
 *   REFRESH        `buildGenesisV3({ root, genesisNonce, carried })` — `carried` is the genesis the
 *                  binding already published, and the subject, the reference and the committed
 *                  epoch-0 root all come from IT. The new root supplies only `rootId` and the keys,
 *                  which is what "rootId names only the current keys" means.
 *
 * A CARRIED GENESIS WHOSE NONCE THE CALLER CHANGED IS REFUSED. That is the one way a refresh could
 * silently re-name the identity — by passing its own nonce and getting a new subject that looks like a
 * successful refresh — so it is a named refusal rather than something a caller can do by accident.
 * @param {{root: object, genesisNonce?: string, carried?: object}} input - the current root, the nonce
 *   for a first binding, and the genesis to carry on a refresh.
 * @returns {Readonly<object>} the genesis: subject, genesisRef, the committed epoch-0 root and nonce,
 *   and the current keys' rootId.
 */
export function buildGenesisV3({ root, genesisNonce, carried } = /** @type {never} */ ({})) {
  if (carried !== undefined) {
    if (typeof carried !== 'object' || carried === null
      || typeof carried.subject !== 'string' || !carried.subject.startsWith(AUKORA_ID_PREFIX)
      || typeof carried.genesisNonce !== 'string' || !DIGEST.test(carried.genesisNonce)
      || typeof carried.genesisRef !== 'string' || !REF24.test(carried.genesisRef)
      || typeof carried.genesis !== 'object' || carried.genesis === null) {
      throw new GenesisV3Error(GENESIS_V3_REFUSE.CARRIED_MALFORMED,
        'a carried genesis must carry the subject, the reference, the nonce and the committed record')
    }
    if (genesisNonce !== undefined && genesisNonce !== carried.genesisNonce) {
      throw new GenesisV3Error(GENESIS_V3_REFUSE.NONCE_MOVED,
        'a refresh passed a NEW genesis nonce, which would re-name the identity: the nonce belongs to '
        + 'the first binding and is carried, never re-invented')
    }
    if (typeof root !== 'object' || root === null || typeof root.rootId !== 'string'
      || !DIGEST.test(root.rootId)) {
      throw new GenesisV3Error(GENESIS_V3_REFUSE.ROOT_MALFORMED, 'a refresh needs the new root')
    }
    // THE SUBJECT IS RE-DERIVED FROM THE CARRIED RECORD rather than copied, so a carried genesis whose
    // subject did not match its own bytes cannot be laundered through this function.
    const resealed = aukoraIdFromGenesis(carried.genesis)
    if (resealed !== carried.subject) {
      throw new GenesisV3Error(GENESIS_V3_REFUSE.CARRIED_MALFORMED,
        `the carried genesis hashes to ${resealed}, not to the subject it names (${carried.subject})`)
    }
    return Object.freeze({
      domain: V3_GENESIS_DOMAIN,
      subject: carried.subject,
      genesisRef: carried.genesisRef,
      genesisNonce: carried.genesisNonce,
      genesis: carried.genesis,
      rootId: root.rootId,
      suite: root.suite,
      carried: true,
    })
  }

  const genesis = genesisRecordFor({ root, genesisNonce })
  const subject = aukoraIdFromGenesis(genesis)
  return Object.freeze({
    domain: V3_GENESIS_DOMAIN,
    subject,
    genesisRef: genesisRefFromSubject(subject),
    genesisNonce,
    genesis,
    rootId: root.rootId,
    suite: root.suite,
    carried: false,
  })
}

/**
 * The subject of one genesis, recomputed from its own bytes.
 * @param {unknown} carried - a genesis from {@link buildGenesisV3}.
 * @returns {string} the `aukora:1:<64 hex>` subject.
 */
export function subjectFromGenesis(carried) {
  if (typeof carried !== 'object' || carried === null || typeof carried.genesis !== 'object') {
    throw new GenesisV3Error(GENESIS_V3_REFUSE.CARRIED_MALFORMED, 'subjectFromGenesis needs a genesis')
  }
  return aukoraIdFromGenesis(carried.genesis)
}

/**
 * Whether a parsed value is a v3 genesis.
 * @param {unknown} value - candidate.
 * @returns {boolean} true when it carries a subject, a reference and a committed record.
 */
export function isGenesisV3(value) {
  return value !== null && typeof value === 'object' && value.domain === V3_GENESIS_DOMAIN
    && typeof value.subject === 'string' && value.subject.startsWith(AUKORA_ID_PREFIX)
    && typeof value.genesisRef === 'string' && REF24.test(value.genesisRef)
    && typeof value.genesis === 'object' && value.genesis !== null
    && canonicalJSON(value.genesis).length > 0
}
