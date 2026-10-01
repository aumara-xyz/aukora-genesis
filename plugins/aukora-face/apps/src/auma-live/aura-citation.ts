/**
 * SHE CITES THE CHAIN WHEN SHE REMEMBERS.
 *
 * A Kira record says what was recorded. It does not say that the chain still checks out, and **"I have this in
 * memory" is a claim about the chain.** AURA's read-only `aura.cite` answers that per record: `VERIFIED` with the
 * sequence and the verified head, or `UNVERIFIED` with a named reason and **no head at all**.
 *
 * **THE RESOLVER IS PASSED IN ON EVERY CALL AND NEVER HELD.** A service captured at mount is the same object
 * forever; a service resolved per call is the one running now. Caching it would make the first answer the answer
 * for the life of the process, which for a chain that can be re-derived is the one thing a citation must never be.
 *
 * **A SEQUENCE APPEARS ONLY BESIDE A VERIFIED CITATION, AND ONLY WHEN IT IS A NUMBER.** Everything else —
 * unverified, refused, an unmounted service, a service that threw, a citation missing its sequence — says so and
 * carries no position. A reader handed "unverified" together with a number has been handed the thing the verdict
 * was withholding.
 *
 * @module aura-citation
 */

/** The verdict AURA's `aura.cite` returns when the chain re-derived and the record sits where it says. */
export const CITE_VERIFIED = 'VERIFIED'

/** The verdict when it did not. A reason and NO sequence. */
export const CITE_UNVERIFIED = 'UNVERIFIED'

/**
 * THE RAIL, in her own prompt's words.
 *
 * Printed with every Kira frame, because a rule she is not told is a rule she cannot follow — and because the
 * difference between "I remember this" and "this is at Aura sequence 41" is exactly the difference a person
 * reading her will rely on.
 */
export const AURA_RAIL = [
  'Citations: each record below carries "Aura #<n>, verified", "Remembered chain kira.remembered …, verified integrity", or "UNVERIFIED: <reason>".',
  'Remembered chain indexes are in a separate unsigned namespace; they are never Aura sequences or owner approvals.',
  'You may say a record is in memory at a particular Aura sequence ONLY when its line says "verified" — that is',
  'the only case where a sequence is true. For an UNVERIFIED record, say plainly that it could not be verified;',
  'do not give a sequence for it and do not imply one. Never state an Aura sequence that was not handed to you',
  'in this block: a sequence you supply yourself is a claim about a chain you did not check.',
].join(' ')

/** What one record's citation resolved to. */
export interface Citation {
  /** The line that goes beside the record in the KIRA frame. */
  readonly line: string
  /** The sequence, ONLY when the citation verified and the sequence was a finite number. */
  readonly auraSequence?: number
  /** Checked unsigned remembered-chain pointer; never substitute it for auraSequence. */
  readonly namespace?: 'kira.remembered'
  readonly chainIndex?: number
  readonly entryHash?: string
}

/** The shape `aura.cite` answers with, as far as this module reads it. */
interface CiteAnswer {
  readonly verdict?: unknown
  readonly auraSequence?: unknown
  readonly reason?: unknown
}

/**
 * One record's citation line.
 *
 * @param answer - what `aura.cite` returned, or undefined when it could not be asked.
 * @param failure - why it could not be asked, when that is what happened.
 * @returns the line, and the sequence only when the citation verified.
 */
export function citationOf(answer: CiteAnswer | undefined, failure?: string): Citation {
  if (answer === undefined) {
    // **NOT MOUNTED, OR IT THREW.** Both are `UNVERIFIED` and both are NAMED — never quietly absent, because an
    // absent citation reads as "nothing to check" and a record with nothing to check must not look verified.
    return { line: `${CITE_UNVERIFIED}: ${failure ?? 'the citation service did not answer'}` }
  }
  if (answer.verdict !== CITE_VERIFIED) {
    const reason = typeof answer.reason === 'string' && answer.reason.trim() !== ''
      ? answer.reason
      : 'the citation service gave no reason'
    return { line: `${CITE_UNVERIFIED}: ${reason}` }
  }
  // **VERIFIED — AND THE SEQUENCE STILL HAS TO BE A NUMBER.** A verdict of VERIFIED with a missing or non-finite
  // sequence has nothing to cite, and inventing a position from it is the failure this whole module exists for.
  const sequence = answer.auraSequence
  if (typeof sequence !== 'number' || !Number.isFinite(sequence)) {
    return { line: `${CITE_UNVERIFIED}: the citation verified but carries no numeric auraSequence, so there is no `
      + 'position to cite' }
  }
  return { line: `Aura #${String(sequence)}, verified`, auraSequence: sequence }
}

/**
 * Resolve every record's citation for ONE lookup.
 *
 * @param recordIds - the records the Kira lens is about to show, in order.
 * @param options - the resolver, which is passed in per call and never cached here.
 * @returns a map from record id to its citation.
 */
export async function resolveCitations(
  recordIds: readonly string[],
  options: { cite?: ((recordId: string) => Promise<unknown>) | undefined },
): Promise<Map<string, Citation>> {
  const resolved = new Map<string, Citation>()
  const cite = options.cite
  for (const recordId of recordIds) {
    if (typeof cite !== 'function') {
      resolved.set(recordId, citationOf(undefined,
        'aura.cite is not mounted on this Host, so no record in this block could be verified'))
      continue
    }
    try {
      resolved.set(recordId, citationOf(await cite(recordId) as CiteAnswer))
    } catch (error: unknown) {
      // REFUSED BY NAME. An unknown record id is a refusal, not a doubt about the chain — and a caller that
      // showed it as verified would be reporting a typo as a proof.
      resolved.set(recordId, citationOf(undefined,
        `the citation was refused: ${String((error as Error)?.message ?? error)}`))
    }
  }
  return resolved
}

/**
 * What she is told when she asks to remember and nothing could be verified.
 *
 * @param recordIds - the records shown.
 * @param citations - what each resolved to.
 * @returns the count of verified citations, for the census line.
 */
export function verifiedCount(citations: ReadonlyMap<string, Citation>): number {
  let verified = 0
  for (const citation of citations.values()) if (citation.auraSequence !== undefined) verified += 1
  return verified
}
