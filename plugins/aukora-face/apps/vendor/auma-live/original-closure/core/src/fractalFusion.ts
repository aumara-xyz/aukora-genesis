import {
  AdvisoryResult,
  AuditLens,
  SwarmSynthesis,
  synthesizeSwarmResults,
  evaluateFusionQuorum,
  QuorumEvaluation,
  buildFusionRetryPack,
  FusionRetryPack,
  PRIME_MODELS,
} from './fusionConfig';
import { AdvisoryReview } from './externalReview';
import { resolveBudgetSchedule } from './fusionSelfOpt';

// ── Context shards ──

export type ShardName =
  | 'authority_gate_receipts'
  | 'memory_burn_sleep'
  | 'opencode_womb_prompt'
  | 'fusion_ops_reliability'
  | 'vk_chronos_parked_safety';

export const SHARD_NAMES: readonly ShardName[] = [
  'authority_gate_receipts',
  'memory_burn_sleep',
  'opencode_womb_prompt',
  'fusion_ops_reliability',
  'vk_chronos_parked_safety',
];

export interface FusionShard {
  name: ShardName;
  label: string;
  evidencePack: string;
  maxBytes: number;
}

export interface ShardEvidence {
  authority_gate_receipts: string;
  memory_burn_sleep: string;
  opencode_womb_prompt: string;
  fusion_ops_reliability: string;
  vk_chronos_parked_safety: string;
}

const SHARD_MAX_BYTES = 20_000;

export function buildContextShards(evidence: ShardEvidence): FusionShard[] {
  return SHARD_NAMES.map(name => ({
    name,
    label: name.replace(/_/g, ' '),
    evidencePack: evidence[name].slice(0, SHARD_MAX_BYTES),
    maxBytes: SHARD_MAX_BYTES,
  }));
}

// ── Shard review result ──

export interface ShardReviewResult {
  shard: ShardName;
  model: string;
  lens: AuditLens;
  label: string;
  durationMs: number;
  adapterFailure: boolean;
  failureReason?: string;
  verdict: 'GREEN' | 'YELLOW' | 'RED';
  findings: string;
  risks: string;
  selfImprovementNote: string;
  confidence: number;
  provider_contacted?: boolean;
}

// ── Fractal swarm plan ──

export interface FractalSwarmInstance {
  shard: ShardName;
  model: string;
  lens: AuditLens;
  label: string;
}

export function buildFractalSwarmPlan(
  shards: FusionShard[],
  models: string[],
  lensPerShard: Record<ShardName, AuditLens>,
): FractalSwarmInstance[] {
  const plan: FractalSwarmInstance[] = [];
  for (const shard of shards) {
    const lens = lensPerShard[shard.name];
    for (const model of models) {
      const shortName = model.split('/').pop() || model;
      plan.push({
        shard: shard.name,
        model,
        lens,
        label: `${shortName}:${shard.name}:${lens}`,
      });
    }
  }
  return plan;
}

export const DEFAULT_LENS_ASSIGNMENT: Record<ShardName, AuditLens> = {
  authority_gate_receipts: 'security',
  memory_burn_sleep: 'cohesion',
  opencode_womb_prompt: 'security',
  fusion_ops_reliability: 'cost_ops',
  vk_chronos_parked_safety: 'security',
};

// ── Parallel runner (mocked/testable) ──

export type ReviewFn = (
  evidencePack: string,
  secrets?: string[],
  options?: { testMode?: boolean; modelSlug?: string },
) => Promise<AdvisoryReview>;

export type ShardScheduleMode = 'full' | 'cheap_full' | 'prime_focus' | 'retry_only';

export const CHEAP_MODELS = [
  'z-ai/glm-5.2',
  'deepseek/deepseek-v4-pro',
  'qwen/qwen3-coder',
] as const;

export const FOCUS_MODELS = [
  'anthropic/claude-opus-4.8',
  'z-ai/glm-5.2',
  'moonshotai/kimi-k2.6',
] as const;

export interface ResolvedSchedule {
  mode: ShardScheduleMode;
  models: string[];
  shards: ShardName[];
  expectedCalls: number;
}

