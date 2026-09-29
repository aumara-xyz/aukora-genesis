import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { approveOperation, settleOperation, operationDigestOf, witnessOperationContent } from '../../aukora-aumlok/lib/operation-approval.mjs'
import { verifyApprovalArtifact } from '../../aukora-box/aukora/approval/artifact.mjs'

// Same pinned identity, signer socket and approveOperation used by self-change's
// scripts/aumlok/approve-operation. No injectable reviewer or boolean approval.
export function ownerReview(supportRoot, stateDirectory, target, expectedArguments) {
  const overlay = readFileSync(join(supportRoot, 'kira-deployment-overlay.patch.yml'), 'utf8')
  const setting = name => {
    const values = [...overlay.matchAll(new RegExp(`^\\s*${name}:\\s*(\\S+)\\s*$`, 'gmu'))]
    if (values.length !== 1) throw new Error(`adapter:approval-pin-${name}`)
    return values[0][1]
  }
  const expectation = { subject: setting('subject'), activeControlDigest: setting('activeControlDigest') }
  const approverDid = setting('approverDid')
  const directory = join(supportRoot, 'state', 'aumlok')
  let used = false
  return async (request, signal) => {
    if (used || signal.aborted) throw new Error('adapter:review-unavailable')
    used = true
    const artifact = verifyApprovalArtifact(request.artifact, request.artifactDigest)
    if (JSON.stringify(artifact.operationArguments) !== JSON.stringify(expectedArguments)
      || artifact.operationDigest !== request.operationDigest || artifact.expiry !== request.expiresAt) {
      throw new Error('adapter:review-bytes-changed')
    }
    // The full patch and broker authorization bindings ride on the existing popup.
    // The absolute target is included: an alias alone must never hide its mapping.
    const content = Buffer.from(JSON.stringify({ operation: 'workspace.patch', target,
      authorizationDigest: request.authorizationDigest, artifactDigest: request.artifactDigest,
      artifact }, null, 2) + '\n')
    const digest = operationDigestOf(content)
    const witness = witnessOperationContent(content, digest)
    let limit = 1650
    try {
      const installed = Number(readFileSync(join(supportRoot, 'state/home/become/shell-limit'), 'utf8').trim())
      if (Number.isSafeInteger(installed) && installed > 150) limit = installed - 150
    } catch { /* Older installed cards have the smaller bound. */ }
    if (!witness.ok || witness.displayed.length + 300 > limit) throw new Error('adapter:approval-display-too-large')
    const verdict = await approveOperation({ directory, expectation, content, operationDigest: digest,
      socketPath: join(supportRoot, 'state', 'aumlok-signer.sock'), expiresAt: request.expiresAt,
      timeoutMs: Math.max(1, request.expiresAt * 1000 - Date.now()) })
    if (!verdict.ok) {
      if (verdict.reason === 'aumlok:approval-refused') return 'denied'
      throw new Error(verdict.reason)
    }
    if (signal.aborted || verdict.receipt.approvalKeyDid !== approverDid) throw new Error('adapter:approval-pin-mismatch')
    const settled = settleOperation({ directory, expectation, artifact: verdict.receipt, content, stateDirectory })
    if (!settled.ok) throw new Error(settled.reason)
    writeFileSync(join(stateDirectory, 'owner-approval.json'), JSON.stringify(verdict.receipt) + '\n', { flag: 'wx', mode: 0o600 })
    writeFileSync(join(stateDirectory, 'operation.json'), content, { flag: 'wx', mode: 0o600 })
    return 'approved'
  }
}
