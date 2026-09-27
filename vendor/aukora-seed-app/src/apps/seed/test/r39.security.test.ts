// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * R39 — canonical reference monitor, self-protecting fence (table-independent), public secret+PII scanner, and the
 * owner-armed content-free egress with durable spend accounting.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReactiveMemoryStore } from '@aukora/brain';
import type { CouncilSeat, Transport } from '@aukora/council';
import { CANONICAL_SEATS } from '@aukora/council';
import {
  CandidateReferenceMonitor, candidatePayloadHash, candidatePayloadForProposals, candidateMonitorGrantsAuthority,
  classifyPath, candidateAllowed, isSelfProtecting, readAllowed,
  armedEgressTransport, fixedArm, envProviderArm, DurableSpendAccount, providerEgressGrantsAuthority,
  type BranchCandidate, type PathVerdict,
} from '../src/index.js';
import { makeWorld, NOW_MS, NOW_ISO } from './support.js';

const candidate = (): BranchCandidate => ({
  schema: 'aukora-branch-candidate-v1', candidateId: 'ab'.repeat(32),
  workspace: new Map([['apps/seed/src/notes.ts', '// c']]),
  files: [{ path: 'apps/seed/src/notes.ts', intentId: 'cd'.repeat(32), draftHash: 'ef'.repeat(32), diff: '', receiptHash: 'ab'.repeat(32) }],
  explanation: 'x', lineage: [{ intentId: 'cd'.repeat(32), depth: 0 }],
  staged: true, pushed: false, signed: false, merged: false, deployed: false, grantsAuthority: false,
});

