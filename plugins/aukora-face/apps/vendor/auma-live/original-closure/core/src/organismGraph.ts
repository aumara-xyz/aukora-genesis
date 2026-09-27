import * as fs from 'fs';
import * as path from 'path';

export type NodeType =
  | 'module'
  | 'file'
  | 'authority_surface'
  | 'advisory_surface'
  | 'memory_surface'
  | 'test_surface'
  | 'evidence_artifact'
  | 'donor_pattern'
  | 'unwired_edge';

export type EdgeConfidence = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';
export type EdgeKind = 'authority' | 'advisory' | 'evidence' | 'forbidden';

export interface GraphNode {
  id: string;
  label: string;
  nodeType: NodeType;
  file: string;
  exists: boolean;
  rosettaLayer?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  confidence: EdgeConfidence;
  kind: EdgeKind;
  relation: string;
}

export interface OrganismGraph {
  timestamp: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  summary: {
    nodeCount: number;
    edgeCount: number;
    authorityNodes: number;
    advisoryNodes: number;
    memoryNodes: number;
    testNodes: number;
    evidenceNodes: number;
    authorityEdges: number;
    advisoryEdges: number;
    forbiddenEdges: number;
    rosettaLayersCovered: number;
  };
}

export interface AffectedFileReport {
  seedFiles: string[];
  directlyAffected: string[];
  testsAffected: string[];
  authoritySurfacesTouched: string[];
  advisorySurfacesTouched: string[];
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
}

const ROOT = path.resolve(__dirname, '..');
const SRC = path.resolve(__dirname);

const ROSETTA_LAYERS: Record<string, { files: string[]; surface: NodeType }> = {
  'L01_sacred_normalizer': { files: ['src/normalizer.ts'], surface: 'authority_surface' },
  'L02_cryptographic_gate': { files: ['src/index.ts'], surface: 'authority_surface' },
  'L03_receipt_chain': { files: ['src/crypto.ts'], surface: 'authority_surface' },
  'L04_vk_training_rows': { files: ['src/vk.ts', 'src/trainingExport.ts'], surface: 'authority_surface' },
  'L05_proposer_adapters': { files: ['src/proposer.ts', 'src/localModelProposer.ts', 'src/nebiusProposer.ts'], surface: 'advisory_surface' },
  'L06_executor': { files: ['src/executor.ts'], surface: 'authority_surface' },
  'L07_active_inference': { files: ['src/activeInferenceLoop.ts'], surface: 'authority_surface' },
  'L08_learner': { files: ['src/learner.ts'], surface: 'memory_surface' },
  'L09_hypothesis_memory': { files: ['src/hypothesisMemory.ts', 'src/memoryTypes.ts'], surface: 'memory_surface' },
  'L10_structural_memory': { files: ['src/structuralMemory.ts'], surface: 'memory_surface' },
  'L11_node_identity': { files: ['src/nodeIdentity.ts', 'src/pinnedPublicKey.ts'], surface: 'authority_surface' },
  'L12_convex_kernel': { files: [], surface: 'authority_surface' },
  'L13_chronos': { files: [], surface: 'advisory_surface' },
  'fusion_council': { files: ['src/fusionConfig.ts', 'src/fusionSwarm.ts'], surface: 'advisory_surface' },
  'opencode_advisory': { files: ['src/opencodeWombArtifact.ts', 'src/organismConnectivity.ts'], surface: 'advisory_surface' },
  'external_review': { files: ['src/externalReview.ts'], surface: 'advisory_surface' },
  'resonator': { files: ['src/resonator.ts'], surface: 'advisory_surface' },
  'nebius_spend': { files: ['src/nebiusSpend.ts'], surface: 'advisory_surface' },
  'first_contact_console': { files: [], surface: 'advisory_surface' },
};

const AUTHORITY_FILES = new Set([
  'index.ts', 'normalizer.ts', 'crypto.ts', 'vk.ts', 'trainingExport.ts',
  'executor.ts', 'activeInferenceLoop.ts', 'nodeIdentity.ts', 'pinnedPublicKey.ts',
  'loop.ts', 'burn.ts',
]);

const ADVISORY_FILES = new Set([
  'proposer.ts', 'localModelProposer.ts', 'nebiusProposer.ts',
  'externalReview.ts', 'fusionConfig.ts', 'fusionSwarm.ts',
  'opencodeWombArtifact.ts', 'organismConnectivity.ts', 'resonator.ts',
  'nebiusSpend.ts', 'nebiusSmoke.ts', 'chronosProtocol.ts',
]);

const MEMORY_FILES = new Set([
  'learner.ts', 'hypothesisMemory.ts', 'structuralMemory.ts', 'memoryTypes.ts',
]);

