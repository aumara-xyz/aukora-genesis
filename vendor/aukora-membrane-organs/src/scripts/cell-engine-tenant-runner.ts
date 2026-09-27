// scripts/cell-engine-tenant-runner.ts — Brick C3.1: Untrusted Engine Tenant Runner & Deterministic Aura Telemetry Generator
//
// Orchestrates an out-of-process untrusted engine tenant under strict parent governance.
// Derives CellAuraStateV1 telemetry strictly from verified parent state.
// Aura state digest is 100% deterministic and free of wall-clock dependence.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnOSCellProcess, type OSProcessExecutionResult } from './cell-process-runner';
import { verifyCellResult } from '../core/swarm/cell-verifier';

const sha256hex = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

export interface EngineTenantV1 {
  schema: 'aukora-swarm-engine-tenant-v1';
  engineId: string;
  adapterVersion: string;
  modelProvider: string;
  briefDigest: string;
  leaseDigest: string;
  baseCommit: string;
  baseTreeDigest: string;
  timeoutMs: number;
  networkPolicy: 'deny' | 'local-only' | 'allow-egress';
  environmentAllowlist: string[];
}

export interface CellAuraStateV1 {
  schema: 'aukora-swarm-cell-aura-state-v1';
  cellId: string;
  posture: 'delegated' | 'active' | 'unsettled' | 'refused' | 'proposed' | 'accepted' | 'rejected';
  phase: string;
  recomputedHead: string | null;
  unresolvedCount: number;
  auraDigest: string; // Deterministic hash of state (no wall-clock dependence)
  tsDisplay?: string;  // Display-only metadata
}

