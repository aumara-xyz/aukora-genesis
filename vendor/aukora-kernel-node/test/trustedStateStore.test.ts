// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Overnight brick — the crash-safe TrustedStateStore PERSISTENCE laws (deterministic, in-process).
 *
 * These prove: consume durability across restart → replay refusal; crash injection at EVERY journal step →
 * zero-or-exactly-one recoverable prepare (never torn); rollback refusal; single-writer lock; 0600 perms. The
 * REAL child-process SIGKILL proof is the sibling `trustedStateStore.sigkill.test.ts` (next brick). The `decide`
 * here is an injected stub that FAITHFULLY mirrors the real kernel reducer's persistence-relevant behavior
 * (replay refusal on a consumed id; consume + receipt-head advance on allowed) — the store's own durability,
 * atomicity, rollback, and locking are what is under test; production uses the real `@aukora/kernel` `decide`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TrustedStateStore, RollbackRefusedError, WriterLockedError, STORE_SCHEMA_VERSION,
  trustedStateStoreGrantsAuthority, type CrashHook,
} from '../src/trustedStateStore.js';
import type { TrustedStateV1, KernelRequestV1, KernelResultV1 } from '@aukora/kernel';

const genesis = (): TrustedStateV1 => ({
  schema: 'aukora-trusted-state-v1', salama: { active: false, reason: null },
  trustedRoots: [], consumedIds: [], receiptHead: { count: 0, headHash: null },
});

// A faithful stand-in for the real reducer's persistence-relevant law (replay + consume + head advance).
const stubDecide = ((request: KernelRequestV1, state: TrustedStateV1): KernelResultV1 => {
  const cid = request.consumptionId;
  if (cid !== null && state.consumedIds.includes(cid)) {
    return { schema: 'aukora-kernel-result-v1', decision: { status: 'refused', code: 'replay', ring: 'self-modify', authorizedRootId: null }, nextState: state, receiptDraft: {} as never } as never;
  }
  const consumedIds = cid !== null ? [...state.consumedIds, cid].sort() : state.consumedIds;
  const count = state.receiptHead.count + 1;
  const nextState: TrustedStateV1 = { ...state, consumedIds, receiptHead: { count, headHash: 'd'.repeat(64) } };
  return { schema: 'aukora-kernel-result-v1', decision: { status: 'allowed', code: 'allowed', ring: 'self-modify', authorizedRootId: 'root-1' }, nextState, receiptDraft: {} as never } as never;
}) as never;

const req = (consumptionId: string | null): KernelRequestV1 => ({ consumptionId } as never);
const effect = (id: string) => ({ effectId: id, descriptorKind: 'git-candidate', targetPath: 'apps/x/y.ts', contentHash: 'c'.repeat(64) });
const authorize = (store: TrustedStateStore, cid: string) =>
  store.authorizeAndPrepare({ genesis: genesis(), request: req(cid), policyBytes: new Uint8Array(), effect: effect('e-' + cid), nowMs: 2_000 });

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'aukora-trusted-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const open = (crashHook?: CrashHook) => { const s = new TrustedStateStore(dir, { decide: stubDecide, crashHook }); s.open(); return s; };

describe('durable consume across restart → replay refusal (the load-bearing law)', () => {
  it('a consumed authorization stays consumed after the store is reopened (simulated process restart)', () => {
    const a = open();
    const first = authorize(a, 'auth-x');
    expect(first.ok).toBe(true);
    a.close();
    // fresh store instance over the SAME dir = a new process attaching to the durable state
    const b = open();
    const replay = authorize(b, 'auth-x');
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.decision.code).toBe('replay');
    b.close();
  });

  it('the receipt head advances durably and monotonically across reopen', () => {
    const a = open(); authorize(a, 'auth-1'); a.close();
    const b = open(); authorize(b, 'auth-2'); const rec = b.load(genesis());
    expect(rec.state.receiptHead.count).toBe(2);
    expect(rec.prepared).toHaveLength(2);
    b.close();
  });
});

describe('crash injection at EVERY journal step → zero-or-exactly-one recoverable prepare', () => {
  const steps: CrashHook extends (l: infer L) => void ? L[] : never = ['journal-write', 'journal-fsync', 'rename', 'dir-fsync', 'highwater'] as never;
  for (const step of steps as readonly string[]) {
    it(`crash at "${step}" leaves a recoverable state (never torn, never duplicated)`, () => {
      const crasher = open((label) => { if (label === step) throw new Error(`injected crash at ${label}`); });
      let threw = false;
      try { authorize(crasher, 'auth-crash'); } catch { threw = true; }
      // rename is the atomic durability point: a crash BEFORE it → nothing consumed; AT/after → consumed once.
      if (step === 'journal-write' || step === 'journal-fsync' || step === 'rename') expect(threw).toBe(true);
      // best-effort dir-fsync/highwater may or may not throw depending on platform; either way the state must be valid.
      crasher.close();
      // a fresh process recovers: load must succeed with a COHERENT state, and 'auth-crash' is consumed iff the
      // rename landed. Never a half-written/torn file, never consumed-twice.
      const recover = open();
      const rec = recover.load(genesis());
      const consumed = rec.state.consumedIds.includes('auth-crash');
      expect(rec.state.receiptHead.count).toBe(consumed ? 1 : 0);         // exactly one, or zero — never torn
      expect(rec.prepared.length).toBe(consumed ? 1 : 0);
      // and it is recoverable to a working store: a NEW authorization still succeeds exactly once
      const next = authorize(recover, 'auth-after-crash');
      expect(next.ok).toBe(true);
      recover.close();
    });
  }
});

describe('rollback refusal', () => {
  it('restoring an OLDER trusted-state file (below the high-water) is refused on load', () => {
    const a = open(); authorize(a, 'auth-1'); authorize(a, 'auth-2'); a.close(); // high-water = 2
    // an attacker restores an older snapshot (count 0) to un-consume auth-1/auth-2
    const older = { storeSchema: STORE_SCHEMA_VERSION, state: genesis(), prepared: [] };
    writeFileSync(join(dir, 'trusted-state.json'), JSON.stringify(older));
    const b = new TrustedStateStore(dir, { decide: stubDecide }); b.open();
    expect(() => b.load(genesis())).toThrow(RollbackRefusedError);
    b.close();
  });
});

describe('single-writer lock + protected perms', () => {
  it('a live second writer is refused; a stale (dead-pid) lock is reclaimed', () => {
    const a = open();
    const b = new TrustedStateStore(dir, { decide: stubDecide });
    expect(() => b.open()).toThrow(WriterLockedError);   // a is still holding the lock (this live process)
    a.close();
    // stale lock from a dead pid → reclaimed
    writeFileSync(join(dir, 'writer.lock'), '999999');   // a pid that is not alive
    const c = new TrustedStateStore(dir, { decide: stubDecide });
    expect(() => c.open()).not.toThrow();
    c.close();
  });

  it('persisted state is owner-only (0600) and the store grants no authority', () => {
    const a = open(); authorize(a, 'auth-1');
    expect(a.statePerms()).toBe(0o600);
    a.close();
    expect(trustedStateStoreGrantsAuthority()).toBe(false);
  });
});
