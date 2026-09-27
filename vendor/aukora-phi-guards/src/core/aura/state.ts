// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * core/aura/state.ts — WHAT THE DOOR IS ALLOWED TO SAY ABOUT THE RECORD.
 *
 * `surface/door.ts` leaves a seam for this module and imports it dynamically, so Lane 3 can serve a
 * state without ever editing the door. The contract is stated in that file and repeated here because
 * a contract only one side can read is not a contract:
 *
 *   · GET only. This is a projection of the record; it never accepts a write.
 *   · CONTENT-FREE. Verdict counts, ages, hashes, a mood. Never file contents, prompts, paths, or
 *     command text.
 *   · Optional by construction. If this module is absent the door answers 501 and the node is fine.
 *
 * ══ THE FIELD THIS MODULE EXISTS TO GET RIGHT ══
 *
 * `trustworthy`, never `intact`.
 *
 * `core/witness/verify.mjs` says it about itself: *"`intact` is about the hash chain alone and must
 * stay that way — it is purely structural, and a forged chain is trivially 'intact' because the
 * attacker is the one who recomputed it."* Every prefix of a valid chain is a valid chain, so a
 * record truncated at the tail is perfectly `intact`. A state that reported `intact` would let the
 * face render calm over deleted history, which is the single failure `core/aura/mood.ts` was written
 * to prevent. So the verdict is handed to `auraMood()` and this module derives no health of its own.
 *
 * MEASURED, and it is the load-bearing fact for the whole lane: tail truncation moves NOTHING else.
 * `hashBreaks`, `orphans`, `unparsable`, `sigBreaks` and `sigGaps` all stay empty — every survivor
 * still hashes to its own claim and still names a predecessor that exists. `checkpointBreaks` is the
 * only field that fires, and only because a signed checkpoint vouched for a head that is now gone.
 * `test/aura-truncated-chain.test.mjs` builds exactly that repository and walks it to the ink.
 *
 * ══ INVARIANT A · NOTHING IS STORED ══
 *
 * Every number here is recomputed from the record on the call that reports it. There is no cache, no
 * accumulator, no file written, nothing read back as its own input. `activity` is a WINDOW count —
 * bounded, and it falls as readily as it rises — rather than a running figure, because a number that
 * only goes up is a currency and a currency inside a witness is a thing people farm.
 *
 * Reading is not storing, which is why calling the verifier here is not a breach of that invariant:
 * `test/aura-no-stored-value.test.ts` bans the WRITE primitives precisely because the capability is
 * what enables the farming.
 */
import { auraMood, type AuraMoodState } from './mood';
import { standingOf, computeFigureState, type Triad } from './figure';
import {
  buildGenesisAuraPacket, genesisAuraCaption, genesisAuraParams,
  type GenesisAuraBase,
} from './aumlokGenesisAura';

// ── THE TWO UNTYPED WITNESS IMPORTS, SUPPRESSED ONCE AND IMMEDIATELY NARROWED ────────────────────
//
// `core/witness/*.mjs` are plain ESM with no build step because they run under bare `node` in a hook
// where a TypeScript toolchain may not exist. `identity.mjs` has a hand-written `.d.mts` beside it;
// `verify.mjs` and `chain.mjs` do not — and the law REFUSES a write there: `judgePaths` returns
// `law:protected-path` under the rule `core/witness/**` for `core/witness/verify.mjs`. Adding a
// declaration beside the module is therefore an owner-authorized change to a protected directory,
// not something this file gets to do on its own.
//
// So the import is suppressed once, here, and narrowed on the next lines to exactly the shapes this
// module reads. This is the pattern `core/forge/protectedSweep.ts:68` already established for the
// same constraint, and it fails LOUD in the right direction: if a `verify.d.mts` ever lands, the
// `@ts-expect-error` becomes an unused-directive error and this comment gets revisited.
//
// The alternative — re-deriving soundness here — is the one thing `core/aura/mood.ts` forbids: a
// second definition of "trustworthy" that would silently stop tracking the first.
// @ts-expect-error — verify.mjs is untyped ESM; see the note above. Narrowed on the next lines.
import { verifyChain as verifyChainUntyped } from '../witness/verify.mjs';
// @ts-expect-error — chain.mjs is untyped ESM; see the note above.
import { readAll as readAllUntyped } from '../witness/chain.mjs';
// @ts-expect-error — frontier.mjs is untyped ESM; see the note above.
import { frontierOf as frontierOfUntyped } from '../witness/frontier.mjs';

export const AURA_STATE_SCHEMA = 'aura-door-state-v1' as const;

/**
 * How far back "recent" reaches.
 *
 * One hour, and the choice is the invariant rather than the number: the window must be short enough
 * that an idle node actually reaches zero, or `quiet` is a state the face can never wear and the
 * scale silently becomes a running figure with extra steps. It is a DISPLAY cadence and deliberately
 * not imported from the guard's checkpoint interval — coupling how often a face refreshes to how
 * often a device signs would be a false relationship a later reader would have to disprove.
 */
export const AURA_ACTIVITY_WINDOW_MS = 60 * 60 * 1000;

