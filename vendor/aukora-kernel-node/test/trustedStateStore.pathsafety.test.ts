// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * R54 v4 — the store-opening TOCTOU closure, proven from the store boundary itself.
 *
 * The trusted-state fence used to live only in the CALLER (canonicalize then hand a string to the store); an
 * attacker could swap a symlink component between that check and the store's own open. These tests prove the
 * invariant now lives where the journal is actually opened: `TrustedStateStore.open()` verifies the dir NO-FOLLOW
 * with a held fd + an owner-only contract, and every journal file is opened O_NOFOLLOW — so a symlink swapped in
 * AFTER any external check is refused at use, before any durable write. Includes the required
 * check→swap→open RACE test.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, symlinkSync, writeFileSync, chmodSync, readFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TrustedStateStore, TrustedStoreUnsafePathError, type CrashHook,
} from '../src/index.js';
import type { TrustedStateV1, KernelRequestV1, KernelResultV1 } from '@aukora/kernel';

const genesis = (): TrustedStateV1 => ({ schema: 'aukora-trusted-state-v1', salama: { active: false, reason: null }, trustedRoots: [], consumedIds: [], receiptHead: { count: 0, headHash: null } });
const stub = ((request: KernelRequestV1, state: TrustedStateV1): KernelResultV1 => {
  const cid = request.consumptionId;
  if (cid !== null && state.consumedIds.includes(cid)) return { schema: 'aukora-kernel-result-v1', decision: { status: 'refused', code: 'replay', ring: 'self-modify', authorizedRootId: null }, nextState: state, receiptDraft: {} as never } as never;
  const consumedIds = cid !== null ? [...state.consumedIds, cid].sort() : state.consumedIds;
  return { schema: 'aukora-kernel-result-v1', decision: { status: 'allowed', code: 'allowed', ring: 'self-modify', authorizedRootId: 'root-1' }, nextState: { ...state, consumedIds, receiptHead: { count: state.receiptHead.count + 1, headHash: 'd'.repeat(64) } }, receiptDraft: {} as never } as never;
}) as never;
const effect = { effectId: 'e1', descriptorKind: 'git-candidate', targetPath: 'candidate/x', contentHash: 'c'.repeat(64) };
const authorize = (s: TrustedStateStore, cid: string) => s.authorizeAndPrepare({ genesis: genesis(), request: { consumptionId: cid } as never, policyBytes: new Uint8Array(), effect, nowMs: 2_000 });

let base: string; let outside: string; let sneakTarget: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'aukora-pathsafety-'));
  outside = join(base, 'trusted');     // the legitimate owner-only state dir
  sneakTarget = join(base, 'sneak');   // where a hostile symlink would redirect the journal
  mkdirSync(sneakTarget, { recursive: true });
});
afterEach(() => { rmSync(base, { recursive: true, force: true }); });

describe('a normal owner-only dir opens + commits (held-fd dir-fsync path)', () => {
  it('consumes durably and the receipt head advances (no regression from the no-follow rewrite)', () => {
    const s = new TrustedStateStore(outside, { decide: stub }); s.open();
    expect(authorize(s, 'auth-1').ok).toBe(true);
    s.close();
    const reopened = new TrustedStateStore(outside, { decide: stub }); reopened.open();
    expect(authorize(reopened, 'auth-1').ok).toBe(false);   // durable replay across reopen — dir-fsync via held fd
    expect(reopened.load(genesis()).state.receiptHead.count).toBe(1);
    reopened.close();
  });
});

describe('open() refuses a symlinked / non-owner-only state dir (no-follow + owner-only at the store boundary)', () => {
  it('the state dir SWAPPED to a symlink is refused before any write', () => {
    symlinkSync(sneakTarget, outside);                 // outside → sneakTarget (a real dir)
    const s = new TrustedStateStore(outside, { decide: stub });
    expect(() => s.open()).toThrow(TrustedStoreUnsafePathError);
    expect(existsSync(join(sneakTarget, 'writer.lock'))).toBe(false); // nothing written through the link
    expect(existsSync(join(sneakTarget, 'trusted-state.json'))).toBe(false);
  });

  it('a symlink pointing at a NOT-YET-EXISTING target is still refused (broken-link case)', () => {
    symlinkSync(join(base, 'does-not-exist-yet'), outside);
    const s = new TrustedStateStore(outside, { decide: stub });
    expect(() => s.open()).toThrow(TrustedStoreUnsafePathError);
    expect(existsSync(join(base, 'does-not-exist-yet'))).toBe(false); // the store never created through the link
  });

  it('[POSIX] a group/world-accessible dir is refused (owner-only contract)', () => {
    if (process.platform === 'win32') return; // POSIX mode bits only
    mkdirSync(outside, { recursive: true });
    chmodSync(outside, 0o755); // group+other readable/executable
    const s = new TrustedStateStore(outside, { decide: stub });
    expect(() => s.open()).toThrow(TrustedStoreUnsafePathError);
  });

  it('a writer.lock pre-planted as a symlink is refused (O_NOFOLLOW on the lock)', () => {
    mkdirSync(outside, { recursive: true }); chmodSync(outside, 0o700);
    symlinkSync(join(sneakTarget, 'evil-lock'), join(outside, 'writer.lock'));
    const s = new TrustedStateStore(outside, { decide: stub });
    expect(() => s.open()).toThrow(TrustedStoreUnsafePathError);
    expect(existsSync(join(sneakTarget, 'evil-lock'))).toBe(false); // never written through the link
  });
});

