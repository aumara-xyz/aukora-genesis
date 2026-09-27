#!/usr/bin/env node
/**
 * ⚠️ TEST DOUBLE, NOT CODE — a daemon-free approver that mints AUMLOK's REAL artifact.
 *
 * WHY THIS STILL EXISTS NOW THAT THE AUMLOK LANE HAS LANDED. `scripts/aumlok/approve-operation` is
 * the producer: it holds no key, builds a request, and sends it down a Unix socket to a separate
 * signer process. That is the right shape for the product and the wrong shape for a court that runs
 * thirteen arms twice and a `--selftest` that re-runs the whole command eight times — a signer
 * daemon per run would make the Kira suites slow enough that somebody would eventually stop running
 * them. So this module is the in-process double: same key split (its own Ed25519 key, never the
 * writer's), same records, and — this is the part that changed — the SAME ARTIFACT BY CONSTRUCTION.
 *
 * IT MINTS THE RECEIPT WITH THE APPROVING LANE'S OWN `createApprovalReceipt`, over a request built
 * from the approving lane's own `createApprovalRequest`, signed with the approving lane's own
 * `approvalSigningBytes`, and digested with the approving lane's own `operationDigestOf`. There is
 * no second shape here to drift: the moment Aumlok changes what an approval is, this file produces
 * the new thing or fails to load.
 *
 * WHAT IT CANNOT DO, and this is the limit a reader must not miss: because it imports the digest rule
 * from the consuming lane's own module, a drift in that rule moves BOTH this approver and the
 * verifier TOGETHER, and the Kira courts cannot see it. A verifier and a producer that share
 * arithmetic agree by construction, and agreement is not verification. The negative control for the
 * digest rule is therefore NOT here — it is `tests/kira-approval-wire.test.mjs`, the only court with
 * the real producer on the other side of the wire.
 *
 * NO CONTROLLER, NO CEREMONY, NO CUSTODY, NO IDENTITY BINDING. It builds a projection for an
 * identity it does not hold, and says so. It cannot mint `human-ceremony` (the receipt layer refuses
 * it by name) and it does not claim to.
 *
 * @module kira-approval-standin
 */
import { createHash, generateKeyPairSync, randomBytes, sign as edSign } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { operationDigestFor } from '../plugins/aukora-kira/lib/approval.mjs'
import {
  APPROVAL_REQUEST_DOMAIN,
  APPROVAL_RESPONSE_DOMAIN,
  approvalSigningBytes,
  createApprovalRequest,
} from '../plugins/aukora-aumlok/lib/owner-approval.mjs'
import { createApprovalReceipt, DEFAULT_APPROVAL_CLASS } from '../plugins/aukora-aumlok/lib/approval-receipt.mjs'
import { PUBLIC_CONTROL_DOMAIN, LOCAL_AUMLOK_CUSTODY_CLASS } from '../plugins/aukora-aumlok/lib/projection.mjs'
import { didKeyFromEd25519PublicKey } from '../plugins/aukora-aumlok/lib/did-key.mjs'

/** The source string every artifact this double mints carries in its ceilings' provenance. */
export const STANDIN_SOURCE = 'tests/kira-approval-standin.mjs (daemon-free TEST DOUBLE for scripts/aumlok/approve-operation)'

/**
 * One disposable approver: a software Ed25519 key and the operations an approver performs.
 *
 * THE BUNDLE-ERA HELPERS ARE NOT HERE, AND THAT IS THE RECONCILIATION'S DECISION RATHER THAN A LOSS.
 * The audit revision added `buildRequest`, `approveRequest` and `decline`, whose whole purpose was to
 * wrap ONE signed request in two `aukora-kira-owner-approval-bundle/v1` documents differing only in the
 * unsigned `source` — the "one approval, many writes" attack. That document is deleted, and the attack
 * is now expressed where it actually lives: the court EDITS an unsigned field of the real
 * `aukora:approval-receipt:v1` on disk, which is a stronger control than minting two documents, because
 * it is the edit an attacker would actually make. Nothing else in the tree called those three helpers.
 * `signedRequest` remains for a court that needs the raw signed pair.
 *
 * Kept as a factory rather than module state so two courts cannot share a key by accident, and so a
 * test can show that an artifact signed by a DIFFERENT approver is refused.
 *
 * @param {{subject: string, controlDigest?: string, approvalClass?: string, keyClass?: 'A'|'B'|'C'}} options -
 *   the subject this approver signs for, and optionally the labels it may mint.
 * @returns {Readonly<Record<string, unknown>>} the approver.
 */
