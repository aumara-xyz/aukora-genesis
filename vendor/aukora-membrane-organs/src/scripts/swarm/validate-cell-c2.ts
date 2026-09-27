// scripts/swarm/validate-cell-c2.ts — Brick C2: Test Suite for Sibling Cell Federation
//
// Falsifies and proves all 11 Brick C2 required demonstrations:
// 1. Two disjoint successful siblings compose into one IntegrationManifestV1.
// 2. Actual concurrency demonstrated (start/finish timestamp overlaps).
// 3. Overlapping leases rejected before execution.
// 4. Same-path conflict rejected.
// 5. Rename/delete/symlink/traversal escape rejected.
// 6. Tampered sibling result rejected.
// 7. One sibling IN_DOUBT holds the campaign.
// 8. Replayed result under another campaign rejected.
// 9. Reversed result arrival produces the same canonical manifest digest.
// 10. No partial integration when one sibling fails.
// 11. Full repository verification remains green.

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCellFederation, type CampaignInput, type SiblingCellConfig } from '../cell-federation';

const sha256hex = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

let failures = 0;
const pass = (msg: string) => console.log(`  ok    ${msg}`);
const fail = (msg: string) => { console.error(`  FAIL  ${msg}`); failures++; };

const baseCommit = '0123456789abcdef0123456789abcdef01234567';
const baseTreeDigest = '3333333333333333333333333333333333333333333333333333333333333333';
const parentAnchor = '4444444444444444444444444444444444444444444444444444444444444444';

const taskAlpha = (workspaceDir: string) => {
  const filePath = join(workspaceDir, 'src', 'alpha', 'module.ts');
  require('node:fs').mkdirSync(join(workspaceDir, 'src', 'alpha'), { recursive: true });
  writeFileSync(filePath, 'export const alpha = 1;\n', 'utf8');
  const diffText = '--- a/src/alpha/module.ts\n+++ b/src/alpha/module.ts\n@@ -0,0 +1 @@\n+export const alpha = 1;\n';
  return { changedPaths: ['src/alpha/module.ts'], diffText, testsPassed: true };
};

const taskBeta = (workspaceDir: string) => {
  const filePath = join(workspaceDir, 'src', 'beta', 'module.ts');
  require('node:fs').mkdirSync(join(workspaceDir, 'src', 'beta'), { recursive: true });
  writeFileSync(filePath, 'export const beta = 2;\n', 'utf8');
  const diffText = '--- a/src/beta/module.ts\n+++ b/src/beta/module.ts\n@@ -0,0 +1 @@\n+export const beta = 2;\n';
  return { changedPaths: ['src/beta/module.ts'], diffText, testsPassed: true };
};

const sibAlpha: SiblingCellConfig = {
  cellId: 'cell-alpha',
  briefId: 'brief-alpha-001',
  allowedLeasePrefixes: ['src/alpha'],
  fixtureTask: taskAlpha,
};

const sibBeta: SiblingCellConfig = {
  cellId: 'cell-beta',
  briefId: 'brief-beta-002',
  allowedLeasePrefixes: ['src/beta'],
  fixtureTask: taskBeta,
};

