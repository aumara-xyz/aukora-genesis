/**
 * Replay history then play the plan in a ghost world. The simulator must be
 * FRESH (or at least re-settable): the first thing this does is reset it.
 * Returns the outcome without touching any real session.
 */
export function rolloutPlan(simulator, history, plan) {
    let obs = simulator.reset();
    for (const step of history) {
        obs = step.name === 'RESET' ? simulator.reset() : simulator.act(step);
    }
    const before = obs;
    if (before.state !== 'NOT_FINISHED') {
        return { valid: false, reason: `history already terminal (${before.state})` };
    }
    let executed = 0;
    let died = false;
    let won = false;
    for (const step of plan) {
        obs = simulator.act(step.action);
        executed++;
        if (obs.state === 'GAME_OVER') {
            died = true;
            break;
        }
        if (obs.state === 'WIN') {
            won = true;
            break;
        }
    }
    return {
        valid: true,
        survived: !died,
        won,
        executed,
        levelsGained: obs.levelsCompleted - before.levelsCompleted,
        diedAtStep: died ? executed : null,
    };
}
/**
 * Compare several candidate plans; returns them scored and sorted best-first.
 * Each candidate gets its own FRESH ghost from `makeSimulator`. Scoring is
 * honest and simple (the donor law, kept exactly): wins beat level gains beat
 * survival beat nothing; ties broken by fewer steps (the efficiency axis):
 *   (won ? 1000 : 0) + levelsGained * 100 + 1 - executed / 100, or -1 if invalid/dead.
 */
export function rolloutBest(makeSimulator, history, plans) {
    const scored = plans.map((plan, index) => {
        const outcome = rolloutPlan(makeSimulator(), history, plan);
        const score = !outcome.valid || !outcome.survived
            ? -1
            : (outcome.won ? 1000 : 0) + outcome.levelsGained * 100 + 1 - outcome.executed / 100;
        return { index, plan, outcome, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored;
}
