// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Overnight brick 2 — the ACCEPTANCE BAR, proven with REAL process death (not in-process crash injection).
 *
 * A separate OS process (scripts/child-consume.ts) consumes an authorization against the real TrustedStateStore
 * and fsync-commits it; the parent then `kill -9`s it. A FRESH process reopens the store and reusing the same
 * authorization → REPLAY REFUSAL. And a child that crashes BEFORE the atomic rename commits NOTHING, so the
 * authorization is still usable exactly once. LIVE.
 *
 * RUNTIME (two Node-20 fixes, both verified on a real Node 20.20.2): (1) the child is esbuild-bundled to plain
 * ESM once in beforeAll, then spawned with a bare `node` (no experimental TS flags) — earlier it used
 * `node --experimental-transform-types`, Node ≥22.6 only, so the child never started on Node 20 ("child exited
 * with no output"). (2) The parent resolves each child on the **`close`** event, not `exit`: `exit` can fire
 * before the child's final stdout `data` is delivered, and under vitest's console interception on Node 20 that
 * raced the concurrent test to an empty buffer (0 prepares observed). `close` fires only after all stdio has
 * flushed. Children also emit via synchronous `writeSync(1,…)` (see child-consume.ts) so a line is never lost to
 * a `process.exit()` flush race. With both, all 3 LIVE tests pass on Node 20 and Node 22.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TrustedStateStore, type CrashHook } from '../src/trustedStateStore.js';
import type { TrustedStateV1, KernelRequestV1, KernelResultV1 } from '@aukora/kernel';

// The child is bundled once to a self-contained plain-ESM file (inlines @aukora/kernel + the store), so it runs on
// any modern Node with a bare `node child.mjs` — no --experimental-transform-types, no tsx, no version coupling.
let CHILD = '';
let bundleDir = '';
beforeAll(() => {
  bundleDir = mkdtempSync(join(tmpdir(), 'aukora-childbundle-'));
  CHILD = join(bundleDir, 'child-consume.mjs');
  buildSync({
    entryPoints: [fileURLToPath(new URL('../scripts/child-consume.ts', import.meta.url))],
    outfile: CHILD, bundle: true, platform: 'node', format: 'esm', target: 'node18',
  });
});
afterAll(() => { if (bundleDir) rmSync(bundleDir, { recursive: true, force: true }); });
const genesis = (): TrustedStateV1 => ({ schema: 'aukora-trusted-state-v1', salama: { active: false, reason: null }, trustedRoots: [], consumedIds: [], receiptHead: { count: 0, headHash: null } });
const stub = ((request: KernelRequestV1, state: TrustedStateV1): KernelResultV1 => {
  const cid = request.consumptionId;
  if (cid !== null && state.consumedIds.includes(cid)) return { schema: 'aukora-kernel-result-v1', decision: { status: 'refused', code: 'replay', ring: 'self-modify', authorizedRootId: null }, nextState: state, receiptDraft: {} as never } as never;
  const consumedIds = cid !== null ? [...state.consumedIds, cid].sort() : state.consumedIds;
  return { schema: 'aukora-kernel-result-v1', decision: { status: 'allowed', code: 'allowed', ring: 'self-modify', authorizedRootId: 'root-1' }, nextState: { ...state, consumedIds, receiptHead: { count: state.receiptHead.count + 1, headHash: 'd'.repeat(64) } }, receiptDraft: {} as never } as never;
}) as never;

/** Spawn the child; resolve with { proc, firstLine } once the child prints its first stdout line. */
function spawnChild(dir: string, cid: string, mode: string): Promise<{ proc: ReturnType<typeof spawn>; line: string }> {
  const proc = spawn(process.execPath, [CHILD, dir, cid, mode], { stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let buf = '';
    proc.stdout!.on('data', (d) => { buf += d.toString(); const nl = buf.indexOf('\n'); if (nl >= 0) resolve({ proc, line: buf.slice(0, nl).trim() }); });
    // 'close' (not 'exit'): 'exit' can fire before the child's final stdout 'data' reaches the parent — under
    // vitest's console interception on Node 20 that left buf empty. 'close' fires after all stdio has flushed.
    proc.on('close', () => { if (buf.trim()) resolve({ proc, line: buf.trim() }); else reject(new Error('child exited with no output')); });
    proc.on('error', reject);
  });
}
const waitExit = (proc: ReturnType<typeof spawn>) => new Promise<number | null>((r) => proc.on('exit', (code) => r(code)));

