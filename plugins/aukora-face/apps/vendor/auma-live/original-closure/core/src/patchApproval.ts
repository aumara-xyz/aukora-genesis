import * as crypto from 'crypto';
import { PatchDraft } from './wombPatchDraft';
import {
  containsForbiddenContent,
  containsForbiddenCommand,
  scrubText,
  isLegacyAppPath,
} from './wombForbiddenPatterns';

export interface ApprovedScope {
  targetFiles: readonly string[];
  allowedOperations: readonly string[];
  requiredTests: readonly string[];
  maxFilesChanged: number;
  expiresAt: string;
}

export interface PatchApprovalRecord {
  approvalId: string;
  draftId: string;
  proposalId: string;
  candidateId: string;
  approvalState: 'approved' | 'refused';
  approvedBy: 'human_local' | 'kernel_test';
  approvedScope: ApprovedScope;
  refusalReason?: string;
  draftHash: string;
  proposalHash: string;
  approvalHash: string;
  createdAt: string;
  advisoryOnly: true;
  grantsAuthority: false;
  aumlokRootId?: string;
  aumlokBindingHash?: string;
}

export interface ApprovalInput {
  draft: PatchDraft;
  approvedBy: 'human_local' | 'kernel_test';
  expiresInMs?: number;
}

const DEFAULT_EXPIRY_MS = 30 * 60 * 1000;

const ALLOWED_OPERATIONS: readonly string[] = ['apply_candidate_diff'];

