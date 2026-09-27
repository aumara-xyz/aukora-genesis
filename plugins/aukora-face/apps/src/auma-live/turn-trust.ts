/**
 * WHEN A TURN IS ALREADY UNTRUSTED BEFORE IT SPEAKS.
 *
 * THE DEFECT. A turn's prompt is assembled BEFORE the first segment is generated, and four of its blocks carry
 * words that did not come from Peter:
 *
 *   · **the organism lens** — repository content, read out of files;
 *   · **the claims packet** — repository content again;
 *   · **the cross-lane block** — what OTHER lanes have said;
 *   · **the screen context** — what the page is showing.
 *
 * Those blocks are model-visible from the very first token, so the turn is composed with outside words in
 * context **before the model has said anything at all**. A turn in that state is UNTRUSTED FROM SEGMENT 0.
 *
 * But the flag was initialised to `false` and only ever set by a lens result DURING the turn — so the first
 * segment was treated as trusted, and the one protection that reads the flag was available on exactly the turns
 * it exists for: with `untrustedInTurn` false, `weightsAsked` was not suppressed, and a `[weights …]` directive
 * in a turn whose prompt already held repository bytes or another lane's words could be honoured. **The flag
 * guarded the second segment onward and left the first one open.**
 *
 * @module turn-trust
 */

/**
 * The blocks whose presence means outside words are already in the prompt.
 *
 * Exported as a LIST so a court can require each one to be consulted individually — the defect was one of them
 * being forgotten, and a list is what makes "forgotten" visible.
 */
export const OUTSIDE_WORD_BLOCKS = Object.freeze([
  'organism', 'claims', 'crossLane', 'lanes', 'screen',
  // **THE REPO LENS IS A SECOND DOOR FOR THE SAME BYTES.** `organism` covers the organism render, but the repo
  // LENS block is its own path into the system prompt, and it was missing here — so a deployment with the lens
  // wired and the organism lens absent composed a first segment holding file content while the turn counted as
  // trusted. Two doors into the prompt, one of them unwatched.
  'repo',
] as const)

/** The blocks, as assembled for one turn. A block that was not offered is the empty string. */
export interface TurnBlocks {
  /** The organism render: repository content, read per turn. */
  readonly organism?: string
  /** **THE ORGANISM DOCUMENT'S OWN TEXT** — see `honesty.ts`; the two lenses are never one field. */
  readonly organismState?: string
  /** The claims packet, with its discipline. */
  readonly claims?: string
  /** What the other lanes have said. */
  readonly crossLane?: string
  /** What the other lanes have been DOING: compaction notes and finished turns, under a machine frame. */
  readonly lanes?: string
  /** The page state the browser reported. */
  readonly screen?: string
  /** The repository lens block: the summary plus its honesty rails, read per turn. */
  readonly repo?: string
}

/**
 * Whether this turn is already untrusted before its first segment.
 *
 * **ANY ONE NON-EMPTY BLOCK IS ENOUGH**, and whitespace is not a block: `honestyRails` and the other joiners
 * prepend a space, so a block that was not offered can arrive as `' '`, and a check on `.length > 0` alone would
 * mark every turn untrusted and quietly turn the flag into a constant — which is a different way to lose the
 * protection, not a safer one.
 *
 * @param blocks - the four blocks as assembled.
 * @returns true when outside words are already in the prompt.
 */
export function turnStartsWithUntrusted(blocks: TurnBlocks): boolean {
  return OUTSIDE_WORD_BLOCKS.some((name) => (blocks[name] ?? '').trim().length > 0)
}

/**
 * Why the turn is untrusted, in the blocks' own names. Empty when it is not.
 *
 * Returned rather than logged because the reason belongs in whatever record the caller keeps; a flag with no
 * reason is how "the weights arm was withheld" becomes unanswerable later.
 *
 * @param blocks - the four blocks as assembled.
 * @returns the names of the non-empty blocks, in list order.
 */
export function untrustedBlockNames(blocks: TurnBlocks): string[] {
  return OUTSIDE_WORD_BLOCKS.filter(name => (blocks[name] ?? '').trim().length > 0)
}
