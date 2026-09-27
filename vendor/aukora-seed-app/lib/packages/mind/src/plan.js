/** Hard cap on plan length: the mind may pre-commit at most 8 further steps. */
export const PLAN_MAX_STEPS = 8;
/** Hard cap on one expectation string. */
export const EXPECT_MAX_CHARS = 40;
/** Expectation used when a step names none: the step must not be a pure no-op. */
export const DEFAULT_EXPECTATION = 'changed';
/**
 * Parse a raw `plan` value from a mind reply: cap at PLAN_MAX_STEPS, drop
 * malformed steps, default the expectation to 'changed', bound it to
 * EXPECT_MAX_CHARS. Never throws; a non-array yields an empty plan.
 */
export function parsePlanSteps(raw, normalizeStepAction) {
    const plan = [];
    if (!Array.isArray(raw))
        return plan;
    for (const step of raw) {
        if (plan.length >= PLAN_MAX_STEPS)
            break;
        const record = step !== null && typeof step === 'object' ? step : null;
        const action = normalizeStepAction(record ? record['action'] ?? step : step, step);
        if (!action)
            continue;
        const expectRaw = record ? record['expect'] : undefined;
        const expect = typeof expectRaw === 'string' ? expectRaw.slice(0, EXPECT_MAX_CHARS) : DEFAULT_EXPECTATION;
        plan.push({ action, expect });
    }
    return plan;
}
