/** Browser-owned observable store for validated AUMLOK control status. */
import { Service, type Context } from '@deepseek-ai/cordis'
import {
  createSnapshotStore,
  type SnapshotStore,
} from '@deepseek-ai/dsh-client-store'
import {
  parseAumlokControl,
  type AumlokControlProjection,
  type AumlokNotConnectedReason,
} from '../control-projection.ts'
import {
  drawAumlokPhrase,
  submitAumlokPhrase,
  type AumlokCeremonyBridge,
  type AumlokCeremonyIntent,
  type AumlokCeremonyResult,
  type AumlokDrawnPhrase,
} from './binding-bridge.ts'

export {
  AUMLOK_CONTROL_STATUS_ENDPOINT,
  AUMLOK_LOCAL_CUSTODY_CLASS,
  AUMLOK_PUBLIC_CONTROL_DOMAIN,
  aumlokNotConnected,
  parseAumlokControlProjection,
  parseAumlokNotConnectedBody,
} from '../control-projection.ts'
export type { AumlokControlProjection, AumlokNotConnectedReason } from '../control-projection.ts'
export {
  drawAumlokPhrase,
  parseAumlokCeremonyResult,
  parseAumlokDrawnPhrase,
  readAumlokCeremonyBridge,
  submitAumlokPhrase,
} from './binding-bridge.ts'
export type {
  AumlokCeremonyBridge,
  AumlokCeremonyIntent,
  AumlokCeremonyResult,
  AumlokDrawnPhrase,
} from './binding-bridge.ts'

/**
 * Complete read-only state consumed by the AUMLOK surface.
 *
 * `reason` is which absence this is, and `code` is the controller's own refusal string
 * when it produced one. Both are carried because they answer different questions: the
 * reason tells an operator what to do, and the code is the system's own words, which
 * the screen quotes rather than paraphrases.
 */
export type AumlokControlProjectionState =
  | {
    readonly status: 'not-connected'
    readonly reason?: AumlokNotConnectedReason
    readonly code?: string
    /**
     * THE SENTENCE THE CONTROLLER WROTE, carried to the screen rather than paraphrased.
     *
     * `code` answers "what does the system call this"; `detail` answers "what do I do about it", and for
     * a record naming several machines the detail is the only text that names the argument that answers.
     * MEASURED before this: the screen was given the code and nothing else.
     */
    readonly detail?: string
  }
  | { readonly status: 'connected'; readonly control: Readonly<AumlokControlProjection> }

/** Stable disconnected snapshot shared by every projection store. */
export const AUMLOK_CONTROL_NOT_CONNECTED = Object.freeze({
  status: 'not-connected',
} as const satisfies AumlokControlProjectionState)

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Browser-only read model for parent-reported AUMLOK control metadata. */
    aumlokControlProjection: AumlokControlProjectionService
  }
}

/** Browser-owned store populated only by a parent-status transport adapter. */
export class AumlokControlProjectionService extends Service {
  /** Observable source injected into the AUMLOK surface. */
  readonly store: SnapshotStore<AumlokControlProjectionState> =
    createSnapshotStore<AumlokControlProjectionState>(AUMLOK_CONTROL_NOT_CONNECTED)

  private ceremony: AumlokCeremonyBridge | undefined

  /**
   * @param ctx - owning client context.
   */
  constructor(ctx: Context) {
    super(ctx, 'aumlokControlProjection')
  }

  /**
   * Attach the desktop shell's ceremony bridge, when this launch has one.
   *
   * The ceremony and the STATUS it changes are two halves of one subject, which is why
   * the bridge is held here rather than in a second service: the surface that decides
   * between UNBOUND and BOUND is the surface that draws the words and hands them back,
   * and it does both through the same read model it renders. An absent bridge is the
   * plain-browser case and stays absent — no button, and no ceremony to run.
   * @param bridge - the bounded bridge read from the page, or undefined in a plain browser.
   */
  attachCeremony(bridge: AumlokCeremonyBridge | undefined): void {
    this.ceremony = bridge
  }

