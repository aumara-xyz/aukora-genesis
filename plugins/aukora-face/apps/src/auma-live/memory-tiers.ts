/**
 * TRACKED MEMORY, SPOKEN AT THE TIER IT ACTUALLY HAS.
 *
 * **PETER'S DIRECTION, 2026-09-26: memories are TRACKED, NOT APPROVED.** Automatic capture, usable at once, each
 * carrying a cryptographic source receipt chained into Aura. **A human click is reserved for self-modification,
 * code, permissions, spending, publishing, and for marking a memory TRUSTED.**
 *
 * **THE TWO TIERS ARE NOT A RANKING OF CONFIDENCE — THEY ARE A DIFFERENCE IN WHAT STANDS BEHIND THE WORDS.** A
 * `remembered` memory is one this machine captured and can prove the provenance of; a `trusted` one is one the OWNER
 * SIGNED. **So they are spoken differently, and the difference is not decoration:**
 *
 * - `remembered` → *"I remember…"*
 * - `trusted`    → *"verified…"*
 *
 * **A MEMORY SPOKEN AT THE WRONG TIER IS A FALSE CLAIM ABOUT AUTHORITY**, and in a commercial setting it is the
 * difference between "I recall this" and "this was signed". That is why the framing lives here, in one function, and
 * why the court beside it is written to fail if a remembered memory is ever spoken as verified.
 *
 * @module memory-tiers
 */

/** The contract's tiers. `proposal` is from dreaming and `forgotten` is a tombstone. */
// **"TRUSTED" IS RENAMED "SIGNED"** (`memory-design`, overriding contract v0). The design's reason is in the word: a
// signature records THAT THE OWNER SIGNED. "Trusted" sounds like a judgement about the content, **and the difference
// is the one a person would rely on in a commercial setting.**
export type MemoryTier = 'remembered' | 'signed' | 'proposal' | 'forgotten'

/**
 * **NEW SIGNING IS OFF UNTIL SIGNING REQUIRES THE OWNER IN PERSON (Touch ID or password).**
 *
 * Until then a rule he asks for is **stored as a note marked "not in effect"** rather than signed — **because a
 * signature this system cannot tie to a person is not one, and a rule acted on without it is exactly the authority the
 * design exists to withhold.** The flag is a constant rather than a config key: **turning it on is a change to what
 * the system claims, not a deployment preference.**
 */
export const SIGNING_ENABLED = false

/**
 * The source receipt: **what makes a memory checkable**, and what a citation is drawn from.
 *
 * @remarks `sha256` is over the exact canonical event line, so `verify` can recompute it. **The receipt is the reason a
 * `remembered` memory may be spoken at all** — without it the memory is an assertion with nothing behind it.
 */
export interface MemorySource {
  readonly sessionId: string
  readonly sessionTitle: string
  readonly seq: number
  readonly at: string
  readonly sha256: string
}

/** The owner's signature. **Its PRESENCE is what makes a memory `signed`.** */
export interface MemoryTrust {
  readonly signer: string
  readonly at: string
  readonly approvalDigest: string
}

/** One memory, as the contract defines it. */
export interface TieredMemory {
  readonly id: string
  readonly tier: MemoryTier
  readonly text: string
  readonly createdAt: string
  readonly source: MemorySource
  readonly signed?: MemoryTrust | undefined
}

/** Why a memory could not be framed. **A refusal names its reason rather than falling back to a weaker tier.** */
export interface MemoryRefusal {
  readonly id: string
  readonly reason: 'untrusted-signature' | 'forgotten' | 'not-spoken' | 'signing-off'
  readonly detail: string
}

