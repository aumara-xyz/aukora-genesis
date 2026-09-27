// φ — THE SOVEREIGN HAND. The owner's own GPU, under the same law as every other hand.
//
// ══ WHY THIS FILE IS NINETY LINES AND NOT NINE HUNDRED ══
//
// A vLLM endpoint is a completion API. It reads no files, writes no files, and runs no tool loop — so
// the obvious way to make one a `ForgeEngine` is to write an agent: a loop that parses tool calls,
// executes them, feeds results back. That is a large, subtle, and entirely redundant thing to build,
// because `crush` is already exactly that agent, it already speaks the OpenAI tool protocol, and
// `crushEngine` is already wired into every accounting path in this repository.
//
// So this engine is `crushEngine` with the model pinned. The judo is in the CONFIG, not the code: a
// `nebius` provider in crush's own config points at `http://localhost:8000/v1`, and `-m nebius/coder`
// sends a full agentic round — file reads, edits, the lot — to the owner's own hardware. Nothing about
// the round changes: the arming switch, the pre-run snapshot, the protected-path law check after the
// engine exits, the review gate, the receipt, the undo. All of it is engine-agnostic and already tested.
//
// ══ THE TWO FLAGS THAT DECIDE WHETHER THIS WORKS AT ALL ══
//
// MEASURED, on the first attempt, and it is the whole reason this engine has a readiness check that
// asks a real question. A vLLM server started without them answers crush with:
//
//     Agent processing failed: failed to start agent processing stream: bad request:
//     "auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set.
//
// The server was up. `GET /v1/models` answered. A plain completion returned "PONG" in 161ms. And it
// could not run a single round, because serving a model and serving an AGENT are different claims.
// `scripts/serve-coder.sh` on the box carries both flags (`--tool-call-parser qwen3_coder`, the parser
// matching this exact model family) and the readiness check below asks the endpoint whether it has
// them rather than trusting that someone remembered.
//
// ══ WHAT SOVEREIGNTY ACTUALLY MEANS HERE, STATED HONESTLY ══
//
// The weights are the owner's, the GPU is rented in his name, and no vendor sees the prompt or the
// repository. That is real and it is the point. What it is NOT: safer. A hand is a hand — this one is
// governed by exactly the same PreToolUse guard and the same post-round protected-path sweep as crush,
// claude and grok, because the law does not care whose silicon typed. `ak3`'s deployment packet says
// the reciprocal thing from the other side, and says it better: a remote proposer's evidence saturates
// at `quarantined`; acceptance requires local reproduction. Nebius proposes. The owner disposes.
//
// ══ THE TUNNEL IS PART OF THE SECURITY ARGUMENT, NOT AN INCONVENIENCE ══
//
// vLLM has no authentication of any kind. Bound to the box's public interface it is an open GPU for
// anyone who portscans it. So the endpoint is reached over an SSH tunnel — `localhost` here means "a
// port that only exists because a key-authenticated tunnel is up", and a dead tunnel is an honest
// `not-ready` below rather than a round that fails halfway through.

import { crushEngine, type ForgeEngine } from './crush';

/**
 * Where the tunnel lands. `AUKORA_NEBIUS_URL` overrides for a differently-forwarded port.
 *
 * NOT the box's public address, and never defaulted to one — see the header. If this ever needs to be
 * a remote host, the missing piece is authentication in front of vLLM, not a change to this constant.
 */
export const NEBIUS_URL = process.env.AUKORA_NEBIUS_URL ?? 'http://localhost:8000/v1';

/** The `provider/model` pair crush resolves. The provider half is config; the model half is vLLM's `--served-model-name`. */
export const NEBIUS_MODEL = process.env.AUKORA_NEBIUS_MODEL ?? 'nebius/coder';

/** A health probe must not sit in front of a page load. Short on purpose: this is a loopback port. */
export const NEBIUS_PROBE_TIMEOUT_MS = 4_000;

export interface NebiusHealth {
  /** `false` only on an AUTHORITATIVE negative — a reachable endpoint that said no. */
  ok: boolean;
  /** `true` when nothing was learned (timeout, connection refused mid-flight). Never a negative. */
  inconclusive?: boolean;
  detail: string;
  /** The `id`s the endpoint reports serving, when it answered. */
  models?: string[];
}

/**
 * Is the sovereign endpoint actually there, and is it serving what we are about to ask for?
 *
 * THREE OUTCOMES, NOT TWO, and the third is the one this repository keeps having to re-learn: a
 * connection that could not be made teaches NOTHING about the endpoint. `ECONNREFUSED` on a loopback
 * port is a dead tunnel, which is a real and actionable negative. A timeout is not — the box may be
 * mid-load with eight GPUs reading 57GiB of weights, which takes minutes and is not a fault.
 *
 * `AGENTS.md` states the rule this implements: "A name is not a resolution. Validate, don't assume…
 * let only an authoritative negative disqualify it. Inconclusive is not negative."
 */
export async function nebiusHealth(
  url: string = NEBIUS_URL,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = NEBIUS_PROBE_TIMEOUT_MS,
): Promise<NebiusHealth> {
  let res: Response;
  try {
    res = await fetchImpl(`${url.replace(/\/+$/, '')}/models`, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    // A refused connection on a loopback port IS authoritative: nothing is listening there. A timeout
    // or an aborted request is not — it is the absence of an answer, which is a different thing from
    // an answer of "no".
    const refused = /ECONNREFUSED|connection refused|Unable to connect/i.test(msg);
    return refused
      ? { ok: false, detail: `nothing is listening on ${url} — the SSH tunnel is down. Reopen it: ssh -N -L 8000:localhost:8000 -i ~/.ssh/aukora-nebius-lab aukora@<box-ip>` }
      : { ok: false, inconclusive: true, detail: `${url} did not answer within ${timeoutMs}ms — the box may still be loading weights across its GPUs, which takes minutes. Nothing was learned.` };
  }

  if (!res.ok) {
    return { ok: false, detail: `${url}/models answered HTTP ${res.status} — something is listening there, but it is not a healthy vLLM` };
  }

  let models: string[] = [];
  try {
    const body = await res.json() as { data?: { id?: unknown }[] };
    models = (body.data ?? []).map((m) => String(m?.id ?? '')).filter(Boolean);
  } catch {
    return { ok: false, detail: `${url}/models answered, but not with JSON this understands` };
  }

  // The model half of `provider/model`. crush resolves the provider from its own config; the endpoint
  // only ever knows the served name.
  const want = NEBIUS_MODEL.split('/').pop() ?? 'coder';
  if (!models.includes(want)) {
    return {
      ok: false, models,
      detail: `the endpoint is healthy but serves ${models.length ? models.join(', ') : 'nothing'} — not "${want}". `
        + 'Check --served-model-name on the box.',
    };
  }
  return { ok: true, models, detail: `serving ${models.join(', ')} on the owner's own GPU` };
}

/**
 * Nebius, driven by crush.
 *
 * The model is pinned rather than taken from `ctx.model`: `ctx.model` is the caller's idea of which
 * model to use, and on this lane the answer is not negotiable — the whole point of the engine is WHICH
 * endpoint it reaches. A caller wanting a different model on this hardware changes
 * `AUKORA_NEBIUS_MODEL`, which is a decision about the deployment rather than about one round.
 */
export const nebiusEngine: ForgeEngine = async (task, ctx) => crushEngine(task, { ...ctx, model: NEBIUS_MODEL });
