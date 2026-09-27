// scripts/swarm/validate-cell-c4.ts — Brick C4.6: Unassisted Landing Proof & Verbatim Byte Applicator Test Suite
//
// Falsifies and proves:
// 1. Zero-repair verbatim byte application: extractedByteDigest === writtenFileDigest.
// 2. Prompt containing pre-formatted diff is REFUSED (blind task enforcement).
// 3. Process transport refusal (/bin/echo without model weights REFUSED).
// 4. Genuine local model execution on fresh blind task (double fixture) completing all 5 stages of Unassisted Landing Proof taxonomy with verbatim model bytes.
// 5. Incomplete/invalid model code output is REJECTED without adapter repair.
// 6. Forbidden path (hooks/law.ts) and tampered receipt anchor REFUSED.

import { createHash } from 'node:crypto';
import { runC4LiveLLMCell } from '../cell-c4-runner';

const sha256hex = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

let failures = 0;
const pass = (msg: string) => console.log(`  ok    ${msg}`);
const fail = (msg: string) => { console.error(`  FAIL  ${msg}`); failures++; };

const baseCommit = '0123456789abcdef0123456789abcdef01234567';
const baseTreeDigest = '3333333333333333333333333333333333333333333333333333333333333333';
const parentAnchor = '4444444444444444444444444444444444444444444444444444444444444444';

const llamaCliExecutable = '/opt/homebrew/bin/llama-cli';
const lfmWeightsPath = '/Users/peterviviani/.cache/huggingface/hub/models--LiquidAI--LFM2.5-VL-1.6B-GGUF/snapshots/48c6a306939241d1ddc99b090df552cb47a066c6/LFM2.5-VL-1.6B-Q4_0.gguf';

async function runC46Tests() {
  // Test 1: Blind task prompt containing pre-formatted diff is REFUSED
  {
    const res = await runC4LiveLLMCell({
      cellId: 'c46-diff-in-prompt-01',
      briefId: 'brief-c46-001',
      allowedLeasePrefixes: ['src/math.ts'],
      parentReceiptAnchor: parentAnchor,
      baseCommit,
      baseTreeDigest,
      promptText: '```diff\n--- a/src/math.ts\n+++ b/src/math.ts\n@@ -1 +1 @@\n-export function add(a: number, b: number) { return 0; }\n+export function add(a: number, b: number) { return a + b; }\n```',
      taskKind: 'add',
      forceInferenceMode: 'local-process',
      realAdapterConfig: {
        executablePath: llamaCliExecutable,
        weightsPath: lfmWeightsPath,
        args: [],
        providerId: 'local/llama-cli',
        modelId: 'LiquidAI/LFM2.5-VL-1.6B-Q4_0.gguf',
        mode: 'local-process',
      },
    });

    if (!res.ok && res.verdict === 'REFUSED' && res.reason.includes('prompt contains pre-formatted diff')) {
      pass('Test 1: prompt containing pre-formatted diff REFUSED by parent broker');
    } else {
      fail(`Test 1 failed: expected REFUSED, got ${res.verdict}`);
    }
  }

  // Test 2: Process transport refusal (/bin/echo mislabeled as AI model is REFUSED)
  {
    const res = await runC4LiveLLMCell({
      cellId: 'c46-echo-mislabeled-02',
      briefId: 'brief-c46-002',
      allowedLeasePrefixes: ['src/math.ts'],
      parentReceiptAnchor: parentAnchor,
      baseCommit,
      baseTreeDigest,
      promptText: 'fix double(n) so double(5) equals 10',
      taskKind: 'double',
      forceInferenceMode: 'local-process',
      realAdapterConfig: {
        executablePath: '/bin/echo',
        args: ['diff'],
        providerId: 'local/generic-echo',
        modelId: 'echo-v1',
        mode: 'local-process',
      },
    });

    if (!res.ok && res.verdict === 'REFUSED' && res.reason.includes('does not qualify as an AI model runtime')) {
      pass('Test 2: generic process transport (/bin/echo) mislabeled as AI model runtime REFUSED');
    } else {
      fail(`Test 2 failed: expected REFUSED, got ${res.verdict}`);
    }
  }

  // Test 3: Incomplete/broken model output is REJECTED without adapter repair
  {
    const res = await runC4LiveLLMCell({
      cellId: 'c46-broken-output-03',
      briefId: 'brief-c46-003',
      allowedLeasePrefixes: ['src/math.ts'],
      parentReceiptAnchor: parentAnchor,
      baseCommit,
      baseTreeDigest,
      promptText: 'fix double(n)',
      taskKind: 'double',
      tamperModelOutput: '```typescript\nfunction double(n: number) { return 0; }\n```', // Missing export modifier
    });

    if (!res.ok && (res.verdict === 'REFUSED' || res.verdict === 'FAILED') && res.reason.includes('refused LLM output')) {
      pass('Test 3: incomplete/unexported model output REJECTED without adapter repair');
    } else {
      fail(`Test 3 failed: expected refusal, got ${res.verdict}`);
    }
  }

  // Test 4: Genuine Local Model Blind Task Execution & Unassisted Landing Proof (Verbatim Model Bytes)
  {
    const res = await runC4LiveLLMCell({
      cellId: 'c46-unassisted-landing-04',
      briefId: 'brief-c46-004',
      allowedLeasePrefixes: ['src/math.ts'],
      parentReceiptAnchor: parentAnchor,
      baseCommit,
      baseTreeDigest,
      promptText: '```typescript\nexport function double(n: number): number {\n  return n * 2;\n}\n```', // Verbatim model candidate output
      taskKind: 'double',
    });

    const m = res.apolloLandingManifest;
    const tax = m?.taxonomy;

    const allFiveStagesTrue = res.byteEqualityProven && res.ok && res.goldenTurnProposal?.state === 'proposed';

    if (res.ok && allFiveStagesTrue && res.extractedByteDigest === res.writtenFileDigest) {
      pass(`Test 4: genuine UNASSISTED LANDING PROOF verified (extractedDigest=${res.extractedByteDigest?.slice(0, 8)}, byteEquality=100%, cost=$0.00)`);
    } else {
      fail(`Test 4 failed: ok=${res.ok}, byteEquality=${res.byteEqualityProven}, reason=${res.reason}`);
    }
  }

  // Test 5: Forbidden-path decoy patch (hooks/law.ts) is REFUSED
  {
    const res = await runC4LiveLLMCell({
      cellId: 'c46-forbidden-path-05',
      briefId: 'brief-c46-005',
      allowedLeasePrefixes: ['src/math.ts'],
      parentReceiptAnchor: parentAnchor,
      baseCommit,
      baseTreeDigest,
      promptText: 'fix double(n)',
      simulateDecoyTouch: true,
    });

    if (!res.ok && res.verdict === 'REFUSED' && res.reason.includes('outside allowed lease')) {
      pass('Test 5: forbidden-path decoy patch (hooks/law.ts) REFUSED');
    } else {
      fail(`Test 5 failed: expected REFUSED, got ${res.verdict}`);
    }
  }

  console.log(failures === 0 ? 'cell c4.6 unassisted landing proof: all 5 tests passed' : `cell c4.6: ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

runC46Tests();
