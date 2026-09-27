/**
 * lane-card-view.mjs — WHAT PETER SEES, DERIVED FROM THE CARD ITSELF.
 *
 * WHY THIS IS A SEPARATE, PURE MODULE. The card surface is a page inside Electron, and a page is the
 * hardest thing in this repository to test. So the DECISION about what to show lives here, as a function
 * of the card object and nothing else, and the page does layout. **A court can call this with no Electron,
 * no window and no display**, which is the only reason the arms in `tests/aura-lane-card-view.test.mjs`
 * can be red at all.
 *
 * ── THE PROBLEM THIS FILE EXISTS TO SOLVE ────────────────────────────────────────────────────────
 *
 * "SHOW THE EXACT TEXT" AND "MAKE CONTROL CHARACTERS VISIBLE" PULL IN OPPOSITE DIRECTIONS. `visible()`
 * escapes by Unicode general category, so `"a\u202Eb"` DISPLAYS as `a<U+202E>b` — the display is NOT
 * byte-identical to the bound text, and it must not be, because a page that rendered the raw override
 * would let the text lie about itself.
 *
 * SO THE VIEW CARRIES BOTH, AND THEY COME FROM ONE FIELD:
 *
 *   source   the EXACT bytes bound into the digest. Never displayed raw, never re-typed.
 *   display  `visibleKeepingNewlines(source)` — what the page prints.
 *   digest   recomputed HERE, from `source`, and asserted equal to the card's own.
 *
 * **NOBODY RETYPES THE TEXT.** A page that took a `displayText` from somewhere other than the card's
 * `text` would show one string and confirm another, and the difference could be a single character. The
 * view recomputes the digest from the very field it displays, so that divergence is a REFUSAL here rather
 * than a discovery later.
 */
import { cardDigest } from './lane-dispatch.mjs'
import { visibleKeepingNewlines } from '../../plugins/aukora-owner-daemon/lib/visible.mjs'

/** How much of the digest a person is asked to compare. Twelve hex characters is the agreed prefix. */
export const DIGEST_PREFIX_CHARS = 12

/** The refusal when the card and the text it claims to bind disagree. */
export const CARD_VIEW_MISMATCH = 'lane-card-view/mismatch'

/**
 * Build the display model for one pending card.
 *
 * @param {{nonce: string, lane: string, kind: string, digest: string, issuedAt: number,
 *          expiresAt: number}} card - the card as the confirm endpoint returned it.
 * @param {string} boundText - the exact text the digest covers. Supplied SEPARATELY and on purpose:
 *   the card holds the digest and never the message, so the text must come from wherever the sender's
 *   request is held, and the view's job is to PROVE the two agree rather than assume it.
 * @returns {Readonly<object>} the model the page renders.
 * @throws {Error} `lane-card-view/mismatch` when the text does not reproduce the card's digest.
 */
export function cardViewModel(card, boundText) {
  if (card === null || typeof card !== 'object') {
    throw new Error(`${CARD_VIEW_MISMATCH}: no card was supplied`)
  }
  if (typeof boundText !== 'string') {
    throw new Error(`${CARD_VIEW_MISMATCH}: the bound text must be a string`)
  }
  // ── THE CHECK, AND IT IS THE WHOLE POINT OF THE MODULE ────────────────────────────────────────
  // Recomputed from `boundText` — the field this view will display — and compared to the card's own
  // digest. If a caller passed a text that differs by ONE character, this refuses before anything is
  // rendered, so **a page can never show a string the card does not bind**.
  const recomputed = cardDigest({ lane: card.lane, text: boundText, kind: card.kind })
  if (recomputed !== card.digest) {
    throw new Error(`${CARD_VIEW_MISMATCH}: the supplied text does not reproduce the card's digest; `
      + `bound ${String(card.digest).slice(0, DIGEST_PREFIX_CHARS)}, `
      + `recomputed ${recomputed.slice(0, DIGEST_PREFIX_CHARS)}`)
  }
  return Object.freeze({
    nonce: card.nonce,
    lane: card.lane,
    kind: card.kind,
    // THE EXACT BYTES. Kept in the model so a court can round-trip them, and so the page has a field it
    // may NOT substitute for `display`.
    source: boundText,
    // WHAT THE PAGE PRINTS. Newlines are kept — this is prose, and a goal has lines — but every other
    // control, format, line-separator and paragraph-separator character becomes `<U+XXXX>`.
    display: visibleKeepingNewlines(boundText),
    // The FULL digest travels; the page shows the prefix. A court compares both.
    digest: card.digest,
    digestPrefix: String(card.digest).slice(0, DIGEST_PREFIX_CHARS),
    issuedAt: card.issuedAt,
    expiresAt: card.expiresAt,
  })
}

/**
 * Whether a card is past its expiry, at a given instant.
 *
 * THE PAGE DOES NOT DECIDE THIS. A clock comparison inside a render is the kind of thing that is right
 * once and wrong forever, so it is a function of the card and a `now` the caller supplies.
 *
 * @param {{expiresAt: number}} card
 * @param {number} now - milliseconds. Injected: a court must not depend on the wall clock.
 */
export function cardExpired(card, now) {
  return !(typeof card?.expiresAt === 'number' && now <= card.expiresAt)
}

/** The two acts, and nothing else. A card has exactly two outcomes. */
export const CARD_ACTIONS = Object.freeze(['send', 'decline'])

/**
 * What a press MEANS, as a value rather than as a side effect.
 *
 * **`send` CARRIES THE NONCE AND NOT THE TEXT.** The endpoint binds the card by nonce and the text is
 * re-read from where the request is held, so a page cannot smuggle a different message by pressing a
 * button. A press is an INSTRUCTION; the binding is checked by the door.
 *
 * @param {'send'|'decline'} action
 * @param {{nonce: string}} card
 * @param {number} now
 * @returns {{act: string, nonce: string, at: number}}
 */
export function cardPress(action, card, now) {
  if (!CARD_ACTIONS.includes(action)) throw new Error(`lane-card-view/unknown-action: ${String(action)}`)
  if (typeof card?.nonce !== 'string' || card.nonce === '') {
    throw new Error('lane-card-view/no-nonce: a press must name the card it acts on')
  }
  return { act: action, nonce: card.nonce, at: now }
}
