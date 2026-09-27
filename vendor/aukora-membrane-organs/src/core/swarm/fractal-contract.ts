// core/swarm/fractal-contract.ts — Move 37.9: Fractal Cell Evidence Binding & Dual Zipper Commitments
//
// Aligns strictly with WorkerBriefV1.json, CellResultV1.json, PathLeaseV1.json, DecompositionProposalV1.json.
// Enforces canonical literal path segment containment, exact byte evidence recomputation,
// distinct cycle refusal, parent-observed test evidence verification, and dual zipper commitments.
//
// RUNTIME SPAWNING: OFF (Contract-only verification; zero recursive runtime spawning)

import { createHash } from 'node:crypto';

export const sha256hex = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

export const MAX_FRACTAL_DEPTH = 3;
export const MAX_TREE_WORKERS = 10;

export type FractalStatus = 'proposed' | 'accepted' | 'rejected' | 'superseded' | 'interrupted' | 'in_doubt';

export interface BudgetQuotaV1 {
  maxTokens: number;
  maxWallClockMs: number;
  maxCostCents: number;
  maxEffects: number;
}

export interface WorkerBriefPayloadV1 {
  briefId: string;
  campaignId: string;
  allowPaths: string[];
  budget: BudgetQuotaV1;
  allowedTools: string[];
  networkPolicy: 'deny' | 'allow';
}

export interface CellResultPayloadV1 {
  cellId: string;
  status: FractalStatus;
  resultDigest: string;
  candidateDigest?: string;
}

export interface TestEvidenceV1 {
  testSuiteId: string;
  passedCount: number;
  failedCount: number;
  evidenceDigest: string;
}

export interface FractalCellNodeV1 {
  cellId: string; // Maps to childBriefId / briefId
  campaignId: string;
  depth: number; // 1-based (parent = 1, child = 2, grandchild = 3)
  parentCellId: string | null;
  parentReceiptAnchor: string; // Maps to parentChainAnchor
  idempotencyKey: string;
  allowedLeasePrefixes: string[]; // Literal segment path prefixes
  fileLeases?: { path: string; isDirectory: boolean }[];
  budget: BudgetQuotaV1; // Maps to WorkerBriefV1 budget
  allowedTools: string[];
  networkPolicy: 'deny' | 'allow';
  status: FractalStatus;
  briefPayload?: WorkerBriefPayloadV1;
  briefDigest: string;
  candidateContent?: string;
  candidateDigest?: string;
  proposalDigest?: string;
  childChainHead?: string;
  changedPaths?: string[];
  testEvidence?: TestEvidenceV1;
  identityBound: false;
  children?: FractalCellNodeV1[];
}

export interface FractalDecompositionRequestV1 {
  campaignId: string;
  campaignRootAnchor: string;
  rootCell: FractalCellNodeV1;
}

export interface FractalVerificationResultV1 {
  ok: boolean;
  refusalReason: string | null;
  auditManifestDigest?: string;
  applySetDigest?: string;
}

/** 1. Exact Byte Evidence Digest Recomputation */
export function serializeCanonicalBrief(brief: WorkerBriefPayloadV1): string {
  return JSON.stringify({
    briefId: brief.briefId,
    campaignId: brief.campaignId,
    allowPaths: [...brief.allowPaths].sort(),
    budget: brief.budget,
    allowedTools: [...brief.allowedTools].sort(),
    networkPolicy: brief.networkPolicy,
  });
}

export function computeCanonicalBriefDigest(brief: WorkerBriefPayloadV1): string {
  return sha256hex(serializeCanonicalBrief(brief));
}

export function serializeCanonicalTestEvidence(ev: TestEvidenceV1): string {
  return JSON.stringify({
    testSuiteId: ev.testSuiteId,
    passedCount: ev.passedCount,
    failedCount: ev.failedCount,
  });
}

export function computeCanonicalTestEvidenceDigest(ev: TestEvidenceV1): string {
  return sha256hex(serializeCanonicalTestEvidence(ev));
}

