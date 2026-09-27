// φ — the memory ledger glue: remember, recall, forget-and-prove, verify — driven through
// `core/memory/ledger.ts`'s public surface, against a real scratch repository.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, realpathSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { verifyErasureCertificate } from '../core/memory/erasureCertificate';

let scratch = '';
let prevRepo: string | undefined;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'aukora-memory-ledger-')));
  prevRepo = process.env.AUKORA_FORGE_REPO;
  process.env.AUKORA_FORGE_REPO = scratch;
});
afterEach(() => {
  if (prevRepo === undefined) delete process.env.AUKORA_FORGE_REPO; else process.env.AUKORA_FORGE_REPO = prevRepo;
  try { rmSync(scratch, { recursive: true, force: true }); } catch { /* gone */ }
});

describe('rememberTurn', () => {
  it('writes a durable, sealed log under .aukora/memory/', async () => {
    const { rememberTurn, storePathForTest } = await import('../core/memory/ledger');
    const remembered = await rememberTurn({ role: 'user', content: 'are you there love?', engine: 'auma' });
    expect(remembered).not.toBeNull();
    expect(remembered!.occurrenceId).toMatch(/^[0-9a-f]{64}$/);

    const path = storePathForTest();
    expect(path).toBe(join(scratch, '.aukora', 'memory', 'log.jsonl'));
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines.length).toBe(2); // genesis + insert
  });

  it('the plaintext never appears anywhere in the log file', async () => {
    const { rememberTurn, storePathForTest } = await import('../core/memory/ledger');
    await rememberTurn({ role: 'user', content: 'a secret nobody should grep for', engine: 'auma' });
    const text = readFileSync(storePathForTest(), 'utf8');
    expect(text.includes('a secret nobody should grep for')).toBe(false);
  });

  it('a second turn appends rather than overwriting the first', async () => {
    const { rememberTurn, storePathForTest } = await import('../core/memory/ledger');
    await rememberTurn({ role: 'user', content: 'first' });
    await rememberTurn({ role: 'assistant', content: 'second' });
    const lines = readFileSync(storePathForTest(), 'utf8').trim().split('\n');
    expect(lines.length).toBe(3); // genesis + 2 inserts
  });
});

describe('recallTurn — the round trip through the real vault', () => {
  it('returns exactly what was remembered', async () => {
    const { rememberTurn, recallTurn } = await import('../core/memory/ledger');
    const r = await rememberTurn({ role: 'assistant', content: 'Yes!', engine: 'auma' });
    const back = await recallTurn(r!.occurrenceId);
    expect(back).toMatchObject({ role: 'assistant', content: 'Yes!', engine: 'auma' });
  });

  it('an unknown occurrenceId returns null rather than throwing', async () => {
    const { recallTurn } = await import('../core/memory/ledger');
    expect(await recallTurn('f'.repeat(64))).toBeNull();
  });
});

describe('forgetOccurrence — real erasure, with a certificate', () => {
  it('produces a complete, verifiable certificate, and the memory is really unrecallable after', async () => {
    const { rememberTurn, recallTurn, forgetOccurrence } = await import('../core/memory/ledger');
    const r = await rememberTurn({ role: 'user', content: 'forget this one', engine: 'auma' });
    expect(await recallTurn(r!.occurrenceId)).not.toBeNull();

    const cert = await forgetOccurrence(r!.occurrenceId);
    expect(cert).not.toBeNull();
    const verdict = verifyErasureCertificate(cert!);
    expect(verdict.valid).toBe(true);
    expect(verdict.complete).toBe(true);

    await expect(recallTurn(r!.occurrenceId)).rejects.toThrow();
  });

  it('forgetting an unknown or already-forgotten id is an honest null, not a throw', async () => {
    const { rememberTurn, forgetOccurrence } = await import('../core/memory/ledger');
    expect(await forgetOccurrence('e'.repeat(64))).toBeNull();

    const r = await rememberTurn({ role: 'user', content: 'x' });
    await forgetOccurrence(r!.occurrenceId);
    expect(await forgetOccurrence(r!.occurrenceId)).toBeNull();
  });

  it('forgetting one turn does not touch a different one', async () => {
    const { rememberTurn, recallTurn, forgetOccurrence } = await import('../core/memory/ledger');
    const a = await rememberTurn({ role: 'user', content: 'keep me' });
    const b = await rememberTurn({ role: 'user', content: 'forget me' });
    await forgetOccurrence(b!.occurrenceId);
    expect(await recallTurn(a!.occurrenceId)).toMatchObject({ content: 'keep me' });
  });
});

describe('verifyLedger', () => {
  it('a freshly built ledger, and one that has been through a forget, both verify clean', async () => {
    const { rememberTurn, forgetOccurrence, verifyLedger } = await import('../core/memory/ledger');
    expect(verifyLedger()).toEqual({ ok: true }); // no file at all yet
    const r = await rememberTurn({ role: 'user', content: 'x' });
    expect(verifyLedger()).toEqual({ ok: true });
    await forgetOccurrence(r!.occurrenceId);
    expect(verifyLedger()).toEqual({ ok: true });
  });
});

describe('serialised within one process', () => {
  it('firing several remembers without awaiting between them still produces a consistent, complete log', async () => {
    const { rememberTurn, storePathForTest, verifyLedger } = await import('../core/memory/ledger');
    const results = await Promise.all([
      rememberTurn({ role: 'user', content: 'one' }),
      rememberTurn({ role: 'assistant', content: 'two' }),
      rememberTurn({ role: 'user', content: 'three' }),
    ]);
    expect(results.every((r) => r !== null)).toBe(true);
    const ids = new Set(results.map((r) => r!.occurrenceId));
    expect(ids.size).toBe(3); // no id collided or was overwritten
    expect(verifyLedger()).toEqual({ ok: true });
    const lines = readFileSync(storePathForTest(), 'utf8').trim().split('\n');
    expect(lines.length).toBe(4); // genesis + 3 inserts, nothing lost to a lost write
  });
});
