// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * core/aura/figure.ts — WHERE THE RECORD LEAVES HER, AND WHERE THE MOMENT MOVES HER.
 *
 * Z1: the pure function, and nothing else. No renderer, no audio, no DOM, no shader. This module
 * computes six numbers and returns them. What draws them is a later decision, made against a map that
 * already exists rather than reverse-engineered from something someone already liked the look of.
 *
 * ══ THE SIX PLANES ══
 *
 * Four-space has exactly six planes of rotation. They split, and the split is the whole design:
 *
 *   STANDING   xy · xz · yz    the three that do not involve the fourth axis.
 *                              A pure function of THE LEDGER HEAD. This is where the record has left
 *                              her, and only the record may move it.
 *
 *   BREATH     xw · yw · zw    the three that do.
 *                              Damped, rest position ZERO, non-accumulating. This is where the moment
 *                              moves her — and where it must never stay.
 *
 * (A brief describing the figure was referenced when this was commissioned and does not exist in this
 * repository or in any issue — searched before building. The triad names settle it without one.)
 *
 * ══ NO CLOCK. THIS IS THE SINGLE MOST IMPORTANT RULE IN THE FILE ══
 *
 * Nothing here reads wall time, and nothing here is random. `test/aura-figure.test.ts` greps this file
 * for every way a clock could get in, because a comment saying "no clock" is not a guarantee and a
 * failing test is.
 *
 * ══ AND THE DETERMINISM CLAIM HAS A BOUND, WHICH IS PART OF THE CLAIM ══
 *
 * "Two machines holding the same record draw the same figure" is TRUE AT REST and FALSE
 * MID-CONVERSATION, by design. Said without the bound it is an overclaim, and this file said it
 * without the bound until an outside reviewer pointed at it.
 *
 * STANDING is a pure function of the ledger head, so two machines with the same record put her in the
 * same posture today and in ten years, and a stranger can recompute it by hand.
 * BREATH is not, and cannot be: it depends on live drive and on how many steps have been taken. Two
 * laptops in the same room WILL NOT MATCH while anyone is talking, and nobody should ever demonstrate
 * that they do.
 *
 * What is reproducible is the REST FRAME — same seed, same chain, silence, identical bytes — which is
 * the claim a stranger will actually check, and `test/aura-rotor.test.ts` checks exactly it. That
 * property is the difference between an IDENTITY and a mood ring: a mood ring is also pretty, and it
 * tells you only that time has passed.
 *
 * ══ THE CONVERSATION MAY MOVE HER, AND MAY NEVER MOVE HER PERMANENTLY ══
 *
 * `breathDrive` is three numbers: amplitude and timing. There is no fourth field, so there is nowhere
 * for a word to ride. The relaxation `x += (drive - x) * k` has one fixed point and it is zero, so
 * when the room goes quiet she comes home — and she comes home EXACTLY, because the step snaps below
 * an epsilon rather than approaching zero forever by float underflow. Ten thousand turns leave the
 * rest state bit-for-bit identical, and the suite runs exactly that.
 *
 * The standing triad is not reachable from the drive at all. Not "damped so it returns" — not
 * reachable. That is checked too.
 *
 * ══ THE SEED IS SACRED ══
 *
 * `seed` is the genesis ref — `sha256(rootId | boundAt)`, derived once at binding in
 * `aumlokGenesisAura.ts`, surviving phrase rotation because a rotation rewrites the fingerprint file
 * and never `rootId` or `boundAt`. It feeds GEOMETRY ONLY, reaches exactly one plane, and nothing in
 * this repository writes it. Fold live activity into the seed and a node that got busy would draw a
 * different owner — she would stop being an identity at exactly the moment identity matters.
 * See `docs/HARP-MAPPING.md`: the music moves, the figure does not.
 *
 * `boundAt` reaches the figure only through the seed, which is the sacred path and the only one.
 *
 * ══ WHY THE SEED REACHES EXACTLY ONE PLANE, AND WHY THAT IS DELIBERATE ══
 *
 * An outside reviewer observed that the seed touches `yz` and nothing else, and asked whether that was
 * intended. It is, and the reason is the whole point of separating the three layers:
 *
 *   yz is WHO SHE IS. It must be immovable by anything that happens, so exactly one input reaches it
 *   and that input never changes. Any chain, any drive, any activity leaves it alone.
 *
 *   xy and xz are WHAT SHE HAS DONE. Letting the seed into them would mean two nodes with identical
 *   records stood differently — the biography would stop being readable as a biography, because you
 *   could no longer tell whether a difference in posture came from a different history or a different
 *   name.
 *
 * So the split is one plane for identity and two for the record, and the test asserts it in both
 * directions: changing the seed moves `yz` and provably moves neither `xy`, `xz`, nor any breath value.
 *
 * Z2 (`rotor.ts`) widens the seed's reach DELIBERATELY and in one further place only — the winding
 * parameters, which scale the cage before rotation, so two bindings look like two different figures
 * rather than the same wireframe at two angles. That is still geometry, still write-once, and still
 * nowhere near the record's own planes.
 *
 * ══ STANDING NO LONGER COUNTS ATTENTION ══
 *
 * This paragraph used to say the opposite, and said it would go with the fix. It has.
 *
 * `standingOf` derived posture from TOTAL RECEIPTS, so reads and session boundaries moved biography
 * and "attention is free, action is earned" was false at this seam. Kira's projection landed in #155
 * (`core/witness/action.mjs`, published through `verifyChain(...).biography`) and this file now
 * CONSUMES it rather than re-deriving anything: the size plane counts `judgedWritePaths` alone. The
 * measured shares are in `standingOf`'s own comment, beside the arithmetic they justify.
 *
 * THE TWO TRAPS WERE REAL AND BOTH WERE AVOIDED, recorded because the next consumer inherits them:
 *
 *   · DO NOT ADD TWO LEDGERS. Here the trap wears a second face — not two ledgers but two
 *     GRANULARITIES of one. An accepted proposal yields several `judgedWritePaths` and one
 *     `ownerOutcome`, so summing those two counts the same act twice. ONE class drives the plane.
 *   · DO NOT TAKE `unguarded` FOR ATTENTION. That taxonomy was measured wrong, and `action.mjs` says
 *     so in its own header: a shell string is not a read. `unguarded` is nowhere in this consumer.
 *
 *     THAT SENTENCE WAS FALSE WHEN IT WAS WRITTEN, and it is worth leaving the correction visible.
 *     `unguarded` sat in the xz denominator three lines of code below it for a full round, so this
 *     file carried a comment describing what it did not do — this repository's recurring defect, in
 *     the header of the module that keeps naming it. It is true now, and `test/aura-figure.test.ts`
 *     greps `standingOf`'s body for the word so it cannot go back to being a promise.
 *
 * WHAT THIS FILE STILL CANNOT PROMISE. `judgedWritePaths` is the law returning a verdict on a declared
 * path — AN INTENT. It is not proof anything was written, and no count in this module ever will be.
 *
 * ══ ONE DEPENDENCY THIS FILE HAS ON A RULE IT DOES NOT OWN ══
 *
 * `standingOf` counts `judgedWritePaths`. An outside reviewer predicted the consequence when it
 * counted total receipts: if talking ever writes to the chain that standing counts, chat volume
 * becomes permanent posture — attention would start being earned, which is exactly backwards. Counting
 * one judged class narrows that exposure but does NOT close it: a future receipt kind that talking
 * emits, and that the law judges as a write path, would land straight in the size plane.
 *
 * It does not today: governed recall writes to a separate ledger, not the witness chain. But this file
 * DEPENDS on that boundary and cannot enforce it — the rule lives in whatever appends receipts. It is
 * named here so the dependency is visible from this side, and so the next lane adding a receipt kind
 * can find out from the file that would be damaged by getting it wrong.
 */