/** The break counts — LENGTHS ONLY. See `narrowVerdict` for why the arrays never travel. */
export interface AuraBreakCounts {
  hash: number;
  orphan: number;
  unparsable: number;
  signature: number;
  signatureGap: number;
  checkpoint: number;
  duplicate: number;
  fork: number;
}

/**
 * What the chain's tips are, as a condition rather than a number.
 *
 *   'none'    no chain at all
 *   'single'  one tip — the only state in which a head can be NAMED
 *   'forked'  more than one tip, so there is no single head and no name to draw
 */
/** The five classes, exactly as `core/witness/action.mjs` names them. Confirmed, not renamed. */
export interface AuraBiography {
  attention: number;
  unjudged: number;
  boundary: number;
  /** AN INTENT, NOT AN EFFECT — a law verdict on a declared path. The only class standing counts. */
  judgedWritePaths: number;
  ownerOutcomes: number;
  /** The caveat on every number above, and the surface must be able to say it. */
  uninspectableShellCalls: number;
}

export type AuraTips = 'none' | 'single' | 'forked';

export interface AuraRecordView {
  /** False when there is no chain at all — see the note in `buildAuraDoorState`. */
  present: boolean;
  receipts: number;
  signed: number;
  unsigned: number;
  /** How many chain heads exist. More than one is a fork, not a break. */
  heads: number;
  /** A 12-hex prefix, and only when there is exactly one head to name. Never a path, never a body. */
  headRef: string | null;
  /**
   * THE TIPS, AS A CONDITION. Measured on the owner's node: 41 heads and 54 forks became 52 and 67 in
   * a single day. `headRef` is null whenever there is more than one tip — correct, and it means she
   * can NEVER earn a name on the only real node while this grows. Nothing heals forks and nothing
   * alarmed on the growth, so it read as a footnote in a list of counts.
   *
   * A condition is not a footnote. `forked` is reported as a state with its consequence attached, so a
   * surface can say "no single tip, so no name" instead of quietly showing a null.
   */
  tips: AuraTips;
  /**
   * THE NAME SHE CAN HAVE TODAY.
   *
   * A fork blocks a single-tip REFERENCE. It does not block identity — identity is the seed, and this
   * face conflated the two: it read `headRef === null` as "no name" and said so on screen, which is
   * how "52 tips" came to sound like "she is nobody".
   *
   * `frontierDigest` (#139) is a digest over the SORTED SET of heads, so it names the true current
   * state of a forked chain without pretending the fork is not there and without mutating history for
   * a display convenience. Twelve hex, the same width `headRef` uses.
   */
  frontierRef: string | null;
  /** How many tips that frontier covers. Reported beside the ref so the name is never read as "one". */
  frontierCount: number;
  verdicts: { refused: number; allowed: number; unguarded: number; other: number };
  /**
   * Kira's projection (`core/witness/action.mjs`, published through `verifyChain`), consumed as
   * published. AURA does not re-derive a class or add a sixth.
   *
   * `receipts` above stays where it is and means COVERAGE — how much of the session the chain saw.
   * It is deliberately NOT inside this object: a total sitting inside a biography gets read as part
   * of one, which is the mistake this whole projection exists to undo.
   *
   * `null` when the verifier published none. NOT zeros — see `narrowVerdict`.
   */
  biography: AuraBiography | null;
  /** Receipts inside `windowMs`. Recomputed every call; never accumulated. */
  activity: number;
  windowMs: number;
  /** Age of the newest receipt in ms, or null when there is none. A duration, not a clock. */
  newestAgeMs: number | null;
  breaks: AuraBreakCounts;
}

/**
 * Why there is no identity to draw, when there is none.
 *
 *   'unbound'    — no binding material on this node at all.
 *   'unverified' — material IS present and its custody did NOT verify. A different sentence, and
 *                  the more serious one: it is what a swapped device half or a revoked key looks like.
 *   'invalid'    — material present, custody fine, but the packet itself refused to build.
 */
export type AuraGenesisAbsence = 'unbound' | 'unverified' | 'invalid';

/**
 * THE FOUR THINGS `bound` WAS BEING ASKED TO MEAN AT ONCE.
 *
 * `verify.mjs` defines `bound = custody.ok` — *this device's certificate verifies against the root
 * beside it*, and nothing more. The product then started using the word for something else entirely:
 * peer-witnessed activation. No amount of `&&` repairs that, because they are not degrees of one
 * thing; they are four independent questions with four different answers.
 *
 * THE FIELD NAMES ARE THE ONES AGREED FOR THE SPLIT, not names invented here — the point of a split is
 * that one vocabulary reaches both lanes. Kira owns the producer side; this is the consumer, deriving
 * what a face can honestly see today from what `verifyChain` already returns.
 */
/**
 * ══ THE FIVE THINGS A SECOND MACHINE CAN SAY, AND NOT ONE OF THEM IS A BOOLEAN ══
 *
 * CONSUMED VERBATIM FROM `core/witness/peer.mjs`. These are Kira's `PEER_STATES` strings, not a rival
 * vocabulary invented here — the point of one vocabulary is that it reaches both lanes, and a second
 * definition of "the witness disagrees" is exactly the drift this repository refuses everywhere else.
 * If the producer renames a state, this consumer breaks loudly rather than silently mapping it to a
 * default, which is what `narrowPeer` is for.
 *
 * The distinction that matters most, and it is the keystone applied to a second machine:
 *
 *   UNREACHABLE  is NOT disagreement. A partition must not cry wolf.
 *   UNREACHABLE  is NOT agreement either, which is the hole this whole system closes.
 *   NEVER_ASKED  is not the same as UNREACHABLE: one means there is nobody paired, the other means
 *                somebody is paired and did not answer.
 *   CONTRADICTS  is the alarm the peer system exists to raise. It is the ONLY one that is evidence
 *                against this record, and it must not look like the other four.
 */