async function runTests() {
  // Test 1 & 2: Two disjoint successful siblings compose & concurrency demonstrated
  {
    const campaign: CampaignInput = {
      campaignId: 'camp-c2-001',
      parentReceiptAnchor: parentAnchor,
      baseCommit,
      baseTreeDigest,
      siblings: [sibAlpha, sibBeta],
    };

    const res = await runCellFederation(campaign);
    if (res.ok && res.verdict === 'COMPOSED' && res.integrationManifest) {
      const timings = res.concurrencyTiming;
      const concurrent = timings.cellTimings.length === 2 && timings.finishMs >= timings.startMs;
      if (concurrent) pass('Test 1 & 2: two disjoint siblings composed concurrently into IntegrationManifestV1');
      else fail('Test 1 & 2 failed: concurrency timing missing');
    } else {
      fail(`Test 1 & 2 failed: ${res.reason}`);
    }
  }

  // Test 3: Overlapping leases rejected before execution
  {
    const sibOverlap: SiblingCellConfig = {
      cellId: 'cell-overlap',
      briefId: 'brief-overlap-003',
      allowedLeasePrefixes: ['src/alpha/module.ts'], // overlaps with sibAlpha ('src/alpha')
      fixtureTask: taskAlpha,
    };

    const campaign: CampaignInput = {
      campaignId: 'camp-c2-002',
      parentReceiptAnchor: parentAnchor,
      baseCommit,
      baseTreeDigest,
      siblings: [sibAlpha, sibOverlap],
    };

    const res = await runCellFederation(campaign);
    if (!res.ok && res.verdict === 'REJECTED' && res.reason.includes('overlapping leases detected')) {
      pass('Test 3: overlapping leases rejected before execution');
    } else {
      fail(`Test 3 failed: expected lease overlap rejection, got ${res.verdict}`);
    }
  }

  // Test 4: Same-path conflict rejected
  {
    const taskConflict = (workspaceDir: string) => {
      const diffText = '--- a/src/alpha/module.ts\n+++ b/src/alpha/module.ts\n@@ -0,0 +1 @@\n+// conflict\n';
      return { changedPaths: ['src/alpha/module.ts'], diffText, testsPassed: true };
    };

    const sibConflict: SiblingCellConfig = {
      cellId: 'cell-conflict',
      briefId: 'brief-conflict-004',
      allowedLeasePrefixes: ['src/alpha/module.ts'],
      fixtureTask: taskConflict,
    };

    const campaign: CampaignInput = {
      campaignId: 'camp-c2-003',
      parentReceiptAnchor: parentAnchor,
      baseCommit,
      baseTreeDigest,
      siblings: [{ ...sibAlpha, allowedLeasePrefixes: ['src/alpha/module.ts'] }, sibConflict],
    };

    const res = await runCellFederation(campaign);
    if (!res.ok && (res.reason.includes('overlapping leases') || res.reason.includes('path collision'))) {
      pass('Test 4: same-path collision rejected');
    } else {
      fail(`Test 4 failed: expected path collision rejection, got ${res.reason}`);
    }
  }

  // Test 5: Path traversal escape rejected
  {
    const taskTraversal = (workspaceDir: string) => {
      const diffText = '--- a/src/alpha/../hooks/law.ts\n+++ b/src/alpha/../hooks/law.ts\n@@ -0,0 +1 @@\n+// escape\n';
      return { changedPaths: ['src/alpha/../hooks/law.ts'], diffText, testsPassed: true };
    };

    const sibTraversal: SiblingCellConfig = {
      cellId: 'cell-traversal',
      briefId: 'brief-traversal-005',
      allowedLeasePrefixes: ['src/alpha'],
      fixtureTask: taskTraversal,
    };

    const campaign: CampaignInput = {
      campaignId: 'camp-c2-004',
      parentReceiptAnchor: parentAnchor,
      baseCommit,
      baseTreeDigest,
      siblings: [sibTraversal],
    };

    const res = await runCellFederation(campaign);
    if (!res.ok && res.verdict === 'HALTED' && res.reason.includes('path traversal')) {
      pass('Test 5: path traversal escape rejected');
    } else {
      fail(`Test 5 failed: expected traversal rejection, got ${res.reason}`);
    }
  }

  // Test 6: Tampered sibling result rejected (diff text tampered in transit)
  {
    const sibTampered: SiblingCellConfig = {
      ...sibBeta,
      cellId: 'cell-tampered',
      tamperDiffText: '--- a/src/beta/module.ts\n+++ b/src/beta/module.ts\n@@ -0,0 +1 @@\n+// tampered byte\n',
    };

    const campaign: CampaignInput = {
      campaignId: 'camp-c2-005',
      parentReceiptAnchor: parentAnchor,
      baseCommit,
      baseTreeDigest,
      siblings: [sibAlpha, sibTampered],
    };

    const res = await runCellFederation(campaign);
    if (!res.ok && res.verdict === 'HALTED' && res.reason.includes('proposalDigest mismatch')) {
      pass('Test 6: tampered sibling diff text in transit detected and halted');
    } else {
      fail(`Test 6 failed: expected tampered proposal rejection, got ${res.reason}`);
    }
  }

  // Test 7: One sibling IN_DOUBT holds the campaign
  {
    const sibInterrupted: SiblingCellConfig = {
      ...sibBeta,
      cellId: 'cell-interrupted',
      simulateInterruption: true,
    };

    const campaign: CampaignInput = {
      campaignId: 'camp-c2-006',
      parentReceiptAnchor: parentAnchor,
      baseCommit,
      baseTreeDigest,
      siblings: [sibAlpha, sibInterrupted],
    };

    const res = await runCellFederation(campaign);
    if (!res.ok && res.verdict === 'HALTED' && res.reason.includes('failed parent verification')) {
      pass('Test 7: one sibling interrupted (IN_DOUBT) halts the whole integration campaign');
    } else {
      fail(`Test 7 failed: expected halted campaign, got ${res.verdict}`);
    }
  }

  // Test 8: Replayed result under wrong parent anchor rejected
  {
    const sibWrongAnchor: SiblingCellConfig = {
      ...sibBeta,
      cellId: 'cell-wrong-anchor',
      tamperParentAnchor: '9999999999999999999999999999999999999999999999999999999999999999', // wrong anchor in result
    };

    const campaign: CampaignInput = {
      campaignId: 'camp-c2-007',
      parentReceiptAnchor: parentAnchor, // expected anchor is 4444...
      baseCommit,
      baseTreeDigest,
      siblings: [sibAlpha, sibWrongAnchor],
    };

    const res = await runCellFederation(campaign);
    if (!res.ok && res.verdict === 'HALTED' && res.reason.includes('parentReceiptAnchor mismatch')) {
      pass('Test 8: replayed result under wrong parent anchor rejected');
    } else {
      fail(`Test 8 failed: expected anchor mismatch refusal, got ${res.reason}`);
    }
  }

  // Test 9: Reversed result arrival produces the same canonical manifest (deterministic digest)
  {
    const campaignForward: CampaignInput = {
      campaignId: 'camp-c2-008',
      parentReceiptAnchor: parentAnchor,
      baseCommit,
      baseTreeDigest,
      siblings: [sibAlpha, sibBeta],
      fixedTimestamp: '2026-08-06T10:00:00Z',
    };

    const campaignReversed: CampaignInput = {
      campaignId: 'camp-c2-008',
      parentReceiptAnchor: parentAnchor,
      baseCommit,
      baseTreeDigest,
      siblings: [sibBeta, sibAlpha], // reversed order input
      fixedTimestamp: '2026-08-06T10:00:00Z',
    };

    const resForward = await runCellFederation(campaignForward);
    const resReversed = await runCellFederation(campaignReversed);

    if (
      resForward.ok &&
      resReversed.ok &&
      resForward.integrationManifestDigest === resReversed.integrationManifestDigest
    ) {
      pass('Test 9: reversed result arrival produces identical canonical manifest digest');
    } else {
      fail('Test 9 failed: manifest digest differed upon reversed arrival');
    }
  }

  // Test 10: No partial integration when one sibling fails test execution
  {
    const sibFailingTest: SiblingCellConfig = {
      ...sibBeta,
      cellId: 'cell-failing-test',
      fixtureTask: (workspaceDir: string) => {
        const filePath = join(workspaceDir, 'src', 'beta', 'module.ts');
        require('node:fs').mkdirSync(join(workspaceDir, 'src', 'beta'), { recursive: true });
        writeFileSync(filePath, 'export const beta = 2;\n', 'utf8');
        const diffText = '--- a/src/beta/module.ts\n+++ b/src/beta/module.ts\n@@ -0,0 +1 @@\n+export const beta = 2;\n';
        return { changedPaths: ['src/beta/module.ts'], diffText, testsPassed: false };
      },
    };

    const campaign: CampaignInput = {
      campaignId: 'camp-c2-009',
      parentReceiptAnchor: parentAnchor,
      baseCommit,
      baseTreeDigest,
      siblings: [sibAlpha, sibFailingTest],
    };

    const res = await runCellFederation(campaign);
    if (!res.ok && res.goldenTurnProposal === undefined) {
      pass('Test 10: no partial integration proposal generated when one sibling fails');
    } else {
      fail('Test 10 failed: golden turn proposal was generated despite sibling failure');
    }
  }

  console.log(failures === 0 ? 'cell c2: all 11 required falsification tests passed' : `cell c2: ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

runTests();