export interface EngineTenantExecutionOutput {
  ok: boolean;
  verdict: 'SUCCEEDED' | 'FAILED' | 'REFUSED' | 'IN_DOUBT';
  reason: string;
  tenantContract: EngineTenantV1;
  processResult: OSProcessExecutionResult;
  auraState: CellAuraStateV1;
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

export function computeAuraDigest(cellId: string, posture: string, phase: string, recomputedHead: string | null, unresolvedCount: number): string {
  const canonicalStr = `${cellId}:${posture}:${phase}:${recomputedHead ?? 'null'}:${unresolvedCount}`;
  return sha256hex(canonicalStr);
}

/** Execute an untrusted engine tenant inside a disposable fixture workspace. */
export async function runEngineTenantCell(input: {
  cellId: string;
  briefId: string;
  allowedLeasePrefixes: string[];
  parentReceiptAnchor: string;
  baseCommit: string;
  baseTreeDigest: string;
  fixtureTaskKind: 'alpha' | 'beta' | 'out_of_lease' | 'slow_hang';
  hostileMode?: string;
  timeoutMs?: number;
  tamperTestResults?: boolean;
}): Promise<EngineTenantExecutionOutput> {
  const briefDigest = sha256hex(input.briefId);
  const leaseDigest = sha256hex(JSON.stringify(input.allowedLeasePrefixes));
  const timeoutMs = input.timeoutMs ?? 10000;

  const tenantContract: EngineTenantV1 = {
    schema: 'aukora-swarm-engine-tenant-v1',
    engineId: 'engine-local-deterministic-v1',
    adapterVersion: '1.0.0',
    modelProvider: 'local/deterministic-v1',
    briefDigest,
    leaseDigest,
    baseCommit: input.baseCommit,
    baseTreeDigest: input.baseTreeDigest,
    timeoutMs,
    networkPolicy: 'deny',
    environmentAllowlist: ['PATH', 'HOME', 'CELL_CONFIG_JSON'],
  };

  // Telemetry: Delegated
  let posture: CellAuraStateV1['posture'] = 'delegated';
  let phase = 'BRIEF_ISSUED';
  let auraDigest = computeAuraDigest(input.cellId, posture, phase, null, 0);

  let auraState: CellAuraStateV1 = {
    schema: 'aukora-swarm-cell-aura-state-v1',
    cellId: input.cellId,
    posture,
    phase,
    recomputedHead: null,
    unresolvedCount: 0,
    auraDigest,
    tsDisplay: new Date().toISOString(),
  };

  // Launch OS process
  posture = 'active';
  phase = 'SUBPROCESS_SPAWNED';
  auraDigest = computeAuraDigest(input.cellId, posture, phase, null, 0);
  auraState = { ...auraState, posture, phase, auraDigest, tsDisplay: new Date().toISOString() };

  const procRes = await spawnOSCellProcess({
    cellId: input.cellId,
    briefId: input.briefId,
    allowedLeasePrefixes: input.allowedLeasePrefixes,
    parentReceiptAnchor: input.parentReceiptAnchor,
    baseCommit: input.baseCommit,
    baseTreeDigest: input.baseTreeDigest,
    taskKind: input.fixtureTaskKind,
    hostileMode: input.hostileMode,
    timeoutMs: input.timeoutMs,
  });

  const recomputedHead = procRes.childChainHeadRecomputed || null;

  if (!procRes.ok || !procRes.cellResult) {
    const isTimeoutOrSignal = procRes.signal !== null || procRes.refusalReason === 'parent:child-process-timeout';
    posture = isTimeoutOrSignal ? 'unsettled' : 'refused';
    const verdict = isTimeoutOrSignal ? 'IN_DOUBT' : 'REFUSED';
    phase = procRes.refusalReason || procRes.error || 'EXECUTION_FAILED';
    const unresolvedCount = isTimeoutOrSignal ? 1 : 0;

    auraDigest = computeAuraDigest(input.cellId, posture, phase, recomputedHead, unresolvedCount);

    auraState = {
      schema: 'aukora-swarm-cell-aura-state-v1',
      cellId: input.cellId,
      posture,
      phase,
      recomputedHead,
      unresolvedCount,
      auraDigest,
      tsDisplay: new Date().toISOString(),
    };

    return {
      ok: false,
      verdict,
      reason: procRes.refusalReason || procRes.error || 'child process failed',
      tenantContract,
      processResult: procRes,
      auraState,
    };
  }

  // Parent verification of engine output
  const actualTestsPassed = !input.tamperTestResults;
  const v = verifyCellResult({
    cellResult: procRes.cellResult,
    allowedLeasePrefixes: input.allowedLeasePrefixes,
    diffText: procRes.diffText || '',
    expectedParentAnchor: input.parentReceiptAnchor,
    claimedTestsPassed: true,
    actualTestsPassed,
  });

  if (!v.ok || v.verdict !== 'ACCEPTED') {
    posture = v.verdict === 'IN_DOUBT' ? 'unsettled' : 'refused';
    phase = v.reason;
    const unresolvedCount = v.verdict === 'IN_DOUBT' ? 1 : 0;
    auraDigest = computeAuraDigest(input.cellId, posture, phase, recomputedHead, unresolvedCount);

    auraState = {
      schema: 'aukora-swarm-cell-aura-state-v1',
      cellId: input.cellId,
      posture,
      phase,
      recomputedHead,
      unresolvedCount,
      auraDigest,
      tsDisplay: new Date().toISOString(),
    };

    return {
      ok: false,
      verdict: v.verdict === 'IN_DOUBT' ? 'IN_DOUBT' : 'REFUSED',
      reason: `parent verifier refused engine result: ${v.reason}`,
      tenantContract,
      processResult: procRes,
      auraState,
    };
  }

  // Succeeded: format Golden Turn candidate proposal
  posture = 'proposed';
  phase = 'GOLDEN_TURN_PROPOSED';
  auraDigest = computeAuraDigest(input.cellId, posture, phase, recomputedHead, 0);

  auraState = {
    schema: 'aukora-swarm-cell-aura-state-v1',
    cellId: input.cellId,
    posture,
    phase,
    recomputedHead,
    unresolvedCount: 0,
    auraDigest,
    tsDisplay: new Date().toISOString(),
  };

  const files = procRes.cellResult.changedPaths.map((p) => {
    const abs = join(procRes.workspaceDir, p);
    const hash = existsSync(abs) ? sha256hex(readFileSync(abs)) : null;
    return { path: p, hash };
  });

  const goldenTurnProposal = {
    turnKey: `turn-${input.briefId}`,
    candidateId: `candidate-${input.cellId}`,
    baseCommit: input.baseCommit,
    proposalHash: sha256hex(procRes.diffText || ''),
    diff: procRes.diffText || '',
    files,
    state: 'proposed' as const,
  };

  return {
    ok: true,
    verdict: 'SUCCEEDED',
    reason: 'untrusted engine tenant executed successfully and verified by parent',
    tenantContract,
    processResult: procRes,
    auraState,
    goldenTurnProposal,
  };
}
