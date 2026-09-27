// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Read-only internet lens for the Auma Live presence mind, the sibling of the
 * repository lens. It answers one model-authored search and renders sources as
 * speakable lines — no markdown, no link syntax, nothing a voice would read
 * aloud as punctuation.
 *
 * Search only. There is deliberately no fetch arm: a lane that retrieves an
 * arbitrary URL on a spoken phrase is a request forgery surface onto whatever
 * the Host can reach, and this lane exists to look, not to reach.
 */
import { createHash } from 'node:crypto'
import type { WebRuntime } from '@deepseek-ai/dsh-web'

/** Lens construction settings. */
export interface WebLensConfig {
  /**
   * Resolve the web seam at call time. The presence lane must load on a Host
   * that mounts no web provider, so this is looked up per lookup rather than
   * injected.
   */
  resolve(): WebRuntime | undefined
  /** Upper bound on sources rendered into one answer. */
  maxResults: number
  /** Deadline for one search; a spoken turn cannot wait on a tool timeout. */
  timeoutMs: number
  /** Character cap for the rendered answer. */
  maxAnswerChars: number
}

/** One lens answer, ready to frame into a model message. */
export interface WebLensResult {
  /** The query exactly as the model wrote it. */
  request: string
  /** Speakable source lines, or a one-line refusal the model can say aloud. */
  text: string

  /**
   * **SHA-256 OVER EXACTLY `text`, HEX — THE DIGEST THE ATTENTION VIEW SHOWS AND WILL NOT INVENT.**
   *
   * AK-UI, on the per-reply manifest: *"a wrong digest makes the attention view answer confidently and wrongly."* The
   * digest is taken **where the bytes are**, by the component holding them — **not re-read later by the engine, where a
   * second read is a second chance to read something else.**
   *
   * **REQUIRED RATHER THAN OPTIONAL, DELIBERATELY:** `exactOptionalPropertyTypes` would let an absent field pass as
   * `undefined`, and a manifest item whose digest is quietly missing is the invented digest by another route.
   */
  sha256: string
}

/** Longest query accepted; a spoken search phrase is never longer than this. */
const MAX_QUERY_CHARS = 300

/** Bounded, search-only internet reads for the presence mind. */
export class WebLens {
  /** @param config - Seam resolver and bounds. */
  constructor(private readonly config: WebLensConfig) {}

  /**
   * Answer one model-authored search.
   * @param request - The query the model asked for.
   * @returns The query echoed with speakable results or a refusal.
   */
  /**
   * Answer one lens request, **WITH A DIGEST OVER THE TEXT IT RETURNS.**
   *
   * **THE WRAPPER IS THE DESIGN.** The body below has several return sites, **and computing a digest at each is that
   * many chances to miss one.** A missed digest on a refusal is harmless; **a missed digest on a real answer is the
   * attention view showing a page with no way to tell what was on it.** Renaming the body and digesting whatever it
   * returns makes "every answer carries a digest" a property of the shape rather than of remembered edits.
   *
   * @returns the answer, and the digest of its text.
   */
  async answer(request: string): Promise<Promise<WebLensResult>> {
    const answered = await this.answerText(request)
    return { ...answered, sha256: createHash('sha256').update(answered.text, 'utf8').digest('hex') }
  }

  /**
   * The lens answer, before its digest is taken. **PRIVATE, AND ONLY `answer` CALLS IT.**
   */
  private async answerText(request: string): Promise<Omit<WebLensResult, 'sha256'>> {
    const query = request.trim()
    if (query.length === 0) return { request: query, text: 'no search text' }
    if (query.length > MAX_QUERY_CHARS) return { request: query, text: 'that search is too long to send' }
    const web = this.config.resolve()
    if (web === undefined) return { request: query, text: 'no web provider is configured on this machine' }
    const timeout = new AbortController()
    const timer = setTimeout(() => { timeout.abort() }, this.config.timeoutMs)
    try {
      const result = await web.search({ query, maxResults: this.config.maxResults }, timeout.signal)
      return { request: query, text: this.render(result) }
    } catch (error: unknown) {
      if (timeout.signal.aborted) return { request: query, text: 'the search took too long' }
      return { request: query, text: `search failed: ${error instanceof Error ? error.message : String(error)}` }
    } finally {
      clearTimeout(timer)
    }
  }

  /** Render one result as plain speakable lines, bounded. */
  private render(result: { content?: string; sources: readonly { url: string; title?: string; snippet?: string }[] }): string {
    const lines: string[] = []
    if (result.content !== undefined && result.content.trim().length > 0) lines.push(result.content.trim())
    for (const source of result.sources) {
      const name = source.title?.trim() ?? hostnameOf(source.url)
      const snippet = source.snippet?.trim()
      lines.push(snippet === undefined || snippet.length === 0 ? name : `${name} — ${snippet}`)
    }
    if (lines.length === 0) return 'the search returned nothing'
    const text = lines.join('\n')
    return text.length > this.config.maxAnswerChars
      ? `${text.slice(0, this.config.maxAnswerChars)}\n… (truncated)`
      : text
  }
}

/** Host of a URL, or the raw value when it does not parse. */
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}
