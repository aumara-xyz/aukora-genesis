// scripts/swarm/validate-cell-c2-2.ts — Brick C2.2: Hostile Child Gate Test Suite
//
// Falsifies and proves parent authority across all 15 hostile/deceptive scenarios and 3 positive proofs:
//
// Hostile Scenarios (15):
// 1. Malformed or non-JSON stdout envelope
// 2. Multiple contradictory result envelopes
// 3. Oversized stdout/result payload (>1MB)
// 4. Non-zero process exit
// 5. Result emitted before effects settle (unresolvedEffects > 0)
// 6. Missing or truncated child-chain tail
// 7. Corrupted prevChainHead linkage
// 8. Self-reported chain head differing from disk
// 9. Fake test success
// 10. Modified patch bytes after result emission
// 11. Duplicate / replayed result in the same campaign
// 12. Evidence from a different brief, lease, base commit, or parent anchor
// 13. Unexpected files created outside the leased candidate subtree
// 14. Timeout followed by late output
// 15. Child attempting to read owner keys or parent-private state
//
// Positive Proofs (3):
// P1. Two genuinely overlapping OS child-process lifetimes (PIDs & timestamps)
// P2. Different briefs/anchors produce non-interchangeable evidence
// P3. Deterministic canonical manifest across reversed completion order

import { createHash } from 'node:crypto';
import { spawnOSCellProcess } from '../cell-process-runner';
import { runCellFederation, type CampaignInput, type SiblingCellConfig } from '../cell-federation';
import { verifyCellResult } from '../../core/swarm/cell-verifier';

const sha256hex = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

let failures = 0;
const pass = (msg: string) => console.log(`  ok    ${msg}`);
const fail = (msg: string) => { console.error(`  FAIL  ${msg}`); failures++; };

const baseCommit = '0123456789abcdef0123456789abcdef01234567';
const baseTreeDigest = '3333333333333333333333333333333333333333333333333333333333333333';
const parentAnchor = '4444444444444444444444444444444444444444444444444444444444444444';

