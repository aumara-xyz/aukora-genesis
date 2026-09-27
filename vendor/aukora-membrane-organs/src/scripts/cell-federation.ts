// scripts/cell-federation.ts — Brick C2: Federation Runner for Sibling Aukora Cells
//
// Orchestrates concurrent execution of sibling cells under disjoint PathLeaseV1 contracts.
// Composes verified cell outputs into a canonical IntegrationManifestV1 and Golden Turn proposal.

import { createHash } from 'node:crypto';
import { runLocalCell, type CellExecutionOutput, type CellRunnerInput } from './cell-runner';
import { verifyCellResult, verifyPathInLease, type CellResultV1, type CellVerificationVerdict } from '../core/swarm/cell-verifier';
import { Journal } from '../core/journal';

const sha256hex = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

export interface SiblingCellConfig {
  cellId: string;
  briefId: string;
  allowedLeasePrefixes: string[];
  fixtureTask: (workspaceDir: string) => { changedPaths: string[]; diffText: string; testsPassed: boolean };
  simulateInterruption?: boolean;
  tamperDiffText?: string;          // For falsification testing
  tamperParentAnchor?: string;      // For falsification testing
}

export interface CampaignInput {
  campaignId: string;
  parentReceiptAnchor: string;
  baseCommit: string;
  baseTreeDigest: string;
  siblings: SiblingCellConfig[];
  fixedTimestamp?: string;          // For deterministic manifest digest testing
}

export interface IntegrationManifestV1 {
  schema: 'aukora-swarm-integration-manifest-v1';
  integrationId: string;
  campaignId: string;
  baseCommit: string;
  baseTreeDigest: string;
  landOrder: string[];
  patchHashes: string[];
  conflicts: string[];
  state: 'gathered' | 'composed' | 'landed' | 'conflicted' | 'halted';
  createdAt: string;
}

