/**
 * `aukora_see`: the model's own look at the running app.
 *
 * WHAT IT DOES. Asks the shell for a photograph of the window that is already open, commits the PNG
 * as a durable attachment, and returns the picture to the model beside a short text summary — the
 * size, the scale, when it was taken, where the bytes were kept, and, when this session has looked
 * before, a PIXEL DIFF against the previous capture: how much changed and where.
 *
 * WHY THE DIFF IS THE USEFUL HALF. "Is the app as I intended" is answered by the image; "did my edit
 * do what I said" is answered by the diff. An edit that changes no pixel says so in one line, which
 * is the finding a person needs before believing a change landed.
 *
 * WHAT IT DOES NOT DO. It does not read the DOM, the source, or a log — the answer is pixels or it
 * is a named refusal. It does not carry bytes into the session log: the log keeps the attachment
 * reference, and the ring in the state directory keeps the last few PNGs. And it does not decide
 * whether the picture is good; that judgement is the model's or the owner's.
 *
 * @module @aukora/dsh-plugin-eye/tools
 */

import { captureFromEye, readEyeConfig, EyeError, EYE_CAPTURE_REFUSE } from './capture.mjs'
import { diffRgba, formatDiff } from './diff.mjs'
import { decodePng } from './png.mjs'

/** The model-facing tool name. */
export const SEE_TOOL_NAME = 'aukora_see'

/** What one look establishes, and what it does not. */
export const SEE_CEILING = Object.freeze([
  'the pixels are of the window the SHELL owns and names; nothing here proves which window that was',
  'the diff is a comparison of pixels, not of intent: an unchanged capture does not prove the edit failed to apply, only that it did not change what is on screen',
  'the scale in the result is the door\'s own downscale factor; region coordinates are in the RETURNED image\'s pixels',
  'the state directory keeps the last few captures for a person to look at; the session log keeps only the attachment reference',
])

/** The image metadata the tool declares, mirroring the harness\'s own image result. */
const IMAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: true,
  properties: {
    attachmentId: { type: 'string', required: true },
    mediaType: { type: 'string', enum: ['image/png'], required: true },
    bytes: { type: 'integer', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    name: { type: 'string' },
    normalizedFrom: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: { width: { type: 'integer', required: true }, height: { type: 'integer', required: true } },
    },
  },
}

const DIFF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: true,
  properties: {
    comparable: { type: 'boolean', required: true },
    reason: { type: 'string' },
    size: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: { width: { type: 'integer', required: true }, height: { type: 'integer', required: true } },
    },
    previousSize: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: { width: { type: 'integer', required: true }, height: { type: 'integer', required: true } },
    },
    changedPixels: { type: 'integer' },
    changedPercent: { type: 'number' },
    regionCount: { type: 'integer' },
    cellSize: { type: 'integer' },
    tolerance: { type: 'integer' },
    regions: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        required: true,
        properties: {
          x: { type: 'integer', required: true },
          y: { type: 'integer', required: true },
          width: { type: 'integer', required: true },
          height: { type: 'integer', required: true },
        },
      },
    },
    previousAt: { type: 'string' },
  },
}

/**
 * The session a call belongs to, and whether that identity is exact.
 *
 * The diff is only meaningful within one session: two sessions looking at the same app would produce
 * a diff across unrelated work. When no session id can be read, the call still captures and still
 * stores, but the diff is withheld with a reason instead of being computed against somebody else's
 * frame.
 * @param exec - the tool execution context.
 * @returns the storage key and whether the identity came from the session.
 */
export function sessionKeyOf(exec) {
  const id = exec?.agent?.session?.id
  if (typeof id === 'string' && id.length > 0) return { key: id, exact: true }
  const fallback = exec?.agent?.id
  return { key: typeof fallback === 'string' && fallback.length > 0 ? `agent-${fallback}` : 'anonymous', exact: false }
}

/**
 * Validate the optional capture rectangle and scale the tool accepts.
 *
 * The four rectangle fields are flat here because the tool schema subset is happiest that way, and
 * they must arrive together: a half-specified rectangle is refused rather than completed with zeroes,
 * which would photograph a different region than the caller asked for.
 * @param args - the parsed arguments.
 * @returns the rectangle and scale, or a refusal naming what is wrong.
 */
