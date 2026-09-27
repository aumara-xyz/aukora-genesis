// φ · ceremony/vow.ts — where the vow actually lands
//
// ══ THIS IS THE FILE THAT CHANGED MEANING IN TRANSPLANT, AND IT IS THE POINT OF THE GRAFT ══
//
// aukora-one's `ui/ceremony/commit.mjs` is where the owner's KEY lands: two seeds into Keychain custody
// under `CUSTODY_ACCOUNTS` names, two public halves onto disk where `custodyStatus()` probes. That half
// did NOT come across, and PROVENANCE.md says so with its reasons — it needs `@aukora/kernel`,
// `@noble/post-quantum` and a Keychain backend, and LAW §3 puts custody material out of reach here.
//
// What came across is the RULE the file exists to enforce, which is not about keys at all:
//
//     **A ceremony verifies its own result.** After writing, it asks the reader whether the node is
//     actually changed, and if the answer is no it says so instead of printing success. The owner
//     performs this once; a success message he cannot check is worth less than an honest failure.
//
// ══ WHAT LANDS HERE INSTEAD ══
//
// STANDING. aukora-one's own STATUS.md names its gap exactly — its membrane "cannot apply, promote, or
// materialize, and no owner-authorization path" — so its ceremony was a rite with nothing downstream of
// it. φ is the other half of that sentence: `core/authority/standing.ts` is a live write seam that every
// write verb on this node asks first, and until now it had no way to MINT standing, only to recognise it.
// Its own comment said so: "Because standing 1 cannot be reached from this repo yet…"
//
// The graft closes both gaps with one edge. The ceremony gets somewhere for its result to go; the seam
// gets a door other than an environment variable. Neither repository could do this alone.
//
// ══ THE FOUR BUGS THIS FILE INHERITED THE SCARS OF ══
//
// The donor's launcher had four, in ~15 lines, none of which any test caught because nothing ran it. Two
// of them are about shape (`available()` on the wrapper, `store` vs `write`) and do not survive the
// change of medium. The other two are about a ceremony writing where nothing reads, and they survive
// completely:
//
//   · bug 3 — the seeds were keyed by their FIELD names rather than the ACCOUNT names anything
//     downstream looked for, so nothing could find them. Here: the record is written by
//     `vowRecordPath()`, the one function `standing.ts` also calls. Not a matching literal — the same
//     function.
//   · bug 4 — `custodyStatus()` probed four files the launcher never wrote, so a perfect bind reported
//     `custody:absent` forever. Here: the commit re-reads through `readVowRecord()`, the reader the seam
//     itself uses, and reports what THAT says rather than what the write returned.
//
// ══ AND THE ONE THAT COST THE OWNER FIFTEEN MINUTES OF HIS ONE CEREMONY ══
//
// `test/ceremony-commit.test.mjs`: "a REHEARSAL cannot write into the real custody home". It did. The
// seeds went to an ephemeral store correctly and the PUBLIC halves went to the real
// `~/.aukora-one/aumlok/` — and `isBound()` probes that exact directory, so the rehearsal made the node
// look bound and the REAL ceremony refused as already-bound. A rehearsal blocked the thing it rehearsed.
//
// So a rehearsal here is refused outright unless it was given a directory of its own. Not warned about,
// not defaulted — refused, with a named class, before anything is written.

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  readVowRecord, vowIntegrity, vowRecordPath, VOW_SCHEMA,
  type VowRecord,
} from '../../core/authority/vowRecord';
import { currentStanding, type Standing } from '../../core/authority/standing';
import { BIND_PHRASE_WORDS } from './verify';

/** The receipt ledger. Beside the forge's, in the same content-free discipline, and not the same file. */
export function vowLedgerPath(paths: { dir?: string } = {}): string {
  return join(dirname(vowRecordPath(paths)), 'standing-receipts.jsonl');
}

export class VowError extends Error {
  reasonClass: string;

  constructor(reasonClass: string, message: string) {
    super(message);
    this.name = 'VowError';
    this.reasonClass = reasonClass;
  }
}

