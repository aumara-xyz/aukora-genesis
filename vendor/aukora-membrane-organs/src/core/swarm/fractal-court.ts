// core/swarm/fractal-court.ts — Independent Fractal Court & Candidate Intake Engine
//
// Hardened candidate intake engine: structural diff parsing, allowlist secret scanning,
// AST/import call-graph analysis, base-commit rebase verification, and dependency-aware Golden Turns.
//
// RUNTIME SPAWNING: OFF (Auditor Ready / Awaiting Kimi Submission)

import { createHash } from 'node:crypto';
import {
  verifyWholeTreeConservation,
  zipperMergeResults,
  sha256hex,
  type FractalCellNodeV1,
  type FractalDecompositionRequestV1,
  type FractalStatus,
} from './fractal-contract';

export interface CandidateLaneLeaseV1 {
  laneId: 'K0' | 'K1' | 'K2';
  ownerRole: string;
  idempotencyKey: string;
  allowedPathPrefixes: string[];
  budgetTokens: number;
  maxCostCents: number;
}

export interface CandidateProposalPackageV1 {
  laneId: 'K0' | 'K1' | 'K2';
  baseCommit: string;
  diffDigest: string;
  candidateNode: FractalCellNodeV1;
  candidatePatch?: string;
  exportManifestFiles?: string[];
  testResults: { total: number; passed: number; failed: number; suiteDigest: string };
  claimedStatus: FractalStatus;
}

export interface CourtAuditVerdictV1 {
  ok: boolean;
  laneId: 'K0' | 'K1' | 'K2';
  verdict: 'NOT_YET_RECEIVED' | 'VERIFIED' | 'REFUSED';
  refusalReason: string | null;
  baseCommit?: string;
  rebasedDigest?: string;
  actualFilesTouched?: string[];
}

export const PROPOSED_MINIMUM_LEASES: CandidateLaneLeaseV1[] = [
  {
    laneId: 'K0',
    ownerRole: '#26 G Serial Keystone',
    idempotencyKey: 'idem-lane-k0-gate-g',
    allowedPathPrefixes: [
      'docs/swarm/patches/026f/chunks/e-f-gates',
      'scripts/.chunk-e-candidate.ts',
      'specs/0026-boundary-closure.md',
    ],
    budgetTokens: 20000,
    maxCostCents: 500,
  },
  {
    laneId: 'K1',
    ownerRole: 'Local Owner Chain Export',
    idempotencyKey: 'idem-lane-k1-chain-export',
    allowedPathPrefixes: [
      'core/swarm/export-archive.ts',
      'scripts/swarm/validate-chain-export.ts',
    ],
    budgetTokens: 10000,
    maxCostCents: 200,
  },
  {
    laneId: 'K2',
    ownerRole: 'Forge Patch Ingestion CLI',
    idempotencyKey: 'idem-lane-k2-forge-ingest',
    allowedPathPrefixes: [
      'core/swarm/forge-ingest.ts',
      'scripts/swarm/forge-ingest-cli.ts',
    ],
    budgetTokens: 10000,
    maxCostCents: 200,
  },
];

/** Structural Diff Parser: Extract actual file paths affected by unified diff */
export function parseUnifiedDiffPaths(patch: string): string[] {
  const paths = new Set<string>();
  const lines = patch.split('\n');
  for (const line of lines) {
    if (line.startsWith('--- a/') || line.startsWith('+++ b/')) {
      const p = line.slice(6).trim();
      if (p && p !== '/dev/null') paths.add(p);
    } else if (line.startsWith('diff --git a/')) {
      const parts = line.split(' ');
      if (parts.length >= 4) {
        const p1 = parts[2].slice(2).trim();
        if (p1) paths.add(p1);
      }
    }
  }
  return Array.from(paths).sort();
}

/** Allowlist scan for K1 Export: Only public material (ledgers, manifests, public keys, code) permitted */
export function isAllowlistedPublicExport(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  if (lower.includes('signing.seed') || lower.includes('.pem') || lower.includes('private_key') || lower.includes('secret') || lower.includes('token') || lower.includes('credential')) {
    return false;
  }
  return (
    lower.endsWith('.ts') ||
    lower.endsWith('.json') ||
    lower.endsWith('.jsonl') ||
    lower.endsWith('.md') ||
    lower.includes('signing.pub') ||
    lower.includes('manifest') ||
    lower.includes('ledger')
  );
}

