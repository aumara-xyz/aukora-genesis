// core/aura/mood.ts — WHAT THE FIGURE IS ALLOWED TO LOOK LIKE
//
// ══ THE ONE FAILURE THIS FILE EXISTS TO PREVENT ══
//
// She must not look healthy over a broken record.
//
// A hash chain cannot vouch for itself. Every prefix of a valid chain is a valid
// chain, so a record truncated at the tail verifies as perfectly self-consistent —
// `core/witness/verify.mjs` says it in its own words: *"`intact` is about the hash
// chain alone and must stay that way — it is purely structural, and a forged chain
// is trivially 'intact' because the attacker is the one who recomputed it."*
//
// So a face that reads `intact`, or that counts receipts and calls a small number
// "quiet", renders CALM over a record whose recent history was deleted. It would
// say sleepy when it means compromised, and it would say it beautifully, which is
// worse.
//
// ══ THE RULE ══
//
//   QUIET          = the record is sound and there is little recent activity.
//   CANNOT VERIFY  = the record cannot be trusted, whatever its activity.
//
// **These two must never share a colour, a shape, or a word.** They are opposite
// answers. `quiet` is a fact about the world; `cannot-verify` is a fact about our
// ability to know anything about the world.
//
// ══ AND IT DOES NOT ROLL ITS OWN HEALTH CHECK ══
//
// The only judgment of soundness comes from `trustworthy` on the verify result.
// Not `intact` — `intact` is the structural half and is the exact field a naive
// implementation reaches for. Not a receipt count, not a timestamp delta, not a
// re-derived hash walk. If the witness ever learns a new way to be broken, this
// file inherits it for free; if this file rolled its own check, it would inherit
// nothing and drift silently.
//
// `verifyChain` returns `{ ok, intact, trustworthy, … }` (core/witness/verify.mjs).
// A verdict object that does not carry `trustworthy` AT ALL is itself a reason to
// refuse: an older or foreign verifier is not a verifier this face understands.

/** The five states a figure may be in. Nothing else renders. */
export const AURA_MOODS = Object.freeze(['cannot-verify', 'unwitnessed', 'quiet', 'awake', 'vivid'] as const);
export type AuraMood = (typeof AURA_MOODS)[number];

/** Moods that mean "the record is sound". Everything else must look wrong. */
export const SOUND_MOODS = Object.freeze(['quiet', 'awake', 'vivid'] as const);

export interface AuraMoodState {
  mood: AuraMood;
  /** True only when `trustworthy` was true. The face keys every colour off this. */
  sound: boolean;
  /** Why, in a sentence a person can read. Never a score. */
  because: string;
  /** Named so a renderer cannot invent its own palette. */
  palette: 'alarm' | 'grey' | 'calm' | 'warm' | 'bright';
  grantsAuthority: false;
}

const state = (
  mood: AuraMood,
  sound: boolean,
  because: string,
  palette: AuraMoodState['palette'],
): AuraMoodState => Object.freeze({ mood, sound, because, palette, grantsAuthority: false as const });

/**
 * The verdict shape this module accepts. Deliberately minimal: it asks for the
 * one field it is allowed to judge on, and refuses anything that cannot supply it.
 */
export interface WitnessVerdictLike {
  trustworthy?: unknown;
  intact?: unknown;
  bound?: unknown;
  /**
   * A SECOND MACHINE REMEMBERS RECEIPTS THIS NODE CANNOT PRODUCE.
   *
   * The one peer fact this module is allowed to judge on, and it is passed as a plain boolean rather
   * than the five-state report so that no peer vocabulary is re-derived here — `core/aura/state.ts`
   * owns that mapping and this file consumes one bit of it.
   *
   * ABSENT MEANS ABSENT. `undefined` is "no peer information", which changes nothing; only an explicit
   * `true` alarms. A missing field must never be read as a contradiction, for the same reason a
   * missing `bound` must never be read as witnessed.
   */
  peerContradicts?: unknown;
}

/**
 * Derive the mood.
 *
 * @param verdict  the object returned by `verifyChain` in core/witness/verify.mjs
 * @param activity how many receipts landed in the recent window. **Only consulted
 *                 once the record is already known sound** — an untrustworthy
 *                 record's activity count is not evidence of anything, and using
 *                 it first is precisely how "quiet" comes to mean "compromised".
 */
