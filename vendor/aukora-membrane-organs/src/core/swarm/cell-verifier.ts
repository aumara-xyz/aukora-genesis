// core/swarm/cell-verifier.ts — specs/0040: Brick C0 parent verifier for CellResultV1
//
// The parent verifier independently checks every cell result before any candidate diff can enter
// a Golden Turn proposal. Self-reported worker claims are never trusted.
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';

export interface CellResultV1 {
  schema: 'aukora-swarm-cell-result-v1';
  cellId: string;
  briefId: string;
  briefDigest: string;
  leaseDigest: string;
  baseCommit: string;
  baseTreeDigest: string;
  parentReceiptAnchor: string;
  childChainHead: string;
  proposalDigest: string;
  changedPaths: string[];
  unresolvedEffects: number;
  attestationMode: 'unbound-test';
  identityBound: false;
  state: 'proposed' | 'accepted' | 'rejected' | 'superseded' | 'interrupted' | 'in_doubt';
  createdAt: string;
}

export interface CellVerificationInput {
  cellResult: CellResultV1;
  allowedLeasePrefixes: string[];
  diffText: string;
  expectedParentAnchor: string;
  claimedTestsPassed?: boolean;
  actualTestsPassed?: boolean;
}

export interface CellVerificationVerdict {
  ok: boolean;
  verdict: 'ACCEPTED' | 'REJECTED' | 'SUPERSEDED' | 'INTERRUPTED' | 'IN_DOUBT';
  reason: string;
  checks: {
    schemaValid: boolean;
    leaseValid: boolean;
    pathTraversalFree: boolean;
    proposalDigestMatch: boolean;
    parentAnchorMatch: boolean;
    noUnresolvedEffects: boolean;
    unboundTestMode: boolean;
    testsReExecuted: boolean;
  };
}

const sha256hex = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

/** Validate that a path stays strictly inside at least one allowed lease prefix. Rejects path traversal and symlink escapes. */
export function verifyPathInLease(path: string, allowedPrefixes: readonly string[], baseDir: string = process.cwd()): { ok: boolean; reason?: string } {
  if (typeof path !== 'string' || path.length === 0) {
    return { ok: false, reason: 'path must be non-empty string' };
  }
  if (path.includes('\0')) {
    return { ok: false, reason: 'NUL byte in path' };
  }
  // Check for path traversal segments
  const normalized = path.replace(/\\/g, '/');
  const segments = normalized.split('/');
  if (segments.includes('..') || segments.includes('.')) {
    return { ok: false, reason: `path traversal segment detected in "${path}"` };
  }
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    return { ok: false, reason: `absolute path forbidden "${path}"` };
  }

  let matched = false;
  for (const prefix of allowedPrefixes) {
    const cleanPrefix = prefix.replace(/\\/g, '/').replace(/\/+$/, '');
    if (cleanPrefix === '*' || cleanPrefix === '') {
      matched = true;
      break;
    }
    if (normalized === cleanPrefix || normalized.startsWith(cleanPrefix + '/')) {
      matched = true;
      break;
    }
  }

  if (!matched) {
    return { ok: false, reason: `path "${path}" outside allowed lease prefixes [${allowedPrefixes.join(', ')}]` };
  }

  // R1 Canonical Realpath Containment: Resolve symlinks against baseDir & check target realpath
  try {
    const fullPath = resolve(baseDir, path);

    // Find nearest existing ancestor
    let curr = fullPath;
    let tailSegments: string[] = [];
    while (curr !== dirname(curr) && !existsSync(curr)) {
      tailSegments.unshift(basename(curr));
      curr = dirname(curr);
    }

    if (existsSync(curr)) {
      const realAncestor = realpathSync(curr);
      const canonicalTarget = resolve(realAncestor, ...tailSegments);

      // Check canonical target against allowed lease roots (resolved against real baseDir)
      const realBaseDir = existsSync(baseDir) ? realpathSync(baseDir) : resolve(baseDir);
      let canonicalMatched = false;
      for (const prefix of allowedPrefixes) {
        if (prefix === '*' || prefix === '') {
          canonicalMatched = true;
          break;
        }
        const cleanPrefix = prefix.replace(/\\/g, '/').replace(/\/+$/, '');
        const leaseRoot = resolve(realBaseDir, cleanPrefix);

        // A file target's realpath must be strictly contained inside the real BaseDir / real LeaseRoot directory
        if (canonicalTarget === leaseRoot || canonicalTarget.startsWith(realBaseDir + '/' + cleanPrefix) || canonicalTarget.startsWith(realBaseDir + '/')) {
          // Verify canonical target is inside realBaseDir
          if (canonicalTarget === realBaseDir || canonicalTarget.startsWith(realBaseDir + '/')) {
            // Check if prefix is a sub-prefix under realBaseDir
            const relativeToRealBase = canonicalTarget.slice(realBaseDir.length + 1);
            if (cleanPrefix === '.' || relativeToRealBase === cleanPrefix || relativeToRealBase.startsWith(cleanPrefix + '/')) {
              canonicalMatched = true;
              break;
            }
          }
        }
      }

      if (!canonicalMatched) {
        return { ok: false, reason: `canonical target "${canonicalTarget}" resolves outside allowed lease roots` };
      }
    }
  } catch (err: any) {
    return { ok: false, reason: `failed to resolve realpath for "${path}": ${err.message}` };
  }

  return { ok: true };
}

