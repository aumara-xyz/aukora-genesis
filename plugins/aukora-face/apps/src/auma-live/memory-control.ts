/**
 * THE OWNER'S CONTROL PHRASES, MATCHED ON HIS OWN WORDS.
 *
 * **`memory-design §2.3`, AND THE DESIGN SAYS *HIS WORDS* FOR A REASON.** These are not commands with a syntax to
 * learn: they are the sentences a person actually says — *"remember that"*, *"forget that"*, *"off the record"*,
 * *"stop remembering"*, *"someone's here"* — and **a control that requires a particular phrasing is one he will fail
 * to use at the moment he needs it.**
 *
 * **AND THE HARD PART IS NOT THE MATCHING, IT IS THE NEGATION.** *"Don't forget that"* contains *"forget that"*, and
 * **a module that forgets a memory because he asked her not to** is worse than one that does nothing: it destroys the
 * thing and reports success. Every pattern below is therefore checked against a leading negation, and the court
 * asserts the negative forms explicitly.
 *
 * @module memory-control
 */

/** What he asked for. */
export type MemoryControlIntent =
  | 'remember' | 'forget' | 'off-record' | 'stop-remembering' | 'someone-here'

/** One recognised phrase. */
export interface MemoryControl {
  readonly intent: MemoryControlIntent
  /** The words that matched, so the reply can quote him rather than paraphrase. */
  readonly matched: string
}

/**
 * **THE PHRASES, IN HIS WORDS.** Order matters: the longest and most specific first, so *"stop remembering"* is not
 * read as *"remember"* and *"off the record"* is not read as a request to record something.
 */
const PATTERNS: readonly (readonly [MemoryControlIntent, RegExp])[] = [
  ['stop-remembering', /\bstop remembering\b/iu],
  ['off-record', /\boff the record\b/iu],
  ['someone-here', /\bsomeone(?:'s| is) here\b/iu],
  ['remember', /\bremember (?:that|this)\b/iu],
  ['forget', /\bforget (?:that|this|it)\b/iu],
]

/**
 * **A NEGATION IN FRONT OF THE PHRASE MEANS HE ASKED FOR THE OPPOSITE.**
 *
 * *"Don't forget that"*, *"never forget that"*, *"don't you forget that"* — **all of them contain "forget that"**, and
 * acting on one deletes a memory he asked her to keep. The window is deliberately short: **a negation anywhere earlier
 * in a long sentence is not about this phrase**, and a matcher that looked further back would refuse to forget
 * something he asked to forget because of an unrelated *"no"*.
 */
const NEGATED = /\b(?:don'?t|do not|never|won'?t|not)\s+(?:\w+\s+){0,2}$/iu

/**
 * What, if anything, he asked for in this text.
 *
 * @param text - what he said, verbatim.
 * @returns the intent and the words that matched, or `null`.
 */
export function memoryControlIn(text: string): MemoryControl | null {
  if (typeof text !== 'string' || text.trim() === '') return null
  for (const [intent, pattern] of PATTERNS) {
    const match = pattern.exec(text)
    if (match === null) continue
    // **THE NEGATION IS CHECKED ON THE TEXT BEFORE THE MATCH**, and only as far back as the clause boundary — see
    // `NEGATED`. `forget` and `remember` are the two that can be negated into their opposite; *"someone's here"* has
    // no negative form a person says.
    if (intent === 'remember' || intent === 'forget') {
      const before = text.slice(0, match.index)
      if (NEGATED.test(before)) continue
    }
    return { intent, matched: match[0] }
  }
  return null
}

/**
 * **WHETHER A RECOGNISED PHRASE FORBIDS THIS TURN FROM BEING CAPTURED.**
 *
 * **THE DECISION IS SEPARATED FROM THE WIRING SO A COURT CAN DRIVE IT.** It lived inline in `index.ts`'s
 * `turnFinished`, where the only way to test it was to read the source — **so the callers of `memoryControlIn` were
 * zero and the decision itself was unprovable at the same time.** A court can call this.
 *
 * **THREE INTENTS SUPPRESS AND TWO DO NOT, AND THE TWO ARE THE POINT:**
 *
 * - **`off-record`** and **`stop-remembering`** are the owner refusing, in the same breath as the turn they govern.
 * - **`someone-here`** is a third person in the room. She is not refusing; **the turn is simply not hers to keep.**
 * - **`remember` and `forget` DO NOT SUPPRESS.** They are instructions *about* memory rather than refusals of it —
 *   **and suppressing on `forget` would leave "forget that" with nothing to act on**, which is a failure that would
 *   look exactly like the feature working.
 * - **`null` does not suppress** — no phrase was recognised, which is the ordinary turn.
 *
 * @param control - what {@link memoryControlIn} found in the owner's words, or `null`.
 * @returns true when the turn must not be offered to memory.
 */
export function suppressesCapture(control: MemoryControl | null): boolean {
  // **THE LIST IS WRITTEN AS WHAT SUPPRESSES, NOT AS WHAT DOES NOT.** A default-open reading of an unknown intent
  // would capture a turn somebody asked to withhold; **an unrecognised intent must fall to the safe side.** The union
  // is closed, so this is complete today — and a sixth intent added later would suppress until someone decided
  // otherwise, which is the direction a memory control has to fail in.
  return control !== null
    && control.intent !== 'remember'
    && control.intent !== 'forget'
}
