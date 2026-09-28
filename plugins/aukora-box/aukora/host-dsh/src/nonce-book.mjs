/**
 * The single-use book, made atomic — the first real state the boundary owns.
 *
 * THE DECISION, recorded rather than defaulted. A grant is single-use, and an
 * in-memory `Set` dies with the process: a replay across a restart is free.
 * An append-only JSONL file is durable but not atomic: two processes that both
 * open the book before either writes both admit the same grant and persist two
 * rows (the N2 race this repo measured). The book writes and fsyncs a private
 * candidate, then atomically publishes the final nonce name with
 * `linkSync(candidate, path)`. That final-name create distinguishes a winner
 * from an already-claimed nonce without publishing partial bytes to a
 * concurrent opener. The claim happens INSIDE grant verification
 * (claim-at-verify, not at-executor), so a caller receives authority only
 * after publication and cleanup complete. A validated prior burn is replay;
 * an uncertain publication, durability, or cleanup outcome never admits.
 *
 * Claim file: `<stateDir>/nonces/<nonce>`, contents
 * `{"nonce":"<hex>","exp":<epoch-seconds>,"pid":<pid>,"ts":<epoch-ms>}`.
 * The directory is the record; no append, no lock file, no read-check-write.
 * Expiry bounds artifact validity, not the burn. A claim remains spent after
 * its expiry so a wall-clock rollback cannot make the original signed grant
 * usable again. The book therefore grows with admitted grants; state
 * retirement is an explicit operator action outside this reference, never a
 * clock-driven deletion inside admission. The in-memory `Set` seeded from the
 * claim directory stays the fast path and the refusal surface; it is not the
 * enforcement, the final-name hard-link publication is.
 *
 * Absent a state directory (`null`), the book fails closed AT OPEN: it
 * throws instead of returning an in-memory book whose claim always admits.
 * The permissive null-dir posture was removed as a fail-open default of the
 * kind grant.mjs hardened out — an optional security input is one an attacker
 * removes. The runtime resolves the state directory in code, never from a
 * cordis.yml field, so the shipped path always has one.
 *
 * The credential stays outside the process; this directory is bookkeeping,
 * not custody.
 *
 * @module @aukora/host-dsh/nonce-book
 */

import { closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'

/** The claim directory name, frozen — one home for the name. */
export const NONCE_DIR = 'nonces'

/** Inspect an existing final record without reserving or releasing its nonce. */
function claimRecordFailure(file, nonce) {
  let state
  let bytes
  try {
    state = lstatSync(file)
  } catch {
    return 'uncertain'
  }
  // A complete candidate has two names until its private staging link is removed.
  if (!state.isFile() || (state.nlink !== 1 && state.nlink !== 2)) return 'entry'
  try {
    bytes = readFileSync(file, 'utf8')
  } catch {
    return 'uncertain'
  }
  let record
  try {
    record = JSON.parse(bytes)
  } catch {
    return 'record'
  }
  const keys = record !== null && typeof record === 'object' ? Object.keys(record).sort() : []
  if (record === null || typeof record !== 'object'
    || Object.getPrototypeOf(record) !== Object.prototype
    || JSON.stringify(keys) !== JSON.stringify(['exp', 'nonce', 'pid', 'ts'])
    || record.nonce !== nonce
    || !Number.isSafeInteger(record.exp) || record.exp <= 0
    || !Number.isSafeInteger(record.pid) || record.pid <= 0
    || !Number.isSafeInteger(record.ts) || record.ts < 0) return 'record'
  return null
}

/**
 * Open the durable book.
 *
 * @param {string | null | undefined} stateDir - the boundary's state
 *   directory. Claim files live at `<stateDir>/nonces/<nonce>`.
 * @returns {{ set: Set<string>, claim: (nonce: string, exp: number) => true | false | 'malformed' | 'uncertain' }}
 *   `set` is seeded from the claim directory and shared with the guard's
 *   in-memory refusal; `claim` admits at most one caller per nonce across
 *   processes. A final record visible before a later durability or cleanup
 *   uncertainty stays spent. Only true admits; false denotes a validated prior
 *   burn, 'malformed' denotes invalid input or a malformed final record, and
 *   'uncertain' denotes an unconfirmed storage outcome. Failed attempts remain
 *   refused in this process without another filesystem claim. A fresh opener
 *   may confirm a visible final record, but cannot prove host-crash durability.
 */
export function openNonceBook(stateDir) {
  const set = new Set()
  const failures = new Map()
  if (stateDir === null || stateDir === undefined || stateDir === '') {
    throw new Error('nonce-book: a state directory is required; the in-memory fail-open is removed')
  }
  const dir = join(stateDir, NONCE_DIR)
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      // A nonce is the complete claim identity. Binding expiry into its
      // filename permitted two fresh processes to claim the same nonce with
      // distinct expiry values. The record holds expiry; the filename says
      // whether any live claim for this nonce already exists.
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(name)) {
        throw new Error(`nonce-book: malformed claim filename: ${name}`)
      }
      const failure = claimRecordFailure(join(dir, name), name)
      if (failure === 'uncertain') throw new Error(`nonce-book: claim state uncertain: ${name}`)
      if (failure !== null) throw new Error(`nonce-book: malformed claim ${failure}: ${name}`)
      set.add(name)
    }
  }
  return {
    set,
    claim: (nonce, exp) => {
      // Shape validation before anything touches the filesystem: a nonce is a
      // name, not a path. Slash/percent forms normalize onto other claims'
      // files or escape the directory entirely - refuse, never rewrite.
      if (typeof nonce !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(nonce)) return 'malformed'
      if (!Number.isSafeInteger(exp) || exp <= 0) return 'malformed'
      if (failures.has(nonce)) return failures.get(nonce)
      if (set.has(nonce)) return false
      const path = join(dir, nonce)
      const candidate = join(stateDir, `.nonce-candidate-${process.pid}-${randomBytes(16).toString('hex')}`)
      let fd
      let candidateCreated = false
      let publishing = false
      let published = false
      let result = 'uncertain'
      try {
        mkdirSync(dir, { recursive: true })
        // Do not expose the final nonce name until every byte is durable. A
        // concurrent opener parses final names as evidence, so `open(...wx)`
        // directly at `path` would let it read an empty or partial record.
        fd = openSync(candidate, 'wx', 0o600)
        candidateCreated = true
        writeFileSync(fd, `${JSON.stringify({ nonce, exp, pid: process.pid, ts: Date.now() })}\n`, 'utf8')
        fsyncSync(fd)
        closeSync(fd)
        fd = undefined
        // Hard-link publication is create-if-absent: EEXIST is the losing
        // reservation. `rename()` would overwrite a winner on POSIX/macOS.
        publishing = true
        linkSync(candidate, path)
        published = true
        publishing = false
        let directoryDescriptor
        try {
          directoryDescriptor = openSync(dir, 'r')
          fsyncSync(directoryDescriptor)
        } finally {
          if (directoryDescriptor !== undefined) closeSync(directoryDescriptor)
        }
        result = true
      } catch (error) {
        // A lost publication, unavailable state, or write uncertainty is a
        // refusal. It must never authorize an effect after an ambiguous burn.
        if (publishing && !published && error?.code === 'EEXIST') {
          const failure = claimRecordFailure(path, nonce)
          result = failure === null ? false : failure === 'uncertain' ? 'uncertain' : 'malformed'
        }
      }
      if (fd !== undefined) {
        try {
          closeSync(fd)
        } catch {
          result = 'uncertain'
        }
      }
      if (candidateCreated) {
        try {
          unlinkSync(candidate)
        } catch {
          // A published nonce with a lingering staging link is still a burn,
          // but its cleanup outcome is uncertain, so this request does not
          // receive authority to execute an effect.
          result = 'uncertain'
        }
      }
      // Preserve refusal even when publication could not be confirmed. The
      // public set records spending, while failures preserve its diagnosis.
      set.add(nonce)
      if (result === 'uncertain' || result === 'malformed') failures.set(nonce, result)
      return result
    },
  }
}
