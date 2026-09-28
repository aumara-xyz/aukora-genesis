/**
 * The code Aura chain (state/home/aura-code/aura.jsonl) as self-change.mjs and advance.mjs use it: every append is
 * locked (Kira's withFileLock, the lock memory-owner's own appends take), and the kernel's spent set is tied to the
 * chain so neither can silently lose the other.
 *
 *   approved entry      written after the kernel consumed the approval: carries approvalId (the kernel's id,
 *                       `approval:<signed challenge>`) and consumedBy: 'aukora-kernel'
 *   <op>.result entry   what the remote says after the push: completed | not-completed | uncertain. Only a definite
 *                       result (completed, not-completed) closes an approval; an uncertain one is looked at again on the
 *                       next run, and the latest result is the one that counts.
 *   approval.unused     an id the kernel consumed that has no approved entry or commit journal: the approval is
 *                       spent, but whether anything was applied is uncertain. A commit journal instead recovers a
 *                       code.change entry for remote-result reconciliation; it never authorizes another push.
 *
 * THE SPENT SET CANNOT BE RESET BY DELETING IT: once the chain holds an entry consumed by the kernel, a missing
 * consumed-ids.json is refused (decide.mjs is called without --create-consumed-ids). The same user can still edit both
 * files; decide.mjs also compares against the witness outside state/. Rewriting state AND that witness as the same
 * UID defeats rollback refusal; the planned Airlock witness owner is not enforced here.
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { chainAuraEntries } from '../../plugins/aukora-kira/lib/memory-owner.mjs'
import { withFileLock } from '../../plugins/aukora-kira/lib/strict-read.mjs'

export const DEFINITE = Object.freeze(new Set(['completed', 'not-completed']))

export function codeChain(stateDir) {
  const dir = join(stateDir, 'home', 'aura-code')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const log = join(dir, 'aura.jsonl')
  const consumedIds = join(dir, 'consumed-ids.json')
  const read = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [])
  const locked = (fn) => withFileLock(log, fn)
  const append = (record) => locked(() => {
    const [entry] = chainAuraEntries(dir, [record])
    const fd = openSync(log, 'a', 0o600)
    try { writeSync(fd, `${JSON.stringify(entry)}\n`); fsyncSync(fd) } finally { closeSync(fd) }
    return entry
  })
  /** decide.mjs may start an empty spent set only while no approval in the chain was consumed by the kernel. */
  const mayCreateSpentSet = () => !read().some((e) => e.consumedBy === 'aukora-kernel')
  /** Approvals already closed by a definite result, keyed by the kernel id (or, for entries before it, the artifact digest). */
  const closedKeys = (resultOp, entries) => new Set(entries
    .filter((e) => e.operation === resultOp && DEFINITE.has(e.outcome))
    .map((e) => e.approvalId ?? e.approvalDigest))
  /** Recover local commits before classifying unrecorded spent ids. Journals are evidence, never push authority. */
  const closeUnused = () => {
    if (!existsSync(consumedIds)) return []
    const entries = read()
    const known = new Set(entries.filter((e) => e.approvalId !== undefined).map((e) => e.approvalId))
    const record = JSON.parse(readFileSync(consumedIds, 'utf8'))
    const spent = (record.storeSchema === 1 ? record.state : record).consumedIds ?? []
    const missing = spent.filter((id) => !known.has(id))
    if (!missing.length) return []
    const committed = new Map()
    const evidenceRoot = join(stateDir, 'home', 'code-evidence')
    for (const directory of existsSync(evidenceRoot) ? readdirSync(evidenceRoot, { withFileTypes: true }) : []) {
      if (!directory.isDirectory()) continue
      const path = join(evidenceRoot, directory.name, 'journal.jsonl')
      if (!existsSync(path)) continue
      for (const line of readFileSync(path, 'utf8').split('\n').filter(Boolean)) {
        let record
        try { record = JSON.parse(line) } catch {
          process.stderr.write(`RECONCILE: unreadable journal record in ${path}; it supplies no commit evidence\n`)
          continue
        }
        if (!record || typeof record !== 'object') continue
        if (['COMMITTED', 'COMMITTED_NO_AURA'].includes(record.state) && record.change?.operation === 'code.change'
            && record.change.commit === record.commit && missing.includes(record.change.approvalId)) {
          committed.set(record.change.approvalId, { ...record.change, recoveryState: 'COMMITTED_NO_AURA', recoveredFrom: path })
        }
      }
    }
    return missing.map((approvalId) => append({
      ...(committed.get(approvalId) ?? { operation: 'approval.unused', approvalId, outcome: 'uncertain', consumedBy: 'aukora-kernel' }),
      verdict: 'reconciled', reconciledAt: new Date().toISOString(),
    }))
  }
  return Object.freeze({ dir, log, consumedIds, read, locked, append, mayCreateSpentSet, closedKeys, closeUnused })
}

/** The kernel's approval id from decide.mjs output (`  approval id: approval:<challenge>`), or null. */
export const approvalIdFrom = (stdout) => /approval id: (\S+)/u.exec(String(stdout ?? ''))?.[1] ?? null
