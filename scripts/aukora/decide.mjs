#!/usr/bin/env node
/**
 * ASK THE KERNEL: MAY THIS SIGNED APPROVAL BE USED, ONCE, FOR THIS OPERATION?
 *
 *   node scripts/aukora/decide.mjs \
 *     --approval <approval.json> --approver-did <did:key:z…> \
 *     --operation-digest <64 hex> --subject <aukora:1:…> --control-digest <64 hex> \
 *     --consumed-ids <file> [--state-root <restore boundary>] [--create-consumed-ids] [--now <unix seconds> (AUDIT ONLY)] [--json]
 *
 * Prints ALLOW or DENY with the reason on the first line. Exit 0 on ALLOW, 1 on DENY, 2 on usage.
 *
 * WHO DECIDES WHAT. The approval is an `aukora:approval-receipt:v1` written by scripts/aumlok/approve-operation. It
 * carries ONE Ed25519 signature. The vendored kernel (vendor/authority, aumara-xyz/aukora@def297f) accepts
 * authority only as a HYBRID Ed25519 + ML-DSA-65 `aumlok-signed-promotion-v2` under a trusted
 * `aumlok-authority-root-v2`, and it refuses a one-signature downgrade by design. A v1 receipt therefore cannot be
 * put in the kernel's authorization slot. So the work is split, and nothing is claimed for the kernel that it did
 * not do:
 *
 *   this adapter (Genesis code, before the kernel is asked):
 *     - reads the receipt strictly and as a closed record (the same parser verify-approval uses);
 *     - requires the receipt to name the PINNED approver did:key, and verifies the Ed25519 signature under the key
 *       decoded from that pinned did:key (never from the receipt), over the bytes re-derived from the receipt's
 *       signed fields;
 *     - requires the signed operation digest, subject and control digest to equal the expected ones, and `now` to be
 *       inside the signed window [issuedAt, expiresAt).
 *   the kernel, `decide(request, trustedState, policyBytes, nowMs)`, pure, no keys, no clock, no I/O:
 *     - SALAMA stop, policy match, ring ceiling, ONE-USE (consumptionId against consumedIds: `replay`), and the
 *       hash-chained receipt draft over the prior state.
 *
 * THE MAPPING, field by field (receipt → aukora-kernel-request-v1):
 *   requestId      = "aumlok-approval:" + signedBytesDigest (re-derived here, not read from the file)
 *   action         = { namespace: "aumlok", kind: "approved-operation", verb: "apply" }
 *   resource       = { namespace: "aukora-subject", id: subject }
 *   ring           = "local-write"   (NOT "self-modify": the kernel requires hybrid authorization there, so it would
 *                                     refuse every v1 receipt with `authorization_required`)
 *   payloadHash    = operationDigest
 *   consumptionId  = "approval:" + challenge   (THE APPROVAL ID: the signed one-use nonce. Not the file digest — the
 *                                     unsigned fields can be edited without breaking the signature, so a file digest
 *                                     would let one signature be replayed under many ids)
 *   humanClearance = false           (the receipt says attendance is reported, not proven)
 *   authorization  = null            (see above: the kernel's slot takes the hybrid profile only)
 *   evidenceRefs   = ["control:" + activeControlDigest, "signed-bytes:" + signedBytesDigest]
 *   policy         = one rule for that action on "aukora-subject", maxRing "local-write", requiresAuthorization false
 *
 * THE SAME CONSUMED-IDS FILE now holds the ported TrustedStateStore record (state + prepared effects). Legacy
 * plain kernel state is read in place. The store locks, journals, fsyncs and retains a high-water witness OUTSIDE
 * state/ before returning ALLOW: ~/.aukora-witness/kernel-high-water.json. AUKORA_WITNESS_DIR is honored only
 * with AUKORA_WITNESS_TEST=1 for isolated tests; production uses the account home reported by the OS.
 * The first witness for an existing history is initialized from its current count and announced once on stderr;
 * it cannot detect restores before that initialization. A kernel DENY consumes nothing; recovery may retain an
 * already committed count. --state-root names the whole restore boundary (the app callers pass their STATE).
 * SAME UID: rewriting both state and witness defeats this; the Airlock user holding the witness is the planned
 * close. The approving key is software and no server-side check enforces main. A missing file is a DENY unless
 * --create-consumed-ids is given; even then a retained higher count refuses a reset.
 *
 * --now evaluates the signed window at a given time instead of the clock. It exists to re-check a past decision; a
 * caller that is about to act must not pass it.
 */
