import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PatchProposal } from './patchProposal';
import { TargetCandidate } from './wombTargetDiscovery';
import { OpenCodeAdvisoryArtifact } from './opencodeWombArtifact';
import { OrganismGraph } from './organismGraph';
import {
  containsForbiddenContent,
  containsForbiddenCommand,
  scrubText,
  isLegacyAppPath,
  AUTHORITY_FILE_SET,
} from './wombForbiddenPatterns';

export interface PatchDraft {
  draftId: string;
  proposalId: string;
  candidateId: string;
  targetFiles: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  authoritySurfaces: string[];
  advisorySurfaces: string[];
  intent: 'draft_only';
  summary: string;
  proposedChanges: string[];
  candidateDiff?: string;
  requiredTests: string[];
  refusalReason?: string;
  approvalRequired: true;
  advisoryOnly: true;
  createdAt: string;
  hashes: {
    proposalHash: string;
    draftHash: string;
    targetFilesHash: string;
    contextHash: string;
  };
}

export interface DraftInput {
  proposal: PatchProposal;
  candidate: TargetCandidate;
  graph: OrganismGraph;
  singularityPathText: string;
  advisory: OpenCodeAdvisoryArtifact;
}

const ROOT = path.resolve(__dirname, '..');

function sha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function readTargetExcerpt(filePath: string): string | null {
  try {
    const full = path.resolve(ROOT, filePath);
    const content = fs.readFileSync(full, 'utf-8');
    const lines = content.split('\n');
    const excerpt = lines.slice(0, Math.min(lines.length, 40)).join('\n');
    if (containsForbiddenContent(excerpt)) return null;
    return excerpt;
  } catch {
    return null;
  }
}

function describeProposedChanges(candidate: TargetCandidate, excerpt: string | null, graph: OrganismGraph): string[] {
  const changes: string[] = [];

  if (candidate.title.startsWith('test coverage for ')) {
    const moduleName = candidate.title.replace('test coverage for ', '');
    changes.push(`Create tests/${moduleName}.test.ts with unit tests for ${moduleName}`);
    if (excerpt) {
      const exportMatches = excerpt.match(/export\s+(?:function|interface|type|const|class)\s+(\w+)/g);
      if (exportMatches) {
        const exports = exportMatches.map((m) => m.replace(/^export\s+(function|interface|type|const|class)\s+/, ''));
        changes.push(`Test exported symbols: ${exports.join(', ')}`);
      }
    }
    changes.push(`Add coverage evidence entry in COVERAGE_EVIDENCE map`);
  } else if (candidate.title.startsWith('fix forbidden crossing')) {
    changes.push(`Remove forbidden import that violates boundary rule`);
    changes.push(`Verify no remaining forbidden imports in affected file`);
  } else if (candidate.title.startsWith('resolve TODOs')) {
    changes.push(`Review and resolve TODO comments in target file`);
  } else if (candidate.title.startsWith('expand organism graph')) {
    changes.push(`Add new nodes/edges to organism graph for recently added modules`);
  } else if (candidate.title.startsWith('wire ')) {
    changes.push(`Establish the missing edge between the two nodes`);
  } else if (candidate.title.startsWith('path stage')) {
    changes.push(`Design or scaffold the stage described in the singularity path`);
  } else {
    changes.push(`Address: ${candidate.reason}`);
  }

  return changes;
}

