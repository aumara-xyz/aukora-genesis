// goal-resume.mjs — THE SMALLEST SAFE RE-ARM AFTER A BACKEND RESTART, as a pure decision.
//
// MEASURED THIS MORNING: after a backend restart, lanes sat idle for SEVEN HOURS, because a goal that was active at
// shutdown is not re-armed when the process comes back. The goal engine itself is upstream's (`dsh-goal`,
// `dsh-goal-round-driver`, installed under the profile), so the decision belongs here, AUKORA-side, where it can be
// measured without a backend: this module DECIDES, and the caller (a boot-time component) applies the decision.
//
// WHY IT IS A PURE FUNCTION: every rule below is a way to RESURRECT WORK NOBODY WANTS, so each one has to be
// measurable on its own. The risk, named: re-arming on every start can (a) restart work a human deliberately
// stopped, (b) multiply rounds past a goal's own budget, (c) fight a concurrently armed goal, or (d) wake a goal
// whose session has moved on. So it re-arms ONLY goals that were ACTIVE at an UNCLEAN shutdown and whose
// activation is still `armed`, most-recent first, and never more than `cap` of them.
//
// `shutdownClean` is the load-bearing input: on a clean shutdown nobody was interrupted, so the safe answer is to
// re-arm NOTHING and let the human resume. That is the conservative direction — the failure it prevents (silently
// resuming work after an orderly stop) is worse than the failure it accepts (a lane waiting for a human).

/** Phases a goal can be in that must NEVER be re-armed: they are terminal or a human's decision. */
const NEVER = new Set(['complete', 'blocked', 'paused']);

/**
 * Decide which goals to re-arm after a restart.
 *
 * @param {object} input
 * @param {Array<{id: string, phase: string, activation?: string, lastActiveAt?: number, alreadyArmed?: boolean}>} input.goals
 *        one entry per goal as it stood at shutdown.
 * @param {boolean} input.shutdownClean  true when the previous process exited on purpose.
 * @param {number} [input.cap]           the most goals that may be re-armed at once (default 3).
 * @returns {{rearm: string[], skipped: Array<{id: string, reason: string}>}}
 */
export function resumableGoals({ goals, shutdownClean, cap = 3 } = {}) {
  const rearm = [];
  const skipped = [];
  if (!Array.isArray(goals)) return { rearm, skipped: [{ id: '(none)', reason: 'no-goals-supplied' }] };
  if (shutdownClean === true) {
    return { rearm, skipped: goals.map((goal) => ({ id: goal.id, reason: 'clean-shutdown' })) };
  }
  const ordered = [...goals].sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0));
  for (const goal of ordered) {
    if (NEVER.has(goal.phase)) { skipped.push({ id: goal.id, reason: `phase-${goal.phase}` }); continue; }
    if (goal.activation === 'disarmed') { skipped.push({ id: goal.id, reason: 'disarmed-by-human' }); continue; }
    if (goal.alreadyArmed === true) { skipped.push({ id: goal.id, reason: 'already-armed' }); continue; }
    if (rearm.length >= cap) { skipped.push({ id: goal.id, reason: 'cap-reached' }); continue; }
    rearm.push(goal.id);
  }
  return { rearm, skipped };
}

/**
 * APPLY the decision, with the re-arm INJECTED, so the caller's side is measurable without a backend.
 *
 * The live seam, read from the running Host's own Service contract (Inspect, 2026-09-27): the `goals` service
 * ("Goal service (`ctx.goals`) backed exclusively by the owning session log") exposes
 * `get(agent): GoalView | undefined` and `resume(agent, ref): GoalView` — so "re-arm" is `ctx.goals.resume`, and
 * the state to decide on comes from the session log, which is why no goal file exists under the state root.
 *
 * ONE FAILURE MUST NOT STOP THE OTHERS: a re-arm that throws is recorded with its reason and the remaining goals
 * are still attempted, because the cost of a partial resume is a lane that waits, while the cost of an aborted
 * loop is every lane waiting.
 *
 * @param {object} input
 * @param {Array} input.goals            as `resumableGoals` takes them.
 * @param {boolean} input.shutdownClean  ditto.
 * @param {number} [input.cap]
 * @param {(id: string) => Promise<unknown>} input.resume  the caller's `ctx.goals.resume`.
 * @param {(line: string) => void} [input.log]
 * @returns {Promise<{resumed: string[], failed: Array<{id: string, reason: string}>, skipped: Array<{id: string, reason: string}>}>}
 */
