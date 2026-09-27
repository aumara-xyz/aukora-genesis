#!/usr/bin/env node
/**
 * ⚠️ DISPOSABLE TEST DOUBLE, NOT THE PRODUCT — the daemon-free form of the Aumlok approval command.
 *
 * THE REAL COMMAND HAS LANDED. `scripts/aumlok/approve-operation` is the producer: it holds no key,
 * sends the request down a Unix socket to a separate signer process, and writes the artifact. This
 * file is for the case that command cannot serve — no signer daemon, no controller directory, one
 * process — which is exactly what a Kira-side court or a quick operator check needs. The artifact it
 * writes is IDENTICAL IN SHAPE AND IN RULE, because it is minted by Aumlok's own
 * `createApprovalReceipt` over Aumlok's own request and signing bytes. What it does NOT have is the
 * key split: the approver key here lives in the same process as the caller.
 *
 *   node scripts/kira/kira-approve.mjs --state <stateDir> --note "Cedar endpoint listens on port 8098" --out <dir>
 *   node scripts/kira/kira-approve.mjs --approve <memoryPut.json> --out <dir> [--subject <s>]
 *   node scripts/kira/kira-approve.mjs … --approval-only      # the artifact, and no grant at all
 *
 * In `--state` mode the record is re-derived with `stageKiraMemoryRecord` — the same function Kira
 * stages with — so the operation digest the approval binds is computed from the record the writer
 * will actually settle, and a mismatch means a real disagreement rather than a fixture typo.
 *
 * IT WRITES THE OPERATOR DOCUMENTS THE SETTLEMENT PATH READS — `authorization` (this installation's
 * one-use grant and the record it authorizes) beside `approval` (the owner's signed artifact) — as
 * `approval.json` and, with a store, as `operator-documents.json`; plus `payload.json`, the grant
 * document alone. The two acts travel as two fields because they are two acts: one merged document
 * would let either stand in for the other.
 *
 * APPEND `--subject aukora:1:<64 hex>` TO SIGN FOR A DIFFERENT IDENTITY. The default is a labelled
 * placeholder in AUMLOK'S grammar (`readAukoraId`), not an identity of anyone's: an approval record
 * outside that grammar cannot be minted or parsed by the approving lane at all, so a placeholder
 * that violates it would be a command whose default path can never work.
 *
 * EXIT CODES: 0 approved, 2 a named refusal, 1 could not run.
 *
 * WHAT THIS IS NOT: not the Aumlok owner signer, not a human ceremony, not a custody boundary. Its
 * key is generated and stored in the clear in `--out`, and the artifact it mints says
 * `approvalClass=scripted` and `attendance=reported-not-proven` on its face.
 */
import { createHash, generateKeyPairSync, randomBytes, sign as edSign } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { stageKiraMemoryRecord } from '../../plugins/aukora-kira/lib/record.mjs'
import { createMemoryOwner } from '../../plugins/aukora-kira/lib/memory-owner.mjs'
import { ARTIFACT_DOMAIN, operationDigestFor } from '../../plugins/aukora-kira/lib/approval.mjs'
import { approvalSigningBytes, createApprovalRequest } from '../../plugins/aukora-aumlok/lib/owner-approval.mjs'
import { createApprovalReceipt } from '../../plugins/aukora-aumlok/lib/approval-receipt.mjs'
import { LOCAL_AUMLOK_CUSTODY_CLASS, PUBLIC_CONTROL_DOMAIN } from '../../plugins/aukora-aumlok/lib/projection.mjs'
import { didKeyFromEd25519PublicKey } from '../../plugins/aukora-aumlok/lib/did-key.mjs'

const args = process.argv.slice(2)
/** @param {string} name @param {string} [fallback] */
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index === -1 ? fallback : args[index + 1]
}

