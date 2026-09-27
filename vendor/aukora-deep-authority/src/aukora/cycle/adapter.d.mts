/** Closed per-request observation states. */
export declare const ADAPTER_RESULT_STATES: readonly ['completed', 'truncated', 'failed']

/** A named adapter refusal for caller-side configuration errors. */
export declare class CycleAdapterError extends Error {
  /** Stable machine-readable refusal code. */
  readonly code: string
  constructor(code: string, message: string)
}

/**
 * Transport one prompt to the provider exactly once and observe the reply.
 * Truncation is a failure; the single attempt is never retried here.
 */
export declare function proposeOnce(options: {
  endpoint: string
  model: string
  maxOutputTokens: number
  timeoutMs?: number
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}, prompt: { system: string; user: string }): Promise<Readonly<{
  status: 'completed' | 'truncated' | 'failed'
  reason?: string
  content?: string
  finishReason?: string | null
  inputBytes: number
  outputBytes: number
  wallMs: number
}>>