describe('[LIVE] consumed authority survives a REAL kill -9', () => {
  it('a child commits, is SIGKILLed, and a fresh process refuses to reuse the authorization (replay)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aukora-sigkill-'));
    try {
      const { proc, line } = await spawnChild(dir, 'auth-live', 'commit-hang');
      expect(line).toBe('COMMITTED:1');           // the child fsync-committed the consumption, then hangs
      proc.kill('SIGKILL');                        // REAL process death — no graceful shutdown
      expect(await waitExit(proc)).toBe(null);     // killed by signal (exit code null)
      // a FRESH process attaches to the durable state (reclaims the dead child's lock) and reuses the id →
      const fresh = new TrustedStateStore(dir, { decide: stub });
      fresh.open();
      const replay = fresh.authorizeAndPrepare({ genesis: genesis(), request: { consumptionId: 'auth-live' } as never, policyBytes: new Uint8Array(), effect: { effectId: 'e2', descriptorKind: 'git-candidate', targetPath: 'a/b.ts', contentHash: 'c'.repeat(64) }, nowMs: 2_000 });
      expect(replay.ok).toBe(false);
      if (!replay.ok) expect(replay.decision.code).toBe('replay'); // consumed authority REMAINS consumed across real death
      expect(fresh.load(genesis()).state.receiptHead.count).toBe(1); // exactly one, not doubled
      fresh.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 20_000);

  it('[LIVE] two CONCURRENT OS processes on the same authorization → exactly one PREPARED, the other replays', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aukora-concurrent-'));
    try {
      // both race for the single-writer lock (child has a bounded lock-retry); the winner consumes, the loser
      // then attaches to the durable state and sees the id already consumed → replay. Never two prepares.
      const runToEnd = (m: string) => new Promise<string>((resolve) => {
        const p = spawn(process.execPath, [CHILD, dir, 'auth-race', m], { stdio: ['ignore', 'pipe', 'ignore'] });
        let buf = ''; p.stdout!.on('data', (d) => { buf += d.toString(); });
        // resolve on 'close', NOT 'exit' — 'exit' can fire before the final stdout 'data' is delivered to the
        // parent; under vitest's console interception on Node 20 that raced empty (0 prepares observed). 'close'
        // fires only after every stdio stream has flushed and closed, so buf is complete on all Node versions.
        p.on('close', () => resolve(buf.trim()));
      });
      const [a, b] = await Promise.all([runToEnd('commit-exit'), runToEnd('commit-exit')]);
      const outcomes = [a, b].sort();
      expect(outcomes.filter((o) => o.startsWith('COMMITTED:1'))).toHaveLength(1);   // EXACTLY one prepared
      expect(outcomes.some((o) => o.includes('REFUSED:replay') || o.includes('LOCK_REFUSED'))).toBe(true); // the loser is contained
      const fresh = new TrustedStateStore(dir, { decide: stub }); fresh.open();
      expect(fresh.load(genesis()).state.receiptHead.count).toBe(1);                 // one effect, never doubled
      fresh.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 25_000);

  it('a child that crashes BEFORE the atomic rename commits nothing — the authorization is still usable once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aukora-sigkill-'));
    try {
      const { proc, line } = await spawnChild(dir, 'auth-crash', 'crash-before-rename');
      expect(line).toBe('CRASH_AT_RENAME');
      expect(await waitExit(proc)).toBe(37);       // the child exited via the injected pre-rename crash
      const fresh = new TrustedStateStore(dir, { decide: stub });
      fresh.open();
      // nothing was consumed — the authorization is still available and consumes EXACTLY once
      const first = fresh.authorizeAndPrepare({ genesis: genesis(), request: { consumptionId: 'auth-crash' } as never, policyBytes: new Uint8Array(), effect: { effectId: 'e1', descriptorKind: 'git-candidate', targetPath: 'a/b.ts', contentHash: 'c'.repeat(64) }, nowMs: 2_000 });
      expect(first.ok).toBe(true);
      expect(fresh.load(genesis()).state.receiptHead.count).toBe(1);
      fresh.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 20_000);
});