// ══ THE SIX PLANES TRAVEL AS A FIELD ══
//
// `core/cube/walsh.ts` is an exact, reversible, public linear map between SIX plane coefficients and
// SIXTEEN vertex amplitudes — one per corner of the tesseract the figure is drawn from. It was written,
// proved lossless, and called by nothing: its only importer took a TYPE from it, which erases at
// compile time, so at runtime the module had no caller at all.
//
// It is the codec now. `computeFigureState` does not hand the six values on directly — it synthesises
// them onto the sixteen vertices and reads them back, and what the figure renders is the DECODED six.
//
// THE ROUND TRIP IS LOSSLESS, SO THE PICTURE MUST NOT MOVE. That is the point rather than an objection:
// a byte-identical rest frame is the only available proof that the codec is wired correctly and not
// merely wired in. `test/cube-load-bearing.test.ts` asserts the digest is unchanged, and corrupts one
// vertex amplitude to show the assertion can fail.
//
// What it buys: the sixteen amplitudes are a real intermediate. Six numbers can only be drawn as a
// cage; a field over the vertices is something the system can carry, digest and compare — and the cage
// becomes its readout rather than the whole of it.
import { synth6, analyze6, type Field16 } from '../cube/walsh';

/** A full turn. Angles are radians, and every output below is bounded inside one turn. */
export const TAU = Math.PI * 2;