const stateDir = option('--state')
const approvePath = option('--approve')
const note = option('--note')
// A labelled placeholder in Aumlok's grammar. `aukora:1:` + 64 hex is the ONLY form the approving
// lane's records accept, so a caller who wants a real identity passes one; a caller who does not
// gets a subject that is visibly nobody.
const subject = option('--subject', `aukora:1:${'7a'.repeat(32)}`)
const approvalClass = option('--approval-class', 'scripted')
const out = option('--out')
const expiresIn = Number(option('--expires-in', '300'))
const approvalOnly = args.includes('--approval-only')

/**
 * A RETIRED FLAG, REFUSED BY NAME RATHER THAN IGNORED.
 *
 * This command used to accept `--decline` and write a document recording that the approver said no.
 * There is no such document any more: in the receipt world a decline is the ABSENCE of an artifact,
 * because the approving lane mints nothing when its signer refuses. Silently ignoring the flag would
 * be the worst of the three options — a caller asking for a refusal would receive a valid APPROVAL,
 * which is a fail-open dressed as a compatibility shim. So it is a usage error, and the refusal says
 * where the decline actually lives.
 */
if (args.includes('--decline')) {
  process.stderr.write(
    'REFUSE: a decline has no artifact: the approving lane mints NOTHING when its signer refuses, so\n'
    + '        there is no document to write and this command will not mint the opposite one.\n'
    + '        Run the real decline through its shipped entry point instead:\n'
    + '          node scripts/aumlok/signer.mjs --approve decline-all …\n'
    + '          node scripts/aumlok/approve-operation …   → exits 1, aumlok:approval-refused, no artifact\n',
  )
  process.exit(2)
}

if (out === undefined || (stateDir === undefined && approvePath === undefined)) {
  process.stderr.write(
    'usage: kira-approve.mjs --out <dir> (--state <stateDir> --note <text> | --approve <memoryPut.json>)\n'
    + '                         [--subject <aukora:1:hex>] [--approval-class <class>] [--expires-in <seconds>]\n'
    + '                         [--approval-only] [--quiet]\n',
  )
  process.exit(1)
}

/**
 * The effect being approved: the arguments Kira will settle, taken from the staged record or a file.
 * @returns {{memoryPut: Readonly<{key: string, value: unknown}>, record: unknown}}
 */
function readEffect() {
  if (approvePath !== undefined) {
    const parsed = JSON.parse(readFileSync(resolve(approvePath), 'utf8'))
    // A `kira_stage` result, or a bare `{key, value}` pair: exactly one of these shapes.
    const memoryPut = parsed.memoryPut ?? parsed
    if (memoryPut === null || typeof memoryPut !== 'object' || typeof memoryPut.key !== 'string') {
      throw Object.assign(new Error('the approved file carries no memory.put arguments'), { code: 'APPROVAL_INPUT_MALFORMED' })
    }
    return { memoryPut, record: parsed.record ?? null }
  }
  const staged = stageKiraMemoryRecord({
    subject,
    kind: 'observation',
    source: [],
    content: { note: note ?? '' },
    links: [],
    privacy: 'local',
    createdAt: option('--created-at', '2026-09-08T00:00:00Z'),
  })
  return { memoryPut: staged.memoryPut, record: staged.record }
}

