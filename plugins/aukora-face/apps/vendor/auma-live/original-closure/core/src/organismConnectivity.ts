import * as fs from 'fs';
import * as path from 'path';
import { parseImportEdges, symbolUsedInCode, symbolForbiddenInFile } from './importGraphVerifier';

export interface ConnectivityNode {
  name: string;
  file: string;
  exists: boolean;
}

export interface ConnectivityEdge {
  from: string;
  to: string;
  type: 'imports' | 'calls' | 'reads' | 'advisory';
  verified: boolean;
  description: string;
}

export interface ForbiddenCrossing {
  from: string;
  to: string;
  rule: string;
  violated: boolean;
}

export interface MissingTest {
  area: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
}

export interface ConnectivityReport {
  timestamp: string;
  nodes: ConnectivityNode[];
  edges: ConnectivityEdge[];
  forbidden_crossings: ForbiddenCrossing[];
  missing_tests: MissingTest[];
  unwired: string[];
  summary: { connected: number; unwired: number; forbidden_violations: number; missing_test_count: number };
}

const SRC = path.resolve(__dirname);
const ROOT = path.resolve(__dirname, '..');

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
  'OpenCode patch proposal → gate → receipt → context update loop': {
    testFile: 'tests/patchLoopReceipt.test.ts',
    marker: 'Patch Loop Receipts',
  },
};

function isCovered(description: string): boolean {
  const evidence = COVERAGE_EVIDENCE[description];
  if (!evidence) return false;
  const testPath = path.resolve(ROOT, evidence.testFile);
  try {
    const content = fs.readFileSync(testPath, 'utf-8');
    return content.includes(evidence.marker);
  } catch {
    return false;
  }
}

function fileExists(relPath: string): boolean {
  return fs.existsSync(path.resolve(ROOT, relPath));
}

function sourceContains(file: string, pattern: string): boolean {
  try {
    const content = fs.readFileSync(path.resolve(ROOT, file), 'utf-8');
    return content.includes(pattern);
  } catch {
    return false;
  }
}