/** The same 27 the harp map uses, so the two disclosed maps agree about how big the instrument is. */
export const STRINGS = 27;

/** How fast she comes home. One step from rest moves exactly this fraction toward the drive. */
export const BREATH_K = 0.12;

/**
 * Below this, breath IS rest.
 *
 * `x *= (1 - k)` has zero as a limit, not a value: it reaches it only by float underflow, thousands of
 * steps after anyone stopped watching. A figure whose rest is 1e-40 is a figure that never quite comes
 * home, and "comes home exactly" is a property worth having by construction rather than by accident.
 */
export const REST_EPSILON = 1e-12;

/** Rest. Frozen, so the one true rest position cannot be edited by a caller holding a reference. */
export const REST: readonly [number, number, number] = Object.freeze([0, 0, 0]);

export type Triad = [number, number, number];

/**
 * The biography projection, as `core/witness/action.mjs` publishes it and `verifyChain` exposes it.
 *
 * THESE NAMES ARE KIRA'S AND ARE CONSUMED, NOT RESTATED. `action.mjs` proposed them pending AURA's
 * confirmation; this is the confirmation, in the only form that counts — a reader that breaks if they
 * change. No class is re-derived here and no sixth class is invented.
 */
export interface Biography {
  schema?: unknown;
  /** Explicitly read-only tools. She looked. FREE — this must never move standing. */
  attention?: unknown;
  /** Shell and unclassified tools: RECORDED AND UNINSPECTABLE. Not known to be action. */
  unjudged?: unknown;
  /** Session lifecycle. Opening a session is not a biography. */
  boundary?: unknown;
  /** The law returned a verdict on a declared path. AN INTENT, NOT AN EFFECT. */
  judgedWritePaths?: unknown;
  /** apply / discard / rollback — the owner's decision. */
  ownerOutcomes?: unknown;
  /** The caveat on every other number here. */
  uninspectableShellCalls?: unknown;
}

/** The ledger head this module is allowed to see. Counts, and nothing that carries a word. */
export interface ChainHead {
  /** TOTAL receipts — COVERAGE, not biography. Deliberately no longer drives any plane. */
  receipts?: unknown;
  verdicts?: { refused?: unknown; allowed?: unknown; unguarded?: unknown } | null;
  biography?: Biography | null;
}

export interface FigureInput {
  /** The genesis ref. Read, never written. */
  seed?: unknown;
  chain?: ChainHead | null;
  /** Amplitude and timing. Three numbers, or nothing. */
  breathDrive?: readonly number[] | null;
}

export interface FigureState {
  /** xy · xz · yz — where the record left her. DECODED, having been through the field. */
  standing: Triad;
  /** xw · yw · zw — where the moment has her, on its way back to zero. Also decoded. */
  breath: Triad;
  /**
   * The sixteen vertex amplitudes the two triads above were read back from.
   *
   * The intermediate, carried rather than thrown away: six numbers can only be drawn, sixteen over
   * known vertices can be digested and compared. It is a READOUT of a record and grants nothing.
   */
  field: Field16;
}

