/**
 * MACHINE FRAMES: WHAT THE SYSTEM SAID TO HER, WHICH IS NOT WHAT PETER SAID TO HER.
 *
 * A frame is text the harness wraps around injected material — `<<<BEGIN SCREEN CONTEXT #nonce — …>>>`. It is
 * machine speech. **WHEN A TURN IS CARRIED INTO A FRESH CONVERSATION, A FRAME MUST NEVER COME BACK AS PETER'S
 * WORDS.** Restoring one puts a page snapshot, a working-focus list or the contents of an attached file into his
 * mouth, as a thing he said, in a conversation that will quote it back to him.
 *
 * THE DEFECT. The guard was a regex written out by hand:
 *
 *     /<<<BEGIN (?:REPO LENS|WEB LENS|RECALL|LENS|WEIGHTS) #/
 *
 * and the frames this repository ACTUALLY emits are:
 *
 *     <<<BEGIN REPO LENS      <<<BEGIN RECALLED MEMORY    <<<BEGIN SCREEN CONTEXT
 *     <<<BEGIN WORKING FOCUS  <<<BEGIN ATTACHED FILE
 *
 * So two matched and **THREE DID NOT**: `SCREEN CONTEXT`, `WORKING FOCUS` and `ATTACHED FILE` were replayed as
 * Peter's own words every time a conversation was carried. The list and the regex had drifted apart, and nothing
 * connected them — which is the point of this module.
 *
 * **ONE LIST, AND THE REGEX IS BUILT FROM IT.** `tests/laya-auma-live-machine-frame.test.mjs` then compares the
 * list against every `<<<BEGIN …` literal that appears anywhere in the repository, so a NEW frame kind turns that
 * court red instead of silently becoming something Peter is supposed to have said.
 *
 * @module machine-frame
 */

/**
 * Every kind of machine frame that must never be replayed as the owner's words.
 *
 * The first six are the frames this repository emits today. `TOOL`, `KIRA` and `CORE` are named by Peter's
 * direction as frames the live voice will speak in; they are listed ahead of their first emission because the
 * cost of listing a frame that does not exist yet is nothing, and the cost of missing one that does is his words
 * being invented for him.
 */
export const MACHINE_FRAME_KINDS = Object.freeze([
  'REPO LENS',
  'WEB LENS',
  'SCREEN CONTEXT',
  'WORKING FOCUS',
  'RECALLED MEMORY',
  // **`RECALL` IS A DIFFERENT FRAME FROM `RECALLED MEMORY`, AND IT WAS THE ONE BEING EMITTED.** Recall-only results
  // are framed by `frameLensResults` from the field `{ frame: 'RECALL' }`, and no literal `<<<BEGIN RECALL` appears
  // anywhere — so this list, and the guard built from it, never saw it. A recall-only turn therefore produced a
  // machine message that survived as a user turn and was replayed as the owner's own words.
  //
  // It is a separate entry rather than a rename because the two are genuinely different: `RECALLED MEMORY` is a
  // record settled in her memory, `RECALL` is a cited excerpt from an earlier conversation. The guard's `(?![A-Z])`
  // lookahead keeps `RECALL` from matching `RECALLED`, so listing both is safe.
  'RECALL',
  'ATTACHED FILE',
  // What the other LANES have been doing: bookkeeping about a lane's own history, not speech.
  // Wider than any one deployment: a lens frame by any name, and the control frames.
  'LENS',
  'LANES',
  'WEIGHTS',
  'TOOL',
  'KIRA',
  'CORE',
])

/**
 * The guard, built from {@link MACHINE_FRAME_KINDS} so the two can never disagree.
 *
 * `(?![A-Z])` rather than the old ` #`: a frame carries a nonce (`#abc123`), and a pattern that demanded a
 * literal space-then-hash would miss any frame whose nonce were ever written differently. What makes it a frame
 * is the kind name, and the kind name must not be a PREFIX of a longer word — `LENS` must not match `LENSES`,
 * and `CORE` must not match `CORES`.
 */
export const MACHINE_FRAME = new RegExp(`<<<BEGIN (?:${MACHINE_FRAME_KINDS.join('|')})(?![A-Z])`)

/** Whether a message is machine speech rather than something a person said. */
export const isMachineFrame = (text: string): boolean => MACHINE_FRAME.test(text)

/** One turn as it will be replayed to a mind. */
export interface ReplayableTurn {
  readonly role: 'user' | 'assistant'
  readonly content: string
}

/**
 * The turns of a carried conversation, with machine frames and system prompts REMOVED.
 *
 * @param messages - the recorded turns, of unknown shape.
 * @param suffixes - transport suffixes to strip, so a mind's own marker is not read as part of its sentence.
 * @returns only what a person or the voice actually said.
 */
export function replayableTurns(
  messages: readonly unknown[],
  suffixes: readonly string[] = [],
): ReplayableTurn[] {
  return messages
    .filter((message): message is { role: string; content: string } =>
      typeof message === 'object' && message !== null
      && typeof (message as { role?: unknown }).role === 'string'
      && typeof (message as { content?: unknown }).content === 'string')
    // THE FRAME GUARD AND THE SYSTEM DROP ARE THE SAME DECISION: neither is a thing Peter said.
    .filter(message => message.role !== 'system' && !isMachineFrame(message.content))
    .map((message) => {
      const spoken = suffixes.reduce(
        (text, suffix) => (text.endsWith(suffix) ? text.slice(0, -suffix.length) : text),
        message.content,
      )
      return {
        role: message.role === 'assistant' ? 'assistant' as const : 'user' as const,
        content: spoken,
      }
    })
}