/** What the ceremony hands its sink. Content-free: there is no phrase in this shape and cannot be. */
export interface VowPayload {
  /** Content-free id of the vow, derived by the ceremony. */
  vowId: string;
  /** The sealed phrase's salt. Never the phrase, never the hash — see `core/authority/vowRecord.ts`. */
  phraseSalt: string;
  phraseWords: number;
}

export interface VowReceipt {
  rehearsal?: boolean;
  at?: string;
  [k: string]: unknown;
}

export interface VowOutcome {
  /** Paths written, for the owner's own reading. Not content. */
  written: string[];
  /** The reader `standing.ts` uses agrees the record is there and intact. */
  recordVerified: boolean;
  /** Standing on THIS node, re-read after the write. */
  standing: Standing;
  /** Did the seam actually move? A rehearsal must answer false. */
  standingRaised: boolean;
  /** recordVerified AND standingRaised. The single honest verdict a launcher may print. */
  verified: boolean;
  note: string;
  rehearsal: boolean;
  reasonClass?: string;
}

export interface VowCommitDeps {
  writeFileSync?: typeof writeFileSync;
  appendFileSync?: typeof appendFileSync;
  mkdirSync?: typeof mkdirSync;
  existsSync?: typeof existsSync;
  readVowRecord?: typeof readVowRecord;
  currentStanding?: typeof currentStanding;
  now?: () => number;
}

/**
 * Build the commit function the ceremony door calls.
 *
 * ══ `replace` IS A DECISION, NOT A LITERAL ══
 *
 * The donor passed `true` unconditionally, and `authority/secure-custody.mjs:173` gates its ONLY
 * collision refusal on `!replace`:
 *
 *     if (!replace && this.has(account)) return { custody:already-present }
 *
 * So the one check standing between a fresh ceremony and the owner's existing key was disabled by its own
 * caller. Combined with a missing re-check on completion, that was a complete consume-then-overwrite path
 * to a binding that could not be recovered.
 *
 * A FIRST VOW IS NOT A ROTATION. Default `false`; the caller must say otherwise and mean it.
 */