export const AURA_PEER_STATES = Object.freeze({
  /** No retained frontier disagrees, and the witness's own clock says it was told recently enough. */
  AGREED: 'peer:agreed',
  /**
   * A retained frontier disagrees with the one this node can produce — a truncation, a
   * length-preserving prefix rewrite, or a lost branch.
   *
   * The producer's constant is named BEHIND and its own comment says "the name is narrower than the
   * set it now covers". This face does not repeat that name to a person: what a reader needs to know
   * is that a second machine remembers receipts this one cannot produce, whatever the mechanism.
   */
  CONTRADICTS: 'peer:retains-later-head',
  /** It agreed, but too long ago to be current evidence. An answer, and not a current one. */
  STALE: 'peer:stale',
  /** It has never heard of this repository and writer at all. Nobody is paired. */
  NEVER_ASKED: 'peer:never-witnessed',
  /** We could not ask. Not an accusation, and emphatically not agreement. */
  UNREACHABLE: 'peer:unreachable',
});

export type AuraPeerState = typeof AURA_PEER_STATES[keyof typeof AURA_PEER_STATES];

/** What the witness said, in a shape a surface can render without deriving anything. */
export interface AuraPeerView {
  /**
   * NULL MEANS THIS BUILD COULD NOT SEE PEER STATE AT ALL, which is a different sentence from
   * `NEVER_ASKED`. A verifier that published no peer section leaves us unable to say whether anyone
   * was ever asked; `NEVER_ASKED` is the answer that nobody is paired. Rendering the first as the
   * second would be a face reporting a completed check that never ran.
   */
  state: AuraPeerState | null;
  /** Why, in a sentence a person can read. Never a code, never a score. */
  because: string;
  /** The frontier the witness named, when it named one. Twelve hex, or nothing. */
  witnessRef: string | null;
  /** How old the witness's answer is by its own clock. Null when it did not say. */
  agedMs: number | null;
}

export interface AuraActivation {
  /** The local certificate verifies. This is what `bound` has always actually meant. */
  custodyBound: boolean;
  /** The law is sealed by the root — not merely present and unsigned. */
  lawSealed: boolean;
  /** At least one signed checkpoint stands over this chain, unbroken. */
  signedEpoch: boolean;
  /**
   * NULL, AND NULL IS THE POINT. Peer acknowledgement is not derivable from `verifyChain`, and this
   * lane's standing rule is that "we could not ask" and "the answer is no" are different sentences —
   * so it reports UNKNOWN rather than false. A face may never draw WITNESSED_ACTIVE off an unasked
   * question, and `activationState` caps itself accordingly.
   */
  peerWitnessed: boolean | null;
  /**
   * The five-valued truth behind `peerWitnessed`.
   *
   * `peerWitnessed` stays exactly the boolean-or-null it has always been — it answers the narrow
   * question "is this frontier peer-acknowledged RIGHT NOW", which is what gates `WITNESSED_ACTIVE` —
   * so nothing consuming it changes. This carries WHY, because "no" covers two very different
   * situations and one of them is an alarm.
   */
  peer: AuraPeerView;
  /**
   * The single state a surface should render.
   *
   *   UNBOUND                   no custody at all
   *   CUSTODY_READY             custody verifies; nothing sealed or signed over it yet
   *   SIGNING_PENDING_WITNESS   sealed and/or signed, and no peer currently vouches for this frontier
   *   WITNESSED_ACTIVE          a peer acknowledged THIS frontier, recently enough to count
   */
  activationState: 'UNBOUND' | 'CUSTODY_READY' | 'SIGNING_PENDING_WITNESS' | 'WITNESSED_ACTIVE';
}

export type AuraGenesisView =
  | { present: false; absence: AuraGenesisAbsence; because: string }
  | { present: true; genesisRef: string; caption: string; base: GenesisAuraBase };

export interface AuraDoorState {
  schema: typeof AURA_STATE_SCHEMA;
  /** Straight from `core/aura/mood.ts`. This module does not second-guess it. */
  mood: AuraMoodState;
  /**
   * @deprecated CARRIES ONE MEANING AND WAS BEING READ AS FOUR. It is `custodyBound` and only that.
   * Kept so nothing breaks mid-split; read `activation` instead.
   */
  bound: boolean;
  /** The four questions `bound` was being asked to answer at once. See `AuraActivation`. */
  activation: AuraActivation;
  record: AuraRecordView;
  genesis: AuraGenesisView;
  /**
   * The standing triad — xy · xz · yz, in radians, as `core/aura/figure.ts` computes it.
   *
   * Served rather than recomputed in the browser so there is ONE implementation of what the record
   * says. `surface/app/aura/rotor.js` draws these three numbers and computes nothing about the chain.
   * Content-free by construction: it is a pure function of counts that this payload already carries.
   */
  standing: Triad;
  /** What a face may never be read as claiming, carried so a caller cannot quote a state without it. */
  limits: string;
  grantsAuthority: false;
}

