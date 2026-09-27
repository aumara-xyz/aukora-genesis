// scripts/swarm/validate-fractal-court-fixtures.ts — Hostile Fixture Foundry Validation Suite

import {
  K1_HOSTILE_FIXTURES,
  K2_HOSTILE_FIXTURES,
  evaluateHostileFixture,
  type HostileFixtureSpecV1,
} from '../../core/swarm/fractal-court-fixtures';

export function runHostileFixtureFoundrySuite() {
  console.log('--- ANTIGRAVITY: HOSTILE FIXTURE FOUNDRY SUITE ---');

  let allPassed = true;

  console.log('1. K1 Synthetic Export Hostile Corpus (8 Fixtures):');
  for (const fix of K1_HOSTILE_FIXTURES) {
    const res = evaluateHostileFixture(fix);
    const passed = res.actualVerdict === fix.expectedVerdict && res.actualRefusalReason === fix.expectedRefusalReason;
    if (!passed) allPassed = false;
    console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${fix.fixtureId}: ${fix.description} ➔ verdict=${res.actualVerdict}, reason=${res.actualRefusalReason}`);
  }
  console.log('');

  console.log('2. K2 Unified-Diff Hostile Corpus (11 Fixtures):');
  for (const fix of K2_HOSTILE_FIXTURES) {
    const res = evaluateHostileFixture(fix);
    const passed = res.actualVerdict === fix.expectedVerdict && res.actualRefusalReason === fix.expectedRefusalReason;
    if (!passed) allPassed = false;
    console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${fix.fixtureId}: ${fix.description} ➔ verdict=${res.actualVerdict}, reason=${res.actualRefusalReason}`);
  }
  console.log('');

  console.log(`Actual Status: ${allPassed ? 'HOSTILE FIXTURE FOUNDRY VERIFIED / DOCKING RING OPEN' : 'FAILED'}`);
  if (!allPassed) process.exit(1);
}

if (import.meta.main || process.argv[1]?.endsWith('validate-fractal-court-fixtures.ts')) {
  runHostileFixtureFoundrySuite();
}
