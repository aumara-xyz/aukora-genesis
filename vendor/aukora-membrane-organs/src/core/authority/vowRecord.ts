// PORTED to membrane core/authority/vowRecord.ts from aukora-phi core/authority/vowRecord.ts
// (AUMLOK-AUTHORITY-PORT-v0). Recognition only — does not mint vows or run ceremony.
// import.meta.dir depth unchanged (core/authority → repo root via ../..).

// φ · core/authority/vowRecord.ts — RECOGNISING a vow. Never minting one.
//
// ══ WHY THIS FILE IS SEPARATE FROM THE CEREMONY THAT WRITES IT ══
//
// aukora-one's best structural idea is a property of its import graph, and its test says so plainly:
//
//     the MAIN door cannot mint — it does not import the keygen
//     "This is the whole separation, and it is a property of the import graph rather than a promise."
//
// Its always-running browser-facing door imports only a presence check; the one file that can create
// owner authority is a separate process on a separate port, off by default. Not by policy — by
// reachability.
//
// φ inherits that shape exactly. `standing.ts` is consulted by every write verb on this node, on every
// request, and it must be able to RECOGNISE a vow. It must not be able to PERFORM one. So the reading
// half lives here, imports nothing from `ceremony/`, and contains no randomness, no phrase generation
// and no write of any kind. `ceremony/vow.ts` is the only file that writes this record, and
// `test/vow-standing.test.ts` asserts the direction of that arrow — because the day someone adds a
// convenient `grantStanding()` helper to this file, the seam is gone and nothing else would notice.
//
// ══ WHAT A PRESENT, INTACT RECORD PROVES — AND WHAT IT DOES NOT ══
//
// This is the part that must not be overstated, so it is stated first and in full.
//
// IT PROVES: a ceremony ran on this machine in real mode, someone was shown seven words and typed them
// back, and the record this node reads is the one that ceremony wrote rather than a truncated or
// hand-edited fragment of it.
//
// IT DOES NOT PROVE the owner authorized anything cryptographically. There is no signature here. The
// `integrity` digest is computed by a function in this file, so anyone who can write the record can also
// compute a valid digest for it. It is TAMPER-EVIDENT AGAINST ACCIDENT — a half-written file, a
// hand-edited field, a record from a different repo root — and it is not tamper-proof against a person
// with write access and this source in front of them. Calling it "signed" or "verified" would be the
// exact species of overstatement `ceremony/recovery.ts` exists to correct.
//
// ══ SO WHAT ACTUALLY FENCES THIS, MEASURED HONESTLY ══
//
// Writing this record requires local filesystem write access as the user running the node. That is the
// same physical-possession act `AUKORA_FORGE=1` already required — someone with the machine, the shell
// and the intent. **The vow is therefore a second door of the same strength as the arming switch, not a
// weaker one**, and that is the whole basis on which it may raise standing at all.
//
// One real gap, named rather than left for a reader to find: `core/forge/review.ts` applies owner-accepted
// proposals to arbitrary paths, so a proposal that wrote this file and was clicked through would grant
// standing. The click is owner authorization and LAW §1 is satisfied — but the owner would be clicking a
// diff, not taking a vow, and those should not be the same act. The fence belongs in the forge's
// protected-path list, which is another lane's file; `test/vow-standing.test.ts` records the gap as a
// live, failing-if-forgotten note instead of a comment nobody reads.
//
// ══ AND THE COURTYARD PIN STILL OUTRANKS ALL OF IT ══
//
// `AUKORA_COURTYARD=1` wins over an intact vow record, for the reason `standing.ts` already gives about
// arming: "so 'courtyard' can never be a weaker promise than it sounds." A kiosk build that could be
// raised by a file on disk would be a different and much worse promise.

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';

export const VOW_SCHEMA = 'aukora-phi-standing-vow-v1';

/**
 * The record, and every field it may carry.
 *
 * Content-free by construction, and the field list is the policy — the same discipline
 * `core/forge/review.ts` applies to its receipts. There is no phrase here and no fingerprint OF the
 * phrase: `ceremony/recovery.ts` measures the keyspace at 14.3 bits of min-entropy, so a stored sealed
 * hash would be recoverable by enumeration in about 32 CPU-minutes. The salt is kept because it links
 * the record to its receipt and carries nothing on its own; the hash is not kept because nothing here
 * needs it and keeping it would hand an enumerator the phrase.
 */
export interface VowRecord {
  schema: typeof VOW_SCHEMA;
  /** Content-free id of the vow. Derived, never a name, never a counter. */
  vowId: string;
  /** The salt of the sealed phrase. Not the phrase, and deliberately not the hash of it. */
  phraseSalt: string;
  /** Seven, from `BIND_PHRASE_WORDS`. Recorded so a shorter phrase format cannot pass as this one. */
  phraseWords: number;
  at: string;
  /** Digest over the fields above. Tamper-evident against accident; see the header. */
  integrity: string;
}