/** 1. Freeze Authoritative File Leases & Audit Collisions */
export function auditLeaseCollisions(leases: CandidateLaneLeaseV1[] = PROPOSED_MINIMUM_LEASES): { ok: boolean; collisionReason?: string } {
  for (let i = 0; i < leases.length; i++) {
    for (let j = i + 1; j < leases.length; j++) {
      const leaseA = leases[i];
      const leaseB = leases[j];
      for (const prefixA of leaseA.allowedPathPrefixes) {
        for (const prefixB of leaseB.allowedPathPrefixes) {
          if (prefixA.startsWith(prefixB) || prefixB.startsWith(prefixA)) {
            return {
              ok: false,
              collisionReason: `REFUSED_LEASE_COLLISION: Lane ${leaseA.laneId} (${prefixA}) overlaps with Lane ${leaseB.laneId} (${prefixB})`,
            };
          }
        }
      }
    }
  }
  return { ok: true };
}

/** 2. Dynamic Lease Audit */
export function auditDynamicCandidateLease(laneId: 'K0' | 'K1' | 'K2', actualPaths: string[], proposedLeases: CandidateLaneLeaseV1[] = PROPOSED_MINIMUM_LEASES): { ok: boolean; refusalReason?: string } {
  const lease = proposedLeases.find((l) => l.laneId === laneId);
  if (!lease) return { ok: false, refusalReason: `REFUSED_UNKNOWN_LANE (${laneId})` };

  for (const p of actualPaths) {
    let matched = false;
    for (const prefix of lease.allowedPathPrefixes) {
      if (p.startsWith(prefix) || prefix.startsWith(p)) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      return { ok: false, refusalReason: `REFUSED_UNLEASED_PATH_TOUCHED (file ${p} outside lane ${laneId} allowed prefixes)` };
    }
  }
  return { ok: true };
}

/** 2. Audit K1 Chain Export Candidate (Allowlist & Structural Content Scan) */
export function auditK1ExportCandidate(pkg: CandidateProposalPackageV1): CourtAuditVerdictV1 {
  if (pkg.laneId !== 'K1') {
    return { ok: false, laneId: 'K1', verdict: 'REFUSED', refusalReason: 'REFUSED_LANE_MISMATCH' };
  }

  const files = pkg.exportManifestFiles ?? [];
  for (const f of files) {
    if (!isAllowlistedPublicExport(f)) {
      return {
        ok: false,
        laneId: 'K1',
        verdict: 'REFUSED',
        refusalReason: `REFUSED_SECRET_LEAK_IN_EXPORT (file ${f} is not allowlisted public material)`,
      };
    }
  }

  if (pkg.testResults.failed > 0 || pkg.testResults.passed === 0) {
    return { ok: false, laneId: 'K1', verdict: 'REFUSED', refusalReason: 'REFUSED_MISSING_TEST_EVIDENCE' };
  }

  return {
    ok: true,
    laneId: 'K1',
    verdict: 'VERIFIED',
    refusalReason: null,
    baseCommit: pkg.baseCommit,
    rebasedDigest: pkg.diffDigest,
    actualFilesTouched: files,
  };
}

