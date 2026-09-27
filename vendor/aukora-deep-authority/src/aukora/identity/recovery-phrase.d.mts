/** Tokens per phrase: one anchor plus six bound tokens. */
export declare const RECOVERY_PHRASE_TOKENS: 7

/** Letters in the anchor token. */
export declare const RECOVERY_PHRASE_ANCHOR_LETTERS: 6

/** Specification floor: minimum worst-case bits for a production corpus. */
export declare const RECOVERY_PHRASE_MIN_BITS: 80

/** Named recovery-phrase failures. */
export declare const RECOVERY_PHRASE_REFUSE: Readonly<Record<string, string>>

/** Caller-supplied word corpus: distinct-letter alphabet plus per-letter pools. */
export type RecoveryCorpus = Readonly<{
  alphabet: string
  pools: Readonly<Record<string, readonly string[]>>
}>

/** Exact worst-case entropy accounting for one corpus. */
export type RecoveryCorpusAccounting = Readonly<{
  anchorBits: number
  tokenBits: number
  totalBits: number
  worstLetter: string
}>

/** Validated seven-token phrase form. */
export type RecoveryPhrase = Readonly<{
  anchor: string
  tokens: readonly string[]
  text: string
}>

/**
 * Compute the exact worst-case entropy of a corpus: uniform anchor draws
 * plus no-repeat token draws, minimized over the weakest letter.
 */
export declare function phraseMinEntropyBits(corpus: unknown): RecoveryCorpusAccounting

/**
 * Admit a corpus for production generation only at or above the 80-bit
 * floor. Throws `recovery-phrase:insufficient-entropy` below it.
 */
export declare function assertProductionCorpus(corpus: unknown): RecoveryCorpusAccounting

/**
 * Parse and validate phrase form: six-letter anchor with six bound tokens.
 * Membership-checked against the corpus only when one is supplied.
 */
export declare function parseRecoveryPhrase(text: unknown, corpus?: unknown): RecoveryPhrase

/**
 * Generate one phrase from a production corpus. Refuses below the floor
 * before drawing anything.
 */
export declare function generateRecoveryPhrase(corpus: unknown): RecoveryPhrase
