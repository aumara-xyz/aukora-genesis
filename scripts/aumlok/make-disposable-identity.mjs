#!/usr/bin/env node
/**
 * Build one DISPOSABLE AUMLOK identity in a fresh private directory.
 *
 * TEST KEYS ONLY. This script exists so the court and a reviewer can produce an
 * identity to break, and for no other purpose. It has no default destination, it
 * refuses a directory that already exists, and it never reads or writes anything
 * it was not handed on the command line. The owner's keys are not reachable from it:
 * there is no configuration file, no environment default and no well-known path.
 *
 * WHAT IT WRITES. Exactly the record shape Deep writes at
 * `<directory>/local-control.json` — same domain, same closed field set, same
 * canonical encoding, directory 0700, file 0600 — so the adapter's reader is
 * exercised against the real format rather than a convenient one.
 *
 * WHAT IT GENERATES. The root-control suite is hybrid:
 * `aumlok-ed25519-ml-dsa-65-v1`, and BOTH halves here are real keys. The Ed25519
 * half is derived from the seed; the ML-DSA-65 half is a genuine keypair produced
 * by the vendored generator and PROVEN to correspond — `getPublicKey(secretKey)`
 * equals the registered public key, and a sign/verify round trip succeeds — before
 * anything is written. There is no placeholder in this file any more: a fixture
 * whose ML-DSA-65 halves do not correspond is not a record this lane's own
 * binding could produce, and a fixture that cannot be produced is not evidence
 * about the producer.
 *
 * DETERMINISTIC ON PURPOSE. Both seeds are derived from `--ed25519-seed-hex` (the
 * ML-DSA-65 one through a domain-separated hash, so the two keys never share seed
 * bytes), because a fixture a reviewer cannot reproduce is a fixture they have to
 * take on trust. The derivation is labelled TEST-ONLY and is not the production
 * derivation: `scripts/aumlok/bind` uses a fresh random ML-DSA-65 seed, so a
 * disposable identity reconstructed from its seed is a TEST identity, never an
 * bound one.
 *
 * WHAT IS STILL UNMEASURED. That the vendored implementation IS FIPS 204
 * ML-DSA-65. The lane ceiling `ML_DSA_65_UNMEASURED` is printed and is not
 * retired. Nothing in this lane verifies an ML-DSA-65 root-control signature on a
 * promotion: `nodeCryptoVerifierCapabilities()` supplies no verifier, so a
 * promotion refuses by name.
 *
 * Usage:
 *   node scripts/aumlok/make-disposable-identity.mjs --directory <dir> [--ed25519-seed-hex <64 hex>]
 *
 * @module scripts/aumlok/make-disposable-identity
 */
import { createHash, createPrivateKey, createPublicKey, randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, openSync, closeSync, writeFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  AUMLOK_ROOT_CONTROL_SUITE,
  LOCAL_AUMLOK_AMENDMENT_POLICY,
  LOCAL_AUMLOK_CONTROL_DOMAIN,
  LOCAL_AUMLOK_CONTROL_FILENAME,
  LOCAL_AUMLOK_CUSTODY_CLASS,
  ML_DSA_65_LENGTHS,
  MlDsa65KeygenError,
  acquireCorrespondingMlDsa65Keypair,
  aukoraIdFromGenesis,
  canonicalJSON,
  createIdentityGenesis,
  createInitialIdentityControl,
  didKeyFromEd25519PublicKey,
  identityControlDigest,
  localAumlokAmendmentRuleDigest,
  printCeilings,
  rootKeySetId,
} from '../../plugins/aukora-aumlok/lib/index.mjs'

/** PKCS#8 DER prefix that wraps a raw 32-byte Ed25519 seed. */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

/** Domain separating the TEST ML-DSA-65 seed derivation from the Ed25519 one. */
const DISPOSABLE_ML_DSA_65_SEED_DOMAIN = 'aukora:aumlok-disposable-ml-dsa-65-seed:v1'

/** Read one `--flag value` argument, or undefined. */
function option(flag) {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv[index + 1]
}

/** Refuse with a named reason and no partial write. */
function refuse(reason) {
  process.stderr.write(`make-disposable-identity: ${reason}\n`)
  process.exit(2)
}

const directory = option('--directory')
if (directory === undefined) refuse('--directory is required; this script has no default destination')
if (existsSync(directory)) refuse(`--directory ${directory} already exists; refusing to write over it`)

const seedHex = option('--ed25519-seed-hex') ?? randomBytes(32).toString('hex')
if (!/^[0-9a-f]{64}$/u.test(seedHex)) refuse('--ed25519-seed-hex must be 64 lowercase hexadecimal characters')

