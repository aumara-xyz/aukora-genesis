#!/usr/bin/env node
/**
 * Mint the signed Receipt v3 FIXTURE this court checks in.
 *
 * A fixture is never evidence. It exists so the verifier's structural path and
 * its mutation arm have a complete, correctly signed document to work on, and
 * its `kind` says so out loud: `aukora-receipt/v3-fixture`. A `scripted` class
 * under the evidence `kind` refuses `receipt:class-kind-mismatch`, which is the
 * pair `V3.class-kind` measures.
 *
 * The keypair is generated here and written beside the fixture, so the checked-in
 * fixture is reproducible without any secret material. Re-run to rotate both:
 *
 *   node courts/harness/receipt-v3/mint-fixture.mjs
 *
 * Nothing in this file is imported by the verifier, and nothing here touches
 * broker state, the live server, or the network.
 *
 * @module courts/harness/receipt-v3/mint-fixture
 */
import { createHash, createPrivateKey, createPublicKey, sign as edSign } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  APPROVAL_ARTIFACT_DOMAIN,
  APPROVAL_SIGNED_DOMAIN,
  AURA_RECORD_DOMAIN,
  HEAD_STATEMENT_DOMAIN,
  RECEIPT_V3_DOMAIN,
  RECEIPT_V3_FIXTURE_KIND,
  RECEIPT_V3_KIND,
  canonicalJSONV3,
  receiptV3Core,
} from '../../../aukora/receipt-v3/verify.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIRECTORY = join(HERE, 'fixtures')

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const keyId = (publicKey) => sha256(publicKey.export({ type: 'spki', format: 'der' }))

/** The pubkey that is never a secret, used where a document needs a key id it does not sign with. */
const RENDERER_ID = sha256(Buffer.from('courts/harness/receipt-v3/renderer-source (fixture)', 'utf8'))

/**
 * The v1 settlement receipt field order, exactly as
 * `aukora/broker/receipt.mjs` freezes it. Reproduced rather than imported so the
 * fixture minting imports nothing from the authority graph.
 */
const SETTLEMENT_V1_FIELDS = Object.freeze([
  'requestDigest', 'definitionId', 'nonce', 'sequence', 'path', 'bytes', 'contentSha256', 'inode',
  'mtimeNs', 'confinement',
])

/** The v1 receipt preimage: its domain, a newline, and canonical JSON of its ordered fields. */
function settlementPreimage(claims) {
  const ordered = SETTLEMENT_V1_FIELDS.map((field) => [field, claims[field] ?? null])
  return Buffer.from(`aukora:settlement-receipt:v1\n${canonicalJSONV3(ordered)}`, 'utf8')
}

/** The v1 receipt's own digest: the filename it is stored under and the value the Aura entry records. */
function settlementDigest(receipt) {
  const ordered = {}
  for (const field of [...SETTLEMENT_V1_FIELDS, 'signature']) ordered[field] = receipt[field] ?? null
  return sha256(Buffer.from(canonicalJSONV3(ordered), 'utf8'))
}

/** Field coordinates the mutation arm walks. Each is a path into the fixture document. */
export const FIXTURE_MUTATION_FIELDS = Object.freeze([
  'action.canonical',
  'action.digest',
  'approval.at',
  'aura.entry.nonce',
  'aura.entry.receiptSha256',
  'aura.entry.verdict',
  'aura.hash',
  'aura.prev',
  'aura.seq',
  'authorization.payload.digest',
  'authorization.payload.nonce',
  'authorization.payload.tool',
  'authorization.signature',
  'ceilings',
  'definitionId',
  'domain',
  'effect.observedAt',
  'effect.observedDigest',
  'head.at',
  'head.hash',
  'head.keyId',
  'head.seq',
  'head.signature',
  'issuerKeyId',
  'kind',
  'nonce',
  'operation',
  'publication',
  'resource',
  'signature',
  'times.approvedAt',
  'times.expiresAt',
  'times.issuedAt',
  'times.settledAt',
])

/** The fixed 32-byte seed the checked-in fixture's executor keypair is derived from. Not a secret. */
const FIXTURE_SEED = Buffer.from('61756b6f72612d726563656970742d76332d666978747572652d6b65792d7631', 'hex')