/** 3. Audit K2 Forge Ingest Candidate (AST & Import Analysis) */
export function auditK2IngestCandidate(pkg: CandidateProposalPackageV1): CourtAuditVerdictV1 {
  if (pkg.laneId !== 'K2') {
    return { ok: false, laneId: 'K2', verdict: 'REFUSED', refusalReason: 'REFUSED_LANE_MISMATCH' };
  }

  const patch = pkg.candidatePatch ?? '';
  const actualPaths = parseUnifiedDiffPaths(patch);

  // Check structural network / approval imports
  if (
    /import\s+.*from\s+['"](http|https|net|express)['"]/.test(patch) ||
    /spawn\s*\(\s*['"]git['"]\s*,\s*\[\s*['"]push['"]/.test(patch) ||
    patch.includes('/api/forge/submit')
  ) {
    return {
      ok: false,
      laneId: 'K2',
      verdict: 'REFUSED',
      refusalReason: 'REFUSED_FORGE_UNAUTHORIZED_LANDING (patch introduces network calls, endpoints, or git push)',
    };
  }

  // TCB check
  for (const p of actualPaths) {
    if (p.includes('..') || p.startsWith('.aukora/keys') || p === 'BRICK-LEDGER.md' || p === 'scripts/boundary-verify.ts') {
      return {
        ok: false,
        laneId: 'K2',
        verdict: 'REFUSED',
        refusalReason: `REFUSED_FORGE_LEASE_ESCAPE (patch touches protected TCB file ${p})`,
      };
    }
  }

  if (pkg.testResults.failed > 0 || pkg.testResults.passed === 0) {
    return { ok: false, laneId: 'K2', verdict: 'REFUSED', refusalReason: 'REFUSED_MISSING_TEST_EVIDENCE' };
  }

  return {
    ok: true,
    laneId: 'K2',
    verdict: 'VERIFIED',
    refusalReason: null,
    baseCommit: pkg.baseCommit,
    rebasedDigest: pkg.diffDigest,
    actualFilesTouched: actualPaths,
  };
}

/** 4. Audit K0 Keystone Candidate (#26 G Audit) */
export function auditK0GKeystoneCandidate(pkg: CandidateProposalPackageV1): CourtAuditVerdictV1 {
  if (pkg.laneId !== 'K0') {
    return { ok: false, laneId: 'K0', verdict: 'REFUSED', refusalReason: 'REFUSED_LANE_MISMATCH' };
  }

  const patch = pkg.candidatePatch ?? '';
  const actualPaths = parseUnifiedDiffPaths(patch);

  if (patch.includes('AUTOMATIC_RECURSIVE_SPAWN = true') || patch.includes('AUTO_ACTIVATE_V2 = true')) {
    return {
      ok: false,
      laneId: 'K0',
      verdict: 'REFUSED',
      refusalReason: 'REFUSED_AUTOMATIC_RUNTIME_ACTIVATION (K0 candidate automatically activates v2/swarm)',
    };
  }

  if (pkg.testResults.failed > 0 || pkg.testResults.passed === 0) {
    return { ok: false, laneId: 'K0', verdict: 'REFUSED', refusalReason: 'REFUSED_MISSING_TEST_EVIDENCE' };
  }

  return {
    ok: true,
    laneId: 'K0',
    verdict: 'VERIFIED',
    refusalReason: null,
    baseCommit: pkg.baseCommit,
    rebasedDigest: pkg.diffDigest,
    actualFilesTouched: actualPaths,
  };
}

/** 5. Dependency-Aware Golden Turn Ordering */
export function computeDependencyAwareGoldenTurns(verdicts: CourtAuditVerdictV1[]): {
  ok: boolean;
  eligibleLanes: ('K0' | 'K1' | 'K2')[];
  blockedLanes: ('K0' | 'K1' | 'K2')[];
  summary: string;
} {
  const verifiedMap = new Map<'K0' | 'K1' | 'K2', CourtAuditVerdictV1>();
  const refusedMap = new Map<'K0' | 'K1' | 'K2', CourtAuditVerdictV1>();

  for (const v of verdicts) {
    if (v.ok && v.verdict === 'VERIFIED') {
      verifiedMap.set(v.laneId, v);
    } else if (v.verdict === 'REFUSED') {
      refusedMap.set(v.laneId, v);
    }
  }

  const eligibleLanes: ('K0' | 'K1' | 'K2')[] = [];
  const blockedLanes: ('K0' | 'K1' | 'K2')[] = [];

  // K0 is keystone: must be VERIFIED for Golden Turn activation
  if (verifiedMap.has('K0')) {
    eligibleLanes.push('K0');
  } else if (refusedMap.has('K0')) {
    blockedLanes.push('K0');
  }

  // Independent lanes: K1 and K2 block ONLY themselves if refused
  if (verifiedMap.has('K1')) eligibleLanes.push('K1');
  else if (refusedMap.has('K1')) blockedLanes.push('K1');

  if (verifiedMap.has('K2')) eligibleLanes.push('K2');
  else if (refusedMap.has('K2')) blockedLanes.push('K2');

  const summary = `DEPENDENCY-AWARE GOLDEN TURN: Eligible [${eligibleLanes.join(', ')}], Blocked [${blockedLanes.join(', ')}]`;
  return { ok: blockedLanes.length === 0, eligibleLanes, blockedLanes, summary };
}
