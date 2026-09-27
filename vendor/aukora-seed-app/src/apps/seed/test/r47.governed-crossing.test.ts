// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * R47 — the governed crossing: an Auma-authored pending intent crosses to the EXISTING candidate machinery through
 * ONE immutable translation → the closed envelope → the qualifier (halts before signature) → the existing runner →
 * the isolated candidate stage. No second authority path; no donor native apply; no PR #72 import.
 *
 * Pure tests cover translation immutability + byte-exact binding + goal/code substitution + qualifier halt. A real
 * disposable git repo covers materialization (owner-signed), stale-head refusal, and the /api/loop projection. Every
 * asserted boundary has a negative control.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  translateToEnvelope, qualifyCrossing, crossToCandidate, projectCrossing, governedCrossingGrantsAuthority,
  PENDING_INTENT_SCHEMA, candidatePayloadForProposals, deriveIntentId, deriveDraftHash,
  InMemoryWorkflowStore,
  type PendingIntentV1, type DraftBytes, type LocalCeremonyEnv, type RepoReadCapability,
} from '../src/index.js';
import { makeWorld, authFor, NOW_ISO, NOW_MS, TARGET } from './support.js';

const HEAD = 'a'.repeat(40); // a stand-in HEAD sha for pure tests
function intent(over: Partial<PendingIntentV1> = {}): PendingIntentV1 {
  return {
    schema: PENDING_INTENT_SCHEMA,
    intentId: 'i'.repeat(64),
    goal: 'refine the governed note',
    rationale: 'the note needs a clarifying line',
    affectedPaths: [{ path: TARGET, epistemicStatus: 'verified' }],
    riskNotes: 'low',
    authoredBy: 'voice',
    advisoryOnly: true,
    grantsAuthority: false,
    ...over,
  };
}
const draft = (over: Partial<DraftBytes> = {}): DraftBytes => ({ targetPath: TARGET, newContent: '// a governed refinement', supersedes: null, ...over });

describe('R47 · immutable translation + byte-exact binding', () => {
  it('translates to a DEEP-FROZEN closed envelope; the draftHash is the REAL bytes and the binding is stable', () => {
    const t = translateToEnvelope(intent(), draft(), { headBefore: HEAD, tests: ['apps/seed'] });
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    const { crossing } = t;
    expect(Object.isFrozen(crossing)).toBe(true);
    expect(Object.isFrozen(crossing.envelope)).toBe(true);
    expect(Object.isFrozen(crossing.envelope.proposal)).toBe(true);
    // byte-exact: the draftHash equals deriveDraftHash over the REAL bytes (not the intent hints)
    expect(crossing.binding.draftHash).toBe(deriveDraftHash({ id: 'x', targetPath: TARGET, newContent: '// a governed refinement', createdAt: '2026-01-01T00:00:00.000Z', supersedes: null }));
    expect(crossing.binding.headBefore).toBe(HEAD);
    expect(crossing.binding.bindingHash).toMatch(/^[0-9a-f]{64}$/);
    expect(governedCrossingGrantsAuthority()).toBe(false);
  });

  it('NEGATIVE CONTROL — mutable envelope: an attempt to mutate the frozen envelope does not change it', () => {
    const t = translateToEnvelope(intent(), draft(), { headBefore: HEAD });
    if (!t.ok) throw new Error('translate failed');
    const before = t.crossing.envelope.proposal.newContent;
    try { (t.crossing.envelope.proposal as { newContent: string }).newContent = 'HIJACKED'; } catch { /* strict-mode throw is fine */ }
    expect(t.crossing.envelope.proposal.newContent).toBe(before); // frozen: mutation is inert
  });

  it('goal substitution is inert (stated goal never enters the draftHash); code substitution is refused', () => {
    const a = translateToEnvelope(intent({ goal: 'fix a typo' }), draft(), { headBefore: HEAD });
    const b = translateToEnvelope(intent({ goal: 'DELETE ALL SAFETY' }), draft(), { headBefore: HEAD });
    if (!a.ok || !b.ok) throw new Error('translate failed');
    expect(a.crossing.binding.draftHash).toBe(b.crossing.binding.draftHash); // goal is non-binding
    // code substitution: a draft targeting a path the intent never declared is refused
    const evil = translateToEnvelope(intent(), draft({ targetPath: 'apps/seed/src/OTHER.ts' }), { headBefore: HEAD });
    expect(evil.ok).toBe(false);
    if (!evil.ok) expect(evil.reasonClass).toBe('crossing:path-not-declared');
  });

  it('a non-advisory intent, a missing head, and an oversized draft are refused up front', () => {
    expect(translateToEnvelope(intent({ grantsAuthority: true as unknown as false }), draft(), { headBefore: HEAD }).ok).toBe(false);
    expect(translateToEnvelope(intent(), draft(), { headBefore: '' }).ok).toBe(false);
    const huge = '/* ' + 'x'.repeat(70000) + ' */';
    expect(translateToEnvelope(intent(), draft({ newContent: huge }), { headBefore: HEAD }).ok).toBe(false);
  });
});