/** The fixed seed for the ISSUER root key that signs the fixture's embedded grant. Not a secret. */
const FIXTURE_ISSUER_SEED = Buffer.from('61756b6f72612d726563656970742d76332d6973737565722d726f6f742d7631', 'hex')

/** Derive one Ed25519 keypair from a 32-byte seed. PKCS#8 is a fixed prefix plus the seed. */
function keyPairFromSeed(seed) {
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
    format: 'der',
    type: 'pkcs8',
  })
  const publicKey = createPublicKey(privateKey)
  return {
    privateKey,
    publicKey,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    publicKeyId: keyId(publicKey),
  }
}

/**
 * The fixture's Ed25519 keypair, derived from a fixed non-secret seed so the
 * checked-in fixture and the mutation arm's re-signing share one key without any
 * key file being the source of truth. This key authorizes nothing; it exists so a
 * document can be correctly signed in a court.
 *
 * @returns {{
 *   privateKey: import('node:crypto').KeyObject,
 *   publicKey: import('node:crypto').KeyObject,
 *   publicKeyPem: string,
 *   publicKeyId: string,
 * }} the fixture keypair.
 */
export function fixtureKeyPair() {
  return keyPairFromSeed(FIXTURE_SEED)
}

/**
 * The fixture's ISSUER root keypair, separate from the executor key.
 *
 * A real settlement's grant is signed by the issuer root, whose key is
 * deliberately unavailable to the executor process that writes the receipt. A
 * single-key fixture hid that: it let the verifier check the grant against the
 * executor's key set and pass, which no genuine document can do. This keypair
 * exists so the fixture exercises the real three-key arrangement — executor,
 * issuer root, and (once step 3 lands) owner.
 *
 * @returns {{
 *   privateKey: import('node:crypto').KeyObject,
 *   publicKey: import('node:crypto').KeyObject,
 *   publicKeyPem: string,
 *   publicKeyId: string,
 * }} the fixture issuer keypair.
 */
export function fixtureIssuerKeyPair() {
  return keyPairFromSeed(FIXTURE_ISSUER_SEED)
}

/**
 * Build one complete, signed fixture document.
 *
 * @param {object} [options] - overrides for the fixture's own values.
 * @param {number} [options.at] - the settlement millisecond used throughout.
 * @returns {{
 *   document: Record<string, unknown>,
 *   privateKey: import('node:crypto').KeyObject,
 *   publicKeyPem: string,
 *   publicKeyId: string,
 * }} the document and the key material that signs it.
 */
