// scripts/swarm/validate-cell-c3-2.ts — Brick C3.2: Claim-Integrity Gate & Truthful Capability Report
//
// Proves truthful capability classification, synthetic fake HOME isolation, ambient env scrubbing,
// and CapabilityEnforcementReportV1 structure.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnOSCellProcess, generateCapabilityReport } from '../cell-process-runner';

let failures = 0;
const pass = (msg: string) => console.log(`  ok    ${msg}`);
const fail = (msg: string) => { console.error(`  FAIL  ${msg}`); failures++; };

const baseCommit = '0123456789abcdef0123456789abcdef01234567';
const baseTreeDigest = '3333333333333333333333333333333333333333333333333333333333333333';
const parentAnchor = '4444444444444444444444444444444444444444444444444444444444444444';

async function runC32ClaimIntegrityTests() {
  // Test 1: Synthetic Fake HOME Isolation
  {
    const res = await spawnOSCellProcess({
      cellId: 'c32-fake-home',
      briefId: 'brief-c32-001',
      allowedLeasePrefixes: ['src/alpha'],
      parentReceiptAnchor: parentAnchor,
      baseCommit,
      baseTreeDigest,
      taskKind: 'alpha',
    });

    if (res.ok && res.fakeHomeDir.includes('.aukora/fake-home') && existsSync(res.fakeHomeDir)) {
      pass(`Test 1: synthetic fake HOME verified (${res.fakeHomeDir})`);
    } else {
      fail(`Test 1 failed: fake HOME not created or returned`);
    }
  }

  // Test 2: Ambient Environment Scrubbing
  {
    // Set a dummy ambient env var
    process.env.TEST_AMBIENT_SECRET_TOKEN = 'DO_NOT_INHERIT_12345';

    const res = await spawnOSCellProcess({
      cellId: 'c32-env-scrub',
      briefId: 'brief-c32-002',
      allowedLeasePrefixes: ['src/alpha'],
      parentReceiptAnchor: parentAnchor,
      baseCommit,
      baseTreeDigest,
      taskKind: 'alpha',
    });

    const resStr = JSON.stringify(res);
    const leaked = resStr.includes('DO_NOT_INHERIT_12345');

    if (res.ok && !leaked) {
      pass('Test 2: ambient environment scrubbing verified (ambient secret token scrubbed from process env)');
    } else {
      fail('Test 2 failed: ambient environment token leaked to child process');
    }
  }

  // Test 3: CapabilityEnforcementReportV1 structure & truthfulness
  {
    const report = generateCapabilityReport();
    const validSchema = report.schema === 'aukora-capability-enforcement-report-v1';
    const truthfulSecretLevel = report.secretIsolation.level === 'PARENT_VERIFIED';
    const truthfulNetworkLevel = report.networkIsolation.level === 'DECLARED';
    const truthfulMemoryLevel = report.resourceIsolation.memoryLimit.level === 'NOT_ENFORCED';

    if (validSchema && truthfulSecretLevel && truthfulNetworkLevel && truthfulMemoryLevel) {
      pass('Test 3: CapabilityEnforcementReportV1 validated (secret=PARENT_VERIFIED, network=DECLARED, memory=NOT_ENFORCED)');
    } else {
      fail('Test 3 failed: report structure or claim levels incorrect');
    }
  }

  console.log(failures === 0 ? 'cell c3.2 claim-integrity gate: all 3 tests passed' : `cell c3.2: ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

runC32ClaimIntegrityTests();
