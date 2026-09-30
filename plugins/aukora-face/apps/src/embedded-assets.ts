import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { VENDOR_ROOT } from './vendor-paths.ts'

type ServeStatic = typeof import('@deepseek-ai/dsh-host-frontend-static')['serveStatic']

interface EmbeddedAssetHandlers {
  serveStockAppFile(this: void, req: IncomingMessage, res: ServerResponse): Promise<void>
  serveAukoraIcon(this: void, req: IncomingMessage, res: ServerResponse): Promise<void>
  serveLingwaEntry(this: void, req: IncomingMessage, res: ServerResponse): Promise<void>
  serveAumaLiveEntry(this: void, req: IncomingMessage, res: ServerResponse): Promise<void>
  serveZetaHarpFile(this: void, req: IncomingMessage, res: ServerResponse): Promise<void>
  serveDakiniCodeFile(this: void, req: IncomingMessage, res: ServerResponse): Promise<void>
  serveHumanGraphFile(this: void, req: IncomingMessage, res: ServerResponse): Promise<void>
}

const LINGWA_ROOT = join(VENDOR_ROOT, 'auma-lingwa', 'runtime')
const LINGWA_APP_ROOT = join(LINGWA_ROOT, 'app')
const LINGWA_ASSET_ROOT = join(LINGWA_ROOT, 'assets')
const LIVE_ROOT = join(VENDOR_ROOT, 'auma-live', 'runtime')
const LIVE_APP_ROOT = join(LIVE_ROOT, 'app')
const ZETA_HARP_ROOT = join(VENDOR_ROOT, 'zeta-harp')
const DAKINI_CODE_ROOT = join(VENDOR_ROOT, 'dakini-code')
const HUMAN_GRAPH_ROOT = fileURLToPath(new URL('../assets/human-graph', import.meta.url))
const HUMAN_GRAPH_FILES = new Set(['index.html', 'graph.css', 'bootstrap.js', 'graph.js', 'graph-data.js'])
const HUMAN_GRAPH_THREE_FILES = new Set(['three.module.min.js', 'three.core.min.js'])

const LINGWA_MODULE_ROUTE = 'auma/auma.js'
const LINGWA_MODULE_PATH = join(LINGWA_APP_ROOT, 'auma', 'auma.js')

/**
 * Lesson gate held by the vendored Lingwa module, and the declaration served
 * in its place. Every lesson opens for reading with no prior-day completion
 * required; rewriting the one expression on the way out keeps the vendored
 * bytes and their manifest digest exact. `assets.host.spec.ts` pins both
 * halves against the module, so a donor revision that moves the expression
 * fails the suite rather than silently restoring the lock.
 */
const LINGWA_LESSON_GATE = 'const isUnlocked = (day, s) => day === 1 || !!s.done[day - 1] || !!s.done[day];'
/** Replacement declaration; keeping the same binding form keeps the module valid. */
const LINGWA_LESSON_OPEN = 'const isUnlocked = () => true;'

const NON_INDEX = '__aukora_stock_app_route_has_no_index__.html'
/**
 * Every module the Auma Live page loads from `/app/`. `aumalive.js` imports its siblings
 * STATICALLY, so one name missing here is a 404, the whole module graph refuses to
 * evaluate, and Auma Live is dead on arrival with no error on the host. The 09-25 release
 * shipped exactly that: four new modules on disk and not on this list.
 * `tests/auma-live-static-closure.test.mjs` holds this list against the imports.
 *
 * **THE RULE, BECAUSE A LIST IS ONLY AS GOOD AS WHEN IT IS UPDATED: A NEW RUNTIME OR APP MODULE LANDS WITH ITS
 * ENTRY HERE IN THE SAME COMMIT.** Not the next one, and not when the page is next opened — the failure mode is
 * that everything on the host looks correct and the page is dead in the browser, so the only moment the omission is
 * cheap is before it ships. If the module is imported statically by anything the page loads, its name belongs here
 * in the same change that adds the file.
 *
 * The court is the enforcement; this comment is the instruction. Both exist because the first release that got
 * this wrong reached Peter's machine.
 */
const LIVE_APP_FILES: ReadonlySet<string> = new Set([
  'aura-trace.js',
  'aumalive.js',
  'aumalive-audio.js',
  'aumalive-duplex.js',
  'aumalive-mind-choice.js',
  'chat-log-key.js',
  'field-directives.js',
  'field-quality.js',
  'home-session.js',
  'lane-bridge.js',
])

/**
 * HTTP method gate shared by every repository-owned static mount.
 * @param req - Incoming static request.
 * @param res - Response receiving a method failure.
 * @returns Whether the request may continue.
 */
function acceptsStaticMethod(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === 'GET' || req.method === 'HEAD') return true
  res.writeHead(405)
  res.end()
  return false
}

/**
 * Serve one relative file through the harness traversal and miss guards.
 * @param req - Incoming request.
 * @param res - Static response.
 * @param root - Authoritative static root.
 * @param relativePath - Decoded path below root.
 */
