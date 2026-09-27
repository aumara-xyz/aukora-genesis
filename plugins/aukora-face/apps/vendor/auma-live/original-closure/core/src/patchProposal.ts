import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { OrganismGraph, AffectedFileReport, getAffectedFilesForPatch, buildOrganismGraph } from './organismGraph';
import { OpenCodeAdvisoryArtifact } from './opencodeWombArtifact';
import { ConnectivityReport } from './organismConnectivity';
import { discoverTargets, DiscoveryInput } from './wombTargetDiscovery';

export interface PatchProposal {
  proposalId: string;
  targetFiles: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  authoritySurfacesTouched: string[];
  advisorySurfacesTouched: string[];
  requiredTests: string[];
  reason: string;
  nextAction: string;
  affectedFileReport: AffectedFileReport;
  advisoryOnly: true;
}

export interface ProposalInput {
  graph: OrganismGraph;
  advisory: OpenCodeAdvisoryArtifact;
  connectivity: ConnectivityReport;
  humanGoal?: string;
}

const COVERAGE_EVIDENCE: Record<string, { testFile: string; marker: string }> = {
  'receipt chain truncation attack': {
    testFile: 'tests/receiptChainTruncation.test.ts',
    marker: 'Receipt Chain Truncation Attack',
  },
  'receipt chain fork (divergent chains)': {
    testFile: 'tests/receiptChainFork.test.ts',
    marker: 'Receipt Chain Fork / Divergent Chains',
  },
  'receipt chain reordering attack': {
    testFile: 'tests/receiptChainReorder.test.ts',
    marker: 'Receipt Chain Reordering Attack',
  },
  'adversarial/poisoned advisory input does not subvert gate': {
    testFile: 'tests/poisonedAdvisory.test.ts',
    marker: 'Poisoned Advisory Does Not Subvert Gate',
  },
  'OpenCode patch proposal': {
    testFile: 'tests/patchLoopReceipt.test.ts',
    marker: 'Patch Loop Receipts',
  },
};

const ROOT = path.resolve(__dirname, '..');

function isCovered(description: string): boolean {
  const evidence = COVERAGE_EVIDENCE[description];
  if (!evidence) return false;
  try {
    const content = fs.readFileSync(path.resolve(ROOT, evidence.testFile), 'utf-8');
    return content.includes(evidence.marker);
  } catch {
    return false;
  }
}

const ALL_MISSING_TEST_TARGETS: Record<string, { files: string[]; tests: string[] }> = {
  'receipt chain truncation attack': {
    files: ['src/crypto.ts', 'src/index.ts'],
    tests: ['tests/kernel.test.ts', 'tests/export.test.ts'],
  },
  'receipt chain fork (divergent chains)': {
    files: ['src/crypto.ts'],
    tests: ['tests/kernel.test.ts', 'tests/export.test.ts'],
  },
  'receipt chain reordering attack': {
    files: ['src/crypto.ts'],
    tests: ['tests/kernel.test.ts', 'tests/export.test.ts'],
  },
  'adversarial/poisoned advisory input does not subvert gate': {
    files: ['src/resonator.ts', 'src/activeInferenceLoop.ts'],
    tests: ['tests/activeInferenceLoop.test.ts'],
  },
  'OpenCode patch proposal': {
    files: ['src/patchProposal.ts', 'src/opencodeWombArtifact.ts'],
    tests: ['tests/patchProposal.test.ts', 'tests/opencodeWombArtifact.test.ts'],
  },
};

function getActiveMissingTestTargets(): Record<string, { files: string[]; tests: string[] }> {
  const active: Record<string, { files: string[]; tests: string[] }> = {};
  for (const [key, value] of Object.entries(ALL_MISSING_TEST_TARGETS)) {
    if (!isCovered(key)) {
      active[key] = value;
    }
  }
  return active;
}