export function resolveSchedule(
  mode: ShardScheduleMode,
  opts?: { focusShard?: ShardName; retryPairs?: Array<{ shard: ShardName; model: string }> },
): ResolvedSchedule {
  switch (mode) {
    case 'full':
      return {
        mode,
        models: [...PRIME_MODELS],
        shards: [...SHARD_NAMES],
        expectedCalls: PRIME_MODELS.length * SHARD_NAMES.length,
      };
    case 'cheap_full':
      return {
        mode,
        models: [...CHEAP_MODELS],
        shards: [...SHARD_NAMES],
        expectedCalls: CHEAP_MODELS.length * SHARD_NAMES.length,
      };
    case 'prime_focus': {
      const shard = opts?.focusShard ?? SHARD_NAMES[0];
      return {
        mode,
        models: [...FOCUS_MODELS],
        shards: [shard],
        expectedCalls: FOCUS_MODELS.length,
      };
    }
    case 'retry_only': {
      const pairs = opts?.retryPairs ?? [];
      const models = [...new Set(pairs.map(p => p.model))];
      const shards = [...new Set(pairs.map(p => p.shard))] as ShardName[];
      return {
        mode,
        models,
        shards,
        expectedCalls: pairs.length,
      };
    }
  }
}

export interface FractalFusionConfig {
  models: string[];
  lensPerShard?: Record<ShardName, AuditLens>;
  concurrency: number;
  dryRun?: boolean;
  reviewFn?: ReviewFn;
  scheduleMode?: ShardScheduleMode;
  // Budget-aware: attempt AT MOST this many provider calls (resolveSchedule spreads them across shards).
  // Unscheduled calls are NOT run and never appear as fake rate_cap failures (Fusion self-optimization v0).
  maxScheduled?: number;
}

export interface FractalFusionResult {
  advisory_only: true;
  authority_granted: false;
  shardResults: ShardReviewResult[];
  perShardSynthesis: Record<ShardName, SwarmSynthesis>;
  overallQuorum: QuorumEvaluation;
  overallConsensus: 'GREEN' | 'YELLOW' | 'RED' | 'NO_QUORUM';
  retryPacks: FusionRetryPack[];
  integratorInput: IntegratorInput;
}

export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const i = nextIndex++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

export async function runFractalFusionReview(
  evidence: ShardEvidence,
  config: FractalFusionConfig,
): Promise<FractalFusionResult> {
  const shards = buildContextShards(evidence);
  const lensMap = config.lensPerShard ?? DEFAULT_LENS_ASSIGNMENT;
  const fullPlan = buildFractalSwarmPlan(shards, config.models, lensMap);
  // Budget-aware scheduling: attempt only the calls we can afford (spread across shards). Unscheduled calls
  // are NOT run and never appear as fake rate_cap failures — the coverage gap lives in the schedule summary.
  const plan = config.maxScheduled !== undefined ? resolveBudgetSchedule(fullPlan, config.maxScheduled).scheduled : fullPlan;

  const shardResults: ShardReviewResult[] = [];

  if (config.dryRun) {
    return buildFractalResult(shardResults, evidence);
  }

  const reviewFn = config.reviewFn;
  if (!reviewFn) {
    return buildFractalResult(shardResults, evidence);
  }

  const shardMap = new Map(shards.map(s => [s.name, s]));

  const tasks = plan.map(instance => () => runFusionInstance(instance, shardMap.get(instance.shard)!, reviewFn));

  const raw = await runWithConcurrency(tasks, config.concurrency);
  shardResults.push(...raw);

  return buildFractalResult(shardResults, evidence);
}

/** Run ONE (model × shard × lens) instance and map it to a ShardReviewResult. Shared by the main swarm run
 *  and the governed retry lane so a retry produces the SAME label as the original (for supersede matching). */
async function runFusionInstance(instance: FractalSwarmInstance, shard: FusionShard, reviewFn: ReviewFn): Promise<ShardReviewResult> {
  const prompt = [
    `--- FRACTAL FUSION SHARD: ${shard.name} ---`,
    `LENS: ${instance.lens}`,
    '',
    shard.evidencePack,
    '',
    'MANDATORY: Include a self_improvement_note answering: "How can Fusion improve itself?"',
    '',
    'Answer with structured JSON: {verdict, findings, risks, self_improvement_note, confidence}',
  ].join('\n');
  const start = Date.now();
  const result = await reviewFn(prompt, [], { modelSlug: instance.model });
  const durationMs = Date.now() - start;
  return {
    shard: instance.shard, model: instance.model, lens: instance.lens, label: instance.label, durationMs,
    adapterFailure: !!result.failureReason, failureReason: result.failureReason,
    verdict: result.verdict, findings: result.findings, risks: result.risks,
    selfImprovementNote: result.recommended_next_commit, confidence: result.confidence,
    provider_contacted: result.provider_contacted,
  } as ShardReviewResult;
}

