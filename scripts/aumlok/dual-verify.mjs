import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIRECTORY = dirname(fileURLToPath(import.meta.url))
const VERIFY = join(DIRECTORY, 'verify-approval')
const COLD_VERIFY = join(DIRECTORY, 'verify-approval-cold.py')

// Both routes use the same bytes, bindings, clock and limits, before consuming an approval.
export function dualVerifyApproval({
  artifact, evidence, operationFile, operationDigest, subject, approverDid, controlDigest, pinnedPem,
  now = Math.floor(Date.now() / 1000), maxWindow, maxSkew = 60,
}, run = spawnSync) {
  const approvalArgs = [artifact, '--approver-did', approverDid,
    '--operation', operationFile, '--operation-digest', operationDigest,
    '--subject', subject, '--control-digest', controlDigest, '--now', String(now),
    '--max-window', String(maxWindow), '--max-skew', String(maxSkew)]
  const verifyOptions = { cwd: evidence, encoding: 'utf8', timeout: 10_000, killSignal: 'SIGKILL' }
  const checked = run(process.execPath, [VERIFY, ...approvalArgs, '--pub', pinnedPem], verifyOptions)
  const coldChecked = run('/usr/bin/python3', ['-I', '-B', COLD_VERIFY, ...approvalArgs], {
    ...verifyOptions, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
  })
  const verifierVerdict = (run, cold) => {
    if (run.error || run.signal) return `ERROR ${run.error?.code ?? run.signal}`
    const output = run.stdout ?? ''
    if (run.status === 0 && (cold ? output.trim() === 'ACCEPT' : /^VERIFIED:/mu.test(output))) return 'ACCEPT'
    return output.match(cold ? /^REFUSE (\S+)/mu : /^REFUSED: (\S+)/mu)?.[0] ?? `ERROR exit=${String(run.status)}`
  }
  const nodeVerdict = verifierVerdict(checked, false)
  const coldVerdict = verifierVerdict(coldChecked, true)
  for (const [name, run, verdict] of [['verify-approval.txt', checked, nodeVerdict], ['verify-approval-cold.txt', coldChecked, coldVerdict]]) {
    writeFileSync(join(evidence, name), `${run.stdout ?? ''}${run.stderr ?? ''}\nVERIFIER ${verdict}; exit=${String(run.status)}${run.error ? `; ${run.error.message}` : ''}\n`)
  }
  const accepted = !(nodeVerdict !== 'ACCEPT' || coldVerdict !== 'ACCEPT')
  return { accepted, nodeVerdict, coldVerdict }
}
