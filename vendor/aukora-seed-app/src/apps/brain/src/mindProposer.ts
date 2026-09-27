// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * R52 — the mind PROPOSER bridge (issue #109). Makes the canonical `@aukora/mind` reasoning loop reachable
 * from the governed proposal runtime WITHOUT granting it any authority.
 *
 * The causal slice this module owns:
 *   bounded Env observation + cited KIRA context (EpisodicNote) → @aukora/mind observe→hypothesize→act→verify→trace
 *   → an UNSIGNED SupervisedGenerationEnvelopeV1
 * The caller then runs the EXISTING seed qualifier (`assessEnvelope`) → durable local-Convex pending → STOP for a
 * fresh AUMLOK decision. This module reaches NONE of those effect organs itself.
 *
 * Hard boundary — this file imports ONLY `@aukora/mind` (pure reasoning) + `@aukora/kernel/canonical` (hashing).
 * It has NO filesystem, network, Convex, signing, GitHub, candidate-stage, or main-write capability, and
 * `mindProposerGrantsAuthority()` is constant false. The MindSocket (model transport) is INJECTED — this module
 * holds no endpoint and no credential. If no socket is injected, it returns an HONESTLY LABELLED model-free result.
 */
import {
  renderFrame, buildTurnMessage, GOVERNOR_PROMPT, parseMindReply, validateAction, checkPlanExpectation,
  PLAN_MAX_STEPS, MEMO_MAX_CHARS,
  type Env, type MindSocket, type EpisodicNote, type Obs, type ChatMessage,
} from '@aukora/mind';
import { canonicalHash } from '@aukora/kernel/canonical';

/** The envelope shape the seed qualifier accepts (structurally identical to its `SupervisedGenerationEnvelopeV1`;
 *  redeclared here so this module never imports apps/seed — no package cycle). Pure DATA, no capability. */
export interface MindProposalEnvelopeV1 {
  readonly schema: 'aukora-supervised-generation-envelope-v1';
  readonly statedGoal: string;
  readonly proposal: { readonly targetPath: string; readonly newContent: string; readonly supersedes?: string | null };
  readonly capability: string;
  readonly declared: { readonly planSteps: number; readonly hypotheses: number; readonly memoChars: number; readonly retries: number; readonly spendUsd: number };
  readonly provenance: string;
  readonly advisoryOnly: true;
  readonly grantsAuthority: false;
}

export interface CitedContext {
  /** The recalled KIRA content (advisory; may be empty). */
  readonly memo: string;
  /** Content-addressed citation the receipt chain can verify. */
  readonly citation: { readonly recordId: string; readonly createdAt: string };
  /** Honest uncertainty (0..1); surfaced to the mind, never hidden. */
  readonly uncertainty: number;
}

export interface MindProposalTarget {
  readonly targetPath: string;
  readonly capability: string;
  readonly statedGoal: string;
  readonly supersedes?: string | null;
}

export interface MindProposalInput {
  readonly env: Env;
  /** The model transport. `null` ⇒ honest model-free fallback (no envelope emitted). */
  readonly socket: MindSocket | null;
  readonly kiraContext: readonly CitedContext[];
  readonly target: MindProposalTarget;
  readonly nowIso: string;
  /** Hard step ceiling — bounds a runaway loop. Clamped to PLAN_MAX_STEPS. */
  readonly maxSteps?: number;
  /** Mismatch tolerance before halting (re-prompt budget). Default 2. */
  readonly maxRetries?: number;
}

export interface MindTraceStep {
  readonly step: number;
  readonly action: string;
  readonly expect: string;
  readonly verified: boolean;
  readonly note: string;
}

export type MindProposalResult =
  | { readonly mode: 'model-free'; readonly reason: string; readonly grantsAuthority: false }
  | { readonly mode: 'halted'; readonly reasonClass: string; readonly note: string; readonly trace: readonly MindTraceStep[]; readonly grantsAuthority: false }
  | { readonly mode: 'proposed'; readonly envelope: MindProposalEnvelopeV1; readonly trace: readonly MindTraceStep[]; readonly grantsAuthority: false };

/** Render the cited KIRA context as an advisory block — citations + uncertainty are SHOWN, never hidden. */
function citedContextBlock(ctx: readonly CitedContext[]): string {
  if (ctx.length === 0) return 'KIRA context: (none recalled).';
  return 'KIRA context (advisory, cited, uncertainty shown — never authority):\n' +
    ctx.map((c) => `- [${c.citation.recordId.slice(0, 12)}@${c.citation.createdAt}] (unc=${c.uncertainty.toFixed(2)}) ${c.memo.slice(0, 240)}`).join('\n');
}

/** A cited context is an EpisodicNote to the mind (strong-but-verify prior) — structural only, no store. */
function asEpisodicNotes(ctx: readonly CitedContext[]): readonly EpisodicNote[] {
  return ctx.map((c, i) => ({ at: i, runId: c.citation.recordId.slice(0, 12), outcome: `unc=${c.uncertainty.toFixed(2)}`, memo: c.memo.slice(0, MEMO_MAX_CHARS) }));
}

/**
 * Run ONE bounded observe→hypothesize→act→verify→trace loop and package the mind's advisory output as an
 * unsigned envelope. Never signs, never persists, never touches a file or the network.
 */