/** The governed retry lane's LIVE execution: re-run ONLY the given failed pairs (already capped to the retry
 *  budget by planRetry), producing ShardReviewResults with the SAME labels so applyRetryResults can supersede
 *  matching non_votes. Never runs the whole council. A pair whose evidence can't be rebuilt returns unchanged. */
export async function retryFusionPairs(evidence: ShardEvidence, failed: ShardReviewResult[], reviewFn: ReviewFn, concurrency: number): Promise<ShardReviewResult[]> {
  const shardMap = new Map(buildContextShards(evidence).map(s => [s.name, s]));
  const tasks = failed.map(f => async () => {
    const shard = shardMap.get(f.shard);
    if (!shard) return f;
    return runFusionInstance({ shard: f.shard, model: f.model, lens: f.lens, label: f.label }, shard, reviewFn);
  });
  return runWithConcurrency(tasks, Math.max(1, concurrency));
}

function buildFractalResult(
  shardResults: ShardReviewResult[],
  evidence: ShardEvidence,
): FractalFusionResult {
  const perShardSynthesis: Record<string, SwarmSynthesis> = {};

  for (const name of SHARD_NAMES) {
    const shardItems = shardResults.filter(r => r.shard === name);
    const asAdvisory: AdvisoryResult[] = shardItems.map(r => ({
      model: r.model,
      lens: r.lens,
      label: r.label,
      durationMs: r.durationMs,
      adapterFailure: r.adapterFailure,
      failureReason: r.failureReason,
      verdict: r.verdict,
      findings: r.findings,
      risks: r.risks,
      missing_tests: '',
      recommended_next_commit: r.selfImprovementNote,
      confidence: r.confidence,
      provider_contacted: r.provider_contacted,
    }));
    perShardSynthesis[name] = synthesizeSwarmResults(asAdvisory);
  }

  const allAsAdvisory: AdvisoryResult[] = shardResults.map(r => ({
    model: r.model,
    lens: r.lens,
    label: r.label,
    durationMs: r.durationMs,
    adapterFailure: r.adapterFailure,
    failureReason: r.failureReason,
    verdict: r.verdict,
    findings: r.findings,
    risks: r.risks,
    missing_tests: '',
    recommended_next_commit: r.selfImprovementNote,
    confidence: r.confidence,
    provider_contacted: r.provider_contacted,
  }));

  const overallQuorum = evaluateFusionQuorum(allAsAdvisory);
  const overallSynthesis = synthesizeSwarmResults(allAsAdvisory);

  const failedItems = shardResults.filter(r => r.adapterFailure);
  const retryPacks: FusionRetryPack[] = [];
  const failedByShardModel = new Map<string, ShardReviewResult>();
  for (const f of failedItems) {
    failedByShardModel.set(`${f.shard}:${f.model}`, f);
  }
  for (const [, f] of failedByShardModel) {
    const shardEvidence = evidence[f.shard];
    retryPacks.push(buildFusionRetryPack(
      [{ ...f, missing_tests: '', recommended_next_commit: '' }],
      'Gate decides. Advisory only.',
      [],
      0,
      `Re-review shard "${f.shard}" — prior attempt failed with ${f.failureReason ?? 'unknown'}`,
    ));
  }

  const integratorInput = buildIntegratorInput(shardResults, perShardSynthesis as Record<ShardName, SwarmSynthesis>, overallQuorum);

  return {
    advisory_only: true,
    authority_granted: false,
    shardResults,
    perShardSynthesis: perShardSynthesis as Record<ShardName, SwarmSynthesis>,
    overallQuorum,
    overallConsensus: overallSynthesis.consensus,
    retryPacks,
    integratorInput,
  };
}

// ── Integrator ──

export interface IntegratorInput {
  shardSummaries: Array<{
    shard: ShardName;
    consensus: string;
    topFindings: string[];
    topRisks: string[];
  }>;
  disagreementPoints: string[];
  repeatedRisks: string[];
  adapterFailures: Array<{ model: string; shard: ShardName; reason: string }>;
  selfImprovementNotes: string[];
  mandatoryQuestions: readonly string[];
}