describe('R47 · qualifier halts before signature (reuses the R45 qualifier)', () => {
  it('a clean crossing is admitted only to the owner decision — no signature, grantsAuthority:false', () => {
    const t = translateToEnvelope(intent(), draft(), { headBefore: HEAD });
    if (!t.ok) throw new Error('translate failed');
    const v = qualifyCrossing(makeWorld().env, t.crossing);
    expect(v.admitted).toBe(true);
    expect(v.reasonClass).toBe('proposer:admitted-to-owner-decision');
    expect(v.haltedBeforeSignature).toBe(true);
    expect(v.grantsAuthority).toBe(false);
  });

  it('NEGATIVE CONTROL — secret/protected/authority-shaped content is contained by the qualifier', () => {
    const secret = translateToEnvelope(intent(), draft({ newContent: 'const k="sk-or-v1-abcdef0123456789abcdef0123456789"' }), { headBefore: HEAD });
    if (secret.ok) expect(qualifyCrossing(makeWorld().env, secret.crossing).admitted).toBe(false);
    // a protected target is refused at translation (not declared) OR at the qualifier fence — both are valid denials
    const prot = translateToEnvelope(intent({ affectedPaths: [{ path: 'apps/seed/src/aumlokGate.ts', epistemicStatus: 'inferred' }] }), draft({ targetPath: 'apps/seed/src/aumlokGate.ts' }), { headBefore: HEAD });
    if (prot.ok) expect(qualifyCrossing(makeWorld().env, prot.crossing).admitted).toBe(false);
  });
});

