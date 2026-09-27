// scripts/swarm/validate-fractal-court.ts — Antigravity Independent Fractal Court Suite

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PROPOSED_MINIMUM_LEASES,
  auditLeaseCollisions,
  parseUnifiedDiffPaths,
  isAllowlistedPublicExport,
  auditDynamicCandidateLease,
  auditK1ExportCandidate,
  auditK2IngestCandidate,
  auditK0GKeystoneCandidate,
  computeDependencyAwareGoldenTurns,
  type CandidateLaneLeaseV1,
  type CandidateProposalPackageV1,
  type CourtAuditVerdictV1,
} from '../../core/swarm/fractal-court';

const sha256hex = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

export interface CourtResultV1 {
  testId: string;
  category: string;
  name: string;
  rawOutcome: string;
  passed: boolean;
}

// 1. Lease Freeze & Structural Diff Suite (3 tests)
export function runLeaseStructuralSuite(): CourtResultV1[] {
  const tests: CourtResultV1[] = [];

  // FC-01: Proposed minimum leases collision-free
  {
    const res = auditLeaseCollisions(PROPOSED_MINIMUM_LEASES);
    tests.push({
      testId: 'FC-01-PROPOSED-LEASES-COLLISION-FREE',
      category: 'LEASE_FREEZE',
      name: 'Proposed candidate lane minimum leases (K0, K1, K2) are 100% collision-free',
      rawOutcome: `ok=${res.ok}`,
      passed: res.ok === true,
    });
  }

  // FC-02: Structural diff parser extracts paths
  {
    const patch = 'diff --git a/core/swarm/forge-ingest.ts b/core/swarm/forge-ingest.ts\n--- a/core/swarm/forge-ingest.ts\n+++ b/core/swarm/forge-ingest.ts';
    const paths = parseUnifiedDiffPaths(patch);
    const hasPath = paths.includes('core/swarm/forge-ingest.ts');
    tests.push({
      testId: 'FC-02-STRUCTURAL-DIFF-PARSER',
      category: 'DIFF_PARSER',
      name: 'Structural diff parser extracts exact modified file paths from patch',
      rawOutcome: `paths=[${paths.join(', ')}]`,
      passed: hasPath === true,
    });
  }

  // FC-03: Dynamic unleased path touch refused
  {
    const res = auditDynamicCandidateLease('K1', ['core/swarm/export-archive.ts', 'specs/0026-boundary-closure.md']); // K1 touching K0 file!
    tests.push({
      testId: 'FC-03-UNLEASED-PATH-REFUSED',
      category: 'LEASE_FREEZE',
      name: 'Candidate touching unleased file outside lane allowed prefixes refused',
      rawOutcome: `ok=${res.ok}, reason=${res.refusalReason}`,
      passed: res.ok === false && res.refusalReason?.includes('REFUSED_UNLEASED_PATH_TOUCHED'),
    });
  }

  return tests;
}

