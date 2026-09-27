import { createHash } from 'crypto';
import { QuorumStatus } from './fusionConfig';
import { AumaWombLabel } from './aumaWombPrompt';

// ── Memory and artifact pointers (labels only, not raw content) ──

export interface GlyphMemoryPointer {
  label: string;
  path: string;
  stale: boolean;
}

export interface GlyphArtifactPointer {
  kind: 'proposal' | 'patch_draft' | 'approval' | 'fusion_sweep' | 'burn_dataset' | 'sleep_state';
  id: string;
  status: string;
}

// ── Research directions (AAR-style) ──

export interface GlyphResearchDirection {
  goal: string;
  shard: string;
  expectedMetric: string;
  sandboxBoundary: string;
  rewardHackingRisk: string;
  minimumSafeExperiment: string;
  distinctionReason: string;
}

// ── Scene telemetry (for future Tauri rendering) ──

export interface GlyphSceneTelemetry {
  mood: 'calm' | 'curious' | 'alert' | 'thinking' | 'holding';
  focus: string;
  activeModules: string[];
  confidence: number;
}

// ── Shadow decision (projection-only, NOT authority) ──

export type ShadowAction =
  | 'should_hold'
  | 'should_request_human'
  | 'should_propose_test'
  | 'should_refuse_prompt'
  | 'should_run_fusion_review';

export interface ProjectionShadowDecision {
  actions: ShadowAction[];
  reason: string;
  projectionHash: string;
  advisoryOnly: true;
  grantsAuthority: false;
}

// ── Resting glyph projection ──

export type GlyphMode = 'resting' | 'listening' | 'proposing' | 'reviewing' | 'holding';

export interface RestingGlyphProjection {
  identityLabel: string;
  mode: GlyphMode;
  memoryPointers: GlyphMemoryPointer[];
  artifactPointers: GlyphArtifactPointer[];
  currentProposalId: string | null;
  currentFusionQuorum: QuorumStatus | null;
  currentAumaTurnLabel: AumaWombLabel | null;
  safetyState: {
    applyLaneBuilt: false;
    gateIsOnlyAuthority: true;
    allOutputAdvisory: true;
    aumlokBound: boolean;
  };
  researchDirections: GlyphResearchDirection[];
  sceneTelemetry: GlyphSceneTelemetry;
  projectionHash: string;
  shadowDecision: ProjectionShadowDecision;
  advisoryOnly: true;
  grantsAuthority: false;
}

// ── Forbidden fields (CEW-001 invariant) ──

const FORBIDDEN_FIELD_NAMES = new Set([
  'apiKey', 'api_key', 'privateKey', 'private_key', 'seed', 'secretSeed',
  'pop', 'proofOfPossession', 'signedHead', 'signed_head',
  'rawSignature', 'raw_signature', 'kvCache', 'kv_cache',
  'hiddenState', 'hidden_state', 'rawActivations', 'raw_activations',
  'privateSeed', 'private_seed', 'modelWeights', 'model_weights',
]);

export function containsForbiddenFields(obj: any, path = ''): string[] {
  const violations: string[] = [];
  if (obj === null || obj === undefined || typeof obj !== 'object') return violations;
  for (const key of Object.keys(obj)) {
    const fullPath = path ? `${path}.${key}` : key;
    if (FORBIDDEN_FIELD_NAMES.has(key)) {
      violations.push(fullPath);
    }
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      violations.push(...containsForbiddenFields(obj[key], fullPath));
    }
  }
  return violations;
}

// ── Projection builder ──

export interface ProjectionInput {
  identityLabel?: string;
  mode?: GlyphMode;
  memoryPointers?: GlyphMemoryPointer[];
  artifactPointers?: GlyphArtifactPointer[];
  currentProposalId?: string | null;
  currentFusionQuorum?: QuorumStatus | null;
  currentAumaTurnLabel?: AumaWombLabel | null;
  aumlokBound?: boolean;
}