const FORBIDDEN_IMPORTS: [string, string, string][] = [
  ['externalReview.ts', 'evaluateIntent', 'reviewer must not import gate'],
  ['externalReview.ts', 'executeDecision', 'reviewer must not import executor'],
  ['externalReview.ts', 'signPoP', 'reviewer must not sign PoPs'],
  ['fusionConfig.ts', 'evaluateIntent', 'fusion must not import gate'],
  ['fusionConfig.ts', 'executeDecision', 'fusion must not import executor'],
  ['fusionSwarm.ts', 'evaluateIntent', 'swarm must not import gate'],
  ['opencodeWombArtifact.ts', 'evaluateIntent', 'artifact builder must not import gate'],
  ['opencodeWombArtifact.ts', 'executeDecision', 'artifact builder must not import executor'],
  ['opencodeWombArtifact.ts', 'signPoP', 'artifact builder must not sign PoPs'],
  ['resonator.ts', 'evaluateIntent', 'resonator must not import gate'],
  ['resonator.ts', 'executeDecision', 'resonator must not import executor'],
  ['learner.ts', 'evaluateIntent', 'learner must not import gate'],
  ['learner.ts', 'signPoP', 'learner must not sign PoPs'],
];

const FORBIDDEN_PATTERNS = [
  /sk-or-[a-zA-Z0-9]{20}/,
  /OPENROUTER_API_KEY\s*=\s*[a-zA-Z0-9]/,
  /Bearer\s+[a-zA-Z0-9]{20}/,
  /[0-9a-f]{64}/,
  /-----BEGIN\s+(RSA |EC )?PRIVATE KEY-----/,
  /signedHead\s*[=:]\s*[a-zA-Z0-9]/,
  /merkleRoot\s*[=:]\s*[a-zA-Z0-9]/,
  /nonce_[a-zA-Z0-9]{8}/,
  /receipt_[a-zA-Z0-9]{16}/,
];

const DONOR_PATTERNS: Array<{ id: string; label: string; relation: string }> = [
  {
    id: 'donor:voicebox-local-voice-io',
    label: 'Voicebox local voice I/O pattern',
    relation: 'inspires DEFAULT-OFF voice observer lane: consented STT/TTS, visible recording/speaking states, no authority',
  },
  {
    id: 'donor:openmontage-media-expression',
    label: 'OpenMontage media expression pattern',
    relation: 'inspires DEFAULT-OFF media expression lane: state-driven visuals/video skin, no copied code, no authority',
  },
];

function classifyFile(fileName: string): NodeType {
  if (AUTHORITY_FILES.has(fileName)) return 'authority_surface';
  if (ADVISORY_FILES.has(fileName)) return 'advisory_surface';
  if (MEMORY_FILES.has(fileName)) return 'memory_surface';
  return 'module';
}

function rosettaLayerFor(fileName: string): string | undefined {
  for (const [layer, info] of Object.entries(ROSETTA_LAYERS)) {
    if (info.files.some(f => f.endsWith(fileName))) return layer;
  }
  return undefined;
}

function extractImports(content: string): string[] {
  const imports: string[] = [];
  const re = /from\s+['"]\.\/([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    imports.push(m[1]);
  }
  return imports;
}

function fileContains(filePath: string, symbol: string): boolean {
  try {
    return fs.readFileSync(filePath, 'utf-8').includes(symbol);
  } catch {
    return false;
  }
}