// 2. K1 Export Candidate Suite (3 tests)
export function runK1ExportSuite(): CourtResultV1[] {
  const tests: CourtResultV1[] = [];

  const validK1Node = {
    cellId: 'cell-k1-export',
    campaignId: 'camp-123',
    depth: 2,
    parentCellId: 'root-1',
    parentReceiptAnchor: 'anchor-root-123',
    idempotencyKey: 'idem-lane-k1-chain-export',
    allowedLeasePrefixes: ['core/swarm/export-archive.ts'],
    budget: { maxTokens: 10000, maxWallClockMs: 60000, maxCostCents: 200, maxEffects: 10 },
    allowedTools: ['read_file', 'write_file'],
    networkPolicy: 'deny' as const,
    status: 'accepted' as const,
    briefDigest: sha256hex('brief-k1'),
    candidateDigest: sha256hex('cand-k1'),
    identityBound: false as const,
  };

  // K1-01: Allowlist public material passes
  {
    const isPublic = isAllowlistedPublicExport('core/swarm/export-archive.ts') && isAllowlistedPublicExport('ledger.jsonl');
    tests.push({
      testId: 'K1-01-ALLOWLIST-PUBLIC-MATERIAL',
      category: 'K1_EXPORT_AUDIT',
      name: 'Allowlisted public export material (.ts, .json, .jsonl, .md, signing.pub) passes scan',
      rawOutcome: `isPublic=${isPublic}`,
      passed: isPublic === true,
    });
  }

  // K1-02: Secret leak signing.seed in export manifest refused
  {
    const pkg: CandidateProposalPackageV1 = {
      laneId: 'K1',
      baseCommit: '8c63f9e',
      diffDigest: sha256hex('diff-k1'),
      candidateNode: validK1Node,
      exportManifestFiles: ['core/swarm/export-archive.ts', '.aukora/keys/signing.seed'],
      testResults: { total: 10, passed: 10, failed: 0, suiteDigest: sha256hex('test-k1') },
      claimedStatus: 'accepted',
    };
    const verdict = auditK1ExportCandidate(pkg);
    tests.push({
      testId: 'K1-02-SECRET-LEAK-REFUSED',
      category: 'K1_EXPORT_AUDIT',
      name: 'Export manifest containing signing.seed or non-allowlisted private key material refused',
      rawOutcome: `verdict=${verdict.verdict}, reason=${verdict.refusalReason}`,
      passed: verdict.ok === false && verdict.refusalReason?.includes('REFUSED_SECRET_LEAK_IN_EXPORT'),
    });
  }

  // K1-03: Valid K1 export package verified
  {
    const pkg: CandidateProposalPackageV1 = {
      laneId: 'K1',
      baseCommit: '8c63f9e',
      diffDigest: sha256hex('diff-k1'),
      candidateNode: validK1Node,
      exportManifestFiles: ['core/swarm/export-archive.ts', 'manifest.json', 'ledger.jsonl'],
      testResults: { total: 10, passed: 10, failed: 0, suiteDigest: sha256hex('test-k1') },
      claimedStatus: 'accepted',
    };
    const verdict = auditK1ExportCandidate(pkg);
    tests.push({
      testId: 'K1-03-VALID-EXPORT-VERIFIED',
      category: 'K1_EXPORT_AUDIT',
      name: 'Valid local chain export candidate package verified',
      rawOutcome: `verdict=${verdict.verdict}`,
      passed: verdict.ok === true && verdict.verdict === 'VERIFIED',
    });
  }

  return tests;
}