/** 2. Canonical Literal Segment Path Containment (Glob wildcards refused) */
export function normalizeCanonicalPathSegments(rawPath: string): { ok: boolean; segments: string[]; error?: string } {
  if (rawPath.includes('\0')) {
    return { ok: false, segments: [], error: 'REFUSED_PATH_NUL_BYTE' };
  }
  if (rawPath !== rawPath.normalize('NFC')) {
    return { ok: false, segments: [], error: 'REFUSED_PATH_UNICODE_ALIAS' };
  }
  if (rawPath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(rawPath)) {
    return { ok: false, segments: [], error: 'REFUSED_PATH_ABSOLUTE' };
  }
  if (rawPath.includes('//') || rawPath.includes('\\\\')) {
    return { ok: false, segments: [], error: 'REFUSED_PATH_REPEATED_SEPARATORS' };
  }

  // Refuse wildcards: Globs explicitly classified as NOT IMPLEMENTED / LITERAL PREFIXES ONLY
  if (/[*?\[\]]/.test(rawPath)) {
    return { ok: false, segments: [], error: 'REFUSED_GLOB_WILDCARDS_NOT_IMPLEMENTED' };
  }

  const parts = rawPath.split(/[/\\]/);
  const segments: string[] = [];

  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') {
      return { ok: false, segments: [], error: 'REFUSED_PATH_TRAVERSAL_DOTDOT' };
    }
    segments.push(p);
  }

  return { ok: true, segments };
}

/** Strict literal path segment containment check */
export function isCanonicalPathContained(parentPath: string, childPath: string): boolean {
  const pNorm = normalizeCanonicalPathSegments(parentPath);
  const cNorm = normalizeCanonicalPathSegments(childPath);

  if (!pNorm.ok || !cNorm.ok) return false;

  const pSegs = pNorm.segments;
  const cSegs = cNorm.segments;

  if (cSegs.length < pSegs.length) return false;

  for (let i = 0; i < pSegs.length; i++) {
    if (pSegs[i] !== cSegs[i]) return false;
  }

  return true;
}