try {
  const effect = readEffect()
  const now = Math.floor(Date.now() / 1000)

  // A fresh approver key per invocation. Nothing here reads or writes the writer's store key: an
  // approver that signed with the writer's own key would make the two acts one act.
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const rawPublicHex = Buffer.from(/** @type {string} */ (publicKey.export({ format: 'jwk' }).x), 'base64url').toString('hex')
  const approverDid = didKeyFromEd25519PublicKey(rawPublicHex)

  // The control digest is the approver's statement about the identity it approves FOR. This double
  // generates no controller, so it digests the identity it was handed rather than claiming control
  // state it does not hold — and it never claims `human-ceremony`.
  const activeControlDigest = createHash('sha256').update(`stand-in:${subject}`, 'utf8').digest('hex')
  const request = createApprovalRequest({
    subject,
    activeControlDigest,
    operationDigest: operationDigestFor(effect.memoryPut),
    challenge: randomBytes(32).toString('hex'),
    issuedAt: now,
    expiresAt: now + expiresIn,
  })
  const artifact = createApprovalReceipt({
    approval: {
      ok: true,
      subject: request.subject,
      activeControlDigest: request.activeControlDigest,
      approvalKeyDid: approverDid,
      operationDigest: request.operationDigest,
      challenge: request.challenge,
      signature: edSign(null, approvalSigningBytes(request), privateKey).toString('hex'),
      verifiedAt: now,
    },
    // A stated fiction, in the exact shape the receipt layer closes over: no controller exists here,
    // so the projection is built from the digest this file asserts rather than from control state.
    projection: {
      domain: PUBLIC_CONTROL_DOMAIN,
      subject,
      epoch: 0,
      activeControlDigest,
      revoked: false,
      approvalKeyDid: approverDid,
      custodyClass: LOCAL_AUMLOK_CUSTODY_CLASS,
    },
    keyClass: 'B',
    approvalClass,
    request,
  })

  // THE APPROVAL DOCUMENT, in the exact shape the settlement path reads. Two acts travel as two
  // fields: `authorization` is this installation's grant for these bytes, and `approval` is the
  // owner's signed artifact for the same ones. A composition may point both `grantFile` and
  // `approvalFile` at this one file, or name two files — the shape read is the same either way,
  // because the two documents are never merged INTO one another.
  mkdirSync(resolve(out), { recursive: true })
  writeFileSync(join(resolve(out), 'approval.json'), `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 })

  // The grant side: the installation's one-use grant for exactly these bytes. `--approval-only` writes
  // no grant, which is how a court shows that an approval alone settles nothing.
  if (!approvalOnly && stateDir !== undefined) {
    const owner = createMemoryOwner({ stateDir })
    const grant = owner.grantFor(effect.memoryPut, { expiry: now + expiresIn })
    // The two files, for a composition that names them separately...
    writeFileSync(join(resolve(out), 'payload.json'),
      `${JSON.stringify({ grant, record: effect.record, subject }, null, 2)}\n`, { mode: 0o600 })
    // ...and the same two documents in ONE file, for a composition that names `grantFile` and
    // `approvalFile` at the same path. The grant is minted here rather than above because minting it
    // needs the store, and `--approval-only` must leave no grant behind at all.
    writeFileSync(join(resolve(out), 'operator-documents.json'),
      `${JSON.stringify({ authorization: { grant, record: effect.record, subject }, approval: artifact }, null, 2)}\n`,
      { mode: 0o600 })
  }

  if (!args.includes('--quiet')) {
    process.stdout.write(
      `approved ${effect.memoryPut.key}\n`
      + `  artifact domain  : ${artifact.domain} (${ARTIFACT_DOMAIN})\n`
      + `  operation digest : ${request.operationDigest}\n`
      + `  approver         : ${approverDid}\n`
      + `  labels           : approvalClass=${artifact.approvalClass} keyClass=${artifact.keyClass}`
      + ` attendance=${artifact.attendance} identityBound=${String(artifact.identityBound)}\n`
      + `  window           : ${request.issuedAt} .. ${request.expiresAt}\n`
      + `  written to       : ${resolve(out)}/approval.json${stateDir === undefined || approvalOnly ? '' : ' + payload.json'}\n`
      + '  source           : a DAEMON-FREE TEST DOUBLE, NOT the owner signer and NOT a person\n',
    )
  }
} catch (error) {
  process.stderr.write(`REFUSE: ${error?.code ?? 'UNKNOWN'}: ${error?.message ?? String(error)}\n`)
  process.exit(error?.code === undefined ? 1 : 2)
}
