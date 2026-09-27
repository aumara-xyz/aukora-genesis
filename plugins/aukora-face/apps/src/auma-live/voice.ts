// SPDX-License-Identifier: AGPL-3.0-or-later
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import WebSocket, { WebSocketServer } from 'ws'
import { isTrustedLocalRequest } from './http.ts'
// THE SIDECAR SUPERVISOR AND ITS LOG SINK LIVE IN THEIR OWN MODULE. They are re-exported here because every
// caller already imports this file, and they were MOVED rather than copied: `ws` does not resolve from the
// repository root, and a module that cannot be imported cannot be run by a court.
export {
  VoiceSidecarSupervisor,
  voiceEnvironment,
  voiceLogger,
  VOICE_LOG_PREFIX,
} from './voice-sidecar.ts'
export type { VoiceSidecarConfig, VoiceSupervisorDependencies } from './voice-sidecar.ts'

const MAX_QUEUED_BYTES = 2 * 1024 * 1024
const MAX_RETIRED_VOICE_OWNERS = 64
const VOICE_OWNER_PATTERN = /^\d{13}:[A-Za-z0-9][A-Za-z0-9._-]{7,79}:\d{6,10}$/

declare const voiceOwnerTokenBrand: unique symbol
type VoiceOwnerToken = string & { readonly [voiceOwnerTokenBrand]: true }

type VoiceOwnerRequest =
  | { kind: 'explicit'; token: VoiceOwnerToken }
  | { kind: 'invalid' }

interface VoiceBridge {
  browser: WebSocket
  upstream: WebSocket
  closed: boolean
}

interface VoiceOwnerLease {
  bridge: VoiceBridge
  token: VoiceOwnerToken
}

/** Same-origin WebSocket bridge with one host-enforced explicit voice owner. */
export class VoiceWebSocketProxy {
  private readonly server = new WebSocketServer({ noServer: true, maxPayload: MAX_QUEUED_BYTES })
  private readonly bridges = new Set<VoiceBridge>()
  private readonly retiredOwnerTokens = new Set<VoiceOwnerToken>()
  private ownerLease: VoiceOwnerLease | undefined

  /** @param port - Private loopback sidecar port. */
  constructor(private readonly port: number) {}