export const AURA_STATE_LIMITS =
  'a picture of a record: continuity of recorded history only. Not humanity, not honesty, not '
  + 'exclusive control; it cannot unlock, sign, approve, rank, gate, or apply anything.';

/** The minimal verdict view this module reads. Anything wider would put a receipt body on the wire. */
export interface NarrowedVerdict {
  trustworthy: unknown;
  intact: unknown;
  bound: boolean;
  receipts: number;
  signed: number;
  unsigned: number;
  heads: number;
  headRef: string | null;
  verdicts: AuraRecordView['verdicts'];
  biography: AuraBiography | null;
  breaks: AuraBreakCounts;
}

const HEX64 = /^[0-9a-f]{64}$/;

/** The schema `action.mjs` publishes. A projection that does not say this is not one we can read. */
export const AURA_BIOGRAPHY_SCHEMA = 'aukora-biography-v1';

/** The schema a peer report must declare. Producer-owned; refused rather than guessed at. */
export const AURA_PEER_SCHEMA = 'aukora-peer-report-v1';

/**
 * ABSENT IS NULL, AND NULL IS NOT ZERO.
 *
 * A verifier that published no biography, or published one under a schema this face does not know, is
 * a verifier we could not ask. Coercing that to five zeros would render a node with no biography
 * identically to a node with a spotless one — and the whole point of the projection is that those are
 * different sentences. The same rule `auraMood` applies to an absent `bound`.
 */
function narrowBiography(v: unknown): AuraBiography | null {
  if (!v || typeof v !== 'object') return null;
  const b = v as Record<string, unknown>;
  if (b.schema !== AURA_BIOGRAPHY_SCHEMA) return null;
  const need = ['attention', 'unjudged', 'boundary', 'judgedWritePaths', 'ownerOutcomes',
    'uninspectableShellCalls'] as const;
  // Every field, or none. A partial projection is a shape change, not a smaller biography.
  for (const k of need) if (typeof b[k] !== 'number' || !Number.isFinite(b[k] as number)) return null;
  return {
    attention: num(b.attention), unjudged: num(b.unjudged), boundary: num(b.boundary),
    judgedWritePaths: num(b.judgedWritePaths), ownerOutcomes: num(b.ownerOutcomes),
    uninspectableShellCalls: num(b.uninspectableShellCalls),
  };
}

/** Every peer state, as a set, so an unknown string is refused rather than mapped to a default. */
const PEER_SET: ReadonlySet<string> = new Set(Object.values(AURA_PEER_STATES));

/** A twelve-hex reference or nothing — the same refusal `frontierRefOf` makes about a digest. */
const refOf = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const head = v.slice(0, 12);
  return /^[0-9a-f]{12}$/.test(head) ? head : null;
};

/**
 * WHAT THE WITNESS SAID, OR THE HONEST ADMISSION THAT WE CANNOT SEE.
 *
 * The rule is the one this lane applies to every other published field: a section that is absent, or
 * carries a schema this build does not know, or names a state outside the agreed set, becomes NULL —
 * never a default, never the friendliest neighbouring value. A face that rendered an unrecognised
 * state as "never asked" would be reporting a completed check that never ran.
 */
export function narrowPeer(v: unknown): AuraPeerView {
  const absent = (because: string): AuraPeerView =>
    ({ state: null, because, witnessRef: null, agedMs: null });

  if (!v || typeof v !== 'object') {
    return absent('this build cannot see whether any second machine remembers this record');
  }
  const p = v as Record<string, unknown>;
  if (p.schema !== AURA_PEER_SCHEMA) {
    return absent('the peer report came under a schema this face does not understand, so it says nothing');
  }
  if (typeof p.state !== 'string' || !PEER_SET.has(p.state)) {
    return absent('the peer report named a state this face does not recognise — it is not guessed at');
  }
  const state = p.state as AuraPeerState;
  const witnessRef = refOf(p.witnessRef);
  const agedMs = typeof p.agedMs === 'number' && Number.isFinite(p.agedMs) && p.agedMs >= 0
    ? p.agedMs : null;

  // ONE SENTENCE PER STATE, AND THEY ARE NOT INTERCHANGEABLE. Each says what happened and what it does
  // and does not license. The contradiction sentence names the fact, not the mechanism, because the
  // producer's own comment says the mechanism set is wider than its constant's name.
  const BECAUSE: Record<AuraPeerState, string> = {
    [AURA_PEER_STATES.AGREED]:
      'a second machine remembers this record and agrees with it — this is no longer self-attested',
    [AURA_PEER_STATES.CONTRADICTS]:
      'A SECOND MACHINE REMEMBERS RECEIPTS THIS NODE CANNOT PRODUCE. Something was truncated, rewritten '
      + 'or lost — this is the disagreement the witness exists to catch',
    [AURA_PEER_STATES.STALE]:
      'a second machine agreed, but too long ago to count as current evidence',
    [AURA_PEER_STATES.NEVER_ASKED]:
      'no second machine has ever been told about this record — nothing is paired',
    [AURA_PEER_STATES.UNREACHABLE]:
      'a second machine is paired and did not answer. That is not disagreement and it is not agreement',
  };
  return { state, because: BECAUSE[state], witnessRef, agedMs };
}

