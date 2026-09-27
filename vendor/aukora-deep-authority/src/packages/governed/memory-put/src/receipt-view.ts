/**
 * Receipt viewer: the product surface that shows one settled operation.
 *
 * SETTLEMENT, VERIFICATION AND ATTRIBUTION ARE RENDERED AS SEPARATE VALUES.
 * A settled operation can carry a NON-CONFORMING document, so a surface that
 * showed one status would have to misreport one of the three facts.
 *
 * The route is read-only. It reaches the broker through the same parent-supplied
 * socket the model tools use, so there is one answer to "who may read broker
 * state" and no second transport. Nothing here mints authority, and inspection
 * cannot produce a settlement.
 *
 * The page carries no operation data: it fetches the inspection itself and
 * renders it in the browser, so no stored bytes are interpolated into markup.
 *
 * @module @deepseek-ai/dsh-aukora-memory/receipt-view
 */
import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { ReceiptInspection } from './proposal-client.ts'
import type { GovernedMemoryService } from './index.ts'

/** The page path, and the base of the two endpoints the page calls. */
export const RECEIPT_VIEW_PATH = '/aukora/receipt'

/**
 * Maximum request body the viewer reads.
 *
 * A digest and one boolean fit in far less; the cap exists so a caller cannot
 * hold the route open by streaming an unbounded body.
 */
const MAX_REQUEST_BYTES = 4096

/** One refusal this route reports before the broker is reached. */
export const VIEWER_REFUSE = {
  METHOD_NOT_ALLOWED: 'viewer:method-not-allowed',
  CONTENT_TYPE_REQUIRED: 'viewer:content-type-required',
  HEADER_REQUIRED: 'viewer:header-required',
  ORIGIN_NOT_ACCEPTED: 'viewer:origin-not-accepted',
  BODY_UNREADABLE: 'viewer:body-unreadable',
  BODY_TOO_LARGE: 'viewer:body-too-large',
  DIGEST_MALFORMED: 'viewer:digest-malformed',
  BROKER_UNREACHABLE: 'viewer:broker-unreachable',
  MEMORY_ROUTE_ABSENT: 'viewer:memory-route-absent',
} as const

/**
 * Whether a value is exactly the lowercase hex sha256 the Aura chain records.
 *
 * The same check guards the tool argument and this route, because an identifier
 * that reaches a path or a lookup must be validated once, identically, wherever
 * it enters.
 *
 * @param value - the candidate identifier.
 * @returns true when the value is 64 lowercase hex characters.
 */
export function isExactReceiptDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value)
}

