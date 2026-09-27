// scripts/cell-hostile-process.ts — Brick C2.2: Hostile / Deceptive Child Process Worker
//
// Simulates 15 hostile, defective, or deceptive cell behaviors to prove the parent verifier
// fails closed with explicit named refusal reasons.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sha256hex = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

interface HostileConfigInput {
  cellId: string;
  briefId: string;
  allowedLeasePrefixes: string[];
  parentReceiptAnchor: string;
  baseCommit: string;
  baseTreeDigest: string;
  hostileMode:
    | 'combined_flood'
    | 'grandchild_flood'
    | 'ignore_sigterm'
    | 'stdout_flood'
    | 'stderr_flood'
    | 'non_json_stdout'
    | 'multiple_envelopes'
    | 'oversized_payload'
    | 'nonzero_exit'
    | 'unsettled_effects'
    | 'corrupt_chain_tail'
    | 'broken_chain_link'
    | 'fake_chain_head'
    | 'fake_tests_passed'
    | 'tampered_patch'
    | 'duplicate_replay'
    | 'wrong_anchor'
    | 'out_of_lease_file'
    | 'late_output_timeout'
    | 'key_read_attempt';
  workspaceDir: string;
}

const configRaw = process.argv[2] || process.env.CELL_CONFIG_JSON;
if (!configRaw) {
  console.error('missing CELL_CONFIG_JSON');
  process.exit(1);
}

let cfg: HostileConfigInput;
try {
  cfg = JSON.parse(configRaw);
} catch {
  console.error('malformed JSON input');
  process.exit(1);
}

const { cellId, briefId, allowedLeasePrefixes, parentReceiptAnchor, baseCommit, baseTreeDigest, hostileMode, workspaceDir } = cfg;

if (existsSync(workspaceDir)) rmSync(workspaceDir, { recursive: true, force: true });
mkdirSync(workspaceDir, { recursive: true });

const childChainDir = join(workspaceDir, '.aukora');
mkdirSync(childChainDir, { recursive: true });
const childChainPath = join(childChainDir, 'aura-chain.jsonl');

const briefDigest = sha256hex(briefId);
const leaseDigest = sha256hex(JSON.stringify(allowedLeasePrefixes));
let childChainHead = sha256hex(`genesis:${cellId}:${briefId}`);

const appendChildReceipt = (event: string, payload: Record<string, unknown>, overridePrevHead?: string) => {
  const prev = overridePrevHead ?? childChainHead;
  const lineObj = { event, payload, prevChainHead: prev, ts: new Date().toISOString() };
  const lineStr = JSON.stringify(lineObj);
  childChainHead = sha256hex(prev + ':' + lineStr);
  writeFileSync(childChainPath, lineStr + '\n', { flag: 'a' });
};

appendChildReceipt('DELEGATED', { briefId, leasePrefixes: allowedLeasePrefixes });

// --- EXECUTE HOSTILE MODES ---

if (hostileMode === 'combined_flood') {
  const outChunk = 'O'.repeat(700 * 1024); // 700KB stdout
  const errChunk = 'E'.repeat(400 * 1024); // 400KB stderr (total 1.1MB > 1MB MAX_COMBINED_BYTES)
  process.stdout.write(outChunk);
  process.stderr.write(errChunk);
  process.exit(0);
}

if (hostileMode === 'grandchild_flood') {
  const spawn = require('node:child_process').spawn;
  const grandchildScript = `
    setInterval(() => {
      process.stdout.write("GRANDCHILD_PERSISTENT_OUTPUT\\n");
    }, 50);
  `;
  const grand = spawn('node', ['-e', grandchildScript], { stdio: ['ignore', 'ignore', 'ignore'] });
  if (grand.pid) {
    writeFileSync('/tmp/aukora-grandchild-pid.txt', String(grand.pid), 'utf8');
  }
  grand.unref();
  setInterval(() => {}, 1000); // Stay alive until process group SIGKILL
}