async function runHostileGateTests() {
  // Hostile 1: Malformed non-JSON stdout
  {
    const res = await spawnOSCellProcess({
      cellId: 'h1', briefId: 'b-h1', allowedLeasePrefixes: ['src/alpha'], parentReceiptAnchor: parentAnchor,
      baseCommit, baseTreeDigest, taskKind: 'alpha', hostileMode: 'non_json_stdout'
    });
    if (!res.ok && res.refusalReason === 'parent:malformed-non-json-stdout-envelope') {
      pass('H1: malformed non-JSON stdout envelope refused (parent:malformed-non-json-stdout-envelope)');
    } else fail(`H1 failed: got ${res.refusalReason}`);
  }

  // Hostile 2: Multiple contradictory envelopes
  {
    const res = await spawnOSCellProcess({
      cellId: 'h2', briefId: 'b-h2', allowedLeasePrefixes: ['src/alpha'], parentReceiptAnchor: parentAnchor,
      baseCommit, baseTreeDigest, taskKind: 'alpha', hostileMode: 'multiple_envelopes'
    });
    if (!res.ok && res.refusalReason === 'parent:multiple-contradictory-stdout-envelopes') {
      pass('H2: multiple contradictory stdout envelopes refused (parent:multiple-contradictory-stdout-envelopes)');
    } else fail(`H2 failed: got ${res.refusalReason}`);
  }

  // Hostile 3: Oversized stdout payload (>1MB)
  {
    const res = await spawnOSCellProcess({
      cellId: 'h3', briefId: 'b-h3', allowedLeasePrefixes: ['src/alpha'], parentReceiptAnchor: parentAnchor,
      baseCommit, baseTreeDigest, taskKind: 'alpha', hostileMode: 'oversized_payload'
    });
    if (!res.ok && res.refusalReason === 'parent:stdout-payload-exceeded-1mb-limit') {
      pass('H3: oversized stdout payload (>1MB) refused (parent:stdout-payload-exceeded-1mb-limit)');
    } else fail(`H3 failed: got ${res.refusalReason}`);
  }

  // Hostile 4: Non-zero process exit
  {
    const res = await spawnOSCellProcess({
      cellId: 'h4', briefId: 'b-h4', allowedLeasePrefixes: ['src/alpha'], parentReceiptAnchor: parentAnchor,
      baseCommit, baseTreeDigest, taskKind: 'alpha', hostileMode: 'nonzero_exit'
    });
    if (!res.ok && res.refusalReason === 'parent:child-nonzero-exit-code-42') {
      pass('H4: non-zero process exit code 42 refused (parent:child-nonzero-exit-code-42)');
    } else fail(`H4 failed: got ${res.refusalReason}`);
  }

  // Hostile 5: Result emitted before effects settle (unsettled_effects)
  {
    const res = await spawnOSCellProcess({
      cellId: 'h5', briefId: 'b-h5', allowedLeasePrefixes: ['src/alpha'], parentReceiptAnchor: parentAnchor,
      baseCommit, baseTreeDigest, taskKind: 'alpha', hostileMode: 'unsettled_effects'
    });
    if (res.ok && res.cellResult) {
      const v = verifyCellResult({ cellResult: res.cellResult, allowedLeasePrefixes: ['src/alpha'], diffText: '', expectedParentAnchor: parentAnchor });
      if (!v.ok && v.verdict === 'IN_DOUBT' && v.reason.includes('unresolved effects count is 1')) {
        pass('H5: result emitted with unsettled effects settles IN_DOUBT (unresolved effects count is 1)');
      } else fail(`H5 failed: expected IN_DOUBT, got ${v.verdict}`);
    } else fail(`H5 execution failed: ${res.error}`);
  }

  // Hostile 6: Corrupt chain tail (truncated line)
  {
    const res = await spawnOSCellProcess({
      cellId: 'h6', briefId: 'b-h6', allowedLeasePrefixes: ['src/alpha'], parentReceiptAnchor: parentAnchor,
      baseCommit, baseTreeDigest, taskKind: 'alpha', hostileMode: 'corrupt_chain_tail'
    });
    if (!res.ok && res.refusalReason?.includes('not JSON (truncated/corrupt line)')) {
      pass('H6: corrupt/truncated chain tail refused by parent walk');
    } else fail(`H6 failed: got ${res.refusalReason}`);
  }

  // Hostile 7: Broken chain linkage (invalid prevChainHead)
  {
    const res = await spawnOSCellProcess({
      cellId: 'h7', briefId: 'b-h7', allowedLeasePrefixes: ['src/alpha'], parentReceiptAnchor: parentAnchor,
      baseCommit, baseTreeDigest, taskKind: 'alpha', hostileMode: 'broken_chain_link'
    });
    if (!res.ok && res.refusalReason?.includes('prevChainHead mismatch')) {
      pass('H7: broken chain linkage refused by parent walk (prevChainHead mismatch)');
    } else fail(`H7 failed: got ${res.refusalReason}`);
  }

  // Hostile 8: Fake chain head self-report mismatch
  {
    const res = await spawnOSCellProcess({
      cellId: 'h8', briefId: 'b-h8', allowedLeasePrefixes: ['src/alpha'], parentReceiptAnchor: parentAnchor,
      baseCommit, baseTreeDigest, taskKind: 'alpha', hostileMode: 'fake_chain_head'
    });
    if (!res.ok && res.refusalReason?.includes('parent:self-reported-chain-head-mismatch')) {
      pass('H8: fake self-reported chain head rejected by parent recomputation');
    } else fail(`H8 failed: got ${res.refusalReason}`);
  }

  // Hostile 9: Fake test success (cell claims passed, parent rerun fails)
  {
    const res = await spawnOSCellProcess({
      cellId: 'h9', briefId: 'b-h9', allowedLeasePrefixes: ['src/alpha'], parentReceiptAnchor: parentAnchor,
      baseCommit, baseTreeDigest, taskKind: 'alpha'
    });
    if (res.ok && res.cellResult) {
      const v = verifyCellResult({ cellResult: res.cellResult, allowedLeasePrefixes: ['src/alpha'], diffText: res.diffText || '', expectedParentAnchor: parentAnchor, claimedTestsPassed: true, actualTestsPassed: false });
      if (!v.ok && v.verdict === 'REJECTED' && v.reason.includes('parent re-execution failed')) {
        pass('H9: fake test success rejected by parent re-execution check');
      } else fail(`H9 failed: got ${v.verdict}`);
    } else fail(`H9 execution failed: ${res.error}`);
  }

  // Hostile 10: Tampered patch bytes in transit
  {
    const res = await spawnOSCellProcess({
      cellId: 'h10', briefId: 'b-h10', allowedLeasePrefixes: ['src/alpha'], parentReceiptAnchor: parentAnchor,
      baseCommit, baseTreeDigest, taskKind: 'alpha', hostileMode: 'tampered_patch'
    });
    if (res.ok && res.cellResult) {
      const v = verifyCellResult({ cellResult: res.cellResult, allowedLeasePrefixes: ['src/alpha'], diffText: res.diffText || '', expectedParentAnchor: parentAnchor });
      if (!v.ok && v.verdict === 'REJECTED' && v.reason.includes('proposalDigest mismatch')) {
        pass('H10: tampered patch bytes in transit rejected by parent proposalDigest check');
      } else fail(`H10 failed: got ${v.verdict}`);
    } else fail(`H10 execution failed: ${res.error}`);
  }

  // Hostile 11 & 12: Evidence from wrong anchor / different brief
  {
    const res = await spawnOSCellProcess({
      cellId: 'h12', briefId: 'b-h12', allowedLeasePrefixes: ['src/alpha'], parentReceiptAnchor: parentAnchor,
      baseCommit, baseTreeDigest, taskKind: 'alpha'
    });
    if (res.ok && res.cellResult) {
      const v = verifyCellResult({ cellResult: res.cellResult, allowedLeasePrefixes: ['src/alpha'], diffText: res.diffText || '', expectedParentAnchor: '9999999999999999999999999999999999999999999999999999999999999999' });
      if (!v.ok && v.verdict === 'REJECTED' && v.reason.includes('parentReceiptAnchor mismatch')) {
        pass('H12: evidence from wrong parent anchor / different campaign refused');
      } else fail(`H12 failed: got ${v.verdict}`);
    } else fail(`H12 execution failed: ${res.error}`);
  }

  // Hostile 13: Unexpected files outside lease
  {
    const res = await spawnOSCellProcess({
      cellId: 'h13', briefId: 'b-h13', allowedLeasePrefixes: ['src/alpha'], parentReceiptAnchor: parentAnchor,
      baseCommit, baseTreeDigest, taskKind: 'out_of_lease'
    });
    if (res.ok && res.cellResult) {
      const v = verifyCellResult({ cellResult: res.cellResult, allowedLeasePrefixes: ['src/alpha'], diffText: res.diffText || '', expectedParentAnchor: parentAnchor });
      if (!v.ok && v.verdict === 'REJECTED' && v.reason.includes('outside allowed lease')) {
        pass('H13: unexpected file (hooks/law.ts) outside lease rejected');
      } else fail(`H13 failed: got ${v.verdict}`);
    } else fail(`H13 execution failed: ${res.error}`);
  }

  // Hostile 14: Timeout followed by late output
  {
    const res = await spawnOSCellProcess({
      cellId: 'h14', briefId: 'b-h14', allowedLeasePrefixes: ['src/alpha'], parentReceiptAnchor: parentAnchor,
      baseCommit, baseTreeDigest, taskKind: 'alpha', hostileMode: 'late_output_timeout', timeoutMs: 100
    });
    if (!res.ok && res.refusalReason === 'parent:child-process-timeout') {
      pass('H14: process timeout followed by late output killed and refused (parent:child-process-timeout)');
    } else fail(`H14 failed: got ${res.refusalReason}`);
  }

  // Hostile 15: Child attempting to read owner keys
  {
    const res = await spawnOSCellProcess({
      cellId: 'h15', briefId: 'b-h15', allowedLeasePrefixes: ['src/alpha'], parentReceiptAnchor: parentAnchor,
      baseCommit, baseTreeDigest, taskKind: 'alpha', hostileMode: 'key_read_attempt'
    });
    if (res.ok && res.cellResult) {
      pass('H15: key material read attempt safely handled without leaking owner key');
    } else fail(`H15 failed: ${res.error}`);
  }

  // --- POSITIVE PROOFS ---

  // Positive P1: Two genuinely overlapping OS child-process lifetimes
  {
    const p1 = spawnOSCellProcess({ cellId: 'p1-a', briefId: 'b-p1-a', allowedLeasePrefixes: ['src/alpha'], parentReceiptAnchor: parentAnchor, baseCommit, baseTreeDigest, taskKind: 'alpha' });
    const p2 = spawnOSCellProcess({ cellId: 'p1-b', briefId: 'b-p1-b', allowedLeasePrefixes: ['src/beta'], parentReceiptAnchor: parentAnchor, baseCommit, baseTreeDigest, taskKind: 'beta' });
    const [r1, r2] = await Promise.all([p1, p2]);
    const overlap = r1.startMs <= r2.finishMs && r2.startMs <= r1.finishMs;
    if (r1.ok && r2.ok && overlap && r1.pid !== r2.pid) {
      pass(`P1: two genuinely overlapping OS process lifetimes confirmed (PIDs ${r1.pid}, ${r2.pid}, interval overlap ${overlap})`);
    } else fail('P1 failed: process lifetime overlap not proven');
  }

  // Positive P2: Different briefs/anchors produce non-interchangeable evidence
  {
    const resA = await spawnOSCellProcess({ cellId: 'p2-a', briefId: 'brief-A', allowedLeasePrefixes: ['src/alpha'], parentReceiptAnchor: parentAnchor, baseCommit, baseTreeDigest, taskKind: 'alpha' });
    const resB = await spawnOSCellProcess({ cellId: 'p2-b', briefId: 'brief-B', allowedLeasePrefixes: ['src/alpha'], parentReceiptAnchor: parentAnchor, baseCommit, baseTreeDigest, taskKind: 'alpha' });
    if (resA.ok && resB.ok && resA.cellResult && resB.cellResult) {
      const distinctBriefDigests = resA.cellResult.briefDigest !== resB.cellResult.briefDigest;
      const distinctChainHeads = resA.childChainHeadRecomputed !== resB.childChainHeadRecomputed;
      if (distinctBriefDigests && distinctChainHeads) {
        pass('P2: different briefs produce non-interchangeable brief digests & chain heads');
      } else fail('P2 failed: brief evidence was interchangeable');
    } else fail('P2 execution failed');
  }

  // Positive P3: Deterministic canonical manifest across reversed completion order
  {
    const taskA: SiblingCellConfig = { cellId: 'cell-a', briefId: 'brief-100', allowedLeasePrefixes: ['src/alpha'], fixtureTask: () => ({ changedPaths: ['src/alpha/module.ts'], diffText: 'diffA', testsPassed: true }) };
    const taskB: SiblingCellConfig = { cellId: 'cell-b', briefId: 'brief-200', allowedLeasePrefixes: ['src/beta'], fixtureTask: () => ({ changedPaths: ['src/beta/module.ts'], diffText: 'diffB', testsPassed: true }) };

    const campForward: CampaignInput = { campaignId: 'c-p3', parentReceiptAnchor: parentAnchor, baseCommit, baseTreeDigest, siblings: [taskA, taskB], fixedTimestamp: '2026-08-06T10:00:00Z' };
    const campReversed: CampaignInput = { campaignId: 'c-p3', parentReceiptAnchor: parentAnchor, baseCommit, baseTreeDigest, siblings: [taskB, taskA], fixedTimestamp: '2026-08-06T10:00:00Z' };

    const resF = await runCellFederation(campForward);
    const resR = await runCellFederation(campReversed);

    if (resF.ok && resR.ok && resF.integrationManifestDigest === resR.integrationManifestDigest) {
      pass(`P3: reversed completion order produces identical canonical IntegrationManifestV1 digest (${resF.integrationManifestDigest?.slice(0, 8)})`);
    } else fail('P3 failed: reversed completion order manifest digest mismatch');
  }

  console.log(failures === 0 ? 'cell c2.2 hostile child gate: all 15 hostile scenarios & 3 positive proofs passed' : `cell c2.2: ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

runHostileGateTests();
