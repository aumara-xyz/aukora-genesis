/**
 * core/cube/fingerprint.ts — A DIGEST, EMBODIED, SO A PERSON CAN COMPARE TWO SCREENS.
 *
 * Pure. No clock, no chain, no custody, no IO, no randomness. A digest in, a pose out.
 *
 * ══ WHAT THIS IS FOR ══
 *
 * Two machines claim the same continuity. The machines compare the full digest — that is the security
 * and it is not negotiable. A HUMAN cannot compare sixty-four hex characters across two screens
 * reliably, and everyone who has tried knows they check the first four and the last four. This gives
 * them something they can actually compare, and it is a READOUT of the digest, never a substitute for
 * it. `FINGERPRINT_LIMITS` says so in the payload, and `fingerprintGrantsAuthority()` returns false.
 *
 * ══ IT IS NOT A CIPHER AND NOBODY SHOULD TRY ══
 *
 * `core/cube/walsh.ts` describes an exact, reversible, PUBLIC LINEAR map over sixteen numbers, and
 * `docs/TESSERACT-BRIEF.md` already says the tesseract is a viewing cage rather than hidden topology.
 * Anyone holding this file can invert the geometry back to the six angles, and the six angles are a
 * lossy read of the digest. There is no secret here, there is no key, and the shape hides nothing.
 * All it does is move a comparison a person was going to perform badly into a channel where they
 * perform it well.
 *
 * ══ WHY IT IS NOT THE FIGURE ══
 *
 * The figure is WHO A NODE IS: seed, standing, breath, and it is custody-gated on purpose —
 * `genesisSeed` returns nothing unless the reading device's own certificate verifies, because no
 * identity may be drawn from material that cannot be checked (#97).
 *
 * That gate is correct and it makes the figure USELESS for this job: a clean device holding a
 * byte-identical ledger draws a different figure by construction, which is exactly the recipient a
 * verification ceremony is aimed at. Measured, and filed as a design question rather than papered
 * over.
 *
 * A fingerprint is a different object. It claims nothing about identity, so no custody gate applies:
 * it says "this is what THIS DIGEST looks like", which is true on any machine, enrolled or not. It has
 * no seed, no standing and no breath, and therefore no layers — the three-layer discipline is about a
 * biography, and a fingerprint has none.
 *
 * ══ FOUR EVENTS, AND THEY MUST NOT MERELY BE DIFFERENT NUMBERS ══
 *
 * Root change, enrollment, revocation and recovery each move continuity, and a person must be able to
 * tell WHICH from across a room. Two channels carry that, deliberately redundantly:
 *
 *   · the KIND is folded into the digest domain, so it cannot be relabelled without changing the pose;
 *   · the KIND also selects a discrete, nameable MARK, because a categorical fact should be read
 *     categorically rather than inferred from an angle.
 *
 * A continuous channel alone would fail the brief: two poses differing by a few degrees are "visibly
 * different" only to somebody told to look for it.
 */

/** A full turn. Every angle below is bounded inside one. */
export const TAU = Math.PI * 2;

/**
 * The six rotation planes, in the FROZEN order `surface/app/aura/rotor.js` uses.
 *
 * The names are borrowed from the figure's vocabulary because the geometry is the same geometry. The
 * LAYER MEANING IS NOT BORROWED: nothing here is standing and nothing here is breath. A fingerprint
 * is a static pose in all six planes at once, which the figure never is — the figure rests at zero in
 * three of them by definition, and a rest frame that used only half the planes would throw away half
 * the digest.
 */
export const PLANE_NAMES: readonly string[] = Object.freeze(['xy', 'xz', 'yz', 'xw', 'yw', 'zw']);

/** What moved. Folded into the digest AND drawn as a discrete mark. */
export const FINGERPRINT_KINDS = Object.freeze({
  ROOT_CHANGE: 'continuity:root-change',
  ENROLLMENT: 'continuity:enrollment',
  REVOCATION: 'continuity:revocation',
  RECOVERY: 'continuity:recovery',
});

export type FingerprintKind = typeof FINGERPRINT_KINDS[keyof typeof FINGERPRINT_KINDS];

/**
 * The discrete mark for each kind. Chosen to be distinguishable at a glance and in one word, so two
 * people on a phone can say which they are looking at without describing an angle.
 *
 * `arms` is how many marks ring the pose; `filled` and `crossed` are shape, not colour — colour alone
 * fails for the people most likely to be doing this carefully.
 */
export const KIND_MARKS: Readonly<Record<FingerprintKind, {
  word: string; arms: number; filled: boolean; crossed: boolean;
}>> = Object.freeze({
  [FINGERPRINT_KINDS.ROOT_CHANGE]: { word: 'ROOT', arms: 1, filled: true, crossed: false },
  [FINGERPRINT_KINDS.ENROLLMENT]: { word: 'ENROLLED', arms: 3, filled: false, crossed: false },
  [FINGERPRINT_KINDS.REVOCATION]: { word: 'REVOKED', arms: 3, filled: false, crossed: true },
  [FINGERPRINT_KINDS.RECOVERY]: { word: 'RECOVERED', arms: 5, filled: true, crossed: true },
});

