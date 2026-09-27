/**
 * ONE HASH-CHAINED AURA ENTRY PER DECISION, in `<auraDir>/aura.jsonl`.
 *
 * The chain rule is Kira's own: `chainAuraEntries` (plugins/aukora-kira/lib/memory-owner.mjs) owns `sequence`,
 * `prev` and `hash`, and refuses to chain onto a torn tail. This module calls it whenever it does not already know the
 * log's head, and otherwise extends the head it wrote last with the same rule (`auraEntryHash`) — so a busy session
 * does not re-read the whole log on every tool call. Any change to the file it did not make (its size moved) sends it
 * back to `chainAuraEntries`.
 *
 * WHAT AN ENTRY CARRIES: the session, the tool, the call id, a DIGEST of the arguments, the decision and the rule.
 * NEVER the raw arguments — a command can carry a secret — and never the path or host a refusal names.
 *
 * TWO THINGS KEEP THE GATE AVAILABLE WITHOUT HIDING ANYTHING:
 *   - the log ROTATES at `rotateBytes` into `aura-<sequence>-<hash12>.jsonl`, and the new log's first entry names the
 *     old file, its last sequence and its last hash inside its hashed body, so the segments stay linked;
 *   - a tail that cannot be chained onto (an interrupted append) is QUARANTINED, not repaired: the file is renamed
 *     `aura-unusable-<time>.jsonl`, and the new log's first entry records its name, its sha256 and the refusal code.
 *     A gap is therefore a recorded event, never a silent one.
 *
 * @module @aukora/dsh-plugin-action-gate/receipts
 */
import { createHash } from 'node:crypto'
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeSync } from 'node:fs'
import { join } from 'node:path'

import { auraEntryHash, chainAuraEntries } from '../../aukora-kira/lib/memory-owner.mjs'
import { canonicalJSON } from '../../aukora-kira/lib/record.mjs'

/** Domain separator for the argument digest. */
export const ARGS_DIGEST_DOMAIN = 'aukora:action-gate:args:v1'

/** Rotate well below the 64 MiB the strict reader under `chainAuraEntries` will read. */
export const DEFAULT_ROTATE_BYTES = 8 * 1024 * 1024

/**
 * sha256 over the domain, a NUL, and the canonical JSON of the arguments.
 * @param {unknown} args - the call's arguments.
 * @returns {string} lowercase hex.
 */
export function argsDigest(args) {
  let text
  try { text = canonicalJSON(args ?? null) } catch {
    try { text = JSON.stringify(args ?? null) } catch { text = String(args) }
  }
  return createHash('sha256').update(ARGS_DIGEST_DOMAIN).update(Buffer.from([0])).update(text, 'utf8').digest('hex')
}

/**
 * Open the receipt log for one directory.
 * @param {{auraDir: string, rotateBytes?: number, now?: () => Date}} options
 * @returns {{append: (body: Record<string, unknown>) => Readonly<Record<string, unknown>>, path: string}}
 */
export function createReceiptLog({ auraDir, rotateBytes = DEFAULT_ROTATE_BYTES, now = () => new Date() }) {
  const path = join(auraDir, 'aura.jsonl')
  /** What this process last wrote: the file size after it, and the head entry. */
  let head = null

  const sizeOf = () => { try { return statSync(path).size } catch { return 0 } }

  function write(entry) {
    const line = `${JSON.stringify(entry)}\n`
    const fd = openSync(path, 'a', 0o600)
    try {
      writeSync(fd, line)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    head = { size: sizeOf(), sequence: entry.sequence, hash: entry.hash }
    return entry
  }

  function startSegment(body) {
    // A fresh file: `chainAuraEntries` starts it at sequence 1 from the Aura domain separator.
    const [entry] = chainAuraEntries(auraDir, [body])
    return write(entry)
  }

  function append(body) {
    mkdirSync(auraDir, { recursive: true, mode: 0o700 })
    const size = sizeOf()
    if (head !== null && size === head.size && size >= rotateBytes) {
      const aside = join(auraDir, `aura-${String(head.sequence)}-${head.hash.slice(0, 12)}.jsonl`)
      renameSync(path, aside)
      const last = head
      head = null
      startSegment({ op: 'segment', by: 'aukora-action-gate/v1', at: now().toISOString(), reason: 'rotated', previousFile: aside.slice(auraDir.length + 1), previousSequence: last.sequence, previousHash: last.hash })
    }
    if (head === null || sizeOf() !== head.size) {
      let entry
      try {
        [entry] = chainAuraEntries(auraDir, [body])
      } catch (error) {
        if (error?.code !== 'AURA_TAIL_TORN') throw error
        const stamp = now().toISOString().replace(/[:.]/gu, '-')
        const aside = join(auraDir, `aura-unusable-${stamp}.jsonl`)
        const digest = createHash('sha256').update(readFileSync(path)).digest('hex')
        renameSync(path, aside)
        head = null
        startSegment({ op: 'segment', by: 'aukora-action-gate/v1', at: now().toISOString(), reason: 'previous-tail-unusable', previousFile: aside.slice(auraDir.length + 1), previousSha256: digest, code: error.code })
        return append(body)
      }
      return write(entry)
    }
    for (const reserved of ['sequence', 'prev', 'hash']) {
      if (Object.hasOwn(body, reserved)) throw new TypeError(`an Aura entry body may not carry \`${reserved}\`; the log owns it`)
    }
    const withSequence = { ...body, sequence: head.sequence + 1 }
    return write(Object.freeze({ ...withSequence, prev: head.hash, hash: auraEntryHash(head.hash, withSequence) }))
  }

  return Object.freeze({ append, path })
}
