// OPTIONAL TOUCH ID PRESENCE AFTER APPROVE, for the desktop shell only.
//
// main.mjs imports this module LAZILY and inside a try: a missing helper, a missing module or any failure here
// leaves approvals exactly as they were, with no icon. Nothing in this file can refuse or decide an approval;
// the reviewer calls `sign()` only after the person has already pressed Approve, and the answer stands
// whatever `sign()` returns. Enrollment is never part of Approve: it is the helper's explicit `create`.
//
// The popup's icon reads `state()`: none (never enrolled, no icon), ready (enrolled, nothing asked yet),
// confirmed (the last Touch ID check verified) or downgraded (the key is missing or invalid, or the last check
// produced no evidence). Every change of that state is chained in <support>/state/home/aura-presence/aura.jsonl.
// NOT ENFORCED: the helper, the key, the marker and the chain are all files this macOS user can rewrite.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { acquireAppendLock, appendEntry, readVerifiedChain, releaseAppendLock } from '../../plugins/aukora-box/aukora/aura/record.mjs'
import {
  PRESENCE_REASONS, presenceEnrollment, recordPresenceEnrollment, storeApprovalPresence, verifyApprovalPresence,
} from '../../plugins/aukora-aumlok/lib/approval-presence.mjs'

const execute = promisify(execFile)
// Packaged beside app.asar (extraResources); a development run uses the repository's own build output.
const helperPath = process.resourcesPath && !process.defaultApp
  ? join(process.resourcesPath, 'aukora-touchid')
  : fileURLToPath(new URL('../../out/touchid/aukora-touchid', import.meta.url))

export const PRESENCE_STATES = Object.freeze(['none', 'ready', 'confirmed', 'downgraded'])
const oneLine = (value, limit) => String(value ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
  .replace(/\s+/gu, ' ').trim().slice(0, limit)

export function createDesktopPresence(supportRoot, { helper = helperPath, run: runner } = {}) {
  const env = { ...process.env, AUKORA_SUPPORT_ROOT: supportRoot }
  const run = runner ?? ((args, timeout) => execute(helper, args,
    { env, timeout, killSignal: 'SIGKILL', maxBuffer: 8192 }))
  const history = join(supportRoot, 'state/home/aura-presence/aura.jsonl')

  /** The last chained state, or null. A chain that cannot be read is said out loud and treated as empty. */
  function lastRecorded() {
    try {
      const chain = readVerifiedChain(history)
      if (!chain.ok) {
        if (chain.reason !== 'record:truncated' || chain.line !== 0) console.warn(`aukora-desktop: presence history: ${chain.reason}`)
        return null
      }
      const last = chain.entries.at(-1)
      return PRESENCE_STATES.includes(last?.state)
        ? { state: last.state, reason: String(last.reason), from: String(last.from) } : null
    } catch { return null }
  }
  /** Chain a CHANGE of state, so every downgrade and every recovery is on record. Never throws. */
  function note(current) {
    try {
      const previous = lastRecorded()
      if (previous?.state === current.state && previous?.reason === current.reason && previous?.from === current.from) return
      mkdirSync(dirname(history), { recursive: true, mode: 0o700 })
      const lock = acquireAppendLock(history, { attempts: 1, spinMs: 0 })
      try {
        appendEntry({ file: history, lock, fields: { operation: 'presence.state', state: current.state,
          reason: current.reason, from: current.from, at: new Date().toISOString() } })
      } finally { releaseAppendLock(lock) }
    } catch (error) {
      console.warn(`aukora-desktop: presence history not written: ${String(error?.message ?? error)}`)
    }
  }

  async function state() {
    let current
    try {
      const enrollment = recordPresenceEnrollment({ supportRoot })
      if (!enrollment.enrolled && lastRecorded() === null) return { state: 'none', reason: 'never-enrolled' }
      if (enrollment.key === null) current = { state: 'downgraded', reason: enrollment.enrolled ? enrollment.reason : 'key-missing', from: 'enrollment' }
      else {
        // A healthy key keeps the last approval's own result until the next approval: confirmed stays confirmed,
        // and a check that produced no or bad evidence stays downgraded. Otherwise the key is ready.
        const previous = lastRecorded()
        current = previous?.from === 'approval' && ['verified', 'no-evidence', 'invalid'].includes(previous.reason)
          ? previous : { state: 'ready', reason: 'enrolled', from: 'enrollment' }
      }
    } catch { current = { state: 'downgraded', reason: 'invalid', from: 'enrollment' } }
    note(current)
    return current
  }

  /**
   * Ask Touch ID to sign sha256(signingBytes), AFTER Approve. Returns one of PRESENCE_REASONS and never throws.
   * `timeoutMs` is the reviewer's budget (presenceBudgetMs); the helper is killed when it ends.
   */
  async function sign(signingBytes, timeoutMs, operation) {
    let outcome = 'invalid'
    try {
      const enrollment = presenceEnrollment({ supportRoot })
      if (!enrollment.enrolled && lastRecorded() === null) return 'never-enrolled'
      if (enrollment.key === null) outcome = enrollment.enrolled ? enrollment.reason : 'key-missing'
      else {
        const timeout = Math.floor(Number(timeoutMs))
        let stdout = ''
        if (process.platform === 'darwin' && timeout >= 250) {
          const digest = createHash('sha256').update(signingBytes).digest('hex')
          try {
            stdout = String((await run(['sign', digest, oneLine(operation?.kind, 64) || 'operation',
              oneLine(operation?.reason, 160) || `digest ${digest.slice(0, 16)}`], timeout)).stdout ?? '').trim()
          } catch { stdout = '' }
        }
        if (stdout === '') outcome = 'no-evidence'
        else {
          const presence = { algorithm: 'p256-sha256', signature: stdout }
          outcome = verifyApprovalPresence(presence, signingBytes, { supportRoot, allowSidecar: false }).reason
          if (outcome === 'verified' && !storeApprovalPresence(presence, signingBytes, { supportRoot })) {
            console.warn('aukora-desktop: presence verified but its evidence file was not written')
          }
        }
      }
    } catch { outcome = 'invalid' }
    if (!PRESENCE_REASONS.includes(outcome)) outcome = 'invalid'
    note({ state: outcome === 'verified' ? 'confirmed' : 'downgraded', reason: outcome, from: 'approval' })
    return outcome
  }

  return Object.freeze({ state, sign })
}
