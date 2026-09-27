// scripts/cell-runner.ts — Brick C1: Deterministic Local Fixture Cell Runner

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyCellResult, verifyPathInLease, type CellResultV1, type CellVerificationVerdict } from '../core/swarm/cell-verifier';
import { Journal } from '../core/journal';

const sha256hex = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

export interface CellRunnerInput {
  cellId: string;
  briefId: string;
  allowedLeasePrefixes: string[];
  parentReceiptAnchor: string;
  baseCommit: string;
  baseTreeDigest: string;
  fixtureTask: (workspaceDir: string) => { changedPaths: string[]; diffText: string; testsPassed: boolean };
  simulateInterruption?: boolean;
}

export interface CellExecutionOutput {
  cellResult: CellResultV1;
  diffText: string;
  workspaceDir: string;
  childChainHead: string;
  testsPassed: boolean;
}

export interface ParentCellIntegrationOutput {
  verdict: CellVerificationVerdict;
  goldenTurnProposal?: {
    turnKey: string;
    candidateId: string;
    baseCommit: string;
    proposalHash: string;
    diff: string;
    files: Array<{ path: string; hash: string | null }>;
    state: 'proposed';
  };
}

/** Execute a deterministic local cell task inside an isolated candidate workspace. */
export function runLocalCell(input: CellRunnerInput): CellExecutionOutput {
  const root = process.cwd();
  const worktreeId = `cell-${input.cellId}-${randomBytes(4).toString('hex')}`;
  const workspaceDir = join(root, '.aukora', 'cell-worktrees', worktreeId);

  // Clean workspace
  if (existsSync(workspaceDir)) rmSync(workspaceDir, { recursive: true, force: true });
  mkdirSync(workspaceDir, { recursive: true });

  // Initialize isolated local child chain
  const childChainDir = join(workspaceDir, '.aukora');
  mkdirSync(childChainDir, { recursive: true });
  const childChainPath = join(childChainDir, 'aura-chain.jsonl');

  const briefDigest = sha256hex(input.briefId);
  const leaseDigest = sha256hex(JSON.stringify(input.allowedLeasePrefixes));
  
  let childChainHead = sha256hex(`genesis:${input.cellId}`);
  const appendChildReceipt = (event: string, payload: Record<string, unknown>) => {
    const prev = childChainHead;
    const item = { event, payload, prevChainHead: prev, ts: new Date().toISOString() };
    const line = JSON.stringify(item);
    childChainHead = sha256hex(prev + ':' + line);
    writeFileSync(childChainPath, line + '\n', { flag: 'a' });
  };

  appendChildReceipt('DELEGATED', { briefId: input.briefId, leasePrefixes: input.allowedLeasePrefixes });
  appendChildReceipt('ENGINE_STARTED', { engine: 'fixture-deterministic-v1' });

  // Check for simulated interruption
  if (input.simulateInterruption) {
    appendChildReceipt('ENGINE_INTERRUPTED', { reason: 'simulated SIGKILL' });
    const cellResult: CellResultV1 = {
      schema: 'aukora-swarm-cell-result-v1',
      cellId: input.cellId,
      briefId: input.briefId,
      briefDigest,
      leaseDigest,
      baseCommit: input.baseCommit,
      baseTreeDigest: input.baseTreeDigest,
      parentReceiptAnchor: input.parentReceiptAnchor,
      childChainHead,
      proposalDigest: '0000000000000000000000000000000000000000000000000000000000000000',
      changedPaths: [],
      unresolvedEffects: 1,
      attestationMode: 'unbound-test',
      identityBound: false,
      state: 'interrupted',
      createdAt: new Date().toISOString(),
    };
    return { cellResult, diffText: '', workspaceDir, childChainHead, testsPassed: false };
  }

  // Run fixture task
  const taskRes = input.fixtureTask(workspaceDir);
  const diffText = taskRes.diffText;
  const proposalDigest = sha256hex(diffText);

  // Check path lease compliance
  let leaseViolation = false;
  for (const p of taskRes.changedPaths) {
    const pathCheck = verifyPathInLease(p, input.allowedLeasePrefixes);
    if (!pathCheck.ok) {
      leaseViolation = true;
      appendChildReceipt('EFFECT_REFUSED', { path: p, reason: pathCheck.reason });
    } else {
      appendChildReceipt('EFFECT_AUTHORIZED', { path: p });
    }
  }

  appendChildReceipt('ENGINE_FINISHED', { testsPassed: taskRes.testsPassed });
  appendChildReceipt('RESULT_PROPOSED', { proposalDigest });

  const cellResult: CellResultV1 = {
    schema: 'aukora-swarm-cell-result-v1',
    cellId: input.cellId,
    briefId: input.briefId,
    briefDigest,
    leaseDigest,
    baseCommit: input.baseCommit,
    baseTreeDigest: input.baseTreeDigest,
    parentReceiptAnchor: input.parentReceiptAnchor,
    childChainHead,
    proposalDigest,
    changedPaths: taskRes.changedPaths,
    unresolvedEffects: 0,
    attestationMode: 'unbound-test',
    identityBound: false,
    state: leaseViolation ? 'rejected' : 'proposed',
    createdAt: new Date().toISOString(),
  };

  return { cellResult, diffText, workspaceDir, childChainHead, testsPassed: taskRes.testsPassed };
}

/** Parent Membrane verification and Golden Turn proposal formatting. */
export function integrateCellResultWithParent(
  execOutput: CellExecutionOutput,
  allowedLeasePrefixes: string[],
  expectedParentAnchor: string,
  actualTestsPassed: boolean,
): ParentCellIntegrationOutput {
  const { cellResult, diffText, workspaceDir } = execOutput;

  // Run pure parent verifier
  const verdict = verifyCellResult({
    cellResult,
    allowedLeasePrefixes,
    diffText,
    expectedParentAnchor,
    claimedTestsPassed: true,
    actualTestsPassed,
  });

  if (!verdict.ok || verdict.verdict !== 'ACCEPTED') {
    return { verdict };
  }

  const candidateId = `candidate-${cellResult.cellId}`;
  const files = cellResult.changedPaths.map((p) => {
    const abs = join(workspaceDir, p);
    const hash = existsSync(abs) ? sha256hex(readFileSync(abs)) : null;
    return { path: p, hash };
  });

  const proposalHash = Journal.intentDigestOf({
    baseCommit: cellResult.baseCommit,
    diff: diffText,
    files: JSON.stringify(files),
  });

  const goldenTurnProposal = {
    turnKey: `turn-${cellResult.briefId}`,
    candidateId,
    baseCommit: cellResult.baseCommit,
    proposalHash,
    diff: diffText,
    files,
    state: 'proposed' as const,
  };

  return { verdict, goldenTurnProposal };
}
