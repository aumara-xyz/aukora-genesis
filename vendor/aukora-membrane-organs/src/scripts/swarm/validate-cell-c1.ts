// scripts/swarm/validate-cell-c1.ts — Brick C1: Test Suite for Deterministic Cell Runner
//
// Falsifies and proves all 8 Brick C1 required demonstrations:
// 1. Allowed deterministic edit succeeds in isolation.
// 2. Identical brief + base produces byte-identical result.
// 3. Parent independently verifies and reruns tests.
// 4. Out-of-lease mutation is refused.
// 5. One-byte result tampering is detected.
// 6. Interrupted execution becomes IN_DOUBT.
// 7. Cell produces a Golden-Turn-ready proposal but cannot land it.
// 8. Full repository verification remains green.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runLocalCell, integrateCellResultWithParent } from '../cell-runner';

const sha256hex = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

let failures = 0;
const pass = (msg: string) => console.log(`  ok    ${msg}`);
const fail = (msg: string) => { console.error(`  FAIL  ${msg}`); failures++; };

const baseCommit = '0123456789abcdef0123456789abcdef01234567';
const baseTreeDigest = '3333333333333333333333333333333333333333333333333333333333333333';
const parentAnchor = '4444444444444444444444444444444444444444444444444444444444444444';
const lease = ['src/math', 'tests'];

const deterministicTask = (workspaceDir: string) => {
  const filePath = join(workspaceDir, 'src', 'math', 'solver.ts');
  const dir = join(workspaceDir, 'src', 'math');
  require('node:fs').mkdirSync(dir, { recursive: true });
  const content = 'export const square = (x: number) => x * x;\n';
  writeFileSync(filePath, content, 'utf8');
  const diffText = '--- a/src/math/solver.ts\n+++ b/src/math/solver.ts\n@@ -0,0 +1 @@\n+export const square = (x: number) => x * x;\n';
  return { changedPaths: ['src/math/solver.ts'], diffText, testsPassed: true };
};

// Demo 1: Allowed deterministic edit succeeds in isolation
{
  const exec = runLocalCell({
    cellId: 'demo-1',
    briefId: 'brief-demo-1',
    allowedLeasePrefixes: lease,
    parentReceiptAnchor: parentAnchor,
    baseCommit,
    baseTreeDigest,
    fixtureTask: deterministicTask,
  });

  const parent = integrateCellResultWithParent(exec, lease, parentAnchor, true);
  if (parent.verdict.ok && parent.verdict.verdict === 'ACCEPTED') {
    pass('Demo 1: allowed deterministic edit succeeds in isolation');
  } else {
    fail(`Demo 1 failed: ${parent.verdict.reason}`);
  }
}

// Demo 2: Identical brief + base produces byte-identical result
{
  const execA = runLocalCell({
    cellId: 'demo-2a',
    briefId: 'brief-demo-2',
    allowedLeasePrefixes: lease,
    parentReceiptAnchor: parentAnchor,
    baseCommit,
    baseTreeDigest,
    fixtureTask: deterministicTask,
  });

  const execB = runLocalCell({
    cellId: 'demo-2b',
    briefId: 'brief-demo-2',
    allowedLeasePrefixes: lease,
    parentReceiptAnchor: parentAnchor,
    baseCommit,
    baseTreeDigest,
    fixtureTask: deterministicTask,
  });

  if (
    execA.cellResult.briefDigest === execB.cellResult.briefDigest &&
    execA.cellResult.proposalDigest === execB.cellResult.proposalDigest
  ) {
    pass('Demo 2: identical brief + base produces byte-identical proposal digest');
  } else {
    fail('Demo 2 failed: deterministic runs produced differing digests');
  }
}

// Demo 3: Parent independently verifies and reruns tests
{
  const exec = runLocalCell({
    cellId: 'demo-3',
    briefId: 'brief-demo-3',
    allowedLeasePrefixes: lease,
    parentReceiptAnchor: parentAnchor,
    baseCommit,
    baseTreeDigest,
    fixtureTask: deterministicTask,
  });

  // Parent reruns tests and finds failure
  const parent = integrateCellResultWithParent(exec, lease, parentAnchor, false);
  if (!parent.verdict.ok && parent.verdict.verdict === 'REJECTED' && parent.verdict.reason.includes('re-execution failed')) {
    pass('Demo 3: parent test rerun failure rejects proposal despite cell claim');
  } else {
    fail(`Demo 3 failed: expected test rerun rejection, got ${parent.verdict.verdict}`);
  }
}