describe('RACE — swap the state dir between an external check and the store open → fail closed', () => {
  it('a caller that canonicalizes a real dir, then has it swapped to a symlink, is refused at open()', () => {
    // 1. CHECK: an external fence canonicalizes a real owner-only dir and approves it (outside any repo).
    mkdirSync(outside, { recursive: true }); chmodSync(outside, 0o700);
    const checkedReal = readFileSync; // (the check is just: it existed as a real dir — approved)
    void checkedReal;
    // 2. SWAP: the attacker replaces it with a symlink into a location the journal must never reach.
    rmSync(outside, { recursive: true, force: true });
    symlinkSync(sneakTarget, outside);
    // 3. OPEN (use): the store re-resolves at open — and refuses, because its OWN no-follow check runs at use.
    const s = new TrustedStateStore(outside, { decide: stub });
    expect(() => s.open()).toThrow(TrustedStoreUnsafePathError);
    expect(existsSync(join(sneakTarget, 'writer.lock'))).toBe(false);
    expect(existsSync(join(sneakTarget, 'trusted-state.json'))).toBe(false);
  });

  it('valid EXTERNAL owner-only state (unswapped) still opens and survives a reopen', () => {
    mkdirSync(outside, { recursive: true }); chmodSync(outside, 0o700);
    const a = new TrustedStateStore(outside, { decide: stub }); a.open(); expect(authorize(a, 'k').ok).toBe(true); a.close();
    const b = new TrustedStateStore(outside, { decide: stub }); b.open();
    expect(b.load(genesis()).state.consumedIds).toEqual(['k']); // durable across restart
    b.close();
  });
});

describe('POST-OPEN directory replacement (the exact Codex v5 acceptance) → fail closed, zero writes at target', () => {
  it('open real 0700 dir → rename it aside → replace the pathname with a symlink → authorizeAndPrepare refuses, nothing at target', () => {
    mkdirSync(outside, { recursive: true }); chmodSync(outside, 0o700);
    const s = new TrustedStateStore(outside, { decide: stub });
    s.open(); // held dirFd + pinned inode on the REAL dir
    // attacker (after open): move the real dir aside and drop a symlink at the ORIGINAL pathname → sneak target
    renameSync(outside, join(base, 'aside'));
    symlinkSync(sneakTarget, outside);
    // every path-based lifetime op now re-verifies the pinned inode: load()'s assertDir opens `outside` no-follow,
    // sees a symlink (ELOOP) → refuse. Nothing is ever written through the replacement.
    expect(() => authorize(s, 'auth-x')).toThrow(TrustedStoreUnsafePathError);
    for (const name of ['trusted-state.json', 'trusted-state.tmp', 'receipt-highwater.json', 'writer.lock']) {
      expect(existsSync(join(sneakTarget, name)), `wrote ${name} into the swapped target`).toBe(false);
    }
    // and the state genuinely aside was never advanced either (the consume never happened)
    expect(existsSync(join(base, 'aside', 'trusted-state.json'))).toBe(false);
  });

  it('post-open replacement with a DIFFERENT real directory (not a symlink) is caught by the inode pin', () => {
    mkdirSync(outside, { recursive: true }); chmodSync(outside, 0o700);
    const s = new TrustedStateStore(outside, { decide: stub });
    s.open();
    renameSync(outside, join(base, 'aside2'));
    mkdirSync(outside, { mode: 0o700 }); // a brand-new real dir at the same pathname (different inode)
    expect(() => authorize(s, 'auth-y')).toThrow(TrustedStoreUnsafePathError);
    expect(existsSync(join(outside, 'trusted-state.json'))).toBe(false); // nothing written into the impostor dir
  });
});

describe('STANDALONE load()/consumed() acquire a protected read pin — an unsafe prefix THROWS, never followed (v6)', () => {
  it('a standalone load() over a state dir SWAPPED to a symlink refuses instead of reading through it', () => {
    // seed a real store with one durable consumption, then swap the dir for a symlink to a hostile copy.
    const s = new TrustedStateStore(outside, { decide: stub }); s.open(); authorize(s, 'real-1'); s.close();
    const realState = readFileSync(join(outside, 'trusted-state.json'), 'utf8');
    writeFileSync(join(sneakTarget, 'trusted-state.json'), realState); // attacker's lookalike behind the link
    rmSync(outside, { recursive: true, force: true });
    symlinkSync(sneakTarget, outside);
    // a FRESH, never-opened store (exactly the consumed() path) must NOT follow the symlink — it throws.
    const probe = new TrustedStateStore(outside, { decide: stub });
    expect(() => probe.load(genesis())).toThrow(TrustedStoreUnsafePathError);
  });

  it('a standalone load() on a real owner-only dir still reads (pin acquired then released; reopen works)', () => {
    const s = new TrustedStateStore(outside, { decide: stub }); s.open(); authorize(s, 'real-2'); s.close();
    // repeated standalone reads succeed and leak no fd (each acquires + releases its own transient pin)
    for (let i = 0; i < 5; i++) {
      const probe = new TrustedStateStore(outside, { decide: stub });
      expect(probe.load(genesis()).state.consumedIds).toEqual(['real-2']);
    }
    // and the dir is still fully usable for a real reopen+consume afterward
    const re = new TrustedStateStore(outside, { decide: stub }); re.open();
    expect(authorize(re, 'real-2').ok).toBe(false); // durable replay
    re.close();
  });

  it('a standalone load() on a MISSING dir returns genesis (ENOENT is empty, not unsafe — no existsSync precheck)', () => {
    const probe = new TrustedStateStore(join(base, 'never-created'), { decide: stub });
    expect(probe.load(genesis()).state.consumedIds).toEqual([]);
  });
});