export function buildOrganismGraph(): OrganismGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();

  const addNode = (id: string, label: string, nodeType: NodeType, file: string, rosettaLayer?: string) => {
    if (nodeIds.has(id)) return;
    nodeIds.add(id);
    nodes.push({
      id,
      label,
      nodeType,
      file,
      exists: fs.existsSync(path.resolve(ROOT, file)),
      rosettaLayer,
    });
  };

  const srcFiles = fs.readdirSync(SRC).filter(f => f.endsWith('.ts'));
  for (const file of srcFiles) {
    const nodeType = classifyFile(file);
    const layer = rosettaLayerFor(file);
    addNode(`src:${file}`, file.replace('.ts', ''), nodeType, `src/${file}`, layer);
  }

  const testDir = path.resolve(ROOT, 'tests');
  if (fs.existsSync(testDir)) {
    const testFiles = fs.readdirSync(testDir).filter(f => f.endsWith('.ts') || f.endsWith('.js'));
    for (const file of testFiles) {
      addNode(`test:${file}`, file.replace(/\.(ts|js)$/, ''), 'test_surface', `tests/${file}`);
    }
  }

  const evidenceDir = path.resolve(ROOT, 'evidence');
  if (fs.existsSync(evidenceDir)) {
    const evidenceFiles = fs.readdirSync(evidenceDir).filter(f => f.endsWith('.md') || f.endsWith('.json'));
    for (const file of evidenceFiles) {
      addNode(`evidence:${file}`, file, 'evidence_artifact', `evidence/${file}`);
    }
  }

  for (const file of srcFiles) {
    const filePath = path.resolve(SRC, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const imports = extractImports(content);

    for (const imp of imports) {
      const targetFile = imp.endsWith('.ts') ? imp : `${imp}.ts`;
      if (!srcFiles.includes(targetFile)) continue;

      const sourceType = classifyFile(file);
      const targetType = classifyFile(targetFile);

      let kind: EdgeKind = 'evidence';
      if (targetType === 'authority_surface') {
        kind = sourceType === 'authority_surface' ? 'authority' : 'advisory';
      } else if (targetType === 'advisory_surface') {
        kind = 'advisory';
      }

      edges.push({
        source: `src:${file}`,
        target: `src:${targetFile}`,
        confidence: 'EXTRACTED',
        kind,
        relation: 'imports',
      });
    }
  }

  for (const [file, symbol, rule] of FORBIDDEN_IMPORTS) {
    const filePath = path.resolve(SRC, file);
    if (!fs.existsSync(filePath)) continue;
    const violated = fileContains(filePath, symbol);
    edges.push({
      source: `src:${file}`,
      target: `forbidden:${symbol}`,
      confidence: 'EXTRACTED',
      kind: 'forbidden',
      relation: violated ? `VIOLATED: ${rule}` : `RESPECTED: ${rule}`,
    });
  }

  for (const [layer, info] of Object.entries(ROSETTA_LAYERS)) {
    if (info.files.length === 0) {
      addNode(`layer:${layer}`, layer, info.surface, '(external)', layer);
    }
  }

  for (const donor of DONOR_PATTERNS) {
    addNode(donor.id, donor.label, 'donor_pattern', 'docs/AUKORA_SYMBIOTE_SINGULARITY_PATH.md');
    edges.push({
      source: donor.id,
      target: 'layer:first_contact_console',
      confidence: 'INFERRED',
      kind: 'evidence',
      relation: donor.relation,
    });
  }

  const summary = {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    authorityNodes: nodes.filter(n => n.nodeType === 'authority_surface').length,
    advisoryNodes: nodes.filter(n => n.nodeType === 'advisory_surface').length,
    memoryNodes: nodes.filter(n => n.nodeType === 'memory_surface').length,
    testNodes: nodes.filter(n => n.nodeType === 'test_surface').length,
    evidenceNodes: nodes.filter(n => n.nodeType === 'evidence_artifact').length,
    authorityEdges: edges.filter(e => e.kind === 'authority').length,
    advisoryEdges: edges.filter(e => e.kind === 'advisory').length,
    forbiddenEdges: edges.filter(e => e.kind === 'forbidden').length,
    rosettaLayersCovered: new Set(nodes.filter(n => n.rosettaLayer).map(n => n.rosettaLayer)).size,
  };

  return { timestamp: new Date().toISOString(), nodes, edges, summary };
}

export function getAffectedFilesForPatch(seedFiles: string[]): AffectedFileReport {
  const graph = buildOrganismGraph();

  const edgeIndex = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    if (edge.kind === 'forbidden') continue;
    if (!edgeIndex.has(edge.target)) edgeIndex.set(edge.target, []);
    edgeIndex.get(edge.target)!.push(edge);
  }

  const seedIds = new Set<string>();
  for (const sf of seedFiles) {
    const baseName = path.basename(sf);
    for (const node of graph.nodes) {
      if (node.file.endsWith(baseName) || node.file === sf) {
        seedIds.add(node.id);
      }
    }
  }

  const visited = new Set<string>();
  const queue = [...seedIds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const inbound = edgeIndex.get(current) || [];
    for (const edge of inbound) {
      if (!visited.has(edge.source)) {
        queue.push(edge.source);
      }
    }
  }

  const affected = graph.nodes.filter(n => visited.has(n.id) && !seedIds.has(n.id));
  const directlyAffected = affected.filter(n => n.nodeType !== 'test_surface').map(n => n.file);
  const testsAffected = affected.filter(n => n.nodeType === 'test_surface').map(n => n.file);

  const allTouched = [...seedIds, ...visited];
  const touchedNodes = graph.nodes.filter(n => allTouched.includes(n.id));
  const authoritySurfacesTouched = touchedNodes
    .filter(n => n.nodeType === 'authority_surface')
    .map(n => n.file);
  const advisorySurfacesTouched = touchedNodes
    .filter(n => n.nodeType === 'advisory_surface')
    .map(n => n.file);

  let risk: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
  if (authoritySurfacesTouched.length > 0) risk = 'HIGH';
  else if (directlyAffected.length > 3) risk = 'MEDIUM';

  return {
    seedFiles,
    directlyAffected,
    testsAffected,
    authoritySurfacesTouched,
    advisorySurfacesTouched,
    risk,
  };
}

export function serializeGraphSafe(graph: OrganismGraph): string {
  const json = JSON.stringify(graph, null, 2);
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(json)) {
      throw new Error(`Organism graph contains forbidden pattern: ${pattern.source}`);
    }
  }
  return json;
}
