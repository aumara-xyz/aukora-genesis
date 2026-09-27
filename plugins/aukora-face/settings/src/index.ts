/**
 * Host loader entry: the Aura session projection, the onboarding settings namespace, and
 * one authenticated read-only route that projects the Aura evidence already on disk.
 *
 * TWO DIFFERENT THINGS, KEPT APART ON PURPOSE. The session projection is ACTIVITY — a
 * content-free fold over the durable session log, which declares in its own schema that
 * it carries no receipts, no identity binding and no external anchor. The route below is
 * EVIDENCE — receipts and retention read from the composition state, verified by the
 * adapter that owns verification. A screen may show both; it may never add them up.
 *
 * The route adds no verification of its own. It spawns
 * `evidence/aura-evidence.py`, which calls `scripts/aura/adapter.py` and reports what it
 * answers, refusal names included.
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { auraCoherenceProjectionDefinition } from './aura/projection.ts'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** Same-origin GET route serving the read-only Aura evidence projection. */
export const AURA_EVIDENCE_ENDPOINT = '/api/aukora/aura-evidence'

/** Same-origin GET route through which a shell asks this backend what it is. */
export const BACKEND_IDENTITY_ENDPOINT = '/api/aukora/backend-identity'

/** The faces whose presence in a release makes it the spatial frontend. */
const SPATIAL_FACES = Object.freeze(['layout', 'sidebar', 'threads', 'settings'])

/** The projection is a short read; a run longer than this is a refusal, not a wait. */
const PROJECTION_TIMEOUT_MS = 20_000

/** A projection document larger than this is refused rather than buffered. */
const PROJECTION_MAX_BYTES = 4 * 1024 * 1024

/**
 * The trust surface a plugin-owned route consults before serving. Typed locally, as the
 * harness's own open-in-app plugin does, because the connection package is browser-side.
 */
