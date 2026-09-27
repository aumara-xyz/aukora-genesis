#!/usr/bin/env node
/**
 * platform-tools.mjs — alpha-26: ONE SEAM FOR THE TOOLS THAT ONLY SOMETIMES EXIST.
 *
 * THE FAILURE THIS REPLACES. `lsof`, `launchctl` and `footprint` are macOS instruments that are simply absent in the
 * Linux container, and about fifty files under `tests/` and `scripts/` reach for them. Each file made its own guess
 * about what to do when the tool was missing, so the same absence arrived as a crash in one place
 * (`FileNotFoundError: 'lsof'`), a silent pass in another, and a correct skip in a third — and a crash is not a
 * measurement, while a silent pass is worse than one.
 *
 * THE THREE ANSWERS, AND THERE ARE ONLY THREE:
 *
 *   AVAILABLE   the tool is there. Use it.
 *   STUBBED     an override names a stand-in (`AUKORA_LSOF_BIN`, `AUKORA_LAUNCHCTL_BIN`, `AUKORA_FOOTPRINT_BIN`).
 *               The caller gets that path and says so, so a reader can tell a fixture from a measurement.
 *   ABSENT      nothing to run. The caller gets null and a NOT RUN line NAMING the tool and the variable that would
 *               stub it, and must exit without pretending to have measured anything.
 *
 * IT NEVER THROWS AND IT NEVER SPAWNS. Discovery is a file lookup over PATH, so asking "is lsof here" cannot itself
 * fail — a helper that crashed while reporting a missing tool would be the bug it was written to remove.
 */

import { accessSync, existsSync } from 'node:fs'

/** The platform tools, why each exists, and the variable that stubs it. */
export const PLATFORM_TOOLS = Object.freeze({
  lsof: Object.freeze({
    name: 'lsof',
    env: 'AUKORA_LSOF_BIN',
    purpose: 'which process holds a TCP port, so a listener can be attributed rather than guessed',
    darwin: true,
    linux: false,
  }),
  launchctl: Object.freeze({
    name: 'launchctl',
    env: 'AUKORA_LAUNCHCTL_BIN',
    purpose: 'load and unload launchd jobs, so a desktop cutover can be started and stopped',
    darwin: true,
    linux: false,
  }),
  footprint: Object.freeze({
    name: 'footprint',
    env: 'AUKORA_FOOTPRINT_BIN',
    purpose: 'the memory footprint of a live process, so a launch can be measured instead of assumed',
    darwin: true,
    linux: false,
  }),
})

export class UnknownPlatformTool extends Error {
  constructor(name) {
    super(`${name} is not one of the platform tools this seam knows (${Object.keys(PLATFORM_TOOLS).join(', ')})`)
    this.name = 'unknown-platform-tool'
  }
}

const isExecutable = (path, { exists, access }) => {
  try {
    if (!exists(path)) return false
    access(path, 1) // X_OK
    return true
  } catch {
    return false
  }
}

/**
 * Resolve one tool. Never throws for absence, and never spawns.
 * @returns {{name: string, available: boolean, bin: string|null, source: 'override'|'path'|'absent',
 *            purpose: string, darwinOnly: boolean, env: string}}
 */
export function platformTool(name, {
  env = process.env,
  pathDirs = (env.PATH ?? '').split(':').filter((d) => d !== ''),
  exists = existsSync,
  access = accessSync,
} = {}) {
  const spec = PLATFORM_TOOLS[name]
  if (spec === undefined) throw new UnknownPlatformTool(name)
  const base = { name, purpose: spec.purpose, darwinOnly: spec.darwin === true && spec.linux !== true, env: spec.env }

  // AN OVERRIDE WINS OVER THE PLATFORM, including on macOS: that is how a court stubs a tool it does not want to
  // run for real, and it is why a stubbed answer is reported as `override` rather than as a discovery.
  const override = env[spec.env]
  if (typeof override === 'string' && override !== '') {
    if (!isExecutable(override, { exists, access })) {
      return { ...base, available: false, bin: override, source: 'absent' }
    }
    return { ...base, available: true, bin: override, source: 'override' }
  }

  for (const dir of pathDirs) {
    const candidate = `${dir}/${name}`
    if (isExecutable(candidate, { exists, access })) {
      return { ...base, available: true, bin: candidate, source: 'path' }
    }
  }
  return { ...base, available: false, bin: null, source: 'absent' }
}

/**
 * The line a caller prints when it cannot measure. It NAMES the tool and the variable that would stub it.
 *
 * IT RETURNS null WHEN THE TOOL IS THERE. MEASURED, and it was a fail-open in my own reporting: calling this for
 * `launchctl` on a Mac — where launchctl is present — produced "launchctl is not on PATH (it is a macOS instrument)",
 * a sentence that is simply false about the host it was printed on. A function whose job is to say "this host cannot
 * measure X" must not say it when the host can, or a reader learns to distrust the line that matters.
 */
export function platformToolSkip(name, { env = process.env, reason = null, purpose = null, pathDirs } = {}) {
  const tool = platformTool(name, { env, pathDirs })
  if (tool.available) return null
  const why = reason ?? `${tool.name} is not on PATH${tool.darwinOnly ? ' (it is a macOS instrument)' : ''}`
  // `purpose` overrides the sentence the table was written with, because a call site may use the same tool for
  // something else — lsof for open FILES rather than for a TCP port, for instance. The tool name and the variable
  // stay the seam's; only the sentence changes. The Python twin takes the same argument so the two cannot drift.
  return `NOT RUN: ${tool.name}-unavailable — ${why}; ${purpose ?? tool.purpose}. Set ${tool.env} to a stand-in to exercise this arm on this host.`
}

/**
 * The common shape for a caller that wants the tool and is willing to be honest when it is not there.
 * Returns the path, or prints the NOT RUN line and returns null. It does NOT exit: the caller decides whether the
 * whole court stops (exit 2 by this repository's convention) or whether only one arm is skipped.
 */
export function requirePlatformTool(name, options = {}) {
  const { env = process.env, pathDirs, quiet = false, purpose = null } = options
  const tool = platformTool(name, { env, pathDirs })
  // **THE PATH, OR null — WHAT THE DOCSTRING HAS ALWAYS PROMISED.** MEASURED (alpha-28/29, by the conductor's
  // decision): this returned the TOOL OBJECT in BOTH branches, so a caller written to the documented contract —
  // `const bin = requirePlatformTool('lsof'); if (bin === null) { … }` — NEVER took its absent branch and went on to
  // use an object as a path, which is a FAIL-OPEN inside the seam built to remove fail-opens. It cost two rounds of
  // crashes in the footprint court (spawnSync(null) → ERR_INVALID_ARG_TYPE) before the cause was read out of the
  // stack. The Python twin already returned `tool.bin`; this now matches it exactly, which is the property the two
  // files are supposed to have and did not.
  if (tool.available) return tool.bin
  const line = platformToolSkip(name, { env, pathDirs, purpose })
  if (!quiet && line !== null) process.stdout.write(`${line}\n`)
  return null
}

/** Was this resolution a stand-in rather than the platform's own tool? A reader is entitled to know. */
export const isStub = (tool) => tool !== null && tool !== undefined && tool.source === 'override'

/** Every tool's state in one object, for a document that reports what this host can measure. */
export function platformToolState({ env = process.env, pathDirs } = {}) {
  const out = {}
  for (const name of Object.keys(PLATFORM_TOOLS)) {
    const tool = platformTool(name, { env, pathDirs })
    out[name] = { available: tool.available, source: tool.source, bin: tool.bin }
  }
  return out
}
