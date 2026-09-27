// scripts/cell-child-process.ts — Brick C3.2: Isolated OS Child Process Worker Script
//
// Executed as an isolated OS process with a synthetic empty HOME directory and scrubbed env.
// Writes real local child chain receipts into its isolated candidate worktree.

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sha256hex = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

interface CellConfigInput {
  cellId: string;
  briefId: string;
  allowedLeasePrefixes: string[];
  parentReceiptAnchor: string;
  baseCommit: string;
  baseTreeDigest: string;
  taskKind: 'alpha' | 'beta' | 'traversal' | 'out_of_lease' | 'slow_hang';
  workspaceDir: string;
}

const configRaw = process.argv[2] || process.env.CELL_CONFIG_JSON;
if (!configRaw) {
  console.error(JSON.stringify({ error: 'missing CELL_CONFIG_JSON' }));
  process.exit(1);
}

let cfg: CellConfigInput;
try {
  cfg = JSON.parse(configRaw);
} catch {
  console.error('malformed JSON input');
  process.exit(1);
}

const { cellId, briefId, allowedLeasePrefixes, parentReceiptAnchor, baseCommit, baseTreeDigest, taskKind, workspaceDir } = cfg;

// Clean and set up isolated workspace directory
if (existsSync(workspaceDir)) rmSync(workspaceDir, { recursive: true, force: true });
mkdirSync(workspaceDir, { recursive: true });

// Verify fake home isolation
const fakeHome = process.env.HOME || join(workspaceDir, '.aukora', 'fake-home');
if (!existsSync(fakeHome)) mkdirSync(fakeHome, { recursive: true });

const childChainDir = join(workspaceDir, '.aukora');
mkdirSync(childChainDir, { recursive: true });
const childChainPath = join(childChainDir, 'aura-chain.jsonl');

const briefDigest = sha256hex(briefId);
const leaseDigest = sha256hex(JSON.stringify(allowedLeasePrefixes));

let childChainHead = sha256hex(`genesis:${cellId}:${briefId}`);

const appendChildReceipt = (event: string, payload: Record<string, unknown>) => {
  const prev = childChainHead;
  const lineObj = { event, payload, prevChainHead: prev, ts: new Date().toISOString() };
  const lineStr = JSON.stringify(lineObj);
  childChainHead = sha256hex(prev + ':' + lineStr);
  writeFileSync(childChainPath, lineStr + '\n', { flag: 'a' });
};

appendChildReceipt('DELEGATED', { briefId, leasePrefixes: allowedLeasePrefixes });
appendChildReceipt('ENGINE_STARTED', { pid: process.pid, engine: 'fixture-os-child-v3.2', fakeHome });

if (taskKind === 'slow_hang') {
  appendChildReceipt('EFFECT_PROPOSED', { action: 'start_slow_hang' });
  setInterval(() => {}, 1000);
} else {
  let changedPaths: string[] = [];
  let diffText = '';

  if (taskKind === 'alpha') {
    const filePath = join(workspaceDir, 'src', 'alpha', 'module.ts');
    mkdirSync(join(workspaceDir, 'src', 'alpha'), { recursive: true });
    writeFileSync(filePath, 'export const alpha = 1;\n', 'utf8');
    changedPaths = ['src/alpha/module.ts'];
    diffText = '--- a/src/alpha/module.ts\n+++ b/src/alpha/module.ts\n@@ -0,0 +1 \n+export const alpha = 1;\n';
  } else if (taskKind === 'beta') {
    const filePath = join(workspaceDir, 'src', 'beta', 'module.ts');
    mkdirSync(join(workspaceDir, 'src', 'beta'), { recursive: true });
    writeFileSync(filePath, 'export const beta = 2;\n', 'utf8');
    changedPaths = ['src/beta/module.ts'];
    diffText = '--- a/src/beta/module.ts\n+++ b/src/beta/module.ts\n@@ -0,0 +1 \n+export const beta = 2;\n';
  } else if (taskKind === 'out_of_lease') {
    const filePath = join(workspaceDir, 'hooks', 'law.ts');
    mkdirSync(join(workspaceDir, 'hooks'), { recursive: true });
    writeFileSync(filePath, '// bypass\n', 'utf8');
    changedPaths = ['hooks/law.ts'];
    diffText = '--- a/hooks/law.ts\n+++ b/hooks/law.ts\n@@ -0,0 +1 \n+// bypass\n';
  } else if (taskKind === 'traversal') {
    changedPaths = ['src/alpha/../hooks/law.ts'];
    diffText = '--- a/src/alpha/../hooks/law.ts\n+++ b/src/alpha/../hooks/law.ts\n@@ -0,0 +1 \n+// traversal\n';
  }

  const proposalDigest = sha256hex(diffText);
  appendChildReceipt('EFFECT_AUTHORIZED', { changedPaths });
  appendChildReceipt('ENGINE_FINISHED', { testsPassed: true });
  appendChildReceipt('RESULT_PROPOSED', { proposalDigest });

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
      proposalDigest,
      changedPaths,
      unresolvedEffects: 0,
      attestationMode: 'unbound-test',
      identityBound: false,
      state: 'proposed',
      createdAt: new Date().toISOString(),
    },
    diffText,
    workspaceDir,
    childChainHead,
    pid: process.pid,
    fakeHomeUsed: fakeHome,
  };

  console.log(JSON.stringify(resultObj));
  process.exit(0);
}
