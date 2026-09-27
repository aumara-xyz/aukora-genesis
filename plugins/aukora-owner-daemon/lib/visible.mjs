/**
 * MAKING AGENT-AUTHORED TEXT SAFE TO PRINT ON THE OWNER'S TERMINAL.
 *
 * **INDEPENDENT REVIEW R0.** The console printed `operation`, `scope`, `ledgerId`, `nonce`, `digest` and the
 * frozen BYTES straight to stdout. Every one of those is authored by whoever submitted the proposal, and a
 * terminal is not a text field — it is a PROGRAM that interprets what it is given. `ESC [ 2 J` clears the
 * screen, `ESC [ H` moves the cursor, and the owner then reads a listing that the submitter drew and approves
 * a NONCE the submitter chose. **The escape sequence is not decoration around the attack; it IS the attack**,
 * and it needs nothing from the daemon, the key or the socket.
 *
 * ── AND AN ESCAPE BYTE IS NOT THE ONLY WAY TO LIE TO A TERMINAL (Fable, measured) ────────────────
 *
 * The first version of this file escaped C0, DEL and C1 — a RANGE of code points. **That is the wrong shape of
 * check**, because the characters that reorder and hide text are not in that range and are not even adjacent to
 * it. Nothing below contains an `ESC`:
 *
 *     "approve \u202Eevil\u202C ok"        U+202E RIGHT-TO-LEFT OVERRIDE renders the tail REVERSED, so the
 *                                          owner reads a different string from the one that was signed
 *     "dead\u200Bbeef"                    U+200B ZERO WIDTH SPACE splits a word invisibly
 *     "no\u2066hidden\u2069pe"             U+2066–U+2069 ISOLATES scope the reordering to a substring
 *     "line\u2028break"                    U+2028 LINE SEPARATOR breaks a line without a newline byte
 *
 * That is the Trojan Source class, and it defeats a filter built from ranges because the attacker chooses from
 * a table of properties rather than from a block of numbers.
 *
 * THE RULE IS THEREFORE BY **UNICODE GENERAL CATEGORY**, not by code point:
 *
 *     \p{Cc}  control        C0, DEL and C1
 *     \p{Cf}  format         the overrides, the isolates, the zero-width joiners and the BOM
 *     \p{Zl}  line separator U+2028
 *     \p{Zp}  paragraph sep. U+2029
 *
 * **A CATEGORY IS THE LIST, AND THE LIST IS THE POINT**: a new override character is added to `\p{Cf}` by the
 * Unicode Consortium and this file covers it the day the runtime's tables update, where an explicit list of
 * ranges covers it the day somebody remembers.
 *
 * NOTHING IS DROPPED. Every one of them prints as `<U+XXXX>`, so the owner still sees exactly what was
 * submitted — **a field that hides its control characters is as dishonest as one that obeys them**: the person
 * authorising a set of bytes needs to see that the bytes contain an override, not a sanitised summary of them.
 */

/** Every general category a terminal, or a reader, treats as more than the glyph it looks like. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u

/** One code point, as the owner will read it. */
const shown = character => `<U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}>`

/**
 * **A MARKER THIS MODULE WOULD EMIT, MATCHED SO IT CANNOT BE TYPED (CODEX R12, FINDING 3).**
 *
 * ```js
 * escape('\u0007')      → '<U+0007>'      // a real control character, made visible
 * escape('<U+0007>')    → '<U+0007>'      // SEVEN ORDINARY BYTES — AND THE SAME OUTPUT
 * ```
 *
 * **THE TWO ARE INDISTINGUISHABLE, SO THE DISPLAY CANNOT BE TRUSTED.** A submitter who sends the literal text
 * can make a document READ as though it contained a control character, **and — the direction that matters more —
 * can make text that DOES contain one read as though it did not**, by sending the marker for a character and
 * relying on the reader to see a harmless escape. `visible()` exists so the owner can see what the bytes contain;
 * an encoding whose own syntax is reachable from the data does not do that.
 *
 * **THE REPAIR IS TO ESCAPE THE SYNTAX, NOT THE DATA:** a literal `<` that BEGINS a marker is rendered as
 * `<U+003C>` like any other escaped character, so the output is **REVERSIBLE** — a reader can always tell an
 * escape this module wrote from text the submitter chose.
 *
 * **AND IT IS MINIMAL.** Only `<` that opens a well-formed marker is touched, so ordinary prose, code samples and
 * comparisons are printed unchanged rather than being buried under escapes nobody asked for.
 */
const MARKER_AHEAD = /^U\+[0-9A-F]{4,}>/u

/** Escape every character in those categories, optionally sparing the line feed. */
function escape(text, keepNewlines) {
  // **AN ARRAY, BECAUSE THE MARKER CHECK NEEDS THE CHARACTERS THAT FOLLOW.** A `for…of` over the string cannot
  // look ahead, and the lookahead is the whole point: `<` is only escaped when a marker opens at it.
  const characters = [...text]
  let out = ''
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]
    // `\n` IS THE ONE CONTROL CHARACTER A LINE-ORIENTED PROGRAM MUST PRINT, and only where the caller says so.
    if (keepNewlines && character === '\n') { out += character; continue }
    // **A WINDOW, NOT THE WHOLE TAIL.** Markers are at most `U+` plus ten hex digits plus `>`; slicing the rest
    // of the string for every `<` would make this quadratic in a document nobody has bounded the size of.
    if (character === '<'
      && MARKER_AHEAD.test(characters.slice(index + 1, index + 14).join(''))) {
      out += shown(character)
      continue
    }
    out += INVISIBLE.test(character) ? shown(character) : character
  }
  return out
}

/**
 * Every character a terminal or a reader would treat as an instruction, rendered as text.
 *
 * Covers `\p{Cc}` (C0, DEL, C1), `\p{Cf}` (overrides, isolates, zero-width, BOM), `\p{Zl}` and `\p{Zp}`.
 *
 * **C1 MATTERS AS MUCH AS C0 AND IS EASIER TO FORGET**: `0x9B` is a single-byte CSI in several terminals, so a
 * filter that strips only `ESC` leaves a working introducer behind. **`\p{Cf}` MATTERS MORE**, because it needs
 * no escape byte at all — the whole class renders as nothing, so the owner cannot see that anything is there.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function visible(value) {
  return escape(String(value ?? ''), false)
}

/**
 * The same, KEEPING line feeds — for text that is deliberately printed as lines.
 *
 * The frozen bytes are paged by splitting on `\n`, and escaping it would turn a readable document into one
 * enormous line. `\n` is left alone **because this function's output is written one line at a time by the
 * caller**; everything else that could move the cursor, reorder the text or break a line is made visible, the
 * carriage return and `U+2028` included. **The line feed is spared and the line SEPARATOR is not**: one is how
 * this program prints, the other is a byte the submitter chose to look like it.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function visibleKeepingNewlines(value) {
  return escape(String(value ?? ''), true)
}