/**
 * The four questions, from what `verifyChain` actually returns.
 *
 * `peerWitnessed` is TRUE for exactly one of the five peer states. Two of them are `false` — an
 * answer that does not vouch for this frontier — and two are `null`, because "we could not ask" and
 * "the answer is no" are different sentences and always have been here. `WITNESSED_ACTIVE` is
 * therefore reachable only on AGREED, which is the ceiling lifting exactly as far as the evidence.
 */
export function activationOf(verdict: unknown, custodyBound: boolean): AuraActivation {
  const r = (verdict && typeof verdict === 'object' ? verdict : {}) as Record<string, unknown>;
  const authority = (r.authority ?? {}) as { ok?: unknown; law?: { state?: unknown } | null };
  const lawState = authority.law?.state;
  const lawSealed = authority.ok === true
    && typeof lawState === 'string' && lawState !== 'unbound' && lawState !== 'law-unsigned';
  const signedEpoch = custodyBound && len(r.checkpointBreaks) === 0 && num(r.signed) > 0;

  const peer = narrowPeer(r.peer);
  // TRUE for AGREED alone. STALE and CONTRADICTS are answers that do not vouch for THIS frontier;
  // NEVER_ASKED and UNREACHABLE, and an absent section, are not answers at all.
  const peerWitnessed = peer.state === null
    || peer.state === AURA_PEER_STATES.NEVER_ASKED
    || peer.state === AURA_PEER_STATES.UNREACHABLE
    ? null
    : peer.state === AURA_PEER_STATES.AGREED;

  let activationState: AuraActivation['activationState'] = 'UNBOUND';
  if (custodyBound) {
    activationState = (lawSealed || signedEpoch) ? 'SIGNING_PENDING_WITNESS' : 'CUSTODY_READY';
    if (activationState === 'SIGNING_PENDING_WITNESS' && peerWitnessed === true) {
      activationState = 'WITNESSED_ACTIVE';
    }
  }
  return { custodyBound, lawSealed, signedEpoch, peerWitnessed, peer, activationState };
}

/** Twelve hex, or null. Never an empty string pretending to be a name. */
export function frontierRefOf(digest: unknown): string | null {
  if (typeof digest !== 'string') return null;
  const head = digest.slice(0, 12);
  return /^[0-9a-f]{12}$/.test(head) ? head : null;
}

/** One tip is nameable; more than one is a condition. See `AuraRecordView.tips`. */
export function tipsOf(heads: number): AuraTips {
  if (!Number.isFinite(heads) || heads <= 0) return 'none';
  return heads === 1 ? 'single' : 'forked';
}
const len = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

/**
 * Project a `verifyChain` result down to the fields that may leave this process.
 *
 * ══ WHY LENGTHS AND NOT THE ARRAYS ══
 *
 * `verifyChain` returns `unparsable[]`, and each entry carries `raw` — a VERBATIM ledger line. That
 * is the one place a receipt body escapes the verifier, and forwarding the array wholesale would put
 * file paths and tool arguments on a GET. Projecting `.length` makes the content-free property true
 * by construction rather than true by inspection, which is the difference between a guarantee and a
 * habit. For the same reason `explain()` is not called from here at all: it returns the canonical
 * receipt body, the preimage bytes, and an absolute chain path.
 *
 * ══ `bound` IS READ, NOT SYNTHESIZED — AND THE ABSENCE OF IT IS A REFUSAL ══
 *
 * `core/aura/mood.ts` branches on `verdict.bound === false` to reach `unwitnessed`, and for a while
 * `verifyChain` emitted no such field: the branch never fired, and an unbound-but-sound node rendered
 * `quiet` — "nothing has happened recently" — when the true statement was "nothing has signed for
 * this at all". This lane could not fix that at the source, because the law correctly refuses it
 * `core/witness/**`, so it derived the field from `custody.ok` and wrote the hand-off down.
 *
 * `verify.mjs` now emits it (`bound: custody.ok`, unconditional in the return literal, and pinned in
 * both directions by `test/witness-bound.test.mjs`). The derivation is gone and the field is read.
 * Deliberately not "kept as a fallback": two definitions of one fact is how they drift, and the
 * fallback would be the one nobody notices going stale.
 *
 * A VERDICT THAT DOES NOT CARRY `bound` IS REFUSED, exactly as one missing `trustworthy` is.
 * Coercing an absent field to `false` would have this face state "nothing has signed for this" — a
 * positive claim about the world — on the authority of a verifier that never answered the question.
 * "We could not ask" and "the answer is no" are different sentences, and keeping them apart is the
 * whole job. Refusing is also fail-closed: the result is the alarm, never a calm or identity-bearing
 * state.
 */