import { createHash, createPublicKey, verify as ed25519Verify } from 'node:crypto'
import { userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ApprovalStateStore, MissingTrustedStateError, WitnessUnreadableError } from './approval-state-store.mjs'
import { RollbackRefusedError, WriterLockedError, TrustedStoreUnsafePathError } from './trusted-state-store.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const aumlok = await import(pathToFileURL(join(ROOT, 'plugins', 'aukora-aumlok', 'lib', 'index.mjs')).href)
const { readJsonStrictBytes } = await import(pathToFileURL(join(ROOT, 'plugins', 'aukora-kira', 'lib', 'strict-read.mjs')).href)
const kernel = await import(pathToFileURL(join(ROOT, 'vendor', 'authority', 'lib', 'index.js')).href)

const HEX64 = /^[0-9a-f]{64}$/u
export const KERNEL_ACTION = Object.freeze({ namespace: 'aumlok', kind: 'approved-operation', verb: 'apply' })
export const KERNEL_RESOURCE_NAMESPACE = 'aukora-subject'
export const KERNEL_RING = 'local-write'
export const KERNEL_POLICY = Object.freeze({
  schema: 'aukora-policy-v1',
  rules: [{ action: { ...KERNEL_ACTION }, resourceNamespace: KERNEL_RESOURCE_NAMESPACE, maxRing: KERNEL_RING, requiresAuthorization: false }],
  sacred: [],
})
const EMPTY_STATE = Object.freeze({
  schema: 'aukora-trusted-state-v1',
  salama: { active: false, reason: null },
  trustedRoots: [],
  consumedIds: [],
  receiptHead: { count: 0, headHash: null },
})

const deny = (reason, detail, extra = {}) => ({ decision: 'DENY', reason, detail, ...extra })
const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex')
class KernelDidNotConsumeError extends Error {}

export function resolveWitnessDir() {
  return resolve(process.env.AUKORA_WITNESS_TEST === '1' && process.env.AUKORA_WITNESS_DIR !== undefined
    ? process.env.AUKORA_WITNESS_DIR : join(userInfo().homedir, '.aukora-witness'))
}

/**
 * Decide one approval. Commit consumption and the external witness before ALLOW.
 * @returns {{decision: 'ALLOW'|'DENY', reason: string, detail: string, approvalId?: string, receiptDraft?: object}}
 */