// 3. K2 Ingest Candidate Suite (3 tests)
export function runK2IngestSuite(): CourtResultV1[] {
  const tests: CourtResultV1[] = [];

  const validK2Node = {
    cellId: 'cell-k2-ingest',
    campaignId: 'camp-123',
    depth: 2,
    parentCellId: 'root-1',
    parentReceiptAnchor: 'anchor-root-123',
    idempotencyKey: 'idem-lane-k2-forge-ingest',
    allowedLeasePrefixes: ['core/swarm/forge-ingest.ts'],
    budget: { maxTokens: 10000, maxWallClockMs: 60000, maxCostCents: 200, maxEffects: 10 },
    allowedTools: ['read_file', 'write_file'],
    networkPolicy: 'deny' as const,
    status: 'accepted' as const,
    briefDigest: sha256hex('brief-k2'),
    candidateDigest: sha256hex('cand-k2'),
    identityBound: false as const,
  };

  // K2-01: Structural import network call in patch refused
  {
    const pkg: CandidateProposalPackageV1 = {
      laneId: 'K2',
      baseCommit: '8c63f9e',
      diffDigest: sha256hex('diff-k2'),
      candidateNode: validK2Node,
      candidatePatch: 'diff --git a/core/swarm/forge-ingest.ts b/core/swarm/forge-ingest.ts\n+import http from "http";\n+spawn("git", ["push", "origin", "main"]);',
      testResults: { total: 10, passed: 10, failed: 0, suiteDigest: sha256hex('test-k2') },
      claimedStatus: 'accepted',
    };
    const verdict = auditK2IngestCandidate(pkg);
    tests.push({
      testId: 'K2-01-STRUCTURAL-NETWORK-REFUSED',
      category: 'K2_INGEST_AUDIT',
      name: 'K2 patch introducing structural network import or git push call refused',
      rawOutcome: `verdict=${verdict.verdict}, reason=${verdict.refusalReason}`,
      passed: verdict.ok === false && verdict.refusalReason?.includes('REFUSED_FORGE_UNAUTHORIZED_LANDING'),
    });
  }

  // K2-02: TCB escape in patch refused
  {
    const pkg: CandidateProposalPackageV1 = {
      laneId: 'K2',
      baseCommit: '8c63f9e',
      diffDigest: sha256hex('diff-k2'),
      candidateNode: validK2Node,
      candidatePatch: 'diff --git a/scripts/boundary-verify.ts b/scripts/boundary-verify.ts\n+tampered',
      testResults: { total: 10, passed: 10, failed: 0, suiteDigest: sha256hex('test-k2') },
      claimedStatus: 'accepted',
    };
    const verdict = auditK2IngestCandidate(pkg);
    tests.push({
      testId: 'K2-02-TCB-ESCAPE-REFUSED',
      category: 'K2_INGEST_AUDIT',
      name: 'K2 patch touching protected TCB file (scripts/boundary-verify.ts) refused',
      rawOutcome: `verdict=${verdict.verdict}, reason=${verdict.refusalReason}`,
      passed: verdict.ok === false && verdict.refusalReason?.includes('REFUSED_FORGE_LEASE_ESCAPE'),
    });
  }

  // K2-03: Valid forge-ingest candidate verified
  {
    const pkg: CandidateProposalPackageV1 = {
      laneId: 'K2',
      baseCommit: '8c63f9e',
      diffDigest: sha256hex('diff-k2'),
      candidateNode: validK2Node,
      candidatePatch: 'diff --git a/core/swarm/forge-ingest.ts b/core/swarm/forge-ingest.ts\n+export function ingestLocalPatch() {}',
      testResults: { total: 10, passed: 10, failed: 0, suiteDigest: sha256hex('test-k2') },
      claimedStatus: 'accepted',
    };
    const verdict = auditK2IngestCandidate(pkg);
    tests.push({
      testId: 'K2-03-VALID-INGEST-VERIFIED',
      category: 'K2_INGEST_AUDIT',
      name: 'Valid local forge-ingest candidate verified',
      rawOutcome: `verdict=${verdict.verdict}`,
      passed: verdict.ok === true && verdict.verdict === 'VERIFIED',
    });
  }

  return tests;
}

// 4. K0 Keystone Audit Suite (2 tests)
export function runK0KeystoneSuite(): CourtResultV1[] {
  const tests: CourtResultV1[] = [];

  const validK0Node = {
    cellId: 'cell-k0-gate-g',
    campaignId: 'camp-123',
    depth: 2,
    parentCellId: 'root-1',
    parentReceiptAnchor: 'anchor-root-123',
    idempotencyKey: 'idem-lane-k0-gate-g',
    allowedLeasePrefixes: ['docs/swarm/patches/026f/chunks/e-f-gates'],
    budget: { maxTokens: 20000, maxWallClockMs: 120000, maxCostCents: 500, maxEffects: 20 },
    allowedTools: ['read_file', 'write_file'],
    networkPolicy: 'deny' as const,
    status: 'accepted' as const,
    briefDigest: sha256hex('brief-k0'),
    candidateDigest: sha256hex('cand-k0'),
    identityBound: false as const,
  };

  // K0-01: Automatic runtime activation in K0 patch refused
  {
    const pkg: CandidateProposalPackageV1 = {
      laneId: 'K0',
      baseCommit: '8c63f9e',
      diffDigest: sha256hex('diff-k0'),
      candidateNode: validK0Node,
      candidatePatch: 'diff --git a/core/swarm/fractal-contract.ts\n+export const AUTOMATIC_RECURSIVE_SPAWN = true;',
      testResults: { total: 15, passed: 15, failed: 0, suiteDigest: sha256hex('test-k0') },
      claimedStatus: 'accepted',
    };
    const verdict = auditK0GKeystoneCandidate(pkg);
    tests.push({
      testId: 'K0-01-AUTO-ACTIVATION-REFUSED',
      category: 'K0_KEYSTONE_AUDIT',
      name: 'K0 patch attempting automatic recursive swarm / v2 activation refused',
      rawOutcome: `verdict=${verdict.verdict}, reason=${verdict.refusalReason}`,
      passed: verdict.ok === false && verdict.refusalReason?.includes('REFUSED_AUTOMATIC_RUNTIME_ACTIVATION'),
    });
  }

  // K0-02: Valid K0 keystone candidate verified
  {
    const pkg: CandidateProposalPackageV1 = {
      laneId: 'K0',
      baseCommit: '8c63f9e',
      diffDigest: sha256hex('diff-k0'),
      candidateNode: validK0Node,
      candidatePatch: 'diff --git a/docs/swarm/patches/026f/chunks/e-f-gates/g-gate.ts\n+export function buildGateGCandidate() {}',
      testResults: { total: 15, passed: 15, failed: 0, suiteDigest: sha256hex('test-k0') },
      claimedStatus: 'accepted',
    };
    const verdict = auditK0GKeystoneCandidate(pkg);
    tests.push({
      testId: 'K0-02-VALID-KEYSTONE-VERIFIED',
      category: 'K0_KEYSTONE_AUDIT',
      name: 'Valid K0 #26 G keystone candidate package verified',
      rawOutcome: `verdict=${verdict.verdict}`,
      passed: verdict.ok === true && verdict.verdict === 'VERIFIED',
    });
  }

  return tests;
}