export function auraMood(verdict: WitnessVerdictLike | null | undefined, activity = 0): AuraMoodState {
  // ── SOUNDNESS FIRST, ALWAYS ──
  //
  // Ordering is the whole guard. Any branch that reads `activity` before
  // `trustworthy` can produce a calm answer over a broken record, and no amount
  // of care further down repairs that.
  if (verdict === null || verdict === undefined || typeof verdict !== 'object') {
    return state('cannot-verify', false, 'no verdict was produced for this record', 'alarm');
  }
  if (!('trustworthy' in verdict)) {
    // An older or foreign verifier. "We could not ask" is not "the answer was yes".
    return state('cannot-verify', false,
      'this verdict carries no trustworthy field — the record was judged by something this face does not understand',
      'alarm');
  }
  if (verdict.trustworthy !== true) {
    // Deliberately `!== true` rather than falsy: a truthy non-boolean is a shape
    // this face does not recognise, and recognising it loosely is how a `1` or a
    // `'yes'` from some future serializer would render as calm.
    return state('cannot-verify', false,
      'the record did not verify — a truncated or altered chain can still look structurally intact, so this is the only honest face for it',
      'alarm');
  }

  // ══ A WITNESS DISAGREEING OUTRANKS EVERYTHING BELOW IT ══
  //
  // A truncated chain is perfectly `intact` and can be perfectly `trustworthy`: those are questions
  // this node asks about ITSELF, and a record that was cut before the cut cannot see the cut. A second
  // machine holding receipts this one cannot produce is the ONLY evidence in the system that reaches
  // past self-attestation — it is the entire reason peer retention exists.
  //
  // So it alarms, HERE, above activity and above `bound`. It is not a sixth mood: `AURA_MOODS` is
  // pinned against `MOOD_STYLE` by test, and a mood the palette has no entry for falls through to a
  // default, which is exactly where an alarm quietly becomes something softer. `cannot-verify` already
  // means "this face cannot honestly tell you this record is sound", and that is precisely the
  // situation — so it reuses the alarm rather than inventing one beside it.
  //
  // `=== true` and not truthiness: a shape this face does not recognise is not an accusation, and
  // crying wolf on a malformed field would make the loudest state in the system the least trusted.
  if (verdict.peerContradicts === true) {
    return state('cannot-verify', false,
      'a second machine remembers receipts this node cannot produce — the record here may have been '
      + 'truncated, rewritten or partly lost, and nothing this node can check would show it',
      'alarm');
  }

  // ── ONLY NOW MAY ACTIVITY SPEAK ──
  if (typeof activity !== 'number' || !Number.isFinite(activity) || activity < 0) {
    return state('cannot-verify', false, 'the activity figure was not a number this face can read', 'alarm');
  }
  // AN ABSENT `bound` IS A REFUSAL, NOT A `true`.
  //
  // MEASURED, and it was wrong: this file checks `trustworthy` with `!== true` and argues for that
  // twelve lines above — "a truthy non-boolean is a shape this face does not recognise". `bound` was
  // then checked with `=== false`, which is the opposite discipline, so a verdict carrying NO `bound`
  // field at all fell straight past this branch and rendered `quiet` — the CALM colour. The one
  // colour the comment below says unwitnessed must never borrow is exactly the one it got.
  //
  // Production was safe by accident, not by construction: `narrowVerdict` returns null unless `bound`
  // is present, and `buildAuraDoorState` passes `v.bound`, a real boolean. But `auraMood` is exported
  // and the guarantee has to live HERE, in the function that decides the colour — a proof that only
  // holds at one call site is not a proof of the function.
  if (!('bound' in verdict)) {
    return state('cannot-verify', false,
      'this verdict carries no bound field — whether anything has signed for this record is unknown, '
      + 'and unknown is not "yes"',
      'alarm');
  }
  if (typeof verdict.bound !== 'boolean') {
    return state('cannot-verify', false,
      'the bound field was not a boolean this face can read', 'alarm');
  }
  if (verdict.bound === false) {
    // Sound but unwitnessed: the chain is fine and nobody has signed for it. That
    // is its own state and must not borrow the calm one's colour either.
    return state('unwitnessed', true, 'the record is sound but this node is not bound — nothing has signed for it', 'grey');
  }
  if (activity === 0) return state('quiet', true, 'the record is sound and nothing has happened recently', 'calm');
  if (activity < 8) return state('awake', true, 'the record is sound and there has been recent activity', 'warm');
  return state('vivid', true, 'the record is sound and there has been a great deal of recent activity', 'bright');
}

/**
 * The palettes must be distinct. Exported so the renderer cannot quietly map two
 * moods onto one colour — the test asserts this set is injective.
 */
export function paletteFor(mood: AuraMood): AuraMoodState['palette'] {
  switch (mood) {
    case 'cannot-verify': return 'alarm';
    case 'unwitnessed': return 'grey';
    case 'quiet': return 'calm';
    case 'awake': return 'warm';
    case 'vivid': return 'bright';
  }
}

/** A mood is a picture of a record. It is not a permission. */
export function auraMoodGrantsAuthority(): false {
  return false;
}
