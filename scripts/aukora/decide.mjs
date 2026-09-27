#!/usr/bin/env node
/**
 * ASK THE KERNEL: MAY THIS SIGNED APPROVAL BE USED, ONCE, FOR THIS OPERATION?
 *
 *   node scripts/aukora/decide.mjs \
 *     --approval <approval.json> --approver-did <did:key:z…> \
 *     --operation-digest <64 hex> --subject <aukora:1:…> --control-digest <64 hex> \
 *     --consumed-ids <file> [--create-consumed-ids] [--now <unix seconds> (AUDIT ONLY)] [--json]
 *
 * Prints ALLOW or DENY with the reason on the first line. Exit 0 on ALLOW, 1 on DENY, 2 on usage.
 *
 * WHO DECIDES WHAT. The approval is an `aukora:approval-receipt:v1` written by scripts/aumlok/approve-operation. It
 * carries ONE Ed25519 signature. The vendored kernel (vendor/aukora-kernel, aumara-xyz/aukora@def297f) accepts
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
 * THE CONSUMED-IDS FILE is the kernel's own `aukora-trusted-state-v1` (consumedIds, receiptHead, SALAMA stop,
 * trustedRoots). It is read strictly, locked with an exclusive `<file>.lock` for the whole decision, and REPLACED
 * ATOMICALLY WITH THE KERNEL'S nextState ONLY ON ALLOW — so the approval id is durably consumed before ALLOW is
 * printed, and a DENY writes nothing. A missing file is a DENY unless --create-consumed-ids is given: a mistyped
 * path must not become a fresh, empty history.
 *
 * --now evaluates the signed window at a given time instead of the clock. It exists to re-check a past decision; a
 * caller that is about to act must not pass it.
 */
import { createHash, createPublicKey, verify as ed25519Verify } from 'node:crypto'
import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const aumlok = await import(pathToFileURL(join(ROOT, 'plugins', 'aukora-aumlok', 'lib', 'index.mjs')).href)
const { readJsonStrictBytes } = await import(pathToFileURL(join(ROOT, 'plugins', 'aukora-kira', 'lib', 'strict-read.mjs')).href)
const kernel = await import(pathToFileURL(join(ROOT, 'vendor', 'aukora-kernel', 'lib', 'index.js')).href)

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

/** Replace `path` with `text` so a reader sees the old bytes or the new ones, never a torn file. */
function replaceAtomically(path, text) {
  const temporary = join(dirname(path), `.${basename(path)}.${String(process.pid)}.tmp`)
  const fd = openSync(temporary, 'wx', 0o600)
  try { writeSync(fd, text); fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(temporary, path)
  try { const dirFd = openSync(dirname(path), 'r'); try { fsyncSync(dirFd) } finally { closeSync(dirFd) } } catch { /* best effort */ }
}

/**
 * Decide one approval. Writes the consumed-ids file only on ALLOW.
 * @returns {{decision: 'ALLOW'|'DENY', reason: string, detail: string, approvalId?: string, receiptDraft?: object}}
 */
export function decideApproval({ approvalPath, approverDid, operationDigest, subject, controlDigest, consumedIdsPath, createConsumedIds = false, nowSeconds }) {
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

  // 5. The kernel, with the consumed-ids file locked for the whole read-decide-write.
  const approvalId = `approval:${receipt.challenge}`
  const statePath = resolve(consumedIdsPath)
  const lockPath = `${statePath}.lock`
  let lockFd
  try {
    lockFd = openSync(lockPath, 'wx', 0o600)
  } catch (error) {
    if (error?.code === 'EEXIST') {
      return deny('adapter:consumed-ids-locked', `${lockPath} exists: another decision holds it, or one died holding it — remove it only after checking`)
    }
    return deny('adapter:consumed-ids-unreadable', `cannot lock ${lockPath} (${error?.code ?? 'error'})`)
  }
  try {
    let state
    try {
      state = readJsonStrictBytes(statePath, { label: 'the consumed-ids file' }).value
    } catch (error) {
      if (error?.code !== 'ENOENT') return deny('adapter:consumed-ids-unreadable', error instanceof Error ? error.message : String(error))
      if (!createConsumedIds) return deny('adapter:consumed-ids-missing', `${statePath} does not exist; pass --create-consumed-ids to start an empty one`)
      state = structuredClone(EMPTY_STATE)
    }
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
    let result
    try {
      result = kernel.decide(request, state, kernel.canonicalBytes(KERNEL_POLICY), nowMs)
    } catch (error) {
      return deny(`kernel-input:${error?.code ?? 'error'}`, error instanceof Error ? error.message : String(error), { approvalId })
    }
    const { decision, nextState, receiptDraft } = result
    if (decision.status !== 'allowed') {
      const detail = decision.code === 'replay' ? `${approvalId} is already consumed in ${statePath}` : `the kernel refused with ${decision.code}`
      return deny(`kernel:${decision.code}`, detail, { approvalId, receiptDraft })
    }
    if (!nextState.consumedIds.includes(approvalId)) return deny('adapter:kernel-did-not-consume', 'the kernel allowed without consuming the id; refusing')
    replaceAtomically(statePath, `${JSON.stringify(nextState, null, 2)}\n`)
    return {
      decision: 'ALLOW',
      reason: `kernel:${decision.code}`,
      detail: `${approvalId} consumed in ${statePath} (${String(nextState.consumedIds.length)} consumed)`,
      approvalId,
      receiptDraft,
    }
  } finally {
    closeSync(lockFd)
    unlinkSync(lockPath)
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const value = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1] }
  const required = ['--approval', '--approver-did', '--operation-digest', '--subject', '--control-digest', '--consumed-ids']
  const missing = required.filter((name) => value(name) === undefined)
  const nowText = value('--now')
  if (missing.length > 0 || (nowText !== undefined && !/^\d+$/u.test(nowText))) {
    process.stderr.write(`usage: node scripts/aukora/decide.mjs ${required.map((n) => `${n} <…>`).join(' ')} [--create-consumed-ids] [--now <unix seconds>] [--json]\n`)
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
    createConsumedIds: args.includes('--create-consumed-ids'),
    nowSeconds: nowText === undefined ? undefined : Number(nowText),
  })
  process.stdout.write(`${outcome.decision} ${outcome.reason}\n  ${outcome.detail}\n`)
  if (outcome.approvalId !== undefined) process.stdout.write(`  approval id: ${outcome.approvalId}\n`)
  if (outcome.receiptDraft !== undefined) {
    process.stdout.write(`  kernel receipt draft: sequence ${String(outcome.receiptDraft.sequence)}, draftHash ${outcome.receiptDraft.draftHash}\n`)
  }
  process.stdout.write(`  now: ${nowText === undefined ? 'the clock' : `${nowText} (--now, audit only)`}\n`)
  if (args.includes('--json')) process.stdout.write(`${JSON.stringify(outcome)}\n`)
  process.exit(outcome.decision === 'ALLOW' ? 0 : 1)
}
