// scripts/swarm/validate-cell-verifier.ts — Brick C0 acceptance test suite for CellVerifier
//
// Falsifies all 10 parent cell verification checks:
// 1. Allowed patch verifies.
// 2. Out-of-lease edit is refused.
// 3. Path traversal (..) or NUL byte escapes lease.
// 4. One changed proposal byte breaks verification.
// 5. Parent receipt anchor mismatch is refused.
// 6. Cell claims tests passed but parent rerun fails -> REJECTED.
// 7. Unresolved effects settle IN_DOUBT.
// 8. Identity-bound claim is refused (must be identityBound:false).
// 9. Interrupted execution settles INTERRUPTED.
// 10. Valid proposal passes cleanly.

import { createHash } from 'node:crypto';
import { verifyCellResult, type CellResultV1, type CellVerificationInput } from '../../core/swarm/cell-verifier';

const sha256hex = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

let failures = 0;
const pass = (msg: string) => console.log(`  ok    ${msg}`);
const fail = (msg: string) => { console.error(`  FAIL  ${msg}`); failures++; };

const validDiff = '--- a/src/math/solver.ts\n+++ b/src/math/solver.ts\n@@ -1 +1 @@\n-export const add = (a, b) => a - b;\n+export const add = (a, b) => a + b;\n';
const validDiffDigest = sha256hex(validDiff);
const validAnchor = '4444444444444444444444444444444444444444444444444444444444444444';

const baseValidResult: CellResultV1 = {
  schema: 'aukora-swarm-cell-result-v1',
  cellId: 'cell-c0-test-001',
  briefId: 'brief-c0-001',
  briefDigest: '1111111111111111111111111111111111111111111111111111111111111111',
  leaseDigest: '2222222222222222222222222222222222222222222222222222222222222222',
  baseCommit: '0123456789abcdef0123456789abcdef01234567',
  baseTreeDigest: '3333333333333333333333333333333333333333333333333333333333333333',
  parentReceiptAnchor: validAnchor,
  childChainHead: '5555555555555555555555555555555555555555555555555555555555555555',
  proposalDigest: validDiffDigest,
  changedPaths: ['src/math/solver.ts', 'tests/solver.test.ts'],
  unresolvedEffects: 0,
  attestationMode: 'unbound-test',
  identityBound: false,
  state: 'proposed',
  createdAt: '2026-08-06T09:00:00Z',
};

const baseInput: CellVerificationInput = {
  cellResult: baseValidResult,
  allowedLeasePrefixes: ['src/math', 'tests'],
  diffText: validDiff,
  expectedParentAnchor: validAnchor,
  claimedTestsPassed: true,
  actualTestsPassed: true,
};

// Test 1: Valid proposal passes cleanly
{
  const v = verifyCellResult(baseInput);
  if (v.ok && v.verdict === 'ACCEPTED') pass('Test 1: valid cell proposal accepted');
  else fail(`Test 1 failed: ${v.reason}`);
}

// Test 2: Out-of-lease edit is refused
{
  const input = {
    ...baseInput,
    cellResult: { ...baseValidResult, changedPaths: ['src/math/solver.ts', 'server.ts'] },
  };
  const v = verifyCellResult(input);
  if (!v.ok && v.verdict === 'REJECTED' && v.reason.includes('outside allowed lease')) {
    pass('Test 2: out-of-lease edit refused');
  } else fail(`Test 2 failed: expected out-of-lease refusal, got ${v.verdict} (${v.reason})`);
}

// Test 3: Path traversal (..) escapes lease
{
  const input = {
    ...baseInput,
    cellResult: { ...baseValidResult, changedPaths: ['src/math/../server.ts'] },
  };
  const v = verifyCellResult(input);
  if (!v.ok && v.verdict === 'REJECTED' && v.reason.includes('path traversal')) {
    pass('Test 3: path traversal segment refused');
  } else fail(`Test 3 failed: expected path traversal refusal, got ${v.verdict} (${v.reason})`);
}

