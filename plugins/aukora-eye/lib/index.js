/**
 * `@aukora/dsh-plugin-eye` — the model's own eyes on the running app.
 *
 * It registers ONE tool, `aukora_see`, which asks the desktop shell for a photograph of the window
 * it is already showing and returns that picture to the model, with a pixel diff against the
 * previous capture in the same session. The bytes live in an attachment and in this plugin's state
 * directory; the session log keeps only the reference.
 *
 * WHY A PLAIN MODULE. Like `@aukora/dsh-plugin-kira`, this package imports nothing from the harness:
 * the tool is a plain DSH `ToolDefinition` object, and the two services it needs (`tools`,
 * `attachments`) arrive through Cordis injection. That keeps it mountable from any DSH release
 * without a build step, and keeps a tool that photographs the screen free of a dependency graph.
 *
 * @module @aukora/dsh-plugin-eye
 */

import { createCaptureStore, DEFAULT_KEEP } from './store.mjs'
import { createSeeTool, SEE_TOOL_NAME } from './tools.mjs'

/** Cordis plugin name. */
export const name = 'aukora-eye'

/** Services this plugin consumes; the attachment gate is declared at registration. */
export const inject = ['tools']

/** The tool this plugin publishes, re-exported so a composition can name it without guessing. */
export { SEE_TOOL_NAME }

/**
 * Validate the composition's configuration.
 *
 * `stateDir` has no default on purpose: the captures of a screen are not written to a location
 * nobody chose, and a deployment that forgets it is told rather than silently given a temp folder.
 * @param config - the row's config.
 * @returns the resolved `{ stateDir, keep, note }`.
 */
export function resolveConfig(config = {}) {
  const stateDir = config.stateDir
  if (typeof stateDir !== 'string' || stateDir.trim() === '') {
    throw new Error('aukora-eye: config.stateDir must name the directory that keeps recent captures '
      + '(no default: a screen capture is not written somewhere nobody chose)')
  }
  const keep = config.keep ?? DEFAULT_KEEP
  if (!Number.isInteger(keep) || keep < 1 || keep > 50) {
    throw new Error('aukora-eye: config.keep must be an integer between 1 and 50')
  }
  if (config.note !== undefined && typeof config.note !== 'string') {
    throw new Error('aukora-eye: config.note must be a string when present')
  }
  return { stateDir, keep, ...(config.note === undefined ? {} : { note: config.note }) }
}

/**
 * Register `aukora_see` against the composition's tool registry.
 * @param ctx - the plugin context carrying the tool registry.
 * @param config - `{ stateDir, keep?, note? }`.
 */
export function apply(ctx, config) {
  const resolved = resolveConfig(config)
  const store = createCaptureStore({ dir: resolved.stateDir, keep: resolved.keep })
  // THE ATTACHMENT GATE IS DECLARED, NOT ASSUMED. Without a durable store the tool must not exist:
  // an image the model cannot look at again is worse than a tool that says it is unavailable.
  ctx.inject(['attachments'], (scoped) => {
    const attachments = scoped.get('attachments')
    if (attachments === undefined) return
    scoped.tools.register(createSeeTool({
      store,
      attachments,
      config: resolved,
      env: process.env,
    }))
  })
}
