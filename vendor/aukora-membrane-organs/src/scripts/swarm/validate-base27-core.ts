// scripts/swarm/validate-base27-core.ts — Base-27 Reality Gate & WASM Evidence Validator

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  BASE27_EXPECTED_WASM_DIGEST,
  BASE27_EXPECTED_BYTE_SIZE,
  BASE27_CENTER_ADDRESS,
  STAGED_LOADER_PATH,
  ACTUAL_ARTIFACT_PATH,
  Base27JsReference,
  loadBase27WasmInstance,
} from '../../core/swarm/base27-core';

export interface Base27TestResultV1 {
  checkId: string;
  name: string;
  passed: boolean;
  details: string;
}

export function runBase27ValidationSuite(): Base27TestResultV1[] {
  const tests: Base27TestResultV1[] = [];

  // Check 1: Artifact digest and size verification
  let loaded: ReturnType<typeof loadBase27WasmInstance>;
  try {
    loaded = loadBase27WasmInstance(process.cwd());
    const isDigestOk = loaded.digest === BASE27_EXPECTED_WASM_DIGEST;
    const isSizeOk = loaded.byteSize === BASE27_EXPECTED_BYTE_SIZE;
    tests.push({
      checkId: 'B27-01-DIGEST-SIZE-VERIFICATION',
      name: 'Verify artifact SHA256 digest and 13,040 byte size before instantiation',
      passed: isDigestOk && isSizeOk,
      details: `digest=${loaded.digest.slice(0, 16)}..., size=${loaded.byteSize}`,
    });
  } catch (e: any) {
    tests.push({ checkId: 'B27-01-DIGEST-SIZE-VERIFICATION', name: 'Artifact digest verification', passed: false, details: e.message });
    return tests;
  }

  const { exports } = loaded;

  // Check 2: Enumerate all 27 (t2,t1,t0) trit combinations
  {
    let count = 0;
    let allMatched = true;
    for (let t2 = 0; t2 < 3; t2++) {
      for (let t1 = 0; t1 < 3; t1++) {
        for (let t0 = 0; t0 < 3; t0++) {
          const wasmAddr = exports.addr27Encode(t2, t1, t0);
          const jsAddr = Base27JsReference.encode(t2, t1, t0);
          if (wasmAddr !== jsAddr || wasmAddr !== count) allMatched = false;
          count++;
        }
      }
    }
    tests.push({
      checkId: 'B27-02-ENUMERATE-ALL-27-TRITS',
      name: 'Enumerate all 27 (t2,t1,t0) trit combinations and match JS reference',
      passed: count === 27 && allMatched,
      details: `count=${count}, allMatched=${allMatched}`,
    });
  }

  // Check 3: Encode/decode round-trip
  {
    let roundTripOk = true;
    for (let addr = 0; addr < 27; addr++) {
      const t0 = exports.addr27Trit(addr, 0);
      const t1 = exports.addr27Trit(addr, 1);
      const t2 = exports.addr27Trit(addr, 2);
      const reEnc = exports.addr27Encode(t2, t1, t0);
      if (reEnc !== addr) roundTripOk = false;
    }
    tests.push({
      checkId: 'B27-03-ROUND-TRIP-ENCODE-DECODE',
      name: 'Prove encode/decode round-trip for all 27 addresses',
      passed: roundTripOk,
      details: `roundTripOk=${roundTripOk}`,
    });
  }

  // Check 4: Prove center = 13 (1,1,1)
  {
    const wasmCenter = exports.addr27Centre();
    const encCenter = exports.addr27Encode(1, 1, 1);
    tests.push({
      checkId: 'B27-04-CENTER-IS-13',
      name: 'Prove center address equals 13 for (1,1,1)',
      passed: wasmCenter === 13 && encCenter === 13,
      details: `wasmCenter=${wasmCenter}, encCenter=${encCenter}`,
    });
  }

  // Check 5: Prove shell populations [1, 6, 12, 8]
  {
    const pops = [0, 0, 0, 0];
    for (let addr = 0; addr < 27; addr++) {
      const s = exports.addr27Shell(addr);
      if (s >= 0 && s <= 3) pops[s]++;
    }
    const matchesPops = pops[0] === 1 && pops[1] === 6 && pops[2] === 12 && pops[3] === 8;
    tests.push({
      checkId: 'B27-05-SHELL-POPULATIONS-EXACT',
      name: 'Prove shell populations are exactly [1, 6, 12, 8]',
      passed: matchesPops,
      details: `populations=[${pops.join(', ')}]`,
    });
  }

  // Check 6: Shell equals distance from center
  {
    let shellEqualsDist = true;
    for (let addr = 0; addr < 27; addr++) {
      const s = exports.addr27Shell(addr);
      const d = exports.addr27Distance(addr, 13);
      if (s !== d) shellEqualsDist = false;
    }
    tests.push({
      checkId: 'B27-06-SHELL-EQUALS-MANHATTAN-DISTANCE',
      name: 'Prove shell equals Manhattan distance from center (1,1,1) for all 27 cells',
      passed: shellEqualsDist,
      details: `shellEqualsDist=${shellEqualsDist}`,
    });
  }

  // Check 7: Symmetry of distance and range 0-3
  {
    let symmetryOk = true;
    for (let a = 0; a < 27; a++) {
      for (let b = 0; b < 27; b++) {
        const dAB = exports.addr27Distance(a, b);
        const dBA = exports.addr27Distance(b, a);
        if (dAB !== dBA || dAB < 0 || dAB > 3) symmetryOk = false;
      }
    }
    tests.push({
      checkId: 'B27-07-DISTANCE-SYMMETRY-RANGE',
      name: 'Prove distance symmetry d(a,b) === d(b,a) and range 0..3',
      passed: symmetryOk,
      details: `symmetryOk=${symmetryOk}`,
    });
  }

  // Check 8: Bits 0-7 map to 8 unique corners
  {
    const corners = new Set<number>();
    for (let bits = 0; bits < 8; bits++) {
      const addr = exports.addr27FromBits(bits);
      const s = exports.addr27Shell(addr);
      if (s === 3) corners.add(addr);
    }
    tests.push({
      checkId: 'B27-08-BIT-CORNER-MAPPING',
      name: 'Prove bits 0..7 map to exactly 8 unique shell-3 corner cells',
      passed: corners.size === 8,
      details: `uniqueCornersCount=${corners.size}`,
    });
  }

  // Check 9: Invalid inputs return -1
  {
    const inv1 = exports.addr27Encode(3, 0, 0);
    const inv2 = exports.addr27Trit(27, 0);
    const inv3 = exports.addr27Shell(-1);
    const inv4 = exports.addr27FromBits(8);
    const invalidOk = inv1 === -1 && inv2 === -1 && inv3 === -1 && inv4 === -1;
    tests.push({
      checkId: 'B27-09-INVALID-INPUTS-FAIL-SAFE',
      name: 'Prove invalid trits, addresses, indices, or bits fail safe with -1',
      passed: invalidOk,
      details: `inv1=${inv1}, inv2=${inv2}, inv3=${inv3}, inv4=${inv4}`,
    });
  }

  // Check 10: Prove coreGrantsAuthority() === 0
  {
    const auth = exports.coreGrantsAuthority();
    tests.push({
      checkId: 'B27-10-ZERO-AUTHORITY-GRANTED',
      name: 'Prove coreGrantsAuthority() returns strictly 0 (Zero authority granted)',
      passed: auth === 0,
      details: `coreGrantsAuthority=${auth}`,
    });
  }

  // Check 11: Prove zero imported I/O, clock, or network host functions
  {
    const fs = require('node:fs');
    const buf = fs.readFileSync(join(process.cwd(), ACTUAL_ARTIFACT_PATH));
    const mod = new WebAssembly.Module(buf);
    const imports = WebAssembly.Module.imports(mod);
    const zeroHostIo = imports.length === 1 && imports[0].module === 'env' && imports[0].name === 'abort';
    tests.push({
      checkId: 'B27-11-ZERO-HOST-IO-IMPORTS',
      name: 'Prove zero imported I/O, clock, network, or authority host functions (only abort)',
      passed: zeroHostIo,
      details: `importsCount=${imports.length}, import=${imports[0]?.name}`,
    });
  }

  // Check 12: Detect and name staged loader path mismatch
  {
    const stagedExists = existsSync(join(process.cwd(), STAGED_LOADER_PATH));
    const actualExists = existsSync(join(process.cwd(), ACTUAL_ARTIFACT_PATH));
    const namedMismatch = !stagedExists && actualExists;
    tests.push({
      checkId: 'B27-12-STAGED-LOADER-PATH-MISMATCH',
      name: 'Detect and name staged loader path mismatch (dist/ core.wasm missing vs core.wasm present)',
      passed: namedMismatch,
      details: `stagedLoaderPath=${STAGED_LOADER_PATH} (exists:${stagedExists}), actualPath=${ACTUAL_ARTIFACT_PATH} (exists:${actualExists})`,
    });
  }

  return tests;
}

export function runBase27Runner() {
  console.log('--- ANTIGRAVITY: BASE-27 REALITY GATE & WASM VALIDATOR ---');

  const results = runBase27ValidationSuite();
  let allPassed = true;

  for (const r of results) {
    if (!r.passed) allPassed = false;
    console.log(`  ${r.passed ? 'ok  ' : 'FAIL'} ${r.checkId}: ${r.name} ➔ ${r.details}`);
  }
  console.log('');

  console.log('Production Status: REAL MATH / STAGED RESEARCH / NO PRODUCTION CALLERS');
  console.log(`Actual Status: ${allPassed ? 'BASE-27 REALITY GATE VERIFIED' : 'FAILED'}`);

  if (!allPassed) process.exit(1);
}

if (import.meta.main || process.argv[1]?.endsWith('validate-base27-core.ts')) {
  runBase27Runner();
}