// ── the arithmetic, kept small enough to check by hand ──────────────────────────────────────────

const frac = (x: number): number => x - Math.floor(x);

/** A finite, non-negative count, or zero. Anything else is not a count and is not guessed at. */
function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

/** Eight hex digits from `h` at `i`, as a unit interval. Returns 0 when there is nothing to read. */
function hexUnit(h: unknown, i: number): number {
  if (typeof h !== 'string' || h.length < i + 8) return 0;
  const n = parseInt(h.slice(i, i + 8), 16);
  return Number.isFinite(n) ? n / 4294967296 : 0;
}

/**
 * WHERE THE RECORD LEAVES HER — the disclosed map, three lines long on purpose.
 *
 *   xy   the SIZE of the record.      A logarithm, so six thousand and six hundred are a short way
 *                                     apart rather than a thousand, and `frac` keeps her inside one
 *                                     turn however long the chain runs. IT COUNTS `judgedWritePaths`
 *                                     AND NOTHING ELSE — see the note below.
 *   xz   the FRACTION REFUSED.        How much of the JUDGED record is the fence saying no. Bounded
 *                                     in [0, TAU) by construction: the denominator carries the +1,
 *                                     and `unguarded` is not in it. See the note in the body.
 *   yz   WHO SHE IS.                  The genesis ref alone. No chain can move it — a busy node and
 *                                     a silent one with the same binding stand the same way here.
 *
 * A pure function of its two arguments. No clock reaches it; no drive reaches it.
 */