export function mintFixtureDocument({ at = 1789461999123 } = {}) {
  const { privateKey, publicKey, publicKeyPem, publicKeyId } = fixtureKeyPair()
  const issuer = fixtureIssuerKeyPair()

  // A REAL settlement nonce. `newNonce()` is 12 random bytes rendered hex, so an
  // honest nonce is 24 characters. An earlier fixture carried 32 hex characters,
  // which the broker could never mint; that fixture made the verifier's
  // 32-character requirement look satisfied while every genuine document was
  // refused `export:malformed — entry nonce`.
  const nonce = 'a1b2c3d4e5f60718293a4b5c'
  const resource = 'fixture://receipt-v3/step-1'
  const operation = 'workspace.patch'
  // THE SAME BYTES A REAL EXPORT WOULD BIND. `action.canonical` is
  // `canonicalJSON({ tool, arguments })` — measured against a live broker — and an
  // earlier fixture carried only the arguments object, so it exercised a shape the
  // exporter never produces. The external review package ships this document, so a
  // fixture that misrepresented the field layout would have taught a reviewer the
  // wrong thing about the format.
  const canonicalAction = canonicalJSONV3({
    tool: 'workspace.patch',
    arguments: {
      workspace: 'fixture',
      path: 'notes/fixture.txt',
      beforeSha256: null,
      content: 'receipt v3 fixture\n',
    },
  })
  const actionDigest = sha256(Buffer.from(canonicalAction, 'utf8'))
  const definitionId = sha256(Buffer.from('fixture definition: workspace.patch', 'utf8'))
  const operationDigest = sha256(Buffer.from('fixture operation: workspace.patch', 'utf8'))

  const payload = {
    domain: 'aukora:tool-grant:v4',
    tool: operation,
    digest: actionDigest,
    nonce,
    exp: Math.floor(at / 1000) + 3600,
    definitionId,
    operationDigest,
    receiptKeyId: publicKeyId,
  }
  // Signed exactly as `grantPreimage` signs a real grant: the canonical claims
  // under the v3 domain, with the domain as a FIELD rather than a prefix over a
  // digest. A v4 signed message would exercise the other family, and
  // `V3.grant-families` covers both so neither can rot.
  const authorizationSignature = edSign(null, Buffer.from(canonicalJSONV3({
    domain: 'aukora:tool-grant:v3',
    tool: operation,
    digest: actionDigest,
    nonce,
    exp: payload.exp,
    definitionId,
    operationDigest,
    receiptKeyId: publicKeyId,
  }), 'utf8'), issuer.privateKey).toString('base64')

  // The embedded v1 receipt, signed over its own frozen field order exactly as
  // `aukora/broker/receipt.mjs` mints one. The fixture carries a real signature
  // so the document's digest binding between the settlement block and the Aura
  // entry is a check that can fail rather than a formality.
  const settlementClaims = {
    requestDigest: sha256(Buffer.from('fixture request', 'utf8')),
    definitionId,
    nonce,
    sequence: 1,
    path: '/fixture/notes/fixture.txt',
    bytes: Buffer.byteLength(canonicalAction, 'utf8'),
    contentSha256: actionDigest,
    inode: 1,
    mtimeNs: `${at}000000`,
    confinement: { class: 'state-owned', measuredAt: at },
  }
  const settlement = {
    ...settlementClaims,
    signature: edSign(null, settlementPreimage(settlementClaims), privateKey).toString('base64'),
  }
  const entryBody = {
    verdict: 'settled',
    sequence: 1,
    key: 'fixture-key',
    requestDigest: settlementClaims.requestDigest,
    definitionId,
    nonce,
    receiptSha256: settlementDigest(settlement),
    path: settlementClaims.path,
    bytes: settlementClaims.bytes,
    contentSha256: settlementClaims.contentSha256,
    inode: settlementClaims.inode,
    mtimeNs: settlementClaims.mtimeNs,
    confinement: settlementClaims.confinement,
  }
  const auraPrev = AURA_RECORD_DOMAIN
  const auraHash = sha256(Buffer.from(canonicalJSONV3({ prev: auraPrev, ...entryBody, domain: AURA_RECORD_DOMAIN }), 'utf8'))

  const head = {
    seq: 1,
    hash: auraHash,
    // The head statement is made at settlement, so its instant and the document's
    // settledAt are the same value. Two different values here would make
    // `observedAt` sit either before settlement or after the head, and the
    // verifier would refuse a document this mint built itself.
    at: at + 300,
    keyId: publicKeyId,
    signature: edSign(null, Buffer.from(`${HEAD_STATEMENT_DOMAIN}\n${canonicalJSONV3({
      seq: 1, hash: auraHash, at: at + 300, keyId: publicKeyId,
    })}`, 'utf8'), privateKey).toString('base64'),
  }

  const document = {
    kind: RECEIPT_V3_KIND,
    domain: RECEIPT_V3_DOMAIN,
    nonce,
    operation,
    resource,
    definitionId,
    settlement,
    action: { canonical: canonicalAction, digest: actionDigest },
    authorization: { payload, signature: authorizationSignature, keyId: issuer.publicKeyId },
    // SYNTHETIC EVIDENCE SHOULD LOOK LIKE EVIDENCE. This document is minted with
    // no approval signature, and `deriveApprovalClass` reports that as
    // `unattributed` — NOT `scripted`, because missing approval evidence is not a
    // fixture. The checked-in fixture therefore carries the evidence kind with an
    // `unattributed` approval, and `V3.fixture` separately derives the scripted
    // pair by re-signing, so both pairs are measured from one document.
    approval: { class: 'unattributed', at: at + 123 },
    delegation: null,
    publication: 'verbatim',
    effect: { observedDigest: settlementClaims.contentSha256, observedAt: at + 400 },
    times: {
      issuedAt: at - 3000,
      approvedAt: at + 123,
      settledAt: at + 300,
      // Derived from the grant's own expiry rather than invented, so the two
      // copies of that instant agree. The grant carries SECONDS and this
      // document carries MILLISECONDS; a fixture that picked its own millisecond
      // value drifted from the payload and refused `receipt:inconsistent`.
      expiresAt: (Math.floor(at / 1000) + 3600) * 1000,
    },
    // A fixture DECLARES that its instants are synthetic. The declared sources
    // are not a claim about the world: `fixture-coherent` says outright that the
    // number exists to exercise the ordered path, which is the one place a
    // synthetic instant is honest. Every real export marks these unavailable.
    timesSources: {
      issuedAt: 'fixture-coherent',
      approvedAt: 'fixture-coherent',
      settledAt: 'fixture-coherent',
      expiresAt: 'grant-expiry-seconds',
    },
    aura: { seq: 1, prev: auraPrev, hash: auraHash, entry: entryBody },
    head,
    ceilings: ['SAME_UID_HOST', 'SAME_UID_WITNESS'],
    issuerKeyId: publicKeyId,
    signature: '',
  }
  signDocument(document, privateKey)

  return {
    document,
    privateKey,
    publicKeyPem,
    publicKeyId,
    // The grant signer, which is NOT the executor. A caller checking the grant
    // must anchor this set separately.
    issuerPublicKeyPem: issuer.publicKeyPem,
    issuerPublicKeyId: issuer.publicKeyId,
  }
}