export function narrowVerdict(v: unknown): NarrowedVerdict | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  // A verdict missing either field is a verifier this face does not understand, and is refused rather
  // than repaired — "we could not ask" and "the answer was yes" must stay different sentences all the
  // way up. Both are checked, because both are now part of the contract `verifyChain` publishes.
  if (!('trustworthy' in r) || !('bound' in r)) return null;

  const heads = Array.isArray(r.heads) ? r.heads : [];
  const head0 = heads[0] as { hash?: unknown } | undefined;
  const headHash = typeof head0?.hash === 'string' && HEX64.test(head0.hash) ? head0.hash : null;
  const counts = (r.counts ?? {}) as Record<string, unknown>;

  return {
    trustworthy: r.trustworthy,
    intact: r.intact,
    bound: r.bound === true,
    receipts: num(r.receipts),
    signed: num(r.signed),
    unsigned: num(r.unsigned),
    heads: heads.length,
    // Only when there is exactly one head is there a single thing to name. The precedent is
    // `core/witness/log.mjs:110`, and it matters: the live node has nine heads, so a face that
    // assumed one would be wrong on the only real node that exists.
    headRef: heads.length === 1 && headHash ? headHash.slice(0, 12) : null,
    biography: narrowBiography(r.biography),
    verdicts: {
      refused: num(counts.refused), allowed: num(counts.allowed),
      unguarded: num(counts.unguarded), other: num(counts.other),
    },
    breaks: {
      hash: len(r.hashBreaks), orphan: len(r.orphans), unparsable: len(r.unparsable),
      signature: len(r.sigBreaks), signatureGap: len(r.sigGaps), checkpoint: len(r.checkpointBreaks),
      duplicate: len(r.duplicates), fork: len(r.forks),
    },
  };
}

/**
 * Count receipts inside the window, and measure the newest one's age.
 *
 * Timestamps only. The entries carry `tool`, `path` and `resolved`, and none of them is read here —
 * this function's whole output is two numbers.
 *
 * A receipt stamped in the future is counted as present rather than discarded: a clock that has run
 * ahead is a real condition, and silently dropping those rows would make the window quietly
 * under-report. The age clamps at zero rather than going negative, because a negative duration is
 * not a thing this face can render honestly.
 */
export function activityInWindow(
  entries: ReadonlyArray<{ ts?: unknown }>,
  now: number,
  windowMs = AURA_ACTIVITY_WINDOW_MS,
): { activity: number; newestAgeMs: number | null } {
  const cutoff = now - windowMs;
  let activity = 0;
  let newest: number | null = null;
  for (const e of entries) {
    if (!e || typeof e.ts !== 'string') continue;
    const t = Date.parse(e.ts);
    if (!Number.isFinite(t)) continue;
    if (t >= cutoff) activity += 1;
    if (newest === null || t > newest) newest = t;
  }
  return { activity, newestAgeMs: newest === null ? null : Math.max(0, now - newest) };
}

export interface FrontierLike {
  frontierDigest?: unknown;
  frontierCount?: unknown;
}

export interface BuildStateInput {
  verdict: unknown;
  /** From `core/witness/frontier.mjs`. Injected, so this stays a pure function. */
  frontier?: FrontierLike | null;
  /** Chain entries, for the window count. Only `ts` is read. */
  entries: ReadonlyArray<{ ts?: unknown }>;
  /** Injected rather than read, so this function is pure and the tests are not timing tests. */
  now: number;
  /** The two rotation-stable public facts, when this node has them. Absent means UNBOUND. */
  genesis?: { rootId: string; boundAt: string } | null;
  windowMs?: number;
}

/**
 * The whole state, as a pure function of what it is handed. No IO, no clock read, no filesystem.
 *
 * ══ AN EMPTY RECORD IS NOT A SOUND ONE ══
 *
 * `verifyChain` answers `trustworthy: true` for a node with no chain at all, and it is right to —
 * there is nothing to contradict. But "nothing to verify" and "verified" are different sentences,
 * and the face must not collapse them. So `record.present` is carried separately and the surface
 * says the honest line beside the mood. It is deliberately NOT a sixth mood: `AURA_MOODS` is pinned
 * against `MOOD_STYLE` by test, and a mood the palette has no entry for falls through to a default,
 * which is exactly where `cannot-verify` quietly becomes something softer.
 */