function sha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function createPatchApproval(input: ApprovalInput): PatchApprovalRecord {
  const { draft, approvedBy, expiresInMs } = input;

  if (draft.riskLevel === 'HIGH') {
    return refusePatchDraft({ draft, approvedBy, reason: 'HIGH-risk drafts cannot be approved in 24N' });
  }

  if (draft.targetFiles.some(isLegacyAppPath)) {
    return refusePatchDraft({ draft, approvedBy, reason: 'Target files include legacy app paths — refused by policy' });
  }

  if (draft.refusalReason) {
    return refusePatchDraft({ draft, approvedBy, reason: `Draft was already refused: ${scrubText(draft.refusalReason)}` });
  }

  const textFields = [draft.summary, ...draft.proposedChanges, ...draft.targetFiles, ...draft.requiredTests];
  if (draft.candidateDiff) textFields.push(draft.candidateDiff);
  const textConcat = textFields.join(' ');
  if (containsForbiddenContent(textConcat) || containsForbiddenCommand(textConcat)) {
    return refusePatchDraft({ draft, approvedBy, reason: 'Draft contains forbidden content or command patterns' });
  }

  const now = new Date();
  const expiry = new Date(now.getTime() + (expiresInMs ?? DEFAULT_EXPIRY_MS));

  const approvedScope: ApprovedScope = {
    targetFiles: [...draft.targetFiles],
    allowedOperations: [...ALLOWED_OPERATIONS],
    requiredTests: [...draft.requiredTests],
    maxFilesChanged: Math.max(draft.targetFiles.length, 1),
    expiresAt: expiry.toISOString(),
  };

  const approvalId = 'approval_' + sha256(JSON.stringify({
    draftId: draft.draftId,
    draftHash: draft.hashes.draftHash,
    proposalId: draft.proposalId,
    approvedBy,
  })).slice(0, 16);

  const approvalHash = sha256(JSON.stringify({
    approvalId,
    draftId: draft.draftId,
    proposalId: draft.proposalId,
    approvedScope,
    approvalState: 'approved',
  }));

  return {
    approvalId,
    draftId: draft.draftId,
    proposalId: draft.proposalId,
    candidateId: draft.candidateId,
    approvalState: 'approved',
    approvedBy,
    approvedScope,
    draftHash: draft.hashes.draftHash,
    proposalHash: draft.hashes.proposalHash,
    approvalHash,
    createdAt: now.toISOString(),
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

export function refusePatchDraft(input: {
  draft: PatchDraft;
  approvedBy: 'human_local' | 'kernel_test';
  reason: string;
}): PatchApprovalRecord {
  const { draft, approvedBy, reason } = input;
  const now = new Date();

  const approvalId = 'approval_' + sha256(JSON.stringify({
    draftId: draft.draftId,
    draftHash: draft.hashes.draftHash,
    proposalId: draft.proposalId,
    approvedBy,
    refused: true,
  })).slice(0, 16);

  const approvalHash = sha256(JSON.stringify({
    approvalId,
    draftId: draft.draftId,
    proposalId: draft.proposalId,
    approvalState: 'refused',
    reason: scrubText(reason),
  }));

  return {
    approvalId,
    draftId: draft.draftId,
    proposalId: draft.proposalId,
    candidateId: draft.candidateId,
    approvalState: 'refused',
    approvedBy,
    approvedScope: {
      targetFiles: [],
      allowedOperations: [],
      requiredTests: [],
      maxFilesChanged: 0,
      expiresAt: now.toISOString(),
    },
    refusalReason: scrubText(reason),
    draftHash: draft.hashes.draftHash,
    proposalHash: draft.hashes.proposalHash,
    approvalHash,
    createdAt: now.toISOString(),
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

export function validatePatchApproval(
  record: PatchApprovalRecord,
  draft: PatchDraft,
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  if (!record.advisoryOnly) violations.push('advisoryOnly must be true');
  if (record.grantsAuthority !== false) violations.push('grantsAuthority must be false');
  if (!record.approvalId.startsWith('approval_')) violations.push('approvalId must start with approval_');

  if (record.draftId !== draft.draftId) violations.push('draftId mismatch');
  if (record.draftHash !== draft.hashes.draftHash) violations.push('draftHash mismatch');
  if (record.proposalId !== draft.proposalId) violations.push('proposalId mismatch');

  if (record.approvalState === 'approved') {
    const scopeTargets = new Set(record.approvedScope.targetFiles);
    for (const t of draft.targetFiles) {
      if (!scopeTargets.has(t)) violations.push(`approvedScope.targetFiles missing draft target: ${t}`);
    }
    for (const t of record.approvedScope.targetFiles) {
      if (!draft.targetFiles.includes(t)) violations.push(`approvedScope.targetFiles widens beyond draft: ${t}`);
    }

    const scopeTests = new Set(record.approvedScope.requiredTests);
    for (const t of draft.requiredTests) {
      if (!scopeTests.has(t)) violations.push(`approvedScope.requiredTests missing draft test: ${t}`);
    }

    if (record.approvedScope.maxFilesChanged < draft.targetFiles.length) {
      violations.push('maxFilesChanged is less than draft target file count');
    }

    const now = new Date();
    const expires = new Date(record.approvedScope.expiresAt);
    if (expires <= now) violations.push('approval has expired');

    if (draft.riskLevel === 'HIGH') violations.push('HIGH-risk drafts cannot be approved');
  }

  if (record.approvalState === 'refused') {
    if (!record.refusalReason) violations.push('refused approval must have refusalReason');
  }

  const json = JSON.stringify(record);
  if (/sk-or-[a-zA-Z0-9_-]{16,}/.test(json)) violations.push('API key pattern found');
  if (/\b[a-fA-F0-9]{96,}\b/.test(json)) violations.push('possible key material found');
  if ((record as any).pop) violations.push('PoP field present');
  if ((record as any).signature) violations.push('signature field present');
  if ((record as any).signedHead) violations.push('signedHead field present');
  if ((record as any).merkleRoot) violations.push('merkleRoot field present');

  return { valid: violations.length === 0, violations };
}

export function hashPatchApproval(record: PatchApprovalRecord): string {
  return sha256(JSON.stringify({
    approvalId: record.approvalId,
    draftId: record.draftId,
    proposalId: record.proposalId,
    approvalState: record.approvalState,
    draftHash: record.draftHash,
    proposalHash: record.proposalHash,
    approvedScope: record.approvedScope,
  }));
}

export function sanitizeApprovalForArtifact(record: PatchApprovalRecord): {
  approvalId: string;
  draftId: string;
  proposalId: string;
  candidateId: string;
  approvalState: 'approved' | 'refused';
  approvedScope: {
    targetFiles: readonly string[];
    allowedOperations: readonly string[];
    requiredTests: readonly string[];
    maxFilesChanged: number;
    expiresAt: string;
  };
  refusalReason?: string;
  advisoryOnly: true;
  grantsAuthority: false;
} {
  const sanitized: any = {
    approvalId: record.approvalId,
    draftId: record.draftId,
    proposalId: record.proposalId,
    candidateId: record.candidateId,
    approvalState: record.approvalState,
    approvedScope: {
      targetFiles: [...record.approvedScope.targetFiles],
      allowedOperations: [...record.approvedScope.allowedOperations],
      requiredTests: [...record.approvedScope.requiredTests],
      maxFilesChanged: record.approvedScope.maxFilesChanged,
      expiresAt: record.approvedScope.expiresAt,
    },
    advisoryOnly: true,
    grantsAuthority: false,
  };
  if (record.refusalReason) {
    sanitized.refusalReason = scrubText(record.refusalReason);
  }
  return sanitized;
}

export function isApplyEligibleApproval(record: PatchApprovalRecord): { eligible: false; reasons: string[] } {
  const reasons: string[] = [];
  if (record.approvedBy === 'kernel_test') reasons.push('kernel_test approvals are not apply-eligible');
  if (record.grantsAuthority !== false) reasons.push('grantsAuthority is not false');
  if (!record.advisoryOnly) reasons.push('not advisoryOnly');
  if (record.approvalState !== 'approved') reasons.push('approval state is not approved');
  if (reasons.length === 0) reasons.push('no apply lane exists');
  return { eligible: false, reasons };
}
