/**
 * WHICH THREAD AUMA LIVE IS SPEAKING THROUGH — one pure decision, so the apps corner can say it and a court can
 * measure it.
 *
 * WHY THIS IS NOT IN THE COMPONENT. A React file cannot be imported by a court, and the shell keeps learning
 * that lesson the expensive way: the rule ends up described in a comment and measured nowhere. The decision is
 * therefore here — `AumaThreadView` — and `AppFrame.tsx` only renders what this returns.
 *
 * WHAT IS DECIDED, AND ON WHAT EVIDENCE:
 *   · NO SELECTION IS NOT A GUESS. With no current session the view is `none`, and the corner says so rather
 *     than naming the last thing it saw. Peter asked never to have to guess; a stale name is worse than silence.
 *   · THE HOME THREAD IS THE AUMA LANE'S OWN THREAD. `AUMA_LANE` matches the lane word the thread titles carry
 *     and the board and the organism reader already use to name lanes (`LANE_PATTERN` in the organism reader).
 *     AUMA's auma-36 adds the home session; **when it lands with an authoritative marker, this predicate is the
 *     one line that changes** and nothing else in the shell has to move.
 *   · EVERY OTHER THREAD IS NAMED BY ITS OWN NAME, capped: the label sits in a narrow corner beside the menu
 *     tabs, and a title that overflows it would push the tabs instead of naming the thread.
 *   · A THREAD WITH NO NAME IS STILL NAMED. `SessionSummary.title` is optional until the host projects one, and
 *     an empty label would read as a broken label rather than as a thread that has not been titled yet, so the
 *     fallback carries part of the session id.
 *
 * @module auma-thread
 */

/** The lane word the AUMA lane's own thread carries. The home thread is the lane's thread. */
export const AUMA_LANE = /^auma\b/iu

/** Most characters of a thread's own name the corner will show. */
export const MAX_THREAD_CHARS = 60

/** What the corner says, as data: the words themselves belong to the dictionaries. */
export type AumaThreadView =
  | { readonly kind: 'none' }
  | { readonly kind: 'home' }
  | { readonly kind: 'thread'; readonly text: string }

/**
 * The thread Auma Live is speaking through, from the shell's live selection.
 *
 * @param input - the current session id and the name the thread list shows for it.
 * @returns which case the corner is in, and the name to print when it is an ordinary thread.
 */
export function aumaThreadOf(input: {
  // **`| undefined` IS SPELLED OUT, and the build is why**: this package compiles with
  // `exactOptionalPropertyTypes`, so an optional property that does not admit `undefined` cannot be handed the
  // `SessionId | undefined` a live store subscription produces. Without it the face does not build at all.
  sessionId?: string | null | undefined
  title?: string | null | undefined
  /**
   * THE HOME SESSION THE HOST NAMES, WHEN IT NAMES ONE — AUMA's auma-36 rides it on the minds response, the one
   * request the panel already makes. **IT WINS OVER THE TITLE RULE**: a configured home is an authority, and a
   * title that happens to start with the lane word is a guess. Absent, the title rule below is what remains.
   */
  homeSessionId?: string | null | undefined
}): AumaThreadView {
  const id = typeof input?.sessionId === 'string' ? input.sessionId.trim() : ''
  if (id === '') return { kind: 'none' }
  const home = typeof input?.homeSessionId === 'string' ? input.homeSessionId.trim() : ''
  if (home !== '') return id === home ? { kind: 'home' } : namedThread(id, input?.title)
  return namedThread(id, input?.title)
}

/** A thread that is not her home: its own name when it has one, and its id when the host has not titled it. */
function namedThread(id: string, rawTitle: string | null | undefined): AumaThreadView {
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : ''
  if (title !== '' && AUMA_LANE.test(title)) return { kind: 'home' }
  if (title === '') return { kind: 'thread', text: `thread ${id.slice(0, 12)}` }
  return {
    kind: 'thread',
    text: title.length <= MAX_THREAD_CHARS
      ? title
      : `${title.slice(0, MAX_THREAD_CHARS - 1).trimEnd()}…`,
  }
}
