/** Same-origin reader for the parent-supplied AUMLOK control projection. */
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import {
  AUMLOK_CONTROL_STATUS_ENDPOINT,
  parseAumlokNotConnectedBody,
} from '../control-projection.ts'
import type { AumlokControlProjectionService } from './control-projection.ts'

type StatusFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>

/**
 * Refreshes one generation-scoped AUMLOK status projection from the local page origin.
 * Every refresh disconnects first; aborted or superseded reads cannot restore stale status.
 */
export class AumlokControlStatusLoader {
  private controller: AbortController | undefined
  private disposed = false

  /**
   * @param projection - browser-owned validated projection service.
   * @param connection - page connection facts used to refuse non-loopback reads.
   * @param fetchStatus - same-origin HTTP reader; defaults to the browser fetch implementation.
   */
  constructor(
    private readonly projection: AumlokControlProjectionService,
    private readonly connection: Pick<ConnectionHandle, 'isLoopback'>,
    private readonly fetchStatus: StatusFetch = (input, init) => globalThis.fetch(input, init),
  ) {}

  private stale(controller: AbortController): boolean {
    return controller.signal.aborted
  }

  /**
   * Drop the current projection and attempt one fresh loopback read.
   * Network, HTTP, media-type, and validation failures leave the service disconnected.
   * @returns after the current generation either connects or remains disconnected.
   */
  async refresh(): Promise<void> {
    this.controller?.abort()
    this.projection.disconnect()
    if (this.disposed || !this.connection.isLoopback) return
    const controller = new AbortController()
    this.controller = controller
    try {
      const response = await this.fetchStatus(AUMLOK_CONTROL_STATUS_ENDPOINT, {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      })
      if (this.stale(controller)) return
      const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim()
      if (response.status === 404 && mediaType === 'application/json') {
        // The host names WHICH absence this is — no controller service in the
        // composition, a controller mounted with no directory, or a directory that
        // could not be read — and carries the controller's own code when there was
        // one. Anything the parser does not recognise stays a bare absence rather
        // than being rounded to the nearest known reason.
        const body = parseAumlokNotConnectedBody(await response.json())
        if (!this.stale(controller)) this.projection.disconnect(body?.reason, body?.code, body?.detail)
        return
      }
      if (response.status !== 200 || mediaType !== 'application/json') return
      const value: unknown = await response.json()
      if (this.stale(controller)) return
      this.projection.connect(value)
    } catch {
      // Absence, transport failure, and invalid JSON all mean disconnected.
    }
  }

  /** Permanently stop reads and remove any visible status. */
  dispose(): void {
    this.disposed = true
    this.controller?.abort()
    this.controller = undefined
    this.projection.disconnect()
  }
}