export function readRequest(args) {
  const fields = ['x', 'y', 'width', 'height']
  const present = fields.filter(field => args?.[field] !== undefined)
  if (present.length !== 0 && present.length !== fields.length) {
    return { ok: false, why: `x, y, width and height must be given together; got ${present.join(', ')}` }
  }
  let rect
  if (present.length === 4) {
    for (const field of fields) {
      if (!Number.isInteger(args[field]) || args[field] < 0) return { ok: false, why: `${field} must be a non-negative integer` }
    }
    if (args.width === 0 || args.height === 0) return { ok: false, why: 'a capture rectangle must have a non-zero width and height' }
    rect = { x: args.x, y: args.y, width: args.width, height: args.height }
  }
  const scale = args?.scale
  if (scale !== undefined && (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0 || scale > 1)) {
    return { ok: false, why: 'scale must be a number in (0, 1]' }
  }
  return { ok: true, rect, scale }
}

/**
 * Build the `aukora_see` tool.
 *
 * @param options - the tool's dependencies.
 * @param {object} options.store - the capture ring from {@link createCaptureStore}.
 * @param {object} options.attachments - the harness attachment service (`ctx.attachments`).
 * @param {object} [options.config] - `{ keep }` and which environment carries the eye's address.
 * @param {object} [options.env] - the environment the eye's address is read from.
 * @param {Function} [options.capture] - the door caller, injected for tests.
 * @returns the tool definition.
 */
export function createSeeTool({ store, attachments, config = {}, env = process.env, capture = captureFromEye }) {
  if (attachments === undefined || attachments === null) throw new Error('aukora-eye: an attachment service is required')
  const note = config.note

  return {
    name: SEE_TOOL_NAME,
    description: 'Look at the running AUKORA app: photograph the window the shell is showing and return '
      + 'the picture itself. Ask for a region with x/y/width/height (window pixels) when one part matters, '
      + 'or scale (0-1] to ask for a smaller picture. When this session has looked before, the result also '
      + 'carries a pixel diff against the previous capture: the percentage of pixels that changed and the '
      + 'bounding boxes of the changed regions. Use it to check what an edit actually rendered, instead of '
      + 'assuming it landed. Requires the desktop shell to be running the app; a refusal names why.',
    parameters: {
      x: { type: 'integer', description: 'Left edge of the region to capture, in window pixels (requires y, width and height).' },
      y: { type: 'integer', description: 'Top edge of the region to capture, in window pixels (requires x, width and height).' },
      width: { type: 'integer', description: 'Width of the region to capture, in window pixels.' },
      height: { type: 'integer', description: 'Height of the region to capture, in window pixels.' },
      scale: { type: 'number', description: 'Ask for a smaller picture: a multiplier in (0, 1] applied to the door\'s width ceiling.' },
      note: { type: 'string', description: 'What this look is for, recorded beside the capture in the state directory.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          capturedAt: { type: 'string', required: true },
          image: IMAGE_SCHEMA,
          source: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: { width: { type: 'integer', required: true }, height: { type: 'integer', required: true } },
          },
          scale: { type: 'number' },
          stored: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              path: { type: 'string', required: true },
              kept: { type: 'integer', required: true },
              previousPath: { type: 'string' },
            },
          },
          diff: DIFF_SCHEMA,
          ceiling: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: formatSeeOutput(value) },
        { type: 'image', attachment: { ...value.image } },
      ],
      presentationMeta: (_args, value) => ({ path: value.stored.path, capturedAt: value.capturedAt }),
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      // Every exit below carries the ceiling, refusals included (see `withCeiling`).
      try {
      const eye = readEyeConfig(env)
      if (!eye.ok) {
        throw new EyeError(
          'no eye is configured in this deployment: the desktop shell that owns the window has not opened one '
          + `(${EYE_CAPTURE_REFUSE.NOT_CONFIGURED}). Start the app through apps/aukora-desktop and try again.`,
          eye.code,
        )
      }
      const request = readRequest(args)
      if (!request.ok) throw new EyeError(`cannot capture: ${request.why}`, EYE_CAPTURE_REFUSE.REFUSED)

      const shot = await capture({
        url: eye.url,
        token: eye.token,
        ...(request.rect === undefined ? {} : { rect: request.rect }),
        ...(request.scale === undefined ? {} : { scale: request.scale }),
        ...(exec?.signal === undefined ? {} : { signal: exec.signal }),
      })

      const session = sessionKeyOf(exec)
      const name = `aukora-${shot.capturedAt.replace(/[:.]/gu, '-')}.png`
      // PERSIST BEFORE RETURNING: the image block must name a durably committed object by the time
      // the tool result is appended, or a replayed session would reference bytes that never existed.
      const ref = await attachments.saveImage({ data: shot.png, mediaType: 'image/png', name })

      const entries = session.exact ? await store.list(session.key) : []
      const previousEntry = entries.at(-1)
      let diff
      if (previousEntry !== undefined) {
        const previousBytes = await store.read(session.key, previousEntry.file)
        if (previousBytes !== null) {
          try {
            diff = { ...diffRgba(decodePng(previousBytes), decodePng(shot.png)), previousAt: previousEntry.capturedAt }
          } catch (error) {
            // A previous frame this reader cannot decode must not fail the look that is happening now.
            diff = { comparable: false, reason: `previous-capture-unreadable: ${String(error?.code ?? error?.message ?? error)}`, size: { width: shot.width, height: shot.height }, previousSize: { width: shot.width, height: shot.height }, regions: [] }
          }
        }
      }

      const recorded = await store.record({
        sessionId: session.key,
        png: shot.png,
        meta: { width: shot.width, height: shot.height, sourceWidth: shot.sourceWidth, sourceHeight: shot.sourceHeight, note: args?.note ?? note ?? null },
      })

      return {
        capturedAt: shot.capturedAt,
        image: {
          attachmentId: String(ref.attachmentId),
          mediaType: 'image/png',
          bytes: ref.bytes,
          // THE REFERENCE'S DIMENSIONS, because the attachment service is what the model receives:
          // it may normalize the image, and reporting the captured size instead would describe a
          // picture that is not the one attached. When it did normalize, the capture's own size is
          // named too, so the diff's coordinates can be mapped back.
          width: ref.width,
          height: ref.height,
          name: ref.name ?? name,
          ...(ref.width === shot.width && ref.height === shot.height ? {} : { normalizedFrom: { width: shot.width, height: shot.height } }),
        },
        source: { width: shot.sourceWidth, height: shot.sourceHeight },
        ...(shot.scale === null ? {} : { scale: shot.scale }),
        stored: {
          path: recorded.path,
          kept: recorded.kept,
          ...(recorded.previousPath === null ? {} : { previousPath: recorded.previousPath }),
        },
        ...(diff === undefined ? {} : { diff }),
        ceiling: [...SEE_CEILING],
      }
      } catch (error) {
        throw withCeiling(error)
      }
    },
    presentCall(args) {
      const region = args?.width === undefined ? 'the app window' : `x=${args.x} y=${args.y} ${args.width}x${args.height}`
      return { card: 'generic', title: `Look at ${region}`, kind: 'read', locations: [] }
    },
  }
}

