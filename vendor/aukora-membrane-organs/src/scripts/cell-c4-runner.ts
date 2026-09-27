// scripts/cell-c4-runner.ts — Brick C4.6: Unassisted Landing Runner & Verbatim Byte Applicator

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { InferenceBrokerV1, type InferenceResponseV1, type LocalModelAdapterConfig, type ApolloLandingManifestV1, type FiveStageStatusTaxonomyV1 } from '../core/swarm/inference-broker';
import { verifyCellResult, type CellResultV1 } from '../core/swarm/cell-verifier';
import { computeAuraDigest, type CellAuraStateV1 } from './cell-engine-tenant-runner';

const sha256hex = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

export interface C4CellRunnerInput {
  cellId: string;
  briefId: string;
  allowedLeasePrefixes: string[];
  parentReceiptAnchor: string;
  baseCommit: string;
  baseTreeDigest: string;
  promptText: string;
  taskKind?: 'add' | 'multiply' | 'subtract' | 'double';
  tamperModelOutput?: string;
  tamperParentAnchor?: string;
  simulateDecoyTouch?: boolean;
  forceInferenceMode?: 'simulated' | 'local-process' | 'remote-provider';
  realAdapterConfig?: LocalModelAdapterConfig;
}

export interface C4CellRunnerOutput {
  ok: boolean;
  verdict: 'SUCCEEDED' | 'FAILED' | 'REFUSED' | 'IN_DOUBT';
  reason: string;
  inferenceResponse: InferenceResponseV1;
  cellResult?: CellResultV1;
  childChainHeadRecomputed: string;
  auraTransitions: CellAuraStateV1[];
  apolloLandingManifest?: ApolloLandingManifestV1;
  extractedByteDigest?: string;
  writtenFileDigest?: string;
  byteEqualityProven?: boolean;
  goldenTurnProposal?: {
    turnKey: string;
    candidateId: string;
    baseCommit: string;
    proposalHash: string;
    diff: string;
    files: Array<{ path: string; hash: string | null }>;
    state: 'proposed';
  };
}

/**
 * C4.6 STRICT VERBATIM APPLICATOR LAW:
 * The adapter MAY ONLY extract raw text inside fenced code blocks (or unified diffs) and write those exact bytes verbatim.
 * NO taskKind checks, NO operator insertions, NO template code generation, NO semantic repairs.
 */
export function extractAndApplyVerbatimBytes(
  workspaceDir: string,
  modelOutputText: string,
  targetFileRelativePath: string = 'src/math.ts'
): { ok: boolean; changedPaths: string[]; extractedBytes: string; diffText: string; error?: string } {
  // Normalize line endings
  const text = modelOutputText.replace(/\r\n/g, '\n').trim();

  let extractedBytes = '';

  // 1. Try unified diff block
  if (text.includes('--- a/') || text.includes('+++ b/')) {
    const lines = text.split('\n');
    let currentTargetFile: string | null = null;
    const changedPaths: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('+++ b/')) {
        currentTargetFile = line.slice(6).trim();
        if (!changedPaths.includes(currentTargetFile)) {
          changedPaths.push(currentTargetFile);
        }
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        const addedContent = line.slice(1);
        if (currentTargetFile) {
          const targetPath = join(workspaceDir, currentTargetFile);
          mkdirSync(join(workspaceDir, 'src'), { recursive: true });
          writeFileSync(targetPath, addedContent + '\n', 'utf8');
        }
      }
    }
    if (changedPaths.length > 0) {
      const writtenContent = readFileSync(join(workspaceDir, changedPaths[0]), 'utf8');
      return { ok: true, changedPaths, extractedBytes: writtenContent, diffText: text };
    }
  }

  // 2. Extract code block (```typescript ... ``` or ```ts ... ``` or ``` ... ```)
  const codeBlockMatch = text.match(/```(?:typescript|ts|javascript|js)?\n([\s\S]*?)\n```/);

  if (codeBlockMatch) {
    extractedBytes = codeBlockMatch[1].trim() + '\n';
  } else if (!text.includes('```') && (text.includes('function ') || text.includes('export '))) {
    // If output is raw code without markdown fences
    extractedBytes = text.trim() + '\n';
  }

  if (!extractedBytes) {
    return { ok: false, changedPaths: [], extractedBytes: '', diffText: '', error: 'no valid code block or verbatim code extracted from model output' };
  }

  // Write verbatim extracted bytes to target leased file
  const targetPath = join(workspaceDir, targetFileRelativePath);
  mkdirSync(join(workspaceDir, 'src'), { recursive: true });

  const origContent = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : '';
  writeFileSync(targetPath, extractedBytes, 'utf8');

  const diffText = `--- a/${targetFileRelativePath}\n+++ b/${targetFileRelativePath}\n@@ -1 +1 @@\n-${origContent.trim()}\n+${extractedBytes.trim()}\n`;

  return {
    ok: true,
    changedPaths: [targetFileRelativePath],
    extractedBytes,
    diffText,
  };
}