export function generatePatchDraft(input: DraftInput): PatchDraft {
  const { proposal, candidate, graph, singularityPathText, advisory } = input;

  const hasLegacyPaths = candidate.targetFiles.some(isLegacyAppPath);
  if (hasLegacyPaths) {
    return makeRefusedDraft(proposal, candidate, 'Target files include legacy app paths — excluded by policy');
  }

  const hasAuthoritySurfaces = candidate.targetFiles.some((f) => AUTHORITY_FILE_SET.has(f));
  if (candidate.riskLevel === 'HIGH' || hasAuthoritySurfaces) {
    return makeRefusedDraft(proposal, candidate, `HIGH-risk or authority surface target: ${candidate.targetFiles.join(', ')} — report only, requires explicit approval`);
  }

  const excerpt = candidate.targetFiles.length > 0 ? readTargetExcerpt(candidate.targetFiles[0]) : null;
  const proposedChanges = describeProposedChanges(candidate, excerpt, graph);

  const summary = scrubText(
    `Draft for ${candidate.title}: ${candidate.reason}. ` +
    `${proposedChanges.length} proposed changes. ` +
    `Risk: ${candidate.riskLevel}. Advisory only — approval required before any apply step.`
  );

  const contextHash = sha256(JSON.stringify({
    advisory_consensus: advisory.consensus,
    advisory_timestamp: advisory.timestamp,
    graph_nodeCount: graph.summary.nodeCount,
    pathLength: singularityPathText.length,
  }));

  const proposalHash = sha256(JSON.stringify({
    proposalId: proposal.proposalId,
    targetFiles: [...proposal.targetFiles].sort(),
    riskLevel: proposal.riskLevel,
    reason: proposal.reason,
  }));

  const targetFilesHash = sha256(JSON.stringify([...candidate.targetFiles].sort()));

  const draftContent = JSON.stringify({
    proposalId: proposal.proposalId,
    candidateId: candidate.candidateId,
    targetFiles: candidate.targetFiles,
    proposedChanges,
    summary,
  });
  const draftHash = sha256(draftContent);

  const draftId = 'draft_' + sha256(JSON.stringify({
    proposalId: proposal.proposalId,
    candidateId: candidate.candidateId,
    targetFiles: [...candidate.targetFiles].sort(),
  })).slice(0, 16);

  return {
    draftId,
    proposalId: proposal.proposalId,
    candidateId: candidate.candidateId,
    targetFiles: [...candidate.targetFiles],
    riskLevel: candidate.riskLevel,
    authoritySurfaces: [...candidate.authoritySurfaces],
    advisorySurfaces: [...candidate.advisorySurfaces],
    intent: 'draft_only',
    summary,
    proposedChanges: proposedChanges.map(c => scrubText(c)),
    requiredTests: [...candidate.requiredTests],
    approvalRequired: true,
    advisoryOnly: true,
    createdAt: new Date().toISOString(),
    hashes: {
      proposalHash,
      draftHash,
      targetFilesHash,
      contextHash,
    },
  };
}

function makeRefusedDraft(proposal: PatchProposal, candidate: TargetCandidate, reason: string): PatchDraft {
  const draftId = 'draft_' + sha256(JSON.stringify({
    proposalId: proposal.proposalId,
    candidateId: candidate.candidateId,
    targetFiles: [...candidate.targetFiles].sort(),
  })).slice(0, 16);

  return {
    draftId,
    proposalId: proposal.proposalId,
    candidateId: candidate.candidateId,
    targetFiles: [...candidate.targetFiles],
    riskLevel: candidate.riskLevel,
    authoritySurfaces: [...candidate.authoritySurfaces],
    advisorySurfaces: [...candidate.advisorySurfaces],
    intent: 'draft_only',
    summary: `REFUSED: ${scrubText(reason)}`,
    proposedChanges: [],
    requiredTests: [...candidate.requiredTests],
    refusalReason: scrubText(reason),
    approvalRequired: true,
    advisoryOnly: true,
    createdAt: new Date().toISOString(),
    hashes: {
      proposalHash: sha256(JSON.stringify({ proposalId: proposal.proposalId, targetFiles: [...proposal.targetFiles].sort(), riskLevel: proposal.riskLevel, reason: proposal.reason })),
      draftHash: sha256('refused:' + reason),
      targetFilesHash: sha256(JSON.stringify([...candidate.targetFiles].sort())),
      contextHash: sha256('refused'),
    },
  };
}

export function validatePatchDraft(draft: PatchDraft): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  if (!draft.advisoryOnly) violations.push('advisoryOnly must be true');
  if (!draft.approvalRequired) violations.push('approvalRequired must be true');
  if (draft.intent !== 'draft_only') violations.push('intent must be draft_only');
  if (!draft.draftId.startsWith('draft_')) violations.push('draftId must start with draft_');

  const json = JSON.stringify(draft);
  if (/signedHead/i.test(json) && !/\[SCRUBBED\]/.test(json)) violations.push('signedHead leaked');
  if (/merkleRoot/i.test(json) && !/\[SCRUBBED\]/.test(json)) violations.push('merkleRoot leaked');
  if (/sk-or-[a-zA-Z0-9_-]{16,}/.test(json)) violations.push('API key pattern found');
  if (/\b[a-fA-F0-9]{96,}\b/.test(json)) violations.push('possible key material found');
  if ((draft as any).pop) violations.push('PoP field present');
  if ((draft as any).signature) violations.push('signature field present');
  if ((draft as any).authority_granted) violations.push('authority_granted field present');
  if ((draft as any).gate_changed) violations.push('gate_changed field present');

  return { valid: violations.length === 0, violations };
}
