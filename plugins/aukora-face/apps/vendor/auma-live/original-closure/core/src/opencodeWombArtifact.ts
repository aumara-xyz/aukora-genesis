import { SwarmReviewResult } from './fusionSwarm';
// Private remote-compute spend lane excluded from the seed. Local structural stub of the
// SpendCheck shape it exported — types only, no env, no endpoints — so this builder still compiles.
type SpendEndpoint = { id: string; name: string; state: string; publicIp: string | null; modelId: string | null; stopped: boolean };
export type SpendCheck = { status: 'GREEN' | 'YELLOW' | 'RED'; running: SpendEndpoint[]; stopped: SpendEndpoint[]; warnings: string[] };
import { ConnectivityReport } from './organismConnectivity';
import { scrubSecrets, collectEnvSecrets } from './externalReview';
import { containsForbiddenContent as _containsForbidden } from './wombForbiddenPatterns';
import { AumaWombTurnAdvisoryState } from './aumaWombPrompt';
import { QuorumStatus } from './fusionConfig';
import { FractalFusionArtifactState } from './fractalFusion';
import { RestingGlyphProjection } from './restingGlyph';
import { SenseBusSnapshot } from './senseBus';
import { ConvexBrainSnapshot } from './convexBrainSnapshot';
import { AumlokBondAdvisoryState } from './aumlokBondCeremony';

export interface ProposalAdvisoryState {
  proposalId: string;
  targetFiles: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  reason: string;
  requiredTests: string[];
  approvalState: 'pending' | 'approved' | 'refused';
  verdict: 'proposed' | 'approved' | 'refused' | 'tested_green' | 'tested_red';
  testsPassed: number;
  testsFailed: number;
  advisoryOnly: true;
}

export interface PatchDraftAdvisoryState {
  draftId: string;
  proposalId: string;
  candidateId: string;
  targetFiles: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  intent: 'draft_only';
  summary: string;
  proposedChanges: string[];
  requiredTests: string[];
  refusalReason?: string;
  approvalRequired: true;
  advisoryOnly: true;
}