// 5. Dependency-Aware Golden Turn Ordering Suite (2 tests)
export function runDependencyGoldenTurnSuite(): CourtResultV1[] {
  const tests: CourtResultV1[] = [];

  const verdictK0: CourtAuditVerdictV1 = { ok: true, laneId: 'K0', verdict: 'VERIFIED', refusalReason: null, diffDigest: sha256hex('k0') };
  const verdictK1: CourtAuditVerdictV1 = { ok: true, laneId: 'K1', verdict: 'VERIFIED', refusalReason: null, diffDigest: sha256hex('k1') };
  const verdictK2: CourtAuditVerdictV1 = { ok: true, laneId: 'K2', verdict: 'VERIFIED', refusalReason: null, diffDigest: sha256hex('k2') };

  // DG-01: Verified candidates eligible for Golden Turn
  {
    const res = computeDependencyAwareGoldenTurns([verdictK0, verdictK1, verdictK2]);
    tests.push({
      testId: 'DG-01-DEPENDENCY-AWARE-ORDER',
      category: 'GOLDEN_TURN_ORDER',
      name: 'Verified candidates eligible with K0 as keystone',
      rawOutcome: `eligible=[${res.eligibleLanes.join(', ')}], summary=${res.summary}`,
      passed: res.ok === true && res.eligibleLanes.includes('K0'),
    });
  }

  // DG-02: Refused lane blocks ONLY itself and dependents, not independent verified lanes
  {
    const refusedK1: CourtAuditVerdictV1 = { ok: false, laneId: 'K1', verdict: 'REFUSED', refusalReason: 'REFUSED_SECRET_LEAK_IN_EXPORT' };
    const res = computeDependencyAwareGoldenTurns([verdictK0, refusedK1, verdictK2]);
    const k2Eligible = res.eligibleLanes.includes('K2');
    const k1Blocked = res.blockedLanes.includes('K1');
    tests.push({
      testId: 'DG-02-INDEPENDENT-LANE-ISOLATION',
      category: 'GOLDEN_TURN_ORDER',
      name: 'Refused lane K1 blocks ONLY itself; independent lane K2 remains eligible',
      rawOutcome: `k2Eligible=${k2Eligible}, k1Blocked=${k1Blocked}, summary=${res.summary}`,
      passed: k2Eligible && k1Blocked,
    });
  }

  return tests;
}