if (hostileMode === 'ignore_sigterm') {
  process.on('SIGTERM', () => {
    // Ignore SIGTERM explicitly
  });
  setInterval(() => {
    process.stdout.write("STILL_RUNNING_IGNORING_SIGTERM\n");
  }, 100);
}

if (hostileMode === 'stdout_flood') {
  const chunk = 'S'.repeat(64 * 1024); // 64KB chunk
  for (let i = 0; i < 100; i++) {
    process.stdout.write(chunk); // Attempt 6.4MB emission
  }
  process.exit(0);
}

if (hostileMode === 'stderr_flood') {
  const chunk = 'E'.repeat(32 * 1024); // 32KB chunk
  for (let i = 0; i < 20; i++) {
    process.stderr.write(chunk); // Attempt 640KB emission
  }
  process.exit(0);
}

if (hostileMode === 'non_json_stdout') {
  console.log('NOT_VALID_JSON_GARBAGE_OUTPUT_FROM_HOSTILE_WORKER');
  process.exit(0);
}

if (hostileMode === 'multiple_envelopes') {
  console.log(JSON.stringify({ envelope: 1, state: 'proposed' }));
  console.log(JSON.stringify({ envelope: 2, state: 'accepted' }));
  process.exit(0);
}

if (hostileMode === 'oversized_payload') {
  const hugeString = 'X'.repeat(2 * 1024 * 1024); // 2MB string
  console.log(JSON.stringify({ schema: 'aukora-swarm-cell-result-v1', payload: hugeString }));
  process.exit(0);
}

if (hostileMode === 'nonzero_exit') {
  console.log(JSON.stringify({ error: 'fatal error in cell worker' }));
  process.exit(42);
}

if (hostileMode === 'late_output_timeout') {
  setTimeout(() => {
    console.log(JSON.stringify({ cellId, state: 'proposed' }));
    process.exit(0);
  }, 2000); // 2s delay to trigger parent timeout
}

if (hostileMode === 'corrupt_chain_tail') {
  appendChildReceipt('ENGINE_STARTED', { mode: 'corrupt' });
  // Append raw truncated JSON line directly
  writeFileSync(childChainPath, '{"event":"EFFECT_START", "prevChainHead":"bad\n', { flag: 'a' });
  const resultObj = {
    cellResult: {
      schema: 'aukora-swarm-cell-result-v1',
      cellId,
      briefId,
      briefDigest,
      leaseDigest,
      baseCommit,
      baseTreeDigest,
      parentReceiptAnchor,
      childChainHead,
      proposalDigest: '0000000000000000000000000000000000000000000000000000000000000000',
      changedPaths: ['src/alpha/module.ts'],
      unresolvedEffects: 0,
      attestationMode: 'unbound-test',
      identityBound: false,
      state: 'proposed',
      createdAt: new Date().toISOString(),
    },
    diffText: '',
    workspaceDir,
  };
  console.log(JSON.stringify(resultObj));
  process.exit(0);
}

if (hostileMode === 'broken_chain_link') {
  appendChildReceipt('ENGINE_STARTED', { mode: 'broken_link' });
  // Force invalid prevChainHead on line 2
  appendChildReceipt('EFFECT_AUTHORIZED', { path: 'src/alpha/module.ts' }, '9999999999999999999999999999999999999999999999999999999999999999');
  const resultObj = {
    cellResult: {
      schema: 'aukora-swarm-cell-result-v1',
      cellId, briefId, briefDigest, leaseDigest, baseCommit, baseTreeDigest, parentReceiptAnchor,
      childChainHead, proposalDigest: '0000000000000000000000000000000000000000000000000000000000000000',
      changedPaths: ['src/alpha/module.ts'], unresolvedEffects: 0, attestationMode: 'unbound-test', identityBound: false, state: 'proposed', createdAt: new Date().toISOString()
    },
    diffText: '', workspaceDir
  };
  console.log(JSON.stringify(resultObj));
  process.exit(0);
}