export interface FederationOutput {
  ok: boolean;
  verdict: 'COMPOSED' | 'HALTED' | 'REJECTED';
  reason: string;
  concurrencyTiming: {
    startMs: number;
    finishMs: number;
    cellTimings: Array<{ cellId: string; startMs: number; finishMs: number }>;
  };
  cellResults: CellResultV1[];
  childChainHeads: Array<{ cellId: string; head: string }>;
  integrationManifest?: IntegrationManifestV1;
  integrationManifestDigest?: string;
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

/** Check if two sibling lease prefix sets overlap. */
export function checkLeaseOverlap(leaseA: string[], leaseB: string[]): { overlap: boolean; path?: string } {
  for (const a of leaseA) {
    const cleanA = a.replace(/\\/g, '/').replace(/\/+$/, '');
    for (const b of leaseB) {
      const cleanB = b.replace(/\\/g, '/').replace(/\/+$/, '');
      if (cleanA === cleanB || cleanA.startsWith(cleanB + '/') || cleanB.startsWith(cleanA + '/')) {
        return { overlap: true, path: `${a} <-> ${b}` };
      }
    }
  }
  return { overlap: false };
}

/** Orchestrate concurrent sibling cells under parent governance. */
export async function runCellFederation(input: CampaignInput): Promise<FederationOutput> {
  const { campaignId, parentReceiptAnchor, baseCommit, baseTreeDigest, siblings } = input;

  // 1. Pre-execution check: disjoint lease enforcement
  for (let i = 0; i < siblings.length; i++) {
    for (let j = i + 1; j < siblings.length; j++) {
      const check = checkLeaseOverlap(siblings[i].allowedLeasePrefixes, siblings[j].allowedLeasePrefixes);
      if (check.overlap) {
        return {
          ok: false,
          verdict: 'REJECTED',
          reason: `overlapping leases detected between ${siblings[i].cellId} and ${siblings[j].cellId} (${check.path})`,
          concurrencyTiming: { startMs: Date.now(), finishMs: Date.now(), cellTimings: [] },
          cellResults: [],
          childChainHeads: [],
        };
      }
    }
  }

  // 2. Concurrent execution of sibling cells
  const overallStart = Date.now();
  const cellTimings: Array<{ cellId: string; startMs: number; finishMs: number }> = [];

  const cellPromises = siblings.map(async (sib) => {
    const startMs = Date.now();
    await new Promise((r) => setTimeout(r, 10));

    const runnerInput: CellRunnerInput = {
      cellId: sib.cellId,
      briefId: sib.briefId,
      allowedLeasePrefixes: sib.allowedLeasePrefixes,
      parentReceiptAnchor: sib.tamperParentAnchor ?? parentReceiptAnchor,
      baseCommit,
      baseTreeDigest,
      fixtureTask: sib.fixtureTask,
      simulateInterruption: sib.simulateInterruption,
    };

    const exec = runLocalCell(runnerInput);
    if (sib.tamperDiffText) {
      exec.diffText = sib.tamperDiffText;
    }

    const finishMs = Date.now();
    cellTimings.push({ cellId: sib.cellId, startMs, finishMs });
    return { sib, exec };
  });

  const results = await Promise.all(cellPromises);
  const overallFinish = Date.now();

  // 3. Parent verification of sibling outputs
  const cellResults: CellResultV1[] = [];
  const childChainHeads: Array<{ cellId: string; head: string }> = [];
  const allChangedPaths: Map<string, string> = new Map();
  const conflicts: string[] = [];

  let combinedDiff = '';

  for (const { sib, exec } of results) {
    const r = exec.cellResult;
    cellResults.push(r);
    childChainHeads.push({ cellId: sib.cellId, head: exec.childChainHead });

    // Verify cell result independently (using actual test execution result)
    const v = verifyCellResult({
      cellResult: r,
      allowedLeasePrefixes: sib.allowedLeasePrefixes,
      diffText: exec.diffText,
      expectedParentAnchor: parentReceiptAnchor,
      claimedTestsPassed: true,
      actualTestsPassed: exec.testsPassed,
    });

    if (!v.ok || v.verdict !== 'ACCEPTED') {
      return {
        ok: false,
        verdict: 'HALTED',
        reason: `sibling cell ${sib.cellId} failed parent verification: ${v.reason}`,
        concurrencyTiming: { startMs: overallStart, finishMs: overallFinish, cellTimings },
        cellResults,
        childChainHeads,
      };
    }

    // Check for same-path collisions across siblings
    for (const path of r.changedPaths) {
      if (allChangedPaths.has(path)) {
        conflicts.push(`path collision on "${path}" between ${allChangedPaths.get(path)} and ${sib.cellId}`);
      }
      allChangedPaths.set(path, sib.cellId);
    }

    combinedDiff += (combinedDiff ? '\n' : '') + exec.diffText;
  }

  if (conflicts.length > 0) {
    return {
      ok: false,
      verdict: 'HALTED',
      reason: `sibling integration halted due to path conflicts: ${conflicts.join('; ')}`,
      concurrencyTiming: { startMs: overallStart, finishMs: overallFinish, cellTimings },
      cellResults,
      childChainHeads,
    };
  }

  // 4. Construct canonical IntegrationManifestV1 (deterministic sorting by briefId)
  const sortedResults = [...cellResults].sort((a, b) => a.briefId.localeCompare(b.briefId));
  const landOrder = sortedResults.map((r) => r.briefId);
  const patchHashes = sortedResults.map((r) => r.proposalDigest);

  const integrationManifest: IntegrationManifestV1 = {
    schema: 'aukora-swarm-integration-manifest-v1',
    integrationId: `integ-${campaignId}`,
    campaignId,
    baseCommit,
    baseTreeDigest,
    landOrder,
    patchHashes,
    conflicts: [],
    state: 'composed',
    createdAt: input.fixedTimestamp ?? '2026-08-06T10:00:00Z',
  };

  const integrationManifestDigest = sha256hex(JSON.stringify(integrationManifest));

  // 5. Format Golden Turn proposal for composed integration
  const filesList = Array.from(allChangedPaths.keys()).map((p) => ({ path: p, hash: sha256hex(p) }));
  const proposalHash = Journal.intentDigestOf({
    baseCommit,
    diff: combinedDiff,
    files: JSON.stringify(filesList),
  });

  const goldenTurnProposal = {
    turnKey: `turn-campaign-${campaignId}`,
    candidateId: `candidate-campaign-${campaignId}`,
    baseCommit,
    proposalHash,
    diff: combinedDiff,
    files: filesList,
    state: 'proposed' as const,
  };

  return {
    ok: true,
    verdict: 'COMPOSED',
    reason: 'all sibling cells verified and composed into IntegrationManifestV1',
    concurrencyTiming: { startMs: overallStart, finishMs: overallFinish, cellTimings },
    cellResults,
    childChainHeads,
    integrationManifest,
    integrationManifestDigest,
    goldenTurnProposal,
  };
}