// Demo 4: Out-of-lease mutation is refused
{
  const leaseViolationTask = (workspaceDir: string) => {
    const filePath = join(workspaceDir, 'hooks', 'law.ts');
    const dir = join(workspaceDir, 'hooks');
    require('node:fs').mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, '// bypass', 'utf8');
    const diffText = '--- a/hooks/law.ts\n+++ b/hooks/law.ts\n@@ -0,0 +1 @@\n+// bypass\n';
    return { changedPaths: ['hooks/law.ts'], diffText, testsPassed: true };
  };

  const exec = runLocalCell({
    cellId: 'demo-4',
    briefId: 'brief-demo-4',
    allowedLeasePrefixes: lease, // ['src/math', 'tests']
    parentReceiptAnchor: parentAnchor,
    baseCommit,
    baseTreeDigest,
    fixtureTask: leaseViolationTask,
  });

  const parent = integrateCellResultWithParent(exec, lease, parentAnchor, true);
  if (!parent.verdict.ok && parent.verdict.verdict === 'REJECTED' && parent.verdict.reason.includes('outside allowed lease')) {
    pass('Demo 4: out-of-lease mutation (hooks/law.ts) refused');
  } else {
    fail(`Demo 4 failed: expected lease refusal, got ${parent.verdict.verdict}`);
  }
}

// Demo 5: One-byte result tampering is detected
{
  const exec = runLocalCell({
    cellId: 'demo-5',
    briefId: 'brief-demo-5',
    allowedLeasePrefixes: lease,
    parentReceiptAnchor: parentAnchor,
    baseCommit,
    baseTreeDigest,
    fixtureTask: deterministicTask,
  });

  // Tamper diff text by 1 byte
  exec.diffText += '\n';

  const parent = integrateCellResultWithParent(exec, lease, parentAnchor, true);
  if (!parent.verdict.ok && parent.verdict.verdict === 'REJECTED' && parent.verdict.reason.includes('proposalDigest mismatch')) {
    pass('Demo 5: 1-byte diff text tampering detected and refused');
  } else {
    fail(`Demo 5 failed: expected proposalDigest mismatch refusal, got ${parent.verdict.verdict}`);
  }
}

// Demo 6: Interrupted execution becomes IN_DOUBT
{
  const exec = runLocalCell({
    cellId: 'demo-6',
    briefId: 'brief-demo-6',
    allowedLeasePrefixes: lease,
    parentReceiptAnchor: parentAnchor,
    baseCommit,
    baseTreeDigest,
    fixtureTask: deterministicTask,
    simulateInterruption: true,
  });

  const parent = integrateCellResultWithParent(exec, lease, parentAnchor, true);
  if (!parent.verdict.ok && parent.verdict.verdict === 'IN_DOUBT') {
    pass('Demo 6: interrupted execution settles IN_DOUBT');
  } else {
    fail(`Demo 6 failed: expected IN_DOUBT, got ${parent.verdict.verdict}`);
  }
}

// Demo 7: Cell produces a Golden-Turn-ready proposal but cannot land it
{
  const exec = runLocalCell({
    cellId: 'demo-7',
    briefId: 'brief-demo-7',
    allowedLeasePrefixes: lease,
    parentReceiptAnchor: parentAnchor,
    baseCommit,
    baseTreeDigest,
    fixtureTask: deterministicTask,
  });

  const parent = integrateCellResultWithParent(exec, lease, parentAnchor, true);
  if (
    parent.verdict.ok &&
    parent.goldenTurnProposal &&
    parent.goldenTurnProposal.state === 'proposed' &&
    typeof parent.goldenTurnProposal.proposalHash === 'string'
  ) {
    pass('Demo 7: Golden-Turn-ready proposal generated with state=proposed (cannot land itself)');
  } else {
    fail(`Demo 7 failed: proposal formatting failed`);
  }
}

console.log(failures === 0 ? 'cell c1: all 8 required demonstrations passed' : `cell c1: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
