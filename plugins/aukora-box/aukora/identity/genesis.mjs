/**
 * Immutable genesis identity for a stable AUKORA subject.
 *
 * @module @aukora/identity/genesis
 */
import { createHash } from 'node:crypto'
import { canonicalJSON } from '../kernel-seed/canonical-json.mjs'
import { readClosedDataRecord, readDigest } from './validation.mjs'

export const IDENTITY_GENESIS_DOMAIN = 'aukora:identity-genesis:v1'
export const AUKORA_ID_PREFIX = 'aukora:1:'
const IDENTITY_DIGEST_DOMAIN = 'aukora:identity-subject:v1'
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

/** @typedef {{domain: string, genesisNonce: string, initialRootKeySetId: string, amendmentRuleDigest: string}} IdentityGenesisV1 */

function freezeGenesis(record) {
  return Object.freeze({
    domain: IDENTITY_GENESIS_DOMAIN,
    genesisNonce: record.genesisNonce,
    initialRootKeySetId: record.initialRootKeySetId,
    amendmentRuleDigest: record.amendmentRuleDigest,
  })
}

/**
 * Create a closed immutable genesis record from trusted setup inputs.
 * @param {unknown} input - exact nonce, initial root-key-set identity, and amendment-rule digest.
 * @returns {Readonly<IdentityGenesisV1>} immutable genesis record.
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
 * @returns {Readonly<IdentityGenesisV1>} detached immutable record.
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
    .update(IDENTITY_DIGEST_DOMAIN, 'utf8')
    .update('\0', 'utf8')
    .update(canonicalJSON(genesis), 'utf8')
    .digest('hex')
  return `${AUKORA_ID_PREFIX}${digest}`
}