export function standingOf(chain: ChainHead | null | undefined, seed: unknown): Triad {
  // ══ THE SIZE PLANE COUNTS ONE CLASS, AND THE CHOICE IS FORCED ══
  //
  // It counted TOTAL RECEIPTS, so opening a session moved biography and the brief's own rule —
  // "attention is free, action is earned" — was false at this seam. MEASURED on the owner's real
  // chain. VINTAGE head=893643e438f5 receipts=10409 at=2026-08-03 — one `verifyChain` call, and the
  // same vintage `docs/FIGURE-Z1.md` and `surface/app/aura/face.js` cite. This block previously mixed
  // an older reading (10,252 receipts) with newer counts, which is the defect the vintage exists to
  // make impossible: three documents once carried three different counts of this one record.
  //
  //     attention           1,938   18.6%     free, and must stay free
  //     unjudged            7,061   67.8%     shell nobody could inspect — 6,491 of them
  //     boundary              780    7.5%     opening a session
  //     judgedWritePaths      630    6.1%     the law judged a declared path
  //     ownerOutcomes           0    0.0%
  //
  // So receipts overstated her biography SIXTEENFOLD. (The round brief said 93% attention; measured,
  // attention is 18.9% and the dominant class is UNJUDGED. The correction matters because it changes
  // which caveat the surface owes a reader — it is shell, not reading.)
  //
  // WHY `judgedWritePaths` AND NOT A SUM. The double-count trap is real and it is not about two
  // ledgers here but two granularities of ONE: an accepted proposal yields SEVERAL judged write paths
  // and ONE owner outcome, so adding them counts the same act twice. One class, therefore. It cannot
  // be `ownerOutcomes` — measured at 0 above, so standing would never move at all. It is not
  // `unjudged`, because counting uninspectable shell as action is a guess dressed as a measurement.
  //
  // AND IT IS AN INTENT, NOT AN EFFECT. `judgedWritePaths` is the law returning a verdict on a
  // declared path. It is NOT proof anything was written. The size plane therefore means "how much did
  // the fence have to judge", which is the honest sentence and is what the surface must say.
  const judged = count(chain?.biography?.judgedWritePaths);
  const refused = count(chain?.verdicts?.refused);
  const allowed = count(chain?.verdicts?.allowed);

  // ══ AND THE REFUSAL PLANE HAD THE SAME DEFECT, WHICH THE FIRST FIX MISSED ══
  //
  // The size plane was moved off total receipts and this one was left alone, so the headline "she
  // stands on what the fence judged" was HALF TRUE for a round. `unguarded` sat in the denominator,
  // and every ordinary Read is recorded `unguarded` — so reading permanently moved standing whenever
  // any refusal existed. Reproduced exactly:
  //
  //     xz before one Read   0.04964942429475886
  //     xz after  one Read   0.049641418905482064
  //
  // (that pair was measured on the shipped build at the vintage above)
  //
  // `unguarded` is now gone from the denominator: the fraction is refusals over JUDGED PATHS. On this
  // node that is 57 / (1 + 57 + 573) rather than 57 / 10,410 — the old denominator was 16.5x too
  // large, so the plane was not merely drifting with attention, it was reporting the fence as ~1/16th
  // as busy as it is.
  //
  // WHY THE DENOMINATOR IS `refused + allowed` AND NOT `judgedWritePaths`. They are the same set —
  // `classifyReceipt` returns JUDGED_WRITE_PATH exactly when the verdict is allowed or refused — and
  // measured live they are equal (57 + 573 = 630 = judgedWritePaths). Taking both numerator and
  // denominator from `counts` keeps the fraction bounded in [0, 1) BY CONSTRUCTION rather than by an
  // agreement between two published fields. The agreement is worth having, so it is asserted in
  // `test/aura-figure.test.ts` instead of assumed here: if the two ever diverge, a test says so rather
  // than a figure quietly rendering a ratio above one.
  //
  // WHAT IS STILL WRONG HERE, AND IT IS NOT FIXED. `law:sibling-refused` — one call denied because a
  // DIFFERENT path in the same call was — is counted in `refused` like any other refusal. Measured on
  // the live chain: 3 of 56 refusals, 5.4% of this numerator, and removing them would move xz from
  // 0.560284040 to 0.530268824. It is NOT separated here because the published verdict has no field
  // for it: `counts` carries only refused/allowed/unguarded/other, and the only way for this module to
  // find them is to re-walk raw receipts and re-derive a class — a second definition of what a
  // refusal is, which is precisely what `core/witness/action.mjs` exists to prevent. Handed to Kira as
  // one field on the biography; recorded here so it is not rediscovered as new. At this vintage:
  // 3 of 57 refusals, 5.4% of the numerator, worth about 0.030 radians on this plane.
  return [
    TAU * frac(Math.log2(1 + judged) / STRINGS),
    TAU * (refused / (1 + refused + allowed)),
    TAU * hexUnit(seed, 0),
  ];
}

/**
 * One step of the breath, toward the drive and therefore toward rest whenever the drive is rest.
 *
 * Pure: previous in, next out, nothing held. The caller owns the iteration, which is what keeps this
 * module free of a clock — how often a step happens is a fact about the room, not about the figure.
 */
export function stepBreath(
  prev: readonly number[] | null | undefined,
  drive: readonly number[] | null | undefined,
  k: number = BREATH_K,
): Triad {
  const rate = typeof k === 'number' && Number.isFinite(k) && k > 0 && k <= 1 ? k : BREATH_K;
  const out: Triad = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    const p = num(prev?.[i]);
    const d = num(drive?.[i]);
    const next = p + (d - p) * rate;
    // Snap, so rest is a value rather than a limit. `+ 0` normalises a negative zero: she comes home
    // to one rest, not two that compare equal and serialise differently.
    out[i] = Math.abs(next) < REST_EPSILON ? 0 : next + 0;
  }
  return out;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * WHICH STRING A REFUSAL PLUCKS.
 *
 * From the receipt's own chain hash and nothing else — an identifier, never a body — so the same
 * refusal plucks the same string on any machine, in any order, with no seed and no chain in hand.
 * Returns null when there is no usable hash, because "nothing to pluck" and "string zero" are
 * different answers and only one of them is true.
 */
