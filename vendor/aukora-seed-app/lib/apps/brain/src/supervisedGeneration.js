/** Wrap any BrainProvider as a zero-usage generator (offline/deterministic path). */
export function offlineGenerator(provider) {
    return async (prompt) => ({ text: await provider.complete(prompt), outputTokens: 0, costMicroUsd: 0 });
}
const EMPTY_SANDBOX = new Map();
const byteLen = (s) => new TextEncoder().encode(s).length;
function refuse(reason, usage) {
    return { ok: false, advisory: null, candidate: null, sandbox: EMPTY_SANDBOX, usage: usage ?? { outputTokens: 0, costMicroUsd: 0, wallClockMs: 0 }, refusals: [reason], grantsAuthority: false };
}
export class SupervisedGenerationEnvelope {
    generate;
    limits;
    generations = 0;
    constructor(generate, limits) {
        this.generate = generate;
        this.limits = limits;
    }
    generationsUsed() {
        return this.generations;
    }
    async run(request) {
        if (this.generations >= this.limits.maxGenerations)
            return refuse('refused: generation ceiling reached');
        if (request.proposedPatch && byteLen(request.proposedPatch.diff) > this.limits.maxPatchBytes)
            return refuse('refused: patch exceeds byte ceiling');
        this.generations += 1;
        const started = Date.now();
        const g = await this.generate(request.prompt);
        const wallClockMs = Date.now() - started;
        const usage = { outputTokens: g.outputTokens, costMicroUsd: g.costMicroUsd, wallClockMs };
        if (g.outputTokens > this.limits.maxOutputTokens)
            return refuse('refused: output token ceiling exceeded', usage);
        if (g.costMicroUsd > this.limits.maxCostMicroUsd)
            return refuse('refused: cost ceiling exceeded', usage);
        if (wallClockMs > this.limits.maxWallClockMs)
            return refuse('refused: wall-clock ceiling exceeded', usage);
        // Advisory output. Sandbox-only effect + PR-candidate-only egress for any proposed change.
        const sandbox = new Map();
        let candidate = null;
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
export function supervisedGenerationGrantsAuthority() {
    return false;
}
