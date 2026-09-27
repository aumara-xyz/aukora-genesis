// Aukora Spatial — STANDING: who is at the glass, and what the glass will do for them.
//
// Implements §2 and §3 of docs/SPEC_SURFACE_COURTYARD.md on THIS node's own write seam.
//
// ══ WHY THIS IS A SEAM AND NOT A UI STATE ══
//
// The spec is blunt about it and it is the whole reason this file is server-side: "Hiding a button is
// theater; the fence answering `refused-no-standing` is law." A courtyard guest is not a user with
// some controls greyed out — they are a caller whose write verbs do not resolve. Every path that
// changes something on this machine or spends the owner's money asks this module first, and a refusal
// is a named class the surface can show on camera.
//
// ══ THE THREE STANDINGS, AND WHICH ONE THIS REPO CAN ACTUALLY REACH ══
//
//   0 · COURTYARD — anyone. Converse, watch the world build, cast, listen, read. Nothing persists.
//   1 · THE VOW   — the AUMLOK acrostic ceremony. IMPLEMENTED, in `ceremony/`.
//   2 · CREATION  — the crush loop behind the membrane.
//
// There are now two honest ways to be above the courtyard here, and they are the same act performed
// through different doors:
//
//   · THE OWNER ARMED THIS NODE IN THEIR OWN TERMINAL. `AUKORA_FORGE=1` is a physical-possession act —
//     someone with the machine, the shell and the intent typed it before the process started. That is
//     not the vow and this file never calls it the vow; it is the owner's node running as the owner.
//   · A VOW WAS TAKEN ON THIS NODE. `ceremony/door.ts` is a separate process on a separate port, off by
//     default, and refuses to be real without `AUKORA_CEREMONY=real` typed by hand. Someone with the
//     machine started it, was shown seven words once, and typed them back.
//
// ══ THE PARAGRAPH THIS FILE USED TO HAVE, AND WHY IT IS GONE ══
//
// It read: "Because standing 1 cannot be reached from this repo yet, there is exactly one honest way to
// be above the courtyard here… When the ceremony lands, `vowed` becomes reachable through it and the seam
// below does not change: it already asks the right question."
//
// The ceremony has landed, and the seam below did not change — `requestAction` is untouched. What
// changed is that `currentStanding()` now has a second thing to recognise. The graft came from
// aukora-one, whose own STATUS.md names the reciprocal gap: its membrane "cannot apply, promote, or
// materialize, and no owner-authorization path". It had the rite and nowhere for the result to go; this
// file was the somewhere. `PROVENANCE.md` records what came and what did not.
//
// ══ WHAT A VOW IS WORTH, STATED HERE BECAUSE THIS IS WHERE IT IS SPENT ══
//
// The phrase is 14.3 bits of min-entropy — about twice a 4-digit PIN, measured three ways in
// `ceremony/recovery.ts`. It is NOT the credential, and reading it as one would be the single worst
// misunderstanding available in this repository. What fences a vow is that writing its record requires
// local filesystem access as the user running this node — the same physical-possession act
// `AUKORA_FORGE=1` already required. The vow is a second door of the same strength, not a weaker one.
// `core/authority/vowRecord.ts` carries the full accounting, including the one gap it does not close.
//
// ══ THE COURTYARD BUILD ══
//
// `AUKORA_COURTYARD=1` pins standing 0 no matter what else is set. This is the deployable build a
// stranger meets — a kiosk, a first-experience room, a demo on someone else's laptop — and the spec's
// structural claim holds for it literally: it ships with no path to a write verb, so there is nothing
// to escalate to. It also wins over arming on purpose, so "courtyard" can never be a weaker promise
// than it sounds.

import { readVowRecord, vowPresent } from './vowRecord';

export type Standing = 'courtyard' | 'vowed' | 'owner';

/** Write-shaped actions. Read, converse, draw-as-display and listen are NOT here, by design. */
export type Action = 'write' | 'execute' | 'spend';

export interface StandingVerdict {
  ok: boolean;
  standing: Standing;
  /** Present only on a refusal. The named class the spec requires (§3). */
  class?: 'refused-no-standing';
  /** Plain sentence the surface can show without inventing wording of its own. */
  reason?: string;
}

/**
 * The courtyard pin, read LIVE.
 *
 * This was `const COURTYARD_PINNED = process.env.AUKORA_COURTYARD === '1'` — captured at import, in the
 * one file whose own comment explains why that is wrong. `currentStanding()` read the variable live and
 * the report read the frozen copy, so a process that pinned the courtyard after this module loaded
 * reported `courtyardPinned: false` while refusing every write. The report is what a surface shows a
 * person; it was the half that could disagree with the seam.
 */