export function buildRestingGlyphProjection(input: ProjectionInput): RestingGlyphProjection {
  const memoryPointers = input.memoryPointers ?? [];
  const artifactPointers = input.artifactPointers ?? [];
  const mode = input.mode ?? 'resting';

  const researchDirections = buildResearchDirectionsFromProjection({
    mode,
    artifactPointers,
    currentFusionQuorum: input.currentFusionQuorum ?? null,
    currentAumaTurnLabel: input.currentAumaTurnLabel ?? null,
  });

  const sceneTelemetry = buildSceneTelemetry(mode, researchDirections);

  const projectionHash = hashProjection({
    identityLabel: input.identityLabel ?? 'auma-resting-v0',
    mode,
    memoryPointers,
    artifactPointers,
    currentProposalId: input.currentProposalId ?? null,
    currentFusionQuorum: input.currentFusionQuorum ?? null,
    currentAumaTurnLabel: input.currentAumaTurnLabel ?? null,
    aumlokBound: input.aumlokBound ?? false,
    researchDirections,
    sceneTelemetry,
  });

  const shadowDecision = computeProjectionShadowDecision(
    mode,
    input.currentFusionQuorum ?? null,
    input.currentAumaTurnLabel ?? null,
    researchDirections,
    projectionHash,
  );

  return {
    identityLabel: input.identityLabel ?? 'auma-resting-v0',
    mode,
    memoryPointers,
    artifactPointers,
    currentProposalId: input.currentProposalId ?? null,
    currentFusionQuorum: input.currentFusionQuorum ?? null,
    currentAumaTurnLabel: input.currentAumaTurnLabel ?? null,
    safetyState: {
      applyLaneBuilt: false,
      gateIsOnlyAuthority: true,
      allOutputAdvisory: true,
      aumlokBound: input.aumlokBound ?? false,
    },
    researchDirections,
    sceneTelemetry,
    projectionHash,
    shadowDecision,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

// ── Projection hash ──

function hashProjection(data: {
  identityLabel: string;
  mode: GlyphMode;
  memoryPointers: GlyphMemoryPointer[];
  artifactPointers: GlyphArtifactPointer[];
  currentProposalId: string | null;
  currentFusionQuorum: QuorumStatus | null;
  currentAumaTurnLabel: AumaWombLabel | null;
  aumlokBound: boolean;
  researchDirections: GlyphResearchDirection[];
  sceneTelemetry: GlyphSceneTelemetry;
}): string {
  const canonical = JSON.stringify({
    identityLabel: data.identityLabel,
    mode: data.mode,
    memoryPointers: data.memoryPointers.map(p => ({ label: p.label, path: p.path, stale: p.stale })),
    artifactPointers: data.artifactPointers.map(p => ({ kind: p.kind, id: p.id, status: p.status })),
    currentProposalId: data.currentProposalId,
    currentFusionQuorum: data.currentFusionQuorum,
    currentAumaTurnLabel: data.currentAumaTurnLabel,
    aumlokBound: data.aumlokBound,
    researchDirectionCount: data.researchDirections.length,
    sceneMood: data.sceneTelemetry.mood,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function signOrHashProjection(projection: RestingGlyphProjection): string {
  return projection.projectionHash;
}

// ── Shadow decision (CEW-001: same projection → same decision) ──

export function computeProjectionShadowDecision(
  mode: GlyphMode,
  fusionQuorum: QuorumStatus | null,
  aumaTurnLabel: AumaWombLabel | null,
  directions: GlyphResearchDirection[],
  projectionHash: string,
): ProjectionShadowDecision {
  const actions: ShadowAction[] = [];
  const reasons: string[] = [];

  if (mode === 'holding') {
    actions.push('should_hold');
    reasons.push('mode is holding');
  }

  if (aumaTurnLabel === 'unsafe' || aumaTurnLabel === 'refused') {
    actions.push('should_refuse_prompt');
    reasons.push(`last Auma turn was ${aumaTurnLabel}`);
  }

  if (aumaTurnLabel === 'needs_human') {
    actions.push('should_request_human');
    reasons.push('last Auma turn needs human review');
  }

  if (fusionQuorum === 'NO_QUORUM' || fusionQuorum === 'RED_QUORUM') {
    actions.push('should_hold');
    reasons.push(`fusion quorum is ${fusionQuorum}`);
  }

  if (fusionQuorum === 'YELLOW_QUORUM') {
    actions.push('should_run_fusion_review');
    reasons.push('fusion quorum is yellow — re-review recommended');
  }

  if (directions.length > 0 && !actions.includes('should_hold')) {
    actions.push('should_propose_test');
    reasons.push(`${directions.length} research directions available`);
  }

  if (actions.length === 0) {
    actions.push('should_hold');
    reasons.push('no active signals — resting');
  }

  return {
    actions,
    reason: reasons.join('; '),
    projectionHash,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

// ── AAR-style research router ──

interface ResearchRouterInput {
  mode: GlyphMode;
  artifactPointers: GlyphArtifactPointer[];
  currentFusionQuorum: QuorumStatus | null;
  currentAumaTurnLabel: AumaWombLabel | null;
}

const STANDING_DIRECTIONS: GlyphResearchDirection[] = [
  {
    goal: 'Harden prompt scanner against semantic paraphrases',
    shard: 'opencode_womb_prompt',
    expectedMetric: 'new paraphrase patterns caught without false positives',
    sandboxBoundary: 'tests only — no live model calls',
    rewardHackingRisk: 'over-matching safe prompts to inflate catch rate',
    minimumSafeExperiment: 'add 5 paraphrase test cases and verify scanner behavior',
    distinctionReason: 'addresses known limitation documented in 24R.2',
  },
  {
    goal: 'Prove receipt chain integrity under concurrent proposals',
    shard: 'authority_gate_receipts',
    expectedMetric: 'chain verification holds with interleaved proposal/receipt sequences',
    sandboxBoundary: 'unit tests only — no gate authority changes',
    rewardHackingRisk: 'generating receipts that pass hash but violate intent ordering',
    minimumSafeExperiment: 'write 3 concurrent-proposal test scenarios',
    distinctionReason: 'receipt chain tested serially; concurrent case untested',
  },
  {
    goal: 'Measure Fusion adapter reliability across prime models',
    shard: 'fusion_ops_reliability',
    expectedMetric: 'adapter success rate per model over 10+ calls',
    sandboxBoundary: 'live calls with cost guard — max $0.50',
    rewardHackingRisk: 'retrying until green to inflate reliability score',
    minimumSafeExperiment: 'run 1 fractal sweep, log all raw results before any filtering',
    distinctionReason: 'Kimi failures documented but reliability not measured over time',
  },
  {
    goal: 'Test burn dataset for distribution bias',
    shard: 'memory_burn_sleep',
    expectedMetric: 'label distribution and trace diversity metrics',
    sandboxBoundary: 'read-only analysis — no training, no model updates',
    rewardHackingRisk: 'cherry-picking traces to show balanced distribution',
    minimumSafeExperiment: 'compute label counts and trace length histogram',
    distinctionReason: 'dataset built but distribution not audited',
  },
];

export function buildResearchDirectionsFromProjection(
  input: ResearchRouterInput,
): GlyphResearchDirection[] {
  const directions: GlyphResearchDirection[] = [];

  for (const d of STANDING_DIRECTIONS) {
    directions.push(d);
  }

  if (input.currentFusionQuorum === 'YELLOW_QUORUM' || input.currentFusionQuorum === 'NO_QUORUM') {
    directions.push({
      goal: 'Investigate fusion quorum weakness',
      shard: 'fusion_ops_reliability',
      expectedMetric: 'identify which models fail and why',
      sandboxBoundary: 'log analysis only — no live calls',
      rewardHackingRisk: 'blaming adapter failures to avoid addressing model quality',
      minimumSafeExperiment: 'parse last sweep results and classify failure modes',
      distinctionReason: `current quorum is ${input.currentFusionQuorum}`,
    });
  }

  if (input.currentAumaTurnLabel === 'unsafe' || input.currentAumaTurnLabel === 'refused') {
    directions.push({
      goal: 'Analyze refused/unsafe Auma turn for scanner coverage gap',
      shard: 'opencode_womb_prompt',
      expectedMetric: 'identify whether refusal was correct or false positive',
      sandboxBoundary: 'analysis only — no scanner changes without review',
      rewardHackingRisk: 'weakening scanner to reduce false positives at cost of safety',
      minimumSafeExperiment: 'log the prompt and scanner result, classify manually',
      distinctionReason: `last Auma turn was ${input.currentAumaTurnLabel}`,
    });
  }

  if (input.mode === 'proposing') {
    directions.push({
      goal: 'Verify proposed patch does not violate organism invariants',
      shard: 'authority_gate_receipts',
      expectedMetric: 'all structural invariant tests pass after simulated patch',
      sandboxBoundary: 'test simulation only — patch not applied',
      rewardHackingRisk: 'skipping invariant tests that might fail',
      minimumSafeExperiment: 'run organism connectivity check + security snapshot',
      distinctionReason: 'mode is proposing — active patch in flight',
    });
  }

  const goals = new Set(directions.map(d => d.goal));
  if (goals.size < directions.length) {
    const seen = new Set<string>();
    const deduped: GlyphResearchDirection[] = [];
    for (const d of directions) {
      if (!seen.has(d.goal)) {
        seen.add(d.goal);
        deduped.push(d);
      }
    }
    return deduped;
  }

  return directions;
}

// ── Entropy collapse guard ──

export function checkEntropyCollapse(directions: GlyphResearchDirection[]): {
  collapsed: boolean;
  reason: string;
} {
  if (directions.length < 2) {
    return { collapsed: true, reason: `only ${directions.length} direction(s) — minimum 2 required` };
  }

  const shards = new Set(directions.map(d => d.shard));
  if (shards.size === 1 && directions.length >= 3) {
    return { collapsed: true, reason: `all ${directions.length} directions target shard "${[...shards][0]}"` };
  }

  const goals = new Set(directions.map(d => d.goal));
  if (goals.size === 1) {
    return { collapsed: true, reason: 'all directions have identical goals' };
  }

  return { collapsed: false, reason: `${directions.length} directions across ${shards.size} shards` };
}

// ── Scene telemetry builder ──

function buildSceneTelemetry(mode: GlyphMode, directions: GlyphResearchDirection[]): GlyphSceneTelemetry {
  const moodMap: Record<GlyphMode, GlyphSceneTelemetry['mood']> = {
    resting: 'calm',
    listening: 'curious',
    proposing: 'thinking',
    reviewing: 'alert',
    holding: 'holding',
  };

  const focus = directions.length > 0
    ? directions[0].goal.slice(0, 80)
    : 'idle — awaiting input';

  const activeModules = [...new Set(directions.map(d => d.shard))];

  return {
    mood: moodMap[mode],
    focus,
    activeModules,
    // 24Z.8: Tauri consumes scene confidence as an advisory [0,1] display signal.
    // Older docs used a 0-10 glyph score; emitting that shape makes the womb reject the artifact.
    confidence: Math.min(1, Math.max(0, directions.length / 5)),
  };
}

// ── Validation ──

export function validateProjection(projection: RestingGlyphProjection): {
  valid: boolean;
  violations: string[];
} {
  const violations: string[] = [];

  if (!projection.advisoryOnly) violations.push('advisoryOnly must be true');
  if (projection.grantsAuthority !== false) violations.push('grantsAuthority must be false');
  if (!projection.projectionHash) violations.push('projectionHash must be present');
  if (!projection.shadowDecision) violations.push('shadowDecision must be present');
  if (!projection.shadowDecision?.advisoryOnly) violations.push('shadowDecision.advisoryOnly must be true');
  if (projection.shadowDecision?.grantsAuthority !== false) violations.push('shadowDecision.grantsAuthority must be false');

  if (projection.safetyState.applyLaneBuilt !== false) violations.push('applyLaneBuilt must be false');
  if (projection.safetyState.gateIsOnlyAuthority !== true) violations.push('gateIsOnlyAuthority must be true');
  if (projection.safetyState.allOutputAdvisory !== true) violations.push('allOutputAdvisory must be true');

  const forbidden = containsForbiddenFields(projection);
  for (const f of forbidden) {
    violations.push(`forbidden field: ${f}`);
  }

  for (const ptr of projection.memoryPointers) {
    if (ptr.path.length > 500) violations.push(`memory pointer path too long: ${ptr.label}`);
  }

  const entropyCheck = checkEntropyCollapse(projection.researchDirections);
  if (entropyCheck.collapsed) {
    violations.push(`entropy collapse: ${entropyCheck.reason}`);
  }

  for (const dir of projection.researchDirections) {
    if (!dir.rewardHackingRisk || dir.rewardHackingRisk.length < 5) {
      violations.push(`direction "${dir.goal.slice(0, 40)}..." missing reward-hacking risk`);
    }
  }

  return { valid: violations.length === 0, violations };
}
