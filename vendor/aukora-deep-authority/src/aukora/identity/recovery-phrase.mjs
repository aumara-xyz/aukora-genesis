/**
 * Seven-token recovery-phrase generation with exact reachable-space accounting.
 *
 * The generator is corpus-agnostic: every security property is computed from
 * the caller-supplied corpus, never assumed. The production gate
 * {@link assertProductionCorpus} enforces the specification floor
 * (docs/specs/AUKORA-SOVEREIGN-SHIELD.md section 6.1: at least 80 bits of
 * min-entropy after every grammar, theme, filtering, no-repeat, and
 * normalization rule) and refuses to generate below it. No production corpus
 * ships with this module; tests use synthetic corpora that exercise the
 * accounting, never a claim about a real word list.
 *
 * Approved phrase form (spec section 6.1): token zero is one six-letter
 * anchor; tokens one through six begin with the anchor's six letters.
 *
 * @module @aukora/identity/recovery-phrase
 */
import { randomInt } from 'node:crypto'

/** Tokens per phrase: one anchor plus six bound tokens. */
export const RECOVERY_PHRASE_TOKENS = 7

/** Letters in the anchor token. */
export const RECOVERY_PHRASE_ANCHOR_LETTERS = 6

/** Specification floor: minimum worst-case bits for a production corpus. */
export const RECOVERY_PHRASE_MIN_BITS = 80

/** Named recovery-phrase failures. Each names one measured fact. */
export const RECOVERY_PHRASE_REFUSE = Object.freeze({
  CORPUS_MALFORMED: 'recovery-phrase:corpus-malformed',
  INSUFFICIENT_ENTROPY: 'recovery-phrase:insufficient-entropy',
  PHRASE_MALFORMED: 'recovery-phrase:phrase-malformed',
})

/** Error carrying one stable recovery-phrase refusal code. */
export class RecoveryPhraseError extends Error {
  /**
   * @param {string} code - one `RECOVERY_PHRASE_REFUSE` value.
   * @param {string} detail - measured fact, never phrase or secret material.
   */
  constructor(code, detail) {
    super(`${code} — ${detail}`)
    this.name = 'RecoveryPhraseError'
    this.code = code
  }
}

/**
 * Validate a caller-supplied word corpus and return its normalized form.
 * @param {unknown} corpus - candidate `{ alphabet, pools }` corpus.
 * @returns {{alphabet: string, pools: Record<string, string[]>}} normalized corpus.
 */
function readCorpus(corpus) {
  if (corpus === null || typeof corpus !== 'object' || Array.isArray(corpus)) {
    throw new RecoveryPhraseError(RECOVERY_PHRASE_REFUSE.CORPUS_MALFORMED, 'corpus must be a plain object')
  }
  const { alphabet, pools } = /** @type {Record<string, unknown>} */ (corpus)
  if (typeof alphabet !== 'string' || !/^[a-z]+$/u.test(alphabet)
    || new Set(alphabet).size !== alphabet.length) {
    throw new RecoveryPhraseError(RECOVERY_PHRASE_REFUSE.CORPUS_MALFORMED, 'alphabet must hold distinct lowercase letters')
  }
  if (pools === null || typeof pools !== 'object' || Array.isArray(pools)) {
    throw new RecoveryPhraseError(RECOVERY_PHRASE_REFUSE.CORPUS_MALFORMED, 'pools must be a plain object')
  }
  const table = /** @type {Record<string, unknown>} */ (pools)
  const normalized = {}
  for (const letter of alphabet) {
    const pool = table[letter]
    if (!Array.isArray(pool) || pool.length < RECOVERY_PHRASE_ANCHOR_LETTERS) {
      throw new RecoveryPhraseError(RECOVERY_PHRASE_REFUSE.CORPUS_MALFORMED,
        `pool ${letter} must hold at least ${RECOVERY_PHRASE_ANCHOR_LETTERS} words for no-repeat draws`)
    }
    const words = []
    for (const word of pool) {
      if (typeof word !== 'string' || !/^[a-z]{2,}$/u.test(word) || !word.startsWith(letter)) {
        throw new RecoveryPhraseError(RECOVERY_PHRASE_REFUSE.CORPUS_MALFORMED,
          `pool ${letter} holds a word outside its letter rule`)
      }
      words.push(word)
    }
    if (new Set(words).size !== words.length) {
      throw new RecoveryPhraseError(RECOVERY_PHRASE_REFUSE.CORPUS_MALFORMED,
        `pool ${letter} holds duplicate words`)
    }
    normalized[letter] = words
  }
  return { alphabet, pools: normalized }
}

/**
 * Compute the exact worst-case entropy of a corpus.
 *
 * The anchor is six uniform draws from the alphabet. Each bound token is a
 * uniform draw without replacement from its letter pool, so the worst case
 * is a sixfold repeat of the weakest letter: the minimum over letters of
 * the falling-factorial sum. No enumeration is needed and no outcome is
 * more likely than the reported bound admits.
 * @param {unknown} corpus - candidate `{ alphabet, pools }` corpus.
 * @returns {{anchorBits: number, tokenBits: number, totalBits: number, worstLetter: string}} exact accounting.
 */