export const INTEGRATOR_MANDATORY_QUESTIONS: readonly string[] = [
  'Is the organism cohesive?',
  'What is embarrassing or unwired?',
  'What should Fusion improve about itself?',
  'What is the next smallest safe commit?',
];

function buildIntegratorInput(
  results: ShardReviewResult[],
  perShard: Record<ShardName, SwarmSynthesis>,
  quorum: QuorumEvaluation,
): IntegratorInput {
  const shardSummaries = SHARD_NAMES.map(name => {
    const synthesis = perShard[name];
    const shardResults = results.filter(r => r.shard === name && !r.adapterFailure);
    return {
      shard: name,
      consensus: synthesis.consensus,
      topFindings: shardResults.map(r => r.findings).filter(f => f.length > 0).slice(0, 3),
      topRisks: shardResults.map(r => r.risks).filter(r => r.length > 0).slice(0, 3),
    };
  });

  const allFindings = results.filter(r => !r.adapterFailure).map(r => r.findings.toLowerCase());
  const riskTexts = results.filter(r => !r.adapterFailure).map(r => r.risks.toLowerCase());

  const findingWords = allFindings.join(' ');
  const repeatedRisks: string[] = [];
  const riskKeywords = ['authority', 'apply', 'deploy', 'scanner', 'heuristic', 'mock', 'stub', 'dead code', 'stale'];
  for (const kw of riskKeywords) {
    const count = riskTexts.filter(r => r.includes(kw)).length;
    if (count >= 2) {
      repeatedRisks.push(`"${kw}" mentioned in ${count} reviews`);
    }
  }

  const verdicts = results.filter(r => !r.adapterFailure).map(r => r.verdict);
  const disagreementPoints: string[] = [];
  const distinctVerdicts = new Set(verdicts);
  if (distinctVerdicts.size > 1) {
    for (const r of results.filter(r => !r.adapterFailure)) {
      if (r.verdict !== perShard[r.shard].consensus) {
        disagreementPoints.push(`${r.label} gave ${r.verdict} but shard consensus is ${perShard[r.shard].consensus}`);
      }
    }
  }

  const adapterFailures = results
    .filter(r => r.adapterFailure)
    .map(r => ({ model: r.model, shard: r.shard, reason: r.failureReason ?? 'unknown' }));

  const selfImprovementNotes = results
    .filter(r => !r.adapterFailure && r.selfImprovementNote.length > 0)
    .map(r => `[${r.label}] ${r.selfImprovementNote.slice(0, 200)}`);

  return {
    shardSummaries,
    disagreementPoints,
    repeatedRisks,
    adapterFailures,
    selfImprovementNotes,
    mandatoryQuestions: INTEGRATOR_MANDATORY_QUESTIONS,
  };
}

// ── Artifact type ──

export interface FractalFusionArtifactState {
  quorumStatus: string;
  consensus: string;
  shardSummaries: Array<{ shard: string; consensus: string; findingCount: number }>;
  topRisks: string[];
  nextRecommendation: string;
  selfImprovementNotes: string[];
  adapterFailureCount: number;
  advisoryOnly: true;
  grantsAuthority: false;
}

export function buildFractalArtifact(result: FractalFusionResult): FractalFusionArtifactState {
  const shardSummaries = SHARD_NAMES.map(name => ({
    shard: name,
    consensus: result.perShardSynthesis[name].consensus,
    findingCount: result.perShardSynthesis[name].completed_count,
  }));

  const topRisks = result.integratorInput.repeatedRisks.slice(0, 5);

  const selfImprovementNotes = result.integratorInput.selfImprovementNotes.slice(0, 5);

  const completedResults = result.shardResults.filter(r => !r.adapterFailure);
  const nextRecommendation = completedResults.length > 0
    ? completedResults[0].selfImprovementNote.slice(0, 200)
    : 'No recommendations — all adapters failed';

  return {
    quorumStatus: result.overallQuorum.status,
    consensus: result.overallConsensus,
    shardSummaries,
    topRisks,
    nextRecommendation,
    selfImprovementNotes,
    adapterFailureCount: result.overallQuorum.failureCount,
    advisoryOnly: true,
    grantsAuthority: false,
  };
}
