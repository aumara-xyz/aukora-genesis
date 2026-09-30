/**
 * The desktop shell's ceremony bridge, read defensively and never relied upon.
 *
 * THE CEREMONY OWNS THE PHRASE, AND THIS FILE TOUCHES NONE OF IT. In v3 the ceremony is the AUMLOK
 * screen itself: the seven words are shown once, typed back word by word, and the root is derived from
 * them. The shell's part is to DRAW the words where the word lists live, to carry the typed words to
 * the process that can write a record, and to answer with a verdict. This module never keeps, logs or
 * displays a phrase, never touches the system copy-paste buffer, and returns the drawn words to its
 * caller rather than holding them anywhere of its own.
 *
 * TWO VERBS, AND THEY ARE THE WHOLE OF THE CROSSING. `draw` brings the seven words from the shell to
 * this page for display; `submit` takes the typed words back. Nothing else about a phrase crosses, and
 * the shell's reply to a submit carries no phrase material at all — only whether the ceremony
 * completed and, when it did not, a short reason of the shell's own.
 *
 * THERE IS NO WINDOW HERE, AND NO THIRD CEREMONY. v2 had a verb that opened a separate window holding
 * signing open for a fixed period, and this file used to read it. v3 removed that window with the rest
 * of the custody model, so a bridge carrying no `draw` and no `submit` is a shell with no v3 ceremony
 * in it: this reader then returns undefined and the screen renders no ceremony control at all, rather
 * than a control that would open something §3 says does not exist.
 *
 * WHY A SHAPE CHECK INSTEAD OF A TRUSTED GLOBAL. The preload bridge belongs to the Electron shell, not
 * to this package: `window.aukoraAumlok` is UNDEFINED when the page is opened in a plain browser, and
 * the surface must then render no ceremony control at all rather than a button that cannot work. Even
 * when a value is present it is checked function by function, because this code runs against a shell
 * written by someone else and a half-mounted bridge would otherwise fail at click time instead of at
 * load time.
 *
 * There is no Node API here and none may be added: this is browser-side code.
 */

/** What one submit resolves to, exactly as the preload contracts to provide. */
export interface AumlokCeremonyResult {
  readonly ok: boolean
  /** The shell's own short machine-readable refusal. Shown verbatim, never replaced. */
  readonly reason?: string
  /** Only a new draw can be submitted after the shell consumes these words. */
  readonly drawSpent?: true
}

/** What one draw resolves to: the seven words, shown once, or the shell's own refusal. */
export interface AumlokDrawnPhrase {
  readonly ok: boolean
  /** The seven words, in order, anchor first. Present only on a completed draw. */
  readonly words?: readonly string[]
  /** The shell's own short machine-readable refusal. Shown verbatim, never replaced. */
  readonly reason?: string
}

/** The preload bridge, narrowed to the verbs this screen may ask for. */
export interface AumlokCeremonyBridge {
  /**
   * Draw the seven words for one ceremony, in order, anchor first.
   * @param intent - which ceremony is being started.
   * @returns whether the words were drawn, and the shell's own reason when they were not.
   */
  draw(intent: AumlokCeremonyIntent): Promise<unknown>
  /**
   * Hand the typed words back, and resolve when the ceremony finishes.
   *
   * ONE VERB PER HALF OF THE CROSSING, AND NOTHING BEYOND THEM. A bridge carrying a verb this screen
   * does not name is a shell offering a ceremony this face has not agreed to render.
   * @param intent - which ceremony the words belong to.
   * @param words - the seven typed words, in order, anchor first.
   * @param handle - the person's PUBLIC handle, as typed. X8 salts the key with it, so it is half of
   *   the key rather than a label on it; it is passed through as typed and kept nowhere here.
   * @returns whether the ceremony completed, and the shell's own reason when it did not.
   */
  submit(intent: AumlokCeremonyIntent, words: readonly string[], handle?: string): Promise<unknown>
}

/** Which ceremony the operator asked for. */
export type AumlokCeremonyIntent = 'bind' | 'refresh'

/** The only shape a word of a phrase can have: lower case, and short. */
const WORD = /^[a-z]{1,32}$/u

/** The plan's phrase is seven words, and a draw that is not seven words is not a phrase. */
const PHRASE_LENGTH = 7

function isFunction(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === 'function'
}

/**
 * Read the shell bridge off the page, if this launch has one.
 *
 * `available: true` is required as well as both verbs: the shell's own flag is the shell's statement
 * that a ceremony can actually be run here, and a bridge that declares itself unavailable must not grow
 * a working-looking button. Both verbs are required together, for the same reason.
 * @param page - the object to read the bridge from; the page's own global by default.
 * @returns the bounded bridge, or undefined in a plain browser or a half-mounted shell.
 */
