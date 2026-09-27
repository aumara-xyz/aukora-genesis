/**
 * THE CHECK THAT RUNS AFTER EVERY TURN, AND WHY IT IS A CHECK RATHER THAN A RULE.
 *
 * **`memory-design §2.3`:** *"Using the handle map of the request in which she spoke, the check marks a reply in two
 * cases: it uses 'signed', 'verified' or 'confirmed' while citing only Remembered handles; it cites a handle that isn't
 * in that map — that handle is marked as FABRICATED."*
 *
 * **THE INSTRUCTION IS NOT ENOUGH, AND THE DESIGN KNOWS IT.** A model told not to say "verified" will usually comply
 * and occasionally will not, **and the occasion it does not is the one where the sentence sounds most convincing.** So
 * the words are checked against the EVIDENCE IN THE SAME REPLY: **the claim and the handles it cites have to agree.**
 *
 * **THE TWO FLAGS ARE DIFFERENT KINDS OF WRONG.** The first is a memory spoken at a tier it does not have — **a false
 * claim about authority.** The second is a citation of something that was never in the request at all — **a
 * fabrication, and the more serious of the two**, because a fabricated handle looks exactly like a real one and
 * nothing downstream can tell.
 *
 * @module memory-speech
 */

import { FORBIDDEN_FRAMES } from './memory-tiers.ts'

/** The tiers a handle can carry, as the request's handle map states them. */
export type HandleTier = 'remembered' | 'signed'

/** One handle as the request injected it. */
export interface InjectedHandle {
  /** `m4`, `s1` — assigned in order per session and **never reused within it**. */
  readonly handle: string
  /**
   * **THE NOTE'S OWN ID — THE ONE FIELD THE FIRST VERSION OF THIS WIRE DID NOT CARRY.**
   *
   * *KIRA's forget caller resolves a handle to the note it names and refuses by name when the turn carries no id:*
   * **"a frame's handle assignment in here would be this hook inventing a mapping the face owns."** *That refusal is
   * correct, and it meant every authorised forget stopped one field short* — **so the face carries the id it minted.**
   *
   * **OPTIONAL, BECAUSE A HANDLE WITHOUT AN ID IS STILL USEFUL:** *`checkSpokenMemory` judges a reply against handles and
   * tiers and needs no id at all* — *only a forget does, and only a forget should refuse without one.*
   */
  readonly id?: string
  readonly tier: HandleTier
}

/** What the check found. An empty array is a clean turn. */
export type SpeechFinding =
  | { readonly kind: 'overclaimed-tier'; readonly words: readonly string[]; readonly handles: readonly string[] }
  | { readonly kind: 'fabricated-handle'; readonly handle: string }

/**
 * Handles as they appear in prose: a letter and a number.
 *
 * @remarks **`m` IS MEMORY AND `s` IS SOURCE**, per the design's own examples. The pattern is deliberately narrow —
 * a loose one would read "m4" out of an ordinary word and report a fabrication that is not there, **and a check that
 * cries wolf is one whose findings get ignored.**
 */
const CITED = /\b([ms]\d+)\b/gu

/**
 * Check one reply against the handle map of the request it answered.
 *
 * **THE MAP IS THE REQUEST'S, NOT THE SESSION'S.** A handle from an earlier turn is not in this request's bytes, so a
 * reply citing it has cited something she was not given — **which is exactly what "fabricated" means here.**
 *
 * @param reply - the text she produced.
 * @param injected - every handle the request put in front of her, with its tier.
 * @returns the findings, in the order they were detected.
 */
export function checkSpokenMemory(
  reply: string,
  injected: readonly InjectedHandle[],
): readonly SpeechFinding[] {
  const findings: SpeechFinding[] = []
  const tierOf = new Map(injected.map(entry => [entry.handle, entry.tier]))
  const cited = [...new Set(reply.match(CITED) ?? [])]

  // **A HANDLE SHE WAS NOT GIVEN.** Checked first, because a fabricated handle can make the tier claim below
  // unjudgeable — **a reply citing `m9` has cited something whose tier nothing here can know.**
  for (const handle of cited) {
    if (!tierOf.has(handle)) findings.push({ kind: 'fabricated-handle', handle })
  }

  // **A TIER CLAIM WITH NOTHING SIGNED BEHIND IT.** The words are the design's three, taken from `FORBIDDEN_FRAMES`
  // plus "signed" itself — **the list lives in one place so a design revision changes one constant rather than two.**
  const claimed = ['signed', ...FORBIDDEN_FRAMES].filter(word => new RegExp(`\\b${word}\\b`, 'iu').test(reply))
  const real = cited.filter(handle => tierOf.has(handle))
  if (claimed.length > 0 && real.length > 0 && real.every(handle => tierOf.get(handle) === 'remembered')) {
    findings.push({ kind: 'overclaimed-tier', words: claimed, handles: real })
  }
  return findings
}
