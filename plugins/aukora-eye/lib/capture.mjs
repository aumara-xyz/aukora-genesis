/**
 * THE CALLER SIDE OF THE EYE: ask the shell for a photograph.
 *
 * The shell listens on loopback and hands its port and token to this process in the environment
 * (`AUKORA_EYE_URL`, `AUKORA_EYE_TOKEN`) — never on a command line, never in a file. This module
 * reads that pair, refuses anything that is not loopback before a byte leaves the process, and turns
 * the door's named refusals into named refusals here. There is no fallback path: an unconfigured eye
 * is `eye.not-configured`, which is the honest answer when the shell that owns the window has not
 * opened one.
 *
 * @module @aukora/dsh-plugin-eye/capture
 */

import { readPngSize } from './png.mjs'

/** Environment variable names the shell writes into this process's environment. */
export const EYE_ENV = Object.freeze({
  URL: 'AUKORA_EYE_URL',
  TOKEN: 'AUKORA_EYE_TOKEN',
})

/** Named refusals, so a caller (and a model) can tell them apart instead of reading a sentence. */
export const EYE_CAPTURE_REFUSE = Object.freeze({
  NOT_CONFIGURED: 'eye.not-configured',
  NOT_LOOPBACK: 'eye.not-loopback',
  UNREACHABLE: 'eye.unreachable',
  REFUSED: 'eye.refused',
  NOT_AN_IMAGE: 'eye.not-an-image',
})

/** Raised for every refusal, carrying the door's own code when the door is the one refusing. */
export class EyeError extends Error {
  /**
   * @param message - what happened, in one sentence.
   * @param code - a stable code.
   * @param detail - the door's message, when the door refused.
   */
  constructor(message, code, detail) {
    super(message)
    this.name = 'EyeError'
    this.code = code
    if (detail !== undefined) this.detail = detail
  }
}

/**
 * Whether a URL names this machine.
 *
 * The token is sent to this address, so a URL that resolves anywhere else would hand the key to a
 * stranger's listener. Checked here as well as at the door, because the door's fence cannot help a
 * caller that was pointed at the wrong host.
 * @param value - the candidate URL.
 * @returns true when its host is loopback.
 */
export function isLoopbackUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]' || url.hostname === '::1')
  } catch {
    return false
  }
}

/**
 * Read the eye's address and token from the environment.
 * @param env - the process environment (injected for tests).
 * @returns the configuration, or a refusal.
 */
export function readEyeConfig(env = process.env) {
  const url = typeof env[EYE_ENV.URL] === 'string' ? env[EYE_ENV.URL].trim() : ''
  const token = typeof env[EYE_ENV.TOKEN] === 'string' ? env[EYE_ENV.TOKEN].trim() : ''
  if (url === '' || token === '') {
    return { ok: false, code: EYE_CAPTURE_REFUSE.NOT_CONFIGURED }
  }
  if (!isLoopbackUrl(url)) {
    return { ok: false, code: EYE_CAPTURE_REFUSE.NOT_LOOPBACK }
  }
  return { ok: true, url: url.replace(/\/+$/u, ''), token }
}

/**
 * Ask the shell for one capture.
 *
 * @param options - the request.
 * @param {string} options.url - the door's loopback base URL.
 * @param {string} options.token - the per-launch token.
 * @param {{x: number, y: number, width: number, height: number}} [options.rect] - window pixels.
 * @param {number} [options.scale] - a multiplier applied to the door's width ceiling.
 * @param {AbortSignal} [options.signal] - caller cancellation.
 * @param {typeof fetch} [options.fetchImpl] - injected for tests; defaults to the global.
 * @returns the capture: PNG bytes, the size the door returned, and the size it came from.
 */
export async function captureFromEye({ url, token, rect, scale, signal, fetchImpl = fetch }) {
  if (!isLoopbackUrl(url)) {
    throw new EyeError(`refusing to send the eye token to ${url}: it is not loopback`, EYE_CAPTURE_REFUSE.NOT_LOOPBACK)
  }
  const body = {}
  if (rect !== undefined) body.rect = rect
  if (scale !== undefined) body.scale = scale

  let response
  try {
    response = await fetchImpl(`${url}/eye/capture`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    throw new EyeError(`the shell's eye did not answer at ${url}: ${String(error?.message ?? error)}`, EYE_CAPTURE_REFUSE.UNREACHABLE)
  }

  if (!response.ok) {
    // The door speaks JSON for every refusal, with a code. Pass the code through unchanged: the
    // caller's vocabulary and the door's are the same vocabulary, by design.
    let detail
    let code = EYE_CAPTURE_REFUSE.REFUSED
    try {
      const parsed = await response.json()
      detail = typeof parsed?.detail === 'string' ? parsed.detail : undefined
      if (typeof parsed?.code === 'string') code = parsed.code
    } catch {
      detail = `HTTP ${response.status}`
    }
    throw new EyeError(`the eye refused the capture: ${code}${detail === undefined ? '' : ` (${detail})`}`, code, detail)
  }

  const png = new Uint8Array(await response.arrayBuffer())
  let size
  try {
    size = readPngSize(png)
  } catch (error) {
    throw new EyeError(`the eye returned bytes that are not a PNG: ${String(error?.message ?? error)}`, EYE_CAPTURE_REFUSE.NOT_AN_IMAGE)
  }
  const sourceWidth = Number(response.headers.get('x-eye-source-width') ?? size.width)
  const sourceHeight = Number(response.headers.get('x-eye-source-height') ?? size.height)
  return {
    png,
    width: size.width,
    height: size.height,
    sourceWidth,
    sourceHeight,
    scale: size.width === 0 || sourceWidth === 0 ? null : Number((size.width / sourceWidth).toFixed(4)),
    capturedAt: new Date().toISOString(),
  }
}