export function createApprover(options) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const rawPublicKeyHex = Buffer.from(/** @type {string} */ (publicKey.export({ format: 'jwk' }).x), 'base64url').toString('hex')
  const approverDid = didKeyFromEd25519PublicKey(rawPublicKeyHex)
  // The control digest is this approver's statement about the identity it approves FOR. No controller
  // is created here, so it digests the identity it was handed rather than claiming control state it
  // does not hold. The PROJECTION below is therefore a stated fiction: it is the shape the receipt
  // layer closes over, built from the digest this double asserts.
  const controlDigest = options.controlDigest
    ?? createHash('sha256').update(`stand-in:${options.subject}`, 'utf8').digest('hex')
  const projection = Object.freeze({
    domain: PUBLIC_CONTROL_DOMAIN,
    subject: options.subject,
    // Epoch 0 is what a controller that has never rotated reports, and `revoked: false` is the only
    // value a disposable double may honestly assert.
    epoch: 0,
    activeControlDigest: controlDigest,
    revoked: false,
    approvalKeyDid: approverDid,
    custodyClass: LOCAL_AUMLOK_CUSTODY_CLASS,
  })
  const approvalClass = options.approvalClass ?? DEFAULT_APPROVAL_CLASS
  const keyClass = options.keyClass ?? 'B'

  /** @param {number} seconds @param {number} [now] */
  const window = (seconds, now = Math.floor(Date.now() / 1000)) => ({ issuedAt: now, expiresAt: now + seconds })

  return Object.freeze({
    did: approverDid,
    rawPublicKeyHex,
    subject: options.subject,
    projection,
    approvalClass,
    keyClass,

    /**
     * Sign one approval for exactly these effect arguments, and mint the artifact.
     * @param {Readonly<{key: string, value: unknown}>} memoryPut - the effect being approved.
     * @param {{expiresIn?: number, now?: number, challenge?: string, operationDigest?: string, subject?: string,
     *   approvalClass?: string, keyClass?: 'A'|'B'|'C'}} [overrides] -
     *   explicit values, so a court can construct the artifacts that must be REFUSED.
     * @returns {Readonly<Record<string, unknown>>} the `aukora:approval-receipt:v1` artifact.
     */
    approve(memoryPut, overrides = {}) {
      const times = window(overrides.expiresIn ?? 300, overrides.now)
      const subject = overrides.subject ?? options.subject
      const request = createApprovalRequest({
        subject,
        activeControlDigest: controlDigest,
        operationDigest: overrides.operationDigest ?? operationDigestFor(memoryPut),
        challenge: overrides.challenge ?? randomBytes(32).toString('hex'),
        issuedAt: times.issuedAt,
        expiresAt: times.expiresAt,
      })
      const signature = edSign(null, approvalSigningBytes(request), privateKey).toString('hex')
      return createApprovalReceipt({
        approval: {
          ok: true,
          subject: request.subject,
          activeControlDigest: request.activeControlDigest,
          approvalKeyDid: approverDid,
          operationDigest: request.operationDigest,
          challenge: request.challenge,
          signature,
          verifiedAt: times.issuedAt,
        },
        // The projection travels with the labels, so a court can mint an artifact claiming a class
        // this lane must refuse — which is the control for that refusal.
        projection: { ...projection, subject: overrides.subject ?? projection.subject },
        keyClass: overrides.keyClass ?? keyClass,
        approvalClass: overrides.approvalClass ?? approvalClass,
        request,
      })
    },

    /**
     * The request/response pair this artifact is ABOUT, for a court that needs to build something the
     * artifact layer would refuse (a refusal response, a mismatched challenge).
     * @param {Readonly<{key: string, value: unknown}>} memoryPut - the effect.
     * @param {{now?: number, expiresIn?: number, challenge?: string}} [overrides] - window and challenge.
     * @returns {Readonly<{request: Readonly<Record<string, unknown>>, signature: string}>} the pair.
     */
    signedRequest(memoryPut, overrides = {}) {
      const times = window(overrides.expiresIn ?? 300, overrides.now)
      const request = createApprovalRequest({
        subject: options.subject,
        activeControlDigest: controlDigest,
        operationDigest: operationDigestFor(memoryPut),
        challenge: overrides.challenge ?? randomBytes(32).toString('hex'),
        issuedAt: times.issuedAt,
        expiresAt: times.expiresAt,
      })
      return Object.freeze({ request, signature: edSign(null, approvalSigningBytes(request), privateKey).toString('hex') })
    },

    /** The response record the signer sends when its reviewer declines. No artifact is minted from it. */
    refusal(request) {
      return Object.freeze({
        domain: APPROVAL_RESPONSE_DOMAIN,
        challenge: request.challenge,
        refusal: 'signer:declined',
      })
    },
  })
}

/** The request domain, re-exported so a court building a refusal does not restate it. */
export { APPROVAL_REQUEST_DOMAIN, APPROVAL_RESPONSE_DOMAIN }

/**
 * Write one artifact where the composition's `approvalFile` points.
 * @param {string} path - destination file.
 * @param {unknown} artifact - the artifact to write.
 */
export function writeApproval(path, artifact) {
  writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 })
}

/**
 * The RETIRED bundle shape — the document this lane used to read before the wire was reconciled.
 *
 * Kept as a fixture builder on purpose: "the two lanes were built in parallel and each was green
 * alone" is the defect under repair, and a control that shows the old document is now REFUSED BY
 * NAME is the evidence that the repair is a repair. Nothing in shipped code mints this.
 *
 * @param {unknown} request - the approval request.
 * @param {unknown} response - the approval response.
 * @param {string} approverDid - the approver's did:key.
 * @returns {Readonly<Record<string, unknown>>} the retired `aukora-kira-owner-approval-bundle/v1`.
 */
export function retiredBundle(request, response, approverDid) {
  return Object.freeze({
    kind: 'aukora-kira-owner-approval-bundle/v1',
    source: STANDIN_SOURCE,
    request,
    response,
    approverDid,
  })
}