/** What the block holds: the lines she may speak, and the records she may not. */
export interface MemoryFraming {
  readonly lines: readonly string[]
  readonly refused: readonly MemoryRefusal[]
  /**
   * **THE HANDLE EACH SPOKEN LINE CARRIES, AND THE TIER BEHIND IT — THE INPUT NOTHING PRODUCED.**
   *
   * `memory-speech.ts`'s `checkSpokenMemory(reply, injected)` needs `InjectedHandle[]`, **and `memory-forget.mjs`'s
   * `voiceForgetDecision` needs `injectedHandles` before it will forget anything** — *"condition 2 is what stops her
   * forgetting a note that was not in front of him in this turn."* **Both functions were fully written, courted, and
   * waiting on this: WHICH MEMORIES WERE IN FRONT OF HER, AND AT WHAT TIER.**
   *
   * **IT IS RETURNED RATHER THAN LEFT TO THE CALLER TO RE-DERIVE**, because the handle is only meaningful beside the
   * line it labels — **a caller matching them up by position would be addressing content by index**, which is this
   * repository's defect #4.
   *
   * **EMPTY WHEN NO HANDLES WERE ASSIGNED**, which is what every existing caller gets: **the parameter below is
   * optional, so a caller that does not ask for handles sees exactly the output it saw before.** *That is deliberate —
   * once a memory carries `m4`, she can cite it, and the spoken-text contract gains a vocabulary it does not have
   * today. Whether she SEES the handles is the caller's decision and not this function's.*
   */
  readonly injected: readonly { readonly handle: string; readonly tier: MemoryTier; readonly id?: string }[]
}

/**
 * **THE WORDS SHE MAY USE, AND THE ONE WORD SHE MAY NEVER USE** (`memory-design §2.3`).
 *
 * The design's table is explicit: *"She never says 'verified' or 'confirmed' about anything."* **My first version of
 * this module spoke a signed memory as "verified…" — which the design forbids outright**, and it forbids it for a
 * reason worth keeping: **"verified" claims a check that no part of this system performs.** A signature says the OWNER
 * signed; it does not say the memory is true, and the word that conflates the two is the one a person would rely on.
 *
 * `remembered` has no single frame in the design — it is *"You told me on Tuesday…"* for something typed, *"On Tuesday
 * I heard you say…"* for something spoken, and neither claims the exact words. **Those variants live in
 * {@link frameMemory}, because which one is honest depends on how the memory was captured.**
 */
export const REMEMBERED_FRAME = 'You told me'
/** The frame for a signed memory. **The word "signed", never "verified".** */
export const SIGNED_FRAME = "That's in your signed memory"
/** **The words this module must never produce**, asserted by the court rather than trusted to reviewers. */
export const FORBIDDEN_FRAMES = Object.freeze(['verified', 'confirmed'])

/**
 * **THE TIER A RECORD MAY ACTUALLY BE SPOKEN AT, OR A REFUSAL.**
 *
 * **A record CLAIMING `trusted` WITHOUT A SIGNATURE IS REFUSED RATHER THAN DOWNGRADED.** Downgrading would be the
 * quieter failure and the worse one: the memory would still be spoken, just with a weaker word, **and nothing would
 * say that a claim of authority had failed its own check.** The contract makes the signature the whole difference
 * between the tiers, so a missing one is a defect in the record rather than a reason to speak it softly.
 *
 * `forgotten` is refused for the same reason a tombstone exists: **exclusion from recall is the entire point of it.**
 *
 * @param memory - the record as the store returns it.
 * @returns the tier it may be spoken at, or the refusal.
 */
export function spokenTierOf(memory: TieredMemory): MemoryTier | MemoryRefusal {
  if (memory.tier === 'forgotten') {
    return { id: memory.id, reason: 'forgotten', detail: 'a tombstoned memory is excluded from recall' }
  }
  if (memory.tier === 'proposal') {
    // A proposal is not yet a memory. **It is refused rather than spoken, because "I remember" about something she
    // merely considered is a claim about the past that did not happen.**
    return { id: memory.id, reason: 'not-spoken', detail: 'a proposal is not yet a memory' }
  }
  if (memory.tier === 'signed') {
    // **A SIGNED MEMORY IS NOT ACTED ON WHILE SIGNING ITSELF IS OFF** (override (a)). Even a record carrying a
    // well-formed signature is spoken as a note that is NOT IN EFFECT, because **the signature cannot yet be tied to
    // the owner in person — so the thing it would authorise has no authority behind it.**
    //
    // **REFUSED RATHER THAN SOFTENED, AND THE REFUSAL IS WHAT SHE SAYS.** The design gives the sentence: *"I've noted
    // you want a rule about X. It isn't in effect until you sign it."* The record is not dropped — **a rule he asked
    // for and cannot see is worse than one he can see and cannot yet rely on.**
    if (!SIGNING_ENABLED) {
      return {
        id: memory.id,
        reason: 'signing-off',
        detail: "I've noted you want a rule, and it isn't in effect until you sign it",
      }
    }
    const signature = memory.signed
    if (signature === undefined || signature.approvalDigest.trim() === '' || signature.signer.trim() === '') {
      return {
        id: memory.id,
        reason: 'untrusted-signature',
        detail: 'the record claims the signed tier and carries no owner signature',
      }
    }
    return 'signed'
  }
  return 'remembered'
}

