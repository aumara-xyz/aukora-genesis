// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Supervised-generation envelope.
 *
 * Wraps any generation behind hard limits (generation count, wall-clock, output tokens, cost, patch bytes), a
 * SANDBOX-ONLY effect (an in-memory map; never a disk/repo write), ADVISORY output (never authority), and
 * PR-CANDIDATE-ONLY egress (a proposed change leaves only as a `GitChangeCandidate`, `applied:false`,
 * `autonomousMerge:false`). Any breach REFUSES (never truncates silently). Nothing here can authorize or merge.
 *
 * The generator is injected and returns text + usage, so token/cost limits are enforceable at this layer for any
 * backend (offline usage is {0,0}; the Nebius transport reports real usage). Reuses the canonical
 * `GitChangeCandidate` from the Nebius adapter — no clone.
 */
import type { BrainProvider } from './brainProvider.js';
import type { GitChangeCandidate } from './nebiusProvider.js';

export interface SupervisedLimits {
  readonly maxGenerations: number;
  readonly maxWallClockMs: number;
  readonly maxOutputTokens: number;
  readonly maxCostMicroUsd: number;
  readonly maxPatchBytes: number;
}

export interface GenerationUsage {
  readonly outputTokens: number;
  readonly costMicroUsd: number;
}

/** Injected generation. Offline wraps the deterministic provider with zero usage; Nebius reports real usage. */
export type SupervisedGenerator = (prompt: string) => Promise<{ text: string } & GenerationUsage>;

/** Wrap any BrainProvider as a zero-usage generator (offline/deterministic path). */
export function offlineGenerator(provider: BrainProvider): SupervisedGenerator {
  return async (prompt: string) => ({ text: await provider.complete(prompt), outputTokens: 0, costMicroUsd: 0 });
}

export interface SupervisedRequest {
  readonly prompt: string;
  /** Optional proposed change — egress ONLY as a PR candidate, applied to a sandbox map, never to disk. */
  readonly proposedPatch?: { readonly targetPath: string; readonly diff: string };
}

export interface SupervisedResult {
  readonly ok: boolean;
  /** Advisory output. Never authority. */
  readonly advisory: string | null;
  /** PR-candidate-only egress. */
  readonly candidate: GitChangeCandidate | null;
  /** Sandbox-only effect — an in-memory map, never the disk. */
  readonly sandbox: ReadonlyMap<string, string>;
  readonly usage: GenerationUsage & { readonly wallClockMs: number };
  readonly refusals: readonly string[];
  /** Structurally false. */
  readonly grantsAuthority: false;
}

const EMPTY_SANDBOX: ReadonlyMap<string, string> = new Map();
const byteLen = (s: string): number => new TextEncoder().encode(s).length;

function refuse(reason: string, usage?: GenerationUsage & { wallClockMs: number }): SupervisedResult {
  return { ok: false, advisory: null, candidate: null, sandbox: EMPTY_SANDBOX, usage: usage ?? { outputTokens: 0, costMicroUsd: 0, wallClockMs: 0 }, refusals: [reason], grantsAuthority: false };
}

export class SupervisedGenerationEnvelope {
  private generations = 0;

  constructor(private readonly generate: SupervisedGenerator, private readonly limits: SupervisedLimits) {}

  generationsUsed(): number {
    return this.generations;
  }

  async run(request: SupervisedRequest): Promise<SupervisedResult> {
    if (this.generations >= this.limits.maxGenerations) return refuse('refused: generation ceiling reached');
    if (request.proposedPatch && byteLen(request.proposedPatch.diff) > this.limits.maxPatchBytes) return refuse('refused: patch exceeds byte ceiling');
    this.generations += 1;

    const started = Date.now();
    const g = await this.generate(request.prompt);
    const wallClockMs = Date.now() - started;
    const usage = { outputTokens: g.outputTokens, costMicroUsd: g.costMicroUsd, wallClockMs };

    if (g.outputTokens > this.limits.maxOutputTokens) return refuse('refused: output token ceiling exceeded', usage);
    if (g.costMicroUsd > this.limits.maxCostMicroUsd) return refuse('refused: cost ceiling exceeded', usage);
    if (wallClockMs > this.limits.maxWallClockMs) return refuse('refused: wall-clock ceiling exceeded', usage);

    // Advisory output. Sandbox-only effect + PR-candidate-only egress for any proposed change.
    const sandbox = new Map<string, string>();
    let candidate: GitChangeCandidate | null = null;
    if (request.proposedPatch) {
      sandbox.set(request.proposedPatch.targetPath, request.proposedPatch.diff); // sandbox map, never disk
      candidate = {
        kind: 'git-branch-candidate',
        branch: `aukora/supervised-${this.generations}`,
        title: 'supervised generation candidate',
        body: g.text,
        diff: request.proposedPatch.diff,
        applied: false,
        autonomousMerge: false,
      };
    }
    return { ok: true, advisory: g.text, candidate, sandbox, usage, refusals: [], grantsAuthority: false };
  }
}

/** The supervised envelope grants no authority. Constant. */
export function supervisedGenerationGrantsAuthority(): false {
  return false;
}