// 6. Disposable Mutation RED Tests (5/5)
export function runCourtMutationTests(): {
  unleasedPathAdmitted: boolean;
  nonAllowlistedSecretAdmitted: boolean;
  networkCallAdmitted: boolean;
  autoActivationAdmitted: boolean;
  dependencyIsolationBypassed: boolean;
} {
  const tmpDir = join('/tmp', `fc-mut-${sha256hex(String(Math.random())).slice(0, 8)}`);
  mkdirSync(join(tmpDir, 'core', 'swarm'), { recursive: true });
  mkdirSync(join(tmpDir, 'scripts', 'swarm'), { recursive: true });

  copyFileSync(join(process.cwd(), 'core', 'swarm', 'fractal-court.ts'), join(tmpDir, 'core', 'swarm', 'fractal-court.ts'));
  copyFileSync(join(process.cwd(), 'scripts', 'swarm', 'validate-fractal-court.ts'), join(tmpDir, 'scripts', 'swarm', 'validate-fractal-court.ts'));

  const targetFile = join(tmpDir, 'core', 'swarm', 'fractal-court.ts');
  let originalCode = readFileSync(targetFile, 'utf8');

  const env = { ...process.env, FRACTAL_COURT_IS_MUTATION: '1' };

  // Mutation 1: Admit unleased path touch
  const mut1Code = originalCode.replace('if (!matched) {', 'if (false && !matched) {');
  writeFileSync(targetFile, mut1Code, 'utf8');
  const proc1 = spawnSync('bun', ['run', 'scripts/swarm/validate-fractal-court.ts'], { cwd: tmpDir, env, encoding: 'utf8' });
  const unleasedPathAdmitted = proc1.status !== 0 || (proc1.stdout + proc1.stderr).includes('FAIL');

  // Mutation 2: Admit non-allowlisted secret in K1 export
  const mut2Code = originalCode.replace('if (!isAllowlistedPublicExport(f)) {', 'if (false) {');
  writeFileSync(targetFile, mut2Code, 'utf8');
  const proc2 = spawnSync('bun', ['run', 'scripts/swarm/validate-fractal-court.ts'], { cwd: tmpDir, env, encoding: 'utf8' });
  const nonAllowlistedSecretAdmitted = proc2.status !== 0 || (proc2.stdout + proc2.stderr).includes('FAIL');

  // Mutation 3: Admit structural network call in K2 candidate
  const mut3Code = originalCode.replace('if (\n    /import\\s+.*from\\s+[\'"](http|https|net|express)[\'"]/.test(patch)', 'if (false &&');
  writeFileSync(targetFile, mut3Code, 'utf8');
  const proc3 = spawnSync('bun', ['run', 'scripts/swarm/validate-fractal-court.ts'], { cwd: tmpDir, env, encoding: 'utf8' });
  const networkCallAdmitted = proc3.status !== 0 || (proc3.stdout + proc3.stderr).includes('FAIL');

  // Mutation 4: Admit automatic runtime activation in K0 candidate
  const mut4Code = originalCode.replace('if (patch.includes(\'AUTOMATIC_RECURSIVE_SPAWN = true\')', 'if (false &&');
  writeFileSync(targetFile, mut4Code, 'utf8');
  const proc4 = spawnSync('bun', ['run', 'scripts/swarm/validate-fractal-court.ts'], { cwd: tmpDir, env, encoding: 'utf8' });
  const autoActivationAdmitted = proc4.status !== 0 || (proc4.stdout + proc4.stderr).includes('FAIL');

  // Mutation 5: Bypass dependency-aware Golden Turn isolation
  const mut5Code = originalCode.replace('else if (refusedMap.has(\'K1\')) blockedLanes.push(\'K1\');', 'else if (false) {}');
  writeFileSync(targetFile, mut5Code, 'utf8');
  const proc5 = spawnSync('bun', ['run', 'scripts/swarm/validate-fractal-court.ts'], { cwd: tmpDir, env, encoding: 'utf8' });
  const dependencyIsolationBypassed = proc5.status !== 0 || (proc5.stdout + proc5.stderr).includes('FAIL');

  writeFileSync(targetFile, originalCode, 'utf8');
  rmSync(tmpDir, { recursive: true, force: true });

  return {
    unleasedPathAdmitted,
    nonAllowlistedSecretAdmitted,
    networkCallAdmitted,
    autoActivationAdmitted,
    dependencyIsolationBypassed,
  };
}

