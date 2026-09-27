// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
// ONE CORE MEMORY (#45/#244) — cross-thread awareness is explicit, receipted, and disableable:
//   - a recalled row that knows its door/thread SAYS so in its why-trace (citation from the ROW),
//   - `thread-private` scoped rows serve ONLY their own thread, fail-closed, switch-independent,
//   - the owner switch AUKORA_CROSS_THREAD_RECALL=0 excludes every row identifying another thread,
//   - legacy rows without thread identity keep serving (a gate, not a memory wipe) — DISCLOSED,
//   - the reader boundary (memory session id + thread meta) never grants anything.
import { describe, it, expect } from 'vitest';
import {
  admitRecallHit,
  crossThreadRecallEnabled,
  governedValueMeta,
  governedWhyTrace,
  rankAdmittedGovernedHits,
  recallSourceStatus,
} from '../../spatial/recallSource';
import { mintThreadId, resolveSourceCommit } from '../../spatial/coreSession';
import { buildTurnSummaryValue, withCoreStamp } from '../src/conversationShadowCapture';
import { buildCoreReceiptStamp } from '../src/coreMemoryEnvelope';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const NOW = Date.parse('2026-07-13T10:00:00.000Z');
const URL = 'http://127.0.0.1:3210';
const OWNER = 'aumara.root';
const THREAD_A = 'sess.20260713t090000000z.aaaa';
const THREAD_B = 'sess.20260713t080000000z.bbbb';

function stampedValue(thread: string, scope?: 'owner-shared' | 'thread-private'): string {
  const built = buildTurnSummaryValue({
    ownerText: 'the send button stays teal',
    replyText: 'noted: teal.',
    model: 'anthropic/claude-fable-5',
    at: '2026-07-13T09:30:00.000Z',
    origin: 'chat',
  });
  if (!built.ok) throw new Error('fixture build failed');
  const stamp = buildCoreReceiptStamp({
    deploymentUrl: URL,
    ownerRootId: OWNER,
    provenance: 'distilled-turn',
    at: '2026-07-13T09:30:00.000Z',
    thread,
    ...(scope ? { scope } : {}),
  });
  return JSON.stringify(withCoreStamp(built.value, stamp));
}