export function buildAuraDoorState(input: BuildStateInput): AuraDoorState {
  const windowMs = typeof input.windowMs === 'number' && input.windowMs > 0
    ? input.windowMs : AURA_ACTIVITY_WINDOW_MS;
  const v = narrowVerdict(input.verdict);
  const entries = Array.isArray(input.entries) ? input.entries : [];
  const { activity, newestAgeMs } = activityInWindow(entries, input.now, windowMs);

  // A verdict that could not be narrowed is handed on as null, NOT repaired. `auraMood(null)` is the
  // alarm state, which is the correct answer to "we do not have a verdict".
  // The peer report is narrowed once and the ONE BIT the mood is allowed to judge on is handed over.
  // The five-state vocabulary stays here; `mood.ts` never learns a peer word.
  const activation = activationOf(input.verdict, v?.bound === true);
  const mood = auraMood(
    v === null ? null : {
      trustworthy: v.trustworthy,
      intact: v.intact,
      bound: v.bound,
      peerContradicts: activation.peer.state === AURA_PEER_STATES.CONTRADICTS,
    },
    activity,
  );

  const record: AuraRecordView = {
    present: (v?.receipts ?? 0) > 0,
    receipts: v?.receipts ?? 0,
    signed: v?.signed ?? 0,
    unsigned: v?.unsigned ?? 0,
    heads: v?.heads ?? 0,
    headRef: v?.headRef ?? null,
    tips: tipsOf(v?.heads ?? 0),
    // A DIGEST OR NOTHING. `''.slice(0,12)` is `''`, which is a string and would render as
    // "frontier  · 52 tips" — a name that is not one. Absence has to be absence, so the value must
    // actually look like a digest before it is allowed to be a name.
    frontierRef: frontierRefOf(input.frontier?.frontierDigest),
    frontierCount: num(input.frontier?.frontierCount),
    verdicts: v?.verdicts ?? { refused: 0, allowed: 0, unguarded: 0, other: 0 },
    biography: v?.biography ?? null,
    activity,
    windowMs,
    newestAgeMs,
    breaks: v?.breaks ?? {
      hash: 0, orphan: 0, unparsable: 0, signature: 0,
      signatureGap: 0, checkpoint: 0, duplicate: 0, fork: 0,
    },
  };

  return {
    schema: AURA_STATE_SCHEMA,
    mood,
    bound: v?.bound === true,
    activation,
    record,
    // Custody gates the genesis half — see `genesisView`. `bound` and `genesis.present` must never
    // be able to disagree on one screen.
    // THE BIOGRAPHY REACHES THE FIGURE. Without this line `standingOf` sees no biography and the size
    // plane reads zero for every node on earth — a silent flattening that would look like a calm one.
    //
    // THROUGH `computeFigureState`, WHICH ROUTES THE SIX PLANES THROUGH THE WALSH CODEC. This called
    // `standingOf` directly, and `computeFigureState` — the function that exists to assemble the six —
    // had no production caller at all, which meant neither did `core/cube/walsh.ts`. The value that
    // crosses the wire is now the DECODED one: synthesised onto sixteen vertex amplitudes and read
    // back. Lossless, so nothing on screen moves; the point is that the codec is on the path a request
    // actually takes rather than beside it.
    //
    // `breathDrive: null` because breath is PRESENCE and does not belong on the wire — the browser
    // steps it per frame. So the six values here are the record's posture with breath at rest, which
    // is exactly the REST FRAME a stranger can reproduce.
    standing: computeFigureState({
      chain: { receipts: record.receipts, verdicts: record.verdicts, biography: record.biography },
      seed: genesisSeed(input.genesis, { ok: v?.bound === true }),
      breathDrive: null,
    }).standing,
    genesis: genesisView(input.genesis ?? null, { ok: v?.bound === true }),
    limits: AURA_STATE_LIMITS,
    grantsAuthority: false,
  };
}

/**
 * The genesis half, and the reason it is usually absent.
 *
 * φ is UNBOUND: there is no `aukora.pub`, so there is no `rootId` and no `boundAt`, so there is no
 * genesis packet and no figure derived from one. That is reported as `present: false` with the
 * reason attached — never as a placeholder ref, and never as a figure drawn from a made-up seed.
 * An invented identity rendered confidently is the same class of lie as a calm face over a truncated
 * chain: both look like an answer and neither is one.
 *
 * ══ AND CUSTODY IS A PRECONDITION, NOT A SEPARATE HEADLINE ══
 *
 * `aukora.pub` is read for two strings and its signature is checked by nobody here. So binding
 * material can be PRESENT while `custody.ok` is FALSE — a device certificate that does not verify
 * against the root beside it, which is what a swapped device half, a revoked key, or a pub file
 * copied from another root looks like.
 *
 * Reported independently, that produced two contradictory sentences from one state: the mood said
 * *"this node is not bound — nothing has signed for it"* while the genesis half simultaneously said
 * `present: true` and handed the page a real `genesisRef` to draw the node's ACTUAL identity from,
 * confidently, under a certificate that failed. A face is not allowed to assert an identity out of
 * material whose custody did not verify — that is the same lie class as a calm face over a truncated
 * chain, arriving by a different door.
 *
 * So custody GATES the genesis half, and the refusal is named rather than flattened into "unbound":
 * "we cannot verify this binding" and "there is no binding" are different sentences, and a reader
 * who is being tampered with deserves the first one.
 */
export function genesisView(
  facts: { rootId: string; boundAt: string } | null,
  custody: { ok: boolean },
): AuraGenesisView {
  if (!facts || typeof facts.rootId !== 'string' || typeof facts.boundAt !== 'string') {
    return {
      present: false, absence: 'unbound',
      because: 'this node is not bound — there is no genesis to draw from',
    };
  }
  if (custody?.ok !== true) {
    return {
      present: false, absence: 'unverified',
      because: 'this node carries binding material whose custody did NOT verify — no identity is '
        + 'drawn from material that cannot be checked',
    };
  }
  const built = buildGenesisAuraPacket(facts);
  if (!built.ok) {
    return {
      present: false, absence: 'invalid',
      because: `the genesis facts on this node did not validate (${built.refused})`,
    };
  }
  return {
    present: true,
    genesisRef: built.packet.genesisRef,
    caption: genesisAuraCaption(built.packet),
    base: genesisAuraParams(built.packet),
  };
}

// ── THE IO HALF ─────────────────────────────────────────────────────────────────────────────────