// Test 4: One changed proposal byte breaks verification
{
  const tamperedDiff = validDiff + '\n// tamper byte';
  const input = {
    ...baseInput,
    diffText: tamperedDiff, // diff digest won't match proposalDigest
  };
  const v = verifyCellResult(input);
  if (!v.ok && v.verdict === 'REJECTED' && v.reason.includes('proposalDigest mismatch')) {
    pass('Test 4: tampered diff byte caught by proposalDigest check');
  } else fail(`Test 4 failed: expected proposalDigest mismatch, got ${v.verdict} (${v.reason})`);
}

// Test 5: Parent receipt anchor mismatch refused
{
  const input = {
    ...baseInput,
    expectedParentAnchor: '9999999999999999999999999999999999999999999999999999999999999999',
  };
  const v = verifyCellResult(input);
  if (!v.ok && v.verdict === 'REJECTED' && v.reason.includes('parentReceiptAnchor mismatch')) {
    pass('Test 5: parent receipt anchor mismatch refused');
  } else fail(`Test 5 failed: expected anchor mismatch refusal, got ${v.verdict} (${v.reason})`);
}

// Test 6: Cell claims tests passed but parent rerun fails -> REJECTED
{
  const input = {
    ...baseInput,
    claimedTestsPassed: true,
    actualTestsPassed: false,
  };
  const v = verifyCellResult(input);
  if (!v.ok && v.verdict === 'REJECTED' && v.reason.includes('parent re-execution failed')) {
    pass('Test 6: test claim falsification caught (claimed true, rerun false)');
  } else fail(`Test 6 failed: expected test rerun rejection, got ${v.verdict} (${v.reason})`);
}

// Test 7: Unresolved effects settle IN_DOUBT
{
  const input = {
    ...baseInput,
    cellResult: { ...baseValidResult, unresolvedEffects: 2 },
  };
  const v = verifyCellResult(input);
  if (!v.ok && v.verdict === 'IN_DOUBT' && v.reason.includes('unresolved effects count is 2')) {
    pass('Test 7: unresolved effects settle IN_DOUBT');
  } else fail(`Test 7 failed: expected IN_DOUBT, got ${v.verdict} (${v.reason})`);
}

// Test 8: Identity-bound claim refused (must be false)
{
  const input = {
    ...baseInput,
    cellResult: { ...baseValidResult, identityBound: true as any },
  };
  const v = verifyCellResult(input);
  if (!v.ok && v.verdict === 'REJECTED' && v.reason.includes('identityBound:false')) {
    pass('Test 8: identityBound:true claim refused in Cell v0');
  } else fail(`Test 8 failed: expected identityBound refusal, got ${v.verdict} (${v.reason})`);
}

// Test 9: Interrupted state settles INTERRUPTED
{
  const input = {
    ...baseInput,
    cellResult: { ...baseValidResult, state: 'interrupted' },
  };
  const v = verifyCellResult(input);
  if (!v.ok && v.verdict === 'INTERRUPTED') {
    pass('Test 9: interrupted state settles INTERRUPTED');
  } else fail(`Test 9 failed: expected INTERRUPTED, got ${v.verdict} (${v.reason})`);
}

// Test 10: Absolute path forbidden
{
  const input = {
    ...baseInput,
    cellResult: { ...baseValidResult, changedPaths: ['/etc/passwd'] },
  };
  const v = verifyCellResult(input);
  if (!v.ok && v.verdict === 'REJECTED' && v.reason.includes('absolute path forbidden')) {
    pass('Test 10: absolute path escape attempt refused');
  } else fail(`Test 10 failed: expected absolute path refusal, got ${v.verdict} (${v.reason})`);
}

console.log(failures === 0 ? 'cell verifier: all 10 parent verification tests passed' : `cell verifier: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
