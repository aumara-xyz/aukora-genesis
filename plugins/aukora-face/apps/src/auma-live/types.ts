import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PresenceProviderRouting } from './presence.ts'

/** One secret-free message sent to the Auma Live model provider. */
export interface AumaLiveRequestMessage {
  /** Provider chat role. */
  readonly role: 'system' | 'user' | 'assistant'
  /** Exact model-visible text. */
  readonly content: string
}

/** Exact secret-free Auma Live request recorded before provider dispatch. */
export interface AumaLiveModelRequest {
  /** Session selected when the live turn began. */
  readonly sessionId: SessionId
  /** Fully resolved provider endpoint. */
  readonly endpoint: string
  /** Exact JSON body sent to the provider. */
  readonly body: {
    /** Provider model id selected by the live mind control. */
    readonly model: string
    /** Maximum generated tokens. */
    readonly max_tokens: number
    /** Whether the provider returns an event stream. */
    readonly stream: true
    /** Complete ordered model-visible history. */
    readonly messages: readonly AumaLiveRequestMessage[]
    /** Optional provider reasoning control. */
    readonly reasoning?: { readonly enabled: false }
    /** Ollama's reasoning-off control, for a reasoning model on a private endpoint. */
    readonly think?: false
    /**
     * Chat-template rendering controls. `enable_thinking: false` is how an
     * OpenAI-compatible inference server is told to render the turn without a
     * reasoning channel; a server that honors this ignores `think`.
     */
    readonly chat_template_kwargs?: { readonly enable_thinking: false }
    /**
     * Provider routing controls, present only for a mind whose endpoint accepts them.
     *
     * **THE SAME TYPE THE MINDS DECLARE, IMPORTED RATHER THAN COPIED.** This was a hand-written duplicate, and it
     * still said `allow_fallbacks: true` while `presence.ts` had moved to `false` with `data_collection` and `zdr` —
     * **so the wire body would have carried the fallback permission the privacy change had just removed**, and the
     * build refused it. **Two copies of a policy drift, and the one that ships is whichever the encoder reads** —
     * the same lesson written into `OPENROUTER_DATA_POLICY`'s own doc, found one file over.
     *
     * A type-only import is erased at compile time, so this introduces no runtime edge back from `presence.ts`.
     */
    readonly provider?: PresenceProviderRouting
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Secret-free Auma Live model request recorded and flushed before dispatch. */
    'auma-live/model-request': AumaLiveModelRequest
  }
}