// ── real disposable git repo: materialization, stale head, projection ────────────────────────────
let base: string; let repoRoot: string; let wtBase: string;
beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'aukora-r47-'));
  repoRoot = join(base, 'repo'); wtBase = join(base, 'candidates');
  mkdirSync(join(repoRoot, 'apps/seed/src'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', repoRoot]);
  execFileSync('git', ['-C', repoRoot, 'config', 'user.name', 'R47']);
  execFileSync('git', ['-C', repoRoot, 'config', 'user.email', 'r47@test.local']);
  execFileSync('git', ['-C', repoRoot, 'remote', 'add', 'origin', 'https://github.com/aumara-xyz/aukora.git']); // R57A canonical identity
  writeFileSync(join(repoRoot, TARGET), '// original\n');
  execFileSync('git', ['-C', repoRoot, 'add', '-A']);
  execFileSync('git', ['-C', repoRoot, 'commit', '-q', '--no-gpg-sign', '-m', 'init']);
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

const repoCap = (): RepoReadCapability => ({ list: () => [TARGET], read: (p) => readFileSync(join(repoRoot, p), 'utf8'), exists: (p) => existsSync(join(repoRoot, p)) });
const headSha = () => execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
function ceremonyEnv(w: ReturnType<typeof makeWorld>): LocalCeremonyEnv {
  return { recursionEnv: w.env, workflowStore: new InMemoryWorkflowStore(), repo: repoCap(), ownerRoot: w.owner.root, store: w.env.store, gitRepoRoot: repoRoot, worktreeBase: wtBase, nowMs: NOW_MS, nowIso: NOW_ISO };
}

describe('R47 · crossing terminates only at the existing candidate machinery', () => {
  it('owner-signed crossing materializes ONLY into a disposable worktree; main byte-identical; projection reports it', () => {
    const w = makeWorld();
    const env = ceremonyEnv(w);
    const content = '// crossing refine';
    const t = translateToEnvelope(intent(), draft({ newContent: content }), { headBefore: headSha(), tests: ['apps/seed'] });
    if (!t.ok) throw new Error('translate failed');
    const proposal = { id: 'p', targetPath: TARGET, newContent: content, createdAt: NOW_ISO, supersedes: null };
    const auth = authFor(w.owner, proposal, { nonce: 'cross-1' });
    const { payloadHash } = candidatePayloadForProposals([proposal], headSha()); // R54 v6: head-bound approval
    const candidateAuth = w.owner.authorize({ proposalHash: payloadHash, draftHash: payloadHash, nonce: 'cross-cand-1', issuedAt: NOW_ISO, expiresAt: null });

    const headBefore = headSha();
    const cross = crossToCandidate(env, { crossing: t.crossing, currentHead: headSha(), auth, nonce: 'cross-1', candidateAuth, ownerArmed: true, materialize: true });
    expect(cross.ok).toBe(true);
    expect(cross.run?.phase).toBe('candidate-materialized');
    // isolation: primary tree + HEAD untouched; the effect is a disposable worktree branch only
    expect(headSha()).toBe(headBefore);
    expect(execFileSync('git', ['-C', repoRoot, 'status', '--porcelain'], { encoding: 'utf8' }).trim()).toBe('');
    expect(readFileSync(join(repoRoot, TARGET), 'utf8')).toBe('// original\n');
    const proj = projectCrossing(t.crossing, cross);
    expect(proj.materialized).toBe(true);
    expect(proj.candidateBranch).toMatch(/^candidate\//);
    expect(proj.draftHash).toBe(t.crossing.binding.draftHash);
    expect(proj.grantsAuthority).toBe(false);
  });

  it('NEGATIVE CONTROL — stale head: a crossing bound to an old HEAD refuses before the runner (no effect)', () => {
    const w = makeWorld();
    const env = ceremonyEnv(w);
    const t = translateToEnvelope(intent(), draft({ newContent: '// stale' }), { headBefore: 'deadbeef'.repeat(5) });
    if (!t.ok) throw new Error('translate failed');
    const proposal = { id: 'p', targetPath: TARGET, newContent: '// stale', createdAt: NOW_ISO, supersedes: null };
    const auth = authFor(w.owner, proposal, { nonce: 'cross-stale' });
    const cross = crossToCandidate(env, { crossing: t.crossing, currentHead: headSha(), auth, nonce: 'cross-stale', ownerArmed: true, materialize: true });
    expect(cross.ok).toBe(false);
    expect(cross.reasonClass).toBe('crossing:stale-head');
    expect(cross.run).toBe(null);
  });

  it('NEGATIVE CONTROL — forged hybrid half: an owner auth with a bad signature never materializes', () => {
    const w = makeWorld();
    const env = ceremonyEnv(w);
    const t = translateToEnvelope(intent(), draft({ newContent: '// forged' }), { headBefore: headSha() });
    if (!t.ok) throw new Error('translate failed');
    const proposal = { id: 'p', targetPath: TARGET, newContent: '// forged', createdAt: NOW_ISO, supersedes: null };
    const good = authFor(w.owner, proposal, { nonce: 'cross-forged' });
    const forged = { ...good, signatures: { ...good.signatures, ed25519: '00'.repeat(64) } };
    const cross = crossToCandidate(env, { crossing: t.crossing, currentHead: headSha(), auth: forged, nonce: 'cross-forged', ownerArmed: true, materialize: true });
    expect(cross.ok).toBe(false);
    expect(cross.run?.phase === 'candidate-materialized').toBe(false);
  });

  it('NEGATIVE CONTROL — no explicit materialize / no owner arm: rehearses but produces NO candidate effect', () => {
    const w = makeWorld();
    const env = ceremonyEnv(w);
    const t = translateToEnvelope(intent(), draft({ newContent: '// no-mat' }), { headBefore: headSha() });
    if (!t.ok) throw new Error('translate failed');
    const proposal = { id: 'p', targetPath: TARGET, newContent: '// no-mat', createdAt: NOW_ISO, supersedes: null };
    const auth = authFor(w.owner, proposal, { nonce: 'cross-nomat' });
    const cross = crossToCandidate(env, { crossing: t.crossing, currentHead: headSha(), auth, nonce: 'cross-nomat', materialize: false });
    expect(cross.run?.phase).toBe('awaiting-explicit-materialize');
    expect(projectCrossing(t.crossing, cross).materialized).toBe(false);
  });

  it('restart determinism: the same intent + bytes + head re-translate to the SAME binding (no drift)', () => {
    const a = translateToEnvelope(intent(), draft(), { headBefore: HEAD, tests: ['apps/seed'] });
    const b = translateToEnvelope(intent(), draft(), { headBefore: HEAD, tests: ['apps/seed'] });
    if (!a.ok || !b.ok) throw new Error('translate failed');
    expect(a.crossing.binding.bindingHash).toBe(b.crossing.binding.bindingHash);
  });
});