/** The only keys a vow record may carry. An unknown key is a refusal, not a field to ignore. */
export const VOW_FIELDS: readonly string[] = ['schema', 'vowId', 'phraseSalt', 'phraseWords', 'at', 'integrity'];

export type VowReadFailure =
  | 'vow:absent'
  | 'vow:unreadable'
  | 'vow:schema-unknown'
  | 'vow:field-unknown'
  | 'vow:field-missing'
  | 'vow:integrity-mismatch';

export type VowVerdict =
  | { present: true; record: VowRecord }
  | { present: false; reasonClass: VowReadFailure };

/**
 * The repository root, read LIVE on every call.
 *
 * Same shape and same reason as `core/forge/review.ts`: the donor froze it in a `const` at module load,
 * so a test could not point the module at a fresh directory without tearing down the module cache. A
 * seam no test can exercise is a seam nobody can trust — and this one decides whether a node can write.
 */
function repoRoot(): string {
  const bunDir = (import.meta as unknown as { dir?: string }).dir;
  return process.env.AUKORA_FORGE_REPO
    ?? (bunDir ? path.resolve(bunDir, '..', '..')
               : path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..'));
}

/**
 * WHERE THE RECORD LIVES — the one function both halves call.
 *
 * aukora-one's launcher had four bugs and this was the fourth: `custodyStatus()` probed four files under
 * `~/.aukora-one/aumlok/`, the launcher wrote none of them, so a fully successful bind left the node
 * reporting `custody:absent` forever. The ceremony wrote somewhere nothing looked.
 *
 * That cannot happen if there is exactly one function that knows the path and both the reader and the
 * writer call it. `test/vow-standing.test.ts` asserts they do.
 */
export function vowRecordPath(paths: { dir?: string } = {}): string {
  return path.join(paths.dir ?? path.join(repoRoot(), '.aukora'), 'standing.json');
}

/**
 * The integrity digest over a record's own fields.
 *
 * Canonical by construction — the field order is the literal below rather than `Object.keys`, so a
 * re-serialized record with the same values digests the same no matter how it was written. The domain
 * string is deliberately distinct from every other digest in this repository so a value from one family
 * can never be replayed as a value from another.
 */
export function vowIntegrity(r: Omit<VowRecord, 'integrity'>): string {
  return createHash('sha256')
    .update(`aukora-phi-standing-vow-integrity:v1|${r.schema}|${r.vowId}|${r.phraseSalt}|${r.phraseWords}|${r.at}`)
    .digest('hex');
}

/**
 * Read the record, or say precisely why not.
 *
 * Every failure is a named class rather than a `false`, because a node that will not write needs to be
 * able to tell its owner the difference between "no vow has been taken here" and "there is a vow record
 * and it is not the one the ceremony wrote".
 */
export function readVowRecord(paths: { dir?: string } = {}): VowVerdict {
  const file = vowRecordPath(paths);
  if (!existsSync(file)) return { present: false, reasonClass: 'vow:absent' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // A half-written file is the ordinary case here, not an exotic one: the write is not atomic against
    // a power cut. Unreadable is a refusal, never a throw into a caller that only asked about standing.
    return { present: false, reasonClass: 'vow:unreadable' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { present: false, reasonClass: 'vow:unreadable' };
  }
  const row = parsed as Record<string, unknown>;

  if (row.schema !== VOW_SCHEMA) return { present: false, reasonClass: 'vow:schema-unknown' };
  // An unknown key is refused rather than ignored. A record that grew a `standing: "owner"` field would
  // otherwise sit there looking harmless while some later reader honoured it.
  for (const k of Object.keys(row)) {
    if (!VOW_FIELDS.includes(k)) return { present: false, reasonClass: 'vow:field-unknown' };
  }
  if (typeof row.vowId !== 'string' || row.vowId.length === 0
    || typeof row.phraseSalt !== 'string' || row.phraseSalt.length === 0
    || typeof row.phraseWords !== 'number'
    || typeof row.at !== 'string' || row.at.length === 0
    || typeof row.integrity !== 'string') {
    return { present: false, reasonClass: 'vow:field-missing' };
  }

  const record: VowRecord = {
    schema: VOW_SCHEMA,
    vowId: row.vowId,
    phraseSalt: row.phraseSalt,
    phraseWords: row.phraseWords,
    at: row.at,
    integrity: row.integrity,
  };
  const { integrity, ...rest } = record;
  // Constant-time is not the right tool here and pretending otherwise would be theater: the record is
  // public, the digest is not a secret, and there is no attacker to leak timing to. `verify.ts` uses
  // `timingSafeEqual` where it matters, which is against a typed-back phrase.
  if (vowIntegrity(rest) !== integrity) return { present: false, reasonClass: 'vow:integrity-mismatch' };

  return { present: true, record };
}

/** Is there a vow on this node? The one question `standing.ts` asks. */
export function vowPresent(paths: { dir?: string } = {}): boolean {
  return readVowRecord(paths).present;
}
