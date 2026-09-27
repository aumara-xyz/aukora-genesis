// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Rollout — deterministic lookahead ("ghost futures") over an INJECTED simulator.
 *
 * Where the world replays perfectly from (seed, action-sequence), a candidate
 * plan can be played out INVISIBLY before a single real move is committed:
 * the caller supplies a fresh Simulator port (this module imports no engine),
 * the plan runs in the ghost, the outcome is read, the ghost is thrown away.
 * Explore many futures, collapse to one — exact rather than probabilistic
 * because the world is deterministic in the action sequence.
 *
 * HONESTY: this works ONLY where the caller can construct a replayable
 * simulator. Non-replayable environments cannot be rolled out; drivers must
 * only offer lookahead where a Simulator genuinely exists, and record every
 * rejected future (see trace.ts).
 *
 * Re-authored from the ARC-AGI-3 reasoning engine, aukora-symbiote branch
 * fable/arc3-reasoning-engine-20260710 @ e5768a2f.
 */
import type { ReplayStep, Simulator } from './ports.js';
import type { PlanStep } from './plan.js';

export type RolloutOutcome =
  | { readonly valid: false; readonly reason: string }
  | {
      readonly valid: true;
      readonly survived: boolean;
      readonly won: boolean;
      readonly executed: number;
      readonly levelsGained: number;
      readonly diedAtStep: number | null;
    };

/**
 * Replay history then play the plan in a ghost world. The simulator must be
 * FRESH (or at least re-settable): the first thing this does is reset it.
 * Returns the outcome without touching any real session.
 */
export function rolloutPlan(simulator: Simulator, history: readonly ReplayStep[], plan: readonly PlanStep[]): RolloutOutcome {
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
    if (obs.state === 'GAME_OVER') { died = true; break; }
    if (obs.state === 'WIN') { won = true; break; }
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

export interface ScoredRollout {
  readonly index: number;
  readonly plan: readonly PlanStep[];
  readonly outcome: RolloutOutcome;
  readonly score: number;
}

/**
 * Compare several candidate plans; returns them scored and sorted best-first.
 * Each candidate gets its own FRESH ghost from `makeSimulator`. Scoring is
 * honest and simple (the donor law, kept exactly): wins beat level gains beat
 * survival beat nothing; ties broken by fewer steps (the efficiency axis):
 *   (won ? 1000 : 0) + levelsGained * 100 + 1 - executed / 100, or -1 if invalid/dead.
 */
export function rolloutBest(
  makeSimulator: () => Simulator,
  history: readonly ReplayStep[],
  plans: ReadonlyArray<readonly PlanStep[]>,
): ScoredRollout[] {
  const scored: ScoredRollout[] = plans.map((plan, index) => {
    const outcome = rolloutPlan(makeSimulator(), history, plan);
    const score = !outcome.valid || !outcome.survived
      ? -1
      : (outcome.won ? 1000 : 0) + outcome.levelsGained * 100 + 1 - outcome.executed / 100;
    return { index, plan, outcome, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored;
}
