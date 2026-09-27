import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { OrganismGraph } from './organismGraph';
import { OpenCodeAdvisoryArtifact, ProposalAdvisoryState } from './opencodeWombArtifact';
import { containsForbiddenContent, isLegacyAppPath, AUTHORITY_FILE_SET } from './wombForbiddenPatterns';

export interface TargetCandidate {
  candidateId: string;
  title: string;
  source: 'graph' | 'advisory' | 'path' | 'evidence' | 'heuristic';
  targetFiles: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  authoritySurfaces: string[];
  advisorySurfaces: string[];
  reason: string;
  requiredTests: string[];
  whySmallestSafeStep: string;
  advisoryOnly: true;
}

export interface DiscoveryInput {
  advisory: OpenCodeAdvisoryArtifact;
  graph: OrganismGraph;
  singularityPathText: string;
  evidenceFilenames: string[];
  currentProposal: ProposalAdvisoryState | null;
}

export interface DiscoveryResult {
  candidates: TargetCandidate[];
  timestamp: string;
  advisoryOnly: true;
}

const ROOT = path.resolve(__dirname, '..');


function computeCandidateId(title: string, source: string, targetFiles: string[]): string {
  const payload = JSON.stringify({ title, source, targetFiles: [...targetFiles].sort() });
  return 'cand_' + crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

function classifyRisk(targetFiles: string[]): { riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'; authoritySurfaces: string[]; advisorySurfaces: string[] } {
  const authoritySurfaces = targetFiles.filter((f) => AUTHORITY_FILE_SET.has(f));
  const advisorySurfaces = targetFiles.filter((f) => !AUTHORITY_FILE_SET.has(f));
  const riskLevel = authoritySurfaces.length > 0 ? 'HIGH' : advisorySurfaces.length > 3 ? 'MEDIUM' : 'LOW';
  return { riskLevel, authoritySurfaces, advisorySurfaces };
}

function findRelatedTests(targetFiles: string[], graph: OrganismGraph): string[] {
  const testNodes = graph.nodes.filter((n) => n.nodeType === 'test_surface');
  const matched: string[] = [];
  for (const target of targetFiles) {
    const baseName = path.basename(target).replace('.ts', '');
    for (const tn of testNodes) {
      if (tn.label.toLowerCase().includes(baseName.toLowerCase())) {
        matched.push(tn.file);
      }
    }
  }
  return [...new Set(matched)];
}

function discoverFromGraph(graph: OrganismGraph): TargetCandidate[] {
  const candidates: TargetCandidate[] = [];

  const advisoryNodes = graph.nodes.filter(
    (n) => n.nodeType === 'advisory_surface' && n.exists && !isLegacyAppPath(n.file)
  );
  const untestedAdvisory = advisoryNodes.filter((node) => {
    const hasTest = graph.nodes.some(
      (t) => t.nodeType === 'test_surface' && t.label.toLowerCase().includes(node.label.toLowerCase())
    );
    return !hasTest;
  });

  for (const node of untestedAdvisory) {
    const { riskLevel, authoritySurfaces, advisorySurfaces } = classifyRisk([node.file]);
    const tests = findRelatedTests([node.file], graph);
    candidates.push({
      candidateId: computeCandidateId(`test coverage for ${node.label}`, 'graph', [node.file]),
      title: `test coverage for ${node.label}`,
      source: 'graph',
      targetFiles: [node.file],
      riskLevel,
      authoritySurfaces,
      advisorySurfaces,
      reason: `advisory node ${node.label} has no dedicated test surface in the organism graph`,
      requiredTests: tests,
      whySmallestSafeStep: `adding test coverage for an advisory-only node does not touch authority surfaces`,
      advisoryOnly: true,
    });
  }

  const violatedEdges = graph.edges.filter(
    (e) => e.kind === 'forbidden' && e.relation.startsWith('VIOLATED')
  );
  for (const edge of violatedEdges) {
    const sourceNode = graph.nodes.find((n) => n.id === edge.source);
    if (!sourceNode || isLegacyAppPath(sourceNode.file)) continue;
    candidates.push({
      candidateId: computeCandidateId(`fix forbidden crossing: ${edge.relation}`, 'graph', [sourceNode.file]),
      title: `fix forbidden crossing: ${edge.relation}`,
      source: 'graph',
      targetFiles: [sourceNode.file],
      riskLevel: 'HIGH',
      authoritySurfaces: [sourceNode.file],
      advisorySurfaces: [],
      reason: `forbidden import boundary violated: ${edge.relation}`,
      requiredTests: findRelatedTests([sourceNode.file], graph),
      whySmallestSafeStep: 'removing a forbidden import restores a structural boundary',
      advisoryOnly: true,
    });
  }

  return candidates;
}

function discoverFromPath(pathText: string): TargetCandidate[] {
  const candidates: TargetCandidate[] = [];

  const notStartedMatch = pathText.match(/\|\s*\d+\s*\|[^|]+\|\s*NOT STARTED\s*\|([^|]+)\|/g);
  if (notStartedMatch) {
    for (const line of notStartedMatch) {
      const nameMatch = line.match(/\|\s*\d+\s*\|\s*([^|]+?)\s*\|\s*NOT STARTED/);
      if (!nameMatch) continue;
      const stageName = nameMatch[1].trim();
      if (stageName.toLowerCase().includes('tauri') || stageName.toLowerCase().includes('shell')) continue;
      candidates.push({
        candidateId: computeCandidateId(`path stage: ${stageName}`, 'path', []),
        title: `path stage: ${stageName}`,
        source: 'path',
        targetFiles: [],
        riskLevel: 'LOW',
        authoritySurfaces: [],
        advisorySurfaces: [],
        reason: `singularity path stage "${stageName}" is NOT STARTED — design or scaffold work may be possible`,
        requiredTests: [],
        whySmallestSafeStep: 'planning or scaffolding a new stage does not modify authority surfaces',
        advisoryOnly: true,
      });
    }
  }

  const notBuiltMatch = pathText.match(/\|\s*[^|]+\|\s*NOT BUILT\s*\|([^|]+)\|/g);
  if (notBuiltMatch) {
    for (const line of notBuiltMatch) {
      const compMatch = line.match(/\|\s*([^|]+?)\s*\|\s*NOT BUILT/);
      if (!compMatch) continue;
      const componentName = compMatch[1].trim();
      candidates.push({
        candidateId: computeCandidateId(`unbuilt component: ${componentName}`, 'path', []),
        title: `unbuilt component: ${componentName}`,
        source: 'path',
        targetFiles: [],
        riskLevel: 'LOW',
        authoritySurfaces: [],
        advisorySurfaces: [],
        reason: `"${componentName}" is marked NOT BUILT on the singularity path`,
        requiredTests: [],
        whySmallestSafeStep: 'scaffolding an unbuilt component is exploratory and advisory-only',
        advisoryOnly: true,
      });
    }
  }

  return candidates;
}

function discoverFromAdvisory(advisory: OpenCodeAdvisoryArtifact, graph: OrganismGraph): TargetCandidate[] {
  const candidates: TargetCandidate[] = [];

  if (advisory.consensus === 'RED') {
    candidates.push({
      candidateId: computeCandidateId('address RED advisory consensus', 'advisory', []),
      title: 'address RED advisory consensus',
      source: 'advisory',
      targetFiles: [],
      riskLevel: 'MEDIUM',
      authoritySurfaces: [],
      advisorySurfaces: [],
      reason: `fusion council advisory consensus is RED: ${advisory.risks_summary.slice(0, 100)}`,
      requiredTests: [],
      whySmallestSafeStep: 'investigating a RED consensus helps identify the next specific target',
      advisoryOnly: true,
    });
  }

  const unwiredMatch = advisory.risks_summary.match(/[Uu]nwired:\s*([^\s:]+)\s*->\s*([^\s:]+)/);
  if (unwiredMatch) {
    const [, from, to] = unwiredMatch;
    const fromNode = graph.nodes.find((n) => n.label === from || n.id === `src:${from}.ts`);
    const toNode = graph.nodes.find((n) => n.label === to || n.id === `src:${to}.ts`);
    if (fromNode && toNode && !isLegacyAppPath(fromNode.file) && !isLegacyAppPath(toNode.file)) {
      const files = [fromNode.file, toNode.file].filter((f) => f !== '(external)');
      const { riskLevel, authoritySurfaces, advisorySurfaces } = classifyRisk(files);
      candidates.push({
        candidateId: computeCandidateId(`wire ${from} -> ${to}`, 'advisory', files),
        title: `wire ${from} -> ${to}`,
        source: 'advisory',
        targetFiles: files,
        riskLevel,
        authoritySurfaces,
        advisorySurfaces,
        reason: `advisory reports unwired edge: ${from} -> ${to}`,
        requiredTests: findRelatedTests(files, graph),
        whySmallestSafeStep: riskLevel === 'LOW' ? 'wiring an advisory-only edge adds no authority' : 'this touches authority surfaces — report only',
        advisoryOnly: true,
      });
    }
  }

  return candidates;
}

function discoverFromEvidence(evidenceFilenames: string[]): TargetCandidate[] {
  const candidates: TargetCandidate[] = [];

  const hasReceipts = evidenceFilenames.some((f) => f.includes('receipt'));
  const hasPatchLoop = evidenceFilenames.some((f) => f.includes('patch-loop') || f.includes('run-patch-loop'));
  const hasConnectivity = evidenceFilenames.some((f) => f.includes('connectivity'));

  if (hasReceipts && hasPatchLoop && !hasConnectivity) {
    candidates.push({
      candidateId: computeCandidateId('evidence gap: connectivity report', 'evidence', ['src/organismConnectivity.ts']),
      title: 'evidence gap: connectivity report',
      source: 'evidence',
      targetFiles: ['src/organismConnectivity.ts'],
      riskLevel: 'LOW',
      authoritySurfaces: [],
      advisorySurfaces: ['src/organismConnectivity.ts'],
      reason: 'evidence directory has receipts and patch loop but no connectivity report artifact',
      requiredTests: [],
      whySmallestSafeStep: 'generating a connectivity report is a read-only advisory operation',
      advisoryOnly: true,
    });
  }

  return candidates;
}

function discoverHeuristic(graph: OrganismGraph, currentProposal: ProposalAdvisoryState | null): TargetCandidate[] {
  const candidates: TargetCandidate[] = [];

  const srcNodes = graph.nodes.filter(
    (n) => (n.nodeType === 'advisory_surface' || n.nodeType === 'module') && n.exists && !isLegacyAppPath(n.file)
  );

  for (const node of srcNodes) {
    try {
      const content = fs.readFileSync(path.resolve(ROOT, node.file), 'utf-8');
      const todoCount = (content.match(/\/\/\s*TODO\b/gi) || []).length;
      if (todoCount >= 2) {
        const { riskLevel, authoritySurfaces, advisorySurfaces } = classifyRisk([node.file]);
        candidates.push({
          candidateId: computeCandidateId(`resolve TODOs in ${node.label}`, 'heuristic', [node.file]),
          title: `resolve TODOs in ${node.label}`,
          source: 'heuristic',
          targetFiles: [node.file],
          riskLevel,
          authoritySurfaces,
          advisorySurfaces,
          reason: `${node.label} has ${todoCount} TODO comments — potential improvement targets`,
          requiredTests: findRelatedTests([node.file], graph),
          whySmallestSafeStep: riskLevel === 'LOW' ? 'resolving TODOs in advisory code is safe' : 'TODOs in authority code require approval',
          advisoryOnly: true,
        });
      }
    } catch {}
  }

  if (currentProposal && currentProposal.verdict === 'tested_green' && currentProposal.targetFiles.length === 0) {
    candidates.push({
      candidateId: computeCandidateId('expand organism graph coverage', 'heuristic', ['src/organismGraph.ts']),
      title: 'expand organism graph coverage',
      source: 'heuristic',
      targetFiles: ['src/organismGraph.ts'],
      riskLevel: 'LOW',
      authoritySurfaces: [],
      advisorySurfaces: ['src/organismGraph.ts'],
      reason: 'organism is stable with no targets — expanding graph coverage increases discovery surface for future proposals',
      requiredTests: ['tests/organismGraph.test.ts'],
      whySmallestSafeStep: 'organismGraph.ts is advisory-only — no authority surfaces touched',
      advisoryOnly: true,
    });
  }

  return candidates;
}

function rankCandidates(candidates: TargetCandidate[]): TargetCandidate[] {
  const riskOrder: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  const sourceOrder: Record<string, number> = { graph: 0, advisory: 1, evidence: 2, path: 3, heuristic: 4 };

  return [...candidates].sort((a, b) => {
    const riskDiff = riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    if (riskDiff !== 0) return riskDiff;

    const hasFilesA = a.targetFiles.length > 0 ? 0 : 1;
    const hasFilesB = b.targetFiles.length > 0 ? 0 : 1;
    if (hasFilesA !== hasFilesB) return hasFilesA - hasFilesB;

    return sourceOrder[a.source] - sourceOrder[b.source];
  });
}

export function discoverTargets(input: DiscoveryInput): DiscoveryResult {
  const { advisory, graph, singularityPathText, evidenceFilenames, currentProposal } = input;

  let allCandidates: TargetCandidate[] = [
    ...discoverFromGraph(graph),
    ...discoverFromAdvisory(advisory, graph),
    ...discoverFromEvidence(evidenceFilenames),
    ...discoverFromPath(singularityPathText),
    ...discoverHeuristic(graph, currentProposal),
  ];

  allCandidates = allCandidates.filter((c) => !c.targetFiles.some(isLegacyAppPath));

  allCandidates = allCandidates.filter((c) => {
    const text = JSON.stringify(c);
    return !containsForbiddenContent(text);
  });

  const ranked = rankCandidates(allCandidates);

  return {
    candidates: ranked,
    timestamp: new Date().toISOString(),
    advisoryOnly: true,
  };
}

export function discoverFromCurrentState(): DiscoveryResult {
  const { buildOrganismGraph } = require('./organismGraph');
  const graph: OrganismGraph = buildOrganismGraph();

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

  const pathFile = path.resolve(ROOT, '../../AUKORA_SINGULARITY_PATH.md');
  let singularityPathText = '';
  try {
    singularityPathText = fs.readFileSync(pathFile, 'utf-8');
  } catch {}

  const evidenceDir = path.resolve(ROOT, 'evidence');
  let evidenceFilenames: string[] = [];
  try {
    evidenceFilenames = fs.readdirSync(evidenceDir);
  } catch {}

  const currentProposal = advisory.current_proposal ?? null;

  return discoverTargets({ advisory, graph, singularityPathText, evidenceFilenames, currentProposal });
}
