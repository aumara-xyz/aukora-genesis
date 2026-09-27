// scripts/swarm/validate-move-37-8.ts — RETIRED SUBJECT with vacuity exhibit (2026-08-10)
//
// Historical suite imported `isCanonicalPathOrGlobContained` from core/swarm/fractal-contract.ts. That export is
// GONE. Re-running the old suite crashed with "Export named X not found" — a red that looked
// like a live gate while proving nothing about current bytes.
//
// This replacement is intentional GREEN only when the dead export stays absent AND a surviving
// related export still exists. If the dead name reappears, this gate goes RED so someone
// reattaches a real suite instead of celebrating an empty import.
//
// NOT a substitute for the original Move 37.8 campaign. Exhibit of subject death only.
import * as fractal from '../../core/swarm/fractal-contract.ts';

let failures = 0;
const ok = (m: string) => console.log('  ok    ' + m);
const fail = (m: string) => { failures++; console.error('  FAIL  ' + m); };

const dead = 'isCanonicalPathOrGlobContained';
const alive = 'isCanonicalPathContained';
const also = 'verifyCanonicalLeaseSubset';

if (dead in fractal) {
  fail(`${dead} reappeared on fractal-contract — reattach a real Move 37.8 suite; vacuity retirement is void`);
} else {
  ok(`${dead} still absent (subject dead — vacuity exhibit)`);
}

if (typeof (fractal as Record<string, unknown>)[alive] === 'function') {
  ok(`surviving API ${alive} still exported`);
} else {
  fail(`surviving API ${alive} missing — fractal-contract more broken than the retirement assumed`);
}

if (typeof (fractal as Record<string, unknown>)[also] === 'function') {
  ok(`related API ${also} still exported`);
} else {
  fail(`related API ${also} missing`);
}

// Non-vacuity: at least one live export must be a function (empty module would pass "dead absent")
const liveFns = Object.keys(fractal).filter((k) => typeof (fractal as Record<string, unknown>)[k] === 'function');
if (liveFns.length >= 3) ok(`fractal-contract still has ${liveFns.length} live function exports (non-empty module)`);
else fail('fractal-contract looks empty — vacuity of dead export is free and proves nothing');

console.log(failures
  ? `validate-move-37-8: ${failures} failure(s) [retirement]`
  : `validate-move-37-8: retired subject — vacuity exhibit GREEN`);
process.exit(failures ? 1 : 0);