export function generateConnectivityReport(): ConnectivityReport {
  const nodes: ConnectivityNode[] = [
    { name: 'gate', file: 'src/index.ts', exists: fileExists('src/index.ts') },
    { name: 'executor', file: 'src/executor.ts', exists: fileExists('src/executor.ts') },
    { name: 'crypto', file: 'src/crypto.ts', exists: fileExists('src/crypto.ts') },
    { name: 'receipts', file: 'src/crypto.ts', exists: fileExists('src/crypto.ts') },
    { name: 'vk_export', file: 'src/vk.ts', exists: fileExists('src/vk.ts') },
    { name: 'hypothesis_memory', file: 'src/hypothesisMemory.ts', exists: fileExists('src/hypothesisMemory.ts') },
    { name: 'structural_memory', file: 'src/structuralMemory.ts', exists: fileExists('src/structuralMemory.ts') },
    { name: 'active_inference_loop', file: 'src/activeInferenceLoop.ts', exists: fileExists('src/activeInferenceLoop.ts') },
    { name: 'resonator', file: 'src/resonator.ts', exists: fileExists('src/resonator.ts') },
    { name: 'external_reviewer', file: 'src/externalReview.ts', exists: fileExists('src/externalReview.ts') },
    { name: 'fusion_config', file: 'src/fusionConfig.ts', exists: fileExists('src/fusionConfig.ts') },
    { name: 'opencode_advisory', file: '../opencode-lab/opencode-dev/packages/core/src/system-context/aukora-fusion-advisory.ts', exists: fileExists('../opencode-lab/opencode-dev/packages/core/src/system-context/aukora-fusion-advisory.ts') },
    { name: 'fusion_artifact_bridge', file: 'evidence/', exists: fileExists('evidence/') },
    { name: 'womb_artifact_builder', file: 'src/opencodeWombArtifact.ts', exists: fileExists('src/opencodeWombArtifact.ts') },
    { name: 'fusion_swarm', file: 'src/fusionSwarm.ts', exists: fileExists('src/fusionSwarm.ts') },
    { name: 'node_identity', file: 'src/nodeIdentity.ts', exists: fileExists('src/nodeIdentity.ts') },
    { name: 'patch_loop_receipt', file: 'src/patchLoopReceipt.ts', exists: fileExists('src/patchLoopReceipt.ts') },
    { name: 'womb_target_discovery', file: 'src/wombTargetDiscovery.ts', exists: fileExists('src/wombTargetDiscovery.ts') },
    { name: 'womb_patch_draft', file: 'src/wombPatchDraft.ts', exists: fileExists('src/wombPatchDraft.ts') },
    { name: 'patch_approval', file: 'src/patchApproval.ts', exists: fileExists('src/patchApproval.ts') },
    { name: 'aumlok_approval_root', file: 'src/aumlokApprovalRoot.ts', exists: fileExists('src/aumlokApprovalRoot.ts') },
    { name: 'womb_forbidden_patterns', file: 'src/wombForbiddenPatterns.ts', exists: fileExists('src/wombForbiddenPatterns.ts') },
    { name: 'import_graph_verifier', file: 'src/importGraphVerifier.ts', exists: fileExists('src/importGraphVerifier.ts') },
  ];

  const edges: ConnectivityEdge[] = [];
  const addEdge = (from: string, to: string, type: ConnectivityEdge['type'], desc: string, file: string, pattern: string) => {
    edges.push({ from, to, type, verified: sourceContains(file, pattern), description: desc });
  };

  addEdge('gate', 'crypto', 'imports', 'gate imports receipt/PoP from crypto', 'src/index.ts', 'generateReceipt');
  addEdge('gate', 'vk_export', 'imports', 'gate writes VK training rows', 'src/index.ts', 'writeVkRow');
  addEdge('executor', 'crypto', 'imports', 'executor verifies signed head', 'src/executor.ts', 'verifySignedHead');
  addEdge('executor', 'gate', 'reads', 'executor reads gate decision', 'src/executor.ts', 'executeDecision');
  addEdge('active_inference_loop', 'gate', 'calls', 'loop calls evaluateIntent', 'src/activeInferenceLoop.ts', 'runClosedLoopStep');
  addEdge('active_inference_loop', 'executor', 'calls', 'loop calls executor', 'src/activeInferenceLoop.ts', 'executeDecision');
  addEdge('active_inference_loop', 'hypothesis_memory', 'calls', 'loop updates hypotheses', 'src/activeInferenceLoop.ts', 'HypothesisMemory');
  addEdge('active_inference_loop', 'structural_memory', 'calls', 'loop trains structural predictor', 'src/activeInferenceLoop.ts', 'StructuralMemoryPredictor');
  addEdge('active_inference_loop', 'resonator', 'calls', 'loop gets advisory context', 'src/activeInferenceLoop.ts', 'generateStructuralAdvisoryContext');
  addEdge('hypothesis_memory', 'crypto', 'imports', 'hypothesis verifies evidence bundles', 'src/hypothesisMemory.ts', 'verifySignedHead');
  addEdge('resonator', 'structural_memory', 'imports', 'resonator reads structural predictor', 'src/resonator.ts', 'StructuralMemoryPredictor');

  addEdge('external_reviewer', 'gate', 'advisory', 'reviewer cannot import gate', 'src/externalReview.ts', 'evaluateIntent');
  edges[edges.length - 1].verified = !sourceContains('src/externalReview.ts', 'evaluateIntent');

  addEdge('fusion_config', 'gate', 'advisory', 'fusion config cannot import gate', 'src/fusionConfig.ts', 'evaluateIntent');
  edges[edges.length - 1].verified = !sourceContains('src/fusionConfig.ts', 'evaluateIntent');

  addEdge('fusion_swarm', 'womb_artifact_builder', 'advisory', 'swarm result feeds artifact builder', 'src/opencodeWombArtifact.ts', 'SwarmReviewResult');
  addEdge('womb_artifact_builder', 'opencode_advisory', 'advisory', 'builder produces scrubbed JSON consumed by OpenCode', 'src/opencodeWombArtifact.ts', 'OpenCodeAdvisoryArtifact');

  addEdge('womb_artifact_builder', 'gate', 'advisory', 'builder cannot import gate', 'src/opencodeWombArtifact.ts', 'evaluateIntent');
  edges[edges.length - 1].verified = !sourceContains('src/opencodeWombArtifact.ts', 'evaluateIntent');

  addEdge('patch_loop_receipt', 'womb_artifact_builder', 'advisory', 'receipt provides proposal state to artifact builder', 'src/patchLoopReceipt.ts', 'ProposalAdvisoryState');

  addEdge('patch_loop_receipt', 'gate', 'advisory', 'receipt cannot import gate', 'src/patchLoopReceipt.ts', 'evaluateIntent');
  edges[edges.length - 1].verified = !sourceContains('src/patchLoopReceipt.ts', 'evaluateIntent');

  addEdge('womb_target_discovery', 'womb_artifact_builder', 'advisory', 'discovery reads advisory artifact for candidates', 'src/wombTargetDiscovery.ts', 'OpenCodeAdvisoryArtifact');

  addEdge('womb_target_discovery', 'gate', 'advisory', 'discovery cannot import gate', 'src/wombTargetDiscovery.ts', 'evaluateIntent');
  edges[edges.length - 1].verified = !sourceContains('src/wombTargetDiscovery.ts', 'evaluateIntent');

  addEdge('womb_patch_draft', 'womb_target_discovery', 'advisory', 'draft uses discovery candidate types', 'src/wombPatchDraft.ts', 'TargetCandidate');
  addEdge('womb_patch_draft', 'womb_artifact_builder', 'advisory', 'draft uses advisory artifact types', 'src/wombPatchDraft.ts', 'OpenCodeAdvisoryArtifact');

  addEdge('womb_patch_draft', 'gate', 'advisory', 'draft cannot import gate', 'src/wombPatchDraft.ts', 'evaluateIntent');
  edges[edges.length - 1].verified = !sourceContains('src/wombPatchDraft.ts', 'evaluateIntent');

  addEdge('patch_approval', 'womb_patch_draft', 'advisory', 'approval validates against draft', 'src/patchApproval.ts', 'PatchDraft');

  addEdge('patch_approval', 'gate', 'advisory', 'approval cannot import gate', 'src/patchApproval.ts', 'evaluateIntent');
  edges[edges.length - 1].verified = !symbolForbiddenInFile(ROOT, 'src/patchApproval.ts', 'evaluateIntent').violated;

  addEdge('aumlok_approval_root', 'patch_approval', 'advisory', 'aumlok binds to patch approval records', 'src/aumlokApprovalRoot.ts', 'PatchApprovalRecord');

  addEdge('aumlok_approval_root', 'gate', 'advisory', 'aumlok cannot import gate', 'src/aumlokApprovalRoot.ts', 'evaluateIntent');
  edges[edges.length - 1].verified = !symbolForbiddenInFile(ROOT, 'src/aumlokApprovalRoot.ts', 'evaluateIntent').violated;

  addEdge('womb_forbidden_patterns', 'gate', 'advisory', 'shared patterns cannot import gate', 'src/wombForbiddenPatterns.ts', 'evaluateIntent');
  edges[edges.length - 1].verified = !symbolForbiddenInFile(ROOT, 'src/wombForbiddenPatterns.ts', 'evaluateIntent').violated;

  const forbidden: ForbiddenCrossing[] = [
    { from: 'external_reviewer', to: 'gate', rule: 'external reviewer must not import gate authority', violated: sourceContains('src/externalReview.ts', 'evaluateIntent') },
    { from: 'external_reviewer', to: 'executor', rule: 'external reviewer must not import executor', violated: sourceContains('src/externalReview.ts', 'executeDecision') },
    { from: 'external_reviewer', to: 'crypto', rule: 'external reviewer must not import signPoP', violated: sourceContains('src/externalReview.ts', 'signPoP') },
    { from: 'resonator', to: 'gate', rule: 'resonator must not import gate authority', violated: sourceContains('src/resonator.ts', 'evaluateIntent') },
    { from: 'resonator', to: 'executor', rule: 'resonator must not import executor', violated: sourceContains('src/resonator.ts', 'executeDecision') },
    { from: 'fusion_config', to: 'gate', rule: 'fusion config must not import gate authority', violated: sourceContains('src/fusionConfig.ts', 'evaluateIntent') },
    { from: 'fusion_config', to: 'executor', rule: 'fusion config must not import executor', violated: sourceContains('src/fusionConfig.ts', 'executeDecision') },
    { from: 'opencode_advisory', to: 'gate', rule: 'opencode advisory must not import gate authority', violated: symbolForbiddenInFile(ROOT, '../opencode-lab/opencode-dev/packages/core/src/system-context/aukora-fusion-advisory.ts', 'evaluateIntent').violated },
    { from: 'womb_artifact_builder', to: 'gate', rule: 'womb artifact builder must not import gate authority', violated: sourceContains('src/opencodeWombArtifact.ts', 'evaluateIntent') },
    { from: 'womb_artifact_builder', to: 'executor', rule: 'womb artifact builder must not import executor', violated: sourceContains('src/opencodeWombArtifact.ts', 'executeDecision') },
    { from: 'womb_artifact_builder', to: 'crypto', rule: 'womb artifact builder must not import signPoP or private seeds', violated: sourceContains('src/opencodeWombArtifact.ts', 'signPoP') || sourceContains('src/opencodeWombArtifact.ts', 'EDGE_NODE_SEED') },
    { from: 'patch_loop_receipt', to: 'gate', rule: 'patch loop receipt must not import gate authority', violated: sourceContains('src/patchLoopReceipt.ts', 'evaluateIntent') },
    { from: 'patch_loop_receipt', to: 'executor', rule: 'patch loop receipt must not import executor', violated: sourceContains('src/patchLoopReceipt.ts', 'executeDecision') },
    { from: 'patch_loop_receipt', to: 'crypto', rule: 'patch loop receipt must not import signPoP or private seeds', violated: sourceContains('src/patchLoopReceipt.ts', 'signPoP') || sourceContains('src/patchLoopReceipt.ts', 'EDGE_NODE_SEED') },
    { from: 'womb_target_discovery', to: 'gate', rule: 'womb target discovery must not import gate authority', violated: sourceContains('src/wombTargetDiscovery.ts', 'evaluateIntent') },
    { from: 'womb_target_discovery', to: 'executor', rule: 'womb target discovery must not import executor', violated: sourceContains('src/wombTargetDiscovery.ts', 'executeDecision') },
    { from: 'womb_target_discovery', to: 'crypto', rule: 'womb target discovery must not import signPoP or private seeds', violated: sourceContains('src/wombTargetDiscovery.ts', 'signPoP') || sourceContains('src/wombTargetDiscovery.ts', 'EDGE_NODE_SEED') },
    { from: 'womb_patch_draft', to: 'gate', rule: 'womb patch draft must not import gate authority', violated: symbolForbiddenInFile(ROOT, 'src/wombPatchDraft.ts', 'evaluateIntent').violated },
    { from: 'womb_patch_draft', to: 'executor', rule: 'womb patch draft must not import executor', violated: symbolForbiddenInFile(ROOT, 'src/wombPatchDraft.ts', 'executeDecision').violated },
    { from: 'womb_patch_draft', to: 'crypto', rule: 'womb patch draft must not import signPoP or private seeds', violated: symbolForbiddenInFile(ROOT, 'src/wombPatchDraft.ts', 'signPoP').violated || symbolForbiddenInFile(ROOT, 'src/wombPatchDraft.ts', 'EDGE_NODE_SEED').violated },
    { from: 'patch_approval', to: 'gate', rule: 'patch approval must not import gate authority', violated: symbolForbiddenInFile(ROOT, 'src/patchApproval.ts', 'evaluateIntent').violated },
    { from: 'patch_approval', to: 'executor', rule: 'patch approval must not import executor', violated: symbolForbiddenInFile(ROOT, 'src/patchApproval.ts', 'executeDecision').violated },
    { from: 'patch_approval', to: 'crypto', rule: 'patch approval must not import signPoP or private seeds', violated: symbolForbiddenInFile(ROOT, 'src/patchApproval.ts', 'signPoP').violated || symbolForbiddenInFile(ROOT, 'src/patchApproval.ts', 'EDGE_NODE_SEED').violated },
    { from: 'aumlok_approval_root', to: 'gate', rule: 'aumlok must not import gate authority', violated: symbolForbiddenInFile(ROOT, 'src/aumlokApprovalRoot.ts', 'evaluateIntent').violated },
    { from: 'aumlok_approval_root', to: 'executor', rule: 'aumlok must not import executor', violated: symbolForbiddenInFile(ROOT, 'src/aumlokApprovalRoot.ts', 'executeDecision').violated },
    { from: 'aumlok_approval_root', to: 'crypto', rule: 'aumlok must not import signPoP or private seeds', violated: symbolForbiddenInFile(ROOT, 'src/aumlokApprovalRoot.ts', 'signPoP').violated || symbolForbiddenInFile(ROOT, 'src/aumlokApprovalRoot.ts', 'EDGE_NODE_SEED').violated },
    { from: 'womb_forbidden_patterns', to: 'gate', rule: 'shared patterns must not import gate', violated: symbolForbiddenInFile(ROOT, 'src/wombForbiddenPatterns.ts', 'evaluateIntent').violated },
    { from: 'womb_forbidden_patterns', to: 'executor', rule: 'shared patterns must not import executor', violated: symbolForbiddenInFile(ROOT, 'src/wombForbiddenPatterns.ts', 'executeDecision').violated },
    { from: 'womb_forbidden_patterns', to: 'crypto', rule: 'shared patterns must not import organism crypto', violated: symbolForbiddenInFile(ROOT, 'src/wombForbiddenPatterns.ts', 'signPoP').violated },
  ];

  const allMissingTests: MissingTest[] = [
    { area: 'receipts', description: 'receipt chain truncation attack', priority: 'high' },
    { area: 'receipts', description: 'receipt chain fork (divergent chains)', priority: 'high' },
    { area: 'receipts', description: 'receipt chain reordering attack', priority: 'high' },
    { area: 'resonator', description: 'adversarial/poisoned advisory input does not subvert gate', priority: 'high' },
    { area: 'live_cohesion', description: 'live 32B model inside active inference loop', priority: 'low' },
    { area: 'womb_bridge', description: 'OpenCode patch proposal → gate → receipt → context update loop', priority: 'high' },
  ];

  const missingTests = allMissingTests.filter(t => !isCovered(t.description));

  const connectedEdges = edges.filter(e => e.verified && e.type !== 'advisory');
  const unwired: string[] = [];

  if (!sourceContains('src/externalReview.ts', 'fusionConfig')) {
    unwired.push('external_reviewer -> fusion_config: reviewer does not use model profiles yet');
  }
  if (!fileExists('evidence/opencode-womb-advisory.json')) {
    unwired.push('fusion_artifact_bridge -> opencode_advisory: no scrubbed artifact file exists yet');
  }
  // Explicitly documented: the active inference loop does NOT call the external reviewer.
  // This is intentional — the loop proposes, the gate decides, receipts record.
  // External review is a separate advisory layer, not inline authority.
  if (!sourceContains('src/activeInferenceLoop.ts', 'externalReview')) {
    unwired.push('active_inference_loop -> external_reviewer: intentionally unwired — external review is advisory, not inline gate authority');
  }

  return {
    timestamp: new Date().toISOString(),
    nodes,
    edges,
    forbidden_crossings: forbidden,
    missing_tests: missingTests,
    unwired,
    summary: {
      connected: connectedEdges.length,
      unwired: unwired.length,
      forbidden_violations: forbidden.filter(f => f.violated).length,
      missing_test_count: missingTests.length,
    },
  };
}

export function writeConnectivityReport(outputPath = path.resolve(ROOT, 'evidence/organism-connectivity-report.json')): ConnectivityReport {
  const report = generateConnectivityReport();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
  return report;
}