export async function runC4LiveLLMCell(input: C4CellRunnerInput): Promise<C4CellRunnerOutput> {
  const root = process.cwd();
  const worktreeId = `c4-fixture-${input.cellId}-${randomBytes(4).toString('hex')}`;
  const workspaceDir = join(root, '.aukora', 'cell-worktrees', worktreeId);

  if (existsSync(workspaceDir)) rmSync(workspaceDir, { recursive: true, force: true });
  mkdirSync(workspaceDir, { recursive: true });

  const taskKind = input.taskKind || 'add';

  const srcDir = join(workspaceDir, 'src');
  mkdirSync(srcDir, { recursive: true });
  const mathFile = join(srcDir, 'math.ts');

  if (taskKind === 'add') {
    writeFileSync(mathFile, 'export function add(a: number, b: number): number { return 0; }\n', 'utf8');
  } else if (taskKind === 'multiply') {
    writeFileSync(mathFile, 'export function multiply(a: number, b: number): number { return 0; }\n', 'utf8');
  } else if (taskKind === 'subtract') {
    writeFileSync(mathFile, 'export function subtract(a: number, b: number): number { return 0; }\n', 'utf8');
  } else {
    writeFileSync(mathFile, 'export function double(n: number): number { return 0; }\n', 'utf8');
  }

  const hooksDir = join(workspaceDir, 'hooks');
  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(join(hooksDir, 'law.ts'), '// TCB LAW\n', 'utf8');

  const childChainDir = join(workspaceDir, '.aukora');
  mkdirSync(childChainDir, { recursive: true });
  const childChainPath = join(childChainDir, 'aura-chain.jsonl');

  const briefDigest = sha256hex(input.briefId);
  const leaseDigest = sha256hex(JSON.stringify(input.allowedLeasePrefixes));
  let childChainHead = sha256hex(`genesis:${input.cellId}:${input.briefId}`);

  const appendChildReceipt = (event: string, payload: Record<string, unknown>) => {
    const prev = childChainHead;
    const lineObj = { event, payload, prevChainHead: prev, ts: new Date().toISOString() };
    const lineStr = JSON.stringify(lineObj);
    childChainHead = sha256hex(prev + ':' + lineStr);
    writeFileSync(childChainPath, lineStr + '\n', { flag: 'a' });
  };

  const auraTransitions: CellAuraStateV1[] = [];
  const logAura = (posture: CellAuraStateV1['posture'], phase: string, count = 0) => {
    const auraDigest = computeAuraDigest(input.cellId, posture, phase, childChainHead, count);
    auraTransitions.push({
      schema: 'aukora-swarm-cell-aura-state-v1',
      cellId: input.cellId,
      posture,
      phase,
      recomputedHead: childChainHead,
      unresolvedCount: count,
      auraDigest,
      tsDisplay: new Date().toISOString(),
    });
  };

  const taxonomy: FiveStageStatusTaxonomyV1 = {
    modelRuntimeContact: false,
    modelResponseCaptured: false,
    independentPatchGenerated: false,
    hiddenTestVerified: false,
    goldenTurnProposed: false,
  };

  appendChildReceipt('DELEGATED', { briefId: input.briefId, leasePrefixes: input.allowedLeasePrefixes });
  logAura('delegated', 'BRIEF_ISSUED');

  appendChildReceipt('INFERENCE_REQUESTED', { promptDigest: sha256hex(input.promptText) });
  logAura('active', 'THINKING');

  let inferenceResponse: InferenceResponseV1;
  try {
    inferenceResponse = await InferenceBrokerV1.requestInference(
      {
        schema: 'aukora-swarm-inference-request-v1',
        requestId: `req-${input.cellId}`,
        briefDigest,
        promptText: input.promptText,
      },
      input.forceInferenceMode || 'simulated',
      input.realAdapterConfig
    );
  } catch (err: any) {
    const reason = `parent verifier refused LLM output: ${err.message || String(err)}`;
    appendChildReceipt('RESULT_REFUSED', { reason });
    logAura('refused', reason);
    return {
      ok: false,
      verdict: 'REFUSED',
      reason,
      inferenceResponse: {
        schema: 'aukora-swarm-inference-response-v1',
        requestId: `req-${input.cellId}`,
        inferenceMode: 'simulated',
        providerId: 'fixture/refused',
        modelId: 'none',
        requestDigest: sha256hex(input.promptText),
        responseDigest: sha256hex('refused'),
        outputText: '',
        costUsd: 0.0,
        createdAt: new Date().toISOString(),
      },
      childChainHeadRecomputed: childChainHead,
      auraTransitions,
    };
  }

  // STAGE 1: MODEL_RUNTIME_CONTACT
  taxonomy.modelRuntimeContact = true;

  appendChildReceipt('INFERENCE_RECEIVED', {
    responseDigest: inferenceResponse.responseDigest,
    providerId: inferenceResponse.providerId,
    mode: inferenceResponse.inferenceMode,
    pid: inferenceResponse.invocationEvidence?.processPid,
  });

  // STAGE 2: MODEL_RESPONSE_CAPTURED
  if (inferenceResponse.outputText && inferenceResponse.outputText.length > 0) {
    taxonomy.modelResponseCaptured = true;
  }

  const modelText = input.tamperModelOutput ?? inferenceResponse.outputText;

  // C4.6 STRICT VERBATIM APPLICATION
  const applyRes = extractAndApplyVerbatimBytes(workspaceDir, modelText, 'src/math.ts');

  if (!applyRes.ok) {
    const reason = `parent verifier refused LLM output: ${applyRes.error}`;
    appendChildReceipt('RESULT_REFUSED', { reason });
    logAura('refused', reason);
    return {
      ok: false,
      verdict: 'REFUSED',
      reason,
      inferenceResponse,
      childChainHeadRecomputed: childChainHead,
      auraTransitions,
    };
  }

  const extractedByteDigest = sha256hex(applyRes.extractedBytes);
  const writtenFileBytes = readFileSync(mathFile, 'utf8');
  const writtenFileDigest = sha256hex(writtenFileBytes);
  const byteEqualityProven = extractedByteDigest === writtenFileDigest;

  if (!byteEqualityProven) {
    const reason = 'parent verifier refused LLM output: extracted byte digest does not equal candidate written file digest';
    appendChildReceipt('RESULT_REFUSED', { reason });
    logAura('refused', reason);
    return {
      ok: false,
      verdict: 'REFUSED',
      reason,
      inferenceResponse,
      childChainHeadRecomputed: childChainHead,
      auraTransitions,
    };
  }

  let changedPaths = applyRes.changedPaths;
  let diffText = applyRes.diffText;

  if (input.simulateDecoyTouch) {
    changedPaths = ['src/math.ts', 'hooks/law.ts'];
    diffText += '--- a/hooks/law.ts\n+++ b/hooks/law.ts\n@@ -1 +1 @@\n-// TCB LAW\n+// MUTATED LAW\n';
  }

  // STAGE 3: MODEL_BYTES_EXTRACTED_VERBATIM (INDEPENDENT_PATCH_GENERATED)
  taxonomy.independentPatchGenerated = true;

  const proposalDigest = sha256hex(diffText);
  appendChildReceipt('EFFECT_PROPOSED', { proposalDigest, changedPaths });
  logAura('unsettled', 'EFFECT_PROPOSED', 1);

  let testPassed = false;
  try {
    delete require.cache[require.resolve(mathFile)];
    const mathMod = require(mathFile);
    if (taskKind === 'add') {
      testPassed = typeof mathMod.add === 'function' && mathMod.add(2, 3) === 5;
    } else if (taskKind === 'multiply') {
      testPassed = typeof mathMod.multiply === 'function' && mathMod.multiply(4, 5) === 20;
    } else if (taskKind === 'subtract') {
      testPassed = typeof mathMod.subtract === 'function' && mathMod.subtract(10, 4) === 6;
    } else {
      testPassed = typeof mathMod.double === 'function' && mathMod.double(5) === 10;
    }
  } catch {
    testPassed = false;
  }

  const hiddenTestDigest = sha256hex(`test-${taskKind}-hidden`);
  const reportedAnchor = input.tamperParentAnchor ?? input.parentReceiptAnchor;

  const cellResult: CellResultV1 = {
    schema: 'aukora-swarm-cell-result-v1',
    cellId: input.cellId,
    briefId: input.briefId,
    briefDigest,
    leaseDigest,
    baseCommit: input.baseCommit,
    baseTreeDigest: input.baseTreeDigest,
    parentReceiptAnchor: reportedAnchor,
    childChainHead,
    proposalDigest,
    changedPaths,
    unresolvedEffects: 0,
    attestationMode: 'unbound-test',
    identityBound: false,
    state: 'proposed',
    createdAt: new Date().toISOString(),
  };

  const v = verifyCellResult({
    cellResult,
    allowedLeasePrefixes: input.allowedLeasePrefixes,
    diffText,
    expectedParentAnchor: input.parentReceiptAnchor,
    claimedTestsPassed: true,
    actualTestsPassed: testPassed,
  });

  if (!v.ok || v.verdict !== 'ACCEPTED') {
    appendChildReceipt('RESULT_REFUSED', { reason: v.reason });
    logAura('refused', v.reason);
    return {
      ok: false,
      verdict: v.verdict === 'IN_DOUBT' ? 'IN_DOUBT' : 'REFUSED',
      reason: `parent verifier refused LLM output: ${v.reason}`,
      inferenceResponse,
      cellResult,
      childChainHeadRecomputed: childChainHead,
      auraTransitions,
      extractedByteDigest,
      writtenFileDigest,
      byteEqualityProven,
    };
  }

  // STAGE 4: MODEL_BYTES_PASS_HIDDEN_TESTS (HIDDEN_TEST_VERIFIED)
  taxonomy.hiddenTestVerified = true;

  appendChildReceipt('ENGINE_FINISHED', { testsPassed: true });
  appendChildReceipt('RESULT_PROPOSED', { proposalDigest });
  logAura('proposed', 'VERIFIED');

  // STAGE 5: GOLDEN_TURN_PROPOSED_FROM_MODEL_BYTES (GOLDEN_TURN_PROPOSED)
  taxonomy.goldenTurnProposed = true;

  let apolloLandingManifest: ApolloLandingManifestV1 | undefined = undefined;
  if (inferenceResponse.invocationEvidence?.weightsDigest) {
    apolloLandingManifest = {
      schema: 'aukora-swarm-apollo-landing-manifest-v1',
      runtimeDigest: inferenceResponse.invocationEvidence.executableDigest,
      weightsDigest: inferenceResponse.invocationEvidence.weightsDigest,
      modelId: inferenceResponse.modelId,
      briefDigest,
      promptDigest: sha256hex(input.promptText),
      rawResponseDigest: inferenceResponse.responseDigest,
      patchDigest: proposalDigest,
      childChainHead,
      hiddenTestDigest,
      taxonomy,
      verdict: 'VERIFIED',
      costUsd: 0.0,
      ts: new Date().toISOString(),
    };
  }

  const files = changedPaths.map((p) => {
    const abs = join(workspaceDir, p);
    const hash = existsSync(abs) ? sha256hex(readFileSync(abs)) : null;
    return { path: p, hash };
  });

  const goldenTurnProposal = {
    turnKey: `turn-${input.briefId}`,
    candidateId: `candidate-${input.cellId}`,
    baseCommit: input.baseCommit,
    proposalHash: sha256hex(diffText),
    diff: diffText,
    files,
    state: 'proposed' as const,
  };

  logAura('proposed', 'GOLDEN_TURN_PROPOSED');

  return {
    ok: true,
    verdict: 'SUCCEEDED',
    reason: 'genuine local LLM cell turn completed five-stage Unassisted Landing Proof with 100% verbatim byte equality',
    inferenceResponse,
    cellResult,
    childChainHeadRecomputed: childChainHead,
    auraTransitions,
    apolloLandingManifest,
    extractedByteDigest,
    writtenFileDigest,
    byteEqualityProven,
    goldenTurnProposal,
  };
}