export async function applyGoalResume({ goals, shutdownClean, cap = 3, resume, log = () => {} } = {}) {
  const decision = resumableGoals({ goals, shutdownClean, cap });
  const resumed = [];
  const failed = [];
  if (typeof resume !== 'function') return { resumed, failed: [{ id: '(none)', reason: 'no-resume-supplied' }], skipped: decision.skipped };
  for (const id of decision.rearm) {
    try {
      await resume(id);
      resumed.push(id);
      log(`goal-resume: re-armed ${id} after an unclean restart`);
    } catch (error) {
      const reason = String((error && error.message) || error);
      failed.push({ id, reason });
      log(`goal-resume: could NOT re-arm ${id}: ${reason}`);
    }
  }
  return { resumed, failed, skipped: decision.skipped };
}

/**
 * THE BOOT CALLER — the smallest safe way for a starting backend to know whether the LAST stop was clean.
 *
 * WHY A MARKER: `applyGoalResume` refuses to re-arm anything after a "clean shutdown", and the whole safety of this
 * feature rests on that input being TRUE rather than assumed. A marker file written when the process stops ON
 * PURPOSE and CONSUMED at the next start is the smallest mechanism that distinguishes the two cases without
 * inventing a second source of truth. The order matters: the marker is written AFTER a successful boot, so a crash
 * DURING boot still leaves the next start looking unclean and a crash while idle leaves it looking clean — which is
 * exactly right, because a crash while idle interrupted nothing.
 *
 * EVERY EFFECT IS INJECTED (`exists`, `remove`, `write`, `goalFor`, `resume`), so this function has no opinion about
 * filesystems, sessions or the goals service, and the entire boot path is measurable with fakes.
 *
 * @param {object} input
 * @param {string} input.markerPath   where the clean-shutdown marker lives.
 * @param {() => boolean} input.exists
 * @param {() => void} input.remove
 * @param {() => void} input.write
 * @param {Array<{id: string}>} input.sessions  the sessions to consider.
 * @param {(sessionId: string) => object|null} input.goalFor  the session log's last goal view, or null.
 * @param {(sessionId: string, goalId: string) => Promise<unknown>} input.resume
 * @param {number} [input.cap]
 * @param {(line: string) => void} [input.log]
 */
export async function bootGoalResume({ markerPath, exists, remove, write, sessions, goalFor, resume, cap = 3, log = () => {} } = {}) {
  if (typeof exists !== 'function' || typeof remove !== 'function' || typeof write !== 'function') {
    return { clean: null, resumed: [], failed: [{ id: '(none)', reason: 'no-marker-seam-supplied' }], skipped: [] };
  }
  // COLLECT FIRST, SO EVERY GOAL GETS A LINE WHETHER IT IS RESUMED OR SKIPPED. PETER ASKED FOR THIS (2026-09-27):
  // "one line to the server log for every goal resumed or skipped, with its reason, so I can verify after the
  // cutover." A summary line cannot answer "what happened to goal X", which is exactly the question asked of a
  // resume that ran unattended at 3am.
  const goals = [];
  for (const session of sessions ?? []) {
    const view = goalFor(session.id);
    if (view === null || view === undefined) continue;
    goals.push({ ...view, id: view.id ?? session.id, sessionId: session.id });
  }
  const say = (verb, id, reason) => log(`goal-resume: ${verb} ${id} (${reason})`);

  if (exists()) {
    remove();
    for (const goal of goals) say('SKIPPED', goal.id, 'clean-shutdown');
    log('goal-resume: the previous stop was CLEAN, so nothing is re-armed (the marker is consumed)');
    return { clean: true, resumed: [], failed: [], skipped: goals.map((goal) => ({ id: goal.id, reason: 'clean-shutdown' })) };
  }
  const applied = await applyGoalResume({
    goals, shutdownClean: false, cap, log,
    resume: (goalId) => {
      const found = goals.find((goal) => goal.id === goalId);
      return (resume ?? (() => Promise.reject(new Error('no-resume-supplied'))))(found.sessionId, goalId);
    },
  });
  // ONE LINE PER GOAL, AND THE ORDER IS THE OUTCOME: resumed, then failed with its failure, then every skip with the
  // rule that declined it (phase-complete, disarmed-by-human, already-armed, cap-reached).
  for (const id of applied.resumed) say('RESUMED', id, 'active-at-unclean-stop');
  for (const failure of applied.failed) say('FAILED', failure.id, failure.reason);
  for (const skip of applied.skipped) say('SKIPPED', skip.id, skip.reason);
  write();
  log(`goal-resume: unclean start — re-armed ${String(applied.resumed.length)} goal(s), declined ${String(applied.skipped.length)}, failed ${String(applied.failed.length)}`);
  return { clean: false, ...applied };
}
