// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Read-only conversation lookup for the Auma Live presence mind.
 *
 * The repository and internet lenses let the voice look outward. This one lets
 * it look backward: it searches the durable session directory for a named
 * earlier conversation and returns a small number of short, cited excerpts of
 * what was actually said. It is read-only — it reads the same persisted logs
 * the coding lead reads, and it cannot dispatch, write, approve, or change the
 * weights serving the lane.
 *
 * Source honesty is load-bearing here. A session excerpt is session evidence:
 * text the owner or the assistant wrote in a specific conversation, cited by
 * session id and event sequence. It is never a KIRA memory record and never a
 * broker-attested Aura citation. If KIRA is unavailable, this lane says the
 * conversation lookup is unavailable rather than presenting a session excerpt
 * as something it is not.
 */
import { createHash } from 'node:crypto'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { extractSessionEventText } from '@deepseek-ai/dsh-session-query'

/** One excerpt of a conversation, cited to a stable event reference. */
export interface RecallSnippet {
  /**
   * Source class. **ALWAYS session evidence here** — this lens reads conversation logs. That is a statement about
   * THIS LENS, not about what she can reach: since auma-27 item 2 a KIRA record can also arrive, through
   * `kira-lens.ts`, and the two are never to be presented as one another.
   */
  readonly sourceType: 'session'
  /** Short name for the conversation, derived from its opening turn. */
  readonly title: string
  /** Session the excerpt came from. */
  readonly sessionId: SessionId
  /** Monotonic event sequence number within that session. */
  readonly seq: number
  /** Recorded event time in milliseconds. */
  readonly time: number
  /** The excerpt text, bounded. */
  readonly text: string
  /** Whether the source text was longer than the snippet cap. */
  readonly truncated: boolean
}

/** One lookup outcome, ready to frame into a model message. */
export interface RecallLensResult {
  /** The request exactly as the model wrote it. */
  request: string
  /** Rendered excerpts, or a one-line refusal/error the model can speak. */
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

/** Lens construction settings. */
export interface RecallLensConfig {
  /** Resolve the durable session backend at call time; the lane loads without one. */
  resolve(): SessionPersistence | undefined
  /** Newest sessions inspected per lookup, newest first. */
  maxCandidates: number
  /** Excerpts returned per lookup. */
  maxSnippets: number
  /** Unicode characters per excerpt. */
  snippetChars: number
  /** Rendered-answer character cap. */
  maxAnswerChars: number
}

/** Cap for a derived conversation name shown in ambiguity listings. */
const LABEL_CHARS = 120

/**
 * Bounded, read-only lookup over the durable session directory. A named chat
 * is a search target, never authorization: access is the same top-level
 * sessions the durable backend already exposes, and subagent children — seeded
 * machine forks of a conversation — are never treated as conversations someone
 * had.
 */

/**
 * Read one stored session's events without joining it live.
 * @param persistence - the mounted session store.
 * @param id - the session to read.
 * @returns that session's events in order.
 */
async function coldEvents(
  persistence: SessionPersistence,
  id: SessionId,
): Promise<readonly SessionEvent[]> {
  const handle = await persistence.open(id, 'read')
  try {
    const { events } = await handle.read(0, undefined)
    return events
  } finally {
    await handle.close()
  }
}

export class RecallLens {
  /** @param config - Backend resolver and per-lookup bounds. */
  constructor(private readonly config: RecallLensConfig) {}

