/**
 * THE HONESTY RAILS — ONE SENTENCE ABOUT WHAT THIS LANE CAN AND CANNOT DO.
 *
 * The rails are spoken to her as part of her system message, and they are the only place the prompt states her own
 * limits. That makes a wrong rail worse than a missing one: **every other block tells her what to do, and this one
 * tells her what she IS.** A rail that denies a capability she has teaches her to disbelieve the rest.
 *
 * **AND THAT IS EXACTLY WHAT HAPPENED.** Until this module existed the rails said, flatly, *"It cannot run tools,
 * change files, edit the canvas, or apply anything."* That was true when it was written and it stopped being true
 * the moment she could hand work to CORE — a conductor that runs tools, reads the tracker, verifies from a clone
 * and drafts goals. The same system message taught her the `[core]` tag in one block and denied it in another.
 *
 * The distinction the rails have to carry is **not "can she cause work" but "can she commit it"**: she may hand
 * work to CORE, and she may not send, approve or merge anything it drafts. That is the owner's tap, and no rail,
 * tag or sentence may move it.
 *
 * **THIS IS A SEPARATE MODULE BECAUSE `presence.ts` CANNOT BE IMPORTED BY A COURT** — it uses TypeScript parameter
 * properties, which node's strip-only mode refuses — so a rail written inline there is a rail no court can read.
 * Nothing here imports anything, so a court can drive every branch of it.
 *
 * @module honesty
 */

/** What this turn's composition actually offers. Absent means the capability is not in the prompt at all. */
export interface RailSight {
  /** The repository lens: she can read this repository, read-only. */
  readonly repo?: boolean
  /** The web lens. */
  readonly web?: boolean
  /** Recall of earlier conversations. */
  readonly recall?: boolean
  /** The weights arm. */
  readonly weights?: boolean
  /** The organism lens: the state of the lanes she lives among. */
  readonly organism?: boolean
  /** **THE ORGANISM DOCUMENT, NAMED SEPARATELY FROM AURA'S LENS.** *A turn may carry one and not the other, and a rail
   * that merged them could not say which of the two it had.* */
  readonly organismState?: boolean
  /**
   * **THE CONDUCTOR.** True when a CORE session is configured, so the `[core]` tag is a real capability rather
   * than a taught word. This is the flag whose absence made the rails lie.
   */
  readonly core?: boolean
}

/**
 * The rails, as one paragraph.
 *
 * @param sight - the capabilities this composition actually put in the prompt.
 * @returns the sentences she is given about herself.
 */
export function honestyRails(sight: RailSight): string {
  const can = [
    sight.repo === true ? 'read this repository read-only through the lens' : '',
    sight.organism === true ? 'see the state of the lanes you live among, read-only' : '',
    sight.web === true ? 'search the internet read-only' : '',
    sight.recall === true ? 'look up earlier conversations read-only' : '',
    sight.weights === true ? 'load and drop adapters on the weights that serve you' : '',
    // **THE HANDOFF IS A CAPABILITY, SO IT BELONGS IN THE SENTENCE THAT LISTS CAPABILITIES** — not hidden in the
    // sentence that denies them, which is where it was by omission.
    sight.core === true ? 'hand work to CORE, which drafts and never sends' : '',
  ].filter(part => part.length > 0)

  const abilities = can.length === 0
    ? 'Honesty rails: this lane can converse and move its visual field.'
    : `Honesty rails: this lane can converse, move its visual field, and ${can.join(', and ')}.`

  // **WHAT SHE CANNOT DO IS SPLIT IN TWO, AND THE SECOND HALF IS THE ONE THAT MATTERS.** Handing work over is not
  // committing it. The conductor runs tools; she does not, and she may not send, approve or merge what it drafts —
  // that is the owner's tap, and saying so here is what keeps the tag from reading as an authority.
  const limits = sight.core === true
    ? 'It cannot run tools itself, change files, edit the canvas, or apply anything, and it cannot send, approve '
      + 'or merge anything CORE drafts: that is the owner\'s tap, and it is never hers.'
    : sight.weights === true
      ? 'Beyond your own weights it changes nothing: it cannot run tools, edit files, edit the canvas, or apply anything.'
      : 'It cannot run tools, change files, edit the canvas, or apply anything.'

  return [
    abilities,
    limits,
    'It receives transcribed text turns, not raw audio.',
    'Never invent memory, capability, perception, or completed action.',
  ].join(' ')
}
