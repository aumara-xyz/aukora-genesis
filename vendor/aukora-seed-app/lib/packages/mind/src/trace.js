/** House invariant pin: the mind can never grant authority. */
export function mindGrantsAuthority() {
    return false;
}
const CONTAINMENT = { advisoryOnly: true, grantsAuthority: false };
export function buildStartTrace(input) {
    return { kind: 'start', ...input, ...CONTAINMENT };
}
export function buildMoveTrace(input) {
    return { kind: 'move', ...input, ...CONTAINMENT };
}
export function buildPlanMoveTrace(input) {
    return { kind: 'plan_move', ...input, ...CONTAINMENT };
}
export function buildCouncilTrace(input) {
    return { kind: 'council', ...input, ...CONTAINMENT };
}
/** Every rejected ghost future is recorded — lookahead refusals are evidence too. */
export function buildRolloutRejectTrace(input) {
    return { kind: 'rollout_reject', ...input, ...CONTAINMENT };
}
export function buildSummaryTrace(input) {
    return { kind: 'summary', ...input, ...CONTAINMENT };
}
