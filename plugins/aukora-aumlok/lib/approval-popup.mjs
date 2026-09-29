/**
 * The native approval popup: the exact bytes, shown before the signer decides.
 *
 * D2: *"The signer presents the operation and returns a signature or a refusal."* A terminal print
 * is a presentation, but it is a presentation to whoever is looking at the scrollback — including
 * nobody, in an unattended process. The popup is the presentation that cannot be scrolled past: a
 * native modal naming the operation, the identity and the challenge, with an explicit approve and
 * an explicit refuse.
 *
 * WHAT THE POPUP IS FOR, AND WHAT IT IS NOT FOR. It exists so that a person sees the EXACT BYTES
 * before they are signed, which is the only defence against being asked to approve something other
 * than what was shown. It is not a security boundary: the answer is read by the same process that
 * holds the key, on the same UID, and a process that can read the key can bypass the dialog
 * entirely. The popup raises what a person can SEE; it does not lower what an attacker who already
 * runs as this UID can DO. `OWNER_KEY_SAME_UID` stays printed for exactly that reason.
 *
 * THE TEXT IS A PURE FUNCTION. `approvalPopupText` builds the string and opens nothing, so the
 * court can assert the exact bytes and the challenge appear WITHOUT a dialog ever being raised on a
 * machine that has a display — a test that popped dialogs would be a test nobody could run twice.
 *
 * @module @aukora/dsh-plugin-aumlok/approval-popup
 */
import { canonicalJSON } from './canonical.mjs'
import { parseApprovalRequest } from './owner-approval.mjs'

/** Refusals this module produces by name. */
export const POPUP_REFUSE = Object.freeze({
  UNAVAILABLE: 'signer:popup-unavailable',
  MALFORMED: 'signer:popup-request-malformed',
})

/** The two answers the dialog offers, as the button labels the native dialog shows. */
export const POPUP_BUTTONS = Object.freeze({ APPROVE: 'Approve', REFUSE: 'Refuse' })

/**
 * The exact text of the native approval dialog.
 *
 * The canonical bytes are placed verbatim, because a summary is what a substituted operation hides
 * behind: if the popup paraphrased, the paraphrase is what a person would be approving.
 * @param {unknown} requestInput - the approval request the signer was asked to sign.
 * @returns {string} the dialog text.
 */
export function approvalPopupText(requestInput) {
  let request
  try {
    request = parseApprovalRequest(requestInput)
  } catch (cause) {
    throw new TypeError(`${POPUP_REFUSE.MALFORMED}: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  const bytes = canonicalJSON(request)
  return [
    'AUKORA — owner approval requested',
    '',
    `Identity: ${request.subject}`,
    `Control head: ${request.activeControlDigest}`,
    '',
    'Operation (digest):',
    `  ${request.operationDigest}`,
    '',
    'Challenge:',
    `  ${request.challenge}`,
    '',
    `Window: ${String(request.issuedAt)} → ${String(request.expiresAt)}`,
    '',
    'EXACT BYTES TO BE SIGNED:',
    `  ${bytes}`,
    '',
    `Approve signs exactly those bytes. Refuse signs nothing.`,
  ].join('\n')
}

/**
 * The `osascript` argv that raises the dialog, given text that has already been built.
 *
 * Kept separate from both the text and the spawn so that the argv is assertable without running a
 * process. The default button is Refuse: a dialog dismissed with the Return key, or closed by the
 * window manager, must not be an approval.
 * @param {string} text - the dialog text from {@link approvalPopupText}.
 * @returns {string[]} argv for `osascript`.
 */
export function approvalPopupArgv(text) {
  const quoted = text.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')
  return [
    // AUDIBLE FIRST. A dialog that appears in silence is a dialog that gets missed, and a missed
    // dialog expires unsigned — the approval never happens and nothing is signed. Three system
    // beeps fire the instant the dialog is raised, before it is shown, so the alert and the dialog
    // arrive together. The sound adds no authority: the default button is still Refuse, so a
    // dialog dismissed with Return or closed by the window manager still signs nothing.
    //
    // ONE BURST, NOT A REPEAT. Making the alert continue for as long as the dialog stays open
    // needs either a background sound child owned by the caller — and the caller is
    // `scripts/aumlok/signer.mjs`, a fenced self-protecting path, because it holds the owner key —
    // or an AppleScript rewrite that wraps `display dialog` in a try block, which risks the
    // `button returned:Approve` parsing that `popupDecision` depends on. Neither is worth doing
    // blind, so this ships the honest one-burst version; a repeating alert is a separate,
    // deliberate change.
    '-e',
    'beep 3',
    '-e',
    `display dialog "${quoted}" buttons {"${POPUP_BUTTONS.REFUSE}", "${POPUP_BUTTONS.APPROVE}"} `
    + `default button "${POPUP_BUTTONS.REFUSE}" with title "AUKORA" with icon caution`,
  ]
}

/**
 * Decide what the dialog's outcome means. PURE, so the decision is testable without raising one.
 *
 * `unavailable` and `refused` both yield NO signature, and they are deliberately distinct: "there
 * was no display to ask on" and "a person said no" are different facts, and collapsing them would
 * make an unattended host look like a refusal by someone.
 * @param {{status: number | null, stdout?: string | null, errorCode?: string | null}} outcome - the finished process.
 * @returns {'approved' | 'refused' | 'unavailable'} the decision.
 */
export function popupDecision({ status, stdout, errorCode }) {
  if (errorCode !== null && errorCode !== undefined) return 'unavailable'
  if (status !== 0) return 'unavailable'
  return /button returned:Approve/u.test(stdout ?? '') ? 'approved' : 'refused'
}