export function verifyCanonicalLeaseSubset(parentLeases: string[], childLeases: string[]): boolean {
  for (const cPath of childLeases) {
    let matched = false;
    for (const pPath of parentLeases) {
      if (isCanonicalPathContained(pPath, cPath)) {
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }
  return true;
}

export function verifyFileLeaseTypes(parentLeases?: { path: string; isDirectory: boolean }[], childLeases?: { path: string; isDirectory: boolean }[]): boolean {
  if (!childLeases || childLeases.length === 0) return true;
  if (!parentLeases) return false;

  for (const childLease of childLeases) {
    const parentMatch = parentLeases.find((p) => p.path === childLease.path || isCanonicalPathContained(p.path, childLease.path));
    if (!parentMatch) return false;
    if (!parentMatch.isDirectory && childLease.isDirectory) return false;
  }
  return true;
}

export function verifySiblingLeaseNoOverlap(children: FractalCellNodeV1[]): { ok: boolean; collidingPair?: [string, string] } {
  for (let i = 0; i < children.length; i++) {
    for (let j = i + 1; j < children.length; j++) {
      const childA = children[i];
      const childB = children[j];
      for (const pathA of childA.allowedLeasePrefixes) {
        for (const pathB of childB.allowedLeasePrefixes) {
          if (isCanonicalPathContained(pathA, pathB) || isCanonicalPathContained(pathB, pathA)) {
            return { ok: false, collidingPair: [childA.cellId, childB.cellId] };
          }
        }
      }
    }
  }
  return { ok: true };
}

/** 3. Graph & Conservation Verification */
export interface TreeConservationTotals {
  totalTokens: number;
  totalWallClockMs: number;
  totalCostCents: number;
  totalEffects: number;
  totalWorkers: number;
  allCellIds: Set<string>;
  allIdempotencyKeys: Set<string>;
  ancestorStack: string[];
}

export function computeSubtreeConservation(node: FractalCellNodeV1, totals: TreeConservationTotals, campaignId: string, expectedAnchor: string): { ok: boolean; refusalReason?: string } {
  // Cycle detection (active ancestor stack check)
  if (totals.ancestorStack.includes(node.cellId)) {
    return { ok: false, refusalReason: `REFUSED_GRAPH_CYCLE (cellId ${node.cellId} creates ancestor cycle)` };
  }
  totals.ancestorStack.push(node.cellId);

  // Unique cellId check across global campaign tree
  if (totals.allCellIds.has(node.cellId)) {
    totals.ancestorStack.pop();
    return { ok: false, refusalReason: `REFUSED_DUPLICATE_CELL_ID (cellId ${node.cellId} repeated in campaign)` };
  }
  totals.allCellIds.add(node.cellId);

  // Check unique idempotency key across campaign
  if (totals.allIdempotencyKeys.has(node.idempotencyKey)) {
    totals.ancestorStack.pop();
    return { ok: false, refusalReason: `REFUSED_DUPLICATE_IDEMPOTENCY (idempotencyKey ${node.idempotencyKey} repeated across campaign)` };
  }
  totals.allIdempotencyKeys.add(node.idempotencyKey);

  // Check campaignId alignment
  if (node.campaignId !== campaignId) {
    totals.ancestorStack.pop();
    return { ok: false, refusalReason: `REFUSED_CAMPAIGN_MISMATCH (cell ${node.cellId} campaign ${node.campaignId} != ${campaignId})` };
  }

  // Transitive anchor continuity check
  if (node.parentReceiptAnchor !== expectedAnchor) {
    totals.ancestorStack.pop();
    return { ok: false, refusalReason: `REFUSED_TRANSITIVE_ANCHOR_DISCONTINUITY (cell ${node.cellId} anchor ${node.parentReceiptAnchor} != ${expectedAnchor})` };
  }

  // Brief digest recomputation check
  if (node.briefPayload) {
    const computedBriefDigest = computeCanonicalBriefDigest(node.briefPayload);
    if (node.briefDigest !== computedBriefDigest) {
      totals.ancestorStack.pop();
      return { ok: false, refusalReason: `REFUSED_BRIEF_DIGEST_MISMATCH (cell ${node.cellId} briefDigest ${node.briefDigest} != ${computedBriefDigest})` };
    }
  } else if (typeof node.briefDigest !== 'string' || !/^[0-9a-f]{64}$/.test(node.briefDigest)) {
    totals.ancestorStack.pop();
    return { ok: false, refusalReason: `REFUSED_BRIEF_DIGEST_MISMATCH (cell ${node.cellId} briefDigest invalid)` };
  }

  // Candidate digest recomputation check
  if (node.candidateContent) {
    const computedCandDigest = sha256hex(node.candidateContent);
    if (node.candidateDigest !== computedCandDigest) {
      totals.ancestorStack.pop();
      return { ok: false, refusalReason: `REFUSED_CANDIDATE_DIGEST_MISMATCH (cell ${node.cellId} candidateDigest ${node.candidateDigest} != ${computedCandDigest})` };
    }
  }

  // Status & Test Evidence verification
  if (node.status === 'accepted') {
    if (!node.candidateDigest || !/^[0-9a-f]{64}$/.test(node.candidateDigest)) {
      totals.ancestorStack.pop();
      return { ok: false, refusalReason: `REFUSED_CANDIDATE_DIGEST_MISMATCH (accepted cell ${node.cellId} missing valid candidateDigest)` };
    }
    if (!node.testEvidence || node.testEvidence.failedCount > 0 || node.testEvidence.passedCount === 0) {
      totals.ancestorStack.pop();
      return { ok: false, refusalReason: `REFUSED_MISSING_TEST_EVIDENCE (accepted cell ${node.cellId} missing passing test evidence)` };
    }
    // Recompute test evidence digest
    const computedEvDigest = computeCanonicalTestEvidenceDigest(node.testEvidence);
    if (node.testEvidence.evidenceDigest !== computedEvDigest) {
      totals.ancestorStack.pop();
      return { ok: false, refusalReason: `REFUSED_TEST_EVIDENCE_DIGEST_MISMATCH (cell ${node.cellId} testEvidenceDigest ${node.testEvidence.evidenceDigest} != ${computedEvDigest})` };
    }
  }

  totals.totalWorkers += 1;
  totals.totalTokens += node.budget.maxTokens;
  totals.totalWallClockMs += node.budget.maxWallClockMs;
  totals.totalCostCents += node.budget.maxCostCents;
  totals.totalEffects += node.budget.maxEffects;

  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      if (child.depth !== node.depth + 1) {
        totals.ancestorStack.pop();
        return { ok: false, refusalReason: `REFUSED_INVALID_DEPTH_STEP (parent depth ${node.depth}, child depth ${child.depth})` };
      }
      if (child.parentCellId !== node.cellId) {
        totals.ancestorStack.pop();
        return { ok: false, refusalReason: `REFUSED_WRONG_PARENT_CELL_ID (child ${child.cellId} parent ${child.parentCellId} != ${node.cellId})` };
      }
      if (!verifyCanonicalLeaseSubset(node.allowedLeasePrefixes, child.allowedLeasePrefixes)) {
        totals.ancestorStack.pop();
        return { ok: false, refusalReason: `REFUSED_LEASE_WIDENED (child ${child.cellId} lease extends outside parent)` };
      }
      if (!verifyFileLeaseTypes(node.fileLeases, child.fileLeases)) {
        totals.ancestorStack.pop();
        return { ok: false, refusalReason: `REFUSED_FILE_LEASE_TYPE_MISMATCH (child ${child.cellId} widens file to directory)` };
      }
      // Budget subtree checks
      if (child.budget.maxTokens > node.budget.maxTokens) {
        totals.ancestorStack.pop();
        return { ok: false, refusalReason: `REFUSED_TOKEN_INFLATION (child ${child.cellId} tokens > parent)` };
      }
      if (child.budget.maxWallClockMs > node.budget.maxWallClockMs) {
        totals.ancestorStack.pop();
        return { ok: false, refusalReason: `REFUSED_WALLCLOCK_INFLATION (child ${child.cellId} wall-clock > parent)` };
      }
      if (child.budget.maxCostCents > node.budget.maxCostCents) {
        totals.ancestorStack.pop();
        return { ok: false, refusalReason: `REFUSED_COST_INFLATION (child ${child.cellId} cost > parent)` };
      }
      if (child.budget.maxEffects > node.budget.maxEffects) {
        totals.ancestorStack.pop();
        return { ok: false, refusalReason: `REFUSED_EFFECTS_INFLATION (child ${child.cellId} effects > parent)` };
      }

      // Tool subset check
      for (const tool of child.allowedTools) {
        if (!node.allowedTools.includes(tool)) {
          totals.ancestorStack.pop();
          return { ok: false, refusalReason: `REFUSED_TOOL_AUTHORITY_WIDENED (child ${child.cellId} tool ${tool} not in parent)` };
        }
      }
      // Network policy subset check
      if (node.networkPolicy === 'deny' && child.networkPolicy !== 'deny') {
        totals.ancestorStack.pop();
        return { ok: false, refusalReason: `REFUSED_NETWORK_AUTHORITY_WIDENED (child ${child.cellId} widens network from deny to allow)` };
      }

      const childRes = computeSubtreeConservation(child, totals, campaignId, node.parentReceiptAnchor);
      if (!childRes.ok) {
        totals.ancestorStack.pop();
        return childRes;
      }
    }

    const sibCheck = verifySiblingLeaseNoOverlap(node.children);
    if (!sibCheck.ok) {
      totals.ancestorStack.pop();
      return { ok: false, refusalReason: `REFUSED_SIBLING_LEASE_COLLISION (children ${sibCheck.collidingPair?.join(' and ')} overlap)` };
    }
  }

  totals.ancestorStack.pop();
  return { ok: true };
}