  /**
   * Answer one model-authored lookup.
   * @param request - The chat name or topic the model wants to find.
   * @param self - The live Session to exclude; a lane must not recall itself as another chat.
   * @returns The request echoed with bounded cited excerpts or a refusal.
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
  async answer(request: string, self?: SessionId): Promise<Promise<RecallLensResult>> {
    const answered = await this.answerText(request, self)
    return { ...answered, sha256: createHash('sha256').update(answered.text, 'utf8').digest('hex') }
  }

  /**
   * The lens answer, before its digest is taken. **PRIVATE, AND ONLY `answer` CALLS IT.**
   */
  private async answerText(request: string, self?: SessionId): Promise<Omit<RecallLensResult, 'sha256'>> {
    const query = normalizeQuery(request)
    if (query.length === 0) return { request, text: 'name the conversation you mean' }
    const persistence = this.config.resolve()
    if (persistence === undefined) return { request, text: 'conversation memory is not mounted on this Host' }
    let headers: readonly SessionHeader[]
    try {
      headers = (await persistence.list()).map(snapshot => snapshot.header)
    } catch {
      return { request, text: 'conversation memory could not be read right now' }
    }
    const candidates = headers
      .filter(header => header.origin !== 'subagent' && header.id !== self)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, this.config.maxCandidates)
    const resolved: Array<{ header: SessionHeader; label: string; events: readonly SessionEvent[] }> = []
    for (const header of candidates) {
      try {
        const events = await coldEvents(persistence, header.id)
        resolved.push({ header, label: labelOf(events, header.id), events })
      } catch {
        // One damaged or vanished log must not hide every other conversation.
        continue
      }
    }
    const matches = resolved.filter(entry => entry.label.toLowerCase().includes(query))
    if (matches.length === 0) return { request, text: `no conversation I can reach is named or about "${request.trim()}"` }
    if (matches.length > 1) {
      const names = matches.slice(0, 5).map(entry => entry.label).join('", "')
      return { request, text: `several conversations match — which one: "${names}"? Ask again with the exact name.` }
    }
    const chosen = matches[0]
    if (chosen === undefined) return { request, text: `no conversation I can reach matches "${request.trim()}"` }
    return { request, text: render(excerpts(chosen, this.config), this.config.maxAnswerChars) }
  }
}

/** A conversation's short name: its opening owner turn, or the session id. */
function labelOf(events: readonly SessionEvent[], fallback: SessionId): string {
  for (const event of events) {
    if (event.type !== 'user/message' || event.data.source.kind !== 'user') continue
    const text = extractSessionEventText(event).trim()
    if (text.length > 0) return clip(text, LABEL_CHARS)
  }
  return String(fallback)
}

/** Collect the first conversation turns, cited and bounded. */
function excerpts(
  entry: { header: SessionHeader; label: string; events: readonly SessionEvent[] },
  config: RecallLensConfig,
): RecallSnippet[] {
  const output: RecallSnippet[] = []
  for (const event of entry.events) {
    if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
    if (event.type === 'user/message' && event.data.source.kind !== 'user') continue
    const text = extractSessionEventText(event).trim()
    if (text.length === 0) continue
    const truncated = [...text].length > config.snippetChars
    output.push({
      sourceType: 'session',
      title: entry.label,
      sessionId: entry.header.id,
      seq: event.seq,
      time: event.time,
      text: clip(text, config.snippetChars),
      truncated,
    })
    if (output.length >= config.maxSnippets) break
  }
  return output
}

/** Render cited excerpts as one bounded, speakable block. */
function render(snippets: readonly RecallSnippet[], cap: number): string {
  if (snippets.length === 0) return 'that conversation has no readable turns'
  const lines = snippets.map((snippet) => {
    const marker = snippet.truncated ? '…' : ''
    return `- (${snippet.sessionId}#${String(snippet.seq)}, ${new Date(snippet.time).toISOString()}) ${snippet.text}${marker}`
  })
  return bounded(`session evidence from "${snippets[0]?.title ?? ''}":\n${lines.join('\n')}`, cap)
}

function normalizeQuery(request: string): string {
  return request.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 512)
}

function clip(text: string, chars: number): string {
  return [...text].slice(0, chars).join('')
}

function bounded(text: string, cap: number): string {
  return text.length > cap ? `${text.slice(0, cap)}\n… (truncated)` : text
}