export function decideApproval({ approvalPath, approverDid, operationDigest, subject, controlDigest, consumedIdsPath, stateRoot, createConsumedIds = false, nowSeconds }) {
  if (!HEX64.test(operationDigest ?? '')) return deny('usage:operation-digest', '--operation-digest must be 64 lowercase hex')
  if (!HEX64.test(controlDigest ?? '')) return deny('usage:control-digest', '--control-digest must be 64 lowercase hex')
  if (typeof subject !== 'string' || subject === '') return deny('usage:subject', '--subject is required')
  const nowS = nowSeconds ?? Math.floor(Date.now() / 1000)
  const nowMs = nowSeconds === undefined ? Date.now() : nowSeconds * 1000

  // 1. The receipt, strictly and as a closed record.
  let receipt
  try {
    const { value } = readJsonStrictBytes(resolve(approvalPath), { label: 'the approval receipt' })
    receipt = aumlok.parseApprovalReceipt(value)
  } catch (error) {
    return deny('adapter:receipt-malformed', error instanceof Error ? error.message : String(error))
  }

  // 2. The pinned approver key: decoded from the PINNED did:key, which must round-trip and must be the one the receipt names.
  let rawKeyHex
  try {
    rawKeyHex = aumlok.ed25519PublicKeyFromDidKey(approverDid)
    if (aumlok.didKeyFromEd25519PublicKey(rawKeyHex) !== approverDid) throw new Error('the did:key does not round-trip')
  } catch (error) {
    return deny('adapter:approver-did-invalid', error instanceof Error ? error.message : String(error))
  }
  if (receipt.approvalKeyDid !== approverDid) {
    return deny('adapter:approver-not-pinned', `the receipt names ${receipt.approvalKeyDid}; the pinned approver is ${approverDid}`)
  }
  if (receipt.approvalClass === 'human-ceremony') {
    return deny('adapter:human-ceremony-not-establishable', 'no binding register is held, so a human-ceremony class cannot be established')
  }

  // 3. The exact signed bytes, re-derived from the receipt's signed fields, and the Ed25519 signature under the pinned key.
  let signingBytes
  try {
    signingBytes = aumlok.approvalSigningBytes(aumlok.createApprovalRequest({
      subject: receipt.subject,
      activeControlDigest: receipt.activeControlDigest,
      operationDigest: receipt.operationDigest,
      challenge: receipt.challenge,
      issuedAt: receipt.issuedAt,
      expiresAt: receipt.expiresAt,
    }))
  } catch (error) {
    return deny('adapter:receipt-malformed', error instanceof Error ? error.message : String(error))
  }
  const signedBytesDigest = sha256Hex(signingBytes)
  if (signedBytesDigest !== receipt.signedBytesDigest) {
    return deny('adapter:signed-bytes-mismatch', `the signed fields derive ${signedBytesDigest}; the receipt claims ${receipt.signedBytesDigest}`)
  }
  let signatureValid = false
  try {
    const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(rawKeyHex, 'hex').toString('base64url') }, format: 'jwk' })
    signatureValid = ed25519Verify(null, signingBytes, key, Buffer.from(receipt.signature, 'hex'))
  } catch {
    signatureValid = false
  }
  if (!signatureValid) return deny('adapter:signature-invalid', `the Ed25519 signature does not verify under the pinned ${approverDid}`)

  // 4. The signature must cover THIS operation, subject and control digest, and now must be inside the signed window.
  if (receipt.operationDigest !== operationDigest) {
    return deny('adapter:operation-digest-mismatch', `the approval signs operation ${receipt.operationDigest}; expected ${operationDigest}`)
  }
  if (receipt.subject !== subject) return deny('adapter:subject-mismatch', `the approval signs subject ${receipt.subject}; expected ${subject}`)
  if (receipt.activeControlDigest !== controlDigest) {
    return deny('adapter:control-digest-mismatch', `the approval signs control digest ${receipt.activeControlDigest}; expected ${controlDigest}`)
  }
  if (nowS < receipt.issuedAt) return deny('adapter:approval-not-yet-valid', `now ${String(nowS)} is before issuedAt ${String(receipt.issuedAt)}`)
  if (!(receipt.expiresAt > nowS)) return deny('adapter:approval-expired', `now ${String(nowS)} is not before expiresAt ${String(receipt.expiresAt)}`)

  // 5. The ported transaction is the only writer of consumed ids and receipt head.
  const approvalId = `approval:${receipt.challenge}`
  const statePath = resolve(consumedIdsPath)
  const witnessDir = resolveWitnessDir()
  const witnessPath = join(witnessDir, 'kernel-high-water.json')
  let store, result, kernelFailure
  try {
    const restoreRoot = stateRoot ?? (statePath.endsWith('/home/aura-code/consumed-ids.json') ? resolve(dirname(statePath), '..', '..') : dirname(statePath))
    store = new ApprovalStateStore({
      statePath, stateRoot: resolve(restoreRoot), witnessDir, createConsumedIds,
      onMigration: (message) => process.stderr.write(`${message}\n`),
      decide: (...args) => {
        try {
          result = kernel.decide(...args)
          if (result.decision.status === 'allowed' && !result.nextState.consumedIds.includes(approvalId)) {
            throw new KernelDidNotConsumeError('the kernel allowed without consuming the id; refusing')
          }
          return result
        } catch (error) { kernelFailure = error; throw error }
      },
    })
    store.open()
    const request = {
      schema: 'aukora-kernel-request-v1',
      requestId: `aumlok-approval:${signedBytesDigest}`,
      action: { ...KERNEL_ACTION },
      resource: { namespace: KERNEL_RESOURCE_NAMESPACE, id: receipt.subject },
      ring: KERNEL_RING,
      payloadHash: receipt.operationDigest,
      consumptionId: approvalId,
      humanClearance: false,
      authorization: null,
      evidenceRefs: [`control:${receipt.activeControlDigest}`, `signed-bytes:${signedBytesDigest}`],
    }
    const outcome = store.authorizeAndPrepare({
      genesis: structuredClone(EMPTY_STATE), request, policyBytes: kernel.canonicalBytes(KERNEL_POLICY), nowMs,
      effect: { effectId: signedBytesDigest, descriptorKind: 'aumlok-approved-operation', targetPath: receipt.subject, contentHash: operationDigest },
    })
    const { decision, receiptDraft } = result
    if (!outcome.ok) {
      const detail = decision.code === 'replay' ? `${approvalId} is already consumed in ${statePath}` : `the kernel refused with ${decision.code}`
      return deny(`kernel:${decision.code}`, detail, { approvalId, receiptDraft })
    }
    return {
      decision: 'ALLOW',
      reason: `kernel:${decision.code}`,
      detail: `${approvalId} consumed in ${statePath} (${String(outcome.record.state.consumedIds.length)} consumed); external high-water retained`,
      approvalId,
      receiptDraft,
    }
  } catch (error) {
    const reason = error instanceof RollbackRefusedError ? 'kernel:rollback-refused'
      : error instanceof WriterLockedError ? 'adapter:consumed-ids-locked'
      : error instanceof MissingTrustedStateError ? 'adapter:consumed-ids-missing'
      : error instanceof WitnessUnreadableError ? 'adapter:witness-unreadable'
      : error instanceof TrustedStoreUnsafePathError ? 'adapter:trusted-state-unsafe-path'
      : error instanceof KernelDidNotConsumeError ? 'adapter:kernel-did-not-consume'
      : error === kernelFailure ? `kernel-input:${error?.code ?? 'error'}` : 'adapter:consumed-ids-unreadable'
    const detail = error instanceof RollbackRefusedError
      ? `${error.message}\nRecovery: the state folder is older than the witness at ${witnessPath}; restore the newer state, or reset the witness only if you intend to accept the rollback.`
      : error instanceof Error ? error.message : String(error)
    return deny(reason, detail, { approvalId })
  } finally { store?.close() }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const value = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1] }
  const required = ['--approval', '--approver-did', '--operation-digest', '--subject', '--control-digest', '--consumed-ids']
  const missing = required.filter((name) => value(name) === undefined)
  const nowText = value('--now')
  if (missing.length > 0 || (nowText !== undefined && !/^\d+$/u.test(nowText))) {
    process.stderr.write(`usage: node scripts/aukora/decide.mjs ${required.map((n) => `${n} <…>`).join(' ')} [--state-root <restore boundary>] [--create-consumed-ids] [--now <unix seconds>] [--json]\n`)
    if (missing.length > 0) process.stderr.write(`missing: ${missing.join(', ')}\n`)
    process.exit(2)
  }
  const outcome = decideApproval({
    approvalPath: value('--approval'),
    approverDid: value('--approver-did'),
    operationDigest: value('--operation-digest'),
    subject: value('--subject'),
    controlDigest: value('--control-digest'),
    consumedIdsPath: value('--consumed-ids'),
    stateRoot: value('--state-root'),
    createConsumedIds: args.includes('--create-consumed-ids'),
    nowSeconds: nowText === undefined ? undefined : Number(nowText),
  })
  process.stderr.write(`${outcome.decision} ${outcome.reason}; witness: ${join(resolveWitnessDir(), 'kernel-high-water.json')}\n`)
  process.stdout.write(`${outcome.decision} ${outcome.reason}\n  ${outcome.detail}\n`)
  if (outcome.approvalId !== undefined) process.stdout.write(`  approval id: ${outcome.approvalId}\n`)
  if (outcome.receiptDraft !== undefined) {
    process.stdout.write(`  kernel receipt draft: sequence ${String(outcome.receiptDraft.sequence)}, draftHash ${outcome.receiptDraft.draftHash}\n`)
  }
  process.stdout.write(`  now: ${nowText === undefined ? 'the clock' : `${nowText} (--now, audit only)`}\n`)
  if (args.includes('--json')) process.stdout.write(`${JSON.stringify(outcome)}\n`)
  process.exit(outcome.decision === 'ALLOW' ? 0 : 1)
}