/** Complete whole-tree graph and conservation verification */
export function verifyWholeTreeConservation(req: FractalDecompositionRequestV1): FractalVerificationResultV1 {
  const { campaignId, campaignRootAnchor, rootCell } = req;

  if (rootCell.depth !== 1) {
    return { ok: false, refusalReason: `REFUSED_ROOT_DEPTH_MUST_BE_1 (root depth is ${rootCell.depth})` };
  }
  if (rootCell.parentReceiptAnchor !== campaignRootAnchor) {
    return { ok: false, refusalReason: `REFUSED_CAMPAIGN_ROOT_ANCHOR_MISMATCH (root anchor ${rootCell.parentReceiptAnchor} != ${campaignRootAnchor})` };
  }
  if (rootCell.identityBound !== false) {
    return { ok: false, refusalReason: 'REFUSED_IDENTITY_BOUND_WIDENED' };
  }

  const totals: TreeConservationTotals = {
    totalTokens: 0,
    totalWallClockMs: 0,
    totalCostCents: 0,
    totalEffects: 0,
    totalWorkers: 0,
    allCellIds: new Set(),
    allIdempotencyKeys: new Set(),
    ancestorStack: [],
  };

  const subRes = computeSubtreeConservation(rootCell, totals, campaignId, campaignRootAnchor);
  if (!subRes.ok) {
    return { ok: false, refusalReason: subRes.refusalReason! };
  }

  if (totals.totalWorkers > MAX_TREE_WORKERS) {
    return { ok: false, refusalReason: `REFUSED_MAX_TREE_WORKERS_EXCEEDED (total workers ${totals.totalWorkers} > max ${MAX_TREE_WORKERS})` };
  }

  const auditManifestString = serializeCanonicalCampaignManifest(rootCell);
  const auditManifestDigest = sha256hex(auditManifestString);

  return { ok: true, refusalReason: null, auditManifestDigest };
}