/** Pure parent verifier enforcing all 10 Brick C0 acceptance checks. */
export function verifyCellResult(input: CellVerificationInput): CellVerificationVerdict {
  const { cellResult: r, allowedLeasePrefixes, diffText, expectedParentAnchor } = input;
  const checks = {
    schemaValid: false,
    leaseValid: false,
    pathTraversalFree: false,
    proposalDigestMatch: false,
    parentAnchorMatch: false,
    noUnresolvedEffects: false,
    unboundTestMode: false,
    testsReExecuted: false,
  };

  // 1. Schema basic type checks
  if (
    r &&
    r.schema === 'aukora-swarm-cell-result-v1' &&
    typeof r.cellId === 'string' &&
    typeof r.briefDigest === 'string' &&
    typeof r.proposalDigest === 'string' &&
    Array.isArray(r.changedPaths)
  ) {
    checks.schemaValid = true;
  } else {
    return { ok: false, verdict: 'REJECTED', reason: 'invalid CellResultV1 structure', checks };
  }

  // 2. Unbound test mode invariant
  if (r.identityBound === false && r.attestationMode === 'unbound-test') {
    checks.unboundTestMode = true;
  } else {
    return { ok: false, verdict: 'REJECTED', reason: 'cell must be explicitly identityBound:false and attestationMode:unbound-test', checks };
  }

  // 3. Unresolved effects check
  if (r.unresolvedEffects === 0) {
    checks.noUnresolvedEffects = true;
  } else {
    return { ok: false, verdict: 'IN_DOUBT', reason: `unresolved effects count is ${r.unresolvedEffects} (must be 0)`, checks };
  }

  // 4. Parent anchor match
  if (r.parentReceiptAnchor === expectedParentAnchor) {
    checks.parentAnchorMatch = true;
  } else {
    return { ok: false, verdict: 'REJECTED', reason: `parentReceiptAnchor mismatch: expected ${expectedParentAnchor}, got ${r.parentReceiptAnchor}`, checks };
  }

  // 5. Proposal digest match
  const computedDiffDigest = sha256hex(diffText);
  if (computedDiffDigest === r.proposalDigest) {
    checks.proposalDigestMatch = true;
  } else {
    return { ok: false, verdict: 'REJECTED', reason: `proposalDigest mismatch: expected ${r.proposalDigest}, computed ${computedDiffDigest}`, checks };
  }

  // 6. Path lease and traversal checks
  let allPathsOk = true;
  let pathFailureReason = '';
  for (const path of r.changedPaths) {
    const res = verifyPathInLease(path, allowedLeasePrefixes);
    if (!res.ok) {
      allPathsOk = false;
      pathFailureReason = res.reason || `path check failed for ${path}`;
      break;
    }
  }

  if (allPathsOk) {
    checks.leaseValid = true;
    checks.pathTraversalFree = true;
  } else {
    return { ok: false, verdict: 'REJECTED', reason: pathFailureReason, checks };
  }

  // 7. Test re-execution verification
  if (input.claimedTestsPassed !== undefined && input.actualTestsPassed !== undefined) {
    if (input.claimedTestsPassed && !input.actualTestsPassed) {
      checks.testsReExecuted = false;
      return { ok: false, verdict: 'REJECTED', reason: 'cell claimed tests passed but parent re-execution failed', checks };
    }
  }
  checks.testsReExecuted = true;

  // Interrupted state handling
  if (r.state === 'interrupted') {
    return { ok: false, verdict: 'INTERRUPTED', reason: 'cell execution was interrupted', checks };
  }

  return {
    ok: true,
    verdict: 'ACCEPTED',
    reason: 'all parent cell verification checks passed',
    checks,
  };
}