export function makeVowCommit({
  paths = {},
  deps = {},
  replace = false,
}: { paths?: { dir?: string }; deps?: VowCommitDeps; replace?: boolean } = {}) {
  const write = deps.writeFileSync ?? writeFileSync;
  const append = deps.appendFileSync ?? appendFileSync;
  const mkdir = deps.mkdirSync ?? mkdirSync;
  const exists = deps.existsSync ?? existsSync;
  const read = deps.readVowRecord ?? readVowRecord;
  const standingNow = deps.currentStanding ?? currentStanding;
  const now = deps.now ?? Date.now;

  return async function commit({ vow, receipt }: { vow: VowPayload; receipt: VowReceipt }): Promise<VowOutcome> {
    const rehearsal = receipt?.rehearsal === true;

    // ── A REHEARSAL MUST HAVE A HOME OF ITS OWN, OR IT DOES NOT RUN ──
    //
    // The donor's rehearsal wrote into the real custody home and blocked the owner's real ceremony. The
    // refusal is here rather than in the caller because the caller is the thing that forgot.
    if (rehearsal && !paths.dir) {
      throw new VowError('vow:rehearsal-would-write-real-home',
        'a rehearsal was not given a directory of its own — refusing to write into the real .aukora, '
        + 'because a rehearsal that looks like a vow blocks the vow it rehearses');
    }

    if (!vow || typeof vow.vowId !== 'string' || vow.vowId.length === 0) {
      throw new VowError('vow:id-missing', 'the ceremony handed over no vow id');
    }
    if (typeof vow.phraseSalt !== 'string' || vow.phraseSalt.length === 0) {
      throw new VowError('vow:salt-missing', 'the ceremony handed over no phrase salt');
    }
    if (typeof vow.phraseWords !== 'number') {
      throw new VowError('vow:words-missing', 'the ceremony handed over no phrase length');
    }
    // ── A SHORTER (OR LONGER) PHRASE FORMAT MUST NOT PASS AS THIS ONE ──
    //
    // `core/authority/vowRecord.ts` documents this field's whole reason for existing: "Recorded so a
    // shorter phrase format cannot pass as this one." Checking only `< 1` let a vow claiming ONE word
    // be accepted, written and digested as a fully valid vow — `standing.ts` grants 'vowed' from the
    // record's mere presence, never from this count, so a record like that would carry exactly as much
    // trust as a real seven-word ceremony. The one real caller, `ceremony/door.ts`, always passes
    // `BIND_PHRASE_WORDS` itself and never reaches this branch; the check belongs here anyway, in the
    // one function that writes the record, rather than resting on that caller remembering to be right.
    if (vow.phraseWords !== BIND_PHRASE_WORDS) {
      throw new VowError('vow:words-wrong',
        `a vow must record exactly ${BIND_PHRASE_WORDS} phrase words, not ${vow.phraseWords} — `
        + 'a shorter or longer format must not pass as this one');
    }

    const file = vowRecordPath(paths);

    // ── A FIRST VOW MAY NOT OVERWRITE A STANDING ONE ──
    if (!replace && exists(file)) {
      throw new VowError('vow:already-present',
        'this node already carries a vow record — a first vow is not a rotation, and rotation is a '
        + 'separate ceremony that does not exist here yet');
    }

    const at = new Date(now()).toISOString();
    const base: Omit<VowRecord, 'integrity'> = {
      schema: VOW_SCHEMA,
      vowId: vow.vowId,
      phraseSalt: vow.phraseSalt,
      phraseWords: vow.phraseWords,
      at,
    };
    const record: VowRecord = { ...base, integrity: vowIntegrity(base) };

    // 0700: a directory that decides whether this node can write is not a world-readable one.
    mkdir(dirname(file), { recursive: true, mode: 0o700 });
    write(file, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    const written = [file];

    // ── THE RECEIPT ──
    //
    // Content-free, and a separate ledger from the forge's: a vow is not a proposal and mixing the two
    // would make one line of `standing-receipts.jsonl` mean two different things.
    const ledger = vowLedgerPath(paths);
    append(ledger, `${JSON.stringify({
      kind: 'standing-vowed',
      vowId: record.vowId,
      phraseWords: record.phraseWords,
      rehearsal,
      at,
    })}\n`, { mode: 0o600 });
    written.push(ledger);

    // ── AND NOW THE RULE: THE CEREMONY VERIFIES ITS OWN RESULT ──
    //
    // Through the reader the SEAM uses, not through the writer's own return value. If those two ever
    // disagree, this is where it surfaces — which is precisely what the donor's bug 4 needed and did not
    // have.
    const after = read(paths);
    const recordVerified = after.present;
    const standing = standingNow();
    const standingRaised = standing !== 'courtyard';

    const note = rehearsal
      ? (recordVerified
        ? 'REHEARSAL — a real phrase, a real type-back and a real record, written to a throwaway '
          + 'directory. This node\'s standing is UNCHANGED and nothing was kept.'
        : `REHEARSAL — and the record did not land (${after.present ? 'ok' : after.reasonClass}). `
          + 'The rehearsal itself failed, which is the cheapest possible place to learn that.')
      : (recordVerified
        ? (standingRaised
          ? `Vowed. The record is on disk and the seam reads this node at ${standing}.`
          : 'The record is on disk and intact, but this node still stands at the courtyard — '
            + 'AUKORA_COURTYARD=1 pins it there and outranks a vow by design. The vow is recorded and '
            + 'it changes nothing while the pin is set.')
        : `The record did not land (${after.present ? 'ok' : after.reasonClass}). This node is NOT vowed.`);

    return {
      written,
      recordVerified,
      standing,
      standingRaised: rehearsal ? false : standingRaised,
      // A rehearsal is never `verified` — there is nothing to have verified. Reporting otherwise is how
      // a rehearsal starts reading like the thing it rehearses.
      verified: !rehearsal && recordVerified && standingRaised,
      note,
      rehearsal,
      ...(after.present ? {} : { reasonClass: after.reasonClass }),
    };
  };
}

/** Committing records a vow. It does not confer permission to use one. */
export function vowGrantsAuthority(): boolean {
  return false;
}