export function phraseMinEntropyBits(corpus) {
  const { alphabet, pools } = readCorpus(corpus)
  const anchorBits = RECOVERY_PHRASE_ANCHOR_LETTERS * Math.log2(alphabet.length)
  let tokenBits = Infinity
  let worstLetter = alphabet[0]
  for (const letter of alphabet) {
    const size = pools[letter].length
    let bits = 0
    for (let drawn = 0; drawn < RECOVERY_PHRASE_ANCHOR_LETTERS; drawn += 1) {
      bits += Math.log2(size - drawn)
    }
    if (bits < tokenBits) {
      tokenBits = bits
      worstLetter = letter
    }
  }
  return { anchorBits, tokenBits, totalBits: anchorBits + tokenBits, worstLetter }
}

/**
 * Admit a corpus for production generation only at or above the floor.
 * @param {unknown} corpus - candidate `{ alphabet, pools }` corpus.
 * @returns {{anchorBits: number, tokenBits: number, totalBits: number, worstLetter: string}} admitted accounting.
 */
export function assertProductionCorpus(corpus) {
  const accounting = phraseMinEntropyBits(corpus)
  if (accounting.totalBits < RECOVERY_PHRASE_MIN_BITS) {
    throw new RecoveryPhraseError(RECOVERY_PHRASE_REFUSE.INSUFFICIENT_ENTROPY,
      `corpus reaches ${accounting.totalBits.toFixed(2)} bits (worst letter ${accounting.worstLetter}); floor is ${RECOVERY_PHRASE_MIN_BITS}`)
  }
  return accounting
}

/**
 * Normalize free phrase text to canonical lowercase single-spaced form.
 * @param {unknown} text - candidate phrase text.
 * @returns {string[]} exactly seven lowercase tokens.
 */
function readTokens(text) {
  if (typeof text !== 'string') {
    throw new RecoveryPhraseError(RECOVERY_PHRASE_REFUSE.PHRASE_MALFORMED, 'phrase must be text')
  }
  const tokens = text.trim().toLowerCase().split(/\s+/u)
  if (tokens.length !== RECOVERY_PHRASE_TOKENS || tokens.some(token => !/^[a-z]+$/u.test(token))) {
    throw new RecoveryPhraseError(RECOVERY_PHRASE_REFUSE.PHRASE_MALFORMED, 'phrase must hold seven lowercase tokens')
  }
  return tokens
}

/**
 * Parse and validate phrase form: six-letter anchor, six bound tokens.
 * @param {unknown} text - candidate phrase text.
 * @param {unknown} [corpus] - optional corpus; when given, every token must be a member.
 * @returns {{anchor: string, tokens: string[], text: string}} validated form.
 */
export function parseRecoveryPhrase(text, corpus) {
  const tokens = readTokens(text)
  const anchor = tokens[0]
  if (anchor.length !== RECOVERY_PHRASE_ANCHOR_LETTERS) {
    throw new RecoveryPhraseError(RECOVERY_PHRASE_REFUSE.PHRASE_MALFORMED, 'token zero must hold six letters')
  }
  for (let index = 1; index < RECOVERY_PHRASE_TOKENS; index += 1) {
    if (!tokens[index].startsWith(anchor[index - 1])) {
      throw new RecoveryPhraseError(RECOVERY_PHRASE_REFUSE.PHRASE_MALFORMED,
        `token ${index} must begin with anchor letter ${anchor[index - 1]}`)
    }
  }
  if (corpus !== undefined) {
    const { pools } = readCorpus(corpus)
    for (let index = 1; index < RECOVERY_PHRASE_TOKENS; index += 1) {
      if (!pools[anchor[index - 1]].includes(tokens[index])) {
        throw new RecoveryPhraseError(RECOVERY_PHRASE_REFUSE.PHRASE_MALFORMED,
          `token ${index} is outside the corpus pool`)
      }
    }
  }
  return { anchor, tokens, text: tokens.join(' ') }
}

/**
 * Generate one phrase from a production corpus. Refuses below the floor.
 * @param {unknown} corpus - admitted `{ alphabet, pools }` corpus.
 * @returns {{anchor: string, tokens: string[], text: string}} generated phrase.
 */
export function generateRecoveryPhrase(corpus) {
  const { pools } = readCorpus(corpus)
  assertProductionCorpus(corpus)
  const alphabet = /** @type {string} */ (corpus.alphabet)
  let anchor = ''
  for (let index = 0; index < RECOVERY_PHRASE_ANCHOR_LETTERS; index += 1) {
    anchor += alphabet[randomInt(alphabet.length)]
  }
  const tokens = [anchor]
  const remaining = new Map()
  for (const letter of anchor) {
    if (!remaining.has(letter)) remaining.set(letter, [...pools[letter]])
    const pool = remaining.get(letter)
    tokens.push(pool.splice(randomInt(pool.length), 1)[0])
  }
  return parseRecoveryPhrase(tokens.join(' '), corpus)
}
