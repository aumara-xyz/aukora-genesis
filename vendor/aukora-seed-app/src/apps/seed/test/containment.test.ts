// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Structural containment — proven from the source, not just behaviour:
 *  - the recursion runtime imports no filesystem / network / subprocess module (it cannot touch disk or a live repo);
 *  - the runtime never signs (no `.sign(`), and never imports the signing fixture — signing is an out-of-band owner act;
 *  - the hybrid signature really lives in the owner fixture (both Ed25519 AND ML-DSA-65), so the gate is not Ed25519-only.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (rel: string): string => readFileSync(rel, 'utf8'); // vitest cwd = apps/seed

// The modules on the runtime import graph of the governed recursion + ceremony (NOT the barrel, NOT the fixture).
const RUNTIME_MODULES = [
  'src/recursion.ts', 'src/aumlokGate.ts', 'src/proposal.ts', 'src/ledger.ts', 'src/mockCouncil.ts',
  'src/forbiddenContent.ts', 'src/auraTrace.ts', 'src/capabilities.ts', 'src/geometry.ts',
  'src/ceremony.ts', 'src/ceremonyView.ts',
  'src/pathFence.ts', 'src/ideEnvelope.ts', 'src/eventStream.ts', 'src/metabolism.ts', 'src/councilPack.ts',
  'src/memoryConstitution.ts', 'src/maternalAnchor.ts', 'src/memorySelection.ts', 'src/councilRunnerBoundary.ts',
  'src/ideSession.ts', 'src/selectionAcceptance.ts', 'src/spatialCeremonyAdapter.ts', 'src/contracts.ts',
  'src/durableRecursion.ts', 'src/fuStructuredAdapter.ts', 'src/localCeremonyRunner.ts',
  'src/doorGuards.ts', 'src/mindDoor.ts', 'src/candidateReferenceMonitor.ts',
  'src/repoIdentity.ts',
];

const FORBIDDEN_IMPORT = /\bfrom\s+['"](?:node:)?(?:fs|fs\/promises|child_process|net|tls|http|https|dns|dgram|worker_threads|cluster|vm|repl)['"]/;
const FORBIDDEN_REQUIRE = /\brequire\(\s*['"](?:node:)?(?:fs|child_process|net|tls|http|https|dns|dgram|worker_threads|cluster|vm|repl)['"]/;

describe('runtime touches no disk / network / subprocess', () => {
  for (const mod of RUNTIME_MODULES) {
    it(`${mod} imports no fs/network/subprocess module`, () => {
      const src = read(mod);
      expect(FORBIDDEN_IMPORT.test(src)).toBe(false);
      expect(FORBIDDEN_REQUIRE.test(src)).toBe(false);
    });
  }
});

describe('the runtime never self-signs', () => {
  for (const mod of RUNTIME_MODULES) {
    it(`${mod} contains no signing call and does not import the owner fixture`, () => {
      const src = read(mod);
      expect(src.includes('.sign(')).toBe(false);
      expect(/from ['"][^'"]*ownerFixture['"]/.test(src)).toBe(false); // no IMPORT of the signing fixture
    });
  }
});

describe('the candidate stage (the ONE effectful adapter) is contained by its own law', () => {
  const src = () => read('src/localCandidateStage.ts');

  it('never pushes, merges, fetches, pulls, resets, rebases, or touches a remote', () => {
    const s = src();
    for (const verb of ["'push'", "'merge'", "'fetch'", "'pull'", "'remote'", "'reset'", "'rebase'", "'checkout'"]) {
      expect(s.includes(verb)).toBe(false);
    }
    expect(/git\s+push|push\s*\(/.test(s)).toBe(false);
  });

  it('git surface is a runtime allowlist and the commit is --no-gpg-sign (a record, not a signature)', () => {
    const s = src();
    expect(s).toContain('ALLOWED_GIT_SUBCOMMANDS');
    expect(s).toContain('--no-gpg-sign');
    expect(/from ['"][^'"]*ownerFixture['"]/.test(s)).toBe(false); // no IMPORT of the signing fixture
    expect(s.includes('.sign(')).toBe(false); // never signs for the owner
  });

  it('no network module — fs + child_process(git) only', () => {
    const s = src();
    expect(/\bfrom\s+'(?:node:)?(?:net|tls|http|https|dns|dgram)'/.test(s)).toBe(false);
  });

  it('repository identity is wired before any effect (R57A): the pure verdict + the one read-only argv', () => {
    const s = src();
    expect(s).toContain("from './repoIdentity.js'");   // verdict logic is the PURE containment-listed module
    expect(s).toContain('IDENTITY_READ_ARGV');          // the ONE hard-coded read-only identity read
    expect(s).toContain("'candidate:wrong-repository'");// the typed wrong-repository outcome exists
    // the guard must run before the reference monitor can consume the nonce: source order is proven
    // behaviourally in r57.repo-identity.test.ts; here we pin that the identity block precedes decide()
    expect(s.indexOf('evaluateRemoteConfig(identityRaw)')).toBeGreaterThan(0);
    expect(s.indexOf('evaluateRemoteConfig(identityRaw)')).toBeLessThan(s.indexOf('.decide(candidate'));
  });
});

describe('the provider transport edge (the ONLY network module) embeds no credential', () => {
  const edge = ['src/providerTransport.ts', 'src/fuLiveSmoke.ts', 'scripts/fu-live-smoke.ts'];

  it('holds no hardcoded key/token/endpoint credential and never signs', () => {
    for (const mod of edge) {
      const src = read(mod);
      expect(src.includes('.sign(')).toBe(false);
      expect(/from ['"][^'"]*ownerFixture['"]/.test(src)).toBe(false); // no IMPORT of the signing fixture
      // no bearer/sk-/AKIA literal, and the token is used only via a `Bearer ${token}` header interpolation
      expect(/\bsk-[A-Za-z0-9]{16,}\b|\bAKIA[0-9A-Z]{16}\b|Bearer\s+[A-Za-z0-9._-]{16,}/.test(src)).toBe(false);
    }
    // the credential is retrieved via a reference, never embedded, and the redactor emits [redacted]
    const pt = read('src/providerTransport.ts');
    expect(pt).toContain('credentialRef');
    expect(pt).toContain('[redacted]');
    expect(pt.includes('writeFileSync') || pt.includes("from 'node:fs'")).toBe(false); // never writes a key to disk
  });
});

describe('the AUMLOK gate is genuinely hybrid (not Ed25519-only)', () => {
  it('the owner fixture is the ONLY signer and signs BOTH Ed25519 and ML-DSA-65', () => {
    const fixture = read('src/ownerFixture.ts');
    expect(fixture).toContain('ed25519.sign(');
    expect(fixture).toContain('ml_dsa65.sign(');
  });

  it('the gate verifies via the kernel hybrid API and offers no Ed25519-only path', () => {
    const gate = read('src/aumlokGate.ts');
    expect(gate).toContain('verifyAumlokPromotionV2');
    // no bespoke ed25519.verify fallback in the gate — verification is the kernel hybrid verify only
    expect(gate.includes('ed25519.verify')).toBe(false);
  });
});
