/**
 * SCRUB THE APP'S ENVIRONMENT BEFORE SPAWNING A CHILD.
 *
 * Courts run inside the running app, whose env carries AUKORA_GATE_CONFIG, AUKORA_SIGNER_SOCKET,
 * AUKORA_EYE_URL, AUKORA_EYE_TOKEN, AUKORA_AURA_RETAINER, DSH_HOME, DSH_AGENTS_HOME and DSH_TELEMETRY_*.
 * CI has none of them. A court that spawns a child WITHOUT setting `env` hands it the app's configuration,
 * so the same court can pass in a lane and fail in a clean shell (measured: a gate-scope arm green in a lane
 * and red in CI) — and the failure looks like a defect in the thing under test.
 *
 * Use `spawnScrubbed` (or `scrubbedEnv`) for any child whose behaviour could depend on the app's
 * configuration. `AUKORA_DSH_RELEASE` is deliberately KEPT: it names the materialized release a reviewer
 * passes in, and CI sets it too.
 */
import { spawn, spawnSync } from 'node:child_process'

/** The app's variables. Anything matching these is removed from a child's environment. */
export const SCRUBBED_PREFIXES = Object.freeze(['AUKORA_', 'DSH_'])
/** Kept even though it matches a prefix: both sides of the comparison set it. */
export const KEPT_VARS = Object.freeze(['AUKORA_DSH_RELEASE'])

/** @param {Readonly<Record<string, string|undefined>>} [extra] @returns {Record<string, string>} */
export function scrubbedEnv(extra = {}) {
  const kept = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (KEPT_VARS.includes(name)) { kept[name] = value; continue }
    if (SCRUBBED_PREFIXES.some((prefix) => name.startsWith(prefix))) continue
    kept[name] = value
  }
  return { ...kept, ...extra }
}

/**
 * `childEnv` IS THE SAME FUNCTION AS `scrubbedEnv`, AND THE ALIAS IS DELIBERATE. A lane imported the name
 * `childEnv` before this helper exported it, so every court that did died with
 * `SyntaxError: The requested module './helpers/child-env.mjs' does not provide an export named 'childEnv'`
 * — a crash at import time, in that lane's file, caused by this one. Two names for one behaviour is a
 * smaller cost than a helper that breaks its callers on the day it is adopted.
 */
export const childEnv = scrubbedEnv

/** @param {string} command @param {ReadonlyArray<string>} args @param {Record<string, unknown>} [options] */
export const spawnScrubbed = (command, args, options = {}) => spawn(command, args, { ...options, env: scrubbedEnv(options.env) })

/** @param {string} command @param {ReadonlyArray<string>} args @param {Record<string, unknown>} [options] */
export const spawnSyncScrubbed = (command, args, options = {}) => spawnSync(command, args, { ...options, env: scrubbedEnv(options.env) })
