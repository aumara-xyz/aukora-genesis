// φ — SHE STIRS. The breath drive, and it cannot carry a word because it never receives one.
//
// ══ WHAT THIS IS FOR ══
//
// `core/aura/figure.ts` (Lane 3, Z1) takes a `breathDrive` — damped oscillators with rest position
// zero, so conversation moves the figure and then lets it fall back. The figure's STANDING triad is a
// pure function of the ledger head and must never see a clock; the BREATH triad is the half that is
// allowed to move with the room. This module is where that motion comes from.
//
// The microphone is next round. This round the input is the cheapest one available and the shape is
// the whole point: get the channel right while the payload is trivial, because a channel designed
// around a number cannot later be handed a sentence by accident.
//
// ══ THE PROPERTY, AND WHY IT IS A SIGNATURE RATHER THAN A RULE ══
//
// The brief says the channel must be "structurally incapable of carrying words: it cannot leak what
// was said because it never receives it." A rule saying "do not pass the message text" is a rule
// somebody breaks at 2am. So:
//
//     export function pulse(at: number, length: number): CadencePulse
//
// Both parameters are numbers. There is no overload, no options bag, no `unknown`. Passing a
// transcript to this function is a TYPE ERROR, and `tsc` runs in CI. That is the difference between a
// promise and a fence, and it is the same move `selfKnowledge` made for the voice: make the honest
// thing the only reachable one.
//
// AURA grep-enforces content-blindness on their side. This is the same property enforced on mine, and
// `test/cadence.test.ts` asserts the module's own source contains no path from a string to a pulse.
//
// ══ AND THE MAGNITUDE IS COARSE ON PURPOSE ══
//
// A precise character count is not content, but it is close enough to be uncomfortable: length alone
// distinguishes "yes" from a pasted work order, and a stream of exact lengths over a conversation is a
// side channel nobody asked for. Four buckets carry everything the breath needs — something happened,
// and roughly how big it was — and carry almost nothing else.

/** Coarse size of a turn. Four buckets, deliberately not a count. */
export type CadenceMagnitude = 0 | 1 | 2 | 3;

/**
 * One stir. This is the ENTIRE payload that reaches the figure.
 *
 * `at` is a wall-clock millisecond and that is fine HERE and nowhere near the standing triad: breath
 * is allowed to know what time it is, because breath returns to zero. Standing is not, because
 * standing is the identity and two machines reading the same ledger must draw the same figure.
 */
export interface CadencePulse {
  readonly at: number;
  readonly magnitude: CadenceMagnitude;
}

/**
 * The bucket edges, in characters.
 *
 * MEASURED against this repository's own conversation shapes rather than chosen round: a social reply
 * ("wow", "thanks", "you there?") is under 24; an ordinary instruction ("add a dark mode toggle") sits
 * in the low hundreds; `lane.js`'s own `PROSE_SNIFF_MAX` calls 300 the point past which a message is a
 * document rather than a sentence, and `SOCIAL_MAX` calls 80 the point past which it is not a remark.
 * Those two numbers already encode this product's opinion about message size, so they are reused
 * rather than re-guessed.
 */
export const CADENCE_EDGES = [24, 80, 300] as const;

/**
 * A pulse from a length. NEVER from text.
 *
 * The caller measures its own string and hands over the number — one line at the call site, and the
 * reason this module can promise what it promises. See the header.
 */
export function pulse(at: number, length: number): CadencePulse {
  const n = Number.isFinite(length) && length > 0 ? Math.floor(length) : 0;
  const magnitude: CadenceMagnitude = n <= CADENCE_EDGES[0] ? 0
    : n <= CADENCE_EDGES[1] ? 1
      : n <= CADENCE_EDGES[2] ? 2
        : 3;
  return { at: Number.isFinite(at) ? Math.floor(at) : 0, magnitude };
}

/** How many stirs are kept. A breath is a recent thing; older pulses have already decayed to rest. */
export const CADENCE_WINDOW = 64;

const ring: CadencePulse[] = [];

/**
 * Record a stir.
 *
 * IN MEMORY ONLY, and never persisted. A cadence log on disk would be a timing record of when the
 * owner talks to his own machine — which is exactly the class of thing `/api/aura/state` is careful
 * not to emit, and which no feature here needs. It dies with the process, as breath should.
 */
export function stir(at: number, length: number): CadencePulse {
  const p = pulse(at, length);
  ring.push(p);
  if (ring.length > CADENCE_WINDOW) ring.splice(0, ring.length - CADENCE_WINDOW);
  return p;
}

/** The recent stirs, oldest first. A copy — a caller must not be able to reach in and rewrite breath. */
export function cadence(): CadencePulse[] {
  return ring.slice();
}

/** Drop everything. For tests, and for a surface that wants to stop breathing when nobody is there. */
export function forgetCadence(): void {
  ring.length = 0;
}

/**
 * What Lane 3's `computeFigureState({ breathDrive })` is handed.
 *
 * A single scalar, decayed by age, so an old flurry does not keep the figure moving. The figure's own
 * oscillators damp it again on their side — this is the DRIVE, not the position, and the distinction
 * is the reason there is no accumulator anywhere in this file: no sequence of messages can leave a
 * permanent mark, because there is nothing here that remembers more than the window.
 *
 * @param now wall-clock ms, passed in rather than read, so a test can drive it and two callers on one
 *   tick agree. This module owns no clock of its own.
 */
export function breathDrive(now: number, halfLifeMs = 8_000): number {
  let drive = 0;
  for (const p of ring) {
    const age = now - p.at;
    if (age < 0 || age > halfLifeMs * 8) continue;
    drive += (p.magnitude + 1) * Math.pow(0.5, age / halfLifeMs);
  }
  // Bounded, so a burst cannot hand the figure an arbitrarily large number.
  return Math.min(1, drive / 12);
}

/** A cadence grants nothing. Stated as a literal, the way every other organ here states it. */
export function cadenceGrantsAuthority(): false {
  return false;
}