interface RouteGate {
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

/** This file's own directory, and the release (or package) root two levels above it. */
const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * Resolve the composition state directory the way the gate itself resolves it.
 *
 * ONE SOURCE OF TRUTH, NOT A SECOND COPY OF THE PRECEDENCE. `resolveStateDir` lives in
 * the association plugin and reads config.stateDir, then config.gateRoot, then the
 * stateDir inside $AUKORA_GATE_CONFIG, then `<gateRoot>/gate-state`. Re-deriving that
 * order here would work until the day it drifted, and then this route would confidently
 * report evidence from a directory nothing else was using.
 * @param releaseRoot - the root the face was loaded from.
 * @returns the state directory, or undefined when the association plugin is not carried.
 */
async function resolveGateState(releaseRoot: string): Promise<string | undefined> {
  const candidate = join(releaseRoot, 'plugins/aukora-aura-association/lib/index.js')
  try {
    const module = await import(candidate) as {
      resolveStateDir?: (config: object, env: NodeJS.ProcessEnv) => string
    }
    if (typeof module.resolveStateDir !== 'function') return undefined
    return module.resolveStateDir({ gateRoot: releaseRoot }, process.env)
  } catch {
    return undefined
  }
}

/**
 * What this backend is, answered by the backend itself.
 *
 * WHY A BACKEND MUST ANSWER THIS. A window showing a page cannot tell which release
 * serves it, and the two ways to guess are both wrong: reading a launch record out of
 * another deployment's private state root crosses a boundary that should stay closed,
 * and matching a port names a listener rather than a release. So the backend reports its
 * own identity over an authenticated route, and a window that cannot reach this route
 * reports the identity as unknown rather than inferring one.
 *
 * Everything here is read from the tree this module was loaded out of. It carries no
 * secret: a release path, the commit that release records about itself, and which face
 * plugins are beside it.
 * @param releaseRoot - the root this face was loaded from.
 * @returns the identity document.
 */
export function backendIdentity(releaseRoot: string): object {
  const observedAt = new Date().toISOString()
  let genesisCommit: string | null = null
  let recordError: string | null = null
  try {
    const record = JSON.parse(
      readFileSync(join(releaseRoot, '.dsh-build/genesis-artifacts.json'), 'utf8'),
    ) as { producer?: { genesisCommit?: unknown } }
    const commit = record.producer?.genesisCommit
    genesisCommit = typeof commit === 'string' ? commit : null
  } catch (error) {
    recordError = String((error as Error).message ?? error)
  }
  // FRONTEND IDENTITY FROM THE BYTES, NOT FROM A NAME. A release either has the face
  // packages beside this one or it does not; an older release has none of them and can
  // only ever serve the stock interface, whatever its directory is called.
  const faces = SPATIAL_FACES.filter(face =>
    existsSync(join(releaseRoot, `plugins/aukora-face-${face}/lib/client.js`)))
  return {
    schema: 'aukora-face/backend-identity:v1',
    observedAt,
    release: {
      root: releaseRoot,
      name: releaseRoot.split('/').filter(Boolean).pop() ?? releaseRoot,
      genesisCommit,
      recordError,
    },
    frontend: {
      // Stated as a verdict AND as the evidence for it, so a consumer can disagree.
      identity: faces.length === SPATIAL_FACES.length ? 'spatial'
        : faces.length === 0 ? 'stock' : 'partial',
      facesPresent: faces,
      facesExpected: [...SPATIAL_FACES],
    },
  }
}

/** A refusal body in the projection's own shape, so a consumer parses one thing. */
function refusalDocument(code: string, reason: string): object {
  return { source: { schema: 'aukora-face/aura-evidence:v1' }, ceilings: [], refusal: { code, reason } }
}


/** Durable settings namespace for product-wide GUI onboarding facts. */
const ONBOARDING_SETTINGS_NAMESPACE = 'ui-onboarding'

interface OnboardingSettings {
  /** Last version acknowledged by the current product welcome step. */
  welcomeNoticeVersion?: string
}

const OnboardingSettingsSchema: z<OnboardingSettings> = z.object({
  welcomeNoticeVersion: z.string(),
})

/**
 * Run the evidence projection once and return its document.
 * @param releaseRoot - the root this face was loaded from.
 * @returns the projection document, or a refusal in the same shape.
 */
export async function readAuraEvidence(releaseRoot: string): Promise<object> {
  const script = join(HERE, '..', 'evidence', 'aura-evidence.py')
  const scripts = join(releaseRoot, 'scripts')
  const state = await resolveGateState(releaseRoot)
  if (state === undefined) {
    return refusalDocument('aura-state-unresolved',
      'the association plugin that owns state resolution is not carried here, so this route '
      + 'will not guess which directory the gate is using')
  }
  return await new Promise((settle) => {
    execFile('python3', [script, '--state', state, '--scripts', scripts], {
      timeout: PROJECTION_TIMEOUT_MS,
      maxBuffer: PROJECTION_MAX_BYTES,
      // A read must not inherit a cwd inside a checkout: the adapter's imports are
      // path-driven and a stray cwd is how bytecode lands where it should not.
      cwd: releaseRoot,
    }, (error, stdout) => {
      if (error) {
        settle(refusalDocument('aura-projection-failed', `${error.name}: ${error.message}`))
        return
      }
      try {
        settle(JSON.parse(stdout) as object)
      } catch (parseError) {
        settle(refusalDocument('aura-projection-unparseable', String(parseError)))
      }
    })
  })
}

/** Register the projection, the settings namespace, and the evidence route. */
export function apply(ctx: Context): void {
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(auraCoherenceProjectionDefinition)
  })
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      ONBOARDING_SETTINGS_NAMESPACE,
      OnboardingSettingsSchema,
    )
  })
  // Optional on purpose: a composition with no web server still gets the projection and
  // the settings namespace, rather than withholding the whole face over a route.
  ctx.inject(['webServer', 'connection'], (webCtx) => {
    const releaseRoot = resolve(HERE, '..', '..', '..')
    const gate = (): RouteGate => Reflect.get(webCtx, 'connection') as RouteGate
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: AURA_EVIDENCE_ENDPOINT,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        // AUTHENTICATION FIRST. The harness has no gate in front of /api — it checks per
        // route — so a route that skips this call is readable by any process on this
        // machine, and this one reports the shape of an installation's evidence.
        const rejection = gate().requestRejection(req)
        if (rejection !== undefined) {
          res.writeHead(rejection, { 'cache-control': 'no-store' })
          res.end()
          return
        }
        if (req.method !== 'GET') {
          res.writeHead(405, { allow: 'GET', 'cache-control': 'no-store' })
          res.end()
          return
        }
        const document = await readAuraEvidence(releaseRoot)
        res.writeHead(200, {
          'cache-control': 'no-store',
          'content-type': 'application/json; charset=utf-8',
          'x-content-type-options': 'nosniff',
        })
        res.end(JSON.stringify(document))
      },
    }), 'ui-settings-general: aura evidence route')

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: BACKEND_IDENTITY_ENDPOINT,
      handler: (req: IncomingMessage, res: ServerResponse) => {
        const rejection = gate().requestRejection(req)
        if (rejection !== undefined) {
          res.writeHead(rejection, { 'cache-control': 'no-store' })
          res.end()
          return
        }
        if (req.method !== 'GET') {
          res.writeHead(405, { allow: 'GET', 'cache-control': 'no-store' })
          res.end()
          return
        }
        res.writeHead(200, {
          'cache-control': 'no-store',
          'content-type': 'application/json; charset=utf-8',
          'x-content-type-options': 'nosniff',
        })
        res.end(JSON.stringify(backendIdentity(releaseRoot)))
      },
    }), 'ui-settings-general: backend identity route')
  })
}