export interface PatchApprovalAdvisoryState {
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

export interface FusionDeepSweepAdvisoryState {
  completedCount: number;
  failureCount: number;
  totalCount: number;
  quorumStatus: QuorumStatus;
  consensus: 'GREEN' | 'YELLOW' | 'RED' | 'NO_QUORUM';
  greenCount: number;
  yellowCount: number;
  redCount: number;
  topFindings: string[];
  adapterFailures: Array<{ model: string; reason: string }>;
  advisoryOnly: true;
  grantsAuthority: false;
}

export function parseFusionDeepSweep(raw: any): FusionDeepSweepAdvisoryState | null {
  if (!raw || !raw.quorum || !raw.result) return null;
  const results: any[] = raw.result.results ?? [];
  const completed = results.filter((r: any) => !r.adapterFailure);
  const failures = results.filter((r: any) => r.adapterFailure);
  return {
    completedCount: raw.quorum.completedCount ?? completed.length,
    failureCount: raw.quorum.failureCount ?? failures.length,
    totalCount: raw.quorum.totalCount ?? results.length,
    quorumStatus: raw.quorum.status ?? 'NO_QUORUM',
    consensus: raw.result.synthesis?.consensus ?? 'NO_QUORUM',
    greenCount: raw.result.synthesis?.green_count ?? 0,
    yellowCount: raw.result.synthesis?.yellow_count ?? 0,
    redCount: raw.result.synthesis?.red_count ?? 0,
    topFindings: completed.slice(0, 5).map((r: any) => `[${r.label}] ${(r.findings ?? '').slice(0, 200)}`),
    adapterFailures: failures.map((r: any) => ({ model: r.model ?? 'unknown', reason: r.failureReason ?? 'unknown' })),
    advisoryOnly: true,
    grantsAuthority: false,
  };
}

export interface OpenCodeAdvisoryArtifact {
  consensus: 'GREEN' | 'YELLOW' | 'RED';
  findings_summary: string;
  risks_summary: string;
  recommended_next: string;
  timestamp: string;
  advisory_only: true;
  current_proposal?: ProposalAdvisoryState;
  current_patch_draft?: PatchDraftAdvisoryState;
  current_patch_approval?: PatchApprovalAdvisoryState;
  current_aumlok_binding?: AumlokBindingAdvisoryState;
  current_aumlok_bond?: AumlokBondAdvisoryState;
  current_auma_womb_turn?: AumaWombTurnAdvisoryState;
  current_fusion_deep_sweep?: FusionDeepSweepAdvisoryState;
  current_fractal_fusion_sweep?: FractalFusionArtifactState;
  current_resting_glyph_projection?: RestingGlyphProjection;
  current_sense_bus_snapshot?: SenseBusSnapshot;
  current_convex_brain_snapshot?: ConvexBrainSnapshot;
}

function containsForbidden(text: string): boolean {
  return _containsForbidden(text);
}

function cleanField(raw: string): string {
  let text = scrubSecrets(raw, collectEnvSecrets());
  if (containsForbidden(text)) {
    text = '[scrubbed — contained forbidden pattern]';
  }
  return text.slice(0, 2000);
}

function summarizeFindings(result: SwarmReviewResult): string {
  if (result.results.length === 0) return 'No council results (dry run or no models responded).';
  const lines: string[] = [];
  for (const r of result.results) {
    if (r.adapterFailure) {
      lines.push(`${r.label}: adapter failure (not counted as verdict)`);
    } else {
      lines.push(`${r.label}: ${r.verdict} (confidence ${r.confidence}/10)`);
    }
  }
  const { synthesis } = result;
  lines.push(`Consensus: ${synthesis.consensus} (${synthesis.green_count}G/${synthesis.yellow_count}Y/${synthesis.red_count}R, ${synthesis.failure_count} adapter failures)`);
  return lines.join('; ');
}

function summarizeRisks(
  result: SwarmReviewResult,
  spend: SpendCheck | null,
  connectivity: ConnectivityReport | null,
): string {
  const parts: string[] = [];

  const realRisks = result.results.filter(r => !r.adapterFailure && r.risks.trim());
  if (realRisks.length > 0) {
    parts.push('Council risks: ' + realRisks.map(r => `[${r.label}] ${r.risks}`).join('; '));
  }

  if (spend) {
    parts.push(`Nebius spend: ${spend.status}`);
    if (spend.warnings.length > 0) {
      parts.push('Spend warnings: ' + spend.warnings.join('; '));
    }
  }

  if (connectivity) {
    const s = connectivity.summary;
    parts.push(`Organism: ${s.connected} connected, ${s.unwired} unwired, ${s.forbidden_violations} boundary violations`);
    if (connectivity.unwired.length > 0) {
      parts.push('Unwired: ' + connectivity.unwired.join('; '));
    }
  }

  return parts.length > 0 ? parts.join('. ') : 'No risks surfaced.';
}

function summarizeRecommendedNext(result: SwarmReviewResult): string {
  const recs = result.results
    .filter(r => !r.adapterFailure && r.recommended_next_commit.trim())
    .map(r => r.recommended_next_commit);
  if (recs.length === 0) return 'No recommendations from council.';
  const unique = [...new Set(recs)];
  return unique.join('; ');
}

export function buildAdvisoryArtifact(
  fusionResult: SwarmReviewResult,
  spend: SpendCheck | null,
  connectivity: ConnectivityReport | null,
): OpenCodeAdvisoryArtifact {
  return {
    consensus: fusionResult.synthesis.consensus === 'NO_QUORUM' ? 'RED' : fusionResult.synthesis.consensus,
    findings_summary: cleanField(summarizeFindings(fusionResult)),
    risks_summary: cleanField(summarizeRisks(fusionResult, spend, connectivity)),
    recommended_next: cleanField(summarizeRecommendedNext(fusionResult)),
    timestamp: new Date().toISOString(),
    advisory_only: true,
  };
}

export interface LoopIterationState {
  testsPassed: number;
  testsFailed: number;
  testFiles: number;
  connectivity: ConnectivityReport;
  priorArtifact: OpenCodeAdvisoryArtifact | null;
  patchDescription: string;
  proposalState?: ProposalAdvisoryState | null;
  draftState?: PatchDraftAdvisoryState | null;
  approvalState?: PatchApprovalAdvisoryState | null;
  aumlokBindingState?: AumlokBindingAdvisoryState | null;
  aumaWombTurnState?: AumaWombTurnAdvisoryState | null;
  fusionDeepSweepState?: FusionDeepSweepAdvisoryState | null;
}

export function buildLoopArtifact(state: LoopIterationState): OpenCodeAdvisoryArtifact {
  const { testsPassed, testsFailed, testFiles, connectivity, priorArtifact, patchDescription, proposalState, draftState, approvalState, aumlokBindingState, aumaWombTurnState, fusionDeepSweepState } = state;
  const s = connectivity.summary;

  const testsOk = testsFailed === 0;
  const boundariesOk = s.forbidden_violations === 0;
  const consensus: 'GREEN' | 'YELLOW' | 'RED' =
    !testsOk ? 'RED' :
    !boundariesOk ? 'RED' :
    s.unwired > 0 ? 'YELLOW' :
    'GREEN';

  const findings = [
    `Patch: ${patchDescription}`,
    `Tests: ${testsPassed}/${testsPassed + testsFailed} passed (${testFiles} files)`,
    `Organism: ${s.connected} connected, ${s.unwired} unwired, ${s.forbidden_violations} boundary violations, ${s.missing_test_count} missing tests`,
  ];
  if (priorArtifact) {
    findings.push(`Prior consensus: ${priorArtifact.consensus} (${priorArtifact.timestamp})`);
  }

  const risks: string[] = [];
  if (!testsOk) risks.push(`${testsFailed} test(s) failed`);
  if (!boundariesOk) risks.push(`${s.forbidden_violations} forbidden crossing violation(s)`);
  if (connectivity.unwired.length > 0) {
    risks.push('Unwired: ' + connectivity.unwired.join('; '));
  }
  if (connectivity.missing_tests.length > 0) {
    const highPriority = connectivity.missing_tests.filter(t => t.priority === 'high');
    if (highPriority.length > 0) {
      risks.push(`${highPriority.length} high-priority missing tests: ${highPriority.map(t => t.description).join('; ')}`);
    }
  }

  const nextSteps: string[] = [];
  if (testsFailed > 0) nextSteps.push('Fix failing tests before next patch');
  if (s.forbidden_violations > 0) nextSteps.push('Resolve boundary violations');
  const highMissing = connectivity.missing_tests.filter(t => t.priority === 'high');
  if (highMissing.length > 0) nextSteps.push(`Address high-priority missing tests: ${highMissing[0].description}`);
  if (nextSteps.length === 0) nextSteps.push('All clear — propose next organism improvement');

  const artifact: OpenCodeAdvisoryArtifact = {
    consensus,
    findings_summary: cleanField(findings.join('. ')),
    risks_summary: cleanField(risks.length > 0 ? risks.join('. ') : 'No risks surfaced.'),
    recommended_next: cleanField(nextSteps.join('. ')),
    timestamp: new Date().toISOString(),
    advisory_only: true,
  };

  if (proposalState) {
    artifact.current_proposal = { ...proposalState, advisoryOnly: true };
  }

  if (draftState) {
    artifact.current_patch_draft = { ...draftState, advisoryOnly: true, approvalRequired: true, intent: 'draft_only' };
  }

  if (approvalState) {
    artifact.current_patch_approval = { ...approvalState, advisoryOnly: true, grantsAuthority: false };
  }

  if (aumlokBindingState) {
    artifact.current_aumlok_binding = { ...aumlokBindingState, advisoryOnly: true, grantsAuthority: false, mode: 'local_stub' };
  }

  if (aumaWombTurnState) {
    artifact.current_auma_womb_turn = { ...aumaWombTurnState, advisoryOnly: true, grantsAuthority: false, mode: 'draft_only' };
  }

  if (fusionDeepSweepState) {
    artifact.current_fusion_deep_sweep = { ...fusionDeepSweepState, advisoryOnly: true, grantsAuthority: false };
  }

  return artifact;
}

export function validateArtifact(artifact: OpenCodeAdvisoryArtifact): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  const fields = [artifact.findings_summary, artifact.risks_summary, artifact.recommended_next];
  for (const f of fields) {
    if (containsForbidden(f)) {
      violations.push(`Forbidden pattern found in field: ${f.slice(0, 40)}...`);
    }
  }
  if (!artifact.advisory_only) violations.push('advisory_only must be true');
  if (!['GREEN', 'YELLOW', 'RED'].includes(artifact.consensus)) violations.push('invalid consensus value');
  if (artifact.current_proposal) {
    if (!artifact.current_proposal.advisoryOnly) violations.push('current_proposal.advisoryOnly must be true');
    if ((artifact.current_proposal as any).pop) violations.push('current_proposal must not contain PoP');
    if ((artifact.current_proposal as any).signedHead) violations.push('current_proposal must not contain signedHead');
    if ((artifact.current_proposal as any).signature) violations.push('current_proposal must not contain signature');
  }
  if (artifact.current_patch_draft) {
    if (!artifact.current_patch_draft.advisoryOnly) violations.push('current_patch_draft.advisoryOnly must be true');
    if (!artifact.current_patch_draft.approvalRequired) violations.push('current_patch_draft.approvalRequired must be true');
    if (artifact.current_patch_draft.intent !== 'draft_only') violations.push('current_patch_draft.intent must be draft_only');
    if ((artifact.current_patch_draft as any).pop) violations.push('current_patch_draft must not contain PoP');
    if ((artifact.current_patch_draft as any).signedHead) violations.push('current_patch_draft must not contain signedHead');
    if ((artifact.current_patch_draft as any).signature) violations.push('current_patch_draft must not contain signature');
  }
  if (artifact.current_patch_approval) {
    if (!artifact.current_patch_approval.advisoryOnly) violations.push('current_patch_approval.advisoryOnly must be true');
    if (artifact.current_patch_approval.grantsAuthority !== false) violations.push('current_patch_approval.grantsAuthority must be false');
    if ((artifact.current_patch_approval as any).pop) violations.push('current_patch_approval must not contain PoP');
    if ((artifact.current_patch_approval as any).signedHead) violations.push('current_patch_approval must not contain signedHead');
    if ((artifact.current_patch_approval as any).signature) violations.push('current_patch_approval must not contain signature');
  }
  if (artifact.current_aumlok_binding) {
    if (!artifact.current_aumlok_binding.advisoryOnly) violations.push('current_aumlok_binding.advisoryOnly must be true');
    if (artifact.current_aumlok_binding.grantsAuthority !== false) violations.push('current_aumlok_binding.grantsAuthority must be false');
    if (artifact.current_aumlok_binding.mode !== 'local_stub') violations.push('current_aumlok_binding.mode must be local_stub');
    if ((artifact.current_aumlok_binding as any).pop) violations.push('current_aumlok_binding must not contain PoP');
    if ((artifact.current_aumlok_binding as any).signedHead) violations.push('current_aumlok_binding must not contain signedHead');
    if ((artifact.current_aumlok_binding as any).privateKey) violations.push('current_aumlok_binding must not contain privateKey');
  }
  if (artifact.current_aumlok_bond) {
    const b = artifact.current_aumlok_bond;
    if (!b.advisoryOnly) violations.push('current_aumlok_bond.advisoryOnly must be true');
    if (b.grantsAuthority !== false) violations.push('current_aumlok_bond.grantsAuthority must be false');
    if (b.signatureRequired !== true) violations.push('current_aumlok_bond.signatureRequired must be true');
    if (b.privateKeyInArtifact !== false) violations.push('current_aumlok_bond.privateKeyInArtifact must be false');
    if (!['unbound', 'phrase_revealed', 'public_fingerprint_pinned', 'presence_witnessed', 'ready_for_signature'].includes(b.bondState)) {
      violations.push('current_aumlok_bond.bondState invalid');
    }
    if (b.voicePresenceWitness && b.voicePresenceWitness.voiceIsAuthority !== false) {
      violations.push('current_aumlok_bond.voicePresenceWitness.voiceIsAuthority must be false');
    }
    // forbidden material must never ride in the bond — phrase/voice/biometric/key fields all refused
    for (const k of ['privateKey', 'seed', 'signingSeed', 'rawJwk', 'mnemonicSecret', 'bearerToken',
      'apiKey', 'voiceEmbedding', 'rawAudio', 'biometricTemplate', 'rawPhrase', 'unlockPhrase',
      'spokenChallengeHash', 'pop', 'signedHead', 'signature']) {
      if ((b as any)[k] !== undefined || (b.voicePresenceWitness && (b.voicePresenceWitness as any)[k] !== undefined)) {
        violations.push(`current_aumlok_bond must not contain ${k}`);
      }
    }
  }
  if (artifact.current_auma_womb_turn) {
    if (!artifact.current_auma_womb_turn.advisoryOnly) violations.push('current_auma_womb_turn.advisoryOnly must be true');
    if (artifact.current_auma_womb_turn.grantsAuthority !== false) violations.push('current_auma_womb_turn.grantsAuthority must be false');
    if (artifact.current_auma_womb_turn.mode !== 'draft_only') violations.push('current_auma_womb_turn.mode must be draft_only');
    if ((artifact.current_auma_womb_turn as any).pop) violations.push('current_auma_womb_turn must not contain PoP');
    if ((artifact.current_auma_womb_turn as any).signedHead) violations.push('current_auma_womb_turn must not contain signedHead');
    if ((artifact.current_auma_womb_turn as any).privateKey) violations.push('current_auma_womb_turn must not contain privateKey');
  }
  if (artifact.current_fusion_deep_sweep) {
    if (!artifact.current_fusion_deep_sweep.advisoryOnly) violations.push('current_fusion_deep_sweep.advisoryOnly must be true');
    if (artifact.current_fusion_deep_sweep.grantsAuthority !== false) violations.push('current_fusion_deep_sweep.grantsAuthority must be false');
    if ((artifact.current_fusion_deep_sweep as any).pop) violations.push('current_fusion_deep_sweep must not contain PoP');
    if ((artifact.current_fusion_deep_sweep as any).signedHead) violations.push('current_fusion_deep_sweep must not contain signedHead');
    if ((artifact.current_fusion_deep_sweep as any).privateKey) violations.push('current_fusion_deep_sweep must not contain privateKey');
  }
  if (artifact.current_fractal_fusion_sweep) {
    if (!artifact.current_fractal_fusion_sweep.advisoryOnly) violations.push('current_fractal_fusion_sweep.advisoryOnly must be true');
    if (artifact.current_fractal_fusion_sweep.grantsAuthority !== false) violations.push('current_fractal_fusion_sweep.grantsAuthority must be false');
    if ((artifact.current_fractal_fusion_sweep as any).pop) violations.push('current_fractal_fusion_sweep must not contain PoP');
    if ((artifact.current_fractal_fusion_sweep as any).signedHead) violations.push('current_fractal_fusion_sweep must not contain signedHead');
    if ((artifact.current_fractal_fusion_sweep as any).privateKey) violations.push('current_fractal_fusion_sweep must not contain privateKey');
  }
  if (artifact.current_resting_glyph_projection) {
    const g = artifact.current_resting_glyph_projection;
    if (!g.advisoryOnly) violations.push('current_resting_glyph_projection.advisoryOnly must be true');
    if (g.grantsAuthority !== false) violations.push('current_resting_glyph_projection.grantsAuthority must be false');
    if (!g.projectionHash) violations.push('current_resting_glyph_projection.projectionHash must be present');
    if (!g.shadowDecision) violations.push('current_resting_glyph_projection.shadowDecision must be present');
    if ((g as any).apiKey) violations.push('current_resting_glyph_projection must not contain apiKey');
    if ((g as any).privateKey) violations.push('current_resting_glyph_projection must not contain privateKey');
    if ((g as any).pop) violations.push('current_resting_glyph_projection must not contain PoP');
    if ((g as any).signedHead) violations.push('current_resting_glyph_projection must not contain signedHead');
    if ((g as any).hiddenState) violations.push('current_resting_glyph_projection must not contain hiddenState');
    if ((g as any).rawActivations) violations.push('current_resting_glyph_projection must not contain rawActivations');
    if ((g as any).kvCache) violations.push('current_resting_glyph_projection must not contain kvCache');
  }
  if (artifact.current_sense_bus_snapshot) {
    const s = artifact.current_sense_bus_snapshot;
    if (!s.advisoryOnly) violations.push('current_sense_bus_snapshot.advisoryOnly must be true');
    if (s.grantsAuthority !== false) violations.push('current_sense_bus_snapshot.grantsAuthority must be false');
    if (!s.snapshotHash) violations.push('current_sense_bus_snapshot.snapshotHash must be present');
    if (!s.duplexState) violations.push('current_sense_bus_snapshot.duplexState must be present');
    if (s.duplexState && !s.duplexState.advisoryOnly) violations.push('current_sense_bus_snapshot.duplexState.advisoryOnly must be true');
    if (s.duplexState && (s.duplexState as any).grantsAuthority !== false) violations.push('current_sense_bus_snapshot.duplexState.grantsAuthority must be false');
    if ((s as any).apiKey) violations.push('current_sense_bus_snapshot must not contain apiKey');
    if ((s as any).privateKey) violations.push('current_sense_bus_snapshot must not contain privateKey');
    if ((s as any).hiddenState) violations.push('current_sense_bus_snapshot must not contain hiddenState');
    if ((s as any).rawActivations) violations.push('current_sense_bus_snapshot must not contain rawActivations');
    if ((s as any).kvCache) violations.push('current_sense_bus_snapshot must not contain kvCache');
    for (const frame of (s.frames || [])) {
      if (frame.modality === 'voice' && (frame as any).transcriptTrusted !== false) {
        violations.push('voice frame transcriptTrusted must be false');
      }
    }
  }
  if (artifact.current_convex_brain_snapshot) {
    const cb = artifact.current_convex_brain_snapshot;
    if (!cb.advisoryOnly) violations.push('current_convex_brain_snapshot.advisoryOnly must be true');
    if (cb.grantsAuthority !== false) violations.push('current_convex_brain_snapshot.grantsAuthority must be false');
    if (!['static_inventory', 'local_loopback_readonly', 'missing'].includes(cb.bridgeMode)) violations.push('current_convex_brain_snapshot.bridgeMode invalid');
    if ((cb as any).deploymentUrl) violations.push('current_convex_brain_snapshot must not contain deploymentUrl');
    if ((cb as any).convexUrl) violations.push('current_convex_brain_snapshot must not contain convexUrl');
    if ((cb as any).apiKey) violations.push('current_convex_brain_snapshot must not contain apiKey');
    if ((cb as any).privateKey) violations.push('current_convex_brain_snapshot must not contain privateKey');
    if ((cb as any).deploymentSlug) violations.push('current_convex_brain_snapshot must not contain deploymentSlug');
    for (const organ of (cb.organs || [])) {
      if (organ.status === 'FORBIDDEN' && organ.safeToExposeToWomb) {
        violations.push(`FORBIDDEN organ ${organ.name} marked safe — contradiction`);
      }
    }
  }
  return { valid: violations.length === 0, violations };
}
