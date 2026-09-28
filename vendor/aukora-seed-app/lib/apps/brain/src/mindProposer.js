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
import { renderFrame, buildTurnMessage, GOVERNOR_PROMPT, parseMindReply, validateAction, checkPlanExpectation, PLAN_MAX_STEPS, MEMO_MAX_CHARS, } from '../../../packages/mind/index.js';
import { canonicalHash } from '../../../../../authority/lib/canonical.js';
/** Render the cited KIRA context as an advisory block — citations + uncertainty are SHOWN, never hidden. */
function citedContextBlock(ctx) {
    if (ctx.length === 0)
        return 'KIRA context: (none recalled).';
    return 'KIRA context (advisory, cited, uncertainty shown — never authority):\n' +
        ctx.map((c) => `- [${c.citation.recordId.slice(0, 12)}@${c.citation.createdAt}] (unc=${c.uncertainty.toFixed(2)}) ${c.memo.slice(0, 240)}`).join('\n');
}
/** A cited context is an EpisodicNote to the mind (strong-but-verify prior) — structural only, no store. */
function asEpisodicNotes(ctx) {
    return ctx.map((c, i) => ({ at: i, runId: c.citation.recordId.slice(0, 12), outcome: `unc=${c.uncertainty.toFixed(2)}`, memo: c.memo.slice(0, MEMO_MAX_CHARS) }));
}
/**
 * Run ONE bounded observe→hypothesize→act→verify→trace loop and package the mind's advisory output as an
 * unsigned envelope. Never signs, never persists, never touches a file or the network.
 */
export async function runMindProposal(input) {
    const grantsAuthority = false;
    if (input.socket === null) {
        return { mode: 'model-free', reason: 'no MindSocket injected — honest model-free fallback (no proposal emitted)', grantsAuthority };
    }
    const maxSteps = Math.max(1, Math.min(input.maxSteps ?? PLAN_MAX_STEPS, PLAN_MAX_STEPS));
    const maxRetries = Math.max(0, Math.min(input.maxRetries ?? 2, 3));
    const notes = asEpisodicNotes(input.kiraContext);
    void notes; // handed to the mind as the cited block below (structural prior; no store import)
    let obs = input.env.observe();
    let prevGrid = null;
    let memo = '';
    let hypotheses = 0;
    let retries = 0;
    let maxPlanSeen = 0;
    const trace = [];
    for (let step = 0; step < maxSteps; step++) {
        const frame = renderFrame(obs, prevGrid);
        const messages = [
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
        if (parsed.hypothesis)
            hypotheses = Math.min(3, hypotheses + 1);
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
        if (obs.state !== 'NOT_FINISHED')
            break; // terminal signal
    }
    // Package the mind's ADVISORY output as an unsigned envelope. `newContent` is the mind's distilled memo,
    // bounded — it carries no capability. The caller's qualifier re-scans it for secrets/authority shapes.
    const newContent = memo.slice(0, MEMO_MAX_CHARS) || '// (mind produced no memo)';
    const envelope = {
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
export class ScriptedMindSocket {
    script;
    i = 0;
    constructor(script) {
        this.script = script;
    }
    async call(_messages) {
        const text = this.script[Math.min(this.i, this.script.length - 1)] ?? '{}';
        this.i += 1;
        return { text };
    }
}
/** Helper: a well-formed mind-reply JSON (one legal action + an optional single-step plan expectation). */
export function mindReplyJSON(fields) {
    const plan = fields.expect ? [{ action: fields.action, expect: fields.expect }] : [];
    return JSON.stringify({
        whatISee: fields.whatISee ?? 'a grid', delta: '', hypothesis: fields.hypothesis ?? '', reason: 'r',
        prediction: 'p', action: fields.action, plan, memo: fields.memo ?? '',
    });
}
/** The proposer bridge grants no authority. Constant, by construction. */
export function mindProposerGrantsAuthority() {
    return false;
}