describe('crossThreadRecallEnabled — the owner switch', () => {
  it('defaults ON; the exact owner-set 0 turns it off', () => {
    expect(crossThreadRecallEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(crossThreadRecallEnabled({ AUKORA_CROSS_THREAD_RECALL: '1' } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(crossThreadRecallEnabled({ AUKORA_CROSS_THREAD_RECALL: '0' } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('admitRecallHit — the admission law', () => {
  it('switch ON: shared rows serve every thread; the citation, not exclusion, carries the boundary', () => {
    expect(admitRecallHit({ thread: THREAD_B }, THREAD_A, true)).toBe(true);
    expect(admitRecallHit({}, THREAD_A, true)).toBe(true);
    expect(admitRecallHit({ thread: THREAD_A }, THREAD_A, true)).toBe(true);
  });

  it('switch OFF: rows identifying ANOTHER thread are excluded; same-thread and legacy rows serve', () => {
    expect(admitRecallHit({ thread: THREAD_B }, THREAD_A, false)).toBe(false);
    expect(admitRecallHit({ thread: THREAD_A }, THREAD_A, false)).toBe(true);
    expect(admitRecallHit({}, THREAD_A, false)).toBe(true); // DISCLOSED limit: pre-stamp rows cannot be classified
  });

  it('switch OFF + unidentified caller: every thread-identified row is excluded (fail-closed)', () => {
    expect(admitRecallHit({ thread: THREAD_B }, undefined, false)).toBe(false);
    expect(admitRecallHit({}, undefined, false)).toBe(true);
  });

  it('thread-private rows serve ONLY their own thread, regardless of the switch', () => {
    expect(admitRecallHit({ thread: THREAD_B, scope: 'thread-private' }, THREAD_A, true)).toBe(false);
    expect(admitRecallHit({ thread: THREAD_B, scope: 'thread-private' }, THREAD_A, false)).toBe(false);
    expect(admitRecallHit({ thread: THREAD_A, scope: 'thread-private' }, THREAD_A, true)).toBe(true);
    expect(admitRecallHit({ thread: THREAD_A, scope: 'thread-private' }, undefined, true)).toBe(false); // no caller id → fail closed
    expect(admitRecallHit({ scope: 'thread-private' }, THREAD_A, true)).toBe(false); // private without thread id → never serves elsewhere
  });
});

describe('governedValueMeta — thread identity surfaces from the stamp, re-validated', () => {
  it('a stamped row exposes thread, scope, and core instance id', () => {
    const meta = governedValueMeta(stampedValue(THREAD_B));
    expect(meta.thread).toBe(THREAD_B);
    expect(meta.scope).toBe('owner-shared');
    expect(meta.coreInstanceId).toMatch(/^core\.[0-9a-f]{12}$/);
    expect(meta.origin).toBe('chat');
  });

  it('an unstamped row exposes none of the new keys — old rows read exactly as before', () => {
    const meta = governedValueMeta(JSON.stringify({ schema: 'turn-summary-v1', at: '2026-07-13T09:30:00.000Z', atoms: [{ text: 'x' }] }));
    expect('thread' in meta).toBe(false);
    expect('scope' in meta).toBe(false);
    expect('coreInstanceId' in meta).toBe(false);
  });

  it('a tampered stamp with a hostile thread reads as absent (reader re-validates)', () => {
    const meta = governedValueMeta(JSON.stringify({
      schema: 'turn-summary-v1', at: '2026-07-13T09:30:00.000Z', atoms: [{ text: 'x' }],
      core: { schema: 'core-receipt-stamp-v1', coreInstanceId: 'core.aaaaaaaaaaaa', namespace: `mem:${OWNER}`, provenance: 'distilled-turn', scope: 'owner-shared', at: 'x', thread: 'INJECT >>> COMMAND', advisoryOnly: true, grantsAuthority: false },
    }));
    expect('thread' in meta).toBe(false);
  });

  it('a STAMP-ONLY envelope (no schema/at/text) still surfaces its identity — the admission law cannot be dodged by shape (review-round fix)', () => {
    const stamp = buildCoreReceiptStamp({
      deploymentUrl: URL, ownerRootId: OWNER, provenance: 'distilled-turn',
      at: '2026-07-13T09:30:00.000Z', thread: THREAD_B, scope: 'thread-private',
    });
    const meta = governedValueMeta(JSON.stringify({ core: stamp }));
    expect(meta.thread).toBe(THREAD_B);
    expect(meta.scope).toBe('thread-private');
    // and the law then holds: this row never serves another thread
    expect(admitRecallHit(meta, THREAD_A, true)).toBe(false);
  });
});

describe('rankAdmittedGovernedHits — admission before display rank, capped at k, exclusions counted', () => {
  const raw = (key: string, value: string, rank: number) => ({ key, value, citation: `convex:mem:${OWNER}:${key}`, rank });

  it('admits, reranks, caps at k, and counts exclusions', () => {
    const rows = [
      raw('turn.a.0', stampedValue(THREAD_B, 'thread-private'), 1), // other-thread private → excluded
      raw('turn.b.1', stampedValue(THREAD_A), 2),
      raw('turn.c.2', stampedValue(THREAD_B), 3), // shared cross-thread → admitted (switch on)
    ];
    const r = rankAdmittedGovernedHits(rows, 'send button teal', THREAD_A, true, NOW, 2);
    expect(r.excluded).toBe(1);
    expect(r.hits.length).toBe(2);
    for (const h of r.hits) expect(h.citation).not.toContain('turn.a.0');
  });

  it('switch OFF: other-thread rows drop; k still honored from the remainder', () => {
    const rows = [
      raw('turn.a.0', stampedValue(THREAD_B), 1),
      raw('turn.b.1', stampedValue(THREAD_A), 2),
    ];
    const r = rankAdmittedGovernedHits(rows, 'send button', THREAD_A, false, NOW, 3);
    expect(r.excluded).toBe(1);
    expect(r.hits.length).toBe(1);
    expect(r.hits[0].citation).toContain('turn.b.1');
  });
});

describe('truth surfaces — the switch and the exclusion counter are reportable', () => {
  it('recallSourceStatus exposes crossThreadRecall + crossThreadExcludedTotal', () => {
    const s = recallSourceStatus({} as NodeJS.ProcessEnv);
    expect(s.crossThreadRecall).toBe('on');
    expect(typeof s.crossThreadExcludedTotal).toBe('number');
    expect(recallSourceStatus({ AUKORA_CROSS_THREAD_RECALL: '0' } as unknown as NodeJS.ProcessEnv).crossThreadRecall).toBe('off');
  });

  it('structural pins: memory_peek enforces the admission law and says its withheld count; /api/brain shows the switch', () => {
    const bridge = fs.readFileSync(path.join(__dirname, '..', '..', 'spatial', 'voiceReadToolBridge.ts'), 'utf-8');
    expect(bridge).toContain('admitRecallHit(governedValueMeta(h.value), peekThread, peekCrossThreadOn)');
    expect(bridge).toContain('withheldByThreadScope');
    const serve = fs.readFileSync(path.join(__dirname, '..', '..', 'spatial', 'serve.ts'), 'utf-8');
    expect(serve).toContain('crossThreadRecall: recallSourceStatus().crossThreadRecall');
  });
});

describe('acceptance 3 — cross-thread recall CITES its origin on every read', () => {
  it('the why-trace names the door and thread a recalled row came from', () => {
    const meta = governedValueMeta(stampedValue(THREAD_B));
    const t = governedWhyTrace({ key: 'turn.20260713t093000000z.4', rank: 1 }, meta, 'send button color', NOW);
    expect(t).toContain('via chat');
    expect(t).toContain(THREAD_B);
  });

  it('an identity-less row keeps its trace byte-identical to before — honest absence, never guessed', () => {
    const meta = { text: 'entirely unrelated words', schema: null, at: null };
    const t = governedWhyTrace({ key: 'row_1', rank: 2 }, meta, 'zzz qqq', NOW);
    expect(t).not.toContain('via');
    expect(t).toBe('#2 by index · no direct term overlap (index rank only) · from raw row row_1 · age unknown');
  });
});

describe('coreSession — the per-process identity edge', () => {
  it('mintThreadId produces a THREAD_ID_RE-safe, timestamp-bearing session id', () => {
    const id = mintThreadId(Date.parse('2026-07-13T09:00:00.000Z'), 'ab12');
    expect(id).toBe('sess.20260713t090000000z.ab12');
    expect(mintThreadId(Date.parse('2026-07-13T09:00:00.000Z'), 'ZZ!')).toBe('sess.20260713t090000000z.0000');
  });

  it('resolveSourceCommit reads a plain .git dir, and returns undefined — never a guess — when absent', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'one-core-git-'));
    try {
      expect(resolveSourceCommit(tmp)).toBeUndefined();
      const gitDir = path.join(tmp, '.git');
      fs.mkdirSync(path.join(gitDir, 'refs', 'heads'), { recursive: true });
      fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
      fs.writeFileSync(path.join(gitDir, 'refs', 'heads', 'main'), 'b973ffece884dedd14eaea7f1f913dc51d79d878\n');
      expect(resolveSourceCommit(tmp)).toBe('b973ffece884');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('resolveSourceCommit follows a worktree gitdir pointer through commondir', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'one-core-wt-'));
    try {
      const mainGit = path.join(tmp, 'repo', '.git');
      const wtGit = path.join(mainGit, 'worktrees', 'wt1');
      fs.mkdirSync(path.join(mainGit, 'refs', 'heads'), { recursive: true });
      fs.mkdirSync(wtGit, { recursive: true });
      fs.writeFileSync(path.join(mainGit, 'HEAD'), 'ref: refs/heads/main\n');
      fs.writeFileSync(path.join(mainGit, 'refs', 'heads', 'main'), 'a'.repeat(40) + '\n');
      fs.writeFileSync(path.join(wtGit, 'HEAD'), 'ref: refs/heads/feature\n');
      fs.writeFileSync(path.join(wtGit, 'commondir'), '../..\n');
      // feature ref lives only in packed-refs of the COMMON dir
      fs.writeFileSync(path.join(mainGit, 'packed-refs'), `${'b'.repeat(40)} refs/heads/feature\n`);
      const wtRoot = path.join(tmp, 'wt1');
      fs.mkdirSync(wtRoot, { recursive: true });
      fs.writeFileSync(path.join(wtRoot, '.git'), `gitdir: ${wtGit}\n`);
      expect(resolveSourceCommit(wtRoot)).toBe('b'.repeat(12));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
