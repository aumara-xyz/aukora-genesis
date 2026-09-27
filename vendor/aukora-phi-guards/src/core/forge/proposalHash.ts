// Aukora Spatial — THE HASH THAT BINDS AN APPROVAL TO BYTES.
//
// ══ WHAT THIS IS FOR ══
//
// `review.capture()` produces a proposal and a short `digest` a person can compare by eye. Nothing
// re-derives that digest from the bytes a later `apply()` is about to write — so "what the owner saw"
// and "what lands" are two claims about the same proposal, joined only by nothing having gone wrong in
// between. This module is the one hash both sides can compute from the same inputs: given a proposal's
// id and its files, it always answers the same 64-hex-character string, and a single changed byte, a
// renamed path, or a file added to the set changes it.
//
// ══ WHY CONTENT IS HASHED RATHER THAN JOINED AS TEXT ══
//
// `Buffer` throughout, not `string`: `apply()`'s whole point is to hash the EXACT bytes it is about to
// hand to `writeFile`, not a string that bytes were decoded into and would have to be re-encoded
// identically to match. Hashing the buffer directly removes that round-trip from the argument entirely.
//
// ══ WHY THE ENTRIES ARE SORTED BY PATH ══
//
// The same set of files enumerated in two different orders — a plain array one call, a `Map`'s
// iteration order another — must hash the same, or the same proposal produces two different hashes
// depending on incidental iteration order and a real approval is refused as though it were a forgery. So
// order is normalised here, once, rather than left as an assumption every caller has to keep.
//
// ══ WHAT IT IS NOT ══
//
// NOT a signature. This binds an approval to bytes; it does not prove WHO approved them — φ has no
// pinned authority root wired on this path. The honest claim is exactly this: the bytes that land are
// the bytes the approval named, nothing stronger.

import { createHash } from 'crypto';

export interface ProposalFile {
  relPath: string;
  /** The exact content to bind. A `string` is encoded as UTF-8; a `Buffer` is hashed as-is. */
  content: string | Buffer;
}

function contentBuffer(c: string | Buffer): Buffer {
  return Buffer.isBuffer(c) ? c : Buffer.from(c, 'utf8');
}

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Canonical proposal hash: `id`, plus every file's path and a hash of its exact content, sorted by
 * path so iteration order never changes the answer.
 */
export function computeProposalHash(id: string, files: ProposalFile[]): string {
  const entries = files
    .map((f) => ({ r: f.relPath, c: sha256Hex(contentBuffer(f.content)) }))
    .sort((a, b) => (a.r < b.r ? -1 : a.r > b.r ? 1 : 0));
  return createHash('sha256').update(JSON.stringify({ id, files: entries }), 'utf8').digest('hex');
}

/** A proposal hash is 64 lowercase hex characters. Anything else did not come from here. */
export function isProposalHash(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
}