/**
 * Build one complete, signed fixture document together with the raw evidence an
 * export reads: the signed v1 settlement receipt and the Aura entry body naming
 * it. This is the input an export round-trip needs, which the document alone
 * cannot supply because `settlement` is embedded rather than reconstructible.
 *
 * @param {object} [options] - overrides for the fixture's own values.
 * @param {number} [options.at] - the settlement millisecond used throughout.
 * @returns {{
 *   document: Record<string, unknown>,
 *   privateKey: import('node:crypto').KeyObject,
 *   publicKeyPem: string,
 *   publicKeyId: string,
 *   settlement: Record<string, unknown>,
 *   settlementSha256: string,
 *   entryBody: Record<string, unknown>,
 *   canonicalAction: string,
 *   actionDigest: string,
 * }} the document, its evidence, and the digests that join them.
 */
export function mintFixtureEvidence({ at = 1789461999123 } = {}) {
  // One call, so every field describes the SAME document. Deriving the key more
  // than once returned equal values for a seeded key, which is exactly the kind
  // of coincidence that hides a real mismatch if the seed ever becomes a
  // generator.
  const minted = mintFixtureDocument({ at })
  const settlement = minted.document.settlement
  return {
    ...minted,
    settlement,
    settlementSha256: settlementDigest(settlement),
    entryBody: minted.document.aura.entry,
    // The issued grant, in the exact three-field shape a v3 authorization block
    // carries. Without it a document refuses `grant:signature`, because the grant
    // IS the record of what was authorized.
    authorization: {
      payload: minted.document.authorization.payload,
      signature: minted.document.authorization.signature,
      keyId: minted.document.authorization.keyId,
    },
    canonicalAction: minted.document.action.canonical,
    actionDigest: minted.document.action.digest,
  }
}

/**
 * The approval artifact digest, exactly as `aukora/approval/artifact.mjs`
 * derives it: sha256 over the domain tag, one space, and the artifact's
 * canonical JSON. Reproduced here rather than imported so the court's fixture
 * minting imports nothing from the authority graph.
 *
 * @param {Record<string, unknown>} artifact - the artifact's eleven fields.
 * @returns {string} lowercase hex digest.
 */
export function approvalFixtureArtifactDigest(artifact) {
  const ordered = {
    version: artifact.version,
    operationArguments: { ...artifact.operationArguments },
    operationCanonicalBytes: artifact.operationCanonicalBytes,
    operationDigest: artifact.operationDigest,
    semanticProjection: [...artifact.semanticProjection],
    definitionId: artifact.definitionId,
    activationDigest: artifact.activationDigest,
    occurrenceId: artifact.occurrenceId,
    expiry: artifact.expiry,
    rendererId: artifact.rendererId,
    oneUse: artifact.oneUse,
  }
  return sha256(Buffer.from(`${APPROVAL_ARTIFACT_DOMAIN} ${canonicalJSONV3(ordered)}`, 'utf8'))
}

