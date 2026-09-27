// φ — durable writes. Ported and trimmed from `@aukora/kira`'s `adapters/durableWrite.ts`
// (aukora-one, `organs/kira`). See `docs/MEMORY-PORT.md` and `PROVENANCE.md`.
//
// ══ WHY THIS FILE EXISTS — THE EXACT BUG THIS PORT MUST NOT REINTRODUCE ══
//
// `writeSync` MAY WRITE FEWER BYTES THAN IT WAS ASKED TO, and its return value is the only place that
// fact appears. It does not throw on a short write — POSIX explicitly permits one on a regular file — so
// code that calls it once and discards the count can stage part of a file, `fsync` the part, rename it
// over the real name, and report success. The donor's own external review measured this twice: a
// `writeFileDurably('abcdef')` under a `writeSync` landing one byte per call published the single byte
// `"a"`; a ledger erasure under the same mock reported `matched: 1` and published the WHOLE LEDGER as
// the single byte `"{"` — every surviving memory destroyed by the act of forgetting one, with a receipt
// saying it went fine. Both are the one defect: a byte count read and then not checked.
//
// This file is the fix, and the ONLY thing this port takes from `adapters/vaultLock.ts` — the
// cross-process lock itself is explicitly NOT ported (see `docs/MEMORY-PORT.md`); the write-loop and the
// stage/verify/flush/publish sequence are a data-integrity fix, not a concurrency one, and apply just as
// much to a single writer as to many.
//
// ══ WHAT THIS DOES NOT EARN ══
//
// Application-level complete writes: every byte handed to `writeAllSync` is accepted by the kernel,
// `fstat` agrees with the length intended, and both the data and the containing directory are `fsync`'d
// before the caller is told it landed. It does NOT earn device-level power-loss durability — `fsync`
// asks the OS, and a consumer SSD may acknowledge from a volatile cache regardless. It also says nothing
// about whether the bytes were the RIGHT bytes; a complete write of the wrong content is still complete.

import { closeSync, fstatSync, fsyncSync, openSync, renameSync, statSync, unlinkSync, writeSync } from 'fs';
import { randomBytes } from 'crypto';
import { dirname } from 'path';

export type DurableWriteReason = 'write-no-progress' | 'staged-size-mismatch';

export class DurableWriteError extends Error {
  readonly reasonClass: DurableWriteReason;
  constructor(reasonClass: DurableWriteReason) {
    // Content-free by construction, like every refusal in this lane: the constructor takes one slug and
    // has no slot for a path or a fragment of whatever was being written.
    super(`memory durable write: ${reasonClass}`);
    this.name = 'DurableWriteError';
    this.reasonClass = reasonClass;
  }
}

type WriteFn = (fd: number, buffer: Uint8Array, offset: number, length: number, position: number) => number;

/**
 * Write EVERY byte, or refuse. `write` is injectable so a test can simulate a short-writing kernel
 * without monkey-patching `node:fs` itself; it defaults to the real `writeSync`.
 *
 * The progress check is `!Number.isInteger(n) || n <= 0`, not `n < 0` — `NaN < 0` is `false`, so a NaN
 * return would pass a naive guard and then `written += NaN` makes the loop's own condition false
 * forever after, exiting the loop BELIEVING IT FINISHED. That is the one shape that must never read as
 * success.
 */
export function writeAllSync(
  fd: number,
  bytes: Uint8Array,
  position: number,
  write: WriteFn = writeSync,
): number {
  let written = 0;
  while (written < bytes.length) {
    const n = write(fd, bytes, written, bytes.length - written, position + written);
    if (!Number.isInteger(n) || n <= 0) throw new DurableWriteError('write-no-progress');
    written += n;
  }
  return written;
}

/** Overwrite a file in place with every byte, and flush it. Used to scribble over key material. */
export function overwriteAllSync(fd: number, bytes: Uint8Array, write?: WriteFn): void {
  writeAllSync(fd, bytes, 0, write);
  if (fstatSync(fd).size < bytes.length) throw new DurableWriteError('staged-size-mismatch');
  fsyncSync(fd);
}

/** `fsync` a DIRECTORY, so a rename inside it is on the medium. Failures are swallowed and reported —
 *  by the time this runs the rename already succeeded, so a thrown error here would fail a completed
 *  operation; a swallowed one that returns `false` keeps the failure observable instead. */
export function fsyncDirectory(dir: string): boolean {
  let dfd: number | undefined;
  try {
    dfd = openSync(dir, 'r');
    fsyncSync(dfd);
    return true;
  } catch {
    return false;
  } finally {
    if (dfd !== undefined) { try { closeSync(dfd); } catch { /* already closed */ } }
  }
}

/**
 * Overwrite a file with random bytes, then unlink it. Best effort, and says so: `unlink` is not
 * erasure, and the overwrite does not make it one — on a copy-on-write filesystem or a wear-levelled
 * SSD the old bytes may physically persist. This defeats casual recovery, not forensic recovery of the
 * medium. The scribble is best effort; the removal is not — a failing overwrite must not abandon the
 * unlink, or the one condition that prevents scribbling also guarantees the material stays readable.
 */
export function shredAndUnlink(path: string): boolean {
  try {
    const size = statSync(path).size;
    if (size > 0) {
      const fd = openSync(path, 'r+');
      try { overwriteAllSync(fd, randomBytes(size)); } catch { /* best effort — unlink below is what must happen */ }
      finally { closeSync(fd); }
    }
  } catch { /* nothing to stat or open; fall through to the unlink anyway */ }
  try { unlinkSync(path); return true; } catch { return false; }
}

/**
 * Stage, verify, flush, publish, flush the name — in that order, and the order is the property.
 *
 *   1. `open(staging, 'wx')` — O_EXCL, so we never adopt someone else's file.
 *   2. `writeAllSync`        — every byte, or refuse.
 *   3. `fstat` the fd        — the kernel's own account of the length, read back BEFORE anything is
 *      committed to, so a `writeSync` that lied about its return value is still caught.
 *   4. `fsync` the data fd   — the contents are on the medium.
 *   5. `rename`              — atomic swap. No reader ever sees half a file.
 *   6. `fsync` the directory — the swap itself is on the medium, or steps 1–5 leave a durable file
 *      nobody can find.
 *
 * On refusal NOTHING is published — the rename is the last thing that can happen, so any failure before
 * it leaves the target byte-identical to what it was, and the staging file is shredded rather than left
 * holding partial content. `stagingPath` MUST be in the same directory as `finalPath` (`rename` is only
 * atomic within one filesystem). Returns whether the directory flush succeeded.
 */
export function publishFileDurably(
  stagingPath: string,
  finalPath: string,
  bytes: Uint8Array,
  mode = 0o600,
): boolean {
  let renamed = false;
  try {
    const fd = openSync(stagingPath, 'wx', mode);
    try {
      writeAllSync(fd, bytes, 0);
      if (fstatSync(fd).size !== bytes.length) throw new DurableWriteError('staged-size-mismatch');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(stagingPath, finalPath);
    renamed = true;
  } finally {
    if (!renamed) shredAndUnlink(stagingPath);
  }
  return fsyncDirectory(dirname(finalPath));
}

/** Advisory only. Writing bytes completely is not authority over anything. */
export function durableWriteGrantsAuthority(): false {
  return false;
}