  /** Whether a ceremony can be run at all in this launch. */
  get ceremonyAvailable(): boolean {
    return this.ceremony !== undefined
  }

  /**
   * Ask the shell for one phrase, which the screen shows once.
   *
   * THE WORDS PASS THROUGH AND ARE NOT KEPT. This method returns them to its caller, which is the
   * surface that displays them, and holds no copy of its own: a refusal is a refusal and never an
   * empty phrase, so a failed draw cannot put a blank screen where words belong.
   * @param intent - draw for a first binding, or for a refresh of a bound one.
   * @returns the seven words, or the shell's own refusal.
   */
  async drawPhrase(intent: AumlokCeremonyIntent): Promise<AumlokDrawnPhrase> {
    if (this.ceremony === undefined) return { ok: false, reason: 'aumlok:no-ceremony-bridge' }
    return drawAumlokPhrase(this.ceremony, intent)
  }

  /**
   * Hand the typed words back and wait for the shell's verdict.
   *
   * THIS METHOD KEEPS NOTHING EITHER, and the caller owns the decision to re-read the status, so that
   * a refusal cannot silently re-render the screen.
   * @param intent - which ceremony the words belong to.
   * @param words - the seven typed words, in order, anchor first.
   * @param handle - the person's PUBLIC handle, as typed, on the ceremony that asks for it (X8). It is
   *   half of the key and it is passed straight through; this service keeps nothing.
   * @returns the shell's verdict, never a claim this screen made up.
   */
  async submitPhrase(intent: AumlokCeremonyIntent, words: readonly string[],
    handle?: string): Promise<AumlokCeremonyResult> {
    if (this.ceremony === undefined) return { ok: false, reason: 'aumlok:no-ceremony-bridge' }
    return submitAumlokPhrase(this.ceremony, intent, words, handle)
  }

  /**
   * Replace the visible status with an exact parent-reported projection.
   * Invalid input first disconnects the view so stale identity cannot remain visible.
   * @param input - candidate transport value.
   */
  connect(input: unknown): void {
    let control: Readonly<AumlokControlProjection>
    try {
      // THE WIRE CARRIES THE STATE, SO THE STATE IS WHAT ARRIVES. The status route answers
      // `{status:'connected', control}` for a bound machine; a bare record is still accepted because
      // the same store is fed by callers that hold one. EITHER RECORD SHAPE is then normalised:
      // `parseAumlokControl` takes the v1 public control and the v3 record, because a bound directory
      // holds one or the other. Anything unrecognised still disconnects the view, so stale identity
      // cannot remain visible.
      const envelope = input !== null && typeof input === 'object' && !Array.isArray(input)
        ? (input as { status?: unknown; control?: unknown })
        : undefined
      const body = envelope?.status === 'connected' ? envelope.control : input
      control = parseAumlokControl(body)
    } catch (error) {
      this.disconnect()
      throw error
    }
    this.store.set(Object.freeze({ status: 'connected', control }))
  }

  /**
   * Remove parent status from the browser read model.
   * @param reason - which absence this is, when the host names one.
   * @param code - the controller's own refusal code, when it produced one.
   */
  disconnect(reason?: AumlokNotConnectedReason, code?: string, detail?: string): void {
    if (reason === undefined) {
      this.store.set(AUMLOK_CONTROL_NOT_CONNECTED)
      return
    }
    // ABSENT FIELDS ARE ABSENT, as in the host's builder: a court compares states whole, and a
    // `detail: undefined` that serialises away would make the in-process shape disagree with the wire.
    this.store.set(Object.freeze({
      status: 'not-connected' as const,
      reason,
      ...(code === undefined ? {} : { code }),
      ...(detail === undefined || detail === '' ? {} : { detail }),
    }))
  }
}