/**
 * Attach the ceiling to a refusal, so it prints on EVERY exit rather than only on success.
 *
 * CLASS 4 OF THE AUKORA-37 REVIEW, in this organ: the tool returned `ceiling` in its success value and
 * every refusal threw without it, so the caller who most needs to know what a look does not establish —
 * the one whose look was refused — was the only one who never saw it. The ceilings are the honest part
 * of this tool; a refusal is not an excuse to stop printing them.
 * @param error - whatever was thrown.
 * @returns the same error, carrying the ceiling once.
 */
function withCeiling(error) {
  const failure = error instanceof Error ? error : new Error(String(error))
  if (!Array.isArray(failure.ceiling)) {
    failure.ceiling = [...SEE_CEILING]
    failure.message = `${failure.message}\nceiling:\n${SEE_CEILING.map(line => `  - ${line}`).join('\n')}`
  }
  return failure
}

/**
 * The model-facing text that rides beside the image.
 * @param value - the tool's canonical value.
 * @returns the summary block.
 */
export function formatSeeOutput(value) {
  const parts = [
    `<capture at="${value.capturedAt}">`,
    `${value.image.width}x${value.image.height} px returned`
      + (value.scale === undefined ? '' : ` (scale ${value.scale} of ${value.source.width}x${value.source.height})`)
      + (value.image.normalizedFrom === undefined ? '' : ` (normalized from ${value.image.normalizedFrom.width}x${value.image.normalizedFrom.height}; diff regions are in the CAPTURE's pixels)`),
    `stored at ${value.stored.path} (${value.stored.kept} kept for this session)`,
  ]
  if (value.diff !== undefined) parts.push(formatDiff(value.diff, value.diff.previousAt ?? 'an earlier capture'))
  else parts.push('No previous capture in this session, so there is nothing to diff against yet.')
  parts.push('</capture>')
  return parts.join('\n')
}