function courtyardPinned(): boolean {
  return process.env.AUKORA_COURTYARD === '1';
}

/**
 * The standing this process is running at.
 *
 * Read from the environment and the disk every call rather than cached at import: a test must be able to
 * set the courtyard pin, or take a vow, and observe the seam move. A cached module-level constant would
 * make the most important behaviour in this file the one thing that could not be exercised.
 *
 * The vow read is two syscalls and a sha256 per call. That is deliberate and it is cheap next to any
 * request that asks — and a cache here would be a cache on the answer to "may this caller write", which
 * is the last value in this repository that should be allowed to go stale.
 */
export function currentStanding(): Standing {
  if (courtyardPinned()) return 'courtyard';
  // The owner's arming switch, typed into their own terminal before the process existed.
  if (process.env.AUKORA_FORGE === '1') return 'owner';
  // A vow taken on this node, through `ceremony/door.ts`. Recognised here; never minted here.
  if (vowPresent()) return 'vowed';
  return 'courtyard';
}

/** Standing 2 — may reach a write verb. */
export function canCreate(s: Standing = currentStanding()): boolean {
  return s === 'vowed' || s === 'owner';
}

/**
 * THE SEAM. Every write-capable door calls this before doing anything else.
 *
 * Deliberately shaped like aukora-one's `Service.Request(ctx, { Path, ToolName, Action })` so that
 * when the two repos meet, this is the same question asked in the same place, not a second policy that
 * has to be kept in sync with the first.
 */
export function requestAction(action: Action, tool: string): StandingVerdict {
  const standing = currentStanding();
  if (canCreate(standing)) return { ok: true, standing };
  return {
    ok: false,
    standing,
    class: 'refused-no-standing',
    reason: `${tool} is a ${action} verb, and this node is standing at the courtyard. `
      + 'Anyone may converse here, watch the world build, cast, listen and read — nothing is saved and '
      + 'nothing is owned. Creating is what the vow is for, and the vow is not open on this build.',
  };
}

/** What the surface may show about where it stands. Content-free: no keys, no paths, no identity. */
export function standingReport() {
  const standing = currentStanding();
  const pinned = courtyardPinned();
  const vow = readVowRecord();
  return {
    standing,
    canCreate: canCreate(standing),
    // Named plainly so surface copy never has to paraphrase a capability (spec §6.3, claims parity).
    courtyardPinned: pinned,
    /**
     * ══ THIS FIELD WAS A HARDCODED `false` AND IT IS THE REASON THE GRAFT HAPPENED ══
     *
     * It said: "The vow is not implemented in this repository and this field says so rather than implying
     * a door." That was true and it was the right way to be wrong — a claim that undersells is repairable;
     * one that oversells spends trust.
     *
     * It is now COMPUTED, and it is false on a courtyard-pinned build. Not because the ceremony is missing
     * there — the code is identical — but because the pin outranks a vow, so taking one on a pinned build
     * would move nothing. A surface offering "take the vow" there would be offering a door that opens onto
     * the same room. `vowAvailable` answers "will this change where I stand", which is the only question a
     * person asking it actually means.
     */
    vowAvailable: !pinned,
    /** Has a vow been taken on this node? A fact, separate from whether one is offered. */
    vowTaken: vow.present,
    vowNote: pinned
      ? 'This is a courtyard build. The AUMLOK ceremony is present in `ceremony/`, and AUKORA_COURTYARD=1 '
        + 'outranks a vow — taking one here would change nothing, so nothing is offered.'
      : 'The AUMLOK acrostic ceremony is in `ceremony/`. It is a separate process on its own port, off by '
        + 'default, and it rehearses unless AUKORA_CEREMONY=real is set by hand. Seven words, shown once, '
        + 'typed back — worth about twice a 4-digit PIN, and what authorizes it is that you started it.',
    /**
     * Why this node does not read as vowed, when it does not.
     *
     * `vow:absent` is the ordinary answer and means nobody has vowed here. Any OTHER class means a record
     * exists and is not the one the ceremony wrote, which a person is entitled to be told rather than left
     * to infer from a silent courtyard. The values are named classes, never content.
     */
    ...(vow.present ? {} : { vowRecordNote: vow.reasonClass }),
  };
}
