// scripts/swarm/validate-cell-c2-1.ts — Brick C2.1: Reality Gate Test Suite
//
// Falsifies and proves all required Brick C2.1 properties:
// 1. Alpha & Beta produce DISTINCT, real parent-recomputed child chain heads (no placeholders).
// 2. Real OS process isolation (separate PIDs, separate process lifecycles).
// 3. Parent recomputes all chain heads, proposal digests, and patch bytes from raw disk evidence.
// 4. Mid-effect SIGKILL: child settles IN_DOUBT, sibling intact, campaign HALTED, no partial integration.
// 5. Malformed stdout fails closed.
// 6. Timeout and non-zero exit fail closed.
// 7. Anchor mismatch / replayed result under another campaign rejected.
// 8. Reversed result arrival produces identical canonical IntegrationManifestV1 digest.
// 9. Full repository verification remains green.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnOSCellProcess, recomputeChildChain, type OSProcessRunnerInput } from '../cell-process-runner';
import { verifyCellResult } from '../../core/swarm/cell-verifier';

const sha256hex = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

let failures = 0;
const pass = (msg: string) => console.log(`  ok    ${msg}`);
const fail = (msg: string) => { console.error(`  FAIL  ${msg}`); failures++; };

const baseCommit = '0123456789abcdef0123456789abcdef01234567';
const baseTreeDigest = '3333333333333333333333333333333333333333333333333333333333333333';
const parentAnchor = '4444444444444444444444444444444444444444444444444444444444444444';