/** What a fingerprint is allowed to be used for, carried in the payload rather than assumed. */
export const FINGERPRINT_LIMITS =
  'a readout of a digest, for a human to compare. The machines compare the full digest and only the '
  + 'full digest. A matching shape is not verification, it is a reason to check the characters.';

export interface Fingerprint {
  /** The digest this is a picture of, echoed so a surface can show it beside the shape. */
  digest: string;
  kind: FingerprintKind;
  /** Six angles in [0, TAU), one per plane, in `PLANE_NAMES` order. */
  pose: readonly number[];
  mark: typeof KIND_MARKS[FingerprintKind];
  limits: string;
  grantsAuthority: false;
}

/** Lower-case hex only, and long enough to fill six planes. Anything else is not a digest. */
const HEX = /^[0-9a-f]+$/;

/**
 * FNV-1a over a string, as a 32-bit unsigned integer.
 *
 * Arithmetic, not cryptographic, and that is correct here — it SPREADS a digest into six angles and
 * defends nothing. The security is the caller's digest, which this cannot weaken: a fingerprint is a
 * lossy read of it and always was.
 */
function fold32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The pose for a digest under an event kind.
 *
 * THROWS on a digest it cannot read, rather than returning a pose. A fingerprint computed from a
 * malformed input would be a shape a person could compare — and it would be comparing nothing. There
 * is no honest default here: the whole object is "a picture of this digest", so with no digest there
 * is no object. `absent` renders as SILENCE, never as zero.
 */
export function fingerprintOf(input: { digest?: unknown; kind?: unknown }): Fingerprint {
  const digest = typeof input?.digest === 'string' ? input.digest.trim().toLowerCase() : '';
  if (!HEX.test(digest) || digest.length < 48) {
    throw new Error(
      `a fingerprint needs at least 48 hex characters of digest; got ${digest.length || 0}. `
      + 'There is no pose for an unreadable digest — a shape drawn from nothing is a shape somebody '
      + 'would compare.',
    );
  }
  const kind = input?.kind as FingerprintKind;
  if (!Object.prototype.hasOwnProperty.call(KIND_MARKS, kind as string)) {
    throw new Error(
      `unknown continuity kind ${JSON.stringify(input?.kind)}. The four are: `
      + `${Object.values(FINGERPRINT_KINDS).join(', ')}`,
    );
  }

  // ══ EVERY PLANE READS THE WHOLE DIGEST, AND THE FIRST VERSION OF THIS DID NOT ══
  //
  // It sliced six eight-character windows out of `digest + salt + digest` at offsets 0…40. A sha256 is
  // 64 characters, so those windows covered the FIRST 48 AND NOTHING ELSE: the last sixteen hex
  // characters were never read, and the salt — which sat at offset 64 — was never read either.
  //
  // MEASURED, which is the only reason it was caught:
  //
  //     one hex digit changed (last position)  →  pose distance 0.000000 rad
  //     the four kinds over one digest         →  separation     0.000000 rad
  //
  // Two claims this file makes in its own header were false: that a relabelled event lands on a
  // different pose, and that the fingerprint is a picture of the digest. It was a picture of three
  // quarters of the digest, and the kind reached nothing at all. This is the same defect shape as an
  // identity plane that read 32 bits of a 96-bit reference — a window narrower than the thing it
  // claims to represent — and it was built again here by someone who had already found it once.
  //
  // Now each plane is folded over the ENTIRE (kind, digest, plane index) triple, so every character
  // of the digest reaches every plane and the kind cannot be relabelled without moving the pose.
  const pose = Object.freeze(PLANE_NAMES.map((name, i) => {
    const bits = fold32(`aukora-fingerprint-v1|${kind}|${digest}|${i}|${name}`);
    return TAU * (bits / 4294967296);
  }));

  return Object.freeze({
    digest,
    kind,
    pose,
    mark: KIND_MARKS[kind],
    limits: FINGERPRINT_LIMITS,
    grantsAuthority: false as const,
  });
}

/**
 * How far apart two poses are, as the mean absolute angular difference on the circle, in radians.
 *
 * This is the instrument behind "visibly different, NOT merely numerically different". Two digests
 * that differ produce two poses, and if those poses are a degree apart no human will ever tell them
 * apart — the readout would be worse than the hex, because it would look like agreement. A number
 * makes that testable instead of hopeful.
 *
 * Circular distance, so 0.01 and TAU−0.01 are close, which is what an eye sees.
 */
export function poseDistance(a: readonly number[], b: readonly number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = Math.abs(((a[i] ?? 0) - (b[i] ?? 0)) % TAU);
    total += Math.min(d, TAU - d);
  }
  return total / a.length;
}

/** It is a picture. It cannot authorize, verify, unlock, sign, approve, rank or gate anything. */
export function fingerprintGrantsAuthority(): false {
  return false;
}