/**
 * One memory, as one line she may say.
 *
 * **THE CITATION IS SESSION AND TIME, AND IT IS PART OF THE LINE RATHER THAN AN APPENDIX.** Fable asked that she cite
 * the source when asked — **and a memory whose provenance is only retrievable on request is one she will be believed
 * about by default.** Putting it in the line means the claim and its receipt travel together.
 *
 * @param memory - the record.
 * @param now - clock sample, injected so a court can hold it still.
 * @returns the spoken line, or the refusal.
 */
export function frameMemory(memory: TieredMemory, now?: number): string | MemoryRefusal {
  const tier = spokenTierOf(memory)
  if (typeof tier !== 'string') return tier
  // **A SIGNED MEMORY SAYS "SIGNED"; NOTHING SAYS "VERIFIED".** See `FORBIDDEN_FRAMES`.
  const frame = tier === 'signed' ? SIGNED_FRAME : REMEMBERED_FRAME
  const when = memory.source.at || memory.createdAt
  const where = memory.source.sessionTitle.trim() === '' ? memory.source.sessionId : memory.source.sessionTitle
  // `now` is accepted and unused today: the citation is the SOURCE's time, never the moment of recall. **Naming the
  // parameter keeps the seam for a court that wants to prove a memory is not restamped with today's clock.**
  void now
  return `${frame} — ${memory.text.trim()} (${where}, ${when})`
}

/**
 * The block recall contributes to a turn: every speakable memory at its own tier, and every refusal named.
 *
 * **REFUSALS ARE RETURNED RATHER THAN DROPPED.** A memory that vanished from the block would be indistinguishable
 * from one that was never stored, **and the difference matters most for exactly the records a person would want to
 * know about** — an unsigned claim of authority, or one they asked to forget.
 *
 * @param memories - the records recall returned.
 * @returns the lines and the refusals.
 */
export function memoryBlock(
  memories: readonly TieredMemory[],
  /**
   * **WHERE THIS SESSION'S HANDLE COUNT HAS REACHED**, so a handle is never reused within a session.
   *
   * The design: *"`m4`, `s1` — assigned in order per session and never reused within it."* **`m` counts remembered
   * memories and `s` counts signed ones, independently**, which is what the two letters are for. **A caller that omits
   * this gets no handles at all**, so the count is only advanced by a caller that is going to show them.
   */
  counters?: { remembered: number; signed: number },
): MemoryFraming {
  const lines: string[] = []
  const refused: MemoryRefusal[] = []
  const injected: { handle: string; tier: MemoryTier; id?: string }[] = []
  for (const memory of memories) {
    const framed = frameMemory(memory)
    if (typeof framed !== 'string') { refused.push(framed); continue }
    if (counters === undefined) { lines.push(framed); continue }
    // **THE TIER DECIDES THE LETTER, AND `spokenTierOf` ALREADY DECIDED THE TIER.** A memory refused by the tier rules
    // never reaches here, so every line that does is speakable and has a letter.
    const tier = spokenTierOf(memory)
    if (typeof tier !== 'string') { refused.push(tier); continue }
    const letter = tier === 'signed' ? 's' : 'm'
    counters[tier === 'signed' ? 'signed' : 'remembered'] += 1
    const handle = `${letter}${String(counters[tier === 'signed' ? 'signed' : 'remembered'])}`
    // **THE NOTE'S ID TRAVELS WITH ITS HANDLE**, so a forget can resolve the handle back to the note it names.
    injected.push(memory.id === undefined || memory.id === '' ? { handle, tier } : { handle, tier, id: memory.id })
    // **THE HANDLE IS PREFIXED TO THE LINE, WHICH IS THE ONLY WAY SHE CAN CITE IT.** A handle the model never sees is
    // a handle it can never use — *and `checkSpokenMemory`'s whole subject is a reply citing one.*
    lines.push(`${handle}: ${framed}`)
  }
  return { lines, refused, injected }
}
