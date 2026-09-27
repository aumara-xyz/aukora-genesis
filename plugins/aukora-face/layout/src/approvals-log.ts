/**
 * THE APPROVAL LOG, READ FROM DISK — and the digests stopped at the host.
 *
 * AUMLOK is adding the approval event log: `operationDigest`, a digest of the displayed text, the words-check result, a
 * truncated yes/no, the decision, dwell ms and the time — digests only, mode 0600, under `state/logs`. **It has not
 * landed yet** (measured: no writer for it exists in the tree, and their `approval-receipt.mjs` carries
 * `operationDigest` but neither `dwell` nor a words check), so the view reads the fixture and the shape I sent them in
 * `.agents/live/NOTE-TO-AUMLOK-approval-history-shape.md`.
 *
 * **ONE DECISION IS MINE AND IS STRONGER THAN THE GOAL ASKS.** The goal requires that no key material is ever
 * *rendered*. A digest of a signed operation is not a key, but printing it teaches a person nothing and puts the
 * machinery of signing in front of them — so the reader **drops the digests before the entries leave the host**. A
 * browser cannot render what it was never sent, which is a stronger guarantee than a promise made in a renderer.
 *
 * **AND A FILE THAT CANNOT BE READ IS NOT AN EMPTY HISTORY.** A missing log and a log whose every line is broken are
 * different facts, and this reader keeps them apart: `absent` says nobody has logged anything yet, `skipped` says
 * something is there and could not be understood. The view can then tell the truth about which one happened.
 *
 * @module approvals-log
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Where the log is expected. **A PROPOSAL UNTIL AUMLOK NAMES THEIRS** — the name is in the note I sent them. */
export const APPROVAL_LOG_RELATIVE = 'logs/approvals.jsonl'

/** Named so a reader can see WHAT is deliberately not carried: these never appear in the return below. */
export const NEVER_CARRIED = ['operationDigest', 'displayedDigest', 'signature', 'grant', 'nonce'] as const

/** What the host knows about one approval, with the digests already gone. */
export interface LoggedApproval {
  readonly at: string
  readonly kind: string
  readonly subject: string
  readonly wordsCheck: string
  readonly spoken: 'yes' | 'no' | null
  readonly decision: string
  readonly dwellMs: number | null
  readonly verify: { readonly state: string } | null
  /** The text he was shown, kept so the owner may open it — **never sent to a renderer that has not asked**. */
  readonly displayedText: string | null
}

/** What reading the log produced, keeping "nothing there" apart from "nothing understood". */
export interface ApprovalLogRead {
  /** The entries, newest first, with no digest on any of them. */
  readonly entries: readonly LoggedApproval[]
  /** True when there is no log file at all, which is a fresh machine rather than a fault. */
  readonly absent: boolean
  /** How many lines were present and could not be understood. Non-zero is worth saying out loud. */
  readonly skipped: number
  /** The file's permission bits, or null when there is no file. A log the whole machine can read is worth reporting. */
  readonly mode: number | null
}

/** One parsed line, or null. **A broken line is skipped, not thrown** — one bad write must not hide a history. */
function entryOf(line: string): LoggedApproval | null {
  const trimmed = line.trim()
  if (trimmed === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const raw = parsed as Record<string, unknown>
  const kind = typeof raw.kind === 'string' ? raw.kind : ''
  const at = typeof raw.at === 'string' ? raw.at : ''
  if (kind === '' || at === '') return null
  const verify = raw.verify !== null && typeof raw.verify === 'object'
    ? { state: typeof (raw.verify as { state?: unknown }).state === 'string' ? String((raw.verify as { state: string }).state) : 'unverified' }
    : null
  // **THE RETURN BELOW IS THE ALLOW-LIST, AND THAT IS THE WHOLE MECHANISM.** Every field is picked by name, so a
  // digest, a signature, a grant or a nonce cannot travel — and neither can a secret-shaped field somebody adds
  // upstream next month. My first version spread the raw object and then deleted `DIGEST_FIELDS` from the copy, which
  // was worse than useless: the picks below already excluded them, so the deletion protected nothing while looking
  // exactly like the protection. Dead code that reads as a guard is the class this lane keeps finding.
  return {
    at,
    kind,
    subject: typeof raw.subject === 'string' ? raw.subject : '',
    wordsCheck: typeof raw.wordsCheck === 'string' && raw.wordsCheck !== '' ? raw.wordsCheck : 'unchecked',
    spoken: raw.spoken === 'yes' || raw.spoken === 'no' ? raw.spoken : null,
    decision: typeof raw.decision === 'string' ? raw.decision : 'pending',
    dwellMs: typeof raw.dwellMs === 'number' && Number.isFinite(raw.dwellMs) ? raw.dwellMs : null,
    verify,
    displayedText: typeof raw.displayedText === 'string' && raw.displayedText !== '' ? raw.displayedText : null,
  }
}

/**
 * Read the approval log for one state root.
 *
 * @param stateRoot - the running app's state root, or null when the process has none.
 * @returns the entries with no digest on them, and which of the three situations this was.
 */
export function readApprovalLog(stateRoot: string | null): ApprovalLogRead {
  if (stateRoot === null) return { entries: [], absent: true, skipped: 0, mode: null }
  const path = join(stateRoot, APPROVAL_LOG_RELATIVE)
  if (!existsSync(path)) return { entries: [], absent: true, skipped: 0, mode: null }
  let mode: number | null = null
  try {
    mode = statSync(path).mode & 0o777
  } catch {
    mode = null
  }
  let text = ''
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    // THE FILE IS THERE AND COULD NOT BE READ. That is not "absent" and it is not "empty": it is a fault, and the
    // count of skipped lines is how the caller learns there was something it could not see.
    return { entries: [], absent: false, skipped: 1, mode }
  }
  const entries: LoggedApproval[] = []
  let skipped = 0
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    const entry = entryOf(line)
    if (entry === null) skipped += 1
    else entries.push(entry)
  }
  entries.sort((left, right) => right.at.localeCompare(left.at))
  return { entries, absent: false, skipped, mode }
}
