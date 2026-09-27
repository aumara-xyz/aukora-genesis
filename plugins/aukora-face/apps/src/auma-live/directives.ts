// SPDX-License-Identifier: AGPL-3.0-or-later

/** Field hues shared with the preserved Auma Live browser grammar. */
export const FIELD_HUES = {
  blood: 0,
  ember: 18,
  amber: 32,
  gold: 45,
  green: 129,
  jade: 140,
  teal: 178,
  cyan: 190,
  sky: 205,
  azure: 215,
  indigo: 240,
  purple: 270,
  violet: 280,
  magenta: 320,
  rose: 345,
} as const

/** Field forms shared with the preserved Auma Live browser grammar. */
export const FIELD_FORMS = {
  aurora: 0,
  flow: 0,
  vortex: 1,
  spiral: 1,
  pulse: 2,
  rings: 2,
  swarm: 3,
  stars: 3,
} as const

/** Streaming filter for invisible `[field ...]`, `[repo ...]`, `[web ...]`, `[recall ...]`, and `[weights ...]` directives. */
export interface DirectiveFilter {
  /** Admit one streamed model delta and return only speakable text. */
  push(chunk: string): string
  /** Finish the turn, dropping an incomplete directive. */
  flush(): string
}

/**
 * Split complete directives from streamed text, including tags
 * divided across model deltas.
 * @param apply - Receives each complete directive exactly once.
 * @returns Stateful stream filter for one response.
 */
export function makeDirectiveFilter(apply: (tag: string) => void): DirectiveFilter {
  let pending = ''
  const tagPattern = /^\[\s*(field|repo|web|recall|weights|core|kira)\b[^\]]*\]/i
  const scan = (atEnd: boolean): string => {
    let output = ''
    for (;;) {
      const index = pending.indexOf('[')
      if (index < 0) {
        output += pending
        pending = ''
        break
      }
      output += pending.slice(0, index)
      pending = pending.slice(index)
      const match = pending.match(tagPattern)
      if (match !== null) {
        try {
          apply(match[0])
        } catch {
          // A malformed model-authored visual directive cannot cost the spoken turn.
        }
        pending = pending.slice(match[0].length)
        continue
      }
      const head = ('[' + pending.slice(1).trimStart()).toLowerCase()
      const growing = !pending.includes(']')
        && ('[field'.startsWith(head.slice(0, 6))
          || '[repo'.startsWith(head.slice(0, 5))
          || '[weights'.startsWith(head.slice(0, 8))
          || '[recall'.startsWith(head.slice(0, 7))
          || '[web'.startsWith(head.slice(0, 4))
          // **`core` AND `kira` ARE TAGS SHE CAN EMIT, SO THEY MUST SURVIVE A SPLIT DELTA.** Without
          // these the filter would emit a partial `[cor` as ordinary speech and the directive would
          // arrive as prose — the tag silently swallowed, which reads to Peter as her ignoring him.
          || '[core'.startsWith(head.slice(0, 5))
          || '[kira'.startsWith(head.slice(0, 5)))
      if (growing) {
        if (!atEnd && pending.length < 80) break
        if (atEnd && pending.length <= 80) {
          pending = ''
          break
        }
      }
      const nextBracket = pending.indexOf('[', 1)
      if (nextBracket < 0) {
        output += pending
        pending = ''
        break
      }
      output += pending.slice(0, nextBracket)
      pending = pending.slice(nextBracket)
    }
    return output
  }
  return {
    push(chunk) {
      pending += chunk
      return scan(false)
    },
    flush() {
      return scan(true)
    },
  }
}