export function runFractalCourtSuite() {
  console.log('--- ANTIGRAVITY: INDEPENDENT FRACTAL COURT INTAKE SUITE ---');

  const lsResults = runLeaseStructuralSuite();
  let lsPassed = true;
  console.log('1. Lease Freeze & Structural Diff Suite (3 tests):');
  for (const r of lsResults) {
    if (!r.passed) lsPassed = false;
    console.log(`  ${r.passed ? 'ok  ' : 'FAIL'} ${r.testId}: ${r.name} ➔ ${r.rawOutcome}`);
  }
  console.log('');

  const k1Results = runK1ExportSuite();
  let k1Passed = true;
  console.log(`2. K1 Export Candidate Audit Suite (${k1Results.length} tests):`);
  for (const r of k1Results) {
    if (!r.passed) k1Passed = false;
    console.log(`  ${r.passed ? 'ok  ' : 'FAIL'} ${r.testId}: ${r.name} ➔ ${r.rawOutcome}`);
  }
  console.log('');

  const k2Results = runK2IngestSuite();
  let k2Passed = true;
  console.log(`3. K2 Forge Ingest Candidate Audit Suite (${k2Results.length} tests):`);
  for (const r of k2Results) {
    if (!r.passed) k2Passed = false;
    console.log(`  ${r.passed ? 'ok  ' : 'FAIL'} ${r.testId}: ${r.name} ➔ ${r.rawOutcome}`);
  }
  console.log('');

  const k0Results = runK0KeystoneSuite();
  let k0Passed = true;
  console.log(`4. K0 Keystone Gate #26 G Audit Suite (${k0Results.length} tests):`);
  for (const r of k0Results) {
    if (!r.passed) k0Passed = false;
    console.log(`  ${r.passed ? 'ok  ' : 'FAIL'} ${r.testId}: ${r.name} ➔ ${r.rawOutcome}`);
  }
  console.log('');

  const dgResults = runDependencyGoldenTurnSuite();
  let dgPassed = true;
  console.log(`5. Dependency-Aware Golden Turn Ordering Suite (${dgResults.length} tests):`);
  for (const r of dgResults) {
    if (!r.passed) dgPassed = false;
    console.log(`  ${r.passed ? 'ok  ' : 'FAIL'} ${r.testId}: ${r.name} ➔ ${r.rawOutcome}`);
  }
  console.log('');

  if (process.env.FRACTAL_COURT_IS_MUTATION === '1') {
    if (!lsPassed || !k1Passed || !k2Passed || !k0Passed || !dgPassed) process.exit(1);
    return;
  }

  const muts = runCourtMutationTests();
  console.log('6. Disposable Mutation RED Tests (5/5):');
  console.log(`  ${muts.unleasedPathAdmitted ? 'ok  ' : 'FAIL'} Unleased path touch turns suite RED`);
  console.log(`  ${muts.nonAllowlistedSecretAdmitted ? 'ok  ' : 'FAIL'} Non-allowlisted secret export turns suite RED`);
  console.log(`  ${muts.networkCallAdmitted ? 'ok  ' : 'FAIL'} Structural network import call turns suite RED`);
  console.log(`  ${muts.autoActivationAdmitted ? 'ok  ' : 'FAIL'} Automatic v2/swarm activation turns suite RED`);
  console.log(`  ${muts.dependencyIsolationBypassed ? 'ok  ' : 'FAIL'} Bypassing dependency isolation turns suite RED`);
  console.log('');

  const mutsPassed = muts.unleasedPathAdmitted && muts.nonAllowlistedSecretAdmitted && muts.networkCallAdmitted && muts.autoActivationAdmitted && muts.dependencyIsolationBypassed;
  console.log(`Actual Status: ${lsPassed && k1Passed && k2Passed && k0Passed && dgPassed && mutsPassed ? 'AUDITOR READY / DOCKING RING OPEN' : 'FAILED'}`);
}

if (import.meta.main || process.argv[1]?.endsWith('validate-fractal-court.ts')) {
  runFractalCourtSuite();
}