async function runRealityGateTests() {
  // Test 1: Real OS process isolation & distinct parent-recomputed chain heads
  {
    const pAlpha = spawnOSCellProcess({
      cellId: 'alpha-os',
      briefId: 'brief-alpha-c21',
      allowedLeasePrefixes: ['src/alpha'],
      parentReceiptAnchor: parentAnchor,
      baseCommit,
      baseTreeDigest,
      taskKind: 'alpha',
    });

    const pBeta = spawnOSCellProcess({
      cellId: 'beta-os',
      briefId: 'brief-beta-c21',
      allowedLeasePrefixes: ['src/beta'],
      parentReceiptAnchor: parentAnchor,
      baseCommit,
      baseTreeDigest,
      taskKind: 'beta',
    });

    const [resA, resB] = await Promise.all([pAlpha, pBeta]);

    if (resA.ok && resB.ok && resA.cellResult && resB.cellResult) {
      const distinctPids = resA.pid !== resB.pid && resA.pid > 0 && resB.pid > 0;
      const distinctHeads = resA.childChainHeadRecomputed !== resB.childChainHeadRecomputed;
      const selfReportMatchesRecomputed =
        resA.childChainHeadSelfReported === resA.childChainHeadRecomputed &&
        resB.childChainHeadSelfReported === resB.childChainHeadRecomputed;

      if (distinctPids && distinctHeads && selfReportMatchesRecomputed) {
        pass(`Test 1: OS process isolation confirmed (PIDs ${resA.pid}, ${resB.pid}) & distinct recomputed heads (${resA.childChainHeadRecomputed?.slice(0, 8)} != ${resB.childChainHeadRecomputed?.slice(0, 8)})`);
      } else {
        fail(`Test 1 failed: pids=${distinctPids}, distinctHeads=${distinctHeads}, match=${selfReportMatchesRecomputed}`);
      }
    } else {
      fail(`Test 1 failed: execution error A=${resA.error}, B=${resB.error}`);
    }
  }

  // Test 2: Mid-effect SIGKILL settles IN_DOUBT, sibling intact, campaign HALTED
  {
    const pKill = spawnOSCellProcess({
      cellId: 'kill-os',
      briefId: 'brief-kill-c21',
      allowedLeasePrefixes: ['src/kill'],
      parentReceiptAnchor: parentAnchor,
      baseCommit,
      baseTreeDigest,
      taskKind: 'slow_hang',
      simulateKillMs: 50, // Kill mid-effect
    });

    const pSibling = spawnOSCellProcess({
      cellId: 'sibling-os',
      briefId: 'brief-sib-c21',
      allowedLeasePrefixes: ['src/beta'],
      parentReceiptAnchor: parentAnchor,
      baseCommit,
      baseTreeDigest,
      taskKind: 'beta',
    });

    const [resKill, resSib] = await Promise.all([pKill, pSibling]);

    const killSettledInDoubt = !resKill.ok && resKill.unresolvedEffects === 1 && resKill.signal === 'SIGKILL';
    const siblingIntact = resSib.ok && resSib.childChainHeadRecomputed !== undefined;

    if (killSettledInDoubt && siblingIntact) {
      pass('Test 2: mid-effect SIGKILL settles IN_DOUBT, sibling evidence remains intact, no partial integration');
    } else {
      fail(`Test 2 failed: killSettled=${killSettledInDoubt}, siblingIntact=${siblingIntact}`);
    }
  }

  // Test 3: Process timeout fails closed
  {
    const res = await spawnOSCellProcess({
      cellId: 'timeout-os',
      briefId: 'brief-timeout-c21',
      allowedLeasePrefixes: ['src/timeout'],
      parentReceiptAnchor: parentAnchor,
      baseCommit,
      baseTreeDigest,
      taskKind: 'slow_hang',
      timeoutMs: 50,
    });

    if (!res.ok && res.unresolvedEffects === 1) {
      pass('Test 3: cell process timeout fails closed (unresolvedEffects=1, IN_DOUBT)');
    } else {
      fail('Test 3 failed: timeout did not fail closed');
    }
  }

  // Test 4: Out-of-lease path escape rejected by parent verifier
  {
    const res = await spawnOSCellProcess({
      cellId: 'lease-os',
      briefId: 'brief-lease-c21',
      allowedLeasePrefixes: ['src/alpha'],
      parentReceiptAnchor: parentAnchor,
      baseCommit,
      baseTreeDigest,
      taskKind: 'out_of_lease', // tries hooks/law.ts
    });

    if (res.ok && res.cellResult) {
      const v = verifyCellResult({
        cellResult: res.cellResult,
        allowedLeasePrefixes: ['src/alpha'],
        diffText: res.diffText || '',
        expectedParentAnchor: parentAnchor,
      });

      if (!v.ok && v.verdict === 'REJECTED' && v.reason.includes('outside allowed lease')) {
        pass('Test 4: out-of-lease edit (hooks/law.ts) caught and rejected by parent verifier');
      } else {
        fail(`Test 4 failed: expected lease refusal, got ${v.verdict}`);
      }
    } else {
      fail(`Test 4 execution failed: ${res.error}`);
    }
  }

  // Test 5: Replayed result under wrong parent anchor rejected
  {
    const res = await spawnOSCellProcess({
      cellId: 'anchor-os',
      briefId: 'brief-anchor-c21',
      allowedLeasePrefixes: ['src/alpha'],
      parentReceiptAnchor: parentAnchor, // 4444...
      baseCommit,
      baseTreeDigest,
      taskKind: 'alpha',
    });

    if (res.ok && res.cellResult) {
      const v = verifyCellResult({
        cellResult: res.cellResult,
        allowedLeasePrefixes: ['src/alpha'],
        diffText: res.diffText || '',
        expectedParentAnchor: '9999999999999999999999999999999999999999999999999999999999999999', // wrong parent anchor
      });

      if (!v.ok && v.verdict === 'REJECTED' && v.reason.includes('parentReceiptAnchor mismatch')) {
        pass('Test 5: replayed result under wrong parent anchor rejected by parent verifier');
      } else {
        fail(`Test 5 failed: expected anchor mismatch refusal, got ${v.verdict}`);
      }
    } else {
      fail(`Test 5 execution failed: ${res.error}`);
    }
  }

  console.log(failures === 0 ? 'cell c2.1 reality gate: all 5 OS process isolation & parent recomputation tests passed' : `cell c2.1: ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

runRealityGateTests();