interface WitnessVerdictShape { [k: string]: unknown }
const verifyChain = verifyChainUntyped as (repoRoot: string) => WitnessVerdictShape;
const readAll = readAllUntyped as (repoRoot: string) => { records: Array<{ entry: { ts?: unknown } }> };
const frontierOf = frontierOfUntyped as (repoRoot: string) => FrontierLike;

/**
 * Two directories under the root, matching `core/memory/ledger.ts` and `core/forge/deadDoor.ts`.
 * The env override exists for the same reason it does there: a suite must be able to point this at a
 * fixture without tearing down the module cache.
 */
function repoRoot(): string {
  const fromEnv = process.env.AUKORA_FORGE_REPO;
  if (fromEnv) return fromEnv;
  const bunDir = (import.meta as unknown as { dir?: string }).dir;
  const here = bunDir ?? dirnameOf(new URL(import.meta.url).pathname);
  return normalizeUp(here, 2);
}

function dirnameOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

function normalizeUp(from: string, levels: number): string {
  let out = from;
  for (let i = 0; i < levels; i += 1) out = dirnameOf(out);
  return out;
}

/**
 * The two rotation-stable public facts, or null.
 *
 * They live in `aukora.pub`, written once at bind and never rewritten by a phrase rotation — which
 * is the entire reason the base survives a rotation. This node has no such file, so this returns
 * null and the state says so. Read directly rather than through `readPub` so that this module needs
 * no third untyped witness import for two string fields; the file is content-free public material by
 * definition, and only those two fields are taken from it.
 */
async function genesisFacts(root: string): Promise<{ rootId: string; boundAt: string } | null> {
  try {
    const fs = await import('fs');
    const raw = fs.readFileSync(`${root}/aukora.pub`, 'utf8');
    const pub = JSON.parse(raw) as { schema?: unknown; rootId?: unknown; boundAt?: unknown };
    if (pub?.schema !== 'aukora-pub-v0') return null;
    if (typeof pub.rootId !== 'string' || typeof pub.boundAt !== 'string') return null;
    return { rootId: pub.rootId, boundAt: pub.boundAt };
  } catch {
    return null;
  }
}

/**
 * What `surface/door.ts` calls. Zero arguments, and it MUST NOT THROW.
 *
 * The door's `catch` around this call reports every throw as `aura_absent` — "core/aura/state.ts is
 * not present on this node" — which would be a false statement about the node the moment this file
 * exists. So the failure path returns a state instead: a real `AuraDoorState` whose verdict could not
 * be produced, which `auraMood` renders as the alarm. A face that cannot see the record shows that it
 * cannot see the record.
 */
export async function auraStateForDoor(): Promise<AuraDoorState> {
  const now = Date.now();
  try {
    const root = repoRoot();
    const verdict = verifyChain(root);
    // A second pass over the ledger, for timestamps only. It may catch a receipt the verifier did not,
    // and the reverse — the two reads are not one snapshot. That is acceptable HERE and nowhere else
    // in this lane: the cost of a one-receipt disagreement is a window count off by one on a picture,
    // whereas `auraEvidenceReader` takes the twice-read snapshot discipline because a drifting store
    // there would produce a stitched cryptographic commitment.
    const entries = readAll(root).records.map((r) => r.entry);
    // The frontier names a forked chain's current state — see `AuraRecordView.frontierRef`.
    let frontier: FrontierLike | null = null;
    try { frontier = frontierOf(root) as FrontierLike; } catch { frontier = null; }
    return buildAuraDoorState({ verdict, entries, now, frontier, genesis: await genesisFacts(root) });
  } catch {
    return buildAuraDoorState({ verdict: null, entries: [], now, frontier: null, genesis: null });
  }
}

/**
 * The seed the figure stands on, or the empty string.
 *
 * An unbound node has no genesis ref, and the figure must not be handed a placeholder that looks like
 * one — the same refusal `genesisView` makes. An empty seed stands at zero in the identity plane,
 * which is honest: there is no identity to stand on yet.
 */
function genesisSeed(
  facts: { rootId: string; boundAt: string } | null | undefined,
  custody: { ok: boolean },
): string {
  if (!facts) return '';
  // THE SAME GATE `genesisView` APPLIES, AND FOR THE SAME REASON.
  //
  // Reported by an outside reviewer and REPRODUCED before it was ruled on: with `device.cert`
  // tampered on a real bound repository, this returned a ref, `standing.yz` came out at 4.198621, and
  // the very same payload said `genesis: { present: false, absence: 'unverified' }`. The identity
  // plane was angled by material whose custody had failed, on a state that simultaneously refused to
  // name an identity.
  //
  // That is the rule this lane wrote in #97 — "no identity is drawn from material that cannot be
  // checked" — broken by the standing triad added in the round after it. Same lie class, arriving
  // through a door this lane opened itself.
  //
  // It is a gate rather than "one deliberate sentence" because a sentence would DOCUMENT the
  // disagreement instead of removing it, and the whole point of the #97 gate is that `bound` and the
  // identity can never disagree on one screen. Unverified custody stands at zero in the identity
  // plane, which is the honest angle: there is no verified identity to stand on.
  if (custody?.ok !== true) return '';
  const built = buildGenesisAuraPacket(facts);
  return built.ok ? built.packet.genesisRef : '';
}

/** A state is a picture of a record. It is not a permission and never has been. */
export function auraStateGrantsAuthority(): false {
  return false;
}
