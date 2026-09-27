import {
  buildSwarmPlan,
  synthesizeSwarmResults,
  AUDIT_LENS_PROMPTS,
  AuditLens,
  SwarmInstance,
  AdvisoryResult,
  SwarmSynthesis,
  resolveApiKey,
} from './fusionConfig';
import { performExternalReview, AdvisoryReview, resetCallCount } from './externalReview';

export interface SwarmConfig {
  models: string[];
  instancesPerModel: number;
  lenses?: AuditLens[];
  dryRun?: boolean;
  maxTotalCalls?: number;
  outputPath?: string;
  reviewFn?: (evidencePack: string, secrets?: string[], options?: { testMode?: boolean; modelSlug?: string }) => Promise<AdvisoryReview>;
}

export interface SwarmReviewResult {
  advisory_only: true;
  authority_granted: false;
  memory_updated: false;
  gate_changed: false;
  key_source: string | null;
  plan: SwarmInstance[];
  results: AdvisoryResult[];
  synthesis: SwarmSynthesis;
}

export async function runSwarmReview(
  evidencePack: string,
  config: SwarmConfig
): Promise<SwarmReviewResult> {
  const plan = buildSwarmPlan(
    config.models,
    config.instancesPerModel,
    config.lenses
  );

  const keyResult = resolveApiKey();

  if (config.dryRun) {
    return {
      advisory_only: true,
      authority_granted: false,
      memory_updated: false,
      gate_changed: false,
      key_source: keyResult?.source ?? null,
      plan,
      results: [],
      synthesis: synthesizeSwarmResults([]),
    };
  }

  const maxCalls = config.maxTotalCalls ?? plan.length;
  const review = config.reviewFn ?? performExternalReview;
  const results: AdvisoryResult[] = [];

  resetCallCount();

  for (let i = 0; i < plan.length; i++) {
    if (i >= maxCalls) break;

    const instance = plan[i];
    const lensedPack = `--- AUDIT LENS: ${instance.lens} ---\n${AUDIT_LENS_PROMPTS[instance.lens]}\n\n${evidencePack}`;

    const start = Date.now();
    const result = await review(lensedPack, [], { modelSlug: instance.model });
    const durationMs = Date.now() - start;

    results.push({
      model: instance.model,
      lens: instance.lens,
      label: instance.label,
      durationMs,
      adapterFailure: !!result.failureReason,
      failureReason: result.failureReason,
      provider_contacted: true,   // review() was invoked for this model — a non-vote here is a real failed/empty call, not a skip
      verdict: result.verdict,
      findings: result.findings,
      risks: result.risks,
      missing_tests: result.missing_tests,
      recommended_next_commit: result.recommended_next_commit,
      confidence: result.confidence,
    });
  }

  const synthesis = synthesizeSwarmResults(results);

  return {
    advisory_only: true,
    authority_granted: false,
    memory_updated: false,
    gate_changed: false,
    key_source: keyResult?.source ?? null,
    plan,
    results,
    synthesis,
  };
}