async function serveFile(
  serveStatic: ServeStatic,
  req: IncomingMessage,
  res: ServerResponse,
  root: string,
  relativePath: string,
): Promise<void> {
  if (!acceptsStaticMethod(req, res)) return
  if (relativePath.length === 0) {
    res.writeHead(404)
    res.end()
    return
  }
  await serveStatic(
    `/${relativePath}`,
    res,
    root,
    join(root, NON_INDEX),
    // A stock app route never serves an index, so authorization is moot here and the
    // renderer below is the refusal. Returning false instead would end the request
    // without writing a response at all.
    () => true,
    () => Promise.reject(new Error('stock app static route cannot render an index')),
  )
}

/**
 * Decode a mounted route's suffix; malformed escapes reach the webserver guard.
 * @param req - Mounted request.
 * @param prefix - Registered route prefix.
 * @returns Relative decoded suffix.
 */
function mountedSuffix(req: IncomingMessage, prefix: string): string {
  const pathname = new URL(req.url ?? '/', 'http://stock-app.local').pathname
  return decodeURIComponent(pathname.slice(prefix.length)).replace(/^\/+/, '')
}

/**
 * Serve the Lingwa application module with every lesson open.
 * @param req - Request for the module's own `/app/auma/auma.js` path.
 * @param res - Response receiving the rewritten module.
 * @throws When the vendored module no longer contains the gate expression.
 */
async function serveOpenedLingwaModule(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!acceptsStaticMethod(req, res)) return
  const source = await readFile(LINGWA_MODULE_PATH, 'utf8')
  if (!source.includes(LINGWA_LESSON_GATE)) {
    throw new Error(`Auma Lingwa lesson gate absent from ${LINGWA_MODULE_PATH}`)
  }
  const body = source.replace(LINGWA_LESSON_GATE, LINGWA_LESSON_OPEN)
  res.writeHead(200, {
    'content-type': 'text/javascript; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
  })
  res.end(req.method === 'HEAD' ? undefined : body)
}

/**
 * Bind repository-owned static handlers to the host's guarded file server.
 * @param serveStatic - Host implementation that enforces traversal and miss guards.
 * @returns Route handlers for every stock-app asset tree.
 */
export function createEmbeddedAssetHandlers(serveStatic: ServeStatic): EmbeddedAssetHandlers {
  return {
    /** Exact local asset closure: no arbitrary vendor files, directory indexes, or traversal. */
    async serveHumanGraphFile(req: IncomingMessage, res: ServerResponse): Promise<void> {
      if (!acceptsStaticMethod(req, res)) return
      let relative: string
      try { relative = mountedSuffix(req, '/stock-apps/human-graph') }
      catch { res.writeHead(400); res.end(); return }
      const threeFile = relative.startsWith('three/') ? relative.slice(6) : ''
      const root = HUMAN_GRAPH_FILES.has(relative) ? HUMAN_GRAPH_ROOT
        : HUMAN_GRAPH_THREE_FILES.has(threeFile) ? join(VENDOR_ROOT, 'three') : undefined
      if (root === undefined) { res.writeHead(404); res.end(); return }
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'")
      await serveFile(serveStatic, req, res, root, root === HUMAN_GRAPH_ROOT ? relative : threeFile)
    },
    /** Serve the overlay at `/app`: the exact Lingwa and Live runtime files. */
    async serveStockAppFile(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const relative = mountedSuffix(req, '/app')
      if (relative === LINGWA_MODULE_ROUTE) {
        await serveOpenedLingwaModule(req, res)
        return
      }
      const root = relative === 'style.css' || relative === 'aura-core.js' || relative.startsWith('auma/')
        ? LINGWA_APP_ROOT
        : LIVE_APP_FILES.has(relative)
          ? LIVE_APP_ROOT
          : undefined
      if (root === undefined) {
        if (!acceptsStaticMethod(req, res)) return
        res.writeHead(404)
        res.end()
        return
      }
      await serveFile(serveStatic, req, res, root, relative)
    },

    /** Serve the exact Aukora mark used by Lingwa. */
    async serveAukoraIcon(req: IncomingMessage, res: ServerResponse): Promise<void> {
      await serveFile(serveStatic, req, res, LINGWA_ASSET_ROOT, 'aumara-icon-96.png')
    },

    /** Serve the isolated Lingwa page that mounts the original application. */
    async serveLingwaEntry(req: IncomingMessage, res: ServerResponse): Promise<void> {
      await serveFile(serveStatic, req, res, LINGWA_ROOT, 'auma-lingwa.html')
    },

    /** Serve the isolated Auma Live page that mounts the original application. */
    async serveAumaLiveEntry(req: IncomingMessage, res: ServerResponse): Promise<void> {
      await serveFile(serveStatic, req, res, LIVE_ROOT, 'auma-live.html')
    },

    /** Serve the pinned Dakini Code static build below its own prefix. */
    async serveDakiniCodeFile(req: IncomingMessage, res: ServerResponse): Promise<void> {
      await serveFile(serveStatic, req, res, DAKINI_CODE_ROOT, mountedSuffix(req, '/stock-apps/dakini-code'))
    },

    /** Serve the complete Zeta Harp tree below its isolated route prefix. */
    async serveZetaHarpFile(req: IncomingMessage, res: ServerResponse): Promise<void> {
      await serveFile(serveStatic, req, res, ZETA_HARP_ROOT, mountedSuffix(req, '/stock-apps/zeta-harp'))
    },
  }
}