  /**
   * Accept a trusted browser upgrade and relay frames bidirectionally.
   * Every upgrade requires an explicit owner token. A new token supersedes the current bridge by server arrival order.
   * The current token always reconnects, superseding its own bridge — the
   * token is minted per page mount and known only to that page, so a
   * same-token upgrade is the same claimant returning after a transport its
   * peer never noticed dying (a slept machine, a dropped socket). Recently
   * displaced tokens cannot reconnect.
   * @param req - Browser upgrade request.
   * @param socket - Raw socket transferred by the target webserver.
   * @param head - Bytes read beyond the HTTP upgrade headers.
   */
  handle(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (!isTrustedLocalRequest(req)) {
      rejectUpgrade(socket, 403, 'forbidden')
      return
    }
    const ownerRequest = parseVoiceOwner(req)
    if (ownerRequest.kind === 'invalid') {
      rejectUpgrade(socket, 400, 'invalid voice owner')
      return
    }
    if (!this.accepts(ownerRequest.token)) {
      rejectUpgrade(socket, 409, 'voice owner active')
      return
    }
    this.server.handleUpgrade(req, socket, head, (browser) => {
      if (!this.accepts(ownerRequest.token)) {
        browser.close(1008, 'voice owner active')
        return
      }
      for (const bridge of this.bridges) {
        const sameOwner = this.ownerLease?.bridge === bridge && this.ownerLease.token === ownerRequest.token
        this.closeBridge(bridge, sameOwner ? 4000 : 4001, sameOwner ? 'voice owner reconnected' : 'voice owner replaced', !sameOwner)
      }
      const upstream = new WebSocket(`ws://127.0.0.1:${String(this.port)}/ws`, {
        maxPayload: MAX_QUEUED_BYTES,
      })
      const bridge: VoiceBridge = {
        browser,
        upstream,
        closed: false,
      }
      this.bridges.add(bridge)
      this.ownerLease = { bridge, token: ownerRequest.token }
      let queuedBytes = 0
      const queued: Array<{ data: WebSocket.RawData; binary: boolean }> = []
      const closeBoth = (): void => { this.closeBridge(bridge) }
      browser.on('message', (data, binary) => {
        if (bridge.closed) return
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(data, { binary })
          return
        }
        const bytes = Array.isArray(data)
          ? data.reduce((sum, chunk) => sum + chunk.byteLength, 0)
          : data.byteLength
        queuedBytes += bytes
        if (queuedBytes > MAX_QUEUED_BYTES) {
          browser.close(1009, 'voice startup queue exceeded')
          return
        }
        queued.push({ data, binary })
      })
      upstream.once('open', () => {
        if (bridge.closed) return
        for (const frame of queued) upstream.send(frame.data, { binary: frame.binary })
        queued.length = 0
      })
      upstream.on('message', (data, binary) => {
        if (!bridge.closed && browser.readyState === WebSocket.OPEN) browser.send(data, { binary })
      })
      browser.once('close', closeBoth)
      browser.once('error', closeBoth)
      upstream.once('close', closeBoth)
      upstream.once('error', closeBoth)
    })
  }

  private accepts(token: VoiceOwnerToken): boolean {
    return !this.retiredOwnerTokens.has(token)
  }

  private closeBridge(bridge: VoiceBridge, code = 1000, reason = '', retireOwner = false): void {
    if (bridge.closed) return
    bridge.closed = true
    this.bridges.delete(bridge)
    if (this.ownerLease?.bridge === bridge) {
      if (retireOwner) this.retireOwnerToken(this.ownerLease.token)
      this.ownerLease = undefined
    }
    closeWebSocket(bridge.browser, code, reason)
    terminateWebSocket(bridge.upstream)
  }

  private retireOwnerToken(token: VoiceOwnerToken): void {
    this.retiredOwnerTokens.add(token)
    if (this.retiredOwnerTokens.size <= MAX_RETIRED_VOICE_OWNERS) return
    const oldest = this.retiredOwnerTokens.values().next().value
    if (oldest !== undefined) this.retiredOwnerTokens.delete(oldest)
  }

  /**
   * Terminate all bridged sockets and close the no-server acceptor.
   * @returns Promise settled when the proxy owns no sockets.
   */
  async close(): Promise<void> {
    for (const bridge of this.bridges) this.closeBridge(bridge)
    this.ownerLease = undefined
    for (const socket of this.server.clients) socket.terminate()
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    })
  }
}

function parseVoiceOwner(req: IncomingMessage): VoiceOwnerRequest {
  const authority = req.headers.host
  if (authority === undefined) return { kind: 'invalid' }
  let values: string[]
  try {
    values = new URL(req.url ?? '/', `http://${authority}`).searchParams.getAll('owner')
  } catch {
    return { kind: 'invalid' }
  }
  if (values.length === 0) return { kind: 'invalid' }
  const value = values[0]
  if (values.length !== 1 || value === undefined || !VOICE_OWNER_PATTERN.test(value)) {
    return { kind: 'invalid' }
  }
  return { kind: 'explicit', token: value as VoiceOwnerToken }
}

function closeWebSocket(socket: WebSocket, code = 1000, reason = ''): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.close(code, reason)
    return
  }
  if (socket.readyState === WebSocket.CONNECTING) socket.terminate()
}

function terminateWebSocket(socket: WebSocket): void {
  if (socket.readyState !== WebSocket.CLOSED) socket.terminate()
}

function rejectUpgrade(socket: Duplex, status: 400 | 403 | 409, body: string): void {
  const statusText = status === 400 ? 'Bad Request' : status === 403 ? 'Forbidden' : 'Conflict'
  socket.end([
    `HTTP/1.1 ${String(status)} ${statusText}`,
    'Connection: close',
    'Content-Type: text/plain; charset=utf-8',
    `Content-Length: ${String(Buffer.byteLength(body))}`,
    '',
    body,
  ].join('\r\n'))
}
