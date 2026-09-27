/**
 * Immutable genesis identity for a stable AUKORA subject.
 *
 * PORTED FROM Deep `aukora/identity/genesis.mjs` at
 * `c417f7c5752bf14b8e927986cd995f2e086f4189`, with the domain strings and the
 * subject preimage unchanged so an identifier computed here equals the one Deep
 * computes for the same genesis. `scripts/aumlok/PROVENANCE.md` records the port
 * and `tests/aukora-aumlok.test.mjs` measures the equality against a subject Deep
 * itself derived at that pin.
 *
 * THE POINT OF THIS MODULE. The subject is `sha256` over the immutable genesis
 * record and nothing else. Not over a key, not over an epoch, not over a control
 * head. So a root-key rotation, a revocation, or a new delegation cannot move the
 * subject: they change the control head, which is a different record with a
 * different digest. That is the property D1 depends on when it says "Changing the
 * registered key changes its did:key; continuity and revocation are separate
 * signed policy/history claims".
 *
 * WHAT THIS DOES NOT DECIDE. A stable subject is a stable NAME. It is not
 * attendance, not custody, not a person, and not authority — see
 * `ceilings.mjs` and `projection.mjs`. Two different installations that were
 * given the same genesis nonce would share a subject; that is why the nonce is
 * caller-supplied entropy and why `store.mjs` generates it from 32 CSPRNG bytes.
 *
 * @module @aukora/dsh-plugin-aumlok/genesis
 */
import { createHash } from 'node:crypto'
import { canonicalJSON } from './canonical.mjs'
import { readClosedDataRecord, readDigest } from './validation.mjs'

/** Domain of the immutable genesis record. */
export const IDENTITY_GENESIS_DOMAIN = 'aukora:identity-genesis:v1'

/** Prefix of every AUKORA subject identifier. */
export const AUKORA_ID_PREFIX = 'aukora:1:'

/** Domain separation for the subject digest. */
export const IDENTITY_SUBJECT_DIGEST_DOMAIN = 'aukora:identity-subject:v1'

const GENESIS_FIELDS = Object.freeze([
  'domain',
  'genesisNonce',
  'initialRootKeySetId',
  'amendmentRuleDigest',
])
const GENESIS_INPUT_FIELDS = Object.freeze([
  'genesisNonce',
  'initialRootKeySetId',
  'amendmentRuleDigest',
])

/**
 * @typedef {Readonly<{domain: string, genesisNonce: string, initialRootKeySetId: string, amendmentRuleDigest: string}>} IdentityGenesisV1
 */

/**
 * Create a closed immutable genesis record from trusted setup inputs.
 *
 * There is deliberately no default for any field, including the amendment rule:
 * D4 requires the succession policy be fixed at genesis, and a defaulted policy
 * is a policy nobody chose.
 * @param {unknown} input - exact nonce, initial root-key-set identity, and amendment-rule digest.
 * @returns {IdentityGenesisV1} immutable genesis record.
 */
export function createIdentityGenesis(input) {
  const fields = readClosedDataRecord(input, GENESIS_INPUT_FIELDS, 'identity genesis input')
  return freezeGenesis({
    genesisNonce: readDigest(fields.genesisNonce, 'identity genesis input.genesisNonce'),
    initialRootKeySetId: readDigest(fields.initialRootKeySetId, 'identity genesis input.initialRootKeySetId'),
    amendmentRuleDigest: readDigest(fields.amendmentRuleDigest, 'identity genesis input.amendmentRuleDigest'),
  })
}

/**
 * Parse a serialized genesis record without accepting extra authority fields.
 * @param {unknown} input - candidate genesis record.
 * @returns {IdentityGenesisV1} detached immutable record.
 */
export function parseIdentityGenesis(input) {
  const fields = readClosedDataRecord(input, GENESIS_FIELDS, 'identity genesis')
  if (fields.domain !== IDENTITY_GENESIS_DOMAIN) {
    throw new TypeError(`identity genesis.domain: must equal ${IDENTITY_GENESIS_DOMAIN}`)
  }
  return freezeGenesis({
    genesisNonce: readDigest(fields.genesisNonce, 'identity genesis.genesisNonce'),
    initialRootKeySetId: readDigest(fields.initialRootKeySetId, 'identity genesis.initialRootKeySetId'),
    amendmentRuleDigest: readDigest(fields.amendmentRuleDigest, 'identity genesis.amendmentRuleDigest'),
  })
}

/**
 * Derive the stable public subject identifier from immutable genesis bytes.
 * @param {unknown} input - candidate genesis record.
 * @returns {string} `aukora:1:<sha256>` subject identifier.
 */
export function aukoraIdFromGenesis(input) {
  const genesis = parseIdentityGenesis(input)
  const digest = createHash('sha256')
    .update(IDENTITY_SUBJECT_DIGEST_DOMAIN, 'utf8')
    .update('\0', 'utf8')
    .update(canonicalJSON(genesis), 'utf8')
    .digest('hex')
  return `${AUKORA_ID_PREFIX}${digest}`
}

/**
 * Freeze one genesis record into its canonical field order.
 * @param {{genesisNonce: string, initialRootKeySetId: string, amendmentRuleDigest: string}} record - validated fields.
 * @returns {IdentityGenesisV1} frozen record.
 */
function freezeGenesis(record) {
  return Object.freeze({
    domain: IDENTITY_GENESIS_DOMAIN,
    genesisNonce: record.genesisNonce,
    initialRootKeySetId: record.initialRootKeySetId,
    amendmentRuleDigest: record.amendmentRuleDigest,
  })
}