/**
 * Sign one document in place and return it.
 *
 * The court uses this to mint a correctly signed document of ANY class before
 * grading it, so a refusal it measures is the refusal it intended rather than an
 * artefact of a stale signature.
 *
 * @param {Record<string, unknown>} document - a v3 document, in any state.
 * @param {import('node:crypto').KeyObject} privateKey - the executor signing key.
 * @returns {Record<string, unknown>} the same object, signed.
 */
export function signDocument(document, privateKey) {
  document.signature = edSign(
    null,
    Buffer.from(`${RECEIPT_V3_DOMAIN}\n${canonicalJSONV3(receiptV3Core(document))}`, 'utf8'),
    privateKey,
  ).toString('base64')
  return document
}

/**
 * Build one signed `human-ceremony` v3 document with a matching approval.
 *
 * The document signature and the approval signature are separate: the first
 * covers the document core under the executor's key, the second covers
 * `approvalSignedMessage(artifactDigest)` under the owner's key. Here one keypair
 * plays both parts, which is honest for a court and dishonest as a custody
 * claim — `keyClass` is therefore `B` and the verifier prints
 * `OWNER_KEY_SAME_UID`.
 *
 * @param {object} [options] - the ceremony's own values.
 * @returns {{
 *   document: Record<string, unknown>,
 *   privateKey: import('node:crypto').KeyObject,
 *   publicKeyPem: string,
 *   publicKeyId: string,
 *   artifactDigest: string,
 * }} the signed document, its key material, and the artifact digest it names.
 */
export function mintHumanCeremonyDocument({ challenge = 'fixture-challenge' } = {}) {
  const base = mintFixtureDocument()
  const artifact = {
    version: 1,
    operationArguments: { key: 'fixture-key', value: 'fixture value' },
    operationCanonicalBytes: '{"key":"fixture-key","value":"fixture value"}',
    operationDigest: sha256(Buffer.from('fixture operation', 'utf8')),
    semanticProjection: ['memory.put fixture-key', 'fixture value'],
    definitionId: base.document.definitionId,
    activationDigest: sha256(Buffer.from('fixture activation', 'utf8')),
    occurrenceId: '0f1e2d3c4b5a69788796a5b4c3d2e1f0',
    expiry: Math.floor(base.document.times.settledAt / 1000) + 3600,
    rendererId: RENDERER_ID,
    oneUse: true,
  }
  const artifactDigest = approvalFixtureArtifactDigest(artifact)
  const approvalSignature = edSign(
    null,
    Buffer.from(`${APPROVAL_SIGNED_DOMAIN} ${artifactDigest}`, 'utf8'),
    base.privateKey,
  ).toString('base64')
  const document = {
    ...base.document,
    kind: 'aukora-receipt/v3',
    approval: {
      class: 'human-ceremony',
      at: base.document.times.approvedAt,
      challenge,
      signerKeyId: base.publicKeyId,
      keyClass: 'B',
      ceremony: 'reported',
      artifactDigest,
      signature: approvalSignature,
      renderer: { id: RENDERER_ID, domain: 'same-process' },
    },
  }
  signDocument(document, base.privateKey)
  return { ...base, document, artifactDigest }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const { document, publicKeyId, issuerPublicKeyId } = mintFixtureDocument()
  mkdirSync(FIXTURE_DIRECTORY, { recursive: true })
  const documentPath = join(FIXTURE_DIRECTORY, 'v3-fixture.json')
  writeFileSync(documentPath, `${canonicalJSONV3(document)}\n`, 'utf8')
  process.stdout.write(`wrote ${documentPath}\n`)
  process.stdout.write(`fixture executor keyId ${publicKeyId}\n`)
  process.stdout.write(`fixture issuer   keyId ${issuerPublicKeyId}\n`)
  // NO PEM IS WRITTEN. `.gitignore` ignores `*.pem` globally — the secret-ignore
  // rule — so a committed PEM cannot exist and a fresh checkout has none. The
  // fixture's keys are DERIVED from the fixed non-secret seeds above, and both
  // this script and the court obtain them from `fixtureKeyPair()` and
  // `fixtureIssuerKeyPair()` rather than from a file. Writing one here is what
  // made the court pass locally and fail in CI with ENOENT.
  process.stdout.write('no PEM written: fixture keys are derived from fixed seeds, not read from disk\n')
  process.stdout.write(`${FIXTURE_MUTATION_FIELDS.length} mutation fields declared\n`)
}