if (hostileMode === 'fake_chain_head') {
  appendChildReceipt('ENGINE_STARTED', { mode: 'honest_chain' });
  const fakeHead = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
  const resultObj = {
    cellResult: {
      schema: 'aukora-swarm-cell-result-v1',
      cellId, briefId, briefDigest, leaseDigest, baseCommit, baseTreeDigest, parentReceiptAnchor,
      childChainHead: fakeHead, // Self-report fake head
      proposalDigest: '0000000000000000000000000000000000000000000000000000000000000000',
      changedPaths: ['src/alpha/module.ts'], unresolvedEffects: 0, attestationMode: 'unbound-test', identityBound: false, state: 'proposed', createdAt: new Date().toISOString()
    },
    diffText: '', workspaceDir
  };
  console.log(JSON.stringify(resultObj));
  process.exit(0);
}

if (hostileMode === 'tampered_patch') {
  appendChildReceipt('ENGINE_STARTED', { mode: 'tampered_patch' });
  const cleanDiff = '--- a/src/alpha/module.ts\n+++ b/src/alpha/module.ts\n@@ -0,0 +1 \n+export const alpha = 1;\n';
  const cleanDigest = sha256hex(cleanDiff);
  const tamperedDiff = cleanDiff + '\n// TAMPERED_LINE_IN_TRANSIT\n';
  const resultObj = {
    cellResult: {
      schema: 'aukora-swarm-cell-result-v1',
      cellId, briefId, briefDigest, leaseDigest, baseCommit, baseTreeDigest, parentReceiptAnchor,
      childChainHead, proposalDigest: cleanDigest, // Self-report clean digest
      changedPaths: ['src/alpha/module.ts'], unresolvedEffects: 0, attestationMode: 'unbound-test', identityBound: false, state: 'proposed', createdAt: new Date().toISOString()
    },
    diffText: tamperedDiff, // Send tampered diffText
    workspaceDir
  };
  console.log(JSON.stringify(resultObj));
  process.exit(0);
}

if (hostileMode === 'key_read_attempt') {
  appendChildReceipt('ENGINE_STARTED', { mode: 'key_read' });
  let keyAttemptRefused = false;
  try {
    const keyPath = join(process.env.HOME || '', '.aukora', 'keys', 'receipt-signing-seed');
    if (existsSync(keyPath)) {
      readFileSync(keyPath);
    } else {
      keyAttemptRefused = true;
    }
  } catch {
    keyAttemptRefused = true;
  }

  const resultObj = {
    cellResult: {
      schema: 'aukora-swarm-cell-result-v1',
      cellId, briefId, briefDigest, leaseDigest, baseCommit, baseTreeDigest, parentReceiptAnchor,
      childChainHead, proposalDigest: '0000000000000000000000000000000000000000000000000000000000000000',
      changedPaths: ['src/alpha/module.ts'], unresolvedEffects: keyAttemptRefused ? 0 : 1, attestationMode: 'unbound-test', identityBound: false, state: 'proposed', createdAt: new Date().toISOString()
    },
    diffText: '', workspaceDir
  };
  console.log(JSON.stringify(resultObj));
  process.exit(0);
}

if (hostileMode === 'unsettled_effects') {
  appendChildReceipt('ENGINE_STARTED', { mode: 'unsettled' });
  appendChildReceipt('EFFECT_PROPOSED', { action: 'pending' });
  const resultObj = {
    cellResult: {
      schema: 'aukora-swarm-cell-result-v1',
      cellId, briefId, briefDigest, leaseDigest, baseCommit, baseTreeDigest, parentReceiptAnchor,
      childChainHead, proposalDigest: '0000000000000000000000000000000000000000000000000000000000000000',
      changedPaths: ['src/alpha/module.ts'], unresolvedEffects: 1, attestationMode: 'unbound-test', identityBound: false, state: 'proposed', createdAt: new Date().toISOString()
    },
    diffText: '', workspaceDir
  };
  console.log(JSON.stringify(resultObj));
  process.exit(0);
}