function computeProposalId(targetFiles: string[], reason: string): string {
  const payload = JSON.stringify({ targetFiles: targetFiles.sort(), reason });
  return 'prop_' + crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

function findTargetFromAdvisory(advisory: OpenCodeAdvisoryArtifact): { files: string[]; tests: string[]; reason: string } | null {
  const recommended = advisory.recommended_next || '';
  for (const [key, value] of Object.entries(getActiveMissingTestTargets())) {
    if (recommended.toLowerCase().includes(key.toLowerCase().slice(0, 20))) {
      return { ...value, reason: key };
    }
  }

  const risks = advisory.risks_summary || '';
  for (const [key, value] of Object.entries(getActiveMissingTestTargets())) {
    if (risks.toLowerCase().includes(key.toLowerCase().slice(0, 20))) {
      return { ...value, reason: key };
    }
  }

  return null;
}

function findTargetFromHumanGoal(goal: string, graph: OrganismGraph): { files: string[]; tests: string[]; reason: string } | null {
  const lower = goal.toLowerCase();

  for (const [key, value] of Object.entries(getActiveMissingTestTargets())) {
    if (lower.includes(key.toLowerCase().slice(0, 15))) {
      return { ...value, reason: `human goal: ${goal}` };
    }
  }

  const matchedNodes = graph.nodes.filter(n =>
    n.nodeType !== 'test_surface' &&
    n.nodeType !== 'evidence_artifact' &&
    (n.label.toLowerCase().includes(lower) || n.file.toLowerCase().includes(lower))
  );

  if (matchedNodes.length > 0) {
    const files = matchedNodes.map(n => n.file);
    const relatedTests = graph.nodes
      .filter(n => n.nodeType === 'test_surface')
      .filter(t => matchedNodes.some(m => t.label.toLowerCase().includes(m.label.toLowerCase())))
      .map(t => t.file);
    return { files, tests: relatedTests, reason: `human goal: ${goal}` };
  }

  return null;
}

function findRequiredTests(targetFiles: string[], graph: OrganismGraph): string[] {
  const testNodes = graph.nodes.filter(n => n.nodeType === 'test_surface');
  const matched: string[] = [];

  for (const targetFile of targetFiles) {
    const baseName = targetFile.replace('src/', '').replace('.ts', '');
    for (const tn of testNodes) {
      if (tn.label.toLowerCase().includes(baseName.toLowerCase())) {
        matched.push(tn.file);
      }
    }
  }

  return [...new Set(matched)];
}

export function generatePatchProposal(input: ProposalInput): PatchProposal {
  const { graph, advisory, connectivity, humanGoal } = input;

  let target: { files: string[]; tests: string[]; reason: string } | null = null;

  if (humanGoal) {
    target = findTargetFromHumanGoal(humanGoal, graph);
  }
  if (!target) {
    target = findTargetFromAdvisory(advisory);
  }
  if (!target) {
    const highPriority = connectivity.missing_tests.filter(t => t.priority === 'high');
    if (highPriority.length > 0) {
      const first = highPriority[0];
      target = {
        files: ['src/crypto.ts'],
        tests: ['tests/kernel.test.ts'],
        reason: `missing high-priority test: ${first.description}`,
      };
    }
  }
  if (!target) {
    const pathFile = path.resolve(ROOT, '../../AUKORA_SINGULARITY_PATH.md');
    let singularityPathText = '';
    try { singularityPathText = fs.readFileSync(pathFile, 'utf-8'); } catch {}

    const evidenceDir = path.resolve(ROOT, 'evidence');
    let evidenceFilenames: string[] = [];
    try { evidenceFilenames = fs.readdirSync(evidenceDir); } catch {}

    const discoveryInput: DiscoveryInput = {
      advisory,
      graph,
      singularityPathText,
      evidenceFilenames,
      currentProposal: advisory.current_proposal ?? null,
    };
    const discovery = discoverTargets(discoveryInput);
    const topLow = discovery.candidates.find(c => c.riskLevel === 'LOW' && c.targetFiles.length > 0);
    if (topLow) {
      target = {
        files: topLow.targetFiles,
        tests: topLow.requiredTests,
        reason: `womb discovery: ${topLow.title}`,
      };
    }
  }
  if (!target) {
    target = {
      files: [],
      tests: [],
      reason: 'no specific target identified — organism is stable',
    };
  }

  const affectedFileReport = target.files.length > 0
    ? getAffectedFilesForPatch(target.files)
    : { seedFiles: [], directlyAffected: [], testsAffected: [], authoritySurfacesTouched: [], advisorySurfacesTouched: [], risk: 'LOW' as const };

  const graphTests = findRequiredTests(target.files, graph);
  const requiredTests = [...new Set([...target.tests, ...graphTests])];

  const riskLevel = affectedFileReport.risk;

  const nextAction = riskLevel === 'HIGH'
    ? `Write tests for: ${target.reason}. Authority surface — full chain verification required after patch.`
    : riskLevel === 'MEDIUM'
    ? `Write tests for: ${target.reason}. Review affected advisory surfaces.`
    : target.files.length > 0
    ? `Write tests for: ${target.reason}. Low-risk advisory change.`
    : 'Organism is stable. Consider expanding coverage or adding new Rosetta layer integration.';

  const proposalId = computeProposalId(target.files, target.reason);

  return {
    proposalId,
    targetFiles: target.files,
    riskLevel,
    authoritySurfacesTouched: affectedFileReport.authoritySurfacesTouched,
    advisorySurfacesTouched: affectedFileReport.advisorySurfacesTouched,
    requiredTests,
    reason: target.reason,
    nextAction,
    affectedFileReport,
    advisoryOnly: true,
  };
}

export function generateProposalFromCurrentState(humanGoal?: string): PatchProposal {
  const graph = buildOrganismGraph();

  const artifactPath = path.resolve(ROOT, 'evidence/opencode-womb-advisory.json');
  let advisory: OpenCodeAdvisoryArtifact;
  try {
    advisory = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
  } catch {
    advisory = {
      consensus: 'RED',
      findings_summary: 'No prior artifact',
      risks_summary: 'No prior artifact',
      recommended_next: '',
      timestamp: new Date().toISOString(),
      advisory_only: true,
    };
  }

  const { generateConnectivityReport } = require('./organismConnectivity');
  const connectivity = generateConnectivityReport();

  return generatePatchProposal({ graph, advisory, connectivity, humanGoal });
}