describe('canonical reference monitor — the ONE authorization semantics (kernel decide)', () => {
  it('owner-armed self-modify with a valid payload-bound signature is allowed; unarmed/replay/forged/no-auth refuse', () => {
    const w = makeWorld();
    const c = candidate();
    const ph = candidatePayloadHash(c);
    const auth = w.owner.authorize({ proposalHash: ph, draftHash: ph, nonce: 'n1', issuedAt: NOW_ISO, expiresAt: null });
    const mon = new CandidateReferenceMonitor(w.owner.root);

    const allowed = mon.decide(c, auth, NOW_MS, { ownerArmed: true });
    expect(allowed.allowed).toBe(true);
    expect(allowed.code).toBe('allowed');
    expect(allowed.ring).toBe('self-modify');
    expect(allowed.receiptDraftHash).toMatch(/^[0-9a-f]{64}$/);

    // consumed-authority: replaying the same nonce refuses
    expect(mon.decide(c, auth, NOW_MS, { ownerArmed: true }).code).toBe('replay');
    // unarmed (no humanClearance)
    expect(new CandidateReferenceMonitor(w.owner.root).decide(c, auth, NOW_MS, { ownerArmed: false }).code).toBe('self_modify_requires_clearance');
    // no authorization at all ⇒ no nonce ⇒ the self-modify request lacks a consumption id (refused first)
    expect(new CandidateReferenceMonitor(w.owner.root).decide(c, undefined, NOW_MS, { ownerArmed: true }).code).toBe('consumption_id_required');
    // forged signature
    const forged = { ...auth, signatures: { ...auth.signatures, ed25519: '00'.repeat(64) } };
    expect(new CandidateReferenceMonitor(w.owner.root).decide(c, forged, NOW_MS, { ownerArmed: true }).code).toBe('authority_invalid');
    // wrong signer (untrusted root) — a DIFFERENT owner seed ⇒ a different, untrusted root
    const other = makeWorld({ ownerLabel: 'attacker' }).owner;
    const otherAuth = other.authorize({ proposalHash: ph, draftHash: ph, nonce: 'n2', issuedAt: NOW_ISO, expiresAt: null });
    expect(new CandidateReferenceMonitor(w.owner.root).decide(c, otherAuth, NOW_MS, { ownerArmed: true }).code).toBe('authority_root_unknown');
    expect(candidateMonitorGrantsAuthority()).toBe(false);
  });

  it('candidatePayloadForProposals matches the assembled candidate payload (no drift)', () => {
    const cp = candidatePayloadForProposals([{ id: 'p', targetPath: 'apps/seed/src/notes.ts', newContent: '// c', createdAt: NOW_ISO, supersedes: null }]);
    expect(cp.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(cp.candidateId).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('self-protecting fence — table-independent, uncandidate-able', () => {
  const protectedPaths = [
    'apps/seed/src/pathFence.ts', 'apps/seed/src/localCandidateStage.ts', 'apps/seed/src/candidateReferenceMonitor.ts',
    'apps/seed/src/localCeremonyRunner.ts', 'apps/seed/src/mindDoor.ts', 'apps/seed/src/doorGuards.ts',
    'apps/seed/src/providerTransport.ts', 'apps/seed/src/aumlokGate.ts', 'apps/seed/src/ownerFixture.ts',
    'packages/kernel/src/authority.ts', 'packages/kernel/src/reducer.ts', 'packages/kernel/src/schema.ts',
    'scripts/verify-provenance.mjs', 'scripts/generate-kernel-sbom.mjs', '.github/workflows/ci.yml',
    'apps/seed/scripts/scan-public-tree.mjs',
  ];

  it('every self-protecting path classifies as authority, is readable, but is NEVER candidate-able', () => {
    for (const p of protectedPaths) {
      expect(isSelfProtecting(p)).toBe(true);
      const v = classifyPath(p);
      expect(v.class).toBe('authority');
      expect(readAllowed(v)).toBe(true);         // reasoning over them is fine
      expect(candidateAllowed(v)).toBe(false);   // proposing to change them is not
    }
  });

  it('candidateAllowed refuses a self-protecting path EVEN IF a (stale/empty) table wrongly classified it allowed', () => {
    // simulate a stale/empty allowlist that mis-classified the fence's own file as 'allowed'
    const staleVerdict: PathVerdict = { path: 'apps/seed/src/pathFence.ts', class: 'allowed', reasonClass: 'fence:ok', text: 'stale table said ok' };
    expect(candidateAllowed(staleVerdict)).toBe(false); // the direct isSelfProtecting guard still refuses
    // an ordinary path is unaffected
    expect(candidateAllowed({ path: 'apps/seed/src/notes.ts', class: 'allowed', reasonClass: 'fence:ok', text: 'ok' })).toBe(true);
  });
});

describe('public secret + PII scanner — canonical, fail-closed, no content echo', () => {
  it('passes a clean tree and FAILS (exit 1) on a planted secret without echoing it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aukora-scan-'));
    try {
      mkdirSync(join(dir, 'sub'), { recursive: true });
      execFileSync('git', ['init', '-q', dir]);
      writeFileSync(join(dir, 'clean.ts'), 'export const ok = 1;\n');
      execFileSync('git', ['-C', dir, 'add', '-A']);
      const scriptPath = join(process.cwd(), 'scripts', 'scan-public-tree.ts');
      const run = (): { code: number; out: string } => {
        try { const out = execFileSync('npx', ['tsx', scriptPath], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); return { code: 0, out }; }
        catch (e) { const err = e as { status?: number; stdout?: string; stderr?: string }; return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }; }
      };
      expect(run().code).toBe(0);

      const secret = 'AKIAIOSFODNN7EXAMPLE';
      writeFileSync(join(dir, 'leak.ts'), `const k = "${secret}";\n`);
      execFileSync('git', ['-C', dir, 'add', '-A']);
      const failed = run();
      expect(failed.code).toBe(1);
      expect(failed.out).toContain('leak.ts');
      expect(failed.out).toContain('(content not shown)');
      expect(failed.out).not.toContain(secret); // the secret is NEVER echoed
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('R57A email law: git@github.com scp form passes; any other email still fails; manifest exemption is name-scoped', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aukora-scan-r57-'));
    try {
      execFileSync('git', ['init', '-q', dir]);
      const scriptPath = join(process.cwd(), 'scripts', 'scan-public-tree.ts');
      const run = (): { code: number; out: string } => {
        try { const out = execFileSync('npx', ['tsx', scriptPath], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); return { code: 0, out }; }
        catch (e) { const err = e as { status?: number; stdout?: string; stderr?: string }; return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }; }
      };

      // the canonical scp origin literal in PRODUCT code is allowed (public service identity, not PII)
      writeFileSync(join(dir, 'origin.ts'), "export const CANON = 'git@github.com:aumara-xyz/aukora.git';\n");
      execFileSync('git', ['-C', dir, 'add', '-A']);
      expect(run().code).toBe(0);

      // the root identity manifest may enumerate userinfo-trick vectors (name-scoped fixture exemption)
      writeFileSync(join(dir, 'repository-identity.json'), '{ "vectors": { "reject": [{ "url": "deploy@github.com:aumara-xyz/aukora.git", "why": "scp-wrong-user" }] } }\n');
      execFileSync('git', ['-C', dir, 'add', '-A']);
      expect(run().code).toBe(0);

      // the SAME vector content under any OTHER name still fails closed — the exemption does not travel
      writeFileSync(join(dir, 'identity-vectors.json'), '{ "url": "deploy@github.com:aumara-xyz/aukora.git" }\n');
      execFileSync('git', ['-C', dir, 'add', '-A']);
      const wrongName = run();
      expect(wrongName.code).toBe(1);
      expect(wrongName.out).toContain('identity-vectors.json');
      expect(wrongName.out).not.toContain('deploy@github.com'); // never echoed
      execFileSync('git', ['-C', dir, 'rm', '-q', '--cached', 'identity-vectors.json']);
      rmSync(join(dir, 'identity-vectors.json'));

      // an allowed literal EARLIER in a file cannot shadow a real email later in the same file
      writeFileSync(join(dir, 'shadow.ts'), "export const a = 'git@github.com:aumara-xyz/aukora';\nexport const b = 'sam.person@gmail.com';\n");
      execFileSync('git', ['-C', dir, 'add', '-A']);
      const shadowed = run();
      expect(shadowed.code).toBe(1);
      expect(shadowed.out).toContain('shadow.ts');
      expect(shadowed.out).not.toContain('sam.person'); // never echoed
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('owner-armed egress — content-free receipts, durable spend, non-votes grant nothing', () => {
  const seat = CANONICAL_SEATS[0];
  const inner: Transport = async (_s, _p, _phase) => ({ text: 'PACKET', served: seat.slug, costUsd: 0.5 });

  it('disarmed egress makes NO call and returns a non-vote; armed egress calls + books durable spend', async () => {
    const store = new ReactiveMemoryStore();
    let calls = 0;
    const counting: Transport = async (s, p, phase, sig) => { calls += 1; return inner(s, p, phase, sig); };

    const disarmed = armedEgressTransport(counting, { arm: fixedArm(false), store, nowIso: NOW_ISO });
    const r1 = await disarmed(seat, 'hi', 'round1', new AbortController().signal);
    expect(r1.served).toBeUndefined();   // non-vote shaped
    expect(calls).toBe(0);               // no call left the machine

    const spend = new DurableSpendAccount(0);
    const armed = armedEgressTransport(counting, { arm: fixedArm(true), store, spend, nowIso: NOW_ISO });
    await armed(seat, 'hi', 'round1', new AbortController().signal);
    expect(calls).toBe(1);
    expect(spend.dayToDateUsd).toBeCloseTo(0.5); // durable spend booked
    expect(providerEgressGrantsAuthority()).toBe(false);
  });

  it('per-call egress receipts are CONTENT-FREE (metadata only; no prompt/response/key)', async () => {
    const store = new ReactiveMemoryStore();
    const armed = armedEgressTransport(inner, { arm: fixedArm(true), store, nowIso: NOW_ISO });
    await armed(seat, 'SECRET PROMPT do not leak', 'synthesis', new AbortController().signal);
    const receipts = (armed as unknown as { egressReceipts: () => { status: string }[] }).egressReceipts();
    expect(receipts.length).toBe(1);
    expect(receipts[0].status).toBe('called');
    const audit = store.recall({ text: 'provider-egress' });
    expect(audit.length).toBe(1);
    expect(audit[0].content).not.toContain('SECRET PROMPT'); // prompt never receipted
    expect(audit[0].content).toContain('phase=synthesis');   // safe metadata only
  });

  it('the durable spend ceiling refuses a call BEFORE dispatch (fail-closed)', async () => {
    const store = new ReactiveMemoryStore();
    const spend = new DurableSpendAccount(9.9); // near the $10/day ceiling
    let calls = 0;
    const counting: Transport = async (s, p, phase, sig) => { calls += 1; return inner(s, p, phase, sig); };
    const armed = armedEgressTransport(counting, { arm: fixedArm(true), store, spend, perCallEstimateUsd: 0.5, nowIso: NOW_ISO });
    const r = await armed(seat, 'hi', 'round1', new AbortController().signal);
    expect(r.served).toBeUndefined();
    expect(calls).toBe(0); // over-ceiling → refused before dispatch
    expect(store.recall({ text: 'refused-ceiling' }).length).toBe(1);
  });

  it('env arm is disarmed by default', () => {
    delete process.env.AUKORA_FU_ARMED;
    expect(envProviderArm.armed()).toBe(false);
  });
});