/** 4. Canonical Deterministic Manifest Serialization */
export function serializeCanonicalCampaignManifest(node: FractalCellNodeV1): string {
  const sortedChildren = node.children
    ? [...node.children].sort((a, b) => a.cellId.localeCompare(b.cellId))
    : [];

  const serializedChildren = sortedChildren.map((c) => serializeCanonicalCampaignManifest(c));

  return JSON.stringify({
    cellId: node.cellId,
    campaignId: node.campaignId,
    depth: node.depth,
    parentCellId: node.parentCellId,
    parentReceiptAnchor: node.parentReceiptAnchor,
    idempotencyKey: node.idempotencyKey,
    allowedLeasePrefixes: [...node.allowedLeasePrefixes].sort(),
    budget: node.budget,
    allowedTools: [...node.allowedTools].sort(),
    networkPolicy: node.networkPolicy,
    status: node.status,
    briefDigest: node.briefDigest,
    candidateDigest: node.candidateDigest ?? null,
    testEvidenceDigest: node.testEvidence?.evidenceDigest ?? null,
    children: serializedChildren,
  });
}

/** 5. Dual Zipper Commitments (auditManifestDigest vs applySetDigest) */
export interface DualZipperMergeResultV1 {
  ok: boolean;
  refusalReason?: string;
  auditManifestDigest?: string;
  applySetDigest?: string;
}

export function zipperMergeResults(childResults: { cellId: string; status: FractalStatus; resultDigest: string; candidateDigest?: string; briefDigest?: string; testEvidenceDigest?: string }[]): DualZipperMergeResultV1 {
  const sorted = [...childResults].sort((a, b) => a.cellId.localeCompare(b.cellId));

  const inDoubt = sorted.filter((r) => r.status === 'in_doubt' || r.status === 'interrupted');
  if (inDoubt.length > 0) {
    return { ok: false, refusalReason: `REFUSED_UNRESOLVED_CONFLICT (child ${inDoubt[0].cellId} status is ${inDoubt[0].status})` };
  }

  // auditManifestDigest commits to EVERY child and disposition (including rejected, superseded)
  const auditItems = sorted.map((c) => `${c.cellId}:${c.status}:${c.resultDigest}:${c.candidateDigest ?? 'nocand'}:${c.testEvidenceDigest ?? 'noev'}`);
  const auditManifestDigest = sha256hex(auditItems.join(';'));

  // applySetDigest commits ONLY to exact ACCEPTED candidate bytes eligible for Golden Turn
  const accepted = sorted.filter((r) => r.status === 'accepted');
  const applyItems = accepted.map((a) => `${a.cellId}:accepted:${a.candidateDigest ?? 'nocand'}`);
  const applySetDigest = sha256hex(applyItems.join(';'));

  return { ok: true, auditManifestDigest, applySetDigest };
}