/** The viewer page. Fetches its own data so no stored bytes enter the markup. */
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AUKORA receipt viewer</title>
<style>
  :root { color-scheme: dark }
  body { margin: 0; padding: 24px; background: #0b0d10; color: #e6e8eb;
    font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace }
  h1 { font-size: 16px; margin: 0 0 4px }
  .sub { color: #8b939e; margin-bottom: 20px }
  form { display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap }
  input { flex: 1 1 420px; padding: 8px; background: #14171c; color: inherit;
    border: 1px solid #2a2f38; border-radius: 4px; font: inherit }
  button { padding: 8px 14px; background: #1d2531; color: inherit;
    border: 1px solid #37404d; border-radius: 4px; font: inherit; cursor: pointer }
  button:hover { background: #26303f }
  button.danger { border-color: #6b3a3a }
  .hint { color: #8b939e; margin-bottom: 20px }
  section { border: 1px solid #232830; border-radius: 6px; margin-bottom: 12px; padding: 12px 14px }
  section > h2 { font-size: 12px; letter-spacing: .08em; text-transform: uppercase;
    color: #8b939e; margin: 0 0 10px }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0 }
  dt { color: #8b939e }
  dd { margin: 0; word-break: break-all }
  .verdict { font-weight: 700 }
  .verdict.CONFORMING { color: #6ee7a8 }
  .verdict.NON-CONFORMING { color: #f0b46b }
  .absent, .unavailable { color: #f08a8a }
  .reason { display: inline-block; margin: 2px 6px 2px 0; padding: 1px 6px;
    border: 1px solid #4a3a2a; border-radius: 3px; color: #f0b46b }
  .refusal { border-color: #6b3a3a; color: #f08a8a }
  ul { margin: 0; padding-left: 18px; color: #8b939e }
  .disclosure { margin: 16px 0; padding: 12px 14px; border: 1px solid #6b3a3a;
    border-radius: 6px; background: #1a1213 }
  .disclosure p { margin: 0 0 10px; color: #f0b46b }
  .artifact { margin-top: 10px; padding: 10px; background: #14171c;
    border: 1px solid #2a2f38; border-radius: 4px; max-height: 320px; overflow: auto;
    white-space: pre-wrap; word-break: break-all }
  .hidden { display: none }
</style>
</head>
<body>
<h1>AUKORA receipt viewer</h1>
<p class="sub">Read-only inspection of one settled operation. Citing this page
changes nothing and settles nothing.</p>
<form id="lookup">
  <input id="digest" name="digest" spellcheck="false" autocomplete="off"
    placeholder="receipt sha256, as the Aura entry records it (64 hex)">
  <button type="submit">Inspect</button>
</form>
<p class="hint">The settlement, the verification verdict and the approval
attribution are reported separately. A settled operation can carry a
NON-CONFORMING document.</p>
<div id="result"></div>
<script>
(function () {
  var form = document.getElementById('lookup')
  var input = document.getElementById('digest')
  var out = document.getElementById('result')

  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = String(text)
    return node
  }

  function rows(pairs) {
    var list = el('dl')
    pairs.forEach(function (pair) {
      list.appendChild(el('dt', null, pair[0]))
      var value = pair[1] === null || pair[1] === undefined ? 'unavailable' : pair[1]
      var dd = el('dd', value === 'unavailable' ? 'unavailable' : null, value)
      list.appendChild(dd)
    })
    return list
  }

  function section(title, body, className) {
    var box = el('section', className)
    box.appendChild(el('h2', null, title))
    if (typeof body === 'string') box.appendChild(el('p', null, body))
    else box.appendChild(body)
    return box
  }

  function render(payload) {
    out.textContent = ''
    if (payload.refusal) {
      out.appendChild(section('Refused', rows([
        ['reason', payload.refusal],
        ['meaning', payload.meaning || 'the read did not reach a result']
      ]), 'refusal'))
    }
    if (payload.settlement) {
      out.appendChild(section('Broker settlement', rows([
        ['state', payload.settlement.state],
        ['sequence', payload.settlement.sequence],
        ['operation', payload.settlement.operation],
        ['subject', payload.settlement.subject],
        ['chain hash', payload.settlement.chainHash]
      ])))
    }
    if (payload.evidence) {
      out.appendChild(section('Evidence availability', rows([
        ['v1 receipt', payload.evidence.v1Available ? 'available' : 'absent'],
        ['v3 export', payload.evidence.v3Available ? 'available' : 'absent'],
        ['v3 read', payload.evidence.v3ReadStatus],
        ['export note', payload.exportRefusal || null]
      ])))
    }
    if (payload.verification) {
      var box = section('Verification verdict', rows([
        ['verdict', null],
        ['approval class', payload.verification.approvalClass],
        ['verbatim export', payload.verification.canExportVerbatim ? 'permitted' : 'forbidden']
      ]))
      var verdict = box.querySelector('dd')
      verdict.textContent = payload.verification.verdict
      verdict.className = 'verdict ' + payload.verification.verdict
      if (payload.verification.reasons.length) {
        var reasons = el('div')
        payload.verification.reasons.forEach(function (reason) {
          reasons.appendChild(el('span', 'reason', reason))
        })
        box.appendChild(reasons)
      }
      if (payload.verification.ceilings.length) {
        box.appendChild(el('h2', null, 'Ceilings'))
        var ceilings = el('ul')
        payload.verification.ceilings.forEach(function (ceiling) {
          ceilings.appendChild(el('li', null, ceiling))
        })
        box.appendChild(ceilings)
      }
      out.appendChild(box)
    }
    if (payload.trustInputs) {
      var list = el('ul')
      payload.trustInputs.forEach(function (row) {
        list.appendChild(el('li', row.status === 'unavailable' ? 'unavailable' : null,
          row.role + ': ' + row.status + (row.keyIds.length ? ' (' + row.keyIds.join(', ') + ')' : '')))
      })
      out.appendChild(section('Trust inputs', list))
    }
    if (payload.limitations) {
      var limits = el('ul')
      payload.limitations.forEach(function (limit) {
        limits.appendChild(el('li', null, limit))
      })
      out.appendChild(section('Named limits', limits))
    }
    if (payload.settlement && payload.settlement.state !== 'unknown') {
      out.appendChild(disclosure())
    }
    if (payload.artifactNote) {
      out.appendChild(section('Export', rows([['result', payload.artifactNote]])))
    }
  }

  function disclosure() {
    var box = el('div', 'disclosure')
    box.appendChild(el('p', null,
      'The original export contains the operation arguments and paths it was computed over, ' +
      'including the value written and the file paths involved. Reading it here is read-only, ' +
      'and saving it copies those bytes to this machine.'))
    var button = el('button', 'danger', 'Read and save the original export')
    var target = el('div', 'hidden')
    button.addEventListener('click', function () {
      button.disabled = true
      target.className = 'artifact'
      target.textContent = 'reading…'
      post('/aukora/receipt/artifact', { receiptSha256: input.value.trim() })
        .then(function (payload) {
          if (!payload.artifact) {
            target.textContent = payload.refusal || 'unavailable'
            return
          }
          var saved = payload.artifact
          target.textContent = saved.bytes
          var link = el('a')
          var blob = new Blob([saved.bytes], { type: saved.mediaType })
          link.href = URL.createObjectURL(blob)
          link.download = saved.receiptSha256 + '.v3.json'
          link.textContent = 'Download ' + saved.receiptSha256.slice(0, 12) + '…v3.json'
          target.appendChild(document.createElement('br'))
          target.appendChild(link)
          target.appendChild(el('div', 'hint',
            'sha256 of these bytes: ' + saved.sha256 + ' — bound to receipt ' + saved.receiptSha256))
        })
        .catch(function (error) { target.textContent = String(error) })
    })
    box.appendChild(button)
    box.appendChild(target)
    return box
  }

  function post(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-aukora-viewer': '1' },
      body: JSON.stringify(body)
    }).then(function (response) { return response.json() })
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault()
    out.textContent = ''
    out.appendChild(el('p', 'hint', 'inspecting…'))
    post('/aukora/receipt/inspect', { receiptSha256: input.value.trim() })
      .then(render)
      .catch(function (error) { render({ refusal: String(error), meaning: 'request failed' }) })
  })
})()
</script>
</body>
</html>
`

/** One parsed viewer request. */
type ViewerRequest =
  | { kind: 'digest'; receiptSha256: string }
  | { kind: 'refusal'; refusal: string; status: number }

/**
 * Read and validate one viewer request.
 *
 * The route answers only well-formed same-origin JSON POSTs. A cross-site form
 * post cannot set a JSON content type or a custom header, so both are required
 * rather than assumed.
 *
 * @param req - the incoming request.
 * @param expectedOrigin - the origin this server is reached on.
 * @returns the parsed request, or a named refusal with its status.
 */
async function readViewerRequest(req: IncomingMessage, expectedOrigin: string): Promise<ViewerRequest> {
  if (req.method !== 'POST') {
    return { kind: 'refusal', refusal: VIEWER_REFUSE.METHOD_NOT_ALLOWED, status: 405 }
  }
  const contentType = req.headers['content-type'] ?? ''
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return { kind: 'refusal', refusal: VIEWER_REFUSE.CONTENT_TYPE_REQUIRED, status: 415 }
  }
  if (req.headers['x-aukora-viewer'] !== '1') {
    return { kind: 'refusal', refusal: VIEWER_REFUSE.HEADER_REQUIRED, status: 403 }
  }
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== expectedOrigin) {
    return { kind: 'refusal', refusal: VIEWER_REFUSE.ORIGIN_NOT_ACCEPTED, status: 403 }
  }
  const body = await readBody(req)
  if (body === null) return { kind: 'refusal', refusal: VIEWER_REFUSE.BODY_TOO_LARGE, status: 413 }
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return { kind: 'refusal', refusal: VIEWER_REFUSE.BODY_UNREADABLE, status: 400 }
  }
  const candidate = typeof parsed === 'object' && parsed !== null && 'receiptSha256' in parsed
    ? (parsed as { receiptSha256: unknown }).receiptSha256
    : undefined
  // The identifier is validated before it is used for a lookup, so a crafted
  // value never reaches the broker or the filesystem.
  if (!isExactReceiptDigest(candidate)) {
    return { kind: 'refusal', refusal: VIEWER_REFUSE.DIGEST_MALFORMED, status: 400 }
  }
  return { kind: 'digest', receiptSha256: candidate }
}

/**
 * Read at most {@link MAX_REQUEST_BYTES} of request body.
 * @param req - the incoming request.
 * @returns the body text, or null when the cap was exceeded.
 */
function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let text = ''
    let size = 0
    let settled = false
    req.on('data', (chunk: Buffer) => {
      if (settled) return
      size += chunk.length
      if (size > MAX_REQUEST_BYTES) {
        settled = true
        // The rest of the body is discarded and the chunk flow is paused, so the
        // connection survives long enough for the caller to read the refusal. A
        // destroyed socket would turn a named rejection into a network error,
        // which a reader cannot tell from an outage.
        req.pause()
        resolve(null)
        return
      }
      text += chunk.toString('utf8')
    })
    req.on('end', () => { if (!settled) { settled = true; resolve(text) } })
    req.on('error', (error) => { if (!settled) { settled = true; reject(error) } })
  })
}

/**
 * Answer one viewer request with a JSON body.
 * @param res - the response to write.
 * @param status - the HTTP status.
 * @param payload - the JSON-serializable body.
 */
function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = `${JSON.stringify(payload)}\n`
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    // No CORS grant: the page is served from this origin, and a cross-origin
    // reader must not be able to read a settlement it did not ask the owner for.
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/**
 * The origin this request arrived on.
 *
 * Derived from the request's own Host header rather than configured, because the
 * guest is launched on an ephemeral port and a configured origin would reject
 * every request the moment the port changed.
 *
 * @param req - the incoming request.
 * @returns the origin string, or null when the Host header is unusable.
 */
function originOf(req: IncomingMessage): string | null {
  const host = req.headers.host
  if (typeof host !== 'string' || host.length === 0) return null
  return `http://${host}`
}

/** What the viewer reports when the broker route is not mounted in this guest. */
function absentRoute(): { refusal: string; meaning: string } {
  return {
    refusal: VIEWER_REFUSE.MEMORY_ROUTE_ABSENT,
    meaning: 'this process has no governed memory route, so nothing can be inspected here',
  }
}

/** What the viewer reports when the broker route exists but cannot be reached. */
function unreachable(error: unknown): { refusal: string; meaning: string } {
  return {
    refusal: VIEWER_REFUSE.BROKER_UNREACHABLE,
    meaning: `the broker route did not answer: ${error instanceof Error ? error.message : String(error)}`,
  }
}

/** The subset of the browser HTTP carrier this viewer registers routes on. */
interface ViewerRouteHost {
  register(route: { kind: 'exact'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void
}

/**
 * Register the receipt viewer on one context.
 *
 * @param ctx - Cordis context carrying the web server and the governed memory route.
 * @param webServer - the browser HTTP carrier the page and its endpoints land on.
 */
export function mountReceiptView(ctx: Context, webServer: ViewerRouteHost): void {
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: RECEIPT_VIEW_PATH,
    handler: (_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        // The page loads no external resource, so it may not be framed, its
        // forms may not post elsewhere, and no script or style may be injected.
        'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        'x-content-type-options': 'nosniff',
      })
      res.end(PAGE)
    },
  }), 'aukora receipt-view: page')

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: `${RECEIPT_VIEW_PATH}/inspect`,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      await answer(ctx, req, res, false)
    },
  }), 'aukora receipt-view: inspect')

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: `${RECEIPT_VIEW_PATH}/artifact`,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      await answer(ctx, req, res, true)
    },
  }), 'aukora receipt-view: artifact')
}

/**
 * Answer one inspection request from the broker route.
 *
 * @param ctx - context carrying the governed memory route.
 * @param req - the incoming request.
 * @param res - the response to write.
 * @param includeArtifact - whether this request asked for the original bytes.
 */
async function answer(
  ctx: Context,
  req: IncomingMessage,
  res: ServerResponse,
  includeArtifact: boolean,
): Promise<void> {
  const origin = originOf(req)
  if (origin === null) {
    sendJson(res, 400, { refusal: VIEWER_REFUSE.ORIGIN_NOT_ACCEPTED, meaning: 'the request carried no usable host' })
    return
  }
  const parsed = await readViewerRequest(req, origin)
  if (parsed.kind === 'refusal') {
    sendJson(res, parsed.status, { refusal: parsed.refusal, meaning: 'the request was not a well-formed inspection request' })
    return
  }
  const provider = ctx.get('aukora.memory') as GovernedMemoryService | undefined
  if (provider === undefined) {
    sendJson(res, 503, absentRoute())
    return
  }
  let result: ReceiptInspection
  try {
    result = await provider.inspectReceipt(parsed.receiptSha256, AbortSignal.timeout(10_000), includeArtifact)
  } catch (error) {
    sendJson(res, 502, unreachable(error))
    return
  }
  // A refusal is a result, not an error, and keeps its named reason.
  sendJson(res, 200, result)
}

/**
 * The receipt viewer as a Cordis plugin.
 *
 * Both dependencies are load-bearing: a viewer with no web server has no page,
 * and one with no memory route would report every read as unreachable rather
 * than showing a settlement.
 */
export class ReceiptViewService extends Service {
  static inject = ['webServer', 'aukora.memory']

  constructor(ctx: Context) {
    super(ctx, 'aukora.receiptView')
    mountReceiptView(ctx, ctx.get('webServer') as unknown as ViewerRouteHost)
  }
}

/**
 * Digest one artifact's bytes the way the viewer labels a saved file.
 *
 * Exported so a caller outside the browser can check a saved export against the
 * digest the inspection returned, rather than trusting the page's own statement.
 *
 * @param bytes - the artifact bytes as the inspection returned them.
 * @returns the lowercase hex sha256 of those bytes.
 */
export function artifactDigest(bytes: string): string {
  return createHash('sha256').update(bytes, 'utf8').digest('hex')
}

export default ReceiptViewService