export function readAumlokCeremonyBridge(page?: unknown): AumlokCeremonyBridge | undefined {
  const candidate = page === undefined
    ? (globalThis as { aukoraAumlok?: unknown }).aukoraAumlok
    : page
  if (candidate === null || typeof candidate !== 'object') return undefined
  const record = candidate as Record<string, unknown>
  if (record['available'] !== true) return undefined
  // BOTH, OR NONE. A half-mounted bridge must render no control rather than one that fails at click
  // time, which is the same doctrine as the `available` flag above.
  if (!isFunction(record['draw']) || !isFunction(record['submit'])) return undefined
  return {
    draw: intent => (record['draw'] as AumlokCeremonyBridge['draw']).call(candidate, intent) as Promise<unknown>,
    submit: (intent, words, handle) =>
      (record['submit'] as AumlokCeremonyBridge['submit'])
        .call(candidate, intent, words, handle) as Promise<unknown>,
  }
}

/** The shell's reason, when it gave one this screen may show. */
function readReason(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) return undefined
  return value
}

/**
 * Narrow one drawn phrase without inventing words the shell did not draw.
 *
 * A value that is not seven lower-case words is reported as a FAILURE, not as a success: a screen that
 * showed six words, or a word with a capital in it, would be showing something that is not a phrase,
 * and the person would type back what they were shown. The shell's own reason is carried through when
 * it gave one, so the screen quotes the shell rather than paraphrasing it.
 * @param value - the resolved value of a draw call.
 * @returns the seven words, or a failure carrying no words.
 */
export function parseAumlokDrawnPhrase(value: unknown): AumlokDrawnPhrase {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false }
  const record = value as Record<string, unknown>
  const reason = readReason(record['reason'])
  if (record['ok'] !== true) return reason === undefined ? { ok: false } : { ok: false, reason }
  const words = record['words']
  if (!Array.isArray(words) || words.length !== PHRASE_LENGTH) return { ok: false }
  if (!words.every(word => typeof word === 'string' && WORD.test(word))) return { ok: false }
  return { ok: true, words: words.map(word => String(word)) }
}

/**
 * Narrow one submit result without inventing a claim the shell did not make.
 *
 * A value that is not the contracted shape is reported as a FAILURE with no reason, not as a success:
 * the caller then says only that no result came back, which is the whole of what is known.
 * @param value - the resolved value of a submit call.
 * @returns the contracted result, or a failure carrying no reason.
 */
export function parseAumlokCeremonyResult(value: unknown): AumlokCeremonyResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false }
  const record = value as Record<string, unknown>
  const ok = record['ok'] === true
  const reason = readReason(record['reason'])
  const spent = record['drawSpent'] === true ? { drawSpent: true as const } : {}
  return reason === undefined ? { ok, ...spent } : { ok, reason, ...spent }
}

/**
 * Draw one phrase and report what the shell said, and nothing more.
 *
 * A rejected promise (the shell died, its window was destroyed, the bridge was replaced) is the same
 * fact as a refusal with no reason: no phrase came back. Neither outcome is turned into a success.
 * @param bridge - the bounded bridge read from the page.
 * @param intent - which ceremony to draw for.
 * @returns the contracted drawn phrase, or a failure carrying no words.
 */
export async function drawAumlokPhrase(
  bridge: AumlokCeremonyBridge,
  intent: AumlokCeremonyIntent,
): Promise<AumlokDrawnPhrase> {
  try {
    // A CLOSED SWITCH, AND THE DEFAULT REFUSES. The verbs are named per ceremony, so a third ceremony
    // added to the type would otherwise silently draw for one of the two that exist — a person asking
    // for one thing handed the words of another. An intent this mapper does not know draws NOTHING and
    // refuses by name.
    switch (intent) {
      case 'bind':
      case 'refresh':
        return parseAumlokDrawnPhrase(await bridge.draw(intent))
      default: return { ok: false, reason: 'aumlok:ceremony-intent-unknown' }
    }
  } catch {
    return { ok: false }
  }
}

/**
 * Hand the typed words back and report the shell's verdict, and nothing more.
 *
 * THE WORDS GO BACK EXACTLY AS TYPED, and this function keeps no copy of them: the array it is given
 * is passed through and then forgotten, so nothing here can grow a cache of a phrase. THE HANDLE GOES
 * WITH THEM, for the same reason and with the same care — except that it is public, so the only rule
 * it needs is that it is not invented here.
 * @param bridge - the bounded bridge read from the page.
 * @param intent - which ceremony the words belong to.
 * @param words - the seven typed words, in order, anchor first.
 * @param handle - the person's public handle, as typed, or nothing on a ceremony that does not ask.
 * @returns the contracted result, or a failure carrying no reason.
 */
export async function submitAumlokPhrase(
  bridge: AumlokCeremonyBridge,
  intent: AumlokCeremonyIntent,
  words: readonly string[],
  handle?: string,
): Promise<AumlokCeremonyResult> {
  try {
    // THE SAME CLOSED SWITCH, for the same reason: a submit must not be routed to another ceremony's
    // verb, and an intent this mapper does not know submits NOTHING and refuses by name.
    switch (intent) {
      case 'bind':
      case 'refresh':
        return parseAumlokCeremonyResult(await bridge.submit(intent, words, handle))
      default: return { ok: false, reason: 'aumlok:ceremony-intent-unknown' }
    }
  } catch {
    return { ok: false }
  }
}
