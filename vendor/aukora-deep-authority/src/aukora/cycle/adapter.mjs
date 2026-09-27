/**
 * Minimal single-attempt adapter to the verified Ollama chat route.
 *
 * This is the isolated test adapter around the existing provider route that
 * the running Nebius VM exposes over the loopback tunnel; it imports none of
 * the voice lane. One call transports one prompt, observes the exact reply,
 * and reports a closed result — completed, truncated, or failed — without
 * retrying. Truncation (`done_reason: length`) is a failure, not a partial
 * answer. The adapter never decides actions and never injects evidence; it
 * only moves the validated prompt to the provider and observes what comes
 * back.
 *
 * @module @aukora/core/cycle/adapter
 */

/** Closed per-request observation states. */
export const ADAPTER_RESULT_STATES = Object.freeze(['completed', 'truncated', 'failed'])

const MAX_REPLY_BYTES = 64 * 1024
const DEFAULT_TIMEOUT_MS = 45_000

/** A named adapter refusal for caller-side configuration errors. */
export class CycleAdapterError extends Error {
  /** Stable machine-readable refusal code. */
  code

  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(`cycle.adapter: ${message}`)
    this.name = 'CycleAdapterError'
    this.code = `cycle.adapter:${code}`
  }
}

/**
 * Transport one prompt to the provider exactly once and observe the reply.
 *
 * The route is the provider's native chat endpoint with JSON-only decoding
 * and thinking disabled, mirroring the controls the production presence
 * lane applies to this model family. The single attempt is not retried here.
 *
 * @param {{endpoint: string, model: string, maxOutputTokens: number, timeoutMs?: number, fetchImpl?: typeof fetch, signal?: AbortSignal}} options
 *   verified provider route, exact model identity, the frozen output cap, and
 *   the caller's lifetime signal. The single attempt is not retried here.
 * @param {{system: string, user: string}} prompt - byte-stable prompt.
 * @returns {Promise<{status: 'completed' | 'truncated' | 'failed', reason?: string, content?: string, finishReason?: string | null, inputBytes: number, outputBytes: number, wallMs: number}>}
 *   the closed observation: content only on completion, `truncated` when the
 *   provider hit the output cap, `failed` with a reason for transport,
 *   timeout, status, or shape failures.
 */
export async function proposeOnce(options, prompt) {
  const {
    endpoint,
    model,
    maxOutputTokens,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = fetch,
    signal,
  } = options
  if (typeof endpoint !== 'string' || endpoint === '' || typeof model !== 'string' || model === '') {
    throw new CycleAdapterError('configuration-invalid', 'endpoint and model must be non-empty strings')
  }
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1) {
    throw new CycleAdapterError('configuration-invalid', 'maxOutputTokens must be a positive integer')
  }
  if (typeof prompt?.system !== 'string' || typeof prompt?.user !== 'string') {
    throw new CycleAdapterError('prompt-invalid', 'prompt must carry system and user strings')
  }
  const body = {
    model,
    stream: false,
    think: false,
    format: 'json',
    options: { num_predict: maxOutputTokens },
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
  }
  const startedAt = Date.now()
  const inputBytes = Buffer.byteLength(JSON.stringify(body), 'utf8')
  const requestSignal = AbortSignal.timeout(timeoutMs)
  const combined = signal === undefined ? requestSignal : AbortSignal.any([signal, requestSignal])
  let upstream
  try {
    upstream = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: combined,
    })
  } catch {
    return {
      status: 'failed',
      reason: combined.aborted && signal?.aborted ? 'cancelled' : 'network',
      inputBytes,
      outputBytes: 0,
      wallMs: Date.now() - startedAt,
    }
  }
  const text = await readBounded(upstream, MAX_REPLY_BYTES)
  const wallMs = Date.now() - startedAt
  if (text === null) {
    return { status: 'failed', reason: `upstream-${String(upstream.status)}`, inputBytes, outputBytes: 0, wallMs }
  }
  const outputBytes = Buffer.byteLength(text, 'utf8')
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { status: 'failed', reason: 'reply-not-json', inputBytes, outputBytes, wallMs }
  }
  const message = readReply(parsed)
  if (message === null) {
    return { status: 'failed', reason: 'reply-malformed', inputBytes, outputBytes, wallMs }
  }
  if (message.doneReason === 'length') {
    return { status: 'truncated', finishReason: 'length', inputBytes, outputBytes, wallMs }
  }
  if (typeof message.content !== 'string' || message.content === '') {
    return { status: 'failed', reason: 'reply-empty', finishReason: message.doneReason, inputBytes, outputBytes, wallMs }
  }
  return {
    status: 'completed',
    content: message.content,
    finishReason: message.doneReason,
    inputBytes,
    outputBytes,
    wallMs,
  }
}

/** Read the upstream body within the byte ceiling; null means too large. */
async function readBounded(upstream, limit) {
  let total = 0
  try {
    const chunks = []
    for await (const chunk of upstream.body ?? []) {
      total += chunk.length
      if (total > limit) return null
      chunks.push(chunk)
    }
    return Buffer.concat(chunks).toString('utf8')
  } catch {
    return null
  }
}

/** Read the assistant message fields without invoking accessors. */
function readReply(parsed) {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const message = parsed.message
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return null
  const content = message.content
  if (content === undefined) return null
  const doneReason = typeof parsed.done_reason === 'string' ? parsed.done_reason : null
  return { content, doneReason }
}
