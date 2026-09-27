// φ — durable writes: the exact bug this port must not reintroduce.
//
// The donor's own hostile review measured a `writeSync` that lands one byte per call publishing "a" for
// "abcdef", and a ledger erasure under the same mock publishing the WHOLE FILE as the single byte "{".
// `writeAllSync` is injectable specifically so this suite can reproduce that kernel behaviour without
// monkey-patching `node:fs` itself, and prove the loop — not merely the intention — survives it.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, realpathSync, openSync, closeSync, writeSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  writeAllSync, overwriteAllSync, publishFileDurably, shredAndUnlink, DurableWriteError,
} from '../core/memory/durableWrite';

let dir = '';
beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'aukora-durable-'))); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ } });

describe('writeAllSync — the loop is the fix', () => {
  it('a real writeSync completes a normal write in one pass', () => {
    const path = join(dir, 'f.bin');
    const fd = openSync(path, 'w');
    const bytes = Buffer.from('abcdef', 'utf8');
    try { writeAllSync(fd, bytes, 0); } finally { closeSync(fd); }
    expect(readFileSync(path)).toEqual(bytes);
  });

  it('a kernel that lands ONE BYTE PER CALL still yields the complete write — the exact donor scenario', () => {
    const path = join(dir, 'short.bin');
    const fd = openSync(path, 'w');
    const bytes = Buffer.from('abcdef', 'utf8');
    const oneByteAtATime = (f: number, buf: Uint8Array, off: number, _len: number, pos: number): number =>
      writeSync(f, buf, off, 1, pos);
    try { writeAllSync(fd, bytes, 0, oneByteAtATime); } finally { closeSync(fd); }
    expect(readFileSync(path)).toEqual(bytes); // NOT just "a"
  });

  it('zero forward progress refuses instead of hanging forever', () => {
    const path = join(dir, 'stuck.bin');
    const fd = openSync(path, 'w');
    const neverProgresses = () => 0;
    try {
      expect(() => writeAllSync(fd, Buffer.from('x'), 0, neverProgresses)).toThrow(DurableWriteError);
    } finally { closeSync(fd); }
  });

  it('NaN progress refuses rather than being read as "finished" by a naive `< 0` check', () => {
    const path = join(dir, 'nan.bin');
    const fd = openSync(path, 'w');
    const returnsNaN = () => Number.NaN;
    try {
      expect(() => writeAllSync(fd, Buffer.from('x'), 0, returnsNaN)).toThrow(DurableWriteError);
    } finally { closeSync(fd); }
  });

  it('negative progress refuses', () => {
    const path = join(dir, 'neg.bin');
    const fd = openSync(path, 'w');
    const returnsNegative = () => -1;
    try {
      expect(() => writeAllSync(fd, Buffer.from('x'), 0, returnsNegative)).toThrow(DurableWriteError);
    } finally { closeSync(fd); }
  });
});

describe('overwriteAllSync', () => {
  it('completes even when the injected writer only ever accepts a few bytes per call', () => {
    const path = join(dir, 'overwrite.bin');
    const fd = openSync(path, 'w+');
    writeSync(fd, Buffer.from('0123456789'));
    const trickle = (f: number, buf: Uint8Array, off: number, len: number, pos: number): number =>
      writeSync(f, buf, off, Math.min(len, 3), pos);
    const scribble = Buffer.alloc(10, 1);
    try { overwriteAllSync(fd, scribble, trickle); } finally { closeSync(fd); }
    expect(readFileSync(path)).toEqual(scribble);
  });
});

describe('publishFileDurably — atomic and complete, or nothing lands', () => {
  it('the final file has exactly the bytes handed to it, and the staging file is gone', () => {
    const staging = join(dir, '.stage.tmp');
    const final = join(dir, 'final.bin');
    const bytes = Buffer.from('the whole ledger, not "{"', 'utf8');
    const flushed = publishFileDurably(staging, final, bytes);
    expect(typeof flushed).toBe('boolean');
    expect(readFileSync(final)).toEqual(bytes);
    expect(existsSync(staging)).toBe(false);
  });

  it('a staging collision refuses, and NOTHING is published — the final path is untouched', () => {
    const staging = join(dir, '.stage2.tmp');
    const final = join(dir, 'final2.bin');
    writeFileSync(final, 'original', 'utf8');
    writeFileSync(staging, 'already here', 'utf8'); // O_EXCL refuses to adopt this
    expect(() => publishFileDurably(staging, final, Buffer.from('new'))).toThrow();
    expect(readFileSync(final, 'utf8')).toBe('original');
  });
});

describe('shredAndUnlink', () => {
  it('removes the file', () => {
    const path = join(dir, 'secret.key');
    writeFileSync(path, '0123456789abcdef0123456789abcdef', 'utf8');
    expect(shredAndUnlink(path)).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  it('a missing file is still reported honestly (nothing to unlink)', () => {
    expect(shredAndUnlink(join(dir, 'never-existed'))).toBe(false);
  });
});