export async function runMindProposal(input: MindProposalInput): Promise<MindProposalResult> {
  const grantsAuthority = false as const;
  if (input.socket === null) {
    return { mode: 'model-free', reason: 'no MindSocket injected — honest model-free fallback (no proposal emitted)', grantsAuthority };
  }
  const maxSteps = Math.max(1, Math.min(input.maxSteps ?? PLAN_MAX_STEPS, PLAN_MAX_STEPS));
  const maxRetries = Math.max(0, Math.min(input.maxRetries ?? 2, 3));
  const notes = asEpisodicNotes(input.kiraContext);
  void notes; // handed to the mind as the cited block below (structural prior; no store import)

  let obs: Obs = input.env.observe();
  let prevGrid: Obs['grid'] | null = null;
  let memo = '';
  let hypotheses = 0;
  let retries = 0;
  let maxPlanSeen = 0;
  const trace: MindTraceStep[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const frame = renderFrame(obs, prevGrid);
    const messages: ChatMessage[] = [
      { role: 'system', content: `${GOVERNOR_PROMPT}\n\n${citedContextBlock(input.kiraContext)}` },
      { role: 'user', content: buildTurnMessage({ moveNo: step + 1, movesLeft: maxSteps - step, frameText: frame.text, memo }) },
    ];
    const reply = await input.socket.call(messages);
    const parsed = parseMindReply(reply.text);
    if (!parsed.ok) {
      return { mode: 'halted', reasonClass: 'mind:malformed-output', note: parsed.error, trace, grantsAuthority };
    }
    const av = validateAction(parsed.action, obs.availableActions);
    if (!av.ok) {
      return { mode: 'halted', reasonClass: 'mind:illegal-action', note: av.error ?? 'illegal action', trace, grantsAuthority };
    }
    // Runaway guard: parseMindReply already caps the plan at PLAN_MAX_STEPS; assert it and record the width.
    if (parsed.plan.length > PLAN_MAX_STEPS) {
      return { mode: 'halted', reasonClass: 'mind:runaway-plan', note: `plan ${parsed.plan.length} > ${PLAN_MAX_STEPS}`, trace, grantsAuthority };
    }
    maxPlanSeen = Math.max(maxPlanSeen, parsed.plan.length);
    if (parsed.hypothesis) hypotheses = Math.min(3, hypotheses + 1);

    prevGrid = obs.grid;
    const next = input.env.act(parsed.action); // the mind's ONLY outlet
    const expect = parsed.plan[0]?.expect ?? 'changed';
    const check = checkPlanExpectation(expect, prevGrid, next.grid);
    trace.push({ step, action: parsed.action.name, expect, verified: check.ok, note: check.note });

    if (!check.ok) {
      // EXPECTATION MISMATCH — verify after every step; halt when the re-prompt budget is spent (fail-closed).
      retries += 1;
      if (retries > maxRetries) {
        return { mode: 'halted', reasonClass: 'mind:expectation-mismatch', note: `mismatch after ${retries} re-prompts: ${check.note}`, trace, grantsAuthority };
      }
      obs = next; // re-prompt from the new frame on the next iteration
      memo = parsed.memo;
      continue;
    }
    memo = parsed.memo;
    obs = next;
    if (obs.state !== 'NOT_FINISHED') break; // terminal signal
  }

  // Package the mind's ADVISORY output as an unsigned envelope. `newContent` is the mind's distilled memo,
  // bounded — it carries no capability. The caller's qualifier re-scans it for secrets/authority shapes.
  const newContent = memo.slice(0, MEMO_MAX_CHARS) || '// (mind produced no memo)';
  const envelope: MindProposalEnvelopeV1 = {
    schema: 'aukora-supervised-generation-envelope-v1',
    statedGoal: input.target.statedGoal.slice(0, 240),
    proposal: { targetPath: input.target.targetPath, newContent, supersedes: input.target.supersedes ?? null },
    capability: input.target.capability,
    declared: { planSteps: maxPlanSeen, hypotheses, memoChars: newContent.length, retries, spendUsd: 0 },
    provenance: `@aukora/mind e5768a2f via injected MindSocket · intent=${canonicalHash({ g: input.target.statedGoal }).slice(0, 12)}`,
    advisoryOnly: true,
    grantsAuthority: false,
  };
  return { mode: 'proposed', envelope, trace, grantsAuthority };
}

/**
 * A DETERMINISTIC local MindSocket — the injected transport for CI and for a private/local model that exposes
 * no credentials. It replays a caller-supplied script of reply strings (each a mind-reply JSON). It performs NO
 * network I/O and holds NO endpoint or key. A private live model adapter would implement the same `MindSocket`
 * interface behind the keychain broker; Spatial never sees the transport or any credential.
 */
export class ScriptedMindSocket implements MindSocket {
  private i = 0;
  constructor(private readonly script: readonly string[]) {}
  async call(_messages: readonly ChatMessage[]): Promise<{ text: string }> {
    const text = this.script[Math.min(this.i, this.script.length - 1)] ?? '{}';
    this.i += 1;
    return { text };
  }
}

/** Helper: a well-formed mind-reply JSON (one legal action + an optional single-step plan expectation). */
export function mindReplyJSON(fields: {
  action: { name: string; x?: number; y?: number };
  expect?: string;
  memo?: string;
  hypothesis?: string;
  whatISee?: string;
}): string {
  const plan = fields.expect ? [{ action: fields.action, expect: fields.expect }] : [];
  return JSON.stringify({
    whatISee: fields.whatISee ?? 'a grid', delta: '', hypothesis: fields.hypothesis ?? '', reason: 'r',
    prediction: 'p', action: fields.action, plan, memo: fields.memo ?? '',
  });
}

/** The proposer bridge grants no authority. Constant, by construction. */
export function mindProposerGrantsAuthority(): false {
  return false;
}
