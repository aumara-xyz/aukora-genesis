// index.mjs — the Host plugin that re-arms goals after a backend restart (Fable, 2026-09-27).
//
// WHAT IT FIXES, MEASURED: after a backend restart, lanes sat idle for SEVEN HOURS because a goal that was active
// at shutdown is not re-armed. This plugin runs ONCE per process start and applies the decision in `./resume.mjs`.
//
// IT DOES NOTHING WITHOUT `goals` AND `agents` (declared in `inject`, so Cordis holds the plugin until both exist
// rather than letting it run against a half-mounted deployment), and every failed re-arm is contained and logged.
//
// THE MARKER is the plugin's own file under the goals state directory: written after a successful boot, consumed at
// the next start. That ordering is the safety argument — a crash during boot leaves the next start UNCLEAN (that
// boot may not have re-armed), while a crash while idle leaves it CLEAN (nothing was interrupted). A missing marker
// on a FIRST run is read as unclean, which is the conservative direction for work, and the cap plus the
// never-terminal/never-disarmed rules bound it.
import { existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { bootGoalResume } from './resume.mjs';

export const name = 'aukora-goal-resume';
export const inject = ['goals', 'agents'];

/** The marker path, derived from the goals state directory so no new configuration is invented. */
export const markerFor = (stateDir) => join(stateDir, 'goal-resume.clean');

/**
 * THE STATE DIRECTORY COMES FROM THIS PLUGIN'S OWN `config`, WHICH IS HOW EVERY OTHER HOST PLUGIN IN THIS TREE GETS
 * IT: `aukora-eye/lib/index.js:38` does `const stateDir = config.stateDir` and THROWS when it is missing, and
 * `aukora-board/lib/index.js:135` does the same. Both use `apply(ctx, config)`.
 *
 * **MEASURED (Fable's row 9): this read `ctx.goalsStateDir ?? ctx.stateDir`. NEITHER IS A REAL CORDIS SERVICE.** Both
 * were `undefined`, so `apply` returned on the next line and the plugin mounted and DID NOTHING — goal-resume was
 * absent on real Cordis while looking present in the composition, and the silent `return` is what made it invisible.
 */
export function resolveStateDir(config, { throwIfMissing = true } = {}) {
  const stateDir = config?.stateDir;
  if (typeof stateDir === 'string' && stateDir !== '') return stateDir;
  if (throwIfMissing === false) return null;
  throw new Error('aukora-goal-resume: config.stateDir is required — without it the clean/unclean marker has no home '
    + 'and the plugin would mount and do nothing (the failure this refusal exists to prevent)');
}

export function apply(ctx, config = {}) {
  const stateDir = resolveStateDir(config, { throwIfMissing: false });
  if (stateDir === null) {
    // NOT A SILENT RETURN: a mounted-but-inert goal-resume is exactly what went unnoticed, so it says so.
    ctx.logger?.warn?.('aukora-goal-resume: NO config.stateDir — mounted but INERT; goals will not re-arm after a '
      + 'restart. Set config.stateDir on this row.');
    return;
  }
  const marker = markerFor(stateDir);
  ctx.effect(() => {
    // ONE ATTEMPT, AT MOUNT. `void` because the result is reported through the log, and a rejection here would be
    // an unhandled one — `bootGoalResume` already contains every per-goal failure.
    void bootGoalResume({
      markerPath: marker,
      exists: () => existsSync(marker),
      remove: () => rmSync(marker, { force: true }),
      // **THE MARKER IS NOT WRITTEN AT BOOT, AND THAT WAS THE ALTERNATION (Fable's row 9).** It is
      // written ONLY where the process stops on purpose — see the disposer below. Writing after a
      // re-arm (the unclean path) means the NEXT start always reads CLEAN, removes the marker and
      // writes nothing, so the following start is UNCLEAN again: clean and unclean alternate forever.
      write: () => { /* deliberately empty: a boot must not claim the stop that follows it was clean */ },
      sessions: ctx.agents.roots().map((agent) => ({ id: agent.sessionId ?? agent.id, agent })),
      goalFor: (sessionId) => {
        const agent = ctx.agents.get(sessionId);
        const view = agent === undefined ? undefined : ctx.goals.get(agent);
        return view === undefined ? null : view;
      },
      resume: (sessionId, goalId) => {
        const agent = ctx.agents.get(sessionId);
        const view = agent === undefined ? undefined : ctx.goals.get(agent);
        return ctx.goals.resume(agent, { id: goalId, revision: view?.revision });
      },
      log: ctx.log?.info?.bind(ctx.log) ?? (() => {}),
    });
    return () => {
      // A CLEAN DISPOSE IS THE ONLY HONEST PLACE FOR THIS MARKER: it is the statement "this process
      // stopped on purpose", which is exactly what the next boot reads to decide whether anyone was
      // interrupted. Written whether or not this boot re-armed anything.
      try { mkdirSync(dirname(marker), { recursive: true }); writeFileSync(marker, `${new Date().toISOString()}\n`); } catch { /* best-effort */ }
    };
  }, 'aukora-goal-resume: one re-arm at process start');
}
