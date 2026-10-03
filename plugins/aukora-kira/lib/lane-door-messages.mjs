// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * **THE LANE DOOR'S OWN MESSAGES, IDENTIFIED BY SOMETHING OTHER THAN THEIR TEXT.**
 *
 * *Measured 2026-09-27:* **129 of 143 "remembered" memories were lane-door orchestration**, because a message sent through
 * the door arrives in the session as an ordinary `user/message` with `source: {kind: 'user'}` — *indistinguishable from
 * Peter's own words by anything the harness stamps.*
 *
 * ## Why the prefix alone was not enough
 *
 * `isRealAsk` excluded them only by the text prefix `[fable via lane door]`, which holds today and is not a property of
 * the message. **Anything that rewrites, quotes, prefixes or reformats that text loses the exclusion silently** — *and the
 * failure mode is a lane's orchestration being remembered as though Peter had said it.*
 *
 * ## The structural signal, and where it comes from
 *
 * CORRECTED 2026-09-27. This said the signal was the `messageId` that `session/prompt` returns, citing
 * `vendor/dsh/packages/sdk/server/src/server.ts:192`. That is the SDK server, a different surface. The app's own
 * `session/prompt`, the one the door calls, returns no message id at all; it keeps the door's request id instead:
 *
 * ```
 * vendor/dsh/packages/api/session-controller/src/commands.ts:327   const source: MessageSource = {
 * vendor/dsh/packages/api/session-controller/src/commands.ts:329     rpcId: request.requestId,
 * vendor/dsh/packages/api/session-controller/src/commands.ts:367   return { accepted: true }
 * ```
 *
 * The `user/message` event carries `source` (disposition `['role', 'id', 'content', 'source']`), so the door's request id
 * arrives as `data.source.rpcId` (`session-controller/src/client/contract/snapshot.ts:61` says the same).
 *
 * **SO THE DOOR WRITES DOWN THE REQUEST IDS IT SENT, AND THE HOOKS EXCLUDE BY `source.rpcId`.** *The prefix REMAINS as a
 * second check, for a session whose door was never recorded and for a message that arrived before this file existed.*
 *
 * ## Why a file, and why this one
 *
 * *The door and the Kira hooks are different processes, so the ids have to cross a file.* **Both sides import THIS module
 * rather than computing the path**, *because two spellings of one path is how a reader and a writer end up looking at
 * different files while both report success.*
 */
import { appendFileSync, chmodSync, closeSync, constants, existsSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** **THE ONE PLACE THE PATH IS SPELLED.** *Beside the door's own ledger, under the same state root.* */
export function laneDoorMessagesPath(stateRoot) {
  return join(stateRoot, 'lane-door', 'prompted-messages.jsonl')
}

/**
 * **RECORD ONE MESSAGE THE DOOR CAUSED.**
 *
 * *Append-only and never rewritten:* **a session log is read after the fact**, so a file that the door truncates on start
 * would lose the ids of messages still sitting in a session from before the restart.
 *
 * @param stateRoot - the door's state root; the same one `laneLedgerPath` is built from.
 * @param requestId - **the `requestId` the door sent, which the harness accepted.** *An absent one is NOT recorded* —
 *   *a line with no id would be an exclusion that excludes nothing.*
 * @param origin - the lane the message came from, for a person reading the file.
 * @returns whether a line was written.
 */
export function recordLaneDoorMessage(stateRoot, requestId, origin = null) {
  if (typeof requestId !== 'string' || requestId === '') return false
  const path = laneDoorMessagesPath(stateRoot)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  chmodSync(dirname(path), 0o700)
  // **O_NOFOLLOW, THE SAME AS THE LEDGER.** *A trail that can be redirected is not a trail* — *and this file decides what
  // is remembered, so a link here would let one be moved somewhere the reader is not.*
  const fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600)
  try {
    writeSync(fd, `${JSON.stringify({ requestId, origin, at: Date.now() })}\n`)
  } finally {
    closeSync(fd)
  }
  return true
}

/**
 * **EVERY ID THE DOOR HAS RECORDED**, as a set a predicate can test in constant time.
 *
 * **A MISSING FILE IS AN EMPTY SET, NOT AN ERROR.** *A door that has never run has caused no messages*, and refusing to
 * evaluate the predicate would make every session unreadable on a machine where no lane has ever spoken — **which is the
 * fail-closed pin in the wrong direction.**
 *
 * @param stateRoot - the door's state root.
 * @returns a set of request ids (a message's `source.rpcId`); empty when the file is absent or unreadable.
 */
export function laneDoorMessageIds(stateRoot) {
  const path = laneDoorMessagesPath(stateRoot)
  if (!existsSync(path)) return new Set()
  const ids = new Set()
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    // **A FILE THAT CANNOT BE READ EXCLUDES NOTHING RATHER THAN EVERYTHING.** *The prefix still applies*, so an unreadable
    // file degrades to the old behaviour — *which is the safe direction, because the alternative is treating every
    // message as orchestration and remembering nothing Peter says.*
    return new Set()
  }
  for (const line of raw.split('\n')) {
    if (line === '') continue
    try {
      const entry = JSON.parse(line)
      if (typeof entry?.requestId === 'string' && entry.requestId !== '') ids.add(entry.requestId)
    } catch { /* a torn last line is skipped, and the ids before it still count */ }
  }
  return ids
}
