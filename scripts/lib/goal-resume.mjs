// goal-resume.mjs — a RE-EXPORT, because THE LOGIC MUST SHIP WHERE THE PLUGIN LIVES.
//
// MEASURED (2026-09-27): `scripts/lib/` is NOT part of a materialized release — a release's `scripts/lib/` is empty
// — while `plugins/<organ>/lib/` is where a mounted plugin's code actually lives. A plugin importing this path
// would therefore fail at mount IN A RELEASE while passing every court in the repository, which is the worst
// possible split. So the logic moved to `plugins/aukora-goal-resume/lib/resume.mjs` and this file re-exports it, so
// that the court (and anything else in the repository) keeps one import path and one source of truth.
export * from '../../plugins/aukora-goal-resume/lib/resume.mjs';