/**
 * Derive the TEST ML-DSA-65 seed from the disposable Ed25519 seed.
 *
 * Domain-separated so the two keys never share seed bytes: reusing one seed across
 * two signature schemes is the kind of cross-protocol reuse that turns two
 * independent keys into one. TEST-ONLY — the production ceremony draws a fresh
 * random ML-DSA-65 seed and does not derive it from anything.
 * @param {string} ed25519SeedHex - the disposable Ed25519 seed.
 * @returns {Uint8Array} the 32-byte ML-DSA-65 keygen seed.
 */
function disposableMlDsa65Seed(ed25519SeedHex) {
  return new Uint8Array(createHash('sha256')
    .update(`${DISPOSABLE_ML_DSA_65_SEED_DOMAIN}:${ed25519SeedHex}`, 'utf8')
    .digest())
}

const privateKey = createPrivateKey({
  key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(seedHex, 'hex')]),
  format: 'der',
  type: 'pkcs8',
})
const publicJwk = createPublicKey(privateKey).export({ format: 'jwk' })
if (typeof publicJwk.x !== 'string') refuse('derived Ed25519 public key has no JWK x coordinate')
const ed25519Hex = Buffer.from(publicJwk.x, 'base64url').toString('hex')

/**
 * Generate the ML-DSA-65 half and PROVE it before the record is opened.
 *
 * Same discipline as `bind`: a fixture that could register a non-corresponding
 * pair would be a fixture that misrepresents what the producer can do. A refusal
 * here happens before `mkdirSync`, so it leaves no directory behind.
 */
let pq
try {
  pq = await acquireCorrespondingMlDsa65Keypair({ seed: disposableMlDsa65Seed(seedHex) })
} catch (error) {
  if (error instanceof MlDsa65KeygenError) refuse(error.message)
  refuse(`the ML-DSA-65 generator failed in a way it does not name: `
    + `${error instanceof Error ? error.message : String(error)}`)
}

const publicKeys = Object.freeze({
  ed25519: ed25519Hex,
  mlDsa65: pq.publicKeyHex,
})

const genesis = createIdentityGenesis({
  genesisNonce: createHash('sha256').update(`nonce:${seedHex}`, 'utf8').digest('hex'),
  initialRootKeySetId: rootKeySetId(publicKeys),
  amendmentRuleDigest: localAumlokAmendmentRuleDigest(LOCAL_AUMLOK_AMENDMENT_POLICY),
})
const activeControl = createInitialIdentityControl(genesis, {
  suite: AUMLOK_ROOT_CONTROL_SUITE,
  publicKeys,
  authorizedAt: Number(option('--authorized-at') ?? '1700000000'),
})

const record = {
  domain: LOCAL_AUMLOK_CONTROL_DOMAIN,
  custodyClass: LOCAL_AUMLOK_CUSTODY_CLASS,
  amendmentPolicy: LOCAL_AUMLOK_AMENDMENT_POLICY,
  genesis,
  activeControl,
  ed25519PrivateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  mlDsa65SecretKeyHex: pq.secretKeyHex,
}

const absolute = resolve(directory)
mkdirSync(absolute, { recursive: true, mode: 0o700 })
chmodSync(absolute, 0o700)
const path = resolve(absolute, LOCAL_AUMLOK_CONTROL_FILENAME)
const descriptor = openSync(path, 'wx', 0o600)
try {
  writeFileSync(descriptor, `${canonicalJSON(record)}\n`, 'utf8')
} finally {
  closeSync(descriptor)
}

const subject = aukoraIdFromGenesis(genesis)
process.stdout.write(`disposable identity        : ${path}\n`)
process.stdout.write(`TEST KEY                   : this key is disposable and is not custody\n`)
process.stdout.write(`subject                    : ${subject}\n`)
process.stdout.write(`epoch                      : ${String(activeControl.epoch)}\n`)
process.stdout.write(`activeControlDigest        : ${identityControlDigest(activeControl)}\n`)
process.stdout.write(`approvalKeyDid             : ${didKeyFromEd25519PublicKey(ed25519Hex)}\n`)
process.stdout.write(`ed25519 seed (test)        : ${seedHex}\n`)
process.stdout.write(`ML_DSA_65: real corresponding keypair — ${String(ML_DSA_65_LENGTHS.publicKey)}-byte public, `
  + `${String(ML_DSA_65_LENGTHS.secretKey)}-byte secret\n`)
process.stdout.write(`ML_DSA_65_GENERATOR       : ${pq.proof.generator}\n`)
process.stdout.write(`ML_DSA_65_CORRESPONDENCE  : ${pq.proof.correspondence} — PROVEN before the record was opened\n`)
process.stdout.write(`ML_DSA_65_CONFORMANCE     : ${pq.proof.fips204Conformance}\n`)
process.stdout.write('ML_DSA_65_CEILING         : correspondence is proven here; FIPS 204 conformance is not.\n')
printCeilings()
