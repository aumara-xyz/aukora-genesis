import * as crypto from 'crypto';
import { PatchApprovalRecord } from './patchApproval';

export interface AumlokApprovalRoot {
  rootId: string;
  publicFingerprint: string;
  createdAt: string;
  mode: 'local_stub';
  advisoryOnly: true;
  grantsAuthority: false;
}

export interface AumlokApprovalSignature {
  approvalId: string;
  draftId: string;
  proposalId: string;
  rootId: string;
  approvalHash: string;
  signatureHash: string;
  signedAt: string;
  mode: 'local_stub';
  advisoryOnly: true;
  grantsAuthority: false;
}

export interface AumlokApprovalBinding {
  approval: PatchApprovalRecord;
  root: AumlokApprovalRoot;
  signature: AumlokApprovalSignature;
  verified: boolean;
  advisoryOnly: true;
  grantsAuthority: false;
}

function sha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function canonicalBindingPayload(fields: Record<string, string>): string {
  return Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join('|');
}

const LOCAL_STUB_SEED = 'aumlok-local-stub-root-v1';

export function createLocalAumlokRoot(): AumlokApprovalRoot {
  const rootId = 'aumlok_root_' + sha256(LOCAL_STUB_SEED).slice(0, 16);
  return {
    rootId,
    publicFingerprint: sha256(rootId).slice(0, 16),
    createdAt: new Date().toISOString(),
    mode: 'local_stub',
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

export function signPatchApprovalWithAumlokRoot(
  approval: PatchApprovalRecord,
  root: AumlokApprovalRoot,
): AumlokApprovalSignature {
  const signatureHash = sha256(canonicalBindingPayload({
    approvalHash: approval.approvalHash,
    approvalId: approval.approvalId,
    draftId: approval.draftId,
    mode: 'local_stub',
    proposalId: approval.proposalId,
    rootId: root.rootId,
  }));

  return {
    approvalId: approval.approvalId,
    draftId: approval.draftId,
    proposalId: approval.proposalId,
    rootId: root.rootId,
    approvalHash: approval.approvalHash,
    signatureHash,
    signedAt: new Date().toISOString(),
    mode: 'local_stub',
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

export function verifyAumlokApprovalBinding(
  binding: AumlokApprovalBinding,
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  if (!binding.advisoryOnly) violations.push('binding.advisoryOnly must be true');
  if (binding.grantsAuthority !== false) violations.push('binding.grantsAuthority must be false');

  if (!binding.root.advisoryOnly) violations.push('root.advisoryOnly must be true');
  if (binding.root.grantsAuthority !== false) violations.push('root.grantsAuthority must be false');
  if (binding.root.mode !== 'local_stub') violations.push('root.mode must be local_stub');
  if (!binding.root.rootId.startsWith('aumlok_root_')) violations.push('rootId must start with aumlok_root_');

  if (!binding.signature.advisoryOnly) violations.push('signature.advisoryOnly must be true');
  if (binding.signature.grantsAuthority !== false) violations.push('signature.grantsAuthority must be false');
  if (binding.signature.mode !== 'local_stub') violations.push('signature.mode must be local_stub');

  if (binding.signature.rootId !== binding.root.rootId) violations.push('signature.rootId does not match root.rootId');
  if (binding.signature.approvalId !== binding.approval.approvalId) violations.push('signature.approvalId does not match approval.approvalId');
  if (binding.signature.draftId !== binding.approval.draftId) violations.push('signature.draftId does not match approval.draftId');
  if (binding.signature.proposalId !== binding.approval.proposalId) violations.push('signature.proposalId does not match approval.proposalId');
  if (binding.signature.approvalHash !== binding.approval.approvalHash) violations.push('signature.approvalHash does not match approval.approvalHash');

  if (!binding.approval.advisoryOnly) violations.push('approval.advisoryOnly must be true');
  if (binding.approval.grantsAuthority !== false) violations.push('approval.grantsAuthority must be false');

  const expectedSignatureHash = sha256(canonicalBindingPayload({
    approvalHash: binding.approval.approvalHash,
    approvalId: binding.approval.approvalId,
    draftId: binding.approval.draftId,
    mode: 'local_stub',
    proposalId: binding.approval.proposalId,
    rootId: binding.root.rootId,
  }));
  if (binding.signature.signatureHash !== expectedSignatureHash) {
    violations.push('signatureHash recomputation failed — binding may be tampered');
  }

  const json = JSON.stringify(binding);
  if (/sk-or-[a-zA-Z0-9_-]{16,}/.test(json)) violations.push('API key pattern found');
  if (/\b[a-fA-F0-9]{96,}\b/.test(json)) violations.push('possible key material found');
  if ((binding as any).pop) violations.push('PoP field present');
  if ((binding as any).signedHead) violations.push('signedHead field present');

  return { valid: violations.length === 0, violations };
}

export interface AumlokBindingAdvisoryState {
  rootId: string;
  publicFingerprint: string;
  approvalId: string;
  signatureHash: string;
  verified: boolean;
  mode: 'local_stub';
  advisoryOnly: true;
  grantsAuthority: false;
}

export function sanitizeAumlokBindingForArtifact(binding: AumlokApprovalBinding): AumlokBindingAdvisoryState {
  return {
    rootId: binding.root.rootId,
    publicFingerprint: binding.root.publicFingerprint,
    approvalId: binding.signature.approvalId,
    signatureHash: binding.signature.signatureHash.slice(0, 16),
    verified: binding.verified,
    mode: 'local_stub',
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

export function isApplyEligibleBinding(binding: AumlokApprovalBinding): { eligible: false; reasons: string[] } {
  const reasons: string[] = [];
  if (binding.root.mode === 'local_stub') reasons.push('local_stub mode — rehearsal only, not apply-eligible');
  if (binding.grantsAuthority !== false) reasons.push('grantsAuthority is not false');
  if (!binding.advisoryOnly) reasons.push('not advisoryOnly');
  if (!binding.verified) reasons.push('binding not verified');
  if (reasons.length === 0) reasons.push('no production AUMLOK mode exists');
  return { eligible: false, reasons };
}

export { canonicalBindingPayload as _canonicalBindingPayload_FOR_TEST_ONLY };
