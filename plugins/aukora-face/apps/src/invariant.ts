/**
 * Package-owned invariant companion for `@aukora/face-apps`.
 * @module @aukora/face-apps/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@aukora/face-apps'

/** Cordis companion plugin name. */
export const name = 'client-ui-stock-apps-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Validate one complete Canvas document without applying deployment limits. */
function validateCanvasDocument(value: unknown, fail: InvariantFailure): void {
  if (value === null) return
  if (typeof value !== 'object' || Array.isArray(value)) {
    fail('auma-canvas/document document must be an object or null')
  }
  const document = value as Record<string, unknown>
  const keys = Object.keys(document).sort()
  if (keys.join(',') !== 'css,markup,title,version') {
    fail('auma-canvas/document document must contain only css, markup, title, and version')
  }
  if (document['version'] !== 1) fail('auma-canvas/document carries an unsupported version')
  const title = document['title']
  if (
    typeof title !== 'string'
    || title.length === 0
    || title.length > 160
    || title.trim() !== title
  ) {
    fail('auma-canvas/document title must be 1-160 characters and already trimmed')
  }
  const markup = document['markup']
  if (typeof markup !== 'string' || markup.trim().length === 0) {
    fail('auma-canvas/document markup must be a non-blank string')
  }
  if (typeof document['css'] !== 'string') {
    fail('auma-canvas/document css must be a string')
  }
}

/** Validate package-owned durable fields and ignore unrelated events. */
function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'auma-canvas/document') return
  const data = event.data as unknown
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    fail('auma-canvas/document data must be an object')
  }
  const record = data as Record<string, unknown>
  if (Object.keys(record).join(',') !== 'document') {
    fail('auma-canvas/document data must contain only document')
  }
  validateCanvasDocument(record['document'], fail)
}

/** Install Canvas document validation for loaded and newly appended Sessions. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) {
    for (const event of session.snapshotEvents()) validateEvent(event, fail)
  }
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const event = (args as [Session, SessionEvent])[1]
    validateEvent(event, fail)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