export function pluckString(receipt: { hash?: unknown } | null | undefined): number | null {
  const h = receipt?.hash;
  if (typeof h !== 'string' || h.length < 8) return null;
  const n = parseInt(h.slice(0, 8), 16);
  if (!Number.isFinite(n)) return null;
  return ((n % STRINGS) + STRINGS) % STRINGS;
}

/**
 * The figure, as six numbers.
 *
 * NEVER THROWS. It is handed whatever a surface happens to have, including nothing, and a figure that
 * threw would take down the thing drawing it — so every input is narrowed and a missing one is rest.
 * With no drive the breath is exactly `REST`, which makes "the conversation moved nothing" the
 * default rather than a thing that has to decay into place.
 */
export function computeFigureState(input: FigureInput | null | undefined): FigureState {
  const i = (input && typeof input === 'object') ? input : {};
  const drive = Array.isArray(i.breathDrive) ? i.breathDrive : null;
  const standing = standingOf(i.chain ?? null, i.seed);
  const breath: Triad = drive ? stepBreath(REST, drive, BREATH_K) : [0, 0, 0];

  // THROUGH THE CODEC, NOT AROUND IT. The six values become sixteen vertex amplitudes and come back;
  // what leaves this function is what came back, so nothing downstream can be reading a value that
  // never made the trip.
  //
  // ══ AND THE TWO LAYERS ARE DECODED SEPARATELY, WHICH IS NOT AN OPTIMISATION ══
  //
  // The first version read all six back from ONE field. It rendered byte-identically and it broke two
  // of this module's load-bearing claims, both MEASURED here rather than reasoned about:
  //
  //   · a drive of [1e6, -1e6, 1e6] moved the STANDING triad by 1.12e-11 — five orders above float
  //     rounding. "The conversation cannot move her permanently" stopped being true.
  //   · changing the seed moved BREATH. "Breath is PRESENCE and the seed is IDENTITY, and the layers
  //     stay separate" stopped being true.
  //
  // `analyze6` sums sixteen products; a large coefficient anywhere in the field costs precision in
  // every plane read back from it. Sharing one field therefore couples biography to presence at the
  // bottom of the mantissa — invisible on screen, and exactly the kind of leak this module exists to
  // refuse. So each layer round-trips through its own field and cannot reach the other's numbers.
  //
  // `field` is still the whole six-plane field: that is the intermediate the system carries, and it is
  // built from both triads. What may not happen is READING one layer back through the other's values.
  const field = fieldOf(standing, breath);
  return {
    standing: planesOf(fieldOf(standing, REST)).standing,
    breath: planesOf(fieldOf(REST, breath)).breath,
    field,
  };
}

/**
 * The six plane coefficients as sixteen vertex amplitudes — one per corner of the tesseract.
 *
 * Plane order is `walsh.ts`'s `PLANE_ORDER` and it is not a free choice: `analyze6` reads the same
 * order back, so the two are one decision expressed twice and neither may be reordered alone.
 */
export function fieldOf(standing: readonly number[], breath: readonly number[]): Field16 {
  // `?? 0` rather than `!`: a short array is a caller's mistake and a zero is the honest reading of a
  // plane nobody supplied. `synth6` would have done the same thing; saying it here keeps the types
  // truthful about what may arrive.
  return synth6([
    standing[0] ?? 0, standing[1] ?? 0, standing[2] ?? 0,
    breath[0] ?? 0, breath[1] ?? 0, breath[2] ?? 0,
  ]);
}

/**
 * Sixteen vertex amplitudes back to the six planes the rotor turns.
 *
 * EXACT on the codec's own subspace, and silently annihilating outside it — which is why nothing that
 * has been through a nonlinearity may be read back through here. `walsh.ts` argues that in full; it is
 * repeated at this call site because this is where a later edit would be tempted to process the field
 * before decoding it.
 */
export function planesOf(field: Field16): { standing: Triad; breath: Triad } {
  const c = analyze6(field);
  return { standing: [c[0], c[1], c[2]], breath: [c[3], c[4], c[5]] };
}

/** A figure is a picture of a record. It is not a permission and never has been. */
export function figureGrantsAuthority(): false {
  return false;
}
