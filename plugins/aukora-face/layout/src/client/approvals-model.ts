/**
 * APPROVAL HISTORY — what one row says, decided in one place so a court can hold it.
 *
 * Peter clicks real approvals in the real window. AUMLOK is adding the log
 * (`.agents/live/NOTE-TO-AUMLOK-approval-history-shape.md` is the shape this reads); until it lands a fixture stands in
 * for it. Three rules decide everything below, and each is a rule the goal names:
 *
 *  1. **NO KEY MATERIAL IS EVER RENDERED.** The log is digests: `operationDigest`, `displayedDigest`, and whatever a
 *     verify carries. None of it belongs on a screen — a digest of a signed operation is not a secret in the way a key
 *     is, but printing it teaches a person nothing and puts the machinery of signing in front of them. `approvalRowOf`
 *     therefore **drops them by construction**: the row type below has no field they could travel in.
 *  2. **THE DWELL AND THE DECISION ARE SHOWN EXACTLY AS LOGGED.** No rounding to "about two seconds", no prettifying
 *     `declined` into "you said no". A history that paraphrases the numbers is a history nobody can check against the
 *     log, and the whole point of a history is that it can be checked.
 *  3. **THE BADGE FILLS ONLY FROM A REAL VERIFY.** Until signing requires Touch ID, the truth is that somebody at this
 *     Mac clicked Approve and nothing proves it was Peter — so that sentence is the default, and a settle that has not
 *     been verified is never marked green.
 *
 * @module approvals-model
 */


/** The surface's name, in one place: the menu opens it, the shell registers it, and a court can name it without a literal. */
export const APPROVALS_SURFACE = 'approvals'

/** What one logged approval carries. Digests are present here because the log has them; they never reach a row. */
export interface ApprovalEntry {
  /** When it was asked, as an ISO instant. */
  readonly at: string
  /** The operation's kind — what the row NAMES. */
  readonly kind: string
  /** The subject in plain words — what the row SHOWS. */
  readonly subject: string
  readonly operationDigest?: string
  readonly displayedDigest?: string
  /** What the words-check said about the text Peter was shown. */
  readonly wordsCheck?: 'match' | 'mismatch' | 'unchecked' | string
  /** What he said, truncated to yes/no as the goal describes. */
  readonly spoken?: 'yes' | 'no' | null
  readonly decision: 'approved' | 'declined' | 'pending' | string
  /** How long he looked, in milliseconds, exactly as logged. */
  readonly dwellMs?: number | null
  /** Whether the settled effect has been verified. Absent means it has not. */
  readonly verify?: { readonly state?: string; readonly at?: string } | null
  /** The raw text he was shown. **Never rendered unless the owner opens it.** */
  readonly displayedText?: string | null
}

/** One row of the history. **It has no field a digest could travel in** — that is the design, not an omission. */
export interface ApprovalRow {
  readonly at: string
  readonly kind: string
  readonly subject: string
  readonly decision: string
  /** The dwell exactly as logged, or null when the log carried none. Never rounded, never estimated. */
  readonly dwellMs: number | null
  readonly spoken: string | null
  readonly wordsCheck: string
  /** Whether there is raw text the owner could open. The text itself is not on the row. */
  readonly openable: boolean
  readonly badge: BadgeState
}

/** The badge: green only from a verify, and otherwise one of two honest not-green states. */
export type BadgeState =
  | { readonly state: 'verified'; readonly glyph: '✓' }
  | { readonly state: 'unverified'; readonly glyph: '·' }
  | { readonly state: 'unsettled'; readonly glyph: '–' }

/**
 * The badge for one approval.
 *
 * **THREE ANSWERS, AND ONLY ONE OF THEM IS A TICK.** A decision that has not settled cannot be verified at all, so it
 * is `unsettled`; a settled decision whose effect has not been checked is `unverified`; and only `verify.state ===
 * 'verified'` — a real verify of the settled effect — earns the tick. Nothing else does, and no arrangement of missing
 * fields can produce it.
 */
export function badgeOf(entry: ApprovalEntry): BadgeState {
  if (entry.decision === 'pending') return { state: 'unsettled', glyph: '–' }
  return entry.verify?.state === 'verified' ? { state: 'verified', glyph: '✓' } : { state: 'unverified', glyph: '·' }
}

/**
 * One row, from one entry.
 *
 * The digests stay in the entry and out of the row; the subject is shown as it was logged rather than rewritten; and a
 * log entry that carries no subject says so instead of borrowing the kind and pretending it is a description.
 */
export function approvalRowOf(entry: ApprovalEntry): ApprovalRow {
  const subject = typeof entry.subject === 'string' ? entry.subject.trim() : ''
  return {
    at: entry.at,
    kind: entry.kind,
    subject: subject === '' ? '' : subject,
    decision: entry.decision,
    // **EXACTLY AS LOGGED.** A missing dwell stays missing; it is never filled with a zero or an estimate.
    dwellMs: typeof entry.dwellMs === 'number' && Number.isFinite(entry.dwellMs) ? entry.dwellMs : null,
    spoken: entry.spoken === 'yes' || entry.spoken === 'no' ? entry.spoken : null,
    wordsCheck: typeof entry.wordsCheck === 'string' && entry.wordsCheck !== '' ? entry.wordsCheck : 'unchecked',
    openable: typeof entry.displayedText === 'string' && entry.displayedText !== '',
    badge: badgeOf(entry),
  }
}

/** The rows, newest first, which is the order a history is read in. */
export function approvalRowsOf(entries: readonly ApprovalEntry[] | null | undefined): readonly ApprovalRow[] {
  if (!Array.isArray(entries)) return []
  return entries.map(approvalRowOf).slice().sort((left, right) => right.at.localeCompare(left.at))
}

/** The raw text, for the one caller allowed to have it: the owner opening a row. Never called by a row renderer. */
export function openedTextOf(entry: ApprovalEntry): string | null {
  return typeof entry.displayedText === 'string' && entry.displayedText !== '' ? entry.displayedText : null
}

/**
 * THE SENTENCE THAT MUST BE THERE UNTIL SIGNING REQUIRES TOUCH ID.
 *
 * The goal asks for it in these words, and it is the honest state of the world: a click at this Mac is not proof of
 * who made it, and the app has no way to tell. This is a fact of the product, not of one row, which is why it is a
 * constant here rather than something each row composes.
 */
export const NO_PROOF_LINE = 'someone at this Mac clicked Approve; the app cannot yet prove it was you'

/** Whether the no-proof line is the truth right now. Signing requiring Touch ID is what would end it. */
export function noProofApplies(signingRequiresTouchId: boolean): boolean {
  return !signingRequiresTouchId
}
